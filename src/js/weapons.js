'use strict';
/* =========================================================
   weapons.js — classic arsenal: stats, team restrictions,
   ammo purchase, silencers, burst fire, dual pistols, scopes,
   the riot shield, hitscan and knifing.
   Distances in metres, angles in radians unless noted.
   Recoil values are in degrees.
   ========================================================= */
const CT = 0, T = 1;                 // team indices: 0 = police (红隼), 1 = militants (毒蝰)
const HIT_MULT = { head: 4.0, chest: 1.0, legs: 0.75 };
const KILL_REWARD = 300;

// price/ammo values follow the old-school economy: guns come with one magazine, spare ammo is bought separately
const WEAPONS = {
  knife: { name: '战术匕首', kind: 'knife', dmg: 34, rof: 0.42, rofAlt: 1.0, range: 1.75, speed: 6.2, armorPen: 0.85, falloff: 1 },

  p9: { name: 'P9 特勤手枪', kind: 'pistol', team: 'ct', price: 500, dmg: 34, rof: 0.15, mag: 12, reserveMax: 100, ammoPer: 12, ammoPrice: 25, startReserve: 24, reload: 2.6,
    spread: 0.006, moveSpread: 0.03, spreadPerShot: 0.012, spreadMax: 0.045, armorPen: 0.5, falloff: 0.88, speed: 6.1, kick: 1.5, recover: 9, sil: true,
    desc: '警方默认手枪 · 右键装卸消音器', snd: { cut: 4600, decay: 0.13, thump: 190, vol: 0.6, crack: 1.1, mech: 1 } },
  b18: { name: 'B-18 冲锋手枪', kind: 'pistol', team: 't', price: 400, dmg: 25, rof: 0.13, mag: 20, reserveMax: 120, ammoPer: 30, ammoPrice: 20, startReserve: 40, reload: 2.2,
    spread: 0.008, moveSpread: 0.028, spreadPerShot: 0.01, spreadMax: 0.04, armorPen: 0.47, falloff: 0.85, speed: 6.1, kick: 1.2, recover: 9, burst: true,
    desc: '匪方默认手枪 · 右键切换三连发', snd: { cut: 5400, decay: 0.11, thump: 220, vol: 0.55, crack: 1.1, mech: 1 } },
  p2: { name: 'P2 紧凑手枪', kind: 'pistol', price: 600, dmg: 32, rof: 0.15, mag: 13, reserveMax: 52, ammoPer: 13, ammoPrice: 50, reload: 2.7,
    spread: 0.0065, moveSpread: 0.03, spreadPerShot: 0.012, spreadMax: 0.045, armorPen: 0.62, falloff: 0.88, speed: 6.1, kick: 1.6, recover: 9,
    desc: '13 发，穿甲比默认手枪好', snd: { cut: 5000, decay: 0.12, thump: 200, vol: 0.6, crack: 1.1, mech: 1 } },
  hx50: { name: 'HX-50 重型手枪', kind: 'pistol', price: 650, dmg: 54, rof: 0.28, mag: 7, reserveMax: 35, ammoPer: 7, ammoPrice: 40, reload: 2.2,
    spread: 0.004, moveSpread: 0.055, spreadPerShot: 0.03, spreadMax: 0.06, armorPen: 0.93, falloff: 0.84, speed: 6.0, kick: 4.0, recover: 6,
    desc: '威力大，爆头一枪致命', snd: { cut: 3200, decay: 0.22, thump: 140, vol: 0.85, crack: 1.2, tail: 0.35, mech: 1 } },
  d92: { name: 'D-92 双持手枪', kind: 'pistol', team: 't', price: 800, dmg: 36, rof: 0.12, mag: 30, reserveMax: 120, ammoPer: 30, ammoPrice: 20, reload: 4.4,
    spread: 0.009, moveSpread: 0.035, spreadPerShot: 0.012, spreadMax: 0.05, armorPen: 0.58, falloff: 0.82, speed: 6.0, kick: 1.3, recover: 9, dual: true,
    desc: '左右开弓，一次 30 发', snd: { cut: 4800, decay: 0.12, thump: 200, vol: 0.6, crack: 1.1, mech: 1 } },
  f57: { name: 'F57 穿甲手枪', kind: 'pistol', team: 'ct', price: 750, dmg: 25, rof: 0.13, mag: 20, reserveMax: 100, ammoPer: 50, ammoPrice: 50, reload: 2.7,
    spread: 0.0065, moveSpread: 0.028, spreadPerShot: 0.01, spreadMax: 0.04, armorPen: 0.92, falloff: 0.88, speed: 6.1, kick: 1.2, recover: 9,
    desc: '20 发，几乎无视护甲', snd: { cut: 5600, decay: 0.11, thump: 230, vol: 0.55, crack: 1.2, mech: 1 } },

  sg8: { name: 'SG-8 泵动霰弹枪', kind: 'shotgun', price: 1700, dmg: 20, pellets: 9, rof: 0.88, mag: 8, reserveMax: 32, ammoPer: 8, ammoPrice: 65, reload: 3.3,
    spread: 0.062, moveSpread: 0.012, spreadPerShot: 0, spreadMax: 0, armorPen: 0.5, falloff: 0.55, range: 45, speed: 5.6, kick: 4.5, recover: 5,
    desc: '近距离一枪倒地', snd: { cut: 2400, decay: 0.3, thump: 110, vol: 1.0, crack: 1.3, tail: 0.5 } },
  sa12: { name: 'SA-12 自动霰弹枪', kind: 'shotgun', price: 3000, dmg: 18, pellets: 6, rof: 0.25, mag: 7, reserveMax: 32, ammoPer: 8, ammoPrice: 65, reload: 3.0,
    spread: 0.07, moveSpread: 0.012, spreadPerShot: 0, spreadMax: 0, armorPen: 0.6, falloff: 0.55, range: 45, speed: 5.6, kick: 3.0, recover: 6,
    desc: '半自动，连续喷射', snd: { cut: 2600, decay: 0.26, thump: 120, vol: 0.95, crack: 1.3, tail: 0.4 } },

  m11: { name: 'M-11 微型冲锋枪', kind: 'smg', team: 't', price: 1400, dmg: 28, rof: 0.07, mag: 30, reserveMax: 100, ammoPer: 12, ammoPrice: 25, reload: 3.1,
    spread: 0.012, moveSpread: 0.02, spreadPerShot: 0.004, spreadMax: 0.035, armorPen: 0.375, falloff: 0.82, speed: 6.0, auto: true, kick: 0.75, recover: 9,
    desc: '射速极快，近战利器', snd: { cut: 4200, decay: 0.09, thump: 200, vol: 0.55, crack: 0.9 } },
  tm9: { name: 'TM-9 微声冲锋枪', kind: 'smg', team: 'ct', price: 1250, dmg: 25, rof: 0.07, mag: 30, reserveMax: 120, ammoPer: 30, ammoPrice: 20, reload: 2.1,
    spread: 0.011, moveSpread: 0.018, spreadPerShot: 0.0035, spreadMax: 0.032, armorPen: 0.42, falloff: 0.84, speed: 6.0, auto: true, kick: 0.6, recover: 9, integralSil: true,
    desc: '自带消音，枪声很小', snd: { cut: 4000, decay: 0.09, thump: 200, vol: 0.5, crack: 0.8 } },
  v10: { name: 'V-10 冲锋枪', kind: 'smg', price: 1500, dmg: 26, rof: 0.08, mag: 30, reserveMax: 120, ammoPer: 30, ammoPrice: 20, reload: 2.6,
    spread: 0.008, moveSpread: 0.016, spreadPerShot: 0.003, spreadMax: 0.028, armorPen: 0.5, falloff: 0.86, speed: 6.0, auto: true, kick: 0.55, recover: 9,
    desc: '稳定好用的冲锋枪', snd: { cut: 4400, decay: 0.1, thump: 190, vol: 0.55, crack: 0.9 } },
  u45: { name: 'U-45 冲锋枪', kind: 'smg', price: 1700, dmg: 30, rof: 0.105, mag: 25, reserveMax: 100, ammoPer: 12, ammoPrice: 25, reload: 3.5,
    spread: 0.008, moveSpread: 0.018, spreadPerShot: 0.0035, spreadMax: 0.03, armorPen: 0.65, falloff: 0.86, speed: 6.0, auto: true, kick: 0.7, recover: 9,
    desc: '单发伤害高', snd: { cut: 3800, decay: 0.12, thump: 170, vol: 0.6, crack: 0.9 } },
  p50: { name: 'P-50 冲锋枪', kind: 'smg', price: 2350, dmg: 26, rof: 0.07, mag: 50, reserveMax: 100, ammoPer: 50, ammoPrice: 50, reload: 3.4,
    spread: 0.0085, moveSpread: 0.017, spreadPerShot: 0.003, spreadMax: 0.03, armorPen: 0.75, falloff: 0.87, speed: 5.9, auto: true, kick: 0.6, recover: 9,
    desc: '50 发大弹匣，跑打稳', snd: { cut: 4800, decay: 0.09, thump: 210, vol: 0.55, crack: 1.0 } },

  gl35: { name: 'GL-35 突击步枪', kind: 'rifle', team: 't', price: 2000, dmg: 30, rof: 0.09, mag: 35, reserveMax: 90, ammoPer: 30, ammoPrice: 80, reload: 2.5,
    spread: 0.0045, moveSpread: 0.07, spreadPerShot: 0.004, spreadMax: 0.032, armorPen: 0.775, falloff: 0.98, speed: 5.5, auto: true, kick: 0.8, recover: 7,
    desc: '35 发，便宜耐打', snd: { cut: 3300, decay: 0.18, thump: 130, vol: 0.8, crack: 1.1, tail: 0.28 } },
  f2: { name: 'F-2 犊牛式步枪', kind: 'rifle', team: 'ct', price: 2250, dmg: 30, rof: 0.09, mag: 25, reserveMax: 90, ammoPer: 30, ammoPrice: 60, reload: 3.3,
    spread: 0.004, moveSpread: 0.07, spreadPerShot: 0.0035, spreadMax: 0.03, armorPen: 0.7, falloff: 0.97, speed: 5.5, auto: true, kick: 0.75, recover: 7, burst: true,
    desc: '右键切换三连发', snd: { cut: 3700, decay: 0.16, thump: 140, vol: 0.75, crack: 1.1, tail: 0.25 } },
  ar7: { name: 'AR-7 突击步枪', kind: 'rifle', team: 't', price: 2500, dmg: 36, rof: 0.1, mag: 30, reserveMax: 90, ammoPer: 30, ammoPrice: 80, reload: 2.5,
    spread: 0.0035, moveSpread: 0.075, spreadPerShot: 0.0038, spreadMax: 0.03, armorPen: 0.78, falloff: 0.98, speed: 5.4, auto: true, kick: 0.95, recover: 7,
    desc: '爆头一枪致命 · 后坐力大', snd: { cut: 3000, decay: 0.2, thump: 120, vol: 0.85, crack: 1.2, tail: 0.32 } },
  k4: { name: 'K-4 卡宾枪', kind: 'rifle', team: 'ct', price: 3100, dmg: 33, rof: 0.09, mag: 30, reserveMax: 90, ammoPer: 30, ammoPrice: 60, reload: 3.1,
    spread: 0.003, moveSpread: 0.07, spreadPerShot: 0.0032, spreadMax: 0.026, armorPen: 0.7, falloff: 0.97, speed: 5.5, auto: true, kick: 0.75, recover: 8, sil: true,
    desc: '弹道好控 · 右键装卸消音器', snd: { cut: 3600, decay: 0.17, thump: 135, vol: 0.75, crack: 1.1, tail: 0.25 } },
  s552: { name: 'S-552 瞄准步枪', kind: 'rifle', team: 't', price: 3500, dmg: 33, rof: 0.09, mag: 30, reserveMax: 90, ammoPer: 30, ammoPrice: 60, reload: 3.0,
    spread: 0.0032, moveSpread: 0.07, spreadPerShot: 0.0034, spreadMax: 0.028, armorPen: 0.75, falloff: 0.98, speed: 5.3, auto: true, kick: 0.8, recover: 7, zoom: [52],
    desc: '右键开 2 倍镜', snd: { cut: 3400, decay: 0.17, thump: 130, vol: 0.8, crack: 1.1, tail: 0.28 } },
  a3: { name: 'A-3 犊牛式步枪', kind: 'rifle', team: 'ct', price: 3500, dmg: 32, rof: 0.09, mag: 30, reserveMax: 90, ammoPer: 30, ammoPrice: 60, reload: 3.3,
    spread: 0.003, moveSpread: 0.07, spreadPerShot: 0.003, spreadMax: 0.026, armorPen: 0.75, falloff: 0.98, speed: 5.4, auto: true, kick: 0.72, recover: 8, zoom: [52],
    desc: '右键开 2 倍镜', snd: { cut: 3500, decay: 0.16, thump: 135, vol: 0.78, crack: 1.1, tail: 0.26 } },
  sc1: { name: 'SC-1 轻型狙击枪', kind: 'sniper', price: 2750, dmg: 75, rof: 1.25, mag: 10, reserveMax: 90, ammoPer: 10, ammoPrice: 80, reload: 2.0,
    spread: 0.0015, unscoped: 0.06, moveSpread: 0.1, spreadPerShot: 0, spreadMax: 0, armorPen: 0.85, falloff: 0.98, speed: 6.0, scopedSpeed: 5.0, kick: 3.5, recover: 5,
    zoom: [40, 15], overlay: true, bolt: true, desc: '轻便，拿着也跑得快', snd: { cut: 2800, decay: 0.3, thump: 100, vol: 1.0, crack: 1.4, tail: 0.6 } },
  lr90: { name: 'LR-90 狙击步枪', kind: 'sniper', price: 4750, dmg: 115, rof: 1.45, mag: 10, reserveMax: 30, ammoPer: 10, ammoPrice: 125, reload: 3.6,
    spread: 0.0012, unscoped: 0.085, moveSpread: 0.16, spreadPerShot: 0, spreadMax: 0, armorPen: 0.97, falloff: 0.99, speed: 4.9, scopedSpeed: 2.6, kick: 5.5, recover: 4,
    zoom: [40, 10], overlay: true, bolt: true, desc: '一枪致命', snd: { cut: 2200, decay: 0.38, thump: 85, vol: 1.15, crack: 1.5, tail: 0.9 } },
  sr3: { name: 'SR-3 连发狙击枪', kind: 'sniper', team: 't', price: 5000, dmg: 80, rof: 0.25, mag: 20, reserveMax: 90, ammoPer: 30, ammoPrice: 80, reload: 4.6,
    spread: 0.002, unscoped: 0.05, moveSpread: 0.12, spreadPerShot: 0.004, spreadMax: 0.02, armorPen: 0.83, falloff: 0.98, speed: 5.0, scopedSpeed: 3.0, kick: 2.5, recover: 6,
    zoom: [40, 15], overlay: true, desc: '半自动连狙', snd: { cut: 2500, decay: 0.3, thump: 95, vol: 1.05, crack: 1.4, tail: 0.6 } },
  sr5: { name: 'SR-5 连发狙击枪', kind: 'sniper', team: 'ct', price: 4200, dmg: 70, rof: 0.25, mag: 30, reserveMax: 90, ammoPer: 30, ammoPrice: 60, reload: 3.8,
    spread: 0.002, unscoped: 0.05, moveSpread: 0.12, spreadPerShot: 0.004, spreadMax: 0.02, armorPen: 0.8, falloff: 0.98, speed: 5.0, scopedSpeed: 3.0, kick: 2.3, recover: 6,
    zoom: [40, 15], overlay: true, desc: '半自动连狙', snd: { cut: 2700, decay: 0.28, thump: 100, vol: 1.0, crack: 1.4, tail: 0.55 } },

  mg60: { name: 'MG-60 轻机枪', kind: 'mg', price: 5750, dmg: 32, rof: 0.08, mag: 100, reserveMax: 200, ammoPer: 30, ammoPrice: 60, reload: 4.7,
    spread: 0.008, moveSpread: 0.09, spreadPerShot: 0.004, spreadMax: 0.045, armorPen: 0.8, falloff: 0.97, speed: 5.0, auto: true, kick: 0.85, recover: 6,
    desc: '100 发弹链，火力压制', snd: { cut: 3100, decay: 0.19, thump: 125, vol: 0.85, crack: 1.2, tail: 0.3 } },

  he: { name: '高爆手雷', kind: 'grenade', price: 300, max: 1, speed: 6.1, desc: '范围伤害，最高 98' },
  flash: { name: '闪光弹', kind: 'grenade', price: 200, max: 2, speed: 6.1, desc: '致盲看向它的敌人' },
  smoke: { name: '烟雾弹', kind: 'grenade', price: 300, max: 1, speed: 6.1, desc: '遮挡视线约 16 秒' },
  bomb: { name: '炸弹', kind: 'bomb', speed: 6.1 },
};
const KIND_SLOT = { knife: 'knife', pistol: 'secondary', smg: 'primary', shotgun: 'primary', rifle: 'primary', sniper: 'primary', mg: 'primary', grenade: 'grenade', bomb: 'bomb' };
const KIND_POSE = { knife: 'knife', pistol: 'pistol', smg: 'smg', shotgun: 'shotgun', rifle: 'rifle', sniper: 'sniper', mg: 'mg', grenade: 'grenade', bomb: 'bomb' };
for (const k in WEAPONS) {
  const w = WEAPONS[k];
  w.id = k; w.slot = KIND_SLOT[w.kind]; w.pose = w.dual ? 'dual' : KIND_POSE[w.kind];
  if (w.reserveMax && w.startReserve == null) w.startReserve = 0;
}
const EQUIP = {
  kevlar: { id: 'kevlar', name: '防弹衣', price: 650, desc: '躯干伤害减免' },
  helmet: { id: 'helmet', name: '防弹衣 + 头盔', price: 1000, desc: '头盔挡住部分爆头' },
  kit: { id: 'kit', name: '拆弹器', price: 200, team: 'ct', desc: '拆弹从 10 秒缩短到 5 秒' },
  shield: { id: 'shield', name: '防爆盾', price: 2200, team: 'ct', desc: '正面挡子弹 · 只能配手枪和匕首' },
};
// numbered buy menu: categories in the classic order
const BUY_MENU = [
  { name: '手枪', items: ['p9', 'b18', 'p2', 'hx50', 'd92', 'f57'] },
  { name: '霰弹枪', items: ['sg8', 'sa12'] },
  { name: '冲锋枪', items: ['m11', 'tm9', 'v10', 'u45', 'p50'] },
  { name: '步枪', items: ['gl35', 'f2', 'ar7', 'k4', 's552', 'a3', 'sc1', 'lr90', 'sr3', 'sr5'] },
  { name: '机枪', items: ['mg60'] },
  { name: '主武器子弹', action: 'ammo1' },
  { name: '副武器子弹', action: 'ammo2' },
  { name: '装备', items: ['kevlar', 'helmet', 'flash', 'he', 'smoke', 'kit', 'shield'] },
];
const NADE_ORDER = ['he', 'flash', 'smoke'];
const teamAllows = (info, team) => !info.team || (info.team === 'ct' ? team === CT : team === T);
const defaultPistol = (team) => (team === CT ? 'p9' : 'b18');
function makeGun(id, full) {
  const w = WEAPONS[id];
  return { id, mag: w.mag, reserve: full ? w.reserveMax : w.startReserve, sil: false, burst: false };
}

