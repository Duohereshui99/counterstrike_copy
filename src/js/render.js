'use strict';
/* =========================================================
   render.js — renderer, world mesh, sky, effects, models and
   the first-person viewmodel.
   ========================================================= */
const FOG_COLOR = 0xd6b89c;
const SUN_DIR = new THREE.Vector3(-0.62, 0.5, 0.6).normalize();

const R = {
  renderer: null, scene: null, camera: null, vmScene: null, vmCamera: null,
  sun: null, sky: null, width: 1, height: 1, baseFov: 74,

  init(canvas) {
    const hi = Settings.quality !== 'low';
    const r = new THREE.WebGLRenderer({ canvas, antialias: !IS_TOUCH, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, hi ? 1.75 : 1));
    r.shadowMap.enabled = hi;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(FOG_COLOR);
    scene.fog = new THREE.Fog(FOG_COLOR, 55, 230);
    this.scene = scene;

    const cam = new THREE.PerspectiveCamera(this.baseFov, 1, 0.05, 900);
    cam.rotation.order = 'YXZ';
    scene.add(cam);
    this.camera = cam;

    scene.add(new THREE.HemisphereLight(0xc6d7ec, 0x806a55, 0.6));
    scene.add(new THREE.AmbientLight(0x3c4450, 0.22));
    const sun = new THREE.DirectionalLight(0xffdbab, 0.98);
    const cx = World.W * CELL / 2, cz = World.H * CELL / 2;
    sun.position.set(cx + SUN_DIR.x * 100, SUN_DIR.y * 100, cz + SUN_DIR.z * 100);
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 20; sc.far = 220;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.05;
    scene.add(sun); scene.add(sun.target);
    this.sun = sun;

    buildTextures(r.capabilities.getMaxAnisotropy());
    buildWorldMeshes(scene);
    buildProps(scene);
    this.sky = buildSky(scene);
    // image-based lighting from the sky so metal and fabric pick up soft reflections
    try {
      const envScene = new THREE.Scene();
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), this.sky.material));
      const pmrem = new THREE.PMREMGenerator(r);
      this.env = pmrem.fromScene(envScene, 0.02).texture;
      scene.environment = this.env;
      pmrem.dispose();
    } catch (e) { console.warn('environment map unavailable', e); }
    buildBackdrop(scene);
    buildSiteMarks(scene);

    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.vmScene.add(new THREE.HemisphereLight(0xd4e0ee, 0x6c5c4c, 0.65));
    if (this.env) this.vmScene.environment = this.env;
    const vd = new THREE.DirectionalLight(0xffe2bc, 0.65); vd.position.set(-0.6, 1, 0.8); this.vmScene.add(vd);

    FX.init(scene);
    VM.init(this.vmScene);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  },

  applyQuality() {
    const hi = Settings.quality !== 'low';
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, hi ? 1.75 : 1));
    if (r.shadowMap.enabled !== hi) {
      r.shadowMap.enabled = hi;
      this.scene.traverse((o) => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); } });
    }
    this.resize();
  },

  resize() {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix();
  },

  // render a scene off-screen (supersampled) and return a PNG data URL with a transparent background
  snapshot(scene, camera, W, H, S = 2) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color()).getHex(), prevAlpha = r.getClearAlpha();
    let url = '';
    try {
      if (!this._snap || this._snap.w !== W * S || this._snap.h !== H * S) {
        if (this._snap) this._snap.rt.dispose();
        const big = document.createElement('canvas'); big.width = W * S; big.height = H * S;
        this._snap = { w: W * S, h: H * S, rt: new THREE.WebGLRenderTarget(W * S, H * S), buf: new Uint8Array(W * S * H * S * 4), big, bg: big.getContext('2d') };
      }
      const sn = this._snap;
      r.setRenderTarget(sn.rt); r.setClearColor(0x000000, 0); r.clear(); r.render(scene, camera);
      r.readRenderTargetPixels(sn.rt, 0, 0, sn.w, sn.h, sn.buf);
      const img = sn.bg.createImageData(sn.w, sn.h), row = sn.w * 4;
      for (let y = 0; y < sn.h; y++) img.data.set(sn.buf.subarray((sn.h - 1 - y) * row, (sn.h - y) * row), y * row); // WebGL rows run bottom-up
      sn.bg.putImageData(img, 0, 0);
      const small = document.createElement('canvas'); small.width = W; small.height = H;
      small.getContext('2d').drawImage(sn.big, 0, 0, W, H);
      url = small.toDataURL('image/png');
    } catch (e) { console.warn('snapshot failed', e); }
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
    return url;
  },

  render() {
    const r = this.renderer;
    this.sky.position.copy(this.camera.position);
    FX.pMat.uniforms.scale.value = this.height * r.getPixelRatio() / (2 * Math.tan(this.camera.fov * DEG / 2));
    r.render(this.scene, this.camera);
    if (VM.root.visible && VM.cur) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.vmScene, this.vmCamera);
      r.autoClear = true;
    }
  },
};

