// app.js — timer, scenes, avatar, sound mixer, tasks and stats.
// Saved data stays in this browser (localStorage). Phase 2 moves the shared parts to Firebase.

// ---------- storage helpers (never crash if storage is blocked) ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("nook:" + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("nook:" + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

const $ = (id) => document.getElementById(id);

// ---------- toast messages ----------
let toastTimer = null;
function toast(text, ms = 3200) {
  $("toast").textContent = text;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { $("toast").textContent = ""; }, ms);
}

// ---------- scenes ----------
// Each scene comes with its own sound mix (0..1 per layer)
const SCENE_MIX = {
  morning: { birds: 0.6, wind: 0.25, rain: 0, crickets: 0, cafe: 0, brown: 0.1 },
  rain:    { rain: 0.75, wind: 0.2, birds: 0, crickets: 0, cafe: 0, brown: 0.15 },
  night:   { crickets: 0.55, wind: 0.3, rain: 0, birds: 0, cafe: 0, brown: 0.1 },
  cafe:    { cafe: 0.7, brown: 0.2, rain: 0, birds: 0, wind: 0, crickets: 0 },
};
const SCENE_LINES = {
  morning: "Fresh start. One task at a time.",
  rain: "Rain outside, focus inside.",
  night: "Quiet hours. Good time to go deep.",
  cafe: "Busy café, quiet mind.",
};

const settings = store.get("settings", { scene: "morning", focusLen: 25, mix: null });
if (![5, 10, 15].includes(settings.breakLen)) settings.breakLen = 5;

function setScene(scene, applyMix = true) {
  settings.scene = scene;
  document.documentElement.dataset.scene = scene;
  const css = getComputedStyle(document.documentElement);
  World.set(scene, css.getPropertyValue("--accent").trim(), css.getPropertyValue("--accent-ink").trim());
  document.querySelectorAll(".chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scene === scene)));
  if (applyMix) {
    settings.mix = { ...SCENE_MIX[scene] };
    renderMixer();
  }
  if (!timer.running && World.seated) $("status").textContent = SCENE_LINES[scene];
  store.set("settings", settings);
}

// ---------- sound ----------
function renderMixer() {
  const mixer = $("mixer");
  mixer.innerHTML = "";
  for (const name in Sound.layers) {
    const v = settings.mix[name] ?? 0;
    const row = document.createElement("div");
    row.className = "mix-row";
    row.innerHTML = `
      <label for="vol-${name}">${Sound.layers[name].label}</label>
      <input type="range" id="vol-${name}" min="0" max="100" step="1" value="${Math.round(v * 100)}">
      <output for="vol-${name}">${Math.round(v * 100)}</output>`;
    const input = row.querySelector("input");
    const out = row.querySelector("output");
    input.style.setProperty("--fill", input.value + "%");
    input.addEventListener("input", () => {
      const val = input.value / 100;
      settings.mix[name] = val;
      applyRoomSound();
      out.textContent = input.value;
      input.style.setProperty("--fill", input.value + "%");
      store.set("settings", settings);
    });
    mixer.appendChild(row);
  }
  applyRoomSound();
}

// Sound is on by default. Browsers only allow audio after the visitor's first
// click or key press, so it starts then. Turning it off is remembered.
let soundWanted = settings.sound !== false;

function showSound(on) {
  $("soundToggle").setAttribute("aria-pressed", String(on));
  $("soundLabel").textContent = on ? "Sound on" : "Sound off";
  $("mixNote").textContent = on ? "Mix your own background" : "Turn sound on to listen";
}

// each part of the library sounds a little different
function applyRoomSound() {
  const z = World.zone;
  for (const name in Sound.layers) {
    let v = settings.mix[name] ?? 0;
    if (z === "cafe") v = name === "cafe" ? Math.max(v, 0.6) : name === "brown" ? Math.max(v, 0.15) : v * 0.35;
    if (z === "group") v = name === "cafe" ? Math.max(v, 0.2) : v * 0.8;
    Sound.setVolume(name, v);
  }
}
World.on("zone", (z) => {
  applyRoomSound();
  const info = World.ZONES[z];
  if (info) toast(`${info.name}. ${info.hint}`);
});

function setSound(on) {
  soundWanted = on;
  settings.sound = on;
  store.set("settings", settings);
  if (!Sound.setEnabled(on)) {
    $("mixNote").textContent = "This browser can’t play generated sound";
    return;
  }
  showSound(on);
}
$("soundToggle").addEventListener("click", () => setSound(!soundWanted));

function startSoundOnFirstTouch() {
  const go = (e) => {
    window.removeEventListener("pointerdown", go, true);
    window.removeEventListener("keydown", go, true);
    if (e.target.closest && e.target.closest("#soundToggle")) return; // the button handles itself
    if (soundWanted) Sound.setEnabled(true);
  };
  window.addEventListener("pointerdown", go, true);
  window.addEventListener("keydown", go, true);
}
showSound(soundWanted);
if (soundWanted) startSoundOnFirstTouch();

// ---------- drawers (only one open at a time) ----------
const DRAWERS = { panel: "panelBtn", filesPanel: "filesBtn" };
function setDrawer(id, open) {
  for (const [p, b] of Object.entries(DRAWERS)) {
    const show = p === id && open;
    $(p).hidden = !show;
    $(b).setAttribute("aria-expanded", String(show));
  }
}
const drawerOpen = (id) => !$(id).hidden;
$("panelBtn").addEventListener("click", () => setDrawer("panel", !drawerOpen("panel")));
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => setDrawer(b.dataset.close, false)));
// on phones the drawers cover the library, so tapping the library closes them
$("scene").addEventListener("pointerdown", () => {
  if (World.isTouch) setDrawer(null, false);
});

