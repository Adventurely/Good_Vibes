import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as O from '../public/orbital-trader/orbit.js';
import {
  CONST, BODIES, GOODS, PORTS, UPGRADES, FORMULAS, CONTRACT_TEMPLATES, TEXT, GLOSSARY, SPECIES, BELT_ROCKS,
} from '../public/orbital-trader/content.js';
import * as S from '../public/orbital-trader/sim.js';

/* Orbital Trader has no server: everything it knows is in public/ and is
 * imported here as the browser imports it. These tests are the gate that a
 * malformed body, an unreachable moon or a market that prints money cannot
 * get through — and the kernel is checked against a numerical integrator,
 * because "the maths looks right" is how orbit bugs ship.
 */

const MU = CONST.MU_LAMP;
const world = S.world;

/* ------------------------------------------------------------ kernel */

function rk4(mu, r0, v0, dt, steps){
  let r = [...r0], v = [...v0]; const h = dt / steps;
  const acc = r => { const n = Math.hypot(r[0], r[1]); const k = -mu / (n * n * n); return [k * r[0], k * r[1]]; };
  for(let i = 0; i < steps; i++){
    const k1v = acc(r), k1r = v;
    const r2 = [r[0] + h / 2 * k1r[0], r[1] + h / 2 * k1r[1]], v2 = [v[0] + h / 2 * k1v[0], v[1] + h / 2 * k1v[1]];
    const k2v = acc(r2), k2r = v2;
    const r3 = [r[0] + h / 2 * k2r[0], r[1] + h / 2 * k2r[1]], v3 = [v[0] + h / 2 * k2v[0], v[1] + h / 2 * k2v[1]];
    const k3v = acc(r3), k3r = v3;
    const r4 = [r[0] + h * k3r[0], r[1] + h * k3r[1]], v4 = [v[0] + h * k3v[0], v[1] + h * k3v[1]];
    const k4v = acc(r4), k4r = v4;
    r = [r[0] + h / 6 * (k1r[0] + 2 * k2r[0] + 2 * k3r[0] + k4r[0]), r[1] + h / 6 * (k1r[1] + 2 * k2r[1] + 2 * k3r[1] + k4r[1])];
    v = [v[0] + h / 6 * (k1v[0] + 2 * k2v[0] + 2 * k3v[0] + k4v[0]), v[1] + h / 6 * (k1v[1] + 2 * k2v[1] + 2 * k3v[1] + k4v[1])];
  }
  return { r, v };
}

test('propagate agrees with a numerical integrator on every kind of conic', () => {
  const cases = [
    ['circle', [1, 0], [0, Math.sqrt(MU)], 100],
    ['ellipse', [1, 0], [0, Math.sqrt(MU) * 1.14], 200],
    ['comet-like ellipse', [0.4, 0], [0, Math.sqrt(MU / 0.4) * Math.sqrt(1.9) * 0.999], 300],
    ['hyperbola', [1, 0], [0.01, Math.sqrt(2 * MU) * 1.2], 150],
    ['near-parabola', [1, 0], [0, Math.sqrt(2 * MU) * 1.00001], 150],
    ['backwards in time', [1, 0], [0, Math.sqrt(MU) * 1.14], -120],
  ];
  for(const [name, r0, v0, dt] of cases){
    const a = O.propagate(MU, r0, v0, dt);
    const b = rk4(MU, r0, v0, dt, 100000);
    assert.ok(O.dist(a.r, b.r) < 1e-7, `${name}: position off by ${O.dist(a.r, b.r)}`);
    assert.ok(O.dist(a.v, b.v) < 1e-8, `${name}: velocity off by ${O.dist(a.v, b.v)}`);
  }
});

test('a jump of hundreds of orbits lands where the fractional jump does', () => {
  const r0 = [1, 0], v0 = [0, Math.sqrt(MU) * 1.14];
  const T = O.elementsFromState(MU, r0, v0).period;
  const a = O.propagate(MU, r0, v0, 437 * T + 12.5), b = O.propagate(MU, r0, v0, 12.5);
  assert.ok(O.dist(a.r, b.r) < 1e-9);
});

test('the rails and the propagator are the same physics', () => {
  const el = { a: 2.0, e: 0.75, omega: 1.1, M0: 0.7 };
  const s0 = O.railState(el, MU, 0);
  for(const t of [10, 100, 555.5, 2000]){
    const s1 = O.railState(el, MU, t), p = O.propagate(MU, s0.r, s0.v, t);
    assert.ok(O.dist(s1.r, p.r) < 1e-9, `t=${t}`);
  }
  // Periapsis of the rails is where the elements say it is.
  const n = O.meanMotion(MU, 2);
  const sp = O.railState(el, MU, (2 * Math.PI - 0.7) / n);
  assert.ok(Math.abs(O.norm(sp.r) - 0.5) < 1e-9);
  // A retrograde orbit turns the other way and is otherwise the same orbit.
  const pro = O.railState({ ...el, retrograde: false }, MU, 33), retro = O.railState({ ...el, retrograde: true }, MU, 33);
  assert.ok(O.cross(pro.r, pro.v) > 0 && O.cross(retro.r, retro.v) < 0);
  assert.ok(Math.abs(O.norm(pro.r) - O.norm(retro.r)) < 1e-12);
});

