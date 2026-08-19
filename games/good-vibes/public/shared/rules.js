/* Deck, movement and affordability rules, plus compatibility shims. */

import { UPGRADES, upgradeCost } from './buildings.js';
import { CARDS, HAND_SIZE, STARTING_DECKS, UNIVERSAL_CARDS } from './cards.js';
import { MAP_W, TERRAIN, inBounds, tileAt, tileIndex } from './grid.js';
import { canAfford } from './lookups.js';
import { RECIPES } from './materials.js';
import { SPAWNS } from './pages.js';
import { ROUNDS } from './phases.js';
import { BASE_ACTIONS } from './record.js';


/* Everything below exists for one reason: this module is imported by the Tool
 * Haven Worker, and an import of a name that is not exported is a throw at the
 * top of that Worker — which takes the whole site down, sign-in included.
 *
 * Nobody here can read that Worker's source, so removing an export is a bet on
 * what it does not use. These are the bet declined. They are the only two names
 * this module has ever exported and then dropped, found by diffing the export
 * list across every commit; keep that true by shimming rather than deleting.
 *
 * Each returns something harmless and correctly shaped rather than something
 * pretending to still work. Delete them only once you have read the Worker and
 * know it does not import them — see the note at the top of the README.
 */

/* Was: the actions a party had, given what it had built. Buildings grant power
   and upgrades now rather than cards, so there is nothing to add — but the
   shape is still an array of ids that exist in CARDS. */
export function combatOptions(){
  return [...BASE_ACTIONS].filter(id => CARDS[id]);
}

/* Was: the five levels of a run, before a run became rounds and a boss. ROUNDS
   is the live table; this keeps the old shape, `nodes` included, so anything
   reading LEVELS[n].name or .blight still reads a number rather than a crash. */
export const LEVELS = ROUNDS.map(round => ({
  name: round.name,
  blight: round.blight,
  nodes: SPAWNS.herbs,
  note: round.note,
}));

/* The deck as a flat list of card ids, unshuffled. Order is the caller's
   problem, because the shuffle needs the room's generator. */
export function buildDeck(classId){
  const spec = STARTING_DECKS[classId] || {};
  const cards = [];
  for(const [id, count] of Object.entries(spec)){
    for(let i = 0; i < count; i++) cards.push(id);
  }
  return cards;
}

/* The deck a player takes into a run: their class cards and the universal one.
 *
 * Built once and then kept. Everything after this adds to it in place — the
 * Alchemist brewing, the Engineer buying a barrel — because a deck rebuilt at
 * the surge would throw away the build phase that paid for it.
 */
export function deckFor(classId){
  return [...buildDeck(classId), ...UNIVERSAL_CARDS];
}

/* What a card does right now, upgrades applied.
 *
 * CARDS stays declarative and the bolt gun's damage lives here instead, because
 * the alternative is rewriting the card table when somebody buys a coil — and
 * then the client and the room disagree about how hard a bolt hits.
 */
export function cardEffect(cardId, upgrades = {}){
  const card = CARDS[cardId];
  if(!card) return null;
  const levels = card.upgradedBy ? (upgrades[card.upgradedBy] || 0) : 0;
  if(!levels) return card.effect;
  return { ...card.effect, amount: card.effect.amount + levels * (card.upgradeStep || 0) };
}

/* Buy the next level of an upgrade. Returns the spent pool and what it did, or
   null when the salvage is short — the caller cannot half-apply it. */
export function buyUpgrade(id, level, salvage){
  const upgrade = UPGRADES[id];
  if(!upgrade) return null;
  const costs = upgradeCost(id, level);
  if(!canAfford(costs, salvage)) return null;

  const spent = { ...salvage };
  for(const [resource, n] of Object.entries(costs)) spent[resource] -= n;
  return { salvage: spent, adds: upgrade.adds, level: level + 1 };
}

/* Can a hero stand on this tile? Terrain has to allow it and nothing can be
   built on it — you walk around the pylon, not through it. */
export function walkableAt(terrain, buildings, x, y){
  const kind = tileAt(terrain, x, y);
  if(!kind || !TERRAIN[kind].walk) return false;
  return !(buildings || []).some(b => b.x === x && b.y === y);
}

/* Every tile a hero standing here could walk to, as a set of indices. The same
   flood as pathTo, kept separate because the spawner wants the whole reachable
   set rather than one route through it. */
