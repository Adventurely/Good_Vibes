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
/* Distances read in kilometres, because that is what the game's own labels say.
   KM_PER_AU is the sky's own yardstick, not the physical au. */
const KM_PER_AU = 147400000;
const kmOf = au => Math.round(au * KM_PER_AU);
const soiOf = b => (b.mu > 0 && b.a > 0 && by[b.parent]?.mu > 0) ? b.a * Math.pow(b.mu / by[b.parent].mu, 2 / 5) : null;
/* And the mouth a size earns, mirrored the same way: five radii above the top
   of the air. A drifting haven has neither, and keeps its authored one. */
/* Five radii over the air, for a world you park above. Anything you come
   alongside keeps the mouth it was given: that number is a distance to close,
   not a height to hold, so the mass it belongs to has no say in it. Same rule
   as content.js, and the two have to agree or the checker is checking a sky
   the game does not have. */
const mouthOf = b => b.mu > 0 && b.radius > 0 && b.harbour !== 'rendezvous'
  ? Math.max(b.radius, b.atmo ?? b.radius) + 5 * b.radius
  : b.zoneRadius;
for(const b of T.bodies){ b.soi = soiOf(b); b.zoneRadius = mouthOf(b); }
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
/* Coming alongside something with a well: fall from the edge to the mouth,
 * then kill everything but the speed it will take you at. Not a capture — you
 * are not going into orbit round it — but the well is real and the arrival is
 * dearer for it. The Maw is the only harbour of this shape. */
function alongsideBurn(b, vEdge){
  const vMouth = Math.sqrt(Math.max(0, vEdge * vEdge - 2 * b.mu / b.soi) + 2 * b.mu / b.zoneRadius);
  return Math.max(0, vMouth - b.dockSpeed);
}
/* Heliocentric Hohmann between two circular radii: the two deltas and the time. */
function hohmann(mu, r1, r2){
  const at = (r1 + r2) / 2;
  const v1 = Math.sqrt(mu / r1), v2 = Math.sqrt(mu / r2);
  const dv1 = Math.abs(Math.sqrt(mu * (2 / r1 - 1 / at)) - v1);
  const dv2 = Math.abs(v2 - Math.sqrt(mu * (2 / r2 - 1 / at)));
  return { dv1, dv2, time: period(mu, at) / 2 };
}
/* Tassel dock -> a target around the Lamp. `arrive` decides what happens at the far end. */
function route(name, toRadius, arrive){
  const t = by.tassel;
  const h = hohmann(MU, t.a, toRadius);
  const dep = escapeBurn(t, t.dockAlt, h.dv1);
  const arr = arrive(h.dv2);
  return { route: name, dv_kms: +km(dep + arr).toFixed(1), dep_kms: +km(dep).toFixed(1), arr_kms: +km(arr).toFixed(1), days: Math.round(h.time) };
}

// --- periods and the calendar
const periods = {};
for(const b of T.bodies){ if(b.parent) periods[b.id] = +period(by[b.parent].mu, b.a).toFixed(2); }
/* The calendar and the sky have to be the same thing. YEAR_DAYS is what the
   log and every date in the game count in, and Tassel's lap is what a year
   *is*, so the check is that they agree rather than that either is some
   particular number — the sky has been squeezed once and would otherwise
   have left the calendar behind it. */
check('C1 the calendar is Tassel\'s year', Math.abs(periods.tassel - T.constants.YEAR_DAYS) < 0.01, `${periods.tassel} d vs YEAR_DAYS ${T.constants.YEAR_DAYS}`);
/* The two Emberkin worlds are the inner pair, in some order. Which of them is
   nearer the Lamp is a design decision that has been taken both ways; what
   must hold is that they are both inside Tassel and not on top of each other. */
const emberkin = [by.cinder, by.veyra].sort((a, b) => a.a - b.a);
check('C1 the Emberkin worlds are the inner pair', emberkin[1].a < by.tassel.a && emberkin[0].a < emberkin[1].a * 0.8,
  `${emberkin[0].id} ${emberkin[0].a} then ${emberkin[1].id} ${emberkin[1].a}, both inside Tassel's ${by.tassel.a} au`);
