/* The title screen, as a place rather than a picture.
 *
 * What a landing page for this game has to answer is "what do you do in it",
 * and the honest answer is: you walk a ruin and pick things up. So the screen
 * is not an illustration of that — it is that, running. The site under the
 * logo comes out of `generateTerrain`, the herbs out of `spawnItems`, and the
 * three heroes walk to them along routes `pathTo` found, which is the same
 * code the build phase uses. A visitor is watching the game play itself.
 *
 * That also means it cannot go stale. A new class, a new terrain kind, a new
 * material — anything added to content.js and art.js shows up here without
 * anybody remembering to update a mock-up, which is the failure mode every
 * hand-drawn title screen has.
 *
 * Nothing here writes game state or talks to a room. It owns one canvas and a
 * requestAnimationFrame loop, and everything it knows is regenerated from a
 * seed on start().
 */

import {
  PALETTE, HERO_ART, TERRAIN_VARIANTS, TERRAIN_ART, TILE,
  PROP_ART, TREE_ART, FIRE_ART, MATERIAL_ART, SALVAGE_ART, PAGES_ART,
} from './art.js';
/* The font and its own sixteen-colour palette. Text keys are pixel.js keys and
   sprite keys are art.js keys — the two tables are not the same table, and
   `hex()` throws on a key it does not hold, so anything passed to drawText has
   to come from the list in pixel.js rather than from the one above. */
import { drawTextOutlined, textWidth } from './pixel.js';
import {
  MAP_W, MAP_H, MATERIALS, SALVAGE, PAGES,
  CAMP_X, CAMP_Y, TENT_Y,
  generateTerrain, spawnItems, spawnTile, pathTo, tileAt,
  seededRandom, playableClasses,
} from './content.js';

export const SCENE_W = MAP_W * TILE;      // 480

/* The sky the logo sits on, and the reason it exists.
 *
 * The first cut put the title in a band straight over the site, and the site's
 * camp is dead centre of the map — so the tent, the fire and the party around
 * it were all behind the words. The nicest thing in the scene was the thing the
 * title covered.
 *
 * So the ground is pushed down and the space above it is sky. The logo gets
 * somewhere of its own to live, the camp clears the words, and the seam between
 * the two reads as a horizon rather than as a crop. What falls off the bottom
 * is the last few rows of ground, which is the cheapest thing on the map.
 */
export const SKY_H = 86;

/* How many rows of the site fit under the sky. The map is seventeen rows and
   the frame has room for eleven, so the scene shows the top of the site — camp
   included, since the camp is stamped at the middle — and the rest falls off.
   Everything the scene spawns and everything the party walks to is kept inside
   this band, or a hero strolls out of frame to gather something nobody can see
   and the screen is two people and a gap. */
export const VISIBLE_ROWS = 11;
export const SCENE_H = SKY_H + VISIBLE_ROWS * TILE;

/* How much of a site a title screen should put out. More than a round does —
   the scene is a shop window, and a walker with nothing to walk to is a walker
   standing still. */
/* Asked for generously because the band above throws some of it away: what is
   left after the filter is what the party actually has to walk to. */
const SPAWNS = { herbs: 10, salvage: 8, pages: 6 };

/* Only what the frame can show. */
const inFrame = node => node.y < VISIBLE_ROWS;

/* Tiles a second. Slow enough to read as walking rather than sliding, fast
   enough that a visitor sees somebody arrive somewhere before they leave. */
const SPEED = 3.2;
const GATHER_MS = 620;

/* ---- the same small helpers the game's renderer uses --------------------- */

/* Stable per-tile randomness. Hashed from the coordinates rather than rolled,
   so the ground varies from tile to tile and never shimmers between frames. */
const hash2 = (x, y) => {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0);
};

