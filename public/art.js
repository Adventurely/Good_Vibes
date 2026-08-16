/* Good Vibes — sprite art.
 *
 * 24 wide and 32 tall, rows of palette keys, '.' transparent. No image files:
 * the art is text, so a character can be edited in place and a diff of a
 * change to someone's face is readable.
 *
 * The conventions are Save Solarium's, deliberately — the two games sit on the
 * same shelf and should look like the same world. In short:
 *
 *   Taller than wide. At 24x24 a full body leaves a head nine pixels across,
 *   which holds two eyes and nothing else. Eight more rows buy a twelve-pixel
 *   head with room for brows, a nose and a jaw, which is the difference
 *   between a face and two dots. Stardew's proportion, for Stardew's reason.
 *
 *   Warm dark-brown outlines (#) rather than black, two-tone shading (every
 *   hue has a light key and a shadow key), saturated but soft colour. The
 *   world is meant to look worth saving, so even the rust is warm.
 *
 * This file is never imported by the engine — the rules reference an art key
 * by name and the client resolves it. That is worth keeping: it means art is
 * client-only, and a mistake in here can break a picture but never the Worker.
 *
 * The palette is a copy of Solarium's rather than an import, because the two
 * tools are synced from different repositories and a cross-tool import would
 * only work on the deployed site. If a colour changes there, change it here.
 */

export const PALETTE = {
  '#': '#3a2418',   // outline, warm dark brown
  '=': '#5c4029',   // secondary outline / deep shadow

  s: '#ffd9ae', S: '#d9a274',           // skin, skin shadow
  n: '#a06a3c', N: '#6b4223',           // hair / leather
  w: '#fffaf0', W: '#d8ccb4',           // white, cream shadow

  y: '#fff3b0', Y: '#ffd23f',           // sunlight, sun
  o: '#f59a2e', O: '#c96a17',           // orange, deep orange

  l: '#c3ec86', g: '#6cc24a', G: '#3f8f38', v: '#245c2c',   // leaf → deep green
  c: '#9fe9ee', b: '#3fa9dd', B: '#20629f',                 // cyan → deep blue
  p: '#d2a6f0', P: '#8a5bb8',                               // petal, violet

  m: '#e2e9ec', M: '#9aa9b2', x: '#5b6a72',                 // steel light/mid/dark
  r: '#d4702f', R: '#8f3f1a', t: '#b39a63', T: '#6f5c34',   // rust, dust
  e: '#ef5a45', E: '#a82f24'                                // danger red
};

const TALL = 32;

/* Every sprite ends up on the same 32-row canvas, padded at the top rather
   than the bottom, so a knee-high thing and a standing one share a ground line
   instead of floating at different heights. `split` is the row where the body
   starts: the client shifts everything above it by a pixel to make an idle
   breath, which is real animation without drawing a second frame by hand. */
const sprite = (rows, split, eyes) => {
  const pad = Math.max(0, TALL - rows.length);
  const blank = '.'.repeat(rows[0].length);
  return {
    rows: pad ? [...Array(pad).fill(blank), ...rows] : rows,
    split: (split ?? Math.floor(rows.length * 0.45)) + pad,
    eyes: eyes ? eyes.map(([x, y]) => [x, y + pad]) : null
  };
};

/* ============================================================== heroes === */

/* One skeleton under the whole cast, so they read as the same species and a
 * change to one can be reasoned about for all:
 *
 *   rows 1-12   head, 12 wide at columns 6-17, with hair or hood down the
 *               sides at 7 and 16 framing an 8-wide face
 *   row  13     neck
 *   rows 14-20  torso at columns 7-16, arms at 4-5 and 18-19 held off it by
 *               their own outline column, hands at row 20
 *   rows 21-23  belt and hips
 *   rows 24-30  legs and boots
 *
 * Brows at row 4, a two-pixel eye at rows 6-7 with the pupil out and a
 * highlight in, a nose at row 8, cheeks at 9, mouth at 10.
 */

