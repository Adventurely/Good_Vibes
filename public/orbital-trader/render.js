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
 *    (dots, labels, markers) are in pixels; things that are real (orbits,
 *    SOI rings, docking zones) are in au and grow with the zoom.
 */

import { absState, railState, meanMotion, unit, norm, add, sub, scale, perp, dist, propagate, burnFrame } from './orbit.js';
import { drawSprite } from './sprites.js';

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
  space:      '#000000',
  spaceEdge:  '#000000',
  star:       '#ffd23f',
  starCore:   '#fff1b8',
  starGlow:   'rgba(245,154,46,0.22)',
  orbit:      'rgba(245,234,214,0.13)',
  orbitMoon:  'rgba(245,234,214,0.20)',
  orbitFocus: 'rgba(245,234,214,0.30)',
  /* The short bright stretch of rail just ahead of a world, ending in a
     chevron: which way it is going. Card seven asks a beginner to put a
     mark thirty degrees *ahead* of a moon, and two of them could not tell
     ahead from behind on a faint grey circle. */
  orbitLead:  'rgba(245,234,214,0.80)',
  soi:        'rgba(245,154,46,0.05)',
  soiEdge:    'rgba(245,154,46,0.30)',
  /* The space near a drifting thing. Not gravity and not a harbour, so neither
     the amber of a reach nor the green of a mouth: inside it the two buttons on
     a mark stop being about an orbit and start being about the thing you are
     coming alongside, and the readout in the corner turns into range and
     closing speed. That is a place, and a place a pilot has to aim at — it was
     doing all of this and drawing nothing, so the only way to learn where it
     was was to be inside it and notice the words had changed. */
  drift:      'rgba(90,166,232,0.06)',
  driftEdge:  'rgba(90,166,232,0.42)',
  /* The harbour mouth. It was dim enough to lose against a bright road drawn
     across it, which is the one moment it matters — so it is the strongest
     green on the chart, and the ring you cannot yet tie up inside is a clear
     amber rather than the near-invisible wash the sphere-of-influence rings
     use. */
  zone:       'rgba(124,214,88,0.85)',
  zoneWait:   'rgba(245,154,46,0.55)',
  zoneFill:   'rgba(108,194,74,0.12)',
  zoneFast:   'rgba(245,154,46,0.8)',
  belt:       'rgba(122,104,88,0.6)',
  beltBand:   'rgba(122,104,88,0.08)',
  debris:     'rgba(107,95,79,0.9)',
  /* The road is white. Everything else on this chart is dim, coloured or
     small, so the one line you are riding is the only bright thing in the
     sky — and when a burn is being edited, the road it would put you on is
     the one other thing: yellow, and dashed, so you can see which is which
     without reading a legend. */
  path:       ['#ffffff', '#ffd23f', '#ffd23f', '#ffd23f', '#ffd23f', '#ffd23f'],
  pathNow:    '#ffffff',
  pathPlan:   '#ffd23f',
  pathNext:   '#ffffff',
  pathDim:    'rgba(255,255,255,0.30)',
  pathShort:  'rgba(160,150,135,0.7)',
  apsis:      '#ffffff',
  crossing:   '#ffffff',
  ship:       '#ffffff',
  shipEdge:   '#000000',
  shipHalo:   'rgba(255,255,255,0.22)',
  node:       '#ffd23f',
  flame:      '#ff7a2e',   // the body of a burn's flame; node is its core and its words
  nodeRing:   'rgba(255,210,63,0.7)',
  /* Where the road cuts across a world's rail, and where that world will be
     when it does. Orange, because every other mark on this chart is already
     spoken for: white is the road you are on, yellow is the road a burn
     would put you on, and a coloured dot is a world. A pair of orange
     diamonds is neither, which is the point — they are a question about
     timing, and the gap between them is the answer. */
  railCross:  '#f59a2e',
  prograde:   '#6cc24a',
  retrograde: '#f59a2e',
  radial:     '#5aa6e8',
  marker:     '#ffffff',
  ghost:      'rgba(245,234,214,0.55)',
  text:       '#f5ead6',
  textDim:    'rgba(245,234,214,0.6)',
  crash:      '#ff5f5f',
  emberkin:   '#ff8c42',
  otter:      '#6cc24a',
  cat:        '#e9dcc0',
  frog:       '#5fb9e6',
  chorus:     '#b48cff',
  mixed:      '#ffd23f',
  none:       '#9a948a',
};

export const speciesColour = s => PALETTE[s] ?? PALETTE.none;

/* Body colours by kind and people, so the chart reads without labels. */
/* The channels of a `#rrggbb`, or the old hard-coded violet for anything that
 * is not one. Every colour on this chart is authored as hex, so this is the one
 * place that has to know it. */
const rgbCache = new Map();
function rgbOf(colour){
  let out = rgbCache.get(colour);
  if(out) return out;
  const hex = /^#([0-9a-f]{6})$/i.exec(colour);
  out = hex ? [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)) : [139, 107, 214];
  rgbCache.set(colour, out);
  return out;
}
export const rgba = (colour, alpha) => { const [r, g, b] = rgbOf(colour); return `rgba(${r},${g},${b},${alpha})`; };
/* Towards white, for the bit of a star that is too bright to have a colour. */
export function lighten(colour, k){
  const [r, g, b] = rgbOf(colour);
  const up = c => Math.round(c + (255 - c) * k);
  return `rgb(${up(r)},${up(g)},${up(b)})`;
}

/* A body's colour at the weight air is drawn in: enough to read as weather over
 * black, faint enough that the road through it stays the brightest thing. One
 * number, so the four atmospheres are the same thickness of haze as each other
 * whatever colour they are. */
const HAZE_ALPHA = 0.18;
export const haze = colour => rgba(colour, HAZE_ALPHA);

export function bodyColour(body){
  /* A star's own colour wins where it has one: there are two of them now, and
     one is blue. The palette's star is what the Lamp is, and the fallback for
     anything that does not say. */
  if(body.colour) return body.colour;
  if(body.kind === 'star') return PALETTE.star;
  return speciesColour(body.species ?? 'none');
}

/* A lap of Tassel is 0.0007 au across and a lap of Slate is 0.00003; the chart
   has to frame both, so the ceiling is set by the smallest moon rather than
   by the biggest orbit. */
const MIN_ZOOM = 8, MAX_ZOOM = 2e7;

/* One clock for the whole file, and one that does not throw where there is no
   window: the chart is also drawn on the title screen and in tests. */
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

