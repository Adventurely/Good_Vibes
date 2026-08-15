import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PALETTE, HERO_ART, MATERIAL_ART, TERRAIN_ART, TILE } from '../public/art.js';
import {
  PARTY_SIZE, CLASSES, OPEN_ROLES, MATERIALS, RECIPES, LEVELS,
  classById, playableClasses, missingFor, materialFor,
  MAP_W, MAP_H, TERRAIN, HERB_COUNT, PHASES, isBuildPhase, readyState,
  seededRandom, seedFromCode, generateTerrain, spawnHerbs, generateMap,
  spawnTile, tileAt, inBounds,
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
  }
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

test('a run has levels, and they get harder', () => {
  assert.ok(LEVELS.length >= 1);
  for (const level of LEVELS) {
    assert.ok(level.nodes > 0, `level "${level.name}" has nothing to gather`);
    assert.ok(level.blight >= 0);
  }
  const blights = LEVELS.map((l) => l.blight);
  assert.deepEqual(blights, [...blights].sort((a, b) => a - b), 'levels should not get easier');
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

test('herbs land in bounds, on growable ground, and never stack', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { terrain, nodes } = generateMap(seededRandom(seed));
    const seen = new Set();
    for (const node of nodes) {
      const where = `seed ${seed} node ${node.id}`;
      assert.ok(inBounds(node.x, node.y), `${where} is off the map at ${node.x},${node.y}`);
      assert.ok(MATERIALS[node.material], `${where} grew "${node.material}"`);
      assert.equal(node.taken, false, `${where} starts taken`);

      const kind = tileAt(terrain, node.x, node.y);
      assert.ok(TERRAIN[kind].grows, `${where} is on ${kind}, which nothing grows on`);

      const key = `${node.x},${node.y}`;
      assert.ok(!seen.has(key), `${where} shares a tile with another herb`);
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