export const HERO_ART = {
  /* The Alchemist. Violet headscarf tied under the chin, cream shirt under a
     leaf-green work apron, and a bandolier with two bottles on it — one
     cyan, one caught sunlight — so the silhouette says "carries things" from
     across the screen. */
  alchemist: sprite([
    '........................',
    '......############......',
    '......#pppppppppp#......',
    '......#pPPPPPPPPp#......',
    '......#psNNssNNsp#......',
    '......#pssssssssp#......',
    '......#ps==ss==sp#......',
    '......#ps=wssw=sp#......',
    '......#psssSSsssp#......',
    '......#pSssssssSp#......',
    '......#pSss==ssSp#......',
    '......#pSSssssSSp#......',
    '.......#PPPPPPPP#.......',
    '..........#ss#..........',
    '...#gG#gwwwwwwwwg#gG#...',
    '...#gG#gwcwwwwYwg#gG#...',
    '...#gG#gggggggggg#gG#...',
    '...#gG#gGGllllGGg#gG#...',
    '...#gG#gGGGGGGGGg#gG#...',
    '...#gG#gGGGGGGGGg#gG#...',
    '...#ss#gGGGGGGGGg#ss#...',
    '...####gttttttttG####...',
    '......#gTTTTTTTTG#......',
    '......#gGGGGGGGGg#......',
    '......#TTT#..#TTT#......',
    '......#TTT#..#TTT#......',
    '......#TTT#..#TTT#......',
    '......#NNN#..#NNN#......',
    '......#NNN#..#NNN#......',
    '......#NNN#..#NNN#......',
    '......#####..#####......',
    '........................'
  ], 14, [[10, 7], [13, 7]]),

  /* The Engineer. Goggles pushed up onto the forehead rather than worn, which
     is what someone who has been working looks like; rust-orange jacket over a
     steel collar, and a tool belt heavy enough to change how they stand. Warm
     metal against the Alchemist's green, so the two read apart at one pixel a
     tile on the map. */
  engineer: sprite([
    '........................',
    '......############......',
    '......#nnnnnnnnnn#......',
    '......#nmmmmmmmmn#......',
    '......#nmccmmccmn#......',
    '......#nssssssssn#......',
    '......#ns==ss==sn#......',
    '......#ns=wssw=sn#......',
    '......#nsssSSsssn#......',
    '......#nSssssssSn#......',
    '......#nSss==ssSn#......',
    '......#nNSssssSNn#......',
    '.......#NNNNNNNN#.......',
    '..........#ss#..........',
    '...#rR#rmmmmmmmmr#rR#...',
    '...#rR#rmMMMMMMmr#rR#...',
    '...#rR#rrrrrrrrrr#rR#...',
    '...#rR#rRRmmmmRRr#rR#...',
    '...#rR#rRRRRRRRRr#rR#...',
    '...#rR#rRRRRRRRRr#rR#...',
    '...#ss#rRRRRRRRRr#ss#...',
    '...####rttttttttR####...',
    '......#rTMTTTTMTR#......',
    '......#rRRRRRRRRr#......',
    '......#xxx#..#xxx#......',
    '......#xxx#..#xxx#......',
    '......#xxx#..#xxx#......',
    '......#NNN#..#NNN#......',
    '......#NNN#..#NNN#......',
    '......#NNN#..#NNN#......',
    '......#####..#####......',
    '........................'
  ], 14, [[10, 7], [13, 7]]),

  /* The Wizard. Deep violet robe with no armour anywhere on it — the
     silhouette is the warning label. A page tucked into the belt glows
     faintly gold, and the hood is worn up, because the rain and the pages
     disagree. Violet against the Alchemist's green and the Engineer's rust,
     so all three read apart at map scale. */
  wizard: sprite([
    '........................',
    '......############......',
    '......#PPPPPPPPPP#......',
    '......#PppppppppP#......',
    '......#PsNNssNNsP#......',
    '......#PssssssssP#......',
    '......#Ps==ss==sP#......',
    '......#Ps=wssw=sP#......',
    '......#PsssSSsssP#......',
    '......#PSssssssSP#......',
    '......#PSss==ssSP#......',
    '......#PPSssssSPP#......',
    '.......#PPPPPPPP#.......',
    '..........#ss#..........',
    '...#pP#pwwwwwwwwp#pP#...',
    '...#pP#pwPPPPPPwp#pP#...',
    '...#pP#pPPPPPPPPp#pP#...',
    '...#pP#pPPyYyPPPp#pP#...',
    '...#pP#pPPyyyPPPp#pP#...',
    '...#pP#pPPPPPPPPp#pP#...',
    '...#ss#pPPPPPPPPp#ss#...',
    '...####pwwwwwwwwP####...',
    '......#pPPPPPPPPP#......',
    '......#pPPPPPPPPP#......',
    '......#PPPP##PPPP#......',
    '......#PPPP##PPPP#......',
    '......#pPPP##PPPp#......',
    '......#PPPP##PPPP#......',
    '......#PPPP##PPPP#......',
    '......#pPPP##PPPp#......',
    '......#####..#####......',
    '........................'
  ], 14, [[10, 7], [13, 7]]),
};

