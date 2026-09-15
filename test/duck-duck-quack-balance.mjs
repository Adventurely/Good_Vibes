/* Duck Duck Quack — does The Park actually hold up under different play?
 *
 * There is no randomness anywhere in this game (see sim.js's own header),
 * so this cannot be Good Vibes' balance.mjs, which plays the same table
 * size hundreds of times and reports a win rate: playing one strategy twice
 * here would print the same number twice. What varies instead is the
 * strategy itself — several different, honest models of how a player might
 * actually click through a run, from "assign everything the instant a
 * duckling hatches" to "wait until the last possible column" to "spend the
 * bare minimum and not one skill more" — each played once, all the way to
 * `ended`, with the outcome and the reason every lost duckling was lost.
 *
 * This is a harness, not a test: nothing here is asserted, only reported,
 * because "is this level winnable by a reasonable range of play" is a
 * judgement call over a printed table, not a pass/fail. The mechanic-level
 * tests in duck-duck-quack.test.js, and the one that plays a single bot to a
 * win, are the actual regression coverage; this is what a design change
 * gets pointed at before it ships.
 *
 *   node test/duck-duck-quack-balance.mjs
 */

import { LEVEL_1, SKILLS, TICK_RATE, winCount, formatTime } from '../public/duck-duck-quack/content.js';
import { newGame, tick, assignSkill, hasTrait } from '../public/duck-duck-quack/sim.js';

/* ------------------------------------------------------------ strategies --- */

/* Every strategy is a function called once a tick, before `tick()` itself,
 * with the live state and a small bag of memory it can keep between calls.
 * It looks at `state.ducks`, decides who if anyone gets a skill this tick,
 * and returns nothing — the harness reads `state.ended` afterwards.
 */

const STRATEGIES = {
  /* The point of the deferred-activation fix, and of letting a duckling hold
     more than one trait at once: nothing waits for a precise column, and
     nothing is one skill only. The first duckling gets every trait it could
     possibly need at hatch — builder for the gap, digger for the drop,
     climber for the wall between them — so it alone can clear all three
     hazards and bridge/ramp them permanently for the rest of the flock,
     which then only ever needs a climber. */
  atHatch(state, mem){
    mem.pathfinderGiven ??= false;
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!mem.pathfinderGiven){
        assignSkill(state, d.id, 'builder');
        assignSkill(state, d.id, 'digger');
        assignSkill(state, d.id, 'climber');
        mem.pathfinderGiven = true;
        continue;
      }
      if(!hasTrait(d, 'climber')) assignSkill(state, d.id, 'climber');
    }
  },

  /* The tightest correct timing: assigned on the exact column each hazard
     starts on. This is the bot the title screen and the shelf card play, and
     it has to keep winning — it is the one thing on this page that is also
     asserted, in duck-duck-quack.test.js. */
  atTheEdge(state, mem){
    mem.builderGiven ??= false;
    mem.diggerGiven ??= false;
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!mem.builderGiven && d.x === 69 && assignSkill(state, d.id, 'builder')){ mem.builderGiven = true; continue; }
      if(!mem.diggerGiven && d.x === 219 && assignSkill(state, d.id, 'digger')){ mem.diggerGiven = true; continue; }
      if(!hasTrait(d, 'climber') && d.x >= 130 && d.x < 150) assignSkill(state, d.id, 'climber');
    }
  },

  /* A slower reaction: climbers are only ever given in the last three
     columns before the wall rather than the whole plateau approach, and
     the gap/drop are handled at the last safe moment rather than the first. */
  justInTime(state, mem){
    mem.builderGiven ??= false;
    mem.diggerGiven ??= false;
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!mem.builderGiven && d.x === 69 && assignSkill(state, d.id, 'builder')){ mem.builderGiven = true; continue; }
      if(!mem.diggerGiven && d.x === 219 && assignSkill(state, d.id, 'digger')){ mem.diggerGiven = true; continue; }
      if(!hasTrait(d, 'climber') && d.x >= 147 && d.x < 150) assignSkill(state, d.id, 'climber');
    }
  },

  /* Spends exactly one builder, one digger, and stops handing out climbers
     the moment the quota (winCount) has been given out — never the spare
     the level's own supply carries. If The Park only wins with a climber to
     spare, this is the strategy that says so. */
  minimalSpend(state, mem){
    mem.builderGiven ??= false;
    mem.diggerGiven ??= false;
    mem.climbersGiven ??= 0;
    const need = winCount(LEVEL_1);
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!mem.builderGiven && d.x === 69 && assignSkill(state, d.id, 'builder')){ mem.builderGiven = true; continue; }
      if(!mem.diggerGiven && d.x === 219 && assignSkill(state, d.id, 'digger')){ mem.diggerGiven = true; continue; }
      if(mem.climbersGiven >= need) continue;
      if(!hasTrait(d, 'climber') && d.x >= 130 && d.x < 150){
        if(assignSkill(state, d.id, 'climber')) mem.climbersGiven += 1;
      }
    }
  },

  /* One fewer climber than the quota needs — the other side of the minimal-
     spend question: is 8 really the floor, or does the level actually want
     a spare? */
  climberShortOne(state, mem){
    mem.builderGiven ??= false;
    mem.diggerGiven ??= false;
    mem.climbersGiven ??= 0;
    const need = winCount(LEVEL_1) - 1;
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!mem.builderGiven && d.x === 69 && assignSkill(state, d.id, 'builder')){ mem.builderGiven = true; continue; }
      if(!mem.diggerGiven && d.x === 219 && assignSkill(state, d.id, 'digger')){ mem.diggerGiven = true; continue; }
      if(mem.climbersGiven >= need) continue;
      if(!hasTrait(d, 'climber') && d.x >= 130 && d.x < 150){
        if(assignSkill(state, d.id, 'climber')) mem.climbersGiven += 1;
      }
    }
  },

  /* Climbers for the wall, nothing for the gap or the drop — whether the
     other two hazards are really mandatory, not just the intended path. */
  climbersOnly(state){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!hasTrait(d, 'climber') && d.x >= 130 && d.x < 150) assignSkill(state, d.id, 'climber');
    }
  },

  /* A blocker planted just short of the gap, meant to hold the rest of the
     queue back while the first duckling's bridge goes in — the use of
     Blocker the design notes floated as optional. It costs every duckling
     behind it the run, since a blocker never moves again; the number this
     prints is that cost, not a recommendation. */
  blockerAtGap(state, mem){
    mem.builderGiven ??= false;
    mem.blockerGiven ??= false;
    mem.diggerGiven ??= false;
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!mem.builderGiven && d.x === 69 && assignSkill(state, d.id, 'builder')){ mem.builderGiven = true; continue; }
      if(mem.builderGiven && !mem.blockerGiven && d.x === 65 && assignSkill(state, d.id, 'blocker')){ mem.blockerGiven = true; continue; }
      if(!mem.diggerGiven && d.x === 219 && assignSkill(state, d.id, 'digger')){ mem.diggerGiven = true; continue; }
      if(!hasTrait(d, 'climber') && d.x >= 130 && d.x < 150) assignSkill(state, d.id, 'climber');
    }
  },

  /* The floor: nobody gets anything. Every duckling should fall in the same
     place, and none should be saved. */
  doNothing(){},
};

