/* Enemies, their telegraph, and how a wave is built. */

import { AILMENTS } from './effects.js';
import { PARTY_SIZE } from './party.js';
import { BOSS_ROUND } from './phases.js';
import { hasEffect } from './record.js';


/* What comes out of the blight when it surges.
 *
 * An enemy is authored by its health and its damage, and it is *there*. There
 * used to be a `dist` as well — a count of rounds before it arrived — and the
 * fight was a lane the wave walked down while the party shot at it. That made
 * the opening turns free and the closing turns crowded, and it meant the most
 * interesting decision in a fight was often "which of these is closest".
 *
 * A surge is a standoff now, the way Slay the Spire's fights are: the party on
 * one side, the wave on the other, everything present from the first turn and
 * everything acting on every one of them. Nothing on the field moves, so
 * everything that happens on it is a card somebody played.
 *
 * What replaced the tension of an approach is the telegraph — see `intentOf`.
 * You cannot see a monster coming any more; you can see what it is about to do,
 * which is a decision rather than a countdown.
 *
 * The wave tables are per round, boss last. Composition over stat scaling —
 * a later round sends more and worse things rather than the same thing with
 * a bigger number, because "there are four of them now" is legible on a
 * screen in a way "+2 hp" never is.
 */
/* `ability` is what this thing does to a player beyond subtracting from them,
 * and `every` is how many of its hits have to land first — an ailment on every
 * swing is not a threat, it is a status the player simply has. A blocked hit
 * never counts, which is the whole reason to spend a card on guard against a
 * Creeper rather than trading with it.
 *
 * `threat` is the levelling number: what one of these is worth against one
 * player. It is what waveFor spends, so a table of four meets four players'
 * worth of blight rather than five players' worth trimmed down to four.
 */
export const ENEMIES = {
  sporeling: { name: 'Sporeling', hp: 6, hits: 2, art: 'sporeling',
    threat: 1, ability: { id: 'rot', every: 2 },
    note: 'A puffball with intent. Pops wetly, and you breathe what comes out.' },
  creeper: { name: 'Creeper', hp: 10, hits: 3, art: 'creeper',
    threat: 2, ability: { id: 'weak', every: 2 },
    note: 'Vine over bone over something that used to be a drone. The sap gets into you.' },
  hulk: { name: 'Rust Hulk', hp: 18, hits: 5, art: 'hulk',
    threat: 3.5, ability: { id: 'stun', every: 3 },
    note: 'A maintenance chassis the blight wears like a coat. It swings like one too.' },
  extractor: { name: 'The Extractor', hp: 22, hits: 2, art: 'extractor', boss: true,
    threat: 9, ability: { id: ['weak', 'rot', 'stun'], every: 2 },
    note: 'It was built to harvest. It still is, and it works through a crew in order.' },
};

/* The boss is the one enemy the wave table cannot level, because there is
 * always exactly one of it. Everything else scales by arriving in different
 * numbers; the Extractor has to scale in the only direction left, which is up.
 *
 * Health scales because three people put out three people's damage. Damage
 * scales for a subtler reason: a single enemy hits one player a round, so at a
 * table of three the same number is a third of the pressure it is on a table of
 * one. Holding per-player pressure flat means the number climbs with the table
 * — an Extractor that hit a party of five for what it hits a solo player for
 * would be a cutscene.
 *
 * Both are per *extra* player, so ENEMIES holds the solo fight and this holds
 * how it grows.
 */
export const BOSS_SCALING = { hp: 24, hits: 2.1 };

/* An enemy's numbers for this table. Everything but the boss is what the table
   says it is; levelling the rest is waveFor's job and doing it twice would
   compound. */
export function enemyStats(type, partySize = PARTY_SIZE){
  const def = ENEMIES[type];
  if(!def) return null;
  const extra = Math.max(0, Math.min(PARTY_SIZE, Math.max(1, partySize)) - 1);
  return def.boss
    ? { hp: Math.round(def.hp + BOSS_SCALING.hp * extra),
        hits: Math.round(def.hits + BOSS_SCALING.hits * extra) }
    : { hp: def.hp, hits: def.hits };
}

/* ---- the telegraph ------------------------------------------------------
 *
 * What this enemy will do at the end of this round, so a player can decide
 * against it rather than guess.
 *
 * This is Slay the Spire's intent, and it is what a standoff needs in place of
 * an approach. When the wave walked toward you, the interesting information was
 * spatial and free — you could see the Rust Hulk was two rounds out. Standing
 * still it has no way to tell you anything, and a fight where every turn is the
 * same unreadable exchange is a fight you play by arithmetic.
 *
 * Derived, never stored: it is `hits` plus whatever the *next* landed blow
 * would leave behind, read off the same counter advanceWave uses. So the
 * telegraph cannot drift from what actually happens — there is no second copy
 * of the rule, only a lookahead on the first one.
 *
 * `ail` is what that blow lands *if it gets through*. Guard eating the blow
 * whole is what stops it, which is exactly the decision the telegraph exists to
 * offer: this one is about to weaken somebody, and a ward is how you refuse.
 */
