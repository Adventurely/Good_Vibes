/* Does a run come down to about a coin flip you are favoured to win?
 *
 * The target is 60%: often enough that a party expects to finish, rarely
 * enough that finishing is worth something. That number cannot be read off the
 * card table — it is four rounds of drawing, brewing, building and trading
 * blows, and every one of those interacts. So it is measured instead.
 *
 * This drives the real Room over the real protocol. Nothing here reimplements
 * a rule: the party sends intents, the room decides, and the only thing this
 * file contributes is a model of a player who is paying attention but not
 * solving the game. If that model is beaten by a change to the rules, the
 * change was to the rules.
 *
 *   node test/balance.mjs              every table size, 400 runs each
 *   node test/balance.mjs 1000         a tighter interval
 *
 * The dials it reports on are in public/good-vibes/content.js, and there are
 * fewer of them than there used to be. A wave is the same wave at every table
 * size now, so what moves the *height* of the curve is `WAVE_PATTERN` and the
 * `hp`/`hits` in `ENEMIES`, and what moves the *tilt* between table sizes is
 * `HP_PER_PLAYER` alone. Turn the height first; the tilt only means anything
 * once the line is at the right level.
 *
 * The round losses tell you where to look: round three losing 60% of the runs
 * that reach it is that round's wave, not the boss's.
 */

import { roomFor } from '../src/rooms.js';
import {
  PHASES, BOSS_ROUND, CARDS, cardEffect, actionReady, playableClasses,
  RECIPES, BUILDINGS, canAfford, pathTo, hasEffect,
  effectAmount, MODIFIERS, SPELL_SLOTS, classById, nodeYield,
  ABILITIES, placeRefusal, worksFrom, missingForBuilding,
} from '../public/good-vibes/content.js';

const RUNS = Number(process.argv[2]) || 400;

/* A socket that goes nowhere. The room sends a view per player per broadcast
   and the harness reads the room directly, so the wire is not the thing under
   test here. */
const deaf = () => ({ open: true, send(){} });

/* ------------------------------------------------------------ the player --- */

/* The build phase, played the way somebody paying attention plays it: pick up
 * everything you can walk to, then spend it.
 *
 * There is no move budget, so "walk to all of it" is not a clever strategy —
 * it is what the phase asks for. What the model does *not* do is plan across
 * rounds: it brews and builds greedily in a fixed order rather than saving for
 * the boss, which is the honest floor for how well a table plays.
 */
