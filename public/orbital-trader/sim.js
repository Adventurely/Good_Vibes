/* Orbital Trader: the rules.
 *
 * Pure functions over one plain state object: what a tick does, what docking
 * means, what a crate of Bramble apples is worth on Lillimoor today. The page
 * calls these and draws the result; the tests call these and check the
 * result; neither is allowed to decide anything on its own.
 *
 * The state is JSON all the way down (no classes, no Maps, no functions), so
 * saving is `JSON.stringify` and there is exactly one copy of every rule.
 *
 * Money is a key, not a score: it opens tanks and holds and heat shields. The
 * things that actually gate the map are the physics, which live in orbit.js
 * and are only *called* from here.
 */

import {
  makeWorld, advance, predict, absState, railState, circularState, elementsFromState,
  timeToAnomaly, propagate, hohmann, lambert, period, norm, sub, add, scale, unit, perp, dist,
  closestApproach, nodeMagnitude, nodeCost, nodeFromVector, cross, dot, localState, TAU,
} from './orbit.js';
import {
  CONST, BODIES, GOODS, PORTS, UPGRADES, FORMULAS, CONTRACT_TEMPLATES, TEXT, SPECIES,
} from './content.js';

export const world = makeWorld(BODIES);
export const KMS = CONST.KMS_PER_AU_DAY;
export const kms = auDay => auDay * KMS;          // au/day -> km/s for display
export const auDay = k => k / KMS;                 // km/s -> au/day for the kernel

const goodIndex = new Map(GOODS.map(g => [g.id, g]));
export const goodById = id => goodIndex.get(id);
export const portIds = Object.keys(PORTS);
export const bodyById = id => world.get(id);
const upgradeIndex = new Map(UPGRADES.map(u => [u.id, u]));
export const upgradeById = id => upgradeIndex.get(id);

/* ----------------------------------------------------------------- rng */

/* A small deterministic generator kept in the state, so a save reloads into
 * the same offers and the same haggles. xorshift32; plenty for dice. */
function rnd(state){
  let s = state.rng >>> 0 || 0x9e3779b9;
  s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
  state.rng = s;
  return s / 4294967296;
}
/* A stable hash of a few labels, for things that must not change between
 * frames (today's haggle, this week's fashion) yet should differ by place. */
