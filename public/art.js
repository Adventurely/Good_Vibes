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

const TALL = 40;

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
     leaf-green work apron, and a bandolier with two bottles on it — one cyan,
     one caught sunlight — so the silhouette says "carries things" from across
     the screen. */
  alchemist: sprite([
    '................................',
    '........################........',
    '........#pppppppppppppp#........',
    '........#PPPPPPPPPPPPPP#........',
    '........#pPssssssssssPp#........',
    '........#pPss==ss==ssPp#........',
    '........#pPss#wssw#ssPp#........',
    '........#pPssssssssssPp#........',
    '........#pPssssSSssssPp#........',
    '........#pPsSssssssSsPp#........',
    '........#pPsssS==SsssPp#........',
    '........#pPssssssssssPp#........',
    '........#pPsSSssssSSsPp#........',
    '........#ppsssssssssspp#........',
    '........#PPPPPPPPPPPPPP#........',
    '.........##############.........',
    '..............#ss#..............',
    '.....#gG#gwwwwwwwwwwwwg#gG#.....',
    '.....#gG#gwcwwwwwwwwYwg#gG#.....',
    '.....#gG#gggggggggggggg#gG#.....',
    '.....#gG#gGGllllllllGGg#gG#.....',
    '.....#gG#gGGGGGGGGGGGGg#gG#.....',
    '.....#gG#gGGGGGGGGGGGGg#gG#.....',
    '.....#gG#gGGGGGGGGGGGGg#gG#.....',
    '.....#ss#gGGGGGGGGGGGGg#ss#.....',
    '.....####gttttttttttttG####.....',
    '........#gTTTTTTTTTTTTG#........',
    '........#gGGGGGGGGGGGGg#........',
    '........#TTTT#....#TTTT#........',
    '........#TTTT#....#TTTT#........',
    '........#TTTT#....#TTTT#........',
    '........#TTTT#....#TTTT#........',
    '........#TTTT#....#TTTT#........',
    '........#NNNN#....#NNNN#........',
    '........#NNNN#....#NNNN#........',
    '........#NNNN#....#NNNN#........',
    '........#NNNN#....#NNNN#........',
    '........#NNNN#....#NNNN#........',
    '........######....######........',
    '................................',
  ], 16, [[13, 6], [18, 6]]),

  /* The Engineer. Goggles pushed up onto the forehead rather than worn, which
     is what someone who has been working looks like; rust-orange jacket over a
     steel collar, and a tool belt heavy enough to change how they stand. Warm
     metal against the Alchemist's green, so the two read apart at one pixel a
     tile on the map. */
  engineer: sprite([
    '................................',
    '........################........',
    '........#nnnnnnnnnnnnnn#........',
    '........#NNNNNNNNNNNNNN#........',
    '........#nNMccMMMMccMNn#........',
    '........#nNss==ss==ssNn#........',
    '........#nNss#wssw#ssNn#........',
    '........#nNssssssssssNn#........',
    '........#nNssssSSssssNn#........',
    '........#nNsSssssssSsNn#........',
    '........#nNsssS==SsssNn#........',
    '........#nNssssssssssNn#........',
    '........#nNsSSssssSSsNn#........',
    '........#nnssssssssssnn#........',
    '........#NNNNNNNNNNNNNN#........',
    '.........##############.........',
    '..............#ss#..............',
    '.....#rR#rmmmmmmmmmmmmr#rR#.....',
    '.....#rR#rRRRRRRRRRRRRr#rR#.....',
    '.....#rR#rRRRRRRRRRRRRr#rR#.....',
    '.....#rR#rRRoooooooRRRr#rR#.....',
    '.....#rR#rRRRRRRRRRRRRr#rR#.....',
    '.....#rR#rRRRRRRRRRRRRr#rR#.....',
    '.....#rR#rRRRRRRRRRRRRr#rR#.....',
    '.....#ss#rRRRRRRRRRRRRr#ss#.....',
    '.....####rMMMMMMMMMMMMR####.....',
    '........#rxxxxxxxxxxxxR#........',
    '........#rTTTTTTTTTTTTr#........',
    '........#MMMM#....#MMMM#........',
    '........#MMMM#....#MMMM#........',
    '........#MMMM#....#MMMM#........',
    '........#MMMM#....#MMMM#........',
    '........#MMMM#....#MMMM#........',
    '........#xxxx#....#xxxx#........',
    '........#xxxx#....#xxxx#........',
    '........#xxxx#....#xxxx#........',
    '........#xxxx#....#xxxx#........',
    '........#xxxx#....#xxxx#........',
    '........######....######........',
    '................................',
  ], 16, [[13, 6], [18, 6]]),

  /* The Wizard. Deep violet robe with no armour anywhere on it — the
     silhouette is the warning label. A page tucked into the belt glows faintly
     gold, and the hood is worn up, because the rain and the pages disagree.
     Violet against the Alchemist's green and the Engineer's rust, so all three
     read apart at map scale. */
  wizard: sprite([
    '................................',
    '........################........',
    '........#PPPPPPPPPPPPPP#........',
    '........#pppppppppppppp#........',
    '........#PpsssssssssspP#........',
    '........#Ppss==ss==sspP#........',
    '........#Ppss#wssw#sspP#........',
    '........#PpsssssssssspP#........',
    '........#PpssssSSsssspP#........',
    '........#PpsSssssssSspP#........',
    '........#PpsssS==SssspP#........',
    '........#PpsssssssssspP#........',
    '........#PpsSSssssSSspP#........',
    '........#PPssssssssssPP#........',
    '........#pppppppppppppp#........',
    '.........##############.........',
    '..............#ss#..............',
    '.....#pP#pwwwwwwwwwwwwp#pP#.....',
    '.....#pP#pwPPPPPPPPPPwp#pP#.....',
    '.....#pP#pPPPPPPPPPPPPp#pP#.....',
    '.....#pP#pPPyYyyYyPPPPp#pP#.....',
    '.....#pP#pPPyyyyyyPPPPp#pP#.....',
    '.....#pP#pPPPPPPPPPPPPp#pP#.....',
    '.....#pP#pPPPPPPPPPPPPp#pP#.....',
    '.....#ss#pPPPPPPPPPPPPp#ss#.....',
    '.....####pwwwwwwwwwwwwP####.....',
    '........#pPPPPPPPPPPPPP#........',
    '........#pPPPPPPPPPPPPp#........',
    '........#PPPP#....#PPPP#........',
    '........#PPPP#....#PPPP#........',
    '........#PPPP#....#PPPP#........',
    '........#PPPP#....#PPPP#........',
    '........#PPPP#....#PPPP#........',
    '........#PPPP#....#PPPP#........',
    '........#PPPP#....#PPPP#........',
    '........#PPPP#....#PPPP#........',
    '........#PPPP#....#PPPP#........',
    '........#PPPP#....#PPPP#........',
    '........######....######........',
    '................................',
  ], 16, [[13, 6], [18, 6]]),
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
  /* Angled to the sun, cracked, and still working. The cells read as a grid at
     one tile because that is the one thing a panel unmistakably is. */
  panel: [
    '................',
    '................',
    '..############..',
    '..#bBbBcBbBbB#..',
    '..#BbBbBbBcBb#..',
    '..#bBcBbBbBbB#..',
    '..#BbBbBcBbBb#..',
    '..############..',
    '.....#xxxx#.....',
    '......#xx#......',
    '......#xx#......',
    '......#xx#......',
    '.....######.....',
    '................',
    '................',
    '................',
  ],
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

