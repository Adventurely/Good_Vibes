import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import * as O from '../public/orbital-trader/orbit.js';
import { PORTRAITS, PORTRAIT_SIZE, portraitURL } from '../public/orbital-trader/sprites.js';
import {
  CONST, BODIES, GOODS, PORTS, UPGRADES, FORMULAS, TEXT, GLOSSARY, SPECIES, BELT_ROCKS,
} from '../public/orbital-trader/content.js';
import * as S from '../public/orbital-trader/sim.js';
import { createChart } from '../public/orbital-trader/render.js';
import { DURATION, BREACH, BEATS, beatAt, ascent, skyAt, ROCKET } from '../public/orbital-trader/intro.js';

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
    if(b.retrograde) assert.equal(b.id, 'croak', 'only Croak runs backwards');
  }
  for(const id of ['lamp', 'cinder', 'scorch', 'veyra', 'tassel', 'slate', 'moss', 'nail', 'whisker', 'arc', 'grumm', 'brine', 'glass', 'croak', 'haven', 'maw']){
    assert.ok(ids.has(id), `the design document's ${id} is in the sky`);
  }
  assert.equal(BODIES.length, 16, 'the sky is the sixteen bodies the setting names');
  assert.ok(world.get('croak').retrograde, 'Croak is retrograde');
});

test('the rails keep the promises the design makes', () => {
  const yr = O.period(MU, world.get('tassel').a);
  assert.ok(Math.abs(yr - CONST.YEAR_DAYS) < 1e-6, `Tassel's year is ${yr} days`);
  const cinderYear = O.period(MU, world.get('cinder').a);
  assert.ok(cinderYear > 30 && cinderYear < 80, `Cinder's year is weeks (${cinderYear.toFixed(1)} d)`);
  // The inner worlds are in the order the setting puts them, and the Maw is
  // the far edge of everything.
  assert.ok(world.get('cinder').a < world.get('veyra').a && world.get('veyra').a < world.get('tassel').a);
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
  assert.ok(CONST.BELT.inner >= 1.8 && CONST.BELT.outer <= 3 && CONST.BELT.inner < CONST.BELT.outer);
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
    if(g.lifetimeDays != null) assert.ok(g.lifetimeDays > 0);
    // Somebody, somewhere, has to want it, or it is a crate that cannot be sold.
    assert.ok(Object.keys(PORTS).some(id => S.wantsGood(id, g.id)), `${g.id} has no buyer anywhere`);
  }
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
  /* The dampener used to be lying about at Hush, which is not in the sky any
     more. Somebody on Whisker will now fit you one, for money and no talk. */
  const stealth = UPGRADES.find(u => u.key === 'stealth');
  assert.deepEqual(stealth.soldAt, ['whisker'], 'the dampener is fitted at Whisker');
  assert.ok(stealth.price > 0, 'and it is bought, so it has a price');
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
  for(const k of ['tollOffer', 'tollPaidCoin', 'tollPaidCargo', 'tollStealth', 'tollGiftLater', 'towDry', 'towCrash', 'towAtmosphere', 'bankDebt', 'firstTransfer', 'firstAssist', 'firstAerobrake', 'mawArrival']){
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
  // And the page hangs its closing line on this one.
  assert.ok(BEATS.some(b => b.name === 'space'), 'no beat called space');
  for(const b of BEATS) assert.equal(beatAt(b.at), b.name, `${b.name} is not what is playing at its own mark`);
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

test('the crew menu has a captain to show and three berths to leave empty', () => {
  const c = TEXT.crew;
  assert.ok(c?.captain?.role && c.captain.name && c.captain.line, 'the captain has no card');
  assert.ok(SPECIES[c.captain.species], `captain species ${c.captain.species}`);
  assert.equal(c.roles.length, 3);
  assert.deepEqual(c.roles.map(r => r.id), ['engineer', 'navigator', 'appraiser']);
  for(const r of c.roles){
    assert.ok(r.name && r.does, `${r.id} has no words`);
    assert.ok(SPECIES[r.species], `${r.id}: species ${r.species}`);
  }
  /* The three berths are the three jobs in the line that pay in a person, so
     the peoples have to match: an Emberkin engineer, a cat navigator, a frog
     appraiser. If one of those ever moves, this is what notices. */
  assert.deepEqual(c.roles.map(r => r.species), ['emberkin', 'cat', 'frog']);

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
function stubChart(w = 800, h = 600){
  const prev = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ setTransform(){} }),
    getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }),
  };
  const chart = createChart(canvas, world);
  chart.restore = () => { if(prev === undefined) delete globalThis.window; else globalThis.window = prev; };
  return chart;
}
/* One frame's worth of the thing draw() does: read where the followed body is
 * now, and lay the player's pan on top of it. */
