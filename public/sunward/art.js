/* Sunward — the lot, drawn.
 *
 * One scene, painted at 320x240 and scaled up by whole numbers, and one entry
 * point: `paintLot`. The game page calls it sixty times a second and the shelf
 * on the front page calls it once for its thumbnail, which is the reason it
 * takes everything it needs as arguments and reads nothing from anywhere — the
 * card on the shelf is this scene, not a screenshot of it that goes stale the
 * next time somebody repaints a sky.
 *
 * The palette and the font are imported from the other game rather than
 * copied. Good Vibes' art.js keeps a copy of Solarium's palette and says why:
 * the two are synced from different repositories, so an import would only
 * resolve on the deployed site. That does not apply here — Sunward lives in
 * this repo and ships in the same deploy — and the alternative is a second
 * copy of sixteen hex values that drifts the first time one of them is tuned.
 *
 * --- The tree is grown, not drawn -----------------------------------------
 *
 * There is no tree sprite. It is a recursion over limbs whose depth, length
 * and trunk width all come off one number, `growth`, which is how many growers
 * are on the lot. A player who plants forty things sees a bigger tree than one
 * who planted four, and neither of them is a sprite anybody had to author.
 * Nothing in it is random: the angles are fixed and the only thing that moves
 * is a sway term threaded through from the caller, so the same lot draws the
 * same tree on every frame and in every session.
 *
 * --- Night is a remap, not a wash -----------------------------------------
 *
 * Everything on this canvas is one flat opaque palette colour. Darkening by
 * drawing black over the top at low alpha would put 200 blended colours on a
 * 16-colour screen, so instead every key is looked up through `shade`, which
 * swaps it for a darker key from the same palette as the sun goes down. Sixteen
 * colours at noon and sixteen colours at midnight; different sixteen.
 */

import { PALETTE, hex } from '../good-vibes/pixel.js';

export { PALETTE, hex };

/* The scene's own size. Both callers author against these rather than against
   whatever their canvas happens to be, and scale the element instead.

   Four by three rather than sixteen by nine, which is where this started. A
   320x180 letterbox on a phone held upright is a strip across the top of a
   screen with six hundred pixels of nothing under it, and the thing the strip
   is showing is a tall tree. The extra sixty rows go mostly to the sky, which
   is where the sun spends its day, and the rest to the lot. */
export const SCENE_W = 320;
export const SCENE_H = 240;

/* Where the lot's floor is: seven tenths of the way down, so the sky gets the
   larger share. Everything that stands on the ground is anchored to this line
   and nothing hardcodes the number anywhere else. */
export const GROUND_Y = 168;

/* ------------------------------------------------------------------ light */

/* Which key stands in for which when the light goes. Two steps down, applied
 * once below the horizon and twice in the small hours, so a green leaf goes
 * pine and then violet rather than going grey — a night scene drawn in greys
 * reads as a black-and-white photograph of a day scene.
 */
const DARKER = {
  w: 's', y: 'o', o: 'r', r: 'p', n: 'N', N: 'v', g: 'G', G: 'v',
  t: 'c', c: 'b', b: 's', s: 'v', v: 'd', p: 'v', d: 'k', k: 'k',
};

/* `light` is the sun's height, +1 at noon and -1 at midnight. */
export function shade(key, light){
  let out = key;
  if(light < 0.06) out = DARKER[out] || out;
  if(light < -0.45) out = DARKER[out] || out;
  return out;
}

const fill = (ctx, key, light, x, y, w = 1, h = 1) => {
  ctx.fillStyle = hex(shade(key, light));
  ctx.fillRect(x | 0, y | 0, w, h);
};

/* ------------------------------------------------------------------ dither */

/* A 4x4 ordered matrix, the same one the other games grade their ground with.
   Ordered rather than random because a random dither crawls: every redraw
   picks different pixels and a still sky boils. */
const BAYER = [
  [0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5],
];

