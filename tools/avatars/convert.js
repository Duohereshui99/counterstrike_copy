// Converts the downloaded Rocketbox avatars and clips (see fetch.js) into the compact files in assets/:
//   avatars/<key>.bin   quantized skinned mesh (positions u16, normals i8, uvs u16, skin u8, indices)
//   avatars/<key>.inv   bone inverse bind matrices (f32)
//   avatars/<key>_*.webp colour / normal textures, downsized
//   anims.bin           int16 quaternion clips + root height
//   avatars.json        manifest (bones, materials, offsets, clip layout)
// The FBX files are parsed by three.js' FBXLoader inside headless Chromium (Playwright); textures go through Pillow.
//   npm install && npx playwright install chromium && pip install pillow
//   node tools/avatars/convert.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { AVATARS, CLIPS } = require('./selection');

const ROOT = path.resolve(__dirname, '..', '..');
const CACHE = process.env.KESTREL_CACHE || path.join(__dirname, '.cache');
const OUT = process.env.KESTREL_OUT || path.join(ROOT, 'assets');
const THREE_DIR = process.env.THREE_DIR || path.dirname(require.resolve('three/package.json', { paths: [ROOT] }));
const PY = process.env.PYTHON || 'python3';
const ROUTES = {
  '/extract.html': path.join(__dirname, 'extract.html'),
  '/three.min.js': path.join(THREE_DIR, 'build', 'three.min.js'),
  '/fflate.min.js': path.join(THREE_DIR, 'examples', 'js', 'libs', 'fflate.min.js'),
  '/FBXLoader.js': path.join(THREE_DIR, 'examples', 'js', 'loaders', 'FBXLoader.js'),
};

const f32 = (b) => { const buf = Buffer.from(b, 'base64'); return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4); };
const u32 = (b) => { const buf = Buffer.from(b, 'base64'); return new Uint32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)); };
const pad4 = (n) => (n + 3) & ~3;

// FBXLoader returns unindexed triangles: merge identical vertices back into an indexed mesh
function weld(d) {
  const P = f32(d.pos), N = f32(d.nrm), U = f32(d.uv), SI = f32(d.si), SW = f32(d.sw);
  const src = d.index ? u32(d.index) : null;
  const map = new Map(), verts = [];
  const r = (v, k) => Math.round(v * k);
  const idOf = (i) => {
    const key = [r(P[i * 3], 1e3), r(P[i * 3 + 1], 1e3), r(P[i * 3 + 2], 1e3), r(N[i * 3], 1e3), r(N[i * 3 + 1], 1e3), r(N[i * 3 + 2], 1e3), r(U[i * 2], 1e5), r(U[i * 2 + 1], 1e5),
      SI[i * 4], SI[i * 4 + 1], SI[i * 4 + 2], SI[i * 4 + 3], r(SW[i * 4], 1e3), r(SW[i * 4 + 1], 1e3), r(SW[i * 4 + 2], 1e3), r(SW[i * 4 + 3], 1e3)].join(',');
    let id = map.get(key);
    if (id === undefined) { id = verts.length; map.set(key, id); verts.push(i); }
    return id;
  };
  const groups = [], indices = [];
  const gl = d.groups.length ? d.groups : [{ start: 0, count: src ? src.length : d.count, mat: 0 }];
  for (const g of gl) {
    const start = indices.length;
    for (let k = g.start; k < g.start + g.count; k++) indices.push(idOf(src ? src[k] : k));
    groups.push({ start, count: indices.length - start, mat: g.mat });
  }
  return { P, N, U, SI, SW, verts, indices, groups };
}

