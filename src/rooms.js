/* The authoritative game state, and the only thing allowed to write it.
 *
 * Clients send intents and get back a view. They never decide anything: not
 * what a card does, not whether a tile was reachable, not whose turn resolved
 * first. That is what makes cheating a non-issue and it is why every rule here
 * comes out of public/content.js — the same module the browser imports, so the
 * two ends cannot disagree about what a potion does.
 *
 * Two things this file is careful about:
 *
 *   Private state. A hand is secret. The room holds every card and sends each
 *   client only their own, plus counts for everybody else. This is the first
 *   per-player view in the game and the reason the state is built per socket
 *   rather than broadcast whole.
 *
 *   Determinism. Every shuffle and every roll comes from a seeded generator
 *   owned by the room, and each player has their own stream, so one player
 *   drawing cannot shift anyone else's draw.
 */

import {
  PHASES, PARTY_SIZE, ROUNDS_BEFORE_BOSS, BOSS_ROUND, roundInfo, phaseCard,
  CLASSES, classById, playableClasses,
  MATERIALS, SALVAGE, CACHE_YIELD, STARTING_SALVAGE,
  BUILDINGS, UPGRADES, upgradeCost, buyUpgrade, canBuildMore, powerFrom,
  CARDS, cardById, cardEffect, cardPlayable, shuffle, draw, discardHand,
  HAND_SIZE, RECIPES, brew, missingForBuilding, canBuildAt,
  SPELLS, MODIFIERS, PAGES_PER_ROUND, freshSpellbook, composeSpell,
  rollOffers, takeOffer, moveModifier, wizardCombatDeck, draftableCount,
  POT_COUNT, plantPot, harvestPot, growPots, classKit,
  generateMap, generateCombatTerrain, respawnItems, spawnTile, pathTo,
  seededRandom, seedFromCode, readyState,
  ENEMIES, waveFor, enemyStats, salvageAfterCombat, addSalvage, spendSalvage,
  AILMENTS, addEffect, addAilment, hasEffect, effectAmount, tickEffects,
  clearAilments, strikePower, ailmentOnHit, effectName, blankStats, intentOf,
  waveTargets, spawnsFor,
} from '../public/content.js';

const rooms = new Map();

/* Each player's shuffles come from their own stream. One shared generator would
   make your draw depend on how many cards somebody else drew first. */
const streamFor = (seed, id) => seededRandom(seedFromCode(`${seed}:${id}`));

/* Effect kinds that post their own fx events, one per thing they landed on.
   Everything else gets one generic event from resolve(). */
const SELF_DRAWN = new Set([
  'strike', 'strikeAll', 'wardAll', 'healAll', 'cleanse', 'might', 'revive',
  // The wave-facing kinds are here for a second reason as well: the generic
  // emitter looks its target up among the *players*, so an enemy id would fall
  // through to the caster and draw the effect on the wrong body.
  'canker', 'cankerAll', 'heft', 'cover', 'graft',
]);

let serial = 0;

class Room {
  constructor(code){
    this.code = code;
    /* Which run this is in this room, and the reason the seed is not simply
       the code. A party that loses and goes again should get a different ruin;
       reusing the code's seed would hand them the same site, the same herbs and
       the same waves, which turns a second attempt into a memory test. */
    this.run = 0;
    this.seed = seedFromCode(code);
    this.reseed();
    this.players = [];
    this.reset();
  }

  /* The generator, rebuilt from whatever this.seed currently is.
   *
   * A seam: the deployed room wraps this in a call counter so a hibernating
   * Durable Object can replay its way back to the same stream. Everything that
   * needs a fresh generator goes through here so there is one line to keep
   * different rather than three.
   */
  reseed(){ this.random = seededRandom(this.seed); }

  reset(){
    this.phase = PHASES.lobby;
    this.round = 1;
    this.site = [];          // the ground, generated once a run and kept
    this.terrain = [];       // what is on screen: the site, or a combat lane
    this.nodes = [];
    this.buildings = [];
    this.enemies = [];
    this.stash = {};
    this.salvage = { ...STARTING_SALVAGE };
    this.pages = 2;
    this.upgrades = {};
    this.power = 0;
    this.outcome = null;
    // The Wizard's book: what she knows, what she owns, and how it is
    // arranged. Room state like the buildings are, because the party can
    // watch her work and the surge reads the arrangement.
    this.spellbook = freshSpellbook();
    this.offers = null;
    // The Alchemist's pots, by the fire. Like the buildings, they persist
    // across rounds — they are the part of her economy that compounds.
    this.pots = Array(POT_COUNT).fill(null);
  }

  get maxPlayers(){ return Math.min(PARTY_SIZE, playableClasses().length); }

