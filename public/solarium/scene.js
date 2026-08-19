/* Save Solarium — stage backdrops.
 *
 * Drawn rather than stored. Four hand-painted murals would be a lot of pixels
 * to author and to ship; instead the skyline is generated from a seed and a
 * single `decay` value drives everything that makes it look worse.
 *
 * It is always daytime. Decay makes the air filthy, not dark — a rusted
 * Solarium is a hazy, bleached, smog-yellow afternoon, never nightfall. Going
 * dark reads as dusk, which makes the world look asleep rather than poisoned.
 *
 * The city is drawn once into an offscreen canvas and only the turbine blades
 * are redrawn per frame, so the backdrop animates for the price of one blit
 * and a few dozen pixels instead of sixty thousand.
 */

const W = 320, H = 190;

function rng(seed){
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x9E3779B9) | 0;
    let t = Math.imul(a ^ (a >>> 16), 0x21F0AAAD);
    t = Math.imul(t ^ (t >>> 15), 0x735A2D97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

/* Accepts both "#rrggbb" and "rgb(r,g,b)".
 *
 * This matters more than it looks: pal() returns rgb() strings, and the sky is
 * built by blending two of those. Parsing only hex quietly produced
 * "rgb(NaN,NaN,NaN)", which canvas ignores as an invalid fillStyle — leaving
 * the previous colour in place and painting the entire sky black. The world
 * looked like night for reasons that had nothing to do with the palette. */
const hex = c => {
  if(c[0] === '#') return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
};
const mix = (a, b, t) => {
  const A = hex(a), B = hex(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
};

const LUSH = {
  sky1: '#6fc9ef', sky2: '#b6e8f8', sky3: '#fdf6dc',
  far: '#a9d6c0', mid: '#7fbf8e', near: '#5aa06a',
  wall: '#f0dfba', wallDark: '#cdb389', roof: '#4f7f8f',
  glass: '#8fe0e8', panel: '#3f6f9f', panelLit: '#a9e2ff',
  leaf: '#6cc24a', leafDark: '#3f8f38', trunk: '#8a5a3c',
  metal: '#dfe6e9', smoke: '#e6f0f4', sun: '#ffd23f', bloom: '#ff8fbf'
};
/* Bleached and yellowed — still broad daylight, just filthy air. */
const RUST = {
  sky1: '#c9b184', sky2: '#dcc79a', sky3: '#ece0bb',
  far: '#a08f6f', mid: '#8a7a58', near: '#6e6044',
  wall: '#a8977a', wallDark: '#7a6a52', roof: '#7d6b52',
  glass: '#a5a892', panel: '#7d7566', panelLit: '#9c9382',
  leaf: '#a89f5e', leafDark: '#7d7742', trunk: '#6f5238',
  metal: '#b3aa9c', smoke: '#9a8e7c', sun: '#f0c060', bloom: '#a89070'
};

const pal = d => {
  const out = {};
  for(const k of Object.keys(LUSH)) out[k] = mix(LUSH[k], RUST[k], d);
  return out;
};

/* --------------------------------------------------------------- pieces */

function panelRoof(g, p, x, y, w, decay, rnd, bloom){
  g.fillStyle = p.panel;
  g.fillRect(x, y - 3, w, 3);
  for(let i = 0; i < w; i += 4){
    // A restored city has every cell lit; a rusted one has holes punched in it.
    if(bloom || rnd() > decay * 0.85){
      g.fillStyle = p.panelLit;
      g.fillRect(x + i + 1, y - 2, 2, 1);
    }else if(rnd() < decay * 0.4){
      g.fillStyle = p.wallDark;
      g.fillRect(x + i + 1, y - 3, 2, 3);
    }
  }
}

function vines(g, p, x, y, h, decay, rnd, bloom){
  const density = Math.max(0, 1 - decay * 1.2) * (bloom ? 1.8 : 1);
  const n = Math.round(h * 0.5 * density);
  for(let i = 0; i < n; i++){
    const vx = x + Math.floor(rnd() * (bloom ? 4 : 3)), vy = y + Math.floor(rnd() * h);
    g.fillStyle = bloom && rnd() < 0.12 ? p.bloom : (rnd() < 0.5 ? p.leaf : p.leafDark);
    g.fillRect(vx, vy, 1, 1 + Math.round(rnd()));
  }
}

function building(g, p, x, ground, decay, rnd, bloom){
  const w = 16 + Math.floor(rnd() * 22);
  const h = 20 + Math.floor(rnd() * 38);
  const y = ground - h;
  const kind = rnd();

  g.fillStyle = p.wall;
  g.fillRect(x, y, w, h);
  g.fillStyle = p.wallDark;
  g.fillRect(x, y, 2, h);
  g.fillRect(x, ground - 2, w, 2);

  if(!bloom && decay > 0.55 && rnd() < decay){
    g.clearRect(x + w - 4 - Math.floor(rnd() * 5), y, 4 + Math.floor(rnd() * 5), 3 + Math.floor(rnd() * 5));
  }

  for(let wy = y + 4; wy < ground - 5; wy += 6){
    for(let wx = x + 4; wx < x + w - 4; wx += 6){
      const broken = !bloom && rnd() < decay * 0.75;
      g.fillStyle = broken ? p.wallDark : (rnd() < (bloom ? 0.45 : 0.3) ? p.sun : p.glass);
      g.fillRect(wx, wy, 3, 3);
    }
  }

  if(kind < 0.42) panelRoof(g, p, x + 1, y, w - 2, decay, rnd, bloom);
  else if(kind < 0.6){
    g.fillStyle = p.glass;
    for(let i = 0; i < 7; i++) g.fillRect(x + 2 + i, y - 1 - Math.round(Math.sin(i / 6 * Math.PI) * 5), w - 4 - i * 2 + 1, 1);
  }else if(kind < 0.75){
    g.fillStyle = p.metal;
    g.fillRect(x + Math.floor(w / 2) - 4, y - 7, 8, 7);
    g.fillStyle = p.wallDark; g.fillRect(x + Math.floor(w / 2) - 4, y - 7, 8, 1);
  }
  if(!bloom && decay > 0.4 && rnd() < decay * 0.8){
    const sx = x + Math.floor(w / 2);
    g.fillStyle = p.wallDark;
    g.fillRect(sx, y - 12, 4, 12);
    g.fillStyle = p.smoke;
    for(let i = 0; i < 5; i++) g.fillRect(sx - 1 + Math.round(rnd() * 3), y - 14 - i * 3, 2 + Math.round(rnd() * 2), 2);
  }

  vines(g, p, x + w - 3, y + 4, h - 8, decay, rnd, bloom);
  return w;
}

function tree(g, p, x, ground, decay, rnd, bloom){
  const h = 8 + Math.floor(rnd() * 8);
  g.fillStyle = p.trunk;
  g.fillRect(x, ground - h, 2, h);
  const r = Math.round((5 + rnd() * 3) * (bloom ? 1.25 : 1 - decay * 0.65));
  for(let dy = -r; dy <= r; dy++){
    for(let dx = -r; dx <= r; dx++){
      if(dx * dx + dy * dy > r * r) continue;
      if(!bloom && rnd() < decay * 0.55) continue;
      g.fillStyle = bloom && rnd() < 0.1 ? p.bloom : (rnd() < 0.35 ? p.leafDark : p.leaf);
      g.fillRect(x + 1 + dx, ground - h - r + dy, 1, 1);
    }
  }
}

/* Blades are the only moving part, so they stay out of the baked city. */
function blades(g, p, t, phase){
  g.fillStyle = p.metal;
  for(let i = 0; i < 3; i++){
    const a = (i / 3) * Math.PI * 2 + phase;
    for(let s = 2; s < t.len; s++){
      g.fillRect(Math.round(t.x + Math.cos(a) * s), Math.round(t.y + Math.sin(a) * s), 1, 1);
    }
  }
  g.fillStyle = p.wallDark;
  g.fillRect(t.x - 1, t.y - 1, 3, 3);
}

/* ---------------------------------------------------------------- build */

export function buildScene(level, seedBase, opts){
  const bloom = !!(opts && opts.restored);
  const decay = bloom ? 0 : Math.max(0, Math.min(1, level / 3));
  const p = pal(decay);
  const rnd = rng((seedBase || 1) * 7919 + (bloom ? 5150 : level * 104729));

  const base = document.createElement('canvas');
  base.width = W; base.height = H;
  const g = base.getContext('2d');

  const bands = 16;
  for(let i = 0; i < bands; i++){
    const t = i / (bands - 1);
    g.fillStyle = t < 0.5 ? mix(p.sky1, p.sky2, t * 2) : mix(p.sky2, p.sky3, (t - 0.5) * 2);
    g.fillRect(0, Math.floor(i * H / bands), W, Math.ceil(H / bands) + 1);
  }

  // The sun stays high and bright. Haze dulls it; nothing ever sets it.
  const sx = Math.round(W * 0.78), sy = Math.round(32 + decay * 8), sr = Math.round(13 - decay * 3);
  g.fillStyle = p.sun;
  for(let dy = -sr; dy <= sr; dy++) for(let dx = -sr; dx <= sr; dx++)
    if(dx * dx + dy * dy <= sr * sr) g.fillRect(sx + dx, sy + dy, 1, 1);
  if(bloom){                                     // clean air earns rays
    for(let i = 0; i < 8; i++){
      const a = i / 8 * Math.PI * 2 + 0.4;
      for(let s = sr + 3; s < sr + 10; s += 2)
        g.fillRect(Math.round(sx + Math.cos(a) * s), Math.round(sy + Math.sin(a) * s), 1, 1);
    }
  }

  const ground = H - 16;

  g.fillStyle = p.far;
  for(let x = 0; x < W; x++){
    const y = ground - 30 - Math.round(Math.sin(x / 41) * 8 + Math.sin(x / 13) * 3);
    g.fillRect(x, y, 1, H - y);
  }

  const turbines = [];
  let x = -6;
  while(x < W){
    // A working Solarium bristles with turbines; a dying one has a few left.
    if(rnd() < (bloom ? 0.75 : 0.42 * (1 - decay * 0.55))){
      const tx = x + 4, th = 30 + Math.floor(rnd() * 22);
      g.fillStyle = p.metal;
      g.fillRect(tx, ground - 4 - th, 2, th);
      turbines.push({ x: tx + 1, y: ground - 4 - th,
                      len: Math.round((bloom ? 12 : 10) * (1 - decay * 0.5)) });
    }
    x += building(g, p, x, ground - 4, decay, rnd, bloom) + 2 + Math.floor(rnd() * 5);
  }

  g.fillStyle = p.mid;
  g.fillRect(0, ground - 4, W, 4);
  g.fillStyle = p.near;
  g.fillRect(0, ground, W, H - ground);

  const trees = bloom ? 30 : 16;
  for(let i = 0; i < trees; i++){
    if(!bloom && rnd() > 1 - decay * 0.6) continue;
    tree(g, p, Math.floor(rnd() * W), ground + 2, decay, rnd, bloom);
  }
  if(bloom){                                     // wildflowers along the front
    for(let i = 0; i < 70; i++){
      g.fillStyle = rnd() < 0.5 ? p.bloom : p.sun;
      g.fillRect(Math.floor(rnd() * W), ground + 2 + Math.floor(rnd() * 12), 1, 1);
    }
  }

  // Haze: yellow and thick when filthy, gone entirely when the air is clean.
  if(decay > 0.05){
    g.fillStyle = `rgba(198,166,96,${(decay * 0.26).toFixed(3)})`;
    g.fillRect(0, 0, W, H);
  }

  // Blades turn briskly in a working city and barely at all in a dead one.
  const spin = bloom ? 1.5 : Math.max(0.05, 1 - decay * 0.95);
  return { base, turbines, spin, pal: p, bloom };
}

/* Per-frame paint: blit the city, then turn the blades. */
export function paintScene(canvas, built, phase){
  if(canvas.width !== W){ canvas.width = W; canvas.height = H; }
  const g = canvas.getContext('2d');
  g.drawImage(built.base, 0, 0);
  for(const t of built.turbines) blades(g, built.pal, t, phase * built.spin);
}

export const STAGE_NAMES = [
  'The Glasshouse Quarter',
  'Panel Row',
  'The Drying Fields',
  'The Extractor Yard'
];
export const RESTORED_NAME = 'The Solarium, Restored';
