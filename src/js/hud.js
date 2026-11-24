'use strict';
/* =========================================================
   hud.js — old-school HUD: amber corner numbers, a rotating
   round radar, kill feed, radio chat, the buy panel (mouse or
   number keys), radio text menus, scoreboard, round messages.
   ========================================================= */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SIDE_CLS = ['ct', 't'];
const WIN_TEXT = {
  elim: (w) => [`${SIDE_LABEL[w]}获胜！`, '敌方全部倒下'],
  bomb: () => ['目标已被摧毁', '匪方获胜'],
  defuse: () => ['炸弹已被拆除', '警方获胜'],
  time: () => (G.mode === 'hostage' ? ['人质没有被救出', '匪方获胜'] : ['目标保住了', '警方获胜']),
  rescue: () => ['人质营救成功', '警方获胜'],
};
const HISTORY_MARK = { elim: '✕', bomb: 'B', defuse: 'D', time: 'T', rescue: 'H' };

function buyBlockReason(p) {
  if (!p.alive) return '你已经阵亡了';
  if (G.phase === 'post') return '回合已经结束';
  if (G.phase === 'live' && G.time - G.liveStart >= BUY_WINDOW) return `购买时间已过（每回合开始后 ${BUY_WINDOW} 秒内）`;
  if (G.phase === 'live' || G.phase === 'planted') return '你不在购买区，回到出生点附近才能购买';
  return '现在不能购买';
}

