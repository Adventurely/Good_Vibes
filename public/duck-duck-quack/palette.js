/* Duck Duck Quack — the colours the scenery is painted in.
 *
 * The shared Good Vibes palette (../good-vibes/pixel.js) is sixteen colours,
 * and it is sixteen on purpose: it is what makes every game on the site look
 * like the same site, and Sunward draws out of the same jar. Nothing here
 * touches it. The ducklings, the goose, the skill badges, the nest, the
 * bridge timber, every sprite and every piece of UI still come out of those
 * sixteen, and so do both ends of most of the ramps below.
 *
 * What this file is for is the scenery, which wants something the sixteen
 * cannot give it: RAMPS. A sprite eight pixels tall is read by its
 * silhouette and reads fine in flat colour. A hillside, a cut bank of earth,
 * ninety pixels of open sky — those are read by how the light falls down
 * them, and that needs four or five steps of one hue to say anything at all.
 * The sixteen carry one green, one brown, one blue, one cyan; asked for a
 * second green they offer pine, which is nearly black beside grass, and the
 * turf came out as a flat green rectangle sitting on a flat brown one.
 *
 * So each ramp below fills in the steps BETWEEN two of the shared sixteen
 * rather than striking out on its own: GRASS runs from grass down to pine,
 * SOIL through oak, SUBSOIL from violet to deep violet, SKY from blue to
 * cyan, WATER from mint to blue. The ends are the site's own colours. Only
 * STONE has no anchor, and that is the point of it — see below.
 *
 * The alternative to stating the steps is dithering, and dithering is not a
 * blend. Between two colours that sit close together it reads as texture;
 * between two that sit far apart — the sixteen's blue and its cyan, say — it
 * reads as a checkerboard, and a checkerboard ruled across the sky is worse
 * than the hard seam it was drawn to hide. That is not a theory, it is what
 * the first attempt at a sky gradient actually looked like.
 *
 * They arrived one at a time to begin with — eighteen loose hex strings
 * scattered down art.js, a soil rim here, a rock grey there — and a colour
 * that exists only where it is used is a colour nobody can hold against the
 * one next to it. `test/duck-duck-quack-palette.test.js` keeps them here: it
 * checks art.js has grown no new ones, and it paints every level and checks
 * every tone below actually lands on the canvas, so a ramp cannot quietly
 * become longer than the drawing that uses it.
 *
 * EVERY RAMP RUNS THE SAME WAY: index 0 is the lightest, the last is the
 * darkest, so anything that wants "one step darker" adds one. That is worth
 * more than matching the order things happen to be drawn in, so two ramps
 * are read backwards by art.js and say so: the sky is painted from the deep
 * overhead down, and the hills from the furthest ridge forwards.
 */

/* The turf, from the sunlit crown of it down into its own shadow. Grass (g)
   and pine (G) are the shared palette's two, three and five; the four steps
   between them are what stop a cut bank reading as a green rectangle on a
   brown one, and the light above grass is what a blade catches at the very
   top of a scalloped edge. */
export const GRASS = ['#7ad880', '#5cc067', '#3fa34d', '#368c47', '#2d7642', '#245f3c'];

/* Cut earth. Oak (N) is the shared palette's brown and it stays here as the
   second step — but it is also the colour of a nest, a ladder and a bridge
   deck, and earth should be darker than the timber standing on it, so the
   body of the soil is two steps below it and the ramp runs on down from
   there into the subsoil. The middle pair are what the soil's courses are
   drawn in, near enough to the body that the weave is felt rather than
   counted (see art.js's drawSoilWeave; at full contrast it read as brick). */
export const SOIL = ['#d99270', '#c07a58', '#b06e4a', '#9b5f3f', '#7d4a30', '#643a26'];

/* Under the topsoil. Violet (v) down to deep violet (d), the shared
   palette's own two, with a lighter step above them where the subsoil meets
   the soil and one more between: violet rather than more brown, so a deep
   column reads as layered ground rather than a slab of one colour. */
export const SUBSOIL = ['#4a3768', '#3b2b5a', '#2f2248', '#241a3a'];

/* Rock, and the one ramp here with no anchor in the shared sixteen, because
 * that palette has no grey at all: every dark it carries is a purple, which
 * is right for soil in shadow and wrong for stone. Rock drawn in slate read
 * as "more dirt, but darker", which is most of how a Digger came to look
 * like it was tunnelling through rock it had always refused to touch.
 */
export const STONE = ['#6b7385', '#5d6472', '#4a505c', '#3e434e', '#31363f'];

/* The sky. Blue (b) overhead, cyan (c) at the horizon, and eight steps of
 * the blend between them — which is what it takes for open air to change
 * colour without anybody seeing it happen.
 *
 * Read BACKWARDS by art.js: lightest first is the rule everywhere in this
 * file, and the lightest part of a sky is the bottom of it. So SKY[0] is the
 * horizon and the last entry is the deep overhead, and drawSky counts down.
 */
export const SKY = ['#4fc4d3', '#4bbacf', '#47b0cb', '#43a6c7', '#3f9cc3',
  '#3b93c0', '#3789bc', '#337fb8', '#2f75b4', '#2b6bb0'];

/* The three ridges on the skyline: pine mixed toward the horizon's own cyan,
 * a step further for each one standing closer. Aerial perspective — what is
 * far away is paler and cooler — and the whole of what tells three
 * overlapping domes apart as near, middle and far rather than as one flat
 * frieze.
 *
 * FURTHEST FIRST, because the furthest is the palest and lightest-first is
 * the rule. That is also the order they have to be painted in, nearest last,
 * so a nearer ridge covers the one behind it.
 */
export const HILLS = ['#40a2a0', '#3a9288', '#33816f'];

/* Sunlight catching each ridge line, one tone per hill and matched to it by
   index. One shared highlight for all three put the same mint pixel on a far
   ridge and a near one, which flattens exactly what HILLS is there to
   separate. */
export const HILL_CROWN = ['#5cbab7', '#55ab9f', '#4d9a86'];

/* The pond, from the glint on its surface down to its bed. Mint (t), cyan
   (c) and blue (b) are the shared palette's own; the two between and below
   are what give a pond a floor that slopes away from its bank rather than a
   flat tinted tile. */
export const WATER = ['#7ff0d3', '#4fc4d3', '#3f9ec4', '#2b6bb0', '#22589a'];

/* Everything in one object, for the test that holds art.js to it. */
export const RAMPS = { GRASS, SOIL, SUBSOIL, STONE, SKY, HILLS, HILL_CROWN, WATER };
