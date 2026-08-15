/* Good Vibes — game content.
 *
 * Everything here is data. It is imported by the room object in Tool Haven,
 * which is authoritative, and by the browser for rendering — so it must not
 * depend on anything that exists on only one side. No DOM, no storage, no
 * clock, no randomness at load time. Pure values.
 *
 * That shared-import trick is Solarium's, and it is the reason the rules and
 * the UI can never disagree about what a potion does. The cost is that a throw
 * at the top level of this file would take the whole Worker down with it, so
 * this file stays declarative: no computation outside the helpers at the end,
 * and test/content.test.js checks the shape before any of it can be synced.
 *
 * --- Adding a class -------------------------------------------------------
 *
 * Copy the Alchemist below and change it. Every field is required; the test
 * will tell you if one is missing rather than the game failing at the table.
 *
 *   id        kebab-case, permanent — save data and art keys hang off it
 *   name      what a player sees
 *   archetype "Role · what it does for the party", in the Solarium style
 *   status    'live' once it is playable. 'draft' keeps it off the roster.
 *   hp        starting health. The Alchemist's 30 is the soft middle.
 *   colour    the class's accent, used for its seat and its sprite's trim
 *   blurb     one or two sentences. Who they were before the lights went out.
 *   downLine  what they say when they go down. Solarium gives everyone one.
 *   art       key into art.js — HERO_ART[art] must exist
 *   gather    how many materials one gather action yields (1 unless special)
 *   craft     true if this class can turn the stash into potions. The
 *             Alchemist's whole reason for existing; leave it off everyone
 *             else unless you mean it.
 *
 * Anything a class does beyond that is an ability, and abilities need the
 * combat model that does not exist yet — see OPEN_ROLES.
 */

/* The party is five because there are five classes and one each. A sixth
   player would have nothing to be. */
export const PARTY_SIZE = 5;

/* ============================================================ materials === */

/* What grows in the ruins. Rarity drives how often a level puts one out;
   it is a weight, not a probability, so the numbers only matter next to
   each other. */
export const MATERIALS = {
  sunpetal: {
    name: 'Sunpetal',
    rarity: 12,
    colour: 'Y',
    note: 'Tracks the sun through cloud cover. Grows anywhere the roof failed.',
  },
  copperfern: {
    name: 'Copperfern',
    rarity: 10,
    colour: 'g',
    note: 'Roots in dead circuitry and draws the metal up its fronds.',
  },
  dewglass: {
    name: 'Dewglass',
    rarity: 7,
    colour: 'c',
    note: 'Condensation caught in a cracked panel. Somehow still clean.',
  },
  rustbloom: {
    name: 'Rustbloom',
    rarity: 6,
    colour: 'r',
    note: 'Lichen that eats oxidised steel and flowers orange doing it.',
  },
  cellsap: {
    name: 'Cellsap',
    rarity: 3,
    colour: 'p',
    note: 'Sap from a tree grafted onto a solar array. Tastes like a battery.',
  },
};

/* ============================================================== potions === */

/* An effect is { kind, ... }. The engine implements these kinds and refuses
   anything else, so a recipe cannot quietly do nothing:
   heal   { amount }            restore health now
   regen  { amount, rounds }    restore health at the end of each round
   ward   { amount, rounds }    absorb blight before it reaches health
*/
export const RECIPES = {
  sunsalve: {
    name: 'Sunsalve',
    costs: { sunpetal: 2, dewglass: 1 },
    effect: { kind: 'heal', amount: 9 },
    note: 'Petals crushed into clean water. Closes what the blight opens.',
  },
  bloomdraught: {
    name: 'Bloomdraught',
    costs: { copperfern: 1, rustbloom: 1 },
    effect: { kind: 'regen', amount: 3, rounds: 3 },
    note: 'Bitter, slow, and still working three rounds later.',
  },
  stillwater: {
    name: 'Stillwater',
    costs: { dewglass: 2 },
    effect: { kind: 'ward', amount: 4, rounds: 2 },
    note: 'Drink it and the air stops biting for a while.',
  },
  greenfire: {
    name: 'Greenfire',
    costs: { cellsap: 1, sunpetal: 1 },
    effect: { kind: 'ward', amount: 8, rounds: 1 },
    note: 'A whole array’s worth of stored afternoon, held for one round.',
  },
};

/* ============================================================== classes === */

