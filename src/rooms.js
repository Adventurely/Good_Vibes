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
  MATERIALS, SALVAGE, STARTING_SALVAGE, nodeYield, NODE_REFUSAL,
  BUILDINGS, UPGRADES, upgradeCost, buyUpgrade, canBuildMore, powerFrom,
  CARDS, cardById, cardEffect,
  RECIPES, brew, missingForBuilding, canBuildAt,
  actionsFor, actionCost, actionReady, freshStock, freshUses,
  CHARGE_CAP, CHARGE_REGEN,
  SPELLS, MODIFIERS, PAGES_PER_ROUND, freshSpellbook, composeSpell,
  rollOffers, takeOffer, moveModifier, draftableCount,
  POT_COUNT, plantPot, harvestPot, growPots,
  generateMap, generateCombatTerrain, respawnItems, spawnTile, pathTo,
  seededRandom, seedFromCode, readyState,
  freshPack, normalisePack, rollPackItems, packPlace, packMove, packRemove,
  packedCards, packedStats, packedAmount, packSpill, PACK_ITEMS,
  ENEMIES, waveFor, enemyStats, salvageAfterCombat, addSalvage, spendSalvage,
  AILMENTS, addEffect, addAilment, hasEffect, effectAmount, tickEffects,
  clearAilments, strikePower, effectName, blankStats, intentOf,
  BOLSTER_STEP, spawnsFor,
} from '../public/good-vibes/content.js';

const rooms = new Map();

/* Effect kinds that post their own fx events, one per thing they landed on.
   Everything else gets one generic event from resolve(). */
const SELF_DRAWN = new Set([
  'strike', 'strikeAll', 'wardAll', 'healAll', 'cleanse', 'might', 'revive',
  // The wave-facing kinds are here for a second reason as well: the generic
  // emitter looks its target up among the *players*, so an enemy id would fall
  // through to the caster and draw the effect on the wrong body.
  'canker', 'cankerAll', 'heft', 'cover', 'graft',
]);

export class Room {
  constructor(code){
    this.code = code;
    /* Which run this is in this room, and the reason the seed is not simply
       the code. A party that loses and goes again should get a different ruin;
       reusing the code's seed would hand them the same site, the same herbs and
       the same waves, which turns a second attempt into a memory test. */
    this.run = 0;
    this.seed = seedFromCode(code);
    /* Per room, not per process. It used to be a module-level counter, which
       is fine while every room lives in one Node process and wrong the moment
       they do not: a Durable Object is one room, woken from storage, with no
       memory of any other. Ids only ever have to be unique inside a room. */
    this.serial = 0;
    this.reseed();
    this.players = [];
    this.reset();
  }

  /* The generator, rebuilt from whatever this.seed currently is.
   *
   * It counts its own draws, because the deployed room hibernates: a closure
   * cannot be written to storage, but "the seed, and how many draws happened"
   * can, and replaying that many draws on wake reproduces the stream exactly.
   * Everything that needs a fresh generator goes through here, so the count
   * cannot be got round.
   */
  reseed(){
    this.rngCalls = 0;
    const inner = seededRandom(this.seed);
    this.random = () => { this.rngCalls += 1; return inner(); };
  }

  /* ---- hibernation ------------------------------------------------------
   *
   * A room on the deployed site is a Durable Object, and a Durable Object is
   * evicted whenever it goes quiet. What survives is whatever was written to
   * storage, so these two methods are the whole of the room's memory: what
   * goes into `serialize` comes back, and what does not is gone the first time
   * everybody steps away for ten minutes.
   *
   * Locally, `npm start` keeps rooms in a Map and never calls either of these.
   * They are still tested here, because "it worked on the dev server" is
   * exactly how state goes missing in the one place that matters.
   */

  /* Everything but the sockets and the generator closure. Player effect lists
     and stats, and every counter the telegraph is derived from — an enemy's
     turn, cast, might and charged — ride along in the spreads below. They have
     to survive a wake, or a Rust Hulk that slept mid-wind-up comes back having
     forgotten what it was about to do.

     `run` and `seed` are stored together and are not the same fact: a party
     that restarts moves the seed off the room code, so restoring a second run
     from the code alone would put it back in the first run's ruin. */
  serialize(){
    return {
      code: this.code, seed: this.seed, run: this.run,
      serial: this.serial, rngCalls: this.rngCalls,
      phase: this.phase, round: this.round, outcome: this.outcome,
      site: this.site, terrain: this.terrain, nodes: this.nodes,
      buildings: this.buildings, enemies: this.enemies,
      stash: this.stash, salvage: this.salvage, pages: this.pages,
      upgrades: this.upgrades, power: this.power,
      // The scriptorium and the garden. Both are run-length state the party
      // spends whole build phases on — a spellbook that came back empty after
      // a deploy would be four rounds of somebody's evening — so they
      // hibernate with everything else.
      spellbook: this.spellbook, offers: this.offers, pots: this.pots,
      players: this.players.map(({ socket, ...p }) => p),
    };
  }

