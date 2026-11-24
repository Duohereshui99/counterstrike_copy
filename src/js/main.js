'use strict';
/* =========================================================
   main.js — input, player control, cameras, the start flow
   (side and outfit selection), pause and the main loop.
   ========================================================= */
const Input = {
  keys: Object.create(null), pressed: Object.create(null), mouseL: false, mouseR: false, pressL: false, pressR: false,
  dx: 0, dy: 0, wheel: 0, locked: false, noLock: false, lockFails: 0, everLocked: false, lockPending: false, cursorX: 0.5, cursorY: 0.5,
  touch: { mx: 0, my: 0, fire: false, crouch: false, use: false, useHeld: false },
};
// keys whose browser default would get in the way while playing
const PREVENT = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Quote', 'F1', 'Comma', 'Period', 'Backquote', 'ControlLeft', 'ControlRight']);
// in full screen the browser can hand these to the page, so Ctrl+W and friends cannot close the tab mid-crouch
const LOCK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyT', 'KeyN', 'KeyF', 'KeyG', 'KeyB', 'KeyZ', 'KeyX', 'KeyC', 'KeyM', 'KeyP', 'KeyL', 'KeyH',
  'Tab', 'Space', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];

function requestLock() {
  if (Input.noLock || IS_TOUCH || Input.locked) return;
  const c = R.renderer.domElement;
  Input.lockPending = true;
  try {
    const r = c.requestPointerLock();
    if (r && typeof r.catch === 'function') r.catch(() => lockFailed());
  } catch (e) { lockFailed(); }
}
function lockFailed() {
  // a failure can arrive both as a promise rejection and as an event: count it once
  if (Input.noLock || Input.locked || !Input.lockPending) return;
  Input.lockPending = false;
  Input.lockFails++;
  if (!Input.everLocked || Input.lockFails >= 2) {
    Input.noLock = true;
    $('clicklock').classList.add('hidden');
    const tip = $('nolock-tip');
    tip.classList.remove('hidden');
    setTimeout(() => tip.classList.add('hidden'), 10000);
  } else if (G.state === 'playing') $('clicklock').classList.remove('hidden');
}

const isOpen = (id) => !$(id).classList.contains('hidden');
const digitOf = (code) => { const m = /^(?:Digit|Numpad)(\d)$/.exec(code); return m ? Number(m[1]) : -1; };

