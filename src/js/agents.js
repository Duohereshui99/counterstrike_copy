'use strict';
/* =========================================================
   agents.js — players and bots share one body model:
   loadout, Quake-style movement, timers, damage and death.
   ========================================================= */
const EYE_STAND = 1.64, EYE_CROUCH = 1.22;
const FRICTION = 5.2, STOP_SPEED = 1.9, ACCEL = 5.5, AIR_ACCEL = 12, AIR_MAX = 0.8;

function createAgent(id, name, team, isPlayer) {
  const a = {
    id, name, team, isPlayer: !!isPlayer, alive: true, hp: 100, armor: 0, helmet: false, kit: false, money: 800, skin: 0,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), vy: 0, onGround: true, r: 0.4, airStep: 0.05,
    yaw: 0, pitch: 0, crouch: 0, crouching: false, walking: false,
    inv: { primary: null, secondary: null, knife: { id: 'knife' }, he: 0, flash: 0, smoke: 0, shield: false },
    slot: 'secondary', prevSlot: 'knife', nade: 'he', hasBomb: false,
    fireCD: 0, reloadT: 0, reloadDur: 1, switchT: 0, recoil: { p: 0, y: 0 }, shotIdx: 0, spreadAcc: 0, lastShot: -9,
    scope: 0, scopeWant: 0, rescopeT: 0, throwCD: 0, burstQ: 0, burstT: 0, burstGap: 0.06, dualSide: false, silT: 0, shieldOpen: true,
    kills: 0, deaths: 0, assists: 0, hs: 0, dmgDone: 0, roundKills: 0, dmgFrom: new Map(),
    blind: 0, blindMax: 0, tagT: 0, action: null, stepAcc: 0, animPhase: 0, deadT: 0, deathDir: { x: 1, z: 0 },
    model: null, ai: null, viewY: 1.64, punch: 0, landDip: 0, lastHurt: -9, autopilot: false,
  };
  resetLoadout(a);
  return a;
}
function resetLoadout(a) {
  a.inv.primary = null;
  a.inv.secondary = makeGun(defaultPistol(a.team), false);
  a.inv.he = 0; a.inv.flash = 0; a.inv.smoke = 0; a.inv.shield = false;
  a.armor = 0; a.helmet = false; a.kit = false;
  a.slot = 'secondary'; a.prevSlot = 'knife'; a.shieldOpen = true;
}
function agentEye(a, out) { return out.set(a.pos.x, a.pos.y + lerp(EYE_STAND, EYE_CROUCH, a.crouch), a.pos.z); }
function headY(a) { return lerp(1.65, 1.27, a.crouch); }
function chestY(a) { return lerp(1.16, 0.84, a.crouch); }

function curWeaponId(a) {
  switch (a.slot) {
    case 'primary': return a.inv.primary ? a.inv.primary.id : null;
    case 'secondary': return a.inv.secondary ? a.inv.secondary.id : null;
    case 'knife': return 'knife';
    case 'grenade': return a.inv[a.nade] > 0 ? a.nade : null;
    case 'bomb': return a.hasBomb ? 'bomb' : null;
  }
  return null;
}
function curWeapon(a) { const id = curWeaponId(a); return id ? WEAPONS[id] : null; }
function curGun(a) { return (a.slot === 'primary' || a.slot === 'secondary') ? a.inv[a.slot] : null; }
function modelWeaponId(a) { return curWeaponId(a); }
function nadeCount(a) { return a.inv.he + a.inv.flash + a.inv.smoke; }
function bestSlot(a) { return a.inv.primary ? 'primary' : a.inv.secondary ? 'secondary' : 'knife'; }
function slotValid(a, slot) {
  if (slot === 'primary') return !!a.inv.primary;
  if (slot === 'secondary') return !!a.inv.secondary;
  if (slot === 'grenade') return nadeCount(a) > 0;
  if (slot === 'bomb') return a.hasBomb;
  return slot === 'knife';
}