  static restore(data){
    const room = new Room(data.code);
    Object.assign(room, {
      serial: data.serial || 0,
      phase: data.phase, round: data.round, outcome: data.outcome,
      site: data.site, terrain: data.terrain, nodes: data.nodes,
      buildings: data.buildings, enemies: data.enemies,
      stash: data.stash, salvage: data.salvage, pages: data.pages,
      upgrades: data.upgrades, power: data.power,
      // Defaulted rather than assumed: a room stored before the scriptorium
      // existed has none of these, and waking it must not throw.
      spellbook: data.spellbook || freshSpellbook(),
      offers: data.offers ?? null,
      pots: data.pots || Array(POT_COUNT).fill(null),
      // The socket is the one thing that cannot be stored. Whoever wakes the
      // room hands each seat a fresh one; until then a send is a no-op.
      //
      // The pack is normalised on the way back rather than trusted: a room
      // stored before it existed has none on its Hauler, and `{placed}` reached
      // for on undefined is a throw inside a Durable Object's wake-up.
      players: (data.players || []).map(p => ({
        ...p, socket: null, pack: p.pack ? normalisePack(p.pack) : null,
      })),
    });
    // The seed first, then the generator, then the replay. A restart moved the
    // seed off the room code, so rebuilding from the code would silently hand
    // the party the ruin they already played.
    room.run = data.run || 0;
    if(data.seed !== undefined) room.seed = data.seed;
    room.reseed();
    // Fast-forward the generator to where it was. The count is a few hundred
    // per run; the cost is microseconds, and the alternative is a fork in
    // every replay after a reload.
    const burn = data.rngCalls || 0;
    for(let i = 0; i < burn; i++) room.random();
    return room;
  }

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
  /* Rejoining is always the best option. A seat is held by a token rather than
     by a connection, so coming back mid-run means picking the same character
     up where it was left — including in the middle of a fight.

     The one thing a returning player can be missing is a hand: the round they
     were away for resolved without them, and resolve() only deals to the
     people who were in it. Dealt here rather than there, because "everybody
     playing has three cards" is a fact about the room and not about a round. */
  join(token, socket){
    let player = this.players.find(p => p.token === token);
    if(player){
      player.socket = socket;
      player.connected = true;
      // Nothing to restore but the seat itself. A returning player's pools
      // are their own state and never left — which is one more thing the
      // deck's removal made simpler rather than harder.
      // Somebody being away is one of the two things that decides a round, so
      // somebody arriving has to ask the question again — a party that all
      // committed while the last seat was disconnected is a party owed a
      // resolution the moment that seat is back and has committed too.
      this.settle();
      return player;
    }

    if(this.players.length >= this.maxPlayers) return null;
    if(this.phase !== PHASES.lobby) return null;   // no joining a run in progress

    player = {
      id: `p${++this.serial}`,
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
    }
    // The host is a role, not a person, and it has to survive them closing the
    // tab. It used to be reassigned in the lobby only, which meant a host who
    // dropped mid-run left a party that could not restart when the run ended:
    // `start` and `restart` are both host-only and there was no host.
    this.rehost();
    // A disconnect is one of the two things that can complete a phase, because
    // both "everybody is ready" and "everybody has committed" are counted over
    // the people who are actually here. Without this the last holdout dropping
    // froze the room until they came back.
    this.settle();
  }

  /* The oldest connected seat holds the room. A no-op while the current host is
     still here, so it is safe to call after anything that changes who is. */
  rehost(){
    if(this.players.some(p => p.host && p.connected)) return;
    const heir = this.players.find(p => p.connected);
    if(!heir) return;
    for(const p of this.players) p.host = p === heir;
    this.log(`${heir.name} is holding the room now.`);
  }