function playBuild(room){
  const seated = room.players.filter(p => p.classId);

  // Gather, round-robin, until nothing reachable is left. Round-robin rather
  // than one player sweeping, because a node pays what the seat standing on it
  // is worth there and a real table routes the right person to the right find.
  for(let pass = 0; pass < 40; pass++){
    let took = false;
    for(const player of seated){
      const cls = classById(player.classId);
      // A seat the stat prices at nothing leaves the node standing, so the
      // model does not waste passes walking to one it cannot take. Among what
      // it can take, richest first and nearest to break the tie: that is the
      // Alchemist onto herbs and the Engineer onto caches without either being
      // named here, which is the point of pricing by stat rather than by owner.
      const wants = room.nodes.filter(n => !n.taken && nodeYield(cls, n) > 0);
      const ordered = [...wants].sort((a, b) => {
        if(nodeYield(cls, a) !== nodeYield(cls, b)) return nodeYield(cls, b) - nodeYield(cls, a);
        return (Math.abs(a.x - player.x) + Math.abs(a.y - player.y))
             - (Math.abs(b.x - player.x) + Math.abs(b.y - player.y));
      });
      const node = ordered.find(n =>
        pathTo(room.terrain, room.buildings, { x: player.x, y: player.y }, { x: n.x, y: n.y }));
      if(!node) continue;
      room.intent(player, { t: 'gather', node: node.id });
      took = true;
    }
    if(!took) break;
  }

  /* The works, played the way the fork asks to be played.
   *
   * Screws buy both halves of his combat and there is never enough for both:
   * panels are the power to fire an ability, a line is what the ability is
   * worth. So the model builds a small array first — nothing can be fired
   * without one — then drives a single line as deep as it will go, because
   * DRAW rewards depth over breadth and three tiers of one beats one tier of
   * three. Chips go on the ability that draws whatever is standing.
   *
   * The Bolt Gun comes first of all. It is the only ability that needs no
   * building, so it is the only thing a round-one Engineer can actually fire.
   */
  const engineer = seated.find(p => p.classId === 'engineer');
  if(engineer){
    const cls = { build: true };
    const standing = id => room.buildings.some(b => b.id === id);

    const learn = id => {
      if(room.abilities.includes(id)) return;
      room.learn(engineer, cls, { ability: id });
    };
    const raise = id => {
      if(Object.keys(missingForBuilding(id, room.salvage)).length) return false;
      const spot = spotFor(room, id);
      if(!spot) return false;
      const before = room.buildings.length;
      room.place(engineer, cls, { building: id, x: spot.x, y: spot.y });
      return room.buildings.length > before;
    };

    learn('boltgun');

    // Enough array to fire something, then the line, then back to the array
    // with whatever is left. Six passes, because a good round can afford more
    // than one thing and a bad one should stop asking.
    const line = ['heliostat', 'mirrorfield', 'furnace'];
    for(let i = 0; i < 8; i++){
      const panels = room.buildings.filter(b => b.id === 'panel').length;
      const next = panels < 2 ? 'panel'
        : line.find(id => !standing(id)) || 'panel';
      if(!raise(next)) break;
    }

    // What the standing lines can draw, cheapest first, and the community
    // machines with whatever coil turned up.
    for(const id of ['sunlance', 'closeranks', 'allhands', 'holdcharge']) learn(id);
    for(const id of ['press', 'glasshouse', 'barrow', 'windrow']) raise(id);
  }

  // The scriptorium: pages are crafting currency now, so spend every one.
  // Picks by rarity (a spell counts between uncommon and rare), then sockets
  // greedily — additive damage in front of multipliers, because the model
  // should at least know which order the arithmetic runs in.
  const wizard = seated.find(p => p.classId === 'wizard');
  if(wizard){
    const cls = { cast: true };
    const rank = { rare: 3, uncommon: 2, common: 1 };
    for(let i = 0; i < 12 && room.pages >= 1; i++){
      room.openPage(wizard, cls);
      if(!room.offers) break;
      const pick = room.offers
        .map((offer, index) => ({
          index,
          score: offer.type === 'spell' ? 2.5 : rank[MODIFIERS[offer.id].rarity] || 1,
        }))
        .sort((a, b) => b.score - a.score)[0];
      room.pickOffer(wizard, cls, { index: pick.index });
    }
    for(let i = 0; i < 12; i++){
      const satchel = room.spellbook.satchel;
      if(!satchel.length) break;
      const mod = satchel[0];
      const op = MODIFIERS[mod].op || {};
      const spellId = (room.spellbook.known || [])
        .find(s => ((room.spellbook.slots || {})[s] || []).length < SPELL_SLOTS);
      if(!spellId) break;
      const before = JSON.stringify(room.spellbook);
      room.moveMod(wizard, cls, { mod, spell: spellId, pos: op.amount ? 0 : SPELL_SLOTS });
      if(JSON.stringify(room.spellbook) === before) break;   // refused; stop asking
    }
  }

  // The garden, then the brewing it feeds. Harvest what has grown — all of it
  // on the boss round, the mature earlier — and plant surplus while there are
  // rounds left for a cutting to pay.
  const alchemist = seated.find(p => p.classId === 'alchemist');
  if(alchemist){
    const cls = { craft: true };
    (room.pots || []).forEach((pot, index) => {
      if(pot && (room.round >= BOSS_ROUND || pot.age >= 2)) room.harvest(alchemist, cls, { pot: index });
    });
    if(room.round < BOSS_ROUND){
      (room.pots || []).forEach((pot, index) => {
        if(pot) return;
        const surplus = Object.entries(room.stash)
          .filter(([, n]) => n > 1)
          .sort((a, b) => b[1] - a[1])[0];
        if(surplus) room.plant(alchemist, cls, { pot: index, herb: surplus[0] });
      });
    }
    // Brew everything affordable, cheapest first, so one expensive recipe
    // cannot eat a stash that would have made two cards.
    for(let i = 0; i < 12; i++){
      const id = Object.keys(RECIPES)
        .filter(r => canAfford(RECIPES[r].costs, room.stash))
        .sort((a, b) => cost(RECIPES[a].costs) - cost(RECIPES[b].costs))[0];
      if(!id) break;
      room.brew(alchemist, cls, { recipe: id });
    }
  }

  for(const player of seated) room.setReady(player, true);
}

