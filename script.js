"use strict";

let currentFile = null;
let allMessages = [];
let renderedUpTo = 0;
let availableFiles = [];
let matches = [];
let currentMatchIndex = 0;
let searchTerm = "";

// DOM elements
const messagesEl = document.getElementById("messages");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");
const searchInput = document.getElementById("search-input");
const searchCounter = document.getElementById("search-counter");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const fileListEl = document.getElementById("file-list");
const totalMessagesSpan = document.getElementById("total-messages");
const sidebar = document.getElementById("sidebar");
const menuToggle = document.getElementById("menu-toggle");
const sidebarOverlay = document.getElementById("sidebar-overlay");

// Load index file
async function loadIndex() {
  try {
    const res = await fetch("index.json");
    if (!res.ok) throw new Error("Index not found");
    const data = await res.json();
    availableFiles = data.files || [];
    
    if (availableFiles.length === 0) {
      throw new Error("No files found");
    }
    
    renderFileList();
    await loadFile(availableFiles[0]);
  } catch (err) {
    console.error(err);
    loadingEl.hidden = true;
    errorEl.hidden = false;
  }
}

// Render sidebar file list
function renderFileList() {
  fileListEl.innerHTML = "";
  
  availableFiles.forEach(file => {
    const div = document.createElement("div");
    div.className = "file-item";
    div.innerHTML = `
      <div>
        <div class="file-name">${escapeHtml(file.name)}</div>
        <div class="file-meta">${file.message_count.toLocaleString()} messages</div>
      </div>
      <div class="file-badge">📁</div>
    `;
    div.onclick = () => loadFile(file);
    fileListEl.appendChild(div);
  });
}

// Load a specific file
async function loadFile(file) {
  loadingEl.hidden = false;
  errorEl.hidden = true;
  messagesEl.innerHTML = "";
  renderedUpTo = 0;
  
  currentFile = file;
  
  // Update active state in sidebar
  document.querySelectorAll(".file-item").forEach(el => el.classList.remove("active"));
  event?.target?.closest(".file-item")?.classList?.add("active");
  
  try {
    const res = await fetch(file.filename);
    if (!res.ok) throw new Error("File not found");
    const data = await res.json();
    
    allMessages = decodeMessages(data);
    totalMessagesSpan.textContent = `${allMessages.length.toLocaleString()} messages`;
    
    loadingEl.hidden = true;
    renderBatch(0, Math.min(100, allMessages.length));
    
    // Render remaining in background
    if (renderedUpTo < allMessages.length) {
      setTimeout(() => renderRemaining(), 100);
    }
    
    // Clear search
    searchInput.value = "";
    clearSearch();
  } catch (err) {
    console.error(err);
    loadingEl.hidden = true;
    errorEl.hidden = false;
  }
}

// Decode columnar format
function decodeMessages(data) {
  if (Array.isArray(data)) return data;
  
  if (data.v === 1 && data.fields && data.rows) {
    return data.rows.map(row => {
      const msg = {};
      data.fields.forEach((field, i) => {
        msg[field] = row[i];
      });
      msg.is_forwarded = !!msg.is_forwarded;
      return msg;
    });
  }
  
  return [];
}

// Render messages in batches
function renderBatch(start, end) {
  const fragment = document.createDocumentFragment();
  
  for (let i = start; i < end && i < allMessages.length; i++) {
    const msg = allMessages[i];
    const prevMsg = allMessages[i - 1];
    
    // Add date divider if needed
    const currentDate = formatDate(msg.timestamp);
    const prevDate = prevMsg ? formatDate(prevMsg.timestamp) : null;
    if (currentDate !== prevDate) {
      const divider = document.createElement("div");
      divider.className = "date-divider";
      divider.innerHTML = `<span>${currentDate}</span>`;
      fragment.appendChild(divider);
    }
    
    // Create message row
    const isMe = msg.sender === "Amirhosein";
    const sameSender = prevMsg && prevMsg.sender === msg.sender;
    
    const row = document.createElement("div");
    row.className = `msg-row ${isMe ? "me" : "other"}`;
    if (sameSender) row.classList.add("chain-top");
    row.dataset.index = i;
    
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    
    if (!sameSender) {
      const sender = document.createElement("div");
      sender.className = "msg-sender";
      sender.textContent = msg.sender;
      bubble.appendChild(sender);
    }
    
    if (msg.is_forwarded && msg.forwarded_from) {
      const fwd = document.createElement("div");
      fwd.className = "fwd-tag";
      fwd.textContent = `Forwarded from ${msg.forwarded_from}`;
      bubble.appendChild(fwd);
    }
    
    const text = document.createElement("div");
    text.className = "msg-text";
    text.textContent = msg.text || "";
    bubble.appendChild(text);
    
    const footer = document.createElement("div");
    footer.className = "msg-footer";
    const time = document.createElement("span");
    time.className = "msg-time";
    time.textContent = formatTime(msg.timestamp);
    footer.appendChild(time);
    bubble.appendChild(footer);
    
    row.appendChild(bubble);
    fragment.appendChild(row);
  }
  
  messagesEl.appendChild(fragment);
  renderedUpTo = end;
}

