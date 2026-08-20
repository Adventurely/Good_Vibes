/* The room's combat effects, and the contract the client draws and sounds.
 *
 * An fx event names a card when a card caused it and an effect kind otherwise,
 * and the client reads both its tables card-first, kind-second. What these
 * tests pin is that fallback: every card that hits must resolve to some
 * animation and some sound without anyone having written a row for it. Keyed on
 * cards alone the tables were already one card short — Greenfire resolved in
 * silence with nothing on screen — and every card added later would have joined
 * it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { roomFor, dropIfEmpty } from '../src/rooms.js';
import { createAudio, SONGS } from '../public/good-vibes/audio.js';
import { fxStyles, styleFor, soundFor, FX_SOUND } from '../public/good-vibes/fx.js';
import {
  CARDS, EFFECT_KINDS, PHASES, BOSS_ROUND, classById, cardEffect,
  AILMENTS, addAilment, hasEffect, effectName, waveFor, enemyStats, ENEMIES,
  runHighlights, STAT_KEYS, blankStats,
  intentOf, effectAmount, strikePower, cardPlayable,
  playableClasses, PARTY_SIZE,
  ENEMY_INTENTS, intentKindOf, enemyDamage, blightDamage, blightOf,
  CHARGE_MULTIPLIER, BOLSTER_STEP, readyState, HAND_SIZE,
  HP_PER_PLAYER, WAVE_CAP,
  actionsFor, actionCost, actionReady, actionRemaining, freshStock, freshUses,
  CHARGE_CAP, CHARGE_REGEN, CLASS_BASICS, CLASS_ACTIONS,
  CACHE_YIELD, nodeYield, DRAW, ABILITIES, PAGES_PER_ROUND, canBuildAt,
  PACK_ITEMS, PACK_W, PACK_H, packPlace, packedCards, packedStats,
  normalisePack, gridCells,
} from '../public/good-vibes/content.js';

/* The client's own dispatch, imported rather than re-implemented. That is the
 * whole reason fx.js exists: a test that reasoned about the tables itself would
 * have passed on the very code that left Greenfire silent, because it would
 * have applied a fallback the client did not have.
 *
 * The palette is the one real thing missing in Node — art.js is client-side —
 * so the styles are built over a stand-in. Nothing here asserts a colour.
 */
const PALETTE = new Proxy({}, { get: (_, key) => `colour:${String(key)}` });
const FX_STYLE = fxStyles(PALETTE);

const audio = createAudio();
const animationFor = kind => styleFor(FX_STYLE, kind);
const soundOf = kind => soundFor(kind, audio.has);

/* ---- driving a real room ------------------------------------------------ */

let codes = 0;

/* The room drains a player's event queue into every view it sends, so the
   events a client actually sees are the ones on the wire — reading the queue
   directly would find it already emptied by the broadcast. */
const fakeSocket = () => ({ open: true, sent: [], send(text){ this.sent.push(text); } });

const eventsOn = socket => socket.sent.flatMap(text => JSON.parse(text).state.events || []);
const fxIn = socket => eventsOn(socket).filter(e => e.t === 'fx');

/* A room with one seated player, parked in a fight, able to take exactly the
   action the test is about.
 *
 * The seat is chosen by the action rather than passed in, because an action
 * belongs to a class now and the room refuses one the seat does not own — the
 * old `classId` argument stays for the handful of tests that pick a seat for
 * some other reason. Every pool is filled, so these tests are about what an
 * action does and never about affording it. */
/* Which seat owns an action. A brewed potion has no `classId` — it is the
   Alchemist's because it is in her list — so ownership is the list rather than
   the field, exactly as the room reads it. */
/* Which seat can take this action. `actionsFor` answers for four of the five;
   the Hauler owns nothing by class any more, so a card he can only reach by
   packing it has to be found through CARDS instead. */
const ownerOf = id => Object.keys(CLASS_BASICS).find(c => actionsFor(c).includes(id))
  || ((CARDS[id] || {}).packed ? CARDS[id].classId : undefined);

/* Put the item that grants this card into a seat's bag, at the first place it
   will legally go. The Hauler's option list *is* his bag, so a test about one
   of his cards has to pack it first — the same way a test about the Bolt Gun
   has to have built a panel. Legal placement rather than a hand-written
   `placed` entry, so a helper can never set up a bag the room would refuse. */
function packInto(room, player, cardId){
  const item = Object.values(PACK_ITEMS).find(i => i.card === cardId);
  if(!item) return;
  player.pack = normalisePack(player.pack);
  if(player.pack.placed.some(p => p.id === item.id)) return;

  for(let y = 0; y < PACK_H; y++){
    for(let x = 0; x < PACK_W; x++){
      for(let rot = 0; rot < 4; rot++){
        const placed = packPlace(room.round, player.pack.placed, item.id, x, y, rot);
        if(placed){ player.pack.placed = placed; return; }
      }
    }
  }
  // The bag was too full to take it. Empty it and try once more, because a
  // test about one card should never fail on the arrangement of the others.
  player.pack.placed = packPlace(room.round, [], item.id, 0, 0, 0)
    || packPlace(room.round, [], item.id, 0, PACK_H - 1, 0) || [];
}

function fightWith(actionId, classId = 'wizard'){
  const seatFor = ownerOf(actionId) || classId;
  const room = roomFor(`fx-${++codes}`);
  const socket = fakeSocket();
  const player = room.join(`token-${codes}`, socket);
  room.handle(player, { t: 'class', classId: seatFor });
  room.handle(player, { t: 'start' });
  assert.equal(room.phase, PHASES.build, 'the run should open in the build phase');

  room.handle(player, { t: 'ready', ready: true });
  assert.equal(room.phase, PHASES.combat, 'one ready player is the whole party here');

  fill(room, player);
  // His bag is his option list, so the card under test has to be in it.
  if((CARDS[actionId] || {}).packed) packInto(room, player, actionId);
  socket.sent.length = 0;                 // everything before the turn under test
  return { room, player, socket };
}

/* The two free things every seat has. Universal Strike and Hold are gone from
   the game — each class has its own now, and they are not the same two numbers
   any more, which was the whole point of the change. */
const swing = p => CLASS_BASICS[p.classId][0];
const guard = p => CLASS_BASICS[p.classId][1];

/* Every pool, full. A test about what Bulwark does should not fail because a
   panel was never built. */
function fill(room, player){
  room.pages = 9;
  room.power = 9;
  player.charges = CHARGE_CAP;
  player.stock = { tonic: 9, censer: 9, vapours: 9, sunsalve: 9, stillwater: 9, greenfire: 9 };
  player.uses = { ringbark: 9, season: 9, scion: 9, cutting: 9 };
}


/* The wave, present but not swinging.
 *
 * Enemies used to be parked out of reach with `dist = 9` when a test was about
 * something else. Nothing is out of reach any more — a standoff has everything
 * on the field from the first turn — so "do not interfere" is now a swing of
 * zero rather than a distance. */
const mute = room => {
  for(const enemy of room.enemies){ enemy.hits = 0; enemy.might = 0; enemy.charged = false; }
};

/* Every action that hits, from the fist to the bolt gun. Taken off the class
   lists rather than off CARDS, because owning it is what makes it takeable —
   the universals in that table are not in anybody's list any more. */
const strikeCards = [...new Set([
  ...Object.keys(CLASS_BASICS).flatMap(c => actionsFor(c)),
  // The Hauler's, which are in nobody's class list — they are in his bag, and
  // leaving them out of this would leave the newest cards in the game as the
  // only ones nothing checks can be seen or heard.
  ...Object.values(PACK_ITEMS).map(i => i.card).filter(Boolean),
  'cutting',
])].filter(id => ((CARDS[id] || {}).effect || {}).kind === 'strike');

test('every strike action resolves the way the basic swing does', () => {
  assert.ok(strikeCards.length >= 5, 'every seat has at least a swing');

  for(const id of strikeCards){
    const card = CARDS[id];
    const { room, player, socket } = fightWith(id, card.classId || 'grafter');

    const target = room.enemies[0];
    const before = target.hp;
    room.handle(player, { t: 'intent', intent: { t: 'action', id: id, target: target.id } });

    const fx = fxIn(socket).find(e => e.kind === id);
    assert.ok(fx, `"${id}" resolved without an fx event, so it is silent and invisible`);
    assert.equal(fx.player, player.id);
    assert.equal(fx.target, target.id, `"${id}" must say which enemy it hit`);
    // A card the Wizard's book knows resolves from the book, not the card
    // table — Fireball is a crafted spell in her hands and a legacy card in
    // the deployed room's.
    const spell = room.spellFor(player, id);
    const amount = spell ? spell.amount : cardEffect(id, room.works).amount;
    assert.equal(target.hp, Math.max(0, before - amount),
      `"${id}" announced one thing and did another`);

    // The point of the whole exercise: the client can draw it and play it,
    // whether or not anybody wrote this card its own row.
    assert.ok(animationFor(fx.kind), `"${id}" has no animation and no fallback to one`);
    assert.ok(soundOf(fx.kind), `"${id}" has no sound and no fallback to one`);

    dropIfEmpty(room);
  }
});

test('Strike looks and sounds exactly like the action it replaced', () => {
  // It is the plain jab and the plain crack — no override, which is what makes
  // it the shape every other strike-kind card falls back to.
  assert.equal(animationFor('strike'), FX_STYLE.strike);
  assert.equal(soundOf('strike'), 'strike');
  assert.equal(FX_SOUND.strike, undefined, 'Strike should not need an override to sound like itself');
  // Anything without a look of its own gets Strike's, by falling back to the
  // verb rather than by being listed.
  assert.equal(animationFor('not-a-card-but-a-strike'), null, 'an unknown name is not a strike');
  for(const id of strikeCards){
    if(FX_STYLE[id]) continue;                       // a card with its own look
    assert.equal(animationFor(id), FX_STYLE.strike, `"${id}" should fall back to Strike's jab`);
  }
});

test('a strike fx arrives before the damage that follows it', () => {
  // The client stages the volley against the board it is holding. An fx that
  // landed after the kill would fire at an enemy already off the field.
  const { room, player, socket } = fightWith('strike', 'engineer');
  const target = room.enemies[0];
  target.hp = 1;                                   // one fist finishes it
  room.handle(player, { t: 'intent', intent: { t: 'action', id: swing(player), target: target.id } });

  const order = eventsOn(socket).map(e => (e.t === 'fx' ? `fx:${e.kind}` : e.t));
  const fxAt = order.indexOf(`fx:${swing(player)}`);
  const logAt = order.indexOf('log');
  assert.ok(fxAt >= 0 && logAt >= 0, 'the turn should both animate and narrate');
  assert.ok(fxAt < logAt, 'the fx must be emitted before the hit it depicts is reported');
});

test('being hit is its own effect, on the victim', () => {
  const { room, player, socket } = fightWith('hold', 'engineer');
  // Walk the wave into contact so somebody actually gets hit this turn.
  room.handle(player, { t: 'intent', intent: { t: 'action', id: guard(player) } });

  const hit = fxIn(socket).find(e => e.kind === 'hit');
  assert.ok(hit, 'an enemy reaching the party must show on screen');
  assert.equal(hit.player, player.id, 'the flash belongs to whoever was hit');
  assert.ok(soundOf('hit'), 'being hit has no sound');
});

test('the wave a room raises is sized to the party at the table', () => {
  // Solo is the case the scaling exists for: the five-player round-one wave
  // against one person with nothing but a fist.
  const { room } = fightWith('strike', 'alchemist');
  const hp = room.enemies.reduce((sum, e) => sum + e.hp, 0);
  const solo = classById('alchemist').hp;
  assert.ok(room.enemies.length >= 1, 'a fight needs something to fight');
  assert.ok(hp < solo * 2, `round one sends ${hp} hp at one player with ${solo} hp`);
  assert.ok(room.round < BOSS_ROUND, 'this is the opening round, not the appointment');
});

test('every effect the engine implements has a sound to fall back to', () => {
  // A missing kind here is not one silent card, it is every card of that kind.
  for(const kind of EFFECT_KINDS) assert.ok(audio.has(kind), `effect kind "${kind}" has no sound`);
  assert.equal(audio.has('not-a-sound'), false);
});

/* ---- what the blight leaves behind -------------------------------------- */

/* These four are about the half of combat that is not a number going down.
 * Damage over time, weakness and stun are the first statuses in the game, and
 * every one of them can fail silently — an ailment that is applied but never
 * ticks, or never expires, or never reaches the client, is invisible from
 * inside the engine and looks fine in a log.
 */

