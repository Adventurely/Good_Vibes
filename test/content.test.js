import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PALETTE, HERO_ART, MATERIAL_ART, TERRAIN_ART, TERRAIN_VARIANTS, BUILDING_ART,
  SALVAGE_ART, ENEMY_ART, PAGES_ART, CARD_ART, TILE, PROP_ART, TREE_ART, FIRE_ART,
} from '../public/good-vibes/art.js';
import {
  PARTY_SIZE, CLASSES, OPEN_ROLES, MATERIALS, RECIPES,
  CLASS_BASICS, CLASS_ACTIONS, actionsFor, actionCost, actionReady, actionRemaining,
  freshStock, freshUses, CHARGE_CAP, CHARGE_REGEN,
  ROUNDS, ROUNDS_BEFORE_BOSS, BOSS_ROUND, roundInfo, phaseCard,
  ENEMIES, waveFor, SPAWNS, CACHE_YIELD, PAGES, spawnItems,
  classById, playableClasses, missingFor, materialFor,
  MAP_W, MAP_H, TERRAIN, HERB_COUNT, PHASES, isBuildPhase, readyState,
  seededRandom, seedFromCode, generateTerrain, spawnHerbs, generateMap,
  spawnTile, tileAt, inBounds, BASE_ROOM, largestBuildableArea, isWater, shoreline,
  SALVAGE, salvageFor, BUILDINGS, STARTING_SALVAGE, COMBAT_ACTIONS,
  BASE_ACTIONS, EFFECT_KINDS, missingForBuilding, canAfford,
  affordableBuildings, canBuildAt, salvageAfterCombat, addSalvage, spendSalvage,
  HAND_SIZE, CARDS, STARTING_DECKS, buildDeck, shuffle, draw, discardHand, cardById,
  UNIVERSAL_CARDS, deckFor, cardPlayable, COMBAT_H, generateCombatTerrain,
  UPGRADES, upgradeCost, buyUpgrade, cardEffect, powerFrom, canBuildMore, buildingsOf,
  brew, pathTo, walkableAt, respawnItems, combatOptions, LEVELS,
  CAMP_X, CAMP_Y, CAMP_RADIUS, TENT_Y, inCamp,
  STAT_KEYS, STAT_LABELS, STAT_SHORT, blankStats, runHighlights,
  SPELLS, MODIFIERS, MODIFIER_WEIGHTS, SPELL_SLOTS, PAGES_PER_ROUND,
  WIZARD_BASE_KIT, CLASS_KITS, classKit, freshSpellbook, composeSpell,
  rollOffers, takeOffer, moveModifier, wizardCombatDeck, ownedModifiers, draftableCount,
  POT_COUNT, potYield, potStage, plantPot, harvestPot, growPots,
  worksFrom, grantsFrom, placeRefusal, canPlace, NEIGHBOURS,
  moveRefusal, canMove, strandedIn,
  DRAW, ABILITIES, ABILITY_IDS, abilityRefusal,
} from '../public/good-vibes/content.js';

/* content.js is imported by the authoritative room object as well as the browser, not
 * only by this page. A class with a missing field or an art key that does not
 * exist would reach the server, and the first anyone heard of it would be a
 * run failing at the table.
 *
 * The publish workflow runs these before syncing anything, so this file is the
 * gate: it is the reason a malformed class cannot leave this repository.
 */

