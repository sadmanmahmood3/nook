// scene.js — draws the room: an arched window looking out over a campus skyline.
// Everything is drawn on a <canvas>, so no image files are needed.
const Scene = (() => {
  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const PALETTES = {
    morning: { wall: "#d6e0cd", wallLow: "#bfccb4", sky: ["#8fc6e6", "#cfe3ee", "#f8d9b6"], far: "#9dbb98", near: "#6f9670", bld: "#c9b79f", bldShade: "#b19f87", lit: "#f3eadb", frame: "#f6f2ea", sill: "#e8e1d4", glow: "rgba(255, 228, 170, 0.55)" },
    rain:    { wall: "#56636f", wallLow: "#46525d", sky: ["#5d6f80", "#7d8c98", "#9aa5ad"], far: "#566a64", near: "#44574f", bld: "#5f6a74", bldShade: "#525c66", lit: "#b9c6c4", frame: "#c5cdd4", sill: "#aab4bc", glow: "rgba(200, 220, 235, 0.15)" },
    night:   { wall: "#181c36", wallLow: "#11142a", sky: ["#070a24", "#151a46", "#2c2f66"], far: "#161c3a", near: "#0e1229", bld: "#1c2144", bldShade: "#161a38", lit: "#ffd685", frame: "#2b3060", sill: "#232853", glow: "rgba(255, 240, 200, 0.5)" },
    cafe:    { wall: "#452b21", wallLow: "#36211a", sky: ["#2c2346", "#7a4a63", "#e8925a"], far: "#3e2b38", near: "#2c1f28", bld: "#3e2c33", bldShade: "#34252b", lit: "#ffcb85", frame: "#6e4838", sill: "#5c3b2e", glow: "rgba(255, 190, 120, 0.6)" },
  };

  let W = 0, H = 0, dpr = 1;
  let name = "morning";
  let pal = PALETTES.morning;
  let last = 0;
  let win = null; // window geometry

  // A seeded random generator keeps the skyline the same on every visit
  function seeded(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Skyline: positions are 0..1 across the window
  const buildings = [];
  {
    const r = seeded(2320);
    let x = -0.02;
    while (x < 1.02) {
      const w = 0.07 + r() * 0.1;
      const h = 0.12 + r() * 0.22;
      const cols = Math.max(2, Math.round(w * 40));
      const rows = Math.max(2, Math.round(h * 24));
      const lit = [];
      for (let i = 0; i < cols * rows; i++) lit.push(r());
      buildings.push({ x, w, h, cols, rows, lit, roof: r() < 0.25 });
      x += w + 0.008 + r() * 0.02;
    }
  }
  const treesR = seeded(77);
  const trees = Array.from({ length: 16 }, (_, i) => ({ x: i / 15 + (treesR() - 0.5) * 0.05, r: 0.035 + treesR() * 0.035 }));

  // Moving things
  const rnd = Math.random;
  const stars = Array.from({ length: 90 }, () => ({ x: rnd(), y: rnd() * 0.6, s: rnd() * 1.4 + 0.4, p: rnd() * 6.28 }));
  const clouds = Array.from({ length: 5 }, () => ({ x: rnd(), y: 0.12 + rnd() * 0.25, s: 0.6 + rnd() * 0.8, v: 0.004 + rnd() * 0.006 }));
  const streaks = Array.from({ length: 160 }, () => ({ x: rnd(), y: rnd(), l: 0.03 + rnd() * 0.05, v: 0.9 + rnd() * 0.6 }));
  const drops = Array.from({ length: 26 }, () => ({ x: rnd(), y: rnd(), r: 1.5 + rnd() * 3, v: rnd() < 0.3 ? 0.02 + rnd() * 0.05 : 0 }));
  const birds = Array.from({ length: 4 }, () => ({ x: rnd(), y: 0.15 + rnd() * 0.2, v: 0.02 + rnd() * 0.02, p: rnd() * 6 }));
  const bulbs = Array.from({ length: 13 }, (_, i) => ({ x: i / 12, p: rnd() * 6.28 }));

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const ww = Math.min(W * 0.84, 1000, H * 0.95);
    const wh = Math.min(H * 0.74, ww * 1.05);
    const x = (W - ww) / 2;
    const y = Math.max(H * 0.06, 40);
    win = { x, y, w: ww, h: Math.max(wh, ww * 0.62), cx: x + ww / 2 };
    win.r = ww / 2;
    win.b = win.y + win.h;
    // keep the arch from being taller than the window
    if (win.r > win.h * 0.8) win.r = win.h * 0.8;
    draw(performance.now());
  }

  function archPath(inset = 0) {
    const { x, y, w, b } = win;
    const r = win.r - inset;
    const left = x + inset, right = x + w - inset;
    const top = y + inset;
    const ry = Math.min(r, (right - left) / 2);
    ctx.beginPath();
    ctx.moveTo(left, b);
    ctx.lineTo(left, top + ry);
    ctx.ellipse(win.cx, top + ry, (right - left) / 2, ry, 0, Math.PI, 0);
    ctx.lineTo(right, b);
    ctx.closePath();
  }

  function drawWall() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, pal.wall);
    g.addColorStop(1, pal.wallLow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // light falling into the room from the window
    const glow = ctx.createRadialGradient(win.cx, win.b, 10, win.cx, win.b, Math.max(W, H) * 0.7);
    glow.addColorStop(0, pal.glow);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  function drawOutside(t) {
    const { x, y, w, h, b } = win;
    // sky
    const sky = ctx.createLinearGradient(0, y, 0, b);
    sky.addColorStop(0, pal.sky[0]);
    sky.addColorStop(0.55, pal.sky[1]);
    sky.addColorStop(1, pal.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(x, y, w, h);

    // stars
    if (name === "night") {
      for (const s of stars) {
        const a = 0.45 + 0.55 * Math.sin(t * 0.0012 + s.p) ** 2;
        ctx.fillStyle = `rgba(255,255,240,${a})`;
        ctx.fillRect(x + s.x * w, y + s.y * h, s.s, s.s);
      }
    }

    // sun / moon
    const bx = x + w * 0.72, by = y + h * 0.3, br = Math.max(16, w * 0.055);
    if (name === "morning" || name === "night" || name === "cafe") {
      const halo = ctx.createRadialGradient(bx, by, br * 0.6, bx, by, br * 4);
      const haloCol = name === "night" ? "rgba(230,230,255,0.22)" : name === "cafe" ? "rgba(255,170,110,0.4)" : "rgba(255,240,200,0.6)";
      halo.addColorStop(0, haloCol);
      halo.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(bx - br * 4, by - br * 4, br * 8, br * 8);
      ctx.beginPath();
      const cy = name === "cafe" ? by + h * 0.28 : by;
      ctx.arc(bx, cy, br, 0, Math.PI * 2);
      ctx.fillStyle = name === "night" ? "#f4f1df" : name === "cafe" ? "#ffb36b" : "#fff3d6";
      ctx.fill();
      if (name === "night") {
        ctx.beginPath();
        ctx.arc(bx + br * 0.45, by - br * 0.2, br * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = pal.sky[0];
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // clouds
    if (name === "morning" || name === "rain") {
      ctx.fillStyle = name === "rain" ? "rgba(70,84,96,0.55)" : "rgba(255,255,255,0.75)";
      for (const c of clouds) {
        const cx = x + (((c.x + t * 0.00001 * c.v * 60) % 1.3) - 0.15) * w;
        const cy = y + c.y * h;
        const s = c.s * w * 0.09;
        ctx.beginPath();
        ctx.ellipse(cx, cy, s * 1.6, s * 0.5, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + s * 0.6, cy - s * 0.3, s, s * 0.55, 0, 0, Math.PI * 2);
        ctx.ellipse(cx - s * 0.7, cy - s * 0.15, s * 0.8, s * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // birds
    if (name === "morning") {
      ctx.strokeStyle = "rgba(50,60,55,0.7)";
      ctx.lineWidth = 1.6;
      for (const bd of birds) {
        const px = x + (((bd.x + t * 0.000001 * bd.v * 900) % 1.2) - 0.1) * w;
        const py = y + bd.y * h + Math.sin(t * 0.001 + bd.p) * 6;
        const flap = Math.sin(t * 0.012 + bd.p) * 3;
        ctx.beginPath();
        ctx.moveTo(px - 7, py - flap);
        ctx.quadraticCurveTo(px - 3, py - 2, px, py + 1);
        ctx.quadraticCurveTo(px + 3, py - 2, px + 7, py - flap);
        ctx.stroke();
      }
    }

    // far hills
    const hillY = b - h * 0.3;
    ctx.fillStyle = pal.far;
    ctx.beginPath();
    ctx.moveTo(x, b);
    for (let i = 0; i <= 40; i++) {
      const px = x + (i / 40) * w;
      ctx.lineTo(px, hillY + Math.sin(i * 0.45) * h * 0.025 + Math.sin(i * 0.17 + 1) * h * 0.03);
    }
    ctx.lineTo(x + w, b);
    ctx.fill();

    // campus skyline
    const groundY = b - h * 0.1;
    for (const bd of buildings) {
      const bx0 = x + bd.x * w, bw = bd.w * w, bh = bd.h * h;
      const top = groundY - bh;
      ctx.fillStyle = bd.lit[0] > 0.5 ? pal.bld : pal.bldShade;
      ctx.fillRect(bx0, top, bw, bh);
      if (bd.roof) ctx.fillRect(bx0 + bw * 0.4, top - h * 0.03, bw * 0.15, h * 0.03);
      // windows
      const cw = bw / bd.cols, rh = bh / bd.rows;
      const threshold = name === "night" ? 0.55 : name === "cafe" ? 0.45 : name === "rain" ? 0.7 : 0.2;
      for (let r = 0; r < bd.rows - 1; r++) {
        for (let c = 0; c < bd.cols; c++) {
          const v = bd.lit[r * bd.cols + c];
          if (v < threshold) continue;
          const flicker = name === "night" && v > 0.985 ? 0.5 + 0.5 * Math.sin(t * 0.003 + v * 100) : 1;
          ctx.globalAlpha = (name === "morning" ? 0.5 : 0.9) * flicker;
          ctx.fillStyle = pal.lit;
          ctx.fillRect(bx0 + c * cw + cw * 0.28, top + r * rh + rh * 0.3, cw * 0.44, rh * 0.42);
        }
      }
      ctx.globalAlpha = 1;
    }

    // trees in front
    ctx.fillStyle = pal.near;
    ctx.fillRect(x, groundY, w, b - groundY);
    for (const tr of trees) {
      const tx = x + tr.x * w, rr = tr.r * w;
      ctx.beginPath();
      ctx.arc(tx, groundY - rr * 0.3, rr, 0, Math.PI * 2);
      ctx.arc(tx + rr * 0.7, groundY, rr * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // café string lights
    if (name === "cafe") {
      const sagY = y + h * 0.42;
      ctx.strokeStyle = "rgba(30,15,10,0.7)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const u = i / 24;
        const py = sagY + Math.sin(u * Math.PI * 2) * h * 0.04 + h * 0.03;
        i ? ctx.lineTo(x + u * w, py) : ctx.moveTo(x + u * w, py);
      }
      ctx.stroke();
      for (const bl of bulbs) {
        const px = x + bl.x * w;
        const py = sagY + Math.sin(bl.x * Math.PI * 2) * h * 0.04 + h * 0.03 + 5;
        const a = 0.75 + 0.25 * Math.sin(t * 0.002 + bl.p);
        const gl = ctx.createRadialGradient(px, py, 0, px, py, 26);
        gl.addColorStop(0, `rgba(255,200,120,${0.6 * a})`);
        gl.addColorStop(1, "rgba(255,200,120,0)");
        ctx.fillStyle = gl;
        ctx.fillRect(px - 26, py - 26, 52, 52);
        ctx.beginPath();
        ctx.arc(px, py, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,226,170,${a})`;
        ctx.fill();
      }
    }

    // rain
    if (name === "rain") {
      ctx.fillStyle = "rgba(60,72,84,0.22)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "rgba(220,232,240,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const s of streaks) {
        const sx = x + s.x * w, sy = y + s.y * h;
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - s.l * h * 0.15, sy + s.l * h);
      }
      ctx.stroke();
      // drops on the glass
      for (const d of drops) {
        const dx = x + d.x * w, dy = y + d.y * h;
        ctx.beginPath();
        ctx.ellipse(dx, dy, d.r, d.r * 1.25, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(225,235,242,0.28)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(dx - d.r * 0.3, dy - d.r * 0.4, d.r * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fill();
      }
    }
  }

  function drawFrame() {
    const { x, y, w, b } = win;
    const fw = Math.max(8, w * 0.016);
    ctx.strokeStyle = pal.frame;
    ctx.lineJoin = "round";
    // outer frame
    ctx.lineWidth = fw * 1.6;
    archPath(0);
    ctx.stroke();
    // mullions
    ctx.lineWidth = fw * 0.75;
    const spring = y + win.r;
    ctx.beginPath();
    ctx.moveTo(win.cx, y);
    ctx.lineTo(win.cx, b);
    ctx.moveTo(x, spring);
    ctx.lineTo(x + w, spring);
    ctx.moveTo(x, spring + (b - spring) / 2);
    ctx.lineTo(x + w, spring + (b - spring) / 2);
    ctx.stroke();
    // sill
    const sillH = Math.max(12, fw * 1.5);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(x - fw * 2.5, b + sillH, w + fw * 5, sillH * 0.8);
    ctx.fillStyle = pal.sill;
    ctx.fillRect(x - fw * 2.5, b, w + fw * 5, sillH);
  }

  function update(dt) {
    if (name === "rain") {
      for (const s of streaks) {
        s.y += s.v * dt * 0.0009;
        s.x -= s.v * dt * 0.00004;
        if (s.y > 1) { s.y = -0.1; s.x = Math.random() * 1.1; }
      }
      for (const d of drops) {
        if (d.v) {
          d.y += d.v * dt * 0.001;
          if (d.y > 1.05) { d.y = -0.05; d.x = Math.random(); }
        }
      }
    }
  }

  function draw(t) {
    if (!win) return;
    drawWall();
    ctx.save();
    archPath(0);
    ctx.clip();
    drawOutside(t);
    ctx.restore();
    drawFrame();
  }

  function frame(t) {
    const dt = Math.min(64, t - last || 16);
    // ~30 fps is plenty and saves battery
    if (t - last >= 30) {
      update(dt);
      draw(t);
      last = t;
    }
    requestAnimationFrame(frame);
  }

  function set(next) {
    if (!PALETTES[next]) return;
    name = next;
    pal = PALETTES[next];
    draw(performance.now());
  }

  window.addEventListener("resize", resize);
  resize();
  if (!reduceMotion) requestAnimationFrame(frame);

  return { set };
})();