test('a monster ailment lands on its cadence, and only on a hit that got through', () => {
  const { room, player } = fightWith('hold', 'engineer');
  // One Sporeling, in contact, and no guard to eat what it swings.
  room.enemies = [{ id: 'e0', type: 'sporeling', name: 'Sporeling', art: 'sporeling',
                    hp: 20, maxHp: 20, hits: 2, landed: 0 }];

  room.handle(player, { t: 'intent', intent: { t: 'action', id: swing(player) } });
  assert.equal(hasEffect(player.effects, 'rot'), false,
    'a Sporeling rots on its second landed hit, not its first');

  room.handle(player, { t: 'intent', intent: { t: 'action', id: swing(player) } });
  assert.ok(hasEffect(player.effects, 'rot'), 'the second landed hit should rot');

  // Guard that swallows the blow whole leaves nothing behind. That is the
  // trade the ward is for, and it is easy to lose in a refactor.
  const before = player.effects.length;
  player.block = 99;
  room.handle(player, { t: 'intent', intent: { t: 'action', id: swing(player) } });
  assert.equal(player.effects.length, before,
    'a fully blocked hit must not land an ailment');
});

test('blightrot keeps taking, then stops', () => {
  const { room, player } = fightWith('hold', 'engineer');
  room.enemies = [{ id: 'e0', type: 'creeper', name: 'Creeper', art: 'creeper',
                    hp: 99, maxHp: 99, hits: 0, landed: 0 }];   // present, not swinging
  player.effects = addAilment([], 'rot');
  const rounds = AILMENTS.rot.rounds;
  const damage = AILMENTS.rot.amount;

  let hp = player.hp;
  for(let turn = 0; turn < rounds; turn++){
    room.handle(player, { t: 'intent', intent: { t: 'action', id: guard(player) } });
    assert.equal(player.hp, hp - damage, `rot should bite on turn ${turn + 1}`);
    hp = player.hp;
  }
  assert.equal(hasEffect(player.effects, 'rot'), false, `rot should be gone after ${rounds} turns`);

  room.handle(player, { t: 'intent', intent: { t: 'action', id: guard(player) } });
  assert.equal(player.hp, hp, 'an expired ailment must stop costing health');
});

test('stun costs the turn and weakness costs the swing', () => {
  const { room, player } = fightWith('strike', 'engineer');
  const target = room.enemies[0];
  target.hp = 99;
  mute(room);                                       // nothing lands back this turn

  const stunned = target.hp;
  player.effects = addAilment([], 'stun');
  room.handle(player, { t: 'intent', intent: { t: 'action', id: swing(player), target: target.id } });
  assert.equal(target.hp, stunned, 'a stunned player deals no damage');
  assert.equal(hasEffect(player.effects, 'stun'), false, 'a one-round stun lasts one round');

  const before = target.hp;
  player.effects = addAilment([], 'weak');
  room.handle(player, { t: 'intent', intent: { t: 'action', id: swing(player), target: target.id } });
  const dealt = before - target.hp;
  assert.equal(dealt, CARDS[swing(player)].effect.amount - AILMENTS.weak.amount,
    'a weakened strike should land lighter, and still land');
  assert.ok(dealt > 0, 'weakness must never zero a card out');
});

test('the party can see who is rotting', () => {
  // viewFor used to hardcode an empty effects list, which meant every status in
  // the game was invisible to the one person who could answer it.
  const { room, player, socket } = fightWith('hold', 'engineer');
  player.effects = addAilment([], 'rot');
  room.broadcast();

  const state = JSON.parse(socket.sent[socket.sent.length - 1]).state;
  const seen = state.players.find(p => p.id === player.id);
  assert.ok(seen.effects.some(e => e.kind === 'rot'), 'the view must carry the statuses');
  assert.equal(typeof effectName('rot'), 'string');
});

/* ---- the party cards ---------------------------------------------------- */

test('the party cards land on the party, not on the player who spent them', () => {
  const room = roomFor(`party-${++codes}`);
  const seats = ['alchemist', 'engineer', 'wizard'].map((classId, i) => {
    const socket = fakeSocket();
    const player = room.join(`party-token-${codes}-${i}`, socket);
    room.handle(player, { t: 'class', classId });
    return player;
  });
  room.handle(seats[0], { t: 'start' });
  for(const p of seats) room.handle(p, { t: 'ready', ready: true });
  assert.equal(room.phase, PHASES.combat);

  mute(room);                                       // nothing hits back this turn
  for(const p of seats) p.hp = 10;
  room.pages = 5;
  room.power = 5;

  room.handle(seats[0], { t: 'intent', intent: { t: 'action', id: 'vapours' } });
  room.handle(seats[1], { t: 'intent', intent: { t: 'action', id: 'shore' } });
  room.handle(seats[2], { t: 'intent', intent: { t: 'action', id: 'rune', target: seats[1].id } });

  for(const p of seats){
    assert.equal(p.hp, 10 + CARDS.vapours.effect.amount, `${p.classId} should have been mended`);
  }
  assert.ok(hasEffect(seats[1].effects, 'might'),
    'a lent page belongs to the ally it was lent to');
  assert.equal(hasEffect(seats[2].effects, 'might'), false,
    'and not to the wizard who lent it');
});

test('a cleanse takes the ailments off and leaves the boons on', () => {
  const { room, player } = fightWith('censer', 'alchemist');
  mute(room);
  player.effects = [
    ...addAilment([], 'rot'),
    { kind: 'might', amount: 4, rounds: 3 },
  ];
  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'censer', target: player.id } });
  assert.equal(hasEffect(player.effects, 'rot'), false, 'the censer should clear the rot');
  assert.ok(hasEffect(player.effects, 'might'), 'and leave what the party put there');
});

/* ---- the works: what the Engineer left running -------------------------- */

/* A room in a fight with a given base standing behind it.
 *
 * The buildings are written straight in rather than placed, because where they
 * may stand is `placeRefusal`'s question and it has its own tests in
 * content.test.js — these are about what a standing base *pays*. Laid out in a
 * row from x=0, which matters only for panels: two of them touching is four
 * power and is exactly the thing worth being deliberate about.
 */
function works(buildings = [], abilities = [], second = null){
  const room = roomFor(`works-${++codes}`);
  const socket = fakeSocket();
  const player = room.join(`works-token-${codes}`, socket);
  room.handle(player, { t: 'class', classId: 'engineer' });

  // Seated before the run starts, because `join` is a lobby door — a seat
  // cannot be taken half way through a fight.
  let ally = null;
  if(second){
    ally = room.join(`works-ally-${codes}`, fakeSocket());
    room.handle(ally, { t: 'class', classId: second });
  }

  room.handle(player, { t: 'start' });
  room.buildings = buildings.map((id, i) => ({ id, x: i, y: 0 }));
  room.abilities = abilities;
  for(const p of [player, ally].filter(Boolean)) room.handle(p, { t: 'ready', ready: true });
  assert.equal(room.phase, PHASES.combat);
  room.power = 9;
  socket.sent.length = 0;
  return { room, player, ally, socket };
}

test('the lines pay out at the top of a round, and cost nobody a turn', () => {
  /* The whole of the seat in one assertion: the player spends their turn on a
   * plain guard, and the wave still takes damage — because the heliostat has
   * been standing since the build phase and does not wait to be asked. Nothing
   * else in this game contributes on a turn somebody else is using. */
  const { room, player } = works(['heliostat']);
  mute(room);
  const enemy = room.enemies[0];
  const before = enemy.hp;

  room.handle(player, { t: 'intent', intent: { t: 'action', id: guard(player) } });

  assert.equal(before - enemy.hp, room.works.burn,
    'the mirrors fired while he was doing something else');
});

test('a line pays more for every tier standing on it', () => {
  const one = works(['heliostat']);
  mute(one.room);
  const first = one.room.enemies[0].hp;
  one.room.handle(one.player, { t: 'intent', intent: { t: 'action', id: guard(one.player) } });
  const bare = first - one.room.enemies[0].hp;

  const three = works(['heliostat', 'mirrorfield', 'furnace']);
  mute(three.room);
  const start = three.room.enemies[0].hp;
  three.room.handle(three.player, { t: 'intent', intent: { t: 'action', id: guard(three.player) } });
  const grown = start - three.room.enemies[0].hp;

  assert.equal(bare, 1);
  assert.equal(grown, 3, 'three mirrors, three times the afternoon');
  assert.ok(grown > bare);
});

test('the windbreak guards the party before the wave lands', () => {
  // Ward is paid at the head of the round and block is cleared at the foot of
  // it, so the only place the guard is visible is in what the wave failed to
  // take. Which is the right place to test it.
  const bare = works([]);
  bare.room.enemies.forEach(e => { e.hits = 1; e.might = 0; e.charged = false; });
  const bareHp = bare.player.hp;
  bare.room.handle(bare.player, { t: 'intent', intent: { t: 'action', id: swing(bare.player) } });
  const tookBare = bareHp - bare.player.hp;
  assert.ok(tookBare > 0, 'the wave has to actually swing for this to mean anything');

  const walled = works(['trellis', 'livingwall', 'hedgerow']);
  walled.room.enemies.forEach(e => { e.hits = 1; e.might = 0; e.charged = false; });
  const walledHp = walled.player.hp;
  walled.room.handle(walled.player, { t: 'intent', intent: { t: 'action', id: swing(walled.player) } });

  assert.ok(walledHp - walled.player.hp < tookBare,
    'three tiers of windbreak should eat some of the blow');
});

test('the carillon is in the swing on the round it sounds', () => {
  const bare = works([]);
  mute(bare.room);
  const bareStart = bare.room.enemies[0].hp;
  bare.room.handle(bare.player, { t: 'intent', intent: { t: 'action', id: swing(bare.player) } });
  const plain = bareStart - bare.room.enemies[0].hp;

  const rung = works(['carillon', 'tubes']);
  mute(rung.room);
  const rungStart = rung.room.enemies[0].hp;
  rung.room.handle(rung.player, { t: 'intent', intent: { t: 'action', id: swing(rung.player) } });

  assert.equal(rungStart - rung.room.enemies[0].hp, plain + rung.room.works.might,
    'might is paid before anybody acts, so it is in this round’s swing');
});

test('the base keeps working while the Engineer is face down', () => {
  /* A machine does not care that its operator is unconscious, and a base that
   * stopped the moment its builder went down would be a pet rather than
   * infrastructure. It is also the only way this seat contributes on a round
   * it cannot act in — which no other class can do at all. */
  const { room, player, ally } = works(['heliostat'], [], 'alchemist');
  mute(room);
  assert.ok(ally, 'this one needs somebody left standing to end the round');

  player.down = true;
  player.hp = 0;
  const before = room.enemies[0].hp;
  room.handle(ally, { t: 'intent', intent: { t: 'action', id: guard(ally) } });

  assert.equal(before - room.enemies[0].hp, room.works.burn,
    'the mirrors kept tracking the sun without him');
});

test('an ability is worth what its line pays, and needs that line standing', () => {
  const bare = works(['trellis'], ['closeranks']);
  assert.ok(bare.room.actionIds(bare.player).includes('closeranks'),
    'bought, with its trellis up, so he can take it');
  assert.equal(cardEffect('closeranks', bare.room.works).amount, DRAW,
    'one tier is one crew’s share');

  const grown = works(['trellis', 'livingwall', 'hedgerow'], ['closeranks']);
  assert.equal(cardEffect('closeranks', grown.room.works).amount, 3 * DRAW,
    'and three tiers is three of them, off the same chip');

  // Bought, but with nothing to draw through: not an option at all.
  const empty = works([], ['closeranks']);
  assert.equal(empty.room.actionIds(empty.player).includes('closeranks'), false,
    'an ability whose whole number is a line is not an ability without one');

  // The Bolt Gun is the exception, and the reason he is playable on round one.
  const gun = works([], ['boltgun']);
  assert.ok(gun.room.actionIds(gun.player).includes('boltgun'),
    'the one thing he can fire off a bare panel');
});

test('close ranks puts the whole windbreak on one head', () => {
  /* The payout puts works.ward on everybody; the ability puts DRAW times it on
   * one of them, on top. Block is cleared at the foot of the round it was
   * spent in, so what is visible afterwards is what the wave failed to take —
   * and the seat it was aimed at should be the one that kept its health. */
  const { room, player, ally } = works(['trellis', 'livingwall'], ['closeranks'], 'hauler');
  assert.equal(room.works.ward, 2, 'two tiers standing');
  for(const enemy of room.enemies){ enemy.hits = 1; enemy.might = 0; enemy.charged = false; }
  ally.hp = 40;
  const before = ally.hp;

  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'closeranks', target: ally.id } });
  room.handle(ally, { t: 'intent', intent: { t: 'action', id: swing(ally) } });

  assert.equal(before - ally.hp, 0,
    'ten of guard on one head should swallow a round of a wave this size');
});

