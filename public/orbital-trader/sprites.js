/* Orbital Trader: the worlds, as pixels.
 *
 * Every body on the chart used to be a coloured dot, which is honest and
 * completely forgettable: Moss and Slate are a green circle and a grey
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
 * Moss's hedgerows are in the same places today as yesterday.
 *
 * **Shapes** are hand-drawn grids, one character per pixel, for the things
 * that are not spheres: the Arc's broken ring, the two belt havens, the
 * Maw, and the ship. A silhouette is the whole character of those, and a
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

  /* Cinder's mining moon: bare rock, and the head of every shaft lit. */
  scorch: { base: '#b58a5a', features: [
    { t: 'craters', n: 4 },
    { t: 'patches', colour: '#8a6338', amount: 0.3, scale: 3 },
    { t: 'lights', colour: '#ffb26b', amount: 0.35 },
  ]},

  /* Veyra: banded, bright, and lit all the way round, because somebody is
     always awake and spending. */
  veyra: { base: '#f2a65a', features: [
    { t: 'bands', colour: '#c8611a', n: 4, strength: 0.45 },
    { t: 'patches', colour: '#b8722c', amount: 0.35, scale: 3 },
    { t: 'lights', colour: '#fff0c0', amount: 0.6 },
  ]},

  tassel: { base: '#3fa9dd', features: [
    { t: 'patches', colour: '#2b7530', amount: 0.46, scale: 3 },
    { t: 'patches', colour: '#6cc24a', amount: 0.2, scale: 4 },
    { t: 'cap', colour: '#eaf6ff', size: 0.16, top: true },
    { t: 'cap', colour: '#eaf6ff', size: 0.14, top: false },
    { t: 'clouds', colour: '#f4fbff', amount: 0.2 },
  ]},

  slate: { base: '#cfc2a8', features: [
    { t: 'craters', n: 3 },
    /* Dry docks and cranes: the lamps are on all night, every night. */
    { t: 'lights', colour: '#ffb26b', amount: 0.55 },
    { t: 'pixels', colour: '#f59a2e', at: [[10, 4], [11, 4], [11, 5], [4, 10], [5, 11]] },
  ]},

  moss: { base: '#6cc24a', features: [
    { t: 'patches', colour: '#2b7530', amount: 0.55, scale: 2.4 },   // hedgerows
    { t: 'patches', colour: '#9ad86a', amount: 0.22, scale: 4 },
    { t: 'clouds', colour: '#eafbe0', amount: 0.1 },
  ]},

  grumm: { base: '#8b6bd6', features: [
    { t: 'bands', colour: '#6f4fbb', n: 7, strength: 0.7 },
    { t: 'bands', colour: '#a88ce8', n: 11, strength: 0.3 },
    { t: 'storm', colour: '#f2a65a', x: 0.34, y: 0.58, r: 0.2 },
  ]},

  /* An ammonia sea the colour of weak tea, with apothecary rafts on it. */
  brine: { base: '#a8c48c', features: [
    { t: 'patches', colour: '#6f8f5a', amount: 0.5, scale: 2.8 },
    { t: 'pixels', colour: '#e6f3c8', at: [[6, 5], [10, 6], [5, 10], [9, 11]] },
    { t: 'clouds', colour: '#eef7dd', amount: 0.16 },
  ]},

  /* Ice over an ocean, lit from underneath where the station has cut in. */
  glass: { base: '#cfe8ff', features: [
    { t: 'patches', colour: '#9ec6ea', amount: 0.35, scale: 3.4 },
    { t: 'cap', colour: '#ffffff', size: 0.22, top: true },
    { t: 'cap', colour: '#ffffff', size: 0.2, top: false },
    { t: 'sparkle', colour: '#ffffff', n: 6 },
  ]},

  croak: { base: '#9a8fa6', features: [
    { t: 'craters', n: 4 },
    /* Going the wrong way round. The rim light is on the side the light is
       not, which is the only way a still picture can say so. */
    { t: 'rim', colour: '#cfc2e8', side: -1 },
  ]},

  /* The frog capital: lily terraces all the way up, and every one of them lit. */
  haven: { base: '#7fd0c8', features: [
    { t: 'patches', colour: '#3f9a95', amount: 0.42, scale: 3 },
    { t: 'pixels', colour: '#b8f0d8', at: [[5, 6], [9, 5], [7, 10], [11, 9], [4, 9]] },
    { t: 'lights', colour: '#ffe9a8', amount: 0.4 },
    { t: 'clouds', colour: '#dffaf6', amount: 0.14 },
  ]},
};

/* ------------------------------------------------- the drawn silhouettes */

/* One character per pixel. A space is nothing. The legend is per sprite so
 * each one can use single letters for whatever it needs. */
