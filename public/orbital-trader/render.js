/* Orbital Trader: the chart.
 *
 * One canvas, drawn every frame from the game state and the kernel's
 * prediction. Nothing in here changes the game; it turns positions in au
 * into pixels and back, and it knows what a maneuver node looks like.
 *
 * Two conventions worth knowing before reading the rest:
 *
 * 1. Every orbit and every predicted leg is drawn in its parent's frame,
 *    anchored at the parent's position *now*. A transfer that ends in Grumm's
 *    sphere of influence draws its last leg around where Grumm is today, not
 *    where Grumm will be when the ship gets there. That is what Kerbal Space
 *    Program does, and for good reason: a path drawn in the fixed frame is a
 *    spiral nobody can read, while the parent-frame legs show the shape of
 *    each encounter. The closest-approach ghost is what tells you the timing.
 *
 * 2. Pixels come from au through one number, `zoom` (pixels per au), on a
 *    logarithmic wheel. The whole system is a few hundred pixels across at
 *    zoom 30; a moon system needs zoom 30,000. Sizes that should stay legible
 *    (dots, labels, handles) are in pixels; things that are real (orbits,
 *    SOI rings, docking zones) are in au and grow with the zoom.
 */

import { absState, railState, unit, norm, add, sub, scale, perp, dist, propagate } from './orbit.js';

/* The palette: a star chart drawn on paper. The same paper as every page on
 * the site (theme.css), with the orbits inked on it and the Lamp still the
 * one warm thing. It was a black chart with pale lines for a while, and it
 * was the one page whose whole screen was dark — the sky is most of it, so
 * a paper frame around a black chart would have been a paper frame around
 * dark mode.
 *
 * Every hue that used to be a light on black is the same hue as an ink on
 * paper: the peoples keep their identities (Emberkin ember, otters
 * river-green, cats — bone on black — are tan on paper, frogs cold blue) and
 * the Chorus is still a violet that nothing living uses. The one rule is
 * that anything drawn as a line or a label is dark enough to read on the
 * paper; anything drawn as a glow or a fill is a tint of it. */
export const PALETTE = {
  space:      '#f4efe4',
  spaceEdge:  '#e3d8c2',
  star:       '#f59a2e',
  starCore:   '#ffd23f',
  starGlow:   'rgba(245,154,46,0.28)',
  orbit:      'rgba(42,33,24,0.16)',
  orbitMoon:  'rgba(42,33,24,0.26)',
  orbitFocus: 'rgba(42,33,24,0.38)',
  soi:        'rgba(200,110,20,0.06)',
  soiEdge:    'rgba(200,110,20,0.45)',
  zone:       'rgba(43,117,48,0.65)',
  zoneFill:   'rgba(43,117,48,0.12)',
  zoneFast:   'rgba(200,97,26,0.9)',
  belt:       'rgba(122,104,88,0.55)',
  beltBand:   'rgba(122,104,88,0.10)',
  debris:     'rgba(107,95,79,0.9)',
  path:       ['#b8720c', '#2b7530', '#20629f', '#7a4fb5', '#c8611a', '#1f8f7a'],
  pathDim:    'rgba(143,92,5,0.35)',
  pathShort:  'rgba(111,97,85,0.6)',
  ship:       '#2a2118',
  shipEdge:   '#f4efe4',
  node:       '#b8720c',
  nodeRing:   'rgba(184,114,12,0.5)',
  prograde:   '#2b7530',
  retrograde: '#c8611a',
  radial:     '#20629f',
  marker:     '#2a2118',
  ghost:      'rgba(42,33,24,0.5)',
  text:       '#2a2118',
  textDim:    'rgba(42,33,24,0.62)',
  crash:      '#b5372a',
  atmo:       'rgba(122,79,181,0.16)',
  emberkin:   '#c8611a',
  otter:      '#2b7530',
  cat:        '#8a6a3a',
  frog:       '#2d7fb3',
  chorus:     '#7a4fb5',
  mixed:      '#b8720c',
  none:       '#8a7d6b',
};

export const speciesColour = s => PALETTE[s] ?? PALETTE.none;

/* Body colours by kind and people, so the chart reads without labels. */
export function bodyColour(body){
  if(body.kind === 'star') return PALETTE.star;
  if(body.colour) return body.colour;
  return speciesColour(body.species ?? 'none');
}