// deterministic spray patterns: [yawDeg, pitchDeg] per bullet
function buildPattern(seed, n, kick) {
  const r = mulberry32(seed), out = [];
  let side = r() < 0.5 ? -1 : 1;
  for (let i = 0; i < n; i++) {
    let up, yaw;
    if (i < 8) { up = kick * (1.05 - i * 0.05); yaw = (r() - 0.5) * 0.25 * kick; }
    else if (i < 14) { up = kick * 0.32; yaw = side * kick * (0.5 + r() * 0.4); }
    else { up = kick * 0.12 * r(); if ((i - 14) % 6 === 0) side = -side; yaw = side * kick * (0.55 + r() * 0.5); }
    out.push([yaw, up]);
  }
  return out;
}
const PATTERNS = {};
let _pseed = 11;
for (const k in WEAPONS) if (WEAPONS[k].auto) PATTERNS[k] = buildPattern(_pseed += 17, Math.max(30, WEAPONS[k].mag), WEAPONS[k].kick);

// ------------------------------------------------------------------ riot shield
function shieldActive(a) { return !!(a.alive && a.inv.shield && (a.slot === 'secondary' || a.slot === 'knife')); }
// the shield is a 0.62 m wide plate held in front; "open" swings it to the left so the pistol can fire
function shieldFrame(v) {
  const open = v.shieldOpen;
  const yaw = v.yaw + (open ? 0.85 : 0);
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
  const fwd = open ? 0.26 : 0.46, side = open ? -0.36 : -0.04;
  const c = v.crouch;
  return {
    cx: v.pos.x + fx * fwd + rx * side, cz: v.pos.z + fz * fwd + rz * side,
    nx: -Math.sin(yaw), nz: -Math.cos(yaw), tx: Math.cos(yaw), tz: -Math.sin(yaw),
    y0: v.pos.y + lerp(0.82, 0.36, c) - (open ? 0.12 : 0), y1: v.pos.y + lerp(1.82, 1.36, c) - (open ? 0.12 : 0), hw: 0.31,
  };
}
function rayShield(o, d, v, maxT) {
  if (!shieldActive(v)) return Infinity;
  const f = shieldFrame(v);
  const den = d.x * f.nx + d.z * f.nz;
  if (Math.abs(den) < 1e-4) return Infinity;
  const t = ((f.cx - o.x) * f.nx + (f.cz - o.z) * f.nz) / den;
  if (t <= 0 || t >= maxT) return Infinity;
  const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
  if (py < f.y0 || py > f.y1) return Infinity;
  if (Math.abs((px - f.cx) * f.tx + (pz - f.cz) * f.tz) > f.hw) return Infinity;
  return t;
}

