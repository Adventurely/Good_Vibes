import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PALETTE, HERO_ART, MATERIAL_ART, TERRAIN_ART, BUILDING_ART, SALVAGE_ART,
  ENEMY_ART, PAGES_ART, CARD_ART, TILE,
} from '../public/art.js';
import {
  PARTY_SIZE, CLASSES, OPEN_ROLES, MATERIALS, RECIPES,
  ROUNDS, ROUNDS_BEFORE_BOSS, BOSS_ROUND, roundInfo, phaseCard,
  ENEMIES, waveFor, SPAWNS, CACHE_YIELD, PAGES, spawnItems,
  classById, playableClasses, missingFor, materialFor,
  MAP_W, MAP_H, TERRAIN, HERB_COUNT, PHASES, isBuildPhase, readyState,
  seededRandom, seedFromCode, generateTerrain, spawnHerbs, generateMap,
  spawnTile, tileAt, inBounds, BASE_ROOM, largestBuildableArea,
  SALVAGE, salvageFor, BUILDINGS, STARTING_SALVAGE, COMBAT_ACTIONS,
  BASE_ACTIONS, EFFECT_KINDS, missingForBuilding, canAfford,
  affordableBuildings, canBuildAt, salvageAfterCombat, addSalvage, spendSalvage,
  HAND_SIZE, CARDS, STARTING_DECKS, buildDeck, shuffle, draw, discardHand, cardById,
  UNIVERSAL_CARDS, deckFor, cardPlayable, COMBAT_H, generateCombatTerrain,
  UPGRADES, upgradeCost, buyUpgrade, cardEffect, powerFrom, canBuildMore, buildingsOf,
  brew, pathTo, walkableAt, respawnItems,
} from '../public/content.js';

/* content.js is imported by the authoritative room object in Tool Haven, not
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
    assert.ok(enemy.dist >= 1, `enemy "${id}" would spawn already adjacent`);
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
  assert.ok(STARTING_DECKS.wizard.fireball > 0, 'the wizard should open holding fireballs');
  assert.ok(fireball.pageCost >= 1, 'a free fireball makes pages pointless');
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

  for (const [name, art] of Object.entries(HERO_ART)) {
    assert.equal(art.rows.length, 32, `hero "${name}" must be 32 rows tall`);
    check(`hero "${name}"`, art.rows, 24);
    assert.ok(art.split > 0 && art.split < 32, `hero "${name}" has a split off the sprite`);
    for (const [x, y] of art.eyes ?? []) {
      assert.ok(x >= 0 && x < 24 && y >= 0 && y < 32, `hero "${name}" has an eye off the sprite`);
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
    assert.ok(action.effect.amount > 0, `action "${id}" must do a positive amount`);
  }
  for (const id of BASE_ACTIONS) {
    assert.ok(COMBAT_ACTIONS[id], `base action "${id}" does not exist`);
  }
});



test('missingForBuilding reports the shortfall, not just that there is one', () => {
  assert.deepEqual(missingForBuilding('workbench', { screw: 4, pipe: 3 }), {});
  assert.deepEqual(missingForBuilding('workbench', { screw: 1 }), { screw: 3, pipe: 3 });
  assert.equal(missingForBuilding('not-a-building', {}), null);
});



test('canBuildAt refuses water, rubble, occupied tiles and standing herbs', () => {
  const terrain = new Array(MAP_W * MAP_H).fill('grass');
  terrain[0] = 'water';
  terrain[1] = 'rubble';
  const buildings = [{ id: 'workbench', x: 2, y: 0 }];
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

test('salvage after combat pays the crew and the buildings', () => {
  const players = [
    { classId: 'engineer', down: false },
    { classId: 'alchemist', down: false },
  ];
  const drawn = salvageAfterCombat(players, [{ id: 'workbench', x: 1, y: 1 }], seededRandom(3));

  const total = Object.values(drawn).reduce((a, b) => a + b, 0);
  const bench = BUILDINGS.workbench.income;
  const fromBench = Object.values(bench).reduce((a, b) => a + b, 0);
  assert.equal(total, classById('engineer').salvage + fromBench,
    'the draw should be the engineer’s share plus what the bench turned out');
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
    assert.ok(card.effect.amount > 0, `${where}: must do a positive amount`);
    // A card belongs to a class, to a building, or to everybody — exactly one.
    const owners = [card.classId, card.fromBuilding, card.universal, card.brewed].filter(Boolean).length;
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
  assert.equal(deck.length, 8);
  assert.equal(deck.filter((id) => id === 'spark').length, 4);
  assert.equal(deck.filter((id) => id === 'sign').length, 2);
  assert.equal(deck.filter((id) => id === 'fireball').length, 2);
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
  // Eight cards, three a turn: the fight should never reach a turn with no
  // hand, however long it runs.
  let deck = shuffle(buildDeck('engineer'), seededRandom(5));
  let discard = [];
  const random = seededRandom(6);
  for (let turn = 0; turn < 40; turn++) {
    const drawn = draw(deck, discard, random);
    assert.equal(drawn.hand.length, HAND_SIZE, `turn ${turn} dealt ${drawn.hand.length} cards`);
    discard = discardHand(drawn.discard, drawn.hand);
    deck = drawn.deck;
    assert.equal(deck.length + discard.length, 8, `turn ${turn} lost or gained a card`);
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

test('a card that costs pages is dealt but not playable without them', () => {
  // The interesting kind of bad draw: one the player caused by spending.
  assert.equal(cardPlayable('fireball', { pages: 0, classId: 'wizard' }), false);
  assert.equal(cardPlayable('fireball', { pages: 1, classId: 'wizard' }), true);
  assert.equal(cardPlayable('spark', { pages: 0, classId: 'wizard' }), true);
  assert.equal(cardPlayable('not-a-card', { pages: 9 }), false);
  // Nothing stops a free card, whoever is holding it.
  assert.equal(cardPlayable('hold', {}), true);
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
 * the end of it throws away; the workbench turns salvage into a better gun
 * rather than more ground.
 */

