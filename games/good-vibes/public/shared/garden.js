/* The Herbalist's pots. */

import { MATERIALS } from './materials.js';


/* Three pots by the campfire, and the Alchemist's reason to think past the
 * round in front of her. A cutting planted this round is worth nothing yet;
 * left alone it doubles, then doubles the doubling — so every build phase
 * asks the same quiet question of each pot: brew it this fight, or let it
 * grow toward the boss.
 *
 * The pots are the Alchemist's mirror of the site itself: they persist
 * across rounds the way the Engineer's buildings do, and they are the only
 * part of her economy that compounds.
 */
export const POT_COUNT = 3;

/* What a pot gives back, by how many rounds the cutting has sat in it.
 * Age zero — planted this very round — refunds the cutting and nothing
 * more, so replanting a misclick is free and farming a same-round loop is
 * pointless. The ladder tops out rather than climbing forever: a run is
 * four rounds long, and the top rung is the boss-round payoff.
 */
export const potYield = age =>
  age <= 0 ? 1 : [2, 4, 6][Math.min(age - 1, 2)];

/* One name per rung, for the pot card and the log. */
export const potStage = age =>
  age <= 0 ? 'sprouting' : age === 1 ? 'growing' : age === 2 ? 'flourishing' : 'in bloom';

/* Plant one cutting from the stash. Returns { pots, stash } or null when the
   pot is missing, occupied, or the stash has none of the herb — the caller
   cannot half-plant. */
export function plantPot(pots, index, herb, stash){
  if(!MATERIALS[herb]) return null;
  if(index < 0 || index >= (pots || []).length || pots[index]) return null;
  if(((stash || {})[herb] || 0) < 1) return null;
  const next = [...pots];
  next[index] = { herb, age: 0 };
  return { pots: next, stash: { ...stash, [herb]: stash[herb] - 1 } };
}

/* Pull a pot's crop into the stash. Returns { pots, stash, herb, yielded }
   or null on an empty pot. */
export function harvestPot(pots, index, stash){
  const pot = (pots || [])[index];
  if(!pot) return null;
  const next = [...pots];
  next[index] = null;
  const yielded = potYield(pot.age);
  return {
    pots: next,
    stash: { ...stash, [pot.herb]: ((stash || {})[pot.herb] || 0) + yielded },
    herb: pot.herb,
    yielded,
  };
}

/* One round older, every planted pot. Called as the build phase opens. */
export const growPots = pots =>
  (pots || []).map(pot => (pot ? { ...pot, age: pot.age + 1 } : null));
