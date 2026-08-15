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

test('GET / returns the hello world page', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /Hello, world!/);
});

test('the style module is served with a JavaScript type', async () => {
  const res = await fetch(`${baseUrl}/pixel.js`);
  assert.equal(res.status, 200);
  // A module served as text/plain is refused by the browser, and the page then
  // fails with nothing drawn and nothing obviously wrong.
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.match(await res.text(), /export const PALETTE/);
});

test('the lobby page is served', async () => {
  const res = await fetch(`${baseUrl}/play.html`);
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
