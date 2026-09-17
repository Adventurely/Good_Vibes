/* Sunward — the game as data.
 *
 * Everything here is data and pure functions over it. No DOM, no storage, no
 * clock, no randomness — not at load time and not at all. The page owns the
 * clock and the save file; this module only ever answers questions about a
 * state object it is handed, which is what makes the whole economy testable in
 * Node without a browser anywhere near it.
 *
 * The other two games keep their rules here because a Durable Object imports
 * them. Sunward plays with no server — a clicker is one player and a save
 * file, and the only thing on the Worker for it is a leaderboard the save can
 * be posted to, with its own rules in src/sunward-board.js — but the split
 * earns its keep anyway: the balance of the game is in one file that a test
 * can read, rather than smeared through the page that draws it.
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
   you already have twelve panels.

   The one `steady` upgrade shaves the swing, and it shaves it off the BOTTOM
   only: a bought one lifts the trough without touching the peak. Shrinking it
   from both ends, which is what they did at first, is worth exactly nothing —
   the swing already averages to one over a day, so a symmetric shave changes
   the shape of the line and not the area under it, and three upgrades costing
   8M, 900M and 7T light bought a player a bit-identical income. See
   `averageFactor` for what the asymmetric version is worth. */
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
 * tier pays for itself in 1.75x the time the one below it does.
 *
 * Nine tiers. There were twelve, and three of them were the same idea as a
 * tier already on the list — a second fungus, a coral reef nobody could
 * explain, and an orbital mirror that was a second sun in a game whose sun
 * is scenery. A shop row that is a costlier copy of the row above it is not a
 * choice, it is a longer list.
 *
 * That ratio is the whole balance of the game in one number. Flat (cost and
 * output growing together) and the newest tier is always the right buy, which
 * makes the shop a list with one live row. Much steeper and the top tiers are
 * ornaments nobody can justify. At 1.75 a new tier is a treat you save for and
 * the tier below it is still worth topping up while you save, which is the
 * rhythm a clicker is actually made of. Two minutes for a moss bed, three
 * hours for a canopy tower.
 *
 * `rate` is the AVERAGE over a whole day. A day grower makes half again as
 * much at noon and half as much at midnight; the number on the row is what it
 * makes if you leave it running. Anything else would have the shop lying to
 * you twice a day.
 */
