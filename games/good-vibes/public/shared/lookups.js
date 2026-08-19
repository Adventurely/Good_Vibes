/* Lookups and economy helpers shared by everything above. */

import { BUILDINGS } from './buildings.js';
import { CLASSES } from './classes.js';
import { TERRAIN, tileAt } from './grid.js';
import { MATERIALS, RECIPES, salvageFor } from './materials.js';


/* Pure lookups. Small enough to be obviously correct, and shared so the client
   and the engine cannot disagree about whether a thing can be made. */

export const classById = id => CLASSES.find(c => c.id === id) || null;

export const playableClasses = () => CLASSES.filter(c => c.status === 'live');

/* What a pool is short of, for a given bill of costs. Returns the amounts
   rather than a boolean, because "you need one more Dewglass" is the only
   version of this answer a player can act on. Shared by potions and buildings
   so the two can never drift on what "cannot afford" means. */
export function shortfall(costs, pool){
  const short = {};
  for(const [id, needed] of Object.entries(costs || {})){
    const have = (pool && pool[id]) || 0;
    if(have < needed) short[id] = needed - have;
  }
  return short;
}

export const canAfford = (costs, pool) => Object.keys(shortfall(costs, pool)).length === 0;

/* Does the stash hold everything this recipe needs? */
export function missingFor(recipeId, stash){
  const recipe = RECIPES[recipeId];
  if(!recipe) return null;
  return shortfall(recipe.costs, stash);
}

/* Does the salvage pool hold everything this building needs? */
export function missingForBuilding(buildingId, salvage){
  const building = BUILDINGS[buildingId];
  if(!building) return null;
  return shortfall(building.costs, salvage);
}

/* Which buildings the pool could pay for right now. The lobby of the build
   phase, effectively: this is the list a player is choosing between. */
export const affordableBuildings = salvage =>
  Object.keys(BUILDINGS).filter(id => canAfford(BUILDINGS[id].costs, salvage));

/* Can a structure go on this tile?
 *
 * Terrain has to allow it, nothing can already be standing there, and a herb
 * cannot be paved over — losing a Cellsap to a misclick would be the kind of
 * mistake a player never forgives, and refusing the tile costs them one click.
 */
export function canBuildAt(terrain, buildings, nodes, x, y){
  const kind = tileAt(terrain, x, y);
  if(!kind || !TERRAIN[kind].build) return false;
  if((buildings || []).some(b => b.x === x && b.y === y)) return false;
  if((nodes || []).some(n => n.x === x && n.y === y && !n.taken)) return false;
  return true;
}


/* Salvage drawn once a fight is over: what the crew picks up, plus what the
 * standing buildings produced while it happened.
 *
 * The crew's share is rolled and the buildings' is fixed, which is the shape
 * the economy wants — building is how you stop being at the mercy of the roll.
 * The caller supplies the generator, as everywhere else in this file.
 */
export function salvageAfterCombat(players, buildings, random){
  const drawn = {};
  const add = (id, n) => { drawn[id] = (drawn[id] || 0) + n; };

  for(const player of players || []){
    const cls = classById(player.classId);
    if(!cls || !cls.salvage || player.down) continue;
    for(let i = 0; i < cls.salvage; i++) add(salvageFor(random()), 1);
  }

  for(const placed of buildings || []){
    const building = BUILDINGS[placed.id];
    if(!building) continue;
    for(const [id, n] of Object.entries(building.income)) add(id, n);
  }

  return drawn;
}

/* Fold a draw into the pool. Kept here so the client's preview and the room
   add salvage the same way. */
export function addSalvage(pool, drawn){
  const next = { ...(pool || {}) };
  for(const [id, n] of Object.entries(drawn || {})) next[id] = (next[id] || 0) + n;
  return next;
}

export function spendSalvage(pool, costs){
  const next = { ...(pool || {}) };
  for(const [id, n] of Object.entries(costs || {})) next[id] = (next[id] || 0) - n;
  return next;
}

/* Weighted pick from the material table. The caller supplies the random
   number, because the engine's randomness has to come from the room's own
   seeded generator — a Math.random() in here would make a room replay
   differently from how it was played. */
export function materialFor(roll){
  const entries = Object.entries(MATERIALS);
  const total = entries.reduce((sum, [, m]) => sum + m.rarity, 0);
  let point = roll * total;
  for(const [id, m] of entries){
    point -= m.rarity;
    if(point <= 0) return id;
  }
  return entries[entries.length - 1][0];
}