/* Terrain variants: the same kind, cut more than one way.
 *
 * Every grass tile used to be pixel-identical to every other grass tile, so
 * a field of them read as wallpaper however good the individual tile was.
 * The renderer picks a cut per tile from a hash of its coordinates, which is
 * stable across redraws, so the ground varies without ever shimmering.
 */
export const TERRAIN_VARIANTS = {
  grass: [
    [
      'GGGGGlGGlvGvGGGG',
      'GGgGvGGGGGGlgGGg',
      'vGgGGvGGGgvGGgGg',
      'GvGGGGGGgGGGGGGG',
      'GGGGlGGGgGGglGGG',
      'vGGglGGgGGGGgGvG',
      'vGgGGGGGGvGGGgGG',
      'GGGGvGGgGGlGGlGl',
      'GGgGGvGgGGGGGGGG',
      'GGGGGGGGGGGGGGGG',
      'GGGGGGGvGGgGGGgG',
      'GGvGGGGGGGGGgGGG',
      'GGGGGGGvGgGgGGGG',
      'GgGgGGGGGGvGGGGG',
      'GGGGGGggGGGGGgGG',
      'GlvGlgGGGGGGlGGG',
    ],
    [
      'GGGGvGGlGGGGGGGG',
      'ggGGGGGGGGgGgGGG',
      'GGgGGGGvGvGGGGGG',
      'GgGgGGgGGGGgGGGG',
      'GGGGGGGGGGgGgGGG',
      'GGgGGGGGGGGGlGGG',
      'GgGGGlGGGgGggGgG',
      'gGGGvvGGGGGGGGGG',
      'GGGGGgGGGgGGGgGv',
      'GggGlgggGGGGGGGG',
      'gGgGGGGgGGGGGGGg',
      'GGGGgGGGGGvGGGGG',
      'gGGgGGvlGvgGGGGG',
      'glgGggGGGGGGGggG',
      'GGGGGGGlggGGGGGv',
      'GGgGgGggGGgGGGgG',
    ],
    [
      'GGGGGGvGGgGvGGGG',
      'GGGGGvGGvGGGGGGG',
      'GlGGGGGGvGGGgglG',
      'GvlGvGGGvGGvvGvG',
      'GglGlGGGGGGGGGGG',
      'GGGGvGGlGGGGGGlG',
      'GGGGGlGGGGGGGGGG',
      'GGvGGlvGGGlGGGGG',
      'GgGvGgGGGgGGGlGG',
      'GGvvGgGGGGGGggGG',
      'GGGGGGGGGGGlGGGG',
      'GvGgvGGgGGGGGgGv',
      'lGGgGgGvGGGGGGGG',
      'GgGGGGGGvvGlGGGG',
      'GgGGlGGGGvlGlgGG',
      'GglvGGGGggGGGGgG',
    ],
  ],
  water: [
    [
      'bbcBbbbbbBbBbbbb',
      'bbBbcbbbbbbBBbbb',
      'cBBbbBbbBbbBbbbb',
      'bbbcBBbbbBBbbbBb',
      'cbbbBbbbbbbBbBbb',
      'bbbbbBBBccbbBccb',
      'bbbbBbbbbbbbBbBb',
      'bbBbBbbbBBbbbbbB',
      'bbbbbbbbbbbbBbbb',
      'bbbbBbbbbbBbBBbb',
      'bbbbcbBcbBBbbbBb',
      'bbbBbbbbbbbbBbbb',
      'bbBbBbbbBBbcbbbb',
      'BBBbBbbbbbbBbbBb',
      'BbbbbbbbbBbbbbbb',
      'bcBbbbbbbbbBBbbB',
    ],
    [
      'bcccbbbBbbBbbbBb',
      'bbbbcbBBbbBbBBbb',
      'bBBbbBbbbBBcbcBb',
      'BbbBbcbBBcbbcbbb',
      'bcbbbbBBbbbbbbbB',
      'bbbbbbbcbcbbBbbb',
      'bBbbbbbbcbBbcbbb',
      'bbbbbcbBBbBcbbbb',
      'bbbbbBbcbcbBbbbb',
      'BBcbbbbbbbbbbbcb',
      'BbbBbbbbbbbcbBbb',
      'bBbBbbbbBbbbbbbb',
      'bbbbbbbbBbBbbBBb',
      'bbbbbbbbbbbbbcBb',
      'bbbbbbbbbbbbbbbb',
      'bBbbbbbbbbbbbBbb',
    ],
  ],
  rubble: [
    [
      'xxxMxxMMxxxxxxMx',
      'xxxxxxMxxxTxxxxx',
      'xxxMxTMxxxTxxxxx',
      'xxMMxMxxxxxxxMxx',
      'MxxxxTxMxxxxxxxx',
      'xxxMxxxxTMxxxxTx',
      'xTxxMxxxxMxxxxxM',
      'xxxTxxxxxxxxMxxx',
      'xxxxMxxxMMxxxxMx',
      'xMxxMxxxxxxxxxxx',
      'MxMxTMMxMMMTMxxM',
      'xxxxxxxxxTxxxxTT',
      'MxMxMTMxTxxxxxMT',
      'xxMxMxxxTxMxxTxM',
      'xxxxxxxTxMxTxxxx',
      'xMxxxxxMxxxTMMxx',
    ],
    [
      'xxxxxxxMxxxxMxxx',
      'xxxTxxxxxxxMTxxx',
      'xxxMxxxMxxxxxxTT',
      'xxxxTxTxTxTxxxxx',
      'xxxxTTxxxTxMTxxx',
      'xxxxxxxxxxxxTxxx',
      'xxxxxxTxxxTTxxxx',
      'xxxxMxxTxxxTMxMx',
      'xxxMMTxxTxxxMxTx',
      'xMxMxxMTxxxxxxxT',
      'xxxxxxxxxxTTTxTx',
      'TxxxxxxxxxxTxMxT',
      'xxTxxxxxxxxxxxTT',
      'xxxxTxxxxxxxxxxM',
      'xTxMxxxTxTxxxxxT',
      'xxxxxxxxxxxxxxxT',
    ],
  ],
  crevice: [
    [
      'x#xxxxx#x=xx=x=x',
      '=#x#xx#x#xxxxxx=',
      '==x#xx==x=x==x==',
      '#xx#x###xxx==#xx',
      '=x=xxx#=xxxxxx=#',
      'x==xx#xxxxxxxxx=',
      'xx=x#==x#x#x=xx=',
      '#x#xxx#x#xx#xx##',
      '=xx#==xx##x#x===',
      '=xxxx=xx#=x==xxx',
      '=x=xxxxx==x=#xxx',
      '#x###xx#==#x#xxx',
      '=xx=x#==#xx===x=',
      '=xxxx#xx=xxxxxx#',
      'xxxxxxx##=xxxx#=',
      'xx==x=x=xxx=xx#=',
    ],
    [
      '=xx==x#x#xxx#xx#',
      '=x##xx=###xxx#xx',
      'xxx##xxxx=xxxx=#',
      '=xx#xxx##xxxx=#x',
      'xxx#x#xx=#x####=',
      '=#x#xxxxx=x#xx#x',
      'xx#x=x#x#xx#xxx#',
      'xxxx##x=#xx#xx#x',
      'xx=x=x#=xxxx#xxx',
      '#==##==xx#xxxxx=',
      'xxxxx=##xxx#=##x',
      '=xxxxx##=x=xx=xx',
      '#xx#x##xxxx#=#x#',
      '=#x#x#=#xxxx#xxx',
      'xx##xxxxxx=##xxx',
      'xx==##=x#xxx=xx=',
    ],
  ],
  hill: [
    [
      'tttttttTtttttttT',
      'TtTtttttttttTttt',
      'TtttttttttTtTttt',
      'tttttttttttTtTtT',
      'tttttttttttttttt',
      'tttttTTTTttttttt',
      'TttttttttttttTTT',
      'ttttttttTTtTtTTT',
      'ttttTttTTTTtTTTT',
      'tTTTttTTTTTTTtTT',
      'TTtTTTTTtTTTTTTT',
      'TTtTTTTTTtTTTTTT',
      'tTTTTtTTTTTTTTTT',
      'TTTTTTTtTTtTTTTT',
      'TTTTTTTTTtTTTTTT',
      'tTTTTTTTTTTTTtTT',
    ],
    [
      'tttttttttTtttttt',
      'TttttttttttttTTt',
      'ttTttttttttttttt',
      'tttttttttttttTtt',
      'tttTtttttttTtttt',
      'tttttttttttTtttt',
      'TTTTtttttttTTTTt',
      'TTTtTTTTtttttttt',
      'tTTTTTTTTTTTtttt',
      'TTTTTTtTTTTtTTTT',
      'TTTTTTTTTTTTTTTT',
      'TtTtTTTTtTTTTTTT',
      'TTTTTTTTTtTTtTTT',
      'TTtTTTTTTTTTTTTT',
      'TtTTTTTTTTTTTtTT',
      'TTTtTtTTTTTTTtTT',
    ],
  ],
  floor: [
    [
      'tMMMMMMMxMMMMMtM',
      'MMMMMtMtxMMMMMtM',
      'MMMMMMMMxMtMMtMM',
      'MMMMMMMMxMMMMMMM',
      'tMMMtMMMxMMMMMMM',
      'MMMMMMtMxtMMMMMM',
      'MMMMMMtMxMMMMMMM',
      'xxxxxxxxxxxxxxxx',
      'MMMtMtMMxMMttMMM',
      'tMtMMMMMxMMMMMMM',
      'MMMtMMMMxMMMMMMM',
      'MMMMttMMxMMMMMMt',
      'MttMMMMMxMMMMMMM',
      'MMMMMMMMxMMMMMMM',
      'tMMMMMMMxtMMMMMM',
      'xxxxxxxxxxxxxxxx',
    ],
    [
      'MtMMMMMMMtMMMMxM',
      'MMMMMMMMMMMMMMxM',
      'MMMMMMMMMMMtMMxM',
      'MMMMMMMMMMMMMMxM',
      'MMMMMtMMMMMMMMxM',
      'MMMMMtMMtMMMMMxM',
      'MMMMMMMMMtMtMMxM',
      'xxxxxxxxxxxxxxxx',
      'MMtMMMMMMMMMMMxM',
      'MMtMMMMMMMMMMMxM',
      'MMMMMMMMMMMMMMxM',
      'MMMtMMMMMMtMMMxM',
      'MtMMMMMMMMMMtMxM',
      'MMMMMMMMMMMMMMxM',
      'MMMMtMMtMMMMMMxM',
      'xxxxxxxxxxxxxxxx',
    ],
  ],
  camp: [
    [
      'tTttTtttttTttttt',
      'tttttttttttNtttt',
      'tttTTttTttTttTTt',
      'ttttttTtttttNtTt',
      'TTtttttttttNttTt',
      'ttTtTTtttttttttt',
      'ttttttttNNtttttt',
      'tttttttttttttNTt',
      'tttttttttttTTttt',
      'tTtTttttTttttttN',
      'TTttTttttttttttt',
      'ttttttttttttttTT',
      'ttttTTTttTtttttt',
      'tttttTTtTttTtttt',
      'ttttNtttttttTttt',
      'tNttttttttTtTTtt',
    ],
    [
      'ttttTtTtttttnTtT',
      'ttttttTttTtTnTnt',
      'ttttttttttttttTT',
      'tttttTttntttttTt',
      'ntnttTtttttttTTn',
      'ttttTtTtttTntttt',
      'TttttttttttTttTt',
      'TtTtTtTttnttntnt',
      'tttTttTtTTttttTt',
      'TTtttTTTTttttTTt',
      'tTTtTnttTttTttTt',
      'ttTtttttTttTtttt',
      'nnttTttntTtTtTtT',
      'ttttttTtTTTttttt',
      'tTTtTTTTTttttttt',
      'tnTttTTttTTTtTTt',
    ],
  ],
  tent: [
    [
      'TTtTNTTTTTTTNTTN',
      'TTTTTTNTTNTTNNTN',
      'TTTTTNTTNtTNNTTN',
      'tNNTTTTNTNTTTTNT',
      'NTNTTNTTTtTNTTNT',
      'TTNNTTTtTTTTTTTT',
      'TTTTTTTTNTTTTTTT',
      'TTTTTTTTTtTNTTNT',
      'TTTNTNTTTTNTTTTN',
      'TTTNNTTTNTNTtNNT',
      'TTTTTtTTTTTTTNTT',
      'TNNTTTTtTtTTTtTT',
      'ttTTTTtTTNTTttNT',
      'TtTTNTTTTTNTTNTN',
      'TTTTTNTTTTNTTTtT',
      'TTTTTTTtTTTNNTTT',
    ],
  ],
  fire: [
    [
      'TTTTTTxxTxxMxRTM',
      'TxxTTRTxTTTxTMMx',
      'MxRTTxMMxTMRRxTx',
      'xTTTRxTxTxTxxTxx',
      'xxMTxTTxTTTRTxTM',
      'TMTTxxMTTTTRTxTT',
      'MTTTTTTxxxTxTTTT',
      'TTxxTTMxxMTTxRRT',
      'TTxxRTTTTTTTTTMT',
      'TTTTTTTTxTMMxTTT',
      'xTTxMTxTxxxTxTxx',
      'TTTxTxxRTTTTTTRT',
      'TMMTRTTTTTTTTTRx',
      'TTMTxMTRTTTTTTTx',
      'TTTTTTTTTTMTTxTx',
      'xTTTTxTTTTMTxTTT',
    ],
  ],
  tree: [
    [
      'GgNGGGGGGgGGNGGG',
      'GNGGGNGGvGNGGGvN',
      'gGGGgGGvGGGGGgGG',
      'vGGGGgGGvGGGGgGG',
      'GGGGGGGGGgGGGvGG',
      'GGGGGGGGGNGGNGGv',
      'GGgGGGGGGvNGGGGv',
      'GGGGGvGgGGGGNGGG',
      'GGvGGvgGGGGGGvNG',
      'GgGgGgvGGGGgvGgG',
      'NGGGNvGGvGGGGGGG',
      'gGNGGGGGvGGGGgGG',
      'GGGNgGGGGGGGGGGG',
      'GGgGGvGNNvGGgGvv',
      'vgGvGvGgGvGNGGGG',
      'GGGGGGGGGGGGGGGG',
    ],
  ],
};