export const SHAPES = {
  /* The last intact segment of a Builder ring, seen edge on: a curved bar of
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

  /* Nail: a jagged belt haven with a tavern light in it, and two points at
     the top that the cats insist are a coincidence. */
  nail: { legend: { '.': null, r: '#b58a5a', R: '#d8ae7c', d: '#6f5133', l: '#ffd23f' },
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

  /* Whisker: a rounder, darker rock at the thin end of the Belt, with one
     light showing and no name painted anywhere on it. */
  whisker: { legend: { '.': null, R: '#6b6478', d: '#2a2632', l: '#b48cff' },
    rows: [
      '................',
      '................',
      '.....ddRRdd.....',
      '...ddRRRRRRdd...',
      '..dRRRRRRRRRRd..',
      '.dRRRRRRRRRRRRd.',
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

  /* The Maw. A hole with a ring of light falling into it; the Builder station
     that watches it is too small to draw at this size. */
  maw: { legend: { '.': null, k: '#0b0b12', w: '#ffffff', y: '#ffd23f', f: 'rgba(255,210,63,0.45)' },
    rows: [
      '................',
      '................',
      '.....ffffff.....',
      '...ffywwwwyff...',
      '..fywwkkkkwwyf..',
      '..ywkkkkkkkkwy..',
      '.fwkkkkkkkkkkwf.',
      '.ywkkkkkkkkkkwy.',
      '.ywkkkkkkkkkkwy.',
      '.fwkkkkkkkkkkwf.',
      '..ywkkkkkkkkwy..',
      '..fywwkkkkwwyf..',
      '...ffywwwwyff...',
      '.....ffffff.....',
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
  const n = shape.rows.length, c = document.createElement('canvas');
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


/* ---------------------------------------------------------- portraits */

/* People, at twenty-four pixels instead of sixteen. A world can be a dot and
 * still be a world; a face cannot. These are drawn on a grid the same way the
 * Arc and the Maw are, and they share one legend because five portraits with
 * five palettes would drift apart the first time any of them was touched.
 *
 * They also share a build: every head is an ellipse with the light coming
 * from the upper left, and every one of them is wearing the same blue jacket,
 * so four species read as one crew. */
export const PORTRAIT_SIZE = 24;
const PORTRAIT_INK = {
  '.': null,
  // Otter
  d: '#4a3524', f: '#7d5c3c', F: '#a07a50', m: '#e2cdaa',
  // Emberkin
  r: '#7a2c14', E: '#c8502a', R: '#e8703c', C: '#ffb347', L: '#6fd0e8',
  // Cat
  t: '#8a7c62', T: '#d8cbb0', U: '#f2e8d0',
  // Frog
  h: '#2f5c2a', G: '#5fa84e', H: '#86c96f',
  // Shared: features, the jacket they all wear, and an empty berth
  n: '#2a1c12', e: '#15100c', O: '#ffd23f', W: '#c9b9a2',
  k: '#12314a', j: '#245f86', J: '#3fa9dd', g: '#ffd23f',
  s: '#414150',
};

export const PORTRAITS = {
  /* You. An otter who left their raft — which the design document still has
     down as a proposal (7.1), so this is the one sprite in the game written to
     be replaced. */
  captain: { legend: PORTRAIT_INK,
    rows: [
      '........................',
      '........................',
      '...........dd...........',
      '.........ddFfdd.........',
      '........dFFFFffd........',
      '....ddddFFFFFFffdddd....',
      '...ddFdFFFFFFFfffdFdd...',
      '...dFFdFFFFFFFfffdFFd...',
      '...ddFdFddFFFFddfdFdd...',
      '....dddFeeFFFfeefddd....',
      '......dFeeFmmfeefd......',
      '......dffmmnnmmffd......',
      '......dffmmnnmmffd......',
      '......WWfmnmmnmfWW......',
      '........dmmnnmmd........',
      '.........dfmmfd.........',
      '..........dddd..........',
      '.......kgkddddkgk.......',
      '.....kkjjgJJJJgjjkk.....',
      '...kkjjjjjJJJJjjjjjkk...',
      '..kjjjjjjjJJJJjjjjjjjk..',
      '.kjjjjjjjjJJJJjjjjjjjjk.',
      '.kjjjjjjjjJJJJjjjjjjjjk.',
      'kkkkkkkkkkkkkkkkkkkkkkkk',
    ]},
  /* Kiran, Emberkin, off the Ninth Forge: a crest, and the goggles pushed up
     on it because he has just stopped doing something. */
  engineer: { legend: PORTRAIT_INK,
    rows: [
      '........................',
      '........................',
      '...........C...C........',
      '.........CrCrC.C........',
      '.......WLLRRRCWLL.......',
      '.......LLLRRRRLLL.......',
      '......rrrrrrrrrrrr......',
      '.......rRRRRRREEr.......',
      '.......rRRRRRREEr.......',
      '......rRRRRRREEEEr......',
      '......rRRCeRECeEEr......',
      '.......rECeEECeEr.......',
      '.......rEERRRREEr.......',
      '.......rERRnnRREr.......',
      '........rRRRRRRr........',
      '.........rRRRRr.........',
      '..........rrrr..........',
      '.......kgkrrrrkgk.......',
      '.....kkjjgJJJJgjjkk.....',
      '...kkjjjjjJJJJjjjjjkk...',
      '..kjjjjjjjJJJJjjjjjjjk..',
      '.kjjjjjjjjJJJJjjjjjjjjk.',
      '.kjjjjjjjjJJJJjjjjjjjjk.',
      'kkkkkkkkkkkkkkkkkkkkkkkk',
    ]},
  /* Tsuki, cat, who can read a rock an au off. Ears tall and narrow — a wide
     one is a dog at this size. */
  navigator: { legend: PORTRAIT_INK,
    rows: [
      '........................',
      '......ttt......ttt......',
      '......ttt......ttt......',
      '......UUU......UUU......',
      '......UUU.tttt.UUU......',
      '......UUttUUUTttUU......',
      '.....tUtUUUUUUTTtUt.....',
      '.....tUtUUUUUUTTtUt.....',
      '......tUUUUUUUTTTt......',
      '......tUeOUUUUeOTt......',
      '......tUOeUUUTOeTt......',
      '......tUUUUUTTTTTt......',
      '......tTTUUUUUTTTt......',
      '.......tTUUnnUUTt.......',
      '.....WWtTUUnnUUTtWW.....',
      '........ttUUUUtt........',
      '..........tttt..........',
      '.......ktkttttktk.......',
      '.....kkkktjjjjtkkkk.....',
      '...kkkkkkkjjjjkkkkkkk...',
      '..kkkkkkkkjjjjkkkkkkkk..',
      '.kkkkkkkkkjjjjkkkkkkkkk.',
      '.kkkkkkkkkjjjjkkkkkkkkk.',
      'kkkkkkkkkkjjjjkkkkkkkkkk',
    ]},
  /* Wicket, frog, with the eyes riding on top of the skull where a frog's are
     and a loupe swung out of the way. */
  appraiser: { legend: PORTRAIT_INK,
    rows: [
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '....g.hhh......hhh......',
      '..gg.hOWOh....hOWOh.....',
      '...g.hOeehhhhhhOeeh.....',
      '..gg.hOeehHHHhhOeeh.....',
      '....g.hhhHHHHHhhhh......',
      '......hHHHHHHHhhhh......',
      '.....hHHHHHHHhhGhhh.....',
      '.....hHHHHHHHhhGhhh.....',
      '.....hhHHHHHhhGGhhh.....',
      '......hhhhhhhGGhhh......',
      '......HHHHHHHhhhhh......',
      '.......hhhhhhhhhh.......',
      '.......kghhhhhhgk.......',
      '.....kkkkgjjjjgkkkk.....',
      '...kkkkkkkjjjjkkkkkkk...',
      '..kkkkkkkkjjjjkkkkkkkk..',
      '.kkkkkkkkkjjjjkkkkkkkkk.',
      '.kkkkkkkkkjjjjkkkkkkkkk.',
      'kkkkkkkkkkjjjjkkkkkkkkkk',
    ]},
  /* Nobody, yet. */
  berth: { legend: PORTRAIT_INK,
    rows: [
      '........................',
      '........................',
      '...........ss...........',
      '.........ssssss.........',
      '........ssssssss........',
      '.......ssssssssss.......',
      '......ssssssssssss......',
      '......ssssssssssss......',
      '......ssssssssssss......',
      '......ssssssssssss......',
      '......ssssssssssss......',
      '......ssssssssssss......',
      '......ssssssssssss......',
      '.......ssssssssss.......',
      '........ssssssss........',
      '.........ssssss.........',
      '..........ssss..........',
      '.......ssssssssss.......',
      '.....ssssssssssssss.....',
      '...ssssssssssssssssss...',
      '..ssssssssssssssssssss..',
      '.ssssssssssssssssssssss.',
      '.ssssssssssssssssssssss.',
      'ssssssssssssssssssssssss',
    ]},
};

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

/* A portrait as something an <img> can take. The panel is HTML, not canvas,
 * so the one thing it needs is a data URL — built once and kept, because a
 * tab that re-renders on every frame must not re-encode a PNG on every
 * frame. Null under Node, where there is no canvas and no need for one. */
const portraitCache = new Map();
export function portraitURL(id){
  if(portraitCache.has(id)) return portraitCache.get(id);
  let url = null;
  try{
    if(PORTRAITS[id] && typeof document !== 'undefined') url = paintShape(PORTRAITS[id]).toDataURL('image/png');
  }catch(e){
    console.warn('portrait failed for', id, e);
  }
  portraitCache.set(id, url);
  return url;
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
