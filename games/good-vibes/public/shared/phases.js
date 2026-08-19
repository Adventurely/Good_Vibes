/* Phases and rounds: the shape of a run. */


/* A cycle is: build on the map, then hold it when the blight surges.
 *
 * 'playing' is the name the room used when the run was one long gather phase,
 * and it is still accepted as a synonym for 'build' so a client newer than the
 * deployed room does not render a blank screen. Remove it once the room sends
 * 'build'.
 */
export const PHASES = {
  lobby: 'lobby',
  build: 'build',
  combat: 'combat',
  over: 'over',
};

export const isBuildPhase = phase => phase === PHASES.build || phase === 'playing';

/* Who still has to ready up before the blight arrives.
 *
 * Disconnected players are left out of both halves: a party of five should not
 * be stuck in the build phase because someone's train went into a tunnel. They
 * rejoin into whatever phase the room has moved on to.
 *
 * Returned as counts rather than a boolean because "3 of 4 ready" is what the
 * UI needs to draw, and deriving that separately is how the two ends of this
 * end up disagreeing about who they are waiting for.
 */
export function readyState(players){
  const present = (players || []).filter(p => p.connected);
  const ready = present.filter(p => p.ready);
  return { ready: ready.length, total: present.length, all: present.length > 0 && ready.length === present.length };
}


/* A run is three rounds and then the boss. Each round is one cycle: a build
 * phase on a freshly generated site — walk to what the ruin grew, brew, raise
 * structures — then a surge, where the blight comes to the party and what was
 * built is what fights back. A new site is rolled for every round of every
 * run, so no two walks are the same walk.
 */
export const ROUNDS_BEFORE_BOSS = 3;
export const BOSS_ROUND = ROUNDS_BEFORE_BOSS + 1;

export const ROUNDS = [
  { name: 'The Overgrowth', blight: 1, note: 'A stairwell the ivy took back.' },
  { name: 'Panel Fields', blight: 1, note: 'Acres of cracked glass, still tracking the sun.' },
  { name: 'The Rustlands', blight: 2, note: 'Everything orange, everything sharp.' },
  { name: 'The Array', blight: 2, note: 'Where the power went. It knows you are here.' },
];

export const roundInfo = round =>
  ROUNDS[Math.min(Math.max(1, round), ROUNDS.length) - 1];

/* The splash card the client animates at each phase change. Words, not
   layout: the client owns how it looks, this owns what it says, and the two
   sides of the wire agree because there is only one copy. */
const ORDINALS = ['One', 'Two', 'Three', 'Four', 'Five'];
export function phaseCard(round, phase){
  if(round >= BOSS_ROUND && phase === PHASES.combat){
    return { title: 'The Array Wakes', subtitle: 'Boss combat — everything you built, all at once.' };
  }
  const ordinal = ORDINALS[round - 1] || String(round);
  return phase === PHASES.build
    ? { title: `Round ${ordinal} — Build Phase`, subtitle: 'The party plans.' }
    : { title: `Round ${ordinal} — The Surge`, subtitle: 'The blight has found the site.' };
}
