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
import { createAudio } from '../public/audio.js';
import { fxStyles, styleFor, soundFor, FX_SOUND } from '../public/fx.js';
import {
  CARDS, EFFECT_KINDS, PHASES, BOSS_ROUND, classById, cardEffect,
} from '../public/content.js';

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

/* A room with one seated player, parked in a fight, holding exactly the card
   the test wants to play. Setting the hand rather than dealing is deliberate:
   a shuffle is not what any of these tests are about. */
function fightWith(cardId, classId = 'wizard'){
  const room = roomFor(`fx-${++codes}`);
  const socket = fakeSocket();
  const player = room.join(`token-${codes}`, socket);
  room.handle(player, { t: 'class', classId });
  room.handle(player, { t: 'start' });
  assert.equal(room.phase, PHASES.build, 'the run should open in the build phase');

  room.handle(player, { t: 'ready', ready: true });
  assert.equal(room.phase, PHASES.combat, 'one ready player is the whole party here');

  player.hand = [cardId, 'hold', 'hold'];
  // Pages and power are what a costed card needs; give it enough that these
  // tests are about the effect and not about affording it.
  room.pages = 5;
  room.power = 5;
  socket.sent.length = 0;                 // everything before the turn under test
  return { room, player, socket };
}

/* Every card that hits, from the fist to the bolt gun. */
const strikeCards = Object.entries(CARDS)
  .filter(([, card]) => card.effect.kind === 'strike')
  .map(([id]) => id);

test('every strike card resolves the way the Strike action did', () => {
  assert.ok(strikeCards.includes('strike'), 'Strike itself must be one of them');

  for(const id of strikeCards){
    const card = CARDS[id];
    const { room, player, socket } = fightWith(id, card.classId || 'wizard');

    const target = room.enemies[0];
    const before = target.hp;
    room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: id, target: target.id } });

    const fx = fxIn(socket).find(e => e.kind === id);
    assert.ok(fx, `"${id}" resolved without an fx event, so it is silent and invisible`);
    assert.equal(fx.player, player.id);
    assert.equal(fx.target, target.id, `"${id}" must say which enemy it hit`);
    assert.equal(target.hp, Math.max(0, before - cardEffect(id, room.upgrades).amount),
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
  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'strike', target: target.id } });

  const order = eventsOn(socket).map(e => (e.t === 'fx' ? `fx:${e.kind}` : e.t));
  const fxAt = order.indexOf('fx:strike');
  const logAt = order.indexOf('log');
  assert.ok(fxAt >= 0 && logAt >= 0, 'the turn should both animate and narrate');
  assert.ok(fxAt < logAt, 'the fx must be emitted before the hit it depicts is reported');
});

test('being hit is its own effect, on the victim', () => {
  const { room, player, socket } = fightWith('hold', 'engineer');
  // Walk the wave into contact so somebody actually gets hit this turn.
  for(const enemy of room.enemies) enemy.dist = 0;
  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'hold' } });

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