function setupInput() {
  const canvas = R.renderer.domElement;
  window.addEventListener('keydown', (e) => {
    const c = e.code;
    const playing = G.state === 'playing';
    if (playing && (PREVENT.has(c) || e.ctrlKey)) e.preventDefault();
    if (e.repeat) return;
    // the full-screen side / outfit pickers take number keys first
    if (isOpen('teamsel')) { overlayKey('team', c); return; }
    if (isOpen('skinsel')) { overlayKey('skin', c); return; }
    if (playing) {
      if (c === 'Escape') {
        if (Shop.open) { Shop.hide('esc'); return; }
        if (HUD.menu) { HUD.closeMenu(); return; }
        if (Input.noLock || IS_TOUCH) { if (G.paused) resumeGame(); else pauseGame(); }
        return;
      }
      if (G.paused) return;
      const d = digitOf(c);
      if (Shop.open && d >= 0) { Shop.key(d); return; }
      if (HUD.menu && d >= 0) { HUD.menuKey(d); return; }
      if (c === 'KeyB') { HUD.toggleMenu('buy'); return; }
      if (c === 'KeyZ' || c === 'KeyX' || c === 'KeyC') { HUD.toggleMenu('radio', c.slice(3)); return; }
      if (c === 'KeyM') { openSwitchTeam(); return; }
      if (c === 'Comma') { HUD.quickAmmo(1); return; }
      if (c === 'Period') { HUD.quickAmmo(2); return; }
    }
    if (!Input.keys[c]) Input.pressed[c] = true;
    Input.keys[c] = true;
  });
  window.addEventListener('keyup', (e) => { Input.keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in Input.keys) Input.keys[k] = false; Input.mouseL = Input.mouseR = false; });

  canvas.addEventListener('mousedown', (e) => {
    SFX.init();
    if (G.state !== 'playing' || G.paused || IS_TOUCH) return;
    if (!Input.locked && !Input.noLock) { requestLock(); return; }
    if (e.button === 0) { Input.mouseL = true; Input.pressL = true; }
    if (e.button === 2) { Input.mouseR = true; Input.pressR = true; }
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) Input.mouseL = false; if (e.button === 2) Input.mouseR = false; });
  window.addEventListener('mousemove', (e) => {
    Input.cursorX = e.clientX / window.innerWidth; Input.cursorY = e.clientY / window.innerHeight;
    if (G.state !== 'playing' || G.paused) return;
    if (Input.locked || (Input.noLock && !HUD.menu && !Shop.open)) {
      Input.dx += clamp(e.movementX || 0, -300, 300);
      Input.dy += clamp(e.movementY || 0, -300, 300);
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // not passive: Ctrl + wheel would otherwise zoom the page while crouching
  window.addEventListener('wheel', (e) => {
    if (G.state !== 'playing') return;
    e.preventDefault();
    if (!HUD.menu && !Shop.open && !G.paused) Input.wheel += Math.sign(e.deltaY);
  }, { passive: false });
  document.addEventListener('pointerlockchange', () => {
    Input.locked = document.pointerLockElement === canvas;
    canvas.style.cursor = Input.locked || Input.noLock ? 'none' : '';
    if (Input.locked) { Input.everLocked = true; Input.lockFails = 0; Input.lockPending = false; $('clicklock').classList.add('hidden'); return; }
    // the shop frees the mouse on purpose; any other loss of the lock pauses
    if (G.state === 'playing' && !G.paused && !Input.noLock && !Shop.open) pauseGame();
  });
  document.addEventListener('pointerlockerror', () => lockFailed());
  $('clicklock').addEventListener('click', () => { $('clicklock').classList.add('hidden'); requestLock(); });
  // closing the tab by accident (Ctrl+W while crouching) asks first
  window.addEventListener('beforeunload', (e) => {
    if (G.state !== 'playing') return;
    e.preventDefault();
    e.returnValue = '';
  });
  document.addEventListener('fullscreenchange', () => {
    const kb = navigator.keyboard;
    if (!kb || !kb.lock) return;
    if (document.fullscreenElement) kb.lock(LOCK_KEYS).catch(() => {});
    else kb.unlock();
  });
}

function clearFrameInput() {
  for (const k in Input.pressed) delete Input.pressed[k];
  Input.pressL = false; Input.pressR = false; Input.wheel = 0;
}

// ------------------------------------------------------------------ player control
const SLOT_CYCLE = ['primary', 'secondary', 'knife', 'grenade', 'bomb'];
function updatePlayer(dt) {
  const p = G.player;
  if (!p) return;
  if (!p.alive) { updateSpectateInput(); return; }
  if (p.autopilot) { AI.update(p, dt); HUD.showScoreboard(!!Input.keys.Tab); return; }
  const K = Input.keys, P = Input.pressed;
  const w = curWeapon(p);
  let sens = 0.0022 * Settings.sens;
  if (p.scope && w && w.zoom) sens *= w.zoom[Math.min(p.scope, w.zoom.length) - 1] / R.baseFov;
  const dx = Input.dx, dy = Input.dy;
  Input.dx = 0; Input.dy = 0;
  let yawRate = 0, pitchRate = 0;
  if (K.ArrowLeft) yawRate += 2.3;
  if (K.ArrowRight) yawRate -= 2.3;
  if (K.ArrowUp) pitchRate += 1.5;
  if (K.ArrowDown) pitchRate -= 1.5;
  if (Input.noLock && !IS_TOUCH && !HUD.menu && !Shop.open) {
    const cx = Input.cursorX;
    if (cx < 0.08) yawRate += (0.08 - cx) / 0.08 * 3.2;
    else if (cx > 0.92) yawRate -= (cx - 0.92) / 0.08 * 3.2;
  }
  const zoomK = p.scope ? 0.35 : 1;
  p.yaw = wrapAngle(p.yaw - dx * sens + yawRate * dt * zoomK);
  p.pitch = clamp(p.pitch - dy * sens + pitchRate * dt * zoomK, -1.53, 1.53);
  G.lookDX = dx * sens; G.lookDY = dy * sens;

  let f = 0, s = 0;
  if (K.KeyW) f += 1;
  if (K.KeyS) f -= 1;
  if (K.KeyD) s += 1;
  if (K.KeyA) s -= 1;
  f += Input.touch.my; s += Input.touch.mx;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  p.crouching = !!(K.ControlLeft || K.ControlRight || Input.touch.crouch);
  p.walking = !!(K.ShiftLeft || K.ShiftRight);
  handleUse(p);
  moveAgent(p, fx * f + rx * s, fz * f + rz * s, dt, !!P.Space);
  handleWeapons(p);
  HUD.showScoreboard(!!K.Tab);
}

const KEY = (k) => (IS_TOUCH ? `「${k}」` : `<kbd>${k}</kbd>`);
function handleUse(p) {
  const E = !!(Input.keys.KeyE || Input.touch.use);
  const ePress = !!(Input.pressed.KeyE || (Input.touch.use && !Input.touch.useHeld));
  const side = sideOf(p.team);
  let hint = '';
  if (p.action) {
    if (!E) cancelAction(p);
  } else if (G.mode === 'bomb' && (G.phase === 'live' || G.phase === 'planted')) {
    if (side === 'atk' && p.hasBomb && G.phase === 'live') {
      const z = inSiteZone(p.pos.x, p.pos.z);
      if (z && !plantableAt(p)) hint = '站到地面上才能安放炸弹';
      else if (z) {
        hint = `按住 ${KEY('E')} 在 ${z} 包点安放炸弹`;
        if (E && startAction(p, 'plant') && p.slot !== 'bomb') switchSlot(p, 'bomb');
      }
    }
    const b = G.bomb;
    if (side === 'def' && b.state === 'planted' && Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) < 1.7 && Math.abs(b.pos.y - p.pos.y) < 1.3) {
      hint = b.defuser && b.defuser !== p ? '队友正在拆除' : `按住 ${KEY('E')} 拆除炸弹（${p.kit ? '拆弹器 5' : '10'} 秒）`;
      if (E) startAction(p, 'defuse');
    }
  } else if (G.mode === 'hostage' && p.team === CT && G.phase === 'live') {
    const h = nearestHostage(p, 2.0, false);
    if (h) {
      hint = h.leader === p ? `按 ${KEY('E')} 让人质原地等待` : `按 ${KEY('E')} 让人质跟着你`;
      if (ePress) useHostage(p, h);
    }
  }
  if (!p.action && !hint) {
    const it = nearestItemFor(p, 1.7);
    if (it && !(WEAPONS[it.id].slot === 'primary' && p.inv.shield)) {
      hint = `按 ${KEY('E')} 拾取 ${WEAPONS[it.id].name}`;
      if (ePress) pickupItem(p, it, true);
    }
  }
  Input.touch.useHeld = Input.touch.use;
  if (!hint && G.phase === 'freeze' && !HUD.menu && !Shop.open && G.round <= 2) hint = IS_TOUCH ? '点左侧「购买」买枪和子弹' : '按 <kbd>B</kbd> 打开商店，用鼠标点选购买 · 新枪只带一个弹匣，记得买子弹';
  HUD.hint(hint);
}

function selectSlot(p, slot) {
  switchSlot(p, slot);
  HUD.slotsT = 1.8;
}
function toggleShield(p) {
  p.shieldOpen = !p.shieldOpen;
  p.fireCD = Math.max(p.fireCD, 0.25);
  SFX.deploy();
}
function handleWeapons(p) {
  const P = Input.pressed;
  if (P.Digit1) selectSlot(p, 'primary');
  if (P.Digit2) selectSlot(p, 'secondary');
  if (P.Digit3) selectSlot(p, 'knife');
  if (P.Digit4) selectSlot(p, 'grenade');
  if (P.Digit5) selectSlot(p, 'bomb');
  if (P.KeyQ && !switchSlot(p, p.prevSlot)) switchSlot(p, p.slot === 'knife' ? bestSlot(p) : 'knife');
  if (Input.wheel) {
    const dir = Input.wheel > 0 ? 1 : -1;
    let i = SLOT_CYCLE.indexOf(p.slot);
    for (let k = 0; k < SLOT_CYCLE.length; k++) { i = (i + dir + SLOT_CYCLE.length) % SLOT_CYCLE.length; if (slotValid(p, SLOT_CYCLE[i])) { selectSlot(p, SLOT_CYCLE[i]); break; } }
  }
  if (P.KeyR) startReload(p);
  if (P.KeyG) dropCurrentWeapon(p);
  const w = curWeapon(p);
  if (!w || p.switchT > 0 || p.action) return;
  // a click shorter than one frame still counts as a trigger pull
  const lPress = Input.pressL, rPress = Input.pressR, lHeld = Input.mouseL || Input.touch.fire || lPress;
  const inst = curGun(p), shield = shieldActive(p);
  // right button: whatever the weapon in hand does specially
  if (rPress) {
    if (shield) toggleShield(p);
    else if (inst && w.sil) toggleSilencer(p);
    else if (inst && w.burst) toggleBurst(p);
    else if (w.zoom && p.reloadT <= 0) {
      p.scope = (p.scope + 1) % (w.zoom.length + 1); p.scopeWant = p.scope; p.rescopeT = 0;
      SFX.scope();
    }
  }
  if (w.kind === 'grenade') {
    if ((lPress || rPress) && p.throwCD <= 0 && G.phase !== 'freeze') throwGrenade(p, p.nade, !rPress);
    return;
  }
  if (w.kind === 'bomb') {
    if (lPress && inSiteZone(p.pos.x, p.pos.z) && G.phase === 'live') HUD.notice('按住 E 安放炸弹');
    return;
  }
  if (G.phase === 'freeze') return;
  if (shield && !p.shieldOpen) {
    if (lPress) HUD.notice('盾牌举起时不能攻击 · 按右键放低盾牌');
    return;
  }
  if (w.kind === 'knife') {
    if (lHeld && p.fireCD <= 0) knifeAttack(p, false);
    else if (!shield && (Input.mouseR || rPress) && p.fireCD <= 0) knifeAttack(p, true);
    return;
  }
  if (p.reloadT > 0 || p.silT > 0 || p.burstQ > 0) return;
  if (lHeld && p.fireCD <= 0) {
    if (inst.mag <= 0) { if (lPress) { SFX.dry(); startReload(p); } }
    else if ((w.auto && !inst.burst) || lPress) fireWeapon(p);
  }
  if (inst.mag === 0 && inst.reserve > 0 && !lHeld && p.fireCD <= 0) startReload(p);
}

function updateSpectateInput() {
  if (G.deathCamT > 0) return;
  if (Input.pressL || Input.pressed.Space) nextSpectate(1);
  if (Input.pressR) nextSpectate(-1);
  if (!G.specTarget || !G.specTarget.alive) {
    G.specSwitchT = (G.specSwitchT || 0) + 1 / 60;
    if (!G.specTarget || G.specSwitchT > 1.2) { G.specSwitchT = 0; nextSpectate(1); }
  }
  HUD.showScoreboard(!!Input.keys.Tab);
}

// ------------------------------------------------------------------ cameras
const _ce = new THREE.Vector3();
G.bobT = 0; G.lookDX = 0; G.lookDY = 0;
function updateCamera(dt) {
  const cam = R.camera, p = G.player;
  let fov = R.baseFov;
  G.shake = Math.max(0, G.shake - dt * 1.6);
  const shx = (Math.random() - 0.5) * G.shake * 0.05, shy = (Math.random() - 0.5) * G.shake * 0.05;
  if (G.state === 'menu' || G.state === 'over' || !p) {
    const t = performance.now() * 0.00004;
    cam.position.set(40 + Math.cos(t) * 52, 42, 34 + Math.sin(t) * 46);
    cam.lookAt(40, 0, 34);
    VM.root.visible = false;
  } else if (p.alive) {
    G.viewAgent = p;
    const target = p.pos.y + lerp(EYE_STAND, EYE_CROUCH, p.crouch);
    p.viewY = Math.abs(target - p.viewY) > 0.8 ? target : damp(p.viewY, target, p.onGround ? 16 : 60, dt);
    p.landDip = damp(p.landDip, 0, 9, dt);
    const sp = Math.hypot(p.vel.x, p.vel.z);
    G.bobT += dt * sp * 1.7;
    const bob = p.onGround ? Math.sin(G.bobT * 2) * 0.014 * Math.min(1, sp / 5) : 0;
    cam.position.set(p.pos.x, p.viewY + bob - p.landDip, p.pos.z);
    cam.rotation.set(p.pitch + p.recoil.p * DEG * 0.5 + p.punch + shy, p.yaw + p.recoil.y * DEG * 0.5 + shx, 0);
    const w = curWeapon(p), inst = curGun(p);
    if (p.scope > 0 && w && w.zoom) fov = w.zoom[Math.min(p.scope, w.zoom.length) - 1];
    VM.root.visible = !(p.scope > 0 && w && w.overlay);
    // the silencer appears or disappears halfway through the attach animation
    const silOn = inst ? (p.silT > 0 ? (p.silT < 0.8 ? p.silTo : !p.silTo) : !!inst.sil) : false;
    VM.update(dt, {
      speed: sp, onGround: p.onGround, crouch: p.crouch, dYaw: G.lookDX, dPitch: G.lookDY,
      reloadFrac: p.reloadT > 0 ? 1 - p.reloadT / p.reloadDur : -1, silOn, shield: shieldActive(p), shieldOpen: p.shieldOpen,
    });
    if (p.model) p.model.root.visible = false;
  } else {
    VM.root.visible = false;
    if (G.deathCamT > 0) {
      G.deathCamT -= dt;
      const dp = G.deathPos, k = G.killer;
      const h = 0.5 + 1.2 * clamp(G.deathCamT / 2.2, 0, 1);
      cam.position.set(dp.x, dp.y + h, dp.z);
      if (k && k.alive) { cam.lookAt(k.pos.x, k.pos.y + 1.4, k.pos.z); }
      else cam.rotation.set(-0.3, G.deathYaw, 0.2);
      if (G.deathCamT <= 0) nextSpectate(1);
    } else if (G.specTarget) {
      const t = G.specTarget;
      agentEye(t, _ce);
      const fx = -Math.sin(t.yaw), fz = -Math.cos(t.yaw), rx = Math.cos(t.yaw), rz = -Math.sin(t.yaw);
      const dx = -fx * 2.6 + rx * 0.5, dz = -fz * 2.6 + rz * 0.5, dy = 0.55, len = Math.hypot(dx, dy, dz);
      const hit = World.raycast(_ce.x, _ce.y, _ce.z, dx / len, dy / len, dz / len, len);
      const k = hit ? Math.max(0.15, hit.t - 0.3) / len : 1;
      cam.position.set(_ce.x + dx * k, _ce.y + dy * k, _ce.z + dz * k);
      cam.rotation.set(clamp(t.pitch, -0.8, 0.8) * 0.7 - 0.1 + shy, t.yaw + shx, 0);
    }
    G.viewAgent = G.deathCamT > 0 ? null : G.specTarget;
  }
  if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  SFX.setListener(cam.position.x, cam.position.y, cam.position.z, cam.rotation.y);
}

// ------------------------------------------------------------------ loop
function stepGame(dt, first) {
  updateGame(dt);
  if (G.state !== 'playing') return;
  updatePlayer(dt);
  if (first) clearFrameInput();
  for (const a of G.agents) {
    updateAgentTimers(a, dt);
    if (!a.alive) continue;
    if (a.ai && a !== G.player) AI.update(a, dt);
    updateAction(a, dt);
  }
  separateAgents();
  updateGrenades(dt);
  updateItems();
  updateBomb(dt);
  updateHostages(dt);
  updateSpotting(dt);
}
// skinned people are posed once per rendered frame (IK is too costly to run every physics substep)
function updateModels(dt) {
  for (const a of G.agents) if (a.model) updateAgentModel(a, dt);
  for (const h of G.hostages) updateHostageModel(h, dt);
}

let lastT = performance.now();
let fpsAcc = 0, fpsN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.max(0, (now - lastT) / 1000);
  const dt = Math.min(0.1, raw);
  lastT = now;
  fpsAcc += raw; fpsN++;
  if (fpsAcc > 1) { G.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (G.state === 'playing' && !G.paused) {
    const total = dt * G.timeScale;
    const steps = Math.max(1, Math.ceil(total / (1 / 60) - 0.01));
    for (let i = 0; i < steps; i++) stepGame(total / steps, i === 0);
    if (G.state === 'playing') updateModels(Math.min(total, 0.25));
  } else clearFrameInput();
  updateCamera(dt);
  FX.update(G.paused ? 0 : dt, R.camera);
  if (G.state === 'playing') HUD.update(dt);
  R.render();
}

// ------------------------------------------------------------------ side and outfit selection
const ROLE_TEXT = {
  bomb: { [T]: '进攻：把炸弹送到 A 或 B 包点安放并守到爆炸，或者消灭全部警察。', [CT]: '防守：守住两个包点，阻止安放或者拆掉炸弹，或者消灭全部匪徒。' },
  hostage: { [T]: '看守：别让人质被救走，撑到时间结束，或者消灭全部警察。', [CT]: '营救：找到人质，按 E 让他们跟着你，带回南边的营救区。' },
};
const Flow = { ctx: 'start', team: CT, previews: {} };

function openTeamSelect(ctx) {
  Flow.ctx = ctx;
  const mode = ctx === 'start' ? Settings.mode : G.mode;
  $('teamsel-mode').textContent = MODE_NAME[mode] + (ctx === 'start' ? ' · 选择你要加入的一方' : ' · 下回合开始时生效');
  $('role-t').textContent = ROLE_TEXT[mode][T];
  $('role-ct').textContent = ROLE_TEXT[mode][CT];
  for (const id of ['menu', 'pause', 'skinsel']) $(id).classList.add('hidden');
  $('teamsel').classList.remove('hidden');
}
function teamBack() {
  $('teamsel').classList.add('hidden');
  if (Flow.ctx === 'start') $('menu').classList.remove('hidden');
  else showPauseOverlay();
}
function chooseTeam(team) {
  SFX.init(); SFX.ui('click');
  Flow.team = team == null ? (Math.random() < 0.5 ? CT : T) : team;
  openSkinSelect(Flow.team);
}
function openSkinSelect(team) {
  $('teamsel').classList.add('hidden');
  $('skinsel-team').textContent = `${SIDE_LABEL[team]} · ${TEAM_NAMES[team]}`;
  const box = $('skin-cards');
  box.innerHTML = SKINS[team].map((s, i) => `<button class="skin-card" type="button" data-skin="${i}"><img alt="" data-i="${i}"><span class="k">按 ${i + 1}</span><span class="nm">${esc(s.name)}</span><span class="ds">${esc(s.desc)}</span></button>`).join('');
  box.querySelectorAll('.skin-card').forEach((b) => b.addEventListener('click', () => chooseSkin(Number(b.dataset.skin))));
  $('skinsel').classList.remove('hidden');
  // portraits are rendered once per side, after the cards have painted
  setTimeout(() => {
    const urls = skinPreviews(team);
    box.querySelectorAll('img').forEach((img) => { const u = urls[Number(img.dataset.i)]; if (u) img.src = u; });
  }, 30);
}
function skinBack() { openTeamSelect(Flow.ctx); }
function chooseSkin(idx) {
  if (idx == null) idx = randi(0, 3);
  $('skinsel').classList.add('hidden');
  SFX.ui('click');
  if (Flow.ctx === 'start') { startMatch(Flow.team, idx); return; }
  G.pendingTeam = Flow.team; G.pendingSkin = idx;
  HUD.notice(Flow.team === G.player.team ? '下回合开始时换上新人物' : `下回合开始时你将加入${SIDE_LABEL[Flow.team]}`, 3.2);
  resumeGame();
}
function overlayKey(kind, c) {
  const n = digitOf(c);
  if (kind === 'team') {
    if (n === 1) chooseTeam(T);
    else if (n === 2) chooseTeam(CT);
    else if (n === 5) chooseTeam(null);
    else if (n === 0 || c === 'Escape') teamBack();
  } else if (n >= 1 && n <= 4) chooseSkin(n - 1);
  else if (n === 5) chooseSkin(null);
  else if (n === 0 || c === 'Escape') skinBack();
}
// full-body portraits of the four outfits, rendered off-screen with the game's own renderer
function skinPreviews(team) {
  if (Flow.previews[team]) return Flow.previews[team];
  const out = [];
  const W = 240, H = 330;
  const scene = new THREE.Scene();
  if (R.env) scene.environment = R.env;
  scene.add(new THREE.HemisphereLight(0xc6d7ec, 0x806a55, 0.75));
  const key = new THREE.DirectionalLight(0xffe2bc, 1.05); key.position.set(-2.2, 4, 3.4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 0.55); rim.position.set(3, 2.5, -3); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(23, W / H, 0.1, 50);
  cam.position.set(0, 1.08, 5.0); cam.lookAt(0, 0.96, 0);
  for (let i = 0; i < SKINS[team].length; i++) {
    const m = Models.character(team, i, i);
    const pose = {
      model: m, pos: new THREE.Vector3(), yaw: Math.PI + 0.42, pitch: -0.05, alive: true, vel: new THREE.Vector3(), crouch: 0,
      slot: 'primary', nade: 'he', hasBomb: false, shieldOpen: false,
      inv: { primary: { id: team === CT ? 'k4' : 'ar7', sil: false }, secondary: null, knife: { id: 'knife' }, he: 0, flash: 0, smoke: 0, shield: false },
    };
    updateAgentModel(pose, 0);
    scene.add(m.root);
    out.push(R.snapshot(scene, cam, W, H, 2));
    scene.remove(m.root);
  }
  Flow.previews[team] = out;
  return out;
}

// ------------------------------------------------------------------ match flow and pause
function showPauseOverlay() {
  $('p-sens').value = Settings.sens; $('p-vol').value = Settings.volume;
  $('pause').classList.remove('hidden');
}
function pauseGame() {
  if (G.state !== 'playing' || G.paused) return;
  G.paused = true;
  HUD.closeMenu();
  Shop.hide('reset');
  showPauseOverlay();
}
function resumeGame() {
  for (const id of ['pause', 'teamsel', 'skinsel']) $(id).classList.add('hidden');
  G.paused = false;
  requestLock();
}
// M or the pause menu: pick a side for the next round (the game waits meanwhile)
function openSwitchTeam() {
  if (G.state !== 'playing') return;
  G.paused = true;
  HUD.closeMenu();
  Shop.hide('reset');
  HUD.showScoreboard(false);
  if (document.pointerLockElement) document.exitPointerLock();
  openTeamSelect('switch');
}
function startMatch(team, skin) {
  SFX.init(); SFX.setVolume(Settings.volume);
  saveSettings();
  R.applyQuality();
  if (team == null) team = Math.random() < 0.5 ? CT : T;
  if (skin == null) skin = randi(0, 3);
  newMatch(team, skin);
  G.state = 'playing'; G.paused = false;
  for (const id of ['menu', 'matchover', 'pause', 'teamsel', 'skinsel']) $(id).classList.add('hidden');
  HUD.reset();
  HUD.show(true);
  setTouchVisible(true);
  requestLock();
  startRound();
}
function restartMatch() {
  const p = G.player;
  startMatch(p ? p.team : null, p ? p.skin : null);
}
function toMenu() {
  G.state = 'menu'; G.paused = false;
  for (const a of G.agents) if (a.model) R.scene.remove(a.model.root);
  clearRoundObjects();
  G.agents = []; G.player = null;
  HUD.reset(); HUD.show(false); HUD.hint('');
  for (const id of ['pause', 'matchover', 'teamsel', 'skinsel']) $(id).classList.add('hidden');
  $('menu').classList.remove('hidden');
  setTouchVisible(false);
  if (document.pointerLockElement) document.exitPointerLock();
}
function wireMenu() {
  document.querySelectorAll('.seg').forEach((seg) => {
    const key = seg.dataset.opt;
    const sync = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(Settings[key]) === b.dataset.v));
    seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      Settings[key] = (key === 'teamSize' || key === 'rounds') ? Number(b.dataset.v) : b.dataset.v;
      sync(); saveSettings(); SFX.init(); SFX.ui('click');
    }));
    sync();
  });
  const slider = (id, key, apply) => {
    const el = $(id);
    el.value = Settings[key];
    el.addEventListener('input', () => { Settings[key] = Number(el.value); if (apply) apply(); saveSettings(); });
  };
  slider('opt-sens', 'sens'); slider('opt-vol', 'volume', () => SFX.setVolume(Settings.volume));
  slider('p-sens', 'sens'); slider('p-vol', 'volume', () => SFX.setVolume(Settings.volume));
  $('btn-start').addEventListener('click', () => { SFX.init(); SFX.ui('click'); openTeamSelect('start'); });
  document.querySelectorAll('.team-card').forEach((b) => b.addEventListener('click', () => chooseTeam(Number(b.dataset.team))));
  $('team-auto').addEventListener('click', () => chooseTeam(null));
  $('team-back').addEventListener('click', teamBack);
  $('skin-auto').addEventListener('click', () => chooseSkin(null));
  $('skin-back').addEventListener('click', skinBack);
  const fs = $('btn-fs');
  if (!document.fullscreenEnabled) fs.classList.add('hidden');
  fs.addEventListener('click', () => {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    const req = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    if (req && req.catch) req.catch(() => { fs.textContent = '无法全屏'; });
  });
  document.addEventListener('fullscreenchange', () => { fs.textContent = document.fullscreenElement ? '退出全屏' : '全屏'; });
  $('btn-resume').addEventListener('click', resumeGame);
  $('btn-team').addEventListener('click', openSwitchTeam);
  $('btn-restart').addEventListener('click', restartMatch);
  $('btn-quit').addEventListener('click', toMenu);
  $('btn-again').addEventListener('click', restartMatch);
  $('btn-menu').addEventListener('click', toMenu);
  if (IS_TOUCH) $('start-note').textContent = '触屏：左下摇杆移动，右侧滑动瞄准';
}