export function reachableFrom(terrain, buildings, from){
  const seen = new Set();
  if(!from || !walkableAt(terrain, buildings, from.x, from.y)) return seen;

  const start = tileIndex(from.x, from.y);
  seen.add(start);
  const queue = [start];
  for(let head = 0; head < queue.length; head++){
    const index = queue[head];
    const x = index % MAP_W;
    const y = Math.floor(index / MAP_W);
    for(const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
      const nx = x + dx, ny = y + dy;
      if(!inBounds(nx, ny)) continue;
      const next = tileIndex(nx, ny);
      if(seen.has(next) || !walkableAt(terrain, buildings, nx, ny)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/* Breadth-first route from one tile to another, four-way.
 *
 * Returns the steps *after* `from`, so an empty array means "already there" and
 * null means there is no way across — a pond between you and the Cellsap is a
 * real answer, not an error.
 *
 * BFS rather than A*: the site is 30x17, so the whole board is cheaper to flood
 * than a heuristic is to tune, and BFS gives the shortest path without one.
 * Pure, because the room has to be able to check that a click was reachable
 * rather than trusting a client that says it walked there.
 */
export function pathTo(terrain, buildings, from, to){
  if(!from || !to) return null;
  if(!walkableAt(terrain, buildings, to.x, to.y)) return null;
  if(from.x === to.x && from.y === to.y) return [];

  const start = tileIndex(from.x, from.y);
  const goal = tileIndex(to.x, to.y);
  const cameFrom = new Map([[start, -1]]);
  const queue = [start];

  for(let head = 0; head < queue.length; head++){
    const index = queue[head];
    if(index === goal) break;
    const x = index % MAP_W;
    const y = Math.floor(index / MAP_W);
    for(const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
      const nx = x + dx, ny = y + dy;
      if(!inBounds(nx, ny)) continue;
      const next = tileIndex(nx, ny);
      if(cameFrom.has(next)) continue;
      if(!walkableAt(terrain, buildings, nx, ny)) continue;
      cameFrom.set(next, index);
      queue.push(next);
    }
  }

  if(!cameFrom.has(goal)) return null;

  const steps = [];
  for(let at = goal; at !== start; at = cameFrom.get(at)){
    steps.push({ x: at % MAP_W, y: Math.floor(at / MAP_W) });
  }
  return steps.reverse();
}

/* What a brew takes and what it gives. Returns null when the stash is short,
   so a caller cannot half-apply it — the room spends and deals in one step. */
export function brew(recipeId, stash){
  const recipe = RECIPES[recipeId];
  if(!recipe) return null;
  if(!canAfford(recipe.costs, stash)) return null;

  const spent = { ...stash };
  for(const [id, n] of Object.entries(recipe.costs)) spent[id] -= n;

  const cardId = recipe.card || recipeId;
  return { stash: spent, cards: Array(recipe.makes).fill(cardId), card: cardId };
}

/* Can this card be played right now? Cost is the only thing that stops one —
   the room checks this too, so a disabled button is politeness, not authority. */
export function cardPlayable(cardId, { pages = 0, power = 0, classId = null, hp = Infinity } = {}){
  const card = CARDS[cardId];
  if(!card) return false;
  if(card.classId && classId && card.classId !== classId) return false;
  if(card.pageCost && pages < card.pageCost) return false;
  if(card.powerCost && power < card.powerCost) return false;
  /* Strictly greater, so a card can never be the thing that kills you. The
     Hauler pays for damage in health and should be able to spend down to one,
     never through it — a deck that can lose you the run on a legal play is a
     deck nobody reads twice. `hp` defaults to Infinity so every caller that
     predates the Hauler is unaffected. */
  if(card.hpCost && hp <= card.hpCost) return false;
  return true;
}

/* Fisher-Yates, with the generator supplied.
 *
 * Every shuffle in this game has to be the room's: a client that shuffled its
 * own deck would hold cards the room did not deal it, and a replayed room
 * would deal a different hand than the one that was played. Each player needs
 * their own stream, too, or one player's draw shifts everyone else's.
 */
export function shuffle(cards, random){
  const out = [...cards];
  for(let i = out.length - 1; i > 0; i--){
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* Draw a hand, reshuffling the discard back in when the deck runs dry.
 *
 * Returns new piles rather than mutating them: the room holds this state and
 * two callers sharing an array is how a hand ends up in someone else's deck.
 * If there is nothing anywhere the hand comes back short, which is a bad turn
 * rather than a crash.
 */
export function draw(deck, discard, random, count = HAND_SIZE){
  let pile = [...(deck || [])];
  let used = [...(discard || [])];
  const hand = [];

  for(let i = 0; i < count; i++){
    if(!pile.length){
      if(!used.length) break;
      pile = shuffle(used, random);
      used = [];
    }
    hand.push(pile.shift());
  }
  return { hand, deck: pile, discard: used };
}

/* A turn ends with the whole hand face down — the one that was played and the
   two that were not. */
export const discardHand = (discard, hand) => [...(discard || []), ...(hand || [])];

export const cardById = id => CARDS[id] || null;
