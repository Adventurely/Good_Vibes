/* Sunward's board, rule by rule.
 *
 * The module is pure — the clock is an argument and the store is an argument —
 * so every case here is a call and a comparison, and the whole of what the
 * route does can be checked without a socket, a server or a Cloudflare
 * account. What matters most is the things a client can send that the board
 * must not believe: a name that is not a name, a figure past what the game can
 * produce, a second post inside the window, a five-thousand-and-first row.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BOARD_KEYS, LIMITS, INTEGER_KEYS, LABELS,
  NAME_MIN, NAME_MAX, cleanName, ID_RE,
  MIN_INTERVAL, MAX_PLAYERS, TOP, MAX_TOP, MAX_BODY, TOO_LARGE, BAD_JSON,
  validate, merge, rank, boards, serve,
} from '../src/sunward-board.js';

/* A UUID-shaped id from a small number, so a test can name five thousand of
   them and still read which one it is talking about. */
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const entry = (n, stats = {}, name = `Player ${n}`) => ({
  id: id(n), name,
  stats: { taps: 0, winters: 0, earned: 0, peakTaps: 0, ...stats },
});

/* ---------------------------------------------------------------- constants */

test('the four boards and their caps are the ones the client was written against', () => {
  assert.deepEqual(BOARD_KEYS, ['taps', 'winters', 'earned', 'peakTaps']);
  assert.deepEqual(LIMITS, {
    taps: Number.MAX_SAFE_INTEGER, winters: Number.MAX_SAFE_INTEGER,
    earned: Number.MAX_VALUE, peakTaps: Number.MAX_VALUE,
  });
  assert.deepEqual(INTEGER_KEYS, ['taps', 'winters']);
  for(const key of BOARD_KEYS) assert.equal(typeof LABELS[key], 'string', `no label for ${key}`);
  assert.equal(NAME_MIN, 2);
  assert.equal(NAME_MAX, 16);
  assert.equal(MIN_INTERVAL, 15000);
  assert.equal(MAX_PLAYERS, 5000);
  assert.equal(TOP, 10);
  assert.equal(MAX_TOP, 100);
  assert.equal(MAX_BODY, 4096);
  assert.equal(TOO_LARGE.status, 413);
  assert.equal(typeof TOO_LARGE.body.error, 'string');
  assert.equal(BAD_JSON.status, 400);
  assert.equal(typeof BAD_JSON.body.error, 'string');
});

test('ID_RE takes a UUID in either case and nothing that is not one', () => {
  assert.match('3f2a9c1e-7b4d-4e8a-9f0c-1a2b3c4d5e6f', ID_RE);
  assert.match('3F2A9C1E-7B4D-4E8A-9F0C-1A2B3C4D5E6F', ID_RE);
  assert.match(crypto.randomUUID(), ID_RE);
  for(const bad of ['', 'abc', '3f2a9c1e7b4d4e8a9f0c1a2b3c4d5e6f', '3f2a9c1e-7b4d-4e8a-9f0c-1a2b3c4d5e6', 'zf2a9c1e-7b4d-4e8a-9f0c-1a2b3c4d5e6f', ' 3f2a9c1e-7b4d-4e8a-9f0c-1a2b3c4d5e6f']){
    assert.doesNotMatch(bad, ID_RE, `"${bad}" should not be an id`);
  }
});

/* ---------------------------------------------------------------- cleanName */

test('cleanName trims and collapses whitespace', () => {
  assert.equal(cleanName('  Finn  '), 'Finn');
  assert.equal(cleanName('Finn   the\t\tHand'), 'Finn the Hand');
  assert.equal(cleanName('\nBrikka\n'), 'Brikka');
});

