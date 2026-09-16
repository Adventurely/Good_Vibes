/* Orbital Trader: the opening film.
 *
 * Six and a half seconds of pixels, once, when a new ship starts: a lighter
 * comes up out of Tassel's ocean at dawn, climbs through the weather, and
 * leaves the top of the sky — which is exactly where the game begins, with a
 * ship already in orbit and a crate in the hold. Nothing lands in this game,
 * and nothing here does either: the lighter is the boat that meets ships, and
 * this is the one ride of it you ever see.
 *
 * How it is drawn. Everything goes into one small offscreen buffer — about
 * two hundred pixels tall, whatever the monitor is — and that buffer is
 * blitted up whole with smoothing off. So a pixel stays a pixel, the
 * silhouettes stay crunchy, and a frame costs the same on a phone as on a
 * wall. It is the same bargain sprites.js makes, with its own palette,
 * because this art is a sky and a sea rather than sixteen little worlds.
 *
 * One number drives the whole film: `ascent(t)`, the climb from nought to
 * one. The sky's colours, how far the water has fallen away, how hard the
 * horizon bends, the stars coming out, the plume going from a fat orange cone
 * to a thin white needle — every one of them reads that. Re-cutting the film
 * is therefore moving times in BEATS and colours in SKY; nothing has to be
 * kept in agreement by hand.
 *
 * And `draw(t)` is a function of t and nothing else. Even the flicker is a
 * hash of the frame number rather than a running random, so a dropped frame
 * costs a frame and never knocks the film out of step with itself — which is
 * the failure a launch animation made of counters always has on the one
 * machine that stutters.
 *
 * Nothing here touches the DOM until playIntro is called, so the module is
 * safe to import anywhere; the tests read its timeline under Node.
 */

/* ------------------------------------------------------------- the cut */

export const DURATION = 6.4;    // the film itself
export const BREACH = 0.78;     // the moment the water breaks

/* When the page's caption comes up over the film. It is not a beat: nothing
 * happens in the picture at 3.55s, the ship is simply most of the way up
 * through the cloud deck, and overloading a beat with it would have `beatAt`
 * answer "caption" when asked what is playing. It lives here rather than in
 * the page because it is a time in this film, and re-cutting the film should
 * find every one of those in the same place. */
export const CAPTION_AT = 3.55;

/* What is happening, and when. */
export const BEATS = [
  { at: 0.00,   name: 'sea' },       // a dark ocean at dawn, and a light under it
  { at: BREACH, name: 'breach' },    // out of the water
  { at: 1.20,   name: 'climb' },     // the sea drops away
  { at: 2.40,   name: 'clouds' },    // the deck
  { at: 3.70,   name: 'thinning' },  // the blue goes out of the sky
  { at: 5.05,   name: 'space' },     // black, stars, and a world that curves
];

export function beatAt(t){
  let name = BEATS[0].name;
  for(const b of BEATS) if(t >= b.at) name = b.name;
  return name;
}

/* The climb, nought to one, over the whole film. A hard shove in the first
   tenth — that is the cork coming out of the water — and a straight line
   after it. Straight is right even though a rocket accelerates: the camera
   pulls back as it goes, so a constant climb already reads as speeding up,
   and a curve on top of it read as a ship running out of puff. */
export function ascent(t){
  if(t <= BREACH) return 0;
  const u = clamp((t - BREACH) / (DURATION - BREACH), 0, 1);
  return clamp(0.13 * step(0, 0.11, u) + 0.87 * u, 0, 1);
}

