/* Save Solarium — sprite art.
 *
 * 24 wide and 32 tall. Rows of palette keys; '.' and ' ' are transparent. No
 * image files: the art is text, so a character can be edited in place and diffs
 * actually mean something.
 *
 * Taller than wide is the whole trick. At 24x24 a full body left a head nine
 * pixels across, which holds two eyes and a mouth and nothing else — that is
 * why the old cast read as dolls. Eight more rows buy a twelve-pixel head with
 * room for brows, a nose and a jaw, which is the difference between a face and
 * two dots. It is the proportion Stardew uses, and it is the reason its
 * villagers read as people at a glance.
 *
 * The style follows Stardew's rules rather than a generic pixel look — dark
 * warm-brown outlines instead of black, two-tone shading, saturated but soft
 * colour, and readable silhouettes at small sizes. The Solarium is meant to
 * feel like somewhere worth saving, so the palette is warm and bright even for
 * the things trying to eat you.
 *
 * `anim.split` is the row where a sprite's body starts. The client shifts
 * everything above it by a pixel to make an idle breath, which gives real
 * frame animation without hand-drawing a second frame for every character.
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

/* Every sprite ends up on the same 32-row canvas, padded at the top rather than
   the bottom, so a knee-high rust mite and a standing knight share a ground
   line instead of floating at different heights. Shorter creatures are written
   at whatever height suits them and grounded here; split and eye positions are
   shifted by the same padding so nothing has to know it happened. */
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

/* One skeleton under the whole cast, so they read as the same species at a
 * glance and a change to one can be reasoned about for all:
 *
 *   rows 1-12   head, 12 wide at columns 6-17, with hair or helm down the
 *               sides at 7 and 16 framing an 8-wide face
 *   row  13     neck
 *   rows 14-23  torso at columns 7-16, arms at 4-5 and 18-19 held off it by
 *               their own outline column, hands at row 20, belt at 21
 *   rows 24-30  legs and boots, split at the hips
 *
 * The face is what the extra height bought: brows at row 4, a two-pixel eye at
 * rows 6-7 with the pupil out and a highlight in, a nose at row 8, cheeks at 9
 * and a mouth at 10. Weapons start at the hand that holds them.
 */