/* Props: everything too big for the tile it stands on.
 *
 * These are drawn in the depth-sorted layer with the heroes rather than in
 * the ground pass, which is what lets you walk behind a tree. Bottom-anchored
 * like a hero, so a prop and a person on the same row agree about the floor.
 */
export const PROP_ART = {
  tent: [
    '................................................',
    '........................Y.......................',
    '........................N.......................',
    '........................N.......................',
    '........................N.......................',
    '......................#wWt#.....................',
    '.....................#wwWWt#....................',
    '.....................#wwWWt#....................',
    '....................#wwWWWtt#...................',
    '....................#wwWWWtt#...................',
    '...................#wwwWWWttt#..................',
    '..................#wwwwWWWWttt#.................',
    '..................#wwwwWWWWttt#.................',
    '.................#wwwwWWWWWtttt#................',
    '................#GGGGGGGvvvvvvvv#...............',
    '................#wwwwwWWWWWttttt#...............',
    '...............#wwwwwwWWWWWWttttt#..............',
    '...............#wwwwwwWWWWWWttttt#..............',
    '..............#wwwwwwWWWWWWWtttttt#.............',
    '.............#wwwwwwwWWWWWWWttttttt#............',
    '.............#wwwwwwwWWWWWWWttttttt#............',
    '............#wwwwwwwwWWWWWWWWttttttt#...........',
    '...........#wwwwwwwwWWWWWWWWWtttttttt#..........',
    '...........#wwwwwwwwWW#===#WWtttttttt#..........',
    '..........#wwwwwwwwwWW#===#WWWtttttttt#.........',
    '..........#wwwwwwwwwW#=====#WWtttttttt#.........',
    '.........#GGGGGGGGGGG#=====#vvvvvvvvvvv#........',
    '........#wwwwwwwwwwW#=======#Wtttttttttt#.......',
    '........#wwwwwwwwwwW#=======#Wtttttttttt#.......',
    '.......#wwwwwwwwwwwW#=======#WWtttttttttt#......',
    '.......#wwwwwwwwwww#=========#Wtttttttttt#......',
    '......#wwwwwwwwwwww#=========#Wttttttttttt#.....',
    '.....#wwwwwwwwwwww#===========#tttttttttttt#....',
    '.....#wwwwwwwwwwww#oooooYooooo#tttttttttttt#....',
    '....#wwwwwwwwwwwww#oooyyyyyooo#Wtttttttttttt#...',
    '...#wwwwwwwwwwwww#ooooooooooooo#ttttttttttttt#..',
    '...#wwwwwwwwwwwww#ooooooooooooo#ttttttttttttt#..',
    '..#wwwwwwwwwwwww#ooooooooooooooo#ttttttttttttt#.',
    '..#NGGGGGGGGGGGG#ooooooooooooooo#vvvvvvvvvvvNv#.',
    '.##wwwwwwwwwwwwwwWWWWWWWWWWWWWWWWtttttttttttt#t#',
  ],
  panel: [
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '..############################..',
    '..#BBbBBbBBbBBbMMbBBbBBbBBbBB#..',
    '..#BbBcbBBbBBbBMMBBbBBbBBbBBb#..',
    '..#bBBbcBbBBbBBMMBbBBbBBbBBbB#..',
    '..#BBbBBcBBbBBbMMbBBbBBbBBbBB#..',
    '..#BbBBbBcbBBbBMMBBbBBbBBbBBb#..',
    '..#MMMMMMMcMMMMMMMMMMMMMMMMMM#..',
    '..#BBbBBbBBcBBbMMbBBbBBbBBbBB#..',
    '..#BbBBbBBbBBbBMMBBbBBbBBbBBb#..',
    '..#bBBbBBbBBbBBMMBbBBbBBbBBbB#..',
    '..#BBbBBbBBbBBbMMbBBbBBbBBbBB#..',
    '..#BbBBbBBbBBbBMMBBbBBbBBbBBb#..',
    '..#bBBbBBbBBbBBMMBbBBbBBbBBbB#..',
    '..############################..',
    '.........M............M.........',
    '.........M............M.........',
    '.........M............M.........',
    '.........M............M.........',
    '.........M............M.........',
    '.........M............M.........',
    '.........M............M.........',
    '.........M............M.........',
    '.........M............M.........',
    '.........M............M.........',
    '.......xxxxxxxxxxxxxxxxxx.......',
    '................................',
  ],
  workbench: [
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '........oo...........xxxx.......',
    '.......rrrr.........MMMMMM......',
    '..############################..',
    '..nnnnnnnnnnnnnnnnnnnnnnnnnnnn..',
    '..NNNNNNNNNNNNNNNNNNNNNNNNNNNN..',
    '..############################..',
    '...#N......................N#...',
    '...#N......................N#...',
    '...#N......................N#...',
    '...#N......................N#...',
    '...#N.MMMMMMM..............N#...',
    '...#N......................N#...',
    '...#N......................N#...',
    '...#N......................N#...',
    '...#N......................N#...',
    '...#N......................N#...',
    '..############################..',
  ],
};

