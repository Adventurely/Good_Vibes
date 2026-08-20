/* The Hauler's pack — the fourth build-phase economy, and the first one that
 * is a shape rather than a number.
 *
 * Every other seat spends a pool: the Alchemist's stash, the Engineer's
 * salvage, the Wizard's pages. The Hauler spends *room*. Three items arrive
 * every build phase whether he wants them or not, the bag is smaller than they
 * are, and what does not fit is left on the ground. That is the whole of it.
 *
 * Why this is its own file. It is self-contained geometry with one outward
 * reference — a card id, which is a string — and content.js is already 2900
 * lines carrying five economies. It re-exports everything below, so the
 * published contract, the Worker's import and the browser's are all unchanged.
 *
 * The one rule this file must keep: **it imports nothing from content.js.**
 * content.js imports and re-exports this module, and a cycle between them
 * would put a live binding in the temporal dead zone at module scope — which
 * in this project is a throw at the top of the deployed Worker. Everything
 * here is therefore pure geometry over its own tables, and anything it cannot
 * know is passed in, exactly as every roller in content.js takes its own
 * `random`.
 */

/* ============================================================ the shapes === */

/* Cell offsets from the piece's own origin, before rotation. Written as lists
 * rather than as grids because rotation is arithmetic on a list and parsing on
 * a grid, and because two pieces are allowed to share a silhouette — an
 * Antiseptic Roll and a Set Your Feet are both an `L3` and read apart by their
 * colour and their icon, not by their outline.
 */
export const PACK_SHAPES = {
  D1: [[0, 0]],                                            // a single cell
  D2: [[0, 0], [1, 0]],                                    // the domino
  I3: [[0, 0], [1, 0], [2, 0]],                            // a flat bar
  L3: [[0, 0], [0, 1], [1, 1]],                            // the corner
  I4: [[0, 0], [1, 0], [2, 0], [3, 0]],                    // the long bar
  T: [[0, 0], [1, 0], [2, 0], [1, 1]],                     // the crossbow
  O: [[0, 0], [1, 0], [0, 1], [1, 1]],                     // the square
  L: [[0, 0], [0, 1], [0, 2], [1, 2]],                     // tall, footed
  J: [[1, 0], [1, 1], [0, 2], [1, 2]],                     // tall, footed left
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],                     // the skew
  V: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],             // five, right-angled
  P: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]],             // five, blocky
};

/* One quarter turn clockwise, then pulled back against the axes so a piece's
   cells are always measured from its own top-left however it is turned. Pure,
   so the client's ghost and the room's check rotate identically. */
export function rotateCells(cells, turns = 0){
  let out = cells.map(([x, y]) => [x, y]);
  const quarter = (((turns % 4) + 4) % 4);
  for(let t = 0; t < quarter; t++) out = out.map(([x, y]) => [-y, x]);
  const minX = Math.min(...out.map(([x]) => x));
  const minY = Math.min(...out.map(([, y]) => y));
  return out.map(([x, y]) => [x - minX, y - minY]);
}

/* The cells one item covers at a rotation, in item-local coordinates. */
export function shapeCells(shapeId, rot = 0){
  const shape = PACK_SHAPES[shapeId];
  return shape ? rotateCells(shape, rot) : [];
}

export function itemCells(itemId, rot = 0){
  const item = PACK_ITEMS[itemId];
  return item ? shapeCells(item.shape, rot) : [];
}

/* How many distinct silhouettes a piece has. A square is one however you turn
   it, a domino is two, and the ghost should not offer four when three of them
   are the same picture. */
export function rotationsOf(shapeId){
  const seen = new Set();
  for(let r = 0; r < 4; r++){
    seen.add(shapeCells(shapeId, r).map(c => c.join(',')).sort().join(' '));
  }
  return seen.size;
}

/* ============================================================== the bag ==== */

/* The bag is five across and four down at its largest, and it is never a
 * rectangle until the last round.
 *
 * It grows on a schedule rather than being bought, on the precedent the
 * library already sets: PAGES_PER_ROUND pays the Wizard a page every build
 * phase simply for being seated, because the draft is her whole game and a
 * round with no page is a round spent watching. The pack is the Hauler's whole
 * game and health is the one pool in this project that never comes back, so
 * taxing it for the thing the seat is *made of* would be a toll on existing.
 *
 * Growth is the progression. The items churn — three arrive every build phase
 * and most of them will not fit — so the thing that compounds across a run has
 * to be the container, which is also the only sentence his own bio asks for:
 * *knows to within a kilo what they can take, and takes that much*. It is
 * legible for the reason the wave tables are: a bag that visibly grows a row
 * is something you see, where "+2 capacity" is something you read.
 */
export const PACK_W = 5;
export const PACK_H = 4;

