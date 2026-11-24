'use strict';
/* =========================================================
   game.js — classic rules: police vs militants with fixed
   sides, endless or first-to-N rounds, bomb defusal and
   hostage rescue, old-school economy, grenades, dropped
   weapons, buying (weapons, ammo, gear), radio and spotting.
   ========================================================= */
const FREEZE_TIME = 5, POST_TIME = 5, BUY_WINDOW = 90;
const ROUND_TIME = { bomb: 150, hostage: 180 };
const BOMB_TIME = 35, PLANT_TIME = 3.0, DEFUSE_TIME = 10, DEFUSE_KIT_TIME = 5;
const NADE_SPEED = 19, NADE_GRAV = 13;
const TEAM_NAMES = ['红隼特勤队', '毒蝰武装'];
const SIDE_LABEL = ['警方', '匪方'];
const BOT_NAMES = [['猎隼', '鱼鹰', '灰背隼', '白头鹞', '游隼', '雀鹰', '金雕', '苍鹰', '黑鸢'], ['眼镜蛇', '曼巴', '金环', '太攀', '蝮蛇', '响尾', '竹叶青', '烙铁头', '五步蛇']];
const MODE_NAME = { bomb: '爆破模式', hostage: '人质营救' };

const G = {
  state: 'menu', paused: false, time: 0, round: 0, phase: 'none', phaseT: 0, liveStart: Infinity, mode: 'bomb',
  teams: [], agents: [], player: null, viewAgent: null, specTarget: null, deathCamT: 0,
  bomb: { state: 'none', pos: new THREE.Vector3(), carrier: null, defuser: null, timer: 0 },
  grenades: [], smokes: [], items: [], itemUid: 0, hostages: [],
  intel: [{ site: null, time: -99 }, { site: null, time: -99 }], spotted: [new Map(), new Map()],
  atkPlan: { site: 'A' }, execAt: Infinity, execNades: {},
  winLimit: 0, history: [], matchOver: false, pendingTeam: null,
  timeScale: 1, shake: 0, autopilot: false, killer: null,

  checkRoundEnd() { checkRoundEnd(); },
  spot(team, e) {
    G.spotted[team].set(e.id, { t: G.time, x: e.pos.x, z: e.pos.z });
    const reg = regionOf(e.pos.x, e.pos.z);
    if (reg) { G.intel[team].site = reg; G.intel[team].time = G.time; }
  },
  noise(src, radius, kind) {
    for (const b of G.agents) {
      if (!b.ai || !b.alive || b.team === src.team || (b === G.player && !b.autopilot)) continue;
      if (Math.hypot(b.pos.x - src.pos.x, b.pos.z - src.pos.z) < radius) AI.onNoise(b, src, kind);
    }
  },
  canHear(a) {
    const c = R.camera.position;
    return World.losClear(c.x, c.y, c.z, a.pos.x, a.pos.y + 1.5, a.pos.z);
  },
};

// sides are fixed per team: militants attack in bomb mode, police attack (rescue) in hostage mode
const sideOf = (team) => (G.mode === 'hostage' ? (team === CT ? 'atk' : 'def') : (team === T ? 'atk' : 'def'));
const teamOfSide = (side) => (sideOf(CT) === side ? CT : T);

function regionOf(x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  if ((cx <= 12 && cz <= 27) || (cx <= 17 && cz >= 11 && cz <= 15)) return 'A';
  if ((cx >= 28 && cz <= 27) || (cx >= 22 && cz >= 16 && cz <= 19)) return 'B';
  if (cx >= 18 && cx <= 21 && cz <= 24) return 'M';
  return null;
}

// ------------------------------------------------------------------ radio and chatter
const RADIO = {
  Z: { title: '无线电 · 指令', items: [['跟我来', 'follow'], ['掩护我', 'cover'], ['守住这里', 'hold'], ['分头行动', 'split'], ['一起推进', 'go']] },
  X: { title: '无线电 · 战术', items: [['冲上去！', 'go'], ['撤退！', 'fallback'], ['等我信号', 'wait'], ['小心侧翼', null], ['先扔道具', null]] },
  C: { title: '无线电 · 回应', items: [['收到', null], ['不行', null], ['发现敌人', null], ['需要支援', 'cover'], ['这边安全', null], ['敌人已倒下', null], ['炸弹在这边', null]] },
};
const Radio = {
  lastAuto: -99,
  say(a, text, auto) {
    if (!G.player || a.team !== G.player.team) return;
    if (auto) {
      if (G.time - Radio.lastAuto < 2.6 || G.time - (a.lastRadio || -99) < 8) return;
      Radio.lastAuto = G.time;
    }
    a.lastRadio = G.time;
    HUD.chat(a, text);
    SFX.radio();
  },
  // the player gives an order; nearby team bots react and some answer
  command(text, cmd) {
    const p = G.player;
    if (!p) return;
    Radio.say(p, text);
    if (!cmd || !p.alive) return;
    const mates = G.agents.filter((a) => a.alive && a.ai && a !== p && a.team === p.team);
    let replies = 0;
    for (const b of mates) {
      const d = b.pos.distanceTo(p.pos);
      const ai = b.ai;
      if (cmd === 'follow' || cmd === 'cover') { if (d < 40) { ai.followUntil = G.time + (cmd === 'follow' ? 30 : 12); ai.holdUntil = 0; } else continue; }
      else if (cmd === 'hold') { if (d < 30) { ai.holdUntil = G.time + 30; ai.followUntil = 0; ai.path = null; } else continue; }
      else if (cmd === 'go') { ai.followUntil = 0; ai.holdUntil = 0; G.execAt = Math.min(G.execAt, G.time); }
      else if (cmd === 'fallback') { ai.followUntil = 0; ai.holdUntil = 0; ai.fallbackUntil = G.time + 12; }
      else if (cmd === 'wait') { G.execAt = Math.max(G.execAt, G.time + 15); }
      else if (cmd === 'split') { ai.followUntil = 0; ai.holdUntil = 0; }
      if (replies < 2 && Math.random() < 0.7) {
        replies++;
        setTimeout(() => { if (b.alive && G.state === 'playing') Radio.say(b, pick(['收到', '明白', '收到，正在过去'])); }, 500 + replies * 650);
      }
    }
  },
};