const HUD = {
  E: {}, last: {}, kf: [], chatLines: [], bannerT: 0, hintHtml: null, hitT: 0, dmgV: 0, popT: 0, noticeT: 0,
  moneyT: 0, lastMoney: null, slotsT: 0, sbOpen: false, sbT: 0, radarBase: {}, radarT: 0,
  menu: null, menuRows: [],

  init() {
    const ids = ['hud', 'radar', 'radar-site', 'sc-ct', 'sc-mid', 'sc-t', 'c-host', 'killfeed', 'chat', 'crosshair', 'hitmarker', 'dmg-ring',
      'banner', 'banner-big', 'banner-small', 'hint', 'notice', 'progress', 'progress-label', 'progress-fill', 'bomb-carry',
      'c-vitals', 'c-hp', 'hp', 'armor', 'c-helm', 'c-time', 'timer', 'c-pop', 'c-slots', 'c-money', 'money', 'c-ammo', 'mag', 'reserve', 'c-mode',
      'spectate', 'tmenu', 'scoreboard', 'sb-card', 'fx-flash', 'fx-smoke', 'fx-damage', 'fx-dead', 'scope'];
    for (const id of ids) this.E[id] = $(id);
    this.ch = { t: this.E.crosshair.querySelector('.ch-t'), b: this.E.crosshair.querySelector('.ch-b'), l: this.E.crosshair.querySelector('.ch-l'), r: this.E.crosshair.querySelector('.ch-r') };
    this.radarBase.bomb = this.buildRadarBase('bomb');
    this.radarBase.hostage = this.buildRadarBase('hostage');
    // rows can also be clicked or tapped (touch screens, or when the mouse is not locked)
    this.E.tmenu.addEventListener('click', (e) => {
      const row = e.target.closest('.tm-row');
      if (row && row.dataset.k != null) { e.stopPropagation(); this.menuKey(Number(row.dataset.k)); }
    });
    Shop.init();
  },
  show(v) { this.E.hud.classList.toggle('hidden', !v); },
  set(id, text) { if (this.last[id] !== text) { this.last[id] = text; this.E[id].textContent = text; } },
  cls(id, name, on) { const k = id + '.' + name; if (this.last[k] !== on) { this.last[k] = on; this.E[id].classList.toggle(name, on); } },
  reset() {
    this.closeMenu();
    Shop.hide('reset');
    for (const k of this.kf) k.el.remove();
    for (const c of this.chatLines) c.el.remove();
    this.kf = []; this.chatLines = [];
    this.E.banner.className = ''; this.bannerT = 0;
    this.E.notice.classList.remove('show'); this.noticeT = 0;
    this.E['c-pop'].classList.remove('show'); this.popT = 0;
    this.E['dmg-ring'].innerHTML = '';
    this.last = {}; this.lastMoney = null; this.slotsT = 0; this.dmgV = 0; this.hintHtml = null;
    this.E.hint.classList.remove('show');
    this.showScoreboard(false);
  },

  // ---------------------------------------------------------------- per-frame
  update(dt) {
    if (G.state !== 'playing' || !G.player) return;
    const p = G.player, E = this.E;

    // top centre: score, round, hostages
    this.set('sc-ct', String(G.teams[CT].score));
    this.set('sc-t', String(G.teams[T].score));
    this.set('sc-mid', `第 ${G.round} 回合` + (G.winLimit ? ` · 先胜 ${G.winLimit}` : ''));
    this.cls('c-host', 'hidden', G.mode !== 'hostage');
    if (G.mode === 'hostage') {
      const key = G.hostages.map((h) => (h.rescued ? 's' : !h.alive ? 'd' : h.leader ? 'l' : 'w')).join('');
      if (this.last.host !== key) {
        this.last.host = key;
        const cl = { s: 'safe', d: 'dead', l: 'led', w: 'wait' }, tip = { s: '已获救', d: '已死亡', l: '正被带走', w: '等待营救' };
        E['c-host'].innerHTML = [...key].map((c) => `<i class="${cl[c]}" title="${tip[c]}">人</i>`).join('');
      }
    }

    // round timer; once the bomb is down the clock is replaced by a flashing C4 tag
    if (G.phase !== 'post') this.set('timer', fmtTime(G.phaseT));
    this.cls('c-time', 'urgent', G.phase === 'live' && G.phaseT < 20);
    this.cls('c-time', 'bomb', G.bomb.state === 'planted');

    // health, armour
    this.cls('c-vitals', 'hidden', !p.alive);
    this.set('hp', String(Math.max(0, p.hp)));
    this.cls('c-hp', 'low', p.alive && p.hp <= 25);
    this.set('armor', String(p.armor));
    this.cls('c-helm', 'hidden', !p.helmet);

    // money flashes green when it goes up, red when it goes down
    if (this.lastMoney !== p.money) {
      if (this.lastMoney != null) {
        const up = p.money > this.lastMoney;
        this.cls('c-money', 'gain', up); this.cls('c-money', 'spend', !up);
        this.moneyT = 0.9;
      }
      this.lastMoney = p.money;
      this.set('money', String(p.money));
    }
    if (this.moneyT > 0) { this.moneyT -= dt; if (this.moneyT <= 0) { this.cls('c-money', 'gain', false); this.cls('c-money', 'spend', false); } }

    // ammo and fire mode
    const w = p.alive ? curWeapon(p) : null;
    const inst = p.alive ? curGun(p) : null;
    if (inst && w.mag) {
      this.set('mag', String(inst.mag)); this.set('reserve', String(inst.reserve));
      this.cls('c-ammo', 'low', inst.mag <= Math.ceil(w.mag * 0.2));
      this.cls('c-ammo', 'single', false);
      this.cls('c-ammo', 'hidden', false);
    } else if (w && w.kind === 'grenade') {
      this.set('mag', String(p.inv[p.nade]));
      this.cls('c-ammo', 'low', false);
      this.cls('c-ammo', 'single', true);
      this.cls('c-ammo', 'hidden', false);
    } else this.cls('c-ammo', 'hidden', true);
    let mode = '';
    if (w) {
      mode = w.name;
      if (inst) {
        if (p.silT > 0) mode += p.silTo ? ' · 正在装消音器' : ' · 正在卸消音器';
        else if (inst.sil || w.integralSil) mode += ' · 消音';
        if (w.burst) mode += inst.burst ? ' · 三连发' : (w.auto ? ' · 全自动' : ' · 单发');
        if (w.zoom && p.scope) mode += ` · ${p.scope} 级瞄准`;
        if (p.reloadT > 0) mode += ' · 换弹中';
      }
      if (shieldActive(p)) mode += p.shieldOpen ? ' · 盾牌放低（可开火）' : ' · 盾牌举起（防御）';
      else if (w.kind === 'grenade') mode += ' · 右键近抛';
      else if (w.kind === 'knife') mode += ' · 右键重击';
    }
    this.set('c-mode', mode);

    // weapon list pops up for a moment whenever the selection or inventory changes
    const sk = [p.alive, p.slot, p.nade, p.inv.primary && p.inv.primary.id, p.inv.secondary && p.inv.secondary.id, p.inv.he, p.inv.flash, p.inv.smoke, p.hasBomb, p.inv.shield].join('|');
    if (sk !== this.last.slots) {
      const first = this.last.slots == null;
      this.last.slots = sk;
      this.renderSlots(p);
      if (!first && p.alive && G.phase !== 'post') this.slotsT = 1.8;
    }
    if (this.slotsT > 0) this.slotsT -= dt;
    this.cls('c-slots', 'show', this.slotsT > 0 && p.alive);

    // crosshair, hit marker and screen effects
    this.updateCrosshair(p, w, inst);
    if (this.hitT > 0) { this.hitT -= dt; E.hitmarker.style.opacity = String(clamp(this.hitT / 0.12, 0, 1)); }
    this.dmgV = Math.max(0, this.dmgV - dt * 1.3);
    const lowPulse = p.alive && p.hp < 25 ? 0.22 + 0.08 * Math.sin(G.time * 5) : 0;
    E['fx-damage'].style.opacity = String(Math.min(0.9, this.dmgV + lowPulse));
    E['fx-flash'].style.opacity = String(p.alive ? clamp(p.blind / 1.3, 0, 1) : 0);
    let smoke = 0;
    const cp = R.camera.position;
    for (const s of G.smokes) {
      const age = G.time - s.born;
      const fade = age < 1 ? age : age > s.life - 2 ? Math.max(0, (s.life - age) / 2) : 1;
      const d = Math.hypot(cp.x - s.x, (cp.y - s.y) * 0.75, cp.z - s.z) / (s.r * Math.min(1, 0.35 + age / 1.4));
      if (d < 1) smoke = Math.max(smoke, clamp((1 - d) * 2.2, 0, 0.93) * fade);
    }
    E['fx-smoke'].style.opacity = String(smoke);
    E['fx-dead'].style.opacity = !p.alive && G.deathCamT > 0 ? '1' : '0';
    this.cls('scope', 'hidden', !(p.alive && p.scope > 0 && w && w.overlay));

    // timed messages
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) E.banner.classList.remove('show'); }
    if (this.noticeT > 0) { this.noticeT -= dt; if (this.noticeT <= 0) E.notice.classList.remove('show'); }
    if (this.popT > 0) { this.popT -= dt; if (this.popT <= 0) E['c-pop'].classList.remove('show'); }
    for (let i = this.kf.length - 1; i >= 0; i--) {
      const k = this.kf[i];
      k.t -= dt;
      if (k.t < 0.5) k.el.style.opacity = String(Math.max(0, k.t / 0.5));
      if (k.t <= 0) { k.el.remove(); this.kf.splice(i, 1); }
    }
    for (let i = this.chatLines.length - 1; i >= 0; i--) {
      const c = this.chatLines[i];
      c.t -= dt;
      if (c.t < 0.6) c.el.style.opacity = String(Math.max(0, c.t / 0.6));
      if (c.t <= 0) { c.el.remove(); this.chatLines.splice(i, 1); }
    }

    // plant / defuse progress
    if (p.action) {
      this.cls('progress', 'hidden', false);
      this.set('progress-label', p.action.type === 'plant' ? '正在安放炸弹' : (p.kit ? '正在拆除炸弹 · 拆弹器' : '正在拆除炸弹'));
      E['progress-fill'].style.width = (100 * p.action.t / p.action.total).toFixed(1) + '%';
    } else this.cls('progress', 'hidden', true);
    this.cls('bomb-carry', 'hidden', !(p.alive && p.hasBomb && G.phase !== 'post'));

    if (!p.alive) {
      let html;
      if (G.deathCamT > 0 && G.killer) {
        const k = G.killer, kw = curWeapon(k);
        html = `你被 <span class="c-enemy">${esc(k.name)}</span> 击杀<small>${kw ? esc(kw.name) + ' · ' : ''}对方剩余 ${Math.max(0, k.hp)} 生命值</small>`;
      } else if (G.specTarget) {
        const s = G.specTarget;
        html = `正在观察 <span class="${s.team === p.team ? 'c-ally' : 'c-enemy'}">${esc(s.name)}</span><small>${s.hp} 生命值 · ${IS_TOUCH ? '点屏幕' : '点击鼠标或按空格'}切换</small>`;
      } else html = '等待下一回合';
      if (this.last.spec !== html) { this.last.spec = html; E.spectate.innerHTML = html; }
      this.cls('spectate', 'hidden', false);
    } else this.cls('spectate', 'hidden', true);

    let place = '';
    if (p.alive) {
      const zone = G.mode === 'bomb' ? inSiteZone(p.pos.x, p.pos.z) : null;
      if (zone) place = `${zone} 包点`;
      else if (G.mode === 'hostage' && inRescueZone(p.pos.x, p.pos.z)) place = p.team === CT ? '营救区' : '警方营救区';
      if (canBuyNow(p) && G.phase !== 'freeze') place = place ? place + ' · 购买区' : '购买区';
    }
    this.set('radar-site', place);

    this.radarT -= dt;
    if (this.radarT <= 0) { this.radarT = 1 / 30; this.drawRadar(); }

    // open menus follow the game state
    if (this.menu && !p.alive) this.closeMenu();
    Shop.update(dt);
    if (this.sbOpen) { this.sbT -= dt; if (this.sbT <= 0) { this.sbT = 0.5; this.renderScoreboard(); } }
  },

  renderSlots(p) {
    if (!p.alive) { this.E['c-slots'].innerHTML = ''; return; }
    const row = (slot, key, label) => `<div class="s${p.slot === slot ? ' on' : ''}">${esc(label)}<b>${key}</b></div>`;
    const sh = p.inv.shield ? ' + 防爆盾' : '';
    let h = '';
    if (p.inv.primary) h += row('primary', 1, WEAPONS[p.inv.primary.id].name);
    if (p.inv.secondary) h += row('secondary', 2, WEAPONS[p.inv.secondary.id].name + sh);
    h += row('knife', 3, '战术匕首' + sh);
    const n = NADE_ORDER.filter((k) => p.inv[k] > 0).map((k) => WEAPONS[k].name + (p.inv[k] > 1 ? ' ×' + p.inv[k] : '')).join(' / ');
    if (n) h += row('grenade', 4, n);
    if (p.hasBomb) h += row('bomb', 5, '炸弹');
    this.E['c-slots'].innerHTML = h;
  },

  updateCrosshair(p, w, inst) {
    // like the old games: sniper rifles have no crosshair unless scoped (and then the scope draws one)
    const show = p.alive && !!w && w.kind !== 'sniper';
    this.cls('crosshair', 'hidden', !show);
    if (!show) return;
    let gap = 4;
    if (w.mag) {
      const spread = calcSpread(p, w, inst);
      const px = Math.tan(spread) * (R.height / 2) / Math.tan(R.camera.fov * DEG / 2);
      gap = clamp(3 + px * 0.85, 3, 64);
    }
    const g = Math.round(gap);
    if (this.last.gap === g) return;
    this.last.gap = g;
    this.ch.t.style.top = -(g + 8) + 'px'; this.ch.b.style.top = g + 'px';
    this.ch.l.style.left = -(g + 8) + 'px'; this.ch.r.style.left = g + 'px';
  },

  // ---------------------------------------------------------------- events
  banner(big, small, dur, cls) {
    this.E['banner-big'].textContent = big;
    this.E['banner-small'].textContent = small || '';
    this.E.banner.className = 'show ' + (cls || '');
    this.bannerT = dur || 2;
  },
  hint(html) {
    if (this.hintHtml === html) return;
    this.hintHtml = html;
    if (html) this.E.hint.innerHTML = html;
    this.E.hint.classList.toggle('show', !!html);
  },
  notice(text, dur) {
    this.E.notice.textContent = text;
    this.E.notice.classList.add('show');
    this.noticeT = dur || 2.4;
  },
  chat(a, text) {
    const div = document.createElement('div');
    div.className = 'ln';
    div.innerHTML = `<span class="tag">(无线电)</span><span class="who">${esc(a === G.player ? '你' : a.name)}</span>：${esc(text)}`;
    this.E.chat.appendChild(div);
    this.chatLines.push({ el: div, t: 7 });
    while (this.chatLines.length > (IS_TOUCH ? 3 : 5)) this.chatLines.shift().el.remove();
  },
  hitmarker(head) { this.E.hitmarker.className = head ? 'head' : ''; this.hitT = 0.22; },
  damage(from, amt) {
    this.dmgV = Math.min(0.85, this.dmgV + 0.22 + amt / 140);
    const p = G.player;
    if (!from || !p) return;
    const ang = angleDiff(p.yaw, yawTo(from.x - p.pos.x, from.z - p.pos.z));
    const arc = document.createElement('div');
    arc.className = 'arc';
    arc.style.transform = `rotate(${(-ang / DEG).toFixed(1)}deg)`;
    this.E['dmg-ring'].appendChild(arc);
    setTimeout(() => { arc.style.opacity = '0'; }, 60);
    setTimeout(() => arc.remove(), 1100);
  },
  moneyPop(amt) {
    const el = this.E['c-pop'];
    el.textContent = (amt >= 0 ? '+$' : '-$') + Math.abs(amt);
    el.classList.toggle('neg', amt < 0);
    el.classList.add('show');
    this.popT = 1.6;
  },
  killfeed(att, vic, wid, head) {
    const p = G.player;
    const c = (a) => (a.isHostage ? 'c-host' : a.team === p.team ? 'c-ally' : 'c-enemy');
    const wname = wid === 'bombx' ? '炸弹' : wid === 'he' ? '手雷' : WEAPONS[wid] ? WEAPONS[wid].name.split(' ')[0] : wid;
    let html = '';
    if (att && att !== vic) html += `<span class="${c(att)}">${esc(att.name)}</span>`;
    html += `<span class="w">${esc(wname)}</span>`;
    if (head) html += '<span class="hs">爆头</span>';
    html += `<span class="${c(vic)}">${esc(vic.name)}</span>`;
    const div = document.createElement('div');
    div.className = 'kf' + (att === p || vic === p ? ' mine' : '');
    div.innerHTML = html;
    this.E.killfeed.appendChild(div);
    this.kf.push({ el: div, t: 6 });
    while (this.kf.length > 6) { const o = this.kf.shift(); o.el.remove(); }
  },
  roundStart() {
    const p = G.player;
    const how = IS_TOUCH ? '点「购买」' : '按 B';
    this.banner(`第 ${G.round} 回合`, `${SIDE_LABEL[p.team]} · ${TEAM_NAMES[p.team]} · ${how}购买装备`, 2.4, SIDE_CLS[p.team]);
    this.hint('');
  },
  roundEnd(winTeam, reason) {
    const p = G.player;
    const [big, sub] = WIN_TEXT[reason](winTeam);
    let small = sub;
    if (G.matchOver) small += ` · ${TEAM_NAMES[winTeam]}赢得了比赛`;
    this.banner(big, small, 4.8, SIDE_CLS[winTeam]);
    SFX.stinger(winTeam === p.team ? 'win' : 'lose');
  },

  // ---------------------------------------------------------------- radar
  buildRadarBase(mode) {
    const s = 8, c = document.createElement('canvas');
    c.width = World.W * s; c.height = World.H * s;
    const g = c.getContext('2d');
    const col = { '#': '#151b20', '%': '#1b1715', 'X': '#4c5963', 'x': '#5f6d77', 'C': '#7a6750', 'c': '#8d7859', '1': '#6b7174', '2': '#73797c', '3': '#7c8285', '.': '#454c51', ',': '#50575c' };
    for (let z = 0; z < World.H; z++) for (let x = 0; x < World.W; x++) { g.fillStyle = col[World.kindAt(x, z)] || '#000'; g.fillRect(x * s, z * s, s, s); }
    g.font = 'bold 34px "Chakra Petch", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (mode === 'bomb') {
      for (const k in SITES) {
        const st = SITES[k];
        g.fillStyle = 'rgba(242,163,58,0.2)';
        g.fillRect(st.x0 * s, st.z0 * s, (st.x1 - st.x0 + 1) * s, (st.z1 - st.z0 + 1) * s);
        g.fillStyle = 'rgba(242,163,58,0.9)';
        g.fillText(k, (st.center[0] + 0.5) * s, (st.center[1] + 0.5) * s);
      }
    } else {
      // the whole southern strip is the police rescue zone
      g.fillStyle = 'rgba(120,220,120,0.2)';
      g.fillRect(0, 27 * s, World.W * s, (World.H - 27) * s);
    }
    return c;
  },
  drawRadar() {
    const cv = this.E.radar, p = G.player;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (!w || !h) return;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'), u = dpr, Rr = w / 2;
    // centred on whoever the camera follows, rotated so their facing points up
    const ctr = p.alive ? p : (G.specTarget && G.deathCamT <= 0 ? G.specTarget : p);
    const cx = ctr.pos.x, cz = ctr.pos.z, yaw = ctr.yaw;
    const k = (Rr - 2 * u) / 36;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const edge = Rr - 5 * u;
    const toS = (x, z, keep) => {
      const dx = (x - cx) * k, dz = (z - cz) * k;
      let sx = dx * cs - dz * sn, sy = dx * sn + dz * cs;
      const d = Math.hypot(sx, sy);
      if (d > edge) { if (!keep) return null; sx *= edge / d; sy *= edge / d; }
      return [Rr + sx, Rr + sy];
    };
    g.clearRect(0, 0, w, h);
    g.save();
    g.beginPath(); g.arc(Rr, Rr, Rr - u, 0, TAU); g.closePath();
    g.fillStyle = 'rgba(6,10,12,0.55)'; g.fill();
    g.clip();
    g.save();
    g.translate(Rr, Rr); g.rotate(yaw); g.scale(k, k); g.translate(-cx, -cz);
    g.globalAlpha = 0.62;
    g.drawImage(this.radarBase[G.mode] || this.radarBase.bomb, 0, 0, World.W * CELL, World.H * CELL);
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(205,205,200,0.5)';
    for (const s of G.smokes) { g.beginPath(); g.arc(s.x, s.z, s.r, 0, TAU); g.fill(); }
    g.restore();
    // cross hairs and the view cone
    g.strokeStyle = 'rgba(244,173,63,0.2)'; g.lineWidth = u;
    g.beginPath(); g.moveTo(Rr, 0); g.lineTo(Rr, h); g.moveTo(0, Rr); g.lineTo(w, Rr); g.stroke();
    const hh = Math.atan(Math.tan(R.camera.fov * DEG / 2) * R.camera.aspect);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.beginPath(); g.moveTo(Rr, Rr); g.arc(Rr, Rr, Rr, -Math.PI / 2 - hh, -Math.PI / 2 + hh); g.closePath(); g.fill();

    const dot = (s, color, r) => { g.fillStyle = color; g.beginPath(); g.arc(s[0], s[1], r * u, 0, TAU); g.fill(); };
    // hostages are known to everybody
    for (const hs of G.hostages) {
      if (!hs.alive || hs.rescued) continue;
      const s = toS(hs.pos.x, hs.pos.z, true);
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = u;
      dot(s, hs.leader ? '#f4ad3f' : '#f2efe8', 3.4);
      g.stroke();
    }
    // bomb: planted for everyone, dropped only for the side that can pick it up
    const b = G.bomb;
    if (b.state === 'planted' || (b.state === 'dropped' && sideOf(p.team) === 'atk')) {
      const s = toS(b.pos.x, b.pos.z, true);
      const on = b.state !== 'planted' || Math.sin(G.time * 10) > 0;
      g.fillStyle = on ? '#ff5b4a' : '#f2a33a';
      g.fillRect(s[0] - 4 * u, s[1] - 4 * u, 8 * u, 8 * u);
    }
    const seen = G.spotted[p.team];
    for (const a of G.agents) {
      if (a === ctr) continue;
      const mate = a.team === p.team;
      let x = a.pos.x, z = a.pos.z, alpha = 1;
      if (!mate) {
        const sp = seen.get(a.id);
        if (!sp || !a.alive) continue;
        const age = G.time - sp.t;
        if (age > 4) continue;
        if (age > 0.4) { x = sp.x; z = sp.z; alpha = clamp(1 - (age - 0.4) / 3.6, 0, 1) * 0.7; }
      }
      const s = toS(x, z, false);
      if (!s) continue;
      if (mate && !a.alive) {
        g.strokeStyle = 'rgba(94,196,255,0.5)'; g.lineWidth = 1.5 * u;
        const r = 3 * u;
        g.beginPath(); g.moveTo(s[0] - r, s[1] - r); g.lineTo(s[0] + r, s[1] + r); g.moveTo(s[0] + r, s[1] - r); g.lineTo(s[0] - r, s[1] + r); g.stroke();
        continue;
      }
      g.globalAlpha = alpha;
      dot(s, mate ? '#5ec4ff' : '#ff5b4a', 3.4);
      if (mate && a.hasBomb) { g.strokeStyle = '#f2a33a'; g.lineWidth = 1.5 * u; g.beginPath(); g.arc(s[0], s[1], 6 * u, 0, TAU); g.stroke(); }
      g.globalAlpha = 1;
    }
    g.restore();
    // rim and the centre marker (you, or whoever you are watching)
    g.strokeStyle = 'rgba(244,173,63,0.6)'; g.lineWidth = 1.5 * u;
    g.beginPath(); g.arc(Rr, Rr, Rr - u, 0, TAU); g.stroke();
    g.fillStyle = ctr === p ? '#ffffff' : (ctr.team === p.team ? '#5ec4ff' : '#ff5b4a');
    g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = u;
    g.beginPath(); g.moveTo(Rr, Rr - 7 * u); g.lineTo(Rr + 4.5 * u, Rr + 5 * u); g.lineTo(Rr, Rr + 2.5 * u); g.lineTo(Rr - 4.5 * u, Rr + 5 * u); g.closePath();
    g.fill(); g.stroke();
  },

  // ---------------------------------------------------------------- radio text menus (Z / X / C)
  openMenu(kind, arg) {
    if (kind === 'buy') return Shop.show();
    const p = G.player;
    if (!p || G.state !== 'playing' || !p.alive) return false;
    Shop.hide('swap');
    this.menu = { kind: 'radio', key: arg };
    this.renderMenu();
    this.E.tmenu.classList.remove('hidden');
    document.body.classList.add('menuopen');
    SFX.ui('click');
    return true;
  },
  closeMenu() {
    if (!this.menu) return;
    this.menu = null;
    this.E.tmenu.classList.add('hidden');
    document.body.classList.remove('menuopen');
  },
  toggleMenu(kind, arg) {
    if (kind === 'buy') { Shop.toggle(); return; }
    const m = this.menu;
    if (m && m.key === arg) { this.closeMenu(); return; }
    this.openMenu(kind, arg);
  },
  renderMenu() {
    const m = this.menu;
    if (!m) return;
    const R_ = RADIO[m.key];
    const rows = R_.items.map(([text, cmd], j) => ({ k: j + 1, label: text, act: () => { this.closeMenu(); Radio.command(text, cmd); } }));
    rows.push({ k: 0, label: '退出', sep: true, act: () => this.closeMenu() });
    this.menuRows = rows;
    this.E.tmenu.innerHTML = `<div class="tm-title"><span>${esc(R_.title)}</span></div>` +
      rows.map((r) => `<div class="tm-row${r.sep ? ' sep' : ''}" data-k="${r.k}" role="menuitem"><b>${r.k}</b><span class="lbl">${esc(r.label)}</span></div>`).join('') +
      '<div class="tm-foot">队友会照你的指令行动</div>';
  },
  menuKey(n) {
    if (!this.menu) return false;
    const r = this.menuRows.find((x) => x.k === n);
    if (!r) return false;
    r.act();
    return true;
  },
  quickAmmo(which) {
    const p = G.player;
    if (!p || !p.alive) return;
    if (!canBuyNow(p)) { SFX.ui('deny'); this.notice(buyBlockReason(p)); return; }
    Shop.ammo(which);
  },

  // ---------------------------------------------------------------- scoreboard
  showScoreboard(v) {
    if (v === this.sbOpen) return;
    this.sbOpen = v;
    this.E.scoreboard.classList.toggle('hidden', !v);
    if (v) { this.sbT = 0.5; this.renderScoreboard(); }
  },
  renderScoreboard() {
    const p = G.player;
    if (!p) return;
    const block = (t) => {
      const TT = G.teams[t], mine = t === p.team;
      const rows = G.agents.filter((a) => a.team === t).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      const alive = rows.filter((a) => a.alive).length;
      const tr = rows.map((a) => {
        const tags = [!a.alive ? '阵亡' : '', mine && a.hasBomb ? '炸弹' : '', mine && a.kit ? '拆弹器' : '', mine && a.inv.shield ? '防爆盾' : ''].filter(Boolean).join(' ');
        return `<tr class="${a === p ? 'me' : ''}${a.alive ? '' : ' dead'}"><td>${esc(a.name)}${tags ? ` <small style="color:var(--amber)">${tags}</small>` : ''}</td>` +
          `<td>${a.kills}</td><td>${a.deaths}</td><td>${a.kills ? Math.round(a.hs / a.kills * 100) + '%' : '—'}</td><td>${a === p ? '0' : 'BOT'}</td></tr>`;
      }).join('');
      return `<div class="sb-team"><div class="sb-title" style="color:var(--${SIDE_CLS[t]})"><span>${SIDE_LABEL[t]} · ${esc(TT.name)} <small>${alive} / ${rows.length} 存活</small></span><span>${TT.score}</span></div>` +
        `<table class="sb-table"><thead><tr><th>名字</th><th>击杀</th><th>死亡</th><th>爆头率</th><th>延迟</th></tr></thead><tbody>${tr}</tbody></table></div>`;
    };
    const hist = G.history.map((h, i) => `<i title="第 ${i + 1} 回合" style="background:var(--${SIDE_CLS[h.winTeam]})">${HISTORY_MARK[h.reason] || '·'}</i>`).join('');
    this.E['sb-card'].innerHTML = `<div class="eyebrow">${MODE_NAME[G.mode]} · 第 ${G.round} 回合 · ${G.winLimit ? '先胜 ' + G.winLimit + ' 局' : '不限回合'}</div>${block(p.team)}${block(1 - p.team)}<div class="sb-rounds">${hist}</div>`;
  },
};