export const CLASSES = [
  {
    id: 'alchemist',
    name: 'The Alchemist',
    archetype: 'Crafter · support',
    status: 'live',
    hp: 30,
    colour: '#9fe86b',
    blurb:
      'Kept the block’s greenhouse pharmacy running on whatever came up through the floor. ' +
      'Reads a ruin as a shelf of ingredients.',
    downLine: 'The stash... someone finish the batch.',
    art: 'alchemist',
    gather: 2,
    craft: true,
  },
];

/* The four seats still to be designed.
 *
 * These are not placeholder classes — they are the shape of the hole. The
 * lobby shows them as locked so a player can see the party is incomplete
 * rather than wondering why there are only two seats.
 *
 * The roles below are a suggestion from what the Alchemist does not do: it
 * gathers and it heals, so the party has nobody who can take a hit, nobody who
 * can deal one, and nobody who can find things. Ignore them freely — the only
 * hard requirement is that CLASSES ends up with PARTY_SIZE entries.
 */
export const OPEN_ROLES = [
  { slot: 2, suggestion: 'Front line — takes the blight so the others do not' },
  { slot: 3, suggestion: 'Damage — whatever ends up needing to be hit' },
  { slot: 4, suggestion: 'Scout — finds the materials the level is hiding' },
  { slot: 5, suggestion: 'Wildcard — the one that makes a run go strangely' },
];

/* ================================================================ phases === */

/* A cycle is: build on the map, then hold it when the blight surges.
 *
 * 'playing' is the name the room used when the run was one long gather phase,
 * and it is still accepted as a synonym for 'build' so a client newer than the
 * deployed room does not render a blank screen. Remove it once the room sends
 * 'build'.
 */
export const PHASES = {
  lobby: 'lobby',
  build: 'build',
  combat: 'combat',
  over: 'over',
};

export const isBuildPhase = phase => phase === PHASES.build || phase === 'playing';

/* Who still has to ready up before the blight arrives.
 *
 * Disconnected players are left out of both halves: a party of five should not
 * be stuck in the build phase because someone's train went into a tunnel. They
 * rejoin into whatever phase the room has moved on to.
 *
 * Returned as counts rather than a boolean because "3 of 4 ready" is what the
 * UI needs to draw, and deriving that separately is how the two ends of this
 * end up disagreeing about who they are waiting for.
 */
export function readyState(players){
  const present = (players || []).filter(p => p.connected);
  const ready = present.filter(p => p.ready);
  return { ready: ready.length, total: present.length, all: present.length > 0 && ready.length === present.length };
}

/* =============================================================== levels === */

/* A run is five levels deep, and the ruin itself is the pressure: blight is
 * ambient damage every round, so standing still costs health and gathering
 * everything before moving on is a real decision rather than free loot.
 *
 * This is what makes the Alchemist playable before there is a single enemy in
 * the game. Enemies arrive with the classes built to fight them.
 */
export const LEVELS = [
  { name: 'The Overgrowth', blight: 1, nodes: 6, note: 'A stairwell the ivy took back.' },
  { name: 'Panel Fields', blight: 2, nodes: 6, note: 'Acres of cracked glass, still tracking the sun.' },
  { name: 'The Rustlands', blight: 3, nodes: 5, note: 'Everything orange, everything sharp.' },
  { name: 'Cooling Halls', blight: 4, nodes: 5, note: 'Cold, quiet, and dripping.' },
  { name: 'The Array', blight: 5, nodes: 4, note: 'Where the power went. Something is still drawing from it.' },
];

/* =============================================================== helpers === */

/* Pure lookups. Small enough to be obviously correct, and shared so the client
   and the engine cannot disagree about whether a thing can be made. */

export const classById = id => CLASSES.find(c => c.id === id) || null;

export const playableClasses = () => CLASSES.filter(c => c.status === 'live');

/* Does the stash hold everything this recipe needs? Returns the missing
   amounts rather than a boolean, because "you need one more Dewglass" is the
   only version of this answer a player can act on. */