test('elements round-trip through a state vector', () => {
  const el = { a: 2.0, e: 0.75, omega: 1.1, M0: 0.7 };
  const s = O.railState(el, MU, 123.4);
  const e2 = O.elementsFromState(MU, s.r, s.v);
  assert.ok(Math.abs(e2.a - 2) < 1e-9 && Math.abs(e2.e - 0.75) < 1e-9 && Math.abs(e2.omega - 1.1) < 1e-9);
  const dtp = O.timeToAnomaly(MU, s.r, s.v, 0);
  const n = O.meanMotion(MU, 2);
  const M = (0.7 + n * 123.4) % (2 * Math.PI);
  assert.ok(Math.abs(dtp - ((2 * Math.PI - M) % (2 * Math.PI)) / n) < 1e-6);
});

test('a fast pass through a small sphere of influence is never tunnelled through', () => {
  const tessel = world.get('tessel'), ledger = world.get('ledger');
  const lp = O.railState(ledger, tessel.mu, 0.5).r;
  // Aim straight through Ledger's position half a day from now, at a speed
  // that crosses its whole SOI in a fraction of the search's minimum step.
  const speed = ledger.soi * 60;
  const start = [lp[0] + speed * 0.5, lp[1]];
  const pred = O.predict(world, { body: 'tessel', r: start, v: [-speed, 0] }, 0, [], 1.5);
  assert.ok(pred.events.some(e => e.kind === 'soi' && e.to === 'ledger'), 'missed Ledger entirely');
});

/* ------------------------------------------------------------- world */

test('every body has what the kernel and the chart read', () => {
  const ids = new Set(BODIES.map(b => b.id));
  for(const b of BODIES){
    const w = `body "${b.id}"`;
    assert.match(b.id, /^[a-z][a-z0-9]*$/, `${w}: id`);
    assert.equal(typeof b.name, 'string', `${w}: name`);
    assert.ok(['star', 'planet', 'moon', 'station', 'zone'].includes(b.kind), `${w}: kind ${b.kind}`);
    if(b.parent == null){ assert.equal(b.kind, 'star'); assert.equal(b.soi, null); continue; }
    assert.ok(ids.has(b.parent), `${w}: parent ${b.parent} exists`);
    for(const k of ['a', 'e', 'omega', 'M0', 'mu', 'radius']) assert.ok(Number.isFinite(b[k]), `${w}: ${k} is a number`);
    assert.ok(b.a > 0 && b.e >= 0 && b.e < 1, `${w}: sane orbit`);
    if(b.mu > 0) assert.ok(b.soi > 0, `${w}: a gravitating body has an SOI`); else assert.equal(b.soi, null, `${w}: a zone has no SOI`);
    if(b.port){
      assert.ok(b.zoneRadius > 0 && b.dockSpeed > 0, `${w}: docking zone`);
      if(b.mu > 0) assert.ok(b.radius < b.dockAlt && b.dockAlt < b.zoneRadius && b.zoneRadius <= b.soi / 3 + 1e-12, `${w}: radius < dockAlt < zone <= soi/3`);
    }
    if(b.retrograde) assert.equal(b.id, 'widdershins', 'only Widdershins runs backwards');
  }
  for(const id of ['lamp', 'cinder', 'wanderwell', 'tagalong', 'tessel', 'pip', 'bramble', 'ledger', 'arc', 'clawrock', 'grumm', 'mossback', 'lillimoor', 'widdershins', 'chime', 'hush', 'merrow', 'lantern']){
    assert.ok(ids.has(id), `the design document's ${id} is in the sky`);
  }
  assert.ok(world.get('widdershins').retrograde, 'Widdershins is retrograde');
});

test('the rails keep the promises the design makes', () => {
  const yr = O.period(MU, world.get('tessel').a);
  assert.ok(Math.abs(yr - CONST.YEAR_DAYS) < 1e-6, `Tessel's year is ${yr} days`);
  const cinderYear = O.period(MU, world.get('cinder').a);
  assert.ok(cinderYear > 30 && cinderYear < 80, `Cinder's year is weeks (${cinderYear.toFixed(1)} d)`);
  const w = world.get('wanderwell');
  assert.ok(w.a * (1 - w.e) < 0.6 && w.a * (1 + w.e) > 3.2, 'Wanderwell swings from summer to past the belt');
  const m = world.get('merrow');
  assert.ok(m.a * (1 - m.e) < 0.5 && m.a * (1 + m.e) > 12, 'the comet reaches the inner system and the deep dark');
  assert.ok(world.get('grumm').mu > world.get('tessel').mu * 10, 'Grumm has the deepest well');
});

test('no moon ever leaves its parent, and sibling moons never overlap', () => {
  for(const b of BODIES){
    if(b.kind !== 'moon') continue;
    const parent = world.get(b.parent);
    const apo = b.a * (1 + b.e);
    assert.ok(apo + b.soi <= parent.soi * 0.8 + 1e-12, `${b.id}: apoapsis ${apo} + soi ${b.soi} inside ${parent.id}'s ${parent.soi}`);
    for(const c of BODIES){
      if(c === b || c.parent !== b.parent || c.kind !== 'moon') continue;
      const gap = Math.abs(b.a - c.a) - (b.a * b.e + c.a * c.e);
      assert.ok(gap >= (b.soi + c.soi) * 1.25 - 1e-12, `${b.id} and ${c.id} keep their distance`);
    }
  }
});