test('hold the charge pays nothing now and twice next', () => {
  const { room, player } = works(['heliostat', 'mirrorfield'], ['holdcharge']);
  mute(room);
  const enemy = room.enemies[0];
  enemy.hp = 999;                       // it has to survive being shot at twice

  const start = enemy.hp;
  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'holdcharge' } });
  const afterHold = enemy.hp;
  assert.equal(start - afterHold, room.works.burn,
    'the round it is played still pays — what it banks is the next one');
  assert.equal(room.banked, true);

  room.handle(player, { t: 'intent', intent: { t: 'action', id: guard(player) } });
  assert.equal(afterHold - enemy.hp, room.works.burn * 2, 'and the next one pays double');
  assert.equal(room.banked, false, 'the bank is spent, not standing');
});

test('the cistern pays once, when the fight is over', () => {
  const { room, player } = works(['cistern', 'reedbed']);
  mute(room);
  player.hp = 5;

  // Mid-fight it does nothing at all: the mend line does not tick.
  room.handle(player, { t: 'intent', intent: { t: 'action', id: guard(player) } });
  assert.equal(player.hp, 5, 'no healing while the fight is on');

  // Now end it.
  for(const enemy of room.enemies) enemy.hp = 1;
  room.handle(player, { t: 'intent', intent: { t: 'action', id: swing(player) } });
  for(const enemy of room.enemies) enemy.hp = 0;
  room.handle(player, { t: 'intent', intent: { t: 'action', id: swing(player) } });

  assert.ok(player.hp > 5, 'and a round of it when the wave is down');
});

test('the community buildings reach four build phases that are not his', () => {
  const room = roomFor(`grants-${++codes}`);
  const seats = ['engineer', 'wizard', 'alchemist', 'hauler'].map((classId, i) => {
    const player = room.join(`grants-token-${codes}-${i}`, fakeSocket());
    room.handle(player, { t: 'class', classId });
    return player;
  });
  room.handle(seats[0], { t: 'start' });

  const bareBag = gridCells(room.packRound);
  const barePages = room.pages;

  room.buildings = [
    { id: 'press', x: 0, y: 0 }, { id: 'glasshouse', x: 1, y: 0 },
    { id: 'barrow', x: 2, y: 0 },
  ];

  // The Barrow moves the Hauler along the bag's schedule early.
  assert.equal(room.packRound, room.round + 1);
  assert.ok(gridCells(room.packRound) > bareBag, 'the bag should have grown a row');

  // The Glasshouse is worth a unit on every pot pulled.
  room.stash = { ...room.stash, sunpetal: 3 };
  room.handle(seats[2], { t: 'intent', intent: { t: 'plant', pot: 0, herb: 'sunpetal' } });
  const held = room.stash.sunpetal;
  room.handle(seats[2], { t: 'intent', intent: { t: 'harvest', pot: 0 } });
  assert.equal(room.stash.sunpetal - held, potYield(0) + 1, 'the glazing is worth a unit');

  // And the Pulp Press is a page at every build phase, on top of the library's.
  for(const p of seats) room.handle(p, { t: 'ready', ready: true });
  assert.equal(room.phase, PHASES.combat);
  const beforePages = room.pages;
  for(const enemy of room.enemies) enemy.hp = 0;
  for(const p of seats) room.handle(p, { t: 'intent', intent: { t: 'action', id: guard(p) } });
  assert.equal(room.phase, PHASES.build, 'the wave is down');
  assert.equal(room.pages - beforePages, PAGES_PER_ROUND + 1, 'the press ran off one more');
  assert.ok(barePages >= 0);
});

test('a building is refused where its rule says it may not stand', () => {
  const room = roomFor(`refuse-${++codes}`);
  const player = room.join(`refuse-token-${codes}`, fakeSocket());
  room.handle(player, { t: 'class', classId: 'engineer' });
  room.handle(player, { t: 'start' });
  room.salvage = { screw: 99, coil: 99, chip: 99 };

  // A Living Wall with no Trellis anywhere is refused, and the room does not
  // take the salvage for it.
  const before = room.salvage.screw;
  room.handle(player, { t: 'intent', intent: {
    t: 'place', building: 'livingwall', x: player.x + 1, y: player.y } });
  assert.equal(room.buildings.length, 0, 'a wall with no trellis is not a wall');
  assert.equal(room.salvage.screw, before, 'and it was not paid for');
});

test('a building can be shifted, and the array is worth more for it', () => {
  const room = roomFor(`shift-${++codes}`);
  const player = room.join(`shift-token-${codes}`, fakeSocket());
  room.handle(player, { t: 'class', classId: 'engineer' });
  room.handle(player, { t: 'start' });
  room.salvage = { screw: 99, coil: 99, chip: 99 };

  // Two panels, deliberately apart. Somewhere clear, found the way a player
  // would find it rather than assumed.
  const clear = [];
  for(let y = 0; y < 17 && clear.length < 3; y++){
    for(let x = 0; x < 30 && clear.length < 3; x++){
      if(canBuildAt(room.terrain, room.buildings, room.nodes, x, y)
         && canBuildAt(room.terrain, room.buildings, room.nodes, x + 1, y)) clear.push({ x, y });
    }
  }
  assert.ok(clear.length, 'a site should have somewhere to put a panel');
  const spot = clear[0];
  const far = clear[clear.length - 1];

  room.handle(player, { t: 'intent', intent: { t: 'place', building: 'panel', x: spot.x, y: spot.y } });
  room.handle(player, { t: 'intent', intent: { t: 'place', building: 'panel', x: far.x + 1, y: far.y } });
  assert.equal(room.buildings.length, 2);

  // Apart they are two ones; walked onto the same rail they are two twos, and
  // it cost nothing. That is the whole reason the verb exists.
  const apart = room.works.array;
  room.handle(player, { t: 'intent', intent: {
    t: 'shift', index: 1, x: spot.x + 1, y: spot.y } });
  assert.equal(room.buildings[1].x, spot.x + 1, 'the panel should have moved');
  assert.equal(room.works.array, apart + 2, 'and the pair is worth twice what they were');
  assert.equal(room.salvage.screw, 99 - 6, 'moving is free — two panels is all that was paid');
});

test('a shift is refused where a placement would be, and never half-lands', () => {
  const room = roomFor(`shift-no-${++codes}`);
  const player = room.join(`shift-no-token-${codes}`, fakeSocket());
  room.handle(player, { t: 'class', classId: 'engineer' });
  room.handle(player, { t: 'start' });
  room.buildings = [{ id: 'trellis', x: 5, y: 5 }, { id: 'livingwall', x: 6, y: 5 }];

  // Onto a tile nothing can stand on.
  const water = room.terrain.findIndex(t => t === 'water');
  if(water >= 0){
    room.handle(player, { t: 'intent', intent: {
      t: 'shift', index: 0, x: water % 30, y: Math.floor(water / 30) } });
    assert.equal(room.buildings[0].x, 5, 'a trellis cannot be walked into the meltwater');
  }

  // And a move that would strand the wall hanging off it.
  room.handle(player, { t: 'intent', intent: { t: 'shift', index: 0, x: 20, y: 12 } });
  assert.equal(room.buildings[0].x, 5, 'the trellis should not have walked off');
  assert.equal(room.buildings[1].x, 6, 'and the wall should still be beside it');

  // Nothing at that index is a no-op rather than a throw.
  room.handle(player, { t: 'intent', intent: { t: 'shift', index: 9, x: 5, y: 6 } });
  assert.equal(room.buildings.length, 2);
});

test('only the seat that builds can shift what it built', () => {
  const room = roomFor(`shift-who-${++codes}`);
  const seats = ['engineer', 'wizard'].map((classId, i) => {
    const player = room.join(`shift-who-token-${codes}-${i}`, fakeSocket());
    room.handle(player, { t: 'class', classId });
    return player;
  });
  room.handle(seats[0], { t: 'start' });
  room.buildings = [{ id: 'panel', x: 4, y: 4 }];

  room.handle(seats[1], { t: 'intent', intent: { t: 'shift', index: 0, x: 5, y: 4 } });
  assert.equal(room.buildings[0].x, 4, 'the Wizard does not move the Engineer’s panels');

  room.handle(seats[0], { t: 'intent', intent: { t: 'shift', index: 0, x: 5, y: 4 } });
  assert.equal(room.buildings[0].x, 5, 'and the Engineer does');
});

test('learning an ability spends chips, and only once', () => {
  const room = roomFor(`learn-${++codes}`);
  const player = room.join(`learn-token-${codes}`, fakeSocket());
  room.handle(player, { t: 'class', classId: 'engineer' });
  room.handle(player, { t: 'start' });
  room.salvage = { screw: 0, coil: 0, chip: 9 };

  room.handle(player, { t: 'intent', intent: { t: 'learn', ability: 'boltgun' } });
  assert.deepEqual(room.abilities, ['boltgun']);
  assert.equal(room.salvage.chip, 9 - ABILITIES.boltgun.chips);

  // Twice is once.
  room.handle(player, { t: 'intent', intent: { t: 'learn', ability: 'boltgun' } });
  assert.deepEqual(room.abilities, ['boltgun'], 'learned twice');
  assert.equal(room.salvage.chip, 9 - ABILITIES.boltgun.chips, 'and paid for twice');

  // And one whose line is not standing is refused outright.
  room.handle(player, { t: 'intent', intent: { t: 'learn', ability: 'sunlance' } });
  assert.deepEqual(room.abilities, ['boltgun'], 'no heliostat, no sunlance');
});

test('the abilities survive a room going to sleep mid-run', () => {
  // A room hibernates and comes back. What the chips bought is the party's
  // whole progression on this seat, so losing it to a wake would be losing the
  // run.
  const room = roomFor(`wake-${++codes}`);
  const player = room.join(`wake-token-${codes}`, fakeSocket());
  room.handle(player, { t: 'class', classId: 'engineer' });
  room.handle(player, { t: 'start' });
  room.salvage = { screw: 99, coil: 99, chip: 99 };
  room.handle(player, { t: 'intent', intent: { t: 'learn', ability: 'boltgun' } });
  room.banked = true;

  const woken = Room.restore(JSON.parse(JSON.stringify(room.serialize())));
  assert.deepEqual(woken.abilities, ['boltgun'], 'it forgot what it had learned');
  assert.equal(woken.banked, true, 'and what the grid was holding');
});

/* ---- the death the client holds the round open for ---------------------- */

test('a kill is announced, and the last kill of a round says so', () => {
  const { room, player, socket } = fightWith('strike', 'engineer');
  // Two enemies, both one hit from dead, so the first kill is not the last.
  room.enemies = [
    { id: 'e0', type: 'sporeling', name: 'Sporeling', art: 'sporeling', hp: 1, maxHp: 6, hits: 0, landed: 0 },
    { id: 'e1', type: 'sporeling', name: 'Sporeling', art: 'sporeling', hp: 1, maxHp: 6, hits: 0, landed: 0 },
  ];

  room.handle(player, { t: 'intent', intent: { t: 'action', id: swing(player), target: 'e0' } });
  const first = fxIn(socket).find(e => e.kind === 'slain');
  assert.ok(first, 'a kill has to reach the client or it cannot be animated');
  assert.equal(first.target, 'e0');
  assert.equal(first.last, false, 'one of two is not the end of the round');

  socket.sent.length = 0;
  room.handle(player, { t: 'intent', intent: { t: 'action', id: swing(player), target: 'e1' } });
  const last = fxIn(socket).find(e => e.kind === 'slain');
  assert.ok(last && last.last, 'the kill that empties the lane is the one the round holds open for');
});

test('a nova kills the whole lane and only the last one ends the round', () => {
  const { room, player, socket } = fightWith('nova', 'wizard');
  room.enemies = room.enemies.map((e, i) =>
    ({ ...e, hp: 1, hits: 0, landed: 0 }));
  const count = room.enemies.length;

  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'nova' } });
  const slain = eventsOn(socket).filter(e => e.t === 'fx' && e.kind === 'slain');
  assert.equal(slain.length, count, 'every enemy it killed should be seen dying');
  assert.equal(slain.filter(e => e.last).length, 1, 'exactly one of them ends the round');
  assert.equal(slain[slain.length - 1].last, true, 'and it is the last one');
});

/* ---- levelling ---------------------------------------------------------- */

/* One dial, and it is health. The wave used to be levelled by spending a threat
 * budget — a bigger table met a fuller lane of worse things — and that stopped
 * working the moment an attack landed on the whole party, because an enemy's
 * damage is multiplied by the head count before any dial touches it. These four
 * pin the model that replaced it.
 */