  /* Has the phase finished waiting on anybody?
   *
   * One rule, one place. Committing, readying, dropping and rejoining can all
   * make the answer change, so all four ask this rather than each keeping their
   * own copy of "and are we all in yet".
   *
   * Both halves count only the people who are here to be counted. A player who
   * dropped is not owed a turn; a player who dropped *after* committing still
   * gets the card they played, because resolve() walks intents rather than
   * connections. */
  settle(){
    if(this.phase === PHASES.build){
      if(!readyState(this.players.filter(p => p.classId)).all) return false;
      this.enterCombat();
      return true;
    }
    if(this.phase === PHASES.combat){
      const acting = this.players.filter(p => p.classId && p.connected && !p.down);
      if(acting.length && acting.every(p => p.intent)){ this.resolve(); return true; }
    }
    return false;
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
      // stored, so the telegraph cannot drift from the rule it reads. There is
      // no longer a seat on it: an attack lands on everybody, so "who is it
      // for" stopped being a question the plate had to answer.
      enemies: this.enemies.map(e => ({ ...e, intent: intentOf(e) })),
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
        /* The pools, and they are public.
         *
         * A hand was secret because a hand was a hand. A list of options is not
         * — and in a co-op game there was never a reason for it to be. This is
         * the payoff the deck's removal buys the table: everybody can see that
         * the Wizard has one charge left, that the rack is down to its last
         * Sunsalve, and that the Hauler can still afford to cover. The cards
         * that need two people to agree about a round in advance finally have
         * something to agree over. */
        charges: p.charges || 0,
        stock: p.stock || {},
        uses: p.uses || {},
        // The bag, and it is public like every other pool. A packing puzzle is
        // the best thing in this game to lean over somebody's shoulder at, and
        // the party has a real stake in it: whether the Stretcher went in is
        // whether anybody is getting back up.
        pack: p.pack || null,
        // Your own cards, and nobody else's — and your own commitment in full,
        // which is new and is the price of being able to change it: a player
        // who cannot see which card they chose cannot meaningfully choose
        // another one.
        ...(p.id === player.id
          ? { intent: p.intent }
          : {}),
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
    // Every fx carries the beat it landed on, stamped here — in the one place
    // events are made — rather than at forty call sites.
    const stamped = event.t === 'fx' ? { ...event, step: this.beat || 0 } : event;
    for(const p of this.players) p.events.push(stamped);
  }

  /* ---- the beat ------------------------------------------------------
   *
   * A round used to arrive at the client as one undifferentiated pile of fx
   * and play as a single volley: five cards and four monsters all going off in
   * the same 620ms. It read as a flash rather than as a turn, and with the
   * wave swinging at the whole party at once there was no way to tell whose
   * guard ate what.
   *
   * So resolution is numbered. Every fx event carries the beat it happened on,
   * and the client plays one beat at a time: each player's card in turn, then
   * the quiet gap where statuses bite, then each enemy's intent in turn. The
   * room still resolves the whole round in one pass and sends one view — the
   * beat is a stamp on what already happened, not a pause in the server.
   */
  nextBeat(){ this.beat = (this.beat || 0) + 1; }

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
      // The rack is the only thing a seat carries between fights, and only
      // the Alchemist has one. Everything else is per-fight and set in
      // enterCombat.
      p.stock = freshStock(cls.id);
      p.uses = {};
      p.charges = 0;
      // The bag is the second thing a seat carries between fights, and it
      // carries harder than the rack does: the rack empties as she drinks it
      // and the bag only ever grows. Get Behind Me is already in it — his floor,
      // for the reason CLASS_BASICS is everyone else's.
      p.pack = cls.haul ? freshPack() : null;
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

