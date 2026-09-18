import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import * as O from '../public/orbital-trader/orbit.js';
import { PORTRAITS, PORTRAIT_SIZE, portraitURL } from '../public/orbital-trader/sprites.js';
import {
  CONST, BODIES, GOODS, PORTS, UPGRADES, FORMULAS, TEXT, GLOSSARY, SPECIES, BELT_ROCKS,
  QUESTS, DIALOG,
} from '../public/orbital-trader/content.js';
import * as S from '../public/orbital-trader/sim.js';
import { createChart, railCrossings, railLead, locateOnPrediction, pathAnchors, KM_PER_AU, PALETTE, haze, bodyColour, fmtAu } from '../public/orbital-trader/render.js';
import { DURATION, BREACH, BEATS, CAPTION_AT, beatAt, ascent, skyAt, ROCKET } from '../public/orbital-trader/intro.js';
import { SONGS, QUALITIES, MUSIC_KEY, readMusicPrefs, writeMusicPrefs, createAudio } from '../public/orbital-trader/audio.js';
import { EVENTS, EVENT_RULES } from '../public/orbital-trader/content.js';

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
    assert.ok(['star', 'planet', 'moon', 'rock', 'station', 'zone', 'hole', 'wreck'].includes(b.kind), `${w}: kind ${b.kind}`);
    /* Weightless harbours — the wrecks and the station at the Dancer — are the
       one class with no price list behind them. */
    const hulk = b.port && !(b.mu > 0) && b.parent;
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
      /* Only for a world you park above. A rendezvous has no ground to clear
         and no parking orbit to sit in — its mouth is how near you have to
         come, not how high you have to fly — and the Maw is now both massive
         and one of those. */
      if(b.mu > 0 && !b.rendezvous) assert.ok(b.radius < b.dockAlt && b.dockAlt < b.zoneRadius && b.zoneRadius <= b.soi * 0.92, `${w}: ground < parking < mouth < reach`);
      if(b.rendezvous){
        assert.ok(b.dockAlt == null, `${w}: a rendezvous has a parking orbit`);
        if(b.mu > 0) assert.ok(b.zoneRadius < b.soi * 0.5, `${w}: the mouth is most of the reach`);
      }
      /* A rendezvous asks for speed rather than for an orbit, so it needs a
         speed to ask for; a world holds you and does not. */
      assert.equal(!!b.rendezvous, b.harbour === 'rendezvous' || !(b.mu > 0), `${w}: rendezvous`);
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
    /* Not for a rendezvous. Its mouth is how near you have to come, not how
       high you have to fly, so five radii over the air has nothing to say about
       it — and the Maw's horizon is a hundred and fifty kilometres, which would
       make a harbour nobody could find. */
    if(b.rendezvous) continue;
    const want = Math.max(b.radius, b.atmo ?? b.radius) + 5 * b.radius;
    assert.ok(Math.abs(b.zoneRadius - want) < 1e-15, `${b.id}: mouth is ${b.zoneRadius}, five radii over the air is ${want}`);
    // And every harbour is inside the mouth it belongs to, or a ship undocks
    // outside its own docking range.
    if(b.dockAlt) assert.ok(b.dockAlt < b.zoneRadius, `${b.id}: the harbour at ${b.dockAlt} is outside its own mouth ${b.zoneRadius}`);
  }
  /* Nail and Whisker both have ground now, so their mouths are five radii over
     it like everybody's. The Maw is the last thing in the sky with no radius
     to take five of, and the last one you arrive at by matching speeds. */
  for(const id of ['maw']){
    assert.ok(world.get(id).zoneRadius >= 1e-3, `${id} has no ground; its mouth stays the one it was given`);
  }
  /* Seventeen: the sixteen the setting names, and the Knot, which it does
     not — a micro black hole the cats have never mentioned. It is in the sky
     for everybody; it is only on the chart for a ship that knows. */
  /* The sixteen named bodies, the one that is not, and a wreck for every
     salvage job. Counted this way rather than as a magic total, so that adding
     a derelict does not read as a broken sky. */
  const wrecks = BODIES.filter(b => b.kind === 'wreck');
  assert.equal(BODIES.length - wrecks.length, 19,
    'the sixteen named bodies, the one that is not, the Dancer and the station at it');
  assert.equal(wrecks.length, S.QUESTS.filter(q => q.type === 'salvage').length,
    'every wreck is a job and every salvage job is a wreck');
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
  /* Every harbour has a price list behind it — except a wreck, which has no
     stall, no pump, no board and nobody to talk to. Giving one an empty
     economy entry would be four empty menus pretending otherwise. */
  for(const b of BODIES){
    if(!b.port) continue;
    if(!(b.mu > 0) && b.parent) assert.ok(!PORTS[b.id], `${b.id} is weightless and should have no price list`);
    else assert.ok(PORTS[b.id], `${b.id} is a port body with no port table`);
  }
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
    /* Somebody, somewhere, has to want it, or it is a crate that cannot be
       sold — unless that is the point of it. A `noResale` good is a relic on
       its way into the bag: no stall in the sky will turn it back into money,
       which is what stops the thing you were sent for being worth more as a
       sale than as an ending. */
    if(g.noResale){
      assert.ok(!Object.keys(PORTS).some(id => S.wantsGood(id, g.id)), `${g.id} is unsellable and somebody wants it`);
      const s = S.newGame(1); s.money = 999999; s.dockedAt = g.producedAt[0];
      assert.ok(S.buy(s, g.id, 1).ok, `${g.id} cannot be bought where it is made`);
      for(const port of ['veyra', 'cinder', 'tassel', 'nail']){
        assert.equal(S.sell({ ...s, dockedAt: port }, g.id, 1).ok, false, `${g.id} sold at ${port}`);
      }
    }else{
      assert.ok(Object.keys(PORTS).some(id => S.wantsGood(id, g.id)), `${g.id} has no buyer anywhere`);
    }
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
  /* The glossary shrank from 18 to 10 when the terms stopped needing a
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
  /* Fifteen cards: four about reading the chart, ten about flying the
     errand, and one that says well done and goes away. The tenth is `slide`,
     which teaches what earlier and later do before the card that needs them —
     a playtester quit on the aiming card, and aiming was asking for a second
     control nothing had introduced. */
  assert.equal(TEXT.tutorial.length, 15);
  assert.deepEqual(TEXT.tutorial.map(t => t.step).slice(4, 8), ['mark', 'push', 'slide', 'aim'],
    'the flying half no longer goes write it down, push it out, find out what sliding does, then aim');
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
  assert.ok(QUESTS.length >= 1, 'there is an opening quest');
  for(const q of QUESTS){
    /* Three scenes, and every job has all three: the pitch on the board, what
       is said once you agree, and what happens when you hand it over. */
    assert.ok(q.id && q.title && q.giver && q.blurb && q.taken && q.done, `quest ${q.id} has its words`);
    for(const [k, floor] of [['blurb', 20], ['taken', 20], ['done', 20]]){
      assert.ok(q[k].trim().split(/\s+/).length >= floor, `quest ${q.id}: ${k} is ${q[k].trim().split(/\s+/).length} words`);
    }
    /* And `taken` is not the blurb again. The board sells it to a stranger;
       this is said to somebody who has already said yes. */
    assert.notEqual(q.taken.trim(), q.blurb.trim(), `quest ${q.id}: taken repeats the blurb`);
    assert.ok(['retrieval', 'delivery', 'shopping', 'chain', 'message', 'salvage'].includes(q.type), `quest ${q.id}: type ${q.type}`);
    /* Steps are built from the type, not written out — so what the words have
       to supply is only the wording a generator would do worse, and it has to
       line up with the steps the type actually earns. */
    const built = S.questSteps(q);
    assert.ok(built.length >= 1 && built.every(st => st.id && st.text), `quest ${q.id} builds no steps`);
    assert.ok((q.steps ?? []).length <= built.length, `quest ${q.id} writes more step text than it has steps`);
    for(const st of q.goods ?? []) assert.ok(GOODS.some(g => g.id === st.good), `quest ${q.id} wants unknown ${st.good}`);
    assert.ok(PORTS[q.from], `quest ${q.id} is offered at an unknown port ${q.from}`);
    for(const id of [q.to, ...(q.stops ?? [])]) if(id){
      /* A job can end somewhere with no price list: a wreck, or the station at
         the Dancer. The sky is the authority on those. */
      assert.ok(PORTS[id] || S.isHulk(id), `quest ${q.id} ends nowhere a ship can tie up: ${id}`);
    }
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
    /* Finishing is not being paid. The berth stays empty until somebody
       collects, which is the whole of the change. */
    assert.equal(s.crew[q.crew], null, `${q.id}: the berth filled itself without being collected`);
    assert.ok(S.claimQuest(s, q.id).ok, `${q.id} could not be collected`);
    assert.ok(s.crew[q.crew], `${q.id} collected and the ${q.crew} berth is still empty`);
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

/* ------------------------------------------------- the design tables */

const design = name => JSON.parse(readFileSync(new URL(`../tools/orbital-trader/design/${name}`, import.meta.url), 'utf8'));

/* The JSON under tools/ is what a person edits; the modules under data/ are
   what the browser loads, and a build step stands between them. Forgetting to
   run it is the one mistake that cannot be seen in a diff — the game simply
   goes on shipping last week's words. */
test('the modules the game ships say what the design tables say', () => {
  assert.deepEqual(QUESTS, design('quests.json').quests, 'data/quests.js was not rebuilt');
  assert.deepEqual(DIALOG, design('dialog.json').exchanges, 'data/dialog.js was not rebuilt');
  assert.deepEqual(TEXT.glossary, design('narrative.json').glossary, 'data/text.js was not rebuilt');
  assert.deepEqual(BODIES.map(b => b.id), design('tuning.json').bodies.map(b => b.id), 'data/world.js was not rebuilt');
});

/* Every errand in one file, in one shape. The shape is the point: a quest is a
   record with a dozen fields and rules about them, and a table of records that
   each please themselves is a table nothing can check. */
test('the quests are one table in one standard shape', () => {
  const book = design('quests.json');
  assert.ok(Array.isArray(book.notes) && book.notes.length, 'the format is not written down at the top of the file');
  for(const word of ['retrieval', 'delivery', 'shopping', 'chain', 'message']){
    assert.ok(book.notes.join('\n').includes(word), `the notes never mention ${word}`);
  }
  assert.equal(TEXT.quests, undefined, 'narrative.json is still carrying the quests around');
  /* The documented field order, which is also the order they read in: who is
     asking and what kind of job, then the places, then what it is worth, then
     the words. A record that wanders is a record somebody wrote from memory. */
  const ORDER = ['id', 'title', 'giver', 'type', 'from', 'to', 'stops', 'wreck', 'goods', 'pay', 'rep', 'crew', 'relic', 'ends', 'requires', 'blurb', 'taken', 'aboard', 'steps', 'done'];
  for(const q of book.quests){
    const keys = Object.keys(q);
    for(const k of keys) assert.ok(ORDER.includes(k), `quest ${q.id}: ${k} is not a field of the format`);
    assert.deepEqual(keys, ORDER.filter(k => keys.includes(k)), `quest ${q.id}: the fields are out of the standard order`);
  }
  assert.equal(new Set(book.quests.map(q => q.id)).size, book.quests.length, 'two quests share an id');
});

/* ------------------------------------------------------- crew dialog */

/* Pressing a face in the crew menu is the one thing in the game that changes
   nothing at all, which is exactly why it is a table: a line is written, not
   coded, and the machinery that finds the right one is twenty lines. */
test('there is something for everybody aboard to say, everywhere there is to be', () => {
  const book = design('dialog.json');
  assert.ok(Array.isArray(book.notes) && book.notes.length, 'the format is not written down at the top of the file');
  const speakers = ['captain', ...TEXT.crew.roles.map(r => r.id)];
  for(const who of speakers){
    assert.ok(DIALOG.some(x => x.at === '*' && x.who === who),
      `${who} has nothing to say away from a port`);
    for(const port of Object.keys(PORTS)){
      assert.ok(DIALOG.some(x => x.at === port && x.who === who), `${who} has nothing to say at ${port}`);
    }
  }
  for(const x of DIALOG){
    assert.ok(x.id && (x.at === '*' || PORTS[x.at]) && speakers.includes(x.who), `exchange ${x.id} is malformed`);
    assert.ok(x.lines?.length, `exchange ${x.id} says nothing`);
    for(const l of x.lines) assert.ok(speakers.includes(l.who) && l.say, `exchange ${x.id}: a line belongs to nobody`);
  }
  assert.equal(new Set(DIALOG.map(x => x.id)).size, DIALOG.length, 'two exchanges share an id');
});

test('a line is found by where the ship is and who is aboard to say it', () => {
  const s = S.newGame(1);
  assert.deepEqual(S.aboard(s), ['captain'], 'a new ship is one otter and three empty berths');
  assert.equal(S.exchangesFor(s, 'navigator').length, 0, 'an empty berth answered');

  // Out in the black there is no port to have an opinion about.
  s.dockedAt = null;
  const away = S.exchangesFor(s, 'captain');
  assert.ok(away.length && away.every(x => x.at === '*'), 'a port line came up out in the black');

  // Tied up, what is written about this port wins outright.
  s.dockedAt = 'cinder';
  const here = S.exchangesFor(s, 'captain');
  assert.ok(here.length && here.every(x => x.at === 'cinder'), 'a line about anywhere beat a line about Cinder');
  s.dockedAt = 'whisker';
  assert.ok(S.exchangesFor(s, 'captain').every(x => x.at === 'whisker'), 'the ship moved and the words did not');

  // A berth filled is a berth with a voice, and somebody to answer it.
  s.crew.navigator = { role: 'navigator', from: 'test', joinedAt: 0 };
  assert.deepEqual(S.aboard(s), ['captain', 'navigator']);
  const nav = S.exchangesFor(s, 'navigator');
  assert.ok(nav.length, 'the navigator signed on and stayed silent');
  for(const x of nav) for(const l of x.lines){
    assert.ok(S.isAboard(s, l.who), `exchange ${x.id} gives a line to ${l.who}, who is not aboard`);
  }
});

test('pressing the same face again gets the next thing, and then comes round', () => {
  const s = S.newGame(1);
  s.dockedAt = 'moss';
  const list = S.exchangesFor(s, 'captain');
  assert.ok(list.length, 'nothing to say at Moss');
  assert.equal(S.exchangeFor(s, 'captain', 0), list[0]);
  assert.equal(S.exchangeFor(s, 'captain', list.length), list[0], 'the last line is the end of the road');
  assert.equal(S.exchangeFor(s, 'captain', list.length - 1), list[list.length - 1]);
  assert.equal(S.exchangeFor(s, 'appraiser', 0), null, 'an empty berth had an opinion');
  // The label the page puts above a line comes from the crew table, by name.
  assert.equal(S.speaker('captain').name, TEXT.crew.captain.name);
  assert.equal(S.speaker('navigator').name, 'Tsuki');
});

test('the sheet handle is a handle: hittable, draggable, and it resizes', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  /* It was a 44x5 pill with nothing behind it — the shape every phone sheet
     wears to say "drag me", wired to nothing but close, and five pixels tall.
     The pill is now drawn on a strip that is a thumb high, and the strip is
     what you press. */
  assert.match(PLAY, /#grab\{[^}]*height:26px/s, 'the handle is back to being a sliver');
  assert.match(PLAY, /#grab::before\{/, 'the pill is gone');
  assert.match(PLAY, /#grab\{[^}]*touch-action:none/s,
    'without this the browser takes the swipe for scrolling or pull-to-refresh');

  /* The drag is pointer events, and there must be no click handler beside it:
     a click fires after a drag too, and the panel would shut every time it was
     resized. A press that never moved is what closes it. */
  assert.match(PLAY, /\$\('grab'\)\.addEventListener\('pointerdown'/, 'the handle does not drag');
  assert.doesNotMatch(PLAY, /\$\('grab'\)\.addEventListener\('click'/,
    'a click handler will shut the panel at the end of every resize');

  /* Three stops, and the middle one is exactly the height the sheet has always
     opened at, so nothing about opening the panel has changed. */
  assert.match(PLAY, /--sheet-h:min\(64vh, 560px\)/, 'the sheet no longer opens where it used to');
  assert.match(PLAY, /Math\.min\(innerHeight \* 0\.64, 560\)/, 'the middle stop is not the old height');
  assert.match(PLAY, /height:var\(--sheet-h\)/, 'the sheet height is not something JS can move');

  /* And the sheet owns the bottom of the screen, so the one popup that lives
     there gets out of its way rather than playing behind it. */
  assert.match(PLAY, /body\.sheet #chatter\{/, 'a conversation plays behind the sheet on a phone');
});

test('the crew menu turns a portrait into a question', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(PLAY, /class="face" data-act="say\|\$\{who\}"/, 'the portraits are not buttons');
  assert.match(PLAY, /\bsay\(who\)\{/, 'nothing is listening for a pressed face');
  assert.match(PLAY, /S\.exchangeFor\(state, who, talking\.nth\)/, 'the page never asks for the line');
  assert.match(PLAY, /S\.speaker\(l\.who\)/, 'the lines are not labelled with who said them');

  /* The answer is a popup over the sky rather than a block under the picture,
     it plays a line at a time at reading speed, and every line wears the face
     of whoever is saying it — an exchange is two people and the portraits are
     how you tell them apart without reading the names. */
  assert.match(PLAY, /id="chatter"/, 'there is nowhere for a conversation to appear');
  assert.match(PLAY, /className = 'bubble'/, 'the lines are not bubbles');
  assert.match(PLAY, /portraitURL\(l\.who\)/, 'a bubble does not carry the speaker\'s portrait');
  assert.match(PLAY, /S\.sayMs\(/, 'the lines are not paced by how long they take to read');
  assert.doesNotMatch(PLAY, /class="talk"/, 'the old inline block is still in the crew menu');

  /* A conversation is not a thing a save remembers, so the only record of one
     is a page-local variable that the next menu clears. */
  assert.match(PLAY, /if\(id !== tab\) talking = null;/, 'a line survives a change of menu');
  assert.doesNotMatch(PLAY, /state\.talking/, 'talking got into the save');
  assert.doesNotMatch(PLAY, /state\.chatter/, 'a conversation got into the save');
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

test('the road beside the ship is out of bounds by the screen, not by the clock', () => {
  /* MIN_LEAD is a minute of real time at x1, and as a rule about the clock it
     is right. As the thing a finger may not land on it is a screen distance,
     and a minute is what that is not: beside a wreck the ship covers 48 km in
     one, and the chart zoomed in far enough to fly that rendezvous is 54 km
     across — the whole visible road, out of bounds at the one zoom it mattered.
     It only showed once the chart was allowed in far enough to see a
     ten-kilometre mouth; at the old ceiling the same minute was seven pixels. */
  const pxPerDay = (kms, zoom) => S.auDay(kms) * zoom;

  // Zoomed out, the minute always wins and nothing about planning has changed.
  assert.equal(S.leadForTap(pxPerDay(7.6, 2e5)), S.MIN_LEAD, 'a wide chart lost the minute');
  assert.equal(S.leadForTap(pxPerDay(0.25, 2e7)), S.MIN_LEAD, 'the old ceiling was never the problem');
  assert.equal(S.leadForTap(0), S.MIN_LEAD, 'a ship going nowhere lost the minute');

  // Zoomed in, it is a thumb's width of screen.
  const deep = pxPerDay(0.25, 2e9);
  const lead = S.leadForTap(deep);
  assert.ok(lead < S.MIN_LEAD, 'the minute is still the whole visible road at full zoom');
  assert.ok(Math.abs(lead * deep - S.TAP_CLEAR_PX) < 1e-6, `${lead * deep} px of road is protected`);

  // And never less than the floor, however far in the chart goes.
  assert.equal(S.leadForTap(1e12), S.LEAD_FLOOR, 'a mark could be written on top of now');
  assert.ok(S.LEAD_FLOOR > 0 && S.LEAD_FLOOR < S.MIN_LEAD);
});

test('a mark may be written closer when the chart is close, and never on top of now', () => {
  const g = transferShip();
  const near = g.t + S.LEAD_FLOOR * 1.5;
  assert.equal(S.addNode(g, near), -1, 'the standard lead let a mark in under the minute');
  assert.ok(S.addNode(g, near, S.LEAD_FLOOR) >= 0, 'a close-in tap could not write its own mark');

  /* A caller may ask for less than the minute, never more — and never less
     than the floor, whatever it passes. */
  const h = transferShip();
  assert.equal(S.addNode(h, h.t + S.MIN_LEAD * 1.5, S.MIN_LEAD * 10), 0,
    'a caller talked the lead up past the minute');
  const i = transferShip();
  assert.equal(S.addNode(i, i.t + S.LEAD_FLOOR * 0.5, 0), -1, 'a caller talked the lead under the floor');
  assert.equal(S.addNode(i, i.t - 1, -99), -1, 'a mark was written into the past');
});

test('the tap on the road asks the screen, and the card writes on the same terms', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(PLAY, /S\.leadForTap\(S\.norm\(state\.ship\.v\) \* chart\.camera\.zoom\)/,
    'the tap is judged by the clock again');
  /* A tap inside the lead snaps forward to the first moment that will hold a
     mark, rather than being discarded in silence — the stretch of road a
     beginner aims at is the stretch beside their own ship, and that was the
     stretch that did nothing. The lead itself is unchanged and is still handed
     to the card, so the card cannot open on terms the write will then refuse. */
  assert.match(PLAY, /askAtPath\(Math\.max\(p\.t, state\.t \+ lead\), lead\)/,
    'a tap inside the lead is swallowed in silence again, or the card is not told what the tap was allowed under');
  /* And the mark is written at the moment the button is pressed rather than the
     moment the card went up: the clock does not stop for this card, so the
     offer can go stale while it is being read, and a stale offer used to close
     the card having done nothing. */
  assert.match(PLAY, /S\.addNode\(state, Math\.max\(t, state\.t \+ lead\), lead\)/,
    'the card opens on a tap it will then refuse to write');
});

/* ------------------------------------------- sliding a mark along its orbit */

test('a mark slides along its orbit by the step, and stops where a drag would', () => {
  const g = transferShip();
  const t0 = g.t + S.MIN_LEAD * 4;
  assert.equal(S.addNode(g, t0), 0);
  const step = S.MIN_LEAD;

  assert.equal(S.slideNode(g, 0, step), true, 'later did nothing');
  assert.ok(Math.abs(g.nodes[0].t - (t0 + step)) < 1e-12, 'later moved it somewhere else');
  assert.equal(S.slideNode(g, 0, -step), true, 'earlier did nothing');
  assert.ok(Math.abs(g.nodes[0].t - t0) < 1e-12, 'earlier and later do not undo each other');

  // Never inside the lead, however hard it is pushed.
  assert.equal(S.slideNode(g, 0, -1000), true);
  assert.ok(g.nodes[0].t >= g.t + S.MIN_LEAD - 1e-12, 'a mark was slid inside the minute');
  // And once it is against the wall, a press is honest about doing nothing.
  assert.equal(S.slideNode(g, 0, -1000), false, 'a press against the wall claimed to move it');
});

test('a sliding mark never crosses its neighbours, so a held button keeps its own mark', () => {
  const g = transferShip();
  // Two marks at once, which the lesson does not allow: it teaches one at a time.
  g.flags.tutorialSkipped = true;
  const a = g.t + S.MIN_LEAD * 4, b = g.t + S.MIN_LEAD * 8;
  assert.equal(S.addNode(g, a), 0);
  assert.equal(S.addNode(g, b), 1);

  S.slideNode(g, 0, S.MIN_LEAD * 40);
  assert.ok(g.nodes[0].t < g.nodes[1].t, 'a mark overtook the one in front of it');
  assert.deepEqual(g.nodes.map(n => n.t), [...g.nodes.map(n => n.t)].sort((x, y) => x - y),
    'the list came back out of order');
  /* The clamp is what lets the page hold an index across a press: if a mark
     cannot cross a neighbour, the sort cannot reorder the list. */
  assert.ok(Math.abs(g.nodes[1].t - b) < 1e-12, 'the mark in front was moved by its neighbour');
});

test('sliding a mark is refused where writing one is', () => {
  const g = transferShip();
  assert.equal(S.addNode(g, g.t + S.MIN_LEAD * 4), 0);
  assert.equal(S.slideNode(g, 1, S.MIN_LEAD), false, 'a mark that is not there was slid');
  assert.equal(S.slideNode(g, 0, 0), false, 'a step of nothing claimed to be a move');
  assert.equal(S.slideNode(g, 0, NaN), false, 'a step of nothing in particular was taken');
  const h = transferShip();
  assert.equal(S.addNode(h, h.t + S.MIN_LEAD * 4), 0);
  h.dockedAt = 'tassel';
  assert.equal(S.slideNode(h, 0, S.MIN_LEAD), false, 'a tied-up ship rewrote its plan');
});

test('sliding a mark has a control of its own, and the card names the ones it has', () => {
  /* The second playtester stopped on the aiming card, where the lesson asks for
     the one adjustment that had no press behind it: every other nudge in the
     game is a button you can repeat, and phasing was a pointer dragged along a
     curve.
     
     It had a pair of labelled pills on the chart for a day. They worked, and
     they were cut anyway: two of them beside every selected burn is a lot of
     furniture to carry for ever for one card of one lesson, and the chart is
     already carrying four arrows and a scrap cross. So the step lives on the
     keyboard, the pointer drags, and the card is the thing that has to say so —
     a control nobody is told about is a control nobody has. */
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  const RENDER = readFileSync(new URL('../public/orbital-trader/render.js', import.meta.url), 'utf8');

  assert.match(PLAY, /function slideBurn\(/, 'nothing steps a mark along its orbit');
  assert.match(PLAY, /S\.slideNode\(state, i, dir \* scale \* slideStep\(i\)\)/,
    'the step does not go through the rule that clamps it');
  assert.match(PLAY, /case ',': case '<':/, 'earlier has no key');
  assert.match(PLAY, /case '\.': case '>':/, 'later has no key');

  // The chart draws no buttons for it, and carries no rectangular handles.
  assert.doesNotMatch(RENDER, /SLIDE_/, 'the slide buttons are back on the chart');
  assert.doesNotMatch(RENDER, /‹ earlier|later ›/, 'the chart still draws the slide buttons');
  assert.doesNotMatch(PLAY, /function nudge\(/, 'the two-kinds-of-nudge dispatch outlived the buttons it was for');

  /* And the card has to name both ways in, or the removal costs the lesson the
     thing the buttons were bought with. */
  const slide = TEXT.tutorial.find(t => t.step === 'slide');
  assert.match(slide.body, /[Dd]rag/, 'the card does not say a mark can be dragged');
  assert.match(slide.body, /comma and full-stop/, 'the card does not name the keys');
  assert.doesNotMatch(slide.body, /button/, 'the card still points at buttons that are gone');
});

test('the aiming card is given the number it asks for, and it is the only one', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(PLAY, /function aimGauge\(\)/, 'the aiming card has no gauge');
  assert.match(PLAY, /s\.step === 'aim' \? aimGauge\(\) : null/,
    'the gauge is on every card, or on none');
  /* Two answers, because the road reaches the moon in two stages: the gap
     between the diamonds until it gets near, then closest approach. */
  assert.match(PLAY, /Closest approach to \$\{name\}/, 'the gauge cannot say how close the road gets');
  assert.match(PLAY, /orange diamonds are \$\{fmtAu\(d\)\} apart/, 'the gauge cannot say how far out of phase it is');
  // The card has to be the one that actually names them, or the gauge is orphaned.
  const aim = TEXT.tutorial.find(t => t.step === 'aim');
  assert.match(aim.body, /diamonds/, 'the aiming card does not name the instrument that answers it');
  assert.doesNotMatch(aim.body, /thirty degrees/,
    'the aiming card still asks for an angle nobody can measure');
});

test('the lesson says Slate is a moon before it asks anybody to aim at one', () => {
  /* Why Slate is somewhere else by the time you get there is the whole of the
     aiming card, and the answer is that it is going round the planet you are
     going round. The tables have known since the first one — kind, and the
     body it orbits — and no card ever said it. */
  const steps = TEXT.tutorial.map(t => t.step);
  const find = TEXT.tutorial[steps.indexOf('find')];
  const aim = TEXT.tutorial[steps.indexOf('aim')];
  assert.match(find.body, /moons?\b/, 'the card that first names Slate does not say what it is');
  assert.match(find.body, /Tassel/, 'the card does not say which world Slate goes round');
  assert.match(aim.body, /moon/, 'the aiming card does not say why the target moves');
  assert.ok(steps.indexOf('find') < steps.indexOf('aim'), 'the lesson aims before it explains');

  // And the body it names really is one, so the words and the sky agree.
  const slate = BODIES.find(b => b.id === 'slate');
  assert.equal(slate.kind, 'moon');
  assert.equal(slate.parent, 'tassel');
});

test('tapping a body says what kind of thing it is, where the data knows', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(PLAY, /function bodyIs\(id\)/, 'nothing says what a body is');
  assert.match(PLAY, /a moon of \$\{p\.name\}/, 'a moon does not name the world it goes round');
  assert.match(PLAY, /Looking at \$\{esc\(world\.get\(id\)\.name\)\}\$\{esc\(bodyIs\(id\)\)\}/,
    'looking at something does not say what it is');
  /* Only moons and worlds. A rock, a station, a wreck and the Maw are things
     the fiction introduces in its own words, and a toast calling the Maw a
     zone would be the game explaining its own table to the player. */
  const kinds = new Set(BODIES.map(b => b.kind));
  assert.ok(kinds.has('rock') && kinds.has('wreck'), 'the kinds this deliberately stays quiet about are gone');
});

/* ------------------------------------------------------------- chart */

test('the chart goes in far enough to fly the last ten kilometres', () => {
  const chart = stubChart();
  try{
    for(let i = 0; i < 400; i++) chart.zoomBy(1.5);        // wind it all the way in
    const zoom = chart.camera.zoom;
    /* The smallest harbour in the game is ten kilometres across, and coming
       alongside one is the most delicate flying there is. At the old ceiling
       that mouth was three pixels wide and the whole approach was done blind. */
    const mouth = Math.min(...BODIES.filter(b => b.port && b.zoneRadius > 0).map(b => b.zoneRadius));
    assert.ok(mouth * zoom >= 100,
      `the smallest mouth is ${(mouth * zoom).toFixed(1)} px across the radius at full zoom`);
    // And a kilometre is a thing you can see, that being the unit the last of it is flown in.
    assert.ok(zoom / KM_PER_AU >= 5, `a kilometre is ${(zoom / KM_PER_AU).toFixed(1)} px`);
  } finally { chart.restore(); }
});

test('a distance under a kilometre is metres, not nothing', () => {
  /* Whole kilometres were fine when nothing was measured closer than a harbour
     mouth thousands of kilometres wide. A ten-kilometre mouth is flown from the
     inside, and the scale bar and every readout said "0 km" for the whole of
     the last kilometre of it. */
  assert.equal(fmtAu(0.85 / KM_PER_AU), '850 m');
  assert.equal(fmtAu(0.004 / KM_PER_AU), '4 m');
  assert.equal(fmtAu(9.4 / KM_PER_AU), '9.4 km');
  assert.equal(fmtAu(50 / KM_PER_AU), '50 km');
  assert.equal(fmtAu(500 / KM_PER_AU), '500 km');
  assert.equal(fmtAu(0.5), '0.50 au');
});

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

test('waiting out the countdown actually lands on the window', () => {
  /* The promise the instrument makes: wait this many days and the crossing
     costs what the perfect one costs. Nobody had ever checked it end to end,
     and "I wait for the window and it is always wrong" turned out to be a
     clock that never stopped rather than arithmetic that was off — so this
     pins the arithmetic, and the source test below pins the clock. */
  for(const port of ['tassel', 'cinder']){
    const at = t => { const s = newDocked(4, port); s.t = t; s.keys.astrolabe = true; s.dv = s.tank = S.auDay(40); return s; };
    const now = at(120);
    for(const row of S.transferWindows(now)){
      const w = S.nextWindow(now, row.id);
      assert.ok(w, `${port} -> ${row.id}: a countdown with nothing at the end of it`);
      assert.ok(w.days >= 0 && w.days <= w.synodic + 1e-6, `${port} -> ${row.id}: ${w.days} d is not inside one turn of ${w.synodic} d`);
      const then = S.transferWindows(at(120 + w.days)).find(r => r.id === row.id);
      assert.ok(then, `${port} -> ${row.id}: the row vanished on the way`);
      assert.equal(then.band, 'perfect',
        `${port} -> ${row.id}: after waiting ${w.days.toFixed(0)} d the window reads ${then.band} (${S.fmtKms(then.cost)} against ${S.fmtKms(then.best)})`);
      assert.ok(then.cost <= row.cost + 1e-9 || row.band === 'perfect',
        `${port} -> ${row.id}: waiting for the window made the crossing dearer`);
    }
  }
});

test('a skip runs to its end at a mooring, and the window you are standing in is not a countdown', () => {
  /* The bug behind "the Astrolabe is always wrong". Its Wait-for-it button is
     on a tab you read while tied up, and the frame loop threw the skip's stop
     away on every frame it saw a docked ship — so the button set the clock to
     nine days a second and nothing ever stopped it. Ten seconds got you to the
     window; twenty put you ninety days past it, with the clock readout hidden
     because that, too, keys off the stop that had just been discarded. */
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.doesNotMatch(PLAY, /if\(state\.dockedAt\) warpTarget = null;/,
    'the loop is throwing away a skip again for no reason but a mooring');
  assert.match(PLAY, /if\(!wasDocked && state\.dockedAt\)\{ stopSkip\(\);/,
    'arriving mid-skip must still end it — a tow can dock you in the middle of one');
  assert.match(PLAY, /if\(warpTarget != null && state\.t >= warpTarget\) stopSkip\(\);/,
    'nothing stops the clock at the moment it was sent to');
  /* And the reading that made a correct instrument look broken: land on the
     window and the row said "103 d" beside PERFECT, which is when the next one
     comes round. */
  const tab = PLAY.slice(PLAY.indexOf('function astrolabeTab()'), PLAY.indexOf('const actions = {'));
  assert.match(tab, /const open = r\.band === 'perfect'/, 'an open window is not distinguished from a waited-for one');
  assert.match(tab, /open \? 'now'/, 'a window you are standing in still counts down to the next one');
  assert.match(tab, /!open && ever/, 'a window that is already open still offers to wait for it');
});

test('the Astrolabe reads every world that goes round the Lamp, and no moon', () => {
  const s = newDocked(5, 'tassel');
  const rows = S.transferWindows(s);
  const named = rows.map(r => r.id).sort();
  /* Everything on a heliocentric rail except the world you are reading from.
     A moon is reached from the world it belongs to, which is a manoeuvre and
     not a window, so none of them is on the instrument — and neither is a
     wreck, which has no cheap day to cross to because it is not on a circle. */
  const want = world.bodies.filter(b => b.parent === 'lamp' && b.kind !== 'wreck' && b.id !== 'tassel').map(b => b.id).sort();
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
  assert.equal(rows.length, world.bodies.filter(b => b.parent === 'lamp' && b.kind !== 'wreck').length,
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

test('the arrows round a mark point where the burn actually goes', () => {
  /* The chart draws a legend of four arrows round the selected mark. It has to
     be drawn in the frame the burn is flown in — forward along the velocity,
     out square across it — and it was drawn with out along the *position*
     vector instead. Those agree on a circle and nowhere else, so the legend
     showed a right angle in Tassel's docking orbit and an obviously wrong one
     the moment a ship arrived on anything eccentric.

     A source check, because the drawing needs a canvas. What it pins is that
     the directions come out of burnFrame rather than being rebuilt by hand,
     which is the only way the legend and the burn cannot drift apart again. */
  const SRC = readFileSync(new URL('../public/orbital-trader/render.js', import.meta.url), 'utf8');
  const draw = SRC.slice(SRC.indexOf('function drawNodes'), SRC.indexOf('function drawNodes') + 3000);
  assert.match(draw, /burnFrame\(where\.r, where\.v\)/, 'the mark legend does not use the burn frame');
  assert.ok(!/unit\(where\.r\)/.test(draw), 'the legend still builds an axis out of the position vector');
  assert.match(SRC, /import \{[^}]*\bburnFrame\b[^}]*\} from '\.\/orbit\.js'/, 'burnFrame is not imported');

  /* And the frame it reads really is square, at a place where position and
     velocity are nowhere near square: an eccentric orbit, which is what
     arriving in a world's gravity puts you on. */
  const b = world.get('tassel');
  const r = [b.dockAlt, 0];
  const v = [Math.sqrt(b.mu / b.dockAlt) * 0.5, Math.sqrt(b.mu / b.dockAlt) * 1.1];
  const f = O.burnFrame(r, v);
  assert.ok(Math.abs(O.dot(f.pro, f.out)) < 1e-12, 'forward and out are not square');
  assert.ok(Math.abs(O.dot(O.unit(r), O.unit(v))) > 0.2, 'this orbit is too round to prove anything');
  /* The screen flips y, which mirrors the plane. A mirror keeps angles, so
     what is square in the sky is square on the chart. */
  const flip = a => [a[0], -a[1]];
  assert.ok(Math.abs(O.dot(flip(f.pro), flip(f.out))) < 1e-12, 'the flip to screen space broke the right angle');
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
  assert.equal(fin.claimed, false, 'and is waiting to be collected, which costs no slot');
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
  assert.match(tab, /claimedAt \?\? b\.l\.doneAt/, 'the collected ones are not newest first');
  /* Three groups now, and owed-to-you leads: a reward waiting to be collected
     is the one thing in this tab a player can act on. */
  assert.ok(tab.indexOf("out += '<h3>Ready to collect</h3>'") < tab.indexOf('for(const { l, q } of live)'),
    'what is owed does not come before what is in hand');
  assert.match(tab, /x\.l\.done && !x\.l\.claimed/, 'the tab does not separate collected from merely finished');
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

  /* And the four words are the four arrows. If a label ever disagreed with
     the arrow a player just pulled, that is the same bug again. */
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  const axes = PLAY.slice(PLAY.indexOf('const AXES = {'), PLAY.indexOf('};', PLAY.indexOf('const AXES = {')));
  for(const word of ['Forward', 'Back', 'Out', 'In']) assert.ok(axes.includes(`'${word}'`), `there is no ${word} arrow`);
});

test('the ship menu is the only one flying, and nothing load-bearing went with the two that left', () => {
  /* Orbit recited an orbit the chart was already drawing; Burns listed marks
     the chart already draws and could not edit one. Both are gone. Three
     things in them were not spare, though, and losing any of them silently
     would strand somebody: what the road runs into next, the tow, and the
     distress call that is the floor under an empty tank. */
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.doesNotMatch(PLAY, /\['orbit', 'Orbit'\]|\['plan', 'Burns'\]/, 'the two tabs are still in the tab bar');
  assert.doesNotMatch(PLAY, /orbit: orbitTab|[^a-zA-Z]talk, plan,/, 'the panel still dispatches to them');
  const ship = PLAY.slice(PLAY.indexOf('function shipTab()'), PLAY.indexOf('function questsTab'));
  assert.ok(ship.includes('aheadList()'), 'Ahead has nowhere to be shown');
  assert.ok(ship.includes('strandedBlock()'), 'the tow and the distress call have nowhere to be reached');
  assert.match(PLAY, /data-act="distress"/, 'the distress call went with the tab');
  assert.match(PLAY, /data-act="tow"/, 'the tow went with the tab');
  /* And the tab the panel opens on is one that exists, tied up or adrift. */
  assert.match(PLAY, /const TABS_SHIP = \[\['ship', 'Ship'\]/, 'Ship is no longer the first tab of the ship menu');
});

test('the cost of a burn is shown against the fuel, not against the burn', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  /* The label is words, not a bare length of engine. It takes a second
     argument now — the drifting thing the axes are measured against, when
     there is one — so the guard checks the call rather than its arity. */
  assert.match(PLAY, /nodeLabel = n \? `\$\{S\.burnWords\(n\)/, 'the mark is labelled with a length of engine again');
  /* And with one thing only: a mark is an orbit everywhere now, so nothing
     hands it a drifting thing to be measured against. */
  assert.doesNotMatch(PLAY, /burnWords\(n,/, 'a mark is being labelled against a rendezvous again');
  assert.doesNotMatch(PLAY, /nodeLabel = `\$\{S\.fmtKms/, 'the old bare-magnitude label is back');
  assert.match(PLAY, /planned`/, 'the gauge does not say what the plan will spend');
  assert.match(PLAY, /id="h-dvplan"/, 'the gauge has no planned-spend segment');
  /* The Burns tab said it a third time, in a list beside the chart that drew
     the same marks. The tab is gone; the two places that are left are the
     gauge and the label on the mark itself. */
  assert.doesNotMatch(PLAY, /function plan\(\)/, 'the Burns tab is back');
  assert.doesNotMatch(PLAY, /function orbitTab\(/, 'the Orbit tab is back');
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

test('the space near a wreck says whether you are in it', () => {
  /* Crossing that line changes what the two buttons on a mark do, so it is a
     mode, and a control scheme that changes without saying so is one nobody
     trusts. The HUD names it; the chart draws the one you are actually inside
     differently from one you are merely near. */
  const ops = [];
  const chart = stubChart(800, 600, ops);
  try{
    const g = S.newGame(5);
    const pred = S.planImmediate(g);
    chart.camera.follow = 'cutterjaw';
    chart.camera.anchor = [...O.absState(world, 'cutterjaw', 0).r];
    chart.camera.zoom = 5e7;                     // the reach about 200 px across
    chart.settle();
    const view = { t: g.t, now: 0, shipAbs: { r: S.shipAbsPos(g), v: S.shipAbsVel(g) }, shipBody: 'tassel',
      prediction: pred, nodes: [], nodePositions: [], apses: [], railCrossings: [], hidden: new Set() };
    const strokes = () => ops.filter(o => o[0] === 'strokeStyle').map(o => o[1]);

    chart.draw(view);
    assert.ok(strokes().includes(PALETTE.driftEdge), 'the reach is not drawn at all');
    assert.ok(!strokes().includes(PALETTE.driftEdgeIn), 'a reach nobody is in reads as one they are');

    ops.length = 0;
    chart.draw({ ...view, rendezvous: 'cutterjaw' });
    assert.ok(strokes().includes(PALETTE.driftEdgeIn), 'the reach the ship is in looks the same as one it is not');

    /* And an unfound wreck draws neither, whichever the ship is in. */
    ops.length = 0;
    chart.draw({ ...view, rendezvous: 'cutterjaw', hidden: new Set(['cutterjaw']) });
    assert.ok(!strokes().includes(PALETTE.driftEdge) && !strokes().includes(PALETTE.driftEdgeIn),
      'a wreck nobody has heard of drew its reach');
  } finally { chart.restore(); }
});

test('zooming in does not take the orange pair away with the rail', () => {
  /* `drawOrbits` culls a rail at both ends, and a crossing used to be drawn
     only on a rail that survived. Under six pixels across that is right — a
     pair of diamonds on a dot says nothing. Over six screen diagonals it is
     not a rail nobody can see, it is the rail you are standing on, and it is
     culled at exactly the zoom the run to it is flown at. */
  const ops = [];
  const chart = stubChart(800, 600, ops);
  try{
    const g = salvor();
    g.quests = [{ id: S.QUESTS.find(q => q.wreck === 'tinwhistle').id, step: 0, done: false, takenAt: 0 }];
    g.dockedAt = null; g.justLeft = null; g.t = 0;
    const start = O.absState(world, 'tassel', 0);
    const mu = world.get('lamp').mu, r1 = O.norm(start.r), r2 = world.get('tinwhistle').a;
    const vc = Math.sqrt(mu / r1);
    g.ship = { body: 'lamp', r: [...start.r],
      v: O.scale(O.unit(start.v), vc * Math.sqrt(2 * r2 / (r1 + r2))) };
    const pred = S.planImmediate(g);
    const crossings = railCrossings(world, pred, 0, { minLead: S.MIN_LEAD });
    assert.ok(crossings.some(c => c.body === 'tinwhistle'), 'the road does not reach the wreck\'s rail at all');
    const view = { t: 0, now: 0, shipAbs: { r: S.shipAbsPos(g), v: S.shipAbsVel(g) }, shipBody: 'lamp',
      prediction: pred, nodes: [], nodePositions: [], apses: [], railCrossings: crossings,
      hidden: S.unseen(g) };
    const at = zoom => {
      chart.camera.zoom = zoom;
      chart.camera.anchor = [...S.shipAbsPos(g)];
      chart.settle();
      ops.length = 0;
      chart.draw(view);
      return {
        rail: chart.hits.rails.some(r => r.id === 'tinwhistle'),
        orange: ops.some(o => o[0] === 'strokeStyle' && o[1] === PALETTE.railCross),
      };
    };

    const wide = at(8e3);
    assert.ok(wide.rail && wide.orange, 'the pair is not drawn even with the rail on the screen');

    /* And in, past the zoom that culls the rail for running off both edges.
       The marks are still on the screen; it was only the rail that left. */
    const close = at(3e4);
    assert.ok(!close.rail, 'the rail is still drawn at this zoom — the test has stopped testing anything');
    assert.ok(close.orange, 'zooming in took the orange pair away with the rail');
  } finally { chart.restore(); }
});

test('zooming out past a rail still takes its crossing with it', () => {
  /* The other end of the same cull, which was doing its job: a whole orbit
     three pixels across is a dot, and a pair of diamonds on a dot is two marks
     with nothing to be against. */
  const ops = [];
  const chart = stubChart(800, 600, ops);
  try{
    const g = transferShip();
    const pred = S.planImmediate(g);
    const crossings = railCrossings(world, pred, 0, { minLead: S.MIN_LEAD });
    assert.ok(crossings.some(c => c.body === 'veyra'), 'the fall to Veyra does not cut Veyra\'s rail');
    chart.camera.zoom = 10;              // Veyra's whole orbit about one pixel across
    chart.camera.anchor = [0, 0];
    chart.settle();
    for(const c of crossings){
      assert.ok(world.get(c.body).a * chart.camera.zoom < 6,
        `${c.body}'s rail is big enough to draw after all`);
    }
    chart.draw({ t: 0, now: 0, shipAbs: { r: S.shipAbsPos(g), v: S.shipAbsVel(g) }, shipBody: 'lamp',
      prediction: pred, nodes: [], nodePositions: [], apses: [], railCrossings: crossings,
      hidden: new Set() });
    assert.ok(!ops.some(o => o[0] === 'strokeStyle' && o[1] === PALETTE.railCross),
      'a crossing was drawn on a rail too small to be a shape');
  } finally { chart.restore(); }
});

test('the mode is announced with or without a navigator, and the numbers are hers', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(PLAY, /<small>Zero-g docking<\/small>/, 'the mode is not named anywhere');
  /* It used to hide the whole readout without her. The axes turn either way —
     that is the sky, not the crew — so the mode shows and the numbers do not. */
  assert.match(PLAY, /if\(!rv\)\{ box\.hidden = true; return; \}/,
    'the mode is hidden again when nobody can read the numbers');
  assert.match(PLAY, /'by eye'/, 'there is nothing to say when she is not aboard');
  assert.doesNotMatch(PLAY, /if\(!rv \|\| !rv\.instruments\)\{ box\.hidden = true/,
    'the old rule is back');
  // And the chart is told which one the ship is in.
  assert.match(PLAY, /rendezvous: S\.rendezvous\(state\)\?\.target \?\? null/,
    'the chart is not told which reach the ship is in');
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

test('every world the road reaches is marked, and each of them once', () => {
  /* It used to be one mark for the whole road, on the reasoning that a long
     ellipse cuts five rails going out and the same five coming back and ten
     pairs of diamonds is unreadable. The reasoning was about the doubles and
     the answer punished the wrong thing: flying Tassel to Grumm, the single
     mark you got was where you cut the rail of Slate — a moon of the world you
     had just left, six days into a seventy-day trip — and every other world the
     road met, including all four moons of the one you were going to, went
     unmarked. Worse, that one mark sits on a rail that is rarely on screen, so
     the honest answer to "what did a player actually see" was nothing at all. */
  const g = transferShip();
  const pred = S.planImmediate(g);
  const shown = railCrossings(world, pred, g.t, { minLead: S.MIN_LEAD });
  assert.ok(shown.length > 1, 'still only marking one of them');
  assert.deepEqual(shown, [...shown].sort((a, b) => a.t - b.t), 'not in the order they happen');

  /* One per world: the doubles are what the cap is for now. */
  const bodies = shown.map(c => c.body);
  assert.equal(new Set(bodies).size, bodies.length, `a world is marked twice: ${bodies.join(', ')}`);

  /* A long ellipse right out past the Belt — the busy case, where the same
     rails are cut twice each and one mark apiece is the whole point. */
  const wide = transferShip('tassel', world.get('grumm').a * 0.68);
  wide.ship.v = O.scale(O.unit(wide.ship.v), O.norm(wide.ship.v) * 1.28);
  const wpred = S.planImmediate(wide);
  const raw = railCrossings(world, wpred, wide.t, { minLead: S.MIN_LEAD, limit: 64 });
  const once = railCrossings(world, wpred, wide.t, { minLead: S.MIN_LEAD });
  assert.ok(raw.length >= 4, `the busy case needs to be busy; found ${raw.length}`);
  assert.equal(new Set(once.map(c => c.body)).size, once.length, 'the busy case marks a world twice');
  assert.ok(once.length <= raw.length, 'one per world should never be more than the lot');
  // Each kept one is the soonest of its world's.
  for(const c of once){
    const soonest = Math.min(...raw.filter(o => o.body === c.body).map(o => o.t));
    assert.ok(Math.abs(c.t - soonest) < 1e-9, `${c.body}: kept a later crossing than its first`);
  }

  /* A caller may still ask for fewer, which is what the encounter list does. */
  assert.equal(railCrossings(world, pred, g.t, { minLead: S.MIN_LEAD, limit: 1 }).length, 1);
});

test('a road past a dozen worlds wears one crosshair at most, and only for an arrival', () => {
  /* The chart used to sweep every world in the sky at every sample of the
     drawn road and mark any the road happened to pass near. It cost a quarter
     of every road solved, and what it mostly produced was a crosshair sitting
     on a parking orbit reporting how far below the planet was. What a pilot
     steers an approach by is where a world will be when the road cuts its
     rail — which the chart draws separately — and what the road does once it
     arrives, which is the one mark left here. */
  const s = S.newGame(7);
  s.dockedAt = 'tassel'; S.undock(s);
  s.dv = s.tank = S.auDay(60);
  assert.ok(S.trimToTarget(s, 'nail', 6000)?.ok, 'could not plot the road this test is about');
  const pred = S.planImmediate(s, true, { farSight: true });
  const ids = (pred.intercepts ?? []).map(ic => ic.body);
  assert.ok(ids.length <= 1, `a road out of Tassel wears ${ids.length} crosshairs: ${ids.join(', ')}`);
  assert.ok(!(pred.intercepts ?? []).some(ic => ic.passing), 'a sampled close pass is marked again');
  assert.equal(pred.intercept, pred.intercepts[0] ?? null);
});

test('a road through two reaches is marked at both of them', () => {
  /* The ordinary way to arrive anywhere in the Grumm system: fall into Grumm,
     and go on from there to one of its moons. The road holds both passes and
     both are real — the pass at Grumm is the one being flown right now, and the
     pass at the moon is the one being aimed at. Only one used to be marked, and
     which one fell out of an index rather than out of the road: this case
     marked Grumm and left the moon, the thing the burn was for, with nothing. */
  const s = S.newGame(7);
  s.dockedAt = 'tassel'; S.undock(s);
  s.dv = s.tank = S.auDay(400);
  assert.ok(S.trimToTarget(s, 'grumm', 20000)?.ok, 'could not plot the road this test is about');
  let guard = 0;
  while(s.ship.body !== 'grumm' && guard++ < 4000) S.tick(s, 0.5);
  assert.equal(s.ship.body, 'grumm', 'never got to Grumm');

  s.nodes = [];
  assert.ok(S.trimToTarget(s, 'haven', 400)?.ok, 'could not aim at the moon from inside the reach');
  const pred = S.planImmediate(s, true, { farSight: true });
  const ids = (pred.intercepts ?? []).map(ic => ic.body);
  assert.deepEqual(ids, ['grumm', 'haven'], `the road passes through two reaches and marks ${ids.join(', ') || 'none'}`);
  /* Earliest first, and `intercept` is still the next one. */
  assert.ok(pred.intercepts[0].t < pred.intercepts[1].t, 'they are not in the order they happen');
  assert.equal(pred.intercept, pred.intercepts[0]);
  for(const ic of pred.intercepts) assert.ok(!ic.passing, 'a sampled close pass came back');
});

test('a navigator does not take the crosshair away', () => {
  /* She is the reason the road is drawn as far as the second door at all, and
     that is what broke it: Tassel to Slate is `enter` then `exit`, the trim
     landed on the exit, an exit is not an encounter — and the mark on the
     opening quest of the game vanished for having a better crew. Whatever
     else she changes about the road, the passes along it are the same passes. */
  const road = far => {
    const s = S.newGame(7);
    s.dockedAt = 'tassel'; S.undock(s);
    s.dv = s.tank = S.auDay(60);
    assert.ok(S.trimToTarget(s, 'slate', 6000)?.ok);
    return (S.planImmediate(s, true, { farSight: far }).intercepts ?? []).map(ic => ic.body);
  };
  assert.deepEqual(road(false), ['slate'], 'the road to Slate is not marked at Slate');
  assert.deepEqual(road(true), ['slate'], 'a navigator aboard lost the mark at Slate');
});

test('the world you are leaving is not an encounter with anything', () => {
  /* A parking orbit reaches its low point once a lap, which is a real local
     minimum and completely uninteresting: it is where you already are. Cast
     off and the world you just left would mark itself, at nought days, under
     the ship. And a ship going round in circles meets nothing at all. */
  const idle = S.newGame(7);
  S.undock(idle);
  const pred = S.planImmediate(idle, true, { farSight: true });
  assert.deepEqual(pred.intercepts ?? [], [], 'a parking orbit was called an encounter');

  const s = S.newGame(7);
  s.dockedAt = 'cinder'; S.undock(s);
  s.dv = s.tank = S.auDay(60);
  assert.ok(S.trimToTarget(s, 'veyra', 4000)?.ok);
  const leaving = S.planImmediate(s, true, { farSight: true });
  const own = (leaving.intercepts ?? []).find(ic => ic.body === 'cinder');
  assert.ok(!own, `the world being left marked itself ${own ? 'at ' + (own.t - s.t).toFixed(2) + ' d' : ''}`);
  // The world actually being flown to is still marked, with its exact numbers.
  const veyra = (leaving.intercepts ?? []).find(ic => ic.body === 'veyra');
  assert.ok(veyra, 'the destination is not marked');
  assert.ok(!veyra.passing, 'an encounter inside a reach should carry the solved periapsis, not a sampled pass');
});

test('the space near a drifting thing is a place you can see', () => {
  /* A wreck's reach does everything a sphere of influence does to the flying —
     cross it and the two buttons on a mark stop being about an orbit and start
     being about the thing you are coming alongside, and the corner of the HUD
     turns into range and closing speed — and it was drawing nothing at all. The
     only way to find out where it was was to be inside it and notice the words
     had changed. */
  const src = readFileSync(new URL('../public/orbital-trader/render.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function drawDriftReaches'), src.indexOf('function drawSoiRings'));
  assert.ok(fn.length > 200, 'found the drawing pass');
  assert.match(src, /drawDriftReaches\(chart, pos/, 'nothing calls it');
  assert.match(fn, /b\.driftReach > 0/, 'it is not keyed on the reach');
  assert.match(fn, /chart\.hidden\.has\(b\.id\)/, 'an unfound wreck puts its reach on the chart');
  assert.match(fn, /setLineDash/, 'a reach is dashed, like every other reach on this chart');
  assert.match(src, /driftEdge/, 'it is drawn in the harbour mouth\'s colours');

  /* And the promise the drawing makes: the mouth is inside the reach at every
     one of them, so a ship is always in the space — axes turned, numbers up —
     a good while before it may tie up. `check-tuning` says the same thing to
     the design table; this says it to the game that ships. */
  for(const b of BODIES.filter(x => x.port && !(x.mu > 0) && x.parent)){
    assert.ok(b.driftReach > 0, `${b.id} has no reach to draw`);
    assert.ok(b.driftReach > b.zoneRadius,
      `${b.id}: you could tie up at ${b.zoneRadius} without ever entering ${b.driftReach}`);
  }
});

test('nothing is drawn joining the pair', () => {
  /* A dashed line between the two marks was the obvious thing to draw and the
     wrong one: a straight line across a chart of curves reads as a path you
     could fly. Checked at the source, because a line nobody can see in a
     screenshot is exactly the kind of thing that comes back. */
  const src = readFileSync(new URL('../public/orbital-trader/render.js', import.meta.url), 'utf8');
  /* Bounded by the next function rather than by the comment above it: the
     comment was reworded once and this slice quietly grew to cover the
     intercept drawing, whose crosshairs are made of lineTo. */
  const fn = src.slice(src.indexOf('function drawRailCrossings'), src.indexOf('function drawIntercepts'));
  assert.ok(fn.length > 200, 'found the drawing pass');
  /* `diamond` is a helper outside this function, so a lineTo in here is
     something else being drawn — which is the thing that was removed. */
  assert.doesNotMatch(fn, /setLineDash|lineTo/, 'something is drawing a line between the diamonds again');
  assert.doesNotMatch(src, /railTie/, 'the tie colour is still in the palette');
});

test('the world you are aiming at is marked the moment your road reaches its orbit', () => {
  /* This is what the pair of diamonds is *for*: where the road cuts a world's
     rail, and where that world will be when it does. Pushing a burn out of
     Tassel towards Grumm, the mark has to appear as soon as the road reaches
     Grumm's orbit — not at the last second, and not only once the intercept is
     already solved.

     Note what happens *after* it is solved: a road that actually hits Grumm
     ends inside its reach, a tenth of an au short of its rail, so there is no
     crossing left to mark and the encounter marks and the arrival take over.
     The diamonds are the aiming tool, and they are there for the aiming. */
  const grumm = world.get('grumm');
  const reach = kick => {
    const s = S.newGame(7);
    s.dockedAt = 'tassel'; S.undock(s); s.dv = s.tank = S.auDay(400);
    const ix = S.addNode(s, s.t + 0.02);
    s.nodes[ix].prograde = S.auDay(kick);
    const pred = S.planImmediate(s, true, { farSight: false });
    const far = Math.max(0, ...pred.segments
      .filter(sg => sg.body === 'lamp' && sg.points).flatMap(sg => sg.points.map(O.norm)));
    const marks = railCrossings(world, pred, s.t, { minLead: S.MIN_LEAD });
    return { far, grumm: marks.some(c => c.body === 'grumm') };
  };
  const short = reach(8), over = reach(9);
  assert.ok(short.far < grumm.a, `an 8 km/s burn should fall short; reached ${short.far.toFixed(3)} au`);
  assert.ok(over.far > grumm.a, `a 9 km/s burn should reach past; reached ${over.far.toFixed(3)} au`);
  assert.equal(short.grumm, false, 'a road that never reaches Grumm marked its rail anyway');
  assert.ok(over.grumm, 'a road out past Grumm did not mark where it cuts its orbit');

  /* And with nobody special aboard: seeing where a world will be is the
     chart's arithmetic, not a thing a crew member unlocks. */
  assert.ok(reach(11).grumm, 'the mark needs a navigator');
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

test('the chart paints fewer pixels while the view is moving', () => {
  /* The chart repaints the whole sky every frame and nothing about that is
     cached, which is fine — but it means the cost is very nearly linear in the
     size of the backing store. Measured on a 1600x1000 window: a pan costs
     13 ms at one device pixel per point, 25 at one and a half, 37 at two. A
     retina screen asks for the last of those, so dragging the chart ran at
     twenty-seven frames a second and visibly stuttered. Half resolution while
     a gesture is in flight takes it to 12, and pixel art sliding under a
     finger does not show the difference. */
  const R = readFileSync(new URL('../public/orbital-trader/render.js', import.meta.url), 'utf8');
  assert.match(R, /chart\.stir = \(\) =>/, 'nothing can say the view is moving');
  assert.match(R, /chart\.syncDpr = /, 'nothing sets the resolution for the frame');
  assert.match(R, /Math\.max\(1, fullDpr\(\) \/ 2\)/, 'a moving chart no longer drops resolution — or drops below one device pixel');
  /* Both hand gestures, and only those: the clock moving the ship must not
     blur the chart, because the chart is locked to the ship and the sky under
     it barely stirs. */
  const pan = R.slice(R.indexOf('chart.panBy = '), R.indexOf('chart.zoomBy = '));
  assert.ok(pan.includes('chart.stir()'), 'panning does not lower the resolution');
  const zoom = R.slice(R.indexOf('chart.zoomBy = '), R.indexOf('chart.focus'));
  assert.ok(zoom.includes('chart.stir()'), 'zooming does not lower the resolution');
  /* And the switch lands between frames. Resizing a canvas throws away what is
     on it and resets the context, so doing it part-way through a draw would
     paint half a sky. */
  const drawFn = R.slice(R.indexOf('function draw(chart, view){'));
  const syncAt = drawFn.indexOf('chart.syncDpr(');
  const firstPaint = drawFn.indexOf('ctx.fillRect(0, 0, W, H)');
  assert.ok(syncAt > 0 && syncAt < firstPaint, 'the resolution is set after the frame has started painting');
});

test('the page wires the rail gesture and the marks to the chart', () => {
  /* Both halves of this live in play.html, which Node cannot run. The wiring
     is what breaks silently: a solver nobody calls draws nothing, and a
     gesture nobody listens for is a dead patch of sky. */
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(PLAY, /chart\.nearestRailPoint\(/, 'nothing listens for a tap on a rail');
  assert.match(PLAY, /askSkip\(rail\.t/, 'and a tap on one does not reach the clock');
  /* This used to be refused at a mooring, to work around a loop that threw a
     skip's stop away whenever it saw a docked ship. The loop is fixed, so the
     gesture is not conditional any more: waiting at a dock for a world to come
     round is exactly what a pilot does at one, and it is the same wait the
     Astrolabe's own button asks for. */
  assert.doesNotMatch(PLAY, /state\.dockedAt \? null : chart\.nearestRailPoint\(/, 'the rail gesture is being refused at a mooring again');
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
  /* A rendezvous has no parking orbit to be put in, whatever it weighs: you sit
     beside it, in its parent's frame, moving with it. */
  if(b.mu > 0 && !b.rendezvous){
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
  /* The opening orbit is the low one, measured by its semi-major axis: a
     parking orbit is a hair off a circle on purpose — see PARK_E — so the
     radius the game is asked for is the average one and not every one. */
  const opening = O.elementsFromState(b.mu, s.ship.r, s.ship.v);
  assert.ok(Math.abs(opening.a - b.startAlt) < b.startAlt * 1e-9, 'in the low orbit the game opens in');
  assert.ok(Math.abs(O.norm(s.ship.r) - b.startAlt) < b.startAlt * 1e-3, 'and within a whisker of its altitude');
  assert.ok(Math.abs(O.norm(s.ship.v) - Math.sqrt(b.mu / b.startAlt)) < Math.sqrt(b.mu / b.startAlt) * 1e-3, 'and going round it');
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

test('the game opens in a low orbit, clear of the air, and a lap of it is about eleven real minutes', () => {
  const s = S.newGame(5);
  const b = world.get('tassel');
  const el = O.elementsFromState(b.mu, s.ship.r, s.ship.v);
  assert.ok(el.e > 0 && el.e < 1e-3 && el.dir > 0, 'a prograde near-circle, so the first burn points the right way');

  /* Low means what a pilot means by it and not what a chart does: the high
     point of the orbit is an altitude over the ground, and it sits under one
     planet-diameter of it — close enough in that the ocean fills the chart. */
  const apoapsisAltitude = el.ra - b.radius;
  assert.ok(apoapsisAltitude > 0, 'and above the ocean, not through it');
  assert.ok(apoapsisAltitude < 2 * b.radius, `apoapsis altitude ${apoapsisAltitude} is not below the diameter ${2 * b.radius}`);
  assert.ok(el.ra < world.get('tassel').zoneRadius, 'inside the harbour mouth, so Tassel can still be tied up at');
  assert.ok(el.ra < b.dockAlt, 'and below the harbour, which is where undocking puts you');

  /* But clear of it, which is the other half of "low". The opening orbit used
     to sit a hundred kilometres up with only thirty of those above the air,
     and the chart opened on a ship apparently touching the ocean. A hundred
     and fifty leaves daylight between the two. */
  const km = au => au * KM_PER_AU;          // the game's own scale, which the sky was authored at
  assert.ok(km(el.rp - b.radius) > 140, `the low point is only ${km(el.rp - b.radius).toFixed(0)} km up`);
  assert.ok(km(el.rp - b.atmo) > 70, `the low point is only ${km(el.rp - b.atmo).toFixed(0)} km above the air`);

  /* The clock has exactly one job: at ×1, a lap of this orbit is the fastest
     thing in the sky, and everything else is slower still. It was tuned to ten
     real minutes when the orbit was a hundred kilometres up; raising it to a
     hundred and fifty stretched the lap rather than the clock, because the
     clock is what every *other* body's speed is read against and speeding it
     up to keep a round number would have set the whole sky moving faster. */
  const lapSeconds = el.period / S.dtForFrame(s, 1);
  assert.ok(Math.abs(lapSeconds - 677) < 2, `a lap takes ${lapSeconds.toFixed(2)} real seconds, not about 677`);

  /* And flying it for those eleven minutes really does come back round. The
     lap is no longer a whole number of seconds, so the last frame is a short
     one — a run of 673 one-second frames stops three tenths of a second shy
     of the lap, which is two kilometres of ocean at this speed. */
  const r0 = [...s.ship.r];
  for(let left = lapSeconds; left > 0; left -= 1) S.tick(s, S.dtForFrame(s, Math.min(1, left)));
  assert.ok(O.dist(s.ship.r, r0) < el.ra * 1e-6, 'one lap of ×1 is back where it started');
});

test('a skip ends the same distance from the thing it was sent to, whatever the trip', () => {
  /* The run-in is flown at ×1, so the only honest unit for it is real seconds
     of watching. It used to be two per cent of the trip capped at a fiftieth of
     a day, which is neither: a fiftieth of a day is nine real minutes of ×1, so
     a one-day skip handed back nine minutes of staring at nothing. And past
     about ten days the margin stopped meaning anything, because a frame of a
     skip is a six-hundredth of the trip and by then one frame was longer than
     the whole margin — measured, a twenty-day skip and a three-hundred-day skip
     both landed *past* the moment they were sent to. */
  const B = CONST.BASE_RATE_DAYS_PER_SEC;
  const coaster = () => {
    const g = S.newGame(5);
    g.dockedAt = null; g.justLeft = null; g.justLeftAt = -1e9; g.t = 0; g.nodes = [];
    const start = O.absState(world, 'tassel', 0);
    const mu = world.get('lamp').mu;
    g.ship = { body: 'lamp', r: [...start.r],
      v: O.scale(O.unit(start.v), Math.sqrt(mu / O.norm(start.r)) * 1.02) };
    return g;
  };
  for(const days of [0.05, 0.2, 1, 5, 20, 70, 300]){
    const g = coaster();
    const target = g.t + days;
    const plan = S.skipPlan(g, target);
    g.warp = plan.rate;
    /* The loop the browser runs, at sixty frames a second. */
    let frames = 0;
    while(g.t < plan.stopAt && frames++ < 2e5){
      const dt = S.dtForFrame(g, 1 / 60, plan.stopAt);
      if(dt <= 0) break;
      S.tick(g, dt);
    }
    const short = target - g.t;
    assert.ok(short > 0, `a ${days}-day skip landed past the moment it was sent to`);
    assert.ok(Math.abs(short - S.MIN_LEAD) < 1e-9,
      `a ${days}-day skip left ${(short / B).toFixed(0)} real seconds of ×1, not the ${(S.MIN_LEAD / B).toFixed(0)} every other one leaves`);
  }

  /* Except a skip too short to spare it, which still has to go somewhere. */
  const tiny = coaster();
  const plan = S.skipPlan(tiny, tiny.t + S.MIN_LEAD * 2);
  assert.ok(plan.stopAt > tiny.t, 'a very short skip has nowhere to go');
  assert.ok(plan.stopAt < tiny.t + S.MIN_LEAD * 2, 'and it does not land on top of the thing');
});

test('skipping to a burn lands a lead short of the burn, not half an hour short', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  /* It used to ask to be sent to a twentieth of a day before the burn, on top
     of the margin the skip already leaves. A twentieth of a day is twenty-two
     real minutes of ×1, so pressing "Skip to it" on a burn gave back half an
     hour of staring — and the card, which reads the plan, understated the wait
     by all of it. */
  assert.match(PLAY, /warpnode\(i\)\{ const n = state\.nodes\[Number\(i\)\]; if\(n\) askSkip\(n\.t,/,
    'the burn skip still cuts its own lead');
  assert.doesNotMatch(PLAY, /askSkip\(n\.t - 0\.05/, 'the old hand-cut lead is back');
});

test('a frame of a skip never steps past the end of it', () => {
  /* The guarantee the above rests on. A frame of a long skip is hours of game
     time; the step is cut to what is left. */
  const g = S.newGame(5); S.undock(g); g.warp = 5e4;
  const until = g.t + 0.01;
  const full = S.dtForFrame(g, 1 / 60);
  assert.ok(full > 0.01, 'this frame is too small for the test to mean anything');
  assert.equal(S.dtForFrame(g, 1 / 60, until), until - g.t, 'the last step was not cut to fit');
  g.t = until;
  assert.equal(S.dtForFrame(g, 1 / 60, until), 0, 'a step was offered past the end');
  assert.equal(S.dtForFrame(g, 1 / 60, null), full, 'a frame with no end to reach was cut anyway');
});

test('the loop hands the skip\'s end to the clock, and skips to where the plan says', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(PLAY, /S\.dtForFrame\(state, real, warpTarget\)/,
    'the frame steps without knowing where the skip ends');
  assert.match(PLAY, /warpTarget = plan\.stopAt;/,
    'the stopping point is worked out somewhere other than the plan');
});

test('undocking puts the ship in a prograde parking orbit at the docking altitude', () => {
  /* Casting off is not the same frame as a new game: the opening orbit is low
     and the harbour's is not, so this ties up first and then lets go. */
  const s = undockedAt(3);
  assert.equal(s.dockedAt, null);
  const b = world.get('tassel');
  const el = O.elementsFromState(b.mu, s.ship.r, s.ship.v);
  assert.ok(Math.abs(el.a - b.dockAlt) < b.dockAlt * 1e-9, 'at the harbour altitude, on average');
  assert.ok(el.e > 0 && el.e < 1e-3 && el.dir > 0, 'prograde, and a hair off a circle');
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
  assert.deepEqual(kinds(S.questById('catsrequest')), ['handover'], 'the cat\'s request is a message now, not a tour');

  /* Chain is the one shape the catalogue no longer uses: Ashgrin's three-haven
     tour became a hop next door so the navigator's berth fills early enough to
     be worth having. The machinery is still here and still works, so it is
     still checked — against a made-up job, which is the honest way to say that
     nothing in the game is currently shaped like this. */
  const tour = { id: 'x', type: 'chain', from: 'nail', to: 'nail', stops: ['nail', 'whisker', 'arc'], goods: [] };
  assert.deepEqual(kinds(tour), ['visit', 'visit', 'visit', 'handover'], 'chain: one step per stop');
  assert.deepEqual(S.questSteps(tour).map(st => st.text),
    ['Call at Nail', 'Call at Whisker', 'Call at The Arc', 'Report to Nail']);
  assert.equal(S.questTarget(tour), 'nail', 'a chain points at its first stop');

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
  /* Salvage is here now, and it is the one kind that *requires* a berth
     filled: nothing holds a ship beside a wreck, so coming alongside one takes
     the cat navigator. Everything else is flyable with empty berths. */
  for(const q of S.QUESTS){
    assert.ok(['retrieval', 'delivery', 'shopping', 'message', 'chain', 'salvage'].includes(q.type), `${q.id}: ${q.type}`);
    /* `requires` was a reserved name with nothing behind it for a long time.
       It has two forms now and both are checkable, so what this asserts is that
       a job never asks for something the gate cannot answer. */
    for(const k of Object.keys(q.requires ?? {})){
      assert.ok(['questsFor', 'relics', 'hidden'].includes(k), `${q.id} requires ${k}, which nothing reads`);
    }
    for(const people of Object.keys(q.requires?.questsFor ?? {})){
      assert.ok(['emberkin', 'otter', 'cat', 'frog'].includes(people), `${q.id} requires jobs for nobody: ${people}`);
    }
    for(const id of q.requires?.relics ?? []) assert.ok(S.relicById(id), `${q.id} requires an unknown relic ${id}`);
    if(q.relic) assert.ok(S.relicById(q.relic), `${q.id} grants an unknown relic ${q.relic}`);
    // Every job says where it is offered, so a board will know what to put up.
    assert.ok(PORTS[q.from], `${q.id} does not say where it is given out`);
    for(const g of q.goods ?? []){
      const good = S.goodById(g.good);
      // A retrieval you cannot buy anywhere is a quest nobody can finish.
      if(q.type !== 'delivery') assert.ok(good.producedAt.length, `${q.id}: nobody makes ${g.good}`);
      if(q.type === 'retrieval') assert.ok(good.producedAt.includes(q.from), `${q.id}: ${q.from} does not sell ${g.good}`);
    }
    /* A salvage pays for the whole trip, because the haul is somebody else's:
       it rides as a consignment and cannot be sold, so the fee is the reward
       and it had better beat what the crates would have fetched. */
    if(q.type === 'salvage'){
      const s = S.newGame(5);
      const market = (q.goods ?? []).reduce((n, g) => n + S.sellPrice(s, q.to, g.good) * g.qty, 0);
      assert.ok(q.pay > market, `${q.id} pays ${q.pay} for a haul worth ${market} at ${q.to}`);
    }
    /* A job whose reward is a thing rather than a fee is allowed to cost more
       than it pays: the three at the end of the line are bought, salvaged and
       given, and the one you buy costs a year of trading on purpose. What it
       may never be is *sellable* — that would make the ending a commodity. */
    if(q.relic){
      /* Precisely: what a relic job sends you to *buy* must not be sellable, or
         the ending is a commodity you can churn. What it sends you to salvage
         is the haul and is meant to be sold — that is how a salvor is paid. */
      for(const st of S.questSteps(q)){
        if(st.kind !== 'acquire') continue;
        assert.ok(S.goodById(st.good).noResale, `${q.id}: ${st.good} is bought for a relic and can be sold back`);
      }
    }
    // A job has to be worth more than selling what it asks you to fetch.
    if(!q.relic && (q.type === 'retrieval' || q.type === 'shopping')){
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
    // The one berth a job can require: nothing holds a ship beside a wreck.
    if(q.type === 'salvage') s.crew.navigator = { role: 'navigator', from: 'test', joinedAt: 0 };
    s.quests = [];                              // one job at a time, to keep the three free
    /* And whatever else the job is gated on. The closing line asks for jobs
       already done for a people, and for relics already in the bag; both are
       states a player reaches by playing, and this is the shortest way to
       stand where they would be standing. */
    for(const [people, n] of Object.entries(q.requires?.questsFor ?? {})){
      const forThem = S.QUESTS.filter(x => x.rep === people && x.id !== q.id).slice(0, n);
      assert.equal(forThem.length, n, `${q.id} wants ${n} jobs for the ${people} and there are ${forThem.length}`);
      for(const x of forThem) s.quests.push({ id: x.id, step: 99, done: true, claimed: true, doneAt: 0, claimedAt: 0 });
    }
    for(const id of q.requires?.relics ?? []) s.relics[id] = { from: 'test', foundAt: 0 };
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
    /* Finishing hands nothing over; collecting does. Both are checked, because
       a job that cannot be collected is as broken as one that cannot be flown. */
    assert.ok(S.claimQuest(s, q.id).ok, `${q.id} finished and could not be collected`);
    /* Money out has to beat money in — except where the job pays in a thing,
       which is the whole point of the closing line. */
    if(!q.relic && !q.ends) assert.ok(s.money > purse, `${q.id} cost more to finish than it paid`);
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
  /* Handed over is not paid for: the purse and the standing wait for a hand
     on the Collect button. */
  assert.equal(d.money - paid, 0, 'arriving paid the purse by itself');
  assert.equal(d.rep.emberkin, 0);
  assert.ok(S.claimQuest(d, 'heavystuff').ok);
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
  /* Theo settles up when you go and see him about it, not the moment you tie
     up — the first job in the game is also where a player learns that. */
  assert.equal(s.quests[0].claimed, false, 'the errand paid itself');
  assert.ok(S.claimQuest(s, s.quests[0].id).ok);
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

test('the two big rocks in the Belt are worlds you orbit', () => {
  /* Nail and Whisker used to be gravity-less havens you pulled alongside. They
     are the biggest rocks in the Belt now: small worlds with a reach, a ground
     and a parking orbit, docked at the way everything else with mass is. */
  for(const id of ['nail', 'whisker']){
    const b = world.get(id);
    assert.ok(b.mu > 0, `${id} has mass`);
    assert.ok(b.soi > 0, `${id} has a reach`);
    assert.ok(b.radius < b.dockAlt && b.dockAlt < b.zoneRadius, `${id}: ground < parking < mouth`);
    assert.ok(b.port);
    const s = S.newGame(2); S.undock(s); s.t = 1000;
    parkAt(s, id);
    const st = S.dockingStatus(s);
    assert.equal(st.kind, 'orbit', `${id} is docked at by orbiting`);
    assert.ok(S.dock(s).ok, `an orbit round ${id} is docking at it`);
  }
});

test('the Maw is a rendezvous you need a navigator to finish', () => {
  /* A black hole with thirty times Grumm's pull, and still a thing you come
     alongside rather than orbit: there is no ground to park above and nothing
     to hold a ship steady at the mouth, so arriving means matching speeds, and
     holding it there is the cat's trick the navigator's berth buys.

     That is authored rather than derived — `harbour: "rendezvous"` — because it
     is a fact about the harbour and not about the mass. It is the only body in
     the sky that uses the override. */
  const b = world.get('maw');
  assert.ok(b.mu > world.get('grumm').mu, 'a black hole, and heavier than the gas giant');
  assert.ok(b.soi > 0, 'so it has a reach of its own');
  assert.equal(b.harbour, 'rendezvous', 'and keeps the harbour that says so');
  assert.equal(b.rendezvous, true);
  /* The mouth is the one it was given, not five radii over a hundred-and-fifty
     kilometre horizon, which would be a harbour you could not find. */
  assert.ok(b.zoneRadius > 100 * b.radius, 'the mouth got re-derived from the mass');
  assert.equal(b.driftReach, undefined, 'a well of its own does what a drift reach was for');
  assert.ok(b.port && b.zoneRadius > 0 && b.dockSpeed > 0);

  const green = S.newGame(2);
  S.undock(green); green.t = 1000;
  parkAt(green, 'maw');
  /* Nothing to come alongside until a ship can see it. Without the sensors the
     Maw is not on the chart and is not offered as a harbour either — the same
     rule, applied to the thing rather than to the picture of it. */
  assert.equal(S.dockingStatus(green), null, 'a harbour nobody has found took the lines');
  green.keys.gravSensors = true;
  const st = S.dockingStatus(green);
  assert.ok(st.inZone && st.slow, 'the approach itself is good');
  assert.equal(st.ok, false);
  assert.equal(S.dock(green).reason, 'no navigator', 'and it says which piece is missing');


test('a rendezvous refuses on speed, and says so where the pilot is looking', () => {
  /* From a playtest report: "I got to Whisker and I cannot dock — it does not
     have an SOI and I cannot dock without one." The harbour was working. The
     ship was well inside the mouth and going kilometres a second past it, and
     nothing on screen said so except a grey line in the corner. A player will
     conclude the place is broken, and be right to.

     Whisker is a rock you orbit now, so the guard moved to the Maw, which is
     the last rendezvous in the sky. The lesson it is guarding is the panel,
     not the body. It has a well of its own these days — a black hole heavier
     than Grumm — and none of that changes the harbour: it is still a distance
     and a speed, because there is still nothing to park above. */
  const w = world.get('maw');
  const lamp = world.get('lamp');
  const auDayPerMs = 1 / 1731481.5;
  const at = (offKm, relMs) => {
    const s = S.newGame(1); S.undock(s); s.t = 1000;
    s.crew.navigator = { role: 'navigator' };   // the hands; the harbour is still the harbour
    s.keys.gravSensors = true;                  // and the eyes, or there is no harbour to find
    const st = O.railState(w, lamp.mu, s.t);
    s.ship = { body: 'lamp', r: [st.r[0] + offKm / 1.496e8, st.r[1]], v: [st.v[0] + relMs * auDayPerMs, st.v[1]] };
    return S.dockingStatus(s);
  };
  const limit = w.dockSpeed / auDayPerMs;
  assert.ok(limit > 900 && limit < 1100, `the speed it asks for is about a km/s (${limit.toFixed(0)} m/s)`);
  assert.ok(w.soi > 0, 'it has a reach now, and the harbour is unmoved by that');
  assert.equal(w.rendezvous, true, 'which is the point');

  const mouthKm = w.zoneRadius * 1.496e8;
  const fast = at(mouthKm * 0.1, 5600);
  assert.equal(fast.port, 'maw');
  assert.equal(fast.ok, false, 'five and a half km/s past it is not an arrival');
  assert.ok(fast.inZone, 'but it is inside the mouth, which is the half that was met');
  assert.equal(S.dockRefusal(fast), 'too fast');

  assert.equal(at(mouthKm * 0.1, 900).ok, true, 'matched speed inside the mouth is a docking');
  assert.equal(at(mouthKm * 0.8, 900).ok, true, 'and the mouth really is that wide');
  assert.equal(at(mouthKm * 1.4, 100).ok, false, 'outside it, slow is not enough');

  /* And the panel has to lead with it. This is the one state in the game where
     the ship is somewhere it wants to be and doing the wrong thing about it. */
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  const ahead = PLAY.slice(PLAY.indexOf('function aheadList()'), PLAY.indexOf('function shipTab()'));
  assert.match(ahead, /is right here/, 'the panel says nothing about the harbour the ship is inside');
  assert.match(ahead, /Match its speed to/, 'and does not say what to do about it');
  assert.match(ahead, /will take you now/, 'nor when it has been done');
  assert.match(PLAY, /#dockhint\.near\{/, 'inside the mouth and merely too fast still reads as "nowhere near it"');
});

  const far = S.newGame(2);
  S.undock(far); far.t = 1000;
  far.crew.navigator = { role: 'navigator' };
  far.keys.gravSensors = true;                 // and something aboard that can find it
  parkAt(far, 'maw');
  const r = S.dock(far);
  assert.ok(r.ok && far.flags.mawArrival, 'the Maw had nothing to say');
});

test('falling through a world\'s door leaves something to point the clock at', () => {
  /* A skip ends at every change of reach, so the door is exactly where the
     pilot is put down — and at a place with no gravity to speak of, half a
     game hour from the one moment a rendezvous can be made. The low point
     ahead was suppressed, because the world you are going round is normally
     not an encounter with anything: true of a parking orbit, false of a
     hyperbola you fell into four seconds ago. So the panel offered the way out
     the far side and nothing else, and at x1 that crossing is nine real
     minutes of watching. */
  const s = S.newGame(7);
  s.dockedAt = 'tassel'; S.undock(s); s.dv = s.tank = S.auDay(60);
  assert.ok(S.trimToTarget(s, 'nail', 6000).ok);
  let guard = 0;
  while(s.ship.body !== 'lamp' && guard++ < 40000){ S.tick(s, 0.05); if(s.pending) break; }
  assert.ok(S.trimToTarget(s, 'nail', 6000).ok);
  const t0 = s.t;
  while(s.ship.body !== 'nail' && s.t - t0 < 200) S.tick(s, 0.005);
  assert.equal(s.ship.body, 'nail', 'this road never reached Nail');

  const pred = S.planImmediate(s, true);
  const ic = (pred.intercepts ?? []).find(i => i.body === 'nail');
  assert.ok(ic, 'inside Nail\'s reach and the panel says nothing about Nail');
  assert.ok(ic.t > s.t, 'the low point should be ahead of the ship, not under it');
  assert.ok(ic.inMouth, 'this road was aimed into the mouth and the mark disagrees');
  assert.ok(ic.speed > 0, 'and it has to say the speed: that is the half a rendezvous turns on');

  /* The rule it must not have broken on the way: a parking orbit's own low
     point is still not an encounter, or every game would open with a
     crosshair under the ship. */
  const parked = S.newGame(7); S.undock(parked);
  const own = (S.planImmediate(parked, true).intercepts ?? []).find(i => i.body === parked.ship.body);
  assert.ok(!own, 'a parking orbit marks the world it is parked at');
});


test('Nail is a rock you orbit, and the road to it is flown on the mark', () => {
  /* Nail used to be a three-hundred-thousand-kilometre bubble in the Belt: fly
     roughly at the Belt and you were docked. It is a four-hundred-and-fifty
     kilometre rock now with a harbour mouth like everybody else's, so getting
     there is a real approach — and enough weight that the approach ends the
     way every other approach does, by getting into an orbit. */
  const n = world.get('nail');
  const KM = 1.496e8;
  assert.ok(n.mu > 0, 'it has weight');
  assert.ok(Math.abs(n.radius * KM - 449) < 2, `about 450 km of rock, not ${(n.radius * KM).toFixed(0)}`);
  const vEsc = Math.sqrt(2 * n.mu / n.radius) * S.KMS * 1000;
  assert.ok(vEsc > 400, `enough to hold an orbit worth waiting in (${vEsc.toFixed(0)} m/s escape)`);
  assert.equal(n.rendezvous, false, 'so its harbour is an orbit, not a rendezvous');
  assert.ok(n.soi > n.zoneRadius, 'its reach still contains its own harbour');
  assert.ok(n.zoneRadius * KM < 5000, `the mouth is a harbour mouth now (${(n.zoneRadius * KM).toFixed(0)} km)`);

  /* The two-step the mouth forces. Out of a Tassel parking orbit the helper can
     only set the road up — one mark inside a planet's reach cannot also thread
     a few-thousand-kilometre window most of an AU away — and what the pilot
     steers by in between is where Nail will be when the road cuts its rail.
     Once the ship is out in the Lamp's frame the same helper closes it. */
  const s = S.newGame(7);
  s.dockedAt = 'tassel'; S.undock(s);
  s.dv = s.tank = S.auDay(60);
  assert.ok(S.trimToTarget(s, 'nail', 6000).ok, 'could not set the road up at all');

  let guard = 0;
  while(s.ship.body !== 'lamp' && guard++ < 40000){ S.tick(s, 0.05); if(s.pending) break; }
  assert.equal(s.ship.body, 'lamp', 'the ship never got out of Tassel\'s reach');
  const close = S.trimToTarget(s, 'nail', 6000);
  assert.ok(close.ok && close.distance <= n.soi,
    `the second aim should arrive: ${(close.distance * KM).toFixed(0)} km of a ${(n.soi * KM).toFixed(0)} km reach`);
  assert.ok(close.cost < S.auDay(0.5), `and cost a nudge, not a transfer (${S.fmtKms(close.cost)})`);

  /* And arriving is capturing: an orbit inside the mouth, like anywhere else. */
  const park = S.newGame(7);
  S.undock(park); park.t = 1000;
  parkAt(park, 'nail');
  const st = S.dockingStatus(park);
  assert.equal(st?.port, 'nail');
  assert.equal(st.kind, 'orbit', 'Nail is orbited, not come alongside');
  assert.ok(S.dock(park).ok, 'an orbit round Nail is docking at it');
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

/* ------------------------------------------------------------- the air */

const WITH_AIR = ['veyra', 'cinder', 'tassel', 'grumm', 'brine'];

/* Five worlds have weather: two that always did, and Veyra, Cinder and Brine,
   which were rock with a sea and floating rafts drawn on them and nothing in
   between. Brine's own blurb has always said "an ammonia sea under a thin
   sky" — the sky is in the table now. */
test('the worlds with air are the worlds that say they have air', () => {
  assert.deepEqual(BODIES.filter(b => b.atmo).map(b => b.id).sort(), [...WITH_AIR].sort());
  for(const id of WITH_AIR){
    const b = BODIES.find(x => x.id === id);
    const air = (b.atmo - b.radius) / b.radius;
    assert.ok(b.atmo > b.radius, `${id}: the air is under the ground`);
    assert.ok(air >= 0.05 && air <= 0.33, `${id}: a band of ${(air * 100).toFixed(0)}% is a skin or a shell, not weather`);
    /* The one ordering a pilot actually flies: to a ship with no shield the top
       of the air is the ground, so a harbour inside it would be a slow crash. */
    assert.ok(b.atmo < b.dockAlt, `${id}: the harbour is inside the air`);
    assert.ok(b.dockAlt < b.zoneRadius, `${id}: the harbour is outside its own mouth`);
  }
  /* The mouth is measured from the top of the air, so giving a world weather
     moves its harbour out. Nothing authored that; it falls out of dockRange. */
  const cinder = BODIES.find(b => b.id === 'cinder');
  assert.equal(cinder.zoneRadius, cinder.atmo + 5 * cinder.radius);
  const airless = BODIES.find(b => b.id === 'moss');
  assert.ok(Math.abs(airless.zoneRadius - 6 * airless.radius) < 1e-15, 'a world with no air measures from the ground');
});

/* The shield's card names where it can be used, and a player buying it at
   Cinder for 4,600 is buying that list. It is written down rather than built,
   so this is what notices when a world gains or loses its air. */
test('the heat shield says where there is air to brake in', () => {
  const shield = UPGRADES.find(u => u.id === 'heatshield');
  for(const id of WITH_AIR){
    const name = S.portName(id);
    assert.ok(shield.unlocks.includes(name), `the shield never mentions ${name}`);
  }
  for(const b of BODIES){
    if(b.atmo || !b.port) continue;
    assert.ok(!shield.unlocks.includes(S.portName(b.id)), `the shield promises air at ${b.name}, which has none`);
  }
});

/* An ellipse dropped into the band, flown from the far end so the pass is
   ahead of the ship rather than under it. What comes back is the manoeuvre:
   a shielded ship is offered a brake, an unshielded one is warned of the
   ground, and the ground in question is the top of the air. */
function intoTheAir(id, depth, shield){
  const b = S.world.get(id);
  const rp = b.atmo - depth * (b.atmo - b.radius);
  const ra = b.zoneRadius * 0.9, a = (rp + ra) / 2;
  const va = Math.sqrt(b.mu * (2 / ra - 1 / a));
  const s = S.newGame(1);
  S.undock(s);
  s.keys.heatShield = shield;
  s.ship = { body: id, r: [-ra, 0], v: [0, -va] };
  s.nodes = [];
  return { state: s, vp: Math.sqrt(b.mu * (2 / rp - 1 / a)) };
}

test('every world with air can actually be braked in, and drowns a ship without a shield', () => {
  for(const id of WITH_AIR){
    const deep = intoTheAir(id, 0.6, true);
    const h = S.hazards(deep.state);
    assert.ok(h.skim, `${id}: a shielded pass through the band offers no brake`);
    assert.equal(h.skim.body, id);
    /* Worth the trip: a real pass takes a tenth of the speed at the bottom of
       it or better, or nobody would fly one. */
    assert.ok(h.skim.dv > deep.vp * 0.1, `${id}: a deep pass sheds only ${S.fmtKms(h.skim.dv)}`);

    /* And the top of the band is the feather it is meant to be, so an orbit
       can be walked down over laps rather than dropped in one. */
    const graze = intoTheAir(id, 0.05, true);
    const g = S.hazards(graze.state);
    assert.ok(!g.skim || g.skim.dv < deep.vp * 0.02, `${id}: a graze is not a graze`);

    /* No shield, same dive: the air is the floor, and it is the world's floor
       rather than somebody else's. */
    const bare = S.hazards(intoTheAir(id, 0.6, false).state);
    assert.ok(bare.crash, `${id}: an unshielded ship flies through the air unharmed`);
    assert.equal(bare.crash.body, id);
    assert.equal(bare.skim, null, 'no shield, no brake');
  }
});

/* The haze is drawn in the world's own colour. It used to be one violet for
   everything, which was Grumm's, and read as Grumm wherever it appeared. */
test('a world wears its own weather', () => {
  const seen = new Set();
  for(const id of WITH_AIR){
    const b = BODIES.find(x => x.id === id);
    const h = haze(bodyColour(b));
    assert.match(h, /^rgba\(\d+,\d+,\d+,0\.18\)$/, `${id}: ${h}`);
    assert.ok(!seen.has(h), `${id} shares its haze with another world`);
    seen.add(h);
  }
  assert.equal(haze(bodyColour(BODIES.find(b => b.id === 'grumm'))), 'rgba(139,107,214,0.18)',
    'Grumm keeps the violet the one hard-coded haze always was');
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

test('a tight pass captures an arriving ship in one lap', () => {
  /* The promise the heat shield is sold on: aim a few kilometres over the
     ground and the planet keeps you. Before the shed went with the square of
     the depth, a hard dive at Tassel took a tenth of the speed off an arrival
     and the ship sailed straight back out of the system, which is not a brake
     so much as a rumour of one. The floor is the other half of it: however
     hard the pass bites, the far end of the orbit still clears the air, so the
     worst case is a low orbit rather than a hole in the ground. */
  const b = S.world.get('tassel');
  const dive = (altKm, vinfKms) => {
    const s = S.newGame(2); s.keys.heatShield = true; S.undock(s); s.nodes = [];
    const rp = b.radius + altKm / 1.496e8, r0 = b.zoneRadius * 0.95;
    const vinf = vinfKms / S.KMS, vp = Math.sqrt(vinf * vinf + 2 * b.mu / rp);
    const h = rp * vp, v0 = Math.sqrt(vinf * vinf + 2 * b.mu / r0), vt = h / r0;
    s.ship = { body: 'tassel', r: [r0, 0, 0], v: [-Math.sqrt(Math.max(0, v0 * v0 - vt * vt)), vt, 0] };
    const n = S.effectiveNodes(s, 300).find(x => x.aero);
    const shed = n ? Math.abs(n.prograde) : 0, after = vp - shed;
    const e = after * after / 2 - b.mu / rp;
    return { shed, risk: S.skimRisk(s, shed), captured: e < 0, apo: e < 0 ? (2 * (-b.mu / (2 * e)) - rp) / b.atmo : Infinity };
  };
  for(const vinf of [1, 2, 3]){
    const hard = dive(7, vinf);
    assert.ok(hard.captured, `v∞ ${vinf} km/s: a pass at 7 km should end in orbit`);
    assert.ok(hard.apo <= S.FORMULAS.aerobrake.floorApo + 1e-6,
      `v∞ ${vinf} km/s: and no higher than the floor (${hard.apo.toFixed(2)} atmo)`);
    assert.ok(hard.risk > 0.1, `v∞ ${vinf} km/s: a pass that hard is not free (${(hard.risk * 100).toFixed(0)}%)`);
  }
  /* And the top of the air is still the feather it always was, or there would
     be no such thing as flying carefully. */
  const soft = dive(60, 1);
  assert.equal(soft.risk, 0, 'a graze at the cloud tops costs nothing');
  assert.ok(soft.shed * S.KMS < 0.2, `and takes only a nibble (${S.fmtKms(soft.shed)})`);
  assert.equal(soft.captured, false, 'one graze does not stop an arrival');
  /* Cryo cooling is the whole difference between the two lines. */
  const cooled = S.newGame(2); cooled.keys.cryoCooling = true;
  assert.equal(S.skimRisk(cooled, dive(7, 3).shed), 0, 'with cryo cooling the hard line is free');
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
  const smallest = Math.min(...BODIES.filter(b => b.id !== 'knot' && (b.mu > 0)).map(b => b.radius));
  assert.ok(k.radius * 100 < smallest, `${k.radius} should be far under ${smallest}`);
  /* Wrecks are the exception, and not a real one: a derelict is a ship, and a
     ship is smaller than a kilometre of nothing. */
  for(const w of BODIES.filter(b => b.kind === 'wreck')) assert.ok(w.radius < k.radius, `${w.id} is wider than the Knot`);

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

test('both crew berths fill on a local hop, early', () => {
  /* A crew member is a mechanic: the engineer gates the deep-sky tank, the
     navigator puts the Knot on the chart. Handed over in the last hour they
     are a trophy rather than a tool, so both quests are hops now. */
  const eng = S.questById('enginetrouble');
  assert.equal(eng.from, 'cinder');
  assert.equal(eng.to, 'scorch');
  assert.equal(eng.type, 'delivery', 'handed to you, so it needs no capital');
  assert.equal(S.questLeavesSystem(eng), false, 'Scorch is Cinder\'s own moon: no Astrolabe');

  const nav = S.questById('catsrequest');
  assert.equal(nav.from, 'nail');
  assert.equal(nav.to, 'whisker');
  assert.equal(S.questLoad(nav), 0, 'a message costs no hold');

  /* And both actually pay out a person when flown. */
  for(const [q, berth] of [[eng, 'engineer'], [nav, 'navigator']]){
    const s = S.newGame(3);
    s.keys.astrolabe = true;
    s.dockedAt = q.from;
    assert.ok(S.canAcceptQuest(s, q).ok, `${q.id} can be taken at ${q.from}`);
    assert.ok(S.acceptQuest(s, q.id).ok);
    s.dockedAt = q.to;
    S.questCheck(s, []);
    assert.ok(s.quests.find(l => l.id === q.id)?.done, `${q.id} completes at ${q.to}`);
    assert.ok(S.claimQuest(s, q.id).ok, `${q.id} could not be collected`);
    assert.ok(s.crew[berth], `${q.id} fills the ${berth} berth`);
  }
  /* The berth is the whole reward, and the navigator's brings two abilities
     that were previously out of reach until very late. */
  const crewed = S.newGame(3);
  crewed.crew.navigator = { role: 'navigator' };
  assert.equal(S.knowsKnot(crewed), true);
  assert.equal(S.canSeePast(crewed), true);
});

test('a stock ship can capture at both rocks and get away again', () => {
  /* Giving them mass makes arrival a manoeuvre rather than a drift, which is
     the point — but it must not price the Belt out of a starter tank. */
  for(const id of ['nail', 'whisker']){
    const b = world.get(id);
    const vc = Math.sqrt(b.mu / b.dockAlt);
    const esc = Math.sqrt(b.mu * (2 / b.dockAlt - 1 / ((b.dockAlt + b.soi) / 2))) - vc;
    assert.ok(S.kms(esc) < 1.0, `${id}: leaving costs ${S.kms(esc).toFixed(3)} km/s`);
    assert.ok(S.kms(vc) < 1.0, `${id}: a parked orbit runs at ${S.kms(vc).toFixed(3)} km/s`);
    /* And the mouth is wide enough to aim at: several times the ground. */
    assert.ok(b.zoneRadius / b.radius >= 5, `${id}: mouth is ${(b.zoneRadius / b.radius).toFixed(1)} radii`);
  }
});

/* --------------------------------------------------- the end of the line */

/* Three things, got three different ways, and then somewhere to take them.
   The only new machinery under it is a `requires` gate and a bag that is
   neither cargo nor a ship system. */

const relicJobs = () => S.QUESTS.filter(q => q.relic);

test('a relic is not cargo, not a fitting, and cannot be turned back into money', () => {
  assert.equal(S.RELICS.length, 3);
  for(const r of S.RELICS){
    assert.ok(r.id && r.name && r.blurb, `relic ${r.id} has no words`);
    assert.equal(relicJobs().filter(q => q.relic === r.id).length, 1, `${r.id} is granted by no job, or by two`);
  }
  const s = S.newGame(4);
  assert.deepEqual(s.relics, {}, 'a new ship carries none');
  assert.deepEqual(S.heldRelics(s), []);
  /* A save from before they existed gets an empty bag rather than an error. */
  const old = JSON.parse(S.serialize(s));
  delete old.relics;
  assert.deepEqual(S.restore(old).relics, {});
  /* And the one that is bought is the one that could have been sold. It is the
     only good in the game no stall will take. */
  const lens = S.goodById('emberglass');
  assert.equal(lens.noResale, true);
  assert.equal(GOODS.filter(g => g.noResale).length, 1, 'more than one good is unsellable');
  const t = S.newGame(4); t.money = 999999; t.dockedAt = 'veyra';
  assert.ok(S.buy(t, 'emberglass', 1).ok);
  for(const port of ['veyra', 'cinder', 'nail', 'croak']){
    const r = S.sell({ ...t, dockedAt: port }, 'emberglass', 1);
    assert.equal(r.ok, false, `sold at ${port}`);
    assert.match(r.reason, /Nobody will take that/);
  }
});

test('the gate answers in a sentence, and hides only what should be a surprise', () => {
  const s = S.newGame(4);
  assert.equal(S.requiresUnmet(s, S.questById('pebble')), null, 'an ungated job is gated');

  /* The frogs count. Their gift is on the board from the start with its reason
     written on it, because a job you cannot take yet is worth showing when it
     tells you what it is waiting for. */
  const gift = S.questById('fifthsong');
  assert.deepEqual(gift.requires, { questsFor: { frog: 5 } });
  assert.match(S.requiresUnmet(s, gift), /0 of 5/);
  s.dockedAt = 'brine'; s.quests = [];
  assert.ok(S.questsAt(s, 'brine').some(q => q.id === 'fifthsong'), 'the gift is hidden rather than shown as a goal');
  assert.match(S.canAcceptQuest(s, gift).reason, /5 jobs done/);

  /* Collected, not merely finished: the count is of jobs you went back and were
     paid for. */
  const frogJobs = S.QUESTS.filter(q => q.rep === 'frog' && q.id !== 'fifthsong');
  assert.ok(frogJobs.length >= 5, `only ${frogJobs.length} frog jobs to count`);
  for(const q of frogJobs.slice(0, 5)) s.quests.push({ id: q.id, step: 99, done: true, claimed: false });
  assert.equal(S.questsDoneFor(s, 'frog'), 0, 'finished but uncollected jobs were counted');
  for(const l of s.quests) l.claimed = true;
  assert.equal(S.questsDoneFor(s, 'frog'), 5);
  assert.equal(S.requiresUnmet(s, gift), null);
  assert.ok(S.canAcceptQuest(s, gift).ok);

  /* The last one is the other kind: off the board entirely until the three are
     in the bag, because it is the surprise rather than the goal. */
  const end = S.questById('lantern');
  assert.equal(end.requires.hidden, true);
  assert.deepEqual(end.requires.relics, ['lens', 'shard', 'song']);
  const far = S.newGame(4); far.quests = []; far.dockedAt = 'maw';
  assert.equal(S.questsAt(far, 'maw').length, 0, 'the Maw gives the ending away');
  for(const id of ['lens', 'shard']) far.relics[id] = { from: 'test', foundAt: 0 };
  assert.equal(S.questsAt(far, 'maw').length, 0, 'two of three was enough');
  assert.match(S.requiresUnmet(far, end), /The Fifth Song/);
  far.relics.song = { from: 'test', foundAt: 0 };
  assert.deepEqual(S.questsAt(far, 'maw').map(q => q.id), ['lantern'], 'three in the bag and the Maw still says nothing');
});

test('the whole closing line can be played, in the order it is meant to be', () => {
  const s = S.newGame(5);
  s.money = 200000; s.quests = []; s.keys.astrolabe = true; s.keys.gravSensors = true;
  s.crew.navigator = { role: 'navigator', from: 'test', joinedAt: 0 };

  /* One: bought at Veyra for a year of trading. */
  const purse = s.money;
  s.dockedAt = 'veyra';
  assert.ok(S.acceptQuest(s, 'ninthlens').ok);
  assert.ok(S.buy(s, 'emberglass', 1).ok);
  S.questCheck(s, []);
  assert.equal(S.claimQuest(s, 'ninthlens').relic, 'lens');
  assert.ok(purse - s.money > 15000, 'the lens was cheap');
  assert.equal(S.usedUnits(s), 0, 'and it stayed in the hold');

  /* Two: salvaged out of the Arc's tail. */
  s.dockedAt = 'nail';
  assert.ok(S.acceptQuest(s, 'tailend').ok);
  const w = world.get('tailend'), lamp = world.get('lamp');
  const st = O.railState(w, lamp.mu, s.t);
  s.dockedAt = null; s.justLeft = null; s.justLeftAt = -1e9;
  s.ship = { body: 'lamp', r: [st.r[0] + w.zoneRadius * 0.4, st.r[1]], v: [...st.v] };
  s.nodes = [];
  assert.ok(S.dock(s).ok, 'could not come alongside the tail wreck');
  s.dockedAt = 'arc'; S.questCheck(s, []);
  assert.equal(S.claimQuest(s, 'tailend').relic, 'shard');

  /* Three: given, after five. */
  for(const q of S.QUESTS.filter(x => x.rep === 'frog' && x.id !== 'fifthsong').slice(0, 5)){
    s.quests.push({ id: q.id, step: 99, done: true, claimed: true, doneAt: 0, claimedAt: 0 });
  }
  s.dockedAt = 'brine';
  assert.ok(S.acceptQuest(s, 'fifthsong').ok);
  s.dockedAt = 'croak'; S.questCheck(s, []);
  assert.equal(S.claimQuest(s, 'fifthsong').relic, 'song');
  assert.equal(S.heldRelics(s).length, 3);

  /* And the end of it, which is the only thing the Maw has ever had to offer. */
  s.dockedAt = 'maw';
  assert.deepEqual(S.questsAt(s, 'maw').map(q => q.id), ['lantern']);
  assert.ok(S.acceptQuest(s, 'lantern').ok);
  assert.equal(S.questTarget(S.questById('lantern')), 'lantern', 'the chart does not point at the station');
  const b = world.get('lantern'), d = world.get('dancer');
  const ls = O.railState(b, d.mu, s.t);
  s.dockedAt = null; s.justLeft = null; s.justLeftAt = -1e9;
  s.ship = { body: 'dancer', r: [ls.r[0] + b.zoneRadius * 0.4, ls.r[1]], v: [...ls.v] };
  s.nodes = [];
  const arrived = S.dock(s);
  assert.ok(arrived.ok && arrived.port === 'lantern', 'the station refused the lines');
  S.questCheck(s, []);
  assert.ok(s.quests.find(l => l.id === 'lantern')?.done, 'arriving did not finish it');
  assert.ok(S.claimQuest(s, 'lantern').ok);
});

/* Found by flying it rather than by reading it: a save made while tied up to a
   wreck was refused on load, because `restore` asked the price list whether the
   place existed and a derelict is deliberately not in it. You could come
   alongside one and never get back to it. And docking at the Maw put the ship
   at NaN, because `placeDocked` branched on mass to decide whether there was a
   parking orbit — which stopped being the right question the day the Maw got
   weight and kept its come-alongside harbour. */
test('every harbour a ship can tie up to survives being put down and picked up', () => {
  const at = (id, parent, reveal) => {
    const s = S.newGame(5);
    s.money = 90000; s.quests = []; s.keys.gravSensors = true;
    s.crew.navigator = { role: 'navigator', from: 'test', joinedAt: 0 };
    if(reveal) s.quests.push({ id: reveal, step: 0, done: false });
    if(parent == null){ s.dockedAt = id; return s; }
    const b = world.get(id), p = world.get(parent);
    const st = O.railState(b, p.mu, s.t);
    s.dockedAt = null; s.justLeft = null; s.justLeftAt = -1e9;
    s.ship = { body: parent, r: [st.r[0] + b.zoneRadius * 0.4, st.r[1]], v: [...st.v] };
    s.nodes = [];
    assert.ok(S.dock(s).ok, `could not tie up to ${id}`);
    return s;
  };
  const cases = [
    ['tassel', null, null],                 // a world you park above
    ['maw', 'lamp', null],                  // a black hole you come alongside
    ['cutterjaw', 'slate', 'cutterjaw'],    // a wreck
    ['lantern', 'dancer', 'lantern'],       // and the end of the line
  ];
  for(const [id, parent, reveal] of cases){
    const s = at(id, parent, reveal);
    assert.equal(s.dockedAt, id);
    for(const v of [...s.ship.r, ...s.ship.v]) assert.ok(Number.isFinite(v), `${id}: the ship was put at ${v}`);
    const back = S.restore(JSON.parse(S.serialize(s)));
    assert.equal(back.dockedAt, id, `a save made at ${id} would not load`);
  }
  // And nowhere at all is still nowhere at all.
  assert.throws(() => S.restore({ ...JSON.parse(S.serialize(S.newGame(1))), dockedAt: 'nowhere' }), /nowhere a ship can tie up/);
});

test('the station is off the chart until the Builders give the bearing', () => {
  const s = S.newGame(4);
  assert.ok(S.isHulk('lantern') && !S.isWreck('lantern'), 'the station is not a weightless harbour');
  assert.ok(S.unseen(s).has('lantern'), 'it is on the chart from the first day');
  s.quests.push({ id: 'lantern', step: 0, done: false });
  assert.ok(!S.unseen(s).has('lantern'), 'taking the last job did not put it on the chart');
  /* Every other weightless thing is still hidden: one job reveals one place. */
  for(const id of S.WRECKS) assert.ok(S.unseen(s).has(id), `${id} came along with it`);

  const b = world.get('lantern'), d = world.get('dancer');
  assert.equal(b.parent, 'dancer', 'the station is not at the Dancer');
  assert.equal(b.mu, 0);
  assert.ok(b.rendezvous, 'it is orbited rather than come alongside');
  assert.ok(b.a + b.zoneRadius < d.soi * 0.8, 'it hangs off the edge of the star it circles');
  assert.equal(PORTS[b.id], undefined, 'the station has a price list');
  assert.equal(S.portOpen('lantern', 0), true);
});

/* ------------------------------------------------ the three quest scenes */

/* A job is written three times over: the pitch a stranger reads off the board,
   what the giver says once you have agreed, and what happens when you hand it
   over. Two of those are moments rather than cards — one answers a button you
   just pressed, the other is the point of the whole trip — so both are shown as
   a scene, and neither is allowed to be the other one again. */
test('every job is written three times, and no two of them are the same', () => {
  for(const q of S.QUESTS){
    for(const k of ['blurb', 'taken', 'done']) assert.ok(q[k]?.trim(), `${q.id}: no ${k}`);
    const three = ['blurb', 'taken', 'done'].map(k => q[k].trim());
    assert.equal(new Set(three).size, 3, `${q.id} says the same thing twice`);
  }
  /* Enough of it to be worth a scene. Below about twenty words a modal is an
     interruption rather than a beat. */
  const words = t => t.trim().split(/\s+/).length;
  for(const q of S.QUESTS) assert.ok(words(q.taken) >= 20 && words(q.taken) <= 90, `${q.id}: taken is ${words(q.taken)} words`);
});

test('the page shows the two moments a card in a list cannot', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(PLAY, /function showQuestScene\(q, \{ kind, say, foot, then \}\)/, 'there is no scene to show');
  /* Taking one on shows what was said when you agreed... */
  const take = PLAY.slice(PLAY.indexOf('takequest(id){'), PLAY.indexOf('look(gid){'));
  assert.match(take, /showQuestScene\(r\.quest, \{/, 'accepting says nothing');
  assert.match(take, /say: r\.quest\.taken/, 'accepting does not use the line written for it');
  /* ...and collecting shows what happened, then goes on to a face if the job
     paid in one, rather than two modals racing each other. */
  const claim = PLAY.slice(PLAY.indexOf('claim(id){'), PLAY.indexOf('exportsave(){'));
  assert.match(claim, /say: r\.quest\.done/, 'collecting does not use the line written for it');
  assert.match(claim, /then: r\.crew \? \(\) => showCrewPortrait/, 'a berth filled races the payoff');
  assert.doesNotMatch(claim, /toast\(TEXT\.events\.questCollected/, 'the payoff is still a line in the corner');
  /* And the card in hand stops repeating the sales pitch. */
  const tab = PLAY.slice(PLAY.indexOf('function questsTab()'), PLAY.indexOf('/* ------------------------------------------------------------- actions */'));
  assert.match(tab, /esc\(q\.taken \?\? q\.blurb\)/, 'a job in hand is still being sold to you');
});

/* ------------------------------------------------- the Dancer and the Maw */

test('the Dancer is a small blue star going round the Maw', () => {
  const d = world.get('dancer'), maw = world.get('maw'), grumm = world.get('grumm');
  assert.equal(d.kind, 'star');
  assert.equal(d.parent, 'maw', 'it goes round the Maw');
  assert.equal(d.radius, grumm.radius, 'about the size of Grumm');
  assert.ok(d.mu > 0 && d.mu < maw.mu, 'a star beside a black hole is the light one');
  assert.ok(!d.port, 'and nothing you can tie up to');
  /* Blue, and its own colour rather than the palette's star, which is the
     Lamp's orange. Two stars in the sky now and they do not match. */
  const c = bodyColour(d);
  assert.match(c, /^#[0-9a-f]{6}$/i);
  const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  assert.ok(b > r + 40 && b >= g, `${c} is not blue`);
  assert.notEqual(bodyColour(d), bodyColour(world.get('lamp')), 'the two stars are the same colour');

  /* Clear of the harbour at one end and well inside the reach at the other, so
     the star is somewhere a ship can actually come and look at it. */
  assert.ok(d.a * (1 - d.e) - d.soi > maw.zoneRadius, 'the Dancer overlaps the harbour mouth');
  assert.ok(d.a * (1 + d.e) + d.soi < maw.soi * 0.8, 'the Dancer hangs off the edge of the reach');
  /* And it moves: a star that sat still would be a decoration rather than a
     thing with a name like that. */
  const a = O.railState(d, maw.mu, 0).r, later = O.railState(d, maw.mu, 60).r;
  assert.ok(O.dist(a, later) > d.a * 0.5, 'the Dancer does not dance');
});

test('the Maw is a black hole, and still a harbour you come alongside', () => {
  const maw = world.get('maw'), grumm = world.get('grumm');
  assert.ok(maw.mu > grumm.mu, 'heavier than the gas giant');
  assert.ok(maw.soi > 0, 'so it has a reach');
  assert.equal(maw.harbour, 'rendezvous', 'and an authored harbour that outranks the mass');
  assert.equal(maw.rendezvous, true);
  /* Inside its reach the frame is its own, so the readout is simply where you
     are and how fast — the drift reach it used to carry did that job when it
     had no gravity, and is gone. */
  const s = S.newGame(6); S.undock(s); s.t = 2000;
  s.ship = { body: 'maw', r: [0.05, 0], v: [-0.0008, 0.0005] };
  s.nodes = [];
  const rv = S.rendezvous(s);
  assert.ok(rv, 'no rendezvous readout inside the Maw');
  assert.equal(rv.target, 'maw');
  assert.ok(Math.abs(rv.range - 0.05) < 1e-12, 'the range is where you are');
  assert.ok(rv.closing, 'and it knows you are falling in');
  assert.equal(rv.mouth, maw.zoneRadius);
});

test('the Maw is not there until a ship can measure it', () => {
  const green = S.newGame(6);
  assert.ok(S.unseen(green).has('maw'), 'the Maw is on the chart from the first day');
  assert.ok(!S.unseen(green).has('dancer'), 'and the Dancer is not, which is the whole hook');
  assert.equal(S.knowsMaw(green), false);

  /* The instrument, not the person. A cat can tell you where the Knot is
     because the cats have known for nine generations; nobody has come back
     from the far edge to say what is out there. */
  const cat = S.newGame(6);
  cat.crew.navigator = { role: 'navigator' };
  assert.ok(S.unseen(cat).has('maw'), 'a navigator found the Maw by asking around');
  assert.ok(!S.unseen(cat).has('knot'), 'and she should still know about the Knot');

  const kitted = S.newGame(6);
  kitted.keys.gravSensors = true;
  assert.ok(!S.unseen(kitted).has('maw'), 'the sensors did not find it');
  assert.equal(S.knowsMaw(kitted), true);
});

test('a thing nobody has found keeps its numbers and loses its name', () => {
  const green = S.newGame(6), hidden = S.unseen(green);
  assert.equal(S.nameFor('maw', hidden), '???');
  assert.equal(S.nameFor('dancer', hidden), 'The Dancer', 'the visible half says what it is');
  assert.equal(S.nameFor('tassel', hidden), 'Tassel');
  const kitted = S.newGame(6); kitted.keys.gravSensors = true;
  assert.equal(S.nameFor('maw', S.unseen(kitted)), 'The Maw');
  /* Nothing at all hidden is the ordinary case, and has to behave. */
  assert.equal(S.nameFor('maw', null), 'The Maw');
  assert.equal(S.nameFor('maw', new Set()), 'The Maw');

  /* Every place the chart or the readouts put a body's name goes through it,
     so an encounter with the Maw is marked and measured and called ???. */
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  const RENDER = readFileSync(new URL('../public/orbital-trader/render.js', import.meta.url), 'utf8');
  assert.match(RENDER, /function labelFor\(b, chart\)\{ return chart\?\.hidden\?\.has\(b\.id\) \? '\?\?\?'/,
    'the chart labels a hidden body by name');
  assert.doesNotMatch(RENDER, /labelFor\(b\)|labelFor\(to\)/, 'a label site was left without the chart');
  for(const call of ['S.nameFor(ic.body, unknown)', 'S.nameFor(e.to, unknown)', 'S.nameFor(e.body, unknown)']){
    assert.ok(PLAY.includes(call), `the readouts still name a body directly: ${call}`);
  }
  assert.doesNotMatch(PLAY, /S\.portName\(ic\.body\)/, 'the intercept readout names it outright');
});

/* ----------------------------------------------------------- salvage */

/* Come alongside the wreck, take what is aboard, carry it to the buyer. The
   flight was already built — it is the Maw's rendezvous — so what is new is a
   sixth quest type and a step that puts goods *into* the hold, which no other
   step does. */

const wrecksOf = () => BODIES.filter(b => b.kind === 'wreck');
const salvageJobs = () => S.QUESTS.filter(q => q.type === 'salvage');

/* Park the ship alongside a wreck, in its parent's frame, moving with it. */
function comeAlongside(s, id){
  const w = S.world.get(id), p = S.world.get(w.parent);
  const st = O.railState(w, p.mu, s.t);
  s.dockedAt = null; s.justLeft = null; s.justLeftAt = -1e9;
  s.ship = { body: w.parent, r: [st.r[0] + w.zoneRadius * 0.4, st.r[1]], v: [...st.v] };
  s.nodes = [];
  return s;
}
/* A ship that can take salvage on: a navigator in the berth and money enough
   not to be the thing under test. */
function salvor(seed = 3){
  const s = S.newGame(seed);
  s.money = 200000; s.quests = []; s.keys.astrolabe = true;
  s.crew.navigator = { role: 'navigator', from: 'test', joinedAt: 0 };
  return s;
}

test('every wreck is a thing with no weight that a ship can tie up to', () => {
  const wrecks = wrecksOf();
  assert.equal(wrecks.length, 8, 'eight wrecks, one per salvage job');
  for(const w of wrecks){
    assert.equal(w.mu, 0, `${w.id} has weight`);
    assert.equal(w.soi, null, `${w.id} has a gravity well`);
    assert.ok(w.port && w.rendezvous, `${w.id} is not a harbour you come alongside`);
    assert.ok(w.zoneRadius > 0 && w.dockSpeed > 0, `${w.id}: no mouth or no closing speed`);
    assert.ok(w.driftReach > w.zoneRadius, `${w.id}: the axes bend inside the mouth or not at all`);
    assert.ok(S.isWreck(w.id), `${w.id} is not known as a wreck`);
    /* Its own parent has to be somewhere, and it has to be somewhere sane in
       it: a wreck hanging off the edge of a sphere of influence is an arrival
       that goes wrong. */
    const p = S.world.get(w.parent);
    if(p.soi) assert.ok(w.a * (1 + w.e) + w.zoneRadius <= 0.8 * p.soi, `${w.id} hangs off the edge of ${p.id}`);
  }
  /* And the places the design asked for, in the sky where it asked for them. */
  const by = Object.fromEntries(wrecks.map(w => [w.id, w]));
  assert.equal(by.cutterjaw.parent, 'slate', 'the mining tender is round Slate');
  assert.equal(by.longsweet.parent, 'grumm', 'the cider transport is round Grumm');
  assert.ok(by.longsweet.e === 0 && by.longsweet.a > S.world.get('haven').a,
    'and it is a wide circle above Haven');
  assert.equal(by.ashfall.parent, 'lamp');
  assert.ok(by.ashfall.a * (1 - by.ashfall.e) > S.world.get('veyra').a
    && by.ashfall.a * (1 + by.ashfall.e) < S.world.get('cinder').a,
    'the hauler falls between Veyra and Cinder and crosses neither');
  const belt = wrecks.filter(w => w.parent === 'lamp' && w.a > CONST.BELT.inner && w.a < CONST.BELT.outer);
  assert.equal(belt.length, 4, 'four in the Belt');
  for(const w of belt){
    assert.ok(w.a * (1 - w.e) >= CONST.BELT.inner && w.a * (1 + w.e) <= CONST.BELT.outer, `${w.id} leaves the Belt`);
  }
});

test('a salvage job names a wreck, and every wreck has a job that names it', () => {
  const jobs = salvageJobs();
  assert.equal(jobs.length, 8, 'eight salvage jobs');
  const named = jobs.map(q => q.wreck).sort();
  assert.deepEqual(named, wrecksOf().map(w => w.id).sort());
  assert.equal(new Set(named).size, named.length, 'two jobs share a wreck');
  for(const q of jobs){
    assert.ok(S.isWreck(q.wreck), `${q.id}: ${q.wreck} is not a wreck`);
    assert.ok(q.aboard, `${q.id}: nothing written for what is aboard`);
    assert.ok(PORTS[q.from] && PORTS[q.to], `${q.id}: from or to is not a port`);
    assert.ok((q.goods ?? []).length, `${q.id}: a salvage with nothing aboard`);
  }
  /* The eighth is the one the rest of the line was pointing at: Hull 41 hands
     in with somebody saying to look behind the Arc rather than at it, and the
     wreck in the Arc's tail is where that goes. */
  const tail = S.questById('tailend');
  assert.equal(tail.wreck, 'tailend');
  assert.equal(tail.relic, 'shard', 'the eighth salvage is the one that pays in a relic');
});

test('a salvage is two steps: what is aboard, and who wants it', () => {
  const q = S.questById('cutterjaw');
  const steps = S.questSteps(q);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].kind, 'recover');
  assert.equal(steps[0].port, 'cutterjaw', 'the first stop is the wreck');
  assert.equal(steps[1].kind, 'handover');
  assert.equal(steps[1].port, q.to);
  assert.equal(S.questTarget(q), 'cutterjaw', 'and the chart points at the wreck');
  /* Nothing comes aboard at the dock, so a salvage costs no hold to accept —
     but it will want the room eventually, and that is a number worth saying. */
  assert.equal(S.questLoad(q), 0);
  assert.ok(S.salvageLoad(q) > 0);
});

test('coming alongside a wreck takes a navigator, and the board says so', () => {
  const bare = S.newGame(3);
  bare.money = 200000; bare.quests = []; bare.keys.astrolabe = true;
  bare.dockedAt = 'slate';
  const can = S.canAcceptQuest(bare, S.questById('cutterjaw'));
  assert.equal(can.ok, false);
  assert.match(can.reason, /navigator/i, 'and it says which piece is missing');

  const crewed = salvor();
  crewed.dockedAt = 'slate';
  assert.ok(S.canAcceptQuest(crewed, S.questById('cutterjaw')).ok);

  /* Refused at the board rather than at the far end, because a crossing spent
     to be told no is a crossing thrown away. It is the same rule the harbour
     itself applies. */
  assert.equal(S.canDockDrifting(bare), false);
  assert.equal(S.canDockDrifting(crewed), true);
});

test('a hold that could never take the haul is refused at the board', () => {
  const s = salvor();
  s.dockedAt = 'nail';
  const q = S.questById('hull41');
  assert.ok(S.canAcceptQuest(s, q).ok, 'the starter hold takes it');
  s.tiers = { ...s.tiers, hold: 0 };
  const tiny = { ...s, tiers: s.tiers };
  // Shrink the hold below the haul and the job stops being takeable.
  const load = S.salvageLoad(q);
  assert.ok(load > 0);
  assert.ok(S.holdUnits(tiny) >= load, 'the smallest hold in the game still takes the biggest haul');
});

/* A ship a given distance off a wreck, closing at a given speed — with the job
   that names it already in hand, since an unheard-of wreck is no harbour and
   bends nothing. */
function alongsideAt(s, id, km, ms){
  const w = S.world.get(id), p = S.world.get(w.parent);
  if(!s.quests?.some(q => S.questById(q.id)?.wreck === id)){
    const job = S.QUESTS.find(q => q.wreck === id);
    s.quests = [...(s.quests ?? []), { id: job.id, step: 0, done: false, takenAt: s.t }];
  }
  const st = O.railState(w, p.mu, s.t);
  s.dockedAt = null; s.justLeft = null; s.justLeftAt = -1e9;
  s.ship = {
    body: w.parent,
    r: [st.r[0] + km / KM_PER_AU, st.r[1]],
    v: [st.v[0], st.v[1] + S.auDay(ms / 1000)],
  };
  s.nodes = [];
  return s;
}

test('toward really points at it, and match really stops the drift', () => {
  /* The two controls, and between them the whole manoeuvre. It was four — the
     orbital axes in the relative frame — and the trouble with those was not
     only that four is a lot: `out` is at right angles to your relative
     velocity rather than along the line to the thing, so the button labelled
     "toward" pointed at the wreck in the one case where those coincide and
     somewhere else the rest of the time. */
  const s = alongsideAt(salvor(), 'cutterjaw', 300, 40);
  s.ship.v = [s.ship.v[0] + S.auDay(0.02), s.ship.v[1]];   // well off the line of sight
  s.dv = s.tank;
  const tgt = S.alongside(s);
  assert.equal(tgt.id, 'cutterjaw');

  const v0 = [...s.ship.v];
  assert.ok(S.thrust(s, 'toward').ok);
  const push = O.sub(s.ship.v, v0);
  const sight = O.unit(O.sub(tgt.r, [s.ship.r[0], s.ship.r[1]]));
  /* Straight down the line of sight: the two unit vectors are the same one. */
  assert.ok(O.norm(O.sub(O.unit(push), sight)) < 1e-9,
    'toward did not push along the line to the thing');

  /* And match is straight against the drift, whichever way it points. */
  const before = S.rendezvous(s).speed;
  const v1 = [...s.ship.v];
  assert.ok(S.thrust(s, 'match').ok);
  const brake = O.sub(s.ship.v, v1);
  const drift = O.unit(O.sub(v1, tgt.v));
  assert.ok(O.norm(O.sub(O.unit(brake), O.scale(drift, -1))) < 1e-9,
    'match did not push against the relative velocity');
  assert.ok(S.rendezvous(s).speed < before, 'match did not slow the drift');
});

test('match brings the ship to rest and never past it', () => {
  /* Held down, it should stop — not bounce the ship off nothing and send it
     back the other way. A press is a tenth of what is left, and never more
     than all of what is left. */
  const s = alongsideAt(salvor(), 'cutterjaw', 60, 40);
  s.dv = s.tank;
  let last = Infinity, presses = 0;
  while(presses < 300){
    const speed = S.rendezvous(s).speed;
    assert.ok(speed <= last + 1e-15, 'the relative speed went back up');
    last = speed;
    if(S.kms(speed) * 1000 < 0.05) break;
    assert.ok(S.thrust(s, 'match').ok);
    presses++;
  }
  assert.ok(S.kms(S.rendezvous(s).speed) * 1000 < 0.05, `still drifting after ${presses} presses`);

  /* The charge is a written mark's own: out of the tank, and on the record. */
  assert.ok(s.tank - s.dv > 0);
  assert.equal(s.stats.burns, presses);
  assert.ok(Math.abs(s.stats.dvSpent - (s.tank - s.dv)) < 1e-12);
});

test('two controls are enough to fly the whole approach', () => {
  /* The test that says the simplification is not a loss. A pilot who can only
     point at it and stop drifting has to be able to get from the edge of the
     reach to the mouth, from any of the ways an approach can start. */
  const flyIn = (km, off, vx, vy) => {
    const s = alongsideAt(salvor(), 'cutterjaw', km, 0);
    const t = S.alongside(s);
    s.ship.r = [t.r[0] + km / KM_PER_AU, t.r[1] + off / KM_PER_AU];
    s.ship.v = [t.v[0] + S.auDay(vx / 1000), t.v[1] + S.auDay(vy / 1000)];
    s.dv = s.tank;
    let presses = 0;
    for(let i = 0; i < 4000; i++){
      const rv = S.rendezvous(s);
      if(!rv) return { left: true };
      const range = rv.range * KM_PER_AU, ms = S.kms(rv.speed) * 1000;
      if(range <= 9 && ms <= 9) break;
      /* Cross what is left in about five minutes: a slow approach is one that
         differential gravity has time to bend, the pair being in orbit. */
      const want = Math.max(4, Math.min(150, range * 1000 / 300));
      const closing = rv.closing ? ms : -ms;
      if(closing > want * 1.3 || range <= 9 || closing < 0) S.thrust(s, 'match');
      else if(closing < want * 0.7) S.thrust(s, 'toward');
      else { S.tick(s, 0.0002); continue; }
      presses++;
    }
    return { presses, ok: S.dockingStatus(s)?.ok === true, spent: S.kms(s.tank - s.dv) * 1000 };
  };
  for(const [label, ...args] of [
    ['off-axis', 300, 120, -30, 26],
    ['head-on', 500, 0, -40, 0],
    ['drifting away', 120, 60, 10, 10],
    ['at rest', 40, 10, 0, 0],
  ]){
    const r = flyIn(...args);
    assert.ok(!r.left, `${label}: flew out of the reach`);
    assert.ok(r.ok, `${label}: never got alongside`);
    assert.ok(r.presses < 200, `${label}: ${r.presses} presses is a chore, not a manoeuvre`);
    assert.ok(r.spent < 2000, `${label}: ${r.spent.toFixed(0)} m/s is too dear an approach`);
  }
});

test('a thruster refuses where there is nothing to fly against', () => {
  const docked = alongsideAt(salvor(), 'cutterjaw', 5, 5); docked.dockedAt = 'slate';
  assert.equal(S.thrust(docked, 'toward').ok, false, 'thrusting while tied up');
  const far = alongsideAt(salvor(), 'cutterjaw', 5000, 40);
  assert.equal(S.thrust(far, 'toward').ok, false, 'thrusting with nothing alongside');
  const dry = alongsideAt(salvor(), 'cutterjaw', 50, 40); dry.dv = 0;
  assert.equal(S.thrust(dry, 'toward').ok, false, 'thrusting on an empty tank');
  assert.equal(S.thrust(alongsideAt(salvor(), 'cutterjaw', 50, 40), 'sideways').ok, false, 'a thruster that is not there');

  // Matched already: nothing to kill, and it says so rather than doing nothing.
  const still = alongsideAt(salvor(), 'cutterjaw', 20, 0);
  assert.equal(S.thrustStep('match', S.rendezvous(still).speed), 0, 'a step to kill nothing');
  assert.equal(S.thrust(still, 'match').ok, false, 'matched a ship that was already matched');
  assert.ok(S.thrust(still, 'toward').ok, 'but it can still be pushed at the thing');

  /* A press at the end of a long trip is whatever is left of one, never a
     refusal — the same rule a written mark gets on a short tank. */
  const low = alongsideAt(salvor(), 'cutterjaw', 50, 400);
  low.dv = S.auDay(0.002);
  const r = S.thrust(low, 'match');
  assert.ok(r.ok && Math.abs(r.dv - S.auDay(0.002)) < 1e-15, 'a short tank refused instead of giving what it had');
  assert.equal(low.dv, 0);
});

test('each thruster says what one press of it is worth', () => {
  /* Toward is the same nudge at every range — there is nothing for it to be a
     fraction of — and match is a tenth of what there is to kill, so it shrinks
     as it works and the last metres a second cost no more than the first. */
  assert.equal(S.thrustStep('toward', S.auDay(0.4)), 5);
  assert.equal(S.thrustStep('toward', 0), 5);
  assert.equal(S.thrustStep('match', S.auDay(0.2)), 20);
  assert.equal(S.thrustStep('match', S.auDay(0.04)), 5);
  assert.equal(S.thrustStep('match', 0), 0);
  // Never more than there is: a press cannot send the ship back the other way.
  assert.ok(S.thrustStep('match', S.auDay(0.0004)) <= 0.4 + 1e-9);
});

test('the thrusters are on screen in a reach, and never stop the clock', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(PLAY, /id="thrust"/, 'there is no thruster pad');
  assert.match(PLAY, /data-th="toward"/, 'no toward thruster');
  assert.match(PLAY, /data-th="match"/, 'no match thruster');
  assert.doesNotMatch(PLAY, /data-th="(pro|retro|out|in)"/, 'the four orbital axes are back on the pad');
  assert.match(PLAY, /const rv = state\.dockedAt \? null : S\.rendezvous\(state\);/,
    'the pad does not ask whether the ship is alongside anything');
  assert.match(PLAY, /refreshThrusters\(\);/, 'nothing keeps the pad up to date');

  /* The point of the whole thing: firing one is a manoeuvre in real time. */
  const fn = PLAY.slice(PLAY.indexOf('function fireThruster'), PLAY.indexOf('function refreshThrusters'));
  assert.ok(fn.length > 200, 'found the thruster');
  assert.doesNotMatch(fn, /setPaused|holdForPlanning/, 'firing a thruster stops the clock');
  assert.match(fn, /S\.thrust\(state, which, fine\)/, 'the pad does not fire the engine');
  assert.match(fn, /replan\(true\)/, 'the road is not redrawn as the ship is flown');
  // Up and down fly it; left and right still pan, there being no third thruster.
  assert.match(PLAY, /fireThruster\('toward', fine\)/, 'up does not push at it');
  assert.match(PLAY, /fireThruster\('match', fine\)/, 'down does not stop the drift');
});

test('coming alongside is ten kilometres and ten metres a second', () => {
  /* Was two hundred and ninety-five kilometres at five hundred metres a
     second, which is not coming alongside a derelict so much as passing it. */
  for(const id of [...S.WRECKS, 'lantern']){
    const b = S.world.get(id);
    assert.ok(Math.abs(b.zoneRadius * KM_PER_AU - 10) < 0.01, `${id}: mouth is ${b.zoneRadius * KM_PER_AU} km`);
    assert.ok(Math.abs(S.kms(b.dockSpeed) * 1000 - 10) < 0.01, `${id}: ${S.kms(b.dockSpeed) * 1000} m/s`);
  }
  const can = (km, ms) => S.dockingStatus(alongsideAt(salvor(), 'cutterjaw', km, ms))?.ok === true;
  assert.ok(can(8, 8), 'inside both and still refused');
  assert.ok(!can(12, 8), 'tied up from twelve kilometres out');
  assert.ok(!can(8, 12), 'tied up at twelve metres a second');
  assert.ok(!can(300, 500), 'the old numbers still tie up');
});

test('the whole approach belongs to the wreck, not the moon behind it', () => {
  /* The harbour a pilot is offered has to be the one the controls are already
     about. Inside the reach the burn axes are relative to the wreck and the
     corner counts it down, so the card saying "Slate" there is the HUD
     answering a different question — which is what a ten-kilometre mouth did,
     because a zone was scored against its mouth and an orbit against its own,
     and shrinking one by thirty made every wreck lose its own approach. */
  const inside = S.dockingStatus(alongsideAt(salvor(), 'cutterjaw', 400, 20));
  assert.equal(inside?.port, 'cutterjaw', 'the moon took the wreck\'s approach');
  assert.equal(inside?.ok, false, 'four hundred kilometres out is not alongside');

  /* And outside it the moon is the answer again, rather than nothing at all:
     a port that is nothing like near hands the question down. */
  const outside = S.dockingStatus(alongsideAt(salvor(), 'cutterjaw', 900, 20));
  assert.equal(outside?.port, 'slate', 'no harbour at all outside the reach');
});

test('a mark is an orbit everywhere, beside a wreck as anywhere else', () => {
  /* A written mark used to bend to the drifting thing's frame inside a reach so
     the same four buttons could fly a rendezvous. The two thrusters do that
     now, in real time and off the pair rather than off any frame — so a mark is
     back to meaning one thing wherever it is written, which is the only thing
     it was ever good at. */
  const near = alongsideAt(salvor(), 'tinwhistle', 200, 200);
  const far = alongsideAt(salvor(), 'tinwhistle', 5000, 200);
  for(const [label, s] of [['beside a wreck', near], ['out in the open', far]]){
    const f = O.burnFrame(s.ship.r, s.ship.v);
    assert.ok(Math.abs(O.dot(f.pro, O.unit(s.ship.v)) - 1) < 1e-9, `${label}: forward is not along the orbit`);
    assert.ok(Math.abs(O.dot(f.pro, f.out)) < 1e-12, `${label}: the axes lean`);
  }
  /* And the press is the orbital one — a half-percent of how fast the ship is
     actually going round the Lamp, not of anything relative. */
  const orbital = S.burnStep(O.norm(near.ship.v), false);
  assert.equal(orbital, S.burnStep(O.norm(far.ship.v), false), 'the step changes beside a wreck');
  assert.ok(orbital >= 100, `${orbital} m/s is not an orbital press round the Lamp`);
});

test('a wreck is a rumour until somebody hands you the job', () => {
  const s = salvor();
  const hidden = S.unseen(s);
  for(const w of wrecksOf()) assert.ok(hidden.has(w.id), `${w.id} is on the chart before anybody mentioned it`);

  s.dockedAt = 'slate';
  assert.ok(S.acceptQuest(s, 'cutterjaw').ok);
  const after = S.unseen(s);
  assert.ok(!after.has('cutterjaw'), 'taking the job does not put the wreck on the chart');
  for(const w of wrecksOf()) if(w.id !== 'cutterjaw') assert.ok(after.has(w.id), `${w.id} came along for the ride`);

  /* The rails do not care what you have been told — a wreck goes round its
     world whether or not anybody has named it — but everything the ship can
     *do* with one is gated on having heard of it. A harbour is a place
     somebody mentioned, so an unheard-of derelict is not offered as one. */
  const stranger = salvor();
  comeAlongside(stranger, 'cutterjaw');
  assert.equal(S.dockingStatus(stranger)?.port, 'slate', 'an unmentioned wreck is offered as a harbour');
  const told = salvor();
  told.dockedAt = 'slate'; S.acceptQuest(told, 'cutterjaw');
  comeAlongside(told, 'cutterjaw');
  assert.equal(S.dockingStatus(told)?.port, 'cutterjaw', 'and a mentioned one is not');
});

test('a line is on screen for as long as it takes to read, and never less or much more', () => {
  /* The gap before the next line. Characters rather than words: the unit that
     matters is how far the eye has to travel, and a word is not a fixed amount
     of that. */
  const short = S.sayMs('Aye.'), long = S.sayMs('Nevertheless, I should like it on the record that I said so.');
  assert.ok(long > short, 'a longer line does not get longer to read');
  /* The slope is the rule: two lines forty characters apart are 1.6 s apart. */
  const a = S.sayMs('x'.repeat(40)), b = S.sayMs('x'.repeat(80));
  assert.ok(Math.abs((b - a) - 40 * 40) < 1, `forty characters should be 1600 ms, got ${b - a}`);

  /* A two-word answer still lands as its own beat rather than flashing past. */
  assert.ok(S.sayMs('Aye.') >= 900, 'a short line is gone before it is read');
  assert.ok(S.sayMs('') >= 900 && S.sayMs(null) >= 900, 'an empty line still takes a beat');
  /* And one long speech cannot hold the rest of the conversation. */
  assert.ok(S.sayMs('x'.repeat(5000)) <= 6500, 'a long line holds the conversation for ever');

  /* Every line anybody actually says is inside the band, so no exchange in the
     game either flickers past or stalls. */
  for(const x of DIALOG) for(const l of x.lines ?? []){
    const ms = S.sayMs(l.say);
    assert.ok(ms >= 900 && ms <= 6500, `${x.id}: "${l.say}" reads in ${ms} ms`);
  }
});

test('an unfound wreck is no harbour and no readout', () => {
  /* Hiding a thing on the chart is a lie the player can feel if anything the
     ship does still leans on it. Nothing bends a burn any more — a mark is an
     orbit everywhere — but the readout, the harbour and the thrusters all ask
     what the ship is alongside, and none of them may answer with a wreck
     nobody has been told about. */
  const stranger = comeAlongside(salvor(), 'cutterjaw');
  const told = comeAlongside((() => { const s = salvor(); s.dockedAt = 'slate'; S.acceptQuest(s, 'cutterjaw'); return s; })(), 'cutterjaw');

  assert.equal(S.alongside(stranger), null, 'a wreck nobody mentioned is something to fly against');
  assert.equal(S.alongside(told)?.id, 'cutterjaw', 'and a mentioned one is not');
  assert.equal(S.rendezvous(stranger), null, 'a wreck nobody mentioned got a rendezvous readout');
  assert.equal(S.rendezvous(told)?.target, 'cutterjaw');
  assert.equal(S.thrust(stranger, 'toward').ok, false, 'the thrusters fly against an unheard-of wreck');
  assert.ok(S.thrust(told, 'toward').ok, 'and will not fly against a known one');
  assert.equal(S.dockingStatus(stranger)?.port, 'slate', 'an unmentioned wreck is offered as a harbour');
});

test('a stripped wreck comes off the chart', () => {
  /* A picked-over hulk left on the chart is a harbour that offers nothing — a
     dot you keep flying back to in order to find out it is the one you already
     did. It is there from the moment a salvor names it to the moment its hold
     is empty, and no longer. */
  const s = salvor();
  s.quests = []; s.dockedAt = 'slate';
  assert.ok(S.acceptQuest(s, 'cutterjaw').ok);
  assert.ok(!S.unseen(s).has('cutterjaw'), 'the job named it and it is not on the chart');

  comeAlongside(s, 'cutterjaw');
  assert.equal(S.dockingStatus(s)?.port, 'cutterjaw');
  const r = S.dock(s);
  assert.ok(r.ok, S.dockRefusal(S.dockingStatus(s)));
  assert.ok(r.events.some(e => e.kind === 'salvaged'), 'nothing came aboard');

  /* Still there while the ship is tied up to it: a harbour you are sitting in
     belongs on the chart under you, empty or not. */
  assert.ok(!S.unseen(s).has('cutterjaw'), 'the wreck vanished from under the ship');

  S.undock(s);
  assert.ok(S.unseen(s).has('cutterjaw'), 'the emptied wreck is still on the chart');
  /* And it is nothing the ship can do anything with any more: no harbour, no
     readout, nothing for the thrusters to fly against. */
  comeAlongside(s, 'cutterjaw');
  assert.notEqual(S.dockingStatus(s)?.port, 'cutterjaw', 'an emptied wreck is still offered as a harbour');
  assert.equal(S.alongside(s), null, 'an emptied wreck is still something to fly against');

  // The job itself carries on: the haul is aboard and still has to be delivered.
  const live = s.quests.find(q => q.id === 'cutterjaw');
  assert.ok(live && !live.done, 'the job finished at the wreck');
  assert.ok(S.carrying(s, S.questById('cutterjaw').goods[0].good) > 0, 'the haul is not in the hold');
});

test('arriving with a full hold leaves the wreck where it is', () => {
  /* The haul goes aboard whole or not at all, so a ship that cannot fit it
     takes none of it. The job does not fail — the step simply does not finish,
     and the wreck stays exactly where it was until you have been and made
     room. Coming back is the cost of arriving full. */
  const q = S.questById('cutterjaw');
  const load = S.salvageLoad(q);
  const s = salvor();
  s.quests = []; s.dockedAt = 'slate';
  assert.ok(S.acceptQuest(s, 'cutterjaw').ok);

  // Room for all but one unit of it.
  const per = S.goodById(q.goods[0].good)?.units ?? 1;
  s.cargo = [{ good: q.goods[0].good, qty: Math.floor((S.holdUnits(s) - (load - per)) / per), t: 0, price: 1 }];
  assert.ok(S.freeUnits(s) < load && S.freeUnits(s) > 0, `${S.freeUnits(s)} free of a ${load} unit haul`);

  comeAlongside(s, 'cutterjaw');
  const r = S.dock(s);
  assert.ok(r.ok, 'could not even tie up');
  assert.ok(!r.events.some(e => e.kind === 'salvaged'), 'a hold that cannot fit the haul took some of it');
  S.undock(s);
  assert.ok(!S.unseen(s).has('cutterjaw'), 'the wreck went off the chart with its hold still full');

  // Make room, come back, and now it goes aboard and the site is done with.
  s.cargo = [];
  comeAlongside(s, 'cutterjaw');
  const again = S.dock(s);
  assert.ok(again.events.some(e => e.kind === 'salvaged'), 'coming back empty did not finish the job');
  S.undock(s);
  assert.ok(S.unseen(s).has('cutterjaw'), 'the wreck is still on the chart after being stripped');
});

test('the haul comes aboard at the wreck and cannot be sold on the way home', () => {
  const s = salvor();
  s.dockedAt = 'slate';
  S.acceptQuest(s, 'cutterjaw');
  const q = S.questById('cutterjaw');
  comeAlongside(s, 'cutterjaw');

  const st = S.dockingStatus(s);
  assert.equal(st.kind, 'zone', 'a wreck is come alongside, not orbited');
  assert.ok(st.ok, 'and the approach is good');
  const r = S.dock(s);
  assert.ok(r.ok && r.port === 'cutterjaw');
  assert.ok(r.events.some(e => e.kind === 'salvaged'), 'nothing came off it');

  for(const g of q.goods){
    assert.equal(S.carrying(s, g.good), g.qty, `${g.good} did not come aboard`);
    assert.equal(S.sellable(s, g.good), 0, `${g.good} can be sold, and it is not yours`);
  }
  assert.ok(s.cargo.every(c => c.questId === q.id), 'the haul rides as a consignment');
  assert.equal(s.quests[0].step, 1, 'and the step ticked over');

  // Home, and paid.
  s.dockedAt = q.to;
  S.questCheck(s, []);
  assert.ok(s.quests[0].done, 'handing it over does not finish the job');
  assert.equal(S.usedUnits(s), 0, 'and it leaves nothing in the hold');
  const claim = S.claimQuest(s, q.id);
  assert.ok(claim.ok && claim.pay === q.pay);
});

test('a full hold waits at the wreck rather than failing the job', () => {
  const s = salvor();
  s.dockedAt = 'slate';
  S.acceptQuest(s, 'cutterjaw');
  // Fill the hold to the brim with something of your own.
  const filler = S.goodById('ironore');
  s.cargo = [{ good: 'ironore', qty: S.holdUnits(s) / filler.units, t: 0, price: 1, from: 'slate' }];
  assert.equal(S.freeUnits(s), 0);
  comeAlongside(s, 'cutterjaw');
  assert.ok(S.dock(s).ok, 'you can still tie up to it');
  assert.equal(s.quests[0].step, 0, 'but nothing comes across');
  assert.equal(s.cargo.length, 1, 'and nothing is quietly dropped');
  /* The wreck is not going anywhere: make room without leaving and it comes
     across. A job that could be failed by arriving full would be a job nobody
     would risk taking. */
  s.cargo = [];
  S.questCheck(s, []);
  assert.equal(s.quests[0].step, 1);
});

test('every salvage job can be flown, alongside every wreck', () => {
  for(const q of salvageJobs()){
    const s = salvor(7);
    s.dockedAt = q.from;
    assert.ok(S.acceptQuest(s, q.id).ok, `${q.id} could not be taken at ${q.from}`);
    comeAlongside(s, q.wreck);
    const st = S.dockingStatus(s);
    assert.ok(st?.ok, `${q.id}: could not come alongside ${q.wreck} — ${S.dockRefusal(st)}`);
    assert.ok(S.dock(s).ok, `${q.id}: the wreck refused the lines`);
    assert.equal(s.dockedAt, q.wreck);
    for(const g of q.goods) assert.equal(S.carrying(s, g.good), g.qty, `${q.id}: ${g.good} did not come aboard`);
    s.dockedAt = q.to;
    S.questCheck(s, []);
    assert.ok(s.quests.find(l => l.id === q.id)?.done, `${q.id} did not finish at ${q.to}`);
    assert.ok(S.claimQuest(s, q.id).ok, `${q.id} could not be collected`);
  }
});

test('a wreck has no market, no yard and nobody to talk to', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(PLAY, /const TABS_WRECK = \[\['salvage', 'Salvage'\]\];/, 'a wreck gets the four port tabs');
  assert.match(PLAY, /if\(S\.isWreck\(state\.dockedAt\)\) return TABS_WRECK;/, 'and nothing switches to them');
  assert.match(PLAY, /if\(S\.isHulk\(state\.dockedAt\)\) return TABS_STATION;/, 'the station at the Dancer gets the port menu');
  assert.match(PLAY, /function salvageTab\(\)/, 'there is no salvage tab to switch to');
  assert.match(PLAY, /salvage: salvageTab/, 'and the tab is never rendered');
  /* Alongside, not docked at: there is no harbour here, only a hull and a line
     across to it. */
  assert.match(PLAY, /isHulk\(state\.dockedAt\) \? 'Alongside' : 'Docked at'/, 'the readout calls it a dock');
  for(const id of wrecksOf().map(w => w.id)){
    assert.equal(S.portOpen(id, 0), true, `${id} is shut`);
    assert.equal(PORTS[id], undefined, `${id} has a price list`);
  }
});

/* ---------------------------------------------------- flying a rendezvous */

test('a drifting thing has a reach that bends thrust and nothing else', () => {
  /* The Maw had this and does not need it any more: it has a well, so inside
     its reach the frame already is the Maw's. What still drifts with no weight
     at all is a wreck, which is what the field is for now. */
  const maw = world.get('maw');
  assert.equal(maw.driftReach, undefined, 'the Maw kept a drift reach it cannot use');

  const drifter = BODIES.find(b => b.kind === 'wreck' && b.parent === 'lamp');
  assert.ok(drifter, 'nothing weightless is left on a heliocentric rail');
  assert.equal(drifter.mu, 0, 'no gravity');
  assert.equal(drifter.soi, null, 'and so no gravitational reach');
  assert.ok(drifter.driftReach > drifter.zoneRadius, 'but a reach all the same');

  const lamp = world.get('lamp');
  const t = 2000;
  const m = O.railState(drifter, lamp.mu, t);
  const inside = [m.r[0] + drifter.driftReach * 0.2, m.r[1]];
  const outside = [m.r[0] + drifter.driftReach * 2, m.r[1]];
  assert.ok(O.driftTargetAt(world, 'lamp', inside, t), 'inside the reach');
  assert.equal(O.driftTargetAt(world, 'lamp', outside, t), null, 'and outside it');

  /* The reach does nothing to the path: a ship coasting through it is on the
     same conic it would be on if the wreck were not there. */
  const s = S.newGame(6); S.undock(s); s.t = t; s.nodes = [];
  s.ship = { body: 'lamp', r: inside, v: [m.v[0] + 0.002, m.v[1] + 0.001] };
  const before = O.elementsFromState(lamp.mu, s.ship.r, s.ship.v);
  S.tick(s, 0.5);
  const after = O.elementsFromState(lamp.mu, s.ship.r, s.ship.v);
  assert.ok(Math.abs(after.a - before.a) / before.a < 1e-6, 'coasting through changed the orbit');
  assert.equal(s.ship.body, 'lamp', 'and never captured it');
});

test('inside the reach a mark is still an orbit, and the thrusters are the relative pair', () => {
  const lamp = world.get('lamp'), t = 2000;
  const wreck = BODIES.find(b => b.kind === 'wreck' && b.parent === 'lamp');
  const m = O.railState(wreck, lamp.mu, t);
  const r = [m.r[0] + wreck.driftReach * 0.4, m.r[1] + wreck.driftReach * 0.2];
  const v = [m.v[0] - 0.0005, m.v[1] + 0.0003];

  /* Well inside the reach, and the mark's axes are the world's all the same. */
  const f = O.burnFrame(r, v);
  assert.ok(Math.abs(O.dot(f.pro, O.unit(v)) - 1) < 1e-9, 'forward is not along the orbit');
  assert.ok(Math.abs(O.dot(f.pro, f.out)) < 1e-12, 'the axes lean');
  /* Nothing in the kernel knows about the drifting thing when it writes a
     burn: `frameAt` is gone, and with it the only path that bent one. */
  assert.equal(typeof O.frameAt, 'undefined', 'the bending frame is back');
  const src = readFileSync(new URL('../public/orbital-trader/orbit.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /burnVector\([^)]*frameAt/, 'a burn is being written in a bent frame again');

  /* What *is* relative is the pair of thrusters, and they take their directions
     from the thing itself rather than from any frame. */
  assert.deepEqual(S.THRUSTERS, ['toward', 'match']);
});

test('the two marks do the two jobs a rendezvous needs', () => {
  /* Flown at the Maw, which is where a rendezvous actually happens: inside its
     reach the ship is in its frame, so the two numbers are simply where you are
     and how fast, with nothing to subtract. Well inside the sphere of influence
     and well outside the mouth, on an ellipse falling in. */
  const t = 2000;
  const make = () => {
    const s = S.newGame(6); S.undock(s); s.t = t; s.dv = s.tank;
    s.crew.navigator = { role: 'navigator' };
    s.ship = { body: 'maw', r: [0.05, 0], v: [-0.0008, 0.0005] };
    s.nodes = [];
    return s;
  };
  const fly = s => { for(let i = 0; i < 8; i++) S.tick(s, 0.005); return S.rendezvous(s); };

  const a = make(), start = S.rendezvous(a);
  assert.ok(start && start.closing, 'the ship is closing on it');
  a.nodes = [{ t: a.t + 0.01, prograde: -start.speed * 0.6, radial: 0 }];
  const slowed = fly(a);
  assert.ok(slowed.speed < start.speed * 0.5, `back should kill relative speed: ${S.fmtKms(start.speed)} -> ${S.fmtKms(slowed.speed)}`);

  const b = make();
  b.nodes = [{ t: b.t + 0.01, prograde: 0, radial: -start.speed * 0.15 }];
  const steered = fly(b);
  assert.ok(steered.atIntercept < start.atIntercept, 'toward should tighten the pass');
  assert.ok(Math.abs(steered.speed - start.speed) / start.speed < 0.1,
    'and should barely touch the speed along the track');
});

test('the navigator is the instruments, not the physics', () => {
  const t = 2000;
  const at = nav => {
    const s = S.newGame(6); S.undock(s); s.t = t;
    if(nav) s.crew.navigator = { role: 'navigator' };
    s.ship = { body: 'maw', r: [0.05, 0], v: [-0.0008, 0.0005] };
    s.nodes = [];
    return s;
  };
  const green = at(false), crewed = at(true);
  /* The flying is the same for everybody: she does not change how a ship moves,
     what it is alongside, or which way a thruster points. */
  assert.deepEqual(O.burnFrame(green.ship.r, green.ship.v), O.burnFrame(crewed.ship.r, crewed.ship.v),
    'the frame is the same with or without her');
  assert.equal(S.alongside(green)?.id, S.alongside(crewed)?.id, 'she decides what the ship is beside');
  /* What she brings is the two numbers, and the docking they make possible. */
  assert.equal(S.rendezvous(green).instruments, false);
  assert.equal(S.rendezvous(crewed).instruments, true);
  const rv = S.rendezvous(crewed);
  assert.ok(Number.isFinite(rv.atIntercept) && Number.isFinite(rv.speed), 'both readouts are numbers');
  assert.equal(S.canDockDrifting(green), false);
  assert.equal(S.canDockDrifting(crewed), true);
});

/* ------------------------------------------------- the search's shortcuts */

test('a parking orbit is one leg that goes round for ever, and costs nothing to fly', () => {
  /* The opening orbit sits between Tassel's air and the moons' rails, so the
     kernel can prove nothing ever ends it. Before it could, the boundary
     search crept round that orbit forty thousand laps a season: a 900-day
     plan took three quarters of a second and gave up part way. */
  const g = S.newGame(1); S.undock(g);
  const b = world.get(g.ship.body);
  assert.ok(O.coastStable(world, b, g.ship.r, g.ship.v, g.t, {}), 'the opening orbit reaches nothing');
  const legs = O.predictLegs(world, g.ship, g.t, [], { maxTime: 900 });
  assert.equal(legs.segments.length, 1);
  assert.equal(legs.segments[0].reason, 'stable');
  assert.ok(legs.stable);
  /* And the old question — N days of road — is answered by that one leg too. */
  const pred = O.predict(world, g.ship, g.t, [], 900, {});
  assert.equal(pred.segments.length, 1, `a 900-day plan of a parking orbit is one leg, not ${pred.segments.length}`);
  assert.notEqual(pred.segments[0].reason, 'partial', 'the search gave up');
});

test('the shortcuts in the boundary search agree with the exhaustive search', () => {
  /* Random conics round every world with something to run into, each asked
     the same question two ways: with the reachability tests, the solved
     crossings and the skipped laps, and with none of them. Same event, same
     world, same moment — or a shortcut has ruled out something real. */
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const parents = BODIES.filter(b => b.mu > 0 && (world.wells(b.id).length || b.soi != null));
  let compared = 0;
  for(let k = 0; k < 160; k++){
    const body = parents[Math.floor(rnd() * parents.length)];
    const floor = Math.max(body.radius ?? 0, body.atmo ?? 0);
    const lr = Math.log(floor * 1.05), hr = Math.log((body.soi ?? 3) * 0.98);
    const rad = Math.exp(lr + rnd() * (hr - lr));
    const th = rnd() * O.TAU;
    const r = [rad * Math.cos(th), rad * Math.sin(th)];
    const speed = Math.sqrt(body.mu / rad) * (0.2 + rnd() * 1.4);
    const ang = th + Math.PI / 2 + (rnd() - 0.5) * 1.2 * (rnd() < 0.5 ? 1 : -1);
    const v = [speed * Math.cos(ang), speed * Math.sin(ang)];
    const t0 = rnd() * 400;
    const el = O.elementsFromState(body.mu, r, v, floor);
    const span = Number.isFinite(el.period) ? Math.min(60, el.period * (1 + rnd() * 25)) : 60;
    const opts = { atmosphere: rnd() < 0.5 };
    const slow = O.nextEvent(world, body, r, v, t0, span, { ...opts, exhaustive: true });
    const fast = O.nextEvent(world, body, r, v, t0, span, opts);
    if(slow && slow.kind === 'timeout'){
      // The exhaustive search gave up; the shortcuts may see further but never earlier than the truth.
      if(fast && fast.kind !== 'timeout') assert.ok(fast.dt >= slow.dt - 1e-5, `${body.id}: shortcut found something before the exhaustive search had looked`);
      continue;
    }
    compared++;
    const key = e => e ? (e.kind === 'timeout' ? 'timeout' : e.kind + (e.into ? ':' + e.into.id : '')) : 'none';
    if(key(fast) === 'timeout'){
      assert.ok(!slow || fast.dt <= slow.dt + 2e-5, `${body.id}: the shortcut search ran past the event`);
      continue;
    }
    assert.equal(key(fast), key(slow), `${body.id} r=${rad.toExponential(2)} e=${el.e.toFixed(3)}: different event`);
    if(slow) assert.ok(Math.abs(fast.dt - slow.dt) <= 2e-5, `${body.id}: ${key(slow)} at ${slow.dt} vs ${fast.dt}`);
  }
  assert.ok(compared > 100, `only ${compared} comparisons had an answer to compare`);
});

/* ------------------------------------------------- collecting what is owed */

test('finishing a job frees the slot; collecting it pays', () => {
  const s = S.newGame(5);
  s.money = 0; s.rep.emberkin = 0;
  s.keys.astrolabe = true;                 // heavystuff leaves Tassel's sky
  s.dockedAt = 'slate'; s.justLeft = null;
  assert.ok(S.acceptQuest(s, 'heavystuff').ok);
  const before = { money: s.money, rep: s.rep.emberkin };
  s.dockedAt = 'cinder';
  S.tick(s, 0.01);

  const l = s.quests.find(x => x.id === 'heavystuff');
  assert.equal(l.done, true, 'the work is over');
  assert.equal(l.claimed, false, 'and nothing has been handed over');
  assert.equal(s.money, before.money, 'the purse did not move');
  assert.equal(s.rep.emberkin, before.rep, 'nor the standing');
  /* The slot comes back at once: waiting to be paid must never cost a berth. */
  assert.equal(S.activeQuests(s).some(x => x.id === 'heavystuff'), false);
  assert.equal(S.unclaimedQuests(s).length, 1);

  const r = S.claimQuest(s, 'heavystuff');
  assert.ok(r.ok);
  assert.equal(r.pay, S.questById('heavystuff').pay);
  assert.equal(s.money, before.money + r.pay);
  assert.ok(s.rep.emberkin > before.rep);
  assert.equal(S.unclaimedQuests(s).length, 0);

  /* And only once, however many times the button is pressed. */
  const again = S.claimQuest(s, 'heavystuff');
  assert.equal(again.ok, false);
  assert.equal(s.money, before.money + r.pay, 'a second press paid twice');
});

test('a job that is not finished cannot be collected', () => {
  const s = S.newGame(5);
  s.keys.astrolabe = true;
  s.dockedAt = 'slate'; s.justLeft = null;
  assert.ok(S.acceptQuest(s, 'heavystuff').ok);
  const purse = s.money;
  assert.equal(S.canClaimQuest(s, 'heavystuff').ok, false);
  assert.equal(S.claimQuest(s, 'heavystuff').ok, false);
  assert.equal(s.money, purse);
  assert.equal(S.claimQuest(s, 'nosuchjob').ok, false, 'and neither can one that does not exist');
});

test('a save from before collecting was a thing is not paid twice', () => {
  /* Everything finished in an old save has already been paid for. Restoring it
     as unclaimed would hand every purse over a second time. */
  const s = S.newGame(5);
  s.keys.astrolabe = true;
  s.dockedAt = 'slate'; s.justLeft = null;
  S.acceptQuest(s, 'heavystuff');
  s.dockedAt = 'cinder';
  S.tick(s, 0.01);
  S.claimQuest(s, 'heavystuff');
  const old = JSON.parse(S.serialize(s));
  for(const l of old.quests) delete l.claimed;          // as an older save had it
  const back = S.restore(JSON.stringify(old));
  for(const l of back.quests){
    if(l.done) assert.equal(l.claimed, true, `${l.id} came back owing a reward it was already paid`);
  }
  assert.equal(S.unclaimedQuests(back).length, 0);
});

test('the ship wears the same direction arrow its worlds do', () => {
  const R = readFileSync(new URL('../public/orbital-trader/render.js', import.meta.url), 'utf8');
  assert.match(R, /function shipLead\(/, 'the ship has no lead of its own');
  assert.match(R, /drawShip\(chart, view, pos\)/, 'drawShip cannot reach the body positions it needs');
  /* Built the same way a rail's is — a short arc forward and an arrowhead — so
     the two read as the same mark rather than two different ideas. */
  const lead = R.slice(R.indexOf('function shipLead('), R.indexOf('function drawShip('));
  assert.match(lead, /propagate\(/, 'the lead is not flown forward from the ship\'s own state');
  assert.match(lead, /Math\.atan2\(-end\.v\[1\], end\.v\[0\]\)/, 'the head does not point along the motion');
  assert.match(lead, /view\.docked/, 'a tied-up ship still draws a heading');
});

test('opening a burn holds the clock, and closing it gives the clock back', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  /* The hold used to apply only inside twenty-five seconds of the burn, which
     is backwards: a mark months out is the one you sit and nudge. */
  const hold = PLAY.slice(PLAY.indexOf('function holdForPlanning('), PLAY.indexOf('/* Frame what the chart is drawing'));
  assert.doesNotMatch(hold, /if\(realSecondsTo\(n\.t\) > PLAN_HOLD_SECONDS\) return;/,
    'the clock still runs while a burn far enough out is being edited');
  assert.match(hold, /heldForPlan = true/, 'nothing records that the clock was held for planning');
  assert.match(PLAY, /function releasePlanHold\(\)/, 'closing a burn never gives the clock back');
  assert.match(PLAY, /function selectNode\(ix\)/, 'selection does not go through one place');
  /* The ways in and out of an open burn that a player actually uses: tapping a
     mark's ring, closing it, deleting it, and Escape. Each has to go through
     selectNode, or that one will leave the clock stopped for good. */
  for(const [what, pattern] of [
    ['tapping a mark', /selectNode\(selectedNode === hit\.index \? -1 : hit\.index\)/],
    ['the close button', /closenode\(\)\{ selectNode\(-1\)/],
    ['deleting one', /delnode\(i\)\{ S\.removeNode\(state, Number\(i\)\); selectNode\(-1\)/],
    ['Escape', /if\(selectedNode >= 0\)\{ selectNode\(-1\)/],
  ]) assert.match(PLAY, pattern, `${what} does not go through selectNode`);
});

test('an uncollected reward flashes the ship button, and the button goes to the log', () => {
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  /* A job can finish mid-coast with the menus shut: nothing else on the page
     would say so, which is the whole reason the button has to. */
  assert.match(PLAY, /#m-ship\.owed\{[^}]*animation:owedflash/, 'the ship button has no flash to wear');
  assert.match(PLAY, /@keyframes owedflash\{/, 'and the flash is not defined');
  /* The same bargain the mooring ring makes under this preference: keep the
     glow that says "press me", drop the breathing. */
  const noMotion = PLAY.slice(PLAY.indexOf('#panel, .toast{ transition:none; animation:none; }'));
  assert.match(noMotion.slice(0, noMotion.indexOf('\n  }')), /#m-ship\.owed\{ animation:none; box-shadow:/,
    'the flash strobes at a player who asked for no motion');

  const refresh = PLAY.slice(PLAY.indexOf('function refreshOwedFlash('), PLAY.indexOf('function renderTabs('));
  assert.match(refresh, /S\.unclaimedQuests\(state\)\.length > 0/, 'the flash is not keyed on a reward being owed');
  assert.match(refresh, /classList\.toggle\('owed', owed\)/, 'nothing puts the class on the button');
  /* Driven from the frame loop rather than from a menu opening, or a job that
     finishes while the panel is shut would light nothing until something else
     happened to redraw the buttons. */
  const hud = PLAY.slice(PLAY.indexOf('function renderHud(docking){'), PLAY.indexOf("$('h-dv').textContent"));
  assert.match(hud, /refreshOwedFlash\(\)/, 'the flash is never refreshed as the game runs');

  /* And the promise the flash makes: pressing it opens the log, not whichever
     tab was last up. Once the log is open it is a plain toggle again. */
  const open = PLAY.slice(PLAY.indexOf('function openMenu(which){'), PLAY.indexOf('function refreshMenuButtons('));
  assert.match(open, /if\(which === 'ship' && !onOwedLog\(\) && S\.unclaimedQuests\(state\)\.length\)\{/,
    'the ship button does not go to the log when a reward is waiting');
  assert.match(open, /tab = 'quests';\s*\n\s*renderTabs\(\); setTab\('quests'\);/, 'and does not actually land on the quest tab');
  assert.ok(open.indexOf("which === 'ship' && !onOwedLog()") < open.indexOf('togglePanel(false)'),
    'the toggle-shut runs first, so the flashing button just closes the panel');

  /* Both helpers are function declarations: refreshOwedFlash is called from
     renderHud and from togglePanel, both written above where they live. */
  assert.match(PLAY, /function onOwedLog\(\)\{/, 'onOwedLog is not hoisted and will be read before it exists');
});

/* --------------------------------------------- the parking orbit's apsides */

test('a parking orbit has a low point and a high point that stay where they are', () => {
  /* The bug this is here for: on an exact circle the two apsides are the same
     distance out, so which is which came down to the last bit of a floating
     point number, and the chart's "Low" and "High" marks swapped sides of the
     world every few frames. A parking orbit is now a hair off a circle so the
     question has an answer. */
  const s = undockedAt(3);
  const b = world.get('tassel');
  const first = O.elementsFromState(b.mu, s.ship.r, s.ship.v);
  assert.ok(first.e > 1e-7, `a circle has no answer to give: e is ${first.e}`);
  assert.ok(first.ra - first.rp > 0, 'and the two apsides are different distances out');

  /* Fly a whole lap and the apsis line has not moved. Sampled often enough to
     have caught the flip, which happened frame to frame. */
  let worst = 0;
  for(let i = 0; i < 120; i++){
    S.tick(s, first.period / 120);
    const now = O.elementsFromState(b.mu, s.ship.r, s.ship.v);
    let d = now.omega - first.omega;
    while(d > Math.PI) d -= 2 * Math.PI;
    while(d < -Math.PI) d += 2 * Math.PI;
    worst = Math.max(worst, Math.abs(d));
  }
  assert.ok(worst < 1e-3, `the low point wandered ${(worst * 180 / Math.PI).toFixed(1)} degrees round the orbit`);
});

test('and the wobble that buys it is too small to see or to matter', () => {
  for(const id of ['tassel', 'veyra', 'cinder', 'grumm']){
    const b = world.get(id);
    if(!(b.mu > 0) || !b.dockAlt) continue;
    const s = undockedAt(3, id);
    const el = O.elementsFromState(b.mu, s.ship.r, s.ship.v);
    /* A hundredth of a pixel on a chart that fills the screen with the orbit:
       the whole spread from low to high is a ten-thousandth of the radius. */
    assert.ok((el.ra - el.rp) / el.a < 1e-4, `${id}: the orbit is visibly an ellipse`);
    /* Both marks round to the same altitude, so the two labels agree. */
    const km = x => Math.round((x - b.radius) * 1.496e8);
    assert.equal(km(el.rp), km(el.ra), `${id}: the low and high marks read different altitudes`);
    /* And it still fits in the harbour, which is the thing a parking orbit is
       for — at Tassel the mouth is only a per cent above the mooring. */
    assert.ok(el.ra <= b.zoneRadius, `${id}: the high point is outside the harbour mouth`);
    assert.ok(el.rp > Math.max(b.radius, b.atmo ?? 0), `${id}: the low point is in the ground or the air`);
    assert.ok(S.dockingStatus(s) === null || S.dockingStatus(s).port === id, `${id}: cannot be tied up at any more`);
  }
});

/* ------------------------------------------------- waiting, during a lesson */

test('a world\'s ring cannot be tapped to wait while the lesson is running', () => {
  /* Tapping the ring a world travels on asks the clock to wait until it gets
     there. It is a real move and the chart offers it everywhere — but it is
     not the move any card is asking for, and a beginner who taps a ring while
     reading about their own orbit gets a confirmation about somewhere they
     have never been and a clock that runs off with them. */
  const PLAY = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(PLAY, /S\.tutorialRunning\(state\) \? null : chart\.nearestRailPoint\(/,
    'the rail tap is not gated on the lesson');
  /* The road's own warp is not gated: "tap your path past the burn and choose
     Warp here" is a card in the lesson, so that one has to keep working. */
  assert.match(PLAY, /const p = prediction && !state\.dockedAt \? chart\.nearestPathPoint\(/,
    'the path tap should be untouched');
});

/* ------------------------------------------- marks land on the road they mark */

test('a mark on the road is drawn on the road, in every frame the road crosses', () => {
  /* The ring that shows which bit of road you just tapped, and the flame for a
     burn, are placed against the leg they fall on. A leg inside a moon's reach
     is drawn where the moon *will be* when the ship gets there, not where the
     moon is now — the road has always known that and the marks did not, so
     tapping the planned road past a crossing put the ring fifteen hundred
     pixels off the line it belonged to. */
  const chart = stubChart(900, 700);
  try{
    /* Moss rather than Slate: the road to Moss crosses into its reach on the
       lap the chart draws, and the chart only ever draws what happens on the
       lap in front of you — see CHART_LAPS. */
    const s = S.newGame(1); S.undock(s); s.dv = s.tank = 0.01;
    assert.ok(S.trimToTarget(s, 'moss').ok, 'could not aim at Moss');
    const pred = S.planImmediate(s, true, {});
    const frames = new Set(pred.segments.map(sg => sg.body));
    assert.ok(frames.size > 1, `this road never leaves ${[...frames]} — it proves nothing`);

    chart.camera.follow = 'tassel'; chart.camera.zoom = 3e7;
    chart.camera.anchor = [...O.absState(world, 'tassel', s.t).r]; chart.settle();
    chart.draw({ t: s.t, now: 0, shipAbs: { r: S.shipAbsPos(s), v: S.shipAbsVel(s) }, shipBody: s.ship.body,
      prediction: pred, nodes: s.nodes, nodePositions: s.nodes.map(n => locateOnPrediction(world, pred, n.t)),
      selectedNode: -1, apses: [], railCrossings: [] });

    const pos = new Map(world.bodies.map(b => [b.id, O.absState(world, b.id, s.t)]));
    const anchors = pathAnchors(pred, pos);
    let checked = 0;
    for(const { seg, screenPts } of chart.hits.pathSegs){
      const i = Math.floor(screenPts.length / 2);
      const at = locateOnPrediction(world, pred, seg.times[i]);
      assert.ok(at, 'a moment on a drawn leg is not on the road');
      // Exactly the sum drawTapMark and drawNodes do.
      const mark = chart.toScreen(O.add(anchors[at.segIndex] ?? pos.get(at.body).r, at.r));
      const miss = Math.hypot(mark[0] - screenPts[i][0], mark[1] - screenPts[i][1]);
      assert.ok(miss < 1, `${seg.body}/${seg.reason}: the mark is ${miss.toFixed(0)} px off the line it marks`);
      checked++;
    }
    assert.ok(checked >= 3, `only ${checked} legs were drawn`);
  }finally{ chart.restore(); }
});

/* ------------------------------------- the road only shows the lap in front */

test('an orbit that overlaps a moon\'s rail is not marked with a meeting laps away', () => {
  /* An orbit whose high point is out past Slate's rail crosses that rail twice
     a lap, and meets Slate itself on some later lap. A leg is drawn as one lap
     however many it runs for — fifty turns of the same ellipse on top of one
     another is a scribble, not a road — so the door and the crosshair for a
     meeting four laps out were being painted onto the single lap the chart
     drew. The picture said "just there" and the clock said four days; a warp
     tapped beside the mark went to the first lap and nothing happened, and one
     tapped on the mark went most of a year. */
  const b = world.get('tassel'), slate = world.get('slate');
  const s = S.newGame(1); S.undock(s); s.dv = s.tank = 0.02;
  const rp = b.dockAlt, ra = slate.a * 1.35, a = (rp + ra) / 2;
  s.ship = { body: 'tassel', r: [rp, 0], v: [0, Math.sqrt(b.mu * (2 / rp - 1 / a))] };
  const el = O.elementsFromState(b.mu, s.ship.r, s.ship.v);
  assert.ok(el.rp < slate.a && el.ra > slate.a, 'this orbit does not overlap Slate after all');

  const pred = S.planImmediate(s, true, {});
  const road = pred.end - s.t;
  assert.ok(road <= el.period * 1.001, `the drawn road runs ${(road / el.period).toFixed(2)} laps`);
  for(const e of pred.events){
    assert.ok(e.t - s.t <= road + 1e-9, `${e.kind} is marked at +${(e.t - s.t).toFixed(1)} d, past the end of the road`);
  }
  assert.equal(pred.intercept, null, 'a meeting several laps away is marked as though it were this lap');

  /* What is left is the thing a pilot actually lines one of these up with: the
     rail crossings, on the lap in front of them. */
  const rc = railCrossings(world, pred, s.t, { minLead: S.MIN_LEAD, limit: 8 });
  assert.ok(rc.length > 0, 'and nothing is left to line the meeting up with');
  for(const c of rc) assert.ok(c.t - s.t <= road + 1e-9, 'a rail crossing is off the end of the drawn road');
});

test('nor with one on the very next lap, which is still not this lap', () => {
  /* The bound was two laps, on the reasoning that the next lap round is nearly
     here. It is not: the leg is *drawn* as one lap, so a meeting on the second
     is painted on the first, and the picture says "just there" while the clock
     says a lap and a half.

     And under the two laps was a floor of two days, left over from the default
     look, which in front of a small lap count is not a floor but an override.
     A Tassel parking orbit pushed out past Slate has a period of about a day,
     so two days was between two and four laps and the cap never bit at all:
     measured across this family of orbits, twenty-four marks were being drawn
     between 1.07 and 4.80 laps out. */
  const b = world.get('tassel'), slate = world.get('slate');
  /* Find one whose meeting really is on the second lap, by asking the
     unbounded search — the one the flight itself flies by — where it is. */
  let found = null;
  for(let k = 1.30; k <= 1.42 && !found; k += 0.002){
    const s = S.newGame(1); S.undock(s); s.nodes = []; s.dv = s.tank = 0.02;
    const r0 = b.dockAlt;
    s.ship = { body: 'tassel', r: [r0, 0], v: [0, Math.sqrt(b.mu / r0) * k] };
    const el = O.elementsFromState(b.mu, s.ship.r, s.ship.v);
    if(!Number.isFinite(el.period) || !(el.ra > slate.a)) continue;
    const far = S.plan(s, el.period * 6);
    const door = far.events.find(e => e.kind === 'soi' && e.to === 'slate');
    if(!door) continue;
    const laps = (door.t - s.t) / el.period;
    if(laps > 1.05 && laps < 2) found = { s, el, laps };
  }
  assert.ok(found, 'no orbit in this family meets Slate on its second lap');

  const pred = S.planImmediate(found.s, true, {});
  assert.equal(pred.intercept, null,
    `a meeting ${found.laps.toFixed(2)} laps out is marked as though it were this lap`);
  assert.ok(!pred.events.some(e => e.kind === 'soi'),
    'and its door is drawn on the lap in front of the pilot');
  assert.ok(pred.end - found.s.t <= found.el.period * 1.001,
    'the road ran past the lap it draws');
});

test('but a moon the road reaches on the lap in front of you still is', () => {
  // The other half: the bound above must not have thrown the real ones away.
  const s = S.newGame(1); S.undock(s); s.dv = s.tank = 0.01;
  assert.ok(S.trimToTarget(s, 'moss').ok);
  const pred = S.planImmediate(s, true, {});
  assert.ok(pred.events.some(e => e.kind === 'soi' && e.to === 'moss'), 'the door into Moss is gone');
  assert.ok(pred.intercept && pred.intercept.body === 'moss', 'the encounter at Moss is gone');
});

/* ------------------------------------------- what the drawn line is made of */

test('a fast flyby is drawn finely where it bends, not where it is slow', () => {
  /* The chart sampled a leg at equal steps of *time*. On anything eccentric
     the ship covers most of its arc in a small part of its time — a flyby
     spends two days crawling in and minutes whipping round the bottom — so
     equal time steps put almost no points at the periapsis, which is the only
     part that bends and the one a pilot aims. Measured on this very flyby: two
     points either side of the low point a hundred and sixty thousand
     kilometres apart, across a periapsis eight thousand kilometres up. The
     chart drew a straight line through the manoeuvre. */
  const g = world.get('grumm');
  const s = S.newGame(4); S.undock(s); s.nodes = []; s.keys.heatShield = true;
  const rp = g.radius + (g.atmo - g.radius) * 0.55, r0 = g.soi * 0.95;
  const vInf = 1.2 * Math.sqrt(g.mu / rp), vp = Math.sqrt(vInf * vInf + 2 * g.mu / rp);
  const h = rp * vp, v0 = Math.sqrt(vInf * vInf + 2 * g.mu / r0), vt = h / r0;
  s.ship = { body: 'grumm', r: [r0, 0], v: [-Math.sqrt(Math.max(0, v0 * v0 - vt * vt)), vt] };
  const seg = S.planImmediate(s, true, {}).segments[0];
  assert.ok(!Number.isFinite(seg.elements.period), 'this leg is meant to be a hyperbola');

  const pts = seg.points, ts = seg.times;
  // Every sample is on the real path, not near it.
  for(let i = 0; i < pts.length; i++){
    const truth = O.propagate(g.mu, seg.r0, seg.v0, ts[i] - seg.t0).r;
    assert.ok(O.dist(pts[i], truth) < seg.elements.rp * 1e-6, `sample ${i} is off the path`);
  }
  // And the line between them does not cut the corner at the bottom.
  let worst = 0;
  for(let i = 1; i < pts.length; i++){
    const tm = (ts[i - 1] + ts[i]) / 2;
    const mid = [(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2];
    const truth = O.propagate(g.mu, seg.r0, seg.v0, tm - seg.t0).r;
    worst = Math.max(worst, O.dist(mid, truth) / O.norm(truth));
  }
  assert.ok(worst < 0.01, `the drawn line strays ${(worst * 100).toFixed(2)}% of the way to the world it is bending round`);

  /* The point of all that: the low point is drawn where it really is, so a
     burn nudged against it moves something a player can see. */
  let closest = Infinity;
  for(const p of pts) closest = Math.min(closest, O.norm(p));
  assert.ok(Math.abs(closest - seg.elements.rp) < seg.elements.rp * 1e-4,
    `the drawn low point is ${((closest - seg.elements.rp) * 1.474e8).toFixed(0)} km off the real one`);
});

test('a transfer that just touches a rail is marked where it touches', () => {
  /* A Hohmann does not cut the orbit it is aimed at, it grazes it: the apsis
     touches and turns back, so there is no change of sign to find. The mark
     was only ever appearing by floating-point luck in the old coarse sampling,
     and sampling the curve properly took the luck away. */
  const g = S.newGame(5);
  g.dockedAt = null; g.justLeft = null; g.t = 0;
  const from = O.absState(world, 'tassel', 0), mu = world.get('lamp').mu;
  const r1 = O.norm(from.r), toR = world.get('veyra').a;
  g.ship = { body: 'lamp', r: [...from.r],
    v: O.scale(O.unit(from.v), Math.sqrt(mu / r1) * Math.sqrt(2 * toR / (r1 + toR))) };
  const list = railCrossings(world, S.planImmediate(g), g.t, { minLead: S.MIN_LEAD, limit: 8 });
  const veyra = list.filter(c => c.body === 'veyra');
  assert.equal(veyra.length, 1, `the graze is marked ${veyra.length} times, not once`);
  assert.ok(Math.abs(O.norm(veyra[0].r) - toR) < toR * 1e-6, 'and the mark is not on the rail it grazes');
  // And nothing is marked for a rail the road never reaches.
  for(const c of list){
    const b = world.get(c.body);
    const railR = b.e ? b.a * (1 - b.e * b.e) / (1 + b.e * Math.cos(Math.atan2(c.r[1], c.r[0]) - (b.omega ?? 0))) : b.a;
    assert.ok(Math.abs(O.norm(c.r) - railR) < Math.max(1e-9, railR * 1e-6), `${b.name}: the mark is not on its rail`);
  }
});

/* ------------------------------------------------------------- music */

/* The tracks are data the scheduler walks, and every way of getting a note
 * wrong fails the same silent way: an exception inside a setInterval, in a
 * console nobody has open, and a page that is simply quiet. So the shape is
 * checked here rather than by listening.
 */
test('every track is playable data rather than a silent typo', () => {
  assert.ok(SONGS.flight && SONGS.port, 'the sky and the port each need a theme');
  for(const [name, song] of Object.entries(SONGS)){
    const where = `track "${name}"`;
    assert.ok(song.bpm > 40 && song.bpm < 220, `${where}: ${song.bpm} bpm is not a tempo`);
    assert.ok(Array.isArray(song.bars) && song.bars.length, `${where}: no bars`);
    assert.ok(!song.arpEvery || song.arpEvery >= 1, `${where}: the arpeggio would divide by zero`);
    assert.ok(Array.isArray(song.brushAt) && Array.isArray(song.tickAt), `${where}: percussion is a list of steps`);
    for(const bar of song.bars){
      const [root, quality] = bar.chord;
      assert.ok(QUALITIES[quality], `${where}: unknown chord quality "${quality}"`);
      assert.ok(root > 20 && root < 100, `${where}: root ${root} is off the keyboard`);
    }
    const steps = song.bars.length * 16;
    for(const [at, note, len] of song.lead){
      assert.ok(at >= 0 && at < steps, `${where}: a note at step ${at} never plays (${steps} steps)`);
      assert.ok(note > 20 && note < 120, `${where}: note ${note} is off the keyboard`);
      assert.ok(len > 0, `${where}: a note of length ${len} is silence`);
    }
    for(const [at, semis, len] of song.bass){
      assert.ok(at >= 0 && at < 16, `${where}: a bass note at step ${at} of a sixteen-step bar`);
      assert.ok(semis >= -12 && semis <= 24, `${where}: bass interval ${semis} is nowhere near the root`);
      assert.ok(len > 0, `${where}: a bass note of length ${len} is silence`);
    }
    for(const s of [...song.brushAt, ...song.tickAt]) assert.ok(s >= 0 && s < 16, `${where}: a hit at step ${s} of sixteen`);
  }
});

/* The two settings live in the browser, not in the save: how loud a game is
   is a fact about the room, and it should survive a new ship. */
test('music preferences round-trip through a store and shrug off a bad one', () => {
  const mem = new Map();
  const st = { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, v) };
  assert.deepEqual(readMusicPrefs(st), { on: true, level: 0.7 }, 'nothing stored is the defaults');
  assert.ok(writeMusicPrefs({ on: false, level: 0.25 }, st));
  assert.deepEqual(readMusicPrefs(st), { on: false, level: 0.25 });
  writeMusicPrefs({ on: 'yes', level: 4 }, st);
  assert.deepEqual(readMusicPrefs(st), { on: true, level: 1 }, 'a level past the top is the top');
  mem.set(MUSIC_KEY, 'not json');
  assert.deepEqual(readMusicPrefs(st), { on: true, level: 0.7 }, 'garbage in the store is the defaults, not a throw');
  mem.set(MUSIC_KEY, JSON.stringify({ level: 'loud' }));
  assert.deepEqual(readMusicPrefs(st), { on: true, level: 0.7 }, 'a field of the wrong kind is its default');
  const broken = { getItem(){ throw new Error('blocked'); }, setItem(){ throw new Error('blocked'); } };
  assert.deepEqual(readMusicPrefs(broken), { on: true, level: 0.7 });
  assert.equal(writeMusicPrefs({ on: true, level: 0.5 }, broken), false);
});

/* Without a window there is no AudioContext, and the engine has to be a
   quiet object rather than a thrown error — the page builds it before the
   first gesture, and a private window may never grant one. */
test('the engine remembers what it was asked for while it cannot play', () => {
  const mem = new Map();
  const st = { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, v) };
  const audio = createAudio({ store: st });
  assert.equal(audio.isOn(), true);
  assert.equal(audio.current(), null);
  audio.play('flight');
  audio.unlock();                                  // no AudioContext here: nothing to build
  assert.equal(audio.isRunning(), false);
  assert.equal(audio.current(), null, 'nothing plays without a context');
  audio.setLevel(0.3);
  audio.setOn(false);
  assert.deepEqual(readMusicPrefs(st), { on: false, level: 0.3 }, 'the switch and the slider are written down');
  audio.setOn(true);
  audio.hidden(true); audio.hidden(false);
  audio.stop();
  assert.equal(audio.current(), null);
});

test('the play page has the music, and its controls are in the gear menu', () => {
  const html = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(html, /import \{ createAudio \} from '\.\/audio\.js'/);
  assert.match(html, /data-gtab="sound"/, 'a Sound tab in the settings menu');
  assert.match(html, /id="gear-music"/, 'a switch for the music');
  assert.match(html, /id="gear-level"[^>]*type="range"|type="range"[^>]*id="gear-level"/, 'a volume slider');
  assert.match(html, /audio\.play\(/, 'the page asks for a track');
  assert.match(html, /audio\.stop\(\)/, 'and lets go of it when the page goes');
});

/* ---------------------------------------------- crew dialog: who is missing */

/* An exchange that turns to somebody not aboard says its other thing instead:
   the `without` lines, which point at where that person would be found. The
   whole table keeps that promise, so a player with an empty chair is never
   shown a silence where a hint was possible. */
const FOUND_AT = { engineer: 'Cinder', navigator: 'Nail', appraiser: 'Brine' };
const leansOn = x => [...new Set([...(x.needs ?? []), ...(x.lines ?? []).map(l => l.who)])]
  .filter(id => id !== 'captain' && id !== x.who);

test('every exchange that turns to somebody says where to find them when they are not there', () => {
  let turned = 0;
  for(const x of DIALOG){
    const others = leansOn(x);
    for(const berth of others){
      turned++;
      const lines = x.without?.[berth];
      assert.ok(lines?.length, `${x.id} needs the ${berth} and says nothing when the berth is empty`);
      for(const l of lines){
        assert.ok(l.who === x.who || l.who === 'captain', `${x.id} without ${berth}: ${l.who} might not be there to say it`);
        assert.ok(l.say, `${x.id} without ${berth}: an empty line`);
      }
      const said = lines.map(l => l.say).join(' ');
      assert.ok(said.includes(FOUND_AT[berth]), `${x.id} without ${berth}: nobody says to look at ${FOUND_AT[berth]}`);
    }
    for(const berth of Object.keys(x.without ?? {})){
      assert.ok(others.includes(berth), `${x.id}: a fallback for the ${berth}, who is not in the exchange`);
    }
  }
  assert.ok(turned >= 12, `only ${turned} exchanges turn to somebody else; the crew should talk to each other more than that`);
  // Somebody is asked after in every berth, so every empty chair gets pointed at.
  for(const berth of Object.keys(FOUND_AT)){
    assert.ok(DIALOG.some(x => x.without?.[berth]), `nothing in the table ever points at the ${berth}`);
  }
});

test('an empty chair is answered with where to look, and a filled one with the exchange itself', () => {
  const s = S.newGame(1);
  s.dockedAt = 'cinder';
  const alone = S.exchangesFor(s, 'captain');
  const standIn = alone.find(x => x.missing === 'engineer');
  assert.ok(standIn, 'the captain at Cinder with no engineer was not told where to find one');
  assert.ok(standIn.lines.every(l => l.who === 'captain'), 'the stand-in gives a line to somebody not aboard');
  assert.match(standIn.lines.map(l => l.say).join(' '), /Cinder/, 'the stand-in does not say where');
  assert.equal(standIn.without, undefined, 'a stand-in carries a fallback of its own');
  assert.ok(!alone.some(x => x.needs?.includes('engineer') && !x.missing), 'the real exchange played to an empty chair');
  // Asked twice, it is the same object: the page counts presses by list position.
  assert.equal(S.exchangesFor(s, 'captain').find(x => x.missing === 'engineer'), standIn);
  assert.equal(S.exchangeFor(s, 'captain', alone.indexOf(standIn)), standIn);

  s.crew.engineer = { role: 'engineer', from: 'test', joinedAt: 0 };
  const crewed = S.exchangesFor(s, 'captain');
  assert.ok(!crewed.some(x => x.missing), 'the engineer is aboard and still being looked for');
  const real = crewed.find(x => x.id === standIn.id.split('~')[0]);
  assert.ok(real && real.lines.some(l => l.who === 'engineer'), 'the engineer is aboard and does not get his line');
  assert.equal(crewed.length, alone.length, 'filling a berth changed how many things there are to say');

  // The crew point at each other, too: the navigator at Nail, with no engineer.
  const t = S.newGame(2);
  t.dockedAt = 'nail';
  t.crew.navigator = { role: 'navigator', from: 'test', joinedAt: 0 };
  const nav = S.exchangesFor(t, 'navigator').find(x => x.missing === 'engineer');
  assert.ok(nav, 'the navigator at Nail has nothing to say about the empty engine room');
  assert.ok(nav.lines.some(l => l.who === 'navigator') && nav.lines.every(l => S.isAboard(t, l.who)));
  // And an exchange that needs somebody else is never handed to an empty berth.
  assert.equal(S.exchangesFor(t, 'engineer').length, 0);

  // Every fallback in the table reads in the same band as every other line.
  for(const x of DIALOG) for(const lines of Object.values(x.without ?? {})) for(const l of lines){
    const ms = S.sayMs(l.say);
    assert.ok(ms >= 900 && ms <= 6500, `${x.id}: "${l.say}" reads in ${ms} ms`);
  }
});

/* ------------------------------------------------------------- events */

/* What can happen on the way. Rolled at a change of reach, once a leg at most,
   never during the lesson — and everything a choice will do is worked out when
   the card goes up, so the buttons say what they cost and a reload cannot
   re-roll a result. */
const design_events = () => design('events.json');

test('the events the game ships are the events in the table, and the table keeps to its shape', () => {
  assert.deepEqual(EVENTS, design_events().events, 'data/events.js was not rebuilt');
  assert.deepEqual(EVENT_RULES, design_events().rules);
  assert.ok(EVENT_RULES.chance > 0 && EVENT_RULES.chance <= 0.25, `a ${EVENT_RULES.chance} chance per crossing is not a small one`);
  assert.ok(EVENTS.length >= 8, 'a table this short repeats itself in an afternoon');
  const goods = new Set(GOODS.map(g => g.id)), cats = new Set(GOODS.map(g => g.category));
  for(const ev of EVENTS){
    assert.ok(ev.id && ev.title && ev.text && ev.choices?.length, `event ${ev.id} is malformed`);
    assert.ok(ev.choices.some(c => !c.requires), `${ev.id}: every choice needs something, so a ship with nothing is stuck on the card`);
    for(const c of ev.choices){
      assert.ok(c.label, `${ev.id}: a button with no word on it`);
      assert.ok(c.text || c.outcomes?.length, `${ev.id}: "${c.label}" leads nowhere`);
      if(c.outcomes) assert.ok(c.outcomes.some(o => !o.when), `${ev.id}: "${c.label}" can come to nothing`);
    }
    for(const k of [...(ev.when?.carrying ?? []), ...(ev.when?.notCarrying ?? [])]) assert.ok(goods.has(k) || cats.has(k), `${ev.id} looks for ${k}, which nothing is`);
  }
  assert.equal(new Set(EVENTS.map(e => e.id)).size, EVENTS.length, 'two events share an id');
  // The one the brief named: a Veyra hull that scans for counterfeit crests and fines you.
  const scan = EVENTS.find(e => e.id === 'veyra-scan');
  assert.ok(scan && scan.when.regions.includes('inner') && scan.when.carrying.includes('contraband'));
  assert.ok(scan.choices[0].effects.money.fraction < 0 && scan.choices[0].effects.cargo.take === 'contraband', 'the fine is not a fine');
});

test('a crossing is placed in a region by the reach it enters, or the one it leaves', () => {
  assert.equal(S.crossingRegion('tassel', 'lamp'), 'home', 'leaving Tassel is a home-system crossing');
  assert.equal(S.crossingRegion('lamp', 'grumm'), 'outer');
  assert.equal(S.crossingRegion('cinder', 'scorch'), 'inner');
  assert.equal(S.crossingRegion('lamp', 'nail'), 'belt');
  assert.equal(S.crossingRegion('grumm', 'brine'), 'outer');
});

/* A ship set up for an event: past the lesson, in the open, with a purse. */
function shipFor(region, extra = {}){
  const s = S.newGame(11);
  s.flags.tutorialDone = true;
  s.dockedAt = null; s.justLeft = null;
  s.money = 500;
  Object.assign(s, extra);
  return s;
}
const carry = (s, good, qty, more = {}) => s.cargo.push({ good, qty, t: 0, price: 0, from: null, ...more });

test('nothing happens during the lesson, and at most one thing between dockings', () => {
  const lesson = S.newGame(3);
  lesson.dockedAt = null; lesson.justLeft = null;
  assert.ok(S.tutorialRunning(lesson));
  for(let i = 0; i < 400; i++) S.rollEncounter(lesson, 'tassel', 'lamp', []);
  assert.equal(lesson.pending, null, 'an event interrupted Uncle Theo');

  const s = shipFor('home');
  let fired = 0, tries = 0;
  const events = [];
  for(let i = 0; i < 400; i++){
    if(s.pending){ fired++; s.pending = null; s.encounters.legDone = false; }
    tries++;
    S.rollEncounter(s, 'tassel', 'lamp', events);
  }
  const rate = fired / tries;
  assert.ok(rate > EVENT_RULES.chance * 0.5 && rate < EVENT_RULES.chance * 1.6, `events came up on ${(rate * 100).toFixed(0)}% of crossings against a chance of ${EVENT_RULES.chance * 100}%`);
  assert.ok(events.every(e => e.kind === 'encounter' && e.pending?.kind === 'encounter'));

  // One a leg: with the card answered but the leg not over, nothing more comes.
  const t = shipFor('home');
  for(let i = 0; i < 400 && !t.pending; i++) S.rollEncounter(t, 'tassel', 'lamp', []);
  assert.ok(t.pending, 'four hundred crossings and nothing happened');
  assert.ok(t.encounters.legDone);
  S.resolveEncounter(t, t.pending.choices.findIndex(c => !c.disabled));
  assert.equal(t.pending, null);
  for(let i = 0; i < 400; i++) S.rollEncounter(t, 'tassel', 'lamp', []);
  assert.equal(t.pending, null, 'a second event on the same leg');
  // And docking opens the next leg.
  const b = world.get('slate'); const st = O.circularState(b.mu, b.dockAlt, 0);
  t.ship = { body: 'slate', r: st.r, v: st.v };
  assert.ok(S.dock(t).ok, 'could not tie up at Slate');
  assert.equal(t.encounters.legDone, false, 'docking did not end the leg');
  // A card that is up blocks the roll, too: one thing at a time.
  const u = shipFor('home');
  u.pending = { kind: 'toll' };
  for(let i = 0; i < 200; i++) S.rollEncounter(u, 'tassel', 'lamp', []);
  assert.equal(u.pending.kind, 'toll');
});

test('an event fits a crossing by region and by what the ship is carrying', () => {
  const s = shipFor('inner');
  const fits = (id, region) => S.eventFits(s, EVENTS.find(e => e.id === id), region);
  assert.equal(fits('veyra-scan', 'inner'), false, 'a scan for contraband with none aboard');
  assert.equal(fits('veyra-scan-clean', 'inner'), true);
  carry(s, 'fakemedals', 3);
  assert.equal(fits('veyra-scan', 'inner'), true);
  assert.equal(fits('veyra-scan-clean', 'inner'), false, 'a clean scan of a hold with counterfeit medals in it');
  assert.equal(fits('veyra-scan', 'belt'), false, 'a Veyra warship in the Belt');
  assert.equal(fits('beacon', 'belt'), true, 'a beacon is anywhere');
  assert.equal(fits('flare', 'inner'), false, 'a flare with nothing cold aboard');
  carry(s, 'gel', 2);
  assert.equal(fits('flare', 'inner'), true);
  assert.equal(fits('bank-launch', 'home'), false); s.debt = 100;
  assert.equal(fits('bank-launch', 'home'), true);
  assert.equal(fits('cat-mechanic', 'belt'), false); s.hull = 2;
  assert.equal(fits('cat-mechanic', 'belt'), true);
  // Something seen is drawn less often, so a long game meets the whole table.
  const before = S.eligibleEvents(s, 'inner').find(x => x.ev.id === 'veyra-scan').weight;
  s.encounters.seen['veyra-scan'] = 2;
  assert.equal(S.eligibleEvents(s, 'inner').find(x => x.ev.id === 'veyra-scan').weight, before / 4);
});

test('the Veyra scan: crates named, the fine a number, the run greyed when the tank is short', () => {
  const s = shipFor('inner');
  carry(s, 'fakemedals', 4);
  carry(s, 'hotweapons', 1, { questId: 'x' });   // somebody's errand: never taken
  carry(s, 'steel', 2);
  s.dv = S.auDay(0.3);
  const p = S.stageEvent(s, EVENTS.find(e => e.id === 'veyra-scan'), 'inner');
  assert.equal(p.kind, 'encounter');
  const [hand, bluff, run] = p.choices;
  assert.deepEqual(hand.effects.take, [{ good: 'fakemedals', qty: 4 }], 'the consigned weapons were taken, or the steel');
  assert.ok(hand.effects.money < 0 && -hand.effects.money <= s.money * 0.6, 'the fine is not bounded by the purse');
  assert.ok(-hand.effects.money <= 400, 'the fine is over its cap');
  assert.ok(!/\{/.test(hand.text) && hand.text.includes('Counterfeit faction medals'), `the text is not filled in: ${hand.text}`);
  assert.equal(hand.effects.rep.emberkin, -1);
  assert.ok(bluff.text && bluff.effects, 'the bluff was not rolled when the card went up');
  assert.match(run.disabled, /in the tank/, 'a burn the tank cannot pay for is on offer');
  assert.equal(hand.disabled, null);

  s.pending = p;
  assert.equal(S.resolveEncounter(s, 2).ok, false, 'a greyed choice went through');
  assert.equal(S.resolveEncounter(s, 9).ok, false);
  const money = s.money, rep = s.rep.emberkin;
  const r = S.resolveEncounter(s, 0);
  assert.ok(r.ok && r.text === hand.text);
  assert.equal(s.pending, null);
  assert.equal(s.money, money + hand.effects.money);
  assert.equal(s.rep.emberkin, Math.max(0, rep - 1), 'standing went below nothing');
  assert.ok(!s.cargo.some(c => c.good === 'fakemedals'), 'the medals are still aboard');
  assert.ok(s.cargo.some(c => c.good === 'hotweapons' && c.qty === 1), 'they took a crate that was somebody else\'s');
  assert.ok(s.cargo.some(c => c.good === 'steel' && c.qty === 2), 'they took the steel');
  assert.equal(s.log.at(-1).text, hand.text, 'the outcome is not in the log');
});

test('what the other effects come to: fuel, cold cargo, a found crate, the bank, the hull, a stranger\'s thanks', () => {
  // A flare with the cold hold fitted is nothing; without it, half of what is cold.
  const cold = shipFor('inner'); carry(cold, 'gel', 3); carry(cold, 'riverfish', 1);
  const flare = EVENTS.find(e => e.id === 'flare');
  const ride = S.stageEvent(cold, flare, 'inner').choices[1];
  assert.deepEqual(ride.effects.take, [{ good: 'gel', qty: 2 }, { good: 'riverfish', qty: 1 }], 'half, rounded up, of each cold stack');
  cold.keys.tempControl = true;
  assert.equal(S.stageEvent(cold, flare, 'inner').choices[1].effects.take, undefined, 'the cold hold did not do what a cold hold is for');
  const shade = S.stageEvent(cold, flare, 'inner').choices[0];
  assert.ok(Math.abs(S.kms(shade.effects.dv) + 0.2) < 1e-9, 'shading the hold costs 200 m/s');

  // A stranger's thanks go to the people of the region.
  const belt = shipFor('belt');
  const beacon = S.stageEvent(belt, EVENTS.find(e => e.id === 'beacon'), 'belt');
  assert.deepEqual(beacon.choices[0].effects.rep, { cat: 1 });
  assert.match(beacon.choices[0].text, /The cats/);
  const deep = S.stageEvent(belt, EVENTS.find(e => e.id === 'beacon'), 'deep');
  assert.deepEqual(deep.choices[0].effects.rep, {}, 'thanks from nobody at the Maw');
  belt.pending = beacon; const dv = belt.dv;
  S.resolveEncounter(belt, 0);
  assert.ok(Math.abs(S.kms(dv - belt.dv) - 0.3) < 1e-9, 'the fuel was not handed across');
  assert.equal(belt.rep.cat, 1);

  // A crate found is a crate aboard, if there is room; otherwise the button says so.
  const crate = EVENTS.find(e => e.id === 'drift-crate');
  const room = shipFor('belt');
  room.pending = S.stageEvent(room, crate, 'belt');
  S.resolveEncounter(room, 0);
  assert.ok(room.cargo.some(c => c.good === 'hullplate' && c.qty === 1), 'the crate never came aboard');
  const full = shipFor('belt'); carry(full, 'steel', 999);
  assert.match(S.stageEvent(full, crate, 'belt').choices[0].disabled, /hold/);

  // The bank: a quarter of the purse against the debt, or five percent more owed.
  const owing = shipFor('home', { debt: 200, money: 400 });
  const bank = EVENTS.find(e => e.id === 'bank-launch');
  owing.pending = S.stageEvent(owing, bank, 'home');
  assert.equal(owing.pending.choices[0].effects.debt, -100);
  assert.match(owing.pending.choices[0].text, /100 /);
  S.resolveEncounter(owing, 0);
  assert.equal(owing.debt, 100); assert.equal(owing.money, 300);
  owing.pending = S.stageEvent(owing, bank, 'home');
  S.resolveEncounter(owing, 1);
  assert.equal(owing.debt, 105);

  // A mechanic mends a grade; the hull never goes below sound.
  const dented = shipFor('belt', { hull: 1 });
  dented.pending = S.stageEvent(dented, EVENTS.find(e => e.id === 'cat-mechanic'), 'belt');
  S.resolveEncounter(dented, 0);
  assert.equal(dented.hull, 0); assert.equal(dented.money, 440);
});

test('a save from before there were events restores with the field, and a stale card is dropped', () => {
  const s = shipFor('home');
  delete s.encounters;
  const back = S.importSave(S.exportSave(s));
  assert.deepEqual(back.encounters, { legDone: false, seen: {} });
  const t = shipFor('home');
  t.pending = { kind: 'encounter', id: 'no-such-event', title: 'x', text: 'x', choices: [] };
  assert.equal(S.importSave(S.exportSave(t)).pending, null, 'a card nothing in this build can answer');
  const u = shipFor('home');
  for(let i = 0; i < 400 && !u.pending; i++) S.rollEncounter(u, 'tassel', 'lamp', []);
  const kept = S.importSave(S.exportSave(u));
  assert.deepEqual(kept.pending, u.pending, 'a live card did not survive the save');
});

test('the play page puts an event up as a card and answers it through the sim', () => {
  const html = readFileSync(new URL('../public/orbital-trader/play.html', import.meta.url), 'utf8');
  assert.match(html, /e\.kind === 'encounter'.*showEncounter\(e\.pending\)/, 'the tick\'s event never reaches the page');
  assert.match(html, /state\.pending\?\.kind === 'encounter'\) showEncounter\(state\.pending\)/, 'a card up at save time does not come back at load');
  assert.match(html, /S\.resolveEncounter\(state, Number\(b\.dataset\.choice\)\)/, 'the page answers the card itself');
});