test('the wave is the same wave at every table size', () => {
  for(let round = 1; round <= BOSS_ROUND; round++){
    const solo = waveFor(round, 1);
    for(let size = 2; size <= PARTY_SIZE; size++){
      assert.deepEqual(waveFor(round, size), solo,
        `round ${round} sends a different wave to a table of ${size}`);
    }
  }
});

test('the first fight is three things', () => {
  assert.equal(waveFor(1, 1).length, 3);
  assert.equal(waveFor(1, PARTY_SIZE).length, 3);
});

test('no wave is longer than the lane can draw', () => {
  for(let round = 1; round <= BOSS_ROUND; round++){
    assert.ok(waveFor(round).length <= WAVE_CAP,
      `round ${round} sends more than the ${WAVE_CAP} the lane can show`);
  }
});

test('health scales with the table and damage never does', () => {
  for(const type of Object.keys(ENEMIES)){
    const solo = enemyStats(type, 1);
    const full = enemyStats(type, PARTY_SIZE);
    assert.equal(solo.hp, ENEMIES[type].hp, `${type} at a table of one is what the table says`);
    assert.ok(full.hp > solo.hp, `${type} has to grow with the party`);
    // The one that matters: a swing lands on everybody, so the head count is
    // already inside the damage. Scaling it as well multiplies it twice.
    assert.equal(solo.hits, ENEMIES[type].hits, `${type} swings for what it is authored to swing for`);
    assert.equal(full.hits, solo.hits, `${type} must not swing harder at a bigger table`);
  }

  // And health is linear in the head count, which is the whole argument for
  // scaling it: a party puts out roughly its head count in damage, so a fight
  // that scales the same way takes the same number of rounds at every size.
  const one = enemyStats('sporeling', 1).hp;
  assert.equal(enemyStats('sporeling', 5).hp, Math.round(one * (1 + HP_PER_PLAYER * 4)));
});
/* ---- how a run ends ------------------------------------------------------ */

/* Losing used to be a state the client had no screen for: `over` fell through
 * to the build screen, which drew round 4 of 3 over a combat lane and gave you
 * nothing to click. These pin the half of that the room owns — that a wipe
 * really does end the run, that the record is worth showing, and that there is
 * a way out of the end screen other than reloading the page.
 */

test('a wipe ends the run rather than rolling into another round', () => {
  const { room, player, socket } = fightWith('hold', 'wizard');
  for(const enemy of room.enemies) enemy.hits = 99;

  room.handle(player, { t: 'intent', intent: { t: 'action', id: guard(player) } });

  assert.equal(room.phase, PHASES.over, 'the last player going down is the end of the run');
  assert.equal(room.outcome, 'lost');
  assert.ok(player.down, 'and the player is down, not merely unlucky');

  // The client reads the outcome off the view, so it has to be on the view.
  const state = JSON.parse(socket.sent[socket.sent.length - 1]).state;
  assert.equal(state.phase, PHASES.over);
  assert.equal(state.outcome, 'lost');
});

test('the run keeps a record, and the record can name who did what', () => {
  const { room, player } = fightWith('strike', 'engineer');
  const target = room.enemies[0];
  mute(room);
  target.hp = 99;

  room.handle(player, { t: 'intent', intent: { t: 'action', id: swing(player), target: target.id } });
  assert.equal(player.stats.damage, CARDS[swing(player)].effect.amount, 'a swing should be counted');

  room.handle(player, { t: 'intent', intent: { t: 'action', id: guard(player) } });
  assert.equal(player.stats.guard, CARDS[guard(player)].effect.amount, 'so should guard');

  const rows = runHighlights(room.players);
  const damage = rows.find(r => r.key === 'damage');
  assert.ok(damage, 'somebody dealt damage, so the medal should exist');
  assert.equal(damage.player.id, player.id);
  assert.equal(rows.some(r => r.key === 'revived'), false,
    'nobody was picked up, so no medal is awarded for zero');
});

test('overkill is not credited, or aiming a Fireball at a Sporeling wins the run', () => {
  const { room, player } = fightWith('fireball', 'wizard');
  const target = room.enemies[0];
  mute(room);
  target.hp = 2;

  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'fireball', target: target.id } });
  assert.equal(player.stats.damage, 2, 'only what actually landed counts');
  assert.equal(player.stats.kills, 1);
});

test('another run keeps the crew and changes the ruin', () => {
  const { room, player } = fightWith('hold', 'wizard');
  for(const enemy of room.enemies) enemy.hits = 99;
  room.handle(player, { t: 'intent', intent: { t: 'action', id: guard(player) } });
  assert.equal(room.phase, PHASES.over);

  const wasSeed = room.seed;
  const wasSite = room.site.join('');
  room.handle(player, { t: 'restart' });

  assert.equal(room.phase, PHASES.lobby, 'a restart goes back to the lobby');
  assert.equal(room.outcome, null);
  assert.equal(room.round, 1);
  assert.equal(player.classId, 'wizard', 'the seat is kept — re-picking is a menu, not a decision');
  assert.equal(player.down, false);
  assert.equal(player.stats.damage, 0, 'the record starts empty');
  assert.notEqual(room.seed, wasSeed, 'a second attempt must not be a memory test');

  room.handle(player, { t: 'start' });
  assert.equal(room.phase, PHASES.build);
  assert.notEqual(room.site.join(''), wasSite, 'and the new run is a different ruin');
});

test('only the host starts another run, and only from the end of one', () => {
  const room = roomFor(`again-${++codes}`);
  const seats = ['engineer', 'alchemist'].map((classId, i) => {
    const player = room.join(`again-token-${codes}-${i}`, fakeSocket());
    room.handle(player, { t: 'class', classId });
    return player;
  });
  room.handle(seats[0], { t: 'start' });
  assert.equal(room.phase, PHASES.build);

  // Mid-run: a restart would throw away four rounds of everybody else's work.
  room.handle(seats[0], { t: 'restart' });
  assert.equal(room.phase, PHASES.build, 'a run in progress cannot be restarted');

  room.phase = PHASES.over;
  room.outcome = 'lost';
  room.handle(seats[1], { t: 'restart' });
  assert.equal(room.phase, PHASES.over, 'a guest cannot restart for everybody');

  room.handle(seats[0], { t: 'restart' });
  assert.equal(room.phase, PHASES.lobby, 'the host can');
});

/* ---- the scriptorium ----------------------------------------------------- */

/* The Wizard's build phase: pages open drafts, picks fill the book, sockets
 * rearrange it, and the surge deals what the book says. These drive the real
 * room through real intents, because the client is only ever a renderer of
 * what these paths produce.
 */

import {
  SPELLS, MODIFIERS, composeSpell, freshSpellbook, wizardCombatDeck,
} from '../public/good-vibes/content.js';

/* A room parked in the build phase with one seated wizard. */
function scriptorium(){
  const room = roomFor(`study-${++codes}`);
  const socket = fakeSocket();
  const player = room.join(`study-token-${codes}`, socket);
  room.handle(player, { t: 'class', classId: 'wizard' });
  room.handle(player, { t: 'start' });
  assert.equal(room.phase, PHASES.build);
  return { room, player, socket };
}

/* Straight to a fight with a hand-authored book, no drafting involved. */
function surgeWith(slots, hand){
  const { room, player } = scriptorium();
  room.spellbook = { known: Object.keys(slots), satchel: [], slots };
  room.handle(player, { t: 'ready', ready: true });
  assert.equal(room.phase, PHASES.combat);
  return { room, player };
}

test('a page opens a draft, a pick closes it, and nobody else can touch either', () => {
  const { room, player } = scriptorium();
  const pages = room.pages;
  assert.ok(pages >= 1, 'the library owes her an opening page');

  room.handle(player, { t: 'intent', intent: { t: 'page' } });
  assert.equal(room.pages, pages - 1, 'the draft costs the page');
  assert.equal(room.offers.length, 3, 'three ways to read it');

  // A second page while the draft is open buys nothing.
  room.handle(player, { t: 'intent', intent: { t: 'page' } });
  assert.equal(room.pages, pages - 1, 'one draft on the table at a time');

  const offer = room.offers[0];
  const before = JSON.parse(JSON.stringify(room.spellbook));
  room.handle(player, { t: 'intent', intent: { t: 'pick', index: 0 } });
  assert.equal(room.offers, null, 'the pick closes the draft');
  if(offer.type === 'spell'){
    assert.ok(room.spellbook.known.includes(offer.id));
    assert.ok(!before.known.includes(offer.id));
  }else{
    assert.equal(room.spellbook.satchel.filter(m => m === offer.id).length,
      before.satchel.filter(m => m === offer.id).length + 1);
  }
});

test('the pages are the party pool but the pen is the wizard alone', () => {
  const room = roomFor(`pen-${++codes}`);
  const seats = ['engineer', 'wizard'].map((classId, i) => {
    const player = room.join(`pen-token-${codes}-${i}`, fakeSocket());
    room.handle(player, { t: 'class', classId });
    return player;
  });
  room.handle(seats[1], { t: 'start' });
  const pages = room.pages;

  room.handle(seats[0], { t: 'intent', intent: { t: 'page' } });
  assert.equal(room.offers, null, 'the engineer cannot open a draft');
  assert.equal(room.pages, pages, 'or spend a page trying');

  room.spellbook = { known: ['fireball'], satchel: ['kindling'], slots: { fireball: [] } };
  room.handle(seats[0], { t: 'intent', intent: { t: 'mod', mod: 'kindling', spell: 'fireball' } });
  assert.equal(room.spellbook.slots.fireball.length, 0, 'or set a socket');
});

test('sockets move through real intents and the deck list follows the book', () => {
  const { room, player } = scriptorium();
  room.spellbook = { known: ['fireball'], satchel: ['kindling', 'twin', 'echo', 'siphon'], slots: { fireball: [] } };

  for(const mod of ['kindling', 'twin', 'echo']){
    room.handle(player, { t: 'intent', intent: { t: 'mod', mod, spell: 'fireball' } });
  }
  assert.deepEqual(room.spellbook.slots.fireball, ['kindling', 'twin', 'echo']);
  room.handle(player, { t: 'intent', intent: { t: 'mod', mod: 'siphon', spell: 'fireball' } });
  assert.equal(room.spellbook.slots.fireball.length, 3, 'a fourth socket does not exist');

  // (10+5)x2-3 = 27, and the charges the composed spell asks for are what a
  // cast costs out of her pool.
  const composed = composeSpell('fireball', room.spellbook.slots.fireball);
  assert.ok(room.actionIds(player).includes('fireball'),
    'what she can cast is read off the book, the moment the book changes');
  assert.equal(actionCost('fireball', composed).amount, composed.charges,
    'and the socketed spell prices itself');

  // Reordering: pull one out, put it back in front.
  room.handle(player, { t: 'intent', intent: { t: 'mod', mod: 'kindling', spell: null } });
  room.handle(player, { t: 'intent', intent: { t: 'mod', mod: 'kindling', spell: 'fireball', pos: 99 } });
  assert.deepEqual(room.spellbook.slots.fireball, ['twin', 'echo', 'kindling'],
    'pos places a socket exactly where the drag dropped it');
});

test('a crafted Twin Core Fireball lands for 30 and costs the pool nothing', () => {
  const { room, player } = surgeWith({ fireball: ['kindling', 'twin'] }, ['fireball', 'hold', 'hold']);
  const target = room.enemies[0];
  target.hp = 99; mute(room);
  const pages = room.pages;

  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'fireball', target: target.id } });
  assert.equal(target.hp, 99 - 30, 'the worked example, through the whole engine');
  assert.equal(room.pages, pages, 'the book already paid — no page leaves the pool');
});

test('charges are a pool: spent on the cast, and a little back every round', () => {
  const { room, player } = surgeWith({ fireball: [] });
  assert.equal(player.charges, CHARGE_CAP, 'a fight opens with the pool full');

  mute(room);
  const cost = SPELLS.fireball.charges;
  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'fireball' } });
  // Spent on the cast, then topped up by the round that follows. That gap is
  // the Wizard's whole economy: her question is always this round or next.
  assert.equal(player.charges, CHARGE_CAP - cost + CHARGE_REGEN, 'the cast costs, the round pays back');
  assert.ok(CHARGE_REGEN < cost, 'or a big spell every round would be free');

  // Emptied, the option is still on the table and still says why it is greyed.
  player.charges = 0;
  assert.equal(actionReady('fireball', room.seatState(player), composeSpell('fireball', [])).ok, false);
  assert.equal(actionReady('fireball', room.seatState(player), composeSpell('fireball', [])).why, 'charges');

  // And the next surge opens full again, however the last one ended.
  room.phase = PHASES.build;
  room.handle(player, { t: 'ready', ready: true });
  assert.equal(player.charges, CHARGE_CAP, 'a pool is a per-combat thing');
});