// ---------- compact timer on phones ----------
$("dockMore").addEventListener("click", () => {
  const compact = $("dock").classList.toggle("compact");
  $("dockMore").textContent = compact ? "More" : "Less";
  $("dockMore").setAttribute("aria-expanded", String(!compact));
});

// any pop-up card open? (then keys shouldn't move you or start the timer)
const modalOpen = () => !!document.querySelector(".avatar-card:not([hidden]), .leave-screen:not([hidden])");

// ---------- avatar ----------
let look = store.get("look", null);
const firstVisit = !look;
if (!look) look = { name: "", skin: 1, hair: "short", hairColor: 0, shirt: 0 };
let draft = { ...look };

function swatchRow(el, colors, key) {
  el.innerHTML = "";
  colors.forEach((c, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.id = `${key}-${i}`;
    b.style.background = c;
    b.setAttribute("aria-label", `${key} ${i + 1}`);
    b.setAttribute("aria-pressed", String(draft[key] === i));
    b.addEventListener("click", () => { draft[key] = i; renderAvatarCard(); });
    el.appendChild(b);
  });
}

function renderAvatarCard() {
  swatchRow($("optSkin"), World.SKINS, "skin");
  swatchRow($("optHairColor"), World.HAIR_COLORS, "hairColor");
  swatchRow($("optShirt"), World.SHIRTS, "shirt");
  const hair = $("optHair");
  hair.innerHTML = "";
  const names = { short: "Short", long: "Long", bun: "Bun", hijab: "Hijab" };
  World.HAIRSTYLES.forEach((h) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg";
    b.id = "hair-" + h;
    b.textContent = names[h];
    b.setAttribute("aria-pressed", String(draft.hair === h));
    b.addEventListener("click", () => { draft.hair = h; renderAvatarCard(); });
    hair.appendChild(b);
  });
  $("hairColorLabel").textContent = draft.hair === "hijab" ? "Hijab colour" : "Hair colour";
  World.drawPreview($("avatarPreview"), { ...draft, name: draft.name || "You" });
}

function openAvatar() {
  draft = { ...look };
  $("avatarName").value = draft.name;
  $("avatarCard").hidden = false;
  $("avatarSave").textContent = firstVisitPending ? "Enter the library" : "Save";
  renderAvatarCard();
}
let firstVisitPending = firstVisit;

