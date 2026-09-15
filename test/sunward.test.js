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
  OFFLINE_RATE, OFFLINE_CAP, offlineGain, catchUp,
  toSave, fromSave, formatLight, formatTime, formatStat, breakdown,
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
     in a month, so the top rung has to be a long way past that and still
     inside the world: a rung nobody can ever stand on is a joke, not a goal. */
  const top = counts[counts.length - 1];
  assert.ok(top >= 20 && top <= 40, `the ladder tops out at ${top}, which is not a stretch a player could make`);
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
    const does = Object.keys(up.effect);
    assert.equal(does.length, 1, `"${up.id}": one effect a rung, not ${does.length}`);
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
  for(const up of PRESTIGE){
    const bare = newGame();
    for(const g of GROWERS) bare.owned[g.id] = 20;
    const before = bonuses(bare);
    const after = (() => {
      const state = newGame();
      for(const g of GROWERS) state.owned[g.id] = 20;
      state.rooted[up.id] = true;
      return bonuses(state);
    })();
    const moved = Object.keys(after).some(key => {
      const a = before[key], b = after[key];
      return typeof a === 'number' ? a !== b : false;
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
  assert.deepEqual(needs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40]);
  assert.equal(new Set(needs).size, needs.length, 'two medals for one seed count');
  for(const id of ['first-seed', 'five-seeds', 'twelve-seeds', 'hundred-seeds']){
    assert.ok(ACHIEVEMENT_BY_ID[id], `medal id "${id}" is in saves and cannot be renamed`);
  }
});

test('no player ever reads the words "replant" or "rooted"', () => {
  // Both were scrapped as terminology. They survive as identifiers — state.rooted,
  // root(), SEEDS_PER_REPLANT — and that is fine, because nobody reads those.
  // What must not happen is one of them turning up in a blurb again.
  const scrapped = /\b(replant\w*|rooted)\b/i;
  const shown = [];
  for(const table of [GROWERS, UPGRADES, ACHIEVEMENTS, PRESTIGE]){
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

test('the ladder tops out at twelve rows, which is what the season toast promises', () => {
  // The toast says "Another row of upgrades is open" only when a row actually
  // opens at that seed. It can only know that if there is exactly one row a
  // seed from one upward, with no gaps and no two rows on the same rung.
  const seeds = PRESTIGE.map(u => u.seed);
  assert.deepEqual(seeds, seeds.map((_, i) => i + 1), 'one row a seed, from the first');
  const top = Math.max(...seeds);
  assert.equal(top, 12);
  for(let n = 1; n <= top; n++) assert.ok(PRESTIGE.some(u => u.seed === n), `nothing opens at seed ${n}`);
  assert.ok(!PRESTIGE.some(u => u.seed === top + 1), 'a season past the top opens nothing, and must not say it does');
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
