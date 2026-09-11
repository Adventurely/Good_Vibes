/* Orbital Trader: the patched-conic kernel.
 *
 * Everything that moves in the game moves through this file, and nothing in
 * here knows about money, cargo, or people. It is pure functions over plain
 * numbers so that the same code runs in the browser, in the tests, and in
 * any tool that wants to ask "where will the ship be?".
 *
 * Units, everywhere: distance in au (Tessel's orbital radius), time in days
 * (Tessel's year is 360 of them), so mu is in au^3/day^2 and speed in au/day.
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
 * of influence or enters another. That is done by conservative advancement:
 * each step is bounded by (distance to the nearest boundary) / (fastest either
 * side can close it), which is a rigorous lower bound on the crossing time, so
 * a boundary can never be skipped, and the crossing itself is then bisected to
 * a millionth of a day. No fixed timestep, no tunnelling through a small moon.
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
 * range; Merrow's Comet at e = 0.94 is the case that punishes a lazy start. */
export function solveKepler(M, e){
  M = ((M % TAU) + TAU) % TAU;
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
 * about Widdershins kept in one line.
 */
export function railState(el, mu, t){
  const { a, e = 0, omega = 0, M0 = 0, retrograde = false } = el;
  const n = meanMotion(mu, a);
  const E = solveKepler(M0 + n * t, e);
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const r = a * (1 - e * cosE);
  const b = a * Math.sqrt(1 - e * e);
  // Perifocal frame: periapsis on +x.
  const xp = a * (cosE - e), yp = b * sinE;
  const k = Math.sqrt(mu * a) / r;
  const vxp = -k * sinE, vyp = k * Math.sqrt(1 - e * e) * cosE;
  const co = Math.cos(omega), so = Math.sin(omega);
  let x = co * xp - so * yp, y = so * xp + co * yp;
  let vx = co * vxp - so * vyp, vy = so * vxp + co * vyp;
  if(retrograde){ y = -y; vy = -vy; }
  return { r: [x, y], v: [vx, vy] };
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
  const rp = bound ? a * (1 - e) : p / 2;
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

  const { c2, c3, psi, rr } = out;
  const f = 1 - (chi * chi / r0n) * c2;
  const g = dt - (chi * chi * chi / sqmu) * c3;
  const r = [f * r0[0] + g * v0[0], f * r0[1] + g * v0[1]];
  const rn = norm(r);
  const gdot = 1 - (chi * chi / rn) * c2;
  const fdot = (sqmu / (rn * r0n)) * chi * (psi * c3 - 1);
  const v = [fdot * r0[0] + gdot * v0[0], fdot * r0[1] + gdot * v0[1]];
  void rr;
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
    const [k2, k3] = stumpff(psi);
    chi = Math.sqrt(y / k2);
    const t = (chi * chi * chi * k3 + A * Math.sqrt(y)) / sqmu;
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
 * gravity, which is how the comet and the Far Lantern are represented.
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
    vmax.set(b.id, railMaxSpeed(b, byId.get(b.parent).mu));
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

/* The smallest sphere of influence containing an absolute position. Used when
 * a ship is put somewhere by fiat: at the start, or after a tow. */
export function soiAt(world, absPos, t){
  let body = world.root;
  for(;;){
    let next = null;
    for(const c of world.wells(body.id)){
      const cp = absState(world, c.id, t).r;
      if(dist(absPos, cp) < c.soi && (!next || c.soi < next.soi)) next = c;
    }
    if(!next) return body;
    body = next;
  }
}

/* Re-express an absolute state as a state in `body`'s frame. */
export function toFrame(world, id, absR, absV, t){
  const p = absState(world, id, t);
  return { body: id, r: sub(absR, p.r), v: sub(absV, p.v) };
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

/* Find the first boundary crossing within `span` days of `t`, or null.
 *
 * Conservative advancement: at each sample the clearance to every boundary
 * divided by the fastest possible closing speed bounds how soon it can be
 * reached, and the step is the smallest such bound (never below H_MIN, or the
 * search would creep). Because the bound is rigorous a boundary is never
 * jumped over, so when a sample lands past one, the crossing is bracketed by
 * the last two samples and bisected.
 */
export function nextEvent(world, body, r0, v0, t0, span, opts){
  /* The fastest the ship can possibly be going during this step. It is the
     only thing keeping the search honest: the bound below divides a clearance
     by a closing speed, and if that speed can be exceeded the search can step
     straight over a boundary. Measured from the lowest point the ship could
     reach without hitting something — a radial fall has no periapsis, only a
     surface. */
  const floor = Math.max(body.radius ?? 0, (opts?.atmosphere && body.atmo) ? body.atmo : 0);
  const el = elementsFromState(body.mu, r0, v0, floor);
  const vship = Number.isFinite(el.vmax) ? el.vmax : Math.sqrt(Math.max(0, norm(v0) ** 2 + 2 * body.mu / Math.max(floor, 1e-9)));
  let t = 0;
  let r = r0, v = v0;
  let prev = boundaries(world, body, r, v, t0, opts);
  // Something can start already inside a boundary (a graze that the tolerance
  // put a hair over). Report nothing for that one until it comes clear.
  const armed = prev.map(b => b.gap > 0);
  let guard = 0;
  while(t < span && guard++ < 20000){
    let h = span - t;
    for(let i = 0; i < prev.length; i++){
      if(!armed[i]) continue;
      const b = prev[i];
      const speed = vship + b.closing;
      const bound = b.gap / speed;
      if(bound < h) h = bound;
    }
    h = Math.max(h, H_MIN);
    if(t + h > span) h = span - t;
    if(h <= 0) break;
    const next = propagate(body.mu, r, v, h);
    const tn = t + h;
    const now = boundaries(world, body, next.r, next.v, t0 + tn, opts);
    let hit = -1;
    for(let i = 0; i < now.length; i++){
      if(armed[i] && now[i].gap <= 0){ hit = i; break; }
      if(!armed[i] && now[i].gap > 0) armed[i] = true;
    }
    if(hit >= 0){
      // Bisect between (t, r, v) outside and (tn) inside.
      let lo = 0, hi = h;
      for(let i = 0; i < 60 && hi - lo > T_TOL; i++){
        const mid = (lo + hi) / 2;
        const s = propagate(body.mu, r, v, mid);
        const g = boundaries(world, body, s.r, s.v, t0 + t + mid, opts)[hit].gap;
        if(g <= 0) hi = mid; else lo = mid;
      }
      // Land just on the far side, so the next frame agrees we have crossed.
      const s = propagate(body.mu, r, v, hi);
      const b = now[hit];
      return { kind: b.kind, into: b.into ?? null, dt: t + hi, r: s.r, v: s.v };
    }
    r = next.r; v = next.v; t = tn; prev = now;
  }
  /* Out of steps rather than out of span. Saying "nothing happens here" would
     be a lie, and the caller would coast serenely through whatever was coming;
     saying where the search got to lets it pick up from there. */
  if(t < span) return { kind: 'timeout', into: null, dt: t, r, v };
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
      const burn = burnVector(r, v, nodeNext, opts.dvAvailable);
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

/* A node's burn as a vector in the current frame. Prograde is along the
 * velocity, radial is away from the body. If the tank cannot cover it, the
 * burn is scaled down to what there is and flagged: the design says a short
 * tank costs time, never the save. */
export function burnVector(r, v, node, dvAvailable){
  const pro = unit(v), rad = unit(r);
  let dv = add(scale(pro, node.prograde || 0), scale(rad, node.radial || 0));
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

/* What a mark costs, given where the ship will be when it fires. Prograde and
 * radial are not at right angles, so the two numbers on the card do not add up
 * as a triangle — the only honest size of a burn is the length of the velocity
 * change it actually makes, which is what the tank is charged for. */
export function nodeCost(r, v, node){
  return norm(burnVector(r, v, node).dv);
}
/* The same, without a state to hand: exact on a circle, an over-estimate
 * elsewhere. Only for rough bounds — never for what the player is told. */
export const nodeMagnitude = node => Math.hypot(node.prograde || 0, node.radial || 0);

/* The reverse of burnVector: the prograde and radial numbers that add up to a
 * wanted change of velocity.
 *
 * The two axes are at right angles only on a circle. Everywhere else they lean
 * together, and on a straight fall they lie on top of each other — at which
 * point there is no pair of numbers that adds up to a push across the line, and
 * the honest answer is to say so. The caller decides what to do about it; what
 * it must not do is hand back two enormous opposing numbers that happen to
 * cancel, because those are what the player would be charged for.
 */
export function nodeFromVector(r, v, dv){
  const p = unit(v), rad = unit(r);
  const det = p[0] * rad[1] - p[1] * rad[0];
  if(Math.abs(det) < 0.02) return null;      // within about a degree of parallel
  return {
    prograde: (dv[0] * rad[1] - dv[1] * rad[0]) / det,
    radial: (p[0] * dv[1] - p[1] * dv[0]) / det,
  };
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
  let periapsisMarks = [];
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
      const burn = burnVector(step.r, step.v, node, o.dvAvailable);
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
  void periapsisMarks;
  return { segments, events, crashed, dvTotal, end: t, dvLeft: o.dvAvailable };
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
  let n;
  if(Number.isFinite(el.period)){
    n = Math.round(Math.min(cap, Math.max(24, 240 * dur / el.period)));
  }else{
    n = Math.round(Math.min(cap, Math.max(24, dur / (opts.hyperbolicStep ?? 0.25))));
  }
  const points = new Array(n + 1);
  const times = new Array(n + 1);
  // Sample by eccentric anomaly when the leg is a bound orbit so that the fast
  // part near periapsis gets as many points as the slow part near apoapsis.
  for(let i = 0; i <= n; i++){
    const f = i / n;
    const dt = dur * f;
    const s = i === n ? { r: r1 } : propagate(mu, start.r, start.v, dt);
    points[i] = s.r;
    times[i] = start.t + dt;
  }
  return {
    body: body.id, t0: start.t, t1, r0: start.r, v0: start.v, r1, v1,
    elements: el, points, times, reason,
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
    for(let i = 0; i < seg.points.length; i++){
      const t = seg.times[i];
      let d;
      if(own) d = norm(seg.points[i]);
      else if(child) d = dist(seg.points[i], railState(target, segBody.mu, t).r);
      else d = dist(add(absState(world, seg.body, t).r, seg.points[i]), absState(world, targetId, t).r);
      if(!best || d < best.d) best = { d, i, seg };
      /* Close enough, and first: stop looking. The samples are in time order
         within a segment and the segments are in time order, so the first one
         under the bar is the earliest arrival. */
      if(arrive > 0 && d <= arrive){ best = { d, i, seg }; done = true; break; }
    }
    if(done) break;
  }
  if(!best || best.d > within) return null;
  const { seg } = best;
  const segBody = world.get(seg.body);
  const f = t => {
    const s = propagate(segBody.mu, seg.r0, seg.v0, t - seg.t0);
    const shipR = add(absState(world, seg.body, t).r, s.r);
    const shipV = add(absState(world, seg.body, t).v, s.v);
    const tg = absState(world, targetId, t);
    return { d: dist(shipR, tg.r), rel: norm(sub(shipV, tg.v)), shipR, tgR: tg.r };
  };
  let lo = seg.times[Math.max(0, best.i - 1)], hi = seg.times[Math.min(seg.times.length - 1, best.i + 1)];
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

/* The periapsis of a segment's conic, if the leg actually passes through it:
 * a marker the chart draws as "kissing distance". */
export function segmentPeriapsis(seg, mu){
  const el = seg.elements;
  const dt = timeToAnomaly(mu, seg.r0, seg.v0, 0);
  if(dt == null || dt > seg.t1 - seg.t0) return null;
  const s = propagate(mu, seg.r0, seg.v0, dt);
  return { t: seg.t0 + dt, r: s.r, distance: el.rp };
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
