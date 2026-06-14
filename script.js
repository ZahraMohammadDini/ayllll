/* ═══════════════════════════════════════════════════════════════════════
   Telegram Chat Viewer — script.js
   Architecture:
     chat.json  →  allMessages[]  →  DOM  (one-way data flow)
     Search runs on allMessages[], not the DOM.
   ═══════════════════════════════════════════════════════════════════════ */

"use strict";

// ── State ──────────────────────────────────────────────────────────────
let allMessages      = [];   // raw data from chat.json
let matches          = [];   // indices into allMessages of search hits
let currentMatchIndex = 0;
let searchTerm       = "";

// ── DOM refs ───────────────────────────────────────────────────────────
const messagesEl   = document.getElementById("messages");
const loadingEl    = document.getElementById("loading");
const errorEl      = document.getElementById("error");
const searchInput  = document.getElementById("search-input");
const searchCounter= document.getElementById("search-counter");
const btnPrev      = document.getElementById("btn-prev");
const btnNext      = document.getElementById("btn-next");

// ── Boot ───────────────────────────────────────────────────────────────
(async () => {
  try {
    const res = await fetch("chat.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allMessages = await res.json();
  } catch (e) {
    console.error("Failed to load chat.json:", e);
    loadingEl.hidden = true;
    errorEl.hidden   = false;
    return;
  }

  loadingEl.hidden = true;
  renderAll();
  bindEvents();
})();

// ── Rendering ──────────────────────────────────────────────────────────

function renderAll() {
  const frag = document.createDocumentFragment();
  let lastDate   = null;
  let lastSender = null;

  allMessages.forEach((msg, i) => {
    // Date divider
    const dateStr = formatDate(msg.timestamp);
    if (dateStr !== lastDate) {
      frag.appendChild(makeDateDivider(dateStr));
      lastDate   = dateStr;
      lastSender = null; // reset chain on new date
    }

    // Chain detection: same sender, consecutive
    const isMe       = isOwnMessage(msg.sender);
    const chainTop   = (msg.sender === lastSender);
    lastSender       = msg.sender;

    const row = makeMessageRow(msg, i, isMe, chainTop);
    frag.appendChild(row);
  });

  messagesEl.appendChild(frag);
}

function makeMessageRow(msg, index, isMe, chainTop) {
  const row = document.createElement("div");
  row.className = `msg-row ${isMe ? "me" : "other"}${chainTop ? " chain-top" : ""}`;
  row.dataset.index = index;

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  // Sender name (hidden for chained messages via CSS)
  const sender = document.createElement("div");
  sender.className = "msg-sender";
  sender.textContent = msg.sender;
  bubble.appendChild(sender);

  // Forwarded label
  if (msg.is_forwarded && msg.forwarded_from) {
    const fwd = document.createElement("div");
    fwd.className = "fwd-tag";
    fwd.textContent = `Forwarded from ${msg.forwarded_from}`;
    bubble.appendChild(fwd);
  }

  // Message text
  const text = document.createElement("div");
  text.className = "msg-text";
  text.innerHTML = escapeHtml(msg.text || "");
  bubble.appendChild(text);

  // Timestamp
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
  const div = document.createElement("div");
  div.className = "date-divider";
  const span = document.createElement("span");
  span.textContent = label;
  div.appendChild(span);
  return div;
}

// ── Search ─────────────────────────────────────────────────────────────

function runSearch(term) {
  // 1. Clear previous highlights from DOM
  clearHighlights();

  searchTerm       = term.trim();
  matches          = [];
  currentMatchIndex = 0;

  if (!searchTerm) {
    updateCounter();
    setNavEnabled(false);
    return;
  }

  const lower = searchTerm.toLowerCase();

  // 2. Scan data model
  allMessages.forEach((msg, i) => {
    if ((msg.text || "").toLowerCase().includes(lower)) {
      matches.push(i);
    }
  });

  updateCounter();
  setNavEnabled(matches.length > 0);

  if (matches.length === 0) return;

  // 3. Apply highlights to matching DOM nodes
  matches.forEach(idx => {
    const row = getRow(idx);
    if (!row) return;
    const textEl = row.querySelector(".msg-text");
    if (textEl) textEl.innerHTML = highlightText(allMessages[idx].text || "", searchTerm, false);
  });

  // 4. Jump to first match
  activateMatch(0);
}

function activateMatch(newIndex) {
  // Deactivate previous active row styling
  if (matches.length > 0) {
    const prevIdx = matches[currentMatchIndex];
    const prevRow = getRow(prevIdx);
    if (prevRow) {
      prevRow.classList.remove("active-match");
      const textEl = prevRow.querySelector(".msg-text");
      if (textEl) textEl.innerHTML = highlightText(allMessages[prevIdx].text || "", searchTerm, false);
    }
  }

  currentMatchIndex = newIndex;
  const idx = matches[currentMatchIndex];
  const row = getRow(idx);
  if (!row) return;

  // Mark row as active
  row.classList.add("active-match");

  // Re-render text with the current match styled as 'current'
  const textEl = row.querySelector(".msg-text");
  if (textEl) textEl.innerHTML = highlightText(allMessages[idx].text || "", searchTerm, true);

  // Scroll
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  updateCounter();
}

function nextMatch() {
  if (!matches.length) return;
  const next = (currentMatchIndex + 1) % matches.length;
  activateMatch(next);
}

function prevMatch() {
  if (!matches.length) return;
  const prev = (currentMatchIndex - 1 + matches.length) % matches.length;
  activateMatch(prev);
}

function clearHighlights() {
  // Remove active-match class from all rows
  document.querySelectorAll(".msg-row.active-match").forEach(el => el.classList.remove("active-match"));
  // Restore text for all rows that had highlights
  document.querySelectorAll(".msg-text mark.highlight").forEach(mark => {
    const parent = mark.closest(".msg-text");
    if (!parent) return;
    const row = parent.closest(".msg-row");
    if (!row) return;
    const idx = parseInt(row.dataset.index, 10);
    if (!isNaN(idx) && allMessages[idx]) {
      parent.innerHTML = escapeHtml(allMessages[idx].text || "");
    }
  });
}

// ── Highlight Helpers ──────────────────────────────────────────────────

/**
 * Returns HTML string with all occurrences of `term` in `text` wrapped in
 * <mark class="highlight [current]">.  The first occurrence gets 'current'
 * when isCurrent is true (used for the active match row).
 */
function highlightText(text, term, isCurrent) {
  if (!term) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const lowerEscaped = escaped.toLowerCase();
  const lowerTerm    = escapeHtml(term).toLowerCase();
  const len          = lowerTerm.length;

  let result  = "";
  let cursor  = 0;
  let isFirst = true;

  while (cursor < escaped.length) {
    const pos = lowerEscaped.indexOf(lowerTerm, cursor);
    if (pos === -1) { result += escaped.slice(cursor); break; }

    result += escaped.slice(cursor, pos);
    const cls = (isCurrent && isFirst) ? "highlight current" : "highlight";
    result += `<mark class="${cls}">${escaped.slice(pos, pos + len)}</mark>`;
    isFirst = false;
    cursor  = pos + len;
  }

  return result;
}

// ── UI Helpers ─────────────────────────────────────────────────────────

function updateCounter() {
  if (!searchTerm) {
    searchCounter.textContent = "";
    return;
  }
  if (matches.length === 0) {
    searchCounter.textContent = "No results";
    return;
  }
  searchCounter.textContent = `${currentMatchIndex + 1} / ${matches.length}`;
}

function setNavEnabled(enabled) {
  btnPrev.disabled = !enabled;
  btnNext.disabled = !enabled;
}

function getRow(idx) {
  return messagesEl.querySelector(`[data-index="${idx}"]`);
}

// ── Event Binding ──────────────────────────────────────────────────────

function bindEvents() {
  // Debounce search input
  let debounceTimer;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(searchInput.value), 180);
  });

  // Enter = next match
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
}

