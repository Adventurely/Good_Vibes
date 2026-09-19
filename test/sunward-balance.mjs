/* Does Sunward's curve open at the pace it is supposed to?
 *
 * The numbers in `public/sunward/content.js` cannot be read off the table. A
 * tier's cost and its output are two dials, what a player actually owns at hour
 * four is the two of them fought out against a 15% price rise per purchase and
 * twenty upgrades, and the failures that matter — a tier nobody reaches, an
 * upgrade that unlocks after everyone has stopped playing — are invisible on
 * screen for days. So they are measured.
 *
 * This drives the real content module. Nothing here reimplements a rule: it
 * taps, it buys, and every number it prints came out of the same functions the
 * browser calls. What it contributes is a model of a player.
 *
 *   node test/sunward-balance.mjs               a day, at four taps a second
 *   node test/sunward-balance.mjs 345600 8      four days, at eight
 *
 * The dials it reports on are `GROWERS` (cost and rate, and the 1.75x payback
 * ratio between tiers), `COST_GROWTH`, and the `need` on each upgrade. Turn the
 * ratio first: it decides whether the shop has one live row or six.
 */

import assert from 'node:assert/strict';

import {
  GROWERS, GROWER_IDS, growerCost, plant, study, studyRefusal, offered,
  newGame, tick, tap, steadyRate, pendingSeeds, formatLight, formatTime,
  UPGRADES, DAY_LENGTH,
} from '../public/sunward/content.js';

const HORIZON = Number(process.argv[2]) || 24 * 3600;
const TAPS = Number(process.argv[3] ?? 4);      // while the player is at the desk
const TAP_UNTIL = 900;                          // then they leave it running

/* ------------------------------------------------------------- the player --- */

/* Somebody paying attention but not solving the game: buy every upgrade that is
 * offered and affordable, and otherwise save for whichever single grower pays
 * for itself soonest.
 *
 * Saving is the whole model. The first cut spent every coin the moment it
 * landed, which can only ever buy the cheapest tier — it reported that nothing
 * past the fifth grower was reachable in a week, and what it had actually
 * measured was a player who never saves for anything. That is not the honest
 * floor for how well somebody plays a clicker; it is a different game.
 */
function step(state, dt){
  const grown = tick(state, dt);

  for(const up of offered(state)) if(!studyRefusal(state, up.id)) study(state, up.id);

  let best = null;
  for(const g of GROWERS){
    const cost = growerCost(g, state.owned[g.id]);
    const payback = cost / g.rate;
    if(!best || payback < best.payback) best = { id: g.id, payback, cost };
  }
  if(best && state.light >= best.cost) plant(state, best.id, 1);
  return grown;
}

/* ------------------------------------------------------------------ report --- */

const MARKS = [60, 600, 900, 1800, 3600, 4 * 3600, 12 * 3600, 24 * 3600, 48 * 3600, 96 * 3600]
  .filter(at => at <= HORIZON);

const state = newGame();
const DT = 0.5;
const rows = [];
let firstSeed = null;
const reached = {};

let byHand = 0, byLot = 0;
for(let at = 0; at <= HORIZON; at += DT){
  byLot += step(state, DT);
  // The rate is passed in, as the page passes it: Momentum reads it.
  if(at < TAP_UNTIL) for(let i = 0; i < TAPS * DT; i++) byHand += tap(state, TAPS);
  if(firstSeed === null && pendingSeeds(state) >= 1) firstSeed = at;
  for(const id of GROWER_IDS) if(reached[id] === undefined && state.owned[id] > 0) reached[id] = at;

  const due = MARKS.find(mark => mark > at - DT && mark <= at);
  if(due){
    rows.push({
      at: due,
      rate: steadyRate(state),
      lifetime: state.life.earned,
      upgrades: Object.keys(state.bought).length,
      seeds: pendingSeeds(state),
      kinds: GROWER_IDS.filter(id => state.owned[id] > 0).length,
      owned: { ...state.owned },
      hand: byHand / Math.max(1, byHand + byLot),
    });
  }
}