const cost = costs => Object.values(costs).reduce((a, b) => a + b, 0);

/* The first tile this building may legally stand on, or null.
 *
 * `freeTile` was enough when the only rule was "somewhere clear". It is not
 * any more: a Living Wall has to touch its Trellis, a Cistern has to touch
 * water, and a Carillon belongs at the camp. So the model scans for a tile the
 * shared rule accepts rather than picking the first clear one and being
 * refused — which would have looked like an Engineer who never built anything.
 *
 * Panels prefer a tile beside another panel, because that is the difference
 * between an array worth N and one worth 2N, and a model that scattered them
 * would under-rate the whole line.
 */
function spotFor(room, id){
  const ok = (x, y) => placeRefusal(id, {
    terrain: room.terrain, buildings: room.buildings, nodes: room.nodes, x, y,
  }) === null;

  if(id === 'panel'){
    for(const panel of room.buildings.filter(b => b.id === 'panel')){
      for(const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
        if(ok(panel.x + dx, panel.y + dy)) return { x: panel.x + dx, y: panel.y + dy };
      }
    }
  }
  for(let y = 0; y < 17; y++){
    for(let x = 0; x < 30; x++) if(ok(x, y)) return { x, y };
  }
  return null;
}

function freeTile(room){
  for(let y = 0; y < 17; y++){
    for(let x = 0; x < 30; x++){
      if(room.buildings.some(b => b.x === x && b.y === y)) continue;
      if(room.nodes.some(n => n.x === x && n.y === y && !n.taken)) continue;
      const kind = room.terrain[y * 30 + x];
      if(kind === 'grass' || kind === 'floor' || kind === 'camp') return { x, y };
    }
  }
  return null;
}

/* ------------------------------------------------------------ the fight --- */

/* One player's turn, as somebody who reads the board and does the obvious
 * thing. In rough priority: pick up a downed ally, stop yourself dying, clear
 * an ailment that is killing somebody, then hit the thing you can kill.
 *
 * Deliberately not optimal. It does not hold a Cinder Nova for a full lane or
 * chain an Ember Rune into a Bolt Gun, both of which a real table learns to do —
 * so a win rate measured here is a floor, and the 60% target is set against
 * players who are worse than the people who will eventually play this.
 */
