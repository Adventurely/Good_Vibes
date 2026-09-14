import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import * as O from '../public/orbital-trader/orbit.js';
import { PORTRAITS, PORTRAIT_SIZE, portraitURL } from '../public/orbital-trader/sprites.js';
import {
  CONST, BODIES, GOODS, PORTS, UPGRADES, FORMULAS, TEXT, GLOSSARY, SPECIES, BELT_ROCKS,
} from '../public/orbital-trader/content.js';
import * as S from '../public/orbital-trader/sim.js';
import { createChart, railCrossings, railLead, locateOnPrediction, PALETTE } from '../public/orbital-trader/render.js';
import { DURATION, BREACH, BEATS, CAPTION_AT, beatAt, ascent, skyAt, ROCKET } from '../public/orbital-trader/intro.js';

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
  const tassel = world.get('tassel'), slate = world.get('slate');
  /* Aim straight through Slate's position a tenth of a day from now, at a
     speed that crosses its whole SOI in a fraction of the search's minimum
     step. The lead has to be short against the moon's own lap — Slate goes
     round Tassel in a day and a bit, so a half-day lead is a shot at where it
     used to be, which proves nothing about tunnelling. */
  const lead = 0.1;
  const lp = O.railState(slate, tassel.mu, lead).r;
  const speed = slate.soi * 60;
  const start = [lp[0] + speed * lead, lp[1]];
  const pred = O.predict(world, { body: 'tassel', r: start, v: [-speed, 0] }, 0, [], lead * 3);
  assert.ok(pred.events.some(e => e.kind === 'soi' && e.to === 'slate'), 'missed Slate entirely');
});

/* ------------------------------------------------------------- world */

test('every body has what the kernel and the chart read', () => {
  const ids = new Set(BODIES.map(b => b.id));
  for(const b of BODIES){
    const w = `body "${b.id}"`;
    assert.match(b.id, /^[a-z][a-z0-9]*$/, `${w}: id`);
    assert.equal(typeof b.name, 'string', `${w}: name`);
    assert.ok(['star', 'planet', 'moon', 'station', 'zone', 'hole'].includes(b.kind), `${w}: kind ${b.kind}`);
    if(b.parent == null){ assert.equal(b.kind, 'star'); assert.equal(b.soi, null); continue; }
    assert.ok(ids.has(b.parent), `${w}: parent ${b.parent} exists`);
    for(const k of ['a', 'e', 'omega', 'M0', 'mu', 'radius']) assert.ok(Number.isFinite(b[k]), `${w}: ${k} is a number`);
    assert.ok(b.a > 0 && b.e >= 0 && b.e < 1, `${w}: sane orbit`);
    if(b.mu > 0) assert.ok(b.soi > 0, `${w}: a gravitating body has an SOI`); else assert.equal(b.soi, null, `${w}: a zone has no SOI`);
    if(b.port){
      assert.ok(b.zoneRadius > 0 && b.dockSpeed > 0, `${w}: docking zone`);
      /* Ground, then parking orbit, then harbour mouth, and all of it inside
         the world's own reach. The mouth is ten radii plus whatever air is
         over them, which is a far bigger bite out of a small moon than out of
         a planet — Glass's harbour is most of Glass's gravity — so the ceiling
         is the physical one rather than a fraction somebody chose. */
      if(b.mu > 0) assert.ok(b.radius < b.dockAlt && b.dockAlt < b.zoneRadius && b.zoneRadius <= b.soi * 0.92, `${w}: ground < parking < mouth < reach`);
    }
    if(b.retrograde) assert.equal(b.id, 'croak', 'only Croak runs backwards');
  }
  for(const id of ['lamp', 'cinder', 'scorch', 'veyra', 'tassel', 'slate', 'moss', 'nail', 'whisker', 'arc', 'grumm', 'brine', 'glass', 'croak', 'haven', 'maw']){
    assert.ok(ids.has(id), `the design document's ${id} is in the sky`);
  }
  /* The mouth is not authored: it is five of the world's own radii above the
     top of its air, so that making a world bigger widens its harbour and no
     table can quietly disagree. The drifting havens have no ground and keep
     theirs. */
  for(const b of BODIES){
    if(!(b.mu > 0) || !(b.radius > 0)) continue;
    const want = Math.max(b.radius, b.atmo ?? b.radius) + 5 * b.radius;
    assert.ok(Math.abs(b.zoneRadius - want) < 1e-15, `${b.id}: mouth is ${b.zoneRadius}, five radii over the air is ${want}`);
    // And every harbour is inside the mouth it belongs to, or a ship undocks
    // outside its own docking range.
    if(b.dockAlt) assert.ok(b.dockAlt < b.zoneRadius, `${b.id}: the harbour at ${b.dockAlt} is outside its own mouth ${b.zoneRadius}`);
  }
  for(const id of ['nail', 'whisker', 'maw']){
    assert.ok(world.get(id).zoneRadius >= 1e-3, `${id} is a rendezvous, not a world; its mouth stays the one it was given`);
  }
  /* Seventeen: the sixteen the setting names, and the Knot, which it does
     not — a micro black hole the cats have never mentioned. It is in the sky
     for everybody; it is only on the chart for a ship that knows. */
  assert.equal(BODIES.length, 17, 'the sixteen named bodies, and the one that is not');
  assert.ok(world.get('croak').retrograde, 'Croak is retrograde');
});

