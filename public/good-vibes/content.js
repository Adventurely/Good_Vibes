/* Good Vibes — game content.
 *
 * Everything here is data. It is imported by the authoritative room object,
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
 * --- What lives somewhere else --------------------------------------------
 *
 * The Hauler's pack is in `pack.js` and re-exported below. It is self-contained
 * geometry over its own tables, this file was already 2900 lines carrying five
 * economies, and the property that matters was never "one file" — it is one
 * *import surface*. A re-exported name is defined on this module's namespace
 * object identically to a local one, so the Worker's import, the browser's, and
 * the published-contract test in test/content.test.js cannot tell the
 * difference. The rule that keeps it safe is that pack.js imports nothing from
 * here: a cycle between the two would put a live binding in the temporal dead
 * zone at module scope, which is a throw at the top of the deployed Worker.
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
 *   haul      true if this class packs a bag in the build phase. The Hauler's,
 *             and the reason he has a bench at all — see pack.js.
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

/* The Hauler's pack, re-exported so this module's export list is still the
   whole rule set. Named explicitly rather than with `export *`, because that
   list is a contract the deployed Worker imports at its top level and a
   contract should read like one. */
export {
  PACK_W, PACK_H, PACK_GRIDS, PACK_SHAPES, PACK_ITEMS, PACK_KINDS,
  gridFor, gridHas, gridCells,
  packItem, packCard, packAt, packFilled, packUsed,
  packFits, packPlace, packMove, packRemove, packSpill,
  packedCards, packedStats, packedAmount,
  rotateCells, shapeCells, itemCells, rotationsOf,
  rollPackItems, freshPack, normalisePack,
} from './pack.js';

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
    rarity: 11,
    colour: 'M',
    note: 'Every ruin is mostly fasteners. Somebody built all this once.',
  },
  coil: {
    name: 'Coil',
    rarity: 7,
    colour: 'c',
    note: 'Copper wound tight around a core that still hums when you hold it.',
  },
  chip: {
    name: 'Chips',
    rarity: 4,
    colour: 'x',
    note: 'Green boards prised out of dead machines, and somebody’s whole trade still printed on them.',
  },
};

/* Three piles, and the split is the whole of the Engineer's design.
 *
 * Screws are the works: panels, and the four lines that pay the party out
 * every round. Coil is the community: the four machines that make somebody
 * *else's* build phase bigger. Chips are know-how, and buy abilities.
 *
 * They are separate piles on purpose. The Engineer never chooses between his
 * own gun and the party's press, because they do not come out of the same
 * pocket — helping the table is not a sacrifice, it is the other half of the
 * board. The one decision that is a real fork lives inside screws: see
 * `worksFrom`.
 *
 * Pipe and Plating were folded into Screws when the piles went from four to
 * three. Four resources across two spends was bookkeeping; three across three
 * is a shape.
 */

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

/* What this seat gets out of that node, and 0 when the node is not theirs to
 * take.
 *
 * Aptitude, not permission. Every kind is priced off the stat its class was
 * already built around — `gather` for herbs, `salvage` for caches, casting for
 * pages — so the same tile is worth a different amount depending on who stoops,
 * and a seat the stat says is worth nothing there leaves it standing for one it
 * suits.
 *
 * That is deliberately not the old locked door. A herb was once the
 * Alchemist's alone, which made four of the five seats walk past the thing the
 * build phase is mostly made of and left a party without her unable to brew at
 * all; every live class gathers, so herbs stay open to the whole party and she
 * is simply worth two of anybody at one. A cache is the other shape: it is not
 * a shelf of ingredients but a wreck that has to be read back into parts, and
 * three of the five seats can read one — the Engineer at three times a Hauler.
 * Pages are the Wizard's alphabet and nobody else's, and no other seat could
 * ever spend one, because `openPage` has always refused them.
 */
export function nodeYield(cls, node){
  if(!cls || !node) return 0;
  if(node.kind === 'herb') return cls.gather || 0;
  if(node.kind === 'salvage') return cls.salvage || 0;
  if(node.kind === 'pages') return cls.cast ? CACHE_YIELD.pages : 0;
  return 0;                                   // a kind nobody has written yet
}

/* Why a seat left a node standing, said in that seat's own terms. One line per
   kind and one place, so the room and the solo mirror in `play.html` cannot
   drift into two explanations of the same refusal. */
export const NODE_REFUSAL = {
  herb: 'cannot tell which end of it is the useful one.',
  salvage: 'turns the cache over and cannot read one part out of another.',
  pages: 'cannot read a line of it. The pages keep for a Wizard.',
};

/* What a site puts out with this particular party standing on it.
 *
 * SPAWNS itself is untouched, so every caller and every test that reads it
 * directly still reads the same numbers; this is the party-aware wrapper the
 * room uses.
 *
 * Salvage and pages only — never herbs. The herb count is the one number the
 * whole scarcity design rests on: five nodes at two units each is ten against
 * the eleven that one of each recipe costs, so a full sweep can never pay for
 * everything. A sixth node would quietly delete that, and a test pins it.
 */
export function spawnsFor(players){
  const extra = (players || []).reduce(
    (n, p) => n + ((classById(p.classId) || {}).scout || 0), 0);
  return { ...SPAWNS, salvage: SPAWNS.salvage + extra, pages: SPAWNS.pages + extra };
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
  /* on the wave, and the first things in this list that are not a strike:
     canker is damage already inside the thing when the round ends. It never
     goes near strikePower, so nothing buffs it and nothing weakens it. */
  'canker', 'cankerAll',
  /* on yourself, and bought with health — see `hpCost`. `cover` is the only
     card that decides *who* a blow lands on; `heft` is the only buff that
     outlives the round that granted it. */
  'heft', 'cover',
  /* into an ally's deck. The only effect that changes what somebody else will
     be holding next round. */
  'graft',
  /* on the works, and on nobody. The Engineer's lines pay out at the top of
     every round whether or not he acts; this tells them not to, and to pay
     double when they next do. The only effect in the list that lands on the
     room rather than on a body. */
  'hold',
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
  heft: { name: 'Heft', kind: 'heft', colour: 'o', note: 'Weight already moving. It does not wear off before the fight does.' },
  cover: { name: 'Covering', kind: 'cover', colour: 'b', note: 'Standing in front. The wave comes here while the guard holds.' },
};

/* What the party leaves on the wave, as opposed to what it takes off it.
 * AILMENTS with the arrow reversed, and so far there is exactly one. Kept as a
 * table rather than a special case so effectName() can name it and the client
 * can draw a pip on an enemy the way it draws one on a player. */
export const BLIGHTS = {
  canker: { name: 'Canker', kind: 'canker', colour: 'v',
    note: 'A ring cut in it that will not close. It is not finished with it yet.' },
};

export const effectName = kind =>
  (AILMENTS[kind] || BOONS[kind] || BLIGHTS[kind] || {}).name || kind;

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
  canker: 'canker one',
  cankerAll: 'canker every enemy',
  heft: 'heft, for the fight',
  cover: 'take the hits',
  graft: 'deal an ally a card',
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
    /* Bought for the fight rather than rented for a round, and so far only
       Heft is — which is why Heft costs health and nothing else does.
       enterCombat empties every player's effects, so "for the fight" is
       literally true and needs no expiry number to stay honest. Stored with no
       `rounds` rather than a large one, because the client prints the number
       beside the name and a chip reading "Heft 99" is a leak. */
    if(effect.lasting){ next.push(effect); continue; }
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
  Math.max(1, amount
    + effectAmount(effects, 'might')
    + effectAmount(effects, 'heft')
    - effectAmount(effects, 'weak'));

/* The cards every deck holds regardless of class, by id. Kept as its own
   export for the reason everything at the foot of this file is kept — see the
   note there; UNIVERSAL_CARDS derives the same list from the card table and is
   what the client reads.

   Strike is here rather than in a class deck for the reason it exists at all:
   a party that built economy and drew no attack still has hands, and a fight
   nobody can swing in is arithmetic, not a fight. */
export const BASE_ACTIONS = ['strike', 'hold'];

/* COMBAT_ACTIONS is now the card table, aliased below where CARDS is defined.
   Every one of these lives in a deck. */

/* ============================================================ buildings === */

/* What the Engineer puts on the map, and the reason the build phase matters.
 *
 * A building is not a stat. It is a tile you chose to spend, and what it buys
 * is a **standing payout to the whole party** — every round, automatically,
 * costing nobody a turn. That is the seat's whole identity and the one thing
 * no other class can copy: the Hauler's bag can pack a card that does what a
 * Bulwark did, but it cannot pack a thing that keeps working while he is doing
 * something else. The Engineer's contribution already happened.
 *
 * Five lines. Four pay the party, one pays him:
 *
 *   array      power, to the Engineer, per fight
 *   ward       guard on every seat, at the top of every round
 *   might      a harder swing for every seat, at the top of every round
 *   burn       damage on the nearest enemy, at the top of every round
 *   mend       health for every seat, once, when the fight ends
 *
 * `mend` is the odd one and deliberately so: healing every round was simply
 * the best line in the game, so it fires once and pays more. It is between-
 * fight economy rather than combat sustain, and no ability draws it — which
 * is what stops it spiking.
 *
 * Fields:
 *
 *   costs   salvage spent to raise it, checked against the shared pool
 *   line    which payout it feeds, and `pays` is how much
 *   power   panels only; the array is adjacency-scored, see `worksFrom`
 *   carry   unspent power survives the fight, this many points of it
 *   grants  what somebody else's build phase gets while it stands
 *   place   where it may stand — see `placeRefusal`
 *   max     how many may stand at once
 *   art     key into BUILDING_ART — client-only, like every art key here
 */
