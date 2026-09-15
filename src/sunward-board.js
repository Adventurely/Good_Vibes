/* Sunward's leaderboard — the rules of it, and nothing else.
 *
 * Pure, the way content.js is pure: no I/O, no clock, no randomness. The time
 * comes in as an argument, the store comes in as an argument, and the whole of
 * the HTTP behaviour is one function, `serve`, that takes a method and a body
 * and hands back a status and an object. That is what lets the Durable Object
 * and the local route each be a dozen lines around it, and it is what lets
 * every case below be checked in Node without a socket anywhere near it.
 *
 * --- What it is, honestly ---------------------------------------------------
 *
 * A clicker's numbers live in the player's browser and nowhere else, so every
 * figure that arrives here is self-reported and there is no way to verify one.
 * There is no sign-in on this site by choice, so there is no account to hang a
 * reputation on either. What there is instead:
 *
 *   - a ceiling on each figure (LIMITS), which is the machine's own: a figure
 *     too big for JavaScript to hold exactly is refused, not clamped, so an
 *     honest client that has a bug hears about it. It is deliberately not a
 *     guess at what the game can produce — that guess was wrong, and it turned
 *     away the first real player;
 *   - a floor of fifteen seconds between accepted posts from one id, which is
 *     a rate limit and not a defence, and is described as one;
 *   - a record that only ever goes up, per figure, so a stale tab cannot walk
 *     somebody's best back down;
 *   - a cap on how many rows are kept at all, with the ones nobody would ever
 *     see pruned first.
 *
 * Somebody who wants to sit at the top with a number nobody could reach can,
 * and the board will show it. This is a leaderboard for a hobby site: it is
 * for people who want to be on one, and the README says so in as many words.
 *
 * --- Identity -----------------------------------------------------------------
 *
 * The id is a UUID the browser makes once and keeps in localStorage; whoever
 * holds it can update that row and nobody else can. It is the room-code idea
 * again — the secret is the token, not a login — and the public shape of the
 * board never carries it, so reading the board tells you nobody's.
 */

/* ---------------------------------------------------------------- the four */

/* Which counters have a board. Four rather than the record's ten, because the
   others are either derived from these or are only interesting to the player
   who made them — nobody wants a leaderboard of energy spent. */
export const BOARD_KEYS = ['taps', 'winters', 'earned', 'peakTaps'];

/* How the board names them in a refusal. Not imported from content.js: this
   module runs inside the Worker, and the client's tables are 400 KB of shop
   the board has no use for. Four strings is cheaper than the coupling. */
export const LABELS = {
  taps: 'Taps',
  winters: 'Winters',
  earned: 'Energy earned',
  peakTaps: 'Best taps per second',
};

/* The ceiling on each figure, and it is the machine's rather than a guess at
 * the game's.
 *
 * These were plausibility caps once — thirty taps a second, fifty million taps
 * — and the first person to play the finished game was refused by them on the
 * first evening. Eight fingers drumming on a tablet is fifty a second without
 * trying, and the figure the board was judging is a ten-second average, not a
 * burst. A cap pitched at what somebody guessed the game could do is a cap
 * that turns away the player it was built for, and the cost of guessing too
 * low is a real person told their real score is a lie, where the cost of
 * guessing too high is one silly row on a hobby leaderboard. That is not a
 * close trade.
 *
 * So the only ceiling left is the one JavaScript itself imposes:
 *
 *   the two counts stop at Number.MAX_SAFE_INTEGER, because past it whole
 *   numbers are no longer exact — 2^53 and 2^53 + 1 are the same number, so
 *   "a record only ever goes up" quietly stops meaning anything, and
 *   `Number.isInteger` starts agreeing with figures that arrived as 1e21;
 *
 *   the two measures stop at Number.MAX_VALUE, which is to say they stop only
 *   where a float stops being a float at all. Anything finite and not negative
 *   is taken.
 *
 * What still gets refused is a figure that is broken rather than big: not a
 * number, not finite, below zero, or a count with a fraction in it. */
