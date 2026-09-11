/* Orbital Trader: the worlds, as pixels.
 *
 * Every body on the chart used to be a coloured dot, which is honest and
 * completely forgettable: Bramble and Ledger are a green circle and a gold
 * one, and nobody ever learned which was which. These give each of them a
 * face — sixteen pixels across, drawn once into an offscreen canvas and
 * blitted with smoothing off, so it stays crunchy at any zoom.
 *
 * Two kinds of art live here.
 *
 * **Worlds** are generated: a lit sphere in a five-step ramp off the body's
 * own colour, with a recipe of features painted onto it — bands, continents,
 * craters, ice caps, city lights on the night side, a storm. Generated rather
 * than drawn because sixteen hand-placed spheres would drift apart in their
 * lighting and their palettes, and because a recipe is four lines a designer
 * can read and change. The randomness is seeded from the body's own id, so
 * Bramble's hedgerows are in the same places today as yesterday.
 *
 * **Shapes** are hand-drawn grids, one character per pixel, for the things
 * that are not spheres: the Arc's broken ring, Claw Rock, the comet, the
 * Lantern, and the ship. A silhouette is the whole character of those, and a
 * silhouette is exactly what a generator is worst at.
 *
 * Nothing here touches the DOM until the first sprite is asked for, so the
 * module is safe to import anywhere.
 */

export const SIZE = 16;

/* ------------------------------------------------------------- colour */

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
const BLACK = [8, 8, 12], WHITE = [255, 252, 244];

/* Five steps from deep shadow to lit, off one colour. Shadow goes to a near
   black with a little of the body's own hue left in it, so a planet in
   eclipse still reads as that planet rather than as a hole. */
function ramp(base){
  const c = hex(base);
  return [
    mix(BLACK, c, 0.22),
    mix(BLACK, c, 0.5),
    c,
    mix(c, WHITE, 0.22),
    mix(c, WHITE, 0.48),
  ];
}

/* ---------------------------------------------------------------- rng */