/* ---------------------------------------------------------- little maths */

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
/* Smooth between two marks, flat outside them. */
function step(a, b, x){
  const t = clamp((x - a) / ((b - a) || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
}

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const css = c => `rgb(${c[0]},${c[1]},${c[2]})`;

function rng(seed){
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
/* Noise that depends on the frame number rather than on how many frames have
   gone by: see the note at the top about dropped frames. */
function hash(a, b){
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x165667b1, 0xc2b2ae35);
  h ^= h >>> 15;
  return ((h >>> 0) % 100000) / 100000;
}

/* ------------------------------------------------------------- the sky */

/* Seven skies, from the one the water is under to the one there is no air in.
 * `top` is the zenith, `low` the band along the horizon, `sea` the water, and
 * `glow` what the Lamp paints on whatever is left to scatter it. The water
 * brightens as you climb because an ocean seen from orbit does. */
const SKY = [
  { h: 0.00, top: '#16244c', low: '#f0a155', sea: '#0e3558', glow: '#ffca4a' },
  { h: 0.14, top: '#1f528f', low: '#f6cd96', sea: '#11507e', glow: '#ffd98a' },
  { h: 0.33, top: '#1d4f94', low: '#a6d4f0', sea: '#1769a4', glow: '#fff0bc' },
  { h: 0.54, top: '#123a80', low: '#74b6e8', sea: '#1b76b0', glow: '#fff6d8' },
  { h: 0.72, top: '#0a1f4e', low: '#3f88ca', sea: '#1d74ad', glow: '#fff8e4' },
  { h: 0.88, top: '#050b22', low: '#1a4480', sea: '#1c66a0', glow: '#fffbf0' },
  { h: 1.00, top: '#02030b', low: '#0a1f46', sea: '#1a6aa6', glow: '#fffdf6' },
];
const SKY_RGB = SKY.map(s => ({ h: s.h, top: hex(s.top), low: hex(s.low), sea: hex(s.sea), glow: hex(s.glow) }));

/* The sky at a given height, as four colours. */
export function skyAt(h){
  const x = clamp(h, 0, 1);
  let i = 0;
  while(i < SKY_RGB.length - 2 && x > SKY_RGB[i + 1].h) i++;
  const a = SKY_RGB[i], b = SKY_RGB[i + 1];
  const t = clamp((x - a.h) / ((b.h - a.h) || 1), 0, 1);
  return {
    top: mix(a.top, b.top, t),
    low: mix(a.low, b.low, t),
    sea: mix(a.sea, b.sea, t),
    glow: mix(a.glow, b.glow, t),
  };
}

/* ----------------------------------------------------------- the lighter */

/* Twelve across, twenty down, nose up, one character per pixel — the idiom
 * sprites.js uses for everything that is not a sphere, for the same reason:
 * a silhouette is the whole character of a rocket, and a generator is worst
 * at silhouettes. Otter green on the fins and the band, because the otters
 * own this harbour and paint everything they own. */
export const ROCKET = {
  w: 12, h: 20,
  legend: { '.': null, k: '#0b0d17', h: '#f5ead6', H: '#ffffff', d: '#8a8478', w: '#5aa6e8', g: '#6cc24a' },
  rows: [
    '.....kk.....',
    '....khhk....',
    '....khhk....',
    '...kHhhdk...',
    '...kHhhdk...',
    '..kHhhhhdk..',
    '..kHhwwhdk..',
    '..kHhwwhdk..',
    '..kHhhhhdk..',
    '..kHggggdk..',
    '..kHggggdk..',
    '..kHhhhhdk..',
    '..kHhhhhdk..',
    '..kHhhhhdk..',
    '.kkHhhhhdkk.',
    'kggHhhhhdggk',
    'kggHhhhhdggk',
    '.kkHhhhhdkk.',
    '..kddddddk..',
    '...kddddk...',
  ],
};

/* The plume, nozzle outwards: white at the throat, gold, orange, and smoke. */
const FLAME = ['#ffffff', '#fff0c0', '#ffd23f', '#f59a2e', '#e8683c', '#c8611a'].map(hex);
const FOAM = hex('#ffffff'), SPRAY = hex('#cfe6f7'), DEEP = hex('#061427');
const SMOKE = hex('#dfe7f0'), SMOKE_OLD = hex('#8a93a6');
const CLOUD_TOP = hex('#ffffff'), CLOUD_MID = hex('#dbe8f5'), CLOUD_LOW = hex('#a9c2dc');
const RAFT = hex('#0c1424'), LANTERN = hex('#ffd23f'), STARLIGHT = hex('#f5ead6');

/* -------------------------------------------------------- where things are */

/* The waterline, and then the limb: it falls fast while the first few
   kilometres are the whole world and then hardly at all, which is what
   leaving somewhere actually looks like. */
const seaY = (h, H) => H * (0.615 + 0.275 * Math.pow(h, 0.42));

/* The nose of the lighter. Under the water, rising, until the breach; after
   it, up to the line the camera holds it on for the rest of the film. */
function noseY(t, H){
  const h = ascent(t);
  const surface = seaY(0, H);
  if(h <= 0) return surface + (1 - step(BREACH - 0.46, BREACH, t)) * (ROCKET.h + 12);
  return lerp(surface, H * 0.40, step(0, 0.17, h));
}

/* ------------------------------------------------------------- the film */

function paintGrid(grid, tint){
  const c = document.createElement('canvas');
  c.width = grid.w; c.height = grid.h;
  const g = c.getContext('2d');
  grid.rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const colour = grid.legend[ch];
      if(!colour) return;
      const rgb = hex(colour);
      g.fillStyle = css(tint ? tint(rgb) : rgb);
      g.fillRect(x, y, 1, 1);
    });
  });
  return c;
}

/* Play it. Returns the promise the page waits on and the way out of it:
 *
 *   const film = playIntro(canvas, { onBeat });
 *   film.done.then(start);            // played out, or skipped
 *   film.skip();                      // a click, a key, a change of mind
 *
 * `onBeat` is called once per beat with its name, in order, and `onCaption`
 * once when the film reaches CAPTION_AT. Both run off the film's own clock,
 * so a dropped frame moves them together with the picture and neither can
 * fire after the film is over.
 */
