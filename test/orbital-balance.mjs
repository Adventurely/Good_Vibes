#!/usr/bin/env node
/* Not a test — a harness.
 *
 * It plays Orbital Trader the way a competent, unimaginative player would:
 * pick the best cargo on offer, aim at the port that pays most for it, fly
 * there, sell, refuel, repeat. Then it reports what the first few years look
 * like — money, time, fuel, and how long it takes to afford the things that
 * open the map.
 *
 * The point is to see the shape of the ladder rather than to pass or fail. A
 * loop that pays far better than every other loop is a loop everybody will
 * grind, which the design document is explicit about wanting to avoid.
 *
 *   node test/orbital-balance.mjs            # a few hundred days
 *   node test/orbital-balance.mjs 3600       # ten Tassel years
 *   node test/orbital-balance.mjs 3600 7     # ... with a different seed
 *
 * What it is not: a player. Its autopilot writes one mark, aims it, and flies;
 * it does not re-plan a spoiled approach, wait for a festival, or notice that
 * the comet is coming. Read its numbers as the floor a careless pilot would
 * find, not the ceiling a good one would.
 */

import * as S from '../public/orbital-trader/sim.js';
import { PORTS, GOODS, UPGRADES, CONST } from '../public/orbital-trader/content.js';
import { absState, dist } from '../public/orbital-trader/orbit.js';

const DAYS = Number(process.argv[2] ?? 720);
const SEED = Number(process.argv[3] ?? 5);
const world = S.world;

/* Which ports are worth considering from here: near enough that the aim will
 * find them, and open for business. */
function reachable(state, from){
  const here = absState(world, from, state.t).r;
  return Object.keys(PORTS).filter(id => {
    if(id === from || !S.portOpen(id, state.t)) return false;
    if(!PORTS[id].sells.length && !PORTS[id].buys.length) return false;
    return dist(here, absState(world, id, state.t).r) < 6;
  });
}

/* Roughly what a trip costs and takes, the way the Target tab puts it: the
 * slow road between the two orbits, plus the cost of getting out of whatever
 * you are in and stopping at the other end. Moons of the same planet are their
 * own small version of the same sum. */
function slowRoad(state, from, to){
  const a = world.get(from), b = world.get(to);
  if(a.parent === b.parent && a.parent !== 'lamp'){
    const mu = world.get(a.parent).mu;
    const h = S.hohmann(mu, a.a, b.a);
    return { dv: S.kms(h.total) + 1.5, days: h.time + 2 };
  }
  const r1 = Math.hypot(...absState(world, from, state.t).r);
  const r2 = Math.hypot(...absState(world, to, state.t).r);
  const h = S.hohmann(CONST.MU_LAMP, Math.max(r1, 1e-6), Math.max(r2, 1e-6));
  /* Climbing out of one world and stopping at the other, roughly — the same
     order as the table tools/orbital-trader/check-tuning.mjs prints, which is
     what a player would be reading off the Target tab. */
  return { dv: S.kms(h.total) * 1.15 + 1.5, days: h.time + 4 };
}

/* The best single cargo a player could buy here and sell there, at today's
 * prices, per unit of hold. Nothing spoils on the way any more, so what it is
 * worth on arrival is what it is worth on the dock — give or take the day's
 * haggle roll at an otter port. */
function bestRun(state, from){
  const room = S.freeUnits(state);
  let best = null;
  for(const to of reachable(state, from)){
    for(const row of PORTS[from].sells){
      const g = S.goodById(row.good);
      if(g.needsTempControl && !state.keys.tempControl) continue;
      const buy = S.buyPrice(state, from, g.id);
      const sell = S.sellPrice(state, to, g.id);
      const stock = S.stockAvailable(state, from, g.id);
      const qty = Math.min(stock, Math.floor(room / g.units), Math.floor(state.money / buy));
      if(qty <= 0) continue;
      const gain = (sell - buy) * qty;
      if(gain <= 0) continue;
      /* What the slow road costs and how long it takes, which is what the
         Target tab tells a player before they commit. A destination the tank
         cannot reach is not a destination. */
      const road = slowRoad(state, from, to);
      if(road.dv > S.kms(state.dv) * 0.7) continue;
      const landed = gain;
      const perDay = landed / road.days;
      if(!best || perDay > best.perDay) best = { to, good: g.id, qty, gain: landed, perDay, days: road.days, dv: road.dv, buy, sell };
    }
  }
  return best;
}

