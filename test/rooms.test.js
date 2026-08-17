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
import { createAudio, SONGS } from '../public/audio.js';
import { fxStyles, styleFor, soundFor, FX_SOUND } from '../public/fx.js';
import {
  CARDS, EFFECT_KINDS, PHASES, BOSS_ROUND, classById, cardEffect,
  AILMENTS, addAilment, hasEffect, effectName, waveFor, enemyStats, ENEMIES,
  runHighlights, STAT_KEYS, blankStats,
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
                    hp: 20, maxHp: 20, dist: 0, hits: 2, landed: 0 }];

  player.hand = ['strike', 'hold', 'hold'];
  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'strike' } });
  assert.equal(hasEffect(player.effects, 'rot'), false,
    'a Sporeling rots on its second landed hit, not its first');

  player.hand = ['strike', 'hold', 'hold'];
  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'strike' } });
  assert.ok(hasEffect(player.effects, 'rot'), 'the second landed hit should rot');

  // Guard that swallows the blow whole leaves nothing behind. That is the
  // trade the ward is for, and it is easy to lose in a refactor.
  const before = player.effects.length;
  player.hand = ['strike', 'hold', 'hold'];
  player.block = 99;
  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'strike' } });
  assert.equal(player.effects.length, before,
    'a fully blocked hit must not land an ailment');
});

test('blightrot keeps taking, then stops', () => {
  const { room, player } = fightWith('hold', 'engineer');
  room.enemies = [{ id: 'e0', type: 'creeper', name: 'Creeper', art: 'creeper',
                    hp: 99, maxHp: 99, dist: 9, hits: 3, landed: 0 }];   // out of reach
  player.effects = addAilment([], 'rot');
  const rounds = AILMENTS.rot.rounds;
  const damage = AILMENTS.rot.amount;

  let hp = player.hp;
  for(let turn = 0; turn < rounds; turn++){
    player.hand = ['hold', 'hold', 'hold'];
    room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'hold' } });
    assert.equal(player.hp, hp - damage, `rot should bite on turn ${turn + 1}`);
    hp = player.hp;
  }
  assert.equal(hasEffect(player.effects, 'rot'), false, `rot should be gone after ${rounds} turns`);

  player.hand = ['hold', 'hold', 'hold'];
  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'hold' } });
  assert.equal(player.hp, hp, 'an expired ailment must stop costing health');
});

test('stun costs the turn and weakness costs the swing', () => {
  const { room, player } = fightWith('strike', 'engineer');
  const target = room.enemies[0];
  target.hp = 99;
  target.dist = 9;                                  // nothing lands back this turn

  const stunned = target.hp;
  player.effects = addAilment([], 'stun');
  player.hand = ['strike', 'hold', 'hold'];
  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'strike', target: target.id } });
  assert.equal(target.hp, stunned, 'a stunned player deals no damage');
  assert.equal(hasEffect(player.effects, 'stun'), false, 'a one-round stun lasts one round');

  const before = target.hp;
  player.effects = addAilment([], 'weak');
  player.hand = ['strike', 'hold', 'hold'];
  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'strike', target: target.id } });
  const dealt = before - target.hp;
  assert.equal(dealt, CARDS.strike.effect.amount - AILMENTS.weak.amount,
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

  for(const enemy of room.enemies) enemy.dist = 9;   // nothing hits back this turn
  for(const p of seats) p.hp = 10;
  room.pages = 5;
  room.power = 5;

  seats[0].hand = ['vapours', 'hold', 'hold'];
  seats[1].hand = ['bulwark', 'hold', 'hold'];
  seats[2].hand = ['channel', 'hold', 'hold'];
  room.handle(seats[0], { t: 'intent', intent: { t: 'play', index: 0, card: 'vapours' } });
  room.handle(seats[1], { t: 'intent', intent: { t: 'play', index: 0, card: 'bulwark' } });
  room.handle(seats[2], { t: 'intent', intent: { t: 'play', index: 0, card: 'channel', target: seats[1].id } });

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
  for(const enemy of room.enemies) enemy.dist = 9;
  player.effects = [
    ...addAilment([], 'rot'),
    { kind: 'might', amount: 4, rounds: 3 },
  ];
  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'censer', target: player.id } });
  assert.equal(hasEffect(player.effects, 'rot'), false, 'the censer should clear the rot');
  assert.ok(hasEffect(player.effects, 'might'), 'and leave what the party put there');
});