// ------------------------------------------------------------------ touch controls
function setTouchVisible(v) { if (IS_TOUCH) $('touch').classList.toggle('hidden', !v); }
function setupTouch() {
  const stick = $('t-stick'), knob = $('t-knob'), look = $('touch-look');
  let stickId = null, lookId = null, cx = 0, cy = 0, lx = 0, ly = 0;
  stick.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0]; stickId = t.identifier;
    const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    e.preventDefault();
  }, { passive: false });
  look.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0]; lookId = t.identifier; lx = t.clientX; ly = t.clientY;
    if (G.player && !G.player.alive) Input.pressL = true;
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        let dx = t.clientX - cx, dy = t.clientY - cy;
        const L = Math.hypot(dx, dy), max = 52;
        if (L > max) { dx *= max / L; dy *= max / L; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        Input.touch.mx = dx / max; Input.touch.my = -dy / max;
      } else if (t.identifier === lookId) {
        Input.dx += (t.clientX - lx) * 1.9; Input.dy += (t.clientY - ly) * 1.9;
        lx = t.clientX; ly = t.clientY;
      }
    }
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { stickId = null; knob.style.transform = ''; Input.touch.mx = 0; Input.touch.my = 0; }
      if (t.identifier === lookId) lookId = null;
    }
  };
  window.addEventListener('touchend', end); window.addEventListener('touchcancel', end);
  const hold = (id, on, off) => {
    const el = $(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); SFX.init(); el.classList.add('on'); on(); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); el.classList.remove('on'); if (off) off(); }, { passive: false });
  };
  hold('t-fire', () => { Input.touch.fire = true; Input.pressL = true; }, () => { Input.touch.fire = false; });
  hold('t-jump', () => { Input.pressed.Space = true; });
  hold('t-crouch', () => { Input.touch.crouch = !Input.touch.crouch; $('t-crouch').classList.toggle('on', Input.touch.crouch); });
  hold('t-reload', () => { Input.pressed.KeyR = true; });
  hold('t-scope', () => { Input.pressR = true; });
  hold('t-switch', () => { Input.wheel = 1; });
  hold('t-use', () => { Input.touch.use = true; }, () => { Input.touch.use = false; });
  hold('t-buy', () => { if (G.state === 'playing' && !G.paused) HUD.toggleMenu('buy'); });
  // one radio button on touch: each tap moves to the next radio page, then closes
  hold('t-radio', () => {
    if (G.state !== 'playing' || G.paused) return;
    const m = HUD.menu, next = { Z: 'X', X: 'C' };
    if (m && m.kind === 'radio') { if (next[m.key]) HUD.openMenu('radio', next[m.key]); else HUD.closeMenu(); }
    else HUD.openMenu('radio', 'Z');
  });
  hold('t-menu', () => { if (G.state === 'playing') { if (G.paused) resumeGame(); else pauseGame(); } });
  hold('t-score', () => { if (G.state === 'playing') HUD.showScoreboard(!HUD.sbOpen); });
}

