/* What a Duck Duck Quack player may be called.
 *
 * This sits in public/ rather than in src/ because both ends need it and only
 * one end can reach the other: the client is served from here, the Worker is
 * bundled from src/ and can import across, and the alternative is the same
 * rules written twice. Two copies of a validator is two validators, and the
 * day they drift is the day a name the picker accepted is refused by the board
 * with no way for the player to tell what was wrong with it.
 *
 * So: one definition, imported by `stats.js` on the client and by
 * `src/duck-board.js` in the Worker. Nothing in here touches storage, the
 * network or the DOM, which is what makes that possible.
 *
 * The rules are Sunward's, near enough, and for the same reasons — see
 * `src/sunward-board.js` for the longer version. A board where one row is
 * forty characters of emoji is a board nobody else wants to be on.
 */

export const NAME_MIN = 2;
export const NAME_MAX = 16;

/* What a name may be made of: letters and digits in any script, the marks some
   scripts spell their letters with, and the few punctuation characters that
   turn up in real names. */
const NAME_CHARS = /^[\p{L}\p{N}\p{M} \-_.']+$/u;
const A_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/* The invisible ones: control and format characters. A zero-width space or a
   bidi override pasted into a name is a way to look like somebody else, so
   they come out silently — nobody types one on purpose. Whitespace is excepted
   even though a tab is a control character, because the next step collapses it
   to a space: "Ada<tab>Lovelace" should keep its gap, not lose it. */
const INVISIBLE = /(?!\s)[\p{Cc}\p{Cf}]/gu;

/* Tidy a typed name into the one that gets stored and shown, or null if it
 * does not fit.
 *
 * The invisible characters are stripped without comment and the visible ones
 * are not: a phone that autocorrects the apostrophe in O'Brien to a curly one
 * has done nothing the player can see, so that is mapped back; a player who
 * typed a star after their name can see it, and is told rather than quietly
 * edited. Length is counted in characters rather than UTF-16 units, so a name
 * in a script outside the first plane is not half as long as it looks.
 */
export function cleanName(raw){
  if(typeof raw !== 'string') return null;
  const name = raw
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if(!NAME_CHARS.test(name)) return null;
  if(!A_LETTER_OR_DIGIT.test(name)) return null;    // '---' is not a name
  const length = [...name].length;
  if(length < NAME_MIN || length > NAME_MAX) return null;
  return name;
}

/* A name for comparing rather than for showing: case folded, with the spaces
   and punctuation taken out, so "Ada Lovelace", "ada lovelace" and
   "AdaLovelace" are one player and not three. */
export const nameKey = name =>
  String(name).toLowerCase().replace(/[\s\-_.']/g, '');

/* Why a name was refused, in words that can go straight on the screen. */
export const NAME_RULE =
  `Names are ${NAME_MIN} to ${NAME_MAX} characters: letters, digits, spaces, and - _ . ' only.`;