function rng(seed){
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const hashId = id => { let h = 2166136261; for(const ch of id){ h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/* Value noise on a small lattice, smoothed. Enough for continents and moss at
   this size, and it costs nothing to build sixteen of them once. */
function noiseField(rand, n = 5){
  const g = [];
  for(let i = 0; i < n * n; i++) g.push(rand());
  const smooth = t => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = u * (n - 1), y = v * (n - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const a = g[y0 * n + x0], b = g[y0 * n + x1], c = g[y1 * n + x0], d = g[y1 * n + x1];
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  };
}

/* --------------------------------------------------------- the worlds */

/* Each recipe is: the colour it is, and what is written on it. `features` are
 * applied in order onto the material colour, before the light is. */
export const WORLDS = {
  lamp: { base: '#ffd23f', star: true },

  cinder: { base: '#e8683c', features: [
    /* Tidally locked: one face molten, one frozen, and the cities in the strip
       between them where a salamander can stand up. */
    { t: 'terminator', hot: '#ff8c42', cold: '#2a2a3a', band: '#ffd23f', at: 0.18 },
    { t: 'lights', colour: '#ffe9a8', amount: 0.5 },
  ]},

  wanderwell: { base: '#f2a65a', features: [
    { t: 'bands', colour: '#c8611a', n: 4, strength: 0.5 },
    { t: 'cap', colour: '#e6eef7', size: 0.26, top: true },   // winter, coming or going
    { t: 'patches', colour: '#b8722c', amount: 0.4, scale: 3 },
  ]},

  tagalong: { base: '#cbb8a0', features: [
    { t: 'craters', n: 5 },
  ]},

  tessel: { base: '#3fa9dd', features: [
    { t: 'patches', colour: '#2b7530', amount: 0.46, scale: 3 },
    { t: 'patches', colour: '#6cc24a', amount: 0.2, scale: 4 },
    { t: 'cap', colour: '#eaf6ff', size: 0.16, top: true },
    { t: 'cap', colour: '#eaf6ff', size: 0.14, top: false },
    { t: 'clouds', colour: '#f4fbff', amount: 0.2 },
  ]},

  pip: { base: '#cfc2a8', features: [
    { t: 'craters', n: 3 },
    /* Dry docks and cranes: the lamps are on all night, every night. */
    { t: 'lights', colour: '#ffb26b', amount: 0.55 },
    { t: 'pixels', colour: '#f59a2e', at: [[10, 4], [11, 4], [11, 5], [4, 10], [5, 11]] },
  ]},

  bramble: { base: '#6cc24a', features: [
    { t: 'patches', colour: '#2b7530', amount: 0.55, scale: 2.4 },   // hedgerows
    { t: 'patches', colour: '#9ad86a', amount: 0.22, scale: 4 },
    { t: 'clouds', colour: '#eafbe0', amount: 0.1 },
  ]},

  ledger: { base: '#d8b45a', features: [
    { t: 'patches', colour: '#a8842e', amount: 0.35, scale: 3 },
    /* A vault door, which is the only architecture the bankers care about:
       two rings, four spokes and a handle in the middle. */
    { t: 'ring', colour: '#6b4f16', r: 0.66 },
    { t: 'ring', colour: '#f3dc9a', r: 0.4 },
    { t: 'pixels', colour: '#6b4f16', at: [[8, 5], [8, 10], [5, 8], [10, 8]] },
    { t: 'pixels', colour: '#fff3c4', at: [[7, 7], [8, 7], [7, 8], [8, 8]] },
  ]},

  grumm: { base: '#8b6bd6', features: [
    { t: 'bands', colour: '#6f4fbb', n: 7, strength: 0.7 },
    { t: 'bands', colour: '#a88ce8', n: 11, strength: 0.3 },
    { t: 'storm', colour: '#f2a65a', x: 0.34, y: 0.58, r: 0.2 },
  ]},

  mossback: { base: '#5e8f4a', features: [
    { t: 'patches', colour: '#3c6b33', amount: 0.5, scale: 2.6 },
    { t: 'patches', colour: '#86b463', amount: 0.22, scale: 4 },
    /* It is asleep, not dead. One shut eye, and the ridges of a shell. */
    { t: 'pixels', colour: '#c8d8a0', at: [[5, 6], [6, 5], [7, 5], [8, 5], [9, 6]] },
    { t: 'pixels', colour: '#20301a', at: [[5, 7], [6, 7], [7, 7], [8, 7], [9, 7]] },
  ]},

  lillimoor: { base: '#7fd0c8', features: [
    { t: 'patches', colour: '#3f9a95', amount: 0.42, scale: 3 },
    /* Lily pads, which are villages. */
    { t: 'pixels', colour: '#b8f0d8', at: [[5, 6], [9, 5], [7, 10], [11, 9], [4, 9]] },
    { t: 'clouds', colour: '#dffaf6', amount: 0.14 },
  ]},

  widdershins: { base: '#9a8fa6', features: [
    { t: 'craters', n: 4 },
    /* Captured, and going the wrong way round. The rim light is on the side
       the light is not, which is the only way a still picture can say so. */
    { t: 'rim', colour: '#cfc2e8', side: -1 },
  ]},

  chime: { base: '#cfe8ff', features: [
    { t: 'patches', colour: '#9ec6ea', amount: 0.35, scale: 3.4 },
    { t: 'cap', colour: '#ffffff', size: 0.22, top: true },
    { t: 'cap', colour: '#ffffff', size: 0.2, top: false },
    { t: 'sparkle', colour: '#ffffff', n: 6 },     // glass, falling
  ]},

  hush: { base: '#6b6b7e', features: [
    { t: 'patches', colour: '#3a3a4a', amount: 0.6, scale: 3 },
    { t: 'craters', n: 2 },
    { t: 'pixels', colour: '#b48cff', at: [[9, 6]] },   // the observatory, still pointed
  ]},
};

/* ------------------------------------------------- the drawn silhouettes */

/* One character per pixel. A space is nothing. The legend is per sprite so
 * each one can use single letters for whatever it needs. */
export const SHAPES = {
  /* The last intact segment of a Chorus ring, seen edge on: a curved bar of
     worked metal with the break showing at both ends. */
  arc: { legend: { '.': null, o: '#d9c9a3', O: '#f2e7c8', s: '#8a7a58', d: '#6b5f4f' },
    rows: [
      '................',
      '................',
      '.....sOOOOs.....',
      '...sOOooooOOs...',
      '..sOoo....ooOs..',
      '..Oo........oO..',
      '.sO..........Os.',
      '.Oo..........oO.',
      '.Oo..........oO.',
      '.sO..........Os.',
      '..Oo........oO..',
      '..dOo......ood..',
      '...d.s....s.d...',
      '.....d....d.....',
      '................',
      '................',
    ]},

  /* Claw Rock: a jagged haven with a tavern light in it, and two points at
     the top that the cats insist are a coincidence. */
  clawrock: { legend: { '.': null, r: '#b58a5a', R: '#d8ae7c', d: '#6f5133', l: '#ffd23f' },
    rows: [
      '................',
      '...R........R...',
      '...Rd......dR...',
      '..dRRd....dRR...',
      '..dRRRd..dRRRd..',
      '.dRRRRRddRRRRRd.',
      '.dRRRRRRRRRRRRd.',
      'dRRRRRlRRRRRRRRd',
      'dRRRRRRRRRRRRRRd',
      '.dRRRRRRRRRRRRd.',
      '.ddRRRRRRRRRRdd.',
      '..dddRRRRRRddd..',
      '....dddRRddd....',
      '......dddd......',
      '................',
      '................',
    ]},

  /* Merrow's Comet: a dirty snowball with a bazaar bolted to it. The tail is
     drawn by the chart, not here. */
  merrow: { legend: { '.': null, i: '#bfe9ff', I: '#ffffff', d: '#7a9fb5', g: '#ffd23f' },
    rows: [
      '................',
      '................',
      '......dii.......',
      '....diIIIid.....',
      '...dIIIiIIid....',
      '...iIIgIIIIi....',
      '..diIIIIIIiid...',
      '..iIIIIIgIIii...',
      '..iIIgIIIIIid...',
      '...iIIIIIIid....',
      '...diIIIIid.....',
      '....ddiiid......',
      '......dd........',
      '................',
      '................',
      '................',
    ]},

  /* The Far Lantern. Nobody knows what it is; it is drawn as what it does. */
  lantern: { legend: { '.': null, w: '#ffffff', y: '#ffd23f', f: 'rgba(255,210,63,0.45)' },
    rows: [
      '................',
      '.......f........',
      '.......w........',
      '.....f.w.f......',
      '......yyy.......',
      '.....ywwwy......',
      '..fw.ywwwy.wf...',
      '.....ywwwy......',
      '......yyy.......',
      '.....f.w.f......',
      '.......w........',
      '.......f........',
      '................',
      '................',
      '................',
      '................',
    ]},

  /* The ship, nose to the right, because that is the way `drawShip` rotates
     it. Small enough to be a dot at chart zoom and a ship when you look. */
  ship: { legend: { '.': null, h: '#f5ead6', H: '#ffffff', d: '#8a8478', w: '#5aa6e8', f: '#f59a2e', F: '#ffd23f' },
    rows: [
      '................',
      '................',
      '.....dd.........',
      '.....dhd........',
      '....ddhhdd......',
      '..ffdhhhhhdd....',
      '.fFfdhhHwHhhdd..',
      'fFFfdhhHwHhhhhhd',
      'fFFfdhhHwHhhhhhd',
      '.fFfdhhHwHhhdd..',
      '..ffdhhhhhdd....',
      '....ddhhdd......',
      '.....dhd........',
      '.....dd.........',
      '................',
      '................',
    ]},
};

/* ------------------------------------------------------------ painting */

/* The light: over the shoulder, from the upper left, which is the convention
 * every reader of a picture already knows. */
const LX = -0.5, LY = 0.62, LZ = 0.6;
const LN = Math.hypot(LX, LY, LZ);

function paintWorld(id, spec){
  const n = SIZE, c = document.createElement('canvas');
  c.width = n; c.height = n;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(n, n);
  const rand = rng(hashId(id));
  const shades = ramp(spec.base);
  const fields = spec.features?.map(f => (f.t === 'patches' || f.t === 'clouds')
    ? noiseField(rand, Math.max(3, Math.round(f.scale ?? 3))) : null) ?? [];
  const craters = [];
  for(const f of spec.features ?? []){
    if(f.t !== 'craters') continue;
    for(let i = 0; i < (f.n ?? 3); i++){
      craters.push({ x: (rand() * 1.5 - 0.75), y: (rand() * 1.5 - 0.75), r: 0.12 + rand() * 0.16 });
    }
  }
  const sparks = [];
  for(const f of spec.features ?? []){
    if(f.t !== 'sparkle') continue;
    for(let i = 0; i < (f.n ?? 4); i++) sparks.push([Math.floor(rand() * n), Math.floor(rand() * n), f.colour]);
  }
  const pixelMarks = new Map();
  for(const f of spec.features ?? []){
    if(f.t !== 'pixels') continue;
    for(const [x, y] of f.at) pixelMarks.set(x + ',' + y, f.colour);
  }

  const put = (x, y, rgb, a = 255) => {
    const i = (y * n + x) * 4;
    img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = a;
  };

  for(let py = 0; py < n; py++){
    for(let px = 0; px < n; px++){
      const x = (px + 0.5) / n * 2 - 1;
      const y = 1 - (py + 0.5) / n * 2;
      const r2 = x * x + y * y;
      if(r2 > 1) continue;
      const z = Math.sqrt(Math.max(0, 1 - r2));
      let lam = (x * LX + y * LY + z * LZ) / LN;

      /* A star is its own light: bright in the middle, hot at the edge. */
      if(spec.star){
        const t = 1 - Math.sqrt(r2);
        const col = mix(hex(spec.base), WHITE, Math.min(1, t * 1.5));
        put(px, py, col, 255);
        continue;
      }

      let mat = spec.base;
      let night = lam <= 0.04;

      for(let fi = 0; fi < (spec.features?.length ?? 0); fi++){
        const f = spec.features[fi];
        if(f.t === 'patches' || f.t === 'clouds'){
          const v = fields[fi]((x + 1) / 2, (1 - y) / 2);
          if(v > 1 - (f.amount ?? 0.4)) mat = f.colour;
        }else if(f.t === 'bands'){
          const v = Math.sin((y + 1) * Math.PI * (f.n ?? 5) * 0.5 + hashId(id) % 7);
          if(v > 1 - 2 * (f.strength ?? 0.5)) mat = f.colour;
        }else if(f.t === 'cap'){
          const edge = 1 - (f.size ?? 0.2) * 2;
          if(f.top ? y > edge : y < -edge) mat = f.colour;
        }else if(f.t === 'storm'){
          const dx = (x - (f.x * 2 - 1)) / (f.r ?? 0.2);
          const dy = (y - (f.y * 2 - 1)) / ((f.r ?? 0.2) * 0.7);
          if(dx * dx + dy * dy < 1) mat = f.colour;
        }else if(f.t === 'terminator'){
          /* A hard line rather than a gradient: the whole point of Cinder is
             that there are two worlds and a doorstep between them. */
          const s = x * 0.9 + y * 0.2;
          mat = s > (f.at ?? 0.2) + 0.14 ? f.hot : s < (f.at ?? 0.2) - 0.14 ? f.cold : f.band;
          night = s < (f.at ?? 0.2) - 0.14;
          lam = Math.max(lam, 0.55);
        }else if(f.t === 'craters'){
          for(const cr of craters){
            const d = Math.hypot(x - cr.x, y - cr.y);
            /* A hole with a lip: the floor in shadow, the far rim catching
               the light. Gently was not enough — five steps of shading swallow
               anything under about a third. */
            if(d < cr.r) lam *= d > cr.r * 0.7 ? 1.55 : 0.48;
          }
        }
      }

      const key = px + ',' + py;
      if(pixelMarks.has(key)){ put(px, py, hex(pixelMarks.get(key)), 255); continue; }

      const cols = mat === spec.base ? shades : ramp(mat);
      let step = lam <= 0 ? 0 : lam < 0.22 ? 1 : lam < 0.55 ? 2 : lam < 0.85 ? 3 : 4;

      /* A thin bright edge where the sphere turns away — without it a dark
         planet on a black sky has no outline at all. Thin is the whole trick:
         at a quarter of the disc it stopped being an edge and turned every
         world into a bead with a highlight ring round it. */
      const rim = spec.features?.find(f => f.t === 'rim');
      const rimSide = rim ? rim.side : 1;
      if(r2 > 0.9 && (x * LX + y * LY) * rimSide > -0.1) step = Math.min(4, step + 1);

      put(px, py, cols[step], 255);

      /* City lights only where the sun is not. */
      for(const f of spec.features ?? []){
        if(f.t !== 'lights' || !night) continue;
        if(rand() < (f.amount ?? 0.3) * 0.28) put(px, py, hex(f.colour), 255);
      }
    }
  }

  /* Rings and sparks sit on top of the sphere, not under its shading. */
  ctx.putImageData(img, 0, 0);
  for(const f of spec.features ?? []){
    if(f.t !== 'ring') continue;
    ctx.strokeStyle = f.colour; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(n / 2, n / 2, (f.r ?? 0.5) * n / 2, 0, Math.PI * 2); ctx.stroke();
  }
  for(const [sx, sy, colour] of sparks){
    const x = (sx + 0.5) / n * 2 - 1, y = 1 - (sy + 0.5) / n * 2;
    if(x * x + y * y > 1) continue;
    ctx.fillStyle = colour; ctx.fillRect(sx, sy, 1, 1);
  }
  return c;
}

function paintShape(shape){
  const n = SIZE, c = document.createElement('canvas');
  c.width = n; c.height = n;
  const ctx = c.getContext('2d');
  shape.rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const colour = shape.legend[ch];
      if(!colour) return;
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, 1, 1);
    });
  });
  return c;
}