test('every class carries the fields the engine reads', () => {
  for (const cls of CLASSES) {
    const where = `class "${cls.id}"`;
    assert.match(cls.id, /^[a-z][a-z0-9-]*$/, `${where}: id must be kebab-case`);
    for (const field of ['name', 'archetype', 'blurb', 'downLine', 'art']) {
      assert.equal(typeof cls[field], 'string', `${where}: ${field} must be a string`);
      assert.ok(cls[field].length, `${where}: ${field} must not be empty`);
    }
    assert.ok(['live', 'draft'].includes(cls.status), `${where}: status must be live or draft`);
    assert.ok(Number.isInteger(cls.hp) && cls.hp > 0, `${where}: hp must be a positive integer`);
    assert.match(cls.colour, /^#[0-9a-f]{6}$/i, `${where}: colour must be a hex value`);
    assert.ok(Number.isInteger(cls.gather) && cls.gather > 0, `${where}: gather must be a positive integer`);
    assert.equal(typeof cls.craft, 'boolean', `${where}: craft must be a boolean`);
    assert.equal(typeof cls.build, 'boolean', `${where}: build must be a boolean`);
    assert.ok(Number.isInteger(cls.salvage) && cls.salvage >= 0,
      `${where}: salvage must be a non-negative integer`);
  }
});

test('the two built classes do different jobs', () => {
  // Two classes that both gather and both brew would be one class with two
  // sprites. The split is the design: herbs and potions against salvage and
  // structures.
  const builders = playableClasses().filter((c) => c.build);
  const brewers = playableClasses().filter((c) => c.craft);
  assert.ok(builders.length, 'nobody can build');
  assert.ok(brewers.length, 'nobody can brew');
  for (const cls of builders) {
    assert.ok(!cls.craft, `"${cls.id}" both builds and brews`);
    assert.ok(cls.salvage > 0, `"${cls.id}" builds but cannot pay for anything`);
  }
  for (const cls of brewers) assert.ok(!cls.build, `"${cls.id}" both brews and builds`);
});

test('class ids are unique', () => {
  const ids = CLASSES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate class id in ${ids.join(', ')}`);
});

test('every live class has a sprite to draw', () => {
  for (const cls of playableClasses()) {
    assert.ok(HERO_ART[cls.art], `class "${cls.id}" has no art key "${cls.art}"`);
  }
});

test('the roster and the open roles account for the whole party', () => {
  assert.equal(
    CLASSES.length + OPEN_ROLES.length,
    PARTY_SIZE,
    'every seat must be either a class or a declared open role',
  );
});

test('every recipe is makeable and deals a card that exists', () => {
  for (const [id, recipe] of Object.entries(RECIPES)) {
    assert.equal(typeof recipe.name, 'string', `recipe "${id}" needs a name`);
    assert.ok(Object.keys(recipe.costs).length, `recipe "${id}" costs nothing`);
    for (const [material, amount] of Object.entries(recipe.costs)) {
      assert.ok(MATERIALS[material], `recipe "${id}" needs unknown material "${material}"`);
      assert.ok(Number.isInteger(amount) && amount > 0, `recipe "${id}": bad amount for ${material}`);
    }
    assert.ok(Number.isInteger(recipe.makes) && recipe.makes > 0,
      `recipe "${id}" brews no cards, so it does nothing`);

    const card = CARDS[recipe.card || id];
    assert.ok(card, `recipe "${id}" makes card "${recipe.card || id}", which does not exist`);
    assert.ok(card.consumed, `"${recipe.card || id}" is brewed, so it must be consumed on play`);
    // An unimplemented kind is the failure that looks like a working potion.
    assert.ok(EFFECT_KINDS.includes(card.effect.kind),
      `recipe "${id}" makes effect kind "${card.effect.kind}"`);
  }
});

test('brewing spends the stash and deals the cards, or does nothing at all', () => {
  const stash = { sunpetal: 2, dewglass: 1, cellsap: 5 };
  const out = brew('sunsalve', stash);
  assert.deepEqual(out.cards, ['sunsalve', 'sunsalve', 'sunsalve']);
  assert.deepEqual(out.stash, { sunpetal: 0, dewglass: 0, cellsap: 5 });
  assert.deepEqual(stash, { sunpetal: 2, dewglass: 1, cellsap: 5 }, 'brew wrote to the stash it was given');

  // Short: nothing, rather than a half-applied spend.
  assert.equal(brew('sunsalve', { sunpetal: 1 }), null);
  assert.equal(brew('not-a-recipe', { sunpetal: 9 }), null);
});

test('every material is worth bending down for', () => {
  // A herb no recipe needs is a node the player learns to walk past.
  const wanted = new Set();
  for (const recipe of Object.values(RECIPES)) {
    for (const id of Object.keys(recipe.costs)) wanted.add(id);
  }
  for (const id of Object.keys(MATERIALS)) {
    assert.ok(wanted.has(id), `nothing brews with "${id}"`);
  }
});

test('there is never quite enough to brew everything', () => {
  // No move budget, so scarcity is the only limit: the map has to grow less
  // than one of each recipe needs, or brewing stops being a choice.
  const needed = {};
  for (const recipe of Object.values(RECIPES)) {
    for (const [id, n] of Object.entries(recipe.costs)) needed[id] = (needed[id] || 0) + n;
  }
  const totalNeeded = Object.values(needed).reduce((a, b) => a + b, 0);
  const bestCase = SPAWNS.herbs * Math.max(...CLASSES.map((c) => c.gather));
  assert.ok(bestCase < totalNeeded * 2,
    `a full sweep yields ${bestCase} units against ${totalNeeded} for one of each — too generous`);
});

test('every material can be drawn and picked', () => {
  for (const [id, material] of Object.entries(MATERIALS)) {
    assert.ok(material.rarity > 0, `material "${id}" can never appear`);
    assert.ok(PALETTE[material.colour], `material "${id}" uses colour key "${material.colour}"`);
    assert.ok(MATERIAL_ART[id], `material "${id}" has no icon`);
  }
});

test('a run has a posted schedule: rounds, then the boss', () => {
  assert.equal(BOSS_ROUND, ROUNDS_BEFORE_BOSS + 1);
  assert.equal(ROUNDS.length, BOSS_ROUND, 'every round including the boss needs a name and a blight');
  for (const round of ROUNDS) {
    assert.ok(typeof round.name === 'string' && round.name.length, 'a round needs a name');
    assert.ok(round.blight >= 0);
  }
  const blights = ROUNDS.map((r) => r.blight);
  assert.deepEqual(blights, [...blights].sort((a, b) => a - b), 'rounds should not get easier');
  assert.equal(roundInfo(1), ROUNDS[0]);
  assert.equal(roundInfo(99), ROUNDS[ROUNDS.length - 1], 'a round past the end clamps, never undefined');
});

test('the phase card says what the screen should shout', () => {
  const build = phaseCard(1, 'build');
  assert.match(build.title, /Round One — Build Phase/);
  assert.equal(build.subtitle, 'The party plans.');
  assert.match(phaseCard(2, 'combat').title, /Round Two — The Surge/);
  assert.match(phaseCard(BOSS_ROUND, 'combat').title, /The Array Wakes/);
});

test('every wave is made of real enemies, and the boss round has the boss', () => {
  for (let round = 1; round <= BOSS_ROUND; round++) {
    const wave = waveFor(round);
    assert.ok(wave.length > 0, `round ${round} sends nothing`);
    for (const type of wave) assert.ok(ENEMIES[type], `round ${round} sends unknown "${type}"`);
  }
  assert.ok(waveFor(BOSS_ROUND).some((t) => ENEMIES[t].boss), 'the last wave must include the boss');
  for (let round = 1; round < BOSS_ROUND; round++) {
    assert.ok(!waveFor(round).some((t) => ENEMIES[t].boss), `the boss leaked into round ${round}`);
  }
});

test('every enemy can be drawn and can arrive', () => {
  for (const [id, enemy] of Object.entries(ENEMIES)) {
    assert.ok(enemy.hp > 0 && enemy.hits > 0, `enemy "${id}" cannot fight`);
    // Nothing approaches any more — a surge is a standoff — so what matters is
    // that everything on the field can actually do something on turn one.
    assert.ok(enemy.hits >= 1, `enemy "${id}" arrives unable to hurt anybody`);
    assert.ok(ENEMY_ART[enemy.art], `enemy "${id}" has no art key "${enemy.art}"`);
  }
});

test('the wizard economy is wired end to end', () => {
  const wizard = CLASSES.find((c) => c.id === 'wizard');
  assert.ok(wizard && wizard.cast, 'the wizard must be the caster');
  assert.ok(wizard.hp < Math.min(...CLASSES.filter((c) => c.id !== 'wizard').map((c) => c.hp)),
    'squishy means the lowest hp in the roster');
  const fireball = CARDS.fireball;
  assert.equal(fireball.classId, 'wizard', 'fireball must belong to the wizard');
  assert.ok(actionsFor('wizard').includes('fireball'), 'the wizard should always have one to hand');
  // Two pools doing two different jobs, which is the shape of her whole class:
  // pages are the run's currency and buy what she *can* cast at the bench;
  // charges are the fight's and decide when she gets to cast it.
  assert.ok(fireball.chargeCost >= 1, 'a free fireball makes charges pointless');
  assert.ok(!fireball.pageCost, 'and a page is not what a cast costs any more');
  assert.equal(fireball.effect.kind, 'strike');
  assert.ok(SPAWNS.pages > 0, 'no pages ever spawn');
  assert.ok(CACHE_YIELD.pages > 0);
  assert.ok(PAGES.name);
});

test('exactly one class spends each pool', () => {
  assert.equal(CLASSES.filter((c) => c.craft).length, 1);
  assert.equal(CLASSES.filter((c) => c.build).length, 1);
  assert.equal(CLASSES.filter((c) => c.cast).length, 1);
});

/* ---- the garden ---------------------------------------------------------- */

test('a pot pays for patience and never for a same-round loop', () => {
  assert.equal(potYield(0), 1, 'harvesting what you just planted refunds the cutting, no more');
  assert.ok(potYield(1) > 1, 'one round in the pot is a return');
  assert.ok(potYield(2) > potYield(1), 'two is a better one');
  assert.ok(potYield(3) >= potYield(2), 'the ladder tops out rather than dipping');
  assert.equal(potYield(9), potYield(3), 'and it stays topped out');
  for (const age of [0, 1, 2, 3, 9]) assert.ok(potStage(age), `age ${age} needs a stage name`);
});

test('planting and harvesting move whole cuttings and refuse half-moves', () => {
  const pots = Array(POT_COUNT).fill(null);
  assert.equal(plantPot(pots, 0, 'sunpetal', { sunpetal: 0 }), null, 'no cutting, no plant');
  assert.equal(plantPot(pots, 9, 'sunpetal', { sunpetal: 2 }), null, 'no ninth pot');
  assert.equal(plantPot(pots, 0, 'not-a-herb', { sunpetal: 2 }), null);

  const planted = plantPot(pots, 0, 'sunpetal', { sunpetal: 2 });
  assert.deepEqual(planted.pots[0], { herb: 'sunpetal', age: 0 });
  assert.equal(planted.stash.sunpetal, 1, 'the cutting came out of the stash');
  assert.equal(plantPot(planted.pots, 0, 'cellsap', { cellsap: 1 }), null, 'a pot holds one plant');

  const grown = growPots(growPots(planted.pots));
  assert.equal(grown[0].age, 2);
  const picked = harvestPot(grown, 0, planted.stash);
  assert.equal(picked.yielded, potYield(2));
  assert.equal(picked.stash.sunpetal, 1 + potYield(2));
  assert.equal(picked.pots[0], null, 'the pot is free again');
  assert.equal(harvestPot(picked.pots, 0, picked.stash), null, 'an empty pot has nothing to give');
});

/* ---- spellcraft ---------------------------------------------------------- */

/* The op keys composeSpell understands. Pinned here so a modifier authored
   with a typo — `amonut: 5` — fails this file instead of silently doing
   nothing at the bench. */
const MODIFIER_OPS = new Set([
  'amount', 'mult', 'charges', 'aoe', 'selfWard', 'leech', 'hpCost',
  'farthest', 'pageOnKill', 'opening',
]);

test('every spell and every modifier is well-formed', () => {
  assert.ok(Object.keys(SPELLS).length >= 3, 'three bones at least');
  for (const [id, spell] of Object.entries(SPELLS)) {
    const where = `spell "${id}"`;
    assert.ok(EFFECT_KINDS.includes(spell.verb), `${where}: verb must be an effect kind`);
    assert.ok(Number.isInteger(spell.amount) && spell.amount > 0, `${where}: amount`);
    assert.ok(Number.isInteger(spell.charges) && spell.charges > 0, `${where}: charges`);
    assert.ok(spell.name && spell.note, `${where}: needs a face`);
  }
  for (const [id, mod] of Object.entries(MODIFIERS)) {
    const where = `modifier "${id}"`;
    assert.ok(MODIFIER_WEIGHTS[mod.rarity], `${where}: rarity "${mod.rarity}" has no draft weight`);
    assert.ok(mod.name && mod.note, `${where}: needs a face`);
    const keys = Object.keys(mod.op || {});
    assert.ok(keys.length, `${where}: an op that does nothing is not a modifier`);
    for (const key of keys) assert.ok(MODIFIER_OPS.has(key), `${where}: op "${key}" is not one composeSpell reads`);
  }
});

test('sockets fold in order: the 30 the example asks for, and the 25 it is not', () => {
  // The design's own worked example: Fireball 10, +5, then a doubler.
  const forward = composeSpell('fireball', ['kindling', 'twin']);
  assert.equal(forward.amount, 30, '(10 + 5) x 2');
  assert.equal(forward.charges, 1, 'the doubler costs a charge');
  // The same two sockets the other way round are a different spell.
  const reversed = composeSpell('fireball', ['twin', 'kindling']);
  assert.equal(reversed.amount, 25, '(10 x 2) + 5 — rearranging is a real decision');
});

test('no arrangement of sockets can craft a spell out of existing', () => {
  const drained = composeSpell('fireball', ['twin', 'twin']);
  assert.equal(drained.charges, 1, 'charges clamp at one');
  const echoes = composeSpell('nova', ['echo', 'echo', 'echo']);
  assert.equal(echoes.amount, 1, 'amount clamps at one');
  assert.equal(echoes.charges, 5, 'and the copies still arrive');
});

test('a Splitting Sigil turns a strike into the whole lane, for less each', () => {
  const split = composeSpell('fireball', ['split']);
  assert.equal(split.verb, 'strikeAll');
  assert.equal(split.amount, Math.ceil(SPELLS.fireball.amount * 0.6));
  // On a spell that already reaches everything it is only the discount.
  assert.equal(composeSpell('nova', ['split']).verb, 'strikeAll');
});

test('the draft is seeded, distinct within itself, and open to duplicates across drafts', () => {
  const book = freshSpellbook();
  const first = rollOffers(seededRandom(42), book);
  const again = rollOffers(seededRandom(42), book);
  assert.deepEqual(first, again, 'the same seed must turn over the same draft');
  assert.equal(first.length, 3);
  assert.equal(new Set(first.map((o) => `${o.type}:${o.id}`)).size, 3, 'three distinct options in one draft');
  for (const offer of first) {
    if (offer.type === 'spell') {
      assert.ok(SPELLS[offer.id], `offered spell "${offer.id}" does not exist`);
      assert.ok(!book.known.includes(offer.id), 'a spell she knows is not an offer');
    } else {
      assert.ok(MODIFIERS[offer.id], `offered modifier "${offer.id}" does not exist`);
    }
  }

  // Duplicates are a real find: a modifier she already owns can turn up
  // again. Rares stay rare through the weights instead — pinned as a ratio
  // so a rebalance cannot quietly make Twin Cores common.
  const owned = { known: ['fireball'], satchel: ['kindling'], slots: { fireball: ['twin'] } };
  const offered = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    for (const offer of rollOffers(seededRandom(seed), owned)) {
      if (offer.type === 'mod') offered.add(offer.id);
    }
  }
  assert.ok(offered.has('kindling'), 'an owned modifier can be drafted again');
  assert.ok(MODIFIER_WEIGHTS.common >= MODIFIER_WEIGHTS.rare * 8,
    'a rare should be a fraction of a common, not a peer');

  // A book that knows every spell still drafts modifiers — a page always has
  // something to open.
  const everything = {
    known: Object.keys(SPELLS),
    satchel: Object.keys(MODIFIERS),
    slots: Object.fromEntries(Object.keys(SPELLS).map((id) => [id, []])),
  };
  assert.ok(draftableCount(everything) > 0);
  assert.equal(rollOffers(seededRandom(1), everything).length, 3);
  assert.ok(rollOffers(seededRandom(1), everything).every((o) => o.type === 'mod'));
});

test('the bench refuses what the book cannot hold', () => {
  let book = { known: ['fireball'], satchel: ['kindling', 'echo', 'emberward', 'siphon'], slots: { fireball: [] } };
  for (const mod of ['kindling', 'echo', 'emberward']) {
    book = moveModifier(book, mod, 'fireball');
    assert.ok(book, `socketing ${mod} should be legal`);
  }
  assert.equal(book.slots.fireball.length, SPELL_SLOTS);
  assert.equal(moveModifier(book, 'siphon', 'fireball'), null, 'a fourth socket does not exist');
  assert.equal(moveModifier(book, 'twin', 'fireball'), null, 'she does not own a Twin Core');
  assert.equal(moveModifier(book, 'kindling', 'nova'), null, 'she has not learned Cinder Nova');
  // Out again is always legal, and the satchel gets it back.
  const returned = moveModifier(book, 'echo', null);
  assert.ok(returned.satchel.includes('echo'));
  assert.equal(returned.slots.fireball.length, SPELL_SLOTS - 1);
});

test('the deck the book deals is the kit plus the charges', () => {
  const fresh = wizardCombatDeck(freshSpellbook());
  const kit = Object.values(WIZARD_BASE_KIT).reduce((a, b) => a + b, 0);
  assert.equal(fresh.length, kit + SPELLS.fireball.charges);
  assert.equal(fresh.filter((id) => id === 'fireball').length, SPELLS.fireball.charges);

  const echoed = wizardCombatDeck({ known: ['fireball'], satchel: [], slots: { fireball: ['echo'] } });
  assert.equal(echoed.filter((id) => id === 'fireball').length, SPELLS.fireball.charges + 1,
    'an Echo Script is another copy in the deal');
});

/* This test used to *enforce* the thing the action rewrite deleted: every class
 * opened with six cards that were `strike 3` and `ward 3` under five sets of
 * names, and the old assertion checked they all still said 3. That was 60-70%
 * of every deck and most of every turn in the game.
 *
 * Inverted, it now pins the opposite: two free basics per seat, one swing and
 * one guard, and the numbers on them are *not* all the same. If somebody ever
 * flattens them again this is what says so.
 */
test('every class has its own two basics, and they are not the same two numbers', () => {
  const swings = new Set();
  const guards = new Set();

  for (const cls of playableClasses()) {
    const basics = CLASS_BASICS[cls.id] || [];
    assert.equal(basics.length, 2, `${cls.id}: one swing and one guard, nothing else`);

    const [swing, ward] = basics.map((id) => CARDS[id]);
    assert.equal(swing.kind, 'attack', `${cls.id}: the first basic is the swing`);
    assert.equal(ward.kind, 'defend', `${cls.id}: the second is the guard`);

    for (const id of basics) {
      assert.equal(CARDS[id].classId, cls.id, `${cls.id}: "${id}" wears the class's name`);
      assert.ok(CARDS[id].basic, `${cls.id}: "${id}" must be marked as a basic`);
      assert.equal(actionCost(id), null, `${cls.id}: "${id}" is free or it is not a basic`);
    }

    swings.add(swing.effect.amount);
    guards.add(ward.effect.amount);

    // The rename is real: no two classes share a basic id.
    for (const other of playableClasses()) {
      if (other.id === cls.id) continue;
      for (const id of basics) assert.ok(!(CLASS_BASICS[other.id] || []).includes(id));
    }
  }

  assert.ok(swings.size > 1, 'every seat swinging for the same number is the bug this replaced');
  assert.ok(guards.size > 1, 'and every seat guarding for the same number is the other half of it');

  // The Wizard is the roster's glass floor, and it is stated in her basics as
  // well as her health: the best swing in the game and the worst guard in it.
  const wizardSwing = CARDS[CLASS_BASICS.wizard[0]].effect.amount;
  const wizardGuard = CARDS[CLASS_BASICS.wizard[1]].effect.amount;
  assert.equal(wizardSwing, Math.max(...swings), 'the Wizard hits hardest for free');
  assert.equal(wizardGuard, Math.min(...guards), 'and hides worst');
});

test('an invested Fireball out-hits an invested Sunlance', () => {
  // The Wizard is the heavy hitter the party built around; the Engineer's
  // ceiling is real but hers is higher. Two sockets against the whole
  // heliostat line — three tiers, every one of them built.
  const hers = composeSpell('fireball', ['kindling', 'twin']).amount;
  const his = cardEffect('sunlance', worksFrom([
    { id: 'heliostat', x: 0, y: 0 }, { id: 'mirrorfield', x: 1, y: 0 },
    { id: 'furnace', x: 2, y: 0 },
  ])).amount;
  assert.ok(hers > his, `Fireball at ${hers} must clear the sunlance at ${his}`);
});

test('the library pays a round wage and the bench has three sockets', () => {
  assert.ok(PAGES_PER_ROUND >= 1, 'a round with no page is a round spent watching');
  assert.equal(SPELL_SLOTS, 3);
  const book = freshSpellbook();
  assert.deepEqual(book.known, ['fireball'], 'she opens knowing the one spell the example is about');
});

test('a build site spawns all three kinds of node, each on its own legal tile', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const terrain = generateTerrain(seededRandom(seed));
    const nodes = spawnItems(terrain, seededRandom(seed + 1000));
    const kinds = new Set(nodes.map((n) => n.kind));
    for (const kind of ['herb', 'salvage', 'pages']) assert.ok(kinds.has(kind), `seed ${seed}: no ${kind}`);
    assert.equal(new Set(nodes.map((n) => `${n.x},${n.y}`)).size, nodes.length, `seed ${seed}: two nodes share a tile`);
    for (const n of nodes) {
      const tile = TERRAIN[tileAt(terrain, n.x, n.y)];
      if (n.kind === 'herb') assert.ok(tile.grows, `seed ${seed}: a herb on ${tileAt(terrain, n.x, n.y)}`);
      else assert.ok(tile.walk, `seed ${seed}: a cache on unwalkable ground`);
    }
  }
});

/* The cast's canvas. Named here rather than repeated as literals so raising
   the hero resolution is one edit and not a hunt through assertions. */
const HERO_W = 32;
const HERO_H = 40;

test('sprites are rectangular and use only palette keys', () => {
  const check = (label, rows, width) => {
    for (const [i, row] of rows.entries()) {
      assert.equal(row.length, width, `${label} row ${i}: width ${row.length}, want ${width}`);
      for (const key of row) {
        if (key === '.' || key === ' ') continue;
        assert.ok(PALETTE[key], `${label} row ${i}: "${key}" is not in the palette`);
      }
    }
  };

  // One skeleton under the whole cast: same canvas, same ground line, so a
  // change to one can be reasoned about for all.
  for (const [name, art] of Object.entries(HERO_ART)) {
    assert.equal(art.rows.length, HERO_H, `hero "${name}" must be ${HERO_H} rows tall`);
    check(`hero "${name}"`, art.rows, HERO_W);
    assert.ok(art.split > 0 && art.split < HERO_H, `hero "${name}" has a split off the sprite`);
    for (const [x, y] of art.eyes ?? []) {
      assert.ok(x >= 0 && x < HERO_W && y >= 0 && y < HERO_H, `hero "${name}" has an eye off the sprite`);
    }
  }

  for (const [name, rows] of Object.entries(MATERIAL_ART)) {
    check(`material "${name}"`, rows, rows[0].length);
  }

  for (const [name, rows] of Object.entries(SALVAGE_ART)) {
    check(`salvage "${name}"`, rows, rows[0].length);
  }

  // Buildings sit on one map tile, so their art has to be exactly one tile.
  for (const [name, rows] of Object.entries(BUILDING_ART)) {
    assert.equal(rows.length, TILE, `building "${name}" must be ${TILE} rows tall`);
    check(`building "${name}"`, rows, TILE);
  }
});

