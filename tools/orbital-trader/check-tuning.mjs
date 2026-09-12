#!/usr/bin/env node
/* Check the sky against the promises the design makes, and print the
 * delta-v table the README quotes. Patched-conic vis-viva arithmetic, with
 * the potential left at each sphere-of-influence edge included (the wells
 * here are big enough that ignoring it is a 15% error).
 *
 *   node tools/orbital-trader/check-tuning.mjs          check and print
 *   node tools/orbital-trader/check-tuning.mjs --write  also write dvTable/periods back into tuning.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, 'design', 'tuning.json');
const T = JSON.parse(readFileSync(file, 'utf8'));
const MU = T.constants.MU_LAMP, KMS = T.constants.KMS_PER_AU_DAY;
const by = Object.fromEntries(T.bodies.map(b => [b.id, b]));
const TAU = Math.PI * 2;
const period = (mu, a) => TAU * Math.sqrt(a ** 3 / mu);
/* The reach a mass earns, mirrored from content.js: no body carries one. */
const soiOf = b => (b.mu > 0 && b.a > 0 && by[b.parent]?.mu > 0) ? b.a * Math.pow(b.mu / by[b.parent].mu, 2 / 5) : null;
for(const b of T.bodies) b.soi = soiOf(b);
const km = v => (v * KMS);
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); if(!ok) fails++; };

/* Speed at the edge of a body's reach needed to leave with v_inf, from a
 * circular orbit at r: the burn, and the speed at the edge. */
function escapeBurn(b, r, vinf){
  const vEdge2 = vinf * vinf;                       // speed at the SOI edge equals the heliocentric delta we need
  const vAt = Math.sqrt(Math.max(0, vEdge2 - 2 * b.mu / b.soi) + 2 * b.mu / r);
  return vAt - Math.sqrt(b.mu / r);
}
/* Arriving with speed vEdge at the SOI edge, the burn at rp to end in a
 * circular orbit at rp (or, loose=true, an ellipse with apoapsis at 0.6 soi). */
function captureBurn(b, rp, vEdge, loose = false){
  const vp = Math.sqrt(Math.max(0, vEdge * vEdge - 2 * b.mu / b.soi) + 2 * b.mu / rp);
  const target = loose ? Math.sqrt(b.mu * (2 / rp - 1 / ((rp + 0.6 * b.soi) / 2))) : Math.sqrt(b.mu / rp);
  return Math.max(0, vp - target);
}
/* Heliocentric Hohmann between two circular radii: the two deltas and the time. */
function hohmann(mu, r1, r2){
  const at = (r1 + r2) / 2;
  const v1 = Math.sqrt(mu / r1), v2 = Math.sqrt(mu / r2);
  const dv1 = Math.abs(Math.sqrt(mu * (2 / r1 - 1 / at)) - v1);
  const dv2 = Math.abs(v2 - Math.sqrt(mu * (2 / r2 - 1 / at)));
  return { dv1, dv2, time: period(mu, at) / 2 };
}
/* Tessel dock -> a target around the Lamp. `arrive` decides what happens at the far end. */
function route(name, toRadius, arrive){
  const t = by.tessel;
  const h = hohmann(MU, t.a, toRadius);
  const dep = escapeBurn(t, t.dockAlt, h.dv1);
  const arr = arrive(h.dv2);
  return { route: name, dv_kms: +km(dep + arr).toFixed(1), dep_kms: +km(dep).toFixed(1), arr_kms: +km(arr).toFixed(1), days: Math.round(h.time) };
}

// --- periods and the calendar
const periods = {};
for(const b of T.bodies){ if(b.parent) periods[b.id] = +period(by[b.parent].mu, b.a).toFixed(2); }
check('C1 Tessel year is 360 days', Math.abs(periods.tessel - 360) < 0.01, `${periods.tessel}`);
check('C1 Cinder year is weeks', periods.cinder > 40 && periods.cinder < 70, `${periods.cinder} d`);
check('C1 Wanderwell 0.5-3.5 au', Math.abs(by.wanderwell.a * (1 - by.wanderwell.e) - 0.5) < 1e-9 && Math.abs(by.wanderwell.a * (1 + by.wanderwell.e) - 3.5) < 1e-9);
check('C1 comet 0.4-14 au', Math.abs(by.merrow.a * (1 - by.merrow.e) - 0.4) < 0.01 && Math.abs(by.merrow.a * (1 + by.merrow.e) - 14) < 0.01);
check('C1 Claw Rock inside the belt', by.clawrock.a > T.belt.inner && by.clawrock.a < T.belt.outer);

