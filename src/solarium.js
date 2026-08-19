/* Save Solarium — rules engine.
 *
 * Pure functions over a plain state object. The Durable Object owns the state
 * and calls in here; nothing in this file touches storage, sockets or time.
 * That means the client can never be trusted with a rule — it only sends
 * intents, and every one of them is re-checked here.
 *
 * Actions append to `state.events`, which the client drains to animate. The
 * events are descriptive ("hero 2 hit enemy 1 for 8") rather than instructions,
 * so a client that misses one still renders the correct end state.
 */

/* Content lives under public/ rather than src/ so the browser can import the
   exact same module the server rules run on — one source for cards and art,
   no risk of the client rendering a card the engine does not have. */
import { CARDS, CLASSES, ENEMIES, HAND_SIZE, SOLAR_PER_ROUND, FIGHTS_BEFORE_BOSS,
         MOB_HP_PER_EXTRA_PLAYER, MOB_DMG_PER_EXTRA_PLAYER, MOB_AOE_PER_EXTRA_PLAYER,
         LEVEL_HP, LEVEL_DMG,
         buildEncounter, rewardPool } from '../public/solarium/content.js';

/* Seeded RNG so a room's shuffles are reproducible from its log if we ever
   need to debug one. mulberry32 — small, fast, good enough for card order. */
