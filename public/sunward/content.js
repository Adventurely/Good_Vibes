/* Sunward — the game as data.
 *
 * Everything here is data and pure functions over it. No DOM, no storage, no
 * clock, no randomness — not at load time and not at all. The page owns the
 * clock and the save file; this module only ever answers questions about a
 * state object it is handed, which is what makes the whole economy testable in
 * Node without a browser anywhere near it.
 *
 * The other two games keep their rules here because a Durable Object imports
 * them. Sunward has no server and never will — a clicker is one player and a
 * save file — but the split earns its keep anyway: the balance of the game is
 * in one file that a test can read, rather than smeared through the page that
 * draws it.
 *
 * --- The shape of a state -------------------------------------------------
 *
 * One object, `newGame()` below, and every function here takes it. The ones
 * that change it (`tick`, `tap`, `plant`, `study`, `prestige`) mutate in place
 * and say so in their own comment; the rest are questions and touch nothing.
 * Mutation rather than a fresh object per frame is deliberate: this ticks at
 * 20Hz forever, and a game that allocates a new state sixty times a second is
 * a game that stutters when the collector runs.
 *
 * --- Adding a grower ------------------------------------------------------
 *
 * Copy a row of GROWERS and change it. Costs and rates are on a curve (see the
 * comment above the table) rather than picked by feel, so a new tier belongs
 * at the end and should follow it; test/sunward.test.js checks that it does,
 * because a tier that is quietly better than the one after it makes every
 * purchase after it a mistake.
 */

/* ---------------------------------------------------------------- the day */

/* A day is four minutes. Long enough that the sky is somewhere different when
   you look up from the shop, short enough that a player who sits down for ten
   minutes sees two of them — the cycle has to be witnessed to be understood,
   and a cycle nobody witnesses is just an unexplained wobble in the graph. */
export const DAY_LENGTH = 240;

/* How far day and night growers swing either side of their rated output. Half
   is a lot: at midnight a field of panels is making half what the shop said it
   would. That is the point — the shop's number is an average, and the game
   says so on the row — and it is what makes a night grower worth buying when
   you already have twelve panels. Upgrades shave this down; see `steady`. */
export const SWING = 0.5;

/* Where a fresh run starts on the clock. Not zero: zero is first light, the
   most saturated sky in the table, and a game that opens on it opens on a wall
   of magenta. Mid-morning is what a lot looks like when you arrive at it. */
export const DAY_START = DAY_LENGTH * 0.18;

/* Dawn at 0, noon at 0.25, dusk at 0.5, midnight at 0.75. */
export const dayPhase = elapsed => {
  const t = (elapsed % DAY_LENGTH) / DAY_LENGTH;
  return t < 0 ? t + 1 : t;
};

/* +1 at noon, -1 at midnight, 0 at dawn and dusk. The sky, the sun's height in
   the arc and every grower's swing all read from this one number, so they
   cannot drift apart. */
export const sunHeight = phase => Math.sin(phase * Math.PI * 2);

export const PHASE_NAMES = [
  [0.00, 'Dawn'], [0.10, 'Morning'], [0.20, 'Noon'], [0.35, 'Afternoon'],
  [0.45, 'Dusk'], [0.55, 'Evening'], [0.70, 'Night'], [0.85, 'Small hours'],
];

export function phaseName(phase){
  let name = 'Dawn';
  for(const [at, label] of PHASE_NAMES) if(phase >= at) name = label;
  return name;
}

/* ------------------------------------------------------------- the growers */

/* The curve. Costs multiply by about 11.2 a tier and output by about 6.4, so a
 * tier pays for itself in 1.75x the time the one below it does: two minutes
 * for a moss bed, most of a day for an orbital mirror.
 *
 * That ratio is the whole balance of the game in one number. Flat (cost and
 * output growing together) and the newest tier is always the right buy, which
 * makes the shop a list with one live row. Much steeper and the top tiers are
 * ornaments nobody can justify. At 1.75 a new tier is a treat you save for and
 * the tier below it is still worth topping up while you save, which is the
 * rhythm a clicker is actually made of.
 *
 * `rate` is the AVERAGE over a whole day. A day grower makes half again as
 * much at noon and half as much at midnight; the number on the row is what it
 * makes if you leave it running. Anything else would have the shop lying to
 * you twice a day.
 */
export const GROWERS = [
  { id: 'moss', name: 'Moss bed', cost: 12, rate: 0.1, phase: 'any', art: 'moss',
    flavour: 'It was here before you. It only needed the rubble taken off it.' },
  { id: 'fern', name: 'Fern bank', cost: 130, rate: 0.65, phase: 'night', art: 'fern',
    flavour: 'Unrolls after dark and holds the damp until morning.' },
  { id: 'panel', name: 'Leaf panel', cost: 1500, rate: 4, phase: 'day', art: 'panel',
    flavour: 'Photovoltaic, and shaped like the thing it is copying.' },
  { id: 'hive', name: 'Beehive', cost: 17000, rate: 26, phase: 'day', art: 'hive',
    flavour: 'Pays in pollination. The honey is a side effect.' },
  { id: 'mushroom', name: 'Mushroom vault', cost: 190000, rate: 170, phase: 'night', art: 'mushroom',
    flavour: 'A cellar of small lamps that eat the dark and give it back.' },
  { id: 'orchard', name: 'Orchard row', cost: 2.1e6, rate: 1100, phase: 'day', art: 'orchard',
    flavour: 'Twelve trees and a ladder somebody left against the last one.' },
  { id: 'turbine', name: 'Wind turbine', cost: 2.4e7, rate: 6900, phase: 'any', art: 'turbine',
    flavour: 'Turns whether or not anybody is watching it.' },
  { id: 'glasshouse', name: 'Glasshouse', cost: 2.7e8, rate: 44000, phase: 'day', art: 'glasshouse',
    flavour: 'Keeps one summer going all the way through a winter.' },
  { id: 'mycelium', name: 'Mycelial net', cost: 3.0e9, rate: 280000, phase: 'night', art: 'mycelium',
    flavour: "The forest's own switchboard, wired into yours." },
  { id: 'reef', name: 'Reef garden', cost: 3.3e10, rate: 1.8e6, phase: 'night', art: 'reef',
    flavour: 'Coral under grow-lights. Nobody believed it would take.' },
  { id: 'canopy', name: 'Canopy tower', cost: 3.7e11, rate: 1.15e7, phase: 'any', art: 'canopy',
    flavour: 'A building with a forest on it, or the other way round.' },
  { id: 'mirror', name: 'Orbital mirror', cost: 4.2e12, rate: 7.4e7, phase: 'day', art: 'mirror',
    flavour: 'A second sun on a short leash. Aim it kindly.' },
];