function showMatchOver() {
  G.state = 'over';
  setTouchVisible(false);
  if (document.pointerLockElement) document.exitPointerLock();
  HUD.closeMenu();
  HUD.show(false);
  HUD.showScoreboard(false);
  const p = G.player, my = G.teams[p.team].score, their = G.teams[1 - p.team].score;
  const res = my > their ? ['胜利', 'win'] : my < their ? ['失败', 'lose'] : ['平局', ''];
  $('mo-result').textContent = res[0];
  $('mo-result').className = 'result ' + res[1];
  $('mo-score').textContent = `${SIDE_LABEL[p.team]} ${my} : ${their} ${SIDE_LABEL[1 - p.team]}`;
  const best = G.agents.slice().sort((a, b) => b.kills - a.kills || b.dmgDone - a.dmgDone)[0];
  const stats = [
    [p.kills, '击杀'], [p.deaths, '死亡'], [p.kills ? Math.round(p.hs / p.kills * 100) + '%' : '—', '爆头率'], [p.dmgDone, '总伤害'],
  ];
  $('mo-stats').innerHTML = stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('') +
    `<div class="stat" style="grid-column:1/-1"><b style="font-size:18px">${esc(best.name)}</b><span>全场最佳 · ${best.kills} 杀 / ${best.dmgDone} 伤害</span></div>`;
  $('matchover').classList.remove('hidden');
  SFX.stinger(res[1] === 'lose' ? 'lose' : 'win');
}