test('the rails keep the promises the design makes', () => {
  const yr = O.period(MU, world.get('tassel').a);
  assert.ok(Math.abs(yr - CONST.YEAR_DAYS) < 1e-6, `Tassel's year is ${yr} days`);
  /* The innermost world's year is a fraction of Tassel's, which is what the
     fiction is about — the New Year party that never quite stops. Asked of
     whichever of the Emberkin pair is nearer the Lamp rather than of Cinder
     by name: the two of them have now changed places once, and the fiction
     belongs to the orbit rather than to the word. */
  const emberkin = ['cinder', 'veyra'].map(id => world.get(id)).sort((a, b) => a.a - b.a);
  const innerYear = O.period(MU, emberkin[0].a);
  assert.ok(innerYear < yr / 4, `${emberkin[0].id}'s year is a fraction of Tassel's (${innerYear.toFixed(1)} of ${yr.toFixed(0)} d)`);
  // Both Emberkin worlds are inside Tassel, and the Maw is the far edge of all of it.
  assert.ok(emberkin[0].a < emberkin[1].a && emberkin[1].a < world.get('tassel').a,
    `${emberkin[0].id} ${emberkin[0].a} < ${emberkin[1].id} ${emberkin[1].a} < Tassel ${world.get('tassel').a}`);
  assert.ok(world.get('maw').a > world.get('grumm').a * 3, 'the Maw is the long way out');
  assert.ok(world.get('grumm').mu > world.get('tassel').mu * 10, 'Grumm has the deepest well');
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

test('the Belt is where the design says, and it has rocks in it', () => {
  /* Between Tassel and Grumm, wherever those two are: the Belt is a place in
     the sky's order, not a number of au. */
  assert.ok(CONST.BELT.inner < CONST.BELT.outer, 'the Belt has a width');
  assert.ok(CONST.BELT.inner > world.get('tassel').a && CONST.BELT.outer < world.get('grumm').a,
    `the Belt (${CONST.BELT.inner}-${CONST.BELT.outer}) is not between Tassel and Grumm`);
  assert.ok(BELT_ROCKS.length > 200);
  for(const k of BELT_ROCKS.slice(0, 50)) assert.ok(k.r >= CONST.BELT.inner && k.r <= CONST.BELT.outer);
  for(const id of ['nail', 'whisker']){
    const h = world.get(id);
    assert.ok(h.a > CONST.BELT.inner && h.a < CONST.BELT.outer, `${id} is in the belt`);
  }
  // The Arc moved out from among the rocks to just beyond them.
  const arc = world.get('arc');
  assert.ok(arc.a > CONST.BELT.outer && arc.a < CONST.BELT.outer + 0.5, 'the Arc rides just outside the Belt');
});

/* ------------------------------------------------------------ economy */

test('every port is a body with a port, and every reference resolves', () => {
  const goodIds = new Set(GOODS.map(g => g.id));
  for(const [id, p] of Object.entries(PORTS)){
    const b = world.get(id);
    assert.ok(b && b.port, `port ${id} is a dockable body`);
    assert.ok(SPECIES[p.species], `${id}: species ${p.species}`);
    assert.ok(['inner', 'home', 'belt', 'outer', 'deep'].includes(p.region), `${id}: region ${p.region}`);
    for(const s of p.sells){ assert.ok(goodIds.has(s.good), `${id} sells unknown ${s.good}`); assert.ok(s.priceMul > 0); }
    for(const s of p.buys){ assert.ok(goodIds.has(s.good), `${id} buys unknown ${s.good}`); assert.ok(s.priceMul > 0); }
    const both = p.sells.filter(s => p.buys.some(b => b.good === s.good));
    assert.equal(both.length, 0, `${id} both buys and sells ${both.map(s => s.good)}`);
  }
  for(const b of BODIES) if(b.port) assert.ok(PORTS[b.id], `${b.id} is a port body with no port table`);
  const known = new Set([...Object.keys(PORTS), ...Object.keys(SPECIES), 'everyone']);
  for(const g of GOODS){
    assert.ok(g.basePrice > 0 && g.units > 0, `${g.id}: price and size`);
    assert.ok(g.producedAt.length >= 1, `${g.id} is made nowhere`);
    for(const p of g.producedAt) assert.ok(PORTS[p], `${g.id} produced at unknown ${p}`);
    // Buyers and loved-by name ports and peoples in the same breath, the way a
    // trader would; either kind has to be a real name.
    for(const x of [...g.buyers, ...g.lovedBy]) assert.ok(known.has(x), `${g.id} names unknown ${x}`);
    const [lo, hi] = g.stock;
    assert.ok(Number.isInteger(lo) && Number.isInteger(hi) && lo >= 1 && hi >= lo, `${g.id}: stock range ${g.stock}`);
    assert.ok(['light', 'heavy'].includes(g.weight), `${g.id}: weight ${g.weight}`);
    // Somebody, somewhere, has to want it, or it is a crate that cannot be sold.
    assert.ok(Object.keys(PORTS).some(id => S.wantsGood(id, g.id)), `${g.id} has no buyer anywhere`);
  }
});

test("a good may name where it comes from, never a world that buys it", () => {
  /* Where a thing comes from is colour, and may be named: "otters forge
     tideglass in the volcanic trenches beneath Tassel's ocean" is the
     sentence that explains the glass. Where a thing is *wanted* is the game.
     Print that on the label and the run stops being a trade and becomes an
     errand — fly to the named moon, sell, repeat — so a good never names a
     world that buys it. Finding the market is the play.

     Checked per good against its own tables, so the same word can be legal on
     one row and not on the next: Scorch both digs iron ore and buys it, and
     may be named on that row as the producer. Matching is case-sensitive
     because Glass, Nail, Moss, Brine and the Arc are all things as well as
     places — "black glass off the flows" is not the moon. */
  const allPorts = ['Tassel', 'Slate', 'Cinder', 'Scorch', 'Veyra', 'Whisker', 'Grumm', 'Croak', 'Haven', 'Maw', 'Glass', 'Nail', 'Moss', 'Brine', 'Arc'];
  const portName = { tassel: 'Tassel', slate: 'Slate', cinder: 'Cinder', scorch: 'Scorch', veyra: 'Veyra', whisker: 'Whisker', grumm: 'Grumm', croak: 'Croak', haven: 'Haven', maw: 'Maw', glass: 'Glass', nail: 'Nail', moss: 'Moss', brine: 'Brine', arc: 'Arc' };
  for(const g of GOODS){
    assert.ok(g.nature && g.nature.length > 20, `${g.id} has no nature line`);
    assert.match(g.nature, /[.!?]$/, `${g.id}: the nature line does not finish its sentence`);
    /* Producers may be named on their own row; buyers never. */
    const makers = new Set((g.producedAt ?? []).map(id => portName[id]));
    const sells = new Set([...(g.buyers ?? []), ...(g.lovedBy ?? [])].map(id => portName[id]).filter(Boolean));
    for(const port of allPorts){
      if(makers.has(port)) continue;
      const named = new RegExp(`\\b${port}\\b`);
      assert.ok(!named.test(g.nature) || !sells.has(port),
        `${g.id} names ${port}, which buys it: "${g.nature}"`);
      assert.ok(!named.test(g.blurb) || !sells.has(port),
        `${g.id}'s hint names ${port}, which buys it: "${g.blurb}"`);
    }
  }
});

test('who loves a thing and who merely wants it are two lists, and nobody is on both', () => {
  /* What Wicket knows, in the words the goods table uses: sometimes a port,
     sometimes a whole people. The second list is the first taken out of the
     buyer list — by the ports each word *means*, not by the word itself.
     Cider is loved by the otters and its buyer list also names Tassel, which
     is an otter port: saying Tassel merely wants it would be wrong. */
  assert.equal(S.lovedByWords('tideglass'), 'Brine');
  assert.equal(S.wantedByWords('tideglass'), 'the frogs');
  assert.equal(S.lovedByWords('cider'), 'the otters');
  assert.ok(!/Tassel/.test(S.wantedByWords('cider')), `Tassel loves cider and is listed as merely wanting it: ${S.wantedByWords('cider')}`);
  assert.equal(S.lovedByWords('ironore'), '', 'nobody loves iron ore, and the line should be empty rather than awkward');
  assert.ok(S.wantedByWords('ironore').length > 0);
  for(const g of GOODS){
    const loved = S.lovedByWords(g.id), wanted = S.wantedByWords(g.id);
    for(const word of wanted.split(/,| and /).map(w => w.trim()).filter(Boolean)){
      assert.ok(!loved.split(/,| and /).map(w => w.trim()).includes(word), `${g.id}: ${word} is on both lists`);
    }
  }
});

test('the appraisal is the appraiser\'s, and the menu says so until she is aboard', () => {
  /* A page check, because the trading menu lives in the page. Two things turn
     on the berth and both have to keep turning on it: what a stall would pay
     for the goods it wants, and which of a people's ports is the one that
     loves a thing. What a thing *is* turns on nothing — that is written on the
     crate and anybody can read it. */
  const html = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(html, /const priced = !!state\.crew\?\.appraiser/, 'the bottom lists no longer price on the berth');
  assert.match(html, /priced \? ` <span class="\$\{cls\}">\$\{S\.fmtMoney\(r\.price\)\}/, 'the prices are not behind `priced`');
  const appraisal = html.match(/function showAppraisal\(gid\)\{([\s\S]*?)\n\}/);
  assert.ok(appraisal, 'the appraisal popup is gone');
  assert.match(appraisal[1], /state\.crew\?\.appraiser/, 'the appraisal does not check the berth');
  assert.match(appraisal[1], /g\.nature/, 'the appraisal does not say what the thing is');
  // And the nature is offered on hover as well as on a press.
  assert.match(html, /title="\$\{esc\(g\.nature \?\? ''\)\}"/, 'the "i" has no hover text');
});

test('upgrades come in complete ladders with a stock fitting at the bottom', () => {
  /* Three buyable sizes each, over the one the ship came with. The stock
     fitting is tier 0 and is on no rack anywhere: you own it before you have
     been anywhere, so there is nothing to sell you. */
  for(const kind of ['tank', 'hold']){
    const ladder = S.tiers(kind);
    assert.deepEqual(ladder.map(u => u.tier), [0, 1, 2, 3], `${kind} ladder`);
    for(const u of ladder){ assert.ok(Number.isFinite(u.value) && u.value > 0, `${u.id} has a value`); }
    for(let i = 1; i < ladder.length; i++) assert.ok(ladder[i].value > ladder[i - 1].value, `${kind}: tier ${i} is bigger than the one below`);
    assert.equal(ladder[0].soldAt, null, `${kind}: the stock fitting is not for sale`);
    assert.ok(ladder[0].starter, `${kind}: the stock fitting says it is the starter`);
  }
  assert.equal(S.tiers('engine').length, 0, 'there is no engine to buy any more');
  for(const key of ['heatShield', 'tempControl', 'gravSensors', 'cryoCooling']) assert.ok(UPGRADES.some(u => u.key === key), `a ${key} upgrade exists`);
  for(const u of UPGRADES){
    if(u.soldAt) for(const p of u.soldAt) assert.ok(PORTS[p], `${u.id} sold at unknown ${p}`);
    if(u.tier > 0 || u.kind === 'key') assert.ok(u.price > 0, `${u.id} is bought, so it has a price`);
  }
  /* Tanks and holds are basics: anywhere with a pump will fit one. The rest
     name their bench, and the one that is not Emberkin work says so. */
  const yards = Object.keys(PORTS).filter(p => PORTS[p].fuelPricePerKms != null).sort();
  for(const id of ['tank_1', 'tank_2', 'tank_3', 'hold_1', 'hold_2', 'hold_3']){
    assert.deepEqual([...UPGRADES.find(x => x.id === id).soldAt].sort(), yards, `${id} is on every rack`);
  }
  assert.deepEqual(UPGRADES.find(u => u.id === 'gravsensors').soldAt, ['nail'], 'the cats sell the sensors');
  for(const id of ['tempcontrol', 'heatshield', 'cryocooling']){
    assert.deepEqual(UPGRADES.find(u => u.id === id).soldAt, ['cinder'], `${id} comes off an Emberkin bench`);
  }
});

test('the second and third size of anything is engineer\'s work', () => {
  /* Coin buys the first step up. After that a yard wants somebody aboard who
     can put the hull back together, and that is the berth quest #6 fills. */
  const s = newDocked(3, 'slate');
  s.money = 500000;
  for(const id of ['tank_1', 'hold_1']) assert.ok(S.canBuyUpgrade(s, id).ok, `${id} needs no crew`);
  S.buyUpgrade(s, 'tank_1'); S.buyUpgrade(s, 'hold_1');
  for(const id of ['tank_2', 'hold_2']){
    const no = S.canBuyUpgrade(s, id);
    assert.equal(no.ok, false, `${id} is refused with an empty berth`);
    assert.match(no.reason, /engineer/i);
  }
  s.crew.engineer = { role: 'engineer', from: 'enginetrouble', joinedAt: 0 };
  for(const id of ['tank_2', 'hold_2']) assert.ok(S.canBuyUpgrade(s, id).ok, `${id} opens once the berth is filled`);
  S.buyUpgrade(s, 'tank_2'); S.buyUpgrade(s, 'hold_2');
  assert.ok(S.canBuyUpgrade(s, 'tank_3').ok && S.canBuyUpgrade(s, 'hold_3').ok, 'and the third size after it');
  assert.ok(Math.abs(S.kms(s.tank) - S.tiers('tank')[2].value) < 1e-9, 'the tank that was fitted is the tank that is aboard');
});

test('cryo hull cooling goes on over heat shielding, not instead of it', () => {
  const s = newDocked(3, 'cinder');
  s.money = 500000;
  s.crew.engineer = { role: 'engineer', from: 'enginetrouble', joinedAt: 0 };
  const no = S.canBuyUpgrade(s, 'cryocooling');
  assert.equal(no.ok, false);
  assert.match(no.reason, /heat shielding/i);
  assert.ok(S.buyUpgrade(s, 'heatshield').ok);
  assert.ok(S.canBuyUpgrade(s, 'cryocooling').ok, 'and then it will go on');
});

test('the text has every line the game asks for', () => {
  /* The glossary shrank from 18 to 9 when the terms stopped needing a
     translation: "low point" and "docking range" explain themselves, so what
     is left is the handful that genuinely has something to say. Every entry
     still carries the technical word a KSP player would know it by. */
  assert.ok(GLOSSARY.length >= 8);
  for(const g of GLOSSARY) assert.ok(g.term && g.plain && g.tip, `glossary entry ${g.term}`);
  for(const id of Object.keys(PORTS)){
    const p = TEXT.ports[id];
    assert.ok(p && p.blurb && p.arrival?.length >= 3 && p.trade?.length >= 3 && p.rumours?.length >= 3, `text for ${id}`);
  }
  for(const s of ['emberkin', 'otter', 'cat', 'frog']){
    const sp = TEXT.species[s];
    assert.ok(sp && sp.onGift && sp.greeting, `species text for ${s}`);
  }
  for(const k of ['tollOffer', 'tollPaidCoin', 'tollPaidCargo', 'tollGiftLater', 'towDry', 'towCrash', 'towAtmosphere', 'bankDebt', 'firstTransfer', 'firstAssist', 'firstAerobrake', 'mawArrival']){
    assert.ok(TEXT.events[k], `event text ${k}`);
  }
  assert.ok(TEXT.events.tollOffer.length >= 3 && TEXT.events.tollOffer.every(v => v.captain && v.line));
  assert.ok(/\?\s*$/.test(TEXT.events.mawArrival.trim()), 'the Maw ends on a question, as the design leaves it');
  /* The lesson is nine steps now and each one is a step of the opening quest,
     so the two lists have to stay the same shape as each other. */
  /* Fourteen cards: four about reading the chart, nine about flying the
     errand, and one that says well done and goes away. */
  assert.equal(TEXT.tutorial.length, 14);
  for(const t of TEXT.tutorial) assert.ok(t.step && t.title && t.body, `tutorial step ${t.step}`);
  assert.deepEqual(TEXT.tutorial.slice(0, 4).map(t => t.step), ['look', 'find', 'focus', 'back'],
    'the lesson no longer opens by teaching the chart');
  assert.equal(TEXT.tutorial[TEXT.tutorial.length - 1].step, 'done', 'the lesson does not end on a goodbye');
  assert.equal(new Set(TEXT.tutorial.map(t => t.step)).size, TEXT.tutorial.length, 'two cards share a name');
  for(const t of TEXT.tutorial){
    /* The page breaks a card on a blank line and puts the rest in one
       paragraph, so a lone newline would be a line break that vanishes. */
    assert.doesNotMatch(t.body, /(^|[^\n])\n(?!\n)/, `${t.step}: a single newline in the body`);
    assert.ok(t.body.length <= 400, `${t.step}: ${t.body.length} characters is more card than screen`);
    assert.ok(t.title.length <= 44, `${t.step}: the title is too long for the card`);
  }
  assert.ok(TEXT.quests?.length >= 1, 'there is an opening quest');
  for(const q of TEXT.quests){
    assert.ok(q.id && q.title && q.giver && q.blurb && q.done, `quest ${q.id} has its words`);
    assert.ok(['retrieval', 'delivery', 'shopping', 'chain', 'message'].includes(q.type), `quest ${q.id}: type ${q.type}`);
    /* Steps are built from the type, not written out — so what the words have
       to supply is only the wording a generator would do worse, and it has to
       line up with the steps the type actually earns. */
    const built = S.questSteps(q);
    assert.ok(built.length >= 1 && built.every(st => st.id && st.text), `quest ${q.id} builds no steps`);
    assert.ok((q.steps ?? []).length <= built.length, `quest ${q.id} writes more step text than it has steps`);
    for(const st of q.goods ?? []) assert.ok(GOODS.some(g => g.id === st.good), `quest ${q.id} wants unknown ${st.good}`);
    for(const id of [q.from, q.to, ...(q.stops ?? [])]) if(id) assert.ok(PORTS[id], `quest ${q.id} names unknown port ${id}`);
  }
  for(const k of ['docked', 'undocked', 'burn', 'soiEnter', 'soiExit', 'sold', 'bought', 'towed', 'tolled', 'refuelled', 'upgraded']){
    assert.match(TEXT.logTemplates[k], /\{\w+\}/, `log template ${k} has a placeholder`);
  }
  // One ship, one name: she is the Skipper.
  assert.deepEqual(TEXT.shipNames, ['Skipper']);
  assert.ok(TEXT.captainLines.onStranded.length >= 3);
});

/* --------------------------------------------------------------- film */

/* The opening film is drawn on a canvas, so what can be checked under Node is
 * its timeline and its art — which is most of what goes wrong with one. A
 * cinematic that outstays its welcome is the classic fault, and it is the one
 * nobody notices in review because everybody skips it after the first time. */

test('the opening film is over in five to seven seconds, beats and all', () => {
  assert.ok(DURATION >= 5 && DURATION <= 7, `the film runs ${DURATION}s`);
  assert.equal(BEATS[0].at, 0, 'the film starts at nought');
  for(let i = 1; i < BEATS.length; i++){
    assert.ok(BEATS[i].at > BEATS[i - 1].at, `beat ${BEATS[i].name} does not come after ${BEATS[i - 1].name}`);
    assert.ok(BEATS[i].at < DURATION, `beat ${BEATS[i].name} is after the end of the film`);
  }
  assert.ok(BEATS.some(b => b.name === 'space'), 'no beat called space');
  for(const b of BEATS) assert.equal(beatAt(b.at), b.name, `${b.name} is not what is playing at its own mark`);
  /* The page's caption is hung on its own time rather than on a beat, so it
     can sit where it reads best rather than where something happens to happen.
     It needs the whole of its 1.2s reveal inside the film, and then a moment
     to be read, or it arrives to be dissolved. */
  assert.ok(CAPTION_AT > BREACH, 'the caption comes up before the ship is out of the water');
  assert.ok(CAPTION_AT + 1.2 < DURATION - 0.5, `the caption cannot finish appearing: ${CAPTION_AT} of ${DURATION}`);
  assert.equal(beatAt(-1), BEATS[0].name, 'before the beginning is the first beat');
  assert.equal(beatAt(DURATION * 2), BEATS[BEATS.length - 1].name, 'and after the end is the last');
});

test('the climb starts in the water, never goes backwards, and ends in space', () => {
  assert.equal(ascent(0), 0, 'it is in the water at nought');
  assert.equal(ascent(BREACH), 0, 'and still in it at the breach');
  assert.ok(ascent(BREACH + 0.01) > 0, 'and out of it the instant after');
  let last = -1;
  for(let t = 0; t <= DURATION + 1; t += DURATION / 400){
    const h = ascent(t);
    assert.ok(h >= last - 1e-12, `the climb went backwards at ${t.toFixed(2)}s`);
    assert.ok(h >= 0 && h <= 1, `the climb left [0,1] at ${t.toFixed(2)}s`);
    last = h;
  }
  assert.equal(ascent(DURATION), 1, 'the film ends at the top of the climb');
  assert.equal(ascent(DURATION + 5), 1, 'and stays there');
});

test('the sky goes out as it climbs, and is a colour the whole way', () => {
  const lum = c => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  let last = Infinity;
  for(let h = 0; h <= 1.0001; h += 0.02){
    const sky = skyAt(h);
    for(const key of ['top', 'low', 'sea', 'glow']){
      assert.equal(sky[key].length, 3, `${key} is not a colour at h=${h}`);
      for(const ch of sky[key]) assert.ok(Number.isFinite(ch) && ch >= 0 && ch <= 255, `${key} is off the end of the ramp at h=${h}`);
    }
    /* The first stretch brightens on purpose — it is dawn at the water and
       full day a few kilometres up — but from the top of that on, the zenith
       only ever goes out, which is what climbing out of the air is. */
    if(h >= 0.2){
      /* A step of slack: the ramp rounds to whole channels, and a blue that
         deepens can gain a point of blue while losing two of everything else. */
      assert.ok(lum(sky.top) <= last + 2, `the sky brightened again at h=${h.toFixed(2)}`);
      last = lum(sky.top);
    }
  }
  // And over the film it is not slack at all: each stretch is properly darker.
  let prev = Infinity;
  for(const h of [0.2, 0.4, 0.6, 0.8, 1]){
    assert.ok(lum(skyAt(h).top) < prev - 4, `the sky did not go out between the last mark and h=${h}`);
    prev = lum(skyAt(h).top);
  }
  assert.ok(lum(skyAt(1).top) < lum(skyAt(0).top) * 0.5, 'space is no darker than the dawn it started in');
  assert.ok(lum(skyAt(1).top) < 12, 'the film does not end on a black sky');
  assert.deepEqual(skyAt(-1), skyAt(0), 'below the water is the sky at the water');
  assert.deepEqual(skyAt(2), skyAt(1), 'and above the top is the top');
});

test('the lighter is a rectangle of pixels the painter knows every letter of', () => {
  assert.equal(ROCKET.rows.length, ROCKET.h, 'the grid is not as tall as it says');
  for(const [i, row] of ROCKET.rows.entries()){
    assert.equal(row.length, ROCKET.w, `row ${i} is not ${ROCKET.w} across`);
    for(const ch of row) assert.ok(ch in ROCKET.legend, `row ${i} uses '${ch}', which the legend does not have`);
  }
  // Nose up: the fins are the widest part and they are at the bottom, which is
  // the one thing a rocket cannot get wrong.
  const width = row => [...row].filter(ch => ROCKET.legend[ch]).length;
  const widest = ROCKET.rows.reduce((best, row, i) => width(row) > width(ROCKET.rows[best]) ? i : best, 0);
  assert.ok(widest > ROCKET.h * 0.6, 'the widest part of the lighter is not near its tail');
  assert.ok(width(ROCKET.rows[0]) < width(ROCKET.rows[widest]), 'the nose is not narrower than the fins');
});

/* --------------------------------------------------------------- crew */

test('three jobs pay in a person, and finishing one fills that berth', () => {
  /* The only reward that does not land in the purse. Each of the three names
     a berth, the berths are the three the menu shows, and the peoples line up
     with the quest givers: an Emberkin engineer, a cat navigator, a frog
     appraiser. */
  const paying = S.QUESTS.filter(q => q.crew);
  assert.deepEqual(paying.map(q => q.crew), ['engineer', 'navigator', 'appraiser']);
  const roles = Object.fromEntries(TEXT.crew.roles.map(r => [r.id, r]));
  for(const q of paying){
    assert.ok(roles[q.crew], `${q.id} pays in "${q.crew}", which is not a berth`);
    assert.equal(q.rep, roles[q.crew].species, `${q.id}: ${q.rep} job for a ${roles[q.crew].species}`);
    assert.ok(roles[q.crew].person?.name && roles[q.crew].person?.line, `${q.crew} has nobody to be`);
  }

  // Flying one to the end puts somebody in the berth, and only that one.
  for(const q of paying){
    const s = S.newGame(11);
    s.quests = []; s.money = 300000; s.keys.tempControl = true; s.keys.astrolabe = true;
    s.dockedAt = q.from; s.justLeft = null;
    assert.ok(S.acceptQuest(s, q.id).ok, q.id);
    const live = s.quests.find(l => l.id === q.id);
    const steps = S.questSteps(q);
    let guard = 0;
    while(!live.done && guard++ <= steps.length + 2){
      const st = steps[live.step];
      assert.ok(st, `${q.id} ran out of steps`);
      if(st.kind === 'acquire'){
        s.dockedAt = st.port ?? S.goodById(st.good).producedAt[0];
        assert.ok(S.buy(s, st.good, st.qty - S.carrying(s, st.good)).ok, `${q.id}: could not buy ${st.good}`);
      }else s.dockedAt = st.port;
      S.tick(s, 0.01);
    }
    assert.ok(live.done, `${q.id} did not finish`);
    assert.ok(s.crew[q.crew], `${q.id} finished and the ${q.crew} berth is still empty`);
    const filled = Object.entries(s.crew).filter(([, v]) => v).map(([k]) => k);
    assert.deepEqual(filled, [q.crew], `${q.id} filled ${filled}`);
    /* And they do nothing. Crew is a face in a menu until it is not, so this
       is what notices the day somebody wires one up. */
    assert.deepEqual(Object.keys(s.crew[q.crew]).sort(), ['from', 'joinedAt', 'role']);
  }
});

/* ------------------------------------------------------- the distress call */

/* Adrift with a dead tank, somewhere out past Tassel. */
function adrift(opts = {}){
  const g = S.newGame(5);
  g.dockedAt = null; g.justLeft = null; g.justLeftAt = -1e9;
  g.ship = { body: 'lamp', r: opts.r ?? [1.4, 0.2], v: [0, 0.01] };
  g.dv = 0;
  g.t = opts.t ?? 50;
  g.money = opts.money ?? 1000;
  g.lastPort = opts.lastPort ?? 'veyra';
  return g;
}

test('a distress call goes to the last dock and costs half of everything', () => {
  // Adrift out past the Belt, with the last mooring two au sunward of that.
  const g = adrift({ r: [-2, 1.2] });
  assert.ok(S.canCallDistress(g));
  const q = S.distressQuote(g);
  /* The point of the feature: the port that answers is the one you last tied
     up at, which is not the one a tug would come from. */
  assert.equal(q.port, 'veyra');
  assert.notEqual(q.port, S.nearestPort(g).id, 'the test is worthless if the last dock is also the nearest');
  assert.equal(q.cost, 500);

  const before = g.money;
  const r = S.callDistress(g);
  assert.equal(r.port, 'veyra');
  assert.equal(g.dockedAt, 'veyra', 'and the ship is tied up there');
  assert.equal(g.money, before / 2, 'half the purse, and no more');
  assert.equal(g.debt, 0, 'a share is never a debt');
  assert.deepEqual(g.nodes, [], 'the plan went with the tank');
  assert.equal(g.stats.rescues, 1);
  assert.ok(g.visited.includes('veyra'));
  // The ship is really at that dock, not merely labelled with it.
  assert.ok(O.dist(S.shipAbsPos(g), O.absState(world, "veyra", g.t).r) < world.get("veyra").soi);
});

test('half of nothing is nothing, so running dry never costs a save', () => {
  /* The design guarantee. A tow has a price and a purse can be empty — that
     is what the harbour bank is for — but a share can always be paid. */
  const g = adrift({ money: 0, lastPort: 'slate' });
  const r = S.callDistress(g);
  assert.ok(r, 'a broke pilot is still fetched');
  assert.equal(r.cost, 0);
  assert.equal(g.money, 0);
  assert.equal(g.debt, 0);
  assert.equal(g.dockedAt, 'slate');
  // And one coin buys a rescue and keeps the coin.
  const h = adrift({ money: 1, lastPort: 'slate' });
  assert.equal(S.distressQuote(h).cost, 0);
});

test('a rescue never puts a dry ship somewhere it could not leave', () => {
  /* The Arc and the Maw sell nothing to burn. Being set down at one with an
     empty tank is not a rescue, it is a slower version of the same problem. */
  for(const id of Object.keys(PORTS)){
    if(PORTS[id].fuelPricePerKms != null) continue;
    const g = adrift({ lastPort: id, r: [2.2, 0.3] });
    const q = S.distressQuote(g);
    assert.notEqual(q.port, id, `a call from a dry ship was answered by ${id}, which sells no fuel`);
    assert.equal(q.home, false, 'and it says so rather than pretending');
    assert.ok(PORTS[q.port].fuelPricePerKms != null, `${q.port} sells no fuel either`);
  }
});

test('help answers a tank that is empty, and only that', () => {
  // A metre per second left is still a ship that can change its mind.
  const low = adrift(); low.dv = 1e-6;
  assert.equal(S.canCallDistress(low), false);
  assert.equal(S.callDistress(low), null, 'and calling anyway does nothing');
  // Tied up is not adrift.
  const moored = S.newGame(5); moored.dv = 0; moored.dockedAt = 'tassel';
  assert.equal(S.canCallDistress(moored), false);
  assert.equal(S.callDistress(moored), null);
});

test('a ship remembers the last dock it was tied up at', () => {
  const g = S.newGame(5);
  assert.equal(g.lastPort, CONST.START_PORT, 'a new ship counts where it was let go from');
  /* Undocking must not forget it — that is the whole point of the record, and
     a ship is never docked at the moment it needs rescuing. */
  const near = S.newGame(5);
  near.dockedAt = null; near.justLeft = null;
  const veyra = world.get('veyra');
  const st = O.circularState(veyra.mu, veyra.dockAlt, 0);
  near.ship = { body: 'veyra', r: st.r, v: st.v };
  assert.ok(S.dock(near).ok, 'docked at Veyra');
  assert.equal(near.lastPort, 'veyra');
  S.undock(near);
  assert.equal(near.lastPort, 'veyra', 'casting off does not erase where you cast off from');

  // A save from before anybody could call for help still knows who to call.
  const old = JSON.parse(S.serialize(near));
  delete old.lastPort;
  assert.ok(PORTS[S.restore(old).lastPort], 'a save with no record of it gets a workable one');
});

test('the page offers the distress call when the tank is dead', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(PLAY, /data-act="distress"/, 'there is no button to press');
  assert.match(PLAY, /distress\(\)\s*\{\s*showDistress\(\)/, 'and nothing listening for it');
  assert.match(PLAY, /S\.callDistress\(state\)/, 'the button never reaches the game');
});

test('the crew menu has a captain to show and three berths to leave empty', () => {
  const c = TEXT.crew;
  assert.ok(c?.captain?.role && c.captain.name && c.captain.line, 'the captain has no card');
  assert.ok(SPECIES[c.captain.species], `captain species ${c.captain.species}`);
  assert.equal(c.roles.length, 3);
  // Each berth has somebody waiting to be in it, and a portrait to be them with.
  for(const r of c.roles) assert.ok(PORTRAITS[r.id], `no portrait for the ${r.id}`);
  assert.deepEqual(c.roles.map(r => r.id), ['engineer', 'navigator', 'appraiser']);
  for(const r of c.roles){
    assert.ok(r.name && r.does, `${r.id} has no words`);
    assert.ok(SPECIES[r.species], `${r.id}: species ${r.species}`);
  }
  /* The three berths are the three jobs in the line that pay in a person, so
     the peoples have to match: an Emberkin engineer, a cat navigator, a frog
     appraiser. If one of those ever moves, this is what notices. */
  assert.deepEqual(c.roles.map(r => r.species), ['emberkin', 'cat', 'frog']);

  /* Everybody aboard is somebody by name. The names live in narrative.json and
     reach the page through a build step, so this is also what notices a
     text.js that was not rebuilt after the fiction changed. */
  assert.equal(c.captain.name, 'Finn');
  assert.deepEqual(c.roles.map(r => r.person?.name), ['Kiran', 'Tsuki', 'Wicket']);

  /* And everybody aboard is the gender they are, in every line written about
     them. Pronouns are what prose edits break: the scene where somebody joins
     the ship lives in a quest, their blurb lives in the crew table, and the two
     are edited months apart. Checked only where a person is the subject of the
     text — the cat's scene belongs to Captain Kaede, who is not the one being
     hired, so it is not read here. */
  const he = { yes: /\b(he|him|his|himself)\b/i, no: /\b(she|her|hers|herself)\b/i };
  const she = { yes: /\b(she|her|hers|herself)\b/i, no: /\b(he|him|his|himself)\b/i };
  const cast = [
    ['Kiran', he, ['enginetrouble']],
    ['Wicket', he, ['appraisal']],
    ['Tsuki', she, []],
  ];
  for(const [name, want, questIds] of cast){
    const role = c.roles.find(r => r.person.name === name);
    const texts = [role.person.line, ...questIds.flatMap(id => {
      const q = S.questById(id);
      return [q.blurb, q.done];
    })];
    for(const t of texts){
      assert.ok(!want.no.test(t), `${name} is written with the wrong pronoun: "${t}"`);
    }
    if(questIds.length) assert.ok(texts.some(t => want.yes.test(t)), `${name} is never given a pronoun at all`);
  }
  for(const r of c.roles) assert.ok(r.person?.line, `${r.id} has nobody in it to say anything`);

  // And a new ship carries a berth for each of them, with nobody in it.
  const s = S.newGame(5);
  assert.deepEqual(s.crew, { engineer: null, navigator: null, appraiser: null });
  // A save from before there were berths still gets them.
  const old = JSON.parse(S.serialize(s));
  delete old.crew;
  assert.deepEqual(S.restore(old).crew, { engineer: null, navigator: null, appraiser: null });
});

test('a portrait is a square grid the palette can actually paint', () => {
  /* Portraits are hand-drawn character grids like the Arc and the Maw, only
     bigger, and a mistyped row is invisible until somebody opens the menu.
     Checked as data, because there is no canvas under Node. */
  assert.ok(Object.keys(PORTRAITS).length >= 2);
  for(const [id, art] of Object.entries(PORTRAITS)){
    assert.equal(art.rows.length, PORTRAIT_SIZE, `${id}: ${art.rows.length} rows`);
    for(const [i, row] of art.rows.entries()){
      assert.equal(row.length, PORTRAIT_SIZE, `${id} row ${i} is ${row.length} wide`);
      for(const ch of row) assert.ok(ch in art.legend, `${id} row ${i} uses "${ch}", which the legend has no colour for`);
    }
  }
  // Nothing is drawn under Node, and asking for one says so rather than throwing.
  assert.equal(portraitURL('captain'), null);
  assert.equal(portraitURL('nobody-by-that-name'), null);
});

/* --------------------------------------------------------------- page */

/* The page is not importable under Node — it is a document with a module in
 * it — so what can be checked here is the wiring, as text. That is enough to
 * catch the failure this test was written for: the anchor in the chart
 * controls was styled, given a tooltip, and shown the moment a harbour would
 * take your lines, and nothing anywhere listened for a click on it. The
 * button lit up and did nothing, and only the `d` key and the HUD hint
 * actually docked. */
test('the lesson allows one mark on the path at a time, and says nothing about it', () => {
  const s = S.newGame(5);
  S.undock(s);
  const t = s.t + S.MIN_LEAD * 2;
  assert.equal(S.tutorialRunning(s), true, 'a new game is mid-lesson');
  assert.equal(S.maxNodes(s), 1);

  assert.equal(S.addNode(s, t), 0, 'the first mark goes down');
  assert.equal(S.addNode(s, t + 0.01), -1, 'and the second does not');
  assert.equal(s.nodes.length, 1, 'nothing happened, which is the whole ask');

  // Rubbing one out frees the berth, so the lesson is never stuck.
  S.removeNode(s, 0);
  assert.equal(S.addNode(s, t), 0, 'a mark can always be replaced');

  // Waving the lesson off, or finishing it, gives all six back.
  for(const flag of ['tutorialSkipped', 'tutorialDone']){
    const g = S.newGame(5);
    S.undock(g);
    g.flags[flag] = true;
    assert.equal(S.tutorialRunning(g), false, flag);
    assert.equal(S.maxNodes(g), S.MAX_NODES);
    for(let i = 0; i < 9; i++) S.addNode(g, g.t + S.MIN_LEAD * 2 + 0.01 * i);
    assert.equal(g.nodes.length, S.MAX_NODES, `${flag}: the six-mark ceiling still holds`);
  }

  /* And the page offers no way to trip over it: the button is disabled rather
     than clickable-and-refusing, and it carries no explanation while the
     lesson is running. A beginner who has not been told they may have six
     does not need telling they may not. */
  const html = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(html, /const room = state\.nodes\.length < S\.maxNodes\(state\);/);
  assert.doesNotMatch(html, /No room for another burn on this path/);
});

test('the lesson ends when the pebble is in Nellie\'s hand, and not a moment before', () => {
  /* A text check, because the lesson's tests live inside the page's module and
     there is no canvas or DOM here to run them against. It is worth the
     awkwardness, because the last card has been wrong twice in two different
     ways and the list is folded cumulative from the back, so whatever the last
     card accepts the whole lesson accepts.

     First it was a bare "docked at Tassel", which is true two minutes into a
     new game — the opening orbit sits inside Tassel's own harbour mouth and
     the quiet window expires on its own — so a brand new ship finished the
     whole lesson without moving. Then it was "Tassel would take your lines",
     which is true while the ship is still in the air with the pebble in the
     hold: being able to dock is not docking, and the handover is what finishes
     the job. It asks the quest now, which is the only thing that cannot be
     true early. */
  const html = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  const list = html.match(/const raw = \[([\s\S]*?)\n  \];/);
  assert.ok(list, 'the lesson no longer keeps its cards in one list; check this still holds');
  const lines = list[1].split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('/*') && !l.startsWith('*') && !l.startsWith('//'));
  const last = lines[lines.length - 1];
  assert.match(last, /delivered/, `the last card of the lesson is "${last}", which does not ask for the pebble`);
  assert.ok(!/dockable/i.test(last), `the last card is "${last}": being able to dock is not docking`);
  // And "delivered" means the errand is finished, not that it is nearly finished.
  assert.match(html, /const delivered = [^\n]*q\.id === 'pebble' && q\.done/,
    'the lesson\'s last card no longer reads the quest it is about');

  // The fold really is from the back, which is what makes all of that matter.
  assert.match(html, /raw\[i\] = raw\[i\] \|\| raw\[i \+ 1\]/);
});

test('every button the page draws for itself has something listening to it', () => {
  const html = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/<button id="([a-z0-9-]+)"/g)].map(m => m[1]);
  assert.ok(ids.length >= 4, 'no buttons found: the page has changed shape');
  for(const id of ids){
    const wired = new RegExp(`\\$\\('${id}'\\)\\.addEventListener\\('click'`).test(html);
    assert.ok(wired, `#${id} is drawn but nothing listens for a click on it`);
  }
  // And the anchor in particular, which is the only way to dock on a phone.
  assert.match(html, /\$\('dock-go'\)\.addEventListener\('click'/, 'the dock button is not wired');
});

/* The title screen is one fixed screen laid over the chart, and the body is
 * overflow:hidden for the chart's sake — so anything that does not fit is not
 * merely below the fold, it is unreachable. That is how a phone once lost the
 * back link, and the net under it is that `main` scrolls when it has to. The
 * column is told its width for the same reason: an auto one takes its size
 * from its contents. */
test('the title screen can always be got out of', () => {
  const html = readFileSync(new URL('../public/orbital-trader/index.html', import.meta.url), 'utf8');
  const main = html.match(/\n {2}main\{([\s\S]*?)\n {2}\}/)?.[1];
  assert.ok(main, 'the title screen no longer has a main rule to check');
  assert.match(main, /overflow-y:\s*auto/, 'a title screen that does not fit has no way to reach its own back link');
  assert.match(main, /grid-template-columns/, 'main is a grid with an auto-sized column again');
  assert.match(html, /class="back"/, 'there is no way back to the other games');
});

/* The four cards at the front of the lesson are passed with the chart rather
 * than with the ship — a drag, a zoom, a tap on the moon, and the way back —
 * and none of those leave a mark on the game state by themselves. The page
 * has to notice them as they happen or the card never clears, which is the
 * one way this lesson can strand somebody. */
test('the lesson notices the four things that only the chart knows', () => {
  const html = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  for(const flag of ['chartPanned', 'sawTarget', 'lookedAtTarget', 'lookedBack']){
    assert.ok(new RegExp(`noteLook\\('${flag}'\\)`).test(html), `nothing ever sets ${flag}`);
  }
  // And each of them is read back by the tests the card list is built from.
  for(const flag of ['chartPanned', 'sawTarget', 'lookedAtTarget', 'lookedBack']){
    assert.ok(new RegExp(`f\\.${flag}`).test(html), `${flag} is set and never read`);
  }
  // The moon has to actually be in the frame, not merely somewhere on the sky.
  assert.match(html, /function targetOnScreen\(\)/, 'nothing works out whether the moon is on screen');
  assert.match(html, /chart\.labelInsets/, 'on-screen does not account for the HUD and the panel');
});

/* The film is six and a half seconds long and the page is the only thing that
 * decides whether anybody has to watch them. These are the four rules it is
 * held to: a new ship gets it, a saved ship does not, reduced motion does not,
 * and the clock waits for it either way. */
test('the opening film plays for a new ship and gets out of the way of every other one', () => {
  const html = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(html, /import \{ playIntro \} from '\.\/intro\.js'/, 'the page does not import the film');
  assert.match(html, /<canvas id="intro-art"/, 'the film has nothing to draw on');
  assert.match(html, /aria-label="[^"]+"/, 'the film canvas says nothing to a reader');
  // A save is picked back up without a launch, and less motion means none.
  assert.match(html, /return freshShip && !reduced;/, 'the film no longer asks whose ship this is');
  assert.match(html, /if\(filmWanted\(fresh\)\) rollFilm\(startClock\);\n\s*else startClock\(\);/,
    'the clock no longer waits for the film');
  assert.match(html, /function startClock\(\)\{ last = performance\.now\(\); requestAnimationFrame\(frame\); \}/,
    'the clock does not start from the film');
  assert.doesNotMatch(html, /^requestAnimationFrame\(frame\);$/m, 'the loop is started behind the film as well');
});

/* ------------------------------------------------------------- chart */

/* The chart is a canvas, but its camera is arithmetic, and the arithmetic is
 * the part a player can get lost in. Enough of a canvas to make one. */
function stubChart(w = 800, h = 600, ops = null){
  const prev = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  const canvas = {
    width: 0, height: 0,
    getContext: () => paperlessCtx(ops),
    getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }),
  };
  const chart = createChart(canvas, world);
  chart.restore = () => { if(prev === undefined) delete globalThis.window; else globalThis.window = prev; };
  return chart;
}
/* A canvas context that accepts everything and keeps nothing. Enough to run a
 * whole frame under Node, which is the only way to test the things the chart
 * only knows once it has drawn them — where a rail ended up on the screen,
 * for one. Assignments (fillStyle, font) are kept so nothing throws on
 * reading them back; every method is a no-op. */
function paperlessCtx(ops){
  const gradient = { addColorStop(){} };
  return new Proxy({}, {
    get(t, k){
      if(k in t) return t[k];
      if(k === 'createRadialGradient' || k === 'createLinearGradient') return () => gradient;
      if(k === 'measureText') return () => ({ width: 40 });
      // Every other method is a no-op that writes down that it was asked.
      return (...args) => { ops?.push([k, ...args]); };
    },
    set(t, k, v){ t[k] = v; ops?.push([k, v]); return true; },
  });
}
/* One frame's worth of the thing draw() does: read where the followed body is
 * now, and lay the player's pan on top of it. */
function settleOn(chart, id, t){
  chart.camera.anchor = [...O.absState(world, id, t).r];
  chart.settle();
}

/* ------------------------------------------------- crossing a world's rail */

/* A ship falling from Tassel's orbit down towards Veyra's, which is the shape
 * every interplanetary trip in this game has. */
function transferShip(from = 'tassel', toRadius = world.get('veyra').a){
  const g = S.newGame(5);
  g.dockedAt = null; g.justLeft = null; g.t = 0;
  const start = O.absState(world, from, 0);
  const mu = world.get('lamp').mu;
  const r1 = O.norm(start.r);
  const vc = Math.sqrt(mu / r1);
  g.ship = { body: 'lamp', r: [...start.r], v: O.scale(O.unit(start.v), vc * Math.sqrt(2 * toRadius / (r1 + toRadius))) };
  return g;
}

test('a rail crossing sits on the rail, and the world is marked where it will really be', () => {
  const g = transferShip();
  const pred = S.planImmediate(g);
  // Asking for the lot, to check the arithmetic on every one of them.
  const list = railCrossings(world, pred, g.t, { minLead: S.MIN_LEAD, limit: 8 });
  assert.ok(list.length >= 2, `a fall from Tassel's orbit to Veyra's crosses something; found ${list.length}`);
  assert.ok(list.some(c => c.body === 'veyra'), 'including the rail it was aimed at');

  for(const c of list){
    const b = world.get(c.body);
    /* On the rail: the ship's distance from the Lamp equals the rail's own
       distance at that same bearing. This is the whole claim the mark makes,
       and it is the one a sampled polyline would get wrong. */
    const th = Math.atan2(c.r[1], c.r[0]);
    const e = b.e ?? 0, om = b.omega ?? 0;
    const railR = e ? b.a * (1 - e * e) / (1 + e * Math.cos((b.retrograde ? -th : th) - om)) : b.a;
    assert.ok(Math.abs(O.norm(c.r) - railR) < 1e-9, `${b.name}: the mark is ${O.norm(c.r) - railR} au off its own rail`);
    /* And the world's mark is not a guess: it is where that world actually
       is at that moment, which is the half of the pair that makes it a
       reading about timing rather than about geometry. */
    assert.ok(O.dist(c.ghost, O.absState(world, c.body, c.t).r) < 1e-12, `${b.name}: the ghost is not where the world is`);
    assert.ok(c.t > g.t, 'and it is ahead, not behind');
  }
  // Soonest first, so the one that survives the cap is the one about to happen.
  for(let i = 1; i < list.length; i++) assert.ok(list[i].t >= list[i - 1].t, 'crossings come in time order');
});

test('the harbour mouth wears an anchor, and only when it is the harbour you are at', () => {
  /* A dashed circle round a world is the same shape as three other things on
     this chart — a sphere of influence, an atmosphere, a hollow rock. The
     anchor is what says this one is the ring you can tie up inside. Checked
     by watching what the frame actually asks the canvas to draw: the flukes
     are the one curve on the whole chart, so a quadratic tells us the glyph
     went down. */
  const flukes = ops => ops.some(o => o[0] === 'quadraticCurveTo');
  const frame = (ops, near) => {
    const chart = stubChart(800, 600, ops);
    try{
      const g = S.newGame(5);
      g.dockedAt = null; g.justLeft = null;
      chart.camera.follow = 'tassel';
      chart.camera.anchor = [...O.absState(world, 'tassel', 0).r];
      chart.settle();
      chart.frameBody('tassel');
      chart.draw({
        t: 0, now: 0, shipAbs: { r: S.shipAbsPos(g), v: S.shipAbsVel(g) }, shipBody: 'tassel',
        prediction: null, nodes: [], nodePositions: [], apses: [], railCrossings: [],
        nearPort: near, docking: near ? { port: near, ok: true } : null,
      });
    } finally { chart.restore(); }
  };
  const near = []; frame(near, 'tassel');
  const away = []; frame(away, null);
  assert.ok(flukes(near), 'no anchor on the harbour you are approaching');
  assert.ok(!flukes(away), 'an anchor was drawn with no harbour in reach');

  /* And it carries the ring's own meaning rather than a colour of its own:
     green where they will take your lines, amber where they will not yet. */
  const strokes = ops => ops.filter(o => o[0] === 'strokeStyle').map(o => o[1]);
  assert.ok(strokes(near).includes(PALETTE.zone), 'the mouth is not drawn in the harbour green');
  const waiting = [];
  const chart = stubChart(800, 600, waiting);
  try{
    const g = S.newGame(5); g.dockedAt = null; g.justLeft = null;
    chart.camera.follow = 'tassel';
    chart.camera.anchor = [...O.absState(world, 'tassel', 0).r];
    chart.settle(); chart.frameBody('tassel');
    chart.draw({ t: 0, now: 0, shipAbs: { r: S.shipAbsPos(g), v: S.shipAbsVel(g) }, shipBody: 'tassel',
      prediction: null, nodes: [], nodePositions: [], apses: [], railCrossings: [],
      nearPort: 'tassel', docking: { port: 'tassel', ok: false } });
  } finally { chart.restore(); }
  assert.ok(strokes(waiting).includes(PALETTE.zoneWait), 'a mouth you cannot use yet is not drawn in the waiting colour');
  assert.ok(flukes(waiting), 'and it still wears its anchor');
});

/* ----------------------------------------------------- the playtest fixes */

/* The opening orbit with a burn a third of a lap ahead, pushed out to Slate's
 * height: the state card seven leaves a player in, and the one both testers
 * broke by dragging the mark. */
function pushedToSlate(){
  const g = S.newGame(5);
  const tas = world.get('tassel');
  const P = O.elementsFromState(tas.mu, g.ship.r, g.ship.v).period;
  const ix = S.addNode(g, g.t + 0.3 * P);
  const r = O.norm(g.ship.r), vc = Math.sqrt(tas.mu / r);
  g.nodes[ix].prograde = vc * (Math.sqrt(2 * world.get('slate').a / (r + world.get('slate').a)) - 1);
  return { g, ix, P };
}

test('the Astrolabe reads every world that goes round the Lamp, and no moon', () => {
  const s = newDocked(5, 'tassel');
  const rows = S.transferWindows(s);
  const named = rows.map(r => r.id).sort();
  /* Everything on a heliocentric rail except the world you are reading from.
     A moon is reached from the world it belongs to, which is a manoeuvre and
     not a window, so none of them is on the instrument. */
  const want = world.bodies.filter(b => b.parent === 'lamp' && b.id !== 'tassel').map(b => b.id).sort();
  assert.deepEqual(named, want);
  for(const id of ['slate', 'moss', 'scorch', 'brine', 'glass', 'croak', 'haven']){
    assert.ok(!named.includes(id), `${id} is a moon and should not be a window`);
  }

  for(const r of rows){
    assert.ok(['perfect', 'good', 'bad', 'impossible'].includes(r.band), `${r.id}: band ${r.band}`);
    assert.ok(r.cost >= r.best - 1e-9, `${r.id}: leaving today cannot beat the perfect window`);
    assert.ok(Number.isFinite(r.days) && r.days >= 0, `${r.id}: no countdown`);
    /* The bands say what they mean. Impossible is measured against the tank;
       the rest against what this crossing costs when the window is right. */
    if(r.band === 'impossible') assert.ok(r.cost > s.tank, `${r.id}: impossible but ${S.fmtKms(r.cost)} of ${S.fmtKms(s.tank)}`);
    else{
      assert.ok(r.cost <= s.tank, `${r.id}: ${r.band} but beyond the tank`);
      const ratio = r.cost / r.best;
      if(r.band === 'perfect') assert.ok(ratio <= S.WINDOW_BANDS.perfect);
      else if(r.band === 'good') assert.ok(ratio > S.WINDOW_BANDS.perfect && ratio <= S.WINDOW_BANDS.good);
      else assert.ok(ratio > S.WINDOW_BANDS.good);
    }
  }

  /* The number the whole instrument exists for: what a perfect window costs,
     against the delta-v table's 6.5 for the same crossing. Not to the tenth —
     the table idealises both orbits as circles and the instrument reads the
     rail the ship is actually on, and Cinder's is eccentric enough to move
     this a few per cent either way through its year. */
  const c = newDocked(5, 'cinder');
  const best = S.crossingBest(c, 'tassel');
  assert.ok(Math.abs(S.kms(best.cost) - 6.5) < 0.5, `Cinder to Tassel at its best is ${S.fmtKms(best.cost)}, not near the table's 6.5`);
  /* And leaving at the wrong moment is dearer than leaving at the right one —
     the whole reason a player would look at this rather than just going. */
  const now = S.crossingNow(c, 'tassel');
  assert.ok(now.cost >= best.cost - 1e-9);
});

test('the Astrolabe is a tab you do not have until you have bought one', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  const fn = PLAY.slice(PLAY.indexOf('function tabsFor()'), PLAY.indexOf('function openMenu'));
  assert.match(fn, /state\.keys\?\.astrolabe/, 'the tab row does not ask whether the instrument is fitted');
  assert.match(fn, /\['windows', 'Windows'\]/, 'there is no Windows tab to add');
  assert.match(PLAY, /windows: astrolabeTab/, 'the tab is never rendered');
  /* Six is the most this row ever holds, and it fits. Widening a tab or
     lengthening a word here pushes Crew off the end of the panel, which is
     how this was found. */
  const css = PLAY.slice(PLAY.indexOf('  .tab{'), PLAY.indexOf('.tab[aria-selected'));
  assert.match(css, /padding:\.5rem \.34rem/, 'the tab padding no longer fits six of them');
});

test('one button in the corner ties up and casts off, and it is not on the right', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  /* The two menu buttons stay in the right-hand stack; the one that acts on
     the ship has its own corner. */
  const view = PLAY.slice(PLAY.indexOf('<div id="view">'), PLAY.indexOf('</div>', PLAY.indexOf('<div id="view">')));
  assert.ok(view.includes('id="m-ship"') && view.includes('id="m-dock"'), 'the menu buttons left the right-hand stack');
  assert.ok(!view.includes('id="dock-go"'), 'the mooring button is still in the right-hand stack');
  const act = PLAY.slice(PLAY.indexOf('<div id="act">'), PLAY.indexOf('</div>', PLAY.indexOf('<div id="act">')));
  assert.ok(act.includes('id="dock-go"'), 'nothing in the corner');
  assert.match(PLAY, /#act\{[\s\S]*?left:\.8rem/, '#act is not on the left');

  /* One button, two jobs, and the icon follows. `.hidden` is an HTMLElement
     property and these are SVG elements, so assigning it sets an expando the
     browser never reads — which drew the anchor on a moored ship. */
  const render = PLAY.slice(PLAY.indexOf('function renderDockCard'), PLAY.indexOf('/* ---------', PLAY.indexOf('function renderDockCard')));
  assert.match(render, /toggleAttribute\('hidden', moored\)/, 'the anchor is hidden by a property SVG does not have');
  assert.match(render, /toggleAttribute\('hidden', !moored\)/);
  assert.doesNotMatch(render, /\.hidden = moored/, 'back to setting .hidden on an SVG');
  assert.match(render, /b\.hidden = !\(moored \|\| \(docking && docking\.ok\)\)/, 'the button is not shown while moored');
  assert.match(PLAY, /if\(state\.dockedAt\) actions\.undock\(\); else dockIfWeCan\(\);/, 'the button does not cast off');
  /* And `display:block` on the icons beats the browser's rule for [hidden],
     so the attribute needs saying out loud or both icons draw at once. */
  assert.match(PLAY, /#act button svg\[hidden\]\{ display:none; \}/, 'a hidden icon still draws');
});

test('the Astrolabe reads while coasting, which is when it is wanted', () => {
  /* It read nothing at all between worlds. Tied up, a crossing starts at the
     mooring you are at; coasting, the ship is already in the Lamp's frame and
     there is no world to start from — so the departure radius came out zero,
     Lambert was handed a NaN flight time, and every row was dropped. Which is
     the one place a pilot is actually looking at it. */
  const g = S.newGame(5);
  g.keys.astrolabe = true; g.quests = [];
  const mu = world.get('lamp').mu;
  const tas = O.absState(world, 'tassel', 0);
  const f = O.propagate(mu, [...tas.r], O.scale(O.unit(tas.v), Math.sqrt(mu / O.norm(tas.r)) * 1.12), 12);
  g.dockedAt = null; g.justLeft = null; g.justLeftAt = -1e9;
  g.ship = { body: 'lamp', r: f.r, v: f.v }; g.t = 12;

  assert.equal(S.departureName(g), null, 'coasting, there is no world to read from');
  const rows = S.transferWindows(g);
  assert.equal(rows.length, world.bodies.filter(b => b.parent === 'lamp').length,
    'every world is reachable from open space, Tassel included');
  assert.ok(rows.some(r => r.id === 'tassel'), 'the way home is a window too');
  for(const r of rows){
    assert.ok(r.cost > 0 && Number.isFinite(r.cost), `${r.id}: ${r.cost}`);
    assert.ok(r.best > 0 && Number.isFinite(r.best), `${r.id}: no best`);
  }
  /* And out here there is no well to climb: the departure half of a crossing
     is the bare heliocentric burn, with only the far end's gravity to pay
     for. Worked out here the long way so the instrument cannot quietly start
     charging a ship for leaving a world it is not at. */
  const to = world.get('cinder');
  const h = O.hohmann(mu, O.norm(f.r), to.a);
  const capture = Math.max(0, Math.sqrt(Math.max(0, h.dv2 * h.dv2 - 2 * to.mu / to.soi) + 2 * to.mu / to.dockAlt)
    - Math.sqrt(to.mu / to.dockAlt));
  const want = h.dv1 + capture;
  const got = S.crossingBest(g, 'cinder').cost;
  assert.ok(Math.abs(got - want) < 1e-12, `from open space Cinder is ${S.fmtKms(got)}, not ${S.fmtKms(want)}`);
});

test('the Astrolabe is redrawn when the sky has moved, not when the wall clock has', () => {
  /* Every other tab reads the ship; this one reads the sky moving, so it is
     the only one that goes stale sitting still. It is also the dearest thing
     the panel draws, so the redraw is on a budget — and the budget is in game
     days, because game days are what it reads. On a real-time budget alone it
     swept every world twice a second to print the same characters, since at ×1
     the coarsest figure on a row takes about forty-five real minutes to move
     by one digit. */
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  const loop = PLAY.slice(PLAY.indexOf('function frame(now)'), PLAY.indexOf('function renderHud'));
  /* Anchored on the whole condition, because `if(false && …)` still contains
     every piece of it and a looser match let exactly that through. */
  const redraw = /if\(dt > 0 && panelOpen && tab === 'windows'\s*&& now - windowsDrawnAt > WINDOWS_REDRAW_MS\s*&& \(windowsDrawnT == null \|\| Math\.abs\(state\.t - windowsDrawnT\) >= WINDOWS_STEP_DAYS\)\)\{[\s\S]*?renderTab\(\);/;
  assert.match(loop, redraw, 'the loop does not redraw the windows on a budget while the clock runs');
  assert.match(loop, /windowsDrawnT = state\.t;/, 'the game-time budget is never advanced, so it would redraw once and stop');
  const ms = Number(PLAY.match(/const WINDOWS_REDRAW_MS = (\d+)/)?.[1]);
  assert.ok(ms >= 200 && ms <= 2000, `a redraw every ${ms} ms is not a budget`);
  const days = Number(PLAY.match(/const WINDOWS_STEP_DAYS = ([\d.]+)/)?.[1]);
  assert.ok(days > 0 && days <= 0.5, `a step of ${days} days is not a budget`);
});

test('a transfer window is something you can wait for', () => {
  /* The instrument knew the date and could do nothing about it, which is most
     of why it read as dead: at ×1 the figures are right and will not visibly
     move for the better part of an hour. Everywhere else in the game you skip
     by pointing at the thing you are waiting for. */
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  const tab = PLAY.slice(PLAY.indexOf('function astrolabeTab()'), PLAY.indexOf('/* ------------------------------------------------------------- actions */'));
  assert.match(tab, /data-act="skipto\|\$\{state\.t \+ r\.days\}/, 'a window cannot be waited for');
  assert.match(tab, /r\.days > 0\.05/, 'a window already open would still offer a wait');
  // And the action takes the label, so the confirmation names what is being waited for.
  assert.match(PLAY, /skipto\(t, what\)\{ askSkip\(Number\(t\), typeof what === 'string' \? what : undefined\); \}/);
});

test('a harbourmaster will not send a ship out of their sky without an Astrolabe', () => {
  // Which jobs leave the sky they are handed out in, and which stay home.
  assert.equal(S.questLeavesSystem(S.questById('heavystuff')), true, 'Slate to Cinder crosses');
  assert.equal(S.questLeavesSystem(S.questById('catsrequest')), true, 'a chain through Whisker and the Arc crosses');
  assert.equal(S.questLeavesSystem(S.questById('slatemessage')), false, 'Tassel to its own moon does not');
  assert.equal(S.questLeavesSystem(S.questById('pebble')), false);
  assert.equal(S.questLeavesSystem(S.questById('appraisal')), false, 'Brine to Brine stays in Grumm\'s sky');

  const bare = newDocked(5, 'slate', { astrolabe: false });
  bare.quests = [];
  const no = S.canAcceptQuest(bare, S.questById('heavystuff'));
  assert.equal(no.ok, false);
  assert.match(no.reason, /Astrolabe/);
  // The jobs that stay in this sky are still yours to take.
  const home = newDocked(5, 'tassel', { astrolabe: false });
  home.quests = [];
  assert.equal(S.canAcceptQuest(home, S.questById('slatemessage')).ok, true);
  // Fit one and the crossing opens.
  bare.keys.astrolabe = true;
  assert.equal(S.canAcceptQuest(bare, S.questById('heavystuff')).ok, true);
});

test('the Astrolabe is on every rack, and is the cheapest key there is', () => {
  const a = UPGRADES.find(u => u.id === 'astrolabe');
  assert.ok(a, 'no Astrolabe on the racks');
  assert.equal(a.kind, 'key');
  assert.equal(a.key, 'astrolabe', 'the rack and the ship disagree about what it is called');
  /* Bought anywhere, because a ship that cannot leave the sky it is in cannot
     go and fetch the thing that lets it leave. */
  assert.deepEqual([...a.soldAt].sort(), Object.keys(PORTS).sort());
  const keys = UPGRADES.filter(u => u.kind === 'key');
  assert.equal(Math.min(...keys.map(u => u.price)), a.price, 'something is cheaper than the one the quest line needs');
  // And a new ship has the slot, empty.
  assert.equal(S.newGame(3).keys.astrolabe, false);
});

test('a finished job gives its slot back, and sits under the live ones', () => {
  /* Three at a time counts what is still open. It always did — what it looked
     like was the trouble: a finished job sat in the Quests tab wherever it had
     been taken on, among the live ones with its steps all ticked, and nothing
     said it was no longer one of the three. */
  const g = S.newGame(5);
  const dockAt = id => {
    const b = world.get(id); const st = O.circularState(b.mu, b.dockAlt, 0);
    g.dockedAt = null; g.justLeft = null; g.justLeftAt = -1e9;
    g.ship = { body: id, r: st.r, v: st.v };
    return S.dock(g);
  };
  dockAt('tassel');
  // The opening errand is already in hand, so two more fills the book.
  assert.equal(S.activeQuests(g).length, 1);
  g.keys.astrolabe = true;      // heavystuff leaves Tassel's sky
  assert.ok(S.acceptQuest(g, 'tasteofhome').ok);
  assert.ok(S.acceptQuest(g, 'slatemessage').ok);
  assert.equal(S.activeQuests(g).length, S.MAX_ACTIVE_QUESTS);
  assert.equal(S.canAcceptQuest(g, S.questById('heavystuff')).ok, false, 'a fourth while three are live');

  // Finish one by arriving where it asked.
  g.t += 1.2; dockAt('slate');
  const fin = g.quests.find(l => l.id === 'slatemessage');
  assert.ok(fin.done, 'the message was delivered');
  assert.ok(Number.isFinite(fin.doneAt), 'and the moment it was finished is written down');
  assert.equal(S.activeQuests(g).length, S.MAX_ACTIVE_QUESTS - 1, 'a finished job is not one of the three');
  assert.equal(S.canAcceptQuest(g, S.questById('heavystuff')).ok, true, 'so the slot is free');
  assert.ok(S.acceptQuest(g, 'heavystuff').ok);
  assert.equal(g.quests.filter(l => !l.done).length, S.MAX_ACTIVE_QUESTS);

  /* And the tab reads live-then-finished rather than in the order they were
     taken. The list itself keeps acceptance order — the sorting is the tab's
     job — so this is checked where it lives. */
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  const tab = PLAY.slice(PLAY.indexOf('function questsTab()'), PLAY.indexOf('/* ------------------------------------------------------------- actions */'));
  assert.ok(tab.length > 200, 'found the Quests tab');
  assert.match(tab, /const live = held\.filter\(x => !x\.l\.done\)/, 'the tab no longer separates live from finished');
  assert.ok(tab.indexOf('for(const { l, q } of live)') < tab.indexOf("out += '<h3>Finished</h3>'"),
    'the finished ones are not under the live ones');
  assert.match(tab, /of \$\{S\.MAX_ACTIVE_QUESTS\} in hand/, 'the tab does not say how many of the three are in hand');
  assert.match(tab, /doneAt \?\? b\.l\.takenAt/, 'the finished ones are not newest first');
});

test('a burn that slows you down never reads as a number going up', () => {
  /* The note both playtesters wrote. The chart labelled a mark with the size
     of the burn — the fuel it will spend — and they were braking at Slate:
     they pressed Back to slow down and watched it climb. A length of engine
     is positive however you point it, so the mark says what the engine will
     do instead, in the words on the buttons. */
  const ms = v => S.auDay(v / 1000);
  assert.equal(S.burnWords({ prograde: ms(120), radial: 0 }), 'forward 120 m/s');
  assert.equal(S.burnWords({ prograde: -ms(120), radial: 0 }), 'back 120 m/s');
  assert.equal(S.burnWords({ prograde: 0, radial: ms(40) }), 'out 40 m/s');
  assert.equal(S.burnWords({ prograde: 0, radial: -ms(40) }), 'in 40 m/s');
  assert.equal(S.burnWords({ prograde: -ms(120), radial: ms(40) }), 'back 120 m/s · out 40 m/s');
  assert.equal(S.burnWords({ prograde: 0, radial: 0 }), 'nothing yet');
  assert.equal(S.burnWords(null), 'nothing yet');

  /* The property that matters: pressing Back repeatedly says "back", and the
     number in it counts the braking rather than the fuel. Both are the same
     magnitude here, but only one of them has a word in front of it that a
     pilot slowing down would agree with. */
  const n = { prograde: 0, radial: 0 };
  let last = 0;
  for(let press = 1; press <= 6; press++){
    n.prograde -= ms(20);
    const words = S.burnWords(n);
    assert.match(words, /^back /, `press ${press}: ${words}`);
    const said = Number(words.match(/back (\d+)/)[1]);
    assert.ok(said > last, 'the amount of braking still counts up, which is what it should do');
    last = said;
  }
  /* The two numbers now live in different places and say different things:
     the mark says "back", and the thing that climbs is the fuel, on the
     gauge, with the word fuel next to it. */
  const g = S.newGame(5);
  g.dockedAt = null; g.justLeft = null;
  const ix = S.addNode(g, g.t + 0.004);
  g.nodes[ix].prograde = -ms(120);
  assert.match(S.burnWords(g.nodes[ix]), /^back /);
  const spend = S.planCost(g, 900);
  assert.ok(spend > 0, 'a braking burn still costs fuel');
  assert.ok(Math.abs(spend - ms(120)) < ms(1), `the gauge counts ${S.fmtKms(spend)} for a 120 m/s brake`);

  /* And the four words are the four buttons. If a label ever disagreed with
     the arrow a player just pressed, that is the same bug again. */
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  const axes = PLAY.slice(PLAY.indexOf('const AXES = {'), PLAY.indexOf('};', PLAY.indexOf('const AXES = {')));
  for(const word of ['Forward', 'Back', 'Out', 'In']) assert.ok(axes.includes(`'${word}'`), `the pad has no ${word} button`);
});

test('the cost of a burn is shown against the fuel, not against the burn', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(PLAY, /nodeLabel = n \? `\$\{S\.burnWords\(n\)\}/, 'the mark is labelled with a length of engine again');
  assert.doesNotMatch(PLAY, /nodeLabel = `\$\{S\.fmtKms/, 'the old bare-magnitude label is back');
  assert.match(PLAY, /planned`/, 'the gauge does not say what the plan will spend');
  assert.match(PLAY, /id="h-dvplan"/, 'the gauge has no planned-spend segment');
  assert.match(PLAY, /uses \$\{S\.fmtKms\(marks\[i\]\?\.cost \?\? 0\)\} of fuel/, 'the Burns tab does not call the cost fuel');
});

test('dragging a mark a little earlier never throws it laps into the future', () => {
  /* Both testers hit this inside ten minutes. Once the burn is pushed out to
     a moon, the yellow road it makes is an ellipse that returns to the very
     pixel the mark sits on, one whole transfer later — twenty-one parking
     laps here. A finger a few pixels off the white line caught that return
     leg, and "a little earlier" became "after lunch". The ship then went
     round twenty-one times waiting for it. */
  const chart = stubChart(1000, 800);
  try{
    const { g, ix, P } = pushedToSlate();
    let pred = S.planImmediate(g);
    const n = g.nodes[ix];
    chart.camera.follow = 'tassel'; chart.camera.zoom = 6e6;
    const frame = () => {
      chart.camera.anchor = [...O.absState(world, 'tassel', g.t).r]; chart.settle();
      chart.draw({ t: g.t, now: 0, shipAbs: { r: S.shipAbsPos(g), v: S.shipAbsVel(g) }, shipBody: 'tassel',
        prediction: pred, nodes: g.nodes, nodePositions: [], selectedNode: 0, apses: [], railCrossings: [] });
    };
    frame();
    const centre = chart.toScreen(O.absState(world, 'tassel', g.t).r);
    const rpx = O.norm(g.ship.r) * chart.camera.zoom;
    const th0 = Math.atan2(g.ship.r[1], g.ship.r[0]);
    const dir = Math.sign(O.cross(g.ship.r, g.ship.v)) || 1;
    const t0 = n.t;
    // The pointer is never exactly on the line: sweep backwards at a few offsets.
    for(const off of [-5, 0, 5, 10, 15]){
      n.t = t0; pred = S.planImmediate(g); frame();
      for(let deg = 108; deg >= -300; deg -= 3){
        const th = th0 + dir * deg * Math.PI / 180;
        const x = centre[0] + (rpx + off) * Math.cos(th), y = centre[1] - (rpx + off) * Math.sin(th);
        const before = n.t;
        const t = chart.dragNodeTime(x, y, pred, g.t, g.nodes, ix);
        if(t == null) continue;
        assert.ok(Math.abs(t - before) <= P * 0.5 + 1e-9, `offset ${off}px at ${deg}°: one move took the mark ${((t - before) / P).toFixed(1)} laps`);
        n.t = t; pred = S.planImmediate(g); frame();
        assert.ok(n.t - g.t < P * 1.5, `offset ${off}px at ${deg}°: the mark is ${((n.t - g.t) / P).toFixed(1)} laps out`);
      }
    }
    /* And the rule refuses, it does not freeze: dragged a little way along the
       line the mark still comes. */
    n.t = t0; pred = S.planImmediate(g); frame();
    const th = th0 + dir * (108 - 20) * Math.PI / 180;
    const t = chart.dragNodeTime(centre[0] + rpx * Math.cos(th), centre[1] - rpx * Math.sin(th), pred, g.t, g.nodes, ix);
    assert.ok(t != null && t < t0 && t0 - t < P * 0.2, 'a small drag earlier still moves the mark a little earlier');
  } finally { chart.restore(); }
});

test('a world wears a lead on its rail that points the way it is going', () => {
  /* Card seven asks for a mark thirty degrees *ahead* of Slate, and two
     players could not tell ahead from behind on a grey circle. The lead is a
     short bright stretch of rail in front of the world, with a chevron. It
     comes from the same function that places the world, so it is on the
     rail — checked here for every world at a zoom where its rail is drawn,
     Croak included, which goes the other way round. */
  const chart = stubChart(1000, 800);
  try{
    for(const b of world.bodies){
      if(b.parent == null) continue;
      const parent = world.get(b.parent);
      chart.camera.follow = b.parent; chart.camera.anchor = [...O.absState(world, b.parent, 0).r]; chart.settle();
      chart.camera.zoom = 200 / b.a;                    // the rail is 200 px across
      const centre = O.absState(world, b.parent, 0).r;
      const lead = railLead(chart, b, centre, parent.mu, 0);
      assert.ok(lead, `${b.id} has no lead at a size where it should`);
      const here = chart.toScreen(O.add(centre, O.railState(b, parent.mu, 0).r));
      const v = O.railState(b, parent.mu, 0).v;
      const vS = [v[0], -v[1]];
      // The head is ahead of the world along its motion, not behind it.
      const toHead = [lead.head[0] - here[0], lead.head[1] - here[1]];
      assert.ok(toHead[0] * vS[0] + toHead[1] * vS[1] > 0, `${b.id}: the lead points backwards`);
      // Clear of the world's own disc, and not a whole lap away.
      const d = Math.hypot(toHead[0], toHead[1]);
      assert.ok(d > (b.radius ?? 0) * chart.camera.zoom + 4 && d < 60, `${b.id}: the lead is ${d.toFixed(0)} px from the world`);
      // Every point of the arc is on the rail.
      for(const q of lead.arc){
        const w = chart.toWorld(q);
        const rel = O.sub(w, centre);
        const th = Math.atan2(rel[1], rel[0]);
        const e = b.e ?? 0, om = b.omega ?? 0;
        const railR = e ? b.a * (1 - e * e) / (1 + e * Math.cos((b.retrograde ? -th : th) - om)) : b.a;
        assert.ok(Math.abs(O.norm(rel) - railR) < b.a * 1e-3, `${b.id}: the lead leaves the rail`);
      }
      // The chevron faces the way the rail is walked.
      const dot = Math.cos(lead.angle) * vS[0] + Math.sin(lead.angle) * vS[1];
      assert.ok(dot > 0, `${b.id}: the chevron faces backwards`);
    }
    // Too small on screen and there is no lead: a chevron on a dot is clutter.
    chart.camera.zoom = 10 / world.get('slate').a;
    assert.equal(railLead(chart, world.get('slate'), [0, 0], world.get('tassel').mu, 0), null);
  } finally { chart.restore(); }
});

test('the point that was tapped stays on the chart while the card is open', () => {
  /* Two roads can lie a few pixels apart, and the card that opens names a
     time rather than a place. Both testers wanted to see which line they had
     hit before pressing anything. */
  const ops = [];
  const chart = stubChart(800, 600, ops);
  try{
    const g = S.newGame(5); const pred = S.planImmediate(g);
    chart.camera.follow = 'tassel'; chart.camera.anchor = [...O.absState(world, 'tassel', 0).r]; chart.settle();
    const t = g.t + 0.004;
    const where = locateOnPrediction(world, pred, t);
    const view = { t: g.t, now: 0, shipAbs: { r: S.shipAbsPos(g), v: S.shipAbsVel(g) }, shipBody: 'tassel',
      prediction: pred, nodes: [], nodePositions: [], apses: [], railCrossings: [] };
    chart.draw(view);
    const rings = () => ops.filter(o => o[0] === 'arc' && Math.abs(o[3] - 9) <= 2.01).length;
    const before = rings();
    ops.length = 0;
    chart.draw({ ...view, tapMark: where });
    assert.ok(rings() > before, 'nothing was drawn at the tapped point');
  } finally { chart.restore(); }
});

test('the page keeps the playtest fixes wired', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(PLAY, /chart\.dragNodeTime\(/, 'a dragged mark no longer goes through the chart rule');
  assert.match(PLAY, /tapMark = t;/, 'a tap on the road no longer leaves a mark while the card is up');
  assert.match(PLAY, /tapMark: tapMark != null/, 'the tap mark never reaches the chart');
  assert.match(PLAY, /tapMark = null; \}/, 'the tap mark is never cleared');
  /* Card seven: a road through the middle of the moon is not aimed. */
  assert.match(PLAY, /const aimed = \([^\n]*\) && !hits;/, 'the aiming card passes a path into the ground');
});

test('only the first crossing is marked, however many the road makes', () => {
  /* The same refusal the road itself makes. A long ellipse cuts five rails
     going out and the same five coming back, and ten honest pairs of orange
     diamonds is a chart nobody can read. */
  const g = transferShip();
  const pred = S.planImmediate(g);
  const all = railCrossings(world, pred, g.t, { minLead: S.MIN_LEAD, limit: 8 });
  assert.ok(all.length > 1, 'this road makes more than one, so there is something to refuse');
  const shown = railCrossings(world, pred, g.t, { minLead: S.MIN_LEAD });
  assert.equal(shown.length, 1, 'and only one is drawn');
  assert.deepEqual(shown[0], all[0], 'the soonest one');

  /* A long ellipse right out past the Belt, which is the case that made this
     necessary: five rails, twice each. */
  const wide = transferShip('tassel', world.get('grumm').a * 0.68);
  wide.ship.v = O.scale(O.unit(wide.ship.v), O.norm(wide.ship.v) * 1.28);
  const far = railCrossings(world, S.planImmediate(wide), wide.t, { minLead: S.MIN_LEAD, limit: 64 });
  assert.ok(far.length >= 4, `the busy case needs to be busy; found ${far.length}`);
  assert.equal(railCrossings(world, S.planImmediate(wide), wide.t, { minLead: S.MIN_LEAD }).length, 1);
});

test('nothing is drawn joining the pair', () => {
  /* A dashed line between the two marks was the obvious thing to draw and the
     wrong one: a straight line across a chart of curves reads as a path you
     could fly. Checked at the source, because a line nobody can see in a
     screenshot is exactly the kind of thing that comes back. */
  const src = readFileSync(new URL('../public/orbital-trader/render.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function drawRailCrossings'), src.indexOf('/* The intercept:'));
  assert.ok(fn.length > 200, 'found the drawing pass');
  /* `diamond` is a helper outside this function, so a lineTo in here is
     something else being drawn — which is the thing that was removed. */
  assert.doesNotMatch(fn, /setLineDash|lineTo/, 'something is drawing a line between the diamonds again');
  assert.doesNotMatch(src, /railTie/, 'the tie colour is still in the palette');
});

test('the rail a ship is standing on is not a crossing', () => {
  /* A ship that has just left Tassel is sitting exactly on Tassel's rail, so
     the arithmetic finds a crossing at this instant: true, useless, and drawn
     on top of the ship. The lead is what keeps it off the chart. */
  const g = transferShip();
  const pred = S.planImmediate(g);
  const raw = railCrossings(world, pred, g.t);
  assert.ok(raw.some(c => c.body === 'tassel' && c.t < g.t + S.MIN_LEAD), 'the doorstep is there to be dropped');
  const led = railCrossings(world, pred, g.t, { minLead: S.MIN_LEAD });
  assert.ok(led.every(c => c.t >= g.t + S.MIN_LEAD), 'and the lead drops it');
});

test('an orbit that crosses nothing is marked with nothing', () => {
  // A parking orbit round Tassel is nowhere near either moon's rail.
  const g = S.newGame(5);
  g.dockedAt = null; g.justLeft = null;
  assert.deepEqual(railCrossings(world, S.planImmediate(g), g.t, { minLead: S.MIN_LEAD }), []);
});

test('tapping a world\'s rail asks the clock for the moment that world is there', () => {
  const chart = stubChart(900, 700);
  try{
    const g = transferShip();
    const pred = S.planImmediate(g);
    chart.camera.follow = 'lamp';
    chart.camera.zoom = 300;          // the whole inner system on one screen
    chart.draw({ t: g.t, now: 0, shipAbs: { r: g.ship.r, v: g.ship.v }, shipBody: 'lamp', prediction: pred, nodes: [], nodePositions: [], apses: [], railCrossings: [] });
    assert.ok(chart.hits.rails.some(r => r.id === 'veyra'), 'the frame drew Veyra’s rail and wrote it down');

    /* Pick a point Veyra will be at in eighty days, tap exactly there, and the
       answer should be eighty days. That is the whole promise of the gesture:
       the time that comes back is the time that world is under your finger. */
    /* A fifth of the way round Veyra's own year. Asking in days would be
       asking for a moment more than a lap away in a squeezed sky, and a lap
       is all a rail tap can offer. */
    const when = g.t + O.period(MU, world.get('veyra').a) / 5;
    const p = chart.toScreen(O.absState(world, 'veyra', when).r);
    const hit = chart.nearestRailPoint(p[0], p[1], g.t);
    assert.ok(hit, 'a tap on the rail finds it');
    assert.equal(hit.id, 'veyra');
    assert.ok(Math.abs(hit.t - when) < 1, `asked for day ${when.toFixed(2)}, got ${hit.t.toFixed(2)}`);
    // Where the world is at the answer is where the finger went, near enough to draw.
    const back = chart.toScreen(O.absState(world, 'veyra', hit.t).r);
    assert.ok(Math.hypot(back[0] - p[0], back[1] - p[1]) < 3, 'and it comes back to the same pixel');

    // Empty sky is still empty sky.
    assert.equal(chart.nearestRailPoint(5, 5, g.t), null);
  } finally { chart.restore(); }
});

test('a rail nobody drew is a rail nobody can tap', () => {
  /* Zoomed into a moon system, the outer rails are off the chart entirely.
     Tapping where one would have been must not warp a player two years on. */
  const chart = stubChart(900, 700);
  try{
    const g = S.newGame(5);
    g.dockedAt = null; g.justLeft = null;
    chart.focus('slate');
    chart.camera.anchor = [...O.absState(world, 'slate', 0).r];
    chart.settle();
    chart.draw({ t: 0, now: 0, shipAbs: { r: S.shipAbsPos(g), v: S.shipAbsVel(g) }, shipBody: 'tassel', prediction: null, nodes: [], nodePositions: [], apses: [], railCrossings: [] });
    assert.ok(!chart.hits.rails.some(r => r.id === 'grumm'), 'Grumm’s rail is not on this screen');
    for(let x = 0; x < 900; x += 37){
      for(let y = 0; y < 700; y += 41){
        const hit = chart.nearestRailPoint(x, y, 0);
        assert.ok(!hit || chart.hits.rails.some(r => r.id === hit.id), `a tap at ${x},${y} reached ${hit?.id}, which is not drawn`);
      }
    }
  } finally { chart.restore(); }
});

test('the page wires the rail gesture and the marks to the chart', () => {
  /* Both halves of this live in play.html, which Node cannot run. The wiring
     is what breaks silently: a solver nobody calls draws nothing, and a
     gesture nobody listens for is a dead patch of sky. */
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(PLAY, /chart\.nearestRailPoint\(/, 'nothing listens for a tap on a rail');
  assert.match(PLAY, /askSkip\(rail\.t/, 'and a tap on one does not reach the clock');
  /* A skip started at a dock sets the rate and never stops, because the loop
     drops its target the moment it sees a docked ship. The road is already
     untappable while tied up; a rail has to be too. */
  assert.match(PLAY, /state\.dockedAt \? null : chart\.nearestRailPoint\(/, 'a rail can be tapped while docked, which runs the clock away');
  assert.match(PLAY, /railCrossings\(world, prediction, state\.t/, 'the crossings are never worked out');
  assert.match(PLAY, /railCrossings: crossedRails/, 'and never reach the chart');
});

test('a pan is stored against the thing last focused, so the sky does not slide out from under it', () => {
  const chart = stubChart();
  try{
    chart.focus('tassel', null, false);
    assert.deepEqual(chart.camera.pan, [0, 0], 'focusing centres');

    settleOn(chart, 'tassel', 0);
    const centre = [chart.width / 2, chart.height / 2];
    const at0 = chart.toScreen(O.absState(world, 'tassel', 0).r);
    assert.ok(Math.abs(at0[0] - centre[0]) < 1e-6 && Math.abs(at0[1] - centre[1]) < 1e-6, 'and puts it in the middle');

    // Drag the sky a hundred pixels right and forty down.
    chart.panBy(100, 40);
    const panned = chart.toScreen(O.absState(world, 'tassel', 0).r);
    assert.ok(Math.abs(panned[0] - (centre[0] + 100)) < 1e-6, 'the world under the finger came with it');
    assert.ok(Math.abs(panned[1] - (centre[1] + 40)) < 1e-6);

    /* Ninety days on, Tassel is a quarter of a year round the Lamp — a long
       way from where the drag happened. The pan is an offset from Tassel, not
       a place in the sky, so the view is still looking at the same corner of
       it. This is the whole promise. */
    settleOn(chart, 'tassel', 90);
    const later = chart.toScreen(O.absState(world, 'tassel', 90).r);
    assert.ok(Math.abs(later[0] - (centre[0] + 100)) < 1e-9, 'still a hundred pixels off Tassel');
    assert.ok(Math.abs(later[1] - (centre[1] + 40)) < 1e-9, 'and forty down');
    assert.ok(chart.panned() > 0, 'and the chart knows it is off its lock');

    // Looking somewhere else re-centres, and the next pan is measured from there.
    chart.focus('slate', null, false);
    assert.deepEqual(chart.camera.pan, [0, 0]);
    assert.equal(chart.panned(), 0);
    settleOn(chart, 'slate', 90);
    const onSlate = chart.toScreen(O.absState(world, 'slate', 90).r);
    assert.ok(Math.abs(onSlate[0] - centre[0]) < 1e-6 && Math.abs(onSlate[1] - centre[1]) < 1e-6);
  }finally{ chart.restore(); }
});

test('zooming about a point keeps that point under the pointer, and keeps it there next frame', () => {
  const chart = stubChart();
  try{
    chart.focus('tassel', null, false);
    settleOn(chart, 'tassel', 0);
    const at = [chart.width * 0.75, chart.height * 0.3];
    const under = chart.toWorld(at);
    chart.zoomBy(2.5, at);
    const after = chart.toScreen(under);
    assert.ok(Math.hypot(after[0] - at[0], after[1] - at[1]) < 1e-6, 'the point under the pointer stayed there');
    /* And it has to survive the redraw: a correction written into the centre
       is overwritten by the lock every frame, which is what made zooming to a
       point snap back before there was a pan to put it in. */
    settleOn(chart, 'tassel', 0);
    const redrawn = chart.toScreen(under);
    assert.ok(Math.hypot(redrawn[0] - at[0], redrawn[1] - at[1]) < 1e-6, 'and stayed there on the next frame');
  }finally{ chart.restore(); }
});

/* ---------------------------------------------------------------- sim */

/* The game opens in flight, not at a mooring: there is no landing in Orbital
 * Trader and Tassel's harbour is a parking orbit you match. Tests about
 * markets and the shipyard want to be tied up, so they start the
 * same way a player does and then tie up. */
/* Put the ship where a ship would be: in a circular orbit at the docking
 * altitude, or sitting on a gravity-less port. Dropping it at rest used to
 * count as arrived; it does not now, and should not — a ship at rest over a
 * moon is falling into it. */
function parkAt(s, id){
  const b = world.get(id);
  if(b.mu > 0){
    const st = O.circularState(b.mu, b.dockAlt, 0);
    s.ship = { body: id, r: st.r, v: st.v };
  }else{
    const local = O.railState(b, world.get(b.parent).mu, s.t);
    s.ship = { body: b.parent, r: [...local.r], v: [...local.v] };
  }
}

/* The parking orbit: where a ship is whenever it is loose at a port and not
 * opening a new game. A new game now starts *below* it — see the low-orbit
 * test — so a test about the orbit undocking leaves you in, or about the
 * first lesson flown from Tassel's harbour, has to tie up and cast off
 * rather than take the opening frame for it. */
function undockedAt(seed, port = 'tassel'){
  const s = newDocked(seed, port);
  S.undock(s);
  return s;
}

function newDocked(seed, port = 'tassel', opts = {}){
  const s = S.newGame(seed);
  if(port !== 'tassel'){ s.dockedAt = port; S.undock(s); }
  s.justLeft = null;
  const r = S.dock(s);
  assert.ok(r.ok, `could not tie up at ${port}: ${r.reason}`);
  /* Fitted by default. No harbourmaster hands out a job that leaves their own
     sky to a ship with no Astrolabe, and most of these tests are about what a
     job *does* rather than about who is allowed to take one — the rule itself
     has its own test, which asks for a ship without one. */
  s.keys.astrolabe = opts.astrolabe !== false;
  return s;
}

test('a new game starts in orbit above Tassel, full, with an errand from Uncle Theo', () => {
  const s = S.newGame(7);
  /* Nothing lands in this game, so there is nothing to cast off from. The
     first frame is the ship already going round Tassel with a road ahead of
     it and somewhere to be. */
  assert.equal(s.dockedAt, null);
  assert.equal(s.ship.body, 'tassel');
  assert.equal(s.justLeft, 'tassel', "Tassel's own mouth is where we started");
  const b = world.get('tassel');
  assert.ok(Math.abs(O.norm(s.ship.r) - b.startAlt) < 1e-12, 'in the low orbit the game opens in');
  assert.ok(Math.abs(O.norm(s.ship.v) - Math.sqrt(b.mu / b.startAlt)) < 1e-12, 'and going round it');
  /* The opening is an errand, not a cargo: no crate in the hold, one quest on
     the list, and Slate already the target. */
  assert.equal(s.cargo.length, 0);
  assert.equal(s.quests.length, 1);
  assert.deepEqual(s.quests[0], { id: 'pebble', step: 0, done: false, takenAt: 0 });
  assert.equal(s.target, 'slate', 'the errand is already the target');
  assert.ok(S.planImmediate(s), 'and there is a road drawn from the first frame');
  assert.ok(Math.abs(s.dv - s.tank) < 1e-12 && s.tank > 0);
  assert.ok(Math.abs(S.kms(s.tank) - S.tiers('tank')[0].value) < 1e-9, 'the starter tank is the one the shipyard lists');
  assert.equal(s.money, CONST.START_MONEY);
  assert.equal(s.flags.tutorial, 0);
  // The save is JSON all the way down.
  const back = S.restore(S.serialize(s));
  assert.deepEqual(back, JSON.parse(JSON.stringify(s)));
});

test('the game opens in a low orbit, and the clock is tuned so a lap of it is ten real minutes', () => {
  const s = S.newGame(5);
  const b = world.get('tassel');
  const el = O.elementsFromState(b.mu, s.ship.r, s.ship.v);
  assert.ok(el.e < 1e-9 && el.dir > 0, 'a prograde circle, so the first burn points the right way');

  /* Low means what a pilot means by it and not what a chart does: the high
     point of the orbit is an altitude over the ground, and it sits under one
     planet-diameter of it. At Tassel that is 0.000075 au over a world 0.00008
     au across — close enough in that the ocean fills the chart. */
  const apoapsisAltitude = el.ra - b.radius;
  assert.ok(apoapsisAltitude > 0, 'and above the ocean, not through it');
  assert.ok(apoapsisAltitude < 2 * b.radius, `apoapsis altitude ${apoapsisAltitude} is not below the diameter ${2 * b.radius}`);
  assert.ok(el.ra < world.get('tassel').zoneRadius, 'inside the harbour mouth, so Tassel can still be tied up at');
  assert.ok(el.ra < b.dockAlt, 'and below the harbour, which is where undocking puts you');

  /* The clock has exactly one job: a lap of this orbit, at ×1, is ten real
     minutes. Everything else in the sky is slower, so this is the fastest the
     game ever looks. */
  const lapSeconds = el.period / S.dtForFrame(s, 1);
  assert.ok(Math.abs(lapSeconds - 600) < 0.5, `a lap takes ${lapSeconds.toFixed(2)} real seconds, not 600`);

  // And flying it for those ten minutes really does come back round.
  const r0 = [...s.ship.r];
  for(let i = 0; i < 600; i++) S.tick(s, S.dtForFrame(s, 1));
  assert.ok(O.dist(s.ship.r, r0) < el.ra * 1e-6, 'ten real minutes of ×1 is one lap, back where it started');
});

test('undocking puts the ship in a circular prograde orbit at the docking altitude', () => {
  /* Casting off is not the same frame as a new game: the opening orbit is low
     and the harbour's is not, so this ties up first and then lets go. */
  const s = undockedAt(3);
  assert.equal(s.dockedAt, null);
  const b = world.get('tassel');
  const el = O.elementsFromState(b.mu, s.ship.r, s.ship.v);
  assert.ok(Math.abs(O.norm(s.ship.r) - b.dockAlt) < 1e-12 && el.e < 1e-9 && el.dir > 0);
  /* And the port you just left stays quiet until you are out of its mouth:
     a card saying "tie up" one second after casting off is an invitation to
     undo what you just did. */
  assert.equal(S.dockingStatus(s), null, 'Tassel does not immediately ask you back');
  assert.equal(s.justLeft, 'tassel');
  // Once outside the mouth it forgets, and behaves like any other port.
  s.ship = { body: 'tassel', r: [b.zoneRadius * 3, 0], v: [0, 0] };
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
      if(pred.events.some(e => e.kind === 'soi' && e.to === 'lamp')) break;   // escaped Tassel: too much
    }
  }
  return best;
}

test('the first lesson is flyable: one prograde burn from Tassel reaches Moss inside the starter tank', () => {
  const s = undockedAt(11);
  const plan = hopPlan(s, 'moss');
  assert.ok(plan, 'no single prograde burn reaches Moss');
  // The tuning's own figure for this hop is about 2 km/s out of a 14 km/s tank.
  assert.ok(plan.kms < 3, `the hop costs ${plan.kms} km/s`);
  assert.ok(S.auDay(plan.kms) < s.dv * 0.3, 'the first lesson leaves most of the tank');
  // Fly it at full warp: the burn fires at its time, the SOI change happens, the fuel is spent.
  s.nodes = plan.nodes;
  const before = s.dv;
  const events = [];
  let guard = 0;
  while(s.ship.body !== 'moss' && guard++ < 4000){ events.push(...S.tick(s, 4.17)); }
  assert.equal(s.ship.body, 'moss', 'arrived in Moss\'s reach');
  assert.ok(events.some(e => e.kind === 'burn'));
  assert.ok(Math.abs((before - s.dv) - S.auDay(plan.kms)) < 1e-9, 'exactly the planned Δv was spent');
  assert.equal(s.nodes.length, 0, 'the fired node left the plan');
  assert.ok(s.flags.firstSoiChange, 'the milestone was noted');
});

test('the whole first lesson can be flown: hop, brake at the kiss, and tie up at Moss', () => {
  /* This is the tutorial, played by the rules the page plays by: one prograde
     burn to reach the moon, the game's own brake-at-the-kiss mark, and then
     Dock. If this test fails the game cannot be finished by a beginner. */
  const s = undockedAt(5);
  const plan = hopPlan(s, 'moss', 4, true);
  assert.ok(plan, 'no hop reaches Moss inside its harbour mouth');
  s.nodes = plan.nodes;
  let guard = 0;
  while(s.ship.body !== 'moss' && guard++ < 4000) S.tick(s, 4.17);
  assert.equal(s.ship.body, 'moss');
  assert.equal(s.pending, null, 'the hop did not fly into anything');

  const k = S.kiss(s);
  assert.ok(k && k.port === 'moss' && !k.crashes, 'the approach passes outside the moon');
  assert.ok(k.inMouth, 'the kiss is inside the harbour mouth');
  const ix = S.brakeAtKiss(s);
  assert.ok(ix >= 0, 'the game offers a brake at the kiss');
  assert.ok(S.planCost(s) < s.dv, 'and the tank can pay for it');

  guard = 0;
  while(s.nodes.length && guard++ < 20000) S.tick(s, 0.01);
  assert.equal(s.pending, null, 'no crash on the brake');
  let st = S.dockingStatus(s);
  assert.ok(st && st.port === 'moss', 'Moss is the port in front of us');
  // Coast the short way to the mouth if the brake happened just before it.
  guard = 0;
  while(!(st?.ok) && guard++ < 4000 && !s.pending){ S.tick(s, 0.005); st = S.dockingStatus(s); }
  assert.ok(st?.ok, `never got slow enough inside the mouth (${st ? S.fmtKms(st.over) + ' over' : 'no port'})`);
  const r = S.dock(s);
  assert.ok(r.ok && s.dockedAt === 'moss', 'tied up at Moss');
  assert.ok(s.dv > 0, 'with fuel to spare');
});

test('a job of each kind builds the steps its kind earns', () => {
  /* The five shapes, checked against the catalogue rather than against
     invented ones: what a quest says is its type, and the steps that come out
     of it, are the whole of the contract between the words and the rules. */
  const kinds = q => S.questSteps(q).map(st => st.kind);
  assert.deepEqual(kinds(S.questById('pebble')), ['acquire', 'handover'], 'retrieval');
  assert.deepEqual(kinds(S.questById('tasteofhome')), ['handover'], 'delivery: it is already aboard');
  assert.deepEqual(kinds(S.questById('collector')), ['acquire', 'acquire', 'acquire', 'handover'], 'shopping: one step per line on the list');
  assert.deepEqual(kinds(S.questById('slatemessage')), ['handover'], 'message: just be there');
  assert.deepEqual(kinds(S.questById('catsrequest')), ['visit', 'visit', 'visit', 'handover'], 'chain: one step per stop');
  assert.deepEqual(S.questSteps(S.questById('catsrequest')).map(st => st.text),
    ['Call at Nail', 'Call at Whisker', 'Call at The Arc', 'Report to Nail']);
  assert.equal(S.questTarget(S.questById('catsrequest')), 'nail', 'a chain points at its first stop');

  // Authored wording wins where a quest bothers to write it.
  assert.equal(S.questSteps(S.questById('pebble'))[1].text, 'Bring it home to Tassel');
  assert.match(S.questSteps(S.questById('greenmedicine'))[0].text, /6 × Medicinal herbs at Moss/);

  // Only a delivery costs you hold room before you have been anywhere.
  assert.equal(S.questLoad(S.questById('pebble')), 0);
  assert.equal(S.questLoad(S.questById('slatemessage')), 0, 'a message weighs nothing');
  assert.equal(S.questLoad(S.questById('heavystuff')), 12, 'four heavy crates, three units each');

  /* Where the chart points when a job is taken. A retrieval sends you to the
     stall; a delivery is already aboard, so the first place you have to be is
     the far end — reading that off `from` would have pointed every delivery
     at the dock it was loaded on. */
  assert.equal(S.questTarget(S.questById('pebble')), 'slate');
  assert.equal(S.questTarget(S.questById('heavystuff')), 'cinder');
  assert.equal(S.questTarget(S.questById('slatemessage')), 'slate');
});

test('every quest in the catalogue is one a ship can actually finish', () => {
  /* Salvage needs flight the game does not have, so it is not here. Crew is
     no longer a reason to leave a quest out — three of them pay in a person —
     but nothing yet *requires* one, so every quest in the list is flyable by
     a ship with empty berths. */
  for(const q of S.QUESTS){
    assert.ok(['retrieval', 'delivery', 'shopping', 'message', 'chain'].includes(q.type), `${q.id}: ${q.type}`);
    assert.ok(q.requires == null, `${q.id} needs something the game cannot check yet`);
    // Every job says where it is offered, so a board will know what to put up.
    assert.ok(PORTS[q.from], `${q.id} does not say where it is given out`);
    for(const g of q.goods ?? []){
      const good = S.goodById(g.good);
      // A retrieval you cannot buy anywhere is a quest nobody can finish.
      if(q.type !== 'delivery') assert.ok(good.producedAt.length, `${q.id}: nobody makes ${g.good}`);
      if(q.type === 'retrieval') assert.ok(good.producedAt.includes(q.from), `${q.id}: ${q.from} does not sell ${g.good}`);
    }
    // A job has to be worth more than selling what it asks you to fetch.
    if(q.type === 'retrieval' || q.type === 'shopping'){
      const s = S.newGame(5);
      const market = (q.goods ?? []).reduce((n, g) => n + S.sellPrice(s, q.to, g.good) * g.qty, 0);
      assert.ok(q.pay > market, `${q.id} pays ${q.pay} for goods worth ${market} on the open market at ${q.to}`);
    }
  }
});

test('every quest in the catalogue can be flown from its giver to its end', () => {
  /* The one test that would have caught a quest naming a good nobody sells,
     or a step nothing can satisfy. Each job is taken where it is offered and
     then played the way a player would play it: buy what it asks for where it
     is made, tie up where it says, and see the card close. */
  for(const q of S.QUESTS){
    const s = S.newGame(11);
    s.dockedAt = q.from; s.justLeft = null;
    s.money = 200000;
    s.keys.tempControl = true;
    s.keys.astrolabe = true;          // the harbourmaster's rule, not the flying
    s.quests = [];                              // one job at a time, to keep the three free
    const got = S.acceptQuest(s, q.id);
    assert.ok(got.ok, `${q.id} could not be taken at ${q.from}: ${got.reason}`);
    const live = s.quests.find(l => l.id === q.id);
    const purse = s.money;
    const steps = S.questSteps(q);
    let guard = 0;
    while(!live.done && guard++ <= steps.length + 2){
      const step = steps[live.step];
      assert.ok(step, `${q.id} ran out of steps with the job unfinished`);
      if(step.kind === 'acquire'){
        const port = step.port ?? S.goodById(step.good).producedAt[0];
        s.dockedAt = port;
        const r = S.buy(s, step.good, step.qty - S.carrying(s, step.good));
        assert.ok(r.ok, `${q.id}: could not buy ${step.good} at ${port} — ${r.reason}`);
      }else{
        s.dockedAt = step.port;
      }
      S.tick(s, 0.01);
    }
    assert.ok(live.done, `${q.id} stuck on "${steps[live.step]?.text}"`);
    assert.equal(S.usedUnits(s), 0, `${q.id} left something in the hold`);
    assert.ok(s.money > purse, `${q.id} cost more to finish than it paid`);
  }
});

test('a cold consignment needs temperature control before anybody can hand it to you', () => {
  /* A delivery skips the market, so it skips the market's temperature check.
     Four cases of smuggled medicine and a plain hold is the case. */
  const s = newDocked(5, 'nail');
  assert.equal(S.goodById('greymeds').needsTempControl, true);
  const no = S.acceptQuest(s, 'medicinerun');
  assert.equal(no.ok, false);
  assert.match(no.reason, /temperature control/);
  s.keys.tempControl = true;
  assert.ok(S.acceptQuest(s, 'medicinerun').ok);
  assert.equal(S.usedUnits(s), 4);
});

test('three jobs is all anybody can hold in their head', () => {
  const s = newDocked(5);
  s.money = 100000;
  assert.equal(S.activeQuests(s).length, 1, 'the opening errand is one of the three');
  assert.ok(S.acceptQuest(s, 'greenmedicine').ok);
  assert.ok(S.acceptQuest(s, 'slatemessage').ok);
  const full = S.acceptQuest(s, 'collector');
  assert.equal(full.ok, false);
  assert.match(full.reason, /Three jobs/);

  // Taking the same one twice is not a way round it.
  assert.equal(S.acceptQuest(s, 'slatemessage').ok, false);
  // Nor is a job you have already finished counted against you.
  s.quests.find(l => l.id === 'slatemessage').done = true;
  assert.equal(S.activeQuests(s).length, 2);
  assert.ok(S.acceptQuest(s, 'collector').ok, 'a finished job still fills a berth');
});

test('a delivery is loaded when you take it, and you must have the room', () => {
  const s = newDocked(5, 'slate');
  const q = S.questById('heavystuff');

  // Twelve units of ore into a hold with four units left in it: no.
  s.cargo = [{ good: 'pebble', qty: 20, t: s.t, price: 10, from: 'slate' }];
  const no = S.acceptQuest(s, q.id);
  assert.equal(no.ok, false);
  assert.match(no.reason, /room in the hold/);
  assert.equal(s.quests.length, 1, 'and it was not taken anyway');

  // With the hold clear it comes aboard, at nobody's expense but the sender's.
  s.cargo = [];
  const before = s.money;
  assert.ok(S.acceptQuest(s, q.id).ok);
  assert.equal(S.usedUnits(s), 12, 'four heavy crates are aboard');
  assert.equal(s.money, before, 'and you did not pay for them');
  const stack = s.cargo.find(c => c.questId === q.id);
  assert.ok(stack && stack.qty === 4 && stack.price === 0);

  /* A consignment is not stock. It cannot be sold, the cats do not count it
     when they work out a toll, and giving the job up puts it over the side. */
  assert.equal(S.sellable(s, 'ironore'), 0);
  assert.equal(S.sell(s, 'ironore', 1).ok, false);
  assert.equal(S.cargoValue(s), 0, 'somebody else\'s crates are not your worth');
  assert.ok(S.abandonQuest(s, q.id).ok);
  assert.equal(s.cargo.length, 0, 'the consignment went with the job');
});

test('a delivery, a shopping list and a message each finish the way their kind says', () => {
  // Delivery: take it, fly it, tie up, done. Nothing to buy anywhere.
  const d = newDocked(5, 'slate');
  assert.ok(S.acceptQuest(d, 'heavystuff').ok);
  const paid = d.money;
  d.dockedAt = 'cinder';
  S.tick(d, 0.01);
  const live = d.quests.find(l => l.id === 'heavystuff');
  assert.equal(live.done, true, 'arriving with it is the whole job');
  assert.equal(S.carrying(d, 'ironore'), 0, 'and it was handed over');
  assert.equal(d.money - paid, S.questById('heavystuff').pay);
  assert.ok(d.rep.emberkin >= 1);

  // Shopping list: three separate goods, then all three at once.
  const sh = newDocked(5, 'veyra');
  sh.money = 100000;
  assert.ok(S.acceptQuest(sh, 'collector').ok);
  const l = sh.quests.find(x => x.id === 'collector');
  sh.cargo = [{ good: 'pearls', qty: 1, t: sh.t, price: 120, from: 'tassel' }];
  S.tick(sh, 0.01);
  assert.equal(l.step, 1, 'one line of the list is one step');
  sh.cargo.push({ good: 'coral', qty: 1, t: sh.t, price: 150, from: 'tassel' });
  sh.cargo.push({ good: 'clocks', qty: 1, t: sh.t, price: 170, from: 'veyra' });
  S.tick(sh, 0.01);
  assert.equal(l.done, true, 'and standing at Veyra with all three closes it');
  assert.equal(sh.cargo.length, 0, 'all three went on the table');

  // Message: no goods, no weight, and being there is the whole of it.
  const m = newDocked(5, 'tassel');
  assert.ok(S.acceptQuest(m, 'slatemessage').ok);
  assert.equal(S.usedUnits(m), 0, 'a sealed note takes no room');
  const ml = m.quests.find(x => x.id === 'slatemessage');
  S.tick(m, 0.01);
  assert.equal(ml.done, false, 'and it is not done where it was given to you');
  m.dockedAt = 'slate';
  S.tick(m, 0.01);
  assert.equal(ml.done, true);
});

test("the opening errand: Theo's purse buys exactly one pebble, and Nellie pays for it", () => {
  const s = S.newGame(5);
  const price = S.buyPrice(s, 'slate', 'pebble');

  /* The pebble is the cheapest thing on Slate's shelf, and the purse covers one
     of them and no more. Both halves matter: the first is why a new player
     cannot pick the wrong row, the second is why they cannot buy three and
     wander off. */
  const shelf = PORTS.slate.sells.map(r => S.buyPrice(s, 'slate', r.good));
  assert.equal(price, Math.min(...shelf), 'the pebble is the cheapest row at Slate');
  assert.ok(price <= s.money, `a pebble costs ${price} and the purse holds ${s.money}`);
  assert.ok(price * 2 > s.money, 'and there is not enough for two');

  // Prices drift, so the purse has to cover the dearest a pebble ever gets.
  let dearest = 0;
  for(let seed = 1; seed <= 40; seed++){
    const g = S.newGame(seed);
    for(let d = 0; d <= 120; d += 3){ g.t = d; dearest = Math.max(dearest, S.buyPrice(g, 'slate', 'pebble')); }
  }
  assert.ok(dearest <= S.newGame(1).money, `a pebble reaches ${dearest} and the purse is ${S.newGame(1).money}`);

  // Buy it at Slate, carry it home, and the errand closes itself.
  s.dockedAt = 'slate'; s.justLeft = null;
  assert.ok(S.buy(s, 'pebble', 1).ok);
  assert.equal(s.quests[0].step, 1, 'buying it is the first step');
  assert.equal(s.quests[0].done, false, 'but the errand is to bring it home');
  s.dockedAt = 'tassel';
  S.tick(s, 0.01);
  assert.equal(s.quests[0].done, true, 'home with it finishes the errand');
  assert.equal(S.carrying(s, 'pebble'), 0, 'and the pebble is Nellie\'s');
  assert.ok(s.money > 400 && s.rep.otter >= 1, 'Theo settles up and the otters remember');
});

test('markets: buying costs, selling elsewhere pays, and nothing else moves a price', () => {
  const s = newDocked(21);
  /* The game now opens with twelve cowries, which is exactly one moon pebble
     and the whole point of the opening. A test about a market needs a purse. */
  s.money = 2000;
  const port = 'tassel';
  const good = PORTS[port].sells[0].good;
  const price = S.buyPrice(s, port, good);
  const purse = s.money;
  const r = S.buy(s, good, 2);
  assert.ok(r.ok && s.money === purse - price * 2);
  assert.equal(S.usedUnits(s), 2 * S.goodById(good).units);
  // Somebody who wants it pays more than the disinterested rate.
  const wanter = Object.entries(PORTS).find(([id, p]) => id !== port && p.buys.some(b => b.good === good));
  if(wanter){
    const [wid] = wanter;
    const p1 = S.sellPrice(s, wid, good);
    assert.ok(p1 > S.sellPrice(s, 'maw', good), 'somebody who wants it pays over the odds');
    /* What you have landed here before does not move the price any more, and
       neither does how picked-over the shelf is. The stall's stock is the only
       limit on how much you can move at once, and that is limit enough. */
    s.markets[wid] = { sold: { [good]: { q: 500, t: s.t } }, bought: { [good]: 500 } };
    assert.equal(S.sellPrice(s, wid, good), p1, 'selling a lot here changed what they pay');
    assert.equal(S.buyPrice(s, port, good), price, 'emptying the shelf changed what it costs');
  }
  // Nobody makes money round-tripping in one port.
  for(const [id, p] of Object.entries(PORTS)){
    for(const row of p.sells){
      s.markets = {}; s.t = 0;
      assert.ok(S.sellPrice(s, id, row.good) < S.buyPrice(s, id, row.good), `${id}: ${row.good} sells for less than it costs`);
    }
  }
});

test('a good is worth more out of its region, and much more where it is loved', () => {
  const s = S.newGame(5);
  /* The two rules the market runs on. Tide glass is made on Tassel, in the
     home region; Brine is in the outer region and loves it. */
  const home = S.sellPrice(s, 'tassel', 'tideglass');      // where it is made
  const away = S.sellPrice(s, 'haven', 'tideglass');       // outer, buys it, does not love it
  const loved = S.sellPrice(s, 'brine', 'tideglass');      // outer, and loves it
  assert.ok(away > home * 1.4, `carrying it out of its region is worth it: ${home} -> ${away}`);
  assert.ok(loved > away * 1.8, `and the ones who love it pay much more: ${away} -> ${loved}`);
  assert.ok(loved > S.buyPrice(s, 'tassel', 'tideglass') * 4.5, 'a loved good abroad is the trade route');

  /* The four corners of the table, which is the whole of the selling side.
     Space is hard and few merchants cross between peoples, so the run that
     matters is a loved good carried out of its own region. */
  const F = FORMULAS.demand;
  assert.ok(F.lovedAway >= 5 && F.lovedAway <= 6, 'a loved good abroad is five or six times the stall price');
  assert.ok(F.likedAway > F.likedSame && F.lovedSame > F.likedSame);
  assert.ok(F.lovedAway > F.lovedSame * 2, 'the same run inside one system is worth a fraction of it');
  assert.ok(F.unwanted < 1, 'and a good nobody named goes at a loss');
  assert.equal(S.demandMul('brine', 'tideglass'), F.lovedAway, 'Brine loves it and lives four au away');
  assert.equal(S.demandMul('haven', 'tideglass'), F.likedAway, 'Haven merely wants it, and is also far');
  assert.equal(S.demandMul('slate', 'pearls'), F.likedSame, 'Slate wants pearls off its own planet');
  assert.equal(S.demandMul('slate', 'coral'), F.lovedSame, 'otters love coral, and Slate is an otter port in its own region');
  assert.equal(S.demandMul('slate', 'tideglass'), F.unwanted, 'nobody on Slate asked for tide glass');
  assert.equal(S.demandMul('tassel', 'tideglass'), F.unwanted, 'a stall does not buy back its own stock');

  // Region is a region, not a distance: a sibling port pays the home rate.
  assert.equal(S.demandMul('slate', 'pearls'), S.demandMul('moss', 'pearls'));
  assert.ok(S.demandMul('cinder', 'pearls') > S.demandMul('slate', 'pearls'));
  // Loving something names a port or a whole people; both count.
  assert.ok(S.lovesGood('brine', 'tideglass'), 'Brine loves tide glass by name');
  assert.ok(S.lovesGood('tassel', 'frogtea') && S.lovesGood('moss', 'frogtea'), 'otters love frog tea as a people');
  // And loving a thing is wanting it: nobody turns away the customer who cares.
  for(const g of GOODS) for(const id of Object.keys(PORTS)){
    if(S.lovesGood(id, g.id) && !g.producedAt.includes(id)) assert.ok(S.wantsGood(id, g.id), `${id} loves ${g.id} and will not buy it`);
  }
});

test('a stall keeps what it keeps, and finds more only while you are away', () => {
  const s = S.newGame(5);
  s.dockedAt = null; s.justLeft = null;
  parkAt(s, 'slate');
  assert.ok(S.dock(s).ok);
  const full = S.stockAvailable(s, 'slate', 'pebble');
  const [lo, hi] = S.goodById('pebble').stock;
  assert.ok(full >= lo && full <= hi, `a shelf of ${full} is outside ${lo}-${hi}`);

  s.money = 10000;
  assert.ok(S.buy(s, 'pebble', 3).ok);
  assert.equal(S.stockAvailable(s, 'slate', 'pebble'), full - 3, 'what you took is what is missing');

  // Waiting does nothing. This is the whole change: no shelf regrows on a clock.
  S.wait(s, 400);
  assert.equal(S.stockAvailable(s, 'slate', 'pebble'), full - 3, 'the shelf refilled by itself');

  // Nor does casting off and tying up again at the same stall.
  S.undock(s); s.justLeft = null; parkAt(s, 'slate');
  assert.ok(S.dock(s).ok);
  assert.equal(S.stockAvailable(s, 'slate', 'pebble'), full - 3, 'walking out and back in restocked it');

  // Trading somewhere else does. Come back and the shelves have been rolled.
  S.undock(s); s.justLeft = null; parkAt(s, 'moss');
  assert.ok(S.dock(s).ok);
  S.undock(s); s.justLeft = null; parkAt(s, 'slate');
  assert.ok(S.dock(s).ok);
  const again = S.stockAvailable(s, 'slate', 'pebble');
  assert.ok(again >= lo && again <= hi, `the new shelf of ${again} is outside ${lo}-${hi}`);
  assert.equal(again, S.stockFull(s, 'slate', 'pebble'), 'and it is a whole shelf, not the picked-over one');

  /* The last crate on a shelf costs what the first one did. A picked-over
     stall used to charge more, which was the buying half of a supply-and-demand
     rule the stock limit already does better: you cannot take what is not
     there, and that is the whole of the limit. */
  const t = S.newGame(9);
  t.dockedAt = null; t.justLeft = null; parkAt(t, 'slate'); S.dock(t);
  t.money = 100000;
  const first = S.buyPrice(t, 'slate', 'pebble');
  const room = Math.min(S.stockAvailable(t, 'slate', 'pebble') - 1, S.freeUnits(t));
  assert.ok(room >= 4, `nothing to buy: ${room} crates of room`);
  assert.ok(S.buy(t, 'pebble', room).ok);
  assert.equal(S.buyPrice(t, 'slate', 'pebble'), first, 'the last crates on the shelf cost more than the first');
});

test('nothing spoils: a crate is worth what it is worth whenever it lands', () => {
  /* Decay is gone. Time and hold room are still what limit a run — the clock
     and the tank — but a cargo bought on Moss is the same cargo when it
     reaches Cinder ninety-four days later, which is what the inner system
     being ninety-four days away was quietly making impossible. */
  const s = newDocked(5, 'moss');
  s.money = 100000;
  s.keys.tempControl = true;                     // riverfish is one of the six
  assert.ok(S.buy(s, 'riverfish', 4).ok);
  const now = S.cargoValue(s, 'tassel');
  /* Age the crates rather than the clock: what is being pinned is that the
     hold does not remember when something came aboard. Moving the clock would
     also move the otter haggle roll, which is species character and stays. */
  for(const c of s.cargo) c.t -= 2000;
  assert.equal(S.cargoValue(s, 'tassel'), now, 'two thousand days cost the hold nothing');
  assert.equal(S.sellPrice.length, 3, 'sellPrice takes a state, a port and a good — and no age');
  for(const g of GOODS) assert.equal(g.lifetimeDays, undefined, `${g.id} still carries a shelf life`);
});

test('temperature control is what the good cargo is behind', () => {
  const s = S.newGame(5);
  const F = FORMULAS.demand;
  assert.ok(F.tempControlMul > 1, 'the goods that need a held temperature pay more');
  /* Ice lenses are made on Glass and loved on Veyra, two regions apart, and
     they need the Engineer's box: the best kind of cargo in the game, which is
     the point of a 2,800-cowrie upgrade behind a quest. */
  const ratio = S.sellPrice(s, 'veyra', 'lenses') / S.buyPrice(s, 'glass', 'lenses');
  assert.ok(ratio > F.lovedAway, `a loved cold good abroad beats a loved warm one: ${ratio}`);
  assert.ok(S.goodById('lenses').needsTempControl);
});

test('fuel: the tank is a hard ceiling and coin a hard floor', () => {
  const s = newDocked(1);
  s.dv = 0;
  const r = S.refuel(s, 1000);
  assert.ok(r.ok && s.dv <= s.tank + 1e-12 && s.money >= 0);
  const full = S.refuel(s, 1);
  if(s.dv >= s.tank - 1e-9) assert.equal(full.ok, false);
});

test('a tow moves the ship to the nearest port and costs money and days, never the save', () => {
  const s = S.newGame(9);
  s.dv = 0;
  const t0 = s.t, m0 = s.money;
  const q = S.towQuote(s);
  const r = S.callTow(s, 'dry');
  assert.equal(s.dockedAt, q.port);
  assert.ok(s.t > t0 && m0 - s.money === r.cost || s.debt > 0);
  assert.equal(s.stats.tows, 1);
});

test('crossing the Belt brings a toll that never takes everything', () => {
  const s = S.newGame(13);
  S.undock(s);
  // Put the ship on a heliocentric orbit that climbs into the belt, with a hold worth taking a share of.
  const start = O.circularState(MU, CONST.BELT.inner - 0.1, 1.0);
  s.ship = { body: 'lamp', r: start.r, v: O.scale(start.v, 1.12) };
  s.cargo = [{ good: 'tideglass', qty: 10, t: s.t, price: 80, from: 'tassel' }];
  const events = [];
  let guard = 0;
  while(!s.pending && guard++ < 1200) events.push(...S.tick(s, 0.5));
  assert.ok(s.pending && s.pending.kind === 'toll', 'a captain hails');
  const value = S.cargoValue(s);
  assert.ok(s.pending.amount <= FORMULAS.toll.cap && s.pending.amount <= value * FORMULAS.toll.fraction + 1);
  const r = S.resolveToll(s, 'cargo');
  assert.ok(r.ok && s.cargo.reduce((a, c) => a + c.qty, 0) >= 6, 'they left most of the hold');
  assert.equal(s.pending, null);
  assert.ok(s.rep.cat > 0);
  /* The dampener that used to buy a quiet crossing is off the rack, so the
     only thing keeping a captain from being hailed is the cooldown. Out of the
     belt and back into it the same week is the case: the oath is a toll, not a
     tax, and it is not asked twice inside a month. */
  assert.ok(s.t - s.toll.lastT < FORMULAS.toll.cooldownDays, 'the hail was just now');
  s.toll.inBelt = false;
  S.tick(s, 0.5);
  assert.ok(s.toll.inBelt, 'the ship is in the belt again');
  assert.equal(s.pending, null, 'and was let alone, because it was asked this week');
});

test('a harbour takes you when you are in a stable orbit close in, and not before', () => {
  /* Docking is an orbit, not a box: bound to the world, low point clear of
     the ground, high point inside the harbour mouth. The point of the rule is
     that it is the manoeuvre a pilot was flying anyway. */
  const b = world.get('slate');
  const at = (r, v) => { const s = S.newGame(4); s.dockedAt = null; s.justLeft = null; s.ship = { body: 'slate', r, v }; return S.dockingStatus(s); };

  const circ = O.circularState(b.mu, b.dockAlt, 0);
  assert.ok(at(circ.r, circ.v).ok, 'a circle at the docking altitude is a dock');

  // At rest over a moon you are not in orbit, you are falling into it.
  assert.equal(at([b.dockAlt, 0], [0, 0]).ok, false);
  assert.equal(S.dockRefusal(at([b.dockAlt, 0], [0, 0])), 'that orbit goes through it');

  // Fast enough to leave is not an orbit at all.
  const esc = Math.sqrt(2 * b.mu / b.dockAlt) * 1.05;
  assert.equal(at([b.dockAlt, 0], [0, esc]).ok, false);
  assert.equal(S.dockRefusal(at([b.dockAlt, 0], [0, esc])), 'not in orbit');

  // Bound and clear, but swinging out past the mouth: not yet.
  const wide = Math.sqrt(b.mu * (2 / b.dockAlt - 1 / (b.zoneRadius * 0.9)));
  const st = at([b.dockAlt, 0], [0, wide]);
  assert.ok(st.bound && st.clear && !st.close, 'a long ellipse is still an orbit');
  assert.equal(st.ok, false);
  assert.equal(S.dockRefusal(st), 'too far out');
});

test('the belt havens and the Maw are rendezvous zones you match speeds with', () => {
  /* No mass, so no reach and nothing to fall towards: you arrive by being in
     the same place going the same way, which is what a harbour mouth is for. */
  for(const id of ['nail', 'whisker', 'maw']){ const b = world.get(id); assert.equal(b.mu, 0); assert.equal(b.soi, null); assert.ok(b.port); assert.ok(b.zoneRadius > 0); }
  const s = S.newGame(2);
  S.undock(s);
  s.t = 1000;
  parkAt(s, 'nail');
  assert.ok(S.dock(s).ok, 'matching speeds with Nail is docking at it');
  // And the Maw says its piece to a first visitor, which is the whole of it.
  const far = S.newGame(2);
  S.undock(far);
  far.t = 1000;
  parkAt(far, 'maw');
  const r = S.dock(far);
  assert.ok(r.ok && far.flags.mawArrival, 'the Maw had nothing to say');
});

test('aiming turns a rough plan into an arrival, everywhere in Tassel\'s system', () => {
  /* "Aim for it" is the game's one convenience, and the thing a beginner will
     lean on hardest: it must land inside the harbour mouth from every moon to
     every other, and from each of them back down to Tassel. */
  for(const [from, to] of [['tassel', 'moss'], ['tassel', 'slate'], ['slate', 'moss'], ['moss', 'slate'], ['moss', 'tassel'], ['slate', 'tassel']]){
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

test('aiming reaches every port in the system from a Tassel orbit', () => {
  const starts = () => {
    const s = S.newGame(5);
    S.undock(s);
    const abs = O.absState(world, 'tassel', s.t);
    s.ship = { body: 'lamp', r: abs.r, v: abs.v };
    s.dv = S.auDay(40);          // the deep tank, which is what an outer run needs
    return s;
  };
  for(const to of ['cinder', 'veyra', 'nail', 'whisker', 'arc', 'grumm', 'maw']){
    const s = starts();
    s.target = to;
    const r = S.trimToTarget(s, to, 12000);
    const tb = world.get(to);
    assert.ok(r.ok, `${to}: ${r.reason}`);
    // What counts as arrived is the game's own idea of it: a port's harbour
    // mouth, or properly inside the reach of a world that has no port on it.
    const mouth = S.mouthOf(to);
    assert.ok(r.distance <= mouth, `${to}: near pass ${r.distance} outside ${mouth}`);
    void tb;
    assert.ok(r.cost <= S.auDay(40) * 0.85, `${to}: ${S.fmtKms(r.cost)} is more than the deep tank affords`);
  }
  // A moon of another planet is two journeys, and the game says so rather than flailing.
  const s = starts();
  const r = S.trimToTarget(s, 'haven', 12000);
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
  const mu = world.get('tassel').mu;
  const a = world.get('moss').a;
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
  for(const [from, to] of [['tassel', 'moss'], ['tassel', 'slate'], ['moss', 'slate'], ['slate', 'moss']]){
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
  const b = world.get('moss');
  // A steep hyperbolic approach whose kiss is buried in the moon.
  const speed = Math.sqrt(2 * b.mu / b.soi) * 2.2;
  s.ship = { body: 'moss', r: [b.soi * 0.95, 0], v: [-speed, speed * 0.1] };
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

  /* A ship falling dead straight at a world used to be beyond help: forward
     and outward were the same line for it, so no pair of numbers on a mark
     added up to a push across, and the game said nothing. With the axes at
     right angles it can say something — and it has to, because braking a
     radial fall does not lift it. A dead-straight drop has no angular momentum
     and therefore no periapsis to raise; the only way to miss is to push
     across the line, which is exactly the mark there was no way to write. */
  const straight = S.newGame(5);
  S.undock(straight);
  straight.ship = { body: 'moss', r: [b.soi * 0.95, 0], v: [-speed, 0] };
  const k = S.kiss(straight);
  assert.ok(k && k.crashes, 'a straight drop is not even reported');
  const jx = S.brakeAtKiss(straight);
  assert.ok(jx >= 0, 'nothing was offered to a ship falling straight in');
  assert.ok(Math.abs(straight.nodes[jx].radial) > 0, 'what was offered does not push across the fall');
  guard = 0;
  while(straight.nodes.length && guard++ < 40000) S.tick(straight, 0.002);
  assert.equal(straight.pending, null, 'the ship flew into the moon anyway');
  assert.ok(!S.kiss(straight)?.crashes, 'the straight drop still digs in');
});

test('what a mark costs is the triangle on its card, on any orbit', () => {
  /* The two axes are at right angles everywhere now — forward along the
     velocity, out perpendicular to it — so the two numbers on a mark's card
     really do add up as a triangle, and that triangle is what the tank is
     charged. Out used to be true radial, which leans into forward on anything
     but a circle: the card and the tank then disagreed, badly, on an eccentric
     orbit. */
  const s = S.newGame(5);
  S.undock(s);
  const b = world.get('tassel');
  // A good eccentric orbit, where the two axes lean well apart.
  s.ship = { body: 'tassel', r: [b.dockAlt, 0], v: [Math.sqrt(b.mu / b.dockAlt) * 0.5, Math.sqrt(b.mu / b.dockAlt) * 1.1] };
  s.nodes = [{ t: s.t + 0.3, prograde: S.auDay(0.4), radial: S.auDay(-0.3) }];
  const [mark] = S.markStates(s, 90);
  assert.ok(mark.body, 'the mark is not on the plan');
  const shown = S.planCost(s);
  assert.ok(Math.abs(shown - mark.cost) < 1e-12);
  const before = s.dv;
  let guard = 0;
  while(s.nodes.length && guard++ < 20000) S.tick(s, 0.005);
  const charged = before - s.dv;
  /* Relative, not absolute: the plan predicts the firing state in one jump and
     the flight reaches it in sixty, so the two part company by a few parts per
     million of Kepler arithmetic. The claim is that the card does not lie
     about what it can afford, and five millionths of a burn does not. */
  assert.ok(Math.abs(charged - shown) <= shown * 1e-4, `told ${S.fmtKms(shown)}, charged ${S.fmtKms(charged)}`);
  /* And the triangle is the answer, on an orbit chosen to be as far from a
     circle as this sky allows — which is the whole of the change. */
  const triangle = Math.hypot(S.auDay(0.4), S.auDay(-0.3));
  assert.ok(Math.abs(triangle - shown) <= shown * 1e-12, `card says ${triangle}, plan says ${shown}`);
  assert.ok(Math.abs(triangle - charged) <= charged * 1e-4, 'the triangle is not what the tank was charged');
  // Because the frame really is orthonormal, wherever the ship is.
  const fr = O.burnFrame(s.ship.r, s.ship.v);
  assert.ok(Math.abs(O.dot(fr.pro, fr.out)) < 1e-12, 'forward and out are not at right angles');
  assert.ok(Math.abs(O.norm(fr.pro) - 1) < 1e-12 && Math.abs(O.norm(fr.out) - 1) < 1e-12, 'the frame is not unit length');
  assert.ok(O.dot(fr.out, s.ship.r) > 0, '"out" does not point away from the world');
});

test('a dry ship with an empty purse can still leave the dock', () => {
  /* Nothing may cost the save, and a ship with no fuel and no coin tied up at
     a dock would be exactly that. The harbour bank fronts it, at a price. */
  const s = newDocked(5);
  s.dv = 0;
  s.money = 0;
  assert.ok(S.fuelCredit(s) > 0, 'no credit offered');
  const r = S.refuel(s, 3);
  assert.ok(r.ok && r.borrowed > 0, 'the tank stayed dry');
  assert.ok(S.kms(s.dv) >= 2.5, `only got ${S.fmtKms(s.dv)}`);
  assert.ok(s.debt > 0 && s.money === 0);
  // And it is a floor, not a facility: a full purse borrows nothing.
  const rich = newDocked(5);
  rich.dv = 0;
  rich.money = 100000;
  const r2 = S.refuel(rich, 5);
  assert.ok(r2.ok && !r2.borrowed && rich.debt === 0);
  // Nor does a ship that already has fuel.
  const fine = S.newGame(5);
  fine.money = 0;
  assert.equal(S.fuelCredit(fine), 0);
});

test('the Belt toll takes a share by worth, never nothing and never the hold', () => {
  /* A toll counted in crates took nothing at all from a light hold of valuable
     things and stripped a heavy hold of cheap ones. It is a share of what the
     hold is worth, and the cats' oath is the ceiling. */
  const cases = [
    ['a light hold of dear things', [{ good: 'tideglass', qty: 3 }]],
    ['a heavy hold of cheap things', [{ good: 'ironore', qty: 24 }]],
    ['a mixed hold', [{ good: 'tideglass', qty: 4 }, { good: 'ironore', qty: 10 }]],
    ['one crate', [{ good: 'tideglass', qty: 1 }]],
  ];
  for(const [name, hold] of cases){
    const s = S.newGame(13);
    S.undock(s);
    s.cargo = hold.map(h => ({ ...h, t: s.t, price: S.goodById(h.good).basePrice, from: 'tassel' }));
    const worth = S.cargoValue(s);
    if(worth < FORMULAS.toll.minCargoValue) continue;   // they wave a poor ship through
    const asked = Math.round(Math.min(FORMULAS.toll.cap, FORMULAS.toll.fraction * worth));
    s.pending = { kind: 'toll', amount: asked, captain: 'Captain Test', line: '', cargoValue: worth };
    const before = s.cargo.reduce((a, c) => a + c.qty, 0);
    const rep0 = s.rep.cat;
    const r = S.resolveToll(s, 'cargo');
    assert.ok(r.ok, name);
    const left = s.cargo.reduce((a, c) => a + c.qty, 0);
    const tookValue = worth - S.cargoValue(s);
    const paidCoin = CONST.START_MONEY - s.money;
    assert.ok(tookValue > 0 || paidCoin > 0, `${name}: nothing changed hands and they thanked you for it`);
    assert.ok(tookValue <= worth * FORMULAS.toll.maxCargoFraction + 1e-9, `${name}: took ${tookValue} of ${worth}`);
    /* Crates are lumpy: a toll settled in goods can only be made of what is
       aboard, and the last crate is taken whenever it leaves the debt smaller
       than it found it. So they can overshoot — by at most half of one crate,
       and never by more. */
    const halfCrate = Math.max(...hold.map(h => S.goodById(h.good).basePrice)) * 0.5;
    if(tookValue > 0) assert.ok(tookValue <= asked + halfCrate + 1 || before - left === 1, `${name}: took ${tookValue} against a toll of ${asked}`);
    assert.ok(left > 0, `${name}: they took the hold`);
    assert.ok(s.rep.cat > rep0, `${name}: no goodwill for yielding`);
  }
  /* A ship with nothing worth taking is never hailed in the first place: the
     toll is a custom, not a shakedown. */
  const poor = S.newGame(13);
  S.undock(poor);
  poor.cargo = [{ good: 'pebble', qty: 1, t: poor.t, price: 8, from: 'slate' }];
  poor.ship = { body: 'lamp', ...O.circularState(MU, CONST.BELT.inner - 0.1, 1.0) };
  poor.ship.v = O.scale(poor.ship.v, 1.12);
  let guard = 0;
  while(!poor.toll.inBelt && guard++ < 1200) S.tick(poor, 0.5);
  assert.ok(poor.toll.inBelt, 'the poor ship never crossed');
  assert.equal(poor.pending, null, 'a hold worth nothing was still shaken down');
  assert.ok(poor.log.some(l => /waves you through|laughs/.test(l.text)), 'and nobody said anything about it');
});

test('a save is refused at the door rather than halfway through a frame', () => {
  const good = S.serialize(S.newGame(5));
  assert.ok(S.restore(good));
  const broken = {
    'no ship': s => { delete s.ship; },
    'a ship nowhere': s => { s.ship.body = 'atlantis'; },
    'a position that is not numbers': s => { s.ship.r = ['x', 2]; },
    'a time that is not a number': s => { s.t = 'soon'; },
    'docked at a non-port': s => { s.dockedAt = 'lamp'; },
    'a hold of something unknown': s => { s.cargo = [{ good: 'moonbeams', qty: 2 }]; },
    'a plan of nonsense': s => { s.nodes = [{ prograde: 1 }]; },
    'a tank that does not exist': s => { s.tiers.tank = 9; },
    /* Version 1 is the sky before the rescale, version 2 the map before the
       setting was rewritten, version 3 the price list before every good in it
       was replaced, version 4 the game that still had a contract board and a
       passenger list, and version 5 the ship that was fitted with an engine
       and a dampener. A ship's position, a port name, a hold full of crates or
       a list of people waiting to be somewhere: none of it means anything
       here, so those saves are refused rather than repaired. */
    'a version this sky is not': s => { s.version = 1; },
    'the map before the setting changed': s => { s.version = 2; },
    'the price list before the goods changed': s => { s.version = 3; },
    'the contract board before it was taken away': s => { s.version = 4; },
    'the rack before it was rebuilt': s => { s.version = 5; },
    'a version from the future': s => { s.version = 7; },
  };
  for(const [what, wreck] of Object.entries(broken)){
    const s = JSON.parse(good);
    wreck(s);
    assert.throws(() => S.restore(s), /Not a save/, `${what} was let through`);
  }
  // Fields a later version added are filled in quietly rather than refused.
  const old = JSON.parse(good);
  for(const k of ['markets', 'log', 'rep', 'visited', 'flags', 'justLeft', 'shipName']) delete old[k];
  old.warp = 1e9;        // the clock is a rate now, not a rung, and the rate has a ceiling
  const back = S.restore(old);
  assert.ok(back.markets && back.log && back.rep.otter === 0 && back.shipName);
  assert.equal(back.warp, CONST.MAX_WARP);
});

test('a port with nothing to sell and no pumps is never somewhere a tow leaves you', () => {
  /* The Maw has no market, no fuel and nobody in it: it is a destination, not
     a harbour. A tow that dropped a ship there would have moved the dead end
     rather than rescued anybody, and nothing in this game may cost the save. */
  const s = S.newGame(5);
  s.dockedAt = 'maw';
  assert.equal(S.fuelPrice(s), null, 'somebody is selling fuel at the Maw');
  assert.equal(S.refuel(s, 1).ok, false);
  assert.equal(PORTS.maw.towAllowed, false);

  s.dockedAt = null;
  S.undock(s);
  for(const id of ['maw', 'arc']){
    const at = O.absState(world, id, s.t);
    s.ship = { body: 'lamp', r: at.r, v: at.v };
    s.dv = 0;
    const q = S.towQuote(s);
    assert.notEqual(q.port, id, `a dry ship towed to ${id}, which sells no fuel`);
  }
});

test('quantities are whole crates, and at least one', () => {
  const s = newDocked(5);
  const good = PORTS.tassel.sells[0].good;
  const money = s.money;
  for(const bad of [-5, 0, 1.5, NaN, '3']){
    assert.equal(S.canBuy(s, good, bad).ok, false, `buying ${bad} was allowed`);
    assert.equal(S.buy(s, good, bad).ok, false, `buying ${bad} went through`);
    assert.equal(S.sell(s, good, bad).ok, false, `selling ${bad} went through`);
  }
  assert.equal(s.money, money);
  assert.equal(S.usedUnits(s), 0);
});

test('casting off with a dry tank does not lock the door behind you', () => {
  const s = S.newGame(5);
  s.dv = 0;
  S.undock(s);
  assert.equal(S.dockingStatus(s), null, 'the port asks you straight back');
  S.tick(s, 0.01);
  assert.equal(s.justLeft, null, 'a dry ship is shut out of the only port it can reach');
  const st = S.dockingStatus(s);
  assert.ok(st && st.port === 'tassel' && st.ok, 'and cannot get back in');
  assert.ok(S.dock(s).ok);
});

test('arriving on the end of a rope is still arriving, and never at a dead end', () => {
  /* A crash still has fuel in the tank, so the tug takes the nearest dock —
     and whatever that place has to say to a first visitor, it says. */
  const crashed = S.newGame(5);
  S.undock(crashed);
  crashed.t = 3000;
  const at = O.absState(world, 'arc', crashed.t);
  crashed.ship = { body: 'lamp', r: at.r, v: at.v };
  const r = S.callTow(crashed, 'crash');
  assert.equal(r.port, 'arc');
  assert.ok(crashed.visited.includes('arc'));

  /* A dry ship is different. Two ports sell nothing to burn, and a tow that
     leaves a dry ship at one of them has not rescued anybody — it has moved
     the dead end. */
  for(const dead of ['arc', 'maw']){
    const s = S.newGame(5);
    S.undock(s);
    s.t = 3000;
    const p = O.absState(world, dead, s.t);
    s.ship = { body: 'lamp', r: p.r, v: p.v };
    s.dv = 0;
    const q = S.towQuote(s);
    assert.notEqual(q.port, dead, `a dry ship towed to ${dead}, which sells no fuel`);
    assert.ok(PORTS[q.port].fuelPricePerKms != null, `${dead}: towed to ${q.port}, which sells no fuel either`);
  }

  // And a tow never delivers you to the dock you are already tied up at.
  const docked = S.newGame(5);
  docked.dv = 0;
  assert.notEqual(S.towQuote(docked).port, docked.dockedAt);
});

test('every key the code reads is a key the ship can actually have', () => {
  /* Three upgrades were dead at once and the suite could not see it. The state
     keys are camelCase — heatShield, gravSensors, cryoCooling — and the
     upgrade *ids* that buy them are flat lowercase, so `keys.heatshield` reads
     like a key and is always undefined. Air braking, the cat sensors and the
     cryo cooling were all sold, all paid for, and all wired to nothing, and
     the air-braking test passed because it set the misspelling too.

     So this reads the source rather than the behaviour: every `keys.X` in the
     game's own files has to be a key a new ship actually carries. A test that
     goes through the same typo as the code cannot catch the typo. */
  const real = new Set(Object.keys(S.newGame(1).keys));
  assert.ok(real.size >= 4, 'a ship with no keys at all: this test is looking at the wrong thing');
  for(const file of ['sim.js', 'play.html', 'content.js', 'render.js', 'orbit.js']){
    const src = readFileSync(new URL(`../public/orbital-trader/${file}`, import.meta.url), 'utf8');
    for(const m of src.matchAll(/\bkeys\??\.([A-Za-z_$][\w$]*)\b/g)){
      assert.ok(real.has(m[1]), `${file} reads keys.${m[1]}, which no ship has. Keys are: ${[...real].join(', ')}`);
    }
  }
});

/* ------------------------------------------------------------ air braking */

test('a shield is what lets a ship skim, and cooling is what makes it free', () => {
  const bare = S.newGame(1);
  assert.equal(S.skimsAir(bare), false, 'no shield, no skim');
  const shielded = S.newGame(1); shielded.keys.heatShield = true;
  assert.equal(S.skimsAir(shielded), true);
  /* The rack sells cooling as "no risk to the hull at all, however deep you
     go". That claim is this assertion. */
  const cooled = S.newGame(1); cooled.keys.heatShield = true; cooled.keys.cryoCooling = true;
  for(const kms of [0.5, 2, 10]) assert.equal(S.skimRisk(cooled, kms / S.KMS), 0, `cooled at ${kms} km/s`);
});

test('shallow passes are safer than one dive, not the same risk spread thin', () => {
  const s = S.newGame(1); s.keys.heatShield = true;
  const F = S.FORMULAS.aerobrake;
  assert.equal(S.skimRisk(s, (F.freeKms * 0.9) / S.KMS), 0, 'a pass inside the free allowance is free');
  /* The whole point of the convex curve: four passes shedding a quarter each
     must cost less total risk than one pass shedding the lot. A linear rule
     would make these equal and the patient pilot a fool. */
  const total = 2.0;
  const one = S.skimRisk(s, total / S.KMS);
  const four = 4 * S.skimRisk(s, (total / 4) / S.KMS);
  assert.ok(four < one, `four shallow (${four.toFixed(3)}) should beat one deep (${one.toFixed(3)})`);
  assert.ok(S.skimRisk(s, 99 / S.KMS) <= F.maxRisk, 'risk is capped');
});

test('a burnt fuel cell caps the tank and never empties it in flight', () => {
  const s = S.newGame(1); s.dockedAt = null;
  const full = s.dv;
  s.faults = { fuelCell: true };
  assert.ok(S.usableTank(s) < s.tank, 'the cap bites');
  assert.equal(S.usableTank(s), s.tank * S.FUEL_CELL_CAP);
  /* Harsh, but it must never stop a ship that is already flying: the fault is
     felt at the pump, where there is something the player can do about it. */
  assert.equal(s.dv, full, 'the fault does not take fuel out of the tank mid-flight');
  assert.ok(S.usableTank(s) > S.CREDIT_KMS / S.KMS, 'a capped tank still clears the credit floor');
});

test('a wrecked hull is towed and rebuilt, never left at a level the yard cannot price', () => {
  const s = S.newGame(1);
  s.dockedAt = null; s.hull = S.HULL_WRECKED;
  assert.equal(S.repairCost(s, 'hull'), 0, 'no yard price exists at wrecked');
  const before = s.money;
  S.callTow(s, 'crash');
  assert.equal(S.hullLevel(s), 0, 'the tow puts the pieces back');
  assert.ok(s.dockedAt, 'and it ends docked somewhere real');
  assert.ok(s.money < before || s.debt > 0, 'and it costs, in coin or in debt');
  assert.ok(s.money >= 0, 'money never goes negative');
});

test('repair clears the fault, costs coin, and is never required to undock', () => {
  const s = S.newGame(1);
  s.hull = 2; s.money = 100000;
  const yard = Object.keys(PORTS).find(id => PORTS[id].shipyard);
  s.dockedAt = yard;
  const cost = S.repairCost(s, 'hull');
  assert.ok(cost > 0);
  const r = S.repair(s, 'hull');
  assert.ok(r.ok && S.hullLevel(s) === 0 && s.money === 100000 - cost);
  /* The soft-lock guard: a battered ship with nothing in the purse still flies,
     so it can always go and earn the repair. */
  const broke = S.newGame(1); broke.hull = 3; broke.money = 0; broke.dockedAt = yard;
  assert.equal(S.canRepair(broke, 'hull').ok, false, 'cannot afford it');
  assert.equal(S.undock(broke).ok !== false, true, 'but can still leave');
});

test('the chart warns before the air and before the ground, and differently', () => {
  const docked = S.newGame(1);
  assert.deepEqual(S.hazards(docked), { skim: null, crash: null }, 'nothing to warn about at a dock');
  /* Ground: aim the ship at the world it is going round and the prediction
     must say so, with or without a shield. */
  const s = S.newGame(1);
  S.undock(s);
  const b = S.world.get(s.ship.body);
  s.ship = { ...s.ship, v: [s.ship.v[0] * 0.05, s.ship.v[1] * 0.05, 0] };
  const h = S.hazards(s);
  assert.ok(h.crash, 'a path into the ground raises the ground mark');
  assert.equal(h.crash.body, b.id);
});

test('the skim look-ahead is bounded once the orbit closes', () => {
  /* A flat horizon here cost ~180ms a step for a ship in a low orbit — three
     predictions across thousands of laps, every tick, which is a stutter in
     the one place the player is flying carefully. */
  const s = S.newGame(1); s.keys.heatShield = true; S.undock(s);
  const g = S.world.get('grumm');
  const rp = g.atmo * 0.99, ra = g.atmo * 1.4;
  const a = (rp + ra) / 2;
  s.ship = { body: 'grumm', r: [rp, 0, 0], v: [0, Math.sqrt(g.mu * (2 / rp - 1 / a)), 0] };
  const el = S.elementsFromState(g.mu, s.ship.r, s.ship.v);
  const h = S.skimHorizon(s, 1);
  assert.ok(Number.isFinite(el.period), 'this orbit is closed');
  /* The floor is the step itself — a horizon shorter than the tick would miss
     marks inside it — so the bound is "a few laps, or the step, whichever is
     larger", and nowhere near the flat 150 it used to be. */
  assert.ok(h <= Math.max(2, el.period * 3), `horizon ${h.toFixed(2)} should be a few laps`);
  assert.ok(h < 150, `horizon ${h.toFixed(2)} should be far below the old flat 150`);
  /* The long look survives for the arc that needs it: an inbound hyperbola has
     no period, and its periapsis really can be months away. */
  const far = S.newGame(1); far.keys.heatShield = true; S.undock(far);
  const r0 = g.zoneRadius * 0.95;
  far.ship = { body: 'grumm', r: [r0, 0, 0], v: [-Math.sqrt(2.4 * g.mu / r0), 0.02 * Math.sqrt(g.mu / r0), 0] };
  assert.equal(S.skimHorizon(far, 1), 150, 'an unbound arrival still gets the long look');
});

test('a graze is free and a dive is not', () => {
  /* The shape the whole mechanic rests on, measured through the real node
     builder rather than the risk formula alone: periapsis near the cloud tops
     sheds little and costs nothing, periapsis down in the air sheds a lot and
     is dangerous. If these ever invert, shallow flying stops being a skill. */
  const g = S.world.get('grumm');
  const make = frac => {
    const s = S.newGame(4); s.keys.heatShield = true; S.undock(s);
    const rp = g.radius + (g.atmo - g.radius) * frac, r0 = g.zoneRadius * 0.95;
    const vInf = 0.3 * Math.sqrt(g.mu / rp), vp = Math.sqrt(vInf * vInf + 2 * g.mu / rp);
    const hh = rp * vp, v0 = Math.sqrt(vInf * vInf + 2 * g.mu / r0), vt = hh / r0;
    s.ship = { body: 'grumm', r: [r0, 0, 0], v: [-Math.sqrt(Math.max(0, v0 * v0 - vt * vt)), vt, 0] };
    s.nodes = [];
    const n = S.effectiveNodes(s, 300).find(x => x.aero);
    return { shed: n ? Math.abs(n.prograde) : 0, risk: n ? S.skimRisk(s, Math.abs(n.prograde)) : 0 };
  };
  const graze = make(0.97), dive = make(0.35);
  assert.ok(graze.shed > 0, 'a graze still sheds something');
  assert.equal(graze.risk, 0, 'and costs nothing: "the air will slow you for nothing"');
  assert.ok(dive.shed > graze.shed * 3, `a dive sheds much more (${S.fmtKms(dive.shed)} vs ${S.fmtKms(graze.shed)})`);
  assert.ok(dive.risk > 0.2, `and is genuinely dangerous (${(dive.risk * 100).toFixed(0)}%)`);
});

/* -------------------------------------------------------------- the Knot */

test('the Knot is in the sky for everybody and on the chart only for some', () => {
  const k = BODIES.find(b => b.id === 'knot');
  assert.ok(k, 'the Knot exists');
  assert.equal(k.kind, 'hole');
  assert.ok(k.a > BODIES.find(b => b.id === 'tassel').a, 'outside Tassel');
  assert.ok(k.a < CONST.BELT.inner, 'and inside the Belt');
  assert.ok(k.mu > 0 && k.soi > 0, 'it has real pull');
  /* The point of it: a horizon small enough that a ship can pass very close
     without meeting anything. Everything else in the sky is at least a
     hundred times wider. */
  const smallest = Math.min(...BODIES.filter(b => b.id !== 'knot').map(b => b.radius));
  assert.ok(k.radius * 100 < smallest, `${k.radius} should be far under ${smallest}`);

  const green = S.newGame(1);
  assert.equal(S.knowsKnot(green), false);
  assert.ok(S.unseen(green).has('knot'), 'a green crew does not see it');
  const nav = S.newGame(1); nav.crew.navigator = { name: 'Tsuki' };
  assert.equal(S.knowsKnot(nav), true);
  assert.equal(S.unseen(nav).has('knot'), false, 'the navigator knows where it is');
  /* The other way in, and the phenomenon that key was always sold to find. */
  const sensors = S.newGame(1); sensors.keys.gravSensors = true;
  assert.equal(S.knowsKnot(sensors), true, 'gravitational sensors find it by looking');
});

test('a close pass at the Knot is worth real speed and stays finite', () => {
  const k = S.world.get('knot');
  const run = rpKm => {
    const s = S.newGame(1); s.crew.navigator = { name: 'Tsuki' }; S.undock(s);
    const rp = rpKm / 1.496e8, r0 = k.soi * 0.9, vinf = 0.004;
    const vp = Math.sqrt(vinf * vinf + 2 * k.mu / rp), h = rp * vp;
    const v0 = Math.sqrt(vinf * vinf + 2 * k.mu / r0), vt = h / r0;
    s.ship = { body: 'knot', r: [r0, 0, 0], v: [-Math.sqrt(Math.max(0, v0 * v0 - vt * vt)), vt, 0] };
    s.nodes = [];
    const before = S.norm(S.shipAbsVel(s));
    const fuel = s.dv;
    for(let i = 0; i < 4000; i++){ S.tick(s, 0.05); if(s.pending || s.ship.body !== 'knot') break; }
    return { before, after: S.norm(S.shipAbsVel(s)), pending: s.pending, fuel, dv: s.dv, body: s.ship.body };
  };
  for(const rpKm of [3740, 374, 37]){
    const r = run(rpKm);
    assert.equal(r.pending, null, `a pass at ${rpKm} km should not end in a crash`);
    assert.ok(Number.isFinite(r.after), `${rpKm} km: the kernel stays finite at these speeds`);
    assert.ok(Math.abs(r.after - r.before) * S.KMS > 1, `${rpKm} km: worth at least a km/s`);
    assert.equal(r.dv, r.fuel, `${rpKm} km: and it costs no fuel`);
  }
});

test('only a navigator can see past a flyby, and the button can turn it off', () => {
  const green = S.newGame(1);
  assert.equal(S.canSeePast(green), false, 'no navigator, no button');
  assert.equal(S.seesPast(green), false);
  const nav = S.newGame(1); nav.crew.navigator = { name: 'Tsuki' };
  assert.equal(S.canSeePast(nav), true);
  assert.equal(S.seesPast(nav), true, 'on by default once she is aboard');
  nav.farSight = false;
  assert.equal(S.canSeePast(nav), true, 'she is still aboard');
  assert.equal(S.seesPast(nav), false, 'but the chart is back to one crossing');
  /* The far view costs solves, so it must never run for a ship that has
     nobody to read it. */
  green.farSight = true;
  assert.equal(S.seesPast(green), false, 'and it cannot be switched on without her');
});

/* ------------------------------------------------------------- the slots */

/* A localStorage that lives in a variable, including the two ways a real one
   misbehaves: throwing on write when the quota is gone, and throwing on read
   when site data is blocked. */
function fakeStore(init = {}){
  const map = new Map(Object.entries(init));
  return {
    map,
    failWrites: false,
    failReads: false,
    getItem(k){ if(this.failReads) throw new Error('blocked'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v){ if(this.failWrites) throw new Error('quota'); map.set(k, String(v)); },
    removeItem(k){ map.delete(k); },
  };
}

test('a save survives the trip out to a hex string and back', () => {
  const s = S.newGame(7);
  S.undock(s);
  for(let i = 0; i < 10; i++) S.tick(s, 1);
  const hex = S.exportSave(s);
  assert.match(hex, /^[0-9a-f]+$/, 'hex and nothing else');
  assert.equal(hex.length % 2, 0);
  assert.equal(S.serialize(S.importSave(hex)), S.serialize(s), 'byte for byte the same game');
  /* Whatever the paste picked up on the way. */
  const messy = hex.toUpperCase().replace(/(.{40})/g, '$1\n  ');
  assert.equal(S.serialize(S.importSave(messy)), S.serialize(s), 'case and line breaks do not matter');
});

test('a damaged hex string is refused with a reason, never half-loaded', () => {
  const good = S.exportSave(S.newGame(1));
  for(const [bad, why] of [['', 'empty'], ['zzzz', 'not hex'], ['abc', 'odd length'], ['ffff', 'not text']]){
    assert.throws(() => S.importSave(bad), /.+/, `${why} should be refused`);
  }
  /* A save from a sky this game is not flying is refused by the same gate a
     stored one goes through, rather than loading into a broken world. */
  const old = S.toHex(JSON.stringify({ ...JSON.parse(S.serialize(S.newGame(1))), version: 5 }));
  assert.throws(() => S.importSave(old), /version 5/);
  assert.ok(S.importSave(good), 'and a good one still loads');
});

test('three slots, kept apart', () => {
  const st = fakeStore();
  assert.equal(S.readSlot(1, st), null, 'they start empty');
  const a = S.newGame(1), b = S.newGame(2);
  a.money = 111; b.money = 222;
  S.writeSlot(1, a, st); S.writeSlot(3, b, st);
  assert.equal(S.readSlot(1, st).money, 111);
  assert.equal(S.readSlot(2, st), null, 'the middle one is still free');
  assert.equal(S.readSlot(3, st).money, 222);
  S.clearSlot(1, st);
  assert.equal(S.readSlot(1, st), null, 'and one can be emptied without touching the others');
  assert.equal(S.readSlot(3, st).money, 222);
  /* Nothing outside one, two, three is a slot. */
  for(const n of [0, 4, -1, '2x', null]) assert.equal(S.writeSlot(n, a, st), false, `${n} is not a slot`);
});

test('an old save becomes slot one, and is only let go once the copy is there', () => {
  const legacy = S.serialize(S.newGame(5));
  const st = fakeStore({ [S.LEGACY_KEY]: legacy });
  assert.equal(S.migrateLegacy(st), 'moved');
  assert.equal(st.map.get(S.slotKey(1)), legacy, 'the save is in slot one');
  assert.equal(st.map.has(S.LEGACY_KEY), false, 'and the old key is gone');
  assert.equal(S.migrateLegacy(st), 'none', 'running it again does nothing');

  /* A player who already has a game in slot one keeps it. */
  const busy = fakeStore({ [S.LEGACY_KEY]: legacy, [S.slotKey(1)]: S.serialize(S.newGame(9)) });
  assert.equal(S.migrateLegacy(busy), 'kept');
  assert.equal(busy.map.get(S.LEGACY_KEY), legacy, 'and the old save is not thrown away');

  /* If the copy cannot be written, the original stays where it is. */
  const full = fakeStore({ [S.LEGACY_KEY]: legacy });
  full.failWrites = true;
  assert.equal(S.migrateLegacy(full), 'failed');
  assert.equal(full.map.get(S.LEGACY_KEY), legacy, 'nothing is lost to a failed write');
});

test('storage that throws is the same as storage that is empty', () => {
  /* A private window, or site data blocked: the pages must render and the
     game must play. Nothing here may throw into a draw. */
  const st = fakeStore({ [S.slotKey(1)]: S.serialize(S.newGame(1)) });
  st.failReads = true;
  assert.equal(S.readSlot(1, st), null);
  assert.equal(S.migrateLegacy(st), 'none');
  assert.equal(S.activeSlot(st), 1, 'and the active slot falls back to the first');
  st.failReads = false; st.failWrites = true;
  assert.equal(S.writeSlot(2, S.newGame(1), st), false, 'a write that cannot happen says so');
});

test('a slot describes itself for the title screen', () => {
  const s = S.newGame(3);
  const sum = S.slotSummary(s);
  assert.ok(sum.shipName && sum.year >= 1 && sum.day >= 1);
  assert.match(sum.text, /year \d+, day \d+/);
  /* A new game opens in orbit above Tassel rather than tied up, so there is
     no port to name and the line says so instead. */
  assert.equal(sum.where, null);
  assert.match(sum.text, /under way$/);
  const docked = S.newGame(3); docked.dockedAt = 'tassel';
  assert.equal(S.slotSummary(docked).where, S.portName('tassel'));
  assert.match(S.slotSummary(docked).text, /docked at /);
  assert.equal(S.slotSummary(null), null);
});