/* Fill a rectangle with a mix of two keys, `t` of the way from a to b. */
export function ditherRect(ctx, x, y, w, h, a, b, t, light = 1){
  const level = Math.max(0, Math.min(1, t)) * 16;
  const keyA = hex(shade(a, light));
  const keyB = hex(shade(b, light));
  for(let py = 0; py < h; py++){
    for(let px = 0; px < w; px++){
      const threshold = BAYER[(y + py) & 3][(x + px) & 3];
      ctx.fillStyle = level > threshold ? keyB : keyA;
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

/* ------------------------------------------------------------------- sky */

/* Nine skies, and every minute in between is a dither between the two it falls
 * between. Named by where the sun is rather than by the hour, because that is
 * what the growers read too.
 *
 * Nine rather than four, which is where this started, because an ordered
 * dither between two colours that are far apart does not read as a blend — it
 * reads as speckle. Halfway between midnight ink and dawn plum is not a dusky
 * violet, it is black with bright pink dots in a 4x4 grid, which looks like a
 * fault in the screen. Neighbouring stops that are already close is the whole
 * fix: every pair below is one or two steps apart in the palette.
 */
export const SKIES = [
  { at: 0.00, top: 'd', mid: 'p', low: 'o' },   // first light
  { at: 0.08, top: 'v', mid: 'r', low: 'y' },   // sunrise
  { at: 0.18, top: 'b', mid: 'c', low: 'w' },   // morning
  { at: 0.32, top: 'b', mid: 'c', low: 'w' },   // noon
  { at: 0.42, top: 'b', mid: 'c', low: 'y' },   // afternoon
  { at: 0.50, top: 'v', mid: 'r', low: 'o' },   // dusk
  { at: 0.58, top: 'd', mid: 'v', low: 'r' },   // twilight
  { at: 0.70, top: 'k', mid: 'd', low: 'v' },   // night
  { at: 0.86, top: 'k', mid: 'd', low: 'd' },   // the small hours
];

/* The two skies either side of a phase, and how far between them it is. */
export function skyBlend(phase){
  const p = ((phase % 1) + 1) % 1;
  for(let i = 0; i < SKIES.length; i++){
    const a = SKIES[i];
    const b = SKIES[(i + 1) % SKIES.length];
    const to = i === SKIES.length - 1 ? 1 : b.at;
    if(p >= a.at && p < to) return { a, b, t: (p - a.at) / (to - a.at) };
  }
  return { a: SKIES[SKIES.length - 1], b: SKIES[0], t: 0 };
}

/* A sky's key at a height, as the pair either side of it and how far between.
   Top to mid over the upper half, mid to low over the lower. */
function skyStop(sky, v){
  return v < 0.5
    ? { a: sky.top, b: sky.mid, t: v * 2 }
    : { a: sky.mid, b: sky.low, t: (v - 0.5) * 2 };
}

/* Stars, at fixed places. A hash rather than a stored table so there are as
   many as the sky is wide, and a hash rather than Math.random so they are in
   the same places every night. */
const starAt = i => {
  const h = Math.imul(i + 1, 2654435761) >>> 0;
  return { x: h % SCENE_W, y: 4 + ((h >>> 9) % 130), bright: ((h >>> 20) & 3) };
};

/* The sky is two dithers at once: down the frame between three stops, and
 * across the clock between two times of day. Each gets its own cell of the
 * Bayer matrix — offset from the other so the two patterns do not line up and
 * turn into stripes — and between them the sky is a gradient in both
 * directions using only palette colours and no blending.
 */
export function drawSky(ctx, phase, light){
  const { a, b, t } = skyBlend(phase);
  const level = t * 16;
  for(let y = 0; y < GROUND_Y; y++){
    /* Not linear down the frame. An even split puts the three colours in three
       equal stripes, which reads as a flag rather than as a sky; the curve
       gives the top colour most of the height and squeezes the warm horizon
       colours into the bottom third, where a horizon actually is. */
    const v = Math.pow(y / (GROUND_Y - 1), 1.9);
    const stopA = skyStop(a, v);
    const stopB = skyStop(b, v);
    const rowA = stopA.t * 16;
    const rowB = stopB.t * 16;
    for(let x = 0; x < SCENE_W; x++){
      const time = BAYER[y & 3][x & 3];
      const down = BAYER[(y + 2) & 3][(x + 1) & 3];
      const stop = level > time ? stopB : stopA;
      const frac = level > time ? rowB : rowA;
      ctx.fillStyle = hex(frac > down ? stop.b : stop.a);
      ctx.fillRect(x, y, 1, 1);
    }
  }

  if(light < 0.25){
    const strength = Math.min(1, (0.25 - light) / 0.7);
    for(let i = 0; i < 70; i++){
      const s = starAt(i);
      if(s.bright / 3 > strength) continue;
      fill(ctx, s.bright === 3 ? 'w' : 'c', 1, s.x, s.y);
    }
  }
}

/* The sun and the moon, on the same circle half a day apart. Anything below
   the horizon is simply not drawn — there is no need to clip a thing you can
   decline to paint. */
export function drawSkyBodies(ctx, phase, light){
  const bodies = [
    { angle: phase * Math.PI * 2, r: 7, key: 'y', halo: 'o', face: false },
    { angle: (phase + 0.5) * Math.PI * 2, r: 5, key: 'w', halo: 's', face: true },
  ];
  for(const body of bodies){
    const x = Math.round(SCENE_W / 2 - Math.cos(body.angle) * (SCENE_W / 2 - 18));
    const y = Math.round(GROUND_Y - 16 - Math.sin(body.angle) * 112);
    if(y > GROUND_Y - 6) continue;
    for(let dy = -body.r - 1; dy <= body.r + 1; dy++){
      for(let dx = -body.r - 1; dx <= body.r + 1; dx++){
        const d = Math.sqrt(dx * dx + dy * dy);
        if(d > body.r + 1) continue;
        const key = d > body.r - 0.4 ? body.halo : body.key;
        // The moon keeps its craters: two dark pixels, in the same place every
        // night, because a moon that reshuffles its face is a disco ball.
        const crater = body.face && ((dx === -1 && dy === -1) || (dx === 2 && dy === 1));
        fill(ctx, crater ? 's' : key, 1, x + dx, y + dy);
      }
    }
  }
}

/* Cloud, drifting. One shape, three copies at three heights and three speeds,
   which at this size is more convincing than any one cloud could be. */
export function drawClouds(ctx, now, light){
  const shapes = [
    { y: 26, w: 38, h: 7, speed: 0.0040 },
    { y: 52, w: 26, h: 5, speed: 0.0065 },
    { y: 76, w: 46, h: 6, speed: 0.0028 },
  ];
  for(let i = 0; i < shapes.length; i++){
    const c = shapes[i];
    const span = SCENE_W + c.w * 2;
    const x = Math.round(((now * c.speed + i * 137) % span) - c.w);
    for(let py = 0; py < c.h; py++){
      const inset = Math.round(Math.abs(py - (c.h - 1) / 2) * 2.2);
      const w = c.w - inset * 2;
      if(w <= 0) continue;
      ditherRect(ctx, x + inset, c.y + py, w, 1, 'w', 'c', py / c.h, light);
    }
  }
}

/* ---------------------------------------------------------------- ground */

/* The far ridge, then the lot. Two fixed sine humps rather than noise: at this
   width a noisy skyline reads as a dirty edge, and the ridge only has to say
   "the world carries on past the fence". */
export function drawGround(ctx, light){
  for(let x = 0; x < SCENE_W; x++){
    const ridge = 12 + Math.sin(x * 0.031) * 6 + Math.sin(x * 0.0117 + 2) * 5;
    const top = Math.round(GROUND_Y - ridge);
    for(let y = top; y < GROUND_Y; y++){
      // Further away is lighter and bluer, which is the depth rule the other
      // two games follow, so the three read as one world.
      fill(ctx, y < top + 2 ? 's' : 'G', light, x, y);
    }
  }

  /* And the lot itself: grass that gets darker toward the front rather than
     lighter, which is the same rule the other way up — what is near you is in
     your own shade. It was a band of soil across the bottom third for a while,
     and a hard brown line two thirds of the way down read as the edge of the
     drawing rather than as ground. */
  const band = SCENE_H - GROUND_Y;
  for(let y = 0; y < band; y++){
    const near = y / (band - 1);
    ditherRect(ctx, 0, GROUND_Y + y, SCENE_W, 1, 'g', 'G', 0.18 + near * 0.72, light);
  }
  // A lip of turned soil at the very bottom, three rows, where the lot ends.
  ditherRect(ctx, 0, SCENE_H - 3, SCENE_W, 3, 'G', 'N', 0.55, light);

  // Tufts, on a hash so they do not crawl between frames.
  for(let i = 0; i < 140; i++){
    const h = Math.imul(i + 7, 2246822519) >>> 0;
    const x = h % SCENE_W;
    const y = GROUND_Y + 3 + ((h >>> 8) % (SCENE_H - GROUND_Y - 8));
    fill(ctx, (h >>> 17) & 1 ? 't' : 'g', light, x, y);
    fill(ctx, 'G', light, x, y + 1);
  }
}

/* ----------------------------------------------------------------- props */

/* One sprite per grower, rows of palette keys, '.' transparent — the same way
 * both the other games author art, so a sprite can be read and edited in the
 * source without a tool.
 *
 * Nine of them and nothing else: the lot is meant to fill up with the things
 * you bought, and a thing you bought that does not appear is the clearest way
 * for a clicker to feel like a spreadsheet.
 */
export const PROP_ART = {
  /* The two green ones carry mint highlights and a dark edge, and moss sits on
     turned soil. Drawn in grass green alone they were green on green: at 26
     moss beds and 22 fern banks the lot read as empty, which is the one thing
     a clicker's picture must never do to somebody who has just spent an hour
     filling it. */
  moss: [
    '....tt......',
    '..tggggt.t..',
    '.gGgggggggt.',
    'gGGgGgggGGgg',
    'NGGNGGNNGGNN',
  ],
  fern: [
    '.....t.....',
    '.t...g...t.',
    '.tGg.g.gGt.',
    '..gGtgtGg..',
    '.tGg.g.gGt.',
    '..gG.g.Gg..',
    '.t...g...t.',
    '.....g.....',
    '.....G.....',
    '....NGN....',
  ],
  panel: [
    '......bbbbbb.',
    '.....bccccb..',
    '....bccccb...',
    '...bccccb....',
    '..bccccb.....',
    '..bbbbb......',
    '.....N.......',
    '.....N.......',
    '....NNN......',
  ],
  hive: [
    '..oooooo..',
    '.oNNNNNNo.',
    '.oNNNNNNo.',
    '..oooooo..',
    '.oNNNNNNo.',
    '.oNNkkNNo.',
    '..oooooo..',
    '...NNNN...',
    '...NNNN...',
    '..NNNNNN..',
  ],
  mushroom: [
    '..rrrr......',
    '.rwrrrr.....',
    '.rrrrrr.....',
    '...ww...rrr.',
    '...ww..rwrr.',
    '...ww..rrrr.',
    'rrr.ww...ww.',
    'rwr.ww...ww.',
    '.w..NN...NN.',
  ],
  orchard: [
    '...ggg....ggg...',
    '..gGggg..gGggg..',
    '.gggrgg.gggrgg..',
    '.ggggGg.ggggGg..',
    '..gGgg...gGgg...',
    '....N.....N.....',
    '....N.....N.....',
    '....N.....N.....',
    '...NNN...NNN....',
  ],
  turbine: [
    '.....w.....',
    '.....w.....',
    '....ww.....',
    '....w......',
    '.wwwswww...',
    '....ww.....',
    '....s.w....',
    '....s..w...',
    '....s......',
    '....s......',
    '....s......',
    '....s......',
    '....s......',
    '...sss.....',
  ],
  glasshouse: [
    '......wwwwww......',
    '....wwccccccww....',
    '...wcccccccccw....',
    '..wccccccccccccw..',
    '..wcgcccgcccgccw..',
    '..wcgcccgcccgccw..',
    '..wccccccccccccw..',
    '..wwwwwwwwwwwwww..',
    '..NNNNNNNNNNNNNN..',
  ],
  canopy: [
    '....ggg......',
    '...gGggg.....',
    '..ggggggg....',
    '...gGggg.....',
    '....sss......',
    '...sswss.....',
    '...sswss.....',
    '..ggsssgg....',
    '.gGgsssgGg...',
    '..ggsssgg....',
    '...sswss.....',
    '...sswss.....',
    '..ggsssgg....',
    '.gGgsssgGg...',
    '..ggsssgg....',
    '...sswss.....',
    '...sswss.....',
    '...sswss.....',
    '..sssssss....',
  ],
};

/* A sprite, drawn through the same light the rest of the scene is drawn
 * through. pixel.js has a `drawSprite` and this is not it: that one looks its
 * keys up in the palette directly, which is right for a game whose lighting
 * never changes and wrong here — a hive in full orange at midnight sits on a
 * violet lot looking like it has been cut out and pasted on.
 */
export function drawPiece(ctx, piece, light){
  if(piece.footed) footing(ctx, piece.x + 1, piece.ground, piece.rows[0].length - 2, light);
  drawProp(ctx, piece.rows, piece.x, piece.y, light);
}

export function drawProp(ctx, rows, x, y, light){
  /* One step down at night and never two. The ground and the tree take both,
     because they are the scene; the things you bought are the point of the
     screen, and at two steps a full lot at midnight was an empty lot with a
     faint bruise on it. Holding them one step brighter than their surroundings
     reads as them catching what light there is, which is what you want to
     believe about a garden you planted. */
  const lit = Math.max(light, -0.4);
  const w = rows[0].length;
  for(let r = 0; r < rows.length; r++){
    for(let c = 0; c < w; c++){
      const key = rows[r][c];
      if(key === '.') continue;
      fill(ctx, key, lit, x + c, y + r);
    }
  }
}

/* Where each kind stands, and where the second, third and fourth of them go.
 *
 * Hand-placed rather than laid out by a rule. A rule that packs nine sprites
 * into 320 pixels without any of them landing on the tree or walking off the
 * edge is a harder thing to write than thirty-six numbers, and it goes wrong
 * silently — a sprite half off the canvas looks like a rendering fault.
 *
 * `y` is the sprite's ground line, and everything on the lot is drawn in order
 * of it, so a thing standing further forward is painted over the thing behind.
 */
export const PROP_SPOTS = {
  orchard:    [{ x: 4, y: 184 }, { x: 24, y: 191 }, { x: 46, y: 179 }, { x: 66, y: 187 }],
  glasshouse: [{ x: 196, y: 182 }, { x: 218, y: 190 }, { x: 176, y: 177 }, { x: 240, y: 185 }],
  turbine:    [{ x: 276, y: 179 }, { x: 262, y: 188 }, { x: 292, y: 185 }, { x: 248, y: 177 }],
  hive:       [{ x: 62, y: 207 }, { x: 76, y: 215 }, { x: 48, y: 213 }, { x: 90, y: 206 }],
  panel:      [{ x: 212, y: 204 }, { x: 230, y: 212 }, { x: 246, y: 202 }, { x: 196, y: 213 }],
  canopy:     [{ x: 296, y: 206 }, { x: 282, y: 215 }, { x: 306, y: 220 }, { x: 270, y: 209 }],
  moss:       [{ x: 20, y: 234 }, { x: 40, y: 226 }, { x: 4, y: 221 }, { x: 58, y: 238 }],
  mushroom:   [{ x: 92, y: 229 }, { x: 108, y: 238 }, { x: 76, y: 235 }, { x: 122, y: 226 }],
  fern:       [{ x: 246, y: 227 }, { x: 262, y: 237 }, { x: 230, y: 235 }, { x: 278, y: 229 }],
};

/* How many you have to own before the second, third and fourth copies appear.
   The lot should keep changing well past the first purchase, and it should
   stop changing before it is a wall of sprites. These were 1, 10, 25 and 60,
   which put four sprites on the lot for a garden of ninety-one growers — the
   picture was a third of the way through the game while the shop was most of
   the way. */
export const PROP_STEPS = [1, 5, 15, 40];

export const propCount = owned => {
  let n = 0;
  for(const step of PROP_STEPS) if(owned >= step) n++;
  return n;
};

/* ------------------------------------------------------------------ tree */

/* One repaint of the sky per second of a four-minute day. Finer than this is
   work nobody can see; coarser and dusk arrives in visible steps. */
const DAY_BUCKETS = 240;

/* Where it stands. The lot is drawn around this, so it is the one coordinate
   in the file that other things are placed relative to. */
export const TREE_X = 160;
export const TREE_Y = 192;

/* How big the tree is for a given number of growers. Logarithmic, because the
   difference between nothing and ten things planted deserves to be visible and
   the difference between four hundred and four hundred and ten does not. */
export const growthFor = growers =>
  Math.max(0, Math.min(1, Math.log(1 + Math.max(0, growers)) / Math.log(801)));

/* A run of pixels, which is how everything organic here is drawn. A blob of
   radius seven is 150 pixels and fifteen spans; at sixty frames a second and
   sixty blobs that is the difference between a tree and a slideshow. */
const run = (ctx, key, light, x, y, w) => {
  if(w <= 0) return;
  ctx.fillStyle = hex(shade(key, light));
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), 1);
};

function leafBlob(ctx, cx, cy, r, light){
  const R = Math.max(1, Math.round(r));
  for(let dy = -R; dy <= R; dy++){
    const half = Math.floor(Math.sqrt(Math.max(0, R * R - dy * dy + 0.5)));
    if(half < 0) continue;
    const x0 = Math.round(cx) - half;
    const w = half * 2 + 1;
    // Lit from above: more of the light green on the upper rows, more of the
    // dark on the lower ones. Two spans a row rather than a per-pixel dither,
    // which at this radius is a tenth of the work and reads the same.
    const split = Math.max(0, Math.min(w, Math.round(w * (dy < 0 ? 0.7 : 0.34))));
    run(ctx, 'g', light, x0, Math.round(cy) + dy, split);
    run(ctx, 'G', light, x0 + split, Math.round(cy) + dy, w - split);
  }
}

function limb(ctx, x, y, angle, len, width, depth, o){
  // The sway is applied more to the thin ends than to the trunk, which is what
  // a tree in wind actually does and what stops the whole thing sliding.
  const a = angle + o.sway * (o.depth - depth + 1) * 0.35;
  const x2 = x + Math.cos(a) * len;
  const y2 = y + Math.sin(a) * len;

  const w = Math.max(1, Math.round(width));
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x, y2 - y)));
  for(let i = 0; i <= steps; i++){
    const t = i / steps;
    const px = x + (x2 - x) * t - w / 2;
    const py = y + (y2 - y) * t;
    run(ctx, 'N', o.light, px, py, w);
    if(w > 2){
      // A highlight on whichever side the sun is, and a shadow on the other.
      run(ctx, 'n', o.light, o.sunSide < 0 ? px : px + w - 1, py, 1);
      run(ctx, 'v', o.light, o.sunSide < 0 ? px + w - 1 : px, py, 1);
    }
  }

  if(depth <= 0){
    leafBlob(ctx, x2, y2, o.leaf, o.light);
    return;
  }
  const spread = 0.26 + depth * 0.042;
  limb(ctx, x2, y2, a - spread, len * 0.74, width * 0.66, depth - 1, o);
  limb(ctx, x2, y2, a + spread * 0.88, len * 0.7, width * 0.66, depth - 1, o);

  /* A leader carrying straight on out of the first fork, so the crown is not
     a perfect binary Y. Two branches and nothing else is the shape of a
     catapult, and it was the single thing that made the first cut of this
     read as a diagram of a tree rather than as a tree. */
  if(depth === o.depth && o.depth >= 3){
    limb(ctx, x2, y2, a + 0.05, len * 0.82, width * 0.62, depth - 1, o);
  }

  /* And a smaller blob at the last fork as well as at the tips. The gaps
     between eight tip blobs are bigger than the blobs at this size, and a
     canopy you can see the sky through in eight places is a canopy that reads
     as being under construction. */
  if(depth === 1) leafBlob(ctx, x2, y2, o.leaf * 0.62, o.light);
  if(depth === 2 && o.depth >= 5) leafBlob(ctx, x2, y2, o.leaf * 0.5, o.light);
}