export const GROWERS = [
  { id: 'moss', name: 'Moss bed', cost: 12, rate: 0.1, phase: 'any', art: 'moss',
    flavour: 'Forms a symbiotic relationship with your tree. It helps the soil retain moisture, while providing the moss shade.' },
  { id: 'fern', name: 'Fern bank', cost: 130, rate: 0.65, phase: 'night', art: 'fern',
    flavour: 'A bank of ferns that unfurl at night. Helps prevent night-time evaporation.' },
  { id: 'panel', name: 'Leaf panel', cost: 1500, rate: 4, phase: 'day', art: 'panel',
    flavour: 'A breakthrough in solar technology. It provides extra food for your tree by using its own form of photosynthesis.' },
  { id: 'hive', name: 'Beehive', cost: 17000, rate: 26, phase: 'day', art: 'hive',
    flavour: 'A hive of busy bees. Aids in the fertilization of the tree, but only works in the day.' },
  { id: 'mushroom', name: 'Mushroom vault', cost: 190000, rate: 170, phase: 'night', art: 'mushroom',
    flavour: 'A cellar of pale glowing mushrooms. Feeds the roots of the tree, but only works at night.' },
  { id: 'orchard', name: 'Orchard row', cost: 2.1e6, rate: 1100, phase: 'day', art: 'orchard',
    flavour: 'Twelve fruit trees sharing one root network. They pass surplus sugar along to your tree, but only while the sun is up.' },
  { id: 'turbine', name: 'Wind turbine', cost: 2.4e7, rate: 6900, phase: 'any', art: 'turbine',
    flavour: 'A tall turbine on the ridge. It runs on weather rather than sunlight, so it feeds your tree at any hour.' },
  /* The one tier that was moved off the sun after it was written. Its
     description says it shields the tree day or night, which was not true of
     a grower marked `day` — and of the two ways to settle that, changing the
     game was the better one: a glasshouse is the one building on this lot that
     obviously does keep working after dark.

     The rate moved with it, from 44,000 to 51,000, and the reason is Night
     bloom. `rate` is already the average over a whole day — a day grower
     earns half again at noon and half as much at midnight and averages
     exactly this — so simply changing the mark would have left the average
     alone. But Night bloom lifts the trough of MARKED growers only, worth
     SWING/pi on them and nothing on an `any` grower, and anybody who owns a
     glasshouse bought Night bloom three tiers ago. Left at 44,000 the tier
     quietly lost that sixteen percent: the simulation had a day's play down
     from 7.11M a second to 6.38M. Multiplied back in, it is where it was. */
  { id: 'glasshouse', name: 'Glasshouse', cost: 2.7e8, rate: 51000, phase: 'any', art: 'glasshouse',
    flavour: 'A mega greenhouse environment. Shields your tree day or night against predators.' },
  { id: 'canopy', name: 'Canopy tower', cost: 3.0e9, rate: 280000, phase: 'any', art: 'canopy',
    flavour: 'A tower with its own forest ecosystem. Surplus energy is delivered straight to your tree.' },
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
/* `growth` is COST_GROWTH unless a seed row has flattened it. It is a
   parameter rather than a state read because these three are called from the
   shop's draw loop, once a row, once a frame, and they have no state to hand —
   but every caller that HAS a state must pass the same number the purchase
   will use, or the button says a price the till refuses. */
export const growerCost = (grower, owned, growth = COST_GROWTH, cap = Infinity) =>
  Math.ceil(grower.cost * Math.pow(growth, Math.min(owned, cap)));

/* What `count` more cost in one go. The closed form of the sum, because the
   bulk buttons ask for a hundred at a time and a loop of a hundred pows to
   grey out one button is a loop that runs on every frame. */
export const CRATE = 10;   // what counts as buying by the crate

export function bulkCost(grower, owned, count, growth = COST_GROWTH, crate = 0, cap = Infinity){
  if(count <= 0) return 0;
  /* Two parts: the copies still on the climb, summed in closed form, and the
     ones past the cap, which all cost what the capped one costs. The closed
     form alone would be wrong by everything above the cap, and a loop would
     run a hundred pows a frame to grey out one button. */
  const climbing = Math.max(0, Math.min(count, cap - owned));
  const flat = count - climbing;
  const first = grower.cost * Math.pow(growth, Math.min(owned, cap));
  const full = (climbing > 0 ? first * (Math.pow(growth, climbing) - 1) / (growth - 1) : 0)
    + flat * grower.cost * Math.pow(growth, Math.min(owned + climbing, cap));
  return Math.ceil(count >= CRATE ? full * (1 - crate) : full);
}

/* How many you could afford at once, which is what the "max" button needs.
   Solved rather than counted, for the same reason. */
export function affordable(grower, owned, light, growth = COST_GROWTH, crate = 0, cap = Infinity){
  const price = n => bulkCost(grower, owned, n, growth, crate, cap);
  if(light < price(1)) return 0;

  /* An estimate first, so the search below starts somewhere near the answer.
     Three shapes, and the one in the middle is the one that was wrong: a buy
     that starts below the price ceiling and ends above it. The plain geometric
     solution assumes the price climbs for ever, so past the ceiling it thinks
     each further copy costs more than it does and stops early — it was leaving
     forty-eight moss beds unbought on a purse that could afford a hundred and
     sixty-four. The purse is divided by the crate discount because the search
     below runs where that discount applies. */
  const purse = light / (1 - crate);
  const climbing = Math.max(0, cap - owned);
  let guess;
  if(climbing <= 0){
    // Every copy the same price: division, not logarithms.
    guess = purse / (grower.cost * Math.pow(growth, cap));
  } else {
    const first = grower.cost * Math.pow(growth, owned);
    const climb = first * (Math.pow(growth, climbing) - 1) / (growth - 1);
    guess = purse < climb
      ? Math.log(1 + (purse * (growth - 1)) / first) / Math.log(growth)
      : climbing + (purse - climb) / (grower.cost * Math.pow(growth, cap));
  }

  /* Then bisect, rather than walking the estimate in. Every branch above is a
     floating-point expression and can be out either way, and a walk cannot fix
     it in the late game: by the time a lot is buying five thousand million
     million at once, adding one to a double does nothing at all, so the loop
     never advances and the tab stops answering. Bisection is fifty-three steps
     at the worst and is exact.

     It runs from CRATE up, because the discount makes the price NOT monotonic
     across that boundary — ten can cost less than nine — and bisection needs a
     monotonic predicate. Below the boundary there are nine numbers and they are
     simply tried. */
  let best = 0;
  for(let n = 1; n < CRATE; n++){
    if(price(n) <= light) best = n; else break;
  }
  let hi = Math.min(Number.MAX_SAFE_INTEGER, Math.max(CRATE, Math.ceil(guess) + 2));
  if(price(CRATE) <= light){
    let lo = CRATE;
    while(price(hi) <= light && hi < Number.MAX_SAFE_INTEGER){
      hi = Math.min(Number.MAX_SAFE_INTEGER, hi * 2);
    }
    while(lo < hi){
      const mid = lo + Math.floor((hi - lo + 1) / 2);
      if(price(mid) <= light) lo = mid; else hi = mid - 1;
    }
    best = Math.max(best, lo);
  }
  return Math.max(1, best);
}

/* ------------------------------------------------------------- the upgrades */

/* An upgrade is bought once and never sold. Seven things one can do:
 *
 *   clickMult   multiply what a tap is worth
 *   streak      a tap is worth this much more per tap-a-second the hand is going
 *   windfall    every WINDFALL_EVERYth tap pays this many times over
 *   allMult     multiply everything, taps included
 *   grower      multiply one grower's output (with `mult`)
 *   fingers     a tap also pays this fraction of your energy per second
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
  /* Twenty. There were forty-two, and most of the difference was the same
     upgrade sold twice — six doublings of the tap, four slices of the rate,
     five global percentages, three shavings of the swing, and two rows for
     every grower. A shop where every row is "the last row, again, bigger" is
     a shop nobody reads. What is left is one line of each kind, and every row
     in it does something the row before it did not.

     The two that came back are for the hand, and they are new kinds rather
     than more steps: a tap that is worth more the faster you go, and a tenth
     tap that pays ten. The first cut of this shop had the hand worth two
     energy at the forty-five minute mark against a lot making a hundred and
     fifty a second — the sim put tapping at two percent of income from the
     half hour on, and eight taps a second for an hour reached the first
     replant forty minutes sooner than thirty taps and a closed lid. A
     clicker in which clicking does not matter is a screensaver.

     None of them is named for the sun any more, either. The tree runs on
     what you give it — energy, not light — and the sun in the sky is weather. */

  /* --- the hand ---------------------------------------------------------- */
  /* Priced to land in the first quarter hour, because that is when a flat
     multiplier can still be felt: the lot grows by elevens a tier and the hand
     by twos a row, so a doubling that arrives at the forty-minute mark (where
     Steady hands used to, at 30,000) is a doubling of nothing anyone notices.
     Past the quarter hour the hand keeps up through `fingers`, not these. */
  { id: 'warm-hands', name: 'Warm hands', cost: 100, effect: { clickMult: 2 },
    need: { runTaps: 15 }, flavour: 'Cold fingers drop things.' },
  { id: 'steady-hands', name: 'Steady hands', cost: 900, effect: { clickMult: 2 },
    need: { runTaps: 100 }, flavour: 'The tremor goes once you stop hurrying.' },
  { id: 'green-fingers', name: 'Green fingers', cost: 40000, effect: { clickMult: 3 },
    need: { runTaps: 1000 }, flavour: 'Everything you touch takes.' },

  /* --- the hand, going -------------------------------------------------- */
  /* Momentum reads the hand's speed: a quarter more per tap a second, to a
     cap of eight, so four a second is a doubling and a real flurry is a
     trebling. It is the one upgrade whose worth is decided by how the player
     is playing right now rather than by what they own, which is what makes it
     a different thing from Warm hands and not a fourth step of it. */
  { id: 'momentum', name: 'Momentum', cost: 2500, effect: { streak: 0.25 },
    need: { runTaps: 250 }, flavour: 'The second tap is easier than the first.' },
  /* Windfall is a rhythm: every tenth tap pays ten. Over a hundred taps it is
     worth as much as a doubling, but it is not shaped like one — it gives the
     hand a beat, and a beat is what makes a hundred taps in a row feel like a
     hundred and not like a chore. It is counted off the run's taps, so it is
     the same tenth tap on every device and in every test. */
  { id: 'windfall', name: 'Windfall', cost: 8000, effect: { windfall: 10 },
    need: { runTaps: 400 }, flavour: 'One apple in ten comes down on its own.' },

  /* --- the hand borrows from the garden ---------------------------------- */
  /* Every clicker eventually has to answer "why am I still tapping at hour
     three", and this is the answer that works: a tap pays a slice of what the
     whole garden makes in a second, so the hand keeps up with the engine
     instead of being left behind by it in the first ten minutes. */
  { id: 'gleaning', name: 'Gleaning', cost: 600, effect: { fingers: 0.02 },
    need: { runTaps: 150 }, flavour: 'Take what the harvest left. It adds up.' },
  { id: 'whole-orchard', name: 'The whole orchard', cost: 1.5e6, effect: { fingers: 0.05 },
    need: { runTaps: 2500 }, flavour: 'Every tree leans in a little when you reach.' },

  /* --- everything at once ------------------------------------------------ */
  { id: 'long-summer', name: 'Long summer', cost: 1.2e5, effect: { allMult: 1.05 },
    need: { runEarned: 5e5 }, flavour: 'The frost comes a fortnight late these days.' },
  { id: 'deep-roots', name: 'Deep roots', cost: 6e7, effect: { allMult: 1.1 },
    need: { runEarned: 1e8 }, flavour: 'What is under the lot is bigger than what is on it.' },
  { id: 'good-water', name: 'Good water', cost: 2e12, effect: { allMult: 1.2 },
    need: { runEarned: 4e12 }, flavour: 'The stream runs clear enough to drink from.' },

  /* --- the trough --------------------------------------------------------- */
  /* One upgrade, and it takes the whole trough out: a day or night grower
     never makes less than its rated output again, and still makes half again
     as much at its best hour. Worth SWING/pi — about 16% — on everything
     marked day or night, forever. It was three upgrades in three slices, and
     three rows that each say "a bit less bad at night" are one row said
     slowly. */
  { id: 'night-bloom', name: 'Night bloom', cost: 1.5e6, effect: { steady: 0.5 },
    need: { owned: { id: 'mushroom', count: 5 } },
    flavour: 'Flowers that open at dusk, for the things that fly then.' },

  /* --- one per grower, at ten owned -------------------------------------- */
  /* Ten is off the simulation: a player buying whatever pays for itself
     soonest holds about ten of a tier within an hour of unlocking it, so the
     row lands while the tier still matters. */
  { id: 'damp-corners', name: 'Damp corners', cost: 300, effect: { grower: 'moss', mult: 2 },
    need: { owned: { id: 'moss', count: 10 } }, flavour: 'Where the wall meets the north side.' },
  { id: 'fiddleheads', name: 'Fiddleheads', cost: 3300, effect: { grower: 'fern', mult: 2 },
    need: { owned: { id: 'fern', count: 10 } }, flavour: 'Tight little spirals, and every one is a frond.' },
  { id: 'cleaned-glass', name: 'Cleaned glass', cost: 38000, effect: { grower: 'panel', mult: 2 },
    need: { owned: { id: 'panel', count: 10 } }, flavour: 'A cloth and an afternoon, for eleven percent.' },
  { id: 'second-queen', name: 'A second queen', cost: 425000, effect: { grower: 'hive', mult: 2 },
    need: { owned: { id: 'hive', count: 10 } }, flavour: 'Split the hive before it swarms and you keep both.' },
  { id: 'deeper-cellar', name: 'A deeper cellar', cost: 4.75e6, effect: { grower: 'mushroom', mult: 2 },
    need: { owned: { id: 'mushroom', count: 10 } }, flavour: 'Cold, dark and exactly damp enough.' },
  { id: 'grafted-stock', name: 'Grafted stock', cost: 5.25e7, effect: { grower: 'orchard', mult: 2 },
    need: { owned: { id: 'orchard', count: 10 } }, flavour: 'One root, four kinds of apple.' },
  { id: 'longer-blades', name: 'Longer blades', cost: 6e8, effect: { grower: 'turbine', mult: 2 },
    need: { owned: { id: 'turbine', count: 10 } }, flavour: 'Twice the sweep for the same tower.' },
  { id: 'double-glazing', name: 'Double glazing', cost: 6.75e9, effect: { grower: 'glasshouse', mult: 2 },
    need: { owned: { id: 'glasshouse', count: 10 } }, flavour: 'The night stops taking back what the day made.' },
  { id: 'higher-floors', name: 'Higher floors', cost: 7.5e10, effect: { grower: 'canopy', mult: 2 },
    need: { owned: { id: 'canopy', count: 10 } }, flavour: 'The lift goes up into the leaves.' },
];

export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map(u => [u.id, u]));

/* ------------------------------------------------------- the seed upgrades */

/* The tree of things a seed opens.
 *
 * Every upgrade above is bought with energy and lost at the next replant.
 * These are bought with energy and KEPT — through every replant, for good —
 * and what decides whether one is open to you at all is how many seeds you
 * have earned. That is the whole shape of it: the seed is the key and the
 * energy is the price, so a seed is never spent and never runs out, and the
 * row it opens still has to be earned inside a run.
 *
 * It is what makes the second run faster than the first, which this game
 * badly needed: a replant takes the lot back to bare ground while the next
 * seed wants four times the lifetime energy of the last one, so without
 * something carried across, every season is harder than the one before it and
 * the loop stops paying.
 *
 * `seed` is how many seeds must have been earned, and it doubles as the
 * order: one row a seed, so the first thing a player does with a new seed is
 * find out what it opened. `cost` is energy, and it is pitched at about a
 * third of the lifetime total that seed itself wanted — affordable inside the
 * run that earns it, and not so cheap that it buys itself.
 */