check('C1 the innermost year is under a month', periods[emberkin[0].id] > 12 && periods[emberkin[0].id] < 30,
  `${emberkin[0].id}: ${periods[emberkin[0].id]} d`);
check('C1 both cat havens ride inside the Belt', by.nail.a > T.belt.inner && by.nail.a < T.belt.outer && by.whisker.a > T.belt.inner && by.whisker.a < T.belt.outer, `${by.nail.a} and ${by.whisker.a} in ${T.belt.inner}-${T.belt.outer} au`);
check('C1 the Arc rides just beyond the Belt', by.arc.a > T.belt.outer && by.arc.a < T.belt.outer + 0.5, `${by.arc.a} au, belt ends at ${T.belt.outer}`);
check('C1 the Maw is the far edge', by.maw.a > 3 * by.grumm.a, `${by.maw.a} au`);

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
check('C4 the inner worlds never nest', by.cinder.soi + by.veyra.soi < 0.2 && by.veyra.soi + by.tassel.soi < 0.3);

// --- port geometry and speeds
for(const b of T.bodies){
  if(!b.port) continue;
  /* Which kind of harbour, which is about the place rather than about the mass.
     A rendezvous has no ground to clear and no parking orbit to sit in — its
     mouth is how near you have to come, not how high you have to fly — so the
     whole parking ladder below is asked only of a world you orbit. The Maw is
     the reason this is not simply `mu > 0` any more: it is a black hole with
     thirty times Grumm's pull and still a thing you come alongside. */
  const alongside = b.harbour === 'rendezvous' || !(b.mu > 0);
  if(b.mu > 0 && !alongside){
    /* The ordering that has to hold: the ground, then the parking orbit, then
       the harbour mouth, and all of it inside the world's own reach. The cap
       used to be a third of the reach, back when the mouth was a number
       somebody chose. Ten radii is a bigger bite out of a small moon than out
       of a planet — Glass's mouth is most of Glass's gravity — so the cap is
       now the physical one: the harbour has to be inside the reach, with
       enough left over that crossing the line and tying up are still two
       things. The fraction is printed because it is the number that decides
       how much of an arrival is left. */
    const frac = b.zoneRadius / b.soi;
    check(`C5 ${b.id} ground < parking < mouth < reach`, b.radius < b.dockAlt && b.dockAlt < b.zoneRadius && frac <= 0.92, `mouth is ${(frac * 100).toFixed(0)}% of the reach`);
    /* And where there is air, it goes under all of that. A parking orbit inside
       the band is not a harbour, it is a slow crash — and to a ship without a
       shield the top of the air *is* the ground, so the ordering that matters
       is the one a pilot flies, not the one the rock draws. Five worlds have
       weather now; this is what stops the sixth being given some without
       anybody checking what it sits under. */
    if(b.atmo){
      const air = (b.atmo - b.radius) / b.radius;
      check(`C5 ${b.id} air < parking`, b.atmo < b.dockAlt, `air to ${kmOf(b.atmo - b.radius)} km, parking at ${kmOf(b.dockAlt - b.radius)} km up`);
      /* A band between a twentieth and a third of the radius. Below that a pass
         is a coin toss at the precision a burn can be aimed to; above it the
         world is more air than world and the shed stops meaning anything. */
      check(`C5 ${b.id} air is a band, not a skin or a shell`, air >= 0.05 && air <= 0.33, `${(air * 100).toFixed(0)}% of the radius, ${kmOf(b.atmo - b.radius)} km`);
    }
    const vc = Math.sqrt(b.mu / b.dockAlt);
    check(`C6 ${b.id} parked speed`, km(vc) < 20, `${km(vc).toFixed(2)} km/s`);
    const esc = Math.sqrt(b.mu * (2 / b.dockAlt - 1 / ((b.dockAlt + b.soi) / 2))) - vc;
    /* Leaving a world's reach should never eat the tank. Moons and the Arc are
       pocket change; planets are allowed more, and Grumm — a gas giant with a
       harbour in its clouds — the most, because getting off it is meant to be
       a journey. */
    const limit = b.kind === 'moon' || b.kind === 'station' ? 1.5 : b.id === 'grumm' ? 6 : 4;
    check(`C6 ${b.id} leaving its reach`, km(esc) < limit, `${km(esc).toFixed(2)} km/s`);
    // Falling in from rest at the edge and docking: the excess over a parked orbit.
    const vfall = Math.sqrt(2 * b.mu * (1 / b.dockAlt - 1 / b.soi));
    const excess = vfall - vc;
    if(b.kind === 'moon' || b.kind === 'station') check(`C6 ${b.id} docking brake from a co-orbital fall`, excess <= b.dockSpeed * 1.6, `${km(excess).toFixed(2)} km/s over parked, limit ${km(b.dockSpeed).toFixed(2)}`);
  }else{
    check(`C5 ${b.id} is a harbour you come alongside`, b.zoneRadius > 0 && b.dockSpeed > 0 && b.dockAlt == null,
      `mouth ${kmOf(b.zoneRadius)} km at ${km(b.dockSpeed).toFixed(2)} km/s`);
    /* With weight, the mouth has to sit inside the reach with room to spare, or
       a ship is asked to come alongside from outside the thing's own gravity.
       Without it there is no reach to be inside of, and nothing to check. */
    if(b.mu > 0){
      const frac = b.zoneRadius / soiOf(b);
      check(`C5 ${b.id} mouth inside its reach`, frac <= 0.5, `mouth is ${(frac * 100).toFixed(0)}% of the reach`);
      /* And falling in from the edge has to leave a ship slow enough to be met.
         A black hole you cannot arrive at slowly is a black hole with no
         harbour, whatever the table says. */
      const vfall = Math.sqrt(2 * b.mu * (1 / b.zoneRadius - 1 / soiOf(b)));
      check(`C6 ${b.id} can be met at the mouth`, km(vfall) < 40, `${km(vfall).toFixed(2)} km/s falling in from the edge`);
    }
  }
}