// ------------------------------------------------------------------ world mesh
const MAT_DEFS = {
  concrete: { tex: 'concrete', su: 4, sv: 4 },
  roof: { tex: 'concrete', su: 4, sv: 4, color: 0xbdb6ac },
  brick: { tex: 'brick', su: 2, sv: 2 },
  asphalt: { tex: 'asphalt', su: 4, sv: 4 },
  floorc: { tex: 'floorc', su: 4, sv: 4 },
  crate: { tex: 'crate', su: 2, sv: 1 },
  container: { tex: 'container', su: 2, sv: 2.6 },
  hazard: { tex: 'hazard', su: 2, sv: 0.45 },
  dock: { tex: 'floorc', su: 4, sv: 4, color: 0xd0cabd },
  coping: { tex: 'concrete', su: 4, sv: 4, color: 0x8a847b },
  window: { tex: 'window', su: 1, sv: 1 },
};
const CH_MAT = {
  '#': ['roof', 'concrete'], '%': ['roof', 'brick'], 'X': ['container', 'container'], 'x': ['container', 'container'],
  'C': ['crate', 'crate'], 'c': ['crate', 'crate'], '1': ['dock', 'hazard'], '2': ['dock', 'hazard'], '3': ['dock', 'hazard'],
  '.': ['asphalt'], ',': ['floorc'],
};
const AO_LEVELS = [0.56, 0.7, 0.85, 1.0];
const CONTAINER_PAL = [[0.76, 0.28, 0.2], [0.24, 0.38, 0.58], [0.28, 0.5, 0.33], [0.88, 0.52, 0.2], [0.22, 0.52, 0.55], [0.86, 0.82, 0.72]];

function hash01(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }

function buildWorldMeshes(scene) {
  const W = World.W, H = World.H;
  const buckets = {};
  const bucket = (k) => buckets[k] || (buckets[k] = { p: [], n: [], u: [], c: [] });
  function quad(key, v, nrm, uv, col) {
    const b = bucket(key);
    for (const i of [0, 1, 2, 0, 2, 3]) {
      b.p.push(v[i][0], v[i][1], v[i][2]);
      b.n.push(nrm[0], nrm[1], nrm[2]);
      b.u.push(uv[i][0], uv[i][1]);
      b.c.push(col[i][0], col[i][1], col[i][2]);
    }
  }
  // connected container groups get one paint colour each
  const comp = new Int32Array(W * H).fill(-1);
  let nc = 0;
  for (let i = 0; i < W * H; i++) {
    const ch = World.kinds[i];
    if ((ch !== 'x' && ch !== 'X') || comp[i] >= 0) continue;
    const stack = [i]; comp[i] = nc;
    while (stack.length) {
      const c = stack.pop(), cx = c % W, cz = (c / W) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (!World.inB(nx, nz)) continue;
        const ni = nz * W + nx;
        if (comp[ni] < 0 && World.kinds[ni] === ch) { comp[ni] = nc; stack.push(ni); }
      }
    }
    nc++;
  }
  const HH = (cx, cz) => World.cellH(cx, cz);
  const PROP = { c: 1, C: 1, x: 1, X: 1 };
  // props are drawn by buildProps(); here they only leave floor behind and walls next to them run down to the ground
  const VH = (cx, cz) => (PROP[World.kindAt(cx, cz)] ? 0 : World.cellH(cx, cz));
  const floorNear = (cx, cz) => {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = World.kindAt(cx + dx, cz + dz); if (k === ',' || k === '.') return k; }
    return '.';
  };
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
    const raw = World.kindAt(cx, cz), ch = PROP[raw] ? floorNear(cx, cz) : raw, h = VH(cx, cz);
    const x0 = cx * CELL, x1 = x0 + CELL, z0 = cz * CELL, z1 = z0 + CELL;
    const mats = CH_MAT[ch];
    const ci = comp[cz * W + cx];
    const tint = ci >= 0 ? CONTAINER_PAL[(ci * 7 + 3) % CONTAINER_PAL.length] : [1, 1, 1];
    const v = 0.92 + 0.08 * hash01(cx, cz);
    // top face with corner ambient occlusion
    const occ = (dx, dz) => (HH(cx + dx, cz + dz) > h + 0.05 ? 1 : 0);
    const ao = (sx, sz) => { const s1 = occ(sx, 0), s2 = occ(0, sz), c = occ(sx, sz); return AO_LEVELS[(s1 && s2) ? 0 : 3 - (s1 + s2 + c)]; };
    const tm = MAT_DEFS[mats[0]];
    const uvT = (x, z) => [x / tm.su, -z / tm.sv];
    const tc = (a) => [tint[0] * v * a, tint[1] * v * a, tint[2] * v * a];
    quad(mats[0], [[x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0]], [0, 1, 0],
      [uvT(x0, z0), uvT(x0, z1), uvT(x1, z1), uvT(x1, z0)], [tc(ao(-1, -1)), tc(ao(-1, 1)), tc(ao(1, 1)), tc(ao(1, -1))]);
    if (h <= 0) continue;
    const sm = MAT_DEFS[mats[1]];
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (!World.inB(cx + dx, cz + dz)) continue;
      const nh = VH(cx + dx, cz + dz);
      if (nh >= h) continue;
      const isWall = ch === '#' || ch === '%';
      const levels = ch === 'X' ? [[nh, Math.min(h, 2.6)], [Math.max(nh, 2.6), h]] : isWall ? [[nh, h - 0.4], [Math.max(nh, h - 0.4), h]] : [[nh, h]];
      // windows high up on building walls that face open ground
      if (isWall && nh === 0 && hash01(cx * 3 + dx, cz * 7 + dz) < 0.22) {
        const wy0 = 3.3, wy1 = 4.9, inset = 0.4, o = 0.02;
        let wv, wn;
        if (dx === -1) { wv = [[x0 - o, wy0, z0 + inset], [x0 - o, wy0, z1 - inset], [x0 - o, wy1, z1 - inset], [x0 - o, wy1, z0 + inset]]; wn = [-1, 0, 0]; }
        else if (dx === 1) { wv = [[x1 + o, wy0, z1 - inset], [x1 + o, wy0, z0 + inset], [x1 + o, wy1, z0 + inset], [x1 + o, wy1, z1 - inset]]; wn = [1, 0, 0]; }
        else if (dz === -1) { wv = [[x1 - inset, wy0, z0 - o], [x0 + inset, wy0, z0 - o], [x0 + inset, wy1, z0 - o], [x1 - inset, wy1, z0 - o]]; wn = [0, 0, -1]; }
        else { wv = [[x0 + inset, wy0, z1 + o], [x1 - inset, wy0, z1 + o], [x1 - inset, wy1, z1 + o], [x0 + inset, wy1, z1 + o]]; wn = [0, 0, 1]; }
        const wc = [0.9 + 0.1 * hash01(cx, cz), 0.92, 0.95];
        quad('window', wv, wn, [[0, 0], [1, 0], [1, 1], [0, 1]], [wc, wc, wc, wc]);
      }
      for (let li = 0; li < levels.length; li++) {
        const y0 = levels[li][0], y1 = levels[li][1];
        if (y1 - y0 < 0.01) continue;
        const key = isWall && li === 1 ? 'coping' : mats[1];
        const tt = (ch === 'X' && li === 1) ? CONTAINER_PAL[(ci * 5 + 1) % CONTAINER_PAL.length] : tint;
        const bot = y0 < 0.01 ? 0.68 : 0.86;
        const cb = [tt[0] * v * bot, tt[1] * v * bot, tt[2] * v * bot], ct = [tt[0] * v, tt[1] * v, tt[2] * v];
        const su = sm.su, sv = sm.sv;
        let verts, nrm, uv;
        if (dx === -1) { verts = [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]; nrm = [-1, 0, 0]; uv = [[z0 / su, y0 / sv], [z1 / su, y0 / sv], [z1 / su, y1 / sv], [z0 / su, y1 / sv]]; }
        else if (dx === 1) { verts = [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]; nrm = [1, 0, 0]; uv = [[-z1 / su, y0 / sv], [-z0 / su, y0 / sv], [-z0 / su, y1 / sv], [-z1 / su, y1 / sv]]; }
        else if (dz === -1) { verts = [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]; nrm = [0, 0, -1]; uv = [[-x1 / su, y0 / sv], [-x0 / su, y0 / sv], [-x0 / su, y1 / sv], [-x1 / su, y1 / sv]]; }
        else { verts = [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]; nrm = [0, 0, 1]; uv = [[x0 / su, y0 / sv], [x1 / su, y0 / sv], [x1 / su, y1 / sv], [x0 / su, y1 / sv]]; }
        quad(key, verts, nrm, uv, isWall && li === 1 ? [ct, ct, ct, ct] : [cb, cb, ct, ct]);
      }
    }
  }
  for (const key in buckets) {
    const b = buckets[key], md = MAT_DEFS[key];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({ map: TEX[md.tex], vertexColors: true, color: md.color || 0xffffff });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = key !== 'asphalt' && key !== 'floorc' && key !== 'window';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function buildSky(scene) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(0x46709f) },
      horizon: { value: new THREE.Color(FOG_COLOR) },
      ground: { value: new THREE.Color(0x6a5c50) },
      sunDir: { value: SUN_DIR },
      sunCol: { value: new THREE.Color(0xffe2b4) },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vDir;',
      'void main(){',
      '  vec3 d = normalize(vDir); float h = d.y;',
      '  vec3 col = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, ground, pow(clamp(-h, 0.0, 1.0), 0.35));',
      '  float s = max(dot(d, normalize(sunDir)), 0.0);',
      '  col += sunCol * (pow(s, 1200.0) * 3.0 + pow(s, 28.0) * 0.32 + pow(s, 5.0) * 0.12);',
      '  float band = smoothstep(0.02, 0.08, h) * (1.0 - smoothstep(0.08, 0.25, h));',
      '  col = mix(col, col * vec3(1.08, 0.93, 0.86), band * 0.6);',
      '  gl_FragColor = vec4(col, 1.0);',
      '  gl_FragColor = linearToOutputTexel(gl_FragColor);',
      '}',
    ].join('\n'),
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), mat);
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