function calcSpread(a, w, inst) {
  const sp = Math.hypot(a.vel.x, a.vel.z);
  const moveFrac = clamp((sp - 1.3) / (w.speed * 0.75), 0, 1);
  let s = w.spread + w.moveSpread * moveFrac + a.spreadAcc;
  if (!a.onGround) s += 0.1;
  if (a.crouch > 0.5 && a.onGround) s *= 0.8;
  if (w.overlay && a.scope === 0) s += w.unscoped;
  if (w.zoom && !w.overlay && a.scope) s *= 0.65;
  if (inst && inst.sil) s *= 0.85;
  if (inst && inst.burst && w.kind === 'pistol') s += 0.014;
  if (shieldActive(a)) s += 0.02;
  return s;
}

// ------------------------------------------------------------------ hit tests
function raySphere(o, d, cx, cy, cz, r) {
  const lx = o.x - cx, ly = o.y - cy, lz = o.z - cz;
  const b = lx * d.x + ly * d.y + lz * d.z;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  return t < 0 ? Infinity : t;
}
function rayCylY(o, d, cx, cz, r, y0, y1) {
  let best = Infinity;
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a > 1e-9) {
    const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t0 = (-b - Math.sqrt(disc)) / (2 * a);
      if (t0 > 0) { const y = o.y + d.y * t0; if (y >= y0 && y <= y1) best = t0; }
    }
  }
  if (Math.abs(d.y) > 1e-6) {
    for (const yc of [y0, y1]) {
      const t = (yc - o.y) / d.y;
      if (t > 0 && t < best) { const px = ox + d.x * t, pz = oz + d.z * t; if (px * px + pz * pz <= r * r) best = t; }
    }
  }
  return best;
}
// hitboxes: head sphere, chest cylinder, legs cylinder (all follow crouch); works for soldiers and hostages
function rayAgent(o, d, v, maxT) {
  const ox = v.pos.x - o.x, oz = v.pos.z - o.z;
  const along = ox * d.x + oz * d.z;
  const hl = Math.hypot(d.x, d.z) || 1e-6;
  const perp = Math.abs(ox * d.z - oz * d.x) / hl;
  if (perp > 0.7 || along < -1) return null;
  const c = v.crouch, by = v.pos.y;
  const hy = by + lerp(1.65, 1.27, c);
  const cb = by + lerp(0.97, 0.6, c), ct = by + lerp(1.53, 1.14, c);
  let bt = maxT, g = null;
  const hx = v.pos.x - Math.sin(v.yaw) * 0.02, hz = v.pos.z - Math.cos(v.yaw) * 0.02;
  let t = raySphere(o, d, hx, hy, hz, 0.15);
  if (t < bt) { bt = t; g = 'head'; }
  t = rayCylY(o, d, v.pos.x, v.pos.z, 0.25, cb, ct);
  if (t < bt) { bt = t; g = 'chest'; }
  t = rayCylY(o, d, v.pos.x, v.pos.z, 0.2, by, cb);
  if (t < bt) { bt = t; g = 'legs'; }
  return g ? { t: bt, group: g } : null;
}