test('every terrain kind has at least one cut, and every cut is a tile', () => {
  // The renderer picks a cut per tile from a hash of its coordinates. A kind
  // with no cuts would draw nothing; a cut of the wrong size would slide the
  // whole grid sideways from that tile on.
  for (const kind of Object.keys(TERRAIN)) {
    const cuts = TERRAIN_VARIANTS[kind];
    assert.ok(Array.isArray(cuts) && cuts.length, `terrain "${kind}" has no variants`);
    for (const [n, rows] of cuts.entries()) {
      assert.equal(rows.length, TILE, `terrain "${kind}" cut ${n} must be ${TILE} rows`);
      for (const [i, row] of rows.entries()) {
        assert.equal(row.length, TILE, `terrain "${kind}" cut ${n} row ${i} is ${row.length} wide`);
        for (const key of row) {
          assert.ok(PALETTE[key], `terrain "${kind}" cut ${n} uses "${key}"`);
        }
      }
    }
    // The canonical tile is the first cut, so the two can never disagree.
    assert.deepEqual(TERRAIN_ART[kind], cuts[0], `terrain "${kind}" art is not its first cut`);
  }
});

test('props are rectangular, opaque-keyed, and taller than the tile they stand on', () => {
  // A prop that fits inside a tile belongs in TERRAIN_ART; this table exists
  // for the things that overhang, which is what makes walking behind one work.
  const props = [
    ...Object.entries(PROP_ART).map(([name, rows]) => [`prop "${name}"`, rows]),
    ...TREE_ART.map((rows, i) => [`tree ${i}`, rows]),
    ...FIRE_ART.map((rows, i) => [`fire frame ${i}`, rows]),
  ];
  for (const [label, rows] of props) {
    assert.ok(rows.length > 0, `${label} is empty`);
    const width = rows[0].length;
    for (const [i, row] of rows.entries()) {
      assert.equal(row.length, width, `${label} row ${i} is ${row.length}, want ${width}`);
      for (const key of row) {
        if (key === '.' || key === ' ') continue;
        assert.ok(PALETTE[key], `${label} row ${i} uses "${key}"`);
      }
    }
  }
  for (const [name, rows] of Object.entries(PROP_ART)) {
    assert.ok(rows.length > TILE, `prop "${name}" is not taller than a tile`);
  }
  // Every fire frame is the same size, or the flame would jump between frames.
  const [w, h] = [FIRE_ART[0][0].length, FIRE_ART[0].length];
  for (const [i, rows] of FIRE_ART.entries()) {
    assert.equal(rows.length, h, `fire frame ${i} is a different height`);
    assert.equal(rows[0].length, w, `fire frame ${i} is a different width`);
  }
});

test('missingFor reports what is short, not just that something is', () => {
  assert.deepEqual(missingFor('sunsalve', { sunpetal: 2, dewglass: 1 }), {});
  assert.deepEqual(missingFor('sunsalve', { sunpetal: 1 }), { sunpetal: 1, dewglass: 1 });
  assert.equal(missingFor('not-a-recipe', {}), null);
});

test('materialFor covers the whole range and only returns real materials', () => {
  // The engine feeds this its seeded generator, so every value in [0,1) has to
  // land on something — a gap would be a node holding undefined.
  for (let i = 0; i < 200; i++) {
    const id = materialFor(i / 200);
    assert.ok(MATERIALS[id], `roll ${i / 200} produced "${id}"`);
  }
  assert.ok(MATERIALS[materialFor(0)]);
  assert.ok(MATERIALS[materialFor(0.999999)]);
});

test('classById finds live classes and refuses nonsense', () => {
  assert.equal(classById('alchemist').name, 'The Alchemist');
  assert.equal(classById('nope'), null);
});

/* ---------------------------------------------------------------- the map -- */

/* The room generates the map and the client only draws it, so the thing worth
 * protecting is that the same seed produces the same ruin on both sides. A map
 * that differed between the two would put a herb where nobody could click it.
 */

test('every terrain kind has a tile to draw it with', () => {
  for (const kind of Object.keys(TERRAIN)) {
    const rows = TERRAIN_ART[kind];
    assert.ok(rows, `terrain "${kind}" has no art`);
    assert.equal(rows.length, TILE, `terrain "${kind}" must be ${TILE} rows`);
    for (const [i, row] of rows.entries()) {
      assert.equal(row.length, TILE, `terrain "${kind}" row ${i} is ${row.length} wide`);
      for (const key of row) {
        assert.ok(PALETTE[key], `terrain "${kind}" row ${i} uses "${key}", which is not in the palette`);
      }
    }
  }
});

test('the same seed always produces the same map', () => {
  const seed = seedFromCode('QF7K');
  const a = generateMap(seededRandom(seed));
  const b = generateMap(seededRandom(seed));
  assert.deepEqual(a, b);

  const other = generateMap(seededRandom(seedFromCode('ZZ42')));
  assert.notDeepEqual(a.terrain, other.terrain, 'two codes produced an identical ruin');
});

test('seedFromCode is stable and separates codes', () => {
  assert.equal(seedFromCode('QF7K'), seedFromCode('QF7K'));
  assert.notEqual(seedFromCode('QF7K'), seedFromCode('QF7L'));
});

test('generated terrain is the right size and holds only real kinds', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const terrain = generateTerrain(seededRandom(seed));
    assert.equal(terrain.length, MAP_W * MAP_H, `seed ${seed} produced the wrong tile count`);
    for (const kind of terrain) {
      assert.ok(TERRAIN[kind], `seed ${seed} produced terrain "${kind}"`);
    }
  }
});

test('nodes land in bounds, on legal ground, and never stack', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { terrain, nodes } = generateMap(seededRandom(seed));
    const seen = new Set();
    for (const node of nodes) {
      const where = `seed ${seed} node ${node.id}`;
      assert.ok(inBounds(node.x, node.y), `${where} is off the map at ${node.x},${node.y}`);
      assert.equal(node.taken, false, `${where} starts taken`);

      const kind = tileAt(terrain, node.x, node.y);
      if (node.kind === 'herb') {
        assert.ok(MATERIALS[node.material], `${where} grew "${node.material}"`);
        assert.ok(TERRAIN[kind].grows, `${where} is on ${kind}, which nothing grows on`);
      } else if (node.kind === 'salvage') {
        assert.ok(SALVAGE[node.salvage], `${where} holds "${node.salvage}"`);
        assert.ok(TERRAIN[kind].walk, `${where} is on ${kind}, which cannot be reached`);
      } else {
        assert.equal(node.kind, 'pages', `${where} has kind "${node.kind}"`);
        assert.ok(TERRAIN[kind].walk, `${where} is on ${kind}, which cannot be reached`);
      }

      const key = `${node.x},${node.y}`;
      assert.ok(!seen.has(key), `${where} shares a tile with another node`);
      seen.add(key);
    }
  }
});

test('a building whose rule names terrain has somewhere legal on nearly every site', () => {
  /* The Rain Cistern and the Pulp Press asked to stand `near: 'water'`, which
     compared against the literal kind — and `shoreline()` renames exactly the
     water tiles that touch land, which are the only ones a building could ever
     be beside. Both were unbuildable anywhere on 90.4% of sites, and the Reed
     Bed and Mycelial Filter that need a cistern standing went with them. It
     cost the mend line and the pages income, and nothing failed. */
  const rules = Object.entries(BUILDINGS).filter(([, b]) => b.place
    && (b.place.near || b.place.on || b.place.onOrNear));
  assert.ok(rules.length, 'no building has a terrain placement rule to check');

  const SEEDS = 60;
  for (const [id, building] of rules) {
    let dead = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { terrain, nodes } = generateMap(seededRandom(seed));
      let legal = false;
      for (let y = 0; y < MAP_H && !legal; y++) {
        for (let x = 0; x < MAP_W && !legal; x++) {
          if (!placeRefusal(id, { terrain, buildings: [], nodes, x, y })) legal = true;
        }
      }
      if (!legal) dead++;
    }
    // A site with no water at all is a legitimate roll, so this is not zero —
    // it is the line between "sometimes dry" and "the building does not exist".
    assert.ok(dead <= SEEDS * 0.2,
      `${building.name} has nowhere legal on ${dead}/${SEEDS} sites`);
  }
});

