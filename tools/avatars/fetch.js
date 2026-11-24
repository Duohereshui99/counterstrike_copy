// Downloads the selected Rocketbox avatars (FBX + colour/normal TGA textures), the motion clips and the licence
// into tools/avatars/.cache (about 700 MB). Needs git and curl.
//   node tools/avatars/fetch.js            all avatars and clips
//   ONLY=swat,idle node tools/avatars/fetch.js   just some of them
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { REPO, RAW, AVATARS, CLIPS } = require('./selection');

const CACHE = process.env.KESTREL_CACHE || path.join(__dirname, '.cache');
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
fs.mkdirSync(CACHE, { recursive: true });

// a blob-less clone is enough to list every file without downloading gigabytes
const tree = path.join(CACHE, 'rb');
if (!fs.existsSync(path.join(tree, '.git'))) execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', '--depth', '1', REPO, tree], { stdio: 'inherit' });
const files = execFileSync('git', ['-C', tree, 'ls-tree', '-r', 'HEAD', '--name-only'], { maxBuffer: 64 << 20 }).toString().split('\n');

function get(rel, out) {
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return;
  const url = `${RAW}/${rel.split('/').map(encodeURIComponent).join('/')}`;
  execFileSync('curl', ['-sS', '--fail', '--retry', '3', '-o', out, url], { stdio: 'inherit' });
}

for (const [key, rel] of AVATARS) {
  if (only && !only.includes(key)) continue;
  const name = path.basename(rel), dir = path.join(CACHE, name);
  fs.mkdirSync(dir, { recursive: true });
  const prefix = `Assets/Avatars/${rel}/`;
  const want = files.filter((f) => f.startsWith(prefix) && ((/\/Export\/[^/]+\.fbx$/.test(f) && !/_facial/.test(f)) || /_(color|normal)[^/]*\.tga$/.test(f)));
  for (const f of want) get(f, path.join(dir, path.basename(f)));
  console.log(`${key.padEnd(7)} ${name}: ${want.length} files`);
}
fs.mkdirSync(path.join(CACHE, 'anims'), { recursive: true });
for (const [key, rel] of CLIPS) {
  if (only && !only.includes(key)) continue;
  get(`Assets/Animations/${rel}.max.fbx`, path.join(CACHE, 'anims', path.basename(rel) + '.fbx'));
  console.log(`clip ${key}`);
}
get('LICENSE.md', path.join(CACHE, 'LICENSE.md'));
console.log('done:', CACHE);