const MIN_ZOOM = 8, MAX_ZOOM = 4e5;

export function createChart(canvas, world, opts = {}){
  const ctx = canvas.getContext('2d', { alpha: false });
  const chart = {
    canvas, ctx, world,
    width: 0, height: 0, dpr: 1,
    camera: { cx: 0, cy: 0, zoom: 240, follow: 'ship' },
    /* Screen-pixel shift of the follow centre: negative x when a panel covers
       the right of the chart, negative y when a sheet covers the bottom. */
    offset: [0, 0],
    /* Last frame's screen-space records, for hit testing. */
    hits: { bodies: [], nodes: [], handles: [], pathSegs: [] },
    reducedMotion: !!opts.reducedMotion,
    /* The scale bar is a navigation tool. On a thumbnail or behind a title it
       is a stray measurement in the corner of a picture. */
    showScale: opts.showScale !== false,
    /* Strips of the canvas that something else owns — a title, a HUD, a link
       along the bottom. Labels keep out of them; dots still show through. */
    labelInsets: opts.labelInsets ?? { top: 0, right: 0, bottom: 0, left: 0 },
    stars: makeStars(opts.starSeed ?? 7),
    belt: null,
  };

  chart.resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    chart.dpr = dpr;
    chart.width = Math.max(1, Math.round(rect.width));
    chart.height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  chart.toScreen = p => [
    (p[0] - chart.camera.cx) * chart.camera.zoom + chart.width / 2 + chart.offset[0],
    chart.height / 2 + chart.offset[1] - (p[1] - chart.camera.cy) * chart.camera.zoom,
  ];
  chart.toWorld = s => [
    (s[0] - chart.width / 2 - chart.offset[0]) / chart.camera.zoom + chart.camera.cx,
    (chart.height / 2 + chart.offset[1] - s[1]) / chart.camera.zoom + chart.camera.cy,
  ];

  /* Zoom about a screen point, so what is under the pointer stays there. */
  chart.zoomBy = (factor, at) => {
    const cam = chart.camera;
    const centre = [chart.width / 2 + chart.offset[0], chart.height / 2 + chart.offset[1]];
    const before = chart.toWorld(at ?? centre);
    cam.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
    const after = chart.toWorld(at ?? centre);
    cam.cx += before[0] - after[0];
    cam.cy += before[1] - after[1];
  };
  chart.panBy = (dx, dy) => {
    chart.camera.cx -= dx / chart.camera.zoom;
    chart.camera.cy += dy / chart.camera.zoom;
    chart.camera.follow = null;
  };
  /* Follow a body or the ship, and pick a zoom that frames it. */
  chart.focus = (what, view, frame = true) => {
    chart.camera.follow = what;
    if(!frame) return;
    if(what === 'ship') return;
    const b = world.get(what);
    if(!b) return;
    const span = b.soi ?? (b.zoneRadius ? b.zoneRadius * 6 : 0.2);
    chart.camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (Math.min(chart.width, chart.height) * 0.36) / span));
  };

  chart.draw = view => draw(chart, view);
  chart.hitTest = (x, y) => hitTest(chart, x, y);
  chart.nearestPathPoint = (x, y, prediction, t) => nearestPathPoint(chart, x, y, prediction, t);
  chart.resize();
  return chart;
}

/* ------------------------------------------------------------ star field */

function makeStars(seed){
  const stars = [];
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for(let i = 0; i < 420; i++){
    stars.push({ x: rnd(), y: rnd(), m: rnd(), tw: rnd() * 6.28 });
  }
  return stars;
}

/* ---------------------------------------------------------------- draw */

function draw(chart, view){
  const { ctx, world, camera } = chart;
  const W = chart.width, H = chart.height;
  const t = view.t;
  chart.hits = { bodies: [], nodes: [], handles: [], pathSegs: [] };

  // Positions of every body now, once per frame.
  const pos = new Map();
  for(const b of world.bodies) pos.set(b.id, absState(world, b.id, t));

  // Camera follow.
  if(camera.follow === 'ship' && view.shipAbs){
    camera.cx = view.shipAbs.r[0]; camera.cy = view.shipAbs.r[1];
  }else if(camera.follow && pos.has(camera.follow)){
    const p = pos.get(camera.follow).r; camera.cx = p[0]; camera.cy = p[1];
  }

  // Ground.
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, PALETTE.space); g.addColorStop(1, PALETTE.spaceEdge);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  drawStars(chart, view);

  drawBelt(chart, view, pos);
  drawOrbits(chart, pos, t);
  drawSoiRings(chart, pos);
  drawBodies(chart, view, pos, t);
  if(view.prediction) drawPrediction(chart, view, pos);
  drawShip(chart, view);
  if(view.prediction && view.nodes) drawNodes(chart, view, pos);
  if(chart.showScale) drawScaleBar(chart);
}