function blit(ctx, rows, x, y, flip = false, lift = 0, split = 0){
  for(let r = 0; r < rows.length; r++){
    const row = rows[r];
    const w = row.length;
    const dy = (lift && r < split) ? -lift : 0;
    for(let c = 0; c < w; c++){
      const key = row[flip ? w - 1 - c : c];
      if(key === '.' || key === ' ') continue;
      ctx.fillStyle = PALETTE[key];
      ctx.fillRect((x + c) | 0, (y + r + dy) | 0, 1, 1);
    }
  }
}

const tileArt = (kind, x, y) => {
  const cuts = TERRAIN_VARIANTS[kind];
  if(!cuts || !cuts.length) return TERRAIN_ART[kind] || TERRAIN_ART.grass;
  return cuts[hash2(x * 3 + 11, y * 3 + 7) % cuts.length];
};

/* Which kinds feather over which. Grass creeps onto everything, water is
   crept on by everything — the same ordering the build map uses, so the two
   screens agree about what a shoreline looks like. */
const FRINGE = {
  grass:   { over: 3, keys: ['g', 'G'] },
  tree:    { over: 3, keys: ['g', 'G'] },
  hill:    { over: 2, keys: ['t', 'T'] },
  floor:   { over: 1, keys: ['M'] },
  rubble:  { over: 1, keys: ['x'] },
  water:   { over: 0, keys: ['b'] },
  crevice: { over: 0, keys: ['x'] },
};

function paintGround(ctx, terrain){
  for(let y = 0; y < MAP_H; y++){
    for(let x = 0; x < MAP_W; x++){
      const kind = tileAt(terrain, x, y) || 'grass';
      blit(ctx, tileArt(TERRAIN_VARIANTS[kind] ? kind : 'grass', x, y), x * TILE, y * TILE);
    }
  }
  // The edges, softened. A hard tile boundary between grass and water is what
  // makes a generated map read as a spreadsheet.
  for(let y = 0; y < MAP_H; y++){
    for(let x = 0; x < MAP_W; x++){
      const kind = tileAt(terrain, x, y) || 'grass';
      const mine = FRINGE[kind];
      if(!mine) continue;
      for(const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
        const ny = y + dy;
        if(ny < 0 || ny >= MAP_H) continue;
        const other = tileAt(terrain, x + dx, ny);
        if(!other || other === kind) continue;
        if((FRINGE[other] || { over: 0 }).over >= mine.over) continue;
        const seed = hash2(x * 4 + dx + 2, y * 4 + dy + 2);
        const bx = (x + dx) * TILE, by = ny * TILE;
        for(let i = 0; i < TILE; i++){
          const roll = (seed >> (i % 28)) & 7;
          if(roll < 3) continue;
          const depth = 1 + (roll & 1) + ((roll >> 1) & 1);
          ctx.fillStyle = PALETTE[mine.keys[i % mine.keys.length]];
          for(let d = 0; d < depth; d++){
            if(dx === 1) ctx.fillRect(bx + d, by + i, 1, 1);
            else if(dx === -1) ctx.fillRect(bx + TILE - 1 - d, by + i, 1, 1);
            else if(dy === 1) ctx.fillRect(bx + i, by + d, 1, 1);
            else ctx.fillRect(bx + i, by + TILE - 1 - d, 1, 1);
          }
        }
      }
    }
  }
}

const shadow = (ctx, cx, groundY, width) => {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect((cx - width / 2 + 2) | 0, groundY | 0, Math.max(2, width - 4), 2);
};

/* ---- the scene ---------------------------------------------------------- */