export function hash(...parts){
  let h = 2166136261;
  for(const p of parts){
    for(const ch of String(p)){ h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    h ^= 0x2d; h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

/* --------------------------------------------------------------- state */

export function tiers(kind){ return UPGRADES.filter(u => u.kind === kind).sort((a, b) => a.tier - b.tier); }

export function newGame(seed = 1){
  const start = CONST.START_PORT;
  const state = {
    version: 1,
    seed, rng: (seed * 2654435761) >>> 0 || 1,
    t: 0, warp: 0, paused: false,
    shipName: TEXT.shipNames[Math.abs(seed) % TEXT.shipNames.length],
    ship: { body: start, r: [0, 0], v: [0, 0] },
    dockedAt: start,
    tiers: { tank: 0, engine: 0, hold: 0 },
    keys: { heatShield: false, refrigeration: false, sensors: false, stealth: false },
    tank: 0, dv: 0,
    money: CONST.START_MONEY, debt: 0,
    cargo: [], passengers: [],
    offers: {},
    markets: {},
    rep: { emberkin: 0, otter: 0, cat: 0, frog: 0 },
    nodes: [],
    target: null,
    log: [],
    flags: { tutorial: 0 },
    toll: { lastT: -1e9, inBelt: false },
    pending: null,
    justLeft: null,
    stats: { burns: 0, dvSpent: 0, docks: 0, sold: 0, bought: 0, deliveries: 0, tows: 0, tolls: 0, farthest: 0 },
    visited: [start],
  };
  state.tank = auDay(tiers('tank')[0].value);
  state.dv = state.tank;
  placeDocked(state, start);
  refreshOffers(state, start, true);
  logLine(state, 'docked', TEXT.logTemplates.docked, { port: portName(start) });
  return state;
}

export function holdUnits(state){ return tiers('hold')[state.tiers.hold].value; }
export function fuelPriceMul(state){ return tiers('engine')[state.tiers.engine].value; }
export function usedUnits(state){
  return state.cargo.reduce((s, c) => s + c.qty * goodById(c.good).units, 0)
    + state.passengers.reduce((s, p) => s + (p.units ?? 1), 0);
}
export function freeUnits(state){ return holdUnits(state) - usedUnits(state); }
export const portName = id => world.get(id)?.name ?? id;
export const portOf = id => PORTS[id];

export function logLine(state, kind, template, vars = {}){
  const text = fill(template, vars);
  state.log.push({ t: state.t, kind, text });
  if(state.log.length > 200) state.log.splice(0, state.log.length - 200);
  return text;
}
export function fill(template, vars){
  return String(template).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/* Game time as the world tells it: Tessel years and days. */
export function calendar(t){
  const y = Math.floor(t / CONST.YEAR_DAYS) + 1;
  const d = Math.floor(t - (y - 1) * CONST.YEAR_DAYS) + 1;
  return { year: y, day: d, text: `Year ${y}, day ${d}` };
}
export function fmtDays(d){
  if(!Number.isFinite(d)) return '—';
  if(d < 1) return `${Math.max(1, Math.round(d * 24))} h`;
  if(d < 60) return `${d.toFixed(d < 10 ? 1 : 0)} d`;
  if(d < CONST.YEAR_DAYS * 2) return `${Math.round(d)} d`;
  return `${(d / CONST.YEAR_DAYS).toFixed(1)} y`;
}
export function fmtKms(v){
  const k = Math.abs(v) * KMS;
  if(k < 1) return `${Math.round(k * 1000)} m/s`;
  return `${k.toFixed(k < 10 ? 2 : 1)} km/s`;
}
export function fmtMoney(m){
  const r = Math.round(m);
  return `${r < 0 ? '−' : ''}${Math.abs(r).toLocaleString('en-GB')} ${CONST.CURRENCY}`;
}

/* -------------------------------------------------------------- ports */

/* Wanderwell's colony is a market only near periapsis; the rest of the time
 * it is an empty town the otters of Tagalong keep the lights on in. */
export function portOpen(portId, t){
  const p = PORTS[portId];
  if(!p) return false;
  if(p.openWithin){
    const r = norm(absState(world, portId, t).r);
    return r <= p.openWithin;
  }
  return true;
}

/* Where a docked ship physically is: a circular orbit at the docking
 * altitude (or co-moving with a zone), frozen while docked. */
function placeDocked(state, portId){
  const b = world.get(portId);
  if(b.mu > 0){
    const s = circularState(b.mu, b.dockAlt, 0);
    state.ship = { body: portId, r: s.r, v: s.v };
  }else{
    // A zone: sit at it, in its parent's frame, moving with it.
    const local = railState(b, world.get(b.parent).mu, state.t);
    state.ship = { body: b.parent, r: [...local.r], v: [...local.v] };
  }
}

/* The port the ship could dock at right now, if any, and how far off it is. */
export function dockingStatus(state){
  if(state.dockedAt) return null;
  const here = world.get(state.ship.body);
  let best = null;
  const consider = (portId, distance, relSpeed) => {
    const b = world.get(portId);
    if(!b.port) return;
    if(state.justLeft === portId) return;
    const inZone = distance <= b.zoneRadius;
    // The limit is excess over a parked orbit at this distance: a ship that has
    // captured into any bound orbit around the port is slow enough. A zone has
    // no gravity, so there the limit is the relative speed itself.
    const parked = b.mu > 0 ? Math.sqrt(b.mu / Math.max(distance, b.radius)) : 0;
    const slow = relSpeed <= b.dockSpeed + parked;
    const score = distance / b.zoneRadius;
    if(!best || score < best.score) best = { port: portId, distance, relSpeed, inZone, slow, ok: inZone && slow, score, zoneRadius: b.zoneRadius, dockSpeed: b.dockSpeed, parked, over: Math.max(0, relSpeed - (b.dockSpeed + parked)), open: portOpen(portId, state.t) };
  };
  // The body we orbit.
  if(here.port) consider(here.id, norm(state.ship.r), norm(state.ship.v));
  // Gravity-less ports in this frame.
  for(const c of world.children(here.id)){
    if(!c.port || c.mu > 0) continue;
    const s = railState(c, here.mu, state.t);
    consider(c.id, dist(state.ship.r, s.r), norm(sub(state.ship.v, s.v)));
  }
  if(best && best.distance > best.zoneRadius * 8) return null;   // nowhere near; do not clutter the HUD
  return best;
}

export function dock(state){
  const st = dockingStatus(state);
  if(!st || !st.ok) return { ok: false, reason: st ? (st.inZone ? 'too fast' : 'too far') : 'no port' };
  const port = st.port;
  state.dockedAt = port;
  state.nodes = [];
  placeDocked(state, port);
  if(!state.visited.includes(port)) state.visited.push(port);
  state.stats.docks++;
  const dAbs = norm(absState(world, port, state.t).r);
  state.stats.farthest = Math.max(state.stats.farthest, dAbs);
  logLine(state, 'docked', TEXT.logTemplates.docked, { port: portName(port) });
  const delivered = deliverHere(state, port);
  refreshOffers(state, port);
  const events = [{ kind: 'docked', port, delivered }];
  milestonesOnDock(state, port, events);
  return { ok: true, port, delivered, events };
}

export function undock(state){
  if(!state.dockedAt) return { ok: false };
  const port = state.dockedAt;
  const b = world.get(port);
  if(b.mu > 0){
    // A prograde circular orbit at the docking altitude, placed so that the
    // ship's velocity points the way the port itself is moving: the first
    // burn a beginner makes is then already in the right direction.
    const pv = absState(world, port, state.t).v;
    const dir = norm(pv) > 0 ? unit(pv) : [0, 1];
    const theta = Math.atan2(dir[1], dir[0]) - Math.PI / 2;
    const s = circularState(b.mu, b.dockAlt, theta);
    state.ship = { body: port, r: s.r, v: s.v };
  }else{
    const parent = world.get(b.parent);
    const local = railState(b, parent.mu, state.t);
    // A nudge outward from the zone so the ship is not "in the zone" forever.
    const off = scale(unit(local.r), b.zoneRadius * 0.6);
    state.ship = { body: b.parent, r: add(local.r, off), v: [...local.v] };
  }
  state.dockedAt = null;
  /* Casting off drops you inside the harbour mouth you just left, and a card
     saying "tie up" is not what anybody wants to read one second after leaving.
     The port goes quiet until the ship is out of its mouth once. */
  state.justLeft = port;
  logLine(state, 'undocked', TEXT.logTemplates.undocked, { port: portName(port) });
  return { ok: true };
}

/* Wait at a port. Time passes for everyone: markets drift, contracts age. */
export function wait(state, days){
  if(!state.dockedAt || days <= 0) return;
  state.t += days;
  ageContracts(state);
}

/* Days until a body next reaches periapsis (Wanderwell's kissing distance,
 * the comet's pass). The rails make this exact. */
export function daysToPeriapsis(bodyId, t){
  const b = world.get(bodyId);
  const n = Math.sqrt(world.get(b.parent).mu / (b.a ** 3));
  const M = ((b.M0 + n * t) % TAU + TAU) % TAU;
  return ((TAU - M) % TAU) / n;
}

/* --------------------------------------------------------------- flight */

export function warpRate(state){ return CONST.WARP_LEVELS[state.warp] ?? 1; }
export function dtForFrame(state, realSeconds){
  if(state.paused || state.pending) return 0;
  return realSeconds * CONST.BASE_RATE_DAYS_PER_SEC * warpRate(state);
}

/* The maneuvers the kernel should actually fly: the player's nodes plus any
 * aerobrake the heat shield will take at a periapsis inside an atmosphere.
 * Computed by predicting, finding such a periapsis, inserting a retrograde
 * pseudo-node there, and predicting again — so the drawn path and the flown
 * path both include the skim. */
export function effectiveNodes(state, horizon){
  const nodes = state.nodes.map(n => ({ ...n })).sort((a, b) => a.t - b.t);
  if(!state.keys.heatShield) return nodes;
  let list = nodes;
  for(let pass = 0; pass < 3; pass++){
    const pred = predict(world, state.ship, state.t, list, horizon, { atmosphere: false, dvAvailable: state.dv });
    let added = false;
    for(const seg of pred.segments){
      const b = world.get(seg.body);
      if(!b.atmo) continue;
      const el = seg.elements;
      if(!(el.rp < b.atmo && el.rp > b.radius)) continue;
      const tp = timeToAnomaly(b.mu, seg.r0, seg.v0, 0);
      if(tp == null || tp > seg.t1 - seg.t0 + 1e-9) continue;
      const tAt = seg.t0 + tp;
      if(list.some(n => n.aero && Math.abs(n.t - tAt) < 1e-3)) continue;
      const vp = el.vmax;
      const depth = Math.max(0, Math.min(1, (b.atmo - el.rp) / (b.atmo - b.radius)));
      const wanted = Math.min(FORMULAS.aerobrake.maxFraction, FORMULAS.aerobrake.k * depth) * vp;
      /* The floor: an orbit whose far end still clears the clouds. Skimming can
         circularise you around a world; it must never quietly bury you in it.
         Pass after pass the shed shrinks to nothing, and the ship is left on a
         low orbit for the pilot to raise out of the air themselves. */
      const aTarget = (el.rp + FORMULAS.aerobrake.floorApo * b.atmo) / 2;
      const vFloor = Math.sqrt(Math.max(0, b.mu * (2 / el.rp - 1 / aTarget)));
      const shed = Math.max(0, Math.min(wanted, vp - vFloor));
      if(shed < vp * 1e-3) break;   // nothing left to give: stop inserting skims
      list = [...list, { t: tAt, prograde: -shed, radial: 0, aero: true, body: b.id }].sort((a, b) => a.t - b.t);
      added = true;
      break;
    }
    if(!added) break;
  }
  return list;
}

/* One step of flight. Returns the events that happened, already applied. */
export function tick(state, dtDays){
  const events = [];
  if(dtDays <= 0 || state.pending) return events;
  if(state.dockedAt){
    state.t += dtDays;
    ageContracts(state, events);
    return events;
  }
  const nodes = effectiveNodes(state, dtDays + 1);
  // Stop the step at the first change of reach or burn, so warp cannot skip
  // past an encounter the player was warping towards.
  const opts = { atmosphere: !state.keys.heatShield, dvAvailable: state.dv, stopOnSoi: true, stopOnBurn: true };
  const res = advance(world, state.ship, state.t, dtDays, nodes, opts);
  state.ship = res.ship;
  state.t = res.t;
  for(const e of res.events){
    if(e.kind === 'burn'){
      if(e.node.aero){
        logLine(state, 'burn', TEXT.logTemplates.aerobrake ?? 'Skimmed {body}: {dv} shed to the clouds.', { body: portName(e.node.body), dv: fmtKms(e.magnitude) });
        flag(state, 'firstAerobrake', events);
      }else{
        state.dv = Math.max(0, state.dv - e.magnitude);
        state.stats.burns++; state.stats.dvSpent += e.magnitude;
        // Drop the fired node from the plan.
        const ix = state.nodes.findIndex(n => Math.abs(n.t - e.node.t) < 1e-9);
        if(ix >= 0) state.nodes.splice(ix, 1);
        logLine(state, 'burn', TEXT.logTemplates.burn, { dv: fmtKms(e.magnitude), left: fmtKms(state.dv) });
        if(e.short) events.push({ kind: 'short', wanted: nodeMagnitude(e.node), got: e.magnitude });
        events.push({ kind: 'burn', magnitude: e.magnitude });
      }
    }else if(e.kind === 'soi'){
      const from = world.get(e.from), to = world.get(e.to);
      const entering = to.parent === from.id;
      logLine(state, 'soi', entering ? TEXT.logTemplates.soiEnter : TEXT.logTemplates.soiExit, { body: entering ? to.name : from.name, parent: to.name });
      events.push({ kind: 'soi', from: e.from, to: e.to });
      flag(state, 'firstSoiChange', events);
      if(e.to === 'lamp' && from.kind === 'planet') flag(state, 'firstTransfer', events);
      if(e.from === 'grumm' && e.to === 'lamp'){
        // Leaving Grumm faster than we came, in the Lamp's frame? That is an assist.
        const v = norm(shipAbsVel(state));
        if(state.flags.grummEntrySpeed != null && v > state.flags.grummEntrySpeed * 1.08) flag(state, 'firstAssist', events);
      }
      if(e.to === 'grumm') state.flags.grummEntrySpeed = norm(shipAbsVel(state));
      const d = norm(absState(world, state.ship.body, state.t).r);
      state.stats.farthest = Math.max(state.stats.farthest, d);
    }else if(e.kind === 'crash'){
      state.pending = { kind: 'crash', body: e.body, atmosphere: !!world.get(e.body).atmo && norm(state.ship.r) > world.get(e.body).radius * 1.001 };
      events.push({ kind: 'crash', body: e.body });
    }
  }
  if(res.crashed) return events;
  if(state.justLeft){
    const b = world.get(state.justLeft);
    const here = shipAbsPos(state);
    if(dist(here, absState(world, state.justLeft, state.t).r) > b.zoneRadius) state.justLeft = null;
  }
  if(state.nodes.length){
    const stale = state.nodes.filter(n => n.t < state.t - 1e-9);
    if(stale.length){
      state.nodes = state.nodes.filter(n => n.t >= state.t - 1e-9);
      events.push({ kind: 'missed', count: stale.length });
    }
  }
  tollCheck(state, events);
  ageContracts(state, events);
  if(state.dv <= 1e-9 && !state.flags.dryWarned){
    state.flags.dryWarned = true;
    events.push({ kind: 'dry' });
    logLine(state, 'dry', TEXT.captainLines.onStranded[0]);
  }
  if(state.dv > 1e-9) state.flags.dryWarned = false;
  return events;
}

export function shipAbsVel(state){
  return add(absState(world, state.ship.body, state.t).v, state.ship.v);
}
export function shipAbsPos(state){
  return add(absState(world, state.ship.body, state.t).r, state.ship.r);
}

function flag(state, name, events){
  if(state.flags[name]) return;
  state.flags[name] = true;
  const text = TEXT.events[name];
  if(text){ logLine(state, 'story', text); events.push({ kind: 'story', name, text }); }
}

/* ------------------------------------------------------------ planning */

export const MAX_NODES = 6;
export const MIN_LEAD = 0.1;
export function addNode(state, t){
  if(state.dockedAt || t < state.t + MIN_LEAD || state.nodes.length >= MAX_NODES) return -1;
  state.nodes.push({ t, prograde: 0, radial: 0 });
  state.nodes.sort((a, b) => a.t - b.t);
  return state.nodes.findIndex(n => n.t === t);
}
export function removeNode(state, index){ state.nodes.splice(index, 1); }

/* Where each mark sits on the current plan, and what it will really cost when
 * it fires. The two numbers on a mark's card are measured along axes that lean
 * together, so their triangle is not the burn: only the state at the moment of
 * firing settles that. */
export function markStates(state, horizon){
  const pred = plan(state, horizon ?? 900);
  return state.nodes.map(n => {
    for(const seg of pred.segments){
      if(n.t >= seg.t0 - 1e-9 && n.t <= seg.t1 + 1e-9){
        const mu = world.get(seg.body).mu;
        const at = propagate(mu, seg.r0, seg.v0, n.t - seg.t0);
        return { node: n, body: seg.body, r: at.r, v: at.v, cost: nodeCost(at.r, at.v, n) };
      }
    }
    return { node: n, body: null, r: null, v: null, cost: nodeMagnitude(n) };
  });
}
/* A mark placed without touching the chart: an eighth of an orbit ahead on a
 * closed path, a day ahead on an open one. The keyboard route to a burn, and
 * the one the lesson can point at. */
export function addNodeAhead(state){
  if(state.dockedAt) return -1;
  const b = world.get(state.ship.body);
  const el = elementsFromState(b.mu, state.ship.r, state.ship.v);
  const ahead = Number.isFinite(el.period) ? el.period / 8 : 1;
  const last = state.nodes.length ? state.nodes[state.nodes.length - 1].t : state.t;
  /* Never closer than half a day. An eighth of a low orbit around a moon is
     under a minute of real time at the slowest warp, which is not enough time
     to drag a handle — the mark would fire, empty, before it was finished. */
  return addNode(state, Math.max(state.t, last) + Math.max(0.5, ahead));
}
export function planCost(state, horizon){
  if(!state.nodes.length) return 0;
  return markStates(state, horizon).reduce((s, m) => s + m.cost, 0);
}

/* The plan as the chart will draw it, with what the tank can pay for. */
export function plan(state, horizon){
  const nodes = effectiveNodes(state, horizon);
  return predict(world, state.ship, state.t, nodes, horizon, { atmosphere: !state.keys.heatShield, dvAvailable: state.dv });
}

/* A first guess good enough to polish: solve for the transfer directly.
 *
 * Lambert's problem answers "leave here, arrive there, in exactly this long"
 * in one step, which is the question a transfer actually is. The frame to ask
 * it in is whichever world both the ship and the target are going round: a
 * moon from its planet, a planet from the Lamp, or a sibling moon seen from
 * the planet they share. Departures across the next couple of orbits are tried
 * against a spread of flight times, and the cheapest the tank can pay for
 * wins. The aim is set a little to one side of the target rather than at its
 * middle, because arriving exactly at a moon's centre is a landing at whatever
 * speed you happen to be doing.
 *
 * Where the ship is inside a moon's reach and the target is not, this ignores
 * the moon's own pull on the way out, so the answer is close rather than
 * right — which is what the walk afterwards is for.
 */
function seedFromLambert(state, targetId, node, scoreFn){
  const here = world.get(state.ship.body);
  const target = world.get(targetId);
  if(!target || here.mu <= 0) return false;
  /* Coming home. Aiming at the world you are going round a moon of is not a
     transfer but a descent: leave the moon going backwards, and fall to a
     kissing distance inside the planet's harbour mouth. Worth solving, because
     it is the most common trip in the game. */
  if(here.parent === targetId) return seedDescent(state, target, here, node, scoreFn);
  for(let a = here; a; a = a.parent ? world.get(a.parent) : null) if(a.id === targetId) return false;
  // The frame both of them share: walk up from here until we reach the world
  // the target goes round.
  let frame = here;
  while(frame && frame.id !== target.parent) frame = frame.parent ? world.get(frame.parent) : null;
  if(!frame || frame.mu <= 0) return false;
  const el = elementsFromState(here.mu, state.ship.r, state.ship.v);
  const localPeriod = Number.isFinite(el.period) ? el.period : null;
  const startAbs = shipAbsPos(state);
  const frameNow = absState(world, frame.id, state.t);
  const r1n = norm(sub(startAbs, frameNow.r));
  // Where the target is now, not the average of where it has ever been: the
  // comet spends most of its life nowhere near its semi-major axis.
  const r2n = norm(sub(absState(world, target.id, state.t).r, frameNow.r));
  const hoh = period(frame.mu, (r1n + Math.max(r2n, target.a * (1 - (target.e ?? 0)))) / 2) / 2;
  const offset = (target.zoneRadius ?? target.soi ?? 0) * 0.4;
  const sameFrame = frame.id === here.id;
  // Leaving a world takes about a quarter of an orbit to line up, so the
  // departure window is the local orbit itself rather than the transfer.
  const localSpan = localPeriod ?? Math.max(2, hoh);
  const ccw = cross(sub(startAbs, frameNow.r), sub(add(frameNow.v, [0, 0]), frameNow.v)) >= 0 ? true : true;
  const candidates = [];
  /* How long the search may wait before burning. Leaving a moon for a sibling
     moon means waiting for them to line up, which takes a synodic period — the
     time for one to lap the other — so that is the window, not one lap of the
     parking orbit. */
  let depTo = sameFrame ? Math.min(localPeriod ? localPeriod * 2 : hoh, Math.max(2, hoh)) : localSpan;
  if(!sameFrame){
    const mine = world.get(here.id), theirs = target;
    if(mine.parent === theirs.parent && mine.parent){
      const mu = world.get(mine.parent).mu;
      const n1 = TAU / period(mu, mine.a), n2 = TAU / period(mu, theirs.a);
      if(Math.abs(n1 - n2) > 1e-12) depTo = Math.min(400, Math.max(depTo, TAU / Math.abs(n1 - n2)));
    }
  }
  /* A long window needs more departures tried and can afford fewer flight
     times each: this is a button press, and a second of frozen page is a
     second the player thinks the game has died. */
  const wide = depTo > (localPeriod ?? 1) * 3;
  const depSteps = wide ? 44 : 28;
  const tofSteps = 18;
  for(let i = 0; i <= depSteps; i++){
    const dep = MIN_LEAD + (depTo - MIN_LEAD) * (i / depSteps);
    const t1 = state.t + dep;
    const local = propagate(here.mu, state.ship.r, state.ship.v, dep);
    const hereAt = absState(world, here.id, t1);
    const frameAt = absState(world, frame.id, t1);
    const r1 = sub(add(hereAt.r, local.r), frameAt.r);
    const v1 = sub(add(hereAt.v, local.v), frameAt.v);
    const hereInFrame = { r: sub(hereAt.r, frameAt.r), v: sub(hereAt.v, frameAt.v) };
    const sense = cross(r1, v1) >= 0;
    for(let j = 0; j <= tofSteps; j++){
      const tof = hoh * (0.25 + (2.75 * j) / tofSteps);
      const tgt = railState(target, frame.mu, t1 + tof);
      const side = scale(unit(perp(tgt.v)), offset);
      for(const sign of [1, -1]){
        const aim = add(tgt.r, scale(side, sign));
        if(sameFrame){
          const sol = lambert(frame.mu, r1, aim, tof, sense);
          if(!sol) continue;
          const dv = sub(sol.v1, v1);
          const cost = norm(dv);
          if(!Number.isFinite(cost) || cost === 0) continue;
          const key = (cost > state.dv ? 1e6 : 0) + cost;
          candidates.push({ key, dep, dv, r: local.r, v: local.v });
        }else{
          /* The ship is inside a smaller world's reach and the target is not,
             so this is a departure, not a transfer: solve the transfer as if it
             began at the moon itself, then work out the burn that leaves the
             moon with exactly that much speed left over. Where on the orbit
             matters as much as how hard — the leftover velocity points where
             the ship was already going, so the burn goes where the two line up. */
          const sol = lambert(frame.mu, hereInFrame.r, aim, tof, sense);
          if(!sol) continue;
          const vinf = sub(sol.v1, hereInFrame.v);
          const vinf2 = dot(vinf, vinf);
          const want = unit(vinf);
          const need = Math.sqrt(Math.max(0, vinf2 - 2 * here.mu / here.soi) + 2 * here.mu / norm(local.r));
          const have = norm(local.v);
          const cost = need - have;
          if(!(cost > 0) || !Number.isFinite(cost)) continue;
          const align = dot(unit(local.v), want);
          // A burn pointing the wrong way round the moon costs far more than
          // this estimate; only keep departures that are roughly aligned.
          if(align < 0.9) continue;
          const key = (cost > state.dv ? 1e6 : 0) + cost + (1 - align) * norm(vinf) * 4;
          candidates.push({ key, dep, dv: scale(unit(local.v), cost), r: local.r, v: local.v });
        }
      }
    }
  }
  void ccw;
  return pickSeed(state, node, candidates, scoreFn);
}

/* Is `ancestorId` one of the worlds `id` goes round, at any depth? */
function isAncestor(ancestorId, id){
  for(let b = world.get(id); b; b = b.parent ? world.get(b.parent) : null) if(b.id === ancestorId) return true;
  return false;
}

/* Coming down from a moon to the world it goes round: aim for an ellipse whose
 * kissing distance sits inside the planet's harbour mouth, and leave the moon
 * with exactly the speed that makes it. The burn goes where the ship's own
 * motion already points the way the departure needs to. */
function seedDescent(state, target, here, node, scoreFn){
  const el = elementsFromState(here.mu, state.ship.r, state.ship.v);
  if(!Number.isFinite(el.period)) return false;
  const t0 = state.t;
  const moonNow = localState(world, here.id, t0);
  const r1 = norm(moonNow.r);
  const candidates = [];
  for(const frac of [0.5, 0.75, 1.0]){
    const rp = target.dockAlt + (target.zoneRadius - target.dockAlt) * frac;
    if(!(rp > 0) || rp >= r1) continue;
    const a = (r1 + rp) / 2;
    const want = Math.sqrt(Math.max(0, target.mu * (2 / r1 - 1 / a)));
    // The moon's own speed, and how much less the ship needs when it leaves.
    for(let i = 0; i <= 48; i++){
      const dep = MIN_LEAD + (el.period - MIN_LEAD) * (i / 48);
      const moonAt = localState(world, here.id, t0 + dep);
      const vinf = sub(scale(unit(moonAt.v), want), moonAt.v);
      const align = dot(unit(propagate(here.mu, state.ship.r, state.ship.v, dep).v), unit(vinf));
      if(align < 0.9) continue;
      const local = propagate(here.mu, state.ship.r, state.ship.v, dep);
      const need = Math.sqrt(Math.max(0, dot(vinf, vinf) - 2 * here.mu / here.soi) + 2 * here.mu / norm(local.r));
      const cost = need - norm(local.v);
      if(!(cost > 0) || !Number.isFinite(cost)) continue;
      candidates.push({ key: cost + (1 - align) * norm(vinf) * 4, dep, dv: scale(unit(local.v), cost), r: local.r, v: local.v });
    }
  }
  return pickSeed(state, node, candidates, scoreFn);
}

/* Try the handful of cheapest guesses against the real predicted road and keep
 * whichever actually arrives nearest: cheapest on paper is not always best once
 * the other worlds have had their say. */
function pickSeed(state, node, candidates, scoreFn){
  if(!candidates.length) return false;
  candidates.sort((a, b) => a.key - b.key);
  let best = null;
  for(const c of candidates.slice(0, 8)){
    const parts = nodeFromVector(c.r, c.v, c.dv);
    if(!parts) continue;
    node.t = state.t + c.dep;
    node.prograde = parts.prograde;
    node.radial = parts.radial;
    node.__r = c.r; node.__v = c.v;
    state.nodes.sort((a, d) => a.t - d.t);
    const s = scoreFn();
    if(!best || s < best.s) best = { s, t: node.t, prograde: node.prograde, radial: node.radial };
  }
  if(!best) return false;
  node.t = best.t; node.prograde = best.prograde; node.radial = best.radial;
  state.nodes.sort((a, d) => a.t - d.t);
  return true;
}

/* Aim. A plan that reaches a world's reach is not the same as a plan that
 * arrives at its harbour, and the difference is a few metres per second nobody
 * should have to find by dragging. This nudges one mark — the last one before
 * the encounter — until the near pass is as close as it can get, by walking
 * each axis in shrinking steps and keeping whatever improves.
 *
 * It is a convenience, not an autopilot: it edits a mark the player can see,
 * change or scrap, it never spends anything, and it can only make the plan
 * they already wrote better at the thing they already aimed at.
 */
export function trimToTarget(state, targetId, horizon){
  if(state.dockedAt || !targetId) return { ok: false, reason: 'Nothing to aim at.' };
  const target = world.get(targetId);
  if(!target) return { ok: false, reason: 'Nothing to aim at.' };
  const inside = target.parent && target.parent !== state.ship.body && world.get(target.parent)?.mu > 0
    && !isAncestor(target.parent, state.ship.body);
  if(inside){
    const parent = world.get(target.parent);
    return { ok: false, reason: `${target.name} is inside ${parent.name}'s reach. Aim for ${parent.name} first.` };
  }
  /* Look far enough ahead to find the encounter and no further. Left to run a
     thousand days, the search will happily find a beautiful pass on the
     fortieth lap, which is not what anybody meant by "aim for it". */
  const here = world.get(state.ship.body);
  const el = elementsFromState(here.mu, state.ship.r, state.ship.v);
  const laps = Number.isFinite(el.period) ? el.period * 8 : 400;
  /* Far enough ahead to contain the crossing itself: a slow road to the Far
     Lantern takes fourteen years, and a search that cannot see the arrival
     scores every guess the same. */
  const anchor = helioOf(state.ship.body) ?? world.root;
  const r1 = norm(shipAbsPos(state));
  const r2 = norm(absState(world, targetId, state.t).r);
  const slow = r1 > 0 && r2 > 0 ? hohmann(CONST.MU_LAMP, r1, r2).time : 0;
  void anchor;
  const span = Math.min(horizon ?? 12000, Math.max(60, laps, slow * 1.6));
  const floor = Math.max(target.radius * 2, (target.zoneRadius ?? 0) * 0.3);
  /* What a patient transfer to this target ought to take, so that waiting can
     be priced against it: a pass four slow roads from now is a bad plan even
     if it is a beautiful one. */
  const reference = (() => {
    const a = world.get(state.ship.body), b = target;
    if(a.id === b.parent && a.mu > 0) return period(a.mu, (norm(state.ship.r) + b.a) / 2) / 2;
    if(a.parent && a.parent === b.parent) return period(world.get(a.parent).mu, (a.a + b.a) / 2) / 2;
    if(a.parent === b.id && b.mu > 0) return period(b.mu, (a.a + (b.dockAlt ?? b.radius)) / 2) / 2;
    return Math.max(2, slow);
  })();
  const score = () => {
    const pred = plan(state, span);
    const ca = closestApproach(world, pred, targetId);
    if(!ca) return Infinity;
    /* Going through the target is worse than passing it, so the score bottoms
       out at the surface; a pass tomorrow beats the same pass a year from now;
       and a road that is flung about by three other worlds on the way is worse
       than a quiet one, however pretty its arrival, because the tenth bounce
       is where a plan stops being something you can rely on. */
    const soon = ((ca.t - state.t) / Math.max(1, reference)) * floor * 0.8;
    const bounces = pred.events.filter(e => e.kind === 'soi' && e.t < ca.t && e.to !== targetId).length;
    /* Flying into something before you get there is not arriving. What the
       road does afterwards is the pilot's business: every arrival is an
       unbraked one until the brake is written down. */
    const crash = pred.events.find(e => e.kind === 'crash');
    const hit = crash && (crash.body === targetId || crash.t <= ca.t + 0.5) ? floor * 40 : 0;
    /* And between two roads that both arrive, the cheaper one is the better
       one. A tenth of a harbour mouth per km/s: enough to break a tie, not
       enough to trade an arrival for a saving. */
    const spend = (nodeCost(node.__r ?? [1, 0], node.__v ?? [0, 1], node) / auDay(1)) * floor * 0.1;
    return Math.max(ca.distance, floor) + soon + bounces * floor * 0.25 + hit + spend;
  };
  // Which mark to work on: the last one before the encounter, or a new one.
  let ix = -1;
  const pred0 = plan(state, span);
  const ca0 = closestApproach(world, pred0, targetId);
  const when = ca0 ? ca0.t : state.t + span;
  for(let i = 0; i < state.nodes.length; i++) if(state.nodes[i].t < when) ix = i;
  let added = false;
  if(ix < 0){
    ix = addNodeAhead(state);
    if(ix < 0) return { ok: false, reason: 'No room for another burn.' };
    added = true;
  }
  const node = state.nodes[ix];
  const before = { prograde: node.prograde, radial: node.radial, t: node.t };
  void node;
  // A mark can be moved as well as pulled. When to burn is most of the art of
  // a transfer — the same push a quarter of an orbit later arrives somewhere
  // else entirely — so the search walks the clock too.
  const earliest = state.t + MIN_LEAD;
  const latest = state.t + Math.max(2, Number.isFinite(el.period) ? el.period * 2 : 20);
  const start = score();
  /* Seed from a direct solve where one exists, so the walk below starts beside
     the answer rather than hunting for it. */
  const seeded = seedFromLambert(state, targetId, node, score);
  let best = score();
  if(seeded && !(best < start)){
    // The guess was worse than what the player already had; keep theirs.
    node.prograde = before.prograde; node.radial = before.radial; node.t = before.t;
    state.nodes.sort((a, c) => a.t - c.t);
    best = start;
  }
  if(!Number.isFinite(best) && !added){
    // The plan does not come near it at all; there is nothing to refine.
    return { ok: false, reason: 'This road does not go near it. Aim it roughly first.' };
  }
  /* If the solved guess already arrives inside the harbour mouth there is
     nothing worth a long walk: polish it finely and stop. A button that thinks
     for four seconds reads as a game that has died. */
  const mouth = target.zoneRadius ?? target.soi ?? floor;
  const arrived = () => {
    const ca = closestApproach(world, plan(state, span), targetId);
    return ca && ca.distance <= mouth;
  };
  const close = seeded && arrived();
  let step = auDay(close ? 0.004 : 0.05);        // 4 m/s when polishing, 50 to search
  let tStep = close ? 0.02 : (Number.isFinite(el.period) ? el.period / 6 : 1);
  const finest = auDay(0.0005);                  // half a metre per second
  const tFinest = 0.002;                         // about three minutes
  const budget = close ? 140 : 900;
  let evaluations = 0;
  while((step > finest || tStep > tFinest) && evaluations < budget){
    let improved = false;
    for(const axis of ['prograde', 'radial']){
      if(step <= finest) continue;
      for(const dir of [1, -1]){
        const was = node[axis];
        node[axis] = was + dir * step;
        const s = score();
        evaluations++;
        if(s < best - 1e-12){ best = s; improved = true; }
        else node[axis] = was;
      }
    }
    if(tStep > tFinest){
      for(const dir of [1, -1]){
        const was = node.t;
        const want = was + dir * tStep;
        if(want < earliest || want > latest) continue;
        node.t = want;
        state.nodes.sort((a, c) => a.t - c.t);
        const s = score();
        evaluations++;
        if(s < best - 1e-12){ best = s; improved = true; }
        else { node.t = was; state.nodes.sort((a, c) => a.t - c.t); }
      }
    }
    if(!improved){ step /= 2; tStep /= 2; }
  }
  if(!Number.isFinite(best)){
    node.prograde = before.prograde; node.radial = before.radial; node.t = before.t;
    state.nodes.sort((a, c) => a.t - c.t);
    if(added) removeNode(state, state.nodes.indexOf(node));
    return { ok: false, reason: 'Nothing this mark can do reaches it.' };
  }
  // The score carries penalties; report the distance the player will actually see.
  const pred = plan(state, span);
  const ca = closestApproach(world, pred, targetId);
  delete node.__r; delete node.__v;
  const mine = markStates(state, span).find(m => m.node === node);
  const cost = mine ? mine.cost : nodeMagnitude(node);
  return {
    ok: true, index: state.nodes.indexOf(node), distance: ca ? ca.distance : best, at: ca ? ca.t : null,
    was: start, cost, added, moved: Math.abs(node.t - before.t),
  };
}

/* Compare a plan with the slow road: the Hohmann between the ship's current
 * distance from the Lamp and the target's, both taken as circles. It is the
 * number competence is measured against. */
export function slowRoad(state, targetId){
  const tb = world.get(targetId);
  if(!tb || tb.parent !== 'lamp') return null;
  const r1 = norm(shipAbsPos(state));
  const r2 = norm(absState(world, targetId, state.t).r);
  return hohmann(CONST.MU_LAMP, r1, r2);
}

/* The heliocentric orbit a port rides: its own, or its planet's for a moon. */
export function helioOf(id){
  let b = world.get(id);
  while(b && b.parent && b.parent !== 'lamp') b = world.get(b.parent);
  return b;
}

/* Kissing distance with the body whose reach we are in: when, how close,
 * how fast, and whether that is inside the harbour mouth. */
export function kiss(state){
  if(state.dockedAt) return null;
  const b = world.get(state.ship.body);
  if(!b.port || b.mu <= 0) return null;
  const el = elementsFromState(b.mu, state.ship.r, state.ship.v);
  /* A ship falling straight down has no periapsis to speak of — the conic is a
     line through the middle of the world. There is no arithmetic to do and one
     thing to say about it. */
  if(Math.abs(el.h) < 1e-14 || el.rp <= b.radius * 0.02){
    const speed = norm(state.ship.v);
    const parked = Math.sqrt(b.mu / Math.max(norm(state.ship.r), b.radius));
    return { port: b.id, t: state.t + 0.01, distance: 0, speed, over: Math.max(0, speed - (b.dockSpeed + parked)), inMouth: true, crashes: true };
  }
  const tp = timeToAnomaly(b.mu, state.ship.r, state.ship.v, 0);
  if(tp == null) return null;
  const at = propagate(b.mu, state.ship.r, state.ship.v, tp);
  const speed = norm(at.v);
  const parked = Math.sqrt(b.mu / Math.max(el.rp, b.radius));
  return { port: b.id, t: state.t + tp, distance: el.rp, speed, over: Math.max(0, speed - (b.dockSpeed + parked)), inMouth: el.rp <= b.zoneRadius, crashes: el.rp <= b.radius };
}

/* Lift the kiss out of the ground. An approach whose periapsis is inside the
 * world is a landing at whatever speed you happen to be doing; this writes the
 * smallest burn that puts it back inside the harbour mouth instead. Radial
 * first, because pushing sideways moves the far end of the path least. */
export function raiseKiss(state, wantRp = null){
  if(state.dockedAt) return -1;
  const b = world.get(state.ship.body);
  if(b.mu <= 0) return -1;
  const target = wantRp ?? Math.max(b.radius * 3, (b.zoneRadius ?? b.radius * 4) * 0.55);
  const t = state.t + 0.05;
  const at = propagate(b.mu, state.ship.r, state.ship.v, 0.05);
  const rpFor = dv => elementsFromState(b.mu, at.r, add(at.v, dv)).rp;
  if(rpFor([0, 0]) >= target) return -1;
  /* Try every direction, not only forward and outward. A ship falling almost
     straight down has hardly any angular momentum, and forward and outward are
     nearly the same line for it: what lifts that kiss is a push across, and a
     search along four axes would report that nothing can be done. */
  const axes = [];
  for(let i = 0; i < 24; i++){
    const th = (i / 24) * TAU;
    axes.push([Math.cos(th), Math.sin(th)]);
  }
  let best = null;
  /* The direct answer, as a candidate of its own: raising a kiss is raising
     angular momentum, and the push that does it is across the line to the
     world, of exactly the size the sums say. Sampled directions can miss it by
     a few degrees, and a few degrees here is a lot of fuel. */
  {
    const rn = norm(at.r), vn = norm(at.v);
    const energy = vn * vn / 2 - b.mu / rn;
    const vAtRp = Math.sqrt(Math.max(0, 2 * (energy + b.mu / target)));
    const wantH = target * vAtRp;
    const haveH = cross(at.r, at.v);
    const across = perp(unit(at.r));
    for(const sign of [1, -1]){
      const need = (sign * wantH - haveH) / rn;
      if(!Number.isFinite(need) || need === 0) continue;
      const mag = Math.abs(need);
      const axis = scale(across, Math.sign(need));
      if(elementsFromState(b.mu, at.r, add(at.v, scale(axis, mag))).rp >= target * 0.98){
        if(!best || mag < best.mag) best = { mag, axis };
      }
    }
  }
  for(const axis of axes){
    // Grow until it clears, then bisect back to the smallest that does.
    let hi = auDay(0.005);
    let ok = false;
    for(let i = 0; i < 22; i++){
      if(rpFor(scale(axis, hi)) >= target){ ok = true; break; }
      hi *= 1.7;
      if(hi > auDay(20)) break;
    }
    if(!ok) continue;
    let lo = 0;
    for(let i = 0; i < 40; i++){
      const mid = (lo + hi) / 2;
      if(rpFor(scale(axis, mid)) >= target) hi = mid; else lo = mid;
    }
    if(!best || hi < best.mag) best = { mag: hi, axis };
  }
  if(!best) return -1;
  // Say nothing rather than something untrue: if the chosen push does not
  // actually clear the ground, or the two axes cannot express it at all, there
  // is no mark worth writing down.
  if(rpFor(scale(best.axis, best.mag)) < target * 0.9) return -1;
  const parts = nodeFromVector(at.r, at.v, scale(best.axis, best.mag));
  if(!parts) return -1;
  const node = { t, ...parts };
  state.nodes = state.nodes.filter(n => Math.abs(n.t - t) > 1e-6);
  state.nodes.push(node);
  state.nodes.sort((a, c) => a.t - c.t);
  return state.nodes.indexOf(node);
}

/* Write down the burn that turns an approach into an arrival: at kissing
 * distance if that is still ahead, and otherwise right now, because a ship
 * already inside the harbour mouth and going too fast has no time to wait for
 * the next one. Ordinary node creation — it can be edited or scrapped. */
export function brakeAtKiss(state){
  const k = kiss(state);
  // A path through the world is not a path to it: lift it first.
  if(k && k.crashes) return raiseKiss(state);
  if(k && k.inMouth && !k.crashes && k.over > 0 && k.t > state.t + 0.02) return brakeAt(state, k.port, k.t);
  const st = dockingStatus(state);
  if(st && st.inZone && !st.ok) return brakeAt(state, st.port, state.t + 0.05);
  return -1;
}

/* A mark at time t that sheds the speed the port cares about: the ship's
 * motion relative to the port, less what a parked orbit would have anyway. */
function brakeAt(state, portId, t){
  const b = world.get(portId);
  const here = world.get(state.ship.body);
  const s = propagate(here.mu, state.ship.r, state.ship.v, t - state.t);
  const port = portId === here.id ? { r: [0, 0], v: [0, 0] } : railState(b, here.mu, t);
  const rel = sub(s.v, port.v);
  const speed = norm(rel);
  const gap = dist(s.r, port.r);
  const parked = b.mu > 0 ? Math.sqrt(b.mu / Math.max(gap, b.radius)) : 0;
  const target = parked + b.dockSpeed * 0.7;
  if(speed <= target) return -1;
  const dv = scale(unit(rel), -(speed - target));
  const parts = nodeFromVector(s.r, s.v, dv);
  if(!parts) return -1;
  const node = { t, ...parts };
  state.nodes = state.nodes.filter(n => Math.abs(n.t - t) > 1e-6);
  state.nodes.push(node);
  state.nodes.sort((a, c) => a.t - c.t);
  return state.nodes.indexOf(node);
}

/* The next transfer window (a festival, in-world) from where the ship is to
 * a target on its own orbit around the Lamp: the moment the target leads by
 * the Hohmann phase angle. Circular-orbit arithmetic, which is what a
 * festival calendar would print. Null when there is no such window. */
export function nextWindow(state, targetId){
  const T = helioOf(targetId);
  const here = state.dockedAt ? helioOf(state.dockedAt) : null;
  if(!T || T.id === 'lamp') return null;
  const r1 = here ? here.a : norm(shipAbsPos(state));
  const r2 = T.a;
  if(Math.abs(r1 - r2) < 0.02) return null;
  const n1 = Math.sqrt(CONST.MU_LAMP / (r1 ** 3)), n2 = Math.sqrt(CONST.MU_LAMP / (r2 ** 3));
  const hh = hohmann(CONST.MU_LAMP, r1, r2);
  const phi = Math.PI - n2 * hh.time;                   // how far ahead the target must be at departure
  const p1 = here ? absState(world, here.id, state.t).r : shipAbsPos(state);
  const p2 = absState(world, T.id, state.t).r;
  const lead = Math.atan2(p2[1], p2[0]) - Math.atan2(p1[1], p1[0]);
  const rate = n2 - n1;
  if(Math.abs(rate) < 1e-12) return null;
  const wrap = x => ((x % TAU) + TAU) % TAU;
  const dt = rate > 0 ? wrap(phi - lead) / rate : wrap(lead - phi) / -rate;
  return { days: dt, t: state.t + dt, hohmann: hh, target: T.id, synodic: TAU / Math.abs(rate) };
}

/* ------------------------------------------------------------ markets */

/* Nearest producer of a good to this port right now, in au. Alignment: a
 * market grows hungry as its supplier swings away across the sky. */
export function supplierDistance(portId, goodId, t){
  const g = goodById(goodId);
  const here = absState(world, portId, t).r;
  let best = Infinity;
  for(const p of g.producedAt){
    if(p === portId) return 0;
    const d = dist(here, absState(world, p, t).r);
    if(d < best) best = d;
  }
  return best;
}

export function alignmentMul(portId, goodId, t){
  const f = FORMULAS.alignment;
  const g = goodById(goodId);
  if(!g.producedAt.length || g.producedAt.includes(portId)) return 1;
  // Nearest producer now, then how that sits between the closest and the
  // farthest the two orbits ever bring them.
  const here = absState(world, portId, t).r;
  let best = null;
  for(const p of g.producedAt){
    const d = dist(here, absState(world, p, t).r);
    if(!best || d < best.d) best = { d, p };
  }
  const A = helioOf(portId), B = helioOf(best.p);
  if(!A || !B || A.id === B.id) return 1;
  const dmin = Math.max(0, Math.abs(A.a - B.a) - (A.a * (A.e ?? 0) + B.a * (B.e ?? 0)));
  const dmax = Math.min(f.maxSeparationAu, A.a * (1 + (A.e ?? 0)) + B.a * (1 + (B.e ?? 0)));
  if(dmax - dmin < 0.05) return 1;
  const x = Math.max(0, Math.min(1, (best.d - dmin) / (dmax - dmin)));
  return Math.max(f.minMul, Math.min(f.maxMul, 1 + f.k * (x - 0.5)));
}

function decayed(entry, t){
  if(!entry) return 0;
  return entry.q * Math.pow(0.5, (t - entry.t) / FORMULAS.saturation.halfLifeDays);
}
const q0For = portId => FORMULAS.saturation.q0 * (PORTS[portId].marketSize ?? 1);
export function saturationMul(state, portId, goodId){
  const m = state.markets[portId];
  const q = decayed(m?.sold?.[goodId], state.t);
  const q0 = q0For(portId);
  return q0 / (q0 + q);
}
function scarcityMul(state, portId, goodId){
  const m = state.markets[portId];
  const q = decayed(m?.bought?.[goodId], state.t);
  return 1 + 0.5 * (q / q0For(portId));
}

/* Emberkin fashion: a slow wave per good, so what Cinder wants this week is
 * not what it wanted last week. Otter haggle: a daily jitter, the ritual
 * without the dialogue. Frogs: neither. */
function speciesMood(portId, goodId, t){
  const sp = PORTS[portId].species;
  const g = goodById(goodId);
  const vol = FORMULAS.volatility.bySpecies[sp] ?? 0;
  let m = 1;
  if(vol && (g.category === 'luxury' || g.category === 'perishable' || sp === 'cat')){
    // Two slow waves per good, so the wobble does not repeat every three weeks.
    m *= 1 + vol * (0.6 * Math.sin(TAU * t / 23 + hash(goodId) * TAU) + 0.4 * Math.sin(TAU * t / 61 + hash(goodId, 'b') * TAU));
  }
  if(sp === 'otter'){
    const spread = FORMULAS.haggle.spread;
    m *= 1 - spread + 2 * spread * hash(portId, goodId, Math.floor(t));
  }
  return m;
}

export function repDiscount(state, species){
  const f = FORMULAS.reputation;
  const pts = Math.min(f.maxPoints ?? 10, Math.max(0, state.rep[species] ?? 0));
  return Math.min(f.maxDiscount, pts * f.discountPerPoint);
}

/* What the port charges for one unit. Null if it does not sell it. */
export function buyPrice(state, portId, goodId){
  const p = PORTS[portId];
  const row = p.sells.find(s => s.good === goodId);
  if(!row) return null;
  const g = goodById(goodId);
  let price = g.basePrice * row.priceMul * speciesMood(portId, goodId, state.t) * scarcityMul(state, portId, goodId);
  price *= 1 - repDiscount(state, p.species);
  return Math.max(1, Math.round(price));
}

/* What the port pays for one unit, fresh. Everyone buys everything at some
 * price; the ones who want it pay for it. */
export function sellPrice(state, portId, goodId, boughtAt = null){
  const p = PORTS[portId];
  const g = goodById(goodId);
  const row = p.buys.find(s => s.good === goodId);
  const demand = g.demandBy?.[p.species] ?? 1;
  const mul = row ? row.priceMul : FORMULAS.market.disinterestMul;
  let price = g.basePrice * mul * demand * alignmentMul(portId, goodId, state.t)
    * saturationMul(state, portId, goodId) * speciesMood(portId, goodId, state.t);
  price *= 1 + repDiscount(state, p.species) * 0.5;
  if(boughtAt != null) price *= freshness(g, state.t - boughtAt);
  /* A port that sells this itself will never pay more than it asks. Otherwise
     a stall with a low price and no entry on its buying list is a money pump
     you never have to leave the dock to work. */
  if(row == null && p.sells.some(x => x.good === goodId)){
    price = Math.min(price, buyPrice(state, portId, goodId) * FORMULAS.market.resaleCap);
  }
  return Math.max(1, Math.round(price));
}

export function saturationWords(mul){
  return mul >= 0.95 ? 'they want more' : mul >= 0.8 ? 'they have some' : mul >= 0.6 ? 'they have plenty' : 'they are sick of it';
}
export function freshnessWords(g, ageDays){
  if(!g.lifetimeDays) return '';
  const f = 1 - ageDays / g.lifetimeDays;
  return f <= 0 ? 'spoiled' : f < 0.25 ? 'spoiling' : f < 0.5 ? 'turning' : f < 0.75 ? 'ripe' : 'fresh';
}
export function freshness(g, ageDays){
  if(!g.lifetimeDays) return 1;
  return Math.max(FORMULAS.perishable.floor, 1 - ageDays / g.lifetimeDays);
}

export function stockAvailable(state, portId, goodId){
  const row = PORTS[portId].sells.find(s => s.good === goodId);
  if(!row) return 0;
  const m = state.markets[portId];
  const taken = decayed(m?.bought?.[goodId], state.t);
  return Math.max(0, Math.round(row.stock - taken));
}

function market(state, portId){
  return state.markets[portId] ??= { sold: {}, bought: {} };
}
function bump(book, goodId, qty, t){
  const e = book[goodId];
  const q = e ? decayed(e, t) : 0;
  book[goodId] = { q: q + qty, t };
}

export function canBuy(state, goodId, qty){
  const port = state.dockedAt;
  if(!port) return { ok: false, reason: 'Not docked.' };
  if(!portOpen(port, state.t)) return { ok: false, reason: 'The market is closed.' };
  const g = goodById(goodId);
  const price = buyPrice(state, port, goodId);
  if(price == null) return { ok: false, reason: 'Not sold here.' };
  if(g.needsRefrigeration && !state.keys.refrigeration) return { ok: false, reason: 'Needs refrigeration.' };
  if(stockAvailable(state, port, goodId) < qty) return { ok: false, reason: 'Not enough in stock.' };
  if(freeUnits(state) < qty * g.units) return { ok: false, reason: 'No room in the hold.' };
  if(state.money < price * qty) return { ok: false, reason: 'Not enough coin.' };
  return { ok: true, price };
}

export function buy(state, goodId, qty){
  const c = canBuy(state, goodId, qty);
  if(!c.ok) return c;
  const port = state.dockedAt;
  const total = c.price * qty;
  state.money -= total;
  bump(market(state, port).bought, goodId, qty, state.t);
  // Stacks are split by purchase time, because freshness is per crate.
  const stack = state.cargo.find(s => s.good === goodId && Math.abs(s.t - state.t) < 1e-9 && s.price === c.price);
  if(stack) stack.qty += qty; else state.cargo.push({ good: goodId, qty, t: state.t, price: c.price, from: port });
  state.stats.bought += qty;
  if(PORTS[port].species === 'frog') state.rep.frog += 0.05 * qty;   // frogs give; taking is how you let them
  logLine(state, 'bought', TEXT.logTemplates.bought, { qty, good: goodById(goodId).name, price: fmtMoney(total), port: portName(port) });
  return { ok: true, total };
}

/* Sell from the oldest stack first: the crate going off is the one to move. */
export function sell(state, goodId, qty){
  const port = state.dockedAt;
  if(!port) return { ok: false, reason: 'Not docked.' };
  if(!portOpen(port, state.t)) return { ok: false, reason: 'The market is closed.' };
  const stacks = state.cargo.filter(s => s.good === goodId).sort((a, b) => a.t - b.t);
  const have = stacks.reduce((s, c) => s + c.qty, 0);
  if(have < qty || qty <= 0) return { ok: false, reason: 'Not that many aboard.' };
  let left = qty, total = 0, cost = 0;
  for(const s of stacks){
    if(left <= 0) break;
    const take = Math.min(left, s.qty);
    const unitPrice = sellPrice(state, port, goodId, s.t);
    total += unitPrice * take; cost += s.price * take;
    s.qty -= take; left -= take;
    // Saturation is applied as we go, so a big sale walks the price down.
    bump(market(state, port).sold, goodId, take, state.t);
  }
  state.cargo = state.cargo.filter(s => s.qty > 0);
  state.money += total;
  state.stats.sold += qty;
  const sp = PORTS[port].species;
  const g = goodById(goodId);
  if(sp in state.rep && (g.demandBy?.[sp] ?? 1) > 1) state.rep[sp] += 0.1 * qty * Math.min(1, g.basePrice / 100);
  logLine(state, 'sold', TEXT.logTemplates.sold, { qty, good: g.name, price: fmtMoney(total), port: portName(port) });
  return { ok: true, total, profit: total - cost };
}

export function cargoValue(state, portId = null){
  // Valued at the going rate here if docked, else at base.
  return state.cargo.reduce((s, c) => {
    const g = goodById(c.good);
    const unitPrice = portId ? sellPrice(state, portId, c.good, c.t) : g.basePrice * freshness(g, state.t - c.t);
    return s + unitPrice * c.qty;
  }, 0);
}

/* ---------------------------------------------------------------- fuel */

export function fuelPrice(state, portId = state.dockedAt){
  const p = PORTS[portId];
  if(!p || p.fuelPricePerKms == null) return null;
  return p.fuelPricePerKms * fuelPriceMul(state) * (1 - repDiscount(state, p.species) * 0.5);
}
/* A ship with no fuel and no coin, tied up at a dock, is a ship that can never
 * leave — and the design document is clear that nothing may cost the save. So
 * Ledger will front enough to get going again, at a price, exactly as they do
 * for a tow. It is a floor, not a facility: it only opens when the tank is
 * nearly dry and the purse cannot cover it, and only up to what it takes to
 * reach the next port. */
export const CREDIT_KMS = 3;
export function fuelCredit(state){
  const price = fuelPrice(state);
  if(price == null) return 0;
  if(kms(state.dv) >= CREDIT_KMS) return 0;
  const short = CREDIT_KMS - kms(state.dv);
  const canPay = state.money / price;
  return Math.max(0, short - canPay);
}

export function refuel(state, kmsWanted){
  const price = fuelPrice(state);
  if(price == null) return { ok: false, reason: 'No fuel sold here.' };
  const room = kms(state.tank - state.dv);
  let amount = Math.min(kmsWanted, room);
  if(amount <= 0) return { ok: false, reason: 'The tank is full.' };
  const credit = fuelCredit(state);
  const affordable = state.money / price + credit;
  if(affordable <= 0) return { ok: false, reason: 'Not enough coin.' };
  amount = Math.min(amount, affordable);
  const cost = amount * price;
  const borrowed = Math.max(0, cost - state.money);
  state.money -= cost;
  if(state.money < 0){ state.debt += -state.money; state.money = 0; }
  state.dv = Math.min(state.tank, state.dv + auDay(amount));
  logLine(state, 'refuelled', TEXT.logTemplates.refuelled, { amount: `${amount.toFixed(1)} km/s`, price: fmtMoney(cost), port: portName(state.dockedAt) });
  if(borrowed > 0) logLine(state, 'story', TEXT.events.ledgerDebt);
  return { ok: true, amount, cost, borrowed };
}

/* ------------------------------------------------------------ upgrades */

export function upgradesFor(portId){
  return UPGRADES.filter(u => u.soldAt && u.soldAt.includes(portId));
}
export function ownsUpgrade(state, u){
  if(u.kind === 'key') return !!state.keys[u.key];
  return state.tiers[u.kind] >= u.tier;
}
export function canBuyUpgrade(state, id){
  const u = upgradeById(id);
  const port = state.dockedAt;
  if(!u || !port) return { ok: false, reason: 'Not docked.' };
  if(!u.soldAt || !u.soldAt.includes(port)) return { ok: false, reason: 'Not sold here.' };
  if(ownsUpgrade(state, u)) return { ok: false, reason: 'Already fitted.' };
  if(u.kind !== 'key' && state.tiers[u.kind] !== u.tier - 1) return { ok: false, reason: 'Needs the tier below first.' };
  if(u.minRep && (state.rep[u.minRep.species] ?? 0) < u.minRep.value) return { ok: false, reason: `${SPECIES[u.minRep.species].plural} do not know you well enough yet.` };
  const price = Math.round(u.price * (1 - repDiscount(state, PORTS[port].species)));
  if(state.money < price) return { ok: false, reason: 'Not enough coin.', price };
  return { ok: true, price };
}
export function buyUpgrade(state, id){
  const c = canBuyUpgrade(state, id);
  if(!c.ok) return c;
  const u = upgradeById(id);
  state.money -= c.price;
  grantUpgrade(state, u);
  logLine(state, 'upgraded', TEXT.logTemplates.upgraded, { name: u.name, port: portName(state.dockedAt) });
  return { ok: true, price: c.price };
}
export function grantUpgrade(state, u){
  if(u.kind === 'key'){ state.keys[u.key] = true; return; }
  state.tiers[u.kind] = u.tier;
  if(u.kind === 'tank'){
    const newTank = auDay(u.value);
    state.dv += newTank - state.tank;   // a bigger tank comes full of what it cost
    state.tank = newTank;
  }
}

/* ----------------------------------------------------------- contracts */

const climateOf = id => world.get(id).climate;
const isMicro = id => climateOf(id) === 'micro';

function destinationsFor(template, from){
  return portIds.filter(id => {
    if(id === from) return false;
    const b = world.get(id);
    if(!b.port) return false;
    if(!PORTS[id].passengers && template.kind === 'passenger') return false;
    if(template.toClimate && !template.toClimate.includes(climateOf(id))) return false;
    if(template.toPorts && !template.toPorts.includes(id)) return false;
    if(template.species === 'cat' && !isMicro(id)) return false;
    if(template.species === 'frog' && !['cold'].includes(climateOf(id))) return false;
    if(template.species === 'emberkin' && !['hot', 'temperate'].includes(climateOf(id))) return false;
    return true;
  });
}

function routeDays(from, to, t){
  // The slow road between the two orbital radii, or a moon hop if siblings.
  const a = world.get(from), b = world.get(to);
  if(a.parent === b.parent && a.parent !== 'lamp'){
    const mu = world.get(a.parent).mu;
    return hohmann(mu, a.a, b.a).time + 1;
  }
  const r1 = norm(absState(world, from, t).r), r2 = norm(absState(world, to, t).r);
  return hohmann(CONST.MU_LAMP, r1, r2).time;
}

export function refreshOffers(state, portId, force = false) {
  const existing = state.offers[portId];
  if(existing && !force && state.t - existing.t < FORMULAS.contract.refreshDays) return existing.contracts;
  const p = PORTS[portId];
  const f = FORMULAS.contract;
  const contracts = [];
  const templates = CONTRACT_TEMPLATES.filter(tp =>
    (!tp.fromPorts || tp.fromPorts.includes(portId)) &&
    (!tp.fromClimate || tp.fromClimate.includes(climateOf(portId))) &&
    (tp.species !== 'cat' || isMicro(portId)) &&
    (tp.species !== 'frog' || climateOf(portId) === 'cold') &&
    (tp.species !== 'emberkin' || ['hot', 'temperate'].includes(climateOf(portId))));
  const want = p.passengers ? 3 + Math.floor(rnd(state) * 3) : 0;
  let guard = 0;
  while(contracts.length < want && guard++ < 40 && templates.length){
    const tp = templates[Math.floor(rnd(state) * templates.length)];
    const dests = destinationsFor(tp, portId);
    if(!dests.length) continue;
    const to = dests[Math.floor(rnd(state) * dests.length)];
    if(contracts.some(c => c.to === to && c.species === tp.species)) continue;
    const d = dist(absState(world, portId, state.t).r, absState(world, to, state.t).r);
    const slow = routeDays(portId, to, state.t);
    const kinds = Object.keys(f.deadlineDays);
    const tightness = kinds[Math.floor(rnd(state) * kinds.length)];
    const deadline = state.t + slow * f.tightnessOverHohmann[tightness] + 3;
    const pay = Math.round(f.basePerAu * Math.max(f.minAu, d) * f.deadlineDays[tightness] * (f.speciesMul[tp.species] ?? 1) * tp.payMul);
    const lines = TEXT.species[tp.species]?.passengerRequests ?? ['A quiet trip, please.'];
    contracts.push({
      id: `${portId}-${to}-${Math.floor(rnd(state) * 1e9).toString(36)}`,
      kind: tp.kind, species: tp.species, from: portId, to, pay, deadline,
      units: tp.units ?? 1, needs: tp.needs ?? [], tightness,
      title: fill(tp.text, { to: portName(to), from: portName(portId) }),
      line: lines[Math.floor(rnd(state) * lines.length)],
      offeredAt: state.t,
    });
  }
  state.offers[portId] = { t: state.t, contracts };
  return contracts;
}

export function canTake(state, contract){
  if(!state.dockedAt || contract.from !== state.dockedAt) return { ok: false, reason: 'Not here.' };
  if(state.passengers.some(p => p.id === contract.id)) return { ok: false, reason: 'Already aboard.' };
  if(contract.needs.includes('refrigeration') && !state.keys.refrigeration) return { ok: false, reason: 'Needs refrigeration.' };
  if(freeUnits(state) < contract.units) return { ok: false, reason: 'No room aboard.' };
  return { ok: true };
}
export function takeContract(state, id){
  const offers = state.offers[state.dockedAt]?.contracts ?? [];
  const c = offers.find(o => o.id === id);
  if(!c) return { ok: false, reason: 'Gone.' };
  const ok = canTake(state, c);
  if(!ok.ok) return ok;
  state.passengers.push({ ...c, takenAt: state.t });
  state.offers[state.dockedAt].contracts = offers.filter(o => o.id !== id);
  logLine(state, 'contractTaken', TEXT.logTemplates.contractTaken, { title: c.title, to: portName(c.to), pay: fmtMoney(c.pay) });
  if(!state.flags.contractsIntro){ state.flags.contractsIntro = true; }
  return { ok: true };
}

function deliverHere(state, portId){
  const done = [];
  const f = FORMULAS.contract;
  for(const c of [...state.passengers]){
    if(c.to !== portId) continue;
    const late = state.t > c.deadline;
    const span = c.deadline - c.takenAt;
    const early = !late && (state.t - c.takenAt) < span * f.earlyFraction;
    let pay = c.pay;
    if(late) pay = Math.round(pay * f.latePayMul);
    else if(early) pay = Math.round(pay * (1 + f.earlyBonus));
    state.money += pay;
    state.passengers = state.passengers.filter(p => p.id !== c.id);
    state.stats.deliveries++;
    const sp = c.species;
    if(sp in state.rep) state.rep[sp] += late ? -0.5 : 1;
    const say = late ? TEXT.species[sp].onLateArrival : (early ? TEXT.species[sp].onFastArrival : TEXT.species[sp].onGift);
    logLine(state, late ? 'contractLate' : 'contractDone', late ? TEXT.logTemplates.contractLate : TEXT.logTemplates.contractDone, { title: c.title, pay: fmtMoney(pay), port: portName(portId) });
    done.push({ contract: c, pay, late, early, say });
  }
  return done;
}

function ageContracts(state, events = []){
  for(const c of state.passengers){
    if(!c.lateNoted && state.t > c.deadline){
      c.lateNoted = true;
      events.push({ kind: 'late', contract: c });
    }
  }
}

/* --------------------------------------------------------------- tolls */

/* The Scatter: crossing into the belt in the Lamp's frame, without a stealth
 * system, brings a cat captain alongside. Once per crossing, and never twice
 * inside a month: the oath is a toll, not a tax. */
function tollCheck(state, events){
  const inLamp = state.ship.body === 'lamp';
  const r = inLamp ? norm(state.ship.r) : norm(shipAbsPos(state));
  const inBelt = r >= CONST.BELT.inner && r <= CONST.BELT.outer;
  const was = state.toll.inBelt;
  state.toll.inBelt = inBelt;
  if(!inBelt || was || !inLamp) return;
  if(state.t - state.toll.lastT < FORMULAS.toll.cooldownDays) return;
  state.toll.lastT = state.t;
  if(state.keys.stealth){
    logLine(state, 'story', TEXT.events.tollStealth);
    events.push({ kind: 'story', name: 'tollStealth', text: TEXT.events.tollStealth });
    return;
  }
  const f = FORMULAS.toll;
  const value = cargoValue(state);
  const variant = TEXT.events.tollOffer[Math.floor(rnd(state) * TEXT.events.tollOffer.length)];
  if(value < f.minCargoValue){
    const text = fill(TEXT.events.tollWaved ?? '{captain} looks over an empty hold, laughs, and waves you through.', { captain: variant.captain });
    logLine(state, 'story', text);
    events.push({ kind: 'story', name: 'tollWaved', text });
    return;
  }
  const amount = Math.round(Math.min(f.cap, f.fraction * value));
  state.pending = { kind: 'toll', amount, captain: variant.captain, line: variant.line, cargoValue: value };
  events.push({ kind: 'toll', pending: state.pending });
}

export function resolveToll(state, choice){
  const p = state.pending;
  if(!p || p.kind !== 'toll') return { ok: false };
  const f = FORMULAS.toll;
  let text;
  if(choice === 'coin'){
    // Never everything: at most half of what is in the purse.
    const paid = Math.min(p.amount, Math.max(0, state.money) * 0.5);
    state.money -= paid;
    text = fill(TEXT.events.tollPaidCoin, { amount: fmtMoney(paid), captain: p.captain });
    state.rep.cat += 1;
  }else{
    // Take crates by value until the toll is met, but never more than the cap of the hold.
    let owed = p.amount;
    const maxUnits = Math.floor(usedUnits(state) * f.maxCargoFraction);
    let takenUnits = 0;
    const taken = [];
    for(const s of [...state.cargo].sort((a, b) => goodById(b.good).basePrice - goodById(a.good).basePrice)){
      const g = goodById(s.good);
      while(s.qty > 0 && owed > 0 && takenUnits + g.units <= maxUnits){
        s.qty--; owed -= g.basePrice; takenUnits += g.units;
        const rec = taken.find(t => t.good === s.good); if(rec) rec.qty++; else taken.push({ good: s.good, qty: 1 });
      }
    }
    state.cargo = state.cargo.filter(s => s.qty > 0);
    const list = taken.map(t => `${t.qty} ${goodById(t.good).name}`).join(', ') || 'nothing at all';
    text = fill(TEXT.events.tollPaidCargo, { cargo: list, captain: p.captain });
    state.rep.cat += 1.5;
  }
  state.stats.tolls++;
  state.pending = null;
  logLine(state, 'tolled', TEXT.logTemplates.tolled, { captain: p.captain });
  // A captain you impressed may send something later. Remembered, not rolled now.
  if(state.rep.cat >= f.giftRep && rnd(state) < f.giftChance) state.flags.catGiftDue = true;
  return { ok: true, text };
}

/* ------------------------------------------------------------- rescue */

export function nearestPort(state){
  const here = shipAbsPos(state);
  let best = null;
  for(const id of portIds){
    const b = world.get(id);
    if(!b.port) continue;
    if(!portOpen(id, state.t) && !PORTS[id].towAllowed) continue;
    const d = dist(here, absState(world, id, state.t).r);
    if(!best || d < best.d) best = { id, d };
  }
  return best;
}

export function towQuote(state){
  const near = nearestPort(state);
  const f = FORMULAS.tow;
  const days = Math.max(f.minDays, f.daysPerAu * near.d);
  const cost = Math.round(f.base + f.perAu * near.d);
  return { port: near.id, distance: near.d, days, cost };
}

/* A tow, or the aftermath of a crash: the ship arrives at the nearest port,
 * later and poorer, with its cargo and its story. Coin can go negative; that
 * is a debt to Ledger, who are delighted. */
export function callTow(state, reason = 'dry'){
  const q = towQuote(state);
  const mul = reason === 'crash' ? FORMULAS.tow.crashMul : 1;
  const cost = Math.round(q.cost * mul);
  state.money -= cost;
  if(state.money < 0){ state.debt += -state.money; state.money = 0; }
  state.t += q.days;
  state.nodes = [];
  state.pending = null;
  state.dockedAt = q.port;
  placeDocked(state, q.port);
  state.stats.tows++;
  const pool = reason === 'crash' ? TEXT.events.towCrash : TEXT.events.towDry;
  const story = reason === 'atmosphere' ? TEXT.events.towAtmosphere : pool[Math.floor(rnd(state) * pool.length)];
  logLine(state, 'towed', TEXT.logTemplates.towed, { port: portName(q.port), cost: fmtMoney(cost), days: fmtDays(q.days) });
  if(state.debt > 0) logLine(state, 'story', TEXT.events.ledgerDebt);
  refreshOffers(state, q.port, true);
  const delivered = deliverHere(state, q.port);
  ageContracts(state);
  return { ...q, cost, story, delivered };
}

/* Paying Ledger back happens whenever there is coin: quietly, first. */
export function settleDebt(state){
  if(state.debt <= 0 || state.money <= 0) return 0;
  const pay = Math.min(state.debt, state.money);
  state.debt -= pay; state.money -= pay;
  return pay;
}

/* --------------------------------------------------------- milestones */

function milestonesOnDock(state, port, events){
  const say = (name) => {
    if(state.flags[name]) return;
    state.flags[name] = true;
    const text = TEXT.events[name];
    if(text){ logLine(state, 'story', text); events.push({ kind: 'story', name, text }); }
  };
  if(port === 'merrow') say('cometCaught');
  if(port === 'chime') say('chimeArrival');
  if(port === 'mossback') say('mossbackHeartbeat');
  if(port === 'hush'){
    say('hushRelic');
    if(!state.keys.stealth){
      const relic = UPGRADES.find(u => u.key === 'stealth');
      if(relic){ grantUpgrade(state, relic); logLine(state, 'upgraded', TEXT.logTemplates.upgraded, { name: relic.name, port: portName(port) }); events.push({ kind: 'upgrade', id: relic.id }); }
    }
  }
  if(port === 'lantern') say('lanternArrival');
  if(state.flags.catGiftDue && PORTS[port].species !== 'cat'){
    state.flags.catGiftDue = false;
    const gift = Math.round(200 + 400 * rnd(state));
    state.money += gift;
    logLine(state, 'story', fill(TEXT.events.tollGiftLater, { amount: fmtMoney(gift) }));
    events.push({ kind: 'story', name: 'tollGiftLater', text: fill(TEXT.events.tollGiftLater, { amount: fmtMoney(gift) }) });
  }
  const paid = settleDebt(state);
  if(paid) events.push({ kind: 'debtPaid', amount: paid });
}

/* ------------------------------------------------------------ persist */

export function serialize(state){ return JSON.stringify(state); }
export function restore(json){
  const s = typeof json === 'string' ? JSON.parse(json) : json;
  if(!s || s.version !== 1 || !s.ship || !Array.isArray(s.nodes)) throw new Error('Not a save this game understands.');
  // Old saves may lack later fields; fill quietly.
  s.pending ??= null; s.flags ??= {}; s.stats ??= {}; s.visited ??= [s.dockedAt].filter(Boolean);
  s.toll ??= { lastT: -1e9, inBelt: false };
  s.debt ??= 0; s.target ??= null; s.justLeft ??= null;
  return s;
}

/* Everything a target readout wants: the approach, the slow-road comparison. */
export function approachTo(state, prediction, targetId){
  if(!targetId || !prediction) return null;
  const tb = world.get(targetId);
  const within = tb.soi ?? (tb.zoneRadius ? tb.zoneRadius * 40 : 0.5);
  return closestApproach(world, prediction, targetId, Math.max(within, 0.05) * 3);
}

export { elementsFromState, propagate, absState, railState, predict, norm, sub, add, scale, unit, perp, dist, hohmann };
