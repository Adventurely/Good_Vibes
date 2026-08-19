/* The run's record, and the effect list a player carries. */

import { AILMENTS } from './effects.js';


/* What each seat did over a whole run, kept so the end of it can say
 * something. A run that ends on "you lost" and a blank screen is a run nobody
 * can tell a story about afterwards — and in a co-op game the story is who did
 * what, which nobody can reconstruct from a log that scrolled past four rounds
 * ago.
 *
 * Six numbers, chosen because each one is a different seat's answer to "was I
 * useful": the Wizard's is damage, the Engineer's is guard, the Alchemist's is
 * mending, and taken is the one nobody sets out to lead.
 */
export const STAT_LABELS = {
  damage: 'Damage dealt',
  kills: 'Blight put down',
  guard: 'Guard raised',
  mended: 'Health restored',
  revived: 'Allies picked up',
  taken: 'Damage taken',
};

/* The same six, as column headings. A medal has a whole row to itself and can
   afford the sentence; a table of seven columns cannot, and a header that
   wraps to three lines is worse than a short word. */
export const STAT_SHORT = {
  damage: 'Damage',
  kills: 'Kills',
  guard: 'Guard',
  mended: 'Mended',
  revived: 'Revives',
  taken: 'Taken',
};

export const STAT_KEYS = Object.keys(STAT_LABELS);

export const blankStats = () =>
  Object.fromEntries(STAT_KEYS.map(key => [key, 0]));

/* Who led each stat, as { key, label, player, value } rows in STAT_KEYS order.
 *
 * Ties go to the earlier seat and rows nobody scored on are dropped, so a solo
 * run does not read as a leaderboard of one and a run where nobody healed does
 * not award a Health Restored medal for zero. Shared by the end screen and the
 * tests, because "who did the most damage" should mean one thing.
 */
export function runHighlights(players = []){
  const seated = players.filter(p => p && p.classId && p.stats);
  const rows = [];
  for(const key of STAT_KEYS){
    let best = null;
    for(const p of seated){
      const value = p.stats[key] || 0;
      if(value > 0 && (!best || value > best.value)) best = { player: p, value };
    }
    if(best) rows.push({ key, label: STAT_LABELS[key], player: best.player, value: best.value });
  }
  return rows;
}

/* ---- the effect list a player carries -----------------------------------
 *
 * Every one of these takes the list and hands back a new one rather than
 * editing in place, for the reason the card piles do: the room holds this
 * state, the view is built from it, and two callers sharing an array is how a
 * status ends up on the wrong player.
 *
 * `fresh` is the whole trick. Effects age once a round, at a fixed point in
 * the turn — but an effect a player *granted* this round has not been lived
 * through yet, and ageing it the same evening would make a one-round buff a
 * zero-round buff. Fresh survives its first ageing and loses the flag; the
 * ailments a monster lands arrive after the ageing and so never need it.
 */
export function addEffect(effects, effect){
  const next = (effects || []).filter(e => e.kind !== effect.kind);
  next.push({ rounds: 1, ...effect });
  return next;
}

export function addAilment(effects, id, from = null){
  const spec = AILMENTS[id];
  if(!spec) return effects || [];
  return addEffect(effects, { kind: id, amount: spec.amount, rounds: spec.rounds, from });
}

export const hasEffect = (effects, kind) => (effects || []).some(e => e.kind === kind);

/* Summed rather than found, so the day two sources of Might exist the number
   is right without this being rewritten. */
export const effectAmount = (effects, kind) =>
  (effects || []).filter(e => e.kind === kind).reduce((sum, e) => sum + (e.amount || 0), 0);

/* One round older. Fresh effects lose the flag instead of a round; anything
   that runs out is dropped. */
export function tickEffects(effects){
  const next = [];
  for(const effect of effects || []){
    if(effect.fresh){ next.push({ ...effect, fresh: false }); continue; }
    /* Bought for the fight rather than rented for a round, and so far only
       Heft is — which is why Heft costs health and nothing else does.
       enterCombat empties every player's effects, so "for the fight" is
       literally true and needs no expiry number to stay honest. Stored with no
       `rounds` rather than a large one, because the client prints the number
       beside the name and a chip reading "Heft 99" is a leak. */
    if(effect.lasting){ next.push(effect); continue; }
    const rounds = (effect.rounds ?? 1) - 1;
    if(rounds > 0) next.push({ ...effect, rounds });
  }
  return next;
}

/* What a cleanse takes off: ailments only. Stripping Might off the person you
   were trying to help would be a card that reads as support and plays as a
   mistake. */
export const clearAilments = effects =>
  (effects || []).filter(e => !AILMENTS[e.kind]);

/* What a strike actually lands for, once the blight and the party have both
   had their say. Never below one: a Weakened player holding Strike should be
   contributing badly, not contributing nothing. */
export const strikePower = (amount, effects) =>
  Math.max(1, amount
    + effectAmount(effects, 'might')
    + effectAmount(effects, 'heft')
    - effectAmount(effects, 'weak'));

/* The cards every deck holds regardless of class, by id. Kept as its own
   export because the room imports it; UNIVERSAL_CARDS derives the
   same list from the card table and is what the client reads.

   Strike is here rather than in a class deck for the reason it exists at all:
   a party that built economy and drew no attack still has hands, and a fight
   nobody can swing in is arithmetic, not a fight. */
export const BASE_ACTIONS = ['strike', 'hold'];

/* COMBAT_ACTIONS is now the card table, aliased below where CARDS is defined.
   Every one of these lives in a deck. */
