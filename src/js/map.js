'use strict';
/* =========================================================
   map.js — the "Dockyard" layout, collision, ray casts and
   grid navigation. Pure logic: no rendering, no THREE.
   World units are metres; one grid cell is CELL metres.
   x grows east (columns), z grows south (rows).
   ========================================================= */
const CELL = 2;
const STEP_H = 0.5;        // max ledge a walker climbs without jumping
const GRAVITY = 18;
const JUMP_V = 6.4;        // ~1.14 m jump apex: enough for 1 m crates
const MAP_W = 40, MAP_H = 34;

// solid heights by cell character
const SOLID_H = { '#': 6.5, '%': 8, 'X': 5.2, 'x': 2.6, 'C': 2.0, 'c': 1.0, '1': 0.45, '2': 0.9, '3': 1.35 };
const WALKABLE_CH = { '.': 1, ',': 1, '1': 1, '2': 1, '3': 1 };

const World = (function () {
  const W = MAP_W, H = MAP_H;
  const g = [];
  for (let z = 0; z < H; z++) g.push(new Array(W).fill('#'));
  const carve = (x0, z0, x1, z1, ch) => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) g[z][x] = ch; };
  const put = (ch, ...cells) => { for (const c of cells) g[c[1]][c[0]] = ch; };
  const paint = (x0, z0, x1, z1, ch) => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (g[z][x] === '#') g[z][x] = ch; };

  // --- open areas -------------------------------------------------------
  carve(15, 1, 24, 5, ',');     // defender spawn (north)
  carve(1, 1, 11, 10, '.');     // site A: container yard (north-west)
  carve(12, 2, 14, 3, '.');     // defender spawn -> A
  carve(29, 1, 38, 11, ',');    // site B: warehouse (north-east)
  carve(25, 3, 28, 4, ',');     // defender spawn -> B
  carve(18, 6, 21, 27, '.');    // mid
  carve(9, 13, 17, 15, '.');    // A short (from mid)
  carve(8, 11, 11, 12, '.');
  carve(1, 11, 4, 30, '.');     // A long
  carve(5, 28, 13, 30, '.');    // attacker west passage
  carve(14, 28, 25, 32, '.');   // attacker spawn (south)
  carve(26, 28, 34, 30, '.');   // attacker east passage
  carve(33, 12, 37, 30, ',');   // B main
  carve(22, 17, 32, 18, '.');   // mid -> B connector

  // --- cover and props ----------------------------------------------------
  put('X', [19, 2], [20, 2], [19, 3], [20, 3], [19, 4], [20, 4]);          // spawn container stack
  put('X', [5, 1], [6, 1], [7, 1]);                                        // A north stack
  put('x', [4, 5], [5, 5], [6, 5]);                                        // A container
  put('c', [8, 7], [2, 7], [9, 3]); put('C', [9, 7]);
  for (let z = 1; z <= 4; z++) for (let x = 35; x <= 38; x++) g[z][x] = '3'; // B loading dock
  put('2', [34, 1], [34, 2]); put('1', [33, 1], [33, 2]);                  // dock stairs
  put('x', [30, 7], [31, 7], [32, 7]);                                     // B container
  put('c', [36, 8], [30, 10]); put('C', [37, 8]);
  put('%', [33, 9]);                                                       // warehouse pillar
  put('#', [18, 11], [21, 11]);                                            // mid doors
  put('c', [21, 8], [18, 21]); put('C', [19, 24], [20, 24]);
  put('c', [13, 13], [10, 15]);                                            // A short
  put('c', [4, 14], [1, 19]); put('x', [3, 24], [3, 25]);                  // A long
  put('%', [33, 12], [37, 12]);                                            // B entrance
  put('c', [27, 18]);                                                      // connector
  put('x', [35, 20], [35, 21]); put('c', [33, 15], [37, 26]);              // B main
  put('c', [15, 32], [24, 31]);                                            // attacker spawn
  put('X', [9, 28], [9, 29]); put('X', [29, 29], [29, 30]);               // passage bends
  paint(28, 0, 39, 12, '%'); paint(32, 12, 39, 31, '%');                   // brick warehouse walls

  const N = W * H;
  const kinds = new Array(N);
  const heights = new Float32Array(N);
  const walk = new Uint8Array(N);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x, ch = g[z][x];
    kinds[i] = ch;
    heights[i] = SOLID_H[ch] || 0;
    walk[i] = WALKABLE_CH[ch] ? 1 : 0;
  }

  const inB = (cx, cz) => cx >= 0 && cz >= 0 && cx < W && cz < H;
  const cellH = (cx, cz) => (inB(cx, cz) ? heights[cz * W + cx] : 50);
  const kindAt = (cx, cz) => (inB(cx, cz) ? kinds[cz * W + cx] : '#');
  const walkable = (cx, cz) => inB(cx, cz) && walk[cz * W + cx] === 1;
  const toCell = (v) => Math.floor(v / CELL);
  const center = (c) => c * CELL + CELL / 2;
  const EPS = 1e-4;

  // ---------------------------------------------------------------- collision
  function boxBlocked(x, z, r, maxH) {
    const x0 = Math.floor((x - r + EPS) / CELL), x1 = Math.floor((x + r - EPS) / CELL);
    const z0 = Math.floor((z - r + EPS) / CELL), z1 = Math.floor((z + r - EPS) / CELL);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) if (cellH(cx, cz) > maxH) return true;
    return false;
  }
  function groundUnder(x, z, r, maxH) {
    const x0 = Math.floor((x - r + EPS) / CELL), x1 = Math.floor((x + r - EPS) / CELL);
    const z0 = Math.floor((z - r + EPS) / CELL), z1 = Math.floor((z + r - EPS) / CELL);
    let gmax = 0;
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const h = cellH(cx, cz);
      if (h <= maxH && h > gmax) gmax = h;
    }
    return gmax;
  }
  // Moves a body (pos {x,y,z}, r, onGround, airStep) with axis-separated sliding.
  function moveBody(b, dx, dz) {
    const p = b.pos, r = b.r;
    const maxH = p.y + (b.onGround ? STEP_H : (b.airStep || 0.05));
    let hitX = false, hitZ = false;
    if (dx !== 0) {
      const nx = p.x + dx;
      if (!boxBlocked(nx, p.z, r, maxH)) p.x = nx;
      else {
        hitX = true;
        if (dx > 0) { const edge = Math.floor((nx + r - EPS) / CELL) * CELL; p.x = Math.max(p.x, Math.min(nx, edge - r - 2 * EPS)); }
        else { const edge = (Math.floor((nx - r + EPS) / CELL) + 1) * CELL; p.x = Math.min(p.x, Math.max(nx, edge + r + 2 * EPS)); }
      }
    }
    if (dz !== 0) {
      const nz = p.z + dz;
      if (!boxBlocked(p.x, nz, r, maxH)) p.z = nz;
      else {
        hitZ = true;
        if (dz > 0) { const edge = Math.floor((nz + r - EPS) / CELL) * CELL; p.z = Math.max(p.z, Math.min(nz, edge - r - 2 * EPS)); }
        else { const edge = (Math.floor((nz - r + EPS) / CELL) + 1) * CELL; p.z = Math.min(p.z, Math.max(nz, edge + r + 2 * EPS)); }
      }
    }
    return { hitX, hitZ };
  }
  // Gravity, stepping and landing. Returns the impact speed when landing, else 0.
  function bodyVertical(b, dt) {
    const p = b.pos;
    const probe = b.onGround ? STEP_H : (b.airStep || 0.05);
    const gnd = groundUnder(p.x, p.z, b.r, p.y + probe);
    let impact = 0;
    if (b.onGround) {
      if (gnd < p.y - STEP_H - 0.01) { b.onGround = false; b.vy = 0; }
      else { p.y = gnd; b.vy = 0; }
    }
    if (!b.onGround) {
      b.vy -= GRAVITY * dt;
      p.y += b.vy * dt;
      if (p.y <= gnd) {
        impact = -b.vy;
        p.y = gnd; b.vy = 0; b.onGround = true;
      }
    }
    return impact;
  }

  // ---------------------------------------------------------------- ray casts
  // 3D DDA through the height grid. Returns {t, nx, ny, nz, cx, cz} or null.
  function raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const adx = Math.abs(dx), adz = Math.abs(dz);
    const tDX = adx > 1e-9 ? CELL / adx : Infinity;
    const tDZ = adz > 1e-9 ? CELL / adz : Infinity;
    let tMX = adx > 1e-9 ? ((dx > 0 ? (cx + 1) * CELL - ox : ox - cx * CELL) / adx) : Infinity;
    let tMZ = adz > 1e-9 ? ((dz > 0 ? (cz + 1) * CELL - oz : oz - cz * CELL) / adz) : Infinity;
    let tIn = 0, axis = -1;
    for (let guard = 0; guard < 512; guard++) {
      const h = cellH(cx, cz);
      const tOut = Math.min(tMX, tMZ, maxT);
      const yIn = oy + dy * tIn;
      if (yIn < h) {
        if (axis === 0) return { t: tIn, nx: -stepX, ny: 0, nz: 0, cx, cz };
        if (axis === 1) return { t: tIn, nx: 0, ny: 0, nz: -stepZ, cx, cz };
        return { t: 0, nx: 0, ny: 1, nz: 0, cx, cz };
      }
      if (dy < 0) {
        const yOut = oy + dy * tOut;
        if (yOut < h) return { t: Math.max(tIn, (h - oy) / dy), nx: 0, ny: 1, nz: 0, cx, cz };
      }
      if (tOut >= maxT) return null;
      if (dy >= 0 && yIn > 9) return null;
      if (tMX < tMZ) { cx += stepX; tIn = tMX; tMX += tDX; axis = 0; }
      else { cz += stepZ; tIn = tMZ; tMZ += tDZ; axis = 1; }
    }
    return null;
  }
  function losClear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) return true;
    return raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05) === null;
  }

  // ---------------------------------------------------------------- navigation
  const gS = new Float32Array(N), from = new Int32Array(N), state = new Uint8Array(N);
  const heapF = [], heapI = [];
  function hPush(f, i) {
    heapF.push(f); heapI.push(i);
    let k = heapF.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p] <= heapF[k]) break;
      [heapF[p], heapF[k]] = [heapF[k], heapF[p]]; [heapI[p], heapI[k]] = [heapI[k], heapI[p]];
      k = p;
    }
  }
  function hPop() {
    const top = heapI[0];
    const lf = heapF.pop(), li = heapI.pop();
    if (heapF.length) {
      heapF[0] = lf; heapI[0] = li;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < heapF.length && heapF[l] < heapF[m]) m = l;
        if (r < heapF.length && heapF[r] < heapF[m]) m = r;
        if (m === k) break;
        [heapF[m], heapF[k]] = [heapF[k], heapF[m]]; [heapI[m], heapI[k]] = [heapI[k], heapI[m]];
        k = m;
      }
    }
    return top;
  }
  const stepOK = (a, b) => walk[a] === 1 && walk[b] === 1 && Math.abs(heights[a] - heights[b]) <= STEP_H + 0.01;
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
  function octile(ax, az, bx, bz) { const dx = Math.abs(ax - bx), dz = Math.abs(az - bz); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); }
  function pathCells(sx, sz, tx, tz) {
    const s = sz * W + sx, t = tz * W + tx;
    state.fill(0); heapF.length = 0; heapI.length = 0;
    gS[s] = 0; from[s] = -1; state[s] = 1; hPush(octile(sx, sz, tx, tz), s);
    while (heapF.length) {
      const c = hPop();
      if (state[c] === 2) continue;
      state[c] = 2;
      if (c === t) {
        const out = [];
        for (let k = c; k !== -1; k = from[k]) out.push(k);
        return out.reverse();
      }
      const cx = c % W, cz = (c / W) | 0;
      for (const d of DIRS) {
        const nx = cx + d[0], nz = cz + d[1];
        if (!inB(nx, nz)) continue;
        const n = nz * W + nx;
        if (state[n] === 2 || !stepOK(c, n)) continue;
        if (d[0] && d[1]) {
          const a = cz * W + nx, b = nz * W + cx;
          if (!stepOK(c, a) || !stepOK(c, b) || !stepOK(a, n) || !stepOK(b, n)) continue;
        }
        const ng = gS[c] + d[2];
        if (state[n] === 1 && ng >= gS[n]) continue;
        gS[n] = ng; from[n] = c; state[n] = 1;
        hPush(ng + octile(nx, nz, tx, tz), n);
      }
    }
    return null;
  }
  function nearestWalkable(cx, cz) {
    if (walkable(cx, cz)) return [cx, cz];
    for (let r = 1; r < 8; r++) {
      let best = null, bd = Infinity;
      for (let z = cz - r; z <= cz + r; z++) for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r || !walkable(x, z)) continue;
        const d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
        if (d < bd) { bd = d; best = [x, z]; }
      }
      if (best) return best;
    }
    return null;
  }
  const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  function segmentWalkable(ax, az, bx, bz, r) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(len / 0.3));
    let prevH = cellH(toCell(ax), toCell(az));
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = ax + dx * t, z = az + dz * t;
      let hmax = -1, hmin = 99;
      for (const c of CORNERS) {
        const ccx = toCell(x + c[0] * r), ccz = toCell(z + c[1] * r);
        if (!walkable(ccx, ccz)) return false;
        const h = cellH(ccx, ccz);
        if (h > hmax) hmax = h;
        if (h < hmin) hmin = h;
      }
      if (hmax - hmin > STEP_H + 0.01 || Math.abs(hmax - prevH) > STEP_H + 0.01) return false;
      prevH = hmax;
    }
    return true;
  }
  // Returns a list of {x, z} waypoints (world metres) or null.
  function findPath(ax, az, bx, bz) {
    const s = nearestWalkable(toCell(ax), toCell(az));
    const t = nearestWalkable(toCell(bx), toCell(bz));
    if (!s || !t) return null;
    const cells = pathCells(s[0], s[1], t[0], t[1]);
    if (!cells) return null;
    const pts = cells.map((i) => ({ x: center(i % W), z: center((i / W) | 0) }));
    pts[0] = { x: ax, z: az };
    if (pts.length > 1) {
      if (walkable(toCell(bx), toCell(bz))) pts[pts.length - 1] = { x: bx, z: bz };
      else {
        const lx0 = t[0] * CELL + 0.45, lx1 = (t[0] + 1) * CELL - 0.45, lz0 = t[1] * CELL + 0.45, lz1 = (t[1] + 1) * CELL - 0.45;
        pts[pts.length - 1] = { x: Math.min(lx1, Math.max(lx0, bx)), z: Math.min(lz1, Math.max(lz0, bz)) };
      }
    }
    if (pts.length === 1) return [];
    const out = [];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !segmentWalkable(pts[i].x, pts[i].z, pts[j].x, pts[j].z, 0.42)) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
  function randomPointIn(x0, z0, x1, z1, rng) {
    rng = rng || Math.random;
    for (let k = 0; k < 40; k++) {
      const cx = x0 + Math.floor(rng() * (x1 - x0 + 1)), cz = z0 + Math.floor(rng() * (z1 - z0 + 1));
      if (walkable(cx, cz)) return { x: center(cx) + (rng() - 0.5) * 0.8, z: center(cz) + (rng() - 0.5) * 0.8 };
    }
    const c = nearestWalkable(Math.round((x0 + x1) / 2), Math.round((z0 + z1) / 2));
    return { x: center(c[0]), z: center(c[1]) };
  }
  function floorAt(x, z) { const h = cellH(toCell(x), toCell(z)); return h > 1.4 ? 0 : h; }
  // nearest point on walkable ground (used for dropped bombs and weapons)
  function snapToWalkable(x, z) {
    const cx = toCell(x), cz = toCell(z);
    if (walkable(cx, cz)) return { x, z, y: cellH(cx, cz) };
    const c = nearestWalkable(cx, cz);
    if (!c) return { x, z, y: 0 };
    const nx = Math.min((c[0] + 1) * CELL - 0.3, Math.max(c[0] * CELL + 0.3, x));
    const nz = Math.min((c[1] + 1) * CELL - 0.3, Math.max(c[1] * CELL + 0.3, z));
    return { x: nx, z: nz, y: cellH(c[0], c[1]) };
  }

  return {
    W, H, rows: g.map((r) => r.join('')), kinds, heights,
    inB, cellH, kindAt, walkable, toCell, center,
    boxBlocked, groundUnder, moveBody, bodyVertical,
    raycast, losClear, findPath, nearestWalkable, segmentWalkable, randomPointIn, floorAt, snapToWalkable,
  };
})();

