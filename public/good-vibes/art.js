/* Good Vibes — sprite art.
 *
 * 32 wide and 40 tall, rows of palette keys, '.' transparent. No image files:
 * the art is text, so a character can be edited in place and a diff of a
 * change to someone's face is readable.
 *
 * (This said 24x32 for a long time after the grid had grown, and the column
 * numbers in the skeleton below said 24 too. Anyone authoring from those wrote
 * a sprite that failed the suite, or worse, one that passed while sitting two
 * pixels off centre. If the grid changes again, this line changes with it.)
 *
 * The conventions are Save Solarium's, deliberately — the two games sit on the
 * same shelf and should look like the same world. In short:
 *
 *   Taller than wide. At 24x24 a full body leaves a head nine pixels across,
 *   which holds two eyes and nothing else. The extra rows buy a head with room
 *   for brows, a nose and a jaw, which is the difference between a face and
 *   two dots. Stardew's proportion, for Stardew's reason.
 *
 *   And spend them on the BODY, not the head. The cast was 2.7 heads tall for
 *   a long while — a head of fifteen rows in a figure of forty — which reads
 *   as a bobblehead however well the face is drawn. It is 3.5 now.
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
 * It has since grown past Solarium's: this game is mostly outdoors, and the
 * greens are where the extra keys went. Everything the two share is identical,
 * so a sprite copied across still looks like itself.
 */

