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
 *   build     true if this class can raise structures from the salvage pool.
 *             The Engineer's, for the same reason.
 *   salvage   how many pieces of salvage this class draws after each combat.
 *             0 for everyone who is not paid to look at a wreck and see parts.
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

/* ============================================================== salvage === */

/* The Engineer's half of the economy, and deliberately not the Alchemist's.
 *
 * Herbs grow on the map and are gathered by walking to them. Salvage is not
 * on the map at all — it is pulled out of what the blight leaves behind, so it
 * arrives after a fight rather than during a walk. Two classes, two verbs, two
 * pools; the party shares both, but only one class can spend each.
 *
 * Kept in its own table rather than mixed into MATERIALS so that "can the
 * Alchemist brew with this" never becomes a question anyone has to ask.
 */
export const SALVAGE = {
  screw: {
    name: 'Screws',
    rarity: 12,
    colour: 'M',
    note: 'Every ruin is mostly fasteners. Somebody built all this once.',
  },
  pipe: {
    name: 'Pipe',
    rarity: 9,
    colour: 'x',
    note: 'Cut to length with whatever was to hand. Still holds pressure.',
  },
  plating: {
    name: 'Plating',
    rarity: 6,
    colour: 'm',
    note: 'Panel steel, sheared square. Heavy, and worth the carry.',
  },
  coil: {
    name: 'Coil',
    rarity: 3,
    colour: 'c',
    note: 'Copper wound tight around a core that still hums when you hold it.',
  },
};

/* Weighted pick from the salvage table, same contract as materialFor: the
   caller supplies the roll, because the randomness has to be the room's. */
export function salvageFor(roll){
  const entries = Object.entries(SALVAGE);
  const total = entries.reduce((sum, [, s]) => sum + s.rarity, 0);
  let point = roll * total;
  for(const [id, s] of entries){
    point -= s.rarity;
    if(point <= 0) return id;
  }
  return entries[entries.length - 1][0];
}

/* ====================================================== combat actions === */

/* What a player can do when the blight surges.
 *
 * The engine implements these kinds and refuses anything else, exactly as it
 * does for potions. 'strike' is the new one and the combat half of the room
 * has to grow it before an Arc Pylon does anything — until then a pylon builds
 * and shows its option and the option is inert. That is a known gap, not a
 * silent one: test/content.test.js pins every effect to this list.
 */
export const EFFECT_KINDS = ['heal', 'regen', 'ward', 'strike'];

/* Always available, with or without a base. Combat with an empty build is
   meant to be survivable and grim, not a screen with no buttons on it. */
export const BASE_ACTIONS = ['hold'];

export const COMBAT_ACTIONS = {
  hold: {
    name: 'Hold',
    effect: { kind: 'ward', amount: 2, rounds: 1 },
    note: 'Put your back to something and wait it out.',
  },
  patch: {
    name: 'Patch',
    effect: { kind: 'heal', amount: 5 },
    note: 'Tape, wire, and a flat sheet of plating over the worst of it.',
  },
  arc: {
    name: 'Arc',
    effect: { kind: 'strike', amount: 6 },
    note: 'The pylon dumps its charge into the nearest thing that is spreading.',
  },
  douse: {
    name: 'Douse',
    effect: { kind: 'ward', amount: 5, rounds: 2 },
    note: 'Clean water, under pressure, straight up into the bad air.',
  },
  brace: {
    name: 'Brace',
    effect: { kind: 'ward', amount: 8, rounds: 1 },
    note: 'Get everyone behind the wall before it lands.',
  },
};

/* ============================================================ buildings === */

/* What the Engineer puts on the map, and the reason the build phase matters.
 *
 * A building is not a stat. It is a tile you chose to spend, and a combat
 * option the whole party gets to use afterwards — so the build phase is where
 * the party decides what its combat is going to look like. That is the whole
 * two-phase design in one field: `grants`.
 *
 *   tier    1 is affordable from STARTING_SALVAGE, 2 needs income first
 *   costs   salvage spent to raise it, checked against the shared pool
 *   grants  combat action ids this building adds for everyone
 *   income  salvage drawn after each combat while it stands
 *   art     key into BUILDING_ART — client-only, like every art key here
 */