/* ============================================================== enemies === */

/* What the surge sends. Smaller things on smaller grids — a sporeling at the
 * hero's 24x32 would read as a person, and it must not. The blight's palette
 * is deep green and violet gone wrong, with the danger reds nothing friendly
 * uses; a player should be able to tell friend from problem by colour alone
 * before either has moved.
 *
 * The key matches the `art` field in content.js ENEMIES.
 */
export const ENEMY_ART = {
  sporeling: [
    '......####......',
    '....##vvvv##....',
    '...#vGvvvvGv#...',
    '..#vvpvvvvpvv#..',
    '..#vvvvvvvvvv#..',
    '.#vvpvvevvpvvv#.',
    '.#vvvvveevvvvv#.',
    '.#Gvvvvvvvvvvv#.',
    '.#vvvpvvvvpvvv#.',
    '..#vvvvvvvvvv#..',
    '..##vvvvvvvv##..',
    '....#v#..#v#....',
    '....#v#..#v#....',
    '...##.#..#.##...',
    '................',
    '................',
  ],
  creeper: [
    '................',
    '..##........##..',
    '.#vv#......#vv#.',
    '.#Gvv######vvG#.',
    '..#vvvvvvvvvv#..',
    '.#vveevvvveevv#.',
    '.#vveevvvveevv#.',
    '.#Gvvvxxxxvvvv#.',
    '..#vvvxMMxvvv#..',
    '..#GvvvvvvvvG#..',
    '.#vv#vv##vv#vv#.',
    '.#v#.#v##v#.#v#.',
    '.#v#.#v##v#.#v#.',
    '..#...#..#...#..',
    '................',
    '................',
  ],
  hulk: [
    '....##########......',
    '...#xxxxxxxxxx#.....',
    '..#xMMxxxxxxMMx#....',
    '..#xMeexxxxeeMx#....',
    '..#xMeexxxxeeMx#....',
    '..#xxxxxxxxxxxx#....',
    '.#xxgvxxxxxxvgxx#...',
    '.#xrrxxMMMMxxrrx#...',
    '.#xrrxMxxxxMxrrx#...',
    '.#xxxxMxggxMxxxx#...',
    '.#xxxxMxggxMxxxx#...',
    '..#xxxMxxxxMxxx#....',
    '..#xxxxxxxxxxxx#....',
    '..#xxrrxxxxrrxx#....',
    '...#xx#....#xx#.....',
    '...#xx#....#xx#.....',
    '..##xx##..##xx##....',
    '..#xxxx#..#xxxx#....',
    '..######..######....',
    '....................',
  ],
  /* The boss. Wider than tall-oriented enemies and drawn to the hero grid's
     height, because it shares the screen with the party and has to out-scale
     them without leaving the style. */
  extractor: [
    '........................',
    '....##############......',
    '...#xxxxxxxxxxxxxx#.....',
    '..#xxMMMMxxxxMMMMxx#....',
    '..#xMeeeeMxxMeeeeMx#....',
    '..#xMeEEeMxxMeEEeMx#....',
    '..#xMeeeeMxxMeeeeMx#....',
    '..#xxMMMMxxxxMMMMxx#....',
    '..#xxxxxxxxxxxxxxxx#....',
    '.#xxrrxxxMMMMxxxrrxx#...',
    '.#xrrxxMMxxxxMMxxrrx#...',
    '.#xrxxMxxeEEexxMxxrx#...',
    '.#xxxxMxeEEEEexMxxxx#...',
    '.#xxxxMxeEEEEexMxxxx#...',
    '.#xxxxMxxeEEexxMxxxx#...',
    '.#xgvxxMMxxxxMMxxvgx#...',
    '.#xvgxxxxMMMMxxxxgvx#...',
    '..#xxxxxxxxxxxxxxxx#....',
    '..#xxMxxxxxxxxxxMxx#....',
    '..#xMxxxxxxxxxxxxMx#....',
    '.#xxMxxx#....#xxxMxx#...',
    '.#xMxxx#......#xxxMx#...',
    '.#xMxx#........#xxMx#...',
    '.#xxx#..........#xxx#...',
    '..###............###....',
    '........................',
  ],
};