// ---------------------------------------------------------------- the buy panel: click to buy, or the classic number keys
const SHOP_CATS = [0, 1, 2, 3, 4, 7]; // BUY_MENU entries that list items (6 and 7 are the ammo buttons)
const svgIcon = (body) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 84" fill="none" stroke="#c9c2b4" stroke-width="3" stroke-linejoin="round">${body}</svg>`);
const GEAR_ICONS = {
  kevlar: svgIcon('<path d="M78 10 q22 12 44 0 l14 8 v52 q-36 10 -72 0 v-52 z" fill="#3a4148"/><path d="M86 30 h28 M86 42 h28 M86 54 h28" stroke="#8d949b"/>'),
  helmet: svgIcon('<path d="M70 20 h40 l6 4 v40 q-27 10 -52 0 v-40 z" fill="#3a4148"/><path d="M118 20 q30 4 32 34 q-2 16 -24 20 l-12 -6" fill="#3a4148"/><path d="M60 52 q60 -40 98 6" fill="#4a535b"/>'),
  kit: svgIcon('<rect x="62" y="24" width="76" height="46" rx="6" fill="#3a4148"/><path d="M84 24 v-8 h32 v8 M76 47 h48 M100 34 v26" stroke="#e2b04a"/>'),
};
function itemIcon(id) {
  if (GEAR_ICONS[id]) return GEAR_ICONS[id];
  const W = 200, H = 84;
  const scene = new THREE.Scene();
  if (R.env) scene.environment = R.env;
  scene.add(new THREE.HemisphereLight(0xe8eef5, 0x5a5048, 0.95));
  const d = new THREE.DirectionalLight(0xffffff, 0.85); d.position.set(3, 4, 1); scene.add(d);
  const obj = id === 'shield' ? Models.shield() : WEAPONS[id].kind === 'grenade' ? Models.nadeMesh(id) : Models.gun(id);
  if (id === 'shield') obj.rotation.y = -Math.PI / 2; // show its face
  if (WEAPONS[id] && WEAPONS[id].kind === 'grenade') obj.scale.setScalar(2.2);
  scene.add(obj); obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  // side view from +X: the barrel (-Z) points right
  let hw = Math.max(sz.z, 0.05) / 2 * 1.12, hh = Math.max(sz.y, 0.05) / 2 * 1.12;
  if (hw / hh > W / H) hh = hw / (W / H); else hw = hh * (W / H);
  const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.01, 50);
  cam.position.set(c.x + 5, c.y, c.z); cam.lookAt(c);
  return R.snapshot(scene, cam, W, H, 2);
}
function statBars(w) {
  const pct = (v) => Math.round(clamp(v, 0.06, 1) * 100);
  const dmg = pct(w.dmg * (w.pellets || 1) / 130), rate = pct((1 / w.rof) / 14), acc = pct(1 - (w.spread + (w.unscoped || 0) * 0.5) / 0.03);
  const bar = (label, v) => `<span class="st"><i>${label}</i><em><u style="width:${v}%"></u></em></span>`;
  return bar('伤害', dmg) + bar('射速', rate) + bar('精准', acc);
}
function weaponTags(w) {
  const t = [];
  if (w.team === 'ct') t.push('警方专用'); else if (w.team === 't') t.push('匪方专用');
  if (w.sil) t.push('可装消音器'); if (w.integralSil) t.push('自带消音'); if (w.burst) t.push('三连发');
  if (w.dual) t.push('双持'); if (w.overlay) t.push('狙击镜'); else if (w.zoom) t.push('瞄准镜');
  if (w.mag) t.push(`弹匣 ${w.mag}`);
  return t.join(' · ');
}

