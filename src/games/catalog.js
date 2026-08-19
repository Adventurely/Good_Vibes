/* Every game this build ships with.
 *
 * One import and one register() per game. This is the only file that knows
 * which games exist; everything else asks the registry. */

import { register } from './registry.js';
import goodVibes from '../../games/good-vibes/game.js';

register(goodVibes);

export { games, gameById, describe } from './registry.js';