/* ============================================================ buildings === */

/* One tile each, 16x16, transparent where the ground should show through.
 *
 * They are drawn standing on the tile rather than filling it: a building that
 * painted its whole square would tile edge-to-edge with its neighbour and a
 * row of three would read as a wall. Leaving the corners open is what keeps a
 * base looking like separate things somebody put there.
 *
 * The key matches the `art` field in content.js BUILDINGS.
 */
export const BUILDING_ART = {
  workbench: [
    '................',
    '................',
    '.....#M#........',
    '....########....',
    '...#mmmmmmmm#...',
    '...#MMMMMMMM#...',
    '...#tttttttt#...',
    '...#TtTtTtTt#...',
    '...##T####T##...',
    '....#T#..#T#....',
    '....#T#..#T#....',
    '....#T#..#T#....',
    '....#N#..#N#....',
    '....###..###....',
    '................',
    '................',
  ],
  pylon: [
    '................',
    '.......cc.......',
    '......cyyc......',
    '.....cyYYyc.....',
    '......cyyc......',
    '.......##.......',
    '......#mm#......',
    '......#Mm#......',
    '......#mM#......',
    '......#Mm#......',
    '......#mM#......',
    '.....##mm##.....',
    '....#MMMMMM#....',
    '....#xxxxxx#....',
    '....########....',
    '................',
  ],
  condenser: [
    '................',
    '....########....',
    '...#mMMMMMMm#...',
    '...#MccccccM#...',
    '...#McbbbbcM#...',
    '...#McbBBbcM#...',
    '...#McbBBbcM#...',
    '...#McbbbbcM#...',
    '...#MccccccM#...',
    '...#mMMMMMMm#...',
    '...##MMMMMM##...',
    '....#x####x#....',
    '....#x#..#x#....',
    '....###..###....',
    '................',
    '................',
  ],
  bulwark: [
    '................',
    '................',
    '..############..',
    '..#mMmMmMmMmM#..',
    '..#MmMmMmMmMm#..',
    '..############..',
    '..#mMmMmMmMmM#..',
    '..#MmMmMmMmMm#..',
    '..############..',
    '..#mMmMmMmMmM#..',
    '..#MmMmMmMmMm#..',
    '..############..',
    '..#xx##xx##xx#..',
    '..############..',
    '................',
    '................',
  ],
  rig: [
    '................',
    '..#..........#..',
    '..#x########x#..',
    '..#xrrrrrrrrx#..',
    '..#xrRRRRRRrx#..',
    '..#xrRooooRrx#..',
    '..#xrRoOOoRrx#..',
    '..#xrRooooRrx#..',
    '..#xrRRRRRRrx#..',
    '..#xrrrrrrrrx#..',
    '..#x########x#..',
    '..#xx#....#xx#..',
    '..#MM#....#MM#..',
    '..####....####..',
    '................',
    '................',
  ],
};