// ------------------------------------------------------------------ shooting
const _eye = new THREE.Vector3(), _dir = new THREE.Vector3(), _mz = new THREE.Vector3(), _end = new THREE.Vector3(), _nrm = { x: 0, y: 0, z: 0 };

function playerMuzzle(a, out, side) {
  agentEye(a, out);
  const cy = Math.cos(a.yaw), sy = Math.sin(a.yaw), cp = Math.cos(a.pitch), spn = Math.sin(a.pitch);
  const lat = 0.14 * (side || 1);
  out.x += -sy * cp * 0.6 + cy * lat;
  out.y += spn * 0.6 - 0.13;
  out.z += -cy * cp * 0.6 - sy * lat;
  return out;
}

function traceShot(a, w, o, d, muzzle, showTracer, dmgScale) {
  const range = w.range || 220;
  const wh = World.raycast(o.x, o.y, o.z, d.x, d.y, d.z, range);
  let bestT = wh ? wh.t : range, victim = null, group = null, shield = null, hostage = null;
  for (const v of G.agents) {
    if (v === a || !v.alive || v.team === a.team) continue;
    const ts = rayShield(o, d, v, bestT);
    const h = rayAgent(o, d, v, Math.min(bestT, ts));
    if (h) { bestT = h.t; victim = v; group = h.group; shield = null; hostage = null; }
    else if (ts < bestT) { bestT = ts; shield = v; victim = null; hostage = null; }
  }
  for (const hs of G.hostages) {
    if (!hs.alive || hs.rescued) continue;
    const h = rayAgent(o, d, hs, bestT);
    if (h) { bestT = h.t; hostage = hs; group = h.group; victim = null; shield = null; }
  }
  _end.set(o.x + d.x * bestT, o.y + d.y * bestT, o.z + d.z * bestT);
  if (showTracer) FX.tracer(muzzle, _end, a === G.player ? 0.5 : 0.8);
  const dmg = w.dmg * Math.pow(w.falloff, bestT / 10) * (dmgScale || 1);
  if (victim) {
    FX.blood(_end, d);
    applyDamage(victim, a, dmg * HIT_MULT[group], group, w.id, o);
    return group;
  }
  if (hostage) {
    FX.blood(_end, d);
    damageHostage(hostage, a, dmg * HIT_MULT[group]);
    return null;
  }
  if (shield) {
    _nrm.x = -d.x; _nrm.y = 0; _nrm.z = -d.z;
    FX.impact(_end, _nrm, 'x');
    SFX.shieldHit(G.viewAgent === shield ? null : _end);
    if (shield === G.player) G.player.punch += 0.004;
    return null;
  }
  if (wh) {
    _nrm.x = wh.nx; _nrm.y = wh.ny; _nrm.z = wh.nz;
    FX.impact(_end, _nrm, World.kindAt(wh.cx, wh.cz));
  }
  return null;
}