export const PRESTIGE = [
  { id: 'warm-earth', name: 'Warm earth', seed: 1, cost: 3e5, effect: { startEnergy: 500 },
    blurb: 'Every season begins with 500 energy in hand, so the first moss bed is already paid for.' },
  { id: 'deep-mulch', name: 'Deep mulch', seed: 2, cost: 1.2e6, effect: { allMult: 1.25 },
    blurb: 'Everything on the lot makes a quarter more, for good.' },
  { id: 'practised-hands', name: 'Practised hands', seed: 3, cost: 5e6, effect: { clickMult: 3 },
    blurb: 'A tap is worth three times as much, in every run from now on.' },
  { id: 'long-memory', name: 'Long memory', seed: 4, cost: 2e7, effect: { startEnergy: 50000 },
    blurb: 'Every season begins with 50,000 energy, which is most of a beehive.' },
  { id: 'night-watch', name: 'Night watch', seed: 5, cost: 8e7, effect: { steady: 0.5 },
    blurb: 'The off hours stop costing anything, in every run, without buying Night bloom again.' },
  { id: 'rich-soil', name: 'Rich soil', seed: 6, cost: 3e8, effect: { allMult: 1.5 },
    blurb: 'Everything makes half again as much, on top of everything else.' },
  { id: 'gleaners-share', name: "The gleaner's share", seed: 7, cost: 1.2e9, effect: { fingers: 0.05 },
    blurb: 'A tap also pays 5% of what the whole lot makes in a second, for good.' },
  { id: 'still-air', name: 'Still air', seed: 8, cost: 5e9, effect: { offlineRate: 1 },
    blurb: 'The lot works at its full rate while the tab is shut, instead of half.' },
  { id: 'long-sleep', name: 'Long sleep', seed: 9, cost: 2e10, effect: { offlineCap: 2 },
    blurb: 'Time away counts for a whole day instead of half of one.' },
  { id: 'old-growth', name: 'Old growth', seed: 10, cost: 8e10, effect: { allMult: 2 },
    blurb: 'Everything makes twice as much. The lot you come back to is a different lot.' },
  { id: 'heartwood', name: 'Heartwood', seed: 11, cost: 3e11, effect: { clickMult: 5 },
    blurb: 'A tap is worth five times as much again.' },
  { id: 'whole-valley', name: 'The whole valley', seed: 12, cost: 1.2e12, effect: { allMult: 2.5 },
    blurb: 'Everything makes two and a half times as much.' },
  { id: 'often-enough', name: 'Often enough', seed: 13, cost: 5e12, effect: { windfallEvery: 5 },
    blurb: 'A windfall every fifth tap instead of every tenth.' },
  { id: 'quick-hands', name: 'Quick hands', seed: 14, cost: 2e13, effect: { streakCap: 16 },
    blurb: 'A fast hand keeps paying up to sixteen taps a second instead of stopping at eight.' },
  { id: 'cheap-ground', name: 'Cheap ground', seed: 15, cost: 8e13, effect: { costGrowth: 0.02 },
    blurb: "Every grower's price climbs 13% a copy instead of 15%. By the fortieth one that is half the price." },
  { id: 'long-view', name: 'The long view', seed: 16, cost: 3.2e14, effect: { startEnergy: 5e6 },
    blurb: 'Every season starts with 5 million energy. The tree gathers energy in the winter for use in the spring.' },
  { id: 'thrift', name: 'Thrift', seed: 17, cost: 1.3e15, effect: { spendBack: 0.05 },
    blurb: '5% of everything you spend on growers comes straight back.' },
  { id: 'what-overwinters', name: 'Hardy stock', seed: 18, cost: 5.2e15, effect: { keepGrowers: 0.1 },
    blurb: 'A tenth of every kind lives through the season instead of going back to bare ground.' },
  { id: 'night-shift', name: 'Around the clock', seed: 19, cost: 2.1e16, effect: { alwaysOn: 0.75 },
    blurb: 'Every kind works as though the sun were always at its best, including the ones that never kept hours.' },
  { id: 'still-hands', name: 'Still hands', seed: 20, cost: 8.2e16, effect: { offlineTaps: true },
    blurb: 'Time away also pays for tapping, at the pace you have kept up this season.' },
  { id: 'the-reserve', name: 'The reserve', seed: 21, cost: 3.3e17, effect: { interest: 0.005 },
    blurb: 'Energy you are holding earns half a percent a second, up to what the lot itself makes.' },
  { id: 'half-price', name: 'Half price', seed: 22, cost: 1.3e18, effect: { upgradeCost: 0.5, needHalf: true },
    blurb: 'Every upgrade in the shop costs half what it says, and unlocks at half of what it asks for.' },
  { id: 'standing-start', name: 'A standing start', seed: 23, cost: 5.3e18, effect: { startGrowers: 5 },
    blurb: 'Every season begins with five of every kind already standing.' },
  { id: 'long-count', name: 'The long count', seed: 24, cost: 2.1e19, effect: { medalMult: 0.01 },
    blurb: 'Everything makes 1% more for every medal on the record.' },
  { id: 'many-hands', name: 'Many hands', seed: 25, cost: 8.4e19, effect: { varietyMult: 0.05 },
    blurb: 'Everything makes 5% more for every kind of grower standing on the lot.' },
  { id: 'deep-beds', name: 'Deep beds', seed: 26, cost: 3.4e20, effect: { deepBeds: 0.01 },
    blurb: 'Every kind makes 1% more for every ten of that kind standing. Forty moss beds is moss at 4% more.' },
  { id: 'by-the-crate', name: 'By the crate', seed: 27, cost: 1.4e21, effect: { crate: 0.2 },
    blurb: 'Buying ten or more of something at once costs a fifth less.' },
  { id: 'seed-drill', name: 'The seed drill', seed: 28, cost: 5.4e21, effect: { plantMult: 2 },
    blurb: 'Every grower you buy counts as two. You pay for one and two go in the ground.' },
  { id: 'running-start', name: 'A running start', seed: 29, cost: 2.2e22, effect: { startUpgrades: 0.5 },
    blurb: 'Every season begins with half the upgrades you had bought when the last one ended.' },
  { id: 'level-ground', name: 'The level ground', seed: 30, cost: 8.6e22, effect: { costCap: 100 },
    blurb: 'Past the hundredth of a kind, its price stops climbing. The hundred and first costs what the hundredth did.' },
  { id: 'volunteers', name: 'Volunteers', seed: 31, cost: 3.5e23, effect: { volunteers: 1000 },
    blurb: 'Every thousandth tap plants one more of every kind you already have, for free.' },
  { id: 'heavy-crop', name: 'The heavy crop', seed: 32, cost: 1.4e24, effect: { windfallAll: true },
    blurb: 'Every windfall also pays a whole second of what the lot makes, on top of the tap itself.' },
  { id: 'carry-over', name: 'Carry over', seed: 33, cost: 5.5e24, effect: { carryEnergy: 0.01 },
    blurb: 'Every season begins with one percent of what the season before it earned.' },
  { id: 'compound', name: 'Compound', seed: 34, cost: 2.2e25, effect: { interestCap: 3 },
    blurb: "The reserve's ceiling triples: energy in hand can earn up to three times what the lot makes." },
  { id: 'seed-for-seed', name: 'A seed for a seed', seed: 35, cost: 8.9e25, effect: { seedGain: 0.05 },
    blurb: 'Everything makes 5% more for every seed you have ever earned.' },
  { id: 'never-a-pause', name: 'Never a pause', seed: 36, cost: 3.5e26, effect: { streakFloor: 2 },
    blurb: 'Your hands never count as slower than two taps a second, even when they have stopped.' },
  { id: 'deep-sleep', name: 'Deep sleep', seed: 37, cost: 1.4e27, effect: { offlineRate: 1.5 },
    blurb: 'The lot works at 150% of its rate while the tab is shut.' },
  { id: 'practice', name: 'Practice', seed: 38, cost: 5.7e27, effect: { practice: 0.01 },
    blurb: 'Everything makes 1% more for every hundred taps this season, up to three times as much.' },
  { id: 'slow-season', name: 'The slow season', seed: 39, cost: 2.3e28, effect: { patience: 0.001 },
    blurb: 'Everything makes a tenth of a percent more for every minute this season has run, up to twice as much.' },
  { id: 'hundred-summers', name: 'A hundred summers', seed: 40, cost: 9.1e28, effect: { allMult: 8 },
    blurb: 'Everything makes eight times as much.' },
];

export const PRESTIGE_BY_ID = Object.fromEntries(PRESTIGE.map(u => [u.id, u]));

/* Past the written rows the ladder goes on by itself, one ring a season, for
 * ever. A written ladder ends, and the season's own toast says another row is
 * open every season — it has to be true on the four hundredth season as well
 * as on the thirteenth. A ring is what a tree puts on in a year, so it is the
 * honest thing to call them, and each is worth what the plainest written row
 * was worth: everything twice over.
 */
export const RING_FROM = PRESTIGE.length + 1;
/* Where the rings stop being rows at all. A save is a text file a person can
   edit, and `ring-999999999` used to make an allMult of Infinity, which the
   next tick turned into a lifetime total of Infinity, which `seedsFrom` walks
   towards for ever. Ten thousand seasons is past any play and inside every
   float. */
export const RING_LAST = RING_FROM + 10000;
export const RING_MULT = 2;
/* And each ring a little more than the one below it. A tail of identical rows
   is a tail that stops mattering: the seed above always costs four times the
   one below, so a flat multiplier means every season past the fortieth is
   worth less than the last. Two percent a ring is not enough to run away with
   and is enough for the ladder to still be climbing. */
export const RING_STEP = 1.02;
export const ringMult = n =>
  Number.isInteger(n) && n >= RING_FROM ? RING_MULT * Math.pow(RING_STEP, n - RING_FROM) : 0;

/* What a row costs: about three tenths of the lifetime energy its own seed
   wanted. Every written row is priced at that, and it is what makes a row
   affordable inside the season that opens it without it buying itself. Cut to
   two figures, because a price nobody can read is a price nobody can plan
   against. */
export const prestigeCost = n => {
  const raw = seedAt(n) * 0.3;
  if(!(raw > 0) || !Number.isFinite(raw)) return Infinity;
  const place = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / place) * place;
};