export const BUILDINGS = {
  workbench: {
    name: 'Workbench',
    tier: 1,
    costs: { screw: 4, pipe: 3 },
    grants: ['patch'],
    income: { screw: 2, pipe: 1 },
    note: 'A vice, a flat surface, and somewhere to put the thing down. Pays for itself.',
    art: 'workbench',
  },
  pylon: {
    name: 'Arc Pylon',
    tier: 1,
    costs: { screw: 3, pipe: 2, plating: 2 },
    grants: ['arc'],
    income: { screw: 1 },
    note: 'Stores an afternoon and spends it in a second. The first thing here that hits back.',
    art: 'pylon',
  },
  condenser: {
    name: 'Condenser',
    tier: 2,
    costs: { pipe: 4, plating: 3, coil: 1 },
    grants: ['douse'],
    income: { pipe: 1 },
    note: 'Pulls water out of bad air, which turns out to be two useful things at once.',
    art: 'condenser',
  },
  bulwark: {
    name: 'Bulwark',
    tier: 2,
    costs: { screw: 4, plating: 5 },
    grants: ['brace'],
    income: {},
    note: 'Panel steel stacked two deep. Nothing clever, and it does not have to be.',
    art: 'bulwark',
  },
  rig: {
    name: 'Salvage Rig',
    tier: 2,
    costs: { screw: 6, pipe: 5, coil: 2 },
    grants: [],
    income: { screw: 3, pipe: 2, plating: 1 },
    note: 'Strips a ruin faster than hands can. Adds nothing to a fight but pays for what does.',
    art: 'rig',
  },
};

/* What the party starts a site with.
 *
 * Tuned so the opening is a real decision: this affords the Workbench or the
 * Arc Pylon and never both, and nothing in tier 2 at all. Economy or teeth,
 * pick one, live with it for a cycle. test/content.test.js pins that property
 * so a later balance pass cannot quietly make the first move free.
 */
export const STARTING_SALVAGE = { screw: 6, pipe: 4, plating: 2, coil: 0 };

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
    build: false,
    salvage: 0,
  },
  {
    id: 'engineer',
    name: 'The Engineer',
    archetype: 'Builder · economy',
    status: 'live',
    hp: 32,
    colour: '#f59a2e',
    blurb:
      'Kept the block’s water moving and its lights on with a bag of salvage and no budget. ' +
      'Looks at a wreck and sees the parts, already sorted.',
    downLine: 'The pylon holds. Get behind it.',
    art: 'engineer',
    gather: 1,
    craft: false,
    build: true,
    salvage: 3,
  },
];

/* The three seats still to be designed.
 *
 * These are not placeholder classes — they are the shape of the hole. The
 * lobby shows them as locked so a player can see the party is incomplete
 * rather than wondering why there are only three seats.
 *
 * The roles below are a suggestion from what the two built classes do not do.
 * The Alchemist gathers and heals; the Engineer builds and pays for it. So the
 * party still has nobody who can take a hit, nobody who reliably deals one,
 * and nobody who can find what a site is hiding. Ignore them freely — the only
 * hard requirement is that CLASSES ends up with PARTY_SIZE entries.
 */
export const OPEN_ROLES = [
  { slot: 3, suggestion: 'Front line — stands in the blight so the builders do not have to' },
  { slot: 4, suggestion: 'Damage — whatever ends up needing to be hit, hit properly' },
  { slot: 5, suggestion: 'Scout — finds the salvage and the survivors a site is hiding' },
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

/* Every combat action the party has, given what it has built.
 *
 * This is the two-phase loop's whole point of contact: what you can do in a
 * fight is decided by what you put on the map beforehand. Returned as ids in a
 * stable order — base actions first, then buildings in BUILDINGS order — so
 * the buttons do not reshuffle between rounds.
 */
export function combatOptions(buildings){
  const standing = new Set((buildings || []).map(b => b.id));
  const ids = [...BASE_ACTIONS];
  for(const [id, building] of Object.entries(BUILDINGS)){
    if(!standing.has(id)) continue;
    for(const action of building.grants){
      if(!ids.includes(action)) ids.push(action);
    }
  }
  return ids.filter(id => COMBAT_ACTIONS[id]);
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

/* Sized for a small base rather than for a screen. A party needs somewhere to
   put six or eight structures and still walk between them, and at 18x9 the
   first two buildings already crowded the herbs off the good ground. */
export const MAP_W = 24;
export const MAP_H = 14;

/* The smallest connected buildable area a generated site is allowed to have.
   Terrain is random, so this is the promise the generator has to keep: enough
   contiguous ground for a base, not merely enough tiles somewhere. */
export const BASE_ROOM = 60;

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
export const HERB_COUNT = 14;

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
  //
  // Sized to leave the map mostly open. Obstacles are scenery here — they make
  // the ground have a shape — and a site you cannot fit a base on is a site
  // nobody wants to have rolled. largestBuildableArea is what holds that line.
  blob(cells, random, 'water', 22);
  blob(cells, random, 'water', 15);
  blob(cells, random, 'rubble', 18);
  blob(cells, random, 'rubble', 11);
  blob(cells, random, 'floor', 20);
  blob(cells, random, 'floor', 12);

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
