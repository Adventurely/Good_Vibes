/* Orbital Trader: the rules.
 *
 * Pure functions over one plain state object: what a tick does, what docking
 * means, what a crate of Moss apples is worth on Haven today. The page
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
  makeWorld, predict, predictLegs, absState, railState, circularState, elementsFromState,
  timeToAnomaly, propagate, hohmann, lambert, period, norm, sub, add, scale, unit, perp, dist,
  closestApproach, nodeMagnitude, nodeCost, nodeFromVector, cross, dot, localState, TAU,
  /* aliased: seedFromLambert has a local `frameAt` of its own, and two things
     of that name one function apart is a trap waiting for the next edit. */
  frameAt as burnFrameAt, driftTargetAt,
} from './orbit.js';
import {
  CONST, BODIES, GOODS, PORTS, UPGRADES, FORMULAS, TEXT, SPECIES,
  REGION_OF, wantsGood, lovesGood, QUESTS as QUESTBOOK, RELICS as RELICBOOK, DIALOG,
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
    /* 6: the rack was rebuilt — four sizes of tank and hold instead of three,
       no engines to buy, and keys that are fitted rather than sold. Before
       that, 5 took the contract board and the passenger list away, 4 replaced
       every good in the sky and 3 replaced the sky itself. A save from any of
       them describes a game this one is not playing, so they are refused
       rather than repaired: the page catches it and opens a new game, which is
       the honest outcome when the world under a ship has changed shape. */
    version: 6,
    seed, rng: (seed * 2654435761) >>> 0 || 1,
    t: 0, warp: 1, paused: false,
    shipName: TEXT.shipNames[Math.abs(seed) % TEXT.shipNames.length],
    ship: { body: start, r: [0, 0], v: [0, 0] },
    dockedAt: start,
    tiers: { tank: 0, hold: 0 },
    keys: { heatShield: false, tempControl: false, gravSensors: false, cryoCooling: false, astrolabe: false },
    tank: 0, dv: 0,
    money: CONST.START_MONEY, debt: 0,
    cargo: [],
    /* markets holds, per port, what you have taken off its shelves this visit
       (`bought`) and which visit that was (`visit`). It used to also hold what
       you had landed there lately, for a saturation rule that is gone.
       marketEpoch turns over every time you tie up somewhere other than where
       you last tied up, which is what makes a stall find more stock while you
       were away. */
    markets: {},
    marketEpoch: 0,
    lastMarket: null,
    rep: { emberkin: 0, otter: 0, cat: 0, frog: 0 },
    /* Relics: things you are given or find rather than things you buy and
       carry. A relic is not cargo — it has no weight, it cannot be sold, a
       toll cannot take it and a tow cannot lose it — and it is not a ship
       system either, so it does not live in `keys`. An open bag rather than a
       fixed one, because what is in it is a fact about the story you have got
       through rather than about the ship. */
    relics: {},
    /* Three berths, and nobody in them. The line pays out an Emberkin
       engineer, a cat navigator and a frog appraiser; until there is a board
       to take those jobs from, this is a list of who is missing. */
    crew: { engineer: null, navigator: null, appraiser: null },
    nodes: [],
    quests: [],
    target: null,
    log: [],
    flags: { tutorial: 0 },
    toll: { lastT: -1e9, inBelt: false },
    pending: null,
    hull: 0,
    faults: {},
    farSight: true,
    justLeft: null, justLeftAt: -1e9,
    stats: { burns: 0, dvSpent: 0, docks: 0, sold: 0, bought: 0, tows: 0, tolls: 0, rescues: 0, farthest: 0 },
    visited: [start],
    /* The last mooring this ship was tied up at, which is not the same thing
       as the first entry in `visited` and not the same thing as the nearest
       port either. It is who comes out when you call for help. */
    lastPort: start,
  };
  state.tank = auDay(tiers('tank')[0].value);
  state.dv = state.tank;
  /* The game opens in flight, not at a mooring. There is no landing in
     Orbital Trader — every harbour is a parking orbit — so the honest first
     frame is the ship already going round Tassel with a road drawn ahead of
     it. Nothing to cast off from, nothing to press before the chart means
     something. And it opens *low*: close enough in that the world fills the
     chart and a lap is ten real minutes, not a fortnight of nothing. */
  placeStart(state, start);
  state.dockedAt = null;
  state.justLeft = start;          // Tassel's own mouth is where we started
  state.justLeftAt = state.t;
  /* The opening is an errand: Uncle Theo wants a pebble off Slate for Aunt
     Nellie, and the purse holds just about enough to buy one.
     It is also the tutorial's spine — every step of the lesson is a step of
     this quest — so the game opens with a reason rather than a cargo. */
  state.quests = [];
  const opening = QUESTS[0];
  if(opening){
    acceptQuest(state, opening.id);
    state.target = questTarget(opening);
  }
  return state;
}