function switchSlot(a, slot) {
  if (!a.alive || !slotValid(a, slot)) return false;
  if (slot === 'grenade') {
    if (a.slot === 'grenade') {
      const i = NADE_ORDER.indexOf(a.nade);
      let next = null;
      for (let k = 1; k <= 3; k++) { const n = NADE_ORDER[(i + k) % 3]; if (a.inv[n] > 0) { next = n; break; } }
      if (!next || next === a.nade) return false;
      a.nade = next; a.switchT = 0.3;
      onSwitched(a);
      return true;
    }
    if (a.inv[a.nade] <= 0) a.nade = NADE_ORDER.find((n) => a.inv[n] > 0);
  } else if (a.slot === slot) return false;
  if (a.slot !== slot) a.prevSlot = a.slot;
  a.slot = slot;
  a.switchT = slot === 'knife' ? 0.3 : slot === 'grenade' ? 0.35 : 0.5;
  a.reloadT = 0; a.scope = 0; a.rescopeT = 0; a.shotIdx = 0; a.burstQ = 0; a.silT = 0; a.shieldOpen = true;
  onSwitched(a);
  return true;
}
function onSwitched(a) {
  if (a === G.player) { const id = curWeaponId(a); if (id) VM.set(id, shieldActive(a)); SFX.deploy(); }
}

function startReload(a) {
  const s = curGun(a);
  if (!s) return false;
  const w = WEAPONS[s.id];
  if (!w.mag || s.mag >= w.mag || s.reserve <= 0 || a.reloadT > 0 || a.silT > 0) return false;
  a.reloadT = w.reload; a.reloadDur = w.reload; a.scope = 0; a.rescopeT = 0; a.burstQ = 0;
  a.rlStage = 0;
  if (a === G.player) SFX.reloadPart('out');
  return true;
}
function finishReload(a) {
  const s = curGun(a);
  if (!s || !WEAPONS[s.id].mag) return;
  const take = Math.min(WEAPONS[s.id].mag - s.mag, s.reserve);
  s.mag += take; s.reserve -= take;
}
// right-click specials that take time: attaching or removing a silencer
function toggleSilencer(a) {
  const s = curGun(a);
  if (!s || !WEAPONS[s.id].sil || a.reloadT > 0 || a.silT > 0 || shieldActive(a)) return false;
  a.silT = 1.6; a.silTo = !s.sil; a.burstQ = 0;
  if (a === G.player) { VM.silencer(a.silTo); SFX.reloadPart('bolt'); }
  return true;
}
function toggleBurst(a) {
  const s = curGun(a);
  if (!s || !WEAPONS[s.id].burst) return false;
  s.burst = !s.burst; a.burstQ = 0;
  if (a === G.player) { SFX.ui('click'); HUD.notice(s.burst ? '已切换到三连发模式' : (WEAPONS[s.id].auto ? '已切换到全自动模式' : '已切换到半自动模式')); }
  return true;
}

function updateAgentTimers(a, dt) {
  a.fireCD = Math.max(-0.04, a.fireCD - dt);
  a.throwCD = Math.max(0, a.throwCD - dt);
  if (a.switchT > 0) a.switchT -= dt;
  if (a.reloadT > 0) {
    a.reloadT -= dt;
    if (a === G.player) {
      const f = 1 - a.reloadT / a.reloadDur;
      if (a.rlStage === 0 && f > 0.45) { SFX.reloadPart('in'); a.rlStage = 1; }
      else if (a.rlStage === 1 && f > 0.8) { SFX.reloadPart('bolt'); a.rlStage = 2; }
    }
    if (a.reloadT <= 0) { a.reloadT = 0; finishReload(a); }
  }
  if (a.silT > 0) {
    a.silT -= dt;
    if (a.silT <= 0) { a.silT = 0; const s = curGun(a); if (s) s.sil = a.silTo; }
  }
  if (a.burstQ > 0) {
    a.burstT -= dt;
    if (a.burstT <= 0) {
      const s = curGun(a);
      if (a.alive && s && s.burst && s.mag > 0 && a.reloadT <= 0 && a.switchT <= 0) { fireWeapon(a, true); a.burstQ--; a.burstT += a.burstGap; }
      else a.burstQ = 0;
    }
  }
  if (a.rescopeT > 0) {
    a.rescopeT -= dt;
    const w = curWeapon(a);
    if (a.rescopeT <= 0 && w && w.overlay && a.reloadT <= 0) a.scope = a.scopeWant;
  }
  const w = curWeapon(a);
  const since = G.time - a.lastShot;
  if (since > ((w && w.rof) || 0.1) + 0.03) {
    const k = Math.exp(-((w && w.recover) || 7) * dt);
    a.recoil.p *= k; a.recoil.y *= k;
    a.shotIdx = Math.max(0, a.shotIdx - dt * 16);
  }
  a.spreadAcc *= Math.exp(-5 * dt);
  if (a.blind > 0) a.blind = Math.max(0, a.blind - dt);
  if (a.tagT > 0) a.tagT -= dt;
  a.punch = damp(a.punch, 0, 10, dt);
}

