/* The upgrade half of the server.
 *
 * The platform's job is to decide which game owns a socket path, refuse the
 * ones nobody owns, and hand the rest over. What the game then does with the
 * socket is the game's business and is covered in test/good-vibes.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createServer } from '../../src/http/server.js';

let base;
let server;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `ws://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/* Resolves to the first message, or rejects when the socket is refused. */
function connect(url, { timeout = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.close(); reject(new Error('timed out')); }, timeout);
    const done = (fn, value) => { clearTimeout(timer); fn(value); };
    ws.addEventListener('message', (e) => done(resolve, { ws, data: JSON.parse(e.data) }));
    ws.addEventListener('error', () => done(reject, new Error('refused')));
    ws.addEventListener('close', () => done(reject, new Error('closed without a message')));
  });
}

test('a seat gets its own view as soon as it joins', async () => {
  const { ws, data } = await connect(`${base}/api/games/good-vibes/ws?code=AAAA&token=seat-1`);
  assert.equal(data.t, 'state');
  assert.equal(data.state.code, 'AAAA');
  assert.equal(data.state.phase, 'lobby');
  // The view is built for this seat: it knows which player it is.
  assert.ok(data.state.you, 'the view carries the seat it was built for');
  ws.close();
});

test('two seats in one room see each other', async () => {
  const a = await connect(`${base}/api/games/good-vibes/ws?code=BBBB&token=seat-a`);
  const b = await connect(`${base}/api/games/good-vibes/ws?code=BBBB&token=seat-b`);
  assert.equal(b.data.state.players.length, 2);
  // ...and they are different seats, not the same one twice.
  assert.notEqual(b.data.state.you, a.data.state.you);
  a.ws.close();
  b.ws.close();
});

test('a room code is per room', async () => {
  const a = await connect(`${base}/api/games/good-vibes/ws?code=CCCC&token=seat-a`);
  const b = await connect(`${base}/api/games/good-vibes/ws?code=DDDD&token=seat-a`);
  assert.equal(a.data.state.players.length, 1);
  assert.equal(b.data.state.players.length, 1);
  a.ws.close();
  b.ws.close();
});

test('a request that was never going to work is refused before the handshake', async () => {
  const refused = [
    `${base}/api/games/good-vibes/ws`,                      // no code, no token
    `${base}/api/games/good-vibes/ws?code=AAAA`,            // no token
    `${base}/api/games/good-vibes/ws?code=xx&token=seat`,   // code too short
    `${base}/api/games/good-vibes/ws?code=TOOLONGCODE&token=seat`,
    `${base}/api/games/nope/ws?code=AAAA&token=seat`,       // no such game
    `${base}/api/games/good-vibes/nope?code=AAAA&token=seat`, // no such socket
    `${base}/api/ws?code=AAAA&token=seat`,                  // not a game path at all
  ];
  for (const url of refused) {
    await assert.rejects(connect(url, { timeout: 2000 }), /refused|closed/, url);
  }
});

test('a lower-case room code reaches the same room as its upper-case twin', async () => {
  const a = await connect(`${base}/api/games/good-vibes/ws?code=EEEE&token=seat-a`);
  const b = await connect(`${base}/api/games/good-vibes/ws?code=eeee&token=seat-b`);
  assert.equal(b.data.state.players.length, 2, 'the codes did not fold to one room');
  a.ws.close();
  b.ws.close();
});