/* --------------------------------------------------------------- runner --- */

function play(strategy){
  const state = newGame(LEVEL_1);
  const mem = {};
  let ticks = 0;
  while(!state.ended && ticks < LEVEL_1.timeLimit){
    strategy(state, mem);
    tick(state);
    ticks += 1;
  }
  const causes = {};
  for(const d of state.ducks){
    if(d.state !== 'lost') continue;
    causes[d.cause] = (causes[d.cause] || 0) + 1;
  }
  return { state, ticks, causes };
}

/* ------------------------------------------------------------------ report --- */

const need = winCount(LEVEL_1);
console.log(`Duck Duck Quack — The Park, ${LEVEL_1.duckCount} ducklings, need ${need} saved, ` +
  `${formatTime(LEVEL_1.timeLimit)} on the clock, ${TICK_RATE} ticks/s\n`);
console.log(`assignSkill refuses quietly (returns null) rather than throwing, so a strategy that runs out ` +
  `of a supply or double-assigns a busy duckling will not crash here — it will just show up as a lower ` +
  `save count than the strategy intended, which is the point of running it rather than reading the code.\n`);

for(const [name, strategy] of Object.entries(STRATEGIES)){
  const { state, ticks, causes } = play(strategy);
  const verdict = state.ended === 'won' ? 'WON ' : state.ended === 'lost' ? 'lost' : 'ran out of tries';
  const causeText = Object.entries(causes).map(([c, n]) => `${c}:${n}`).join(' ') || 'none';
  console.log(
    `${name.padEnd(16)} ${verdict}  saved ${String(state.saved).padStart(2)}/${LEVEL_1.duckCount} ` +
    `(need ${need})  lost ${String(state.lost).padStart(2)} [${causeText}]  ` +
    `${formatTime(ticks)} of ${formatTime(LEVEL_1.timeLimit)}  ` +
    // Builder and Blocker share a first letter, so this abbreviates by verb
    // instead — dig/build/block/climb — to keep the readout unambiguous.
    `supply left: ${SKILLS.map(s => `${s.slice(0, 3)}${state.supply[s]}`).join(' ')}`,
  );
}
