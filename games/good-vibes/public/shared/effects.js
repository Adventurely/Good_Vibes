/* Effect kinds, ailments, boons and blights. */


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
];


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