function agentMaxSpeed(a) {
  const w = curWeapon(a);
  let s = w ? w.speed : 6;
  if (w && w.overlay && a.scope > 0) s = w.scopedSpeed;
  else if (w && w.zoom && a.scope > 0) s *= 0.85;
  if (shieldActive(a)) s = Math.min(s, a.shieldOpen ? 5.2 : 4.6);
  if (a.crouch > 0.5) s *= 0.34;
  else if (a.walking) s *= 0.52;
  if (a.tagT > 0) s *= 0.6;
  return s;
}

function accelerate(v, dx, dz, wishSpeed, accel, base, dt) {
  const cur = v.x * dx + v.z * dz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  const as = Math.min(accel * base * dt, add);
  v.x += as * dx; v.z += as * dz;
}

function moveAgent(a, wx, wz, dt, jump) {
  const wantC = a.crouching ? 1 : 0;
  a.crouch = clamp(a.crouch + clamp(wantC - a.crouch, -dt / 0.14, dt / 0.14), 0, 1);
  a.airStep = (!a.onGround && a.crouching) ? 0.3 : 0.05;
  const frozen = G.phase === 'freeze' || !!a.action;
  let len = Math.hypot(wx, wz);
  if (frozen || len < 1e-4) { wx = 0; wz = 0; len = 0; }
  const dx = len ? wx / len : 0, dz = len ? wz / len : 0;
  const maxS = agentMaxSpeed(a);
  const wish = maxS * Math.min(1, len);
  const v = a.vel;
  if (a.onGround) {
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0) {
      const drop = Math.max(sp, STOP_SPEED) * FRICTION * dt;
      const ns = Math.max(0, sp - drop) / sp;
      v.x *= ns; v.z *= ns;
    }
    if (len) accelerate(v, dx, dz, wish, ACCEL, wish, dt);
  } else if (len) {
    accelerate(v, dx, dz, Math.min(wish, AIR_MAX), AIR_ACCEL, wish, dt);
  }
  if (jump && a.onGround && !frozen) {
    a.vy = JUMP_V; a.onGround = false;
    if (a === G.viewAgent) SFX.footstep(a.pos, true, 'jump');
  }
  const r = World.moveBody(a, v.x * dt, v.z * dt);
  if (r.hitX) v.x = 0;
  if (r.hitZ) v.z = 0;
  const impact = World.bodyVertical(a, dt);
  if (impact > 3) {
    SFX.land(a.pos, a === G.viewAgent);
    if (a === G.player) a.landDip = Math.min(0.12, impact * 0.012);
    if (!a.walking) G.noise(a, 12, 'step');
  }
  const hs = Math.hypot(v.x, v.z);
  if (a.onGround && hs > 0.5) {
    a.stepAcc += hs * dt;
    if (a.stepAcc > 2.25) {
      a.stepAcc = 0;
      if (hs > 3.3 && !a.walking && a.crouch < 0.5) {
        const k = World.kindAt(World.toCell(a.pos.x), World.toCell(a.pos.z));
        const surf = (k === 'c' || k === 'C') ? 'wood' : (k === 'x' || k === 'X') ? 'metal' : 'stone';
        SFX.footstep(a.pos, a === G.viewAgent, surf);
        G.noise(a, 16, 'step');
      }
    }
  }
}