test('herb ids are unique, which is what gather intents address', () => {
  const { nodes } = generateMap(seededRandom(7));
  const ids = nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate node id in ${ids.join(', ')}`);
});

test('a map crowded out of growable ground spawns fewer herbs, not broken ones', () => {
  // spawnHerbs draws without replacement, so the guard that matters is what it
  // does when it runs out of ground rather than when it has plenty.
  const terrain = new Array(MAP_W * MAP_H).fill('rubble');
  assert.deepEqual(spawnHerbs(terrain, seededRandom(1)), []);

  terrain[0] = 'grass';
  terrain[1] = 'grass';
  const nodes = spawnHerbs(terrain, seededRandom(1), HERB_COUNT);
  assert.equal(nodes.length, 2, 'spawned more herbs than there was ground for');
});

test('players start on ground they can stand on', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const terrain = generateTerrain(seededRandom(seed));
    for (let offset = 0; offset < PARTY_SIZE; offset++) {
      const { x, y } = spawnTile(terrain, offset);
      assert.ok(inBounds(x, y), `seed ${seed} spawned a player off the map`);
      assert.ok(TERRAIN[tileAt(terrain, x, y)].walk, `seed ${seed} spawned a player in ${tileAt(terrain, x, y)}`);
    }
  }
});

/* ----------------------------------------------------------------- camp --- */

/* The camp is the one fixed thing on a site. It is terrain rather than a
 * building because every rule that matters — walking, building, growing,
 * spawning, pathing — already reads TERRAIN, so the whole footprint costs three
 * table entries and a stamp instead of a footprint-aware rewrite of all of it.
 *
 * The tent sits above a clearing and the fire is in the middle of the clearing,
 * because a tent is somewhere you sleep and the fire is the thing people
 * actually gather at.
 */

test('every site has a tent above a clearing with a fire in the middle', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const terrain = generateTerrain(seededRandom(seed));
    for (let y = TENT_Y - 1; y <= CAMP_Y + CAMP_RADIUS; y++) {
      for (let x = CAMP_X - CAMP_RADIUS; x <= CAMP_X + CAMP_RADIUS; x++) {
        const kind = tileAt(terrain, x, y);
        const underTent = Math.abs(x - CAMP_X) <= 1 && Math.abs(y - TENT_Y) <= 1;
        const isFire = x === CAMP_X && y === CAMP_Y;
        const want = underTent ? 'tent' : isFire ? 'fire' : 'camp';
        assert.equal(kind, want, `seed ${seed} at (${x},${y}) is "${kind}", want "${want}"`);
      }
    }
    // The tent has to be above the clearing, not in it.
    assert.ok(TENT_Y + 1 < CAMP_Y, 'the tent overlaps the fire');
  }
});

test('the tent and the fire are solid, the clearing is not', () => {
  const terrain = generateTerrain(seededRandom(7));

  for (const [what, x, y] of [['tent', CAMP_X, TENT_Y], ['fire', CAMP_X, CAMP_Y]]) {
    assert.equal(walkableAt(terrain, [], x, y), false, `the ${what} is walkable`);
    assert.equal(canBuildAt(terrain, [], [], x, y), false, `you can build on the ${what}`);
  }
  assert.equal(TERRAIN.tent.grows, false, 'herbs grow through the tent');
  assert.equal(TERRAIN.fire.grows, false, 'herbs grow through the fire');

  // The clearing is what you stand on, so the fire has to be reachable from
  // every side — a fire you can only stand north of is a wall.
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    assert.ok(walkableAt(terrain, [], CAMP_X + dx, CAMP_Y + dy),
      `the clearing at (${dx},${dy}) from the fire is not walkable`);
  }
});

/* The shore is eight pictures of one thing, so what these check is that the
 * picture never disagrees with the ground it is drawn on: a shore is water in
 * every rule, and it points at land that is actually there.
 */
test('every shore is as impassable as the water it is made of', () => {
  for (const dir of ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']) {
    const kind = 'shore' + dir;
    for (const rule of ['walk', 'build', 'grows']) {
      assert.equal(TERRAIN[kind][rule], TERRAIN.water[rule], `${kind} does not ${rule} like water`);
    }
    assert.ok(isWater(kind), `isWater does not recognise ${kind}`);
  }
  assert.ok(isWater('water'), 'isWater does not recognise water');
  assert.equal(isWater('grass'), false, 'isWater thinks grass is wet');
  assert.equal(isWater(null), false, 'isWater chokes on an off-map tile');
});

test('a shore points the way the land actually is', () => {
  // Not that the named tile is land — it need not be. Land at both upper
  // corners and water in the notch between them is a north shore, and
  // correctly: the bank runs along the top of the tile either side of a gap
  // one tile wide. What has to hold is weaker and more useful — a shore has a
  // bank at all, and the way it points is the way the bank is.
  const OFFSET = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1],
                   S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };

  for (let seed = 1; seed <= 120; seed++) {
    const terrain = generateTerrain(seededRandom(seed));
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const kind = tileAt(terrain, x, y);
        if (kind === 'water' || !isWater(kind)) continue;
        const where = `seed ${seed} at (${x},${y})`;

        let sx = 0, sy = 0, banks = 0;
        for (const [dx, dy] of Object.values(OFFSET)) {
          const other = tileAt(terrain, x + dx, y + dy);
          if (!other || isWater(other)) continue;
          banks += 1;
          sx += dx;
          sy += dy;
        }
        assert.ok(banks > 0, `${where} is a ${kind} in the middle of open water`);

        // Stronger than the direction test below and always answerable: the
        // tile a shore names must be land. This is what caught a shoreSE whose
        // south-east neighbour was open water, on a site where the pond ran as
        // a diagonal channel with banks on five sides.
        const [nx, ny] = OFFSET[kind.slice(5)];
        const named = tileAt(terrain, x + nx, y + ny);
        assert.ok(named && !isWater(named),
          `${where} is a ${kind} but the tile it names is ${named}, not a bank`);

        // Not "points the way the bank averages" — that is unsatisfiable in
        // two real cases. Where the banks cancel exactly, no direction has a
        // positive projection at all. And where the average points at water —
        // a pond running as a diagonal channel has banks on five sides, and
        // the mean of them lands in one of the three gaps — `shoreline` now
        // takes the strongest actual bank instead, which can be perpendicular
        // to the average. Both are better pictures than the alternative.
        //
        // What still has to hold, and does: a shore never points AGAINST its
        // bank. That is the fault worth catching, and unlike the projection
        // being strictly positive, it is always answerable.
        assert.ok(nx * sx + ny * sy >= 0,
          `${where} is a ${kind} pointing away from its bank`);
      }
    }
  }
});

test('open water is only left where the banks cancel out', () => {
  // A tile of water pulled at from opposite sides has no direction to shallow
  // in, and that is the only excuse for leaving one looking deep against a
  // bank. Anything else is a coastline the generator forgot to draw.
  const AROUND = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

  for (let seed = 1; seed <= 120; seed++) {
    const terrain = generateTerrain(seededRandom(seed));
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (tileAt(terrain, x, y) !== 'water') continue;
        let sx = 0, sy = 0;
        for (const [dx, dy] of AROUND) {
          const other = tileAt(terrain, x + dx, y + dy);
          if (!other || isWater(other)) continue;
          const pull = dx && dy ? 1 : 2;
          sx += dx * pull;
          sy += dy * pull;
        }
        assert.ok(!sx && !sy, `seed ${seed} left open water at (${x},${y}) with a bank on one side`);
      }
    }
  }
});

test('the shore reads the eight directions, and a dead heat as none', () => {
  // Straight from the table rather than from a rolled map, because the cases
  // that matter — a corner, a channel — are the ones a hundred seeds might
  // never happen to produce.
  const lay = (marks) => {
    const cells = new Array(MAP_W * MAP_H).fill('water');
    for (const [x, y, kind] of marks) cells[y * MAP_W + x] = kind;
    return cells;
  };
  const kindAt = (marks, x, y) => shoreline(lay(marks))[y * MAP_W + x];

  for (const [dx, dy, dir] of [[0, -1, 'N'], [1, -1, 'NE'], [1, 0, 'E'], [1, 1, 'SE'],
                               [0, 1, 'S'], [-1, 1, 'SW'], [-1, 0, 'W'], [-1, -1, 'NW']]) {
    assert.equal(kindAt([[5 + dx, 5 + dy, 'grass']], 5, 5), 'shore' + dir,
      `land at (${dx},${dy}) did not read as ${dir}`);
  }

  // A coast running east that turns north: land along the top and the right,
  // which is the common way a corner tile happens and has to read as one.
  assert.equal(kindAt([[5, 4, 'grass'], [6, 4, 'grass'], [6, 5, 'grass']], 5, 5), 'shoreNE',
    'a coast turning north did not read as a corner');

  // An orthogonal bank outvotes a diagonal one: you could touch it.
  assert.equal(kindAt([[5, 4, 'grass'], [6, 4, 'grass']], 5, 5), 'shoreN',
    'a bank past a corner outvoted the one against the tile');

  // A channel one tile wide has a bank both ways and no way to shallow.
  assert.equal(kindAt([[4, 5, 'grass'], [6, 5, 'grass']], 5, 5), 'water',
    'a channel picked a side');

  // Off the map is not land: a pond at the edge has no bank there to draw.
  assert.equal(kindAt([], 0, 0), 'water', 'the edge of the map read as a shore');
});

test('the camp clears its own ground, whatever the ruin rolled', () => {
  // Before this, better than one site in ten rolled water or a crevice under
  // the centre and the tent floated in a pond.
  for (let seed = 1; seed <= 120; seed++) {
    const terrain = generateTerrain(seededRandom(seed));
    for (let y = TENT_Y - 1; y <= CAMP_Y + CAMP_RADIUS; y++) {
      for (let x = CAMP_X - CAMP_RADIUS; x <= CAMP_X + CAMP_RADIUS; x++) {
        const kind = tileAt(terrain, x, y);
        assert.ok(kind === 'tent' || kind === 'camp' || kind === 'fire',
          `seed ${seed} left "${kind}" in the camp footprint`);
      }
    }
  }
});

test('nothing grows close enough to be drawn over the camp', () => {
  // A tree is a canopy three tiles tall. One standing south of the tent sorts
  // in front of it and swallows the whole camp, which happened on about half
  // of all sites before the tree pass learned to refuse the ground near it.
  for (let seed = 1; seed <= 120; seed++) {
    const terrain = generateTerrain(seededRandom(seed));
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (tileAt(terrain, x, y) !== 'tree') continue;
        assert.ok(!inCamp(x, y, 2), `seed ${seed} grew a tree at (${x},${y}), over the camp`);
      }
    }
  }
});

test('the party spawns around the fire', () => {
  // spawnTile's offset used to slide the search window sideways, which put
  // seat five seven tiles from camp with nobody in sight. It is a seat index
  // now, ringing out from the fire — which is unwalkable, so nobody lands in it.
  for (let seed = 1; seed <= 60; seed++) {
    const terrain = generateTerrain(seededRandom(seed));
    const spots = [];
    for (let i = 0; i < PARTY_SIZE; i++) spots.push(spawnTile(terrain, i * 2));

    for (const { x, y } of spots) {
      assert.ok(walkableAt(terrain, [], x, y), `seed ${seed} spawned a player in a wall`);
      assert.ok(!(x === CAMP_X && y === CAMP_Y), `seed ${seed} spawned a player in the fire`);
      const ring = Math.max(Math.abs(x - CAMP_X), Math.abs(y - CAMP_Y));
      assert.ok(ring <= CAMP_RADIUS, `seed ${seed} spawned a player ${ring} tiles from the fire`);
    }
    const distinct = new Set(spots.map(s => `${s.x},${s.y}`));
    assert.equal(distinct.size, spots.length, `seed ${seed} sat two players on one tile`);

    // And they can all reach each other, or the party opens the round split up.
    for (const spot of spots.slice(1)) {
      assert.ok(pathTo(terrain, [], spots[0], spot) !== null,
        `seed ${seed} spawned a player nobody can walk to`);
    }
  }
});

test('the camp does not consume the generator', () => {
  // The stamp must not call random(), or every existing room code would render
  // a different ruin everywhere else on the map.
  for (const code of ['QF7K', 'ZZ42', 'AB12']) {
    const a = generateTerrain(seededRandom(seedFromCode(code)));
    const b = generateTerrain(seededRandom(seedFromCode(code)));
    assert.deepEqual(a, b, `${code} did not generate the same terrain twice`);
  }
});

/* --------------------------------------------------------------- phases --- */

test('readyState waits for the connected and no one else', () => {
  const players = [
    { connected: true, ready: true },
    { connected: true, ready: false },
    { connected: false, ready: false },
  ];
  assert.deepEqual(readyState(players), { ready: 1, total: 2, all: false });

  players[1].ready = true;
  assert.deepEqual(readyState(players), { ready: 2, total: 2, all: true },
    'a disconnected player should not hold the party in the build phase');
});

test('readyState does not surge an empty room', () => {
  assert.equal(readyState([]).all, false);
  assert.equal(readyState([{ connected: false, ready: true }]).all, false);
  assert.equal(readyState(undefined).all, false);
});

test('isBuildPhase still accepts the name the deployed room sends', () => {
  assert.ok(isBuildPhase(PHASES.build));
  assert.ok(isBuildPhase('playing'), 'the room says "playing" until it is updated');
  assert.ok(!isBuildPhase(PHASES.combat));
  assert.ok(!isBuildPhase(PHASES.lobby));
  assert.ok(!isBuildPhase(PHASES.over));
});

test('every site has room for a base, not just loose buildable tiles', () => {
  // The generator is random, so this is the promise it has to keep. A site
  // that rolls three pockets of twenty tiles is not somewhere a base goes.
  for (let seed = 1; seed <= 120; seed++) {
    const terrain = generateTerrain(seededRandom(seed));
    const area = largestBuildableArea(terrain);
    assert.ok(area >= BASE_ROOM,
      `seed ${seed} left a largest buildable pocket of ${area}, under BASE_ROOM ${BASE_ROOM}`);
  }
});

test('largestBuildableArea counts one pocket, not every tile', () => {
  // A map split down the middle by water has half the buildable tiles it
  // looks like it has, and that is the number a builder cares about.
  const terrain = new Array(MAP_W * MAP_H).fill('grass');
  for (let y = 0; y < MAP_H; y++) terrain[y * MAP_W + Math.floor(MAP_W / 2)] = 'water';
  const area = largestBuildableArea(terrain);
  const buildable = terrain.filter((k) => TERRAIN[k].build).length;
  assert.ok(area < buildable, 'a wall down the middle should split the area');
  assert.equal(area, Math.floor(MAP_W / 2) * MAP_H);
});

/* ------------------------------------------------------------- the engineer */

test('every salvage kind can be drawn and picked', () => {
  for (const [id, item] of Object.entries(SALVAGE)) {
    assert.ok(SALVAGE_ART[id], `salvage "${id}" has no art`);
    assert.ok(PALETTE[item.colour], `salvage "${id}" has colour "${item.colour}"`);
    assert.ok(item.rarity > 0, `salvage "${id}" must have a positive rarity weight`);
    assert.equal(typeof item.note, 'string');
  }
  for (let i = 0; i < 200; i++) {
    assert.ok(SALVAGE[salvageFor(i / 200)], `roll ${i / 200} produced nothing real`);
  }
});

test('the two resource pools do not overlap', () => {
  // The whole point of salvage is that it is not a herb. An id in both tables
  // would make "can the Alchemist brew with this" a real question.
  for (const id of Object.keys(SALVAGE)) {
    assert.ok(!MATERIALS[id], `"${id}" is in both MATERIALS and SALVAGE`);
  }
});


test('every combat action does something the engine implements', () => {
  for (const [id, action] of Object.entries(COMBAT_ACTIONS)) {
    assert.equal(typeof action.name, 'string', `action "${id}" needs a name`);
    assert.ok(EFFECT_KINDS.includes(action.effect.kind),
      `action "${id}" has effect kind "${action.effect.kind}", which the engine does not implement`);
    // `draws` cards carry a zero and are priced off the standing works — see
    // `cardEffect`. What has to be positive is what they turn into, so they
    // are checked against a line rather than against their own face. `hold`
    // has no amount at all: it lands on the room, not on a body.
    if (action.draws) {
      assert.ok(cardEffect(id, { [action.draws]: 1 }).amount > 0,
        `action "${id}" draws "${action.draws}" and still comes out at nothing`);
    } else if (action.effect.kind !== 'hold') {
      assert.ok(action.effect.amount > 0, `action "${id}" must do a positive amount`);
    }
  }
  for (const id of BASE_ACTIONS) {
    assert.ok(COMBAT_ACTIONS[id], `base action "${id}" does not exist`);
  }
});



test('missingForBuilding reports the shortfall, not just that there is one', () => {
  assert.deepEqual(missingForBuilding('trellis', { screw: 5 }), {});
  assert.deepEqual(missingForBuilding('trellis', { screw: 2 }), { screw: 3 });
  assert.deepEqual(missingForBuilding('press', {}), { coil: BUILDINGS.press.costs.coil });
  assert.equal(missingForBuilding('not-a-building', {}), null);
});



test('canBuildAt refuses water, rubble, occupied tiles and standing herbs', () => {
  const terrain = new Array(MAP_W * MAP_H).fill('grass');
  terrain[0] = 'water';
  terrain[1] = 'rubble';
  const buildings = [{ id: 'trellis', x: 2, y: 0 }];
  const nodes = [
    { id: 'n0', x: 3, y: 0, material: 'sunpetal', taken: false },
    { id: 'n1', x: 4, y: 0, material: 'sunpetal', taken: true },
  ];

  assert.equal(canBuildAt(terrain, buildings, nodes, 0, 0), false, 'built on water');
  assert.equal(canBuildAt(terrain, buildings, nodes, 1, 0), false, 'built on rubble');
  assert.equal(canBuildAt(terrain, buildings, nodes, 2, 0), false, 'built on a building');
  assert.equal(canBuildAt(terrain, buildings, nodes, 3, 0), false, 'paved over a herb');
  assert.equal(canBuildAt(terrain, buildings, nodes, 4, 0), true, 'a gathered herb should free its tile');
  assert.equal(canBuildAt(terrain, buildings, nodes, 5, 0), true);
  assert.equal(canBuildAt(terrain, buildings, nodes, -1, 0), false, 'built off the map');
});

test('salvage after combat is what the crew picked up, and nothing else', () => {
  /* Buildings used to pay an income and no longer do. Every one of them now
   * buys a standing payout instead — a line the party is paid every round, or
   * somebody else's build phase made bigger — so a building that also handed
   * back the salvage it cost would be paying twice for one tile.
   *
   * Which leaves the crew's share as the whole of the after-combat draw, and
   * `cls.salvage` as the only thing that decides it. */
  const players = [
    { classId: 'engineer', down: false },
    { classId: 'alchemist', down: false },
  ];
  const drawn = salvageAfterCombat(players, [{ id: 'trellis', x: 1, y: 1 }], seededRandom(3));

  const total = Object.values(drawn).reduce((a, b) => a + b, 0);
  assert.equal(total, classById('engineer').salvage,
    'the draw should be the engineer’s share and the alchemist’s nothing');
  for (const id of Object.keys(drawn)) assert.ok(SALVAGE[id], `drew "${id}", which is not salvage`);
});

test('a downed engineer draws nothing, and a party without one draws nothing', () => {
  assert.deepEqual(salvageAfterCombat([{ classId: 'engineer', down: true }], [], seededRandom(1)), {});
  assert.deepEqual(salvageAfterCombat([{ classId: 'alchemist', down: false }], [], seededRandom(1)), {});
  assert.deepEqual(salvageAfterCombat([], [], seededRandom(1)), {});
});

test('adding and spending salvage does not mutate the pool it was given', () => {
  const pool = { screw: 5 };
  assert.deepEqual(addSalvage(pool, { screw: 2, coil: 1 }), { screw: 7, coil: 1 });
  assert.deepEqual(spendSalvage(pool, { screw: 2 }), { screw: 3 });
  assert.deepEqual(pool, { screw: 5 }, 'the original pool was written to');
});

/* ---------------------------------------------------------------- the deck */

/* Draw three, play one, discard the hand. The room deals, so what these guard
 * is that dealing is pure and repeatable: a client that shuffled for itself
 * would hold cards the room never gave it.
 */

test('every card is a real effect with an icon to draw it', () => {
  for (const [id, card] of Object.entries(CARDS)) {
    const where = `card "${id}"`;
    assert.ok(typeof card.name === 'string' && card.name.length, `${where}: needs a name`);
    assert.ok(CARD_ART[card.kind], `${where}: kind "${card.kind}" has no icon`);
    assert.ok(EFFECT_KINDS.includes(card.effect.kind),
      `${where}: effect kind "${card.effect.kind}" is not one the engine implements`);
    if (card.draws) {
      assert.ok(worksFrom([]).hasOwnProperty(card.draws),
        `${where}: draws "${card.draws}", which is not a line the works pay`);
      assert.ok(cardEffect(id, { [card.draws]: 1 }).amount > 0,
        `${where}: draws a line and still comes out at nothing`);
    } else if (card.effect.kind !== 'hold') {
      assert.ok(card.effect.amount > 0, `${where}: must do a positive amount`);
    }
    // A card belongs to a class, to a building, or to everybody — exactly one.
    // `granted` is the fifth owner flag: a card that is never dealt by a class
    // and never starts in a deck, only put into one by another card.
    const owners = [card.classId, card.fromBuilding, card.universal, card.brewed, card.granted].filter(Boolean).length;
    assert.equal(owners, 1,
      `${where}: must come from a class, a building, a brew, or everybody — not ${owners}`);
    if (card.brewed) assert.ok(card.consumed, `${where}: brewed cards must be consumed on play`);
    if (card.classId) assert.ok(classById(card.classId), `${where}: unknown class "${card.classId}"`);
    if (card.fromBuilding) assert.ok(BUILDINGS[card.fromBuilding], `${where}: unknown building "${card.fromBuilding}"`);
    assert.equal(typeof card.note, 'string', `${where}: needs a note`);
  }
});

test('every live class opens with a deck of cards that exist', () => {
  for (const cls of playableClasses()) {
    const spec = STARTING_DECKS[cls.id];
    assert.ok(spec, `class "${cls.id}" has no starting deck`);
    for (const [cardId, count] of Object.entries(spec)) {
      assert.ok(CARDS[cardId], `"${cls.id}" opens with unknown card "${cardId}"`);
      assert.equal(CARDS[cardId].classId, cls.id,
        `"${cls.id}" opens with "${cardId}", which belongs to ${CARDS[cardId].classId}`);
      assert.ok(Number.isInteger(count) && count > 0, `"${cls.id}": bad count for ${cardId}`);
    }
  }
});

test('every deck can attack and can defend, and is big enough to draw from', () => {
  for (const cls of playableClasses()) {
    const deck = buildDeck(cls.id);
    assert.ok(deck.length >= HAND_SIZE,
      `"${cls.id}" opens with ${deck.length} cards and cannot fill a hand of ${HAND_SIZE}`);
    const kinds = new Set(deck.map((id) => CARDS[id].kind));
    assert.ok(kinds.has('attack'), `"${cls.id}" has no way to hurt anything`);
    assert.ok(kinds.has('defend'), `"${cls.id}" has no way to survive anything`);
  }
});

test('buildDeck expands the counts and refuses to invent a deck', () => {
  const deck = buildDeck('wizard');
  assert.equal(deck.length, 10);
  assert.equal(deck.filter((id) => id === 'spark').length, 4);
  assert.equal(deck.filter((id) => id === 'sign').length, 2);
  assert.equal(deck.filter((id) => id === 'fireball').length, 2);
  assert.equal(deck.filter((id) => id === 'rune').length, 1);
  assert.equal(deck.filter((id) => id === 'nova').length, 1);
  assert.deepEqual(buildDeck('nobody'), []);
});

test('the same seed shuffles the same way, and shuffling loses nothing', () => {
  const deck = buildDeck('alchemist');
  const a = shuffle(deck, seededRandom(9));
  const b = shuffle(deck, seededRandom(9));
  assert.deepEqual(a, b, 'one seed dealt two different decks');
  assert.notDeepEqual(shuffle(deck, seededRandom(10)), a, 'two seeds dealt the same deck');

  // Same cards, different order — a shuffle that drops a card is a shuffle
  // that quietly changes the deck a player built.
  assert.deepEqual([...a].sort(), [...deck].sort());
  assert.deepEqual(deck, buildDeck('alchemist'), 'shuffle wrote to the deck it was given');
});

test('drawing takes from the top and leaves the rest', () => {
  const { hand, deck, discard } = draw(['a', 'b', 'c', 'd'], [], seededRandom(1));
  assert.deepEqual(hand, ['a', 'b', 'c']);
  assert.deepEqual(deck, ['d']);
  assert.deepEqual(discard, []);
});

test('an empty deck reshuffles the discard rather than dealing a short hand', () => {
  const { hand, deck, discard } = draw([], ['x', 'y', 'z', 'w'], seededRandom(4));
  assert.equal(hand.length, HAND_SIZE, 'the discard should have been reshuffled in');
  assert.deepEqual([...hand, ...deck].sort(), ['w', 'x', 'y', 'z'], 'a card went missing in the reshuffle');
  assert.deepEqual(discard, [], 'the discard should be empty once it has been shuffled back');
});

test('a deck part-drawn spills into the discard mid-hand', () => {
  const { hand, deck, discard } = draw(['a'], ['b', 'c'], seededRandom(2));
  assert.equal(hand.length, 3);
  assert.equal(hand[0], 'a', 'the last card of the deck should come first');
  assert.deepEqual([...hand].sort(), ['a', 'b', 'c']);
  assert.deepEqual(deck, []);
  assert.deepEqual(discard, []);
});

test('with nothing anywhere the hand comes back short, not broken', () => {
  const { hand, deck, discard } = draw([], [], seededRandom(1));
  assert.deepEqual(hand, []);
  assert.deepEqual(deck, []);
  assert.deepEqual(discard, []);
});

test('drawing does not write to the piles it was handed', () => {
  const deck = ['a', 'b', 'c', 'd'];
  const discard = ['e'];
  draw(deck, discard, seededRandom(1));
  assert.deepEqual(deck, ['a', 'b', 'c', 'd'], 'the deck was mutated');
  assert.deepEqual(discard, ['e'], 'the discard was mutated');
});

test('a played hand goes to the discard whole, unplayed cards included', () => {
  // The two you did not play cost you as much as the one you did: that is what
  // stops a hand being carried across turns.
  assert.deepEqual(discardHand(['x'], ['a', 'b', 'c']), ['x', 'a', 'b', 'c']);
  assert.deepEqual(discardHand([], []), []);
  assert.deepEqual(discardHand(undefined, undefined), []);
});

test('a deck cycles rather than running out', () => {
  // Ten cards, three a turn: the fight should never reach a turn with no
  // hand, however long it runs.
  let deck = shuffle(buildDeck('engineer'), seededRandom(5));
  let discard = [];
  const random = seededRandom(6);
  for (let turn = 0; turn < 40; turn++) {
    const drawn = draw(deck, discard, random);
    assert.equal(drawn.hand.length, HAND_SIZE, `turn ${turn} dealt ${drawn.hand.length} cards`);
    discard = discardHand(drawn.discard, drawn.hand);
    deck = drawn.deck;
    assert.equal(deck.length + discard.length, buildDeck('engineer').length,
      `turn ${turn} lost or gained a card`);
  }
});

test('cardById refuses nonsense', () => {
  assert.equal(cardById('spark').name, 'Spark');
  assert.equal(cardById('not-a-card'), null);
});



test('every deck holds the universal cards', () => {
  assert.ok(UNIVERSAL_CARDS.length, 'nothing is universal, so a deck could have no floor');
  for (const cls of playableClasses()) {
    const deck = deckFor(cls.id);
    for (const id of UNIVERSAL_CARDS) assert.ok(deck.includes(id), `"${cls.id}" is missing "${id}"`);
  }
});

test('everybody can swing something, and Strike is the floor of what they swing', () => {
  // The reason Strike exists: without it a party that built economy and drew no
  // attack could only hold, which made a thin opening round unwinnable rather
  // than hard.
  assert.ok(UNIVERSAL_CARDS.includes('strike'), 'Strike must be in every deck');
  assert.equal(CARDS.strike.effect.kind, 'strike');
  for (const cls of playableClasses()) {
    assert.ok(deckFor(cls.id).includes('strike'), `"${cls.id}" cannot swing anything`);
  }
  // And it is the floor: nothing in the game hits for less than a fist. Note
  // that the Alchemist's Acid Flask ties it at 3 — a class attack that is now
  // exactly the card everybody already holds. That is a balance question for
  // whoever owns the Alchemist, not something this test should hide, so it
  // asserts the floor and leaves the tie visible.
  for (const [id, card] of Object.entries(CARDS)) {
    if (card.effect.kind !== 'strike') continue;
    // A drawn strike has no number of its own — the Sunlance is worth DRAW
    // times what the heliostat pays, so the floor is checked against the
    // smallest line that can exist rather than against a zero on the card.
    const amount = card.draws ? cardEffect(id, { [card.draws]: 1 }).amount : card.effect.amount;
    assert.ok(amount >= CARDS.strike.effect.amount,
      `"${id}" hits for ${amount}, less than a fist`);
  }
});

test('an action says which pool it spends, and greys itself when the pool is dry', () => {
  // Every economy, checked through the one function the room and the client
  // both call. A price nobody can read off the face of an option is a price
  // the player cannot plan against.
  assert.equal(actionCost('spark'), null, 'a basic is free');
  assert.deepEqual(actionCost('fireball'), { pool: 'charges', amount: CARDS.fireball.chargeCost });
  assert.deepEqual(actionCost('boltgun'), { pool: 'power', amount: CARDS.boltgun.powerCost });
  assert.deepEqual(actionCost('legup'), { pool: 'hp', amount: CARDS.legup.hpCost });
  assert.deepEqual(actionCost('tonic'), { pool: 'stock', amount: 1 });
  assert.deepEqual(actionCost('ringbark'), { pool: 'uses', amount: 1 });

  assert.equal(actionReady('spark', {}).ok, true, 'a basic is always takeable');
  assert.equal(actionReady('fireball', { charges: 0 }).why, 'charges');
  assert.equal(actionReady('fireball', { charges: 9 }).ok, true);
  assert.equal(actionReady('boltgun', { power: 0 }).why, 'power');
  assert.equal(actionReady('tonic', { stock: { tonic: 0 } }).why, 'empty');
  assert.equal(actionReady('ringbark', { uses: { ringbark: 0 } }).why, 'spent');

  // An action must never be the thing that kills you: the last point is never
  // spendable, whatever the price says.
  assert.equal(actionReady('legup', { hp: CARDS.legup.hpCost }).why, 'hp');
  assert.equal(actionReady('legup', { hp: CARDS.legup.hpCost + 1 }).ok, true);
});

test('the combat lane is shorter than the site, and still a lane', () => {
  assert.ok(COMBAT_H > 0 && COMBAT_H < MAP_H,
    'combat should be a band of the map, not the whole field');
  const terrain = generateCombatTerrain(seededRandom(3));
  assert.equal(terrain.length, MAP_W * COMBAT_H);
  for (const kind of terrain) assert.ok(TERRAIN[kind], `combat terrain has "${kind}"`);
});

test('combat terrain stays inside its own shorter grid', () => {
  // blob() walks off the edges by design; with a height that is not MAP_H it
  // must clip to the lane rather than wrapping into the next row.
  for (let seed = 1; seed <= 30; seed++) {
    const terrain = generateCombatTerrain(seededRandom(seed));
    assert.equal(terrain.length, MAP_W * COMBAT_H, `seed ${seed} changed the grid size`);
    assert.equal(terrain.filter((k) => k === undefined).length, 0, `seed ${seed} left a hole`);
  }
});

/* -------------------------------------------------------------- movement -- */

/* Point, click, walk. The room has to be able to check that a click was
 * reachable rather than trusting a client that says it walked there, so the
 * route is a pure function over the same terrain both ends hold.
 */

const openSite = () => new Array(MAP_W * MAP_H).fill('grass');

test('a route is the steps after where you stand', () => {
  const terrain = openSite();
  const path = pathTo(terrain, [], { x: 2, y: 2 }, { x: 5, y: 2 });
  assert.deepEqual(path, [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }]);
  assert.equal(path.length, 3, 'four-way distance on open ground is the manhattan distance');
});

test('standing where you clicked is a route of no steps, not a failure', () => {
  assert.deepEqual(pathTo(openSite(), [], { x: 4, y: 4 }, { x: 4, y: 4 }), []);
});

test('a route walks around water rather than through it', () => {
  const terrain = openSite();
  for (let y = 0; y < MAP_H - 1; y++) terrain[y * MAP_W + 5] = 'water';  // wall with a gap at the bottom
  const path = pathTo(terrain, [], { x: 4, y: 0 }, { x: 6, y: 0 });
  assert.ok(path, 'the gap at the bottom should make this reachable');
  for (const step of path) {
    assert.notEqual(terrain[step.y * MAP_W + step.x], 'water', 'the route crossed water');
  }
  assert.ok(path.length > 2, 'going around should cost more than going straight through');
});

test('no way across is null, which is an answer', () => {
  const terrain = openSite();
  for (let y = 0; y < MAP_H; y++) terrain[y * MAP_W + 5] = 'water';   // wall, no gap
  assert.equal(pathTo(terrain, [], { x: 4, y: 3 }, { x: 6, y: 3 }), null);
});

test('you walk around a building, not through it', () => {
  const terrain = openSite();
  const buildings = [{ id: 'pylon', x: 3, y: 2 }];
  assert.equal(walkableAt(terrain, buildings, 3, 2), false);
  assert.equal(pathTo(terrain, buildings, { x: 2, y: 2 }, { x: 3, y: 2 }), null,
    'a tile with a building on it is not somewhere to stand');
  const around = pathTo(terrain, buildings, { x: 2, y: 2 }, { x: 4, y: 2 });
  assert.ok(around.every((s) => !(s.x === 3 && s.y === 2)), 'the route went through the building');
});

test('a route refuses ground nobody can stand on, and the edge of the world', () => {
  const terrain = openSite();
  terrain[2 * MAP_W + 3] = 'rubble';
  assert.equal(pathTo(terrain, [], { x: 2, y: 2 }, { x: 3, y: 2 }), null, 'routed onto rubble');
  assert.equal(pathTo(terrain, [], { x: 2, y: 2 }, { x: -1, y: 2 }), null, 'routed off the map');
  assert.equal(pathTo(terrain, [], { x: 2, y: 2 }, { x: MAP_W, y: 2 }), null, 'routed off the map');
  assert.equal(pathTo(terrain, [], null, { x: 1, y: 1 }), null);
});

test('every route is a legal walk: one tile at a time, all of it walkable', () => {
  // A path that teleports or clips a corner is the bug that looks like lag.
  for (let seed = 1; seed <= 20; seed++) {
    const terrain = generateTerrain(seededRandom(seed));
    const from = spawnTile(terrain);
    for (let i = 0; i < terrain.length; i += 37) {
      const to = { x: i % MAP_W, y: Math.floor(i / MAP_W) };
      const path = pathTo(terrain, [], from, to);
      if (!path) continue;
      let at = from;
      for (const step of path) {
        const jump = Math.abs(step.x - at.x) + Math.abs(step.y - at.y);
        assert.equal(jump, 1, `seed ${seed}: route jumped ${jump} tiles`);
        assert.ok(walkableAt(terrain, [], step.x, step.y), `seed ${seed}: route crossed bad ground`);
        at = step;
      }
      assert.deepEqual(at, to, `seed ${seed}: route did not arrive`);
    }
  }
});

test('every herb on a generated site can actually be walked to', () => {
  // A Cellsap on an island is a node the player can see and never reach.
  for (let seed = 1; seed <= 30; seed++) {
    const { terrain, nodes } = generateMap(seededRandom(seed));
    const from = spawnTile(terrain);
    for (const node of nodes) {
      assert.ok(pathTo(terrain, [], from, { x: node.x, y: node.y }),
        `seed ${seed}: ${node.material || node.kind} at ${node.x},${node.y} is unreachable from the spawn`);
    }
  }
});

test('every site grows something for every recipe', () => {
  // Six nodes drawn purely by weight regularly grew a site with no Dewglass and
  // no Rustbloom, and every recipe needs one or the other — a round where
  // nothing can be brewed is the worst thing scarcity can do.
  for (let seed = 1; seed <= 60; seed++) {
    const { nodes } = generateMap(seededRandom(seed));
    const grown = new Set(nodes.filter((n) => n.kind === 'herb').map((n) => n.material));
    for (const [id, recipe] of Object.entries(RECIPES)) {
      const missing = Object.keys(recipe.costs).filter((m) => !grown.has(m));
      assert.equal(missing.length, 0,
        `seed ${seed}: "${id}" needs ${missing.join(' and ')}, which the site did not grow`);
    }
  }
});

test('a site grows enough for some brewing and never all of it', () => {
  const gather = Math.max(...CLASSES.map((c) => c.gather));
  for (let seed = 1; seed <= 40; seed++) {
    const { nodes } = generateMap(seededRandom(seed));
    const stash = {};
    for (const n of nodes.filter((x) => x.kind === 'herb')) {
      stash[n.material] = (stash[n.material] || 0) + gather;
    }
    const affordable = Object.keys(RECIPES).filter((id) => brew(id, stash));
    assert.ok(affordable.length > 0, `seed ${seed}: a full sweep brews nothing`);

    // Sweeping the whole site must not pay for one of everything, or there is
    // no decision left in which herb to walk to.
    let pool = stash;
    let brewed = 0;
    for (const id of Object.keys(RECIPES)) {
      const made = brew(id, pool);
      if (!made) continue;
      pool = made.stash;
      brewed += 1;
    }
    assert.ok(brewed < Object.keys(RECIPES).length,
      `seed ${seed}: a full sweep brewed all ${brewed} recipes — nothing was given up`);
  }
});

/* ------------------------------------------------------------ the engineer */

/* Two buildings and one gun. Power is what a panel makes, a fight spends and
 * the end of it throws away; the lines turn salvage into a standing payout
 * rather than more ground.
 */

test('every building is buildable and gives something for the tile', () => {
  for (const [id, building] of Object.entries(BUILDINGS)) {
    const where = `building "${id}"`;
    assert.equal(typeof building.name, 'string', `${where}: needs a name`);
    assert.equal(typeof building.note, 'string', `${where}: needs a note`);
    assert.ok(BUILDING_ART[building.art], `${where}: art "${building.art}" does not exist`);
    assert.ok(Object.keys(building.costs).length, `${where}: must cost something`);

    for (const [resource, n] of Object.entries(building.costs)) {
      assert.ok(SALVAGE[resource], `${where}: costs "${resource}", which is not salvage`);
      assert.ok(Number.isInteger(n) && n > 0, `${where}: cost of ${resource} must be positive`);
    }

    // A building that pays no line, carries no power and grants nobody
    // anything is a tile you spent for the view.
    const gives = (building.power || 0) > 0
      || (building.pays || 0) > 0
      || (building.carry || 0) > 0
      || building.perPanels
      || Object.keys(building.grants || {}).length > 0;
    assert.ok(gives, `${where}: gives nothing back`);

    if (building.line) {
      assert.ok(worksFrom([]).hasOwnProperty(building.line),
        `${where}: feeds "${building.line}", which is not a line the works pay`);
    }
  }
});

test('every placement rule names something that exists', () => {
  // A rule pointing at a building or a terrain kind that is not there would
  // refuse forever, and the refusal string would read as a crash.
  for (const [id, building] of Object.entries(BUILDINGS)) {
    const rule = building.place;
    if (!rule) continue;
    const where = `building "${id}"`;
    if (rule.beside) assert.ok(BUILDINGS[rule.beside], `${where}: must touch "${rule.beside}", which is not a building`);
    if (rule.near) assert.ok(TERRAIN[rule.near], `${where}: must touch "${rule.near}", which is not terrain`);
    for (const t of rule.on || []) assert.ok(TERRAIN[t], `${where}: must stand on "${t}", which is not terrain`);
    if (rule.onOrNear) assert.ok(TERRAIN[rule.onOrNear], `${where}: names "${rule.onOrNear}", which is not terrain`);
    for (const t of rule.clearOf || []) assert.ok(TERRAIN[t], `${where}: must avoid "${t}", which is not terrain`);
    for (const bid of Object.keys(rule.needs || {})) {
      assert.ok(BUILDINGS[bid], `${where}: needs "${bid}", which is not a building`);
    }
    // Every tier above the first hangs off the one below it, so a line is a
    // run of touching tiles rather than three things scattered across a ruin.
    if (rule.beside) assert.ok(BUILDINGS[rule.beside].line === building.line || !building.line,
      `${where}: touches a building on a different line`);
  }
});

test('placement says why, and the reason is a sentence a player can act on', () => {
  const terrain = new Array(MAP_W * MAP_H).fill('floor');
  const at = (x, y) => x + y * MAP_W;
  terrain[at(10, 3)] = 'water';
  terrain[at(20, 3)] = 'grass';
  terrain[at(20, 4)] = 'grass';
  const ctx = (x, y, buildings = []) => ({ terrain, buildings, nodes: [], x, y });

  // No rule at all: a panel stands anywhere the ground allows.
  assert.equal(placeRefusal('panel', ctx(5, 5)), null);
  assert.ok(placeRefusal('panel', ctx(10, 3)), 'a panel cannot stand in the meltwater');

  // Terrain the tile has to be touching.
  assert.equal(placeRefusal('cistern', ctx(11, 3)), null, 'beside the water is where a cistern goes');
  assert.ok(placeRefusal('cistern', ctx(5, 5)), 'and nowhere else');

  // Terrain the tile has to be, or be against.
  assert.equal(placeRefusal('trellis', ctx(20, 4)), null);
  assert.equal(placeRefusal('trellis', ctx(20, 5)), null, 'against the overgrowth counts');
  assert.ok(placeRefusal('trellis', ctx(5, 5)), 'and bare floor does not');

  // A tier hangs off the tier below it.
  const trellis = [{ id: 'trellis', x: 20, y: 4 }];
  assert.equal(placeRefusal('livingwall', ctx(21, 4, trellis)), null);
  assert.ok(placeRefusal('livingwall', ctx(25, 4, trellis)), 'a wall away from its trellis is not a wall');
  assert.ok(placeRefusal('livingwall', ctx(21, 5, [])), 'and with no trellis at all it is nothing');

  // A count, rather than a neighbour.
  const panels = [{ id: 'panel', x: 1, y: 1 }, { id: 'panel', x: 2, y: 1 }];
  assert.ok(placeRefusal('flywheel', ctx(1, 2, panels)), 'two panels is not three');
  const three = [...panels, { id: 'panel', x: 3, y: 1 }];
  assert.equal(placeRefusal('flywheel', ctx(1, 2, three)), null);

  // The camp, and the sky.
  assert.equal(placeRefusal('carillon', ctx(CAMP_X + 1, CAMP_Y + 1)), null);
  assert.ok(placeRefusal('carillon', ctx(1, 1)), 'a bell belongs where people are');
  const shaded = new Array(MAP_W * MAP_H).fill('floor');
  shaded[at(6, 5)] = 'tree';
  assert.ok(placeRefusal('heliostat', { terrain: shaded, buildings: [], nodes: [], x: 5, y: 5 }),
    'a mirror under a sapling is a mirror looking at a sapling');

  assert.ok(placeRefusal('not-a-building', ctx(5, 5)));
  assert.equal(canPlace('panel', ctx(5, 5)), true);
  assert.equal(canPlace('panel', ctx(10, 3)), false);
});

test('a building can be walked to a better tile, for nothing', () => {
  /* Free and build-phase only, on the precedent the scriptorium sets: a spell
   * is re-socketed at the desk, and rearranging what you have already paid for
   * should not cost twice. The single most valuable thing this verb does is
   * walk a panel into the run beside another one — same salvage, twice the
   * power — which is why it exists at all. */
  const terrain = new Array(MAP_W * MAP_H).fill('floor');
  const ctx = (buildings, x, y) => ({ terrain, buildings, nodes: [], x, y });

  const apart = [{ id: 'panel', x: 1, y: 1 }, { id: 'panel', x: 8, y: 8 }];
  assert.equal(powerFrom(apart), 2, 'two panels that cannot see each other');
  assert.equal(moveRefusal(1, ctx(apart, 2, 1)), null);

  const together = apart.map((b, i) => (i === 1 ? { ...b, x: 2, y: 1 } : b));
  assert.equal(powerFrom(together), 4, 'and the same two on one rail');

  // Onto itself is a put-back, not a refusal.
  assert.equal(moveRefusal(0, ctx(apart, 1, 1)), null);
  // Onto its neighbour is not.
  assert.ok(moveRefusal(0, ctx(apart, 8, 8)), 'two buildings on one tile');
  assert.ok(moveRefusal(9, ctx(apart, 3, 3)), 'nothing at that index');
  assert.equal(canMove(1, ctx(apart, 2, 1)), true);
});

test('a move is refused where a placement would be', () => {
  const terrain = new Array(MAP_W * MAP_H).fill('floor');
  const at = (x, y) => x + y * MAP_W;
  terrain[at(4, 4)] = 'water';
  terrain[at(9, 9)] = 'grass';
  const ctx = (buildings, x, y) => ({ terrain, buildings, nodes: [], x, y });

  // The cistern still has to touch water wherever it goes.
  const cistern = [{ id: 'cistern', x: 5, y: 4 }];
  assert.equal(moveRefusal(0, ctx(cistern, 4, 5)), null, 'still against the water');
  assert.ok(moveRefusal(0, ctx(cistern, 20, 2)), 'and a cistern in a field is a tank');

  // The cap does not count the thing in your hands: a Trellis moving is not a
  // second Trellis.
  const trellis = [{ id: 'trellis', x: 9, y: 10 }];
  assert.equal(moveRefusal(0, ctx(trellis, 10, 9)), null,
    'a trellis moving beside the overgrowth is the same trellis');
});

test('a move may not strand the tier hanging off it', () => {
  /* Without this every adjacency rule in the game is decoration: place the
   * Trellis, hang the Living Wall off it, then walk the Trellis to the far
   * side of the site and keep both. The tiers have to stay a run of touching
   * tiles, or they were never a shape. */
  const terrain = new Array(MAP_W * MAP_H).fill('grass');
  const ctx = (buildings, x, y) => ({ terrain, buildings, nodes: [], x, y });
  const line = [{ id: 'trellis', x: 5, y: 5 }, { id: 'livingwall', x: 6, y: 5 }];

  const why = moveRefusal(0, ctx(line, 20, 5));
  assert.ok(why, 'the trellis walked away from its own wall');
  assert.match(why, /Living Wall/, 'and it should say what it left behind');

  // A step that keeps them touching is fine.
  assert.equal(moveRefusal(0, ctx(line, 6, 4)), null, 'still touching, still a hedge');

  // And the wall itself may move anywhere the trellis still reaches.
  assert.equal(moveRefusal(1, ctx(line, 5, 6)), null);
  assert.ok(moveRefusal(1, ctx(line, 20, 20)), 'a wall away from its trellis is not a wall');

  // The count rules are honoured the same way: a flywheel needs three panels
  // standing, and moving one of them does not change that.
  const rig = [
    { id: 'panel', x: 1, y: 1 }, { id: 'panel', x: 2, y: 1 }, { id: 'panel', x: 3, y: 1 },
    { id: 'flywheel', x: 1, y: 2 },
  ];
  assert.equal(moveRefusal(2, ctx(rig, 4, 1)), null, 'three panels are still three panels');
});

test('strandedIn finds every rule broken underneath a building', () => {
  const terrain = new Array(MAP_W * MAP_H).fill('grass');
  const sound = [{ id: 'trellis', x: 5, y: 5 }, { id: 'livingwall', x: 6, y: 5 }];
  assert.deepEqual(strandedIn({ terrain, buildings: sound, nodes: [] }), []);

  const broken = [{ id: 'trellis', x: 5, y: 5 }, { id: 'livingwall', x: 20, y: 5 }];
  const found = strandedIn({ terrain, buildings: broken, nodes: [] });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'livingwall');

  assert.deepEqual(strandedIn({ terrain, buildings: [], nodes: [] }), []);
  assert.deepEqual(strandedIn({ terrain, buildings: null, nodes: [] }), []);
});

test('a panel is worth more with a neighbour, and the array is the sum', () => {
  // The one line that is not a plain count, and the reason the map is a
  // puzzle: an array wants a contiguous run and a ruin is full of holes.
  assert.equal(powerFrom([]), 0);
  assert.equal(powerFrom([{ id: 'panel', x: 1, y: 1 }]), 1, 'a lone panel is worth one');
  assert.equal(powerFrom([{ id: 'panel', x: 1, y: 1 }, { id: 'panel', x: 5, y: 5 }]), 2,
    'two panels that cannot see each other are two ones');
  assert.equal(powerFrom([{ id: 'panel', x: 1, y: 1 }, { id: 'panel', x: 2, y: 1 }]), 4,
    'and two on the same rail are two twos');
  assert.equal(powerFrom([{ id: 'panel', x: 1, y: 1 }, { id: 'panel', x: 2, y: 2 }]), 2,
    'a diagonal is not touching');

  // The Inverter reads the count, not the shape.
  const five = [0, 1, 2, 3, 4].map((i) => ({ id: 'panel', x: i, y: 0 }));
  assert.equal(powerFrom(five), 10);
  assert.equal(powerFrom([...five, { id: 'inverter', x: 0, y: 1 }]), 11, 'one more for every three panels');

  assert.equal(powerFrom([{ id: 'trellis', x: 1, y: 1 }]), 0, 'a hedge is not a generator');
  assert.equal(powerFrom([{ id: 'not-a-building', x: 1, y: 1 }]), 0);
});

test('every line pays what its tiers add up to, and nothing bleeds across', () => {
  const works = worksFrom([
    { id: 'trellis', x: 1, y: 1 }, { id: 'livingwall', x: 2, y: 1 },
    { id: 'carillon', x: 5, y: 5 },
    { id: 'cistern', x: 8, y: 8 }, { id: 'reedbed', x: 9, y: 8 },
  ]);
  assert.equal(works.ward, 2, 'two tiers of windbreak');
  assert.equal(works.might, 1);
  assert.equal(works.burn, 0, 'a line nobody built pays nothing');
  assert.equal(works.mend, BUILDINGS.cistern.pays + BUILDINGS.reedbed.pays);
  assert.equal(works.carry, 0);

  // The Flywheel is the only thing that keeps power across a fight.
  assert.equal(worksFrom([{ id: 'flywheel', x: 1, y: 1 }]).carry, BUILDINGS.flywheel.carry);
  assert.deepEqual(worksFrom([]), { array: 0, ward: 0, might: 0, burn: 0, mend: 0, carry: 0 });
  assert.deepEqual(worksFrom(null), { array: 0, ward: 0, might: 0, burn: 0, mend: 0, carry: 0 });
});

test('the cistern is the one line no ability can draw', () => {
  // Healing every round was simply the best thing a line could do. It pays
  // once, when the fight ends, and nothing can concentrate it — which is what
  // stops the mend line from turning into a spike.
  const drawn = Object.values(CARDS).map((c) => c.draws).filter(Boolean);
  assert.ok(drawn.includes('ward') && drawn.includes('might') && drawn.includes('burn'),
    'the three per-round lines should each have something that draws them');
  assert.equal(drawn.includes('mend'), false, 'nothing may draw the cistern');
  assert.equal(drawn.includes('array'), false, 'and nothing may draw the power itself');
});

test('what a drawn ability is worth is written on the map, not on the card', () => {
  const bare = { ward: 1 };
  const grown = { ward: 3 };
  assert.equal(cardEffect('closeranks', bare).amount, DRAW,
    'one tier of windbreak is one crew’s share');
  assert.equal(cardEffect('closeranks', grown).amount, 3 * DRAW,
    'and three tiers is three of them, off the same chip');
  assert.equal(cardEffect('closeranks', {}).amount, 0, 'with no line there is nothing to draw');

  // DRAW is the party size and that is the fiction: the whole crew's share of
  // one round, pulled through a single line. Flat, so it is worth exactly the
  // same alone as it is at a table of five.
  assert.equal(DRAW, PARTY_SIZE);

  // Untouched cards are untouched, and the table itself is never rewritten.
  assert.equal(cardEffect('wrench', { ward: 5 }).amount, CARDS.wrench.effect.amount);
  assert.equal(CARDS.closeranks.effect.amount, 0, 'cardEffect mutated the card table');
  assert.equal(cardEffect('not-a-card'), null);
});

test('the engineer starts with two basics and buys the rest', () => {
  // CLASS_ACTIONS.engineer is empty, exactly as the Hauler's is. What he can
  // do in a fight is what the chips bought and the buildings allow.
  assert.deepEqual(actionsFor('engineer'), ['wrench', 'shore']);
  assert.equal(CARDS.jumper, undefined, 'the Stretcher revives for more, for a point of health');
  assert.equal(CARDS.bulwark, undefined, 'and the Rigging Tarp is the same guard, free');

  for (const [id, ability] of Object.entries(ABILITIES)) {
    const where = `ability "${id}"`;
    assert.ok(CARDS[id], `${where}: has no card behind it`);
    assert.equal(CARDS[id].classId, 'engineer', `${where}: is not the engineer's`);
    assert.ok(CARDS[id].ability, `${where}: the card is not flagged as one`);
    assert.ok(Number.isInteger(ability.chips) && ability.chips > 0, `${where}: must cost chips`);
    assert.equal(typeof ability.note, 'string', `${where}: needs a note`);
    if (ability.needs) assert.ok(BUILDINGS[ability.needs], `${where}: needs "${ability.needs}", which is not a building`);
  }
  assert.deepEqual(ABILITY_IDS, Object.keys(ABILITIES));
});