  /* ---- seats -------------------------------------------------------- */

  /* A token, not a connection, identifies a player: a dropped socket should be
     able to come back to the same character rather than to a new seat. */
  join(token, socket){
    let player = this.players.find(p => p.token === token);
    if(player){
      player.socket = socket;
      player.connected = true;
      return player;
    }

    if(this.players.length >= this.maxPlayers) return null;
    if(this.phase !== PHASES.lobby) return null;   // no joining a run in progress

    player = {
      id: `p${++serial}`,
      token,
      socket,
      name: `Player ${this.players.length + 1}`,
      classId: null,
      host: this.players.length === 0,
      connected: true,
      ready: false,
      down: false,
      hp: 0, maxHp: 0, block: 0,
      effects: [],
      stats: blankStats(),
      x: 0, y: 0,
      deck: [], discard: [], hand: [],
      intent: null,
      events: [],
    };
    this.players.push(player);
    return player;
  }

  leave(player){
    player.connected = false;
    player.socket = null;
    // The seat is kept: the token can reclaim it. An empty room is dropped by
    // the caller once nobody is left connected.
    if(this.phase === PHASES.lobby){
      this.players = this.players.filter(p => p !== player);
      if(this.players.length && !this.players.some(p => p.host)) this.players[0].host = true;
    }
  }