// ------------------------------------------------------------------ match
function newMatch(playerTeam, playerSkin) {
  for (const a of G.agents) if (a.model) R.scene.remove(a.model.root);
  clearRoundObjects();
  G.mode = Settings.mode === 'hostage' ? 'hostage' : 'bomb';
  const n = Number(Settings.teamSize) || 5;
  G.winLimit = Number(Settings.rounds) || 0;
  G.teams = [
    { id: CT, name: TEAM_NAMES[CT], score: 0, lossStreak: 0 },
    { id: T, name: TEAM_NAMES[T], score: 0, lossStreak: 0 },
  ];
  G.agents = [];
  let id = 0;
  const player = createAgent(id++, '你', playerTeam, true);
  player.skin = playerSkin;
  G.agents.push(player);
  G.player = player;
  if (G.autopilot) { player.ai = AI.makeState(); player.autopilot = true; }
  for (const team of [CT, T]) {
    const count = team === playerTeam ? n - 1 : n;
    for (let i = 0; i < count; i++) {
      const b = createAgent(id++, BOT_NAMES[team][i % BOT_NAMES[team].length], team, false);
      b.ai = AI.makeState();
      b.skin = Math.floor(Math.random() * 4);
      G.agents.push(b);
    }
  }
  for (const a of G.agents) { a.money = 800; buildAgentModel(a); }
  VM.setSkin(SKINS[player.team][player.skin]);
  G.round = 0; G.history = []; G.time = 0; G.matchOver = false; G.pendingTeam = null;
  G.intel = [{ site: null, time: -99 }, { site: null, time: -99 }];
  G.spotted = [new Map(), new Map()];
}
function buildAgentModel(a) {
  if (a.model) R.scene.remove(a.model.root);
  a.model = null;
  if (a === G.player) return;
  a.model = Models.character(a.team, a.id, a.skin);
  if (G.player && a.team === G.player.team) { a.model.tag = nameTag(a.name, '#5ec4ff'); a.model.root.add(a.model.tag); }
  R.scene.add(a.model.root);
}
// join the other side at the next round: one bot swaps over to keep the teams even
function applyTeamSwitch() {
  const p = G.player, to = G.pendingTeam, skin = G.pendingSkin;
  G.pendingTeam = null; G.pendingSkin = null;
  if (to == null) return;
  if (to === p.team) {
    // same side: just a change of outfit
    if (skin != null && skin !== p.skin) { p.skin = skin; VM.setSkin(SKINS[p.team][p.skin]); HUD.notice(`你换上了「${SKINS[p.team][p.skin].name}」`); }
    return;
  }
  const from = p.team;
  const mover = G.agents.find((a) => a !== p && a.team === to);
  p.team = to; p.skin = skin == null ? 0 : skin;
  resetLoadout(p); p.money = Math.max(p.money, 800);
  if (mover) { mover.team = from; resetLoadout(mover); }
  for (const a of G.agents) buildAgentModel(a);
  VM.setSkin(SKINS[p.team][p.skin]);
  HUD.notice(`你已加入${SIDE_LABEL[to]}（${TEAM_NAMES[to]}）`);
}

function clearRoundObjects() {
  for (const g of G.grenades) R.scene.remove(g.mesh);
  G.grenades.length = 0;
  G.smokes.length = 0;
  for (const it of G.items) R.scene.remove(it.mesh);
  G.items.length = 0;
  for (const h of G.hostages) R.scene.remove(h.model.root);
  G.hostages = [];
  if (G.bombMesh) G.bombMesh.visible = false;
  FX.clearRound();
}

function startRound() {
  G.round++;
  G.phase = 'freeze'; G.phaseT = FREEZE_TIME; G.liveStart = Infinity; G.execAt = Infinity; G.execNades = {};
  clearRoundObjects();
  if (G.pendingTeam != null) applyTeamSwitch();
  G.bomb = { state: 'none', pos: new THREE.Vector3(), carrier: null, defuser: null, timer: 0, beepT: 0, site: null, wasPlanted: false };
  const spots = { atk: shuffle(SPAWNS.atk.concat(EXTRA_SPAWNS.atk)), def: shuffle(SPAWNS.def.concat(EXTRA_SPAWNS.def)) };
  for (const a of G.agents) {
    const side = sideOf(a.team);
    if (!a.alive) resetLoadout(a);
    a.alive = true; a.hp = 100; a.action = null; a.blind = 0; a.scope = 0; a.rescopeT = 0; a.burstQ = 0; a.silT = 0; a.shieldOpen = true;
    a.vel.set(0, 0, 0); a.vy = 0; a.onGround = true; a.crouch = 0; a.crouching = false; a.walking = false;
    a.recoil.p = 0; a.recoil.y = 0; a.shotIdx = 0; a.spreadAcc = 0; a.deadT = 0; a.tagT = 0; a.punch = 0;
    a.dmgFrom.clear(); a.roundKills = 0; a.hasBomb = false; a.fireCD = 0; a.reloadT = 0; a.switchT = 0;
    const c = spots[side].pop() || SPAWNS[side][0];
    a.pos.set(c[0] * CELL + CELL / 2 + rand(-0.3, 0.3), 0, c[1] * CELL + CELL / 2 + rand(-0.3, 0.3));
    a.pos.y = World.floorAt(a.pos.x, a.pos.z);
    a.yaw = side === 'atk' ? rand(-0.15, 0.15) : Math.PI + rand(-0.15, 0.15);
    a.pitch = 0;
    a.viewY = a.pos.y + EYE_STAND;
    a.slot = bestSlot(a); a.prevSlot = a.slot === 'knife' ? 'secondary' : 'knife';
    if (a.model) { a.model.root.visible = true; a.model.body.rotation.set(0, 0, 0); a.model.body.position.y = 0; }
  }
  if (G.mode === 'bomb') {
    const atk = teamOfSide('atk');
    giveBomb(pick(G.agents.filter((a) => a.team === atk)));
  } else spawnHostages();
  G.atkPlan = { site: Math.random() < 0.5 ? 'A' : 'B', checkT: 0 };
  AI.roundStart();
  G.viewAgent = G.player; G.specTarget = null; G.deathCamT = 0; G.killer = null;
  const p = G.player;
  if (p) { const id = curWeaponId(p); if (id) VM.set(id, shieldActive(p)); }
  HUD.roundStart();
}

