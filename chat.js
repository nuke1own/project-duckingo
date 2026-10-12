const SIDEBAR_KEY = "duckingo.sidebarCollapsed";
const HISTORY_KEY = "duckingo.chatHistory";
const CHAT_API = "https://duckingo-chat.shelbys-f3d.workers.dev/chat";
const MAX_MESSAGE_LENGTH = 4000;
const REQUEST_TIMEOUT_MS = 45000;
const app = document.getElementById("app");
const menuBtn = document.getElementById("menu-btn");
const sidebarToggle = document.getElementById("sidebar-toggle");
const sidebarClose = document.getElementById("sidebar-close");
const mobileBackdrop = document.getElementById("mobile-backdrop");
const thread = document.getElementById("chat-thread");
const inner = document.getElementById("chat-inner");
const empty = document.getElementById("empty-state");
const form = document.getElementById("composer");
const input = document.getElementById("composer-input");
const sendBtn = document.getElementById("send-btn");
const stopBtn = document.getElementById("stop-btn");
const newChatBtn = document.getElementById("new-chat-btn");
const statusEl = document.getElementById("chat-status");

let history = loadHistory();
let busy = false;
let activeController = null;
let retryText = "";

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string") : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-40)));
  } catch {
    /* Storage may be disabled or full. Chat still works for this session. */
  }
}

function autosize() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

function setStatus(text, announce = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  if (announce) statusEl.setAttribute("aria-live", "assertive");
  else statusEl.setAttribute("aria-live", "polite");
}

function setSendEnabled() {
  sendBtn.disabled = busy || !input.value.trim() || input.value.trim().length > MAX_MESSAGE_LENGTH;
  if (stopBtn) {
    stopBtn.hidden = !busy;
    stopBtn.disabled = !busy;
  }
}

function hideEmpty() {
  document.getElementById("empty-state")?.remove();
}

function scrollThread() {
  thread.scrollTop = thread.scrollHeight;
}

function bubble(role, html, typing = false) {
  const row = document.createElement("article");
  row.className = `msg msg--${role}`;
  row.setAttribute("aria-label", role === "assistant" ? "Duckingo message" : "Your message");
  row.innerHTML = `
    <span class="msg__avatar" aria-hidden="true">${role === "assistant" ? "D" : "You"}</span>
    <div class="msg__stack">
      <p class="msg__who">${role === "assistant" ? "Duckingo" : "You"}</p>
      <div class="msg__bubble">${html}</div>
    </div>
  `;
  if (typing) row.dataset.typing = "true";
  inner.appendChild(row);
  scrollThread();
  return row;
}

function addCopyButton(row, text) {
  if (row.querySelector(".msg__actions")) return;
  const actions = document.createElement("div");
  actions.className = "msg__actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "msg__action";
  copy.textContent = "Copy";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy"; }, 1500);
    } catch {
      copy.textContent = "Copy failed";
    }
  });
  actions.appendChild(copy);
  row.querySelector(".msg__stack")?.appendChild(actions);
}

function setBubbleText(row, text, { error = false } = {}) {
  const body = row.querySelector(".msg__bubble");
  body.replaceChildren();
  const value = String(text).trim() || "No reply.";
  const chunks = value.split(/\n{2,}/);
  for (const chunk of chunks) {
    const p = document.createElement("p");
    p.textContent = chunk;
    body.appendChild(p);
  }
  if (error) {
    row.classList.add("msg--error");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn btn--sm msg__retry";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => send(retryText));
    body.appendChild(retry);
  } else if (row.classList.contains("msg--assistant")) {
    addCopyButton(row, value);
  }
}