/* --- wrecks: things with no weight, on rails, that a ship can tie up to.
   Nothing holds a ship beside one, so the geometry has to be right rather than
   forgiving. Three rules, and they are all about not standing on somebody
   else's toes. */
for(const b of T.bodies){
  /* Anything weightless you can tie up to: the wrecks and the station at the
     Dancer, which is the same shape with a wider mouth. */
  if(b.mu !== 0 || !b.port || b.parent == null) continue;
  const p = by[b.parent];
  check(`C13 ${b.id} has no weight`, b.mu === 0 && b.port === true, `mu ${b.mu}`);
  /* A weightless harbour must never pass through a sibling's reach. Inside one
     it is a child of the wrong frame, and the harbour search — which only looks
     at children of the frame the ship is in — stops being able to find it.
     Orbits that never overlap are free; orbits that do have to keep station
     exactly: same a, same period, a fixed angle apart, which is how the Arc's
     drawn tail works and so how a wreck in that tail has to work. */
  for(const c of T.bodies){
    if(c.id === b.id || c.parent !== b.parent || !(c.soi > 0)) continue;
    const overlaps = b.a * (1 - b.e) <= c.a * (1 + c.e) + c.soi
                  && b.a * (1 + b.e) >= c.a * (1 - c.e) - c.soi;
    if(!overlaps) continue;
    check(`C13 ${b.id} keeps station with ${c.id}`, b.a === c.a && b.e === 0 && c.e === 0,
      `a ${b.a} vs ${c.a}, e ${b.e} vs ${c.e}`);
    const apart = 2 * b.a * Math.abs(Math.sin(((b.M0 + b.omega) - (c.M0 + c.omega)) / 2));
    check(`C13 ${b.id} stays clear of ${c.id}`, apart > 10 * c.soi, `${apart.toFixed(4)} au apart, reach ${c.soi.toFixed(5)}`);
  }
  check(`C13 ${b.id} mouth < drift reach`, b.zoneRadius > 0 && b.driftReach > b.zoneRadius,
    `mouth ${kmOf(b.zoneRadius)} km, reach ${kmOf(b.driftReach)} km`);
  if(p.soi){
    /* Inside the parent's reach with room to spare, the same margin a moon
       gets: a harbour you can only reach by hanging off the edge of a sphere
       of influence is one arrival in three that goes wrong. */
    check(`C13 ${b.id} stays inside ${p.id}`, b.a * (1 + b.e) + b.zoneRadius <= 0.8 * p.soi,
      `${kmOf(b.a * (1 + b.e) + b.zoneRadius)} km <= ${kmOf(0.8 * p.soi)} km`);
    /* And clear of the harbour it is parked over, by more than the reach that
       bends the burn axes — or a pilot tying up at the world would find
       forward and back suddenly measured against a derelict. */
    check(`C13 ${b.id} keeps out of ${p.id}'s harbour`, b.a * (1 - b.e) - b.driftReach > p.zoneRadius,
      `${kmOf(b.a * (1 - b.e) - b.driftReach)} km clear of a ${kmOf(p.zoneRadius)} km mouth`);
  }
  /* A wreck in the Belt is in the Belt: the whole orbit, not the average of it. */
  if(b.parent === 'lamp' && b.a > T.belt.inner && b.a < T.belt.outer){
    check(`C13 ${b.id} keeps to the Belt`, b.a * (1 - b.e) >= T.belt.inner && b.a * (1 + b.e) <= T.belt.outer,
      `${(b.a * (1 - b.e)).toFixed(4)}-${(b.a * (1 + b.e)).toFixed(4)} in ${T.belt.inner}-${T.belt.outer}`);
    /* And out of the way of the two rocks people actually live on. */
    for(const c of [by.nail, by.whisker]){
      const gap = Math.abs(b.a - c.a) - (b.a * b.e + c.a * c.e);
      check(`C13 ${b.id} clear of ${c.id}`, gap >= 2 * c.soi, `${gap.toFixed(4)} >= ${(2 * c.soi).toFixed(4)}`);
    }
  }
}

