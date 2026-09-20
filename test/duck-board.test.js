/* Duck Duck Quack's board, rule by rule.
 *
 * The module is pure — the clock is an argument and the store is an argument —
 * so every case here is a call and a comparison, and the whole of what the
 * route does can be checked without a socket, a server or a Cloudflare
 * account. What matters most is the things a client can send that the board
 * must not believe: a name that is not a name, a score higher than the level
 * has ducklings, a second post inside the window, a five-thousand-and-first
 * row, a figure that would walk somebody's best backwards.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LEVEL_CAPS, LEVEL_IDS, MAX_POSTED_LEVELS,
  NAME_MIN, NAME_MAX, cleanName, nameKey, nameHeldBy, NAME_TAKEN, ID_RE,
  MIN_INTERVAL, MAX_PLAYERS, TOP, MAX_TOP, MAX_BODY, TOO_LARGE, BAD_JSON,
  validate, merge, rank, boards, serve, migrateStore, totalOf, levelsOf,
} from '../src/duck-board.js';

import { LEVELS, MAX_BONUS } from '../public/duck-duck-quack/content.js';

/* A UUID-shaped id from a small number, so a test can name five thousand of
   them and still read which one it is talking about. */
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const post = (n, bests = {}, name = `Player ${n}`) => ({ id: id(n), name, bests });

/* A store with some rows already in it, written the way `merge` writes them. */
function storeWith(rows){
  const players = {};
  let now = 0;
  for(const [n, bests, name] of rows){
    now += MIN_INTERVAL;
    const checked = validate(post(n, bests, name ?? `Player ${n}`));
    assert.ok(checked.ok, `test setup: ${checked.error}`);
    const merged = merge(players, checked.entry, now);
    assert.ok(merged.ok, `test setup: ${merged.error}`);
  }
  return players;
}

/* ------------------------------------------------------- the levels it knows */

test('the caps are every level, and each is that level\'s own duckCount', () => {
  /* The one test that matters most in this file. LEVEL_CAPS is a copy of
     something content.js already knows, made so the Worker does not have to
     carry seventy kilobytes of level geometry — and a copy is only safe while
     something fails when it drifts. This is that something. */
  /* A level's own duckCount plus MAX_BONUS: a run is worth its ducklings plus
     up to four for never pausing and finishing fast (content.js's runBonus),
     and a cap that stopped at duckCount would refuse precisely the best runs
     in the game. */
  const fromContent = Object.fromEntries(
    LEVELS.map(level => [level.id, level.duckCount + MAX_BONUS]));
  assert.deepEqual(LEVEL_CAPS, fromContent,
    'LEVEL_CAPS and the real levels disagree — a level was added, renamed or rebalanced');
  assert.deepEqual(LEVEL_IDS, LEVELS.map(level => level.id));
  // And the bonus is genuinely in there, rather than the two sides having
  // drifted to agree on duckCount again.
  for(const level of LEVELS){
    assert.ok(LEVEL_CAPS[level.id] > level.duckCount,
      `${level.id}'s cap leaves no room for a bonus`);
  }
});

/* ----------------------------------------------------------------- the name */

test('a name is tidied where it can be and refused where it cannot', () => {
  assert.equal(cleanName('  Ada  '), 'Ada');
  assert.equal(cleanName('Ada   Lovelace'), 'Ada Lovelace');
  assert.equal(cleanName('O’Brien'), "O'Brien", 'a curly apostrophe is not the player\'s doing');
  assert.equal(cleanName('Ada​Lovelace'), 'AdaLovelace', 'a zero-width space comes out silently');
  assert.equal(cleanName('a'), null, 'shorter than NAME_MIN');
  assert.equal(cleanName('a'.repeat(NAME_MAX + 1)), null, 'longer than NAME_MAX');
  assert.equal(cleanName('Ada ⭐'), null, 'a star is visible, so it is refused rather than edited');
  assert.equal(cleanName('---'), null, 'punctuation alone is not a name');
  assert.equal(cleanName(''), null);
  assert.equal(cleanName(null), null);
  assert.ok(NAME_MIN >= 2 && NAME_MAX >= NAME_MIN);
});