function fireWeapon(a, burstShot) {
  const slot = a.inv[a.slot];
  const w = WEAPONS[slot.id];
  slot.mag--;
  if (!burstShot) a.fireCD = Math.max(0, a.fireCD + w.rof);
  a.lastShot = G.time;
  agentEye(a, _eye);
  const comp = (a.ai && a !== G.player) || a.autopilot ? a.ai.recoilComp : 0;
  const sil = !!(slot.sil || w.integralSil);
  const spread = calcSpread(a, w, slot);
  const pellets = w.pellets || 1;
  const by = a.yaw + a.recoil.y * DEG * (1 - comp), bp = a.pitch + a.recoil.p * DEG * (1 - comp);
  const side = w.dual ? (a.dualSide ? -1 : 1) : 1;
  if (a === G.player) playerMuzzle(a, _mz, side); else agentMuzzleWorld(a, _mz);
  for (let i = 0; i < pellets; i++) {
    const ang = Math.random() * TAU;
    const rr = (pellets > 1 ? Math.sqrt(Math.random()) : Math.random()) * spread;
    dirFromAngles(by + Math.cos(ang) * rr / Math.max(0.3, Math.cos(bp)), bp + Math.sin(ang) * rr, _dir);
    const tracer = !sil && (pellets > 1 ? i < 2 : (Math.floor(a.shotIdx) % (a === G.player ? 3 : 2) === 0));
    traceShot(a, w, _eye, _dir, _mz, tracer, sil && slot.sil ? 0.93 : 1);
  }
  const kk = sil ? 0.85 : 1;
  if (w.auto && !slot.burst) {
    const pat = PATTERNS[w.id];
    const k = pat[Math.min(Math.floor(a.shotIdx), pat.length - 1)];
    a.recoil.y += k[0] * kk; a.recoil.p += k[1] * kk;
  } else {
    a.recoil.p += w.kick * rand(0.85, 1.15) * kk * (slot.burst ? 0.55 : 1);
    a.recoil.y += rand(-0.25, 0.25) * w.kick * kk;
  }
  a.shotIdx = Math.floor(a.shotIdx) + 1;
  a.spreadAcc = Math.min(a.spreadAcc + (w.spreadPerShot || 0), Math.max(a.spreadAcc, w.spreadMax || 0));
  if (slot.burst && !burstShot) {
    const gap = w.kind === 'pistol' ? 0.055 : 0.075;
    a.burstQ = Math.min(2, slot.mag); a.burstT = gap; a.burstGap = gap;
    a.fireCD = Math.max(a.fireCD, gap * 2 + (w.kind === 'pistol' ? 0.42 : 0.32));
  }
  if (w.dual) a.dualSide = !a.dualSide;
  if (w.bolt && a.scope) { a.scopeWant = a.scope; a.scope = 0; a.rescopeT = w.rof * 0.85; }
  if (a === G.player) VM.fire(w, side, sil); else FX.muzzle3P(_mz, sil);
  const local = G.viewAgent === a;
  SFX.shot(w, local ? null : a.pos, !local && !G.canHear(a), sil);
  G.noise(a, sil ? 9 : 48, 'shot');
}

