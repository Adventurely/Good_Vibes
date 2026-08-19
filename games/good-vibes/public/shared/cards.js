/* The card table and the starting decks. */


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
    effect: { kind: 'ward', amount: 3, rounds: 1 },
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
    effect: { kind: 'strike', amount: 3 },
    note: 'Forty centimetres of drop-forged persuasion.',
  },
  shore: {
    name: 'Shore Up', kind: 'defend', classId: 'engineer',
    effect: { kind: 'ward', amount: 3, rounds: 1 },
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
    name: 'Ember Rune', kind: 'buff', classId: 'wizard', pageCost: 1, targetsAlly: true,
    effect: { kind: 'might', amount: 4, rounds: 1 },
    note: 'A page burned down to its ash and drawn along somebody else\u2019s blade. It stays lit for one swing.',
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

  /* --- the Hauler: the only seat that buys with health ------------------
   *
   * Two of these cost health and both say so on their face — `hpCost` sits
   * beside pageCost and powerCost, so cardPlayable refuses the one that would
   * take the last point, and the end screen scores it as Damage Taken. The
   * Hauler leads that column every run. That is the seat, not a failure.
   */
  shoulder: {
    name: 'Shoulder', kind: 'attack', classId: 'hauler',
    effect: { kind: 'strike', amount: 3 },
    note: 'Get under it and drive with the legs. It is how you move anything, a Rust Hulk included.',
  },
  /* The same numbers as Shore Up, deliberately. The Engineer's is guard he can
     put on a seat that needs it; this is the floor under the seat the wave is
     already aimed at — and it is the card the Hauler plays on the rounds he is
     not covering, because cover spends the very same pool. */
  weight: {
    name: 'Take the Weight', kind: 'defend', classId: 'hauler',
    effect: { kind: 'ward', amount: 3, rounds: 1 },
    note: 'Feet planted, arms locked, and do not think about it. Thinking about it is how you drop things.',
  },
  setfeet: {
    name: 'Set Your Feet', kind: 'buff', classId: 'hauler', hpCost: 2,
    effect: { kind: 'heft', amount: 2 },
    note: 'Two of your own, for two on every swing after it. You will feel both of them.',
  },
  /* One copy, for the reason every party card gets one: a card you hold every
     other turn is a rotation, not a moment. Alone it is a plain ward with no
     special case at all, because the coverer is the only seat standing. */
  behind: {
    name: 'Get Behind Me', kind: 'defend', classId: 'hauler',
    effect: { kind: 'cover', amount: 6 },
    note: 'You are not faster than it. You are just closer.',
  },
  /* Heft is a term inside strikePower, so this is worth nothing at all on the
     Grafter — the first good card in this game the table can hand to the wrong
     person, which is a decision rather than a formality. */
  legup: {
    name: 'Leg Up', kind: 'buff', classId: 'hauler', hpCost: 3, targetsAlly: true,
    effect: { kind: 'heft', amount: 3 },
    note: 'Laced fingers, their boot, and up. Three off you and three onto them, for the rest of the fight.',
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
    name: 'Pruning Hook', kind: 'attack', classId: 'grafter',
    effect: { kind: 'strike', amount: 3 },
    note: 'Curved, and sharpened on the inside. Made for taking a thing off at the joint rather than going through it.',
  },
  /* Three across three rounds, so it is worth six and reads as three. Two of
     these on one target is still six — canker refreshes rather than stacks,
     exactly as an ailment does, or three of them on one Hulk would pay out
     forty-five. Two of these on two targets is twelve, which is the class. */
  ringbark: {
    name: 'Ringbark', kind: 'attack', classId: 'grafter',
    effect: { kind: 'canker', amount: 4 },
    note: 'A ring cut the whole way round. It stands there looking fine for a week, and then it does not.',
  },
  bramble: {
    name: 'Bramble', kind: 'defend', classId: 'grafter',
    effect: { kind: 'ward', amount: 3, rounds: 1 },
    note: 'Cut most of the way through, bent over, and laid along the gap. It has held a field before now.',
  },
  season: {
    name: 'Bad Season', kind: 'attack', classId: 'grafter',
    effect: { kind: 'cankerAll', amount: 3 },
    note: 'It gets into the whole row at once. Nothing dies today. Most of it dies.',
  },
  /* A cutting is a strike, so it lands for four plus whatever Heft or Might
     the holder is carrying — posted into a Hauler mid-ramp it is worth roughly
     double what it is worth in her own hand, which is the whole card. */
  scion: {
    name: 'Graft', kind: 'buff', classId: 'grafter', targetsAlly: true,
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
  wizard: { spark: 4, sign: 2, fireball: 2, rune: 1, nova: 1 },
  hauler: { shoulder: 3, weight: 3, setfeet: 2, behind: 1, legup: 1 },
  grafter: { hook: 3, ringbark: 3, bramble: 2, season: 1, scion: 1 },
};

/* Cards every deck holds regardless of class. */
export const UNIVERSAL_CARDS = Object.entries(CARDS)
  .filter(([, card]) => card.universal)
  .map(([id]) => id);

/* Deprecated alias, kept because a name that has ever been exported is pinned
   by the published-contract test, and a
 * missing export there is a throw at the top of the Worker — which takes the
 * whole site down, sign-in included. Cards carry the same { name, effect, note }
 * shape the actions did, so anything reading it still works.
 *
 * Delete once the room has been updated to read CARDS. It must stay below the
 * CARDS definition: aliasing a const before its declaration is exactly the
 * top-level throw this comment is about.
 */
export const COMBAT_ACTIONS = CARDS;
