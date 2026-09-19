/* Duck Duck Quack — the shared leaderboard, from the browser's side.
 *
 * The rules all live on the server (`src/duck-board.js`); this is the thin
 * piece that posts what `stats.js` holds and reads back what everyone else
 * has. It is deliberately the only file in the game that knows the network
 * exists.
 *
 * Two things shape all of it:
 *
 *   The board is never load-bearing. Every best is written to this browser
 *   first and drawn from there, so a board that is down, blocked, or simply
 *   not deployed yet costs a player nothing except the list of other people.
 *   Every call below resolves — none of them throw at the caller — and the
 *   page says "out of reach" rather than showing an error where a game
 *   should be.
 *
 *   A post carries EVERY mark, not the one just made. That is what makes it
 *   self-healing: a post refused for being too soon, a level finished on a
 *   plane, a browser in private mode — none of them lose a score, because the
 *   next post that lands carries the lot and the server takes the maximum per
 *   level. It also means there is nothing to retry and no queue to keep.
 */

const URL_PATH = '/api/duck-duck-quack/board';

/* How long a fetched board is worth drawing before asking again. The front
   page is not a live scoreboard and nobody is watching it tick; a minute is
   short enough that a second player in the same house sees the first appear,
   and long enough that leaving the tab open all day is not a request a second. */
export const REFRESH_AFTER = 60 * 1000;

/* The longest a post will sit waiting out a rate limit before giving up and
   leaving it to the next one. It is a ceiling on a number the server sends,
   which is the only reason it exists: a server answering with an hour should
   not strand a timer in the page for an hour. */
export const MAX_RETRY_WAIT = 10000;

/* What went wrong, in words that can go straight on the page. The server sends
   its own for anything it understood; this is for the cases where there was no
   answer at all. */
export const OUT_OF_REACH = 'The shared board is out of reach right now.';

/* One call, with everything that can go wrong turned into a value.
 *
 * `ok` is the server's own ok. A refusal that the server explained (a name
 * taken, a figure it will not believe, too soon) comes back with `status` and
 * `error` so the caller can say which; a network failure comes back as
 * `status: 0`, which is the one case where the board being unreachable is not
 * the player's doing and should not be phrased as though it were. */
async function call(method, { body = null, query = '' } = {}){
  try{
    const res = await fetch(URL_PATH + query, {
      method,
      cache: 'no-store',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => null);
    if(!res.ok) return { ok: false, status: res.status, error: data?.error || OUT_OF_REACH, data };
    return { ok: true, status: res.status, data };
  }catch{
    return { ok: false, status: 0, error: OUT_OF_REACH, data: null };
  }
}

/* The board as it stands, and where `you` are on it if an id is given. */
export function fetchBoard({ you = null, limit = 10 } = {}){
  const query = `?limit=${encodeURIComponent(limit)}` + (you ? `&you=${encodeURIComponent(you)}` : '');
  return call('GET', { query });
}

/* Put a player's marks up.
 *
 * `bests` is the whole map, always — see the note at the top. A player with no
 * id (a browser with no crypto at all) is not an error and not a thing to
 * report: they keep their marks locally and simply are not on the board. */
export function postScores(id, name, bests){
  if(!id || !name) return Promise.resolve({ ok: false, status: 0, error: OUT_OF_REACH, data: null });
  return call('POST', { body: { id, name, bests } });
}

/* Take a row off the board. The id is the authority — whoever holds it holds
   the row — so this needs no password and no account. */
export function removeFromBoard(id){
  if(!id) return Promise.resolve({ ok: true, status: 200, data: null });
  return call('DELETE', { body: { id } });
}

/* Post a player's whole book and fold anything the board knew back into it.
 *
 * This is the one call the pages actually make: it is both halves of keeping
 * in step, and either half failing leaves the game exactly as it was. The fold
 * back is what refills a browser whose storage was cleared — the marks come
 * home from the board the next time that name is picked on that machine.
 *
 * (It does NOT let one person carry a name between two machines. A row belongs
 * to the id that made it, the id never leaves the browser that minted it, and
 * the second machine to claim a name is told the name is taken — see the 409
 * the pages report. Carrying a name would mean carrying the id, and there is
 * nothing in the game that moves one.)
 *
 * A refusal for being too soon is the one worth waiting out rather than
 * dropping. The window is five seconds and the server says exactly how much of
 * it is left, so this sleeps that long and posts once more. Without it, the
 * front page's post on load can land inside the window left by the run that
 * was just finished, get a 429, and leave a real score sitting unsent until
 * the player happens to finish another level — which is not what "the next
 * post carries the lot" is supposed to mean.
 */
export async function syncPlayer(stats, name, { retry = true } = {}){
  const id = stats.idFor(name);
  const reply = await postScores(id, name, stats.bests(name));
  if(reply.ok && reply.data?.you?.bests) stats.merge(name, reply.data.you.bests);

  if(!reply.ok && reply.status === 429 && retry){
    const wait = Math.min(Number(reply.data?.retryIn) || 0, MAX_RETRY_WAIT);
    await new Promise(resolve => setTimeout(resolve, wait + 250));
    return syncPlayer(stats, name, { retry: false });
  }
  return reply;
}
