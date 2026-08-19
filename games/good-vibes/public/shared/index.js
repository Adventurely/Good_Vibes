/* Good Vibes — game content.
 *
 * Everything here is data. It is imported by the authoritative room object on
 * the server and by the browser for rendering — so it must not depend on
 * anything that exists on only one side. No DOM, no storage, no clock, no
 * randomness at load time. Pure values.
 *
 * That shared-import trick is the reason the rules and the UI can never
 * disagree about what a potion does. The cost is that a throw at the top level
 * of any of these modules takes the whole game down, so they stay declarative:
 * no computation outside the helpers, and test/content.test.js checks the
 * shape before any of it can ship.
 *
 * This file is the seam the rest of the codebase imports. The rules themselves
 * live in the modules below, which are laid out so the dependency graph runs
 * one way — leaves first, and nothing imports something that imports it back:
 *
 *   party grid rng effects materials buildings classes phases cards spellcraft
 *     └── record ── enemies
 *     └── lookups ── pages
 *                      └── rules ── worldgen
 *                      └── garden
 */

export * from './party.js';
export * from './materials.js';
export * from './pages.js';
export * from './effects.js';
export * from './record.js';
export * from './buildings.js';
export * from './classes.js';
export * from './phases.js';
export * from './cards.js';
export * from './rules.js';
export * from './garden.js';
export * from './spellcraft.js';
export * from './enemies.js';
export * from './lookups.js';
export * from './grid.js';
export * from './rng.js';
export * from './worldgen.js';
