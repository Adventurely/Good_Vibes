/* Map generation: terrain, camp, items and combat ground. */

import {
  CAMP_RADIUS, CAMP_X, CAMP_Y, HERB_COUNT, MAP_H, MAP_W, TENT_Y, TERRAIN, inBounds, inCamp,
  tileIndex
} from './grid.js';
import { materialFor } from './lookups.js';
import { MATERIALS, salvageFor } from './materials.js';
import { SPAWNS } from './pages.js';
import { draw, reachableFrom, shuffle, walkableAt } from './rules.js';

function blob(cells, random, kind, size, height = MAP_H){
  let x = Math.floor(random() * MAP_W);
  let y = Math.floor(random() * height);
  for(let step = 0; step < size; step++){
    if(x >= 0 && y >= 0 && x < MAP_W && y < height) cells[y * MAP_W + x] = kind;
    const dir = Math.floor(random() * 4);
    if(dir === 0) x += 1;
    else if(dir === 1) x -= 1;
    else if(dir === 2) y += 1;
    else y -= 1;
  }
}

/* Terrain only. Herbs are a separate pass because they are reseeded every
   cycle and the ground is not. */
export function generateTerrain(random){
  const cells = new Array(MAP_W * MAP_H).fill('grass');

  // Order matters and is fixed: water first so rubble can silt up its edge,
  // hills and crevices next as the ground's own shape, floor last so a slab
  // reads as something built on top of the ruin, trees last of all so they
  // stand on whatever ended up under them being grass.
  //
  // Sized to leave the map mostly open. Obstacles are scenery here — they make
  // the ground have a shape — and a site you cannot fit a base on is a site
  // nobody wants to have rolled. largestBuildableArea is what holds that line.
  blob(cells, random, 'water', 30);
  blob(cells, random, 'water', 18);
  blob(cells, random, 'hill', 24);
  blob(cells, random, 'hill', 14);
  blob(cells, random, 'crevice', 10);
  blob(cells, random, 'rubble', 20);
  blob(cells, random, 'rubble', 12);
  blob(cells, random, 'floor', 24);
  blob(cells, random, 'floor', 14);

  // Two smoothing passes before the trees go in. A raw drunkard's walk leaves
  // single-tile spurs and pinholes, and those hard right angles are what read
  // as "blocks" instead of landscape. Majority-vote smoothing rounds a blob
  // into something deposition might have made. Deterministic — no randomness —
  // so it cannot cost the generator its replay guarantee.
  smooth(cells);
  smooth(cells);

  // Trees are dotted, not blobbed — a copse is single trunks with light
  // between them, and a solid mass of them would read as one green rock.
  //
  // Nothing grows near the camp. A tree is drawn as a canopy three tiles tall,
  // and one standing south of the tent sorts in front of it and swallows the
  // whole camp — which happened on about half of all sites. The margin is what
  // a canopy can reach from outside it. Tested on the same draw, so the number
  // of calls to random() is unchanged and the replay guarantee holds.
  for(let i = 0; i < 14; i++){
    const index = Math.floor(random() * cells.length);
    const x = index % MAP_W, y = Math.floor(index / MAP_W);
    if(cells[index] === 'grass' && !inCamp(x, y, 2)) cells[index] = 'tree';
  }

  // The camp goes in last and clears its own ground, because the ruin does not
  // get a vote on where home is. Without this the centre rolled into water or
  // a crevice on better than one site in ten and the tent floated in a pond.
  //
  // Not one call to random(): the stamp is the same nine-plus-sixteen cells on
  // every seed, so the map a code produces is still the map it always produced
  // everywhere else on it.
  stampCamp(cells);

  return cells;
}

/* The camp footprint: a tent above a clearing, with the fire in the middle of
 * the clearing.
 *
 * The clearing is what the party spawns onto and what makes the fire reachable
 * from every side — a camp ringed by water would block half the approaches and
 * put seats on the far side of a pond from each other.
 */
function stampCamp(cells){
  for(let y = TENT_Y - 1; y <= CAMP_Y + CAMP_RADIUS; y++){
    for(let x = CAMP_X - CAMP_RADIUS; x <= CAMP_X + CAMP_RADIUS; x++){
      if(!inBounds(x, y)) continue;
      const underTent = Math.abs(x - CAMP_X) <= 1 && Math.abs(y - TENT_Y) <= 1;
      const isFire = x === CAMP_X && y === CAMP_Y;
      cells[tileIndex(x, y)] = underTent ? 'tent' : isFire ? 'fire' : 'camp';
    }
  }
}