export function createTitleScene(canvas, { reducedMotion = () => false } = {}){
  canvas.width = SCENE_W;
  canvas.height = SCENE_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // The ground is ~130,000 fillRects and never changes, so it is painted once
  // onto an offscreen canvas and blitted per frame. Without this the scene
  // costs more to draw than the game does.
  const ground = document.createElement('canvas');
  ground.width = SCENE_W;
  ground.height = SCENE_H;
  const gctx = ground.getContext('2d');
  gctx.imageSmoothingEnabled = false;

  let terrain = [];
  let nodes = [];
  let walkers = [];
  let motes = [];
  let pollen = [];
  let random = seededRandom(1);
  let handle = 0;
  let now = 0;
  let last = 0;

  /* A fresh ruin. Seeded from the clock so a visitor who comes back twice does
     not get the same site — the one place in this codebase where non-determinism
     is the point, because nothing here has to replay. */
  function build(seed = Date.now()){
    random = seededRandom(seed >>> 0);
    terrain = generateTerrain(random);
    nodes = spawnItems(terrain, random, SPAWNS).filter(inFrame);

    walkers = playableClasses().map((cls, i) => {
      const at = spawnTile(terrain, i + 1);
      return {
        cls,
        art: HERO_ART[cls.art],
        x: at.x, y: at.y,          // tiles, fractional while walking
        path: [],
        node: null,
        face: 1,
        until: 0,                  // when the current gather finishes
        bob: i * 1.7,
      };
    }).filter(w => w.art);

    motes = [];
    // Drifting pollen, over the whole site. Cheap, and it is what stops a
    // still moment on this screen from looking like a paused game.
    pollen = Array.from({ length: 26 }, (_, i) => ({
      x: (hash2(i, 3) % SCENE_W),
      y: (hash2(i, 9) % SCENE_H),
      speed: 4 + (hash2(i, 17) % 7),
      sway: 6 + (hash2(i, 23) % 10),
      phase: (hash2(i, 31) % 628) / 100,
    }));

    gctx.clearRect(0, 0, SCENE_W, SCENE_H);
    paintGround(gctx, terrain);
  }

  /* What a walker is heading for: the nearest thing still on the ground that
     nobody else has claimed, and that there is a route to. */
  function retarget(walker){
    const taken = new Set(walkers.map(w => w.node && w.node.id).filter(Boolean));
    const from = { x: Math.round(walker.x), y: Math.round(walker.y) };
    const wanted = nodes
      .filter(n => !n.taken && !taken.has(n.id))
      .sort((a, b) =>
        (Math.abs(a.x - from.x) + Math.abs(a.y - from.y))
        - (Math.abs(b.x - from.x) + Math.abs(b.y - from.y)));

    for(const node of wanted){
      const path = pathTo(terrain, [], from, { x: node.x, y: node.y });
      // Both ends being in frame is not enough — the shortest way round a pond
      // can dip below the fold and take the walker with it.
      if(path && path.length && path.every(inFrame)){
        walker.node = node;
        walker.path = path;
        return;
      }
    }
    // Nothing reachable left: wander back toward the fire rather than freeze.
    const home = pathTo(terrain, [], from, spawnTile(terrain, 1));
    walker.node = null;
    walker.path = home && home.length ? home : [];
  }

  function gathered(walker){
    const node = walker.node;
    if(!node) return;
    node.taken = true;
    const colour = node.kind === 'herb' ? (MATERIALS[node.material] || {}).colour
      : node.kind === 'salvage' ? (SALVAGE[node.salvage] || {}).colour
      : PAGES.colour;
    // What a pickup looks like from across the screen: three specks off the
    // ground, in the colour of the thing that was picked up.
    for(let i = 0; i < 3; i++){
      motes.push({
        x: node.x * TILE + TILE / 2 + ((hash2(i, node.x + node.y) % 9) - 4),
        y: node.y * TILE + TILE / 2 + SKY_H,
        born: now,
        key: colour || 'w',
      });
    }
    walker.node = null;
    walker.until = now + GATHER_MS;

    // Keep the site stocked. A title screen that runs out of herbs becomes a
    // title screen of three people standing still.
    if(nodes.filter(n => !n.taken).length < 4){
      nodes = nodes.filter(n => !n.taken)
        .concat(spawnItems(terrain, random, SPAWNS).filter(inFrame));
    }
  }

  function step(dt){
    for(const walker of walkers){
      if(now < walker.until) continue;               // mid-gather, standing still

      if(!walker.path.length){
        if(walker.node) gathered(walker);
        else retarget(walker);
        continue;
      }

      const next = walker.path[0];
      const dx = next.x - walker.x;
      const dy = next.y - walker.y;
      const dist = Math.hypot(dx, dy);
      const move = SPEED * dt;
      if(dist <= move){
        walker.x = next.x;
        walker.y = next.y;
        walker.path.shift();
      }else{
        walker.x += (dx / dist) * move;
        walker.y += (dy / dist) * move;
      }
      if(Math.abs(dx) > 0.01) walker.face = dx > 0 ? 1 : -1;
    }

    motes = motes.filter(m => now - m.born < 900);
    for(const p of pollen){
      p.y -= p.speed * dt;
      if(p.y < -4){ p.y = SCENE_H + 4; p.x = (p.x * 7 + 131) % SCENE_W; }
    }
  }

  /* ---- painting -------------------------------------------------------- */

  function paint(){
    ctx.clearRect(0, 0, SCENE_W, SCENE_H);
    sky();
    ctx.drawImage(ground, 0, SKY_H);

    /* Everything with a footprint goes in one list and is sorted by the ground
       line it stands on, so a hero one row behind a tree goes in behind it.
       Sorting by tile row could not compare a canopy with a person; sorting on
       the floor they share can. */
    const standing = [];
    // Everything below is written in map pixels; the sky is what separates map
    // pixels from canvas pixels, and this is the one place that conversion
    // happens.
    const stand = (mapY, art, x, extra = {}) => {
      const groundY = mapY + SKY_H;
      standing.push({ groundY, art, x, top: groundY - art.length, ...extra });
    };

    const tent = PROP_ART.tent;
    stand((TENT_Y + 2) * TILE, tent, (CAMP_X + 0.5) * TILE - tent[0].length / 2, { noShadow: true });

    const fire = FIRE_ART[Math.floor(now / 130) % FIRE_ART.length];
    stand((CAMP_Y + 1) * TILE, fire, (CAMP_X + 0.5) * TILE - fire[0].length / 2,
      { noShadow: true, glow: true });

    for(let ty = 0; ty < MAP_H; ty++){
      for(let tx = 0; tx < MAP_W; tx++){
        if(tileAt(terrain, tx, ty) !== 'tree') continue;
        const art = TREE_ART[hash2(tx * 5 + 3, ty * 5 + 9) % TREE_ART.length];
        stand((ty + 1) * TILE, art, (tx + 0.5) * TILE - art[0].length / 2);
      }
    }

    for(const node of nodes){
      if(node.taken) continue;
      const art = node.kind === 'herb' ? MATERIAL_ART[node.material]
        : node.kind === 'salvage' ? SALVAGE_ART[node.salvage]
        : PAGES_ART;
      if(!art) continue;
      // Herbs sway; a crate does not. The bob is hashed off the tile so two
      // neighbouring plants are never in step.
      const sway = node.kind === 'herb'
        ? Math.round(Math.sin(now / 700 + hash2(node.x, node.y) % 6) * 1)
        : 0;
      stand((node.y + 1) * TILE, art,
        (node.x + 0.5) * TILE - art[0].length / 2 + sway, { noShadow: true });
    }

    for(const walker of walkers){
      const rows = walker.art.rows;
      // A slow rise and fall through the torso rows: the walkers are the only
      // thing on screen that breathes, so it reads as them being alive rather
      // than as the picture wobbling.
      const lift = Math.sin(now / 520 + walker.bob) > 0.7 ? 1 : 0;
      stand((walker.y + 1) * TILE, rows,
        walker.x * TILE + (TILE - rows[0].length) / 2,
        { flip: walker.face === -1, lift, split: walker.art.split, walker });
    }

    standing.sort((a, b) => a.groundY - b.groundY);
    for(const thing of standing){
      if(thing.glow) firelight(thing.x + thing.art[0].length / 2, thing.groundY);
      if(!thing.noShadow) shadow(ctx, thing.x + thing.art[0].length / 2, thing.groundY - 1, thing.art[0].length);
      blit(ctx, thing.art, thing.x, thing.top, thing.flip, thing.lift || 0, thing.split || 0);
      // A ring of light while somebody is bent over something.
      if(thing.walker && now < thing.walker.until) sparkle(thing.x + thing.art[0].length / 2, thing.groundY - 6);
    }

    for(const m of motes){
      const t = (now - m.born) / 900;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.fillStyle = PALETTE[m.key] || PALETTE.w;
      ctx.fillRect(m.x | 0, (m.y - t * 22) | 0, 2, 2);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(255,232,160,0.5)';
    for(const p of pollen){
      const x = p.x + Math.sin(now / 900 + p.phase) * p.sway;
      ctx.fillRect(x | 0, p.y | 0, 1, 1);
    }
    ctx.globalAlpha = 1;

    vignette();
    banner();
  }

  /* Warm light off the fire, so the camp is the brightest thing on the site. */
  function firelight(cx, cy){
    const flicker = 0.9 + Math.sin(now / 90) * 0.1;
    for(let r = 46; r > 0; r -= 8){
      ctx.globalAlpha = 0.05 * flicker;
      ctx.fillStyle = '#ffb35c';
      ctx.beginPath();
      ctx.arc(cx, cy - 4, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function sparkle(cx, cy){
    ctx.fillStyle = PALETTE.Y;
    for(let k = 0; k < 4; k++){
      const a = now / 160 + k * Math.PI / 2;
      ctx.fillRect((cx + Math.cos(a) * 7) | 0, (cy + Math.sin(a) * 4) | 0, 1, 1);
    }
  }

  /* Corners pulled down, so the eye lands in the middle where the camp is. */
  function vignette(){
    const edge = ctx.createRadialGradient(
      SCENE_W / 2, SCENE_H / 2, SCENE_H * 0.3,
      SCENE_W / 2, SCENE_H / 2, SCENE_H * 0.85);
    edge.addColorStop(0, 'rgba(24,12,4,0)');
    edge.addColorStop(1, 'rgba(24,12,4,0.55)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  }

  /* A 4x4 ordered dither, used for the sky bands and the sun's edge.
   *
   * A CSS gradient or a translucent rectangle over pixel art reads as a
   * browser drawing on top of a game. A Bayer matrix reads as part of it,
   * because it is made of the same pixels at the same scale as everything
   * under it — which is how every console this game is pretending to run on
   * did its gradients.
   */
  const BAYER = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];

  /* Dusk over the ruin: five bands, dithered between each pair, warmest at the
     horizon. The sun sits low and just off centre so the logo does not land in
     a halo, and a treeline runs along the seam where the ground begins. */
  const DUSK = ['#2b1b3f', '#5a2f4a', '#93463f', '#c76a34', '#e79a3c'];

  function sky(){
    const bands = DUSK.length - 1;
    for(let y = 0; y < SKY_H; y++){
      const t = (y / (SKY_H - 1)) * bands;
      const i = Math.min(bands - 1, Math.floor(t));
      const mix = t - i;                       // 0 at this band, 1 at the next
      for(let x = 0; x < SCENE_W; x++){
        const over = BAYER[y & 3][x & 3] / 16 < mix;
        ctx.fillStyle = over ? DUSK[i + 1] : DUSK[i];
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // The sun: big, centred and mostly below the horizon, so the logo sits in
    // front of it. Off to one side it fought the words for the eye; behind and
    // under them it is what the words are standing on.
    const sunX = SCENE_W / 2, sunY = SKY_H - 4, sunR = 42;
    for(let y = -sunR; y <= sunR; y++){
      for(let x = -sunR; x <= sunR; x++){
        const py = sunY + y;
        if(py < 0 || py >= SKY_H) continue;
        const d = Math.hypot(x, y) / sunR;
        if(d > 1) continue;
        if(d > 0.6 && BAYER[(y + 64) & 3][(x + 64) & 3] / 16 < (d - 0.6) / 0.4) continue;
        ctx.fillStyle = d < 0.5 ? '#ffd98a' : '#ffb45a';
        ctx.fillRect((sunX + x) | 0, py | 0, 1, 1);
      }
    }

    // Clouds: long thin bars, drifting slowly, lit from below by the sun. Two
    // parallax rates, because one rate reads as a texture sliding rather than
    // as weather.
    for(let i = 0; i < 7; i++){
      const seed = hash2(i * 13 + 5, 61);
      const speed = 3 + (seed % 5);
      const w = 26 + (seed % 46);
      const y = 8 + (seed % (SKY_H - 34));
      const x = ((seed % SCENE_W) - (now / 1000) * speed) % (SCENE_W + w + 40);
      const at = x < -w ? x + SCENE_W + w + 40 : x;
      ctx.fillStyle = y > SKY_H * 0.55 ? '#f0a85e' : '#7d3f52';
      ctx.fillRect(at | 0, y, w, 2);
      ctx.fillRect((at + 6) | 0, y - 2, Math.max(4, w - 16), 2);
    }

    // The treeline along the horizon, so the ground does not simply begin.
    // Hashed per column and drawn downward from the seam, which puts it behind
    // the first row of tiles rather than on top of them.
    for(let x = 0; x < SCENE_W; x++){
      const h = 4 + (hash2(x >> 2, 7) % 7) + (hash2(x >> 3, 11) % 4);
      ctx.fillStyle = '#1d3a1f';
      ctx.fillRect(x, SKY_H - h, 1, h);
      if(h > 8){
        ctx.fillStyle = '#2a5127';
        ctx.fillRect(x, SKY_H - h, 1, 2);
      }
    }
  }

  /* The logo. It sits on the sky rather than on a band over the site, so there
     is nothing to fade out and nothing covering the camp. */
  function banner(){
    const title = 'GOOD VIBES';
    const scale = 6;
    drawTextOutlined(ctx, title, Math.round((SCENE_W - textWidth(title, scale)) / 2), 6, 'y', scale);

    const sub = 'A CO-OP SOLARPUNK ROGUELIKE';
    drawTextOutlined(ctx, sub, Math.round((SCENE_W - textWidth(sub, 2)) / 2), 56, 'w', 2);

    // Blinking, because that is what a title screen does, and because it is the
    // one thing on the page that says the picture is live.
    if(reducedMotion() || Math.floor(now / 600) % 2 === 0){
      // Separated with dashes rather than a middle dot: the 5x7 font has no
      // glyph for one and falls back to a question mark, which turns the tag
      // line into a quiz.
      const call = 'FIVE CLASSES - FOUR ROUNDS - ONE RUIN';
      drawTextOutlined(ctx, call, Math.round((SCENE_W - textWidth(call, 1)) / 2), SCENE_H - 12, 'y', 1);
    }
  }

  /* ---- the loop -------------------------------------------------------- */

  function frame(stamp){
    handle = 0;
    const dt = last ? Math.min(0.05, (stamp - last) / 1000) : 0;
    last = stamp;
    now = stamp;
    step(dt);
    paint();
    if(!document.hidden) schedule();
  }

  const schedule = () => { if(!handle) handle = requestAnimationFrame(frame); };

  return {
    /* One still frame under reduced motion: the request is to hold still, not
       to go dark, so the site, the party and the logo are all still drawn. */
    start(seed){
      build(seed);
      if(reducedMotion()){
        now = 0;
        // Walk everyone most of the way to their first find, so the still frame
        // is a party mid-errand rather than a party standing on the camp.
        for(const w of walkers){ retarget(w); for(let i = 0; i < 6; i++) step(0.12); }
        paint();
        return;
      }
      schedule();
    },
    stop(){
      if(handle) cancelAnimationFrame(handle);
      handle = 0;
    },
    /* A visitor who has been looking at one ruin for a while gets another. */
    reroll(){ build(Date.now()); if(reducedMotion()) paint(); },
  };
}
