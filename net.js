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

  async function start(initial) {
    const configured = cfg.url && cfg.key && !cfg.key.startsWith("PASTE_");
    if (!configured || !window.supabase) return false;
    try {
      sb = window.supabase.createClient(cfg.url, cfg.key);
      let { data: { session } } = await sb.auth.getSession();
      if (!session) {
        const { data, error } = await sb.auth.signInAnonymously();
        if (error) throw error;
        session = data.session;
      }
      me = session.user.id;
      state = { ...initial, id: me };
      joinRoom();
      await loadShares();
      watchShares();
      online = true;
      return true;
    } catch (err) {
      console.warn("Nook is running offline:", err);
      return false;
    }
  }

  // ---------- the library room: presence + movement ----------
  function joinRoom() {
    room = sb.channel("library-main", {
      config: { presence: { key: me }, broadcast: { self: false } },
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
    trackTimer = setTimeout(() => room.track(state), 300);
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
    sb.channel("shares-feed")
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

  return {
    start, on, update, sendPos,
    shareNote, shareFile, download, unshare,
    get online() { return online; },
    get me() { return me; },
  };
})();