// --- moons inside parents, siblings apart
for(const b of T.bodies){
  if(b.kind !== 'moon') continue;
  const p = by[b.parent];
  check(`C2 ${b.id} stays inside ${p.id}`, b.a * (1 + b.e) + b.soi <= 0.8 * p.soi, `${(b.a * (1 + b.e) + b.soi).toFixed(4)} <= ${(0.8 * p.soi).toFixed(4)}`);
  for(const c of T.bodies){
    if(c.kind !== 'moon' || c.parent !== b.parent || c.id <= b.id) continue;
    const gap = Math.abs(b.a - c.a) - (b.a * b.e + c.a * c.e);
    check(`C3 ${b.id}/${c.id} apart`, gap >= 1.25 * (b.soi + c.soi), `${gap.toFixed(4)} >= ${(1.25 * (b.soi + c.soi)).toFixed(4)}`);
  }
}
check('C4 Cinder and Wanderwell never nest', by.cinder.soi + by.wanderwell.soi < 0.2);

// --- port geometry and speeds
for(const b of T.bodies){
  if(!b.port) continue;
  if(b.mu > 0){
    check(`C5 ${b.id} radius < dockAlt < zone <= soi/3`, b.radius < b.dockAlt && b.dockAlt < b.zoneRadius && b.zoneRadius <= b.soi / 3 + 1e-12, `${b.radius} < ${b.dockAlt} < ${b.zoneRadius} <= ${(b.soi / 3).toFixed(5)}`);
    const vc = Math.sqrt(b.mu / b.dockAlt);
    check(`C6 ${b.id} parked speed`, km(vc) < 20, `${km(vc).toFixed(2)} km/s`);
    const esc = Math.sqrt(b.mu * (2 / b.dockAlt - 1 / ((b.dockAlt + b.soi) / 2))) - vc;
    /* Leaving a world's reach should never eat the tank. Moons and the Arc are
       pocket change; planets are allowed more, and Chime — the endgame world —
       the most, because getting off it again is meant to be a journey. */
    const limit = b.kind === 'moon' || b.kind === 'station' ? 1.5 : b.id === 'chime' ? 6 : 4;
    check(`C6 ${b.id} leaving its reach`, km(esc) < limit, `${km(esc).toFixed(2)} km/s`);
    // Falling in from rest at the edge and docking: the excess over a parked orbit.
    const vfall = Math.sqrt(2 * b.mu * (1 / b.dockAlt - 1 / b.soi));
    const excess = vfall - vc;
    if(b.kind === 'moon' || b.kind === 'station') check(`C6 ${b.id} docking brake from a co-orbital fall`, excess <= b.dockSpeed * 1.6, `${km(excess).toFixed(2)} km/s over parked, limit ${km(b.dockSpeed).toFixed(2)}`);
  }else{
    check(`C5 ${b.id} is a zone with a mouth`, b.zoneRadius > 0 && b.soi == null);
  }
}

/* --- the orbit a new game opens in, and the clock that is tuned to it.
   Low means what a pilot means by it: the high point of the orbit sits less
   than one planet-diameter above the ground. The clock then has one job — a
   lap of that orbit is ten real minutes at x1 — and the skip cap has to move
   with it, or pointing at the Lantern stops being ten seconds. */
const START_LAP_SECONDS = 600;
for(const b of T.bodies){
  if(b.startAlt == null) continue;
  const alt = b.startAlt - b.radius;
  check(`C12 ${b.id} opens in a low orbit`, alt > 0 && alt < 2 * b.radius, `apoapsis altitude ${alt.toFixed(6)} au < diameter ${(2 * b.radius).toFixed(6)} au`);
  check(`C12 ${b.id}'s start orbit clears the harbour it is under`, b.startAlt < b.dockAlt, `${b.startAlt} < ${b.dockAlt}`);
  const lap = period(b.mu, b.startAlt);
  const seconds = lap / T.constants.BASE_RATE_DAYS_PER_SEC;
  check(`C12 a lap of ${b.id}'s start orbit is ten real minutes at x1`, Math.abs(seconds - START_LAP_SECONDS) < 0.5, `${seconds.toFixed(2)} s (${lap.toFixed(5)} d)`);
}
const capRate = T.constants.MAX_WARP * T.constants.BASE_RATE_DAYS_PER_SEC;
check('C12 the skip cap is still about 149 days a second', capRate > 120 && capRate < 180, `${capRate.toFixed(1)} d/s`);

// --- the tutorial moons
const t = by.tessel;
const hop = hohmann(t.mu, by.bramble.a, by.ledger.a);
check('C9 Bramble->Ledger under 1 km/s', km(hop.dv1 + hop.dv2) < 1, `${km(hop.dv1 + hop.dv2).toFixed(2)} km/s, ${hop.time.toFixed(1)} d`);
/* The tutorial ladder in days. The floor came down from 1.5 with the
   rescale: every period in the sky is 0.64 of what it was, and a moon you
   can be at inside a day is a better first errand, not a worse one. */
