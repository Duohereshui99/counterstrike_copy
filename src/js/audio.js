'use strict';
/* =========================================================
   audio.js — every sound is synthesized with WebAudio:
   filtered noise bursts, pitch-swept tones and a generated
   reverb tail. Positional sounds are panned and muffled by
   distance relative to the listener (the camera).
   ========================================================= */
const SFX = (function () {
  let ctx = null, master = null, noiseBuf = null, verbIn = null, ready = false;
  const L = { x: 0, y: 0, z: 0, yaw: 0 };
  let ringing = null;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (e) { return; }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5;
    comp.attack.value = 0.003; comp.release.value = 0.25;
    master = ctx.createGain();
    master.gain.value = Settings.volume;
    master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const verb = ctx.createConvolver();
    verb.buffer = impulse(1.8, 3.2);
    verbIn = ctx.createGain(); verbIn.gain.value = 0.32;
    verbIn.connect(verb); verb.connect(master);
    ready = true;
  }
  function impulse(dur, decay) {
    const n = Math.floor(ctx.sampleRate * dur);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // early slap-back off warehouse walls, then a diffuse tail
        const slap = (i > n * 0.045 && i < n * 0.06) ? 0.6 : 0;
        d[i] = (Math.random() * 2 - 1) * (Math.pow(1 - t, decay) + slap * (1 - t));
      }
    }
    return b;
  }
  function setVolume(v) { if (master) master.gain.value = v; }
  function setListener(x, y, z, yaw) { L.x = x; L.y = y; L.z = z; L.yaw = yaw; }

  // output chain for one sound: lowpass -> gain -> pan -> master (+ reverb send)
  function out(pos, o) {
    if (!ready) return null;
    let gain = o.vol == null ? 1 : o.vol, pan = 0, lp = 18000;
    if (pos) {
      const dx = pos.x - L.x, dz = pos.z - L.z, dy = (pos.y || 0) - L.y;
      const d = Math.hypot(dx, dy, dz);
      const max = o.max || 80;
      if (d > max) return null;
      const ref = o.ref || 6;
      gain *= ref / (ref + Math.max(0, d - 1)) * Math.sqrt(1 - d / max);
      pan = clamp(-Math.sin(angleDiff(L.yaw, yawTo(dx, dz))), -1, 1) * 0.8 * clamp(d / 3, 0, 1);
      lp = 16000 / (1 + d / 22);
      if (o.occluded) { lp = Math.min(lp, 1400); gain *= 0.6; }
    }
    if (gain < 0.004) return null;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
    const g = ctx.createGain(); g.gain.value = gain;
    f.connect(g);
    let tail = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      g.connect(p); tail = p;
    }
    tail.connect(master);
    if (o.verb) { const s = ctx.createGain(); s.gain.value = o.verb; tail.connect(s); s.connect(verbIn); }
    return f;
  }
  function env(param, t, a, dur, peak) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    param.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function noise(dest, t, dur, o) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    src.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 1000, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
    f.Q.value = o.q || 0.7;
    const e = ctx.createGain(); env(e.gain, t, o.attack || 0.002, dur, o.gain == null ? 1 : o.gain);
    src.connect(f); f.connect(e); e.connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }
  function tone(dest, t, dur, o) {
    const osc = ctx.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
    const e = ctx.createGain(); env(e.gain, t, o.attack || 0.002, dur, o.gain == null ? 1 : o.gain);
    osc.connect(e); e.connect(dest);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  const now = () => ctx.currentTime;

  // ---------------------------------------------------------------- weapons
  function shot(w, pos, occluded, sil) {
    const s = w.snd;
    if (sil) {
      // suppressed: a dull cough and the action cycling, no crack and no echo; carries only a short distance
      const o = out(pos, { vol: s.vol * (pos ? 0.75 : 0.5), ref: 3, max: 34, verb: 0.05, occluded });
      if (!o) return;
      const t = now();
      noise(o, t, 0.07, { type: 'lowpass', freq: 1500, freqEnd: 220, gain: 0.9 });
      noise(o, t, 0.02, { type: 'bandpass', freq: 3200, q: 2, gain: 0.25 });
      tone(o, t, 0.06, { type: 'sine', freq: 170, freqEnd: 60, gain: 0.5 });
      if (!pos) tone(o, t + 0.03, 0.025, { type: 'square', freq: 2100, gain: 0.05 });
      return;
    }
    const o = out(pos, { vol: s.vol * (pos ? 1.25 : 0.85), ref: 12, max: 150, verb: 0.4, occluded });
    if (!o) return;
    const t = now();
    noise(o, t, s.decay, { type: 'lowpass', freq: s.cut, freqEnd: Math.max(80, s.cut * 0.16), gain: 1 });
    noise(o, t, 0.03, { type: 'highpass', freq: 2600, gain: 0.5 * (s.crack || 1) });
    tone(o, t, 0.14, { type: 'sine', freq: s.thump, freqEnd: 36, gain: 0.95 });
    if (s.tail) noise(o, t + 0.015, s.tail, { type: 'lowpass', freq: 900, freqEnd: 90, gain: 0.45 });
    if (s.mech && !pos) tone(o, t + 0.035, 0.03, { type: 'square', freq: 2400, gain: 0.05 });
  }
  function knife(pos) {
    const o = out(pos, { vol: 0.45, ref: 3, max: 25 }); if (!o) return;
    const t = now();
    noise(o, t, 0.16, { type: 'bandpass', freq: 900, freqEnd: 3800, q: 1.4, gain: 0.9, attack: 0.03 });
  }
  function knifeHit(pos) {
    const o = out(pos, { vol: 0.6, ref: 3, max: 25 }); if (!o) return;
    const t = now();
    noise(o, t, 0.08, { type: 'lowpass', freq: 1200, gain: 1 });
    tone(o, t, 0.08, { freq: 160, freqEnd: 60, gain: 0.6 });
  }
  function dry() { const o = out(null, { vol: 0.35 }); if (!o) return; tone(o, now(), 0.04, { type: 'square', freq: 1700, gain: 0.25 }); }
  function reloadPart(kind) {
    const o = out(null, { vol: 0.35 }); if (!o) return;
    const t = now();
    if (kind === 'out') { noise(o, t, 0.05, { type: 'bandpass', freq: 1800, q: 3, gain: 1 }); tone(o, t, 0.04, { type: 'square', freq: 600, gain: 0.08 }); }
    else if (kind === 'in') { noise(o, t, 0.06, { type: 'bandpass', freq: 1100, q: 4, gain: 1 }); tone(o, t + 0.02, 0.05, { type: 'triangle', freq: 320, gain: 0.3 }); }
    else { noise(o, t, 0.04, { type: 'bandpass', freq: 2600, q: 5, gain: 1 }); noise(o, t + 0.09, 0.05, { type: 'bandpass', freq: 1500, q: 5, gain: 0.9 }); }
  }
  function deploy() { const o = out(null, { vol: 0.25 }); if (!o) return; noise(o, now(), 0.07, { type: 'bandpass', freq: 2000, q: 2, gain: 1 }); }
  function scope() { const o = out(null, { vol: 0.2 }); if (!o) return; noise(o, now(), 0.05, { type: 'bandpass', freq: 3000, q: 6, gain: 1 }); }

  // ---------------------------------------------------------------- feedback
  function hit(head) {
    const o = out(null, { vol: head ? 0.5 : 0.32 }); if (!o) return;
    const t = now();
    if (head) { tone(o, t, 0.16, { type: 'triangle', freq: 2350, gain: 0.5 }); tone(o, t, 0.12, { type: 'sine', freq: 3540, gain: 0.25 }); noise(o, t, 0.04, { type: 'highpass', freq: 4000, gain: 0.3 }); }
    else { tone(o, t, 0.05, { type: 'sine', freq: 1300, freqEnd: 900, gain: 0.5 }); }
  }
  function hurt(head) {
    const o = out(null, { vol: 0.5 }); if (!o) return;
    const t = now();
    noise(o, t, 0.12, { type: 'lowpass', freq: 700, gain: 1 });
    tone(o, t, 0.1, { freq: head ? 900 : 180, freqEnd: 70, gain: 0.5 });
  }
  function killConfirm() {
    const o = out(null, { vol: 0.3 }); if (!o) return;
    const t = now();
    tone(o, t, 0.18, { type: 'triangle', freq: 660, gain: 0.4 });
    tone(o, t + 0.07, 0.22, { type: 'triangle', freq: 990, gain: 0.35 });
  }
  function footstep(pos, local, surface) {
    const o = out(local ? null : pos, { vol: local ? 0.11 : 0.55, ref: 4, max: 26 }); if (!o) return;
    const t = now();
    const f = surface === 'metal' ? 1500 : surface === 'wood' ? 650 : 420;
    noise(o, t, 0.07, { type: 'bandpass', freq: f * rand(0.85, 1.2), q: 1.2, gain: 1 });
    tone(o, t, 0.05, { freq: 110, freqEnd: 60, gain: 0.25 });
  }
  function land(pos, local) {
    const o = out(local ? null : pos, { vol: local ? 0.25 : 0.5, ref: 4, max: 25 }); if (!o) return;
    const t = now(); noise(o, t, 0.12, { type: 'lowpass', freq: 500, gain: 1 }); tone(o, t, 0.1, { freq: 90, freqEnd: 45, gain: 0.5 });
  }
  function ui(kind) {
    const o = out(null, { vol: 0.22 }); if (!o) return;
    const t = now();
    if (kind === 'buy') { tone(o, t, 0.06, { type: 'square', freq: 880, gain: 0.25 }); tone(o, t + 0.05, 0.08, { type: 'square', freq: 1320, gain: 0.2 }); }
    else if (kind === 'deny') tone(o, t, 0.12, { type: 'square', freq: 180, gain: 0.3 });
    else tone(o, t, 0.04, { type: 'triangle', freq: 1200, gain: 0.3 });
  }
  // riot shield taking a round: a short metallic ring
  function shieldHit(pos) {
    const o = out(pos, { vol: 0.5, ref: 5, max: 45 }); if (!o) return;
    const t = now(), f = rand(1900, 2400);
    tone(o, t, 0.22, { type: 'triangle', freq: f, gain: 0.45 });
    tone(o, t, 0.16, { type: 'sine', freq: f * 1.51, gain: 0.25 });
    noise(o, t, 0.035, { type: 'highpass', freq: 3500, gain: 0.6 });
  }
  // radio message: squelch, a click and a short burst of static
  function radio() {
    const o = out(null, { vol: 0.2 }); if (!o) return;
    const t = now();
    tone(o, t, 0.03, { type: 'square', freq: 1800, gain: 0.25 });
    noise(o, t + 0.02, 0.12, { type: 'bandpass', freq: 2200, q: 0.8, gain: 0.35 });
    tone(o, t + 0.13, 0.025, { type: 'square', freq: 1400, gain: 0.18 });
  }
  function pickup() { const o = out(null, { vol: 0.3 }); if (!o) return; const t = now(); noise(o, t, 0.08, { type: 'bandpass', freq: 1600, q: 3, gain: 1 }); tone(o, t + 0.05, 0.06, { type: 'triangle', freq: 500, gain: 0.3 }); }

  // ---------------------------------------------------------------- bomb & grenades
  function beep(pos, urgent) {
    const o = out(pos, { vol: 0.4, ref: 8, max: 60 }); if (!o) return;
    tone(o, now(), urgent ? 0.07 : 0.1, { type: 'sine', freq: urgent ? 1550 : 1320, gain: 0.7 });
  }
  function keypad(pos) {
    const o = out(pos, { vol: 0.35, ref: 4, max: 30 }); if (!o) return;
    tone(o, now(), 0.06, { type: 'square', freq: rand(900, 1500), gain: 0.2 });
  }
  function planted() {
    const o = out(null, { vol: 0.45 }); if (!o) return;
    const t = now();
    [0, 0.12, 0.24].forEach((d, i) => tone(o, t + d, 0.1, { type: 'square', freq: 700 + i * 220, gain: 0.25 }));
  }
  function defuseTick(pos) {
    const o = out(pos, { vol: 0.3, ref: 4, max: 25 }); if (!o) return;
    noise(o, now(), 0.04, { type: 'bandpass', freq: 3200, q: 8, gain: 1 });
  }
  function explosion(pos, big) {
    const o = out(pos, { vol: big ? 2.2 : 1.4, ref: big ? 30 : 16, max: 220, verb: 0.6 }); if (!o) return;
    const t = now();
    noise(o, t, big ? 2.6 : 1.3, { type: 'lowpass', freq: 2400, freqEnd: 70, gain: 1 });
    tone(o, t, big ? 1.2 : 0.6, { freq: 70, freqEnd: 26, gain: 1 });
    noise(o, t, 0.08, { type: 'highpass', freq: 1800, gain: 0.7 });
  }
  function bounce(pos) {
    const o = out(pos, { vol: 0.35, ref: 4, max: 30 }); if (!o) return;
    const t = now(); tone(o, t, 0.06, { type: 'triangle', freq: rand(1400, 2000), gain: 0.4 }); noise(o, t, 0.03, { type: 'highpass', freq: 3000, gain: 0.4 });
  }
  function throwNade() { const o = out(null, { vol: 0.25 }); if (!o) return; noise(o, now(), 0.18, { type: 'bandpass', freq: 600, freqEnd: 1800, q: 1, gain: 1, attack: 0.04 }); }
  function pin() { const o = out(null, { vol: 0.3 }); if (!o) return; tone(o, now(), 0.05, { type: 'triangle', freq: 2800, gain: 0.3 }); }
  function flashbang(pos) {
    const o = out(pos, { vol: 1.6, ref: 14, max: 160, verb: 0.5 }); if (!o) return;
    const t = now();
    noise(o, t, 0.5, { type: 'highpass', freq: 900, gain: 1 });
    noise(o, t, 0.9, { type: 'lowpass', freq: 1200, freqEnd: 120, gain: 0.7 });
  }
  function smokePop(pos) {
    const o = out(pos, { vol: 0.7, ref: 6, max: 60 }); if (!o) return;
    const t = now(); noise(o, t, 0.12, { type: 'lowpass', freq: 900, gain: 1 }); noise(o, t + 0.05, 2.4, { type: 'bandpass', freq: 2400, q: 0.6, gain: 0.25, attack: 0.2 });
  }
  function tinnitus(dur) {
    if (!ready) return;
    if (ringing) { try { ringing.stop(); } catch (e) { /* already stopped */ } }
    const o = out(null, { vol: 0.16 }); if (!o) return;
    const osc = ctx.createOscillator(); osc.frequency.value = 3300;
    const e = ctx.createGain(); const t = now();
    e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(1, t + 0.05); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(e); e.connect(o); osc.start(t); osc.stop(t + dur + 0.1); ringing = osc;
  }

  // ---------------------------------------------------------------- music stingers
  function stinger(kind) {
    const o = out(null, { vol: 0.42, verb: 0.5 }); if (!o) return;
    const t = now();
    const seq = {
      win: [[0, 0], [4, 0.13], [7, 0.26], [12, 0.39]],
      lose: [[0, 0], [-2, 0.16], [-5, 0.32], [-9, 0.5]],
      start: [[0, 0], [7, 0.1]],
      half: [[0, 0], [5, 0.15], [10, 0.3], [5, 0.45]],
    }[kind];
    const base = kind === 'lose' ? 233 : 262;
    seq.forEach(([semi, d]) => {
      const f = base * Math.pow(2, semi / 12);
      tone(o, t + d, 0.8, { type: 'triangle', freq: f, gain: 0.45, attack: 0.01 });
      tone(o, t + d, 0.6, { type: 'sawtooth', freq: f / 2, gain: 0.06, attack: 0.01 });
    });
  }

  return {
    init, setVolume, setListener, get ready() { return ready; },
    shot, knife, knifeHit, dry, reloadPart, deploy, scope, hit, hurt, killConfirm, footstep, land, ui, pickup, shieldHit, radio,
    beep, keypad, planted, defuseTick, explosion, bounce, throwNade, pin, flashbang, smokePop, tinnitus, stinger,
  };
})();