test('cleanName lets letters and digits in any script through', () => {
  assert.equal(cleanName('Celia'), 'Celia');
  assert.equal(cleanName('Zoë'), 'Zoë');
  assert.equal(cleanName('Ángel 42'), 'Ángel 42');
  assert.equal(cleanName('Ægir'), 'Ægir');
  assert.equal(cleanName('日向'), '日向');
  assert.equal(cleanName('Ярослав'), 'Ярослав');
  assert.equal(cleanName('नमस्ते'), 'नमस्ते');          // combining vowel signs are letters here
  assert.equal(cleanName("O'Brien"), "O'Brien");
  assert.equal(cleanName('O’Brien'), "O'Brien");     // a phone's curly apostrophe, mapped back
  assert.equal(cleanName('mr_wicket.v2-b'), 'mr_wicket.v2-b');
});

test('cleanName strips control characters and the invisible ones', () => {
  // Built from code points rather than typed, so the source of this file
  // holds no raw control bytes and every editor shows the same thing.
  const cp = (...codes) => String.fromCodePoint(...codes);
  const bell = cp(0x07), nul = cp(0x00), esc = cp(0x1b);
  const zwsp = cp(0x200b), rlo = cp(0x202e), zwj = cp(0x200d), bom = cp(0xfeff);
  assert.equal(cleanName(`Fi${bell}nn`), 'Finn');
  assert.equal(cleanName(`Fi${nul}nn`), 'Finn');
  assert.equal(cleanName(`${esc}Finn`), 'Finn');
  assert.equal(cleanName(`Fi${zwsp}nn`), 'Finn', 'zero-width space');
  assert.equal(cleanName(`${rlo}Finn`), 'Finn', 'bidi override');
  assert.equal(cleanName(`Finn${zwj}`), 'Finn', 'zero-width joiner');
  assert.equal(cleanName(`${bom}Finn`), 'Finn', 'byte-order mark');
  // Stripping happens before the length check: two letters and six zero-widths
  // is two letters, and two letters is a name.
  assert.equal(cleanName(`A${zwsp.repeat(6)}B`), 'AB');
  // And a name that is only invisibles is nothing at all.
  assert.equal(cleanName(zwsp.repeat(3)), null);
});

test('cleanName refuses what does not fit', () => {
  assert.equal(cleanName('F'), null, 'too short');
  assert.equal(cleanName(' F '), null, 'too short once trimmed');
  assert.equal(cleanName(''), null);
  assert.equal(cleanName('   '), null);
  assert.equal(cleanName('A'.repeat(NAME_MAX + 1)), null, 'too long');
  assert.equal(cleanName('A'.repeat(NAME_MAX)), 'A'.repeat(NAME_MAX), 'exactly the max fits');
  assert.equal(cleanName('AB'), 'AB', 'exactly the min fits');
  for(const symbolic of ['Finn!', 'Finn <3', 'Finn 🌱', 'Finn & Brikka', 'a@b', 'Finn/Wicket', 'Finn\\n', '"Finn"', 'Finn,']){
    assert.equal(cleanName(symbolic), null, `"${symbolic}" should be refused, not edited`);
  }
  assert.equal(cleanName('---'), null, 'punctuation alone is not a name');
  assert.equal(cleanName("''"), null);
  for(const notText of [null, undefined, 42, {}, [], true]){
    assert.equal(cleanName(notText), null);
  }
});

test('cleanName counts characters, not UTF-16 units', () => {
  // Sixteen letters from outside the first plane are thirty-two units long.
  const wide = '𐐀'.repeat(NAME_MAX);
  assert.equal(wide.length, NAME_MAX * 2);
  assert.equal(cleanName(wide), wide);
  assert.equal(cleanName('𐐀'.repeat(NAME_MAX + 1)), null);
});

/* ----------------------------------------------------------------- validate */

test('validate accepts a good body and hands back a clean entry', () => {
  const v = validate({ id: id(1).toUpperCase(), name: '  Finn  ', stats: { taps: 120, winters: 2, earned: 1.5e30, peakTaps: 8.25 } });
  assert.equal(v.ok, true);
  assert.deepEqual(v.entry, { id: id(1), name: 'Finn', stats: { taps: 120, winters: 2, earned: 1.5e30, peakTaps: 8.25 } });
});

