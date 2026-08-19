/* Spells, modifiers and the Wizard's spellbook. */


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