export function rng32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shuffle = (arr, rnd) => {
  for(let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

/* Events are drained by the room after every broadcast. The cap is insurance:
   if a room ever stops broadcasting, this keeps the persisted state bounded
   instead of growing until the object cannot be saved. */
const EVENT_CAP = 300;
const ev = (state, type, data) => {
  state.events.push({ type, ...data });
  if(state.events.length > EVENT_CAP) state.events.splice(0, state.events.length - EVENT_CAP);
};

/* ------------------------------------------------------------------ setup */

export function newRoom(code, seed, dev){
  return {
    code, seed,
    /* Dev rooms are opt-in at creation and can never be switched on later, so a
       real run cannot have the controls appear halfway through it. Everything
       under devCommand() checks this first. */
    dev: !!dev,
    snaps: {},
    phase: 'lobby',
    players: [],
    enemies: [],
    level: 0,
    round: 0,
    turret: {},          // playerId -> damage per round
    rewards: null,
    events: [],
    version: 0
  };
}

export function addPlayer(state, id, name){
  if(state.phase !== 'lobby') throw new Error('That run has already started.');
  if(state.players.length >= 5) throw new Error('This room is full (5 players).');
  if(state.players.some(p => p.id === id)) return;
  state.players.push({
    id, name: String(name || 'Player').slice(0, 14),
    classId: null, ready: false, connected: true,
    hp: 0, maxHp: 0, shield: 0, solar: 0, bonusSolar: 0,
    might: 0, thorns: 0, regen: 0, taunt: false, weaken: 0,
    draw: [], hand: [], discard: [], deck: [], ended: false
  });
}

export function setClass(state, id, classId){
  if(state.phase !== 'lobby') throw new Error('The run has already started.');
  const p = state.players.find(x => x.id === id);
  if(!p) throw new Error('You are not in this room.');
  if(classId && state.players.some(x => x.id !== id && x.classId === classId))
    throw new Error('Someone already picked that class.');
  const cls = CLASSES.find(c => c.id === classId);
  p.classId = cls ? cls.id : null;
  p.ready = false;
}

export function setReady(state, id, ready){
  const p = state.players.find(x => x.id === id);
  if(!p) return;
  if(!p.classId) throw new Error('Pick a class first.');
  p.ready = !!ready;
}

export function startRun(state, id){
  if(state.phase !== 'lobby') throw new Error('Already started.');
  if(state.players[0]?.id !== id) throw new Error('Only the host can start.');
  const ready = state.players.filter(p => p.classId);
  if(!ready.length) throw new Error('Nobody has picked a class.');
  if(!state.players.every(p => p.classId && p.ready))
    throw new Error('Everyone needs a class and a ready check.');

  for(const p of state.players){
    const cls = CLASSES.find(c => c.id === p.classId);
    p.maxHp = cls.hp; p.hp = cls.hp;
    p.deck = cls.deck.slice();
  }
  state.level = 0;
  startFight(state);
}

/* ------------------------------------------------------------------ fight */

export function startFight(state){
  const rnd = rng32(state.seed + state.level * 7919);
  const n = state.players.length;
  const { keys, baseCount } = buildEncounter(state.level, n, rnd);

  /* Scale the encounter's total health, then spread it across however many
     bodies were fielded. Health per enemy therefore drops as the crowd grows,
     which keeps a fight the same length whether it is two big things or six
     small ones — and stops area damage from being quietly worth more to a
     wide party than a narrow one. */
  const totalMult = (1 + MOB_HP_PER_EXTRA_PLAYER * (n - 1)) * (LEVEL_HP[state.level] ?? 1);
  const spread = baseCount / keys.length;

  state.enemies = keys.map((k, i) => {
    const e = ENEMIES[k];
    const hp = Math.max(8, Math.round(e.hp * (e.boss ? n : totalMult * spread)));
    return { uid: 'e' + i, key: k, name: e.name, art: e.art, boss: !!e.boss,
             hp, maxHp: hp, shield: 0, rust: 0, intent: null };
  });

  state.phase = 'playing';
  state.round = 0;
  state.turret = {};
  for(const p of state.players){
    p.shield = 0; p.might = 0; p.thorns = 0; p.regen = 0; p.weaken = 0;
    p.taunt = false; p.bonusSolar = 0;
    p.draw = shuffle(p.deck.slice(), rng32(state.seed + state.level * 31 + p.id.charCodeAt(0)));
    p.hand = []; p.discard = [];
  }
  ev(state, 'fightStart', { level: state.level, boss: state.enemies.some(e => e.boss) });
  /* Taken once the encounter exists and the decks are shuffled, but before the
     first hand is dealt. Snapshotting any earlier caught the board between
     fights and rewound to an empty arena. */
  if(state.dev) state.snaps[state.level] = snapshot(state);
  startRound(state);
}

function drawCards(state, p, n){
  for(let i = 0; i < n; i++){
    if(!p.draw.length){
      if(!p.discard.length) break;          // genuinely out of cards
      p.draw = shuffle(p.discard.slice(), rng32(state.seed + state.round * 131 + p.hand.length));
      p.discard = [];
      ev(state, 'reshuffle', { player: p.id });
    }
    p.hand.push(p.draw.pop());
  }
}

export function startRound(state){
  state.round++;
  for(const p of state.players){
    if(p.hp <= 0){ p.ended = true; continue; }
    p.ended = false;
    p.solar = SOLAR_PER_ROUND + p.bonusSolar;
    p.bonusSolar = 0;
    // Shield does not carry: it is a stance for the round, not a resource.
    p.shield = 0;
    p.taunt = false;
    p.thorns = 0;
    if(p.regen > 0){
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + p.regen);
      if(p.hp > before) ev(state, 'heal', { target: p.id, amount: p.hp - before, source: 'regen' });
      p.regen = Math.max(0, p.regen - 1);
    }
    // Weaken has to decay. Without it, stacks outgrow every attack in the game,
    // damage floors at zero and the fight can never end either way.
    p.weaken = Math.max(0, p.weaken - 1);
    // Whole hand goes to discard and a fresh four come up.
    p.discard.push(...p.hand);
    p.hand = [];
    drawCards(state, p, HAND_SIZE);
  }
  rollIntents(state);
  ev(state, 'roundStart', { round: state.round });
}

function rollIntents(state){
  const rnd = rng32(state.seed + state.round * 977 + state.level);
  const n = state.players.length;
  // Scaling is baked into the intent rather than applied when it resolves, so
  // the number the player reads on the enemy is the number they will take.
  const curve = LEVEL_DMG[state.level] ?? 1;
  const single = (1 + MOB_DMG_PER_EXTRA_PLAYER * (n - 1)) * curve;
  const aoe = (1 + MOB_AOE_PER_EXTRA_PLAYER * (n - 1)) * curve;
  for(const e of state.enemies){
    if(e.hp <= 0){ e.intent = null; continue; }
    const moves = ENEMIES[e.key].moves;
    const move = moves[Math.floor(rnd() * moves.length)];
    const mult = move.kind === 'attack' ? single : move.kind === 'attackAll' ? aoe : 1;
    e.intent = { ...move, v: Math.round(move.v * mult) };
  }
}

/* ---------------------------------------------------------------- effects */

const living = state => state.players.filter(p => p.hp > 0);
const livingEnemies = state => state.enemies.filter(e => e.hp > 0);

/* Damage reports what reached health and what the shield ate, separately.
   Showing the raw swing over a shielded target is a lie the player then has to
   reconcile against a health bar that did not move. */
function hurtEnemy(state, enemy, amount, sourceId){
  if(enemy.hp <= 0) return;
  let dmg = Math.max(0, Math.round(amount));
  let absorbed = 0;
  if(enemy.shield > 0){
    absorbed = Math.min(enemy.shield, dmg);
    enemy.shield -= absorbed; dmg -= absorbed;
  }
  enemy.hp = Math.max(0, enemy.hp - dmg);
  ev(state, 'damage', { target: enemy.uid, amount: dmg, absorbed, source: sourceId });
  if(enemy.hp === 0) ev(state, 'die', { target: enemy.uid });
}

function hurtPlayer(state, p, amount, sourceUid){
  if(p.hp <= 0) return;
  let dmg = Math.max(0, Math.round(amount));
  let absorbed = 0;
  if(p.shield > 0){
    absorbed = Math.min(p.shield, dmg);
    p.shield -= absorbed; dmg -= absorbed;
  }
  p.hp = Math.max(0, p.hp - dmg);
  ev(state, 'damage', { target: p.id, amount: dmg, absorbed, source: sourceUid });
  if(p.thorns > 0 && sourceUid){
    const e = state.enemies.find(x => x.uid === sourceUid);
    if(e) hurtEnemy(state, e, p.thorns, p.id);
  }
  if(p.hp === 0){ p.ended = true; ev(state, 'down', { target: p.id }); }
}

function healPlayer(state, p, amount){
  if(p.hp <= 0) return;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  if(p.hp > before) ev(state, 'heal', { target: p.id, amount: p.hp - before });
}

function applyFx(state, actor, fx, targetPlayer, targetEnemy){
  const times = fx.times || 1;
  for(let t = 0; t < times; t++){
    switch(fx.op){
      case 'damage': {
        if(!targetEnemy) throw new Error('Pick an enemy.');
        hurtEnemy(state, targetEnemy, fx.v + actor.might - actor.weaken, actor.id);
        break;
      }
      case 'damageAll':
        for(const e of livingEnemies(state)) hurtEnemy(state, e, fx.v + actor.might - actor.weaken, actor.id);
        break;
      case 'damageRusted': {
        if(!targetEnemy) throw new Error('Pick an enemy.');
        const base = targetEnemy.rust > 0 ? fx.v2 : fx.v;
        hurtEnemy(state, targetEnemy, base + actor.might - actor.weaken, actor.id);
        break;
      }
      case 'rust':
        if(!targetEnemy) throw new Error('Pick an enemy.');
        targetEnemy.rust += fx.v;
        ev(state, 'status', { target: targetEnemy.uid, kind: 'rust', amount: fx.v });
        break;
      case 'heal':
        if(!targetPlayer) throw new Error('Pick an ally.');
        healPlayer(state, targetPlayer, fx.v);
        break;
      case 'healAll':
        for(const p of living(state)) healPlayer(state, p, fx.v);
        break;
      case 'shield':
        if(!targetPlayer) throw new Error('Pick an ally.');
        targetPlayer.shield += fx.v;
        ev(state, 'shield', { target: targetPlayer.id, amount: fx.v });
        break;
      case 'shieldSelf':
        actor.shield += fx.v;
        ev(state, 'shield', { target: actor.id, amount: fx.v });
        break;
      case 'shieldAll':
        for(const p of living(state)){ p.shield += fx.v; ev(state, 'shield', { target: p.id, amount: fx.v }); }
        break;
      case 'regen':
        if(!targetPlayer) throw new Error('Pick an ally.');
        targetPlayer.regen += fx.v;
        ev(state, 'status', { target: targetPlayer.id, kind: 'regen', amount: fx.v });
        break;
      case 'regenAll':
        for(const p of living(state)){ p.regen += fx.v; ev(state, 'status', { target: p.id, kind: 'regen', amount: fx.v }); }
        break;
      case 'cleanse':
        if(!targetPlayer) throw new Error('Pick an ally.');
        targetPlayer.weaken = 0;
        ev(state, 'status', { target: targetPlayer.id, kind: 'cleanse' });
        break;
      case 'grantSolar':
        if(!targetPlayer) throw new Error('Pick an ally.');
        targetPlayer.bonusSolar += fx.v;
        ev(state, 'status', { target: targetPlayer.id, kind: 'solar', amount: fx.v });
        break;
      case 'grantSolarAll':
        for(const p of living(state)) p.bonusSolar += fx.v;
        ev(state, 'status', { target: actor.id, kind: 'solarAll', amount: fx.v });
        break;
      case 'solar':
        actor.solar += fx.v;
        break;
      case 'might':
        actor.might += fx.v;
        ev(state, 'status', { target: actor.id, kind: 'might', amount: fx.v });
        break;
      case 'thorns':
        actor.thorns += fx.v;
        ev(state, 'status', { target: actor.id, kind: 'thorns', amount: fx.v });
        break;
      case 'taunt':
        actor.taunt = true;
        ev(state, 'status', { target: actor.id, kind: 'taunt' });
        break;
      case 'turret':
        state.turret[actor.id] = (state.turret[actor.id] || 0) + fx.v;
        ev(state, 'status', { target: actor.id, kind: 'turret', amount: fx.v });
        break;
      case 'draw':
        drawCards(state, actor, fx.v);
        break;
    }
  }
}

/* ----------------------------------------------------------------- action */

export function playCard(state, playerId, handIndex, targetId, asId){
  if(state.phase !== 'playing') throw new Error('Not in a fight.');
  const p = state.players.find(x => x.id === seatFor(state, playerId, asId));
  if(!p) throw new Error('You are not in this room.');
  if(p.hp <= 0) throw new Error('You are down.');
  if(p.ended) throw new Error('You have already ended your turn.');

  const cardId = p.hand[handIndex];
  if(!cardId) throw new Error('No card there.');
  const card = CARDS[cardId];
  if(card.cost > p.solar) throw new Error('Not enough Solar.');

  let targetPlayer = null, targetEnemy = null;
  if(card.target === 'enemy'){
    targetEnemy = state.enemies.find(e => e.uid === targetId && e.hp > 0);
    if(!targetEnemy) throw new Error('Pick a living enemy.');
  }else if(card.target === 'ally'){
    targetPlayer = state.players.find(x => x.id === targetId && x.hp > 0);
    if(!targetPlayer) throw new Error('Pick a living ally.');
  }else if(card.target === 'self'){
    targetPlayer = p;
  }

  p.solar -= card.cost;
  p.hand.splice(handIndex, 1);
  p.discard.push(cardId);
  ev(state, 'play', { player: p.id, card: cardId, target: targetId || null });

  for(const fx of card.fx) applyFx(state, p, fx, targetPlayer, targetEnemy);

  checkFightEnd(state);
  return state;
}

export function endTurn(state, playerId, asId){
  if(state.phase !== 'playing') throw new Error('Not in a fight.');
  const p = state.players.find(x => x.id === seatFor(state, playerId, asId));
  if(!p) throw new Error('You are not in this room.');
  p.ended = true;
  p.endedRound = state.round;          // so it can be taken back this round only
  maybeEnemyPhase(state);
}

/* Ending a turn is a decision, and until the round actually turns over it should
   be a reversible one. Once the enemy phase has run there is nothing to take
   back, which is why this checks the round rather than trusting the button. */
export function unendTurn(state, playerId, asId){
  if(state.phase !== 'playing') throw new Error('Not in a fight.');
  const p = state.players.find(x => x.id === seatFor(state, playerId, asId));
  if(!p) throw new Error('You are not in this room.');
  if(!p.ended) return;
  if(p.hp <= 0) throw new Error('You are down.');
  if(state.round !== p.endedRound) throw new Error('The round has already moved on.');
  p.ended = false;
  ev(state, 'unend', { player: p.id });
}

function maybeEnemyPhase(state){
  // Disconnected players would otherwise stall the round forever.
  const waiting = state.players.filter(p => p.hp > 0 && p.connected && !p.ended);
  if(waiting.length) return;
  enemyPhase(state);
}

/* A fight that cannot resolve is worse than a hard one. Past this point the
   drills bite everyone every round, and keep biting harder, so a stalemate
   between a defensive party and a shielding enemy always ends. */
const ENRAGE_ROUND = 18;

function enemyPhase(state){
  ev(state, 'enemyPhase', {});

  /* Enemy shield is a stance for one round, exactly like the party's.
   *
   * It used to persist forever, which made anything with a shield move
   * unkillable to a party that could not out-damage it in a single round — the
   * Drill Mech would simply bank 8 armour at a time until the fight could not
   * be won. Clearing here rather than at round start matters: armour raised in
   * this phase has to survive the player round it was raised against. */
  for(const e of state.enemies) e.shield = 0;

  if(state.round > ENRAGE_ROUND){
    const bite = (state.round - ENRAGE_ROUND) * 2;
    ev(state, 'enrage', { amount: bite });
    for(const p of living(state)){
      p.shield = 0;                       // enrage ignores stances
      hurtPlayer(state, p, bite, null);
    }
    if(checkFightEnd(state)) return;
  }

  // Turrets fire before the enemies move — they are the party's standing fire.
  for(const [pid, dmg] of Object.entries(state.turret)){
    const alive = livingEnemies(state);
    if(!alive.length) break;
    const target = alive[Math.floor(rng32(state.seed + state.round * 17)() * alive.length)];
    hurtEnemy(state, target, dmg, pid);
  }

  for(const e of state.enemies){
    if(e.hp <= 0) continue;

    if(e.rust > 0){
      hurtEnemy(state, e, e.rust, 'rust');
      e.rust = Math.max(0, e.rust - 1);
      if(e.hp <= 0) continue;
    }

    const move = e.intent;
    if(!move) continue;
    const targets = living(state);
    if(!targets.length) break;

    // A taunting Turt soaks everything single-target aimed at the party.
    const taunter = targets.find(p => p.taunt);
    const pick = () => taunter || targets[Math.floor(rng32(state.seed + state.round * 53 + e.uid.charCodeAt(1))() * targets.length)];

    switch(move.kind){
      case 'attack':
        for(let i = 0; i < (move.times || 1); i++) hurtPlayer(state, pick(), move.v, e.uid);
        break;
      case 'attackAll':
        for(const p of living(state)) hurtPlayer(state, p, move.v, e.uid);
        break;
      case 'shield':
        e.shield += move.v;
        ev(state, 'shield', { target: e.uid, amount: move.v });
        break;
      case 'weaken': {
        const t = pick(); t.weaken += move.v;
        ev(state, 'status', { target: t.id, kind: 'weaken', amount: move.v });
        break;
      }
      case 'rust': {
        const t = pick(); t.weaken += move.v;
        ev(state, 'status', { target: t.id, kind: 'weaken', amount: move.v });
        break;
      }
      case 'rustAll':
        for(const p of living(state)){
          p.weaken += move.v;
          ev(state, 'status', { target: p.id, kind: 'weaken', amount: move.v });
        }
        break;
    }
  }

  if(checkFightEnd(state)) return;
  startRound(state);
}

function checkFightEnd(state){
  if(state.phase !== 'playing') return true;

  if(livingEnemies(state).length === 0){
    state.level++;
    if(state.level > FIGHTS_BEFORE_BOSS){
      state.phase = 'won';
      ev(state, 'runWon', {});
      return true;
    }
    // Offer three cards each, drawn from that hero's own pool.
    state.phase = 'reward';
    state.rewards = {};
    for(const p of state.players){
      const pool = rewardPool(p.classId);
      const rnd = rng32(state.seed + state.level * 613 + p.id.charCodeAt(0));
      const picked = [];
      const bag = pool.slice();
      while(picked.length < 3 && bag.length) picked.push(bag.splice(Math.floor(rnd() * bag.length), 1)[0]);
      state.rewards[p.id] = { options: picked, chosen: null };
    }
    ev(state, 'fightWon', { nextLevel: state.level });
    return true;
  }

  if(living(state).length === 0){
    state.phase = 'lost';
    ev(state, 'runLost', {});
    return true;
  }
  return false;
}

export function pickReward(state, playerId, cardId){
  if(state.phase !== 'reward') throw new Error('No rewards to pick.');
  const r = state.rewards[playerId];
  if(!r) throw new Error('You have no reward pending.');
  if(r.chosen) throw new Error('You already picked.');
  if(cardId !== null && !r.options.includes(cardId)) throw new Error('That was not on offer.');
  r.chosen = cardId || 'skip';
  const p = state.players.find(x => x.id === playerId);
  if(cardId) p.deck.push(cardId);

  // Move on once everyone still connected has chosen.
  const pending = state.players.filter(p2 => p2.connected && !state.rewards[p2.id].chosen);
  if(!pending.length){
    // Between fights the party patches itself up a little.
    for(const p2 of state.players){
      if(p2.hp > 0) healPlayer(state, p2, Math.round(p2.maxHp * 0.25));
      else { p2.hp = Math.max(1, Math.round(p2.maxHp * 0.3)); ev(state, 'revive', { target: p2.id }); }
    }
    state.rewards = null;
    startFight(state);
  }
}

/* Everything the client is allowed to know. Other players' hands are hidden —
   only their card count is shared, so nobody can read the table. */
/* ------------------------------------------------------------------- dev */

const snapshot = state => JSON.stringify({
  players: state.players, enemies: state.enemies, level: state.level,
  round: state.round, turret: state.turret, phase: state.phase
});

/* Which seat an instruction is really for. Outside a dev room it is always the
   sender's own, so this cannot become a way to play someone else's hand. */
function seatFor(state, playerId, asId){
  if(state.dev && asId && state.players.some(p => p.id === asId)) return asId;
  return playerId;
}

const DEV_CAST = ['engineal', 'mistypalm', 'turt', 'defty', 'mrknight'];

export function devCommand(state, playerId, cmd, arg){
  if(!state.dev) throw new Error('This room was not opened in dev mode.');

  if(cmd === 'fill'){
    if(state.phase !== 'lobby') throw new Error('Fill the party before the run starts.');
    // Take every class nobody claimed, as extra seats this client drives.
    const taken = new Set(state.players.map(p => p.classId).filter(Boolean));
    for(const classId of DEV_CAST){
      if(taken.has(classId) || state.players.length >= 5) continue;
      const id = 'dev:' + classId;
      // Name the seat after the character, not its slug — these show up in the
      // party list and on the pointer labels like any other player.
      addPlayer(state, id, (CLASSES.find(c => c.id === classId) || {}).name || classId);
      const seat = state.players.find(p => p.id === id);
      seat.classId = classId;
      seat.ready = true;
      seat.bot = true;
    }
    // The host still needs a class of their own before the run can start.
    const host = state.players.find(p => p.id === playerId);
    if(host && !host.classId){
      const free = DEV_CAST.find(c => !state.players.some(p => p.classId === c));
      if(free){ host.classId = free; host.ready = true; }
    }
    ev(state, 'devFill', { seats: state.players.length });
    return state;
  }

  if(cmd === 'skip'){
    if(state.phase !== 'playing') throw new Error('Only during a fight.');
    // Win it outright: the normal end-of-fight path then runs as it always does,
    // rewards and all, so skipping cannot desync the run from a real one.
    for(const e of state.enemies){
      if(e.hp > 0){ e.hp = 0; ev(state, 'die', { target: e.uid }); }
    }
    checkFightEnd(state);
    return state;
  }

  if(cmd === 'goto'){
    const want = Math.max(0, Math.min(FIGHTS_BEFORE_BOSS, arg | 0));
    const snap = state.snaps[want];
    if(!snap){
      // Never been there. Build it fresh rather than refusing — jumping ahead is
      // most of the point, and the decks carry over as they would have anyway.
      state.level = want;
      state.rewards = null;
      startFight(state);
      ev(state, 'devGoto', { level: want, fresh: true });
      return state;
    }
    const back = JSON.parse(snap);
    state.players = back.players;
    state.enemies = back.enemies;
    state.turret = back.turret;
    state.level = back.level;
    state.round = back.round;
    state.phase = 'playing';
    state.rewards = null;
    // Deal a fresh round rather than resuming a half-played one.
    startRound(state);
    ev(state, 'devGoto', { level: want });
    return state;
  }

  throw new Error('Unknown dev command.');
}

export function viewFor(state, playerId){
  return {
    code: state.code,
    dev: !!state.dev,
    phase: state.phase,
    level: state.level,
    round: state.round,
    you: playerId,
    host: state.players[0]?.id || null,
    players: state.players.map(p => ({
      id: p.id, name: p.name, classId: p.classId, ready: p.ready, connected: p.connected,
      hp: p.hp, maxHp: p.maxHp, shield: p.shield, solar: p.solar,
      might: p.might, thorns: p.thorns, regen: p.regen, weaken: p.weaken, taunt: p.taunt,
      ended: p.ended, deckSize: p.deck.length,
      drawCount: p.draw.length, discardCount: p.discard.length,
      handCount: p.hand.length,
      // A dev seat drives the whole party, so it has to see the whole party.
      hand: (state.dev || p.id === playerId) ? p.hand : null,
      /* Your own piles, and every pile in a dev room. The draw pile is sorted
         rather than sent in order — knowing what is left to come is fair, but
         knowing what the next card will be is not a deckbuilder any more. */
      piles: (state.dev || p.id === playerId)
        ? { draw: [...p.draw].sort(), discard: [...p.discard], deck: [...p.deck].sort() }
        : null
    })),
    enemies: state.enemies,
    rewards: state.rewards ? {
      options: state.rewards[playerId]?.options || [],
      chosen: state.rewards[playerId]?.chosen || null,
      waiting: state.players.filter(p => p.connected && !state.rewards[p.id]?.chosen).map(p => p.name)
    } : null,
    events: state.events,
    version: state.version
  };
}