function pack(w) {
  const V = w.verts.length, I = w.indices.length;
  const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9], umin = [1e9, 1e9], umax = [-1e9, -1e9];
  for (const i of w.verts) {
    for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], w.P[i * 3 + c]); max[c] = Math.max(max[c], w.P[i * 3 + c]); }
    for (let c = 0; c < 2; c++) { umin[c] = Math.min(umin[c], w.U[i * 2 + c]); umax[c] = Math.max(umax[c], w.U[i * 2 + c]); }
  }
  const big = V > 65535;
  const sizes = { pos: pad4(V * 6), nrm: pad4(V * 3), uv: pad4(V * 4), si: V * 4, sw: V * 4, idx: pad4(I * (big ? 4 : 2)) };
  const off = {}; let o = 0;
  for (const k of ['pos', 'nrm', 'uv', 'si', 'sw', 'idx']) { off[k] = o; o += sizes[k]; }
  const buf = Buffer.alloc(o);
  const pos = new Uint16Array(buf.buffer, buf.byteOffset + off.pos, V * 3), nrm = new Int8Array(buf.buffer, buf.byteOffset + off.nrm, V * 3), uv = new Uint16Array(buf.buffer, buf.byteOffset + off.uv, V * 2);
  const si = new Uint8Array(buf.buffer, buf.byteOffset + off.si, V * 4), sw = new Uint8Array(buf.buffer, buf.byteOffset + off.sw, V * 4);
  w.verts.forEach((i, v) => {
    for (let c = 0; c < 3; c++) pos[v * 3 + c] = Math.round((w.P[i * 3 + c] - min[c]) / Math.max(1e-6, max[c] - min[c]) * 65535);
    const nl = Math.hypot(w.N[i * 3], w.N[i * 3 + 1], w.N[i * 3 + 2]) || 1;
    for (let c = 0; c < 3; c++) nrm[v * 3 + c] = Math.round(w.N[i * 3 + c] / nl * 127);
    for (let c = 0; c < 2; c++) uv[v * 2 + c] = Math.round((w.U[i * 2 + c] - umin[c]) / Math.max(1e-6, umax[c] - umin[c]) * 65535);
    const ws = [0, 1, 2, 3].map((c) => w.SW[i * 4 + c]); const tot = ws.reduce((a, b) => a + b, 0) || 1;
    const q = ws.map((x) => Math.round(x / tot * 255)); const diff = 255 - q.reduce((a, b) => a + b, 0); q[q.indexOf(Math.max(...q))] += diff;
    for (let c = 0; c < 4; c++) { si[v * 4 + c] = q[c] > 0 ? w.SI[i * 4 + c] : 0; sw[v * 4 + c] = q[c]; }
  });
  const idx = big ? new Uint32Array(buf.buffer, buf.byteOffset + off.idx, I) : new Uint16Array(buf.buffer, buf.byteOffset + off.idx, I);
  idx.set(w.indices);
  return { buf, meta: { V, I, big, min, max, umin, umax, off } };
}

const texture = (src, dst, size, alpha) => execFileSync(PY, ['-I', path.join(__dirname, 'tex.py'), src, dst, String(size), alpha === 'normal' ? '82' : '80', alpha === true ? '1' : '0']);

