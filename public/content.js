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
 *   cast      true if this class can spend spell pages. The Wizard's flag,
 *             completing the pattern: three pools, three spenders, one each.
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

/* ========================================================== spell pages === */

/* The Wizard's resource. One kind, not a table: pages are pages, and what
 * varies is how many a cache holds. They spawn on the map like herbs do —
 * something worth walking to — and each fireball burns one from the shared
 * pool. The party carries the library; only the Wizard can read it.
 */
export const PAGES = {
  name: 'Spell pages',
  colour: 'w',
  note: 'Paper that survived the rain because somebody meant it to. The ink still moves.',
};

/* How much of everything a build map puts out. Salvage caches on the ground
   are the small change — crates the blight has not digested yet — while the
   after-combat payout stays the Engineer's real income. Pages are scarce on
   purpose: every fireball is a page the Wizard chose to burn. */
export const SPAWNS = { herbs: 12, salvage: 5, pages: 3 };

/* What one walked-to cache yields. Rolled sizes would make gathering a
   lottery; fixed sizes make the map readable — a player can count what a
   trip is worth before spending the rounds to make it. */
export const CACHE_YIELD = { salvage: 2, pages: 1 };

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

/* COMBAT_ACTIONS is now the card table, aliased below where CARDS is defined.
   Every one of these lives in a deck. */

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
  {
    id: 'wizard',
    name: 'The Wizard',
    archetype: 'Damage · glass cannon',
    status: 'live',
    hp: 22,
    colour: '#d2a6f0',
    blurb:
      'Found the old library under the cooling halls and read all of it, twice. ' +
      'Can end a fight from across the map, provided nothing so much as coughs on them first.',
    downLine: 'The pages... keep them dry.',
    art: 'wizard',
    gather: 1,
    craft: false,
    build: false,
    salvage: 0,
    cast: true,
  },
];

/* The two seats still to be designed.
 *
 * These are not placeholder classes — they are the shape of the hole. The
 * lobby shows them as locked so a player can see the party is incomplete
 * rather than wondering why there are only three real seats.
 *
 * The roles below are a suggestion from what the built classes do not do.
 * The Alchemist gathers and heals, the Engineer builds and pays for it, the
 * Wizard deletes things from a distance and folds if breathed on. So the
 * party still has nobody who can take a hit, and nobody who can find what a
 * site is hiding. Ignore them freely — the only hard requirement is that
 * CLASSES ends up with PARTY_SIZE entries.
 */
