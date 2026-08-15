/* The Good Vibes style system: sixteen colours, one bitmap font, and the few
 * routines that put them on a canvas.
 *
 * This is the file that keeps the game looking like one thing. Every page
 * imports the same palette and the same glyphs rather than carrying a copy, so
 * a colour can only be changed in one place — which is the only way a style
 * guide stays true once there is more than one screen.
 *
 * Everything here draws in pixel units. Scale the canvas, not the drawing:
 * see fitCanvas.
 */

/* ---------------------------------------------------------------- palette */

export const PALETTE = {
  k: ['#0d0b1f', 'ink'],
  d: ['#241a3a', 'deep violet'],
  v: ['#3b2b5a', 'violet'],
  s: ['#5a4f8c', 'slate'],
  b: ['#2b6bb0', 'blue'],
  c: ['#4fc4d3', 'cyan'],
  t: ['#7ff0d3', 'mint'],
  g: ['#3fa34d', 'grass'],
  G: ['#245f3c', 'pine'],
  y: ['#ffd34e', 'gold'],
  o: ['#f08c33', 'ember'],
  r: ['#e04b5a', 'rose'],
  p: ['#a63b6d', 'plum'],
  n: ['#f2b48c', 'skin'],
  N: ['#c07a58', 'oak'],
  w: ['#fdf6e3', 'bone'],
};

export const hex = key => PALETTE[key][0];

/* ------------------------------------------------------------------- font */

const GLYPHS = {
  A: '.###.,#...#,#...#,#####,#...#,#...#,#...#',
  B: '####.,#...#,#...#,####.,#...#,#...#,####.',
  C: '.###.,#...#,#....,#....,#....,#...#,.###.',
  D: '####.,#...#,#...#,#...#,#...#,#...#,####.',
  E: '#####,#....,#....,####.,#....,#....,#####',
  F: '#####,#....,#....,####.,#....,#....,#....',
  G: '.###.,#...#,#....,#..##,#...#,#...#,.####',
  H: '#...#,#...#,#...#,#####,#...#,#...#,#...#',
  I: '#####,..#..,..#..,..#..,..#..,..#..,#####',
  J: '..###,...#.,...#.,...#.,...#.,#..#.,.##..',
  K: '#...#,#..#.,#.#..,##...,#.#..,#..#.,#...#',
  L: '#....,#....,#....,#....,#....,#....,#####',
  M: '#...#,##.##,#.#.#,#.#.#,#...#,#...#,#...#',
  N: '#...#,##..#,#.#.#,#..##,#...#,#...#,#...#',
  O: '.###.,#...#,#...#,#...#,#...#,#...#,.###.',
  P: '####.,#...#,#...#,####.,#....,#....,#....',
  Q: '.###.,#...#,#...#,#...#,#.#.#,#..#.,.##.#',
  R: '####.,#...#,#...#,####.,#.#..,#..#.,#...#',
  S: '.####,#....,#....,.###.,....#,....#,####.',
  T: '#####,..#..,..#..,..#..,..#..,..#..,..#..',
  U: '#...#,#...#,#...#,#...#,#...#,#...#,.###.',
  V: '#...#,#...#,#...#,#...#,#...#,.#.#.,..#..',
  W: '#...#,#...#,#...#,#.#.#,#.#.#,##.##,#...#',
  X: '#...#,#...#,.#.#.,..#..,.#.#.,#...#,#...#',
  Y: '#...#,#...#,.#.#.,..#..,..#..,..#..,..#..',
  Z: '#####,....#,...#.,..#..,.#...,#....,#####',
  0: '.###.,#..##,#..##,#.#.#,##..#,##..#,.###.',
  1: '..#..,.##..,..#..,..#..,..#..,..#..,.###.',
  2: '.###.,#...#,....#,...#.,..#..,.#...,#####',
  3: '#####,...#.,..#..,...#.,....#,#...#,.###.',
  4: '...#.,..##.,.#.#.,#..#.,#####,...#.,...#.',
  5: '#####,#....,####.,....#,....#,#...#,.###.',
  6: '..##.,.#...,#....,####.,#...#,#...#,.###.',
  7: '#####,....#,...#.,..#..,.#...,.#...,.#...',
  8: '.###.,#...#,#...#,.###.,#...#,#...#,.###.',
  9: '.###.,#...#,#...#,.####,....#,...#.,.##..',
  ' ': '.....,.....,.....,.....,.....,.....,.....',
  '!': '..#..,..#..,..#..,..#..,..#..,.....,..#..',
  '.': '.....,.....,.....,.....,.....,.....,..#..',
  ',': '.....,.....,.....,.....,.....,..#..,.#...',
  "'": '..#..,..#..,.....,.....,.....,.....,.....',
  '-': '.....,.....,.....,.###.,.....,.....,.....',
  ':': '.....,..#..,.....,.....,..#..,.....,.....',
  '?': '.###.,#...#,....#,...#.,..#..,.....,..#..',
  '/': '....#,...#.,...#.,..#..,.#...,.#...,#....',
  '&': '.##..,#..#.,#..#.,.##..,#.#.#,#..#.,.##.#',
};

