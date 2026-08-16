/* Good Vibes — what a resolved effect looks and sounds like.
 *
 * The room decides what happened; this decides how it reads. It is a module of
 * its own rather than a block inside play.html for the same reason content.js
 * is: the client and a test both need to ask it the same question, and a table
 * only the page can see is a table only the page can be wrong about.
 *
 * An fx event names a **card** when a card caused it (`fireball`, `greenfire`)
 * and an **effect kind** when nothing did (`hit`, and the ward and heal the
 * room emits by verb). Both tables here are read card-first, kind-second.
 *
 * The fallback is the point. Keyed on cards alone, every card added from here
 * on resolves in silence with nothing on screen until somebody remembers to
 * write it a row — Greenfire spent a release in exactly that state. Falling
 * back to the verb means a new strike-kind card jabs and cracks the way Strike
 * does on the day it is written, and a row below is an exception rather than a
 * chore. `soundFor` and `styleFor` are what the page calls; keep them the only
 * way in, so there is one answer to "what does this do on screen".
 *
 * No DOM and no audio context: the palette comes in as an argument, because
 * art.js is the client's and this file should stay testable in Node.
 */

import { cardById } from './content.js';

/* What an fx is really doing, for when its name is a card the tables have
   never heard of. cardById is the same table the room resolved it from, so the
   verb here and the verb the room applied cannot disagree. */
export const verbOf = kind => (cardById(kind) || {}).effect?.kind || kind;

/* Cards with a look of their own, plus the verbs everything else falls back to.
 *
 * `arc` and `jagged` shape the flight — a lobbed thing rises, a crackling one
 * wobbles — and `size` is the head in pixels. Written as a factory so the
 * palette stays the client's: art.js is not something a test should have to
 * load a canvas for.
 */
export function fxStyles(PALETTE){
  return {
    fireball: { colour: PALETTE.o, trail: PALETTE.Y, size: 3, arc: true },
    spark:    { colour: PALETTE.c, trail: PALETTE.b, size: 2, jagged: true },
    boltgun:  { colour: PALETTE.m, trail: PALETTE.M, size: 2 },
    flask:    { colour: PALETTE.l, trail: PALETTE.g, size: 3, arc: true },
    wrench:   { colour: PALETTE.o, trail: PALETTE.O, size: 2 },
    greenfire:{ colour: PALETTE.l, trail: PALETTE.v, size: 3, arc: true },

    /* Strike itself, and the shape every other strike-kind card falls back to:
       a short flat jab. Deliberately the plainest entry in the table — it is
       the floor of what an attack looks like, the way the card is the floor of
       what an attack does. */
    strike:   { colour: PALETTE.m, trail: PALETTE.M, size: 2 },
  };
}

/* Cards that should not sound like their verb. Two, and both earn it: a page
   read aloud and thrown, and the pylon's charge going across. Everything else
   takes its verb's sound, which is why this table is short and should stay so. */
export const FX_SOUND = { fireball: 'fireball', spark: 'arc' };

/* The style for an fx, or null if it is not the kind of thing that flies —
   a ward, a mend, or being hit, which the client draws in place instead. */
export function styleFor(styles, kind){
  return styles[kind] || styles[verbOf(kind)] || null;
}

/* The sound for an fx. `hasSound` is audio.has, passed in so this file does not
   need an audio context to answer — and so the fallback can tell a verb with a
   sound from one without, rather than assuming every verb has one. */
export function soundFor(kind, hasSound){
  if(FX_SOUND[kind]) return FX_SOUND[kind];
  const verb = verbOf(kind);
  if(hasSound(verb)) return verb;
  return hasSound(kind) ? kind : null;
}