export const PACK_GRIDS = [
  ['.....',
    '.XXX.',
    'XXXXX',
    'XXXXX'],                                              // round 1 — 13 cells
  ['.XXX.',
    '.XXX.',
    'XXXXX',
    'XXXXX'],                                              // round 2 — 16
  ['.XXX.',
    'XXXXX',
    'XXXXX',
    'XXXXX'],                                              // round 3 — 18
  ['XXXXX',
    'XXXXX',
    'XXXXX',
    'XXXXX'],                                              // round 4 — 20
];

/* Clamped at both ends on purpose: round 0 never happens, and a run that grows
   a fifth round finds the biggest bag rather than `undefined`. */
export function gridFor(round = 1){
  const i = Math.min(PACK_GRIDS.length - 1, Math.max(0, Math.round(round) - 1));
  return PACK_GRIDS[i];
}

export function gridHas(round, x, y){
  const grid = gridFor(round);
  if(y < 0 || y >= grid.length) return false;
  if(x < 0 || x >= grid[y].length) return false;
  return grid[y][x] === 'X';
}

export const gridCells = (round = 1) =>
  gridFor(round).join('').split('').filter(c => c === 'X').length;

/* ============================================================ the items ==== */

/* Eleven kits and four ballast.
 *
 * A **kit** is an option in the surge and nothing else — it puts a card in his
 * list for as long as it is in the bag, and takes it away the moment it is
 * not. Three of them (Get Behind Me, Set Your Feet, Leg Up) were his entire
 * CLASS_ACTIONS list until this existed, with the numbers they have always
 * had. Moving them in rather than leaving them free is what makes the pack
 * load-bearing: his floor is two basics, and everything above it is something
 * he found room for.
 *
 * **Ballast** is flat and passive — it is applied once as the fight opens and
 * never asks for a turn. It exists because a packing puzzle without small
 * pieces is a puzzle with dead holes in it; every inventory-tetris game ever
 * made carries ammunition and herbs for exactly this reason.
 *
 * `weight` is the draw, in the shape MODIFIER_WEIGHTS uses: bigger kits are
 * rarer, so the five-cell pieces are things that happen to a run rather than
 * things a run is built on.
 *
 *   kind     'kit' — grants CARDS[card]; 'ballast' — grants `gives`
 *   shape    a key into PACK_SHAPES
 *   cells    what it costs in room, derived below rather than typed twice
 *   weight   its share of a draw
 */
const ITEMS = {
  /* --- the kits, smallest first --------------------------------------- */
  behind: {
    name: 'Get Behind Me', kind: 'kit', shape: 'I3', card: 'behind', weight: 6,
    note: 'Three feet of you between it and them. It is the whole trick and it works.',
  },
  setfeet: {
    name: 'Set Your Feet', kind: 'kit', shape: 'L3', card: 'setfeet', weight: 6,
    note: 'Nothing in the bag but the habit of bracing. It stacks, and it does not wear off.',
  },
  roll: {
    name: 'Antiseptic Roll', kind: 'kit', shape: 'L3', card: 'roll', weight: 6,
    note: 'Gauze and something that stings. Whatever the sap did, this undoes.',
  },
  legup: {
    name: 'Leg Up', kind: 'kit', shape: 'J', card: 'legup', weight: 4,
    note: 'Laced fingers and a boot. Costs you more than it costs them, which is the point.',
  },
  crossbow: {
    name: 'Winch Crossbow', kind: 'kit', shape: 'T', card: 'crossbow', weight: 4,
    note: 'Cranked, not drawn. Slow, heavy, and it does not care how far away the thing is.',
  },
  tarp: {
    name: 'Rigging Tarp', kind: 'kit', shape: 'O', card: 'tarp', weight: 4,
    note: 'Thrown over the whole crew at once. Everybody gets a little, nobody gets enough.',
  },
  fieldkit: {
    name: 'Field Kit', kind: 'kit', shape: 'L', card: 'fieldkit', weight: 4,
    note: 'He patches you with what he has, and what he has is mostly himself.',
  },
  charge: {
    name: 'Blast Charge', kind: 'kit', shape: 'S', card: 'charge', weight: 4,
    note: 'Quarry stock, tamped by hand. It goes off in the middle of all of them.',
  },
  stretcher: {
    name: 'Stretcher', kind: 'kit', shape: 'I4', card: 'stretcher', weight: 4,
    note: 'Two poles and a sheet. Four cells of bag, and it is somebody standing back up.',
  },
  dragline: {
    name: 'Drag Line', kind: 'kit', shape: 'V', card: 'dragline', weight: 2,
    note: 'Hooked on and hauled clear. More of the wave than Get Behind Me buys, and no blood.',
  },
  sledge: {
    name: 'Sledge', kind: 'kit', shape: 'P', card: 'sledge', weight: 2,
    note: 'Twelve pounds on a hickory shaft. Everything it touches stops being a shape.',
  },

  /* --- the ballast ------------------------------------------------------ */
  plate: {
    name: 'Ballast Plate', kind: 'ballast', shape: 'D2', weight: 5,
    gives: { heft: 2 },
    note: 'Dead weight, carried on purpose. Everything you swing carries it too.',
  },
  bracing: {
    name: 'Bracing', kind: 'ballast', shape: 'D2', weight: 5,
    gives: { ward: 3 },
    note: 'Strapping across the shoulders. The first blow of a fight finds it first.',
  },
  tin: {
    name: 'Ration Tin', kind: 'ballast', shape: 'D1', weight: 5,
    gives: { regen: 2 },
    note: 'Eat while you work. One cell, and the only thing in the bag that gives back.',
  },
  boltcase: {
    name: 'Bolt Case', kind: 'ballast', shape: 'D1', weight: 5,
    gives: { bolt: 2 },
    note: 'Quarrels, cased. Worth nothing at all unless the crossbow turned up.',
  },
};