function pickCard(room, player){
  /* Everything this seat could do, filtered to what it can afford right now.
   *
   * It used to read a hand of three. There is no hand: a seat's options are a
   * fixed list and what varies is which of them its pools can pay for, so the
   * model chooses from everything and `actionReady` does the filtering — the
   * same function the room and the client both call, so a play this model
   * thinks is legal is one the room will accept.
   *
   * Two seats always have something: a basic swing and a basic guard cost
   * nothing, so `hand` is never empty and the model never idles through a
   * round it could have acted in. */
  const hand = room.actionIds(player)
    .map((id) => {
      const spell = room.spellFor(player, id);
      return { id, card: CARDS[id], effect: spell ? spell.effect : cardEffect(id, room.works), spell };
    })
    .filter(c => (c.card || c.spell) && actionReady(c.id, room.seatState(player), c.spell).ok);
  if(!hand.length) return null;

  const alive = room.enemies.filter(e => e.hp > 0);
  // Everything alive is here: a standoff has no far side.
  const here = alive;
  const party = room.players.filter(p => p.classId);
  const standing = party.filter(p => !p.down);
  const down = party.filter(p => p.down);
  const incoming = here.reduce((sum, e) => sum + e.hits, 0) / Math.max(1, standing.length);
  const hurt = [...standing].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];

  const find = kind => hand.find(c => c.effect.kind === kind);
  const damage = c => (c.effect.kind === 'strike' ? c.effect.amount
    : c.effect.kind === 'strikeAll' ? c.effect.amount * Math.max(1, alive.length) : 0);
  const best = [...hand].sort((a, b) => damage(b) - damage(a))[0];

  // Somebody is on the floor and this is the only card in the game that fixes
  // that. Always worth more than a swing.
  if(down.length && find('revive')) return aim(find('revive'), down[0].id);

  // About to die: guard, mend, or both.
  if(player.hp <= incoming + 2){
    const heal = find('heal') || find('healAll');
    if(heal && player.hp / player.maxHp < 0.45) return aim(heal, player.id);
    const ward = find('ward') || find('wardAll');
    if(ward) return aim(ward, player.id);
  }

  // Rot is the ailment worth a card: it keeps taking after the thing that gave
  // it to you is dead.
  const rotting = standing.find(p => hasEffect(p.effects, 'rot'));
  if(rotting && find('cleanse')) return aim(find('cleanse'), rotting.id);

  // Somebody else is nearly out and this hand can reach them.
  if(hurt && hurt.hp / hurt.maxHp < 0.35){
    const heal = hand.find(c => c.effect.kind === 'healAll')
      || hand.find(c => c.effect.kind === 'heal' && (c.card.targetsAlly || c.id === hurt.id));
    if(heal) return aim(heal, hurt.id);
  }

  // Guard against a full lane rather than trading with it.
  if(here.length >= 2 && incoming >= 4){
    const ward = find('wardAll') || find('ward');
    // Half the time, decided off the board rather than off a coin: this file
    // has to give the same answer twice or a tuning pass is measuring noise.
    if(ward && ((room.round + alive.length + player.hp) & 1) === 0) return aim(ward, player.id);
  }

  // Lend a page to whoever hits hardest, once, and only while the fight has
  // enough left in it to spend the round.
  const might = find('might');
  if(might && standing.length > 1 && alive.length && totalHp(alive) > 14){
    const ally = standing.find(p => p.id !== player.id && !hasEffect(p.effects, 'might'));
    if(ally) return aim(might, ally.id);
  }

  /* Seats four and five, whose whole kits score zero on `damage` above and
     would otherwise only ever be played as the unaimed fallback at the foot of
     this function. Each of these is the obvious line rather than the best one,
     which is the standard the rest of the model is written to. */

  // Canker is the only damage that pays for being early, so it goes on the
  // biggest thing that has not got a ring in it yet.
  const canker = find('canker');
  if(canker){
    const fresh = [...alive].filter(e => !e.canker).sort((a, b) => b.hp - a.hp)[0];
    if(fresh) return aim(canker, fresh.id);
  }
  const cankerAll = find('cankerAll');
  if(cankerAll && alive.filter(e => !e.canker).length >= 2) return aim(cankerAll, null);

  // Cover when the lane outnumbers the party, which is when a redirect buys
  // more than a ward on one head.
  const cover = find('cover');
  if(cover && here.length > standing.length) return aim(cover, player.id);

  // Heft is bought early or not at all — it pays back over the rounds left —
  // and never with health the fight is about to need.
  const heft = find('heft');
  if(heft && player.hp / player.maxHp > 0.55 && totalHp(alive) > 20){
    const card = CARDS[heft.id];
    if(card.targetsAlly){
      // Onto whoever swings, never onto the Grafter: heft is a strike term and
      // canker is not a strike.
      const arm = standing.find(p => p.id !== player.id && p.classId !== 'grafter');
      if(arm) return aim(heft, arm.id);
    }else{
      return aim(heft, player.id);
    }
  }

  // A cutting is worth most in the arm carrying the most already.
  const graft = find('graft');
  if(graft && standing.length > 1){
    const arm = [...standing]
      .filter(p => p.id !== player.id && p.classId !== 'grafter')
      .sort((a, b) => (effectAmount(b.effects, 'heft') + effectAmount(b.effects, 'might'))
                    - (effectAmount(a.effects, 'heft') + effectAmount(a.effects, 'might')))[0];
    if(arm) return aim(graft, arm.id);
  }

  if(damage(best) > 0){
    // Finish something if this card can; otherwise hit what arrives first.
    const killable = alive.filter(e => e.hp <= best.effect.amount)
      .sort((a, b) => b.hp - a.hp)[0];
    return aim(best, (killable || alive[0] || {}).id || null);
  }
  return aim(best, player.id);
}