export function playIntro(canvas, opts = {}){
  const onBeat = opts.onBeat ?? (() => {});
  const onCaption = opts.onCaption ?? (() => {});
  let said = false;
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, scale = 1, buf = null, b = null;
  let stars = [], clouds = [], dabs = [], rafts = [], spray = [], drops = [], puffs = [], bubbles = [];
  const ramps = {};
  const art = {};

  /* --------------------------------------------------------- the props */

  /* Seeded, so it is the same launch every time. A film that is different on
     every viewing is a film nobody can fix a complaint about. */
  function cast(){
    const r = rng(20260913);
    stars = [];
    for(let i = 0; i < 150; i++) stars.push({ x: r(), y: r() * 0.92, b: r(), tw: r() * 6.28 });

    clouds = [];
    /* A cloud is widest along its flat bottom and lumpy on top, which is the
       whole of what a cloud is at this size. Widths are fractions of the
       frame, so the deck is a deck on a phone as well. */
    const puff = (a, near, w, rows) => {
      const lumps = [];
      for(let i = 0; i < rows; i++){
        const up = i / (rows - 1);                       // 0 top, 1 bottom
        lumps.push(Math.max(0.12, Math.pow(up, 0.55) * (0.78 + r() * 0.3)));
      }
      return { a, near, w, x: r() * 1.6 - 0.3, rows, lumps };
    };
    /* The deck sits where the film wants it: high enough that the first
       second is clear water and sky, low enough to be through it by the time
       the blue starts going out of the sky. */
    for(let i = 0; i < 13; i++) clouds.push(puff(0.30 + r() * 0.24, r() < 0.32, 0.16 + r() * 0.14, 4 + Math.floor(r() * 3)));
    for(let i = 0; i < 10; i++) clouds.push(puff(0.28 + r() * 0.30, r() < 0.2, 0.07 + r() * 0.07, 3 + Math.floor(r() * 2)));
    for(let i = 0; i < 7; i++) clouds.push(puff(0.60 + r() * 0.14, false, 0.07 + r() * 0.07, 3));
    /* And three the lighter goes *through*: wide, tall, near enough to be
       drawn over the top of it, and spaced so that one is arriving, one is
       passing and one is already below for most of a second. Without these
       there is a cloud deck in the film and no going through it. */
    for(const a of [0.37, 0.45, 0.53]){
      const c = puff(a, true, 0.6 + r() * 0.5, 9 + Math.floor(r() * 4));
      c.x = 0.15 + r() * 0.55;
      clouds.push(c);
    }
    /* Far ones first, so a pass over the list draws back to front. */
    clouds.sort((p, q) => p.a - q.a);

    /* Weather on the water, for when the water is a world. */
    dabs = [];
    for(let i = 0; i < 90; i++) dabs.push({ x: r(), d: Math.pow(r(), 1.7), w: 2 + Math.floor(r() * 7) });

    /* The harbour: hulls lashed together, and somebody still awake on each. */
    rafts = [];
    for(let i = 0; i < 5; i++){
      const lights = [];
      for(let k = 0; k < 3; k++) lights.push({ dx: Math.floor(r() * 9) - 4, dy: -1 - Math.floor(r() * 4) });
      rafts.push({ x: 0.08 + i * 0.21 + r() * 0.05, w: 7 + Math.floor(r() * 12), mast: 3 + Math.floor(r() * 5), lights });
    }

    /* The breach: two waves of water thrown out of the way. */
    spray = [];
    for(let i = 0; i < 150; i++){
      const wave = i < 100 ? 0 : 0.09;
      const ang = (r() * 2 - 1) * 1.45;              // off vertical
      const sp = 34 + r() * 116;
      spray.push({
        t0: BREACH + wave, life: 0.45 + r() * 0.55,
        vx: Math.sin(ang) * sp, vy: Math.cos(ang) * sp * (0.85 + r() * 0.7),
        big: r() < 0.34,
      });
    }
    /* And the water that came up with it, running off the hull. */
    drops = [];
    for(let i = 0; i < 16; i++){
      drops.push({ t0: BREACH + r() * 0.3, life: 0.5 + r() * 0.4, dx: (r() * 2 - 1) * 6, vy: -8 - r() * 26 });
    }

    /* Smoke, while there is air to hold it. */
    puffs = [];
    for(let k = 0; k < 90; k++){
      const t0 = BREACH - 0.18 + k * 0.05;
      if(t0 > 4.0) break;
      puffs.push({ t0, a: ascent(t0), dx: (r() * 2 - 1) * 2.6, r0: 2 + r() * 2.4, life: 1.5 + r() * 1.3 });
    }

    /* Bubbles, before it. */
    bubbles = [];
    for(let k = 0; k < 26; k++) bubbles.push({ t0: BREACH - 0.7 + r() * 0.6, dx: (r() * 2 - 1) * 7, sp: 18 + r() * 34, life: 0.5 + r() * 0.4 });
  }

  function layout(){
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const cw = Math.max(160, Math.round((rect.width || globalThis.innerWidth || 800) * dpr));
    const ch = Math.max(160, Math.round((rect.height || globalThis.innerHeight || 600) * dpr));
    canvas.width = cw; canvas.height = ch;
    /* Chunky on purpose, and never so chunky that the harbour is four pixels
       wide. About a hundred and seventy art pixels tall — but a phone held
       upright is tall and narrow, and sizing off the height alone there left
       the frame eighty pixels across with a lighter the size of a bus in it,
       so the narrower of the two dimensions has a say. Then a cap, so an
       ultrawide does not ask for a buffer the size of the game. */
    scale = Math.max(2, Math.round(Math.min(ch / 170, cw / 150)));
    const fit = () => { W = Math.ceil(cw / scale); H = Math.ceil(ch / scale); };
    fit();
    while(W > 460){ scale++; fit(); }
    buf = document.createElement('canvas');
    buf.width = W; buf.height = H;
    b = buf.getContext('2d');
    ramps.sky = null; ramps.sea = null;
  }

  function build(){
    art.dry = paintGrid(ROCKET, null);
    /* Under the water, and wet the moment it is out. */
    art.wet = paintGrid(ROCKET, c => mix(mix(c, hex('#0a2742'), 0.78), DEEP, 0.22));
    art.lit = paintGrid(ROCKET, c => mix(c, [255, 255, 255], 0.55));
  }

  /* A vertical ramp as a two-pixel-wide repeating pattern: the cheapest
     honest way to get a banded, dithered sky. Two columns and an alternating
     threshold make a checkerboard between each pair of bands, which is how
     this was done when it had to be, and it still looks better than a smooth
     gradient next to pixel art. */
  function ramp(which, a, z, y0, y1, bands, gamma){
    let c = ramps[which];
    if(!c || c.height !== H){
      c = ramps[which] = document.createElement('canvas');
      c.width = 2; c.height = H;
    }
    const g = c.getContext('2d');
    const img = g.createImageData(2, H);
    const cols = [];
    for(let i = 0; i < bands; i++) cols.push(mix(a, z, i / (bands - 1)));
    for(let y = 0; y < H; y++){
      const v = Math.pow(clamp((y - y0) / ((y1 - y0) || 1), 0, 1), gamma) * (bands - 1);
      const i = Math.min(bands - 2, Math.max(0, Math.floor(v)));
      const frac = v - i;
      for(let x = 0; x < 2; x++){
        const col = frac > (((x + y) & 1) ? 0.3 : 0.7) ? cols[i + 1] : cols[i];
        const o = (y * 2 + x) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return b.createPattern(c, 'repeat');
  }

  /* A circle with no soft edge anywhere on it: one rectangle per row. Squash
     it and it is the same circle seen from above, which is what everything
     below you is. */
  function disc(cx, cy, r, colour, alpha, squash = 1){
    if(alpha <= 0.004 || r < 0.5) return;
    b.globalAlpha = Math.min(1, alpha);
    b.fillStyle = css(colour);
    const R = Math.round(r), RY = Math.max(0, Math.round(r * squash));
    for(let dy = -RY; dy <= RY; dy++){
      const u = RY ? dy / RY : 0;
      const w = Math.round(R * Math.sqrt(Math.max(0, 1 - u * u)));
      if(w <= 0) continue;
      b.fillRect(Math.round(cx) - w, Math.round(cy) + dy, w * 2 + 1, 1);
    }
    b.globalAlpha = 1;
  }

  /* ---------------------------------------------------------- one frame */

  function draw(t){
    const h = ascent(t);
    const sky = skyAt(h);
    const fr = Math.floor(t * 12);               // the film animates on twelves
    const seaLine = seaY(h, H);
    const nose = Math.round(noseY(t, H));
    const tail = nose + ROCKET.h;
    const cx = Math.round(W / 2 + Math.sin(t * 2.1) * 1.2);

    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalAlpha = 1;
    /* The shake of it leaving. Whole pixels, or it is a blur rather than a
       shake. */
    const shake = t >= BREACH - 0.1 ? 2.6 * (1 - step(BREACH, BREACH + 0.45, t)) : 0;
    if(shake > 0){
      b.setTransform(1, 0, 0, 1,
        Math.round((hash(fr, 11) * 2 - 1) * shake),
        Math.round((hash(fr, 29) * 2 - 1) * shake));
    }

    /* --- the sky, horizon upwards */
    /* The whole buffer, not just down to the horizon: the limb bends below
       the waterline at the edges of the frame, and a sky that stops at the
       waterline leaves two black corners under it. */
    b.fillStyle = ramp('sky', sky.top, sky.low, 0, Math.max(2, seaLine), 11, 1.3);
    b.fillRect(-4, -4, W + 8, H + 8);

    /* --- the stars, once there is nothing in the way of them */
    const starA = step(0.52, 0.95, h);
    if(starA > 0.01){
      const drift = h * W * 0.05;
      for(const s of stars){
        const x = Math.round(((s.x + drift / W) % 1) * W);
        const y = Math.round(s.y * seaLine);
        if(y < 0 || y > seaLine - 1) continue;
        const tw = 0.72 + 0.28 * Math.sin(t * 3.1 + s.tw);
        b.globalAlpha = Math.min(1, starA * (0.3 + 0.7 * s.b) * tw);
        b.fillStyle = css(s.b > 0.86 ? [255, 255, 255] : STARLIGHT);
        b.fillRect(x, y, 1, 1);
        if(s.b > 0.94){
          b.globalAlpha *= 0.6;
          b.fillRect(x - 1, y, 1, 1); b.fillRect(x + 1, y, 1, 1);
          b.fillRect(x, y - 1, 1, 1); b.fillRect(x, y + 1, 1, 1);
        }
      }
      b.globalAlpha = 1;
    }

    /* --- the Lamp, coming up as you climb out of the shadow */
    const sunX = Math.round(W * 0.74);
    const sunY = Math.round(seaLine - lerp(-3, H * 0.34, step(0.02, 0.9, h)));
    const haze = 1 - 0.62 * h;                   // no air left to scatter it
    disc(sunX, sunY, W * 0.10 * haze, sky.glow, 0.12 * haze);
    disc(sunX, sunY, W * 0.055 * haze, sky.glow, 0.16 * haze);
    disc(sunX, sunY, Math.max(5, W * 0.024), sky.glow, 0.55);
    disc(sunX, sunY, Math.max(3, W * 0.013), [255, 253, 240], 1);
    /* Out of the air it stops being a glow and starts being a hard little
       light with spikes on it. */
    const spike = step(0.62, 0.95, h);
    if(spike > 0.02){
      b.globalAlpha = spike * 0.8;
      b.fillStyle = css(sky.glow);
      const arm = Math.round(W * 0.035);
      for(let i = 4; i <= arm; i++){
        if(i > arm * 0.55 && (i & 1)) continue;            // the spikes fray out
        b.fillRect(sunX - i, sunY, 1, 1); b.fillRect(sunX + i, sunY, 1, 1);
        b.fillRect(sunX, sunY - i, 1, 1); b.fillRect(sunX, sunY + i, 1, 1);
      }
      b.globalAlpha = 1;
    }

    /* --- the world below: flat water to start with, a bent limb by the end */
    /* How hard the world bends, written as the drop at the edge of the frame
       rather than as a radius: the drop is the thing anybody can see, and the
       radius is the thing that has to be solved for to get it. */
    const sag = Math.max(0.5, W * lerp(0.004, 0.17, step(0.06, 0.95, h)));
    const R = (sag * sag + W * W / 4) / (2 * sag);
    const topOf = new Array(W);
    let lowest = 0;
    for(let x = 0; x < W; x++){
      const dx = x - W / 2;
      const y = Math.round(seaLine + R - Math.sqrt(Math.max(0, R * R - dx * dx)));
      topOf[x] = y;
      if(y > lowest) lowest = y;
    }
    const surf = topOf[clamp(cx, 0, W - 1)];
    b.fillStyle = ramp('sea', sky.sea, mix(sky.sea, DEEP, 0.48), seaLine, H, 6, 0.9);
    if(lowest < H) b.fillRect(-4, lowest, W + 8, H - lowest + 8);
    for(let x = 0; x < W; x++){
      if(topOf[x] >= lowest) continue;
      b.fillRect(x, topOf[x], 1, lowest - topOf[x]);
    }
    /* The lit edge of it, and the air above that, which is the only thing in
       the last two seconds that says the black is somewhere you just were. */
    const rim = mix(sky.sea, [255, 255, 255], 0.42);
    b.fillStyle = css(rim);
    for(let x = 0; x < W; x++) b.fillRect(x, topOf[x], 1, 1);
    const airA = step(0.22, 0.8, h);
    if(airA > 0.01){
      for(let k = 1; k <= 4; k++){
        b.globalAlpha = airA * (0.42 / k);
        b.fillStyle = css(mix(sky.low, [255, 255, 255], 0.3));
        for(let x = k > 2 ? (fr & 1) : 0; x < W; x += k > 2 ? 2 : 1) b.fillRect(x, topOf[x] - k, 1, 1);
      }
      b.globalAlpha = 1;
    }

    /* --- weather on the water, drifting: downrange motion, for free */
    const dabA = step(0.26, 0.5, h);
    if(dabA > 0.01){
      const drift = h * 0.22;
      b.globalAlpha = dabA * 0.85;
      for(const d of dabs){
        const x = Math.round((((d.x - drift) % 1) + 1) % 1 * W);
        const top = topOf[clamp(x, 0, W - 1)];
        const y = Math.round(top + d.d * (H - top));
        const near = (y - top) / Math.max(1, H - top);
        const w = Math.max(1, Math.round(d.w * (0.35 + 0.65 * near)));
        b.fillStyle = css(mix(CLOUD_MID, [255, 255, 255], near * 0.6));
        b.fillRect(x, y, w, near > 0.45 ? 2 : 1);
      }
      b.globalAlpha = 1;
    }

    /* --- the water itself, while it is still water: crests, and the Lamp's
           road across it */
    const wet = 1 - step(0.015, 0.13, h);
    if(wet > 0.01){
      b.globalAlpha = wet * 0.5;
      b.fillStyle = css(mix(sky.sea, [255, 255, 255], 0.45));
      for(let row = 1; row < 9; row++){
        const y = surf + row * 2 + (row & 1);
        if(y >= H) break;
        for(let x = 0; x < W; x += 2){
          if(Math.sin(x * 0.12 + row * 1.7 + fr * 0.42) > 0.58) b.fillRect(x, y, 2, 1);
        }
      }
      b.globalAlpha = wet * 0.8;
      b.fillStyle = css(sky.glow);
      for(let row = 0; row < 11; row++){
        const y = surf + row * 2;
        if(y >= H) break;
        const jitter = Math.round(Math.sin(fr * 0.5 + row) * row * 0.7);
        b.fillRect(sunX + jitter - (row >> 1), y, 1 + (row >> 2), 1);
      }
      b.globalAlpha = 1;

      /* The harbour, lashed together on the horizon, lamps still on. */
      const raftA = wet * (1 - step(0.01, 0.06, h));
      if(raftA > 0.02){
        for(const rf of rafts){
          const x = Math.round(rf.x * W), y = topOf[clamp(x, 0, W - 1)];
          b.globalAlpha = raftA;
          b.fillStyle = css(RAFT);
          b.fillRect(x - (rf.w >> 1), y - 2, rf.w, 3);
          b.fillRect(x - (rf.w >> 2), y - 5, Math.max(2, rf.w >> 1), 3);
          b.fillRect(x + 1, y - rf.mast - 2, 1, rf.mast);
          b.fillStyle = css(LANTERN);
          for(const l of rf.lights) b.fillRect(x + l.dx, y + l.dy - 2, 1, 1);
          b.globalAlpha = raftA * 0.35;
          b.fillStyle = css(LANTERN);
          for(const l of rf.lights) b.fillRect(x + l.dx, y + 2, 1, 1);   // on the water
        }
        b.globalAlpha = 1;
      }
    }

    /* --- the clouds behind the lighter */
    /* Where a thing at height `a` shows up on the screen, in two halves that
       meet at your own height.

       Below you, everything crowds towards the horizon, harder the higher you
       are: that is the difference between flying over a cloud deck and
       looking at a wall of confetti.

       Above you is its own curve rather than the same one read backwards.
       Measuring upwards off the distance to the horizon looks obvious and is
       wrong — at sea level the horizon is at eye level, that distance is
       nothing, and the whole cloud deck lands in the water. So: enormous at
       the start, so the deck is somewhere above the top of the frame, and
       settling as the climb flattens everything out. */
    const squeeze = 1 + 1.6 * h;
    const fall = seaLine - tail;
    const rise = H * 1.5 / (h + 0.25);
    const yOf = a => a >= h
      ? tail - (a - h) * rise
      : tail + fall * (1 - Math.pow(1 - clamp((h - a) / Math.max(h, 1e-3), 0, 1), squeeze));
    drawClouds(false, h, yOf, sky);

    /* --- before the water breaks: a light coming up under it */
    if(t < BREACH + 0.05){
      const p = step(BREACH - 0.85, BREACH, t);
      /* Light in water: three rings, none of them solid, squashed flat and
         kept under the surface, because that is where it is. One disc at one
         alpha read as a dinner plate floating in the sea, and a glow allowed
         over the waterline read as fog. */
      b.save();
      b.beginPath(); b.rect(0, surf + 1, W, H - surf); b.clip();
      const gy = surf + 7 + Math.round(15 * (1 - p));
      const glow = mix(sky.glow, sky.sea, 0.42);
      disc(cx, gy, 10 + 34 * p, glow, 0.05 + 0.05 * p, 0.62);
      disc(cx, gy, 6 + 21 * p, glow, 0.08 + 0.08 * p, 0.62);
      disc(cx, gy, 3 + 10 * p, mix(glow, [255, 255, 255], 0.5), 0.10 + 0.14 * p, 0.62);
      b.fillStyle = css(mix(FOAM, sky.sea, 0.25));
      for(const bb of bubbles){
        const age = t - bb.t0;
        if(age < 0 || age > bb.life) continue;
        b.globalAlpha = 0.55 * (1 - age / bb.life);
        b.fillRect(Math.round(cx + bb.dx + Math.sin(age * 9 + bb.dx) * 1.5), Math.round(surf + 20 - age * bb.sp), 1, 1);
      }
      b.globalAlpha = 1;
      b.restore();
    }

    /* --- smoke, while there is air to hold it */
    for(const pf of puffs){
      const age = t - pf.t0;
      if(age < 0 || age > pf.life) continue;
      const y = yOf(pf.a);
      if(y < -20 || y > H + 20) continue;
      const deep = clamp((h - pf.a) / Math.max(h, 1e-3), 0, 1);
      const a = 0.30 * (1 - age / pf.life) * (1 - step(0.42, 0.68, h));
      disc(cx + pf.dx, y, pf.r0 + age * 4.5, mix(SMOKE, SMOKE_OLD, clamp(age / pf.life, 0, 1)), a, 1 - 0.8 * deep);
    }

    /* --- the churn, the foam ring and the spray */
    const fage = t - BREACH;
    const shrink = clamp(1 - 1.9 * h, 0.1, 1);
    if(fage > -0.35 && fage < 0.35){
      disc(cx, surf + 3, 6 + 22 * Math.abs(fage), FOAM, 0.5 * (1 - Math.abs(fage) / 0.35));
    }
    if(fage > 0 && fage < 1.5){
      const rx = Math.max(2, Math.round((7 + fage * 48) * shrink));
      const ry = Math.max(1, Math.round(rx * 0.28));
      b.globalAlpha = 0.8 * (1 - fage / 1.5);
      b.fillStyle = css(mix(FOAM, SPRAY, 0.4));
      for(let dx = -rx; dx <= rx; dx += 2){
        const dy = Math.round(ry * Math.sqrt(Math.max(0, 1 - (dx / rx) * (dx / rx))));
        const x = clamp(cx + dx, 0, W - 1);
        b.fillRect(x, topOf[x] - dy, 1, 1);
        b.fillRect(x, topOf[x] + dy, 1, 1);
      }
      b.globalAlpha = 1;
    }
    for(const s of spray){
      const age = t - s.t0;
      if(age < 0 || age > s.life) continue;
      const x = Math.round(cx + s.vx * age * shrink);
      if(x < 0 || x >= W) continue;
      const y = Math.round(topOf[x] - (s.vy * age - 100 * age * age) * shrink);
      if(y > topOf[x]) continue;                    // fallen back in
      b.globalAlpha = Math.min(1, 1.4 * (1 - age / s.life));
      b.fillStyle = css(age < 0.18 ? FOAM : SPRAY);
      b.fillRect(x, y, s.big ? 2 : 1, s.big ? 2 : 1);
    }
    b.globalAlpha = 1;

    /* --- the plume */
    drawPlume(t, h, cx, tail, fr);

    /* --- the lighter */
    const left = cx - (ROCKET.w >> 1);
    b.imageSmoothingEnabled = false;
    b.drawImage(art.dry, left, nose);
    if(nose + ROCKET.h > surf && t < BREACH + 0.5){
      /* Whatever is still in the water is in the water: one straight-edged
         clip, so the waterline stays a line of pixels. */
      b.save();
      b.beginPath(); b.rect(0, surf, W, H - surf); b.clip();
      b.drawImage(art.wet, left, nose);
      b.restore();
    }
    /* The water breaking, as light: up over the last breath before it and
       down over the quarter second after. Nought everywhere else — a fade
       that starts at one means the whole film opens washed out. */
    const flash = step(BREACH - 0.16, BREACH, t) * (1 - step(BREACH, BREACH + 0.24, t));
    if(flash > 0.02){
      b.globalAlpha = 0.5 * flash;
      b.drawImage(art.lit, left, nose);
      b.globalAlpha = 1;
    }
    /* Water running off the hull for a moment after. */
    b.fillStyle = css(SPRAY);
    for(const d of drops){
      const age = t - d.t0;
      if(age < 0 || age > d.life) continue;
      b.globalAlpha = 0.9 * (1 - age / d.life);
      b.fillRect(Math.round(cx + d.dx), Math.round(nose + 6 - d.vy * age + 120 * age * age), 1, 2);
    }
    b.globalAlpha = 1;
    /* Once the engine is out, one light on the nose, in no hurry. */
    if(t > 5.75 && Math.sin(t * 7.5) > 0.4){
      b.fillStyle = css(LANTERN);
      b.fillRect(cx, nose + 1, 1, 1);
    }

    /* --- and the clouds in front of it */
    drawClouds(true, h, yOf, sky);

    /* --- the water breaking, as light */
    if(flash > 0.01){
      b.globalAlpha = 0.26 * flash;
      b.fillStyle = '#ffffff';
      b.fillRect(-4, -4, W + 8, H + 8);
      b.globalAlpha = 1;
    }

    /* --- up onto the screen, whole pixels only */
    b.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, 0, 0, W * scale, H * scale);
  }

  /* Twice: everything below and ahead first, then the few that are passing
     close enough to go over the top of the lighter. Nothing sells being in
     the weather like something crossing in front of you. */
  function drawClouds(front, h, yOf, sky){
    for(const c of clouds){
      if(!!c.near !== front) continue;
      const y = yOf(c.a);
      if(y < -40 || y > H + 12) continue;
      const depth = h > c.a ? clamp((h - c.a) / Math.max(h, 1e-3), 0, 1) : 0;
      /* Seen from above it is a streak rather than a heap, and it is bluer:
         there is air between the two of you now. */
      const squash = 1 - 0.68 * depth;
      /* Still a long way above you is still a long way away: a cloud you have
         not reached yet is drawn small, and grows into the frame as you do. */
      const far = 1 / (1 + Math.max(0, c.a - h) * 7);
      const wide = c.w * W * far * (1 - 0.4 * depth);
      const x = Math.round(c.x * W - h * W * 0.12);
      b.globalAlpha = (1 - 0.25 * depth) * (1 - step(0.6, 0.88, h));
      if(b.globalAlpha <= 0.01){ b.globalAlpha = 1; continue; }
      for(let r = c.rows - 1; r >= 0; r--){
        const half = Math.max(1, Math.round(wide * c.lumps[r] / 2));
        const yy = Math.round(y + r * squash);
        if(yy < -2 || yy > H + 2) continue;
        const base = r === 0 ? CLOUD_TOP : r < c.rows - 1 ? CLOUD_MID : CLOUD_LOW;
        b.fillStyle = css(mix(base, sky.low, depth * 0.5));
        b.fillRect(x - half, yy, half * 2, 1);
      }
      b.globalAlpha = 1;
    }
  }

  /* A fat orange cone in air, a thin white needle in vacuum, and nothing at
     all once the tank has done its job. */
  function drawPlume(t, h, cx, tail, fr){
    if(t < BREACH - 0.3) return;
    const cut = 1 - step(5.5, 5.85, t);
    if(cut <= 0.01) return;
    const vac = step(0.4, 0.82, h);
    const len = Math.max(2, Math.round((15 + 17 * vac) * cut * (t < BREACH ? 0.45 : 1)));
    const core = Math.max(1, (4.2 - 2.4 * vac) * cut);
    /* The glow it throws on the air around it: small, or it reads as a
       saucer the lighter is sitting on. */
    if(vac < 0.9){
      disc(cx, tail + 3, (2 + core) * (1 - vac), FLAME[2], 0.18 * cut * (1 - vac));
      disc(cx, tail + 4, (3.5 + core * 1.5) * (1 - vac), FLAME[4], 0.07 * cut * (1 - vac));
    }
    for(let i = 0; i < len; i++){
      const u = i / len;
      const flick = 0.72 + 0.56 * hash(fr, i * 7 + 3);
      const w = Math.max(1, Math.round(core * (1 - u * 0.82) * flick));
      const ci = Math.min(FLAME.length - 1, Math.floor(Math.pow(u, 0.8) * FLAME.length));
      b.globalAlpha = u > 0.62 ? Math.max(0, (1 - u) / 0.38) : 1;
      b.fillStyle = css(FLAME[ci]);
      const wobble = Math.round((hash(fr, i) * 2 - 1) * (u * 1.6));
      b.fillRect(cx - w + wobble, tail + i, w * 2, 1);
    }
    b.globalAlpha = 1;
  }

  /* ------------------------------------------------------------- running */

  let raf = 0, over = false, beat = null, resolve = null;
  const done = new Promise(r => { resolve = r; });
  const onResize = () => { layout(); };

  function finish(how){
    if(over) return;
    over = true;
    cancelAnimationFrame(raf);
    removeEventListener('resize', onResize);
    resolve(how);
  }

  function tick(now){
    const t = Math.min(DURATION, (now - start) / 1000);
    const name = beatAt(t);
    if(name !== beat){ beat = name; try{ onBeat(name); }catch(e){ console.warn(e); } }
    if(!said && t >= CAPTION_AT){ said = true; try{ onCaption(); }catch(e){ console.warn(e); } }
    try{
      draw(t);
    }catch(e){
      /* A film is decoration. If it cannot be drawn, the game still starts. */
      console.warn('the opening film stopped early:', e);
      finish('failed');
      return;
    }
    if(t >= DURATION){ finish('played'); return; }
    raf = requestAnimationFrame(tick);
  }

  cast();
  layout();
  build();
  addEventListener('resize', onResize);
  const start = performance.now();
  raf = requestAnimationFrame(tick);

  return { done, skip: () => finish('skipped') };
}