export function createChart(canvas, world, opts = {}){
  const ctx = canvas.getContext('2d', { alpha: false });
  const chart = {
    canvas, ctx, world,
    width: 0, height: 0, dpr: 1,
    /* The chart is centred on the ship. That is where you are, and a player
       who has to hunt for their own dot has already lost the thread. Tapping
       a body centres on that instead, until you tap back to the ship or the
       ship changes which world it is going round.

       Panning is offered on top of that lock rather than instead of it. The
       view a player drags to is kept as `pan`: an offset in au **from the
       thing they last focused**, not a position in the sky. So the sky does
       not slide out from under a pan — look a little ahead of your ship and
       it stays a little ahead of your ship as the ship goes round, and the
       same drag over a moon keeps its place as the moon travels. Centring is
       then always one press away (`focus` puts pan back to nothing), which is
       the answer to the old objection that a view you can lose is a view
       somebody has to get back.

       `cx`/`cy` are the sum — anchor plus pan — written down once a frame so
       every projection in this file can stay the one subtraction it was. */
    camera: { cx: 0, cy: 0, zoom: 240, follow: 'ship', pan: [0, 0], anchor: [0, 0] },
    /* Screen-pixel shift of the follow centre: negative x when a panel covers
       the right of the chart, negative y when a sheet covers the bottom. */
    offset: [0, 0],
    /* Last frame's screen-space records, for hit testing. */
    hits: { bodies: [], nodes: [], handles: [], pathSegs: [], rails: [], inset: null },
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

  /* How many real pixels the chart is painted into, and why that is not one
   * number.
   *
   * Every frame repaints the whole sky: a gradient over the ground, four
   * hundred stars, the Scatter, every rail, the road, the worlds. Nothing is
   * cached and nothing needs to be, because the cost is almost exactly linear
   * in the size of the backing store — measured at 1600x1000, a pan costs 13
   * ms at one device pixel per point, 25 at one and a half, 37 at two. On a
   * retina screen that last one is twenty-seven frames a second, and dragging
   * the chart visibly stutters.
   *
   * So the resolution follows the gesture. Still, it paints at the full ratio
   * and the art is as sharp as the screen can show it. Moving — a drag, a
   * wheel, a pinch — it drops to half of that until a fifth of a second after
   * the last of it, which on a retina screen is a third of the work and takes
   * the drag back under ten milliseconds. Nobody can see the difference in
   * pixel art that is sliding under their finger, and everybody can see
   * twenty-seven frames a second.
   *
   * The switch happens between frames, never inside one: resizing the canvas
   * throws away its contents and resets the context, and the only places that
   * ask for it are the event handlers and the top of a draw. */
  const MOTION_SETTLE_MS = 200;
  let liveDpr = 0, movingUntil = -1e9;
  const fullDpr = () => Math.min(2, window.devicePixelRatio || 1);
  const applyDpr = dpr => {
    if(dpr === liveDpr) return;
    liveDpr = dpr;
    chart.dpr = dpr;
    canvas.width = Math.round(chart.width * dpr);
    canvas.height = Math.round(chart.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  /* Say that the view is moving. Anything that shifts the camera by hand
     calls this; the clock moving the ship does not, because the chart is
     locked to the ship and the sky under it barely stirs. */
  chart.stir = () => { movingUntil = nowMs() + MOTION_SETTLE_MS; };
  chart.syncDpr = now => applyDpr((now ?? nowMs()) < movingUntil ? Math.max(1, fullDpr() / 2) : fullDpr());

  chart.resize = () => {
    const rect = canvas.getBoundingClientRect();
    chart.width = Math.max(1, Math.round(rect.width));
    chart.height = Math.max(1, Math.round(rect.height));
    liveDpr = 0;                       // the store is the wrong size whatever it was
    applyDpr(fullDpr());
  };

  chart.toScreen = p => [
    (p[0] - chart.camera.cx) * chart.camera.zoom + chart.width / 2 + chart.offset[0],
    chart.height / 2 + chart.offset[1] - (p[1] - chart.camera.cy) * chart.camera.zoom,
  ];
  chart.toWorld = s => [
    (s[0] - chart.width / 2 - chart.offset[0]) / chart.camera.zoom + chart.camera.cx,
    (chart.height / 2 + chart.offset[1] - s[1]) / chart.camera.zoom + chart.camera.cy,
  ];

  /* Centre = the thing being followed, plus however far the player has
     dragged away from it. Everything that moves the view moves `pan` and then
     calls this, so the next frame agrees with the frame that is on screen. */
  chart.settle = () => {
    const cam = chart.camera;
    cam.cx = cam.anchor[0] + cam.pan[0];
    cam.cy = cam.anchor[1] + cam.pan[1];
  };

  /* Drag the sky by a screen distance. The point under the finger stays under
     the finger, which is the only thing a pan has to get right. */
  chart.panBy = (dxPx, dyPx) => {
    const cam = chart.camera;
    cam.pan[0] -= dxPx / cam.zoom;
    cam.pan[1] += dyPx / cam.zoom;
    chart.stir();
    chart.settle();
  };
  /* Back to the middle of whatever is being followed, keeping the scale. */
  chart.centre = () => { chart.camera.pan = [0, 0]; chart.settle(); };
  /* Whether the view is off its lock, and by how much of the shorter side of
     the canvas: what a "you have wandered" cue in the page is drawn from. */
  chart.panned = () => {
    const cam = chart.camera;
    const px = Math.hypot(cam.pan[0], cam.pan[1]) * cam.zoom;
    return px / Math.max(1, Math.min(chart.width, chart.height));
  };

  /* Zoom about a screen point, so what is under the pointer stays there. */
  chart.zoomBy = (factor, at) => {
    const cam = chart.camera;
    const centre = [chart.width / 2 + chart.offset[0], chart.height / 2 + chart.offset[1]];
    const before = chart.toWorld(at ?? centre);
    cam.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
    const after = chart.toWorld(at ?? centre);
    /* Into the pan, not into the centre: the centre is recomputed from the
       lock every frame, so a correction written there is gone by the next
       one and the sky jumps back under the pointer. */
    cam.pan[0] += before[0] - after[0];
    cam.pan[1] += before[1] - after[1];
    chart.stir();
    chart.settle();
  };
  /* Lock onto a body and pick a zoom that frames its reach. Focusing is also
     what un-pans: the thing you just asked to look at belongs in the middle,
     and every later drag is measured from it. */
  chart.focus = (what, view, frame = true) => {
    chart.camera.follow = what;
    chart.centre();
    if(!frame) return;
    const b = world.get(what);
    if(!b) return;
    chart.frameBody(what);
  };
  chart.frameBody = id => {
    const b = world.get(id);
    if(!b) return;
    const span = b.soi ?? (b.zoneRadius ? b.zoneRadius * 6 : 0.2);
    chart.camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (Math.min(chart.width, chart.height) * 0.36) / span));
  };

  chart.draw = view => draw(chart, view);
  chart.hitTest = (x, y) => hitTest(chart, x, y);
  chart.nearestPathPoint = (x, y, prediction, t) => nearestPathPoint(chart, x, y, prediction, t);
  chart.nearestNode = (x, y, within) => nearestNode(chart, x, y, within);
  chart.nearestRailPoint = (x, y, t) => nearestRailPoint(chart, x, y, t);
  chart.dragNodeTime = (x, y, prediction, t, nodes, index) => dragNodeTime(chart, x, y, prediction, t, nodes, index);
  chart.resize();
  return chart;
}

/* ------------------------------------------------------------ star field */

function makeStars(seed){
  const stars = [];
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for(let i = 0; i < 900; i++){
    /* Magnitude squared, so the field is mostly faint with a few bright ones
       in it. Spread evenly, every star looks like the same star and the sky
       reads as a texture rather than a depth. */
    const m = rnd();
    stars.push({ x: rnd(), y: rnd(), m: m * m, tw: rnd() * 6.28 });
  }
  return stars;
}

/* ---------------------------------------------------------------- draw */

function draw(chart, view){
  const { ctx, world, camera } = chart;
  /* Before anything is painted, and never after: the resolution this frame is
     going into. See the note on chart.resize. */
  chart.syncDpr(view.now);
  /* What this ship has not been told about. The sky is the same either way —
     the kernel never reads this — but a body nobody has mentioned draws no
     dot, no rail, no reach and no label, and cannot be tapped. */
  chart.hidden = view.hidden instanceof Set ? view.hidden : EMPTY_HIDDEN;
  const W = chart.width, H = chart.height;
  const t = view.t;
  chart.hits = { bodies: [], nodes: [], handles: [], pathSegs: [], rails: [], inset: chart.hits?.inset ?? null };

  // Positions of every body now, once per frame.
  const pos = new Map();
  for(const b of world.bodies) pos.set(b.id, absState(world, b.id, t));

  /* The lock, and then the pan on top of it. Nothing that is followed holds
     still — the ship is going round something and every world is on a rail —
     so the anchor is read fresh each frame and the player's drag rides along
     on it. With nothing followed (the title screen) the anchor is the Lamp at
     the origin, and the pan is the whole of the framing. */
  if(camera.follow === 'ship' && view.shipAbs) camera.anchor = [...view.shipAbs.r];
  else if(camera.follow && pos.has(camera.follow)) camera.anchor = [...pos.get(camera.follow).r];
  else camera.anchor = [0, 0];
  chart.settle();

  // Ground.
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, PALETTE.space); g.addColorStop(1, PALETTE.spaceEdge);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  drawStars(chart, view);

  drawBelt(chart, view, pos);
  drawOrbits(chart, pos, t);
  drawSoiRings(chart, pos);
  drawDriftReaches(chart, pos);
  drawBodies(chart, view, pos, t);
  /* Where each leg of the road is pinned on the screen, worked out once and
     handed to everything that puts a mark on the road. It used to be worked
     out inside drawPrediction and nowhere else, so the road knew that a leg
     in a moon's frame is drawn where the moon *will be* and the marks did
     not: a burn written inside a moon's reach, and the ring showing which
     bit of road you just tapped, were both drawn against where the moon is
     now — fifteen hundred pixels off the line they belong to. */
  const anchors = view.prediction ? pathAnchors(view.prediction, pos) : null;
  if(view.prediction) drawPrediction(chart, view, pos, anchors);
  drawShip(chart, view, pos);
  if(view.prediction && view.nodes) drawNodes(chart, view, pos, anchors);
  if(view.tapMark) drawTapMark(chart, view, pos, anchors);
  if(view.prediction) drawEncounterInset(chart, view);
  if(chart.showScale) drawScaleBar(chart);
}

function drawStars(chart, view){
  const { ctx, camera } = chart;
  const W = chart.width, H = chart.height;
  /* Faint parallax with the camera, none with zoom: stars are infinitely far.
     The offset has to be continuous or the field jumps: it used to be
     `(camera.cx * 3) % 1`, and every time that crossed a whole number the
     whole sky hopped a couple of dozen pixels sideways — which at warp, when
     the camera crosses au in a second, was a twitch. The wrap belongs on the
     star's own position, where it is seamless, and not on the offset. */
  const ox = camera.cx * 0.06, oy = camera.cy * 0.06;
  const wrap = v => ((v % 1) + 1) % 1;
  const tw = chart.reducedMotion ? 0 : (view.now ?? 0) / 1000;
  for(const s of chart.stars){
    const x = wrap(s.x - ox) * W, y = wrap(s.y + oy) * H;
    const a = 0.12 + 0.70 * s.m * (tw ? 0.78 + 0.22 * Math.sin(tw * (0.6 + s.m) + s.tw) : 1);
    /* Lights on black. These were ink specks — a near-black brown, and gold
       for the bright ones — from when the chart was drawn on paper; the
       ground went black and they were never turned back into stars, so four
       hundred of them were being drawn every frame at a contrast of nothing.
       The brightest sit well under the road, which is pure white and has to
       stay the one thing your eye goes to. */
    ctx.fillStyle = s.m > 0.80 ? `rgba(255,222,168,${a.toFixed(3)})` : `rgba(226,224,216,${a.toFixed(3)})`;
    const r = s.m > 0.90 ? 2 : 1;
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

const EMPTY_HIDDEN = new Set();

function drawOrbits(chart, pos, t){
  const { ctx, world, camera } = chart;
  void t;
  const diag = Math.hypot(chart.width, chart.height);
  for(const b of world.bodies){
    if(b.parent == null) continue;
    if(chart.hidden.has(b.id)) continue;
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
    /* A rail that is on the screen is a rail you can tap, so every one that
       gets drawn writes down what it would take to find a point on it again:
       where its focus is this frame, and whose gravity it is going round.
       A rail nobody drew is not tappable, which is what keeps a tap from
       landing on a hairline nobody can see. */
    chart.hits.rails.push({ id: b.id, el: b, mu: world.get(b.parent).mu, centre: parent });
  }
  ctx.setLineDash([]);
  /* Then the lead on each of them, over the rail so it reads as part of it. */
  for(const rail of chart.hits.rails){
    const lead = railLead(chart, rail.el, rail.centre, rail.mu, t);
    if(!lead) continue;
    ctx.strokeStyle = PALETTE.orbitLead; ctx.lineWidth = 1.5;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.beginPath();
    lead.arc.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]));
    ctx.stroke();
    const [hx, hy] = lead.head, a = lead.angle;
    ctx.beginPath();
    ctx.moveTo(hx - 5 * Math.cos(a - 0.6), hy - 5 * Math.sin(a - 0.6));
    ctx.lineTo(hx, hy);
    ctx.lineTo(hx - 5 * Math.cos(a + 0.6), hy - 5 * Math.sin(a + 0.6));
    ctx.stroke();
    ctx.lineJoin = ctx.lineCap = 'butt';
  }
}

