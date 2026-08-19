/* What each player is allowed to see.
 *
 * The room builds a separate view per seat rather than broadcasting one state,
 * because a hand is secret. From another seat you are counts and a class; only
 * your own view carries your actual cards. Enforced here, so no client setting
 * can widen it. */

import {
  BOSS_ROUND, PHASES, ROUNDS_BEFORE_BOSS, blankStats, intentOf, roundInfo, waveTargets
} from '../public/shared/index.js';

export const view = {
  /* ---- what each client is allowed to see ---------------------------- */

  viewFor(player){
    const view = {
      you: player.id,
      code: this.code,
      phase: this.phase,
      round: this.round,
      rounds: ROUNDS_BEFORE_BOSS,
      bossRound: BOSS_ROUND,
      roundInfo: this.phase === PHASES.lobby ? null : roundInfo(this.round),
      maxPlayers: this.maxPlayers,
      terrain: this.terrain,
      nodes: this.nodes,
      buildings: this.buildings,
      // The wave, each with what it is about to do. Derived here rather than
      // stored, so the telegraph cannot drift from the rule it reads.
      enemies: (() => {
        const at = waveTargets(this.enemies, this.standing, this.waveTurn || 0);
        return this.enemies.map(e => ({ ...e, intent: intentOf(e, at) }));
      })(),
      stash: this.stash,
      salvage: this.salvage,
      pages: this.pages,
      upgrades: this.upgrades,
      power: this.power,
      outcome: this.outcome,
      // The book and the open draft are public: a draft the table can lean
      // over and argue about is the fun of it, and nothing in either is a
      // secret the way a hand is.
      spellbook: this.spellbook,
      offers: this.offers,
      pots: this.pots,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        classId: p.classId,
        host: p.host,
        connected: p.connected,
        ready: p.ready,
        down: p.down,
        hp: p.hp,
        maxHp: p.maxHp,
        x: p.x,
        y: p.y,
        block: p.block || 0,
        // What the blight left on them, and what the party put back. Public on
        // purpose: an Alchemist deciding whether to spend the Censer has to be
        // able to see who is rotting, and a Wizard lending a page has to know
        // it is not already lent.
        effects: p.effects || [],
        // What this seat has done all run. Public, and the whole point: the end
        // screen is a co-op game's only chance to say who carried it.
        stats: p.stats || blankStats(),
        // Whether they have committed, never what they committed: a hand is
        // secret right up to the moment the round resolves.
        intent: p.intent ? { t: p.intent.t } : null,
        deckCount: p.deck.length,
        discardCount: p.discard.length,
        handCount: p.hand.length,
        // Your own cards, and nobody else's.
        ...(p.id === player.id ? { deck: p.deck, discard: p.discard, hand: p.hand } : {}),
      })),
      events: player.events,
    };
    player.events = [];
    return view;
  },
};
