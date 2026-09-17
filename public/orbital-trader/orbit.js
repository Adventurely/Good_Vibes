/* Orbital Trader: the patched-conic kernel.
 *
 * Everything that moves in the game moves through this file, and nothing in
 * here knows about money, cargo, or people. It is pure functions over plain
 * numbers so that the same code runs in the browser, in the tests, and in
 * any tool that wants to ask "where will the ship be?".
 *
 * Units, everywhere: distance in au (Tassel's orbital radius), time in days
 * (Tassel's year is 360 of them), so mu is in au^3/day^2 and speed in au/day.
 * Vectors are two-element arrays. Angles are radians, anticlockwise.
 *
 * The model is the one the design document fixes: bodies on rails (a Kepler
 * ellipse in the parent's frame, position as a function of time), and a ship
 * that feels exactly one body at a time. Inside a sphere of influence the ship
 * follows a single conic, so we never integrate anything: `propagate` jumps
 * straight to any time with the universal-variable form of Kepler's equation,
 * which is why time warp at 2500x costs the same as time warp at 1x and the
 * predicted path is the path you actually fly.
 *
 * The one place a search happens is finding *when* the conic leaves one sphere
 * of influence or enters another. Most of the time there is nothing to find,
 * and that is decided before anything is searched: a conic's low and high
 * points say at once whether it can reach the ground, the edge of the reach,
 * or the band a moon's rail sweeps, and leaving the reach or hitting the
 * ground are crossings of a fixed distance, solved with one arccosine. Only a
 * moon needs a search, because only a moon moves. That search is conservative
 * advancement: each step is bounded by (distance to the nearest boundary) /
 * (fastest either side can close it), which is a rigorous lower bound on the
 * crossing time, so a boundary can never be skipped, and the crossing itself
 * is then bisected to a millionth of a day. On a closed orbit whole laps in
 * which no moon can come within reach are skipped at once. No fixed timestep,
 * no tunnelling through a small moon.
 *
 * The road is made of legs (`predictLegs`): one conic in one frame, ending at
 * a burn, a change of reach, the ground, or the proof that nothing ends it.
 * The chart draws legs and the flight flies them, so the two are one thing.
 */

export const TAU = Math.PI * 2;

/* ------------------------------------------------------------- vectors */

export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const scale = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
/* z-component of the 3D cross product; its sign is the sense of rotation. */
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const norm = a => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function unit(a){
  const n = norm(a);
  return n > 0 ? [a[0] / n, a[1] / n] : [1, 0];
}
/* Anticlockwise perpendicular. */
export const perp = a => [-a[1], a[0]];

/* -------------------------------------------------- Kepler, for the rails */

/* Solve Kepler's equation M = E - e sin E for the eccentric anomaly.
 * Newton from a starting guess that is good on both ends of the eccentricity
 * range; a long cometary ellipse at e = 0.94 is the case that punishes a lazy start. */
export function solveKepler(M, e){
  M = ((M % TAU) + TAU) % TAU;
  /* A circle has nothing to solve: E is M. Most of the rails in this sky are
     circles, and this is the most-called function in the kernel, so the two
     Newton steps and four transcendentals it took to learn that were the
     single largest cost of asking where anything is. */
  if(e === 0) return M;
  let E = e < 0.8 ? M : Math.PI;
  for(let i = 0; i < 50; i++){
    const f = E - e * Math.sin(E) - M;
    const d = 1 - e * Math.cos(E);
    const step = f / d;
    E -= step;
    if(Math.abs(step) < 1e-13) break;
  }
  return E;
}

/* Mean motion: radians per day. */
export const meanMotion = (mu, a) => Math.sqrt(mu / (a * a * a));
export const period = (mu, a) => TAU / meanMotion(mu, a);

/* Position and velocity of a body on its rails, in its parent's frame.
 *
 * `el` is { a, e, omega, M0, retrograde }. A retrograde orbit is the prograde
 * one reflected across the x axis: same shape, opposite sense, and it needs no
 * special handling anywhere downstream, which is the design document's promise
 * about a retrograde moon kept in one line.
 */
export function railState(el, mu, t){
  const { a, e = 0, omega = 0, M0 = 0, retrograde = false } = el;
  /* The parts of a rail that never change, worked out once per body: the
     shape factor and the orientation. `railConst` stashes them on the element
     the first time it sees it, so a body from makeWorld and a bare literal in
     a test are both served. */
  const c = el._rail ?? railConst(el);
  const n = c.mu === mu ? c.n : meanMotion(mu, a);
  const E = solveKepler(M0 + n * t, e);
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const r = a * (1 - e * cosE);
  const b = a * c.sq;
  // Perifocal frame: periapsis on +x.
  const xp = a * (cosE - e), yp = b * sinE;
  const k = Math.sqrt(mu * a) / r;
  const vxp = -k * sinE, vyp = k * c.sq * cosE;
  const co = c.co, so = c.so;
  let x = co * xp - so * yp, y = so * xp + co * yp;
  let vx = co * vxp - so * vyp, vy = so * vxp + co * vyp;
  if(retrograde){ y = -y; vy = -vy; }
  return { r: [x, y], v: [vx, vy] };
}

/* Per-rail constants. `n` is left out here because mean motion needs the
 * parent's mu, which makeWorld knows and a bare element does not; it fills
 * it in when it builds the world. */
function railConst(el){
  const e = el.e ?? 0, omega = el.omega ?? 0;
  const c = { sq: Math.sqrt(1 - e * e), co: Math.cos(omega), so: Math.sin(omega), n: null, mu: null };
  try{ Object.defineProperty(el, '_rail', { value: c, enumerable: false, writable: true }); }catch{ /* frozen: recompute each call */ }
  return c;
}

/* The fastest a body on these rails ever moves: its speed at periapsis. Used
 * as a bound when searching for encounters. */
export function railMaxSpeed(el, mu){
  const { a, e = 0 } = el;
  return Math.sqrt(mu * (1 + e) / (a * (1 - e)));
}

/* -------------------------------------------- the ship's conic, described */

/* Classical elements from a state vector, for the readouts and the bounds.
 * Works for any conic. `rp` is the periapsis distance; `ra` is Infinity on an
 * escape trajectory; `dir` is +1 anticlockwise, -1 clockwise. */
export function elementsFromState(mu, r, v, floor = 0){
  const rn = norm(r), vn = norm(v);
  const h = cross(r, v);
  const energy = vn * vn / 2 - mu / rn;
  const a = Math.abs(energy) < 1e-15 ? Infinity : -mu / (2 * energy);
  // Eccentricity vector: points at periapsis.
  const rv = dot(r, v);
  const ex = ((vn * vn - mu / rn) * r[0] - rv * v[0]) / mu;
  const ey = ((vn * vn - mu / rn) * r[1] - rv * v[1]) / mu;
  const e = Math.hypot(ex, ey);
  const p = h * h / mu;
  /* Whether an orbit comes back is decided by its energy, not by its
     eccentricity. A ship dropped straight down has e exactly 1 and looks
     parabolic by that test, but it is plainly bound: it will fall, and were
     there no ground it would come straight back up. Reading it as a parabola
     made its far point and its period Infinity for an orbit that has both. */
  const bound = Number.isFinite(a) && a > 0;
  /* Periapsis is p / (1 + e) on every conic there is. On a bound orbit that
     is a(1 - e) exactly, which is how it is written here; on an open one it
     is not p / 2 — that is the parabolic case only, and using it for a
     hyperbola put the low point of every flyby several times too far out.
     Which mattered twice: the chart labelled the closest approach with a
     number that was not it, and `vmax` below is built on rp, so the boundary
     search was handed a speed ceiling that was too low on exactly the legs
     that move fastest. */
  const rp = bound ? a * (1 - e) : p / (1 + e);
  const ra = bound ? a * (1 + e) : Infinity;
  const omega = Math.atan2(ey, ex);
  // True anomaly, signed by the sense of rotation so it increases with time.
  let nu = Math.atan2(r[1], r[0]) - omega;
  if(h < 0) nu = -nu;
  nu = ((nu % TAU) + TAU) % TAU;
  const T = bound ? period(mu, a) : Infinity;
  /* The fastest the ship can be going anywhere on this conic, which is what
     every step bound downstream is built on, so it must never come back
     smaller than the truth. At periapsis on a normal conic; on a radial fall
     periapsis is the middle of the world, where the speed is unbounded, so the
     honest ceiling is the speed it would have at the ground — and a caller
     that cares (the boundary search) hands in that floor. */
  const rMin = Math.max(rp, floor);
  const vmax = rMin > 0
    ? Math.sqrt(Math.max(0, vn * vn + 2 * mu * (1 / rMin - 1 / rn)))
    : Infinity;
  return { a, e, rp, ra, omega, nu, period: T, energy, h, dir: h >= 0 ? 1 : -1, vmax, p, bound };
}