test('every building is buildable and gives something for the tile', () => {
  for (const [id, building] of Object.entries(BUILDINGS)) {
    const where = `building "${id}"`;
    assert.equal(typeof building.name, 'string', `${where}: needs a name`);
    assert.ok(BUILDING_ART[building.art], `${where}: art "${building.art}" does not exist`);
    assert.ok(Object.keys(building.costs).length, `${where}: must cost something`);

    for (const [resource, n] of Object.entries(building.costs)) {
      assert.ok(SALVAGE[resource], `${where}: costs "${resource}", which is not salvage`);
      assert.ok(Number.isInteger(n) && n > 0, `${where}: cost of ${resource} must be positive`);
    }
    for (const [resource, n] of Object.entries(building.income)) {
      assert.ok(SALVAGE[resource], `${where}: pays "${resource}", which is not salvage`);
    }

    // A building that makes no power, pays nothing and unlocks nothing is a
    // tile you spent for the view.
    const gives = (building.power || 0) > 0
      || Object.keys(building.income).length > 0
      || id === 'workbench';
    assert.ok(gives, `${where}: gives nothing back`);
  }
});

test('the engineer can always make power on the first build phase', () => {
  // A bolt gun with no panel behind it is a dead card in an opening hand.
  assert.ok(canAfford(BUILDINGS.panel.costs, STARTING_SALVAGE),
    'a Solar Panel must be affordable from the starting salvage');
});

test('the opening is a choice: panel or workbench, never both', () => {
  const ids = Object.keys(BUILDINGS);
  for (const id of ids) {
    assert.ok(canAfford(BUILDINGS[id].costs, STARTING_SALVAGE), `"${id}" is unaffordable at the start`);
    const after = spendSalvage(STARTING_SALVAGE, BUILDINGS[id].costs);
    for (const other of ids) {
      if (other === id) continue;
      assert.ok(!canAfford(BUILDINGS[other].costs, after),
        `building "${id}" first still leaves enough for "${other}" — the opening is not a choice`);
    }
  }
});

