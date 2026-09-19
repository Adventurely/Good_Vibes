/* Duck Duck Quack's leaderboard — the rules of it, and nothing else.
 *
 * Pure, the way `sunward-board.js` is pure and for the same reasons: the time
 * comes in as an argument, the store comes in as an argument, and the whole of
 * the HTTP behaviour is one function, `serve`, that takes a method and a body
 * and hands back a status and an object. That is what lets the Durable Object
 * and the dev server each be a dozen lines around it, and it is what lets
 * every case below be checked in Node without a socket anywhere near it.
 *
 * --- What a row is ----------------------------------------------------------
 *
 * One number per player per level: the most ducklings that player has ever got
 * to the pond on it. Not a win/loss record and not a history — a level lost
 * with nine saved is a better nine than a level won with eight. The board
 * ranks on the total of those bests across every level, so it rewards playing
 * the whole game as well as playing it well.
 *
 * The client posts the WHOLE map every time and the server takes the maximum
 * per level, which is what makes the thing self-healing. A post refused for
 * being too soon, a level finished on a plane, a browser in private mode: none
 * of them lose anything, because the next accepted post carries the lot. It
 * also means a second tab with a stale copy can never walk a best back down.
 *
 * --- What is checked, and what cannot be -------------------------------------
 *
 * Every figure here is self-reported. There is no sign-in on this site by
 * choice, so there is no account to hang a reputation on, and the game runs
 * entirely in the player's browser — anyone who wants to post a twelve they
 * did not earn can. What there is instead:
 *
 *   - a ceiling per level that is exact rather than guessed: you cannot save
 *     more ducklings than hatch, so LEVEL_CAPS is the level's own duckCount and
 *     a figure above it is a client that has gone wrong (or a player editing
 *     JSON). Sunward learned the hard way that a cap pitched at what somebody
 *     GUESSED the game could produce turns away real players on the first
 *     evening — see the long note in `sunward-board.js`. This is not that kind
 *     of cap. There is no judgement in it, only arithmetic;
 *   - a floor of five seconds between accepted posts from one id, which is a
 *     rate limit and not a defence, and is described as one;
 *   - a record that only ever goes up, per level;
 *   - one name, one row, so the board does not fill with six Adas;
 *   - a cap on how many rows are kept at all, with the ones nobody would ever
 *     see pruned first.
 *
 * Somebody who wants to sit at the top having saved every duckling on every
 * level can, and the board will show it. This is a leaderboard for a hobby
 * site, and the page it is drawn on says as much.
 *
 * --- Identity ----------------------------------------------------------------
 *
 * The id is a UUID the browser makes and keeps in localStorage; whoever holds
 * it can update that row and nobody else can. It is the room-code idea again —
 * the secret is the token, not a login — and the public shape of the board
 * never carries it, so reading the board tells you nobody's.
 *
 * One id per NAME rather than one per browser, which is where this differs
 * from Sunward. The game already lets a household keep several players on one
 * machine and pick between them, so a browser holds as many ids as it has
 * names, and two people sharing a laptop get a row each.
 */

import { cleanName, nameKey, NAME_MIN, NAME_MAX, NAME_RULE } from '../public/duck-duck-quack/names.js';

export { cleanName, nameKey, NAME_MIN, NAME_MAX, NAME_RULE };

/* ------------------------------------------------------------- the levels */

/* Every level that has a score, and the most ducklings that can be saved on
 * it — which is the level's `duckCount`, because the pond cannot take more
 * ducklings than the nest lets out.
 *
 * Copied rather than imported: this module runs inside the Worker, and
 * `content.js` is seventy kilobytes of level geometry, art tables and in-world
 * text to reach eleven numbers. The copy is the same trade the generated
 * content tables make elsewhere in this repo, and it is held to the same
 * standard — `test/duck-board.test.js` asserts this table against the real
 * LEVELS and fails if a level is added, renamed or rebalanced without it.
 * A drift here is a loud test, not a quiet wrong answer.
 *
 * Listed in the order the levels are played, which the same test pins — the
 * caps themselves do not care, but a table that reads in a different order
 * from content.js's own is a table somebody will one day compare line by
 * line and misread. Reorder the game, reorder this.
 */
