/* The Hauler's pack.
 *
 * Its own file because the geometry is its own thing: content.test.js is
 * already 1700 lines and this asks a different sort of question — not "is the
 * table shaped right" but "does a piece go where it says it goes". The tables
 * are still pinned in content.test.js, because that is where the published
 * contract lives.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PACK_W, PACK_H, PACK_GRIDS, PACK_SHAPES, PACK_ITEMS, PACK_KINDS,
  gridFor, gridHas, gridCells,
  packAt, packFilled, packUsed, packFits, packPlace, packMove, packRemove, packSpill,
  packedCards, packedStats, packedAmount,
  rotateCells, shapeCells, itemCells, rotationsOf,
  rollPackItems, freshPack, normalisePack,
} from '../public/good-vibes/pack.js';

import { CARDS, CLASS_ACTIONS, CLASS_BASICS, classById, actionsFor } from '../public/good-vibes/content.js';

/* Deterministic and local, because the room's generator is the room's. Any
   sequence will do — what is being tested is that a roll obeys the rules, not
   that it produces particular items. */
function generator(seed = 1){
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/* ---- the shapes ------------------------------------------------------- */

test('every shape is a connected run of whole cells', () => {
  for (const [id, cells] of Object.entries(PACK_SHAPES)) {
    assert.ok(cells.length >= 1, `${id} is empty`);
    for (const cell of cells) {
      assert.equal(cell.length, 2, `${id} has a cell that is not a pair`);
      for (const n of cell) assert.ok(Number.isInteger(n), `${id} has a fractional cell`);
    }
    const keys = new Set(cells.map((c) => c.join(',')));
    assert.equal(keys.size, cells.length, `${id} covers a cell twice`);

    // Connected: a piece in two halves is two pieces, and the bag would let
    // you place one across a hole it should not reach over.
    const seen = new Set([cells[0].join(',')]);
    const queue = [cells[0]];
    while (queue.length) {
      const [x, y] = queue.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${x + dx},${y + dy}`;
        if (keys.has(key) && !seen.has(key)) { seen.add(key); queue.push([x + dx, y + dy]); }
      }
    }
    assert.equal(seen.size, cells.length, `${id} is not one connected piece`);
  }
});

test('rotation preserves the piece and returns it to itself in four', () => {
  for (const [id, cells] of Object.entries(PACK_SHAPES)) {
    const key = (list) => list.map((c) => c.join(',')).sort().join(' ');
    for (let r = 0; r < 4; r++) {
      assert.equal(shapeCells(id, r).length, cells.length, `${id} loses a cell at rot ${r}`);
      // Normalised against the axes, so nothing is ever placed at a negative.
      for (const [x, y] of shapeCells(id, r)) {
        assert.ok(x >= 0 && y >= 0, `${id} at rot ${r} has a cell behind its own origin`);
      }
    }
    assert.equal(key(shapeCells(id, 4)), key(shapeCells(id, 0)), `${id} does not come back round`);
    // Out-of-range turns are the same picture, because the client rotates by
    // incrementing forever rather than by counting to three.
    assert.equal(key(shapeCells(id, -1)), key(shapeCells(id, 3)), `${id} turns the wrong way backwards`);
    assert.equal(key(shapeCells(id, 7)), key(shapeCells(id, 3)), `${id} does not wrap`);
  }
});

test('a square has one silhouette and a domino has two', () => {
  assert.equal(rotationsOf('O'), 1, 'a square turned is a square');
  assert.equal(rotationsOf('D1'), 1);
  assert.equal(rotationsOf('D2'), 2);
  assert.equal(rotationsOf('I3'), 2);
  assert.equal(rotationsOf('T'), 4);
  // Nothing should offer four pictures when it only has one or two, or the
  // ghost cycles through frames that do not change.
  for (const id of Object.keys(PACK_SHAPES)) {
    assert.ok([1, 2, 4].includes(rotationsOf(id)), `${id} has ${rotationsOf(id)} rotations`);
  }
});

/* ---- the bag ---------------------------------------------------------- */

test('the bag grows every round and never shrinks', () => {
  const sizes = PACK_GRIDS.map((_, i) => gridCells(i + 1));
  assert.deepEqual(sizes, [13, 16, 18, 20], 'the schedule moved without the README moving');

  for (let i = 1; i < sizes.length; i++) {
    assert.ok(sizes[i] > sizes[i - 1], `round ${i + 1} is not bigger than round ${i}`);
  }

  // Growth has to be *additive*, not a reshuffle: a cell that was bag last
  // round and is not this round would drop a piece somebody planned around.
  for (let r = 2; r <= PACK_GRIDS.length; r++) {
    for (let y = 0; y < PACK_H; y++) {
      for (let x = 0; x < PACK_W; x++) {
        if (gridHas(r - 1, x, y)) assert.ok(gridHas(r, x, y), `round ${r} lost cell ${x},${y}`);
      }
    }
  }
});

test('every grid is the stated size and made of X and dot', () => {
  for (const grid of PACK_GRIDS) {
    assert.equal(grid.length, PACK_H);
    for (const row of grid) {
      assert.equal(row.length, PACK_W);
      assert.ok(/^[X.]+$/.test(row), `a grid row has something other than X and . in it: ${row}`);
    }
  }
  // The last round is the whole rectangle, which is what makes the shape read
  // as a bag filling out rather than as an arbitrary mask.
  assert.equal(gridCells(PACK_GRIDS.length), PACK_W * PACK_H);
});

test('gridFor clamps at both ends rather than returning undefined', () => {
  assert.deepEqual(gridFor(0), PACK_GRIDS[0], 'round 0 never happens, but it must not throw');
  assert.deepEqual(gridFor(1), PACK_GRIDS[0]);
  assert.deepEqual(gridFor(99), PACK_GRIDS[PACK_GRIDS.length - 1], 'a fifth round finds the biggest bag');
  assert.equal(gridHas(1, -1, 0), false);
  assert.equal(gridHas(1, PACK_W, 0), false);
  assert.equal(gridHas(1, 0, PACK_H), false);
});

/* ---- the items -------------------------------------------------------- */

test('every item is shaped, weighted and one of the two kinds', () => {
  for (const [id, item] of Object.entries(PACK_ITEMS)) {
    assert.equal(item.id, id, `${id} disagrees with its own key`);
    assert.equal(typeof item.name, 'string');
    assert.equal(typeof item.note, 'string');
    assert.ok(PACK_KINDS.includes(item.kind), `${id} is a "${item.kind}"`);
    assert.ok(PACK_SHAPES[item.shape], `${id} has no shape "${item.shape}"`);
    assert.ok(item.weight > 0, `${id} can never be drawn`);
    // Derived rather than authored, so it cannot drift from the shape.
    assert.equal(item.cells, PACK_SHAPES[item.shape].length, `${id} miscounts its own cells`);
  }
});

test('a kit grants a real card and ballast grants real numbers', () => {
  for (const item of Object.values(PACK_ITEMS)) {
    if (item.kind === 'kit') {
      assert.ok(CARDS[item.card], `${item.id} grants "${item.card}", which is not a card`);
      assert.equal(CARDS[item.card].classId, 'hauler', `${item.card} is not the Hauler's`);
      assert.equal(item.gives, undefined, 'a kit is a card, not a stat line');
    } else {
      assert.ok(item.gives && Object.keys(item.gives).length, `${item.id} gives nothing`);
      assert.equal(item.card, undefined, 'ballast never asks for a turn');
      for (const [key, n] of Object.entries(item.gives)) {
        assert.ok(['heft', 'ward', 'regen', 'bolt'].includes(key), `${item.id} gives "${key}"`);
        assert.ok(n > 0, `${item.id} gives ${n} ${key}`);
      }
    }
  }
});

test('the pack is the only thing between the Hauler and two basics', () => {
  // The whole point of the rewrite: his identity is a verb now, and the verb
  // is packing. If anything creeps back into CLASS_ACTIONS the bag stops being
  // load-bearing and becomes a panel beside the real list.
  assert.deepEqual(CLASS_ACTIONS.hauler, [], 'the Hauler owns nothing by class any more');
  assert.deepEqual(actionsFor('hauler'), CLASS_BASICS.hauler, 'he opens with his two basics and no more');
  assert.equal(classById('hauler').haul, true, 'and he needs the flag to get a bench');

  // Every card he could ever hold is a card some item grants.
  const granted = new Set(Object.values(PACK_ITEMS).filter((i) => i.card).map((i) => i.card));
  for (const [id, card] of Object.entries(CARDS)) {
    if (card.classId !== 'hauler' || card.basic) continue;
    assert.ok(granted.has(id), `${id} belongs to the Hauler and nothing in the bag grants it`);
  }
});

test('bigger kits are rarer, so five cells is a thing that happens to a run', () => {
  const kits = Object.values(PACK_ITEMS).filter((i) => i.kind === 'kit');
  const bySize = new Map();
  for (const kit of kits) {
    if (!bySize.has(kit.cells)) bySize.set(kit.cells, []);
    bySize.get(kit.cells).push(kit.weight);
  }
  const sizes = [...bySize.keys()].sort((a, b) => a - b);
  for (let i = 1; i < sizes.length; i++) {
    const lighter = Math.max(...bySize.get(sizes[i - 1]));
    const heavier = Math.max(...bySize.get(sizes[i]));
    assert.ok(heavier <= lighter,
      `${sizes[i]}-cell kits are not rarer than ${sizes[i - 1]}-cell ones`);
  }
});

/* ---- the packing ------------------------------------------------------ */

test('the opening bag is legal in the opening bag', () => {
  const pack = freshPack();
  assert.equal(pack.loose.length, 0, 'a run does not open holding loose items');
  assert.deepEqual(packSpill(1, pack.placed), [], 'the floor does not fit in round one');
  assert.deepEqual(packedCards(pack.placed), ['behind'], 'his signature card is the floor');
});

test('a piece has to be inside the bag, not merely inside the rectangle', () => {
  // The cut corners are the whole shape of this. In round one the top row is
  // not bag at all, and the shoulders are three wide.
  assert.equal(packFits(1, [], 'crossbow', 1, 0), false, 'the top row is not bag in round one');
  assert.equal(packFits(2, [], 'crossbow', 1, 0), true, 'and it nests into the shoulders in round two');
  assert.equal(packFits(2, [], 'crossbow', 0, 0), false, 'a corner is not bag');

  // The long bar only lies on the full rows until the bag squares off.
  assert.equal(packFits(1, [], 'stretcher', 0, 2), true);
  assert.equal(packFits(1, [], 'stretcher', 1, 1), false, 'a 4-bar does not fit a 3-wide shoulder');
  assert.equal(packFits(4, [], 'stretcher', 0, 0), true, 'the last bag takes it anywhere');

  // Off the board entirely.
  assert.equal(packFits(4, [], 'plate', 4, 0), false, 'a domino may not hang off the right edge');
  assert.equal(packFits(4, [], 'tin', -1, 0), false);
  assert.equal(packFits(4, [], 'tin', 0.5, 0), false, 'cells are whole or they are nothing');
  assert.equal(packFits(4, [], 'nosuchthing', 0, 0), false);
});

test('two things cannot share a cell', () => {
  const placed = packPlace(2, [], 'crossbow', 1, 0, 0);
  assert.ok(placed, 'the crossbow nests in the shoulders');
  assert.equal(packFits(2, placed, 'tin', 2, 0), false, 'that cell is taken');
  assert.equal(packFits(2, placed, 'tin', 1, 1), true, 'and this one is not');
  assert.equal(packPlace(2, placed, 'tin', 2, 0), null, 'a refusal returns nothing, never a half-bag');
  assert.equal(packUsed(placed), 4);
});

test('a piece is checked against a bag it is not blocking itself in', () => {
  // The bug this exists for: dragging something one cell left fails because
  // the check finds the piece still sitting where it used to be.
  const placed = packPlace(4, [], 'sledge', 0, 0, 0);
  const moved = packMove(4, placed, 0, 1, 0, 0);
  assert.ok(moved, 'a piece must be able to shuffle across by one');
  assert.equal(moved.length, 1, 'and it is still one piece');
  assert.equal(moved[0].x, 1);

  // Turning on the spot is the same problem.
  const turned = packMove(4, placed, 0, 0, 0, 1);
  assert.ok(turned, 'a piece must be able to turn where it stands');
  assert.equal(turned[0].rot, 1);

  assert.equal(packMove(4, placed, 9, 0, 0, 0), null, 'no such piece');
  assert.equal(packMove(1, placed, 0, 3, 0, 0), null, 'and it still may not go outside the bag');
});

test('taking a piece out returns it rather than destroying it', () => {
  const placed = packPlace(2, [], 'crossbow', 1, 0, 0);
  const { placed: after, id } = packRemove(placed, 0);
  assert.equal(id, 'crossbow', 'the caller has to be able to put it back among the loose');
  assert.equal(after.length, 0);

  const miss = packRemove(placed, 5);
  assert.equal(miss.id, null);
  assert.equal(miss.placed.length, 1, 'a miss changes nothing');
});

test('packAt finds the piece under a cell, wherever in the piece that cell is', () => {
  const placed = packPlace(4, [], 'crossbow', 0, 0, 0);
  assert.equal(packAt(placed, 0, 0), 0, 'the origin');
  assert.equal(packAt(placed, 1, 1), 0, "the T's stem, which is not its origin");
  assert.equal(packAt(placed, 0, 1), -1, 'and the notch beside it is empty');
  assert.equal(packFilled(placed).length, 4);
});

test('a bag too small for what is in it spills rather than keeping it', () => {
  // Nothing calls this while the bag only grows. It exists because gridFor
  // clamps and a stored room can wake against a different schedule, and the
  // failure it prevents is a piece hanging off the edge, found in a fight.
  const wide = packPlace(4, [], 'stretcher', 0, 0, 0);
  assert.deepEqual(packSpill(4, wide), [], 'legal where it was put');
  assert.equal(packSpill(1, wide).length, 1, 'and illegal in the round-one bag');
});

/* ---- what it buys ----------------------------------------------------- */

test('the bag decides the option list, and only kits are options', () => {
  const placed = [
    { id: 'crossbow', x: 0, y: 0, rot: 0 },
    { id: 'plate', x: 3, y: 0, rot: 0 },
    { id: 'sledge', x: 0, y: 1, rot: 0 },
  ];
  assert.deepEqual(packedCards(placed), ['crossbow', 'sledge'], 'ballast never asks for a turn');
  assert.deepEqual(packedCards([]), [], 'an empty bag grants nothing at all');
  assert.deepEqual(packedCards(null), []);
});

test('ballast sums rather than replaces', () => {
  const two = [{ id: 'plate', x: 0, y: 0, rot: 0 }, { id: 'plate', x: 2, y: 0, rot: 0 }];
  assert.equal(packedStats(two).heft, 4, 'a second Ballast Plate is worth a second two');
  assert.equal(packedStats([]).heft, 0);
  assert.deepEqual(packedStats(null), { heft: 0, ward: 0, regen: 0, bolt: 0 });

  const mixed = [
    { id: 'plate', x: 0, y: 0, rot: 0 },
    { id: 'bracing', x: 2, y: 0, rot: 0 },
    { id: 'tin', x: 4, y: 0, rot: 0 },
    { id: 'boltcase', x: 0, y: 1, rot: 0 },
  ];
  assert.deepEqual(packedStats(mixed), { heft: 2, ward: 3, regen: 2, bolt: 2 });
});

test('a Bolt Case is worth nothing at all without the crossbow, and two of them stack', () => {
  const base = CARDS.crossbow.effect.amount;
  const cases = [{ id: 'boltcase', x: 0, y: 0, rot: 0 }, { id: 'boltcase', x: 1, y: 0, rot: 0 }];

  assert.equal(packedAmount('crossbow', base, []), base, 'no case, no bonus');
  assert.equal(packedAmount('crossbow', base, cases), base + 4, 'two cases, twice the bonus');
  // The case is keyed to one card and must not leak onto the rest of the bag.
  assert.equal(packedAmount('sledge', 11, cases), 11, 'the sledge does not fire quarrels');
  assert.equal(packedAmount('shoulder', 4, cases), 4);
});

/* ---- the draw --------------------------------------------------------- */

test('three arrive every build phase, unasked for', () => {
  const drawn = rollPackItems(generator(7), [], 3);
  assert.equal(drawn.length, 3);
  for (const id of drawn) assert.ok(PACK_ITEMS[id], `rolled "${id}", which is not an item`);
});

test('a kit already in the bag is never rolled again', () => {
  // A duplicate unique ability is a dead draw, and a dead draw in a hand of
  // three is a round with two decisions in it. rollOffers refuses a spell
  // already in the book for exactly this reason.
  const everyKit = Object.values(PACK_ITEMS)
    .filter((i) => i.kind === 'kit')
    .map((i, n) => ({ id: i.id, x: n, y: 0, rot: 0 }));

  for (let seed = 1; seed < 40; seed++) {
    const drawn = rollPackItems(generator(seed), everyKit, 3);
    assert.equal(drawn.length, 3, 'a full shelf of kits still draws three');
    for (const id of drawn) {
      assert.equal(PACK_ITEMS[id].kind, 'ballast', 'every kit is held, so only ballast is left');
    }
  }
});

test('a draw never offers the same kit twice, and ballast repeats freely', () => {
  let sawRepeatBallast = false;
  for (let seed = 1; seed < 80; seed++) {
    const drawn = rollPackItems(generator(seed), [], 3);
    const kits = drawn.filter((id) => PACK_ITEMS[id].kind === 'kit');
    assert.equal(new Set(kits).size, kits.length, `seed ${seed} offered the same kit twice`);
    const ballast = drawn.filter((id) => PACK_ITEMS[id].kind === 'ballast');
    if (new Set(ballast).size !== ballast.length) sawRepeatBallast = true;
  }
  assert.ok(sawRepeatBallast, 'two Ration Tins must be a thing that can happen');
});

test('the same generator draws the same three, because a room code is a run', () => {
  assert.deepEqual(rollPackItems(generator(3), [], 3), rollPackItems(generator(3), [], 3));
});

test('a bag stored before any of this existed wakes up rather than throwing', () => {
  assert.deepEqual(normalisePack(undefined), freshPack());
  assert.deepEqual(normalisePack(null), freshPack());
  assert.deepEqual(normalisePack({}), { placed: [], loose: [] });
  assert.deepEqual(normalisePack({ placed: 'nonsense', loose: 4 }), { placed: [], loose: [] });
  // A stored piece from before rotation existed is a piece at rot 0.
  assert.deepEqual(
    normalisePack({ placed: [{ id: 'tin', x: 1, y: 1 }], loose: [] }).placed,
    [{ id: 'tin', x: 1, y: 1, rot: 0 }],
  );
});

/* ---- the budget ------------------------------------------------------- */

test('round one fits its draw and round four cannot', () => {
  // The curve the whole design rests on: setup with room to spare, then a
  // ratchet where every draw is a swap rather than an addition. If this ever
  // reads "everything fits", the minigame has stopped existing.
  const kits = Object.values(PACK_ITEMS).filter((i) => i.kind === 'kit');
  const avg = kits.reduce((sum, i) => sum + i.cells, 0) / kits.length;

  assert.ok(gridCells(1) >= avg * 3,
    'round one should hold three average kits, or he opens the run already cutting');
  assert.ok(gridCells(4) < avg * 12,
    'twelve draws must not fit the final bag, or nothing was ever a decision');
});
