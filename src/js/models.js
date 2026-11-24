'use strict';
/* =========================================================
   models.js — procedural props: weapons extruded from side
   profiles, the riot shield, grenades, first-person arms and
   the crates and containers. People live in avatars.js.
   ========================================================= */
const C_DARK = 0x1f2226, C_MID = 0x363a40, C_LIGHT = 0xadb4bb, C_WOOD = 0x6e4426, C_WOOD2 = 0x55331e, C_POLY = 0x26292d, C_OLIVE = 0x56603c;

// four outfits per side; index 0 = police (红隼), 1 = militants (毒蝰)
const MATS = {
  body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }),
  metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.45 }),
  plain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 }),
  emit: new THREE.MeshBasicMaterial({ vertexColors: true }),
  lambert: new THREE.MeshLambertMaterial({ vertexColors: true }),
  glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.38, depthWrite: false }),
};
MATS.body.envMapIntensity = 0.45; MATS.metal.envMapIntensity = 1.0; MATS.plain.envMapIntensity = 0.55; MATS.glass.envMapIntensity = 1.2;
const UP = new THREE.Vector3(0, 1, 0);
const quatTo = (dir) => new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const rrect = (x0, y0, x1, y1, r) => [['M', x0 + r, y0], ['L', x1 - r, y0], ['Q', x1, y0, x1, y0 + r], ['L', x1, y1 - r], ['Q', x1, y1, x1 - r, y1], ['L', x0 + r, y1], ['Q', x0, y1, x0, y1 - r], ['L', x0, y0 + r], ['Q', x0, y0, x0 + r, y0], ['Z']];

// ------------------------------------------------------------------ geometry helpers
const Geo = {
  detail: 1,
  ellipsoid(rx, ry, rz, ws = 14, hs = 10) { return new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz); },
  // tapered capsule from y=0 (radius r0) to y=len (radius r1); the rounded caps are centred on both ends
  capsule(len, r0, r1, seg = 12) {
    const pts = [];
    for (let i = 0; i <= 4; i++) { const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * r0), Math.sin(a) * r0)); }
    for (let i = 0; i <= 4; i++) { const a = (i / 4) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * r1), len + Math.sin(a) * r1)); }
    return new THREE.LatheGeometry(pts, seg);
  },
  lathe(profile, seg = 18) { return new THREE.LatheGeometry(profile.map((p) => new THREE.Vector2(Math.max(1e-4, p[0]), p[1])), seg); },
  cylY(rBottom, rTop, len, seg = 14, open = false) { return new THREE.CylinderGeometry(rTop, rBottom, len, seg, 1, open); },
  // cylinder along the barrel axis (model -Z is forward); rFront is at the muzzle end
  cylZ(rBack, rFront, len, seg = 14) { const g = new THREE.CylinderGeometry(rFront, rBack, len, seg); g.rotateX(-Math.PI / 2); return g; },
  cylX(r, len, seg = 12) { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); return g; },
  // rounded box made from a sphere whose octants are pushed out to the corners
  roundBox(w, h, d, r, ws = 12, hs = 8) {
    r = Math.min(r, w / 2, h / 2, d / 2);
    const g = new THREE.SphereGeometry(1, ws, hs);
    const p = g.attributes.position, n = g.attributes.normal;
    const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
    const sg = (v) => (v > 1e-5 ? 1 : v < -1e-5 ? -1 : 0);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      n.setXYZ(i, x, y, z);
      p.setXYZ(i, x * r + sg(x) * hx, y * r + sg(y) * hy, z * r + sg(z) * hz);
    }
    return g;
  },
  path(cmds, P) {
    const s = new P();
    for (const c of cmds) {
      if (c[0] === 'M') s.moveTo(c[1], c[2]);
      else if (c[0] === 'L') s.lineTo(c[1], c[2]);
      else if (c[0] === 'Q') s.quadraticCurveTo(c[1], c[2], c[3], c[4]);
      else if (c[0] === 'Z') s.closePath();
    }
    return s;
  },
  // side profile in (s = forward, t = up) extruded to a given width, centred on x = 0
  extrude(cmds, width, bevel = 0.0025, holes) {
    const sh = this.path(cmds, THREE.Shape);
    if (holes) for (const h of holes) sh.holes.push(this.path(h, THREE.Path));
    if (!this.detail) bevel = 0;
    const depth = Math.max(0.0005, width - 2 * bevel);
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: this.detail ? 10 : 4 });
    g.translate(0, 0, -depth / 2);
    g.rotateY(Math.PI / 2);
    return g;
  },
  // flat plate: outline in the XY plane, thickness along Z (used for the shield)
  plate(cmds, depth, bevel, holes) {
    const sh = this.path(cmds, THREE.Shape);
    if (holes) for (const h of holes) sh.holes.push(this.path(h, THREE.Path));
    const d = Math.max(0.0005, depth - 2 * bevel);
    const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
    g.translate(0, 0, -d / 2);
    return g;
  },
};

function mergeParts(parts) {
  const prepared = [];
  let count = 0;
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    g.applyMatrix4(p.m);
    prepared.push({ g, color: p.color });
    count += g.attributes.position.count;
  }
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const { g, color } of prepared) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < n; i++) { const k = (o + i) * 3; col[k] = color.r; col[k + 1] = color.g; col[k + 2] = color.b; }
    o += n;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

class Bake {
  constructor() { this.parts = []; }
  add(geo, color, o) {
    o = o || {};
    const m = new THREE.Matrix4();
    const q = o.q || new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.r || [0, 0, 0])));
    m.compose(new THREE.Vector3().fromArray(o.p || [0, 0, 0]), q, new THREE.Vector3().fromArray(o.s || [1, 1, 1]));
    this.parts.push({ geo, m, color: new THREE.Color(color), mat: o.mat || 'body' });
    return this;
  }
  limb(a, b, r0, r1, color, seg, mat) {
    const d = new THREE.Vector3().subVectors(b, a);
    return this.add(Geo.capsule(d.length(), r0, r1, seg || 12), color, { p: a.toArray(), q: quatTo(d), mat });
  }
  build(shadow = true) {
    const groups = {};
    for (const p of this.parts) (groups[p.mat] = groups[p.mat] || []).push(p);
    const root = new THREE.Group();
    for (const key in groups) {
      const mesh = new THREE.Mesh(mergeParts(groups[key]), MATS[key]);
      mesh.castShadow = shadow && key !== 'glass'; mesh.receiveShadow = shadow;
      if (key === 'glass') mesh.renderOrder = 3;
      root.add(mesh);
    }
    return root;
  }
}