test('an ability needs the chips and the line it draws through', () => {
  const rich = { chip: 9 };
  const trellis = [{ id: 'trellis', x: 1, y: 1 }];

  // The Bolt Gun is the exception, and the reason the seat is playable on the
  // first build phase: a flat number off a bare panel, with nothing standing.
  assert.equal(abilityRefusal('boltgun', { salvage: rich, bought: [], buildings: [] }), null);
  assert.ok(canAfford({ chip: ABILITIES.boltgun.chips }, STARTING_SALVAGE),
    'the opening salvage must cover the one ability that needs no building');

  // Every other one is worth what its line pays, so it is not an ability until
  // there is a line.
  assert.ok(abilityRefusal('closeranks', { salvage: rich, bought: [], buildings: [] }),
    'learned with no windbreak to draw through');
  assert.equal(abilityRefusal('closeranks', { salvage: rich, bought: [], buildings: trellis }), null);

  assert.ok(abilityRefusal('closeranks', { salvage: { chip: 0 }, bought: [], buildings: trellis }),
    'learned without paying');
  assert.ok(abilityRefusal('closeranks', { salvage: rich, bought: ['closeranks'], buildings: trellis }),
    'learned twice');
  assert.ok(abilityRefusal('not-an-ability', { salvage: rich, bought: [], buildings: [] }));
});