test('the bloodpact cannot take the last point, and the siphon gives some back', () => {
  const bled = surgeWith({ fireball: ['bloodpact'] }, ['fireball', 'hold', 'hold']);
  for(const enemy of bled.room.enemies) enemy.hp = 99;
  mute(bled.room);
  bled.player.hp = 2;
  bled.room.handle(bled.player, { t: 'intent', intent: { t: 'action', id: 'fireball' } });
  assert.equal(bled.player.hp, 1, 'the seal takes what it can and stops at the last point');

  const fed = surgeWith({ fireball: ['siphon'] }, ['fireball', 'hold', 'hold']);
  for(const enemy of fed.room.enemies) enemy.hp = 99;
  mute(fed.room);
  fed.player.hp = 5;
  fed.room.handle(fed.player, { t: 'intent', intent: { t: 'action', id: 'fireball' } });
  assert.equal(fed.player.hp, 5 + Math.ceil(SPELLS.fireball.amount / 2),
    'half of what it took out of them finds its way back');
});

/* "The back of the lane" used to mean the highest `dist`. Nothing is any
   distance away on a standoff field, so it means the far end of the row as
   drawn — the last of the wave, which is where the client paints it. The
   fixture below is unchanged because it already lists them near-first. */
test('farsight snipes the back of the lane when she does not aim', () => {
  const { room, player } = surgeWith({ fireball: ['farsight'] }, ['fireball', 'hold', 'hold']);
  room.enemies = [
    { id: 'near', type: 'sporeling', name: 'Sporeling', art: 'sporeling', hp: 50, maxHp: 50, hits: 0, landed: 0 },
    { id: 'far', type: 'creeper', name: 'Creeper', art: 'creeper', hp: 50, maxHp: 50, hits: 0, landed: 0 },
  ];
  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'fireball' } });
  assert.equal(room.enemies[0].hp, 50, 'the nearest is not the one it lands on');
  assert.ok(room.enemies[1].hp < 50, 'it lands all the way back');
});

test('a gilded kill pays pages back to the library', () => {
  const { room, player } = surgeWith({ fireball: ['gilded'] }, ['fireball', 'hold', 'hold']);
  // A second enemy stays standing, so the round does not end and pay its own
  // build-phase page income on top of the margin's.
  room.enemies = [
    { id: 'e0', type: 'sporeling', name: 'Sporeling', art: 'sporeling', hp: 1, maxHp: 6, hits: 0, landed: 0 },
    { id: 'e1', type: 'creeper', name: 'Creeper', art: 'creeper', hp: 50, maxHp: 50, hits: 0, landed: 0 },
  ];
  const pages = room.pages;
  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'fireball', target: 'e0' } });
  assert.equal(room.pages, pages + 1, 'a kill worth writing down pays for the paper');
});

test('an opening word opens the fight with more in the pool than it can hold', () => {
  const { room, player } = surgeWith({ fireball: ['opening'] });
  // It used to put the spell on top of the deck, so it was in the first hand.
  // There is no deck; what it buys now is a charge over the cap — the same
  // promise, that you get to say the big thing first, in the currency that
  // still exists.
  assert.ok(player.charges > CHARGE_CAP, 'the surge opens with a surplus');
  assert.ok(room.enemies.length > 0);

  // And it decays, because the round's top-up stops at the cap.
  mute(room);
  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'sign' } });
  assert.ok(player.charges <= CHARGE_CAP, 'the surplus is a start, not a standing bonus');
});

/* ---- the garden ---------------------------------------------------------- */

import { plantPot, potYield } from '../public/good-vibes/content.js';

test('the pots are the alchemist\'s, they grow between rounds, and they pay on her clock', () => {
  const room = roomFor(`pots-${++codes}`);
  const seats = ['alchemist', 'wizard'].map((classId, i) => {
    const player = room.join(`pots-token-${codes}-${i}`, fakeSocket());
    room.handle(player, { t: 'class', classId });
    return player;
  });
  room.handle(seats[0], { t: 'start' });
  assert.equal(room.phase, PHASES.build);

  room.stash = { sunpetal: 2 };
  room.handle(seats[1], { t: 'intent', intent: { t: 'plant', pot: 0, herb: 'sunpetal' } });
  assert.equal(room.pots[0], null, 'the wizard does not garden');

  room.handle(seats[0], { t: 'intent', intent: { t: 'plant', pot: 0, herb: 'sunpetal' } });
  assert.deepEqual(room.pots[0], { herb: 'sunpetal', age: 0 });
  assert.equal(room.stash.sunpetal, 1);

  // Harvesting straight away refunds the cutting — no same-round loop.
  room.handle(seats[0], { t: 'intent', intent: { t: 'harvest', pot: 0 } });
  assert.equal(room.stash.sunpetal, 2);
  assert.equal(room.pots[0], null);

  // Replant, fight a round, and the pot has grown by the next build phase.
  room.handle(seats[0], { t: 'intent', intent: { t: 'plant', pot: 0, herb: 'sunpetal' } });
  for(const p of seats) room.handle(p, { t: 'ready', ready: true });
  assert.equal(room.phase, PHASES.combat);
  for(const enemy of room.enemies) enemy.hp = 0;
  room.handle(seats[0], { t: 'intent', intent: { t: 'action', id: guard(seats[0]) } });
  room.handle(seats[1], { t: 'intent', intent: { t: 'action', id: guard(seats[1]) } });
  assert.equal(room.phase, PHASES.build, 'an empty lane ends the round');
  assert.equal(room.pots[0].age, 1, 'the garden grew while everyone was fighting');

  room.handle(seats[0], { t: 'intent', intent: { t: 'harvest', pot: 0 } });
  assert.equal(room.stash.sunpetal, 1 + potYield(1), 'a round of patience pays');
});

test('anyone can bend down for a herb, and the Alchemist is worth two of them', () => {
  const room = roomFor(`herbs-${++codes}`);
  const seats = ['wizard', 'alchemist'].map((classId, i) => {
    const player = room.join(`herbs-token-${codes}-${i}`, fakeSocket());
    room.handle(player, { t: 'class', classId });
    return player;
  });
  room.handle(seats[0], { t: 'start' });

  const herbs = room.nodes.filter(n => n.kind === 'herb');
  assert.ok(herbs.length >= 2, 'a site always grows herbs');

  /* This used to be a rule about permission — a herb was the Alchemist's alone
   * and everybody else walked over it. That left four of the five seats with
   * nothing to do with the thing the build phase is mostly made of, and a party
   * without her could not brew at all. It is a rule about *yield* now: she is
   * twice the gatherer anybody else is, which is a reason to send her rather
   * than a door that is locked to everyone else.
   */
  seats[0].x = herbs[0].x; seats[0].y = herbs[0].y;
  room.pickUp(seats[0]);
  assert.equal(herbs[0].taken, true, 'the wizard can pick a herb up');
  assert.equal(room.stash[herbs[0].material], classById('wizard').gather);

  seats[1].x = herbs[1].x; seats[1].y = herbs[1].y;
  room.pickUp(seats[1]);
  assert.equal(herbs[1].taken, true);
  const gathered = herbs[0].material === herbs[1].material
    ? room.stash[herbs[1].material] - classById('wizard').gather
    : room.stash[herbs[1].material];
  assert.equal(gathered, classById('alchemist').gather,
    'and she is worth two of him doing it');
  assert.ok(classById('alchemist').gather > classById('wizard').gather,
    'which is the whole of the difference');

  // Pages are the Wizard's alphabet, and he is the only seat that reads one.
  const pages = room.nodes.find(n => n.kind === 'pages' && !n.taken);
  if(pages){
    const before = room.pages;
    seats[1].x = pages.x; seats[1].y = pages.y;
    room.pickUp(seats[1]);
    assert.equal(pages.taken, false, 'the Alchemist leaves the pages standing');
    assert.equal(room.pages, before, 'and the party is no richer for the walk');

    seats[0].x = pages.x; seats[0].y = pages.y;
    room.pickUp(seats[0]);
    assert.equal(pages.taken, true, 'the Wizard reads it');
    assert.equal(room.pages, before + CACHE_YIELD.pages);
  }
});

/* The other half of the same rule, and the one the yield gate was written for:
 * a cache is a wreck read back into parts, and two of the five seats cannot
 * read one. It stays where it lies for a seat that can, and the Engineer is
 * three of a Hauler at it — a reason to send him, not a door the rest are
 * locked out of, since three of the five can crack one.
 */
test('a cache is only worth what the seat cracking it can read out of it', () => {
  const room = roomFor(`caches-${++codes}`);
  const seats = ['wizard', 'engineer', 'hauler'].map((classId, i) => {
    const player = room.join(`cache-token-${codes}-${i}`, fakeSocket());
    room.handle(player, { t: 'class', classId });
    return player;
  });
  room.handle(seats[0], { t: 'start' });

  const caches = room.nodes.filter(n => n.kind === 'salvage');
  assert.ok(caches.length >= 2, 'a site always leaves wreckage');

  const total = (s) => Object.values(s).reduce((n, v) => n + v, 0);

  // The Wizard reads books, not pipework.
  const before = total(room.salvage);
  seats[0].x = caches[0].x; seats[0].y = caches[0].y;
  room.pickUp(seats[0]);
  assert.equal(caches[0].taken, false, 'he leaves the cache for somebody who can');
  assert.equal(total(room.salvage), before, 'and takes nothing out of it');

  // The Engineer, standing on the very same one, empties it.
  seats[1].x = caches[0].x; seats[1].y = caches[0].y;
  room.pickUp(seats[1]);
  assert.equal(caches[0].taken, true);
  assert.equal(total(room.salvage) - before, classById('engineer').salvage);

  // The Hauler can crack one too, for a third of what the Engineer gets.
  const mid = total(room.salvage);
  seats[2].x = caches[1].x; seats[2].y = caches[1].y;
  room.pickUp(seats[2]);
  assert.equal(caches[1].taken, true, 'a cache is not for the Engineer alone');
  assert.equal(total(room.salvage) - mid, classById('hauler').salvage);
  assert.ok(classById('engineer').salvage > classById('hauler').salvage,
    'which is the whole of the difference');
});

/* ---- the soundtrack ------------------------------------------------------ */

/* A song is data driven through a scheduler that reads it every sixteenth of a
 * bar, and every way of getting it wrong fails the same silent way: the
 * scheduler throws inside a setInterval, the exception goes to the console
 * nobody has open, and the page is simply quiet. So the shape is checked here
 * rather than by listening.
 */
test('every song is playable data rather than a silent typo', () => {
  const QUALITIES = ['maj6', 'maj7', 'min7', 'min', 'sus'];
  assert.ok(SONGS.title, 'the title screen needs a theme of its own');

  for(const [name, song] of Object.entries(SONGS)){
    const where = `song "${name}"`;
    assert.ok(song.bpm > 40 && song.bpm < 220, `${where}: ${song.bpm} bpm is not a tempo`);
    assert.ok(Array.isArray(song.bars) && song.bars.length, `${where}: no bars`);
    assert.ok(song.arpEvery >= 1, `${where}: the arpeggio would divide by zero`);

    for(const bar of song.bars){
      const [root, quality] = bar.chord;
      // An unknown quality is `undefined` where a list of intervals should be,
      // and the scheduler dies on the first beat of that bar.
      assert.ok(QUALITIES.includes(quality), `${where}: unknown chord quality "${quality}"`);
      assert.ok(root > 20 && root < 100, `${where}: root ${root} is off the keyboard`);
    }

    const steps = song.bars.length * 16;
    for(const [at, note, len] of song.lead){
      assert.ok(at >= 0 && at < steps, `${where}: a note at step ${at} never plays (${steps} steps)`);
      assert.ok(note > 20 && note < 120, `${where}: note ${note} is off the keyboard`);
      assert.ok(len > 0, `${where}: a note of length ${len} is silence`);
    }
  }
});

/* ---- the standoff -------------------------------------------------------- */

/* A surge used to be a chase: enemies carried a `dist` and only swung once it
 * reached zero. Then it was a standoff where each swing found one seat on a
 * rotation. It is a standoff where a swing finds *everybody* now, and what an
 * enemy is about to do — rather than who it picked — is the whole of the
 * telegraph. Everything below is a property of that.
 */

/* Park an enemy on a chosen intent. `turn` is what the pattern cycles on, so
   this is the same lever the room pulls, not a back door around it. */
