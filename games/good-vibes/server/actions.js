/* The build phase: everything a player can do between surges.
 *
 * Every method here is reached from intent() and every one of them validates
 * server-side. An illegal intent is not an error, it is simply not applied. */

import {
  BUILDINGS, CACHE_YIELD, MATERIALS, MODIFIERS, PHASES, RECIPES, SALVAGE, SPELLS, UPGRADES,
  addSalvage, brew, buyUpgrade, canBuildAt, canBuildMore, cardEffect, classById,
  composeSpell, draftableCount, harvestPot, missingForBuilding, moveModifier, pathTo,
  plantPot, powerFrom, rollOffers, spendSalvage, takeOffer, wizardCombatDeck
} from '../public/shared/index.js';

export const actions = {
  intent(player, intent){
    if(!player.classId) return;
    const cls = classById(player.classId);

    if(this.phase === PHASES.build){
      if(intent.t === 'moveTo') this.moveTo(player, intent);
      else if(intent.t === 'gather') this.gather(player, intent);
      else if(intent.t === 'brew') this.brew(player, cls, intent);
      else if(intent.t === 'place') this.place(player, cls, intent);
      else if(intent.t === 'upgrade') this.upgrade(player, cls, intent);
      else if(intent.t === 'page') this.openPage(player, cls);
      else if(intent.t === 'pick') this.pickOffer(player, cls, intent);
      else if(intent.t === 'mod') this.moveMod(player, cls, intent);
      else if(intent.t === 'plant') this.plant(player, cls, intent);
      else if(intent.t === 'harvest') this.harvest(player, cls, intent);
      return this.broadcast();
    }

    if(this.phase === PHASES.combat){
      if(intent.t === 'play') this.commit(player, intent);
      else if(intent.t === 'wait') this.commit(player, { t: 'wait' });
      return;                                   // commit broadcasts itself
    }
  },

  moveTo(player, { x, y }){
    const path = pathTo(this.terrain, this.buildings, { x: player.x, y: player.y }, { x, y });
    if(!path) return;                           // no way across is an answer
    player.x = x;
    player.y = y;
    // The route, so every client can walk the sprite rather than teleport it.
    this.event({ t: 'moved', id: player.id, path });
    this.pickUp(player);
  },

  gather(player, { node: nodeId }){
    const node = this.nodes.find(n => n.id === nodeId && !n.taken);
    if(!node) return;
    const path = pathTo(this.terrain, this.buildings, { x: player.x, y: player.y },
      { x: node.x, y: node.y });
    if(!path) return;
    player.x = node.x;
    player.y = node.y;
    this.event({ t: 'moved', id: player.id, path });
    this.pickUp(player);
  },

  /* Standing on something picks it up. One place, so walking onto a node and
     clicking its chip cannot behave differently. */
  pickUp(player){
    const node = this.nodes.find(n => n.x === player.x && n.y === player.y && !n.taken);
    if(!node) return;
    const cls = classById(player.classId);
    /* Anyone can bend down.
     *
     * A herb used to be the Alchemist's alone: everybody else walked over it
     * and it stayed where it grew. That made four of the five seats walk past
     * the thing the build phase is mostly made of, and it made a party without
     * her unable to brew at all — which is not scarcity, it is a locked door.
     *
     * She is still the best at it and by a wide margin: `gather` is 2 on her
     * and 1 on everybody else, so the same node is worth twice as much when
     * she is the one who stoops. The difference is a reason to send her rather
     * than a rule about who is allowed. Caches and pages were always for
     * whoever got there first.
     */
    node.taken = true;

    if(node.kind === 'herb'){
      const yield_ = cls ? cls.gather : 1;
      this.stash = { ...this.stash, [node.material]: (this.stash[node.material] || 0) + yield_ };
      this.log(`${player.name} gathered ${yield_} ${MATERIALS[node.material].name}.`);
    }else if(node.kind === 'salvage'){
      this.salvage = addSalvage(this.salvage, { [node.salvage]: CACHE_YIELD.salvage });
      this.log(`${player.name} cracked a cache: ${CACHE_YIELD.salvage} ${SALVAGE[node.salvage].name}.`);
    }else if(node.kind === 'pages'){
      this.pages += CACHE_YIELD.pages;
      this.log(`${player.name} found ${CACHE_YIELD.pages} spell page${CACHE_YIELD.pages === 1 ? '' : 's'}.`);
    }
  },

  brew(player, cls, { recipe: recipeId }){
    if(!cls || !cls.craft) return;
    const made = brew(recipeId, this.stash);
    if(!made) return;
    this.stash = made.stash;
    player.deck = [...player.deck, ...made.cards];
    const recipe = RECIPES[recipeId];
    this.log(`${player.name} brewed ${recipe.makes} ${recipe.name}${recipe.makes > 1 ? 's' : ''}.`);
  },

  place(player, cls, { building: id, x, y }){
    if(!cls || !cls.build) return;
    const building = BUILDINGS[id];
    if(!building) return;
    if(Object.keys(missingForBuilding(id, this.salvage)).length) return;
    if(!canBuildMore(id, this.buildings)) return;
    if(!canBuildAt(this.terrain, this.buildings, this.nodes, x, y)) return;

    this.salvage = spendSalvage(this.salvage, building.costs);
    this.buildings = [...this.buildings, { id, x, y }];
    this.log(building.power
      ? `${player.name} raised the ${building.name}. ${powerFrom(this.buildings)} power a fight now.`
      : `${player.name} raised the ${building.name}.`);
  },

  upgrade(player, cls, { upgrade: id }){
    if(!cls || !cls.build) return;
    if(!this.buildings.some(b => b.id === 'workbench')) return;
    const level = this.upgrades[id] || 0;
    const bought = buyUpgrade(id, level, this.salvage);
    if(!bought) return;

    this.salvage = bought.salvage;
    this.upgrades = { ...this.upgrades, [id]: bought.level };
    if(bought.adds === 'card'){
      player.deck = [...player.deck, 'boltgun'];
      this.log(`${UPGRADES[id].name}: another Bolt Gun in the deck.`);
    }else{
      this.log(`${UPGRADES[id].name}: bolts now hit for ${cardEffect('boltgun', this.upgrades).amount}.`);
    }
  },

  /* ---- the garden: the Alchemist's slow half -------------------------- */

  /* Both gated on `craft`, like brewing: the pots are hers the way the
     workbench is the Engineer's. The helpers refuse anything illegal, so
     these are a move or a no-op, never a half-move. */
  plant(player, cls, { pot, herb }){
    if(!cls || !cls.craft) return;
    const planted = plantPot(this.pots, pot, herb, this.stash);
    if(!planted) return;
    this.pots = planted.pots;
    this.stash = planted.stash;
    this.log(`${player.name} plants a ${MATERIALS[herb].name} cutting.`);
  },

  harvest(player, cls, { pot }){
    if(!cls || !cls.craft) return;
    const picked = harvestPot(this.pots, pot, this.stash);
    if(!picked) return;
    this.pots = picked.pots;
    this.stash = picked.stash;
    this.log(`${player.name} harvests ${picked.yielded} ${MATERIALS[picked.herb].name} from the pot.`);
  },

  /* ---- the scriptorium: the Wizard's build phase ---------------------- */

  /* Spend a page, turn over a draft of three. One draft open at a time — the
     choice on the table has to be settled before the next page buys another. */
  openPage(player, cls){
    if(!cls || !cls.cast) return;
    if(this.offers || this.pages < 1) return;
    if(!draftableCount(this.spellbook)) return;   // she has read everything
    this.pages -= 1;
    this.offers = rollOffers(this.random, this.spellbook);
    this.log(`${player.name} opens a page. Three ways to read it.`);
  },

  pickOffer(player, cls, { index }){
    if(!cls || !cls.cast) return;
    const offer = (this.offers || [])[index];
    const next = takeOffer(this.spellbook, this.offers, index);
    if(!next) return;
    this.spellbook = next;
    this.offers = null;
    this.refreshBook(player);
    this.log(offer.type === 'spell'
      ? `${player.name} learns ${SPELLS[offer.id].name}.`
      : `${player.name} inscribes ${MODIFIERS[offer.id].name}.`);
  },

  /* Rearranging is free and build-phase only — a spell is edited at the desk,
     not mid-surge. The helper refuses anything illegal, so this is a move or
     a no-op, never a half-move. */
  moveMod(player, cls, { mod, spell = null, pos }){
    if(!cls || !cls.cast) return;
    const next = moveModifier(this.spellbook, mod, spell, pos);
    if(!next) return;
    this.spellbook = next;
    this.refreshBook(player);
    if(spell){
      const composed = composeSpell(spell, next.slots[spell]);
      this.log(`${MODIFIERS[mod].name} set into ${SPELLS[spell].name}: ` +
        `${composed.amount} ${composed.verb === 'might' ? 'lent' : 'damage'}, ` +
        `${composed.charges} charge${composed.charges === 1 ? '' : 's'}.`);
    }
  },

  /* The deck list is the book's shadow, and it updates the moment the book
     does — an Echo Script socketed in a build phase shows its extra copy
     right away, not at the surge. Build phase only; a fight in progress
     keeps the deck it was dealt. */
  refreshBook(player){
    if(this.phase !== PHASES.build) return;
    player.deck = wizardCombatDeck(this.spellbook);
    player.discard = [];
    player.hand = [];
  },

  /* The composed spell behind a card in this room, or null when the card is
     an ordinary card — the one test for "does the new path apply". */
  spellFor(player, cardId){
    const cls = classById(player.classId);
    if(!cls || !cls.cast) return null;
    if(!(this.spellbook.known || []).includes(cardId)) return null;
    return composeSpell(cardId, this.spellbook.slots[cardId]);
  },
};