/* Where a conic is at a given true anomaly, in the frame the elements are in.
 * `nu` is measured the way elementsFromState reports it — increasing with
 * time whichever way round the ship is going — so a retrograde orbit is read
 * back the same way it was written. */
export function conicPointAt(el, nu){
  const r = el.p / (1 + el.e * Math.cos(nu));
  const th = el.omega + (el.dir >= 0 ? nu : -nu);
  return [r * Math.cos(th), r * Math.sin(th)];
}

/* Time from now until the ship next reaches periapsis (or apoapsis), on an
 * elliptical orbit. Null on an escape trajectory when the point is behind us. */
export function timeToAnomaly(mu, r, v, targetNu){
  const el = elementsFromState(mu, r, v);
  const { e, a, nu } = el;
  if(e >= 1){
    // Hyperbolic: only meaningful if the target is still ahead.
    const H = nuToH(nu, e), Ht = nuToH(targetNu, e);
    if(!Number.isFinite(H) || !Number.isFinite(Ht)) return null;
    const n = Math.sqrt(mu / Math.pow(-a, 3));
    const M = e * Math.sinh(H) - H, Mt = e * Math.sinh(Ht) - Ht;
    const dt = (Mt - M) / n;
    return dt >= 0 ? dt : null;
  }
  const E = nuToE(nu, e), Et = nuToE(targetNu, e);
  const M = E - e * Math.sin(E), Mt = Et - e * Math.sin(Et);
  const n = meanMotion(mu, a);
  let dt = (Mt - M) / n;
  if(dt < 0) dt += el.period;
  return dt;
}

function nuToE(nu, e){
  return Math.atan2(Math.sqrt(1 - e * e) * Math.sin(nu), e + Math.cos(nu));
}
function nuToH(nu, e){
  const c = (e + Math.cos(nu)) / (1 + e * Math.cos(nu));
  if(c < 1) return NaN; // past the asymptote: never reached
  const H = Math.acosh(c);
  return Math.sin(nu) < 0 ? -H : H;
}

/* ----------------------------------------- the ship's conic, propagated */

/* Stumpff functions, with series near zero where the closed forms lose digits. */
function stumpff(psi){
  if(psi > 1e-6){
    const s = Math.sqrt(psi);
    return [(1 - Math.cos(s)) / psi, (s - Math.sin(s)) / (s * psi)];
  }
  if(psi < -1e-6){
    const s = Math.sqrt(-psi);
    return [(1 - Math.cosh(s)) / psi, (Math.sinh(s) - s) / (s * -psi)];
  }
  return [
    1 / 2 - psi / 24 + psi * psi / 720,
    1 / 6 - psi / 120 + psi * psi / 5040,
  ];
}

/* Advance a state by dt under a single point mass. Universal variables, so
 * one routine covers ellipse, parabola and hyperbola without branching on the
 * shape, and dt may be positive or negative.
 *
 * On an ellipse dt is first reduced modulo the period: the position is the
 * same, and Newton converges from a good guess in a handful of steps instead
 * of wandering when asked to jump four hundred orbits at once.
 */
export function propagate(mu, r0, v0, dt){
  if(dt === 0) return { r: [r0[0], r0[1]], v: [v0[0], v0[1]] };
  const r0n = norm(r0), v0n = norm(v0);
  const rv = dot(r0, v0);
  const sqmu = Math.sqrt(mu);
  const alpha = 2 / r0n - v0n * v0n / mu;   // 1/a

  if(alpha > 1e-12){
    const T = TAU / Math.sqrt(mu * alpha * alpha * alpha);
    if(Number.isFinite(T) && T > 0){
      dt = dt % T;
      if(dt === 0) return { r: [r0[0], r0[1]], v: [v0[0], v0[1]] };
    }
  }

  // Starting guess for the universal anomaly (Vallado's, by shape).
  let chi;
  if(alpha > 1e-12){
    chi = sqmu * dt * alpha;
  }else if(alpha < -1e-12){
    const a = 1 / alpha;
    const sgn = Math.sign(dt);
    const arg = -2 * mu * alpha * dt / (rv + sgn * Math.sqrt(-mu * a) * (1 - r0n * alpha));
    chi = arg > 0 ? sgn * Math.sqrt(-a) * Math.log(arg) : sqmu * dt / r0n;
  }else{
    chi = sqmu * dt / r0n;
  }

  // Time of flight as a function of chi, monotonic increasing in chi, and
  // the distance term that is also its derivative.
  const tof = chi => {
    const psi = chi * chi * alpha;
    const [c2, c3] = stumpff(psi);
    const rr = chi * chi * c2 + (rv / sqmu) * chi * (1 - psi * c3) + r0n * (1 - psi * c2);
    const t = (chi * chi * chi * c3 + (rv / sqmu) * chi * chi * c2 + r0n * chi * (1 - psi * c3)) / sqmu;
    return { t, rr, c2, c3, psi };
  };

  let done = false;
  let out = tof(chi);
  for(let i = 0; i < 60; i++){
    const step = (dt - out.t) / (out.rr / sqmu);
    chi += step;
    out = tof(chi);
    if(Math.abs(step) < 1e-12 * Math.max(1, Math.abs(chi))){ done = true; break; }
  }
  if(!done || !Number.isFinite(chi)){
    // Newton lost its footing; bracket the monotonic function and bisect. Slow
    // and certain, and it is only reached on pathological inputs.
    let lo = 0, hi = Math.sign(dt) || 1;
    while(Math.sign(tof(hi).t - dt) === Math.sign(dt) ? false : true){
      hi *= 2;
      if(Math.abs(hi) > 1e9) break;
    }
    if(hi < lo){ const s = lo; lo = hi; hi = s; }
    for(let i = 0; i < 200; i++){
      const mid = (lo + hi) / 2;
      if(tof(mid).t < dt) lo = mid; else hi = mid;
    }
    chi = (lo + hi) / 2;
    out = tof(chi);
  }

  const { c2, c3, psi } = out;
  const f = 1 - (chi * chi / r0n) * c2;
  const g = dt - (chi * chi * chi / sqmu) * c3;
  const r = [f * r0[0] + g * v0[0], f * r0[1] + g * v0[1]];
  const rn = norm(r);
  const gdot = 1 - (chi * chi / rn) * c2;
  const fdot = (sqmu / (rn * r0n)) * chi * (psi * c3 - 1);
  const v = [fdot * r0[0] + gdot * v0[0], fdot * r0[1] + gdot * v0[1]];
  return { r, v };
}

/* Lambert's problem: the conic that leaves r1 and arrives at r2 in exactly
 * `tof` days under one point mass. It is the question "when should I burn, and
 * how hard, to be where that moon will be" asked directly, instead of guessed
 * at by pulling a handle and watching.
 *
 * Universal variables again, so one routine covers every shape of transfer.
 * `ccw` says which way round to go; passing the ship's own sense of rotation
 * keeps the transfer prograde, which is what makes it cheap. Returns the
 * velocities at both ends, or null when no single-revolution conic fits.
 */
export function lambert(mu, r1, r2, tof, ccw = true){
  if(!(tof > 0)) return null;
  const n1 = norm(r1), n2 = norm(r2);
  if(n1 === 0 || n2 === 0) return null;
  let cosdnu = Math.max(-1, Math.min(1, dot(r1, r2) / (n1 * n2)));
  /* Half a turn exactly has no single answer — every plane through the two
     points is a solution, and in two dimensions the arithmetic falls apart.
     That is also, awkwardly, the cheapest transfer there is, so the answer is
     not to refuse everything near it but to refuse only what genuinely will
     not fly: the guard below is for the true singularity, and the solution is
     checked against the propagator before it is handed back. */
  const sinTurn = Math.abs(cross(r1, r2)) / (n1 * n2);
  if(sinTurn < 1e-8 && cosdnu < 0) return null;
  // Short way or long way round, decided by which side of r1 the target lies
  // and which way the ship is going.
  const turn = cross(r1, r2);
  const shortWay = ccw ? turn >= 0 : turn <= 0;
  const A = (shortWay ? 1 : -1) * Math.sqrt(Math.max(0, n1 * n2 * (1 + cosdnu)));
  if(A === 0) return null;

  let psiLow = -4 * Math.PI * Math.PI, psiHigh = 4 * Math.PI * Math.PI;
  let psi = 0;
  const sqmu = Math.sqrt(mu);
  let y = 0, chi = 0;
  let solved = false;
  for(let i = 0; i < 200; i++){
    const [c2, c3] = stumpff(psi);
    y = n1 + n2 + A * (psi * c3 - 1) / Math.sqrt(c2);
    if(A > 0 && y < 0){
      // The chord is too short for this psi; push it up until y comes positive.
      let guard = 0;
      while(y < 0 && guard++ < 200){
        psi += 0.1;
        const [d2, d3] = stumpff(psi);
        y = n1 + n2 + A * (psi * d3 - 1) / Math.sqrt(d2);
      }
      if(y < 0) return null;
      psiLow = psi;
      continue;
    }
    // The guard above always goes round again when it moves psi, so c2 and
    // c3 are still for this psi here.
    chi = Math.sqrt(y / c2);
    const t = (chi * chi * chi * c3 + A * Math.sqrt(y)) / sqmu;
    if(Math.abs(t - tof) < 1e-9 * Math.max(1, tof)){ solved = true; break; }
    if(t <= tof) psiLow = psi; else psiHigh = psi;
    psi = (psiLow + psiHigh) / 2;
  }
  if(!solved || !Number.isFinite(y) || y < 0) return null;
  const f = 1 - y / n1;
  const g = A * Math.sqrt(y / mu);
  const gdot = 1 - y / n2;
  if(!Number.isFinite(g) || g === 0) return null;
  const v1 = [(r2[0] - f * r1[0]) / g, (r2[1] - f * r1[1]) / g];
  const v2 = [(gdot * r2[0] - r1[0]) / g, (gdot * r2[1] - r1[1]) / g];
  if(!v1.every(Number.isFinite) || !v2.every(Number.isFinite)) return null;
  /* Fly it before promising it. Near the half-turn the arithmetic still
     produces a pair of velocities long after they have stopped meaning
     anything, and a caller has no way to tell. One propagation settles it. */
  const landed = propagate(mu, r1, v1, tof);
  if(dist(landed.r, r2) > Math.max(n2, n1) * 1e-5) return null;
  return { v1, v2 };
}

