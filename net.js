// net.js — everything that talks to Supabase: sign-in, who is in the library,
// movement, and shared files. If Supabase can't be reached, Nook keeps working solo.
const Net = (() => {
  const cfg = window.NOOK_CONFIG || {};
  const BUCKET = "materials";
  let sb = null;
  let me = null;
  let room = null;
  let online = false;
  let state = {};          // what others see about you (avatar, desk, timer, position)
  let trackTimer = null;
  const handlers = {};

  const on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); };
  const emit = (name, arg) => (handlers[name] || []).forEach((fn) => fn(arg));

  const DOMAIN = String(cfg.domain || "iub.edu.bd").toLowerCase();
  let user = null;
  let admin = false;

  function client() {
    if (!sb) sb = window.supabase.createClient(cfg.url, cfg.key);
    return sb;
  }
  const configured = () => cfg.url && cfg.key && !cfg.key.startsWith("PASTE_") && window.supabase;
  const isAllowed = (email) => String(email || "").toLowerCase().endsWith("@" + DOMAIN);

  // returns { status: "online" | "login" | "offline", error? }
  async function start(initial) {
    if (!configured()) return { status: "offline" };
    try {
      const { data: { session } } = await client().auth.getSession();
      if (!session) return { status: "login" };
      if (!isAllowed(session.user.email)) {
        const email = session.user.email;
        await sb.auth.signOut();
        return { status: "login", error: email ? `${email} isn’t an IUB address. Pick your @${DOMAIN} account.` : null };
      }
      user = session.user;
      me = user.id;
      const { data: st } = await sb.rpc("my_status");
      if (st && st.blocked) return { status: "blocked" };
      admin = !!(st && st.admin);
      state = { ...initial, id: me };
      joinRoom();
      await loadShares();
      watchShares();
      online = true;
      return { status: "online" };
    } catch (err) {
      console.warn("Nook is running offline:", err);
      return { status: "offline" };
    }
  }

  // Google sign-in; hd= asks Google to show IUB accounts first
  async function signIn() {
    const { error } = await client().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: location.origin + location.pathname,
        queryParams: { hd: DOMAIN, prompt: "select_account" },
      },
    });
    if (error) throw error;
  }
  async function signOut() {
    try { await client().auth.signOut(); } catch { /* ignore */ }
  }

  // ---------- the library room: presence + movement ----------
  function joinRoom() {
    room = sb.channel("library-main", {
      config: { private: true, presence: { key: me }, broadcast: { self: false } },
    });

    room.on("presence", { event: "sync" }, () => {
      const people = [];
      const all = room.presenceState();
      for (const key in all) {
        if (key === me) continue;
        const metas = all[key];
        if (metas && metas.length) people.push(metas[metas.length - 1]);
      }
      emit("people", people);
    });

    room.on("broadcast", { event: "pos" }, ({ payload }) => {
      if (payload && payload.id !== me) emit("pos", payload);
    });

    room.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await room.track(state);
        emit("status", "online");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        emit("status", "offline");
      }
    });
  }

  // change what others see about you (sent at most ~3 times a second)
  function update(partial) {
    state = { ...state, ...partial };
    if (!room) return;
    clearTimeout(trackTimer);
    trackTimer = setTimeout(() => { if (room) room.track(state); }, 300);
  }

  function sendPos(x, y, moving) {
    if (!room) return;
    room.send({ type: "broadcast", event: "pos", payload: { id: me, x: Math.round(x), y: Math.round(y), m: moving } });
  }

  // ---------- shared files and notes ----------
  async function loadShares() {
    const { data, error } = await sb.from("shares").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) { console.warn("Could not load shared files:", error); return; }
    emit("shares", data);
  }

  function watchShares() {
    sb.channel("shares-feed", { config: { private: true } })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "shares" }, (p) => emit("share", p.new))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "shares" }, (p) => emit("unshare", p.old && p.old.id))
      .subscribe();
  }

  async function shareNote({ name, text, toId, toName, fromName }) {
    const { data, error } = await sb.from("shares")
      .insert({ kind: "note", name, note: text, to_id: toId, to_name: toName, from_name: fromName })
      .select().single();
    if (error) throw error;
    return data;
  }

  async function shareFile({ file, mime, toId, toName, fromName }) {
    const id = crypto.randomUUID();
    const safeName = file.name.replace(/[^\w.\- ()]+/g, "_").slice(-100);
    const path = `${me}/${id}/${safeName}`;
    const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false });
    if (up.error) throw up.error;
    const { data, error } = await sb.from("shares")
      .insert({ id, kind: "file", name: file.name.slice(0, 120), path, size: file.size, mime, to_id: toId, to_name: toName, from_name: fromName })
      .select().single();
    if (error) {
      await sb.storage.from(BUCKET).remove([path]);
      throw error;
    }
    return data;
  }

  async function download(path) {
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    if (error) throw error;
    return data;
  }

  async function unshare(id, path) {
    if (path) await sb.storage.from(BUCKET).remove([path]);
    const { error } = await sb.from("shares").delete().eq("id", id);
    if (error) throw error;
  }

  // leave the room (others stop seeing you) and come back later
  async function leave() {
    if (!room) return;
    const r = room;
    room = null;
    try { await r.untrack(); } catch { /* ignore */ }
    sb.removeChannel(r);
  }
  function rejoin() {
    if (!sb || room) return;
    joinRoom();
  }

  // ---------- reports and cleanup ----------
  async function report(shareId, reason) {
    const { error } = await sb.from("reports").insert({ share_id: shareId, reason });
    if (error && error.code !== "23505") throw error; // 23505 = already reported
  }

  // delete your own shares older than 30 days
  async function cleanupMine() {
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
    const { data } = await sb.from("shares").select("id, path").eq("from_id", me).lt("created_at", cutoff);
    if (!data || !data.length) return;
    const paths = data.map((r) => r.path).filter(Boolean);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    await sb.from("shares").delete().in("id", data.map((r) => r.id));
  }

  // ---------- admin ----------
  const Admin = {
    async reports() {
      const { data, error } = await sb.from("reports")
        .select("id, reason, created_at, sender_email, share_id, shares(id, kind, name, note, path, size, mime, from_name, created_at, hidden)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    async dismiss(shareId) {
      const { error } = await sb.from("reports").delete().eq("share_id", shareId);
      if (error) throw error;
      await sb.from("shares").update({ hidden: false }).eq("id", shareId);
    },
    remove: (id, path) => unshare(id, path),
    async blocked() {
      const { data, error } = await sb.from("blocked").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    async block(email, reason) {
      const { error } = await sb.from("blocked").insert({ email: String(email).toLowerCase(), reason });
      if (error && error.code !== "23505") throw error;
    },
    async unblock(email) {
      const { error } = await sb.from("blocked").delete().eq("email", email);
      if (error) throw error;
    },
    async storage() {
      const { data, error } = await sb.rpc("storage_used");
      if (error) throw error;
      return data;
    },
    async cleanupOld() {
      const { data, error } = await sb.rpc("old_share_paths", { n_days: 30 });
      if (error) throw error;
      const paths = (data || []).map((r) => r.path).filter(Boolean);
      for (let i = 0; i < paths.length; i += 100) await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100));
      const res = await sb.rpc("delete_old_shares", { n_days: 30 });
      if (res.error) throw res.error;
      return res.data;
    },
  };

  return {
    start, on, update, sendPos, leave, rejoin, signIn, signOut, report, cleanupMine, Admin,
    get admin() { return admin; },
    get user() { return user; },
    get domain() { return DOMAIN; },
    shareNote, shareFile, download, unshare,
    get online() { return online; },
    get me() { return me; },
  };
})();