function drawStars(chart, view){
  const { ctx, camera } = chart;
  const W = chart.width, H = chart.height;
  // Faint parallax with the camera, none with zoom: stars are infinitely far.
  const ox = (camera.cx * 3) % 1, oy = (camera.cy * 3) % 1;
  const tw = chart.reducedMotion ? 0 : (view.now ?? 0) / 1000;
  for(const s of chart.stars){
    const x = ((s.x - ox * 0.02 + 1) % 1) * W, y = ((s.y + oy * 0.02 + 1) % 1) * H;
    const a = 0.25 + 0.55 * s.m * (tw ? 0.75 + 0.25 * Math.sin(tw * (0.6 + s.m) + s.tw) : 1);
    // Ink specks on paper rather than lights on black: the bright ones gold
    // ink, the rest the page's own ink, at the same alphas as before.
    ctx.fillStyle = s.m > 0.94 ? `rgba(143,92,5,${a.toFixed(3)})` : `rgba(42,33,24,${a.toFixed(3)})`;
    const r = s.m > 0.92 ? 1.6 : 1;
    ctx.fillRect(x, y, r, r);
  }
}

/* The Scatter: rocks on their own circular rails, deterministic from a seed
 * so the belt looks the same every visit, and the Arc's debris trailing the
 * segment along its orbit. Decorative, but the rocks turn with the sky. */
function drawBelt(chart, view, pos){
  const { ctx, world, camera } = chart;
  const belt = view.belt;
  if(!belt) return;
  const zoom = camera.zoom;
  const lamp = pos.get(world.root.id).r;
  const lampS = chart.toScreen(lamp);
  if(zoom * belt.outer > 12){
    ctx.beginPath();
    ctx.arc(lampS[0], lampS[1], belt.outer * zoom, 0, Math.PI * 2);
    ctx.arc(lampS[0], lampS[1], belt.inner * zoom, 0, Math.PI * 2, true);
    ctx.fillStyle = PALETTE.beltBand; ctx.fill();
  }
  if(belt.rocks){
    const px = zoom * belt.outer;
    if(px < 12) return; // too far out to matter
    const step = px > 4000 ? 1 : px > 900 ? 1 : 2;
    ctx.fillStyle = PALETTE.belt;
    for(let i = 0; i < belt.rocks.length; i += step){
      const k = belt.rocks[i];
      const th = k.th0 + k.n * view.t;
      const p = chart.toScreen([lamp[0] + k.r * Math.cos(th), lamp[1] + k.r * Math.sin(th)]);
      if(p[0] < -4 || p[1] < -4 || p[0] > chart.width + 4 || p[1] > chart.height + 4) continue;
      const s = k.big && zoom > 400 ? 2 : 1;
      ctx.fillRect(p[0], p[1], s, s);
    }
  }
  if(belt.debris && belt.debris.length){
    ctx.fillStyle = PALETTE.debris;
    for(const d of belt.debris){
      const th = d.th0 + d.n * view.t;
      const p = chart.toScreen([lamp[0] + d.r * Math.cos(th), lamp[1] + d.r * Math.sin(th)]);
      if(p[0] < -4 || p[1] < -4 || p[0] > chart.width + 4 || p[1] > chart.height + 4) continue;
      ctx.fillRect(p[0], p[1], 1, 1);
    }
  }
}

/* A Kepler ellipse in the parent's frame. The parent sits at one focus, so
 * the centre is offset by a*e towards apoapsis; a retrograde orbit is the
 * same ellipse mirrored in x, which the kernel also does, so the two agree. */
function ellipsePath(ctx, chart, centreAbs, el){
  const { a, e = 0, omega = 0, retrograde } = el;
  const b = a * Math.sqrt(1 - e * e);
  const z = chart.camera.zoom;
  const rot = retrograde ? -omega : omega;
  // Centre of the ellipse relative to the focus, in the parent frame.
  const cx = -a * e * Math.cos(rot), cy = -a * e * Math.sin(rot);
  const c = chart.toScreen([centreAbs[0] + cx, centreAbs[1] + cy]);
  ctx.beginPath();
  ctx.ellipse(c[0], c[1], a * z, b * z, -rot, 0, Math.PI * 2);
}

