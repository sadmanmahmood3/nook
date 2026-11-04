// world.js — the library: room, desks, characters, walking and sitting.
// Everything is drawn on one <canvas>; no image files needed.
const World = (() => {
  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- world size (logical units, scaled to the screen) ----------
  const WW = 1600, WH = 900, WALL = 430;

  // ---------- looks ----------
  const SKINS = ["#f6d7bd", "#e8b98f", "#c98e5f", "#9a6440", "#6e4428"];
  const HAIR_COLORS = ["#1f1a17", "#4a2f20", "#8a5a33", "#2f3e5c", "#8a3b4a", "#d8c7b0"];
  const SHIRTS = ["#e0793f", "#3f7f8c", "#6c5aa6", "#d4b14a", "#4f7a52", "#c2525c", "#2c3e66"];
  const HAIRSTYLES = ["short", "long", "bun", "hijab"];

  const ROOM = {
    wall: "#c9d6bd", wallLow: "#b8c7ab", wainscot: "#a9bb9c", trim: "#f1ebdf",
    floor: "#d3a87a", floorLine: "rgba(110,70,40,0.16)", rug: "#8ba596", rugEdge: "#e7dcc6",
    wood: "#8d5f3b", woodDark: "#6b4429", shelfBack: "#5a3a24",
    deskTop: "#c48a57", deskEdge: "#9c693d", chair: "#5f7f5c", chairDark: "#4a6648",
    frame: "#f4efe6", lampShade: "#2f5b4f",
  };

  const MOOD = {
    morning: { sky: ["#8fc6e6", "#d3e8f1", "#f7dcbc"], far: "#9fbe9a", near: "#6f9670", bld: "#c4b49d", lit: "#f3eadb", litA: 0.45, litThreshold: 0.25, dark: 0, darkCol: "0,0,0", lamp: 0.1, beams: true },
    rain:    { sky: ["#5f7182", "#7f8d98", "#9aa5ad"], far: "#5a6d67", near: "#44574f", bld: "#5f6a74", lit: "#c9d3cf", litA: 0.7, litThreshold: 0.7, dark: 0.26, darkCol: "34,46,60", lamp: 0.55, rain: true },
    night:   { sky: ["#070a24", "#151a46", "#2c2f66"], far: "#161c3a", near: "#0e1229", bld: "#1d2242", lit: "#ffd685", litA: 0.9, litThreshold: 0.55, dark: 0.55, darkCol: "10,12,38", lamp: 1, stars: true },
    cafe:    { sky: ["#2c2346", "#7a4a63", "#e8925a"], far: "#3e2b38", near: "#2c1f28", bld: "#3e2c33", lit: "#ffcb85", litA: 0.9, litThreshold: 0.45, dark: 0.36, darkCol: "52,24,12", lamp: 0.9, strings: true },
  };

  // ---------- helpers ----------
  function seeded(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const depth = (y) => 0.82 + 0.18 * (y - WALL) / (WH - WALL);

  function rrect(g, x, y, w, h, r) {
    g.beginPath();
    g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h);
  }

  // ---------- layout of the room ----------
  const ROWS = [560, 700, 840];          // desk front edges
  const COLS = [280, 620, 980, 1320];    // desk centres
  const WINDOWS = [310, 800, 1290].map((cx) => ({ cx, x: cx - 115, w: 230, top: 60, bottom: 330, r: 115 }));
  const SHELVES = [[10, 170], [450, 650], [950, 1150], [1430, 1590]];

  const desks = [];
  ROWS.forEach((y, r) => COLS.forEach((x) => {
    const k = depth(y);
    desks.push({ id: desks.length, x, y, k, seatY: y - 40 * k, occupant: null });
  }));

  // books on the shelves (fixed pattern)
  const BOOK_COLORS = ["#b5523b", "#3f6b78", "#d8a54a", "#5b7d4f", "#7a4f7d", "#e6dccb", "#2f4057", "#a3643d"];
  const shelfBooks = SHELVES.map(([x0, x1], si) => {
    const r = seeded(100 + si);
    return [150, 220, 290, 360].map((shelfY) => {
      const books = [];
      let x = x0 + 14;
      while (x < x1 - 22) {
        const w = 8 + r() * 9;
        const h = 36 + r() * 22;
        books.push({ x, w, h, c: BOOK_COLORS[Math.floor(r() * BOOK_COLORS.length)], lean: r() < 0.06 });
        x += w + 1 + (r() < 0.12 ? 10 : 0);
      }
      return { y: shelfY, books };
    });
  });

  // skyline seen through the windows
  const buildings = [];
  {
    const r = seeded(2320);
    let x = 170;
    while (x < 1440) {
      const w = 50 + r() * 80, h = 40 + r() * 80;
      const lit = Array.from({ length: 60 }, () => r());
      buildings.push({ x, w, h, lit, shade: r() < 0.5 });
      x += w + 6 + r() * 18;
    }
  }

  // moving bits
  const rnd = Math.random;
  const stars = Array.from({ length: 80 }, () => ({ x: 180 + rnd() * 1240, y: 65 + rnd() * 170, s: 0.6 + rnd() * 1.4, p: rnd() * 6.3 }));
  const clouds = Array.from({ length: 6 }, () => ({ x: rnd() * 1600, y: 90 + rnd() * 100, s: 0.7 + rnd() * 0.7, v: 6 + rnd() * 8 }));
  const streaks = Array.from({ length: 140 }, () => ({ x: 180 + rnd() * 1240, y: 60 + rnd() * 270, l: 10 + rnd() * 14, v: 380 + rnd() * 200 }));
  const drops = Array.from({ length: 30 }, () => { const w = WINDOWS[Math.floor(rnd() * 3)]; return { x: w.x + 8 + rnd() * (w.w - 16), y: 80 + rnd() * 240, r: 1.4 + rnd() * 2.6, v: rnd() < 0.35 ? 8 + rnd() * 20 : 0, win: w }; });
  const motes = Array.from({ length: 34 }, () => ({ x: 200 + rnd() * 1300, y: 150 + rnd() * 600, v: 4 + rnd() * 8, p: rnd() * 6.3 }));
  const birds = Array.from({ length: 3 }, () => ({ x: rnd() * 1600, y: 100 + rnd() * 70, v: 40 + rnd() * 30, p: rnd() * 6 }));

  // ---------- characters ----------
  function makeChar(look, opts = {}) {
    return { id: opts.id || (look.name || "").toLowerCase(), look, x: 0, y: 0, path: [], state: "stand", seated: null, reserve: null, dir: 1, phase: 0, seed: rnd() * 5000, bot: !!opts.bot, timer: null, studying: false, item: opts.item || "book", idle: 3, files: 0 };
  }

  const player = makeChar({ name: "You", skin: 1, hair: "short", hairColor: 0, shirt: 0 }, { item: "laptop", id: "me" });
  player.x = 800; player.y = 884;

  const bots = [
    { desk: 1, look: { name: "Rafi", skin: 2, hair: "short", hairColor: 0, shirt: 1 }, item: "book" },
    { desk: 6, look: { name: "Nabila", skin: 1, hair: "hijab", hairColor: 4, shirt: 3 }, item: "laptop" },
    { desk: 8, look: { name: "Tanvir", skin: 3, hair: "short", hairColor: 1, shirt: 2 }, item: "book" },
    { desk: 11, look: { name: "Mim", skin: 0, hair: "long", hairColor: 1, shirt: 5 }, item: "book" },
  ].map((b) => {
    const c = makeChar(b.look, { bot: true, item: b.item });
    const d = desks[b.desk];
    c.x = d.x; c.y = d.seatY; c.state = "sit"; c.seated = d; d.occupant = c;
    c.left = 300 + Math.floor(rnd() * 1200); // seconds left on their timer
    return c;
  });

  // Ushain: Nook's host. Always in the library, even after real students arrive.
  const ushain = makeChar({ name: "Ushain", skin: 2, hair: "short", hairColor: 0, shirt: 6, headphones: true }, { id: "ushain", item: "laptop" });
  {
    const d = desks[2];
    ushain.x = d.x; ushain.y = d.seatY; ushain.state = "sit"; ushain.seated = d; d.occupant = ushain;
    ushain.left = 1100;
    ushain.host = true;
    bots.push(ushain); // studies with a timer like the others, but has no "bot" tag
  }

  const librarian = makeChar({ name: "Librarian", skin: 0, hair: "bun", hairColor: 5, shirt: 4 }, { bot: true });
  librarian.x = 110; librarian.y = 490;
  librarian.isLibrarian = true;

  const chars = [player, librarian, ...bots];

  // ---------- walking: collision + path finding ----------
  const FLOOR_TOP = WALL + 45, FLOOR_BOTTOM = WH - 12;

  // true if a character's feet can't stand at (x, y)
  function blocked(x, y) {
    if (x < 60 || x > WW - 60 || y < FLOOR_TOP || y > FLOOR_BOTTOM) return true;
    for (const d of desks) {
      if (Math.abs(x - d.x) < 100 * d.k + 12 && y > d.seatY - 14 && y < d.y + 10) return true;
    }
    return false;
  }
  // the spot right behind a chair, where you step in to sit
  const approach = (d) => ({ x: d.x, y: d.seatY - 24 });

  // a grid of walkable cells, used to find a way around desks
  const CELL = 16;
  const GC = Math.ceil(WW / CELL), GR = Math.ceil(WH / CELL);
  const free = new Uint8Array(GC * GR);
  for (let r = 0; r < GR; r++) for (let c = 0; c < GC; c++) {
    free[r * GC + c] = blocked(c * CELL + CELL / 2, r * CELL + CELL / 2) ? 0 : 1;
  }
  const cellOf = (x, y) => [clamp(Math.floor(x / CELL), 0, GC - 1), clamp(Math.floor(y / CELL), 0, GR - 1)];

  function nearestFree(c, r) {
    if (free[r * GC + c]) return [c, r];
    for (let rad = 1; rad < 14; rad++) {
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
        const cc = c + dc, rr = r + dr;
        if (cc >= 0 && rr >= 0 && cc < GC && rr < GR && free[rr * GC + cc]) return [cc, rr];
      }
    }
    return [c, r];
  }

  function lineClear(a, b) {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (blocked(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
  }

  // breadth-first search over the grid, then cut corners where the way is clear
  function findPath(from, to) {
    const [sc, sr] = nearestFree(...cellOf(from.x, from.y));
    const [gc, gr] = nearestFree(...cellOf(to.x, to.y));
    const start = sr * GC + sc, goal = gr * GC + gc;
    const prev = new Int32Array(GC * GR).fill(-1);
    prev[start] = start;
    const queue = [start];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      if (cur === goal) break;
      const c = cur % GC, r = (cur / GC) | 0;
      for (const [dc, dr] of dirs) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= GC || nr >= GR) continue;
        const n = nr * GC + nc;
        if (!free[n] || prev[n] !== -1) continue;
        if (dc && dr && (!free[r * GC + nc] || !free[nr * GC + c])) continue;
        prev[n] = cur;
        queue.push(n);
      }
    }
    if (prev[goal] === -1) return [];
    const raw = [];
    for (let n = goal; n !== start; n = prev[n]) raw.push({ x: (n % GC) * CELL + CELL / 2, y: ((n / GC) | 0) * CELL + CELL / 2 });
    raw.reverse();
    if (!blocked(to.x, to.y)) raw.push({ x: to.x, y: to.y });
    const out = [];
    let cur = { x: from.x, y: from.y };
    for (let i = 0; i < raw.length;) {
      let j = raw.length - 1;
      while (j > i && !lineClear(cur, raw[j])) j--;
      out.push(raw[j]);
      cur = raw[j];
      i = j + 1;
    }
    return out;
  }

  const events = {};
  const emit = (name, arg) => (events[name] || []).forEach((fn) => fn(arg));

  // stop whatever the character was doing (standing up if seated)
  function leaveSpot(c) {
    if (c.reserve && !c.seated) { c.reserve.occupant = null; c.reserve = null; }
    if (c.seated) {
      const d = c.seated;
      d.occupant = null; c.seated = null; c.state = "stand";
      const a = approach(d);
      c.x = a.x; c.y = a.y;
      if (c === player) emit("stand");
    }
    c.path = [];
  }

  function walkTo(c, tx, ty, sitDesk) {
    leaveSpot(c);
    const target = sitDesk ? approach(sitDesk) : { x: tx, y: ty };
    const pts = findPath(c, target);
    if (sitDesk) {
      pts.push({ x: sitDesk.x, y: sitDesk.seatY, sit: sitDesk });
      sitDesk.occupant = c;
      c.reserve = sitDesk;
    }
    c.path = pts;
  }

  function sitAt(d) {
    if (!d || (d.occupant && d.occupant !== player)) return false;
    if (player.seated === d || player.reserve === d) return true;
    walkTo(player, 0, 0, d);
    return true;
  }

  function step(c, dt) {
    if (!c.path.length) return;
    const p = c.path[0];
    const dx = p.x - c.x, dy = p.y - c.y;
    const d = Math.hypot(dx, dy);
    const speed = (c.isLibrarian ? 95 : 175) * dt;
    c.state = "walk";
    c.phase += dt * 11;
    if (Math.abs(dx) > 0.5) c.dir = dx > 0 ? 1 : -1;
    if (d <= speed) {
      c.x = p.x; c.y = p.y;
      c.path.shift();
      if (p.sit) {
        c.state = "sit"; c.seated = p.sit; c.reserve = null;
        if (c === player) { player.sitAt = Date.now(); emit("sit", p.sit); }
      }
    } else {
      c.x += (dx / d) * speed;
      c.y += (dy / d) * speed;
    }
    if (!c.path.length && c.state === "walk") c.state = "stand";
  }

  // ---------- drawing: characters ----------
  function drawHead(g, look, hx, hy, t, seed) {
    const skin = SKINS[look.skin] || SKINS[1];
    const hairC = HAIR_COLORS[look.hairColor] || HAIR_COLORS[0];
    if (look.hair === "long") {
      g.fillStyle = hairC;
      rrect(g, hx - 25, hy - 20, 50, 50, 18); g.fill();
    }
    if (look.hair === "hijab") {
      g.fillStyle = hairC;
      g.beginPath(); g.arc(hx, hy, 27, 0, Math.PI * 2); g.fill();
      g.beginPath();
      g.moveTo(hx - 27, hy + 2); g.lineTo(hx - 25, hy + 32); g.lineTo(hx + 25, hy + 32); g.lineTo(hx + 27, hy + 2);
      g.closePath(); g.fill();
      g.fillStyle = skin;
      g.beginPath(); g.ellipse(hx, hy + 2, 17, 19, 0, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = skin;
      g.beginPath(); g.arc(hx, hy, 22, 0, Math.PI * 2); g.fill();
      g.fillStyle = hairC;
      g.beginPath(); g.ellipse(hx, hy - 7, 23, 16, 0, Math.PI, 0); g.fill();
      if (look.hair === "short") {
        g.beginPath(); g.arc(hx - 20, hy - 4, 6, 0, Math.PI * 2); g.arc(hx + 20, hy - 4, 6, 0, Math.PI * 2); g.fill();
      }
      if (look.hair === "bun") {
        g.beginPath(); g.arc(hx, hy - 27, 10, 0, Math.PI * 2); g.fill();
      }
    }
    // face
    const blink = ((t + seed) % 3800) < 120;
    g.fillStyle = "#2a2320";
    g.strokeStyle = "#2a2320";
    g.lineWidth = 1.8;
    if (blink) {
      g.beginPath(); g.moveTo(hx - 10, hy + 4); g.lineTo(hx - 5, hy + 4); g.moveTo(hx + 5, hy + 4); g.lineTo(hx + 10, hy + 4); g.stroke();
    } else {
      g.beginPath(); g.arc(hx - 7.5, hy + 4, 2.7, 0, Math.PI * 2); g.arc(hx + 7.5, hy + 4, 2.7, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = "rgba(232,120,120,0.35)";
    g.beginPath(); g.ellipse(hx - 13, hy + 10, 4, 2.5, 0, 0, Math.PI * 2); g.ellipse(hx + 13, hy + 10, 4, 2.5, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#5b3a2e"; g.lineWidth = 1.6;
    g.beginPath(); g.arc(hx, hy + 9, 3.5, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    if (look.headphones) {
      g.strokeStyle = "#2a2b33"; g.lineWidth = 4;
      g.beginPath(); g.arc(hx, hy - 2, 25, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
      g.fillStyle = "#2a2b33";
      rrect(g, hx - 29, hy - 6, 9, 17, 4); g.fill();
      rrect(g, hx + 20, hy - 6, 9, 17, 4); g.fill();
      g.fillStyle = "#e0793f";
      rrect(g, hx - 28, hy - 2, 3, 9, 1.5); g.fill();
      rrect(g, hx + 25, hy - 2, 3, 9, 1.5); g.fill();
    }
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => clamp(Math.round(v * amt), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  // origin = feet (standing) or seat (sitting)
  function drawCharacter(g, look, pose, t, phase = 0, seed = 0, studying = false) {
    const shirt = SHIRTS[look.shirt] || SHIRTS[0];
    const skin = SKINS[look.skin] || SKINS[1];
    if (pose === "sit") {
      g.fillStyle = shirt;
      rrect(g, -19, -52, 38, 38, 13); g.fill();
      g.fillStyle = shade(shirt, 0.82);
      rrect(g, -26, -46, 9, 28, 5); g.fill();
      rrect(g, 17, -46, 9, 28, 5); g.fill();
      const bob = studying ? Math.sin(t * 0.0022 + seed) * 1.6 : 0;
      drawHead(g, look, 0, -76 + bob, t, seed);
      return;
    }
    // shadow
    g.fillStyle = "rgba(40,25,15,0.18)";
    g.beginPath(); g.ellipse(0, 0, 20, 6, 0, 0, Math.PI * 2); g.fill();
    const walking = pose === "walk";
    const swing = walking ? Math.sin(phase) : 0;
    // legs
    g.fillStyle = "#3b3f52";
    rrect(g, -11, -27 - Math.max(0, swing) * 4, 8, 26, 3); g.fill();
    rrect(g, 3, -27 - Math.max(0, -swing) * 4, 8, 26, 3); g.fill();
    g.fillStyle = "#2a2b33";
    g.beginPath(); g.ellipse(-7, -2 - Math.max(0, swing) * 4, 6, 3.4, 0, 0, Math.PI * 2); g.ellipse(7, -2 - Math.max(0, -swing) * 4, 6, 3.4, 0, 0, Math.PI * 2); g.fill();
    // body + arms
    g.fillStyle = shade(shirt, 0.82);
    rrect(g, -26, -62 + swing * 3, 9, 30, 5); g.fill();
    rrect(g, 17, -62 - swing * 3, 9, 30, 5); g.fill();
    g.fillStyle = skin;
    g.beginPath(); g.arc(-21.5, -31 + swing * 3, 5, 0, Math.PI * 2); g.arc(21.5, -31 - swing * 3, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = shirt;
    rrect(g, -19, -68, 38, 46, 13); g.fill();
    drawHead(g, look, 0, -92 + (walking ? Math.abs(swing) * -1.5 : 0), t, seed);
  }

  // ---------- drawing: room ----------
  function archPath(g, w, inset = 0) {
    const left = w.x + inset, right = w.x + w.w - inset, top = w.top + inset;
    const r = (right - left) / 2;
    g.moveTo(left, w.bottom);
    g.lineTo(left, top + r);
    g.arc(w.cx, top + r, r, Math.PI, 0);
    g.lineTo(right, w.bottom);
    g.closePath();
  }

  function drawOutside(t) {
    const m = mood;
    ctx.save();
    ctx.beginPath();
    WINDOWS.forEach((w) => archPath(ctx, w));
    ctx.clip();

    const sky = ctx.createLinearGradient(0, 60, 0, 330);
    sky.addColorStop(0, m.sky[0]); sky.addColorStop(0.55, m.sky[1]); sky.addColorStop(1, m.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(170, 50, 1260, 290);

    if (m.stars) {
      for (const s of stars) {
        ctx.fillStyle = `rgba(255,255,240,${0.4 + 0.6 * Math.sin(t * 0.0012 + s.p) ** 2})`;
        ctx.fillRect(s.x, s.y, s.s, s.s);
      }
    }

    // sun / moon in the middle window
    if (sceneName !== "rain") {
      const sx = 845, sy = sceneName === "cafe" ? 262 : 135, sr = sceneName === "cafe" ? 34 : 24;
      const halo = ctx.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * 4);
      halo.addColorStop(0, sceneName === "night" ? "rgba(230,230,255,0.25)" : sceneName === "cafe" ? "rgba(255,170,110,0.45)" : "rgba(255,240,200,0.6)");
      halo.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(sx - sr * 4, sy - sr * 4, sr * 8, sr * 8);
      ctx.fillStyle = sceneName === "night" ? "#f4f1df" : sceneName === "cafe" ? "#ffb36b" : "#fff3d6";
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
      if (sceneName === "night") {
        ctx.fillStyle = m.sky[0];
        ctx.beginPath(); ctx.arc(sx + 11, sy - 5, sr * 0.9, 0, Math.PI * 2); ctx.fill();
      }
    }

    if (sceneName === "morning" || sceneName === "rain") {
      ctx.fillStyle = sceneName === "rain" ? "rgba(70,84,96,0.6)" : "rgba(255,255,255,0.8)";
      for (const c of clouds) {
        const s = c.s * 26;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, s * 1.7, s * 0.55, 0, 0, Math.PI * 2);
        ctx.ellipse(c.x + s * 0.6, c.y - s * 0.35, s, s * 0.6, 0, 0, Math.PI * 2);
        ctx.ellipse(c.x - s * 0.7, c.y - s * 0.15, s * 0.8, s * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (sceneName === "morning") {
      ctx.strokeStyle = "rgba(50,60,55,0.7)"; ctx.lineWidth = 1.5;
      for (const b of birds) {
        const flap = Math.sin(t * 0.012 + b.p) * 3;
        ctx.beginPath();
        ctx.moveTo(b.x - 6, b.y - flap); ctx.quadraticCurveTo(b.x - 3, b.y - 2, b.x, b.y + 1);
        ctx.quadraticCurveTo(b.x + 3, b.y - 2, b.x + 6, b.y - flap);
        ctx.stroke();
      }
    }

    // hills
    ctx.fillStyle = m.far;
    ctx.beginPath(); ctx.moveTo(170, 330);
    for (let x = 170; x <= 1430; x += 30) ctx.lineTo(x, 262 + Math.sin(x * 0.012) * 9 + Math.sin(x * 0.005 + 1) * 12);
    ctx.lineTo(1430, 330); ctx.fill();

    // campus buildings
    for (const b of buildings) {
      const top = 305 - b.h;
      ctx.fillStyle = b.shade ? shade(m.bld.length === 7 ? m.bld : "#888888", 0.88) : m.bld;
      ctx.fillRect(b.x, top, b.w, b.h);
      const cols = Math.max(2, Math.floor(b.w / 14)), rows = Math.max(2, Math.floor(b.h / 16));
      const cw = b.w / cols, rh = b.h / rows;
      ctx.fillStyle = m.lit;
      for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++) {
        const v = b.lit[(r * cols + c) % b.lit.length];
        if (v < m.litThreshold) continue;
        ctx.globalAlpha = m.litA;
        ctx.fillRect(b.x + c * cw + cw * 0.3, top + r * rh + rh * 0.3, cw * 0.4, rh * 0.42);
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = m.near;
    ctx.fillRect(170, 305, 1260, 30);
    for (let x = 180; x < 1430; x += 34) {
      ctx.beginPath(); ctx.arc(x, 304, 16 + (x % 5) * 2, 0, Math.PI * 2); ctx.fill();
    }

    if (m.rain) {
      ctx.fillStyle = "rgba(60,72,84,0.25)";
      ctx.fillRect(170, 50, 1260, 290);
      ctx.strokeStyle = "rgba(220,232,240,0.4)"; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const s of streaks) { ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - 2, s.y + s.l); }
      ctx.stroke();
      for (const d of drops) {
        ctx.fillStyle = "rgba(225,235,242,0.3)";
        ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * 1.25, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath(); ctx.arc(d.x - d.r * 0.3, d.y - d.r * 0.4, d.r * 0.3, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();

    // frames
    for (const w of WINDOWS) {
      ctx.strokeStyle = ROOM.frame; ctx.lineJoin = "round";
      ctx.lineWidth = 12;
      ctx.beginPath(); archPath(ctx, w); ctx.stroke();
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(w.cx, w.top); ctx.lineTo(w.cx, w.bottom);
      ctx.moveTo(w.x, w.top + w.r); ctx.lineTo(w.x + w.w, w.top + w.r);
      ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(w.x - 16, w.bottom + 12, w.w + 32, 6);
      ctx.fillStyle = ROOM.trim;
      ctx.fillRect(w.x - 16, w.bottom, w.w + 32, 12);
    }
  }

  function drawShelves() {
    SHELVES.forEach(([x0, x1], si) => {
      ctx.fillStyle = ROOM.wood;
      ctx.fillRect(x0, 92, x1 - x0, WALL - 92);
      ctx.fillStyle = ROOM.shelfBack;
      ctx.fillRect(x0 + 8, 100, x1 - x0 - 16, WALL - 108);
      for (const row of shelfBooks[si]) {
        for (const b of row.books) {
          ctx.fillStyle = b.c;
          if (b.lean) {
            ctx.save(); ctx.translate(b.x, row.y); ctx.rotate(-0.18);
            ctx.fillRect(0, -b.h, b.w, b.h); ctx.restore();
          } else {
            ctx.fillRect(b.x, row.y - b.h, b.w, b.h);
            ctx.fillStyle = "rgba(255,255,255,0.18)";
            ctx.fillRect(b.x + 2, row.y - b.h + 6, b.w - 4, 2);
          }
        }
        ctx.fillStyle = ROOM.woodDark;
        ctx.fillRect(x0 + 4, row.y, x1 - x0 - 8, 8);
      }
      // plant on top
      const px = (x0 + x1) / 2;
      ctx.fillStyle = "#4f7a52";
      for (const [dx, dy, r] of [[-14, -16, 13], [12, -20, 14], [0, -30, 15], [-4, -12, 11]]) {
        ctx.beginPath(); ctx.arc(px + dx, 80 + dy, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#b8653f";
      ctx.beginPath(); ctx.moveTo(px - 16, 72); ctx.lineTo(px + 16, 72); ctx.lineTo(px + 12, 92); ctx.lineTo(px - 12, 92); ctx.fill();
    });
  }

  function drawRoom(t) {
    const g = ctx.createLinearGradient(0, 0, 0, WALL);
    g.addColorStop(0, ROOM.wall); g.addColorStop(1, ROOM.wallLow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WW, WALL);
    // wainscot panels
    ctx.fillStyle = ROOM.wainscot;
    ctx.fillRect(0, 360, WW, WALL - 360);
    ctx.fillStyle = ROOM.trim;
    ctx.fillRect(0, 356, WW, 5);
    ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 2;
    for (let x = 30; x < WW; x += 120) { ctx.strokeRect(x, 372, 96, 44); }

    drawOutside(t);
    drawShelves();

    // floor
    ctx.fillStyle = ROOM.floor;
    ctx.fillRect(0, WALL, WW, WH - WALL);
    ctx.strokeStyle = ROOM.floorLine; ctx.lineWidth = 2;
    let prev = WALL;
    for (let i = 1; i <= 14; i++) {
      const y = WALL + (WH - WALL) * Math.pow(i / 14, 1.25);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WW, y); ctx.stroke();
      for (let x = (i % 2) * 110; x < WW; x += 220) {
        ctx.beginPath(); ctx.moveTo(x, prev); ctx.lineTo(x, y); ctx.stroke();
      }
      prev = y;
    }
    // baseboard
    ctx.fillStyle = ROOM.trim;
    ctx.fillRect(0, WALL - 12, WW, 12);
    ctx.fillStyle = "rgba(0,0,0,0.1)";
    ctx.fillRect(0, WALL, WW, 5);
    // rug
    ctx.fillStyle = ROOM.rugEdge;
    ctx.beginPath(); ctx.ellipse(800, 712, 690, 176, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ROOM.rug;
    ctx.beginPath(); ctx.ellipse(800, 712, 672, 164, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(800, 712, 600, 135, 0, 0, Math.PI * 2); ctx.stroke();
  }

  function drawChair(d) {
    ctx.save();
    ctx.translate(d.x, d.seatY);
    ctx.scale(d.k, d.k);
    if (hovered === d && !d.occupant) {
      ctx.fillStyle = accentGlow;
      ctx.beginPath(); ctx.ellipse(0, 22, 120, 34, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = ROOM.chairDark;
    rrect(ctx, -26, -82, 52, 50, 11); ctx.fill();
    ctx.fillStyle = ROOM.chair;
    rrect(ctx, -22, -78, 44, 42, 9); ctx.fill();
    ctx.restore();
  }

  function drawDesk(d, t) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.scale(d.k, d.k);
    ctx.fillStyle = "rgba(40,25,15,0.16)";
    ctx.beginPath(); ctx.ellipse(0, 2, 104, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ROOM.woodDark;
    ctx.fillRect(-90, -58, 8, 58); ctx.fillRect(82, -58, 8, 58);
    ctx.fillStyle = ROOM.deskTop;
    ctx.fillRect(-98, -72, 196, 14);
    ctx.fillStyle = ROOM.deskEdge;
    ctx.fillRect(-98, -58, 196, 7);
    // books (replaced by a paper stack when this person has shared files)
    const sharing = d.occupant && d.occupant.seated === d && d.occupant.files > 0;
    if (!sharing) {
      ctx.fillStyle = "#3f6b78"; ctx.fillRect(-86, -79, 30, 7);
      ctx.fillStyle = "#d8a54a"; ctx.fillRect(-83, -85, 26, 6);
    }
    // lamp
    ctx.fillStyle = ROOM.lampShade;
    ctx.beginPath(); ctx.ellipse(72, -73, 10, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = ROOM.lampShade; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(72, -73); ctx.lineTo(66, -104); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(52, -102); ctx.lineTo(80, -102); ctx.lineTo(73, -117); ctx.lineTo(59, -117); ctx.closePath(); ctx.fill();
    ctx.fillStyle = mood.lamp > 0.3 ? "#ffe2a0" : "#e9dfc7";
    ctx.beginPath(); ctx.ellipse(66, -101, 8, 2.5, 0, 0, Math.PI * 2); ctx.fill();

    const o = d.occupant;
    if (o && o.seated === d && o.files > 0) {
      // a little stack of shared papers with a count badge
      ctx.fillStyle = "#e9e2d2"; ctx.fillRect(-84, -80, 28, 7);
      ctx.fillStyle = "#f7f3ea"; ctx.fillRect(-86, -85, 28, 7);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(-82, -90, 28, 7);
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(-52, -96, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = accentInk;
      ctx.font = "700 12px Figtree, 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(o.files), -52, -95.5);
    }
    if (o && o.seated === d) {
      const skin = SKINS[o.look.skin] || SKINS[1];
      if (o.item === "laptop") {
        ctx.fillStyle = "#c9ced3";
        rrect(ctx, -27, -102, 54, 32, 4); ctx.fill();
        ctx.fillStyle = "#e8ecef";
        ctx.beginPath(); ctx.arc(0, -86, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = skin;
        ctx.beginPath(); ctx.arc(-33, -72, 5.5, 0, Math.PI * 2); ctx.arc(33, -72, 5.5, 0, Math.PI * 2); ctx.fill();
      } else {
        const flip = o.studying ? Math.sin(t * 0.0008 + o.seed) > 0.96 : false;
        ctx.fillStyle = "#f7f2e8";
        ctx.beginPath(); ctx.moveTo(-26, -70); ctx.lineTo(-2, -72); ctx.lineTo(-2, -79); ctx.lineTo(-24, -77); ctx.fill();
        ctx.beginPath(); ctx.moveTo(26, -70); ctx.lineTo(2, -72); ctx.lineTo(2, flip ? -84 : -79); ctx.lineTo(24, -77); ctx.fill();
        ctx.fillStyle = skin;
        ctx.beginPath(); ctx.arc(-22, -71, 5.5, 0, Math.PI * 2); ctx.arc(22, -71, 5.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawLighting(t) {
    const m = mood;
    if (m.beams) {
      for (const w of WINDOWS) {
        const grad = ctx.createLinearGradient(0, 120, 0, 880);
        grad.addColorStop(0, "rgba(255,240,205,0.16)");
        grad.addColorStop(1, "rgba(255,240,205,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(w.x + 20, 140); ctx.lineTo(w.x + w.w - 20, 140);
        ctx.lineTo(w.x + w.w + 230, 880); ctx.lineTo(w.x + 170, 880);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = "rgba(255,248,225,0.7)";
      for (const p of motes) {
        ctx.globalAlpha = 0.25 + 0.35 * Math.sin(t * 0.001 + p.p) ** 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (m.dark > 0) {
      ctx.fillStyle = `rgba(${m.darkCol},${m.dark})`;
      ctx.fillRect(0, 0, WW, WH);
    }
    ctx.globalCompositeOperation = "lighter";
    if (m.lamp > 0.2) {
      for (const d of desks) {
        const lx = d.x + 66 * d.k, ly = d.y - 98 * d.k, r = 150 * d.k;
        const gl = ctx.createRadialGradient(lx, ly, 2, lx, ly, r);
        gl.addColorStop(0, `rgba(255,190,110,${0.42 * m.lamp})`);
        gl.addColorStop(1, "rgba(255,190,110,0)");
        ctx.fillStyle = gl;
        ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
      }
    }
    if (m.strings) {
      for (let i = 0; i <= 20; i++) {
        const x = i * 80, y = 30 + Math.sin((i / 20) * Math.PI) * 55;
        const a = 0.8 + 0.2 * Math.sin(t * 0.002 + i);
        const gl = ctx.createRadialGradient(x, y, 0, x, y, 40);
        gl.addColorStop(0, `rgba(255,200,120,${0.55 * a})`);
        gl.addColorStop(1, "rgba(255,200,120,0)");
        ctx.fillStyle = gl;
        ctx.fillRect(x - 40, y - 40, 80, 80);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    if (m.strings) {
      ctx.strokeStyle = "rgba(30,15,10,0.7)"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const x = i * 40, y = 30 + Math.sin((i / 40) * Math.PI) * 55 - 4;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      for (let i = 0; i <= 20; i++) {
        const x = i * 80, y = 30 + Math.sin((i / 20) * Math.PI) * 55;
        ctx.fillStyle = "#ffe2aa";
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function pill(text, x, y, bg, fg, sub) {
    ctx.font = "600 12px Figtree, 'Segoe UI', system-ui, sans-serif";
    const w1 = ctx.measureText(text).width;
    ctx.font = "500 11px Figtree, 'Segoe UI', system-ui, sans-serif";
    const w2 = sub ? ctx.measureText(sub).width + 6 : 0;
    const w = w1 + w2 + 16;
    ctx.fillStyle = bg;
    rrect(ctx, x - w / 2, y - 10, w, 20, 10); ctx.fill();
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = fg;
    ctx.font = "600 12px Figtree, 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(text, x - w / 2 + 8, y + 0.5);
    if (sub) {
      ctx.globalAlpha = 0.65;
      ctx.font = "500 11px Figtree, 'Segoe UI', system-ui, sans-serif";
      ctx.fillText(sub, x - w / 2 + 8 + w1 + 6, y + 0.5);
      ctx.globalAlpha = 1;
    }
  }

  function drawTags() {
    for (const c of chars) {
      const k = depth(c.y);
      const top = c.state === "sit" ? c.y - 112 * k : c.y - 130 * k;
      const isMe = c === player;
      pill(c.look.name || "You", c.x, top, isMe ? accent : "rgba(255,255,255,0.88)", isMe ? accentInk : "#22302a", c.bot && !c.host ? "bot" : null);
      if (c.timer) pill(c.timer, c.x, top - 24, "rgba(20,24,30,0.78)", "#ffffff", null);
    }
    if (near && !player.seated && !player.reserve) {
      pill(isTouch ? "Tap Sit to sit here" : "Press E to sit", near.x, near.seatY - 108 * near.k, accent, accentInk, null);
    } else if (hovered && !hovered.occupant) {
      pill("Sit here", hovered.x, hovered.seatY - 108 * hovered.k, accent, accentInk, null);
    }
    if (ring) {
      const a = 1 - ring.age / 0.6;
      if (a > 0) {
        ctx.strokeStyle = accent; ctx.globalAlpha = a; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(ring.x, ring.y, 14 + ring.age * 30, 5 + ring.age * 10, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  // ---------- state, camera, loop ----------
  let sceneName = "morning", mood = MOOD.morning;
  let accent = "#d9692f", accentInk = "#ffffff", accentGlow = "rgba(217,105,47,0.3)";
  let W = 0, H = 0, dpr = 1, s = 1, ox = 0, oy = 0;
  let hovered = null, ring = null, last = 0;
  let near = null, lastNear = undefined;
  const input = { x: 0, y: 0 };
  const isTouch = window.matchMedia("(pointer: coarse)").matches;

  function randomFreePoint() {
    for (let i = 0; i < 20; i++) {
      const x = 80 + rnd() * 1440, y = FLOOR_TOP + rnd() * (FLOOR_BOTTOM - FLOOR_TOP);
      if (!blocked(x, y)) return { x, y };
    }
    return { x: 110, y: 490 };
  }

  // keyboard / joystick movement for your character
  function moveByInput(dt) {
    const len = Math.hypot(input.x, input.y);
    if (len < 0.15) {
      if (!player.path.length && player.state === "walk") player.state = "stand";
      return;
    }
    if (player.seated || player.reserve || player.path.length) leaveSpot(player);
    const sp = 190 * dt * Math.min(1, len);
    const vx = (input.x / len) * sp, vy = (input.y / len) * sp * 0.8;
    const stuck = blocked(player.x, player.y);
    if (stuck || !blocked(player.x + vx, player.y)) player.x += vx;
    if (stuck || !blocked(player.x, player.y + vy)) player.y += vy;
    player.state = "walk";
    player.phase += dt * 11;
    if (Math.abs(vx) > 0.01) player.dir = vx > 0 ? 1 : -1;
  }

  // which empty chair is close enough to sit on?
  function findNear() {
    near = null;
    if (!player.seated && !player.reserve) {
      // anywhere around the desk counts: behind it, beside it or just in front
      let best = Infinity;
      for (const d of desks) {
        if (d.occupant) continue;
        const dx = Math.abs(player.x - d.x);
        const inside = dx < 150 * d.k && player.y > d.seatY - 70 && player.y < d.y + 40;
        if (inside && dx < best) { best = dx; near = d; }
      }
    }
    if (near !== lastNear) {
      lastNear = near;
      emit("near", near);
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    s = Math.max(W / WW, H / WH);
    ox = clamp(W / 2 - player.x * s, W - WW * s, 0);
    oy = clamp(H * 0.5 - 540 * s, H - WH * s, 0);
    render(performance.now());
  }

  function update(dt, t) {
    moveByInput(dt);
    for (const c of chars) step(c, dt);
    updateRemotes(dt);
    findNear();
    // librarian wanders between shelves
    if (!librarian.path.length) {
      librarian.idle -= dt;
      if (librarian.idle <= 0) {
        const p = randomFreePoint();
        walkTo(librarian, p.x, p.y);
        librarian.idle = 4 + rnd() * 6;
      }
    }
    for (const b of bots) {
      b.left -= dt;
      if (b.left <= 0) b.left = 1500;
      b.studying = true;
      const m = Math.floor(b.left / 60), sec = Math.floor(b.left % 60);
      b.timer = String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
    }
    for (const c of clouds) { c.x += c.v * dt; if (c.x > 1500) c.x = 100; }
    for (const b of birds) { b.x += b.v * dt; if (b.x > 1500) b.x = 100; }
    if (mood.rain) {
      for (const st of streaks) { st.y += st.v * dt; st.x -= 20 * dt; if (st.y > 335) { st.y = 50; st.x = 180 + rnd() * 1240; } }
      for (const d of drops) if (d.v) { d.y += d.v * dt; if (d.y > 325) { d.y = 80; } }
    }
    for (const p of motes) { p.y -= p.v * dt; p.x += Math.sin(t * 0.0005 + p.p) * 0.2; if (p.y < 140) p.y = 760; }
    if (ring) { ring.age += dt; if (ring.age > 0.6) ring = null; }
    // camera follows you on narrow screens
    const tx = clamp(W / 2 - player.x * s, W - WW * s, 0);
    ox += (tx - ox) * Math.min(1, dt * 4);
  }

  function render(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = ROOM.wall;
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    drawRoom(t);
    const items = [];
    for (const d of desks) {
      items.push({ y: d.seatY - 0.5, f: () => drawChair(d) });
      items.push({ y: d.y, f: () => drawDesk(d, t) });
    }
    for (const c of chars) items.push({ y: c.y, f: () => {
      const k = depth(c.y);
      ctx.save(); ctx.translate(c.x, c.y); ctx.scale(k, k);
      drawCharacter(ctx, c.look, c.state, t, c.phase, c.seed, c.studying);
      ctx.restore();
    } });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.f();
    drawLighting(t);
    drawTags();
  }

  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    update(dt, t);
    render(t);
    requestAnimationFrame(frame);
  }

  // ---------- input ----------
  function toWorld(e) {
    return { x: (e.clientX - ox) / s, y: (e.clientY - oy) / s };
  }
  function deskAt(p) {
    for (const d of desks) {
      if (Math.abs(p.x - d.x) < 100 * d.k && p.y > d.y - 132 * d.k && p.y < d.y + 6) return d;
    }
    return null;
  }

  canvas.addEventListener("pointermove", (e) => {
    const d = deskAt(toWorld(e));
    hovered = d;
    canvas.style.cursor = d && !d.occupant ? "pointer" : (toWorld(e).y > WALL ? "pointer" : "default");
    if (reduceMotion) render(performance.now());
  });
  canvas.addEventListener("pointerleave", () => { hovered = null; });
  canvas.addEventListener("pointerdown", (e) => {
    const p = toWorld(e);
    const d = deskAt(p);
    if (d) {
      const o = d.occupant;
      if (o && o.seated === d && o.files > 0) { emit("files", o.id); return; }
      if (o && o !== player) { emit("taken", o.look.name); return; }
      sitAt(d);
      return;
    }
    if (p.y > WALL + 10) {
      const x = clamp(p.x, 70, 1530), y = clamp(p.y, FLOOR_TOP, FLOOR_BOTTOM);
      walkTo(player, x, y);
      ring = { x, y, age: 0 };
    }
    if (reduceMotion) render(performance.now());
  });

  window.addEventListener("resize", resize);

  // ---------- real students (from the network) ----------
  const remotes = new Map();
  const extraBots = bots.filter((b) => !b.host); // the 4 bots who step aside for real people
  let botsShown = true;

  function cleanLook(l) {
    l = l || {};
    let name = String(l.name || "Student").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 16) || "Student";
    if (name.toLowerCase() === "ushain") name = "Student"; // only the host is Ushain
    const idx = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : 0);
    return {
      name,
      skin: idx(l.skin, SKINS.length),
      hair: HAIRSTYLES.includes(l.hair) ? l.hair : "short",
      hairColor: idx(l.hairColor, HAIR_COLORS.length),
      shirt: idx(l.shirt, SHIRTS.length),
    };
  }

  function standRemote(c) {
    if (!c.seated) return;
    const d = c.seated;
    if (d.occupant === c) d.occupant = null;
    c.seated = null;
    c.state = "stand";
    const a = approach(d);
    c.x = c.tx = a.x; c.y = c.ty = a.y;
  }

  // the full list of people in the room, from presence
  function syncRemotes(list) {
    const seen = new Set();
    for (const p of list) {
      if (!p || !p.id) continue;
      seen.add(p.id);
      let c = remotes.get(p.id);
      if (!c) {
        c = makeChar(cleanLook(p.look), { id: p.id, item: "laptop" });
        c.remote = true;
        c.x = c.tx = Number.isFinite(p.x) ? p.x : 800;
        c.y = c.ty = Number.isFinite(p.y) ? p.y : 884;
        if (blocked(c.x, c.y) && !Number.isInteger(p.deskId)) { c.x = c.tx = 800; c.y = c.ty = 884; }
        remotes.set(p.id, c);
        chars.push(c);
      }
      c.look = cleanLook(p.look);
      c.mode = p.mode === "focus" || p.mode === "break" ? p.mode : null;
      c.timerEnd = Number(p.timerEnd) || 0;
      c.sitAt = Number(p.sitAt) || 0;

      const want = Number.isInteger(p.deskId) && desks[p.deskId] ? desks[p.deskId] : null;
      if (c.seated && c.seated !== want) standRemote(c);
      if (want && c.seated !== want) {
        const o = want.occupant;
        if (o && o !== c) {
          if (o === player) {
            // two people took the same chair: whoever sat down first keeps it
            const mineFirst = player.seated === want && player.sitAt && (!c.sitAt || player.sitAt <= c.sitAt);
            if (mineFirst) continue;
            leaveSpot(player);
            emit("bumped");
          } else if (o.bot && !o.host) {
            hideBot(o);
          } else if (o.remote) {
            if (c.sitAt >= o.sitAt) continue;
            standRemote(o);
          } else continue;
        }
        if (player.reserve === want) { leaveSpot(player); emit("bumped"); }
        want.occupant = c;
        c.seated = want;
        c.state = "sit";
        c.x = c.tx = want.x;
        c.y = c.ty = want.seatY;
      }
      if (!c.seated && Number.isFinite(p.x) && !c.walking) { c.tx = p.x; c.ty = p.y; }
    }
    for (const [id, c] of remotes) {
      if (seen.has(id)) continue;
      standRemote(c);
      remotes.delete(id);
      const i = chars.indexOf(c);
      if (i >= 0) chars.splice(i, 1);
    }
    // bots keep the room lively until 3 real students are here
    setBotsShown(remotes.size < 3);
  }

  function remotePos(id, x, y, moving) {
    const c = remotes.get(id);
    if (!c || c.seated || !Number.isFinite(x) || !Number.isFinite(y)) return;
    c.tx = clamp(x, 60, WW - 60);
    c.ty = clamp(y, FLOOR_TOP, FLOOR_BOTTOM);
    c.walking = !!moving;
  }

  function updateRemotes(dt) {
    const now = Date.now();
    for (const c of remotes.values()) {
      if (!c.seated) {
        const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
        if (d > 600) { c.x = c.tx; c.y = c.ty; }
        else if (d > 1.5) {
          const sp = Math.min(d, 230 * dt);
          c.x += (dx / d) * sp; c.y += (dy / d) * sp;
          c.state = "walk"; c.phase += dt * 11;
          if (Math.abs(dx) > 0.5) c.dir = dx > 0 ? 1 : -1;
        } else if (c.state === "walk") c.state = "stand";
      }
      if (c.mode === "focus" && c.timerEnd > now) {
        const left = Math.ceil((c.timerEnd - now) / 1000);
        c.timer = String(Math.floor(left / 60)).padStart(2, "0") + ":" + String(left % 60).padStart(2, "0");
      } else if (c.mode === "break") c.timer = "on a break";
      else c.timer = null;
      c.studying = !!c.seated && c.mode === "focus";
    }
  }

  function hideBot(b) {
    if (b.seated && b.seated.occupant === b) b.seated.occupant = null;
    b.hiddenDesk = b.seated || b.hiddenDesk;
    b.seated = null;
    const i = chars.indexOf(b);
    if (i >= 0) chars.splice(i, 1);
  }
  function showBot(b) {
    const d = b.hiddenDesk || b.seated;
    if (!d || d.occupant || chars.includes(b)) return;
    d.occupant = b; b.seated = d; b.state = "sit";
    b.x = d.x; b.y = d.seatY;
    chars.push(b);
  }
  function setBotsShown(show) {
    if (show === botsShown) return;
    botsShown = show;
    for (const b of extraBots) (show ? showBot : hideBot)(b);
  }

  // ---------- public API ----------
  function start() {
    resize();
    if (reduceMotion) {
      // still move people, but at a calm 4 fps
      setInterval(() => { update(0.25, performance.now()); render(performance.now()); }, 250);
    } else {
      requestAnimationFrame(frame);
    }
  }

  return {
    start,
    SKINS, HAIR_COLORS, SHIRTS, HAIRSTYLES,
    on(name, fn) { (events[name] = events[name] || []).push(fn); },
    set(scene, accentColor, inkColor) {
      if (!MOOD[scene]) return;
      sceneName = scene; mood = MOOD[scene];
      if (accentColor) {
        accent = accentColor;
        accentInk = inkColor || "#ffffff";
        accentGlow = accentColor.startsWith("#") ? accentColor + "55" : accentColor;
      }
    },
    setLook(look) { player.look = { ...look }; },
    setPlayerTimer(text, studying) { player.timer = text; player.studying = !!studying; },
    standUp() { if (player.seated || player.reserve) leaveSpot(player); },
    // E key / Sit button: sit at the nearest empty chair, or stand up
    action() {
      if (player.seated || player.reserve) { leaveSpot(player); return "stand"; }
      if (near) { sitAt(near); return "sit"; }
      return null;
    },
    setInput(x, y) { input.x = x; input.y = y; },
    people() {
      // Ushain is the host, not a person you can send private files to
      return chars.filter((c) => c !== player && !c.host).map((c) => ({ id: c.id, name: c.look.name, bot: c.bot, real: !!c.remote }));
    },
    nameOf(id) { const c = chars.find((x) => x.id === id); return c ? c.look.name : "Someone"; },
    setFileCounts(map) { for (const c of [...chars, ...extraBots]) c.files = map[c.id] || 0; },
    syncRemotes,
    remotePos,
    playerState() {
      return {
        x: Math.round(player.x), y: Math.round(player.y),
        deskId: player.seated ? player.seated.id : null,
        sitAt: player.seated ? player.sitAt || null : null,
        moving: player.state === "walk",
      };
    },
    get realCount() { return remotes.size; },
    get seated() { return player.seated; },
    get isTouch() { return isTouch; },
    drawPreview(el, look) {
      const g = el.getContext("2d");
      const r = Math.min(window.devicePixelRatio || 1, 2);
      const w = el.clientWidth || 120, h = el.clientHeight || 150;
      el.width = w * r; el.height = h * r;
      g.setTransform(r, 0, 0, r, 0, 0);
      g.clearRect(0, 0, w, h);
      const sc = h / 135;
      g.translate(w / 2, h - 6);
      g.scale(sc, sc);
      drawCharacter(g, look, "stand", performance.now(), 0, 0, false);
    },
  };
})();
