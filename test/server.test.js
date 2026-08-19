import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';

import { handleRequest } from '../src/app.js';

let baseUrl;
let server;

before(async () => {
  server = http.createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET / returns the shelf, not a game', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /Good Vibe Games/);
  // Both games, both reachable. A landing page that lists one of them is a
  // landing page that has quietly lost the other.
  assert.match(html, /href="\/good-vibes\/"/);
  assert.match(html, /href="\/solarium\/"/);
  // The thumbnails are canvases painted by the games' own renderers, so an
  // import that stops resolving should fail here rather than on the page.
  assert.match(html, /id="shot-gv"/);
  assert.match(html, /id="shot-ss"/);
});

test('a directory is served as its index', async () => {
  /* Cloudflare's asset store does this in production. Without the same rule
     locally, /good-vibes/ is a 404 on a laptop and a game everywhere else —
     the kind of difference that gets found by somebody else, later. */
  for(const dir of ['/good-vibes/', '/solarium/']){
    const res = await fetch(`${baseUrl}${dir}`);
    assert.equal(res.status, 200, `${dir} returned ${res.status}`);
    assert.match(res.headers.get('content-type'), /text\/html/);
  }
});

test('each game is a title screen with a way in', async () => {
  const gv = await (await fetch(`${baseUrl}/good-vibes/`)).text();
  assert.match(gv, /<canvas[^>]*id="title"/);
  assert.match(gv, /\.\/title\.js/);
  assert.match(gv, /href="play\.html"/);

  const ss = await (await fetch(`${baseUrl}/solarium/`)).text();
  assert.match(ss, /Save Solarium/);
  // It came from another site and used to link back to it two levels up.
  assert.doesNotMatch(ss, /Tool Haven/);
});

test('each game keeps its own modules', async () => {
  /* Both games ship a content.js and an art.js. They are different files with
     different tables, and the only thing keeping them apart is the directory —
     so check the right one answers on each path. */
  const gv = await fetch(`${baseUrl}/good-vibes/content.js`);
  assert.equal(gv.status, 200);
  assert.match(gv.headers.get('content-type'), /javascript/);
  assert.match(await gv.text(), /RECIPES|BUILDINGS/);

  const ss = await fetch(`${baseUrl}/solarium/content.js`);
  assert.equal(ss.status, 200);
  assert.match(await ss.text(), /SOLAR_PER_ROUND|buildEncounter/);
});

test('modules are served with a JavaScript type', async () => {
  // A module served as text/plain is refused by the browser, and the page then
  // fails with nothing drawn and nothing obviously wrong.
  const res = await fetch(`${baseUrl}/good-vibes/pixel.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.match(await res.text(), /export const PALETTE/);
});

test('the lobby page is served', async () => {
  const res = await fetch(`${baseUrl}/good-vibes/play.html`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
});

test('paths cannot escape public/', async () => {
  // Sent raw and encoded: the encoded form survives URL normalisation, so it
  // is the one that reaches the handler still looking like a traversal.
  for (const attack of ['/../package.json', '/..%2Fpackage.json', '/%2e%2e/package.json']) {
    const res = await fetch(`${baseUrl}${attack}`);
    assert.equal(res.status, 404, `${attack} returned ${res.status}`);
  }
});

test('GET /healthz reports ok', async () => {
  const res = await fetch(`${baseUrl}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('unknown paths return 404', async () => {
  const res = await fetch(`${baseUrl}/nope`);
  assert.equal(res.status, 404);
});

test('non-GET methods return 405', async () => {
  const res = await fetch(`${baseUrl}/`, { method: 'POST' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, HEAD');
});