/* State on a circular orbit at `radius`, at polar angle `theta`, moving
 * anticlockwise unless told otherwise. This is what undocking produces. */
export function circularState(mu, radius, theta, retrograde = false){
  const r = [radius * Math.cos(theta), radius * Math.sin(theta)];
  const speed = Math.sqrt(mu / radius) * (retrograde ? -1 : 1);
  return { r, v: scale(perp(unit(r)), speed) };
}

/* Vis-viva: speed on an orbit of semi-major axis a at distance r. */
export const visViva = (mu, r, a) => Math.sqrt(Math.max(0, mu * (2 / r - 1 / a)));

/* Both burns of a Hohmann transfer between circular orbits, and its duration.
 * Not used by the flight model, which only knows impulses at nodes; used by
 * the readouts to say how well a plan compares with the slow road. */
export function hohmann(mu, r1, r2){
  const at = (r1 + r2) / 2;
  const v1 = Math.sqrt(mu / r1), v2 = Math.sqrt(mu / r2);
  const dv1 = Math.abs(visViva(mu, r1, at) - v1);
  const dv2 = Math.abs(v2 - visViva(mu, r2, at));
  return { dv1, dv2, total: dv1 + dv2, time: period(mu, at) / 2 };
}

/* --------------------------------------------------------------- world */

/* A world is a list of bodies indexed for the questions the kernel asks:
 * who is my parent, who are my children, and how fast can each go.
 *
 * A body: { id, parent, a, e, omega, M0, retrograde, mu, soi, radius, ... }.
 * The star has parent null and soi null (it holds everything). A body with
 * mu 0 and soi null is a rendezvous zone: it moves on rails but has no
 * gravity, which is how the belt havens and the Maw are represented.
 */
export function makeWorld(bodies){
  const byId = new Map();
  for(const b of bodies) byId.set(b.id, b);
  const children = new Map();
  for(const b of bodies){
    if(!children.has(b.id)) children.set(b.id, []);
    if(b.parent != null){
      if(!children.has(b.parent)) children.set(b.parent, []);
      children.get(b.parent).push(b);
    }
  }
  const vmax = new Map();
  for(const b of bodies){
    if(b.parent == null){ vmax.set(b.id, 0); continue; }
    const mu = byId.get(b.parent).mu;
    vmax.set(b.id, railMaxSpeed(b, mu));
    // Rail constants, mean motion included, so railState never takes a root
    // it could have been handed.
    const c = b._rail ?? railConst(b);
    c.n = meanMotion(mu, b.a); c.mu = mu;
  }
  const root = bodies.find(b => b.parent == null);
  return {
    bodies, byId, root,
    get: id => byId.get(id),
    children: id => children.get(id) ?? [],
    /* Children that have gravity — the ones a ship can fall into. */
    wells: id => (children.get(id) ?? []).filter(c => c.mu > 0 && c.soi != null),
    vmax: id => vmax.get(id) ?? 0,
  };
}

/* Local state (parent frame) of a body at time t. The root sits still. */
export function localState(world, id, t){
  const b = world.get(id);
  if(b.parent == null) return { r: [0, 0], v: [0, 0] };
  return railState(b, world.get(b.parent).mu, t);
}

/* Absolute state of a body: its own rails on top of its parent's. */
export function absState(world, id, t){
  let b = world.get(id);
  let r = [0, 0], v = [0, 0];
  while(b && b.parent != null){
    const s = railState(b, world.get(b.parent).mu, t);
    r = add(r, s.r); v = add(v, s.v);
    b = world.get(b.parent);
  }
  return { r, v };
}

/* Absolute position of a ship { body, r } at the time its frame was taken. */
export function shipAbs(world, ship, t){
  const p = absState(world, ship.body, t);
  return { r: add(p.r, ship.r), v: add(p.v, ship.v) };
}

/* ------------------------------------------------ patched-conic stepping */

const T_TOL = 1e-6;     // days; a twentieth of a second of game time
const H_MIN = 5e-4;     // days; the smallest step the search will take

/* What ends a coast inside one sphere of influence. `boundaries` reports the
 * signed clearance of each: positive means "not yet".
 *
 *   exit    the ship passes the parent's SOI radius (never for the root)
 *   enter   the ship passes inside a child's SOI
 *   surface the ship reaches the parent's crash radius (or its atmosphere
 *           top when `atmo` is set and the caller asks for it)
 */
function boundaries(world, body, r, v, t, opts){
  const list = [];
  const rn = norm(r);
  if(body.soi != null) list.push({ kind: 'exit', gap: body.soi - rn, closing: 0 });
  const floor = opts?.atmosphere && body.atmo ? body.atmo : body.radius;
  if(floor) list.push({ kind: 'surface', gap: rn - floor, closing: 0 });
  for(const c of world.wells(body.id)){
    const cp = railState(c, body.mu, t).r;
    list.push({ kind: 'enter', into: c, gap: dist(r, cp) - c.soi, closing: world.vmax(c.id) });
  }
  return list;
}

/* One boundary's clearance on its own, for the searches that have already
 * decided which one they are closing in on. */
function boundaryGap(world, body, b, r, t, floor){
  const rn = norm(r);
  if(b.kind === 'exit') return body.soi - rn;
  if(b.kind === 'surface') return rn - floor;
  return dist(r, railState(b.into, body.mu, t).r) - b.into.soi;
}

/* The distances a rail sweeps: the nearest and farthest a moon ever is from
 * the world it goes round. A circle is one number twice. */
function railBand(c){
  const e = c.e ?? 0;
  return [c.a * (1 - e), c.a * (1 + e)];
}

/* The true anomaly, in [0, π], at which a conic is at distance `rad`: the
 * outbound crossing, whose mirror is the inbound one. Null when the conic
 * never gets there, or is a straight fall with no anomaly worth the name. */
function anomalyAtRadius(el, rad){
  if(!(el.e > 1e-12) || !(el.p > 0)) return null;
  const c = (el.p / rad - 1) / el.e;
  if(c < -1 || c > 1) return null;
  return Math.acos(c);
}

/* When a conic next passes distance `rad`, going out or coming in, solved
 * rather than searched: the anomaly of the crossing is one arccosine and the
 * time to reach it is Kepler's equation. Returned as a bracket [lo, hi] a hair
 * either side of the answer, checked against the real clearance at both ends,
 * so that the bisection that follows lands exactly where the stepping search
 * would have. Null whenever the check fails, and the caller steps instead —
 * slower, and never wrong.
 *
 * One trap is guarded against by name. A ship a rounding error past a
 * crossing reads as having just missed it, and the solve then hands back the
 * *next* pass, a whole lap on. If the clearance is already gone a small step
 * ahead, the crossing is now, whatever the anomaly says. */
function crossingTime(mu, el, r0, v0, rad, outward, gapAt){
  const nu = anomalyAtRadius(el, rad);
  if(nu == null) return null;
  const dt = timeToAnomaly(mu, r0, v0, outward ? nu : TAU - nu);
  if(dt == null || !Number.isFinite(dt)) return null;
  const scale = Number.isFinite(el.period) ? el.period : Math.max(1, dt);
  const d = Math.max(4 * T_TOL, scale * 1e-7);
  const lo = Math.max(0, dt - d), hi = dt + d;
  if(!(gapAt(lo) > 0) || !(gapAt(hi) <= 0)) return null;
  if(lo > H_MIN && !(gapAt(H_MIN) > 0)) return null;
  return { lo, hi };
}