// ------------------------------------------------------------------ level data
// All coordinates below are grid cells [x, z].
const SITES = {
  A: { x0: 2, z0: 2, x1: 10, z1: 9, plants: [[5, 4], [7, 6], [3, 6]], center: [6, 6] },
  B: { x0: 29, z0: 5, x1: 38, z1: 11, plants: [[31, 9], [35, 7], [34, 10]], center: [33.5, 8] },
};
const SPAWN_ZONES = {
  def: { x0: 15, z0: 1, x1: 24, z1: 5 },
  atk: { x0: 14, z0: 28, x1: 25, z1: 32 },
};
const SPAWNS = {
  def: [[16, 2], [22, 1], [17, 5], [23, 4], [21, 5]],
  atk: [[20, 30], [16, 30], [23, 29], [18, 31], [22, 31]],
};
// defender hold positions: at = where to stand, look = cell to watch
const DEF_HOLDS = {
  A: [{ at: [1, 1], look: [2, 18] }, { at: [11, 6], look: [9, 12] }, { at: [3, 4], look: [3, 12] }, { at: [8, 2], look: [10, 12] }],
  B: [{ at: [37, 3], look: [35, 12] }, { at: [30, 9], look: [35, 12] }, { at: [31, 2], look: [35, 11] }, { at: [38, 10], look: [35, 12] }],
  M: [{ at: [21, 7], look: [19, 20] }, { at: [18, 5], look: [19, 16] }],
};
// attacker approach routes per site: gather at stage, then push through entry
const ATK_ROUTES = {
  A: [{ name: '长通道', stage: [2, 22], entry: [2, 12] }, { name: '小道', stage: [15, 14], entry: [9, 12] }],
  B: [{ name: 'B 大道', stage: [35, 17], entry: [35, 12] }, { name: '连接通道', stage: [24, 17], entry: [34, 14] }],
};
const EXEC_NADES = {
  A: { smoke: [13, 2], flash: [6, 6] },
  B: { smoke: [28, 3], flash: [33, 6] },
};
// where defenders come from when retaking (attackers watch these after planting)
const SITE_THREATS = {
  A: [[12, 2], [9, 11], [2, 11]],
  B: [[28, 3], [35, 12], [33, 1]],
};

