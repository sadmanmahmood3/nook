// share.js — share files and notes with people in the library.
// Online: files go to Supabase Storage and only reach the people they're meant for.
// Offline: shared items stay in this browser.
const Share = (() => {
  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
  const TYPES = {
    pdf: "application/pdf", txt: "text/plain", md: "text/markdown",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    zip: "application/zip",
  };
  const IMAGES = ["png", "jpg", "jpeg", "webp"];
  const TEXTS = ["txt", "md"];

  let items = [];      // newest first
  let kind = "file";
  let chosen = null;   // the File picked in the share sheet
  let filter = null;   // show only items from this person
  let viewing = null;  // item open in the viewer
  let sending = false;

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
    if (m < 60 * 24) return Math.round(m / 60) + " h ago";
    return Math.round(m / 1440) + " d ago";
  }
  function badgeText(it) {
    if (it.kind === "note") return "NOTE";
    const e = extOf(it.name);
    return ({ jpeg: "JPG", docx: "DOC", pptx: "PPT", xlsx: "XLS", webp: "IMG" }[e] || e.toUpperCase()).slice(0, 4);
  }
  function nameFor(id, fallback) {
    if (id === "me") return "You";
    const p = World.people().find((x) => x.id === id);
    if (p) return p.name + (p.bot ? " (bot)" : "");
    return fallback || "Someone";
  }
  const fromLabel = (it) => nameFor(it.from, it.fromName);
  function audience(it) {
    if (it.to === "all") return "Everyone";
    if (it.to === "me") return "To you";
    return "To " + nameFor(it.to, it.toName);
  }
  function errorText(err) {
    const msg = (err && (err.message || err.error)) || String(err);
    if (/mime|type/i.test(msg)) return "That file type isn’t allowed.";
    if (/size|large|exceed/i.test(msg)) return "That file is too big. The limit is 10 MB.";
    if (/network|fetch/i.test(msg)) return "Couldn’t reach the server. Check your internet and try again.";
    return "Sharing failed: " + msg;
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

  // turn a row from the database into a list item
  function fromRow(r) {
    const me = Net.me;
    return {
      id: r.id, kind: r.kind, name: r.name, size: r.size || 0, text: r.note || "",
      path: r.path, mime: r.mime,
      from: r.from_id === me ? "me" : r.from_id, fromName: r.from_name,
      to: r.to_id == null ? "all" : r.to_id === me ? "me" : r.to_id, toName: r.to_name,
      time: Date.parse(r.created_at) || Date.now(), remote: true,
    };
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
    if (items.some((x) => x.id === it.id)) return false;
    items.push(it);
    items.sort((a, b) => b.time - a.time);
    World.setFileCounts(counts());
    render();
    return true;
  }
  function remove(id) {
    items = items.filter((x) => x.id !== id);
    World.setFileCounts(counts());
    render();
  }

  function render() {
    const mine = items.filter(canSee);
    const visible = mine.filter((it) => !filter || it.from === filter);

    $("filesCount").textContent = mine.length ? String(mine.length) : "";
    $("filesFilter").hidden = !filter;
    if (filter) $("filesFilterText").textContent = `Shared by ${nameFor(filter, (items.find((x) => x.from === filter) || {}).fromName)}`;

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
      const parts = [fromLabel(it), audience(it), ago(it.time)];
      if (it.size) parts.splice(1, 0, sizeText(it.size));
      meta.textContent = parts.join(" · ");
      main.append(title, meta);

      const actions = document.createElement("div");
      actions.className = "file-actions";
      const button = (label, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn small";
        b.textContent = label;
        b.addEventListener("click", fn);
        actions.appendChild(b);
        return b;
      };
      button("Open", () => openItem(it));
      button("Save", () => saveItem(it));
      if (it.from === "me") button("Remove", (e) => removeItem(it, e.currentTarget));

      li.append(badge, main, actions);
      list.appendChild(li);
    }
  }

  // ---------- opening, saving, removing ----------
  async function blobOf(it) {
    if (it.blob) return it.blob;
    if (it.path) {
      toast("Downloading…", 0);
      try {
        it.blob = await Net.download(it.path);
        toast("", 1);
      } catch (err) {
        toast("Couldn’t download that file. It may have been removed.");
        throw err;
      }
    }
    return it.blob;
  }

  async function openItem(it) {
    const ext = extOf(it.name);
    try {
      if (it.kind === "note" || TEXTS.includes(ext) || IMAGES.includes(ext)) {
        const blob = it.kind === "note" ? null : await blobOf(it);
        viewing = it;
        $("viewTitle").textContent = it.name;
        $("viewMeta").textContent = `${fromLabel(it)} · ${audience(it)} · ${ago(it.time)}`;
        const body = $("viewBody");
        body.innerHTML = "";
        if (IMAGES.includes(ext)) {
          const img = document.createElement("img");
          img.alt = it.name;
          img.src = URL.createObjectURL(blob);
          body.appendChild(img);
        } else {
          const pre = document.createElement("pre");
          pre.textContent = it.kind === "note" ? it.text : await blob.text();
          body.appendChild(pre);
        }
        $("viewCard").hidden = false;
        return;
      }
      const blob = await blobOf(it);
      if (ext === "pdf") { openInTab(blob); return; }
      // Word, slides, sheets, zip: browsers can't show these, so save them
      download(blob, it.name);
      toast(`Saved ${it.name}. Open it from your downloads.`);
    } catch { /* toast already shown */ }
  }

  async function saveItem(it) {
    if (it.kind === "note") {
      download(new Blob([it.name + "\n\n" + it.text], { type: "text/plain" }), it.name.replace(/[\\/:*?"<>|]/g, "-") + ".txt");
      return;
    }
    try { download(await blobOf(it), it.name); } catch { /* toast already shown */ }
  }

  async function removeItem(it, btn) {
    if (btn.dataset.sure !== "yes") {
      btn.dataset.sure = "yes";
      btn.textContent = "Remove?";
      setTimeout(() => { btn.dataset.sure = ""; btn.textContent = "Remove"; }, 3000);
      return;
    }
    try {
      if (it.remote) await Net.unshare(it.id, it.path);
      remove(it.id);
      toast(`Removed “${it.name}”.`);
    } catch {
      toast("Couldn’t remove it. Try again.");
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
    if (!TYPES[ext]) {
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
    sel.add(new Option("Everyone in the library", "all"));
    // online, you can only send privately to real students
    const people = World.people().filter((p) => (Net.online ? p.real : true));
    for (const p of people) sel.add(new Option(p.name + (p.bot ? " (bot)" : ""), p.id));
    sel.value = to || "all";
    setKind("file");
    $("shareSubmit").disabled = false;
    $("shareSubmit").textContent = "Share";
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
  $("shareCancel").addEventListener("click", () => { if (!sending) $("shareCard").hidden = true; });

  $("shareCard").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sending) return;
    const to = $("shareTo").value;
    const toName = to === "all" ? null : nameFor(to).replace(/ \(bot\)$/, "").slice(0, 16);
    const fromName = (store.get("look", {}).name || "Student").slice(0, 16);
    const text = $("noteText").value.trim();
    const noteName = ($("noteTitle").value.trim() || "Note").slice(0, 120);

    if (kind === "file" && !chosen) { $("shareError").textContent = "Choose a file first."; return; }
    if (kind === "note" && !text) { $("shareError").textContent = "Write something in the note first."; return; }

    let item;
    if (Net.online) {
      sending = true;
      $("shareSubmit").disabled = true;
      $("shareSubmit").textContent = kind === "file" ? "Uploading…" : "Sharing…";
      try {
        const toId = to === "all" ? null : to;
        const row = kind === "file"
          ? await Net.shareFile({ file: chosen, mime: TYPES[extOf(chosen.name)], toId, toName, fromName })
          : await Net.shareNote({ name: noteName, text, toId, toName, fromName });
        item = fromRow(row);
        if (kind === "file") item.blob = chosen;
      } catch (err) {
        $("shareError").textContent = errorText(err);
        $("shareSubmit").disabled = false;
        $("shareSubmit").textContent = "Try again";
        sending = false;
        return;
      }
      sending = false;
    } else if (kind === "file") {
      item = { id: "local-" + Date.now(), kind: "file", name: chosen.name, size: chosen.size, blob: chosen, from: "me", fromName, to, toName, time: Date.now() };
    } else {
      item = { id: "local-" + Date.now(), kind: "note", name: noteName, text, from: "me", fromName, to, toName, time: Date.now() };
    }
    add(item);
    $("shareCard").hidden = true;
    toast(`Shared “${item.name}” with ${to === "all" ? "everyone" : toName}.`);
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

  // ---------- live updates from other students ----------
  Net.on("shares", (rows) => { for (const r of rows) add(fromRow(r)); });
  Net.on("share", (row) => {
    const it = fromRow(row);
    if (add(it) && it.from !== "me" && canSee(it)) {
      toast(it.to === "me"
        ? `${it.fromName} shared “${it.name}” with you.`
        : `${it.fromName} shared “${it.name}” with everyone.`, 4500);
    }
  });
  Net.on("unshare", (id) => { if (id) remove(id); });

  // ---------- study material the bots brought (real content, clearly from bots) ----------
  const now = Date.now();
  add({
    id: "bot-1", kind: "note", from: "nabila", fromName: "Nabila (bot)", to: "all", time: now - 26 * 60000,
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
    id: "bot-2", kind: "note", from: "rafi", fromName: "Rafi (bot)", to: "all", time: now - 9 * 60000,
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