/* `pulse` is how hard the tree is still ringing from a tap, 0 to 1: the
   canopy swells by up to a third of its blob radius and settles. It is the
   tap's own animation, and it is on the tree rather than on the number that
   floats away, because the tree is what you tapped. */
export function drawTree(ctx, growth, { sway = 0, light = 1, sunSide = -1, shake = 0, pulse = 0 } = {}){
  const g = Math.max(0, Math.min(1, growth));
  const depth = 3 + Math.round(g * 3);
  const o = {
    sway, light, sunSide, depth,
    // Bigger blobs on a young tree than the growth curve alone would give it.
    // A sapling drawn with a one-pixel trunk and eight two-pixel leaves is a
    // thread with specks on it, not a plant somebody wants to look after.
    leaf: (3.8 + g * 4.2) * (1 + Math.max(0, Math.min(1, pulse)) * 0.35),
  };
  /* Nine pixels tall was the first cut of a fresh lot, and a nine-pixel sapling
     is not a thing anybody is going to want to tap four thousand times — it
     read as a weed. Twenty-six was the second, and it was right for a 180-tall
     frame and lost in a 240-tall one: the number that matters is the share of
     the picture the tree takes, and growing the frame by a third shrank it. A
     new lot is fifty-six, which draws about eighty-four pixels of tree — a
     third of the frame — and a full one is nearly twice that. The thing you
     are here to tap should be the thing you look at first. */
  limb(ctx, TREE_X + shake, TREE_Y, -Math.PI / 2, (62 + g * 50) * 0.44,
    2 + g * 5, depth, o);
}