const parkOn = (enemy, kind) => {
  const pattern = ENEMIES[enemy.type].pattern;
  const at = pattern.indexOf(kind);
  assert.ok(at >= 0, `${enemy.type} has no ${kind} in its pattern`);
  enemy.turn = at;
  return enemy;
};

/* One enemy of a chosen type, parked on a chosen intent, in place of whatever
   the round rolled. Not every pattern holds every intent — only the Rust Hulk
   winds up and only the Extractor bolsters — so a test about one of those has
   to bring the thing that does it. */
const loneEnemy = (room, type, kind, over = {}) => {
  const def = ENEMIES[type];
  const enemy = parkOn({
    id: 'e0', type, name: def.name, art: def.art,
    hp: 99, maxHp: 99, hits: def.hits,
    turn: 0, cast: 0, might: 0, charged: false, ...over,
  }, kind);
  room.enemies = [enemy];
  return enemy;
};

test('everything on the field acts from the first turn', () => {
  const { room, player } = fightWith('hold', 'engineer');
  const acting = room.enemies.filter(e => e.hp > 0).length;
  assert.ok(acting > 0, 'the wave has to be able to do something');

  const turnsBefore = room.enemies.map(e => e.turn || 0);
  room.handle(player, { t: 'intent', intent: { t: 'action', id: guard(player) } });
  // Under the approach model nothing could act on turn one. Every living thing
  // now takes its turn every round, whatever that turn happens to be.
  for(const [i, enemy] of room.enemies.entries()){
    if(enemy.hp <= 0) continue;
    assert.equal(enemy.turn, turnsBefore[i] + 1, 'every living enemy took its turn');
  }
});

test('the telegraph names which of the four things is coming', () => {
  const { room, player, socket } = fightWith('hold', 'engineer');
  room.broadcast();
  const state = JSON.parse(socket.sent[socket.sent.length - 1]).state;

  for(const enemy of state.enemies){
    assert.ok(enemy.intent, 'a living enemy must publish an intent');
    assert.ok(ENEMY_INTENTS[enemy.intent.kind], `${enemy.intent.kind} is not an intent`);
    assert.equal(enemy.intent.kind, intentKindOf(enemy.type, enemy.turn || 0));
    // No seat on it any more: an attack lands on the whole party, so there is
    // nobody in particular for the plate to name.
    assert.equal(enemy.intent.at, undefined, 'the plate no longer names a seat');
  }

  // The plate is a lookahead, not a second copy of the rule. An attack says the
  // number the swing will use, read off the same enemyDamage the swing reads.
  const one = room.enemies[0];
  parkOn(one, 'attack');
  assert.equal(intentOf(one).damage, enemyDamage(one));
  one.might = 3;
  assert.equal(intentOf(one).damage, enemyDamage(one), 'a bolstered thing says so on the plate');
});

test('an attack lands on every seat at once', () => {
  const room = roomFor(`aoe-${++codes}`);
  const seats = ['alchemist', 'engineer', 'wizard'].map((classId, i) => {
    const player = room.join(`aoe-token-${codes}-${i}`, fakeSocket());
    room.handle(player, { t: 'class', classId });
    return player;
  });
  room.handle(seats[0], { t: 'start' });
  for(const p of seats) room.handle(p, { t: 'ready', ready: true });

  // One enemy, on an attack, against three seats. Under the round-robin this
  // was the fight where two of the three were never touched.
  room.enemies = [room.enemies[0]];
  const enemy = parkOn(room.enemies[0], 'attack');
  enemy.hp = 99;
  for(const p of seats){ p.hp = 30; p.maxHp = 30; p.block = 0; }

  const damage = enemyDamage(enemy);
  for(const p of seats) room.handle(p, { t: 'intent', intent: { t: 'wait' } });

  for(const p of seats){
    assert.equal(p.hp, 30 - damage, `${p.classId} should have taken the swing too`);
  }
});

test('guard comes off each seat share of the blow, not off a pool', () => {
  const { room, player } = fightWith('hold', 'engineer');
  room.enemies = [room.enemies[0]];
  const enemy = parkOn(room.enemies[0], 'attack');
  enemy.hp = 99;
  enemy.hits = 5;
  enemy.might = 0;
  enemy.charged = false;

  player.hp = 30; player.maxHp = 30;
  room.handle(player, { t: 'intent', intent: { t: 'action', id: guard(player) } });

  // Hold wards 2 against a swing of 5: three gets through, and the guard is
  // gone rather than carried.
  assert.equal(player.hp, 30 - (5 - CARDS[guard(player)].effect.amount), 'guard subtracts from the blow');
  assert.equal(player.block, 0, 'and does not carry into the next round');
});

test('a wind-up lands for double the round after, and says so first', () => {
  const { room, player } = fightWith('hold', 'engineer');
  const enemy = loneEnemy(room, 'hulk', 'charge', { hits: 4 });

  const promised = intentOf(enemy);
  assert.equal(promised.kind, 'charge');
  assert.equal(promised.damage, 0, 'a wind-up lands nothing on the round it winds up');
  assert.equal(promised.next, 4 * CHARGE_MULTIPLIER, 'and the plate says what is coming');

  player.hp = 40; player.maxHp = 40;
  room.handle(player, { t: 'intent', intent: { t: 'wait' } });
  assert.equal(player.hp, 40, 'nothing lands on the wind-up itself');
  assert.equal(enemy.charged, true, 'it is holding the swing');

  // And the plate now promises the doubled number, which is what makes the
  // wind-up a decision rather than a free round.
  parkOn(enemy, 'attack');
  assert.equal(intentOf(enemy).damage, 4 * CHARGE_MULTIPLIER);
  room.handle(player, { t: 'intent', intent: { t: 'wait' } });
  assert.equal(player.hp, 40 - 4 * CHARGE_MULTIPLIER, 'and then it lands for all of it');
  assert.equal(enemy.charged, false, 'the wind-up is spent on the blow it was saved for');
});

test('a bolster is kept for the rest of the fight', () => {
  const { room, player } = fightWith('hold', 'engineer');
  const enemy = loneEnemy(room, 'extractor', 'bolster', { hits: 3 });

  player.hp = 40; player.maxHp = 40;
  room.handle(player, { t: 'intent', intent: { t: 'wait' } });

  assert.equal(player.hp, 40, 'a bolster lands nothing');
  assert.equal(enemy.might, BOLSTER_STEP, 'it takes the weight onto itself');
  parkOn(enemy, 'attack');
  assert.equal(intentOf(enemy).damage, 3 + BOLSTER_STEP, 'and swings for more from here on');
});

test('a dose that guard swallows whole leaves nothing behind', () => {
  const { room, player } = fightWith('shore', 'engineer');
  room.enemies = [room.enemies[0]];
  const enemy = parkOn(room.enemies[0], 'blight');
  enemy.hp = 99;
  enemy.hits = 4;
  enemy.might = 0;
  enemy.charged = false;

  const intent = intentOf(enemy);
  assert.equal(intent.kind, 'blight');
  assert.equal(intent.damage, blightDamage(enemy));
  assert.ok(intent.ail, 'a dose has to say what it is a dose of');

  // Shore Up wards 3 against a dose of 2: nothing gets through, so nothing is
  // left behind. This is the whole reason to spend a card on guard against a
  // Creeper rather than trade with it.
  player.hp = 30; player.maxHp = 30;
  assert.ok(CARDS.shore.effect.amount >= intent.damage, 'the ward has to cover the dose');
  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'shore' } });

  assert.equal(player.hp, 30, 'guard ate all of it');
  assert.equal(hasEffect(player.effects, intent.ail), false, 'and the ailment with it');
  assert.equal(enemy.cast || 0, 0, 'a refused dose does not advance the ring');
});

test('a dose that gets through leaves its ailment', () => {
  const { room, player } = fightWith('hold', 'engineer');
  room.enemies = [room.enemies[0]];
  const enemy = parkOn(room.enemies[0], 'blight');
  enemy.hp = 99;
  enemy.hits = 8;
  enemy.might = 0;
  enemy.charged = false;
  const ail = intentOf(enemy).ail;

  player.hp = 30; player.maxHp = 30;
  room.handle(player, { t: 'intent', intent: { t: 'wait' } });

  assert.ok(player.hp < 30, 'a dose still costs health');
  assert.ok(hasEffect(player.effects, ail), `and leaves ${ail} behind`);
  assert.equal(enemy.cast, 1, 'a given dose advances the ring');
});

test('the boss walks its whole ring of ailments', () => {
  // One ailment enemies always land the same one; the Extractor cycles, and
  // `cast` is the only state that decides which.
  const ring = ['weak', 'rot', 'stun'];
  for(let i = 0; i < 7; i++){
    assert.equal(blightOf('extractor', i), ring[i % ring.length]);
  }
  assert.equal(blightOf('sporeling', 4), 'rot', 'and a Sporeling only ever rots');
});

test('cover stands in front of the party while the guard holds', () => {
  const room = roomFor(`cover-${++codes}`);
  const seats = ['hauler', 'engineer', 'wizard'].map((classId, i) => {
    const player = room.join(`cover-token-${codes}-${i}`, fakeSocket());
    room.handle(player, { t: 'class', classId });
    return player;
  });
  room.handle(seats[0], { t: 'start' });
  for(const p of seats) room.handle(p, { t: 'ready', ready: true });
  const [hauler, engineer, wizard] = seats;

  room.enemies = [room.enemies[0]];
  const enemy = parkOn(room.enemies[0], 'attack');
  enemy.hp = 99;
  enemy.hits = 4;
  enemy.might = 0;
  enemy.charged = false;

  for(const p of seats){ p.hp = 40; p.maxHp = 40; p.block = 0; }

  // Six of guard against a swing of four, three shares to cover. The Hauler
  // takes their own share out of the guard and one ally's, and the last two
  // points are not enough for the third — so the wave finds that seat.
  room.handle(hauler, { t: 'intent', intent: { t: 'action', id: 'behind' } });
  room.handle(engineer, { t: 'intent', intent: { t: 'wait' } });
  room.handle(wizard, { t: 'intent', intent: { t: 'wait' } });

  const covered = [engineer, wizard].filter(p => p.hp === 40).length;
  assert.equal(covered, 1, 'the guard buys exactly one ally a free round');
  assert.ok(hauler.hp < 40, 'and the Hauler pays for it once the guard is gone');
});

/* ---- coordination -------------------------------------------------------
 *
 * A phase turns when everybody who can act has acted, and until this section
 * existed nothing checked what "everybody" meant when somebody closed a laptop.
 * All four of these were reproducible bugs: a dropped seat froze the round it
 * was in, a dropped host stranded the party on the end screen with nobody able
 * to restart, and a commitment could not be taken back once it was made.
 */

/* A seated party, mid-fight, with a socket kept per seat so a drop is a real
   drop rather than a flag being set behind the room's back. */
const party = (label, classes) => {
  const room = roomFor(`${label}-${++codes}`);
  const sockets = [];
  const seats = classes.map((classId, i) => {
    const socket = fakeSocket();
    sockets.push(socket);
    const player = room.join(`${label}-token-${codes}-${i}`, socket);
    room.handle(player, { t: 'class', classId });
    return player;
  });
  room.handle(seats[0], { t: 'start' });
  return { room, seats, sockets, tokenOf: i => `${label}-token-${codes}-${i}` };
};

test('a seat dropping mid-round does not freeze the round', () => {
  const { room, seats } = party('drop', ['alchemist', 'engineer', 'wizard']);
  for(const p of seats) room.handle(p, { t: 'ready', ready: true });
  assert.equal(room.phase, PHASES.combat);

  room.handle(seats[0], { t: 'intent', intent: { t: 'wait' } });
  room.handle(seats[1], { t: 'intent', intent: { t: 'wait' } });
  assert.ok(seats[0].intent, 'two are in and the round is still waiting on the third');

  // The third closes the tab. The round is owed a resolution to the two people
  // still sitting there, and used to sit unresolved until the absent player
  // came back — which, if they had gone to bed, was never.
  room.leave(seats[2]);
  assert.equal(seats[0].intent, null, 'the round resolved without the seat that left');
  assert.equal(seats[1].intent, null);
});

test('a seat dropping in the build phase does not hold the surge back', () => {
  const { room, seats } = party('holdout', ['alchemist', 'engineer', 'wizard']);
  room.handle(seats[0], { t: 'ready', ready: true });
  room.handle(seats[1], { t: 'ready', ready: true });
  assert.equal(room.phase, PHASES.build, 'still waiting on the third');

  room.leave(seats[2]);
  assert.equal(room.phase, PHASES.combat, 'the last holdout leaving is the phase turning');
});