/* ============================================================== terrain === */

/* Sixteen by sixteen, one per terrain kind in content.js.
 *
 * Drawn as noise rather than as a motif on purpose: these tile against copies
 * of themselves in every direction, and anything with a centre — a flower, a
 * crack, a shape — turns into a visible grid the moment it repeats. Speckle
 * has no centre, so a field of it reads as ground instead of as wallpaper.
 *
 * The keys are the same palette as everything else here, so terrain shades
 * match the sprites standing on it without a second set of greens.
 */
export const TILE = 16;

export const TERRAIN_ART = {
  grass: [
    'GgGGGvGGGgGGGGgG',
    'GGGlGGGGGGgGGGGG',
    'gGGGGGGgGvGGlGGG',
    'GGGvGGlGGGGGGGgG',
    'GGgGGGGGGGgGGvGG',
    'lGGGGgGGvGGGGGGl',
    'GGGGGGGGGGGGgGGG',
    'GvGGgGGlGGGvGGGG',
    'GGGGGGGGgGGGGGGg',
    'GgGGvGGGGGGlGGGG',
    'GGGlGGgGGGGGGGvG',
    'vGGGGGGGGgGGGGGG',
    'GGGgGGvGGGGGgGGG',
    'GGGGGlGGGGvGGGGG',
    'gGGGGGGGgGGGGlGG',
    'GGvGGgGGGGGGGGGG',
  ],
  /* Old panelling: a grout line down the middle and along the bottom, so a
     run of floor tiles reads as slabs laid in a grid rather than as one
     enormous sheet of steel. */
  floor: [
    'MMMMMMMMxMMMMMMM',
    'MmMMMtMMxMMMMtMM',
    'MMMMMMMMxMMMMMMM',
    'MMtMMMMMxMMtMMMM',
    'MMMMMMMMxMMMMMMM',
    'MMMMtMMMxMMMMMtM',
    'MMMMMMMMxMMMMMMM',
    'xxxxxxxxxxxxxxxx',
    'MMMMMMMMxMMMMMMM',
    'MtMMMMMMxMMtMMMM',
    'MMMMMMMMxMMMMMMM',
    'MMMMMtMMxMMMMMMt',
    'MMMMMMMMxMMMMMMM',
    'MMtMMMMMxMMMMtMM',
    'MMMMMMMMxMMMMMMM',
    'xxxxxxxxxxxxxxxx',
  ],
  rubble: [
    'xMxx#xMMxxMx#xxM',
    'MxxMxxx#MxxMxxxM',
    'xx#MxxMxxRxxMx#x',
    'xMxxMx#xxMxxrxxM',
    '#xxMxxxMxxMx#xMx',
    'xMxxxMxxMxxxMxxx',
    'xxMx#xxMxrxMxxMx',
    'Mxxxxx#xxMxxxM#x',
    'xMxxMxxxMxxMxxxM',
    'xxx#xMxxxxMx#xxx',
    'MxxMxxMx#xxxMxMx',
    'xxMxxxxMxxRxxxMx',
    '#xxxMx#xxMxxMxx#',
    'xMxxxMxxMxxxxMxx',
    'xxMxxxMxxxMxMxxM',
    'MxxMx#xxMxxMxxxx',
  ],
  water: [
    'bbbBbbbbbbBbbbbb',
    'bbbbbbBbbbbbbbBb',
    'BbbbbbbbbcbbbbbB',
    'bbbBbbbbbbbbBbbb',
    'bbbbbbbcbbbbbbbb',
    'bBbbbbbbbbBbbbbb',
    'bbbbBbbbbbbbbbcb',
    'bbbbbbbbBbbbbbbb',
    'cbbbbbbbbbbBbbbb',
    'bbbBbbbbbbbbbbbB',
    'bbbbbbBbbcbbbbbb',
    'bbBbbbbbbbbbBbbb',
    'bbbbbbbbbBbbbbbb',
    'Bbbbbcbbbbbbbbbb',
    'bbbbbbbBbbbbbBbb',
    'bbBbbbbbbbbbbbbb',
  ],
  /* A spoil hill: lighter on top where the sun hits, darker at the base. The
     gradient is the one exception to the no-motif rule — it reads as slope,
     and slope is the entire message. */
  hill: [
    'tttttttttttttttt',
    'ttttttyttttttttt',
    'tttttttttttytttt',
    'ttTttttttttttttt',
    'tttttttTtttttttt',
    'ttttttttttttTttt',
    'tTttttttTttttttt',
    'ttttTttttttttttt',
    'TttttttttTttttTt',
    'ttTtttTttttttttt',
    'tTtttttttTttTttt',
    'TttTtTttttttttTt',
    'tTtTttttTtTttttt',
    'TtTttTtTttTtTtTt',
    'TTtTTtTTtTtTTtTT',
    'TTTTtTTTtTTTtTTT',
  ],
  /* A sapling stands alone on its tile — trees are dotted, never blobbed, so
     a centred motif cannot turn into wallpaper here. Grass shows at the
     corners so it sits on the ground instead of floating. */
  tree: [
    'GGGgGGGllGGGgGGG',
    'GgGGGlgggglGGGGG',
    'GGGGlggggggllGGG',
    'GGGlgggvggggglGG',
    'GGlggvggggvgggGG',
    'GGgggggglgggggGG',
    'GGlgvggggggvglGG',
    'GGGgggglvggggGGG',
    'GGGlggggggggGGGG',
    'GGGGlgvggvglGGGG',
    'GGGGGGlNNlGGGGGG',
    'GGgGGGGNNGGGGvGG',
    'GGGGGGGNNGGGGGGG',
    'GGGGGGNNNNGGGGGG',
    'GgGGGvGGGGgGGGGG',
    'GGGGGGGgGGGGGvGG',
  ],
  /* A crevice: the ground failing. Nearly black at the seam, steel showing at
     the lip where the slab sheared. */
  crevice: [
    'xxTxxxxxTxxxxxTx',
    'xTxx##xxxx##xxxx',
    'xx##==##x#==#xxT',
    'Tx#====##====#xx',
    'xx#=====#####xxx',
    'xx##======##xxTx',
    'xTx##======##xxx',
    'xxxx#========#xx',
    'xxT#====##====#x',
    'xx#===##xx#===#x',
    'x#===#xxTxx#==#x',
    'x#==#xxxxxxx##xx',
    'xx##xxTxxxxxxxTx',
    'Txxxxxxx##xxxxxx',
    'xxxxTxx#==#xxxxx',
    'xxxxxxxx##xxxTxx',
  ],
};