export const LEVEL_CAPS = {
  warren: 12,
  park: 10,
  orchard: 25,
  grove: 12,
  aerie: 10,
  spire: 30,
  falls: 20,
  hedgerow: 16,
  overlook: 18,
  stones: 24,
  belfry: 24,
  errand: 18,
};

export const LEVEL_IDS = Object.keys(LEVEL_CAPS);

/* The most levels a single post may mention. Not a rule about the game — it is
   a bound on the work one request can ask for, so a body full of ten thousand
   invented level ids is refused rather than walked. */
export const MAX_POSTED_LEVELS = 64;

/* ------------------------------------------------------------------- the id */

/* A UUID, either case. The client makes one with crypto.randomUUID and never
   shows it to the player, so anything else arriving here is not a player. */
export const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* --------------------------------------------------------------- the limits */

/* Between accepted posts from one id. The client posts when a level ends, and
   the shortest a level can take is a hatch that walks straight into the water
   — twenty seconds or so. Five is well under that, so no honest run is ever
   refused, and it is still short enough to make a loop pointless: a script
   hammering this is refused for four seconds out of every five, and gains
   nothing by it that one post would not have given it anyway. */
export const MIN_INTERVAL = 5000;

/* How many rows are kept at all, so that ten thousand tabs opened by one
   script do not become a store that grows without a ceiling. The object keeps
   every row under one storage key, and a key has a size. */
export const MAX_PLAYERS = 5000;

/* How long a board is by default, and the most a caller may ask for. */
export const TOP = 10;
export const MAX_TOP = 100;

/* The most a POST body may be. An id, a name at its longest in the widest
   script, and a few dozen small integers. */
export const MAX_BODY = 4096;
export const TOO_LARGE = { status: 413, body: { error: 'That is more than the board will take in one go.' } };
export const BAD_JSON = { status: 400, body: { error: 'That was not JSON.' } };
export const NAME_TAKEN = 'Somebody else is on the board under that name.';

/* ------------------------------------------------------------------ validate */

/* Turn a figure as posted into a number, or NaN if it was not one. JSON
   carries numbers as numbers, so a string here is a client doing something
   odd — but "8" meaning eight is not odd enough to refuse. A boolean is. */