/* The stretch of rail just ahead of a world, in screen space: a short arc
 * starting clear of the world's own disc and running a couple of dozen
 * pixels along the way it is going, and the pose of the chevron at its end.
 * Sampled from the same rail function that places the world, so the arc is
 * on the rail and not on a tangent to it. Null when the rail is too small on
 * screen for a lead to be anything but clutter. */
export function railLead(chart, el, centre, mu, t){
  const zoom = chart.camera.zoom;
  if(!(el.a * zoom >= 30)) return null;
  const now = railState(el, mu, t);
  const pxPerDay = norm(now.v) * zoom;
  if(!(pxPerDay > 0)) return null;
  const clear = Math.max(6, (el.radius ?? 0) * zoom + 4);   // start outside the disc
  const length = 22;
  const arc = [];
  const N = 6;
  let end = null;
  for(let i = 0; i <= N; i++){
    const along = clear + (length * i) / N;
    end = railState(el, mu, t + along / pxPerDay);
    arc.push(chart.toScreen(add(centre, end.r)));
  }
  // The last sample is the head: no second solve for the same moment.
  const angle = Math.atan2(-end.v[1], end.v[0]);    // screen y is down
  return { arc, head: arc[N], angle };
}

/* The reach round a weightless thing: the wrecks, and the Builder station at
 * the Dancer. A sphere of influence is drawn for everything with weight, and
 * this is the same promise for the things with none — cross it and the flying
 * changes, so it is drawn whether or not you are inside it yet.
 *
 * Dashed like a reach rather than solid like a mouth, and inside the harbour
 * mouth's own ring rather than replacing it: they are two different questions
 * — "are the axes about this thing" and "may I tie up" — and the answer to the
 * first is yes a good while before the answer to the second. */