export const OPEN_ROLES = [
  { slot: 4, suggestion: 'Front line — stands in the blight so the builders do not have to' },
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

/* =============================================================== rounds === */

/* A run is three rounds and then the boss. Each round is one cycle: a build
 * phase on a freshly generated site — walk to what the ruin grew, brew, raise
 * structures — then a surge, where the blight comes to the party and what was
 * built is what fights back. A new site is rolled for every round of every
 * run, so no two walks are the same walk.
 */
export const ROUNDS_BEFORE_BOSS = 3;
export const BOSS_ROUND = ROUNDS_BEFORE_BOSS + 1;

export const ROUNDS = [
  { name: 'The Overgrowth', blight: 1, note: 'A stairwell the ivy took back.' },
  { name: 'Panel Fields', blight: 1, note: 'Acres of cracked glass, still tracking the sun.' },
  { name: 'The Rustlands', blight: 2, note: 'Everything orange, everything sharp.' },
  { name: 'The Array', blight: 2, note: 'Where the power went. It knows you are here.' },
];

export const roundInfo = round =>
  ROUNDS[Math.min(Math.max(1, round), ROUNDS.length) - 1];

/* The splash card the client animates at each phase change. Words, not
   layout: the client owns how it looks, this owns what it says, and the two
   sides of the wire agree because there is only one copy. */
const ORDINALS = ['One', 'Two', 'Three', 'Four', 'Five'];
export function phaseCard(round, phase){
  if(round >= BOSS_ROUND && phase === PHASES.combat){
    return { title: 'The Array Wakes', subtitle: 'Boss combat — everything you built, all at once.' };
  }
  const ordinal = ORDINALS[round - 1] || String(round);
  return phase === PHASES.build
    ? { title: `Round ${ordinal} — Build Phase`, subtitle: 'The party plans.' }
    : { title: `Round ${ordinal} — The Surge`, subtitle: 'The blight has found the site.' };
}

/* ================================================================ cards === */

/* Everyone holds a deck, and a turn is: draw three, play one.
 *
 * Three is small on purpose. Five players commit simultaneously, so a hand has
 * to be readable in about three seconds or four people sit watching a fifth
 * think. A three-card hand is a choice; a ten-card hand is a planning problem,
 * and a planning problem you cannot coordinate is just a wait.
 *
 * The unplayed two are discarded with the played one — a hand does not carry
 * over. That is what keeps a turn atomic: nobody is holding a card for three
 * rounds waiting for a setup that the other four cannot see coming.
 */
export const HAND_SIZE = 3;

/* A card is an effect with a face. `kind` is only for the icon and the sort —
 * the engine reads `effect`, exactly as it does for potions and buildings, so
 * a card cannot do anything a potion could not.
 *
 * These are the basics: every class gets attacks and defends and nothing that
 * runs out. The interesting cards — the Engineer's powered weapons, the
 * Alchemist's brewed one-shots, the Wizard's prepared spells — are the next
 * slice, and they go in the same table with the same shape.
 */
export const CARDS = {
  /* --- the Alchemist: middling at both, and the only one who mends --- */
  flask: {
    name: 'Acid Flask', kind: 'attack', classId: 'alchemist',
    effect: { kind: 'strike', amount: 3 },
    note: 'Something from the bottom shelf, thrown hard.',
  },
  steady: {
    name: 'Steady Hands', kind: 'defend', classId: 'alchemist',
    effect: { kind: 'ward', amount: 4, rounds: 1 },
    note: 'Do not spill it. Do not spill it.',
  },
  tonic: {
    name: 'Tonic', kind: 'heal', classId: 'alchemist',
    effect: { kind: 'heal', amount: 4 },
    note: 'Bitter, and working before you have swallowed it.',
  },

  /* --- the Engineer: hits like a tool, holds like a wall --- */
  wrench: {
    name: 'Wrench', kind: 'attack', classId: 'engineer',
    effect: { kind: 'strike', amount: 4 },
    note: 'Forty centimetres of drop-forged persuasion.',
  },
  shore: {
    name: 'Shore Up', kind: 'defend', classId: 'engineer',
    effect: { kind: 'ward', amount: 5, rounds: 1 },
    note: 'Plating, a strut, and eleven seconds. It will hold.',
  },

  /* --- the Wizard: the best basic attack and the worst basic guard, which
         is the whole class in two cards --- */
  spark: {
    name: 'Spark', kind: 'attack', classId: 'wizard',
    effect: { kind: 'strike', amount: 5 },
    note: 'No page needed. Barely a spell. Still hurts.',
  },
  sign: {
    name: 'Warding Sign', kind: 'defend', classId: 'wizard',
    effect: { kind: 'ward', amount: 3, rounds: 1 },
    note: 'Drawn in the air, and about as solid as that sounds.',
  },

  /* --- costed and granted cards ---------------------------------------
   *
   * These used to be a second list beside the hand, which meant two kinds of
   * "things you can do this turn" on one screen with nothing to explain why
   * one was a card and the other a grey box. They are cards now. What differs
   * is only how they get into a deck.
   */

  /* The Wizard's, and the reason pages are worth walking to. Drawn like any
     card and unplayable with an empty library — a bad draw the player caused,
     which is the interesting kind. */
  fireball: {
    name: 'Fireball', kind: 'attack', classId: 'wizard', pageCost: 1,
    effect: { kind: 'strike', amount: 7 },
    note: 'One page, read aloud, thrown. The blight burns like anything else.',
  },

  /* Everyone holds one. The floor of a turn: whatever else the hand deals you,
     there is something to do with it. */
  hold: {
    name: 'Hold', kind: 'defend', universal: true,
    effect: { kind: 'ward', amount: 2, rounds: 1 },
    note: 'Put your back to something and wait it out.',
  },

  /* Granted by a standing building, to everyone's deck — the site fires the
     pylon, not the person. This is the two-phase loop's point of contact:
     what you built is literally what you draw. */
  patch: {
    name: 'Patch', kind: 'heal', fromBuilding: 'workbench',
    effect: { kind: 'heal', amount: 5 },
    note: 'Tape, wire, and a flat sheet of plating over the worst of it.',
  },
  arc: {
    name: 'Arc', kind: 'attack', fromBuilding: 'pylon',
    effect: { kind: 'strike', amount: 6 },
    note: 'The pylon dumps its charge into the nearest thing that is spreading.',
  },
  douse: {
    name: 'Douse', kind: 'defend', fromBuilding: 'condenser',
    effect: { kind: 'ward', amount: 5, rounds: 2 },
    note: 'Clean water, under pressure, straight up into the bad air.',
  },
  brace: {
    name: 'Brace', kind: 'defend', fromBuilding: 'bulwark',
    effect: { kind: 'ward', amount: 8, rounds: 1 },
    note: 'Get everyone behind the wall before it lands.',
  },
};

/* What each class opens with. Eight cards: at three drawn and three discarded
   a turn, the deck cycles about every three turns, so a fight sees the whole
   thing roughly twice and a player learns what is in theirs. */
export const STARTING_DECKS = {
  alchemist: { flask: 3, steady: 3, tonic: 2 },
  engineer: { wrench: 4, shore: 4 },
  wizard: { spark: 4, sign: 2, fireball: 2 },
};

/* Cards every deck holds regardless of class. */
export const UNIVERSAL_CARDS = Object.entries(CARDS)
  .filter(([, card]) => card.universal)
  .map(([id]) => id);

/* Deprecated alias, kept because the Tool Haven room imports this module and a
 * missing export there is a throw at the top of the Worker — which takes the
 * whole site down, sign-in included. Cards carry the same { name, effect, note }
 * shape the actions did, so anything reading it still works.
 *
 * Delete once the room has been updated to read CARDS. It must stay below the
 * CARDS definition: aliasing a const before its declaration is exactly the
 * top-level throw this comment is about.
 */
export const COMBAT_ACTIONS = CARDS;

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

/* The deck a player actually takes into a fight: their class cards, the
 * universal one, and a copy of whatever every standing building grants.
 *
 * Building cards go to everybody. The pylon belongs to the site, not to the
 * Engineer who bolted it down, and a party where only one player could fire it
 * would make the build phase his hobby rather than the party's plan.
 */
export function deckFor(classId, buildings = []){
  const cards = [...buildDeck(classId), ...UNIVERSAL_CARDS];
  for(const placed of buildings){
    const building = BUILDINGS[placed && placed.id];
    if(!building) continue;
    for(const cardId of building.grants){
      if(CARDS[cardId]) cards.push(cardId);
    }
  }
  return cards;
}

/* Can this card be played right now? Cost is the only thing that stops one —
   the room checks this too, so a disabled button is politeness, not authority. */
export function cardPlayable(cardId, { pages = 0, classId = null } = {}){
  const card = CARDS[cardId];
  if(!card) return false;
  if(card.classId && classId && card.classId !== classId) return false;
  if(card.pageCost && pages < card.pageCost) return false;
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

/* ============================================================== enemies === */

/* What comes out of the blight when it surges. An enemy is authored by its
 * distance and its damage: `dist` is how many combat rounds the party has
 * before it arrives, and `hits` is what each of them costs once it does.
 *
 * The wave tables are per round, boss last. Composition over stat scaling —
 * a later round sends more and faster things rather than the same thing with
 * a bigger number, because "there are four of them now" is legible on a
 * screen in a way "+2 hp" never is.
 */
export const ENEMIES = {
  sporeling: { name: 'Sporeling', hp: 6, hits: 2, dist: 3, art: 'sporeling',
    note: 'A puffball with intent. Pops wetly.' },
  creeper: { name: 'Creeper', hp: 10, hits: 3, dist: 4, art: 'creeper',
    note: 'Vine over bone over something that used to be a drone.' },
  hulk: { name: 'Rust Hulk', hp: 18, hits: 5, dist: 5, art: 'hulk',
    note: 'A maintenance chassis the blight wears like a coat.' },
  extractor: { name: 'The Extractor', hp: 46, hits: 7, dist: 5, art: 'extractor', boss: true,
    note: 'It was built to harvest. It still is.' },
};

export function waveFor(round){
  const waves = {
    1: ['sporeling', 'sporeling', 'creeper'],
    2: ['sporeling', 'sporeling', 'creeper', 'creeper'],
    3: ['creeper', 'creeper', 'hulk', 'sporeling'],
    [BOSS_ROUND]: ['extractor', 'creeper', 'creeper'],
  };
  return waves[Math.min(round, BOSS_ROUND)] || waves[BOSS_ROUND];
}

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
  return ids.filter(id => CARDS[id]);
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
 * A new site is generated for every round of every run. Walking out is part
 * of the fiction, and it keeps the build phase a set of decisions instead of
 * a base someone finished in round one. What carries between rounds is the
 * pools — herbs, salvage, pages — not the ground they came from.
 */

/* Sized for a walk, not just a base. The features — water, hills, trees,
   crevices — need room to read as landscape rather than as noise, and at
   24x14 three blobs already touched. */
export const MAP_W = 30;
export const MAP_H = 17;

/* The smallest connected buildable area a generated site is allowed to have.
   Terrain is random, so this is the promise the generator has to keep: enough
   contiguous ground for a base, not merely enough tiles somewhere. */
export const BASE_ROOM = 60;

/* walk  can a player stand here
   build can a structure go here (the build phase's reason to care about terrain)
   grows can a herb spawn here */
export const TERRAIN = {
  grass:   { name: 'Overgrowth',  walk: true,  build: true,  grows: true },
  floor:   { name: 'Panel floor', walk: true,  build: true,  grows: false },
  rubble:  { name: 'Rubble',      walk: false, build: false, grows: false },
  water:   { name: 'Meltwater',   walk: false, build: false, grows: false },
  /* Landscape, not just obstacle. Hills can be walked but not built on — the
     ground is not flat enough; trees grow herbs at their feet but block the
     tile; a crevice blocks everything, including the eye line. */
  hill:    { name: 'Spoil hill',  walk: true,  build: false, grows: false },
  tree:    { name: 'Sapling',     walk: false, build: false, grows: false },
  crevice: { name: 'Crevice',     walk: false, build: false, grows: false },
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

  // Trees are dotted, not blobbed — a copse is single trunks with light
  // between them, and a solid mass of them would read as one green rock.
  for(let i = 0; i < 14; i++){
    const index = Math.floor(random() * cells.length);
    if(cells[index] === 'grass') cells[index] = 'tree';
  }

  return cells;
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
export function spawnItems(terrain, random, spawns = SPAWNS){
  const growable = [];
  const walkable = [];
  for(let i = 0; i < terrain.length; i++){
    const tile = TERRAIN[terrain[i]];
    if(!tile) continue;
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

  for(let i = 0; i < spawns.herbs; i++) place(growable, () => ({ kind: 'herb', material: materialFor(random()) }));
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
