/* The ground a surge is fought on, painted rather than generated.
 *
 * The build phase is a map: a grid of sixteen-pixel tiles you walk around, and
 * it is a grid because every question that phase asks is a question about
 * neighbours. Combat was drawn out of the same tile set — `generateCombatTerrain`
 * rolled an eight-row board and the same grass, water and rubble tiles were
 * stamped across it — and the result was that the two halves of a round looked
 * like the same screen with the furniture moved. The most dramatic moment in the
 * game was staged on a smaller copy of the least dramatic one.
 *
 * Nothing on a standoff field is walked on, stood in, built on or gathered
 * from. The ground has no rules left to carry, so it does not need to be made
 * of tiles at all, and this file stops pretending it is: a stage in bands, one
 * horizon, and everything drawn at the scale of the picture rather than the
 * scale of a tile.
 *
 * Solarpunk means something specific here and it is not "add plants". It is
 * that the built thing and the growing thing are the same thing: towers with
 * terraces on them, a turbine somebody planted a hedge around, paving that the
 * moss was allowed to keep. Nothing is ruined and nothing is pristine.
 *
 * Everything here is deterministic — hashed off coordinates, never rolled — so
 * a repaint is pixel-identical and the ground never shimmers. That is also what
 * lets the whole backdrop be cached: it is redrawn only when the round changes.
 */

import { PALETTE } from './art.js';

/* Stable per-position randomness, the same hash the map renderer uses. */
const hash2 = (x, y) => {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0);
};

/* A 4x4 ordered dither. Every gradient in this file is two flat colours and one
   of these thresholds, because a real gradient would be the only smooth thing
   on a screen made of pixels and would read as a browser drawing on top of a
   game rather than as part of it. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const mix = (ctx, x, y, t, low, high) => {
  ctx.fillStyle = BAYER[y & 3][x & 3] / 16 < t ? high : low;
  ctx.fillRect(x, y, 1, 1);
};

/* ---- the hour ------------------------------------------------------------ */

/* One palette per round, and they are a day rather than four moods: the run
 * opens in the afternoon and ends at the Array after dark. The ground warms as
 * the sky cools, because the light on the floor in the last two rounds is the
 * party's own — the lanterns and the panels, not the sun.
 */
const HOURS = [
  { // Round one — the overgrowth, full afternoon
    skyTop: '#2f7fb8', skyMid: '#5aa8cf', skyLow: '#a9e0ec', sun: '#fff3b0', glow: '#ffd98a',
    far: '#2c5a6b', mid: '#1f4a33', hedge: '#2a6134',
    floorFar: '#9a9c86', floorNear: '#6e6f5e', seam: '#4d4f43', inlay: '#bcbda6', ring: '#4d4f43',
    moss: '#3f8f38', bloom: '#c3ec86',
  },
  { // Round two — panel fields, low gold
    skyTop: '#2b5f9c', skyMid: '#8f6f8e', skyLow: '#f0b070', sun: '#ffd23f', glow: '#f59a2e',
    far: '#3b4a63', mid: '#26402c', hedge: '#2f5a30',
    floorFar: '#a4917a', floorNear: '#75634f', seam: '#54463a', inlay: '#c2ad91', ring: '#54463a',
    moss: '#4e8f3a', bloom: '#d9c26b',
  },
  { // Round three — the rustlands, dusk
    skyTop: '#3b2b5a', skyMid: '#8a4a55', skyLow: '#d4783c', sun: '#f08c33', glow: '#e04b5a',
    far: '#40304f', mid: '#241f33', hedge: '#2c3a2c',
    floorFar: '#7d675a', floorNear: '#513f33', seam: '#3a2d25', inlay: '#997e69', ring: '#3a2d25',
    moss: '#48713a', bloom: '#e0a05a',
  },
  { // Round four — the Array, after dark and lit from below
    skyTop: '#0e0920', skyMid: '#241a44', skyLow: '#3d2f6b', sun: '#9fe9ee', glow: '#4fc4d3',
    far: '#1d1836', mid: '#141a26', hedge: '#1b2c26',
    floorFar: '#3a3949', floorNear: '#21202b', seam: '#16151d', inlay: '#46455a', ring: '#2f7f83',
    moss: '#2f6b48', bloom: '#7ff0d3',
  },
];
export const hourFor = round => HOURS[Math.min(HOURS.length - 1, Math.max(0, (round || 1) - 1))];