// Split once, at load, rather than on every glyph drawn.
export const FONT = Object.fromEntries(
  Object.entries(GLYPHS).map(([ch, rows]) => [ch, rows.split(',')]),
);

export const GLYPH_W = 5;
export const GLYPH_H = 7;
export const TRACKING = 1;

export const textWidth = (str, scale = 1) =>
  str.length * (GLYPH_W + TRACKING) * scale - TRACKING * scale;

export function drawText(ctx, str, x, y, key, scale = 1){
  ctx.fillStyle = hex(key);
  let cx = x;
  for(const raw of String(str).toUpperCase()){
    const glyph = FONT[raw] ?? FONT['?'];
    for(let r = 0; r < GLYPH_H; r++){
      for(let c = 0; c < GLYPH_W; c++){
        if(glyph[r][c] === '#') ctx.fillRect(cx + c * scale, y + r * scale, scale, scale);
      }
    }
    cx += (GLYPH_W + TRACKING) * scale;
  }
}

/* Outline in ink first, then fill. Cheap, and it keeps text readable over any
   background — which matters once text sits on top of a scene. */
export function drawTextOutlined(ctx, str, x, y, key, scale = 1){
  for(let dy = -1; dy <= 1; dy++){
    for(let dx = -1; dx <= 1; dx++){
      if(dx || dy) drawText(ctx, str, x + dx * scale, y + dy * scale, 'k', scale);
    }
  }
  drawText(ctx, str, x, y, key, scale);
}

/* ---------------------------------------------------------------- sprites */

/* A sprite is an array of equal-length strings, one character per pixel, each
   character a palette key. '.' is transparent. Authoring them as text means a
   sprite can be read and edited in the source without a tool. */
export function drawSprite(ctx, rows, x, y, flip = false){
  const w = rows[0].length;
  for(let r = 0; r < rows.length; r++){
    for(let c = 0; c < w; c++){
      const key = rows[r][flip ? w - 1 - c : c];
      if(key === '.') continue;
      ctx.fillStyle = hex(key);
      ctx.fillRect(x + c, y + r, 1, 1);
    }
  }
}

/* ---------------------------------------------------------------- scaling */

/* Whole-number scaling only. At 2.5x some pixels land on two screen pixels and
   others on three, and the result reads as a rendering fault rather than as a
   style. Returns the scale actually used. */
export function fitCanvas(canvas, W, H, { container, maxHeightFraction = 0.72 } = {}){
  const available = (container || canvas.parentElement || document.body).clientWidth;
  const byWidth = Math.floor(available / W);
  const byHeight = Math.floor((window.innerHeight * maxHeightFraction) / H);
  const scale = Math.max(1, Math.min(byWidth, byHeight));
  canvas.style.width = `${W * scale}px`;
  canvas.style.height = `${H * scale}px`;
  return scale;
}

/* A context set up the way every canvas here wants it: no smoothing, because
   the browser's idea of a scaled pixel is a blurred one. */
export function context2d(canvas){
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
  return ctx;
}