test('a returning seat comes back to the character it was playing, mid-fight', () => {
  const { room, seats, tokenOf } = party('rejoin', ['alchemist', 'engineer']);
  for(const p of seats) room.handle(p, { t: 'ready', ready: true });
  assert.equal(room.phase, PHASES.combat);

  seats[0].hp = 17;
  const was = seats[0].id;
  room.leave(seats[0]);
  assert.equal(seats[0].connected, false, 'the seat is away');
  assert.ok(room.players.includes(seats[0]), 'but it is still their seat');

  // A round went by without them. resolve() only deals to the people who were
  // in it, so the returning seat would otherwise come back holding nothing.
  const back = room.join(tokenOf(0), fakeSocket());
  assert.equal(back, seats[0], 'the token gets the same character back');
  assert.equal(back.id, was);
  assert.equal(back.hp, 17, 'with the health it left with');
  assert.equal(back.connected, true);
  assert.equal(back.stock.tonic, 2, 'with the rack they walked away from');
});

test('a returning seat completes the round it came back to', () => {
  const { room, seats, tokenOf } = party('late', ['alchemist', 'engineer']);
  for(const p of seats) room.handle(p, { t: 'ready', ready: true });

  room.leave(seats[1]);
  room.handle(seats[0], { t: 'intent', intent: { t: 'wait' } });
  // One seat away, one committed: the round already resolved without the absent
  // one, so the party is waiting on nothing.
  assert.equal(seats[0].intent, null);

  const back = room.join(tokenOf(1), fakeSocket());
  room.handle(seats[0], { t: 'intent', intent: { t: 'wait' } });
  assert.ok(seats[0].intent, 'now there are two of them again, so one is not enough');
  room.handle(back, { t: 'intent', intent: { t: 'wait' } });
  assert.equal(seats[0].intent, null, 'and the second commitment turns the round');
});

test('the host is a role and it survives the host leaving', () => {
  const { room, seats } = party('host', ['alchemist', 'engineer']);
  assert.equal(seats[0].host, true);

  room.leave(seats[0]);
  assert.equal(seats[1].host, true, 'the room passes to whoever is still in it');
  assert.equal(room.players.filter(p => p.host && p.connected).length, 1, 'exactly one host');

  // And the point of it: `restart` is host-only, so a party whose host dropped
  // mid-run used to reach the end screen with nobody able to press the button.
  room.phase = PHASES.over;
  room.outcome = 'lost';
  room.handle(seats[1], { t: 'restart' });
  assert.equal(room.phase, PHASES.lobby, 'the new host can start the next run');
});

test('a choice can be changed until the last seat is in', () => {
  const { room, seats } = party('undo', ['engineer', 'wizard']);
  for(const p of seats) room.handle(p, { t: 'ready', ready: true });

  room.handle(seats[0], { t: 'intent', intent: { t: 'action', id: guard(seats[0]) } });
  assert.equal(seats[0].intent.id, 'shore');

  // Swapped for another action. The fastest reader at the table commits first and
  // should not be the one seat that cannot react to what the others do.
  room.handle(seats[0], { t: 'intent', intent: { t: 'action', id: 'wrench' } });
  assert.equal(seats[0].intent.id, 'wrench', 'a commitment is a pencil');

  // And taken back to undecided entirely.
  room.handle(seats[0], { t: 'intent', intent: { t: 'take' } });
  assert.equal(seats[0].intent, null, 'a choice can be withdrawn as well as swapped');

  // The round still turns on the last commitment, so nobody can change anything
  // after there is nothing left to change it against.
  room.handle(seats[0], { t: 'intent', intent: { t: 'action', id: 'shore' } });
  room.handle(seats[1], { t: 'intent', intent: { t: 'wait' } });
  assert.equal(seats[0].intent, null, 'the last seat in resolves the round');
});

test('a seat that committed and then left still plays the card', () => {
  const { room, seats } = party('ghost', ['engineer', 'wizard', 'alchemist']);
  for(const p of seats) room.handle(p, { t: 'ready', ready: true });
  mute(room);

  room.handle(seats[0], { t: 'intent', intent: { t: 'action', id: 'shore' } });
  room.leave(seats[0]);
  room.handle(seats[1], { t: 'intent', intent: { t: 'wait' } });
  room.handle(seats[2], { t: 'intent', intent: { t: 'wait' } });

  // Leaving after committing is not the same as leaving before it. resolve()
  // walks intents rather than connections, so the card they chose is the card
  // that resolves, whether or not they are still there to watch it.
  assert.equal(seats[0].stats.guard, CARDS.shore.effect.amount, 'the guard they chose went up');
});

/* ---- the beat ------------------------------------------------------------ */

test('a round is numbered so the party resolves before the wave', () => {
  const room = roomFor(`beat-${++codes}`);
  const socket = fakeSocket();
  const seats = ['engineer', 'wizard'].map((classId, i) => {
    const player = room.join(`beat-token-${codes}-${i}`, i === 0 ? socket : fakeSocket());
    room.handle(player, { t: 'class', classId });
    return player;
  });
  room.handle(seats[0], { t: 'start' });
  for(const p of seats) room.handle(p, { t: 'ready', ready: true });

  loneEnemy(room, 'sporeling', 'attack');
  for(const p of seats){ p.hp = 40; p.maxHp = 40; }
  socket.sent.length = 0;                 // everything before the round under test

  room.handle(seats[0], { t: 'intent', intent: { t: 'action', id: 'shore' } });
  room.handle(seats[1], { t: 'intent', intent: { t: 'action', id: 'spark' } });

  const fx = fxIn(socket);
  assert.ok(fx.length, 'a resolved round has to emit something');
  for(const e of fx) assert.equal(typeof e.step, 'number', 'every fx carries its beat');

  // Two cards, then the quiet gap, then the wave: three distinct beats at
  // least, and the wave's is after both cards. An fx names the card that
  // caused it when a card did — Spark comes through as `spark` — and its verb
  // otherwise, which is why the ward is `ward`.
  const cards = fx.filter(e => e.kind === 'ward' || e.kind === 'spark');
  const wave = fx.filter(e => e.kind === 'hit');
  assert.ok(cards.length && wave.length, 'both halves of the round should be present');
  assert.ok(Math.max(...cards.map(e => e.step)) < Math.min(...wave.map(e => e.step)),
    'every card resolves before anything the wave does');
  // And the two cards are not on the same beat as each other: the client plays
  // one seat at a time.
  assert.equal(new Set(cards.map(e => e.step)).size, 2, 'each seat gets its own beat');
});

/* ---- seats four and five ------------------------------------------------- */

/* ---- the pack, driven through a real room ----------------------------- */

/* A Hauler, seated, in the build phase, with the socket cleared. */
function haulerInBuild(label){
  const room = roomFor(`pack-${label}`);
  const socket = fakeSocket();
  const player = room.join(`token-${label}`, socket);
  room.handle(player, { t: 'class', classId: 'hauler' });
  room.handle(player, { t: 'start' });
  assert.equal(room.phase, PHASES.build);
  return { room, player, socket };
}

test('a run opens with his signature card in the bag and nothing else', () => {
  const { room, player } = haulerInBuild('open');
  // Every other seat has a floor it cannot draw beneath. His is one item.
  assert.deepEqual(packedCards(player.pack.placed), ['behind']);
  assert.deepEqual(room.actionIds(player).sort(), ['behind', 'shoulder', 'weight'].sort(),
    'two basics and whatever is in the bag — that is the whole list');
});

test('three items arrive every build phase, unasked for', () => {
  const { room, player } = haulerInBuild('draw');
  assert.equal(player.pack.loose.length, 3, 'the wreckage turns out three');
  for(const id of player.pack.loose) assert.ok(PACK_ITEMS[id], `rolled "${id}"`);

  // And again next build phase, on top of whatever survived.
  room.handle(player, { t: 'ready', ready: true });
  assert.equal(room.phase, PHASES.combat);
  for(const enemy of room.enemies) enemy.hp = 0;
  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'shoulder', target: room.enemies[0].id } });
  assert.equal(room.phase, PHASES.build, 'the wave is dead and the next build phase is open');
  assert.equal(player.pack.loose.length, 3, 'three more, every round');
});

test('what he could not fit is left on the ground when the surge starts', () => {
  const { room, player } = haulerInBuild('spill');
  const kept = player.pack.loose[0];
  const item = PACK_ITEMS[kept];

  // Take one of the three, leave two.
  let placed = null;
  outer: for(let y = 0; y < PACK_H; y++){
    for(let x = 0; x < PACK_W; x++){
      for(let rot = 0; rot < 4; rot++){
        if(packPlace(room.round, player.pack.placed, kept, x, y, rot)){
          room.handle(player, { t: 'intent', intent: { t: 'pack', index: 0, x, y, rot } });
          placed = { x, y, rot };
          break outer;
        }
      }
    }
  }
  assert.ok(placed, `${item.name} had to go in somewhere`);
  assert.equal(player.pack.loose.length, 2, 'the other two are still loose');
  assert.ok(player.pack.placed.some(p => p.id === kept), 'and the first one is in');

  room.handle(player, { t: 'ready', ready: true });
  assert.equal(room.phase, PHASES.combat);
  assert.deepEqual(player.pack.loose, [], 'the bag closes and the rest is left behind');
  assert.ok(player.pack.placed.some(p => p.id === kept), 'what fitted is still his');
});

test('the bag is the option list: pack a kit and the card appears, take it out and it goes', () => {
  const { room, player } = haulerInBuild('options');
  const before = room.actionIds(player);
  assert.equal(before.includes('sledge'), false, 'he does not own a Sledge by class');

  // Wherever it will go — the round-one bag is 13 cells with the top row cut
  // away, and a five-cell pentomino has very few homes in it.
  let put = null;
  for(let y = 0; y < PACK_H && !put; y++){
    for(let x = 0; x < PACK_W && !put; x++){
      for(let rot = 0; rot < 4 && !put; rot++){
        put = packPlace(room.round, player.pack.placed, 'sledge', x, y, rot);
      }
    }
  }
  assert.ok(put, 'the Sledge goes somewhere in the round-one bag');
  player.pack.placed = put;
  assert.ok(room.actionIds(player).includes('sledge'), 'and it is an option the moment it is in');

  // Out again, and the option goes with it.
  const index = player.pack.placed.findIndex(p => p.id === 'sledge');
  room.handle(player, { t: 'intent', intent: { t: 'unpack', index } });
  assert.equal(room.actionIds(player).includes('sledge'), false, 'out of the bag is out of the list');
  assert.ok(player.pack.loose.includes('sledge'),
    'and back among the loose — taking it out to try again must not be what loses it');
});

test('the room refuses a placement that does not fit, and nothing moves', () => {
  const { room, player } = haulerInBuild('refuse');
  const before = JSON.stringify(player.pack);

  // On top of Get Behind Me, which is already at 1,1.
  player.pack.loose = ['sledge'];
  room.handle(player, { t: 'intent', intent: { t: 'pack', index: 0, x: 1, y: 1, rot: 0 } });
  assert.equal(player.pack.placed.length, 1, 'nothing was placed');

  // Off the edge of the bag entirely.
  room.handle(player, { t: 'intent', intent: { t: 'pack', index: 0, x: 4, y: 0, rot: 0 } });
  assert.equal(player.pack.placed.length, 1, 'and a piece may not hang off the side');

  player.pack.loose = [];
  assert.equal(JSON.stringify(player.pack), before.replace(/"loose":\[[^\]]*\]/, '"loose":[]'),
    'a refusal is a no-op, never a half-applied bag');
});

test('ballast pays out as the fight opens and asks for no turn', () => {
  const { room, player } = haulerInBuild('ballast');
  player.pack.placed = [
    { id: 'plate', x: 0, y: 2, rot: 0 },
    { id: 'plate', x: 2, y: 2, rot: 0 },
    { id: 'bracing', x: 0, y: 3, rot: 0 },
    { id: 'tin', x: 4, y: 2, rot: 0 },
  ];
  player.pack.loose = [];
  assert.deepEqual(packedStats(player.pack.placed), { heft: 4, ward: 3, regen: 2, bolt: 0 });

  room.handle(player, { t: 'ready', ready: true });
  assert.equal(room.phase, PHASES.combat);

  // Heft is applied here rather than granted as a card, and it is the whole
  // reason a bag is worth packing on a seat whose every other verb costs blood.
  assert.equal(effectAmount(player.effects, 'heft'), 4, 'two Plates are worth two twos');
  assert.equal(player.block, 3, 'and the guard is in the pool before the first blow');
  assert.equal(effectAmount(player.effects, 'regen'), 2);
  assert.equal(strikePower(CARDS.shoulder.effect.amount, player.effects),
    CARDS.shoulder.effect.amount + 4, 'it is a term in every swing, paid for in room');

  // None of it is an option — ballast never asks for a turn.
  for(const id of ['plate', 'bracing', 'tin']){
    assert.equal(room.actionIds(player).includes(id), false, `${id} must not be a card`);
  }
});

