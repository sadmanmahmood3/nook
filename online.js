// online.js — connects the library to Supabase so real students see each other.
// If it can't connect, Nook stays in solo mode with the bots.
(async () => {
  const sub = $("brandSub");
  const look = () => store.get("look", null) || { name: "Student" };
  let timerState = { mode: null, endAt: null };

  const ok = await Net.start({ look: look(), ...World.playerState(), timerEnd: null, mode: null });
  if (!ok) return; // solo mode

  const setCount = (n) => { sub.textContent = n === 1 ? "1 studying now" : `${n} studying now`; };
  setCount(1);

  // other students
  Net.on("people", (list) => {
    World.syncRemotes(list);
    setCount(list.length + 1);
  });
  Net.on("pos", (p) => World.remotePos(p.id, p.x, p.y, p.m));
  Net.on("status", (s) => { if (s === "offline") sub.textContent = "Reconnecting…"; });

  // you
  World.on("bumped", () => toast("Someone sat in that chair just before you. Pick another one."));
  World.on("sit", () => Net.update(World.playerState()));
  World.on("stand", () => Net.update(World.playerState()));
  document.addEventListener("nook:look", (e) => Net.update({ look: e.detail }));
  document.addEventListener("nook:timer", (e) => {
    timerState = e.detail;
    Net.update({ mode: timerState.mode, timerEnd: timerState.endAt });
  });

  document.addEventListener("nook:leave", () => { Net.leave(); sub.textContent = "IUB study lounge"; World.syncRemotes([]); });
  document.addEventListener("nook:enter", () => { Net.update(World.playerState()); Net.rejoin(); });

  // Leave the room when the page closes (phone back button, closing the tab), and
  // after 15 seconds in the background (switching apps). Come back in automatically.
  const inLibrary = () => $("leaveScreen").hidden;
  let awayTimer = null;
  let away = false;
  function stepOut() {
    away = true;
    Net.leave();
    World.syncRemotes([]);
  }
  function stepIn() {
    if (!away || !inLibrary()) return;
    away = false;
    Net.update(World.playerState());
    Net.rejoin();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (inLibrary()) awayTimer = setTimeout(stepOut, 15000);
    } else {
      clearTimeout(awayTimer);
      stepIn();
    }
  });
  window.addEventListener("pagehide", () => { clearTimeout(awayTimer); stepOut(); });
  window.addEventListener("pageshow", (e) => { if (e.persisted) stepIn(); });

  // send your position a few times a second while you walk, and once when you stop
  let last = World.playerState();
  setInterval(() => {
    const now = World.playerState();
    const moved = Math.abs(now.x - last.x) + Math.abs(now.y - last.y) > 2;
    if (moved && !now.deskId) Net.sendPos(now.x, now.y, true);
    else if (last.moving && !now.moving && !now.deskId) {
      Net.sendPos(now.x, now.y, false);
      Net.update({ x: now.x, y: now.y });
    }
    last = now;
  }, 300);
})();