export const HERO_ART = {
  // Goggles pushed up on the forehead, orange work suit, tool belt.
  engineal: sprite([
    '........................',
    '......############......',
    '......#nnnnnnnnnn#......',
    '......#cccccccccc#......',
    '......#nsNNssNNsn#......',
    '......#nssssssssn#......',
    '......#ns==ss==sn#......',
    '......#ns=wssw=sn#......',
    '......#nsssSSsssn#......',
    '......#nNssssssNn#......',
    '......#nNss==ssNn#......',
    '......#nNNssssNNn#......',
    '.......#NNNNNNNN#.......',
    '..........#ss#..........',
    '...#oO#oOOOOOOOOO#oO#...',
    '...#oO#owwOOOOwwO#oO#...',
    '...#oO#oOOOyyOOOO#oO#...',
    '...#oO#oOOyyyyOOO#oO#...',
    '...#oO#oOOOyyOOOO#oO#...',
    '...#oO#oOOOOOOOOO#oO#...',
    '...#ss#oOOOOOOOOO#ss#...',
    '...####ottttttttO####...',
    '......#oTTTTTTTTO#......',
    '......#oOOOOOOOOO#......',
    '......#OOO#..#OOO#......',
    '......#OOO#..#OOO#......',
    '......#OOO#..#OOO#......',
    '......#NNN#..#NNN#......',
    '......#NNN#..#NNN#......',
    '......#NNN#..#NNN#......',
    '......#####..#####......',
    '........................'
  ], 14, [[10,7],[13,7]]),

  // Leaf sprigs either side of the hair, pale robe, green at the hem.
  mistypalm: sprite([
    '........................',
    '......############......',
    '.....l#nnnnnnnnnn#l.....',
    '....lg#nnnnnnnnnn#gl....',
    '......#nsNNssNNsn#......',
    '......#nssssssssn#......',
    '......#ns==ss==sn#......',
    '......#n==wssw==n#......',
    '......#nsssSSsssn#......',
    '......#nSssssssSn#......',
    '......#nsss==sssn#......',
    '......#nssssssssn#......',
    '.......#ssssssss#.......',
    '..........#ss#..........',
    '...#wW#nwwwwwwwwn#wW#...',
    '...#wW#nwwwwwwwwn#wW#...',
    '...#wW#nwwllllwwn#wW#...',
    '...#wW#nwwllllwwn#wW#...',
    '...#wW#nwwwwwwwwn#wW#...',
    '...#wW#wwwwwwwwwW#wW#...',
    '...#ss#wwwwwwwwwW#ss#...',
    '...####wWWWWWWWWW####...',
    '......#wWWWWWWWWW#......',
    '......#wWWWWWWWWW#......',
    '......#WWW#..#WWW#......',
    '......#WWW#..#WWW#......',
    '......#WWW#..#WWW#......',
    '......#ggg#..#ggg#......',
    '......#ggg#..#ggg#......',
    '......#ggg#..#ggg#......',
    '......#####..#####......',
    '........................'
  ], 14, [[10,7],[13,7]]),

  /* An actual turtle: a hooked beak, a scuted shell that overhangs the body the
     way a carapace does, and wide flat feet. The shell being wider than he is
     is the whole silhouette — it is what stops him reading as a green person. */
  turt: sprite([
    '........................',
    '........########........',
    '.......##GGGGGG##.......',
    '.......#GgGGGGgG#.......',
    '.......#gNNggNNg#.......',
    '.......#gggggggg#.......',
    '.......#g==gg==g#.......',
    '.......#g=wggw=g#.......',
    '.......#gggyyggg#.......',
    '.......#ggyYYygg#.......',
    '.......#gggGGggg#.......',
    '........#GGGGGG#........',
    '.........#GGGG#.........',
    '..........#GG#..........',
    '..#GGG#GGGGGGGGGG#GGG#..',
    '.#llllllllllllllllllll#.',
    '.#lvvGGvvGGvvGGvvGGvvl#.',
    '.#lGGvvGGvvGGvvGGvvGGl#.',
    '.#lvvGGvvGGvvGGvvGGvvl#.',
    '.#lGGvvGGvvGGvvGGvvGGl#.',
    '.#llllllllllllllllllll#.',
    '..#gg#GGGGGGGGGGGG#gg#..',
    '..####GGGGGGGGGGGG####..',
    '......#GGGGGGGGGG#......',
    '......#GGG#..#GGG#......',
    '......#GGG#..#GGG#......',
    '......#vvv#..#vvv#......',
    '.....##vvv#..#vvv##.....',
    '.....#vvvv#..#vvvv#.....',
    '.....######..######.....',
    '........................',
    '........................'
  ], 14, [[10,7],[13,7]]),

  // Hair escaping the hood and a tail behind it; one short blade in her hand.
  defty: sprite([
    '........................',
    '......############......',
    '......#BBBBBBBBBB#......',
    '......#BbbbbbbbbB###....',
    '......#BnNNssNNnB#n#....',
    '......#BnssssssnB#n#....',
    '......#Bn==ss==nB#n#....',
    '......#Bn=wssw=nB#n#....',
    '......#BnssSSssnB#n#....',
    '......#BnSssssSnB#N#....',
    '......#Bnss==ssnB#N#....',
    '......#BnssssssnB#N#....',
    '.......#cccccccc#.##....',
    '.........#cccc#.........',
    '...#bB#bbbbbbbbbb#bB#...',
    '...#bB#bccccccccb#bB#...',
    '...#bB#bbbbbbbbbb#bB#...',
    '...#bB#bbBBBBBBbb#bB#...',
    '...#bB#bbbbbbbbbb#bB#...',
    '...#bB#bbbbbbbbbb#bB#...',
    '...#ss#bbbbbbbbbb#ss#...',
    '...####bBBBBBBBBb#NN#...',
    '......#bBBBBBBBBb#cc#...',
    '......#bBBBBBBBBb#mm#...',
    '......#bbb#..#bbb#mm#...',
    '......#bbb#..#bbb#mM#...',
    '......#bbb#..#bbb#.#....',
    '......#NNN#..#NNN#......',
    '......#NNN#..#NNN#......',
    '......#NNN#..#NNN#......',
    '......#####..#####......',
    '........................'
  ], 14, [[10,7],[13,7]]),

  // Reclaimed plate, sun plume, very good manners.
  mrknight: sprite([
    '.........#YY#...........',
    '........#YYYY#..........',
    '......############......',
    '......#mMMMMMMMMm#......',
    '......#MsNNssNNsM#......',
    '......#MssssssssM#......',
    '......#Ms==ss==sM#......',
    '......#Ms=wssw=sM#......',
    '......#MsssSSsssM#......',
    '......#MSssssssSM#......',
    '......#Msss==sssM#......',
    '......#MssssssssM#......',
    '.......#MMMMMMMM#.......',
    '........#MMMMMM#........',
    '...#mM#mMMMMMMMMM#mM#...',
    '...#mM#myyyyyyyyM#mM#...',
    '...#mM#myYYYYYYyM#mM#...',
    '...#mM#myYYYYYYyM#mM#...',
    '...#mM#mMyyyyyyMM#mM#...',
    '...#mM#mMMMMMMMMM#mM#...',
    '...#ss#mMMMMMMMMM#ss#...',
    '...####mxxxxxxxxM#NN#...',
    '......#mxxxxxxxxM#YY#...',
    '......#mMMMMMMMMM#mm#...',
    '......#MMM#..#MMM#mm#...',
    '......#MMM#..#MMM#mM#...',
    '......#MMM#..#MMM#.#....',
    '......#xxx#..#xxx#......',
    '......#xxx#..#xxx#......',
    '......#xxx#..#xxx#......',
    '......#####..#####......',
    '........................'
  ], 14, [[10,7],[13,7]])
};