function startAction(a, type) {
  if (a.action || !a.alive) return false;
  if (type === 'plant') {
    if (!a.hasBomb || G.phase !== 'live' || !inSiteZone(a.pos.x, a.pos.z) || !a.onGround || !plantableAt(a)) return false;
  } else {
    const b = G.bomb;
    if (b.state !== 'planted' || b.defuser) return false;
    if (Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) > 1.8) return false;
    b.defuser = a;
  }
  a.action = { type, t: 0, total: type === 'plant' ? PLANT_TIME : (a.kit ? DEFUSE_KIT_TIME : DEFUSE_TIME), tick: 0 };
  a.vel.set(0, 0, 0);
  if (type === 'plant') G.noise(a, 14, 'plant');
  return true;
}
function plantableAt(a) {
  const cx = World.toCell(a.pos.x), cz = World.toCell(a.pos.z);
  return World.walkable(cx, cz) && Math.abs(a.pos.y - World.cellH(cx, cz)) < 0.1;
}
function cancelAction(a) {
  if (a.action && a.action.type === 'defuse' && G.bomb.defuser === a) G.bomb.defuser = null;
  a.action = null;
}
function updateAction(a, dt) {
  const act = a.action;
  if (!act) return;
  if (!a.alive || G.phase === 'post') { cancelAction(a); return; }
  act.t += dt; act.tick -= dt;
  if (act.type === 'plant') {
    if (!a.hasBomb || !inSiteZone(a.pos.x, a.pos.z)) { cancelAction(a); return; }
    if (act.tick <= 0) { act.tick = 0.42; SFX.keypad(a === G.viewAgent ? null : a.pos); }
    if (act.t >= act.total) { a.action = null; plantBomb(a); }
  } else {
    const b = G.bomb;
    if (b.state !== 'planted' || Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) > 1.9) { cancelAction(a); return; }
    if (act.tick <= 0) { act.tick = 0.5; SFX.defuseTick(a === G.viewAgent ? null : a.pos); }
    if (act.t >= act.total) { a.action = null; defuseBomb(a); }
  }
}

// ------------------------------------------------------------------ bomb
function ensureBombMesh() {
  if (!G.bombMesh) {
    G.bombMesh = Models.bomb();
    const led = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.soft, color: 0xff2a1a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    led.scale.setScalar(0.25); led.position.set(0.05, 0.08, -0.12);
    G.bombMesh.add(led); G.bombLed = led;
    R.scene.add(G.bombMesh);
  }
  return G.bombMesh;
}
function giveBomb(a) {
  const b = G.bomb;
  b.state = 'carried'; b.carrier = a; a.hasBomb = true;
  if (G.bombMesh) G.bombMesh.visible = false;
  if (a === G.player && G.phase !== 'freeze') HUD.banner('你捡起了炸弹', '前往 A 或 B 包点，按住 E 安放', 2.2, 'alert');
}
function dropBomb(a, thrown) {
  const b = G.bomb;
  a.hasBomb = false;
  if (a.slot === 'bomb') switchSlot(a, bestSlot(a));
  b.state = 'dropped'; b.carrier = null;
  let x = a.pos.x, z = a.pos.z;
  if (thrown) {
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    for (let d = 1.6; d > 0; d -= 0.4) { if (World.walkable(World.toCell(a.pos.x + fx * d), World.toCell(a.pos.z + fz * d))) { x = a.pos.x + fx * d; z = a.pos.z + fz * d; break; } }
  }
  const s = World.snapToWalkable(x, z);
  b.pos.set(s.x, s.y + 0.06, s.z);
  b.dropT = G.time;
  const m = ensureBombMesh();
  m.visible = true; m.position.copy(b.pos); m.rotation.set(0, rand(0, TAU), 0);
}
function plantBomb(a) {
  const b = G.bomb;
  a.hasBomb = false;
  if (a.slot === 'bomb') switchSlot(a, bestSlot(a));
  b.state = 'planted'; b.wasPlanted = true; b.carrier = null; b.planter = a;
  b.pos.set(a.pos.x, a.pos.y + 0.06, a.pos.z);
  b.site = inSiteZone(a.pos.x, a.pos.z) || 'A';
  b.timer = BOMB_TIME; b.beepT = 0;
  if (G.phase === 'live') G.phase = 'planted';
  addMoney(a, 300, true);
  const m = ensureBombMesh();
  m.visible = true; m.position.copy(b.pos); m.rotation.set(0, a.yaw, 0);
  HUD.banner('炸弹已安放', `${b.site} 包点`, 2.6, 'alert');
  SFX.planted();
  if (a.team === G.player.team && a !== G.player) Radio.say(a, '炸弹已安放，守住它！');
  for (const o of G.agents) if (o.ai && o.alive) { o.ai.goalKey = ''; o.ai.guard = null; }
}
function defuseBomb(a) {
  const b = G.bomb;
  b.state = 'defused'; b.defuser = null;
  if (G.bombLed) G.bombLed.visible = false;
  addMoney(a, 300, true);
  endRound(a.team, 'defuse');
}
function explodeBomb() {
  const b = G.bomb;
  b.state = 'exploded';
  if (G.bombMesh) G.bombMesh.visible = false;
  const p = b.pos.clone(); p.y += 0.6;
  FX.explosion(p, true);
  SFX.explosion(p, true);
  const cd = R.camera.position.distanceTo(p);
  G.shake = Math.max(G.shake, clamp(1.6 - cd / 40, 0.2, 1.5));
  for (const a of G.agents) {
    if (!a.alive) continue;
    const d = a.pos.distanceTo(b.pos);
    const dmg = 520 * Math.pow(Math.max(0, 1 - d / 24), 2);
    if (dmg > 1) applyDamage(a, null, dmg, 'chest', 'bombx', b.pos);
  }
  if (G.phase !== 'post') endRound(teamOfSide('atk'), 'bomb');
}
function updateBomb(dt) {
  const b = G.bomb;
  if (b.state === 'dropped' && G.phase !== 'post') {
    for (const a of G.agents) {
      if (!a.alive || sideOf(a.team) !== 'atk' || (a === G.player && G.time - (b.dropT || 0) < 1)) continue;
      if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < 1.0 && Math.abs(a.pos.y - b.pos.y) < 1.2) { giveBomb(a); break; }
    }
  }
  if (b.state !== 'planted') return;
  b.timer -= dt; b.beepT -= dt;
  if (b.beepT <= 0) {
    const f = b.timer / BOMB_TIME;
    b.beepT = clamp(f * 1.3, 0.11, 1.3);
    SFX.beep(b.pos, f < 0.25);
    if (G.bombLed) { G.bombLed.visible = true; G.bombLedT = 0.08; }
  }
  if (G.bombLed && G.bombLedT > 0) { G.bombLedT -= dt; if (G.bombLedT <= 0) G.bombLed.visible = false; }
  if (b.timer <= 0) explodeBomb();
}