test('only the workbench is capped, and panels are not', () => {
  assert.equal(BUILDINGS.workbench.max, 1);
  assert.equal(BUILDINGS.panel.max, undefined, 'every panel is another shot, so they must not be capped');

  const one = [{ id: 'workbench', x: 1, y: 1 }];
  assert.equal(canBuildMore('workbench', []), true);
  assert.equal(canBuildMore('workbench', one), false, 'a second workbench should be refused');
  assert.equal(canBuildMore('panel', [{ id: 'panel', x: 0, y: 0 }, { id: 'panel', x: 2, y: 0 }]), true);
  assert.equal(canBuildMore('not-a-building', []), false);
  assert.equal(buildingsOf(one, 'workbench'), 1);
});

test('power is what the panels make, and nothing else makes it', () => {
  assert.equal(powerFrom([]), 0);
  assert.equal(powerFrom([{ id: 'panel' }]), 1);
  assert.equal(powerFrom([{ id: 'panel' }, { id: 'panel' }, { id: 'panel' }]), 3);
  assert.equal(powerFrom([{ id: 'workbench' }]), 0, 'the workbench is not a generator');
  assert.equal(powerFrom([{ id: 'not-a-building' }]), 0);
});

test('the bolt gun costs power, is not consumed, and only the engineer holds it', () => {
  const bolt = CARDS.boltgun;
  assert.equal(bolt.classId, 'engineer');
  assert.equal(bolt.powerCost, 1);
  assert.ok(!bolt.consumed, 'the gun is a gun, not a potion — it must cycle back');
  assert.ok(bolt.effect.amount > CARDS.wrench.effect.amount, 'the bolt gun should out-hit the basic');
  assert.ok(STARTING_DECKS.engineer.boltgun >= 1, 'the engineer must open holding one');

  assert.equal(cardPlayable('boltgun', { power: 0, classId: 'engineer' }), false, 'fired with no power');
  assert.equal(cardPlayable('boltgun', { power: 1, classId: 'engineer' }), true);
  assert.equal(cardPlayable('boltgun', { power: 9, classId: 'wizard' }), false, 'the wizard picked up the gun');
});

test('upgrades cost more each time and do what they say', () => {
  for (const [id, upgrade] of Object.entries(UPGRADES)) {
    assert.ok(['card', 'damage'].includes(upgrade.adds), `upgrade "${id}" adds "${upgrade.adds}"`);
    for (const resource of Object.keys(upgrade.costs)) {
      assert.ok(SALVAGE[resource], `upgrade "${id}" costs "${resource}", which is not salvage`);
    }
    const first = upgradeCost(id, 0);
    const third = upgradeCost(id, 2);
    const sum = (c) => Object.values(c).reduce((a, b) => a + b, 0);
    assert.ok(sum(third) > sum(first), `upgrade "${id}" never gets dearer, so buying it is free money`);
  }
  assert.equal(upgradeCost('not-an-upgrade', 0), null);
});

test('buying an upgrade spends the salvage, or does nothing at all', () => {
  const salvage = { screw: 9, pipe: 9, plating: 9, coil: 9 };
  const bought = buyUpgrade('barrel', 0, salvage);
  assert.equal(bought.adds, 'card');
  assert.equal(bought.level, 1);
  assert.equal(bought.salvage.screw, 9 - UPGRADES.barrel.costs.screw);
  assert.deepEqual(salvage, { screw: 9, pipe: 9, plating: 9, coil: 9 }, 'it wrote to the pool it was given');

  assert.equal(buyUpgrade('barrel', 0, { screw: 1 }), null);
  assert.equal(buyUpgrade('coilwind', 9, salvage), null, 'level nine should be far out of reach');
  assert.equal(buyUpgrade('not-an-upgrade', 0, salvage), null);
});

test('the coil upgrade makes every bolt hit harder', () => {
  const base = cardEffect('boltgun').amount;
  assert.equal(cardEffect('boltgun', {}).amount, base);
  assert.ok(cardEffect('boltgun', { coilwind: 1 }).amount > base);
  assert.equal(cardEffect('boltgun', { coilwind: 2 }).amount, base + 2 * CARDS.boltgun.upgradeStep);

  // Untouched cards are untouched, and the table itself is never rewritten.
  assert.equal(cardEffect('wrench', { coilwind: 5 }).amount, CARDS.wrench.effect.amount);
  assert.equal(CARDS.boltgun.effect.amount, base, 'cardEffect mutated the card table');
  assert.equal(cardEffect('not-a-card'), null);
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
  // herb under the workbench is one the party can see and never pick up.
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
