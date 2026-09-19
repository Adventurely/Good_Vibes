/* Sunward's rules, and the balance of them.
 *
 * The whole game is pure functions over data tables — no DOM, no clock, no
 * storage — precisely so this file can drive a run of it in Node and check
 * that the curve is the curve. A clicker's failure mode is not a crash; it is
 * a tier nobody would ever buy, an upgrade that unlocks four days after it
 * would have mattered, or a save that loads as NaN and takes the whole economy
 * with it. None of those show up on screen until somebody has played for a
 * week, so they are checked here.
 *
 * The art is checked here too. It is client-only and cannot break the site,
 * but a sprite with a ragged row draws a diagonal tear and a sprite naming a
 * palette key that does not exist draws nothing at all.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DAY_LENGTH, DAY_START, SWING, dayPhase, sunHeight, phaseName, PHASE_NAMES, averageFactor,
  GROWERS, GROWER_IDS, GROWER_BY_ID, COST_GROWTH, growerCost, bulkCost, affordable,
  UPGRADES, UPGRADE_BY_ID, ACHIEVEMENTS, ACHIEVEMENT_BY_ID,
  STAT_KEYS, STAT_LABELS, STAT_SHORT, PEAK_KEYS, blankStats, score,
  HISTORY_STEP, HISTORY_SAMPLES, freshHistory, sample, tapRate, MILESTONES, note,
  SAVE_VERSION, newGame, freshOwned, bonuses, SEED_RATE, seedBonus, phaseFactor,
  rateOf, totalRate, steadyRate, tapValue, tapPays, momentum, isWindfall, STREAK_CAP, WINDFALL_EVERY,
  snapshot, meets, offered, award,
  MAX_TICK, tick, tap, plantRefusal, plant, studyRefusal, study,
  SEED_SCALE, SEED_RATIO, seedAt, seedsFrom, pendingSeeds, lightForSeeds, energyForSeeds,
  prestigeRefusal, prestige, winters, winterMedal, seedsEarned, seedMedal,
  PRESTIGE, PRESTIGE_BY_ID, prestigeOffered, rootRefusal, root, growerCount, markGrown,
  upgradeCost, CRATE, halfNeed, volunteerFor,
  RING_FROM, RING_LAST, RING_MULT, RING_STEP, ringMult, ringFor, prestigeAt, prestigeUpTo, prestigeById, prestigeCost,
  OFFLINE_RATE, OFFLINE_CAP, offlineGain, catchUp,
  toSave, fromSave, formatLight, formatTime, formatStat, breakdown,
  CODE_TAG, CODE_EMPTY, CODE_ALIEN, CODE_BROKEN, encodeSave, decodeSave, codeRefusal,
} from '../public/sunward/content.js';

import {
  SCENE_W, SCENE_H, GROUND_Y, PALETTE, shade, SKIES, skyBlend,
  PROP_ART, PROP_SPOTS, PROP_STEPS, propCount, growthFor, treeBounds, TREE_X, TREE_Y,
} from '../public/sunward/art.js';

/* ------------------------------------------------------------ the growers */

test('every grower carries the fields the game reads', () => {
  for(const g of GROWERS){
    const where = `grower "${g.id}"`;
    assert.match(g.id, /^[a-z][a-z0-9-]*$/, `${where}: id must be kebab-case`);
    for(const field of ['name', 'flavour', 'art']){
      assert.equal(typeof g[field], 'string', `${where}: ${field} must be a string`);
      assert.ok(g[field].length, `${where}: ${field} must not be empty`);
    }
    assert.ok(['day', 'night', 'any'].includes(g.phase), `${where}: phase must be day, night or any`);
    assert.ok(g.cost > 0, `${where}: cost must be positive`);
    assert.ok(g.rate > 0, `${where}: rate must be positive, or it is scenery`);
  }
});

test('grower ids are unique and every one has a sprite and somewhere to stand', () => {
  assert.equal(new Set(GROWER_IDS).size, GROWER_IDS.length, 'duplicate grower id');
  for(const g of GROWERS){
    assert.ok(PROP_ART[g.art], `grower "${g.id}" has no art key "${g.art}"`);
    const spots = PROP_SPOTS[g.art];
    assert.ok(Array.isArray(spots) && spots.length >= PROP_STEPS.length,
      `grower "${g.id}" needs a spot for each of the ${PROP_STEPS.length} copies it can show`);
  }
});

test('the tiers are in order and none of them is a dead row', () => {
  /* The two things that ruin a clicker's shop. A tier that costs more and makes
     less than the one below it is never the right purchase; a tier that pays
     back FASTER than the one below it makes every tier below it pointless the
     moment it unlocks. Both are invisible on screen and obvious here. */
  for(let i = 1; i < GROWERS.length; i++){
    const below = GROWERS[i - 1], here = GROWERS[i];
    assert.ok(here.cost > below.cost, `"${here.id}" costs less than "${below.id}"`);
    assert.ok(here.rate > below.rate, `"${here.id}" makes less than "${below.id}"`);
    const paybackBelow = below.cost / below.rate;
    const payback = here.cost / here.rate;
    assert.ok(payback > paybackBelow,
      `"${here.id}" pays for itself faster than "${below.id}", which makes every tier below it a mistake`);
    const step = payback / paybackBelow;
    assert.ok(step > 1.3 && step < 2.6,
      `"${here.id}" pays back ${step.toFixed(2)}x slower than "${below.id}" — the curve wants 1.3 to 2.6`);
  }
});

test('the first grower is a handful of taps and the last is a long evening', () => {
  // The opening has to be reachable by hand: twelve taps at one light each.
  assert.ok(GROWERS[0].cost <= 20, 'the first grower must be affordable by tapping alone');
  const top = GROWERS[GROWERS.length - 1];
  assert.ok(top.cost / top.rate > 3600, 'the top tier should not pay for itself inside an hour');
});

/* --------------------------------------------------------------- the cost */

test('each one bought makes the next cost more, and the bulk price is the sum', () => {
  const g = GROWER_BY_ID.moss;
  assert.equal(growerCost(g, 0), Math.ceil(g.cost));
  assert.ok(growerCost(g, 1) > growerCost(g, 0), 'the second must cost more than the first');

  for(const count of [1, 2, 7, 25, 100]){
    let sum = 0;
    for(let i = 0; i < count; i++) sum += g.cost * Math.pow(COST_GROWTH, i);
    // The closed form is used on every frame; a loop is used here on purpose,
    // so the two are not the same arithmetic checked against itself.
    assert.ok(Math.abs(bulkCost(g, 0, count) - Math.ceil(sum)) <= 1,
      `bulk price for ${count} disagrees with adding them up one at a time`);
  }
  assert.equal(bulkCost(g, 0, 0), 0, 'nothing costs nothing');
});

test('the max button never asks for light you do not have', () => {
  const g = GROWER_BY_ID.fern;
  for(const owned of [0, 3, 40, 200]){
    for(const light of [0, 1, 129, 130, 1e4, 1e9, 1e18]){
      const n = affordable(g, owned, light);
      assert.ok(Number.isInteger(n) && n >= 0, `affordable returned ${n}`);
      if(n > 0){
        assert.ok(bulkCost(g, owned, n) <= light,
          `max offered ${n} at ${light} light, which costs ${bulkCost(g, owned, n)}`);
      }
      // And it must not be shy either: one more has to be out of reach.
      assert.ok(bulkCost(g, owned, n + 1) > light,
        `max offered ${n} when ${n + 1} was affordable`);
    }
  }
});

/* ------------------------------------------------------------- the day */

test('the day turns, and a whole one averages out to nothing', () => {
  assert.equal(dayPhase(0), 0);
  assert.ok(Math.abs(dayPhase(DAY_LENGTH * 1.25) - 0.25) < 1e-9, 'the clock must wrap');
  assert.ok(sunHeight(0.25) > 0.99, 'noon is the top of the arc');
  assert.ok(sunHeight(0.75) < -0.99, 'midnight is the bottom of it');

  /* The rate on a row is the average, and it is only honest if the swing
     really does cancel over a day. Sampled rather than reasoned about, because
     the thing being checked is the code and not the trigonometry. */
  for(const phase of ['day', 'night']){
    let total = 0;
    const steps = 2000;
    for(let i = 0; i < steps; i++) total += phaseFactor(phase, (i / steps) * DAY_LENGTH);
    assert.ok(Math.abs(total / steps - 1) < 0.001,
      `a whole day of "${phase}" averaged ${(total / steps).toFixed(4)}, not 1`);
  }
  assert.equal(phaseFactor('any', 123), 1, 'an "any" grower must not feel the sky at all');
});

test('a bought trough is worth something, and worth exactly what it says', () => {
  /* These shaved the swing from both ends for a while, which is worth nothing
     at all: the swing already cancels over a day, so taking the same slice off
     each end changes the shape of the line and not the area under it. Three
     upgrades, at 8M, 900M and 7T light, that a player could buy and measure no
     difference from. They lift the bottom only now. */
  for(const lift of [0.1, 0.2, 0.5]){
    for(const phase of ['day', 'night']){
      let total = 0;
      const steps = 4000;
      for(let i = 0; i < steps; i++) total += phaseFactor(phase, (i / steps) * DAY_LENGTH, SWING, lift);
      const sampled = total / steps;
      assert.ok(Math.abs(sampled - averageFactor(phase, lift)) < 0.002,
        `a day at lift ${lift} sampled ${sampled.toFixed(4)}, and averageFactor says ${averageFactor(phase, lift).toFixed(4)}`);
      assert.ok(sampled > 1.01, `lift ${lift} left the day averaging ${sampled.toFixed(4)} — the upgrade does nothing`);
    }
  }
  assert.equal(averageFactor('any', 0.5), 1, 'an "any" grower has no trough to lift');

  // And the peak must be untouched: it is the trough that moves.
  assert.equal(phaseFactor('day', DAY_LENGTH * 0.25, SWING, 0.3),
    phaseFactor('day', DAY_LENGTH * 0.25, SWING, 0), 'noon must not change');
  assert.ok(phaseFactor('day', DAY_LENGTH * 0.75, SWING, 0.3) >
    phaseFactor('day', DAY_LENGTH * 0.75, SWING, 0), 'midnight must');
});

test('every upgrade in the shop is worth buying', () => {
  /* The failure this exists for is not a crash: it is a row that charges for a
     multiplier that multiplies nothing. Each one is bought against a lot that
     owns some of everything, and the steady rate has to move. */
  /* The hand is measured over a whole round of taps at four a second, so the
     two upgrades that pay by rhythm — Momentum by speed, Windfall by the tenth
     tap — count for what they actually pay and not for what a single tap at a
     standstill would. */
  const hand = state => {
    let sum = 0;
    for(let i = 0; i < WINDFALL_EVERY; i++){
      state.run.taps = i;
      sum += tapPays(state, 4);
    }
    return sum / WINDFALL_EVERY;
  };
  for(const up of UPGRADES){
    const state = newGame();
    for(const g of GROWERS) state.owned[g.id] = 20;
    const before = { rate: steadyRate(state), tap: hand(state) };
    state.bought[up.id] = true;
    const after = { rate: steadyRate(state), tap: hand(state) };
    assert.ok(after.rate > before.rate || after.tap > before.tap,
      `"${up.id}" costs ${formatLight(up.cost)} and changes neither the rate nor the tap`);
  }
});

test('the swing is real enough to notice and never pays a negative', () => {
  assert.ok(SWING > 0.2, 'a swing nobody can see is a mechanic nobody will learn');
  for(let i = 0; i <= 100; i++){
    const at = (i / 100) * DAY_LENGTH;
    for(const phase of ['day', 'night', 'any']){
      assert.ok(phaseFactor(phase, at) >= 0, 'a grower must never make negative light');
    }
  }
});

test('every phase of the day has a name, and a fresh run starts in daylight', () => {
  for(let i = 0; i <= 40; i++){
    const name = phaseName(i / 40);
    assert.equal(typeof name, 'string');
    assert.ok(name.length, `no name for phase ${i / 40}`);
  }
  assert.ok(PHASE_NAMES.length >= 4, 'the day wants more than four names in it');
  assert.ok(sunHeight(dayPhase(DAY_START)) > 0.3,
    'a new lot must open with the sun up — dawn is the most saturated sky there is');
});

/* ---------------------------------------------------------- the upgrades */