/* `cells` is derived rather than authored: a shape edited without its count
   edited beside it is the kind of drift a table like this invites. */
export const PACK_ITEMS = Object.fromEntries(
  Object.entries(ITEMS).map(([id, item]) =>
    [id, { ...item, id, cells: PACK_SHAPES[item.shape].length }]),
);

export const PACK_KINDS = ['kit', 'ballast'];

export const packItem = id => PACK_ITEMS[id] || null;

/* The card a kit grants, or null. One indirection rather than none, because a
   kit and its card are allowed to be named differently. */
export const packCard = id => (PACK_ITEMS[id] || {}).card || null;

/* ========================================================== the packing ==== */

/* The item occupying a cell, as an index into `placed`, or -1. Addressing by
   coordinate rather than by identity is what lets two Ration Tins be two
   Ration Tins: the pack never needs to tell them apart, because the only
   question ever asked of one is which cell it is under. */
export function packAt(placed, x, y){
  for(let i = 0; i < (placed || []).length; i++){
    const p = placed[i];
    for(const [cx, cy] of itemCells(p.id, p.rot || 0)){
      if(p.x + cx === x && p.y + cy === y) return i;
    }
  }
  return -1;
}

/* Every cell the bag currently has something in. */
export function packFilled(placed){
  const filled = [];
  for(const p of placed || []){
    for(const [cx, cy] of itemCells(p.id, p.rot || 0)) filled.push([p.x + cx, p.y + cy]);
  }
  return filled;
}

export const packUsed = placed => packFilled(placed).length;

/* Can this item go here, at this rotation, in this round's bag?
 *
 * `ignore` is an index into `placed` that does not count as an obstruction,
 * which is what makes dragging a piece one cell to the left work: the move is
 * checked against a bag it is still notionally in.
 */
export function packFits(round, placed, itemId, x, y, rot = 0, ignore = -1){
  const item = PACK_ITEMS[itemId];
  if(!item) return false;
  if(!Number.isInteger(x) || !Number.isInteger(y)) return false;

  const blocked = new Set();
  (placed || []).forEach((p, i) => {
    if(i === ignore) return;
    for(const [cx, cy] of itemCells(p.id, p.rot || 0)) blocked.add(`${p.x + cx},${p.y + cy}`);
  });

  for(const [cx, cy] of itemCells(itemId, rot)){
    const px = x + cx;
    const py = y + cy;
    // The cut corners are not walls the piece stops at — they are not bag.
    if(!gridHas(round, px, py)) return false;
    if(blocked.has(`${px},${py}`)) return false;
  }
  return true;
}

/* Put one down. Returns a new `placed` or null, never a half-applied one — the
   caller has to be able to treat a refusal as nothing having happened. */
export function packPlace(round, placed, itemId, x, y, rot = 0){
  if(!packFits(round, placed, itemId, x, y, rot)) return null;
  return [...(placed || []), { id: itemId, x, y, rot: ((rot % 4) + 4) % 4 }];
}

/* Move or turn one already in the bag, checked against a bag it is excluded
   from. Returns null when it will not go, and the caller leaves it where it
   was rather than dropping it on the floor. */
export function packMove(round, placed, index, x, y, rot = 0){
  const list = placed || [];
  const held = list[index];
  if(!held) return null;
  if(!packFits(round, list, held.id, x, y, rot, index)) return null;
  const next = list.map(p => ({ ...p }));
  next[index] = { id: held.id, x, y, rot: ((rot % 4) + 4) % 4 };
  return next;
}

/* Take one out. Returns the shorter list and the id that came off, so the
   caller can put it back among the loose items rather than lose it. */
