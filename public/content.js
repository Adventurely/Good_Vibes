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