test('one name is one row, however it is spelled', () => {
  assert.equal(nameKey('Ada Lovelace'), nameKey('adalovelace'));
  const players = storeWith([[1, { park: 5 }, 'Ada']]);
  assert.equal(nameHeldBy(players, 'ADA'), id(1));
  assert.equal(nameHeldBy(players, 'A.d.a'), id(1), 'punctuation does not make a new name');
  assert.equal(nameHeldBy(players, 'Ada', id(1)), null, 'keeping your own name is not taking it');
  assert.equal(nameHeldBy(players, 'Bo'), null);
});

test('a second player cannot take a name that is already up', () => {
  const players = storeWith([[1, { park: 5 }, 'Ada']]);
  const checked = validate(post(2, { park: 3 }, 'ada'));
  const merged = merge(players, checked.entry, MIN_INTERVAL * 9);
  assert.equal(merged.ok, false);
  assert.equal(merged.error, NAME_TAKEN);
  assert.equal(merged.taken, true);
  assert.equal(players[id(2)], undefined, 'and the row is not written');
});

/* --------------------------------------------------------------- validation */

test('a post has to carry a board id that looks like one', () => {
  assert.equal(validate(post(1)).ok, true);
  assert.equal(validate({ id: 'nope', name: 'Ada', bests: {} }).ok, false);
  assert.equal(validate({ name: 'Ada', bests: {} }).ok, false);
  assert.equal(validate(null).ok, false);
  assert.equal(validate([]).ok, false);
  assert.ok(ID_RE.test(id(1)));
});

test('an id in capitals is the same row as one in lower case', () => {
  const checked = validate({ id: id(1).toUpperCase(), name: 'Ada', bests: {} });
  assert.equal(checked.entry.id, id(1));
});

test('a score above what the level hatches is refused, not clamped', () => {
  const cap = LEVEL_CAPS.park;
  assert.equal(validate(post(1, { park: cap })).ok, true, 'every duckling saved is allowed');
  const over = validate(post(1, { park: cap + 1 }));
  assert.equal(over.ok, false);
  assert.match(over.error, new RegExp(String(cap)), 'and the refusal says what the cap is');
});

test('a score that is not a whole number of ducklings is refused', () => {
  for(const bad of [-1, 2.5, 'lots', true, NaN, Infinity]){
    assert.equal(validate(post(1, { park: bad })).ok, false, `on ${String(bad)}`);
  }
  assert.equal(validate(post(1, { park: '8' })).ok, true, 'but "8" meaning eight is not odd enough to refuse');
});

test('a level the board has never heard of is dropped, not refused', () => {
  /* A client one deploy ahead of the Worker. Refusing the whole post would
     mean every score lost until the deploy lands; dropping the one it does not
     know keeps the other ten. */
  const checked = validate(post(1, { park: 8, atlantis: 99 }));
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.entry.bests, { park: 8 });
});

test('a level never finished is absent rather than a zero', () => {
  const checked = validate(post(1, { park: 8, warren: 0 }));
  assert.deepEqual(checked.entry.bests, { park: 8 },
    'so "levels" counts the ones actually played');
});

test('a body claiming more levels than the game has is refused', () => {
  const bests = {};
  for(let i = 0; i <= MAX_POSTED_LEVELS; i++) bests['level' + i] = 1;
  assert.equal(validate(post(1, bests)).ok, false);
});

test('bests that are not an object at all', () => {
  assert.equal(validate({ id: id(1), name: 'Ada', bests: [] }).ok, false);
  assert.equal(validate({ id: id(1), name: 'Ada', bests: 'park' }).ok, false);
  assert.equal(validate({ id: id(1), name: 'Ada' }).ok, true, 'but none at all is a new player');
});

/* -------------------------------------------------------------------- merge */

test('a record only ever goes up', () => {
  const players = storeWith([[1, { park: 9, warren: 4 }]]);
  const checked = validate(post(1, { park: 3, warren: 11 }));
  merge(players, checked.entry, MIN_INTERVAL * 9);
  assert.deepEqual(players[id(1)].bests, { park: 9, warren: 11 },
    'the worse park score is ignored and the better warren one is taken');
});