/* ------------------------------------------------------------- the API */

const cache = new Map();

/* The sprite for a body id, or null if it has none. Built on first use and
 * kept: sixteen little canvases, once, for the life of the page. */
export function sprite(id){
  if(cache.has(id)) return cache.get(id);
  if(typeof document === 'undefined'){ cache.set(id, null); return null; }
  let c = null;
  try{
    if(SHAPES[id]) c = paintShape(SHAPES[id]);
    else if(WORLDS[id]) c = paintWorld(id, WORLDS[id]);
  }catch(e){
    /* A sprite is decoration. If one cannot be built the chart falls back to
       the dot it always drew, and the game goes on. */
    console.warn('sprite failed for', id, e);
    c = null;
  }
  cache.set(id, c);
  return c;
}

/* Blit one, centred, `d` pixels across. Smoothing off, because the whole
 * point is that the pixels are the picture. */
export function drawSprite(ctx, id, cx, cy, d, alpha = 1){
  const s = sprite(id);
  if(!s) return false;
  const was = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  if(alpha !== 1){ ctx.save(); ctx.globalAlpha = alpha; }
  /* Snapped to whole pixels: a sprite drawn on a half pixel is a sprite with
     a soft edge, which is the one thing pixel art must never have. */
  const n = Math.max(2, Math.round(d));
  ctx.drawImage(s, Math.round(cx - n / 2), Math.round(cy - n / 2), n, n);
  if(alpha !== 1) ctx.restore();
  ctx.imageSmoothingEnabled = was;
  return true;
}
