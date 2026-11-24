'use strict';
/* =========================================================
   bots.js — bot brains. Bots use exactly the same body,
   weapons and hit detection as the player. Skill comes from
   reaction time, aim error that settles over time, turn speed,
   recoil control and decision making. They follow team radio
   orders from the player and handle both game modes.
   ========================================================= */
const DIFFS = {
  easy: { react: 0.66, err: 4.6, track: 1.6, turn: 260, head: 0.05, comp: 0.35, fov: 105, range: 45, strafe: 0.45, crouch: 0.1, burst: 4, patience: 3, nades: 0.4 },
  normal: { react: 0.46, err: 3.0, track: 2.5, turn: 420, head: 0.16, comp: 0.6, fov: 120, range: 60, strafe: 0.7, crouch: 0.25, burst: 6, patience: 4, nades: 0.7 },
  hard: { react: 0.25, err: 1.6, track: 3.9, turn: 640, head: 0.42, comp: 0.8, fov: 135, range: 80, strafe: 0.9, crouch: 0.35, burst: 9, patience: 5, nades: 1.0 },
};
const _ae = new THREE.Vector3(), _ah = new THREE.Vector3();
const cellV3 = (c, y) => { const p = cellToWorld(c); return new THREE.Vector3(p.x, y, p.z); };