// ------------------------------------------------------------------ hostages
function spawnHostages() {
  G.hostages = HOSTAGE_SPOTS.map((c, i) => {
    const p = cellToWorld(c);
    const h = {
      id: 100 + i, isHostage: true, name: '人质', pos: new THREE.Vector3(p.x + rand(-0.3, 0.3), 0, p.z + rand(-0.3, 0.3)), vel: new THREE.Vector3(), vy: 0, onGround: true, r: 0.35, airStep: 0.05,
      yaw: rand(-Math.PI, Math.PI), pitch: 0, crouch: 0, hp: 100, alive: true, rescued: false, leader: null, touched: false,
      path: null, pathI: 0, repathT: 0, animPhase: 0, deadT: 0, deathDir: { x: 1, z: 0 }, site: c[0] < 20 ? 'A' : 'B',
      model: Models.hostage(i + G.round * 5),
    };
    h.pos.y = World.floorAt(h.pos.x, h.pos.z);
    R.scene.add(h.model.root);
    updateHostageModel(h, 0);
    return h;
  });
}
function nearestHostage(a, maxD, free) {
  let best = null, bd = maxD;
  for (const h of G.hostages) {
    if (!h.alive || h.rescued || (free && h.leader)) continue;
    const d = Math.hypot(h.pos.x - a.pos.x, h.pos.z - a.pos.z);
    if (d < bd && Math.abs(h.pos.y - a.pos.y) < 1.6) { bd = d; best = h; }
  }
  return best;
}
// only the police can lead hostages out; using a hostage you already lead tells it to wait
function useHostage(a, h) {
  if (G.mode !== 'hostage' || a.team !== CT || !h || !h.alive || h.rescued) return false;
  if (h.leader === a) { h.leader = null; if (a === G.player) HUD.notice('人质停在原地等待'); return true; }
  h.leader = a; h.path = null;
  if (!h.touched) { h.touched = true; addMoney(a, 150, true); }
  if (a === G.player) { HUD.notice('人质跟上了你，带他回到南边的营救区'); SFX.ui('buy'); }
  else if (a.team === G.player.team) Radio.say(a, '人质在我这，掩护我撤离！', true);
  return true;
}
function damageHostage(h, att, dmg) {
  if (!h.alive || h.rescued) return;
  h.hp -= Math.round(dmg);
  if (h.hp > 0) return;
  h.alive = false; h.leader = null; h.deadT = 0;
  h.deathDir = { x: Math.random() < 0.5 ? 1 : -1, z: 0 };
  if (att) {
    addMoney(att, -1500, true);
    if (att === G.player) HUD.notice('你误杀了人质，扣除 $1500');
  }
  HUD.killfeed(att, h, att ? curWeaponId(att) || 'knife' : 'bombx', false);
  checkRoundEnd();
}
function updateHostages(dt) {
  for (const h of G.hostages) {
    if (h.alive && !h.rescued) {
      const L = h.leader;
      if (L && (!L.alive || Math.hypot(L.pos.x - h.pos.x, L.pos.z - h.pos.z) > 32)) h.leader = null;
      let wx = 0, wz = 0;
      if (h.leader && G.phase !== 'post') {
        const d = Math.hypot(h.leader.pos.x - h.pos.x, h.leader.pos.z - h.pos.z);
        h.repathT -= dt;
        if (d > 2.2) {
          if (!h.path || h.repathT <= 0) { h.path = World.findPath(h.pos.x, h.pos.z, h.leader.pos.x, h.leader.pos.z); h.pathI = 0; h.repathT = 0.7; }
          if (h.path && h.path.length) {
            let wp = h.path[Math.min(h.pathI, h.path.length - 1)];
            let dx = wp.x - h.pos.x, dz = wp.z - h.pos.z, dd = Math.hypot(dx, dz);
            if (dd < 0.5 && h.pathI < h.path.length - 1) { h.pathI++; wp = h.path[h.pathI]; dx = wp.x - h.pos.x; dz = wp.z - h.pos.z; dd = Math.hypot(dx, dz); }
            if (dd > 1e-3) { wx = dx / dd; wz = dz / dd; }
          }
        }
        if (d > 0.5) h.yaw = wrapAngle(h.yaw + angleDiff(h.yaw, yawTo(h.leader.pos.x - h.pos.x, h.leader.pos.z - h.pos.z)) * Math.min(1, dt * 6));
      }
      for (const o of G.agents) {
        if (!o.alive) continue;
        const dx = h.pos.x - o.pos.x, dz = h.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
        if (d2 < 0.8 && d2 > 1e-4) { const d = Math.sqrt(d2); wx += dx / d * 0.8; wz += dz / d * 0.8; }
      }
      for (const o of G.hostages) {
        if (o === h || !o.alive || o.rescued) continue;
        const dx = h.pos.x - o.pos.x, dz = h.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
        if (d2 < 0.7 && d2 > 1e-4) { const d = Math.sqrt(d2); wx += dx / d; wz += dz / d; }
      }
      const len = Math.hypot(wx, wz), sp = len > 0.05 ? 4.5 : 0;
      h.vel.x = damp(h.vel.x, len ? wx / len * sp : 0, 8, dt);
      h.vel.z = damp(h.vel.z, len ? wz / len * sp : 0, 8, dt);
      const r = World.moveBody(h, h.vel.x * dt, h.vel.z * dt);
      if (r.hitX) h.vel.x = 0;
      if (r.hitZ) h.vel.z = 0;
      World.bodyVertical(h, dt);
      if (inRescueZone(h.pos.x, h.pos.z) && G.phase !== 'post') rescueHostage(h);
    }
  }
}
function rescueHostage(h) {
  h.rescued = true;
  const L = h.leader;
  h.leader = null;
  if (L) addMoney(L, 1000, true);
  HUD.notice(`人质已获救（${G.hostages.filter((x) => x.rescued).length} / ${G.hostages.length}）`);
  SFX.ui('buy');
  checkRoundEnd();
}