export const PALETTE = {
  '#': '#3a2418',   // outline, warm dark brown
  '=': '#5c4029',   // secondary outline / deep shadow

  s: '#ffd9ae', S: '#d9a274',           // skin, skin shadow
  n: '#a06a3c', N: '#6b4223',           // hair / leather
  w: '#fffaf0', W: '#d8ccb4',           // white, cream shadow

  y: '#fff3b0', Y: '#ffd23f',           // sunlight, sun
  o: '#f59a2e', O: '#c96a17',           // orange, deep orange

  /* The green ramp, light to dark. Ten steps rather than four, because the
     ground is mostly green and four could only be laid down as speckle on a
     flat field — the eye reads that as one colour with dirt on it. Ten lets a
     tile be dithered between neighbouring shades, which reads as texture.
     Three hues share the ramp: warm yellow-green in the light, true green
     through the middle, cool blue-green in the shade, plus a dry olive pair
     for the parts the sun has had its way with. */
  l: '#c3ec86', h: '#9ad966', g: '#6cc24a', H: '#55a841', G: '#3f8f38', v: '#245c2c',
  f: '#5bb37d', F: '#2f7a52',           // cool green, cool green shadow
  a: '#a8b45e', A: '#7a8a3c',           // dry olive, dry olive shadow

  /* Meltwater, light to deep, with one teal stepped off the line. A ramp that
     only darkens reads as a painted floor; water needs somewhere for the hue
     to go as well. */
  c: '#9fe9ee', u: '#63cbe0', q: '#3fbfb0', b: '#3fa9dd', U: '#2b7fb5', B: '#20629f', d: '#154a78',

  p: '#d2a6f0', P: '#8a5bb8',                               // petal, violet

  m: '#e2e9ec', M: '#9aa9b2', j: '#7b8992', x: '#5b6a72', J: '#414f59',   // steel, light to dark
  r: '#d4702f', R: '#8f3f1a',                               // rust, deep rust
  i: '#d0bb8b', t: '#b39a63', I: '#8e7748', T: '#6f5c34',   // dust, light to dark
  k: '#1e1a1f',                                             // void, the floor of a crevice
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

/* One skeleton under the whole cast, so they read as the same species — and
 * only the skeleton. Three of these classes were once BYTE-IDENTICAL in
 * outline and told apart purely by colour, which is no use at all on a map
 * where a hero is sixteen pixels tall. What is shared is the build; what is
 * not is the shape.
 *
 * Shared:
 *   rows 1-11   head, about 11 rows, framed by hair or a hood
 *   row  12-13  neck
 *   rows 14-25  torso and arms
 *   rows 26-30  belt and hips
 *   rows 31-39  legs and boots, sole on row 39
 *
 *   The face is lit from the upper left and modelled with the warm ladder
 *   w > s > W > i > S > t > I > n > T > N rather than with two tones. Brow,
 *   a two-pixel eye with the pupil out and a highlight in, a nostril shadow,
 *   a mouth, a lit chin. Vary brow angle, eye spacing, jaw width and
 *   complexion between classes — never the skull.
 *
 * Not shared, and deliberately: the silhouette. The Engineer is widest at the
 * deltoids with goggles pushed up so the head is wider above the brow than
 * below it; the Wizard is a triangle with no leg gap; the Hauler's pack breaks
 * the outline above the shoulders; the Grafter's hat brim overhangs and its
 * legs are staggered; the Alchemist is the leanest, with a crossed forearm.
 *
 * Two mechanics constrain all of it. `lift` draws every row above `split` one
 * pixel higher and nothing refills the line that vacates, so the figure tears
 * a 1px gap as wide as row (split - 1) is painted — put the split at a waist,
 * and separate arms from the torso with a TRANSPARENT column rather than a '#'
 * one, which is ink and tears with everything else. `flip` mirrors by reading
 * the columns backwards with no exception list, so anything asymmetric swaps
 * sides when walking left; no class read may depend on which side it is on.
 */

export const HERO_ART = {
  /* The Alchemist. The leanest of the five and slightly stooped, which is what
     someone who spends the day bent over a bench looks like. The read from
     across the map is the bandolier running shoulder to hip with a cyan and a
     gold bottle on it, the apron flaring below the belt, and the crossed
     forearm holding a flask up beside the chin — that cocked elbow is the
     asymmetry, and it survives being mirrored when walking left. */
  alchemist: sprite([
    '..........##########............',
    '.........##pppPPPPP##...........',
    '.........#ppppppPPPP#...........',
    '.........#psswssiStP#...........',
    '.........#psnnssnnSP#...........',
    '.........#pi#WssW#tP#...........',
    '.........#psiSssSStP#...........',
    '.........#pssssSiitP#...........',
    '.........#PissnnSitP#...........',
    '.........##psssSStP##...........',
    '.........##ppP=PPPp#............',
    '.........#=N#iStT###............',
    '........##mM#iStT####...........',
    '........#mwpPissiGWi##..........',
    '.....####mppPissiGWnN####.......',
    '.....#WiWmpPPHHHGGnNtWiW#.......',
    '.....#wW#MpPsswGGnNvi#Ww#.......',
    '.....#Wi#=PPsswSnNvvi#iW#.......',
    '.....#sS#n=n#sswSGvvi#St#.......',
    '.....#sS#mwcy##ssSSvi#St#.......',
    '.....#st#wcuYYO##ssSS#St#.......',
    '.....#sS#ccuYOOGG###sSSt#.......',
    '.....#ss#cuUYORGGGvv=SSt#.......',
    '.....#sS#=UUOR=GGGvv#=S##.......',
    '.....#####nN=R=GGGvvi####.......',
    '........#=NNNNoYNNNN=#..........',
    '.......##ghhHHGGGvvv=#..........',
    '.......#gghhHHGGGvvv=#..........',
    '......##gghHHGGvGGvvv##.........',
    '.....##gghHHGGvvGGGvvv##........',
    '.....#ggghHHGvvGGGvvvv=#........',
    '.....#GgHHGGvvGGGGvvvv=#........',
    '.....#####tITT###tITT###........',
    '.........#tITT#.#tITT#..........',
    '.........#t=TT#.#t=TT#..........',
    '........##tITT#.#tITT##.........',
    '........#nnNN=#.#nNN==#.........',
    '........#nN===#.#N====#.........',
    '........#######.#######.........',
  ], 26, [[12, 5], [17, 5]]),

  /* The Engineer. The broadest, 28 pixels across the deltoids, planted square.
     Goggles pushed up onto the forehead rather than worn — the head is genuinely
     wider above the brow than below it, so the outline says it before the colour
     does — a tool belt at the split, and a ring wrench hanging low and clear of
     the leg. */
  engineer: sprite([
    '........################........',
    '........#xMmmMMjjMMMMMx#........',
    '........#xJmJJJjjJJmJJx#........',
    '.........#nissssWWiitN#.........',
    '.........#ntIItiitIITN#.........',
    '.........#nS#wissiw#tN#.........',
    '.........#ntSisssiiStN#.........',
    '.........#ntSiisiSiStN#.........',
    '.........#ntiStsitSStN#.........',
    '.........#ntSitIItiStN#.........',
    '..........#tSissWiStI#..........',
    '.........####ItSStI####.........',
    '........#OR##ItSStI##RO#........',
    '......##OrroMjMmmMjMrrrO##......',
    '....##ooroorRRRRRRRrOOORrO##....',
    '..##ooooRooorRRRRROrrOOROrOR##..',
    '..#Oroor#roMMrrRRrrOOOR#OrOOR#..',
    '...#OOrr#rooorrRRrrOORR#OORR#...',
    '....#Orr##roorrRRrrOOR##OOR#....',
    '.....#Mj#.#roorRRrrOR#.#jM#.....',
    '.....#St#.#==N====N==#.#tS#.....',
    '....#Ss#.#=NYyYN==jMj=#.#sS#....',
    '....#Ss#.#N=YYY=N=jj=N#.#sS#....',
    '....#sS#.#==NYN===xx==#.#Ss#....',
    '..##sS#..#jjxxxxxJJJJJ#.#Sss#...',
    '..#Ssn#..#jxxxx##JJJJJ#.#nsS#...',
    '..#nSn#..#jxxJ#..#JxxJ#.#####...',
    '..#mM#..#jjxxJ#..#Jxxjj#........',
    '..#mM#..#jjxxJ#..#Jxxjj#........',
    '..#mM#..#jxxJJ#..#JJxxj#........',
    '.#MmmM#.#jxxJ#....#JxxJ#........',
    '.#M##M#.#jxxJ#....#JxxJ#........',
    '.#MmmM#.#jxxJ#....#JxxJ#........',
    '.######.#jxxJ#....#JxxJ#........',
    '........#TT=N#....#N=TT#........',
    '......##ttTNN#....#NNTtt##......',
    '......#TtTNNN#....#NNNTtT#......',
    '......#NNNN==#....#==NNNN#......',
    '......########....########......',
  ], 20, [[12, 5], [19, 5]]),

  /* The Wizard. The only triangle in a cast of rectangles: 14 wide at the cowl,
     cinched to 10 at the sash, opening to 20 at the hem with no leg gap at all.
     It was the flattest sprite in the game at nine palette keys total; the robe
     folds are shaded now. */
  wizard: sprite([
    '...........................yy...',
    '.........................yYwwYy.',
    '............########.....yYwYYy.',
    '..........##ppPPPPPB##....yYYy..',
    '.........#ppPtSiiSIPPB#....#IT#.',
    '.........#pPTiissiiTPB#....#IT#.',
    '.........#pSTTissiTTSP#....#TN#.',
    '.........#piS#wssw#SiP#....#TN#.',
    '.........#piSissssiSiP#....#IT#.',
    '.........#piisWwSssiiP#....#IT#.',
    '.........#pSisswnssiSP#....#IT#.',
    '.........#pSissNNssiSP#....#IT#.',
    '.........#pPSiswwsiSPP#....#TN#.',
    '..........#PP=nSSn=PP#.....#IT#.',
    '..........#PPP=nn=PPP#.....#IT#.',
    '.........#mmmmmmmMMMMM#....#IT#.',
    '.........#ppPPPmMPPPPB#....#IT#.',
    '..........#pPPPmMPPPB#######TN#.',
    '..........#pPPPmMPPBB#pPmssSTN#.',
    '..........#pPPPmMPPBd#PBMSSnn=#.',
    '..........#pPPPmMPPBB#######nN#.',
    '...........#pPPmMPBB#......#nN#.',
    '...........#mmMyYMMj#......#mM#.',
    '...........#pPPPPPPB#......#Nn#.',
    '..........#pPPPPPpBPB#.....#IT#.',
    '..........#pPPPPPpBPB#.....#TN#.',
    '..........#pPPPPPpBPB#.....#IT#.',
    '.........#ppPpBPPpBPBB#....#IT#.',
    '.........#ppPpBPPpBPBB#....#IT#.',
    '.........#ppPpBPPpBPBB#....#IT#.',
    '........#ppPpBPPPpBPPBd#...#TN#.',
    '........#ppPpBPPPpBPPBd#...#TN#.',
    '........#ppPpBPPPpBPPBd#...#IT#.',
    '.......#ppBPpBPPPPpBPBBd#..#IT#.',
    '.......#ppBPpBPPPPpBPBBd#..#IT#.',
    '.......#ppBPpBPPPPpBPBBd#..#IT#.',
    '......#ppPPPpBPPPPpBPPBBd#.#TN#.',
    '......#mmmmmmMmmmmmMmmMMj#.#IT#.',
    '......#PPBBBPdBBBBPdBBddd#.#N=#.',
    '......####################.#==#.',
  ], 22, [[13, 7], [18, 7]]),

  /* The Hauler. The only silhouette broken ABOVE the shoulders — the loaded pack
     rises behind the head, which is the whole read at a distance — with a strap
     over each shoulder and a forward lean from the weight. 70% of the cell grid
     is painted, against 47% for the leanest, and that is the class. */
  hauler: sprite([
    '......############..............',
    '.....#iixiiiiiixii#.............',
    '....#ttiMjiiiijMitt#............',
    '....#tiittttttttiit#............',
    '....#ittIT##############........',
    '....#ittIT#=kk======kk=#........',
    '....#ittIT#k=nSsswssS=k#........',
    '....#iMjIT#knTNTSSTNTnk#........',
    '....#ittIT#nS#wSSSSw#Sn#........',
    '....#ITTNN#TnTWSsiSWTnT#........',
    '....#ittIT#TSnSTsiTSnST#........',
    '....#ittIT#nnSsNttNsSnn#........',
    '....#ittIT##SWt====tWS##........',
    '....#ittIN###nSssSSnT###........',
    '....#ITTNN####TnnnnT####........',
    '.#############TNnnNT###########.',
    '.#it#dBBUUTIddddddddITUUBBd#ti#.',
    '.#it#dBUUbUTIBBBBBBITUbUUBd#ti#.',
    '.#it#dBUbbUUTIMjjMITUUbbUBd#ti#.',
    '.#it#dBUb#UUUTIBBITUUU#bUBd#ti#.',
    '.#it#dBUb#UUTIUUUUITUU#bUBd#ti#.',
    '.#jI#dBUb#UTIUUUUUUITU#bUBd#Ij#.',
    '.#it#dBUB#TIUUUUUUUUIT#BUBd#ti#.',
    '.#TT#dBUB#UdBdUUUUdBdU#BUBd#TT#.',
    '.#IT#dBUB#UdddUUUUdddU#BUBd#TI#.',
    '.####====###dBBBBBBd###====####.',
    '....#=NN=#.#ItMjjMtI#.#=NN=#....',
    '....#nSsn##ItNNNNNNtI##nsSn#....',
    '....#SssS#dBBUUUUUUBBd#SssS#....',
    '....######dBUUd##dUUBd######....',
    '.......#JxxxxJ#..#JxxxxJ#.......',
    '.......#JxMxxJ#..#JxxMxJ#.......',
    '.......#JxxxxJ#..#JxxxxJ#.......',
    '.......#JIttIJ#..#JIttIJ#.......',
    '.......#JITTIJ#..#JITTIJ#.......',
    '.......#N====N#..#N====N#.......',
    '.....#=NNNNNN=#..#=NNNNNN=#.....',
    '.....#=MjjjjM=#..#=MjjjjM=#.....',
    '.....#=kkkkkk=#..#=kkkkkk=#.....',
    '.....##########..##########.....',
  ], 31, [[13, 8], [20, 8]]),

  /* The Grafter. A scout, caught mid-step rather than standing square: one
     shoulder lower, legs staggered. The brim of the hat genuinely overhangs and
     puts the brow in shadow, and the satchel sits on one hip. The most
     asymmetric of the five by design. */
  grafter: sprite([
    '............#iittII#............',
    '...........#iittttII#...........',
    '..........#NNNNNNNhHA#..........',
    '..#iiiiiiittttttttttIIIIIII#....',
    '.#=IIITTTTTTTTNNNNTTTTIII=#.....',
    '..#########NNNNNNNNNN######.....',
    '..........#NTTIIIITTN#..........',
    '..........#n==IttI==n#..........',
    '..........#S#WSiiS#WS#..........',
    '..........#TnSSiSSSnT#..........',
    '..........#TSssWSSStT#..........',
    '..........#TtsnwnSStT#..........',
    '..........#TtsSssSStT#..........',
    '..........#Tts===SItT#..........',
    '...........#TISssSIT#...........',
    '............########............',
    '.............#nSSn#.............',
    '..........#=tttttttt=#..........',
    '........#iiaAAttttIII#..........',
    '.......#iittaAAtttIII#tI#.......',
    '......#itI#itaAAttIII#tI#M#M#...',
    '......#itI#ittaAAtIII#tI#MjM#...',
    '......#sSn#itttaAAIII#sn#jxj#...',
    '......#sSn#NNNNMMNNNN#nnnnnN#...',
    '.......#iittttttttIII#nnMMnN#...',
    '.......#itttttttTTTTT#======#...',
    '.......#tIIIIIIIIIIIT#nnnnNN#...',
    '.......#tIIIIT#IIITTT#NnnNNN#...',
    '......#tIIIIT#.#IITTTT#######...',
    '......#tIIIIT#.#IITTTT#.........',
    '......#tIIIIT#..#IITTTT#........',
    '......#ttIIIT#..#IItTTT#........',
    '.......#tIIIIT#..#IITTTT#.......',
    '.......#ttIIIT#..#IITTTT#.......',
    '........#tIIIT#..#IITTT#........',
    '........#nNNNT#..#NNTTT#........',
    '.......#nNNNNT#..#NNTTTT#.......',
    '.......#NNNNNT#..#NNTTTT#.......',
    '.....#nNNNNNNT#..#NNTTTTTT#.....',
    '.....##########..##########.....',
  ], 17, [[12, 8], [18, 8]]),
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
 * The panel is the exception, and on purpose. Three benches in a row are three
 * things somebody put there; three solar panels in a row are an array, and an
 * array is supposed to read as one thing. So it fills its square, and the map
 * sprite in PROP_ART is cut to overlap the one behind it — see the note there.
 *
 * The key matches the `art` field in content.js BUILDINGS.
 */
export const BUILDING_ART = {
  /* The card face and the placement ghost: the same elevated square the map
     draws, with the legs shortened to fit inside one tile. Cracked, half-blind
     and still tracking the sun — the cells read as a grid because that is the
     one thing a panel unmistakably is, and the pale rail along the top and the
     shadowed lip along the bottom are what say it is a slab held up off the
     ground rather than a square painted on it. */
  panel: [
    '################',
    '#mmmmmmmmmmmmmm#',
    '#UUbUMUbUUMUUbc#',
    '#UbUUMUUbUMUbcU#',
    '#MMMMMMMMMMMMMM#',
    '#BBUBMBUBBMBBUB#',
    '#BUBBMBBUBMBUBB#',
    '#MMMMMMMMMMMMMM#',
    '#BdBBMBBdBMBdBB#',
    '#BBdBMdBBBMBBdB#',
    '#jjjjjjjjjjjjjj#',
    '#JJJJJJJJJJJJJJ#',
    '################',
    '...xJ......xJ...',
    '...xJ......xJ...',
    '..#xJ#....#xJ#..',
  ],
  /* ---- the array ------------------------------------------------------ */

  /* A tonne of salvaged rotor on a bearing. Rust ring, steel hub, and the
     spokes left as gaps so the eye reads it as turning rather than as a
     wheel-shaped plate. */
  flywheel: [
    '................',
    '.....######.....',
    '...##rrrrrr##...',
    '..#rrRRRRRRrr#..',
    '.#rRR#MMMM#RRr#.',
    '.#rR#MjjjjM#Rr#.',
    '#rrRMjxxxxjMRrr#',
    '#rrRMjxMMxjMRrr#',
    '#rrRMjxMMxjMRrr#',
    '#rrRMjxxxxjMRrr#',
    '.#rR#MjjjjM#Rr#.',
    '.#rRR#MMMM#RRr#.',
    '..#rrRRRRRRrr#..',
    '...##rrrrrr##...',
    '....#JJJJJJ#....',
    '....##xJJx##....',
  ],
  /* A grey box with a bolt down the middle of it. Vents above and below so it
     reads as something that gets hot, which is the only thing an inverter
     visibly does. */
  inverter: [
    '................',
    '..############..',
    '..#mmmmmmmmmm#..',
    '..#mMMMMMMMMm#..',
    '..#mMjjjjjjMm#..',
    '..#mM#yyyy#Mm#..',
    '..#mM#yYY#jMm#..',
    '..#mM##YY##Mm#..',
    '..#mMj#YY#jMm#..',
    '..#mMjj#Y#jMm#..',
    '..#mMjjjjjjMm#..',
    '..#mM#x##x#Mm#..',
    '..#mmmmmmmmmm#..',
    '..############..',
    '....#x#..#x#....',
    '....###..###....',
  ],

  /* ---- the windbreak: three tiers, and each one greener than the last --- */

  /* Scrap battens in a lattice with the first year's growth on it. Mostly
     frame, a little leaf — the tier above is the same shape filled in. */
  trellis: [
    '................',
    '.#T#........#T#.',
    '.#T#..gggg..#T#.',
    '.#T#.ghhhhg.#T#.',
    '#TTTTTTTTTTTTTT#',
    '.#T#g#T##T#g#T#.',
    '.#T#hh#TT#hh#T#.',
    '.#T#.h#TT#h.#T#.',
    '#TTTTTTTTTTTTTT#',
    '.#T#g#T##T#g#T#.',
    '.#T#hg#TT#gh#T#.',
    '.#T#.gGGGGg.#T#.',
    '#TTTTTTTTTTTTTT#',
    '.#T#..gGGg..#T#.',
    '.#T#........#T#.',
    '.###........###.',
  ],
  /* The trellis, grown in. The battens are still under there and show through
     in three places, which is what keeps it the same object at the next tier
     rather than a different one. */
  livingwall: [
    '................',
    '.##############.',
    '.#hgHgGhHgGhgh#.',
    '.#gGvGhgGvhGgG#.',
    '.#TgHvGgvGhgHT#.',
    '.#hGgvhGgHvGgh#.',
    '.#gvGhTgGhvGHg#.',
    '.#HgGvgGhgvhgv#.',
    '.#gGhvGTgvGhGg#.',
    '.#vhGgvhGgvGhH#.',
    '.#gGvGhgTvhGgG#.',
    '.#hgHgGhHgGhgh#.',
    '.#GvgGhvgGhvGg#.',
    '.##############.',
    '..#TT#....#TT#..',
    '..####....####..',
  ],
  /* Laid the old way: half-cut, bent over and pegged. Wider than it is tall,
     and the woody stems run through it diagonally because that is the one
     thing that says laid rather than planted. */
  hedgerow: [
    '................',
    '................',
    '...gg....gg.....',
    '..ghhg..ghhg....',
    '.ghHGHghhHGHgh..',
    'ghHGvGHhGvGHhHg.',
    '#hGvGHgvGHvGhg#.',
    '#TGvhGTvhGvTGh#.',
    '#hTGvhgTGvhGTg#.',
    '#GhTvGhgTvGhTG#.',
    '#TGhvGTghvGThG#.',
    '.#TGhvgTGhvGT#..',
    '..#TTGhgGhTT#...',
    '...#TT#..#TT#...',
    '....##....##....',
    '................',
  ],

  /* ---- the carillon: cut pipe, then brass, then a tower ---------------- */

  /* Lengths of pipe hung in a frame, longest to shortest. Struck on the hour,
     and everybody works better to a beat. */
  carillon: [
    '................',
    '.##############.',
    '.#IIIIIIIIIIII#.',
    '.#T##T##T##T#T#.',
    '.#T#o#o#o#o##T#.',
    '.#T#o#o#o#o##T#.',
    '.#TOoOoOoOoO#T#.',
    '.#TOoOoOoOoO#T#.',
    '.#TOoOoOoOoO#T#.',
    '.#TOoOoOoOoO#T#.',
    '.#TOoOoOoOoO#T#.',
    '.#T#O#O#O#O##T#.',
    '.#T##O##O####T#.',
    '.#TTTTTTTTTTTT#.',
    '..#T#......#T#..',
    '..###......###..',
  ],
  /* Brass throats run out to the far end of the site. Two horns, turned up,
     so nobody has to shout twice. */
  tubes: [
    '................',
    '...####..####...',
    '..#oooo##oooo#..',
    '.#oOOOo##oOOOo#.',
    '.#oO##O##O##Oo#.',
    '.#oO#.####.#Oo#.',
    '..#O#.#Oo#.#O#..',
    '...#O##Oo##O#...',
    '....#O#Oo#O#....',
    '.....#OOOOO#....',
    '.....#OjjjO#....',
    '......#jjj#.....',
    '......#xjx#.....',
    '......#xxx#.....',
    '.....##xxx##....',
    '.....#######....',
  ],
  /* The bells got a tower. You can hear it from the treeline, and you move
     when you do. */
  belfry: [
    '.......##.......',
    '......#yy#......',
    '.....#TyyT#.....',
    '....#TTttTT#....',
    '...#TTTttTTT#...',
    '..##TTTTTTTT##..',
    '..#T#o####o#T#..',
    '..#T#OoooO#T#...',
    '..#T#OoooO#T#...',
    '..#T##OOO##T#...',
    '..#T#######T#...',
    '..#TT#...#TT#...',
    '..#T#.....#T#...',
    '..#T#.....#T#...',
    '.##T##...##T##..',
    '.#####...#####..',
  ],

  /* ---- the heliostat: one mirror, then nine, then the point they meet --- */

  /* A single mirror on a tracker, holding a slab of sky. The gradient is the
     reflection — a flat grey panel would read as a sign. */
  heliostat: [
    '................',
    '..############..',
    '.#cccuuuubbbbb#.',
    '.#cuuubbbbUUUb#.',
    '.#uuubbbbUUUBB#.',
    '.#ubbbbUUUBBBB#.',
    '.#bbbUUUBBBddd#.',
    '.#bUUUBBBddddd#.',
    '.##############.',
    '.....#xJx#......',
    '.....#xJx#......',
    '.....#xJx#......',
    '.....#xJx#......',
    '....##xJx##.....',
    '...#JJJJJJJ#....',
    '...#########....',
  ],
  /* Nine more of them, all aimed at the same square metre of afternoon. */
  mirrorfield: [
    '................',
    '.####.####.####.',
    '.#cu#.#cu#.#cu#.',
    '.#ub#.#ub#.#ub#.',
    '.#bU#.#bU#.#bU#.',
    '.####.####.####.',
    '..#x#..#x#..#x#.',
    '..###..###..###.',
    '.####.####.####.',
    '.#cu#.#cu#.#cu#.',
    '.#ub#.#ub#.#ub#.',
    '.#bU#.#bU#.#bU#.',
    '.####.####.####.',
    '..#x#..#x#..#x#.',
    '..###..###..###.',
    '................',
  ],
  /* The point where all of it meets. Do not look at it, and do not stand in
     it — so the centre is the only pure white anywhere in the tables. */
  furnace: [
    '................',
    '..#JJ#....#JJ#..',
    '.#JMMJ#..#JMMJ#.',
    '.#MmmM#..#MmmM#.',
    '..#JJ#yyyy#JJ#..',
    '....#yYYYYy#....',
    '...#yYwwwwYy#...',
    '..#yYwwwwwwYy#..',
    '..#yYwwwwwwYy#..',
    '...#yYwwwwYy#...',
    '....#yYYYYy#....',
    '..#JJ#yyyy#JJ#..',
    '.#MmmM#..#MmmM#.',
    '.#JMMJ#..#JMMJ#.',
    '..#JJ#....#JJ#..',
    '................',
  ],

  /* ---- the cistern: caught, then filtered, then filtered again --------- */

  /* Roof runoff, caught and kept. The water darkens down the tank because a
     flat blue box reads as a box. */
  cistern: [
    '................',
    '...##########...',
    '...#MMMMMMMM#...',
    '...#MccccccM#...',
    '...#MuuuuuuM#...',
    '...#MbbbbbbM#...',
    '...#MbbbbbbM#...',
    '...#MUUUUUUM#...',
    '...#MUUUUUUM#...',
    '...#MBBBBBBM#...',
    '...#MBBBBBBM#...',
    '...#MddddddM#...',
    '...#MMMMMMMM#...',
    '...##########...',
    '....#x#..#x#....',
    '....###..###....',
  ],
  /* Gravel, reeds and patience. What comes out the far end is better than
     what went in. */
  reedbed: [
    '................',
    '...g..g...g..g..',
    '...h..h...h..h..',
    '..gh.gh..gh.gh..',
    '..#h##h###h##h#.',
    '.##############.',
    '.#uuuuuuuuuuuu#.',
    '.#bbbbbbbbbbbb#.',
    '.#aAaAaAaAaAaA#.',
    '.#AaAaAaAaAaAa#.',
    '.#IiIiIiIiIiIi#.',
    '.#iIiIiIiIiIiI#.',
    '.#TITITITITITI#.',
    '.##############.',
    '..#T#......#T#..',
    '..###......###..',
  ],
  /* White threads through a barrel of woodchip. They eat what the reeds would
     not touch. */
  mycelial: [
    '................',
    '...##########...',
    '..#TIIIIIIIIT#..',
    '..#IwWwiWwtwI#..',
    '..#IWwtwIwWwI#..',
    '..#TwWiwWtwWT#..',
    '..#IwtwWiwWwI#..',
    '..#IWwWtwIwWI#..',
    '..#TwIwWwtwWT#..',
    '..#IwWtwWiwwI#..',
    '..#IwtwIwWtWI#..',
    '..#TIIIIIIIIT#..',
    '..#TTTTTTTTTT#..',
    '...##########...',
    '....#T#..#T#....',
    '....###..###....',
  ],

  /* ---- the community: four machines for somebody else's build phase ---- */

  /* Rag, water and a screw press. The library stops being a thing you only
     find. */
  press: [
    '................',
    '..############..',
    '..#JJJJJJJJJJ#..',
    '..#J#MMMMMM#J#..',
    '..#J#MjjjjM#J#..',
    '..#J##MMMM##J#..',
    '..#J###MM###J#..',
    '..#J####M###J#..',
    '..#JwwwwwwwwJ#..',
    '..#JwWwWwWwWJ#..',
    '..#JwwwwwwwwJ#..',
    '..#JJJJJJJJJJ#..',
    '..############..',
    '...#T#....#T#...',
    '...#T#....#T#...',
    '...###....###...',
  ],
  /* Salvaged glazing over the pots. Everything under it comes up heavier. */
  glasshouse: [
    '.......##.......',
    '.....##cc##.....',
    '...##cccccc##...',
    '.##cccccccccc##.',
    '#ccccc####ccccc#',
    '#cuc#cccccc#cuc#',
    '#####mmmmmm#####',
    '.##############.',
    '.#mcmcmcmcmcmc#.',
    '.#cmgcmhcmgcmc#.',
    '.#mchmcgcmhcmc#.',
    '.#cmgcmhcmgcmc#.',
    '.#mHcgmhcgmHcm#.',
    '.##############.',
    '..#TT#....#TT#..',
    '..####....####..',
  ],
  /* Two wheels and a deep tray. What he could not carry, he can now wheel. */
  barrow: [
    '................',
    '................',
    '.###########....',
    '.#IIIIIIIII#....',
    '.#TIIIIIIIT#....',
    '.#TTTTTTTTT#MM..',
    '.###########MM..',
    '...#M#..#M#.....',
    '..##M##.#M#.....',
    '..#JJJ#.#M#.....',
    '..#JxJ#.###.....',
    '..#JJJ#.........',
    '..##J##.........',
    '...###..........',
    '................',
    '................',
  ],
  /* Cuttings laid in a long heap to rot down. Green at the top where it is
     still this week's, and gone to leaf mould underneath. */
  windrow: [
    '................',
    '................',
    '................',
    '.....gg..gg.....',
    '...gghhgghhgg...',
    '..ghHGhHGhHGhg..',
    '.ghHGvGhHvGHhHg.',
    'ghHvGTIhTGvHhGhg',
    '#hGvTIiItIvGhTg#',
    '#TvGIitIiItIGvT#',
    '#IiTtIiItIitTiI#',
    '#tIiItiIitIiItT#',
    '.#TIitIiItiIT#..',
    '..#TTIitIITT#...',
    '...##TTTTT##....',
    '.....#####......',
  ],
};

/* ============================================================== terrain === */

/* Sixteen by sixteen, one per terrain kind in content.js.
 *
 * Drawn as noise rather than as a motif on purpose: these tile against copies
 * of themselves in every direction, and anything with a centre — a flower, a
 * crack, a shape — turns into a visible grid the moment it repeats. Noise has
 * no centre, so a field of it reads as ground instead of as wallpaper.
 *
 * The keys are the same palette as everything else here, so terrain shades
 * match the sprites standing on it without a second set of greens.
 */
export const TILE = 16;

/* Terrain variants: the same kind, cut more than one way.
 *
 * Every tile of a kind used to be pixel-identical to every other one, so a
 * field of them read as wallpaper however good the individual tile was. The
 * renderer picks a cut per tile from a hash of its coordinates, which is stable
 * across redraws, so the ground varies without ever shimmering. Every kind has
 * several cuts now, ten for grass, because a repeat is easiest to catch where
 * there is most of it to compare.
 *
 * Every cut is dithered rather than speckled. A speckled tile is one colour
 * with a few brighter pixels dropped on it, and however carefully those pixels
 * are placed the eye still reads the field underneath as a flat sheet. These
 * are drawn from a whole ramp at once — ten greens, seven blues, five steels —
 * weighted so the middle of the ramp carries the tile and the ends read as
 * highlight and shade. Four fifths of the runs of one key in a grass cut are a
 * single pixel and the longest anywhere in the ten is eight, which is what
 * stops the tile looking painted.
 *
 * ---- why any cut can sit next to any other -------------------------------
 *
 * A hashed cut has no idea what its neighbours are, so every cut of a kind has
 * to join every other one — including a copy of itself — without drawing a line
 * down the map. Three things make that true, and none of them is rotation:
 *
 *   Nothing in a tile is bigger than about four pixels. A blob spanning half a
 *   tile has to stop at the tile's edge, and the tile next to it will not carry
 *   it on. Keep every feature small and there is nothing left to break.
 *
 *   The smooth part of every cut of a kind fades to one shared field over the
 *   outer three pixels, so all of them agree about what is happening at the
 *   border. The grain on top stays independent, so no two borders are the same
 *   pixels — only the same average, which is the half that shows.
 *
 *   One quantiser per kind, not one per tile. Equal field values have to come
 *   out as equal keys or two cuts can disagree about a shade they both drew the
 *   same, and the disagreement lands exactly on the seam.
 *
 * The cuts kept are the ones that measure right: lay a field of them and divide
 * the average step in brightness across a tile boundary by the average step
 * anywhere else in the texture. One means a seam is indistinguishable from the
 * rest of the ground. These land between 0.81 and 1.07. Before this pass grass
 * measured 1.47 across and 1.78 down and the spoil hill 2.81 down, which is
 * what a visible grid looks like written as a number.
 *
 * The ones under one are seams that come out smoother than their surroundings,
 * which is what the shared border and the odd cut landing beside a copy of
 * itself both do. That is a clean join rather than a fault: it is the rough
 * seam that rules a line, and none of these has one.
 *
 * The floor is the exception, and deliberately: it is laid, so its grid is
 * supposed to repeat. Its mortar runs down the middle of the tile rather than
 * along the edge, which puts the seam through the middle of a slab.
 */
export const TERRAIN_VARIANTS = {
  /* Open ground. Ten cuts, because grass is most of the map and a repeat is
     easiest to catch where there is most of it to compare. */
  grass: [
    [
      'GfFvvFvFvHvgGHgG',
      'GFvglGvGGvFvFGfH',
      'fHgllgHvFvFHHgfH',
      'gfGHlGGvvGHGGGGg',
      'lhfHlfGGGHHFGGHh',
      'ggHGgGfGGGGGgggh',
      'glHfHFFGvvGfHhHG',
      'hgfGGGvFvvvvGgHg',
      'ggHgfHvvvvvFHggg',
      'GhghgHvvvvFGvHhg',
      'vHhHHHHvvvFvvGHG',
      'FlhfhHvvFvvGvFGF',
      'FhfllHGHGvHvvHGH',
      'HgGlhhGvvGfGFGHf',
      'GGGGGhGHFGHGfgHg',
      'GfHvvFvFFGHghgHf',
    ],
    [
      'vGGvFvvFvfHHGFgH',
      'GHGFHGGHHHFFggfH',
      'HHgfHfHlHGGGGhGg',
      'hHGGGGHfgHgGGhGh',
      'hhGHgGGvHGHGggHg',
      'lHggGGFGGHGHvGgl',
      'gffFFGfGGGGvvHGH',
      'GHfHvHGFGGGFvGHG',
      'vHGFGvvFvvHGhHhg',
      'vHFvGGHvFGvGhGGG',
      'vGfFgGggHGGhFFGv',
      'FGGFgGfGffHFFGHF',
      'vglGggGgHFFGvgff',
      'HglgfgGfHHGgGhgh',
      'GHvhvGGfGGHfggfl',
      'vHvGFGFGvgHHhGff',
    ],
    [
      'FGHFGvvvvGgGgggg',
      'fHfhFGFGGfGGGFFf',
      'hGFgfggHHFFvvGGg',
      'hGgHGhHGGFGFFGGf',
      'hhgGlgfGGGvvvvHl',
      'glgllHGgGGFHvHlh',
      'gllllgfFGfFgfHgf',
      'fHlllfGGFGvGHgHg',
      'gggglhFHGGGfGglH',
      'GvfgllfGGGHHgHfg',
      'GvhghGgHvHGGGgfv',
      'HGhHfFhHFHfHGGGG',
      'AghFgvFGFGHGvgGH',
      'GHHGfGGFffGGHGGH',
      'fFGvGGHfhfgGGHGg',
      'GGFFHvvFfGffhhhH',
    ],
    [
      'vfFHvFGvvvfHHhhG',
      'HfFGHfFFFHffHGHH',
      'hgHGlggGFGHHGgHH',
      'HlhlllGHGFGGHgHh',
      'hlhlllFFFvFfgggl',
      'hlllhHgvvGHHhHgl',
      'glllfgGHFHGfHggf',
      'gHGlHgGfHHgfGfff',
      'HGvGhGHGHGHGfggh',
      'gGGHHgHGHgGggGGH',
      'FGGvFGGGFGfllFFv',
      'GGGGGGGGHHHllGHF',
      'FGgvvFGglhGhlghF',
      'GGgFGGHFHGglHhgv',
      'HHGGFGGFHfHfhhfH',
      'GGvFvfGvGGGGGGfH',
    ],
    [
      'GGGGGGGvvGgGHggv',
      'fHHHFhhHGGHGHhHF',
      'hHHHHhlgfHHGhlhH',
      'lhgghllhhfgGGghg',
      'hlghhghhlgGFFHHl',
      'gllhglhfghFFvhHG',
      'flhHHllhffFGGhFF',
      'HgHhhlhhHhfHhgFf',
      'HGHHghffgflHfGGh',
      'GGHgGHhHGhHfGHHG',
      'hgFGGGhhgHgHfghG',
      'HGGvfggfhhhffFfH',
      'GGgvGHHlhgllGflF',
      'gHgGGfGhhllgghhl',
      'hGFGFHHhfghHHfhl',
      'GHFFvvFvvHHHfgHv',
    ],
    [
      'GGfvFvvfvGgfFghG',
      'HggGGhFfHfHgGHHv',
      'hggHghGfHHHGGHgG',
      'hHhlggHHlGGFvFhh',
      'llfhhhgGGGGvvGfg',
      'ghHggGgfggvFvfHl',
      'GHgvfHvhGHvvFHHg',
      'HGHvGGHlffGvvGhG',
      'gGFvFHGlgggFvGfg',
      'fHFvvGvhhHGGFvgG',
      'FGFvvvvHlgfGGGGv',
      'GHGGFHGgGhhHgHGF',
      'GFHHfGGGHflhgGlH',
      'HGGgHGHvGGgHggff',
      'HhGFHFvGGGlHhlff',
      'HGvvGFvvvGfgGghg',
    ],
    [
      'GhGFvvGvvGHGGglg',
      'ghfGGGhfvFGGHlgg',
      'HGghgHffHGgGfghg',
      'fGlgFFgGFfGHvGHl',
      'ghhvAGhHGHfFvGgl',
      'hhgHAGgHFGvHGHHH',
      'GhhGGFgFHFGHggGG',
      'gHGHvFGGHHHgHGhG',
      'gGGGvGHGAHhHGHlg',
      'GGfGHHHGGvlhgffg',
      'GFgHfgGGvvhHlgGG',
      'HHGhgHGFGHHgfGHf',
      'GHFghgFgHGghggHG',
      'HHGGfHgHGGGHfvGG',
      'HfFHGHGFHGGgGHlg',
      'HHGvGvvFGGFvGghH',
    ],
    [
      'vHgvGFGFvFFfgGhl',
      'fhGvGvFHFHgGhGHg',
      'hfGGGGHHHGHHGFff',
      'GGggHfGHGgHHhHfg',
      'hlFHHfFGGHhflhHl',
      'lhgfGHgGfGhHhghh',
      'fhhfGHHfHGhhfgHG',
      'gfGghHHGGHhHGgHf',
      'ggHGgHHFHHGfHHHf',
      'GGgGhHfGGFFHhfGg',
      'fvvHHHHHvGFGfHvG',
      'HfvGlhGfGFGGGHFv',
      'vAHflgFHHGhGFGHF',
      'GHGgfhfgGHHvGGHH',
      'AFFHGGgGffGFggHG',
      'GfHvvGFGvFvGlghh',
    ],
    [
      'GHGGvGvvFFGHHhHH',
      'GGHFGhvGGvGHgfff',
      'gHHGfgvGfHHggggh',
      'ghGHGGFGGGfhhgGf',
      'lfGGgHHFHvFGhfhl',
      'hgHgHFgFGGHHglvh',
      'HhhhFfggHGGFGgFg',
      'HGgHGffFGFFGghGH',
      'hfHHHFHFFFGggflH',
      'gGGHGGGGGGHHGHfH',
      'FHHGHgHHHgHvGFvH',
      'FHgfHHfHglgvgGvF',
      'FHggfhlhGlGvgFHG',
      'GGggfhHGgHFFgFGH',
      'HFfhHFFGHHGFhGhf',
      'HGGfvvvvvvFHgfff',
    ],
    [
      'HghgFFvvAGHffggG',
      'GHGHGFFvvGHfhhGg',
      'HhFGGgGHFFhhHhlH',
      'hfHfhfFFGHfghhlh',
      'llHGghFvvvGHhghl',
      'lgHfFfGvvFvHGggf',
      'ggHGvhhFvvFvvfgG',
      'hGgHvfHGvGFHFGgg',
      'fHgHvgGfGfHGFhhh',
      'fGGHHGGHgHhFvGfg',
      'HHhggGfGGGhggHFG',
      'HghflhgGflhgggHv',
      'AafhlhhalhHgghhH',
      'vHfgghHhggGHflff',
      'GHGgFHGGHaHfgfgH',
      'HHhhFGvvGHffghfG',
    ],
  ],
  /* Meltwater. The strokes run across rather than up: horizontal is the one
     thing that says water and not sky. */
  water: [
    [
      'BBqbbbbubbBBuuuB',
      'bUbbbbUqbqUbbqbb',
      'UbbqbquuubbbbUBB',
      'bqbBUubbbbbbUUbq',
      'UUdBBBBBbbbBBBbU',
      'bqbBBUbqbqUUBBqb',
      'ddBBBbbUBUbubquU',
      'BbbUbbububUUbbbB',
      'UbUUbuuuqbUUbbUU',
      'UUbbqbbUbBBuqubU',
      'bbuUUUbUbbbbqbBb',
      'qqbBBddBBUUqbbbq',
      'cqUbUBdddBUbBBbu',
      'bbbbUUUbbUbbUbBU',
      'bUbqqqbubbbUbUbb',
      'UUbccccuucqbUBbU',
    ],
    [
      'bqbbbquuqudBdBbb',
      'UUbcccuubUbBBUUU',
      'UbquuqbBBBUbbbUB',
      'bbbbcbbBdBbUUUBb',
      'uubbqbUbUbUBUBUq',
      'bbbUbUqbbbbUqbbq',
      'UqbbbBddddBbbqbB',
      'UbbbUUdBddddBbUU',
      'UbbbbUdddddBbbUB',
      'dbqubbdddddBdBUB',
      'BbubbbqBdddBUbbU',
      'qcccuUUBUBdUBBUb',
      'uuUccuUbUBUUUUBu',
      'uububuubdBBBBBbu',
      'bbbUUbbbbbbBBUUb',
      'bquubuuuuqbbUUUb',
    ],
    [
      'UuqcqqcubUUUbbqb',
      'bqbqquqbbqqbbUUU',
      'bqqbcccbUUbbUbUB',
      'BbbqbuBBddBUbbUq',
      'ucccccbUBdBqqqbu',
      'bqcuubuUBUUbqbbq',
      'UqucuuUbBbUbUbqU',
      'UUUqbbUbbbqbUbUU',
      'bUBUqUUUbbbUbbUb',
      'UBUbbbbUbqUuubBd',
      'UbUBUUUUBUbuuUBB',
      'bUUBUUUUbbUbqUUU',
      'ubqdddBbuubucbuu',
      'qbqUUUbBUUquqcub',
      'bbbbUbqqquqBBbqb',
      'UbBbUccuuqbBddBB',
    ],
    [
      'bbbuquUbbbbqbbqb',
      'UcucuquuuqqbbdBB',
      'UcucuuqbqqqqBqdB',
      'bqubuubUUUuuuuqU',
      'qqUUUdBbbbuucuuq',
      'UbqBBbqbbbqbUbBb',
      'BUUUbUbubUUbqUbB',
      'UbUbbbuuUbUbquqb',
      'BBquqbqUBUbbUUBB',
      'UbbUbUuccuqbUbUU',
      'dBUBUBbbUUbUdddB',
      'uUBddUUUbbBUbbbq',
      'cqUUbbUddBBUcquc',
      'qqbUbqbbUUbbUUbq',
      'qbqubuUbBUqbUBUq',
      'UquqqbuqubUUBUbU',
    ],
    [
      'bucccqcuuqUBUUbb',
      'UbuuuuuUUBUUUbbU',
      'UbqbubbUbbbBdddd',
      'qubbUBBBBUBBUBuu',
      'qbuBBBBdddBBBUUq',
      'qbbbbqqbbbBdddBb',
      'BBUquuuubbqbUUUU',
      'BUbUbbUBbUUBbUUB',
      'ddUbbdBBUBBbuUbd',
      'UbqbBbubbUBbuubU',
      'UbqbUbUUUUUBUUbU',
      'uqubUdBUUUBBBBbq',
      'qubUBbbBBBBBbUbu',
      'qbbbBbUbbbUUqbqc',
      'bbbbUbqqbBBBUUbb',
      'bUbuqquqqbUbBBbb',
    ],
    [
      'bqccuucqubBBbbbb',
      'bqbcuqbqBdBbqquu',
      'UuucuUUbbqUubbbB',
      'quUucubqqbbqubqb',
      'bbbbuqUquqbqcquu',
      'Ubqqbuqbqbbquubq',
      'BUbqUuubUbbUqBUd',
      'UdddqqbbBBbccubB',
      'BBbBUbcbdUbuqbUB',
      'dBBubcuUUUbccuUU',
      'bUUBUUBUBUbuubUU',
      'bbqBBBUbbBbqubbq',
      'uqubdUBBqqbuuquc',
      'UbUBbddUbbqqbbqu',
      'bbbuuuuubqqUUbuu',
      'ubuUbbqubqqUUUbu',
    ],
  ],
  /* The eight shores: meltwater with a bank on one side of it.
   *
   * A pond used to be one tile repeated to its edge and then grass, which
   * reads as a hole cut in the ground rather than as water lying in it. These
   * are the same meltwater shallowed off towards whichever way the land is —
   * `shoreN` is water with the bank to its north — so a coastline gets a
   * beach on the inside of it and the middle of a pond is the only part that
   * looks deep. They are as unwalkable as the water they are made of: a
   * shore is scenery, not a ford.
   *
   * They are generated rather than drawn, from the same measurements the
   * water cuts are held to, because eight directions times three cuts is not
   * something to place a pixel at a time and stay honest about:
   *
   *   The field far from the bank is water's own histogram, and the outer
   *   three pixels carry water's own border — which is two profiles and not
   *   one, because water's strokes run across, so its top and bottom rows are
   *   lighter than its middle and its left and right columns are darker.
   *   Match only the average of the two and every horizontal join steps by a
   *   tenth of the ramp.
   *
   *   A diagonal's bank runs along two sides rather than round a corner. A
   *   corner tile is where a coast turns, so the land really is along the
   *   north and the east both; measuring from the corner point instead leaves
   *   the far end of the tile in open water while the straight cut beside it
   *   is shallow all the way across, and the step lands on the join.
   *
   *   Each of the outer three lines is levelled to its own mean, so two cuts
   *   agree about the border by construction rather than by luck. Grain
   *   either side of a join still differs — that is the texture — but the
   *   level does not.
   *
   * Measured the way the rest of this file is, but over three hundred
   * generated sites rather than over every pair of cuts, because a coastline
   * only ever makes some of those pairs and scoring the ones it cannot make
   * is scoring nothing. The step across a join divided by the step a pixel to
   * either side of it comes out at 1.30 and 1.83 for shore against shore and
   * 1.29 and 1.62 for shore against open water, against water's own 0.93 and
   * 1.09.
   *
   * Above one, and deliberately. That ratio measures a join against the grain
   * beside it, and the whole point of the shallows is that they have less
   * grain — so the number climbs on a seam there is nothing wrong with. What
   * actually draws a grid is a join that steps the same way every time, and
   * the signed step is what to read for that: −1.6 to +1.7 across all of
   * these, where the shipped water cuts are −0.1 to +1.1. There is no line.
   */
  shoreN: [
    [
      'ccquccccccuqqquq',
      'quuuuuuuuuuuqubq',
      'cuqqbucuquuqbqqu',
      'uquubqquuqbqbqbu',
      'UUbuuubbUbbucqbb',
      'uqqucuUBUUUBUbqb',
      'qcuccuqbbbqUBUcc',
      'uuucbbbqcbbbqbbu',
      'bUdUdUUBUuubqUbb',
      'UUBUdUUbUbuqquqb',
      'dUBUqbbuqqbbubUd',
      'UbbbdbuqubBbUUbq',
      'BbubbbUbquUbqBUB',
      'bBbbcbqUUbbUUUUU',
      'buccubqbUbUUUUUb',
      'UqccbUbUbubbUbcb',
    ],
    [
      'ccqqcqqqquuccccc',
      'uuqcccqquuqquuqu',
      'buqucuququubbbqu',
      'uuquqqbbbbbquqbq',
      'bqbUUUuUUbUbbbbb',
      'UUqbbbbqBqbbUqub',
      'UqqcuuUUUdUUUUqU',
      'qbbuuuUBdddBUUUU',
      'UUUbqqUbUBBUubuU',
      'bbbubBUbubBBUbbb',
      'qqbbbbuqubqbucbq',
      'bbdUdbUbuubUUUbb',
      'bUbubbqqcqbBUubb',
      'dUqUBbUqUbquqbbB',
      'bbUucUbqbBbBbqub',
      'BUbbccuUBUqcbqcb',
    ],
    [
      'uucccqqccccucuqc',
      'qqqquuuuccuuqqqq',
      'uquubqbuccubbbuu',
      'bbuqbbcuuqubbbbb',
      'bbqbbubbbqqUUUbU',
      'bbbbuubUBbqUUbbq',
      'bbbbUqqUdBUbUqbU',
      'qbqcbuqbdUubbbUU',
      'qubuubqqbqbbubqb',
      'BUdUuuUbBbuBBbUU',
      'BUBbUUUbUBBdBbUq',
      'UqbUdBBBdbbBBcuu',
      'bqbbUbBqUqbbUUUU',
      'bUqubbbbbBbBbbcb',
      'ucccccbBddbbUUbu',
      'UqcbbuUuqubbUUbb',
    ],
  ],
  shoreNE: [
    [
      'ccccquuucuuquqqc',
      'cucuqquqquuuquqc',
      'ccucqqqcuqbbqqbc',
      'bbbbubbuccquuquu',
      'UUbbbbuucucqbquu',
      'UqqqbbUbUbbqquuu',
      'BUbbbBbUdUuuuquu',
      'uUUqqUbUBBBqcuqq',
      'BbbbuBUdBUbuqquc',
      'UUbqbUbbbUbuuquq',
      'quBUUUBBqbbbqbuc',
      'bbuqdUububUbbuuc',
      'ubbucucbUbcccuuc',
      'bbuuubUqqUbbbbqq',
      'BbUUcbUbcuUuuqqu',
      'cuuqUqcbbbbbbbqu',
    ],
    [
      'qcccucucquqquqcc',
      'uqqqcucuuuuqqquc',
      'qqqbqucuuquqbquc',
      'bbbcuubccubbbbqq',
      'qquuqqbubbbUbbqc',
      'bBUUUUbucbbbbbqu',
      'dBUbuUdUUUBbbuqq',
      'dBBUUUBbbUBbbqqq',
      'qquqqbbqubbqqucc',
      'bcbUdBBqbuuUbqcc',
      'qubBdddbuubUbquc',
      'bUbbbUdbbbbbqcqq',
      'UqqqbcqbBUbcqccc',
      'buqbbbbBbqbqbquu',
      'bqUbUUUUbbcqccuc',
      'cbUquccUUUUuuquc',
    ],
    [
      'qcuqqucucccccuuq',
      'cucuqqqucucuqquc',
      'ccqququuuuuqbqcc',
      'uucuuubbuqbquuuc',
      'bqbuuubUUUbqbbqq',
      'qUbcubUbUbUUbquu',
      'UucuquuUbUbbbuuq',
      'bbBbqubbbbUbccqc',
      'dUbbbBbbuquqcccc',
      'UUbUdUbqbUUUbbqq',
      'UqUbUbbUBUbbbqcc',
      'BBBBbUbbBBbUbquc',
      'bbbbUUbbqUBUbbqu',
      'BUUUbBUuucqqbbqq',
      'uubbBBUcqquqbquq',
      'bbbUUBbbcqqqccuq',
    ],
  ],
  shoreE: [
    [
      'UqccqubUUucUbbuu',
      'bbbqcUUbbbqbbquu',
      'ubUBbqbbUubbuucc',
      'uuuqUbbBBUbqcuuc',
      'uqbuUubUddUbbuuc',
      'UqqUUbbbbbUququc',
      'UUUUUbqbbbuuuuqq',
      'ubbqbqUbbUubbbbq',
      'quqqUBUBbUbbbbcc',
      'BbUqcubUUqUbbuuc',
      'dddUquBquqbUbbbq',
      'dBbUbqbuuubbuquq',
      'bbbBBUUbcccqbcqu',
      'UbBUbbqqubbbqqcc',
      'UUUbUbcqcqqbbquc',
      'UUbccuqbUbubbqcc',
    ],
    [
      'ubqucbUbbbqbbbqc',
      'bqccubUUbUUbqquu',
      'qbUUbUBbbUqucccc',
      'UbbbqqUBBbbbbuuq',
      'BBbUBqubBUUbqqqq',
      'BUbUbbbbuUUUbbqq',
      'qbdUdBUBddBUbbqc',
      'bqUUbbUUbqUbbbuc',
      'UbUquqbqcuUUbquc',
      'UUuuuqBBdqbbbqqq',
      'dUuuuubUddbuuubq',
      'qbbccuqbbUbuucuc',
      'ucbqbbcbbbuucccc',
      'ubbbUbbqbbubbbuc',
      'bqbbbBUbqucbbuuc',
      'cbbUUbUucbbbbquc',
    ],
    [
      'UbbbbbbUUUccccuu',
      'bbccUuubuUUbqqqc',
      'uububuuUBUUubquc',
      'uuUbbubqbBUbcuuc',
      'BBquqbbUUBUbquqq',
      'bbbqubbbUbBbbbuc',
      'ququbquBbUbbuquc',
      'qUBUbUbbubUucqcu',
      'dddUbUUbucuucuqq',
      'dUbqqUqbUqUucuuq',
      'dBUuubbBBBUUbbqq',
      'BbqqbbUbbbbbqqqu',
      'ccucbbbbUbqbbqcc',
      'bbbUUbubuqcbbbqq',
      'quUUUbucqubbbqqc',
      'Ubbqbbcccbqbbbqq',
    ],
  ],
  shoreSE: [
    [
      'bbbcbqBbbUbqcuuu',
      'bbbbUbqUbbqucuqq',
      'UUbUUquccqUbbbqu',
      'UbbUBBbUBBUbuuuq',
      'bqbBdBbUdBbUbqqc',
      'ubUbbBbBdUqbquuc',
      'uuUBUdBUBbququuc',
      'ubqbdUUbubbucucc',
      'ubBdBBdUcqubbbuc',
      'UbbbUbqbdUqbbquc',
      'dUccuubbbqbbbbqq',
      'Ubbbbbbqucqqbbqu',
      'ubbbbbbcccuuucqu',
      'bqubbbqucuqqqucq',
      'ucuqqqcuccuuqqqc',
      'ccuqcccuquccuqqu',
    ],
    [
      'bbUUUUbcqbbcucuc',
      'BUuUUbUbUbqquuuc',
      'UbUccuUBuUBbbuqq',
      'uqqqUbqBbUbbqucc',
      'uqqUdBbbbBbbuucc',
      'BbbBUbbbBUBUqquc',
      'quubUbqbUbUbuqbq',
      'dUUUbBdbbbUqcuuq',
      'BBBddUbucquccuuq',
      'BUuUbUUBBUUqbbbq',
      'bUUqbUUBUBUUbquc',
      'bubUbUbqubbUbbqc',
      'cubbbquccubuquuc',
      'uqbbququcuuqbqcc',
      'cubqquuccuuuqqqc',
      'uucuqucccuqccccq',
    ],
    [
      'UbbqcqbqcqUbbbqu',
      'qucbbbbqubqUbbuc',
      'uuuqqbbqbbbbUbuc',
      'UbcccubBBUbbbqqc',
      'UbbUUuuUBdUUbbcc',
      'BbcbddUbqUbubbqc',
      'bUBUbBqUbbUUqbuq',
      'ubBBdUqqUUqqucuc',
      'bUUqbuuuqqcquuqq',
      'bbbUbbUUBUbucuuc',
      'qqqbBBUbqbUUbucc',
      'qqbbUbcbUqbbbqqq',
      'bbqububbbbbbbuqq',
      'bbqccubqbquqbuuc',
      'qucuuquuuuqqquqq',
      'ucucqcccucqquuuu',
    ],
  ],
  shoreS: [
    [
      'ququbucuqbbBBBbu',
      'bbcbbcuqbqbBBUbb',
      'UbubquucbbBUBBUU',
      'UuuqUbUUbqubbBUU',
      'bbqbubUBUbBddUbu',
      'UbUbubBUUdbUbUBd',
      'BBUUdUuqqbdbqqbb',
      'UqqbBBdBUbbucubB',
      'UUbqBbbqbqbubbbU',
      'bbUbBbbqUbbbbbuc',
      'ccubUUbucbqUqqcu',
      'bUUUbUbbqbUqbUbb',
      'bbbbbqbbbqquuubb',
      'quucuuuqbqqubquq',
      'ccucuquqquuququc',
      'uccccccuqqqqqucc',
    ],
    [
      'ccbbUUUbUbUUUbcc',
      'ccubbbUbUbUbcuUb',
      'qbUUdUqbUubbuuuu',
      'cqbqbbUbUbqbbbUu',
      'UbbUbbbUBUbddBbU',
      'UcbubbbBdBBbBBdb',
      'bbUuubBdddBucubb',
      'UUbquqqUdUuqqqUB',
      'BUUqbbbuuubbuuuB',
      'dUbqbbUuuqquubbB',
      'BUuuubUbbUUbbbqU',
      'buUbbbqucubbUbbb',
      'qbbbbqbbququbqbb',
      'bqucuubqqqqqqqqu',
      'cuuuuuuqqucuqqcc',
      'cqcuqccccqqqcccu',
    ],
    [
      'bUqccbbUUqbqbUbb',
      'bcuuBbqBddbqcubb',
      'buuuUbcUUUBUbcqq',
      'qqcqUBBBBddBbUbb',
      'UdUBdddBBdddBdBU',
      'bbbBUBqBUUUbqbbb',
      'qqqqubbBUBbbbbqb',
      'buuqbbbbBUbbubUb',
      'UbBUdbbUqbbUcBbb',
      'ddUbUqubUbbqquqB',
      'UUqqubUbBbUucubU',
      'bbbbbbUUUuuquuqq',
      'qbbbbbbbbuquqbbq',
      'uuuuuuqcqqbbqbqq',
      'ccuquqqqcuuuquuu',
      'cccucuuquuquccuc',
    ],
  ],
  shoreSW: [
    [
      'cuucbbbqbbbbuqbU',
      'qccubUcbUBUUuqUB',
      'qucbUbuubUUUubub',
      'cuuqUqUqUucucucb',
      'cuqqUbBucubbbbbb',
      'cqqbUUUuuUUBdUbU',
      'cubqbbUdUUBqbccu',
      'cuuqbbUBBUqqbbbb',
      'uuucquubUUbBUBdB',
      'quqbUBBUBUbbbbUU',
      'cqbbbUBBBBBUqUBb',
      'cuubUUbuubbbqbUq',
      'qucuqbbuqbubbqbq',
      'uquqquqquuuuqbqu',
      'cuuqbqcucccqqquu',
      'uqqucccuqcccuqqq',
    ],
    [
      'cuuqbUBbUbqbUucc',
      'cucbbUUUUUbUcqcb',
      'qqbbbbUUUbUcccqb',
      'cuqbqbucqbqbqUUb',
      'cccqbbuquubddBuc',
      'cuuuUUBUUuqUUbbb',
      'cuqbbbbbbbbBdbuq',
      'uuqqbbbuUuubUbuU',
      'uubbbUBuqbbbcubb',
      'cqubqbUbcuBquUBU',
      'qqbbbquUUUbuqbBU',
      'quuuubuqUbqqbbUU',
      'uqqbcuqquucuccqu',
      'uqbbbbbcuuquccqb',
      'qquuuquqququuccq',
      'cccuuuqcuuccuuuu',
    ],
    [
      'qquqbbbUccquqbbU',
      'ccuuuubbbUBbUbbq',
      'qqbquqUBUUbqcuUU',
      'uuqbbUbbqbdUBUBb',
      'uuqbbbUucuBdUbbb',
      'cucqUqbquubbBUUq',
      'uuqquuubuqUUuucb',
      'qucbUbdbbqbBdUUU',
      'cqbbubbbUqbUBUqU',
      'cqqbUUububbubuub',
      'ccqbUbbuuqbucqbq',
      'qcubuuuucuqbbbqb',
      'qqbbuqcqbbbucqcq',
      'cqqbquuuuuuqubbb',
      'uuqucuuuccuqqqqq',
      'ccccccqcqqqquccc',
    ],
  ],
  shoreW: [
    [
      'cuuccbbUbbbbUbUq',
      'cuqqcqqbbbUUUUub',
      'quqbUUcqcubUUbUd',
      'uqqqqbUbbqbUBbqb',
      'uqbbuUBUBbUqbuuU',
      'uubbUbUBdUBBbbBU',
      'qquqbqqubqbBUUUd',
      'qqcbUUqqUqubbBUd',
      'ccuqbUUbbUBUBbuq',
      'cubqqbbubbdddbbq',
      'uuucuubbbbbBBUUB',
      'qqqquuuqUqqqqUBb',
      'cuqubuccuqUbbcuc',
      'ccbbbbubUbUbqucu',
      'cccbUUBUbbUbuucc',
      'ccqqqbBbbqqqbUbu',
    ],
    [
      'cuqbbbUUUbuucubq',
      'uububUbbqbUUqcub',
      'uuubbqqbbqbbbBbb',
      'qqcubuqcqubbbbUU',
      'uqbuuuuuubbuuuqb',
      'uuuqbbUdUbbuquUU',
      'quqbqUUUBBdUcbbU',
      'cuqbuubbUUqqbbqq',
      'cuuccuuubbbBUbbb',
      'cuucuqbbbbBbbbBU',
      'ccucuqbdddBUqUbb',
      'uubbqbUUBBUUBUbU',
      'cqbbUBBuccuBbBUU',
      'cubbUbubuqbuUquq',
      'qqbbbbUbuqcqcbUU',
      'quqbbbUbbbcucucb',
    ],
    [
      'uuuucuucubBUbUUb',
      'cqucuuuuubBBbBdb',
      'qquqbbbqcubBBBqb',
      'ucqquqbbqbUUBUbU',
      'qbqbbqUbUuuqbUBd',
      'qqbbbUBBbqubUqbb',
      'cuubbUBddUquccuu',
      'cuubUUbdddUUqUUB',
      'uuqbUBbbdBddBUBb',
      'qqqqbUbUbdBUbUUb',
      'cuqquuqbUBbuqubU',
      'ccucuqBUBUbucquu',
      'uubucuUbbqqbbUqq',
      'cuububbbuuqUBBUU',
      'cuquUbuuUUbbbbqb',
      'quqbbqbbcqqcbUbb',
    ],
  ],
  shoreNW: [
    [
      'ccccqqquccuqqqcc',
      'ccqququccuqqqqcu',
      'cuuquccubqcbbbqu',
      'cuqquqbucbbbbbuu',
      'qqbbUbbubbbUUUbb',
      'uuqqqucbUqbBUUUU',
      'ccuccqquuquUUbqb',
      'ccuqqbuUBbbUbbUb',
      'qqbbuBUUbBbubcbU',
      'qqubUbbbBbbUUbbB',
      'uuccccqbUBUuubUb',
      'uuquubqUUUbqqubb',
      'cqqbqUBBUdBdUBbb',
      'cubbUbbqbbbqqbub',
      'qququbbUUbubbubU',
      'uqqbcbbbcUbbcqUU',
    ],
    [
      'uqquccccccucccqq',
      'uqquccucuuqqqquu',
      'uuqucqqquuqququq',
      'cuqubuqqqqbqbbqu',
      'uuqbUUbbuqqbuubb',
      'uqucubUbbUUUUbbb',
      'cuucqbqUdUBBdBbb',
      'cubuuqUBqbbqubUb',
      'qbbbubBbqqbubqUd',
      'ququcubUbUBUuubU',
      'cqucuuuucqubUUub',
      'cqbucubbbUdUUbUb',
      'ccccuqUUbBBdBUBb',
      'cuqcucbbBBUUbqqu',
      'uqbquuUUBqqccqBb',
      'qquqqcbbbbbccuUB',
    ],
    [
      'ccuuccuqcuqqcuqc',
      'cccuqqqqucuuuquu',
      'quubbbuqququcuqq',
      'ccuqbbqqbuqccbbq',
      'cubbbbbqubbucuqu',
      'ccuqUbqbUbquubUb',
      'cucqUUUBdddBuqqq',
      'cubbbbbqbubbdUUb',
      'quuqUbbBUUbbUUqb',
      'cqbbbbdBUdBBBbbb',
      'qqbubbUUUUddBddB',
      'uqqqbUUbUbbBBbbb',
      'cqqcqcucquuqqqbb',
      'qqbbbUBucquqUqqB',
      'qquuubUbbbUbcqUd',
      'cquucqUUbUbbbbcb',
    ],
  ],
  /* Broken slab and stone. No drift octave — a chip field has no large shape
     to it, only chips. */
  rubble: [
    [
      'xxjMxMMjjxjjjxxx',
      'xjjjjMMjMjjxMxxx',
      'MMjjMMjMjjxxxxJx',
      'MjMMMMMMjMjMtxxj',
      'jMMMjjMjMjjMTMxj',
      'MMMjMMjjxjxTjxjj',
      'xjjxxxjJJJJJJjxM',
      'JjjjJxxxJxJJRxxx',
      'JxxJJJjjjxJxxxxJ',
      'xxxjxJjxjxjJJxxJ',
      'jjxjjJxxxjjxJJxj',
      'jxMJxJxjxMjxJJJx',
      'xjxjjxxxMMjJJxxx',
      'xxjMxxxxjjxJJJJJ',
      'JJMjMjjxMxjxxJxJ',
      'xxjjMjjjjxxxjJJJ',
    ],
    [
      'jjMxjxjjMMjjMxjx',
      'jxxjMMjjMxJjMxjj',
      'MJxxjjJMjxJJJJxx',
      'jxjJxjxxjxMxjxxM',
      'MjxJJJjjMMMjjjjM',
      'jMxjJxJjjMxJxxjx',
      'jMxJJJJxjxJJxxjj',
      'xjxJJxJxJxJxjMjJ',
      'JjjjxJxRRJjjjjjJ',
      'JxxJJJxJxxjjMjjx',
      'jxxxjxjxMjjjMjxj',
      'xxjjjjjxxxjjMjjx',
      'jMjMMMjxjxMMMjxJ',
      'xxMjMMjjjjMjMMjJ',
      'xjMMMjMjMMMjjxJJ',
      'JjxMMMMjjjMjxxjJ',
    ],
    [
      'xxjjjjjjjjxxMMxx',
      'jjjjxMjjjjxxxJxx',
      'MjJxjjjxxJJJJJxj',
      'jjMxxMjxJJxJJJxx',
      'jjjxjjMxxxJJRJJM',
      'jMjMjxxjxxJJJxjM',
      'MMMMjjxJxjJxxxxj',
      'xxMMMjxxJxJxxjxj',
      'JxjjMjxxJJxxJjjJ',
      'JxjjMMMJxJxxjxxj',
      'xJjjjjjxJxxxjjjx',
      'jxxxjxxxRxjxjxxx',
      'MMjxjJJxJxxxJjJx',
      'xjxjjxJJjjxxxxJx',
      'xJjjjjMMjMjxJJJx',
      'xxjjMjMMMjxjMjxJ',
    ],
    [
      'JjjMjjMjjxxjMMjJ',
      'xjxjjjxxxjjjMxxx',
      'MjjxjjjxJxxxJjxx',
      'jMMMMMjxJJxxxjxM',
      'MMMMMMxJJJJjjjxM',
      'MMMMMxxJJxxxjxjM',
      'MMMjjjJxJxxjxjjj',
      'xxxMxjJjxxjjxjxx',
      'JJJJMxxxTxxxjjxJ',
      'xJxxxjxxxjxxjjxJ',
      'xxJJJxxxJJjMMxxx',
      'jxxJxxxxjxMMMjxj',
      'xxjJRJxjMMjMMjjx',
      'xxjxxxjjjxMMjMjJ',
      'JxjMxjjMMMMjxjxJ',
      'JxxMjMMjMjjxxJJJ',
    ],
    [
      'xjjjMjMjMjjxMMjx',
      'jjMMMjMjxjjjxJxj',
      'MxMjxxxJxxjxJxxj',
      'MMxJJxxJxxxjxjjj',
      'jjxJJxjJxJJxMMjx',
      'jjxJJJJxxxjjxxjM',
      'MjxJJxJjjjjjxxjx',
      'xxxJJJxxxxxxxxxj',
      'JxxJJJxjjxxjxxxJ',
      'xxxJJJJxxJxxjxxj',
      'xjjxMJJJJJJxJxxj',
      'xjxxjxJJJJJxJxxx',
      'TxjJJxxxRRJJJJxJ',
      'jxxjxjjTRTxxJxxx',
      'JxjxMjMjxTxxjjxJ',
      'xxxMMMMMjxxxMjJx',
    ],
    [
      'xjMMjMMMMxJjjxxx',
      'xJjjxxxxxxxxxxjJ',
      'jjjxjjxxjJjxxjJj',
      'MxxjjjjjjMxxjxxj',
      'tjxjjjxjTjjxjjjM',
      'MjMMxjxMMMMjxjjj',
      'jMMjMxxMMjxjxxjM',
      'xjMxJxxMjxxxxxxx',
      'xjjjJjMMMjJJJJJx',
      'JxjxJxMMMjjxxjjj',
      'xjxxMMMMMMMjjjjj',
      'xxjjMMMjMMMMjMxx',
      'xxMMMMMMMMMMTjxj',
      'JjxxMjxxjMMMjMjJ',
      'JxjxxjjjxMjMxxxJ',
      'xjjjjMMjjjxxjjxx',
    ],
  ],
  /* A hole, not a floor. Nearly the whole ramp sits below the outline colour,
     so what little light there is reads as the lip and the rest as depth. */
  crevice: [
    [
      '===J##kkkk=xxJxx',
      '===##=#k#k##x===',
      'J=##xJ#=##k##kk#',
      '###==JJJ#J#==#kk',
      'k##=##J#J=#=#=kk',
      '####JJ##k#kk####',
      '#kk#kk#kkkkkk##J',
      '=J##kkkkk#kkkk#=',
      '=##kkk=##kk##kk#',
      '=#k#kk#k#k#kkkk#',
      '#=###kkk#=##kk##',
      '##=kkkk#k==kkkk#',
      'k=k##kkk=J#kkk##',
      '#k##kkkk###kkk##',
      '#k#kkk#k#k####J#',
      'J=#k#kkkkk##JJJJ',
    ],
    [
      '#Jx###kkkk#JxJx=',
      '=######k#k=J===J',
      '==k###=#J=kk###=',
      '##k#k#J##=##kkk#',
      'kk#######kkkk##k',
      '##k=##J=####kkk=',
      'Jk####J####kkkk=',
      '==k#######kkk##=',
      'J=#J#kkkkkkkkkk=',
      '=J===#kk##kkkk##',
      '#kk###kk##x####=',
      'kkk=#kkkJJx#=#=k',
      '#=k#J=##JxJxJ==#',
      '#=#kk#kkJJ==J=J#',
      '##kkk###kkJ=J=x=',
      'J=kk#k#kkk=JJxxJ',
    ],
    [
      'J=J==kkkkk=Jxxxx',
      'J###k#k#kk##xx#=',
      '##kk#kJkk#k#===#',
      '#kk#k#J#kk#kk##k',
      'kk#kkk=#kk=kk###',
      'kkk#k##=#k#kkkk#',
      '==k##k#==kkk##kJ',
      'J=###==#kkkk##kJ',
      'JJ#k#=#k#k#####J',
      'J=#kkkkkkkk#####',
      'k##=#kkkkk#k###=',
      '#k##J#kkkkkkk###',
      '#kk#=##kkkkk#=#k',
      '##k#k##kkkk#J##J',
      '=#kkkk##kk##J=JJ',
      '=#kkkkkkkk=#xxJ=',
    ],
    [
      'xxx##kkkkk=JxxxJ',
      'J#k===kk#kk=x#Jx',
      'Jkkk#=k=#kkkkk##',
      'kk#kk#kk=#=k#kk#',
      'kkkkkk##x=J#=#k#',
      '##k#kkk#==kk#k#k',
      '=Jkkkkkk#kkkkk#=',
      '=Jkkkkkkkkkk#=##',
      '=J##kkkkkk######',
      '###kkkkkk###J##=',
      '##kk#k##=###J=k#',
      'kk###=##kk##=#=k',
      '#=#xJJ#k#k==JJ#k',
      '#####=##=#==xJJk',
      'J##kkk=###=#J==#',
      '==k##k#kkk=JJxx=',
    ],
    [
      'JJ==Jkkkkk#=xxxJ',
      'J##=kk#kkk##Jx##',
      'J#######kkkkJ==#',
      '####=====###kk#k',
      'k##JJ=#Jx=kkkkkk',
      '#====J=##Jkkkkkk',
      '=###k#xJ##k#k###',
      '=#kJJ=#J#J#==kk=',
      '####=#k#==x=#kkJ',
      '#k##k#=#kJ##kk#k',
      '#=kkkkJx=#=k#==#',
      '#kkk#=##JJJ#####',
      '#k#kkk#=J=xJkJJk',
      '###kk#k#Jxx==JJ=',
      '=#kkk#==#==##=xJ',
      '#Jkkkkkkk##=JxJ#',
    ],
    [
      'JxJ=##kkkkkJxJxx',
      '#k=#kkkkkkk###J#',
      '=##k###kkk###=k#',
      '#kk##=###=kk##kk',
      'kkk##=k#k##k####',
      '#k#J###===J=####',
      '==##=kk==###kk=J',
      'JJ=kkk#J#kk#kkk=',
      'xx##k#Jxx#kkkkkJ',
      '#==kkkxJJ=#kk#==',
      '###k=J==Jx=#####',
      '####JJx#x=xJ#J#k',
      'kkJxxxJx===J#J#=',
      '##kk##k##==J=xJk',
      '=#kkkk#kk##J=JJJ',
      'J=#kk#kkkk#=Jxxx',
    ],
  ],
  /* Spoil: dug out and dumped, so it lies in courses, with rust where the
     ruin has bled into it. */
  hill: [
    [
      'tIItIttttniitnIt',
      'tttttiitittItnnn',
      'itTIitttttIIIIIt',
      'ttttttitntttttII',
      'tttttnttiitititt',
      'tiinttttItIItttt',
      'IiiitttIIIIITttt',
      'tittInIIItTIIttn',
      'IIITTTtttiTTTTTI',
      'IIIITTInITITTIII',
      'IttttIIIntttIIII',
      'TTnTIIItIttITTTI',
      'TnTttIIItitTTItI',
      'nIntIIIItIITTntt',
      'iiiiintItItnitti',
      'tttttIItIIttinIt',
    ],
    [
      'tntntIttttttiitt',
      'tIttIITtnItttIII',
      'ttIntIiiiiInItit',
      'itItItitTTITTttt',
      'iTTTTIttITnITiii',
      'tIItTIIttItITttt',
      'ttItnInttIIIntIt',
      'ttttnttttInITnTi',
      'titInttInTTIIttt',
      'ittIIIIITITtttnI',
      'TttnITTItntIIIII',
      'IIttitIITIIIIItn',
      'TITntttITIIItttI',
      'InnttIITTIItiInt',
      'ttntntttIIttitii',
      'iitttntTTTtIitti',
    ],
    [
      'ittItttttiitiIit',
      'tIItttiiitItiIIt',
      'iInIntIttIttnItt',
      'tInTTITTIItInIti',
      'inITTTnIitiIttti',
      'ttttRnTIttITInin',
      'ItIITTTIITTTInIT',
      'TITIIITITtIIiitI',
      'ItntITtIIIIIIttI',
      'IInITTnTntttittI',
      'IIIInTTTIITtitTI',
      'TItnntnIIInttttI',
      'InIititIIIttittI',
      'IItIIttttIttittI',
      'ttitttttttttitII',
      'ttItttttntittiit',
    ],
    [
      'ttItItIttittiiTI',
      'tItIttTIITIttttt',
      'tttIIITTnIntttti',
      'ttItITTTTTntiitt',
      'inTIttITITTTITti',
      'ttItITITIIIttiIi',
      'ntttItttIIInItnt',
      'IItItttTIITTItII',
      'tntIITnTTTtiitiI',
      'tIIIIIIIIItttttI',
      'TIIIntInItnTTTTI',
      'IIttIntntiiIITII',
      'TIntttitItIItTII',
      'tntttitItnITIIIt',
      'tIiiitIttttnittI',
      'tnttnIITIIItitIt',
    ],
    [
      'tttnIntttInttIIt',
      'tIttIIIIntttnIit',
      'iiitittItItTItti',
      'inIiiinttttttttt',
      'itIttttitttItiii',
      'itiitTTItiiittii',
      'iittiIiittItTIii',
      'nttnIItitnItIIIn',
      'ItttTtiiitIIITTn',
      'IttITTititttIttt',
      'TTIIiittiitttttT',
      'IIttiiitititItII',
      'TIiiiiiiitiiiitt',
      'ItnniITIIIInnttI',
      'nttIItnnTttitttt',
      'tttnIttITIntittt',
    ],
    [
      'tIIIRIIttttiitIt',
      'tTTRnntttntttiIt',
      'ttTRtitiiinITTnt',
      'itIRtIIIttITTItt',
      'itTITIttttTTItii',
      'ittITIIttitIItnt',
      'ItIITTTItttITTTt',
      'IITITTTIItititTI',
      'tnITTTTTTInittII',
      'TIITTTTITnIitTTT',
      'TTITIInIIIIiittT',
      'TTnTIItnnttitTIT',
      'TITTIttitiiitint',
      'nTITnIItttitiitI',
      'tntntItIIttttItt',
      'ttittnttttntitIt',
    ],
  ],
  /* The one built surface, and the only place a repeat is the truth: a panel
     floor is laid on a grid, so the grid has to cross the tile edge and line up
     on the far side. The mortar runs down the middle of the tile rather than
     along its edge, which puts the seam through the middle of a slab, where the
     wear either side of it has to meld like any other ground. */
  floor: [
    [
      'MMMMxMMMjMMMjMMM',
      'MMMjjMMMjMMjMMMM',
      'MMjjMMMMjMMMMMMM',
      'jjMMMMMMjMMMMMMj',
      'xjMMMMMMjMMMMMMj',
      'xjMMMMMMJMjjMMMj',
      'xjMMMjMjJjjjjMjj',
      'jMMMjMjjJjxjjjjj',
      'jJJJJJjjjJJjjJJJ',
      'MjjMjjMMjjMjjjjj',
      'MMMMMjjjjMMMjjjj',
      'MjMjjjjMjMMjjxxM',
      'MMjMMjjjjMMjxjMM',
      'MjMMMMMMjMMjxxjM',
      'MMMjMjMMjMMjjjMj',
      'MMMjjjMMjMMjMjMM',
    ],
    [
      'MMMjjMMMjMMMMMMM',
      'MMMjjMMMjMjMMMMM',
      'MMMMjjMMjMMMMjMM',
      'MjjMMjMjjMMjjjMj',
      'xjjjjjjMJMMjMMMj',
      'xjjjjjMjJjMMMMjj',
      'xjjMMMjjJjMMMMjx',
      'jjjMMjMjJjjMjMjj',
      'jJJjjjjJJjjJJJjJ',
      'jMMMMMjMJjMMjjMj',
      'MMjMMMjMjMMMjjjj',
      'MMMMMMMMjMMjjjjj',
      'MMMMMMMMjMMjxjMM',
      'MMMjMMMMjMMMjjjM',
      'MMMMjjMMjMMjjjjM',
      'MMMjjjMMjMjjMMMM',
    ],
    [
      'MMMMjMMMjMMMMMMM',
      'MMjjjMMMjMMMMMMM',
      'MjjMMMMjJjMMMMMM',
      'jjMMMMMMJMMMMMMM',
      'jjMMMMMMJMMMMMMj',
      'xjjMMMMMjMMMMMMj',
      'xMMMMMMjJMMMjjMx',
      'jjMMMMMMJjMjjjjj',
      'jJjjjjjJJjJJJJjj',
      'jjMMMMMMJjMjjjMM',
      'jjjjMMMMjjxjjxjM',
      'MMMjjMMMjMjjjjjj',
      'MMMMMMMMjMMMjjjM',
      'MMMMjMMMjMjjjMjj',
      'MMMjjjMMjMjjjMjM',
      'MMMjTjMMjMMMMjMM',
    ],
    [
      'MMMMjjMMjMjMjMMM',
      'MMMjjMMMjMMMMMMM',
      'MMjMMMMjJMjjMMMM',
      'jMMMMMMjJjMMMMMj',
      'xjMMMMMjJjMjMMMj',
      'xjjMMMMxJxMMMMMj',
      'xjjMMMjxJjMMMMMx',
      'jMMMMMjxJjjMMMMM',
      'jJjjjjjJJJJJjJJJ',
      'jMMMMMjxJjxMjjMM',
      'jMMjjjMjJjxjMjjj',
      'MMjjjjjjJxjjjjjj',
      'MMjMjxxjJjjMjjMM',
      'MMMMjMjjJMMMMjjj',
      'MMMMjjMMjMMMjMjM',
      'MMMjxjMMjMMMMjMM',
    ],
    [
      'MMMMjjMMjMjMMMMM',
      'MMMjjMMMjjjMMMMM',
      'MMMMMMjMjMMMMMMM',
      'jjjMMMMjjjMMMMMj',
      'jjjMMMMjJjjMMMMM',
      'xjjMMMMjJjjMMMjj',
      'xMMMMMMMjjjMMMjj',
      'jjMMMMMjJjMjMMjj',
      'jjjjjJjJJJjjjjjJ',
      'MjjMjjjjJjjMjMMj',
      'jMMMMMMMjMjjjjjM',
      'MMMMMMMMjMMMMjjj',
      'MMMMMMMMjMjMMMMM',
      'MMMMMMMMjMjMMMjj',
      'MMMMMjMMjMMjMMMM',
      'MMMMjjMMjMjjMMMM',
    ],
    [
      'MMMMxMMMjMjjjMMM',
      'MjMjxjMMjMMMjMMM',
      'MMMjjMMjjjMMMMMM',
      'jjjMMMMMjMMMMMMj',
      'jjjMMMjMJMMMMMMM',
      'jjMMMMMMjMMMMMMj',
      'xMMMMjMMjMMMjjMj',
      'jMMjjjMMjMjMjjjj',
      'jjjjJjjjjjJJJJJj',
      'MMMjjjMMjMMMjMMM',
      'jMMjMMMMjMMMMjjj',
      'MMMMMMMMjMMMMMjj',
      'MTMMMMMMjMMMMMMM',
      'MMjMMMMMjMMMMMMj',
      'MMMjjMMMjMMMMMMM',
      'MMMjjMMMjMMjMMMM',
    ],
  ],
  /* The clearing: trodden bare earth, browner and flatter than the spoil it
     is cut into. */
  camp: [
    [
      'itIIIIITNTTTNTIt',
      'ITIItITIITITTTtt',
      'TIiiitINTTItIttI',
      'TIIttIIINItIITTI',
      'ItttitItItITINNI',
      'IIIItIIIIIIItIII',
      'tiItITIITNItItIT',
      'iitIIINTNITTTIIt',
      'iittIINITNTTIIIt',
      'iittttIIITTTNIti',
      'itiIIttTINNNTItt',
      'ttIiitITITNTTTII',
      'IItiitIIINNNIIIt',
      'IttittITTIIIIItt',
      'TIiittIIIItItttt',
      'ttttTITTIIItttIt',
    ],
    [
      'ttITITTTNTTTNTIt',
      'ItITIIITIITTIItt',
      'TtttIIIttIIITIIt',
      'IIIIITIttItIIITI',
      'ItIItITTIIIItINT',
      'tIttIITITITINTIt',
      'tttTTItTITTNNNTI',
      'tttITIITNTTTNNII',
      'itIITNNTNNITTNIi',
      'itTTITINTTNNITIt',
      'ittItItttITITTIt',
      'tIIItItItTINTItt',
      'TIttttItITTTNItt',
      'ItitttItItIIIttt',
      'TttiTIItIItItttt',
      'ItIIIIITNTITtIIt',
    ],
    [
      'tIIITIITNNITNTIt',
      'ItttIttItItTIIII',
      'ItttiitttttIIIII',
      'ItttiiiitittiIII',
      'ntttttititItttTT',
      'ItttiittIITItIII',
      'IItIIItTTTTTTIIt',
      'titITIITTINTTIIt',
      'itITTTtttITIITTt',
      'itItITtItIITTITt',
      'iitttTTTIttITTIt',
      'tItTITItIttITNTt',
      'TtTttIIItitTNItI',
      'ITttIIITtIITTTII',
      'TIittIITIIIItItI',
      'tttItTTTNNTTIIIt',
    ],
    [
      'itIIItTNNTNTTItt',
      'IttIIIIITItITIII',
      'TtttTItttttTTItI',
      'ItiINNITtITITTtI',
      'TtITTNTTTTNTITtI',
      'IttINTITITTTTITt',
      'IttTNTNIIITTTTII',
      'iItITTTttItIINIt',
      'itTItIIIItIITNTi',
      'itTTTIIIttttTITi',
      'itTNTNIIiitttITi',
      'tITTnIItiiiititI',
      'TITTntiiitiiIiiI',
      'IttIItttItittttt',
      'IItTTTTtttttittI',
      'IttIItTNTTItTttt',
    ],
    [
      'itTTITTTNNTTNTIi',
      'ttIIIIIITTtITtTt',
      'ITttITIttiITIITI',
      'IITITIiiitIITTIt',
      'ItITIItiiittITII',
      'IItTTItiitItITTI',
      'ItttItIIttITITII',
      'itttiItIIttTNITi',
      'iitiiitTTttITTIi',
      'iitiiiItitITTITi',
      'iittIttiitTIIITI',
      'IttITIIiittTtItt',
      'IttITTIIttIIIttt',
      'ItITtIIIIItItttt',
      'IIIIITIIIItIiiII',
      'tttItIINNTIIIttI',
    ],
    [
      'itttIITNTNTTTIII',
      'tIIIITTTTIIItIIt',
      'IITIItIITTiiItiI',
      'tTItttTTTIttiItI',
      'ttIIttTNNNTIiITI',
      'ttItIIINNTNIIITT',
      'ttIIItiTNTTNTIIT',
      'iitITttITITtITIt',
      'iitITIItIttIttIi',
      'itIItTItitttIIIi',
      'iiitIItIiIttttTt',
      'ttitiitItitItItI',
      'ItIiiiitttItttit',
      'TItItitittIttitt',
      'ItttItIIIItttttt',
      'ttttIITNTTIIItII',
    ],
  ],
  /* The ground the tent stands on — the same earth, in its shadow. */
  tent: [
    [
      'nNNTNIITNNTTITII',
      'TTITIIITNTTIIItI',
      'IITTTttttItttttI',
      'tIINTIItttitttII',
      'tIINNNItitiITIti',
      'ttTTTITIttitIIIt',
      'itTIttIttIIIitII',
      'ITTtitttIttIiItt',
      'TTIttItIITTtiItI',
      'TIItItIIITITttTT',
      'NIIIittTITITIITT',
      'TIITIITNTTTTNNII',
      'ttTTIIIINITNNTIt',
      'tIIIITTIITIITITt',
      'tttITItTIIITtIIt',
      'IIIIIItITTNTttII',
    ],
    [
      'NNNNIITNNNNTTItI',
      'NTNIIItITTITTITT',
      'IIITIItttItttIII',
      'IIITIIttIIttIIti',
      'itTTTITItIIttttt',
      'iIIIITITIItiIIIt',
      'itIitTTNTTIiItII',
      'ITItttTNNNtIiITT',
      'NNntttTNNTTttttT',
      'NNTIttTNNNItttTI',
      'TTTttIINNTttIIIN',
      'TIIITIITTTTTTTNt',
      'itITTTNTNNIIItTI',
      'itTTITTTTNTITIII',
      'iIIIIttTIIIIIIIt',
      'tTTTIItITNTIItII',
    ],
    [
      'INNTTTTNNTNTNTtT',
      'INTTIItITTItIIIT',
      'IIItItITTITItItT',
      'ttIiittTNTItItit',
      'itttItITNTIItttt',
      'ttIiittNNNIiitIi',
      'ttTttiINNNttiIII',
      'ItIItITNNTItttIt',
      'NTIIitINNNNTtIIT',
      'NItIIITNNNNITTIT',
      'NItTTTITNTNNITTT',
      'ItITITITNNTTTTNT',
      'ItIITNNTTTNITITt',
      'tttINITNNTTttTTI',
      'ttIITTINNIItItIt',
      'TTTITIITTNTIITIt',
    ],
    [
      'TTNTTTTTNNNTTIIT',
      'NTITItTINNTItttI',
      'TIIIIITInIttittt',
      'ItTtItITITIIiiII',
      'iITIttITINTtitti',
      'itIttItTITItttIi',
      'ttttItttITTIItIt',
      'TTtIIIITTTITttIT',
      'IItIITITNTtttttT',
      'TTIITTTTTTTIIIIT',
      'NIIIItIIIITTTTTI',
      'IIttIttItIIItITT',
      'tttttiiiIITItIII',
      'tItttiIIIITItITI',
      'iIittITIIITIittt',
      'tTIITTINNNNTIIII',
    ],
  ],
  /* Ash and scorched slab, with the odd ember not yet out. */
  fire: [
    [
      'TxT###xxTT=I#TTI',
      'TTT##TTITTTTITxI',
      'T=#TI=TxxIT=Tx=T',
      'TT=ITTxxjjIT==xT',
      'I#T#=ITjj==#T#IT',
      'T=##T=xjIT=T===T',
      '##k#TIxjTT=TT=#=',
      '#T===#TIxxTT##kT',
      'x==kkk=TIII##k#I',
      'I==k##=xxI==T#TT',
      'IxT##ITIxTTTxTTT',
      '==T#TTx#=TTxjx#T',
      'R##TIxx#=IIjjI#T',
      'T=I=TI=I=TxITx==',
      'IxT=IT#xITT=I=TI',
      'jT=T#=xTjjI#ITI=',
    ],
    [
      'jxxI#IITxx=TTIxx',
      '=IT==TIx=Ix==IT=',
      '#IIx#TxxIxx=#=x#',
      '=Tx=kkT#T==T##x=',
      '=x=##k#=##k#T=xI',
      'TTxTk==k=#=##T=T',
      '#=I#k#k===##=##k',
      'T#TT#k=IT=T==k==',
      'T=#=ITT=TIT=kk#I',
      'I=#=#==TxIII#T#I',
      'xT#k#k=TjjxII==x',
      'T=##T==xjxjjIxI#',
      'k###TxxjxIjxTxI#',
      'TTT==TTITTxTIT=T',
      'x=T##=#IjxxII===',
      'IITT=ITTxIII#TTI',
    ],
    [
      'TTT#TTTTIT=T=Txx',
      '=T=IITxxTIT==T==',
      'T=ITTIIIjTjxT=TT',
      '#=T=TTxxT=IIT=Ix',
      'TI=##T=TxTTIIITT',
      '==TTT#T=TTIjT=#=',
      '=TTjj##k##TjTx=k',
      '==Txxx=kk#ITj=##',
      'I#TIxx=kk#=jxIT=',
      'T==TIx=#kkTxxT=x',
      'IT=IxTT#k#IITTI=',
      '##TI#TT=======#I',
      'TT==##k=k#TITI##',
      'IT##T=#==#=T#==#',
      'xTTTxIT=xxITT##T',
      'jT=TT=xjxTxI=I=T',
    ],
  ],
  /* Under a canopy: the same growth as the open ground, a stop darker and a
     shade cooler, with what the tree has dropped on it. */
  tree: [
    [
      'GFHHgGHFfGHGhGfh',
      'FFffGFGHHFHGhGHF',
      'vHHHHvhgHgvfgHHv',
      'HvFgGHllFvGHFHGv',
      'GvfGGHhgGvgHGhHG',
      'GvHfGHfggvfHHgFF',
      'vGGgHHHhgvGHgfvF',
      'vHffHhgggFGGHfvG',
      'HGGGHhgGgvHffgGG',
      'hGHGHGGGvvFfHHFv',
      'FGHHfGFHGGHGGHFF',
      'FFfHlfHHFGGGFGGF',
      'vGGGhfgHFGGGgfGv',
      'GHHgHHfFFGvHhGFH',
      'ffHfGHGfFvFFgGlH',
      'GGGGHGGvFFHvHHgf',
    ],
    [
      'fGgHhGvFfHHFGfHH',
      'HvlgfHvHFHHHFvGG',
      'vvlgGfvFvGHGHFfF',
      'GfGFGgGvFHHFHggF',
      'FGFvvGfvFFFvlgGv',
      'GGGFFFFGGGHFhFGG',
      'HHGfFHvHHffGfFFv',
      'FFHFvFGGGGHHHFvF',
      'vFGFvFHgHGHHGGGF',
      'GFFFvvFGGFvFfGFF',
      'vGFHHFvFFvvvFGvv',
      'vGvGvGvfGvvGGGFv',
      'vFHFvGHHvvvFGvFv',
      'HGGHFHHGFGFFFGGH',
      'HHfGhGfGGGvFffGF',
      'GGFfgfHHGFFFfHFf',
    ],
    [
      'GFFHhgHFvAHFHHGv',
      'FGHgGllgfGHFHgGv',
      'vGHHHhlggfHFhlHv',
      'GHfghllhhfgFGfHv',
      'GgHllghllgGFFGvG',
      'FlhhglhffhFFvgFv',
      'FggHGllhffFFGgvv',
      'vHGhhlHhHhfHhHvv',
      'vvHHagGffflHfFvG',
      'vvGgGHgHGhHfGGFv',
      'fHvGFGllgHgHfffv',
      'GvGvfggHhhlHfvGF',
      'FFfvGHHllgllGHfv',
      'gHgGGHGglllffhfg',
      'hHHfGfHlgggGGHgh',
      'GfGHGFGFvfGFGHFv',
    ],
    [
      'HvFfGHGHGGGFlGvH',
      'vFgHgHHgGHGHhHHv',
      'FGGFFggllHgGfhHv',
      'vGGvGHfggglHggvF',
      'vFGvvFHhlllGFGGg',
      'vGFHFHFHalhfHFvv',
      'GGFGgHHggHHGhGFv',
      'GvFHhHfHGffGgFGG',
      'vvGfHgGGGFFghGHG',
      'GGFHGhFFGvGFgGvv',
      'vvFGhhfFHGGFHFvv',
      'FvFFHGFvGFGFvvGv',
      'FHvFfGGHFAGFvHGF',
      'GGGHhFFHHFHHFfFH',
      'FfhHgflFHGHFGHFH',
      'HHlfgHHfHGvFfhvG',
    ],
    [
      'HFvGgGFHHGGFFHGH',
      'GGGGfHHfGGHGGfvG',
      'vvHHGFGfglFFGHvv',
      'GFFHFHghggGHlGFG',
      'GHGFGHglflhHhFGg',
      'FFHvFGHlggGffFFF',
      'vfggGfGGHhHvGGHv',
      'FFHHHGfGGfhvvGHv',
      'HHHhfhfFFgGhFFHF',
      'FHGhhhHHlgFGGGFF',
      'FGGglgHllgvgfFvv',
      'vvHGhGHhlffFgGFv',
      'fGgGHFHAAHGHFHGF',
      'ggGFgGFGFAGfGgGG',
      'hHHGGFGHHFGGFfFF',
      'GGHfgGHGHHGHGHHF',
    ],
    [
      'AHHfHHHGHFFGFFGG',
      'vvgfGFGFGHGGGFhv',
      'vHlGHHHGHFHFHgGG',
      'FFflggHffhgFfHFA',
      'AAHlggggGghGggHA',
      'GGglHvhhhhlhfHlv',
      'FfhglvlhHgHfFGhF',
      'FfhHGHhlHHHfFFFv',
      'FfHgvglllaAGvvFG',
      'vGgHvGlllhgfGGHF',
      'FGGHglhhllhghGFv',
      'vGfhlllflglgghvv',
      'vFlgllllhglgggGv',
      'FfhFhFGGHfhgfhfv',
      'HflFGFFGFfHHGHHH',
      'HHHHHfGvGGFFGHGH',
    ],
  ],
  /* Wildflower. The kind that exists because 81% of a site was one green.
     It carries the warm end of the green ladder plus real flower heads — 7.2%
     of its pixels, in clusters of three to five, never singles, because a
     one-pixel gold at 16px is dust rather than a bloom. Heads are placed from
     centres that may hang over the tile border and clip, which is what keeps
     them out of the middle: a motif kept off the edge to buy a clean seam is
     a motif that repeats dead centre instead. */
  meadow: [
    [
      'ignhhnlaiihssaha',
      'hggnaahlsiasiall',
      'ngnatnlahilhsalh',
      'hnnTAgAnaYyYahhg',
      'ttAnggainlghiYAa',
      'AAAngonAanngYyoA',
      'hThagooiniaAaYhg',
      'nAggnYAAghatngia',
      'tnTAnAppphAntanA',
      'nnAnnispaagnghTn',
      'nngngglnnhaglnnn',
      'gntgAgtYhigalAga',
      'hhngaaAoYhiiaAaA',
      'Ahhgangyslghnhaa',
      'aingnAhllghlgnha',
      'ahnatggihhshgiha',
    ],
    [
      'ighNngaahlhlghag',
      'gagtnAliihlllslg',
      'lannaiashhhllasl',
      'ggnnAnahgaglgghl',
      'haglallhlllhlhaA',
      'hilinnlalaallohA',
      'glhtangliaagtooa',
      'anAnaghhahnnaYng',
      'ggnlaslAhltnTNTn',
      'nTAhyYhhhnnnNnnn',
      'nnngiYhnnnngnToo',
      'tghhhagntgtaAagY',
      'iahihhnngnhnnAhg',
      'lallalAgnhppnhga',
      'ygilhhnntngpnagA',
      'YohhihhglaailalA',
    ],
    [
      'gAgthnAlhglslllg',
      'alglhaahsalhllgl',
      'hahlhhlathinAAnl',
      'lahsllYyannanAgh',
      'halllgYhAntiAppg',
      'hllghnlgihaggphh',
      'ghnAnnnnngTAnnan',
      'aannnnotAnnnghna',
      'nnatnooYnahggtAA',
      'aaaAAnogAalhhtla',
      'nnnggghaATlYatan',
      'iaggnggnTnnyYnga',
      'ggaaAtgignAonhhh',
      'lhgaiAnhiaagaaat',
      'ghhnAnngAYYythni',
      'nhggihgaaaollgha',
    ],
    [
      'aanniAgiaaashall',
      'hAgnatAlhagihhlt',
      'loYYniiglngghihl',
      'ggyghAahhihhiilh',
      'thggnngaYsAggagl',
      'llniinnaYohlgaas',
      'ahiAanAhyhppphil',
      'tllagghlllhpaahl',
      'iailhalslslAghAn',
      'gglsslslYyihiath',
      'nggsihssYshlagTA',
      'nggshihhaillhagg',
      'lahiahnlalghhhgi',
      'higlloaalllgttaa',
      'gnAahoYlhnahgiaA',
      'nigtngoalhntnaah',
    ],
    [
      'laiahiAAlhliglah',
      'aitaahngghhighhg',
      'gginalaaalilanal',
      'Aaglhlsslhllhnng',
      'alhlalhsppslatat',
      'alaaglhhsphhanhh',
      'gaahYlshalslagnh',
      'inalyYahlaosannt',
      'TgaAongaAAooAAhg',
      'gaNntAnnhnYhthaa',
      'gAnnngTnghhhhhig',
      'YYotTtgghaAgaain',
      'gyhaAnnaannihAgn',
      'ghlalnngnnhalaga',
      'ashnAYoannllhhhg',
      'AaiAgoglaiiilhnt',
    ],
    [
      'tgnNtanhYYssiagg',
      'gaAnhgnhyhhlahtn',
      'hanntiglihggnnnh',
      'lAhnTallhlagglig',
      'gtanniilsihAAlll',
      'hinngtghastaaahh',
      'ppnnTgghhaAtgthl',
      'apagahaalhhaalgh',
      'gATNAnhslaAllYan',
      'AAgnYyAsshlllYon',
      'nNTNYolssahhlayn',
      'agNnnnhhlahlllhi',
      'lhnTooYlghlalllg',
      'haitionllhlhalhg',
      'hhaAglaAhhislilg',
      'igagaahgaillgghi',
    ],
  ],
  /* The broken photovoltaic field, and the game's own lore as ground: the
     lights went out and something under The Array started drawing power again.
     It is the darkest and coolest kind on the map, which is the job — the
     composition has nothing to sit against otherwise.

     Its first draft passed the seam metric by banning three of its twelve keys
     from the tile border outright, which bought a clean join at the price of
     parking the steel dead centre of every tile. That is why the checks now
     measure per-key border bias as well as the seam itself. */
  array: [
    [
      'BUdBBBdBdUBddBBB',
      'dUBddBxBdBBBBdUU',
      'dBdBddJUUMUddddd',
      'dBBBdxjUUMUdkddd',
      'UddBBJBBBBuddddB',
      'BBBBUxUMMbBddMMd',
      'MdBMMBUBUBUdkdkk',
      'JvFvJdddddxxBBdd',
      'kddddBBddBBMdddd',
      'kkddddBddddMdddk',
      'ddddBddxdddMdBdB',
      'dddBddddxdddBddd',
      'ddkBddBBBBxUBdBB',
      'dkdddkdBdUxUUUdd',
      'BBddddBdddBBUBBd',
      'BddddBdddBBMBBdB',
    ],
    [
      'dBdddddkddddBddd',
      'UBxdkdddddBddddd',
      'UdxdkkkdddkdddBd',
      'UddkkddkdddddBdd',
      'ddxJddJdBkdxBUBB',
      'BBxJdddJddBBdBxB',
      'kkBddkdkdddBUxdd',
      'dkJdddJJddMMMvFd',
      'dddBddMMBBddBdJx',
      'ddBkkkkkddddBddd',
      'BdBkkkdkdddddBBd',
      'dBMkdddkddBkdBBB',
      'BBMkkkdkkdddBddd',
      'ddMkkkkkdddddBdd',
      'dUUBBxBddBBBdBdB',
      'BUxJddxBdBddddBd',
    ],
    [
      'UxxxdBBBdBxxddxx',
      'dkdxddddBdBdBBUU',
      'ddkkdBBdBBdBBdBB',
      'dkdkddddBdddBBBd',
      'kdkkBMBddBdBdBBB',
      'dkkkddMBdddBxBBd',
      'ddBBBddMdkkxkkdk',
      'ddBMBBdBUkxkkkdk',
      'kddMBBddBkkkkkdd',
      'dkUBdBBddkkdkkdd',
      'ddUdBdBBBkkkkkUB',
      'ddBMBdBddUUuUuUB',
      'JdUMddBddBuUbUUB',
      'dBdMvBdddubuuUdd',
      'BUUvddddBUBBdUBU',
      'UbUBBBdBBUBddBBU',
    ],
    [
      'dBdddddBdUBdBduU',
      'dMJdMdFvvMMBBUUb',
      'MMJxxMMMUJJuxxxU',
      'dddBdddUbBUBBdBd',
      'BdBdBddbUbUUddBB',
      'dddBdddBUBBBddBB',
      'dddBdBdBBddBdddd',
      'kdddBdBUBBdBdBdk',
      'kBxBBBBddddBkddk',
      'ddxBUBUBddBBddkk',
      'ddxBBBddddBddddd',
      'ddUUBBdBdBdddBdd',
      'ddBBUdddBBBBBMdd',
      'dxBBUBUdddBdBBMB',
      'BxBBBBUdddddBBdM',
      'ddUBddBddBBddddB',
    ],
    [
      'jxBBdddddBBdBdUB',
      'dxddBdddkddUBdBU',
      'BBBBdkkddkBUBUBB',
      'BBUdddkddkbBUUUB',
      'xMMUBdkkddBUUbxx',
      'BdBBddBdBdddUBBB',
      'kkdddBddMdUddddk',
      'kkBBddddMdBdBBdk',
      'kddBdddvvBUUBBdk',
      'kdddBdkdFddBBBkd',
      'ddddBkddxdBUBBdB',
      'ddBdddddxdBBBxdd',
      'dBddddkBddddxBBd',
      'dddBdxdddBBddUdB',
      'BdddxdddBxBBdBdB',
      'BdBxdBBBBxdBdBBd',
    ],
    [
      'BdMBdddxBBddddMB',
      'ddMBBBBxdUdBdBBM',
      'UdMBBBBxBBUBBddB',
      'dBdddBBUBBdUUBBB',
      'dMdddBBBBUUdBddU',
      'dMddBBddBBdUBdBB',
      'kddBdUBdddddJBdk',
      'ddxBBBBMddddJdkd',
      'kdxBUjxMddddJddd',
      'kddUBjBUBBkBdBdk',
      'BdxUBUUxdddddBdB',
      'dUxBddBxdddddBBB',
      'dBUBBddxdddBBddB',
      'dJxBddBddBdkdddd',
      'dJxdBddxddBdddUB',
      'FFBBBdBMxdddBddB',
    ],
  ],
  /* Dense thicket, and the only new kind that blocks. Terrain that stops you
     is what gives a site a route through it rather than an open field; before
     this, rubble, crevice, trees and water together were under 5% of the map.

     Its deep shade is 'k', not '#'. Every hero and enemy draws its contour in
     '#', so a biome filled with it eats the silhouette of anyone standing
     against it — and a hero is about three tiles tall. No sprite uses 'k'. */
  bramble: [
    [
      'kHvvvvvkkvvfFNkh',
      'kvkGFvHFGhfFvNFv',
      'vFGFFhvGvvNkNvvv',
      'vFvGFFFGvFFFvFvf',
      'vThFFvvFFFvFFvvv',
      'vvFvvGFvvTvFvkFv',
      'FvvFFFvFTkvHvFFF',
      'ffFFfFFTvvkvHffH',
      'GvFvFFFvkvvvvkhF',
      'ffFGfvhTvvkkvvvv',
      'GkfFHvFhTFvvvkvH',
      'vkGFHvFvNNFkGGFT',
      'FFFFGFFNFGfvNTTf',
      'FFvvvFhFfFkvNTfF',
      'FFvfGGvvFHFNHfFF',
      'vvkFvhFFvFvFkkvv',
    ],
    [
      'fkFvvFFvvNhHkvvF',
      'vffvvFvkNvGGfkFv',
      'FvvFGkvNvvfFvHhv',
      'FvvFvkvkFvFfvvFh',
      'FvFFFvvFFvvFhvFv',
      'vFvvvvvkkGGGFGGF',
      'vFkvhGvvFffTvFfk',
      'vHvhNNNGFFFFfFff',
      'FvNNNNffFNfHHFFF',
      'vFFFFvfGHNFFFvFH',
      'FHNFGFffHNFNvFTT',
      'FFNvfHvfGfHNFhvf',
      'fFNFhfHFHHFNFkFF',
      'vHHFTFGvvfFvvHFv',
      'hkFvvFFvvFHvvvkk',
      'vFFvvvvvhFvFkkvF',
    ],
    [
      'FFvvhNvFFFGFFFvv',
      'kFvFvhGFFvFkvvkf',
      'vvkvvvvFvkvvFvfk',
      'GFvGFffFvvFhkfkF',
      'GFFFfFHvkvvkFFvv',
      'FHFvvFvfFvvvFFFF',
      'hvvFFFFFGvFkkFvv',
      'FFFFvvvFvFGFkHFG',
      'GvFkvTFvvFFkvFhF',
      'HFFvFTHkvvFFFFvH',
      'FFvFFFfFGNFvvvvf',
      'FHvFFkkTNFvvkhvf',
      'FkvGFvkkFFFNFvvF',
      'GFNNNNGvFvTNvvkF',
      'vGfFFfvThfTNvvFk',
      'FkfFFvFvkhHHvkNv',
    ],
    [
      'kFkkvFHFFFFvvkNF',
      'kFkvFHFFvvvFvvkN',
      'FvFFkNhFNFfFvffH',
      'FFvFkFvFFffFFfFv',
      'kvkkvFvFGGFFFFvf',
      'FkkkvvHFfFFFfNFv',
      'vGkFvFFvvvfffNFf',
      'vvkkFkFNNNNFfFHG',
      'fGkvvvHfHFHfHHFF',
      'vFGvvvFvFvFGvvfG',
      'FhFvvvGvGFvvvFHG',
      'vGFFvGFvvGFGkFHF',
      'FFGvvFvfhfvTkkFF',
      'FvvGFHHNFNGHFvhv',
      'vvvvffvFNNfFFffH',
      'vFvFFFFvFNfvFFFT',
    ],
    [
      'vkFvHvHvfvFvkvkv',
      'FFvfvNNhFhfFFFkv',
      'vvvFFFNvkkNfFvFv',
      'kFFhFGfvkvvfvvGF',
      'vvGvfFfGFFvvFvkk',
      'FFFFFkFHHkGvkFFH',
      'FFvvFFvkkFkvvvvH',
      'FvFvvkhvvhkfvvvF',
      'NTTTvfvvvvFfFFFH',
      'FfFkfffkFGGHGvGF',
      'GFvfvfkvNvvFFFhH',
      'fvvvfvvFNFFFGFvf',
      'fhvvFvTvNkvFFvFF',
      'FGvThTFFGGFvvFvv',
      'FNNNkvGvvvFFvFvv',
      'NkvkFvFfHfvFFvkv',
    ],
    [
      'FTHvkFvfvFvFkvFv',
      'vFTHFhFkkFFvkkFk',
      'FTTTTvvGkfFvvhvv',
      'kkHFvFFvNFHvvkfh',
      'kGFvFvvGNvkkvhkf',
      'FGGFGfFNNvhkkvvF',
      'TffFNNNGNFvkFkkG',
      'TFFHFvvfvFfvNvvF',
      'HGFFvfvNvvffvFvh',
      'FFfFvvvffvFNfGGF',
      'FvFvFkGkFHNGFFvG',
      'fvFvFhFkFHHFFvfF',
      'GhvvvvffFvFFFGFv',
      'FvGvvFGvFGFFGFvF',
      'vFFFvFGFGFGvvvvF',
      'vkFkvFFFkFGFkkFv',
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
  /* The tent, and the one thing at the camp big enough that a flat fill shows.
   *
   * The cone was three bands of one key each — cream, cream shadow, tan — and
   * at 48 pixels across that is three sheets of plastic, not cloth. The light
   * is still where it was drawn, left lit and right shaded; each band is a
   * short ramp of neighbouring warm shades now, dithered by a slow fold, the
   * weave, and the dirt of a place nobody has washed anything in a while.
   *
   * The seams are the part worth having. A tent is stitched from gores that
   * all meet at the peak, so the seam lines are radial, not vertical: they are
   * drawn at constant slope from the apex, which is what makes them converge
   * without anyone having to draw them converging. On the seam the cloth steps
   * a shade darker outright rather than being noised darker — a stitched panel
   * edge really is a change of tone, and it is the only place on a tent that
   * is.
   *
   * Inside: the doorway darkens to the void key at its head, where nothing
   * reaches, and warms down towards the fire; the fire itself is a proper
   * radial fall from pale yellow through the oranges to deep rust at the edge,
   * where it used to be a slab of one orange with a lighter slab inside it.
   */
  tent: [
    '................................................',
    '........................Y.......................',
    '........................t.......................',
    '........................n.......................',
    '........................N.......................',
    '......................#wit#.....................',
    '.....................#wwiWS#....................',
    '.....................#wwiWt#....................',
    '....................#wwiiitt#...................',
    '....................#WWSSSII#...................',
    '...................#WWWiSittt#..................',
    '..................#WWWWiSiittt#.................',
    '..................#WWWWWiiiItt#.................',
    '.................#wWWWiWSiitItt#................',
    '................#GGGGGGgFGGGvvvv#...............',
    '................#wWWWWiiSiittttt#...............',
    '...............#wWwWWWiiSiWitttII#..............',
    '...............#WwwWwWiiSiiWtIttI#..............',
    '..............#wwwwwWiiiSWiitttttt#.............',
    '.............#WWwwWwwSiiSiWSttIttIS#............',
    '.............#WWWwWwwiiiSiiSttItStt#............',
    '............#wWWWWwwwiiWSiWiWttISStS#...........',
    '...........#wWWwwWwwiWWiSiiiittISSStS#..........',
    '...........#wwwwwwwwiW#kkk#WittttSStS#..........',
    '..........#wWwwwwwwwiw#kkk#WiWStISttIt#.........',
    '..........#Wwwwwwwwwi#kkk###iWttIttttI#.........',
    '.........#GglgGGgGGlg#######FGGFFvvFvFF#........',
    '........#wWwwwWiwwwi#########itttIttttIS#.......',
    '........#wWWwWWWWwwi####=####itttttttttt#.......',
    '.......#wiwwWWiWWwwi#==##===#iWtttIttttIt#......',
    '.......#WWWWWiWWWWw#======#=##WtSSttStttI#......',
    '......#wWWWWWiWWWwW#====N====#itttttSSttIt#.....',
    '.....#wWWWWWWiWWww#=N===N=N===#ttttISStttII#....',
    '.....#WiWWWWiWWWww#ooYYYyYYYYY#ttttttttttII#....',
    '....#wiWWWWwiwwwwW#oYYyyyyyYYY#itttttSSSSSIt#...',
    '...#WiWWWWWWiWwww#ooYYyyyyyYYYo#ttttItSSSttIS#..',
    '...#WWwWWWWiWWwww#oooYyyYyYoooO#SSttttSttStIt#..',
    '..#wiWwWWWWiWWww#OooooYYYYYoooor#StttIttttttIt#.',
    '..#tGGggglgGGGGg#RrOooOoooooorRO#vFGvvvvvFGGNG#.',
    '.##iWwWWWWiWwWwwwiWWWWWWiWWWWWWWWSSSttItttttt#t#',
  ],
  /* The array, and the one prop built to be stood next to itself.
   *
   * A panel is an elevated square: a slab of cells on posts, with a pale rail
   * along its far edge and a shadowed lip along its near one, which is the
   * whole of what says "held up off the ground" at this size. It is one tile
   * wide and fills that tile, so two side by side make a continuous deck with
   * a frame line between them rather than two objects with grass showing
   * through the gap.
   *
   * Up the screen it is cut to swallow the one behind it. Props are bottom
   * anchored on the floor of their tile, so a sprite this many rows tall hangs
   * that many rows minus sixteen over the tile above:
   *
   *     24 rows tall, 16 of deck and 8 of legs
   *     bottom anchored at (y+1)*TILE, so it covers y*TILE-8 .. y*TILE+15
   *     the panel one row back covers y*TILE-24 .. y*TILE-1
   *       its legs, being its last 8 rows, are y*TILE-8 .. y*TILE-1
   *       this one's deck, being its first 8 rows, is the same 8 rows
   *
   * The legs are exactly as tall as the overhang, so the deck in front lands
   * on the legs behind pixel for pixel — and the depth sort already paints the
   * nearer row second, because that is what makes walking behind a tree work.
   * A field of panels is decks and frame lines all the way back, with legs
   * only under the front row, which is what a solar farm looks like.
   *
   * That is why the deck's first eight rows carry no transparent pixel. Open a
   * gap anywhere in them and a leg shows through it from a tile away.
   */
  panel: [
    '################',
    '#mmmmmmmmmmmmmm#',
    '#UUbUMUbUUMUUbc#',
    '#UbUUMUUbUMUbcU#',
    '#UUUbMbUUUMUcUb#',
    '#MMMMMMMMMMMMMM#',
    '#BBUBMBUBBMBBUB#',
    '#BUBBMBBUBMBUBB#',
    '#BBBUMUBBBMBBBU#',
    '#MMMMMMMMMMMMMM#',
    '#BdBBMBBdBMBdBB#',
    '#BBdBMdBBBMBBdB#',
    '#dBBBMBdBBMdBBB#',
    '#jjjjjjjjjjjjjj#',
    '#JJJJJJJJJJJJJJ#',
    '################',
    '...xJ......xJ...',
    '...xJ......xJ...',
    '...xJ......xJ...',
    '...xJJJJJJJxJ...',
    '...xJ......xJ...',
    '...xJ......xJ...',
    '..#xJ#....#xJ#..',
    '..####....####..',
  ],
};

/* Three cuts of tree, chosen per tile, so a copse is not one shape repeated.
 *
 * The silhouette and the light are hand-drawn: lit crown to the upper left,
 * shaded underside to the lower right, lobes separated by their own outline.
 * What changed is what fills them. A canopy painted in four greens can only be
 * four flat areas with hard seams between them, and at this size flat reads as
 * plastic — no tree has a smooth surface, it has thousands of leaves each
 * catching the light differently.
 *
 * So every shade the drawing used is a band of seven neighbouring greens now,
 * dithered by noise at three scales: leaf masses, individual leaves, and one
 * slow drift across the whole crown for which side the sun is on. The bands
 * overlap, so light shades into shadow instead of stepping into it, and the
 * rare brightest pixel comes out in sunlight yellow — a leaf turned edge-on.
 *
 * The trunks are striped rather than two flat columns, on the same principle:
 * bark is fibre, and three browns down the ramp with the odd knot say so.
 */
export const TREE_ART = [
  [
    '................................',
    '................................',
    '................................',
    '..............#.................',
    '..........###lll###.............',
    '........##yllllllll##...........',
    '.......#yhhllllllllhH#..........',
    '......#llllllllllllHHg#.........',
    '.....#llllllhllllGHHHhG#........',
    '....#lllllllhlllGHHGGGFG#.......',
    '....#llllllllllggGGGgGgF#.......',
    '...#llllylllllHGHGHgGGgFv#......',
    '...#llllllllhHHHhhhGGGGvv#......',
    '...#llllllllHHHHhHHGGGv#v#......',
    '...llllllllhfHflHHH##hghlh##....',
    '..#lllll#lfllfflfH#lhhhhhhhG#...',
    '...l##lllll##HhhH#llllhhhhFGf#..',
    '...#llllllllf#HH#llylhhlyGGGGG#.',
    '..#llllllllffh##yllllhhhhGHGGGG#',
    '.#hyllllllfffHH#llllllhGhHHGGGf#',
    '#llhhhlllfllffHf#yllhhHHHGGGgFvv',
    '#llhhhlhGHhHfHHH#yyllGghHghGgvvv',
    'lllyhhhGGGGGHHfvvlhlHHGGhgGgFvvv',
    'lhllllgGGhGGHGFvvllGHHGHHHGvvvvv',
    'hhlylHgHHHGhGFvvF#HHGGGGHHFvvvvv',
    'llllHHHHHGGGvvvFFGGGGGGGhvvvvvv#',
    'lllGGHHgHGFvvvFFFGGhHHGGFvvvvvv#',
    '#lGHgHHHHGvvvFFF#GGGhHgvFvvvvv#.',
    '#GGgGHHHHvvvFGFF##HHfGvvFvvvv#..',
    '.#GHGhHHvvvFFFF#NN#HfFvvFFvv#...',
    '..#GHggvFvvvFF#tNNN##FFFFv##....',
    '...#GHvFFvvvF#ntNNn#...#........',
    '....##vvFvF##nntNNN#............',
    '........#...#tttNNN#............',
    '............#nntNNN#............',
    '............#tntNNN#............',
    '............#nnnNNN#............',
    '............#nnnNNN#............',
    '............#nntNNn#............',
    '............#nntnNn#............',
    '............#nntnNn#............',
    '............#nntNNn#............',
    '............#nnnNNN#............',
    '........#...#nntNNn#...#........',
    '........N#..#nntNNn#..#n........',
    '.........n#.#nntNnn#.#N.........',
    '..........N##nntNNn##N..........',
    '...........N#nntnNN#n...........',
  ],
  [
    '................................',
    '................#...............',
    '............###lll###...........',
    '..........##hhlllllll##.........',
    '........##lllllhhlllllf##.......',
    '.......#lllllllhhllllffHH#......',
    '......#lllllllllllllflfHGH#.....',
    '......#lyllylhhllllHHHHhHH#.....',
    '.....#lllllllhghhlGHHhGHHHf#....',
    '.....#llyyllllhhhGGgGGGGHHf#....',
    '....#lllllllhhlhGGFGgGHHGgFF#...',
    '....#lylylllyllGgGGgGGHH#FGF#...',
    '....#lll#lllllHGgGGg##lllll##...',
    '....##lllly##gGGgg##llyllllly##.',
    '..##lllllllll##GG#hlllllllllHGG#',
    '.#llllllllllhHg##lllllllyllhhgGG',
    '#llllllllllhHGGG#yllllllllHHgGGG',
    '#llllllyllHHHgG#lllllllllgGHHhHG',
    'lllllylylfhHGHH#lllllhhlgHGGHHGh',
    'hllllllyHGHGGHHllylhlhhgGGGGGgHF',
    'hhlllllhgGFGHHflllhhlhFGgGGgGGvF',
    'hhhhllfHGgGhHH#llylllGgGFGHGGvFF',
    'hhhllHHhgHHGHFFlllllHgGGGGHgvvvv',
    'hllhGHGHHgHHFFFllllHhHgHHGHvvvvv',
    'hhlGHGGHHHHvvvv#llhlllfHHGvvvvvv',
    'llGgGGGgHHFFFFF#lfHHhHfHHFvvvvvv',
    'lGGGgGGGHvFGFFFF#HlHghHHFFvFvFvv',
    '#GGGHGgHFFvFGFFF#HHHhhHFGFFvvvFv',
    '#GHHGGGFFFvFFFFF##HHHHFFGGFvvvF#',
    '.#HHGHFFFFFvFFv#Nn##GvvFFFGFv##.',
    '..##lFGFFFGFv##nNnn###vvFFG##...',
    '....##vFFFF##nnnNnn#....#.......',
    '........#...#nnnNnN#............',
    '............#nnnNnN#............',
    '............#nnnNnN#............',
    '............#nnnNNN#............',
    '............#nnnNNT#............',
    '............#ntnNNT#............',
    '............#ntnNNT#............',
    '............#ttnNNN#............',
    '............#nnnNnT#............',
    '............#nnnNNT#............',
    '............#nnnNNN#............',
    '........#...#ntnNNN#...#........',
    '........n#..#ntnnnT#..#n........',
    '.........n#.#ntnNnN#.#N.........',
    '..........N##nnnNNN##N..........',
    '...........N#nnnNnN#n...........',
  ],
  [
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '.................#..............',
    '.............##llhhh##..........',
    '...........##lllllhhhh##........',
    '..........#lllllllllllHg#.......',
    '.........#lllllllllllhHgG#......',
    '.....##lllll##llllllHHGGFF#.....',
    '...##lllllllll##lllHhhGgGF#.....',
    '..#llllllhhlhGHH#lGGGGGGFGv#....',
    '.#lylllllhhhGhhHG#GGfGGGgvv#....',
    '.#lyyyllhhhGGHfHG#GGFGGGvvvv....',
    '#lylllllhhGggGffHH#gGGgvvvvv....',
    '#ylllllllGGGGGHHGv#GGGvvvvvv#...',
    'lyllllllhGGGFGGHFvvGGv#FFvvv....',
    'lllllylgGGgGGgGFFvv#hlhll#vv....',
    'llllllGGGGgGgGvvv#hhllhlllG#....',
    'llllyHGHGGgGGvvv#hhlllllhGGG#...',
    'lllyHhlHGGGgvvvvhlhlllhlGGGGG...',
    '#lhGHGHGgGGvvFF#lllylllGgggGG#..',
    '#hGGHHGGggvvvvGlllllllgGGGgHvv..',
    '.#GGGGGHGvvvvvFllylllHHHGgGvvv..',
    '.#GgGGHhFvvvvF#yllllHgHhGGvvvv#.',
    '..#gGGGvvvvvvvFllllGGgGgGvvvvv..',
    '...##gvvvvvvvv#lllgGGgFfvvvvvv..',
    '.....##vvvvv##n#lgGGGgGvvvvvv#..',
    '.........#..#nnnHHGGGGvvvvvvv...',
    '............#nnn#HHGGvvvvvvv#...',
    '............#nnnN#GGFvvvvvv#....',
    '............#tnnNTN#vvvvv#......',
    '............#tnnNTT#..#.........',
    '............#tnnNNN#............',
    '............#tnnNNN#............',
    '............#nnnNNT#............',
    '............#tnnnNN#............',
    '............#ttnnNN#............',
    '............#ntnnNN#............',
    '............#nnnnNN#............',
    '............#ntnnnN#............',
    '........#...#nnnnNN#...#........',
    '........n#..#nnnnnn#..#N........',
    '.........n#.#tnnNNN#.#N.........',
    '..........N##nnnNNN##T..........',
    '...........n#tnnnNN#N...........',
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
  /* An upward chevron: what you hand somebody else so their turn is better
     than it was going to be. The fourth kind, and the first one that is not
     about you — a buff card only ever reads as worth playing because there is
     another seat at the table. */
  buff: [
    '...oo...',
    '..oOOo..',
    '.oOooOo.',
    'oOo..oOo',
    '..oOOo..',
    '.oOooOo.',
    'oOo..oOo',
    '........'
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
  /* Chips: a board prised out of something that used to think. Green, with a
     black package sat on it and two rows of legs — read as a circuit board at
     eight pixels because the legs are what say it, not the traces. */
  chip: [
    '.llllll.',
    'l#l##l#l',
    'l######l',
    'l#xxxx#l',
    'l#xxxx#l',
    'l######l',
    'l#l##l#l',
    '.llllll.'
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

/* ============================================================== the pack === */

/* The Hauler's items, 8x8 like every other icon in this file.
 *
 * A pack item is drawn once per cell it covers, not once per item: a Sledge is
 * five cells and five stamps of the same 8x8, which is what makes a piece read
 * as *bulk* rather than as a picture with a shape attached. The eye is meant
 * to be counting cells, because cells are the currency.
 *
 * So each of these is a **material**, not a portrait. Steel for the tools,
 * canvas for the soft things, rust for the ones that came out of a wreck. The
 * item is told apart by its silhouette on the grid and its name on the card;
 * the icon's job is only to say what it is made of and how heavy it is.
 */
export const PACK_ART = {
  /* --- kits ------------------------------------------------------------ */
  behind: [
    '.MMMMMM.',
    'MmmmmmmM',
    'MmMMMMmM',
    'MmMmmMmM',
    'MmMmmMmM',
    '.MmMMmM.',
    '..MmmM..',
    '...MM...'
  ],
  setfeet: [
    '..#nn#..',
    '.#nNNn#.',
    '#nNiiNn#',
    '#NiiiiN#',
    '#NiiiiN#',
    '#nNiiNn#',
    '.#nNNn#.',
    '..####..'
  ],
  roll: [
    '.#wwww#.',
    '#wWWWWw#',
    '#WwwwwW#',
    '#WwqqwW#',
    '#WwqqwW#',
    '#WwwwwW#',
    '#wWWWWw#',
    '.#wwww#.'
  ],
  legup: [
    '..#ss#..',
    '.#sSSs#.',
    '#sSNNSs#',
    '#SNiiNS#',
    '.#NiiN#.',
    '..#ii#..',
    '.#nNNn#.',
    '..####..'
  ],
  crossbow: [
    '#NN#NN#.',
    'NnnNnnN.',
    '.NnnnN..',
    '..MMM...',
    '..MmM...',
    '..MmM...',
    '..MmM...',
    '..#M#...'
  ],
  tarp: [
    '.aaaaaa.',
    'aAAAAAAa',
    'aAiiiiAa',
    'aAitttAa',
    'aAitttAa',
    'aAiiiiAa',
    'aAAAAAAa',
    '.aaaaaa.'
  ],
  fieldkit: [
    '..####..',
    '.#nNNn#.',
    '#wwwwww#',
    '#wweeww#',
    '#weeeew#',
    '#wweeww#',
    '#wwwwww#',
    '.######.'
  ],
  charge: [
    '...#R#..',
    '..#rRo..',
    '.#RRRR#.',
    '#RrrrrR#',
    '#rIIIIr#',
    '#rIttIr#',
    '#RrrrrR#',
    '.######.'
  ],
  stretcher: [
    '#N####N#',
    'NnwwwwnN',
    'NnwWWwnN',
    'NnwWWwnN',
    'NnwWWwnN',
    'NnwWWwnN',
    'NnwwwwnN',
    '#N####N#'
  ],
  dragline: [
    '..MMM...',
    '.M#.#M..',
    '.M...M..',
    '..M.M...',
    '...M....',
    '..iMi...',
    '.iIMIi..',
    '..iIi...'
  ],
  sledge: [
    '.JJJJJJ.',
    'JxxxxxxJ',
    'JxMMMMxJ',
    'JxxxxxxJ',
    '.JJnnJJ.',
    '...nn...',
    '...nN...',
    '...NN...'
  ],

  /* --- ballast --------------------------------------------------------- */
  plate: [
    '########',
    '#JJJJJJ#',
    '#JxxxxJ#',
    '#JxMMxJ#',
    '#JxMMxJ#',
    '#JxxxxJ#',
    '#JJJJJJ#',
    '########'
  ],
  bracing: [
    '#N####N#',
    'NnnNNnnN',
    '.NnnnnN.',
    '..NnnN..',
    '..NnnN..',
    '.NnnnnN.',
    'NnnNNnnN',
    '#N####N#'
  ],
  tin: [
    '.######.',
    '#MmmmmM#',
    '#mMMMMm#',
    '#mMhhMm#',
    '#mMhhMm#',
    '#mMMMMm#',
    '#MmmmmM#',
    '.######.'
  ],
  boltcase: [
    '.#NNNN#.',
    '#nnnnnn#',
    '#nMnMnn#',
    '#nMnMnn#',
    '#nMnMnn#',
    '#nnnnnn#',
    '#NNNNNN#',
    '.######.'
  ],
};