test('the Scatter is where the design says, and the belt has rocks in it', () => {
  assert.ok(CONST.BELT.inner >= 2.5 && CONST.BELT.outer <= 3.3 && CONST.BELT.inner < CONST.BELT.outer);
  assert.ok(BELT_ROCKS.length > 200);
  for(const k of BELT_ROCKS.slice(0, 50)) assert.ok(k.r >= CONST.BELT.inner && k.r <= CONST.BELT.outer);
  const claw = world.get('clawrock');
  assert.ok(claw.a > CONST.BELT.inner && claw.a < CONST.BELT.outer, 'Claw Rock is in the belt');
});

/* ------------------------------------------------------------ economy */

test('every port is a body with a port, and every reference resolves', () => {
  const goodIds = new Set(GOODS.map(g => g.id));
  for(const [id, p] of Object.entries(PORTS)){
    const b = world.get(id);
    assert.ok(b && b.port, `port ${id} is a dockable body`);
    assert.ok(SPECIES[p.species], `${id}: species ${p.species}`);
    for(const s of p.sells){ assert.ok(goodIds.has(s.good), `${id} sells unknown ${s.good}`); assert.ok(s.stock > 0 && s.priceMul > 0); }
    for(const s of p.buys){ assert.ok(goodIds.has(s.good), `${id} buys unknown ${s.good}`); assert.ok(s.priceMul > 0); }
    const both = p.sells.filter(s => p.buys.some(b => b.good === s.good));
    assert.equal(both.length, 0, `${id} both buys and sells ${both.map(s => s.good)}`);
  }
  for(const b of BODIES) if(b.port) assert.ok(PORTS[b.id], `${b.id} is a port body with no port table`);
  for(const g of GOODS){
    assert.ok(g.basePrice > 0 && g.units > 0, `${g.id}: price and size`);
    for(const p of g.producedAt) assert.ok(PORTS[p], `${g.id} produced at unknown ${p}`);
    for(const s of Object.keys(g.demandBy)) assert.ok(SPECIES[s], `${g.id} demanded by unknown ${s}`);
    if(g.lifetimeDays != null) assert.ok(g.lifetimeDays > 0);
  }
  assert.ok(GOODS.every(g => g.category !== 'passenger'), 'passengers are contracts, not crates');
});

test('upgrades come in complete ladders with a starter at the bottom', () => {
  for(const kind of ['tank', 'engine', 'hold']){
    const ladder = S.tiers(kind);
    assert.deepEqual(ladder.map(u => u.tier), [0, 1, 2], `${kind} ladder`);
    for(const u of ladder){ assert.ok(Number.isFinite(u.value) && u.value > 0, `${u.id} has a value`); }
    assert.ok(ladder[2].value !== ladder[0].value, `${kind}: the top tier differs from the starter`);
  }
  for(const key of ['heatShield', 'refrigeration', 'sensors', 'stealth']) assert.ok(UPGRADES.some(u => u.key === key), `a ${key} upgrade exists`);
  for(const u of UPGRADES){
    if(u.soldAt) for(const p of u.soldAt) assert.ok(PORTS[p], `${u.id} sold at unknown ${p}`);
    if(u.price != null) assert.ok(u.price > 0);
  }
  assert.equal(UPGRADES.find(u => u.key === 'stealth').soldAt, null, 'stealth is found, not bought');
});

test('contract templates point at real places', () => {
  for(const t of CONTRACT_TEMPLATES){
    assert.ok(SPECIES[t.species], `template species ${t.species}`);
    for(const p of [...(t.fromPorts ?? []), ...(t.toPorts ?? [])]) assert.ok(PORTS[p], `template names unknown port ${p}`);
    assert.ok(['passenger', 'delivery'].includes(t.kind));
    assert.ok(t.units >= 1 && t.payMul > 0);
  }
});

test('the text has every line the game asks for', () => {
  assert.ok(GLOSSARY.length >= 14);
  for(const id of Object.keys(PORTS)){
    const p = TEXT.ports[id];
    assert.ok(p && p.blurb && p.arrival?.length >= 3 && p.trade?.length >= 3 && p.rumours?.length >= 3, `text for ${id}`);
  }
  for(const s of ['emberkin', 'otter', 'cat', 'frog']){
    const sp = TEXT.species[s];
    assert.ok(sp && sp.passengerRequests?.length >= 5 && sp.onFastArrival && sp.onLateArrival && sp.onGift && sp.greeting, `species text for ${s}`);
  }
  for(const k of ['tollOffer', 'tollPaidCoin', 'tollPaidCargo', 'tollStealth', 'tollGiftLater', 'towDry', 'towCrash', 'towAtmosphere', 'ledgerDebt', 'wanderwellClosing', 'cometCaught', 'firstSoiChange', 'firstTransfer', 'firstAssist', 'firstAerobrake', 'mossbackHeartbeat', 'hushRelic', 'chimeArrival', 'lanternArrival']){
    assert.ok(TEXT.events[k], `event text ${k}`);
  }
  assert.ok(TEXT.events.tollOffer.length >= 3 && TEXT.events.tollOffer.every(v => v.captain && v.line));
  assert.ok(/\?\s*$/.test(TEXT.events.lanternArrival.trim()), 'the Lantern ends on a question, as the design leaves it');
  assert.equal(TEXT.tutorial.length, 5);
  for(const k of ['docked', 'undocked', 'burn', 'soiEnter', 'soiExit', 'sold', 'bought', 'contractTaken', 'contractDone', 'contractLate', 'towed', 'tolled', 'refuelled', 'upgraded']){
    assert.match(TEXT.logTemplates[k], /\{\w+\}/, `log template ${k} has a placeholder`);
  }
  assert.ok(TEXT.shipNames.length >= 12 && TEXT.captainLines.onStranded.length >= 3);
});