export const GROWER_IDS = GROWERS.map(g => g.id);

/* Keyed lookup, built once. A `find` per grower per frame is twelve linear
   scans sixty times a second for an answer that never changes. */
export const GROWER_BY_ID = Object.fromEntries(GROWERS.map(g => [g.id, g]));

/* Every one you own makes the next one cost 15% more. The standard of the
   genre, and it is standard because it works: it turns "buy the best thing"
   into "buy the best thing you can still afford", which is a decision. */
export const COST_GROWTH = 1.15;

/* What the nth one costs, given you already have `owned`. */
export const growerCost = (grower, owned) =>
  Math.ceil(grower.cost * Math.pow(COST_GROWTH, owned));

/* What `count` more cost in one go. The closed form of the sum, because the
   bulk buttons ask for a hundred at a time and a loop of a hundred pows to
   grey out one button is a loop that runs on every frame. */
export function bulkCost(grower, owned, count){
  if(count <= 0) return 0;
  const first = grower.cost * Math.pow(COST_GROWTH, owned);
  return Math.ceil(first * (Math.pow(COST_GROWTH, count) - 1) / (COST_GROWTH - 1));
}

/* How many you could afford at once, which is what the "max" button needs.
   Solved rather than counted, for the same reason. */
export function affordable(grower, owned, light){
  if(light < growerCost(grower, owned)) return 0;
  const first = grower.cost * Math.pow(COST_GROWTH, owned);
  const n = Math.log(1 + (light * (COST_GROWTH - 1)) / first) / Math.log(COST_GROWTH);
  let count = Math.max(1, Math.floor(n));
  // The logarithm is right to about a part in 1e15, and being one over is a
  // button that spends money the player does not have. Walk it back if so.
  while(count > 1 && bulkCost(grower, owned, count) > light) count--;
  return count;
}

/* ------------------------------------------------------------- the upgrades */

/* An upgrade is bought once and never sold. Four things one can do:
 *
 *   clickMult   multiply what a tap is worth
 *   allMult     multiply everything, taps included
 *   grower      multiply one grower's output (with `mult`)
 *   fingers     a tap also pays this fraction of your light per second
 *   steady      shave this off the day/night swing, to a floor of nothing
 *
 * `need` is what has to be true before it appears in the shop at all, and it
 * is read against THIS RUN rather than against all time: `runTaps`, `runEarned`,
 * `owned`. Upgrades are spent at a reset, so their unlocks reset with them —
 * measuring them against a lifetime total would hand a returning player the
 * whole shop at once on their second run and delete the middle of the game.
 * Achievements are the opposite and are measured against all time, because a
 * record you can lose is not a record.
 *
 * Hiding
 * them is not coyness: a shop with forty rows in it on the first tap is a wall,
 * and the drip of a new row appearing is most of what keeps the middle of a
 * clicker alive. `meets` below is the only thing that reads these, and the
 * achievements use the same shapes so there is one evaluator and not two.
 */
