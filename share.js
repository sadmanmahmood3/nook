// share.js — share files and notes with people in the library.
// For now shared items live only in this browser. Phase 2 sends them to everyone through the backend.
const Share = (() => {
  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
  const ALLOWED = ["pdf", "txt", "md", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "png", "jpg", "jpeg", "webp", "zip"];
  const IMAGES = ["png", "jpg", "jpeg", "webp"];
  const TEXTS = ["txt", "md"];

  const items = []; // newest first
  let kind = "file";
  let chosen = null;   // the File picked in the share sheet
  let filter = null;   // show only items from this person
  let viewing = null;  // item open in the viewer

  // ---------- small helpers ----------
  const extOf = (name) => (name.includes(".") ? name.split(".").pop() : "").toLowerCase();
  function sizeText(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return Math.round(b / 1024) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }
  function ago(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    return Math.round(m / 60) + " h ago";
  }
  function badgeText(it) {
    if (it.kind === "note") return "NOTE";
    const e = extOf(it.name);
    return ({ jpeg: "JPG", docx: "DOC", pptx: "PPT", xlsx: "XLS", webp: "IMG" }[e] || e.toUpperCase()).slice(0, 4);
  }
  function personName(id) {
    if (id === "me") return "You";
    const p = World.people().find((x) => x.id === id);
    return p ? p.name + (p.bot ? " (bot)" : "") : "Someone";
  }
  function audience(it) {
    if (it.to === "all") return "Everyone";
    if (it.to === "me") return "To you";
    return "To " + personName(it.to);
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function openInTab(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ---------- the list ----------
  // you only see shares meant for everyone, sent to you, or sent by you
  const canSee = (it) => it.to === "all" || it.to === "me" || it.from === "me";

  // desk badges count only what you can see, so private shares stay private
  function counts() {
    const m = {};
    for (const it of items) if (canSee(it)) m[it.from] = (m[it.from] || 0) + 1;
    return m;
  }

  function add(it) {
    items.unshift(it);
    World.setFileCounts(counts());
    render();
  }

  function render() {
    const mine = items.filter(canSee);
    const visible = mine.filter((it) => !filter || it.from === filter);

    $("filesCount").textContent = mine.length ? String(mine.length) : "";
    $("filesFilter").hidden = !filter;
    if (filter) $("filesFilterText").textContent = `Shared by ${personName(filter)}`;

    const list = $("filesList");
    list.innerHTML = "";
    if (!visible.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Nothing shared yet. Share your notes or slides to help others.";
      list.appendChild(li);
      return;
    }
    for (const it of visible) {
      const li = document.createElement("li");
      li.className = "file";

      const badge = document.createElement("span");
      badge.className = "file-badge" + (it.kind === "note" ? " note" : "");
      badge.textContent = badgeText(it);

      const main = document.createElement("div");
      main.className = "file-main";
      const title = document.createElement("strong");
      title.textContent = it.name;
      const meta = document.createElement("span");
      meta.className = "meta";
      const parts = [personName(it.from), audience(it), ago(it.time)];
      if (it.size) parts.splice(1, 0, sizeText(it.size));
      meta.textContent = parts.join(" · ");
      main.append(title, meta);

      const actions = document.createElement("div");
      actions.className = "file-actions";
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "btn small";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", () => openItem(it));
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn small";
      saveBtn.textContent = "Save";
      saveBtn.addEventListener("click", () => saveItem(it));
      actions.append(openBtn, saveBtn);

      li.append(badge, main, actions);
      list.appendChild(li);
    }
  }

  // ---------- opening and saving ----------
  async function openItem(it) {
    const ext = extOf(it.name);
    if (it.kind === "note" || TEXTS.includes(ext) || IMAGES.includes(ext)) {
      viewing = it;
      $("viewTitle").textContent = it.name;
      $("viewMeta").textContent = `${personName(it.from)} · ${audience(it)} · ${ago(it.time)}`;
      const body = $("viewBody");
      body.innerHTML = "";
      if (IMAGES.includes(ext)) {
        const img = document.createElement("img");
        img.alt = it.name;
        img.src = URL.createObjectURL(it.blob);
        body.appendChild(img);
      } else {
        const pre = document.createElement("pre");
        pre.textContent = it.kind === "note" ? it.text : await it.blob.text();
        body.appendChild(pre);
      }
      $("viewCard").hidden = false;
      return;
    }
    if (ext === "pdf") { openInTab(it.blob); return; }
    // Word, slides, sheets, zip: browsers can't show these, so save them
    saveItem(it);
    toast(`Saved ${it.name}. Open it from your downloads.`);
  }

  function saveItem(it) {
    if (it.kind === "note") {
      download(new Blob([it.name + "\n\n" + it.text], { type: "text/plain" }), it.name.replace(/[\\/:*?"<>|]/g, "-") + ".txt");
    } else {
      download(it.blob, it.name);
    }
  }

  $("viewClose").addEventListener("click", () => { $("viewCard").hidden = true; });
  $("viewSave").addEventListener("click", () => { if (viewing) saveItem(viewing); });

  // ---------- the share sheet ----------
  function setKind(k) {
    kind = k;
    $("kind-file").setAttribute("aria-pressed", String(k === "file"));
    $("kind-note").setAttribute("aria-pressed", String(k === "note"));
    $("shareFileBox").hidden = k !== "file";
    $("shareNoteBox").hidden = k !== "note";
    $("shareError").textContent = "";
  }

  function pickFile(file) {
    $("shareError").textContent = "";
    if (!file) return;
    const ext = extOf(file.name);
    if (!ALLOWED.includes(ext)) {
      chosen = null;
      $("shareError").textContent = `.${ext || "?"} files can’t be shared. Use PDF, Word, slides, sheets, images, text or zip.`;
      return;
    }
    if (file.size > MAX_BYTES) {
      chosen = null;
      $("shareError").textContent = `That file is ${sizeText(file.size)}. The limit is 10 MB.`;
      return;
    }
    if (file.size === 0) {
      chosen = null;
      $("shareError").textContent = "That file is empty.";
      return;
    }
    chosen = file;
    $("dropTitle").textContent = file.name;
    $("dropSub").textContent = sizeText(file.size) + " · tap to choose a different file";
  }

  function openShare(to) {
    chosen = null;
    $("shareFile").value = "";
    $("dropTitle").textContent = "Choose a file or drop it here";
    $("dropSub").textContent = "PDF, Word, slides, sheets, images, text or zip · up to 10 MB";
    $("noteTitle").value = "";
    $("noteText").value = "";
    const sel = $("shareTo");
    sel.innerHTML = "";
    const all = new Option("Everyone in the library", "all");
    sel.add(all);
    for (const p of World.people()) sel.add(new Option(p.name + (p.bot ? " (bot)" : ""), p.id));
    sel.value = to || "all";
    setKind("file");
    $("shareCard").hidden = false;
  }

  $("kind-file").addEventListener("click", () => setKind("file"));
  $("kind-note").addEventListener("click", () => setKind("note"));
  $("shareFile").addEventListener("change", (e) => pickFile(e.target.files[0]));
  const drop = $("dropZone");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    pickFile(e.dataTransfer.files[0]);
  });
  $("shareCancel").addEventListener("click", () => { $("shareCard").hidden = true; });

  $("shareCard").addEventListener("submit", (e) => {
    e.preventDefault();
    const to = $("shareTo").value;
    let item;
    if (kind === "file") {
      if (!chosen) { $("shareError").textContent = "Choose a file first."; return; }
      item = { id: Date.now(), kind: "file", name: chosen.name, size: chosen.size, blob: chosen, from: "me", to, time: Date.now() };
    } else {
      const text = $("noteText").value.trim();
      if (!text) { $("shareError").textContent = "Write something in the note first."; return; }
      const name = $("noteTitle").value.trim() || "Note";
      item = { id: Date.now(), kind: "note", name, text, from: "me", to, time: Date.now() };
    }
    add(item);
    $("shareCard").hidden = true;
    toast(`Shared “${item.name}” with ${to === "all" ? "everyone" : personName(to)}.`);
    filter = null;
    render();
    setDrawer("filesPanel", true);
  });

  // ---------- buttons and world clicks ----------
  $("shareBtn").addEventListener("click", () => openShare());
  $("shareBtn2").addEventListener("click", () => openShare());
  $("filesBtn").addEventListener("click", () => {
    filter = null;
    render();
    setDrawer("filesPanel", !drawerOpen("filesPanel"));
  });
  $("filesShowAll").addEventListener("click", () => { filter = null; render(); });
  World.on("files", (id) => {
    filter = id;
    render();
    setDrawer("filesPanel", true);
  });
  setInterval(() => { if (drawerOpen("filesPanel")) render(); }, 60000);

  // ---------- study material the bots brought (real content, clearly from bots) ----------
  const now = Date.now();
  add({
    id: "bot-1", kind: "note", from: "nabila", to: "all", time: now - 26 * 60000,
    name: "Pomodoro study plan",
    text: [
      "1. Write down 3 tasks for today, smallest first.",
      "2. Focus for 25 minutes, then take a 5 minute break. Phone in another room.",
      "3. After 4 focus sessions, take a longer 15–30 minute break.",
      "4. If a task takes more than 4 sessions, split it into smaller tasks.",
      "5. End of the day: tick off what you finished and move the rest to tomorrow.",
    ].join("\n"),
  });
  add({
    id: "bot-2", kind: "note", from: "rafi", to: "all", time: now - 9 * 60000,
    name: "Newton-Raphson & Bisection cheat sheet",
    text: [
      "NEWTON-RAPHSON",
      "x(n+1) = x(n) − f(x(n)) / f′(x(n))",
      "Stop when |x(n+1) − x(n)| < tolerance.",
      "Converges fast (quadratically) near a simple root.",
      "Can fail if f′(x) is close to 0 or the first guess is far from the root.",
      "",
      "BISECTION",
      "Start with a and b where f(a) and f(b) have opposite signs.",
      "c = (a + b) / 2. Keep the half where the sign changes.",
      "Error after n steps ≤ (b − a) / 2^n.",
      "Slow but always converges.",
      "",
      "SECANT",
      "x(n+1) = x(n) − f(x(n)) · (x(n) − x(n−1)) / (f(x(n)) − f(x(n−1)))",
      "Like Newton-Raphson but needs no derivative.",
    ].join("\n"),
  });

  return { openShare };
})();