console.log(`Sunward balance — ${formatTime(HORIZON)} at ${TAPS} taps a second`
  + ` for the first ${formatTime(TAP_UNTIL)}, ${(HORIZON / DAY_LENGTH).toFixed(0)} in-game days\n`);
console.log('   time |     rate |  lifetime | ups | seeds | kinds | by hand | what is on the lot');
for(const row of rows){
  const lot = GROWER_IDS.filter(id => row.owned[id] > 0).map(id => `${id}:${row.owned[id]}`).join(' ');
  console.log(
    `${formatTime(row.at).padStart(7)} | ${(formatLight(row.rate) + '/s').padStart(8)}`
    + ` | ${formatLight(row.lifetime).padStart(9)} | ${String(row.upgrades).padStart(3)}`
    + ` | ${String(row.seeds).padStart(5)} | ${String(row.kinds).padStart(5)}`
    + ` | ${(Math.round(row.hand * 100) + '%').padStart(7)} | ${lot}`,
  );
}

console.log('\nfirst of each kind planted:');
for(const g of GROWERS){
  console.log(`  ${g.name.padEnd(16)} ${reached[g.id] === undefined ? 'not in ' + formatTime(HORIZON) : formatTime(reached[g.id])}`);
}
console.log(`\nfirst seed available at ${firstSeed === null ? 'never' : formatTime(firstSeed)}`);
console.log(`upgrades bought: ${Object.keys(state.bought).length} of ${UPGRADES.length}`);

/* The guardrails. Deliberately coarse — the shape of the curve is pinned by
   test/sunward.test.js, and these are the three things that would make the
   game unplayable without failing any assertion about the tables themselves. */
const first = rows.find(row => row.at === 60);
if(first){
  assert.ok(first.rate > 0.2,
    `a minute in, the lot makes ${formatLight(first.rate)}/s — the opening is too slow to feel like anything`);
}
const quarter = rows.find(row => row.at === 900);
if(quarter && TAPS >= 4 && TAP_UNTIL >= 900){
  assert.ok(quarter.hand >= 0.4,
    `a quarter hour in, the hand has made ${Math.round(quarter.hand * 100)}% of the energy — tapping`
    + ' is not worth doing, and a clicker in which clicking does not matter is a screensaver');
}
const hour = rows.find(row => row.at === 3600);
if(hour){
  assert.ok(hour.kinds >= 3,
    `an hour in, only ${hour.kinds} kinds are planted — the shop is not opening fast enough`);
}
if(HORIZON >= 24 * 3600){
  assert.ok(firstSeed !== null && firstSeed < 6 * 3600,
    `the first seed took ${firstSeed === null ? 'longer than the run' : formatTime(firstSeed)};`
    + ' a reset nobody reaches in an evening is a reset nobody reaches');
  /* What a first run should open, and what it must not.
   *
   * The first nine rows are the whole shop as it stood before the late tiers
   * were added, and a day should very nearly finish them: a shop that opens
   * slower than that is a shop most players never see the bottom of.
   *
   * The last three are priced for a lot ten seasons in. If a first day — on
   * ground that has never had a seed — reaches the top of the shop, those rows
   * are underpriced by orders of magnitude and the late game they were added
   * for has been given away to somebody who has not got there yet. Both ends
   * are checked, because turning the cost of a late tier down is the obvious
   * thing to do when the late game feels slow, and it is the wrong one.
   */
  const OPENING = 9;
  const day = rows.find(row => row.at === 24 * 3600);
  assert.ok(day && day.kinds >= OPENING,
    `a day in, only ${day ? day.kinds : 0} of the opening ${OPENING} kinds are planted`);
  assert.ok(day && day.kinds < GROWERS.length,
    `a day in, a lot that has never replanted already owns all ${GROWERS.length} kinds —`
    + ' the late rows are meant to be out of reach until the seasons stack up');
}
