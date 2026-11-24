'use strict';
/* =========================================================
   textures.js — every surface texture is painted on a canvas
   at load time (no image files): poured concrete, brick,
   asphalt, crates, corrugated containers, site markings.
   ========================================================= */
const TEX = {};

function buildTextures(maxAniso) {
  const rng = mulberry32(20261107);
  const aniso = Math.min(8, maxAniso || 1);
  function mk(w, h, draw, repeat = true) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
    t.anisotropy = aniso;
    return t;
  }
  function grain(g, w, h, amt) {
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rng() - 0.5) * amt;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  }
  // soft blotches drawn with wrap-around so the texture tiles
  function blot(g, w, h, n, r0, r1, colorFn) {
    for (let i = 0; i < n; i++) {
      const x = rng() * w, y = rng() * h, r = r0 + rng() * (r1 - r0), col = colorFn(rng());
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        const cx = x + ox, cy = y + oy;
        if (cx + r < 0 || cy + r < 0 || cx - r > w || cy - r > h) continue;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
  }
  const tone = (v, dark, light, a) => (v < 0.5 ? `rgba(${dark},${a})` : `rgba(${light},${a})`);

  // poured concrete walls: 256px = 4 m
  TEX.concrete = mk(256, 256, (g, w, h) => {
    g.fillStyle = '#a49e95'; g.fillRect(0, 0, w, h);
    blot(g, w, h, 36, 12, 56, (v) => tone(v, '70,64,58', '235,230,220', 0.07 + v * 0.05));
    g.fillStyle = 'rgba(48,42,36,0.22)'; for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 2);
    g.fillStyle = 'rgba(48,42,36,0.12)'; for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 2, h);
    g.fillStyle = 'rgba(28,26,24,0.5)';
    for (let y = 32; y < h; y += 64) for (let x = 32; x < w; x += 64) { g.beginPath(); g.arc(x, y, 2.4, 0, TAU); g.fill(); }
    for (let i = 0; i < 16; i++) {
      const x = rng() * w, len = 30 + rng() * 140, wd = 2 + rng() * 6;
      const gr = g.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, 'rgba(52,46,40,0.16)'); gr.addColorStop(1, 'rgba(52,46,40,0)');
      g.fillStyle = gr; g.fillRect(x, 0, wd, len);
    }
    grain(g, w, h, 24);
  });

  // brick: 256px = 2 m, courses of 0.25 m
  TEX.brick = mk(256, 256, (g, w, h) => {
    g.fillStyle = '#958e84'; g.fillRect(0, 0, w, h);
    const bh = 32, bw = 64;
    for (let row = 0; row < h / bh; row++) {
      const off = (row % 2) * bw / 2;
      for (let col = -1; col <= w / bw; col++) {
        const x = col * bw + off, y = row * bh;
        const r = 118 + rng() * 44, gg = 56 + rng() * 24, b = 40 + rng() * 18;
        g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
        g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        g.fillStyle = 'rgba(255,225,205,0.08)'; g.fillRect(x + 2, y + 2, bw - 4, 3);
        g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(x + 2, y + bh - 5, bw - 4, 3);
      }
    }
    blot(g, w, h, 14, 20, 70, (v) => tone(v, '20,16,14', '200,190,170', 0.08));
    grain(g, w, h, 28);
  });

  // asphalt yard: 256px = 4 m
  TEX.asphalt = mk(256, 256, (g, w, h) => {
    g.fillStyle = '#4b4946'; g.fillRect(0, 0, w, h);
    blot(g, w, h, 46, 8, 46, (v) => tone(v, '18,18,18', '130,124,114', 0.09));
    for (let i = 0; i < 2600; i++) {
      const c = 64 + rng() * 96;
      g.fillStyle = `rgba(${c | 0},${c | 0},${(c - 6) | 0},${0.22 + rng() * 0.35})`;
      g.fillRect(rng() * w, rng() * h, 1 + rng() * 1.6, 1 + rng() * 1.6);
    }
    g.strokeStyle = 'rgba(14,14,14,0.55)'; g.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      let x = rng() * w, y = rng() * h;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 16; k++) { x += (rng() - 0.5) * 18; y += (rng() - 0.5) * 18; g.lineTo(x, y); }
      g.stroke();
    }
    grain(g, w, h, 20);
  });

  // concrete slab floor: 256px = 4 m, slab seams every 2 m
  TEX.floorc = mk(256, 256, (g, w, h) => {
    g.fillStyle = '#8c8881'; g.fillRect(0, 0, w, h);
    blot(g, w, h, 40, 10, 60, (v) => tone(v, '50,46,42', '220,214,204', 0.08));
    g.fillStyle = 'rgba(40,36,32,0.35)';
    for (let y = 0; y < h; y += 128) g.fillRect(0, y, w, 2);
    for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 2, h);
    for (let i = 0; i < 5; i++) {
      const x = rng() * w, y = rng() * h, r = 10 + rng() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(30,26,20,0.22)'); gr.addColorStop(1, 'rgba(30,26,20,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    grain(g, w, h, 18);
  });

  // wooden crate face: 128x64 = 2 m x 1 m
  TEX.crate = mk(128, 64, (g, w, h) => {
    g.fillStyle = '#9c7147'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      g.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,230,190,0.06)'; g.fillRect(0, y, w, 16);
      g.fillStyle = 'rgba(42,26,10,0.55)'; g.fillRect(0, y, w, 1);
    }
    for (let i = 0; i < 70; i++) { g.fillStyle = 'rgba(64,38,16,0.16)'; g.fillRect(rng() * w, rng() * h, 6 + rng() * 34, 1); }
    g.fillStyle = '#76522f';
    g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6); g.fillRect(0, 0, 6, h); g.fillRect(w - 6, 0, 6, h); g.fillRect(w / 2 - 3, 0, 6, h);
    g.strokeStyle = '#76522f'; g.lineWidth = 6; g.beginPath();
    g.moveTo(6, h - 6); g.lineTo(w / 2 - 3, 6); g.moveTo(w / 2 + 3, h - 6); g.lineTo(w - 6, 6); g.stroke();
    g.fillStyle = 'rgba(30,30,30,0.7)';
    for (const [x, y] of [[3, 3], [w - 4, 3], [3, h - 4], [w - 4, h - 4], [w / 2, 3], [w / 2, h - 4]]) g.fillRect(x - 1, y - 1, 2, 2);
    g.strokeStyle = 'rgba(28,16,6,0.7)'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, w - 1, h - 1);
    g.font = 'bold 9px monospace'; g.fillStyle = 'rgba(30,20,10,0.55)'; g.fillText('KST-' + (100 + Math.floor(rng() * 899)), 12, 38);
    grain(g, w, h, 18);
  });

  // corrugated container steel (grey, tinted per container by vertex colour): 128px = 2 m x 2.6 m
  TEX.container = mk(128, 128, (g, w, h) => {
    g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const gr = g.createLinearGradient(x, 0, x + 16, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0.22)'); gr.addColorStop(0.28, 'rgba(255,255,255,0.16)');
      gr.addColorStop(0.62, 'rgba(0,0,0,0.04)'); gr.addColorStop(1, 'rgba(0,0,0,0.22)');
      g.fillStyle = gr; g.fillRect(x, 0, 16, h);
    }
    g.fillStyle = 'rgba(30,30,30,0.6)'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 9, w, 9);
    for (let i = 0; i < 12; i++) { g.fillStyle = 'rgba(96,52,22,0.22)'; g.fillRect(rng() * w, 6, 2 + rng() * 3, 20 + rng() * 70); }
    blot(g, w, h, 10, 8, 30, () => 'rgba(80,44,20,0.12)');
    grain(g, w, h, 16);
  });

  // square crate faces (uv 0..1 per face): framed planks with a diagonal brace, and a battened variant
  TEX.crateSq = mk(128, 128, (g, w, h) => {
    g.fillStyle = '#a2774b'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 21) {
      g.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,232,196,0.07)'; g.fillRect(0, y, w, 21);
      g.fillStyle = 'rgba(46,28,12,0.55)'; g.fillRect(0, y, w, 1.5);
    }
    for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(70,42,18,0.16)'; g.fillRect(rng() * w, rng() * h, 8 + rng() * 40, 1); }
    g.fillStyle = '#7b5532';
    g.fillRect(0, 0, w, 11); g.fillRect(0, h - 11, w, 11); g.fillRect(0, 0, 11, h); g.fillRect(w - 11, 0, 11, h);
    g.save(); g.strokeStyle = '#7b5532'; g.lineWidth = 11; g.beginPath(); g.moveTo(8, h - 8); g.lineTo(w - 8, 8); g.stroke(); g.restore();
    g.strokeStyle = 'rgba(30,18,8,0.55)'; g.lineWidth = 1;
    g.strokeRect(11.5, 11.5, w - 23, h - 23); g.strokeRect(0.5, 0.5, w - 1, h - 1);
    g.fillStyle = 'rgba(25,25,25,0.75)';
    for (const [x, y] of [[5, 5], [w - 6, 5], [5, h - 6], [w - 6, h - 6], [w / 2, 5], [w / 2, h - 6], [5, h / 2], [w - 6, h / 2]]) g.fillRect(x - 1, y - 1, 2.4, 2.4);
    grain(g, w, h, 16);
  });
  TEX.crateSq2 = mk(128, 128, (g, w, h) => {
    g.fillStyle = '#8f6a45'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      g.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,230,190,0.06)'; g.fillRect(x, 0, 16, h);
      g.fillStyle = 'rgba(40,24,10,0.55)'; g.fillRect(x, 0, 1.5, h);
    }
    for (let i = 0; i < 80; i++) { g.fillStyle = 'rgba(60,36,14,0.16)'; g.fillRect(rng() * w, rng() * h, 1, 8 + rng() * 30); }
    g.fillStyle = '#6f4c2c'; g.fillRect(0, 14, w, 13); g.fillRect(0, h - 27, w, 13);
    g.fillStyle = 'rgba(25,25,25,0.75)';
    for (let x = 8; x < w; x += 16) { g.fillRect(x - 1, 19, 2.4, 2.4); g.fillRect(x - 1, h - 22, 2.4, 2.4); }
    g.fillStyle = 'rgba(40,22,10,0.6)'; g.font = 'bold 15px monospace'; g.textAlign = 'center';
    g.fillText('KST', w / 2, h / 2 + 2); g.fillText('↑↑', w / 2, h / 2 + 20);
    grain(g, w, h, 16);
  });
  // container door end (greyscale, tinted per container): two doors, lock rods, hinges, placard
  TEX.containerDoor = mk(128, 128, (g, w, h) => {
    g.fillStyle = '#c9c9c9'; g.fillRect(0, 0, w, h);
    for (let x = 4; x < w - 4; x += 10) {
      const gr = g.createLinearGradient(x, 0, x + 10, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0.12)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)');
      g.fillStyle = gr; g.fillRect(x, 12, 10, h - 26);
    }
    g.fillStyle = 'rgba(30,30,30,0.6)'; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 12, w, 12); g.fillRect(0, 0, 5, h); g.fillRect(w - 5, 0, 5, h);
    g.fillStyle = 'rgba(20,20,20,0.7)'; g.fillRect(w / 2 - 1.5, 10, 3, h - 22);
    for (const x of [22, 46, 82, 106]) {
      g.fillStyle = 'rgba(35,35,35,0.85)'; g.fillRect(x - 1.5, 10, 3, h - 22);
      g.fillStyle = 'rgba(25,25,25,0.9)'; g.fillRect(x - 3, 58, 6, 14); g.fillRect(x - 2, 66, 9, 3);
    }
    g.fillStyle = 'rgba(20,20,20,0.75)';
    for (const y of [22, 48, 76, 102]) { g.fillRect(5, y, 5, 8); g.fillRect(w - 10, y, 5, 8); }
    g.fillStyle = 'rgba(245,245,240,0.8)'; g.fillRect(56, 24, 16, 10);
    for (let i = 0; i < 8; i++) { g.fillStyle = 'rgba(96,52,22,0.2)'; g.fillRect(rng() * w, 10, 2 + rng() * 3, 10 + rng() * 50); }
    grain(g, w, h, 14);
  });

  // stair / dock edge with hazard stripes: 128x32 = 2 m x 0.45 m
  TEX.hazard = mk(128, 32, (g, w, h) => {
    g.fillStyle = '#7e7a74'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1e1e1e'; g.fillRect(0, 0, w, 10);
    g.save(); g.beginPath(); g.rect(0, 0, w, 10); g.clip();
    g.fillStyle = '#dcaa1e';
    for (let x = -24; x < w + 24; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 8, 0); g.lineTo(x + 18, 10); g.lineTo(x + 10, 10); g.closePath(); g.fill(); }
    g.restore();
    grain(g, w, h, 18);
  });

  // warehouse window: steel frame, dirty glass with a sky reflection
  TEX.window = mk(64, 80, (g, w, h) => {
    g.fillStyle = '#2b2f33'; g.fillRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#5d7286'); gr.addColorStop(0.45, '#33414e'); gr.addColorStop(1, '#1d242b');
    g.fillStyle = gr; g.fillRect(5, 5, w - 10, h - 10);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.moveTo(8, h - 10); g.lineTo(26, 8); g.lineTo(36, 8); g.lineTo(18, h - 10); g.fill();
    g.fillStyle = '#2b2f33'; g.fillRect(w / 2 - 2, 5, 4, h - 10); g.fillRect(5, h / 2 - 2, w - 10, 4);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(5, h - 9, w - 10, 4);
    grain(g, w, h, 14);
  }, false);

  // particles, flashes, decals
  TEX.soft = mk(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.65)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }, false);
  TEX.smoke = mk(128, 128, (g) => {
    for (let i = 0; i < 26; i++) {
      const a = rng() * TAU, d = rng() * 34, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, r = 18 + rng() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const c = 215 + rng() * 40;
      gr.addColorStop(0, `rgba(${c | 0},${c | 0},${c | 0},0.42)`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, false);
  TEX.flash = mk(64, 64, (g) => {
    g.translate(32, 32);
    for (let i = 0; i < 7; i++) {
      g.rotate(TAU / 7 + rng() * 0.3);
      const gr = g.createLinearGradient(0, 0, 0, -30);
      gr.addColorStop(0, 'rgba(255,240,200,0.95)'); gr.addColorStop(1, 'rgba(255,170,60,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(-4, 0); g.lineTo(0, -26 - rng() * 6); g.lineTo(4, 0); g.fill();
    }
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 16);
    gr.addColorStop(0, 'rgba(255,255,235,1)'); gr.addColorStop(1, 'rgba(255,190,90,0)');
    g.fillStyle = gr; g.fillRect(-16, -16, 32, 32);
  }, false);
  TEX.hole = mk(32, 32, (g) => {
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 15);
    gr.addColorStop(0, 'rgba(8,8,8,1)'); gr.addColorStop(0.3, 'rgba(18,16,14,0.95)'); gr.addColorStop(0.55, 'rgba(40,36,32,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  }, false);

  // painted site letters for the floor
  function siteTex(letter) {
    return mk(256, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(242,150,40,0.9)';
      g.font = 'bold 210px "Chakra Petch", Impact, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(letter, w / 2, h / 2 + 10);
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${rng() * 0.7})`; g.fillRect(rng() * w, rng() * h, 1 + rng() * 4, 1 + rng() * 3); }
      g.globalCompositeOperation = 'source-over';
    }, false);
  }
  TEX.siteA = siteTex('A');
  TEX.siteB = siteTex('B');
  TEX.paint = mk(64, 16, (g, w, h) => {
    g.fillStyle = 'rgba(232,204,90,0.85)'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(0,0,0,${rng() * 0.8})`; g.fillRect(rng() * w, rng() * h, 1 + rng() * 3, 1 + rng() * 2); }
  });
}

function nameTagTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '600 30px "Chakra Petch", "Noto Sans SC", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.strokeText(text, 128, 32);
  g.fillStyle = color; g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  return t;
}