/* Anticlockwise distance round the circle from one angle to another. */
const ccwFrom = (from, to) => (((to - from) % TAU) + TAU) % TAU;

/* The smallest angle between any point of one arc and any point of another,
 * each given as a start and a signed sweep. Zero when they overlap or when
 * either is a whole turn. */
function arcGap(a0, la, b0, lb){
  const fix = (s, l) => l >= 0 ? [ccwFrom(0, s), l] : [ccwFrom(0, s + l), -l];
  const [as, al] = fix(a0, la), [bs, bl] = fix(b0, lb);
  if(al >= TAU || bl >= TAU) return 0;
  if(ccwFrom(as, bs) <= al || ccwFrom(bs, as) <= bl) return 0;
  return Math.min(ccwFrom(as + al, bs), ccwFrom(bs + bl, as));
}

/* Whether a whole lap of a closed orbit can be skipped: true only when it is
 * certain that no moon in `moons` comes within reach of the ship during the
 * lap that starts now at (r, v). The ship's own orbit repeats exactly, so the
 * question is entirely about where the moons will be.
 *
 * The test is geometric and conservative. The ship can only be within a
 * moon's reach while its distance from the world is inside the moon's band,
 * widened by that reach; that happens on at most two arcs of the orbit, at
 * times that are known. Over each of those arcs the ship sweeps a known range
 * of angle and the moon sweeps at most its fastest rate times the duration.
 * If the two ranges stay further apart than the angle a reach subtends at
 * that distance, no meeting was possible. Anything less certain than that
 * returns false and the careful search does its job. */
function lapClear(world, body, el, r, v, tLap, moons){
  const P = el.period, mu = body.mu;
  for(const c of moons){
    const [cmin, cmax] = railBand(c);
    const lo = Math.max(el.rp, cmin - c.soi), hi = Math.min(el.ra, cmax + c.soi);
    if(lo > hi) continue;
    if(!(lo > c.soi) || !(cmin > c.soi)) return false;
    /* Two points at radii ≥ lo and ≥ cmin, an angle Δ apart, are at least
       2·sqrt(lo·cmin)·sin(Δ/2) from one another. */
    const dStar = 2 * Math.asin(Math.min(1, c.soi / (2 * Math.sqrt(lo * cmin))));
    let arcs;
    if(!(el.e > 1e-12)){
      arcs = [[0, TAU]];
    }else{
      const cLo = Math.min(1, Math.max(-1, (el.p / lo - 1) / el.e));   // r ≥ lo  ⇔  cos ν ≤ cLo
      const cHi = Math.min(1, Math.max(-1, (el.p / hi - 1) / el.e));   // r ≤ hi  ⇔  cos ν ≥ cHi
      const nuA = Math.acos(cLo), nuB = Math.acos(cHi);
      const fromPe = nuA <= 1e-12, toAp = nuB >= Math.PI - 1e-12;
      if(fromPe && toAp) arcs = [[0, TAU]];
      else if(fromPe) arcs = [[TAU - nuB, TAU + nuB]];
      else if(toAp) arcs = [[nuA, TAU - nuA]];
      else arcs = [[nuA, nuB], [TAU - nuB, TAU - nuA]];
    }
    const ce = c.e ?? 0;
    const moonRate = Math.sqrt(mu * c.a * (1 - ce * ce)) / (c.a * (1 - ce)) ** 2;   // h / rp², its fastest
    const moonDir = c.retrograde ? -1 : 1;
    for(const [nuA, nuB] of arcs){
      if(nuB - nuA >= TAU - 1e-9) return false;
      const tA = timeToAnomaly(mu, r, v, ccwFrom(0, nuA));
      if(tA == null) return false;
      const dur = arcDuration(el, nuA, nuB);
      /* The arc happens once a lap; the copy that began before this lap did
         may still be running when the lap starts. */
      for(const start of [tA, tA - P]){
        const w0 = Math.max(0, start), w1 = Math.min(P, start + dur);
        if(w1 - w0 <= 0) continue;
        if(w1 - w0 >= P - 1e-9) return false;
        const s0 = propagate(mu, r, v, w0), s1 = propagate(mu, r, v, w1);
        const th0 = Math.atan2(s0.r[1], s0.r[0]);
        const sweep = ccwFrom(0, elementsFromState(mu, s1.r, s1.v).nu - elementsFromState(mu, s0.r, s0.v).nu);
        const m0 = railState(c, mu, tLap + w0).r;
        const ph0 = Math.atan2(m0[1], m0[0]);
        const mSweep = (w1 - w0) * moonRate;
        if(mSweep >= TAU) return false;
        if(arcGap(th0, el.dir * sweep, ph0, moonDir * mSweep) < dStar) return false;
      }
    }
  }
  return true;
}

/* Time along a closed orbit from one true anomaly to a later one. */
function arcDuration(el, nuA, nuB){
  const M = nu => { const E = nuToE(nu, el.e); return E - el.e * Math.sin(E); };
  return ccwFrom(M(nuA), M(nuB)) / (TAU / el.period);
}

/* Find the first boundary crossing within `span` days of `t`, or null.
 *
 * Three things happen before any stepping, all of them exact:
 *
 *   1. Boundaries the conic cannot reach are dropped. Its low and high points
 *      are known, so a floor below the low point, a reach above the high
 *      point, and a moon whose rail never comes within its own reach of the
 *      band the ship sweeps are all ruled out in one comparison each. A
 *      parking orbit answers "nothing, ever" here and the search never runs.
 *   2. Exit and surface, being crossings of a fixed distance, are solved
 *      rather than searched (crossingTime). Only a moon needs a search,
 *      because only a moon moves.
 *   3. On a closed orbit the ship's state repeats every lap, so a lap in
 *      which no moon can come within reach is skipped whole (lapClear).
 *
 * What is left is the search as it always was — conservative advancement: at
 * each sample the clearance to every boundary divided by the fastest possible
 * closing speed bounds how soon it can be reached, and the step is the
 * smallest such bound (never below H_MIN, or the search would creep). Because
 * the bound is rigorous a boundary is never jumped over, so when a sample
 * lands past one, the crossing is bracketed by the last two samples and
 * bisected. `opts.exhaustive` turns the three shortcuts off, for checking
 * them against it.
 */
/* Everything nextEvent decides before it steps: the conic, its speed ceiling,
 * every boundary sorted into dropped / solved / to-be-watched, and whether
 * whole laps may be skipped. Shared with coastStable, which wants only the
 * verdict. */
function classify(world, body, r0, v0, t0, opts){
  /* The fastest the ship can possibly be going during this step. It is the
     only thing keeping the search honest: the bound below divides a clearance
     by a closing speed, and if that speed can be exceeded the search can step
     straight over a boundary. Measured from the lowest point the ship could
     reach without hitting something — a radial fall has no periapsis, only a
     surface. */
  const floor = Math.max(body.radius ?? 0, (opts?.atmosphere && body.atmo) ? body.atmo : 0);
  const el = elementsFromState(body.mu, r0, v0, floor);
  const vship = Number.isFinite(el.vmax) ? el.vmax : Math.sqrt(Math.max(0, norm(v0) ** 2 + 2 * body.mu / Math.max(floor, 1e-9)));
  const mu = body.mu;
  const all = boundaries(world, body, r0, v0, t0, opts);
  // Something can start already inside a boundary (a graze that the tolerance
  // put a hair over). Report nothing for that one until it comes clear.
  const armed = all.map(b => b.gap > 0);
  const shortcuts = !opts?.exhaustive;
  const bound = el.bound;
  const rp = el.rp, ra = bound ? el.ra : Infinity;
  const floorGap = opts?.atmosphere && body.atmo ? body.atmo : body.radius;

  /* Sort the boundaries: dropped, solved, or kept for the search. */
  const watch = [];          // indices into `all` the stepping search must watch
  let solved = null;         // the earliest solved crossing, { i, lo, hi }
  let lapsOk = shortcuts && bound && Number.isFinite(el.period) && el.period > 0;
  for(let i = 0; i < all.length; i++){
    const b = all[i];
    if(!shortcuts){ watch.push(i); continue; }
    if(!armed[i]){ watch.push(i); lapsOk = false; continue; }
    const gapAt = dt => boundaryGap(world, body, b, propagate(mu, r0, v0, dt).r, t0 + dt, floorGap);
    if(b.kind === 'exit'){
      if(bound && ra < body.soi) continue;
      const c = crossingTime(mu, el, r0, v0, body.soi, true, gapAt);
      if(c){ if(!solved || c.lo < solved.lo) solved = { i, ...c }; continue; }
      watch.push(i); lapsOk = false; continue;
    }
    if(b.kind === 'surface'){
      if(rp > floorGap) continue;
      const c = crossingTime(mu, el, r0, v0, floorGap, false, gapAt);
      if(c){ if(!solved || c.lo < solved.lo) solved = { i, ...c }; continue; }
      watch.push(i); lapsOk = false; continue;
    }
    const [cmin, cmax] = railBand(b.into);
    if(ra + b.into.soi < cmin || rp - b.into.soi > cmax) continue;
    watch.push(i);
  }
  const moons = lapsOk ? watch.map(i => all[i].into) : null;
  return { el, vship, all, armed, watch, solved, lapsOk, moons, floorGap };
}