const AI = {
  makeState() {
    const D = DIFFS[Settings.difficulty] || DIFFS.normal;
    return {
      D, recoilComp: D.comp, think: Math.random() * 0.1,
      target: null, targetVis: false, lastSeen: new THREE.Vector3(), lastSeenT: -99, react: 0,
      errX: 0, errY: 0, aimHead: false, aimErr: 1, tDist: 10,
      path: null, pathI: 0, goal: null, goalKey: '', pathT: -99, arrived: false,
      stuckT: 0, lastPos: new THREE.Vector3(), checkT: 0, nudge: 0, nudgeDir: 0,
      mode: 'idle', lookAt: null, lookUntil: 0, strafe: 0, strafeT: 0, crouchWant: false,
      burstLeft: 0, burstPause: 0, semiT: 0, heard: new THREE.Vector3(), heardT: -99, nadeCD: 0, chase: false,
      route: null, routeSite: null, stage: 0, startDelay: 0, sitePos: null, arrivedSite: false,
      hold: null, holdSite: null, holdArrived: false, holdCrouch: false, rotated: false,
      guard: null, guardLook: null, guardDone: false, plantSpot: null, walk: false,
      followUntil: 0, holdUntil: 0, fallbackUntil: 0, spotCall: -99,
    };
  },

  // called by startRound(): roles, routes and buying
  roundStart() {
    const atkTeam = teamOfSide('atk');
    const bots = G.agents.filter((a) => a.ai && (a !== G.player || a.autopilot));
    for (const b of bots) {
      b.ai = this.makeState();
      b.ai.holdCrouch = Math.random() < 0.3;
    }
    const attackers = bots.filter((b) => b.team === atkTeam);
    const defenders = bots.filter((b) => b.team !== atkTeam);
    shuffle(attackers).forEach((b, i) => {
      // bomb mode: everybody hits the planned site; hostage mode: split between both hostage pairs
      const site = G.mode === 'hostage' ? (i % 2 ? 'A' : 'B') : G.atkPlan.site;
      b.ai.route = ATK_ROUTES[site][Math.floor(i / 2) % 2];
      b.ai.routeSite = site;
      b.ai.startDelay = rand(0, 3.5);
    });
    const roles = shuffle(['A', 'B', 'M', 'A', 'B', 'A', 'B', 'M'].slice(0, Math.max(defenders.length, 1)));
    const used = new Set();
    defenders.forEach((b, i) => {
      const s = roles[i % roles.length];
      const opts = shuffle(DEF_HOLDS[s].slice());
      const h = opts.find((o) => !used.has(o)) || opts[0];
      used.add(h);
      b.ai.hold = h; b.ai.holdSite = s;
    });
    for (const b of bots) this.buy(b);
  },

  buy(b) {
    const ct = b.team === CT;
    const tryBuy = (id) => buyItem(b, id) === null;
    const ammo = (which, n) => { for (let i = 0; i < n; i++) if (buyAmmo(b, which) !== null) break; };
    if (G.round === 1 || b.money < 1500) {
      const r = Math.random();
      if (r < 0.5) tryBuy('kevlar');
      else if (r < 0.8) tryBuy(ct ? pick(['hx50', 'f57', 'p2']) : pick(['hx50', 'd92', 'p2']));
      else { tryBuy('flash'); tryBuy('he'); }
      ammo(2, 2);
      if (ct && Math.random() < 0.3) tryBuy('kit');
      return;
    }
    if (!b.inv.primary && !b.inv.shield) {
      const m = b.money, r = Math.random();
      if (m >= 6000 && r < 0.12) tryBuy('lr90');
      else if (m >= 6500 && r < 0.15) tryBuy(ct ? 'sr5' : 'sr3');
      else if (m >= 4300) {
        if (ct) { if (r < 0.06) tryBuy('shield'); else tryBuy(r < 0.6 ? 'k4' : r < 0.8 ? 'a3' : 'f2'); }
        else tryBuy(r < 0.6 ? 'ar7' : r < 0.82 ? 'gl35' : 's552');
      } else if (m >= 3000) tryBuy(ct ? (r < 0.6 ? 'f2' : 'k4') : (r < 0.55 ? 'gl35' : 'ar7'));
      else if (m >= 2200 && Math.random() < 0.6) tryBuy(pick(ct ? ['tm9', 'v10', 'u45', 'sg8'] : ['m11', 'v10', 'u45', 'sg8']));
    }
    if (b.inv.shield && b.inv.secondary && b.inv.secondary.id === defaultPistol(b.team) && b.money >= 900) tryBuy(pick(['hx50', 'f57']));
    if (b.armor < 60 || !b.helmet) {
      if (b.money >= 1000) tryBuy('helmet');
      else if (b.money >= 650 && b.armor < 60) tryBuy('kevlar');
    }
    if (b.inv.primary) ammo(1, 3);
    ammo(2, 2);
    if (ct && !b.kit && b.money >= 200 && G.mode === 'bomb' && Math.random() < 0.6) tryBuy('kit');
    for (const n of shuffle(['flash', 'smoke', 'he'])) if (b.money >= 700 && Math.random() < 0.55) tryBuy(n);
    if (b.inv.primary) ammo(1, 3);
    for (const k of ['primary', 'secondary']) { const s = b.inv[k]; if (s && WEAPONS[s.id].sil && Math.random() < 0.5) s.sil = true; }
    b.slot = bestSlot(b);
  },

  update(b, dt) {
    const ai = b.ai;
    ai.nadeCD -= dt;
    ai.think -= dt;
    if (ai.think <= 0) {
      ai.think = 0.1 + Math.random() * 0.04;
      this.perceive(b);
      if (G.phase !== 'freeze') this.decide(b);
    }
    this.aim(b, dt);
    if (G.phase !== 'freeze' && G.phase !== 'post') this.fire(b, dt);
    this.move(b, dt);
  },

  perceive(b) {
    const ai = b.ai, D = ai.D;
    if (b.blind > 0.4) { ai.targetVis = false; return; }
    agentEye(b, _ae);
    let best = null, bestScore = Infinity;
    for (const e of G.agents) {
      if (!e.alive || e.team === b.team) continue;
      const dx = e.pos.x - b.pos.x, dz = e.pos.z - b.pos.z, d = Math.hypot(dx, dz);
      if (d > D.range) continue;
      const off = Math.abs(angleDiff(b.yaw, yawTo(dx, dz)));
      const tracking = ai.target === e && G.time - ai.lastSeenT < 0.8;
      if (off > D.fov * DEG * 0.5 && d > 2.5 && !tracking) continue;
      if (!canSeeAgent(_ae, e)) continue;
      G.spot(b.team, e);
      const score = d + off * 6 - (e === ai.target ? 10 : 0) - (e.action ? 6 : 0);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) {
      if (best !== ai.target || !ai.targetVis) {
        if (ai.mode !== 'combat' && G.time - ai.spotCall > 9) { ai.spotCall = G.time; Radio.say(b, pick(['发现敌人', '这边有人', '敌人在这']), true); }
        this.acquire(b, best);
      }
      ai.targetVis = true;
      ai.lastSeen.copy(best.pos);
      ai.lastSeenT = G.time;
      const j = D.err * DEG * 0.06;
      ai.errX += rand(-j, j); ai.errY += rand(-j, j) * 0.5;
    } else ai.targetVis = false;
  },

  acquire(b, e) {
    const ai = b.ai, D = ai.D;
    const reacquire = ai.target === e && G.time - ai.lastSeenT < 1.2;
    const off = Math.abs(angleDiff(b.yaw, yawTo(e.pos.x - b.pos.x, e.pos.z - b.pos.z)));
    ai.target = e;
    ai.react = reacquire ? D.react * 0.35 : D.react * rand(0.75, 1.3) + (off > 0.9 ? 0.15 : 0);
    const errScale = reacquire ? 0.4 : 1;
    const err = D.err * DEG * rand(0.6, 1.4) * errScale, a = Math.random() * TAU;
    ai.errX = Math.cos(a) * err; ai.errY = Math.sin(a) * err * 0.6;
    ai.aimHead = Math.random() < D.head;
    const d = Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z);
    ai.burstLeft = d < 8 ? 30 : D.burst;
    ai.burstPause = 0;
    ai.mode = 'combat';
  },

  aim(b, dt) {
    const ai = b.ai, D = ai.D;
    let wy = b.yaw, wp = 0, rate = D.turn * DEG, smooth = 10;
    if (b.blind > 0.3) {
      wy = b.yaw + Math.sin(G.time * 3 + b.id) * 0.5; wp = Math.sin(G.time * 2.3 + b.id) * 0.25; rate *= 0.4;
    } else if (ai.target && ai.targetVis && ai.target.alive) {
      const t = ai.target;
      agentEye(b, _ae);
      const ty = t.pos.y + (ai.aimHead ? headY(t) : chestY(t));
      const dx = t.pos.x - _ae.x, dy = ty - _ae.y, dz = t.pos.z - _ae.z, hd = Math.hypot(dx, dz);
      const k = Math.exp(-D.track * dt);
      ai.errX *= k; ai.errY *= k;
      const ty0 = yawTo(dx, dz), tp0 = Math.atan2(dy, hd);
      wy = ty0 + ai.errX; wp = tp0 + ai.errY;
      ai.aimErr = Math.hypot(angleDiff(b.yaw, ty0) * Math.cos(tp0), b.pitch - tp0);
      ai.tDist = Math.hypot(hd, dy);
      smooth = 14;
    } else if (ai.lookAt) {
      const dx = ai.lookAt.x - b.pos.x, dz = ai.lookAt.z - b.pos.z;
      if (dx * dx + dz * dz > 0.3) {
        wy = yawTo(dx, dz);
        wp = Math.atan2(ai.lookAt.y - (b.pos.y + 1.6), Math.hypot(dx, dz));
      }
      wy += Math.sin(G.time * 0.6 + b.id * 1.7) * (ai.mode === 'hold' ? 0.22 : 0.06);
      rate *= 0.6; smooth = 5;
    } else {
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (sp > 0.8) wy = yawTo(b.vel.x, b.vel.z);
      rate *= 0.6; smooth = 6;
    }
    const mx = rate * dt;
    b.yaw = wrapAngle(b.yaw + clamp(angleDiff(b.yaw, wy) * Math.min(1, smooth * dt), -mx, mx));
    b.pitch = clamp(b.pitch + clamp((wp - b.pitch) * Math.min(1, smooth * dt), -mx, mx), -1.3, 1.3);
  },

  fire(b, dt) {
    const ai = b.ai, D = ai.D, t = ai.target;
    const fighting = !!(t && t.alive && ai.targetVis && b.blind <= 0.3);
    if (shieldActive(b)) b.shieldOpen = fighting;
    if (!fighting) return;
    ai.react -= dt;
    if (ai.react > 0) return;
    const w = curWeapon(b);
    if (!w || w.kind === 'grenade' || w.kind === 'bomb') { switchSlot(b, bestSlot(b)); return; }
    if (b.switchT > 0 || b.reloadT > 0 || b.silT > 0) return;
    const d = ai.tDist || 10;
    if (w.kind === 'knife') {
      if (b.inv.secondary && b.inv.secondary.mag > 0 && d > 3) { switchSlot(b, 'secondary'); return; }
      if (d < 1.9 && b.fireCD <= 0) knifeAttack(b, false);
      return;
    }
    const s = b.inv[b.slot];
    if (s.mag <= 0) {
      if (b.slot === 'primary' && b.inv.secondary && b.inv.secondary.mag > 0 && d < 16) { switchSlot(b, 'secondary'); return; }
      if (!startReload(b)) switchSlot(b, b.slot === 'primary' && b.inv.secondary && b.inv.secondary.mag > 0 ? 'secondary' : 'knife');
      return;
    }
    if (w.zoom && b.scope === 0 && b.rescopeT <= 0 && d > (w.overlay ? 6 : 18)) { b.scope = 1; b.scopeWant = 1; return; }
    if (w.zoom && !w.overlay && b.scope && d < 12) b.scope = 0;
    const tol = Math.atan2(0.3, d) * 1.3 + 0.004;
    if (ai.aimErr > tol) return;
    if (ai.burstPause > 0) { ai.burstPause -= dt; return; }
    if (b.fireCD > 0) return;
    if (!w.auto && G.time < ai.semiT) return;
    fireWeapon(b);
    if (w.auto) {
      if (--ai.burstLeft <= 0) {
        ai.burstLeft = d < 8 ? 30 : d < 18 ? D.burst : Math.max(2, Math.round(D.burst / 2));
        ai.burstPause = d < 8 ? 0.05 : rand(0.22, 0.45);
      }
    } else ai.semiT = G.time + w.rof + (d > 12 ? rand(0.08, 0.3) : rand(0.03, 0.12));
  },

  move(b, dt) {
    const ai = b.ai, D = ai.D;
    let wx = 0, wz = 0;
    b.walking = false;
    if (G.phase !== 'freeze' && !b.action) {
      const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw), rx = -fz, rz = fx;
      if (ai.mode === 'combat' && ai.target && ai.targetVis) {
        const w = curWeapon(b) || WEAPONS.knife, d = ai.tDist || 10;
        ai.strafeT -= dt;
        if (ai.strafeT <= 0) {
          ai.strafeT = rand(0.3, 0.85);
          ai.strafe = Math.random() < D.strafe ? (Math.random() < 0.5 ? -1 : 1) : 0;
          ai.crouchWant = (w.kind === 'rifle' || w.kind === 'sniper' || w.kind === 'mg') && d > 12 && Math.random() < D.crouch;
        }
        let s = ai.strafe, fwd = 0;
        const steady = (w.kind === 'rifle' || w.kind === 'sniper' || w.kind === 'mg') && d > 9 && ai.react <= 0.05 && ai.aimErr < 0.1;
        if (steady) s = 0;
        if (w.kind === 'knife') { fwd = 1; s *= 0.4; }
        else if (shieldActive(b)) { fwd = d > 6 ? 0.5 : 0; s *= 0.5; }
        else if ((w.kind === 'shotgun' || w.kind === 'smg') && d > 8) fwd = 0.6;
        else if (d < 2.5) fwd = -0.6;
        wx = rx * s + fx * fwd; wz = rz * s + fz * fwd;
        b.crouching = ai.crouchWant && steady;
      } else {
        b.crouching = ai.mode === 'hold' && ai.holdCrouch;
        if (ai.path) {
          let wp = ai.path[ai.pathI];
          let dx = wp.x - b.pos.x, dz = wp.z - b.pos.z, d = Math.hypot(dx, dz);
          if (d < 0.5 && ai.pathI < ai.path.length - 1) {
            ai.pathI++; wp = ai.path[ai.pathI];
            dx = wp.x - b.pos.x; dz = wp.z - b.pos.z; d = Math.hypot(dx, dz);
          }
          if (ai.pathI >= ai.path.length - 1 && d < 0.4) { ai.path = null; ai.arrived = true; }
          else if (d > 1e-3) { wx = dx / d; wz = dz / d; }
          b.walking = ai.walk;
        }
      }
      for (const o of G.agents) {
        if (o === b || !o.alive || o.team !== b.team) continue;
        const dx = b.pos.x - o.pos.x, dz = b.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
        if (d2 < 1.44 && d2 > 1e-4) { const d = Math.sqrt(d2); wx += dx / d * (1.2 - d) * 1.2; wz += dz / d * (1.2 - d) * 1.2; }
      }
      ai.checkT -= dt;
      if (ai.checkT <= 0) {
        ai.checkT = 0.5;
        const moved = Math.hypot(b.pos.x - ai.lastPos.x, b.pos.z - ai.lastPos.z);
        if (ai.path && moved < 0.25) {
          ai.stuckT += 0.5;
          if (ai.stuckT >= 1) { ai.pathT = -99; ai.goalKey = ''; ai.nudge = rand(0.3, 0.7); ai.nudgeDir = Math.random() * TAU; ai.stuckT = 0; }
        } else ai.stuckT = 0;
        ai.lastPos.copy(b.pos);
      }
      if (ai.nudge > 0) { ai.nudge -= dt; wx += Math.cos(ai.nudgeDir); wz += Math.sin(ai.nudgeDir); }
    }
    moveAgent(b, wx, wz, dt, false);
  },

  goTo(b, x, z, key) {
    const ai = b.ai;
    if (ai.goal && ai.goalKey === key && Math.hypot(ai.goal.x - x, ai.goal.z - z) < 1.0 && G.time - ai.pathT < 8 && (ai.path || ai.arrived)) return;
    ai.goal = { x, z }; ai.goalKey = key; ai.pathT = G.time; ai.arrived = false;
    const p = World.findPath(b.pos.x, b.pos.z, x, z);
    ai.path = p && p.length ? p : null;
    ai.pathI = 0;
    if (!ai.path) ai.arrived = true;
  },

  decide(b) {
    const ai = b.ai, D = ai.D;
    const side = sideOf(b.team);
    if (ai.target && !ai.target.alive) { ai.target = null; ai.targetVis = false; }
    if (ai.target && ai.targetVis) {
      ai.mode = 'combat'; ai.lookAt = null;
      if (b.action && (b.action.type === 'plant' || b.action.total - b.action.t > 1.2)) cancelAction(b);
      if (b.slot === 'grenade' || b.slot === 'bomb') switchSlot(b, bestSlot(b));
      return;
    }
    if (b.action) return;
    if (G.phase === 'post') { ai.path = null; return; }
    if (ai.target && G.time - ai.lastSeenT < D.patience) {
      if (ai.mode !== 'hunt') {
        ai.mode = 'hunt';
        ai.chase = !b.hasBomb && !this.leading(b) && Math.random() < (side === 'atk' ? 0.55 : 0.3);
        ai.path = null;
      }
      ai.lookAt = new THREE.Vector3(ai.lastSeen.x, ai.lastSeen.y + 1.4, ai.lastSeen.z);
      if (b.inv.he > 0 && ai.nadeCD <= 0) {
        const d = Math.hypot(ai.lastSeen.x - b.pos.x, ai.lastSeen.z - b.pos.z);
        if (d > 7 && d < 26 && Math.random() < D.nades && botThrow(b, 'he', ai.lastSeen)) { ai.nadeCD = 8; return; }
        ai.nadeCD = 2.5;
      }
      if (ai.chase) this.goTo(b, ai.lastSeen.x, ai.lastSeen.z, 'chase');
      return;
    }
    if (ai.target) { ai.target = null; ai.mode = 'idle'; ai.lookAt = null; }
    const s = b.inv[b.slot];
    if (s && s.id && WEAPONS[s.id].mag && s.mag < WEAPONS[s.id].mag * 0.4 && s.reserve > 0) startReload(b);
    if ((b.slot === 'knife' || (b.slot === 'secondary' && b.inv.primary)) && b.reloadT <= 0) switchSlot(b, bestSlot(b));
    if (b.slot === 'grenade') switchSlot(b, bestSlot(b));
    if (b.scope) b.scope = 0;
    if (G.time - ai.heardT < 2) {
      ai.lookAt = new THREE.Vector3(ai.heard.x, ai.heard.y + 1.4, ai.heard.z);
      ai.lookUntil = G.time + 1.5;
    } else if (G.time > ai.lookUntil && ai.mode !== 'hold') ai.lookAt = null;
    if (this.obeyOrders(b)) return;
    if (!b.inv.primary && !b.inv.shield && this.fetchWeapon(b)) return;
    if (G.mode === 'hostage') { if (side === 'atk') this.rescue(b); else this.guardHostages(b); }
    else if (side === 'atk') this.attack(b); else this.defend(b);
  },

  // radio orders from the human player: follow, hold position, fall back
  obeyOrders(b) {
    const ai = b.ai, p = G.player;
    if (!p || b.team !== p.team || this.leading(b)) return false;
    if (ai.followUntil > G.time && p.alive) {
      const d = Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
      ai.mode = 'move'; ai.walk = p.walking;
      if (d > 3.5) {
        const back = 2.2 + (b.id % 3) * 0.8, side = ((b.id % 2) ? 1 : -1) * 1.2;
        const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = -fz, rz = fx;
        this.goTo(b, p.pos.x - fx * back + rx * side, p.pos.z - fz * back + rz * side, 'follow');
        if (G.time - ai.pathT > 1.2) ai.pathT = -99;
      } else { ai.path = null; ai.mode = 'hold'; ai.lookAt = new THREE.Vector3(p.pos.x - Math.sin(p.yaw) * 10, 1.5, p.pos.z - Math.cos(p.yaw) * 10); }
      return true;
    }
    if (ai.holdUntil > G.time) {
      ai.path = null; ai.mode = 'hold';
      if (G.time > ai.lookUntil) { ai.lookAt = new THREE.Vector3(b.pos.x + rand(-10, 10), 1.5, b.pos.z + rand(-10, 10)); ai.lookUntil = G.time + rand(2, 4); }
      return true;
    }
    if (ai.fallbackUntil > G.time) {
      const c = SPAWNS[sideOf(b.team)][b.id % SPAWNS.atk.length];
      const w = cellToWorld(c);
      this.goTo(b, w.x, w.z, 'fallback');
      ai.mode = 'move';
      return true;
    }
    return false;
  },

  fetchWeapon(b) {
    let best = null, bd = 14;
    for (const it of G.items) {
      if (WEAPONS[it.id].slot !== 'primary') continue;
      const d = Math.hypot(it.pos.x - b.pos.x, it.pos.z - b.pos.z);
      if (d < bd) { bd = d; best = it; }
    }
    if (!best) return false;
    this.goTo(b, best.pos.x, best.pos.z, 'gun' + best.uid);
    b.ai.mode = 'move'; b.ai.walk = false;
    return true;
  },

  nearestTo(pos, team) {
    let best = null, bd = Infinity;
    for (const a of G.agents) {
      if (!a.alive || a.team !== team || !a.ai || (a === G.player && !a.autopilot)) continue;
      const d = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  },

  // ---------------------------------------------------------------- bomb mode
  attack(b) {
    const ai = b.ai, bomb = G.bomb;
    if (bomb.state === 'planted') {
      if (!ai.guard) {
        const st = SITES[bomb.site];
        ai.guard = World.randomPointIn(st.x0 - 1, st.z0 - 1, st.x1 + 1, st.z1 + 1);
        ai.guardDone = false;
      }
      if (!ai.guardDone && Math.hypot(ai.guard.x - b.pos.x, ai.guard.z - b.pos.z) > 0.8) {
        this.goTo(b, ai.guard.x, ai.guard.z, 'guard');
        ai.mode = 'move';
        if (ai.arrived) ai.guardDone = true;
        return;
      }
      ai.guardDone = true; ai.path = null; ai.mode = 'hold';
      if (G.time > ai.lookUntil) { ai.lookAt = cellV3(pick(SITE_THREATS[bomb.site]), 1.5); ai.lookUntil = G.time + rand(2.5, 5); }
      return;
    }
    if (bomb.state === 'dropped' && this.nearestTo(bomb.pos, b.team) === b) {
      this.goTo(b, bomb.pos.x, bomb.pos.z, 'fetchbomb');
      ai.mode = 'move';
      return;
    }
    const siteKey = G.atkPlan.site, site = SITES[siteKey];
    if (ai.routeSite !== siteKey) {
      ai.route = ATK_ROUTES[siteKey][b.id % 2]; ai.routeSite = siteKey;
      ai.stage = Math.min(ai.stage, 2); ai.arrivedSite = false;
    }
    if (b.hasBomb && (ai.stage >= 2 || G.time > G.execAt + 4)) {
      if (!ai.plantSpot) { const c = pick(site.plants); ai.plantSpot = cellToWorld(c); }
      const d = Math.hypot(ai.plantSpot.x - b.pos.x, ai.plantSpot.z - b.pos.z);
      const zone = inSiteZone(b.pos.x, b.pos.z);
      if (zone === siteKey && (d < 1.2 || (ai.arrived && ai.goalKey === 'plant'))) {
        if (b.onGround) { if (b.slot !== 'bomb') switchSlot(b, 'bomb'); startAction(b, 'plant'); }
        return;
      }
      this.goTo(b, ai.plantSpot.x, ai.plantSpot.z, 'plant');
      ai.mode = 'move'; ai.lookAt = null;
      return;
    }
    this.followRoute(b, siteKey);
  },

  followRoute(b, siteKey) {
    const ai = b.ai, r = ai.route;
    if (!r || G.time < G.liveStart + ai.startDelay) { ai.mode = 'idle'; return; }
    if (ai.stage === 0) {
      const p = cellToWorld(r.stage);
      if (Math.hypot(p.x - b.pos.x, p.z - b.pos.z) < 2.4 || (ai.arrived && ai.goalKey === 'stage')) { ai.stage = 1; ai.path = null; }
      else { this.goTo(b, p.x, p.z, 'stage'); ai.mode = 'move'; ai.lookAt = null; return; }
    }
    if (ai.stage === 1) {
      ai.mode = 'hold'; ai.path = null;
      ai.lookAt = cellV3(r.entry, 1.6);
      if (G.time >= G.execAt) { ai.stage = 2; this.execNades(b, siteKey); }
      return;
    }
    if (ai.stage === 2) {
      const p = cellToWorld(r.entry);
      if (Math.hypot(p.x - b.pos.x, p.z - b.pos.z) < 2.4 || (ai.arrived && ai.goalKey === 'entry')) {
        ai.stage = 3;
        const s = SITES[siteKey];
        ai.sitePos = World.randomPointIn(s.x0, s.z0, s.x1, s.z1);
        ai.arrivedSite = false;
      } else { this.goTo(b, p.x, p.z, 'entry'); ai.mode = 'move'; ai.lookAt = null; return; }
    }
    if (!ai.arrivedSite && Math.hypot(ai.sitePos.x - b.pos.x, ai.sitePos.z - b.pos.z) > 1.0) {
      this.goTo(b, ai.sitePos.x, ai.sitePos.z, 'site');
      ai.mode = 'move';
      if (ai.arrived) ai.arrivedSite = true;
      return;
    }
    ai.arrivedSite = true; ai.mode = 'hold'; ai.path = null;
    if (G.time > ai.lookUntil) { ai.lookAt = cellV3(pick(SITE_THREATS[siteKey]), 1.5); ai.lookUntil = G.time + rand(2, 4); }
  },

  execNades(b, siteKey) {
    const n = EXEC_NADES[siteKey];
    if (Math.random() > b.ai.D.nades) return;
    if (b.inv.smoke > 0 && !G.execNades.smoke) {
      if (botThrow(b, 'smoke', cellV3(n.smoke, 0))) { G.execNades.smoke = true; return; }
    }
    if (b.inv.flash > 0 && (G.execNades.flash || 0) < 2) {
      if (botThrow(b, 'flash', cellV3(n.flash, 1.5))) G.execNades.flash = (G.execNades.flash || 0) + 1;
    }
  },

  defend(b) {
    const ai = b.ai, bomb = G.bomb;
    if (bomb.state === 'planted') {
      const d = Math.hypot(bomb.pos.x - b.pos.x, bomb.pos.z - b.pos.z);
      if (d < 1.2 && Math.abs(bomb.pos.y - b.pos.y) < 1.2) {
        if (!bomb.defuser) { startAction(b, 'defuse'); return; }
        ai.mode = 'hold'; ai.path = null;
        if (G.time > ai.lookUntil) { ai.lookAt = cellV3(pick(SITE_THREATS[bomb.site]), 1.5); ai.lookUntil = G.time + 3; }
        return;
      }
      this.goTo(b, bomb.pos.x, bomb.pos.z, 'bomb');
      ai.mode = 'move'; ai.lookAt = null; ai.walk = false;
      return;
    }
    this.holdPositions(b);
  },

  holdPositions(b) {
    const ai = b.ai;
    const intel = G.intel[b.team];
    if (intel.site && intel.site !== 'M' && intel.site !== ai.holdSite && G.time - intel.time < 5 && !ai.rotated && Math.random() < 0.12) {
      ai.rotated = true; ai.holdSite = intel.site;
      ai.hold = pick(DEF_HOLDS[intel.site]); ai.holdArrived = false;
    }
    if (!ai.hold) return;
    const p = cellToWorld(ai.hold.at);
    if (!ai.holdArrived && Math.hypot(p.x - b.pos.x, p.z - b.pos.z) > 0.7) {
      this.goTo(b, p.x, p.z, 'hold');
      ai.mode = 'move';
      if (ai.arrived) ai.holdArrived = true;
      return;
    }
    ai.holdArrived = true; ai.mode = 'hold'; ai.path = null;
    if (G.time > ai.lookUntil || !ai.lookAt) { ai.lookAt = cellV3(ai.hold.look, 1.5); ai.lookUntil = G.time + 3; }
  },

  // ---------------------------------------------------------------- hostage mode
  leading(b) { return G.mode === 'hostage' && G.hostages.some((h) => h.alive && !h.rescued && h.leader === b); },

  // police: reach a hostage pair, pick them up, walk them back south while waiting for stragglers
  rescue(b) {
    const ai = b.ai;
    const mine = G.hostages.filter((h) => h.alive && !h.rescued && h.leader === b);
    if (mine.length) {
      const lag = Math.max(...mine.map((h) => Math.hypot(h.pos.x - b.pos.x, h.pos.z - b.pos.z)));
      const spare = G.hostages.find((h) => h.alive && !h.rescued && !h.leader && Math.hypot(h.pos.x - b.pos.x, h.pos.z - b.pos.z) < 6);
      if (spare) { this.grab(b, spare); return; }
      if (lag > 6) { ai.path = null; ai.mode = 'hold'; ai.lookAt = new THREE.Vector3(mine[0].pos.x, 1.4, mine[0].pos.z); return; }
      let best = null, bd = Infinity;
      for (const c of RESCUE_POINTS) { const w = cellToWorld(c); const d = Math.hypot(w.x - b.pos.x, w.z - b.pos.z); if (d < bd) { bd = d; best = w; } }
      this.goTo(b, best.x, best.z, 'rescue');
      ai.mode = 'move'; ai.walk = false; ai.lookAt = null;
      return;
    }
    const near = G.hostages.filter((h) => h.alive && !h.rescued && !h.leader)
      .map((h) => ({ h, d: Math.hypot(h.pos.x - b.pos.x, h.pos.z - b.pos.z) }))
      .sort((x, y) => x.d - y.d)[0];
    if (near && (near.d < 16 || ai.stage >= 3)) { this.grab(b, near.h); return; }
    if (!G.hostages.some((h) => h.alive && !h.rescued && !h.leader)) {
      // everybody is already being escorted: cover the nearest escort
      const esc = G.hostages.find((h) => h.alive && !h.rescued && h.leader && h.leader !== b);
      if (esc) { this.goTo(b, esc.leader.pos.x, esc.leader.pos.z, 'escort'); ai.mode = 'move'; return; }
    }
    this.followRoute(b, ai.routeSite || 'A');
  },
  grab(b, h) {
    const ai = b.ai;
    const d = Math.hypot(h.pos.x - b.pos.x, h.pos.z - b.pos.z);
    if (d < 1.5 && Math.abs(h.pos.y - b.pos.y) < 1.6) { useHostage(b, h); ai.path = null; return; }
    this.goTo(b, h.pos.x, h.pos.z, 'hostage' + h.id);
    ai.mode = 'move'; ai.walk = false; ai.lookAt = null;
  },
  // militants: guard the hostage pairs; if one is being led away, go after the escort
  guardHostages(b) {
    const ai = b.ai;
    const taken = G.hostages.filter((h) => h.alive && !h.rescued && h.leader)
      .map((h) => ({ h, d: Math.hypot(h.pos.x - b.pos.x, h.pos.z - b.pos.z) }))
      .sort((x, y) => x.d - y.d)[0];
    if (taken && (taken.d < 45 || Math.random() < 0.02)) {
      this.goTo(b, taken.h.pos.x, taken.h.pos.z, 'retake' + taken.h.id);
      if (G.time - ai.pathT > 2) ai.pathT = -99;
      ai.mode = 'move'; ai.walk = false; ai.lookAt = null;
      if (G.time - ai.spotCall > 12) { ai.spotCall = G.time; Radio.say(b, '人质被带走了，追！', true); }
      return;
    }
    this.holdPositions(b);
  },

  onDamaged(b, att) {
    const ai = b.ai;
    if (ai.target && ai.targetVis) return;
    ai.heard.copy(att.pos); ai.heardT = G.time;
    ai.lookAt = new THREE.Vector3(att.pos.x, att.pos.y + 1.4, att.pos.z);
    ai.lookUntil = G.time + 2;
    if (ai.target !== att) { ai.target = att; ai.lastSeen.copy(att.pos); ai.lastSeenT = G.time - 0.5; }
  },
  onNoise(b, src) {
    const ai = b.ai;
    if (ai.target && ai.targetVis) return;
    ai.heard.copy(src.pos); ai.heardT = G.time;
  },
};