export function packRemove(placed, index){
  const list = placed || [];
  if(index < 0 || index >= list.length) return { placed: list, id: null };
  return { placed: list.filter((_, i) => i !== index), id: list[index].id };
}

/* Anything in the bag that this round's bag no longer has room for.
 *
 * Nothing calls this while the pack only ever grows, and it is here anyway:
 * `gridFor` clamps, a restored room can come back holding a layout written
 * against a different schedule, and "silently keep a piece hanging off the
 * edge" is the failure that would be discovered in a fight.
 */
export function packSpill(round, placed){
  return (placed || []).filter(p =>
    itemCells(p.id, p.rot || 0).some(([cx, cy]) => !gridHas(round, p.x + cx, p.y + cy)));
}

/* ========================================================= what it buys ==== */

/* The card ids the bag is currently granting. Order is placement order, which
   is stable across a rearrange that did not touch a given piece — the option
   list should not reshuffle itself because something else moved. */
export const packedCards = placed =>
  (placed || []).map(p => packCard(p.id)).filter(Boolean);

/* Everything the ballast adds up to, summed rather than found, so a second
 * Ballast Plate is worth a second two.
 *
 *   heft   applied as the fight opens, and it never wears off — so this is a
 *          free Set Your Feet he did not pay health for
 *   ward   guard in the pool before the first blow lands
 *   regen  mending, ticking from the first round
 *   bolt   the Winch Crossbow only, and worth nothing without it
 */
export function packedStats(placed){
  const total = { heft: 0, ward: 0, regen: 0, bolt: 0 };
  for(const p of placed || []){
    const gives = (PACK_ITEMS[p.id] || {}).gives;
    if(!gives) continue;
    for(const [key, n] of Object.entries(gives)){
      if(total[key] !== undefined) total[key] += n;
    }
  }
  return total;
}

/* What one packed card hits for, once the ballast has had its say. Kept beside
   the stats rather than in the room, so the client's button and the room's
   resolution read the same number — the same reason cardEffect exists for the
   bolt gun and the workbench. */
export function packedAmount(cardId, baseAmount, placed){
  if(cardId !== 'crossbow') return baseAmount;
  return baseAmount + packedStats(placed).bolt;
}

/* ============================================================== the draw === */

/* What he is handed at the top of a build phase: three, unasked for.
 *
 * No draft and no offer of three to keep one — that is the Wizard's, and a
 * second bench that rolls options and takes one would be her build phase in
 * another colour. The decision here is not *which* but *where*, and it is only
 * a decision because the bag is smaller than what arrives.
 *
 * A kit already in the bag is refused, the way rollOffers refuses a spell
 * already in the book: a duplicate unique ability is a dead draw, and dead
 * draws in a hand of three are a round with two decisions in it. Ballast
 * repeats freely — two Ration Tins is four health a round, and the whole job
 * of a small piece is to be the thing that fills the hole.
 *
 * The caller supplies the generator, as everywhere else in this project.
 */
export function rollPackItems(random, placed, count = 3){
  const held = new Set((placed || []).map(p => p.id));
  const drawn = [];

  for(let n = 0; n < count; n++){
    const pool = Object.values(PACK_ITEMS).filter(item =>
      item.kind === 'ballast' || (!held.has(item.id) && !drawn.includes(item.id)));
    if(!pool.length) break;

    const total = pool.reduce((sum, item) => sum + (item.weight || 1), 0);
    let roll = random() * total;
    let picked = pool[pool.length - 1];
    for(const item of pool){
      roll -= item.weight || 1;
      if(roll < 0){ picked = item; break; }
    }
    drawn.push(picked.id);
  }
  return drawn;
}

/* What the bag opens a run holding.
 *
 * Get Behind Me, already in it. Every seat has a floor it cannot draw beneath
 * — CLASS_BASICS is that rule for the other four — and a Hauler whose first
 * three draws were all ballast would otherwise open the run with two basics
 * and nothing else at all. It is his signature card and the only one in the
 * game that decides who a blow lands on, so it is the right thing to be the
 * floor; it is a flat three-cell bar, so it sits in the round-one bag without
 * dominating it.
 */
export function freshPack(){
  return { placed: [{ id: 'behind', x: 1, y: 1, rot: 0 }], loose: [] };
}

/* Defaulted rather than assumed, for the reason `restore` defaults the
   spellbook: a room stored before this existed has no pack on its Hauler, and
   waking it must not throw. */
export function normalisePack(pack){
  if(!pack || typeof pack !== 'object') return freshPack();
  return {
    placed: Array.isArray(pack.placed) ? pack.placed.map(p => ({ ...p, rot: p.rot || 0 })) : [],
    loose: Array.isArray(pack.loose) ? [...pack.loose] : [],
  };
}