test('validate refuses a body that is not a score', () => {
  for(const bad of [null, undefined, 'hello', 42, [], true]){
    const v = validate(bad);
    assert.equal(v.ok, false);
    assert.equal(typeof v.error, 'string');
  }
});

test('validate refuses a bad id', () => {
  for(const bad of [undefined, null, '', 'finn', 12345, id(1) + 'x', {}]){
    const v = validate({ id: bad, name: 'Finn', stats: {} });
    assert.equal(v.ok, false, `id ${JSON.stringify(bad)} accepted`);
    assert.match(v.error, /id/);
  }
});

test('validate refuses a missing or unfit name, in words about names', () => {
  for(const bad of [undefined, null, '', 'F', 'Finn!', 'A'.repeat(NAME_MAX + 1), 7]){
    const v = validate({ id: id(1), name: bad, stats: {} });
    assert.equal(v.ok, false, `name ${JSON.stringify(bad)} accepted`);
    assert.match(v.error, /Names are 2 to 16 characters/);
  }
});

test('the ceiling on a figure is the machine\'s, not a guess at the game', () => {
  /* The caps were once a guess at what the game could produce — thirty taps a
     second — and the first person to play the finished game was refused by
     that guess on the first evening. What is left is only where JavaScript
     itself gives out: counts stop being exact past 2^53, and a measure stops
     at the largest float there is. */
  const tryStats = stats => validate({ id: id(1), name: 'Finn', stats });

  assert.equal(tryStats({ peakTaps: 33.4 }).ok, true, 'eight fingers on a tablet is a real score');
  assert.equal(tryStats({ peakTaps: 250 }).ok, true);
  assert.equal(tryStats({ taps: 5e7 + 1 }).ok, true, 'the old fifty-million cap must be gone');

  for(const key of ['taps', 'winters']){
    assert.equal(LIMITS[key], Number.MAX_SAFE_INTEGER, `${key} is a count, so it stops where counting does`);
    // Number.isInteger says yes to 1e16, and 1e16 + 1 is 1e16, so a record
    // that "only goes up" would stop being able to.
    const over = tryStats({ [key]: 1e16 });
    assert.equal(over.ok, false, `${key} past exact counting accepted`);
    assert.match(over.error, /above the highest figure this board takes/);
  }
  for(const key of ['earned', 'peakTaps']){
    assert.equal(LIMITS[key], Number.MAX_VALUE, `${key} is a measure, so it stops where floats do`);
    assert.equal(tryStats({ [key]: 1e300 }).ok, true, `${key}: anything finite is taken`);
    // Past MAX_VALUE there is no number left to refuse — only Infinity, which
    // is refused for not being finite rather than for being too big.
    assert.match(tryStats({ [key]: Infinity }).error, /must be a number, zero or more/);
  }
});

test('validate refuses figures that are broken rather than big', () => {
  const tryStats = stats => validate({ id: id(1), name: 'Finn', stats });
  for(const key of BOARD_KEYS){
    for(const bad of [-1, Infinity, -Infinity, NaN, 'lots', true, {}, []]){
      const v = tryStats({ [key]: bad });
      assert.equal(v.ok, false, `${key}=${String(bad)} accepted`);
      assert.match(v.error, new RegExp(LABELS[key]), `${key}: the reason should name the figure`);
    }
    const at = tryStats({ [key]: LIMITS[key] });
    assert.equal(at.ok, true, `${key} at exactly its ceiling refused`);
  }
});