/* ---------------------------------------------------------------- sim */

test('a new game starts docked at Tessel with a full starter tank and a lesson', () => {
  const s = S.newGame(7);
  assert.equal(s.dockedAt, 'tessel');
  assert.ok(Math.abs(s.dv - s.tank) < 1e-12 && s.tank > 0);
  assert.ok(Math.abs(S.kms(s.tank) - S.tiers('tank')[0].value) < 1e-9, 'the starter tank is the one the shipyard lists');
  assert.equal(s.money, CONST.START_MONEY);
  assert.equal(s.flags.tutorial, 0);
  assert.ok(S.refreshOffers(s, 'tessel').length >= 1, 'somebody wants a ride from the starting port');
  // The save is JSON all the way down.
  const back = S.restore(S.serialize(s));
  assert.deepEqual(back, JSON.parse(JSON.stringify(s)));
});

test('undocking puts the ship in a circular prograde orbit at the docking altitude', () => {
  const s = S.newGame(3);
  S.undock(s);
  assert.equal(s.dockedAt, null);
  const b = world.get('tessel');
  const el = O.elementsFromState(b.mu, s.ship.r, s.ship.v);
  assert.ok(Math.abs(O.norm(s.ship.r) - b.dockAlt) < 1e-12 && el.e < 1e-9 && el.dir > 0);
  /* And the port you just left stays quiet until you are out of its mouth:
     a card saying "tie up" one second after casting off is an invitation to
     undo what you just did. */
  assert.equal(S.dockingStatus(s), null, 'Tessel does not immediately ask you back');
  assert.equal(s.justLeft, 'tessel');
  // Once outside the mouth it forgets, and behaves like any other port.
  s.ship = { body: 'tessel', r: [b.zoneRadius * 3, 0], v: [0, 0] };
  S.tick(s, 0.001);
  assert.equal(s.justLeft, null);
});

/* Find a prograde burn from the undock orbit that reaches a moon's sphere of
 * influence, the way a player does by dragging the handle: try bigger and
 * bigger, and watch the prediction. */
function hopPlan(s, target, maxKms = 4, wantDockable = false){
  const b = world.get(s.ship.body);
  const tb = world.get(target);
  const el = O.elementsFromState(b.mu, s.ship.r, s.ship.v);
  let best = null;
  for(let frac = 0.02; frac <= 1; frac += 0.02){
    const tNode = s.t + el.period * frac;
    for(let k = 0.05; k <= maxKms; k += 0.01){
      const nodes = [{ t: tNode, prograde: S.auDay(k), radial: 0 }];
      const pred = O.predict(world, s.ship, s.t, nodes, el.period * 6, { dvAvailable: s.dv });
      const firstEntry = pred.events.find(e => e.kind === 'soi' && e.to !== 'lamp' && e.to !== b.id);
      if(firstEntry && firstEntry.to === target){
        if(!wantDockable) return { nodes, pred, kms: k };
        // Dockable means the leg inside the moon's reach comes inside the
        // harbour mouth without going through the moon.
        const seg = pred.segments.find(sg => sg.body === target);
        if(seg && seg.elements.rp < tb.zoneRadius && seg.elements.rp > tb.radius * 1.5){
          return { nodes, pred, kms: k };
        }
        best ??= { nodes, pred, kms: k };
        continue;
      }
      if(firstEntry) continue;   // it reaches somewhere, but somewhere else first
      if(pred.events.some(e => e.kind === 'soi' && e.to === 'lamp')) break;   // escaped Tessel: too much
    }
  }
  return best;
}

test('the first lesson is flyable: one prograde burn from Tessel reaches Bramble inside the starter tank', () => {
  const s = S.newGame(11);
  S.undock(s);
  const plan = hopPlan(s, 'bramble');
  assert.ok(plan, 'no single prograde burn reaches Bramble');
  // The tuning's own figure for this hop is about 2 km/s out of a 14 km/s tank.
  assert.ok(plan.kms < 3, `the hop costs ${plan.kms} km/s`);
  assert.ok(S.auDay(plan.kms) < s.dv * 0.3, 'the first lesson leaves most of the tank');
  // Fly it at full warp: the burn fires at its time, the SOI change happens, the fuel is spent.
  s.nodes = plan.nodes;
  const before = s.dv;
  const events = [];
  let guard = 0;
  while(s.ship.body !== 'bramble' && guard++ < 4000){ events.push(...S.tick(s, 4.17)); }
  assert.equal(s.ship.body, 'bramble', 'arrived in Bramble\'s reach');
  assert.ok(events.some(e => e.kind === 'burn'));
  assert.ok(Math.abs((before - s.dv) - S.auDay(plan.kms)) < 1e-9, 'exactly the planned Δv was spent');
  assert.equal(s.nodes.length, 0, 'the fired node left the plan');
  assert.ok(s.flags.firstSoiChange, 'the milestone was noted');
});