// ------------------------------------------------------------------ rounds
function checkRoundEnd() {
  if (G.phase !== 'live' && G.phase !== 'planted') return;
  const atk = teamOfSide('atk'), def = 1 - atk;
  const aliveA = G.agents.some((a) => a.alive && a.team === atk);
  const aliveD = G.agents.some((a) => a.alive && a.team === def);
  if (G.mode === 'hostage') {
    const left = G.hostages.filter((h) => h.alive && !h.rescued).length;
    const saved = G.hostages.filter((h) => h.rescued).length;
    if (saved > 0 && left === 0) { endRound(CT, 'rescue'); return; }
  }
  if (!aliveD) endRound(atk, 'elim');
  else if (!aliveA && G.bomb.state !== 'planted') endRound(def, 'elim');
}
function endRound(winTeam, reason) {
  if (G.phase === 'post' || G.phase === 'none') return;
  G.phase = 'post'; G.phaseT = POST_TIME;
  const W = G.teams[winTeam], L = G.teams[1 - winTeam];
  W.score++;
  const winBonus = (reason === 'bomb' || reason === 'defuse' || reason === 'rescue') ? 3500 : 3250;
  const lossBonus = 1400 + 500 * Math.min(L.lossStreak, 4);
  W.lossStreak = Math.max(0, W.lossStreak - 1);
  L.lossStreak++;
  for (const a of G.agents) {
    if (a.team === winTeam) addMoney(a, winBonus);
    else addMoney(a, lossBonus + (a.team === T && G.mode === 'bomb' && G.bomb.wasPlanted ? 800 : 0));
    if (a.action) cancelAction(a);
  }
  G.history.push({ winTeam, reason });
  if (G.winLimit > 0 && W.score >= G.winLimit) G.matchOver = true;
  HUD.roundEnd(winTeam, reason);
}
function nextRound() {
  if (G.matchOver) { showMatchOver(); return; }
  startRound();
}

function updateGame(dt) {
  G.time += dt;
  if (G.phase === 'freeze') {
    G.phaseT -= dt;
    if (G.phaseT <= 0) {
      G.phase = 'live'; G.phaseT = ROUND_TIME[G.mode]; G.liveStart = G.time; G.execAt = G.time + rand(12, 26);
      SFX.stinger('start');
      const p = G.player;
      if (p) {
        const atk = sideOf(p.team) === 'atk';
        const msg = G.mode === 'bomb' ? (atk ? '把炸弹送进 A 或 B 包点' : '守住 A、B 两个包点') : (atk ? '找到人质，带他们回到南边营救区' : '看住人质，别让警方救走');
        HUD.banner('行动开始', msg, 1.8, '');
      }
      for (const a of G.agents) if (a.ai && a.alive && sideOf(a.team) === 'atk' && Math.random() < 0.25) { Radio.say(a, pick(['冲上去！', '走走走！', '出发！']), true); break; }
    }
  } else if (G.phase === 'live') {
    G.phaseT -= dt;
    if (G.phaseT <= 0) endRound(G.mode === 'hostage' ? T : CT, 'time');
    // attacker bots follow a human bomb carrier to the site they head for
    const c = G.bomb.carrier;
    G.atkPlan.checkT -= dt;
    if (c && c === G.player && !c.autopilot && G.atkPlan.checkT <= 0) {
      G.atkPlan.checkT = 1.5;
      const da = Math.hypot(c.pos.x - 13, c.pos.z - 13), db = Math.hypot(c.pos.x - 68, c.pos.z - 17);
      const want = da < db - 12 ? 'A' : db < da - 12 ? 'B' : G.atkPlan.site;
      if (want !== G.atkPlan.site && Math.min(da, db) < 34) G.atkPlan.site = want;
    }
  } else if (G.phase === 'post') {
    G.phaseT -= dt;
    if (G.phaseT <= 0) nextRound();
  }
}

