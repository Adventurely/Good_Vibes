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
  BASE_ACTIONS, EFFECT_KINDS, combatOptions, missingForBuilding, canAfford,
  affordableBuildings, canBuildAt, salvageAfterCombat, addSalvage, spendSalvage,
  HAND_SIZE, CARDS, STARTING_DECKS, buildDeck, shuffle, draw, discardHand, cardById,
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

test('every recipe is makeable and does something the engine implements', () => {
  const KINDS = new Set(['heal', 'regen', 'ward']);
  for (const [id, recipe] of Object.entries(RECIPES)) {
    assert.equal(typeof recipe.name, 'string', `recipe "${id}" needs a name`);
    assert.ok(Object.keys(recipe.costs).length, `recipe "${id}" costs nothing`);
    for (const [material, amount] of Object.entries(recipe.costs)) {
      assert.ok(MATERIALS[material], `recipe "${id}" needs unknown material "${material}"`);
      assert.ok(Number.isInteger(amount) && amount > 0, `recipe "${id}": bad amount for ${material}`);
    }
    // An unimplemented kind is the failure that looks like a working potion.
    assert.ok(KINDS.has(recipe.effect.kind), `recipe "${id}" has effect kind "${recipe.effect.kind}"`);
    assert.ok(recipe.effect.amount > 0, `recipe "${id}" has no effect amount`);
  }
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
  const fireball = COMBAT_ACTIONS.fireball;
  assert.equal(fireball.classOnly, 'wizard');
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

test('every building is buildable, draws, and grants real actions', () => {
  for (const [id, building] of Object.entries(BUILDINGS)) {
    const where = `building "${id}"`;
    assert.equal(typeof building.name, 'string', `${where}: needs a name`);
    assert.ok([1, 2].includes(building.tier), `${where}: tier must be 1 or 2`);
    assert.ok(BUILDING_ART[building.art], `${where}: art "${building.art}" does not exist`);
    assert.ok(Object.keys(building.costs).length, `${where}: must cost something`);

    for (const [resource, n] of Object.entries(building.costs)) {
      assert.ok(SALVAGE[resource], `${where}: costs "${resource}", which is not salvage`);
      assert.ok(Number.isInteger(n) && n > 0, `${where}: cost of ${resource} must be a positive integer`);
    }
    for (const [resource, n] of Object.entries(building.income)) {
      assert.ok(SALVAGE[resource], `${where}: pays "${resource}", which is not salvage`);
      assert.ok(Number.isInteger(n) && n > 0, `${where}: income of ${resource} must be a positive integer`);
    }
    for (const action of building.grants) {
      assert.ok(COMBAT_ACTIONS[action], `${where}: grants "${action}", which is not a combat action`);
    }

    // A building that neither pays nor arms is a tile you spent for nothing.
    assert.ok(building.grants.length || Object.keys(building.income).length,
      `${where}: grants nothing and pays nothing`);
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

test('the opening is a choice: starting salvage affords one tier-1 building, never both', () => {
  // This is the design, pinned. A balance pass that makes the first move free
  // takes the decision out of the opening, and should fail here first.
  const openers = Object.entries(BUILDINGS).filter(([, b]) => b.tier === 1);
  assert.ok(openers.length >= 2, 'there must be at least two things to choose between');

  for (const [id, building] of openers) {
    assert.ok(canAfford(building.costs, STARTING_SALVAGE),
      `"${id}" is tier 1 but cannot be afforded at the start`);

    const after = spendSalvage(STARTING_SALVAGE, building.costs);
    for (const [other, rival] of openers) {
      if (other === id) continue;
      assert.ok(!canAfford(rival.costs, after),
        `building "${id}" first still leaves enough for "${other}" — the opening is not a choice`);
    }
  }

  for (const [id, building] of Object.entries(BUILDINGS)) {
    if (building.tier === 1) continue;
    assert.ok(!canAfford(building.costs, STARTING_SALVAGE),
      `tier-2 "${id}" is affordable from the start`);
  }
});

test('affordableBuildings agrees with what can be paid for', () => {
  assert.deepEqual(
    affordableBuildings(STARTING_SALVAGE).sort(),
    Object.entries(BUILDINGS).filter(([, b]) => b.tier === 1).map(([id]) => id).sort(),
  );
  assert.deepEqual(affordableBuildings({}), []);
});

test('missingForBuilding reports the shortfall, not just that there is one', () => {
  assert.deepEqual(missingForBuilding('workbench', { screw: 4, pipe: 3 }), {});
  assert.deepEqual(missingForBuilding('workbench', { screw: 1 }), { screw: 3, pipe: 3 });
  assert.equal(missingForBuilding('not-a-building', {}), null);
});

test('combat options come from what is standing', () => {
  assert.deepEqual(combatOptions([]), BASE_ACTIONS,
    'with nothing built there should still be something to do');

  const withPylon = combatOptions([{ id: 'pylon', x: 1, y: 1 }]);
  assert.ok(withPylon.includes('arc'), 'a pylon should arm the party');
  assert.ok(withPylon.includes('hold'), 'base actions do not go away');

  // Two of the same building is one option, not two buttons that do the same.
  const doubled = combatOptions([{ id: 'pylon', x: 1, y: 1 }, { id: 'pylon', x: 2, y: 1 }]);
  assert.equal(new Set(doubled).size, doubled.length);
  assert.deepEqual(doubled, withPylon);

  assert.deepEqual(combatOptions([{ id: 'not-a-building', x: 0, y: 0 }]), BASE_ACTIONS);
});

test('the two openers lead to different fights, which is the point', () => {
  const bench = combatOptions([{ id: 'workbench', x: 1, y: 1 }]);
  const pylon = combatOptions([{ id: 'pylon', x: 1, y: 1 }]);
  assert.notDeepEqual(bench, pylon, 'both openings produce the same combat');
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
  const drawn = salvageAfterCombat(players, [{ id: 'rig', x: 1, y: 1 }], seededRandom(3));

  const total = Object.values(drawn).reduce((a, b) => a + b, 0);
  const rig = BUILDINGS.rig.income;
  const fromRig = Object.values(rig).reduce((a, b) => a + b, 0);
  assert.equal(total, classById('engineer').salvage + fromRig,
    'the draw should be the engineer’s share plus the rig’s output');
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
    assert.ok(classById(card.classId), `${where}: belongs to unknown class "${card.classId}"`);
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
  assert.equal(deck.filter((id) => id === 'spark').length, 5);
  assert.equal(deck.filter((id) => id === 'sign').length, 3);
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
