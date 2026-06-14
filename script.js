/* ═══════════════════════════════════════════════════════════════════════
   Telegram Chat Viewer — script.js (Multi-File Version - Current Folder)
   ═══════════════════════════════════════════════════════════════════════ */

"use strict";

// ── Tuning constants ───────────────────────────────────────────────────
const INITIAL_BATCH  = 200;
const IDLE_BATCH     = 300;
const IDLE_DEADLINE  = 30;

// ── Global state ───────────────────────────────────────────────────────
let currentFile      = null;
let allMessages      = [];
let renderedUpTo     = 0;
let renderDone       = false;
let renderMeta       = [];
let fileIndex        = null;
let availableFiles   = [];

// Search state
let matches           = [];
let currentMatchIndex = 0;
let searchTerm        = "";
let pendingJumpIndex  = null;
let searchScope       = "current";
let allMessagesCache  = null;

// Background render scheduler handle
let idleHandle        = null;
let currentRenderFile = null;

// DOM refs
const messagesEl    = document.getElementById("messages");
const loadingEl     = document.getElementById("loading");
const errorEl       = document.getElementById("error");
const progressBar   = document.getElementById("progress-bar");
const progressWrap  = document.getElementById("progress-wrap");
const searchInput   = document.getElementById("search-input");
const searchCounter = document.getElementById("search-counter");
const btnPrev       = document.getElementById("btn-prev");
const btnNext       = document.getElementById("btn-next");
const sidebar       = document.getElementById("sidebar");
const menuToggle    = document.getElementById("menu-toggle");
const sidebarOverlay= document.getElementById("sidebar-overlay");
const fileListEl    = document.getElementById("file-list");
const totalMessagesSpan = document.getElementById("total-messages");
const currentFileNameSpan = document.getElementById("current-file-name");

// ── Columnar decoder ───────────────────────────────────────────────────
function decodeColumnar(raw) {
  if (Array.isArray(raw)) return raw;

  if (raw && raw.v === 1 && Array.isArray(raw.fields) && Array.isArray(raw.rows)) {
    const fields = raw.fields;
    const fLen   = fields.length;
    return raw.rows.map(row => {
      const msg = {};
      for (let f = 0; f < fLen; f++) {
        msg[fields[f]] = row[f] !== undefined ? row[f] : null;
      }
      msg.is_forwarded = !!msg.is_forwarded;
      return msg;
    });
  }

  throw new Error("Unrecognised chat data format.");
}

