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
  CARDS, cardById, cardEffect, cardPlayable, deckFor, shuffle, draw, discardHand,
  HAND_SIZE, RECIPES, brew, missingForBuilding, canBuildAt,
  generateMap, generateCombatTerrain, spawnTile, pathTo,
  seededRandom, seedFromCode, readyState,
  ENEMIES, waveFor, salvageAfterCombat, addSalvage, spendSalvage,
} from '../public/content.js';

const rooms = new Map();

/* Each player's shuffles come from their own stream. One shared generator would
   make your draw depend on how many cards somebody else drew first. */
const streamFor = (seed, id) => seededRandom(seedFromCode(`${seed}:${id}`));

let serial = 0;

class Room {
  constructor(code){
    this.code = code;
    this.seed = seedFromCode(code);
    this.random = seededRandom(this.seed);
    this.players = [];
    this.reset();
  }

  reset(){
    this.phase = PHASES.lobby;
    this.round = 1;
    this.terrain = [];
    this.nodes = [];
    this.buildings = [];
    this.enemies = [];
    this.stash = {};
    this.salvage = { ...STARTING_SALVAGE };
    this.pages = 2;
    this.upgrades = {};
    this.power = 0;
    this.outcome = null;
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
      enemies: this.enemies,
      stash: this.stash,
      salvage: this.salvage,
      pages: this.pages,
      upgrades: this.upgrades,
      power: this.power,
      outcome: this.outcome,
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
        effects: [],
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
      p.deck = deckFor(cls.id);
      p.discard = [];
      p.hand = [];
      p.down = false;
    }
    this.round = 1;
    this.enterBuild();
  }

  enterBuild(){
    const { terrain, nodes } = generateMap(this.random);
    this.phase = PHASES.build;
    this.terrain = terrain;
    this.nodes = nodes;
    this.buildings = [];     // the site is new each round — see the README gap
    this.enemies = [];
    this.power = 0;

    this.players.forEach((p, i) => {
      const start = spawnTile(terrain, i * 2);
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
    this.power = powerFrom(this.buildings);
    this.enemies = waveFor(this.round).map((type, i) => {
      const def = ENEMIES[type];
      return { id: `e${i}`, type, name: def.name, art: def.art,
               hp: def.hp, maxHp: def.hp, dist: def.dist, hits: def.hits };
    });

    for(const p of this.players){
      if(!p.classId) continue;
      // Everything the player owns goes back in: a hand held when the last wave
      // broke is still theirs.
      p.deck = shuffle([...p.deck, ...p.discard, ...p.hand], streamFor(this.seed, p.id));
      p.discard = [];
      p.hand = [];
      p.block = 0;
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
    if(msg.t === 'intent') return this.intent(player, msg.intent || {});
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

  /* ---- combat, resolved when the last commitment is in ---------------- */

  commit(player, intent){
    if(player.down || player.intent) return this.broadcast();

    if(intent.t === 'play'){
      const cardId = player.hand[intent.index];
      if(!cardId || cardId !== intent.card) return this.broadcast();
      if(!cardPlayable(cardId, {
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

      const card = cardById(intent.card);
      if(!card) continue;
      if(card.pageCost) this.pages -= card.pageCost;
      if(card.powerCost) this.power -= card.powerCost;

      const effect = cardEffect(intent.card, this.upgrades);
      this.apply(player, effect, card.name, intent.target);
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

    this.advanceWave();

    if(this.enemies.every(e => e.hp <= 0)) return this.winRound();
    if(this.players.filter(p => p.classId).every(p => p.down)) return this.lose();

    for(const player of order) if(!player.down) this.deal(player);
    for(const p of this.players) p.block = 0;
    this.broadcast();
  }

  apply(player, effect, label, targetId){
    if(effect.kind === 'strike'){
      const alive = this.enemies.filter(e => e.hp > 0);
      const target = alive.find(e => e.id === targetId)
        || [...alive].sort((a, b) => a.dist - b.dist)[0];
      if(!target) return;
      target.hp = Math.max(0, target.hp - effect.amount);
      this.log(`${player.name}'s ${label} hits the ${target.name} for ${effect.amount}.`);
      if(target.hp <= 0) this.log(`The ${target.name} comes apart.`);
    }else if(effect.kind === 'ward'){
      const who = this.players.find(p => p.id === targetId) || player;
      who.block = (who.block || 0) + effect.amount;
      this.log(`${player.name}'s ${label} puts ${effect.amount} of guard on ${who.name}.`);
    }else if(effect.kind === 'heal'){
      const who = this.players.find(p => p.id === targetId) || player;
      const before = who.hp;
      who.hp = Math.min(who.maxHp, who.hp + effect.amount);
      this.log(`${player.name}'s ${label} mends ${who.hp - before} on ${who.name}.`);
    }
  }

  /* The wave closes, and whatever arrived hits somebody. Round-robin across
     the standing party rather than always the same person, so a five-player
     fight does not quietly gang up on seat one. */
  advanceWave(){
    const standing = this.players.filter(p => p.classId && !p.down);
    if(!standing.length) return;
    let turn = 0;

    for(const enemy of this.enemies){
      if(enemy.hp <= 0) continue;
      if(enemy.dist > 0){ enemy.dist -= 1; continue; }

      const victim = standing[turn++ % standing.length];
      const blocked = Math.min(victim.block || 0, enemy.hits);
      victim.block = (victim.block || 0) - blocked;
      const through = enemy.hits - blocked;
      if(through > 0) victim.hp = Math.max(0, victim.hp - through);

      this.log(blocked
        ? `The ${enemy.name} hits ${victim.name} for ${enemy.hits}; guard eats ${blocked}.`
        : `The ${enemy.name} hits ${victim.name} for ${enemy.hits}.`);

      if(victim.hp <= 0 && !victim.down){
        victim.down = true;
        victim.hand = [];
        victim.intent = null;
        const cls = classById(victim.classId);
        this.log(cls ? `${victim.name}: "${cls.downLine}"` : `${victim.name} goes down.`);
      }
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
