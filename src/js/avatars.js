'use strict';
/* =========================================================
   avatars.js — realistic people. Rigged, textured human
   models from the Microsoft Rocketbox Avatar Library (MIT
   licence) driven by motion-captured idle / walk / jog / run
   / crouch clips. Arms are solved with IK onto the weapon in
   hand, the torso and head turn toward where they aim, legs
   turn toward the direction they move.
   ========================================================= */

// outfits: avatar = model key; shirt / gloves / accent colour the first-person arms
const BARE = 0xc79c80;
const SKINS = [
  [ // police: 红隼特勤队
    { name: '特警突击手', desc: '黑色战术服 · 头盔和面罩', avatar: 'swat', shirt: 0x25282c, gloves: 0x17181a, accent: 0x5ec4ff },
    { name: '红贝雷特勤', desc: '黑色勤务服 · 红色贝雷帽', avatar: 'beret', shirt: BARE, gloves: BARE, accent: 0x1c1d20 },
    { name: '便衣探员', desc: '短袖 · 防弹背心 · 牛仔裤', avatar: 'plain', shirt: BARE, gloves: BARE, accent: 0x2c3a52 },
    { name: '蓝衣巡警', desc: '蓝色作训服 · 警帽', avatar: 'patrol', shirt: 0x58789c, gloves: BARE, accent: 0x34495e },
  ],
  [ // militants: 毒蝰武装
    { name: '老枪手', desc: '野战背心 · 橄榄色外套', avatar: 'vest', shirt: 0x4d5639, gloves: BARE, accent: 0x6b5a3a },
    { name: '爆破手', desc: '毛线帽 · 格子衬衫', avatar: 'beanie', shirt: 0x7c2a22, gloves: BARE, accent: 0x3a2a22 },
    { name: '街头枪手', desc: '黑色夹克 · 工装裤', avatar: 'jacket', shirt: 0x24262a, gloves: BARE, accent: 0x3b5b8a },
    { name: '游击队员', desc: '棕色连帽衫 · 牛仔裤', avatar: 'hoodie', shirt: 0x54392b, gloves: BARE, accent: 0x2e2a26 },
  ],
];
const HOSTAGE_AVATARS = ['suit', 'lady', 'shirt', 'suit'];

const _av = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), e: new THREE.Vector3(), f: new THREE.Vector3(), g: new THREE.Vector3(), t: new THREE.Vector3(), p: new THREE.Vector3(), s: new THREE.Vector3() };
const _aq = { a: new THREE.Quaternion(), b: new THREE.Quaternion(), c: new THREE.Quaternion(), d: new THREE.Quaternion() };
const _am = { a: new THREE.Matrix4(), b: new THREE.Matrix4() };
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _dp = new THREE.Vector3(), _ds = new THREE.Vector3();

// ---------------------------------------------------------------- bone helpers (world space)
function bonePos(b, out) { return out.setFromMatrixPosition(b.matrixWorld); }
function boneQuat(b, out) { b.matrixWorld.decompose(_dp, out, _ds); return out; }
// apply a world-space rotation to a bone, keeping its children attached
function rotateWorld(bone, q) {
  boneQuat(bone.parent, _aq.d);
  _aq.c.copy(_aq.d).invert().multiply(q).multiply(_aq.d);
  bone.quaternion.premultiply(_aq.c);
  bone.updateMatrixWorld(true);
}
function setWorldQuat(bone, q) {
  boneQuat(bone.parent, _aq.d);
  bone.quaternion.copy(_aq.d.invert().multiply(q));
  bone.updateMatrixWorld(true);
}
// rotate a bone so that its local direction `dirLocal` points along `target` (world), by fraction k
function aimBone(bone, dirLocal, target, k) {
  boneQuat(bone, _aq.a);
  const cur = _av.f.copy(dirLocal).applyQuaternion(_aq.a).normalize();
  _aq.b.setFromUnitVectors(cur, _av.g.copy(target).normalize());
  if (k < 1) _aq.b.slerp(_aq.c.identity(), 1 - k);
  rotateWorld(bone, _aq.b);
}
// two-bone IK: upper/lower/end bones, world target, world pole direction (where the elbow or knee points)
function ik2(upper, lower, end, target, pole) {
  const A = bonePos(upper, _av.a), B = bonePos(lower, _av.b), C = bonePos(end, _av.c);
  const l1 = A.distanceTo(B), l2 = B.distanceTo(C);
  const D = _av.d.copy(target).sub(A);
  const d = clamp(D.length(), Math.abs(l1 - l2) + 1e-4, (l1 + l2) * 0.999);
  D.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const P = _av.e.copy(pole).addScaledVector(D, -pole.dot(D));
  if (P.lengthSq() < 1e-8) P.set(0, -1, 0); P.normalize();
  const E = _av.t.copy(A).addScaledVector(D, x).addScaledVector(P, h);
  const T = _av.p.copy(A).addScaledVector(D, d);
  _aq.b.setFromUnitVectors(_av.f.copy(B).sub(A).normalize(), _av.g.copy(E).sub(A).normalize());
  rotateWorld(upper, _aq.b);
  bonePos(lower, B); bonePos(end, C);
  _aq.b.setFromUnitVectors(_av.f.copy(C).sub(B).normalize(), _av.g.copy(T).sub(B).normalize());
  rotateWorld(lower, _aq.b);
}
// world rotation that maps the local (finger, palm) frame onto the desired world (finger, palm) directions
function frameQuat(fL, nL, F, N, out) {
  const x0 = _av.a.copy(fL).normalize(), y0 = _av.b.copy(nL).addScaledVector(x0, -nL.dot(x0)).normalize(), z0 = _av.c.crossVectors(x0, y0);
  const x1 = _av.d.copy(F).normalize(), y1 = _av.e.copy(N).addScaledVector(x1, -N.dot(x1)).normalize(), z1 = _av.t.crossVectors(x1, y1);
  _am.a.makeBasis(x1, y1, z1); _am.b.makeBasis(x0, y0, z0).transpose();
  return out.setFromRotationMatrix(_am.a.multiply(_am.b));
}

