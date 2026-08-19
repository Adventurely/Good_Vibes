/* Spell pages, and how much of everything a map spawns. */

import { classById } from './lookups.js';


/* The Wizard's resource. One kind, not a table: pages are pages, and what
 * varies is how many a cache holds. They spawn on the map like herbs do —
 * something worth walking to — and each fireball burns one from the shared
 * pool. The party carries the library; only the Wizard can read it.
 */
export const PAGES = {
  name: 'Spell pages',
  colour: 'w',
  note: 'Paper that survived the rain because somebody meant it to. The ink still moves.',
};

/* How much of everything a build map puts out. Salvage caches on the ground
   are the small change — crates the blight has not digested yet — while the
   after-combat payout stays the Engineer's real income. Pages are scarce on
   purpose: every fireball is a page the Wizard chose to burn. */
/* Herbs are deliberately scarce, and exactly one of each material.
 *
 * There is no move budget — a player can walk anywhere on the site and pick up
 * everything on it — so the limit on how much the Alchemist can brew has to be
 * how much grew, not how far she can walk.
 *
 * One node per material makes both halves of that structural rather than
 * lucky. Every recipe is always *possible*, because nothing is ever missing;
 * and no sweep ever pays for all three, because at two units a node the ten
 * units on a site cannot cover the eleven that one of each costs. The decision
 * is which two you walk to, not which two the dice left you.
 */
export const SPAWNS = { herbs: 5, salvage: 5, pages: 1 };

/* What one walked-to cache yields. Rolled sizes would make gathering a
   lottery; fixed sizes make the map readable — a player can count what a
   trip is worth before spending the rounds to make it. */
export const CACHE_YIELD = { salvage: 2, pages: 1 };

/* What a site puts out with this particular party standing on it.
 *
 * SPAWNS itself is untouched, so every caller and every test that reads it
 * directly still reads the same numbers; this is the party-aware wrapper the
 * room uses.
 *
 * Salvage and pages only — never herbs. The herb count is the one number the
 * whole scarcity design rests on: five nodes at two units each is ten against
 * the eleven that one of each recipe costs, so a full sweep can never pay for
 * everything. A sixth node would quietly delete that, and a test pins it.
 */
export function spawnsFor(players){
  const extra = (players || []).reduce(
    (n, p) => n + ((classById(p.classId) || {}).scout || 0), 0);
  return { ...SPAWNS, salvage: SPAWNS.salvage + extra, pages: SPAWNS.pages + extra };
}