/* --- the orbit a new game opens in, and the clock that is tuned to it.
   Low means what a pilot means by it: the high point of the orbit sits less
   than one planet-diameter above the ground. The clock then has one job — a
   lap of that orbit is about eleven real minutes at x1 — and the skip cap has
   to move with it, or pointing at the Maw stops being ten seconds.

   A band rather than a number, because the opening orbit is chosen for what it
   looks like (150 km is clear of the planet on the chart; 100 km read as
   sitting on it) and the rate is chosen once, for the whole sky. Ten to twelve
   minutes is the range in which a lap is slow enough that nothing appears to
   move and short enough that a player sees one happen. */
const START_LAP_MIN = 600, START_LAP_MAX = 720;
for(const b of T.bodies){
  if(b.startAlt == null) continue;
  const alt = b.startAlt - b.radius;
  check(`C12 ${b.id} opens in a low orbit`, alt > 0 && alt < 2 * b.radius, `apoapsis altitude ${alt.toFixed(6)} au < diameter ${(2 * b.radius).toFixed(6)} au`);
  check(`C12 ${b.id}'s start orbit clears the harbour it is under`, b.startAlt < b.dockAlt, `${b.startAlt} < ${b.dockAlt}`);
  const lap = period(b.mu, b.startAlt);
  const seconds = lap / T.constants.BASE_RATE_DAYS_PER_SEC;
  check(`C12 a lap of ${b.id}'s start orbit is ten to twelve real minutes at x1`, seconds >= START_LAP_MIN && seconds <= START_LAP_MAX, `${seconds.toFixed(2)} s = ${(seconds / 60).toFixed(1)} min (${lap.toFixed(5)} d)`);
}
const capRate = T.constants.MAX_WARP * T.constants.BASE_RATE_DAYS_PER_SEC;
check('C12 the skip cap is still about 149 days a second', capRate > 120 && capRate < 180, `${capRate.toFixed(1)} d/s`);

// --- the tutorial moons
const t = by.tassel;
const hop = hohmann(t.mu, by.slate.a, by.moss.a);
check('C9 Slate->Moss under 1 km/s', km(hop.dv1 + hop.dv2) < 1, `${km(hop.dv1 + hop.dv2).toFixed(2)} km/s, ${hop.time.toFixed(1)} d`);
/* The tutorial ladder in days: a moon you can be at inside a fortnight, and
   Slate — the first errand of the game — inside a couple of days. */