function fly(state, to, budgetDays){
  state.target = to;
  const t0 = state.t;
  for(let leg = 0; leg < 14; leg++){
    if(state.dockedAt === to) return true;
    if(state.dockedAt) S.undock(state);
    const aim = S.trimToTarget(state, to, 12000);
    if(!aim.ok) return false;
    if(S.planCost(state) > state.dv) return false;
    // Fly until the plan is spent and we are near, stopping if time runs out.
    let guard = 0;
    while(guard++ < 200000 && state.t - t0 < budgetDays){
      S.tick(state, 0.05);
      /* A card on the way is answered the way an unimaginative player answers
         it: the first button that is not greyed. A toll is paid in coin. */
      if(state.pending?.kind === 'encounter'){ S.resolveEncounter(state, state.pending.choices.findIndex(c => !c.disabled)); continue; }
      if(state.pending?.kind === 'toll'){ S.resolveToll(state, 'coin'); continue; }
      if(state.pending){ S.callTow(state, state.pending.kind === 'crash' ? 'crash' : 'dry'); break; }
      const st = S.dockingStatus(state);
      if(st && st.port === to){
        if(st.ok){ S.dock(state); return true; }
        if(st.inZone || (S.kiss(state)?.inMouth)){ if(S.brakeAtKiss(state) < 0 && st.inZone) break; }
      }
      if(!state.nodes.length && !st && state.dv <= 0){ S.callTow(state, 'dry'); break; }
    }
    if(state.t - t0 >= budgetDays) return false;
    if(state.dockedAt && state.dockedAt !== to) return false;   // towed somewhere else; take stock
  }
  return state.dockedAt === to;
}

const state = S.newGame(SEED);
/* A new ship is in orbit over Tassel, not tied up at it — the game has no
   landing and never starts at a mooring. This probe is about the price list
   rather than about flying, so it tows itself to the first dock rather than
   opening with a rendezvous: undock() puts the ship back in the harbour it
   just left, so one line here is the whole of it. Without it the loop below
   read `state.dockedAt` as null on its first pass and stopped before it
   started, which is why this file has been reporting nought runs.  */
state.dockedAt = CONST.START_PORT;
/* And with the opening errand behind it. A new purse is twelve cowries, which
   is one moon pebble and nothing else — the tutorial is what turns that into a
   working float, and a probe that starts before it has no trade to measure and
   waits at the dock for two years. */
state.money += S.questById('pebble')?.pay ?? 0;
const log = [];
let laps = 0, tows0 = 0;
const firsts = {};
const note = (what, cond) => { if(!firsts[what] && cond) firsts[what] = { t: state.t, money: state.money }; };