/* ============================================================= enemies === */

export const ENEMY_ART = {
  // Scuttling rust crab. Small, quick, everywhere.
  rustmite: sprite([
    '........................',
    '........................',
    '.....##..........##.....',
    '....#rr#........#rr#....',
    '....#rR#........#Rr#....',
    '.....#rr########rr#.....',
    '......#rrrrrrrrrr#......',
    '.....#rrrrrrrrrrrr#.....',
    '....#rreerrrrrreerr#....',
    '....#rrrrrrrrrrrrrr#....',
    '....#RrrrrrrrrrrrrR#....',
    '....#RRrrrrrrrrrrRR#....',
    '.....#RRRrrrrrrRRR#.....',
    '....#R#RRRRRRRRRR#R#....',
    '...#R#..#RR##RR#..#R#...',
    '...##....##..##....##...',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................'
  ], 6),

  // Smog given a face. Drifts, never quite settles.
  smogwisp: sprite([
    '........................',
    '.........#####..........',
    '.......##xxxxx##........',
    '......#xxxxxxxxx#.......',
    '.....#xxxxxxxxxxx#......',
    '....#xxeexxxxxeexx#.....',
    '....#xxeexxxxxeexx#.....',
    '....#xxxxxxxxxxxxx#.....',
    '....#xxxxxxxxxxxxx#.....',
    '.....#xxxxxxxxxxx#......',
    '.....#MxxxxxxxxxM#......',
    '......#MxxxxxxxM#.......',
    '.......#MxxxxxM#........',
    '........#MxxxM#.........',
    '.........#MxM#..........',
    '..........#M#...........',
    '...........#............',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................'
  ], 8),

  // Somebody's dog, rebuilt out of a fence and a grudge.
  scraphound: sprite([
    '........................',
    '...##..............##...',
    '..#MM#............#MM#..',
    '..#Mx#............#xM#..',
    '..#MMM############MMM#..',
    '..#MMMMMMMMMMMMMMMMMM#..',
    '.#MMeeMMMMMMMMMMMMeeMM#.',
    '.#MMeeMMMMMMMMMMMMeeMM#.',
    '.#MMMMMM########MMMMMM#.',
    '.#MMMMM#xxxxxxxx#MMMMM#.',
    '.#xMMMM##########MMMMx#.',
    '..#xMMMMMMMMMMMMMMMMx#..',
    '..#xxMMMMMMMMMMMMMMxx#..',
    '...#xxMMMMMMMMMMMMxx#...',
    '...#x#MM#....#MM#.#x#...',
    '...###MM#....#MM#.###...',
    '.....#xx#....#xx#.......',
    '.....####....####.......',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................'
  ], 8),

  // Bipedal drill. The polite end of the Extractor's family.
  drillmech: sprite([
    '........................',
    '.....##############.....',
    '....#MMMMMMMMMMMMMM#....',
    '...#MMMMMMMMMMMMMMMM#...',
    '...#MM####MMMM####MM#...',
    '...#MM#ee#MMMM#ee#MM#...',
    '...#MM####MMMM####MM#...',
    '...#MMMMMMMMMMMMMMMM#...',
    '...#MMMM##########MM#...',
    '...#MMM#rrrrrrrrrr#MM#..',
    '...#MMM#RRRRRRRRRR#MM#..',
    '...#MMMM##########MM#...',
    '...#MMMMMMMMMMMMMMMM#...',
    '....#xMMMMMMMMMMMMx#....',
    '.....#xxMMMMMMMMxx#.....',
    '......#xx#....#xx#......',
    '......#xx#....#xx#......',
    '......####....####......',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................'
  ], 8),

  // 32x32. The thing the Solarium is being saved from.
  extractor: sprite([
    '................................',
    '......####################......',
    '....##xxxxxxxxxxxxxxxxxxxx##....',
    '...#xxxxxxxxxxxxxxxxxxxxxxxx#...',
    '..#xxxxMMMMMMMMMMMMMMMMxxxxxx#..',
    '..#xxxMM################MMxxxx#.',
    '..#xxMM#eeee#MMMM#eeee#MMxxxxx#.',
    '..#xxMM#eeee#MMMM#eeee#MMxxxxx#.',
    '..#xxMM################MMxxxxx#.',
    '..#xxxMMMMMMMMMMMMMMMMMMxxxxxx#.',
    '..#xxxxMMMMMMMMMMMMMMMMxxxxxxx#.',
    '.#xxxxxxMM############MMxxxxxxx#',
    '.#xxxxxxM#RRRRRRRRRRRR#Mxxxxxxx#',
    '.#xxxxxxM#rrrrrrrrrrrr#Mxxxxxxx#',
    '.#xxxxxxM#RRRRRRRRRRRR#Mxxxxxxx#',
    '.#xxxxxxMM############MMxxxxxxx#',
    '.#xxxxxxxxMMMMMMMMMMMMxxxxxxxxx#',
    '.#xxxxxxxxxxxxxxxxxxxxxxxxxxxxx#',
    '.#xxMMxxxxxxxxxxxxxxxxxxxxMMxxx#',
    '.#xMMMMxxxxxxxxxxxxxxxxxxMMMMxx#',
    '.#xMMMMxxxxxxxxxxxxxxxxxxMMMMxx#',
    '..#MMMMxxxxxxxxxxxxxxxxxxMMMM#..',
    '..#xMMxxxxxxxxxxxxxxxxxxxxMMx#..',
    '..#xxxxxxxxx########xxxxxxxxx#..',
    '...#xxxxxxx#RRRRRRRR#xxxxxxx#...',
    '...#xxxxxxx#rrrrrrrr#xxxxxxx#...',
    '....#xxxxxx#RRRRRRRR#xxxxxx#....',
    '.....#xxxx##########xxxxxx#.....',
    '......#xxx#........#xxxx#.......',
    '......#xxx#........#xxxx#.......',
    '......#####........######.......',
    '................................'
  ], 11)
};