export const BUILDINGS = {

  /* ---- the array: power, and only the Engineer spends it -------------- */

  panel: {
    name: 'Solar Panel',
    costs: { screw: 3 },
    line: 'array',
    power: 1,
    note: 'Cracked, half-blind, and still tracking the sun. Two of them share a rail and both do better.',
    art: 'panel',
  },
  flywheel: {
    name: 'Flywheel',
    costs: { screw: 6 },
    carry: 2,
    place: { beside: 'panel', needs: { panel: 3 } },
    max: 1,
    note: 'A tonne of salvaged rotor, spun up all afternoon. It is still turning when the sun is not.',
    art: 'flywheel',
  },
  inverter: {
    name: 'Inverter',
    costs: { screw: 7 },
    line: 'array',
    perPanels: 3,
    place: { beside: 'panel', needs: { panel: 5 } },
    max: 1,
    note: 'Takes what the whole rail makes and hands it back as something a gun can drink.',
    art: 'inverter',
  },

  /* ---- the windbreak: guard on everybody, every round ----------------- */

  trellis: {
    name: 'Trellis',
    costs: { screw: 5 },
    line: 'ward', pays: 1,
    place: { onOrNear: 'grass' },
    max: 1,
    note: 'Woven green over a frame of scrap. It does not stop much. It stops it everywhere at once.',
    art: 'trellis',
  },
  livingwall: {
    name: 'Living Wall',
    costs: { screw: 6 },
    line: 'ward', pays: 1,
    place: { beside: 'trellis' },
    max: 1,
    note: 'The trellis, grown in. Roots in the rubble and a metre of leaf between you and the wind.',
    art: 'livingwall',
  },
  hedgerow: {
    name: 'Hedgerow',
    costs: { screw: 7 },
    line: 'ward', pays: 1,
    place: { beside: 'livingwall' },
    max: 1,
    note: 'Laid the old way, half-cut and bent over. A hedge is a wall that mends itself.',
    art: 'hedgerow',
  },

  /* ---- the carillon: a harder swing for everybody, every round -------- */

  carillon: {
    name: 'Carillon',
    costs: { screw: 5 },
    line: 'might', pays: 1,
    place: { camp: 2 },
    max: 1,
    note: 'Cut pipe hung in a frame and struck on the hour. Everybody works better to a beat.',
    art: 'carillon',
  },
  tubes: {
    name: 'Speaking Tubes',
    costs: { screw: 6 },
    line: 'might', pays: 1,
    place: { beside: 'carillon' },
    max: 1,
    note: 'Brass throats run out to the far end of the site. Nobody has to shout twice.',
    art: 'tubes',
  },
  belfry: {
    name: 'Belfry',
    costs: { screw: 7 },
    line: 'might', pays: 1,
    place: { beside: 'tubes' },
    max: 1,
    note: 'The bells got a tower. You can hear it from the treeline, and you move when you do.',
    art: 'belfry',
  },

  /* ---- the heliostat: it shoots on its own ---------------------------- */

  heliostat: {
    name: 'Heliostat',
    costs: { screw: 5 },
    line: 'burn', pays: 1,
    place: { clearOf: ['tree', 'tent'] },
    max: 1,
    note: 'One mirror on a tracker, folded down the lane. It does not need telling twice.',
    art: 'heliostat',
  },
  mirrorfield: {
    name: 'Mirror Field',
    costs: { screw: 6 },
    line: 'burn', pays: 1,
    place: { beside: 'heliostat', clearOf: ['tree', 'tent'] },
    max: 1,
    note: 'Nine more, all aimed at the same square metre of afternoon.',
    art: 'mirrorfield',
  },
  furnace: {
    name: 'Solar Furnace',
    costs: { screw: 7 },
    line: 'burn', pays: 1,
    place: { beside: 'mirrorfield', clearOf: ['tree', 'tent'] },
    max: 1,
    note: 'The point where all of it meets. Do not look at it, and do not stand in it.',
    art: 'furnace',
  },

  /* ---- the cistern: everybody mends when the fight is over ------------ */

  cistern: {
    name: 'Rain Cistern',
    costs: { screw: 5 },
    line: 'mend', pays: 2,
    place: { near: 'water' },
    max: 1,
    note: 'Roof runoff, caught and kept. Half of getting better is having drunk something clean.',
    art: 'cistern',
  },
  reedbed: {
    name: 'Reed Bed',
    costs: { screw: 6 },
    line: 'mend', pays: 2,
    place: { beside: 'cistern' },
    max: 1,
    note: 'Gravel, reeds and patience. What comes out the far end is better than what went in.',
    art: 'reedbed',
  },
  mycelial: {
    name: 'Mycelial Filter',
    costs: { screw: 7 },
    line: 'mend', pays: 2,
    place: { beside: 'reedbed' },
    max: 1,
    note: 'White threads through a barrel of woodchip. They eat what the reeds would not touch.',
    art: 'mycelial',
  },

  /* ---- the community: somebody else's build phase, made bigger --------
   *
   * The only role in this game nobody else can occupy. Rune, Graft and Leg Up
   * hand something to an ally, but they are one round, one target, inside a
   * fight. These four are the only things in the project that reach another
   * seat's *economy*, and they are why the coil pile exists at all.
   */

  press: {
    name: 'Pulp Press',
    costs: { coil: 5 },
    grants: { pages: 1 },
    place: { near: 'water' },
    max: 1,
    note: 'Rag, water and a screw press. The library stops being a thing you only find.',
    art: 'press',
  },
  glasshouse: {
    name: 'Glasshouse',
    costs: { coil: 5 },
    grants: { pot: 1 },
    place: { on: ['grass'] },
    max: 1,
    note: 'Salvaged glazing over the pots. Everything under it comes up heavier.',
    art: 'glasshouse',
  },
  barrow: {
    name: 'The Barrow',
    costs: { coil: 5 },
    grants: { pack: 1 },
    place: { camp: 2 },
    max: 1,
    note: 'Two wheels and a deep tray. What he could not carry, he can now wheel.',
    art: 'barrow',
  },
  windrow: {
    name: 'Windrow',
    costs: { coil: 5 },
    grants: { uses: 1 },
    place: { near: 'tree' },
    max: 1,
    note: 'Cuttings laid in a long heap to rot down. She takes more out of it than she put in.',
    art: 'windrow',
  },
};

/* How many can stand at once. Everything but the panel is capped at one: a
   second Trellis would pay the same line twice for no decision, and the tiers
   above it are what a line is *for*. Panels are the opposite — every one is
   more power and another neighbour for the next, so building more is the whole
   point. */
export const buildingsOf = (buildings, id) =>
  (buildings || []).filter(b => b.id === id).length;

export function canBuildMore(id, buildings){
  const building = BUILDINGS[id];
  if(!building) return false;
  return building.max === undefined || buildingsOf(buildings, id) < building.max;
}

/* ---- where a thing may stand ----------------------------------------- */

/* Orthogonal neighbours only. A diagonal is not touching — you cannot run a
   conduit through a corner, and a hedge laid corner to corner is two hedges. */
export const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/* Why this building may not stand on this tile, or null when it may.
 *
 * A reason rather than a boolean, on the rule `actionReady` already follows: a
 * greyed button whose price you can read is information, and one that refuses
 * silently is a bug report. The client draws the string.
 *
 * Terrain and occupancy are `canBuildAt`'s job — called here so there is one
 * question to ask, and the per-building rule sits on top of it.
 */
export function placeRefusal(id, { terrain, buildings, nodes, x, y }){
  const building = BUILDINGS[id];
  if(!building) return 'No such thing.';
  if(!canBuildMore(id, buildings)) return `One ${building.name} is all a site needs.`;
  if(!canBuildAt(terrain, buildings, nodes, x, y)) return 'Nothing can stand here.';

  const rule = building.place;
  if(!rule) return null;

  const around = NEIGHBOURS.map(([dx, dy]) => ({ x: x + dx, y: y + dy }));
  /* A rule naming 'water' means wetness, not that one literal kind.
     `shoreline()` relabels exactly the water tiles that touch land — which is
     every tile a building could ever stand beside — so a strict comparison
     asked for the one thing the generator had just renamed. It cost the Rain
     Cistern and the Pulp Press a legal tile anywhere on 90.4% of 500 seeds,
     and with them the Reed Bed and the Mycelial Filter that hang off the
     cistern: the whole mend line and the pages income, silently unbuildable. */
  const sameKind = (kind, t) => (t === 'water' ? isWater(kind) : kind === t);
  const terrainAt = (t) => around.some(c => sameKind(tileAt(terrain, c.x, c.y), t));
  const buildingAt = (bid) =>
    (buildings || []).some(b => b.id === bid && around.some(c => c.x === b.x && c.y === b.y));

  if(rule.needs){
    for(const [bid, n] of Object.entries(rule.needs)){
      if(buildingsOf(buildings, bid) < n){
        return `Needs ${n} ${BUILDINGS[bid].name}${n === 1 ? '' : 's'} standing.`;
      }
    }
  }
  if(rule.beside && !buildingAt(rule.beside)){
    return `Has to touch the ${BUILDINGS[rule.beside].name}.`;
  }
  if(rule.near && !terrainAt(rule.near)){
    return `Has to touch ${TERRAIN[rule.near].name.toLowerCase()}.`;
  }
  if(rule.on && !rule.on.some(t => sameKind(tileAt(terrain, x, y), t))){
    return `Only on ${rule.on.map(t => TERRAIN[t].name.toLowerCase()).join(' or ')}.`;
  }
  if(rule.onOrNear && !sameKind(tileAt(terrain, x, y), rule.onOrNear)
     && !terrainAt(rule.onOrNear)){
    return `Has to be on or against ${TERRAIN[rule.onOrNear].name.toLowerCase()}.`;
  }
  if(rule.clearOf){
    const shade = rule.clearOf.find(t => terrainAt(t));
    if(shade) return `${TERRAIN[shade].name} in the way. It needs the sky.`;
  }
  if(rule.camp !== undefined && !inCamp(x, y, rule.camp)){
    return 'Belongs at the camp.';
  }
  return null;
}

export const canPlace = (id, ctx) => placeRefusal(id, ctx) === null;

/* Which standing buildings have had their rule broken underneath them.
 *
 * Only the two predicates that name *other buildings* — `beside` and `needs` —
 * can be broken by somebody else moving. Every other one is about the tile a
 * building is already on, and that does not change when a neighbour walks. The
 * check is written through `placeRefusal` anyway rather than reimplementing
 * those two, because one rule in one place is the whole reason that function
 * exists: a predicate added there is a predicate this honours for free.
 *
 * Each building is asked about its own tile against a board it has been taken
 * out of, which is exactly the question `placeRefusal` already answers.
 */
export function strandedIn({ terrain, buildings, nodes }){
  const placed = buildings || [];
  return placed.filter(b => placeRefusal(b.id, {
    terrain, buildings: placed.filter(other => other !== b), nodes, x: b.x, y: b.y,
  }) !== null);
}

/* Why the building at `index` may not move to this tile, or null when it may.
 *
 * Moving is free and build-phase only, on the precedent the scriptorium
 * already sets: a spell is re-socketed at the desk and not mid-surge, and
 * rearranging what you have already paid for should never cost twice. What a
 * player is doing when they shuffle the array into a longer run is thinking,
 * and charging for thinking is how you get a base nobody dares improve.
 *
 * Two questions, and the second is the one that matters. The destination is
 * `placeRefusal` against a board the building has been lifted off — which also
 * settles the cap for free, since a Trellis is not a second Trellis when the
 * first one is the thing in your hand.
 *
 * Then: **a move may not strand anything.** Without that, every adjacency rule
 * in the game is decoration — you would place the Trellis, hang the Living
 * Wall off it, and walk the Trellis to the far side of the site. The tiers
 * have to stay a run of touching tiles, or they were never a shape.
 */