/* A burst at the point of a tap: a dozen pixels flung outward and falling
 * back, in the tree's own greens with a spark of gold. `age` runs 0 to 1 over
 * the burst's life. Deterministic in everything but time — the spread comes
 * off the particle's index, not a die — so two taps in the same place throw
 * the same shape, which is what makes it read as the tree reacting rather
 * than as confetti.
 */
export function drawBurst(ctx, x, y, age, light = 1){
  const t = Math.max(0, Math.min(1, age));
  const count = 12;
  for(let i = 0; i < count; i++){
    const angle = -Math.PI * (0.15 + 0.7 * (i / (count - 1))) + ((i % 3) - 1) * 0.12;
    const speed = 22 + (i % 4) * 7;
    const px = x + Math.cos(angle) * speed * t;
    const py = y + Math.sin(angle) * speed * t + 34 * t * t;   // and gravity
    if(t > 0.85 && (i % 2)) continue;                           // thinning out
    const key = i % 5 === 0 ? 'y' : i % 3 === 0 ? 't' : 'g';
    fill(ctx, key, light, Math.round(px), Math.round(py), 2, 2);
  }
}

/* The area a tap should feel like it landed on. Generous on purpose: a target
   you have to aim at is a target that hurts to click four thousand times. */
export function treeBounds(growth){
  const g = Math.max(0, Math.min(1, growth));
  const reach = 32 + g * 46;
  const height = 66 + g * 90;
  return { x: TREE_X - reach, y: TREE_Y - height, w: reach * 2, h: height + 6 };
}