const Models = {
  // ---------------------------------------------------------------- riot shield
  shield() {
    const B = new Bake();
    const win = rrect(-0.13, 0.27, 0.13, 0.36, 0.02);
    B.add(Geo.plate(rrect(-0.31, -0.5, 0.31, 0.5, 0.07), 0.026, 0.006, [win]), 0x1d2024, { mat: 'plain' });
    B.add(Geo.plate(rrect(-0.29, -0.09, 0.29, -0.03, 0.01), 0.004, 0, null), 0xd8dde2, { mat: 'plain', p: [0, 0, -0.015] });
    B.add(Geo.plate(rrect(-0.29, 0.04, 0.29, 0.07, 0.01), 0.004, 0, null), 0x5ec4ff, { mat: 'plain', p: [0, 0, -0.015] });
    B.add(Geo.plate(rrect(-0.14, 0.26, 0.14, 0.37, 0.02), 0.008, 0, null), 0x2b3c4c, { mat: 'glass' });
    for (const y of [-0.08, 0.12]) B.add(Geo.cylX(0.012, 0.16, 10), C_MID, { mat: 'metal', p: [0, y, 0.05] });
    const g = B.build();
    g.userData.isShield = true;
    return g;
  },

  // ---------------------------------------------------------------- weapons
  // profiles use s = forward from the trigger area and t = up; model space faces -Z
  gun(id, low) {
    Geo.detail = low ? 0 : 1;
    const B = new Bake();
    const ext = (cmds, w, color, mat, o) => B.add(Geo.extrude(cmds, w, o && o.bevel != null ? o.bevel : 0.0025, o && o.holes), color, { mat, p: [o && o.x || 0, 0, 0] });
    const cyl = (r, s0, s1, t, color, mat, seg, rFront, x) => B.add(Geo.cylZ(r, rFront == null ? r : rFront, s1 - s0, low ? Math.min(seg || 14, 8) : seg || 14), color, { mat, p: [x || 0, t, -(s0 + s1) / 2] });
    const box = (w, h, d, color, mat, s, t, x) => B.add(low ? new THREE.BoxGeometry(w, h, d) : Geo.roundBox(w, h, d, Math.min(w, h, d) * 0.3, 12, 8), color, { mat, p: [x || 0, t, -s] });
    const scope = (s0, s1, t, rt, ro, re, color) => {
      B.add(Geo.lathe([[0, s0], [re, s0], [re * 1.05, s0 + 0.02], [rt, s0 + 0.05], [rt, s1 - 0.06], [ro, s1 - 0.02], [ro * 1.03, s1], [0, s1]], low ? 10 : 20).rotateX(-Math.PI / 2), color || C_DARK, { mat: M, p: [0, t, 0] });
      B.add(new THREE.CircleGeometry(re * 0.82, 16), 0x24343f, { mat: M, p: [0, t, -s0 + 0.0008] });
      box(0.02, t - 0.07, 0.022, C_DARK, M, s0 + 0.06, 0.07 + (t - 0.07) / 2);
      box(0.02, t - 0.07, 0.022, C_DARK, M, s1 - 0.06, 0.07 + (t - 0.07) / 2);
    };
    // pistol family: slide + polymer frame with trigger guard + grip
    const pistol = (o) => {
      const L = o.len, top = o.top, w = o.w || 0.026, gl = o.gl || 0.112;
      ext([['M', -0.03, 0.012], ['L', L, 0.012], ['L', L, top - 0.004], ['Q', L, top, L - 0.005, top], ['L', -0.025, top], ['Q', -0.03, top, -0.03, top - 0.005], ['Z']], w, o.slide, M, { bevel: 0.002 });
      const fe = L - 0.018;
      ext([['M', -0.028, 0.013], ['L', fe, 0.013], ['L', fe, 0.0], ['L', 0.066, -0.002], ['L', 0.063, -0.028], ['Q', 0.06, -0.037, 0.046, -0.037], ['L', 0.022, -0.037], ['Q', 0.012, -0.035, 0.01, -0.025], ['L', -0.012, -gl], ['Q', -0.02, -gl - 0.006, -0.04, -gl - 0.004], ['L', -0.05, -gl + 0.004], ['L', -0.037, -0.01], ['Q', -0.033, 0.006, -0.028, 0.013], ['Z']],
        w + 0.002, o.frame, P, { bevel: 0.0025, holes: [[['M', 0.023, -0.027], ['L', 0.053, -0.027], ['L', 0.055, -0.006], ['L', 0.021, -0.006], ['Z']]] });
      ext([['M', 0.032, -0.004], ['L', 0.04, -0.004], ['Q', 0.038, -0.016, 0.034, -0.022], ['L', 0.03, -0.02], ['Z']], 0.006, C_DARK, M, { bevel: 0.001 });
      box(0.006, 0.008, 0.006, C_DARK, M, L - 0.008, top + 0.004); box(0.022, 0.008, 0.008, C_DARK, M, -0.02, top + 0.004);
      return [0, 0.012 + (top - 0.012) * 0.55, -L - 0.004];
    };
    const akStock = (color, s0) => ext([['M', s0, 0.048], ['L', -0.36, 0.024], ['Q', -0.37, 0.024, -0.37, 0.014], ['L', -0.37, -0.09], ['Q', -0.37, -0.1, -0.36, -0.1], ['Q', -0.22, -0.06, s0, -0.004], ['Z']], 0.036, color, P, { bevel: 0.005 });
    const grip = (color, s0) => ext([['M', s0 - 0.012, -0.004], ['L', s0 + 0.026, -0.004], ['L', s0 + 0.002, -0.1], ['Q', s0 - 0.006, -0.11, s0 - 0.03, -0.108], ['L', s0 - 0.042, -0.1], ['Z']], 0.031, color, P, { bevel: 0.005 });
    const skelStock = (color, s0, s1) => ext([['M', s0, 0.058], ['L', s1, 0.05], ['Q', s1 - 0.012, 0.05, s1 - 0.012, 0.035], ['L', s1 - 0.012, -0.075], ['L', s1 + 0.04, -0.075], ['L', s0, 0.0], ['Z']], 0.036, color, P, { bevel: 0.004, holes: [[['M', s1 + 0.012, 0.03], ['L', s0 - 0.04, 0.042], ['L', s1 + 0.04, -0.04], ['L', s1 + 0.012, -0.04], ['Z']]] });
    const M = 'metal', P = 'plain';
    let mz = [0, 0.03, -0.3], sil = null;
    switch (id) {
      // ---------------- pistols
      case 'p9': mz = pistol({ len: 0.16, top: 0.049, slide: 0x2b2e33, frame: C_POLY }); sil = [0.0155, 0.13]; break;
      case 'b18': mz = pistol({ len: 0.148, top: 0.046, slide: 0x2c2e30, frame: 0x24272a, w: 0.025, gl: 0.108 }); break;
      case 'p2': mz = pistol({ len: 0.15, top: 0.048, slide: 0x50555c, frame: C_DARK }); break;
      case 'd92': mz = pistol({ len: 0.17, top: 0.046, slide: 0xa3abb3, frame: 0x2a2c30, gl: 0.11 }); break;
      case 'f57': mz = pistol({ len: 0.17, top: 0.05, slide: 0x2c2f33, frame: 0x41463c, gl: 0.116 }); break;
      case 'hx50':
        ext([['M', -0.04, 0.014], ['L', 0.2, 0.014], ['L', 0.2, 0.046], ['L', 0.192, 0.057], ['L', -0.034, 0.062], ['Q', -0.04, 0.062, -0.04, 0.055], ['Z']], 0.032, C_LIGHT, M, { bevel: 0.0025 });
        ext([['M', -0.036, 0.015], ['L', 0.17, 0.015], ['L', 0.17, 0.0], ['L', 0.075, -0.003], ['L', 0.072, -0.032], ['Q', 0.068, -0.042, 0.052, -0.042], ['L', 0.026, -0.042], ['Q', 0.014, -0.04, 0.012, -0.028], ['L', -0.014, -0.125], ['Q', -0.022, -0.132, -0.046, -0.13], ['L', -0.058, -0.12], ['L', -0.044, -0.012], ['Q', -0.04, 0.006, -0.036, 0.015], ['Z']],
          0.034, C_DARK, P, { bevel: 0.003, holes: [[['M', 0.026, -0.032], ['L', 0.062, -0.032], ['L', 0.064, -0.008], ['L', 0.024, -0.008], ['Z']]] });
        box(0.008, 0.01, 0.01, C_DARK, M, 0.19, 0.066); box(0.026, 0.01, 0.01, C_DARK, M, -0.03, 0.068);
        mz = [0, 0.036, -0.205]; break;
      // ---------------- shotguns
      case 'sg8':
        ext([['M', -0.075, 0.0], ['L', 0.16, 0.0], ['L', 0.16, 0.062], ['L', -0.055, 0.066], ['Q', -0.075, 0.066, -0.075, 0.05], ['Z']], 0.048, C_DARK, M, { bevel: 0.004 });
        cyl(0.0155, 0.16, 0.7, 0.046, C_DARK, M, 16); cyl(0.013, 0.16, 0.63, 0.013, C_DARK, M, 14);
        ext([['M', 0.27, -0.014], ['L', 0.46, -0.014], ['Q', 0.472, 0.012, 0.46, 0.041], ['L', 0.27, 0.041], ['Q', 0.258, 0.012, 0.27, -0.014], ['Z']], 0.056, C_WOOD, P, { bevel: 0.005 });
        ext([['M', -0.045, 0.002], ['L', -0.008, 0.002], ['L', -0.032, -0.092], ['Q', -0.04, -0.102, -0.064, -0.098], ['L', -0.07, -0.088], ['Z']], 0.032, C_WOOD, P, { bevel: 0.005 });
        ext([['M', -0.07, 0.056], ['L', -0.37, 0.036], ['Q', -0.38, 0.035, -0.38, 0.022], ['L', -0.38, -0.088], ['Q', -0.38, -0.1, -0.368, -0.1], ['Q', -0.22, -0.06, -0.06, 0.0], ['Z']], 0.038, C_WOOD, P, { bevel: 0.005 });
        B.add(Geo.ellipsoid(0.005, 0.005, 0.005, 8, 6), C_LIGHT, { mat: M, p: [0, 0.064, -0.69] });
        mz = [0, 0.046, -0.7]; break;
      case 'sa12':
        ext([['M', -0.08, 0.0], ['L', 0.17, 0.0], ['L', 0.17, 0.064], ['L', -0.06, 0.068], ['Q', -0.08, 0.068, -0.08, 0.052], ['Z']], 0.05, C_DARK, M, { bevel: 0.004 });
        cyl(0.015, 0.17, 0.66, 0.05, C_DARK, M, 16); cyl(0.014, 0.17, 0.6, 0.017, C_DARK, M, 14);
        ext([['M', 0.18, -0.006], ['L', 0.42, -0.004], ['Q', 0.43, 0.02, 0.42, 0.044], ['L', 0.18, 0.046], ['Z']], 0.054, C_POLY, P, { bevel: 0.005 });
        grip(C_POLY, -0.02);
        ext([['M', -0.08, 0.062], ['L', -0.36, 0.05], ['Q', -0.37, 0.05, -0.37, 0.036], ['L', -0.37, -0.08], ['L', -0.3, -0.086], ['L', -0.12, -0.022], ['L', -0.08, -0.02], ['Z']], 0.04, C_POLY, P, { bevel: 0.005 });
        for (let i = 0; i < 3; i++) B.add(Geo.cylY(0.009, 0.009, 0.06, 10), 0xa82e24, { mat: P, p: [0.03, 0.03, 0.02 - i * 0.022] });
        mz = [0, 0.05, -0.66]; break;
      // ---------------- smgs
      case 'm11':
        ext(rrect(-0.05, 0.0, 0.17, 0.075, 0.006), 0.048, C_DARK, M, { bevel: 0.003 });
        ext([['M', -0.005, 0.002], ['L', 0.04, 0.002], ['L', 0.035, -0.17], ['L', -0.002, -0.172], ['Z']], 0.03, C_POLY, P, { bevel: 0.004 });
        cyl(0.012, 0.17, 0.215, 0.052, C_MID, M, 12);
        for (const x of [-0.021, 0.021]) cyl(0.004, -0.15, -0.05, 0.03, C_MID, M, 6, null, x);
        box(0.05, 0.06, 0.012, C_DARK, M, -0.155, 0.02);
        box(0.01, 0.018, 0.02, C_DARK, M, 0.15, 0.084);
        mz = [0, 0.052, -0.215]; break;
      case 'tm9':
        ext([['M', -0.06, 0.0], ['L', 0.14, 0.0], ['L', 0.16, 0.02], ['L', 0.16, 0.06], ['L', -0.04, 0.07], ['Q', -0.06, 0.07, -0.06, 0.05], ['Z']], 0.044, C_POLY, P, { bevel: 0.005 });
        cyl(0.018, 0.16, 0.33, 0.04, C_DARK, M, 16);
        ext([['M', 0.115, 0.002], ['L', 0.148, 0.002], ['L', 0.146, -0.085], ['Q', 0.13, -0.092, 0.118, -0.085], ['Z']], 0.026, C_POLY, P, { bevel: 0.004 });
        ext([['M', -0.012, 0.002], ['L', 0.03, 0.002], ['L', 0.02, -0.16], ['L', -0.016, -0.162], ['Z']], 0.028, C_POLY, P, { bevel: 0.004 });
        box(0.03, 0.012, 0.14, C_DARK, M, 0.05, 0.076);
        mz = [0, 0.04, -0.33]; break;
      case 'v10':
        ext([['M', -0.07, 0.0], ['L', 0.19, 0.0], ['L', 0.215, 0.02], ['L', 0.215, 0.056], ['Q', 0.205, 0.073, 0.185, 0.073], ['L', -0.05, 0.073], ['Q', -0.07, 0.073, -0.07, 0.055], ['Z']], 0.05, C_POLY, P, { bevel: 0.005 });
        cyl(0.0115, 0.215, 0.3, 0.04, C_DARK, M); cyl(0.016, 0.255, 0.275, 0.04, C_DARK, M, 12);
        ext([['M', 0.07, 0.003], ['L', 0.11, 0.003], ['Q', 0.12, -0.08, 0.15, -0.15], ['L', 0.108, -0.158], ['Q', 0.085, -0.08, 0.07, 0.003], ['Z']], 0.024, C_DARK, M, { bevel: 0.003 });
        ext([['M', -0.012, 0.002], ['L', 0.026, 0.002], ['L', 0.004, -0.1], ['Q', -0.004, -0.11, -0.03, -0.107], ['L', -0.04, -0.098], ['Z']], 0.03, C_POLY, P, { bevel: 0.005 });
        for (const t of [0.058, 0.006]) cyl(0.0055, -0.27, -0.07, t, C_DARK, M, 8);
        box(0.044, 0.08, 0.022, C_POLY, P, -0.276, 0.03);
        box(0.01, 0.02, 0.016, C_DARK, M, 0.18, 0.084); box(0.024, 0.018, 0.02, C_DARK, M, -0.035, 0.084);
        mz = [0, 0.04, -0.3]; break;
      case 'u45':
        ext([['M', -0.08, -0.005], ['L', 0.22, -0.005], ['L', 0.24, 0.02], ['L', 0.24, 0.06], ['L', -0.08, 0.07], ['Z']], 0.05, 0x2a2d30, P, { bevel: 0.005 });
        ext([['M', 0.07, 0.0], ['L', 0.115, 0.0], ['L', 0.135, -0.17], ['L', 0.09, -0.172], ['Z']], 0.024, C_POLY, P, { bevel: 0.003 });
        grip(0x2a2d30, 0.0);
        skelStock(0x2a2d30, -0.08, -0.3);
        cyl(0.012, 0.24, 0.29, 0.035, C_DARK, M);
        box(0.026, 0.012, 0.22, C_DARK, M, 0.08, 0.075);
        mz = [0, 0.035, -0.29]; break;
      case 'p50':
        ext([['M', -0.24, -0.04], ['L', -0.2, -0.06], ['L', 0.14, -0.045], ['L', 0.2, -0.02], ['L', 0.22, 0.01], ['L', 0.22, 0.05], ['L', 0.14, 0.078], ['L', -0.2, 0.078], ['Q', -0.24, 0.07, -0.24, 0.04], ['Z']],
          0.056, 0x1f2124, P, { bevel: 0.006, holes: [[['M', -0.005, -0.04], ['L', 0.075, -0.034], ['Q', 0.08, -0.02, 0.07, -0.012], ['L', 0.0, -0.016], ['Q', -0.012, -0.028, -0.005, -0.04], ['Z']]] });
        ext(rrect(-0.17, 0.076, 0.15, 0.094, 0.006), 0.05, 0x5f6a63, P, { bevel: 0.003 });
        cyl(0.01, 0.22, 0.27, 0.03, C_DARK, M);
        box(0.026, 0.03, 0.06, C_DARK, M, 0.05, 0.11);
        mz = [0, 0.03, -0.27]; break;
      // ---------------- rifles
      case 'gl35':
        ext([['M', -0.075, -0.006], ['L', 0.25, -0.006], ['L', 0.25, 0.044], ['L', 0.232, 0.056], ['L', -0.05, 0.06], ['Q', -0.075, 0.06, -0.075, 0.04], ['Z']], 0.044, 0x2a2c2f, M, { bevel: 0.003 });
        ext([['M', 0.02, 0.058], ['L', 0.17, 0.058], ['L', 0.17, 0.095], ['L', 0.02, 0.095], ['Z']], 0.012, C_DARK, M, { bevel: 0.002, holes: [[['M', 0.035, 0.066], ['L', 0.155, 0.066], ['L', 0.155, 0.086], ['L', 0.035, 0.086], ['Z']]] });
        ext([['M', 0.255, -0.01], ['L', 0.44, -0.006], ['Q', 0.452, 0.02, 0.44, 0.046], ['L', 0.255, 0.048], ['Q', 0.248, 0.02, 0.255, -0.01], ['Z']], 0.054, C_POLY, P, { bevel: 0.005 });
        cyl(0.0105, 0.44, 0.7, 0.026, C_DARK, M); cyl(0.014, 0.7, 0.75, 0.026, C_DARK, M, 10);
        ext([['M', 0.085, -0.004], ['L', 0.14, -0.004], ['Q', 0.158, -0.12, 0.2, -0.22], ['L', 0.155, -0.24], ['Q', 0.115, -0.13, 0.085, -0.004], ['Z']], 0.03, 0x34373a, M, { bevel: 0.004 });
        grip(C_POLY, 0.0);
        skelStock(C_DARK, -0.075, -0.36);
        mz = [0, 0.026, -0.75]; break;
      case 'f2':
        ext([['M', -0.3, -0.02], ['L', 0.3, -0.01], ['L', 0.32, 0.02], ['L', 0.32, 0.05], ['L', -0.3, 0.062], ['Q', -0.32, 0.06, -0.32, 0.04], ['L', -0.32, -0.005], ['Z']], 0.05, 0x2f3236, P, { bevel: 0.005 });
        ext([['M', -0.14, 0.06], ['L', 0.26, 0.055], ['L', 0.26, 0.115], ['L', 0.22, 0.122], ['L', -0.1, 0.122], ['L', -0.14, 0.1], ['Z']], 0.022, C_DARK, P, { bevel: 0.004, holes: [[['M', -0.1, 0.074], ['L', 0.2, 0.07], ['L', 0.2, 0.104], ['L', -0.08, 0.108], ['Z']]] });
        ext([['M', -0.15, -0.02], ['L', -0.1, -0.02], ['L', -0.095, -0.13], ['L', -0.14, -0.13], ['Z']], 0.024, C_DARK, M, { bevel: 0.003 });
        grip(C_POLY, 0.0);
        cyl(0.01, 0.32, 0.42, 0.025, C_DARK, M); cyl(0.013, 0.42, 0.45, 0.025, C_DARK, M, 10);
        box(0.05, 0.09, 0.02, C_POLY, P, -0.32, 0.02);
        mz = [0, 0.025, -0.45]; break;
      case 'ar7':
        ext([['M', -0.075, -0.006], ['L', 0.25, -0.006], ['L', 0.25, 0.044], ['L', 0.232, 0.056], ['L', -0.05, 0.06], ['Q', -0.075, 0.06, -0.075, 0.04], ['Z']], 0.044, C_DARK, M, { bevel: 0.003 });
        box(0.016, 0.014, 0.05, C_MID, M, 0.205, 0.066);
        cyl(0.013, 0.24, 0.43, 0.062, C_WOOD, P, 14);
        ext([['M', 0.255, -0.01], ['L', 0.44, -0.006], ['Q', 0.452, 0.02, 0.44, 0.046], ['L', 0.255, 0.048], ['Q', 0.248, 0.02, 0.255, -0.01], ['Z']], 0.054, C_WOOD, P, { bevel: 0.005 });
        cyl(0.0105, 0.44, 0.69, 0.026, C_DARK, M);
        box(0.02, 0.05, 0.03, C_DARK, M, 0.66, 0.048);
        cyl(0.0155, 0.69, 0.75, 0.026, C_DARK, M, 12);
        ext([['M', 0.085, -0.004], ['L', 0.14, -0.004], ['Q', 0.165, -0.11, 0.215, -0.2], ['L', 0.168, -0.222], ['Q', 0.12, -0.12, 0.085, -0.004], ['Z']], 0.03, C_DARK, M, { bevel: 0.004 });
        grip(C_WOOD2, 0.0);
        ext([['M', 0.03, -0.004], ['L', 0.034, -0.036], ['L', 0.082, -0.036], ['L', 0.082, -0.03], ['L', 0.04, -0.03], ['L', 0.037, -0.004], ['Z']], 0.008, C_DARK, M, { bevel: 0.001 });
        akStock(C_WOOD, -0.075);
        mz = [0, 0.026, -0.75]; break;
      case 'k4':
        ext([['M', -0.07, 0.012], ['L', 0.2, 0.012], ['L', 0.2, 0.064], ['L', -0.07, 0.064], ['Z']], 0.046, C_POLY, M, { bevel: 0.004 });
        ext([['M', -0.06, 0.014], ['L', 0.17, 0.014], ['L', 0.17, -0.022], ['L', 0.135, -0.034], ['L', 0.075, -0.034], ['L', 0.055, -0.02], ['L', -0.055, -0.02], ['Z']], 0.04, C_DARK, M, { bevel: 0.003 });
        box(0.024, 0.012, 0.5, C_DARK, M, 0.17, 0.071);
        cyl(0.027, 0.2, 0.45, 0.038, C_DARK, M, 8); cyl(0.0095, 0.45, 0.68, 0.038, C_DARK, M); cyl(0.012, 0.68, 0.73, 0.038, C_DARK, M, 8);
        ext([['M', 0.405, 0.06], ['L', 0.432, 0.06], ['L', 0.422, 0.112], ['L', 0.412, 0.112], ['Z']], 0.012, C_DARK, M, { bevel: 0.001 });
        box(0.03, 0.02, 0.05, C_DARK, M, 0.02, 0.087);
        cyl(0.019, -0.012, 0.056, 0.112, C_DARK, M, 18);
        B.add(new THREE.CircleGeometry(0.0145, 18), 0x1d2a33, { mat: M, p: [0, 0.112, 0.0125] });
        B.add(new THREE.CircleGeometry(0.0016, 8), 0xff2a18, { mat: 'emit', p: [0, 0.112, 0.006] });
        ext([['M', 0.085, -0.026], ['L', 0.13, -0.026], ['Q', 0.14, -0.1, 0.162, -0.168], ['L', 0.118, -0.176], ['Q', 0.1, -0.1, 0.085, -0.026], ['Z']], 0.026, C_DARK, M, { bevel: 0.004 });
        grip(C_POLY, -0.01);
        cyl(0.014, -0.25, -0.07, 0.036, C_DARK, M);
        ext([['M', -0.17, 0.058], ['L', -0.33, 0.052], ['Q', -0.34, 0.052, -0.34, 0.04], ['L', -0.34, -0.07], ['L', -0.29, -0.07], ['L', -0.18, 0.005], ['Z']], 0.04, C_POLY, P, { bevel: 0.005 });
        mz = [0, 0.038, -0.73]; sil = [0.0195, 0.17]; break;
      case 's552':
        ext([['M', -0.08, 0.0], ['L', 0.2, 0.0], ['L', 0.2, 0.06], ['L', -0.08, 0.065], ['Z']], 0.044, 0x34373b, M, { bevel: 0.004 });
        ext([['M', 0.2, -0.005], ['L', 0.33, 0.0], ['Q', 0.34, 0.025, 0.33, 0.05], ['L', 0.2, 0.055], ['Z']], 0.05, 0x3c4038, P, { bevel: 0.005 });
        cyl(0.01, 0.33, 0.46, 0.026, C_DARK, M); cyl(0.013, 0.46, 0.5, 0.026, C_DARK, M, 10);
        ext([['M', 0.08, 0.0], ['L', 0.125, 0.0], ['Q', 0.135, -0.09, 0.16, -0.16], ['L', 0.115, -0.168], ['Q', 0.098, -0.09, 0.08, 0.0], ['Z']], 0.028, 0x4a4f4a, P, { bevel: 0.004 });
        grip(C_POLY, -0.005);
        skelStock(0x3c4038, -0.08, -0.32);
        scope(-0.06, 0.13, 0.112, 0.015, 0.022, 0.02);
        mz = [0, 0.026, -0.5]; break;
      case 'a3':
        ext([['M', -0.3, -0.03], ['L', 0.12, -0.02], ['L', 0.16, 0.0], ['L', 0.16, 0.045], ['L', -0.28, 0.058], ['Q', -0.32, 0.055, -0.32, 0.03], ['L', -0.32, -0.01], ['Z']], 0.056, 0x4b5a3e, P, { bevel: 0.006 });
        B.add(Geo.lathe([[0, -0.11], [0.022, -0.11], [0.02, -0.08], [0.017, -0.06], [0.017, 0.1], [0.024, 0.14], [0, 0.14]], low ? 10 : 18).rotateX(-Math.PI / 2), 0x4b5a3e, { mat: P, p: [0, 0.09, 0] });
        box(0.03, 0.03, 0.18, 0x4b5a3e, P, 0.02, 0.066);
        ext([['M', -0.05, -0.022], ['L', 0.13, -0.022], ['Q', 0.14, -0.06, 0.12, -0.1], ['L', -0.04, -0.1], ['Q', -0.06, -0.06, -0.05, -0.022], ['Z']], 0.03, 0x4b5a3e, P, { bevel: 0.004, holes: [[['M', -0.03, -0.034], ['L', 0.11, -0.034], ['Q', 0.12, -0.06, 0.105, -0.088], ['L', -0.025, -0.088], ['Z']]] });
        ext([['M', -0.17, -0.028], ['L', -0.125, -0.026], ['L', -0.12, -0.14], ['L', -0.165, -0.14], ['Z']], 0.024, 0x5a6b6a, P, { bevel: 0.003 });
        cyl(0.011, 0.16, 0.38, 0.022, C_DARK, M); cyl(0.014, 0.38, 0.42, 0.022, C_DARK, M, 10);
        mz = [0, 0.022, -0.42]; break;
      case 'sc1':
        ext([['M', -0.05, 0.03], ['L', 0.35, 0.03], ['L', 0.35, 0.005], ['L', 0.05, -0.006], ['L', 0.03, -0.028], ['L', 0.004, -0.11], ['Q', -0.006, -0.12, -0.032, -0.116], ['L', -0.05, -0.09], ['L', -0.1, -0.06], ['L', -0.42, -0.085], ['Q', -0.44, -0.085, -0.44, -0.07], ['L', -0.44, 0.05], ['Q', -0.44, 0.062, -0.425, 0.062], ['L', -0.1, 0.048], ['Z']], 0.044, 0x3b403a, P, { bevel: 0.005 });
        cyl(0.017, -0.06, 0.18, 0.045, C_DARK, M, 14);
        cyl(0.0095, 0.18, 0.78, 0.045, C_DARK, M, 12, 0.008);
        scope(-0.08, 0.2, 0.112, 0.015, 0.024, 0.021);
        B.limb(V3(0.016, 0.048, 0.04), V3(0.052, 0.036, 0.045), 0.005, 0.005, C_LIGHT, 8, M);
        box(0.026, 0.04, 0.06, C_DARK, M, 0.07, -0.02);
        mz = [0, 0.045, -0.78]; break;
      case 'lr90':
        cyl(0.021, -0.07, 0.2, 0.05, C_DARK, M, 16);
        cyl(0.0135, 0.2, 0.93, 0.05, C_DARK, M, 14, 0.0115);
        box(0.036, 0.03, 0.075, C_DARK, M, 0.965, 0.05);
        ext([['M', -0.06, 0.032], ['L', 0.37, 0.032], ['L', 0.37, 0.002], ['L', 0.06, -0.008], ['L', 0.035, -0.03], ['L', 0.006, -0.118], ['Q', -0.004, -0.13, -0.034, -0.126], ['L', -0.052, -0.1], ['L', -0.11, -0.06], ['L', -0.46, -0.098], ['Q', -0.48, -0.098, -0.48, -0.08], ['L', -0.48, 0.058], ['Q', -0.48, 0.072, -0.465, 0.072], ['L', -0.12, 0.05], ['Z']],
          0.052, C_OLIVE, P, { bevel: 0.006, holes: [[['M', -0.095, -0.022], ['L', -0.05, -0.022], ['L', -0.07, -0.062], ['L', -0.1, -0.05], ['Z']]] });
        scope(-0.07, 0.27, 0.122, 0.017, 0.029, 0.024);
        B.add(Geo.cylY(0.012, 0.012, 0.03, 12), C_DARK, { mat: M, p: [0, 0.148, -0.07] });
        B.add(Geo.cylX(0.012, 0.03, 12), C_DARK, { mat: M, p: [0.025, 0.122, -0.07] });
        B.limb(V3(0.018, 0.052, 0.04), V3(0.06, 0.038, 0.045), 0.006, 0.006, C_LIGHT, 8, M);
        B.add(Geo.ellipsoid(0.012, 0.012, 0.012, 10, 8), C_DARK, { mat: M, p: [0.064, 0.036, 0.045] });
        box(0.032, 0.05, 0.07, C_DARK, M, 0.08, -0.025);
        mz = [0, 0.05, -1.0]; break;
      case 'sr3':
      case 'sr5': {
        const g3 = id === 'sr3', body = g3 ? 0x2a2c2f : 0x34373a, fur = g3 ? C_POLY : 0x3c4038;
        ext([['M', -0.08, -0.004], ['L', 0.26, -0.004], ['L', 0.26, 0.058], ['L', -0.08, 0.062], ['Z']], 0.046, body, M, { bevel: 0.004 });
        cyl(0.024, 0.26, 0.5, 0.032, fur, P, g3 ? 10 : 8);
        cyl(0.011, 0.5, 0.86, 0.032, C_DARK, M); cyl(0.015, 0.86, 0.91, 0.032, C_DARK, M, 10);
        ext([['M', 0.09, -0.004], ['L', 0.135, -0.004], ['L', 0.14, -0.13], ['L', 0.095, -0.132], ['Z']], 0.028, C_DARK, M, { bevel: 0.003 });
        grip(fur, 0.0);
        if (g3) ext([['M', -0.08, 0.056], ['L', -0.42, 0.06], ['Q', -0.44, 0.06, -0.44, 0.04], ['L', -0.44, -0.09], ['L', -0.38, -0.095], ['L', -0.14, -0.03], ['L', -0.08, -0.004], ['Z']], 0.042, fur, P, { bevel: 0.005 });
        else ext([['M', -0.08, 0.056], ['L', -0.42, 0.05], ['Q', -0.44, 0.05, -0.44, 0.032], ['L', -0.44, -0.09], ['L', -0.36, -0.09], ['L', -0.1, -0.02], ['Z']], 0.042, fur, P, { bevel: 0.005, holes: [[['M', -0.36, -0.06], ['L', -0.16, -0.022], ['L', -0.36, 0.02], ['Z']]] });
        scope(-0.08, 0.24, 0.118, 0.017, 0.028, 0.023);
        mz = [0, 0.032, -0.91]; break;
      }
      // ---------------- machine gun
      case 'mg60':
        ext(rrect(-0.1, 0.0, 0.22, 0.08, 0.008), 0.06, C_DARK, M, { bevel: 0.004 });
        ext(rrect(-0.08, 0.075, 0.16, 0.098, 0.006), 0.062, C_MID, M, { bevel: 0.003 });
        ext([['M', 0.14, 0.09], ['L', 0.3, 0.09], ['L', 0.3, 0.135], ['L', 0.14, 0.135], ['Z']], 0.014, C_DARK, M, { bevel: 0.002, holes: [[['M', 0.155, 0.1], ['L', 0.285, 0.1], ['L', 0.285, 0.124], ['L', 0.155, 0.124], ['Z']]] });
        cyl(0.021, 0.22, 0.46, 0.045, C_POLY, P, 10);
        cyl(0.0125, 0.22, 0.74, 0.04, C_DARK, M, 12); cyl(0.016, 0.74, 0.79, 0.04, C_DARK, M, 10);
        for (const x of [-0.012, 0.012]) cyl(0.005, 0.42, 0.66, 0.01, C_DARK, M, 6, null, x);
        B.add(Geo.roundBox(0.08, 0.1, 0.12, 0.012), 0x4e5634, { mat: P, p: [-0.045, -0.05, -0.06] });
        grip(C_POLY, -0.01);
        skelStock(C_POLY, -0.1, -0.38);
        mz = [0, 0.04, -0.79]; break;
      // ---------------- knife, grenades, bomb
      case 'knife':
        ext([['M', 0.0, 0.012], ['L', 0.12, 0.012], ['Q', 0.17, 0.008, 0.19, -0.004], ['Q', 0.15, -0.018, 0.1, -0.021], ['L', 0.0, -0.021], ['Z']], 0.005, 0xb9c1c8, M, { bevel: 0.0015 });
        box(0.03, 0.058, 0.012, C_DARK, M, -0.004, -0.004);
        ext([['M', -0.11, 0.012], ['L', -0.01, 0.014], ['L', -0.01, -0.022], ['Q', -0.025, -0.03, -0.038, -0.022], ['Q', -0.052, -0.031, -0.066, -0.024], ['L', -0.11, -0.02], ['Q', -0.118, -0.004, -0.11, 0.012], ['Z']], 0.022, C_POLY, P, { bevel: 0.004 });
        cyl(0.012, -0.125, -0.108, -0.004, C_DARK, M, 12);
        mz = [0, 0, -0.19]; break;
      case 'he':
        B.add(Geo.ellipsoid(0.034, 0.039, 0.034, 16, 12), 0x4a5531, { mat: P });
        B.add(Geo.cylY(0.012, 0.011, 0.026, 12), C_MID, { mat: M, p: [0, 0.046, 0] });
        ext([['M', -0.004, 0.058], ['L', 0.006, 0.06], ['Q', 0.042, 0.035, 0.038, -0.028], ['L', 0.032, -0.028], ['Q', 0.035, 0.03, -0.004, 0.052], ['Z']], 0.012, C_LIGHT, M, { bevel: 0.001 });
        B.add(new THREE.TorusGeometry(0.011, 0.0018, 6, 16), C_LIGHT, { mat: M, p: [0.0, 0.056, 0.018], r: [0, Math.PI / 2, 0] });
        mz = [0, 0, 0]; break;
      case 'flash':
      case 'smoke': {
        const fl = id === 'flash';
        B.add(Geo.cylY(fl ? 0.024 : 0.028, fl ? 0.024 : 0.028, fl ? 0.09 : 0.11, 16), fl ? 0x8a9095 : 0xb3b8bb, { mat: M });
        for (const y of [-0.025, 0.025]) B.add(Geo.cylY(fl ? 0.0245 : 0.0285, fl ? 0.0245 : 0.0285, 0.01, 16), fl ? 0x2a2d30 : 0x2f8a4a, { mat: P, p: [0, y, 0] });
        B.add(Geo.cylY(0.012, 0.011, 0.024, 12), C_MID, { mat: M, p: [0, fl ? 0.056 : 0.066, 0] });
        ext([['M', -0.004, 0.068], ['L', 0.006, 0.07], ['Q', 0.032, 0.05, 0.03, -0.03], ['L', 0.025, -0.03], ['Q', 0.027, 0.045, -0.004, 0.062], ['Z']], 0.012, C_LIGHT, M, { bevel: 0.001 });
        mz = [0, 0, 0]; break;
      }
      case 'bomb':
        B.add(Geo.roundBox(0.2, 0.075, 0.13, 0.012), 0x5b5236, { mat: P, p: [0, 0, -0.05] });
        B.add(Geo.roundBox(0.075, 0.018, 0.06, 0.006), C_POLY, { mat: P, p: [0.045, 0.045, -0.06] });
        B.add(new THREE.PlaneGeometry(0.05, 0.022), 0x13ff6a, { mat: 'emit', p: [0.045, 0.0545, -0.07], r: [-Math.PI / 2, 0, 0] });
        for (const x of [-0.07, -0.02]) B.add(Geo.roundBox(0.024, 0.08, 0.135, 0.004), 0x7d7f80, { mat: P, p: [x, 0, -0.05] });
        B.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(0.02, 0.04, -0.03), V3(-0.02, 0.07, -0.02), V3(-0.06, 0.05, -0.1)]), 12, 0.004, 6), 0xb23a2a, { mat: P });
        B.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(0.03, 0.04, -0.09), V3(0.0, 0.075, -0.07), V3(-0.07, 0.045, -0.02)]), 12, 0.004, 6), 0x2a4fb2, { mat: P });
        mz = [0, 0, 0]; break;
      default:
        box(0.05, 0.07, 0.4, C_DARK, M, 0.1, 0.03);
    }
    const g = B.build();
    g.userData.muzzle = new THREE.Vector3(mz[0], mz[1], mz[2]);
    g.userData.muzzlePlain = g.userData.muzzle.clone();
    if (sil) {
      const sb = new Bake();
      sb.add(Geo.cylZ(sil[0], sil[0], sil[1], low ? 8 : 16), C_DARK, { mat: 'metal', p: [0, mz[1], mz[2] - sil[1] / 2 + 0.005] });
      const sm = sb.build();
      sm.visible = false;
      g.add(sm);
      g.userData.silencer = sm;
      g.userData.muzzleSil = new THREE.Vector3(mz[0], mz[1], mz[2] - sil[1]);
    }
    Geo.detail = 1;
    return g;
  },
  setSilencer(g, on) {
    if (!g || !g.userData.silencer) return;
    g.userData.silencer.visible = !!on;
    g.userData.muzzle.copy(on ? g.userData.muzzleSil : g.userData.muzzlePlain);
  },

  nadeMesh(type) {
    const g = new THREE.Group();
    g.add(this.gun(type));
    g.scale.setScalar(1.4);
    return g;
  },
  bomb() { const g = this.gun('bomb'); g.scale.setScalar(1.5); return g; },

  // ---------------------------------------------------------------- first-person arms
  // origin = the weapon grip, weapon points -Z; elbows sit off-screen below the camera
  viewArms(pose, L) {
    const B = new Bake();
    const forearm = (wrist, elbow) => {
      const d = new THREE.Vector3().subVectors(elbow, wrist);
      B.limb(wrist, elbow, 0.036, 0.047, L.shirt, 18);
      B.add(Geo.cylY(0.04, 0.041, 0.05, 18), L.gloves, { p: wrist.clone().addScaledVector(d.clone().normalize(), 0.012).toArray(), q: quatTo(d) });
      B.add(Geo.cylY(0.0485, 0.0495, 0.018, 18, true), new THREE.Color(L.accent).multiplyScalar(0.6).getHex(), { p: wrist.clone().addScaledVector(d.clone().normalize(), 0.17).toArray(), q: quatTo(d) });
    };
    const fist = (c, r, size) => B.add(Geo.roundBox(size[0], size[1], size[2], 0.024, 18, 14), L.gloves, { p: c, r });
    const finger = (a, b, r) => B.limb(a, b, r || 0.0095, r || 0.0095, L.gloves, 10);
    const knuckles = (c, r, n, dx, dz) => { for (let i = 0; i < n; i++) B.add(Geo.ellipsoid(0.011, 0.011, 0.011, 10, 8), L.gloves, { p: [c[0] + dx * i, c[1] + r * i, c[2] + dz * i] }); };
    const rightGrip = (ox) => {
      ox = ox || 0;
      fist([ox, -0.05, 0.012], [-0.25, 0, 0], [0.07, 0.095, 0.072]);
      knuckles([ox - 0.018, -0.022, -0.03], -0.022, 3, 0, 0.003);
      finger(V3(ox + 0.012, -0.004, -0.004), V3(ox + 0.013, -0.016, -0.042));
      finger(V3(ox - 0.03, -0.012, 0.03), V3(ox - 0.032, 0.008, 0.0), 0.011);
      forearm(V3(ox + 0.012, -0.088, 0.045), V3(ox + 0.13, -0.3, 0.37));
    };
    switch (pose) {
      case 'rifle': case 'smg': case 'shotgun': case 'sniper': case 'mg': {
        rightGrip();
        const fz = pose === 'smg' ? -0.2 : pose === 'shotgun' ? -0.36 : pose === 'mg' ? -0.32 : -0.3;
        fist([-0.004, -0.022, fz], [0, 0, 0.35], [0.075, 0.058, 0.1]);
        knuckles([0.03, 0.0, fz - 0.035], 0, 4, 0, 0.024);
        finger(V3(-0.034, -0.006, fz + 0.03), V3(-0.026, 0.018, fz - 0.03), 0.011);
        forearm(V3(-0.03, -0.05, fz + 0.045), V3(-0.23, -0.3, fz + 0.36));
        break;
      }
      case 'pistol':
        rightGrip();
        fist([-0.03, -0.062, 0.018], [-0.25, 0, 0.35], [0.06, 0.08, 0.07]);
        finger(V3(-0.012, -0.03, 0.0), V3(0.008, -0.012, -0.03), 0.011);
        forearm(V3(-0.05, -0.09, 0.05), V3(-0.26, -0.31, 0.3));
        break;
      case 'pistolShield':
        rightGrip();
        break;
      case 'dual':
        rightGrip(0.13);
        fist([-0.13, -0.05, 0.012], [-0.25, 0, 0], [0.07, 0.095, 0.072]);
        knuckles([-0.112, -0.022, -0.03], -0.022, 3, 0, 0.003);
        finger(V3(-0.142, -0.004, -0.004), V3(-0.143, -0.016, -0.042));
        forearm(V3(-0.142, -0.088, 0.045), V3(-0.26, -0.3, 0.37));
        break;
      case 'knife':
        fist([0.0, -0.003, 0.052], [0, 0, 0], [0.066, 0.064, 0.1]);
        knuckles([-0.03, 0.022, 0.02], 0, 4, 0, 0.022);
        forearm(V3(0.012, -0.04, 0.1), V3(0.14, -0.3, 0.42));
        break;
      case 'grenade':
        fist([0.0, -0.045, 0.012], [-0.15, 0, 0], [0.07, 0.08, 0.07]);
        finger(V3(0.03, -0.02, -0.01), V3(0.035, 0.03, 0.0), 0.011);
        forearm(V3(0.012, -0.085, 0.04), V3(0.13, -0.3, 0.36));
        break;
      case 'bomb':
        fist([-0.115, -0.01, -0.05], [0, 0, 0.2], [0.06, 0.09, 0.09]);
        fist([0.115, -0.01, -0.05], [0, 0, -0.2], [0.06, 0.09, 0.09]);
        forearm(V3(-0.13, -0.05, -0.01), V3(-0.28, -0.3, 0.28));
        forearm(V3(0.13, -0.05, -0.01), V3(0.28, -0.3, 0.28));
        break;
    }
    return B.build(false);
  },
};

