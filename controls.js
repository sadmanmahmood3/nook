// controls.js — arrow keys / WASD + E on a computer, joystick + Sit button on a phone.
(() => {
  // ---------- keyboard ----------
  const DIRS = {
    ArrowUp: [0, -1], KeyW: [0, -1],
    ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0],
    ArrowRight: [1, 0], KeyD: [1, 0],
  };
  const held = new Set();
  const typing = (e) => e.target.closest && e.target.closest("input, textarea, select");

  function applyKeys() {
    let x = 0, y = 0;
    for (const code of held) { x += DIRS[code][0]; y += DIRS[code][1]; }
    World.setInput(x, y);
  }

  document.addEventListener("keydown", (e) => {
    if (typing(e) || modalOpen()) return;
    if (DIRS[e.code]) {
      e.preventDefault();
      held.add(e.code);
      applyKeys();
    }
    if (e.code === "KeyE" && !e.repeat) {
      const did = World.action();
      if (!did) toast("Walk up to an empty chair, then press E to sit.");
    }
  });
  document.addEventListener("keyup", (e) => {
    if (held.delete(e.code)) applyKeys();
  });
  // let go of everything if the window loses focus, so you don't keep walking
  window.addEventListener("blur", () => { held.clear(); applyKeys(); });

  // ---------- phone joystick ----------
  const stick = $("stick"), knob = $("knob"), act = $("actionBtn");
  if (!World.isTouch) return;
  stick.hidden = false;
  act.hidden = false;

  const RADIUS = 46;
  let pointer = null, cx = 0, cy = 0;

  function moveKnob(e) {
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) { dx = (dx / d) * RADIUS; dy = (dy / d) * RADIUS; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    World.setInput(dx / RADIUS, dy / RADIUS);
  }
  function release(e) {
    if (e.pointerId !== pointer) return;
    pointer = null;
    knob.style.transform = "";
    World.setInput(0, 0);
  }
  stick.addEventListener("pointerdown", (e) => {
    pointer = e.pointerId;
    stick.setPointerCapture(pointer);
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    moveKnob(e);
  });
  stick.addEventListener("pointermove", (e) => { if (e.pointerId === pointer) moveKnob(e); });
  stick.addEventListener("pointerup", release);
  stick.addEventListener("pointercancel", release);

  // ---------- Sit / Stand button ----------
  let nearDesk = null;
  function updateAction() {
    if (World.seated) {
      act.textContent = "Stand";
      act.disabled = false;
    } else {
      act.textContent = "Sit";
      act.disabled = !nearDesk;
    }
  }
  World.on("near", (d) => { nearDesk = d; updateAction(); });
  World.on("sit", updateAction);
  World.on("stand", updateAction);
  act.addEventListener("click", () => { World.action(); updateAction(); });
  updateAction();
})();