test('a Bolt Case reaches the fight through the crossbow and nothing else', () => {
  const { room, player } = haulerInBuild('boltcase');
  mute(room);
  player.pack.placed = [
    { id: 'crossbow', x: 1, y: 1, rot: 0 },
    { id: 'boltcase', x: 0, y: 2, rot: 0 },
  ];
  player.pack.loose = [];
  room.handle(player, { t: 'ready', ready: true });

  const target = room.enemies[0];
  target.hp = 99;
  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'crossbow', target: target.id } });
  assert.equal(target.hp, 99 - (CARDS.crossbow.effect.amount + 2),
    'the case is in the number the room resolves, not only on the button');
});

test('the bag grows every round, and the growth is the progression', () => {
  const { room, player } = haulerInBuild('growth');
  const seen = [];
  for(let round = 1; round <= 4; round++){
    seen.push(gridCells(room.round));
    if(round === 4) break;
    room.handle(player, { t: 'ready', ready: true });
    for(const enemy of room.enemies) enemy.hp = 0;
    room.handle(player, { t: 'intent', intent: { t: 'action', id: 'shoulder', target: room.enemies[0].id } });
  }
  assert.deepEqual(seen, [13, 16, 18, 20],
    'the items churn, so the container is what has to compound');
});

test('a bag survives hibernation, and one stored before it existed wakes up', () => {
  const { room, player } = haulerInBuild('hibernate');
  player.pack.placed = packPlace(room.round, player.pack.placed, 'plate', 0, 2, 0);
  const before = JSON.stringify(player.pack);

  const woken = Room.restore(JSON.parse(JSON.stringify(room.serialize())));
  const seat = woken.players.find(p => p.classId === 'hauler');
  assert.equal(JSON.stringify(seat.pack), before, 'a whole build phase of packing must not evaporate');

  // The room the Durable Object is holding right now has no pack on anybody.
  const stored = JSON.parse(JSON.stringify(room.serialize()));
  for(const p of stored.players) delete p.pack;
  const old = Room.restore(stored);
  const seatless = old.players.find(p => p.classId === 'hauler');
  assert.equal(seatless.pack, null, 'and waking one from before this shipped must not throw');
  assert.deepEqual(old.actionIds(seatless), ['shoulder', 'weight'], 'he is just two basics until the next build phase');
});

test('heft is bought once and kept for the fight', () => {
  const { room, player } = fightWith('setfeet', 'hauler');
  mute(room);
  const target = room.enemies[0];
  target.hp = 99;

  const before = player.hp;
  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'setfeet' } });
  assert.equal(player.hp, before - CARDS.setfeet.hpCost, 'it is paid for in health');
  assert.equal(effectAmount(player.effects, 'heft'), CARDS.setfeet.effect.amount);

  // Three turns later it is still there — the only effect in the game that
  // does not age.
  for(let turn = 0; turn < 3; turn++){
    room.handle(player, { t: 'intent', intent: { t: 'action', id: 'shoulder', target: target.id } });
  }
  assert.equal(effectAmount(player.effects, 'heft'), CARDS.setfeet.effect.amount,
    'heft is bought for the fight, not rented for a round');
  assert.equal(strikePower(CARDS.shoulder.effect.amount, player.effects),
    CARDS.shoulder.effect.amount + CARDS.setfeet.effect.amount,
    'and it is a term in every swing after it');
});

test('a card can never be the thing that kills you', () => {
  const { room, player } = fightWith('setfeet', 'hauler');
  player.hp = CARDS.setfeet.hpCost;
  assert.equal(cardPlayable('setfeet', { classId: 'hauler', hp: player.hp }), false,
    'at the cost exactly it must be refused');
  assert.equal(cardPlayable('setfeet', { classId: 'hauler', hp: player.hp + 1 }), true,
    'and allowed one point above it');
});

test('canker keeps coming off after the card, and refreshes rather than stacks', () => {
  const { room, player } = fightWith('ringbark', 'grafter');
  mute(room);
  const target = room.enemies[0];
  target.hp = 99;
  const amount = CARDS.ringbark.effect.amount;

  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'ringbark', target: target.id } });
  assert.equal(target.canker, amount, 'the ring is cut this round');
  assert.equal(player.stats.damage, 0, 'and pays nothing on the round it was cut');

  // A second ring on the same target is still one ring — additive would pay
  // out triangularly and three of them would be forty-five damage.
  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'ringbark', target: target.id } });
  assert.ok(target.canker <= amount, 'canker refreshes rather than stacks');

  // It comes off on its own, smaller each round, whether or not she acts.
  const hp = target.hp;
  room.handle(player, { t: 'intent', intent: { t: 'action', id: guard(player) } });
  assert.ok(target.hp < hp, 'canker arrives without a card being played at it');
  assert.ok(player.stats.damage > 0, 'and is credited to whoever cut the ring');
});

test('a stun cannot take canker off the table', () => {
  const { room, player } = fightWith('ringbark', 'grafter');
  mute(room);
  const target = room.enemies[0];
  target.hp = 99;
  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'ringbark', target: target.id } });

  const hp = target.hp;
  player.effects = addAilment([], 'stun');
  room.handle(player, { t: 'intent', intent: { t: 'action', id: 'hook', target: target.id } });
  assert.ok(target.hp < hp, 'the ring keeps closing while she is finding her feet');
});

test('a graft is in the ally hand next round, and nowhere else', () => {
  const room = roomFor(`graft-${++codes}`);
  const seats = ['grafter', 'hauler'].map((classId, i) => {
    const player = room.join(`graft-token-${codes}-${i}`, fakeSocket());
    room.handle(player, { t: 'class', classId });
    return player;
  });
  room.handle(seats[0], { t: 'start' });
  for(const p of seats) room.handle(p, { t: 'ready', ready: true });
  mute(room);

  room.handle(seats[0], { t: 'intent', intent: { t: 'action', id: 'scion', target: seats[1].id } });
  room.handle(seats[1], { t: 'intent', intent: { t: 'action', id: guard(seats[1]) } });

  assert.ok((seats[1].uses || {}).cutting > 0,
    'a cutting posted this round is in that hand the next one');
  assert.equal(seats[0].hand.includes('cutting'), false, 'and not in the grafter\'s');
  // It is a strike, so whatever the arm is carrying counts.
  assert.equal(CARDS.cutting.effect.kind, 'strike');
  assert.ok(CARDS.cutting.consumed, 'and it leaves the deck rather than clogging it');
});

test('the roster is full and every seat can be taken', () => {
  assert.equal(playableClasses().length, PARTY_SIZE, 'five seats, five classes');
  const room = roomFor(`full-${++codes}`);
  const taken = playableClasses().map((cls, i) => {
    const player = room.join(`full-token-${codes}-${i}`, fakeSocket());
    room.handle(player, { t: 'class', classId: cls.id });
    return player.classId;
  });
  assert.deepEqual(taken, playableClasses().map(c => c.id),
    'every live class should be claimable at one table');
  assert.equal(room.maxPlayers, PARTY_SIZE);
});

/* ---- hibernation ------------------------------------------------------- */

/* The deployed room is a Durable Object, so it is evicted whenever it goes
   quiet and rebuilt from `serialize()` when somebody comes back. Nothing on the
   dev server exercises that — rooms there live in a Map and are never written
   down — which makes this the one part of the room that can only break in
   production. Hence pinning it here, where it is cheap to notice. */

import { Room } from '../src/rooms.js';
import { POT_COUNT } from '../public/good-vibes/content.js';

// What a wake actually does: store, evict, rebuild, re-attach sockets.
const cycle = (room) => {
  const woken = Room.restore(JSON.parse(JSON.stringify(room.serialize())));
  for(const p of woken.players) p.socket = fakeSocket();
  return woken;
};

test('a room in a fight wakes up in the same fight', () => {
  const room = roomFor(`wake-${++codes}`);
  const seats = ['a', 'b'].map((who, i) => {
    const player = room.join(`wake-token-${codes}-${who}`, fakeSocket());
    room.handle(player, { t: 'class', classId: playableClasses()[i].id });
    return player;
  });
  room.handle(seats[0], { t: 'start' });
  for(const p of seats) room.handle(p, { t: 'ready', ready: true });

  const woken = cycle(room);

  assert.equal(woken.phase, room.phase, 'the phase survives');
  assert.equal(woken.round, room.round, 'and the round');
  assert.equal(woken.code, room.code);
  assert.deepEqual(woken.enemies, room.enemies,
    'every enemy, including its landed-hit count — the ailment cadence is state');
  assert.deepEqual(woken.terrain, room.terrain, 'and the ground they stand on');
  assert.deepEqual(
    woken.players.map(p => [p.id, p.classId, p.hp, p.hand, p.deck, p.discard]),
    room.players.map(p => [p.id, p.classId, p.hp, p.hand, p.deck, p.discard]),
    'and each seat, down to the cards it is holding');
});

test('a woken room deals the same cards the sleeping one would have', () => {
  const room = roomFor(`stream-${++codes}`);
  const player = room.join(`stream-token-${codes}`, fakeSocket());
  room.handle(player, { t: 'class', classId: 'wizard' });
  room.handle(player, { t: 'start' });

  /* The generator is a closure and cannot be stored, so `restore` replays it:
     same seed, same number of draws. If that count were dropped the party
     would quietly get a different game after every eviction — which is the
     kind of bug nobody reports, because nobody can see it happen. */
  const woken = cycle(room);
  assert.equal(woken.rngCalls, room.rngCalls, 'the draw count comes back');
  assert.equal(woken.seed, room.seed, 'and the seed it was drawing from');

  const before = Array.from({ length: 12 }, () => room.random());
  const after = Array.from({ length: 12 }, () => woken.random());
  assert.deepEqual(after, before, 'so the stream continues rather than forking');
});

test('a run that restarted does not wake up in the run before it', () => {
  const room = roomFor(`rerun-${++codes}`);
  const player = room.join(`rerun-token-${codes}`, fakeSocket());
  room.handle(player, { t: 'class', classId: 'wizard' });
  room.handle(player, { t: 'start' });
  const firstSite = JSON.stringify(room.site);

  room.phase = PHASES.over;
  room.handle(player, { t: 'restart' });
  room.handle(player, { t: 'start' });

  assert.ok(room.run > 0, 'a restart moves the run counter');
  const woken = cycle(room);
  assert.equal(woken.run, room.run, 'which is stored');
  assert.equal(JSON.stringify(woken.site), JSON.stringify(room.site),
    'so the second run wakes into the second ruin');
  assert.notEqual(JSON.stringify(woken.site), firstSite,
    'and not back into the first, which rebuilding from the code alone would do');
});

test('a stored room from before the scriptorium still wakes', () => {
  const room = roomFor(`old-${++codes}`);
  room.join(`old-token-${codes}`, fakeSocket());
  const stored = room.serialize();
  // Exactly what an object written by an older deploy looks like.
  delete stored.spellbook;
  delete stored.pots;
  delete stored.offers;

  const woken = Room.restore(stored);
  assert.ok(woken.spellbook, 'a missing spellbook is replaced, not inherited as undefined');
  assert.equal(woken.pots.length, POT_COUNT, 'and the garden comes back empty rather than absent');
  assert.equal(woken.offers, null);
});

test('ids are unique inside a room without a counter shared between rooms', () => {
  /* The counter used to be a module global, which a Durable Object does not
     have: each room is its own isolate, woken from storage, with no memory of
     any other. Per room is the only version that survives that. */
  const one = roomFor(`ids-a-${++codes}`);
  const two = roomFor(`ids-b-${codes}`);
  const seats = [
    one.join(`ids-${codes}-1`, fakeSocket()),
    one.join(`ids-${codes}-2`, fakeSocket()),
    two.join(`ids-${codes}-3`, fakeSocket()),
  ];
  assert.equal(new Set([seats[0].id, seats[1].id]).size, 2, 'unique within a room');
  assert.equal(seats[0].id, seats[2].id, 'and restarting the count in the next one is fine');

  const woken = cycle(one);
  woken.players = [];
  const fresh = woken.join(`ids-${codes}-4`, fakeSocket());
  assert.equal(new Set([seats[0].id, seats[1].id, fresh.id]).size, 3,
    'a woken room keeps counting from where it left off rather than reissuing p1');
});