/* ================================================== card icons (16x16) === */
/* Drawn on the card face so a hand reads at a glance, not by reading text. */

export const ICON_ART = {
  sword:  ['................','.......##.......','......#mm#......','......#mm#......','......#mm#......','......#mm#......','......#mm#......','.....#mmmm#.....','....##YYYY##....','......#nn#......','......#nn#......','.......##.......','................','................','................','................'],
  blade:  ['................','..........##....','.........#mm#...','........#mm#....','.......#mm#.....','......#mm#......','.....#mm#.......','....#mm#........','...#nn#.........','..#nn#..........','..##............','................','................','................','................','................'],
  shield: ['................','....########....','...#mmmmmmmm#...','...#mmYYYYmm#...','...#mmYwwYmm#...','...#mmYYYYmm#...','...#mmmmmmmm#...','....#mmmmmm#....','.....#mmmm#.....','......#mm#......','.......##.......','................','................','................','................','................'],
  shell:  ['................','.....######.....','...##GGGGGG##...','..#GGvvvvvvGG#..','..#GvGGllGGvG#..','..#GvGGllGGvG#..','..#GGvvvvvvGG#..','...##GGGGGG##...','.....######.....','................','................','................','................','................','................','................'],
  fist:   ['................','.....######.....','....#SSSSSS#....','...#SssssssS#...','...#SssssssS#...','...#SssssssS#...','....#SSSSSS#....','.....#nnnn#.....','.....#nnnn#.....','......####......','................','................','................','................','................','................'],
  drop:   ['................','.......##.......','.......cc.......','......#cc#......','.....#cccc#.....','....#cccccc#....','....#ccwwcc#....','....#cccccc#....','.....#cccc#.....','......####......','................','................','................','................','................','................'],
  leaf:   ['................','.........##.....','........#ll#....','.......#llgl#...','......#llggl#...','.....#llgggl#...','....#llgggG#....','...#llgggG#.....','...#GgggG#......','....#GGG#.......','.....#G#........','.....#G#........','......#.........','................','................','................'],
  thorn:  ['................','......##........','.....#Gg#.......','....#Ggg#.......','...#Gggg#.......','...#Ggg#........','....#Gg#..##....','.....#G#.#Gg#...','.....#G#.#Gg#...','......#G##Gg#...','.......#GGg#....','........###.....','................','................','................','................'],
  sun:    ['....#........#..','.....#..##..#...','......#YYYY#....','...#..#YYYY#..#.','......#YYYY#....','..#..#YYYYYY#..#','....#YYyyyyYY#..','....#YyywwyyY#..','....#YYyyyyYY#..','..#..#YYYYYY#..#','......#YYYY#....','...#..#YYYY#..#.','......#..##..#..','....#........#..','................','................'],
  bolt:   ['................','........##......','.......#Y#......','......#YY#......','.....#YY#.......','....#YYYYY#.....','....#YYYYY#.....','.......#YY#.....','......#YY#......','.....#YY#.......','.....##.........','................','................','................','................','................'],
  gear:   ['................','....#..##..#....','....#######.....','...#MMMMMMM#....','..##MM###MM##...','..#MM#...#MM#...','..#MM#...#MM#...','..##MM###MM##...','...#MMMMMMM#....','....#######.....','....#..##..#....','................','................','................','................','................'],
  panel:  ['................','..############..','..#bbbbbbbbbb#..','..#b#b#b#b#b#b..','..#bbbbbbbbbb#..','..#b#b#b#b#b#b..','..#bbbbbbbbbb#..','..############..','.....#MMMM#.....','.....#MMMM#.....','................','................','................','................','................','................'],
  loop:   ['................','.....######.....','...##YYYYYY##...','..#YY#....#YY#..','..#Y#......#Y#..','..#Y#......#Y#..','..#YY#....#YY#..','...##YYYYYY##...','.....######.....','........##......','.......#YY#.....','........##......','................','................','................','................'],
  dust:   ['................','..#....#...#....','....##...#......','..#..r#..#..#...','.....rr..r......','..#.rrrr.rr.#...','....rrrrrrr.....','...rrrrrrrrr....','....rrrrrrr.....','..#.rrrr.rr.#...','.....rr..r......','..#..r#..#..#...','....##...#......','..#....#...#....','................','................'],
  smoke:  ['................','.......##.......','.....##MM##.....','...##MMMMMM##...','..#MMMMMMMMM#...','..#MMMMMMMMM#...','...##MMMMMM##...','.....##MM##.....','.......##.......','................','................','................','................','................','................','................']
};