test('the opening is a fork: power now, or a line to draw through later', () => {
  // Screws buy both halves of his combat — panels are the power to fire an
  // ability, lines are what the ability is worth — and there is never enough
  // for both. That is the decision, and it must exist on the first build
  // phase rather than arriving in round three.
  assert.ok(canAfford(BUILDINGS.panel.costs, STARTING_SALVAGE),
    'a Solar Panel must be affordable from the starting salvage');

  const firsts = ['trellis', 'carillon', 'heliostat', 'cistern'];
  for (const id of firsts) {
    assert.ok(canAfford(BUILDINGS[id].costs, STARTING_SALVAGE), `"${id}" is out of reach at the start`);
    const after = spendSalvage(STARTING_SALVAGE, BUILDINGS[id].costs);
    assert.ok(!canAfford(BUILDINGS.panel.costs, after),
      `a "${id}" first still leaves a panel — the opening is not a fork`);
  }

  // Two panels, or one line's first tier. Never both.
  const twoPanels = spendSalvage(spendSalvage(STARTING_SALVAGE, BUILDINGS.panel.costs), BUILDINGS.panel.costs);
  assert.equal(twoPanels.screw, 0, 'the array eats the whole opening');

  // And coil covers nothing at all, so the first community machine is always a
  // round away and always a decision.
  for (const id of ['press', 'glasshouse', 'barrow', 'windrow']) {
    assert.ok(!canAfford(BUILDINGS[id].costs, STARTING_SALVAGE), `"${id}" should not be free on round one`);
  }
});