test('the whole first lesson can be flown: hop, brake at the kiss, and tie up at Bramble', () => {
  /* This is the tutorial, played by the rules the page plays by: one prograde
     burn to reach the moon, the game's own brake-at-the-kiss mark, and then
     Dock. If this test fails the game cannot be finished by a beginner. */
  const s = S.newGame(5);
  S.undock(s);
  const plan = hopPlan(s, 'bramble', 4, true);
  assert.ok(plan, 'no hop reaches Bramble inside its harbour mouth');
  s.nodes = plan.nodes;
  let guard = 0;
  while(s.ship.body !== 'bramble' && guard++ < 4000) S.tick(s, 4.17);
  assert.equal(s.ship.body, 'bramble');
  assert.equal(s.pending, null, 'the hop did not fly into anything');

  const k = S.kiss(s);
  assert.ok(k && k.port === 'bramble' && !k.crashes, 'the approach passes outside the moon');
  assert.ok(k.inMouth, 'the kiss is inside the harbour mouth');
  const ix = S.brakeAtKiss(s);
  assert.ok(ix >= 0, 'the game offers a brake at the kiss');
  assert.ok(S.planCost(s) < s.dv, 'and the tank can pay for it');

  guard = 0;
  while(s.nodes.length && guard++ < 20000) S.tick(s, 0.01);
  assert.equal(s.pending, null, 'no crash on the brake');
  let st = S.dockingStatus(s);
  assert.ok(st && st.port === 'bramble', 'Bramble is the port in front of us');
  // Coast the short way to the mouth if the brake happened just before it.
  guard = 0;
  while(!(st?.ok) && guard++ < 4000 && !s.pending){ S.tick(s, 0.005); st = S.dockingStatus(s); }
  assert.ok(st?.ok, `never got slow enough inside the mouth (${st ? S.fmtKms(st.over) + ' over' : 'no port'})`);
  const r = S.dock(s);
  assert.ok(r.ok && s.dockedAt === 'bramble', 'tied up at Bramble');
  assert.ok(s.dv > 0, 'with fuel to spare');
});

test('markets: buying costs, selling elsewhere pays, and selling a lot walks the price down', () => {
  const s = S.newGame(21);
  const port = 'tessel';
  const good = PORTS[port].sells[0].good;
  const price = S.buyPrice(s, port, good);
  const r = S.buy(s, good, 2);
  assert.ok(r.ok && s.money === CONST.START_MONEY - price * 2);
  assert.equal(S.usedUnits(s), 2 * S.goodById(good).units);
  // Somebody who wants it pays more than the disinterested rate.
  const wanter = Object.entries(PORTS).find(([id, p]) => id !== port && p.buys.some(b => b.good === good));
  if(wanter){
    const [wid] = wanter;
    const p1 = S.sellPrice(s, wid, good);
    s.markets[wid] = { sold: { [good]: { q: 200, t: s.t } }, bought: {} };
    const p2 = S.sellPrice(s, wid, good);
    assert.ok(p2 < p1 * 0.6, `saturation bites: ${p2} vs ${p1}`);
    // And it forgets. Compared on the multiplier alone, because a price also
    // moves with the sky and with whatever the Emberkin decided was fashionable.
    assert.ok(S.saturationMul(s, wid, good) < 0.6);
    s.t += FORMULAS.saturation.halfLifeDays * 6;
    assert.ok(S.saturationMul(s, wid, good) > 0.9, 'and recovers');
  }
  // Nobody makes money round-tripping in one port.
  for(const [id, p] of Object.entries(PORTS)){
    for(const row of p.sells){
      s.markets = {}; s.t = 0;
      assert.ok(S.sellPrice(s, id, row.good) < S.buyPrice(s, id, row.good), `${id}: ${row.good} sells for less than it costs`);
    }
  }
});

test('perishables lose value with age, down to a floor', () => {
  const g = GOODS.find(g => g.lifetimeDays);
  assert.ok(g);
  assert.equal(S.freshness(g, 0), 1);
  assert.ok(S.freshness(g, g.lifetimeDays / 2) < 0.6);
  assert.equal(S.freshness(g, g.lifetimeDays * 5), FORMULAS.perishable.floor);
});

test('fuel: the tank is a hard ceiling and coin a hard floor', () => {
  const s = S.newGame(1);
  s.dv = 0;
  const r = S.refuel(s, 1000);
  assert.ok(r.ok && s.dv <= s.tank + 1e-12 && s.money >= 0);
  const full = S.refuel(s, 1);
  if(s.dv >= s.tank - 1e-9) assert.equal(full.ok, false);
});

test('a tow moves the ship to the nearest port and costs money and days, never the save', () => {
  const s = S.newGame(9);
  S.undock(s);
  s.dv = 0;
  const t0 = s.t, m0 = s.money;
  const q = S.towQuote(s);
  const r = S.callTow(s, 'dry');
  assert.equal(s.dockedAt, q.port);
  assert.ok(s.t > t0 && m0 - s.money === r.cost || s.debt > 0);
  assert.equal(s.stats.tows, 1);
});