function nameTag(text, color) {
  const mat = new THREE.SpriteMaterial({ map: nameTagTexture(text, color), transparent: true, depthWrite: false, opacity: 0.9 });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.0, 0.25, 1);
  s.position.y = 2.15;
  s.renderOrder = 7;
  return s;
}

const _mzv = new THREE.Vector3();
function agentMuzzleWorld(a, out) {
  const m = a.model;
  if (m && m.gun) {
    m.root.updateMatrixWorld(true);
    _mzv.copy(m.gun.userData.muzzle);
    return m.gun.localToWorld(out.copy(_mzv));
  }
  return agentEye(a, out);
}

// ------------------------------------------------------------------ crates and shipping containers
function buildProps(scene) {
  const W = World.W, H = World.H;
  const buckets = {};
  const bucket = (k) => buckets[k] || (buckets[k] = { p: [], n: [], u: [], c: [] });
  // axis-aligned (optionally yawed) box; faces get 0..1 uvs scaled per face
  function box(key, cx, cy, cz, sx, sy, sz, yaw, col, uvScale, faces) {
    const b = bucket(key);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2, cs = Math.cos(yaw), sn = Math.sin(yaw);
    const F = {
      px: { v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], n: [1, 0, 0], w: sz, h: sy },
      nx: { v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], n: [-1, 0, 0], w: sz, h: sy },
      pz: { v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], n: [0, 0, 1], w: sx, h: sy },
      nz: { v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], n: [0, 0, -1], w: sx, h: sy },
      py: { v: [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]], n: [0, 1, 0], w: sx, h: sz },
    };
    for (const name of faces || ['px', 'nx', 'pz', 'nz', 'py']) {
      const f = F[name];
      const us = uvScale ? uvScale(name, f.w, f.h) : [1, 1];
      const uv = [[0, 0], [us[0], 0], [us[0], us[1]], [0, us[1]]];
      const nx = f.n[0] * cs + f.n[2] * sn, nz = -f.n[0] * sn + f.n[2] * cs;
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const v = f.v[i];
        b.p.push(cx + v[0] * cs + v[2] * sn, cy + v[1], cz - v[0] * sn + v[2] * cs);
        b.n.push(nx, f.n[1], nz);
        b.u.push(uv[i][0], uv[i][1]);
        b.c.push(col[0], col[1], col[2]);
      }
    }
  }

  // crates: each 1 m crate cell becomes a tidy stack of real-sized crates
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
    const ch = World.kindAt(cx, cz);
    if (ch !== 'c' && ch !== 'C') continue;
    const rnd = mulberry32(cx * 73856093 ^ cz * 19349663);
    const x0 = cx * CELL, z0 = cz * CELL;
    const levels = ch === 'C' ? 2 : 1;
    for (let lv = 0; lv < levels; lv++) {
      const y0 = lv * 1.0;
      const r = rnd();
      const list = [];
      if (r < 0.3) list.push([1.0, 1.0, 1.9, 1.9]);
      else if (r < 0.65) { if (rnd() < 0.5) list.push([0.52, 1.0, 0.94, 1.9], [1.48, 1.0, 0.94, 1.9]); else list.push([1.0, 0.52, 1.9, 0.94], [1.0, 1.48, 1.9, 0.94]); }
      else list.push([0.52, 0.52, 0.94, 0.94], [1.48, 0.52, 0.94, 0.94], [0.52, 1.48, 0.94, 0.94], [1.48, 1.48, 0.94, 0.94]);
      for (const [ox, oz, sx, sz] of list) {
        const t = 0.86 + rnd() * 0.2, tone = [t, t * (0.96 + rnd() * 0.06), t * (0.9 + rnd() * 0.1)];
        const hgt = 0.95 + rnd() * 0.035;
        box(rnd() < 0.5 ? 'crate' : 'crate2', x0 + ox + (rnd() - 0.5) * 0.02, y0 + hgt / 2, z0 + oz + (rnd() - 0.5) * 0.02, sx, hgt, sz, (rnd() - 0.5) * 0.04, tone);
      }
    }
  }

  // containers: one corrugated steel box per connected run of container cells
  const seen = new Uint8Array(W * H);
  let cid = 0;
  for (let i = 0; i < W * H; i++) {
    const ch = World.kinds[i];
    if ((ch !== 'x' && ch !== 'X') || seen[i]) continue;
    const cells = [], stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop(); cells.push(c);
      const x = c % W, z = (c / W) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (!World.inB(nx, nz)) continue;
        const n = nz * W + nx;
        if (!seen[n] && World.kinds[n] === ch) { seen[n] = 1; stack.push(n); }
      }
    }
    let mnx = 99, mxx = -1, mnz = 99, mxz = -1;
    for (const c of cells) { const x = c % W, z = (c / W) | 0; mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mnz = Math.min(mnz, z); mxz = Math.max(mxz, z); }
    const sx = (mxx - mnx + 1) * CELL, sz = (mxz - mnz + 1) * CELL;
    const along = sx >= sz;
    const cxw = mnx * CELL + sx / 2, czw = mnz * CELL + sz / 2;
    const levels = ch === 'X' ? 2 : 1;
    for (let lv = 0; lv < levels; lv++) {
      const pal = CONTAINER_PAL[(cid * 7 + 3 + lv * 2) % CONTAINER_PAL.length];
      const y = lv * 2.6;
      const bx = sx - 0.06, bz = sz - 0.06, bh = 2.56;
      const uv = (face, w, h) => {
        const end = along ? (face === 'px' || face === 'nx') : (face === 'pz' || face === 'nz');
        if (face === 'py') return [w / 2, h / 2];
        return end ? [1, 1] : [w / 2, 1];
      };
      const sides = along ? ['pz', 'nz', 'py'] : ['px', 'nx', 'py'];
      const ends = along ? ['px', 'nx'] : ['pz', 'nz'];
      box('cside', cxw, y + bh / 2 + 0.02, czw, bx, bh, bz, 0, pal, uv, sides);
      box('cdoor', cxw, y + bh / 2 + 0.02, czw, bx, bh, bz, 0, pal, uv, ends);
      const fr = [pal[0] * 0.55, pal[1] * 0.55, pal[2] * 0.55];
      const hx = sx / 2 - 0.06, hz = sz / 2 - 0.06;
      for (const [px, pz] of [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]]) box('cframe', cxw + px, y + 1.3, czw + pz, 0.12, 2.6, 0.12, 0, fr);
      if (along) {
        for (const pz of [-hz, hz]) for (const py of [0.06, 2.54]) box('cframe', cxw, y + py, czw + pz, sx - 0.02, 0.12, 0.1, 0, fr);
        for (const px of [-hx, hx]) box('cframe', cxw + px, y + 2.54, czw, 0.1, 0.12, sz - 0.02, 0, fr);
      } else {
        for (const px of [-hx, hx]) for (const py of [0.06, 2.54]) box('cframe', cxw + px, y + py, czw, 0.1, 0.12, sz - 0.02, 0, fr);
        for (const pz of [-hz, hz]) box('cframe', cxw, y + 2.54, czw + pz, sx - 0.02, 0.12, 0.1, 0, fr);
      }
    }
    cid++;
  }

  const texFor = { crate: TEX.crateSq, crate2: TEX.crateSq2, cside: TEX.container, cdoor: TEX.containerDoor, cframe: null };
  for (const key in buckets) {
    const b = buckets[key];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({ map: texFor[key] || null, vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
  }
}
