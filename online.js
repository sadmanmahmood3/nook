// online.js — connects the library to Supabase so real IUB students see each other.
// Without an IUB login (or without internet) Nook stays in solo mode with the bots.
(async () => {
  const sub = $("brandSub");
  const look = () => store.get("look", null) || { name: "Student" };
  let timerState = { mode: null, endAt: null };

  // an error sent back by Google / Supabase after sign-in (e.g. a non-IUB account)
  function signInError() {
    const params = new URLSearchParams(location.hash.slice(1) + "&" + location.search.slice(1));
    const msg = params.get("error_description");
    if (params.has("error") || params.has("error_description")) {
      history.replaceState(null, "", location.pathname);
    }
    if (!msg) return null;
    return /iub|domain|403|not allowed|hook/i.test(msg)
      ? `Only @${Net.domain} accounts can join Nook. Pick your IUB account.`
      : "Sign-in didn’t work: " + msg;
  }

  function showSignedIn(email) {
    $("signedIn").hidden = false;
    if (email) {
      $("signedText").innerHTML = "";
      const strong = document.createElement("strong");
      strong.textContent = email;
      $("signedText").append("Signed in as ", strong, " ·");
      $("signBtn").textContent = "Sign out";
      $("signBtn").onclick = async () => { await Net.signOut(); location.reload(); };
    } else {
      $("signedText").textContent = "Solo mode: you can’t see other students.";
      $("signBtn").textContent = "Sign in with IUB email";
      $("signBtn").onclick = () => { $("avatarCard").hidden = true; $("loginScreen").hidden = false; };
    }
  }

  $("googleBtn").addEventListener("click", async () => {
    $("googleBtn").disabled = true;
    $("loginError").textContent = "";
    try {
      await Net.signIn(); // the page goes to Google and comes back
    } catch (err) {
      $("googleBtn").disabled = false;
      $("loginError").textContent = "Couldn’t open Google sign-in. Check your internet and try again.";
    }
  });
  $("soloBtn").addEventListener("click", () => {
    $("loginScreen").hidden = true;
    showSignedIn(null);
    toast("Solo mode. Sign in with your IUB email any time to study with others.", 5000);
  });

  const urlError = signInError();
  const res = await Net.start({ look: look(), ...World.playerState(), timerEnd: null, mode: null });
  if (res.status === "offline") return; // no internet or not set up: solo mode
  if (res.status === "blocked") {
    $("loginScreen").hidden = false;
    $("googleBtn").hidden = true;
    $("loginError").textContent = "Your access to Nook has been paused by the admin. Email iubnook@gmail.com if you think this is a mistake.";
    return;
  }
  if (res.status === "login") {
    $("loginError").textContent = urlError || res.error || "";
    $("loginScreen").hidden = false;
    return;
  }

  // signed in with an IUB account
  const user = Net.user;
  showSignedIn(user.email);
  if (Net.admin) $("adminBtn").hidden = false;
  Net.cleanupMine().catch(() => { /* try again next time */ });
  if (!store.get("look", null)) {
    // first time: fill in their first name from Google
    const full = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || "";
    const first = full.split(" ")[0].slice(0, 16);
    if (first && !$("avatarName").value) {
      $("avatarName").value = first;
      $("avatarName").dispatchEvent(new Event("input"));
    }
  }

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