export function moveRefusal(index, { terrain, buildings, nodes, x, y }){
  const placed = buildings || [];
  const held = placed[index];
  if(!held) return 'Nothing there to move.';
  if(held.x === x && held.y === y) return null;      // put back where it was

  const without = placed.filter((_, i) => i !== index);
  const why = placeRefusal(held.id, { terrain, buildings: without, nodes, x, y });
  if(why) return why;

  const stranded = strandedIn({
    terrain, nodes, buildings: [...without, { ...held, x, y }],
  });
  if(stranded.length){
    const names = [...new Set(stranded.map(b => BUILDINGS[b.id].name))];
    return `That would strand the ${names.join(' and the ')}.`;
  }
  return null;
}

export const canMove = (index, ctx) => moveRefusal(index, ctx) === null;

/* ---- what the works pay ---------------------------------------------- */

/* Every payout the standing buildings make, in one object.
 *
 * One function, because the round's payout, an ability's damage and the
 * client's readout all have to agree about what the base is worth, and three
 * places that each add it up is three places that can drift.
 *
 * The array is the only line that is not a plain sum. A panel makes 1 alone
 * and 2 with another panel orthogonally beside it, so the array wants a
 * contiguous run and the map fights back — rubble, water, trees and crevices
 * are unbuildable, herb nodes hold their tile until somebody takes them, and
 * the camp is stamped through the middle. Finding six clear tiles in a row on
 * a rolled ruin is the Engineer's real spatial problem, and it competes for
 * ground with every line building that has to touch the tier below it.
 */
export function worksFrom(buildings){
  const placed = buildings || [];
  const works = { array: 0, ward: 0, might: 0, burn: 0, mend: 0, carry: 0 };

  const panels = placed.filter(b => b.id === 'panel');
  for(const panel of panels){
    const paired = panels.some(other => other !== panel
      && NEIGHBOURS.some(([dx, dy]) => panel.x + dx === other.x && panel.y + dy === other.y));
    works.array += paired ? 2 : 1;
  }

  for(const b of placed){
    const building = BUILDINGS[b.id];
    if(!building) continue;
    if(building.line && building.pays) works[building.line] += building.pays;
    if(building.perPanels) works.array += Math.floor(panels.length / building.perPanels);
    if(building.carry) works.carry += building.carry;
  }
  return works;
}

/* The array alone, kept under its old name because everything that only wants
   to know "how much power a fight" already asks for it by this one. */
export const powerFrom = buildings => worksFrom(buildings).array;

/* What one of somebody else's economies gets out of the standing buildings.
   `grants` is a plain count, so a second thing granting `pages` would simply
   add — the callers read a number, never a building id. */
export function grantsFrom(buildings, key){
  return (buildings || []).reduce(
    (n, b) => n + (((BUILDINGS[b.id] || {}).grants || {})[key] || 0), 0);
}

/* ============================================================== upgrades === */

/* Gone, and kept as a shim.
 *
 * The Workbench and the two upgrades it sold were a second progression system
 * beside the buildings, and it was the one that decided the fight — so every
 * placement the Engineer made was decoration and every purchase was the game.
 * Folding both into buildings is what makes a tile worth choosing.
 *
 * The names stay exported and answer emptily, because this module is imported
 * at the top of a Worker nobody here can read the source of, and an import of
 * a name that is not exported takes the whole site down, sign-in included. See
 * the published contract at the foot of `test/content.test.js`.
 */
export const UPGRADES = {};
export function upgradeCost(){ return null; }
export function buyUpgrade(){ return null; }

/* What the party starts a run with.
 *
 * Two panels' worth of screws, or one line's first tier with a panel left over
 * — the opening fork in miniature. Coil covers nothing on its own, so the
 * first community machine is always a round away and always a decision. Two
 * chips is exactly a Bolt Gun, which is the one ability needing no building
 * behind it and therefore the only one a round-one Engineer can fire.
 */
export const STARTING_SALVAGE = { screw: 6, coil: 3, chip: 2 };

/* ============================================================= abilities === */

/* What chips buy, and the only combat the Engineer has beyond his two basics.
 *
 * Four of the five draw a line: their number is not on the card, it is on the
 * map. `DRAW` times what that line pays every round, onto one target. Close
 * Ranks off a bare Trellis is 5 guard; with the windbreak grown in it is 15,
 * from the same chip. The first card in this game whose text you read by
 * looking at the board.
 *
 * DRAW is PARTY_SIZE, and that is the fiction: the whole crew's share of one
 * round, pulled through a single line. It is a flat multiplier rather than an
 * actual redistribution because a redistribution is worth five times as much
 * at a full table and nothing at all alone, and this seat has to be playable
 * by one person.
 *
 *   chips  what it costs to learn
 *   needs  the building that has to stand for it to be takeable at all
 */
export const DRAW = PARTY_SIZE;

export const ABILITIES = {
  boltgun: {
    name: 'Bolt Gun', chips: 2, needs: null,
    note: 'The one thing he can fire off a bare panel. No mirrors, no line, no excuse.',
  },
  closeranks: {
    name: 'Close Ranks', chips: 2, needs: 'trellis',
    note: 'A round of the windbreak, all of it, put on one person.',
  },
  allhands: {
    name: 'All Hands', chips: 2, needs: 'carillon',
    note: 'Every bell and every tube, and the whole crew behind one swing.',
  },
  sunlance: {
    name: 'Sunlance', chips: 3, needs: 'heliostat',
    note: 'The array’s whole afternoon through one mirror, at one thing.',
  },
  holdcharge: {
    name: 'Hold the Charge', chips: 3, needs: null,
    note: 'Let the grid bank a round. What it did not pay out, it pays twice.',
  },
};

/* Every ability id a party could buy, in menu order. */
export const ABILITY_IDS = Object.keys(ABILITIES);