test('a post carries every level, so a refused one loses nothing', () => {
  /* The client posts the whole map each time. A post refused as too soon is
     not a score lost — the next accepted one carries it. */
  const players = storeWith([[1, { park: 5 }]]);
  const soon = merge(players, validate(post(1, { park: 5, warren: 7 })).entry, MIN_INTERVAL + 1);
  assert.equal(soon.ok, false, 'too soon');
  const later = merge(players, validate(post(1, { park: 5, warren: 7 })).entry, MIN_INTERVAL * 4);
  assert.equal(later.ok, true);
  assert.deepEqual(players[id(1)].bests, { park: 5, warren: 7 });
});

test('a second post inside the window is refused, with how long to wait', () => {
  const players = storeWith([[1, { park: 5 }]]);
  const at = MIN_INTERVAL + 1000;
  const merged = merge(players, validate(post(1, { park: 6 })).entry, at);
  assert.equal(merged.ok, false);
  assert.equal(merged.retryIn, MIN_INTERVAL - 1000);
  assert.equal(players[id(1)].bests.park, 5, 'and nothing was written');
});

test('a clock that went backwards is not a lockout', () => {
  const players = storeWith([[1, { park: 5 }]]);
  const merged = merge(players, validate(post(1, { park: 6 })).entry, -1e9);
  assert.equal(merged.ok, true, 'a wait longer than the window is treated as no wait');
});

test('a player may change what they are called', () => {
  const players = storeWith([[1, { park: 5 }, 'Ada']]);
  merge(players, validate(post(1, { park: 5 }, 'Ada L')).entry, MIN_INTERVAL * 9);
  assert.equal(players[id(1)].name, 'Ada L');
  assert.equal(Object.keys(players).length, 1, 'and it is still one row');
});

test('the day a player arrived survives their later posts', () => {
  const players = storeWith([[1, { park: 5 }]]);
  const since = players[id(1)].since;
  merge(players, validate(post(1, { park: 6 })).entry, MIN_INTERVAL * 99);
  assert.equal(players[id(1)].since, since, 'ties are broken on it, so it must not move');
});

/* --------------------------------------------------------------------- rank */

test('the board ranks on the total across every level', () => {
  const players = storeWith([
    [1, { park: 8, warren: 9 }, 'Ada'],
    [2, { park: 10 }, 'Bo'],
    [3, { park: 5, grove: 5 }, 'Cy'],
  ]);
  assert.deepEqual(rank(players).map(r => [r.name, r.total, r.levels]), [
    ['Ada', 17, 2],
    ['Cy', 10, 2],
    ['Bo', 10, 1],
  ]);
});

test('more levels breaks a tie, and then who got there first', () => {
  const players = storeWith([
    [1, { park: 10 }, 'Deep'],
    [2, { park: 5, grove: 5 }, 'Wide'],
  ]);
  assert.equal(rank(players)[0].name, 'Wide', 'ten over two levels beats ten over one');

  const drawn = storeWith([
    [1, { park: 10 }, 'First'],
    [2, { park: 10 }, 'Second'],
  ]);
  assert.equal(rank(drawn)[0].name, 'First', 'and a dead heat goes to whoever arrived first');
});

test('a player with a name and no score is not on the board', () => {
  const players = storeWith([[1, {}, 'Watcher'], [2, { park: 1 }, 'Player']]);
  assert.deepEqual(rank(players).map(r => r.name), ['Player']);
  assert.equal(totalOf(players[id(1)]), 0);
  assert.equal(levelsOf(players[id(1)]), 0);
});

test('the board is TOP long by default and takes a limit', () => {
  // The Spire, because it hatches thirty and these scores have to be distinct.
  const players = storeWith(Array.from({ length: 14 }, (_, i) => [i, { spire: i + 1 }, `P${i}`]));
  assert.equal(rank(players).length, TOP);
  assert.equal(rank(players, 3).length, 3);
  assert.equal(rank(players, Infinity).length, 14);
});

/* ------------------------------------------------------------------- boards */