function buildBackdrop(scene) {
  // distant warehouses and harbour cranes, merged into one mesh (they only frame the skyline)
  const rng = mulberry32(4242);
  const mw = World.W * CELL, mh = World.H * CELL;
  const cols = [0x606a73, 0x6e7177, 0x535e67, 0x786f67, 0x5d6660];
  const B = new Bake();
  const unit = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 70; i++) {
    let x, z;
    do { x = -90 + rng() * (mw + 180); z = -90 + rng() * (mh + 180); }
    while (x > -14 && x < mw + 14 && z > -14 && z < mh + 14);
    const w = 8 + rng() * 26, d = 8 + rng() * 26, h = 8 + rng() * 26;
    B.add(unit, cols[i % cols.length], { mat: 'lambert', p: [x, h / 2 - 0.5, z], s: [w, h, d] });
  }
  const crane = (cx, cz, k) => {
    const part = (w, h, d, px, py, pz) => B.add(unit, 0xb4532f, { mat: 'lambert', p: [cx - px * k, py * k, cz - pz * k], s: [w * k, h * k, d * k] });
    for (const lz of [-6, 6]) for (const lx of [-7, 7]) part(1.2, 30, 1.2, lx, 15, lz);
    part(16, 1.4, 1.4, 0, 30, -6); part(16, 1.4, 1.4, 0, 30, 6);
    part(1.4, 1.4, 13, -7, 30, 0); part(1.4, 1.4, 13, 7, 30, 0);
    part(70, 2.2, 2.2, -12, 34, 0); part(10, 6, 6, 18, 31, 0);
    part(1, 18, 1, -30, 25, 0);
  };
  crane(mw + 46, 10, 1); crane(mw + 52, 44, 1.1); crane(mw + 44, 78, 0.95);
  scene.add(B.build(false));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshLambertMaterial({ color: 0x5a524a }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(mw / 2, -0.03, mh / 2);
  scene.add(ground);
}