$("avatarName").addEventListener("input", (e) => { draft.name = e.target.value.trim(); });
$("avatarBtn").addEventListener("click", openAvatar);
$("avatarSave").addEventListener("click", () => {
  if (!draft.name) {
    $("avatarName").focus();
    $("avatarName").placeholder = "Add a name first";
    return;
  }
  if (draft.name.toLowerCase() === "ushain") {
    $("avatarName").value = "";
    draft.name = "";
    $("avatarName").placeholder = "Ushain is Nook’s host. Pick another name";
    $("avatarName").focus();
    return;
  }
  look = { ...draft };
  store.set("look", look);
  World.setLook(look);
  document.dispatchEvent(new CustomEvent("nook:look", { detail: look }));
  $("avatarCard").hidden = true;
  if (firstVisitPending) {
    firstVisitPending = false;
    toast(World.isTouch ? `Welcome, ${look.name}. Use the joystick to walk, then tap Sit next to a chair.` : `Welcome, ${look.name}. Use the arrow keys or WASD to walk. Press E next to a chair to sit.`, 6000);
  } else {
    toast("Avatar saved.");
  }
});

// ---------- sitting ----------
World.on("sit", (desk) => {
  $("standBtn").hidden = false;
  $("status").textContent = timer.running ? $("status").textContent : "Your seat is ready. Press Start when ready.";
  toast(`You sat at ${desk.label}.`);
  renderTimer();
});
World.on("stand", () => {
  $("standBtn").hidden = true;
  if (!timer.running) $("status").textContent = "Tap an empty chair to sit down.";
  renderTimer();
});
World.on("taken", (name) => toast(`${name} is sitting there. Pick an empty chair.`));
$("standBtn").addEventListener("click", () => World.standUp());

// ---------- timer ----------
const timer = {
  mode: "focus",
  running: false,
  endAt: 0,
  remaining: 25 * 60,
  done: 0, // focus sessions finished in this round (the dots; a round is 4)
  handle: null,
  heldFocus: null, // seconds left on a focus session you left for a break
};
const ROUND = 4;