/* Whether a coast from this state goes on for ever: a closed orbit that can
 * reach no boundary at all. This is what makes a parking orbit a single leg
 * rather than an endless search, and it is exact — the same tests the search
 * itself trusts, with nothing left over for it to do. */
export function coastStable(world, body, r0, v0, t0, opts){
  const c = classify(world, body, r0, v0, t0, opts);
  return c.el.bound && !c.watch.length && !c.solved;
}

export function nextEvent(world, body, r0, v0, t0, span, opts){
  const mu = body.mu;
  const { el, vship, all, armed, watch, solved, lapsOk, moons, floorGap } = classify(world, body, r0, v0, t0, opts);

  /* The search need not look past a crossing already solved. */
  let cap = span;
  if(solved && solved.lo < cap) cap = solved.lo;

  let t = 0;
  let r = r0, v = v0;
  let prev = all;
  let guard = 0;
  while(watch.length && t < cap && guard++ < 20000){
    if(lapsOk && cap - t >= el.period && lapClear(world, body, el, r, v, t0 + t, moons)){
      t += el.period;
      prev = boundaries(world, body, r, v, t0 + t, opts);
      continue;
    }
    let h = cap - t;
    for(const i of watch){
      if(!armed[i]) continue;
      const b = prev[i];
      const speed = vship + b.closing;
      const bnd = b.gap / speed;
      if(bnd < h) h = bnd;
    }
    h = Math.max(h, H_MIN);
    if(t + h > cap) h = cap - t;
    if(h <= 0) break;
    const next = propagate(mu, r, v, h);
    const tn = t + h;
    const now = boundaries(world, body, next.r, next.v, t0 + tn, opts);
    let hit = -1;
    for(const i of watch){
      if(armed[i] && now[i].gap <= 0){ hit = i; break; }
      if(!armed[i] && now[i].gap > 0) armed[i] = true;
    }
    if(hit >= 0){
      // Bisect between (t, r, v) outside and (tn) inside.
      let lo = 0, hi = h;
      for(let i = 0; i < 60 && hi - lo > T_TOL; i++){
        const mid = (lo + hi) / 2;
        const s = propagate(mu, r, v, mid);
        const g = boundaryGap(world, body, now[hit], s.r, t0 + t + mid, floorGap);
        if(g <= 0) hi = mid; else lo = mid;
      }
      // Land just on the far side, so the next frame agrees we have crossed.
      const s = propagate(mu, r, v, hi);
      const b = now[hit];
      return { kind: b.kind, into: b.into ?? null, dt: t + hi, r: s.r, v: s.v };
    }
    r = next.r; v = next.v; t = tn; prev = now;
  }
  /* Out of steps rather than out of span. Saying "nothing happens here" would
     be a lie, and the caller would coast serenely through whatever was coming;
     saying where the search got to lets it pick up from there. */
  if(watch.length && t < cap) return { kind: 'timeout', into: null, dt: t, r, v };
  if(solved && solved.hi <= span){
    const b = all[solved.i];
    let lo = solved.lo, hi = solved.hi;
    for(let i = 0; i < 60 && hi - lo > T_TOL; i++){
      const mid = (lo + hi) / 2;
      const g = boundaryGap(world, body, b, propagate(mu, r0, v0, mid).r, t0 + mid, floorGap);
      if(g <= 0) hi = mid; else lo = mid;
    }
    const s = propagate(mu, r0, v0, hi);
    return { kind: b.kind, into: null, dt: hi, r: s.r, v: s.v };
  }
  return null;
}

/* Move a ship { body, r, v } forward by dt from time t, crossing whatever
 * spheres of influence it crosses on the way. Returns the new ship, and the
 * list of things that happened, in order. A crash stops the clock at the
 * moment of impact: the caller decides what a crash means.
 *
 * `nodes` are maneuvers { t, prograde, radial } (au/day), sorted by time; a
 * node whose time falls inside this step fires exactly then, in the frame the
 * ship is in at that moment. Fired nodes are reported so the caller can spend
 * the fuel and drop them from the plan.
 *
 * `opts.stopOnSoi` and `opts.stopOnBurn` cut the step short at the first such
 * event, leaving the rest of dt unspent. The game loop wants this: at the top
 * time warp a single frame is four days, which is long enough to pass clean
 * through a moon's whole sphere of influence, and a player who was warping
 * towards that encounter would never be given the chance to act in it.
 */
export function advance(world, ship, t, dt, nodes = [], opts = {}){
  let body = world.get(ship.body);
  let r = ship.r, v = ship.v;
  let now = t;
  const end = t + dt;
  const events = [];
  let ni = 0;
  /* Marks whose moment has already arrived are behind us. The test has to
     include the moment itself: a step that stops exactly on a burn would
     otherwise find the same mark waiting for it on the next call, fire it
     again, and stop the clock dead on a burn it keeps paying for. */
  while(ni < nodes.length && nodes[ni].t <= now + T_TOL) ni++;
  let guard = 0;
  while(end - now > 0 && guard++ < 64){
    let span = end - now;
    let nodeNext = null;
    if(ni < nodes.length && nodes[ni].t <= end){
      nodeNext = nodes[ni];
      span = Math.max(0, nodeNext.t - now);
    }
    const ev = span > 0 ? nextEvent(world, body, r, v, now, span, opts) : null;
    if(ev && ev.kind === 'timeout'){
      // The search ran out of steps; take what it did cover and go round again.
      r = ev.r; v = ev.v; now += ev.dt;
      if(ev.dt <= 0) break;
      continue;
    }
    if(ev){
      now += ev.dt;
      if(ev.kind === 'surface'){
        events.push({ kind: 'crash', body: body.id, t: now, r: ev.r, v: ev.v });
        return { ship: { body: body.id, r: ev.r, v: ev.v }, t: now, events, crashed: true };
      }
      if(ev.kind === 'exit'){
        const parent = world.get(body.parent);
        const local = railState(body, parent.mu, now);
        const from = body.id;
        r = add(ev.r, local.r); v = add(ev.v, local.v);
        body = parent;
        events.push({ kind: 'soi', from, to: body.id, t: now });
        if(opts.stopOnSoi) return { ship: { body: body.id, r, v }, t: now, events, crashed: false };
      }else{
        const local = railState(ev.into, body.mu, now);
        const from = body.id;
        r = sub(ev.r, local.r); v = sub(ev.v, local.v);
        body = ev.into;
        events.push({ kind: 'soi', from, to: body.id, t: now });
        if(opts.stopOnSoi) return { ship: { body: body.id, r, v }, t: now, events, crashed: false };
      }
      continue;
    }
    // No boundary before the end of this span: coast to it.
    if(span > 0){
      const s = propagate(body.mu, r, v, span);
      r = s.r; v = s.v; now += span;
    }
    if(nodeNext && Math.abs(now - nodeNext.t) <= T_TOL + 1e-12){
      const burn = burnVector(r, v, nodeNext, opts.dvAvailable, burnFrame(r, v));
      v = add(v, burn.dv);
      events.push({ kind: 'burn', t: now, node: nodeNext, dv: burn.dv, magnitude: burn.magnitude, short: burn.short, body: body.id });
      if(opts.dvAvailable != null) opts.dvAvailable = Math.max(0, opts.dvAvailable - burn.magnitude);
      ni++;
      now = nodeNext.t; // exact, so equality tests downstream hold
      if(opts.stopOnBurn) return { ship: { body: body.id, r, v }, t: now, events, crashed: false };
    }
  }
  return { ship: { body: body.id, r, v }, t: now, events, crashed: false };
}

/* The frame a burn is written in: forward along the velocity, and out at right
 * angles to it — whichever side of the perpendicular points away from the
 * body, so "out" means out on a retrograde orbit as much as a prograde one.
 *
 * Out used to be true radial, along the position vector, which is at right
 * angles to forward on a circle and nowhere else. Everywhere else the two
 * axes leaned together and the game got three problems for it: "out" quietly
 * added speed, the two numbers on a mark's card did not add up as a triangle
 * so the tank had to be charged something the card did not show, and on a
 * straight fall the axes lay on top of each other, where no pair of numbers
 * could express a push across the line at all.
 *
 * At right angles they are an orthonormal basis. Every change of velocity has
 * exactly one pair of numbers, "out" turns the path without adding speed along
 * it, and what a mark costs is the hypotenuse — which is what a player would
 * have assumed all along. */
