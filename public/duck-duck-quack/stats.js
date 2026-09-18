/* Duck Duck Quack — who has played, and how well.
 *
 * One number per player per level: the most ducklings that player has ever
 * got to the pond on it. Not a win/loss record and not a history — a level
 * lost with nine saved is a better nine than a level won with eight, and
 * the thing worth keeping is the high-water mark.
 *
 * It lives in this browser's localStorage and goes nowhere else. There is
 * no account, no server and no sync: a name here is a label on a slot on
 * one machine, which is why anyone can pick anyone else's name off the list
 * and why nothing about it is protected. The front page says as much.
 *
 * Everything below is a pure function over a plain object except the two
 * that touch storage, and those are the only two that can throw — private
 * mode, a full quota, a browser with storage switched off. Every one of
 * them is wrapped, and a failure reads as "no stats" rather than as a game
 * that will not start. A scoreboard is not worth a broken page.
 */

export const STORAGE_KEY = 'ddq-stats-v1';

/* The longest a name can be. Long enough for a real one, short enough that
   the top-ten list stays a list rather than a wrapping paragraph. */
export const NAME_MAX = 16;

/* Tidies a typed name into the one that gets stored, or null if there is
   nothing there. Whitespace collapses, the ends come off, and the length is
   capped — but the case is kept exactly as typed, because "ada" and "Ada"
   are the same player and the one who typed it gets to say which it looks
   like. */
export function cleanName(raw){
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return name || null;
}

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

/* An empty book, and the shape everything below expects. */
const emptyBook = () => ({ current: null, players: {} });

/* Reads whatever is in storage into that shape, dropping anything that does
   not fit rather than trusting it: this is user-editable data in a public
   key, and every field is used to draw the page. */
export function parseBook(raw){
  let saved = null;
  try{ saved = JSON.parse(raw); }catch{ return emptyBook(); }
  if(!saved || typeof saved !== 'object') return emptyBook();

  const players = {};
  for(const [name, scores] of Object.entries(saved.players ?? {})){
    const clean = cleanName(name);
    if(!clean || !scores || typeof scores !== 'object') continue;
    const best = {};
    for(const [levelId, value] of Object.entries(scores)){
      const n = Math.floor(Number(value));
      if(Number.isFinite(n) && n > 0) best[String(levelId)] = n;
    }
    players[clean] = best;
  }

  const current = cleanName(saved.current);
  return { current: current && players[current] ? current : null, players };
}

/* The whole scoreboard for one browser. `storage` is anything with
   getItem/setItem — localStorage in the game, a plain object in a test. */
export function createStats(storage = globalThis.localStorage){
  let book = emptyBook();
  try{ book = parseBook(storage?.getItem(STORAGE_KEY)); }catch{ /* no storage, no stats */ }

  function save(){
    try{ storage?.setItem(STORAGE_KEY, JSON.stringify(book)); }
    catch{ /* full, private, or switched off — the run still counts in memory */ }
  }

  /* The stored spelling of a name that is already known, or null. Lookups
     are case-insensitive so nobody ends up with two slots for one person,
     but what comes back is always the spelling that was first entered. */
  function find(name){
    const clean = cleanName(name);
    if(!clean) return null;
    return Object.keys(book.players).find(k => sameName(k, clean)) ?? null;
  }

  return {
    /* Every name on this browser, best total first — which is the order the
       top ten wants and no worse an order for a picker. */
    players(){
      return Object.keys(book.players).sort((a, b) => total(b) - total(a) || a.localeCompare(b));
    },

    current(){ return book.current; },

    /* Picks a name, adding it if it is new. Returns the stored spelling, or
       null if the name was empty. */
    use(name){
      const clean = cleanName(name);
      if(!clean) return null;
      const known = find(clean);
      const stored = known ?? clean;
      if(!known) book.players[stored] = {};
      book.current = stored;
      save();
      return stored;
    },

    /* Stops tracking against anybody, without forgetting them. */
    clearCurrent(){
      book.current = null;
      save();
    },

    forget(name){
      const known = find(name);
      if(!known) return false;
      delete book.players[known];
      if(book.current === known) book.current = null;
      save();
      return true;
    },

    best(name, levelId){
      const known = find(name);
      return known ? (book.players[known][levelId] ?? 0) : 0;
    },

    /* Every level this player has a mark on, as { levelId: saved }. */
    bests(name){
      const known = find(name);
      return known ? { ...book.players[known] } : {};
    },

    /* Files a finished run. Returns what happened, so the page can say
       "new best" rather than working it out a second time. */
    record(name, levelId, saved){
      const known = find(name);
      const n = Math.floor(Number(saved));
      if(!known || !levelId || !Number.isFinite(n) || n <= 0){
        return { best: known ? (book.players[known]?.[levelId] ?? 0) : 0, improved: false };
      }
      const was = book.players[known][levelId] ?? 0;
      if(n <= was) return { best: was, improved: false };
      book.players[known][levelId] = n;
      save();
      return { best: n, improved: true };
    },

    total(name){ return total(find(name)); },

    /* The top ten, or however many there are. Ranked on the total across
       every level, with the number of levels a player has a mark on as the
       tie-break — thirty ducklings over five levels is a better showing
       than thirty over two, and the alphabet settles anything still level
       so the order never wobbles between renders. */
    leaderboard(limit = 10){
      return Object.keys(book.players)
        .map(name => ({
          name,
          total: total(name),
          levels: Object.keys(book.players[name]).length,
        }))
        .filter(row => row.total > 0)
        .sort((a, b) => b.total - a.total || b.levels - a.levels || a.name.localeCompare(b.name))
        .slice(0, limit);
    },
  };

  function total(name){
    if(!name || !book.players[name]) return 0;
    return Object.values(book.players[name]).reduce((sum, n) => sum + n, 0);
  }
}