function lengthOf(mode) {
  if (mode === "focus") return settings.focusLen * 60;
  return settings.breakLen * 60;
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

// tell the rest of Nook (and other students) what your timer is doing
function announceTimer() {
  document.dispatchEvent(new CustomEvent("nook:timer", {
    detail: { mode: timer.running ? timer.mode : null, endAt: timer.running ? timer.endAt : null },
  }));
}

function renderTimer() {
  $("time").textContent = fmt(timer.remaining);
  $("startBtn").textContent = timer.running ? "Pause" : timer.remaining < lengthOf(timer.mode) ? "Resume" : "Start";
  document.querySelectorAll(".mode").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === timer.mode)));
  document.querySelectorAll(".len[data-len]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.len) === settings.focusLen)));
  document.querySelectorAll(".len[data-blen]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.blen) === settings.breakLen)));
  // the length chips follow the mode: focus lengths while focusing, break lengths on a break
  $("focusLens").hidden = timer.mode !== "focus";
  $("breakLens").hidden = timer.mode === "focus";
  const dots = $("dots");
  dots.innerHTML = "";
  for (let i = 0; i < ROUND; i++) {
    const li = document.createElement("li");
    if (i < timer.done) li.className = "done";
    dots.appendChild(li);
  }
  const label = timer.mode === "focus" ? "Focus" : "Break";
  document.title = timer.running ? `${fmt(timer.remaining)} · ${label} – Nook` : "Nook Study Lounge";
  // the bubble above your head in the library
  const bubble = timer.running ? (timer.mode === "focus" ? fmt(timer.remaining) : "on a break") : null;
  World.setPlayerTimer(bubble, timer.running && timer.mode === "focus" && !!World.seated);
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* not allowed here, that's fine */ }
}

function start() {
  Sound.ensure(); // unlocks audio so the end chime can play
  timer.endAt = Date.now() + timer.remaining * 1000;
  timer.running = true;
  timer.handle = setInterval(tick, 250);
  $("status").textContent = timer.mode === "focus" ? "Focusing. Phone face down."
    : timer.heldFocus ? `On a break. Your focus is paused at ${fmt(timer.heldFocus)}.` : "On a break. Stretch, drink water.";
  if (timer.mode === "focus" && !World.seated) toast("Tip: sit at a desk so others can see you studying.");
  keepAwake(true);
  renderTimer();
  announceTimer();
}

function pause() {
  timer.running = false;
  clearInterval(timer.handle);
  timer.remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
  $("status").textContent = "Paused.";
  keepAwake(false);
  renderTimer();
  announceTimer();
}

// switch between Focus and Break.
// Leaving an unfinished focus session for a break keeps its time; coming back
// to Focus picks up from there instead of starting over.
function setMode(mode, { hold = true } = {}) {
  if (timer.running) {
    timer.remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
    clearInterval(timer.handle); timer.running = false; keepAwake(false);
  }
  const leavingFocus = timer.mode === "focus" && mode !== "focus";
  if (leavingFocus && hold && timer.remaining > 0 && timer.remaining < lengthOf("focus")) {
    timer.heldFocus = timer.remaining;
    $("status").textContent = `Focus paused at ${fmt(timer.heldFocus)}. Press Start for your break.`;
  }
  timer.mode = mode;
  if (mode === "focus" && timer.heldFocus) {
    timer.remaining = timer.heldFocus;
    timer.heldFocus = null;
    $("status").textContent = `Back to focus. ${fmt(timer.remaining)} left. Press Resume.`;
  } else {
    timer.remaining = lengthOf(mode);
  }
  renderTimer();
  announceTimer();
}

// start this mode again from its full length (Reset, R key, a new focus length)
function resetMode() {
  if (timer.mode === "focus") timer.heldFocus = null;
  if (timer.running) { clearInterval(timer.handle); timer.running = false; keepAwake(false); }
  timer.remaining = lengthOf(timer.mode);
  renderTimer();
  announceTimer();
}

function tick() {
  timer.remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
  renderTimer();
  if (timer.remaining === 0) finish(true);
}

function finish(completed) {
  const was = timer.mode;
  if (completed) Sound.chime();
  let next;
  if (was === "focus") {
    if (completed) {
      logSession(settings.focusLen);
      timer.done += 1;
    }
    next = "break";
  } else {
    if (timer.done >= ROUND) timer.done = 0; // a round of 4 is done: start fresh dots
    next = "focus";
  }
  // a finished or skipped focus session isn't held for later
  setMode(next, { hold: false });
  const resumed = was !== "focus" && timer.remaining < lengthOf("focus");
  if (completed) {
    $("status").textContent = was === "focus"
      ? (timer.done >= ROUND ? "Four sessions done! Take a longer break if you need one." : "Session done. Take a break.")
      : resumed ? `Break’s over. ${fmt(timer.remaining)} of focus left. Press Resume.` : "Break’s over. Ready for the next one?";
  } else if (!resumed) {
    $("status").textContent = "Skipped.";
  }
}

$("startBtn").addEventListener("click", () => (timer.running ? pause() : start()));
$("resetBtn").addEventListener("click", () => { resetMode(); $("status").textContent = "Reset."; });
$("skipBtn").addEventListener("click", () => finish(false));
document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.mode !== timer.mode) setMode(b.dataset.mode); // tapping the mode you're in does nothing
}));
document.querySelectorAll(".len[data-blen]").forEach((b) => b.addEventListener("click", () => {
  settings.breakLen = Number(b.dataset.blen);
  store.set("settings", settings);
  if (timer.mode !== "focus") resetMode(); // your held focus time stays safe
}));
document.querySelectorAll(".len[data-len]").forEach((b) => b.addEventListener("click", () => {
  settings.focusLen = Number(b.dataset.len);
  store.set("settings", settings);
  timer.heldFocus = null; // a new length starts a fresh session
  resetMode();
}));
document.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => setScene(b.dataset.scene)));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".share-card, .view-card, .report-card, .admin-card").forEach((c) => { c.hidden = true; });
  }
  if (e.target.closest("input, textarea, select") || modalOpen()) {
    if (e.key === "Escape" && !$("avatarCard").hidden && !firstVisitPending) $("avatarCard").hidden = true;
    return;
  }
  if (e.code === "Space") { e.preventDefault(); timer.running ? pause() : start(); }
  if (e.key === "r" || e.key === "R") resetMode();
});

