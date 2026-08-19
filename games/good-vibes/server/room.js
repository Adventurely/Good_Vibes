/* The authoritative game state, and the only thing allowed to write it.
 *
 * Clients send intents and get back a view. They never decide anything: not
 * what a card does, not whether a tile was reachable, not whose turn resolved
 * first. That is what makes cheating a non-issue, and it is why every rule
 * comes out of ../shared — the same modules the browser imports, so the two
 * ends cannot disagree about what a potion does.
 *
 * The class is assembled from four files. This one holds the lifecycle: seats,
 * phases, and the run. The other three are mixed into the prototype below —
 * view.js (what a seat may see), actions.js (the build phase) and combat.js
 * (the surge). They are separate files because they are separate concerns, not
 * separate objects: all of them run against this room's `this`.
 *
 * Determinism. Every shuffle and every roll comes from a seeded generator
 * owned by the room, and each player has their own stream, so one player
 * drawing cannot shift anyone else's draw.
 */

import {
  ENEMIES, HAND_SIZE, PAGES_PER_ROUND, PARTY_SIZE, PHASES, POT_COUNT, STARTING_SALVAGE,
  blankStats, classById, classKit, composeSpell, draw, enemyStats, freshSpellbook,
  generateCombatTerrain, generateMap, growPots, phaseCard, playableClasses, powerFrom,
  readyState, respawnItems, seedFromCode, seededRandom, shuffle, spawnTile, spawnsFor,
  waveFor, wizardCombatDeck
} from '../public/shared/index.js';
import { view } from './view.js';
import { actions } from './actions.js';
import { combat } from './combat.js';

/* Each player's shuffles come from their own stream. One shared generator would
   make your draw depend on how many cards somebody else drew first. */
const streamFor = (seed, id) => seededRandom(seedFromCode(`${seed}:${id}`));

let serial = 0;

export class Room {
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
}

/* Mixed in with descriptors rather than Object.assign, so a getter in one of
   these stays a getter instead of being called once and frozen to its value. */
for (const part of [view, actions, combat]) {
  Object.defineProperties(Room.prototype, Object.getOwnPropertyDescriptors(part));
}
