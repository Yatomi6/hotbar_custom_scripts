const elements = {
  startedAt: document.getElementById("started-at"),
  elapsed: document.getElementById("elapsed"),
  lastUpdated: document.getElementById("last-updated"),
  refresh: document.getElementById("refresh"),
  clicks: document.getElementById("stat-clicks"),
  mouse: document.getElementById("stat-mouse"),
  pad: document.getElementById("stat-pad"),
  keys: document.getElementById("stat-keys"),
  scrollV: document.getElementById("stat-scroll-v"),
  scrollH: document.getElementById("stat-scroll-h"),
  distance: document.getElementById("stat-distance"),
  distanceMeters: document.getElementById("stat-distance-m"),
  clickGrid: document.getElementById("click-grid"),
  clickToggle: document.getElementById("click-toggle"),
  keyMeta: document.getElementById("key-meta"),
  keyboard: document.getElementById("keyboard"),
};

const CLICK_COLS = 96;
const CLICK_ROWS = 54;
const DEFAULT_STATS = {
  date: "",
  startedAt: Date.now(),
  left: 0,
  right: 0,
  leftMouse: 0,
  rightMouse: 0,
  leftPad: 0,
  rightPad: 0,
  keys: 0,
  scrollUp: 0,
  scrollDown: 0,
  scrollLeft: 0,
  scrollRight: 0,
  distancePx: 0,
  screenWidth: 0,
  screenHeight: 0,
  clickHeatmapLeft: Array.from({ length: CLICK_COLS * CLICK_ROWS }, () => 0),
  clickHeatmapRight: Array.from({ length: CLICK_COLS * CLICK_ROWS }, () => 0),
  keyCounts: {},
  updated_at: 0,
};

const KEY_LAYOUT = [
  [
    { id: "KEY_ESC", label: "Esc" },
    { id: "KEY_F1", label: "F1" },
    { id: "KEY_F2", label: "F2" },
    { id: "KEY_F3", label: "F3" },
    { id: "KEY_F4", label: "F4" },
    { id: "KEY_F5", label: "F5" },
    { id: "KEY_F6", label: "F6" },
    { id: "KEY_F7", label: "F7" },
    { id: "KEY_F8", label: "F8" },
    { id: "KEY_F9", label: "F9" },
    { id: "KEY_F10", label: "F10" },
    { id: "KEY_F11", label: "F11" },
    { id: "KEY_F12", label: "F12" },
  ],
  [
    { id: "KEY_GRAVE", label: "²" },
    { id: "KEY_1", label: "&" },
    { id: "KEY_2", label: "é" },
    { id: "KEY_3", label: '"' },
    { id: "KEY_4", label: "'" },
    { id: "KEY_5", label: "(" },
    { id: "KEY_6", label: "-" },
    { id: "KEY_7", label: "è" },
    { id: "KEY_8", label: "_" },
    { id: "KEY_9", label: "ç" },
    { id: "KEY_0", label: "à" },
    { id: "KEY_MINUS", label: ")" },
    { id: "KEY_EQUAL", label: "=" },
    { id: "KEY_BACKSPACE", label: "Back", span: 2 },
  ],
  [
    { id: "KEY_TAB", label: "Tab", span: 1.4 },
    { id: "KEY_Q", label: "A" },
    { id: "KEY_W", label: "Z" },
    { id: "KEY_E", label: "E" },
    { id: "KEY_R", label: "R" },
    { id: "KEY_T", label: "T" },
    { id: "KEY_Y", label: "Y" },
    { id: "KEY_U", label: "U" },
    { id: "KEY_I", label: "I" },
    { id: "KEY_O", label: "O" },
    { id: "KEY_P", label: "P" },
    { id: "KEY_LEFTBRACE", label: "^" },
    { id: "KEY_RIGHTBRACE", label: "$" },
    { id: "KEY_BACKSLASH", label: "*" },
  ],
  [
    { id: "KEY_CAPSLOCK", label: "Caps", span: 1.6 },
    { id: "KEY_A", label: "Q" },
    { id: "KEY_S", label: "S" },
    { id: "KEY_D", label: "D" },
    { id: "KEY_F", label: "F" },
    { id: "KEY_G", label: "G" },
    { id: "KEY_H", label: "H" },
    { id: "KEY_J", label: "J" },
    { id: "KEY_K", label: "K" },
    { id: "KEY_L", label: "L" },
    { id: "KEY_SEMICOLON", label: "M" },
    { id: "KEY_APOSTROPHE", label: "ù" },
    { id: "KEY_ENTER", label: "Enter", span: 2 },
  ],
  [
    { id: "KEY_LEFTSHIFT", label: "Shift", span: 2.2 },
    { id: "KEY_102ND", label: "<" },
    { id: "KEY_Z", label: "W" },
    { id: "KEY_X", label: "X" },
    { id: "KEY_C", label: "C" },
    { id: "KEY_V", label: "V" },
    { id: "KEY_B", label: "B" },
    { id: "KEY_N", label: "N" },
    { id: "KEY_M", label: "," },
    { id: "KEY_COMMA", label: ";" },
    { id: "KEY_DOT", label: ":" },
    { id: "KEY_SLASH", label: "!" },
    { id: "KEY_RIGHTSHIFT", label: "Shift", span: 2.2 },
  ],
  [
    { id: "KEY_LEFTCTRL", label: "Ctrl", span: 1.4 },
    { id: "KEY_LEFTMETA", label: "Meta", span: 1.4 },
    { id: "KEY_LEFTALT", label: "Alt", span: 1.4 },
    { id: "KEY_SPACE", label: "Space", span: 6 },
    { id: "KEY_RIGHTALT", label: "Alt", span: 1.4 },
    { id: "KEY_RIGHTMETA", label: "Meta", span: 1.4 },
    { id: "KEY_MENU", label: "Menu", span: 1.4 },
    { id: "KEY_RIGHTCTRL", label: "Ctrl", span: 1.4 },
  ],
];

