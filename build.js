// Bundles src/index.html + src/js/*.js + assets/ into single-file outputs:
//   kestrel.html          — standalone page (open directly in a browser)
//   dist/artifact.html    — page body for publishing (no doctype/html/head/body wrapper)
// The avatar models, textures and animation clips are embedded as base64 in a JSON block.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, 'src');
const assets = path.join(__dirname, 'assets');
let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
html = html.replace(/<script src="(js\/[\w.-]+\.js)"><\/script>/g, (_, f) => {
  const code = fs.readFileSync(path.join(src, f), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script>\n/* ${f} */\n${code}\n</script>`;
});

// avatar assets: manifest + every file it references
const manifest = JSON.parse(fs.readFileSync(path.join(assets, 'avatars.json'), 'utf8'));
const files = { 'anims.bin': fs.readFileSync(path.join(assets, 'anims.bin')).toString('base64') };
for (const key in manifest.avatars) {
  const m = manifest.avatars[key];
  for (const ext of ['bin', 'inv']) files[`${key}.${ext}`] = fs.readFileSync(path.join(assets, 'avatars', `${key}.${ext}`)).toString('base64');
  for (const mt of m.mats) for (const f of [mt.color, mt.normal]) if (f) files[f] = fs.readFileSync(path.join(assets, 'avatars', f)).toString('base64');
}
const blob = JSON.stringify({ manifest, files });
html = html.replace('<!--ASSETS-->', `<script id="kestrel-assets" type="application/json">${blob}</script>`);
const license = fs.readFileSync(path.join(assets, 'ROCKETBOX-LICENSE.md'), 'utf8').replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));
html = html.replace('<!--ROCKETBOX_LICENSE-->', license.trim());

fs.writeFileSync(path.join(__dirname, 'kestrel.html'), html);
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'artifact.html'), head.trim() + '\n' + body.trim() + '\n');
console.log('built', (html.length / 1024).toFixed(1) + ' KB', '(assets', (blob.length / 1024).toFixed(0) + ' KB)');