/* Where the sky stops and where the hedge's feet are, so nothing else has to
   guess. Anything standing at the back of the stage — the Engineer's buildings,
   most obviously — stands on the hedge foot. */
export const stageHorizon = height => Math.round(height * 0.34);
export const stageHedgeFoot = height => stageHorizon(height) + 12;

/* ---- the far skyline ----------------------------------------------------- */

/* What is on the horizon: the block the party is holding this ruin for.
 *
 * Four shapes, and every one of them is a built thing with something growing
 * out of it — a tower with planted terraces, a dome under a canopy, a turbine
 * with a hedge at its foot, a chimney gone over to ivy. Drawn as flat
 * silhouettes in one colour, because this is the back of the picture and any
 * detail here competes with the fight in front of it.
 *
 * Placed by hash rather than by roll, so the same round is always the same
 * skyline and it never shimmers between frames.
 */
function tower(ctx, x, base, h, w, colour, accent){
  ctx.fillStyle = colour;
  ctx.fillRect(x, base - h, w, h);
  // Terraces: a planted ledge every few floors, sticking out both sides.
  ctx.fillStyle = accent;
  for(let y = base - h + 4; y < base - 2; y += 6){
    ctx.fillRect(x - 1, y, w + 2, 1);
    for(let c = 0; c < w + 2; c++){
      if((hash2(x + c, y) & 3) === 0) ctx.fillRect(x - 1 + c, y - 1, 1, 1);
    }
  }
}

function dome(ctx, cx, base, r, colour, accent){
  ctx.fillStyle = colour;
  for(let y = 0; y <= r; y++){
    const half = Math.round(Math.sqrt(Math.max(0, r * r - y * y)));
    ctx.fillRect(cx - half, base - y, half * 2, 1);
  }
  // A crown of growth over the top, which is the whole idea in one row.
  ctx.fillStyle = accent;
  for(let a = -r; a <= r; a++){
    const y = Math.round(Math.sqrt(Math.max(0, r * r - a * a)));
    if((hash2(cx + a, r) & 3) === 0) ctx.fillRect(cx + a, base - y - 1, 1, 2);
  }
}

function turbine(ctx, x, base, h, colour, accent, spin){
  ctx.fillStyle = colour;
  ctx.fillRect(x, base - h, 1, h);
  const hub = base - h;
  // Three blades. They turn, slowly, and it is the only thing on the horizon
  // that moves — which is what stops the skyline reading as wallpaper.
  for(let b = 0; b < 3; b++){
    const a = spin + b * (Math.PI * 2 / 3);
    for(let r = 2; r < 9; r++){
      ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(hub + Math.sin(a) * r * 0.6), 1, 1);
    }
  }
  ctx.fillStyle = accent;
  ctx.fillRect(x - 2, base - 2, 5, 2);
}

function chimney(ctx, x, base, h, w, colour, accent){
  ctx.fillStyle = colour;
  ctx.fillRect(x, base - h, w, h);
  // Ivy down one side, thickening toward the ground.
  ctx.fillStyle = accent;
  for(let y = base - h + 3; y < base; y++){
    const thick = 1 + Math.floor((y - (base - h)) / 6);
    for(let c = 0; c < thick; c++){
      if((hash2(x + c, y) & 1) === 0) ctx.fillRect(x + w - 1 - c, y, 1, 1);
    }
  }
}

/* ---- the stage ----------------------------------------------------------- */

/* The whole backdrop, painted once per round into an offscreen canvas.
 *
 * `spin` is the only live parameter, and it only reaches the turbines. Painting
 * the rest per frame would be sixty thousand fillRects a frame for a picture
 * that does not change.
 */
