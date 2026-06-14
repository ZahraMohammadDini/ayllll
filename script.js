/* ═══════════════════════════════════════════════════════════════════════
   Telegram Chat Viewer — script.js
   Architecture:
     chat.json  →  allMessages[]  →  DOM  (one-way data flow)
     Search    →  runs on allMessages[] only, never the DOM
     Rendering →  chunked progressive via requestIdleCallback / setTimeout
                  so the page is interactive within ~100ms of data load
   ═══════════════════════════════════════════════════════════════════════ */

"use strict";

// ── Tuning constants ───────────────────────────────────────────────────
const INITIAL_BATCH  = 300;   // messages rendered synchronously on boot
const IDLE_BATCH     = 500;   // messages per idle callback chunk
const IDLE_DEADLINE  = 40;    // ms budget per idle chunk (leave slack for browser)

// ── Global state ───────────────────────────────────────────────────────
let allMessages       = [];   // full dataset — never mutated
let renderedUpTo      = 0;    // index of last rendered message + 1
let renderDone        = false;// true once all messages are in the DOM

// Pre-computed per-message render context (date label, isMe, chainTop)
// Built once after data loads so rendering loops stay cheap.
let renderMeta        = [];   // parallel array to allMessages

// Search state — always operates on allMessages[], not the DOM
let matches           = [];
let currentMatchIndex = 0;
let searchTerm        = "";

// Pending "jump to match" — set when activateMatch targets an unrendered msg
let pendingJumpIndex  = null;

// Background render scheduler handle (so we can cancel on demand)
let idleHandle        = null;

// ── DOM refs ───────────────────────────────────────────────────────────
const messagesEl    = document.getElementById("messages");
const loadingEl     = document.getElementById("loading");
const errorEl       = document.getElementById("error");
const progressBar   = document.getElementById("progress-bar");
const progressWrap  = document.getElementById("progress-wrap");
const searchInput   = document.getElementById("search-input");
const searchCounter = document.getElementById("search-counter");
const btnPrev       = document.getElementById("btn-prev");
const btnNext       = document.getElementById("btn-next");

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

  // Pre-compute metadata for every message (O(n) single pass, very fast)
  buildRenderMeta();

  loadingEl.hidden = true;

  // Render first batch synchronously — user sees messages immediately
  renderBatch(0, Math.min(INITIAL_BATCH, allMessages.length));

  // Enable search right away (full dataset is in memory)
  bindEvents();

  // Schedule remaining messages in the background
  if (renderedUpTo < allMessages.length) {
    if (progressWrap) progressWrap.hidden = false;
    scheduleIdleRender();
  } else {
    markRenderComplete();
  }
})();

// ── Metadata pre-computation ───────────────────────────────────────────
// One O(n) pass to resolve date labels, isMe, and chain detection.
// This lets renderBatch() stay allocation-light with no repeated string ops.

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

/**
 * Renders messages [from, to) into the DOM.
 * Uses a DocumentFragment for a single reflow per call.
 */
function renderBatch(from, to) {
  if (from >= to) return;

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

  // If a search jump was waiting for this range, action it now
  if (pendingJumpIndex !== null && pendingJumpIndex < renderedUpTo) {
    const jumpIdx = pendingJumpIndex;
    pendingJumpIndex = null;
    finishActivateMatch(jumpIdx);
  }
}

/**
 * Schedules background rendering via requestIdleCallback (or setTimeout fallback).
 * Each callback renders up to IDLE_BATCH messages if there's deadline budget,
 * then re-schedules itself until all messages are rendered.
 */
function scheduleIdleRender() {
  const tick = (deadline) => {
    // deadline.timeRemaining() is 0 when using the setTimeout fallback
    const hasTime = deadline.timeRemaining
      ? () => deadline.timeRemaining() > IDLE_DEADLINE
      : () => true;

    const end = Math.min(renderedUpTo + IDLE_BATCH, allMessages.length);
    renderBatch(renderedUpTo, end);

    if (renderedUpTo < allMessages.length) {
      idleHandle = requestIdleCallbackCompat(tick);
    } else {
      markRenderComplete();
    }
  };

  idleHandle = requestIdleCallbackCompat(tick);
}