test('crossing the Scatter without stealth brings a toll that never takes everything', () => {
  const s = S.newGame(13);
  S.undock(s);
  // Put the ship on a heliocentric orbit that climbs into the belt, with a hold worth taking a share of.
  const start = O.circularState(MU, CONST.BELT.inner - 0.1, 1.0);
  s.ship = { body: 'lamp', r: start.r, v: O.scale(start.v, 1.12) };
  s.cargo = [{ good: 'tideglass', qty: 10, t: s.t, price: 80, from: 'tessel' }];
  s.passengers = [{ id: 'x', kind: 'passenger', species: 'otter', from: 'tessel', to: 'pip', pay: 100, deadline: s.t + 100, units: 1, needs: [], title: 'x', takenAt: s.t }];
  const events = [];
  let guard = 0;
  while(!s.pending && guard++ < 1200) events.push(...S.tick(s, 0.5));
  assert.ok(s.pending && s.pending.kind === 'toll', 'a captain hails');
  const value = S.cargoValue(s);
  assert.ok(s.pending.amount <= FORMULAS.toll.cap && s.pending.amount <= value * FORMULAS.toll.fraction + 1);
  const r = S.resolveToll(s, 'cargo');
  assert.ok(r.ok && s.cargo.reduce((a, c) => a + c.qty, 0) >= 6, 'they left most of the hold');
  assert.equal(s.passengers.length, 1, 'passengers are never touched');
  assert.equal(s.pending, null);
  assert.ok(s.rep.cat > 0);
  // With stealth, the same crossing is quiet.
  const s2 = S.newGame(13); S.undock(s2); s2.keys.stealth = true;
  const st2 = O.circularState(MU, CONST.BELT.inner - 0.1, 1.0);
  s2.ship = { body: 'lamp', r: st2.r, v: O.scale(st2.v, 1.12) };
  s2.cargo = [{ good: 'tideglass', qty: 10, t: s2.t, price: 80, from: 'tessel' }];
  guard = 0; while(!s2.toll.inBelt && guard++ < 1200) S.tick(s2, 0.5);
  assert.ok(s2.toll.inBelt, 'the quiet ship did cross the belt');
  assert.equal(s2.pending, null, 'and was never hailed');
});

test('aerobraking: Grumm\'s clouds are a crash without a shield and a brake with one', () => {
  const g = world.get('grumm');
  const dive = (shield) => {
    const s = S.newGame(17);
    S.undock(s);
    s.keys.heatShield = shield;
    // A hyperbolic approach whose periapsis sits inside the atmosphere band.
    const rp = (g.atmo + g.radius) / 2;
    const vinf = 0.004;
    const vp = Math.sqrt(vinf * vinf + 2 * g.mu / rp);
    // Start at periapsis and run time backwards to the SOI edge to get an entry state.
    const pe = { r: [rp, 0], v: [0, vp] };
    let tBack = -0.5, st;
    for(let i = 0; i < 200; i++){ st = O.propagate(g.mu, pe.r, pe.v, tBack); if(O.norm(st.r) > g.soi * 0.9) break; tBack *= 1.3; }
    s.ship = { body: 'grumm', r: st.r, v: st.v };
    const events = [];
    let guard = 0;
    while(guard++ < 3000 && !s.pending && s.ship.body === 'grumm') events.push(...S.tick(s, 0.2));
    return { s, events };
  };
  const bare = dive(false);
  assert.ok(bare.s.pending && bare.s.pending.kind === 'crash', 'no shield: the clouds take the ship');
  const shielded = dive(true);
  assert.equal(shielded.s.pending, null, 'with a shield the ship survives, pass after pass');
  assert.ok(shielded.s.flags.firstAerobrake, 'the skim was noted');
  const el = O.elementsFromState(g.mu, shielded.s.ship.r, shielded.s.ship.v);
  assert.ok(el.e < 1, 'the skim captured the ship into a bound orbit');
  assert.ok(el.rp > g.radius, 'and never dug it into the planet');
  assert.ok(shielded.s.dv === shielded.s.tank, 'and it cost no fuel at all');
});

test('contracts: taken here, paid there, less when late', () => {
  const s = S.newGame(23);
  const offers = S.refreshOffers(s, 'tessel');
  const c = offers.find(o => S.canTake(s, o).ok);
  assert.ok(c, 'an offer the starter ship can take');
  assert.ok(S.takeContract(s, c.id).ok);
  assert.equal(s.passengers.length, 1);
  // Teleport to the destination, late, and dock.
  s.t = c.deadline + 10;
  S.undock(s);
  const b = world.get(c.to);
  if(b.mu > 0) s.ship = { body: c.to, r: [b.dockAlt, 0], v: [0, 0] };
  else { const local = O.railState(b, world.get(b.parent).mu, s.t); s.ship = { body: b.parent, r: local.r, v: local.v }; }
  const m0 = s.money;
  const r = S.dock(s);
  assert.ok(r.ok && r.delivered.length === 1 && r.delivered[0].late);
  assert.equal(s.money - m0, Math.round(c.pay * FORMULAS.contract.latePayMul));
  assert.equal(s.passengers.length, 0);
});