/* Can this be learned, and if not, why not. Same contract as `placeRefusal`. */
export function abilityRefusal(id, { salvage, bought, buildings }){
  const ability = ABILITIES[id];
  if(!ability) return 'No such thing.';
  if((bought || []).includes(id)) return 'Already learned.';
  if(((salvage || {}).chip || 0) < ability.chips){
    return `Needs ${ability.chips} ${SALVAGE.chip.name}.`;
  }
  if(ability.needs && !(buildings || []).some(b => b.id === ability.needs)){
    return `Needs a ${BUILDINGS[ability.needs].name} standing.`;
  }
  return null;
}

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

  /* Seat four, and the first body in this party anyone can hide behind.
   *
   * Two verbs, and they are the same sentence twice: health is a currency.
   * Heft buys damage with it, one point for one, and does not expire before
   * the fight does; cover buys somebody else a round by putting the blow on
   * the largest pool at the table. Everything the party had before this was
   * rented — a lent page is one round, a ward is one round, power evaporates
   * when the fight ends. This is the seat that banks.
   */
  {
    id: 'hauler',
    name: 'The Hauler',
    archetype: 'Front line · takes the hits and gets heavier',
    status: 'live',
    hp: 38,
    colour: '#3fa9dd',
    blurb:
      'Carried whatever the pumps could not reach up eleven flights, twice a day, for six years. ' +
      'Knows to within a kilo what they can take, and takes that much.',
    downLine: 'Somebody take the other end.',
    art: 'hauler',
    gather: 1,
    craft: false,
    build: false,
    salvage: 1,
    // The fourth flag, and the fourth build-phase panel. The client branches on
    // these and never on the class id, so declaring it is what gets him a bench
    // — the same way `craft`, `build` and `cast` buy the other three theirs.
    haul: true,
  },

  /* Seat five. The open role said "finds what a site is hiding", and this is
   * that in both halves of a round: `scout` deepens what a site puts out, and
   * canker is damage she put in a thing two rounds before it kills it.
   *
   * She is also the first seat the party can hand a good card to and be wrong.
   * Might and Heft are terms inside strikePower; canker never goes near it. A
   * lent page is worth nothing on her, and Graft is her answer — she cannot
   * use the table's buffs, so she posts a cutting into an arm that can.
   */
  {
    id: 'grafter',
    name: 'The Grafter',
    archetype: 'Scout · sets the rot going and lets it work',
    status: 'live',
    hp: 26,
    colour: '#b39a63',
    blurb:
      'Kept the block\u2019s orchard on a roof that was never built to hold soil. ' +
      'Learned what the blight does to a tree by doing it to a tree on purpose, to save the row behind it.',
    downLine: 'Mind the row. It spreads.',
    art: 'grafter',
    gather: 1,
    craft: false,
    build: false,
    salvage: 1,
    scout: 1,
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
/* Nothing, now: the roster is five of five.
 *
 * Kept as an export rather than deleted, for the reason everything at the foot
 * of this file is kept — this module is imported at the top of the Worker, so a
 * name that is not exported is a throw before anything serves. The lobby and the landing
 * page both iterate it, and both render nothing when it is empty, which is the
 * correct thing for them to render.
 *
 * If a sixth seat is ever wanted it needs PARTY_SIZE moved first; the test
 * pins CLASSES.length + OPEN_ROLES.length against it.
 */
export const OPEN_ROLES = [];

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
    name: 'Acid Flask', kind: 'attack', classId: 'alchemist', basic: true,
    effect: { kind: 'strike', amount: 3 },
    note: 'Something from the bottom shelf, thrown hard.',
  },
  steady: {
    name: 'Steady Hands', kind: 'defend', classId: 'alchemist', basic: true,
    effect: { kind: 'ward', amount: 3, rounds: 1 },
    note: 'Do not spill it. Do not spill it.',
  },
  tonic: {
    name: 'Tonic', kind: 'heal', classId: 'alchemist', stocked: 2, targetsAlly: true,
    effect: { kind: 'heal', amount: 4 },
    note: 'Bitter, and working before you have swallowed it.',
  },
  /* The Alchemist's answer to the blight leaving something behind. Nothing
     else in the game removes an ailment, which is what makes her the only
     seat that can undo a Rust Hulk's afternoon. */
  censer: {
    name: 'Blight Censer', kind: 'heal', classId: 'alchemist', stocked: 1, targetsAlly: true,
    effect: { kind: 'cleanse', amount: 2 },
    note: 'Smoke that the spores will not sit in. Hold it under whoever is coughing.',
  },
  vapours: {
    name: 'Restorative Vapours', kind: 'heal', classId: 'alchemist', stocked: 1,
    effect: { kind: 'healAll', amount: 3 },
    note: 'Poured on the fire. Everyone standing near it breathes easier.',
  },

  /* --- the Engineer: two basics, and everything else is bought ---------
   *
   * `CLASS_ACTIONS.engineer` is empty, exactly as the Hauler's is. What he can
   * do in a fight is what the chips bought and the buildings allow, and the
   * room appends it per run from `abilities` — the same door the Wizard's book
   * and the Hauler's bag already come through.
   *
   * Bulwark and Jumper Cables used to live here and are gone. The Hauler's bag
   * now packs a Rigging Tarp (wardAll 3, free) and a Stretcher (revive 8, one
   * health), which are both of them, better, on a seat that did not have to
   * build a panel first. A class whose whole option list is a worse copy of
   * somebody else's kit does not need rebalancing, it needs a different job —
   * so his is the payout that runs while everybody else is taking their turn.
   */
  wrench: {
    name: 'Wrench', kind: 'attack', classId: 'engineer', basic: true,
    effect: { kind: 'strike', amount: 3 },
    note: 'Forty centimetres of drop-forged persuasion.',
  },
  shore: {
    name: 'Shore Up', kind: 'defend', classId: 'engineer', basic: true,
    effect: { kind: 'ward', amount: 4, rounds: 1 },
    note: 'Plating, a strut, and eleven seconds. It will hold.',
  },

  /* --- what the chips bought -------------------------------------------
   *
   * `ability: true` is the flag the client reads to draw these apart from the
   * rest of the menu, and `draws` is what makes four of them worth looking at
   * the map to price. See ABILITIES for what each one costs to learn and what
   * has to be standing before it can be taken at all.
   */

  /* The exception, and the reason it exists: every other ability is worth
     exactly what its line pays, so an Engineer who has built nothing has
     nothing to fire. This one is a flat number off a bare panel, which is what
     makes the seat playable in the first build phase and playable alone. */
  boltgun: {
    name: 'Bolt Gun', kind: 'attack', classId: 'engineer', ability: true, powerCost: 1,
    effect: { kind: 'strike', amount: 9 },
    note: 'A captive bolt driver on a battery. Loud, ugly, and it goes through.',
  },
  sunlance: {
    name: 'Sunlance', kind: 'attack', classId: 'engineer', ability: true, powerCost: 2,
    draws: 'burn',
    effect: { kind: 'strike', amount: 0 },
    note: 'Every mirror on the field turned to the same point, and the point put on one thing.',
  },
  closeranks: {
    name: 'Close Ranks', kind: 'defend', classId: 'engineer', ability: true, powerCost: 1,
    draws: 'ward', targetsAlly: true,
    effect: { kind: 'ward', amount: 0, rounds: 1 },
    note: 'The whole windbreak, for one round, standing in front of one person.',
  },
  /* Might is a term inside strikePower and it lands on the target's *next*
     turn, exactly as the Wizard's Ember Rune does. That is the coordination:
     the table can see a commitment before the round resolves, so a Wizard who
     watches this land on her picks the Nova. */
  allhands: {
    name: 'All Hands', kind: 'buff', classId: 'engineer', ability: true, powerCost: 1,
    draws: 'might', targetsAlly: true,
    effect: { kind: 'might', amount: 0, rounds: 1 },
    note: 'Every bell on the site rung at once, and the whole crew behind one swing.',
  },
  /* The only ability that draws nothing and targets nobody. It is also the one
     that works identically at a table of one, because it concentrates a payout
     across rounds rather than across people. */
  holdcharge: {
    name: 'Hold the Charge', kind: 'buff', classId: 'engineer', ability: true, powerCost: 1,
    effect: { kind: 'hold' },
    note: 'Let it bank. Nothing this round, and twice as much on the next one.',
  },

  /* --- the Wizard: a floor of a basic and the worst basic guard, which is
         the whole class in two cards — everything she is, she writes at the
         bench. The spark used to be the best basic attack in the game, and
         that was the wrong place for her power to live once the spells were
         hers to build. --- */
  spark: {
    name: 'Spark', kind: 'attack', classId: 'wizard', basic: true,
    effect: { kind: 'strike', amount: 5 },
    note: 'No page needed. Barely a spell. Still hurts.',
  },
  sign: {
    name: 'Warding Sign', kind: 'defend', classId: 'wizard', basic: true,
    effect: { kind: 'ward', amount: 2, rounds: 1 },
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
    name: 'Fireball', kind: 'attack', classId: 'wizard', chargeCost: 2,
    effect: { kind: 'strike', amount: 7 },
    note: 'One page, read aloud, thrown. The blight burns like anything else.',
  },

  /* The Wizard's two party cards, and both of them are about the fact that a
     bigger table draws a bigger wave.
     *
     This one was called Lend a Page, and it did not make sense: a page is the
     Wizard's resource, `cast` is the Wizard's flag, and handing one to an
     Engineer who cannot read a word of it was a cost with no fiction under it.
     The mechanic was always right — spend your resource, somebody else swings
     harder — so what changed is who does the reading. The Wizard burns the
     page. The ally gets the thing the page was holding.

     It is still the clearest coordination card in the game: no damage at all,
     it lands on somebody else's *next* turn, and it is worth a page only if
     that person then swings. Two people have to agree about a round in
     advance. */
  rune: {
    name: 'Ember Rune', kind: 'buff', classId: 'wizard', chargeCost: 1, targetsAlly: true,
    effect: { kind: 'might', amount: 4, rounds: 1 },
    note: 'A page burned down to its ash and drawn along somebody else\u2019s blade. It stays lit for one swing.',
  },
  nova: {
    name: 'Cinder Nova', kind: 'attack', classId: 'wizard', chargeCost: 2,
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
    name: 'Sunsalve', kind: 'heal', brewed: true, stocked: 0, consumed: true, targetsAlly: true,
    effect: { kind: 'heal', amount: 6 },
    note: 'Petals crushed into clean water. Hand it to whoever is worst off.',
  },
  stillwater: {
    name: 'Stillwater', kind: 'defend', brewed: true, stocked: 0, consumed: true, targetsAlly: true,
    effect: { kind: 'ward', amount: 6, rounds: 1 },
    note: 'Drink it and the air stops biting. Works on anyone you can reach.',
  },
  greenfire: {
    name: 'Greenfire', kind: 'attack', brewed: true, stocked: 0, consumed: true,
    effect: { kind: 'strike', amount: 8 },
    note: 'A whole array’s worth of stored afternoon, lit and thrown.',
  },

  /* --- the Hauler: the only seat that buys with health ------------------
   *
   * The ones that cost health say so on their face — `hpCost` sits beside
   * pageCost and powerCost, so cardPlayable refuses the one that would take
   * the last point, and the end screen scores it as Damage Taken. The Hauler
   * leads that column every run. That is the seat, not a failure.
   *
   * `packed` is the other flag to read here, and it is on everything below
   * except the two basics. It means the card is not his by class — it is in
   * his list only while the item granting it is in the bag, and gone the round
   * he takes that item out. `CLASS_ACTIONS.hauler` is empty because of it, and
   * `actionsFor` will never name any of these; the room appends them per
   * player from `packedCards`, exactly as it appends the Wizard's book.
   */
  shoulder: {
    name: 'Shoulder', kind: 'attack', classId: 'hauler', basic: true,
    effect: { kind: 'strike', amount: 4 },
    note: 'Get under it and drive with the legs. It is how you move anything, a Rust Hulk included.',
  },
  /* The same numbers as Shore Up, deliberately. The Engineer's is guard he can
     put on a seat that needs it; this is the floor under the seat the wave is
     already aimed at — and it is the card the Hauler plays on the rounds he is
     not covering, because cover spends the very same pool. */
  weight: {
    name: 'Take the Weight', kind: 'defend', classId: 'hauler', basic: true,
    effect: { kind: 'ward', amount: 4, rounds: 1 },
    note: 'Feet planted, arms locked, and do not think about it. Thinking about it is how you drop things.',
  },
  setfeet: {
    name: 'Set Your Feet', kind: 'buff', classId: 'hauler', packed: true, hpCost: 2,
    effect: { kind: 'heft', amount: 2 },
    note: 'Two of your own, for two on every swing after it. You will feel both of them.',
  },
  /* One copy, for the reason every party card gets one: a card you hold every
     other turn is a rotation, not a moment. Alone it is a plain ward with no
     special case at all, because the coverer is the only seat standing. */
  behind: {
    name: 'Get Behind Me', kind: 'defend', classId: 'hauler', packed: true, hpCost: 1,
    effect: { kind: 'cover', amount: 6 },
    note: 'You are not faster than it. You are just closer.',
  },
  /* Heft is a term inside strikePower, so this is worth nothing at all on the
     Grafter — the first good card in this game the table can hand to the wrong
     person, which is a decision rather than a formality. */
  legup: {
    name: 'Leg Up', kind: 'buff', classId: 'hauler', packed: true, hpCost: 3, targetsAlly: true,
    effect: { kind: 'heft', amount: 3 },
    note: 'Laced fingers, their boot, and up. Three off you and three onto them, for the rest of the fight.',
  },

  /* --- what the pack grants ---------------------------------------------
   *
   * These eight and the three above are the Hauler's whole option list, and
   * none of them is his by class. `CLASS_ACTIONS.hauler` is empty: he opens a
   * fight with two basics and whatever is in the bag, which is what makes the
   * packing his verb rather than a panel beside one. See `pack.js`.
   *
   * They are in CARDS rather than in the pack table for the reason every rule
   * in this project is in one place: `cardEffect`, `actionCost`, `actionReady`
   * and the room's resolution all read CARDS, and a second card table would be
   * a second set of them to keep in step.
   *
   * The costs say which half of him an item is. The free ones are the half he
   * does not bleed for — the whole reason the bag exists on a seat whose every
   * other verb was priced in health — and the ones that still cost say the
   * sentence he has always said. Nothing here needs a new effect kind: every
   * one is something EFFECT_KINDS already lists and the room already resolves,
   * so `fx.js` falls back to the verb and none of them lands silently.
   */
  crossbow: {
    name: 'Winch Crossbow', kind: 'attack', classId: 'hauler', packed: true,
    effect: { kind: 'strike', amount: 6 },
    note: 'Cranked to full and let go. It is slower than a bow and it does not care.',
  },
  tarp: {
    name: 'Rigging Tarp', kind: 'defend', classId: 'hauler', packed: true,
    effect: { kind: 'wardAll', amount: 3, rounds: 1 },
    note: 'Over the heads of the whole crew. Everyone gets a little, nobody gets enough.',
  },
  roll: {
    name: 'Antiseptic Roll', kind: 'heal', classId: 'hauler', packed: true, targetsAlly: true,
    effect: { kind: 'cleanse', amount: 2 },
    note: 'Wound out one-handed with his teeth on the end of it. Whatever the sap did, this undoes.',
  },
  /* He heals by bleeding, which is the only shape a healer on this seat could
     have taken: an unlimited free mend would be the strongest thing in the
     game, and a transfer is self-limiting because he is the one who runs out. */
  fieldkit: {
    name: 'Field Kit', kind: 'heal', classId: 'hauler', packed: true, hpCost: 1, targetsAlly: true,
    effect: { kind: 'heal', amount: 5 },
    note: 'He patches you with what he has. What he has is mostly himself.',
  },
  charge: {
    name: 'Blast Charge', kind: 'attack', classId: 'hauler', packed: true, hpCost: 2,
    effect: { kind: 'strikeAll', amount: 4 },
    note: 'Quarry stock, tamped by hand, thrown underarm. Get down.',
  },
  stretcher: {
    name: 'Stretcher', kind: 'heal', classId: 'hauler', packed: true, hpCost: 1, targetsAlly: true,
    effect: { kind: 'revive', amount: 8 },
    note: 'Two poles and a sheet. Carrying people is the job he actually had.',
  },
  /* Get Behind Me made bigger and free, for five of the worst cells in the
     bag. The upgrade path for the only card in this game that decides who a
     blow lands on — and the reason to keep finding room as the bag grows. */
  dragline: {
    name: 'Drag Line', kind: 'defend', classId: 'hauler', packed: true,
    effect: { kind: 'cover', amount: 8 },
    note: 'Hooked on, braced, and hauled clear. You do not get a say in it.',
  },
  sledge: {
    name: 'Sledge', kind: 'attack', classId: 'hauler', packed: true, hpCost: 2,
    effect: { kind: 'strike', amount: 11 },
    note: 'Twelve pounds on a hickory shaft. Everything it touches stops being a shape.',
  },

  /* --- the Grafter: damage that arrives after the card ------------------
   *
   * Canker is the only damage in the game that is not a strike, and every
   * consequence falls out of that one fact. It never touches strikePower, so
   * Might, Heft and Weakened are all irrelevant to it in both directions. It
   * ticks inside the round whether or not she acted, so a stun cannot take it
   * off the table, and it keeps arriving after she goes down.
   */
  hook: {
    name: 'Pruning Hook', kind: 'attack', classId: 'grafter', basic: true,
    effect: { kind: 'strike', amount: 3 },
    note: 'Curved, and sharpened on the inside. Made for taking a thing off at the joint rather than going through it.',
  },
  /* Three across three rounds, so it is worth six and reads as three. Two of
     these on one target is still six — canker refreshes rather than stacks,
     exactly as an ailment does, or three of them on one Hulk would pay out
     forty-five. Two of these on two targets is twelve, which is the class. */
  ringbark: {
    name: 'Ringbark', kind: 'attack', classId: 'grafter', uses: 3,
    effect: { kind: 'canker', amount: 4 },
    note: 'A ring cut the whole way round. It stands there looking fine for a week, and then it does not.',
  },
  bramble: {
    name: 'Bramble', kind: 'defend', classId: 'grafter', basic: true,
    effect: { kind: 'ward', amount: 3, rounds: 1 },
    note: 'Cut most of the way through, bent over, and laid along the gap. It has held a field before now.',
  },
  season: {
    name: 'Bad Season', kind: 'attack', classId: 'grafter', uses: 1,
    effect: { kind: 'cankerAll', amount: 3 },
    note: 'It gets into the whole row at once. Nothing dies today. Most of it dies.',
  },
  /* A cutting is a strike, so it lands for four plus whatever Heft or Might
     the holder is carrying — posted into a Hauler mid-ramp it is worth roughly
     double what it is worth in her own hand, which is the whole card. */
  scion: {
    name: 'Graft', kind: 'buff', classId: 'grafter', uses: 1, targetsAlly: true,
    effect: { kind: 'graft', amount: 1 },
    note: 'A live shoot, bound and waxed onto somebody else\u2019s arm. It lands as hard as the arm does, so pick the arm.',
  },

  /* Put into somebody's deck by a card rather than dealt by a class — the
     fifth owner flag. Owned by nobody, so the class check passes for whoever
     is holding it, and consumed so it leaves the deck rather than clogging it.
     Deliberately in no starting deck: the only way to hold one is to be given
     one. */
  cutting: {
    name: 'Cutting', kind: 'attack', granted: true, consumed: true,
    effect: { kind: 'strike', amount: 4 },
    note: 'Taken off something that met the ruin and won. Swing it once and it is gone.',
  },

  /* --- universal -------------------------------------------------------
   *
   * The two everybody holds, one to swing and one to duck behind, so whatever
   * else the hand deals you there is something to do with it. Deliberately the
   * weakest of their kinds: the floor of a turn, not a plan.
   */

  /* --- superseded, and kept only because this table is a published contract.
   *
   * These two were the floor of a turn: three damage and two guard, held by
   * everybody, for the round where the deck dealt you nothing you could use.
   * Every class has its own free swing and its own free guard now — see
   * CLASS_BASICS — and those are not the same two numbers for everybody, which
   * was the whole point of taking them out of the deck. Nothing puts Strike or
   * Hold in front of a player any more; they are in no class list and the room
   * would refuse them.
   *
   * They stay in CARDS because removing an export is a bet on what the Worker
   * does not import, and that bet is declined here as everywhere else. */
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