/* Three cuts of tree, chosen per tile, so a copse is not one shape repeated. */
export const TREE_ART = [
  [
    '................................',
    '................................',
    '................................',
    '..............#.................',
    '..........###lll###.............',
    '........##lllllllll##...........',
    '.......#lllllllllllgG#..........',
    '......#lllllllllllgGGg#.........',
    '.....#lllllllllllGGGGgG#........',
    '....#lllllllllllGGGGGGGG#.......',
    '....#llllllllllggGGGgGgG#.......',
    '...#llllllllllGGGGGgGGgGv#......',
    '...#lllllllllGGGgggGGGGvv#......',
    '...#llllllllGGGGgGGGGGv#v#......',
    '...llllllllgGGGgGGG##lllll##....',
    '..#lllll#lGggGGgGG#llllllllG#...',
    '...l##lllll##GggG#llllllllGGg#..',
    '...#llllllllG#GG#llllllllGGGGG#.',
    '..#llllllllGGg##llllllllgGGGGGG#',
    '.#llllllllGGGGG#lllllllGgGGGGGg#',
    '#llllllllGggGGGG#lllllGGGGGGgGvv',
    '#lllllllGGgGGGGG#llllGggGggGgvvv',
    'lllllllGGGGGGGGvvlllGGGGggGgvvvv',
    'llllllgGGgGGGGvvvllGGGGGGGGvvvvv',
    'lllllGgGGGGgGvvvv#GGGGGGGGvvvvvv',
    'llllGGGGGGGGvvvvvGGGGGGGgvvvvvv#',
    'lllGGGGgGGGvvvvvvGGgGGGGvvvvvvv#',
    '#lGGgGGGGGvvvvvv#GGGgGgvvvvvvv#.',
    '#GGgGGGGGvvvvvvv##GGGGvvvvvvv#..',
    '.#GGGgGGvvvvvvv#NN#GGvvvvvvv#...',
    '..#GGggvvvvvvv#nNNN##vvvvv##....',
    '...#GGvvvvvvv#nnNNN#...#........',
    '....##vvvvv##nnnNNN#............',
    '........#...#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '........#...#nnnNNN#...#........',
    '........N#..#nnnNNN#..#N........',
    '.........N#.#nnnNNN#.#N.........',
    '..........N##nnnNNN##N..........',
    '...........N#nnnNNN#N...........',
  ],
  [
    '................................',
    '................#...............',
    '............###lll###...........',
    '..........##lllllllll##.........',
    '........##llllllllllllG##.......',
    '.......#lllllllllllllGGGG#......',
    '......#lllllllllllllGgGGGG#.....',
    '......#llllllllllllGGGGgGG#.....',
    '.....#llllllllllllGGGgGGGGG#....',
    '.....#lllllllllllGGgGGGGGGG#....',
    '....#lllllllllllGGGGgGGGGgvv#...',
    '....#llllllllllGgGGgGGGG#vvv#...',
    '....#lll#lllllGGgGGg##lllll##...',
    '....##lllll##gGGgg##lllllllll##.',
    '..##lllllllll##GG#llllllllllGGG#',
    '.#llllllllllgGg##llllllllllgggGG',
    '#llllllllllgGGGG#lllllllllGGgGGG',
    '#lllllllllGGGgG#lllllllllgGGGgGG',
    'lllllllllGgGGGG#llllllllgGGGGGGg',
    'llllllllGGGGGGGllllllllgGGGGGgGv',
    'lllllllggGGGGGGlllllllGGgGGgGGvv',
    'llllllGGGgGgGG#llllllGgGGGGGGvvv',
    'lllllGGggGGGGvvlllllGgGGGGGgvvvv',
    'llllGGGGGgGGvvvllllGgGgGGGGvvvvv',
    'lllGGGGGGGGvvvv#llggggGGGGvvvvvv',
    'llGgGGGgGGvvvvv#lGGGgGGGGvvvvvvv',
    'lGGGgGGGGvvvvvvv#GgGggGGvvvvvvvv',
    '#GGGGGgGvvvvvvvv#GGGggGvvvvvvvvv',
    '#GGGGGGvvvvvvvvv##GGGGvvvvvvvvv#',
    '.#GGGGvvvvvvvvv#NN##Gvvvvvvvv##.',
    '..##gvvvvvvvv##nNNN###vvvvv##...',
    '....##vvvvv##nnnNNN#....#.......',
    '........#...#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '........#...#nnnNNN#...#........',
    '........N#..#nnnNNN#..#N........',
    '.........N#.#nnnNNN#.#N.........',
    '..........N##nnnNNN##N..........',
    '...........N#nnnNNN#N...........',
  ],
  [
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '.................#..............',
    '.............##lllll##..........',
    '...........##lllllllll##........',
    '..........#lllllllllllGg#.......',
    '.........#lllllllllllgGgG#......',
    '.....##lllll##llllllGGGGGG#.....',
    '...##lllllllll##lllGggGgGG#.....',
    '..#llllllllllGGG#lGGGGGGGGv#....',
    '.#llllllllllGggGG#GGgGGGgvv#....',
    '.#lllllllllGGGGGG#GGGGGGvvvv....',
    '#lllllllllGggGGGGG#gGGgvvvvv....',
    '#llllllllGGGGGGGGv#GGGvvvvvv#...',
    'llllllllgGGGGGGGvvvGGv#vvvvv....',
    'lllllllgGGgGGgGvvvv#lllll#vv....',
    'llllllGGGGgGgGvvv#llllllllG#....',
    'lllllGGGGGgGGvvv#llllllllGGG#...',
    'llllGggGGGGgvvvvllllllllGGGGG...',
    '#llGGGGGgGGvvvv#lllllllGgggGG#..',
    '#lGGGGGGggvvvvvlllllllgGGGgGvv..',
    '.#GGGGGGGvvvvvvllllllGGGGgGvvv..',
    '.#GgGGGgvvvvvv#lllllGgGgGGvvvv#.',
    '..#gGGGvvvvvvvvllllGGgGgGvvvvv..',
    '...##gvvvvvvvv#lllgGGgGgvvvvvv..',
    '.....##vvvvv##n#lgGGGgGvvvvvv#..',
    '.........#..#nnnGGGGGGvvvvvvv...',
    '............#nnn#GGGGvvvvvvv#...',
    '............#nnnN#GGvvvvvvv#....',
    '............#nnnNNN#vvvvv#......',
    '............#nnnNNN#..#.........',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '........#...#nnnNNN#...#........',
    '........N#..#nnnNNN#..#N........',
    '.........N#.#nnnNNN#.#N.........',
    '..........N##nnnNNN##N..........',
    '...........N#nnnNNN#N...........',
  ],
];