test('the Far Lantern and the comet are rendezvous zones, and Hush hands over the dampener', () => {
  for(const id of ['merrow', 'lantern', 'clawrock']){ const b = world.get(id); assert.equal(b.mu, 0); assert.equal(b.soi, null); assert.ok(b.port); }
  const s = S.newGame(2);
  S.undock(s);
  s.t = 1000;
  const h = world.get('hush');
  s.ship = { body: 'hush', r: [h.dockAlt, 0], v: [0, 0] };
  const r = S.dock(s);
  assert.ok(r.ok && s.keys.stealth, 'the Hush dampener is found, not bought');
  assert.ok(s.flags.hushRelic);
});

test('aiming turns a rough plan into an arrival, everywhere in Tessel\'s system', () => {
  /* "Aim for it" is the game's one convenience, and the thing a beginner will
     lean on hardest: it must land inside the harbour mouth from every raft to
     every other, and from each of them back down to Tessel. */
  for(const [from, to] of [['tessel', 'bramble'], ['tessel', 'pip'], ['bramble', 'ledger'], ['ledger', 'pip'], ['pip', 'bramble'], ['bramble', 'tessel'], ['ledger', 'tessel']]){
    const s = S.newGame(5);
    s.dockedAt = from;
    S.undock(s);
    s.target = to;
    const r = S.trimToTarget(s, to, 900);
    const tb = world.get(to);
    assert.ok(r.ok, `${from} -> ${to}: ${r.reason}`);
    assert.ok(r.distance <= tb.zoneRadius, `${from} -> ${to}: near pass ${r.distance} outside the mouth ${tb.zoneRadius}`);
    assert.ok(r.cost < s.dv, `${from} -> ${to}: costs ${S.fmtKms(r.cost)} of ${S.fmtKms(s.dv)}`);
    assert.ok(S.planCost(s) === r.cost);
    /* And the plan it wrote is one the ship can fly as far as the arrival. What
       happens after that is up to whoever writes the brake down. */
    const pred = S.plan(s, 900);
    const crash = pred.events.find(e => e.kind === 'crash');
    assert.ok(!crash || crash.t > r.at, `${from} -> ${to}: the aimed road flies into ${crash?.body} before it arrives`);
  }
});

test('aiming reaches every port in the system from a Tessel orbit', () => {
  const starts = () => {
    const s = S.newGame(5);
    S.undock(s);
    const abs = O.absState(world, 'tessel', s.t);
    s.ship = { body: 'lamp', r: abs.r, v: abs.v };
    s.dv = S.auDay(40);          // the deep tank, which is what an outer run needs
    return s;
  };
  for(const to of ['cinder', 'wanderwell', 'arc', 'clawrock', 'grumm', 'chime', 'merrow', 'lantern']){
    const s = starts();
    s.target = to;
    const r = S.trimToTarget(s, to, 12000);
    const tb = world.get(to);
    assert.ok(r.ok, `${to}: ${r.reason}`);
    const mouth = tb.zoneRadius ?? tb.soi;
    assert.ok(r.distance <= mouth, `${to}: near pass ${r.distance} outside ${mouth}`);
    assert.ok(r.cost <= S.auDay(40) * 0.85, `${to}: ${S.fmtKms(r.cost)} is more than the deep tank affords`);
  }
  // A moon of another planet is two journeys, and the game says so rather than flailing.
  const s = starts();
  const r = S.trimToTarget(s, 'lillimoor', 12000);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Grumm/);
});

test('Lambert: the transfer it solves is the transfer that flies', () => {
  const r1 = [1, 0];
  // A near-Hohmann to 1.5 au, off the exact half-turn where the problem is singular.
  const hh = O.hohmann(MU, 1, 1.5);
  const th = Math.PI * 179.5 / 180;
  const r2 = [1.5 * Math.cos(th), 1.5 * Math.sin(th)];
  const sol = O.lambert(MU, r1, r2, hh.time, true);
  assert.ok(sol, 'no solution');
  const vc = Math.sqrt(MU);
  assert.ok(Math.abs((O.norm(sol.v1) - vc) - hh.dv1) < 1e-6, 'the burn is the Hohmann burn');
  const end = O.propagate(MU, r1, sol.v1, hh.time);
  assert.ok(O.dist(end.r, r2) < 1e-7, `arrives ${O.dist(end.r, r2)} away`);
  // The long way round, and a moon-sized case.
  const back = O.lambert(MU, r1, [0, 1.2], 200, false);
  assert.ok(back && O.cross(r1, back.v1) < 0, 'the long way round goes the other way');
  const mu = world.get('tessel').mu;
  const a = world.get('bramble').a;
  const tight = O.lambert(mu, [0.0007, 0], [a * Math.cos(2.1), a * Math.sin(2.1)], 1.6, true);
  assert.ok(tight, 'no moon-scale solution');
  const arrive = O.propagate(mu, [0.0007, 0], tight.v1, 1.6);
  assert.ok(O.dist(arrive.r, [a * Math.cos(2.1), a * Math.sin(2.1)]) < 1e-9);
  // An impossible ask returns nothing rather than nonsense.
  assert.equal(O.lambert(MU, r1, [1, 0], -5, true), null);
});