const totalHp = list => list.reduce((sum, e) => sum + e.hp, 0);
const aim = (choice, target) =>
  ({ t: 'action', id: choice.id, target });

/* ------------------------------------------------------------- a whole run --- */

function playRun(code, size, spin = 0){
  const room = roomFor(code);
  /* Which seats, not just how many.
   *
   * This used to take the first N classes in roster order, which meant every
   * three-player number was the Alchemist, the Engineer and the Wizard, and
   * every two-player number was the two of them without her — and she is the
   * party's damage by design. So the win rate by table size was largely a
   * measurement of who happened to be sitting at it: two read hardest and
   * three easiest at every setting, however the dials moved.
   *
   * Rotating the roster by the run index averages each size over every
   * composition instead. Still deterministic — the spin is the run number, not
   * a roll — so a re-run reproduces the same set of tables.
   */
  const roster = playableClasses();
  const classes = Array.from({ length: size },
    (unused, i) => roster[(spin + i) % roster.length]);
  for(const cls of classes){
    const player = room.join(`${code}:${cls.id}`, deaf());
    room.pickClass(player, cls.id);
  }
  room.startRun(room.players[0]);
  if(room.phase === PHASES.lobby) return { outcome: 'lobby', round: 0 };

  let guard = 0;
  while(room.phase !== PHASES.over && guard++ < 400){
    if(room.phase === PHASES.build){ playBuild(room); continue; }

    const acting = room.players.filter(p => p.classId && !p.down);
    if(!acting.length) break;
    for(const player of acting){
      if(room.phase !== PHASES.combat) break;
      const choice = pickCard(room, player);
      room.commit(player, choice || { t: 'wait' });
    }
  }
  return {
    outcome: room.outcome || 'stalled',
    round: Math.min(room.round, BOSS_ROUND),
    stats: room.players.filter(p => p.classId).map(p => ({ classId: p.classId, ...p.stats })),
  };
}

/* ------------------------------------------------------------------ report --- */

const sizes = (process.argv[3] || '1,2,3,4,5').split(',').map(Number);
console.log(`Good Vibes balance — ${RUNS} runs per table size, target 60% wins\n`);

let worst = 0;
for(const size of sizes){
  let wins = 0;
  const lostOn = {};
  const byClass = {};
  for(let i = 0; i < RUNS; i++){
    const { outcome, round, stats } = playRun(`BAL${size}X${i}`, size, i);
    if(outcome === 'won') wins += 1;
    else lostOn[round] = (lostOn[round] || 0) + 1;
    for(const row of stats){
      const bucket = byClass[row.classId] || (byClass[row.classId] = { damage: 0, taken: 0, mended: 0, guard: 0 });
      bucket.damage += row.damage || 0;
      bucket.taken += row.taken || 0;
      bucket.mended += row.mended || 0;
      bucket.guard += row.guard || 0;
    }
  }
  const rate = wins / RUNS;
  worst = Math.max(worst, Math.abs(rate - 0.6));
  const breakdown = Object.entries(lostOn)
    .sort(([a], [b]) => a - b)
    .map(([round, n]) => `r${round}: ${n}`)
    .join('  ');
  console.log(
    `${size} player${size > 1 ? 's' : ''}  ${(rate * 100).toFixed(1).padStart(5)}%  ` +
    `${'#'.repeat(Math.round(rate * 40)).padEnd(40)} ${breakdown}`,
  );
  // Who is carrying it, as per-run means — the composition question behind
  // every table-size number.
  for(const [classId, s] of Object.entries(byClass)){
    console.log(`    ${classId.padEnd(10)} dmg ${(s.damage / RUNS).toFixed(1).padStart(6)}  ` +
      `taken ${(s.taken / RUNS).toFixed(1).padStart(5)}  mended ${(s.mended / RUNS).toFixed(1).padStart(5)}  ` +
      `guard ${(s.guard / RUNS).toFixed(1).padStart(5)}`);
  }
}

console.log(`\nfurthest any table size sits from the target: ${(worst * 100).toFixed(1)} points`);
