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
  // Every game, every one reachable. A landing page that lists four of them is
  // a landing page that has quietly lost the fifth.
  assert.match(html, /href="\/good-vibes\/"/);
  assert.match(html, /href="\/solarium\/"/);
  assert.match(html, /href="\/sunward\/"/);
  assert.match(html, /href="\/greener-thumbs\/"/);
  assert.match(html, /href="\/orbital-trader\/"/);
  // The thumbnails are canvases painted by the games' own renderers, so an
  // import that stops resolving should fail here rather than on the page.
  assert.match(html, /id="shot-gv"/);
  assert.match(html, /id="shot-ss"/);
  assert.match(html, /id="shot-sw"/);
  assert.match(html, /id="shot-ot"/);
});

test('a directory is served as its index', async () => {
  /* Cloudflare's asset store does this in production. Without the same rule
     locally, /good-vibes/ is a 404 on a laptop and a game everywhere else —
     the kind of difference that gets found by somebody else, later. */
  for(const dir of ['/good-vibes/', '/solarium/', '/sunward/', '/orbital-trader/', '/greener-thumbs/']){
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

  const sw = await (await fetch(`${baseUrl}/sunward/`)).text();
  assert.match(sw, /Sunward/);
  assert.match(sw, /<canvas[^>]*id="plate"/);
  assert.match(sw, /href="\.\/play\.html"/);

  const ot = await (await fetch(`${baseUrl}/orbital-trader/`)).text();
  assert.match(ot, /Orbital Trader/);
  assert.match(ot, /href="\.\/play\.html\?new"/);
  assert.match(ot, /<canvas[^>]*id="sky"/);
});

test('Orbital Trader ships its own modules, and they are pure', async () => {
  /* The game has no server: its rules and its sky are modules in public/,
     imported by the browser and by the tests alike. A content module that
     stopped answering, or answered as text/plain, is a page that draws
     nothing and says nothing. */
  for(const file of ['orbit.js', 'sim.js', 'content.js', 'render.js', 'sprites.js', 'intro.js', 'data/world.js', 'data/economy.js', 'data/text.js']){
    const res = await fetch(`${baseUrl}/orbital-trader/${file}`);
    assert.equal(res.status, 200, `${file} returned ${res.status}`);
    assert.match(res.headers.get('content-type'), /javascript/, `${file} content type`);
    const text = await res.text();
    assert.doesNotMatch(text, /from 'node:|require\(|process\.env|Buffer\./, `${file} reaches for Node`);
  }
  /* Most of this game's code is inline in its two pages, and a check that
     skips them is a check that covers a third of it. */
  for(const page of ['play.html', 'index.html']){
    const res = await fetch(`${baseUrl}/orbital-trader/${page}`);
    assert.equal(res.status, 200, `${page} returned ${res.status}`);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
    assert.ok(scripts.length > 1000, `${page}: no inline script found to check`);
    assert.doesNotMatch(scripts, /from 'node:|require\(|process\.env|Buffer\./, `${page} reaches for Node`);
    // And nothing loaded from anywhere but here.
    assert.doesNotMatch(html, /<(script|link|img)[^>]+(src|href)=["']https?:/, `${page} loads something from off-site`);
  }
});

test('each game keeps its own modules', async () => {
  /* Three of the games ship a content.js and an art.js. They are different
     files with different tables, and the only thing keeping them apart is the
     directory — so check the right one answers on each path. */
  const gv = await fetch(`${baseUrl}/good-vibes/content.js`);
  assert.equal(gv.status, 200);
  assert.match(gv.headers.get('content-type'), /javascript/);
  assert.match(await gv.text(), /RECIPES|BUILDINGS/);

  const ss = await fetch(`${baseUrl}/solarium/content.js`);
  assert.equal(ss.status, 200);
  assert.match(await ss.text(), /SOLAR_PER_ROUND|buildEncounter/);

  const sw = await fetch(`${baseUrl}/sunward/content.js`);
  assert.equal(sw.status, 200);
  assert.match(await sw.text(), /GROWERS|DAY_LENGTH/);
});

test('every page wears the one theme', async () => {
  /* The site's look is one file, public/theme.css — the paper, the ink and
     the rounded face — and each page aliases its own token names onto it. A
     page that forgets the link renders with every var() unset: black type on
     a white page in a browser, and nothing in the suite would have noticed,
     because nothing else reads the CSS. So this does. */
  const css = await fetch(`${baseUrl}/theme.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const sheet = await css.text();
  for(const token of ['--gv-type', '--gv-paper', '--gv-text', '--gv-leaf', '--gv-sun']){
    assert.match(sheet, new RegExp(`${token}:`), `theme.css no longer defines ${token}`);
  }

  const pages = [
    '/', '/good-vibes/', '/good-vibes/play.html', '/solarium/',
    '/greener-thumbs/', '/greener-thumbs/play.html',
    '/orbital-trader/', '/orbital-trader/play.html',
    '/sunward/', '/sunward/play.html',
  ];
  for(const page of pages){
    const html = await (await fetch(`${baseUrl}${page}`)).text();
    assert.match(html, /<link rel="stylesheet" href="(\.\.\/|\.\/)theme\.css">/,
      `${page} does not link theme.css`);
    assert.match(html, /var\(--gv-type\)/, `${page} does not set its type from the theme`);
    // Nothing dark left behind as a page ground. The games' own canvases can
    // be as dark as they like; the page around them is paper.
    assert.doesNotMatch(html, /body\s*\{[^}]*background:\s*#[01]/, `${page} still has a dark body`);
  }
});

test('Sunward reaches the font it borrows', async () => {
  /* Its art.js imports the palette and the 5x7 font out of Good Vibes rather
     than keeping a second copy of sixteen hex values. That is a cross-game
     import and the only thing holding it up is the directory layout, so it is
     worth a test: if good-vibes/pixel.js ever moves, Sunward is a blank page
     and nothing else in the suite would notice. */
  const res = await fetch(`${baseUrl}/good-vibes/pixel.js`);
  assert.equal(res.status, 200);
  const art = await (await fetch(`${baseUrl}/sunward/art.js`)).text();
  assert.match(art, /from '\.\.\/good-vibes\/pixel\.js'/);
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

/* ---------------------------------------------------------- Sunward's board */

/* The one route on this server that takes a POST. The rules are all in
   src/sunward-board.js and tested there; what is checked here is the HTTP
   around them — that the route exists, that it reads a body and answers JSON,
   that the size cap and the bad-JSON path are wired, and that adding a POST
   route did not loosen the 405 for everything else. The store is in memory
   and these run in order, so the GET comes first and finds it empty. */

const BOARD = '/api/sunward/board';
const PLAYER = '3f2a9c1e-7b4d-4e8a-9f0c-1a2b3c4d5e6f';
const post = (body, init = {}) => fetch(`${baseUrl}${BOARD}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
  ...init,
});

test('GET the board when nobody is on it', async () => {
  const res = await fetch(`${baseUrl}${BOARD}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.deepEqual(body.boards, { taps: [], seeds: [], earned: [], peakHeld: [], peakTaps: [] });
  assert.equal(body.players, 0);
  assert.deepEqual(body.you, { taps: null, seeds: null, earned: null, peakHeld: null, peakTaps: null });
  assert.equal(typeof body.updated, 'number');
});

test('POST a score and it is on the board', async () => {
  const res = await post({ id: PLAYER, name: '  Finn  ',
    stats: { taps: 120, seeds: 1, earned: 2.5e6, peakHeld: 9e5, peakTaps: 7.5 } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json();
  assert.deepEqual(body.boards.taps, [{ name: 'Finn', value: 120 }]);
  assert.deepEqual(body.boards.seeds, [{ name: 'Finn', value: 1 }]);
  assert.deepEqual(body.you, { taps: 1, seeds: 1, earned: 1, peakHeld: 1, peakTaps: 1 });
  // The two energy boards are not the same board: earned is every unit ever,
  // held is the biggest the pile ever got.
  assert.deepEqual(body.boards.earned, [{ name: 'Finn', value: 2.5e6 }]);
  assert.deepEqual(body.boards.peakHeld, [{ name: 'Finn', value: 9e5 }]);
  assert.equal(body.players, 1);
  // Nothing in the public shape names the id that would let anyone else
  // write to that row.
  assert.doesNotMatch(JSON.stringify(body), new RegExp(PLAYER));

  const again = await (await fetch(`${baseUrl}${BOARD}?you=${PLAYER}`)).json();
  assert.deepEqual(again.boards.taps, [{ name: 'Finn', value: 120 }]);
  assert.equal(again.you.taps, 1);
});

test('POST a bad name is a 400 with a reason', async () => {
  const res = await post({ id: crypto.randomUUID(), name: 'F!', stats: { taps: 1 } });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['error']);
  assert.match(body.error, /Names are/);
});

test('POST again inside fifteen seconds is a 429 that says how long', async () => {
  const res = await post({ id: PLAYER, name: 'Finn', stats: { taps: 121 } });
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.error, 'Too soon.');
  assert.ok(body.retryIn > 0 && body.retryIn <= 15000, `retryIn was ${body.retryIn}`);
  assert.equal(res.headers.get('retry-after'), String(Math.ceil(body.retryIn / 1000)));
  // And the refused figure did not land.
  const board = await (await fetch(`${baseUrl}${BOARD}`)).json();
  assert.deepEqual(board.boards.taps, [{ name: 'Finn', value: 120 }]);
});

test('POST five kilobytes is a 413 before it is even parsed', async () => {
  // Valid JSON, so the only thing wrong with it is the size.
  const res = await post({ id: crypto.randomUUID(), name: 'Finn', stats: { taps: 1 }, padding: 'x'.repeat(5000) });
  assert.equal(res.status, 413);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['error']);
});

test('POST something that is not JSON is a 400', async () => {
  const res = await post('{"id": nope');
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'That was not JSON.');
});

test('a row can be taken off the board again, over the wire', async () => {
  const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const post = await fetch(`${baseUrl}${BOARD}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name: 'Leaver', stats: { taps: 12, seeds: 1, earned: 5, peakTaps: 2 } }),
  });
  assert.equal(post.status, 200);
  assert.ok((await post.json()).boards.taps.some(r => r.name === 'Leaver'));

  const gone = await fetch(`${baseUrl}${BOARD}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  assert.equal(gone.status, 200);
  const after = await gone.json();
  assert.equal(after.removed, true);
  assert.ok(!after.boards.taps.some(r => r.name === 'Leaver'), 'the row must be off every board');

  const check = await (await fetch(`${baseUrl}${BOARD}`)).json();
  assert.ok(!check.boards.taps.some(r => r.name === 'Leaver'), 'and stay off it');

  const nonsense = await fetch(`${baseUrl}${BOARD}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'nobody' }),
  });
  assert.equal(nonsense.status, 400);
});

test('PUT the board is a 405, and the static 405 still holds elsewhere', async () => {
  const res = await fetch(`${baseUrl}${BOARD}`, { method: 'PUT', body: '{}' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, POST, DELETE');
  assert.deepEqual(Object.keys(await res.json()), ['error']);

  // The board is the only path that takes a POST. Anywhere else is what it was.
  for(const path of ['/', '/healthz', '/sunward/', '/api/sunward/boards', '/api/sunward/board/']){
    const other = await fetch(`${baseUrl}${path}`, { method: 'POST', body: '{}' });
    assert.equal(other.status, 405, `POST ${path} returned ${other.status}`);
    assert.equal(other.headers.get('allow'), 'GET, HEAD');
  }
  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
});