export const UPGRADES = [
  /* --- the hand ---------------------------------------------------------- */
  { id: 'warm-hands', name: 'Warm hands', cost: 100, effect: { clickMult: 2 },
    need: { runTaps: 15 }, flavour: 'Cold fingers drop things.' },
  { id: 'sun-gloves', name: 'Sun gloves', cost: 1200, effect: { clickMult: 2 },
    need: { runTaps: 100 }, flavour: 'Woven from the last crop of flax on the block.' },
  { id: 'photic-touch', name: 'Photic touch', cost: 30000, effect: { clickMult: 2 },
    need: { runTaps: 400 }, flavour: 'The light comes off on your hands now.' },
  { id: 'heliotropism', name: 'Heliotropism', cost: 1.5e6, effect: { clickMult: 2 },
    need: { runTaps: 1500 }, flavour: 'You have started turning to face it without noticing.' },
  { id: 'solar-palm', name: 'Solar palm', cost: 8e7, effect: { clickMult: 3 },
    need: { runTaps: 5000 }, flavour: 'A whole growing season in one hand.' },
  { id: 'long-fingers', name: 'Long fingers', cost: 4e9, effect: { clickMult: 3 },
    need: { runTaps: 15000 }, flavour: 'Reaching further than they strictly should.' },

  /* --- the hand borrows from the garden ---------------------------------- */
  /* Every clicker eventually has to answer "why am I still tapping at hour
     three", and this is the answer that works: a tap pays a slice of what the
     whole garden makes in a second, so the hand keeps up with the engine
     instead of being left behind by it in the first ten minutes. */
  { id: 'gleaning', name: 'Gleaning', cost: 25000, effect: { fingers: 0.01 },
    need: { runTaps: 200 }, flavour: 'Take what the harvest left. It adds up.' },
  { id: 'sun-catcher', name: 'Sun catcher', cost: 6e6, effect: { fingers: 0.02 },
    need: { runTaps: 1000 }, flavour: 'Hung in the window, and it does more than it looks like.' },
  { id: 'prism-hand', name: 'Prism hand', cost: 2e9, effect: { fingers: 0.05 },
    need: { runTaps: 4000 }, flavour: 'One tap, split eight ways.' },
  { id: 'whole-orchard', name: 'The whole orchard', cost: 5e11, effect: { fingers: 0.1 },
    need: { runTaps: 12000 }, flavour: 'Every tree leans in a little when you reach.' },

  /* --- everything at once ------------------------------------------------ */
  { id: 'long-summer', name: 'Long summer', cost: 1.2e5, effect: { allMult: 1.05 },
    need: { runEarned: 5e5 }, flavour: 'The frost comes a fortnight late these days.' },
  { id: 'deep-roots', name: 'Deep roots', cost: 6e7, effect: { allMult: 1.1 },
    need: { runEarned: 1e8 }, flavour: 'What is under the lot is bigger than what is on it.' },
  { id: 'clean-air', name: 'Clean air', cost: 1.5e10, effect: { allMult: 1.15 },
    need: { runEarned: 2e10 }, flavour: 'You can see the far ridge again.' },
  { id: 'good-water', name: 'Good water', cost: 2e12, effect: { allMult: 1.2 },
    need: { runEarned: 4e12 }, flavour: 'The stream runs clear enough to drink from.' },
  { id: 'old-weather', name: 'The old weather', cost: 4e14, effect: { allMult: 1.25 },
    need: { runEarned: 8e14 }, flavour: 'Rain when it should rain. Nobody thought it would come back.' },

  /* --- the swing --------------------------------------------------------- */
  /* Both halves of the cycle, bought separately, because the interesting hour
     is the one where you have flattened your nights and not your days. */
  { id: 'night-bloom', name: 'Night bloom', cost: 8e6, effect: { steady: 0.15 },
    need: { owned: { id: 'mushroom', count: 5 } },
    flavour: 'Flowers that open at dusk, for the things that fly then.' },
  { id: 'dawn-chorus', name: 'Dawn chorus', cost: 9e8, effect: { steady: 0.15 },
    need: { owned: { id: 'glasshouse', count: 5 } },
    flavour: 'Everything wakes fifteen minutes earlier than it used to.' },
  { id: 'even-keel', name: 'Even keel', cost: 7e12, effect: { steady: 0.15 },
    need: { owned: { id: 'canopy', count: 10 } },
    flavour: 'Enough of it now that a cloudy week is just a week.' },

  /* --- one per grower, twice ---------------------------------------------- */
  /* The first at ten owned, the second at twenty-five. Both numbers are off
     the simulation rather than off a feel: a player buying whatever pays for
     itself soonest holds about ten of a tier within an hour of unlocking it and
     twenty-five within four, so the pair lands as "soon" and "later this
     session". Fifty — the obvious round number, and where these started — was
     four days away, which is not an upgrade, it is a decoration. */
  { id: 'damp-corners', name: 'Damp corners', cost: 300, effect: { grower: 'moss', mult: 2 },
    need: { owned: { id: 'moss', count: 10 } }, flavour: 'Where the wall meets the north side.' },
  { id: 'moss-lawn', name: 'Moss lawn', cost: 30000, effect: { grower: 'moss', mult: 2 },
    need: { owned: { id: 'moss', count: 25 } }, flavour: 'Nobody has to mow it, which was always the argument.' },

  { id: 'fiddleheads', name: 'Fiddleheads', cost: 3300, effect: { grower: 'fern', mult: 2 },
    need: { owned: { id: 'fern', count: 10 } }, flavour: 'Tight little spirals, and every one is a frond.' },
  { id: 'fern-gully', name: 'Fern gully', cost: 330000, effect: { grower: 'fern', mult: 2 },
    need: { owned: { id: 'fern', count: 25 } }, flavour: 'The whole cut of it, green to the top.' },

  { id: 'cleaned-glass', name: 'Cleaned glass', cost: 38000, effect: { grower: 'panel', mult: 2 },
    need: { owned: { id: 'panel', count: 10 } }, flavour: 'A cloth and an afternoon, for eleven percent.' },
  { id: 'sun-tracking', name: 'Sun tracking', cost: 3.8e6, effect: { grower: 'panel', mult: 2 },
    need: { owned: { id: 'panel', count: 25 } }, flavour: 'They lean west by four in the afternoon.' },

  { id: 'second-queen', name: 'A second queen', cost: 425000, effect: { grower: 'hive', mult: 2 },
    need: { owned: { id: 'hive', count: 10 } }, flavour: 'Split the hive before it swarms and you keep both.' },
  { id: 'apiary-row', name: 'Apiary row', cost: 4.25e7, effect: { grower: 'hive', mult: 2 },
    need: { owned: { id: 'hive', count: 25 } }, flavour: 'Painted different colours so they find their own door.' },

  { id: 'deeper-cellar', name: 'A deeper cellar', cost: 4.75e6, effect: { grower: 'mushroom', mult: 2 },
    need: { owned: { id: 'mushroom', count: 10 } }, flavour: 'Cold, dark and exactly damp enough.' },
  { id: 'spore-drift', name: 'Spore drift', cost: 4.75e8, effect: { grower: 'mushroom', mult: 2 },
    need: { owned: { id: 'mushroom', count: 25 } }, flavour: 'They spread themselves if you leave a door open.' },

  { id: 'grafted-stock', name: 'Grafted stock', cost: 5.25e7, effect: { grower: 'orchard', mult: 2 },
    need: { owned: { id: 'orchard', count: 10 } }, flavour: 'One root, four kinds of apple.' },
  { id: 'windbreak', name: 'Windbreak', cost: 5.25e9, effect: { grower: 'orchard', mult: 2 },
    need: { owned: { id: 'orchard', count: 25 } }, flavour: 'A hedge on the weather side and the blossom stays on.' },

  { id: 'longer-blades', name: 'Longer blades', cost: 6e8, effect: { grower: 'turbine', mult: 2 },
    need: { owned: { id: 'turbine', count: 10 } }, flavour: 'Twice the sweep for the same tower.' },
  { id: 'ridge-line', name: 'The ridge line', cost: 6e10, effect: { grower: 'turbine', mult: 2 },
    need: { owned: { id: 'turbine', count: 25 } }, flavour: 'Where the wind was always going to be.' },

  { id: 'double-glazing', name: 'Double glazing', cost: 6.75e9, effect: { grower: 'glasshouse', mult: 2 },
    need: { owned: { id: 'glasshouse', count: 10 } }, flavour: 'The night stops taking back what the day made.' },
  { id: 'heat-sink', name: 'Heat sink', cost: 6.75e11, effect: { grower: 'glasshouse', mult: 2 },
    need: { owned: { id: 'glasshouse', count: 25 } }, flavour: 'A wall of water barrels, painted black.' },

  { id: 'wider-mesh', name: 'Wider mesh', cost: 7.5e10, effect: { grower: 'mycelium', mult: 2 },
    need: { owned: { id: 'mycelium', count: 10 } }, flavour: 'It was already going that way. You only helped.' },
  { id: 'old-growth', name: 'Old growth', cost: 7.5e12, effect: { grower: 'mycelium', mult: 2 },
    need: { owned: { id: 'mycelium', count: 25 } }, flavour: 'Threads older than the street they run under.' },

  { id: 'warmer-water', name: 'Warmer water', cost: 8.25e11, effect: { grower: 'reef', mult: 2 },
    need: { owned: { id: 'reef', count: 10 } }, flavour: 'Two degrees, held steady, and it stops bleaching.' },
  { id: 'atoll', name: 'Atoll', cost: 8.25e13, effect: { grower: 'reef', mult: 2 },
    need: { owned: { id: 'reef', count: 25 } }, flavour: 'A ring of it, with a lagoon in the middle.' },

  { id: 'higher-floors', name: 'Higher floors', cost: 9.25e12, effect: { grower: 'canopy', mult: 2 },
    need: { owned: { id: 'canopy', count: 10 } }, flavour: 'The lift goes up into the leaves.' },
  { id: 'sky-bridge', name: 'Sky bridge', cost: 9.25e14, effect: { grower: 'canopy', mult: 2 },
    need: { owned: { id: 'canopy', count: 25 } }, flavour: 'You can cross the district without coming down.' },

  { id: 'better-aim', name: 'Better aim', cost: 1.05e14, effect: { grower: 'mirror', mult: 2 },
    need: { owned: { id: 'mirror', count: 10 } }, flavour: 'Warm the field, not the town.' },
  { id: 'constellation', name: 'Constellation', cost: 1.05e16, effect: { grower: 'mirror', mult: 2 },
    need: { owned: { id: 'mirror', count: 25 } }, flavour: 'A ring of them, holding station over the dark side.' },
];