for(const id of ['pip', 'bramble', 'ledger']) check(`C9 ${id} period`, periods[id] > 1 && periods[id] < 14, `${periods[id]} d`);
check('C9 moons ordered', by.pip.a < by.bramble.a && by.bramble.a < by.ledger.a);
const first = hohmann(t.mu, t.dockAlt, by.bramble.a);
console.log(`     first hop Tessel dock -> Bramble: ${km(first.dv1).toFixed(2)} km/s out, arrives ${km(first.dv2).toFixed(2)} km/s under Bramble's speed, ${first.time.toFixed(1)} d`);

// --- Grumm
const g = by.grumm;
const hg = hohmann(MU, 1, g.a);
const rp = 1.5 * g.radius;
const turn = 2 * Math.asin(1 / (1 + rp * hg.dv2 * hg.dv2 / g.mu));
/* Grumm's reach is whatever its mass earns, so the floor is written as a
   fraction of its own orbit rather than as an absolute: an au is not a fixed
   yardstick in a sky that can be rescaled, and the promise — that Grumm is a
   place you fly *through* — is about proportion. What the reach is actually
   for is checked on the next line, and that test does not depend on it. */
check('C8 Grumm reach is at least 0.8% of its orbit', g.soi >= 0.008 * g.a, `${g.soi.toFixed(4)} au, ${(100 * g.soi / g.a).toFixed(2)}% of ${g.a} au`);
check('C8 Grumm turns a Hohmann arrival >= 60 deg', turn * 180 / Math.PI >= 60, `${(turn * 180 / Math.PI).toFixed(0)} deg`);
check('C8 Grumm atmosphere band', g.atmo > 1.05 * g.radius && g.atmo < 1.3 * g.radius);
for(const id of ['mossback', 'lillimoor', 'widdershins']) check(`C10 ${id} period`, periods[id] > 2 && periods[id] < 40, `${periods[id]} d`);
check('C10 Widdershins retrograde', by.widdershins.retrograde === true);

// --- phases
const nW = Math.sqrt(MU / by.wanderwell.a ** 3), nM = Math.sqrt(MU / by.merrow.a ** 3);
const toPe = (b, n) => ((TAU - ((b.M0 % TAU) + TAU) % TAU) % TAU) / n;
check('C11 Wanderwell kisses in 0.9-1.3 years', toPe(by.wanderwell, nW) / 360 > 0.9 && toPe(by.wanderwell, nW) / 360 < 1.3, `${(toPe(by.wanderwell, nW) / 360).toFixed(2)} y`);
check('C11 comet passes in 6-10 years', toPe(by.merrow, nM) / 360 > 6 && toPe(by.merrow, nM) / 360 < 10, `${(toPe(by.merrow, nM) / 360).toFixed(2)} y`);
for(const group of [['pip', 'bramble', 'ledger'], ['mossback', 'lillimoor', 'widdershins']]){
  let ok = true;
  for(let i = 0; i < group.length; i++) for(let j = i + 1; j < group.length; j++){
    let d = Math.abs(by[group[i]].M0 - by[group[j]].M0) % TAU; d = Math.min(d, TAU - d);
    if(d < Math.PI / 3) ok = false;
  }
  check(`C11 ${group.join('/')} spread`, ok);
}