/* ============================================================ materials === */

/* Eight by eight, drawn on the ground line so they sit in a row without
   being aligned by hand. These are what a level puts out to be gathered;
   the key matches the id in content.js. */
export const MATERIAL_ART = {
  sunpetal: [
    '..yYY...',
    '.yYYYy..',
    'yYYyYYy.',
    '.yYYYy..',
    '..#g#...',
    '..#g#...',
    '.#lgl#..',
    '..###...'
  ],
  copperfern: [
    '...l....',
    '..lgl...',
    '.lgGgl..',
    'lgGvGgl.',
    '..#G#...',
    '..#G#...',
    '..#G#...',
    '..###...'
  ],
  dewglass: [
    '...c....',
    '..ccc...',
    '.ccmcc..',
    '.cmwmc..',
    '.ccmcc..',
    '..ccc...',
    '...c....',
    '........'
  ],
  rustbloom: [
    '..r.r...',
    '.rRorR..',
    'rRoOoRr.',
    '.rRorR..',
    '..#R#...',
    '..#R#...',
    '.#rRr#..',
    '..###...'
  ],
  cellsap: [
    '..####..',
    '..#pp#..',
    '.#pPPp#.',
    '.#PPPP#.',
    '.#pPPp#.',
    '.#PPPP#.',
    '.#pPPp#.',
    '..####..'
  ],
};