/* ------------------------------------------------------------------- lot */

/* Everything that stands on the ground, in order of how far forward it is. The
   sort is by ground line in pixels and not by any list order, which is the
   rule the other games arrived at the hard way: a thing top-anchored to a tile
   and a thing standing on the tile floor cannot be compared by row. */
/* A shadow under whatever is standing there, so nothing floats and everything
   green has a dark edge to sit against. Two rows, tapered, which at this size
   is the difference between a sprite on a lawn and a sprite in one. */
export function footing(ctx, x, y, w, light){
  for(let i = 0; i < w; i++){
    const t = Math.abs(i - w / 2) / (w / 2);
    if(t > 0.9) continue;
    fill(ctx, 'G', Math.min(light, -0.2), x + i, y - 1, 1, t > 0.55 ? 1 : 2);
  }
}

function lotPieces(owned){
  const pieces = [];
  for(const [id, rows] of Object.entries(PROP_ART)){
    const spots = PROP_SPOTS[id] || [];
    const n = Math.min(propCount(owned[id] || 0), spots.length);
    for(let i = 0; i < n; i++){
      const spot = spots[i];
      pieces.push({ rows, x: spot.x, y: spot.y - rows.length, ground: spot.y, footed: true });
    }
  }
  return pieces.sort((a, b) => a.ground - b.ground);
}