test('validate wants whole numbers for taps and winters and not for the rest', () => {
  const tryStats = stats => validate({ id: id(1), name: 'Finn', stats });
  for(const key of INTEGER_KEYS){
    const v = tryStats({ [key]: 1.5 });
    assert.equal(v.ok, false, `${key}=1.5 accepted`);
    assert.match(v.error, /whole number/);
    assert.equal(tryStats({ [key]: 3 }).ok, true);
  }
  assert.equal(tryStats({ earned: 1.5 }).ok, true);
  assert.equal(tryStats({ earned: 1e30 }).ok, true, 'the economy really does get here');
  assert.equal(tryStats({ peakTaps: 7.75 }).ok, true);
});

test('validate fills missing stats with zero and drops keys it does not know', () => {
  const zeros = { taps: 0, winters: 0, earned: 0, peakTaps: 0 };
  assert.deepEqual(validate({ id: id(1), name: 'Finn' }).entry.stats, zeros);
  assert.deepEqual(validate({ id: id(1), name: 'Finn', stats: {} }).entry.stats, zeros);
  assert.deepEqual(validate({ id: id(1), name: 'Finn', stats: null }).entry.stats, zeros);
  assert.deepEqual(validate({ id: id(1), name: 'Finn', stats: { taps: 5 } }).entry.stats, { ...zeros, taps: 5 });
  assert.deepEqual(validate({ id: id(1), name: 'Finn', stats: { taps: 5, spent: 99, seconds: 1e9 } }).entry.stats, { ...zeros, taps: 5 });
  assert.equal(validate({ id: id(1), name: 'Finn', stats: 'lots' }).ok, false);
  assert.equal(validate({ id: id(1), name: 'Finn', stats: [1, 2, 3] }).ok, false);
  // A numeric string is odd but not wrong.
  assert.deepEqual(validate({ id: id(1), name: 'Finn', stats: { taps: '12' } }).entry.stats, { ...zeros, taps: 12 });
});

/* -------------------------------------------------------------------- merge */

test('merge writes a new row and stamps it', () => {
  const players = {};
  const r = merge(players, entry(1, { taps: 10 }), 1000);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(players[id(1)], {
    name: 'Player 1', stats: { taps: 10, winters: 0, earned: 0, peakTaps: 0 }, at: 1000, since: 1000,
  });
});

test('merge never lets a figure go down, and lets the name change', () => {
  const players = {};
  merge(players, entry(1, { taps: 100, winters: 3, earned: 5e6, peakTaps: 9 }, 'Finn'), 0);
  const r = merge(players, entry(1, { taps: 50, winters: 4, earned: 1e6, peakTaps: 12 }, 'Finn the Hand'), MIN_INTERVAL);
  assert.equal(r.ok, true);
  const row = players[id(1)];
  assert.deepEqual(row.stats, { taps: 100, winters: 4, earned: 5e6, peakTaps: 12 }, 'max per key, not per row');
  assert.equal(row.name, 'Finn the Hand');
  assert.equal(row.at, MIN_INTERVAL);
  assert.equal(row.since, 0, 'since is when they first appeared, not when they last posted');
});

test('merge refuses a second post inside the window and says how long to wait', () => {
  const players = {};
  merge(players, entry(1, { taps: 10 }), 1000);
  const r = merge(players, entry(1, { taps: 999 }, 'Sneaky'), 1000 + 4000);
  assert.deepEqual(r, { ok: false, error: 'Too soon.', retryIn: MIN_INTERVAL - 4000 });
  assert.equal(players[id(1)].stats.taps, 10, 'a refused post changes nothing');
  assert.equal(players[id(1)].name, 'Player 1');
  assert.equal(players[id(1)].at, 1000);

  assert.equal(merge(players, entry(1, { taps: 11 }), 1000 + MIN_INTERVAL - 1).ok, false, 'one ms short is still too soon');
  assert.equal(merge(players, entry(1, { taps: 11 }), 1000 + MIN_INTERVAL).ok, true, 'exactly the window is fine');
  // A different id is a different player and has no window to wait on.
  assert.equal(merge(players, entry(2, { taps: 1 }), 1000 + MIN_INTERVAL + 1).ok, true);
});