function buildSiteMarks(scene) {
  for (const k of ['A', 'B']) {
    const s = SITES[k];
    const x = s.center[0] * CELL + CELL / 2, z = s.center[1] * CELL + CELL / 2;
    const y = World.floorAt(x, z);
    const mat = new THREE.MeshLambertMaterial({ map: TEX['site' + k], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.02, z);
    scene.add(m);
    const pm = new THREE.MeshLambertMaterial({ map: TEX.paint, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const x0 = s.x0 * CELL + 0.2, x1 = (s.x1 + 1) * CELL - 0.2, z0 = s.z0 * CELL + 0.2, z1 = (s.z1 + 1) * CELL - 0.2;
    const strip = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const g = new THREE.PlaneGeometry(len, 0.14);
      g.attributes.uv.array.forEach((_, i, arr) => { if (i % 2 === 0) arr[i] *= len / 1.2; });
      const sm = new THREE.Mesh(g, pm);
      sm.rotation.x = -Math.PI / 2;
      sm.rotation.z = -Math.atan2(bz - az, bx - ax);
      sm.position.set((ax + bx) / 2, 0.015, (az + bz) / 2);
      scene.add(sm);
    };
    strip(x0, z0, x1, z0); strip(x0, z1, x1, z1); strip(x0, z0, x0, z1); strip(x1, z0, x1, z1);
  }
  TEX.paint.wrapS = THREE.RepeatWrapping;
}

// ------------------------------------------------------------------ effects
const FX = {
  scene: null,
  init(scene) {
    this.scene = scene;
    this.initParticles();
    this.initTracers();
    this.initDecals();
    this.initSprites();
    this.smokes = [];
  },

  initParticles() {
    const N = 1400;
    this.pN = N; this.pNext = 0;
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 4); this.pSize = new Float32Array(N);
    this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pMax = new Float32Array(N);
    this.pGrav = new Float32Array(N); this.pDrag = new Float32Array(N); this.pGrow = new Float32Array(N); this.pA0 = new Float32Array(N);
    for (let i = 0; i < N; i++) this.pPos[i * 3 + 1] = -999;
    const geo = new THREE.BufferGeometry();
    this.pAttr = {
      pos: new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage),
      col: new THREE.BufferAttribute(this.pCol, 4).setUsage(THREE.DynamicDrawUsage),
      size: new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage),
    };
    geo.setAttribute('position', this.pAttr.pos);
    geo.setAttribute('pcolor', this.pAttr.col);
    geo.setAttribute('psize', this.pAttr.size);
    this.pMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: TEX.soft }, scale: { value: 600 } },
      vertexShader: 'attribute vec4 pcolor; attribute float psize; uniform float scale; varying vec4 vC;' +
        'void main(){ vC = pcolor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(psize * scale / max(-mv.z, 0.1), 320.0); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec4 vC;' +
        'void main(){ vec4 t = texture2D(map, gl_PointCoord); float a = vC.a * t.a; if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, a); }',
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.pMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.scene.add(this.points);
  },
  emit(x, y, z, vx, vy, vz, life, size, r, g, b, a, grav, drag, grow) {
    const i = this.pNext; this.pNext = (i + 1) % this.pN;
    const k = i * 3, c = i * 4;
    this.pPos[k] = x; this.pPos[k + 1] = y; this.pPos[k + 2] = z;
    this.pVel[k] = vx; this.pVel[k + 1] = vy; this.pVel[k + 2] = vz;
    this.pCol[c] = r; this.pCol[c + 1] = g; this.pCol[c + 2] = b; this.pCol[c + 3] = a;
    this.pSize[i] = size; this.pLife[i] = life; this.pMax[i] = life; this.pA0[i] = a;
    this.pGrav[i] = grav || 0; this.pDrag[i] = drag || 0; this.pGrow[i] = grow || 0;
  },
  updateParticles(dt) {
    const N = this.pN;
    for (let i = 0; i < N; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const k = i * 3;
      if (this.pLife[i] <= 0) { this.pPos[k + 1] = -999; this.pSize[i] = 0; this.pCol[i * 4 + 3] = 0; continue; }
      this.pVel[k + 1] -= this.pGrav[i] * dt;
      const dr = Math.max(0, 1 - this.pDrag[i] * dt);
      this.pVel[k] *= dr; this.pVel[k + 1] *= dr; this.pVel[k + 2] *= dr;
      this.pPos[k] += this.pVel[k] * dt; this.pPos[k + 1] += this.pVel[k + 1] * dt; this.pPos[k + 2] += this.pVel[k + 2] * dt;
      if (this.pPos[k + 1] < 0.02) { this.pPos[k + 1] = 0.02; this.pVel[k + 1] *= -0.3; }
      this.pSize[i] += this.pGrow[i] * dt;
      this.pCol[i * 4 + 3] = this.pA0[i] * Math.min(1, (this.pLife[i] / this.pMax[i]) * 1.6);
    }
    this.pAttr.pos.needsUpdate = true; this.pAttr.col.needsUpdate = true; this.pAttr.size.needsUpdate = true;
  },

  initTracers() {
    const N = 56;
    this.tr = [];
    for (let i = 0; i < N; i++) this.tr.push({ on: false, sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: 1, len: 0, t: 0, a: 1 });
    this.trPos = new Float32Array(N * 12); this.trA = new Float32Array(N * 4);
    const idx = [];
    for (let i = 0; i < N; i++) { const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    const geo = new THREE.BufferGeometry();
    geo.setIndex(idx);
    this.trAttrP = new THREE.BufferAttribute(this.trPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.trAttrA = new THREE.BufferAttribute(this.trA, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.trAttrP);
    geo.setAttribute('alpha', this.trAttrA);
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(1.0, 0.86, 0.58) } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color * vA, vA); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.trMesh = new THREE.Mesh(geo, mat);
    this.trMesh.frustumCulled = false;
    this.scene.add(this.trMesh);
  },
  tracer(from, to, bright) {
    const t = this.tr.find((q) => !q.on);
    if (!t) return;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, len = Math.hypot(dx, dy, dz);
    if (len < 1.5) return;
    t.on = true; t.sx = from.x; t.sy = from.y; t.sz = from.z;
    t.dx = dx / len; t.dy = dy / len; t.dz = dz / len; t.len = len; t.t = 0; t.a = bright == null ? 1 : bright;
  },
  updateTracers(dt, cam) {
    const P = this.trPos, A = this.trA, cp = cam.position;
    for (let i = 0; i < this.tr.length; i++) {
      const t = this.tr[i], b = i * 12, a = i * 4;
      if (!t.on) { A[a] = A[a + 1] = A[a + 2] = A[a + 3] = 0; continue; }
      t.t += dt;
      const head = Math.min(t.t * 480, t.len), tail = Math.max(0, head - 5);
      if (tail >= t.len - 0.05) { t.on = false; A[a] = A[a + 1] = A[a + 2] = A[a + 3] = 0; continue; }
      const p0x = t.sx + t.dx * tail, p0y = t.sy + t.dy * tail, p0z = t.sz + t.dz * tail;
      const p1x = t.sx + t.dx * head, p1y = t.sy + t.dy * head, p1z = t.sz + t.dz * head;
      const mx = (p0x + p1x) / 2 - cp.x, my = (p0y + p1y) / 2 - cp.y, mz = (p0z + p1z) / 2 - cp.z;
      let sx = t.dy * mz - t.dz * my, sy = t.dz * mx - t.dx * mz, sz = t.dx * my - t.dy * mx;
      const sl = Math.hypot(sx, sy, sz) || 1, dist = Math.hypot(mx, my, mz);
      // closest approach of the streak to the camera: near misses would smear across the screen
      const ex = p1x - p0x, ey = p1y - p0y, ez = p1z - p0z, el = ex * ex + ey * ey + ez * ez || 1e-6;
      const ct = clamp(((cp.x - p0x) * ex + (cp.y - p0y) * ey + (cp.z - p0z) * ez) / el, 0, 1);
      const near = Math.hypot(p0x + ex * ct - cp.x, p0y + ey * ct - cp.y, p0z + ez * ct - cp.z);
      const fade = clamp((near - 0.9) / 2.5, 0, 1);
      const w = 0.009 + dist * 0.0012;
      sx = sx / sl * w; sy = sy / sl * w; sz = sz / sl * w;
      P[b] = p0x - sx; P[b + 1] = p0y - sy; P[b + 2] = p0z - sz;
      P[b + 3] = p0x + sx; P[b + 4] = p0y + sy; P[b + 5] = p0z + sz;
      P[b + 6] = p1x + sx; P[b + 7] = p1y + sy; P[b + 8] = p1z + sz;
      P[b + 9] = p1x - sx; P[b + 10] = p1y - sy; P[b + 11] = p1z - sz;
      A[a] = 0; A[a + 1] = 0; A[a + 2] = t.a * fade; A[a + 3] = t.a * fade;
    }
    this.trAttrP.needsUpdate = true; this.trAttrA.needsUpdate = true;
  },

  initDecals() {
    const N = 280;
    this.dN = N; this.dNext = 0;
    const mat = new THREE.MeshBasicMaterial({ map: TEX.hole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, N);
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.decals.frustumCulled = false;
    this.zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < N; i++) this.decals.setMatrixAt(i, this.zeroM);
    this.scene.add(this.decals);
    this.dummy = new THREE.Object3D();
  },
  decal(p, n) {
    const d = this.dummy;
    d.position.set(p.x + n.x * 0.012, p.y + n.y * 0.012, p.z + n.z * 0.012);
    d.lookAt(p.x + n.x, p.y + n.y, p.z + n.z);
    d.rotateZ(Math.random() * TAU);
    const s = rand(0.07, 0.11);
    d.scale.set(s, s, s);
    d.updateMatrix();
    this.decals.setMatrixAt(this.dNext, d.matrix);
    this.dNext = (this.dNext + 1) % this.dN;
    this.decals.instanceMatrix.needsUpdate = true;
  },
  clearDecals() {
    for (let i = 0; i < this.dN; i++) this.decals.setMatrixAt(i, this.zeroM);
    this.decals.instanceMatrix.needsUpdate = true;
  },

  initSprites() {
    this.sp = [];
    for (let i = 0; i < 28; i++) {
      const m = new THREE.SpriteMaterial({ map: TEX.flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
      const s = new THREE.Sprite(m);
      s.visible = false; s.renderOrder = 6;
      this.scene.add(s);
      this.sp.push({ s, life: 0, max: 1, s0: 1, s1: 1, o: 1 });
    }
  },
  sprite(p, tex, color, s0, s1, life, opacity) {
    let q = this.sp.find((x) => x.life <= 0);
    if (!q) q = this.sp[0];
    q.s.material.map = tex; q.s.material.color.setHex(color); q.s.material.rotation = Math.random() * TAU;
    q.s.position.copy(p); q.s.visible = true;
    q.life = life; q.max = life; q.s0 = s0; q.s1 = s1; q.o = opacity == null ? 1 : opacity;
    q.s.scale.setScalar(s0);
  },
  updateSprites(dt) {
    for (const q of this.sp) {
      if (q.life <= 0) continue;
      q.life -= dt;
      if (q.life <= 0) { q.s.visible = false; continue; }
      const k = 1 - q.life / q.max;
      q.s.scale.setScalar(lerp(q.s0, q.s1, Math.sqrt(k)));
      q.s.material.opacity = q.o * (1 - k);
    }
  },

  // ---------------------------------------------------------------- public effects
  impact(p, n, kind) {
    const wood = kind === 'c' || kind === 'C', metal = kind === 'x' || kind === 'X', brick = kind === '%';
    const col = wood ? [0.55, 0.42, 0.28] : metal ? [0.55, 0.55, 0.56] : brick ? [0.56, 0.36, 0.28] : [0.66, 0.63, 0.58];
    for (let i = 0; i < 5; i++) {
      this.emit(p.x + n.x * 0.05, p.y + n.y * 0.05, p.z + n.z * 0.05,
        n.x * rand(0.4, 2) + rand(-0.6, 0.6), n.y * rand(0.4, 2) + rand(0, 0.8), n.z * rand(0.4, 2) + rand(-0.6, 0.6),
        rand(0.45, 0.95), rand(0.1, 0.26), col[0], col[1], col[2], 0.6, 0.6, 2.2, 0.45);
    }
    const sparks = metal ? 7 : (wood ? 0 : 2);
    for (let i = 0; i < sparks; i++) {
      this.emit(p.x, p.y, p.z, n.x * rand(2, 5) + rand(-2, 2), n.y * rand(2, 5) + rand(-1, 2.5), n.z * rand(2, 5) + rand(-2, 2),
        rand(0.15, 0.32), rand(0.03, 0.05), 1, 0.82, 0.45, 1, 9, 0.6, 0);
    }
    this.decal(p, n);
  },
  blood(p, d) {
    for (let i = 0; i < 7; i++) {
      this.emit(p.x, p.y, p.z, d.x * rand(0.5, 2.2) + rand(-0.7, 0.7), d.y * rand(0.5, 2) + rand(-0.4, 1), d.z * rand(0.5, 2.2) + rand(-0.7, 0.7),
        rand(0.35, 0.65), rand(0.08, 0.2), 0.48, 0.04, 0.03, 0.85, 7, 2, 0.25);
    }
  },
  muzzle3P(p) {
    this.sprite(p, TEX.flash, 0xffd28a, 0.35, 0.55, 0.06, 0.95);
    this.emit(p.x, p.y, p.z, rand(-0.2, 0.2), rand(0.2, 0.5), rand(-0.2, 0.2), 0.5, 0.15, 0.7, 0.7, 0.7, 0.25, -0.5, 1.5, 0.5);
  },
  explosion(p, big) {
    const s = big ? 2.2 : 1;
    this.sprite(p, TEX.soft, 0xffc070, 1.5 * s, 9 * s, 0.55, 1);
    this.sprite(p, TEX.flash, 0xffe0a0, 2 * s, 6 * s, 0.3, 1);
    for (let i = 0; i < 34 * s; i++) {
      const a = Math.random() * TAU, e = rand(-0.2, 1.2), v = rand(3, 9) * s;
      this.emit(p.x, p.y + 0.3, p.z, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v, Math.sin(a) * Math.cos(e) * v,
        rand(0.3, 0.7), rand(0.4, 0.9) * s, 1, rand(0.45, 0.7), 0.2, 0.95, 2, 3, 1.5);
    }
    for (let i = 0; i < 26 * s; i++) {
      const a = Math.random() * TAU, v = rand(0.8, 3) * s;
      this.emit(p.x + rand(-0.5, 0.5), p.y + rand(0.2, 1.2), p.z + rand(-0.5, 0.5), Math.cos(a) * v, rand(0.8, 3), Math.sin(a) * v,
        rand(1.6, 3.2), rand(0.9, 1.8) * s, 0.22, 0.2, 0.19, 0.7, -0.3, 0.9, 1.4);
    }
    for (let i = 0; i < 20 * s; i++) {
      this.emit(p.x, p.y + 0.3, p.z, rand(-9, 9), rand(2, 10), rand(-9, 9), rand(0.4, 1.0), 0.05, 1, 0.8, 0.4, 1, 12, 0.3, 0);
    }
  },
  flashPop(p) {
    this.sprite(p, TEX.soft, 0xffffff, 1, 7, 0.25, 1);
    this.sprite(p, TEX.flash, 0xffffff, 1, 3, 0.15, 1);
  },
  smokeCloud(p) {
    const cloud = { x: p.x, y: p.y, z: p.z, t: 0, life: 17, sprites: [] };
    for (let i = 0; i < 28; i++) {
      const m = new THREE.SpriteMaterial({ map: TEX.smoke, color: 0xbdbdb7, transparent: true, depthWrite: false, opacity: 0 });
      m.rotation = Math.random() * TAU;
      const s = new THREE.Sprite(m);
      const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * 2.7;
      s.userData = { ox: Math.cos(a) * r, oz: Math.sin(a) * r, oy: rand(0.4, 3.1), size: rand(3.4, 5.2), spin: rand(-0.12, 0.12) };
      s.renderOrder = 4;
      this.scene.add(s);
      cloud.sprites.push(s);
    }
    this.smokes.push(cloud);
    return cloud;
  },
  updateSmokes(dt) {
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const c = this.smokes[i];
      c.t += dt;
      const grow = Math.min(1, c.t / 1.5);
      const fade = c.t < 0.8 ? c.t / 0.8 : (c.t > c.life - 3 ? Math.max(0, (c.life - c.t) / 3) : 1);
      for (const s of c.sprites) {
        const u = s.userData, gk = 0.35 + 0.65 * grow;
        s.position.set(c.x + u.ox * gk, c.y + u.oy * (0.5 + 0.5 * grow), c.z + u.oz * gk);
        s.scale.setScalar(u.size * gk);
        s.material.opacity = 0.86 * fade;
        s.material.rotation += u.spin * dt;
      }
      if (c.t >= c.life) {
        for (const s of c.sprites) { this.scene.remove(s); s.material.dispose(); }
        this.smokes.splice(i, 1);
      }
    }
  },
  clearRound() {
    for (const c of this.smokes) for (const s of c.sprites) { this.scene.remove(s); s.material.dispose(); }
    this.smokes.length = 0;
    for (const t of this.tr) t.on = false;
    for (let i = 0; i < this.pN; i++) this.pLife[i] = Math.min(this.pLife[i], 0.01);
    this.clearDecals();
  },
  update(dt, cam) {
    this.updateParticles(dt);
    this.updateTracers(dt, cam);
    this.updateSprites(dt);
    this.updateSmokes(dt);
  },
};