test('only the panel may be built twice', () => {
  assert.equal(BUILDINGS.panel.max, undefined, 'every panel is more power, so they must not be capped');
  for (const [id, building] of Object.entries(BUILDINGS)) {
    if (id === 'panel') continue;
    assert.equal(building.max, 1, `"${id}" is uncapped, and a second one is a tile sink`);
  }

  const one = [{ id: 'trellis', x: 1, y: 1 }];
  assert.equal(canBuildMore('trellis', []), true);
  assert.equal(canBuildMore('trellis', one), false, 'a second trellis should be refused');
  assert.equal(canBuildMore('panel', [{ id: 'panel', x: 0, y: 0 }, { id: 'panel', x: 2, y: 0 }]), true);
  assert.equal(canBuildMore('not-a-building', []), false);
  assert.equal(buildingsOf(one, 'trellis'), 1);
});

test('the community buildings reach economies that are not his', () => {
  // The one role nobody else can occupy. Rune, Graft and Leg Up hand an ally
  // something for one round inside a fight; these four make somebody else's
  // build phase permanently bigger.
  const all = [
    { id: 'press', x: 1, y: 1 }, { id: 'glasshouse', x: 2, y: 1 },
    { id: 'barrow', x: 3, y: 1 }, { id: 'windrow', x: 4, y: 1 },
  ];
  assert.equal(grantsFrom(all, 'pages'), 1, 'the Wizard drafts more');
  assert.equal(grantsFrom(all, 'pot'), 1, 'the Alchemist harvests more');
  assert.equal(grantsFrom(all, 'pack'), 1, 'the Hauler carries more');
  assert.equal(grantsFrom(all, 'uses'), 1, 'the Grafter cuts more');
  assert.equal(grantsFrom(all, 'nothing'), 0);
  assert.equal(grantsFrom([], 'pages'), 0);
  assert.equal(grantsFrom(null, 'pages'), 0);

  // Every live class but the Engineer is served by exactly one of them.
  const served = new Set(all.map((b) => Object.keys(BUILDINGS[b.id].grants)[0]));
  assert.equal(served.size, all.length, 'two of them feed the same economy');
});