function separateAgents() {
  const A = G.agents;
  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < A.length; j++) {
      const b = A[j];
      if (!b.alive || Math.abs(a.pos.y - b.pos.y) > 1.6) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d2 = dx * dx + dz * dz, min = a.r + b.r;
      if (d2 >= min * min) continue;
      if (d2 < 1e-6) { World.moveBody(b, 0.05, 0.03); continue; }
      const d = Math.sqrt(d2), push = (min - d) / 2 + 0.001, nx = dx / d, nz = dz / d;
      World.moveBody(a, -nx * push, -nz * push);
      World.moveBody(b, nx * push, nz * push);
    }
  }
}

function addMoney(a, amt, popup) {
  const before = a.money;
  a.money = clamp(a.money + amt, 0, 16000);
  if (popup && a === G.player && a.money !== before) HUD.moneyPop(a.money - before);
}

function applyDamage(v, att, dmg, group, wid, fromPos) {
  if (!v.alive) return;
  if (att && att !== v && att.team === v.team) return;
  const w = WEAPONS[wid];
  let hp = dmg;
  const armored = v.armor > 0 && group !== 'legs' && (group !== 'head' || v.helmet);
  if (armored) {
    const pen = w && w.armorPen != null ? w.armorPen : 0.5;
    hp = dmg * pen;
    v.armor = Math.max(0, Math.round(v.armor - (dmg - hp) * 0.5));
  }
  hp = Math.max(1, Math.round(hp));
  const dealt = Math.min(hp, v.hp);
  v.hp -= hp;
  v.lastHurt = G.time;
  v.tagT = 0.3;
  if (att && att !== v) {
    v.dmgFrom.set(att, (v.dmgFrom.get(att) || 0) + dealt);
    att.dmgDone += dealt;
  }
  if (v.ai && att && att !== v) AI.onDamaged(v, att);
  if (v === G.player) {
    HUD.damage(fromPos || (att && att.pos), hp);
    v.punch += group === 'head' ? 0.045 : 0.02;
    SFX.hurt(group === 'head');
  }
  if (att === G.player && v !== G.player) { HUD.hitmarker(group === 'head'); SFX.hit(group === 'head'); }
  if (v.hp <= 0) killAgent(v, att, wid, group === 'head', fromPos);
}

function killAgent(v, att, wid, head, fromPos) {
  v.alive = false; v.hp = 0; v.deaths++; v.deadT = 0; v.scope = 0; v.burstQ = 0;
  if (v.action) cancelAction(v);
  const src = fromPos || (att && att.pos);
  if (src) {
    const rel = angleDiff(v.yaw, yawTo(src.x - v.pos.x, src.z - v.pos.z));
    v.deathDir = Math.abs(rel) < Math.PI / 4 ? { x: 1, z: 0 } : Math.abs(rel) > Math.PI * 0.75 ? { x: -1, z: 0 } : { x: 0, z: rel > 0 ? -1 : 1 };
  } else v.deathDir = { x: 1, z: 0 };
  if (att && att !== v && att.team !== v.team) {
    att.kills++; att.roundKills++;
    if (head) att.hs++;
    addMoney(att, KILL_REWARD, true);
    if (att === G.player) SFX.killConfirm();
    if (att.ai && Math.random() < 0.3) Radio.say(att, pick(['敌人已倒下', '干掉一个', '解决一个']), true);
  }
  for (const [who, d] of v.dmgFrom) if (who !== att && who.team !== v.team && d >= 40) who.assists++;
  HUD.killfeed(att, v, wid, head);
  dropOnDeath(v);
  for (const h of G.hostages) if (h.leader === v) h.leader = null;
  if (v === G.player) onPlayerDeath(att);
  G.checkRoundEnd();
}

function dropOnDeath(v) {
  if (v.hasBomb) dropBomb(v);
  const s = v.inv.primary || (v.inv.secondary && v.inv.secondary.id !== defaultPistol(v.team) ? v.inv.secondary : null);
  if (s) dropItem(s.id, s.mag, s.reserve, v.pos, s.sil);
}
