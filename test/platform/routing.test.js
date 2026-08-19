/* The server's own routes, with no game-specific knowledge beyond the one game
 * this build ships. What is checked here is the platform contract: the menu
 * lists what the registry holds, a game's files are reachable under its own
 * prefix, and nothing outside a game's public directory ever is.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';

import { createServer } from '../../src/http/server.js';
import { games } from '../../src/games/catalog.js';

let baseUrl;
let server;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET / is the game selection menu, built from the registry', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  // Every registered game is on the menu, and each one links to itself.
  for (const game of games()) {
    assert.match(html, new RegExp(game.title), `${game.id} is missing from the menu`);
    assert.match(html, new RegExp(`href="/games/${game.id}/"`), `${game.id} has no link`);
  }
});

test('GET /api/games describes the catalogue', async () => {
  const res = await fetch(`${baseUrl}/api/games`);
  assert.equal(res.status, 200);
  const { games: listed } = await res.json();
  assert.deepEqual(listed.map((g) => g.id), games().map((g) => g.id));
  for (const game of listed) {
    // The menu is built from these, so a blank one is a blank card.
    for (const field of ['title', 'tagline', 'blurb', 'players', 'href']) {
      assert.ok(game[field], `${game.id} published an empty ${field}`);
    }
  }
  // The manifest's server-side halves are not somebody else's business.
  for (const game of listed) {
    assert.equal(game.publicDir, undefined);
    assert.equal(game.socket, undefined);
  }
});

test('a game is served under its own prefix', async () => {
  const res = await fetch(`${baseUrl}/games/good-vibes/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /Good Vibes/);
  assert.match(html, /<canvas[^>]*id="title"/);
  assert.match(html, /href="play\.html"/);
});

test('/games/<id> without the trailing slash redirects to it', async () => {
  // Without this every relative import in the page resolves one directory high.
  const res = await fetch(`${baseUrl}/games/good-vibes`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/games/good-vibes/');
});

test('game modules are served with a JavaScript type', async () => {
  // A module served as text/plain is refused by the browser, and the page then
  // fails with nothing drawn and nothing obviously wrong.
  for (const path of ['title.js', 'pixel.js', 'shared/index.js']) {
    const res = await fetch(`${baseUrl}/games/good-vibes/${path}`);
    assert.equal(res.status, 200, `${path} returned ${res.status}`);
    assert.match(res.headers.get('content-type'), /javascript/, path);
  }
});

test('the shared rules are reachable at the same path the browser imports', async () => {
  // play.html imports './shared/index.js'. If that resolves on disk but not
  // over the wire (or the reverse) the game breaks only once it is served.
  const res = await fetch(`${baseUrl}/games/good-vibes/shared/index.js`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /export \* from '\.\/cards\.js'/);
});

test('paths cannot escape a game directory', async () => {
  // Sent raw and encoded: the encoded form survives URL normalisation, so it is
  // the one that reaches the handler still looking like a traversal.
  const attacks = [
    '/games/good-vibes/../../package.json',
    '/games/good-vibes/..%2F..%2Fpackage.json',
    '/games/good-vibes/%2e%2e/%2e%2e/package.json',
    '/games/good-vibes/server/room.js',      // the engine is not a public file
    '/games/good-vibes/game.js',             // nor is the manifest
  ];
  for (const attack of attacks) {
    const res = await fetch(`${baseUrl}${attack}`);
    assert.equal(res.status, 404, `${attack} returned ${res.status}`);
  }
});

test('a directory is not a file', async () => {
  // Reading one would throw EISDIR rather than 404 if it were not checked.
  const res = await fetch(`${baseUrl}/games/good-vibes/shared`);
  assert.equal(res.status, 404);
});

test('an unknown game is a 404, not a crash', async () => {
  for (const path of ['/games/nope/', '/games/nope', '/games/nope/index.html']) {
    assert.equal((await fetch(`${baseUrl}${path}`)).status, 404, path);
  }
});

test('GET /healthz reports ok', async () => {
  const res = await fetch(`${baseUrl}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('unknown paths return 404', async () => {
  assert.equal((await fetch(`${baseUrl}/nope`)).status, 404);
});

test('non-GET methods return 405', async () => {
  const res = await fetch(`${baseUrl}/`, { method: 'POST' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, HEAD');
});

test('HEAD returns the headers and no body', async () => {
  const res = await fetch(`${baseUrl}/games/good-vibes/`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.ok(Number(res.headers.get('content-length')) > 0);
  assert.equal(await res.text(), '');
});