export function paintStage(ctx, { width, height, round, spin = 0 }){
  const hour = hourFor(round);
  const horizon = stageHorizon(height);
  const hedgeFoot = stageHedgeFoot(height);

  /* Sky: three stops, not two.
   *
   * A single ramp across the whole sky spends most of its height at a fifty-fifty
   * dither, and a fifty-fifty ordered dither over a few thousand pixels stops
   * reading as a colour and starts reading as a checkerboard. Two short ramps —
   * high to middle, middle to horizon — put the flat colours where there is the
   * most sky and the mixing where the eye expects a change anyway. */
  const fold = Math.round(horizon * 0.55);
  for(let y = 0; y < horizon; y++){
    const t = y < fold
      ? (y / Math.max(1, fold)) * 0.9
      : ((y - fold) / Math.max(1, horizon - fold - 1)) * 0.9 + 0.05;
    const low = y < fold ? hour.skyTop : hour.skyMid;
    const high = y < fold ? hour.skyMid : hour.skyLow;
    for(let x = 0; x < width; x++) mix(ctx, x, y, t, low, high);
  }

  /* The sun, low and off centre so the party is not standing in front of it.
     Dithered at the rim for the same reason the sky is. */
  const sunX = Math.round(width * 0.72);
  const sunY = horizon - 6;
  const sunR = 13;
  for(let y = -sunR; y <= sunR; y++){
    for(let x = -sunR; x <= sunR; x++){
      const py = sunY + y;
      if(py < 0 || py >= horizon) continue;
      const d = Math.hypot(x, y) / sunR;
      if(d > 1) continue;
      if(d > 0.55 && BAYER[(y + 64) & 3][(x + 64) & 3] / 16 < (d - 0.55) / 0.45) continue;
      ctx.fillStyle = d < 0.45 ? hour.sun : hour.glow;
      ctx.fillRect(sunX + x, py, 1, 1);
    }
  }

  /* Cloud bars, long and thin and lit from below. Two depths, because one
     reads as a texture and two read as weather. */
  for(let i = 0; i < 9; i++){
    const seed = hash2(i * 17 + 3, round * 31 + 5);
    const w = 30 + (seed % 70);
    const y = 3 + (seed % Math.max(1, horizon - 12));
    const x = seed % width;
    ctx.fillStyle = y > horizon * 0.6 ? hour.glow : hour.far;
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x + 5, y - 1, Math.max(3, w - 18), 1);
  }

  /* The block on the horizon. Positions hashed off the round so each site has
     its own skyline and none of them wander between frames. */
  const skyline = [];
  for(let i = 0; i < 7; i++){
    const seed = hash2(i * 23 + 11, round * 7 + 2);
    skyline.push({ x: Math.round((i + 0.5) * (width / 7) + ((seed % 15) - 7)), kind: seed % 4, seed });
  }
  for(const { x, kind, seed } of skyline){
    if(kind === 0) tower(ctx, x - 4, horizon + 1, 16 + (seed % 18), 8, hour.far, hour.mid);
    else if(kind === 1) dome(ctx, x, horizon + 1, 8 + (seed % 7), hour.far, hour.mid);
    else if(kind === 2) turbine(ctx, x, horizon + 1, 20 + (seed % 12), hour.far, hour.mid, spin);
    else chimney(ctx, x - 2, horizon + 1, 12 + (seed % 16), 5, hour.far, hour.mid);
  }

  /* A hedge along the horizon, so the skyline stands behind something rather
     than on the floor. Ragged top, flat foot. */
  for(let x = 0; x < width; x++){
    const h = 7 + (hash2(x >> 2, 91) % 5) + (hash2(x >> 3, 17) % 3);
    ctx.fillStyle = hour.mid;
    ctx.fillRect(x, hedgeFoot - h, 1, h);
    // A lit top edge, two pixels of it, so the hedge has a sun side.
    if((hash2(x, 7) & 3) !== 0){
      ctx.fillStyle = hour.hedge;
      ctx.fillRect(x, hedgeFoot - h, 1, 2);
    }
  }

  /* The floor: a plaza in one-point perspective, not a grid.
   *
   * Bands from the hedge to the bottom of the frame, dithered from the far
   * tone to the near one — lighter and cooler at the back, warmer and darker
   * under the party's feet. There are no tile edges anywhere in it.
   */
  for(let y = hedgeFoot; y < height; y++){
    const t = (y - hedgeFoot) / Math.max(1, height - hedgeFoot - 1);
    for(let x = 0; x < width; x++) mix(ctx, x, y, t, hour.floorFar, hour.floorNear);
  }

  const depth = height - hedgeFoot;
  const vpX = Math.round(width * 0.5);

  /* Seams, laid to a vanishing point sitting on the horizon.
   *
   * The first pass at this drew only the horizontal seams, and a floor of
   * nothing but horizontals is a striped rug: nine parallel lines across a wide
   * frame, all the same length, all the same weight. What makes a plaza read as
   * a plaza is the other family of seams — the ones that converge — because
   * those are the only lines on screen that carry any depth. So: a fan of rays
   * out of the vanishing point, five horizontals rather than nine to cross
   * them, and every line broken by hash so none of it is a ruler.
   */
  const seamAt = (x, y) => {
    if(x < 0 || x >= width) return;
    if((hash2(x >> 1, y) & 7) === 0) return;              // the odd missing stone
    ctx.fillRect(x, y, 1, 1);
  };

  ctx.fillStyle = hour.seam;
  for(let i = -8; i <= 8; i++){
    if(i === 0) continue;
    const spread = i * (width / 7);
    for(let y = hedgeFoot; y < height; y++){
      // How far down the floor we are, measured from the vanishing point rather
      // than from the hedge, which is what makes the fan open out smoothly.
      const frac = (y - horizon) / Math.max(1, height - horizon);
      // Seventeen rays all arriving at one point put a black knot on the
      // horizon, which is a diagram of perspective rather than a floor. So they
      // are dithered out over the back half of the plaza and only reach full
      // weight where they are far enough apart to be separate lines.
      const near = (y - hedgeFoot) / Math.max(1, depth);
      if(BAYER[y & 3][(i * 5) & 3] / 16 > near / 0.45) continue;
      seamAt(Math.round(vpX + spread * frac * frac), y);
    }
  }

  /* Five course lines, spaced by a square law so they crowd toward the horizon. */
  const courses = [];
  for(let i = 1; i < 6; i++){
    const y = hedgeFoot + Math.round(depth * Math.pow(i / 6, 1.9));
    if(y >= height) break;
    courses.push(y);
    ctx.fillStyle = hour.seam;
    for(let x = 0; x < width; x++) seamAt(x, y);
    // Moss in the seam, thicker where it is nearer the camera, and only ever in
    // patches — a continuous green line under a stone one is a stripe again.
    ctx.fillStyle = hour.moss;
    for(let x = 0; x < width; x++){
      if((hash2(x, y * 3) % 11) > i - 1) continue;
      ctx.fillRect(x, y + 1, 1, 1);
    }
  }

  /* The mosaic: a sun laid into the stone at the middle of the plaza.
   *
   * This is the one thing on the stage that nobody could mistake for generated
   * ground. It is an ellipse rather than a circle because it is lying flat and
   * being looked at from a low angle, it is inlaid in a paler stone, and it has
   * twelve spokes and two rings — a sun, which is the only motif this setting
   * was ever going to lay into a floor. The party fights standing on it.
   */
  const mx = width / 2;
  const my = hedgeFoot + depth * 0.62;
  const rx = width * 0.31;
  const ry = depth * 0.42;
  for(let y = Math.max(hedgeFoot, Math.round(my - ry)); y < Math.min(height, Math.round(my + ry) + 1); y++){
    for(let x = Math.max(0, Math.round(mx - rx)); x < Math.min(width, Math.round(mx + rx) + 1); x++){
      const dx = (x - mx) / rx;
      const dy = (y - my) / ry;
      const d = Math.hypot(dx, dy);
      if(d > 1) continue;
      // The field, dithered in so the inlay has a grain and an edge that frays.
      if(BAYER[y & 3][x & 3] / 16 < 0.72 - d * 0.45){
        ctx.fillStyle = hour.inlay;
        ctx.fillRect(x, y, 1, 1);
      }
      // Two rings.
      if((d > 0.93 && d < 0.99) || (d > 0.56 && d < 0.60)){
        ctx.fillStyle = hour.ring;
        ctx.fillRect(x, y, 1, 1);
      }
      // Twelve spokes, between the rings only, so the middle stays clear enough
      // to stand on and be seen against.
      if(d > 0.60 && d < 0.93){
        const a = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) * 12;
        if(Math.abs(a - Math.round(a)) < 0.055){
          ctx.fillStyle = hour.ring;
          ctx.fillRect(x, y, 1, 1);
        }
      }
      // A green heart, because the sun in this setting is something you grow by.
      if(d < 0.16 && (hash2(x, y) & 3) !== 0){
        ctx.fillStyle = hour.moss;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  /* What is growing through it: tufts at the edges of the plaza and a scatter
     of small blooms. The floor is kept, not abandoned — sparse in the middle
     where the fight happens, thick at the margins where nobody walks. */
  for(let i = 0; i < 150; i++){
    const seed = hash2(i * 7 + 1, round * 29 + 13);
    const x = seed % width;
    const y = hedgeFoot + 2 + (seed >> 8) % Math.max(1, depth - 3);
    // Density falls off toward the middle of the field.
    const edge = Math.abs(x - width / 2) / (width / 2);
    if(((seed >> 4) & 15) / 16 > 0.25 + edge * 0.75) continue;
    const near = (y - hedgeFoot) / Math.max(1, depth);
    const tall = 1 + Math.round(near * 3);
    ctx.fillStyle = hour.moss;
    ctx.fillRect(x, y - tall, 1, tall);
    if(tall > 2){
      ctx.fillRect(x - 1, y - tall + 1, 1, 1);
      ctx.fillRect(x + 1, y - tall + 2, 1, 1);
    }
    if(((seed >> 12) & 7) === 0){
      ctx.fillStyle = hour.bloom;
      ctx.fillRect(x, y - tall - 1, 1, 1);
    }
  }

  /* Two planters at the mouth of the stage, one each side, framing the fight
     the way wings frame a set. Near, so they are the darkest and largest
     growing things in the picture. */
  for(const side of [0, 1]){
    const x = side ? width - 14 : 6;
    const base = height - 1;
    ctx.fillStyle = hour.seam;
    ctx.fillRect(x, base - 7, 9, 7);
    ctx.fillStyle = hour.floorNear;
    ctx.fillRect(x + 1, base - 6, 7, 1);
    for(let i = 0; i < 22; i++){
      const seed = hash2(x + i, side * 71 + 3);
      const sx = x + 1 + (seed % 7);
      const h = 4 + (seed % 9);
      ctx.fillStyle = (seed & 1) ? hour.mid : hour.moss;
      ctx.fillRect(sx, base - 7 - h, 1, h);
      if((seed & 7) === 0){
        ctx.fillStyle = hour.bloom;
        ctx.fillRect(sx, base - 8 - h, 1, 1);
      }
    }
  }
}

/* ---- what moves ---------------------------------------------------------- */

/* Drifting seeds, over the top of everything and under nothing.
 *
 * Painted live rather than baked, because they are the one thing on this stage
 * that is supposed to move, and they are cheap: a couple of dozen single
 * pixels. They are what keeps a standoff — where nothing on the field goes
 * anywhere — from looking like a paused game.
 */
export function driftSeeds(ctx, { width, height, round, now, top = 0, count = 22 }){
  const hour = hourFor(round);
  ctx.fillStyle = hour.bloom;
  for(let i = 0; i < count; i++){
    const seed = hash2(i * 31 + 7, 11);
    const speed = 5 + (seed % 9);
    const sway = 5 + (seed % 11);
    const x = ((seed % width) + (now / 1000) * speed) % (width + 20) - 10;
    const y = ((seed >> 6) % height + Math.sin(now / 1400 + i) * sway + height) % height;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x | 0, (top + y) | 0, 1, 1);
  }
  ctx.globalAlpha = 1;
}