test('an aimed road never flies into the thing it is aimed at', () => {
  /* Aiming at a moon's centre gets you there at whatever speed you happen to
     have, which is a landing. Every aim must pass it, not hit it — and the
     game must always be able to lift a kiss back out of the ground. */
  for(const [from, to] of [['tessel', 'bramble'], ['tessel', 'pip'], ['tessel', 'ledger'], ['bramble', 'ledger'], ['ledger', 'pip'], ['pip', 'bramble'], ['bramble', 'pip']]){
    const s = S.newGame(5);
    s.dockedAt = from;
    S.undock(s);
    s.target = to;
    const r = S.trimToTarget(s, to, 900);
    assert.ok(r.ok, `${from} -> ${to}: ${r.reason}`);
    const pred = S.plan(s, 900);
    const crash = pred.events.find(e => e.kind === 'crash');
    assert.ok(!crash || crash.t > r.at + 0.5, `${from} -> ${to}: strikes ${crash?.body} on the way in`);
    assert.ok(r.distance > world.get(to).radius, `${from} -> ${to}: the pass is inside the moon`);
  }
});

test('a kiss dug into a moon can always be lifted back out of it', () => {
  const s = S.newGame(5);
  S.undock(s);
  const b = world.get('bramble');
  // A steep hyperbolic approach whose kiss is buried in the moon.
  const speed = Math.sqrt(2 * b.mu / b.soi) * 2.2;
  s.ship = { body: 'bramble', r: [b.soi * 0.95, 0], v: [-speed, speed * 0.1] };
  const before = S.kiss(s);
  assert.ok(before && before.crashes, 'the setup does dig in');
  const ix = S.raiseKiss(s);
  assert.ok(ix >= 0, 'nothing was offered');
  let guard = 0;
  while(s.nodes.length && guard++ < 20000) S.tick(s, 0.002);
  assert.equal(s.pending, null, 'lifting it flew into the moon anyway');
  const after = S.kiss(s);
  assert.ok(after && !after.crashes, 'the kiss is still in the ground');
  assert.ok(after.distance > b.radius * 2, `kiss only reached ${after.distance}`);
  assert.ok(s.dv < s.tank, 'it cost something');

  /* A ship falling dead straight at a world is a different matter: forward and
     outward are the same line for it, so there is no pair of numbers on a mark
     that adds up to a push across, and the game says nothing rather than
     offering two enormous opposing ones that cancel. It is still told what is
     about to happen, and a crash is a tow, not an ending. */
  const straight = S.newGame(5);
  S.undock(straight);
  straight.ship = { body: 'bramble', r: [b.soi * 0.95, 0], v: [-speed, 0] };
  const k = S.kiss(straight);
  assert.ok(k && k.crashes, 'a straight drop is not even reported');
  assert.equal(S.brakeAtKiss(straight), -1, 'a mark was offered that cannot be expressed');
});

test('what a mark costs is what the tank is charged, on any orbit', () => {
  /* Prograde and radial only sit at right angles on a circle. Adding the two
     numbers on a mark's card as a triangle overstates a burn badly on an
     eccentric orbit — and the tank is charged the real thing, so the two must
     agree or the plan lies about what it can afford. */
  const s = S.newGame(5);
  S.undock(s);
  const b = world.get('tessel');
  // A good eccentric orbit, where the two axes lean well apart.
  s.ship = { body: 'tessel', r: [b.dockAlt, 0], v: [Math.sqrt(b.mu / b.dockAlt) * 0.5, Math.sqrt(b.mu / b.dockAlt) * 1.1] };
  s.nodes = [{ t: s.t + 0.3, prograde: S.auDay(0.4), radial: S.auDay(-0.3) }];
  const [mark] = S.markStates(s, 90);
  assert.ok(mark.body, 'the mark is not on the plan');
  const shown = S.planCost(s);
  assert.ok(Math.abs(shown - mark.cost) < 1e-12);
  const before = s.dv;
  let guard = 0;
  while(s.nodes.length && guard++ < 20000) S.tick(s, 0.005);
  const charged = before - s.dv;
  assert.ok(Math.abs(charged - shown) < 1e-9, `told ${S.fmtKms(shown)}, charged ${S.fmtKms(charged)}`);
  // And the naive triangle really is different, so this test has something to say.
  const naive = Math.hypot(S.auDay(0.4), S.auDay(-0.3));
  assert.ok(Math.abs(naive - charged) > charged * 0.05, 'the two axes were at right angles after all');
});

test('a dry ship with an empty purse can still leave the dock', () => {
  /* Nothing may cost the save, and a ship with no fuel and no coin tied up at
     a dock would be exactly that. Ledger fronts it, at a price. */
  const s = S.newGame(5);
  s.dv = 0;
  s.money = 0;
  assert.ok(S.fuelCredit(s) > 0, 'no credit offered');
  const r = S.refuel(s, 3);
  assert.ok(r.ok && r.borrowed > 0, 'the tank stayed dry');
  assert.ok(S.kms(s.dv) >= 2.5, `only got ${S.fmtKms(s.dv)}`);
  assert.ok(s.debt > 0 && s.money === 0);
  // And it is a floor, not a facility: a full purse borrows nothing.
  const rich = S.newGame(5);
  rich.dv = 0;
  rich.money = 100000;
  const r2 = S.refuel(rich, 5);
  assert.ok(r2.ok && !r2.borrowed && rich.debt === 0);
  // Nor does a ship that already has fuel.
  const fine = S.newGame(5);
  fine.money = 0;
  assert.equal(S.fuelCredit(fine), 0);
});