async function askGemini(messages, signal) {
  const res = await fetch(CHAT_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
  let data = {};
  try { data = await res.json(); } catch { /* handled below */ }
  if (!res.ok) throw new Error(data.error || `Chat failed (${res.status})`);
  if (!data.text) throw new Error("The assistant returned an empty reply.");
  return data.text;
}

function renderHistory() {
  if (!history.length) return;
  hideEmpty();
  history.forEach((item) => {
    const row = bubble(item.role, "<p></p>");
    setBubbleText(row, item.text);
  });
  scrollThread();
}

async function send(text) {
  const value = String(text || "").trim();
  if (!value || busy) return;
  if (value.length > MAX_MESSAGE_LENGTH) {
    setStatus(`Messages are limited to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters.`, true);
    return;
  }

  hideEmpty();
  busy = true;
  retryText = value;
  setStatus("Duckingo is composing…");
  setSendEnabled();

  const userRow = bubble("user", "<p></p>");
  userRow.querySelector(".msg__bubble p").textContent = value;
  history.push({ role: "user", text: value });
  saveHistory();
  input.value = "";
  autosize();
  setSendEnabled();

  const pending = bubble("assistant", `<p class="typing" aria-label="Duckingo is composing"><span></span><span></span><span></span></p>`, true);
  const controller = new AbortController();
  activeController = controller;
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const reply = await askGemini(history, controller.signal);
    setBubbleText(pending, reply);
    history.push({ role: "assistant", text: reply });
    saveHistory();
    setStatus("Reply ready.");
  } catch (error) {
    const message = error?.name === "AbortError" ? "The request timed out or was stopped. Please try again." : (error instanceof Error ? error.message : "Chat failed. Please try again.");
    setBubbleText(pending, message, { error: true });
    history.pop();
    saveHistory();
    setStatus(message, true);
  } finally {
    clearTimeout(timeout);
    activeController = null;
    delete pending.dataset.typing;
    busy = false;
    setSendEnabled();
    scrollThread();
    input.focus();
  }
}

function applySidebar(collapsed) {
  app.classList.toggle("sidebar-collapsed", collapsed);
  if (sidebarToggle) {
    sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
    sidebarToggle.setAttribute("aria-label", collapsed ? "Expand tools" : "Collapse tools");
    sidebarToggle.textContent = collapsed ? "›" : "‹";
  }
  try { localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0"); } catch { /* ignore */ }
}

function closeMobileMenus() {
  app.classList.remove("nav-open", "sidebar-open");
  menuBtn?.setAttribute("aria-expanded", "false");
  menuBtn?.setAttribute("aria-label", "Open menu");
  mobileBackdrop?.setAttribute("aria-hidden", "true");
}

try { applySidebar(localStorage.getItem(SIDEBAR_KEY) === "1"); } catch { applySidebar(false); }

sidebarToggle?.addEventListener("click", () => applySidebar(!app.classList.contains("sidebar-collapsed")));
sidebarClose?.addEventListener("click", closeMobileMenus);
mobileBackdrop?.addEventListener("click", closeMobileMenus);
menuBtn?.addEventListener("click", () => {
  const open = app.classList.toggle("nav-open");
  menuBtn.setAttribute("aria-expanded", String(open));
  menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
});

document.querySelectorAll(".tool-item, .nav__link").forEach((link) => link.addEventListener("click", closeMobileMenus));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMobileMenus();
});

form.addEventListener("submit", (event) => { event.preventDefault(); send(input.value); });
input.addEventListener("input", () => { autosize(); setSendEnabled(); });
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(input.value); }
});
stopBtn?.addEventListener("click", () => {
  activeController?.abort();
  setStatus("Stopping the request…", true);
});
document.querySelectorAll("[data-prompt]").forEach((btn) => btn.addEventListener("click", () => send(btn.getAttribute("data-prompt") || "")));
window.addEventListener("offline", () => setStatus("You are offline. Reconnect before sending a message.", true));
window.addEventListener("online", () => setStatus("Back online."));

newChatBtn?.addEventListener("click", () => {
  if (busy) activeController?.abort();
  history = [];
  saveHistory();
  inner.replaceChildren();
  const fresh = document.createElement("div");
  fresh.className = "empty";
  fresh.id = "empty-state";
  fresh.innerHTML = `<p class="empty__eyebrow">All your tools, one desk</p><h1 class="empty__title">How can I help you today?</h1><p class="empty__lead">Ask Duckingo to draft, plan, or point you to the right tool.</p><p class="empty__lead">Start with a message below.</p>`;
  inner.appendChild(fresh);
  setStatus("New chat started.");
  input.focus();
});

renderHistory();
autosize();
setSendEnabled();