test('merge does not lock a player out when the clock has gone backwards', () => {
  const players = {};
  merge(players, entry(1, { taps: 10 }), 1e6);
  // The object was restored, or the laptop slept: now is before the last post.
  assert.equal(merge(players, entry(1, { taps: 11 }), 1e6 - 60000).ok, true);
});

test('merge prunes the forgotten first and keeps every board intact', () => {
  const players = {};
  // Fill it exactly: the oldest row is also the best tapper, so it is on a board.
  for(let n = 1; n <= MAX_PLAYERS; n++){
    players[id(n)] = {
      name: `P${n}`, at: n * 1000, since: n * 1000,
      stats: { taps: n === 1 ? 1e6 : 1, winters: 0, earned: 0, peakTaps: 0 },
    };
  }
  // Rows 2..101 are the top hundred on winters, so they are safe too, however old.
  for(let n = 2; n <= 101; n++) players[id(n)].stats.winters = 200 - n;

  const r = merge(players, entry(MAX_PLAYERS + 1, { earned: 5 }), (MAX_PLAYERS + 1) * 1000);
  assert.equal(r.ok, true);
  assert.equal(Object.keys(players).length, MAX_PLAYERS, 'pruned back to the cap');
  assert.ok(players[id(1)], 'the oldest row is in the top hundred of taps and stays');
  for(let n = 2; n <= 101; n++) assert.ok(players[id(n)], `row ${n} is in the top hundred of winters and stays`);
  assert.ok(players[id(MAX_PLAYERS + 1)], 'the row just merged stays');
  assert.equal(players[id(102)], undefined, 'the oldest row on no board goes');
  assert.ok(players[id(103)], 'and only that one');
});

test('merge never drops the row it just wrote, even when it is the oldest and on no board', () => {
  const players = {};
  // Nobody here is on any board, so nothing protects anyone but recency.
  for(let n = 1; n <= MAX_PLAYERS; n++){
    players[id(n)] = { name: `P${n}`, at: 1e9 + n, since: 1e9 + n, stats: { taps: 0, winters: 0, earned: 0, peakTaps: 0 } };
  }
  // A brand-new row with nothing on it, stamped with a time before everyone else.
  const r = merge(players, entry(MAX_PLAYERS + 1), 5);
  assert.equal(r.ok, true);
  assert.equal(Object.keys(players).length, MAX_PLAYERS);
  assert.ok(players[id(MAX_PLAYERS + 1)], 'the row just merged stays');
  assert.equal(players[id(1)], undefined, 'the oldest of the others goes instead');
});

test('merge does not prune under the cap', () => {
  const players = {};
  for(let n = 1; n < MAX_PLAYERS; n++){
    players[id(n)] = { name: `P${n}`, at: n, since: n, stats: { taps: 0, winters: 0, earned: 0, peakTaps: 0 } };
  }
  merge(players, entry(MAX_PLAYERS), 1e9);
  assert.equal(Object.keys(players).length, MAX_PLAYERS, 'exactly the cap is not over it');
});

/* --------------------------------------------------------------------- rank */