/* One object a ring, made once and kept. The page redraws the seeds tab while
   it is open, and a fresh object a row a frame is a garbage collector doing
   work nobody asked for. */
const RINGS = new Map();
export function ringFor(n){
  if(!Number.isInteger(n) || n < RING_FROM || n > RING_LAST) return null;
  if(!RINGS.has(n)){
    const mult = ringMult(n);
    // Two figures, and no trailing zeroes on a round one: "twice as much" and
    // "2.43 times as much" are both things a person can read.
    const said = mult.toFixed(2).replace(/\.?0+$/, '');
    RINGS.set(n, Object.freeze({
      id: 'ring-' + n, name: 'Ring ' + n, seed: n, cost: prestigeCost(n),
      effect: { allMult: mult },
      blurb: `Another ring of growth. Everything makes ${said} times as much.`,
    }));
  }
  return RINGS.get(n);
}

/* The row a given seed opens, written or grown. */
export const prestigeAt = n =>
  Number.isInteger(n) && n >= 1 ? (PRESTIGE[n - 1] || ringFor(n)) : null;

/* Every row up to and including seed `n`, which is what the page lists. Always
   at least the written ones, so the ladder still reads as a ladder on a save
   that has never had a seed. */
export const prestigeUpTo = n => {
  const top = Math.max(PRESTIGE.length, Number.isInteger(n) && n > 0 ? n : 0);
  const out = [];
  for(let i = 1; i <= top; i++) out.push(prestigeAt(i));
  return out;
};

/* By id, rings included. PRESTIGE_BY_ID above is the written map and stays
   exactly what it was, because it is exported and something reads it. */
export function prestigeById(id){
  if(PRESTIGE_BY_ID[id]) return PRESTIGE_BY_ID[id];
  const m = /^ring-(\d+)$/.exec(String(id));
  return m ? ringFor(Number(m[1])) : undefined;
}

/* Which of them this save has earned the seeds for. Ordered, because the tree
   is read as a ladder and a gap in it is the next thing to aim at. */
export const prestigeOffered = state =>
  prestigeUpTo(state.seeds).filter(u => u.seed <= state.seeds);

/* Why that one cannot be rooted, or null. */
export function rootRefusal(state, id){
  const up = prestigeById(id);
  if(!up) return 'There is no such upgrade.';
  if(state.rooted[id]) return 'You have that one already.';
  if(state.seeds < up.seed){
    const want = up.seed - state.seeds;
    return `Not yet — ${want} more seed${want === 1 ? '' : 's'} first.`;
  }
  if(state.light < up.cost) return `Not enough energy — ${formatEnergy(up.cost - state.light)} short.`;
  return null;
}

/* Root it: pay the energy and keep it forever. */
export function root(state, id){
  if(rootRefusal(state, id)) return null;
  const up = prestigeById(id);
  state.light -= up.cost;
  state.rooted[id] = true;
  score(state, 'spent', up.cost);
  return up;
}

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
  tapped: 'Energy from tapping',
  grown: 'Energy from growers',
  earned: 'Energy earned',
  spent: 'Energy spent',
  planted: 'Growers planted',
  studied: 'Upgrades bought',
  peakRate: 'Best energy per second',
  peakTaps: 'Best taps per second',
  /* The most that has ever been in hand at one moment, which is a different
     question from how much has ever been earned: earned only ever climbs, and
     held falls every time the shelf is visited. A player who has made a
     trillion and spent it on growers has a held figure of whatever the biggest
     pile was before they broke into it. */
  peakHeld: 'Most energy held at once',
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
  peakRate: 'Best e/s',
  peakTaps: 'Best t/s',
  peakHeld: 'Most held',
  seconds: 'Time',
};

export const STAT_KEYS = Object.keys(STAT_LABELS);

/* Which of them are a high-water mark rather than a running total. The adder
   and the save loader both read this, so there is one answer. */
export const PEAK_KEYS = ['peakRate', 'peakTaps', 'peakHeld'];