// --- the delta-v table and the tank gating
const starter = T.ship.tanks[0].dv_kms, longhaul = T.ship.tanks[1].dv_kms, deep = T.ship.tanks[T.ship.tanks.length - 1].dv_kms;
const table = [
  { route: 'Bramble -> Ledger (moon hop)', dv_kms: +km(hop.dv1 + hop.dv2).toFixed(2), days: +hop.time.toFixed(1) },
  { route: 'Tessel dock -> Bramble (first lesson)', dv_kms: +km(first.dv1 + Math.max(0, first.dv2 - by.bramble.dockSpeed)).toFixed(2), days: +first.time.toFixed(1) },
  route('Tessel -> Cinder (dock)', by.cinder.a, dv2 => captureBurn(by.cinder, by.cinder.dockAlt, dv2)),
  route('Tessel -> Cinder (loose capture)', by.cinder.a, dv2 => captureBurn(by.cinder, by.cinder.dockAlt, dv2, true)),
  route('Tessel -> Wanderwell at its kiss', 0.5, dv2 => { const w = by.wanderwell; const vw = Math.sqrt(MU * (2 / 0.5 - 1 / w.a)); const vship = Math.sqrt(MU * (2 / 0.5 - 1 / 0.75)); return captureBurn(w, w.dockAlt, Math.abs(vw - vship), true); }),
  route('Tessel -> the Arc', by.arc.a, dv2 => dv2),
  route('Tessel -> Claw Rock', by.clawrock.a, dv2 => dv2),
  route('Tessel -> Grumm (loose capture)', g.a, dv2 => captureBurn(g, by.lillimoor.a, dv2, true)),
  route('Tessel -> Lillimoor height, circular', g.a, dv2 => captureBurn(g, by.lillimoor.a, dv2)),
  route('Tessel -> Chime (dock), no assist', by.chime.a, dv2 => captureBurn(by.chime, by.chime.dockAlt, dv2)),
  route('Tessel -> the Far Lantern', by.lantern.a, dv2 => dv2),
];
console.log('\nΔv table (km/s, patched-conic estimates from the Tessel docking orbit):');
for(const r of table) console.log(`  ${r.route.padEnd(42)} ${String(r.dv_kms).padStart(6)}  ${String(r.days).padStart(6)} d${r.dep_kms != null ? `   (out ${r.dep_kms}, in ${r.arr_kms})` : ''}`);
const dv = name => table.find(r => r.route.startsWith(name)).dv_kms;
/* What the starter tank opens, and what it does not. The ladder is the game's
   shape: the rafts, then the festival, then the belt, then Grumm — and Cinder
   and Chime only once somebody at Pip has sold you a bigger tank. */
check('C7 Wanderwell kiss within 80% of the starter tank', dv('Tessel -> Wanderwell') <= 0.8 * starter, `${dv('Tessel -> Wanderwell')} of ${starter}`);
check('C7 the Arc within 80% of the starter tank', dv('Tessel -> the Arc') <= 0.8 * starter, `${dv('Tessel -> the Arc')} of ${starter}`);
check('C7 Claw Rock within the starter tank, with something left', dv('Tessel -> Claw Rock') <= 0.85 * starter, `${dv('Tessel -> Claw Rock')} of ${starter}`);
check('C7 Grumm loose capture within the starter tank', dv('Tessel -> Grumm (loose') <= starter);
check('C7 Lillimoor height between 70% and 100% of the starter tank', dv('Tessel -> Lillimoor') >= 0.7 * starter && dv('Tessel -> Lillimoor') <= starter, `${dv('Tessel -> Lillimoor')} of ${starter}`);
/* Falling inward is dearer than climbing out — the arrival at 0.3 au is the
   whole cost — so Cinder is a tank upgrade away, not a first errand. */
check('C7 Cinder dock is beyond the starter tank', dv('Tessel -> Cinder (dock)') > starter, `${dv('Tessel -> Cinder (dock)')} vs ${starter}`);
check('C7 Cinder dock within the long-haul tank, with 15% spare', dv('Tessel -> Cinder (dock)') <= 0.85 * longhaul, `${dv('Tessel -> Cinder (dock)')} of ${longhaul}`);
/* Cinder used to be reachable on the starter tank if you settled for a
   loose capture. At a tenth the size it is not: a small world gives almost
   no help on arrival, so the burn is nearly the whole heliocentric mismatch
   and a loose capture saves 0.7 km/s rather than 2.8. Cinder is now a
   long-haul destination in every form, which is a real change to the ladder
   and not a rounding. */
check('C7 Cinder needs the long-haul tank in any form', dv('Tessel -> Cinder (loose') > starter && dv('Tessel -> Cinder (loose') <= 0.85 * longhaul, `${dv('Tessel -> Cinder (loose')}: past ${starter}, within ${0.85 * longhaul}`);
check('C7 Chime leaves the starter tank nothing to come home on', dv('Tessel -> Chime') > 0.9 * starter, `${dv('Tessel -> Chime')} of ${starter}`);
check('C7 Chime within the long-haul tank', dv('Tessel -> Chime') <= longhaul, `${dv('Tessel -> Chime')} of ${longhaul}`);
/* The Lantern is cheap and slow: fourteen years of coasting. The deep tank is
   what makes it a journey you come back from. */
check('C7 the deep tank reaches the Lantern with 20% spare', dv('Tessel -> the Far Lantern') <= 0.8 * deep, `${dv('Tessel -> the Far Lantern')} of ${deep}`);
check('C7 the Lantern is the long way round, not the dear one', table.find(r => r.route.startsWith('Tessel -> the Far Lantern')).days > 3000);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
if(process.argv.includes('--write')){
  T.dvTable = table; T.periods = periods;
  writeFileSync(file, JSON.stringify(T, null, 1) + '\n');
  console.log('wrote dvTable and periods into tuning.json');
}
process.exit(fails ? 1 : 0);