for(const id of ['slate', 'moss']) check(`C9 ${id} period`, periods[id] > 1 && periods[id] < 14, `${periods[id]} d`);
check('C9 moons ordered', by.slate.a < by.moss.a);
const first = hohmann(t.mu, t.dockAlt, by.slate.a);
console.log(`     first hop Tassel dock -> Slate: ${km(first.dv1).toFixed(2)} km/s out, arrives ${km(first.dv2).toFixed(2)} km/s under Slate's speed, ${first.time.toFixed(1)} d`);

// --- Grumm
const g = by.grumm;
const hg = hohmann(MU, 1, g.a);
const rp = 1.5 * g.radius;
const turn = 2 * Math.asin(1 / (1 + rp * hg.dv2 * hg.dv2 / g.mu));
/* Grumm's reach is whatever its mass earns, so the floor is written as a
   fraction of its own orbit rather than as an absolute: an au is not a fixed
   yardstick in a sky that can be rescaled, and the promise — that Grumm is a
   place you fly *through* — is about proportion. */
check('C8 Grumm reach is at least 0.8% of its orbit', g.soi >= 0.008 * g.a, `${g.soi.toFixed(4)} au, ${(100 * g.soi / g.a).toFixed(2)}% of ${g.a} au`);
check('C8 Grumm turns a Hohmann arrival >= 60 deg', turn * 180 / Math.PI >= 60, `${(turn * 180 / Math.PI).toFixed(0)} deg`);
for(const id of ['brine', 'glass', 'croak', 'haven']) check(`C10 ${id} period`, periods[id] > 2 && periods[id] < 60, `${periods[id]} d`);
check('C10 Croak retrograde', by.croak.retrograde === true);
check('C10 frog moons ordered outward', by.brine.a < by.glass.a && by.glass.a < by.croak.a && by.croak.a < by.haven.a);

// --- phases: nothing starts the game bunched up in one corner of its system
for(const group of [['slate', 'moss'], ['brine', 'glass', 'croak', 'haven'], ['nail', 'whisker']]){
  let ok = true;
  for(let i = 0; i < group.length; i++) for(let j = i + 1; j < group.length; j++){
    let d = Math.abs(by[group[i]].M0 - by[group[j]].M0) % TAU; d = Math.min(d, TAU - d);
    if(d < Math.PI / 3) ok = false;
  }
  check(`C11 ${group.join('/')} spread`, ok);
}

// --- the delta-v table and the tank gating
const starter = T.ship.tanks[0].dv_kms, longhaul = T.ship.tanks[1].dv_kms, deepsky = T.ship.tanks[2].dv_kms, deep = T.ship.tanks[T.ship.tanks.length - 1].dv_kms;
const table = [
  { route: 'Slate -> Moss (moon hop)', dv_kms: +km(hop.dv1 + hop.dv2).toFixed(2), days: +hop.time.toFixed(1) },
  { route: 'Tassel dock -> Slate (first lesson)', dv_kms: +km(first.dv1 + Math.max(0, first.dv2 - by.slate.dockSpeed)).toFixed(2), days: +first.time.toFixed(1) },
  route('Tassel -> Veyra (dock)', by.veyra.a, dv2 => captureBurn(by.veyra, by.veyra.dockAlt, dv2)),
  route('Tassel -> Cinder (dock)', by.cinder.a, dv2 => captureBurn(by.cinder, by.cinder.dockAlt, dv2)),
  route('Tassel -> Cinder (loose capture)', by.cinder.a, dv2 => captureBurn(by.cinder, by.cinder.dockAlt, dv2, true)),
  route('Tassel -> Nail (the Belt)', by.nail.a, dv2 => dv2),
  route('Tassel -> the Arc', by.arc.a, dv2 => dv2),
  route('Tassel -> Grumm (loose capture)', g.a, dv2 => captureBurn(g, by.haven.a, dv2, true)),
  route('Tassel -> Haven height, circular', g.a, dv2 => captureBurn(g, by.haven.a, dv2)),
  route('Tassel -> the Maw', by.maw.a, dv2 => alongsideBurn(by.maw, dv2)),
];
console.log('\nΔv table (km/s, patched-conic estimates from the Tassel docking orbit):');
for(const r of table) console.log(`  ${r.route.padEnd(42)} ${String(r.dv_kms).padStart(6)}  ${String(r.days).padStart(6)} d${r.dep_kms != null ? `   (out ${r.dep_kms}, in ${r.arr_kms})` : ''}`);
const dv = name => table.find(r => r.route.startsWith(name)).dv_kms;
/* What the tanks open, and in what order. The map moved under these numbers
   with the new setting and the balance pass has not happened yet, so the gates
   here are the shape of the ladder — moons first, then the Belt, then the
   giant, and the Maw only on the deep tank — not a claim that any of it is
   tuned. */