/* Fireflies, once it is dark enough and there is something for them to be
   over. They are the only thing on the lot that is not a purchase, and they
   are here because a night scene with nothing moving in it reads as a paused
   game rather than as a night. */
function drawMotes(ctx, now, light, growers){
  if(light > -0.05 || growers < 3) return;
  const many = Math.min(18, 3 + Math.floor(growers / 6));
  for(let i = 0; i < many; i++){
    const h = Math.imul(i + 3, 374761393) >>> 0;
    const baseX = h % SCENE_W;
    const baseY = 120 + ((h >>> 7) % 70);
    const x = baseX + Math.sin(now / (900 + (h & 511)) + i) * 14;
    const y = baseY + Math.cos(now / (1300 + (h & 255)) + i * 2) * 7;
    const blink = Math.sin(now / 320 + i * 1.7);
    if(blink < -0.2) continue;
    fill(ctx, blink > 0.6 ? 'w' : 'y', 1, Math.round(x), Math.round(y));
  }
}

/* Paint the whole scene into `ctx`, which is expected to be SCENE_W x SCENE_H
 * pixels of unsmoothed canvas. Everything it needs is an argument: this is the
 * function the game page calls sixty times a second and the one the shelf
 * calls once, and neither of them can tell the other apart.
 */
export function paintLot(ctx, {
  phase = 0.25, growth = 0, owned = {}, now = 0, sway = 0, shake = 0, growers = 0, pulse = 0,
} = {}){
  const light = Math.sin(phase * Math.PI * 2);
  const sunSide = Math.cos(phase * Math.PI * 2) > 0 ? -1 : 1;

  drawSky(ctx, phase, light);
  drawSkyBodies(ctx, phase, light);
  drawClouds(ctx, now, light);
  drawGround(ctx, light);

  const pieces = lotPieces(owned);
  // Everything behind the tree, then the tree, then everything in front of it.
  for(const p of pieces) if(p.ground <= TREE_Y) drawPiece(ctx, p, light);
  drawTree(ctx, growth, { sway, light, sunSide, shake, pulse });
  for(const p of pieces) if(p.ground > TREE_Y) drawPiece(ctx, p, light);

  drawMotes(ctx, now, light, growers);
}