test('the upgrade path is gone, and its names still answer', () => {
  /* Removing an export from this module is a throw at the top of a Worker
   * nobody working here can read the source of, which takes the whole site
   * down. So the Workbench's three names stay exported and answer emptily.
   * See the published contract at the foot of this file. */
  assert.deepEqual(UPGRADES, {});
  assert.equal(upgradeCost('barrel', 0), null);
  assert.equal(buyUpgrade('barrel', 0, { screw: 99 }), null);
  assert.equal(BUILDINGS.workbench, undefined, 'the bench itself is gone');
});

test('a deck keeps its size across a fight, hand included', () => {
  // A fight can end with cards still in hand. Reshuffling only the deck and the
  // discard deletes them, and the loss compounds every round.
  const owned = deckFor('engineer');
  const random = seededRandom(11);
  let deck = shuffle(owned, random);
  let discard = [];
  let hand = [];

  for (let round = 0; round < 3; round++) {
    for (let turn = 0; turn < 4; turn++) {
      const dealt = draw(deck, discard, random);
      deck = dealt.deck;
      discard = discardHand(dealt.discard, hand);
      hand = dealt.hand;
    }
    // The surge: everything the player owns goes back in the deck.
    deck = shuffle([...deck, ...discard, ...hand], random);
    discard = [];
    hand = [];
    assert.equal(deck.length, owned.length,
      `round ${round + 1}: the deck went from ${owned.length} to ${deck.length}`);
  }
});

/* -------------------------------------------------------- a site that keeps */

test('a respawned site keeps its ground and reseeds only what grows', () => {
  const terrain = generateTerrain(seededRandom(4));
  const buildings = [];
  const first = respawnItems(terrain, buildings, seededRandom(1));
  const second = respawnItems(terrain, buildings, seededRandom(2));

  assert.equal(first.length, second.length, 'the same site should grow the same amount');
  // Different seeds, different placement — otherwise coming back is not a
  // fresh crop, it is the same round again.
  assert.notDeepEqual(first.map((n) => `${n.x},${n.y}`), second.map((n) => `${n.x},${n.y}`));
});

test('nothing sprouts underneath a standing building', () => {
  // The site persists, so round two spawns onto ground round one built on. A
  // herb under a building is one the party can see and never pick up.
  const terrain = new Array(MAP_W * MAP_H).fill('grass');
  const buildings = [];
  for (let x = 0; x < MAP_W; x++) for (let y = 0; y < 6; y++) buildings.push({ id: 'panel', x, y });

  for (let seed = 1; seed <= 20; seed++) {
    const nodes = respawnItems(terrain, buildings, seededRandom(seed));
    for (const node of nodes) {
      assert.ok(!buildings.some((b) => b.x === node.x && b.y === node.y),
        `seed ${seed}: a ${node.kind} spawned under a building at ${node.x},${node.y}`);
    }
  }
});

test('a spawn tile is never inside a building', () => {
  const terrain = new Array(MAP_W * MAP_H).fill('grass');
  const cx = Math.floor(MAP_W / 2);
  const cy = Math.floor(MAP_H / 2);
  // Wall off the middle, where spawnTile likes to start.
  const buildings = [];
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
    buildings.push({ id: 'panel', x: cx + dx, y: cy + dy });
  }
  for (let offset = 0; offset < PARTY_SIZE; offset++) {
    const spot = spawnTile(terrain, offset, buildings);
    assert.ok(walkableAt(terrain, buildings, spot.x, spot.y),
      `offset ${offset} spawned onto ${spot.x},${spot.y}, which is built on`);
  }
});

test('everything on a persisted site is still reachable around the buildings', () => {
  // A structure can wall a pocket off. The spawner floods with the buildings in
  // place, so what it plants is what a hero can still walk to.
  for (let seed = 1; seed <= 25; seed++) {
    const terrain = generateTerrain(seededRandom(seed));
    const random = seededRandom(seed + 500);
    const buildings = [];
    // Put a few structures down where a player could actually build them.
    for (let i = 0; i < 6; i++) {
      const spot = spawnTile(terrain, i * 3, buildings);
      if (canBuildAt(terrain, buildings, [], spot.x, spot.y)) {
        buildings.push({ id: 'panel', x: spot.x, y: spot.y });
      }
    }
    const from = spawnTile(terrain, 0, buildings);
    for (const node of respawnItems(terrain, buildings, random)) {
      assert.ok(pathTo(terrain, buildings, from, { x: node.x, y: node.y }),
        `seed ${seed}: ${node.kind} at ${node.x},${node.y} was walled off`);
    }
  }
});

/* ------------------------------------------------- the published contract -- */

/* This module is imported at the top of the Worker, and an import of a name
 * that is not exported is a throw at the top of that Worker — which takes the
 * whole site down, sign-in included.
 *
 * Nobody working in this repository can read that Worker's source, so removing
 * an export is a bet on what it does not use. This list is the bet declined:
 * every name this module has ever exported. Add to it, never take away, and
 * shim anything the game outgrows.
 */
const PUBLISHED = [
  // tables
  'PARTY_SIZE', 'MATERIALS', 'RECIPES', 'SALVAGE', 'PAGES', 'CLASSES', 'OPEN_ROLES',
  'BUILDINGS', 'UPGRADES', 'CARDS', 'COMBAT_ACTIONS', 'ENEMIES', 'ROUNDS', 'LEVELS',
  'TERRAIN', 'PHASES', 'EFFECT_KINDS', 'BASE_ACTIONS', 'UNIVERSAL_CARDS',
  'STARTING_SALVAGE', 'STARTING_DECKS', 'SPAWNS', 'CACHE_YIELD', 'NODE_REFUSAL',
  // numbers
  'MAP_W', 'MAP_H', 'COMBAT_H', 'BASE_ROOM', 'HERB_COUNT', 'HAND_SIZE',
  'ROUNDS_BEFORE_BOSS', 'BOSS_ROUND',
  // lookups and rules
  'classById', 'playableClasses', 'cardById', 'cardEffect', 'cardPlayable',
  'materialFor', 'salvageFor', 'missingFor', 'missingForBuilding', 'shortfall',
  'canAfford', 'affordableBuildings', 'canBuildAt', 'canBuildMore', 'buildingsOf',
  'powerFrom', 'upgradeCost', 'buyUpgrade', 'brew', 'combatOptions',
  'deckFor', 'buildDeck', 'shuffle', 'draw', 'discardHand',
  'roundInfo', 'phaseCard', 'waveFor', 'readyState', 'isBuildPhase',
  'salvageAfterCombat', 'addSalvage', 'spendSalvage', 'nodeYield',
  // the works: five payout lines, the placement rules, and what chips buy
  'NEIGHBOURS', 'placeRefusal', 'canPlace', 'worksFrom', 'grantsFrom',
  'moveRefusal', 'canMove', 'strandedIn',
  'DRAW', 'ABILITIES', 'ABILITY_IDS', 'abilityRefusal',
  // the map
  'generateTerrain', 'generateMap', 'generateCombatTerrain', 'spawnItems',
  'spawnHerbs', 'respawnItems', 'spawnTile', 'tileAt', 'tileIndex', 'inBounds',
  'walkableAt', 'reachableFrom', 'pathTo', 'largestBuildableArea',
  'seededRandom', 'seedFromCode',
  // the camp
  'CAMP_X', 'CAMP_Y', 'CAMP_RADIUS', 'TENT_Y', 'inCamp',
  // spellcraft
  'SPELLS', 'MODIFIERS', 'MODIFIER_WEIGHTS', 'SPELL_SLOTS', 'SPELL_OFFER_WEIGHT',
  'PAGES_PER_ROUND', 'WIZARD_BASE_KIT', 'freshSpellbook', 'composeSpell',
  'rollOffers', 'takeOffer', 'moveModifier', 'wizardCombatDeck',
  'ownedModifiers', 'draftableCount',
  // the garden
  'POT_COUNT', 'potYield', 'potStage', 'plantPot', 'harvestPot', 'growPots',
  // the kits
  'CLASS_KITS', 'classKit', 'WIZARD_BASE_KIT',
  // the wave's intents. `waveTargets` and `ailmentOnHit` were the two names
  // this section replaced, and neither ever reached this list — they were
  // combat internals written long after it, imported by `rooms.js` and the
  // client and nowhere else. Everything below is on it from the first day, so
  // the next person removing one has to decline the same bet.
  'ENEMY_INTENTS', 'ENEMY_INTENT_KINDS', 'CHARGE_MULTIPLIER', 'BOLSTER_STEP',
  'BLIGHT_SHARE', 'BOSS_SCALING', 'HP_PER_PLAYER', 'WAVE_CAP',
  'enemyStats', 'enemyAbility',
  'intentOf', 'intentKindOf', 'enemyDamage', 'blightDamage', 'blightOf',
  // the action surface that replaced the deck. Everything the deck machinery
  // above exported is still exported and now shims — a Worker that imports
  // `draw` or `HAND_SIZE` still gets one, it just has nothing left to draw.
  'CLASS_BASICS', 'CLASS_ACTIONS', 'CHARGE_CAP', 'CHARGE_REGEN',
  'actionsFor', 'actionCost', 'actionReady', 'actionRemaining',
  'freshStock', 'freshUses', 'isBasic',
  // The Hauler's pack. Declared in pack.js and re-exported by content.js —
  // which is exactly why they belong on this list rather than only in
  // test/pack.test.js. What the Worker imports is this module's namespace, and
  // a re-export quietly dropped from it is the same throw at the top of the
  // deployed Worker as a local export deleted.
  'PACK_W', 'PACK_H', 'PACK_GRIDS', 'PACK_SHAPES', 'PACK_ITEMS', 'PACK_KINDS',
  'gridFor', 'gridHas', 'gridCells',
  'packItem', 'packCard', 'packAt', 'packFilled', 'packUsed',
  'packFits', 'packPlace', 'packMove', 'packRemove', 'packSpill',
  'packedCards', 'packedStats', 'packedAmount',
  'rotateCells', 'shapeCells', 'itemCells', 'rotationsOf',
  'rollPackItems', 'freshPack', 'normalisePack',
];

test('every name this module has ever published is still exported', async () => {
  const content = await import('../public/good-vibes/content.js');
  const missing = PUBLISHED.filter((name) => content[name] === undefined);
  assert.deepEqual(missing, [],
    `dropped from the published contract: ${missing.join(', ')}. `
    + 'The Worker imports this module at its top level and a missing export is a throw '
    + 'at the top of it, which takes the whole site down. Shim it instead.');
});

test('the shims are shaped like the things they replace', () => {
  // Harmless and correctly shaped, rather than pretending to still work.
  assert.ok(Array.isArray(combatOptions()), 'combatOptions must still return a list of ids');
  for (const id of combatOptions()) assert.ok(CARDS[id], `combatOptions returned "${id}"`);
  assert.ok(Array.isArray(combatOptions([{ id: 'panel' }])), 'it must tolerate the old argument');

  assert.ok(Array.isArray(LEVELS) && LEVELS.length, 'LEVELS must still be a non-empty array');
  for (const level of LEVELS) {
    assert.equal(typeof level.name, 'string');
    assert.equal(typeof level.blight, 'number');
    assert.equal(typeof level.nodes, 'number');
  }
});

/* ---------------------------------------------------- the end of a run */

test('the record has a label for every column and starts at zero', () => {
  for (const key of STAT_KEYS) {
    assert.equal(typeof STAT_LABELS[key], 'string', `"${key}" has no label`);
    assert.ok(STAT_LABELS[key].length, `"${key}" has an empty label`);
    assert.ok(STAT_SHORT[key] && STAT_SHORT[key].length <= 10,
      `"${key}" needs a short column heading that fits a table`);
  }
  const blank = blankStats();
  assert.deepEqual(Object.keys(blank), STAT_KEYS);
  assert.ok(STAT_KEYS.every((key) => blank[key] === 0));
});

test('runHighlights names a leader per column and skips the empty ones', () => {
  const seat = (id, classId, stats) => ({ id, classId, name: id, stats: { ...blankStats(), ...stats } });
  const rows = runHighlights([
    seat('a', 'alchemist', { damage: 10, mended: 40 }),
    seat('b', 'engineer', { damage: 25, guard: 12 }),
    seat('c', 'wizard', { damage: 25 }),
  ]);

  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.damage.player.id, 'b', 'a tie goes to the earlier seat, not the later one');
  assert.equal(by.damage.value, 25);
  assert.equal(by.mended.player.id, 'a');
  assert.equal(by.guard.player.id, 'b');
  // Nobody revived anybody and nobody took a hit, so those are not medals.
  assert.equal(by.revived, undefined, 'a column nobody scored on must not award a medal for zero');
  assert.equal(by.taken, undefined);

  // The shape has to survive the states it will actually meet.
  assert.deepEqual(runHighlights([]), []);
  assert.deepEqual(runHighlights([{ id: 'x', classId: null, stats: blankStats() }]), []);
  assert.deepEqual(runHighlights([{ id: 'y', classId: 'wizard' }]), [],
    'a seat from a save written before the record existed must not throw');
});