  get empty(){ return !this.players.some(p => p.connected); }

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
  }

  send(player){
    if(player.socket && player.socket.open){
      player.socket.send(JSON.stringify({ t: 'state', state: this.viewFor(player) }));
    }
  }

  broadcast(){
    for(const p of this.players) this.send(p);
  }

  /* An event everybody sees. Per-player queues, because each client drains its
     own on the next view and two clients can be a state apart. */
  log(text){ this.event({ t: 'log', text }); }

  event(event){
    for(const p of this.players) p.events.push(event);
  }

  /* ---- phases -------------------------------------------------------- */

  startRun(){
    if(this.phase !== PHASES.lobby) return;
    const seated = this.players.filter(p => p.classId);
    if(!seated.length) return;

    for(const p of this.players){
      const cls = classById(p.classId);
      if(!cls) continue;
      p.hp = cls.hp;
      p.maxHp = cls.hp;
      // Every class opens with its kit — six basics, nothing else. The
      // Wizard's is the book's shadow from the first minute: what the deck
      // list shows in a build phase is what the surge will deal.
      p.deck = cls.cast ? wizardCombatDeck(this.spellbook) : classKit(cls.id);
      p.discard = [];
      p.hand = [];
      p.down = false;
      p.effects = [];
      p.stats = blankStats();
    }
    this.round = 1;
    // The site is generated once for the whole run. Everything the party puts
    // on it stands until the run ends — that is the entire reason to build.
    const { terrain } = generateMap(this.random);
    this.site = terrain;
    this.buildings = [];
    this.enterBuild();
  }

  enterBuild(){
    this.phase = PHASES.build;
    // Same ground, same structures, a fresh crop. Only what grows is reseeded:
    // walking back onto the slab you cleared last round and finding your panel
    // still bolted to it is the point of a build phase.
    this.terrain = this.site;
    this.nodes = respawnItems(this.site, this.buildings, this.random, spawnsFor(this.players));
    this.enemies = [];
    this.power = 0;

    // The garden grew while everyone was fighting.
    this.pots = growPots(this.pots);

    // The library pays out when there is somebody to read it. Income rather
    // than only foraging, because the draft is the Wizard's whole build phase
    // and a round with no page is a round spent watching.
    if(this.players.some(p => (classById(p.classId) || {}).cast)){
      this.pages += PAGES_PER_ROUND;
      this.log(`The library gives up ${PAGES_PER_ROUND} page${PAGES_PER_ROUND === 1 ? '' : 's'}.`);
    }

    this.players.forEach((p, i) => {
      const start = spawnTile(this.site, i * 2, this.buildings);
      p.x = start.x;
      p.y = start.y;
      p.ready = false;
      p.intent = null;
      p.block = 0;
    });

    this.event({ t: 'phase', ...phaseCard(this.round, PHASES.build) });
  }

  enterCombat(){
    this.phase = PHASES.combat;
    this.terrain = generateCombatTerrain(this.random);
    // Which seat the wave opens its round-robin on. Reset per fight, so a
    // rotation carried out of the last one cannot decide who opens this one.
    this.waveTurn = 0;
    this.power = powerFrom(this.buildings);
    const partySize = Math.max(1, this.players.filter(p => p.classId && p.connected).length);
    this.enemies = waveFor(this.round, partySize).map((type, i) => {
      const def = ENEMIES[type];
      // The wave table levels the fight by sending different things; the boss
      // is the one enemy it cannot do that with, so its numbers are levelled
      // here instead. Everything else comes back unchanged.
      const stats = enemyStats(type, partySize);
      return { id: `e${i}`, type, name: def.name, art: def.art,
               hp: stats.hp, maxHp: stats.hp, hits: stats.hits,
               // How many blows this one has landed. The ailment cadence reads
               // it, so it has to live on the enemy and survive hibernation
               // rather than be recomputed from a log nobody keeps.
               landed: 0 };
    });

    for(const p of this.players){
      if(!p.classId) continue;
      const cls = classById(p.classId);
      // Everything the player owns goes back in: a hand held when the last wave
      // broke is still theirs. The Wizard's deck is the exception — hers is
      // written fresh from the book each surge, which is what makes a spell's
      // charges per-combat without a counter anywhere.
      const owned = cls && cls.cast
        ? wizardCombatDeck(this.spellbook)
        : [...p.deck, ...p.discard, ...p.hand];
      p.deck = shuffle(owned, streamFor(this.seed, p.id));
      // An Opening Word puts one copy of its spell into the first deal.
      if(cls && cls.cast){
        for(const spellId of this.spellbook.known){
          const composed = composeSpell(spellId, this.spellbook.slots[spellId]);
          if(!composed || !composed.flags.opening) continue;
          const at = p.deck.indexOf(spellId);
          if(at > 0){ p.deck.splice(at, 1); p.deck.unshift(spellId); }
        }
      }
      p.discard = [];
      p.hand = [];
      p.block = 0;
      // A fight starts clean. Rot carried through a build phase would tick
      // where there is no combat screen to show it and no card to answer it
      // with — a status the player can neither see nor act on.
      p.effects = [];
      p.intent = null;
      p.ready = false;
      this.deal(p);
    }

    this.event({ t: 'phase', ...phaseCard(this.round, PHASES.combat) });
  }

  deal(player){
    const dealt = draw(player.deck, player.discard, streamFor(this.seed, player.id), HAND_SIZE);
    player.hand = dealt.hand;
    player.deck = dealt.deck;
    player.discard = dealt.discard;
  }

  /* ---- intents ------------------------------------------------------- */

  handle(player, msg){
    if(!msg || typeof msg.t !== 'string') return;

    if(msg.t === 'ping') return;
    if(msg.t === 'name' && typeof msg.name === 'string'){
      player.name = msg.name.slice(0, 24) || player.name;
      return this.broadcast();
    }

    if(msg.t === 'class') return this.pickClass(player, msg.classId);
    if(msg.t === 'ready') return this.setReady(player, !!msg.ready);
    if(msg.t === 'start'){
      if(player.host) this.startRun();
      return this.broadcast();
    }
    if(msg.t === 'restart') return this.restart(player);
    if(msg.t === 'intent') return this.intent(player, msg.intent || {});
  }

  /* Back to the lobby, same crew, new ruin.
   *
   * Seats and names are kept and everything a run accumulated is dropped —
   * a party that just lost together almost always wants the same seats and
   * never wants the same site, so the seed moves on with the run counter.
   * Host-only, for the reason `start` is: five people and one screen.
   */
  restart(player){
    if(this.phase !== PHASES.over) return;
    if(!player.host) return;

    this.run += 1;
    this.seed = seedFromCode(`${this.code}#${this.run}`);
    this.reseed();
    this.reset();

    for(const p of this.players){
      p.ready = false;
      p.down = false;
      p.intent = null;
      p.hp = 0; p.maxHp = 0; p.block = 0;
      p.effects = [];
      p.stats = blankStats();
      p.deck = []; p.discard = []; p.hand = [];
      // The class stays. Re-picking five seats after every loss is a menu, not
      // a decision — and anyone who does want to change has the lobby to do it.
    }
    this.log('A new run. Same crew, different ruin.');
    this.broadcast();
  }

  pickClass(player, classId){
    if(this.phase !== PHASES.lobby) return;
    if(classId === null){ player.classId = null; return this.broadcast(); }

    const cls = classById(classId);
    if(!cls || cls.status !== 'live') return;
    // One class per player, and the seat is the binding: two Alchemists would
    // both be spending the same stash with the same verbs.
    if(this.players.some(p => p !== player && p.classId === classId)) return;
    player.classId = classId;
    this.broadcast();
  }

  setReady(player, ready){
    player.ready = ready;
    // In the lobby, ready is just a flag the host can see. In the build phase it
    // is the phase turning.
    if(this.phase === PHASES.build && readyState(this.players.filter(p => p.classId)).all){
      this.enterCombat();
    }
    this.broadcast();
  }

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
  }

  moveTo(player, { x, y }){
    const path = pathTo(this.terrain, this.buildings, { x: player.x, y: player.y }, { x, y });
    if(!path) return;                           // no way across is an answer
    player.x = x;
    player.y = y;
    // The route, so every client can walk the sprite rather than teleport it.
    this.event({ t: 'moved', id: player.id, path });
    this.pickUp(player);
  }

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
  }

  /* Standing on something picks it up. One place, so walking onto a node and
     clicking its chip cannot behave differently. */
  pickUp(player){
    const node = this.nodes.find(n => n.x === player.x && n.y === player.y && !n.taken);
    if(!node) return;
    const cls = classById(player.classId);
    // A herb is the Alchemist's to bend down for — anyone else walks over it
    // and it stays where it grew. Caches and pages are for whoever gets there.
    if(node.kind === 'herb' && !(cls && cls.craft)) return;
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
  }

  brew(player, cls, { recipe: recipeId }){
    if(!cls || !cls.craft) return;
    const made = brew(recipeId, this.stash);
    if(!made) return;
    this.stash = made.stash;
    player.deck = [...player.deck, ...made.cards];
    const recipe = RECIPES[recipeId];
    this.log(`${player.name} brewed ${recipe.makes} ${recipe.name}${recipe.makes > 1 ? 's' : ''}.`);
  }

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
  }

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
  }

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
  }

  harvest(player, cls, { pot }){
    if(!cls || !cls.craft) return;
    const picked = harvestPot(this.pots, pot, this.stash);
    if(!picked) return;
    this.pots = picked.pots;
    this.stash = picked.stash;
    this.log(`${player.name} harvests ${picked.yielded} ${MATERIALS[picked.herb].name} from the pot.`);
  }

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
  }

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
  }

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
  }

  /* The deck list is the book's shadow, and it updates the moment the book
     does — an Echo Script socketed in a build phase shows its extra copy
     right away, not at the surge. Build phase only; a fight in progress
     keeps the deck it was dealt. */
  refreshBook(player){
    if(this.phase !== PHASES.build) return;
    player.deck = wizardCombatDeck(this.spellbook);
    player.discard = [];
    player.hand = [];
  }

  /* The composed spell behind a card in this room, or null when the card is
     an ordinary card — the one test for "does the new path apply". */
  spellFor(player, cardId){
    const cls = classById(player.classId);
    if(!cls || !cls.cast) return null;
    if(!(this.spellbook.known || []).includes(cardId)) return null;
    return composeSpell(cardId, this.spellbook.slots[cardId]);
  }

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
  }

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
  }

  /* ---- one effect, whoever it landed on ------------------------------- */

  /* Everybody with a seat, and everybody with a seat still on their feet. The
     party half of the card table is written against these two. */
  get party(){ return this.players.filter(p => p.classId); }
  get standing(){ return this.party.filter(p => !p.down); }

  /* Damage to a player from something that is not a monster's swing: rot, and
     anything else that reaches past guard. Guard is for the blow you saw
     coming, and rot is already inside you. */
  hurt(player, amount){
    if(amount <= 0 || player.down) return;
    this.score(player, 'taken', Math.min(amount, player.hp));
    player.hp = Math.max(0, player.hp - amount);
    this.downIf(player);
  }

  /* One number, added to one seat's record. Guarded rather than assumed: a
     player restored from a save written before stats existed has none, and a
     crash on the first swing of a resumed run would be a bad trade for a
     scoreboard. */
  score(player, key, amount){
    if(!player || !(amount > 0)) return;
    if(!player.stats) player.stats = blankStats();
    player.stats[key] = (player.stats[key] || 0) + amount;
  }

  /* Out of health is out of the fight. One place, so a player felled by rot
     drops their hand and says their line exactly as one felled by a swing. */
  downIf(player){
    if(player.hp > 0 || player.down) return;
    player.down = true;
    player.hand = [];
    player.intent = null;
    const cls = classById(player.classId);
    this.log(cls ? `${player.name}: "${cls.downLine}"` : `${player.name} goes down.`);
  }

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
  }

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
  }

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
  }

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
  }

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
  }

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
  }

  lose(){
    this.phase = PHASES.over;
    this.outcome = 'lost';
    this.log('The blight closes over the site. The ruin goes back to growing alone.');
    this.broadcast();
  }
}

export function roomFor(code){
  let room = rooms.get(code);
  if(!room){
    room = new Room(code);
    rooms.set(code, room);
  }
  return room;
}

export function dropIfEmpty(room){
  if(room.empty) rooms.delete(room.code);
}

export const roomCount = () => rooms.size;