export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map(u => [u.id, u]));

/* --------------------------------------------------------------- the record */

/* What the stats screen counts. Every one of these is a number that only ever
 * goes up, kept in three scopes at once — this session, this run, and all
 * time — because they answer three different questions and a player asking
 * "am I doing better than yesterday" is not served by a counter that resets
 * when they let it seed.
 *
 * `peakRate` and `peakTaps` are the exception in kind rather than in scope:
 * they are high-water marks rather than totals, which is why they are set with
 * a max and not an add. They are here anyway, because "the best I ever had it"
 * is the number people actually want off a stats screen.
 */
export const STAT_LABELS = {
  taps: 'Taps',
  tapped: 'Light from tapping',
  grown: 'Light from growers',
  earned: 'Light earned',
  spent: 'Light spent',
  planted: 'Growers planted',
  studied: 'Upgrades bought',
  peakRate: 'Best light per second',
  peakTaps: 'Best taps per second',
  seconds: 'Time',
};

/* The same list as column headings. A row on the stats screen has the width
   for the sentence; a table of ten columns does not. */
export const STAT_SHORT = {
  taps: 'Taps',
  tapped: 'By hand',
  grown: 'Grown',
  earned: 'Earned',
  spent: 'Spent',
  planted: 'Planted',
  studied: 'Upgrades',
  peakRate: 'Best l/s',
  peakTaps: 'Best t/s',
  seconds: 'Time',
};

export const STAT_KEYS = Object.keys(STAT_LABELS);

/* Which of them are a high-water mark rather than a running total. The adder
   and the save loader both read this, so there is one answer. */
export const PEAK_KEYS = ['peakRate', 'peakTaps'];

/* Which want a clock rendering rather than a number, and which are light. */
export const TIME_KEYS = ['seconds'];
export const LIGHT_KEYS = ['tapped', 'grown', 'earned', 'spent', 'peakRate'];

export const blankStats = () =>
  Object.fromEntries(STAT_KEYS.map(key => [key, 0]));

/* Add to every scope at once. Everything that scores goes through here, which
   is the only reason the three scopes cannot disagree — the first cut set them
   one at a time and `run` quietly stopped counting spent light for a week. */
export function score(state, key, amount){
  if(!amount) return;
  if(PEAK_KEYS.includes(key)){
    for(const scope of [state.session, state.run, state.life]){
      if(amount > scope[key]) scope[key] = amount;
    }
    return;
  }
  state.session[key] += amount;
  state.run[key] += amount;
  state.life[key] += amount;
}

/* ---------------------------------------------------------------- history */

/* Ten minutes of the recent past, sampled every two seconds. 300 numbers per
 * series and three series, which is nine hundred floats — small enough to keep
 * in the save file, big enough that the day/night wave is visible in it, and
 * that wave is the reason the graph exists at all. A clicker's output line is
 * otherwise a slope, and nobody needs a chart to see a slope.
 */
export const HISTORY_STEP = 2;
export const HISTORY_SAMPLES = 300;
export const HISTORY_SPAN = HISTORY_STEP * HISTORY_SAMPLES;

export const freshHistory = () => ({ rate: [], taps: [], at: [] });

/* Push one sample, dropping the oldest when full. Mutates. */
export function sample(history, at, rate, taps){
  history.at.push(at);
  history.rate.push(rate);
  history.taps.push(taps);
  while(history.at.length > HISTORY_SAMPLES){
    history.at.shift(); history.rate.shift(); history.taps.shift();
  }
  return history;
}

/* Taps per second over the last `window` seconds, from a list of tap times.
 *
 * Measured over a window rather than counted per second because a clicker's
 * rate is spiky by nature: a player doing eight a second in bursts reads as
 * zero on every second they pause, and a number that flickers to zero while
 * you are still clicking is a number nobody believes. Ten seconds is long
 * enough to be steady and short enough to answer honestly when you stop.
 */
export function tapRate(times, now, window = 10){
  if(!times.length) return 0;
  const from = now - window;
  let n = 0;
  for(let i = times.length - 1; i >= 0; i--){
    if(times[i] < from) break;
    n++;
  }
  return n / window;
}

