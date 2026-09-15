/* Duck Duck Quack — the park, drawn.
 *
 * One entry point, `paintScene`, called by the game page every frame and by
 * the title screen for its own backdrop. It takes the whole picture as
 * arguments and reads nothing from anywhere else, the same rule the other
 * single-player games here follow: the card on the shelf and the title
 * screen behind it are this scene running, not a screenshot of it.
 *
 * The palette and the pixel font are the shared ones from Good Vibes rather
 * than a copy — this game ships in the same deploy, so there is no reason for
 * a second copy of sixteen hex values to drift out of step with the first.
 */

import { PALETTE, hex, drawSprite, drawTextOutlined } from '../good-vibes/pixel.js';
import { SCENE_W, SCENE_H } from './content.js';

export { PALETTE, hex };

/* ------------------------------------------------------------------ sprites */

/* Facing right. `flip` mirrors it for a duckling walking the other way. */
export const DUCK_ART = [
  '..yyy.',
  '.yyyyk',
  '.yyyyo',
  '..yyy.',
  '..o.o.',
];

export const GOOSE_ART = [
  '..www...',
  '.wwwww..',
  'wwwwwwk.',
  'wwwwwwo.',
  '.wwwww..',
  '..s..s..',
];

/* A duckling standing still with a skill in hand gets a small mark over its
   head, so a busy one reads as busy at a glance rather than only on click. */
const SKILL_MARK = { digger: 'N', builder: 'o', blocker: 's', climber: 'c' };

/* -------------------------------------------------------------------- sky */

export function drawSky(ctx){
  ctx.fillStyle = hex('c');
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  // A pale band toward the horizon, and a sun sitting low in the corner —
  // cheap enough to redraw every frame, which the ground and the pond are not.
  ctx.fillStyle = hex('w');
  for(let y = 0; y < 40; y++){
    if((y & 1) === 0) continue;
    ctx.fillRect(0, y + 100, SCENE_W, 1);
  }
  // Low enough, and clear of the right edge, that the HUD's own text — drawn
  // over this same corner — never sits on top of it. The HUD is sized in CSS
  // pixels and does not shrink with the canvas, so the margin that clears it
  // at a 2x scene is not automatically enough at 1x, where the scene's own
  // pixels and the page's are the same size: the two-line "Hatched/Time"
  // block runs to about 40 scene-pixels tall even at the smallest scale, and
  // the sun needs to start below that everywhere, not just where there was
  // room to spare.
  ctx.fillStyle = hex('y');
  ctx.fillRect(SCENE_W - 30, 58, 12, 12);
}

/* ----------------------------------------------------------------- ground */

/* The terrain height array, filled solid from its surface to the bottom of
   the scene. A gap's columns sit far below SCENE_H (see content.js's PIT_Y),
   so they simply paint nothing at all — an open chasm is the absence of
   ground, not a colour of its own. */
export function drawGround(ctx, terrain, level){
  for(let x = 0; x < terrain.length; x++){
    const y = terrain[x];
    if(y >= SCENE_H) continue;
    const inPond = x >= level.goalX;
    ctx.fillStyle = hex(inPond ? 'b' : 'g');
    ctx.fillRect(x, y, 1, SCENE_H - y);
    // A darker cap on the top couple of rows, so a wall's cut face reads as
    // an edge rather than as flat colour meeting the sky.
    ctx.fillStyle = hex(inPond ? 'c' : 'G');
    ctx.fillRect(x, y, 1, 2);
  }
  drawNest(ctx, level, terrain);
}

function drawNest(ctx, level, terrain){
  const x = level.nestX;
  const y = terrain[x];
  ctx.fillStyle = hex('N');
  ctx.fillRect(x - 5, y - 4, 11, 4);
  ctx.fillStyle = hex('n');
  ctx.fillRect(x - 3, y - 6, 7, 3);
}

/* ------------------------------------------------------------------ goose */

export function drawGoose(ctx, state){
  const g = state.level.goose;
  const x = Math.round(state.goose.x) - 4;
  const y = g.y - GOOSE_ART.length;
  drawSprite(ctx, GOOSE_ART, x, y, state.goose.dir < 0);
}

/* ----------------------------------------------------------------- a duck */

export function drawDuck(ctx, d){
  const x = Math.round(d.x) - 3;
  const y = Math.round(d.y) - DUCK_ART.length;
  drawSprite(ctx, DUCK_ART, x, y, d.dir < 0);

  if(d.state === 'blocking'){
    ctx.fillStyle = hex('r');
    ctx.fillRect(x + 1, y - 3, 4, 2);
  } else if(d.skill && SKILL_MARK[d.skill] && d.state === 'walking'){
    ctx.fillStyle = hex(SKILL_MARK[d.skill]);
    ctx.fillRect(x + 2, y - 3, 2, 2);
  }
}

/* ------------------------------------------------------------------ scene */

/* The whole picture, in back-to-front order. `state` is a sim.js game state;
   nothing here mutates it. */
export function paintScene(ctx, state){
  drawSky(ctx);
  drawGround(ctx, state.terrain, state.level);
  drawGoose(ctx, state);
  for(const d of state.ducks){
    if(d.state === 'saved' || d.state === 'lost') continue;
    drawDuck(ctx, d);
  }
}

/* A caption under the title screen's demo scene, drawn with the same font as
   the game so the two never look like they belong to different pages. */
export function drawCaption(ctx, text, x, y, key = 'w'){
  drawTextOutlined(ctx, text, x, y, key, 1);
}