/* One cellular pass: a tile surrounded mostly by some other kind becomes that
   kind. Ties keep the tile, which is what stops the map draining to all-grass
   over repeated passes. */
function smooth(cells){
  const before = cells.slice();
  for(let y = 0; y < MAP_H; y++){
    for(let x = 0; x < MAP_W; x++){
      const counts = {};
      for(let dy = -1; dy <= 1; dy++){
        for(let dx = -1; dx <= 1; dx++){
          if(!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if(!inBounds(nx, ny)) continue;
          const kind = before[tileIndex(nx, ny)];
          counts[kind] = (counts[kind] || 0) + 1;
        }
      }
      const self = before[tileIndex(x, y)];
      let best = self, bestCount = counts[self] || 0;
      for(const [kind, count] of Object.entries(counts)){
        if(count > bestCount + 1){ best = kind; bestCount = count; }
      }
      cells[tileIndex(x, y)] = best;
    }
  }
}

/* The surge's ground. Same generator family, different mix: mostly open so
   the wave has somewhere to come from, water and crevices as the walls the
   party fights around, no trees to hide the thing walking at you. */
/* A fight is a lane, not a field.
 *
 * The build map is somewhere you walk around; combat is a wave closing from
 * one side, and rendering that on a full-height board spent most of the screen
 * on ground nobody crosses — and pushed the cards off the bottom of it. Eight
 * rows is the band the wave actually walks.
 */
export const COMBAT_H = 8;

export function generateCombatTerrain(random){
  const cells = new Array(MAP_W * COMBAT_H).fill('floor');
  blob(cells, random, 'grass', 26, COMBAT_H);
  blob(cells, random, 'grass', 18, COMBAT_H);
  blob(cells, random, 'water', 10, COMBAT_H);
  blob(cells, random, 'crevice', 8, COMBAT_H);
  blob(cells, random, 'rubble', 10, COMBAT_H);
  blob(cells, random, 'hill', 8, COMBAT_H);
  return cells;
}

/* The biggest run of connected buildable tiles, counted orthogonally.
 *
 * "Enough buildable tiles" is the wrong question — thirty tiles in three
 * pockets separated by water is not somewhere you can put a base. This counts
 * the largest single pocket, which is the number a builder actually has.
 */
export function largestBuildableArea(terrain){
  const seen = new Uint8Array(terrain.length);
  let best = 0;

  for(let start = 0; start < terrain.length; start++){
    if(seen[start] || !TERRAIN[terrain[start]] || !TERRAIN[terrain[start]].build) continue;

    let size = 0;
    const queue = [start];
    seen[start] = 1;
    while(queue.length){
      const index = queue.pop();
      size += 1;
      const x = index % MAP_W;
      const y = Math.floor(index / MAP_W);
      for(const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
        const nx = x + dx, ny = y + dy;
        if(!inBounds(nx, ny)) continue;
        const next = tileIndex(nx, ny);
        if(seen[next]) continue;
        const kind = terrain[next];
        if(!TERRAIN[kind] || !TERRAIN[kind].build) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    if(size > best) best = size;
  }
  return best;
}

/* Scatter what the site holds across the ground.
 *
 * Three kinds of node, one shape: { kind, x, y, taken } plus what it yields.
 * Herbs land on growable tiles only; salvage caches and page caches land on
 * anything walkable, because a crate does not need soil. Tiles are drawn
 * without replacement, so two nodes can never occupy one tile — a duplicate
 * would render as one sprite and gather as two, which looks like a lost click.
 *
 *   herb     { material }  what MATERIALS entry, via the rarity weights
 *   salvage  { salvage }   what SALVAGE entry, CACHE_YIELD.salvage pieces
 *   pages    { }           CACHE_YIELD.pages spell pages
 */
export function spawnItems(terrain, random, spawns = SPAWNS, buildings = []){
  // Only where a hero can actually get to. Terrain rolls islands — a pocket of
  // grass behind a pond — and a Cellsap on one is a node the player can see,
  // walk at, and never reach. With five herbs on a site, losing one to an
  // island is a fifth of the round's brewing.
  //
  // Buildings count as blocked, which does two jobs at once on a site that
  // persists: nothing sprouts underneath a structure, and a pocket that this
  // round's building walled off stops being somewhere the crop can land.
  const reachable = reachableFrom(terrain, buildings, spawnTile(terrain, 0, buildings));

  const growable = [];
  const walkable = [];
  for(let i = 0; i < terrain.length; i++){
    const tile = TERRAIN[terrain[i]];
    if(!tile || !reachable.has(i)) continue;
    if(tile.grows) growable.push(i);
    if(tile.walk) walkable.push(i);
  }

  const used = new Set();
  const draw = pool => {
    while(pool.length){
      const [index] = pool.splice(Math.floor(random() * pool.length), 1);
      if(!used.has(index)){ used.add(index); return index; }
    }
    return -1;
  };

  const nodes = [];
  let serial = 0;
  const place = (pool, make) => {
    const index = draw(pool);
    if(index < 0) return;
    nodes.push({
      id: `n${serial++}`,
      x: index % MAP_W,
      y: Math.floor(index / MAP_W),
      taken: false,
      ...make(),
    });
  };

  /* Herbs cover every material before they roll for any of them.
   *
   * Six nodes drawn purely by weight regularly grows a site with no Dewglass
   * and no Rustbloom on it, and every recipe needs one or the other — a round
   * where nothing can be brewed at all, which is the worst thing scarcity can
   * do. One of each material first, then weight for whatever is left over, so
   * every recipe is always *possible* and never all of them affordable.
   */
  const herbs = Object.keys(MATERIALS);
  const guaranteed = shuffle(herbs, random).slice(0, spawns.herbs);
  for(let i = 0; i < spawns.herbs; i++){
    const material = guaranteed[i] || materialFor(random());
    place(growable, () => ({ kind: 'herb', material }));
  }
  for(let i = 0; i < spawns.salvage; i++) place(walkable, () => ({ kind: 'salvage', salvage: salvageFor(random()) }));
  for(let i = 0; i < spawns.pages; i++) place(walkable, () => ({ kind: 'pages' }));

  return nodes;
}

/* Kept for the build-map tests and any caller that only wants herbs; the
   real spawner is spawnItems. */
export function spawnHerbs(terrain, random, count = HERB_COUNT){
  return spawnItems(terrain, random, { herbs: count, salvage: 0, pages: 0 });
}

/* The whole ground state for a cycle. The room calls this with its own seeded
   generator and sends the result down; the client never calls it during real
   play, because a client that generated its own map would be a second source
   of truth about where the Cellsap is. */
export function generateMap(random){
  const terrain = generateTerrain(random);
  return { terrain, nodes: spawnItems(terrain, random) };
}

/* A fresh crop on ground that is already there.
 *
 * The site is generated once a run and kept — the slab you cleared and the
 * panel you bolted down are still there next round, which is the whole reason
 * to build anything. Only what grows is reseeded.
 */
export function respawnItems(terrain, buildings, random, spawns = SPAWNS){
  return spawnItems(terrain, random, spawns, buildings);
}

/* A player's walkable start: the nth place round the fire.
 *
 * `offset` used to slide the whole search window sideways, which strung the
 * party out in a line east of centre — seat five could open the round seven
 * tiles from camp with nobody in sight. It is a seat index now: candidates are
 * ordered by ring out from the camp and then clockwise around it, so five
 * players stand round the tent the way five people stand round a fire.
 *
 * Pure in the terrain — no randomness — so the replay guarantee is untouched,
 * and the signature is unchanged so the deployed room needs no re-port.
 */
export function spawnTile(terrain, offset = 0, buildings = []){
  const seats = [];
  for(let y = 0; y < MAP_H; y++){
    for(let x = 0; x < MAP_W; x++){
      if(!walkableAt(terrain, buildings, x, y)) continue;
      const dx = x - CAMP_X, dy = y - CAMP_Y;
      seats.push({ x, y, ring: Math.max(Math.abs(dx), Math.abs(dy)), angle: Math.atan2(dy, dx) });
    }
  }
  // Nothing standable anywhere: hand back the camp centre rather than throw.
  // It is not walkable, but neither is anything else, and a caller reading
  // {x,y} is better served by a number than by undefined.
  if(!seats.length) return { x: CAMP_X, y: CAMP_Y };

  seats.sort((a, b) => a.ring - b.ring || a.angle - b.angle);
  const seat = seats[offset % seats.length];
  return { x: seat.x, y: seat.y };
}