function drawDriftReaches(chart, pos){
  const { ctx, world, camera } = chart;
  for(const b of world.bodies){
    if(!(b.driftReach > 0)) continue;
    if(chart.hidden.has(b.id)) continue;
    const at = pos.get(b.id);
    if(!at) continue;
    const px = b.driftReach * camera.zoom;
    // Smaller than the dot it is round, or bigger than the sky: no use either way.
    if(px < 10 || px > 6000) continue;
    const p = chart.toScreen(at.r);
    if(p[0] < -px - 40 || p[1] < -px - 40 || p[0] > chart.width + px + 40 || p[1] > chart.height + px + 40) continue;
    ctx.beginPath(); ctx.arc(p[0], p[1], px, 0, Math.PI * 2);
    if(px < Math.min(chart.width, chart.height) * 0.45){ ctx.fillStyle = PALETTE.drift; ctx.fill(); }
    ctx.strokeStyle = PALETTE.driftEdge; ctx.lineWidth = 1; ctx.setLineDash([4, 5]); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawSoiRings(chart, pos){
  const { ctx, world, camera } = chart;
  for(const b of world.bodies){
    if(b.soi == null || b.mu <= 0) continue;
    if(chart.hidden.has(b.id)) continue;
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

/* What to call a body on the chart. A thing the player has not found yet keeps
 * its mark — the road still runs into it and the crosshair still says where —
 * but not its name: that is the whole of what the instrument buys. */
function labelFor(b, chart){ return chart?.hidden?.has(b.id) ? '???' : (b.name ?? b.id); }

function drawBodies(chart, view, pos, t){
  const { ctx, world, camera } = chart;
  const zoom = camera.zoom;
  const placed = [];   // label boxes already used, for collision avoidance
  const bodies = [...world.bodies].sort((x, y) => (y.radius ?? 0) - (x.radius ?? 0));
  for(const b of bodies){
    if(chart.hidden.has(b.id)) continue;
    const p = chart.toScreen(pos.get(b.id).r);
    if(p[0] < -60 || p[1] < -60 || p[0] > chart.width + 60 || p[1] > chart.height + 60) continue;
    const real = (b.radius ?? 0) * zoom;
    /* A star that goes round something else is the Dancer, and the Dancer is a
       signpost as much as a body. For most of a game it is the only thing
       marking where the Maw is — the Maw itself does not draw until the
       gravitational sensors are aboard — and where the Maw is is where the
       story ends. So it is drawn as a landmark rather than as a dot its own
       size: a floor that still reads at the widest zoom the chart allows, a
       wider corona, and a rim so it is a star rather than a smudge. */
    const beacon = b.kind === 'star' && b.parent != null;
    const minPx = beacon ? 11 : b.kind === 'star' ? 9 : b.kind === 'planet' ? 4.5 : b.kind === 'moon' ? 3 : 2.5;
    const rpx = Math.max(minPx, real);
    const colour = bodyColour(b);

    /* Skip a moon that would sit inside its parent's dot: it is not there yet.
       Never a star — the Dancer sits a thumb's width from a black hole nobody
       can see, and at the zoom where the two land on the same pixel it is the
       only thing marking the spot. */
    if(b.parent && b.kind !== 'planet' && b.kind !== 'star'){
      const pp = chart.toScreen(pos.get(b.parent).r);
      const parent = world.get(b.parent);
      const prpx = Math.max(4.5, (parent.radius ?? 0) * zoom);
      if(dist(p, pp) < prpx + 2 && b.a * zoom < 6) continue;
    }

    /* A star's halo, in the star's own colour. There are two now and the second
       one is blue, so a gradient hard-coded to the Lamp's orange would have put
       a sunset round it. */
    if(b.kind === 'star'){
      const far = rpx * (beacon ? 7 : 5);
      const glow = ctx.createRadialGradient(p[0], p[1], rpx, p[0], p[1], far);
      glow.addColorStop(0, rgba(colour, beacon ? 0.34 : 0.22)); glow.addColorStop(1, rgba(colour, 0));
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p[0], p[1], far, 0, Math.PI * 2); ctx.fill();
    }
    /* The band of air, when it is big enough to mean something. In the world's
       own colour: four worlds have weather now and a violet haze round all of
       them said Grumm about every one. A disc rather than a ring, because what
       it marks is a place you can be *inside* — the one circle on this chart
       that is an amount of something rather than a boundary. */
    if(b.atmo && b.atmo * zoom > 8){
      ctx.beginPath(); ctx.arc(p[0], p[1], b.atmo * zoom, 0, Math.PI * 2);
      ctx.fillStyle = haze(bodyColour(b)); ctx.fill();
    }
    // Docking zone, when near enough to be about to use it.
    if(b.port && b.zoneRadius && view.nearPort === b.id){
      /* The mouth: the circle your orbit has to fit inside to tie up. A ring,
         not a filled disc — with docking now an orbit rather than a box, this
         is on screen most of the time you are anywhere near a harbour, and a
         green wash that size swallows the road drawn across it. */
      const zr = Math.max(14, b.zoneRadius * zoom);
      const d = view.docking;
      ctx.strokeStyle = d?.ok ? PALETTE.zone : PALETTE.zoneWait;
      ctx.beginPath(); ctx.arc(p[0], p[1], zr, 0, Math.PI * 2);
      ctx.lineWidth = d?.ok ? 2 : 1.5; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
      /* And an anchor hung on it at the top, so the ring says what it is. A
         dashed circle round a planet is the same shape as half a dozen other
         things on this chart — a sphere of influence, an atmosphere, a
         hollow world — and this is the only one you can tie up inside. Drawn
         in pixels, so it is the same size to read at any zoom. */
      anchorGlyph(ctx, p[0], p[1] - zr, 12);
    }

    /* The body itself. Each one has a sprite; the dot is what is left when a
       sprite is too small to say anything — under about seven pixels across a
       sixteen-pixel picture is mush, and a clean dot reads better. */
    let alpha = 1;
    if(b.id === 'maw'){
      // The ring flickers at gaps nobody has explained. Under reduced motion it rests, lit.
      const lit = chart.reducedMotion || mawLit(view.now ?? 0);
      /* Never at full strength. It is a hole: the reading is that something is
         there, not that something is bright, and the Dancer next to it is the
         thing the eye is meant to find first. */
      alpha = lit ? 0.72 : 0.24;
    }
    /* The picture is the planet, so it is drawn at the planet's real size and
       clipped to it. It used to be painted at 1.2 times the radius with
       nothing holding it in, which made every world a fifth too big and put
       a low orbit visibly inside the ground it was clearing. The clip also
       keeps rings and sparks off the sky around the body. */
    let drew = false;
    if(b.kind === 'hole'){
      /* Nothing is the point. A disc of the background with a lensed ring
         round it reads as a hole at every zoom, where a black dot on black
         reads as nothing at all — and a hole is what it is. */
      const r = Math.max(3.5, rpx);
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.space; ctx.fill();
      const halo = ctx.createRadialGradient(p[0], p[1], r, p[0], p[1], r * 3.2);
      halo.addColorStop(0, 'rgba(255,210,63,.80)');
      halo.addColorStop(0.35, 'rgba(245,154,46,.30)');
      halo.addColorStop(1, 'rgba(245,154,46,0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(p[0], p[1], r * 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,225,140,.95)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(p[0], p[1], r * 1.5, 0, Math.PI * 2); ctx.stroke();
      drew = true;
    }
    if(rpx >= 3.5){
      ctx.save();
      ctx.beginPath(); ctx.arc(p[0], p[1], rpx, 0, Math.PI * 2); ctx.clip();
      /* An eighth over the mask, which is one pixel of a sixteen-pixel
         sprite: the art's rim is jagged at that scale and a disc drawn exactly
         to the clip leaves slivers of sky showing round the edge. The clip is
         still the radius, so the silhouette is still the surface. */
      drew = drawSprite(ctx, b.id, p[0], p[1], rpx * 2.25, alpha);
      ctx.restore();
    }
    if(!drew){
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(p[0], p[1], rpx, 0, Math.PI * 2);
      ctx.fillStyle = colour; ctx.fill();
      // And its core, which is the same colour with the colour burnt out of it.
      if(b.kind === 'star'){ ctx.fillStyle = lighten(colour, 0.72); ctx.beginPath(); ctx.arc(p[0], p[1], rpx * 0.55, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    if((b.kind === 'zone' || b.mu === 0) && !drew && b.kind !== 'hole'){
      // Gravity-less things are hollow: the belt havens and the Maw.
      /* Under the body's own alpha, which for everything but the Maw is one.
         The Maw's flicker used to be applied to the dot and not to the ring,
         so the one mark it actually draws never dimmed at all and a thing
         that is meant to be barely there out-shouted the star beside it. */
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = colour; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p[0], p[1], rpx + 3, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    /* The beacon's rim: the corona alone is fog, and fog at the widest zoom is
       what a player scrolls past. */
    if(beacon){
      ctx.strokeStyle = rgba(lighten(colour, 0.5), 0.9); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p[0], p[1], rpx + 3.5, 0, Math.PI * 2); ctx.stroke();
    }
    // The body the chart is centred on wears a ring, so "what am I looking
    // at" is answered by the picture rather than by a panel.
    if(camera.follow === b.id){
      ctx.strokeStyle = PALETTE.marker; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p[0], p[1], rpx + 7, 0, Math.PI * 2); ctx.stroke();
    }
    chart.hits.bodies.push({ id: b.id, x: p[0], y: p[1], r: Math.max(rpx, 10), drawn: rpx });

    // Labels: planets always; moons when their orbit is drawn; zones when
    // they are more than a dot. Never over another label.
    const wantLabel = b.kind === 'star' || b.kind === 'planet' || b.kind === 'hole' || camera.follow === b.id
      || (b.parent && b.a * zoom > 28);
    if(!wantLabel) continue;
    const text = labelFor(b, chart);
    ctx.font = (camera.follow === b.id ? '600 ' : '') + '12px ui-sans-serif, system-ui, sans-serif';
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
    /* A star's name in full strength. There are two, they are the only things
       out here that give off light, and both are places the chart is read from
       rather than dots among dots. */
    ctx.fillStyle = camera.follow === b.id || b.kind === 'star' ? PALETTE.text : PALETTE.textDim;
    ctx.fillText(text, spot[0], spot[1]);
  }
  void t;
}

/* Lit for 0.4 s at seeded gaps of three to eleven seconds. */
/* A small anchor, drawn on a ten-unit grid and scaled to `s` pixels tall:
 * ring, shank, stock across it, and the flukes curving up at the foot. It is
 * stroked in whatever colour is already set, so it carries the ring's own
 * meaning — green where you may tie up, amber where you may not yet. */
function anchorGlyph(ctx, x, y, s){
  const u = s / 10;
  const was = ctx.lineWidth;
  ctx.lineWidth = Math.max(1.2, s / 9);
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y - 3.4 * u, 1.25 * u, 0, Math.PI * 2);        // the ring
  ctx.moveTo(x, y - 2.1 * u); ctx.lineTo(x, y + 3.8 * u);   // the shank
  ctx.moveTo(x - 2.5 * u, y - 1.2 * u);
  ctx.lineTo(x + 2.5 * u, y - 1.2 * u);                     // the stock
  ctx.moveTo(x - 3.3 * u, y + 1.3 * u);                     // the flukes
  ctx.quadraticCurveTo(x, y + 5.6 * u, x + 3.3 * u, y + 1.3 * u);
  ctx.stroke();
  ctx.lineWidth = was;
  ctx.lineJoin = ctx.lineCap = 'butt';
}

function mawLit(nowMs){
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
/* Where each leg is pinned on the screen. The first is pinned to its world
 * where that world is now; every leg after it continues from where the last
 * one stopped:
 *
 *     anchor(n) = anchor(n-1) + end(n-1) - start(n)
 *
 * which is the same point in space written in two frames, so the road joins
 * up exactly at every change of reach. Pinning a moon's leg to where the moon
 * is *now* instead draws the swing past Slate in one corner of the chart and
 * the door into Slate's reach in another, because the encounter happens where
 * Slate will be, not where it is.
 */
export function pathAnchors(pred, pos){
  const anchors = [];
  for(let i = 0; i < pred.segments.length; i++){
    const seg = pred.segments[i];
    if(i === 0){ anchors.push(pos.get(seg.body)?.r ?? [0, 0]); continue; }
    const prev = pred.segments[i - 1];
    anchors.push(prev.body === seg.body
      ? anchors[i - 1]
      : sub(add(anchors[i - 1], prev.r1), seg.r0));
  }
  return anchors;
}

/* The anchor a moment on the road is drawn against: the one belonging to the
 * leg it falls on. `at` is anything locateOnPrediction returned. */
function anchorAt(anchors, at, pos){
  return anchors?.[at.segIndex] ?? pos.get(at.body)?.r ?? [0, 0];
}

function drawPrediction(chart, view, pos, anchorList){
  const { ctx } = chart;
  const pred = view.prediction;
  const burns = pred.events.filter(e => e.kind === 'burn');
  let burnIx = 0;
  let short = false;
  /* Two lines, always both once a burn is written down: white up to the burn,
     yellow after it. Which one is solid says which one you are working on.
     At rest the white road you are actually flying is solid and the yellow
     one it would become is dashed; open the burn and they swap, so the road
     your presses are moving is the bright, continuous one. */
  const editing = !!view.editing;
  const afterBurnAt = si => pred.segments.slice(0, si).some(sg => sg.reason === 'burn');
  // Worked out once for the whole frame; see pathAnchors.
  const anchors = anchorList ?? pathAnchors(pred, pos);
  for(let si = 0; si < pred.segments.length; si++){
    const seg = pred.segments[si];
    const anchor = anchors[si];
    const pts = seg.points;
    if(!anchor || !pts.length) continue;
    if(si > 0 && pred.segments[si - 1].reason === 'burn'){
      const b = burns[burnIx++];
      if(b && b.short) short = true;
    }
    const afterBurn = afterBurnAt(si);
    const dashed = editing ? !afterBurn : afterBurn;
    ctx.strokeStyle = short ? PALETTE.pathShort : afterBurn ? PALETTE.pathPlan : PALETTE.pathNow;
    ctx.lineWidth = dashed ? 1.5 : 2;
    ctx.globalAlpha = dashed ? 0.75 : 1;
    ctx.setLineDash(dashed ? [7, 5] : []);
    ctx.beginPath();
    const screenPts = [];
    for(let i = 0; i < pts.length; i++){
      const sp = chart.toScreen(add(anchor, pts[i]));
      screenPts.push(sp);
      if(i === 0) ctx.moveTo(sp[0], sp[1]); else ctx.lineTo(sp[0], sp[1]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    chart.hits.pathSegs.push({ seg, screenPts });

    if(seg.reason === 'crash'){
      const endS = chart.toScreen(add(anchor, seg.r1));
      ctx.strokeStyle = PALETTE.crash; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(endS[0] - 6, endS[1] - 6); ctx.lineTo(endS[0] + 6, endS[1] + 6);
      ctx.moveTo(endS[0] + 6, endS[1] - 6); ctx.lineTo(endS[0] - 6, endS[1] + 6);
      ctx.stroke();
    }
  }
  /* One list of what the frame has already spoken for, filled in the order the
     marks matter: the burn being worked on, then the apses and their numbers,
     and the encounter crosshair last because it duplicates one of them. */
  const taken = burnBoxes(chart, view, pos, anchors);
  drawApses(chart, view, anchors, afterBurnAt, taken);
  drawCrossings(chart, view, anchors, afterBurnAt);
  drawRailCrossings(chart, view, anchors);
  drawIntercepts(chart, view, anchors, afterBurnAt, taken);
}

/* The marks on a road, each one a shape you can name without a legend:
 *
 *   low point    a filled disc      — the bottom of the orbit
 *   high point   a hollow ring      — the top of it
 *   crossing     a chevron in a ring — a door out of one world into another
 *   burn         a ring with the four directions round it (drawNodes)
 */
/* The boxes the burns take up on the screen this frame. A closed burn is its
 * flame and the name beside it; an open one is the whole editor, which is most
 * of a hand's width across. Nothing else is drawn inside one of these. */
function burnBoxes(chart, view, pos, anchors){
  const { ctx } = chart;
  const out = [];
  const nodes = view.nodes ?? [];
  for(let i = 0; i < nodes.length; i++){
    const where = view.nodePositions?.[i];
    if(!where || !pos.has(where.body)) continue;
    const p = chart.toScreen(add(anchorAt(anchors, where, pos), where.r));
    if(view.selectedNode === i){
      // The arrows reach HANDLE_OFFSET out and the scrap cross further still.
      out.push([p[0] - 80, p[1] - 80, p[0] + 80, p[1] + 80]);
    }else{
      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      out.push([p[0] - 11, p[1] - 15, p[0] + 15 + ctx.measureText(`Burn ${i + 1}`).width, p[1] + 12]);
    }
  }
  return out;
}
const boxesOverlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

function drawApses(chart, view, anchors, afterBurnAt, takenBoxes){
  const { ctx } = chart;
  if(!view.apses) return;
  /* A low point and a burn land on the same stretch of road constantly — the
     cheapest place to burn *is* the low point — and two marks and two labels
     on one pixel is a pile. The burn is the one being worked on, so the apsis
     is the one that stands down.

     Apses pile up on each other too: a burn splits the road in two and both
     halves have a high point, which sit on the same pixel whenever the burn is
     a small one. Whatever is drawn first keeps its place — the legs come in
     the order they are flown, so that is the road you are on now, and the
     plan's mark appears as soon as the burn is big enough to move it. */
  const taken = takenBoxes;
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  for(const a of view.apses){
    const seg = view.prediction.segments[a.segIndex];
    const anchor = anchors[a.segIndex];
    if(!seg || !anchor) continue;
    const afterBurn = afterBurnAt(a.segIndex);
    const p = chart.toScreen(add(anchor, a.r));
    if(p[0] < -60 || p[1] < -30 || p[0] > chart.width + 60 || p[1] > chart.height + 30) continue;
    // The mark is its disc and the words beside it; either one clashing is a clash.
    const label = a.label ?? '';
    const box = [p[0] - 6, p[1] - 7, p[0] + 9 + (label ? ctx.measureText(label).width : 0), p[1] + 8];
    if(taken.some(b => boxesOverlap(box, b))) continue;
    taken.push(box);
    const colour = afterBurn ? PALETTE.pathPlan : PALETTE.apsis;
    ctx.lineWidth = 2;
    ctx.strokeStyle = ctx.fillStyle = colour;
    ctx.beginPath(); ctx.arc(p[0], p[1], 4.5, 0, Math.PI * 2);
    if(a.kind === 'periapsis') ctx.fill(); else ctx.stroke();
    if(a.label) ctx.fillText(a.label, p[0] + 9, p[1] + 4);
  }
}

/* Every door the road goes through: a chevron pointing the way you are going,
 * inside a ring. A burn that reaches a moon and swings past it has two of
 * them, and a chart that marks only the way in is telling half the story. */
function drawCrossings(chart, view, anchors, afterBurnAt){
  const { ctx, world } = chart;
  const list = view.prediction?.crossings ?? (view.prediction?.crossing ? [view.prediction.crossing] : []);
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  for(const c of list){
    const seg = view.prediction.segments[c.segIndex];
    const anchor = anchors[c.segIndex];
    if(!seg || !anchor) continue;
    const colour = afterBurnAt(c.segIndex) ? PALETTE.pathPlan : PALETTE.crossing;
    const p = chart.toScreen(add(anchor, seg.r1));
    const n = seg.points.length;
    const prev = n > 1 ? chart.toScreen(add(anchor, seg.points[n - 2])) : [p[0] - 1, p[1]];
    const ang = Math.atan2(p[1] - prev[1], p[0] - prev[0]);
    ctx.strokeStyle = colour; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p[0], p[1], 8, 0, Math.PI * 2); ctx.stroke();
    ctx.save();
    ctx.translate(p[0], p[1]); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(-2.5, -4); ctx.lineTo(2.5, 0); ctx.lineTo(-2.5, 4); ctx.stroke();
    ctx.restore();
    const to = c.to ? world.get(c.to) : null;
    if(!to) continue;
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(`${c.kind === 'exit' ? 'out to' : 'into'} ${labelFor(to, chart)}`, p[0] + 12, p[1] + 4);
  }
}

/* Cutting across a world's rail: two orange diamonds, and nothing joining
 * them. A dashed tie between the pair was the obvious thing to draw and the
 * wrong one — a straight line across a chart of curves reads as a path you
 * could fly, which is the one thing it is not. Two marks of the same shape
 * and colour already pair themselves.
 *
 * One sits where the road crosses the ring the world travels on; the other
 * sits where that world will actually be at that moment. That pair is the
 * whole of interplanetary timing, and it is drawn for the first crossing
 * only. Crossing Veyra's rail means nothing on its
 * own — the chart has always drawn the crossing, because the rail and the
 * road are both on it — but crossing it with Veyra a quarter of a lap away
 * means you left too early, and the gap between the two says by how much.
 *
 * Both marks are drawn in the frame of the leg the crossing is on, not the
 * frame the rail is drawn in. Those are the same thing for the first leg,
 * which is nearly always where this happens; where they differ (a leg that
 * has come back out of a moon's reach is pinned to where that leg started,
 * not to the Lamp) keeping the pair together is what matters, because the
 * gap between them is the reading.
 */
function diamond(ctx, p, r){
  ctx.beginPath();
  ctx.moveTo(p[0], p[1] - r); ctx.lineTo(p[0] + r, p[1]);
  ctx.lineTo(p[0], p[1] + r); ctx.lineTo(p[0] - r, p[1]);
  ctx.closePath();
}
function drawRailCrossings(chart, view, anchors){
  const { ctx, world } = chart;
  const list = view.railCrossings ?? [];
  if(!list.length) return;
  /* Only for rails that are on the screen. A crossing of a ring nobody can
     see is two orange diamonds floating in the dark with nothing to be
     against. */
  const drawn = new Set(chart.hits.rails.map(r => r.id));
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  for(const c of list){
    if(!drawn.has(c.body)) continue;
    const anchor = anchors[c.segIndex];
    if(!anchor) continue;
    const p = chart.toScreen(add(anchor, c.r));
    const q = chart.toScreen(add(anchor, c.ghost));
    const out = s => s[0] < -80 || s[1] < -40 || s[0] > chart.width + 80 || s[1] > chart.height + 40;
    if(out(p) && out(q)) continue;
    const apart = Math.hypot(q[0] - p[0], q[1] - p[1]);
    ctx.strokeStyle = PALETTE.railCross; ctx.lineWidth = 1.5;
    diamond(ctx, p, 5); ctx.stroke();
    diamond(ctx, q, 5); ctx.stroke();
    /* Whose rail it is, on the world's own mark. Left off when the two are
       nearly on top of each other: that is an arrival, the encounter window
       is already saying so in words, and a third label on the same pixels is
       a pile rather than a chart. */
    const b = world.get(c.body);
    if(b && apart > 18 && !out(q)){
      ctx.fillStyle = PALETTE.textDim;
      ctx.fillText(labelFor(b, chart), q[0] + 9, q[1] + 4);
    }
  }
}

/* The intercepts: the nearest the road comes to each reach it passes through.
 * This is the question a pilot is actually asking while they push a burn
 * around — not "does this reach Slate" but "how close, and how fast" — so they
 * are marked wherever the chart is zoomed, even when the whole encounter is a
 * few pixels wide.
 *
 * There is more than one whenever the road goes through more than one reach,
 * which is how you arrive anywhere in the Grumm system: fall into Grumm, go on
 * to the moon. Both passes are real and both are drawn. What is *not* here,
 * deliberately, is a world the road merely goes near without entering its
 * reach — see the note by `interceptsOf` for the sweep that used to do that
 * and what it cost. */
function drawIntercepts(chart, view, anchors, afterBurnAt, taken){
  for(const ic of view.prediction?.intercepts ?? []) drawIntercept(chart, view, anchors, afterBurnAt, ic, taken);
}
function drawIntercept(chart, view, anchors, afterBurnAt, ic, taken){
  const { ctx } = chart;
  if(!ic) return;
  const seg = view.prediction.segments[ic.segIndex];
  const anchor = anchors[ic.segIndex];
  if(!seg || !anchor) return;
  const p = chart.toScreen(add(anchor, ic.r));
  if(p[0] < -80 || p[1] < -40 || p[0] > chart.width + 80 || p[1] > chart.height + 40) return;
  /* An encounter is the low point of the leg that falls into the world, so the
     apsis mark is already on this pixel — and that one carries the altitude,
     which is the number a pilot lining up an aerobrake is reading. The
     crosshair stands down rather than covering it, and is left for the case it
     is the only mark there: a leg cut short by a burn before it ever reaches
     its low point. */
  const box = [p[0] - 10, p[1] - 10, p[0] + 10, p[1] + 10];
  if((taken ?? []).some(b => boxesOverlap(box, b))) return;
  const colour = ic.grazes ? PALETTE.crash : afterBurnAt(ic.segIndex) ? PALETTE.pathPlan : PALETTE.apsis;
  ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = 1.5;
  // Crosshair on a ring, which is not a shape any other mark on this chart uses.
  ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p[0] - 10, p[1]); ctx.lineTo(p[0] - 3, p[1]);
  ctx.moveTo(p[0] + 3, p[1]); ctx.lineTo(p[0] + 10, p[1]);
  ctx.moveTo(p[0], p[1] - 10); ctx.lineTo(p[0], p[1] - 3);
  ctx.moveTo(p[0], p[1] + 3); ctx.lineTo(p[0], p[1] + 10);
  ctx.stroke();
  /* No text here. At the zoom this is usually seen at, the nearest pass, the
     way out and the moon's own name land on the same twenty pixels; the
     numbers live in the encounter window instead, where there is room. */
}

/* The same short lead-and-arrowhead every world wears on its rail, on the
 * ship's own path. The nose already points the right way, but a nose is a
 * shape and the arrow is a mark: at the zooms where a parking orbit is a
 * circle of grey the two read very differently, and "which way am I going
 * round" is the question the whole game is asked in. Built from the ship's
 * own state rather than from the drawn road, so it is the same arithmetic the
 * rails use and it exists before any road has been solved. */
function shipLead(chart, view, pos){
  const zoom = chart.camera.zoom;
  if(!view.shipAbs || view.docked) return null;
  const parent = view.shipBody && pos.has(view.shipBody) ? pos.get(view.shipBody) : null;
  const mu = view.shipBody ? (chart.world.get(view.shipBody)?.mu ?? 0) : 0;
  if(!(mu > 0) || !parent) return null;
  const rLocal = sub(view.shipAbs.r, parent.r);
  const vLocal = view.shipLocalV ?? sub(view.shipAbs.v, parent.v);
  const pxPerDay = norm(vLocal) * zoom;
  if(!(pxPerDay > 0)) return null;
  const clear = 17, length = 20, N = 6;   // start outside the ship's own halo
  const arc = [];
  for(let i = 0; i <= N; i++){
    const st = propagate(mu, rLocal, vLocal, (clear + (length * i) / N) / pxPerDay);
    arc.push(chart.toScreen(add(parent.r, st.r)));
  }
  const end = propagate(mu, rLocal, vLocal, (clear + length) / pxPerDay);
  return { arc, head: arc[N], angle: Math.atan2(-end.v[1], end.v[0]) };
}

function drawShip(chart, view, pos){
  const { ctx } = chart;
  if(!view.shipAbs) return;
  const p = chart.toScreen(view.shipAbs.r);
  /* The nose points along the road that is drawn, which is the ship's motion
     in the frame of the world it is going round — not its absolute velocity.
     In a parking orbit those differ by ninety degrees or more, because most
     of the absolute speed is the planet's own trip round the Lamp, and an
     arrow pointing across its own orbit reads as a bug. */
  const dir = unit(view.shipLocalV ?? view.shipAbs.v);
  const ang = Math.atan2(-dir[1], dir[0]);
  ctx.save();
  ctx.translate(p[0], p[1]);
  ctx.rotate(ang);
  if(!drawSprite(ctx, 'ship', 0, 0, 18)){
    ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(-6, 5.5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5.5); ctx.closePath();
    ctx.fillStyle = PALETTE.ship; ctx.fill();
    ctx.strokeStyle = PALETTE.shipEdge; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.restore();
  /* A faint halo, so the ship is findable at a glance against a field of
     stars that are the same colour and nearly the same size. */
  ctx.strokeStyle = PALETTE.shipHalo; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(p[0], p[1], 15, 0, Math.PI * 2); ctx.stroke();
  if(view.docked){
    ctx.strokeStyle = PALETTE.zone; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p[0], p[1], 12, 0, Math.PI * 2); ctx.stroke();
  }
  const lead = pos ? shipLead(chart, view, pos) : null;
  if(lead){
    ctx.strokeStyle = PALETTE.ship; ctx.lineWidth = 1.5;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.beginPath();
    lead.arc.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]));
    ctx.stroke();
    const [hx, hy] = lead.head, a = lead.angle;
    ctx.beginPath();
    ctx.moveTo(hx - 5 * Math.cos(a - 0.6), hy - 5 * Math.sin(a - 0.6));
    ctx.lineTo(hx, hy);
    ctx.lineTo(hx - 5 * Math.cos(a + 0.6), hy - 5 * Math.sin(a + 0.6));
    ctx.stroke();
    ctx.lineJoin = ctx.lineCap = 'butt';
  }
}

/* The point that was just tapped, while the card asking what to do with it
 * is open. Two lines can run a few pixels apart on this chart — the road you
 * are on and the one a burn would put you on — and the card that opens says
 * a time, not a place. Both testers wanted to see which line they had hit
 * before they pressed anything on it. So: a ring on the road at that moment,
 * breathing so it is not mistaken for a mark already written down, and it
 * goes when the card does. */
function drawTapMark(chart, view, pos, anchors){
  const { ctx } = chart;
  const m = view.tapMark;
  if(!m || !pos.has(m.body)) return;
  const p = chart.toScreen(add(anchorAt(anchors, m, pos), m.r));
  const breath = chart.reducedMotion ? 0 : Math.sin((view.now ?? 0) / 180);
  ctx.strokeStyle = PALETTE.pathNow; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(p[0], p[1], 9 + 2 * breath, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = PALETTE.pathNow;
  ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, Math.PI * 2); ctx.fill();
}

/* Maneuver nodes. A flame on the road at the moment the burn fires — the
 * engine lit, which is what a burn is — named "Burn 1", "Burn 2" while it is
 * closed; when it is open, four arrows around it and a cross beside it. That
 * is the whole editor — no panel, no card over the sky, nothing to cover a
 * phone. The arrows are buttons: one tap is one press, and holding one
 * repeats. They are drawn in pixels, so they are the same size to hit at any
 * zoom, each sits on a disc so it reads as a thing to press, and the hit
 * radius is bigger than the glyph.
 */
const HANDLE_OFFSET = 54;
const NODE_HIT = 26;
/* How near a tap on the road or a rail has to land to a burn to be taken as
 * a tap on the burn: a finger going for the flame that lands on the line it
 * sits on should open the burn, not plan another one on top of it. */
export const NODE_SNAP = 44;

/* A flame, tip up, drawn about (0, 0) at scale `s`. */
function flamePath(ctx, s){
  ctx.beginPath();
  ctx.moveTo(0, -13 * s);
  ctx.bezierCurveTo(4 * s, -8 * s, 9 * s, -3 * s, 8 * s, 4 * s);
  ctx.bezierCurveTo(7 * s, 10 * s, -7 * s, 10 * s, -8 * s, 4 * s);
  ctx.bezierCurveTo(-9 * s, -3 * s, -4 * s, -8 * s, 0, -13 * s);
  ctx.closePath();
}
function drawFlame(ctx, x, y, s, selected){
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = PALETTE.flame;
  flamePath(ctx, s); ctx.fill();
  ctx.strokeStyle = selected ? '#fff' : PALETTE.node; ctx.lineWidth = selected ? 2 : 1.25;
  ctx.stroke();
  // The hot core.
  ctx.fillStyle = PALETTE.node;
  ctx.translate(0, 3 * s);
  flamePath(ctx, s * 0.5); ctx.fill();
  ctx.restore();
}

function drawNodes(chart, view, pos, anchors){
  const { ctx } = chart;
  const nodes = view.nodes;
  for(let i = 0; i < nodes.length; i++){
    const n = nodes[i];
    const where = view.nodePositions?.[i];
    if(!where || !pos.has(where.body)) continue;
    const p = chart.toScreen(add(anchorAt(anchors, where, pos), where.r));
    const selected = view.selectedNode === i;
    if(selected){
      ctx.strokeStyle = PALETTE.node; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p[0], p[1], 20, 0, Math.PI * 2); ctx.stroke();
    }
    drawFlame(ctx, p[0], p[1], selected ? 1.25 : 1, selected);
    chart.hits.nodes.push({ index: i, x: p[0], y: p[1], r: NODE_HIT });
    if(!selected){
      // Its name, so two burns on one road can be told apart and talked about.
      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = PALETTE.node;
      ctx.fillText(`Burn ${i + 1}`, p[0] + 13, p[1] + 5);
      continue;
    }

    /* The same frame the burn is actually flown in — forward along the
       velocity, out square across it — rather than forward along the velocity
       and out along the position vector, which is where these arrows used to
       point. Those two agree on a circle and nowhere else, so the legend drew
       a right angle at Tassel's docking orbit and an obviously wrong one the
       moment a ship arrived on anything eccentric. A legend that disagrees
       with the buttons it is a legend for is worse than no legend. */
    const { pro: proW, out: outW } = burnFrame(where.r, where.v);
    const pro = [proW[0], -proW[1]];            // screen y is down
    const radS = [outW[0], -outW[1]];
    const arrows = [
      ['pro',   pro,                   PALETTE.prograde,   n.prograde],
      ['retro', [-pro[0], -pro[1]],    PALETTE.retrograde, -n.prograde],
      ['out',   radS,                  PALETTE.radial,     n.radial],
      ['in',    [-radS[0], -radS[1]],  PALETTE.radial,     -n.radial],
    ];
    for(const [axis, d, colour, amount] of arrows){
      const h = [p[0] + d[0] * HANDLE_OFFSET, p[1] + d[1] * HANDLE_OFFSET];
      const lit = amount > 1e-12;
      ctx.globalAlpha = lit ? 1 : 0.7;
      // The stem, from the ring out to the button.
      ctx.strokeStyle = colour; ctx.lineWidth = lit ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(p[0] + d[0] * 24, p[1] + d[1] * 24); ctx.lineTo(p[0] + d[0] * (HANDLE_OFFSET - 18), p[1] + d[1] * (HANDLE_OFFSET - 18)); ctx.stroke();
      // The button: a disc, brighter when the axis is in use, with the arrow on it.
      ctx.fillStyle = colour; ctx.globalAlpha = lit ? 0.35 : 0.18;
      ctx.beginPath(); ctx.arc(h[0], h[1], 19, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = lit ? 1 : 0.85;
      ctx.strokeStyle = colour; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(h[0], h[1], 19, 0, Math.PI * 2); ctx.stroke();
      ctx.save(); ctx.translate(h[0], h[1]); ctx.rotate(Math.atan2(d[1], d[0]));
      ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-7, 9); ctx.lineTo(-3, 0); ctx.lineTo(-7, -9); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      chart.hits.handles.push({ index: i, axis, x: h[0], y: h[1], r: 30 });
    }

    /* Scrap it: a cross beside the flame, set far enough out that a thumb
       going for the flame or an arrow cannot catch it. */
    const x = [p[0] + 58, p[1] - 58];
    ctx.fillStyle = PALETTE.crash; ctx.globalAlpha = 0.18;
    ctx.beginPath(); ctx.arc(x[0], x[1], 14, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = PALETTE.crash; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x[0], x[1], 14, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x[0] - 5, x[1] - 5); ctx.lineTo(x[0] + 5, x[1] + 5);
    ctx.moveTo(x[0] + 5, x[1] - 5); ctx.lineTo(x[0] - 5, x[1] + 5);
    ctx.stroke();
    chart.hits.handles.push({ index: i, axis: 'delete', x: x[0], y: x[1], r: 24 });

    // What it costs, in a word, where the eye already is.
    if(view.nodeLabel){
      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = PALETTE.node;
      ctx.fillText(`Burn ${i + 1} · ${view.nodeLabel}`, p[0] + 24, p[1] + HANDLE_OFFSET + 34);
    }
  }
}

/* ------------------------------------------------------- the encounter */

/* A moon's whole sphere of influence is thirty thousand kilometres across and
 * the orbit you plan it from is a hundred thousand: at the zoom that shows
 * you the road, the entire encounter is ten pixels, and ten pixels is not a
 * thing anybody can aim. Zooming to it is no answer either — you would lose
 * the road you are steering, and the zoom is the player's to set.
 *
 * So the encounter gets its own small window in the corner, at its own scale,
 * drawn in the moon's frame where the geometry is simple: the moon, its
 * reach, its harbour mouth, the road through it, the door in, the door out,
 * and the nearest pass. The main chart keeps doing what it was doing. Tap the
 * window and the main chart goes there.
 */
const INSET = 208;
function drawEncounterInset(chart, view){
  const { ctx, world } = chart;
  const ic = view.prediction.intercept;
  chart.hits.inset = null;
  if(!ic) return;
  const b = world.get(ic.body);
  if(!b) return;
  const legs = view.prediction.segments.filter(sg => sg.body === ic.body);
  if(!legs.length) return;

  const ins = chart.labelInsets;
  const size = Math.min(INSET, chart.width - ins.left - ins.right - 24, chart.height * 0.34);
  if(size < 90) return;                       // no room: the numbers are in the panel anyway
  const x0 = ins.left + 12, y0 = ins.top + 10;
  const cx = x0 + size / 2, cy = y0 + size / 2;
  chart.hits.inset = { x: x0, y: y0, w: size, h: size, body: ic.body };

  // What has to fit: the reach, and whatever of the road runs inside it.
  let span = b.soi ?? norm(ic.r) * 2;
  for(const leg of legs) for(const pt of leg.points) span = Math.max(span, Math.hypot(pt[0], pt[1]));
  const k = (size * 0.42) / (span * 1.06);
  const P = p => [cx + p[0] * k, cy - p[1] * k];

  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x0, y0, size, size, 12);
  ctx.fillStyle = 'rgba(8,10,16,0.78)'; ctx.fill();
  ctx.strokeStyle = PALETTE.pathPlan; ctx.lineWidth = 1; ctx.stroke();
  ctx.clip();

  // The reach, the mouth, the moon.
  if(b.soi){
    ctx.strokeStyle = PALETTE.soiEdge; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(cx, cy, b.soi * k, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  if(b.zoneRadius){
    ctx.strokeStyle = PALETTE.zone; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(2, b.zoneRadius * k), 0, Math.PI * 2); ctx.stroke();
  }
  const br = Math.max(3, (b.radius ?? 0) * k);
  if(!drawSprite(ctx, b.id, cx, cy, Math.max(9, br * 2.4))){
    ctx.fillStyle = bodyColour(b);
    ctx.beginPath(); ctx.arc(cx, cy, br, 0, Math.PI * 2); ctx.fill();
  }

  // The road through it, and the doors at each end of each leg.
  ctx.strokeStyle = PALETTE.pathPlan; ctx.lineWidth = 1.75;
  for(const leg of legs){
    ctx.beginPath();
    leg.points.forEach((pt, i) => { const q = P(pt); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
    ctx.stroke();
  }
  const first = legs[0], last = legs[legs.length - 1];
  for(const [pt, kind] of [[first.r0, 'in'], [last.r1, 'out']]){
    const q = P(pt);
    ctx.strokeStyle = PALETTE.crossing; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, Math.PI * 2); ctx.stroke();
    void kind;
  }

  // The nearest pass.
  const q = P(ic.r);
  ctx.strokeStyle = ic.grazes ? PALETTE.crash : PALETTE.apsis; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(q[0] - 9, q[1]); ctx.lineTo(q[0] - 2, q[1]);
  ctx.moveTo(q[0] + 2, q[1]); ctx.lineTo(q[0] + 9, q[1]);
  ctx.moveTo(q[0], q[1] - 9); ctx.lineTo(q[0], q[1] - 2);
  ctx.moveTo(q[0], q[1] + 2); ctx.lineTo(q[0], q[1] + 9);
  ctx.stroke();

  // Its name at the top, its numbers along the bottom.
  ctx.fillStyle = PALETTE.text;
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(labelFor(b, chart), x0 + 9, y0 + 16);
  /* The numbers along the bottom, wrapped rather than clipped: "in the
     mouth" is the half of that line a pilot most wants to read and it was
     the half falling off the edge. */
  const lines = String(view.insetLabel ?? '').split(' · ');
  if(lines.length){
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = ic.grazes ? PALETTE.crash : ic.inMouth ? PALETTE.prograde : PALETTE.textDim;
    const rows = [];
    let row = '';
    for(const part of lines){
      const next = row ? row + ' · ' + part : part;
      if(ctx.measureText(next).width > size - 18 && row){ rows.push(row); row = part; }
      else row = next;
    }
    if(row) rows.push(row);
    rows.slice(-2).forEach((r, i, all) => ctx.fillText(r, x0 + 9, y0 + size - 9 - (all.length - 1 - i) * 12));
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r){
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
  /* The encounter window is on top of everything and is not part of the sky:
     a tap inside it is a tap on it, never on whatever it is covering. */
  const w = h.inset;
  if(w && x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return { kind: 'inset', id: w.body };
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

/* The nearest burn to a screen point, if one is within `within` pixels. A
 * tap that misses the flame but lands on the road or rail it sits on means
 * the flame, not a new burn on top of it. */
function nearestNode(chart, x, y, within = NODE_SNAP){
  let best = null;
  for(const n of chart.hits.nodes){
    const d = Math.hypot(n.x - x, n.y - y);
    if(d <= within && (!best || d < best.d)) best = { index: n.index, d };
  }
  return best;
}

/* Nearest point on the drawn path to a screen point, with the time it stands
 * for, so a click on the path can become a node at that moment. Linear
 * interpolation along the polyline is fine: the node then snaps to the
 * exact conic when the plan is rebuilt. */
/* Every point the chart draws is a point you can tap: there are no dead
 * stretches of road. How far a tap can take you is settled by what is drawn,
 * and each drawn section of a closed orbit is one cycle — so a tap is never
 * more than a cycle along the section it lands on. */
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
      const t = seg.times[i - 1] + u * (seg.times[i] - seg.times[i - 1]);
      /* Two roads can lie a few pixels apart on the same screen — the one you
         are flying and the one a burn would put you on, drawn round the same
         little moon and separated by the width of the burn. A tap that could
         mean either means the nearer one *in time*: "that point ahead of me"
         is the road under the ship, and picking the other one warped a player
         four laps into their own future for a tap they read as one. A tap
         plainly on the other road still reaches it. */
      const TIE = 6;
      if(!best || d < best.d - TIE || (d < best.d + TIE && t < best.t)){
        best = { d: Math.min(d, best?.d ?? d), t, seg, x: px, y: py };
      }
    }
  }
  if(!best || best.d > 18 || best.t <= (tNow ?? -Infinity)) return null;
  return best;
}

/* Where a dragged mark goes: the time under the pointer, kept on the lap the
 * mark was on, kept between its neighbours, and never further from where it
 * was than half a lap in one move.
 *
 * That last rule is the fix for a bug two playtesters found inside ten
 * minutes. Once a burn is pushed out to a moon, the yellow road it makes is
 * a long ellipse that comes back to the very place the mark sits — so the
 * pixels just behind the mark belong to two legs at once: the white orbit
 * you are on, a few minutes ahead, and the yellow ellipse's return, one
 * whole transfer later. A finger a few pixels off the white line picked the
 * yellow one, and a drag meant as "a little earlier" put the burn twenty-one
 * laps into the future. The ship then dutifully went round twenty-one times
 * waiting for it. A drag is continuous; a mark that has moved further than
 * half of its own orbit in one pointer event has not been dragged there, it
 * has been misread, so the move is refused and the mark stays put. */
function dragNodeTime(chart, x, y, prediction, tNow, nodes, index){
  const p = nearestPathPoint(chart, x, y, prediction, tNow);
  if(!p) return null;
  const n = nodes[index];
  if(!n) return null;
  const later = nodes.find((o, i) => i !== index && o.t > n.t);
  const earlier = [...nodes].reverse().find(o => nodes.indexOf(o) !== index && o.t < n.t);
  let t = p.t;
  /* The chart draws one lap of a leg however many it holds, so the times
     under the pointer only ever span that lap. A mark three laps along would
     otherwise snap back to the first, where it fires at once and vanishes —
     so put it back on the lap it was on. */
  const P = p.seg?.elements?.period;
  if(p.seg?.lapped && Number.isFinite(P) && P > 0) t += Math.round((n.t - t) / P) * P;
  /* The orbit the mark is on: the leg that ends at it, which is the road it
     is being dragged along. Half of that lap is as far as one move may go;
     a leg with no lap (an escape) allows its own length. */
  const own = prediction.segments.find(sg => n.t >= sg.t0 - 1e-9 && n.t <= sg.t1 + 1e-9) ?? prediction.segments[0];
  const ownP = own?.elements?.period;
  const reach = Number.isFinite(ownP) && ownP > 0 ? ownP * 0.5 : own ? Math.max(1e-6, own.t1 - own.t0) : Infinity;
  if(Math.abs(t - n.t) > reach) return null;
  if(later) t = Math.min(t, later.t - 1e-3);
  if(earlier) t = Math.max(t, earlier.t + 1e-3);
  return Math.max(tNow + 1e-3, t);
}

/* Nearest point on a world's rail to a screen point, and the moment that
 * world is next there. Everything else on this chart answers "where will I
 * be"; this is the other half of a transfer — "when is *it* there" — and the
 * answer is a time you can hand straight to the clock.
 *
 * Walked as a polyline in time rather than solved in closed form. Sampling by
 * time is what makes the answer a time at all: no inverting Kepler, and the
 * samples agree with where the body is actually drawn because they come from
 * the same function that draws it. One lap from now, so the time that comes
 * back is always the next time round and never one already gone. */
const RAIL_SAMPLES = 180;
function nearestRailPoint(chart, x, y, tNow){
  let best = null;
  for(const rail of chart.hits.rails){
    const n = meanMotion(rail.mu, rail.el.a);
    if(!Number.isFinite(n) || n <= 0) continue;
    const period = 2 * Math.PI / n;
    let prev = null, prevT = 0;
    for(let i = 0; i <= RAIL_SAMPLES; i++){
      const t = tNow + (i / RAIL_SAMPLES) * period;
      const here = chart.toScreen(add(rail.centre, railState(rail.el, rail.mu, t).r));
      if(prev){
        const abx = here[0] - prev[0], aby = here[1] - prev[1];
        const len2 = abx * abx + aby * aby || 1e-9;
        const u = Math.max(0, Math.min(1, ((x - prev[0]) * abx + (y - prev[1]) * aby) / len2));
        const px = prev[0] + u * abx, py = prev[1] + u * aby;
        const d = Math.hypot(px - x, py - y);
        if(!best || d < best.d) best = { kind: 'rail', id: rail.id, d, t: prevT + u * (t - prevT), x: px, y: py };
      }
      prev = here; prevT = t;
    }
  }
  /* Tighter than the road's eighteen. The road is the thing a player is
     aiming at and there is one of it; rails are scenery and there are
     fifteen, so a rail has to be tapped rather than merely tapped near. */
  if(!best || best.d > 12) return null;
  return best;
}

/* Where the drawn road cuts across the rail of a world going round the same
 * thing, and where that world will be when it does.
 *
 * The road is a conic in the parent's frame and a rail is an ellipse in the
 * same frame, so a crossing is where the ship's distance from the focus meets
 * the rail's distance at that same bearing. Walk the leg's own sample points
 * watching that difference change sign, then bisect on the real conic — the
 * samples say which pair of moments to look between, and the bisection says
 * exactly when. */
function railRadiusAt(el, th){
  const { a, e = 0, omega = 0, retrograde } = el;
  if(!e) return a;
  /* A retrograde rail is the same ellipse mirrored in y, so its radius at a
     bearing is the unmirrored radius at the opposite bearing. */
  return a * (1 - e * e) / (1 + e * Math.cos((retrograde ? -th : th) - omega));
}
export function railCrossings(world, prediction, tNow, opts = {}){
  /* `minLead` is what keeps the ship's own doorstep off the chart. A ship
     that has just left Tassel is sitting exactly on Tassel's rail, so the
     first sample is a crossing at t = now — true, useless, and drawn right
     on top of the ship. */
  /* One, unless a caller asks for more. A road that cuts five rails twice
     over earns ten honest pairs of diamonds and becomes unreadable; the rest
     of this chart already refuses to draw past the first thing that happens,
     and this is the same refusal. */
  const { limit = 1, minLead = 0 } = opts;
  const out = [];
  if(!prediction?.segments) return out;
  for(let si = 0; si < prediction.segments.length; si++){
    const seg = prediction.segments[si];
    const parent = world.get(seg.body);
    const pts = seg.points, times = seg.times;
    if(!parent || !pts || pts.length < 2 || !times) continue;
    const mu = parent.mu;
    for(const b of world.bodies){
      if(b.parent !== seg.body || !(b.a > 0)) continue;
      const gap = r => norm(r) - railRadiusAt(b, Math.atan2(r[1], r[0]));
      const at = t => gap(propagate(mu, seg.r0, seg.v0, t - seg.t0).r);
      const gaps = pts.map(gap);
      for(let i = 1; i < pts.length; i++){
        const crossed = (gaps[i - 1] < 0) !== (gaps[i] < 0);
        /* A transfer that *touches* a rail rather than cutting it is the whole
           point of a Hohmann: the apsis grazes the orbit being aimed at and
           turns back. There is no change of sign to find at a tangent, so a
           genuine local minimum of the gap counts too — but only when the road
           really does reach the rail, within a millionth of its radius. Looser
           than that and a road merely heading the right way gets a mark, which
           is how a pass a hundred thousand kilometres short of Cinder's orbit
           came to be labelled as being on it. */
        const dip = !crossed && i + 1 < pts.length
          && Math.abs(gaps[i]) < Math.abs(gaps[i - 1]) && Math.abs(gaps[i]) <= Math.abs(gaps[i + 1]);
        if(!crossed && !dip) continue;
        let t;
        if(crossed){
          let lo = times[i - 1], hi = times[i];
          const loInside = at(lo) < 0;
          for(let k = 0; k < 40; k++){
            const mid = (lo + hi) / 2;
            if((at(mid) < 0) === loInside) lo = mid; else hi = mid;
          }
          t = (lo + hi) / 2;
        }else{
          // No sign to chase: close in on the smallest gap there is.
          let lo = times[i - 1], hi = times[i + 1];
          const phi = (Math.sqrt(5) - 1) / 2;
          let x = hi - phi * (hi - lo), y = lo + phi * (hi - lo);
          let fx = Math.abs(at(x)), fy = Math.abs(at(y));
          for(let k = 0; k < 60 && hi - lo > 1e-9; k++){
            if(fx < fy){ hi = y; y = x; fy = fx; x = hi - phi * (hi - lo); fx = Math.abs(at(x)); }
            else{ lo = x; x = y; fx = fy; y = lo + phi * (hi - lo); fy = Math.abs(at(y)); }
          }
          t = (lo + hi) / 2;
          const here = propagate(mu, seg.r0, seg.v0, t - seg.t0).r;
          if(Math.abs(gap(here)) > railRadiusAt(b, Math.atan2(here[1], here[0])) * 1e-6) continue;
        }
        if(t <= tNow + minLead) continue;
        // One mark per touch, however many samples noticed it.
        if(out.some(c => c.body === b.id && Math.abs(c.t - t) < 1e-3)) continue;
        out.push({
          segIndex: si, body: b.id, t,
          r: propagate(mu, seg.r0, seg.v0, t - seg.t0).r,
          ghost: railState(b, mu, t).r,
        });
        // A guard against a pathological road, not the limit the caller asked for.
        if(out.length >= 64) break;
      }
    }
  }
  /* Soonest first, so the one that survives the cap is the one you are about
     to fly. */
  return out.sort((a, b) => a.t - b.t).slice(0, limit);
}

/* Where a node sits on the plan: the ship's state at the node's time in the
 * frame it will be in. Computed from the prediction so it agrees with the path. */
/* `segIndex` comes back with it, because which leg a moment falls on is what
 * decides where on the screen it is drawn — a leg in a moon's frame is pinned
 * to where the moon will be, not to where it is. See pathAnchors. */
export function locateOnPrediction(world, prediction, t){
  for(let i = 0; i < prediction.segments.length; i++){
    const seg = prediction.segments[i];
    if(t >= seg.t0 - 1e-9 && t <= seg.t1 + 1e-9){
      const mu = world.get(seg.body).mu;
      const s = propagate(mu, seg.r0, seg.v0, t - seg.t0);
      return { body: seg.body, r: s.r, v: s.v, segIndex: i };
    }
  }
  return null;
}

export { railState, norm, sub, scale, perp };
