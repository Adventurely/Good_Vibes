/* Duck Duck Quack — who has played, and how well.
 *
 * One number per player per level: the most ducklings that player has ever
 * got to the pond on it. Not a win/loss record and not a history — a level
 * lost with nine saved is a better nine than a level won with eight, and
 * the thing worth keeping is the high-water mark.
 *
 * This is the browser's own copy, and it is the one the game plays against:
 * every best is written here first, the level cards and the end-of-run line
 * read from here, and none of it waits on a network. `board.js` is what sends
 * it to the shared leaderboard afterwards, and it is allowed to fail — a
 * player on a train still gets their marks, and the next post carries them up.
 *
 * Each name also holds an id, which is what makes a row on that board theirs:
 * a UUID made here, kept here, never shown. One per NAME rather than one per
 * browser, because this game has always let a household keep several players
 * on one machine and pick between them, and two people sharing a laptop should
 * get a row each rather than take turns overwriting one.
 *
 * Everything below is a pure function over a plain object except the two that
 * touch storage, and those are the only two that can throw — private mode, a
 * full quota, a browser with storage switched off. Every one of them is
 * wrapped, and a failure reads as "no stats" rather than as a game that will
 * not start. A scoreboard is not worth a broken page.
 */

import { cleanName, nameKey, NAME_MIN, NAME_MAX, NAME_RULE } from './names.js';

export { cleanName, nameKey, NAME_MIN, NAME_MAX, NAME_RULE };

export const STORAGE_KEY = 'ddq-stats-v1';

/* A v4 UUID. `crypto.randomUUID` only exists where the page is a secure
   context, which the deployed site is and a laptop serving this to a phone
   over the house network is not — and a scoreboard that throws when you type
   your name there is worse than one with a home-made id. */
export function newId(){
  try{
    if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }catch{
    return null;   // no crypto at all: the marks are still kept, just not shared
  }
}

/* An empty book, and the shape everything below expects. */
const emptyBook = () => ({ current: null, players: {} });

/* One player's row as it is stored: an id for the board, and the marks. */
const emptyRow = () => ({ id: null, bests: {} });

/* Reads whatever is in storage into that shape, dropping anything that does
 * not fit rather than trusting it: this is user-editable data in a public key,
 * and every field is used to draw the page.
 *
 * It also takes the shape this file used before there was a server, where a
 * player was their marks and nothing else — `{ Ada: { park: 9 } }` rather than
 * `{ Ada: { id, bests } }`. Anyone who played in that fortnight keeps every
 * mark they made; the id is minted the next time they are picked.
 */
export function parseBook(raw){
  let saved = null;
  try{ saved = JSON.parse(raw); }catch{ return emptyBook(); }
  if(!saved || typeof saved !== 'object') return emptyBook();

  const players = {};
  for(const [name, stored] of Object.entries(saved.players ?? {})){
    const clean = cleanName(name);
    if(!clean || !stored || typeof stored !== 'object' || Array.isArray(stored)) continue;

    // The old shape put the marks straight on the player; the new one puts
    // them under `bests` beside an id.
    const hasNewShape = 'bests' in stored || 'id' in stored;
    const marks = hasNewShape ? stored.bests : stored;
    const row = emptyRow();
    if(typeof stored.id === 'string' && stored.id) row.id = stored.id;

    for(const [levelId, value] of Object.entries(marks ?? {})){
      const n = Math.floor(Number(value));
      if(Number.isFinite(n) && n > 0) row.bests[String(levelId)] = n;
    }
    players[clean] = row;
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

  /* The stored spelling of a name that is already known, or null. Lookups are
     case- and punctuation-insensitive so nobody ends up with two slots for one
     person, but what comes back is always the spelling first entered. */
  function find(name){
    const clean = cleanName(name);
    if(!clean) return null;
    const want = nameKey(clean);
    return Object.keys(book.players).find(k => nameKey(k) === want) ?? null;
  }

  const rowOf = name => {
    const known = find(name);
    return known ? book.players[known] : null;
  };

  return {
    /* Every name on this browser, best total first — which is the order the
       top ten wants and no worse an order for a picker. */
    players(){
      return Object.keys(book.players).sort((a, b) => total(b) - total(a) || a.localeCompare(b));
    },

    current(){ return book.current; },

    /* Picks a name, adding it if it is new. Returns the stored spelling, or
       null if the name is not one the board would take either — refused here
       rather than accepted here and refused there, which is the sort of split
       that has a player retyping a name that was never going to work. */
    use(name){
      const clean = cleanName(name);
      if(!clean) return null;
      const known = find(clean);
      const stored = known ?? clean;
      if(!known) book.players[stored] = emptyRow();
      // Minted on first use rather than on first score, so a player who picks
      // a name and closes the tab is the same player when they come back.
      if(!book.players[stored].id) book.players[stored].id = newId();
      book.current = stored;
      save();
      return stored;
    },

    /* The board id for a name, or null if there is none — which happens on a
       browser with no crypto at all, and means "keep the marks, skip the
       board" rather than anything the player has to hear about. */
    idFor(name){ return rowOf(name)?.id ?? null; },

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

    best(name, levelId){ return rowOf(name)?.bests[levelId] ?? 0; },

    /* Every level this player has a mark on, as { levelId: saved }. */
    bests(name){ return { ...(rowOf(name)?.bests ?? {}) }; },

    /* Files a finished run. Returns what happened, so the page can say "new
       best" rather than working it out a second time. */
    record(name, levelId, saved){
      const row = rowOf(name);
      const n = Math.floor(Number(saved));
      if(!row || !levelId || !Number.isFinite(n) || n <= 0){
        return { best: row ? (row.bests[levelId] ?? 0) : 0, improved: false };
      }
      const was = row.bests[levelId] ?? 0;
      if(n <= was) return { best: was, improved: false };
      row.bests[levelId] = n;
      save();
      return { best: n, improved: true };
    },

    /* Takes marks the shared board knows about that this browser does not.
     * Only ever upwards, so a stale server row cannot walk a fresh local one
     * back down, and a browser that lost its storage is refilled by the board
     * rather than starting again. Returns whether anything changed. */
    merge(name, bests){
      const row = rowOf(name);
      if(!row || !bests || typeof bests !== 'object') return false;
      let moved = false;
      for(const [levelId, value] of Object.entries(bests)){
        const n = Math.floor(Number(value));
        if(!Number.isFinite(n) || n <= 0) continue;
        if(n > (row.bests[levelId] ?? 0)){ row.bests[levelId] = n; moved = true; }
      }
      if(moved) save();
      return moved;
    },

    total(name){ return total(find(name)); },

    /* This browser's own top ten — the same ranking the shared board uses, so
       the two read alike, and what the front page falls back to when the board
       cannot be reached. Ranked on the total across every level, with the
       number of levels as the tie-break: thirty ducklings over five levels is
       a better showing than thirty over two. The alphabet settles anything
       still level so the order never wobbles between renders. */
    leaderboard(limit = 10){
      return Object.keys(book.players)
        .map(name => ({ name, total: total(name), levels: Object.keys(book.players[name].bests).length }))
        .filter(row => row.total > 0)
        .sort((a, b) => b.total - a.total || b.levels - a.levels || a.name.localeCompare(b.name))
        .slice(0, limit);
    },
  };

  function total(name){
    if(!name || !book.players[name]) return 0;
    return Object.values(book.players[name].bests).reduce((sum, n) => sum + n, 0);
  }
}