export function holdUnits(state){ return tiers('hold')[state.tiers.hold].value; }
export function usedUnits(state){
  return state.cargo.reduce((s, c) => s + c.qty * goodById(c.good).units, 0)

}
export function freeUnits(state){ return holdUnits(state) - usedUnits(state); }
export const portName = id => world.get(id)?.name ?? id;
const aOrAn = w => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w.toLowerCase()}`;

export function logLine(state, kind, template, vars = {}){
  const text = fill(template, vars);
  state.log.push({ t: state.t, kind, text });
  if(state.log.length > 200) state.log.splice(0, state.log.length - 200);
  return text;
}
export function fill(template, vars){
  return String(template).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/* Game time as the world tells it: Tassel years and days. */
export function calendar(t){
  const y = Math.floor(t / CONST.YEAR_DAYS) + 1;
  const d = Math.floor(t - (y - 1) * CONST.YEAR_DAYS) + 1;
  return { year: y, day: d, text: `Year ${y}, day ${d}` };
}
export function fmtDays(d){
  if(!Number.isFinite(d)) return '—';
  /* Minutes, now that there are things worth counting in them: at a tenth the
     size a low orbit is half an hour, and "1 h" is not what a pilot flying it
     wants to be told. */
  if(d < 1 / 16) return `${Math.max(1, Math.round(d * 1440))} min`;
  if(d < 1) return `${(d * 24).toFixed(d < 1 / 4 ? 1 : 0)} h`;
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

/* A port may keep hours: `openWithin` shuts its market whenever the body it
 * is on is further from the Lamp than that. Nothing in the sky uses it today,
 * and the rule stays because a seasonal market is a thing a port may want. */
export function portOpen(portId, t){
  const p = PORTS[portId];
  /* A wreck, and the station at the Dancer, have no entry in the price list at
     all — no market, no yard, nobody to keep hours — so "open" is only whether
     the thing is there. Anything else with no entry is not somewhere a ship can
     tie up. */
  if(!p) return isHulk(portId);
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
  /* Where a docked ship sits, which is about the harbour rather than the mass.
     A world you park above puts you in its parking orbit. Anything you come
     alongside — a wreck, the station at the Dancer, and the Maw, which is a
     black hole with no ground to park over — puts you beside it in its
     parent's frame, moving with it. Branching on `mu` here quietly placed a
     ship at NaN the day the Maw got weight: it has mass and no parking orbit,
     so `circularState` was handed an undefined altitude. */
  if(b.mu > 0 && !b.rendezvous){
    const s = circularState(b.mu, b.dockAlt, 0);
    state.ship = { body: portId, r: s.r, v: s.v };
  }else{
    const local = railState(b, world.get(b.parent).mu, state.t);
    state.ship = { body: b.parent, r: [...local.r], v: [...local.v] };
  }
}

/* The port the ship could tie up at right now, if any.
 *
 * The rule is an orbit, not a box. You may dock at a world when you are in a
 * **stable orbit close in around it**: bound to it, low point clear of the
 * ground and of any air, high point inside its harbour mouth. That is the
 * thing a pilot was trying to achieve anyway, so it needs no separate test
 * and no separate prompt — get captured, and the harbour is open.
 *
 * It replaces "be inside this radius travelling under this speed", which
 * asked the player to satisfy two numbers that were not the manoeuvre they
 * were flying, and which let a ship on a wild ellipse tie up because it
 * happened to be slow at the top of it.
 *
 * A rendezvous harbour is the other kind, and keeps the distance-and-speed
 * test: the belt havens and the Maw have no gravity to be held by, and Nail
 * has so little that an orbit round it is not somewhere anybody waits. You
 * come alongside instead. Which places are which is decided in content.js,
 * not here.
 */
/* Coming alongside: near enough to the rock and slow enough beside it. Used
 * for a haven in the frame the ship is flying in, and for the rock itself
 * once the ship is inside its reach — the same two numbers either way, so
 * crossing that boundary does not change what the harbour asks of you. */
function rendezvousStatus(state, c, r, v){
  const distance = norm(r), relSpeed = norm(v);
  const inZone = distance <= c.zoneRadius;
  const slow = relSpeed <= c.dockSpeed;
  /* Nothing is holding you here and nothing will catch you if you are wrong,
     so holding a ship still against it is the cat's trick the navigator's
     berth buys. Reported either way, so a ship without one learns that the
     approach was good and what the missing piece is. */
  const held = canDockDrifting(state);
  return {
    port: c.id, kind: 'zone', distance, relSpeed,
    mouth: c.zoneRadius, dockSpeed: c.dockSpeed,
    inZone, slow, needsNavigator: !held, ok: inZone && slow && held,
    over: Math.max(0, relSpeed - c.dockSpeed),
    /* How near, as a fraction of the space this harbour is approached in: its
       reach where it has one, and its mouth where it has not — Nail, Whisker
       and the Maw are come alongside but have gravity instead of a reach.
       Against the `ra / mouth` an orbit scores, that puts "inside the space,
       flying the rendezvous" under one and "not there yet" over it, which is
       the comparison this number exists to make. Scored on the mouth alone a
       ten-kilometre mouth made every wreck lose to the moon it orbits from
       forty kilometres out — with the burn axes already turned to the wreck
       and the readout already counting it down. */
    score: distance / (c.driftReach > 0 ? c.driftReach : c.zoneRadius),
    open: portOpen(c.id, state.t),
  };
}
export function dockingStatus(state){
  if(state.dockedAt) return null;
  const here = world.get(state.ship.body);
  const found = [];
  const take = st => { if(st) found.push(st); };
  /* A wreck nobody has mentioned is not a harbour. Physics still has hold of a
     ship near one — the rails do not care what you have been told — but a
     harbour is a place somebody told you about, and offering the refusal of an
     unheard-of derelict in place of the world you are plainly trying to orbit
     is the HUD answering a question nobody asked. */
  const hidden = unseen(state);

  /* The rock we are inside the reach of, when that rock is one you come
     alongside. Ship coordinates are already in its frame, so the two numbers
     are simply where we are and how fast. Without this a ship that crossed
     into Nail's reach found no harbour at all: Nail is not its own child, and
     the orbit test below would have asked it to orbit a thing it cannot. */
  if(here.port && here.rendezvous && here.mu > 0 && state.justLeft !== here.id && !hidden.has(here.id)){
    take(rendezvousStatus(state, here, state.ship.r, state.ship.v));
  }
  // The world we are going round.
  if(here.port && here.mu > 0 && !here.rendezvous && state.justLeft !== here.id){
    const el = elementsFromState(here.mu, state.ship.r, state.ship.v);
    const floor = Math.max(here.radius ?? 0, here.atmo ?? 0);
    const mouth = here.zoneRadius ?? Infinity;
    const bound = Number.isFinite(el.period) && el.a > 0;
    const clear = el.rp > floor;
    const close = Number.isFinite(el.ra) && el.ra <= mouth;
    take({
      port: here.id, kind: 'orbit',
      distance: norm(state.ship.r), relSpeed: norm(state.ship.v),
      rp: el.rp, ra: el.ra, floor, mouth,
      bound, clear, close,
      ok: bound && clear && close,
      score: bound && Number.isFinite(el.ra) ? el.ra / mouth : 1e6,
      open: portOpen(here.id, state.t),
    });
  }
  // Rendezvous ports in this frame: near enough, slow enough.
  for(const c of world.children(here.id)){
    if(!c.port || !c.rendezvous || state.justLeft === c.id || hidden.has(c.id)) continue;
    const st = railState(c, here.mu, state.t);
    take(rendezvousStatus(state, c, sub(state.ship.r, st.r), sub(state.ship.v, st.v)));
  }
  /* Nowhere near: do not clutter the HUD with a port you are nothing like at.
     For a thing you come alongside, "near" is its reach — that is the space the
     approach is actually flown in, and with a mouth ten kilometres across eight
     of them is eighty, so the card would appear only in the last sixth of a
     five-hundred-kilometre approach and the mouth would not be drawn until
     then either.

     Asked of each one rather than of the winner, so a port that is nothing
     like near hands the question down instead of answering "nowhere" for
     everybody: a ship a long way outside a wreck's reach is still plainly at
     the moon they are both going round. */
  const nearEnough = st => st.kind === 'zone'
    ? st.distance <= Math.max(st.mouth * 8, world.get(st.port)?.driftReach ?? 0)
    : st.ok || st.distance <= st.mouth * 8;
  const live = found.filter(nearEnough);
  if(!live.length) return null;
  return live.reduce((a, b) => (b.score < a.score ? b : a));
}

/* Why not, in the words a pilot would use. */
export function dockRefusal(st){
  if(!st) return 'no port';
  if(st.kind === 'zone'){
    /* Say the thing the player can act on first. Being far is a burn and being
       fast is a burn; having nobody aboard who can do this is neither, so it
       is said only once the approach itself was good. */
    if(!st.inZone) return 'too far';
    if(!st.slow) return 'too fast';
    return st.needsNavigator ? 'no navigator' : 'too far out';
  }
  if(!st.bound) return 'not in orbit';
  if(!st.clear) return 'that orbit goes through it';
  return 'too far out';
}

export function dock(state){
  const st = dockingStatus(state);
  if(!st || !st.ok) return { ok: false, reason: dockRefusal(st) };
  const port = st.port;
  state.dockedAt = port;
  state.lastPort = port;
  state.nodes = [];
  placeDocked(state, port);
  openMarket(state, port);
  if(!state.visited.includes(port)) state.visited.push(port);
  state.stats.docks++;
  const dAbs = norm(absState(world, port, state.t).r);
  state.stats.farthest = Math.max(state.stats.farthest, dAbs);
  logLine(state, 'docked', TEXT.logTemplates.docked, { port: portName(port) });
  const events = [{ kind: 'docked', port }];
  questCheck(state, events);
  milestonesOnDock(state, port, events);
  return { ok: true, port, events };
}

/* Free flight at a port: the parking orbit a ship sits in when it is not tied
 * up. A prograde circle at the docking altitude, placed so that the ship's
 * velocity points the way the port itself is moving, which means the first
 * burn a beginner makes is already in the right direction. */
/* A parking orbit is very slightly an ellipse rather than exactly a circle.
 *
 * On an exact circle the low point and the high point are the same distance
 * out, so which part of the orbit is which is decided by the last bit of a
 * floating-point number — and the chart, which marks both, swapped its two
 * labels from one side of the world to the other every few frames. There is
 * no right answer to give a circle; the fix is not to fly one.
 *
 * Measured at Tassel's harbour, flying a lap and watching where the low point
 * says it is: on an exact circle it moves 179 degrees round the orbit, which
 * is the flip. At any eccentricity from a ten-millionth upward it does not
 * move at all — the drift is zero to three decimal places of a degree — so
 * what this number has to be is not "big enough to work" but "small enough
 * not to show". A hundred-thousandth is both, with two orders of margin over
 * the point where stability begins: the low point and the high point differ
 * by sixty-one metres in three thousand kilometres, which is a hundredth of a
 * pixel on a chart that fills the screen with the orbit, and the two marks
 * print the same altitude as each other.
 *
 * The ship is put at the low point, so the semi-major axis — and with it the
 * period the clock is tuned to — is exactly the radius asked for.
 */
const PARK_E = 1e-5;

function placeParked(state, portId, radius){
  const b = world.get(portId);
  if(b.mu > 0){
    const pv = absState(world, portId, state.t).v;
    const dir = norm(pv) > 0 ? unit(pv) : [0, 1];
    const theta = Math.atan2(dir[1], dir[0]) - Math.PI / 2;
    const a = radius ?? b.dockAlt;
    const rp = a * (1 - PARK_E);
    // circularState points both vectors; only the speed is ours to set.
    const s = circularState(b.mu, rp, theta);
    const vp = Math.sqrt(b.mu * (1 + PARK_E) / rp);
    state.ship = { body: portId, r: s.r, v: scale(unit(s.v), vp) };
  }else{
    const parent = world.get(b.parent);
    const local = railState(b, parent.mu, state.t);
    // A nudge outward from the zone so the ship is not "in the zone" forever.
    const off = scale(unit(local.r), b.zoneRadius * 0.6);
    state.ship = { body: b.parent, r: add(local.r, off), v: [...local.v] };
  }
}

/* Where a new game begins: a low circular orbit, the same prograde circle as
 * a parking orbit but drawn at `startAlt` instead of the docking altitude.
 *
 * Low means what a pilot means by it — the high point of the orbit sits less
 * than one planet-diameter above the ground — and at Tassel that is 0.000115
 * au, about three planet-radii out from the middle of the world. The point is
 * what the first frame looks like: a world that fills the chart and visibly
 * turns under you, rather than a blue dot a hundred thousand kilometres off.
 * The clock is tuned to this orbit and no other — one lap, ten real minutes.
 *
 * Only the opening uses it. The harbour is still at `dockAlt`, so tying up
 * and casting off put the ship back on the orbit the whole delta-v table is
 * measured from, and nothing downstream of the first burn moves.
 */
function placeStart(state, portId){
  const b = world.get(portId);
  placeParked(state, portId, b.startAlt ?? b.dockAlt);
}

export function undock(state){
  if(!state.dockedAt) return { ok: false };
  const port = state.dockedAt;
  placeParked(state, port);
  state.dockedAt = null;
  /* Casting off drops you inside the harbour mouth you just left, and an
     invitation to tie up again one second later is noise. The port goes quiet
     for a moment — see QUIET_DAYS. */
  state.justLeft = port;
  state.justLeftAt = state.t;
  logLine(state, 'undocked', TEXT.logTemplates.undocked, { port: portName(port) });
  return { ok: true };
}

/* Wait at a port. Time passes for everyone: the sky turns, markets drift. */
export function wait(state, days){
  if(!state.dockedAt || days <= 0) return;
  state.t += days;
}

/* Days until a body next reaches periapsis: the closest a body on an ellipse
 * comes to the thing it goes round. The rails make this exact. */
export function daysToPeriapsis(bodyId, t){
  const b = world.get(bodyId);
  const n = Math.sqrt(world.get(b.parent).mu / (b.a ** 3));
  const M = ((b.M0 + n * t) % TAU + TAU) % TAU;
  return ((TAU - M) % TAU) / n;
}

/* --------------------------------------------------------------- flight */

/* Time has no ladder. There is the clock — ×1, ten minutes to a lap of the
 * low orbit a new game opens in — and there is skipping: you point at
 * somewhere on your road, the game says how long it takes and how long you
 * will be sitting there, and if you say yes it runs the clock at exactly the
 * rate that covers it in ten seconds. A rung of warp is a thing to choose; a
 * place on your road is a thing you already wanted. */
export const MAX_WARP = CONST.MAX_WARP;
export const SKIP_SECONDS = CONST.SKIP_SECONDS;
export function warpRate(state){ return Math.max(1, Math.min(MAX_WARP, state.warp ?? 1)); }
export function dtForFrame(state, realSeconds){
  if(state.paused || state.pending) return 0;
  return realSeconds * CONST.BASE_RATE_DAYS_PER_SEC * warpRate(state);
}

/* What skipping to a moment would cost: the rate to use, and the real seconds
 * it will actually take. The cap is the only reason those two ever disagree,
 * and when they do the confirmation has to say so rather than promise ten. */
export function skipPlan(state, t){
  const days = t - state.t;
  if(!(days > 1e-9)) return null;
  const ideal = days / (SKIP_SECONDS * CONST.BASE_RATE_DAYS_PER_SEC);
  const rate = Math.max(1, Math.min(MAX_WARP, ideal));
  return { t, days, rate, seconds: days / (rate * CONST.BASE_RATE_DAYS_PER_SEC), capped: ideal > MAX_WARP };
}

/* Whether a ship skims air rather than burning up in it. A heat shield is the
 * whole of it: without one the air is a wall and the hull meets it, which is
 * what `atmosphere: true` in the predictor means. Cryo cooling does not change
 * whether you may skim, only whether it costs you anything (see skimRisk). */
export const skimsAir = state => !!state?.keys?.heatShield;

/* The Knot is out there whether or not anybody has told you. What the cat
 * navigator brings is knowing where — the cats have had it for generations and
 * have never seen a reason to mention it. Gravitational sensors find it the
 * other way, by looking, which is the phenomenon that key was always sold to
 * see. Either one puts it on the chart; neither changes the sky. */
export const knowsKnot = state => !!(state?.crew?.navigator || state?.keys?.gravSensors);
/* The Maw is the other one, and it takes the instrument rather than the person.
 * A cat can tell you where the Knot is because the cats have known for nine
 * generations; nobody has ever come back from the far edge to say what is out
 * there, so the only way to know is to measure it. What a ship without the
 * sensors sees is the Dancer: a small blue star going round nothing at all. */
export const knowsMaw = state => !!state?.keys?.gravSensors;

/* Wrecks: things with no weight, on rails, that you can tie up to and that
 * nobody lives on. They are bodies in the sky like anywhere else, but they are
 * deliberately not in the price list — a derelict has no stall, no pump, no
 * board and nobody to talk to, and giving one an empty market would be four
 * empty menus pretending otherwise. */
const WRECK_IDS = new Set(BODIES.filter(b => b.kind === 'wreck').map(b => b.id));
export const isWreck = id => WRECK_IDS.has(id);

/* What to call a body to this player. Everything the chart and the readouts
 * say about a thing nobody has found goes through here: the road still runs
 * into it, the crosshair still marks the pass and the numbers are still real —
 * it simply has no name yet. `hidden` is the set `unseen` builds, passed in
 * because the page already has one per frame. */
export const nameFor = (id, hidden) => hidden?.has(id) ? '???' : portName(id);
export const WRECKS = [...WRECK_IDS];
/* Every weightless harbour, which is the wrecks and the station at the Dancer:
 * the same machinery, and the same absence from the price list. */
const HULK_IDS = new Set(BODIES.filter(b => b.port && !(b.mu > 0) && b.parent).map(b => b.id));
export const isHulk = id => HULK_IDS.has(id);
/* Bodies the chart should not draw for this player.
 *
 * Gravity never consults this — a world nobody has told you about still has
 * hold of you, and the Knot will still whip a ship round whether or not the
 * cat aboard has mentioned it. But everything the *ship* does with a body
 * does: it is offered as a harbour, it bends the burn axes when you come
 * alongside it, it gets a readout. All of that is knowing where something
 * is, and it is all gated here, so an unfound thing is absent rather than
 * merely undrawn. Passed to `legOpts`, `rendezvous` and `dockingStatus`. */
export function unseen(state){
  const hide = new Set();
  if(!knowsKnot(state)) hide.add('knot');
  if(!knowsMaw(state)) hide.add('maw');
  /* A wreck is a rumour until somebody hands you the job that names it. Eight
     unexplained dots on the chart from the first day would be eight questions
     with no way to ask them; one that appears when a salvor tells you where to
     look is a lead. Taking the job is what reveals it, and finishing the job
     does not hide it again — you have been there now.

     The station at the Dancer is hidden the same way and for the same reason.
     It has been going round that star since before anybody was watching, and it
     is only ever anywhere a ship would have had reason to look once the
     Builders' own station has given you the bearing. */
  const told = new Set();
  for(const live of state?.quests ?? []){
    const q = questById(live.id);
    /* What a job points at: the wreck it names, and where it ends when that is
       one of these rather than a port. The last job in the line has no wreck —
       its destination *is* the secret — so both count. */
    for(const id of [q?.wreck, q?.to]) if(id && HULK_IDS.has(id)) told.add(id);
  }
  for(const id of HULK_IDS) if(!told.has(id)) hide.add(id);
  return hide;
}
/* Seeing past the encounter. The road normally stops one crossing out — see
 * the note on fullLap — because a road that chases every encounter it can find
 * is a road nobody reads. A navigator aboard is exactly the person who reads
 * it, so with one the chart will draw the crossing after the crossing, and the
 * button in the corner turns that off again. */
export const canSeePast = state => !!state?.crew?.navigator;

/* Coming alongside something with no gravity is station-keeping rather than
 * orbiting: you match the thing's velocity and hold there while somebody gets
 * a line across. Nothing is pulling you in and nothing will catch you if you
 * are wrong, so it wants instruments — how close the path actually comes, and
 * how fast you are closing — and those are what the cat navigator is for. */
export const canDockDrifting = state => !!state?.crew?.navigator;

/* The drifting thing this ship is currently flying near, with the two numbers
 * that matter, or null. Distance at intercept is the closest the *current*
 * path comes, which is the number you fly a rendezvous on — the range right
 * now says nothing about whether you are going to arrive. */
export function rendezvous(state){
  if(!state || state.dockedAt) return null;
  const here = world.get(state.ship.body);
  /* Two ways to be near one of these. A wreck drifts in somebody else's frame,
     and a reach round it is what says you are close enough to be flying the
     rendezvous rather than the orbit. The Maw has weight, so its own reach does
     that job and the ship is simply *in* its frame — where the two numbers are
     where you are and how fast, with nothing to subtract. Without this, giving
     the Maw a well silently took its readout away: the drift reach sits inside
     the sphere of influence and can never fire again. */
  /* The hidden set gates the *drifting* things and only those. A wreck nobody
     has heard of gives no readout at all, because the ship has no idea it is
     there; the Maw keeps its numbers and loses its name — the road still runs
     into it, and how close and how fast are still true, which is exactly what
     `nameFor` draws as ??? until the sensors are aboard. */
  const tgt = here.port && here.rendezvous && here.mu > 0
    ? { id: here.id, r: [0, 0], v: [0, 0], reach: here.soi }
    : driftTargetAt(world, here.id, state.ship.r, state.t, unseen(state));
  if(!tgt) return null;
  const rel = sub(state.ship.r, tgt.r);
  const vRel = sub(state.ship.v, tgt.v);
  const range = norm(rel), speed = norm(vRel);
  /* Closest approach on the straight line the pair are on right now. Over the
     minutes a rendezvous actually takes, neither is turning enough for the
     conic to matter, and a number that updates smoothly is worth more here
     than one that is exact and jumps. */
  const closing = speed > 0 ? -dot(rel, vRel) / speed : 0;
  const atIntercept = closing > 0 ? Math.sqrt(Math.max(0, range * range - closing * closing)) : range;
  const port = PORTS[tgt.id];
  return {
    target: tgt.id, reach: tgt.reach, range, speed,
    closing: closing > 0, atIntercept,
    timeToIntercept: closing > 0 && speed > 0 ? closing / speed : null,
    mouth: world.get(tgt.id).zoneRadius,
    dockSpeed: world.get(tgt.id).dockSpeed,
    instruments: canDockDrifting(state),
    open: port ? portOpen(tgt.id, state.t) : true,
  };
}
export const seesPast = state => canSeePast(state) && state.farSight !== false;

/* The chance a single pass hurts the hull, from the speed it sheds.
 *
 * Convex on purpose. The first `freeKms` of a pass is free and the rest grows
 * with the square, so splitting a hard brake into several shallow ones is
 * genuinely safer rather than the same risk spread thinner — the pilot who
 * takes four orbits over it is playing better, not just slower, and pays in
 * days instead. Cryo cooling takes it to nothing at any depth, which is what
 * the rack has always claimed it does. */
export function skimRisk(state, shedAuDay){
  if(state?.keys?.cryoCooling) return 0;
  const f = FORMULAS.aerobrake;
  const over = Math.max(0, kms(shedAuDay) - f.freeKms);
  if(over <= 0) return 0;
  return Math.min(f.maxRisk, f.riskPerKms2 * over * over);
}

/* Hull: 0 sound, 1 knocked about, 2 buckled, 3 failing, 4 is not a hull any
 * more. A fuel cell fault caps what the tank will hold until a yard sees it;
 * it never empties the tank in flight, because a fault that bites where the
 * player cannot answer it is a tax rather than a decision. */
export const HULL_WRECKED = 4;
export const hullLevel = state => state.hull ?? 0;
export const hasFuelCellFault = state => !!state.faults?.fuelCell;
/* What the tank will actually hold right now. Everything that fills, draws or
 * draws a gauge goes through this rather than state.tank. */
export function usableTank(state){
  return hasFuelCellFault(state) ? state.tank * FORMULAS.aerobrake.fuelCellCap : state.tank;
}
export const FUEL_CELL_CAP = FORMULAS.aerobrake.fuelCellCap;
const HULL_WORDS = ['Sound', 'Knocked about', 'Buckled', 'Failing', 'Not a hull any more'];
export const hullWord = state => HULL_WORDS[hullLevel(state)] ?? HULL_WORDS[0];
export function repairCost(state, what){
  const f = FORMULAS.aerobrake.repair;
  if(what === 'fuelCell') return hasFuelCellFault(state) ? f.fuelCell : 0;
  return f[String(hullLevel(state))] ?? 0;
}

/* The maneuvers the kernel should actually fly: the player's nodes plus any
 * aerobrake a shielded ship will take at a periapsis inside an atmosphere.
 * Computed by predicting, finding such a periapsis, inserting a retrograde
 * pseudo-node there, and predicting again — so the drawn path and the flown
 * path both include the skim. */
export function skimHorizon(state, dtDays){
  const b = world.get(state.ship.body);
  const el = elementsFromState(b.mu, state.ship.r, state.ship.v);
  const laps = Number.isFinite(el.period) && el.period > 0 ? el.period * 2.5 : Infinity;
  return Math.max(dtDays + 1, Math.min(150, laps));
}

/* What one pass through a world's air takes off the ship, in au/day, given
 * the conic it arrives on and the state at the bottom of the dive. Zero means
 * no skim: the kernel asks this at every periapsis inside an atmosphere and
 * ends the leg there only when the answer is worth a mark.
 *
 * The skim goes at the bottom of the dive and nowhere else. A retrograde push
 * anywhere else lowers the far end of the path instead of raising it — at the
 * top of the orbit it would drop the ship straight into the planet, and which
 * it did once depended on where the search happened to stop, which is to say
 * on the time warp. */
function skimShed(b, el, at){
  if(dot(at.r, at.v) > norm(at.r) * norm(at.v) * 0.02) return 0;
  if(norm(at.r) > b.atmo * 1.001) return 0;
  const vp = el.vmax;
  const depth = Math.max(0, Math.min(1, (b.atmo - el.rp) / (b.atmo - b.radius)));
  /* How much of the speed the air takes, from how deep the dive goes. The
     curve is steep rather than straight: the thin stuff at the top of the
     band barely touches you, and the bottom of it is a wall. That is what
     makes a tight pass a real maneuver — aim deep and the planet catches
     you in one lap — while a graze stays the gentle, repeatable thing a
     pilot can walk an orbit down with. */
  const f = FORMULAS.aerobrake;
  const wanted = Math.min(f.maxFraction, f.k * Math.pow(depth, f.depthPower ?? 1)) * vp;
  /* The floor: an orbit whose far end still clears the clouds. Skimming can
     circularise you around a world; it must never quietly bury you in it.
     Pass after pass the shed shrinks to nothing, and the ship is left on a
     low orbit for the pilot to raise out of the air themselves. */
  const aTarget = (el.rp + f.floorApo * b.atmo) / 2;
  const vFloor = Math.sqrt(Math.max(0, b.mu * (2 / el.rp - 1 / aTarget)));
  const shed = Math.max(0, Math.min(wanted, vp - vFloor));
  return shed < vp * 1e-3 ? 0 : shed;
}

/* The options every prediction of this ship is made with. The air is a wall
 * to a ship without a shield and a brake to one with. */
function legOpts(state, extra = {}){
  const skim = skimsAir(state);
  /* What the ship has not been told about cannot bend its burns: the same set
     the chart refuses to draw is handed to the flying, so an unfound wreck is
     absent rather than merely invisible. */
  return { atmosphere: !skim, dvAvailable: state.dv, skimAt: skim ? skimShed : null, hidden: unseen(state), ...extra };
}
const sortedNodes = state => state.nodes.map(n => ({ ...n })).sort((a, b) => a.t - b.t);

export function effectiveNodes(state, horizon, { skim = skimsAir(state) } = {}){
  const nodes = sortedNodes(state);
  if(!skim) return nodes;
  const pred = predictLegs(world, state.ship, state.t, nodes, { atmosphere: false, dvAvailable: state.dv, skimAt: skimShed, hidden: unseen(state), maxTime: horizon, noSamples: true });
  const aero = pred.events.filter(e => e.kind === 'burn' && e.node.aero).map(e => e.node);
  return [...nodes, ...aero].sort((a, b) => a.t - b.t);
}

/* The leg the ship is flying right now, kept between ticks.
 *
 * Nothing about a coast changes from one frame to the next: it is one conic,
 * and where it ends was settled when it began. So the leg is solved once and
 * every tick after that is a single propagation along it, however fast the
 * clock runs — which is what the kernel's header promises about time warp
 * and what re-solving every frame quietly failed to deliver.
 *
 * The cache is keyed on the things a leg is made of. The ship object itself:
 * a tick writes a fresh one, so anything else that moves the ship (a tow, a
 * dock, a load) fails the identity test without having to know about this.
 * The clock, for the same reason. The marks, the tank and the shield, because
 * each changes where a leg ends. Kept beside the state rather than in it so a
 * save never carries it. */
const FLIGHT = new WeakMap();
function flightLeg(state, nodes){
  const sig = nodes.map(n => `${n.t}|${n.prograde}|${n.radial}`).join(';');
  const shield = skimsAir(state);
  let c = FLIGHT.get(state);
  if(c && c.ship === state.ship && c.t === state.t && c.sig === sig && c.dv === state.dv && c.shield === shield) return c;
  const pred = predictLegs(world, state.ship, state.t, nodes, legOpts(state, { maxLegs: 1, maxTime: 1e7, noSamples: true, stop: () => true }));
  c = { ship: state.ship, t: state.t, sig, dv: state.dv, shield, pred };
  FLIGHT.set(state, c);
  return c;
}

/* Fly dt days along the cached legs. Stops at the first burn or change of
 * reach, leaving the rest of dt unspent: at the top time warp a single frame
 * is days, long enough to pass clean through a moon's whole reach, and a
 * player who was warping towards that encounter must be given the chance to
 * act in it. A crash stops the clock at the moment of impact. */
function fly(state, nodes, dt){
  const events = [];
  const end = state.t + dt;
  for(let guard = 0; guard < 8 && end - state.t > 1e-12; guard++){
    const entry = flightLeg(state, nodes);
    const pred = entry.pred;
    const leg = pred.segments[0];
    if(!leg) break;
    const mu = world.get(leg.body).mu;
    if(pred.stable || end < leg.t1 - 1e-9){
      const s = propagate(mu, leg.r0, leg.v0, end - leg.t0);
      state.ship = { body: leg.body, r: s.r, v: s.v };
      state.t = end;
      // Still on the same leg: the cache follows the ship along it.
      entry.ship = state.ship; entry.t = state.t;
      return { events, crashed: false };
    }
    // The leg ends inside this step: go to its end and do what ends it.
    const n = pred.next;
    state.t = leg.t1;
    if(leg.reason === 'crash'){
      state.ship = { body: leg.body, r: leg.r1, v: leg.v1 };
      events.push({ kind: 'crash', body: leg.body, t: leg.t1, r: leg.r1, v: leg.v1 });
      return { events, crashed: true };
    }
    state.ship = { body: n.body, r: n.r, v: n.v };
    if(leg.reason === 'burn' || leg.reason === 'exit' || leg.reason === 'enter'){
      for(const e of pred.events) events.push(e);
      return { events, crashed: false };
    }
    // A leg cut by the search's own reach: the next one carries on from here.
  }
  return { events, crashed: false };
}

/* One step of flight. Returns the events that happened, already applied. */
export function tick(state, dtDays){
  const events = [];
  if(dtDays <= 0 || state.pending) return events;
  if(state.dockedAt){
    state.t += dtDays;
    questCheck(state, events);
    return events;
  }
  /* The skim is part of the leg, not a mark looked for ahead of it: the leg
     the ship is on ends at the bottom of the dive if there is one, however far
     off the bottom is, so a shielded ship arriving from the edge of a reach
     finds its brake written down from the moment it crosses in. */
  const res = fly(state, sortedNodes(state), dtDays);
  for(const e of res.events){
    if(e.kind === 'burn'){
      if(e.node.aero){
        logLine(state, 'burn', TEXT.logTemplates.aerobrake ?? 'Air braked at {body}: {dv} shed to the clouds.', { body: portName(e.node.body), dv: fmtKms(e.magnitude) });
        flag(state, 'firstAerobrake', events);
        state.stats.skims = (state.stats.skims ?? 0) + 1;
        const risk = skimRisk(state, e.magnitude);
        if(risk > 0 && rnd(state) < risk){
          /* One fault per pass, never two: a pass that goes wrong should be one
             thing the player can name afterwards. The fuel cell is the smaller
             share because it is the more interesting of the two. */
          const f = FORMULAS.aerobrake;
          if(!hasFuelCellFault(state) && rnd(state) < f.fuelCellShare){
            state.faults = { ...(state.faults ?? {}), fuelCell: true };
            state.dv = Math.min(state.dv, usableTank(state));
            logLine(state, 'story', TEXT.events.skimFuelCell);
            events.push({ kind: 'skimFault', fault: 'fuelCell' });
          }else{
            state.hull = Math.min(HULL_WRECKED, hullLevel(state) + 1);
            const wrecked = hullLevel(state) >= HULL_WRECKED;
            logLine(state, 'story', wrecked ? TEXT.events.skimWrecked : TEXT.events.skimDamage[hullLevel(state) - 1]);
            events.push({ kind: 'skimFault', fault: 'hull', level: hullLevel(state) });
            /* A hull that has stopped being one goes down the road the game
               already has for a ship that cannot fly: a tow, a bill, and the
               harbour bank behind it. Nothing here costs the save. */
            if(wrecked){
              state.pending = { kind: 'crash', body: e.node.body, atmosphere: true, wrecked: true };
              events.push({ kind: 'crash', body: e.node.body, wrecked: true });
            }
          }
        }
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
      /* The flag is still set — it is how the game knows you have crossed one
         before — but there is no longer a line of story attached to it, so
         crossing a reach says nothing beyond the log entry above. */
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
    /* The port is quiet for a moment after you leave, and then it is open
       again — it used to stay shut until the ship was clear of its mouth,
       which a parking orbit never is, so the harbour you started in could
       never be gone back to. It also opens the moment it is plain the ship is
       going nowhere, because a door that locks behind a pilot with a dry tank
       is exactly the dead end this game is not allowed to have. */
    const quiet = state.t - (state.justLeftAt ?? -1e9) < QUIET_DAYS;
    const clear = dist(here, absState(world, state.justLeft, state.t).r) > b.zoneRadius;
    const stuck = state.dv <= 1e-9 && !state.nodes.length;
    if(!quiet || clear || stuck) state.justLeft = null;
  }
  if(state.nodes.length){
    const stale = state.nodes.filter(n => n.t < state.t - 1e-9);
    if(stale.length){
      state.nodes = state.nodes.filter(n => n.t >= state.t - 1e-9);
      events.push({ kind: 'missed', count: stale.length });
    }
  }
  tollCheck(state, events);
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

/* ---------------------------------------------------------------- quests */

/* An errand somebody gave you, with a list of steps and the one you are on.
 * The words live in quests.json, which also says what kind of job each one is
 * and names the places and the goods; what lives here is the only part that
 * cannot be written down as text — how the game knows a step is finished.
 *
 * A quest is a reason to fly somewhere. The opening errand is one because
 * "fetch your aunt a pebble" is a thing a person does for a person, and
 * because it can teach the whole game on the way: it is the tutorial's spine.
 *
 * The five shapes a job comes in. The steps are built from the type rather
 * than written out, so a new quest is a few lines of data and no code.
 *
 *   retrieval  go and get the goods yourself, then take them to `to`
 *   delivery   the goods are handed to you when you accept, so you need the
 *              hold room before you can say yes
 *   shopping   several goods from wherever you can find them, handed over
 *              together at the end
 *   chain      call at each of `stops` in order, then report back
 *   message    a sealed nothing: no goods, no weight, just be there
 *   salvage    come alongside the wreck it names, take what is aboard, and
 *              carry it to `to`. The only type whose first step is a place
 *              nobody lives, and the only one that puts goods *into* the hold
 *              rather than taking them out or handing them to you at the dock.
 *
 * Retrieval and shopping run on the same machinery — the difference is one
 * good from a named place against a list from anywhere, which is a difference
 * in the telling and not in the rules. Saying so here is cheaper than
 * inventing a mechanical distinction nobody asked for.
 *
 * A job is taken from the port that offers it: `questsAt` is the board, the
 * Requests tab on the dock menu is where it is shown, and three is as many as
 * anybody can hold in their head at once. */

export const MAX_ACTIVE_QUESTS = 3;

/* ---- relics, and the jobs that are gated on them ----------------------- */

/* The three things the closing line is about. Written beside the quests
 * because that is the only place they come from: nothing sells one, nothing
 * makes one, and the only way into the bag is to finish the job that grants
 * it. */
export const RELICS = RELICBOOK;
const relicIndex = new Map(RELICS.map(r => [r.id, r]));
export const relicById = id => relicIndex.get(id);
export const heldRelics = state => RELICS.filter(r => state?.relics?.[r.id]);
export const hasRelic = (state, id) => !!state?.relics?.[id];

/* Jobs finished *and collected* for a people. Counted off the save rather than
 * kept as a running total: the record of what you have done is already there,
 * and a second copy of it is a second thing that can be wrong. */
export function questsDoneFor(state, people){
  return (state?.quests ?? []).filter(l => l.claimed && questById(l.id)?.rep === people).length;
}

/* Why a job cannot be taken on yet, or null when it can. The one kind of
 * prerequisite in the game: the closing line needs three things in the bag and
 * the frogs do not make a gift of anything until they know you.
 *
 * Reported as a sentence rather than as a flag, because a job you cannot take
 * is only worth putting on a board if it says what it is waiting for. */
export function requiresUnmet(state, q){
  const need = q?.requires;
  if(!need) return null;
  for(const [people, n] of Object.entries(need.questsFor ?? {})){
    const done = questsDoneFor(state, people);
    if(done < n){
      const who = SPECIES[people]?.plural ?? people;
      return `${who} do not hand this to a stranger. ${done} of ${n} jobs done for them.`;
    }
  }
  const short = (need.relics ?? []).filter(id => !hasRelic(state, id));
  if(short.length){
    const names = short.map(id => relicById(id)?.name ?? id);
    return `Not without ${names.join(', ')}.`;
  }
  return null;
}

export const QUESTS = QUESTBOOK;
export const questById = id => QUESTS.find(q => q.id === id);
/* Where the chart should point when a job is taken: wherever the first step
 * wants you. For a retrieval that is the stall it names; for a delivery or a
 * message the goods are already aboard, or there are none, so the first place
 * you have to be is the far end. Reading it off the built steps rather than
 * off `from` is what keeps those two apart. */
export const questTarget = q => q?.target ?? questSteps(q)[0]?.port ?? q?.to ?? null;

const goodName = id => goodById(id)?.name ?? id;
const someOf = st => `${st.qty > 1 ? `${st.qty} × ` : ''}${goodName(st.good)}`;
const stepText = {
  acquire: st => st.port ? `Buy ${someOf(st)} at ${portName(st.port)}` : `Get ${someOf(st)}`,
  visit: st => `Call at ${portName(st.port)}`,
  recover: st => `Come alongside ${portName(st.port)} and take ${
    st.goods.length > 1 ? 'what is aboard' : someOf(st.goods[0])}`,
  handover: st => !st.goods.length ? `Report to ${portName(st.port)}`
    : `Take ${st.goods.length > 1 || st.goods[0].qty > 1 ? 'them' : 'it'} to ${portName(st.port)}`,
};

/* The steps a quest's type earns it. Authored text wins where a quest supplies
 * it — the opening errand says "Bring it home to Tassel", which no generator
 * is going to beat — and the generated wording fills in everywhere else. */
export function questSteps(q){
  if(!q) return [];
  const goods = (q.goods ?? []).map(g => ({ good: g.good, qty: g.qty ?? 1 }));
  const out = [];
  if(q.type === 'retrieval' || q.type === 'shopping'){
    for(const g of goods) out.push({ kind: 'acquire', good: g.good, qty: g.qty, port: q.type === 'retrieval' ? (q.from ?? null) : null });
  }
  if(q.type === 'chain') for(const port of q.stops ?? []) out.push({ kind: 'visit', port });
  /* Salvage: the wreck first, the buyer after. What comes off it is one step,
     however many crates it is — you are not picking a derelict over item by
     item, you are emptying it. */
  if(q.type === 'salvage' && q.wreck) out.push({ kind: 'recover', port: q.wreck, goods });
  if(q.to) out.push({ kind: 'handover', port: q.to, goods });
  return out.map((st, i) => ({
    ...st,
    id: q.steps?.[i]?.id ?? `${st.kind}${i}`,
    text: q.steps?.[i]?.text ?? stepText[st.kind](st),
  }));
}

/* Hold units a pile of crates takes up. */
const unitsOf = goods => goods.reduce((n, g) => n + (g.qty ?? 1) * (goodById(g.good)?.units ?? 1), 0);

const stepDone = {
  acquire: (state, st) => carrying(state, st.good) >= st.qty,
  visit: (state, st) => state.dockedAt === st.port,
  /* Tied up to it, with somewhere to put what is in it. A full hold does not
     fail the job — it simply does not finish this step, so a pilot can go and
     make room and come back. The wreck is not going anywhere. */
  recover: (state, st) => state.dockedAt === st.port && freeUnits(state) >= unitsOf(st.goods),
  handover: (state, st) => state.dockedAt === st.port && st.goods.every(g => carrying(state, g.good) >= g.qty),
};

export function carrying(state, goodId){
  return state.cargo.reduce((n, c) => n + (c.good === goodId ? c.qty : 0), 0);
}
/* Crates you own, as against crates you are carrying for somebody. A
 * consignment is not merchandise: it cannot be sold, and the cats do not
 * count it when they work out a toll — which also stops a toll quietly
 * killing a job you had no way to protect. */
export const isConsigned = stack => stack.questId != null;
export function sellable(state, goodId){
  return state.cargo.reduce((n, c) => n + (c.good === goodId && !isConsigned(c) ? c.qty : 0), 0);
}
/* Take `qty` of a good out of the hold, the quest's own crates first, then the
 * oldest of your own. */
function handOver(state, goodId, qty = 1, questId = null){
  let left = qty;
  const order = [...state.cargo].sort((a, b) => (b.questId === questId ? 1 : 0) - (a.questId === questId ? 1 : 0) || a.t - b.t);
  for(const c of order){
    if(left <= 0) break;
    if(c.good !== goodId || c.qty <= 0) continue;
    const take = Math.min(left, c.qty);
    c.qty -= take; left -= take;
  }
  state.cargo = state.cargo.filter(x => x.qty > 0);
  return left === 0;
}

/* ---- taking one on */

export const activeQuests = state => (state.quests ?? []).filter(l => !l.done);
/* Done, and still owed for. These hold no berth against the three-job limit —
 * the work is over — but the log puts them at the top until somebody collects. */
export const unclaimedQuests = state => (state.quests ?? []).filter(l => l.done && !l.claimed);

export function canClaimQuest(state, id){
  const live = (state.quests ?? []).find(l => l.id === id);
  if(!live) return { ok: false, reason: 'No such job.' };
  if(!live.done) return { ok: false, reason: 'That one is not finished.' };
  if(live.claimed) return { ok: false, reason: 'Already collected.' };
  return { ok: true };
}

/* Collecting. Everything a job pays lands here and nowhere else, so there is
 * exactly one moment in the code where a purse grows because of a quest. */
export function claimQuest(state, id){
  const c = canClaimQuest(state, id);
  if(!c.ok) return c;
  const live = state.quests.find(l => l.id === id);
  const q = questById(id);
  const paid = q?.pay ?? 0;
  if(paid) state.money += paid;
  if(q?.rep && q.rep in state.rep) state.rep[q.rep] += 1;
  /* Some jobs pay in a person. The berth is filled with who they are and
     nothing else: a berth with somebody in it is the whole of the reward. */
  let crew = null;
  if(q?.crew && state.crew && q.crew in state.crew && !state.crew[q.crew]){
    state.crew[q.crew] = { role: q.crew, from: q.id, joinedAt: state.t };
    crew = q.crew;
  }
  /* And some pay in a thing that is not money and not a person. It goes in the
     bag and stays there: nothing in the game takes a relic back out. */
  let relic = null;
  if(q?.relic && relicById(q.relic) && !hasRelic(state, q.relic)){
    state.relics ??= {};
    state.relics[q.relic] = { from: q.id, foundAt: state.t };
    relic = q.relic;
  }
  live.claimed = true;
  live.claimedAt = state.t;
  logLine(state, 'questDone', TEXT.logTemplates.questDone ?? 'Finished {title}. Paid {pay}.',
    { title: q?.title ?? id, pay: fmtMoney(paid) });
  return { ok: true, pay: paid, rep: q?.rep ?? null, crew, relic, quest: q };
}
/* What is on offer at a port: the jobs given out there that you have not
 * taken and have not already done. This is the board — the one thing the
 * quest catalogue was missing, and the reason fourteen written quests could
 * only be reached from a test. */
export function questsAt(state, portId){
  const held = new Set((state.quests ?? []).map(l => l.id));
  /* A gated job is on the board and refused, so it reads as a goal — except
     where it asks to be hidden, which is how the last one in the line stays a
     surprise until the three things are in the bag. */
  return QUESTS.filter(q => q.from === portId && !held.has(q.id)
    && !(q.requires?.hidden && requiresUnmet(state, q)));
}
/* Hold units a job will cost you the moment you accept it. Only a delivery
 * hands you anything; a message weighs nothing, which is the whole joke, and a
 * salvage costs nothing until you are alongside the thing. */
export function questLoad(q){
  if(q?.type !== 'delivery') return 0;
  return unitsOf(q.goods ?? []);
}
/* What a salvage will eventually want room for. Not charged at the dock — it
 * goes aboard out there — but a ship whose whole hold is smaller than the haul
 * can never finish the job, and finding that out at the wreck is a wasted
 * crossing. */
export const salvageLoad = q => q?.type === 'salvage' ? unitsOf(q.goods ?? []) : 0;
export function canAcceptQuest(state, q){
  if(!q) return { ok: false, reason: 'No such job.' };
  const live = (state.quests ?? []).find(l => l.id === q.id);
  if(live) return { ok: false, reason: live.done ? 'Already done.' : 'Already taken.' };
  if(activeQuests(state).length >= MAX_ACTIVE_QUESTS) return { ok: false, reason: `Three jobs is all anybody can hold in their head.` };
  const unmet = requiresUnmet(state, q);
  if(unmet) return { ok: false, reason: unmet };
  if(questLeavesSystem(q) && !state.keys.astrolabe){
    return { ok: false, reason: 'That one leaves this sky. You would need an Astrolabe.' };
  }
  /* Nothing is holding you beside a wreck and nothing will catch you if you are
     wrong. Holding a ship still against it is the cat's trick a navigator's
     berth buys, and it is the same rule the harbour itself applies — refused
     here rather than at the far end, because finding out there is a crossing
     thrown away. */
  if(q.type === 'salvage'){
    if(!canDockDrifting(state)) return { ok: false, reason: 'Coming alongside a wreck takes a navigator. You have not got one.' };
    if(salvageLoad(q) > holdUnits(state)) return { ok: false, reason: 'Your whole hold is smaller than what is out there.' };
  }
  const load = questLoad(q);
  if(load > freeUnits(state)) return { ok: false, reason: 'No room in the hold for it.' };
  /* A consignment skips the market, so it also skips the market's one check:
     nothing stops somebody handing you four cases of cold medicine and a hold
     that cannot hold a temperature except this. */
  if(q.type === 'delivery' && !state.keys.tempControl
     && (q.goods ?? []).some(g => goodById(g.good)?.needsTempControl)){
    return { ok: false, reason: 'That wants temperature control.' };
  }
  return { ok: true, load };
}
export function acceptQuest(state, id){
  const q = typeof id === 'string' ? questById(id) : id;
  const can = canAcceptQuest(state, q);
  if(!can.ok) return can;
  state.quests.push({ id: q.id, step: 0, done: false, takenAt: state.t });
  /* A delivery is handed over at the dock, so it is aboard before you leave:
     paid for by somebody else, worth nothing to you, and taking up room. */
  if(q.type === 'delivery'){
    for(const g of q.goods ?? []){
      state.cargo.push({ good: g.good, qty: g.qty ?? 1, t: state.t, price: 0, from: q.from ?? state.dockedAt ?? null, questId: q.id });
    }
  }
  logLine(state, 'questTaken', TEXT.logTemplates.questTaken ?? 'Took on {title}.', { title: q.title });
  return { ok: true, quest: q };
}
/* Giving up. The consignment goes back over the side with the job — there is
 * nobody to give it to any more. */
export function abandonQuest(state, id){
  const live = (state.quests ?? []).find(l => l.id === id && !l.done);
  if(!live) return { ok: false, reason: 'Not carrying that one.' };
  state.quests = state.quests.filter(l => l !== live);
  state.cargo = state.cargo.filter(c => c.questId !== id);
  return { ok: true };
}

/* Walk every live quest forward as far as it will go. Steps only ever move
 * forward: a quest that asks you to buy a thing and bring it home does not
 * un-buy itself when you put the thing down, or the card would flicker every
 * time a hold was rearranged. */
export function questCheck(state, events = []){
  for(const live of state.quests ?? []){
    if(live.done) continue;
    const q = questById(live.id);
    if(!q) continue;
    const steps = questSteps(q);
    let moved = false;
    while(live.step < steps.length){
      const step = steps[live.step];
      if(!stepDone[step.kind]?.(state, step)) break;
      // Handing a thing over is the one step that takes something out of the hold.
      if(step.kind === 'handover') for(const g of step.goods) handOver(state, g.good, g.qty, q.id);
      /* And recovering is the one that puts something in. It goes aboard as a
         consignment, like a delivery: it is somebody else's until it is handed
         over, so it cannot be sold and the cats do not count it for a toll. */
      if(step.kind === 'recover'){
        for(const g of step.goods){
          state.cargo.push({ good: g.good, qty: g.qty, t: state.t, price: 0, from: step.port, questId: q.id });
        }
        events.push({ kind: 'salvaged', quest: q, wreck: step.port, goods: step.goods });
        flag(state, 'firstSalvage', events);
        logLine(state, 'salvaged', TEXT.logTemplates.salvaged ?? 'Salvaged from {wreck}: {what}.',
          { wreck: portName(step.port), what: step.goods.map(g => `${g.qty} × ${goodName(g.good)}`).join(', ') });
      }
      live.step++;
      moved = true;
    }
    if(live.step >= steps.length && !live.done){
      /* Finishing the work and being paid for it are two things now. The job
         stops counting against the three you can hold the moment the last step
         is met — that part should never make a player wait — but the money,
         the standing and the person are collected by hand, so the end of a job
         is something you do rather than something that happens in the corner
         of the screen while you are looking at the chart. */
      live.done = true;
      // When, so the finished list can put the last thing you did at the top.
      live.doneAt = state.t;
      live.claimed = false;
      logLine(state, 'questDone', TEXT.logTemplates.questReady ?? 'Finished {title}. There is something to collect.',
        { title: q.title, pay: fmtMoney(q.pay ?? 0) });
      events.push({ kind: 'questDone', quest: q });
    }else if(moved){
      events.push({ kind: 'questStep', quest: q, step: live.step });
    }
  }
  return events;
}

/* ----------------------------------------------------------- crew talk */

/* What somebody has to say, here, now. Pressing a face in the crew menu asks
 * this; dialog.json holds the answers, keyed by where you are and whose face
 * it was.
 *
 * Two rules, and they are the whole of it. A line written for the port you are
 * tied up at beats a line written for anywhere, because a navigator with an
 * opinion about Cinder should not shrug at Cinder — so the port's lines, if
 * there are any, are the only ones offered. And everybody a line puts words in
 * the mouth of has to actually be aboard, or an exchange half the crew is in
 * plays to an empty room.
 *
 * Nothing here touches the state. Talking is free, it changes nothing, and it
 * is not in the save: the only thing a game remembers about a conversation is
 * that it happened, and it does not remember that either. */

export const isAboard = (state, who) => who === 'captain' || !!state?.crew?.[who];

/* Everybody whose portrait is in the crew menu, in the order it shows them. */
export function aboard(state){
  return ['captain', ...(TEXT.crew?.roles ?? []).map(r => r.id).filter(id => state?.crew?.[id])];
}

export function exchangesFor(state, who){
  if(!isAboard(state, who)) return [];
  const sayable = x => x.who === who
    && [...(x.needs ?? []), ...(x.lines ?? []).map(l => l.who)].every(id => isAboard(state, id));
  const here = state?.dockedAt ?? null;
  const atPort = here ? DIALOG.filter(x => x.at === here && sayable(x)) : [];
  return atPort.length ? atPort : DIALOG.filter(x => x.at === '*' && sayable(x));
}

/* The one to show, given how many times that face has been pressed already.
 * Round and round rather than random: a player pressing twice wants the next
 * thing, not a coin toss that might repeat. */
export function exchangeFor(state, who, nth = 0){
  const list = exchangesFor(state, who);
  if(!list.length) return null;
  return list[((nth % list.length) + list.length) % list.length];
}

/* The speed a burn written here is actually measured against, and whether that
 * is a relative one.
 *
 * A press on one of the four buttons is a fraction of "how fast you are
 * going", and the frame decides which speed that is. Beside a wreck out at the
 * Lamp the ship is doing thirty-six kilometres a second round the Lamp and a
 * few dozen metres a second relative to the hulk it is trying to touch — and
 * the press was being sized off the first of those, so one tap was two hundred
 * metres a second and the whole approach could only be flown by overshooting.
 * The burn itself has always been written in the drifting thing's frame; this
 * is the button catching up with it. */
export function burnScaleAt(state, where, t){
  if(!where) return { speed: norm(state?.ship?.v ?? [0, 0]), relative: false };
  const tgt = driftTargetAt(world, where.body, where.r, t, unseen(state));
  return tgt
    ? { speed: norm(sub(where.v, tgt.v)), relative: true, target: tgt.id }
    : { speed: norm(where.v), relative: false };
}

/* What one press is worth, as a fraction of that speed.
 *
 * Flying an orbit you are nudging something enormous and a half-percent step
 * is a nudge. Coming alongside you are killing nearly all of what you have, and
 * a half-percent of two hundred metres a second is two hundred presses — so a
 * rendezvous gets a tenth of the relative speed instead. It shrinks as you
 * slow, which is the whole trick: the same button is ten metres a second when
 * you are closing fast and a tenth of one when you are nearly stopped, so the
 * last few metres a second cost no more presses than the first few hundred. */
export const BURN_STEP = 0.005, BURN_STEP_REL = 0.1;

/* How long a line takes to read, which is how long the next one waits.
 *
 * Counted in characters rather than words because the unit that matters is how
 * far the eye has to travel, and "Aye" and "Nevertheless" are not the same
 * amount of reading however you count words. Forty milliseconds a character
 * over a beat of half a second is a shade under two hundred and fifty words a
 * minute — near enough the pace of somebody reading a caption rather than a
 * book.
 *
 * Floored, so a two-word answer still lands as its own beat instead of
 * flashing past, and capped, so one long speech cannot hold the rest of the
 * conversation for half a minute. Here rather than in the page because it is a
 * rule about the writing, and because a rule in a page is a rule with no
 * test. */
export const sayMs = text => Math.max(900, Math.min(6500, 520 + (text?.length ?? 0) * 40));

/* Who a line belongs to, as a name and a berth, so the page can label it
 * without knowing how the crew table is laid out. */
export function speaker(who){
  if(who === 'captain'){
    const c = TEXT.crew?.captain;
    return { id: 'captain', name: c?.name ?? 'The captain', role: c?.role ?? 'Captain' };
  }
  const r = (TEXT.crew?.roles ?? []).find(x => x.id === who);
  return { id: who, name: r?.person?.name ?? r?.name ?? who, role: r?.name ?? who };
}

/* ------------------------------------------------------------ planning */

/* Two constants that are really real seconds wearing game days, so both are
 * written that way: the clock is what sets them, and when the clock changes
 * they have to change with it or they stop meaning anything.
 *
 * QUIET_DAYS is how long a harbour stays quiet after you cast off from it —
 * two minutes of real time at x1, long enough to be somewhere else. MIN_LEAD
 * is how far ahead of now a mark may be written: a minute, which is a tenth
 * of a lap of the orbit the game opens in and leaves room to plan inside it. */
export const QUIET_DAYS = CONST.BASE_RATE_DAYS_PER_SEC * 120;

export const MAX_NODES = 6;

/* The lesson is running until it is finished or waved off. Both flags are set
 * by the page, but the rule they gate is a rule about the plan, so it is
 * answered here where everything that writes a mark can ask it. */
export const tutorialRunning = state => !(state.flags?.tutorialDone || state.flags?.tutorialSkipped);
/* How many marks a path may carry: six, and one while the lesson is running.
 * The cards teach one burn at a time and each names the burn it means; a
 * beginner with three marks on the road cannot tell which one is being talked
 * about, and the fix for that is not a longer card. Every way of writing a
 * mark goes through addNode, so this is the only place it has to be said. */
export const maxNodes = state => (tutorialRunning(state) ? 1 : MAX_NODES);

export const MIN_LEAD = CONST.BASE_RATE_DAYS_PER_SEC * 60;

/* The hard floor under any lead: a couple of real seconds at x1. A mark is a
 * thing you push around, and one written on top of now fires before it can be
 * touched. */
export const LEAD_FLOOR = CONST.BASE_RATE_DAYS_PER_SEC * 2;

/* How much road beside the ship a finger may not land on, as a time.
 *
 * MIN_LEAD is a minute of real time at x1, and as a rule about the clock that
 * is right: a burn wants enough notice to be caught and pushed before it
 * fires. But the thing a finger aims at is a *distance on the screen*, and a
 * minute is exactly what that is not. Beside a wreck the ship covers
 * forty-eight kilometres in one, and the chart zoomed in far enough to fly
 * that rendezvous is fifty-four kilometres across — so the whole of the
 * visible road was out of bounds at precisely the zoom where it mattered.
 *
 * So the lead is whichever is shorter: the minute, or the time it takes to
 * travel a thumb's width of screen. Zoomed out the minute always wins and
 * nothing has changed; zoomed in it shrinks to a ring of pixels round the
 * ship, which is what the protection was for in the first place. */
export const TAP_CLEAR_PX = 28;
export const leadForTap = pxPerDay =>
  Math.max(LEAD_FLOOR, Math.min(MIN_LEAD, pxPerDay > 0 ? TAP_CLEAR_PX / pxPerDay : MIN_LEAD));

/* `lead` is how far ahead this particular way of writing a mark insists on.
 * It may only ever ask for *less* than the standard minute, never more, and
 * never less than the floor: a caller may say "the player is looking at this
 * closely and means it", not "let them write a mark into the past". */
export function addNode(state, t, lead = MIN_LEAD){
  const floor = Math.max(LEAD_FLOOR, Math.min(lead, MIN_LEAD));
  if(state.dockedAt || t < state.t + floor || state.nodes.length >= maxNodes(state)) return -1;
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
  if(!state.nodes.length) return [];
  /* Only as far as the last mark: the road past it says nothing about where
     any mark sits, and asking for it used to cost a solve across hundreds of
     laps to place a mark a lap away. */
  const last = Math.max(...state.nodes.map(n => n.t)) - state.t + 1e-6;
  const pred = plan(state, Math.min(horizon ?? last, last));
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
  /* A floor of twenty-five real seconds at x1: enough to pull the arrows a few
     times before the mark arrives and fires whatever it has by then. */
  const floor = Math.max(MIN_LEAD * 1.1, CONST.BASE_RATE_DAYS_PER_SEC * 25);
  return addNode(state, Math.max(state.t, last) + Math.max(floor, ahead));
}
/* What a burn *does*, in the words the four arrows use.
 *
 * The chart used to label a mark with the size of the burn and nothing else —
 * "0.12 km/s" — which is the fuel it will spend. Two playtesters read that as
 * their speed, and both were braking at the time: they pressed Back to slow
 * down and watched the number climb, which is exactly backwards from what
 * they were trying to do. The number was never speed. It is a length of
 * engine, and a length of engine is always positive however you point it.
 *
 * So the mark says what the engine will do instead, in the direction words
 * that are already written on the buttons, and the fuel it costs is shown
 * against the fuel gauge where the word "fuel" is. Nothing about a burn that
 * slows you down now goes up. */
export function burnWords(node, relTo){
  if(!node) return 'nothing yet';
  const parts = [];
  const pro = node.prograde ?? 0, rad = node.radial ?? 0;
  /* Near something drifting, the same two numbers mean something else: forward
     is along your speed relative to it, and the second axis points at it
     rather than out of an orbit. Same axes, different sentence. */
  if(Math.abs(pro) > 1e-15) parts.push(`${pro > 0 ? 'forward' : 'back'} ${fmtKms(pro)}`);
  if(Math.abs(rad) > 1e-15){
    parts.push(relTo ? `${rad > 0 ? 'away' : 'toward'} ${fmtKms(rad)}` : `${rad > 0 ? 'out' : 'in'} ${fmtKms(rad)}`);
  }
  if(!parts.length) return 'nothing yet';
  return parts.join(' · ') + (relTo ? ` · on ${relTo}` : '');
}

export function planCost(state, horizon){
  if(!state.nodes.length) return 0;
  return markStates(state, horizon).reduce((s, m) => s + m.cost, 0);
}

/* What the drawn path is about to do to you, for the two marks in the corner
 * of the chart. A skim is a warning; ground is a different warning, and they
 * are different pictures because they want different answers — one is "brace",
 * the other is "move the burn". Both read the same prediction the chart draws,
 * so the corner and the road can never disagree. */
/* `pred` is the road the chart has just drawn, when the caller has one; the
 * corner and the road must never disagree, and solving it twice was the most
 * expensive way of making sure they did not. */
export function hazards(state, pred = null){
  const none = { skim: null, crash: null };
  if(!state || state.dockedAt || state.pending) return none;
  pred ??= planImmediate(state);
  let crash = null;
  for(const sg of pred?.segments ?? []){
    if(sg.reason === 'crash'){ crash = { body: sg.body }; break; }
  }
  let skim = null;
  if(skimsAir(state)){
    /* On the drawn road if it is there; otherwise a look a few laps ahead —
       the same bounded look the flight takes, never a flat season of them. */
    let a = (pred?.events ?? []).find(e => e.kind === 'burn' && e.node.aero && e.t >= state.t)?.node;
    if(!a){
      const lead = state.nodes.length ? state.nodes[state.nodes.length - 1].t - state.t : 0;
      a = effectiveNodes(state, Math.max(lead + 1, skimHorizon(state, 1))).find(n => n.aero && n.t >= state.t);
    }
    if(a){
      const shed = Math.abs(a.prograde);
      skim = { body: a.body, t: a.t, dv: shed, risk: skimRisk(state, shed) };
    }
  }
  return { skim, crash };
}

/* The plan as the solver reads it: as far ahead as it is asked for. */
export function plan(state, horizon){
  return predictLegs(world, state.ship, state.t, sortedNodes(state), legOpts(state, { maxTime: horizon }));
}

/* ------------------------------------------------- the immediate orbit */

/* The road the chart draws is deliberately short-sighted. It shows the orbit
 * you are on and the *one* thing that happens next, and then it stops:
 *
 *   stable   one lap of the ellipse, low point and high point marked
 *   exit     the arc out to the edge of this world's reach, the crossing
 *            marked, and one lap of the orbit that leaves you in around the
 *            parent
 *   enter    the arc in to a moon's reach, the crossing marked, and the
 *            path around the moon with its low point marked
 *
 * Nothing past that first crossing is chased. A road that predicts nine
 * encounters is a road nobody can read, and every one of them past the first
 * is a guess that a single burn will erase anyway.
 *
 * `predictLegs` walks the road one leg at a time and asks after each whether
 * that is enough; the rule above is the answer. No horizon in days is ever
 * guessed at.
 */
const IMMEDIATE_CAP = 6000;
/* How many laps of a closed orbit the *drawn* road will wait for something to
 * happen before it gives up and simply draws the orbit.
 *
 * A leg is drawn as one lap however many it runs for — fifty turns of the same
 * ellipse laid on top of one another is a scribble, not a road. That is fine
 * while a leg ends on the lap you are looking at, and a lie as soon as it does
 * not: an orbit that overlaps a moon's rail meets the moon on some later lap,
 * and the door and the crosshair for that meeting were being painted onto the
 * single lap the chart drew. The picture said "just there"; the clock said
 * four days, or on a heliocentric orbit ten years. Tapping the road beside the
 * mark warped to the first lap and nothing happened; tapping the mark warped
 * past the rest of the game.
 *
 * So the road shows what happens on this lap and the next, and past that says
 * the honest thing instead: you are going round. What a pilot lines up a later
 * encounter with is the rail crossings — where a world will be when the road
 * cuts its orbit — which are drawn on the lap in front of them.
 *
 * Only the chart is bounded. The flight still looks as far as it must, or a
 * ship would fly into a reach the search had stopped short of; the aim helper
 * still looks as far as it must, or it could not score a road that arrives. */
const CHART_LAPS = 2;
const isDoor = sg => sg.reason === 'exit' || sg.reason === 'enter';

/* `flown` false draws the road the ship is on *now*, as if nothing were
 * written down: that is what the chart shows when no burn is open, so the
 * white line is always one honest lap of where you actually are. Open a burn
 * and the plan comes back, in yellow. */
/* No leg is ever drawn for more than one lap of its own conic. Choosing the
 * horizon usually arranges that by itself, but not always — a burn that
 * shrinks the orbit, or a road the boundary search had to give up part way
 * along, can leave a leg running for several turns of the same ellipse, and
 * the chart then shows a scribble where it should show a road. This is the
 * guarantee rather than the estimate: keep the samples up to one period and
 * drop the rest. */
function oneLap(seg){
  /* finishSegment already draws at most one lap, at full resolution. This is
     left as the belt to that pair of braces: it only ever has work to do for
     a segment built some other way. Trimming an already-lapped leg again
     would cut it to a fraction of a turn. */
  if(seg.lapped) return seg;
  const p = seg.elements?.period;
  const dur = seg.t1 - seg.t0;
  if(!Number.isFinite(p) || p <= 0 || dur <= p * 1.001) return seg;
  const n = seg.points.length - 1;
  const keep = Math.max(2, Math.ceil(n * (p / dur)) + 1);
  if(keep >= seg.points.length) return seg;
  const points = seg.points.slice(0, keep);
  const times = seg.times.slice(0, keep);
  /* The leg still *ends* where it ended — a burn fires at t1 whatever the
     chart drew — so only the drawing is trimmed, and `lapped` says so. */
  return { ...seg, points, times, lapped: true };
}

/* One whole turn of a leg's conic, ignoring whatever boundary cut it short.
 * The design asks for the orbit an exit leaves you on, drawn as an orbit —
 * not for the first thing that orbit would run into next spring. So when the
 * leg after the crossing ends by wandering into some *third* world, its shape
 * is drawn out to a full lap and that third world is left alone: one crossing
 * at a time is the whole rule, and a road that chases every encounter it can
 * find is a road nobody reads. */
function fullLap(seg, mu){
  const P = seg.elements?.period;
  if(!Number.isFinite(P) || P <= 0) return seg;
  const n = 240;
  const points = new Array(n + 1), times = new Array(n + 1);
  for(let i = 0; i <= n; i++){
    const dt = P * i / n;
    points[i] = propagate(mu, seg.r0, seg.v0, dt).r;
    times[i] = seg.t0 + dt;
  }
  return { ...seg, points, times, t1: seg.t0 + P, r1: points[n], reason: 'horizon', extended: true };
}

/* The intercept: how close the road comes to the world it has just entered,
 * and when. Inside that world's reach the ship is on one conic about it, so
 * the nearest point is simply that leg's periapsis — no search, no sampling,
 * exact. It is the number a pilot is actually asking for while they push a
 * burn around: not "does this reach Slate" but "how close, and how fast". */
/* Every reach the drawn road passes through, earliest first.
 *
 * It used to derive exactly one, from the index of the door the road was
 * trimmed at, and that was wrong in both directions. The road can hold two
 * reaches — falling into Grumm and going on to one of its moons is the
 * ordinary way to arrive anywhere in that system — and only one of them was
 * ever marked. Worse, which one depended on the *last* door rather than the
 * doors in between: a road from Tassel to Slate is `enter` then `exit`, so
 * with a navigator aboard (who is the reason the road is drawn as far as the
 * second door at all) the trim landed on the exit, the exit is not an
 * encounter, and the crosshair on the opening quest of the game disappeared
 * for having a better crew.
 *
 * So it walks the legs instead of indexing into them. Every run of legs about
 * the same world is one pass through one reach, and the rules for whether a
 * pass is an encounter are the two that were already here. */
function interceptsOf(segments){
  const out = [];
  for(let i = 0; i < segments.length; i++){
    const prev = i > 0 ? segments[i - 1] : null;
    if(prev && segments[i].body === prev.body) continue;      // still the same pass
    if(prev){
      /* A door the road goes in through: the encounter is inside the new
         reach. An *exit* is not one. Climbing out of a world's reach leaves
         you on an orbit round its parent, and the low point of that orbit is
         not an encounter with anything — reporting it as one put "the Lamp,
         eighty million kilometres" on the chart as though it were a near
         miss. */
      if(prev.reason !== 'enter') continue;
    }else{
      /* The first run is the reach the ship is already in. A ship that has
         just fallen into one is going round it in the arithmetic and nowhere
         near it yet: the low point ahead is the encounter, and the one place a
         rendezvous can be made. A skip ends at every change of reach, so this
         is exactly where a pilot gets put down, and without this the panel
         offers them nothing but the way out the far side.

         Two things this must not call an encounter. A parking orbit reaches
         its low point once a lap as well, and that is where you already are,
         not somewhere you are going. And a ship on its way *out* of a reach
         has its low point behind it — so it has to be falling, not climbing. */
      const first = segments[0];
      if(!first || Number.isFinite(first.elements?.period)) continue;
      if(!(dot(first.r0, first.v0) < 0)) continue;
    }
    const ic = encounterIn(segments, i);
    if(ic) out.push(ic);
  }
  return out;
}

/* The nearest the road comes to one world, over the run of legs about it. */
function encounterIn(segments, from){
  const first = segments[from];
  if(!first) return null;
  const b = world.get(first.body);
  if(!b || !(b.mu > 0)) return null;
  /* Every leg inside that reach, because a brake written down at the kiss
     splits it and the nearest pass may be on either side of the burn. */
  let best = null;
  for(let i = from; i < segments.length && segments[i].body === first.body; i++){
    const leg = segments[i];
    const dt = timeToAnomaly(b.mu, leg.r0, leg.v0, 0);
    const within = dt != null && dt >= 0 && dt <= leg.t1 - leg.t0;
    /* A leg that ends before it gets to the low point never has its nearest
       pass on it; the nearest it manages is wherever it stops. */
    const at = within ? propagate(b.mu, leg.r0, leg.v0, dt) : { r: leg.r1, v: leg.v1 };
    const d = norm(at.r);
    if(best && d >= best.distance) continue;
    best = {
      segIndex: i,
      body: leg.body,
      t: leg.t0 + (within ? dt : leg.t1 - leg.t0),
      r: at.r,
      distance: d,
      altitude: Math.max(0, d - (b.radius ?? 0)),
      speed: norm(at.v ?? leg.v1),
      grazes: d <= (b.radius ?? 0),
      inMouth: b.zoneRadius != null && d <= b.zoneRadius,
    };
  }
  return best;
}

export function planImmediate(state, flown = true, opts = {}){
  if(state.dockedAt) return null;
  const far = opts.farSight ?? seesPast(state);
  const bare = flown ? state : { ...state, nodes: [] };
  if(!flown) return planImmediate(bare, true, opts);
  /* One crossing, or two with somebody aboard who can hold the second in her
     head. The walk goes on through every burn before the wanted door, through
     the door, and through the leg after it and any burns written inside that
     reach; it stops at the first leg that ends by itself — a lap that goes
     round, a crash, the far edge of the look — or at a third door, which is
     drawn as the orbit it is and not chased. */
  const wanted = far ? 2 : 1;
  const stop = segs => {
    const last = segs[segs.length - 1];
    if(!isDoor(last) && last.reason !== 'burn') return true;
    const doors = segs.filter(isDoor).length;
    if(doors > wanted) return true;
    return false;
  };
  const pred = predictLegs(world, state.ship, state.t, sortedNodes(state), legOpts(state, { maxTime: IMMEDIATE_CAP, lapsLooked: CHART_LAPS, stop }));
  const horizon = pred.end - state.t;
  const segs = pred.segments;
  const firstCross = segs.findIndex(isDoor);
  /* One crossing, or two with somebody aboard who can hold the second in their
     head. Everything downstream keys off `crossed`, so moving it is the whole
     of the change: the trim, the full lap and the marks all follow it. */
  let crossed = firstCross;
  if(far && firstCross >= 0){
    const second = segs.findIndex((sg, i) => i > firstCross && (sg.reason === 'exit' || sg.reason === 'enter'));
    if(second >= 0) crossed = second;
  }
  /* Everything up to the crossing, then the road inside the new reach up to
     whatever ends it. A burn written down inside that reach — the brake that
     turns a flyby into an arrival — splits it into more than one leg, and
     cutting at a fixed two segments dropped the half of the encounter the
     player was actually working on. */
  let keep = segs.length;
  if(crossed >= 0){
    keep = Math.min(crossed + 2, segs.length);
    while(keep < segs.length && segs[keep - 1].reason === 'burn') keep++;
  }
  const segments = segs.slice(0, keep).map(oneLap);
  /* The leg after the crossing may itself end at a door. One of those is part
     of the same encounter — swinging past a moon and back out to the world it
     goes round — and is worth marking. Any other is a second encounter, which
     this road does not chase: draw that leg as the orbit it is and stop. */
  const last = segments.length - 1;
  if(crossed >= 0 && last > crossed){
    const fin = segments[last];
    const cameFrom = segs[crossed].body;
    const swingsBackOut = fin.reason === 'exit' && cameFrom !== fin.body;
    if(!swingsBackOut && (fin.reason === 'enter' || fin.reason === 'exit')){
      segments[last] = fullLap(fin, world.get(fin.body).mu);
    }
  }
  const endT = segments.length ? segments[segments.length - 1].t1 : state.t;
  const drawnSoi = new Set(segments.filter(sg => sg.reason === 'exit' || sg.reason === 'enter').map(sg => sg.t1.toFixed(9)));
  const events = pred.events.filter(e =>
    e.t <= endT + 1e-9 && (e.kind !== 'soi' || drawnSoi.has(e.t.toFixed(9))));
  /* Every door on the drawn road, not just the first. A burn that reaches a
     moon and swings past it has two — the way in and the way out — and a
     chart that marks only one of them is telling half the story. */
  const crossings = [];
  segments.forEach((sg, i) => {
    if(sg.reason !== 'exit' && sg.reason !== 'enter') return;
    crossings.push({
      segIndex: i, kind: sg.reason, t: sg.t1, from: sg.body,
      to: events.find(e => e.kind === 'soi' && Math.abs(e.t - sg.t1) < 1e-6)?.to ?? null,
    });
  });
  /* The encounter, if the road falls into one: inside a world's reach the ship
     is on one conic about it, so the nearest point is that leg's periapsis —
     solved, not sampled, and exact.

     There used to be a second kind beside it: a sweep over every world in the
     sky at every sample of the drawn road, marking any that the road happened
     to pass near. It was meant as something to steer an approach by, and it
     cost a quarter of every road solved to produce a crosshair that mostly
     sat on a parking orbit saying how far away the planet below was. What a
     pilot steers by is where a world will be when the road cuts its rail,
     which the chart already draws, and what the road does once it arrives,
     which is this. */
  const intercepts = interceptsOf(segments);
  return {
    ...pred, segments, events, end: endT, horizon,
    crossings,
    crossing: crossings[0] ?? null,
    /* One per reach the road passes through, earliest first. `intercept` is
       the next one, which is what the readouts and the encounter window have
       always wanted. */
    intercepts,
    intercept: intercepts[0] ?? null,
    /* From here on the road is drawn in the second colour: it is a different
       world's orbit, and it should not read as more of the same one. */
    afterFrom: crossed >= 0 ? crossed + 1 : segments.length,
  };
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
  const hohFor = hoh;
  /* Where to aim, off to one side of the target so the road passes it rather
     than hits it: halfway between the top of its air and its harbour mouth.
     A flat fraction of the mouth was enough while a mouth was ten radii, and
     stopped being enough when it became five above the air — on a small world
     that put the aim point barely two radii over the ground, and a hyperbola
     drawn that close bends into it. Every seeded road to Cinder came back a
     crash, and the aim fell back on a walk that never crossed its orbit. A
     drifting haven has no ground to stand off from, so a fraction of its own
     mouth is all there is to use there. */
  const ground = Math.max(target.radius ?? 0, target.atmo ?? 0);
  const reach = target.zoneRadius ?? target.soi ?? 0;
  const offset = ground > 0 && reach > ground ? (ground + reach) / 2 : reach * 0.4;
  const sameFrame = frame.id === here.id;
  // Cheapest first, with anything the tank cannot pay for at the back.
  const rank = cost => (cost > state.dv ? 1e6 : 0) + cost;
  // Leaving a world takes about a quarter of an orbit to line up, so the
  // departure window is the local orbit itself rather than the transfer.
  const localSpan = localPeriod ?? Math.max(2, hoh);
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
          candidates.push({ key: rank(cost), arrives: dep + tof, dep, dv, r: local.r, v: local.v });
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
          const key = rank(cost + (1 - align) * norm(vinf) * 4);
          candidates.push({ key, arrives: dep + tof, dep, dv: scale(unit(local.v), cost), r: local.r, v: local.v });
        }
      }
    }
  }
  return pickSeed(state, node, candidates, scoreFn, hohFor);
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
  const ref = period(target.mu, (r1 + (target.dockAlt ?? target.radius)) / 2) / 2;
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
      candidates.push({ key: cost + (1 - align) * norm(vinf) * 4, arrives: dep + ref, dep, dv: scale(unit(local.v), cost), r: local.r, v: local.v });
    }
  }
  return pickSeed(state, node, candidates, scoreFn, ref);
}

/* Try a handful of guesses against the real predicted road and keep whichever
 * actually arrives best. Cheapest on paper is not always best once the other
 * worlds have had their say — and a shortlist of nothing but the cheapest is
 * a shortlist of nothing but the patient ones, since waiting three laps for a
 * better alignment is exactly how you save fuel. So the list is the cheapest
 * few overall *and* the cheapest few that arrive soon, which are rarely the
 * same and are both worth a look. */
function pickSeed(state, node, candidates, scoreFn, reference){
  if(!candidates.length) return false;
  /* Waiting three laps for a better alignment is how you save fuel, and a
     shortlist of nothing but the cheapest is a shortlist of nothing but the
     patient. Half a game-year to cross between two moons is not what anybody
     means by "aim for it", so anything that slow is off the menu, and the list
     is then the cheapest few *and* the quickest few of what remains. */
  candidates.sort((a, b) => a.key - b.key);
  /* The cheapest few and the quickest few. They are rarely the same — waiting
     three laps for a better alignment is how you save fuel — and both are
     worth putting in front of the real predicted road. */
  const byTime = [...candidates].sort((a, b) => (a.arrives ?? 0) - (b.arrives ?? 0));
  const shortlist = [...new Set([...candidates.slice(0, 6), ...byTime.slice(0, 4)])];
  const scored = [];
  const hidden = unseen(state);
  for(const c of shortlist){
    const parts = nodeFromVector(c.r, c.v, c.dv, burnFrameAt(world, c.body ?? state.ship.body, c.r, c.v, state.t + c.dep, hidden));
    if(!parts) continue;
    node.t = state.t + c.dep;
    node.prograde = parts.prograde;
    node.radial = parts.radial;
    node.__r = c.r; node.__v = c.v;
    state.nodes.sort((a, d) => a.t - d.t);
    scored.push({ s: scoreFn(), t: node.t, prograde: node.prograde, radial: node.radial, arrives: c.arrives ?? Infinity, r: c.r, v: c.v });
  }
  if(!scored.length) return false;
  scored.sort((a, b) => a.s - b.s);
  const apply = c => {
    node.t = c.t; node.prograde = c.prograde; node.radial = c.radial;
    node.__r = c.r; node.__v = c.v;
    state.nodes.sort((a, d) => a.t - d.t);
  };
  apply(scored[0]);
  void reference;
  return { starts: scored, apply };
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
     Maw takes fourteen years, and a search that cannot see the arrival
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
  /* How close counts as arrived. Normally the harbour mouth — but a ship
     inside a moon's orbit is already within the planet's mouth by distance
     alone, and calling that "arrived" would make standing still the best plan
     there is. So it is never more than a good fraction of the gap the ship
     starts with. */
  const startGap = dist(shipAbsPos(state), absState(world, targetId, state.t).r);
  const mouth0 = Math.max(floor, Math.min(mouthOf(targetId), Math.max(floor, startGap * 0.5)));
  const score = () => {
    const pred = plan(state, span);
    const ca = closestApproach(world, pred, targetId, Infinity, mouth0);
    if(!ca) return Infinity;
    /* Arriving is not a matter of degree. Either the road comes inside the
       harbour mouth or it does not, and no amount of being nearly there is
       worth anything — so a plan that arrives always beats a plan that does
       not, and only then do sooner, quieter and cheaper decide between them.
       Scoring the two on one continuous scale kept producing the same absurd
       answer from opposite directions: a pass six months out because it was a
       thousand kilometres closer, or no plan at all because standing still is
       the soonest way to be exactly where you already are.

       The numbers below are in mouths and in reference crossings, so they mean
       the same thing whether the target is a pebble with a ten-thousand
       kilometre mouth or a world with a two-hundred-thousand kilometre one. */
    const mouth = mouth0;
    const bounces = pred.events.filter(e => e.kind === 'soi' && e.t < ca.t && e.to !== targetId).length;
    const crash = pred.events.find(e => e.kind === 'crash');
    if(crash && (crash.body === targetId || crash.t <= ca.t + 0.5)) return 1e9;
    if(ca.distance > mouth) return 1000 + (ca.distance - mouth) / mouth + bounces * 0.15;
    /* Time against fuel, which is the tension the whole game is built on. The
       weights lean towards fuel on purpose: a helper should hand you the
       thrifty road, because burning more is always available to a pilot who
       wants to and unburning is not. */
    const soon = (Math.max(0, ca.t - state.t) / Math.max(1e-9, reference)) * 0.25;
    const spend = (nodeCost(node.__r ?? [1, 0], node.__v ?? [0, 1], node) / auDay(1)) * 0.1;
    return soon + spend + bounces * 0.15;
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
  const seed = seedFromLambert(state, targetId, node, score);
  const seeded = !!seed;
  if(seeded && !(score() < start)){
    // The guess was worse than what the player already had; keep theirs.
    node.prograde = before.prograde; node.radial = before.radial; node.t = before.t;
    state.nodes.sort((a, c) => a.t - c.t);
  }
  if(!Number.isFinite(score()) && !added){
    // The plan does not come near it at all; there is nothing to refine.
    return { ok: false, reason: 'This road does not go near it. Aim it roughly first.' };
  }
  /* If the solved guess already arrives inside the harbour mouth there is
     nothing worth a long walk: polish it finely and stop. A button that thinks
     for four seconds reads as a game that has died. */
  const mouthNow = target.zoneRadius ?? target.soi ?? floor;
  const arrived = () => {
    const ca = closestApproach(world, plan(state, span), targetId, Infinity, mouth0);
    return ca && ca.distance <= mouthNow;
  };

  /* One pass of the hill walk, from wherever the mark is now. Wrapped up so it
     can be run again from a different guess: the first guess is sometimes one
     that arrives beautifully six months from now, and the honest answer to
     "aim for it" is rarely next spring. */
  /* One budget for the whole aim, spent by whichever walks happen. Each step
     is a full prediction, and a button that thinks for nine seconds is a
     button that has hung. */
  let budgetLeft = 450;
  const walkFrom = (close, budget) => {
    budget = Math.min(budget, budgetLeft);
    let score0 = score();
    let step = auDay(close ? 0.004 : 0.05);
    let tStep = close ? 0.02 : (Number.isFinite(el.period) ? el.period / 6 : 1);
    const finest = auDay(0.0005);
    const tFinest = 0.002;
    let evaluations = 0;
    while((step > finest || tStep > tFinest) && evaluations < budget){
      let improved = false;
      for(const axis of ['prograde', 'radial']){
        if(step <= finest) continue;
        for(const dir of [1, -1]){
          const was = node[axis];
          node[axis] = was + dir * step;
          const s = score();
          evaluations++; budgetLeft--;
          if(s < score0 - 1e-12){ score0 = s; improved = true; }
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
          evaluations++; budgetLeft--;
          if(s < score0 - 1e-12){ score0 = s; improved = true; }
          else { node.t = was; state.nodes.sort((a, c) => a.t - c.t); }
        }
      }
      if(!improved){ step /= 2; tStep /= 2; }
    }
    return score0;
  };

  let best = walkFrom(seeded && arrived(), 340);

  /* Six months to cross between two moons is not what anybody means by "aim
     for it". When the first guess lands somewhere that slow, try the quickest
     of the others and keep whichever reads better as an answer to the
     question that was asked. */
  const arrivalOf = () => {
    const ca = closestApproach(world, plan(state, span), targetId, Infinity, mouth0);
    return ca ? ca.t - state.t : Infinity;
  };
  const costNow = () => nodeCost(node.__r ?? [1, 0], node.__v ?? [0, 1], node);
  if(seed && seed.starts && seed.starts.length > 1 && budgetLeft > 80 && arrivalOf() > reference * 8){
    const keep = { t: node.t, prograde: node.prograde, radial: node.radial, score: best, when: arrivalOf(), cost: costNow() };
    const quickest = [...seed.starts].sort((a, b) => a.arrives - b.arrives)[0];
    seed.apply(quickest);
    const other = walkFrom(false, budgetLeft);
    const when = arrivalOf();
    /* Worth it only if it really is much sooner and not much dearer. Half a
       year saved is worth some fuel; nine kilometres a second to save a day is
       not what anybody asked for. */
    const worthIt = Number.isFinite(other) && when < keep.when * 0.5 && costNow() <= Math.max(keep.cost * 2, auDay(1.5));
    if(!worthIt){
      node.t = keep.t; node.prograde = keep.prograde; node.radial = keep.radial;
      state.nodes.sort((a, c) => a.t - c.t);
      best = keep.score;
    }else best = other;
  }

  if(!Number.isFinite(best)){
    node.prograde = before.prograde; node.radial = before.radial; node.t = before.t;
    state.nodes.sort((a, c) => a.t - c.t);
    if(added) removeNode(state, state.nodes.indexOf(node));
    return { ok: false, reason: 'Nothing this mark can do reaches it.' };
  }
  // The score carries penalties; report the distance the player will actually see.
  const pred = plan(state, span);
  const ca = closestApproach(world, pred, targetId, Infinity, mouth0);
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
    return { port: b.id, t: state.t + 0.01, distance: 0, speed, over: Math.max(0, speed - (b.dockSpeed + parked)), ra: Infinity, fits: false, inMouth: true, crashes: true };
  }
  const tp = timeToAnomaly(b.mu, state.ship.r, state.ship.v, 0);
  if(tp == null) return null;
  const at = propagate(b.mu, state.ship.r, state.ship.v, tp);
  const speed = norm(at.v);
  const parked = Math.sqrt(b.mu / Math.max(el.rp, b.radius));
  /* `over` is a speed and the harbour is not: tying up asks for the far side
     of the orbit to be inside the mouth. On a small moon those two part
     company — dockSpeed is half a km/s and a moon's whole circular speed is a
     fifth of that, so a ship can be "slow enough" on an ellipse five times
     too wide. `fits` is the question the harbour actually asks. */
  const fits = Number.isFinite(el.ra) && el.ra <= (b.zoneRadius ?? Infinity);
  return { port: b.id, t: state.t + tp, distance: el.rp, speed, over: Math.max(0, speed - (b.dockSpeed + parked)), ra: el.ra, fits, inMouth: el.rp <= b.zoneRadius, crashes: el.rp <= b.radius };
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
  if(k && k.inMouth && !k.crashes && (k.over > 0 || !k.fits) && k.t > state.t + MIN_LEAD) return brakeAt(state, k.port, k.t);
  const st = dockingStatus(state);
  /* As soon as a mark may be written at all: a ship crossing a harbour mouth
     at speed has no more notice than that to give. The floor is MIN_LEAD and
     not a number of its own, because a mark nearer than MIN_LEAD is refused
     by addNode — which is how this quietly offered nothing at all. */
  if(st && st.inZone && !st.ok) return brakeAt(state, st.port, state.t + MIN_LEAD * 1.05);
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
  /* Brake all the way to a parked orbit rather than to the harbour's speed
     limit. The limit is what the port will accept, but a ship left at the
     limit is still crossing the mouth and will be out the other side in an
     hour; a ship at the speed of a circle stays where it is and can tie up at
     its leisure. The difference is a few tens of metres a second. */
  const parked = b.mu > 0 ? Math.sqrt(b.mu / Math.max(gap, b.radius)) : 0;
  const target = parked;
  /* Near enough to a circle already, and the harbour agrees: nothing to do.
     The second half matters — a ship inside the speed tolerance can still be
     on an ellipse whose far side is outside the mouth, and declining there is
     how the tutorial used to run out of things to offer. */
  const wide = b.mu > 0
    && !(elementsFromState(b.mu, sub(s.r, port.r), rel).ra <= (b.zoneRadius ?? Infinity));
  if(speed <= target + b.dockSpeed * 0.25 && !wide) return -1;
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

/* ------------------------------------------------------- the Astrolabe */

/* What the sky is offering today, one line for every world that goes round
 * the Lamp. Moons are not on it: a moon is reached from the world it belongs
 * to, and that is a manoeuvre rather than a window.
 *
 * The instrument answers the question a transfer actually turns on, which the
 * chart has never been able to put a number on. A road drawn past a world
 * says nothing about whether the world will be there; the orange diamonds say
 * how far out you are; this says what that costs. Thirty degrees off the
 * window is two and a half to four extra km/s on a fourteen km/s tank — the
 * difference between half a tank and three quarters of it — and the honest
 * answer is almost always to wait nine days rather than pay it.
 */
export const WINDOW_BANDS = { perfect: 1.05, good: 1.25 };

/* Leaving a well from its parking orbit with `vinf` to spare, and catching a
 * ship that arrives with it. A drifting haven has no well to climb: you match
 * its speed and that is the whole bill. */
function wellOut(b, vinf){
  if(!b || !(b.mu > 0) || !b.dockAlt) return vinf;
  return Math.sqrt(Math.max(0, vinf * vinf - 2 * b.mu / b.soi) + 2 * b.mu / b.dockAlt) - Math.sqrt(b.mu / b.dockAlt);
}
function wellIn(b, vinf){
  if(!b || !(b.mu > 0) || !b.dockAlt) return vinf;
  return Math.max(0, Math.sqrt(Math.max(0, vinf * vinf - 2 * b.mu / b.soi) + 2 * b.mu / b.dockAlt) - Math.sqrt(b.mu / b.dockAlt));
}

/* Where a crossing starts. Tied up or in orbit round a world, it starts at
 * that world's mooring and has its well to climb. Coasting between worlds it
 * starts at the ship, which is already in the Lamp's frame with nothing to
 * climb out of — and that is exactly when a pilot wants to read this, so the
 * instrument going blank there was the whole of it being useless in flight. */
function departure(state){
  const here = helioOf(state.dockedAt ?? state.ship.body);
  if(!here || here.id === world.root.id) return { body: null, r: shipAbsPos(state), v: shipAbsVel(state) };
  const a = absState(world, here.id, state.t);
  return { body: here, r: a.r, v: a.v };
}

/* The cheapest crossing that leaves now, found by asking Lambert for a spread
 * of flight times and keeping the best. Departing at the wrong phase is not a
 * worse Hohmann, it is a different conic entirely — faster or slower, so that
 * the arrival lands where the target has got to — which is why this is a
 * search and not a formula. */
export function crossingNow(state, targetId, samples = 24, from = departure(state)){
  const to = world.get(targetId);
  if(!to || from.body?.id === to.id || to.parent !== 'lamp') return null;
  const mu = CONST.MU_LAMP;
  const a = from;
  const r1 = norm(a.r), r2 = to.a;
  if(!(r1 > 0)) return null;
  const ccw = cross(a.r, a.v) > 0;
  const tH = hohmann(mu, r1, r2).time;
  /* Half the Hohmann time up to half again as long. The genuinely cheapest
     conic at a bad phase is a very slow one — a crawl out to Grumm two years
     long, quoted at a price that looks reasonable and is not a road anybody
     would fly. An instrument that recommends that is lying by omission, so
     the search only offers crossings a person would actually take, and a
     phase that has no good road in that window reads as dear, which it is. */
  const costAt = tof => {
    const tgt = absState(world, targetId, state.t + tof);
    const L = lambert(mu, a.r, tgt.r, tof, ccw);
    if(!L) return Infinity;
    const cost = wellOut(from.body, dist(L.v1, a.v)) + wellIn(to, dist(L.v2, tgt.v));
    return Number.isFinite(cost) ? cost : Infinity;
  };
  /* A coarse sweep to find the dip, then a golden section to sit in the
     bottom of it. The cost is smooth in the flight time, so two dozen looks
     and a dozen refinements find what a hundred and forty looks used to. */
  const lo = tH * 0.5, hi = tH * 1.6;
  let bi = -1, bc = Infinity;
  const coarse = [];
  for(let i = 0; i <= samples; i++){
    const tof = lo + (hi - lo) * (i / samples);
    const c = costAt(tof);
    coarse.push(c);
    if(c < bc){ bc = c; bi = i; }
  }
  if(bi < 0) return null;
  let best = { cost: bc, tof: lo + (hi - lo) * (bi / samples) };
  let x0 = lo + (hi - lo) * (Math.max(0, bi - 1) / samples), x1 = lo + (hi - lo) * (Math.min(samples, bi + 1) / samples);
  const phi = (Math.sqrt(5) - 1) / 2;
  let p = x1 - phi * (x1 - x0), q = x0 + phi * (x1 - x0);
  let fp = costAt(p), fq = costAt(q);
  for(let i = 0; i < 14; i++){
    if(fp < fq){ x1 = q; q = p; fq = fp; p = x1 - phi * (x1 - x0); fp = costAt(p); }
    else{ x0 = p; p = q; fp = fq; q = x0 + phi * (x1 - x0); fq = costAt(q); }
  }
  const tof = (x0 + x1) / 2, c = costAt(tof);
  if(c < best.cost) best = { cost: c, tof };
  if(fp < best.cost) best = { cost: fp, tof: p };
  if(fq < best.cost) best = { cost: fq, tof: q };
  return best;
}

/* And what the same crossing costs when the window is right: the plain
 * Hohmann between the two rails, through the same wells. */
export function crossingBest(state, targetId, from = departure(state)){
  const to = world.get(targetId);
  if(!to) return null;
  const r1 = norm(from.r);
  if(!(r1 > 0)) return null;
  const h = hohmann(CONST.MU_LAMP, r1, to.a);
  return { cost: wellOut(from.body, h.dv1) + wellIn(to, h.dv2), tof: h.time };
}

export function transferWindows(state){
  const from = departure(state);
  const rows = [];
  for(const b of world.bodies){
    if(b.parent !== 'lamp' || b.id === from.body?.id) continue;
    /* Worlds, not wrecks. A window is the cheap day to cross between two
       circles; a derelict on a long ellipse has no such day, and the
       instrument would be offering a number that means nothing. */
    if(b.kind === 'wreck') continue;
    const now = crossingNow(state, b.id, undefined, from);
    const best = crossingBest(state, b.id, from);
    const w = nextWindow(state, b.id);
    if(!now || !best) continue;
    /* Impossible is measured against the tank rather than against what is in
       it: this is a fact about the sky and the ship, not about whether you
       happen to be running low at a pump. */
    const ratio = best.cost > 0 ? now.cost / best.cost : Infinity;
    const band = now.cost > usableTank(state) ? 'impossible'
      : ratio <= WINDOW_BANDS.perfect ? 'perfect'
      : ratio <= WINDOW_BANDS.good ? 'good'
      : 'bad';
    rows.push({
      id: b.id, name: b.name, band,
      cost: now.cost, best: best.cost, tof: now.tof,
      days: w?.days ?? null, every: w?.synodic ?? null,
    });
  }
  return rows.sort((a, b) => a.cost - b.cost);
}

export const departureName = state => departure(state).body?.name ?? null;

/* A crossing is a crossing whatever the paperwork says: a job whose route
 * leaves the sky it was handed to you in needs the instrument that reads the
 * sky. No harbourmaster hands out interplanetary work to a ship that cannot
 * tell a window from a whim. */
export function questLeavesSystem(q){
  if(!q) return false;
  const home = helioOf(q.from ?? '')?.id ?? null;
  if(!home) return false;
  const ports = [q.from, q.to, ...(q.stops ?? []), ...questSteps(q).map(st => st.port)].filter(Boolean);
  return ports.some(p => helioOf(p)?.id !== home);
}

/* ------------------------------------------------------------ markets */

/* Who wants a thing, in the words the goods table itself uses — sometimes a
 * port, sometimes a whole people, once "everyone". Two lists: the ones who
 * love it, and the ones who merely want it, which is the loved list taken out
 * of the buyer list so nobody is named twice.
 *
 * This is Wicket's work. Until the appraiser's berth is filled a player has
 * the thing in front of them and what it is made of, and has to reason from
 * that to who would pay for it; she is the one who can simply say. Nothing
 * here checks the berth — the page does, because the knowledge exists in the
 * world whether or not anybody aboard has it.
 */
const wantName = id => id === 'everyone' ? 'everyone'
  : SPECIES[id] ? SPECIES[id].plural.toLowerCase()
  : portName(id);
const wantWords = list => {
  const said = list.map(wantName);
  if(said.length <= 1) return said[0] ?? '';
  return said.slice(0, -1).join(', ') + ' and ' + said[said.length - 1];
};
export function lovedByWords(goodId){
  return wantWords(goodById(goodId).lovedBy ?? []);
}
/* Which ports a token means: itself, or everywhere its people live. */
const portsNamed = token => token === 'everyone' ? Object.keys(PORTS)
  : PORTS[token] ? [token]
  : Object.keys(PORTS).filter(id => PORTS[id].species === token);
export function wantedByWords(goodId){
  const g = goodById(goodId);
  /* Taken out by the ports they mean rather than by the word written down.
     Cider is loved by the otters and its buyer list also names Tassel, which
     is an otter port: listing Tassel as merely wanting it would be wrong. */
  const loved = new Set((g.lovedBy ?? []).flatMap(portsNamed));
  const rest = (g.buyers ?? []).filter(b => portsNamed(b).some(id => !loved.has(id)));
  return wantWords(rest);
}

/* What a port pays for a thing, as a multiple of its base price, and the whole
 * of the selling side in one lookup.
 *
 * Two questions and nothing else. Does this port want it — loved, merely on the
 * buyer list, or neither — and is it out of the good's own region? Space is
 * hard and there are few merchants who cross between peoples, so carrying a
 * loved good to another people is the trade the game is about (×5.5), and the
 * same run inside one system is worth a fraction of it (×2.5). A good nobody
 * named is sold at a loss to whoever will take it.
 *
 * It used to be a product of a region multiplier and a love multiplier, which
 * could not hit all four corners at once: making the in-system numbers right
 * dragged the cross-region ones down with them. A table has no such trouble,
 * and a player can be told it in one sentence.
 *
 * The producer is the exception: a stall does not buy back what it is selling
 * two feet away. Those are priced as unwanted and then capped (see sellPrice).
 */
export function demandMul(portId, goodId){
  const f = FORMULAS.demand;
  const g = goodById(goodId);
  if(g.producedAt.includes(portId)) return f.unwanted;
  const here = REGION_OF[portId];
  const away = g.producedAt.length && !g.producedAt.some(p => REGION_OF[p] === here);
  if(lovesGood(portId, goodId)) return away ? f.lovedAway : f.lovedSame;
  if(PORTS[portId].buys.some(b => b.good === goodId)) return away ? f.likedAway : f.likedSame;
  return f.unwanted;
}

/* Said in words, for the row a player actually reads. */
export function demandWords(portId, goodId){
  const g = goodById(goodId);
  if(g.producedAt.includes(portId)) return 'they make it here';
  if(lovesGood(portId, goodId)) return 'they love it';
  if(PORTS[portId].buys.some(b => b.good === goodId)) return 'they want it';
  return 'nobody here wants it';
}

/* How much of a stall's shelf you have already taken this visit. Shelves do
 * not regrow on a clock — waiting at a dock gets you nothing — so this is
 * simply a count, cleared when the shelves are rolled again. It no longer
 * moves the price: the shelf is the limit, and that is limit enough. */
function shortfall(state, portId, goodId){
  return state.markets[portId]?.bought?.[goodId] ?? 0;
}

/* Emberkin fashion: a slow wave per good, so what Cinder wants this week is
 * not what it wanted last week. Otter haggle: a daily jitter, the ritual
 * without the dialogue. Frogs: neither. */
function speciesMood(portId, goodId, t){
  const sp = PORTS[portId].species;
  const g = goodById(goodId);
  const vol = FORMULAS.volatility.bySpecies[sp] ?? 0;
  let m = 1;
  if(vol && (g.category === 'luxury' || g.category === 'fresh' || sp === 'cat')){
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
  let price = g.basePrice * row.priceMul * speciesMood(portId, goodId, state.t);
  price *= 1 - repDiscount(state, p.species);
  return Math.max(1, Math.round(price));
}

/* What the port pays for one unit. Everyone buys everything at some price; the
 * ones who want it pay for it, and the ones who need a hold that holds a
 * temperature pay half as much again on top — that is what the Engineer and
 * her 2,800-cowrie box are for. */
export function sellPrice(state, portId, goodId){
  const p = PORTS[portId];
  const g = goodById(goodId);
  let price = g.basePrice * demandMul(portId, goodId) * speciesMood(portId, goodId, state.t);
  if(g.needsTempControl) price *= FORMULAS.demand.tempControlMul;
  price *= 1 + repDiscount(state, p.species) * 0.5;
  /* A port that sells this itself will never pay more than it asks. Otherwise
     a stall with a low price and no entry on its buying list is a money pump
     you never have to leave the dock to work. */
  if(p.sells.some(x => x.good === goodId)){
    price = Math.min(price, buyPrice(state, portId, goodId) * FORMULAS.demand.resaleCap);
  }
  return Math.max(1, Math.round(price));
}

/* What this stall had on the shelf when you walked in. A merchant keeps what
 * they keep — a number out of the good's own range — and the number is rolled
 * from the port, the good and which visit this is, so it is the same shelf
 * every time the frame is drawn and needs nothing stored but the visit count.
 *
 * The shelves are rolled again when you come back from somewhere else. That is
 * the whole restocking rule: trade elsewhere and this stall will have found
 * more; stand at the dock and wait and it will not. */
export function stockFull(state, portId, goodId){
  const g = goodById(goodId);
  const p = PORTS[portId];
  if(!p?.sells.some(r => r.good === goodId)) return 0;
  const [lo, hi] = g.stock ?? [1, 1];
  const visit = state.markets[portId]?.visit ?? 0;
  const rolled = lo + Math.floor(hash(portId, goodId, visit) * (hi - lo + 1));
  /* Scaled by how big a market this is. Tassel is the capital and keeps twice
     what the table says; Croak is a hamlet and keeps a third of it. marketSize
     used to do this work on the selling side, as the size of a port's appetite
     before it tired of a good — when that rule went, the field described
     something nothing read. The shelf is the better home for it: it is what a
     market *being big* actually means to a trader, and it is what decides
     whether a bigger hold is worth buying. */
  return Math.max(1, Math.round(rolled * (p.marketSize ?? 1)));
}
export function stockAvailable(state, portId, goodId){
  return Math.max(0, stockFull(state, portId, goodId) - shortfall(state, portId, goodId));
}

/* A visit is a market you have come back to, not a door you opened twice.
 * Docking somewhere new turns the page; the next time you tie up anywhere,
 * that stall rolls fresh shelves. Casting off and immediately tying up again
 * gets you the shelves you just picked over, which is the point. */
export function openMarket(state, portId){
  if(state.lastMarket !== portId){ state.marketEpoch = (state.marketEpoch ?? 0) + 1; state.lastMarket = portId; }
  const m = market(state, portId);
  if(m.visit !== state.marketEpoch){ m.visit = state.marketEpoch; m.bought = {}; }
}

function market(state, portId){
  return state.markets[portId] ??= { bought: {} };
}
export function canBuy(state, goodId, qty){
  const port = state.dockedAt;
  if(!port) return { ok: false, reason: 'Not docked.' };
  if(!Number.isInteger(qty) || qty < 1) return { ok: false, reason: 'That is not a number of crates.' };
  if(!portOpen(port, state.t)) return { ok: false, reason: 'The market is closed.' };
  const g = goodById(goodId);
  const price = buyPrice(state, port, goodId);
  if(price == null) return { ok: false, reason: 'Not sold here.' };
  if(g.needsTempControl && !state.keys.tempControl) return { ok: false, reason: 'Needs temperature control.' };
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
  // What is missing off the shelf this visit, until the shelves are rolled again.
  market(state, port).bought[goodId] = shortfall(state, port, goodId) + qty;
  // Stacks are split by what was paid, so the hold remembers each buy.
  const stack = state.cargo.find(s => s.good === goodId && Math.abs(s.t - state.t) < 1e-9 && s.price === c.price);
  if(stack) stack.qty += qty; else state.cargo.push({ good: goodId, qty, t: state.t, price: c.price, from: port });
  state.stats.bought += qty;
  if(PORTS[port].species === 'frog') state.rep.frog += 0.05 * qty;   // frogs give; taking is how you let them
  logLine(state, 'bought', TEXT.logTemplates.bought, { qty, good: goodById(goodId).name, price: fmtMoney(total), port: portName(port) });
  const events = questCheck(state, []);
  return { ok: true, total, events };
}

/* Sell from the oldest stack first: the crate going off is the one to move. */
export function sell(state, goodId, qty){
  const port = state.dockedAt;
  if(!port) return { ok: false, reason: 'Not docked.' };
  if(!portOpen(port, state.t)) return { ok: false, reason: 'The market is closed.' };
  if(!Number.isInteger(qty) || qty < 1) return { ok: false, reason: 'That is not a number of crates.' };
  /* What a port wants only ever moved the price: every good in the game sells
     anywhere. A relic in the making is the exception — there is no stall in the
     sky that will turn one back into money, which is what stops the thing you
     were sent to fetch being worth more as a sale than as an ending. */
  if(goodById(goodId)?.noResale) return { ok: false, reason: 'Nobody will take that off you. Not here, not anywhere.' };
  const stacks = state.cargo.filter(s => s.good === goodId && !isConsigned(s)).sort((a, b) => a.t - b.t);
  const have = stacks.reduce((s, c) => s + c.qty, 0);
  if(have < qty) return { ok: false, reason: have ? 'The rest of those belong to somebody.' : 'Not that many aboard.' };
  /* One price for the whole sale. It used to walk down as the crates came off
     the ship, which is the last of the supply-and-demand rules and is gone with
     the rest of them: what a stall pays is what a stall pays. The stacks are
     still walked oldest first, because each one remembers what it cost and the
     profit line is the difference. */
  const unitPrice = sellPrice(state, port, goodId);
  let left = qty, total = 0, cost = 0;
  for(const s of stacks){
    if(left <= 0) break;
    const take = Math.min(left, s.qty);
    total += unitPrice * take; cost += s.price * take;
    s.qty -= take; left -= take;
  }
  state.cargo = state.cargo.filter(s => s.qty > 0);
  state.money += total;
  state.stats.sold += qty;
  const sp = PORTS[port].species;
  const g = goodById(goodId);
  if(sp in state.rep && lovesGood(port, goodId)) state.rep[sp] += 0.1 * qty * Math.min(1, g.basePrice / 100);
  logLine(state, 'sold', TEXT.logTemplates.sold, { qty, good: g.name, price: fmtMoney(total), port: portName(port) });
  return { ok: true, total, profit: total - cost };
}

export function cargoValue(state, portId = null){
  // Valued at the going rate here if docked, else at base. A consignment is
  // not in this sum: it is not yours, and a toll that took it would kill a
  // job with no way back.
  return state.cargo.filter(c => !isConsigned(c)).reduce((s, c) => {
    const g = goodById(c.good);
    const unitPrice = portId ? sellPrice(state, portId, c.good) : g.basePrice;
    return s + unitPrice * c.qty;
  }, 0);
}

/* ---------------------------------------------------------------- fuel */

export function fuelPrice(state, portId = state.dockedAt){
  const p = PORTS[portId];
  if(!p || p.fuelPricePerKms == null) return null;
  if(!portOpen(portId, state.t)) return null;   // the pumps went with the colony
  return p.fuelPricePerKms * (1 - repDiscount(state, p.species) * 0.5);
}
/* A ship with no fuel and no coin, tied up at a dock, is a ship that can never
 * leave — and the design document is clear that nothing may cost the save. So
 * the harbour bank will front enough to get going again, at a price, as they do
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


/* Putting it right. A yard will do hull and cell; neither can be done under
 * way, and neither is ever compulsory — a battered ship still undocks, which
 * is what keeps a broke one from being a stuck one. */
export function canRepair(state, what){
  if(!state.dockedAt) return { ok: false, reason: 'Only at a dock.' };
  if(!PORTS[state.dockedAt]?.shipyard) return { ok: false, reason: 'No yard here.' };
  const cost = repairCost(state, what);
  if(cost <= 0) return { ok: false, reason: what === 'fuelCell' ? 'The cell is sound.' : 'The hull is sound.' };
  if(state.money < cost) return { ok: false, reason: 'Not enough coin.', cost };
  return { ok: true, cost };
}
export function repair(state, what){
  const c = canRepair(state, what);
  if(!c.ok) return c;
  state.money -= c.cost;
  if(what === 'fuelCell'){
    state.faults = { ...(state.faults ?? {}), fuelCell: false };
    logLine(state, 'story', TEXT.events.repairFuelCell);
  }else{
    state.hull = 0;
    logLine(state, 'story', TEXT.events.repairHull);
  }
  return { ok: true, cost: c.cost };
}

export function refuel(state, kmsWanted){
  const price = fuelPrice(state);
  if(price == null) return { ok: false, reason: 'No fuel sold here.' };
  const room = kms(usableTank(state) - state.dv);
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
  state.dv = Math.min(usableTank(state), state.dv + auDay(amount));
  logLine(state, 'refuelled', TEXT.logTemplates.refuelled, { amount: `${amount.toFixed(1)} km/s`, price: fmtMoney(cost), port: portName(state.dockedAt) });
  if(borrowed > 0) logLine(state, 'story', TEXT.events.bankDebt);
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
  if(!portOpen(port, state.t)) return { ok: false, reason: 'The yard is shut for the season.' };
  if(ownsUpgrade(state, u)) return { ok: false, reason: 'Already fitted.' };
  if(u.kind !== 'key' && state.tiers[u.kind] !== u.tier - 1) return { ok: false, reason: 'Needs the tier below first.' };
  /* Money is not the only thing a yard wants. The second and third tank and
     hold are fitted rather than sold: a dock hand will bolt on the first size
     up for anyone with the coin, and will not cut into a hull for a captain
     with nobody aboard who could put it back together. The rest of the rack
     is the same rule for the same reason. */
  if(u.requiresCrew && !state.crew?.[u.requiresCrew]){
    const role = (TEXT.crew?.roles ?? []).find(r => r.id === u.requiresCrew)?.name ?? u.requiresCrew;
    return { ok: false, reason: `That is work for ${aOrAn(role)}, and the berth is empty.` };
  }
  if(u.requiresUpgrade && !ownsUpgrade(state, upgradeById(u.requiresUpgrade))){
    return { ok: false, reason: `Needs ${upgradeById(u.requiresUpgrade).name.toLowerCase()} first.` };
  }
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
    state.dv = Math.min(state.dv, usableTank(state));   // a bad cell caps the new one too
  }
}

/* --------------------------------------------------------------- tolls */

/* The Scatter: crossing into the belt in the Lamp's frame brings a cat
 * captain alongside. Once per crossing, and never twice inside a month: the
 * oath is a toll, not a tax. */
function tollCheck(state, events){
  const inLamp = state.ship.body === 'lamp';
  const r = inLamp ? norm(state.ship.r) : norm(shipAbsPos(state));
  const inBelt = r >= CONST.BELT.inner && r <= CONST.BELT.outer;
  const was = state.toll.inBelt;
  state.toll.inBelt = inBelt;
  if(!inBelt || was || !inLamp) return;
  if(state.t - state.toll.lastT < FORMULAS.toll.cooldownDays) return;
  state.toll.lastT = state.t;
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
    /* Crates to the value of the toll, and never past it: they take a share,
       not the hold. The ceiling is a share of what the hold is *worth* — a
       ceiling counted in crates took nothing at all from a light hold of
       valuable things, and let a heavy hold of cheap ones be stripped. And a
       crate is only taken if it leaves the debt smaller than it found it, so
       the last one cannot overshoot the toll by its own price. */
    const value = cargoValue(state);
    let owed = Math.min(p.amount, value * f.maxCargoFraction);
    const taken = [];
    /* Cheapest first, so the toll is made up of what it takes rather than
       rounded up to the dearest thing aboard — and so a hold of expensive
       crates cannot come out untouched because no single crate was small
       enough to fit under the figure. */
    const crates = [];
    for(const stack of state.cargo){ if(isConsigned(stack)) continue; for(let i = 0; i < stack.qty; i++) crates.push(stack); }
    crates.sort((a, b) => goodById(a.good).basePrice - goodById(b.good).basePrice);
    let left = crates.length;
    for(const stack of crates){
      const g = goodById(stack.good);
      if(left <= 1) break;                  // never everything: the oath
      if(owed < g.basePrice * 0.5) break;
      stack.qty--; owed -= g.basePrice; left--;
      const rec = taken.find(t => t.good === stack.good); if(rec) rec.qty++; else taken.push({ good: stack.good, qty: 1 });
    }
    /* Nothing aboard is small enough to make up the toll — three crates of
       glassware against a bill worth half of one. Taking one anyway would be
       taking more than was asked, which is the thing the oath is about, so
       they settle in coin instead and say so. */
    if(!taken.length){
      const paid = Math.min(p.amount, Math.max(0, state.money) * 0.5);
      state.money -= paid;
      state.stats.tolls++;
      state.pending = null;
      state.rep.cat += 1;
      logLine(state, 'tolled', TEXT.logTemplates.tolled, { captain: p.captain });
      return { ok: true, text: fill(TEXT.events.tollPaidCoin, { amount: fmtMoney(paid), captain: p.captain }) };
    }
    state.cargo = state.cargo.filter(s => s.qty > 0);
    const list = taken.map(t => `${t.qty} ${goodById(t.good).name}`).join(', ') || 'nothing at all';
    text = fill(TEXT.events.tollPaidCargo, { cargo: list, captain: p.captain });
    // Goodwill is for what was actually handed over, not for the offer.
    state.rep.cat += taken.length ? 1.5 : 0;
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
  const dry = state.dv <= 1e-9;
  const pick = requireFuel => {
    let best = null;
    for(const id of portIds){
      const b = world.get(id);
      if(!b.port) continue;
      // A tug will not take you somewhere with nobody in it, will not chase a
      // colony that has left for the winter, and will not tow you to where you
      // already are.
      if(!PORTS[id].towAllowed) continue;
      if(!portOpen(id, state.t)) continue;
      if(id === state.dockedAt) continue;
      /* And a tow that leaves a dry ship at a dock with no fuel pump has not
         rescued anybody: the Arc and the Maw sell nothing to burn, so a ship
         towed to one of them could never leave again. The
         design is explicit that nothing costs the save. */
      if(requireFuel && PORTS[id].fuelPricePerKms == null) continue;
      const d = dist(here, absState(world, id, state.t).r);
      if(!best || d < best.d) best = { id, d };
    }
    return best;
  };
  return pick(dry) ?? pick(false);
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
 * is a debt to the harbour bank, who are delighted. */
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
  state.lastPort = q.port;
  placeDocked(state, q.port);
  state.stats.tows++;
  /* The tow is what puts a wreck back together — "they pick the ship up in
     pieces and put most of them back". Leaving the hull at wrecked would
     strand the player at a level the yard has no price for, and re-wreck them
     on the next pass. The crash multiplier on the bill is what it cost. */
  if(reason === 'crash' || reason === 'atmosphere') state.hull = 0;
  const pool = reason === 'crash' ? TEXT.events.towCrash : TEXT.events.towDry;
  const story = reason === 'atmosphere' ? TEXT.events.towAtmosphere : pool[Math.floor(rnd(state) * pool.length)];
  if(!state.visited.includes(q.port)) state.visited.push(q.port);
  logLine(state, 'towed', TEXT.logTemplates.towed, { port: portName(q.port), cost: fmtMoney(cost), days: fmtDays(q.days) });
  if(state.debt > 0) logLine(state, 'story', TEXT.events.bankDebt);
  /* Arriving on the end of a rope is still arriving: whatever the place has to
     say to a first visitor, it says. */
  const events = [];
  milestonesOnDock(state, q.port, events);
  return { ...q, cost, story, events };
}

/* The distress call: the way out of a dead stop, for a ship that has nothing
 * left to bargain with but money.
 *
 * A tow is a service you buy — a fixed sum, a tug from the nearest port,
 * and the harbour bank behind it if you cannot cover the bill. A distress
 * call is not a purchase. It goes out to the last dock you tied up at, they
 * come and get you, and they take half of everything you have for the
 * trouble. Half, and not a sum, on purpose: a pilot who ran the tank dry
 * with an empty purse is rescued for nothing, because the design is explicit
 * that nothing may cost a player their save, and a price that is a share can
 * never be one somebody cannot pay.
 */
export const DISTRESS_SHARE = 0.5;

/* Who answers. The last mooring, because they know the ship — unless being
 * put down there is not a rescue: the Arc and the Maw sell nothing to burn,
 * and a dry ship left at either could never leave again. Then the nearest
 * port with a pump answers instead, as it does for a tow. */
export function distressPort(state){
  const last = state.lastPort;
  const usable = PORTS[last] && last !== state.dockedAt
    && portOpen(last, state.t) && PORTS[last].fuelPricePerKms != null;
  return usable ? last : (nearestPort(state)?.id ?? null);
}

export function distressQuote(state){
  const port = distressPort(state);
  if(port == null) return null;
  /* Rounded down, so the share is never more than the share, and a purse of
     one coin still buys a rescue and keeps the coin. */
  return { port, cost: Math.floor(state.money * DISTRESS_SHARE), home: port === state.lastPort };
}

/* Only with the tank actually empty. Not low, not nearly: a ship with a
 * metre per second left can still change its mind about something, and being
 * able to buy a way home out of an awkward orbit would make every hard
 * transfer optional. */
export function canCallDistress(state){
  return !state.dockedAt && state.dv <= 1e-9 && distressQuote(state) != null;
}

export function callDistress(state){
  if(!canCallDistress(state)) return null;
  const q = distressQuote(state);
  state.money -= q.cost;   // a share of what there is, so it can never make a debt
  state.nodes = [];
  state.pending = null;
  state.dockedAt = q.port;
  state.lastPort = q.port;
  placeDocked(state, q.port);
  openMarket(state, q.port);
  if(!state.visited.includes(q.port)) state.visited.push(q.port);
  state.stats.rescues = (state.stats.rescues ?? 0) + 1;
  const pool = TEXT.events.distress ?? [];
  const story = pool.length ? pool[Math.floor(rnd(state) * pool.length)] : '';
  logLine(state, 'towed', TEXT.logTemplates.rescued, { port: portName(q.port), cost: fmtMoney(q.cost) });
  /* Arriving on somebody else's rope is still arriving, and the hold arrived
     with you: a delivery that ends at this port is delivered. */
  const events = [{ kind: 'docked', port: q.port }];
  questCheck(state, events);
  milestonesOnDock(state, q.port, events);
  return { ...q, story, events };
}

/* Paying the bank back happens whenever there is coin: quietly, first. */
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
  if(port === 'maw') say('mawArrival');
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

/* ------------------------------------------------------------- the slots
 *
 * Three saves per browser, one legacy key, and a string you can carry between
 * machines. All of it lives here rather than in either page, because the title
 * screen and the game both read and write these and a second copy of the rules
 * is how the two come to disagree about what a save is.
 *
 * The store is a parameter so the tests can run it without a browser, and so a
 * page with no localStorage at all (a private window, blocked site data) gets
 * `null` back rather than an exception in the middle of drawing.
 */
export const LEGACY_KEY = 'ot:save:v1';
export const SLOTS = [1, 2, 3];
export const slotKey = n => `${LEGACY_KEY}:${n}`;
export const ACTIVE_KEY = `${LEGACY_KEY}:active`;
export const isSlot = n => SLOTS.includes(Number(n));

function store(given){
  if(given) return given;
  try{ return globalThis.localStorage ?? null; }catch{ return null; }   // blocked site data throws on access
}
const read = (key, st) => { try{ return store(st)?.getItem(key) ?? null; }catch{ return null; } };
const write = (key, value, st) => { try{ store(st)?.setItem(key, value); return true; }catch{ return false; } };
const drop = (key, st) => { try{ store(st)?.removeItem(key); return true; }catch{ return false; } };

/* ---------------------------------------------------------------- hex */

/* A save as something a person can paste into a message. Hex rather than
 * base64 on purpose: it survives being word-wrapped, retyped in the wrong
 * case, or mangled by a chat client that thinks + and / are worth escaping,
 * and a bad character is obvious rather than silently decoding to rubbish. */
export function toHex(text){
  const bytes = new TextEncoder().encode(String(text));
  let out = '';
  for(const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
export function fromHex(hex){
  /* Whatever the paste picked up on the way: spaces, newlines, the tabs a
     code block adds. What is left has to be hex and has to be whole. */
  const clean = String(hex).replace(/\s+/g, '').toLowerCase();
  if(!clean) throw new Error('There is nothing there to read.');
  if(!/^[0-9a-f]+$/.test(clean)) throw new Error('That is not a save: it has characters a save never has.');
  if(clean.length % 2) throw new Error('That save is cut short — it ends in the middle of a character.');
  const bytes = new Uint8Array(clean.length / 2);
  for(let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  try{ return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch{ throw new Error('That save is damaged: what is in it is not text.'); }
}
export const exportSave = state => toHex(serialize(state));
/* Imported saves go through the same door as saved ones — version gate and
 * all — so a hand-edited string cannot get a shape the game cannot fly. */
export const importSave = hex => restore(fromHex(hex));

/* --------------------------------------------------------------- slots */

export function readSlot(n, st){
  if(!isSlot(n)) return null;
  const raw = read(slotKey(n), st);
  if(!raw) return null;
  try{ return restore(raw); }catch{ return null; }   // an unreadable slot reads as an empty one
}
export function writeSlot(n, state, st){
  if(!isSlot(n) || !state) return false;
  return write(slotKey(n), serialize(state), st);
}
export function clearSlot(n, st){
  if(!isSlot(n)) return false;
  return drop(slotKey(n), st);
}
export function activeSlot(st){
  const n = Number(read(ACTIVE_KEY, st));
  return isSlot(n) ? n : 1;
}
export const setActiveSlot = (n, st) => isSlot(n) ? write(ACTIVE_KEY, String(n), st) : false;

/* What a slot says about itself on the title screen, without the caller
 * having to know how a ship's whereabouts are spelled. */
export function slotSummary(state){
  if(!state) return null;
  const { year, day } = calendar(state.t);
  return {
    shipName: state.shipName ?? 'Your ship',
    year, day,
    where: state.dockedAt ? portName(state.dockedAt) : null,
    money: state.money,
    text: `${state.shipName ?? 'Your ship'} · year ${year}, day ${day} · ${state.dockedAt ? 'docked at ' + portName(state.dockedAt) : 'under way'}`,
  };
}

/* The one-time move. A save written before there were slots becomes slot one,
 * and only if slot one is free — a player who has already started a game there
 * is not going to have it replaced by something older. The legacy key is only
 * dropped once the copy has been read back, so a write that silently failed
 * leaves the original where it was. */
export function migrateLegacy(st){
  const raw = read(LEGACY_KEY, st);
  if(!raw) return 'none';
  if(read(slotKey(1), st)) return 'kept';       // slot one is spoken for
  try{ restore(raw); }catch{ return 'unreadable'; }
  if(!write(slotKey(1), raw, st)) return 'failed';
  if(read(slotKey(1), st) !== raw) return 'failed';
  drop(LEGACY_KEY, st);
  return 'moved';
}

export function serialize(state){ return JSON.stringify(state); }
/* What a save must carry to be playable, and what it may simply be missing.
 * Anything that gets read while drawing a frame has to be right before the
 * page starts drawing: a save that passes the door and then throws halfway
 * through a render leaves a black screen and no way back. */
export function restore(json){
  const s = typeof json === 'string' ? JSON.parse(json) : json;
  const bad = why => { throw new Error(`Not a save this game understands: ${why}.`); };
  if(!s || typeof s !== 'object') bad('it is not an object');
  if(s.version !== 6) bad(`it is version ${s.version}, and this sky is version 6`);
  if(!s.ship || typeof s.ship !== 'object') bad('it has no ship');
  if(!world.get(s.ship.body)) bad(`its ship is at "${s.ship.body}", which is nowhere`);
  for(const k of ['r', 'v']){
    const vec = s.ship[k];
    if(!Array.isArray(vec) || vec.length !== 2 || !vec.every(Number.isFinite)) bad(`the ship's ${k === 'r' ? 'position' : 'velocity'} is not a pair of numbers`);
  }
  for(const k of ['t', 'money', 'dv', 'tank']){
    if(!Number.isFinite(s[k])) bad(`${k} is ${s[k]}`);
  }
  /* Tied up somewhere real. A weightless harbour is not in the price list — a
     wreck has no stall and neither does the station at the Dancer — so the sky
     is the authority on those. Without this, a save made alongside a derelict
     was refused on load: you could tie up to one and never come back to it. */
  if(s.dockedAt != null && !PORTS[s.dockedAt] && !isHulk(s.dockedAt)){
    bad(`it is docked at "${s.dockedAt}", which is nowhere a ship can tie up`);
  }
  if(!Array.isArray(s.nodes) || s.nodes.some(n => !n || !Number.isFinite(n.t)
    || (n.prograde != null && !Number.isFinite(n.prograde))
    || (n.radial != null && !Number.isFinite(n.radial)))) bad('its plan is not a list of marks');
  if(!Array.isArray(s.cargo) || s.cargo.some(c => !c || !goodById(c.good) || !Number.isFinite(c.qty))) bad('its hold holds something unknown');
  if(!s.tiers || ['tank', 'hold'].some(k => !tiers(k)[s.tiers[k]])) bad('it is fitted with something this game does not have');
  // Everything below is either filled in or safely absent.
  s.keys ??= {}; s.relics ??= {}; s.markets ??= {}; s.log ??= [];
  s.rep = { emberkin: 0, otter: 0, cat: 0, frog: 0, ...(s.rep ?? {}) };
  s.pending ??= null; s.flags ??= {}; s.stats ??= {}; s.visited ??= [s.dockedAt].filter(Boolean);
  s.toll ??= { lastT: -1e9, inBelt: false };
  s.quests ??= QUESTS.map(q => ({ id: q.id, step: 0, done: false }));
  s.debt ??= 0; s.hull ??= 0; s.faults ??= {}; s.farSight ??= true;
  /* A save from before rewards were collected by hand has already been paid
     for everything finished in it, so a finished job there is a collected
     one. Marking them unclaimed would hand out every purse a second time. */
  for(const l of s.quests ?? []) if(l.done) l.claimed ??= true; s.target ??= null; s.justLeft ??= null; s.justLeftAt ??= -1e9;
  /* A save written before anybody could call for help knows where it is tied
     up but not where it was last tied up. Those are the same thing at a
     mooring, and the first port is a fair guess in flight. */
  if(!PORTS[s.lastPort]) s.lastPort = PORTS[s.dockedAt] ? s.dockedAt : (s.visited?.find(id => PORTS[id]) ?? CONST.START_PORT);
  s.marketEpoch ??= 0; s.lastMarket ??= null;
  s.crew = { engineer: null, navigator: null, appraiser: null, ...(s.crew ?? {}) };
  s.warp = Number.isFinite(s.warp) ? Math.max(1, Math.min(CONST.MAX_WARP, s.warp)) : 1;
  s.rng = Number.isFinite(s.rng) ? s.rng : 1;
  s.shipName ??= TEXT.shipNames[0];
  if(s.target && !world.get(s.target)) s.target = null;
  return s;
}

/* Everything a target readout wants: the approach, the slow-road comparison. */
/* How close counts as having got there. A port says so itself — that is what
 * its harbour mouth is. A world with no port on it, like Grumm, is reached by
 * coming properly inside its reach rather than by grazing the edge of it: the
 * whole sphere of influence is not an arrival, it is a doorway. */
export function mouthOf(id){
  const b = world.get(id);
  if(!b) return 0;
  if(b.zoneRadius) return b.zoneRadius;
  if(b.soi) return b.soi * 0.1;
  return Math.max(b.radius * 3, 1e-6);
}

export { elementsFromState, propagate, absState, railState, predict, norm, sub, add, scale, unit, perp, dist, hohmann };
export { wantsGood, lovesGood, REGION_OF, FORMULAS };
