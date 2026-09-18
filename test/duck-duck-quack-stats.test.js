/* Duck Duck Quack — the scoreboard.
 *
 * Every one of these drives the real module against a fake storage, which
 * is the whole reason createStats takes one: localStorage does not exist in
 * node, and a scoreboard whose rules can only be checked by clicking
 * through a browser is a scoreboard whose rules do not get checked.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createStats, cleanName, parseBook, STORAGE_KEY, NAME_MAX }
  from '../public/duck-duck-quack/stats.js';

/* localStorage's own shape, near enough: strings in, strings out. */
function fakeStorage(seed = null){
  const cell = { [STORAGE_KEY]: seed };
  return {
    getItem: k => cell[k] ?? null,
    setItem: (k, v) => { cell[k] = String(v); },
    read: () => cell[STORAGE_KEY],
  };
}

/* ----------------------------------------------------------------- names */

test('a name is tidied, not rejected, wherever it can be', () => {
  assert.equal(cleanName('  Ada  '), 'Ada');
  assert.equal(cleanName('Ada   Lovelace'), 'Ada Lovelace');
  assert.equal(cleanName('a'.repeat(40)), 'a'.repeat(NAME_MAX));
  assert.equal(cleanName(''), null);
  assert.equal(cleanName('   '), null);
  assert.equal(cleanName(null), null);
  assert.equal(cleanName(undefined), null);
});

test('one player, however they capitalise it', () => {
  const stats = createStats(fakeStorage());
  assert.equal(stats.use('Ada'), 'Ada');
  assert.equal(stats.use('ADA'), 'Ada', 'the spelling first entered is the one kept');
  assert.equal(stats.use('  ada '), 'Ada');
  assert.deepEqual(stats.players(), ['Ada']);
});

test('an empty name picks nobody', () => {
  const stats = createStats(fakeStorage());
  assert.equal(stats.use('   '), null);
  assert.equal(stats.current(), null);
  assert.deepEqual(stats.players(), []);
});

/* ---------------------------------------------------------------- scoring */

test('a level keeps the best run, not the last', () => {
  const stats = createStats(fakeStorage());
  stats.use('Ada');
  assert.deepEqual(stats.record('Ada', 'park', 6), { best: 6, improved: true });
  assert.deepEqual(stats.record('Ada', 'park', 9), { best: 9, improved: true });
  assert.deepEqual(stats.record('Ada', 'park', 4), { best: 9, improved: false },
    'a worse run leaves the mark alone');
  assert.equal(stats.best('Ada', 'park'), 9);
});

test('each level is scored on its own', () => {
  const stats = createStats(fakeStorage());
  stats.use('Ada');
  stats.record('Ada', 'park', 8);
  stats.record('Ada', 'warren', 11);
  assert.equal(stats.best('Ada', 'park'), 8);
  assert.equal(stats.best('Ada', 'warren'), 11);
  assert.equal(stats.best('Ada', 'spire'), 0, 'a level never played is a zero, not a gap');
  assert.equal(stats.total('Ada'), 19);
  assert.deepEqual(stats.bests('Ada'), { park: 8, warren: 11 });
});

test('a run by nobody is not recorded', () => {
  const stats = createStats(fakeStorage());
  assert.deepEqual(stats.record(null, 'park', 9), { best: 0, improved: false });
  assert.deepEqual(stats.record('Ghost', 'park', 9), { best: 0, improved: false },
    'and nor is one by a name that was never picked');
  assert.deepEqual(stats.players(), []);
});

test('a run of zero saved is not a mark', () => {
  const stats = createStats(fakeStorage());
  stats.use('Ada');
  assert.deepEqual(stats.record('Ada', 'park', 0), { best: 0, improved: false });
  assert.deepEqual(stats.bests('Ada'), {});
});

/* ------------------------------------------------------------ the top ten */

test('the top ten ranks on the total across every level', () => {
  const stats = createStats(fakeStorage());
  stats.use('Ada'); stats.record('Ada', 'park', 8); stats.record('Ada', 'warren', 9);
  stats.use('Bo'); stats.record('Bo', 'park', 10);
  stats.use('Cy'); stats.record('Cy', 'park', 5); stats.record('Cy', 'grove', 5);
  assert.deepEqual(stats.leaderboard(), [
    { name: 'Ada', total: 17, levels: 2 },
    { name: 'Bo', total: 10, levels: 1 },
    { name: 'Cy', total: 10, levels: 2 },
  ].sort((a, b) => b.total - a.total || b.levels - a.levels));
});