export const LIMITS = {
  taps: Number.MAX_SAFE_INTEGER,
  winters: Number.MAX_SAFE_INTEGER,
  earned: Number.MAX_VALUE,
  peakTaps: Number.MAX_VALUE,
};

/* Which of the four are counts. A count with a fraction in it is a client
   that has gone wrong, and the honest answer to that is a refusal it can read
   rather than a Math.floor that hides it. */
export const INTEGER_KEYS = ['taps', 'winters'];

/* ----------------------------------------------------------------- the name */

export const NAME_MIN = 2;
export const NAME_MAX = 16;

/* What a name may be made of: letters and digits in any script, the marks
   that some scripts spell their letters with, and the few punctuation
   characters names actually contain. Nothing else — not because a heart
   would break anything, but because a board with one emoji on it is a board
   with forty on it by the weekend, and the names are all that show. */
const NAME_CHARS = /^[\p{L}\p{N}\p{M} \-_.']+$/u;
const A_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
// Control characters and format characters: the invisible ones. A zero-width
// space or a bidi override pasted into a name is a way to look like somebody
// else, so they are stripped rather than refused — nobody types one on purpose.
// Whitespace is excepted, although a tab is a control character too: it is
// collapsed to a space in the next step rather than deleted, so "Finn<tab>the
// Hand" keeps its gap instead of becoming "Finn theHand".
const INVISIBLE = /(?!\s)[\p{Cc}\p{Cf}]/gu;

/* Tidy a typed name into one the board will show, or null if it does not fit.
 *
 * The invisible characters are stripped silently and the visible ones are not:
 * a phone that autocorrects the apostrophe in O'Brien to a curly one has done
 * nothing the player can see, so that is mapped back; a player who typed a
 * star after their name can see it, and is told rather than quietly edited.
 * Length is counted in characters rather than in UTF-16 units so a name in a
 * script outside the first plane is not half as long as it looks. */
export function cleanName(raw){
  if(typeof raw !== 'string') return null;
  const name = raw
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if(!NAME_CHARS.test(name)) return null;
  if(!A_LETTER_OR_DIGIT.test(name)) return null;   // '---' is not a name
  const length = [...name].length;
  if(length < NAME_MIN || length > NAME_MAX) return null;
  return name;
}

/* ------------------------------------------------------------------- the id */

/* A UUID, either case. The client makes one with crypto.randomUUID and never
   shows it to the player, so anything else arriving here is not a player. */
export const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* --------------------------------------------------------------- the limits */

/* Between accepted posts from one id. The client posts when the record is
   opened and on a timer after that; fifteen seconds is short enough that a
   player watching the board sees their own row move, and long enough that a
   loop hammering it is refused for the whole of every second but one. */
export const MIN_INTERVAL = 15000;

/* How many rows are kept. Not how many can be on a board — that is MAX_TOP —
   but how many ids the object remembers at all, so that ten thousand tabs
   opened by one script do not become a store that grows without a ceiling.
   Five thousand rows is under a megabyte, which matters: the object keeps
   them under one storage key, and a key has a size. */
export const MAX_PLAYERS = 5000;

/* How long a board is by default, and the most a caller may ask for. A
   hundred is the depth the pruning protects — see `merge` — so asking for a
   hundred always gets a hundred that were kept on purpose. */
export const TOP = 10;
export const MAX_TOP = 100;

/* The most a POST body may be. Four kilobytes holds an id, a name at its
   longest in the widest script, and four numbers, with room for the client
   to grow a field or two; anything bigger is not a score. Enforcing it is the
   caller's job — the body has to be read before this module ever sees it —
   which is why the reply is exported here rather than written twice. */
export const MAX_BODY = 4096;
export const TOO_LARGE = { status: 413, body: { error: 'That is more than the board will take in one go.' } };
export const BAD_JSON = { status: 400, body: { error: 'That was not JSON.' } };

/* ------------------------------------------------------------------ validate */

const NAME_RULE = `Names are ${NAME_MIN} to ${NAME_MAX} characters: letters, digits, spaces, and - _ . ' only.`;

/* Turn a number as posted into a number, or NaN if it was not one. JSON
   carries numbers as numbers, so a string here is a client doing something
   odd — but "12" meaning twelve is not odd enough to refuse. A boolean is:
   true meaning one tap is a bug, not a score. Absent means nothing yet. */
function coerce(value){
  if(value === undefined || value === null) return 0;
  if(typeof value === 'number') return value;
  if(typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

/* Check a posted body and hand back a clean entry, or say what was wrong with
 * it in words the client can put on the screen. Missing stats are zero — a
 * player who has only just started is allowed to be on the board with
 * nothing on it yet — and unknown keys are dropped, not refused, so a newer
 * client posting a fifth figure to an older board still gets its four in. */
export function validate(body){
  if(!body || typeof body !== 'object' || Array.isArray(body)){
    return { ok: false, error: 'That did not look like a score.' };
  }
  if(typeof body.id !== 'string' || !ID_RE.test(body.id)){
    return { ok: false, error: 'That board id does not look right.' };
  }
  const name = cleanName(body.name);
  if(name === null) return { ok: false, error: NAME_RULE };

  const raw = body.stats ?? {};
  if(typeof raw !== 'object' || Array.isArray(raw)){
    return { ok: false, error: 'Those stats did not look right.' };
  }
  const stats = {};
  for(const key of BOARD_KEYS){
    const value = coerce(raw[key]);
    if(!Number.isFinite(value) || value < 0){
      return { ok: false, error: `${LABELS[key]} must be a number, zero or more.` };
    }
    if(INTEGER_KEYS.includes(key) && !Number.isInteger(value)){
      return { ok: false, error: `${LABELS[key]} must be a whole number.` };
    }
    if(value > LIMITS[key]){
      return { ok: false, error: `${LABELS[key]} is above the highest figure this board takes.` };
    }
    stats[key] = value;
  }
  // UUIDs are case-insensitive by definition, and a client that sends one in
  // capitals on Tuesday and lower case on Wednesday should not be two rows.
  return { ok: true, entry: { id: body.id.toLowerCase(), name, stats } };
}

/* --------------------------------------------------------------------- merge */

/* Fold an entry into the store, or refuse it as too soon. Mutates `players`.
 *
 * Every figure takes the maximum of what was there and what arrived: a record
 * never goes down, so a second tab with an older save cannot undo the first,
 * and neither can a player who has replanted and now has fewer of something
 * on the run than they had all time. The name is the exception — it is not a
 * record, it is what the player wants to be called today.
 *
 * The rate limit is a window, not a budget. Refusing anything inside fifteen
 * seconds of the last accepted post from an id is enough to make a loop
 * pointless, and `retryIn` tells an honest client exactly how long to wait
 * rather than leaving it to guess and be refused again. A clock that has gone
 * backwards — a restored object, a laptop's sleep — would make that wait
 * longer than the window itself, and rather than lock a player out until the
 * clock catches up, a wait that long is treated as no wait at all. */
export function merge(players, entry, now){
  const old = players[entry.id];
  if(old){
    const wait = MIN_INTERVAL - (now - old.at);
    if(wait > 0 && wait <= MIN_INTERVAL) return { ok: false, error: 'Too soon.', retryIn: wait };
  }

  const stats = {};
  for(const key of BOARD_KEYS){
    stats[key] = Math.max(old?.stats?.[key] || 0, entry.stats[key] || 0);
  }
  players[entry.id] = { name: entry.name, stats, at: now, since: old?.since ?? now };

  prune(players, entry.id);
  return { ok: true };
}

/* Bring the store back under MAX_PLAYERS, if it has gone over.
 *
 * Anyone in the top hundred of any board is kept, because they are the board;
 * so is the row that was just written, because refusing a post and then
 * forgetting it is worse than either alone. Of the rest, the ones nobody has
 * heard from for longest go first — a row that has not been posted to in a
 * month is a browser that cleared its storage, or a player who stopped. */
function prune(players, keep){
  let over = Object.keys(players).length - MAX_PLAYERS;
  if(over <= 0) return;

  const safe = new Set([keep]);
  for(const key of BOARD_KEYS){
    for(const row of rank(players, key, MAX_TOP)) safe.add(row.id);
  }
  const doomed = Object.keys(players)
    .filter(id => !safe.has(id))
    .sort((a, b) => (players[a].at - players[b].at) || (a < b ? -1 : 1));
  for(const id of doomed){
    if(over <= 0) break;
    delete players[id];
    over--;
  }
}

/* ---------------------------------------------------------------------- rank */

/* One board, longest first. Zero is not on a board: a player who has never
 * replanted is not in last place on winters, they are simply not on it, and a
 * board of five thousand zeros would say nothing. Ties go to whoever got
 * there first, then to the id, so the order is the same on every read and
 * two players with the same figure do not swap places on refresh. */
export function rank(players, key, limit = TOP){
  return Object.entries(players)
    .filter(([, p]) => (p.stats?.[key] || 0) > 0)
    .sort(([ida, a], [idb, b]) =>
      (b.stats[key] - a.stats[key]) || (a.since - b.since) || (ida < idb ? -1 : 1))
    .slice(0, limit)
    .map(([id, p]) => ({ id, name: p.name, value: p.stats[key] }));
}

/* --------------------------------------------------------------------- boards */

/* The public shape. No ids anywhere in it — the id is the secret that lets a
 * player update their row, so a response that carried everyone's would hand
 * every row to everyone. `you` is where the asking player stands on each
 * board over ALL players, not only the ones shown, so a player in 400th
 * place is told 400th rather than nothing. */
export function boards(players, { limit = TOP, you = null } = {}){
  const out = { boards: {}, players: Object.keys(players).length, you: {} };
  for(const key of BOARD_KEYS){
    const full = rank(players, key, Infinity);
    out.boards[key] = full.slice(0, limit).map(({ name, value }) => ({ name, value }));
    const at = you ? full.findIndex(row => row.id === you) : -1;
    out.you[key] = at < 0 ? null : at + 1;
  }
  return out;
}

/* ---------------------------------------------------------------------- serve */

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/* Everything the route does, as a function of what came in.
 *
 * `store` is `{ players }` and is mutated in place — the caller owns
 * persistence and knows whether anything changed by the status. `body` is the
 * parsed JSON for a POST, already read and already under MAX_BODY; that has
 * to happen before parsing and so cannot happen here. Returns `{ status, body }`
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
    if(!merged.ok) return { status: 429, body: { error: merged.error, retryIn: merged.retryIn } };
    return { status: 200, body: page(checked.entry.id) };
  }

  /* Taking your own row off again. The id is the authority here exactly as it
     is for writing — whoever holds it holds the row — so this needs no secret
     and no account, and there is nothing an attacker gains from an id they
     would have to already hold. It is not rate limited: a delete cannot be
     used to fill anything up, and somebody who has decided to come off a
     public board should not be asked to wait.

     A row that was not there is a 200 and not a 404. The caller asked for it
     to be gone and it is gone; `removed` says whether anything was actually
     there, for a caller that wants to know. */
  if(method === 'DELETE'){
    const id = typeof body?.id === 'string' ? body.id.toLowerCase() : '';
    if(!ID_RE.test(id)) return { status: 400, body: { error: 'That board id does not look right.' } };
    const had = players[id] !== undefined;
    delete players[id];
    return { status: 200, body: { ...page(null), removed: had } };
  }

  return { status: 405, body: { error: 'The board answers GET, POST and DELETE only.' } };
}