function coerce(value){
  if(value === undefined || value === null) return 0;
  if(typeof value === 'number') return value;
  if(typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

/* Check a posted body and hand back a clean entry, or say what was wrong with
 * it in words the client can put on the screen.
 *
 * A level this board has never heard of is DROPPED rather than refused, so a
 * client one deploy ahead — a twelfth level live in the browser before the
 * Worker has caught up — still gets its eleven in instead of having every post
 * rejected until the deploy lands. A level it has heard of with an impossible
 * figure on it is refused, because that is a client that is wrong rather than
 * new, and a silent Math.min would hide it.
 */
export function validate(body){
  if(!body || typeof body !== 'object' || Array.isArray(body)){
    return { ok: false, error: 'That did not look like a score.' };
  }
  if(typeof body.id !== 'string' || !ID_RE.test(body.id)){
    return { ok: false, error: 'That board id does not look right.' };
  }
  const name = cleanName(body.name);
  if(name === null) return { ok: false, error: NAME_RULE };

  const posted = body.bests ?? {};
  if(!posted || typeof posted !== 'object' || Array.isArray(posted)){
    return { ok: false, error: 'Those scores did not look right.' };
  }
  const keys = Object.keys(posted);
  if(keys.length > MAX_POSTED_LEVELS){
    return { ok: false, error: 'That is more levels than this game has.' };
  }

  const bests = {};
  for(const levelId of keys){
    const cap = LEVEL_CAPS[levelId];
    if(cap === undefined) continue;             // a level this board does not know yet
    const value = coerce(posted[levelId]);
    if(!Number.isFinite(value) || value < 0 || !Number.isInteger(value)){
      return { ok: false, error: 'A score must be a whole number of ducklings, zero or more.' };
    }
    if(value > cap){
      return { ok: false, error: `No more than ${cap} ducklings ever hatch on that level.` };
    }
    // A level never finished is not a zero on the board, it is simply absent —
    // same as the client's own book, so the two agree on what "levels" counts.
    if(value > 0) bests[levelId] = value;
  }

  // UUIDs are case-insensitive by definition, and a client that sends one in
  // capitals on Tuesday and lower case on Wednesday should not be two rows.
  return { ok: true, entry: { id: body.id.toLowerCase(), name, bests } };
}

/* ------------------------------------------------------------------- naming */

/* Whose row already holds that name, or null. An id of its own does not count
   against it: keeping your name is not taking it. */
export function nameHeldBy(players, name, exceptId = null){
  const want = nameKey(name);
  for(const [id, row] of Object.entries(players || {})){
    if(id === exceptId) continue;
    if(row && nameKey(row.name) === want) return id;
  }
  return null;
}

/* --------------------------------------------------------------------- sums */

export const totalOf = row =>
  Object.values(row?.bests || {}).reduce((sum, n) => sum + n, 0);

export const levelsOf = row => Object.keys(row?.bests || {}).length;

/* -------------------------------------------------------------------- merge */

/* Fold an entry into the store, or refuse it as too soon. Mutates `players`.
 *
 * Every level takes the maximum of what was there and what arrived, so a
 * record never goes down and a stale tab cannot undo a good run. The name is
 * the exception — it is not a record, it is what the player wants to be called
 * today.
 *
 * The rate limit is a window, not a budget. A clock that has gone backwards —
 * a restored object, a laptop's sleep — would make the wait longer than the
 * window itself, and rather than lock a player out until the clock catches up,
 * a wait that long is treated as no wait at all.
 */
export function merge(players, entry, now){
  const old = players[entry.id];
  if(old){
    const wait = MIN_INTERVAL - (now - old.at);
    if(wait > 0 && wait <= MIN_INTERVAL) return { ok: false, error: 'Too soon.', retryIn: wait };
  }

  /* One name, one row. Checked after the rate limit is read and before its
     answer is written, so a player moving to a taken name hears why rather
     than hearing "too soon" about something that was never going to work. */
  if(nameHeldBy(players, entry.name, entry.id)){
    return { ok: false, error: NAME_TAKEN, taken: true };
  }

  const bests = { ...(old?.bests || {}) };
  for(const [levelId, value] of Object.entries(entry.bests)){
    bests[levelId] = Math.max(bests[levelId] || 0, value);
  }
  players[entry.id] = { name: entry.name, bests, at: now, since: old?.since ?? now };

  prune(players, entry.id);
  return { ok: true };
}

/* Bring the store back under MAX_PLAYERS, if it has gone over.
 *
 * Anyone in the top hundred is kept, because they are the board; so is the row
 * that was just written, because refusing a post and then forgetting it is
 * worse than either alone. Of the rest, the ones nobody has heard from for
 * longest go first — a row not posted to in a month is a browser that cleared
 * its storage, or a player who stopped. */
function prune(players, keep){
  let over = Object.keys(players).length - MAX_PLAYERS;
  if(over <= 0) return;

  const safe = new Set([keep]);
  for(const row of rank(players, MAX_TOP)) safe.add(row.id);

  const doomed = Object.keys(players)
    .filter(id => !safe.has(id))
    .sort((a, b) => (players[a].at - players[b].at) || (a < b ? -1 : 1));
  for(const id of doomed){
    if(over <= 0) break;
    delete players[id];
    over--;
  }
}

/* ------------------------------------------------------------------ the past */

/* Bring stored rows up to the shape this file expects, and say whether
 * anything moved so the caller knows if the result is worth writing back.
 *
 * There is only one shape so far, so this is nearly a no-op — it is here from
 * the start because the Sunward board needed one three weeks in and adding it
 * afterwards meant a deploy that had to be right first time. Rows that are not
 * objects, bests that are not objects, and figures that are not whole positive
 * numbers under the level's cap are dropped: whatever wrote them, the board
 * should not be drawing them.
 */
export function migrateStore(store){
  const players = store?.players;
  if(!players || typeof players !== 'object') return false;
  let moved = false;

  for(const [id, row] of Object.entries(players)){
    if(!row || typeof row !== 'object' || !ID_RE.test(id)){
      delete players[id];
      moved = true;
      continue;
    }
    const bests = row.bests && typeof row.bests === 'object' && !Array.isArray(row.bests)
      ? row.bests : {};
    const clean = {};
    for(const [levelId, value] of Object.entries(bests)){
      const cap = LEVEL_CAPS[levelId];
      const n = Number(value);
      if(cap === undefined || !Number.isInteger(n) || n <= 0 || n > cap) continue;
      clean[levelId] = n;
    }
    if(Object.keys(clean).length !== Object.keys(bests).length){ moved = true; }
    row.bests = clean;
    if(typeof row.at !== 'number'){ row.at = 0; moved = true; }
    if(typeof row.since !== 'number'){ row.since = row.at; moved = true; }
    if(cleanName(row.name) === null){
      delete players[id];
      moved = true;
    }
  }
  return moved;
}

/* ---------------------------------------------------------------------- rank */

/* The board, best first. A player with nothing on it is not in last place,
 * they are simply not on it — picking a name is not a score.
 *
 * Ties break on how many levels the total is spread over, because thirty
 * ducklings across five levels is a better showing than thirty across two;
 * then on who got there first; then on the id, so the order is identical on
 * every read and two level players never swap places on a refresh. */
export function rank(players, limit = TOP){
  return Object.entries(players)
    .map(([id, row]) => ({ id, name: row.name, total: totalOf(row), levels: levelsOf(row), since: row.since }))
    .filter(row => row.total > 0)
    .sort((a, b) =>
      (b.total - a.total) || (b.levels - a.levels) || (a.since - b.since) || (a.id < b.id ? -1 : 1))
    .slice(0, limit);
}

/* -------------------------------------------------------------------- boards */

/* The public shape. No ids anywhere in it — the id is the secret that lets a
 * player update their row, so a response carrying everyone's would hand every
 * row to everyone. `you` is where the asking player stands over ALL players
 * rather than only the ones shown, so somebody in 400th place is told 400th
 * rather than nothing, and it carries their own bests back so a browser that
 * has lost its local copy can be filled from the board. */
export function boards(players, { limit = TOP, you = null } = {}){
  const full = rank(players, Infinity);
  const at = you ? full.findIndex(row => row.id === you) : -1;
  const mine = you ? players[you] : null;

  return {
    board: full.slice(0, limit).map(({ name, total, levels }) => ({ name, total, levels })),
    players: full.length,
    you: mine
      ? { name: mine.name, total: totalOf(mine), levels: levelsOf(mine),
          rank: at < 0 ? null : at + 1, bests: { ...mine.bests } }
      : null,
  };
}

/* ---------------------------------------------------------------------- serve */

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/* Everything the route does, as a function of what came in.
 *
 * `store` is `{ players }` and is mutated in place — the caller owns
 * persistence and knows whether anything changed by the status. `body` is the
 * parsed JSON for a POST, already read and already under MAX_BODY; that has to
 * happen before parsing and so cannot happen here. Returns `{ status, body }`
 * and never throws for anything a client could send. */
export function serve(store, method, body, query = {}, now = 0){
  const players = store.players ||= {};
  const limit = clamp(parseInt(query.limit, 10) || TOP, 1, MAX_TOP);
  const page = you => ({ ...boards(players, { limit, you }), updated: now });

  if(method === 'GET'){
    const you = typeof query.you === 'string' && ID_RE.test(query.you) ? query.you.toLowerCase() : null;
    return { status: 200, body: page(you) };
  }

  if(method === 'POST'){
    const checked = validate(body);
    if(!checked.ok) return { status: 400, body: { error: checked.error } };
    const merged = merge(players, checked.entry, now);
    /* A taken name is a conflict and not a rate limit, and the difference
       matters to the client: 429 means "the same thing, later" and this is a
       thing that will never work however long it waits. */
    if(!merged.ok && merged.taken) return { status: 409, body: { error: merged.error } };
    if(!merged.ok) return { status: 429, body: { error: merged.error, retryIn: merged.retryIn } };
    return { status: 200, body: page(checked.entry.id) };
  }

  /* Taking your own row off again. The id is the authority here exactly as it
     is for writing — whoever holds it holds the row — so this needs no secret
     and no account. Not rate limited: a delete cannot be used to fill anything
     up, and somebody who has decided to come off a public board should not be
     asked to wait. A row that was not there is a 200 and not a 404; the caller
     asked for it to be gone and it is gone. */
  if(method === 'DELETE'){
    const id = typeof body?.id === 'string' ? body.id.toLowerCase() : '';
    if(!ID_RE.test(id)) return { status: 400, body: { error: 'That board id does not look right.' } };
    const had = players[id] !== undefined;
    delete players[id];
    return { status: 200, body: { ...page(null), removed: had } };
  }

  return { status: 405, body: { error: 'The board answers GET, POST and DELETE only.' } };
}