test('rank leaves zeros off, sorts longest first, and breaks ties by since then id', () => {
  const players = {
    [id(3)]: { name: 'C', at: 0, since: 300, stats: { taps: 50, winters: 0, earned: 0, peakTaps: 0 } },
    [id(1)]: { name: 'A', at: 0, since: 100, stats: { taps: 50, winters: 0, earned: 0, peakTaps: 0 } },
    [id(2)]: { name: 'B', at: 0, since: 100, stats: { taps: 50, winters: 0, earned: 0, peakTaps: 0 } },
    [id(4)]: { name: 'D', at: 0, since: 0,   stats: { taps: 0,  winters: 9, earned: 0, peakTaps: 0 } },
    [id(5)]: { name: 'E', at: 0, since: 0,   stats: { taps: 70, winters: 0, earned: 0, peakTaps: 0 } },
  };
  assert.deepEqual(rank(players, 'taps'), [
    { id: id(5), name: 'E', value: 70 },
    { id: id(1), name: 'A', value: 50 },   // same figure as B and C; here first
    { id: id(2), name: 'B', value: 50 },   // same since as A; lower id
    { id: id(3), name: 'C', value: 50 },
  ]);
  assert.deepEqual(rank(players, 'winters'), [{ id: id(4), name: 'D', value: 9 }]);
  assert.deepEqual(rank(players, 'earned'), []);
  assert.deepEqual(rank(players, 'taps', 2).map(r => r.name), ['E', 'A'], 'limit cuts the tail');
  assert.equal(rank(players, 'taps').length, 4, 'the default limit is TOP, and there are fewer than that');
});

test('rank copes with a row missing the key', () => {
  const players = { [id(1)]: { name: 'A', at: 0, since: 0, stats: { taps: 3 } } };
  assert.deepEqual(rank(players, 'winters'), []);
  assert.deepEqual(rank(players, 'taps'), [{ id: id(1), name: 'A', value: 3 }]);
});

/* ------------------------------------------------------------------- boards */

test('boards carries no ids and ranks you over everyone, not just the top', () => {
  const players = {};
  for(let n = 1; n <= 15; n++){
    players[id(n)] = { name: `P${n}`, at: n, since: n, stats: { taps: 100 - n, winters: n === 15 ? 0 : 1, earned: 0, peakTaps: 0 } };
  }
  const out = boards(players, { you: id(13) });
  assert.equal(out.players, 15);
  assert.equal(out.boards.taps.length, TOP);
  assert.deepEqual(out.boards.taps[0], { name: 'P1', value: 99 });
  assert.deepEqual(out.boards.earned, []);
  assert.deepEqual(out.you, { taps: 13, winters: 13, earned: null, peakTaps: null });
  assert.doesNotMatch(JSON.stringify(out), /0000-4000-8000/, 'an id leaked into the public shape');
  assert.deepEqual(Object.keys(out).sort(), ['boards', 'players', 'you']);
  assert.deepEqual(Object.keys(out.boards), BOARD_KEYS);
});

test('boards with nobody asking gives every rank as null', () => {
  const players = { [id(1)]: { name: 'A', at: 0, since: 0, stats: { taps: 3, winters: 0, earned: 0, peakTaps: 0 } } };
  assert.deepEqual(boards(players).you, { taps: null, winters: null, earned: null, peakTaps: null });
  assert.deepEqual(boards(players, { you: id(2) }).you, { taps: null, winters: null, earned: null, peakTaps: null });
  assert.deepEqual(boards({}), { boards: { taps: [], winters: [], earned: [], peakTaps: [] }, players: 0, you: { taps: null, winters: null, earned: null, peakTaps: null } });
});

test('boards honours a limit', () => {
  const players = {};
  for(let n = 1; n <= 120; n++){
    players[id(n)] = { name: `P${n}`, at: n, since: n, stats: { taps: n, winters: 0, earned: 0, peakTaps: 0 } };
  }
  assert.equal(boards(players).boards.taps.length, TOP);
  assert.equal(boards(players, { limit: 3 }).boards.taps.length, 3);
  assert.equal(boards(players, { limit: MAX_TOP }).boards.taps.length, MAX_TOP);
});

/* -------------------------------------------------------------------- serve */

test('serve GET on an empty board', () => {
  const store = { players: {} };
  const r = serve(store, 'GET', null, {}, 12345);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    boards: { taps: [], winters: [], earned: [], peakTaps: [] },
    players: 0,
    you: { taps: null, winters: null, earned: null, peakTaps: null },
    updated: 12345,
  });
});