/* Which want a clock rendering rather than a number, and which are light. */
export const TIME_KEYS = ['seconds'];
export const ENERGY_KEYS = ['tapped', 'grown', 'earned', 'spent', 'peakRate', 'peakHeld'];
// The name it had when the resource was called light. Kept, so nothing that
// imported it stops resolving; the export list is a contract.
export const LIGHT_KEYS = ENERGY_KEYS;

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
  // The id is from when the resource was called light. It is in every save
  // that has ever tapped once, so the id stays and the name does not.
  { id: 'first-light', name: 'First tap', need: { taps: 1 },
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
  { id: 'one-of-each', name: 'Diversified', need: { kinds: GROWERS.length },
    blurb: 'One of every kind of grower at once.' },
  { id: 'fifty-moss', name: 'Ground cover', need: { owned: { id: 'moss', count: 50 } },
    blurb: 'Fifty moss beds. It started somewhere.' },
  { id: 'fifty-canopy', name: 'Skyline', need: { owned: { id: 'canopy', count: 50 } },
    blurb: 'Fifty canopy towers.' },

  { id: 'first-thousand', name: 'A thousand', need: { lifetime: 1000 },
    blurb: 'Earn a thousand energy.' },
  { id: 'first-million', name: 'A million', need: { lifetime: 1e6 },
    blurb: 'Earn a million energy.' },
  { id: 'first-billion', name: 'A billion', need: { lifetime: 1e9 },
    blurb: 'Earn a billion energy.' },
  { id: 'first-trillion', name: 'A trillion', need: { lifetime: 1e12 },
    blurb: 'Earn a trillion energy.' },
  { id: 'rate-thousand', name: 'Ticking over', need: { rate: 1000 },
    blurb: 'A thousand energy a second.' },
  { id: 'rate-million', name: 'Humming', need: { rate: 1e6 },
    blurb: 'A million energy a second.' },

  { id: 'ten-upgrades', name: 'Well read', need: { upgrades: 10 },
    blurb: 'Ten upgrades bought.' },
  // The id is from when there were forty-two upgrades and this took thirty.
  // It is in the saves of anyone who earned it, so the id stays and the
  // threshold does not — the same rule as 'first-light'.
  { id: 'thirty-upgrades', name: 'Studious', need: { upgrades: 15 },
    blurb: 'Fifteen upgrades bought.' },
  { id: 'every-upgrade', name: 'The whole shelf', need: { upgrades: UPGRADES.length },
    blurb: 'Every upgrade there is, in one run.' },

  /* One medal a seed. A replanting is a season the tree has stood through —
     the lot goes back to bare ground and the tree comes back a year older and
     drawn bigger — and it pays the one seed that opens the next rung of the
     tree of upgrades, so each of the first ten gets its own medal, named for
     the seed and saying what the tree gained that year.

     The ladder used to run to a hundred, which was reachable when seeds came
     off a cube root and a day of play paid fifty-five of them. A seed is a
     season now and the thresholds are four times apart, so the simulation
     reaches six in a day, thirteen in a week and fifteen in a month: the top
     rung is forty, and it is meant to be a long way off rather than a joke.
     The ids are untouched wherever the number they name still holds, because
     a medal is a record and a record you lose to a rename is not one. */
  { id: 'first-seed', name: 'First seed', need: { seeds: 1 },
    blurb: 'One season. The tree comes back stouter, with its roots showing.' },
  { id: 'second-winter', name: 'Second seed', need: { seeds: 2 },
    blurb: 'Two seasons. The trunk forks low.' },
  { id: 'third-winter', name: 'Third seed', need: { seeds: 3 },
    blurb: 'Three seasons. A knot hole, and moss on the shaded side.' },
  { id: 'fourth-winter', name: 'Fourth seed', need: { seeds: 4 },
    blurb: 'Four seasons. The crown spreads wider than it is tall, and somebody has hung a swing.' },
  { id: 'five-seeds', name: 'Fifth seed', need: { seeds: 5 },
    blurb: 'Five seasons. Buttress roots, and blossom in the canopy.' },
  { id: 'sixth-winter', name: 'Sixth seed', need: { seeds: 6 },
    blurb: 'Six seasons. Lanterns in the low branches, and a bench underneath.' },
  { id: 'seventh-winter', name: 'Seventh seed', need: { seeds: 7 },
    blurb: 'Seven seasons. The trunk splits in two and the crown reaches the top of the picture.' },
  { id: 'eighth-winter', name: 'Eighth seed', need: { seeds: 8 },
    blurb: 'Eight seasons. The trunk grows broader.' },
  { id: 'ninth-winter', name: 'Ninth seed', need: { seeds: 9 },
    blurb: 'Nine seasons. Another season, another ring of growth!' },
  { id: 'tenth-winter', name: 'Tenth seed', need: { seeds: 10 },
    blurb: 'Ten seasons stood through.' },
  { id: 'twelve-seeds', name: 'Twelve seeds', need: { seeds: 12 },
    blurb: 'Twelve seasons stood through.' },
  { id: 'fifteen-winters', name: 'Fifteen seeds', need: { seeds: 15 },
    blurb: 'Fifteen seasons stood through.' },
  { id: 'twenty-winters', name: 'Twenty seeds', need: { seeds: 20 },
    blurb: 'Twenty seasons stood through.' },
  { id: 'twenty-five-seeds', name: 'Twenty-five seeds', need: { seeds: 25 },
    blurb: 'Twenty-five seasons stood through.' },
  { id: 'thirty-winters', name: 'Thirty seeds', need: { seeds: 30 },
    blurb: 'Thirty seasons stood through.' },
  { id: 'hundred-seeds', name: 'Seed bank', need: { seeds: 40 },
    blurb: 'A tree older than most humans. It\'s truly a marvel.' },
  /* These two have nothing to say that the rungs below have not said already.
     They are here because they are in the deployed table and somebody may hold
     them, and `fromSave` drops a medal whose id it does not know: delete the
     row and you delete the record of it off a real save. The counts are the
     ones they were won at, read as seasons rather than as winters, which is
     the same number. */
  { id: 'fifty-winters', name: 'Fifty seeds', need: { seeds: 50 },
    blurb: 'Fifty seasons stood through.' },
  { id: 'hundred-winters', name: 'A hundred seeds', need: { seeds: 100 },
    blurb: 'A hundred seasons stood through.' },
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

/* How many growers are standing right now. */
export const growerCount = state =>
  GROWER_IDS.reduce((n, id) => n + (state.owned[id] || 0), 0);

/* The most that have ever stood at once, which is what the tree is drawn from
 * rather than the ones standing now. A season takes the lot back to bare
 * ground — the energy is spent and the shelf is empty, and that is the point
 * of it — but the tree is the one thing on the lot that a year of growth is
 * meant to make bigger, and a tree that came back a sapling every year would
 * say the opposite. Never cleared, by a season or by anything else.
 */
export function markGrown(state){
  const n = growerCount(state);
  if(n > (state.grown || 0)) state.grown = n;
  return state.grown;
}

export function newGame(){
  return {
    version: SAVE_VERSION,
    light: 0,            // energy in hand. Named `light` in every save since day one
    elapsed: DAY_START,  // seconds into this run; the sky reads from it
    owned: freshOwned(),
    earnedBy: freshOwned(),  // energy each kind has made this run, for the table
    bought: {},          // upgrade id -> true, this run
    grown: 0,            // most growers ever standing at once; the tree's drawn size
    rooted: {},          // seed upgrade id -> true, forever, through every replant
    medals: {},          // achievement id -> true, forever
    seeds: 0,            // banked at the last reset
    pending: 0,          // seeds this run would pay if you reset now
    prestiges: 0,
    session: blankStats(),
    run: blankStats(),
    life: blankStats(),
    log: [],
    history: freshHistory(),
    /* Elapsed at the last history sample, and it starts where `elapsed` does.
       At zero, with elapsed already at DAY_START, the page's catch-up loop had
       forty seconds of absence to make up before it had even drawn a frame and
       spent twenty-one of the graph's three hundred points on copies of the
       same moment. */
    sampledAt: DAY_START,
    decade: 0,           // biggest power of ten of lifetime energy already logged
  };
}

/* ------------------------------------------------------------ the bonuses */

/* Every multiplier in the game, folded out of the upgrades once. Called from
 * the tick and from every shop row that wants to show what a purchase would
 * do, so it is a fold over at most twenty booleans and nothing more expensive than that.
 */
export function bonuses(state){
  const out = {
    clickMult: 1,
    streak: 0,
    windfall: 1,
    allMult: 1,
    fingers: 0,
    swing: SWING,
    lift: 0,
    grower: Object.fromEntries(GROWER_IDS.map(id => [id, 1])),
    seedMult: seedBonus(state.seeds),
    // What the seed upgrades add on top of the run's own.
    startEnergy: 0,
    offlineRate: OFFLINE_RATE,
    offlineCap: OFFLINE_CAP,
    /* The rest of what a seed row can move. Every one of these is a default
       meaning "nothing bought", so a lot with an empty `rooted` folds to
       exactly the game as it was before any of them existed. */
    windfallEvery: WINDFALL_EVERY,  // smallest wins: sooner is kinder
    streakCap: STREAK_CAP,          // largest wins
    streakFloor: 0,                 // what your hands count as at rest
    costGrowth: COST_GROWTH,        // how fast a grower's price climbs
    spendBack: 0,                   // share of grower spending handed back
    keepGrowers: 0,                 // share of each kind kept through a season
    startGrowers: 0,                // of each kind, standing at the start of one
    alwaysOn: 0,                    // how far above its rate a held lot works
    offlineTaps: false,             // time away pays for the hands too
    upgradeCost: 1,                 // what the shop charges, as a share
    interest: 0,                    // what energy in hand earns a second
    interestCap: 1,                 // how many lot-seconds that may reach
    deepBeds: 0,                    // per ten of a kind standing
    crate: 0,                       // taken off a buy of ten or more
    costCap: Infinity,              // the copy past which a price stops climbing
    plantMult: 1,                   // how many go in for each one paid for
    startUpgrades: 0,               // cheapest shop rows bought at a season's start
    needHalf: false,                // shop rows unlock at half what they ask
    volunteers: 0,                  // one free grower every this many taps
    windfallAll: false,             // a windfall pays the lot as well as the hand
    carryEnergy: 0,                 // share of last season's earnings, carried
  };

  /* The seed upgrades first, and through the same keys as the run's own, so
     that a multiplier is a multiplier wherever it was bought and nothing
     downstream has to know which shelf a bonus came off. */
  for(const id of Object.keys(state.rooted || {})){
    const up = prestigeById(id);
    if(!up || !state.rooted[id]) continue;
    const e = up.effect;
    if(e.clickMult) out.clickMult *= e.clickMult;
    if(e.allMult) out.allMult *= e.allMult;
    if(e.fingers) out.fingers += e.fingers;
    if(e.streak) out.streak += e.streak;
    if(e.windfall) out.windfall *= e.windfall;
    if(e.steady) out.lift = Math.min(out.swing, out.lift + e.steady);
    if(e.grower && out.grower[e.grower] !== undefined) out.grower[e.grower] *= e.mult;
    // Sooner, faster, cheaper: whichever bought row is kindest wins, rather
    // than whichever happened to be folded last.
    if(e.windfallEvery) out.windfallEvery = Math.min(out.windfallEvery, e.windfallEvery);
    if(e.streakCap) out.streakCap = Math.max(out.streakCap, e.streakCap);
    if(e.streakFloor) out.streakFloor = Math.max(out.streakFloor, e.streakFloor);
    if(e.costGrowth) out.costGrowth = Math.max(1.01, out.costGrowth - e.costGrowth);
    if(e.spendBack) out.spendBack = Math.min(0.9, out.spendBack + e.spendBack);
    if(e.keepGrowers) out.keepGrowers = Math.max(out.keepGrowers, e.keepGrowers);
    if(e.startGrowers) out.startGrowers = Math.max(out.startGrowers, e.startGrowers);
    if(e.alwaysOn) out.alwaysOn = Math.max(out.alwaysOn, e.alwaysOn);
    if(e.offlineTaps) out.offlineTaps = true;
    if(e.upgradeCost) out.upgradeCost = Math.min(out.upgradeCost, e.upgradeCost);
    if(e.interest) out.interest = Math.max(out.interest, e.interest);
    if(e.interestCap) out.interestCap = Math.max(out.interestCap, e.interestCap);
    if(e.deepBeds) out.deepBeds += e.deepBeds;
    if(e.crate) out.crate = Math.min(0.9, out.crate + e.crate);
    if(e.costCap) out.costCap = Math.min(out.costCap, e.costCap);
    if(e.plantMult) out.plantMult = Math.max(out.plantMult, e.plantMult);
    if(e.startUpgrades) out.startUpgrades = Math.max(out.startUpgrades, e.startUpgrades);
    if(e.needHalf) out.needHalf = true;
    if(e.volunteers) out.volunteers = out.volunteers ? Math.min(out.volunteers, e.volunteers) : e.volunteers;
    if(e.windfallAll) out.windfallAll = true;
    if(e.carryEnergy) out.carryEnergy = Math.max(out.carryEnergy, e.carryEnergy);
    // Begin each run with this much: the biggest one wins rather than the sum,
    // because they are the same promise made larger and not two promises.
    if(e.startEnergy) out.startEnergy = Math.max(out.startEnergy, e.startEnergy);
    if(e.offlineRate) out.offlineRate = Math.max(out.offlineRate, e.offlineRate);
    if(e.offlineCap) out.offlineCap *= e.offlineCap;
  }

  for(const id of Object.keys(state.bought)){
    const up = UPGRADE_BY_ID[id];
    // An unknown id is an upgrade deleted from the table while somebody's save
    // still names it. Ignore rather than throw: a stale save is not a crash.
    if(!up || !state.bought[id]) continue;
    const e = up.effect;
    if(e.clickMult) out.clickMult *= e.clickMult;
    if(e.streak) out.streak += e.streak;
    if(e.windfall) out.windfall *= e.windfall;
    if(e.allMult) out.allMult *= e.allMult;
    if(e.fingers) out.fingers += e.fingers;
    if(e.steady) out.lift = Math.min(out.swing, out.lift + e.steady);
    if(e.grower && out.grower[e.grower] !== undefined) out.grower[e.grower] *= e.mult;
  }

  /* Last, the five that are not a fixed number but a count of something the
   * save is already keeping: medals won, kinds standing, seeds earned, and how
   * hard and how long this season has been worked. They fold into `allMult`,
   * because that is the key every rate and every tap already reads, and the
   * two that grow without bound as a season runs are capped — a tab left open
   * for a week should not be worth a thousand times one left open for an hour.
   */
  const rows = state.rooted || {};
  for(const id of Object.keys(rows)){
    const up = prestigeById(id);
    if(!up || !rows[id]) continue;
    const e = up.effect;
    if(e.medalMult) out.allMult *= 1 + e.medalMult * Object.keys(state.medals || {}).length;
    if(e.varietyMult){
      let kinds = 0;
      for(const g of GROWER_IDS) if(state.owned[g] > 0) kinds++;
      out.allMult *= 1 + e.varietyMult * kinds;
    }
    if(e.seedGain) out.allMult *= 1 + e.seedGain * Math.max(0, state.seeds);
    if(e.practice) out.allMult *= Math.min(3, 1 + e.practice * Math.floor(Math.max(0, state.run.taps) / 100));
    if(e.patience) out.allMult *= Math.min(2, 1 + e.patience * Math.max(0, state.run.seconds) / 60);
  }
  return out;
}

/* Seeds used to pay two percent each simply for being held, and that is over.
   A seed is what opens a row of the prestige tree now, and the power is in
   the row — which is the difference between a number going up on its own and
   a decision. The two exports stay because removing an export from this file
   is how a save or a page stops loading; they answer "nothing" now. */
export const SEED_RATE = 0;
export const seedBonus = () => 1;

/* How much a grower's phase is worth right now: 1 at the equinox points, up to
   1 + swing at its best hour, and down to 1 - (swing - lift) at its worst. An
   `any` grower ignores the sky entirely.

   `lift` is what the steady upgrade has bought, and it only applies on the
   way down. That asymmetry is the whole value of them: the peak is untouched,
   the trough comes up, and the area under the day goes with it. */
export function phaseFactor(phase, at, swing = SWING, lift = 0, always = 0){
  /* Around the clock does not flatten the day — flattening it is worth exactly
     nothing, because the swing already averages to one and all a flat day does
     is take the peaks away with the troughs. It holds the whole lot at the top
     of the arc instead, all day and all night.

     Including the kinds that never kept hours. Left out, they would make it a
     row worth a fifth of a percent: the three biggest earners on the lot —
     turbines, glasshouses, canopy towers — are all all-hours kinds, so a sky
     upgrade that skips them is a sky upgrade that skips the late game it is
     sold in. */
  if(always > 0) return 1 + always;
  if(phase === 'any') return 1;
  const h = sunHeight(dayPhase(at));
  const signed = phase === 'day' ? h : -h;
  return 1 + signed * (signed < 0 ? Math.max(0, swing - lift) : swing);
}

/* What a marked grower makes over a whole day, as a multiple of its rated
 * output.
 *
 * With nothing bought this is exactly 1 — the swing cancels, which is what
 * lets a shop row quote an average and be telling the truth. With `lift`
 * bought the negative half is shallower than the positive one and the day
 * comes out ahead by lift/pi: the mean of sin over half a cycle is 2/pi, each
 * half is half the day, and the two halves differ by `lift`, so the surplus is
 * (1/2)(lift)(2/pi). A sixth of a swing is worth about 5% forever.
 */
export const averageFactor = (phase, lift = 0, swing = SWING, always = 0) =>
  always > 0 ? 1 + always
    : phase === 'any' ? 1
    : 1 + Math.min(Math.max(0, lift), swing) / Math.PI;

/* What one kind is making per second, right now. */
export function rateOf(state, id, bonus = bonuses(state)){
  const g = GROWER_BY_ID[id];
  if(!g) return 0;
  const owned = state.owned[id] || 0;
  if(!owned) return 0;
  // Deep beds reads the count of THIS kind, which is why it lives here and
  // not in the fold: `bonuses` does not know which row is asking.
  const depth = bonus.deepBeds > 0 ? 1 + bonus.deepBeds * Math.floor(owned / 10) : 1;
  return owned * g.rate * bonus.grower[id] * bonus.allMult * bonus.seedMult * depth
    * phaseFactor(g.phase, state.elapsed, bonus.swing, bonus.lift, bonus.alwaysOn);
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
    // Through `averageFactor` rather than as a bare rate: once a steady
    // upgrade is bought the day really does come out ahead of the rated
    // number, and this figure is what pays for time away.
    const depth = bonus.deepBeds > 0 ? 1 + bonus.deepBeds * Math.floor(owned / 10) : 1;
    sum += owned * g.rate * bonus.grower[id] * bonus.allMult * bonus.seedMult * depth
      * averageFactor(g.phase, bonus.lift, bonus.swing, bonus.alwaysOn);
  }
  return sum;
}