    /* Three things arrive at the Hauler's feet, unasked for and unchosen.
     *
     * Rolled here rather than offered, because the decision this seat owns is
     * *where*, never *which* — an offer of three to keep one is the Wizard's
     * bench and a second one would be her build phase in another colour. What
     * makes it a decision at all is that the bag is smaller than what turns up,
     * and anything still loose when the surge starts is left on the ground.
     *
     * From the room's generator like every other roll, so a room code is a run
     * — the same three items in the same order on the server, in the client and
     * in the tests.
     */
    for(const p of this.players){
      const cls = classById(p.classId);
      if(!cls || !cls.haul) continue;
      p.pack = normalisePack(p.pack);
      p.pack.loose = rollPackItems(this.random, p.pack.placed, 3);
      const names = p.pack.loose.map(id => PACK_ITEMS[id].name).join(', ');
      this.log(`${p.name} turns out the wreckage: ${names}.`);
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
               /* The four counters the telegraph is derived from. They live on
                  the enemy rather than being recomputed from a log nobody
                  keeps, because a room hibernates and comes back mid-fight.
                    turn     how many rounds it has acted for; the pattern
                             cycles on it, so it is the whole telegraph
                    cast     how many doses it has given; the boss walks its
                             ring of ailments on it
                    might    what it has bolstered onto itself, for good
                    charged  whether it spent last round winding up */
               turn: 0, cast: 0, might: 0, charged: false };
    });

    for(const p of this.players){
      if(!p.classId) continue;
      const cls = classById(p.classId);
      // What resets per fight and what does not is the whole of the class
      // economies. The Alchemist's rack carries — she brewed it, it is hers
      // until she drinks it. Everything else opens full: the Engineer's power
      // is made fresh by the panels, the Wizard's charges fill, and the
      // per-fight use counters go back to what the table says.
      p.uses = freshUses(p.classId);
      /* An Opening Word used to put its spell on top of the deck, so it was in
         the first hand dealt. There is no deck and no hand, so what it buys is
         a charge over the cap: the fight opens with more in the pool than a
         round can ever put back, which is the same promise — you get to say the
         big thing first — paid in the currency that still exists. It decays
         naturally, because regen tops out at CHARGE_CAP. */
      const opening = cls && cls.cast
        ? (this.spellbook.known || []).filter(id => {
            const composed = composeSpell(id, this.spellbook.slots[id]);
            return composed && composed.flags.opening;
          }).length
        : 0;
      p.charges = cls && cls.cast ? CHARGE_CAP + opening : 0;
      if(!p.stock) p.stock = freshStock(p.classId);
      p.block = 0;
      // A fight starts clean. Rot carried through a build phase would tick
      // where there is no combat screen to show it and no card to answer it
      // with — a status the player can neither see nor act on.
      p.effects = [];
      p.intent = null;
      p.ready = false;

      /* The bag closes.
       *
       * What is loose is left behind, and that is the whole rule the pack is
       * built on — he does not get to keep what he could not find room for.
       * Then the ballast pays out: flat, once, before anything has swung.
       *
       * Heft is applied here rather than granted as a card, and it is the
       * reason a bag is worth packing on a seat whose every other verb costs
       * blood. It is written `lasting` for the same reason Set Your Feet is:
       * bought for the fight, not rented for a round, and enterCombat empties
       * effects so "for the fight" stays literally true.
       */
      if(cls && cls.haul){
        p.pack = normalisePack(p.pack);
        if(p.pack.loose.length){
          const lost = p.pack.loose.map(id => PACK_ITEMS[id].name).join(', ');
          this.log(`${p.name} leaves it: ${lost}. It would not go in.`);
        }
        p.pack.loose = [];
        // Only ever grows, so nothing spills today. Checked anyway: a room
        // stored against a different schedule can wake holding a layout this
        // one has no room for, and a piece hanging off the edge is a thing
        // you would find out about in a fight.
        const spilled = packSpill(this.round, p.pack.placed);
        for(const over of spilled){
          this.log(`${PACK_ITEMS[over.id].name} no longer fits the bag and falls out.`);
        }
        if(spilled.length) p.pack.placed = p.pack.placed.filter(item => !spilled.includes(item));

        const carried = packedStats(p.pack.placed);
        if(carried.heft > 0){
          p.effects = addEffect(p.effects, {
            kind: 'heft', amount: carried.heft, rounds: 0, lasting: true,
          });
        }
        if(carried.ward > 0){
          p.block = (p.block || 0) + carried.ward;
          this.score(p, 'guard', carried.ward);
        }
        if(carried.regen > 0){
          p.effects = addEffect(p.effects, {
            // `rounds: 0` and `lasting`, never a big number: the client prints
            // the count beside the name and a chip reading "Mending 99" is a leak.
            kind: 'regen', amount: carried.regen, rounds: 0, lasting: true, fresh: true,
          });
        }
      }
    }

    this.event({ t: 'phase', ...phaseCard(this.round, PHASES.combat) });
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
      p.stock = freshStock(p.classId); p.uses = {}; p.charges = 0;
      // The bag empties with everything else a run accumulated. A second
      // attempt carrying the first one's Sledge would be a run that started in
      // the middle, and the seed already moved for the same reason.
      p.pack = null;
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
    // is the phase turning — and settle() is the one place that decides so,
    // shared with the disconnect and rejoin paths.
    this.settle();
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
      else if(intent.t === 'pack') this.packPut(player, cls, intent);
      else if(intent.t === 'shift') this.packShift(player, cls, intent);
      else if(intent.t === 'unpack') this.packTake(player, cls, intent);
      else if(intent.t === 'mod') this.moveMod(player, cls, intent);
      else if(intent.t === 'plant') this.plant(player, cls, intent);
      else if(intent.t === 'harvest') this.harvest(player, cls, intent);
      return this.broadcast();
    }

    if(this.phase === PHASES.combat){
      if(intent.t === 'action') this.commit(player, intent);
      else if(intent.t === 'wait') this.commit(player, { t: 'wait' });
      else if(intent.t === 'take') this.commit(player, { t: 'take' });
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
    /* What a seat is worth at a node, not who is allowed near it.
     *
     * A herb used to be the Alchemist's alone: everybody else walked over it
     * and it stayed where it grew. That made four of the five seats walk past
     * the thing the build phase is mostly made of, and it made a party without
     * her unable to brew at all — which is not scarcity, it is a locked door.
     *
     * The rule that replaced it is a stat, and `nodeYield` now applies it to
     * every kind rather than only to herbs. The same tile pays a different
     * amount depending on who stoops — the Alchemist two of anybody at a herb,
     * the Engineer three of a Hauler at a cache — and a seat the stat prices at
     * nothing gets nothing and leaves it for one it suits. So the Wizard no
     * longer walks off with a crate of pipe he cannot read, and the party keeps
     * the reason to send the person the node was made for.
     *
     * This is not the locked door again. Nothing is gated to a seat the party
     * can do without: three of the five crack caches, all five gather, and a
     * page is refused only to the four seats that could never spend one.
     */
    const yield_ = nodeYield(cls, node);
    if(yield_ <= 0){
      // Left standing on purpose. Saying so beats a click that looks broken.
      this.log(`${player.name} ${NODE_REFUSAL[node.kind] || 'leaves it where it lies.'}`);
      return;
    }
    node.taken = true;

    if(node.kind === 'herb'){
      this.stash = { ...this.stash, [node.material]: (this.stash[node.material] || 0) + yield_ };
      this.log(`${player.name} gathered ${yield_} ${MATERIALS[node.material].name}.`);
    }else if(node.kind === 'salvage'){
      this.salvage = addSalvage(this.salvage, { [node.salvage]: yield_ });
      this.log(`${player.name} cracked a cache: ${yield_} ${SALVAGE[node.salvage].name}.`);
    }else if(node.kind === 'pages'){
      this.pages += yield_;
      this.log(`${player.name} found ${yield_} spell page${yield_ === 1 ? '' : 's'}.`);
    }
  }

  brew(player, cls, { recipe: recipeId }){
    if(!cls || !cls.craft) return;
    const made = brew(recipeId, this.stash);
    if(!made) return;
    this.stash = made.stash;
    // Into the rack rather than into a deck. `makes` always meant "this many
    // doses"; it used to be spent dealing that many copies into a shuffle.
    player.stock = { ...player.stock, [made.card]: ((player.stock || {})[made.card] || 0) + made.cards.length };
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
    if(bought.adds === 'shots'){
      /* It used to push another Bolt Gun into his deck and hope he drew it.
         The gun is an action he always has, so what a second barrel buys is a
         cheaper shot — more bolts out of the same afternoon of sun. */
      const cost = actionCost('boltgun', null, this.upgrades).amount;
      this.log(`${UPGRADES[id].name}: a bolt costs ${cost} power now.`);
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

  /* ---- the pack ------------------------------------------------------- */

  /* Three intents, and between them the whole bench: put a loose item in,
   * move or turn one already in, take one back out.
   *
   * Rearranging is free and unlimited, for the reason the scriptorium's is —
   * the fiddling *is* the build phase, and charging for it would only teach
   * people to plan on paper first. What is not free is the space, and that is
   * the only price this seat pays here.
   *
   * Every one of them goes through pack.js and takes its answer: the helpers
   * return null rather than a half-applied bag, so an illegal drag is a no-op
   * and never a piece hanging off the edge. The room checks because the room
   * always checks — a client that says it fitted is a client, not an authority.
   */
  packPut(player, cls, { index, x, y, rot = 0 }){
    if(!cls || !cls.haul) return;
    const pack = normalisePack(player.pack);
    const id = pack.loose[index];
    if(!id) return;

    const placed = packPlace(this.round, pack.placed, id, x, y, rot);
    if(!placed) return;                       // it does not go there; nothing moved

    player.pack = { placed, loose: pack.loose.filter((_, i) => i !== index) };
    this.log(`${player.name} works ${PACK_ITEMS[id].name} into the bag.`);
    this.broadcast();
  }

  packShift(player, cls, { index, x, y, rot = 0 }){
    if(!cls || !cls.haul) return;
    const pack = normalisePack(player.pack);
    const placed = packMove(this.round, pack.placed, index, x, y, rot);
    if(!placed) return;
    player.pack = { ...pack, placed };
    this.broadcast();
  }

  /* Back to loose, not gone. Taking something out to try a different
     arrangement must not be the thing that loses it — it is lost when the
     surge starts, and only then. */
  packTake(player, cls, { index }){
    if(!cls || !cls.haul) return;
    const pack = normalisePack(player.pack);
    const { placed, id } = packRemove(pack.placed, index);
    if(!id) return;
    player.pack = { placed, loose: [...pack.loose, id] };
    this.broadcast();
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
    /* Nothing to rebuild. What she can cast is read off the book every time
       it is asked for — see actionIds — so drafting a spell mid-run makes it
       castable on the next round rather than on the next shuffle. */
  }

  /* The composed spell behind a card in this room, or null when the card is
     an ordinary card — the one test for "does the new path apply". */
  /* ---- what a seat can do -------------------------------------------
   *
   * There was a deck, a discard and a hand here, and a `deal` that drew three
   * of the first into the third every round. All of it is gone. A seat's
   * options are a list it can always see, and what limits them is the economy
   * its class was already built around — see the actions section in
   * `content.js` for why the shuffle was only ever a translation layer.
   */

  /* Every id this seat could take, in the order the client draws them: the two
     basics, then whatever the class owns, then anything handed to it.

     The Wizard's book is appended rather than listed, because what she can cast
     is written at the bench and is not knowable from her class id. A spell she
     knows *replaces* the plain card of the same name — that rule predates this
     rewrite and `spellFor` is still the one place it lives. */
  actionIds(player){
    const cls = classById(player.classId);
    const ids = actionsFor(player.classId);
    if(cls && cls.cast){
      for(const id of (this.spellbook.known || [])) if(!ids.includes(id)) ids.push(id);
    }
    // The Hauler's bag, appended for the same reason the book is: what this
    // seat can do is not knowable from its class id. CLASS_ACTIONS.hauler is
    // empty, so this is the *only* thing between him and two basics.
    if(cls && cls.haul){
      for(const id of packedCards((player.pack || {}).placed)) if(!ids.includes(id)) ids.push(id);
    }
    // A Cutting is the one thing nobody owns: it arrives because somebody else
    // spent a turn binding it on, and it leaves when it is swung.
    if(((player.uses || {}).cutting || 0) > 0) ids.push('cutting');
    return ids;
  }

  /* The composed spell behind an id, or null for everything that is not one. */
  spellFor(player, cardId){
    const cls = classById(player.classId);
    if(!cls || !cls.cast) return null;
    if(!(this.spellbook.known || []).includes(cardId)) return null;
    return composeSpell(cardId, this.spellbook.slots[cardId]);
  }

  /* The pools an action is checked against, in the shape `actionReady` reads.
     Power is the room's and everything else is the seat's, which is the whole
     difference between the Engineer's economy and the other four. */
  seatState(player){
    return {
      power: this.power || 0,
      charges: player.charges || 0,
      hp: player.hp,
      stock: player.stock || {},
      uses: player.uses || {},
      // The workbench prices the bolt gun, so what the party built has to be
      // in the same object the cost is read against.
      upgrades: this.upgrades || {},
    };
  }

  /* What one action costs its seat, paid at resolution rather than on the
     click — a commitment can still be taken back, and a charge spent on an
     action that was never taken would be a charge gone for nothing. */
  pay(player, id, spell){
    const cost = actionCost(id, spell, this.upgrades);
    if(!cost) return;
    if(cost.pool === 'power'){
      this.power = Math.max(0, (this.power || 0) - cost.amount);
    }else if(cost.pool === 'charges'){
      player.charges = Math.max(0, (player.charges || 0) - cost.amount);
    }else if(cost.pool === 'hp'){
      // The Hauler's price. Not through hurt(), because hurt() can put a
      // player down and an action must never be the thing that kills you —
      // actionReady refuses the play at or below the cost and this clamp is
      // the second belt. Scored as taken on purpose: the record should show
      // who bled, and the Hauler bleeds deliberately.
      const paid = Math.min(cost.amount, player.hp - 1);
      if(paid > 0){ player.hp -= paid; this.score(player, 'taken', paid); }
    }else if(cost.pool === 'stock'){
      player.stock = { ...player.stock, [id]: Math.max(0, (player.stock[id] || 0) - 1) };
    }else if(cost.pool === 'uses'){
      player.uses = { ...player.uses, [id]: Math.max(0, (player.uses[id] || 0) - 1) };
    }
  }

  /* ---- combat, resolved when the last commitment is in ---------------- */

  /* A commitment is a pencil, not a pen.
   *
   * It used to be final the instant it was made, which punished exactly the
   * wrong person: the fastest reader at the table commits first, watches two
   * allies commit around them, realises the plan is now wrong, and is the one
   * seat that cannot adapt. In a co-op game where the whole round resolves at
   * once, that is backwards.
   *
   * So a choice can be changed — swapped for another action, or taken back to
   * undecided — right up until the last seat is in, which is the moment the
   * round resolves and there is nothing left to change it against. The last
   * player to commit is the one who does not get to reconsider, and that is a
   * fair price for being last.
   */
  commit(player, intent){
    if(player.down) return this.broadcast();

    if(intent.t === 'take'){
      player.intent = null;
      return this.broadcast();
    }

    if(intent.t === 'action'){
      const id = intent.id;
      if(!this.actionIds(player).includes(id)) return this.broadcast();
      const spell = this.spellFor(player, id);
      if(!spell && !CARDS[id]) return this.broadcast();
      if(!actionReady(id, this.seatState(player), spell).ok) return this.broadcast();
      player.intent = { t: 'action', id, target: intent.target || null };
    }else{
      player.intent = { t: 'wait' };
    }

    this.broadcast();
    this.settle();
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

    // Beat zero is the board as it stood when the last player committed.
    // Everything below numbers itself off this, and the client plays the
    // numbers in order — the party first, one seat at a time, then the wave.
    this.beat = 0;

    for(const player of order){
      const intent = player.intent;
      if(intent.t !== 'action') continue;
      this.nextBeat();                        // this seat's turn on the board

      // Stunned is the one status that costs the turn rather than shading it.
      // The cost is not paid and the action is not spent — there is no hand to
      // drop it out of any more, so a stun costs the round and nothing else.
      if(hasEffect(player.effects, 'stun')){
        this.event({ t: 'fx', kind: 'stun', player: player.id });
        this.log(`${player.name} is still finding their feet.`);
        continue;
      }

      const id = intent.id;
      const spell = this.spellFor(player, id);
      const card = CARDS[id];
      if(!spell && !card) continue;
      // Checked again at resolution, not only at the click: two seats can both
      // commit a Bolt Gun against one panel's worth of power, and the second
      // one to resolve has to find the pool empty rather than take it negative.
      if(!actionReady(id, this.seatState(player), spell).ok){
        this.log(`${player.name} reaches for the ${(card || spell).name} and finds nothing left.`);
        continue;
      }

      this.pay(player, id, spell);

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

      /* The bag reaches the fight through the number, the way the workbench
         does: cardEffect prices the bolt gun off the upgrades and packedAmount
         prices the crossbow off the Bolt Cases beside it. Both are pure and
         shared, so the button and the resolution cannot disagree about how
         hard the thing hits. */
      const base = spell ? spell.effect : cardEffect(id, this.upgrades);
      const effect = spell ? base : {
        ...base, amount: packedAmount(id, base.amount, ((player.pack || {}).placed)),
      };
      const label = spell ? spell.name : card.name;

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
      const landed = this.apply(player, effect, label, target, id) || 0;

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
      }
    }

    for(const player of order) player.intent = null;

    // Ailments bite and age before the wave lands new ones, so a rot dealt this
    // round does not also tick this round and a stun lasts exactly the one turn
    // it says it does. One beat for the whole quiet gap: rot and canker are not
    // anybody's turn, they are the room settling between the two halves of it.
    this.nextBeat();
    this.tickAilments();
    this.tickCanker();
    this.advanceWave();

    if(this.enemies.every(e => e.hp <= 0)) return this.winRound();
    if(this.players.filter(p => p.classId).every(p => p.down)) return this.lose();

    // The Wizard's pool comes back a little at the top of every round, which is
    // the whole of her economy: her question is always this round or next.
    for(const p of this.party){
      if(p.down) continue;
      const cls = classById(p.classId);
      if(cls && cls.cast) p.charges = Math.min(CHARGE_CAP, (p.charges || 0) + CHARGE_REGEN);
    }
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
     loses their turn and says their line exactly as one felled by a swing. */
  downIf(player){
    if(player.hp > 0 || player.down) return;
    player.down = true;
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
      /* A Cutting used to go on top of an ally's deck, which guaranteed it
         was in their hand next round. There is no deck to sit on top of now,
         so it arrives as a use instead — and the certainty that made it a
         coordination card rather than a lottery ticket is if anything sharper:
         it is on their board the moment it is bound, and everyone can see it. */
      const who = ally();
      who.uses = { ...who.uses, cutting: ((who.uses || {}).cutting || 0) + effect.amount };
      this.event({ t: 'fx', kind: 'graft', player: who.id });
      this.log(`${player.name} binds a cutting to ${who.name}'s arm. It is theirs to swing.`);

    }else if(effect.kind === 'revive'){
      const down = this.party.filter(p => p.down);
      const target = down.find(p => p.id === targetId) || down[0];
      if(target){
        target.down = false;
        target.hp = Math.min(target.maxHp, effect.amount);
        target.effects = clearAilments(target.effects);
        this.score(player, 'revived', 1);
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

  /* The wave's turn, one enemy at a time, each doing the thing its plate said
   * it would do.
   *
   * The shape of this changed completely. It used to be a round-robin: every
   * enemy swung, and each swing found one seat, rotating so a five-player fight
   * did not gang up on seat one. That made "who is it aimed at" the interesting
   * half of the telegraph and gave the Hauler a job, but it also meant a wave
   * of two against a table of five was mostly a wave hitting nobody, and the
   * damage a party actually took depended on a rotation nobody could influence.
   *
   * An attack lands on everybody now. What an enemy does is the question, not
   * who it picked, and the four things it can do are in ENEMY_INTENTS:
   *
   *   attack   every standing player, for the number on the plate
   *   blight   less damage, and the ailment is the point
   *   charge   nothing, and twice as much next round
   *   bolster  nothing, and more every round after
   *
   * Every one of them reads intentOf() rather than deciding for itself, so what
   * the party was promised is exactly what arrives. And every one takes its own
   * beat, so the client can play them consecutively rather than as one flash.
   *
   * Kept under the old name because the call site, the tests and the ported
   * copy all say advanceWave, and renaming it would be a diff about a word.
   */
  advanceWave(){
    if(!this.standing.length) return;

    for(const enemy of this.enemies){
      if(enemy.hp <= 0) continue;
      const intent = intentOf(enemy);
      if(!intent) continue;

      this.nextBeat();                          // this thing's turn on the board

      // Counted before the intent runs, so an enemy killed mid-round has still
      // advanced its pattern and comes back to the next wave where it left off.
      enemy.turn = (enemy.turn || 0) + 1;

      if(intent.kind === 'charge'){
        // The one intent that is a countdown, and the only reason a wind-up is
        // a decision rather than a free round: the plate already says what is
        // coming, so a party can spend this round putting guard up, killing it,
        // or accepting the hit.
        enemy.charged = true;
        this.event({ t: 'fx', kind: 'charge', target: enemy.id });
        this.log(`The ${enemy.name} winds up. Whatever lands next round lands for ${intent.next}.`);
        continue;
      }

      if(intent.kind === 'bolster'){
        enemy.might = (enemy.might || 0) + intent.gain;
        this.event({ t: 'fx', kind: 'bolster', target: enemy.id });
        this.log(`The ${enemy.name} feeds on the ruin. It swings for ${intent.gain} more from here on.`);
        continue;
      }

      this.swing(enemy, intent);

      // Spent on the blow it was saved for. Cleared after the swing rather than
      // before it, so enemyDamage() inside swing() is still reading the doubled
      // number the plate promised.
      enemy.charged = false;
    }
  }

  /* One hostile intent landing on the whole party.
   *
   * Guard is per player and comes off the top of each share: a Bulwark on five
   * seats is five separate subtractions, not one pool. That is what makes the
   * party-wide defends worth their worse per-head numbers now that the wave is
   * party-wide too.
   *
   * `cover` survives the change with its sentence intact. The Hauler is still
   * the only seat that decides who takes a blow — they now stand in front of
   * each ally's share in turn, a point of guard per point of damage, until the
   * guard runs out and the wave goes back to finding everybody.
   */
  swing(enemy, intent){
    const standing = this.standing;
    if(!standing.length) return;

    const dose = intent.kind === 'blight';
    const damage = intent.damage;
    const coverer = standing.find(p => hasEffect(p.effects, 'cover'));
    let through = 0;                            // did any of it reach anybody

    this.log(dose
      ? `The ${enemy.name} opens up. ${damage} on everyone, and ${effectName(intent.ail)} in it.`
      : `The ${enemy.name} swings at the whole party for ${damage}.`);

    for(const victim of standing){
      // Who actually eats this share. The coverer stands in for anybody else
      // while their own guard lasts; the moment it is gone the shares go back
      // to the people they were aimed at.
      const taker = (coverer && coverer !== victim && !coverer.down && (coverer.block || 0) > 0)
        ? coverer
        : victim;
      if(taker.down) continue;

      this.event({ t: 'fx', kind: 'hit', player: taker.id, from: enemy.id });

      const blocked = Math.min(taker.block || 0, damage);
      taker.block = (taker.block || 0) - blocked;
      const took = damage - blocked;

      if(took > 0){
        through += 1;
        this.score(taker, 'taken', Math.min(took, taker.hp));
        taker.hp = Math.max(0, taker.hp - took);
      }

      this.log(blocked
        ? `${taker.name} takes ${took}; guard eats ${blocked}.`
        : `${taker.name} takes ${took}.`);

      // A blow that guard swallowed whole leaves nothing behind. That is still
      // the reason to spend a card on a ward against a Creeper rather than
      // trade with it: you are not buying health, you are buying the two rounds
      // of Weakened that would have followed.
      if(dose && took > 0 && intent.ail && !taker.down){
        taker.effects = addAilment(taker.effects, intent.ail, enemy.id);
        this.event({ t: 'fx', kind: 'ail', ail: intent.ail, player: taker.id, from: enemy.id });
        this.log(`${taker.name} is ${effectName(intent.ail)}. ${AILMENTS[intent.ail].note}`);
      }

      this.downIf(taker);
    }

    // The ring only turns on a dose that reached somebody, so a party that
    // guarded the whole thing off has genuinely refused it rather than merely
    // survived it — the boss walks to its next ailment only when the last one
    // was actually given.
    if(dose && through > 0) enemy.cast = (enemy.cast || 0) + 1;
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
