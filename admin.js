// admin.js — the admin panel: reported files, blocked people, storage and cleanup.
// Only shown to emails listed in the admins table; the server checks every action too.
(() => {
  const REASONS = {
    "not-study": "Not study material",
    offensive: "Offensive",
    copyright: "Shouldn’t be shared",
    spam: "Spam",
    other: "Other",
  };
  let tab = "reports";

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const btn = (label, fn, cls = "btn small") => {
    const b = el("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  };
  // a button that asks "Sure?" before doing something you can't undo
  const sureBtn = (label, fn) => {
    const b = btn(label, async () => {
      if (b.dataset.sure !== "yes") {
        b.dataset.sure = "yes";
        b.textContent = label + "?";
        setTimeout(() => { b.dataset.sure = ""; b.textContent = label; }, 3000);
        return;
      }
      b.disabled = true;
      try { await fn(); } catch (err) { toast("That didn’t work: " + (err.message || err)); b.disabled = false; }
    });
    return b;
  };
  const when = (t) => new Date(t).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  function setTab(t) {
    tab = t;
    document.querySelectorAll("#adminCard .seg").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === t)));
    render();
  }

  async function render() {
    const body = $("adminBody");
    body.innerHTML = "";
    body.append(el("p", "admin-empty", "Loading…"));
    try {
      if (tab === "reports") await renderReports(body);
      if (tab === "blocked") await renderBlocked(body);
      if (tab === "storage") await renderStorage(body);
      if (tab === "visitors") await renderVisitors(body);
    } catch (err) {
      body.innerHTML = "";
      body.append(el("p", "admin-empty", "Couldn’t load this: " + (err.message || err)));
    }
  }

  async function openShare(s) {
    if (s.kind === "note") {
      $("viewTitle").textContent = s.name;
      $("viewMeta").textContent = `Reported · from ${s.from_name}`;
      const pre = el("pre", null, s.note || "");
      $("viewBody").innerHTML = "";
      $("viewBody").append(pre);
      $("viewCard").hidden = false;
      return;
    }
    toast("Downloading…", 0);
    const blob = await Net.download(s.path);
    toast("", 1);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    if (/pdf|image/.test(s.mime || "")) { a.target = "_blank"; a.rel = "noopener"; } else a.download = s.name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function renderReports(body) {
    const rows = await Net.Admin.reports();
    body.innerHTML = "";
    // group the reports by file
    const groups = new Map();
    for (const r of rows) {
      if (!r.shares) continue;
      const g = groups.get(r.share_id) || { share: r.shares, sender: r.sender_email, reasons: [], last: r.created_at };
      g.reasons.push(r.reason);
      groups.set(r.share_id, g);
    }
    if (!groups.size) { body.append(el("p", "admin-empty", "No reports. All quiet.")); return; }
    for (const [id, g] of groups) {
      const s = g.share;
      const item = el("div", "admin-item");
      const top = el("div", "row");
      top.append(el("strong", null, s.name));
      top.append(el("span", "chip-tag" + (g.reasons.length >= 3 ? " warn" : ""), `${g.reasons.length} report${g.reasons.length > 1 ? "s" : ""}`));
      if (s.hidden) top.append(el("span", "chip-tag warn", "Hidden"));
      const counts = {};
      for (const r of g.reasons) counts[r] = (counts[r] || 0) + 1;
      const why = Object.entries(counts).map(([r, n]) => `${REASONS[r] || r}${n > 1 ? " ×" + n : ""}`).join(", ");
      const meta = el("span", "meta", `${s.kind === "note" ? "Note" : "File"} from ${s.from_name} (${g.sender || "unknown email"}) · ${why} · last report ${when(g.last)}`);
      const actions = el("div", "row");
      actions.append(
        btn("Open", () => openShare(s).catch(() => toast("Couldn’t open it."))),
        sureBtn("Remove", async () => { await Net.Admin.remove(id, s.path); toast(`Removed “${s.name}”.`); render(); }),
        sureBtn("Dismiss", async () => { await Net.Admin.dismiss(id); toast("Reports dismissed. The file is visible again."); render(); }),
      );
      if (g.sender) actions.append(sureBtn("Block sender", async () => {
        await Net.Admin.block(g.sender, `Reported: ${why}`);
        await Net.Admin.remove(id, s.path);
        toast(`Blocked ${g.sender} and removed the file.`);
        render();
      }));
      item.append(top, meta, actions);
      body.append(item);
    }
  }

  async function renderBlocked(body) {
    const rows = await Net.Admin.blocked();
    body.innerHTML = "";
    const form = el("form", "task-form");
    const input = el("input");
    input.type = "email";
    input.id = "blockEmail";
    input.placeholder = "student@iub.edu.bd";
    input.setAttribute("aria-label", "Email to block");
    const add = el("button", "btn small", "Block");
    add.type = "submit";
    form.append(input, add);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = input.value.trim().toLowerCase();
      if (!/^[^@\s]+@iub\.edu\.bd$/.test(email)) { toast("Enter an @iub.edu.bd email."); return; }
      try { await Net.Admin.block(email, "Blocked by admin"); toast(`Blocked ${email}.`); render(); }
      catch (err) { toast("Couldn’t block: " + (err.message || err)); }
    });
    body.append(form);
    if (!rows.length) { body.append(el("p", "admin-empty", "Nobody is blocked.")); return; }
    for (const r of rows) {
      const item = el("div", "admin-item");
      const top = el("div", "row");
      top.append(el("strong", null, r.email));
      const meta = el("span", "meta", `${r.reason || "No reason"} · ${when(r.created_at)}`);
      const actions = el("div", "row");
      actions.append(sureBtn("Unblock", async () => { await Net.Admin.unblock(r.email); toast(`Unblocked ${r.email}.`); render(); }));
      item.append(top, meta, actions);
      body.append(item);
    }
  }

  // ---------- visitors ----------
  let days = 30, search = "";
  const studentId = (email) => String(email || "").split("@")[0];
  const duration = (min) => {
    min = Math.max(1, Number(min) || 0);
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h} h${m ? " " + m + " min" : ""}` : `${m} min`;
  };
  const day = (t) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short" });

  function downloadCsv(rows) {
    const head = ["Student ID", "Email", "Google name", "Avatar name", "Visits", "Minutes", "First seen", "Last seen"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(",")].concat(rows.map((r) => [
      studentId(r.email), r.email, r.google_name, r.name, r.visits, r.minutes,
      new Date(r.first_seen).toISOString(), new Date(r.last_seen).toISOString(),
    ].map(esc).join(",")));
    const url = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `nook-visitors-${days}-days.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function renderVisitors(body) {
    let rows, recent;
    try {
      [rows, recent] = await Promise.all([Net.Admin.visitors(days), Net.Admin.recentVisits(60)]);
    } catch (err) {
      body.innerHTML = "";
      const missing = /admin_visitors|admin_recent_visits|does not exist|schema cache/i.test(err.message || "");
      body.append(el("p", "admin-empty", missing
        ? "Visit history isn’t set up yet. Run supabase/visits.sql in the Supabase SQL Editor, then open this tab again."
        : "Couldn’t load visitors: " + (err.message || err)));
      return;
    }
    body.innerHTML = "";

    // range + search + download
    const bar = el("div", "row visitors-bar");
    for (const d of [7, 30, 90]) {
      const b = btn(`${d} days`, () => { days = d; render(); }, "btn small" + (d === days ? " on" : ""));
      b.setAttribute("aria-pressed", String(d === days));
      bar.append(b);
    }
    const find = el("input");
    find.type = "search";
    find.placeholder = "Search ID or name";
    find.setAttribute("aria-label", "Search visitors");
    find.value = search;
    bar.append(find, btn("Download CSV", () => downloadCsv(rows)));
    body.append(bar);

    const here = rows.filter((r) => r.online).length;
    const total = rows.reduce((a, r) => a + Number(r.visits), 0);
    body.append(el("p", "fine", `${rows.length} student${rows.length === 1 ? "" : "s"} in the last ${days} days · ${here} here now · ${total} visits`));

    const listBox = el("div", "admin-list");
    body.append(listBox);
    function drawList() {
      listBox.innerHTML = "";
      const q = search.trim().toLowerCase();
      const shown = rows.filter((r) => !q || [r.email, r.name, r.google_name].some((v) => String(v || "").toLowerCase().includes(q)));
      if (!shown.length) { listBox.append(el("p", "admin-empty", rows.length ? "Nobody matches that." : "No visits yet.")); return; }
      for (const r of shown) {
        const item = el("div", "admin-item");
        const top = el("div", "row");
        top.append(el("strong", null, r.name || "(no avatar name)"));
        top.append(el("span", "chip-tag", studentId(r.email)));
        if (r.online) top.append(el("span", "chip-tag here", "Here now"));
        item.append(top);
        item.append(el("span", "meta", `${r.email}${r.google_name ? " · Google name: " + r.google_name : ""}`));
        item.append(el("span", "meta",
          `${r.visits} visit${Number(r.visits) === 1 ? "" : "s"} · ${duration(r.minutes)} in total · first ${day(r.first_seen)} · last ${when(r.last_seen)}`));
        listBox.append(item);
      }
    }
    find.addEventListener("input", () => { search = find.value; drawList(); });
    drawList();

    // the latest individual visits
    body.append(el("h3", "admin-sub", "Latest visits"));
    if (!recent.length) { body.append(el("p", "admin-empty", "No visits yet.")); return; }
    const ul = el("ul", "visit-log");
    for (const v of recent) {
      const mins = Math.ceil((new Date(v.last_seen) - new Date(v.started_at)) / 60000);
      const li = el("li");
      li.append(el("strong", null, v.name || studentId(v.email)));
      li.append(el("span", "meta", `${studentId(v.email)} · ${when(v.started_at)} · ${duration(mins)}`));
      ul.append(li);
    }
    body.append(ul);
  }

  async function renderStorage(body) {
    const s = await Net.Admin.storage();
    body.innerHTML = "";
    const mb = s.bytes / 1048576;
    const pct = Math.min(100, (mb / 1024) * 100);
    const item = el("div", "admin-item");
    item.append(el("strong", null, `${mb.toFixed(1)} MB of 1 GB used (${pct.toFixed(1)}%)`));
    const meter = el("div", "meter");
    const fill = el("span");
    fill.style.width = Math.max(1, pct) + "%";
    meter.append(fill);
    item.append(meter);
    item.append(el("span", "meta", `${s.files} files and ${s.notes} notes shared · ${s.old} older than 30 days`));
    const actions = el("div", "row");
    actions.append(sureBtn("Clean up files older than 30 days", async () => {
      const n = await Net.Admin.cleanupOld();
      toast(`Cleaned up ${n} old share${n === 1 ? "" : "s"}.`);
      render();
    }));
    item.append(actions);
    body.append(item);
    body.append(el("p", "fine", "Each student’s own shares are also removed automatically 30 days after they shared them, the next time they open Nook."));
  }

  $("adminBtn").addEventListener("click", () => { $("adminCard").hidden = false; setTab("reports"); });
  $("adminClose").addEventListener("click", () => { $("adminCard").hidden = true; });
  document.querySelectorAll("#adminCard .seg").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
})();