/* What a tap is worth at rest. The base is one, and the garden lends the hand
   a slice of its own output once `fingers` is bought. This is the figure the
   record shows as "per tap": what the hand is worth before it starts moving. */
export function tapValue(state, bonus = bonuses(state)){
  const base = 1 * bonus.clickMult * bonus.allMult * bonus.seedMult;
  return base + bonus.fingers * totalRate(state, bonus);
}

/* Momentum is capped at eight taps a second. Past that the hand is not a hand,
   it is an autoclicker, and the cap is what keeps one from being the whole
   game: a script at forty a second is worth exactly what a flurry is. */
export const STREAK_CAP = 8;

/* How much more a tap is worth for the speed the hand is going: 1 with no
   Momentum, or at a standstill. */
export const momentum = (rate, bonus) =>
  1 + bonus.streak * Math.max(bonus.streakFloor || 0,
    Math.min(bonus.streakCap || STREAK_CAP, Math.max(0, rate || 0)));

/* Every tenth tap of the run is the windfall, once Windfall is bought. Counted
   off the run rather than off all time so that a replant starts the count
   again, and off a count rather than a die so that there is no randomness in
   here — the same tap is the tenth in the browser and in the test. */
export const WINDFALL_EVERY = 10;

export const isWindfall = (state, bonus = bonuses(state)) =>
  bonus.windfall > 1 && (state.run.taps + 1) % (bonus.windfallEvery || WINDFALL_EVERY) === 0;

/* What the NEXT tap will actually pay: the resting worth, times the momentum
   for the speed the hand is going, times the windfall if this is the tenth.
   `rate` is taps a second and comes from the page, which owns the clock. */
export function tapPays(state, rate = 0, bonus = bonuses(state)){
  const value = tapValue(state, bonus) * momentum(rate, bonus);
  if(!isWindfall(state, bonus)) return value;
  // The heavy crop: a windfall pays a second of the whole lot on top of the
  // hand's own share of it.
  return value * bonus.windfall + (bonus.windfallAll ? totalRate(state, bonus) : 0);
}

/* Which kinds a volunteer turns up as: one of every kind already standing,
 * and nothing at all of a kind that is not. Empty unless this tap is the one.
 *
 * It used to be the single cheapest kind, which is always the weakest — a moss
 * bed makes a tenth of a unit a second against a canopy tower's two hundred and
 * eighty thousand — so a rung costing 3.5e23 was handing out something worth a
 * billionth of the lot. One of each is worth having and still cannot conjure a
 * kind you have never planted.
 */