export function burnFrame(r, v){
  const pro = unit(v);
  const out = perp(pro);
  return dot(out, r) < 0 ? { pro, out: scale(out, -1) } : { pro, out };
}

/* Something with no gravity still gets a reach — it just does nothing to your
 * path. Inside it the burn axes stop being about the world you are going round
 * and start being about the thing you are trying to come alongside: forward is
 * along your speed *relative to it*, and out is away from it. That is the whole
 * of the effect, and it is the whole of what a rendezvous is.
 *
 * The reach is deliberately far larger than the object, because the object is
 * a dot and the flying is done a long way off it.
 *
 * Note this is `burnFrame` again, handed relative position and relative
 * velocity instead of absolute ones. Doing it that way rather than inventing a
 * "toward the target" axis keeps the two axes at right angles, which is what
 * makes a mark cost the hypotenuse of its own two numbers — see the note above
 * burnFrame for the three bugs that invariant was bought with. */
export function driftTargetAt(world, bodyId, r, t, hidden = null){
  const parent = world.get(bodyId);
  if(!parent) return null;
  let best = null;
  for(const c of world.children(bodyId)){
    /* Keyed on the harbour rather than the mass: a rock can carry enough pull
       to have a reach and still be a thing you come alongside, and that one
       should fly relative too. */
    if(!c.rendezvous || !(c.driftReach > 0)) continue;
    /* A thing the ship has never been told about does not bend its burns. The
       chart hides an unfound wreck, and if the flying still leaned on it the
       hiding would be a lie the player could feel: forward and out would swing
       round on approach to a blank patch of sky. Hidden here means absent. */
    if(hidden && hidden.has(c.id)) continue;
    const st = railState(c, parent.mu, t);
    const d = norm(sub(r, st.r));
    if(d > c.driftReach) continue;
    if(!best || d < best.distance) best = { id: c.id, r: st.r, v: st.v, distance: d, reach: c.driftReach };
  }
  return best;
}

/* A written mark is always in the world's frame — forward and back along the
 * way you are going round it, out and in across that — wherever the ship is.
 *
 * It used to bend to a drifting thing's frame inside one's reach, so that the
 * same four buttons could fly a rendezvous. That is what the two thrusters do
 * now, directly and in real time, and they take their directions from the pair
 * rather than from any frame: so the mark can go back to meaning one thing
 * everywhere, which is the only thing it was ever good at. `driftTargetAt`
 * stays, because finding what the ship is alongside is still the question the
 * readout, the harbour and the thrusters all ask.
 *
 */

/* A node's burn as a vector in the current frame. If the tank cannot cover it,
 * the burn is scaled down to what there is and flagged: the design says a
 * short tank costs time, never the save. */
export function burnVector(r, v, node, dvAvailable, frame){
  const { pro, out } = frame ?? burnFrame(r, v);
  let dv = add(scale(pro, node.prograde || 0), scale(out, node.radial || 0));
  let magnitude = norm(dv);
  let short = false;
  // A skim through a world's clouds is not bought from the tank, so an empty
  // tank must not scale it down — which it did, and the drawn path and the
  // flown path then disagreed about where the ship came out.
  if(node.free) return { dv, magnitude, short };
  if(dvAvailable != null && magnitude > dvAvailable + 1e-12){
    dv = scale(dv, magnitude > 0 ? dvAvailable / magnitude : 0);
    magnitude = dvAvailable;
    short = true;
  }
  return { dv, magnitude, short };
}

/* What a mark costs, given where the ship will be when it fires: the length of
 * the velocity change it actually makes, which is what the tank is charged.
 * Since the two axes are at right angles this is the hypotenuse of the two
 * numbers on the card, and it is computed the long way round anyway so that
 * the charge comes from the same arithmetic that flies the burn. */
export function nodeCost(r, v, node){
  return norm(burnVector(r, v, node).dv);
}
/* The same, without a state to hand. It used to be exact only on a circle and
 * an over-estimate everywhere else; with the axes at right angles it is exact
 * wherever the ship is, so a bound taken from it is the real number. */
export const nodeMagnitude = node => Math.hypot(node.prograde || 0, node.radial || 0);

/* The reverse of burnVector: the prograde and radial numbers that add up to a
 * wanted change of velocity. On an orthonormal frame that is two dot products,
 * and there is always exactly one answer — no leaning axes to invert, and no
 * near-parallel case where the only pair of numbers that worked was two
 * enormous opposing ones that cancelled.
 *
 * The one thing with no answer is a ship with no velocity, which has no
 * forward to measure from. Callers still check. */
export function nodeFromVector(r, v, dv, frame){
  if(!(norm(v) > 0)) return null;
  const { pro, out } = frame ?? burnFrame(r, v);
  return { prograde: dot(dv, pro), radial: dot(dv, out) };
}

/* ------------------------------------------------------------ prediction */

/* The predicted path: what `advance` will do over `horizon` days, recorded as
 * segments (one per sphere of influence, split again at every burn), each
 * with sample points in that body's frame for drawing.
 *
 * Points are sampled in time, densely enough to draw a smooth curve: many
 * points on a fast low orbit, fewer on a long slow transfer, capped so a
 * ten-year horizon does not cost ten thousand samples per frame.
 */
export function predict(world, ship, t0, nodes = [], horizon = 720, opts = {}){
  const segments = [];
  const events = [];
  let body = world.get(ship.body);
  let r = ship.r, v = ship.v;
  let t = t0;
  const end = t0 + horizon;
  const dvBudget = opts.dvAvailable;
  const o = { atmosphere: opts.atmosphere, dvAvailable: dvBudget };
  let segStart = { body: body.id, t, r, v };
  let ni = 0;
  while(ni < nodes.length && nodes[ni].t < t - T_TOL) ni++;
  let guard = 0;
  let crashed = false;
  let dvTotal = 0;
  while(end - t > 0 && guard++ < 48){
    const step = advanceOne(world, body, r, v, t, end, nodes, ni, o);
    // Close the current segment at whatever ended it.
    const seg = finishSegment(world, segStart, body, step.t, step.r, step.v, step.reason, opts);
    segments.push(seg);
    if(step.reason === 'crash'){
      events.push({ kind: 'crash', body: body.id, t: step.t });
      crashed = true;
      break;
    }
    if(step.reason === 'horizon'){ break; }
    if(step.reason === 'partial'){
      // The search gave up part way; carry on from where it reached.
      if(step.t <= t + 1e-12) break;
      r = step.r; v = step.v; t = step.t;
      segStart = { body: body.id, t, r, v };
      continue;
    }
    if(step.reason === 'burn'){
      const node = nodes[ni];
      const burn = burnVector(step.r, step.v, node, o.dvAvailable, burnFrame(step.r, step.v));
      const vNew = add(step.v, burn.dv);
      if(o.dvAvailable != null) o.dvAvailable = Math.max(0, o.dvAvailable - burn.magnitude);
      dvTotal += burn.magnitude;
      events.push({ kind: 'burn', t: step.t, node, body: body.id, magnitude: burn.magnitude, short: burn.short, r: step.r, v: vNew });
      r = step.r; v = vNew; t = step.t; ni++;
      segStart = { body: body.id, t, r, v };
      continue;
    }
    // An SOI change.
    if(step.reason === 'exit'){
      const parent = world.get(body.parent);
      const local = railState(body, parent.mu, step.t);
      events.push({ kind: 'soi', from: body.id, to: parent.id, t: step.t });
      r = add(step.r, local.r); v = add(step.v, local.v); body = parent;
    }else if(step.reason === 'enter'){
      const local = railState(step.into, body.mu, step.t);
      events.push({ kind: 'soi', from: body.id, to: step.into.id, t: step.t });
      r = sub(step.r, local.r); v = sub(step.v, local.v); body = step.into;
    }
    t = step.t;
    segStart = { body: body.id, t, r, v };
  }
  return { segments, events, crashed, dvTotal, end: t, dvLeft: o.dvAvailable };
}

/* The road as legs rather than as days.
 *
 * A leg is a coast on one conic in one frame. It ends at the first of: a mark
 * firing (`burn`), the bottom of a dive through the air (`burn` again, with an
 * `aero` mark the caller's `skimAt` priced), a change of reach (`exit`,
 * `enter`), the ground (`crash`), or nothing at all — which comes in two
 * kinds. `stable` is a closed orbit the search has proved can reach no
 * boundary, so the leg is drawn as one lap and the walk stops there: the
 * ship will go round that lap until a mark is written. `partial` is a leg cut
 * short because the search looked as far as it is allowed on one leg and saw
 * nothing; the next leg carries on from where it stopped.
 *
 * `stop(segments)` is asked after every leg whether that is enough. A chart
 * wants the orbit you are on and the one thing that happens next; a solver
 * wants everything up to a horizon; the flight wants exactly one leg. All
 * three are one walk with a different answer to that question.
 */
