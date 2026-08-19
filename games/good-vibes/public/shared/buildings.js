/* Buildings and upgrades — what the salvage pool buys. */


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
