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

test('the greenhouse can be walked around, and not walked out of', async () => {
  /* The viewer opens flying: you are standing in the house at head height and
   * you go where you are looking. Almost all of it is geometry and a pointer
   * lock, which a test without a GPU cannot judge — but the parts that would
   * silently break it are readable, and each of them has cost an afternoon
   * somewhere:
   *
   *   - the rig referenced from `window.gt` before it was declared, which is a
   *     temporal dead zone and takes the whole module down in dev mode;
   *   - the bounds derived from the wrong half-width, which puts the camera
   *     inside the glass;
   *   - a flat ceiling clamp, which either stops you at the eaves or lets you
   *     through the roof, because the ridge is 90 cm above them.
   */
  const html = await (await fetch(`${baseUrl}/greener-thumbs/play.html`)).text();
  const js = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  assert.ok(js.length > 1000, 'no inline module found to check');

  // The rig is there, and it is what the page opens in.
  assert.match(js, /const fly = \{/);
  assert.match(js, /setFly\(true\)/, 'the viewer has to open flying');
  assert.match(js, /requestPointerLock\(\)/, 'looking where the mouse points needs the pointer');
  assert.match(js, /if \(fly\.on\)\{\s*\n\s*stepFly\(dt\);/, 'the loop has to drive it');

  // Declared before it is handed to the console, or dev mode is a blank page.
  const declared = js.indexOf('const fly = {');
  const exported = js.indexOf('window.gt = {');
  assert.ok(declared < exported,
    'window.gt names the fly rig, so the rig has to be declared above it');

  // Bounded by the house's own numbers rather than by figures typed twice.
  assert.match(js, /GH\.W \/ 2 - FLY_EDGE/, 'the side walls come from GH.W');
  assert.match(js, /GH\.D \/ 2 - FLY_EDGE/, 'the end walls come from GH.D');
  assert.match(js, /GH\.RIDGE - \(GH\.RIDGE - GH\.EAVE\)/,
    'the ceiling has to follow the pitch, not sit flat at one of them');

  // Orbit is still there, and the two cannot both be driving.
  assert.match(js, /controls\.enabled = !on/);
  assert.match(js, /ui\.spin && !fly\.on/, 'auto-spin is an orbit trick and drags you sideways in flight');

  /* WASD is the floor plan and nothing else. Forward following your pitch is
     the free-fly convention and it was wrong here: looking down at a plant is
     the ordinary thing to do in a greenhouse, and on that camera the ordinary
     thing sends you through the floor the moment you press W. */
  assert.match(js, /FLY_AXES\.fwd[\s\S]{0,120}\.setY\(0\)/,
    'forward has to be levelled, or W dives whenever you look down');

  /* Where you were when you closed the tab. A viewer that puts you back by the
     door every time makes you walk to the far bench again to carry on looking
     at the far bench. */
  assert.match(js, /localStorage\.setItem\(SPOT_KEY/);
  assert.match(js, /loadSpot\(\)/);
  assert.match(js, /clampToHouse\(camera\.position\);\s*\/\/ in case the house has changed/,
    'a saved spot must be checked against the house it is coming back into');
  // Storage that will not store is a browser, not a bug.
  assert.match(js, /catch \{ \/\* a browser that will not store/);

  /* You cannot walk through the furniture. The colliders are written from the
     same constants the furniture is built from — the house is merged into a
     handful of draw calls, so a box fitted round a mesh would be a box round
     the whole building. */
  assert.match(js, /const COLLIDERS = \[\]/);
  assert.match(js, /pushOutOfThings\(p\)/);
  assert.match(js, /GH\.D\/2 - 0\.48/, 'the staging collider comes from the staging');
  assert.match(js, /GH\.EAVE - L\.drop/, 'the lamp colliders come from the lamps');
  assert.match(js, /for \(const L of LAMPS\)/);

  /* The margin is per box, and that is not fussiness. It applies upward as
     well as outward, so a hand's width round a 95 cm plinth puts a dome over
     the top of it — and the specimen stands on the top, is 19 cm tall, and is
     the one thing the viewer exists to let you look at closely. */
  assert.match(js, /const WALKPAST = [\d.]+, CLOSEUP = [\d.]+;/);
  const walkpast = Number(/const WALKPAST = ([\d.]+)/.exec(js)[1]);
  const closeup = Number(/CLOSEUP = ([\d.]+)/.exec(js)[1]);
  assert.ok(closeup < walkpast, 'the plinth must hold you off less than a bench does');
  assert.ok(closeup > 0, 'and it must still hold you off the stone');
  assert.match(js, /b\(CLOSEUP, -0\.21/, 'the plinth is the box that gets the small margin');

  // The specimen itself is not a collider, deliberately.
  assert.ok(!/COLLIDERS[\s\S]{0,400}modelRoot/.test(js),
    'a collider round the plant would stop the close inspection the viewer is for');

  // And the page says how to work it, on both kinds of screen.
  assert.match(html, /id="enter"/);
  assert.match(html, /id="cross"/);
  assert.match(html, /id="fly"/);
  // A phone has no pointer to capture and no keys to press, so it gets arrows.
  assert.match(html, /id="pad"/);
  assert.match(html, /id="lift"/);
  for(const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC']){
    assert.match(html, new RegExp(`data-key="${key}"`), `the pad has no button for ${key}`);
  }
  assert.match(js, /#pad button, #lift button/, 'the pad buttons have to be wired to the same keys');
  assert.match(html, /@media \(pointer:fine\)\{ body\.flying #pad/,
    'a mouse gets the keyboard, not a thumb pad');
});

test('the lot can be carried off the device, and a broken code cannot eat it', async () => {
  /* The save is in one browser's storage and nowhere else, and a browser is
   * allowed to throw its own storage away. Two things follow, and both of them
   * are in the page rather than in `content.js`, so this is where they are
   * checked:
   *
   *   - the browser is asked to keep the save, which the game never did;
   *   - the code that gets pasted back in is refused before anything is
   *     written, because the failure that costs somebody their lot is the one
   *     where a half-pasted code quietly becomes a brand new game.
   */
  const html = await (await fetch(`${baseUrl}/sunward/play.html`)).text();
  const js = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  assert.ok(js.length > 1000, 'no inline module found to check');

  // Off the browser's disposable list.
  assert.match(js, /navigator\.storage\?\.persist\?\.\(\)/,
    'nothing else takes the save off the list of things a browser may evict');
  assert.match(js, /keepTheSave\(\);/, 'asking for it and never calling it is worse than not asking');

  // The panel, and both directions of it.
  assert.match(html, /<h2>Your save code<\/h2>/);
  assert.match(html, /id="code-out"[\s\S]{0,200}readonly/, 'your own code is not an editable box');
  assert.match(html, /id="code-line"[\s\S]{0,80}role="status"/,
    'a refusal nobody hears is a button that silently does nothing with a save');

  /* Refused first, and nothing written. Ordered, not merely present: a confirm
     that came before the refusal would put the question to somebody about a
     code that was never going to load. */
  const refused = js.indexOf('const why = codeRefusal(typed);');
  const asked = js.indexOf('There is no undo. Continue?');
  const written = js.indexOf('localStorage.setItem(SAVE_KEY, JSON.stringify(data));');
  assert.ok(refused > 0 && asked > refused && written > asked,
    'the order has to be refuse, ask, then write');

  /* The autosave holds the lot that is on screen. Left running, it fires
     between the write and the reload and puts the old lot back over the new
     one — which would read as an import that silently did nothing. */
  const stopped = js.indexOf('canSave = false;\n        try {');
  assert.ok(stopped > 0 && stopped < written, 'the autosave has to be stopped before the write');

  // The board id travels, and only when the code has one.
  assert.match(js, /board: board\.id \? \{ id: board\.id, name: board\.name, joined: board\.joined \}/);
  assert.match(js, /if\(row && typeof row\.id === 'string' && row\.id\)\{/,
    'a code from somebody who never joined must not clear this device\'s row');

  /* Start over has the same problem and needs the same answer. It removes the
     key and reloads, and the reload fires `pagehide` on the way out — which
     saved the lot that was still on screen straight back into the hole, so the
     button did nothing at all. */
  const wipe = js.indexOf("ui.wipe.addEventListener");
  const hushed = js.indexOf('canSave = false;', wipe);
  const removed = js.indexOf('localStorage.removeItem(SAVE_KEY)', wipe);
  assert.ok(wipe > 0 && hushed > wipe && hushed < removed,
    'the autosave has to be stopped before the save is thrown away, or the reload writes it back');
});

test('Good Vibe Beats is served, and the shelf paints its card with the game', async () => {
  /* Two files outside the directory know it exists, and both are deliberate:
     the shelf imports `gvb/shot.js` to paint its card, and the title screen
     imports the same file for its backdrop. Either breaking is a blank canvas
     rather than an error anybody would see, which is why they are pinned. */
  for(const path of ['/gvb/', '/gvb/play.html', '/gvb/content.js', '/gvb/audio.js', '/gvb/shot.js']){
    const res = await fetch(`${baseUrl}${path}`);
    assert.equal(res.status, 200, `${path} is not being served`);
  }

  const shelf = await (await fetch(`${baseUrl}/`)).text();
  assert.match(shelf, /href="\/gvb\/"/, 'the shelf has to link it');
  assert.match(shelf, /from '\.\/gvb\/shot\.js'/, 'the card is painted by the game, not by a screenshot');
  assert.match(shelf, /id="shot-gvb"/);

  const title = await (await fetch(`${baseUrl}/gvb/`)).text();
  assert.match(title, /\.\/play\.html/, 'the title screen has to lead somewhere');
  assert.match(title, /from '\.\/shot\.js'/);

  /* The rules are a module the page imports rather than a script inside it.
     Inlined, none of the scoring could be tested, which is the whole reason
     the split exists. */
  const play = await (await fetch(`${baseUrl}/gvb/play.html`)).text();
  assert.match(play, /import \{[\s\S]*?\} from '\.\/content\.js'/);
  assert.match(play, /import \{[\s\S]*?\} from '\.\/audio\.js'/);
  assert.doesNotMatch(play, /function scoreHit|function snap\(/,
    'the scoring must live in content.js, not be copied back into the page');

  /* The Beat Looper reuses the play screen's pads rather than drawing a second
     set, which is the whole reason its controls live inside that section. If
     they are ever pulled out into a fourth screen there will be two pad
     renderers to keep in step, and only one of them will get fixed. */
  assert.match(play, /<div class="tools hidden" id="tools">/);
  assert.match(play, />Beat Looper</);
  // Every looper control inside the tools block, and the tools block inside the
  // play section, after the one set of pads it borrows.
  const padsAt = play.indexOf('<div class="pads" id="pads">');
  const toolsAt = play.indexOf('id="tools"');
  const playEnds = play.indexOf('</section>', toolsAt);
  assert.ok(padsAt > 0 && toolsAt > padsAt && playEnds > toolsAt);
  for(const id of ['lpRec', 'lpUndo', 'lpClear', 'lpBpm', 'lpBars', 'lpStraight', 'lpClick', 'lpSlots']){
    const at = play.indexOf(`id="${id}"`);
    assert.ok(at > toolsAt && at < playEnds, `"${id}" is not inside the tools block`);
  }
  assert.doesNotMatch(play, /id="looperPads"|id="makePads"/, 'there is one set of pads');

  // The Spotify row the prototype advertised is gone: it promised a feature
  // neither Spotify nor YouTube can supply.
  assert.doesNotMatch(play, /Spotify/i);

  /* Nothing on this site fetches anything third-party, and GVB is the only page
     with its own typeface — so it is the only one that could. The font is
     served from here, and the SIL OFL that permits that requires the licence to
     travel with it, which is why the file is asserted rather than assumed. */
  for(const page of [play, title]){
    assert.doesNotMatch(page, /fonts\.googleapis|fonts\.gstatic/,
      'the font is self-hosted; nothing here should call out to Google');
    assert.match(page, /@font-face/, 'and it has to actually be declared');
    assert.match(page, /\.\/font\/bricolage-grotesque\.woff2/);
  }
  const font = await fetch(`${baseUrl}/gvb/font/bricolage-grotesque.woff2`);
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  assert.ok((await font.arrayBuffer()).byteLength > 20000, 'that is not a font');
  assert.equal((await fetch(`${baseUrl}/gvb/font/OFL.txt`)).status, 200,
    'the licence has to ship with the font it licenses');
});