// ---------------------------------------------------------------- asset loading
const Avatars = {
  ready: false, defs: {}, clips: {}, baseY: 89.5,

  async load() {
    const el = document.getElementById('kestrel-assets');
    if (!el) throw new Error('avatar assets missing');
    const A = JSON.parse(el.textContent);
    el.textContent = '';
    const man = A.manifest, files = A.files;
    const bin = (name) => { const s = atob(files[name]); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
    const aniso = Math.min(4, R.renderer.capabilities.getMaxAnisotropy());
    const texture = (name) => new Promise((res) => {
      if (!name || !files[name]) { res(null); return; }
      const img = new Image();
      img.onload = () => { const t = new THREE.Texture(img); t.anisotropy = aniso; t.needsUpdate = true; res(t); };
      img.onerror = () => res(null);
      img.src = 'data:image/webp;base64,' + files[name];
    });
    // animation clips
    const abuf = bin('anims.bin');
    for (const k in man.clips) {
      const c = man.clips[k];
      const qi = new Int16Array(abuf, c.off, c.qLen), yi = new Int16Array(abuf, c.off + c.qLen * 2, c.yLen);
      const q = new Float32Array(qi.length); for (let i = 0; i < qi.length; i++) q[i] = qi[i] / 32767;
      const y = new Float32Array(yi.length); for (let i = 0; i < yi.length; i++) y[i] = yi[i] / 10;
      this.clips[k] = { name: k, bones: c.bones, nb: c.bones.length, frames: c.frames, fps: c.fps, dur: c.dur, speed: c.speed, cycle: c.speed * c.dur, q, y };
    }
    let ys = 0; const idle = this.clips.idle; for (let i = 0; i < idle.frames; i++) ys += idle.y[i]; this.baseY = ys / idle.frames;
    // avatars: geometry and materials shared by every instance
    const jobs = [];
    for (const key in man.avatars) {
      const m = man.avatars[key];
      jobs.push(Promise.all(m.mats.map((mt) => Promise.all([texture(mt.color), texture(mt.normal)]))).then((texs) => {
        this.defs[key] = this.makeDef(key, m, bin(key + '.bin'), bin(key + '.inv'), texs);
      }));
    }
    await Promise.all(jobs);
    this.ready = true;
  },

  makeDef(key, m, buf, invBuf, texs) {
    const V = m.V;
    const pq = new Uint16Array(buf, m.off.pos, V * 3), nq = new Int8Array(buf, m.off.nrm, V * 3), uq = new Uint16Array(buf, m.off.uv, V * 2);
    const pos = new Float32Array(V * 3), nrm = new Float32Array(V * 3), uv = new Float32Array(V * 2);
    for (let i = 0; i < V; i++) {
      for (let c = 0; c < 3; c++) pos[i * 3 + c] = m.min[c] + pq[i * 3 + c] / 65535 * (m.max[c] - m.min[c]);
      const nx = nq[i * 3] / 127, ny = nq[i * 3 + 1] / 127, nz = nq[i * 3 + 2] / 127, l = Math.hypot(nx, ny, nz) || 1;
      nrm[i * 3] = nx / l; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l;
      for (let c = 0; c < 2; c++) uv[i * 2 + c] = m.umin[c] + uq[i * 2 + c] / 65535 * (m.umax[c] - m.umin[c]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(buf, m.off.si, V * 4), 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Uint8Array(buf, m.off.sw, V * 4), 4, true));
    geo.setIndex(new THREE.BufferAttribute(m.big ? new Uint32Array(buf, m.off.idx, m.I) : new Uint16Array(buf, m.off.idx, m.I), 1));
    for (const g of m.groups) geo.addGroup(g.start, g.count, g.mat);
    geo.computeBoundingSphere();
    const invF = new Float32Array(invBuf);
    const inverses = m.bones.map((b, i) => new THREE.Matrix4().fromArray(invF, i * 16));
    const mats = m.mats.map((mt, i) => {
      const [map, normalMap] = texs[i];
      const skin = mt.key === 'head', metal = mt.key === 'pistol' || mt.key === 'helmet';
      const mat = new THREE.MeshStandardMaterial({ skinning: true, map, normalMap, roughness: skin ? 0.6 : metal ? 0.5 : 0.86, metalness: mt.key === 'pistol' ? 0.35 : 0 });
      mat.envMapIntensity = skin ? 0.45 : 0.6;
      if (normalMap) mat.normalScale.set(0.9, 0.9);
      if (mt.alpha) {
        if (mt.key === 'glasses') { mat.transparent = true; mat.depthWrite = false; mat.roughness = 0.15; }
        else { mat.alphaTest = 0.45; mat.side = THREE.DoubleSide; }
      }
      return mat;
    });
    const def = { key, m, geo, mats, inverses, bind: new THREE.Matrix4().fromArray(m.bind) };
    // the clip channel -> bone index table, and rest-pose measurements used by the IK
    def.boneIndex = {}; m.bones.forEach((b, i) => { def.boneIndex[b.n] = i; });
    def.clipMap = {};
    for (const k in this.clips) def.clipMap[k] = this.clips[k].bones.map((n) => (def.boneIndex[n] == null ? -1 : def.boneIndex[n]));
    this.measure(def);
    return def;
  },

  // rest-pose frames: hand finger/palm directions, finger curl axes, chest and head forward axes
  measure(def) {
    const rig = new Rig(def, true);
    rig.root.updateMatrixWorld(true);
    const B = rig.b, P = (b) => bonePos(b, new THREE.Vector3()), Q = (b) => boneQuat(b, new THREE.Quaternion());
    def.hand = {};
    for (const s of ['L', 'R']) {
      const hand = B[s + 'Hand'], fing = rig.fingers[s];
      const w = P(hand), mid = P(fing[2][0]), thumb = P(fing[0][0]), pinky = P(fing[4][0]);
      const f = mid.clone().sub(w).normalize(), side = thumb.clone().sub(pinky).normalize();
      let n = new THREE.Vector3().crossVectors(f, side).normalize();
      if (n.y > 0) n.negate(); // palms face down in the bind pose
      const hq = Q(hand).invert();
      const curls = [];
      fing.forEach((chain, ci) => chain.forEach((seg, si) => {
        const p0 = P(seg), next = chain[si + 1] ? P(chain[si + 1]) : null;
        const dir = next ? next.sub(p0).normalize() : (si > 0 ? p0.clone().sub(P(chain[si - 1])).normalize() : f.clone());
        const axis = new THREE.Vector3().crossVectors(dir, n).normalize();
        const local = axis.applyQuaternion(Q(seg).invert());
        curls.push({ bone: def.boneIndex[seg.name], finger: ci, seg: si, axis: local, rest: seg.quaternion.clone() });
      }));
      def.hand[s] = { f: f.applyQuaternion(hq), n: n.applyQuaternion(hq), curls };
    }
    // avatars face +Z in their own space
    const fwd = new THREE.Vector3(0, 0, 1);
    def.chestFwd = fwd.clone().applyQuaternion(Q(B.spine2).invert());
    def.headFwd = fwd.clone().applyQuaternion(Q(B.head).invert());
    def.hipY = B.hip.position.y;
    def.restLocal = rig.bones.map((b) => b.quaternion.clone());
  },
};

// ---------------------------------------------------------------- one rigged person
const BONE_KEYS = {
  hip: 'Bip01', pelvis: 'Bip01_Pelvis', spine: 'Bip01_Spine', spine1: 'Bip01_Spine1', spine2: 'Bip01_Spine2', neck: 'Bip01_Neck', head: 'Bip01_Head',
  LClav: 'Bip01_L_Clavicle', LUp: 'Bip01_L_UpperArm', LFore: 'Bip01_L_Forearm', LHand: 'Bip01_L_Hand',
  RClav: 'Bip01_R_Clavicle', RUp: 'Bip01_R_UpperArm', RFore: 'Bip01_R_Forearm', RHand: 'Bip01_R_Hand',
  LThigh: 'Bip01_L_Thigh', LCalf: 'Bip01_L_Calf', LFoot: 'Bip01_L_Foot', RThigh: 'Bip01_R_Thigh', RCalf: 'Bip01_R_Calf', RFoot: 'Bip01_R_Foot',
};
class Rig {
  constructor(def, measuring) {
    this.def = def;
    const m = def.m;
    this.root = new THREE.Group();
    this.root.scale.setScalar(0.01); // centimetres -> metres
    this.bones = m.bones.map((b) => { const o = new THREE.Bone(); o.name = b.n; o.position.fromArray(b.t); o.quaternion.fromArray(b.q); o.scale.fromArray(b.s); return o; });
    m.bones.forEach((b, i) => { (b.p >= 0 ? this.bones[b.p] : this.root).add(this.bones[i]); });
    this.mesh = new THREE.SkinnedMesh(def.geo, def.mats);
    this.mesh.position.fromArray(m.meshT); this.mesh.quaternion.fromArray(m.meshQ); this.mesh.scale.fromArray(m.meshS);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.mesh.bind(new THREE.Skeleton(this.bones, def.inverses), def.bind);
    this.b = {};
    for (const k in BONE_KEYS) this.b[k] = this.bones[def.boneIndex[BONE_KEYS[k]]];
    this.fingers = {};
    for (const s of ['L', 'R']) {
      this.fingers[s] = [0, 1, 2, 3, 4].map((f) => ['', '1', '2'].map((seg) => this.bones[def.boneIndex[`Bip01_${s}_Finger${f}${seg}`]]).filter(Boolean));
    }
    // animation state
    this.phase = Math.random(); this.idleT = Math.random() * 10; this.crouchT = Math.random() * 5;
    this.legYaw = 0; this.dir = 1;
    this.acc = new Float32Array(this.bones.length * 4); this.accW = new Float32Array(this.bones.length);
    this.top = this.root; // the outermost group; set by wrapRig so world matrices refresh from the agent down
    if (!measuring) this.restLocal = def.restLocal;
  }

  // blend clips into the bone rotations; weights: { clipName: [weight, time] }
  pose(weights) {
    const def = this.def, bones = this.bones;
    let first = true;
    let hipY = 0, wsum = 0;
    for (const k in weights) {
      const [w, t] = weights[k];
      if (w <= 0.001) continue;
      const c = Avatars.clips[k], map = def.clipMap[k];
      const ft = (t / c.dur) * (c.frames - 1);
      const f0 = Math.floor(ft) % c.frames, f1 = (f0 + 1) % c.frames, al = ft - Math.floor(ft);
      const nb = c.nb, q = c.q;
      for (let j = 0; j < nb; j++) {
        const bi = map[j];
        if (bi < 0) continue;
        const o0 = (f0 * nb + j) * 4, o1 = (f1 * nb + j) * 4;
        let x = q[o0] + (q[o1] - q[o0]) * al, y = q[o0 + 1] + (q[o1 + 1] - q[o0 + 1]) * al, z = q[o0 + 2] + (q[o1 + 2] - q[o0 + 2]) * al, ww = q[o0 + 3] + (q[o1 + 3] - q[o0 + 3]) * al;
        const a = bi * 4, acc = this.acc;
        if (first || this.accW[bi] === 0) { acc[a] = x * w; acc[a + 1] = y * w; acc[a + 2] = z * w; acc[a + 3] = ww * w; this.accW[bi] = w; }
        else {
          if (acc[a] * x + acc[a + 1] * y + acc[a + 2] * z + acc[a + 3] * ww < 0) { x = -x; y = -y; z = -z; ww = -ww; }
          acc[a] += x * w; acc[a + 1] += y * w; acc[a + 2] += z * w; acc[a + 3] += ww * w; this.accW[bi] += w;
        }
      }
      const yv = c.y[f0] + (c.y[f1] - c.y[f0]) * al;
      hipY += (yv - Avatars.baseY) * w; wsum += w;
      first = false;
    }
    for (let bi = 0; bi < bones.length; bi++) {
      if (this.accW[bi] > 0) {
        const a = bi * 4, acc = this.acc;
        const l = Math.hypot(acc[a], acc[a + 1], acc[a + 2], acc[a + 3]) || 1;
        bones[bi].quaternion.set(acc[a] / l, acc[a + 1] / l, acc[a + 2] / l, acc[a + 3] / l);
        this.accW[bi] = 0;
      }
    }
    this.b.hip.position.y = def.hipY + (wsum ? hipY / wsum : 0);
  }

  // locomotion: speed in m/s, rel = move direction relative to facing (radians), crouch 0..1
  locomote(dt, speed, rel, crouch, hostage) {
    const C = Avatars.clips;
    const moving = clamp((speed - 0.2) / 0.7, 0, 1);
    // which gait: walk -> jog -> run
    let wW = 1, wJ = 0, wR = 0;
    if (speed > 2.0 && !hostage) { const k = clamp((speed - 2.0) / 1.4, 0, 1); wW = 1 - k; wJ = k; }
    if (speed > 3.4 && !hostage) { const k = clamp((speed - 3.4) / 1.4, 0, 1); wJ = 1 - k; wR = k; }
    const cycle = wW * C.walk.cycle + wJ * C.jog.cycle + wR * C.run.cycle * 1.25;
    // legs face the way they move; backpedalling plays the cycle in reverse
    let legTarget = 0, dir = 1;
    if (moving > 0.05) {
      if (Math.abs(rel) > 1.95) { legTarget = wrapAngle(rel + Math.PI); dir = -1; }
      else legTarget = clamp(rel, -1.35, 1.35);
    }
    this.legYaw = damp(this.legYaw, legTarget, 10, dt);
    this.dir = dir;
    this.phase = (this.phase + dir * dt * speed / Math.max(0.5, cycle) + 1) % 1;
    this.idleT += dt; this.crouchT += dt;
    const still = 1 - moving, crouchStill = crouch * still;
    const weights = {
      idle: [still * (1 - crouch), this.idleT % C.idle.dur],
      crouch: [crouchStill, this.crouchT % C.crouch.dur],
      walk: [moving * wW, this.phase * C.walk.dur],
      jog: [moving * wJ, this.phase * C.jog.dur],
      run: [moving * wR, this.phase * C.run.dur],
    };
    this.pose(weights);
    this.top.updateMatrixWorld(true);
    if (Math.abs(this.legYaw) > 1e-3) { _aq.a.setFromAxisAngle(Y_AXIS, this.legYaw); rotateWorld(this.b.hip, _aq.a); }
    // crouch-walk: drop the hips and bend the knees so the feet stay where the walk cycle put them
    const cm = crouch * moving;
    if (cm > 0.01) {
      const B = this.b, fl = bonePos(B.LFoot, new THREE.Vector3()), fr = bonePos(B.RFoot, new THREE.Vector3());
      B.hip.position.y -= 44 * cm;
      B.hip.updateMatrixWorld(true);
      boneQuat(this.root, _aq.a);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(_aq.a).applyAxisAngle(Y_AXIS, this.legYaw);
      const knee = new THREE.Vector3().copy(fwd);
      ik2(B.LThigh, B.LCalf, B.LFoot, fl, knee);
      ik2(B.RThigh, B.RCalf, B.RFoot, fr, knee);
      _aq.a.setFromAxisAngle(_av.g.crossVectors(Y_AXIS, fwd).normalize(), 0.22 * cm);
      rotateWorld(B.spine, _aq.a);
    }
  }

  // turn the upper body so the chest faces `aim` (world unit vector): spread over the spine
  aimChest(aim, k) {
    const B = this.b, def = this.def;
    aimBone(B.spine, def.chestFwd.clone().applyQuaternion(this.relQ(B.spine2, B.spine)), aim, 0.35 * k);
    aimBone(B.spine1, def.chestFwd.clone().applyQuaternion(this.relQ(B.spine2, B.spine1)), aim, 0.5 * k);
    aimBone(B.spine2, def.chestFwd, aim, k);
  }
  aimHead(aim, k) { aimBone(this.b.head, this.def.headFwd, aim, k); }
  // rotation of `child` relative to `ancestor` (both current), used to express the chest axis in a lower bone's frame
  relQ(child, ancestor) {
    boneQuat(ancestor, _aq.a); boneQuat(child, _aq.b);
    return _aq.a.invert().multiply(_aq.b).clone();
  }

  // place a hand: IK the arm to `target`, then orient the hand (finger dir F, palm normal N, world) and curl the fingers
  reach(side, target, pole, F, N, curl) {
    const B = this.b;
    ik2(B[side + 'Up'], B[side + 'Fore'], B[side + 'Hand'], target, pole);
    if (F && N) { const h = this.def.hand[side]; setWorldQuat(B[side + 'Hand'], frameQuat(h.f, h.n, F, N, _aq.a)); }
    if (curl) this.curl(side, curl);
  }
  // curl: [thumb, index, middle, ring, pinky] angles in radians (per segment)
  curl(side, curl) {
    const h = this.def.hand[side];
    for (const c of h.curls) {
      const bone = this.bones[c.bone];
      const ang = curl[c.finger] * (c.seg === 0 ? 0.8 : c.seg === 1 ? 1.1 : 0.9);
      bone.quaternion.copy(c.rest).multiply(_aq.a.setFromAxisAngle(c.axis, ang));
    }
    this.b[side + 'Hand'].updateMatrixWorld(true);
  }
}

// ---------------------------------------------------------------- how weapons are held
// gun holder offset from the shoulder midpoint (agent space: +x right, +y up, -z forward), grips in gun space
// long guns (shoulder: true) are placed from the right shoulder joint with the torso bladed; the rest from the shoulder midpoint
const GRIPS = {
  rifle: { shoulder: true, o: [-0.04, -0.06, -0.3], R: [0, -0.075, 0.045], L: [-0.032, -0.055, -0.25] },
  smg: { shoulder: true, o: [-0.03, -0.08, -0.3], R: [0, -0.075, 0.04], L: [-0.03, -0.06, -0.17] },
  shotgun: { shoulder: true, o: [-0.04, -0.06, -0.3], R: [0, -0.075, 0.05], L: [-0.034, -0.065, -0.3] },
  sniper: { shoulder: true, o: [-0.04, -0.05, -0.32], R: [0, -0.075, 0.05], L: [-0.032, -0.055, -0.28] },
  mg: { shoulder: true, o: [-0.02, -0.1, -0.3], R: [0, -0.075, 0.05], L: [-0.036, -0.07, -0.3] },
  pistol: { o: [0.03, -0.1, -0.5], R: [0, -0.07, 0.035], L: [-0.015, -0.08, 0.03] },
  dual: { o: [0.17, -0.12, -0.46], R: [0, -0.07, 0.035] },
  shield: { o: [0.2, -0.12, -0.42], R: [0, -0.07, 0.035] },
  knife: { o: [0.2, -0.36, -0.3], R: [0, 0, 0.04] },
  grenade: { o: [0.2, -0.02, -0.16], R: [0, -0.02, 0.02] },
  bomb: { o: [0, -0.4, -0.3], R: [0.11, 0, 0], L: [-0.11, 0, 0] },
};
const CURL_GRIP = [0.35, 0.45, 1.15, 1.2, 1.2], CURL_SUPPORT = [0.3, 0.85, 0.95, 1.0, 1.05], CURL_FIST = [0.5, 1.2, 1.25, 1.25, 1.25];
function holdKind(a) {
  if (shieldActive(a)) return 'shield';
  const w = curWeapon(a);
  if (!w) return 'knife';
  if (w.kind === 'pistol') return w.dual ? 'dual' : 'pistol';
  if (w.kind === 'knife' || w.kind === 'grenade' || w.kind === 'bomb') return w.kind;
  return w.kind;
}

// ---------------------------------------------------------------- characters
function wrapRig(rig) {
  const root = new THREE.Group(), body = new THREE.Group(), flip = new THREE.Group();
  flip.rotation.y = Math.PI; // the avatars face +Z, agents face -Z
  flip.add(rig.root); body.add(flip); root.add(body);
  rig.top = root;
  return { root, body, rig };
}
Models.character = function (team, seed, skinIdx) {
  const L = SKINS[team][skinIdx == null ? seed % 4 : skinIdx];
  const m = wrapRig(new Rig(Avatars.defs[L.avatar]));
  m.gunHolder = new THREE.Group(); m.root.add(m.gunHolder);
  m.gunHolder2 = new THREE.Group(); m.root.add(m.gunHolder2);
  m.shield = Models.shield(); m.shield.visible = false; m.root.add(m.shield);
  m.gun = null; m.gunId = null; m.gun2 = null; m.tag = null; m.kind = '';
  return m;
};
Models.hostage = function (seed) {
  const m = wrapRig(new Rig(Avatars.defs[HOSTAGE_AVATARS[seed % HOSTAGE_AVATARS.length]]));
  return m;
};

const _w = { s: new THREE.Vector3(), aim: new THREE.Vector3(), fw: new THREE.Vector3(), up: new THREE.Vector3(), rt: new THREE.Vector3(), t: new THREE.Vector3(), t2: new THREE.Vector3(), pole: new THREE.Vector3(), F: new THREE.Vector3(), N: new THREE.Vector3(), q: new THREE.Quaternion() };
function moveRel(a) {
  const sp = Math.hypot(a.vel.x, a.vel.z);
  return { sp, rel: sp > 0.2 ? angleDiff(a.yaw, yawTo(a.vel.x, a.vel.z)) : 0 };
}

// visual update of a soldier: called once per rendered frame
function updateAgentModel(a, dt) {
  const m = a.model;
  if (!m) return;
  m.root.position.set(a.pos.x, a.pos.y, a.pos.z);
  m.root.rotation.y = a.yaw;
  const rig = m.rig;
  if (a.alive && m.dying) { m.body.rotation.set(0, 0, 0); m.body.position.y = 0; m.dying = 0; }
  m.root.updateMatrixWorld(true);
  if (!a.alive) {
    deathPose(m, a, dt);
    if (m.tag) m.tag.visible = false;
    m.shield.visible = false; m.gunHolder.visible = false; m.gunHolder2.visible = false;
    return;
  }
  m.gunHolder.visible = true;
  const { sp, rel } = moveRel(a);
  rig.locomote(dt, sp, rel, a.crouch, false);

  // aim: chest and head turn toward the view direction
  const pitch = clamp(a.pitch, -1.2, 1.2);
  const aim = dirFromAngles(a.yaw, pitch, _w.aim);
  const kind = holdKind(a);
  const G_ = GRIPS[kind] || GRIPS.rifle;
  // long guns: blade the torso (left shoulder forward) so the support hand reaches the handguard
  rig.aimChest(dirFromAngles(a.yaw - (G_.shoulder ? 0.52 : 0), pitch * 0.55, _w.t), 1);
  rig.aimHead(aim, 1);

  // weapon in hand
  const gid = curWeaponId(a);
  if (m.gunId !== gid) {
    if (m.gun) m.gunHolder.remove(m.gun);
    if (m.gun2) { m.gunHolder2.remove(m.gun2); m.gun2 = null; }
    m.gun = gid ? Models.gun(gid, true) : null;
    if (m.gun) m.gunHolder.add(m.gun);
    if (gid && WEAPONS[gid] && WEAPONS[gid].dual) { m.gun2 = Models.gun(gid, true); m.gunHolder2.add(m.gun2); }
    m.gunId = gid;
  }
  const inst = curGun(a);
  if (m.gun) Models.setSilencer(m.gun, inst && inst.sil);
  // anchor: right shoulder joint for long guns, shoulder midpoint otherwise (agent space)
  const B = rig.b;
  bonePos(B.RUp, _w.s);
  if (!G_.shoulder) { bonePos(B.LUp, _w.t2); _w.s.add(_w.t2).multiplyScalar(0.5); }
  m.root.worldToLocal(_w.s);
  const cp = Math.cos(pitch), spn = Math.sin(pitch);
  const ox = G_.o[0], oy = G_.o[1] - (kind === 'knife' ? a.crouch * 0.05 : 0), oz = G_.o[2];
  m.gunHolder.position.set(_w.s.x + ox, _w.s.y + oy * cp + (-oz) * spn, _w.s.z + oz * cp + oy * spn);
  m.gunHolder.rotation.set(kind === 'knife' || kind === 'bomb' ? pitch * 0.3 : kind === 'grenade' ? 0.6 : pitch, 0, 0);
  m.gunHolder2.visible = kind === 'dual';
  if (kind === 'dual') { m.gunHolder2.position.copy(m.gunHolder.position); m.gunHolder2.position.x = _w.s.x - ox; m.gunHolder2.rotation.copy(m.gunHolder.rotation); }
  m.root.updateMatrixWorld(true);

  if (kind === 'shield') placeShield(m, a);
  holdWith(rig, kind, m.gunHolder, m.gunHolder2, m.shield);
  if (kind !== 'shield') m.shield.visible = false;
  if (m.tag) m.tag.visible = !G.player || (G.player.team === a.team && a !== G.player);
}
// put the hands on whatever is held: `gun` / `gun2` are objects whose local space matches the gun models
const _hq = new THREE.Quaternion(), _hp = new THREE.Vector3(), _hs = new THREE.Vector3();
function holdWith(rig, kind, gun, gun2, shield) {
  const G_ = GRIPS[kind] || GRIPS.rifle;
  gun.matrixWorld.decompose(_hp, _hq, _hs);
  const fw = _w.fw.set(0, 0, -1).applyQuaternion(_hq), up = _w.up.set(0, 1, 0).applyQuaternion(_hq), rt = _w.rt.set(1, 0, 0).applyQuaternion(_hq);
  const grip = (h, p, out) => out.fromArray(p).applyMatrix4(h.matrixWorld);
  // right hand on the grip
  grip(gun, G_.R, _w.t);
  _w.pole.copy(up).multiplyScalar(-1).addScaledVector(rt, 0.55).addScaledVector(fw, -0.25);
  _w.F.copy(fw).addScaledVector(up, -0.3); _w.N.copy(rt).multiplyScalar(-1).addScaledVector(up, 0.15);
  if (kind === 'knife') { _w.F.copy(fw).addScaledVector(up, 0.4); _w.N.copy(rt).multiplyScalar(-1); }
  if (kind === 'grenade') { _w.F.copy(up).addScaledVector(fw, 0.3); _w.N.copy(fw); }
  if (kind === 'bomb') { _w.F.copy(fw); _w.N.copy(rt).multiplyScalar(-1); }
  rig.reach('R', _w.t, _w.pole, _w.F, _w.N, kind === 'knife' || kind === 'grenade' || kind === 'bomb' ? CURL_FIST : CURL_GRIP);
  // left hand: support grip, second pistol, the shield handle, the bomb; free otherwise
  if (kind === 'dual' && gun2) {
    grip(gun2, G_.R, _w.t);
    _w.pole.copy(up).multiplyScalar(-1).addScaledVector(rt, -0.55).addScaledVector(fw, -0.25);
    _w.F.copy(fw).addScaledVector(up, -0.3); _w.N.copy(rt).addScaledVector(up, 0.15);
    rig.reach('L', _w.t, _w.pole, _w.F, _w.N, CURL_GRIP);
  } else if (kind === 'shield' && shield) {
    _w.t.set(0, 0.04, 0.07).applyMatrix4(shield.matrixWorld);
    _w.pole.copy(up).multiplyScalar(-1).addScaledVector(rt, -0.6);
    rig.reach('L', _w.t, _w.pole, null, null, CURL_FIST);
  } else if (G_.L) {
    grip(gun, G_.L, _w.t);
    _w.pole.copy(up).multiplyScalar(-1).addScaledVector(rt, -0.7);
    if (kind === 'pistol') { _w.F.copy(fw).addScaledVector(up, -0.45); _w.N.copy(rt); }
    else if (kind === 'bomb') { _w.F.copy(fw); _w.N.copy(rt); }
    else { _w.F.copy(up).addScaledVector(fw, 0.45).addScaledVector(rt, 0.25); _w.N.copy(rt).addScaledVector(up, 0.35); }
    rig.reach('L', _w.t, _w.pole, _w.F, _w.N, CURL_SUPPORT);
  }
}
function placeShield(m, a) {
  const open = a.shieldOpen, c = a.crouch;
  m.shield.visible = true;
  m.shield.position.set(open ? -0.36 : -0.04, lerp(1.32, 0.86, c) - (open ? 0.12 : 0), open ? -0.26 : -0.46);
  m.shield.rotation.set(0, open ? 0.85 : 0, 0);
  m.shield.updateMatrixWorld(true);
}
// knees give way, then the body topples in the direction the hit came from
function deathPose(m, a, dt) {
  const rig = m.rig;
  m.dying = (m.dying || 0) + dt;
  const t = m.dying;
  const k = Math.min(1, t / 0.55), e = k * k;
  const buckle = clamp(t / 0.3, 0, 1);
  rig.idleT += dt * 0.2;
  rig.pose({ idle: [1 - buckle, rig.idleT % Avatars.clips.idle.dur], crouch: [buckle, 1.2] });
  m.body.rotation.x = a.deathDir.x * e * Math.PI / 2;
  m.body.rotation.z = a.deathDir.z * e * Math.PI / 2;
  m.body.position.y = 0.06 * e;
  m.root.updateMatrixWorld(true);
}

// hostages: idle on the spot with hands bound behind the back; walk after whoever leads them
function updateHostageModel(h, dt) {
  const m = h.model;
  m.root.visible = !h.rescued;
  if (h.rescued) return;
  m.root.position.set(h.pos.x, h.pos.y, h.pos.z);
  m.root.rotation.y = h.yaw;
  m.root.updateMatrixWorld(true);
  if (!h.alive) { deathPose(m, h, dt); return; }
  const { sp, rel } = moveRel(h);
  const rig = m.rig;
  rig.locomote(dt, sp, rel, 0, false);
  if (!h.leader) {
    // bound hands: both wrists meet behind the lower back
    m.root.updateMatrixWorld(true);
    const back = (x, out) => out.set(x, 0.98, 0.16).applyMatrix4(m.root.matrixWorld);
    const fw = _w.fw.set(0, 0, -1).applyQuaternion(m.root.quaternion);
    _w.pole.set(0, -0.3, 0).addScaledVector(fw, -1);
    rig.reach('L', back(-0.05, _w.t), _w.pole.clone().addScaledVector(_w.rt.set(-1, 0, 0).applyQuaternion(m.root.quaternion), 0.6), null, null, null);
    rig.reach('R', back(0.05, _w.t), _w.pole.clone().addScaledVector(_w.rt.set(1, 0, 0).applyQuaternion(m.root.quaternion), 0.6), null, null, null);
    rig.aimHead(_w.t.set(0, -0.25, 0).add(fw).normalize(), 0.6);
  }
}
