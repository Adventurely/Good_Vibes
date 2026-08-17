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
/* Brewing does not fill a rack — it puts cards in the Alchemist's deck.
 *
 * One brew makes several copies, which is what makes the walk across the site
 * worth the trouble: a Sunpetal you bent down for is three heals, not one. The
 * cards it makes are `consumed`, so they leave the deck when played instead of
 * cycling back — the Alchemist's deck is the one that changes shape every
 * fight, against the Engineer's, which only grows.
 *
 * Rarity does the gating. Sunpetal is the commonest herb, so Sunsalve is the
 * one you can nearly always make and it makes the most cards; Cellsap is the
 * rarest at a weight of 3, so Greenfire's big hit is the one you cannot count
 * on. Between the three, every material on the map has a use — no herb is ever
 * pointless to bend down for.
 *
 *   costs   what it takes out of the shared stash
 *   makes   how many copies of the card go into the deck
 *   card    key into CARDS — that card must exist and be `consumed`
 */
export const RECIPES = {
  sunsalve: {
    name: 'Sunsalve',
    costs: { sunpetal: 2, dewglass: 1 },
    makes: 3,
    card: 'sunsalve',
    note: 'Petals crushed into clean water. Closes what the blight opens.',
  },
  stillwater: {
    name: 'Stillwater',
    costs: { dewglass: 2, copperfern: 1 },
    makes: 2,
    card: 'stillwater',
    note: 'Drink it and the air stops biting for a while.',
  },
  greenfire: {
    name: 'Greenfire',
    costs: { cellsap: 1, rustbloom: 1 },
    makes: 2,
    card: 'greenfire',
    note: 'Sap that tastes like a battery, lit and thrown. It goes up green.',
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
/* Herbs are deliberately scarce, and exactly one of each material.
 *
 * There is no move budget — a player can walk anywhere on the site and pick up
 * everything on it — so the limit on how much the Alchemist can brew has to be
 * how much grew, not how far she can walk.
 *
 * One node per material makes both halves of that structural rather than
 * lucky. Every recipe is always *possible*, because nothing is ever missing;
 * and no sweep ever pays for all three, because at two units a node the ten
 * units on a site cannot cover the eleven that one of each costs. The decision
 * is which two you walk to, not which two the dice left you.
 */
export const SPAWNS = { herbs: 5, salvage: 5, pages: 1 };

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
export const EFFECT_KINDS = [
  /* on one target */
  'heal', 'regen', 'ward', 'strike',
  /* on the whole party, or the whole wave — the multiplayer half of the table.
     Written as their own kinds rather than a `targets: 'all'` flag on the
     single-target ones, because "who does this land on" is the first thing a
     player reads off a card and a flag is not something you can read. */
  'healAll', 'wardAll', 'strikeAll',
  /* on an ally, and only meaningful because somebody else is there:
     cleanse pulls what a monster put on them, revive puts them back on their
     feet, might makes their next swing land harder than yours would. */
  'cleanse', 'revive', 'might',
];

/* ============================================================== ailments === */

/* What the blight leaves on a player, as opposed to what it takes off them.
 *
 * Damage is a number and is over. An ailment is the same monster still costing
 * you something three turns later, which is the only thing that makes the wave
 * feel like it is doing something other than subtracting.
 *
 * Three, and each one takes a different thing away:
 *
 *   rot   health, every round, and guard cannot stop it — the reason to carry
 *         a cleanse rather than another ward
 *   weak  damage, so the fight gets longer rather than shorter
 *   stun  the turn itself, which is the harshest and so the rarest
 *
 * `rounds` is how many of the player's own turns it survives. An ailment
 * refreshes rather than stacks — two Sporelings should be twice as many things
 * to kill, not four Blightrot ticks a round on one person.
 */
export const AILMENTS = {
  rot: {
    name: 'Blightrot', kind: 'rot', amount: 2, rounds: 2, colour: 'v',
    note: 'Spores in the lungs. It keeps taking after the thing that gave it to you is dead.',
  },
  weak: {
    name: 'Weakened', kind: 'weak', amount: 2, rounds: 2, colour: 'x',
    note: 'Something in the sap goes for the tendons. Everything you swing lands lighter.',
  },
  stun: {
    name: 'Stunned', kind: 'stun', amount: 0, rounds: 1, colour: 'Y',
    note: 'A turn spent finding your feet. The card in your hand falls out of it.',
  },
};

export const AILMENT_KINDS = Object.keys(AILMENTS);

/* The boons a card can leave, so the client can label one without a table of
   its own. `might` is the only one so far; `regen` is here because a potion
   could grant it and the shape is identical. */
export const BOONS = {
  might: { name: 'Might', kind: 'might', colour: 'o', note: 'Lent power. The next thing you swing lands harder.' },
  regen: { name: 'Mending', kind: 'regen', colour: 'l', note: 'Something working slowly, a little every round.' },
};

export const effectName = kind =>
  (AILMENTS[kind] || BOONS[kind] || {}).name || kind;

/* What a card's effect is called on the card. The kinds are field names —
 * 'strikeAll' printed on a card is the schema showing through — and the party
 * ones especially need saying in words, because "who does this land on" is the
 * only thing separating Bulwark from Shore Up at a glance.
 *
 * Here rather than in the client because the client is not the only thing that
 * has to name an effect: the deck list, the recipe rack and the card face all
 * ask, and three copies of this table would drift.
 */
export const EFFECT_LABELS = {
  strike: 'strike',
  strikeAll: 'every enemy',
  ward: 'ward',
  wardAll: 'ward the party',
  heal: 'heal',
  healAll: 'heal the party',
  cleanse: 'cleanse an ally',
  revive: 'pick an ally up',
  might: 'lend to an ally',
  regen: 'mending',
};

export const effectLabel = kind => EFFECT_LABELS[kind] || kind;

/* ========================================================== the record === */

/* What each seat did over a whole run, kept so the end of it can say
 * something. A run that ends on "you lost" and a blank screen is a run nobody
 * can tell a story about afterwards — and in a co-op game the story is who did
 * what, which nobody can reconstruct from a log that scrolled past four rounds
 * ago.
 *
 * Six numbers, chosen because each one is a different seat's answer to "was I
 * useful": the Wizard's is damage, the Engineer's is guard, the Alchemist's is
 * mending, and taken is the one nobody sets out to lead.
 */
export const STAT_LABELS = {
  damage: 'Damage dealt',
  kills: 'Blight put down',
  guard: 'Guard raised',
  mended: 'Health restored',
  revived: 'Allies picked up',
  taken: 'Damage taken',
};

/* The same six, as column headings. A medal has a whole row to itself and can
   afford the sentence; a table of seven columns cannot, and a header that
   wraps to three lines is worse than a short word. */
export const STAT_SHORT = {
  damage: 'Damage',
  kills: 'Kills',
  guard: 'Guard',
  mended: 'Mended',
  revived: 'Revives',
  taken: 'Taken',
};

export const STAT_KEYS = Object.keys(STAT_LABELS);

export const blankStats = () =>
  Object.fromEntries(STAT_KEYS.map(key => [key, 0]));

/* Who led each stat, as { key, label, player, value } rows in STAT_KEYS order.
 *
 * Ties go to the earlier seat and rows nobody scored on are dropped, so a solo
 * run does not read as a leaderboard of one and a run where nobody healed does
 * not award a Health Restored medal for zero. Shared by the end screen and the
 * tests, because "who did the most damage" should mean one thing.
 */
export function runHighlights(players = []){
  const seated = players.filter(p => p && p.classId && p.stats);
  const rows = [];
  for(const key of STAT_KEYS){
    let best = null;
    for(const p of seated){
      const value = p.stats[key] || 0;
      if(value > 0 && (!best || value > best.value)) best = { player: p, value };
    }
    if(best) rows.push({ key, label: STAT_LABELS[key], player: best.player, value: best.value });
  }
  return rows;
}

/* ---- the effect list a player carries -----------------------------------
 *
 * Every one of these takes the list and hands back a new one rather than
 * editing in place, for the reason the card piles do: the room holds this
 * state, the view is built from it, and two callers sharing an array is how a
 * status ends up on the wrong player.
 *
 * `fresh` is the whole trick. Effects age once a round, at a fixed point in
 * the turn — but an effect a player *granted* this round has not been lived
 * through yet, and ageing it the same evening would make a one-round buff a
 * zero-round buff. Fresh survives its first ageing and loses the flag; the
 * ailments a monster lands arrive after the ageing and so never need it.
 */
export function addEffect(effects, effect){
  const next = (effects || []).filter(e => e.kind !== effect.kind);
  next.push({ rounds: 1, ...effect });
  return next;
}

export function addAilment(effects, id, from = null){
  const spec = AILMENTS[id];
  if(!spec) return effects || [];
  return addEffect(effects, { kind: id, amount: spec.amount, rounds: spec.rounds, from });
}

export const hasEffect = (effects, kind) => (effects || []).some(e => e.kind === kind);

/* Summed rather than found, so the day two sources of Might exist the number
   is right without this being rewritten. */
export const effectAmount = (effects, kind) =>
  (effects || []).filter(e => e.kind === kind).reduce((sum, e) => sum + (e.amount || 0), 0);

/* One round older. Fresh effects lose the flag instead of a round; anything
   that runs out is dropped. */
export function tickEffects(effects){
  const next = [];
  for(const effect of effects || []){
    if(effect.fresh){ next.push({ ...effect, fresh: false }); continue; }
    const rounds = (effect.rounds ?? 1) - 1;
    if(rounds > 0) next.push({ ...effect, rounds });
  }
  return next;
}

/* What a cleanse takes off: ailments only. Stripping Might off the person you
   were trying to help would be a card that reads as support and plays as a
   mistake. */
export const clearAilments = effects =>
  (effects || []).filter(e => !AILMENTS[e.kind]);

/* What a strike actually lands for, once the blight and the party have both
   had their say. Never below one: a Weakened player holding Strike should be
   contributing badly, not contributing nothing. */
export const strikePower = (amount, effects) =>
  Math.max(1, amount + effectAmount(effects, 'might') - effectAmount(effects, 'weak'));

/* The cards every deck holds regardless of class, by id. Kept as its own
   export because the Tool Haven room imports it; UNIVERSAL_CARDS derives the
   same list from the card table and is what the client reads.

   Strike is here rather than in a class deck for the reason it exists at all:
   a party that built economy and drew no attack still has hands, and a fight
   nobody can swing in is arithmetic, not a fight. */
export const BASE_ACTIONS = ['strike', 'hold'];

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
  panel: {
    name: 'Solar Panel',
    costs: { screw: 3, plating: 2 },
    power: 1,
    income: {},
    note: 'Cracked, half-blind, and still tracking the sun. One panel, one shot.',
    art: 'panel',
  },
  workbench: {
    name: 'Workbench',
    costs: { screw: 4, pipe: 3 },
    power: 0,
    max: 1,
    // Coil is the rarest salvage and the Overcharged Coil needs one per
    // level; on a short run the roll could simply never produce it. A
    // standing bench guarantees the coil economy exists, so the upgrade it
    // exists to sell is always reachable.
    income: { screw: 2, pipe: 1, coil: 1 },
    note: 'A vice, a flat surface, and somewhere to put the gun down and open it up.',
    art: 'workbench',
  },
};

/* How many can stand at once. Only the Workbench is capped: a second one would
   not give the Engineer anything a first one does not, and a row of them would
   be a tile sink with no decision in it. Panels are the opposite — every one is
   another shot, so building more is the whole point. */
export const buildingsOf = (buildings, id) =>
  (buildings || []).filter(b => b.id === id).length;

export function canBuildMore(id, buildings){
  const building = BUILDINGS[id];
  if(!building) return false;
  return building.max === undefined || buildingsOf(buildings, id) < building.max;
}

/* ============================================================== upgrades === */

/* What the Workbench is for: salvage spent on the bolt gun rather than on more
 * ground. Both are repeatable, and both get dearer each time — an Engineer who
 * never stops upgrading should be feeling the cost, not compounding for free.
 *
 *   costs  base price; every level already bought adds `step` again
 *   adds   'card' puts another bolt gun in the deck, 'damage' makes them all hit harder
 */
export const UPGRADES = {
  barrel: {
    name: 'Second Barrel',
    adds: 'card',
    costs: { screw: 3, pipe: 2 },
    step: { screw: 2, pipe: 1 },
    note: 'Another barrel, another bolt in the deck. It is not elegant.',
  },
  coilwind: {
    name: 'Overcharged Coil',
    adds: 'damage',
    costs: { plating: 2, coil: 1 },
    step: { plating: 1, coil: 1 },
    note: 'Wind the coil tighter. Every bolt hits harder and the gun gets warm.',
  },
};

/* What the next level of an upgrade costs, given how many are already bought. */
export function upgradeCost(id, level = 0){
  const upgrade = UPGRADES[id];
  if(!upgrade) return null;
  const costs = {};
  for(const [resource, base] of Object.entries(upgrade.costs)){
    costs[resource] = base + level * ((upgrade.step || {})[resource] || 0);
  }
  return costs;
}

/* Power is the Engineer's other pool, and the only one that is not carried:
 * it is whatever the panels make, refilled at the start of every fight and
 * gone at the end of it. Hoarding is not a strategy — you either spent the
 * sunlight this round or you did not.
 */
export const powerFrom = buildings =>
  (buildings || []).reduce((sum, b) => sum + ((BUILDINGS[b.id] || {}).power || 0), 0);

/* What the party starts a run with.
 *
 * It must cover a Solar Panel on the first build phase — an Engineer who
 * cannot make power on round one has a bolt gun and no way to fire it, which
 * is a dead card in an opening hand.
 *
 * It also covers a Workbench, and deliberately not both: power now or upgrades
 * later is the Engineer's opening decision, and a test pins it so a balance
 * pass cannot quietly make the first move free.
 */
export const STARTING_SALVAGE = { screw: 5, pipe: 3, plating: 2, coil: 0 };

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
  /* The Alchemist's answer to the blight leaving something behind. Nothing
     else in the game removes an ailment, which is what makes her the only
     seat that can undo a Rust Hulk's afternoon. */
  censer: {
    name: 'Blight Censer', kind: 'heal', classId: 'alchemist', targetsAlly: true,
    effect: { kind: 'cleanse', amount: 2 },
    note: 'Smoke that the spores will not sit in. Hold it under whoever is coughing.',
  },
  vapours: {
    name: 'Restorative Vapours', kind: 'heal', classId: 'alchemist',
    effect: { kind: 'healAll', amount: 3 },
    note: 'Poured on the fire. Everyone standing near it breathes easier.',
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
  /* Guard on everyone, worse per head than Shore Up on one. That trade is the
     whole point of a party card: it is the wrong card at a table of one and
     the best card in the deck at a table of five. */
  bulwark: {
    name: 'Bulwark', kind: 'defend', classId: 'engineer',
    effect: { kind: 'wardAll', amount: 3 },
    note: 'Plate dragged into a line and braced. Get behind it, all of you.',
  },
  /* The only card that undoes a death. Deliberately not dead in solo — with
     nobody down it is a jolt to whoever is worst off — because a card that
     does nothing at a table of one would be a card the Engineer resents
     drawing rather than one they are pleased to be holding. */
  jumper: {
    name: 'Jumper Cables', kind: 'heal', classId: 'engineer', targetsAlly: true,
    effect: { kind: 'revive', amount: 6 },
    note: 'Across the chest, and mind your hands. Somebody has to get them up.',
  },

  /* --- the Wizard: a floor of a basic and the worst basic guard, which is
         the whole class in two cards — everything she is, she writes at the
         bench. The spark used to be the best basic attack in the game, and
         that was the wrong place for her power to live once the spells were
         hers to build. --- */
  spark: {
    name: 'Spark', kind: 'attack', classId: 'wizard',
    effect: { kind: 'strike', amount: 3 },
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

  /* The Wizard's two party cards, and both of them are about the fact that a
     bigger table draws a bigger wave.
     *
     Lend a Page is the clearest coordination card in the game: it does no
     damage at all, it lands on somebody else's *next* turn, and it is worth
     playing only if that person then swings. Two people have to agree about a
     round in advance for it to be worth a page. */
  channel: {
    name: 'Lend a Page', kind: 'buff', classId: 'wizard', pageCost: 1, targetsAlly: true,
    effect: { kind: 'might', amount: 4, rounds: 1 },
    note: 'Read over their shoulder and hold the line open. Swing on the next one.',
  },
  nova: {
    name: 'Cinder Nova', kind: 'attack', classId: 'wizard', pageCost: 1,
    effect: { kind: 'strikeAll', amount: 4 },
    note: 'A page burned all at once instead of read. It reaches everything in the lane.',
  },

  /* --- brewed ----------------------------------------------------------
   *
   * Made in the build phase and shuffled into the Alchemist's deck. They are
   * `consumed`: playing one takes it out of the deck for good rather than
   * sending it to the discard, which is what stops a good brew from being a
   * permanent upgrade and keeps the walk worth repeating.
   *
   * Each is strictly better than the basic it echoes — Tonic heals 4, Steady
   * Hands wards 4, Acid Flask strikes 3 — because brewing should always feel
   * like an upgrade over the card it dilutes.
   */
  sunsalve: {
    name: 'Sunsalve', kind: 'heal', brewed: true, consumed: true, targetsAlly: true,
    effect: { kind: 'heal', amount: 6 },
    note: 'Petals crushed into clean water. Hand it to whoever is worst off.',
  },
  stillwater: {
    name: 'Stillwater', kind: 'defend', brewed: true, consumed: true, targetsAlly: true,
    effect: { kind: 'ward', amount: 6, rounds: 1 },
    note: 'Drink it and the air stops biting. Works on anyone you can reach.',
  },
  greenfire: {
    name: 'Greenfire', kind: 'attack', brewed: true, consumed: true,
    effect: { kind: 'strike', amount: 8 },
    note: 'A whole array’s worth of stored afternoon, lit and thrown.',
  },

  /* --- the Engineer's --------------------------------------------------
   *
   * The bolt gun is the only card in the game that costs power, and power is
   * the only pool that is not carried: panels make it, a fight spends it, and
   * whatever is left evaporates. So a bolt gun in hand with no panel behind it
   * is a card you built wrong three minutes ago.
   *
   * It is not consumed — the gun is a gun, not a potion. What changes is how
   * many of them are in the deck and how hard they hit, both bought at the
   * workbench, which is why `upgradedBy` points at an upgrade rather than the
   * effect being a fixed number.
   */
  boltgun: {
    name: 'Bolt Gun', kind: 'attack', classId: 'engineer', powerCost: 1,
    upgradedBy: 'coilwind', upgradeStep: 3,
    effect: { kind: 'strike', amount: 9 },
    note: 'A captive bolt driver on a battery. Loud, ugly, and it goes through.',
  },

  /* --- universal -------------------------------------------------------
   *
   * The two everybody holds, one to swing and one to duck behind, so whatever
   * else the hand deals you there is something to do with it. Deliberately the
   * weakest of their kinds: the floor of a turn, not a plan.
   */

  /* Three damage is not a strategy, but it is a hand. Without it a party that
     spent its round building economy and drew no attack could only hold, which
     made a thin opening round unwinnable rather than hard. */
  strike: {
    name: 'Strike', kind: 'attack', universal: true,
    effect: { kind: 'strike', amount: 3 },
    note: 'A pipe, a pry bar, a fist. Whatever is closest.',
  },
  hold: {
    name: 'Hold', kind: 'defend', universal: true,
    effect: { kind: 'ward', amount: 2, rounds: 1 },
    note: 'Put your back to something and wait it out.',
  },

  /* Granted by a standing building, to everyone's deck — the site fires the
     pylon, not the person. This is the two-phase loop's point of contact:
     what you built is literally what you draw. */
};

/* What each class opens with. Ten cards, of which two are the party cards: at
   three drawn and three discarded a turn the deck cycles about every four
   turns, so a fight sees the whole thing twice and a player learns what is in
   theirs.
 *
 * One copy each of the party cards rather than two, on purpose. They are the
 * cards a table coordinates around, and a card you hold every other turn is
 * not a moment — it is a rotation. */
export const STARTING_DECKS = {
  alchemist: { flask: 3, steady: 3, tonic: 2, censer: 1, vapours: 1 },
  engineer: { wrench: 3, shore: 4, boltgun: 1, bulwark: 1, jumper: 1 },
  wizard: { spark: 4, sign: 2, fireball: 2, channel: 1, nova: 1 },
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

/* ================================================== compatibility shims === */

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
export function cardPlayable(cardId, { pages = 0, power = 0, classId = null } = {}){
  const card = CARDS[cardId];
  if(!card) return false;
  if(card.classId && classId && card.classId !== classId) return false;
  if(card.pageCost && pages < card.pageCost) return false;
  if(card.powerCost && power < card.powerCost) return false;
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

/* =========================================================== the garden === */

/* Three pots by the campfire, and the Alchemist's reason to think past the
 * round in front of her. A cutting planted this round is worth nothing yet;
 * left alone it doubles, then doubles the doubling — so every build phase
 * asks the same quiet question of each pot: brew it this fight, or let it
 * grow toward the boss.
 *
 * The pots are the Alchemist's mirror of the site itself: they persist
 * across rounds the way the Engineer's buildings do, and they are the only
 * part of her economy that compounds.
 */
export const POT_COUNT = 3;

/* What a pot gives back, by how many rounds the cutting has sat in it.
 * Age zero — planted this very round — refunds the cutting and nothing
 * more, so replanting a misclick is free and farming a same-round loop is
 * pointless. The ladder tops out rather than climbing forever: a run is
 * four rounds long, and the top rung is the boss-round payoff.
 */
export const potYield = age =>
  age <= 0 ? 1 : [2, 4, 6][Math.min(age - 1, 2)];

/* One name per rung, for the pot card and the log. */
export const potStage = age =>
  age <= 0 ? 'sprouting' : age === 1 ? 'growing' : age === 2 ? 'flourishing' : 'in bloom';

/* Plant one cutting from the stash. Returns { pots, stash } or null when the
   pot is missing, occupied, or the stash has none of the herb — the caller
   cannot half-plant. */
export function plantPot(pots, index, herb, stash){
  if(!MATERIALS[herb]) return null;
  if(index < 0 || index >= (pots || []).length || pots[index]) return null;
  if(((stash || {})[herb] || 0) < 1) return null;
  const next = [...pots];
  next[index] = { herb, age: 0 };
  return { pots: next, stash: { ...stash, [herb]: stash[herb] - 1 } };
}

/* Pull a pot's crop into the stash. Returns { pots, stash, herb, yielded }
   or null on an empty pot. */
export function harvestPot(pots, index, stash){
  const pot = (pots || [])[index];
  if(!pot) return null;
  const next = [...pots];
  next[index] = null;
  const yielded = potYield(pot.age);
  return {
    pots: next,
    stash: { ...stash, [pot.herb]: ((stash || {})[pot.herb] || 0) + yielded },
    herb: pot.herb,
    yielded,
  };
}

/* One round older, every planted pot. Called as the build phase opens. */
export const growPots = pots =>
  (pots || []).map(pot => (pot ? { ...pot, age: pot.age + 1 } : null));

/* =========================================================== spellcraft === */

/* The Wizard's build phase: she does not buy spells, she assembles them.
 *
 * A page spent in the build phase turns over a draft of three — spells she has
 * not learned and modifiers from the list below — and she keeps one. Modifiers
 * socket into a spell, up to SPELL_SLOTS each, and can be pulled out and
 * rearranged freely between fights. The order of the sockets is the order the
 * arithmetic runs in: +5 into a doubler is 30, a doubler into +5 is 25, and
 * which one you meant is the whole game of holding the pieces.
 *
 * A spell's `charges` is how many copies of it enter her deck at the surge.
 * The copies are spent when played — the brew machinery, reused — and come
 * back at the next surge, because the spell is written down and a page read
 * aloud is not a page destroyed. So a crafted spell is permanent the way the
 * Engineer's barrel is, and bounded the way the Alchemist's brews are.
 *
 * These tables are deliberately the swappable layer. The machinery —
 * composeSpell, the draft, the sockets — does not know what a modifier is
 * beyond its `op`, so rebalancing or replacing the whole list is data entry.
 */

export const SPELL_SLOTS = 3;

/* Pages the library yields at the start of each build phase, on top of
   whatever the map is holding. Income rather than only foraging, because the
   draft is the class's whole game and a round with no page is a round the
   Wizard spent watching other people play theirs. */
export const PAGES_PER_ROUND = 2;

/* The three bones every build starts from. `verb` is an EFFECT_KINDS entry —
 * the engine resolves a crafted spell exactly as it resolves a card, so a
 * spell cannot do anything a card could not.
 *
 *   amount   what it lands for, before the sockets have their say
 *   charges  copies dealt into the deck each surge, before the sockets
 */
export const SPELLS = {
  fireball: {
    name: 'Fireball', kind: 'attack', verb: 'strike', amount: 10, charges: 2,
    note: 'One page, read aloud, thrown. The margins are where you make it yours.',
  },
  nova: {
    name: 'Cinder Nova', kind: 'attack', verb: 'strikeAll', amount: 4, charges: 2,
    note: 'A page burned all at once instead of read. It reaches everything in the lane.',
  },
  channel: {
    name: 'Lend a Page', kind: 'buff', verb: 'might', amount: 4, charges: 2, targetsAlly: true,
    note: 'Read over their shoulder and hold the line open. Swing on the next one.',
  },
};

/* What a draft can turn over, beside a spell. An `op` is folded into the
 * spell's numbers in socket order; the flag ops do not care about order and
 * simply accumulate.
 *
 *   amount     added to what it lands for
 *   mult       what it lands for, multiplied (rounded up — the fun direction)
 *   charges    added to the copies dealt each surge
 *   aoe        a single-target spell reaches the whole lane
 *   selfWard   the caster gains this much guard when it is cast
 *   leech      the caster heals this fraction of the damage it deals
 *   hpCost     casting costs this much health — it cannot take the last point
 *   farthest   it lands on the farthest enemy instead of the nearest
 *   pageOnKill a kill with it puts pages back in the library
 *   opening    one copy is dealt into the surge's first hand
 */
export const MODIFIER_WEIGHTS = { common: 5, uncommon: 3, rare: 1 };

export const MODIFIERS = {
  kindling: {
    name: 'Kindling Script', rarity: 'common', op: { amount: 5 },
    note: 'Re-inked hotter. The simplest thing to do to a spell, and never wrong.',
  },
  echo: {
    name: 'Echo Script', rarity: 'common', op: { charges: 1, amount: -3 },
    note: 'Copied in a hurry. More of it, less of each.',
  },
  emberward: {
    name: 'Ember Ward', rarity: 'common', op: { selfWard: 3 },
    note: 'The heat that comes off the reading, kept close instead of wasted.',
  },
  siphon: {
    name: 'Siphon Glyph', rarity: 'uncommon', op: { leech: 0.5 },
    note: 'What it takes out of them, half finds its way back to you.',
  },
  farsight: {
    name: 'Farsight Ink', rarity: 'uncommon', op: { amount: 2, farthest: true },
    note: 'It lands where you are looking, and you can look all the way back.',
  },
  gilded: {
    name: 'Gilded Margin', rarity: 'uncommon', op: { pageOnKill: 1 },
    note: 'A kill worth writing down pays for the paper it is written on.',
  },
  opening: {
    name: 'Opening Word', rarity: 'uncommon', op: { opening: true },
    note: 'The first thing said when the surge arrives. It is in your opening hand.',
  },
  twin: {
    name: 'Twin Core', rarity: 'rare', op: { mult: 2, charges: -1 },
    note: 'Two readings folded into one breath. Twice the spell, and fewer of it.',
  },
  split: {
    name: 'Splitting Sigil', rarity: 'rare', op: { aoe: true, mult: 0.6 },
    note: 'The spell forgets how to miss anyone. It also forgets how to focus.',
  },
  bloodpact: {
    name: 'Bloodpact Seal', rarity: 'rare', op: { amount: 8, hpCost: 2 },
    note: 'Signed in the only ink that never runs out. It runs out.',
  },
};

/* A fresh spellbook: Fireball known and bare, nothing in the satchel.
 *
 *   known   spell ids, in the order learned
 *   satchel modifier ids owned and not socketed (duplicates allowed — two
 *           Kindlings are two sockets' worth)
 *   slots   spellId -> [modifier ids], the sockets in arithmetic order
 */
export const freshSpellbook = () => ({
  known: ['fireball'],
  satchel: [],
  slots: { fireball: [] },
});

/* What a spell does with these sockets, resolved. This is to spellcraft what
 * cardEffect is to upgrades: CARDS and SPELLS stay declarative and the live
 * numbers happen here, on both sides of the wire, so the bench and the surge
 * can never disagree about what a Fireball has become.
 *
 * Folded left to right. Multiplication rounds up, and the clamps run last:
 * a spell always lands for at least 1 and always deals at least 1 copy, so
 * no arrangement of sockets can craft a spell out of existing.
 */
export function composeSpell(spellId, modIds = []){
  const spell = SPELLS[spellId];
  if(!spell) return null;

  let amount = spell.amount;
  let charges = spell.charges;
  let verb = spell.verb;
  const flags = { selfWard: 0, leech: 0, hpCost: 0, pageOnKill: 0, farthest: false, opening: false };

  for(const modId of modIds){
    const op = (MODIFIERS[modId] || {}).op;
    if(!op) continue;
    if(op.amount) amount += op.amount;
    if(op.mult) amount = Math.ceil(amount * op.mult);
    if(op.charges) charges += op.charges;
    if(op.aoe && verb === 'strike') verb = 'strikeAll';
    if(op.selfWard) flags.selfWard += op.selfWard;
    if(op.leech) flags.leech += op.leech;
    if(op.hpCost) flags.hpCost += op.hpCost;
    if(op.pageOnKill) flags.pageOnKill += op.pageOnKill;
    if(op.farthest) flags.farthest = true;
    if(op.opening) flags.opening = true;
  }

  amount = Math.max(1, amount);
  charges = Math.max(1, charges);

  const effect = verb === 'might'
    ? { kind: verb, amount, rounds: 1 }
    : { kind: verb, amount };

  return { id: spellId, name: spell.name, kind: spell.kind, verb, amount, charges,
           targetsAlly: !!spell.targetsAlly, effect, flags };
}

/* Every modifier the book holds, wherever it is sitting. */
export const ownedModifiers = spellbook => [
  ...(spellbook.satchel || []),
  ...Object.values(spellbook.slots || {}).flat(),
];

/* The draft a page turns over: three distinct options from what she does not
 * know and does not own. Each modifier exists once — the worked example's 30
 * is the ceiling a Fireball can reach, not the floor a lucky third Kindling
 * doubles past — and it keeps every draft a draft of new things. Spells she
 * has not learned are weighted like an uncommon find; modifiers by their
 * rarity. The generator is the room's, as everywhere — a draft that rolled
 * differently on a replay would be a draft the room cannot stand behind.
 */
export const SPELL_OFFER_WEIGHT = 3;

export function rollOffers(random, spellbook, count = 3){
  const pool = [];
  for(const id of Object.keys(SPELLS)){
    if(!(spellbook.known || []).includes(id)) pool.push({ type: 'spell', id, weight: SPELL_OFFER_WEIGHT });
  }
  const owned = ownedModifiers(spellbook);
  for(const [id, mod] of Object.entries(MODIFIERS)){
    if(!owned.includes(id)) pool.push({ type: 'mod', id, weight: MODIFIER_WEIGHTS[mod.rarity] || 1 });
  }

  const offers = [];
  for(let i = 0; i < count && pool.length; i++){
    const total = pool.reduce((sum, option) => sum + option.weight, 0);
    let point = random() * total;
    let at = pool.length - 1;
    for(let j = 0; j < pool.length; j++){
      point -= pool[j].weight;
      if(point <= 0){ at = j; break; }
    }
    const [option] = pool.splice(at, 1);
    offers.push({ type: option.type, id: option.id });
  }
  return offers;
}

/* How much the library can still surprise her with: spells unlearned plus
   modifiers unowned. Zero means a page has nothing left to open, and both
   the room and the button read this so neither can spend one on nothing. */
export const draftableCount = spellbook =>
  Object.keys(SPELLS).filter(id => !(spellbook.known || []).includes(id)).length +
  Object.keys(MODIFIERS).filter(id => !ownedModifiers(spellbook).includes(id)).length;

/* Take one offer into the book. Returns the next spellbook, or null if the
   index is not an offer — the caller cannot half-apply a pick. */
export function takeOffer(spellbook, offers, index){
  const offer = (offers || [])[index];
  if(!offer) return null;
  if(offer.type === 'spell'){
    if((spellbook.known || []).includes(offer.id)) return null;
    return {
      ...spellbook,
      known: [...spellbook.known, offer.id],
      slots: { ...spellbook.slots, [offer.id]: [] },
    };
  }
  return { ...spellbook, satchel: [...spellbook.satchel, offer.id] };
}

/* Move one modifier: out of wherever it is, into a socket or back to the
 * satchel (spellId null). `pos` is the socket it lands in front of, so the
 * arithmetic order is the player's to arrange. Returns the next spellbook or
 * null when the move is not legal — an unknown spell, a full bench, a
 * modifier she does not own.
 */
export function moveModifier(spellbook, modId, spellId = null, pos = SPELL_SLOTS){
  if(!MODIFIERS[modId]) return null;
  if(spellId !== null && !(spellbook.known || []).includes(spellId)) return null;

  // Pull one copy from the satchel or from whichever spell holds it.
  let satchel = [...(spellbook.satchel || [])];
  const slots = Object.fromEntries(
    Object.entries(spellbook.slots || {}).map(([id, mods]) => [id, [...mods]]));
  const inSatchel = satchel.indexOf(modId);
  if(inSatchel >= 0) satchel.splice(inSatchel, 1);
  else {
    const holder = Object.keys(slots).find(id => slots[id].includes(modId));
    if(!holder) return null;
    slots[holder].splice(slots[holder].indexOf(modId), 1);
  }

  if(spellId === null){
    satchel.push(modId);
  }else{
    const bench = slots[spellId] || (slots[spellId] = []);
    if(bench.length >= SPELL_SLOTS) return null;
    bench.splice(Math.max(0, Math.min(bench.length, pos)), 0, modId);
  }
  return { ...spellbook, satchel, slots };
}

/* The base the Wizard fights with before the book has its say. Slimmer than
   the old fixed deck on purpose: the crafted copies are the class now, and
   the kit is what stops a bare round-one book from being an empty hand. */
export const WIZARD_BASE_KIT = { spark: 3, sign: 2 };

/* The deck the Wizard takes into a surge: the kit, the universals, and
 * `charges` copies of every spell in the book, as composed right now. The
 * copies are consumed when played and re-dealt here next surge — the room
 * rebuilds this at every enterCombat, which is what makes charges per-combat
 * without a counter anywhere.
 */
export function wizardCombatDeck(spellbook){
  const deck = [];
  for(const [id, n] of Object.entries(WIZARD_BASE_KIT)){
    for(let i = 0; i < n; i++) deck.push(id);
  }
  deck.push(...UNIVERSAL_CARDS);
  for(const spellId of (spellbook && spellbook.known) || []){
    const composed = composeSpell(spellId, (spellbook.slots || {})[spellId]);
    if(!composed) continue;
    for(let i = 0; i < composed.charges; i++) deck.push(spellId);
  }
  return deck;
}

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
/* `ability` is what this thing does to a player beyond subtracting from them,
 * and `every` is how many of its hits have to land first — an ailment on every
 * swing is not a threat, it is a status the player simply has. A blocked hit
 * never counts, which is the whole reason to spend a card on guard against a
 * Creeper rather than trading with it.
 *
 * `threat` is the levelling number: what one of these is worth against one
 * player. It is what waveFor spends, so a table of four meets four players'
 * worth of blight rather than five players' worth trimmed down to four.
 */
export const ENEMIES = {
  sporeling: { name: 'Sporeling', hp: 6, hits: 2, dist: 3, art: 'sporeling',
    threat: 1, ability: { id: 'rot', every: 2 },
    note: 'A puffball with intent. Pops wetly, and you breathe what comes out.' },
  creeper: { name: 'Creeper', hp: 10, hits: 3, dist: 4, art: 'creeper',
    threat: 2, ability: { id: 'weak', every: 2 },
    note: 'Vine over bone over something that used to be a drone. The sap gets into you.' },
  hulk: { name: 'Rust Hulk', hp: 18, hits: 5, dist: 5, art: 'hulk',
    threat: 3.5, ability: { id: 'stun', every: 3 },
    note: 'A maintenance chassis the blight wears like a coat. It swings like one too.' },
  extractor: { name: 'The Extractor', hp: 33, hits: 5, dist: 5, art: 'extractor', boss: true,
    threat: 9, ability: { id: ['weak', 'rot', 'stun'], every: 2 },
    note: 'It was built to harvest. It still is, and it works through a crew in order.' },
};

/* The boss is the one enemy the wave table cannot level, because there is
 * always exactly one of it. Everything else scales by arriving in different
 * numbers; the Extractor has to scale in the only direction left, which is up.
 *
 * Health scales because three people put out three people's damage. Damage
 * scales for a subtler reason: a single enemy hits one player a round, so at a
 * table of three the same number is a third of the pressure it is on a table of
 * one. Holding per-player pressure flat means the number climbs with the table
 * — an Extractor that hit a party of five for what it hits a solo player for
 * would be a cutscene.
 *
 * Both are per *extra* player, so ENEMIES holds the solo fight and this holds
 * how it grows.
 */
export const BOSS_SCALING = { hp: 22, hits: 3 };

/* An enemy's numbers for this table. Everything but the boss is what the table
   says it is; levelling the rest is waveFor's job and doing it twice would
   compound. */
export function enemyStats(type, partySize = PARTY_SIZE){
  const def = ENEMIES[type];
  if(!def) return null;
  const extra = Math.max(0, Math.min(PARTY_SIZE, Math.max(1, partySize)) - 1);
  return def.boss
    ? { hp: Math.round(def.hp + BOSS_SCALING.hp * extra),
        hits: Math.round(def.hits + BOSS_SCALING.hits * extra),
        dist: def.dist }
    : { hp: def.hp, hits: def.hits, dist: def.dist };
}

/* The ailment cadence, normalised: one id or a list, always a list here, so
   the boss cycling through all three and a Sporeling doing one thing are the
   same loop at the call site. */
export function enemyAbility(type){
  const spec = (ENEMIES[type] || {}).ability;
  if(!spec) return null;
  const ids = (Array.isArray(spec.id) ? spec.id : [spec.id]).filter(id => AILMENTS[id]);
  if(!ids.length) return null;
  return { ids, every: Math.max(1, spec.every || 1) };
}

/* Which ailment this enemy's nth landed hit carries, or null. Pure arithmetic
   on a counter the room keeps, rather than a roll: a wave that surprises you
   differently on a replay is a wave the room and the client can disagree
   about. */
export function ailmentOnHit(type, landed){
  const spec = enemyAbility(type);
  if(!spec || landed <= 0 || landed % spec.every) return null;
  return spec.ids[(landed / spec.every - 1) % spec.ids.length];
}

/* ---- levelling the encounter to the table ------------------------------- */

/* What one player is worth in blight, by round. This is the difficulty dial,
 * and it is the only one: everything else about a wave falls out of it.
 *
 * Held deliberately low on round one and climbing after, because the party's
 * side of the equation climbs too — the Alchemist has brewed by round two and
 * the Engineer has a panel behind the bolt gun.
 *
 * These are measured, not guessed. test/balance.mjs plays whole runs per
 * table size against them and reports the win rate; at the numbers below it
 * lands 69% / 63% / 78% for one, two and three players, against a target of
 * 60. The full table runs friendliest on purpose: it is the only one with a
 * Wizard, she is the party's damage by design, and the harness plays her
 * bench well. Change these with that harness open rather than by eye — the
 * threat values are coarse (1, 2, 3.5), so a tenth of a point here can flip a
 * whole enemy into or out of a wave and move a win rate forty points.
 *
 * Round four's number is low because it buys the boss's *escort* only; the
 * Extractor itself is outside the budget. That is also why nearly every loss
 * the harness reports is a round-four loss: the first three rounds rarely kill
 * a party outright, they decide what the party brings to the appointment.
 */
export const THREAT_PER_PLAYER = [2.5, 3.4, 4.2, 2.9];

/* A party is worth more than the players in it, and the budget has to know it.
 *
 * This was linear first, and the harness was blunt about it: at settings that
 * left a solo player winning three runs in five, two players won ninety-seven.
 * Doubling the wave does not double the difficulty, because the second player
 * brings things a lone player has no version of — somebody to spread the
 * round-robin over, a second class's whole verb, a card that mends a person
 * who is not themselves, and the plain fact that a party can lose a member and
 * keep fighting where a solo player losing one is the run.
 *
 * So each player after the first makes every player worth more blight. The
 * number is measured, not reasoned: it is what closes the gap between the
 * table sizes in test/balance.mjs.
 */
export const PARTY_SYNERGY = 0.35;

/* How much blight a table of this size meets this round. */
export function threatBudget(round, partySize = PARTY_SIZE){
  const size = Math.max(1, Math.min(PARTY_SIZE, partySize));
  const per = THREAT_PER_PLAYER[Math.min(round, BOSS_ROUND) - 1] ?? THREAT_PER_PLAYER[0];
  return per * size * (1 + PARTY_SYNERGY * (size - 1));
}

/* What each round sends, in the order it sends it. The list is a pattern and
   not a wave: waveFor cycles it until the budget is spent, so the composition
   of a round is the same shape at every table size and only the amount of it
   changes. */
const WAVE_PATTERN = {
  1: ['sporeling', 'sporeling', 'creeper'],
  2: ['sporeling', 'creeper', 'creeper', 'sporeling'],
  3: ['creeper', 'hulk', 'creeper', 'sporeling'],
  [BOSS_ROUND]: ['creeper', 'sporeling', 'creeper', 'hulk'],
};

/* Six is what the lane can show. Beyond it the sprites share rows and the
   wave reads as one smear, so a bigger budget makes the wave *worse* rather
   than longer — see the upgrade pass below. */
export const WAVE_CAP = 6;

/* The ladder a leftover budget climbs. Ordered by threat, so "spend the
   remainder on making the weakest thing here worse" is a walk down one list. */
const TIERS = ['sporeling', 'creeper', 'hulk'];

/* The wave a given table meets on a given round.
 *
 * Two passes, and the second one is what makes a full table harder rather than
 * merely busier. First fill: cycle the round's pattern, adding while the
 * budget covers the next thing and the lane has room. Then upgrade: whatever
 * budget is left promotes the weakest enemy present up the tier ladder.
 *
 * So a solo player on round one meets two Sporelings; five players meet a
 * fuller lane of worse things. Same fight, levelled — not the five-player
 * fight with three of them deleted, which is what trimming a fixed table gave
 * and why a lone player used to walk it.
 *
 * The boss is outside the budget entirely. It is the appointment, it is in
 * every version of round four, and the budget buys its escort.
 */
export function waveFor(round, partySize = PARTY_SIZE){
  const at = Math.min(Math.max(1, round), BOSS_ROUND);
  const pattern = WAVE_PATTERN[at] || WAVE_PATTERN[BOSS_ROUND];
  const boss = at >= BOSS_ROUND;
  const wave = boss ? ['extractor'] : [];
  const room = WAVE_CAP - wave.length;

  let budget = threatBudget(at, partySize);
  for(let i = 0; wave.length - (boss ? 1 : 0) < room; i++){
    const type = pattern[i % pattern.length];
    const cost = ENEMIES[type].threat;
    if(cost > budget){
      // Nothing in a whole pass fits: the budget is spent on filling.
      if(pattern.every(t => ENEMIES[t].threat > budget)) break;
      continue;
    }
    budget -= cost;
    wave.push(type);
  }

  // A wave of nothing is not a round. The cheapest thing in the pattern goes
  // in regardless — a budget too small to buy a Sporeling means the table is
  // one person on round one, and they should still have something to fight.
  if(!wave.length) wave.push(pattern[0]);

  // The remainder, spent on quality. Weakest first and one at a time, so the
  // lane levels evenly: five players get a Rust Hulk where one player gets the
  // Sporeling that stood in its place, rather than one monster at the front
  // absorbing the entire difference.
  for(let pass = 0; pass < WAVE_CAP * TIERS.length; pass++){
    let pick = -1, pickTier = TIERS.length;
    for(let i = 0; i < wave.length; i++){
      const tier = TIERS.indexOf(wave[i]);
      if(tier < 0 || tier + 1 >= TIERS.length) continue;
      if(ENEMIES[TIERS[tier + 1]].threat - ENEMIES[wave[i]].threat > budget) continue;
      if(tier < pickTier){ pick = i; pickTier = tier; }
    }
    if(pick < 0) break;
    const next = TIERS[pickTier + 1];
    budget -= ENEMIES[next].threat - ENEMIES[wave[pick]].threat;
    wave[pick] = next;
  }

  return wave;
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
  /* The camp. Three kinds, all of them terrain rather than buildings on
     purpose: every rule that matters — walking, building, growing, spawning,
     pathing — already reads TERRAIN, so the whole footprint costs these lines
     and a stamp instead of a footprint-aware rewrite of all of it.

     The fire is solid for the same reason a pond is: you do not stand in it,
     and it has to be unstandable for "the party spawns around the fire" to
     mean anything. */
  tent:    { name: 'The tent',    walk: false, build: false, grows: false },
  camp:    { name: 'The clearing', walk: true, build: true,  grows: false },
  fire:    { name: 'The fire',    walk: false, build: false, grows: false },
};

/* Where the camp stands. Dead centre, fixed rather than rolled: it is the one
 * thing on a site that is the same every run, which is what makes coming back
 * to it feel like coming back.
 *
 * CAMP_X/CAMP_Y is the middle of the clearing, and the fire is on it. The tent
 * sits above, as a backdrop — a tent is somewhere you sleep, and the fire is
 * the thing people actually gather at, so the fire is what the camp is
 * arranged around and what the party spawns in a ring about.
 *
 *        :###:      the tent, 3x3, solid
 *        :###:
 *        :###:
 *        :::::      the clearing
 *        ::*::      the fire, at its centre
 *        :::::
 */
export const CAMP_X = Math.floor(MAP_W / 2);
export const CAMP_Y = Math.floor(MAP_H / 2);
export const CAMP_RADIUS = 2;               // the clearing's half-width
/* Centre row of the 3x3 tent. Four rows up rather than three: at three, the
   seats on the near side of the fire stood directly against the tent's base and
   covered two thirds of it, so the backdrop the tent is meant to be was mostly
   a hat above somebody's head. */
export const TENT_Y = CAMP_Y - 4;

/* The camp's whole footprint, from the tent's top row to the clearing's foot.
   `margin` widens it, which is how the tree pass keeps a canopy far enough away
   that it cannot be drawn over the camp. */
export const inCamp = (x, y, margin = 0) =>
  Math.abs(x - CAMP_X) <= CAMP_RADIUS + margin &&
  y >= TENT_Y - 1 - margin && y <= CAMP_Y + CAMP_RADIUS + margin;

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
