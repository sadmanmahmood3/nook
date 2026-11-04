// audio.js — every ambient sound is generated live with the Web Audio API,
// so the project needs no audio files and has no licensing issues.
const Sound = (() => {
  let ctx = null;
  let master = null;
  let enabled = false;

  // Each layer: label, how loud it is at 100%, and its current volume (0..1)
  const layers = {
    rain:     { label: "Rain",     scale: 0.55, vol: 0 },
    birds:    { label: "Birds",    scale: 0.9,  vol: 0 },
    wind:     { label: "Wind",     scale: 1.3,  vol: 0 },
    crickets: { label: "Crickets", scale: 0.6,  vol: 0 },
    cafe:     { label: "Café",     scale: 1.0,  vol: 0 },
    brown:    { label: "Hum",      scale: 0.7,  vol: 0 },
  };

  // ---------- helpers ----------
  function noiseBuffer(type) {
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (type === "white") {
          d[i] = w;
        } else if (type === "pink") {
          // Paul Kellet's pink-noise filter
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        } else {
          // brown noise: a random walk
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        }
      }
    }
    return buf;
  }

  function loop(buf) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start(0, Math.random() * 3);
    return src;
  }

  function filter(type, freq, q = 0.7) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  // Runs fn() repeatedly; fn returns the delay (ms) until it should run again.
  // Only plays while sound is on and the layer is audible.
  function every(name, fn) {
    const go = () => {
      let next = 400;
      if (enabled && layers[name].vol > 0.01 && ctx.state === "running") next = fn();
      setTimeout(go, next);
    };
    go();
  }

  function panTo(node, pan) {
    if (!ctx.createStereoPanner) return node;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    return p;
  }

  // ---------- build the sound layers ----------
  function build() {
    const white = noiseBuffer("white");
    const pink = noiseBuffer("pink");
    const brown = noiseBuffer("brown");

    for (const name in layers) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(master);
      layers[name].gain = g;
    }

    // Rain: filtered pink noise + random droplet ticks
    {
      const out = layers.rain.gain;
      loop(pink).connect(filter("highpass", 450)).connect(filter("lowpass", 7000)).connect(out);
      every("rain", () => {
        const t = ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer = white;
        const bp = filter("bandpass", rand(2200, 6000), 6);
        const env = ctx.createGain();
        env.gain.setValueAtTime(rand(0.15, 0.5), t);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        src.connect(bp).connect(env);
        panTo(env, rand(-0.8, 0.8)).connect(out);
        src.start(t, Math.random() * 3, 0.06);
        return rand(25, 140);
      });
    }

    // Birds: short sweeping chirps in little phrases
    {
      const out = layers.birds.gain;
      every("birds", () => {
        let t = ctx.currentTime + 0.05;
        const base = rand(2600, 4200);
        const notes = Math.floor(rand(2, 7));
        const pan = rand(-0.9, 0.9);
        for (let i = 0; i < notes; i++) {
          const o = ctx.createOscillator();
          o.type = "sine";
          const f0 = base * rand(0.9, 1.15);
          o.frequency.setValueAtTime(f0, t);
          o.frequency.exponentialRampToValueAtTime(f0 * rand(1.2, 1.7), t + 0.07);
          const env = ctx.createGain();
          env.gain.setValueAtTime(0.0001, t);
          env.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
          env.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
          o.connect(env);
          panTo(env, pan).connect(out);
          o.start(t);
          o.stop(t + 0.1);
          t += rand(0.09, 0.16);
        }
        return rand(900, 4200);
      });
    }

    // Wind: brown noise through a slowly drifting band-pass filter
    {
      const bp = filter("bandpass", 450, 0.6);
      const swell = ctx.createGain();
      swell.gain.value = 0.7;
      loop(brown).connect(bp).connect(swell).connect(layers.wind.gain);

      const lfo1 = ctx.createOscillator();
      lfo1.frequency.value = 0.07;
      const lfo1Amt = ctx.createGain();
      lfo1Amt.gain.value = 260;
      lfo1.connect(lfo1Amt).connect(bp.frequency);
      lfo1.start();

      const lfo2 = ctx.createOscillator();
      lfo2.frequency.value = 0.045;
      const lfo2Amt = ctx.createGain();
      lfo2Amt.gain.value = 0.35;
      lfo2.connect(lfo2Amt).connect(swell.gain);
      lfo2.start();
    }

    // Crickets: fast pulsed high tones from two "crickets" left and right
    {
      const out = layers.crickets.gain;
      const crickets = [{ f: 4400, pan: -0.6 }, { f: 4850, pan: 0.55 }];
      crickets.forEach((c) => {
        every("crickets", () => {
          let t = ctx.currentTime + 0.02;
          const pulses = Math.floor(rand(3, 5));
          for (let i = 0; i < pulses; i++) {
            const o = ctx.createOscillator();
            o.frequency.value = c.f * rand(0.99, 1.01);
            const env = ctx.createGain();
            env.gain.setValueAtTime(0.0001, t);
            env.gain.exponentialRampToValueAtTime(0.09, t + 0.006);
            env.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
            o.connect(env);
            panTo(env, c.pan).connect(out);
            o.start(t);
            o.stop(t + 0.035);
            t += 0.048;
          }
          return rand(380, 1100);
        });
      });
    }

    // Café: a murmur of voices (band-passed noise that rises and falls) + cup clinks
    {
      const out = layers.cafe.gain;
      const murmur = ctx.createGain();
      murmur.gain.value = 0.6;
      loop(pink).connect(filter("bandpass", 650, 0.9)).connect(murmur).connect(out);
      const low = ctx.createGain();
      low.gain.value = 0.35;
      loop(brown).connect(filter("lowpass", 220)).connect(low).connect(out);

      every("cafe", () => {
        murmur.gain.setTargetAtTime(rand(0.35, 0.9), ctx.currentTime, 0.4);
        // now and then, a cup or spoon
        if (Math.random() < 0.12) {
          const t = ctx.currentTime + 0.02;
          const pan = rand(-0.7, 0.7);
          [1, 2.76, 5.4].forEach((ratio, i) => {
            const o = ctx.createOscillator();
            o.frequency.value = 1900 * ratio;
            const env = ctx.createGain();
            env.gain.setValueAtTime(0.06 / (i + 1), t);
            env.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
            o.connect(env);
            panTo(env, pan).connect(out);
            o.start(t);
            o.stop(t + 0.5);
          });
        }
        return rand(350, 700);
      });
    }

    // Hum: soft brown noise, like a fan or distant traffic
    loop(brown).connect(filter("lowpass", 520)).connect(layers.brown.gain);

    // apply any volumes set before audio started
    for (const name in layers) setVolume(name, layers[name].vol);
  }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      build();
    }
    if (ctx.state === "suspended") ctx.resume();
    return true;
  }

  function setEnabled(on) {
    if (!ensure()) return false;
    enabled = on;
    master.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.25);
    return true;
  }

  function setVolume(name, v) {
    const layer = layers[name];
    if (!layer) return;
    layer.vol = v;
    if (ctx && layer.gain) {
      layer.gain.gain.setTargetAtTime(v * v * layer.scale, ctx.currentTime, 0.2);
    }
  }

  // A gentle two-note chime when a session ends (plays even when ambience is off)
  function chime() {
    if (!ensure()) return;
    const t = ctx.currentTime + 0.05;
    [[659.25, 0], [987.77, 0.22], [1318.5, 0.44]].forEach(([f, dt]) => {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t + dt);
      env.gain.exponentialRampToValueAtTime(0.22, t + dt + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dt + 1.6);
      o.connect(env).connect(ctx.destination);
      o.start(t + dt);
      o.stop(t + dt + 1.7);
    });
  }

  return {
    layers,
    ensure,
    setEnabled,
    setVolume,
    chime,
    get enabled() { return enabled; },
  };
})();