function renderRemaining() {
  if (renderedUpTo >= allMessages.length) return;
  const nextBatch = Math.min(renderedUpTo + 200, allMessages.length);
  renderBatch(renderedUpTo, nextBatch);
  if (renderedUpTo < allMessages.length) {
    setTimeout(renderRemaining, 50);
  }
}

// Search functionality
function searchMessages() {
  const term = searchInput.value.trim().toLowerCase();
  
  if (!term) {
    clearSearch();
    return;
  }
  
  searchTerm = term;
  matches = [];
  
  for (let i = 0; i < allMessages.length; i++) {
    const text = (allMessages[i].text || "").toLowerCase();
    if (text.includes(term)) {
      matches.push(i);
    }
  }
  
  currentMatchIndex = 0;
  updateSearchCounter();
  
  if (matches.length > 0) {
    highlightMatches();
    goToMatch(0);
    btnPrev.disabled = false;
    btnNext.disabled = false;
  } else {
    searchCounter.textContent = "No results";
    btnPrev.disabled = true;
    btnNext.disabled = true;
  }
}

function highlightMatches() {
  // Clear existing highlights
  document.querySelectorAll(".msg-text").forEach(el => {
    const original = el.getAttribute("data-original");
    if (original) {
      el.textContent = original;
      el.removeAttribute("data-original");
    }
  });
  
  // Apply new highlights
  matches.forEach((idx, matchIdx) => {
    const row = document.querySelector(`[data-index="${idx}"]`);
    if (!row) return;
    
    const textEl = row.querySelector(".msg-text");
    if (!textEl) return;
    
    const original = textEl.textContent;
    textEl.setAttribute("data-original", original);
    
    const regex = new RegExp(`(${escapeRegex(searchTerm)})`, "gi");
    const highlighted = original.replace(regex, `<mark class="highlight${matchIdx === currentMatchIndex ? ' current' : ''}">$1</mark>`);
    textEl.innerHTML = highlighted;
  });
}

function goToMatch(index) {
  if (index < 0 || index >= matches.length) return;
  
  currentMatchIndex = index;
  const msgIndex = matches[currentMatchIndex];
  
  // Remove current highlight from all
  document.querySelectorAll(".msg-row").forEach(el => el.classList.remove("active-match"));
  document.querySelectorAll("mark.highlight").forEach(el => el.classList.remove("current"));
  
  // Add current highlight
  const row = document.querySelector(`[data-index="${msgIndex}"]`);
  if (row) {
    row.classList.add("active-match");
    const mark = row.querySelector("mark.highlight");
    if (mark) mark.classList.add("current");
    row.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  
  updateSearchCounter();
}

function nextMatch() {
  if (matches.length === 0) return;
  const next = (currentMatchIndex + 1) % matches.length;
  goToMatch(next);
  highlightMatches();
}

function prevMatch() {
  if (matches.length === 0) return;
  const prev = (currentMatchIndex - 1 + matches.length) % matches.length;
  goToMatch(prev);
  highlightMatches();
}

function clearSearch() {
  searchTerm = "";
  matches = [];
  currentMatchIndex = 0;
  searchCounter.textContent = "";
  btnPrev.disabled = true;
  btnNext.disabled = true;
  
  // Restore original text
  document.querySelectorAll(".msg-text").forEach(el => {
    const original = el.getAttribute("data-original");
    if (original) {
      el.textContent = original;
      el.removeAttribute("data-original");
    }
  });
  
  document.querySelectorAll(".msg-row").forEach(el => el.classList.remove("active-match"));
}

function updateSearchCounter() {
  if (matches.length === 0) {
    searchCounter.textContent = "";
  } else {
    searchCounter.textContent = `${currentMatchIndex + 1}/${matches.length}`;
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// Date helpers
function formatDate(ts) {
  if (!ts) return "Unknown";
  const match = ts.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    const date = new Date(`${year}-${month}-${day}`);
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
  return ts.split(" ")[0] || "Unknown";
}

function formatTime(ts) {
  if (!ts) return "";
  const match = ts.match(/(\d{2}:\d{2}):\d{2}/);
  return match ? match[1] : "";
}

// Sidebar toggle
function toggleSidebar() {
  sidebar.classList.toggle("open");
  if (sidebarOverlay) {
    sidebarOverlay.classList.toggle("visible");
  }
}

// Event listeners
searchInput.addEventListener("input", () => {
  setTimeout(searchMessages, 200);
});
btnPrev.addEventListener("click", prevMatch);
btnNext.addEventListener("click", nextMatch);
menuToggle.addEventListener("click", toggleSidebar);
if (sidebarOverlay) {
  sidebarOverlay.addEventListener("click", toggleSidebar);
}

// Initialize
loadIndex();