// can an eye position see any part of agent e?
function canSeeAgent(eye, e) {
  const pts = [headY(e), chestY(e), 0.45];
  for (const h of pts) {
    _ah.set(e.pos.x, e.pos.y + h, e.pos.z);
    if (World.losClear(eye.x, eye.y, eye.z, _ah.x, _ah.y, _ah.z) && !smokeBlocks(eye, _ah)) return true;
  }
  return false;
}

// solve a grenade lineup by simulating candidate throws with the real grenade physics
function solveThrow(origin, target) {
  const yaw = yawTo(target.x - origin.x, target.z - origin.z);
  const dir = new THREE.Vector3();
  let best = null, bestErr = Infinity;
  for (let pitch = -0.15; pitch <= 1.1; pitch += 0.05) {
    dirFromAngles(yaw, pitch, dir);
    const land = simulateThrow(origin, dir, NADE_SPEED);
    const err = Math.hypot(land.x - target.x, land.z - target.z);
    if (err < bestErr) { bestErr = err; best = { yaw, pitch, dir: dir.clone() }; }
  }
  return bestErr < 3.5 ? best : null;
}
function botThrow(b, type, target) {
  if (b.inv[type] <= 0 || b.throwCD > 0) return false;
  agentEye(b, _ae);
  const sol = solveThrow(_ae, target);
  if (!sol) return false;
  b.yaw = sol.yaw; b.pitch = sol.pitch;
  return throwGrenade(b, type, true, sol.dir);
}