check('C7 the first lesson is pocket change', dv('Tassel dock -> Slate') < 0.2 * starter, `${dv('Tassel dock -> Slate')} of ${starter}`);
check('C7 the moon hop is cheaper still', dv('Slate -> Moss') < dv('Tassel dock -> Slate'));
check('C7 the Belt is within the starter tank', dv('Tassel -> Nail') <= starter, `${dv('Tassel -> Nail')} of ${starter}`);
check('C7 the Arc costs more than the Belt', dv('Tassel -> the Arc') > dv('Tassel -> Nail'));
check('C7 Grumm is a loose capture on the starter tank', dv('Tassel -> Grumm (loose') <= starter, `${dv('Tassel -> Grumm (loose')} of ${starter}`);
check('C7 Haven costs more than a loose capture at Grumm', dv('Tassel -> Haven') > dv('Tassel -> Grumm (loose'));
/* One Emberkin world is an errand and the other is an expedition, and the
   quest line counts on knowing which. It sends a ship to Cinder at job five
   and to Veyra at job eight, so the one it asks for first has to be the one a
   starter tank can reach — which is what swapping the two of them was for. */
const near = dv('Tassel -> Cinder (dock)'), far = dv('Tassel -> Veyra');
check('C7 the errand comes before the expedition', near <= starter && far > starter,
  `Cinder ${near} within ${starter}, Veyra ${far} past it`);
check('C7 the far Emberkin world is a long haul, not a wall', far <= longhaul, `${far}: within ${longhaul}`);
/* Four rungs now — the one the ship comes with and three that are bought — so
   each has to be worth its price, and the rung above the one that barely
   reaches the expedition has to make it comfortable rather than exact. */
check('C7 the tanks climb', T.ship.tanks.every((t, i) => !i || t.dv_kms > T.ship.tanks[i - 1].dv_kms), T.ship.tanks.map(t => t.dv_kms).join(' < '));
check('C7 the holds climb', T.ship.holds.every((h, i) => !i || h.units > T.ship.holds[i - 1].units), T.ship.holds.map(h => h.units).join(' < '));
check('C7 the deep-sky tank makes the expedition comfortable rather than exact', far <= 0.8 * deepsky, `${far} of ${deepsky}`);
/* The Maw is cheap and slow: years of coasting. The deep tank is what makes it
   a journey you come back from. */
check('C7 the deep tank reaches the Maw with 20% spare', dv('Tassel -> the Maw') <= 0.8 * deep, `${dv('Tassel -> the Maw')} of ${deep}`);
check('C7 the Maw is the long way round, not the dear one',
  table.find(r => r.route.startsWith('Tassel -> the Maw')).days > 1200
  && table.every(r => r.route.startsWith('Tassel -> the Maw') || r.days < table.find(x => x.route.startsWith('Tassel -> the Maw')).days),
  `${table.find(r => r.route.startsWith('Tassel -> the Maw')).days} d, the longest road there is`);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
if(process.argv.includes('--write')){
  T.dvTable = table; T.periods = periods;
  writeFileSync(file, JSON.stringify(T, null, 1) + '\n');
  console.log('wrote dvTable and periods into tuning.json');
}
process.exit(fails ? 1 : 0);