/**
 * Force-render all messages up to (and including) targetIndex synchronously.
 * Called when a search match targets an unrendered message.
 */
function renderUpTo(targetIndex) {
  if (targetIndex < renderedUpTo) return; // already rendered

  // Cancel any in-flight idle render — we're doing it synchronously now
  if (idleHandle !== null) {
    cancelIdleCallbackCompat(idleHandle);
    idleHandle = null;
  }

  const end = Math.min(targetIndex + 1, allMessages.length);
  renderBatch(renderedUpTo, end);

  // Re-schedule the rest in background (from where we left off)
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
    // small delay so the bar visually completes before hiding
    setTimeout(() => { progressWrap.hidden = true; }, 400);
  }
}

// ── requestIdleCallback compatibility shim ─────────────────────────────

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

// ── Search ─────────────────────────────────────────────────────────────
// Always scans allMessages[] — works regardless of render progress.

function runSearch(term) {
  clearHighlights();

  searchTerm        = term.trim();
  matches           = [];
  currentMatchIndex = 0;
  pendingJumpIndex  = null;

  if (!searchTerm) {
    updateCounter();
    setNavEnabled(false);
    return;
  }

  const lower = searchTerm.toLowerCase();

  // Full dataset scan — O(n) string search
  for (let i = 0; i < allMessages.length; i++) {
    if ((allMessages[i].text || "").toLowerCase().includes(lower)) {
      matches.push(i);
    }
  }

  updateCounter();
  setNavEnabled(matches.length > 0);

  if (matches.length === 0) return;

  // Highlight all already-rendered matches
  applyHighlightsToRenderedMatches();

  // Jump to first match (may trigger renderUpTo if not yet rendered)
  activateMatch(0);
}

/**
 * Apply non-active highlight markup to every match whose row is already in DOM.
 * Skips unrendered rows silently — they'll get highlighted when rendered
 * (we re-apply after renderBatch if a pending jump caused sync rendering).
 */
function applyHighlightsToRenderedMatches() {
  for (let mi = 0; mi < matches.length; mi++) {
    const idx = matches[mi];
    if (idx >= renderedUpTo) continue; // not yet rendered
    const row = getRow(idx);
    if (!row) continue;
    const textEl = row.querySelector(".msg-text");
    if (textEl) textEl.innerHTML = highlightText(allMessages[idx].text || "", searchTerm, false);
  }
}

function activateMatch(newIndex) {
  // Deactivate previous
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

  if (idx >= renderedUpTo) {
    // Target message not yet in DOM — render up to it synchronously,
    // then finalize in finishActivateMatch (called from renderBatch).
    pendingJumpIndex = idx;
    renderUpTo(idx);
    // After renderUpTo, re-apply highlights to newly rendered range
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
  if (textEl) textEl.innerHTML = highlightText(allMessages[idx].text || "", searchTerm, true);

  row.scrollIntoView({ behavior: "smooth", block: "center" });
  updateCounter();
}

function nextMatch() {
  if (!matches.length) return;
  activateMatch((currentMatchIndex + 1) % matches.length);
}

function prevMatch() {
  if (!matches.length) return;
  activateMatch((currentMatchIndex - 1 + matches.length) % matches.length);
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

// ── Highlight builder ──────────────────────────────────────────────────

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
  if (!searchTerm)          { searchCounter.textContent = ""; return; }
  if (!matches.length)      { searchCounter.textContent = "No results"; return; }
  searchCounter.textContent = `${currentMatchIndex + 1} / ${matches.length}`;
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
    debounceTimer = setTimeout(() => runSearch(searchInput.value), 180);
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

// ── Security ───────────────────────────────────────────────────────────

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