function onPlayerDeath(killer) {
  G.killer = killer && killer !== G.player ? killer : null;
  G.deathCamT = 2.2;
  G.viewAgent = null;
  G.deathPos = G.player.pos.clone();
  G.deathYaw = G.player.yaw;
  HUD.hint('');
}
function nextSpectate(dir) {
  const p = G.player;
  const pool = G.agents.filter((a) => a.alive && a !== p);
  const mates = pool.filter((a) => a.team === p.team);
  const list = mates.length ? mates : pool;
  if (!list.length) { G.specTarget = null; return; }
  const i = list.indexOf(G.specTarget);
  G.specTarget = list[(i + (dir || 1) + list.length) % list.length];
}

// ------------------------------------------------------------------ grenades
const _ge = new THREE.Vector3(), _gt = new THREE.Vector3(), _gd = new THREE.Vector3();
const NADE_CALL = { he: '手雷！', flash: '闪光弹！', smoke: '烟雾弹！' };
function throwGrenade(a, type, strong, dirOverride) {
  if (a.inv[type] <= 0 || a.throwCD > 0) return false;
  a.inv[type]--;
  agentEye(a, _ge);
  const dir = dirOverride ? dirOverride.clone() : dirFromAngles(a.yaw, a.pitch, new THREE.Vector3());
  if (!dirOverride) { dir.y += 0.06; dir.normalize(); }
  const speed = strong ? NADE_SPEED : NADE_SPEED * 0.45;
  const g = { type, owner: a, team: a.team, pos: _ge.clone().addScaledVector(dir, 0.35), vel: dir.multiplyScalar(speed), fuse: type === 'smoke' ? 3.5 : 1.6, still: 0, spin: rand(5, 10), mesh: Models.nadeMesh(type) };
  if (!dirOverride) g.vel.add(_gt.set(a.vel.x * 0.6, Math.max(0, a.vy) * 0.5, a.vel.z * 0.6));
  if (World.cellH(World.toCell(g.pos.x), World.toCell(g.pos.z)) > g.pos.y) g.pos.copy(_ge);
  g.mesh.position.copy(g.pos);
  R.scene.add(g.mesh);
  G.grenades.push(g);
  a.throwCD = 0.7; a.fireCD = 0.5;
  Radio.say(a, NADE_CALL[type]);
  if (a === G.player) { SFX.throwNade(); VM.slash = 0.8; }
  if (a.inv[type] <= 0 && a.slot === 'grenade') {
    const next = NADE_ORDER.find((n) => a.inv[n] > 0);
    if (next) { a.nade = next; a.switchT = 0.4; onSwitched(a); }
    else { const back = slotValid(a, a.prevSlot) && a.prevSlot !== 'grenade' ? a.prevSlot : bestSlot(a); a.slot = 'knife'; switchSlot(a, back); }
  }
  return true;
}
function nadeStep(g, dt) {
  const p = g.pos, v = g.vel;
  v.y -= NADE_GRAV * dt;
  let bounced = false;
  let nx = p.x + v.x * dt;
  if (World.cellH(Math.floor(nx / CELL), Math.floor(p.z / CELL)) > p.y) { v.x = -v.x * 0.45; v.z *= 0.8; nx = p.x; bounced = true; }
  p.x = nx;
  let nz = p.z + v.z * dt;
  if (World.cellH(Math.floor(p.x / CELL), Math.floor(nz / CELL)) > p.y) { v.z = -v.z * 0.45; v.x *= 0.8; nz = p.z; bounced = true; }
  p.z = nz;
  let ny = p.y + v.y * dt;
  const floor = World.cellH(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
  if (ny < floor + 0.06) {
    ny = floor + 0.06;
    if (v.y < 0) {
      if (v.y < -2) bounced = true;
      v.y = -v.y * 0.35; v.x *= 0.62; v.z *= 0.62;
      if (Math.abs(v.y) < 0.9) v.y = 0;
    }
  }
  p.y = ny;
  if (v.y === 0 && p.y <= floor + 0.07) { const f = Math.max(0, 1 - 2.4 * dt); v.x *= f; v.z *= f; }
  return bounced;
}
function simulateThrow(origin, dir, speed) {
  const g = { pos: origin.clone().addScaledVector(dir, 0.35), vel: dir.clone().multiplyScalar(speed) };
  const dt = 1 / 60;
  for (let i = 0; i < 260; i++) {
    nadeStep(g, dt);
    if (i > 20 && Math.hypot(g.vel.x, g.vel.y, g.vel.z) < 0.3) break;
  }
  return g.pos;
}
function smokeBlocks(a, b) {
  for (const s of G.smokes) {
    const age = G.time - s.born;
    if (age > s.life - 1.2) continue;
    const r = s.r * Math.min(1, 0.35 + age / 1.4);
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const l2 = dx * dx + dy * dy + dz * dz || 1e-6;
    const t = clamp(((s.x - a.x) * dx + (s.y - a.y) * dy + (s.z - a.z) * dz) / l2, 0, 1);
    const px = a.x + dx * t - s.x, py = a.y + dy * t - s.y, pz = a.z + dz * t - s.z;
    if (px * px + py * py * 0.55 + pz * pz < r * r) return true;
  }
  return false;
}
function updateGrenades(dt) {
  for (let i = G.grenades.length - 1; i >= 0; i--) {
    const g = G.grenades[i];
    for (let k = 0; k < 3; k++) {
      if (nadeStep(g, dt / 3) && Math.hypot(g.vel.x, g.vel.y, g.vel.z) > 2.2) SFX.bounce(g.pos);
    }
    g.fuse -= dt;
    const speed = Math.hypot(g.vel.x, g.vel.y, g.vel.z);
    let go;
    if (g.type === 'smoke') { if (speed < 0.4) g.still += dt; go = g.still > 0.35 || g.fuse <= 0; }
    else go = g.fuse <= 0;
    g.mesh.position.copy(g.pos);
    g.mesh.rotation.x += g.spin * dt * Math.min(1, speed / 4);
    if (go) { detonate(g); R.scene.remove(g.mesh); G.grenades.splice(i, 1); }
  }
  for (let i = G.smokes.length - 1; i >= 0; i--) if (G.time - G.smokes[i].born > G.smokes[i].life) G.smokes.splice(i, 1);
}
function detonate(g) {
  const p = g.pos;
  if (g.type === 'he') {
    FX.explosion(p, false);
    SFX.explosion(p, false);
    G.noise(g.owner, 30, 'nade');
    const cd = R.camera.position.distanceTo(p);
    if (cd < 18) G.shake = Math.max(G.shake, (18 - cd) / 24);
    for (const a of G.agents) {
      if (!a.alive || (a.team === g.team && a !== g.owner)) continue;
      _gt.set(a.pos.x, a.pos.y + 1.0, a.pos.z);
      const d = _gt.distanceTo(p);
      if (d > 8.5 || !World.losClear(p.x, p.y + 0.3, p.z, _gt.x, _gt.y, _gt.z)) continue;
      let dmg = 98 * Math.pow(1 - d / 8.5, 1.4) * (a === g.owner ? 0.5 : 1);
      // a raised shield facing the blast soaks most of it
      if (shieldActive(a) && !a.shieldOpen && Math.cos(angleDiff(a.yaw, yawTo(p.x - a.pos.x, p.z - a.pos.z))) > 0.5) dmg *= 0.35;
      applyDamage(a, g.owner, dmg, 'chest', 'he', p);
    }
    for (const h of G.hostages) {
      if (!h.alive || h.rescued) continue;
      const d = Math.hypot(h.pos.x - p.x, h.pos.z - p.z);
      if (d < 8.5) damageHostage(h, g.owner, 98 * Math.pow(1 - d / 8.5, 1.4));
    }
  } else if (g.type === 'flash') {
    FX.flashPop(p);
    SFX.flashbang(p);
    for (const a of G.agents) {
      if (!a.alive || a.team === g.team) continue;
      agentEye(a, _gt);
      const d = _gt.distanceTo(p);
      if (d > 32 || !World.losClear(p.x, p.y + 0.1, p.z, _gt.x, _gt.y, _gt.z) || smokeBlocks(p, _gt)) continue;
      dirFromAngles(a.yaw, a.pitch, _gd);
      const facing = _gd.dot(_ge.subVectors(p, _gt).normalize());
      if (shieldActive(a) && !a.shieldOpen && facing > 0.3) continue;
      let dur = facing > 0.5 ? 3.4 : facing > 0 ? 2.2 : facing > -0.5 ? 1.0 : 0.4;
      dur *= clamp(1.25 - d / 30, 0.3, 1);
      if (dur < 0.3) continue;
      a.blind = Math.max(a.blind, dur);
      a.blindMax = a.blind;
      if (a === G.player) SFX.tinnitus(dur * 0.8);
      if (a.ai && a !== G.player) a.ai.targetVis = false;
    }
  } else {
    const fy = World.cellH(World.toCell(p.x), World.toCell(p.z));
    const y = fy > 3 ? p.y : Math.max(0, fy);
    FX.smokeCloud({ x: p.x, y, z: p.z });
    SFX.smokePop(p);
    G.smokes.push({ x: p.x, y: y + 1.6, z: p.z, r: 3.4, born: G.time, life: 16.5 });
  }
}

// ------------------------------------------------------------------ dropped weapons
function dropItem(id, mag, reserve, pos, sil) {
  const mesh = Models.gun(id, true);
  Models.setSilencer(mesh, sil);
  const s = World.snapToWalkable(pos.x + rand(-0.3, 0.3), pos.z + rand(-0.3, 0.3));
  const it = { uid: ++G.itemUid, id, mag, reserve, sil: !!sil, pos: new THREE.Vector3(s.x, s.y + 0.05, s.z), mesh, t: G.time };
  mesh.position.copy(it.pos);
  mesh.rotation.set(0, rand(0, TAU), Math.PI / 2);
  mesh.scale.setScalar(1.15);
  R.scene.add(mesh);
  G.items.push(it);
  if (G.items.length > 16) { const old = G.items.shift(); R.scene.remove(old.mesh); }
  return it;
}
function pickupItem(a, it, swap) {
  const w = WEAPONS[it.id];
  const slot = w.slot;
  if (slot === 'primary' && a.inv.shield) return false;
  const cur = a.inv[slot];
  if (cur && !swap) return false;
  if (cur) dropItem(cur.id, cur.mag, cur.reserve, a.pos, cur.sil);
  a.inv[slot] = { id: it.id, mag: it.mag, reserve: it.reserve, sil: it.sil, burst: false };
  R.scene.remove(it.mesh);
  G.items.splice(G.items.indexOf(it), 1);
  if (a === G.player) SFX.pickup();
  if (a.slot === slot) { a.switchT = 0.5; onSwitched(a); } else if (!cur || a === G.player) switchSlot(a, slot);
  return true;
}
function nearestItemFor(a, maxD) {
  let best = null, bd = maxD;
  for (const it of G.items) {
    const d = Math.hypot(it.pos.x - a.pos.x, it.pos.z - a.pos.z);
    if (d < bd && Math.abs(it.pos.y - a.pos.y) < 1.3) { bd = d; best = it; }
  }
  return best;
}
function updateItems() {
  if (!G.items.length) return;
  for (const a of G.agents) {
    if (!a.alive) continue;
    for (const it of G.items) {
      if (G.time - it.t < 0.8) continue;
      if (Math.hypot(it.pos.x - a.pos.x, it.pos.z - a.pos.z) > 0.9 || Math.abs(it.pos.y - a.pos.y) > 1.3) continue;
      const slot = WEAPONS[it.id].slot;
      if (!a.inv[slot]) { if (pickupItem(a, it, false)) break; }
    }
  }
}
function dropCurrentWeapon(a) {
  if (a.slot === 'bomb' && a.hasBomb) { dropBomb(a, true); return; }
  if (a.slot !== 'primary' && a.slot !== 'secondary') return;
  const s = a.inv[a.slot];
  if (!s) return;
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
  const it = dropItem(s.id, s.mag, s.reserve, { x: a.pos.x + fx * 1.2, y: a.pos.y, z: a.pos.z + fz * 1.2 }, s.sil);
  it.t = G.time + 0.4;
  a.inv[a.slot] = null;
  a.slot = 'knife';
  switchSlot(a, bestSlot(a) === 'knife' ? 'knife' : bestSlot(a));
  if (a.slot === 'knife') onSwitched(a);
}

// ------------------------------------------------------------------ buying
function canBuyNow(a) {
  if (!a.alive || G.state !== 'playing') return false;
  if (G.phase === 'freeze') return true;
  return G.phase === 'live' && G.time - G.liveStart < BUY_WINDOW && inSpawnZone(sideOf(a.team), a.pos.x, a.pos.z);
}
function buyItem(a, id) {
  if (!canBuyNow(a)) return '现在不能购买';
  const info = WEAPONS[id] || EQUIP[id];
  if (!info) return '未知物品';
  if (!teamAllows(info, a.team)) return '你的阵营不能购买';
  const w = WEAPONS[id];
  if (w && w.kind !== 'grenade') {
    if (a.money < w.price) return '金钱不足';
    const cur = a.inv[w.slot];
    if (cur && cur.id === id) return '已经拥有';
    if (cur && a.isPlayer) dropItem(cur.id, cur.mag, cur.reserve, a.pos, cur.sil);
    if (w.slot === 'primary' && a.inv.shield) a.inv.shield = false;
    a.inv[w.slot] = makeGun(id, false);
    a.money -= w.price;
    if (a.slot === w.slot) { a.switchT = 0.5; onSwitched(a); } else switchSlot(a, w.slot);
    return null;
  }
  if (w && w.kind === 'grenade') {
    if (a.inv[id] >= w.max) return '已达携带上限';
    if (nadeCount(a) >= 4) return '投掷物已满';
    if (a.money < w.price) return '金钱不足';
    a.inv[id]++; a.money -= w.price;
    return null;
  }
  if (id === 'kevlar') {
    if (a.armor >= 100) return '已经拥有';
    if (a.money < 650) return '金钱不足';
    a.armor = 100; a.money -= 650;
    return null;
  }
  if (id === 'helmet') {
    if (a.armor >= 100 && a.helmet) return '已经拥有';
    const cost = a.armor >= 100 ? 350 : 1000;
    if (a.money < cost) return '金钱不足';
    a.armor = 100; a.helmet = true; a.money -= cost;
    return null;
  }
  if (id === 'kit') {
    if (G.mode !== 'bomb') return '人质图不需要拆弹器';
    if (a.kit) return '已经拥有';
    if (a.money < EQUIP.kit.price) return '金钱不足';
    a.kit = true; a.money -= EQUIP.kit.price;
    return null;
  }
  if (id === 'shield') {
    if (a.inv.shield) return '已经拥有';
    if (a.money < EQUIP.shield.price) return '金钱不足';
    if (a.inv.primary) { if (a.isPlayer) dropItem(a.inv.primary.id, a.inv.primary.mag, a.inv.primary.reserve, a.pos, a.inv.primary.sil); a.inv.primary = null; }
    a.inv.shield = true; a.money -= EQUIP.shield.price;
    a.slot = 'knife';
    if (!switchSlot(a, 'secondary')) { a.switchT = 0.3; onSwitched(a); }
    return null;
  }
  return '未知物品';
}
// one magazine's worth per purchase, like the old ammo boxes
function buyAmmo(a, which) {
  if (!canBuyNow(a)) return '现在不能购买';
  const s = a.inv[which === 1 ? 'primary' : 'secondary'];
  if (!s) return which === 1 ? '没有主武器' : '没有副武器';
  const w = WEAPONS[s.id];
  if (s.reserve >= w.reserveMax) return '子弹已满';
  if (a.money < w.ammoPrice) return '金钱不足';
  s.reserve = Math.min(w.reserveMax, s.reserve + w.ammoPer);
  a.money -= w.ammoPrice;
  return null;
}
function itemPrice(a, id) {
  if (WEAPONS[id]) return WEAPONS[id].price;
  if (id === 'helmet' && a.armor >= 100 && !a.helmet) return 350;
  return EQUIP[id].price;
}
function itemOwned(a, id) {
  const w = WEAPONS[id];
  if (w && w.kind !== 'grenade') { const s = a.inv[w.slot]; return !!(s && s.id === id); }
  if (w) return a.inv[id] >= w.max;
  if (id === 'kevlar') return a.armor >= 100;
  if (id === 'helmet') return a.armor >= 100 && a.helmet;
  if (id === 'kit') return a.kit;
  if (id === 'shield') return a.inv.shield;
  return false;
}

// ------------------------------------------------------------------ spotting for the player's radar
let spotT = 0;
const _se = new THREE.Vector3(), _sf = new THREE.Vector3();
function updateSpotting(dt) {
  spotT -= dt;
  if (spotT > 0) return;
  spotT = 0.12;
  const p = G.player;
  if (!p || !p.alive || p.blind > 0.5) return;
  agentEye(p, _se);
  dirFromAngles(p.yaw, p.pitch, _sf);
  const half = R.camera.fov * DEG * 0.5 * Math.max(1, R.camera.aspect) * 1.1;
  for (const e of G.agents) {
    if (!e.alive || e.team === p.team) continue;
    const dx = e.pos.x - _se.x, dy = e.pos.y + 1.2 - _se.y, dz = e.pos.z - _se.z, d = Math.hypot(dx, dy, dz);
    if (d > 90 || (dx * _sf.x + dy * _sf.y + dz * _sf.z) / d < Math.cos(half)) continue;
    if (canSeeAgent(_se, e)) G.spot(p.team, e);
  }
}
