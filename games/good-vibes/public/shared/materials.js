/* Materials, potions and salvage: the three pools a run spends. */


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