(async () => {
  fs.mkdirSync(path.join(OUT, 'avatars'), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.route('http://local/**', (r) => {
    const p = decodeURIComponent(new URL(r.request().url()).pathname);
    const f = ROUTES[p] || (p.startsWith('/cache/') ? path.join(CACHE, p.slice(7)) : null);
    if (!f || !fs.existsSync(f)) return r.fulfill({ status: 404, body: 'not found' });
    r.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'application/javascript' : 'application/octet-stream' });
  });
  await page.goto('http://local/extract.html');
  await page.waitForFunction(() => window.ready);
  const manifest = { avatars: {}, clips: {} };
  let total = 0;
  for (const [key, rel] of AVATARS) {
    const name = path.basename(rel);
    const d = await page.evaluate((u) => extractAvatar(u), `/cache/${name}/${name}.fbx`);
    const w = weld(d);
    const { buf, meta } = pack(w);
    fs.writeFileSync(path.join(OUT, 'avatars', `${key}.bin`), buf);
    const inv = Buffer.from(d.inv, 'base64');
    fs.writeFileSync(path.join(OUT, 'avatars', `${key}.inv`), inv);
    total += buf.length + inv.length;
    const dir = path.join(CACHE, name), files = fs.readdirSync(dir);
    const mats = d.mats.map((mn) => {
      const prefix = mn.split('_')[0], mk = mn.slice(prefix.length + 1);
      const colorFile = files.find((f) => f === `${prefix}_${mk}_color.tga`) || files.find((f) => f === `${prefix}_${mk}_opacity_color.tga`);
      const normalFile = files.find((f) => f === `${prefix}_${mk}_normal.tga`);
      const alpha = !!colorFile && /opacity/.test(colorFile);
      const cSize = mk === 'pistol' || mk === 'glasses' ? 128 : (mk === 'body' || mk === 'head') ? 512 : 256;
      const nSize = mk === 'body' ? 512 : 256;
      const m = { key: mk, alpha };
      if (colorFile) { m.color = `${key}_${mk}_c.webp`; texture(path.join(dir, colorFile), path.join(OUT, 'avatars', m.color), cSize, alpha); total += fs.statSync(path.join(OUT, 'avatars', m.color)).size; }
      if (normalFile && mk !== 'pistol' && mk !== 'glasses') { m.normal = `${key}_${mk}_n.webp`; texture(path.join(dir, normalFile), path.join(OUT, 'avatars', m.normal), nSize, 'normal'); total += fs.statSync(path.join(OUT, 'avatars', m.normal)).size; }
      return m;
    });
    manifest.avatars[key] = { src: name, ...meta, groups: w.groups, mats, bones: d.bones.map((b) => ({ n: b.n, p: b.p, t: b.t.map((v) => +v.toFixed(4)), q: b.q.map((v) => +v.toFixed(6)), s: b.s.map((v) => +v.toFixed(5)) })),
      meshT: d.meshT, meshQ: d.meshQ, meshS: d.meshS, bind: d.bind.map((v) => +v.toFixed(6)), meshParentRoot: d.meshParentRoot };
    console.log(`${key.padEnd(7)} ${name.padEnd(20)} verts ${d.count} -> ${meta.V}, tris ${meta.I / 3}, bones ${d.bones.length}, ${(buf.length / 1024).toFixed(0)} KB`);
  }
  // clips: int16 quaternions, root height in millimetres
  const parts = []; let coff = 0;
  for (const [key, rel, fps] of CLIPS) {
    const file = path.basename(rel);
    const c = await page.evaluate(([u, f]) => extractClip(u, f), [`/cache/anims/${file}.fbx`, fps]);
    const q = f32(c.q), y = f32(c.y);
    const qi = new Int16Array(q.length); for (let i = 0; i < q.length; i++) qi[i] = Math.round(q[i] * 32767);
    const yi = new Int16Array(y.length); for (let i = 0; i < y.length; i++) yi[i] = Math.round(y[i] * 10);
    const b = Buffer.concat([Buffer.from(qi.buffer), Buffer.from(yi.buffer)]);
    const padded = Buffer.concat([b, Buffer.alloc(pad4(b.length) - b.length)]);
    manifest.clips[key] = { src: file, bones: c.bones, frames: c.frames, fps: c.fps, dur: c.dur, speed: +c.speed.toFixed(3), off: coff, qLen: qi.length, yLen: yi.length };
    parts.push(padded); coff += padded.length;
    console.log(`clip ${key.padEnd(6)} ${file.padEnd(18)} ${c.frames} frames @${fps}, ${c.speed.toFixed(2)} m/s`);
  }
  fs.writeFileSync(path.join(OUT, 'anims.bin'), Buffer.concat(parts));
  total += coff;
  fs.writeFileSync(path.join(OUT, 'avatars.json'), JSON.stringify(manifest));
  fs.copyFileSync(path.join(CACHE, 'LICENSE.md'), path.join(OUT, 'ROCKETBOX-LICENSE.md'));
  console.log(`assets: ${(total / 1024 / 1024).toFixed(2)} MB in ${OUT}`);
  await browser.close();
})();