/* ============================================================== actions ===
 *
 * What a seat can do in a fight, and what stops it doing it every round.
 *
 * There was a deck here. Ten or eleven cards, three drawn a turn, one played —
 * and six or seven of those cards were the same two cards under five sets of
 * names. `CLASS_KITS` said so out loud: *the basics are identical under the
 * rename*. So the majority of every turn in this game was a 3-damage hit or a
 * 3-point ward whoever you were sitting as, the interesting cards were buried,
 * and a run is four fights — nowhere near enough cycling for deck-building to
 * ever become an engine. It paid the whole cost of randomness and never
 * collected.
 *
 * So the shuffle is gone and every option is on the table, face up. What was a
 * hand is now a list, and what limits it is the thing each class was *already*
 * limited by — the shuffle was only ever a translation layer over five
 * economies that already existed in this file:
 *
 *   basic     free, unlimited, every round. The floor of a turn, not a plan.
 *   stocked   the Alchemist. A rack of bottles. Spend one and it is gone, and
 *             the count carries across the whole run — brewing is the only way
 *             to put anything back. `RECIPES.makes` used to deal copies into
 *             her deck; it fills the rack now, which is what it always was.
 *   power     the Engineer. One pool per fight, made by panels, evaporating at
 *             the end — and everything he owns drains it at a different rate.
 *   charges   the Wizard. A pool that comes back a little every round, so her
 *             question is always *this round or next*. `SPELLS.charges` used to
 *             be how many copies went into her deck; it is what a cast costs.
 *   hpCost    the Hauler, who has always paid in health and now pays for all
 *             three of his.
 *   uses      per fight, and the catch-all. The Grafter is here for now — her
 *             old copy counts became use counts one for one — because she has
 *             no economy of her own yet. When she grows one this is the field
 *             to empty.
 *
 * A player takes exactly one action a round, as they played exactly one card.
 * The decision is wider and the randomness is gone from it; where variance
 * comes from instead is the wave, the site and the draft — see the README.
 */

/* The two every seat has for free, and the first place a class says what it
 * is. They used to be `strike 3` and `ward 3` for everybody; the numbers below
 * are the point of the rewrite as much as the list is.
 *
 *   Alchemist  middling at both, as she is at everything
 *   Engineer   hits like a tool, holds like a wall
 *   Wizard     the roster's glass floor: the best basic swing in the game and
 *              the worst basic guard, which is the class in two numbers
 *   Hauler     the most health and the heaviest hands
 *   Grafter    plain, because her damage is supposed to arrive late
 */
export const CLASS_BASICS = {
  alchemist: ['flask', 'steady'],
  engineer: ['wrench', 'shore'],
  wizard: ['spark', 'sign'],
  hauler: ['shoulder', 'weight'],
  grafter: ['hook', 'bramble'],
};

/* What each seat owns beyond the two, and the whole of its economy.
 *
 * The Hauler's is empty, and that is the entry worth reading. He had three
 * here — Set Your Feet, Get Behind Me and Leg Up — and they are now pack items
 * with the numbers unchanged. Nothing he can do beyond his two basics comes
 * from his class any more; it comes from what fitted in the bag, which is what
 * makes the packing his verb instead of a readout beside one. The room appends
 * them per player, exactly as it appends the Wizard's book: what a seat can do
 * is not always knowable from its class id.
 */
export const CLASS_ACTIONS = {
  alchemist: ['tonic', 'censer', 'vapours', 'sunsalve', 'stillwater', 'greenfire'],
  engineer: [],
  wizard: ['fireball', 'nova', 'rune'],
  hauler: [],
  grafter: ['ringbark', 'season', 'scion'],
};

/* The Wizard's pool. Full at the start of a fight, and `CHARGE_REGEN` back at
   the top of every round after — so a Fireball is roughly every other round
   with a Spark in between, and two big casts back to back cost a quiet one. */
export const CHARGE_CAP = 3;
export const CHARGE_REGEN = 1;

/* Every id this seat could ever take, basics first. Availability is a separate
   question — see `actionReady` — because a greyed option a player can see the
   price of is information, and one that vanishes is a mystery. */
export function actionsFor(classId){
  return [...(CLASS_BASICS[classId] || []), ...(CLASS_ACTIONS[classId] || [])];
}

/* What the rack holds at the start of a run: the bottles she was handed. Only
   the Alchemist has one, and `stocked` on a card is both the flag and the
   opening count. */
export function freshStock(classId){
  const stock = {};
  for(const id of actionsFor(classId)){
    const card = CARDS[id];
    if(card && card.stocked !== undefined) stock[id] = card.stocked;
  }
  return stock;
}

/* What the per-fight counters open at. Reset every surge, unlike the rack. */
export function freshUses(classId){
  const uses = {};
  for(const id of actionsFor(classId)){
    const card = CARDS[id];
    if(card && card.uses !== undefined) uses[id] = card.uses;
  }
  return uses;
}