World.on("tapAway", () => setDrawer(null, false));
World.on("blockedWay", () => toast("Someone’s in the way. Walk around them or pick another spot."));

// ---------- leaving and coming back ----------
$("leaveBtn").addEventListener("click", () => {
  if (timer.running) pause();
  World.standUp();
  setDrawer(null, false);
  if (soundWanted) Sound.setEnabled(false);
  $("leaveScreen").hidden = false;
  $("status").textContent = "Tap an empty chair to sit down.";
  document.dispatchEvent(new CustomEvent("nook:leave"));
});
$("enterBtn").addEventListener("click", () => {
  $("leaveScreen").hidden = true;
  if (soundWanted) Sound.setEnabled(true);
  document.dispatchEvent(new CustomEvent("nook:enter"));
  toast(`Welcome back${look.name ? ", " + look.name : ""}.`);
});

// ---------- stats ----------
function todayKey(d = new Date()) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function logSession(minutes) {
  const days = store.get("days", {});
  const k = todayKey();
  days[k] = days[k] || { min: 0, sessions: 0 };
  days[k].min += minutes;
  days[k].sessions += 1;
  store.set("days", days);
  renderStats();
}

function streak(days) {
  let count = 0;
  const d = new Date();
  if (!days[todayKey(d)]) d.setDate(d.getDate() - 1);
  while (days[todayKey(d)] && days[todayKey(d)].min > 0) {
    count += 1;
    d.setDate(d.getDate() - 1);
  }
  return count;
}

function renderStats() {
  const days = store.get("days", {});
  const today = days[todayKey()] || { min: 0, sessions: 0 };
  const h = Math.floor(today.min / 60), m = today.min % 60;
  $("statMin").textContent = h ? `${h}h ${m}m` : `${m} min`;
  $("statSessions").textContent = today.sessions;
  $("statStreak").textContent = streak(days);
}

// ---------- tasks ----------
let tasks = store.get("tasks", null);
if (!tasks) {
  tasks = [
    { id: 1, text: "Example: Read chapter 3 notes", done: true },
    { id: 2, text: "Example: Finish CSE 451 SRS draft", done: false },
  ];
}

function saveTasks() { store.set("tasks", tasks); renderTasks(); }

function renderTasks() {
  const list = $("taskList");
  list.innerHTML = "";
  if (!tasks.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nothing yet. Add what you want to finish today.";
    list.appendChild(li);
  }
  for (const t of tasks) {
    const li = document.createElement("li");
    if (t.done) li.className = "done";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = "task-" + t.id;
    box.checked = t.done;
    box.addEventListener("change", () => { t.done = box.checked; saveTasks(); });
    const label = document.createElement("label");
    label.className = "task-text";
    label.htmlFor = box.id;
    label.textContent = t.text;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    del.setAttribute("aria-label", "Delete task: " + t.text);
    del.textContent = "×";
    del.addEventListener("click", () => { tasks = tasks.filter((x) => x.id !== t.id); saveTasks(); });
    li.append(box, label, del);
    list.appendChild(li);
  }
  const open = tasks.filter((t) => !t.done).length;
  $("taskCount").textContent = tasks.length ? `${open} left` : "";
}

$("taskForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("taskInput");
  const text = input.value.trim();
  if (!text) return;
  tasks.push({ id: Date.now(), text, done: false });
  input.value = "";
  saveTasks();
});

// ---------- start up ----------
World.setLook(look.name ? look : { ...look, name: "You" });
World.start();
const savedMix = settings.mix;
setScene(settings.scene || "morning", !savedMix);
if (savedMix) { settings.mix = savedMix; renderMixer(); }
setMode("focus");
renderTasks();
renderStats();
if (firstVisit) openAvatar();
else toast(World.isTouch ? "Use the joystick to walk. Tap Sit next to a chair." : "Arrow keys or WASD to walk. Press E next to a chair to sit.", 5000);