function knifeAttack(a, heavy) {
  const w = WEAPONS.knife;
  a.fireCD = heavy ? w.rofAlt : w.rof;
  a.lastShot = G.time;
  agentEye(a, _eye);
  dirFromAngles(a.yaw, a.pitch, _dir);
  let best = null, bt = w.range, grp = 'chest';
  for (const v of G.agents) {
    if (v === a || !v.alive || v.team === a.team) continue;
    let h = rayAgent(_eye, _dir, v, w.range);
    if (!h) {
      const dx = v.pos.x - a.pos.x, dz = v.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d < 1.5 && Math.abs(angleDiff(a.yaw, yawTo(dx, dz))) < 0.6 && Math.abs(v.pos.y - a.pos.y) < 1.2) h = { t: d, group: 'chest' };
    }
    if (h && h.t < bt) { bt = h.t; best = v; grp = h.group; }
  }
  const local = G.viewAgent === a;
  SFX.knife(local ? null : a.pos);
  if (a === G.player) VM.fire(w);
  if (best) {
    // a closed shield facing the attacker stops the blade
    if (shieldActive(best) && !best.shieldOpen && Math.cos(angleDiff(best.yaw, yawTo(a.pos.x - best.pos.x, a.pos.z - best.pos.z))) > 0.35) {
      SFX.shieldHit(local ? null : best.pos);
      return;
    }
    const behind = Math.cos(angleDiff(best.yaw, a.yaw)) > 0.55;
    const dmg = heavy ? (behind ? 180 : 65) : (behind ? 90 : 34);
    _end.copy(_eye).addScaledVector(_dir, bt);
    FX.blood(_end, _dir);
    SFX.knifeHit(local ? null : best.pos);
    applyDamage(best, a, dmg, grp === 'head' ? 'chest' : grp, 'knife', _eye);
    return;
  }
  const wh = World.raycast(_eye.x, _eye.y, _eye.z, _dir.x, _dir.y, _dir.z, w.range);
  if (wh) {
    _end.copy(_eye).addScaledVector(_dir, wh.t);
    _nrm.x = wh.nx; _nrm.y = wh.ny; _nrm.z = wh.nz;
    FX.impact(_end, _nrm, World.kindAt(wh.cx, wh.cz));
    SFX.knifeHit(local ? null : a.pos);
  }
}