export function predictLegs(world, ship, t0, nodes = [], opts = {}){
  const maxLegs = opts.maxLegs ?? 24;
  const end = t0 + (opts.maxTime ?? 6000);
  const stop = opts.stop ?? null;
  const segments = [];
  const events = [];
  let body = world.get(ship.body);
  let r = ship.r, v = ship.v;
  let t = t0;
  const o = { atmosphere: opts.atmosphere, dvAvailable: opts.dvAvailable };
  let ni = 0;
  while(ni < nodes.length && nodes[ni].t < t - T_TOL) ni++;
  let crashed = false;
  let dvTotal = 0;
  let stable = false;
  for(let guard = 0; guard < maxLegs && end - t > 0; guard++){
    const start = { body: body.id, t, r, v };
    const el = elementsFromState(body.mu, r, v);
    // Where this leg can end: the next mark, or the far edge of the look.
    let span = end - t, ending = 'horizon';
    let node = null;
    if(ni < nodes.length && nodes[ni].t <= end){ span = Math.max(0, nodes[ni].t - t); ending = 'burn'; node = nodes[ni]; }
    /* A skim ends a leg at the bottom of the dive. The guard on `tp` keeps a
       leg that begins at a periapsis — the one after a skim — from skimming
       the same periapsis again at once. */
    if(opts.skimAt && body.atmo && !o.atmosphere && el.rp < body.atmo && el.rp > body.radius){
      const tp = timeToAnomaly(body.mu, r, v, 0);
      if(tp != null && tp > 1e-3 && tp > (Number.isFinite(el.period) ? el.period * 1e-3 : 0) && tp <= span + 1e-9){
        const at = propagate(body.mu, r, v, tp);
        const shed = opts.skimAt(body, el, at);
        if(shed > 0){
          node = { t: t + tp, prograde: -shed, radial: 0, aero: true, free: true, body: body.id };
          span = tp; ending = 'burn';
        }
      }
    }
    /* Nothing can happen and nothing is written down: one lap, and stop. */
    const quiet = Number.isFinite(el.period) && coastStable(world, body, r, v, t, o);
    if(ending === 'horizon' && quiet){
      const t1 = t + el.period;
      const s = propagate(body.mu, r, v, el.period);
      segments.push(finishSegment(world, start, body, t1, s.r, s.v, 'stable', opts));
      stable = true;
      break;
    }
    /* The search, bounded: a closed orbit is looked at for a few dozen laps,
       an open one for a couple of years; past that the leg is cut and the
       next one carries on. An orbit that can reach nothing needs no bound —
       there is nothing to look for between here and the mark.

       `lapsLooked` is a cap in laps and is obeyed as one. The floor of two
       days underneath it is for the *default* look, where the number of laps
       is already generous and the point is not to give up in an afternoon on
       something whose period is measured in minutes. In front of a caller
       that asked for a small number of laps it is not a floor, it is an
       override: the chart asks for the lap in front of the pilot, and on the
       half-day orbit that a Tassel parking orbit becomes when its high point
       is pushed out past Slate, two days is three and a half laps. That is
       how a meeting with Slate two and four fifths laps away came to be drawn
       on the one lap the chart draws, which is the whole thing the lap cap
       exists to stop. */
    const look = quiet ? Infinity
      : Number.isFinite(el.period)
        ? (opts.lapsLooked != null ? el.period * opts.lapsLooked : Math.max(2, el.period * 60))
      : (opts.openLegDays ?? 720);
    const cut = Math.min(span, look);
    const ev = cut > 0 ? nextEvent(world, body, r, v, t, cut, o) : null;
    if(ev && ev.kind === 'timeout'){
      if(ev.dt <= 0) break;
      segments.push(finishSegment(world, start, body, t + ev.dt, ev.r, ev.v, 'partial', opts));
      r = ev.r; v = ev.v; t += ev.dt;
      if(stop && stop(segments)) break;
      continue;
    }
    if(ev){
      const t1 = t + ev.dt;
      if(ev.kind === 'surface'){
        segments.push(finishSegment(world, start, body, t1, ev.r, ev.v, 'crash', opts));
        events.push({ kind: 'crash', body: body.id, t: t1 });
        crashed = true;
        break;
      }
      segments.push(finishSegment(world, start, body, t1, ev.r, ev.v, ev.kind, opts));
      if(ev.kind === 'exit'){
        const parent = world.get(body.parent);
        const local = railState(body, parent.mu, t1);
        events.push({ kind: 'soi', from: body.id, to: parent.id, t: t1 });
        r = add(ev.r, local.r); v = add(ev.v, local.v); body = parent;
      }else{
        const local = railState(ev.into, body.mu, t1);
        events.push({ kind: 'soi', from: body.id, to: ev.into.id, t: t1 });
        r = sub(ev.r, local.r); v = sub(ev.v, local.v); body = ev.into;
      }
      t = t1;
      if(stop && stop(segments)) break;
      continue;
    }
    // No boundary before the end of this leg: coast to it.
    const s = cut > 0 ? propagate(body.mu, r, v, cut) : { r, v };
    const t1 = t + cut;
    if(cut < span - 1e-12){
      // Looked as far as one leg may; carry on from here.
      segments.push(finishSegment(world, start, body, t1, s.r, s.v, 'partial', opts));
      r = s.r; v = s.v; t = t1;
      if(stop && stop(segments)) break;
      continue;
    }
    if(ending === 'burn'){
      segments.push(finishSegment(world, start, body, t1, s.r, s.v, 'burn', opts));
      const burn = burnVector(s.r, s.v, node, o.dvAvailable, burnFrame(s.r, s.v));
      const vNew = add(s.v, burn.dv);
      if(o.dvAvailable != null) o.dvAvailable = Math.max(0, o.dvAvailable - burn.magnitude);
      dvTotal += burn.magnitude;
      events.push({ kind: 'burn', t: t1, node, body: body.id, magnitude: burn.magnitude, short: burn.short, r: s.r, v: vNew });
      r = s.r; v = vNew; t = t1;
      if(!node.aero) ni++;
      if(stop && stop(segments)) break;
      continue;
    }
    segments.push(finishSegment(world, start, body, t1, s.r, s.v, 'horizon', opts));
    r = s.r; v = s.v; t = t1;
    break;
  }
  /* `next` is the ship after the last leg and whatever ended it — the state
     the flight actually continues from, which is not the leg's own end when
     the leg ended at a door or a burn. */
  return { segments, events, crashed, dvTotal, end: t, dvLeft: o.dvAvailable, stable, next: { body: body.id, r, v, t } };
}

/* One leg of the prediction: coast from (t, r, v) in `body` until the next
 * node, boundary, or the horizon, whichever is first. */
function advanceOne(world, body, r, v, t, end, nodes, ni, o){
  let span = end - t;
  let toNode = false;
  if(ni < nodes.length && nodes[ni].t <= end){
    span = Math.max(0, nodes[ni].t - t);
    toNode = true;
  }
  const ev = span > 0 ? nextEvent(world, body, r, v, t, span, o) : null;
  if(ev && ev.kind === 'timeout'){
    // As far as the search got. The leg is cut here and the next one carries on.
    return { t: t + ev.dt, r: ev.r, v: ev.v, reason: 'partial' };
  }
  if(ev){
    return { t: t + ev.dt, r: ev.r, v: ev.v, reason: ev.kind === 'surface' ? 'crash' : ev.kind, into: ev.into };
  }
  const s = span > 0 ? propagate(body.mu, r, v, span) : { r, v };
  return { t: t + span, r: s.r, v: s.v, reason: toNode ? 'burn' : 'horizon' };
}