export function volunteerFor(state, bonus = bonuses(state)){
  if(!bonus.volunteers || state.run.taps % bonus.volunteers !== 0) return [];
  return GROWER_IDS.filter(id => (state.owned[id] || 0) > 0);
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
/* What a shop row asks for, halved if A quiet word is bought. Counts are cut
   and rounded up, so a row that wanted one of something still wants one. */
export function halfNeed(need, bonus){
  if(!bonus || !bonus.needHalf || !need) return need;
  const out = {};
  for(const [key, want] of Object.entries(need)){
    out[key] = key === 'owned'
      ? { id: want.id, count: Math.max(1, Math.ceil(want.count / 2)) }
      : Math.max(1, want / 2);
  }
  return out;
}

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
export function offered(state, snap = snapshot(state), bonus = bonuses(state)){
  return UPGRADES.filter(u => !state.bought[u.id] && meets(halfNeed(u.need, bonus), snap));
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

  /* The reserve, on what was in hand when the second started rather than on
     what the second itself made — otherwise a tick's own income earns interest
     in the same tick, and the number the row quotes is not the number it pays.
     Bounded by what the lot makes in the same second, so it is a second income
     and never a runaway one: without the bound it compounds, and a number that
     compounds without a ceiling stops being a game about planting things. */
  if(bonus.interest > 0 && state.light > 0){
    const earned = Math.min(state.light * bonus.interest,
      totalRate(state, bonus) * bonus.interestCap) * step;
    // Added to the running total only: the `score` calls below have not run
    // yet, and counting it here as well would put it on the record twice.
    if(earned > 0) gained += earned;
  }

  state.light += gained;
  state.elapsed += step;
  score(state, 'peakHeld', state.light);
  score(state, 'seconds', step);
  score(state, 'grown', gained);
  score(state, 'earned', gained);
  score(state, 'peakRate', totalRate(state, bonus));
  state.pending = pendingSeeds(state);
  return gained;
}

/* One tap. Returns what it paid, which is what the number that floats off the
 * tree is showing.
 *
 * `rate` is how fast the hand is going right now, which only the page can know
 * — it owns the clock and the list of tap times. It is passed in rather than
 * measured here because this module has no clock, and it is passed in at all
 * because "best taps per second" was a row on the record that nothing ever
 * wrote to: the medal for ten taps a second was being awarded while the
 * counter for the same thing sat at zero.
 */
export function tap(state, rate = 0){
  const bonus = bonuses(state);
  const value = tapPays(state, rate, bonus);
  state.light += value;
  score(state, 'peakHeld', state.light);
  score(state, 'taps', 1);
  score(state, 'tapped', value);
  score(state, 'earned', value);
  if(rate > 0) score(state, 'peakTaps', rate);
  /* Volunteers, counted after the tap so the thousandth tap is the thousandth
     tap. Free in every sense: nothing is deducted and nothing is recorded as
     spent, because nothing was. */
  const free = volunteerFor(state, bonus);
  if(free.length){
    for(const id of free) state.owned[id] = (state.owned[id] || 0) + 1;
    score(state, 'planted', free.length);
    markGrown(state);
  }
  state.pending = pendingSeeds(state);
  return value;
}

/* Why you cannot plant that, or null. A reason string rather than a boolean,
   the way the other games do it, so the shop row and the click handler cannot
   disagree about what is wrong — the row prints exactly what the handler
   refused with. */
export function plantRefusal(state, id, count = 1, bonus = bonuses(state)){
  const g = GROWER_BY_ID[id];
  if(!g) return 'There is no such grower.';
  if(!Number.isInteger(count) || count < 1) return 'One at a time, at least.';
  const owned = state.owned[id] || 0;
  const cost = bulkCost(g, owned, count, bonus.costGrowth, bonus.crate, bonus.costCap);
  if(state.light < cost) return `Not enough energy — ${formatEnergy(cost - state.light)} short.`;
  return null;
}

/* Plant them. Returns the cost, or null if it was refused and nothing changed. */
export function plant(state, id, count = 1){
  const bonus = bonuses(state);
  if(plantRefusal(state, id, count, bonus)) return null;
  const g = GROWER_BY_ID[id];
  const cost = bulkCost(g, state.owned[id] || 0, count, bonus.costGrowth, bonus.crate, bonus.costCap);
  state.light -= cost;
  // The seed drill puts in more than you paid for. The price was already
  // settled above, so the extra is free in every sense.
  state.owned[id] = (state.owned[id] || 0) + count * bonus.plantMult;
  /* Thrift hands part of it straight back. Counted as spent all the same: the
     record is what the lot cost you, and a rebate is not an unspent pound. */
  if(bonus.spendBack > 0) state.light += cost * bonus.spendBack;
  score(state, 'spent', cost);
  score(state, 'planted', count);
  // Here rather than at the call site: this is the only function in the game
  // that raises a grower count, so this is the only place the tree's size can
  // go stale, and a page that forgot to say so would shrink it at the next
  // season without anything failing.
  markGrown(state);
  return cost;
}

/* What the shop is actually charging for one, which is its printed price
   unless Half price is bought. */
export const upgradeCost = (up, bonus) =>
  Math.ceil(up.cost * (bonus ? bonus.upgradeCost : 1));

export function studyRefusal(state, id, bonus = bonuses(state)){
  const up = UPGRADE_BY_ID[id];
  if(!up) return 'There is no such upgrade.';
  if(state.bought[id]) return 'You have that already.';
  if(!meets(halfNeed(up.need, bonus), snapshot(state))) return 'Not yet.';
  const cost = upgradeCost(up, bonus);
  if(state.light < cost) return `Not enough energy — ${formatEnergy(cost - state.light)} short.`;
  return null;
}

export function study(state, id){
  const bonus = bonuses(state);
  if(studyRefusal(state, id, bonus)) return null;
  const up = UPGRADE_BY_ID[id];
  const cost = upgradeCost(up, bonus);
  state.light -= cost;
  state.bought[id] = true;
  score(state, 'spent', cost);
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

/* The first seed wants a million energy, all told, and every seed after it
 * wants four times what the one before it did. Exponential rather than the
 * cube root this started with, and the difference is the whole feel of the
 * game: a root curve hands out fifty-five seeds in a day and makes each one
 * worth almost nothing, where four times a seed hands out ten in the first
 * day and a dozen more over the following fortnight, so a seed is an event.
 *
 * Measured against LIFETIME energy, which no replant ever clears. You do not
 * re-earn what you had; you have to add three times it again, from a lot that
 * has just gone back to bare ground. That is what the tree of upgrades is for.
 */
export const SEED_RATIO = 4;

/* The lifetime total the nth seed wants. Seed zero wants nothing. */
export const seedAt = n => n < 1 ? 0 : SEED_SCALE * Math.pow(SEED_RATIO, n - 1);

export const seedsFrom = lifetime => {
  if(!Number.isFinite(lifetime) || !(lifetime >= SEED_SCALE)) return 0;
  // Counted with a logarithm rather than a loop, and then walked back onto the
  // exact threshold: at 4^25 a float has drifted far enough that the log alone
  // can say a seed is earned a hair before seedAt() agrees, and the bar on the
  // page would sit at a hundred percent with the button still refusing.
  let n = Math.floor(Math.log(lifetime / SEED_SCALE) / Math.log(SEED_RATIO)) + 1;
  while(n > 0 && seedAt(n) > lifetime) n--;
  while(seedAt(n + 1) <= lifetime) n++;
  return n;
};

/* Only ever one. A replant is one season and one season is one seed, so
   crossing three thresholds before you get round to replanting still pays
   one — and with the thresholds four times apart, crossing two at once is
   already a thing you have to work at. */
export const SEEDS_PER_REPLANT = 1;

export const pendingSeeds = state =>
  Math.min(SEEDS_PER_REPLANT, Math.max(0, seedsFrom(state.life.earned) - state.seeds));

/* What lifetime total the next seed wants, so the panel can show a bar rather
   than a number that sits still for an hour. */
export const energyForSeeds = seeds => seedAt(seeds);
export const lightForSeeds = energyForSeeds;   // the old name, kept

export function prestigeRefusal(state){
  if(pendingSeeds(state) < 1){
    const want = energyForSeeds(state.seeds + 1);
    return `Not yet — ${formatEnergy(want - state.life.earned)} more energy, all told.`;
  }
  return null;
}

/* How many seasons the tree has stood through, which is how many times the
   lot has been replanted, which is how many seeds have been earned — one
   number wearing three names until now, and one name from here. The art reads
   it to decide how old a tree to draw, the tree of upgrades reads it to decide
   which rungs are open, and the medals count it. */
export const seedsEarned = state => state.seeds;

/* What this was called while a season and a seed were two different things.
   Kept because removing an export is how a page stops loading. */
export const winters = seedsEarned;

/* The medal a given seed wins, or null if that seed is not one of the rungs.
   One lookup into the ladder, so that whatever wants to know what a seed is
   worth reads the table the award reads rather than a copy of it.

   The guard is not decoration: `find` on an undefined count matches the first
   medal with no `seeds` in its need at all, which is the one for tapping the
   tree once — so a missing argument would have promised "First tap". */
export const seedMedal = count =>
  Number.isInteger(count) && count > 0
    ? ACHIEVEMENTS.find(a => a.need.seeds === count) || null
    : null;

/* The name it had while a season was a winter. */
export const winterMedal = seedMedal;

/* Give the lot back. Keeps the seeds, the seed upgrades, the medals, the
 * lifetime record and the sitting; everything else starts again. Returns how
 * many seeds it paid, which is always one.
 *
 * This is a season. The tree stands through it and comes back a year older,
 * which is the one thing on the lot that a replanting makes bigger rather
 * than smaller, and the reason the word for it on the page is not "reset".
 */
export function prestige(state){
  if(prestigeRefusal(state)) return null;
  const won = pendingSeeds(state);
  state.seeds += won;
  state.pending = 0;
  // Kept in step with the seeds, and kept at all only because it is in every
  // save ever written. One replant is one season is one seed.
  state.prestiges = state.seeds;
  // The head start a seed upgrade bought, if any: read before the run is
  // cleared, since it is the seed upgrades that carry it and those stay.
  const bonus = bonuses(state);
  /* Carry over is added to the flat head start rather than compared with it:
     one is a floor and the other is a share of the season you just finished,
     and they are answers to different questions. */
  state.light = bonus.startEnergy + Math.max(0, state.run.earned) * bonus.carryEnergy;
  state.elapsed = DAY_START;
  /* Bare ground, unless a seed row says otherwise. What overwinters keeps a
     share of what was standing; A standing start plants a flat number of each
     kind. They are two answers to the same question, so the kinder one wins
     rather than both applying. */
  const before = { ...state.owned };
  state.owned = freshOwned();
  if(bonus.keepGrowers > 0 || bonus.startGrowers > 0){
    for(const id of GROWER_IDS){
      const kept = Math.floor((before[id] || 0) * bonus.keepGrowers);
      state.owned[id] = Math.max(kept, Math.floor(bonus.startGrowers));
    }
  }
  state.earnedBy = freshOwned();
  const had = Object.keys(state.bought);
  state.bought = {};
  /* A running start keeps half of what you had, cheapest first. A share of
     your own shelf rather than a fixed few: five of the cheapest came to four
     thousand four hundred energy all told, dropped into a season that already
     opens with five million from The long view, so the rung was worth the
     second it saved you. Read from `had` above, because `state.bought` was
     emptied a moment ago. */
  if(bonus.startUpgrades > 0){
    const kept = had
      .map(id => UPGRADE_BY_ID[id]).filter(Boolean)
      .sort((a, b) => a.cost - b.cost)
      .slice(0, Math.floor(had.length * bonus.startUpgrades));
    for(const up of kept) state.bought[up.id] = true;
  }
  // state.rooted is deliberately not touched. It is the only thing besides the
  // record that survives a replant, and it is the reason the next run is
  // quicker than the last.
  state.run = blankStats();
  state.log = [];
  state.history = freshHistory();
  state.sampledAt = state.elapsed;
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
  const bonus = bonuses(state);
  const cap = bonus.offlineCap;
  const away = Math.max(0, Math.min(seconds, cap));
  let light = steadyRate(state, bonus) * bonus.offlineRate * away;
  /* Still hands pays for the tapping as well, at the rate you have actually
     been tapping this season — taps over seconds, not your best burst, because
     a line that pays a whole night at your fastest ten seconds is a line that
     rewards putting the lid down. Nothing is owed on a season with no seconds
     in it yet. */
  if(bonus.offlineTaps && state.run.seconds > 0){
    const hand = Math.min(bonus.streakCap, state.run.taps / state.run.seconds);
    if(hand > 0){
      /* The ordinary value of a tap, plus the windfall's share of a long run of
         them. Going through `tapPays` paid the whole absence at the windfall
         rate, or at none of it, depending on where the run's tap counter
         happened to be sitting when the lid came down — the same night away
         worth ten times as much for having stopped one tap earlier. */
      const each = tapValue(state, bonus) * momentum(hand, bonus);
      const every = bonus.windfallEvery || WINDFALL_EVERY;
      const share = bonus.windfall > 1 ? (bonus.windfall - 1) / every : 0;
      const extra = bonus.windfallAll ? totalRate(state, bonus) / every : 0;
      light += (each * (1 + share) + extra) * hand * away;
    }
  }
  return { seconds: away, capped: seconds > cap, light };
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
        /* The same shape as `steadyRate`, which is what `share` below is: a
           split that leaves out the depth bonus or the day's average hands one
           kind another kind's earnings in the breakdown table. */
        const depth = bonus.deepBeds > 0 ? 1 + bonus.deepBeds * Math.floor(owned / 10) : 1;
        const mine = owned * g.rate * bonus.grower[id] * bonus.allMult * bonus.seedMult * depth
          * averageFactor(g.phase, bonus.lift, bonus.swing, bonus.alwaysOn);
        state.earnedBy[id] += gain.light * (mine / share);
      }
    }
    state.light += gain.light;
    score(state, 'peakHeld', state.light);
    score(state, 'grown', gain.light);
    score(state, 'earned', gain.light);
  }
  state.elapsed += Math.max(0, seconds);

  /* The graph is ten minutes of contiguous game time, and an absence is a hole
   * in it. Two things went wrong when this was left to the caller. The page
   * walked the whole gap in two-second steps to catch the sample clock up —
   * 300,000 iterations for a week away, a frozen tab for seconds before the
   * first frame — and every one of those samples recorded the live rate at the
   * moment of return, so a week away drew ten minutes of income that was never
   * earned at a rate that was never in effect.
   *
   * Starting the series again is the honest answer: the graph's left edge is
   * labelled with how far back it actually reaches, and it fills in live over
   * the next ten minutes.
   */
  if(seconds > HISTORY_STEP){
    state.history = freshHistory();
    state.sampledAt = state.elapsed;
  }

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
    grown: state.grown,
    rooted: { ...state.rooted },
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
  /* Seeds and replants are one number now, and in a save written before they
     were, they are two: seeds came off a cube root and could be a dozen from
     one replant, while `prestiges` counted the replants themselves. The
     replant count is the honest translation — one season, one seed — and it
     is also what the tree's age was already drawn from, so a returning lot
     comes back exactly as old as it went away. Nobody is docked for it: the
     seeds that go are the ones that used to pay two percent, and that bonus
     is gone for everybody. */
  const seeds = Math.max(0, Math.floor(num(raw.seeds)));
  const replants = Math.max(0, Math.floor(num(raw.prestiges)));
  state.seeds = raw.rooted === undefined && replants > 0 ? replants : seeds;
  state.prestiges = Math.max(state.seeds, replants);
  state.decade = Math.max(0, Math.floor(num(raw.decade)));

  for(const id of GROWER_IDS){
    state.owned[id] = Math.max(0, Math.floor(num(raw.owned?.[id])));
    state.earnedBy[id] = Math.max(0, num(raw.earnedBy?.[id]));
  }
  /* A save written before the tree stopped shrinking has no high-water mark,
     so the lot standing on it is the mark: the tree it is showing right now is
     the biggest it has been as far as this save knows. */
  state.grown = Math.max(0, Math.floor(num(raw.grown)), growerCount(state));

  for(const id of Object.keys(raw.bought || {})){
    if(UPGRADE_BY_ID[id] && raw.bought[id]) state.bought[id] = true;
  }
  for(const id of Object.keys(raw.rooted || {})){
    if(prestigeById(id) && raw.rooted[id]) state.rooted[id] = true;
  }
  for(const id of Object.keys(raw.medals || {})){
    if(ACHIEVEMENT_BY_ID[id] && raw.medals[id]) state.medals[id] = true;
  }
  for(const scope of ['run', 'life']){
    for(const key of STAT_KEYS) state[scope][key] = Math.max(0, num(raw[scope]?.[key]));
    /* Every save written before there was a "most held" has a zero in it, and
       a zero is a figure the board leaves off. What is in hand right now is
       the one thing the file proves about the pile — it was at least this big
       at least once — so the mark starts there rather than at nothing. */
    state[scope].peakHeld = Math.max(state[scope].peakHeld, state.light);
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

/* ------------------------------------------------------------ the code */

/* The lot lives in one browser's storage and nowhere else: there is no
 * account, no server copy, and a browser is allowed to throw its own storage
 * away. So the only backup anybody can have is one they carry themselves, and
 * this is it — the save file, as one long line of text.
 *
 * It is the save written out, not a second format: a tag saying what it is, the
 * JSON in base64url, and a checksum saying it arrived whole. The checksum is
 * not a lock. Anyone who wants to edit their own save is welcome to and always
 * could; what it catches is the paste that lost its last line, which would
 * otherwise decode into half a game and overwrite the real one.
 */
export const CODE_TAG = 'SUNWARD1';

/* Three refusals, and every one of them leaves the save on the device exactly
   where it was. An import that cannot say why it failed is an import that
   people retry until it eats something. */
export const CODE_EMPTY = 'Nothing in the box to load.';
export const CODE_ALIEN = "That doesn't look like a Sunward code.";
export const CODE_BROKEN = 'Some of that code is missing. Copy it again and paste the whole thing.';

/* FNV-1a, thirty-two bits, written in base 36 so it costs six characters. */
const checksum = text => {
  let h = 0x811c9dc5;
  for(let i = 0; i < text.length; i++){
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
};

/* base64url rather than base64, because a code goes through chat windows, URL
   bars and text files, and `+ / =` are the three characters those mangle. */
const toBase64 = text => {
  const bytes = new TextEncoder().encode(text);
  // A string built a byte at a time, because `String.fromCharCode(...bytes)`
  // is a spread of twenty thousand arguments and blows the call stack.
  let raw = '';
  for(let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64 = code => {
  const raw = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for(let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

export function encodeSave(save){
  const json = JSON.stringify(save);
  return `${CODE_TAG}.${toBase64(json)}.${checksum(json)}`;
}

/* Whitespace goes first: a code that has been through an email client arrives
   wrapped at seventy-two columns, and refusing that would be refusing a code
   that is perfectly intact. */
function readCode(code){
  const text = String(code == null ? '' : code).replace(/\s+/g, '');
  if(!text) return { error: CODE_EMPTY };

  /* Which of the two refusals it is turns on the tag alone. A code cut off
     halfway through a paste — far and away the likeliest thing to go wrong —
     has lost its checksum and so has the wrong number of parts, and telling
     somebody that their own save is not a Sunward code would send them looking
     for the wrong problem. */
  const parts = text.split('.');
  if(parts[0].toUpperCase() !== CODE_TAG) return { error: CODE_ALIEN };
  if(parts.length !== 3 || !parts[1] || !parts[2]) return { error: CODE_BROKEN };

  let json;
  try { json = fromBase64(parts[1]); }
  catch { return { error: CODE_BROKEN }; }
  if(checksum(json) !== parts[2].toLowerCase()) return { error: CODE_BROKEN };

  let save;
  try { save = JSON.parse(json); }
  catch { return { error: CODE_BROKEN }; }
  /* A save always carries its version. Something that checksums but has no
     version is not a save, and loading it would hand `fromSave` an object it
     would dutifully turn into a brand new game on top of a real one. */
  if(!save || typeof save !== 'object' || Array.isArray(save) || !Number.isFinite(Number(save.version))){
    return { error: CODE_ALIEN };
  }
  return { save };
}

/* The pair the rest of the game uses: why not, and what. Asking twice costs a
   base64 decode and buys the page a refusal it can print without having to
   know what any of the failures mean. */
export const codeRefusal = code => readCode(code).error || null;
export const decodeSave = code => readCode(code).save || null;

/* ---------------------------------------------------------------- reading */

/* Short scale, because that is what a clicker player already reads. Past
   decillion it gives up and goes to exponent notation rather than inventing
   names nobody knows — a number you cannot say out loud is a number that has
   stopped meaning anything, and by then the exponent is the interesting part. */
const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

export function formatEnergy(n){
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

  /* Rounding at the edge: 999,999.7 is tier 1 by the logarithm and would read
     as 1000.0K, which is a unit nobody uses. Carrying it is not as simple as
     one threshold, because how far it has to be from 1000 to be safe depends
     on how many decimals are about to be printed — at three digits and no
     decimals, anything from 999.5 up rounds to "1000". So the places are
     chosen first, the rounding is done, and the carry asks the rounded number
     rather than the raw one. A single 999.9995 cut got 999,500 wrong for a
     whole band below every suffix. */
  let places = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  if(Number(scaled.toFixed(places)) >= 1000){
    tier += 1;
    scaled = value / Math.pow(1000, tier);
    places = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  }
  if(tier >= SUFFIXES.length) return sign + value.toExponential(2).replace('e+', 'e');

  return sign + scaled.toFixed(places) + SUFFIXES[tier];
}

/* The name the formatter had when the resource was called light. */
export const formatLight = formatEnergy;

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
  if(ENERGY_KEYS.includes(key)) return formatEnergy(value);
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
