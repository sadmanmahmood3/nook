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