test('jumper cables pick an ally up, and are not a dead card alone', () => {
  const room = roomFor(`revive-${++codes}`);
  const seats = ['engineer', 'alchemist'].map((classId, i) => {
    const player = room.join(`revive-token-${codes}-${i}`, fakeSocket());
    room.handle(player, { t: 'class', classId });
    return player;
  });
  room.handle(seats[0], { t: 'start' });
  for(const p of seats) room.handle(p, { t: 'ready', ready: true });
  for(const enemy of room.enemies) enemy.dist = 9;

  seats[1].down = true;
  seats[1].hp = 0;
  seats[0].hand = ['jumper', 'hold', 'hold'];
  room.handle(seats[0], { t: 'intent', intent: { t: 'play', index: 0, card: 'jumper', target: seats[1].id } });
  assert.equal(seats[1].down, false, 'the downed ally should be back up');
  assert.ok(seats[1].hp > 0);
  assert.ok(seats[1].hand.length, 'and holding cards to play with');

  // Nobody down: it mends instead of doing nothing at all.
  const hurt = seats[1].hp = 4;
  seats[0].hand = ['jumper', 'hold', 'hold'];
  seats[1].hand = ['hold', 'hold', 'hold'];
  room.handle(seats[0], { t: 'intent', intent: { t: 'play', index: 0, card: 'jumper' } });
  room.handle(seats[1], { t: 'intent', intent: { t: 'play', index: 0, card: 'hold' } });
  assert.ok(seats[1].hp > hurt, 'with nobody down it should still be worth playing');
});

/* ---- the death the client holds the round open for ---------------------- */

test('a kill is announced, and the last kill of a round says so', () => {
  const { room, player, socket } = fightWith('strike', 'engineer');
  // Two enemies, both one hit from dead, so the first kill is not the last.
  room.enemies = [
    { id: 'e0', type: 'sporeling', name: 'Sporeling', art: 'sporeling', hp: 1, maxHp: 6, dist: 9, hits: 2, landed: 0 },
    { id: 'e1', type: 'sporeling', name: 'Sporeling', art: 'sporeling', hp: 1, maxHp: 6, dist: 9, hits: 2, landed: 0 },
  ];

  player.hand = ['strike', 'hold', 'hold'];
  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'strike', target: 'e0' } });
  const first = fxIn(socket).find(e => e.kind === 'slain');
  assert.ok(first, 'a kill has to reach the client or it cannot be animated');
  assert.equal(first.target, 'e0');
  assert.equal(first.last, false, 'one of two is not the end of the round');

  socket.sent.length = 0;
  player.hand = ['strike', 'hold', 'hold'];
  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'strike', target: 'e1' } });
  const last = fxIn(socket).find(e => e.kind === 'slain');
  assert.ok(last && last.last, 'the kill that empties the lane is the one the round holds open for');
});

test('a nova kills the whole lane and only the last one ends the round', () => {
  const { room, player, socket } = fightWith('nova', 'wizard');
  room.enemies = room.enemies.map((e, i) =>
    ({ ...e, hp: 1, dist: i, landed: 0 }));
  const count = room.enemies.length;

  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'nova' } });
  const slain = eventsOn(socket).filter(e => e.t === 'fx' && e.kind === 'slain');
  assert.equal(slain.length, count, 'every enemy it killed should be seen dying');
  assert.equal(slain.filter(e => e.last).length, 1, 'exactly one of them ends the round');
  assert.equal(slain[slain.length - 1].last, true, 'and it is the last one');
});

/* ---- levelling ---------------------------------------------------------- */

test('a bigger table meets a bigger fight', () => {
  // Not merely more of them: the budget promotes what it cannot fit more of,
  // so the wave gets worse as well as longer.
  let lastThreat = 0;
  for(let size = 1; size <= 5; size++){
    const threat = waveFor(1, size).reduce((sum, t) => sum + ENEMIES[t].threat, 0);
    assert.ok(threat > lastThreat, `a table of ${size} should meet more than a table of ${size - 1}`);
    lastThreat = threat;
  }

  // And the boss, which is always exactly one thing, scales in place instead.
  const solo = enemyStats('extractor', 1);
  const full = enemyStats('extractor', 5);
  assert.ok(full.hp > solo.hp * 2, 'the Extractor has to grow with the party');
  assert.ok(full.hits > solo.hits, 'including what it swings for');
  assert.deepEqual(enemyStats('sporeling', 5), enemyStats('sporeling', 1),
    'everything else is levelled by the wave table, and must not be scaled twice');
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
  for(const enemy of room.enemies){ enemy.dist = 0; enemy.hits = 99; }

  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'hold' } });

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
  target.dist = 9;
  target.hp = 99;

  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'strike', target: target.id } });
  assert.equal(player.stats.damage, CARDS.strike.effect.amount, 'a swing should be counted');

  player.hand = ['hold', 'hold', 'hold'];
  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'hold' } });
  assert.equal(player.stats.guard, CARDS.hold.effect.amount, 'so should guard');

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
  target.dist = 9;
  target.hp = 2;

  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'fireball', target: target.id } });
  assert.equal(player.stats.damage, 2, 'only what actually landed counts');
  assert.equal(player.stats.kills, 1);
});

test('another run keeps the crew and changes the ruin', () => {
  const { room, player } = fightWith('hold', 'wizard');
  for(const enemy of room.enemies){ enemy.dist = 0; enemy.hits = 99; }
  room.handle(player, { t: 'intent', intent: { t: 'play', index: 0, card: 'hold' } });
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