/* Which pool an action spends, or null for a basic. One field, because an
   action that answered to two of these would be a price nobody could read off
   the face of it. */
export function actionCost(id, spell = null, works = {}){
  const card = CARDS[id];
  if(spell) return { pool: 'charges', amount: spell.charges || 0 };
  if(!card) return null;
  // Power prices are flat now. They used to be shaded by a workbench upgrade,
  // and the fork that replaced it is a better one: screws go to panels for the
  // power to fire an ability, or to a line for what the ability is worth. A
  // cheaper shot on top of both would have been a third answer to a question
  // that reads better with two.
  if(card.powerCost) return { pool: 'power', amount: card.powerCost };
  if(card.chargeCost) return { pool: 'charges', amount: card.chargeCost };
  if(card.hpCost) return { pool: 'hp', amount: card.hpCost };
  if(card.stocked !== undefined) return { pool: 'stock', amount: 1 };
  if(card.uses !== undefined) return { pool: 'uses', amount: 1 };
  return null;
}

/* Can this seat take this action right now, and if not, why not.
 *
 * Returns a reason rather than a boolean, because the client draws it: "no
 * charges" and "none left" are different facts and a player who can see which
 * one applies can do something about one of them.
 */
export function actionReady(id, seat = {}, spell = null){
  const card = CARDS[id];
  if(!card && !spell) return { ok: false, why: 'unknown' };
  const cost = actionCost(id, spell, seat.works);
  if(!cost) return { ok: true };

  if(cost.pool === 'power'){
    return (seat.power || 0) >= cost.amount ? { ok: true } : { ok: false, why: 'power' };
  }
  if(cost.pool === 'charges'){
    return (seat.charges || 0) >= cost.amount ? { ok: true } : { ok: false, why: 'charges' };
  }
  if(cost.pool === 'hp'){
    // A card must never be the thing that kills you. Strictly greater, so the
    // last point is never spendable.
    return (seat.hp ?? Infinity) > cost.amount ? { ok: true } : { ok: false, why: 'hp' };
  }
  if(cost.pool === 'stock'){
    return ((seat.stock || {})[id] || 0) > 0 ? { ok: true } : { ok: false, why: 'empty' };
  }
  if(cost.pool === 'uses'){
    return ((seat.uses || {})[id] || 0) > 0 ? { ok: true } : { ok: false, why: 'spent' };
  }
  return { ok: true };
}

/* How much of its pool an action has left to draw on, for the number the
   client prints on the button. `null` where there is no count to show — a
   basic, or a cost that is paid out of something already on screen. */
export function actionRemaining(id, seat = {}){
  const cost = actionCost(id, null, seat.works);
  if(!cost) return null;
  if(cost.pool === 'stock') return (seat.stock || {})[id] || 0;
  if(cost.pool === 'uses') return (seat.uses || {})[id] || 0;
  return null;
}

export const isBasic = id => !!(CARDS[id] || {}).basic;

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
  engineer: { wrench: 3, shore: 4 },
  wizard: { spark: 4, sign: 2, fireball: 2, rune: 1, nova: 1 },
  hauler: { shoulder: 3, weight: 3, setfeet: 2, behind: 1, legup: 1 },
  grafter: { hook: 3, ringbark: 3, bramble: 2, season: 1, scion: 1 },
};

/* Cards every deck holds regardless of class. */
export const UNIVERSAL_CARDS = Object.entries(CARDS)
  .filter(([, card]) => card.universal)
  .map(([id]) => id);

/* Deprecated alias. It was kept because a second repo imported this module and
 * a missing export was a throw at the top of somebody else's Worker; that repo
 * is gone, so this is now safe to delete along with its entry in PUBLISHED.
 * Cards carry the same { name, effect, note }
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
   and buildings now rather than cards, so there is nothing to add — but the
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

/* What a card does right now, with the works that stand behind it applied.
 *
 * Four of the Engineer's abilities have no number of their own. `draws` names
 * a line, and the amount is DRAW times what that line pays every round — so
 * the card is worth what the base is worth and the table can read its damage
 * off the map. CARDS stays declarative and the arithmetic lives here, because
 * the alternative is rewriting the card table every time somebody raises a
 * hedge, and then the button and the resolution disagree about what a Close
 * Ranks is.
 *
 * `works` is a `worksFrom` object. Everything that is not an ability ignores
 * it entirely and returns its own flat effect, which is every other card in
 * the game.
 */