/* Sample a finished leg for drawing, and describe its conic once. */
function finishSegment(world, start, body, t1, r1, v1, reason, opts){
  const mu = body.mu;
  const el = elementsFromState(mu, start.r, start.v);
  const dur = t1 - start.t;
  const cap = opts.maxPoints ?? 360;
  /* Draw at most one lap. A bound leg that runs for fifty turns of its own
     orbit is still one ellipse on the chart, and spending a fixed budget of
     points across the whole duration spends them on laps that lie on top of
     one another: fifty turns inside a moon's reach left seven points a lap,
     which is how a tidy little orbit came out as a scribble. Sampling one lap
     at full resolution draws the same picture properly, and the closer in the
     orbit is — a retrograde burn round a small moon — the more it matters,
     because the shorter the period the more laps the leg holds.
     The leg still *ends* where it ends: only the drawing is one lap, and
     `lapped` says so. */
  const lapped = Number.isFinite(el.period) && el.period > 0 && dur > el.period * 1.001;
  const span = lapped ? el.period : dur;
  /* The flight wants the leg and nothing drawn on it. */
  if(opts.noSamples){
    return { body: body.id, t0: start.t, t1, r0: start.r, v0: start.v, r1, v1, elements: el, points: [], times: [], scan: [], scanTimes: [], reason, lapped };
  }
  /* Sampled evenly in angle, not evenly in time.
   *
   * On anything eccentric the ship covers most of its arc in a small part of
   * its time: a fast flyby spends two days crawling in and a few minutes
   * whipping round the bottom. Equal steps of time therefore put almost no
   * points at the periapsis — which is the one part of the path that bends,
   * and the one a pilot aims. Measured on a flyby of Grumm: twenty-five points
   * over sixty-six hours, and the two either side of the low point a hundred
   * and sixty thousand kilometres apart, across a periapsis eight thousand
   * kilometres up. The chart drew a straight line through the manoeuvre and
   * nudging the burn moved it by nothing anyone could see.
   *
   * Equal steps of true anomaly put the points where the corner is. Position
   * comes straight off the conic — no Newton iteration per point — and the
   * time each one happens at is Kepler's equation, which is what
   * `timeToAnomaly` already answers. */
  const span0 = elementsFromState(mu, start.r, start.v);
  const usable = span0.p > 0 && span0.e >= 0 && Number.isFinite(span0.e) && Math.abs(span0.h) > 1e-15;
  let sweep = 0;
  if(usable){
    if(lapped) sweep = TAU;
    else{
      const nu1 = elementsFromState(mu, r1, v1).nu;
      sweep = ((nu1 - span0.nu) % TAU + TAU) % TAU;
      // A leg that has barely moved, or one that has gone right round.
      if(!(sweep > 1e-9)) sweep = dur > 0 ? TAU : 0;
    }
  }
  let n;
  if(usable && sweep > 0){
    // Enough points that a degree or so of arc separates them, within the cap.
    n = Math.round(Math.min(cap, Math.max(24, 240 * sweep / TAU)));
  }else if(Number.isFinite(el.period)){
    n = Math.round(Math.min(cap, Math.max(24, 240 * span / el.period)));
  }else{
    n = Math.round(Math.min(cap, Math.max(24, span / (opts.hyperbolicStep ?? 0.25))));
  }
  const points = new Array(n + 1);
  const times = new Array(n + 1);
  for(let i = 0; i <= n; i++){
    const f = i / n;
    if(usable && sweep > 0){
      const nu = span0.nu + sweep * f;
      points[i] = conicPointAt(span0, nu);
      /* The clock at that angle. Only the drawn lap is sampled, so a moment is
         never more than one turn ahead and the first answer is the right one;
         where the conic cannot say (an asymptote on the way past), fall back to
         spreading the leg's own duration evenly, which is what this did all
         along. */
      const dt = i === 0 ? 0 : timeToAnomaly(mu, start.r, start.v, nu);
      times[i] = start.t + (dt == null || !Number.isFinite(dt) ? span * f : Math.min(dt, span));
      continue;
    }
    const dt = span * f;
    const s = (!lapped && i === n) ? { r: r1 } : propagate(mu, start.r, start.v, dt);
    points[i] = s.r;
    times[i] = start.t + dt;
  }
  // The leg ends exactly where it ends, whatever the last sample rounded to.
  if(!lapped){ points[n] = r1; times[n] = t1; }
  /* A second, coarser set over the *whole* leg, for the searches rather than
     the drawing. closestApproach hunts for the nearest pass to a world, and a
     leg that laps fifty times may only line up with a moon on the fortieth —
     so it needs the whole duration, at exactly the budget it always had,
     while the chart needs one turn drawn properly. One buffer could not be
     both, which is what made drawing it well break aiming at it. */
  let scan = points, scanTimes = times;
  if(lapped){
    const m = Math.round(Math.min(cap, Math.max(24, 240 * dur / el.period)));
    scan = new Array(m + 1); scanTimes = new Array(m + 1);
    for(let i = 0; i <= m; i++){
      const dt = dur * (i / m);
      scan[i] = (i === m ? { r: r1 } : propagate(mu, start.r, start.v, dt)).r;
      scanTimes[i] = start.t + dt;
    }
  }
  return {
    body: body.id, t0: start.t, t1, r0: start.r, v0: start.v, r1, v1,
    elements: el, points, times, scan, scanTimes, reason, lapped,
  };
}

/* ------------------------------------------------------ closest approach */

/* Closest approach between the predicted path and a body, absolute frame.
 * A coarse pass over the sample points finds the neighbourhood; a golden
 * section on the exact conic then pins it down. Returns null if the target
 * never comes within `within` au (default: anything).
 *
 * `arrive` changes the question from "how close does this road ever come?" to
 * "where does it first come close enough?", which is the one a pilot is
 * actually asking. A road that passes a moon at three thousand kilometres
 * tomorrow and at two thousand next spring is a road that gets you there
 * tomorrow, and reporting the spring pass because it is a hair nearer makes
 * every plan look like it takes a season.
 */
export function closestApproach(world, prediction, targetId, within = Infinity, arrive = 0){
  const target = world.get(targetId);
  let best = null;
  let done = false;
  for(const seg of prediction.segments){
    const segBody = world.get(seg.body);
    // Fast path: is the target this segment's own body? Distance is |r|.
    const own = seg.body === targetId;
    // Or a direct child of it? Then work in the segment's frame directly.
    const child = target.parent === seg.body;
    // Or a sibling — the same parent — so both are one rail each from the frame.
    const sibling = !own && !child && target.parent != null && target.parent === segBody.parent;
    // The full-duration samples, not the one lap the chart draws.
    const pts = seg.scan ?? seg.points, ts = seg.scanTimes ?? seg.times;
    for(let i = 0; i < pts.length; i++){
      const t = ts[i];
      let d;
      if(own) d = norm(pts[i]);
      else if(child) d = dist(pts[i], railState(target, segBody.mu, t).r);
      else if(sibling){
        const pmu = world.get(target.parent).mu;
        d = dist(add(railState(segBody, pmu, t).r, pts[i]), railState(target, pmu, t).r);
      }
      else d = dist(add(absState(world, seg.body, t).r, pts[i]), absState(world, targetId, t).r);
      /* Carry the bracket, not the index: the samples searched and the
         samples drawn are different arrays now, and an index into one is
         meaningless in the other. */
      const mark = () => ({ d, seg, lo: ts[Math.max(0, i - 1)], hi: ts[Math.min(ts.length - 1, i + 1)] });
      if(!best || d < best.d) best = mark();
      /* Close enough, and first: stop looking. The samples are in time order
         within a segment and the segments are in time order, so the first one
         under the bar is the earliest arrival. */
      if(arrive > 0 && d <= arrive){ best = mark(); done = true; break; }
    }
    if(done) break;
  }
  if(!best || best.d > within) return null;
  const { seg } = best;
  const segBody = world.get(seg.body);
  const f = t => {
    const s = propagate(segBody.mu, seg.r0, seg.v0, t - seg.t0);
    const fr = absState(world, seg.body, t);
    const shipR = add(fr.r, s.r);
    const shipV = add(fr.v, s.v);
    const tg = absState(world, targetId, t);
    return { d: dist(shipR, tg.r), rel: norm(sub(shipV, tg.v)), shipR, tgR: tg.r };
  };
  let lo = best.lo, hi = best.hi;
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = hi - phi * (hi - lo), b = lo + phi * (hi - lo);
  let fa = f(a).d, fb = f(b).d;
  for(let i = 0; i < 40 && hi - lo > 1e-5; i++){
    if(fa < fb){ hi = b; b = a; fb = fa; a = hi - phi * (hi - lo); fa = f(a).d; }
    else{ lo = a; a = b; fa = fb; b = lo + phi * (hi - lo); fb = f(b).d; }
  }
  const t = (lo + hi) / 2;
  const at = f(t);
  return { t, distance: at.d, relSpeed: at.rel, shipAbs: at.shipR, targetAbs: at.tgR, body: seg.body };
}

/* Both ends of a leg's conic: the low point and, if the conic closes and the
 * leg lasts long enough to get there, the high point. These are the two marks
 * the chart puts on an orbit, and the two numbers a pilot steers by. */
export function segmentApses(seg, mu){
  const el = seg.elements;
  const out = [];
  const at = nu => {
    const dt = timeToAnomaly(mu, seg.r0, seg.v0, nu);
    if(dt == null || dt > seg.t1 - seg.t0) return null;
    return { t: seg.t0 + dt, r: propagate(mu, seg.r0, seg.v0, dt).r };
  };
  const pe = at(0);
  if(pe) out.push({ kind: 'periapsis', distance: el.rp, ...pe });
  if(Number.isFinite(el.period) && el.ra != null){
    const ap = at(Math.PI);
    if(ap) out.push({ kind: 'apoapsis', distance: el.ra, ...ap });
  }
  return out;
}