// ------------------------------------------------------------------ boot
function boot() {
  loadSettings();
  const load = $('loading');
  if (typeof THREE === 'undefined') {
    load.textContent = '3D 引擎没有加载成功。请检查网络连接后刷新页面。';
    load.classList.add('err');
    return;
  }
  try {
    R.init($('game'));
  } catch (e) {
    load.textContent = '你的浏览器无法启动 WebGL，游戏需要支持 WebGL 的浏览器。';
    load.classList.add('err');
    console.error(e);
    return;
  }
  HUD.init();
  wireMenu();
  setupInput();
  if (IS_TOUCH) { document.body.classList.add('touch'); setupTouch(); setTouchVisible(false); }
  const qs = new URLSearchParams(location.search);
  if (qs.get('autopilot')) G.autopilot = true;
  if (qs.get('speed')) G.timeScale = Number(qs.get('speed')) || 1;
  if (qs.get('mode')) Settings.mode = qs.get('mode') === 'hostage' ? 'hostage' : 'bomb';
  if (qs.get('size')) Settings.teamSize = Number(qs.get('size')) || 5;
  if (qs.get('rounds')) Settings.rounds = Number(qs.get('rounds')) || 0;
  if (qs.get('diff')) Settings.difficulty = qs.get('diff');
  window.__kestrel = {
    G, World, AI, R, HUD, Input, Settings, VM, Radio, startMatch, toMenu, startRound, endRound, buyItem, buyAmmo,
    openTeamSelect, chooseTeam, chooseSkin, skinPreviews, useHostage, nearestHostage, toggleSilencer, toggleBurst, shieldActive, WEAPONS,
  };
  requestAnimationFrame((t) => { lastT = t; frame(t); });
  // the people (models, textures, motion clips) decode before the menu unlocks
  load.textContent = '正在加载人物模型…';
  Avatars.load().then(() => {
    load.classList.add('hidden');
    if (qs.get('autostart')) {
      const tq = qs.get('team');
      startMatch(tq === 'ct' ? CT : tq === 't' ? T : null, qs.get('skin') != null ? clamp(Number(qs.get('skin')) || 0, 0, 3) : null);
    }
  }).catch((e) => {
    console.error(e);
    load.textContent = '人物模型加载失败，请刷新页面重试。';
    load.classList.add('err');
  });
}
boot();