/* ================================================================ cards === */

/* One icon per card kind rather than per card. A hand is read at a glance and
   in a hurry — what matters is "that one hits, that one holds", and seven
   distinct pictures would say that slower than three do. Keyed by CARDS[].kind
   in content.js. */
export const CARD_ART = {
  attack: [
    '..e..e..',
    '.eE..Ee.',
    '..eEEe..',
    '.eEEEEe.',
    '.eEEEEe.',
    '..eEEe..',
    '.eE..Ee.',
    '..e..e..'
  ],
  defend: [
    '.MMMMMM.',
    'MmmmmmmM',
    'MmMMMMmM',
    'MmMmmMmM',
    'MmMmmMmM',
    '.MmMMmM.',
    '..MmmM..',
    '...MM...'
  ],
  heal: [
    '..#gg#..',
    '..#gg#..',
    '###gg###',
    'gggggggg',
    'gggggggg',
    '###gg###',
    '..#gg#..',
    '..#gg#..'
  ],
};

/* ============================================================ indicators === */

/* Flown over a hero's head when they have committed — readied up in the build
 * phase, or picked a card in a fight. With five players choosing at once, "who
 * are we still waiting for" is the question the screen has to answer without
 * anyone asking it, and a tick above the sprite answers it where the player is
 * already looking.
 */
export const MARK_ART = {
  ready: [
    '........',
    '......gg',
    '.....gg.',
    '....gg..',
    'g..gg...',
    'gggg....',
    '.gg.....',
    '........'
  ],
  /* Still deciding: three dots, the universal "thinking". */
  waiting: [
    '........',
    '........',
    '........',
    '.M.M.M..',
    '.M.M.M..',
    '........',
    '........',
    '........'
  ],
};

/* ============================================================== salvage === */

/* Eight by eight, same as the materials, because they sit in the same kind of
   chip. Cold metal against the materials' warm growing things — the two pools
   should be tellable apart at a glance without reading the label. The key
   matches the id in content.js SALVAGE. */
export const SALVAGE_ART = {
  screw: [
    '..MMMM..',
    '.M####M.',
    '..MmmM..',
    '...MM...',
    '...Mm...',
    '...MM...',
    '...Mm...',
    '...##...'
  ],
  pipe: [
    '........',
    '.xxxxxx.',
    'xMMMMMMx',
    'xmxxxxmx',
    'xmxxxxmx',
    'xMMMMMMx',
    '.xxxxxx.',
    '........'
  ],
  plating: [
    '........',
    '.######.',
    '.#mmmm#.',
    '.#mMMm#.',
    '.#mMMm#.',
    '.#mmmm#.',
    '.######.',
    '........'
  ],
  coil: [
    '..####..',
    '.#cccc#.',
    '#crrrrc#',
    '#cRRRRc#',
    '#crrrrc#',
    '#cRRRRc#',
    '.#cccc#.',
    '..####..'
  ],
};

/* Spell pages, the Wizard's cache on the map. One icon, not a table — pages
   are pages. Cream against the ground with a line of living ink. */
export const PAGES_ART = [
  '.######.',
  '#wwwwww#',
  '#wPwPww#',
  '#wwwwww#',
  '#wPwwPw#',
  '#wwwwww#',
  '#wwWWww#',
  '.######.',
];
