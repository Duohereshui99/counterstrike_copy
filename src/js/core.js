'use strict';
/* =========================================================
   core.js — math helpers, settings, shared constants
   ========================================================= */
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
function angleDiff(from, to) { return wrapAngle(to - from); }
// yaw convention: yaw 0 looks toward -Z, positive yaw turns left (toward -X)
function yawTo(dx, dz) { return Math.atan2(-dx, -dz); }
function damp(cur, target, lambda, dt) { return cur + (target - cur) * (1 - Math.exp(-lambda * dt)); }
function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function $(id) { return document.getElementById(id); }
function dirFromAngles(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  return out;
}

const Settings = {
  sens: 1.0,
  volume: 0.7,
  difficulty: 'normal',
  mode: 'bomb',
  teamSize: 5,
  rounds: 0,
  quality: 'high',
};
function loadSettings() {
  try {
    const raw = localStorage.getItem('kestrel.settings.v1');
    if (raw) Object.assign(Settings, JSON.parse(raw));
    else if (IS_TOUCH) Settings.quality = 'low';
  } catch (e) { if (IS_TOUCH) Settings.quality = 'low'; }
  // older saves may hold values the menu no longer offers
  Settings.mode = Settings.mode === 'hostage' ? 'hostage' : 'bomb';
  Settings.teamSize = [3, 5, 8].includes(Number(Settings.teamSize)) ? Number(Settings.teamSize) : 5;
  Settings.rounds = [0, 8, 16].includes(Number(Settings.rounds)) ? Number(Settings.rounds) : 0;
  if (!['easy', 'normal', 'hard'].includes(Settings.difficulty)) Settings.difficulty = 'normal';
  delete Settings.side;
}
function saveSettings() {
  try { localStorage.setItem('kestrel.settings.v1', JSON.stringify(Settings)); } catch (e) { /* ignore */ }
}

const IS_TOUCH = typeof window !== 'undefined' &&
  (('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0) &&
  !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