export function cardEffect(cardId, works = {}){
  const card = CARDS[cardId];
  if(!card) return null;
  if(!card.draws) return card.effect;
  return { ...card.effect, amount: DRAW * (works[card.draws] || 0) };
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

/* Pages the library yields at the start of each build phase: one directly,
   with one more on the ground for whoever walks to it. Income rather than
   only foraging, because the draft is the class's whole game and a round
   with no page is a round the Wizard spent watching other people play
   theirs. */
export const PAGES_PER_ROUND = 1;

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
export const MODIFIER_WEIGHTS = { common: 8, uncommon: 4, rare: 1 };

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
 * cardEffect is to the works: CARDS and SPELLS stay declarative and the live
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

/* The draft a page turns over: three distinct options from the spells she
 * has not learned and the whole modifier list — duplicates are allowed, so a
 * second Kindling is a real find and two spells can carry the same ink.
 * Unlearned spells are weighted like an uncommon find; modifiers by their
 * rarity, and rares are genuinely rare. The generator is the room's, as
 * everywhere — a draft that rolled differently on a replay would be a draft
 * the room cannot stand behind.
 */
export const SPELL_OFFER_WEIGHT = 3;

export function rollOffers(random, spellbook, count = 3){
  const pool = [];
  for(const id of Object.keys(SPELLS)){
    if(!(spellbook.known || []).includes(id)) pool.push({ type: 'spell', id, weight: SPELL_OFFER_WEIGHT });
  }
  for(const [id, mod] of Object.entries(MODIFIERS)){
    pool.push({ type: 'mod', id, weight: MODIFIER_WEIGHTS[mod.rarity] || 1 });
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
   the whole modifier list, since duplicates are allowed — in practice a page
   always has something to open, and the guard survives only for the day a
   content change empties the pool again. */
export const draftableCount = spellbook =>
  Object.keys(SPELLS).filter(id => !(spellbook.known || []).includes(id)).length +
  Object.keys(MODIFIERS).length;

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

/* Every class opens with the same six cards wearing different names: three
 * basic attacks and three basic wards, all at 3. The basics are the floor of
 * a turn and nothing more — everything a class actually *is* comes out of its
 * build phase: the Alchemist's brews and garden, the Engineer's buildings
 * and workbench (the first barrel is where her bolt gun comes from now), the
 * Wizard's book. Local rooms and the preview deal from here; STARTING_DECKS
 * below is kept as-is because the deployed Worker still deals from it.
 */
export const CLASS_KITS = {
  alchemist: { flask: 3, steady: 3 },
  engineer: { wrench: 3, shore: 3 },
  wizard: { spark: 3, sign: 3 },
  hauler: { shoulder: 3, weight: 3 },
  grafter: { hook: 3, bramble: 3 },
};

/* What a class opens with *beyond* the six, and why only two seats have any.
 *
 * The basics are identical under the rename because class identity is supposed
 * to come out of the build phase: the Alchemist brews her deck, the Engineer
 * buys his, the Wizard writes hers. Those three each have a pool to spend and a
 * verb to spend it with.
 *
 * The Hauler and the Grafter have neither — no craft, no build, no cast — so a
 * six-card kit would make them the two seats whose deck never changes and whose
 * build phase is a walk. Their identity is dealt instead of earned, and this is
 * the table that deals it. If either ever grows an economy of its own, this is
 * the thing to empty.
 */
export const CLASS_EXTRAS = {
  hauler: { setfeet: 2, behind: 1, legup: 1 },
  grafter: { ringbark: 3, season: 1, scion: 1 },
};

/* The kit as a flat, unshuffled list of card ids: the six basics, then whatever
   that seat opens with on top of them. */
export function classKit(classId){
  const cards = [];
  for(const table of [CLASS_KITS, CLASS_EXTRAS]){
    for(const [id, n] of Object.entries(table[classId] || {})){
      for(let i = 0; i < n; i++) cards.push(id);
    }
  }
  return cards;
}

/* Kept as an alias for anything already reading the Wizard's kit by name. */
export const WIZARD_BASE_KIT = CLASS_KITS.wizard;

/* The deck the Wizard takes into a surge: the kit and `charges` copies of
 * every spell in the book, as composed right now. The copies are consumed
 * when played and re-dealt here next surge — the room rebuilds this at every
 * enterCombat, which is what makes charges per-combat without a counter
 * anywhere.
 */
export function wizardCombatDeck(spellbook){
  const deck = classKit('wizard');
  for(const spellId of (spellbook && spellbook.known) || []){
    const composed = composeSpell(spellId, (spellbook.slots || {})[spellId]);
    if(!composed) continue;
    for(let i = 0; i < composed.charges; i++) deck.push(spellId);
  }
  return deck;
}

/* ============================================================== enemies === */

/* What comes out of the blight when it surges.
 *
 * An enemy is authored by its health and its damage, and it is *there*. There
 * used to be a `dist` as well — a count of rounds before it arrived — and the
 * fight was a lane the wave walked down while the party shot at it. That made
 * the opening turns free and the closing turns crowded, and it meant the most
 * interesting decision in a fight was often "which of these is closest".
 *
 * A surge is a standoff now, the way Slay the Spire's fights are: the party on
 * one side, the wave on the other, everything present from the first turn and
 * everything acting on every one of them. Nothing on the field moves, so
 * everything that happens on it is a card somebody played.
 *
 * What replaced the tension of an approach is the telegraph — see `intentOf`.
 * You cannot see a monster coming any more; you can see what it is about to do,
 * which is a decision rather than a countdown.
 *
 * The wave tables are per round, boss last. Composition over stat scaling —
 * a later round sends more and worse things rather than the same thing with
 * a bigger number, because "there are four of them now" is legible on a
 * screen in a way "+2 hp" never is.
 */
/* `pattern` is what this thing does, round after round, and it is the largest
 * single thing an enemy is. `hp` and `hits` say how much trouble it is; the
 * pattern says what *kind*, and it is the only part of a monster a player can
 * plan against.
 *
 * It cycles on a counter the room keeps (`enemy.turn`), so it is arithmetic
 * rather than a roll — a replayed room runs the same fight, and the telegraph
 * can read the next entry without a second copy of the rule.
 *
 * `ability` is the ailment (or the ring of ailments) this thing leaves, and it
 * arrives on a `blight` intent rather than on a lucky swing. That is the change
 * worth knowing about: an ailment used to ride in on every nth landed hit,
 * which meant the interesting half of a monster was invisible until it fired.
 * A Creeper now says it is about to weaken the party, and a round of guard is
 * how you refuse.
 *
 * `hp` and `hits` are the **solo** fight. There used to be a `threat` beside
 * them — what one of these was worth against one player — and `waveFor` spent
 * it as a budget to decide how many of each a table met. Nothing spends
 * anything now: the wave is the same wave at every table size, and the only
 * number that moves is health. See **levelling the encounter to the table**.
 */
export const ENEMIES = {
  sporeling: { name: 'Sporeling', hp: 6, hits: 2, art: 'sporeling',
    ability: { id: 'rot' }, pattern: ['attack', 'blight'],
    note: 'A puffball with intent. Pops wetly, and you breathe what comes out.' },
  creeper: { name: 'Creeper', hp: 10, hits: 3, art: 'creeper',
    ability: { id: 'weak' }, pattern: ['attack', 'attack', 'blight'],
    note: 'Vine over bone over something that used to be a drone. The sap gets into you.' },
  hulk: { name: 'Rust Hulk', hp: 18, hits: 5, art: 'hulk',
    ability: { id: 'stun' }, pattern: ['charge', 'attack', 'blight'],
    note: 'A maintenance chassis the blight wears like a coat. It swings like one too.' },
  extractor: { name: 'The Extractor', hp: 22, hits: 2, art: 'extractor', boss: true,
    ability: { id: ['weak', 'rot', 'stun'] },
    pattern: ['attack', 'blight', 'charge', 'attack', 'bolster'],
    note: 'It was built to harvest. It still is, and it works through a crew in order.' },
};

/* ---- what an enemy can be about to do -----------------------------------
 *
 * Four, and they are four because each one asks the party a different
 * question. A table rather than a set of bare strings for the same reason
 * AILMENTS is one: the client draws a pip off this and names one off this, so
 * there is nowhere for a fifth to be added and left undrawn.
 *
 *   attack   everyone, for the number on the plate. Guard subtracts.
 *   blight   less damage, and what it leaves is the point. Guard that eats a
 *            player's whole share stops the ailment with it, which is the
 *            reason to ward the round before rather than trade through it.
 *   charge   nothing this round. Its next attack lands for CHARGE_MULTIPLIER
 *            times as much, and the plate says so while it winds up — the one
 *            intent that is a countdown, and a countdown you can spend a round
 *            answering.
 *   bolster  nothing this round either, and worse every round after: the thing
 *            walks its own damage up. Ignore it and the fight gets harder for
 *            the rest of its length.
 *
 * `hostile` marks the two that actually land something, so the room and the
 * client can both ask "does this one hit" without either keeping a list.
 */
export const ENEMY_INTENTS = {
  attack: { kind: 'attack', name: 'Attack', hostile: true, colour: 'e',
    note: 'Swinging, at everyone. Guard comes off the top of it.' },
  blight: { kind: 'blight', name: 'Blight', hostile: true, colour: 'v',
    note: 'Less of a blow than a dose. Guard that eats the whole thing takes the dose with it.' },
  charge: { kind: 'charge', name: 'Winding up', hostile: false, colour: 'o',
    note: 'Nothing this round. Everything the next one.' },
  bolster: { kind: 'bolster', name: 'Bolstering', hostile: false, colour: 'o',
    note: 'Feeding on the ruin. It swings harder from here on.' },
};

export const ENEMY_INTENT_KINDS = Object.keys(ENEMY_INTENTS);

/* What a wind-up is worth, what a bolster adds, and how much of a swing a dose
   is. Dials, all three, and test/balance.mjs is how they get set. */
export const CHARGE_MULTIPLIER = 2;
export const BOLSTER_STEP = 2;
export const BLIGHT_SHARE = 0.5;

/* What an enemy is worth against a table lives in one place and it is not
   here — see **levelling the encounter to the table** below. ENEMIES holds the
   solo fight; `enemyStats` is the only thing that scales any of it, and the
   only thing it scales is health. */

/* ---- the telegraph ------------------------------------------------------
 *
 * What this enemy will do at the end of this round, so a player can decide
 * against it rather than guess.
 *
 * This is Slay the Spire's intent, and it is what a standoff needs in place of
 * an approach. When the wave walked toward you, the interesting information was
 * spatial and free — you could see the Rust Hulk was two rounds out. Standing
 * still it has no way to tell you anything, and a fight where every turn is the
 * same unreadable exchange is a fight you play by arithmetic.
 *
 * Derived, never stored. Every function below is arithmetic over counters the
 * room keeps — `turn`, `might`, `charged`, `cast` — so the plate over a
 * monster's head cannot drift from what advanceWave then does, because
 * advanceWave reads these same functions rather than a copy of them.
 */

/* Which of the four it is about to do. `turn` is how many rounds it has acted
   for, so the pattern cycles and the whole fight is legible from round one. */
export function intentKindOf(type, turn = 0){
  const pattern = (ENEMIES[type] || {}).pattern;
  if(!pattern || !pattern.length) return 'attack';
  const n = Math.max(0, Math.floor(turn));
  return pattern[n % pattern.length];
}

/* What one swing of this thing is worth right now: what it was authored with,
   plus everything it has bolstered onto itself, doubled if it spent last round
   winding up. */
export function enemyDamage(enemy){
  if(!enemy) return 0;
  const base = Math.max(0, (enemy.hits || 0) + (enemy.might || 0));
  return enemy.charged ? base * CHARGE_MULTIPLIER : base;
}

/* A dose is half a swing, and never less than one — a blight that landed for
   nothing would be an ailment with no way to guard against it. A thing that
   swings for nothing doses for nothing, though: the floor is a floor under a
   real number, not a way for a muted enemy to keep poisoning people. */
export function blightDamage(enemy){
  const full = enemyDamage(enemy);
  return full <= 0 ? 0 : Math.max(1, Math.ceil(full * BLIGHT_SHARE));
}

/* Which ailment its next dose carries. Enemies with one ailment always land
   that one; the boss walks its ring, so `cast` — how many doses it has already
   given — is the whole of the state. */
export function blightOf(type, cast = 0){
  const spec = enemyAbility(type);
  if(!spec) return null;
  const n = Math.max(0, Math.floor(cast));
  return spec.ids[n % spec.ids.length];
}

/* The plate over its head, in the shape the client draws and the room resolves.
 *
 * `damage` is what each player is about to be asked to absorb, `ail` what a
 * dose would leave behind, and `next` what a wind-up is winding up to — so a
 * charging Rust Hulk says "nothing now, twenty next" on one plate, which is the
 * only thing that makes a wind-up a decision rather than a free round.
 */
export function intentOf(enemy){
  if(!enemy || enemy.hp <= 0) return null;
  const kind = intentKindOf(enemy.type, enemy.turn || 0);

  if(kind === 'blight'){
    return { kind, damage: blightDamage(enemy), ail: blightOf(enemy.type, enemy.cast || 0) };
  }
  if(kind === 'charge'){
    // What it will hit for once it lands, run through the same enemyDamage the
    // swing itself will use, so the promise and the blow cannot disagree.
    return { kind, damage: 0, ail: null, next: enemyDamage({ ...enemy, charged: true }) };
  }
  if(kind === 'bolster'){
    return { kind, damage: 0, ail: null, gain: BOLSTER_STEP };
  }
  return { kind: 'attack', damage: enemyDamage(enemy), ail: null };
}

/* The ailment ring, normalised: one id or a list, always a list here, so the
   boss walking all three and a Sporeling doing one thing are the same lookup at
   the call site. */
export function enemyAbility(type){
  const spec = (ENEMIES[type] || {}).ability;
  if(!spec) return null;
  const ids = (Array.isArray(spec.id) ? spec.id : [spec.id]).filter(id => AILMENTS[id]);
  if(!ids.length) return null;
  return { ids };
}

/* ---- levelling the encounter to the table ------------------------------- */

/* One dial, and it is health.
 *
 * A wave used to be levelled by **spending a threat budget**: each enemy cost
 * what one of it was worth against one player, each round had a per-player
 * figure, and a bigger table met a fuller lane of worse things. That was the
 * right shape while a swing found one seat — five enemies against five players
 * was five blows a round however you arranged them.
 *
 * It stopped being the right shape the moment an attack landed on the whole
 * party. An enemy's damage is now multiplied by the head count before any dial
 * touches it, so *adding* enemies for a bigger table multiplies the pressure
 * twice: the fifth Sporeling is worth five times what the first one is worth to
 * a solo player. Measured, that was a party of four winning one run in twenty
 * against a target of three in five.
 *
 * So the wave is now **the same wave at every table size**:
 *
 *   count    fixed per round. Round one is three things, whoever turned up.
 *   damage   never scales. What ENEMIES says is what it swings for.
 *   health   scales, and it is the only thing that does.
 *
 * Health is the one number that *should* scale, and the reason is that it is
 * the only one on the wave's side of the equation that the party's head count
 * is already on the other side of: five players put out roughly five players'
 * damage, so five players' worth of health is the same fight taking the same
 * number of rounds. Everything else about a bigger table — more guard, more
 * heals, somebody to lose and keep fighting — is what makes it a party rather
 * than a longer solo run.
 */

/* Health per *extra* player, as a share of what the table says. At 1 the wave
   has exactly the party's head count in health, which is the honest starting
   point: linear damage against linear health is a fight of constant length.
   Tune with test/balance.mjs open. */
export const HP_PER_PLAYER = 1;

/* The boss gets its own share for the reason it has always had its own
   treatment: it is one thing, and it cannot scale by arriving in different
   numbers. `hits` is gone from it — nothing on the wave scales its damage any
   more, the boss included. */
export const BOSS_SCALING = { hp: 1.2 };

/* An enemy's numbers for this table: its authored damage, and its health
   through the one dial. */
export function enemyStats(type, partySize = PARTY_SIZE){
  const def = ENEMIES[type];
  if(!def) return null;
  const extra = Math.max(0, Math.min(PARTY_SIZE, Math.max(1, partySize)) - 1);
  const share = def.boss ? BOSS_SCALING.hp : HP_PER_PLAYER;
  return { hp: Math.round(def.hp * (1 + share * extra)), hits: def.hits };
}

/* What each round sends. Not a pattern any more — the literal wave, in the
   order it is drawn, the same at every table size.
 *
 * Composition over count is what makes a later round harder: round three sends
 * a Rust Hulk because a Rust Hulk winds up and lands for twelve on everybody,
 * not because it is the fifth body in the lane. "There is a Hulk in this one"
 * is legible on a screen in a way "+2 hp" never is.
 *
 * The boss is first in its own round because it is the appointment; the two
 * behind it are the escort.
 */
const WAVE_PATTERN = {
  1: ['sporeling', 'sporeling', 'creeper'],
  2: ['sporeling', 'creeper', 'creeper', 'sporeling'],
  3: ['creeper', 'hulk', 'creeper', 'sporeling', 'sporeling'],
  [BOSS_ROUND]: ['extractor', 'creeper', 'hulk'],
};

/* Six is what the lane can show. Beyond it the sprites share rows and the wave
   reads as one smear. Nothing currently reaches it — the longest round is five
   — and it is kept as the ceiling any future round has to author under. */
export const WAVE_CAP = 6;

/* The wave a given round sends.
 *
 * `partySize` is still in the signature and is deliberately unused: every
 * caller passes it, it is part of a published export, and a wave that quietly
 * started varying with it again is exactly the thing this rewrite removed. The
 * table size reaches the fight through enemyStats and nowhere else.
 */
export function waveFor(round, partySize = PARTY_SIZE){
  void partySize;
  const at = Math.min(Math.max(1, round), BOSS_ROUND);
  const pattern = WAVE_PATTERN[at] || WAVE_PATTERN[BOSS_ROUND];
  return pattern.slice(0, WAVE_CAP);
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


/* Salvage drawn once a fight is over: what the crew picked up, and that is all.
 *
 * Buildings used to pay an income on top. They no longer do, because every one
 * of them now buys a standing payout instead — a line the party is paid every
 * round, or somebody else's build phase made permanently bigger — and a
 * building that also handed back the salvage it cost would be paying twice for
 * one tile.
 *
 * `income` is still read, so a building that wants one can simply declare it.
 * Nothing does today. The caller supplies the generator, as everywhere else in
 * this file.
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
    for(const [id, n] of Object.entries(building.income || {})) add(id, n);
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
export const MAP_W = 38;
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
  /* The eight shores: the tiles of meltwater that have a bank on one side.
     Which one a tile gets is decided by shoreline() after the ground is
     settled, and it is only ever a change of picture — a shore is as
     unwalkable and as unbuildable as the water it is made of, so nothing that
     reads this table has to learn a ninth rule about water. */
  shoreN:  { name: 'Shallows',    walk: false, build: false, grows: false },
  shoreNE: { name: 'Shallows',    walk: false, build: false, grows: false },
  shoreE:  { name: 'Shallows',    walk: false, build: false, grows: false },
  shoreSE: { name: 'Shallows',    walk: false, build: false, grows: false },
  shoreS:  { name: 'Shallows',    walk: false, build: false, grows: false },
  shoreSW: { name: 'Shallows',    walk: false, build: false, grows: false },
  shoreW:  { name: 'Shallows',    walk: false, build: false, grows: false },
  shoreNW: { name: 'Shallows',    walk: false, build: false, grows: false },
  /* Three biomes added because a generated site was 81% one green and the
     ground had no shape to it. Each one is here for a different job:
     `meadow` is more of the same ground with colour in it, `array` is the
     ruin the game is named after showing through, and `bramble` is the only
     new kind that stops you — terrain you have to walk around is what makes
     a site have a route rather than an open field.

     They are not walkable-and-buildable by default: a panel field is a laid
     surface you can cross but not raise anything on, and a thicket is neither. */
  meadow:  { name: 'Wildflower',  walk: true,  build: true,  grows: true },
  array:   { name: 'Panel array', walk: true,  build: false, grows: false },
  bramble: { name: 'Bramble',     walk: false, build: false, grows: false },
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

/* Water and its eight shores are one substance as far as every rule is
   concerned; only the picture differs. Anything asking "is this wet" should
   ask this rather than compare against 'water', which would now miss the
   whole coast. */
export const isWater = kind => kind === 'water' || (typeof kind === 'string' && kind.startsWith('shore'));

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
  /* Sized as a fraction of the map rather than in absolute steps. The site grew
     from 30x17 to 38x17, and a fixed step count would have made the wider ruin
     an emptier one — the same features spread over 27% more ground.
     
     The budgets themselves were then swept rather than chosen. At the original
     sizes a generated site was 81.4% grass, which is what "the map is boring"
     measures as; the whole point of the new kinds is lost if they are specks.
     Multiplying every budget by 2.5 puts grass at 48.5% with the smallest
     connected buildable area over 200 seeds still at 196 — more than three
     times BASE_ROOM. Past that it keeps improving the picture and starts
     costing the promise: at x3 grass is 43.2% but the worst site drops to 123. */
  const AREA = (n) => Math.round(n * (MAP_W * MAP_H) / 510);
  blob(cells, random, 'water', AREA(95));
  blob(cells, random, 'water', AREA(60));
  blob(cells, random, 'hill', AREA(75));
  blob(cells, random, 'hill', AREA(45));
  blob(cells, random, 'crevice', AREA(35));
  blob(cells, random, 'rubble', AREA(65));
  blob(cells, random, 'rubble', AREA(40));
  blob(cells, random, 'floor', AREA(70));
  blob(cells, random, 'floor', AREA(40));

  // Two smoothing passes before the trees go in. A raw drunkard's walk leaves
  // single-tile spurs and pinholes, and those hard right angles are what read
  // as "blocks" instead of landscape. Majority-vote smoothing rounds a blob
  // into something deposition might have made. Deterministic — no randomness —
  // so it cannot cost the generator its replay guarantee.
  smooth(cells);
  smooth(cells);

  // The three new biomes go in AFTER the smoothing, on purpose. A blob laid
  // before it erodes to roughly a third of its size — which is why `crevice`
  // averaged under two tiles and was missing from half of all sites — and
  // these are meant to be places, not specks. The cost is that their edges
  // stay blobbier than the older kinds'; the fringe pass in the renderer is
  // what softens that, and it reads as growth rather than as geology.
  blob(cells, random, 'meadow', AREA(75));
  blob(cells, random, 'meadow', AREA(50));
  blob(cells, random, 'array', AREA(55));
  blob(cells, random, 'bramble', AREA(40));
  blob(cells, random, 'bramble', AREA(28));

  // Trees are dotted, not blobbed — a copse is single trunks with light
  // between them, and a solid mass of them would read as one green rock.
  //
  // Nothing grows near the camp. A tree is drawn as a canopy three tiles tall,
  // and one standing south of the tent sorts in front of it and swallows the
  // whole camp — which happened on about half of all sites. The margin is what
  // a canopy can reach from outside it. Tested on the same draw, so the number
  // of calls to random() is unchanged and the replay guarantee holds.
  for(let i = 0; i < AREA(70); i++){
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

  // Last of all, and after the camp, because the shore has to be read off the
  // ground as it finally stands: the clearing is stamped over whatever was
  // there, and a pond it cut into is a pond with a new bank on it.
  shoreline(cells);

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

/* Which way the land lies from each tile of water, written back into the
 * terrain as one of the eight shore kinds.
 *
 * Water is the one kind whose tiles are not interchangeable: a pond drawn as
 * the same tile all the way to its edge reads as a hole cut in the ground
 * rather than as water lying in it, because real water is shallow where it
 * meets the bank and that is the only place you can see how deep it is. So
 * every tile of water that touches land is re-labelled with the direction the
 * land is in, and the art has a shallowed cut for each of the eight.
 *
 * A picture, not a rule: TERRAIN gives all eight exactly water's row, so
 * walking, building, growing, pathing and spawning cannot tell the difference.
 *
 * Which direction, when land is on more than one side, is a vote. Each of the
 * eight neighbours that is land pulls the tile towards itself, orthogonals
 * twice as hard as diagonals — a bank you could touch outranks one you could
 * only see past a corner — and the sum is snapped to the nearest eighth. A
 * tile pulled equally both ways, a one-tile channel with land either side,
 * has no answer and is left as open water, which is the honest picture: the
 * shallows would have met in the middle.
 *
 * Integer arithmetic on purpose. The map has to come out the same on the
 * Worker and in five browsers, and Math.atan2 is not required to agree to the
 * last bit between engines, which is a strange way to lose the replay
 * guarantee.
 */
const AROUND = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];

/* The eight directions a shore can name, as offsets. Iteration order is the
   tie-break when two banks pull equally, so it is fixed here rather than built
   where it is used. */
const SHORE_OFF = {
  N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1],
  S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1],
};

export function shoreline(cells, height = MAP_H){
  const before = cells.slice();
  const at = (x, y) => (x >= 0 && y >= 0 && x < MAP_W && y < height ? before[y * MAP_W + x] : 'water');

  for(let y = 0; y < height; y++){
    for(let x = 0; x < MAP_W; x++){
      if(before[y * MAP_W + x] !== 'water') continue;

      let sx = 0, sy = 0;
      for(const [dx, dy] of AROUND){
        if(isWater(at(x + dx, y + dy))) continue;
        const pull = dx && dy ? 1 : 2;
        sx += dx * pull;
        sy += dy * pull;
      }
      if(!sx && !sy) continue;

      // Snap to eighths: a component counts only if it is more than half the
      // other one, which puts the boundary between "north" and "north-east"
      // at about 27 degrees rather than the exact 22.5 a trig version would
      // give. The difference is a rounding rule, and this one is exact.
      const ax = Math.abs(sx), ay = Math.abs(sy);
      let dir = '';
      if(ay * 2 > ax) dir += sy < 0 ? 'N' : 'S';
      if(ax * 2 > ay) dir += sx > 0 ? 'E' : 'W';

      /* An average can point at the one thing it is describing the absence of.
         Land wraps more than halfway round a tile wherever the water runs as a
         diagonal channel — banks on five sides, water on three — and the mean
         of those five then snaps to the gap between two of them, which is
         water. A shore drawn pointing into the pond is the exact fault this
         function exists to prevent, so when the average lands on water, take
         the single strongest bank instead of the average of them all.
         Deterministic: fixed iteration order, first maximum wins, and not one
         call to random(). */
      if(dir && isWater(at(x + SHORE_OFF[dir][0], y + SHORE_OFF[dir][1]))){
        let best = '', bestPull = 0;
        for(const [d, [dx, dy]] of Object.entries(SHORE_OFF)){
          if(isWater(at(x + dx, y + dy))) continue;
          const pull = dx && dy ? 1 : 2;
          if(pull > bestPull){ bestPull = pull; best = d; }
        }
        if(best) dir = best;
      }
      cells[y * MAP_W + x] = 'shore' + dir;
    }
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
  shoreline(cells, COMBAT_H);
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