// ------------------------------------------------------------------ viewmodel
const VM_POSE = {
  pistol: [0.16, -0.17, -0.36], pistolShield: [0.2, -0.16, -0.36], dual: [0.0, -0.17, -0.36], smg: [0.17, -0.19, -0.38], rifle: [0.18, -0.2, -0.4],
  shotgun: [0.18, -0.2, -0.4], sniper: [0.2, -0.225, -0.42], mg: [0.18, -0.215, -0.4], knife: [0.19, -0.19, -0.32], grenade: [0.17, -0.18, -0.32], bomb: [0.08, -0.22, -0.36],
};
const VM = {
  scene: null, root: null, holder: null, cur: null, curKey: null, cache: {}, skin: null,
  bob: 0, kickZ: 0, kickRot: 0, swayX: 0, swayY: 0, raise: 1, flashT: 0, slash: 0, silDip: 0, shieldK: 1,
  init(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.holder = new THREE.Group(); this.root.add(this.holder);
    const fm = new THREE.SpriteMaterial({ map: TEX.flash, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, color: 0xffd9a0 });
    this.flash = new THREE.Sprite(fm); this.flash.visible = false; this.flash.renderOrder = 10;
    this.shieldMesh = Models.shield();
    this.shieldMesh.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
    this.shieldMesh.visible = false;
    this.root.add(this.shieldMesh);
    this.root.visible = false;
  },
  setSkin(skin) {
    if (this.skin === skin) return;
    this.skin = skin; this.cache = {};
    if (this.cur) { this.holder.remove(this.cur); this.cur = null; this.curKey = null; }
    // first-person arms come from the player's own avatar: head hidden, body just below and ahead of the view
    if (this.rigWrap) { this.root.remove(this.rigWrap); this.rigWrap = null; this.rig = null; }
    const def = typeof Avatars !== 'undefined' && Avatars.ready && skin && Avatars.defs[skin.avatar];
    if (def) {
      const rig = new Rig(def), wrap = new THREE.Group(), flip = new THREE.Group();
      flip.rotation.y = Math.PI; flip.add(rig.root); wrap.add(flip);
      wrap.scale.setScalar(VM_BODY.scale);
      rig.top = wrap;
      rig.mesh.castShadow = false; rig.mesh.receiveShadow = false;
      // only the arms are wanted: collapse everything from the spine up, then give the clavicles their size back
      rig.b.spine.scale.setScalar(0.001);
      rig.b.LClav.scale.setScalar(1000); rig.b.RClav.scale.setScalar(1000);
      rig.clavRest = { L: rig.b.LClav.position.clone(), R: rig.b.RClav.position.clone() };
      this.root.add(wrap);
      rig.pose({ idle: [1, 0] });
      wrap.updateMatrixWorld(true);
      const hp = new THREE.Vector3().setFromMatrixPosition(rig.b.head.matrixWorld);
      wrap.position.set(-hp.x, -hp.y + VM_BODY.y, -hp.z + VM_BODY.z);
      this.rig = rig; this.rigWrap = wrap;
    }
  },
  build(id, shield) {
    const w = WEAPONS[id];
    const g = new THREE.Group();
    let pose = w.pose;
    if (shield && pose === 'pistol') pose = 'pistolShield';
    const guns = [];
    const gun = Models.gun(id);
    guns.push(gun); g.add(gun);
    if (w.dual) {
      gun.position.x = 0.13;
      const left = Models.gun(id);
      left.position.x = -0.13;
      guns.push(left); g.add(left);
    }
    if (!this.rig) g.add(Models.viewArms(pose, this.skin));
    g.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
    g.userData.kind = pose === 'pistolShield' ? 'shield' : pose;
    g.scale.setScalar(0.84);
    g.userData.pose = VM_POSE[pose];
    g.userData.guns = guns;
    return g;
  },
  set(id, shield) {
    const key = id + (shield ? '|s' : '');
    if (this.curKey === key) return;
    if (this.cur) this.holder.remove(this.cur);
    if (!this.cache[key]) this.cache[key] = this.build(id, shield);
    this.cur = this.cache[key];
    this.holder.add(this.cur);
    this.curKey = key;
    this.raise = 0;
    this.placeFlash(0);
  },
  placeFlash(i) {
    const gun = this.cur.userData.guns[i] || this.cur.userData.guns[0];
    if (this.flash.parent !== gun) { if (this.flash.parent) this.flash.parent.remove(this.flash); gun.add(this.flash); }
    this.flash.position.copy(gun.userData.muzzle).add(new THREE.Vector3(0, 0, -0.03));
  },
  fire(w, side, sil) {
    const k = w.kind === 'sniper' ? 1.6 : w.kind === 'shotgun' ? 1.4 : w.kind === 'pistol' ? 0.9 : 0.6;
    this.kickZ += 0.045 * k; this.kickRot += 0.07 * k;
    if (w.kind === 'knife') { this.slash = 1; return; }
    if (w.dual) this.placeFlash(side < 0 ? 1 : 0);
    this.flashT = 0.045;
    this.flash.material.rotation = Math.random() * TAU;
    this.flash.scale.setScalar(sil ? 0.08 : (w.kind === 'sniper' || w.kind === 'shotgun' ? 0.32 : 0.22));
  },
  silencer() { this.silDip = 1; },
  update(dt, s) {
    if (!this.cur) return;
    this.raise = Math.min(1, this.raise + dt / 0.32);
    const ro = 1 - (1 - Math.pow(1 - this.raise, 3));
    this.bob += dt * s.speed * 1.7;
    const amp = s.onGround ? Math.min(1, s.speed / 5.5) : 0.15;
    const bx = Math.sin(this.bob) * 0.011 * amp, by = -Math.abs(Math.cos(this.bob)) * 0.012 * amp + Math.sin(performance.now() * 0.0016) * 0.0018;
    this.swayX = damp(this.swayX, clamp(s.dYaw * 0.35, -0.05, 0.05), 9, dt);
    this.swayY = damp(this.swayY, clamp(-s.dPitch * 0.35, -0.04, 0.04), 9, dt);
    this.kickZ = damp(this.kickZ, 0, 13, dt); this.kickRot = damp(this.kickRot, 0, 11, dt);
    this.slash = Math.max(0, this.slash - dt * 4);
    this.silDip = Math.max(0, this.silDip - dt / 1.6);
    const sd = Math.sin(Math.PI * this.silDip);
    const rl = s.reloadFrac >= 0 ? Math.sin(Math.PI * clamp(s.reloadFrac, 0, 1)) : 0;
    // riot shield: lowered (k=1) it sits at the left edge so the pistol can fire past it;
    // raised (k=0) it covers the view, the slot window lines up with the crosshair and the gun drops out of sight
    this.shieldMesh.visible = !!s.shield;
    let gunDrop = 0;
    if (s.shield) {
      this.shieldK = damp(this.shieldK, s.shieldOpen ? 1 : 0, 10, dt);
      const k = this.shieldK;
      this.shieldMesh.position.set(lerp(-0.02, -0.46, k) + bx * 0.6, lerp(-0.315, -0.28, k) + by * 0.6 - ro * 0.25, lerp(-0.37, -0.36, k));
      this.shieldMesh.rotation.set(lerp(0, 0.1, k), lerp(0.04, 0.95, k), lerp(0, 0.15, k));
      gunDrop = (1 - k) * 0.3;
    } else this.shieldK = 1;
    this.rigDt = dt;
    const p = this.cur.userData.pose;
    this.holder.position.set(p[0] + bx + this.swayX - this.slash * 0.08 - sd * 0.04, p[1] + by - ro * 0.28 - rl * 0.1 - sd * 0.08 + this.swayY - s.crouch * 0.008 - gunDrop, p[2] + this.kickZ - this.slash * 0.1);
    this.holder.rotation.set(this.kickRot + rl * 0.55 - ro * 0.7 + this.slash * 0.4 + sd * 0.2, this.swayX * 1.5 + this.slash * 0.7 + sd * 0.5, rl * 0.5 - this.slash * 0.6);
    for (const g of this.cur.userData.guns) Models.setSilencer(g, s.silOn);
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    if (this.rig) this.poseArms(dt);
  },
  // the avatar's own arms reach for the weapon wherever the bob, sway, recoil and reload put it
  poseArms(dt) {
    const rig = this.rig, kind = this.cur.userData.kind, B = rig.b;
    rig.idleT += dt;
    rig.pose({ idle: [1, rig.idleT % Avatars.clips.idle.dur] });
    B.LClav.position.copy(rig.clavRest.L); B.RClav.position.copy(rig.clavRest.R);
    this.root.updateMatrixWorld(true);
    // move each shoulder joint to its off-screen anchor for this way of holding the weapon
    const sh = VM_SHOULDERS[kind] || VM_SHOULDERS.rifle;
    for (const side of ['L', 'R']) {
      const clav = B[side + 'Clav'];
      _vmA.setFromMatrixPosition(B[side + 'Up'].matrixWorld);
      _vmB.setFromMatrixPosition(clav.matrixWorld).add(_vmC.fromArray(sh[side])).sub(_vmA);
      clav.position.copy(clav.parent.worldToLocal(_vmB));
      clav.updateMatrixWorld(true);
    }
    const guns = this.cur.userData.guns;
    holdWith(rig, kind, guns[0], guns[1], this.shieldMesh);
  },
};
// first-person body: head at the eye, scaled like the viewmodel guns; shoulder anchors (camera space, metres) per hold
const VM_BODY = { scale: 0.84, y: -0.05, z: 0.04 };
const VM_SHOULDERS = {
  rifle: { R: [0.21, -0.31, -0.02], L: [-0.04, -0.31, -0.26] },
  smg: { R: [0.2, -0.31, -0.03], L: [-0.02, -0.31, -0.2] },
  shotgun: { R: [0.21, -0.31, -0.02], L: [-0.03, -0.31, -0.28] },
  sniper: { R: [0.22, -0.32, -0.02], L: [-0.03, -0.32, -0.27] },
  mg: { R: [0.21, -0.33, -0.02], L: [-0.03, -0.33, -0.28] },
  pistol: { R: [0.2, -0.3, -0.05], L: [-0.06, -0.3, -0.1] },
  dual: { R: [0.21, -0.3, -0.04], L: [-0.21, -0.3, -0.04] },
  shield: { R: [0.22, -0.3, -0.04], L: [-0.15, -0.32, -0.04] },
  knife: { R: [0.2, -0.3, -0.04], L: [-0.22, -0.4, 0.08] },
  grenade: { R: [0.2, -0.3, -0.02], L: [-0.22, -0.4, 0.08] },
  bomb: { R: [0.18, -0.3, -0.04], L: [-0.18, -0.3, -0.04] },
};
const _vmA = new THREE.Vector3(), _vmB = new THREE.Vector3(), _vmC = new THREE.Vector3();