function drawOrbits(chart, pos, t){
  const { ctx, world, camera } = chart;
  void t;
  const diag = Math.hypot(chart.width, chart.height);
  for(const b of world.bodies){
    if(b.parent == null) continue;
    const px = b.a * camera.zoom;
    // Too small to be a shape, or so large that all you see of it is a line
    // drawn across the whole chart. Neither is worth the ink.
    if(px < 6 || px > diag * 6) continue;
    const parent = pos.get(b.parent).r;
    ctx.strokeStyle = b.kind === 'moon' ? PALETTE.orbitMoon : PALETTE.orbit;
    ctx.lineWidth = 1;
    if(b.kind === 'zone' || b.mu === 0) ctx.setLineDash([3, 5]); else ctx.setLineDash([]);
    ellipsePath(ctx, chart, parent, b);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawSoiRings(chart, pos){
  const { ctx, world, camera } = chart;
  for(const b of world.bodies){
    if(b.soi == null || b.mu <= 0) continue;
    const px = b.soi * camera.zoom;
    if(px < 10 || px > 6000) continue;
    const p = chart.toScreen(pos.get(b.id).r);
    ctx.beginPath(); ctx.arc(p[0], p[1], px, 0, Math.PI * 2);
    // A wash inside the ring reads as a world when the ring is small and as a
    // stain on the chart when it fills the screen, so it fades out as it grows.
    if(px < Math.min(chart.width, chart.height) * 0.45){ ctx.fillStyle = PALETTE.soi; ctx.fill(); }
    ctx.strokeStyle = PALETTE.soiEdge; ctx.lineWidth = 1; ctx.setLineDash([6, 6]); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function labelFor(b){ return b.name ?? b.id; }

function drawBodies(chart, view, pos, t){
  const { ctx, world, camera } = chart;
  const zoom = camera.zoom;
  const placed = [];   // label boxes already used, for collision avoidance
  const bodies = [...world.bodies].sort((x, y) => (y.radius ?? 0) - (x.radius ?? 0));
  for(const b of bodies){
    const p = chart.toScreen(pos.get(b.id).r);
    if(p[0] < -60 || p[1] < -60 || p[0] > chart.width + 60 || p[1] > chart.height + 60) continue;
    const real = (b.radius ?? 0) * zoom;
    const minPx = b.kind === 'star' ? 9 : b.kind === 'planet' ? 4.5 : b.kind === 'moon' ? 3 : 2.5;
    const rpx = Math.max(minPx, real);
    const colour = bodyColour(b);

    // Skip a moon that would sit inside its parent's dot: it is not there yet.
    if(b.parent && b.kind !== 'planet'){
      const pp = chart.toScreen(pos.get(b.parent).r);
      const parent = world.get(b.parent);
      const prpx = Math.max(4.5, (parent.radius ?? 0) * zoom);
      if(dist(p, pp) < prpx + 2 && b.a * zoom < 6) continue;
    }

    if(b.kind === 'star'){
      const glow = ctx.createRadialGradient(p[0], p[1], rpx, p[0], p[1], rpx * 5);
      glow.addColorStop(0, PALETTE.starGlow); glow.addColorStop(1, 'rgba(245,154,46,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p[0], p[1], rpx * 5, 0, Math.PI * 2); ctx.fill();
    }
    // Merrow's tail: away from the Lamp, longer the closer it comes.
    if(b.id === 'merrow' && b.parent){
      const rel = pos.get(b.id).r;
      const rn = Math.hypot(rel[0], rel[1]) || 1;
      const len = Math.min(120, Math.max(0, 26 / rn));
      if(len > 4){
        const d = [rel[0] / rn, -rel[1] / rn];
        const g = ctx.createLinearGradient(p[0], p[1], p[0] + d[0] * len, p[1] + d[1] * len);
        g.addColorStop(0, 'rgba(32,98,159,0.55)'); g.addColorStop(1, 'rgba(32,98,159,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + d[0] * len, p[1] + d[1] * len); ctx.stroke();
      }
    }
    // Grumm's atmosphere band, when it is big enough to mean something.
    if(b.atmo && b.atmo * zoom > 8){
      ctx.beginPath(); ctx.arc(p[0], p[1], b.atmo * zoom, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.atmo; ctx.fill();
    }
    // Docking zone, when near enough to be about to use it.
    if(b.port && b.zoneRadius && view.nearPort === b.id){
      const zr = Math.max(14, b.zoneRadius * zoom);
      const d = view.docking;
      ctx.beginPath(); ctx.arc(p[0], p[1], zr, 0, Math.PI * 2);
      if(d?.ok){ ctx.fillStyle = PALETTE.zoneFill; ctx.fill(); }
      ctx.strokeStyle = d?.inZone && !d.slow ? PALETTE.zoneFast : PALETTE.zone;
      ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]);
    }

    let fill = colour;
    if(b.id === 'lantern'){
      // It blinks at irregular gaps nobody has explained. Under reduced motion it rests, lit, in a ring.
      const lit = chart.reducedMotion || lanternLit(view.now ?? 0);
      fill = lit ? '#2a2118' : '#b9a98a';
    }
    ctx.beginPath(); ctx.arc(p[0], p[1], rpx, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    if(b.kind === 'star'){ ctx.fillStyle = PALETTE.starCore; ctx.beginPath(); ctx.arc(p[0], p[1], rpx * 0.55, 0, Math.PI * 2); ctx.fill(); }
    if(b.kind === 'zone' || b.mu === 0){
      // Gravity-less things are hollow: the comet, the Lantern, Claw Rock.
      ctx.strokeStyle = colour; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p[0], p[1], rpx + 3, 0, Math.PI * 2); ctx.stroke();
    }
    if(view.target === b.id){
      ctx.strokeStyle = PALETTE.marker; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p[0], p[1], rpx + 7, 0, Math.PI * 2); ctx.stroke();
      crosshair(ctx, p, rpx + 7);
    }
    chart.hits.bodies.push({ id: b.id, x: p[0], y: p[1], r: Math.max(rpx, 10), drawn: rpx });

    // Labels: planets always; moons when their orbit is drawn; zones when
    // they are more than a dot. Never over another label.
    const wantLabel = b.kind === 'star' || b.kind === 'planet' || view.target === b.id || camera.follow === b.id
      || (b.parent && b.a * zoom > 28);
    if(!wantLabel) continue;
    const text = labelFor(b);
    ctx.font = (view.target === b.id ? '600 ' : '') + '12px ui-sans-serif, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 8;
    const cand = [
      [p[0] + rpx + 6, p[1] - 6], [p[0] + rpx + 6, p[1] + 14], [p[0] - w - rpx - 2, p[1] - 6], [p[0] - w / 2 + 4, p[1] - rpx - 8],
    ];
    let spot = null;
    for(const c of cand){
      const box = { x: c[0] - 4, y: c[1] - 11, w, h: 14 };
      const ins = chart.labelInsets;
      if(box.x < ins.left || box.y < ins.top || box.x + box.w > chart.width - ins.right || box.y + box.h > chart.height - ins.bottom) continue;
      if(!placed.some(o => o.x < box.x + box.w && o.x + o.w > box.x && o.y < box.y + box.h && o.y + o.h > box.y)){ spot = c; placed.push(box); break; }
    }
    if(!spot) continue;
    ctx.fillStyle = view.target === b.id ? PALETTE.text : PALETTE.textDim;
    ctx.fillText(text, spot[0], spot[1]);
  }
  void t;
}

/* Lit for 0.4 s at seeded gaps of three to eleven seconds. */
function lanternLit(nowMs){
  let t = 0, i = 0;
  const s = nowMs / 1000;
  while(t < s && i < 100000){
    const gap = 3 + 8 * (((((Math.sin(i * 12.9898) * 43758.5453) % 1) + 1) % 1));
    if(s >= t + gap && s < t + gap + 0.4) return true;
    t += gap + 0.4; i++;
  }
  return false;
}

function crosshair(ctx, p, r){
  ctx.beginPath();
  for(const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
    ctx.moveTo(p[0] + dx * r, p[1] + dy * r); ctx.lineTo(p[0] + dx * (r + 5), p[1] + dy * (r + 5));
  }
  ctx.stroke();
}

/* The predicted path, leg by leg. Each leg's points are in its body's frame,
 * anchored at that body's position now. Colour changes at each burn so the
 * plan reads as "this, then that"; a leg after a burn the tank cannot pay for
 * is drawn grey. */
function drawPrediction(chart, view, pos){
  const { ctx, world, camera } = chart;
  const pred = view.prediction;
  let colourIx = 0;
  let short = false;
  let burnIx = 0;
  /* A road that grazes the same moon on nine laps earns nine identical labels,
     and the chart turns into a list. Name the first few crossings and let the
     markers speak for the rest. */
  let named = 0;
  const NAME_LIMIT = 3;
  const burns = pred.events.filter(e => e.kind === 'burn');
  for(let si = 0; si < pred.segments.length; si++){
    const seg = pred.segments[si];
    const anchor = pos.get(seg.body).r;
    const pts = seg.points;
    if(!pts.length) continue;
    // Colour: advance at each burn boundary.
    if(si > 0 && pred.segments[si - 1].reason === 'burn'){
      const b = burns[burnIx++];
      if(b && b.short) short = true;
      colourIx++;
    }
    ctx.strokeStyle = short ? PALETTE.pathShort : PALETTE.path[colourIx % PALETTE.path.length];
    ctx.lineWidth = short ? 1 : 1.5;
    ctx.setLineDash(seg.body === view.shipBody && si === 0 ? [] : [6, 4]);
    ctx.beginPath();
    let first = true;
    const screenPts = [];
    for(let i = 0; i < pts.length; i++){
      const s = chart.toScreen(add(anchor, pts[i]));
      screenPts.push(s);
      if(first){ ctx.moveTo(s[0], s[1]); first = false; } else ctx.lineTo(s[0], s[1]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    chart.hits.pathSegs.push({ seg, screenPts });

    // Where the leg ends: an SOI marker, a crash, or the edge of the plan.
    const endS = chart.toScreen(add(anchor, seg.r1));
    if(seg.reason === 'exit' || seg.reason === 'enter'){
      ctx.fillStyle = PALETTE.marker;
      diamond(ctx, endS, 4);
      if(named < NAME_LIMIT && (camera.zoom * (world.get(seg.body).soi ?? 1) > 40 || seg.reason === 'enter')){
        named++;
        ctx.fillStyle = PALETTE.textDim;
        ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
        const to = seg.reason === 'exit' ? world.get(world.get(seg.body).parent) : pred.events.find(e => e.kind === 'soi' && Math.abs(e.t - seg.t1) < 1e-6);
        const name = seg.reason === 'exit' ? (to ? labelFor(to) : '') : (to ? labelFor(world.get(to.to)) : '');
        if(name) ctx.fillText((seg.reason === 'exit' ? 'out to ' : 'into ') + name, endS[0] + 7, endS[1] + 4);
      }
    }else if(seg.reason === 'crash'){
      ctx.strokeStyle = PALETTE.crash; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(endS[0] - 5, endS[1] - 5); ctx.lineTo(endS[0] + 5, endS[1] + 5);
      ctx.moveTo(endS[0] + 5, endS[1] - 5); ctx.lineTo(endS[0] - 5, endS[1] + 5);
      ctx.stroke();
    }
    // Kissing distance of this leg, when it is a real approach to a world.
    if(view.periapses){
      const pe = view.periapses.find(p => p.segIndex === si);
      if(pe && camera.zoom * pe.distance > 12){
        const s = chart.toScreen(add(anchor, pe.r));
        ctx.fillStyle = PALETTE.textDim;
        ctx.beginPath(); ctx.arc(s[0], s[1], 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Closest approach to the target: the ship's point on its leg, the target's
  // ghost where it will be, both in that leg's frame.
  const ca = view.approach;
  if(ca && ca.segBody){
    const anchor = pos.get(ca.segBody).r;
    const shipS = chart.toScreen(add(anchor, ca.shipLocal));
    const tgS = chart.toScreen(add(anchor, ca.targetLocal));
    ctx.strokeStyle = PALETTE.ghost; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(shipS[0], shipS[1]); ctx.lineTo(tgS[0], tgS[1]); ctx.stroke();
    ctx.setLineDash([]);
    const tb = world.get(view.target);
    const rpx = Math.max(3, (tb?.radius ?? 0) * camera.zoom);
    ctx.beginPath(); ctx.arc(tgS[0], tgS[1], rpx + 2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = PALETTE.marker; diamond(ctx, shipS, 3.5);
    if(ca.label){
      ctx.fillStyle = PALETTE.text; ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(ca.label, tgS[0] + rpx + 6, tgS[1] - 6);
    }
  }
}

function diamond(ctx, p, r){
  ctx.beginPath();
  ctx.moveTo(p[0], p[1] - r); ctx.lineTo(p[0] + r, p[1]); ctx.lineTo(p[0], p[1] + r); ctx.lineTo(p[0] - r, p[1]);
  ctx.closePath(); ctx.fill();
}

function drawShip(chart, view){
  const { ctx } = chart;
  if(!view.shipAbs) return;
  const p = chart.toScreen(view.shipAbs.r);
  const dir = unit(view.shipAbs.v);
  const ang = Math.atan2(-dir[1], dir[0]);
  ctx.save();
  ctx.translate(p[0], p[1]);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(8, 0); ctx.lineTo(-6, 5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5); ctx.closePath();
  ctx.fillStyle = PALETTE.ship; ctx.fill();
  ctx.strokeStyle = PALETTE.shipEdge; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
  if(view.docked){
    ctx.strokeStyle = PALETTE.zone; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p[0], p[1], 12, 0, Math.PI * 2); ctx.stroke();
  }
}

/* Maneuver nodes: a ring on the path at the node's time, with a prograde /
 * retrograde pair of handles along the local velocity and a radial pair
 * across it. Handles are pixels, not au, so they are the same size to grab
 * at any zoom; the hit radius is bigger than the drawn handle. */
const HANDLE_OFFSET = 30;
function drawNodes(chart, view, pos){
  const { ctx } = chart;
  const nodes = view.nodes;
  for(let i = 0; i < nodes.length; i++){
    const n = nodes[i];
    const where = view.nodePositions?.[i];
    if(!where) continue;
    const anchor = pos.get(where.body).r;
    const p = chart.toScreen(add(anchor, where.r));
    const vdir = unit(where.v);
    const pro = [vdir[0], -vdir[1]];           // screen y is down
    const rad = unit(where.r); const radS = [rad[0], -rad[1]];
    const selected = view.selectedNode === i;
    ctx.strokeStyle = PALETTE.nodeRing; ctx.lineWidth = selected ? 2 : 1.25;
    ctx.beginPath(); ctx.arc(p[0], p[1], selected ? 11 : 8, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = PALETTE.node;
    ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, Math.PI * 2); ctx.fill();
    chart.hits.nodes.push({ index: i, x: p[0], y: p[1], r: 16 });
    if(!selected) continue;
    const handles = [
      ['prograde', pro, PALETTE.prograde, 1],
      ['retrograde', [-pro[0], -pro[1]], PALETTE.retrograde, -1],
      ['radialOut', radS, PALETTE.radial, 1],
      ['radialIn', [-radS[0], -radS[1]], PALETTE.radial, -1],
    ];
    for(const [kind, d, colour] of handles){
      const h = [p[0] + d[0] * HANDLE_OFFSET, p[1] + d[1] * HANDLE_OFFSET];
      ctx.strokeStyle = colour; ctx.lineWidth = 1.25;
      ctx.beginPath(); ctx.moveTo(p[0] + d[0] * 12, p[1] + d[1] * 12); ctx.lineTo(h[0], h[1]); ctx.stroke();
      ctx.fillStyle = colour;
      if(kind.startsWith('radial')){
        ctx.beginPath(); ctx.arc(h[0], h[1], 5, 0, Math.PI * 2); ctx.fill();
      }else{
        ctx.save(); ctx.translate(h[0], h[1]); ctx.rotate(Math.atan2(d[1], d[0]));
        ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, 5); ctx.lineTo(-4, -5); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      chart.hits.handles.push({ index: i, axis: kind, x: h[0], y: h[1], r: 20, dir: d });
    }
  }
}

/* A bar that says how long an au is right now, so the zoom is legible. */
function drawScaleBar(chart){
  const { ctx, camera } = chart;
  const targetPx = 90;
  const au = targetPx / camera.zoom;
  const pow = Math.pow(10, Math.floor(Math.log10(au)));
  const nice = [1, 2, 5, 10].map(m => m * pow).reduce((a, b) => Math.abs(b * camera.zoom - targetPx) < Math.abs(a * camera.zoom - targetPx) ? b : a);
  const px = nice * camera.zoom;
  const x = 16, y = chart.height - 18;
  ctx.strokeStyle = PALETTE.textDim; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + px, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.moveTo(x + px, y - 4); ctx.lineTo(x + px, y + 4); ctx.stroke();
  ctx.fillStyle = PALETTE.textDim; ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(nice >= 0.05 ? `${+nice.toFixed(2)} au` : fmtAu(nice), x + 4, y - 6);
}

/* One au is 147,400,000 km here (1706 km/s times 86,400 s), so a speed in km/s
 * times a time in seconds is a distance on the same screen. */
export const KM_PER_AU = 147400000;
export function fmtAu(au){
  if(au >= 0.05) return `${au.toFixed(2)} au`;
  const km = au * KM_PER_AU;
  const sig = km >= 100 ? Number(km.toPrecision(3)) : Math.round(km);
  return `${sig.toLocaleString('en-GB')} km`;
}

/* -------------------------------------------------------------- hits */

function hitTest(chart, x, y){
  const h = chart.hits;
  /* Spread first, name after. A handle record carries its own axis, and
     spreading it over `kind` was how every handle came back as something else
     and dragging one panned the chart. */
  for(const k of h.handles){ if(Math.hypot(k.x - x, k.y - y) <= k.r) return { ...k, kind: 'handle' }; }
  for(const n of h.nodes){ if(Math.hypot(n.x - x, n.y - y) <= n.r) return { ...n, kind: 'node' }; }
  // Bodies: nearest within its drawn size, so a moon beats the planet it is in
  // front of. The generous margin is for fingers.
  let best = null;
  for(const b of h.bodies){
    const d = Math.hypot(b.x - x, b.y - y);
    if(d <= b.r + 4 && (!best || d < best.d)) best = { kind: 'body', id: b.id, d, drawn: b.drawn ?? b.r };
  }
  if(best) return best;
  return null;
}

/* Nearest point on the drawn path to a screen point, with the time it stands
 * for, so a click on the path can become a node at that moment. Linear
 * interpolation along the polyline is fine: the node then snaps to the
 * exact conic when the plan is rebuilt. */
function nearestPathPoint(chart, x, y, prediction, tNow){
  let best = null;
  for(const { seg, screenPts } of chart.hits.pathSegs){
    for(let i = 1; i < screenPts.length; i++){
      const a = screenPts[i - 1], b = screenPts[i];
      const abx = b[0] - a[0], aby = b[1] - a[1];
      const len2 = abx * abx + aby * aby || 1e-9;
      let u = ((x - a[0]) * abx + (y - a[1]) * aby) / len2;
      u = Math.max(0, Math.min(1, u));
      const px = a[0] + u * abx, py = a[1] + u * aby;
      const d = Math.hypot(px - x, py - y);
      if(!best || d < best.d){
        const t = seg.times[i - 1] + u * (seg.times[i] - seg.times[i - 1]);
        best = { d, t, seg, x: px, y: py };
      }
    }
  }
  if(!best || best.d > 18 || best.t <= (tNow ?? -Infinity)) return null;
  return best;
}

/* Where a node sits on the plan: the ship's state at the node's time in the
 * frame it will be in. Computed from the prediction so it agrees with the path. */
export function locateOnPrediction(world, prediction, t){
  for(const seg of prediction.segments){
    if(t >= seg.t0 - 1e-9 && t <= seg.t1 + 1e-9){
      const mu = world.get(seg.body).mu;
      const s = propagate(mu, seg.r0, seg.v0, t - seg.t0);
      return { body: seg.body, r: s.r, v: s.v };
    }
  }
  return null;
}

/* The target's ghost at closest approach, expressed in the frame of the leg
 * it happens on, ready for the chart. */
export function approachForChart(world, prediction, ca, targetId){
  if(!ca) return null;
  const seg = prediction.segments.find(s => ca.t >= s.t0 - 1e-9 && ca.t <= s.t1 + 1e-9);
  if(!seg) return null;
  const mu = world.get(seg.body).mu;
  const s = propagate(mu, seg.r0, seg.v0, ca.t - seg.t0);
  const segAbs = absState(world, seg.body, ca.t).r;
  const tgAbs = absState(world, targetId, ca.t).r;
  return { segBody: seg.body, shipLocal: s.r, targetLocal: sub(tgAbs, segAbs), t: ca.t, distance: ca.distance, relSpeed: ca.relSpeed };
}

export { railState, norm, sub, scale, perp };