// ── Load File Index (from current folder) ──────────────────────────────
async function loadFileIndex() {
  try {
    const res = await fetch("index.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fileIndex = await res.json();
    availableFiles = fileIndex.files;
    
    renderFileList();
    
    if (availableFiles.length > 0) {
      await loadChatFile(availableFiles[0]);
    } else {
      throw new Error("No chat files found");
    }
  } catch (e) {
    console.error("Failed to load index:", e);
    loadingEl.hidden = true;
    errorEl.hidden = false;
    errorEl.querySelector("p").innerHTML = "⚠️ Could not load <code>index.json</code><br>Run <code>python3 split_chat.py</code> first";
  }
}

// ── Load Specific Chat File (from current folder) ──────────────────────
async function loadChatFile(file) {
  if (idleHandle !== null) {
    cancelIdleCallbackCompat(idleHandle);
    idleHandle = null;
  }
  
  loadingEl.hidden = false;
  errorEl.hidden = true;
  messagesEl.innerHTML = "";
  renderedUpTo = 0;
  renderDone = false;
  allMessages = [];
  renderMeta = [];
  
  searchTerm = "";
  searchInput.value = "";
  matches = [];
  updateCounter();
  
  currentFile = file;
  currentFileNameSpan.textContent = file.name;
  
  document.querySelectorAll('.file-item').forEach(el => {
    el.classList.remove('active');
    if (el.dataset.filename === file.filename) {
      el.classList.add('active');
    }
  });
  
  try {
    // 🔥 KEY CHANGE: Fetch from current folder, not chunks/
    const res = await fetch(file.filename);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    allMessages = decodeColumnar(raw);
    
    totalMessagesSpan.textContent = `${allMessages.length.toLocaleString()} messages (${file.name})`;
    
    buildRenderMeta();
    
    loadingEl.hidden = true;
    
    renderBatch(0, Math.min(INITIAL_BATCH, allMessages.length));
    
    if (renderedUpTo < allMessages.length) {
      if (progressWrap) progressWrap.hidden = false;
      scheduleIdleRender();
    } else {
      markRenderComplete();
    }
  } catch (e) {
    console.error(`Failed to load ${file.filename}:`, e);
    loadingEl.hidden = true;
    errorEl.hidden = false;
    errorEl.querySelector("p").innerHTML = `⚠️ Could not load ${file.name}`;
  }
}

// ── Render File List in Sidebar ────────────────────────────────────────
function renderFileList() {
  if (!fileListEl) return;
  
  fileListEl.innerHTML = "";
  
  availableFiles.forEach(file => {
    const fileItem = document.createElement("div");
    fileItem.className = "file-item";
    fileItem.dataset.filename = file.filename;
    
    fileItem.innerHTML = `
      <div class="file-info">
        <div class="file-name">${escapeHtml(file.name)}</div>
        <div class="file-meta">${file.message_count.toLocaleString()} messages</div>
      </div>
      <div class="file-badge">📁</div>
    `;
    
    fileItem.addEventListener("click", () => {
      loadChatFile(file);
      if (window.innerWidth <= 768) {
        closeSidebar();
      }
    });
    
    fileListEl.appendChild(fileItem);
  });
}

// ── Sidebar Functions ──────────────────────────────────────────────────
function toggleSidebar() {
  sidebar.classList.toggle("open");
  if (sidebar.classList.contains("open")) {
    if (sidebarOverlay) sidebarOverlay.hidden = false;
    document.body.classList.add("sidebar-open");
  } else {
    if (sidebarOverlay) sidebarOverlay.hidden = true;
    document.body.classList.remove("sidebar-open");
  }
}

function closeSidebar() {
  sidebar.classList.remove("open");
  if (sidebarOverlay) sidebarOverlay.hidden = true;
  document.body.classList.remove("sidebar-open");
}

// ── Metadata pre-computation ───────────────────────────────────────────
function buildRenderMeta() {
  let lastDate   = null;
  let lastSender = null;

  renderMeta = allMessages.map((msg, i) => {
    const dateStr  = formatDate(msg.timestamp);
    const showDate = dateStr !== lastDate;
    const isMe     = isOwnMessage(msg.sender);
    const chainTop = !showDate && (msg.sender === lastSender);

    lastDate   = dateStr;
    lastSender = msg.sender;

    return { dateStr, showDate, isMe, chainTop };
  });
}

// ── Chunked rendering ──────────────────────────────────────────────────
function renderBatch(from, to) {
  if (from >= to) return;
  
  currentRenderFile = currentFile;

  const frag = document.createDocumentFragment();

  for (let i = from; i < to; i++) {
    const msg  = allMessages[i];
    const meta = renderMeta[i];

    if (meta.showDate) {
      frag.appendChild(makeDateDivider(meta.dateStr));
    }

    frag.appendChild(makeMessageRow(msg, i, meta.isMe, meta.chainTop));
  }

  messagesEl.appendChild(frag);
  renderedUpTo = to;
  updateProgressBar();

  if (pendingJumpIndex !== null && pendingJumpIndex < renderedUpTo) {
    const jumpIdx = pendingJumpIndex;
    pendingJumpIndex = null;
    finishActivateMatch(jumpIdx);
  }
}

function scheduleIdleRender() {
  const tick = (deadline) => {
    if (currentRenderFile !== currentFile) return;
    
    const hasTime = deadline.timeRemaining
      ? () => deadline.timeRemaining() > IDLE_DEADLINE
      : () => true;

    const end = Math.min(renderedUpTo + IDLE_BATCH, allMessages.length);
    renderBatch(renderedUpTo, end);

    if (renderedUpTo < allMessages.length && currentRenderFile === currentFile) {
      idleHandle = requestIdleCallbackCompat(tick);
    } else if (renderedUpTo >= allMessages.length) {
      markRenderComplete();
    }
  };

  idleHandle = requestIdleCallbackCompat(tick);
}

function renderUpTo(targetIndex) {
  if (targetIndex < renderedUpTo) return;

  if (idleHandle !== null) {
    cancelIdleCallbackCompat(idleHandle);
    idleHandle = null;
  }

  const end = Math.min(targetIndex + 1, allMessages.length);
  renderBatch(renderedUpTo, end);

  if (renderedUpTo < allMessages.length) {
    scheduleIdleRender();
  } else {
    markRenderComplete();
  }
}

function markRenderComplete() {
  renderDone = true;
  if (progressWrap) progressWrap.hidden = true;
}

function updateProgressBar() {
  if (!progressBar || !allMessages.length) return;
  const pct = Math.round((renderedUpTo / allMessages.length) * 100);
  progressBar.style.width = pct + "%";
  if (pct >= 100 && progressWrap) {
    setTimeout(() => { progressWrap.hidden = true; }, 400);
  }
}

// ── requestIdleCallback compatibility ──────────────────────────────────
const requestIdleCallbackCompat = (typeof requestIdleCallback === "function")
  ? (cb) => requestIdleCallback(cb, { timeout: 500 })
  : (cb) => setTimeout(() => cb({ timeRemaining: () => 0 }), 16);

const cancelIdleCallbackCompat = (typeof cancelIdleCallback === "function")
  ? (id) => cancelIdleCallback(id)
  : (id) => clearTimeout(id);

// ── DOM builders ───────────────────────────────────────────────────────
function makeMessageRow(msg, index, isMe, chainTop) {
  const row = document.createElement("div");
  row.className = `msg-row ${isMe ? "me" : "other"}${chainTop ? " chain-top" : ""}`;
  row.dataset.index = index;

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const sender = document.createElement("div");
  sender.className = "msg-sender";
  sender.textContent = msg.sender;
  bubble.appendChild(sender);

  if (msg.is_forwarded && msg.forwarded_from) {
    const fwd = document.createElement("div");
    fwd.className = "fwd-tag";
    fwd.textContent = `Forwarded from ${msg.forwarded_from}`;
    bubble.appendChild(fwd);
  }

  const text = document.createElement("div");
  text.className = "msg-text";
  text.innerHTML = escapeHtml(msg.text || "");
  bubble.appendChild(text);

  const footer = document.createElement("div");
  footer.className = "msg-footer";
  const time = document.createElement("span");
  time.className = "msg-time";
  time.textContent = formatTime(msg.timestamp);
  footer.appendChild(time);
  bubble.appendChild(footer);

  row.appendChild(bubble);
  return row;
}

function makeDateDivider(label) {
  const div  = document.createElement("div");
  div.className = "date-divider";
  const span = document.createElement("span");
  span.textContent = label;
  div.appendChild(span);
  return div;
}

// ── Search with Scope Support ──────────────────────────────────────────
async function runSearch(term) {
  clearHighlights();

  searchTerm = term.trim();
  matches = [];
  currentMatchIndex = 0;
  pendingJumpIndex = null;

  if (!searchTerm) {
    updateCounter();
    setNavEnabled(false);
    return;
  }

  const scopeRadio = document.querySelector('input[name="search-scope"]:checked');
  searchScope = scopeRadio ? scopeRadio.value : "current";

  if (searchScope === "current" && currentFile) {
    const lower = searchTerm.toLowerCase();
    for (let i = 0; i < allMessages.length; i++) {
      if ((allMessages[i].text || "").toLowerCase().includes(lower)) {
        matches.push(i);
      }
    }
    updateCounter();
    setNavEnabled(matches.length > 0);
    
    if (matches.length > 0) {
      applyHighlightsToRenderedMatches();
      activateMatch(0);
    }
  } else if (searchScope === "all") {
    if (allMessagesCache === null) {
      await loadAllMessagesForSearch();
    }
    
    const lower = searchTerm.toLowerCase();
    const results = [];
    
    for (const [fileIdx, file] of availableFiles.entries()) {
      const messages = allMessagesCache[fileIdx];
      for (let i = 0; i < messages.length; i++) {
        if ((messages[i].text || "").toLowerCase().includes(lower)) {
          results.push({
            fileIndex: fileIdx,
            messageIndex: i,
            file: file,
            message: messages[i]
          });
        }
      }
    }
    
    matches = results;
    updateCounter();
    setNavEnabled(matches.length > 0);
    
    if (matches.length > 0) {
      await activateCrossFileMatch(0);
    }
  }
}

async function loadAllMessagesForSearch() {
  console.log("Loading all files for cross-file search...");
  allMessagesCache = [];
  
  for (const file of availableFiles) {
    // 🔥 KEY CHANGE: Fetch from current folder
    const res = await fetch(file.filename);
    const raw = await res.json();
    const messages = decodeColumnar(raw);
    allMessagesCache.push(messages);
  }
  
  console.log(`Loaded ${allMessagesCache.length} files for search`);
}

async function activateCrossFileMatch(newIndex) {
  if (newIndex < 0 || newIndex >= matches.length) return;
  
  currentMatchIndex = newIndex;
  const match = matches[currentMatchIndex];
  
  if (currentFile !== match.file) {
    await loadChatFile(match.file);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  if (match.messageIndex < renderedUpTo) {
    finishActivateMatch(match.messageIndex);
  } else {
    pendingJumpIndex = match.messageIndex;
    renderUpTo(match.messageIndex);
  }
  
  updateCounter();
}

function applyHighlightsToRenderedMatches() {
  if (searchScope === "current") {
    for (let mi = 0; mi < matches.length; mi++) {
      const idx = matches[mi];
      if (idx >= renderedUpTo) continue;
      const row = getRow(idx);
      if (!row) continue;
      const textEl = row.querySelector(".msg-text");
      if (textEl) textEl.innerHTML = highlightText(allMessages[idx].text || "", searchTerm, false);
    }
  }
}

function activateMatch(newIndex) {
  if (matches.length === 0) return;
  
  const prevIdx = matches[currentMatchIndex];
  const prevRow = getRow(prevIdx);
  if (prevRow) {
    prevRow.classList.remove("active-match");
    const textEl = prevRow.querySelector(".msg-text");
    if (textEl && searchScope === "current") {
      textEl.innerHTML = highlightText(allMessages[prevIdx].text || "", searchTerm, false);
    }
  }

  currentMatchIndex = newIndex;
  const idx = matches[currentMatchIndex];

  if (idx >= renderedUpTo) {
    pendingJumpIndex = idx;
    renderUpTo(idx);
    applyHighlightsToRenderedMatches();
    return;
  }

  finishActivateMatch(idx);
}

function finishActivateMatch(idx) {
  const row = getRow(idx);
  if (!row) return;

  row.classList.add("active-match");
  const textEl = row.querySelector(".msg-text");
  if (textEl && searchScope === "current") {
    textEl.innerHTML = highlightText(allMessages[idx].text || "", searchTerm, true);
  }

  row.scrollIntoView({ behavior: "smooth", block: "center" });
  updateCounter();
}

function nextMatch() {
  if (!matches.length) return;
  
  if (searchScope === "all" && typeof matches[currentMatchIndex] === "object") {
    const newIndex = (currentMatchIndex + 1) % matches.length;
    activateCrossFileMatch(newIndex);
  } else {
    activateMatch((currentMatchIndex + 1) % matches.length);
  }
}

function prevMatch() {
  if (!matches.length) return;
  
  if (searchScope === "all" && typeof matches[currentMatchIndex] === "object") {
    const newIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
    activateCrossFileMatch(newIndex);
  } else {
    activateMatch((currentMatchIndex - 1 + matches.length) % matches.length);
  }
}

function clearHighlights() {
  document.querySelectorAll(".msg-row.active-match")
    .forEach(el => el.classList.remove("active-match"));

  document.querySelectorAll(".msg-text mark.highlight").forEach(mark => {
    const textEl = mark.closest(".msg-text");
    if (!textEl) return;
    const row = textEl.closest(".msg-row");
    if (!row) return;
    const idx = parseInt(row.dataset.index, 10);
    if (!isNaN(idx) && allMessages[idx]) {
      textEl.innerHTML = escapeHtml(allMessages[idx].text || "");
    }
  });
}

function highlightText(text, term, isCurrent) {
  if (!term) return escapeHtml(text);

  const escaped     = escapeHtml(text);
  const lowerSrc    = escaped.toLowerCase();
  const lowerTerm   = escapeHtml(term).toLowerCase();
  const len         = lowerTerm.length;

  let result  = "";
  let cursor  = 0;
  let isFirst = true;

  while (cursor < escaped.length) {
    const pos = lowerSrc.indexOf(lowerTerm, cursor);
    if (pos === -1) { result += escaped.slice(cursor); break; }

    result += escaped.slice(cursor, pos);
    const cls = (isCurrent && isFirst) ? "highlight current" : "highlight";
    result += `<mark class="${cls}">${escaped.slice(pos, pos + len)}</mark>`;
    isFirst = false;
    cursor  = pos + len;
  }

  return result;
}

// ── UI helpers ─────────────────────────────────────────────────────────
function updateCounter() {
  if (!searchTerm) { 
    searchCounter.textContent = ""; 
    return; 
  }
  if (!matches.length) { 
    searchCounter.textContent = "No results"; 
    return; 
  }
  
  if (searchScope === "all" && typeof matches[0] === "object") {
    searchCounter.textContent = `${currentMatchIndex + 1} / ${matches.length} across files`;
  } else {
    searchCounter.textContent = `${currentMatchIndex + 1} / ${matches.length}`;
  }
}

function setNavEnabled(on) {
  btnPrev.disabled = !on;
  btnNext.disabled = !on;
}

function getRow(idx) {
  return messagesEl.querySelector(`[data-index="${idx}"]`);
}

// ── Events ─────────────────────────────────────────────────────────────
function bindEvents() {
  let debounceTimer;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(searchInput.value), 300);
  });

  searchInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.shiftKey ? prevMatch() : nextMatch();
    }
    if (e.key === "Escape") {
      searchInput.value = "";
      runSearch("");
    }
  });

  btnNext.addEventListener("click", nextMatch);
  btnPrev.addEventListener("click", prevMatch);
  
  if (menuToggle) {
    menuToggle.addEventListener("click", toggleSidebar);
  }
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener("click", closeSidebar);
  }
  
  document.querySelectorAll('input[name="search-scope"]').forEach(radio => {
    radio.addEventListener("change", () => {
      if (searchTerm) {
        runSearch(searchTerm);
      }
    });
  });
  
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && sidebar.classList.contains("open")) {
      closeSidebar();
    }
  });
}

// ── Timestamp helpers ──────────────────────────────────────────────────
function parseTimestamp(ts) {
  if (!ts) return null;
  const m = ts.match(
    /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+UTC([+-]\d{2}:\d{2})$/
  );
  if (!m) return null;
  const [, dd, mo, yyyy, hh, mm, ss, tz] = m;
  const d = new Date(`${yyyy}-${mo}-${dd}T${hh}:${mm}:${ss}${tz}`);
  return isNaN(d) ? null : d;
}

function formatDate(ts) {
  const d = parseTimestamp(ts);
  if (!d) return ts ? ts.slice(0, 10) : "Unknown date";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatTime(ts) {
  if (!ts) return "";
  const m = ts.match(/(\d{2}:\d{2}):\d{2}/);
  return m ? m[1] : "";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
}

function isOwnMessage(sender) {
  return sender === "Amirhosein";
}

// ── Bootstrap ──────────────────────────────────────────────────────────
(async () => {
  bindEvents();
  await loadFileIndex();
})();