// additional spawn spots used when the teams are larger than five
const EXTRA_SPAWNS = {
  atk: [[14, 29], [17, 32], [21, 28], [25, 30], [19, 29], [22, 32], [14, 31]],
  def: [[15, 4], [18, 1], [24, 2], [16, 5], [22, 4], [24, 5], [15, 1]],
};
// hostage rescue: two pairs of hostages held at the A yard corner and on the B loading dock;
// the whole southern band (police spawn in this mode) counts as the rescue zone
const HOSTAGE_SPOTS = [[2, 2], [3, 3], [37, 2], [36, 3]];
const RESCUE_POINTS = [[3, 28], [35, 28], [20, 30]];
function inRescueZone(x, z) { return Math.floor(z / CELL) >= 27; }

function inSiteZone(x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (const k in SITES) {
    const s = SITES[k];
    if (cx >= s.x0 && cx <= s.x1 && cz >= s.z0 && cz <= s.z1) return k;
  }
  return null;
}
function inSpawnZone(side, x, z) {
  const s = SPAWN_ZONES[side];
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  return cx >= s.x0 - 1 && cx <= s.x1 + 1 && cz >= s.z0 - 1 && cz <= s.z1 + 1;
}
function cellToWorld(c) { return { x: c[0] * CELL + CELL / 2, z: c[1] * CELL + CELL / 2 }; }

if (typeof module !== 'undefined') {
  module.exports = { World, SITES, SPAWNS, SPAWN_ZONES, DEF_HOLDS, ATK_ROUTES, EXEC_NADES, SITE_THREATS, HOSTAGE_SPOTS, RESCUE_POINTS, inRescueZone, inSiteZone, inSpawnZone, cellToWorld, CELL, STEP_H };
}
