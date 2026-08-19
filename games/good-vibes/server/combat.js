/* The surge: committing a card, resolving a round, and everything a card can
 * do to a body on either side of the field.
 *
 * The order inside resolve() is load-bearing — see the comments on it. */

import {
  AILMENTS, BOSS_ROUND, CARDS, PHASES, SALVAGE, addAilment, addEffect, addSalvage,
  ailmentOnHit, blankStats, cardById, cardEffect, cardPlayable, classById, clearAilments,
  discardHand, draw, effectAmount, effectName, hasEffect, salvageAfterCombat, strikePower,
  tickEffects, waveTargets
} from '../public/shared/index.js';

/* Effect kinds that post their own fx events, one per thing they landed on.
   Everything else gets one generic event from resolve(). */
const SELF_DRAWN = new Set([
  'strike', 'strikeAll', 'wardAll', 'healAll', 'cleanse', 'might', 'revive',
  // The wave-facing kinds are here for a second reason as well: the generic
  // emitter looks its target up among the *players*, so an enemy id would fall
  // through to the caster and draw the effect on the wrong body.
  'canker', 'cankerAll', 'heft', 'cover', 'graft',
]);


export const combat = {
  /* ---- combat, resolved when the last commitment is in ---------------- */

  commit(player, intent){
    if(player.down || player.intent) return this.broadcast();

    if(intent.t === 'play'){
      const cardId = player.hand[intent.index];
      if(!cardId || cardId !== intent.card) return this.broadcast();
      // A crafted spell has no play cost — the book already paid for it. Only
      // ordinary cards answer to pageCost and powerCost.
      if(!this.spellFor(player, cardId) && !cardPlayable(cardId, {
        pages: this.pages, power: this.power, classId: player.classId,
      })) return this.broadcast();
      player.intent = { t: 'play', card: cardId, index: intent.index, target: intent.target || null };
    }else{
      player.intent = { t: 'wait' };
    }

    this.broadcast();

    const acting = this.players.filter(p => p.classId && p.connected && !p.down);
    if(acting.length && acting.every(p => p.intent)) this.resolve();
  },

  /* The round, in one place.
   *
   * Resolution order is fixed by player id and never by who clicked first: the
   * same commitments have to produce the same round however the network
   * delivered them, or two clients replaying it disagree.
   */
  resolve(){
    const order = [...this.players]
      .filter(p => p.intent && p.classId)
      .sort((a, b) => a.id.localeCompare(b.id));

    for(const player of order){
      const intent = player.intent;
      if(intent.t !== 'play') continue;

      // Stunned is the one status that costs the turn rather than shading it.
      // The card is still spent — it goes to the discard with the rest of the
      // hand below — because a stun you can wait out for free is a stun that
      // never mattered.
      if(hasEffect(player.effects, 'stun')){
        this.event({ t: 'fx', kind: 'stun', player: player.id });
        this.log(`${player.name} is still finding their feet. The card falls out of their hand.`);
        continue;
      }

      const card = cardById(intent.card);
      if(!card) continue;
      // A crafted spell resolves from the book, not the card table, and the
      // book already paid: no page or power leaves the pools for one.
      const spell = this.spellFor(player, intent.card);
      if(!spell){
        if(card.pageCost) this.pages -= card.pageCost;
        if(card.powerCost) this.power -= card.powerCost;
        if(card.hpCost){
          // The Hauler's price, and the same rule the Bloodpact keeps below:
          // not through hurt(), because hurt() can put a player down and a card
          // must never be the thing that kills you. cardPlayable refuses the
          // play at or below the cost; this clamp is the second belt. Scored as
          // taken on purpose — the record should show who bled, and the Hauler
          // bleeds deliberately.
          const paid = Math.min(card.hpCost, player.hp - 1);
          player.hp -= paid;
          this.score(player, 'taken', paid);
        }
      }

      if(spell){
        // The Bloodpact is paid on the cast, and it cannot take the last
        // point — a spell that kills its own caster is a trap, not a trade.
        if(spell.flags.hpCost){
          const paid = Math.min(spell.flags.hpCost, player.hp - 1);
          if(paid > 0){
            this.score(player, 'taken', paid);
            player.hp -= paid;
            this.log(`${player.name} pays ${paid} health to the seal.`);
          }
        }
        if(spell.flags.selfWard){
          player.block = (player.block || 0) + spell.flags.selfWard;
          this.score(player, 'guard', spell.flags.selfWard);
          this.event({ t: 'fx', kind: 'ward', player: player.id });
        }
      }

      const effect = spell ? spell.effect : cardEffect(intent.card, this.upgrades);
      // Farsight reaches the back of the lane. Nothing is any distance away on
      // a standoff field, so "farthest" is the far end of the row as drawn —
      // the last of the wave, which is where the client paints it.
      let target = intent.target;
      if(spell && spell.flags.farthest && !target && effect.kind === 'strike'){
        const standing = this.enemies.filter(e => e.hp > 0);
        const far = standing[standing.length - 1];
        if(far) target = far.id;
      }

      // The party-wide and targeted kinds emit an fx per person they land on,
      // from inside apply(); only the plain single-target ones need one posting
      // here. Emitting both would draw the sparkle twice on one head.
      if(!SELF_DRAWN.has(effect.kind)){
        this.event({ t: 'fx', kind: effect.kind, player: (this.players.find(p => p.id === target) || player).id });
      }
      const killsBefore = (player.stats && player.stats.kills) || 0;
      const landed = this.apply(player, effect, card.name, target, intent.card) || 0;

      if(spell){
        if(spell.flags.leech && landed > 0){
          const back = Math.ceil(landed * spell.flags.leech);
          const before = player.hp;
          player.hp = Math.min(player.maxHp, player.hp + back);
          if(player.hp > before){
            this.score(player, 'mended', player.hp - before);
            this.event({ t: 'fx', kind: 'heal', player: player.id });
            this.log(`The glyph siphons ${player.hp - before} back into ${player.name}.`);
          }
        }
        const kills = ((player.stats && player.stats.kills) || 0) - killsBefore;
        if(spell.flags.pageOnKill && kills > 0){
          const paid = spell.flags.pageOnKill * kills;
          this.pages += paid;
          this.log(`The margin pays out: ${paid} page${paid === 1 ? '' : 's'} back to the library.`);
        }
        // The played copy is spent — pulled from the hand so it cannot cycle
        // back through the discard. The book deals fresh copies next surge,
        // which is what a charge is. The unplayed rest of the hand discards
        // normally, so drawing both copies never quietly burns one.
        player.hand.splice(intent.index, 1);
      }
    }

    // Hands down: the played card and the two that were not, minus anything
    // brewed, which is spent rather than discarded.
    for(const player of order){
      player.discard = discardHand(
        player.discard,
        player.hand.filter(id => !(CARDS[id] || {}).consumed),
      );
      player.hand = [];
      player.intent = null;
    }

    // Ailments bite and age before the wave lands new ones, so a rot dealt this
    // round does not also tick this round and a stun lasts exactly the one turn
    // it says it does.
    this.tickAilments();
    this.tickCanker();
    this.advanceWave();

    if(this.enemies.every(e => e.hp <= 0)) return this.winRound();
    if(this.players.filter(p => p.classId).every(p => p.down)) return this.lose();

    for(const player of order) if(!player.down) this.deal(player);
    for(const p of this.players) p.block = 0;
    this.broadcast();
  },

  /* ---- one effect, whoever it landed on ------------------------------- */

  /* Everybody with a seat, and everybody with a seat still on their feet. The
     party half of the card table is written against these two. */
  get party(){ return this.players.filter(p => p.classId); },

  get standing(){ return this.party.filter(p => !p.down); },

  /* Damage to a player from something that is not a monster's swing: rot, and
     anything else that reaches past guard. Guard is for the blow you saw
     coming, and rot is already inside you. */
  hurt(player, amount){
    if(amount <= 0 || player.down) return;
    this.score(player, 'taken', Math.min(amount, player.hp));
    player.hp = Math.max(0, player.hp - amount);
    this.downIf(player);
  },

  /* One number, added to one seat's record. Guarded rather than assumed: a
     player restored from a save written before stats existed has none, and a
     crash on the first swing of a resumed run would be a bad trade for a
     scoreboard. */
  score(player, key, amount){
    if(!player || !(amount > 0)) return;
    if(!player.stats) player.stats = blankStats();
    player.stats[key] = (player.stats[key] || 0) + amount;
  },

  /* Out of health is out of the fight. One place, so a player felled by rot
     drops their hand and says their line exactly as one felled by a swing. */
  downIf(player){
    if(player.hp > 0 || player.down) return;
    player.down = true;
    player.hand = [];
    player.intent = null;
    const cls = classById(player.classId);
    this.log(cls ? `${player.name}: "${cls.downLine}"` : `${player.name} goes down.`);
  },

  /* One strike, resolved against one enemy. Split out of apply() because a
     Cinder Nova is this same thing several times and the two must not drift on
     what a kill announces. */
  hitEnemy(player, target, amount, label, cardId){
    // `amount` rides along so the client can size the show to the swing — a
    // thirty-point Fireball should not draw the same orb a three-point Strike does.
    this.event({ t: 'fx', kind: cardId || 'strike', player: player.id, target: target.id, amount });
    // Landed, not swung: overkill on a thing with two health left is two points
    // of damage, or the end screen rewards aiming a Fireball at a Sporeling.
    const landed = Math.min(amount, target.hp);
    this.score(player, 'damage', landed);
    target.hp = Math.max(0, target.hp - amount);
    this.log(`${player.name}'s ${label} hits the ${target.name} for ${amount}.`);
    if(target.hp > 0) return landed;
    this.score(player, 'kills', 1);
    this.log(`The ${target.name} comes apart.`);
    // The client holds the round open on this event so a kill is watched
    // rather than skipped past, and `last` is what tells it whether it is
    // watching the end of a fight or the middle of one.
    this.event({
      t: 'fx', kind: 'slain', player: player.id, target: target.id,
      enemy: target.type, last: this.enemies.every(e => e.hp <= 0),
    });
    return landed;
  },

  apply(player, effect, label, targetId, cardId){
    const ally = () => this.players.find(p => p.id === targetId && p.classId) || player;

    if(effect.kind === 'strike'){
      // Aimed, or the first thing still standing. There is no "nearest" any
      // more — nothing approaches — so the default is the order the wave is
      // drawn in, which is the order the player reads it in.
      const alive = this.enemies.filter(e => e.hp > 0);
      // Aimed, or the first thing still standing. There is no "nearest" any
      // more — nothing approaches — so the default is the order the wave is
      // drawn in, which is the order the player reads it in.
      const target = alive.find(e => e.id === targetId) || alive[0];
      if(!target) return 0;
      return this.hitEnemy(player, target, strikePower(effect.amount, player.effects), label, cardId);

    }else if(effect.kind === 'strikeAll'){
      // Wave order, so the order a nova kills things in is the order the
      // player sees them standing in.
      const alive = this.enemies.filter(e => e.hp > 0);
      if(!alive.length) return 0;
      const amount = strikePower(effect.amount, player.effects);
      let landed = 0;
      for(const target of alive) landed += this.hitEnemy(player, target, amount, label, cardId);
      return landed;

    }else if(effect.kind === 'ward'){
      const who = ally();
      who.block = (who.block || 0) + effect.amount;
      this.score(player, 'guard', effect.amount);
      this.log(`${player.name}'s ${label} puts ${effect.amount} of guard on ${who.name}.`);

    }else if(effect.kind === 'wardAll'){
      for(const who of this.standing){
        who.block = (who.block || 0) + effect.amount;
        this.score(player, 'guard', effect.amount);
        this.event({ t: 'fx', kind: 'ward', player: who.id });
      }
      this.log(`${player.name}'s ${label}: ${effect.amount} of guard on the whole party.`);

    }else if(effect.kind === 'heal'){
      const who = ally();
      const before = who.hp;
      who.hp = Math.min(who.maxHp, who.hp + effect.amount);
      this.score(player, 'mended', who.hp - before);
      this.log(`${player.name}'s ${label} mends ${who.hp - before} on ${who.name}.`);

    }else if(effect.kind === 'healAll'){
      let total = 0;
      for(const who of this.standing){
        const before = who.hp;
        who.hp = Math.min(who.maxHp, who.hp + effect.amount);
        total += who.hp - before;
        this.event({ t: 'fx', kind: 'heal', player: who.id });
      }
      this.score(player, 'mended', total);
      this.log(`${player.name}'s ${label} mends ${total} across the party.`);

    }else if(effect.kind === 'regen'){
      const who = ally();
      who.effects = addEffect(who.effects, {
        kind: 'regen', amount: effect.amount, rounds: effect.rounds ?? 2, fresh: true,
      });
      this.log(`${player.name}'s ${label} sets ${who.name} mending.`);

    }else if(effect.kind === 'cleanse'){
      const who = ally();
      const had = (who.effects || []).filter(e => AILMENTS[e.kind]).map(e => effectName(e.kind));
      who.effects = clearAilments(who.effects);
      // Not a wasted card when there is nothing to clear: it still mends,
      // because the Alchemist should be able to play it on the round she draws
      // it rather than holding it for one that may not come.
      const before = who.hp;
      who.hp = Math.min(who.maxHp, who.hp + effect.amount);
      this.score(player, 'mended', who.hp - before);
      this.event({ t: 'fx', kind: 'cleanse', player: who.id });
      this.log(had.length
        ? `${player.name}'s ${label} burns ${had.join(' and ')} off ${who.name}.`
        : `${player.name}'s ${label} clears the air around ${who.name}; ${who.hp - before} mended.`);

    }else if(effect.kind === 'might'){
      const who = ally();
      who.effects = addEffect(who.effects, {
        kind: 'might', amount: effect.amount, rounds: effect.rounds ?? 1, fresh: true,
      });
      this.event({ t: 'fx', kind: 'might', player: who.id });
      this.log(`${player.name}'s ${label}: ${who.name} swings for ${effect.amount} more next round.`);

    }else if(effect.kind === 'heft'){
      // Summed and re-added rather than pushed: addEffect replaces by kind, so
      // a second Set Your Feet has to arrive already carrying the first.
      const who = ally();
      const total = effectAmount(who.effects, 'heft') + effect.amount;
      who.effects = addEffect(who.effects, {
        kind: 'heft', amount: total, rounds: 0, lasting: true,
      });
      this.event({ t: 'fx', kind: 'heft', player: who.id });
      this.log(`${player.name}'s ${label}: ${who.name} swings for ${total} more for the rest of the fight.`);

    }else if(effect.kind === 'cover'){
      // `player`, never ally(): you cannot volunteer somebody else.
      //
      // There is no charge counter and no second field. The number on the card
      // is literally how much of the wave is being bought, a point of guard per
      // point of damage, because the redirect ends the moment the guard runs
      // out — and block is zeroed at the foot of resolve() so it cannot leak
      // into next round. Which also means the Engineer warding the Hauler is
      // the Hauler covering for longer, with nothing added to make it so.
      player.block = (player.block || 0) + effect.amount;
      player.effects = addEffect(player.effects, {
        kind: 'cover', amount: effect.amount, rounds: 1, fresh: true,
      });
      this.score(player, 'guard', effect.amount);
      this.event({ t: 'fx', kind: 'cover', player: player.id });
      this.log(`${player.name} steps in front. ${effect.amount} of guard, and the wave comes here while it holds.`);

    }else if(effect.kind === 'canker' || effect.kind === 'cankerAll'){
      const alive = this.enemies.filter(e => e.hp > 0);
      const hit = effect.kind === 'cankerAll'
        ? alive
        : [alive.find(e => e.id === targetId) || alive[0]].filter(Boolean);
      if(!hit.length) return;
      for(const target of hit){
        // Refreshed, not stacked, for the reason an ailment is: additive would
        // pay out triangularly and three Ringbarks on one Hulk would be
        // forty-five damage rather than six.
        target.canker = Math.max(target.canker || 0, effect.amount);
        target.cankerFrom = player.id;
        /* Cut this round, paying from the next one — the same discipline
           `fresh` gives an effect on a player, and for the same reason. Without
           it tickCanker runs later in this very resolve() and a ring pays out
           the instant it is cut, which is a strike with extra steps and not the
           card the Grafter is holding. It stands there looking fine for a week,
           and then it does not. */
        target.cankerFresh = true;
        this.event({ t: 'fx', kind: 'canker', player: player.id, target: target.id });
      }
      this.log(hit.length > 1
        ? `${player.name}'s ${label} gets into the whole row: ${effect.amount} on every one of them.`
        : `${player.name}'s ${label} cuts a ring in the ${hit[0].name}. It has ${hit[0].canker} coming.`);

    }else if(effect.kind === 'graft'){
      /* Onto the top of the deck rather than into the discard, because resolve
         runs apply, then discards, then deals — and draw() takes from the
         front. So a cutting posted this round is in that ally's hand next
         round, guaranteed. The certainty is what makes it a coordination card
         rather than a lottery ticket: both players know what happens next. */
      const who = ally();
      for(let i = 0; i < effect.amount; i++) who.deck.unshift('cutting');
      this.event({ t: 'fx', kind: 'graft', player: who.id });
      this.log(`${player.name} binds a cutting to ${who.name}'s arm. It is the next thing they draw.`);

    }else if(effect.kind === 'revive'){
      const down = this.party.filter(p => p.down);
      const target = down.find(p => p.id === targetId) || down[0];
      if(target){
        target.down = false;
        target.hp = Math.min(target.maxHp, effect.amount);
        target.effects = clearAilments(target.effects);
        this.score(player, 'revived', 1);
        this.deal(target);
        this.event({ t: 'fx', kind: 'heal', player: target.id });
        this.log(`${player.name}'s ${label} puts ${target.name} back on their feet.`);
      }else{
        // Nobody down: the jolt goes to whoever is furthest from full, so the
        // card is never a blank turn.
        const who = [...this.standing].sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0] || player;
        const before = who.hp;
        who.hp = Math.min(who.maxHp, who.hp + effect.amount);
        this.score(player, 'mended', who.hp - before);
        this.event({ t: 'fx', kind: 'heal', player: who.id });
        this.log(`${player.name}'s ${label} jolts ${who.hp - before} back into ${who.name}.`);
      }
    }
  },

  /* Canker comes off in the quiet gap: after the statuses, before the wave.
   *
   * Routed through hitEnemy rather than subtracting, so the damage stat, the
   * overkill trim, the kill credit, the comes-apart line and the slain fx with
   * its `last` flag all come out right with no second copy of any of them.
   *
   * Three, then two, then one: six across three rounds, and the wave has to
   * survive all three to stop paying. Credited to whoever cut the ring even if
   * they are on the floor by the time it lands, which is the point of it.
   */
  tickCanker(){
    for(const enemy of this.enemies){
      if(enemy.hp <= 0 || !enemy.canker) continue;
      if(enemy.cankerFresh){ enemy.cankerFresh = false; continue; }
      const from = this.party.find(p => p.id === enemy.cankerFrom) || this.party[0];
      if(from) this.hitEnemy(from, enemy, enemy.canker, 'Canker', 'canker');
      enemy.canker -= 1;
    }
  },

  /* What the statuses do, once a round, before the wave gets its turn.
   *
   * Rot and Mending are the two that act; everything else only ages. Ordered
   * damage-then-age so a two-round rot bites twice, and run over the whole
   * party in seat order so it cannot depend on who committed first.
   */
  tickAilments(){
    for(const player of this.party){
      if(!(player.effects || []).length) continue;

      const rot = effectAmount(player.effects, 'rot');
      if(rot && !player.down){
        this.event({ t: 'fx', kind: 'rot', player: player.id });
        this.log(`Blightrot takes ${rot} out of ${player.name}.`);
        this.hurt(player, rot);
      }

      const regen = effectAmount(player.effects, 'regen');
      if(regen && !player.down){
        const before = player.hp;
        player.hp = Math.min(player.maxHp, player.hp + regen);
        if(player.hp > before){
          this.score(player, 'mended', player.hp - before);
          this.event({ t: 'fx', kind: 'regen', player: player.id });
          this.log(`${player.name} mends ${player.hp - before}.`);
        }
      }

      player.effects = tickEffects(player.effects);
    }
  },

  /* The wave's turn. Everything still standing swings, every round, because
     nothing on this field is anywhere but here — that is the whole of the
     standoff. Round-robin across the standing party rather than always the
     same person, so a five-player fight does not quietly gang up on seat one.

     Kept under the old name because the call site, the tests and the ported
     copy all say advanceWave, and renaming it would be a diff about a word. */
  advanceWave(){
    const standing = this.standing;
    if(!standing.length) return;
    // One copy of the targeting rule, shared with the telegraph the client
    // draws, so what a player was promised is what lands.
    const at = waveTargets(this.enemies, standing, this.waveTurn || 0);
    this.waveTurn = (this.waveTurn || 0) + 1;

    for(const enemy of this.enemies){
      if(enemy.hp <= 0) continue;

      const victim = standing.find(p => p.id === at.get(enemy.id)) || standing[0];
      this.event({ t: 'fx', kind: 'hit', player: victim.id, from: enemy.id });
      const blocked = Math.min(victim.block || 0, enemy.hits);
      victim.block = (victim.block || 0) - blocked;
      const through = enemy.hits - blocked;
      if(through > 0){
        this.score(victim, 'taken', Math.min(through, victim.hp));
        victim.hp = Math.max(0, victim.hp - through);
      }

      this.log(blocked
        ? `The ${enemy.name} hits ${victim.name} for ${enemy.hits}; guard eats ${blocked}.`
        : `The ${enemy.name} hits ${victim.name} for ${enemy.hits}.`);

      // A blow that guard swallowed whole leaves nothing behind. That is the
      // reason to spend a card on a ward against a Creeper rather than trade
      // damage with it: you are not buying health, you are buying the two
      // rounds of Weakened that would have followed.
      if(through > 0){
        enemy.landed = (enemy.landed || 0) + 1;
        const ail = ailmentOnHit(enemy.type, enemy.landed);
        if(ail && !victim.down){
          victim.effects = addAilment(victim.effects, ail, enemy.id);
          this.event({ t: 'fx', kind: 'ail', ail, player: victim.id, from: enemy.id });
          this.log(`${victim.name} is ${effectName(ail)}. ${AILMENTS[ail].note}`);
        }
      }

      this.downIf(victim);
    }
  },

  winRound(){
    const drawn = salvageAfterCombat(this.players.filter(p => p.classId), this.buildings, this.random);
    this.salvage = addSalvage(this.salvage, drawn);
    const summary = Object.entries(drawn).map(([id, n]) => `${n} ${SALVAGE[id].name}`).join(', ');
    if(summary) this.log(`Salvaged ${summary}.`);

    if(this.round >= BOSS_ROUND){
      this.phase = PHASES.over;
      this.outcome = 'won';
      this.log('The Array is lit. The ruin keeps growing, and so do you.');
      return this.broadcast();
    }

    this.round += 1;
    // Anyone who went down is back on their feet for the build phase, on a
    // sliver of health — a run that benched a player for the rest of it would
    // be a run they stopped playing.
    for(const p of this.players){
      if(!p.down) continue;
      p.down = false;
      p.hp = Math.max(1, Math.round(p.maxHp * 0.25));
    }
    this.enterBuild();
    this.broadcast();
  },

  lose(){
    this.phase = PHASES.over;
    this.outcome = 'lost';
    this.log('The blight closes over the site. The ruin goes back to growing alone.');
    this.broadcast();
  },
};