test('serve POST then GET shows the row, and tells the poster where they stand', () => {
  const store = { players: {} };
  const posted = serve(store, 'POST', { id: id(1), name: 'Finn', stats: { taps: 40, peakTaps: 6.5 } }, {}, 1000);
  assert.equal(posted.status, 200);
  assert.deepEqual(posted.body.boards.taps, [{ name: 'Finn', value: 40 }]);
  assert.deepEqual(posted.body.boards.peakTaps, [{ name: 'Finn', value: 6.5 }]);
  assert.deepEqual(posted.body.boards.winters, []);
  assert.deepEqual(posted.body.you, { taps: 1, winters: null, earned: null, peakTaps: 1 });
  assert.equal(posted.body.players, 1);
  assert.equal(posted.body.updated, 1000);

  const got = serve(store, 'GET', null, {}, 2000);
  assert.deepEqual(got.body.boards.taps, [{ name: 'Finn', value: 40 }]);
  assert.deepEqual(got.body.you, { taps: null, winters: null, earned: null, peakTaps: null });
  assert.equal(got.body.updated, 2000);

  // Asking as yourself, in either case, gets your ranks back.
  assert.deepEqual(serve(store, 'GET', null, { you: id(1).toUpperCase() }, 2000).body.you.taps, 1);
  assert.equal(serve(store, 'GET', null, { you: 'not-an-id' }, 2000).body.you.taps, null);
  assert.doesNotMatch(JSON.stringify(got.body), /0000-4000-8000/, 'an id leaked');
});

test('serve clamps the limit', () => {
  const store = { players: {} };
  for(let n = 1; n <= 120; n++){
    store.players[id(n)] = { name: `P${n}`, at: n, since: n, stats: { taps: n, winters: 0, earned: 0, peakTaps: 0 } };
  }
  assert.equal(serve(store, 'GET', null, {}, 0).body.boards.taps.length, TOP);
  assert.equal(serve(store, 'GET', null, { limit: '5' }, 0).body.boards.taps.length, 5);
  assert.equal(serve(store, 'GET', null, { limit: '500' }, 0).body.boards.taps.length, MAX_TOP);
  assert.equal(serve(store, 'GET', null, { limit: '0' }, 0).body.boards.taps.length, TOP, 'zero means the default');
  assert.equal(serve(store, 'GET', null, { limit: '-3' }, 0).body.boards.taps.length, 1);
  assert.equal(serve(store, 'GET', null, { limit: 'ten' }, 0).body.boards.taps.length, TOP);
});

test('serve answers 400, 429 and 405 in the shapes the client reads', () => {
  const store = { players: {} };

  const bad = serve(store, 'POST', { id: id(1), name: '!!', stats: {} }, {}, 0);
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.body), ['error']);
  assert.equal(typeof bad.body.error, 'string');
  assert.deepEqual(store.players, {}, 'a refused post writes nothing');

  const notJson = serve(store, 'POST', undefined, {}, 0);
  assert.equal(notJson.status, 400);

  assert.equal(serve(store, 'POST', { id: id(1), name: 'Finn', stats: { taps: 1 } }, {}, 0).status, 200);
  const soon = serve(store, 'POST', { id: id(1), name: 'Finn', stats: { taps: 2 } }, {}, 5000);
  assert.equal(soon.status, 429);
  assert.deepEqual(soon.body, { error: 'Too soon.', retryIn: MIN_INTERVAL - 5000 });
  assert.equal(store.players[id(1)].stats.taps, 1);

  for(const method of ['PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']){
    const r = serve(store, method, null, {}, 0);
    assert.equal(r.status, 405, `${method} should be refused`);
    assert.deepEqual(Object.keys(r.body), ['error']);
  }
});

test('serve makes the store its own if handed an empty one', () => {
  const store = {};
  assert.equal(serve(store, 'GET', null, undefined, 0).status, 200);
  assert.deepEqual(store.players, {});
});