const keyElements = new Map();
const clickCells = [];
let currentMode = "left";
let currentData = DEFAULT_STATS;
let activePing = null;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function heatColor(ratio, isMax) {
  const t = Math.pow(clamp(ratio), 0.7);
  const low = [43, 48, 60];
  const high = isMax ? [208, 135, 240] : [191, 97, 106];
  return `rgb(${mix(low[0], high[0], t)}, ${mix(low[1], high[1], t)}, ${mix(low[2], high[2], t)})`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("fr-FR");
}

function formatDistanceMeters(px) {
  if (!Number.isFinite(px)) return "0.0 m";
  const inches = px / 96;
  const meters = inches * 0.0254;
  if (meters >= 1000) return `${meters / 1000 > 9.9 ? (meters / 1000).toFixed(1) : (meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(1)} m`;
}

function formatScroll(value) {
  return Number(value || 0).toFixed(1);
}

function formatDate(ms) {
  if (!ms) return "-";
  const date = new Date(ms);
  return date.toLocaleString("fr-FR", { hour12: false });
}

function formatElapsed(ms) {
  if (!ms) return "-";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  return `${days}j ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildKeyboard() {
  elements.keyboard.innerHTML = "";
  keyElements.clear();

  KEY_LAYOUT.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "key-row";
    row.forEach((key) => {
      const keyEl = document.createElement("div");
      keyEl.className = "key";
      keyEl.dataset.key = key.id;
      keyEl.style.setProperty("--span", key.span || 1);
      keyEl.textContent = key.label;
      rowEl.appendChild(keyEl);
      keyElements.set(key.id, keyEl);
    });
    elements.keyboard.appendChild(rowEl);
  });
}

function buildClickGrid() {
  elements.clickGrid.style.setProperty("--cols", CLICK_COLS);
  elements.clickGrid.style.setProperty("--rows", CLICK_ROWS);
  elements.clickGrid.innerHTML = "";
  clickCells.length = 0;
  for (let i = 0; i < CLICK_COLS * CLICK_ROWS; i += 1) {
    const cell = document.createElement("div");
    cell.className = "click-cell";
    elements.clickGrid.appendChild(cell);
    clickCells.push(cell);
  }
}

function setMode(mode) {
  currentMode = mode;
  elements.clickToggle.querySelectorAll(".toggle-btn").forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  renderClickHeatmap();
}

function updateClickGridSize() {
  const ratio =
    currentData.screenWidth && currentData.screenHeight
      ? currentData.screenWidth / currentData.screenHeight
      : CLICK_COLS / CLICK_ROWS;
  const width = elements.clickGrid.clientWidth || 1;
  const height = Math.max(140, Math.round(width / ratio));
  elements.clickGrid.style.setProperty("--grid-height", `${height}px`);
}

function renderSummary(data) {
  elements.clicks.textContent = `${formatNumber(data.left)} | ${formatNumber(data.right)}`;
  elements.mouse.textContent = `${formatNumber(data.leftMouse)} | ${formatNumber(data.rightMouse)}`;
  elements.pad.textContent = `${formatNumber(data.leftPad)} | ${formatNumber(data.rightPad)}`;
  elements.keys.textContent = formatNumber(data.keys);
  elements.scrollV.textContent = `${formatScroll(data.scrollUp)} / ${formatScroll(data.scrollDown)}`;
  elements.scrollH.textContent = `${formatScroll(data.scrollLeft)} / ${formatScroll(data.scrollRight)}`;
  elements.distance.textContent = formatNumber(Math.round(data.distancePx || 0));
  const meters = formatDistanceMeters(data.distancePx || 0);
  if (elements.distanceMeters) {
    elements.distanceMeters.textContent = meters;
  }
}

function renderMeta(data) {
  elements.startedAt.textContent = `Start: ${formatDate(data.startedAt)}`;
  const elapsedMs = data.startedAt ? Date.now() - data.startedAt : 0;
  elements.elapsed.textContent = `Elapsed: ${formatElapsed(elapsedMs)}`;
  const updated = data.updated_at ? new Date(data.updated_at * 1000) : new Date();
  elements.lastUpdated.textContent = `Last update: ${updated.toLocaleTimeString("fr-FR", { hour12: false })}`;
}

function renderClickHeatmap() {
  const map = currentMode === "right" ? currentData.clickHeatmapRight : currentData.clickHeatmapLeft;
  const safeMap = Array.isArray(map) && map.length === CLICK_COLS * CLICK_ROWS ? map : DEFAULT_STATS.clickHeatmapLeft;
  const max = safeMap.reduce((acc, val) => Math.max(acc, Number(val) || 0), 0);
  safeMap.forEach((value, index) => {
    const count = Number(value) || 0;
    const ratio = max > 0 ? count / max : 0;
    const cell = clickCells[index];
    if (!cell) return;
    const boosted = count > 0 ? Math.max(0.18, ratio) : 0;
    cell.style.backgroundColor = count > 0 ? heatColor(boosted, count === max) : "var(--heat-low)";
  });
}

function renderKeyHeatmap(data) {
  const counts = data.keyCounts || {};
  let max = 0;
  let maxKey = "";
  keyElements.forEach((_, key) => {
    const val = Number(counts[key]) || 0;
    if (val > max) {
      max = val;
      maxKey = key;
    }
  });

  keyElements.forEach((el, key) => {
    const count = Number(counts[key]) || 0;
    const ratio = max > 0 ? count / max : 0;
    const isMax = max > 0 && count === max;
    el.style.backgroundColor = count > 0 ? heatColor(ratio, isMax) : "var(--heat-low)";
    el.classList.toggle("hot", count > 0);
    el.classList.toggle("max", isMax);
    el.title = `${key}: ${count}`;
  });

  if (maxKey) {
    elements.keyMeta.textContent = `Most used: ${maxKey.replace("KEY_", "")} (${formatNumber(max)})`;
  } else {
    elements.keyMeta.textContent = "Most used: -";
  }
}

function render(data) {
  currentData = { ...DEFAULT_STATS, ...data };
  renderSummary(currentData);
  renderMeta(currentData);
  updateClickGridSize();
  renderClickHeatmap();
  renderKeyHeatmap(currentData);
}

function pingActive() {
  fetch("/active", { method: "POST", keepalive: true }).catch(() => null);
}

async function loadStats() {
  try {
    const response = await fetch("/stats.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to load stats");
    const payload = await response.json();
    render(payload);
  } catch (_err) {
    render(DEFAULT_STATS);
  }
}

function init() {
  buildKeyboard();
  buildClickGrid();
  window.addEventListener("resize", () => {
    updateClickGridSize();
    renderClickHeatmap();
  });
  window.addEventListener("beforeunload", () => {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/inactive");
      return;
    }
    fetch("/inactive", { method: "POST", keepalive: true }).catch(() => null);
  });
  elements.clickToggle.addEventListener("click", (event) => {
    const button = event.target.closest(".toggle-btn");
    if (!button) return;
    setMode(button.dataset.mode || "left");
  });
  elements.refresh.addEventListener("click", loadStats);
  setMode("left");
  pingActive();
  activePing = setInterval(pingActive, 2000);
  loadStats();
  setInterval(loadStats, 2000);
}

init();