// ── Date / Time Formatting ─────────────────────────────────────────────

/**
 * Parse timestamp like "12.05.2020 01:01:12 UTC+03:30"
 * Returns a Date object in UTC.
 */
function parseTimestamp(ts) {
  if (!ts) return null;
  // "DD.MM.YYYY HH:MM:SS UTC±HH:MM"
  const m = ts.match(
    /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+UTC([+-]\d{2}:\d{2})$/
  );
  if (!m) return null;

  const [, dd, mo, yyyy, hh, mm, ss, tz] = m;
  const isoStr = `${yyyy}-${mo}-${dd}T${hh}:${mm}:${ss}${tz}`;
  const d = new Date(isoStr);
  return isNaN(d) ? null : d;
}

/** Returns a human-readable date string like "May 12, 2020" */
function formatDate(ts) {
  const d = parseTimestamp(ts);
  if (!d) return ts ? ts.slice(0, 10) : "Unknown date";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** Returns HH:MM from the timestamp */
function formatTime(ts) {
  if (!ts) return "";
  const d = parseTimestamp(ts);
  if (!d) {
    // fallback: extract time part from raw string
    const m = ts.match(/(\d{2}:\d{2}):\d{2}/);
    return m ? m[1] : "";
  }
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: extractTZ(ts)
  });
}

/** Extract an IANA-compatible offset string for toLocaleTimeString */
function extractTZ(ts) {
  // We can't easily pass a raw offset to toLocaleTimeString,
  // so we calculate UTC time and display as UTC.
  return "UTC";
}

// ── Security ───────────────────────────────────────────────────────────

/** Escape HTML to prevent XSS from message text. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
}

/** Checks if a sender name represents the "me" side. */
function isOwnMessage(sender) {
  return sender === "Amirhosein";
}