while(state.t < DAYS && laps < 400){
  const from = state.dockedAt;
  if(!from) break;
  // Top the tank up when it is cheap enough and low enough.
  const fp = S.fuelPrice(state);
  if(fp != null && (state.dv < state.tank * 0.6 || S.kms(state.dv) < 4)){
    S.refuel(state, Math.min(S.kms(state.tank - state.dv), Math.max(4, (state.money * 0.35) / fp)));
  }
  // Buy what a bigger ship would want, when it is affordable.
  for(const kind of ['hold', 'tank']){
    const next = S.tiers(kind)[state.tiers[kind] + 1];
    if(next && next.soldAt?.includes(from) && state.money > next.price * 1.8){
      S.buyUpgrade(state, next.id);
      note(`${kind} tier ${next.tier}`, true);
    }
  }
  for(const u of UPGRADES.filter(u => u.kind === 'key')){
    if(u.soldAt?.includes(from) && !S.ownsUpgrade(state, u) && state.money > u.price * 2){
      S.buyUpgrade(state, u.id);
      note(u.name, true);
    }
  }
  const run = bestRun(state, from);
  if(!run){ S.wait(state, 10); continue; }
  const before = state.money;
  S.buy(state, run.good, run.qty);
  const t0 = state.t;
  const ok = fly(state, run.to, Math.max(90, run.days * 4));
  if(!ok){
    // Adrift, or docked somewhere else: call a tow and sell wherever it lands,
    // which is what a player does when a plan has plainly gone wrong.
    if(!state.dockedAt) S.callTow(state, 'dry');
    if(state.dockedAt) S.sell(state, run.good, run.qty);
    log.push({ t: state.t, days: state.t - t0, from, to: run.to, good: run.good, qty: run.qty,
      profit: state.money - before, perDay: (state.money - before) / Math.max(1, state.t - t0),
      money: state.money, dv: S.kms(state.dv), tows: state.stats.tows - tows0, failed: true });
    tows0 = state.stats.tows;
    if(state.dockedAt) S.wait(state, 2); else break;
    continue;
  }
  const sold = S.sell(state, run.good, run.qty);
  laps++;
  log.push({
    t: state.t, days: state.t - t0, from, to: run.to, good: run.good, qty: run.qty,
    profit: state.money - before, perDay: (state.money - before) / Math.max(1, state.t - t0),
    money: state.money, dv: S.kms(state.dv), tows: state.stats.tows - tows0,
  });
  tows0 = state.stats.tows;
  note('1,000 cowries', state.money >= 1000);
  note('5,000 cowries', state.money >= 5000);
  note('20,000 cowries', state.money >= 20000);
  void sold;
}

const rows = log.filter(l => l.profit != null);
const fmt = n => Math.round(n).toLocaleString('en-GB');
console.log(`\nOrbital Trader — ${laps} runs over ${Math.round(state.t)} days (seed ${SEED})\n`);
console.log('  when     route                     cargo            days   profit   per day   purse');
for(const r of rows.slice(0, 40)){
  console.log(`  ${String(S.calendar(r.t).year) + '.' + String(S.calendar(r.t).day).padStart(3, '0')}  ${((r.failed ? '× ' : '') + S.portName(r.from) + ' → ' + S.portName(r.to)).padEnd(26)}${(r.qty + '× ' + S.goodById(r.good).name).padEnd(17)}${String(Math.round(r.days)).padStart(5)}${fmt(r.profit).padStart(9)}${fmt(r.perDay).padStart(10)}${fmt(r.money).padStart(8)}`);
}
if(rows.length > 40) console.log(`  … and ${rows.length - 40} more`);

const perDay = rows.map(r => r.perDay).sort((a, b) => a - b);
const median = perDay.length ? perDay[Math.floor(perDay.length / 2)] : 0;
const top = perDay.length ? perDay[perDay.length - 1] : 0;
console.log(`\n  purse at the end      ${fmt(state.money)} ${CONST.CURRENCY}${state.debt ? ` (owing ${fmt(state.debt)})` : ''}`);
console.log(`  profit per day        median ${fmt(median)}, best ${fmt(top)}  ${top > median * 4 ? '← one loop pays far better than the rest' : ''}`);
console.log(`  fuel burned           ${S.fmtKms(state.stats.dvSpent)} over ${state.stats.burns} burns`);
console.log(`  tows                  ${state.stats.tows}`);
console.log(`  ports visited         ${state.visited.length} of ${Object.keys(PORTS).length}: ${state.visited.map(S.portName).join(', ')}`);
console.log(`  fitted                ${['tank', 'hold'].map(k => `${k} ${state.tiers[k]}`).join(', ')}; keys: ${Object.entries(state.keys).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`);
console.log('\n  first time...');
for(const [what, at] of Object.entries(firsts)) console.log(`    ${what.padEnd(22)} ${S.calendar(at.t).text}`);
const unseen = Object.keys(PORTS).filter(p => !state.visited.includes(p));
if(unseen.length) console.log(`\n  never went to: ${unseen.map(S.portName).join(', ')}`);
console.log(`  goods never traded: ${GOODS.filter(g => !rows.some(r => r.good === g.id)).map(g => g.name).join(', ') || 'none'}`);