test('the public shape carries no ids at all', () => {
  const players = storeWith([[1, { park: 8 }, 'Ada']]);
  const page = boards(players, { you: id(1) });
  assert.equal(JSON.stringify(page).includes(id(1)), false,
    'the id is the secret that lets a player write their row');
  assert.deepEqual(page.board, [{ name: 'Ada', total: 8, levels: 1 }]);
});

test('you are told where you stand even when you are nowhere near the top', () => {
  const rows = Array.from({ length: 30 }, (_, i) => [i, { park: (i % 10) + 1, spire: i + 1 }, `P${i}`]);
  const players = storeWith(rows);
  const page = boards(players, { limit: 10, you: id(0) });
  assert.equal(page.board.length, 10);
  assert.equal(page.players, 30);
  assert.equal(page.you.rank, 30, 'last, and told so rather than told nothing');
  assert.equal(page.you.total, totalOf(players[id(0)]));
});

test('your own bests come back with the board, so a lost browser can be refilled', () => {
  const players = storeWith([[1, { park: 8, belfry: 12 }, 'Ada']]);
  const page = boards(players, { you: id(1) });
  assert.deepEqual(page.you.bests, { park: 8, belfry: 12 });
  assert.equal(page.you.name, 'Ada');
});

test('asking as nobody is a board and no you', () => {
  const players = storeWith([[1, { park: 8 }, 'Ada']]);
  assert.equal(boards(players).you, null);
  assert.equal(boards(players, { you: id(9) }).you, null, 'and so is an id with no row');
});

/* -------------------------------------------------------------------- serve */

test('GET answers a board', () => {
  const store = { players: storeWith([[1, { park: 8 }, 'Ada']]) };
  const reply = serve(store, 'GET', null, {}, 1000);
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body.board, [{ name: 'Ada', total: 8, levels: 1 }]);
  assert.equal(reply.body.updated, 1000);
});

test('GET takes a limit, within reason', () => {
  const store = { players: storeWith(Array.from({ length: 20 }, (_, i) => [i, { spire: i + 1 }, `P${i}`])) };
  assert.equal(serve(store, 'GET', null, { limit: '3' }, 0).body.board.length, 3);
  assert.equal(serve(store, 'GET', null, { limit: '0' }, 0).body.board.length, TOP, 'nonsense falls back');
  assert.equal(serve(store, 'GET', null, { limit: '9999' }, 0).body.board.length, 20, 'and is capped at MAX_TOP');
  assert.ok(MAX_TOP >= TOP);
});

test('GET with a you that is not an id is simply nobody', () => {
  const store = { players: storeWith([[1, { park: 8 }, 'Ada']]) };
  assert.equal(serve(store, 'GET', null, { you: 'drop table' }, 0).body.you, null);
});

test('POST files a score and answers with the board the player is now on', () => {
  const store = { players: {} };
  const reply = serve(store, 'POST', post(1, { park: 8 }, 'Ada'), {}, 1000);
  assert.equal(reply.status, 200);
  assert.equal(reply.body.you.rank, 1);
  assert.deepEqual(reply.body.board, [{ name: 'Ada', total: 8, levels: 1 }]);
});

test('POST says what was wrong rather than failing silently', () => {
  const store = { players: {} };
  assert.equal(serve(store, 'POST', { id: 'nope' }, {}, 0).status, 400);
  assert.equal(serve(store, 'POST', post(1, {}, '!'), {}, 0).status, 400);
  assert.equal(serve(store, 'POST', post(1, { park: 999 }), {}, 0).status, 400);
  assert.deepEqual(store.players, {}, 'and nothing was written by any of them');
});

test('a taken name is a 409 and being too soon is a 429', () => {
  const store = { players: storeWith([[1, { park: 8 }, 'Ada']]) };
  const taken = serve(store, 'POST', post(2, { park: 1 }, 'Ada'), {}, MIN_INTERVAL * 99);
  assert.equal(taken.status, 409, 'waiting will never make this work');

  serve(store, 'POST', post(3, { park: 1 }, 'Bo'), {}, MIN_INTERVAL * 99);
  const soon = serve(store, 'POST', post(3, { park: 2 }, 'Bo'), {}, MIN_INTERVAL * 99 + 10);
  assert.equal(soon.status, 429);
  assert.ok(soon.body.retryIn > 0, 'and it says how long');
});