export function intentOf(enemy, targets){
  if(!enemy || enemy.hp <= 0) return null;
  return {
    damage: enemy.hits,
    ail: ailmentOnHit(enemy.type, (enemy.landed || 0) + 1),
    at: targets ? (targets.get(enemy.id) || null) : null,
  };
}

/* Who each living enemy is about to hit.
 *
 * The round-robin was always deterministic — enemy i takes standing[i % n] —
 * but until the Hauler there was nothing anybody could do about it, so it was
 * never worth printing. Cover changes that, and the moment two rules could
 * disagree about who gets hit they have to become one rule: advanceWave walks
 * this list rather than keeping a counter of its own.
 *
 * `offset` rotates the starting seat each round. Without it seat one takes the
 * first blow of every round for the whole fight, which was invisible while the
 * wave arrived a piece at a time and is glaring now that all of it swings at
 * once — with two enemies and three seats, seat three was never hit.
 *
 * The coverer's guard is spent as the loop goes, exactly as the wave spends
 * it, so the telegraph tells the truth about where cover stops holding.
 */
export function waveTargets(enemies, standing, offset = 0){
  const at = new Map();
  const live = (standing || []).filter(p => !p.down);
  if(!live.length) return at;

  const coverer = live.find(p => hasEffect(p.effects, 'cover'));
  let guard = coverer ? (coverer.block || 0) : 0;
  let turn = offset;

  for(const enemy of enemies || []){
    if(enemy.hp <= 0) continue;
    if(coverer && guard > 0){
      at.set(enemy.id, coverer.id);
      guard -= Math.min(guard, enemy.hits);
      continue;
    }
    /* The counter does not advance while somebody is covering, so when the
       guard breaks the wave picks up where it left off rather than skipping
       the seats it never reached. */
    at.set(enemy.id, live[(turn++ % live.length + live.length) % live.length].id);
  }
  return at;
}

/* The ailment cadence, normalised: one id or a list, always a list here, so
   the boss cycling through all three and a Sporeling doing one thing are the
   same loop at the call site. */
export function enemyAbility(type){
  const spec = (ENEMIES[type] || {}).ability;
  if(!spec) return null;
  const ids = (Array.isArray(spec.id) ? spec.id : [spec.id]).filter(id => AILMENTS[id]);
  if(!ids.length) return null;
  return { ids, every: Math.max(1, spec.every || 1) };
}

/* Which ailment this enemy's nth landed hit carries, or null. Pure arithmetic
   on a counter the room keeps, rather than a roll: a wave that surprises you
   differently on a replay is a wave the room and the client can disagree
   about. */
export function ailmentOnHit(type, landed){
  const spec = enemyAbility(type);
  if(!spec || landed <= 0 || landed % spec.every) return null;
  return spec.ids[(landed / spec.every - 1) % spec.ids.length];
}

/* ---- levelling the encounter to the table ------------------------------- */

/* What one player is worth in blight, by round. This is the difficulty dial,
 * and it is the only one: everything else about a wave falls out of it.
 *
 * Held deliberately low on round one and climbing after, because the party's
 * side of the equation climbs too — the Alchemist has brewed by round two and
 * the Engineer has a panel behind the bolt gun.
 *
 * These are measured, not guessed. test/balance.mjs plays five hundred whole
 * runs per table size against them and reports the win rate; at the numbers
 * below it lands
 *
 *     1 player  53%   2 players  65%   3 players  61%
 *     4 players 54%   5 players  62%
 *
 * against a target of 60 — every size inside seven points of it.
 *
 * That is a better number than it looks, and the reason is worth keeping. The
 * harness used to seat the first N classes in roster order, so every
 * three-player measurement was the Alchemist, the Engineer and the Wizard, and
 * every two-player one was the two of them without her — and she is the party's
 * damage by design. The curve it drew was mostly a picture of who happened to
 * be sitting down: two read hardest and three easiest at every setting, however
 * these dials moved, and a whole tuning pass can be spent chasing that and
 * finding nothing. It rotates the roster by the run index now, so each size
 * averages over every composition, and the number means what it says.
 *
 * Change them with the harness open rather than by eye — the threat values are
 * coarse (1, 2, 3.5), so a tenth of a point here can flip a whole enemy into or
 * out of a wave and move a win rate forty points. Measured, repeatedly.
 *
 * The Extractor's own `hits` is the sharpest edge in the file: at a table of
 * one it is the only thing swinging, so three to four took solo from 72% to 6%.
 * Round four's number is low because it buys the boss's *escort* only; the
 * Extractor is outside the budget and scales on BOSS_SCALING instead. That is
 * also why nearly every loss the harness reports is a round-four loss — the
 * first three rounds rarely kill a party outright, they decide what the party
 * brings to the appointment.
 *
 * One shape to know before touching anything: `waveTargets` rotates which seat
 * the wave opens on each round, and that rotation is worth most to a party with
 * a handful of seats and few enemies. It is worth nothing to a solo player.
 */