/* The same scene, with the parts that do not change every frame kept in
 * offscreen canvases.
 *
 * The sky alone is 320 by 168 pixels of ordered dither, which is fifty-four
 * thousand `fillRect` calls; at sixty frames a second that is a slideshow with
 * a fan running. It is a pure function of the time of day, so it is painted
 * once per bucket and stamped back with a single `drawImage` — the same trick
 * the build map in Good Vibes uses, for the same reason and with the same
 * effect on the frame time.
 *
 * The tree is not cached: it sways, so it is different on every frame by
 * design, and it is drawn in spans rather than pixels precisely so it can be.
 */
export function createLot(){
  let sky = null, ground = null, props = null;
  let skyKey = null, groundKey = null, propKey = null;

  const buffer = () => {
    const canvas = document.createElement('canvas');
    canvas.width = SCENE_W;
    canvas.height = SCENE_H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return { canvas, ctx };
  };

  return function paint(ctx, opts = {}){
    const { phase = 0.25, growth = 0, owned = {}, now = 0, sway = 0, shake = 0, growers = 0, pulse = 0 } = opts;
    const light = Math.sin(phase * Math.PI * 2);
    const sunSide = Math.cos(phase * Math.PI * 2) > 0 ? -1 : 1;

    if(!sky) sky = buffer();
    if(!ground) ground = buffer();
    if(!props) props = buffer();

    // One bucket per second of a four-minute day: the sky moves, but not
    // faster than the eye can be told about.
    const nextSky = Math.round(phase * DAY_BUCKETS);
    if(nextSky !== skyKey){
      skyKey = nextSky;
      sky.ctx.clearRect(0, 0, SCENE_W, SCENE_H);
      drawSky(sky.ctx, phase, light);
      drawSkyBodies(sky.ctx, phase, light);
    }

    const nextGround = Math.round(light * 8);
    if(nextGround !== groundKey){
      groundKey = nextGround;
      ground.ctx.clearRect(0, 0, SCENE_W, SCENE_H);
      drawGround(ground.ctx, light);
    }

    const pieces = lotPieces(owned);
    const nextProps = pieces.map(p => `${p.x},${p.ground}`).join('|') + '@' + nextGround;
    if(nextProps !== propKey){
      propKey = nextProps;
      props.ctx.clearRect(0, 0, SCENE_W, SCENE_H);
      for(const p of pieces) drawPiece(props.ctx, p, light);
    }

    ctx.drawImage(sky.canvas, 0, 0);
    drawClouds(ctx, now, light);
    ctx.drawImage(ground.canvas, 0, 0);
    // The props are one image, so the tree cannot be drawn between the near
    // ones and the far ones. It is drawn first and the near props over it,
    // which is the same order the uncached path produces for everything that
    // stands in front of the trunk — and the far ones are behind the ridge
    // anyway, where the tree does not reach.
    drawTree(ctx, growth, { sway, light, sunSide, shake, pulse });
    ctx.drawImage(props.canvas, 0, 0);
    drawMotes(ctx, now, light, growers);
  };
}