test('more levels breaks a tie, and the alphabet settles the rest', () => {
  const stats = createStats(fakeStorage());
  stats.use('Wide'); stats.record('Wide', 'park', 5); stats.record('Wide', 'grove', 5);
  stats.use('Deep'); stats.record('Deep', 'park', 10);
  const [first, second] = stats.leaderboard();
  assert.equal(first.name, 'Wide', 'ten over two levels beats ten over one');
  assert.equal(second.name, 'Deep');
});

test('the top ten is ten long at most, and leaves out anyone with no mark', () => {
  const stats = createStats(fakeStorage());
  for(let i = 0; i < 14; i++){
    const name = 'P' + String(i).padStart(2, '0');
    stats.use(name);
    stats.record(name, 'park', i + 1);
  }
  stats.use('Watcher');    // picked a name, never finished a level
  const board = stats.leaderboard();
  assert.equal(board.length, 10);
  assert.equal(board[0].name, 'P13', 'best first');
  assert.ok(!board.some(r => r.name === 'Watcher'));
  assert.equal(stats.leaderboard(3).length, 3, 'and it takes a shorter limit');
});

/* ---------------------------------------------------------------- storage */

test('a player and their marks come back on the next visit', () => {
  const storage = fakeStorage();
  const first = createStats(storage);
  first.use('Ada');
  first.record('Ada', 'park', 9);

  const later = createStats(storage);
  assert.equal(later.current(), 'Ada', 'and they are still the one playing');
  assert.equal(later.best('Ada', 'park'), 9);
  assert.deepEqual(later.players(), ['Ada']);
});

test('stopping tracking keeps the marks', () => {
  const storage = fakeStorage();
  const stats = createStats(storage);
  stats.use('Ada');
  stats.record('Ada', 'park', 9);
  stats.clearCurrent();
  assert.equal(stats.current(), null);
  assert.equal(createStats(storage).best('Ada', 'park'), 9);
});

test('forgetting a player removes them and stands down as the current one', () => {
  const storage = fakeStorage();
  const stats = createStats(storage);
  stats.use('Ada'); stats.record('Ada', 'park', 9);
  assert.equal(stats.forget('ada'), true, 'by any capitalisation');
  assert.equal(stats.forget('Nobody'), false);
  assert.deepEqual(stats.players(), []);
  assert.equal(stats.current(), null);
  assert.equal(createStats(storage).best('Ada', 'park'), 0);
});

test('rubbish in storage reads as no stats rather than as a broken page', () => {
  for(const junk of ['', 'not json', '[]', 'null', '{"players":3}', '{"players":{"":{}}}']){
    const stats = createStats(fakeStorage(junk));
    assert.deepEqual(stats.players(), [], `on ${JSON.stringify(junk)}`);
    assert.equal(stats.current(), null);
    assert.deepEqual(stats.leaderboard(), []);
  }
});

test('a hand-edited score is taken only where it makes sense', () => {
  const book = parseBook(JSON.stringify({
    current: 'Ada',
    players: { Ada: { park: 9, warren: -3, grove: 'lots', aerie: 2.7, spire: 0 } },
  }));
  assert.deepEqual(book.players.Ada, { park: 9, aerie: 2 },
    'negative, non-numeric and zero marks are dropped; a fraction floors');
  assert.equal(book.current, 'Ada');
});

test('a current player who is not in the book is nobody', () => {
  const book = parseBook(JSON.stringify({ current: 'Ghost', players: { Ada: { park: 1 } } }));
  assert.equal(book.current, null);
});

test('storage that throws on every call leaves the game playable', () => {
  const hostile = {
    getItem(){ throw new Error('blocked'); },
    setItem(){ throw new Error('blocked'); },
  };
  const stats = createStats(hostile);
  assert.equal(stats.use('Ada'), 'Ada');
  assert.deepEqual(stats.record('Ada', 'park', 9), { best: 9, improved: true },
    'the run still counts for as long as the page is open');
  assert.equal(stats.best('Ada', 'park'), 9);
});

test('no storage at all is the same as storage that refuses', () => {
  const stats = createStats(undefined);
  assert.equal(stats.use('Ada'), 'Ada');
  assert.equal(stats.record('Ada', 'park', 5).best, 5);
});