export function missingFor(recipeId, stash){
  const recipe = RECIPES[recipeId];
  if(!recipe) return null;
  const short = {};
  for(const [material, needed] of Object.entries(recipe.costs)){
    const have = stash[material] || 0;
    if(have < needed) short[material] = needed - have;
  }
  return short;
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

/* ================================================================== map === */

/* The ground the build phase happens on.
 *
 * The map is a grid because everything the build phase wants to ask is a
 * question about neighbours — does this tile drain into that one, is that
 * structure close enough to shelter this tile — and a grid answers those with
 * arithmetic instead of geometry.
 *
 * It is generated once and kept. That is the whole point of the two-phase
 * design: you come back to the plot you cleared last cycle and it is still
 * cleared. Only the herbs are respawned between cycles.
 */

export const MAP_W = 18;
export const MAP_H = 9;

/* walk  can a player stand here
   build can a structure go here (the build phase's reason to care about terrain)
   grows can a herb spawn here */
export const TERRAIN = {
  grass:  { name: 'Overgrowth',  walk: true,  build: true,  grows: true },
  floor:  { name: 'Panel floor', walk: true,  build: true,  grows: false },
  rubble: { name: 'Rubble',      walk: false, build: false, grows: false },
  water:  { name: 'Meltwater',   walk: false, build: false, grows: false },
};

/* How many herbs a cycle puts out. Fewer than there are open tiles by a wide
   margin, so where they land still reads as a choice of where to walk. */
export const HERB_COUNT = 9;

export const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
export const tileIndex = (x, y) => y * MAP_W + x;
export const tileAt = (terrain, x, y) => (inBounds(x, y) ? terrain[tileIndex(x, y)] : null);

/* Deterministic PRNG (mulberry32). Same seed, same map, on both sides of the
 * wire and in the tests.
 *
 * This is a factory and not a value: calling it is what produces randomness, so
 * importing this module still costs nothing and decides nothing. The room seeds
 * it from the room code so a party can be told which ruin they are standing in.
 */
export function seededRandom(seed){
  let a = (seed >>> 0) || 1;
  return function(){
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Seed from a room code, so the same room is always the same ruin. */
export function seedFromCode(code){
  let hash = 2166136261;
  for(const ch of String(code || '')){
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/* A drunkard's walk from a starting tile. Cheap, and it produces the ragged
   edges that a ruin wants — a rectangle of water would read as a swimming
   pool. Walks are allowed to wander off the map and come back; they just do
   not paint while they are outside it. */
function blob(cells, random, kind, size){
  let x = Math.floor(random() * MAP_W);
  let y = Math.floor(random() * MAP_H);
  for(let step = 0; step < size; step++){
    if(inBounds(x, y)) cells[tileIndex(x, y)] = kind;
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
  // floor last so a slab reads as something built on top of the ruin.
  blob(cells, random, 'water', 14);
  blob(cells, random, 'water', 9);
  blob(cells, random, 'rubble', 11);
  blob(cells, random, 'rubble', 7);
  blob(cells, random, 'floor', 12);

  return cells;
}

/* Scatter herbs across whatever the terrain left growable.
 *
 * Tiles are drawn without replacement, so two herbs can never occupy one tile
 * — a duplicate would render as one sprite and gather as two, which looks like
 * a lost click. materialFor decides *what* grows, so the rarity weights in
 * MATERIALS stay the single source of that answer.
 */
export function spawnHerbs(terrain, random, count = HERB_COUNT){
  const open = [];
  for(let i = 0; i < terrain.length; i++){
    if(TERRAIN[terrain[i]] && TERRAIN[terrain[i]].grows) open.push(i);
  }

  const nodes = [];
  for(let n = 0; n < count && open.length; n++){
    const [index] = open.splice(Math.floor(random() * open.length), 1);
    nodes.push({
      id: `n${n}`,
      x: index % MAP_W,
      y: Math.floor(index / MAP_W),
      material: materialFor(random()),
      taken: false,
    });
  }
  return nodes;
}

/* The whole ground state for a cycle. The room calls this with its own seeded
   generator and sends the result down; the client never calls it during real
   play, because a client that generated its own map would be a second source
   of truth about where the Cellsap is. */
export function generateMap(random){
  const terrain = generateTerrain(random);
  return { terrain, nodes: spawnHerbs(terrain, random) };
}

/* A player's walkable start. Centre-ish and always on solid ground, so nobody
   opens the build phase standing in a pond. */
export function spawnTile(terrain, offset = 0){
  const cx = Math.floor(MAP_W / 2);
  const cy = Math.floor(MAP_H / 2);
  for(let radius = 0; radius < Math.max(MAP_W, MAP_H); radius++){
    for(let dy = -radius; dy <= radius; dy++){
      for(let dx = -radius; dx <= radius; dx++){
        const x = cx + dx + offset;
        const y = cy + dy;
        const tile = tileAt(terrain, x, y);
        if(tile && TERRAIN[tile].walk) return { x, y };
      }
    }
  }
  return { x: cx, y: cy };
}