export const THREAT_PER_PLAYER = [1.4, 1.8, 2.1, 1.0];

/* A party is worth more than the players in it, and the budget has to know it.
 *
 * This was linear first, and the harness was blunt about it: at settings that
 * left a solo player winning three runs in five, two players won ninety-seven.
 * Doubling the wave does not double the difficulty, because the second player
 * brings things a lone player has no version of — somebody to spread the
 * round-robin over, a second class's whole verb, a card that mends a person
 * who is not themselves, and the plain fact that a party can lose a member and
 * keep fighting where a solo player losing one is the run.
 *
 * So each player after the first makes every player worth more blight. The
 * number is measured, not reasoned: it is what closes the gap between the
 * table sizes in test/balance.mjs.
 */
export const PARTY_SYNERGY = 0.10;

/* How much blight a table of this size meets this round. */
export function threatBudget(round, partySize = PARTY_SIZE){
  const size = Math.max(1, Math.min(PARTY_SIZE, partySize));
  const per = THREAT_PER_PLAYER[Math.min(round, BOSS_ROUND) - 1] ?? THREAT_PER_PLAYER[0];
  return per * size * (1 + PARTY_SYNERGY * (size - 1));
}

/* What each round sends, in the order it sends it. The list is a pattern and
   not a wave: waveFor cycles it until the budget is spent, so the composition
   of a round is the same shape at every table size and only the amount of it
   changes. */
const WAVE_PATTERN = {
  1: ['sporeling', 'sporeling', 'creeper'],
  2: ['sporeling', 'creeper', 'creeper', 'sporeling'],
  3: ['creeper', 'hulk', 'creeper', 'sporeling'],
  [BOSS_ROUND]: ['creeper', 'sporeling', 'creeper', 'hulk'],
};

/* Six is what the lane can show. Beyond it the sprites share rows and the
   wave reads as one smear, so a bigger budget makes the wave *worse* rather
   than longer — see the upgrade pass below. */
export const WAVE_CAP = 6;

/* The ladder a leftover budget climbs. Ordered by threat, so "spend the
   remainder on making the weakest thing here worse" is a walk down one list. */
const TIERS = ['sporeling', 'creeper', 'hulk'];

/* The wave a given table meets on a given round.
 *
 * Two passes, and the second one is what makes a full table harder rather than
 * merely busier. First fill: cycle the round's pattern, adding while the
 * budget covers the next thing and the lane has room. Then upgrade: whatever
 * budget is left promotes the weakest enemy present up the tier ladder.
 *
 * So a solo player on round one meets two Sporelings; five players meet a
 * fuller lane of worse things. Same fight, levelled — not the five-player
 * fight with three of them deleted, which is what trimming a fixed table gave
 * and why a lone player used to walk it.
 *
 * The boss is outside the budget entirely. It is the appointment, it is in
 * every version of round four, and the budget buys its escort.
 */
export function waveFor(round, partySize = PARTY_SIZE){
  const at = Math.min(Math.max(1, round), BOSS_ROUND);
  const pattern = WAVE_PATTERN[at] || WAVE_PATTERN[BOSS_ROUND];
  const boss = at >= BOSS_ROUND;
  const wave = boss ? ['extractor'] : [];
  const room = WAVE_CAP - wave.length;

  let budget = threatBudget(at, partySize);
  for(let i = 0; wave.length - (boss ? 1 : 0) < room; i++){
    const type = pattern[i % pattern.length];
    const cost = ENEMIES[type].threat;
    if(cost > budget){
      // Nothing in a whole pass fits: the budget is spent on filling.
      if(pattern.every(t => ENEMIES[t].threat > budget)) break;
      continue;
    }
    budget -= cost;
    wave.push(type);
  }

  // A wave of nothing is not a round. The cheapest thing in the pattern goes
  // in regardless — a budget too small to buy a Sporeling means the table is
  // one person on round one, and they should still have something to fight.
  if(!wave.length) wave.push(pattern[0]);

  // The remainder, spent on quality. Weakest first and one at a time, so the
  // lane levels evenly: five players get a Rust Hulk where one player gets the
  // Sporeling that stood in its place, rather than one monster at the front
  // absorbing the entire difference.
  for(let pass = 0; pass < WAVE_CAP * TIERS.length; pass++){
    let pick = -1, pickTier = TIERS.length;
    for(let i = 0; i < wave.length; i++){
      const tier = TIERS.indexOf(wave[i]);
      if(tier < 0 || tier + 1 >= TIERS.length) continue;
      if(ENEMIES[TIERS[tier + 1]].threat - ENEMIES[wave[i]].threat > budget) continue;
      if(tier < pickTier){ pick = i; pickTier = tier; }
    }
    if(pick < 0) break;
    const next = TIERS[pickTier + 1];
    budget -= ENEMIES[next].threat - ENEMIES[wave[pick]].threat;
    wave[pick] = next;
  }

  return wave;
}
