/* The playable classes.
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
 * of this file is kept — both ends import this module and a name
 * that is not exported is a throw at the top of it. The lobby and the landing
 * page both iterate it, and both render nothing when it is empty, which is the
 * correct thing for them to render.
 *
 * If a sixth seat is ever wanted it needs PARTY_SIZE moved first; the test
 * pins CLASSES.length + OPEN_ROLES.length against it.
 */
export const OPEN_ROLES = [];

