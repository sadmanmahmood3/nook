// chat.js — table chat. Sit at a café table or a group table to talk with the
// people at that table. Messages float above your head for a few seconds and
// show in the chat panel. Nothing is saved: stand up and the conversation is gone.
(() => {
  DRAWERS.chatPanel = "chatBtn";
  const btn = $("chatBtn"), list = $("chatList"), form = $("chatForm"), input = $("chatInput");
  let current = null;      // the table you're at (World.myTable())
  let seen = new Set();
  let unread = 0;
  let lastSent = 0;
  const bigScreen = () => !World.isTouch && innerWidth > 760;
  const isOpen = () => !$("chatPanel").hidden;
  const time = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  function setUnread(n) {
    unread = n;
    $("chatCount").textContent = n ? String(n > 9 ? "9+" : n) : "";
  }

  function line(cls, text) {
    const li = document.createElement("li");
    li.className = cls;
    li.textContent = text;
    list.append(li);
    list.scrollTop = list.scrollHeight;
  }

  function addMessage(name, text, at, mine) {
    const li = document.createElement("li");
    li.className = "msg" + (mine ? " mine" : "");
    const head = document.createElement("span");
    head.className = "msg-head";
    const who = document.createElement("strong");
    who.textContent = mine ? "You" : name;
    const when = document.createElement("time");
    when.textContent = time(at);
    head.append(who, when);
    const body = document.createElement("span");
    body.className = "msg-text";
    body.textContent = text;
    li.append(head, body);
    list.append(li);
    while (list.children.length > 80) list.firstChild.remove();
    list.scrollTop = list.scrollHeight;
  }

  // "With: Rafi, Nabila" under the title
  function showMates() {
    if (!current) return;
    const t = World.myTable();
    if (!t) return;
    const real = t.mates.filter((m) => m.real).map((m) => m.name);
    $("chatWith").textContent = !Net.online
      ? "Sign in with your IUB email to chat with other students."
      : real.length ? "With " + real.join(", ") : "No one else here yet. Students who sit at this table will see your messages.";
  }

  function canChat() { return Net.online && !!current; }

  function enterTable(t) {
    current = t;
    seen = new Set();
    list.innerHTML = "";
    setUnread(0);
    $("chatTitle").textContent = "Chat · " + t.label.replace(/^a /, "");
    btn.hidden = false;
    input.disabled = !Net.online;
    form.querySelector("button").disabled = !Net.online;
    line("sys", "You sat down. Say hi! Only people at this table see these messages, and nothing is saved.");
    showMates();
    if (Net.online) Net.joinTable(t.id);
    if (bigScreen()) setDrawer("chatPanel", true);
    else toast("You can chat with your table. Tap Chat at the top.", 4000);
  }

  function exitTable() {
    if (!current) return;
    current = null;
    Net.leaveTable && Net.leaveTable();
    if (isOpen()) setDrawer(null, false);
    btn.hidden = true;
    setUnread(0);
  }

  World.on("sit", () => {
    const t = World.myTable();
    if (t && t.chat) enterTable(t);
    else {
      exitTable();
      if (t && !store.get("hallTip", false)) {
        store.set("hallTip", true);
        toast("The reading hall is a quiet zone. Sit at a café or group table to chat.", 5000);
      }
    }
  });
  World.on("stand", exitTable);

  // after signing in (or reconnecting) while already sitting at a table
  Net.on("status", (s) => {
    if (s !== "online" || !current) return;
    input.disabled = false;
    form.querySelector("button").disabled = false;
    Net.joinTable(current.id);
    showMates();
  });

  Net.on("chat", (m) => {
    if (!current || m.table !== current.id || !m.id || seen.has(m.id)) return;
    // only people actually sitting at this table can talk here
    if (World.tableOf(m.from) !== current.id) return;
    seen.add(m.id);
    const name = World.nameOf(m.from);
    addMessage(name, m.text, m.at, false);
    World.say(m.from, m.text);
    if (!isOpen()) {
      setUnread(unread + 1);
      if (!bigScreen()) toast(`${name}: ${m.text.length > 60 ? m.text.slice(0, 60) + "…" : m.text}`, 4000);
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.replace(/\s+/g, " ").trim();
    if (!text || !canChat()) return;
    if (Date.now() - lastSent < 700) return; // no spamming
    lastSent = Date.now();
    input.value = "";
    try {
      const m = await Net.sendChat(text);
      seen.add(m.id);
      addMessage("You", m.text, Date.now(), true);
      World.say("me", m.text);
    } catch {
      input.value = text;
      line("sys", "Couldn’t send that. Check your internet and try again.");
    }
  });

  btn.addEventListener("click", () => {
    const open = !isOpen();
    setDrawer("chatPanel", open);
    if (open) {
      setUnread(0);
      list.scrollTop = list.scrollHeight;
      if (bigScreen() && !input.disabled) input.focus();
    }
  });

  // Enter jumps into the chat box, Escape leaves it
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && e.target === input) { input.blur(); return; }
    if (e.key !== "Enter" || btn.hidden || modalOpen()) return;
    if (e.target.closest && e.target.closest("input, textarea, select, button")) return;
    e.preventDefault();
    if (!isOpen()) { setDrawer("chatPanel", true); setUnread(0); }
    if (!input.disabled) input.focus();
  });

  setInterval(() => {
    if (!current) return;
    // got bumped out of the chair, or the table changed under us
    const t = World.myTable();
    if (!t || !t.chat) { exitTable(); return; }
    showMates();
  }, 1500);
})();