test('DELETE takes a row off, and does not mind if it was already gone', () => {
  const store = { players: storeWith([[1, { park: 8 }, 'Ada']]) };
  const gone = serve(store, 'DELETE', { id: id(1) }, {}, 0);
  assert.equal(gone.status, 200);
  assert.equal(gone.body.removed, true);
  assert.deepEqual(gone.body.board, []);

  const again = serve(store, 'DELETE', { id: id(1) }, {}, 0);
  assert.equal(again.status, 200);
  assert.equal(again.body.removed, false);
});

test('DELETE needs an id that looks like one', () => {
  const store = { players: storeWith([[1, { park: 8 }, 'Ada']]) };
  assert.equal(serve(store, 'DELETE', { id: 'nope' }, {}, 0).status, 400);
  assert.equal(serve(store, 'DELETE', null, {}, 0).status, 400);
  assert.equal(Object.keys(store.players).length, 1);
});

test('anything else is a 405', () => {
  assert.equal(serve({ players: {} }, 'PUT', {}, {}, 0).status, 405);
  assert.equal(serve({ players: {} }, 'PATCH', {}, {}, 0).status, 405);
});

test('serve never throws on anything a client could send', () => {
  const store = { players: {} };
  for(const body of [null, undefined, 0, '', [], { id: [] }, { id: id(1), name: {}, bests: { park: {} } }]){
    assert.doesNotThrow(() => serve(store, 'POST', body, {}, 0));
    assert.doesNotThrow(() => serve(store, 'DELETE', body, {}, 0));
  }
});

/* ------------------------------------------------------------------ pruning */

test('the store stops growing, and keeps the board while it does', () => {
  const players = {};
  let now = 0;
  // One clear leader, then MAX_PLAYERS + 20 nobodies.
  const top = validate(post(999999, { spire: 30 }, 'Champion'));
  merge(players, top.entry, now += MIN_INTERVAL);
  for(let i = 0; i < MAX_PLAYERS + 20; i++){
    merge(players, validate(post(i, { park: 1 }, `P${i}`)).entry, now += MIN_INTERVAL);
  }
  assert.ok(Object.keys(players).length <= MAX_PLAYERS, 'it is capped');
  assert.ok(players[id(999999)], 'and the leader is still there despite being the oldest row');
  assert.ok(players[id(MAX_PLAYERS + 19)], 'as is the row that was just written');
});

/* ----------------------------------------------------------------- the past */

test('rubbish in storage is dropped rather than drawn', () => {
  const store = { players: {
    [id(1)]: { name: 'Ada', bests: { park: 8 }, at: 1, since: 1 },
    [id(2)]: { name: 'Bad', bests: { park: 999, atlantis: 3, warren: -2 }, at: 1, since: 1 },
    [id(3)]: { name: '!', bests: { park: 1 }, at: 1, since: 1 },
    [id(4)]: null,
    'not-an-id': { name: 'Sneak', bests: { park: 1 }, at: 1, since: 1 },
  } };
  assert.equal(migrateStore(store), true, 'something moved, so it is worth saving back');
  assert.deepEqual(Object.keys(store.players), [id(1), id(2)]);
  assert.deepEqual(store.players[id(2)].bests, {}, 'every impossible figure went');
  assert.deepEqual(store.players[id(1)].bests, { park: 8 }, 'and the good row is untouched');
});

test('a store that is already right is not rewritten', () => {
  const store = { players: storeWith([[1, { park: 8 }, 'Ada']]) };
  assert.equal(migrateStore(store), false, 'so a cold start writes nothing');
});

test('migrating nothing at all is safe', () => {
  assert.equal(migrateStore({ players: {} }), false);
  assert.equal(migrateStore({}), false);
  assert.equal(migrateStore(null), false);
});

/* ---------------------------------------------------------------- the shape */

test('the constants the client and the Durable Object were written against', () => {
  assert.equal(MAX_BODY, 4096);
  assert.equal(TOO_LARGE.status, 413);
  assert.equal(BAD_JSON.status, 400);
  assert.ok(MIN_INTERVAL > 0 && MIN_INTERVAL <= 15000);
});