/* The fire, three frames. The only thing on the map that never stops. */
export const FIRE_ART = [
  [
    '................',
    '................',
    '...........Y....',
    '.....o..........',
    '........y.......',
    '........o.......',
    '.......ooo......',
    '.......YYY......',
    '......YYyYY.....',
    '......YYyYY.....',
    '.....YYyyyYY....',
    '.....YYyyyYY....',
    '....nnNnnNnn....',
    '.#.xxxxxxxxxx.#.',
    '..MMMMMMMMMMMM..',
    '................',
  ],
  [
    '................',
    '................',
    '................',
    '.........y......',
    '..........o.....',
    '.........ooo....',
    '........YYY.....',
    '.......YYyYY....',
    '.......YYyYY....',
    '.......YYyYY....',
    '.....YYyyyYY....',
    '.....YYyyyYY....',
    '....nnNnnNnn....',
    '.#.xxxxxxxxxx.#.',
    '..MMMMMMMMMMMM..',
    '................',
  ],
  [
    '................',
    '................',
    '.........Y......',
    '.......o........',
    '................',
    '.......y........',
    '.....ooo........',
    '......ooo.......',
    '.....YYyYY......',
    '.....YYyYY......',
    '.....YYyyyYY....',
    '.....YYyyyYY....',
    '....nnNnnNnn....',
    '.#.xxxxxxxxxx.#.',
    '..MMMMMMMMMMMM..',
    '................',
  ],
];

/* The canonical tile for each kind: the first cut.
 *
 * Derived rather than written twice, so a kind can never end up with a
 * variant list and a different-looking single tile. Anything that wants one
 * tile per kind — the tests, a legend, a tooltip — reads this.
 */
export const TERRAIN_ART = Object.fromEntries(
  Object.entries(TERRAIN_VARIANTS).map(([kind, cuts]) => [kind, cuts[0]])
);

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