const Shop = {
  open: false, cat: null, level: 'cat', icons: {}, released: false, renderT: 0, lastKey: '', status: '', statusT: 0, bought: null, boughtT: 0,
  init() {
    this.el = $('shop'); this.catsEl = $('shop-cats'); this.gridEl = $('shop-grid'); this.ammoEl = $('shop-ammo');
    this.loadEl = $('shop-load'); this.moneyEl = $('shop-money'); this.timeEl = $('shop-time'); this.statusEl = $('shop-status');
    this.el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (!t) { if (e.target === this.el) this.hide('user'); return; }
      const act = t.dataset.act, v = t.dataset.v;
      if (act === 'cat') { this.cat = Number(v); this.level = 'item'; SFX.ui('click'); this.render(true); }
      else if (act === 'buy') this.buy(v);
      else if (act === 'ammo') this.ammo(Number(v));
      else if (act === 'close') this.hide('user');
    });
  },
  items(cat, team) { return BUY_MENU[cat].items.filter((id) => teamAllows(WEAPONS[id] || EQUIP[id], team) && (id !== 'kit' || G.mode === 'bomb')); },
  ensureIcons() {
    for (const c of SHOP_CATS) for (const id of BUY_MENU[c].items) if (!this.icons[id]) this.icons[id] = itemIcon(id);
  },
  toggle() { if (this.open) this.hide('user'); else this.show(); },
  show() {
    const p = G.player;
    if (!p || G.state !== 'playing' || !p.alive || G.paused) return false;
    if (!canBuyNow(p)) { HUD.notice(buyBlockReason(p)); SFX.ui('deny'); return false; }
    HUD.closeMenu();
    this.open = true; this.level = 'cat'; this.status = ''; this.bought = null;
    if (this.cat == null) this.cat = p.money >= 2000 ? 3 : 0;
    this.ensureIcons();
    this.el.classList.remove('hidden');
    document.body.classList.add('shopopen');
    this.render(true);
    // free the mouse so items can be clicked; the game keeps running behind the panel
    if (document.pointerLockElement) { this.released = true; document.exitPointerLock(); }
    SFX.ui('click');
    return true;
  },
  // how: 'user' (a click or a key that may re-capture the mouse), 'esc', 'auto' (buy time over, died) or 'swap'
  hide(how) {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
    document.body.classList.remove('shopopen');
    if (this.released && how !== 'reset' && G.state === 'playing' && !G.paused && !Input.noLock && !IS_TOUCH) {
      if (how === 'user' || how === 'swap') requestLock();
      else $('clicklock').classList.remove('hidden');
    }
    this.released = false;
  },
  update(dt) {
    if (!this.open) return;
    const p = G.player;
    if (!p || !p.alive || !canBuyNow(p)) { this.hide('auto'); return; }
    if (this.statusT > 0) { this.statusT -= dt; if (this.statusT <= 0) this.status = ''; }
    if (this.boughtT > 0) { this.boughtT -= dt; if (this.boughtT <= 0) this.bought = null; }
    this.renderT -= dt;
    if (this.renderT <= 0) { this.renderT = 0.25; this.render(); }
  },
  // number keys: a category first (6 / 7 buy ammo), then an item; 0 steps back or closes
  key(n) {
    const p = G.player;
    if (this.level === 'cat') {
      if (n === 0) { this.hide('user'); return; }
      if (n === 6 || n === 7) { this.ammo(n === 6 ? 1 : 2); return; }
      if (SHOP_CATS.includes(n - 1)) { this.cat = n - 1; this.level = 'item'; SFX.ui('click'); this.render(true); }
      return;
    }
    if (n === 0) { this.level = 'cat'; SFX.ui('click'); this.render(true); return; }
    const id = this.items(this.cat, p.team)[n - 1];
    if (id) this.buy(id);
  },
  say(text) { this.status = text; this.statusT = 2.2; },
  buy(id) {
    const p = G.player, err = buyItem(p, id);
    if (err) { SFX.ui('deny'); this.say(err); }
    else {
      SFX.ui('buy');
      this.bought = id; this.boughtT = 0.6;
      const info = WEAPONS[id] || EQUIP[id];
      this.say(id === 'shield' ? '已购买防爆盾：右键举盾挡子弹，举盾时不能开枪' : (WEAPONS[id] && WEAPONS[id].mag ? `已购买 ${info.name}，只带一个弹匣，记得买子弹` : `已购买 ${info.name}`));
    }
    this.render(true);
  },
  ammo(which) {
    const p = G.player, err = buyAmmo(p, which);
    if (err) { SFX.ui('deny'); this.say(err); if (!this.open) HUD.notice(err); }
    else { SFX.ui('buy'); const s = p.inv[which === 1 ? 'primary' : 'secondary']; this.say(`已购买子弹：${WEAPONS[s.id].name} 备弹 ${s.reserve}`); }
    if (this.open) this.render(true);
  },
  render(force) {
    const p = G.player;
    if (!p) return;
    const left = G.phase === 'freeze' ? G.phaseT + BUY_WINDOW : BUY_WINDOW - (G.time - G.liveStart);
    this.timeEl.textContent = `剩余购买时间 ${Math.max(0, Math.ceil(left))} 秒`;
    this.moneyEl.textContent = '$' + p.money;
    this.statusEl.textContent = this.status;
    // the rest only changes with money, inventory or selection
    const key = [p.money, this.cat, this.level, this.bought, p.team, p.armor, p.helmet, p.kit, p.inv.shield, p.inv.he, p.inv.flash, p.inv.smoke,
      p.inv.primary && p.inv.primary.id + p.inv.primary.reserve, p.inv.secondary && p.inv.secondary.id + p.inv.secondary.reserve].join('|');
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    const keys = !IS_TOUCH;
    this.catsEl.innerHTML = SHOP_CATS.map((i) => `<button type="button" class="shop-cat${i === this.cat ? ' on' : ''}" data-act="cat" data-v="${i}">${keys ? `<b>${i + 1}</b>` : ''}<span>${BUY_MENU[i].name}</span><small>${this.items(i, p.team).length}</small></button>`).join('');
    const items = this.items(this.cat, p.team);
    const lvl = this.level === 'item';
    this.gridEl.innerHTML = items.map((id, j) => {
      const w = WEAPONS[id], info = w || EQUIP[id];
      const price = itemPrice(p, id), own = itemOwned(p, id), poor = !own && p.money < price;
      let name = info.name;
      if (w && w.kind === 'grenade' && p.inv[id] > 0) name += ` ×${p.inv[id]}`;
      let sub = w && w.mag ? weaponTags(w) : (info.desc || '');
      if (w && w.slot === 'primary' && p.inv.shield) sub = '买主武器会丢掉防爆盾';
      if (id === 'shield' && p.inv.primary) sub = '买防爆盾会丢掉主武器 · 只能配手枪';
      return `<button type="button" class="shop-item${own ? ' own' : ''}${poor ? ' poor' : ''}${this.bought === id ? ' got' : ''}" data-act="buy" data-v="${id}">` +
        `${keys ? `<b class="k${lvl ? '' : ' dim'}">${j + 1}</b>` : ''}<img src="${this.icons[id] || ''}" alt="">` +
        `<span class="nm">${esc(name)}</span><span class="pr">${own ? '已拥有' : '$' + price}</span>` +
        `<span class="sub">${esc(sub)}</span>${w && w.mag ? `<span class="bars">${statBars(w)}</span>` : ''}</button>`;
    }).join('');
    const ammoBtn = (which) => {
      const s = p.inv[which === 1 ? 'primary' : 'secondary'], w = s && WEAPONS[s.id];
      const full = !!w && s.reserve >= w.reserveMax, off = !w || full || p.money < w.ammoPrice;
      const label = which === 1 ? '主武器子弹' : '副武器子弹';
      return `<button type="button" class="shop-ammo-btn${off ? ' poor' : ''}" data-act="ammo" data-v="${which}">${keys ? `<b>${which === 1 ? '6' : '7'}</b>` : ''}<span>${label}<small>${w ? `${esc(w.name)} · 备弹 ${s.reserve}/${w.reserveMax}${full ? ' · 已满' : ` · 每次 ${w.ammoPer} 发`}` : '没有这把武器'}</small></span><em>${w ? '$' + w.ammoPrice : ''}</em></button>`;
    };
    this.ammoEl.innerHTML = ammoBtn(1) + ammoBtn(2);
    const nades = NADE_ORDER.filter((n) => p.inv[n] > 0).map((n) => WEAPONS[n].name + (p.inv[n] > 1 ? '×' + p.inv[n] : ''));
    const line = (k, v) => `<span><i>${k}</i>${v}</span>`;
    this.loadEl.innerHTML = line('主武器', p.inv.primary ? esc(WEAPONS[p.inv.primary.id].name) : (p.inv.shield ? '防爆盾' : '—')) +
      line('手枪', p.inv.secondary ? esc(WEAPONS[p.inv.secondary.id].name) : '—') +
      line('护甲', p.armor > 0 ? (p.helmet ? '防弹衣 + 头盔' : '防弹衣') : '—') +
      line('投掷物', nades.length ? nades.join(' ') : '—') + (p.kit ? line('拆弹器', '有') : '');
  },
};