/* The milestone log: what happened, and how far into the run it happened. Kept
   to the last MILESTONES entries because a run that goes for a day would
   otherwise carry a thousand of them into the save file. */
export const MILESTONES = 80;

export function note(state, text){
  state.log.push({ at: Math.round(state.elapsed), text });
  while(state.log.length > MILESTONES) state.log.shift();
  return state;
}

/* ----------------------------------------------------------- achievements */

/* Earned once and kept forever — through a reset, which is the point of them.
 * They pay nothing. A clicker that pays for achievements ends up with a player
 * grinding an achievement instead of playing, and the honest job of this list
 * is to be a record of what has happened to you, which is the same job the
 * stats screen has. That is why they are shown on it.
 */
export const ACHIEVEMENTS = [
  { id: 'first-light', name: 'First light', need: { taps: 1 },
    blurb: 'Tap the tree once.' },
  { id: 'hundred-taps', name: 'Persistent', need: { taps: 100 },
    blurb: 'A hundred taps.' },
  { id: 'thousand-taps', name: 'Devoted', need: { taps: 1000 },
    blurb: 'A thousand taps.' },
  { id: 'ten-thousand-taps', name: 'Unwavering', need: { taps: 10000 },
    blurb: 'Ten thousand taps.' },
  { id: 'quick-hands', name: 'Quick hands', need: { tapRate: 6 },
    blurb: 'Six taps a second, held for ten.' },
  { id: 'blur', name: 'A blur', need: { tapRate: 10 },
    blurb: 'Ten taps a second, held for ten.' },

  { id: 'first-grower', name: 'Something planted', need: { growers: 1 },
    blurb: 'Plant anything at all.' },
  { id: 'ten-growers', name: 'A patch', need: { growers: 10 },
    blurb: 'Ten growers on the lot.' },
  { id: 'hundred-growers', name: 'A garden', need: { growers: 100 },
    blurb: 'A hundred growers on the lot.' },
  { id: 'five-hundred', name: 'A district', need: { growers: 500 },
    blurb: 'Five hundred growers on the lot.' },
  { id: 'one-of-each', name: 'Diversified', need: { kinds: 12 },
    blurb: 'One of every kind of grower at once.' },
  { id: 'fifty-moss', name: 'Ground cover', need: { owned: { id: 'moss', count: 50 } },
    blurb: 'Fifty moss beds. It started somewhere.' },
  { id: 'fifty-mirror', name: 'Second sun', need: { owned: { id: 'mirror', count: 50 } },
    blurb: 'Fifty orbital mirrors.' },

  { id: 'first-thousand', name: 'A thousand', need: { lifetime: 1000 },
    blurb: 'Earn a thousand light.' },
  { id: 'first-million', name: 'A million', need: { lifetime: 1e6 },
    blurb: 'Earn a million light.' },
  { id: 'first-billion', name: 'A billion', need: { lifetime: 1e9 },
    blurb: 'Earn a billion light.' },
  { id: 'first-trillion', name: 'A trillion', need: { lifetime: 1e12 },
    blurb: 'Earn a trillion light.' },
  { id: 'rate-thousand', name: 'Ticking over', need: { rate: 1000 },
    blurb: 'A thousand light a second.' },
  { id: 'rate-million', name: 'Humming', need: { rate: 1e6 },
    blurb: 'A million light a second.' },

  { id: 'ten-upgrades', name: 'Well read', need: { upgrades: 10 },
    blurb: 'Ten upgrades bought.' },
  { id: 'thirty-upgrades', name: 'Studious', need: { upgrades: 30 },
    blurb: 'Thirty upgrades bought.' },
  { id: 'every-upgrade', name: 'The whole shelf', need: { upgrades: UPGRADES.length },
    blurb: 'Every upgrade there is, in one run.' },

  { id: 'first-seed', name: 'Let it seed', need: { prestiges: 1 },
    blurb: 'Give the lot back once.' },
  { id: 'five-seeds', name: 'Crop rotation', need: { prestiges: 5 },
    blurb: 'Give the lot back five times.' },
  { id: 'hundred-seeds', name: 'Seed bank', need: { seeds: 100 },
    blurb: 'Hold a hundred seeds.' },

  { id: 'an-hour', name: 'An afternoon', need: { seconds: 3600 },
    blurb: 'An hour of tending, all told.' },
  { id: 'a-full-day', name: 'Round the clock', need: { days: 12 },
    blurb: 'Watch twelve days come and go in one run.' },
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

/* ------------------------------------------------------------- the state */

/* A new save. Everything the game knows is in here and nothing else, which is
 * what makes the save file a copy of it rather than a translation of it.
 *
 * `session` is in the object for uniformity and is deliberately NOT saved:
 * "this sitting" means since you opened the page, and a session that survived
 * a reload would be lying about the one scope whose whole job is to be short.
 */
export const SAVE_VERSION = 2;

export const freshOwned = () => Object.fromEntries(GROWER_IDS.map(id => [id, 0]));

export function newGame(){
  return {
    version: SAVE_VERSION,
    light: 0,
    elapsed: DAY_START,  // seconds into this run; the sky reads from it
    owned: freshOwned(),
    earnedBy: freshOwned(),  // light each kind has made this run, for the table
    bought: {},          // upgrade id -> true, this run
    medals: {},          // achievement id -> true, forever
    seeds: 0,            // banked at the last reset
    pending: 0,          // seeds this run would pay if you reset now
    prestiges: 0,
    session: blankStats(),
    run: blankStats(),
    life: blankStats(),
    log: [],
    history: freshHistory(),
    sampledAt: 0,        // elapsed at the last history sample
    decade: 0,           // biggest power of ten of lifetime light already logged
  };
}

/* ------------------------------------------------------------ the bonuses */

/* Every multiplier in the game, folded out of the upgrades once. Called from
 * the tick and from every shop row that wants to show what a purchase would
 * do, so it is a fold over ~40 booleans and nothing more expensive than that.
 */
export function bonuses(state){
  const out = {
    clickMult: 1,
    allMult: 1,
    fingers: 0,
    swing: SWING,
    grower: Object.fromEntries(GROWER_IDS.map(id => [id, 1])),
    seedMult: seedBonus(state.seeds),
  };
  for(const id of Object.keys(state.bought)){
    const up = UPGRADE_BY_ID[id];
    // An unknown id is an upgrade deleted from the table while somebody's save
    // still names it. Ignore rather than throw: a stale save is not a crash.
    if(!up || !state.bought[id]) continue;
    const e = up.effect;
    if(e.clickMult) out.clickMult *= e.clickMult;
    if(e.allMult) out.allMult *= e.allMult;
    if(e.fingers) out.fingers += e.fingers;
    if(e.steady) out.swing = Math.max(0, out.swing - e.steady);
    if(e.grower && out.grower[e.grower] !== undefined) out.grower[e.grower] *= e.mult;
  }
  return out;
}

/* Seeds pay 2% each, and they pay it to everything. Linear rather than
   compounding: at a hundred seeds a compounding 2% is a multiplier of seven
   and a linear one is three, and the reset loop wants to be worth doing twice,
   not worth doing once and then forever. */
export const SEED_RATE = 0.02;
export const seedBonus = seeds => 1 + SEED_RATE * seeds;

/* How much a grower's phase is worth right now: 1 at the equinox points, up to
   1 + swing at its best hour and down to 1 - swing at its worst. An `any`
   grower ignores the sky entirely. */
export function phaseFactor(phase, at, swing = SWING){
  if(phase === 'any') return 1;
  const h = sunHeight(dayPhase(at));
  return 1 + (phase === 'day' ? h : -h) * swing;
}

/* What one kind is making per second, right now. */
export function rateOf(state, id, bonus = bonuses(state)){
  const g = GROWER_BY_ID[id];
  if(!g) return 0;
  const owned = state.owned[id] || 0;
  if(!owned) return 0;
  return owned * g.rate * bonus.grower[id] * bonus.allMult * bonus.seedMult
    * phaseFactor(g.phase, state.elapsed, bonus.swing);
}

/* The whole lot, per second, right now. */
export function totalRate(state, bonus = bonuses(state)){
  let sum = 0;
  for(const id of GROWER_IDS) sum += rateOf(state, id, bonus);
  return sum;
}

/* The whole lot averaged over a day — what the number would be if the sky
   stopped moving. The rate readout shows the live figure and this underneath
   it, because a player watching their income fall for two minutes deserves to
   be told it is the night and not something they did. */
export function steadyRate(state, bonus = bonuses(state)){
  let sum = 0;
  for(const id of GROWER_IDS){
    const g = GROWER_BY_ID[id];
    const owned = state.owned[id] || 0;
    if(!owned) continue;
    sum += owned * g.rate * bonus.grower[id] * bonus.allMult * bonus.seedMult;
  }
  return sum;
}

/* What a tap is worth. The base is one, and the garden lends the hand a slice
   of its own output once `fingers` is bought. */
export function tapValue(state, bonus = bonuses(state)){
  const base = 1 * bonus.clickMult * bonus.allMult * bonus.seedMult;
  return base + bonus.fingers * totalRate(state, bonus);
}

/* ------------------------------------------------------------ conditions */

/* Everything the game knows about itself as flat numbers, which is what both
   the unlock conditions and the achievements are written against. Built once
   per frame and handed to both. */
export function snapshot(state, { rate = null, taps = 0 } = {}){
  const bonus = bonuses(state);
  let growers = 0, kinds = 0;
  for(const id of GROWER_IDS){
    const n = state.owned[id] || 0;
    growers += n;
    if(n > 0) kinds++;
  }
  return {
    taps: state.life.taps,
    runTaps: state.run.taps,
    tapRate: taps,
    lifetime: state.life.earned,
    runEarned: state.run.earned,
    light: state.light,
    rate: rate === null ? totalRate(state, bonus) : rate,
    growers,
    kinds,
    owned: state.owned,
    upgrades: Object.keys(state.bought).length,
    prestiges: state.prestiges,
    seeds: state.seeds,
    seconds: state.life.seconds,
    days: state.run.seconds / DAY_LENGTH,
  };
}

/* Does a `need` hold? One evaluator for unlocks and achievements both, so a
 * condition means the same thing wherever it is written. An unknown key is
 * false rather than true: a typo in a table should hide a row, not hand it
 * out for free.
 */
export function meets(need, snap){
  for(const [key, want] of Object.entries(need || {})){
    if(key === 'owned'){
      if((snap.owned[want.id] || 0) < want.count) return false;
      continue;
    }
    if(!(key in snap)) return false;
    if(snap[key] < want) return false;
  }
  return true;
}

/* The shop, in table order: everything unlocked and not yet bought. */
export function offered(state, snap = snapshot(state)){
  return UPGRADES.filter(u => !state.bought[u.id] && meets(u.need, snap));
}

/* Which achievements are newly true. Mutates: it marks them, because the only
   caller wants the list precisely so it can announce them once. */
export function award(state, snap = snapshot(state)){
  const won = [];
  for(const a of ACHIEVEMENTS){
    if(state.medals[a.id]) continue;
    if(!meets(a.need, snap)) continue;
    state.medals[a.id] = true;
    won.push(a);
  }
  return won;
}

/* --------------------------------------------------------------- the verbs */

/* Everything below changes the state in place and returns what happened, so a
 * caller can announce it. They are the only functions here that write.
 */

/* One frame. `dt` is seconds of real time, and it is clamped: a laptop lid
 * closed for six hours comes back as one enormous dt, and the honest answer to
 * that is the offline calculation below, not a single tick paying six hours at
 * the live rate — the sky would not have moved, so a night's worth of output
 * would be paid at noon.
 */
export const MAX_TICK = 5;

export function tick(state, dt){
  const step = Math.max(0, Math.min(dt, MAX_TICK));
  if(!step) return 0;

  const bonus = bonuses(state);
  let gained = 0;
  for(const id of GROWER_IDS){
    const made = rateOf(state, id, bonus) * step;
    if(!made) continue;
    state.earnedBy[id] += made;
    gained += made;
  }

  state.light += gained;
  state.elapsed += step;
  score(state, 'seconds', step);
  score(state, 'grown', gained);
  score(state, 'earned', gained);
  score(state, 'peakRate', totalRate(state, bonus));
  state.pending = pendingSeeds(state);
  return gained;
}

/* One tap. Returns what it paid, which is what the number that floats off the
   tree is showing. */
export function tap(state){
  const value = tapValue(state);
  state.light += value;
  score(state, 'taps', 1);
  score(state, 'tapped', value);
  score(state, 'earned', value);
  state.pending = pendingSeeds(state);
  return value;
}

/* Why you cannot plant that, or null. A reason string rather than a boolean,
   the way the other games do it, so the shop row and the click handler cannot
   disagree about what is wrong — the row prints exactly what the handler
   refused with. */
export function plantRefusal(state, id, count = 1){
  const g = GROWER_BY_ID[id];
  if(!g) return 'There is no such grower.';
  if(!Number.isInteger(count) || count < 1) return 'One at a time, at least.';
  const owned = state.owned[id] || 0;
  const cost = bulkCost(g, owned, count);
  if(state.light < cost) return `Not enough light — ${formatLight(cost - state.light)} short.`;
  return null;
}

/* Plant them. Returns the cost, or null if it was refused and nothing changed. */
export function plant(state, id, count = 1){
  if(plantRefusal(state, id, count)) return null;
  const g = GROWER_BY_ID[id];
  const cost = bulkCost(g, state.owned[id] || 0, count);
  state.light -= cost;
  state.owned[id] = (state.owned[id] || 0) + count;
  score(state, 'spent', cost);
  score(state, 'planted', count);
  return cost;
}

export function studyRefusal(state, id){
  const up = UPGRADE_BY_ID[id];
  if(!up) return 'There is no such upgrade.';
  if(state.bought[id]) return 'You have that already.';
  if(!meets(up.need, snapshot(state))) return 'Not yet.';
  if(state.light < up.cost) return `Not enough light — ${formatLight(up.cost - state.light)} short.`;
  return null;
}

export function study(state, id){
  if(studyRefusal(state, id)) return null;
  const up = UPGRADE_BY_ID[id];
  state.light -= up.cost;
  state.bought[id] = true;
  score(state, 'spent', up.cost);
  score(state, 'studied', 1);
  return up;
}

/* ------------------------------------------------------------- the reset */

/* Seeds are the reward for giving the lot back. The cube root is what keeps
 * the loop honest: ten seeds want a billion light lifetime, a hundred want a
 * thousand times that. Anything gentler and the right move is to reset every
 * ten minutes forever; anything steeper and the second run is the last one
 * anybody plays.
 *
 * It is measured against LIFETIME light and the already-banked seeds are
 * subtracted, so nothing is ever lost by resetting late — a player who keeps
 * going past the break-even point banks the same seeds later, plus whatever
 * they earned in the meantime.
 */
export const SEED_SCALE = 1e6;

export const seedsFrom = lifetime =>
  lifetime <= 0 ? 0 : Math.floor(Math.cbrt(lifetime / SEED_SCALE));

export const pendingSeeds = state =>
  Math.max(0, seedsFrom(state.life.earned) - state.seeds);

/* What lifetime total the next seed wants, so the reset panel can show a bar
   rather than a number that sits still for an hour. */
export const lightForSeeds = seeds => Math.pow(seeds, 3) * SEED_SCALE;

export function prestigeRefusal(state){
  if(pendingSeeds(state) < 1){
    const want = lightForSeeds(state.seeds + 1);
    return `Not yet — ${formatLight(want - state.life.earned)} more light, all told.`;
  }
  return null;
}

/* Give the lot back. Keeps the seeds, the medals, the lifetime record and the
 * sitting; everything else starts again. Returns how many seeds it paid.
 */
export function prestige(state){
  if(prestigeRefusal(state)) return null;
  const won = pendingSeeds(state);
  state.seeds += won;
  state.pending = 0;
  state.prestiges += 1;
  state.light = 0;
  state.elapsed = DAY_START;
  state.owned = freshOwned();
  state.earnedBy = freshOwned();
  state.bought = {};
  state.run = blankStats();
  state.log = [];
  state.history = freshHistory();
  state.sampledAt = 0;
  return won;
}

/* ------------------------------------------------------------- while away */

/* Growers keep working when the tab is shut, at half rate and for at most half
 * a day. Half because a clicker that pays full rate offline is a clicker best
 * played by not playing it, and half a day because the alternative is coming
 * back from a fortnight's holiday to a number that has made the rest of the
 * run pointless.
 *
 * The live day/night swing averages to exactly one over a whole cycle, so
 * offline pays the steady rate and does not care where the sun was.
 */
export const OFFLINE_RATE = 0.5;
export const OFFLINE_CAP = 12 * 3600;

/* What `seconds` away would be worth, without changing anything. */
export function offlineGain(state, seconds){
  const away = Math.max(0, Math.min(seconds, OFFLINE_CAP));
  return { seconds: away, capped: seconds > OFFLINE_CAP, light: steadyRate(state) * OFFLINE_RATE * away };
}

/* Pay it in. Advances the sky by the real time away — the world kept turning
 * even where the payment is capped — but does NOT add to time played: an hour
 * with the tab shut is not an hour of tending, and a stats screen that claims
 * it is has stopped being a record of anything.
 */
export function catchUp(state, seconds){
  const gain = offlineGain(state, seconds);
  if(gain.light > 0){
    const share = steadyRate(state);
    if(share > 0){
      const bonus = bonuses(state);
      for(const id of GROWER_IDS){
        const g = GROWER_BY_ID[id];
        const owned = state.owned[id] || 0;
        if(!owned) continue;
        const mine = owned * g.rate * bonus.grower[id] * bonus.allMult * bonus.seedMult;
        state.earnedBy[id] += gain.light * (mine / share);
      }
    }
    state.light += gain.light;
    score(state, 'grown', gain.light);
    score(state, 'earned', gain.light);
  }
  state.elapsed += Math.max(0, seconds);
  state.pending = pendingSeeds(state);
  return gain;
}

/* -------------------------------------------------------------- the save */

/* The save file is the state with the sitting taken out and a version stamped
 * on. No translation layer, on purpose: a save format that is a different
 * shape from the live state is a second model of the game to keep in step, and
 * the thing it protects against — a rename in the state leaking into old saves
 * — is exactly what `fromSave` below is for.
 */
export function toSave(state){
  return {
    version: SAVE_VERSION,
    light: state.light,
    elapsed: state.elapsed,
    owned: { ...state.owned },
    earnedBy: { ...state.earnedBy },
    bought: { ...state.bought },
    medals: { ...state.medals },
    seeds: state.seeds,
    prestiges: state.prestiges,
    decade: state.decade,
    run: { ...state.run },
    life: { ...state.life },
    log: state.log.slice(-MILESTONES),
    history: {
      at: state.history.at.slice(),
      rate: state.history.rate.slice(),
      taps: state.history.taps.slice(),
    },
  };
}

/* A number from a save file, or the default. Saves are edited, truncated by a
   full disk, and written by older versions of this file; every one of those
   arrives as a string, a null or a NaN, and any of them reaching the tick
   turns the whole economy into NaN one frame later and never recovers. */
const num = (value, fallback = 0) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/* Rebuild a state from whatever was in storage. Everything is merged onto a
 * fresh game rather than trusted, so a save from an older version — or a save
 * naming a grower that has since been renamed — loads with the parts it still
 * has and defaults for the rest.
 */
export function fromSave(raw){
  const state = newGame();
  if(!raw || typeof raw !== 'object') return state;

  state.light = Math.max(0, num(raw.light));
  state.elapsed = Math.max(0, num(raw.elapsed));
  state.seeds = Math.max(0, Math.floor(num(raw.seeds)));
  state.prestiges = Math.max(0, Math.floor(num(raw.prestiges)));
  state.decade = Math.max(0, Math.floor(num(raw.decade)));

  for(const id of GROWER_IDS){
    state.owned[id] = Math.max(0, Math.floor(num(raw.owned?.[id])));
    state.earnedBy[id] = Math.max(0, num(raw.earnedBy?.[id]));
  }
  for(const id of Object.keys(raw.bought || {})){
    if(UPGRADE_BY_ID[id] && raw.bought[id]) state.bought[id] = true;
  }
  for(const id of Object.keys(raw.medals || {})){
    if(ACHIEVEMENT_BY_ID[id] && raw.medals[id]) state.medals[id] = true;
  }
  for(const scope of ['run', 'life']){
    for(const key of STAT_KEYS) state[scope][key] = Math.max(0, num(raw[scope]?.[key]));
  }
  if(Array.isArray(raw.log)){
    state.log = raw.log
      .filter(entry => entry && typeof entry.text === 'string')
      .slice(-MILESTONES)
      .map(entry => ({ at: Math.max(0, num(entry.at)), text: entry.text.slice(0, 120) }));
  }
  const h = raw.history;
  if(h && Array.isArray(h.at) && Array.isArray(h.rate) && Array.isArray(h.taps)){
    // Three series that disagree about their length would draw a graph with a
    // point missing off one line, so the shortest wins and the rest are cut.
    const keep = Math.min(h.at.length, h.rate.length, h.taps.length, HISTORY_SAMPLES);
    const from = arr => arr.slice(arr.length - keep).map(v => num(v));
    state.history = { at: from(h.at), rate: from(h.rate), taps: from(h.taps) };
  }
  state.sampledAt = state.elapsed;
  state.pending = pendingSeeds(state);
  return state;
}

/* ---------------------------------------------------------------- reading */

/* Short scale, because that is what a clicker player already reads. Past
   decillion it gives up and goes to exponent notation rather than inventing
   names nobody knows — a number you cannot say out loud is a number that has
   stopped meaning anything, and by then the exponent is the interesting part. */
const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

export function formatLight(n){
  if(!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const value = Math.abs(n);

  if(value < 1000){
    if(value === 0) return '0';
    // A decimal is worth a character while it is still telling you something:
    // 0.4 a second is a fact and 412.6 is noise.
    if(value < 10) return sign + String(Math.round(value * 10) / 10);
    return sign + String(Math.floor(value));
  }

  let tier = Math.floor(Math.log10(value) / 3);
  let scaled = value / Math.pow(1000, tier);
  // Rounding at the edge: 999,999.7 is tier 1 by the logarithm and reads as
  // 1000.0K, which is a unit nobody uses. Carry it.
  if(scaled >= 999.9995){ tier += 1; scaled = value / Math.pow(1000, tier); }
  if(tier >= SUFFIXES.length) return sign + value.toExponential(2).replace('e+', 'e');

  const places = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  return sign + scaled.toFixed(places) + SUFFIXES[tier];
}

/* A duration, at the coarsest two units that still say something. */
export function formatTime(seconds){
  if(!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  if(s < 60) return `${s}s`;
  if(s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  if(s < 86400) return `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`;
  return `${Math.floor(s / 86400)}d ${String(Math.floor(s / 3600) % 24).padStart(2, '0')}h`;
}

/* A stat, rendered the way its kind wants: light gets a suffix, time gets a
   clock, and a count is a count with thousands separators. One place, because
   three screens show these numbers and they should agree. */
export function formatStat(key, value){
  if(TIME_KEYS.includes(key)) return formatTime(value);
  if(LIGHT_KEYS.includes(key)) return formatLight(value);
  if(key === 'peakTaps') return (Math.round(value * 10) / 10).toString();
  return Math.floor(value).toLocaleString('en-US');
}

/* Where each kind's output is coming from, biggest first — the stats screen's
 * table. Shares are of the live rate, so at midnight the night growers really
 * are the bigger slice, which is the clearest way the cycle ever gets
 * explained to anybody.
 */
export function breakdown(state){
  const bonus = bonuses(state);
  const total = totalRate(state, bonus);
  return GROWERS
    .filter(g => (state.owned[g.id] || 0) > 0)
    .map(g => ({
      id: g.id,
      name: g.name,
      phase: g.phase,
      owned: state.owned[g.id],
      rate: rateOf(state, g.id, bonus),
      earned: state.earnedBy[g.id] || 0,
      share: total > 0 ? rateOf(state, g.id, bonus) / total : 0,
    }))
    .sort((a, b) => b.rate - a.rate);
}