function settleOn(chart, id, t){
  chart.camera.anchor = [...O.absState(world, id, t).r];
  chart.settle();
}

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

function newDocked(seed, port = 'tassel'){
  const s = S.newGame(seed);
  if(port !== 'tassel'){ s.dockedAt = port; S.undock(s); }
  s.justLeft = null;
  const r = S.dock(s);
  assert.ok(r.ok, `could not tie up at ${port}: ${r.reason}`);
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
  /* No chain ships. Both of the quest chains in the line pay in crew, and
     crew does not exist, so the type is checked on a quest built here rather
     than on one in the catalogue. */
  const chain = { id: 'x', type: 'chain', stops: ['nail', 'whisker', 'arc'], to: 'nail' };
  assert.deepEqual(kinds(chain), ['visit', 'visit', 'visit', 'handover']);
  assert.deepEqual(S.questSteps(chain).map(st => st.text),
    ['Call at Nail', 'Call at Whisker', 'Call at The Arc', 'Report to Nail']);
  assert.equal(S.questTarget(chain), 'nail', 'a chain points at its first stop');

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

test('every quest in the catalogue is one a ship without crew can finish', () => {
  /* Salvage needs flight the game does not have, and three of the twenty pay
     in crew that does not exist. None of those are here: what is written down
     is what can actually be flown today. */
  for(const q of S.QUESTS){
    assert.ok(['retrieval', 'delivery', 'shopping', 'message'].includes(q.type), `${q.id}: ${q.type}`);
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
    s.keys.refrigeration = true;
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

test('a cold consignment needs a cold hold before anybody can hand it to you', () => {
  /* A delivery skips the market, so it skips the market's refrigeration
     check. Four cases of smuggled medicine and a warm hold is the case. */
  const s = newDocked(5, 'nail');
  assert.equal(S.goodById('greymeds').needsRefrigeration, true);
  const no = S.acceptQuest(s, 'medicinerun');
  assert.equal(no.ok, false);
  assert.match(no.reason, /cold hold/);
  s.keys.refrigeration = true;
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

test('markets: buying costs, selling elsewhere pays, and selling a lot walks the price down', () => {
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

test('a good is worth more out of its region, and much more where it is loved', () => {
  const s = S.newGame(5);
  /* The two rules the market runs on. Tide glass is made on Tassel, in the
     home region; Brine is in the outer region and loves it. */
  const home = S.sellPrice(s, 'tassel', 'tideglass');      // where it is made
  const away = S.sellPrice(s, 'haven', 'tideglass');       // outer, buys it, does not love it
  const loved = S.sellPrice(s, 'brine', 'tideglass');      // outer, and loves it
  assert.ok(away > home * 1.4, `carrying it out of its region is worth it: ${home} -> ${away}`);
  assert.ok(loved > away * 1.8, `and the ones who love it pay much more: ${away} -> ${loved}`);
  assert.ok(loved > S.buyPrice(s, 'tassel', 'tideglass') * 2.5, 'a loved good abroad is a trade route');

  // Region is a region, not a distance: a sibling port pays the home rate.
  assert.equal(S.regionMul('slate', 'tideglass'), S.regionMul('moss', 'tideglass'));
  assert.ok(S.regionMul('cinder', 'tideglass') > S.regionMul('slate', 'tideglass'));
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

  /* A thin shelf costs more than a full one, so buying a stall out is not
     free. Pebbles, because they are light: a hold is twenty-four units and an
     ore crate is three of them, so a heavy good runs out of ship long before
     it runs out of shelf. */
  const t = S.newGame(9);
  t.dockedAt = null; t.justLeft = null; parkAt(t, 'slate'); S.dock(t);
  t.money = 100000;
  const first = S.buyPrice(t, 'slate', 'pebble');
  const room = Math.min(S.stockAvailable(t, 'slate', 'pebble') - 1, S.freeUnits(t));
  assert.ok(room >= 4, `nothing to buy: ${room} crates of room`);
  assert.ok(S.buy(t, 'pebble', room).ok);
  assert.ok(S.buyPrice(t, 'slate', 'pebble') > first, 'the last crates on the shelf cost no more than the first');
});

test('perishables lose value with age, down to a floor', () => {
  const g = GOODS.find(g => g.lifetimeDays);
  assert.ok(g);
  assert.equal(S.freshness(g, 0), 1);
  assert.ok(S.freshness(g, g.lifetimeDays / 2) < 0.6);
  assert.equal(S.freshness(g, g.lifetimeDays * 5), FORMULAS.perishable.floor);
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

test('crossing the Belt without stealth brings a toll that never takes everything', () => {
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
  // With stealth, the same crossing is quiet.
  const s2 = S.newGame(13); S.undock(s2); s2.keys.stealth = true;
  const st2 = O.circularState(MU, CONST.BELT.inner - 0.1, 1.0);
  s2.ship = { body: 'lamp', r: st2.r, v: O.scale(st2.v, 1.12) };
  s2.cargo = [{ good: 'tideglass', qty: 10, t: s2.t, price: 80, from: 'tassel' }];
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
    /* A fifth of the circular speed at the cloud tops, rather than a number in
       au/day: what a skim can shed is set by the well it happens in, so the
       arrival this test throws at it has to be measured in the same units or
       the test only holds at one size of sky. */
    const vinf = Math.sqrt(g.mu / g.atmo) * 0.2;
    const vp = Math.sqrt(vinf * vinf + 2 * g.mu / rp);
    // Start at periapsis and run time backwards to the SOI edge to get an entry state.
    const pe = { r: [rp, 0], v: [0, vp] };
    let tBack = -0.5, st;
    for(let i = 0; i < 200; i++){ st = O.propagate(g.mu, pe.r, pe.v, tBack); if(O.norm(st.r) > g.soi * 0.9) break; tBack *= 1.3; }
    s.ship = { body: 'grumm', r: st.r, v: st.v };
    const start = { r: st.r, v: st.v };
    const events = [];
    let guard = 0;
    let after = null;
    while(guard++ < 3000 && !s.pending && s.ship.body === 'grumm'){
      const got = S.tick(s, 0.2);
      events.push(...got);
      // The state just after the dive, before the ship goes wandering.
      if(!after && s.flags.firstAerobrake) after = { r: s.ship.r, v: s.ship.v };
      /* Once the skim is on the books and the ship is back out of the clouds,
         this test has its answer. Flying on until the ship happens to blunder
         into one of Grumm's moons is a different world's arithmetic, and in a
         sky where it never does it is thousands of needless predictions — a
         shielded ship in Grumm's air looks a hundred and fifty days ahead on
         every step, and down there a lap is under a tenth of a day. */
      if(after && O.norm(s.ship.r) > g.atmo) break;
    }
    return { s, events, start, after: after ?? { r: s.ship.r, v: s.ship.v } };
  };
  const bare = dive(false);
  assert.ok(bare.s.pending && bare.s.pending.kind === 'crash', 'no shield: the clouds take the ship');
  const shielded = dive(true);
  assert.equal(shielded.s.pending, null, 'with a shield the ship survives, pass after pass');
  assert.ok(shielded.s.flags.firstAerobrake, 'the skim was noted');
  assert.equal(shielded.s.dv, shielded.s.tank, 'and it cost no fuel at all');
  /* What a skim is for: the ship arrived on an escape trajectory and Grumm's
     air alone put it into orbit. Measured in Grumm's frame at the moment the
     dive is done — where it wanders afterwards, past the frog moons, is the
     pilot's business and another world's arithmetic. */
  const before = O.elementsFromState(g.mu, shielded.start.r, shielded.start.v);
  assert.ok(before.e > 1, 'the setup was not an escape trajectory to begin with');
  const after = O.elementsFromState(g.mu, shielded.after.r, shielded.after.v);
  assert.ok(after.e < 1, `the clouds did not catch it: e ${after.e}`);
  assert.ok(after.rp > g.radius, 'and never dug it into the planet');
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

  /* A ship falling dead straight at a world is a different matter: forward and
     outward are the same line for it, so there is no pair of numbers on a mark
     that adds up to a push across, and the game says nothing rather than
     offering two enormous opposing ones that cancel. It is still told what is
     about to happen, and a crash is a tow, not an ending. */
  const straight = S.newGame(5);
  S.undock(straight);
  straight.ship = { body: 'moss', r: [b.soi * 0.95, 0], v: [-speed, 0] };
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
  // And the naive triangle really is different, so this test has something to say.
  const naive = Math.hypot(S.auDay(0.4), S.auDay(-0.3));
  assert.ok(Math.abs(naive - charged) > charged * 0.05, 'the two axes were at right angles after all');
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
       was replaced, and version 4 the game that still had a contract board and
       a passenger list. A ship's position, a port name, a hold full of crates
       or a list of people waiting to be somewhere: none of it means anything
       here, so those saves are refused rather than repaired. */
    'a version this sky is not': s => { s.version = 1; },
    'the map before the setting changed': s => { s.version = 2; },
    'the price list before the goods changed': s => { s.version = 3; },
    'the contract board before it was taken away': s => { s.version = 4; },
    'a version from the future': s => { s.version = 6; },
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