test('every upgrade is buyable, does something, and names things that exist', () => {
  for(const up of UPGRADES){
    const where = `upgrade "${up.id}"`;
    assert.match(up.id, /^[a-z][a-z0-9-]*$/, `${where}: id must be kebab-case`);
    assert.ok(up.name && up.name.length, `${where}: needs a name`);
    assert.ok(up.flavour && up.flavour.length, `${where}: needs a line of flavour`);
    assert.ok(up.cost > 0, `${where}: must cost something`);

    const e = up.effect;
    const does = ['clickMult', 'streak', 'windfall', 'allMult', 'fingers', 'steady', 'grower'].filter(k => e[k]);
    assert.equal(does.length, 1, `${where}: must do exactly one thing, does ${does.length}`);
    if(e.streak) assert.ok(e.streak > 0, `${where}: a streak of nothing is not an upgrade`);
    if(e.windfall) assert.ok(e.windfall > 1, `${where}: a windfall must pay more than the tap did`);
    if(e.grower){
      assert.ok(GROWER_BY_ID[e.grower], `${where}: multiplies unknown grower "${e.grower}"`);
      assert.ok(e.mult > 1, `${where}: a multiplier of ${e.mult} is not an upgrade`);
    }
    if(e.allMult) assert.ok(e.allMult > 1, `${where}: allMult must be more than one`);
    if(e.clickMult) assert.ok(e.clickMult > 1, `${where}: clickMult must be more than one`);
    if(e.steady) assert.ok(e.steady > 0 && e.steady <= SWING, `${where}: steady must fit inside the swing`);

    if(up.need && up.need.owned){
      assert.ok(GROWER_BY_ID[up.need.owned.id], `${where}: unlocks on unknown grower "${up.need.owned.id}"`);
      assert.ok(up.need.owned.count > 0, `${where}: an unlock at zero owned is not an unlock`);
    }
  }
  const ids = UPGRADES.map(u => u.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate upgrade id');
});

test('upgrades unlock on this run, not on all time', () => {
  /* Upgrades are spent at a reset, so their unlocks have to reset with them.
     Measured against a lifetime total instead, a returning player is handed the
     whole shop on their second run and the middle of the game disappears. */
  for(const up of UPGRADES){
    for(const key of Object.keys(up.need || {})){
      assert.ok(['runTaps', 'runEarned', 'owned'].includes(key),
        `upgrade "${up.id}" unlocks on "${key}", which does not reset when the lot does`);
    }
  }
});

test('every grower can be improved, and no row is another row again', () => {
  /* The shop had forty-two rows, and most of the difference was the same
     upgrade sold twice: two doublings per grower, six of the tap, three slices
     off the swing. What is pinned here is the shape that replaced it — one line
     of each kind, every grower improved exactly once — and the rule behind it:
     no two rows may do the same thing to the same target. A row that is "the
     row above, again, bigger" is not a choice; it is a longer list. */
  const helped = UPGRADES.filter(u => u.effect.grower).map(u => u.effect.grower);
  for(const g of GROWERS){
    assert.equal(helped.filter(id => id === g.id).length, 1,
      `"${g.id}" should be improved by exactly one upgrade, not ${helped.filter(id => id === g.id).length}`);
  }
  assert.ok(UPGRADES.filter(u => u.effect.clickMult).length >= 3, 'the hand needs a line of upgrades');
  assert.ok(UPGRADES.filter(u => u.effect.fingers).length >= 2,
    'without these the hand is left behind by the garden within the hour');
  assert.equal(UPGRADES.filter(u => u.effect.steady).length, 1,
    'the trough is one upgrade; three slices of it were one row said slowly');
  assert.equal(UPGRADES.filter(u => u.effect.streak).length, 1,
    'momentum is one upgrade: a second one would be a fourth step of the hand');
  assert.equal(UPGRADES.filter(u => u.effect.windfall).length, 1,
    'the windfall is one upgrade: a second one is a second beat over the first');
  assert.ok(UPGRADES.length <= 24, `${UPGRADES.length} upgrades is a list again, not a shop`);
});

test('the shop opens one row at a time', () => {
  const state = newGame();
  assert.equal(offered(state).length, 0, 'a fresh lot must not open with the shop already full');
  state.run.taps = 15;
  const first = offered(state);
  assert.equal(first.length, 1, 'fifteen taps should be worth exactly one row');
  assert.equal(first[0].id, 'warm-hands');
});

/* -------------------------------------------------------- the achievements */

test('every medal is winnable and names things that exist', () => {
  const ids = ACHIEVEMENTS.map(a => a.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate achievement id');
  const known = new Set([...STAT_KEYS, 'taps', 'runTaps', 'tapRate', 'lifetime', 'runEarned',
    'light', 'rate', 'growers', 'kinds', 'owned', 'upgrades', 'prestiges', 'seeds', 'seconds', 'days']);
  for(const a of ACHIEVEMENTS){
    assert.match(a.id, /^[a-z][a-z0-9-]*$/, `medal "${a.id}": id must be kebab-case`);
    assert.ok(a.name && a.blurb, `medal "${a.id}" needs a name and a blurb`);
    assert.ok(Object.keys(a.need).length, `medal "${a.id}" is won by doing nothing`);
    for(const key of Object.keys(a.need)){
      assert.ok(known.has(key), `medal "${a.id}" is won on "${key}", which nothing reports`);
      if(key === 'owned') assert.ok(GROWER_BY_ID[a.need.owned.id], `medal "${a.id}": unknown grower`);
    }
  }
});

test('there is a medal for every one of the first ten seeds, and the ladder stops where the game does', () => {
  /* A replanting is a season, a season is a seed, and each of the first ten
     is its own medal — that is what makes the tree's ageing a thing the
     record can show. Ids are untouched wherever the number they name still
     holds, because a medal is a record and a record you lose to a rename is
     not a record. */
  const ladder = ACHIEVEMENTS.filter(a => a.need.seeds !== undefined);
  for(let n = 1; n <= 10; n++){
    assert.ok(ladder.some(a => a.need.seeds === n), `no medal for seed ${n}`);
  }
  assert.equal(seedMedal(1).id, 'first-seed', 'the first seed keeps its old id');
  assert.equal(seedMedal(5).id, 'five-seeds', 'and so does the fifth');
  assert.equal(seedMedal(11), null, 'the eleventh seed is not a rung');
  assert.equal(winterMedal, seedMedal, 'the old name must still resolve');
  // `find` on an undefined count matches the first medal with no seeds in its
  // need at all, which is the one for tapping the tree once.
  for(const nonsense of [undefined, null, 0, -3, 1.5, NaN, '5']){
    assert.equal(seedMedal(nonsense), null, `seedMedal(${String(nonsense)}) must be nothing`);
  }
  const counts = ladder.map(a => a.need.seeds);
  assert.deepEqual(counts, [...counts].sort((a, b) => a - b), 'the ladder must be in order');
  assert.equal(new Set(counts).size, counts.length, 'no two medals for the same seed');
  /* The simulation reaches six seeds in a day, thirteen in a week and fifteen
     in a month, so the rung the ladder is BUILT around has to be a long way
     past that and still inside the world: one nobody can ever stand on is a
     joke, not a goal. That rung is the one carrying the marvel line, and it is
     the fortieth, which is also where the written upgrades stop.

     The two above it are not goals at all. They are ids from the deployed
     table — fifty and a hundred winters — kept because `fromSave` drops a
     medal whose id it does not know, and deleting the row would delete the
     record off somebody's real save. */
  const crown = ACHIEVEMENT_BY_ID['hundred-seeds'];
  assert.equal(crown.need.seeds, 40, 'the marvel line sits where the written ladder ends');
  for(const id of ['fifty-winters', 'hundred-winters', 'thirty-winters', 'twenty-winters', 'fifteen-winters']){
    assert.ok(ACHIEVEMENT_BY_ID[id], `medal id "${id}" is in deployed saves and cannot be dropped`);
  }
  for(const a of ladder){
    assert.ok(Object.keys(a.need).length === 1, `seed medal "${a.id}" should be won by the seed alone`);
  }
});

test('a replanting is a season, and each one wins its seed and its medal', () => {
  const state = newGame();
  assert.equal(seedsEarned(state), 0, 'a fresh lot has stood through nothing');
  for(let n = 1; n <= 3; n++){
    state.life.earned = seedAt(n);
    assert.equal(prestige(state), 1, `the ${n}th replanting should pay a seed`);
    assert.equal(seedsEarned(state), n);
    const won = award(state);
    assert.ok(won.some(a => a.id === seedMedal(n).id), `seed ${n} should win "${seedMedal(n).name}"`);
  }
  // Kept through the save, as the tree's age has to be.
  const back = fromSave(JSON.parse(JSON.stringify(toSave(state))));
  assert.equal(seedsEarned(back), 3);
});

test('a condition that names a key nothing reports is false, not true', () => {
  // A typo in a table should hide a row, never hand it out for free.
  const snap = snapshot(newGame());
  assert.equal(meets({ nonsense: 1 }, snap), false);
  assert.equal(meets({}, snap), true, 'an empty condition is trivially met');
});

test('medals are awarded once and kept through a reset', () => {
  const state = newGame();
  state.life.taps = 1;
  const won = award(state);
  // The id is from when the resource was light; the medal is "First tap" now.
  assert.ok(won.some(a => a.id === 'first-light'), 'one tap must win First tap');
  assert.equal(award(state).length, 0, 'a medal must not be won twice');

  state.life.earned = 1e9;
  prestige(state);
  assert.ok(state.medals['first-light'], 'a reset must not take the medals');
});

/* ------------------------------------------------------------- the record */

test('the record has a label and a column heading for every counter', () => {
  for(const key of STAT_KEYS){
    assert.equal(typeof STAT_LABELS[key], 'string', `"${key}" has no label`);
    assert.ok(STAT_LABELS[key].length, `"${key}" has an empty label`);
    assert.ok(STAT_SHORT[key] && STAT_SHORT[key].length <= 10,
      `"${key}" needs a short column heading that fits a table`);
  }
  const blank = blankStats();
  assert.deepEqual(Object.keys(blank), STAT_KEYS);
  assert.ok(STAT_KEYS.every(key => blank[key] === 0));
});

test('scoring hits all three scopes, and a peak is a high-water mark', () => {
  const state = newGame();
  score(state, 'taps', 3);
  for(const scope of ['session', 'run', 'life']){
    assert.equal(state[scope].taps, 3, `${scope} did not count the taps`);
  }
  for(const key of PEAK_KEYS){
    score(state, key, 10);
    score(state, key, 4);
    assert.equal(state.life[key], 10, `"${key}" is a peak and must not be walked back down`);
  }
});

test('a reset keeps the lifetime record and clears the run', () => {
  const state = newGame();
  score(state, 'earned', 1e9);
  state.life.earned = 1e9;
  score(state, 'taps', 500);
  prestige(state);
  assert.equal(state.life.taps, 500, 'the all-time count must survive a reset');
  assert.equal(state.run.taps, 0, 'the run count must not');
  assert.equal(state.session.taps, 500, 'the sitting is not over just because the run is');
});

test('the history keeps ten minutes and drops the oldest first', () => {
  const history = freshHistory();
  for(let i = 0; i < HISTORY_SAMPLES + 40; i++) sample(history, i * HISTORY_STEP, i, 0);
  assert.equal(history.at.length, HISTORY_SAMPLES, 'the buffer must not grow without end');
  assert.equal(history.rate.length, HISTORY_SAMPLES);
  assert.equal(history.rate[history.rate.length - 1], HISTORY_SAMPLES + 39, 'the newest sample must be kept');
  assert.equal(history.rate[0], 40, 'the oldest must be the one dropped');
});

test('the tap rate is measured over a window, not counted per second', () => {
  const times = [];
  for(let i = 0; i < 50; i++) times.push(100 + i * 0.1);   // five a second for ten seconds
  assert.ok(Math.abs(tapRate(times, 110, 10) - 5) < 0.11, 'five a second should read as five');
  // And it decays honestly once the hand stops rather than sticking.
  assert.ok(tapRate(times, 125, 10) === 0, 'fifteen seconds after the last tap it must read zero');
  assert.equal(tapRate([], 10), 0, 'no taps is no rate, not a divide by zero');
});

test('the milestone log keeps the last entries and no more', () => {
  const state = newGame();
  for(let i = 0; i < MILESTONES + 25; i++) note(state, `thing ${i}`);
  assert.equal(state.log.length, MILESTONES);
  assert.equal(state.log[state.log.length - 1].text, `thing ${MILESTONES + 24}`);
});

/* -------------------------------------------------------------- the play */

test('a tap records how fast the hand was going', () => {
  /* "Best taps per second" was a row on the record that nothing ever wrote to:
     the medal for ten taps a second was being awarded while the counter for the
     same thing sat at zero in all three columns, forever. The page owns the
     clock, so it measures the rate and hands it in. */
  const state = newGame();
  tap(state, 7.5);
  tap(state, 3);
  assert.equal(state.life.peakTaps, 7.5, 'a peak must not be walked back down');
  assert.equal(state.run.peakTaps, 7.5);
  assert.equal(state.session.peakTaps, 7.5);
  tap(state);
  assert.equal(state.life.peakTaps, 7.5, 'a tap with no rate given must not clear it');
});

test('a tap pays, and it pays more once the hand is upgraded', () => {
  const state = newGame();
  assert.equal(tapValue(state), 1, 'a bare hand is worth one');
  assert.equal(tap(state), 1);
  assert.equal(state.light, 1);
  assert.equal(state.life.taps, 1);
  assert.equal(state.life.tapped, 1);

  state.bought['warm-hands'] = true;
  assert.equal(tapValue(state), 2, 'a doubling upgrade must double it');
});

test('the hand borrows from the garden once it can', () => {
  const state = newGame();
  state.owned.moss = 100;              // ten energy a second
  state.bought.gleaning = true;        // a tap is worth a slice of that
  const slice = UPGRADE_BY_ID.gleaning.effect.fingers;
  const rate = totalRate(state);
  assert.ok(Math.abs(tapValue(state) - (1 + rate * slice)) < 1e-9,
    'a tap must be worth its base plus its share of the rate');
});

test('momentum pays for speed, stops at the cap, and is nothing at a standstill', () => {
  const state = newGame();
  assert.equal(tapPays(state, 8), tapValue(state), 'without Momentum, speed is worth nothing extra');
  state.bought.momentum = true;
  const bonus = bonuses(state);
  assert.equal(momentum(0, bonus), 1, 'the first tap after a pause is an ordinary tap');
  assert.ok(momentum(4, bonus) > momentum(2, bonus), 'faster must be worth more');
  assert.ok(Math.abs(momentum(4, bonus) - 2) < 1e-9, 'four a second is a doubling');
  assert.equal(momentum(STREAK_CAP, bonus), momentum(40, bonus),
    'past the cap an autoclicker is worth exactly what a flurry is');
  assert.equal(momentum(-3, bonus), 1, 'a negative rate is a broken clock, not a penalty');
  assert.equal(tap(state, 4), 2, 'and the tap itself pays the momentum');
  assert.equal(tap(state, 0), 1);
});

test('every tenth tap is the windfall, and it is the same tenth everywhere', () => {
  const state = newGame();
  for(let i = 0; i < 30; i++) assert.equal(tap(state, 4), 1, 'without Windfall there is no tenth tap');

  const rich = newGame();
  rich.bought.windfall = true;
  const paid = [];
  for(let i = 0; i < 2 * WINDFALL_EVERY; i++) paid.push(tap(rich, 0));
  const big = paid.filter(v => v > 1);
  assert.equal(big.length, 2, `two rounds of ${WINDFALL_EVERY} are two windfalls, not ${big.length}`);
  assert.equal(paid[WINDFALL_EVERY - 1], UPGRADE_BY_ID.windfall.effect.windfall, 'the tenth pays ten');
  assert.equal(paid[WINDFALL_EVERY - 2], 1, 'and the ninth pays one');
  assert.ok(isWindfall(rich) === false, 'the twenty-first tap is not the windfall');
  rich.run.taps = WINDFALL_EVERY - 1;
  assert.ok(isWindfall(rich), 'the page can ask before it taps, so it can draw the tenth bigger');

  // Counted off the run, so a replant starts the count again and the medals'
  // all-time tap count has nothing to do with it.
  rich.life.taps = 12345;
  rich.run.taps = 0;
  assert.equal(isWindfall(rich), false);
});

test('at the quarter hour the hand is still worth at least as much as the lot', () => {
  /* The failure this pins: the shop where the hand was worth two energy at the
     forty-five minute mark against a lot making a hundred and fifty a second,
     and tapping was two percent of income from the half hour on. The lot here
     is what the balance harness holds at fifteen minutes, with the hand's
     upgrades that unlock by then bought. */
  const state = newGame();
  Object.assign(state.owned, { moss: 13, fern: 9, panel: 4 });
  for(const id of ['warm-hands', 'steady-hands', 'gleaning', 'momentum', 'windfall']){
    assert.ok(UPGRADE_BY_ID[id].need.runTaps <= 4 * 900, `${id} should be on the shelf inside fifteen minutes at four a second`);
    state.bought[id] = true;
  }
  let round = 0;
  for(let i = 0; i < WINDFALL_EVERY; i++){ state.run.taps = i; round += tapPays(state, 4); }
  const handPerSecond = 4 * round / WINDFALL_EVERY;
  assert.ok(handPerSecond >= steadyRate(state),
    `four taps a second is worth ${formatLight(handPerSecond)}/s against a lot making ${formatLight(steadyRate(state))}/s`);
});

test('a tick pays what the rate says and no more', () => {
  const state = newGame();
  state.owned.moss = 10;
  const rate = totalRate(state);
  const paid = tick(state, 1);
  assert.ok(Math.abs(paid - rate) < 1e-6, 'one second must pay one second of rate');
  assert.ok(Math.abs(state.light - paid) < 1e-9);
  assert.ok(Math.abs(state.earnedBy.moss - paid) < 1e-9, 'the table must know which kind paid');
  assert.ok(Math.abs(state.life.grown - paid) < 1e-9);
});

test('a tick is clamped, because a closed laptop is not a slow frame', () => {
  const state = newGame();
  state.owned.moss = 10;
  const rate = steadyRate(state);
  const paid = tick(state, 6 * 3600);
  assert.ok(paid < rate * MAX_TICK * 1.6,
    'six hours in one tick must not be paid as six hours at the live rate');
});

test('planting spends the light and refuses when it cannot', () => {
  const state = newGame();
  assert.match(plantRefusal(state, 'moss', 1), /short/, 'an empty purse must say so');
  assert.equal(plant(state, 'moss', 1), null, 'a refused purchase must change nothing');
  assert.equal(state.owned.moss, 0);

  state.light = 1000;
  const cost = plant(state, 'moss', 3);
  assert.equal(state.owned.moss, 3);
  assert.equal(state.light, 1000 - cost);
  assert.equal(state.life.spent, cost);
  assert.equal(state.life.planted, 3);

  assert.match(plantRefusal(state, 'nothing-like-this', 1), /no such grower/);
  assert.match(plantRefusal(state, 'moss', 0), /at least/);
  assert.match(plantRefusal(state, 'moss', 1.5), /at least/);
});

test('an upgrade is bought once, and only when it has unlocked', () => {
  const state = newGame();
  state.light = 1e9;
  assert.match(studyRefusal(state, 'warm-hands'), /Not yet/, 'a locked upgrade must not be for sale');
  state.run.taps = 20;
  assert.equal(studyRefusal(state, 'warm-hands'), null);
  assert.equal(study(state, 'warm-hands').id, 'warm-hands');
  assert.match(studyRefusal(state, 'warm-hands'), /already/);
  assert.match(studyRefusal(state, 'not-a-thing'), /no such upgrade/);
});

test('seeds pay for themselves across everything', () => {
  const state = newGame();
  state.owned.moss = 50;
  const before = totalRate(state);
  state.seeds = 10;
  assert.ok(Math.abs(seedBonus(10) - (1 + SEED_RATE * 10)) < 1e-12);
  assert.ok(Math.abs(totalRate(state) / before - seedBonus(10)) < 1e-9,
    'seeds must lift the growers');
  assert.ok(Math.abs(tapValue(state) - seedBonus(10)) < 1e-9, 'and the hand with them');
});

/* ------------------------------------------------------------ the reset */

test('every seed costs four times the one before it, exactly', () => {
  assert.equal(seedsFrom(0), 0);
  assert.equal(seedsFrom(SEED_SCALE), 1, 'the first seed is a million energy, all told');
  assert.equal(seedAt(1), SEED_SCALE);
  assert.equal(seedsFrom(SEED_SCALE - 1), 0, 'and a pound short is no seed at all');

  /* The float is the thing to watch here. Twenty-five seeds is four to the
     twenty-fourth, which is past where a double counts exactly, and a
     logarithm taken across that gap can say a seed has been earned a hair
     before seedAt agrees — a bar sitting at a hundred percent with the button
     still refusing. The two must never disagree. */
  for(let n = 1; n <= 30; n++){
    assert.equal(seedsFrom(seedAt(n)), n, `at exactly the ${n}th threshold`);
    assert.equal(seedsFrom(seedAt(n) * 0.999999), n - 1, `just under the ${n}th`);
    assert.equal(seedAt(n + 1) / seedAt(n), SEED_RATIO, 'the step must be the ratio, every time');
    assert.equal(lightForSeeds(n), seedAt(n), 'the bar and the payout read one number');
  }
});

test('a replant pays one seed and one seed only, however long you waited', () => {
  /* The trade the owner chose: a season is a seed, so crossing three
     thresholds before getting round to it still pays one. With the thresholds
     four times apart, crossing two at once is already work. */
  const state = newGame();
  state.life.earned = seedAt(4);          // three thresholds past the first
  assert.equal(pendingSeeds(state), 1, 'still just the one');
  assert.equal(prestige(state), 1);
  assert.equal(state.seeds, 1);
  assert.equal(pendingSeeds(state), 1, 'and the next is there straight away');
  assert.equal(prestige(state), 1);
  assert.equal(state.seeds, 2);
});

test('a reset refuses until it would pay something', () => {
  const state = newGame();
  assert.match(prestigeRefusal(state), /Not yet/);
  assert.equal(prestige(state), null, 'a refused reset must change nothing');
  assert.equal(state.prestiges, 0);

  state.life.earned = 2e9;
  state.light = 500;
  state.owned.moss = 12;
  state.bought['warm-hands'] = true;
  state.rooted['deep-mulch'] = true;
  assert.equal(prestigeRefusal(state), null);
  assert.equal(prestige(state), 1);
  assert.equal(state.seeds, 1);
  assert.equal(state.light, 0, 'and no head start, since nothing bought one');
  assert.equal(state.owned.moss, 0);
  assert.deepEqual(state.bought, {}, "the run's upgrades go");
  assert.deepEqual(state.rooted, { 'deep-mulch': true }, 'and the seed upgrades stay');
  assert.equal(state.prestiges, 1);
  assert.deepEqual(state.owned, freshOwned());
});

test('a head start survives the replant that needs it', () => {
  const state = newGame();
  state.rooted['warm-earth'] = true;                 // begin every run with 500
  state.life.earned = seedAt(1);
  assert.equal(prestige(state), 1);
  assert.equal(state.light, PRESTIGE_BY_ID['warm-earth'].effect.startEnergy,
    'the lot must not come back empty-handed once that is bought');
  assert.equal(state.rooted['warm-earth'], true);
});

/* ----------------------------------------------------------- while away */

test('time away pays at half rate and stops at the cap', () => {
  const state = newGame();
  state.owned.moss = 100;
  const rate = steadyRate(state);

  const hour = offlineGain(state, 3600);
  assert.ok(Math.abs(hour.light - rate * OFFLINE_RATE * 3600) < 1e-6);
  assert.equal(hour.capped, false);

  const fortnight = offlineGain(state, 14 * 86400);
  assert.equal(fortnight.seconds, OFFLINE_CAP, 'the payout must stop at the cap');
  assert.equal(fortnight.capped, true, 'and it must say that it did');
});

test('the history clock starts where the run does', () => {
  /* At zero, with `elapsed` already at DAY_START, the page had forty seconds of
     absence to make up before it had drawn a frame, and spent twenty-one of the
     graph's three hundred points on copies of the same moment. */
  const state = newGame();
  assert.equal(state.sampledAt, state.elapsed);
  state.life.earned = 1e9;
  prestige(state);
  assert.equal(state.sampledAt, state.elapsed, 'and a reset must leave it there too');
});

test('a long absence starts the graph again rather than filling it with a guess', () => {
  const state = newGame();
  state.owned.moss = 50;
  for(let i = 0; i < 40; i++) sample(state.history, state.elapsed + i * 2, 100 + i, 1);
  catchUp(state, 7 * 86400);
  assert.equal(state.history.at.length, 0,
    'a week is a hole in a ten-minute graph, and filling it in is drawing income nobody earned');
  assert.equal(state.sampledAt, state.elapsed,
    'and leaving the sample clock behind makes the page walk the whole gap two seconds at a time');
});

test('catching up moves the sky but does not claim you were here', () => {
  const state = newGame();
  state.owned.moss = 100;
  state.owned.fern = 50;
  const before = state.life.seconds;
  const gain = catchUp(state, 7200);

  assert.ok(gain.light > 0);
  assert.equal(state.life.seconds, before, 'two hours with the tab shut is not two hours of tending');
  assert.ok(Math.abs(state.elapsed - (DAY_START + 7200)) < 1e-9, 'but the world kept turning');
  const shared = state.earnedBy.moss + state.earnedBy.fern;
  assert.ok(Math.abs(shared - gain.light) < 1e-6,
    'the whole payout must be attributed to the growers that made it');
  // Fern banks, not moss beds: fifty ferns make 32.5 a second and a hundred
  // moss beds make ten, which is the whole point of the tiers.
  assert.ok(state.earnedBy.fern > state.earnedBy.moss,
    'the split must follow what each kind makes, not how many of them there are');
});

/* ------------------------------------------------------------- the save */

test('a save round-trips everything that matters and drops the sitting', () => {
  const state = newGame();
  state.light = 12345.6;
  state.owned.panel = 9;
  state.bought['warm-hands'] = true;
  state.medals['first-light'] = true;
  state.seeds = 4;
  state.prestiges = 4;
  state.rooted['warm-earth'] = true;
  state.decade = 7;
  score(state, 'taps', 88);
  note(state, 'something happened');
  sample(state.history, 2, 5, 1);

  const back = fromSave(JSON.parse(JSON.stringify(toSave(state))));
  assert.equal(back.light, state.light);
  assert.equal(back.owned.panel, 9);
  assert.equal(back.bought['warm-hands'], true);
  assert.equal(back.medals['first-light'], true);
  assert.equal(back.seeds, 4);
  assert.equal(back.prestiges, 4);
  assert.equal(back.rooted['warm-earth'], true, 'the seed upgrades are the point of the save');
  assert.equal(back.decade, 7);
  assert.equal(back.life.taps, 88);
  assert.equal(back.run.taps, 88);
  assert.equal(back.log.length, 1);
  assert.equal(back.history.rate.length, 1);
  assert.equal(back.session.taps, 0, 'the sitting must not survive a reload');
  assert.equal(toSave(state).version, SAVE_VERSION);
});

test('a save full of rubbish loads as a playable game', () => {
  /* Saves are hand-edited, truncated by a full disk and written by older builds
     of this file. Any of those arriving as a string or a NaN turns the whole
     economy into NaN one tick later and never recovers. */
  for(const junk of [null, undefined, 42, 'nonsense', [], {}, { light: 'lots' },
    { owned: { moss: 'many', ghost: 4 } }, { life: { taps: NaN } },
    { bought: { 'no-such-upgrade': true } }, { medals: { 'no-such-medal': true } },
    { history: { at: [1, 2], rate: [1], taps: null } }, { log: [null, { text: 5 }, { at: 'x', text: 'ok' }] }]){
    const state = fromSave(junk);
    assert.ok(Number.isFinite(state.light), `light came back as ${state.light}`);
    for(const id of GROWER_IDS){
      assert.ok(Number.isInteger(state.owned[id]) && state.owned[id] >= 0,
        `"${id}" came back as ${state.owned[id]}`);
    }
    for(const key of STAT_KEYS) assert.ok(Number.isFinite(state.life[key]), `life.${key} is not a number`);
    assert.ok(Number.isFinite(totalRate(state)), 'the rate must still be a number');
    tick(state, 1);
    assert.ok(Number.isFinite(state.light), 'and it must still be one after a tick');
    for(const id of Object.keys(state.bought)) assert.ok(UPGRADE_BY_ID[id], `kept unknown upgrade "${id}"`);
    for(const id of Object.keys(state.medals)) assert.ok(ACHIEVEMENT_BY_ID[id], `kept unknown medal "${id}"`);
    const h = state.history;
    assert.equal(h.at.length, h.rate.length, 'the graph series must be the same length');
    assert.equal(h.at.length, h.taps.length);
  }
});

test('a save from the twelve-grower build keeps what it earned', () => {
  /* The tables were cut — three growers, twenty-four upgrades — and every save
     that predates the cut names things that are gone. What is gone must load
     as nothing, and what is not gone must not be lost on the way. Two medals
     keep old ids on purpose: 'first-light', from when the resource was called
     light, and 'thirty-upgrades', from when there were forty-two upgrades to
     buy thirty of. A medal is a record, and a record you lose to a rename is
     not a record. */
  const old = {
    version: 2, light: 5e6, elapsed: 900,
    owned: { moss: 30, fern: 20, mirror: 4, reef: 2, mycelium: 7 },
    bought: { 'warm-hands': true, 'sun-gloves': true, 'atoll': true, 'damp-corners': true },
    medals: { 'first-light': true, 'thirty-upgrades': true, 'fifty-mirror': true, 'ten-growers': true },
    seeds: 3, prestiges: 1,
    life: { taps: 5000, earned: 4e9, studied: 31 },
  };
  const state = fromSave(old);
  /* Seeds and replants were two numbers in that build and are one now. The
     replant count is the honest translation — one season, one seed — and it is
     what the tree's age was already drawn from, so the lot comes back exactly
     as old as it went away rather than suddenly three years older. */
  assert.equal(state.owned.moss, 30);
  assert.equal(state.owned.mirror, undefined, 'a grower that no longer exists must not come back');
  assert.deepEqual(Object.keys(state.bought).sort(), ['damp-corners', 'warm-hands'],
    'upgrades that no longer exist are dropped, the rest kept');
  assert.ok(state.medals['thirty-upgrades'], 'Studious was earned and must survive the cut');
  assert.ok(state.medals['first-light'], 'First tap was earned and must survive the rename');
  assert.ok(state.medals['ten-growers']);
  assert.equal(state.medals['fifty-mirror'], undefined, 'a medal for a grower that is gone is gone');
  assert.equal(state.seeds, 1, 'one replant in that save is one seed in this one');
  assert.equal(state.prestiges, 1);
  assert.ok(Number.isFinite(totalRate(state)));
  assert.ok(ACHIEVEMENT_BY_ID['thirty-upgrades'], 'the Studious id must stay what old saves call it');
});

test('an upgrade deleted from the table does not break a save that names it', () => {
  const state = newGame();
  state.bought['gone-tomorrow'] = true;    // as if this file had dropped a row
  assert.ok(Number.isFinite(bonuses(state).allMult), 'an unknown upgrade must be ignored, not thrown on');
});

/* -------------------------------------------------------------- reading */

test('numbers are readable at every size a run reaches', () => {
  assert.equal(formatLight(0), '0');
  assert.equal(formatLight(0.4), '0.4');
  assert.equal(formatLight(412.6), '412');
  assert.equal(formatLight(1000), '1.00K');
  assert.equal(formatLight(999999.7), '1.00M', 'rounding at the edge must carry, not read as 1000.0K');
  /* The band below every suffix. With three digits and no decimals, toFixed
     rounds 999.5 up to "1000", so a single carry threshold on the unrounded
     mantissa printed "1000K" — the exact unit the carry exists to prevent. */
  assert.equal(formatLight(999500), '1.00M');
  assert.equal(formatLight(999999), '1.00M');
  assert.equal(formatLight(999.6e9), '1.00T');
  assert.match(formatLight(9.999e35), /^1\.00e36$/, 'and past the suffixes it must reach the exponent');
  assert.equal(formatLight(1.234e6), '1.23M');
  assert.equal(formatLight(-2500), '-2.50K');
  assert.match(formatLight(1e40), /e40$/, 'past the named suffixes it should say the exponent');
  assert.equal(formatLight(NaN), '—');
  assert.equal(formatLight(Infinity), '—');

  assert.equal(formatTime(12), '12s');
  assert.equal(formatTime(75), '1m 15s');
  assert.equal(formatTime(3600), '1h 00m');
  assert.equal(formatTime(90000), '1d 01h');
  assert.equal(formatTime(-1), '—');

  assert.equal(formatStat('seconds', 3600), '1h 00m');
  assert.equal(formatStat('earned', 1500), '1.50K');
  assert.equal(formatStat('taps', 12345), '12,345');
});

test('the breakdown accounts for the whole rate, biggest first', () => {
  const state = newGame();
  state.owned.moss = 20;
  state.owned.panel = 5;
  const rows = breakdown(state);
  assert.equal(rows.length, 2, 'only what is planted belongs on the table');
  assert.ok(rows[0].rate >= rows[1].rate, 'the table is sorted by what is paying most');
  const share = rows.reduce((sum, row) => sum + row.share, 0);
  assert.ok(Math.abs(share - 1) < 1e-9, `the shares add to ${share}, not 1`);
  const rate = rows.reduce((sum, row) => sum + row.rate, 0);
  assert.ok(Math.abs(rate - totalRate(state)) < 1e-9, 'and the rates add to the whole rate');
  assert.deepEqual(breakdown(newGame()), [], 'an empty lot has an empty table');
});

test('asking a question does not change the answer', () => {
  /* Everything that is not one of the verbs has to be safe to call from a
     render loop. One of these mutated the state through a shared object once,
     and the symptom was a rate that crept up while the stats screen was open. */
  const state = newGame();
  state.owned.moss = 12;
  state.light = 500;
  state.run.taps = 40;
  const before = JSON.stringify(state);
  totalRate(state); steadyRate(state); tapValue(state); bonuses(state);
  snapshot(state); offered(state); breakdown(state);
  plantRefusal(state, 'moss', 5); studyRefusal(state, 'warm-hands');
  pendingSeeds(state); prestigeRefusal(state); offlineGain(state, 3600);
  assert.equal(JSON.stringify(state), before, 'a question changed the state');
});

/* ----------------------------------------------------------------- art */

test('every sprite is a rectangle of palette keys', () => {
  for(const [id, rows] of Object.entries(PROP_ART)){
    assert.ok(rows.length, `sprite "${id}" is empty`);
    const width = rows[0].length;
    for(const row of rows){
      assert.equal(row.length, width, `sprite "${id}" has a ragged row`);
      for(const key of row){
        assert.ok(key === '.' || PALETTE[key], `sprite "${id}" uses "${key}", which is not a palette key`);
      }
    }
  }
});

test('nothing on the lot is drawn off the edge of it', () => {
  for(const [id, spots] of Object.entries(PROP_SPOTS)){
    const rows = PROP_ART[id];
    assert.ok(rows, `"${id}" has somewhere to stand but nothing to draw`);
    for(const spot of spots){
      assert.ok(spot.x >= 0 && spot.x + rows[0].length <= SCENE_W,
        `"${id}" at x=${spot.x} runs off the side`);
      assert.ok(spot.y - rows.length >= 0 && spot.y <= SCENE_H,
        `"${id}" at y=${spot.y} runs off the top or the bottom`);
    }
  }
});

test('no two things on the lot are drawn on top of each other', () => {
  /* `spot.y` is the sprite's GROUND line, not its top: `lotPieces` draws the
   * rows at `spot.y - rows.length`. Getting that backwards is silent — every
   * sprite still stands on the grass, just a sprite-height too high — and it
   * is exactly the mistake that put three new kinds a foot in the air the
   * first time they were placed. So the boxes here are built the way the
   * renderer builds them, and then compared pixel by pixel rather than by
   * bounding box: these sprites are half transparent, and two boxes that graze
   * each other are usually two things that do not touch at all.
   *
   * Forty-eight sprites are hand-placed on a 320x240 lot with a tree in the
   * middle of it. Exactly one pixel is painted twice — a turbine mast crossing
   * a glasshouse eave, which nobody will ever see — and that is the number
   * pinned here. A sprite actually dropped on top of another shares tens of
   * pixels, not one, so this fires long before the picture looks wrong.
   */
  const owner = new Map();
  const both = new Map();
  for(const [id, spots] of Object.entries(PROP_SPOTS)){
    const rows = PROP_ART[id];
    for(const spot of spots){
      const top = spot.y - rows.length;
      assert.ok(spot.y > GROUND_Y, `"${id}" has its feet at ${spot.y}, above the horizon at ${GROUND_Y}`);
      for(let r = 0; r < rows.length; r++){
        for(let c = 0; c < rows[r].length; c++){
          if(rows[r][c] === '.') continue;
          const key = `${spot.x + c},${top + r}`;
          const held = owner.get(key);
          if(held === undefined){ owner.set(key, id); continue; }
          const pair = held < id ? `${held} and ${id}` : `${id} and ${held}`;
          both.set(pair, (both.get(pair) || 0) + 1);
        }
      }
    }
  }
  for(const [pair, n] of both){
    assert.ok(n <= 1, `${pair} paint ${n} of the same pixels — one of them has been placed on the other`);
  }
  const total = [...both.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, 1,
    `${total} pixels on the lot are painted twice; the layout has room for exactly one and it is spoken for`);
});

test('the lot fills up as it is planted, and stops', () => {
  assert.equal(propCount(0), 0, 'nothing owned is nothing drawn');
  assert.equal(propCount(1), 1);
  for(let i = 1; i < PROP_STEPS.length; i++){
    assert.ok(PROP_STEPS[i] > PROP_STEPS[i - 1], 'the steps must climb');
    assert.equal(propCount(PROP_STEPS[i]), i + 1);
  }
  assert.equal(propCount(1e9), PROP_STEPS.length, 'and it must stop before it is a wall of sprites');
});

test('the tree grows with the lot and can always be hit', () => {
  assert.equal(growthFor(0), 0);
  assert.ok(growthFor(10) > growthFor(0));
  assert.ok(growthFor(400) > growthFor(100), 'it must still be growing well past a hundred');
  assert.ok(growthFor(1e9) <= 1, 'and never past full');

  for(const growers of [0, 1, 50, 400, 5000]){
    const box = treeBounds(growthFor(growers));
    assert.ok(box.w > 24 && box.h > 24, `at ${growers} growers the tap target is ${box.w}x${box.h}`);
    assert.ok(box.x < TREE_X && box.x + box.w > TREE_X, 'the trunk must be inside its own hit box');
    assert.ok(box.y < TREE_Y, 'and the box must reach above the ground line');
  }
});

test('night is a palette remap and never leaves the palette', () => {
  for(const key of Object.keys(PALETTE)){
    for(const light of [1, 0.5, 0, -0.5, -1]){
      assert.ok(PALETTE[shade(key, light)], `"${key}" at light ${light} shaded to a colour that is not in the palette`);
    }
  }
  assert.notEqual(shade('g', -1), 'g', 'a green leaf must not be the same green at midnight');
  assert.equal(shade('g', 1), 'g', 'and it must be untouched at noon');
});

test('the sky has a stop for every part of the day and neighbours that are close', () => {
  assert.ok(SKIES.length >= 6, 'too few stops and the dither between them reads as speckle');
  for(let i = 1; i < SKIES.length; i++){
    assert.ok(SKIES[i].at > SKIES[i - 1].at, 'the stops must be in order');
  }
  for(const at of [0, 0.13, 0.25, 0.5, 0.62, 0.75, 0.99]){
    const { a, b, t } = skyBlend(at);
    assert.ok(a && b, `no sky at ${at}`);
    assert.ok(t >= 0 && t <= 1, `blend at ${at} is ${t}`);
    for(const stop of ['top', 'mid', 'low']){
      assert.ok(PALETTE[a[stop]] && PALETTE[b[stop]], `sky at ${at} names a colour outside the palette`);
    }
  }
  assert.ok(GROUND_Y > 0 && GROUND_Y < SCENE_H, 'the horizon must be somewhere on the canvas');
});

/* ------------------------------------------------------ the seed upgrades */

test('the seed tree is a ladder: one rung a seed, each dearer than the last', () => {
  const ids = PRESTIGE.map(u => u.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate seed upgrade id');
  for(let i = 0; i < PRESTIGE.length; i++){
    const up = PRESTIGE[i];
    assert.match(up.id, /^[a-z][a-z0-9-]*$/, `seed upgrade "${up.id}": id must be kebab-case`);
    assert.ok(up.name && up.blurb, `seed upgrade "${up.id}" needs a name and a blurb`);
    assert.equal(up.seed, i + 1, `"${up.id}" should be the rung for seed ${i + 1}`);
    assert.ok(up.cost > 0, `"${up.id}" must cost energy`);
    if(i > 0) assert.ok(up.cost > PRESTIGE[i - 1].cost, `"${up.id}" must cost more than the rung below it`);
    /* One thing a rung — counted as ideas, not as keys. A per-kind multiplier
       needs two (which kind, and by how much), and Half price is one idea the
       owner asked to be one row: the shop is kinder to you, in price and in
       what it demands. */
    const PAIRED = new Set(['mult', 'needHalf']);
    const does = Object.keys(up.effect).filter(k => !PAIRED.has(k));
    assert.equal(does.length, 1, `"${up.id}": one effect a rung, not ${does.length}`);
    if(up.effect.grower){
      assert.ok(GROWER_BY_ID[up.effect.grower], `"${up.id}" names a grower that is not there`);
      assert.ok(up.effect.mult > 1, `"${up.id}" must actually multiply something`);
    }
  }

  // And no two rungs do the same thing, which is the whole point of writing
  // forty of them out by hand rather than generating them.
  const seen = new Map();
  for(const up of PRESTIGE){
    const shape = JSON.stringify(up.effect, Object.keys(up.effect).sort());
    assert.ok(!seen.has(shape),
      `"${up.id}" does exactly what "${seen.get(shape)}" already does: ${shape}`);
    seen.set(shape, up.id);
  }
  // Pitched against the seed it opens: affordable inside the run that earns
  // it, and never so cheap it buys itself.
  for(const up of PRESTIGE){
    const threshold = seedAt(up.seed);
    assert.ok(up.cost < threshold, `"${up.id}" costs more than the lifetime total its own seed wanted`);
    assert.ok(up.cost > threshold / 20, `"${up.id}" is small change against the seed that opens it`);
  }
});

test('a seed opens a rung, and energy pays for it', () => {
  const state = newGame();
  assert.deepEqual(prestigeOffered(state), [], 'no seeds, nothing open');
  assert.match(rootRefusal(state, 'warm-earth'), /more seed/, 'a shut rung says what it wants');
  assert.match(rootRefusal(state, 'no-such-thing'), /no such/);

  state.seeds = 1;
  assert.deepEqual(prestigeOffered(state).map(u => u.id), ['warm-earth']);
  assert.match(rootRefusal(state, 'warm-earth'), /Not enough energy/, 'the seed opens it, it does not buy it');
  assert.match(rootRefusal(state, 'deep-mulch'), /1 more seed/, 'and the next rung is still shut');

  state.light = PRESTIGE_BY_ID['warm-earth'].cost + 25;
  assert.equal(rootRefusal(state, 'warm-earth'), null);
  assert.equal(root(state, 'warm-earth').id, 'warm-earth');
  assert.equal(state.light, 25, 'the energy is spent');
  assert.equal(state.rooted['warm-earth'], true);
  assert.match(rootRefusal(state, 'warm-earth'), /already/);
  assert.equal(root(state, 'warm-earth'), null, 'and buying it twice changes nothing');
  assert.equal(state.light, 25);

  // A seed is never spent: it opened the rung and it is still there.
  assert.equal(state.seeds, 1);
});

test('every rung of the seed tree reaches the game through the same bonuses', () => {
  /* A lot with something of everything on it, a medal won, seeds earned and a
     season part-run — because five of the rungs are worth nothing against a
     save that has none of those, and a probe that starts from nothing would
     call them dead when they are only unstarted. */
  const probe = () => {
    const state = newGame();
    for(const g of GROWERS) state.owned[g.id] = 20;
    state.medals['first-seed'] = true;
    state.seeds = 12;
    state.run.taps = 500;
    state.run.seconds = 600;
    return state;
  };
  for(const up of PRESTIGE){
    const before = bonuses(probe());
    const after = (() => {
      const state = probe();
      state.rooted[up.id] = true;
      return bonuses(state);
    })();
    const moved = Object.keys(after).some(key => {
      const a = before[key], b = after[key];
      if(typeof a === 'number' || typeof a === 'boolean') return a !== b;
      // The per-kind multipliers are an object of nine numbers.
      if(a && typeof a === 'object') return GROWER_IDS.some(id => a[id] !== b[id]);
      return false;
    });
    assert.ok(moved, `"${up.id}" changes nothing any part of the game reads`);
  }
});

test('the seed tree survives every replant, and only the run goes', () => {
  const state = newGame();
  state.rooted['deep-mulch'] = true;
  state.bought['warm-hands'] = true;
  state.owned.moss = 30;
  const lifted = bonuses(state).allMult;
  assert.ok(lifted > 1, 'Deep mulch has to be doing something before the replant');

  state.life.earned = seedAt(1);
  prestige(state);
  assert.deepEqual(state.bought, {}, "the run's upgrades go");
  assert.equal(state.rooted['deep-mulch'], true);
  assert.equal(bonuses(state).allMult, lifted, 'and it is still doing it after');
});

test('time away is worth more once the tree says so', () => {
  const state = newGame();
  state.owned.moss = 100;
  const plain = offlineGain(state, 3600);

  state.rooted['still-air'] = true;              // full rate rather than half
  const full = offlineGain(state, 3600);
  assert.ok(Math.abs(full.light - plain.light * 2) < 1e-6, 'full rate is twice half of it');

  const day = offlineGain(state, 48 * 3600);
  assert.equal(day.seconds, OFFLINE_CAP, 'and the cap still holds');
  state.rooted['long-sleep'] = true;            // twice as long counted
  const longer = offlineGain(state, 48 * 3600);
  assert.equal(longer.seconds, OFFLINE_CAP * 2);
  assert.ok(longer.capped, 'two days away is still more than it counts');
});

test('a seed pays nothing on its own any more', () => {
  // It used to be two percent a seed simply for holding it. The power is in
  // the tree now, and a save that holds twenty seeds and has bought nothing
  // must be running at exactly the bare rate.
  const state = newGame();
  state.owned.moss = 50;
  const bare = totalRate(state);
  state.seeds = 20;
  assert.equal(totalRate(state), bare);
  assert.equal(seedBonus(20), 1);
});

/* ----------------------------------------------- the tree keeps its size */

test('the tree is drawn from the biggest it has ever been, not from what is standing', () => {
  const state = newGame();
  assert.equal(state.grown, 0);
  state.owned.moss = 40;
  state.owned.fern = 10;
  assert.equal(growerCount(state), 50);
  assert.equal(markGrown(state), 50);

  // Selling is not a thing here, but a season is, and it clears the lot.
  state.life.earned = seedAt(1);
  prestige(state);
  assert.equal(growerCount(state), 0, 'the growers go, because the energy was really spent');
  assert.equal(state.grown, 50, 'the tree does not go back to a sapling');
  assert.ok(growthFor(state.grown) > 0, 'and it is still drawn at something');

  // A smaller lot than last season does not shrink it either.
  state.owned.moss = 5;
  assert.equal(markGrown(state), 50);
  // Passing the old mark does move it.
  state.owned.moss = 90;
  assert.equal(markGrown(state), 90);
});

test('the high-water mark survives a save, and an old save gets one from its lot', () => {
  const state = newGame();
  state.owned.moss = 33;
  markGrown(state);
  state.life.earned = seedAt(1);
  prestige(state);
  const back = fromSave(toSave(state));
  assert.equal(back.grown, 33, 'a season with a bare lot still remembers the tree');

  // Saves written before there was a mark: the lot standing on them is the
  // best evidence the file has, and it must not load as a sapling.
  const old = toSave(newGame());
  old.owned.moss = 12;
  delete old.grown;
  assert.equal(fromSave(old).grown, 12);

  // And nothing in a hostile save turns it into NaN.
  const junk = toSave(newGame());
  junk.grown = 'lots';
  assert.equal(fromSave(junk).grown, 0);
  junk.grown = -5;
  assert.equal(fromSave(junk).grown, 0);
});

/* --------------------------------------------------- the words on the page */

test('the ladder reaches forty, in order, with the ids it has always had', () => {
  const rungs = ACHIEVEMENTS.filter(a => a.need.seeds !== undefined);
  const needs = rungs.map(a => a.need.seeds);
  assert.deepEqual(needs, [...needs].sort((a, b) => a - b), 'the seed medals must read as a ladder');
  assert.deepEqual(needs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 100]);
  assert.equal(new Set(needs).size, needs.length, 'two medals for one seed count');
  for(const id of ['first-seed', 'five-seeds', 'twelve-seeds', 'hundred-seeds',
    'thirty-winters', 'fifty-winters', 'hundred-winters']){
    assert.ok(ACHIEVEMENT_BY_ID[id], `medal id "${id}" is in saves and cannot be renamed`);
  }
});

test('no player ever reads the words "replant" or "rooted"', () => {
  // Both were scrapped as terminology. They survive as identifiers — state.rooted,
  // root(), SEEDS_PER_REPLANT — and that is fine, because nobody reads those.
  // What must not happen is one of them turning up in a blurb again.
  const scrapped = /\b(replant\w*|rooted)\b/i;
  const shown = [];
  for(const table of [GROWERS, UPGRADES, ACHIEVEMENTS, prestigeUpTo(RING_FROM + 5)]){
    for(const row of table){
      for(const field of ['name', 'blurb', 'flavour', 'what']){
        if(typeof row[field] === 'string') shown.push([`${row.id}.${field}`, row[field]]);
      }
    }
  }
  for(const [where, text] of shown){
    assert.ok(!scrapped.test(text), `"${where}" still says it: ${text}`);
  }

  // The refusals are read out loud too.
  const state = newGame();
  const refusals = [
    prestigeRefusal(state),
    rootRefusal(state, 'warm-earth'),
    rootRefusal(state, 'no-such-thing'),
    plantRefusal(state, 'moss', 1),
  ].filter(Boolean);
  assert.ok(refusals.length, 'a fresh game refuses at least one of those');
  for(const line of refusals) assert.ok(!scrapped.test(line), `a refusal says it: ${line}`);
});

test('planting is what marks the tree, so no call site can forget to', () => {
  const state = newGame();
  state.light = 1e9;
  plant(state, 'moss', 25);
  assert.equal(state.grown, 25, 'plant() records it without being asked');
  // A refused purchase changes nothing, the mark included.
  const broke = newGame();
  broke.light = 0;
  assert.ok(plantRefusal(broke, 'moss', 1), 'a penniless lot cannot plant');
  plant(broke, 'moss', 1);
  assert.equal(broke.grown, 0);
});

test('every seed opens a row, for ever, which is what the season toast promises', () => {
  // The toast says "Another row of upgrades is open" every season without
  // asking. That is only honest if there is exactly one row a seed from the
  // first upward with no gaps, and if the ladder never runs out.
  const written = PRESTIGE.map(u => u.seed);
  assert.deepEqual(written, written.map((_, i) => i + 1), 'one written row a seed, from the first');
  assert.equal(RING_FROM, PRESTIGE.length + 1, 'the rings pick up exactly where the writing stops');

  const seen = new Set();
  let last = 0;
  for(let n = 1; n <= 200; n++){
    const up = prestigeAt(n);
    assert.ok(up, `nothing opens at seed ${n}`);
    assert.equal(up.seed, n, `the row at seed ${n} says it is seed ${up.seed}`);
    assert.ok(!seen.has(up.id), `two rows share the id "${up.id}"`);
    seen.add(up.id);
    assert.equal(typeof up.name, 'string');
    assert.ok(up.name.length, `the row at seed ${n} has no name`);
    assert.ok(up.blurb.length, `the row at seed ${n} has no blurb`);
    assert.ok(Number.isFinite(up.cost) && up.cost > last, `seed ${n} must cost more than the rung below`);
    assert.ok(Object.keys(up.effect).length, `the row at seed ${n} does nothing`);
    last = up.cost;
  }
  // A seed that is not one is not a row.
  for(const bad of [0, -1, 1.5, NaN, Infinity, '3', null, undefined]) assert.equal(prestigeAt(bad), null);
});

test('a ring is made once, priced off its own seed, and found again by id', () => {
  assert.equal(ringFor(RING_FROM), ringFor(RING_FROM), 'the same ring twice is the same object');
  assert.equal(ringFor(RING_FROM - 1), null, 'a written rung is not a ring');
  assert.equal(ringFor(2.5), null);

  const ring = ringFor(RING_FROM + 7);
  assert.equal(prestigeById(ring.id), ring, 'a ring must be findable by the id a save holds');
  assert.equal(prestigeById('warm-earth'), PRESTIGE_BY_ID['warm-earth'], 'and so must a written row');
  for(const junk of ['ring-', 'ring-x', 'ring-1', 'nonsense', '', null]){
    assert.ok(!prestigeById(junk), `"${junk}" is not a row`);
  }

  // Priced like every written row: about three tenths of what its seed wanted.
  for(const n of [1, 5, 12, 25, RING_FROM, 60]){
    const share = prestigeCost(n) / seedAt(n);
    assert.ok(share > 0.25 && share < 0.35, `seed ${n} is priced at ${share.toFixed(3)} of its threshold`);
  }
});

test('a ring in a save is a ring in the bonuses, and an impossible one is not', () => {
  const state = newGame();
  const ring = ringFor(RING_FROM + 3);
  state.seeds = ring.seed;
  state.light = ring.cost;
  assert.equal(rootRefusal(state, ring.id), null, 'it must be buyable when the seeds are there');
  root(state, ring.id);
  assert.equal(state.light, 0, 'and it must cost what it says');
  assert.ok(Math.abs(bonuses(state).allMult - ringMult(ring.seed)) < 1e-12);
  assert.ok(ringMult(ring.seed) > RING_MULT, 'a ring above the first is worth more than the first');

  // It survives the save, and a ring below where the rings start does not.
  const back = fromSave(toSave(state));
  assert.equal(back.rooted[ring.id], true);
  const forged = toSave(state);
  forged.rooted['ring-2'] = true;
  forged.rooted['ring-nonsense'] = true;
  const clean = fromSave(forged);
  assert.equal(clean.rooted['ring-2'], undefined, 'seed 2 is a written row, not a ring');
  assert.equal(clean.rooted['ring-nonsense'], undefined);
});

test('the page lists at least the written rows, and one more than you have', () => {
  assert.equal(prestigeUpTo(0).length, PRESTIGE.length, 'a lot with no seeds still sees the whole written ladder');
  assert.equal(prestigeUpTo(PRESTIGE.length + 5).length, PRESTIGE.length + 5);
  const state = newGame();
  state.seeds = RING_FROM + 2;
  const offered = prestigeOffered(state);
  assert.equal(offered.length, state.seeds, 'every seed you have earned has opened its row');
  assert.ok(offered.every(u => u.seed <= state.seeds));
});

test('the first ten seed medals are named for the seed, which is what lets one toast speak for both', () => {
  // The page suppresses the medal's own toast only when the medal's name is
  // word-for-word the title the season toast already used. If a medal here is
  // renamed, the page stops deduplicating rather than silently swallowing it —
  // but the pairing is worth stating, because it is why the rule works at all.
  const words = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth',
    'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
  for(let n = 1; n <= 10; n++){
    const medal = seedMedal(n);
    assert.ok(medal, `no medal at seed ${n}`);
    assert.equal(medal.name, `${words[n]} seed`);
  }
  // And the ones above it are named differently, so they keep their own toast.
  for(const n of [12, 15, 20, 25, 30, 40]){
    const medal = seedMedal(n);
    assert.ok(medal, `no medal at seed ${n}`);
    assert.ok(!/^(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth) seed$/.test(medal.name));
  }
});

test('the welcome-back line reads the save, not the module constants', () => {
  // "at half rate, counting the first 12h" is true of a bare save and false of
  // one that has bought its way out of both, and a game that calls its own
  // upgrade a lie is worse than one that says nothing.
  const plain = newGame();
  assert.equal(bonuses(plain).offlineRate, OFFLINE_RATE);
  assert.equal(bonuses(plain).offlineCap, OFFLINE_CAP);

  const bought = newGame();
  bought.rooted['still-air'] = true;
  bought.rooted['long-sleep'] = true;
  assert.equal(bonuses(bought).offlineRate, 1, 'full rate, so the line must not say half');
  assert.equal(bonuses(bought).offlineCap, OFFLINE_CAP * 2, 'and a longer cap to name');
});

/* ------------------------------------------- the nineteen new seed levers */

/* Each of these is a rung that does something nothing else in the game does,
 * which is the whole reason the ladder is written out by hand. Each one is
 * checked against the function that actually reads it, not against the fold:
 * a key that lands in `bonuses` and is read by nothing is an upgrade that
 * charges a season's energy for a number in an object.
 */

const withRow = (id, tweak = () => {}) => {
  const state = newGame();
  state.rooted[id] = true;
  tweak(state);
  return state;
};

test('Often enough moves the windfall from every tenth tap to every fifth', () => {
  const plain = newGame();
  plain.bought['windfall'] = true;
  const sooner = withRow('often-enough', s => { s.bought['windfall'] = true; });

  const hits = state => {
    const out = [];
    for(let n = 0; n < 20; n++){
      state.run.taps = n;
      if(isWindfall(state)) out.push(n + 1);
    }
    return out;
  };
  assert.deepEqual(hits(plain), [10, 20]);
  assert.deepEqual(hits(sooner), [5, 10, 15, 20]);

  // And with no Windfall bought there is no windfall to move.
  assert.deepEqual(hits(withRow('often-enough')), []);
});

test('Quick hands raises the ceiling on a fast hand, and Never a pause raises the floor', () => {
  const momentumOf = (state, rate) => momentum(rate, bonuses(state));
  const plain = newGame();
  plain.bought['momentum'] = true;                       // streak 0.25
  assert.equal(momentumOf(plain, 8), momentumOf(plain, 30), 'eight a second is the old ceiling');

  const quick = withRow('quick-hands', s => { s.bought['momentum'] = true; });
  assert.ok(momentumOf(quick, 16) > momentumOf(plain, 16), 'sixteen a second must now pay more');
  assert.equal(momentumOf(quick, 16), momentumOf(quick, 30), 'and sixteen is the new ceiling');

  const never = withRow('never-a-pause', s => { s.bought['momentum'] = true; });
  assert.ok(momentumOf(never, 0) > momentumOf(plain, 0), 'a stopped hand still counts for something');
  assert.equal(momentumOf(never, 0), momentumOf(never, 2), 'and it counts as two a second');
});

test('Cheap ground flattens the price curve, and the shop and the till agree about it', () => {
  const moss = GROWER_BY_ID['moss'];
  const plain = newGame();
  const cheap = withRow('cheap-ground');
  const growth = bonuses(cheap).costGrowth;
  assert.ok(growth < COST_GROWTH && growth > 1, 'the curve flattens but still climbs');

  assert.equal(growerCost(moss, 0), growerCost(moss, 0, growth), 'the first one is the same either way');
  assert.ok(growerCost(moss, 40, growth) < growerCost(moss, 40) / 1.9, 'by the fortieth it is about half');

  // The number the button shows must be the number plant() takes.
  for(const owned of [0, 3, 25]){
    for(const count of [1, 10, 100]){
      // Not 1e30: a double that big cannot hold the subtraction of twelve.
      const state = withRow('cheap-ground', s => { s.owned.moss = owned; s.light = 1e12; });
      const quoted = bulkCost(moss, owned, count, bonuses(state).costGrowth);
      const before = state.light;
      plant(state, 'moss', count);
      assert.equal(before - state.light, quoted, `${count} at ${owned} owned: quoted and charged must match`);
    }
  }
});

test('Thrift hands part of the price back, and still records what it cost', () => {
  const state = withRow('thrift', s => { s.light = 1e9; });
  const quoted = bulkCost(GROWER_BY_ID['moss'], 0, 10, bonuses(state).costGrowth);
  const before = state.light;
  plant(state, 'moss', 10);
  assert.ok(Math.abs((before - state.light) - quoted * 0.95) < 1e-6, 'a twentieth comes back');
  assert.equal(state.run.spent, quoted, 'the record still says what the lot cost');
});

test('What overwinters and A standing start leave something on the lot, and the kinder one wins', () => {
  const ready = tweak => {
    const s = newGame();
    tweak(s);
    s.life.earned = seedAt(1);
    return s;
  };
  const bare = ready(s => { s.owned.moss = 100; });
  prestige(bare);
  assert.equal(bare.owned.moss, 0, 'with neither row, the lot really does go');

  const kept = ready(s => { s.rooted['what-overwinters'] = true; s.owned.moss = 100; s.owned.fern = 3; });
  prestige(kept);
  assert.equal(kept.owned.moss, 10, 'a tenth of a hundred');
  assert.equal(kept.owned.fern, 0, 'a tenth of three is none of them');

  const standing = ready(s => { s.rooted['standing-start'] = true; s.owned.moss = 100; });
  prestige(standing);
  for(const id of GROWER_IDS) assert.equal(standing.owned[id], 5, `${id} should be standing`);

  const both = ready(s => {
    s.rooted['what-overwinters'] = true; s.rooted['standing-start'] = true;
    s.owned.moss = 100; s.owned.fern = 3;
  });
  prestige(both);
  assert.equal(both.owned.moss, 10, 'a tenth of a hundred beats a flat five');
  assert.equal(both.owned.fern, 5, 'and a flat five beats a tenth of three');
});

test('Night shift stops the lot keeping hours', () => {
  const night = GROWERS.find(g => g.phase === 'night');
  const day = GROWERS.find(g => g.phase === 'day');
  assert.ok(night && day, 'the test needs one of each');

  const noon = DAY_LENGTH * 0.25;   // the sun at its highest
  const plain = newGame();
  plain.owned[night.id] = 10; plain.owned[day.id] = 10;
  plain.elapsed = noon;
  const shifted = withRow('night-shift', s => {
    s.owned[night.id] = 10; s.owned[day.id] = 10; s.elapsed = noon;
  });

  assert.ok(rateOf(shifted, night.id) > rateOf(plain, night.id), 'the night shift works at noon now');
  assert.equal(
    Math.round(rateOf(shifted, night.id) * 1e6),
    Math.round(rateOf(shifted, day.id) * (night.rate / day.rate) * 1e6),
    'and the two kinds keep the same hours as each other');
  // The day average stops being worth anything extra, because there is no
  // trough left to lift.
  assert.equal(averageFactor('any', 0.5, 0.5), 1);
});

test('Still hands pays for the tapping while the tab is shut, at the season\'s own pace', () => {
  const build = tweak => {
    const s = newGame();
    s.owned.moss = 200;
    s.bought['gleaning'] = true;        // fingers, so a tap is worth something
    s.run.taps = 3600; s.run.seconds = 1800;   // two a second, this season
    tweak(s);
    return s;
  };
  const plain = build(() => {});
  const hands = build(s => { s.rooted['still-hands'] = true; });
  assert.ok(hands.rooted['still-hands']);
  const a = offlineGain(plain, 3600).light;
  const b = offlineGain(hands, 3600).light;
  assert.ok(b > a, 'the hands have to be worth something');

  // A season with no time in it owes nothing, and neither does one with no taps.
  const fresh = build(s => { s.rooted['still-hands'] = true; s.run.taps = 0; s.run.seconds = 0; });
  assert.equal(offlineGain(fresh, 3600).light, offlineGain(build(s => { s.run.taps = 0; s.run.seconds = 0; }), 3600).light);
});

test('The reserve pays on what you are holding, and never more than the lot makes', () => {
  const lot = tweak => {
    const state = newGame();
    state.rooted['the-reserve'] = true;
    for(const g of GROWERS) state.owned[g.id] = 10;
    tweak(state);
    return state;
  };
  const plain = newGame();
  for(const g of GROWERS) plain.owned[g.id] = 10;
  plain.light = 1e6;
  const bare = tick(plain, 1);

  const held = lot(s => { s.light = 1e6; });
  const withIt = tick(held, 1);
  assert.ok(withIt > bare, 'holding energy has to earn something');
  // Relative, because both sides are a few million and a double cannot
  // promise the difference of two of those to the microjoule.
  assert.ok(Math.abs((withIt - bare) / (1e6 * 0.005) - 1) < 1e-9, 'half a percent of what is held');

  // Never more than the lot's own second, however much is in hand.
  const hoard = lot(s => { s.light = 1e30; });
  const rate = totalRate(hoard);
  const capped = tick(hoard, 1);
  assert.ok(Math.abs(capped - rate * 2) < rate * 1e-6, 'the most it can double is the lot itself');

  // Nothing held, nothing owed. The rate is read before the tick, because a
  // tick moves the clock and the sky moves the rate with it.
  const empty = lot(s => { s.light = 0; });
  const expected = totalRate(empty);
  assert.equal(tick(empty, 1), expected);
  const counted = lot(s => { s.light = 1e6; });
  const before = counted.run.grown;
  const made = tick(counted, 1);
  assert.ok(Math.abs((counted.run.grown - before) - made) < 1e-6, 'it goes in the grown column');
});

test('Half price charges half, on the button and at the till', () => {
  // A lot with plenty of everything on it, so the upgrade's own conditions are
  // met and the only thing being tested is the price.
  const stocked = tweak => {
    const s = newGame();
    for(const g of GROWERS) s.owned[g.id] = 50;
    s.life.taps = 10000; s.run.taps = 10000; s.life.seconds = 1e6; s.run.seconds = 1e6;
    s.life.earned = 1e12; s.run.earned = 1e12;
    tweak(s);
    return s;
  };
  const up = offered(stocked(s => { s.light = 1e12; }))[0];
  assert.ok(up, 'the lot has to be offered something');

  assert.equal(upgradeCost(up, bonuses(stocked(s => { s.rooted['half-price'] = true; }))), Math.ceil(up.cost / 2));
  assert.equal(upgradeCost(up, bonuses(stocked(() => {}))), up.cost, 'and full price without it');

  const half = stocked(s => { s.rooted['half-price'] = true; s.light = Math.ceil(up.cost / 2); });
  assert.equal(studyRefusal(half, up.id), null, 'half the money must be enough');
  const spentBefore = half.run.spent;
  study(half, up.id);
  assert.equal(half.light, 0);
  assert.equal(half.run.spent - spentBefore, Math.ceil(up.cost / 2), 'the record says what was really paid');

  // And without the row, half the money is not enough.
  const full = stocked(s => { s.light = Math.ceil(up.cost / 2); });
  assert.ok(studyRefusal(full, up.id), 'half price must really be the row doing it');
});

test('The four counting rungs pay for what the save is already keeping', () => {
  const lot = tweak => {
    const s = newGame();
    for(const g of GROWERS) s.owned[g.id] = 10;
    tweak(s);
    return s;
  };
  const base = totalRate(lot(() => {}));

  const medals = lot(s => { s.rooted['long-count'] = true; });
  assert.equal(totalRate(medals), base, 'no medals, nothing owed');
  for(const a of ACHIEVEMENTS.slice(0, 10)) medals.medals[a.id] = true;
  assert.ok(Math.abs(totalRate(medals) / base - 1.1) < 1e-9, 'ten medals is ten percent');

  const kinds = lot(s => { s.rooted['many-hands'] = true; });
  assert.ok(Math.abs(totalRate(kinds) / base - (1 + 0.05 * GROWER_IDS.length)) < 1e-9);
  const oneKind = newGame();
  oneKind.rooted['many-hands'] = true; oneKind.owned.moss = 10;
  const plainOne = newGame(); plainOne.owned.moss = 10;
  assert.ok(Math.abs(totalRate(oneKind) / totalRate(plainOne) - 1.05) < 1e-9, 'one kind, five percent');

  const seeds = lot(s => { s.rooted['seed-for-seed'] = true; s.seeds = 20; });
  assert.ok(Math.abs(totalRate(seeds) / base - 2) < 1e-9, 'twenty seeds is twice over');

  const worked = lot(s => { s.rooted['practice'] = true; s.run.taps = 550; });
  assert.ok(Math.abs(totalRate(worked) / base - 1.05) < 1e-9, 'five hundreds of taps is five percent');
  const ground = lot(s => { s.rooted['practice'] = true; s.run.taps = 1e9; });
  assert.ok(Math.abs(totalRate(ground) / base - 3) < 1e-9, 'and it stops at three times over');

  const patient = lot(s => { s.rooted['slow-season'] = true; s.run.seconds = 6000; });
  assert.ok(Math.abs(totalRate(patient) / base - 1.1) < 1e-9, 'a hundred minutes is ten percent');
  const forgotten = lot(s => { s.rooted['slow-season'] = true; s.run.seconds = 1e9; });
  assert.ok(Math.abs(totalRate(forgotten) / base - 2) < 1e-9, 'and it stops at twice over');
});

test('Deep sleep beats Still air, and the nine kind rungs each lift their own kind only', () => {
  const sleeper = withRow('deep-sleep', s => { s.owned.moss = 100; });
  assert.equal(bonuses(sleeper).offlineRate, 1.5);
  sleeper.rooted['still-air'] = true;
  assert.equal(bonuses(sleeper).offlineRate, 1.5, 'the kinder of the two wins, in either order');

  for(const up of PRESTIGE.filter(u => u.effect.grower)){
    const state = newGame();
    state.rooted[up.id] = true;
    const bonus = bonuses(state);
    for(const id of GROWER_IDS){
      assert.equal(bonus.grower[id], id === up.effect.grower ? up.effect.mult : 1,
        `"${up.id}" should move ${up.effect.grower} and nothing else`);
    }
  }
});

test('a lot with nothing rooted plays exactly the game it played before', () => {
  // Nineteen new keys, and every one of them a default that means "off". If a
  // fresh save's numbers have moved, one of them is on when it should not be.
  const bare = newGame();
  const b = bonuses(bare);
  assert.equal(b.windfallEvery, WINDFALL_EVERY);
  assert.equal(b.streakCap, STREAK_CAP);
  assert.equal(b.streakFloor, 0);
  assert.equal(b.costGrowth, COST_GROWTH);
  assert.equal(b.spendBack, 0);
  assert.equal(b.keepGrowers, 0);
  assert.equal(b.startGrowers, 0);
  assert.equal(b.alwaysOn, 0);
  assert.equal(b.offlineTaps, false);
  assert.equal(b.upgradeCost, 1);
  assert.equal(b.interest, 0);
  assert.equal(b.swing, SWING);
  assert.equal(b.lift, 0);
  assert.equal(b.allMult, 1);
});

test('Around the clock holds the whole lot above the arc, all day and all night', () => {
  const overADay = state => {
    let sum = 0;
    for(let i = 0; i < 240; i++){ state.elapsed = DAY_LENGTH * i / 240; sum += totalRate(state); }
    return sum / 240;
  };
  const lot = rows => {
    const s = newGame();
    for(const r of rows) s.rooted[r] = true;
    for(const g of GROWERS) s.owned[g.id] = 20;
    return s;
  };
  const base = overADay(lot([]));
  const held = PRESTIGE_BY_ID['night-shift'].effect.alwaysOn;
  assert.ok(Math.abs(overADay(lot(['night-shift'])) / base - (1 + held)) < 1e-9,
    'a day held above the arc is worth exactly what the row says');

  /* The trap this row was built out of, and the reason it says 0.75 rather
     than flattening the sky: flattening is worth nothing at all, because the
     swing already averages to one and all a flat day does is take the peaks
     away with the troughs. If this ever reads 1.0 again, the row has gone back
     to charging a season's energy for a change of weather. */
  assert.ok(overADay(lot(['night-shift'])) / base > 1.4, 'Around the clock must not be a flat day');

  // It reaches the all-hours kinds too, which is where the late game lives.
  const any = GROWERS.filter(g => g.phase === 'any').map(g => g.id);
  const anyOnly = rows => {
    const s = newGame();
    for(const r of rows) s.rooted[r] = true;
    for(const id of any) s.owned[id] = 20;
    return s;
  };
  assert.ok(Math.abs(overADay(anyOnly(['night-shift'])) / overADay(anyOnly([])) - (1 + held)) < 1e-9,
    'the three biggest earners are all-hours kinds and must not be skipped');

  // And the shop's quoted average agrees with what a day actually pays.
  for(const phase of ['day', 'night', 'any']){
    assert.equal(averageFactor(phase, 0.5, SWING, held), 1 + held, `${phase} quoted where it is held`);
  }
});

/* ---------------------------------------------- the nine that replaced kinds */

test('Deep beds pays for depth in one kind, not for breadth', () => {
  const lot = (rows, owned) => {
    const s = newGame();
    for(const r of rows) s.rooted[r] = true;
    Object.assign(s.owned, owned);
    return s;
  };
  // Forty of one kind: four tens, so four percent.
  const flat = lot([], { moss: 40 });
  const deep = lot(['deep-beds'], { moss: 40 });
  assert.ok(Math.abs(totalRate(deep) / totalRate(flat) - 1.04) < 1e-9);
  assert.ok(Math.abs(steadyRate(deep) / steadyRate(flat) - 1.04) < 1e-9, 'the quoted average has to agree');

  // Nine of a kind is no tens at all, and it counts each kind on its own.
  assert.equal(totalRate(lot(['deep-beds'], { moss: 9 })), totalRate(lot([], { moss: 9 })));
  const spread = lot(['deep-beds'], { moss: 20, fern: 20 });
  const plainSpread = lot([], { moss: 20, fern: 20 });
  assert.ok(Math.abs(totalRate(spread) / totalRate(plainSpread) - 1.02) < 1e-9, 'two tens each, two percent each');
});

test('By the crate takes a fifth off ten or more, and the max button counts at that price', () => {
  const moss = GROWER_BY_ID['moss'];
  const crate = bonuses((() => { const s = newGame(); s.rooted['by-the-crate'] = true; return s; })()).crate;
  assert.equal(crate, 0.2);

  assert.equal(bulkCost(moss, 0, 9, COST_GROWTH, crate), bulkCost(moss, 0, 9), 'nine is not a crate');
  // Within a penny: the discount is taken off the exact sum and rounded up
  // once, not taken off an already-rounded figure and rounded up again.
  const ten = bulkCost(moss, 0, CRATE), tenCrated = bulkCost(moss, 0, CRATE, COST_GROWTH, crate);
  assert.ok(Math.abs(tenCrated - ten * 0.8) <= 1, `ten is: ${tenCrated} against ${ten}`);
  assert.ok(tenCrated < ten, 'and it really is cheaper');
  // Absolute rather than relative, because both sides are rounded up and at
  // moss prices a penny is a whole percent.
  for(const count of [10, 25, 100]){
    const full = bulkCost(moss, 0, count), cut = bulkCost(moss, 0, count, COST_GROWTH, crate);
    assert.ok(Math.abs(cut - full * 0.8) <= 1, `a fifth off ${count}: ${cut} against ${full}`);
  }

  // Whatever "max" says it can buy, the purchase must go through.
  for(const light of [50, 500, 5000, 5e5, 5e8]){
    const state = newGame();
    state.rooted['by-the-crate'] = true;
    state.light = light;
    const bonus = bonuses(state);
    const count = affordable(moss, 0, light, bonus.costGrowth, bonus.crate);
    assert.ok(count >= 1);
    assert.ok(bulkCost(moss, 0, count, bonus.costGrowth, bonus.crate) <= light,
      `max said ${count} at ${light} and the till disagreed`);
    assert.equal(plantRefusal(state, 'moss', count), null, `max said ${count} and the game refused`);
  }
});

test('The seed drill puts two in for every one paid for', () => {
  const state = newGame();
  state.rooted['seed-drill'] = true;
  state.light = 1e9;
  const quoted = bulkCost(GROWER_BY_ID['moss'], 0, 10, COST_GROWTH, 0);
  const before = state.light;
  plant(state, 'moss', 10);
  assert.equal(state.owned.moss, 20, 'ten paid for, twenty planted');
  assert.equal(before - state.light, quoted, 'and the price is the price of ten');
  assert.equal(state.grown, 20, 'the tree counts what is standing, not what was bought');
});

test('A running start and Carry over both leave something behind them', () => {
  const ready = tweak => {
    const s = newGame();
    tweak(s);
    s.life.earned = seedAt(1);
    return s;
  };
  const plain = ready(s => { s.run.earned = 1e9; });
  prestige(plain);
  assert.deepEqual(plain.bought, {}, 'with neither row the shelf is bare');
  assert.equal(plain.light, 0);

  /* Half of what YOU had, cheapest first — not a fixed few off the shelf. The
     fixed five came to four thousand four hundred energy all told, dropped
     into a season that already opens with five million. */
  const eight = [...UPGRADES].sort((a, b) => a.cost - b.cost).slice(0, 8);
  const running = ready(s => {
    s.rooted['running-start'] = true;
    for(const up of eight) s.bought[up.id] = true;
  });
  prestige(running);
  assert.deepEqual(Object.keys(running.bought).sort(), eight.slice(0, 4).map(u => u.id).sort());

  // Nothing bought last season, nothing carried into this one.
  const empty = ready(s => { s.rooted['running-start'] = true; });
  prestige(empty);
  assert.deepEqual(empty.bought, {});

  const carried = ready(s => { s.rooted['carry-over'] = true; s.run.earned = 1e9; });
  prestige(carried);
  assert.ok(Math.abs(carried.light - 1e7) < 1e-6, 'a hundredth of a billion');

  // The flat head start and the carried share add rather than compete.
  const both = ready(s => {
    s.rooted['carry-over'] = true; s.rooted['warm-earth'] = true; s.run.earned = 1e9;
  });
  prestige(both);
  assert.ok(Math.abs(both.light - (500 + 1e7)) < 1e-6);
});

test('Half price halves the shop both ways, and never asks for less than one', () => {
  const need = { taps: 100, owned: { id: 'moss', count: 7 }, earned: 1 };
  const plain = bonuses(newGame());
  const half = bonuses((() => { const s = newGame(); s.rooted['half-price'] = true; return s; })());
  assert.equal(halfNeed(need, plain), need, 'untouched without the row');
  assert.deepEqual(halfNeed(need, half), { taps: 50, owned: { id: 'moss', count: 4 }, earned: 1 });

  // A row that was out of reach comes onto the shelf.
  const lot = rows => {
    const s = newGame();
    for(const r of rows) s.rooted[r] = true;
    for(const g of GROWERS) s.owned[g.id] = 3;
    s.life.taps = 60; s.run.taps = 60; s.life.earned = 900; s.run.earned = 900;
    s.life.seconds = 400; s.run.seconds = 400;
    return s;
  };
  assert.ok(offered(lot(['half-price'])).length > offered(lot([])).length,
    'half the requirement has to open at least one row');
});

test('The level ground stops a price climbing past the hundredth of a kind', () => {
  const moss = GROWER_BY_ID['moss'];
  const cap = bonuses((() => { const s = newGame(); s.rooted['level-ground'] = true; return s; })()).costCap;
  assert.equal(cap, 100);

  // Under the cap nothing changes; over it, every copy is the capped price.
  for(const owned of [0, 50, 99]) assert.equal(growerCost(moss, owned, COST_GROWTH, cap), growerCost(moss, owned));
  const flat = growerCost(moss, 100, COST_GROWTH, cap);
  for(const owned of [100, 150, 400]) assert.equal(growerCost(moss, owned, COST_GROWTH, cap), flat);
  assert.ok(growerCost(moss, 400) > flat * 100, 'and uncapped it would have run away');

  /* The bulk price is the climb plus the flat part, and it has to agree with
     buying them one at a time — the closed form is the only thing standing
     between a button and a price it cannot honour. */
  const oneByOne = (owned, count) => {
    let sum = 0;
    for(let i = 0; i < count; i++) sum += moss.cost * Math.pow(COST_GROWTH, Math.min(owned + i, cap));
    return Math.ceil(sum);
  };
  for(const [owned, count] of [[0, 1], [0, 10], [0, 150], [90, 30], [100, 5], [100, 200], [250, 40]]){
    assert.equal(bulkCost(moss, owned, count, COST_GROWTH, 0, cap), oneByOne(owned, count),
      `${count} from ${owned} owned`);
  }

  // And whatever "max" offers, the purchase must go through.
  for(const owned of [0, 95, 100, 300]){
    for(const light of [1e3, 1e6, 1e9]){
      const state = newGame();
      state.rooted['level-ground'] = true;
      state.owned.moss = owned;
      state.light = light;
      const b = bonuses(state);
      const count = affordable(moss, owned, light, b.costGrowth, b.crate, b.costCap);
      if(count === 0){
        assert.ok(growerCost(moss, owned, b.costGrowth, b.costCap) > light,
          `it said none were affordable at ${owned} owned with ${light}, and one was`);
        continue;
      }
      assert.ok(bulkCost(moss, owned, count, b.costGrowth, b.crate, b.costCap) <= light,
        `max said ${count} at ${owned} owned with ${light}`);
      assert.equal(plantRefusal(state, 'moss', count), null, `max said ${count} and the game refused`);
    }
  }
});

test('Volunteers turn up on the thousandth tap, one of every kind you have, for nothing', () => {
  const state = newGame();
  state.rooted['volunteers'] = true;
  state.owned.moss = 10; state.owned.fern = 4;      // two kinds standing
  state.run.taps = 998;
  const spentBefore = state.run.spent;

  tap(state, 0);                                   // the 999th
  assert.equal(state.owned.moss, 10, 'nothing yet');
  tap(state, 0);                                   // the 1000th
  assert.equal(state.owned.moss, 11);
  assert.equal(state.owned.fern, 5);
  assert.equal(state.owned.panel, 0, 'it cannot conjure a kind you have never planted');
  assert.equal(state.run.spent, spentBefore, 'and it cost nothing');
  assert.equal(state.run.planted, 2, 'both are on the record as planted');
  assert.equal(state.grown, 16, 'and the tree counts them');

  // A bare lot gets nothing, because there is nothing to volunteer.
  const bare = newGame();
  bare.rooted['volunteers'] = true;
  bare.run.taps = 999;
  tap(bare, 0);
  assert.equal(GROWER_IDS.reduce((n, id) => n + bare.owned[id], 0), 0);

  // And without the row, a thousand taps plant nothing at all.
  const none = newGame();
  none.owned.moss = 10;
  none.run.taps = 999;
  tap(none, 0);
  assert.equal(none.owned.moss, 10);
  assert.deepEqual(volunteerFor(none), []);
});

test('The heavy crop pays the lot on a windfall, and only on a windfall', () => {
  const lot = rows => {
    const s = newGame();
    for(const r of rows) s.rooted[r] = true;
    s.bought['windfall'] = true;
    for(const g of GROWERS) s.owned[g.id] = 10;
    return s;
  };
  const plain = lot([]);
  const heavy = lot(['heavy-crop']);

  plain.run.taps = 0; heavy.run.taps = 0;          // the next tap is an ordinary one
  assert.equal(tapPays(heavy, 0), tapPays(plain, 0), 'an ordinary tap is unchanged');

  plain.run.taps = 9; heavy.run.taps = 9;          // the next tap is the tenth
  assert.ok(isWindfall(plain), 'the tenth must be the windfall');
  assert.ok(Math.abs((tapPays(heavy, 0) - tapPays(plain, 0)) - totalRate(heavy)) < 1e-6,
    'a windfall pays a second of the whole lot on top');
});

test('Compound raises the ceiling on The reserve and nothing else', () => {
  const lot = rows => {
    const s = newGame();
    for(const r of rows) s.rooted[r] = true;
    for(const g of GROWERS) s.owned[g.id] = 10;
    s.light = 1e30;                                // far past any ceiling
    return s;
  };
  const rate = totalRate(lot([]));
  const capped = lot(['the-reserve']);
  const raised = lot(['the-reserve', 'compound']);
  assert.ok(Math.abs(tick(capped, 1) - rate * 2) < rate * 1e-6, 'one lot-second is the plain ceiling');
  assert.ok(Math.abs(tick(raised, 1) - rate * 4) < rate * 1e-6, 'three of them is the raised one');

  // On its own it is worth nothing, which is the point: it is a ceiling, not
  // an income, and there is nothing under it until The reserve is bought.
  const alone = lot(['compound']);
  assert.ok(Math.abs(tick(alone, 1) - rate) < rate * 1e-6);
});

test('the rings climb, so a season past the fortieth is still worth having', () => {
  // The seed above always wants four times the lifetime energy of the one
  // below. A flat tail means every season past the last written row is worth
  // less than the one before it, which is a ladder that has stopped.
  assert.equal(ringMult(RING_FROM), RING_MULT, 'the first ring is the plain doubling');
  let last = 0;
  for(let n = RING_FROM; n < RING_FROM + 200; n++){
    const m = ringMult(n);
    assert.ok(m > last, `ring ${n} must be worth more than the one below`);
    assert.ok(Math.abs(m / ringMult(n - 1 < RING_FROM ? RING_FROM : n - 1) - (n === RING_FROM ? 1 : RING_STEP)) < 1e-12
      || n === RING_FROM, `ring ${n} must be exactly one step above`);
    last = m;
  }
  assert.equal(ringMult(RING_FROM - 1), 0, 'a written rung is not a ring');
  assert.equal(ringMult(2.5), 0);

  // The blurb has to say the number the effect actually applies.
  for(const n of [RING_FROM, RING_FROM + 1, RING_FROM + 9, RING_FROM + 59]){
    const ring = ringFor(n);
    const said = Number(/makes ([\d.]+) times/.exec(ring.blurb)[1]);
    assert.ok(Math.abs(said - ring.effect.allMult) < 0.005,
      `"${ring.blurb}" against ${ring.effect.allMult}`);
  }
});

test('the max button is exact and finishes, at every price curve and every purse', () => {
  /* Two bugs lived here. The closed form solved the uncapped series, so once
     The level ground was bought a buy that started below the ceiling and ended
     above it stopped early — forty-eight moss beds left unbought on a purse
     that could afford a hundred and sixty-four. And the walk that was meant to
     fix that could not: by the time a lot buys five thousand million million at
     once, adding one to a double does nothing, so the loop never advanced and
     the tab stopped answering.

     So: exact, and bounded, over every combination the game can produce. */
  let checked = 0;
  for(const g of GROWERS){
    for(const cap of [Infinity, 100, 20]){
      for(const crate of [0, 0.2]){
        for(const growth of [COST_GROWTH, 1.13]){
          for(const owned of [0, 5, 9, 10, 19, 20, 21, 50, 90, 99, 100, 101, 250]){
            for(const light of [0, 1, 1e3, 1e6, 1e9, 1e12, 1e18, 1e30]){
              const n = affordable(g, owned, light, growth, crate, cap);
              const where = `${g.id} cap=${cap} crate=${crate} growth=${growth} owned=${owned} light=${light}`;
              checked++;
              if(n === 0){
                assert.ok(bulkCost(g, owned, 1, growth, crate, cap) > light,
                  `${where}: said none were affordable and one was`);
                continue;
              }
              assert.ok(bulkCost(g, owned, n, growth, crate, cap) <= light,
                `${where}: offered ${n} and the till would refuse`);
              // Maximal, wherever a double can still tell n from n + 1.
              if(Number.isSafeInteger(n + 1) && n + 1 !== n){
                assert.ok(bulkCost(g, owned, n + 1, growth, crate, cap) > light,
                  `${where}: offered ${n} and ${n + 1} was affordable`);
              }
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 10000, 'the sweep has to actually sweep');
});

test('a night away is not worth ten times a different night for the sake of one tap', () => {
  /* offlineGain paid the whole absence through tapPays, which asks whether the
     NEXT tap is the windfall. So the same night away was worth ten times as
     much or a tenth as much depending on where the run's tap counter happened
     to be sitting when the lid came down. */
  // The seconds move with the taps so the HAND is the same two a second in
  // every one of these; the only thing that differs is where in the run of ten
  // the counter is sitting.
  const build = (taps, windfall = true) => {
    const s = newGame();
    s.rooted['still-hands'] = true;
    if(windfall) s.bought['windfall'] = true;    // every tenth tap pays 10x
    s.owned.moss = 10;
    s.run.taps = taps; s.run.seconds = taps / 2;
    return s;
  };
  const values = [];
  for(let t = 1000; t < 1020; t++) values.push(offlineGain(build(t), 3600).light);
  const lo = Math.min(...values), hi = Math.max(...values);
  assert.ok(Math.abs(hi - lo) < 1e-6, `the same night away ranged from ${lo} to ${hi}`);

  // And the windfall is still worth something over a long absence.
  assert.ok(offlineGain(build(1000), 3600).light > offlineGain(build(1000, false), 3600).light,
    'a bought Windfall has to raise what an absence pays');
});

test('a forged save cannot hand the tick an Infinity to walk towards', () => {
  // `ring-999999999` used to be a row with an allMult of Infinity. One tick
  // later the lifetime total was Infinity, and seedsFrom walked towards it for
  // ever with the tab frozen.
  assert.equal(ringFor(RING_LAST), ringFor(RING_LAST), 'the last ring is a ring');
  assert.ok(ringFor(RING_LAST).effect.allMult > 0 && Number.isFinite(ringFor(RING_LAST).effect.allMult));
  assert.equal(ringFor(RING_LAST + 1), null, 'and there is nothing past it');
  assert.equal(prestigeById('ring-999999999'), null);
  assert.equal(prestigeById('ring-' + (RING_LAST + 1)), null);

  const forged = toSave(newGame());
  forged.rooted['ring-999999999'] = true;
  const state = fromSave(forged);
  assert.equal(state.rooted['ring-999999999'], undefined, 'it must not load at all');
  assert.ok(Number.isFinite(bonuses(state).allMult));

  // And the counter refuses a lifetime total that is not a number either way.
  for(const junk of [Infinity, -Infinity, NaN, undefined, null, 'lots']) assert.equal(seedsFrom(junk), 0);
});

test('a save from before "most held" existed starts its mark at the pile in hand', () => {
  // Nobody's figure should be a zero on a board just because the stat is new:
  // the energy sitting in the save is proof the pile was at least that big.
  const old = toSave(newGame());
  old.light = 4.2e9;
  delete old.life.peakHeld;
  delete old.run.peakHeld;
  const back = fromSave(old);
  assert.equal(back.life.peakHeld, 4.2e9);
  assert.equal(back.run.peakHeld, 4.2e9);

  // A mark already bigger than the pile is not walked back down by it.
  const spent = toSave(newGame());
  spent.light = 12;
  spent.life.peakHeld = 9e12;
  assert.equal(fromSave(spent).life.peakHeld, 9e12);

  // And it climbs on its own from here.
  const state = newGame();
  state.owned.moss = 50;
  tick(state, 60);
  assert.ok(state.life.peakHeld > 0, 'a minute of growing sets a mark');
  assert.equal(state.life.peakHeld, state.light);
  const held = state.life.peakHeld;
  state.light = 1e9;
  plant(state, 'moss', 1);                     // spending does not lower it
  assert.equal(state.life.peakHeld, held);
});

/* ---------------------------------------------------------- the save code */

/* A lot far enough along to have something to lose: every grower, every
   upgrade, every medal, a full ladder, a full graph and a full log. */
function playedLot(){
  const state = newGame();
  state.light = 1.23456789e21;
  state.elapsed = 987654.321;
  for(const id of GROWER_IDS){ state.owned[id] = 1234; state.earnedBy[id] = 9.87654321e15; }
  for(const upgrade of UPGRADES) state.bought[upgrade.id] = true;
  for(const medal of ACHIEVEMENTS) state.medals[medal.id] = true;
  for(const rung of PRESTIGE) state.rooted[rung.id] = true;
  state.rooted['ring-57'] = true;
  state.seeds = 57;
  state.prestiges = 57;
  state.grown = 22212;
  state.history = { at: [], rate: [], taps: [] };
  for(let i = 0; i < HISTORY_SAMPLES; i++){
    state.history.at.push(i * HISTORY_STEP + 0.3333333);
    state.history.rate.push(1234567.8912345 + i);
    state.history.taps.push(7.123456789);
  }
  state.log = [];
  for(let i = 0; i < MILESTONES; i++){
    note(state, `Season ${i}. The lot goes back to bare ground — you gained a seed.`);
  }
  for(const scope of ['run', 'life']){
    for(const key of STAT_KEYS) state[scope][key] = 4321.5 + STAT_KEYS.indexOf(key);
    // Above the pile in hand, because the loader raises it to at least that
    // and a fixture that disagreed with the rules would fail the round trip
    // for a reason that has nothing to do with the code.
    state[scope].peakHeld = 2e21;
    state[scope].earned = 3e21;
  }
  return state;
}

test('a save code carries the whole lot there and back', () => {
  const save = toSave(playedLot());
  const code = encodeSave(save);

  assert.ok(code.startsWith(`${CODE_TAG}.`), 'the code says what it is');
  assert.equal(codeRefusal(code), null);
  assert.deepEqual(decodeSave(code), save);

  // And through the loader, which is what the page actually does with it.
  const back = fromSave(decodeSave(code));
  const again = toSave(back);
  assert.deepEqual(again, save);
  assert.equal(again.seeds, 57);
  assert.equal(Object.keys(again.medals).length, ACHIEVEMENTS.length);
  assert.equal(again.rooted['ring-57'], true);
});

test('a save code survives the things that happen to text in transit', () => {
  const save = toSave(playedLot());
  const code = encodeSave(save);

  // Wrapped by a mail client, spaced by a chat window, padded by a paste.
  assert.deepEqual(decodeSave(code.replace(/(.{72})/g, '$1\n')), save);
  assert.deepEqual(decodeSave(`  \n${code}\t\n `), save);
  assert.deepEqual(decodeSave(code.toUpperCase().slice(0, CODE_TAG.length) + code.slice(CODE_TAG.length)), save);

  // No character that a URL, a shell or a spreadsheet would eat.
  assert.match(code, /^[A-Za-z0-9._-]+$/);
});

test('a save code that is not whole is refused, and nothing is loaded', () => {
  const code = encodeSave(toSave(playedLot()));

  assert.equal(codeRefusal(''), CODE_EMPTY);
  assert.equal(codeRefusal('   \n  '), CODE_EMPTY);
  assert.equal(codeRefusal(null), CODE_EMPTY);
  assert.equal(codeRefusal(undefined), CODE_EMPTY);

  // Something else entirely.
  assert.equal(codeRefusal('hello'), CODE_ALIEN);
  assert.equal(codeRefusal('{"light":12}'), CODE_ALIEN);
  // Checksums, decodes, is an object — and is not a save. Loading it would
  // hand `fromSave` something it would turn into a brand new game.
  assert.equal(codeRefusal(encodeSave({ light: 5 })), CODE_ALIEN);
  assert.equal(codeRefusal(encodeSave([1, 2, 3])), CODE_ALIEN);
  assert.equal(codeRefusal(encodeSave(null)), CODE_ALIEN);

  // Cut off partway through a paste — the likeliest failure there is, and the
  // one that must not read as "not a Sunward code".
  assert.equal(codeRefusal(code.slice(0, code.length - 40)), CODE_BROKEN);
  assert.equal(codeRefusal(code.slice(0, 200)), CODE_BROKEN);
  assert.equal(codeRefusal(CODE_TAG), CODE_BROKEN);
  // A character lost out of the middle, which still splits into three parts.
  const bitten = code.slice(0, 500) + code.slice(501);
  assert.equal(codeRefusal(bitten), CODE_BROKEN);
  // A character changed, which base64 decodes happily and JSON might not.
  const middle = Math.floor(code.length / 2);
  const swapped = code.slice(0, middle) + (code[middle] === 'a' ? 'b' : 'a') + code.slice(middle + 1);
  assert.equal(codeRefusal(swapped), CODE_BROKEN);

  // Every one of those returns nothing to load, rather than an empty game.
  for(const bad of ['', 'hello', code.slice(0, 200), bitten, swapped]){
    assert.equal(decodeSave(bad), null);
  }
});

test('a save code carries text that is not plain ASCII', () => {
  // The log is in-world prose and the dashes in it are real em dashes, which
  // is one byte in a JavaScript string and three in UTF-8: a code built on
  // `btoa` alone would throw on the first one.
  const save = toSave(newGame());
  save.log = [{ at: 1, text: 'Away 3m — the lot made 12.4K … ✓' }];
  assert.deepEqual(decodeSave(encodeSave(save)).log, save.log);
});

test('a save code round-trips whatever else the page tucks into it', () => {
  // The page sends the board row along, because a code that left it behind
  // would lose your place on the board the moment you carried it to another
  // machine. `encodeSave` is not told about it and does not need to be.
  const save = { ...toSave(newGame()), board: { id: 'c0ffee00-0000-4000-8000-000000000001', name: 'Rook', joined: true } };
  const back = decodeSave(encodeSave(save));
  assert.deepEqual(back.board, save.board);
  // And the loader ignores it rather than choking on it.
  assert.equal(fromSave(back).seeds, 0);
});
