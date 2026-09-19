/* Good Vibe Beats — the picture of it.
 *
 * There is no scene to paint: the game is four pads and a song, and what it
 * looks like when it is going well is pads lighting up in time, in the colour
 * of what each hit was worth. So that is what this draws, and the shelf card
 * and the title screen both use it — which keeps the site's rule that a card
 * shows the thing you get rather than a screenshot that goes stale.
 *
 * The groove below is one bar of Funk world, played the way the scoring wants
 * it played: a kick on the one, a backbone on two and four, hats on the "and",
 * and a kick pushed onto the "a" of three with the four left empty. Every
 * colour on the card is therefore honest — the pink one really is the hit the
 * game pays double for.
 */

export const SHOT_W = 320, SHOT_H = 190;

export const COLOURS = {
  down: '#3d5afe', up: '#0fb5a5', sync: '#e4388c', fill: '#f2a516',
};
const LIGHT = { bg: '#e9ecf1', pad: '#ffffff', ink: '#1c2230', muted: '#5d6577', line: '#d3d8e1' };
const DARK  = { bg: '#151a26', pad: '#222a3b', ink: '#eef0f5', muted: '#98a0b3', line: '#2a3246' };

/* One bar, in sixteenths: which pad, and what the scorer makes of it. */
const BAR = [
  { s: 0,  pad: 0, type: 'down' },   // kick, on the one
  { s: 2,  pad: 2, type: 'up' },     // hat on the "and"
  { s: 4,  pad: 1, type: 'down' },   // snare, the backbeat
  { s: 6,  pad: 2, type: 'up' },
  { s: 8,  pad: 0, type: 'down' },
  { s: 10, pad: 2, type: 'up' },
  { s: 11, pad: 0, type: 'sync' },   // the push onto the "a" of three
  { s: 12, pad: 1, type: 'down' },
  { s: 14, pad: 3, type: 'sync' },   // a clap where nothing was expected
  { s: 15, pad: 2, type: 'fill' },
];
const NAMES = ['Kick', 'Snare', 'Hat', 'Clap'];
const BPM = 104, STEPS = 16;
const BAR_SECONDS = STEPS * (60 / BPM) / 4;

/* How lit a pad is right now: one at the moment of the hit, fading over a
   third of a second, which is the same shape the real pads use. */
const GLOW = 0.34;

function rounded(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* `now` is milliseconds from anywhere — only the remainder matters, so the
   card can be driven off the same clock as every other card on the shelf. */
/* `labels` off for the title screen, where the plate is blown up to cover a
   desktop window: a pad name at three times its drawn size stops reading as a
   label and starts reading as a rendering fault. On the card, where the canvas
   is shown at the size it is drawn, they stay. */
export function paintShot(ctx, now, { dark = false, labels = true } = {}){
  const C = dark ? DARK : LIGHT;
  const at = (now / 1000) % BAR_SECONDS;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, SHOT_W, SHOT_H);

  /* The beat row along the top: four dots, the one under the cursor filled.
     It is the count-in, which is the only time the game shows you the grid. */
  const beat = Math.floor(at / (BAR_SECONDS / 4));
  for(let i = 0; i < 4; i++){
    ctx.fillStyle = i === beat ? C.ink : C.line;
    ctx.beginPath();
    ctx.arc(22 + i * 18, 20, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // A hairline under it, the way the play screen has one.
  ctx.fillStyle = C.line;
  ctx.fillRect(16, 34, SHOT_W - 32, 2);
  ctx.fillStyle = C.ink;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(16, 34, (SHOT_W - 32) * (at / BAR_SECONDS), 2);
  ctx.globalAlpha = 1;

  const padW = 132, padH = 60, gapX = 16, gapY = 12;
  const left = (SHOT_W - (padW * 2 + gapX)) / 2, top = 50;

  for(let i = 0; i < 4; i++){
    const x = left + (i % 2) * (padW + gapX);
    const y = top + Math.floor(i / 2) * (padH + gapY);

    /* The most recent hit on this pad, however long ago — including one from
       the bar before, so the card never opens on four dead pads. */
    let lit = 0, colour = COLOURS.down;
    for(const h of BAR){
      if(h.pad !== i) continue;
      const hitAt = h.s * BAR_SECONDS / STEPS;
      let since = at - hitAt;
      if(since < 0) since += BAR_SECONDS;
      const strength = Math.max(0, 1 - since / GLOW);
      if(strength > lit){ lit = strength; colour = COLOURS[h.type]; }
    }

    ctx.save();
    rounded(ctx, x, y, padW, padH, 12);
    ctx.fillStyle = C.pad;
    ctx.fill();
    if(lit > 0){
      // The glow is painted over the pad rather than mixed into its fill, so
      // a pad at rest is exactly the surface colour and not a washed version.
      ctx.globalAlpha = lit * 0.75;
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if(labels){
      ctx.fillStyle = lit > 0.45 ? '#ffffff' : C.muted;
      ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(NAMES[i], x + 12, y + padH - 12);
    }
  }
}
