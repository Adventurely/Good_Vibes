import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as Sunward from './sunward-board.js';
import * as DuckBoard from './duck-board.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

const BOARD_PATH = '/api/sunward/board';
const DUCK_BOARD_PATH = '/api/duck-duck-quack/board';

/* The boards, locally.
 *
 * In production each is one Durable Object; here each is one of these objects,
 * and they forget everything when the process stops. That is the right
 * behaviour for a dev server — the rooms do the same — and the rules are the
 * same module either way, so what passes here passes there. */
const board = { players: {} };
Sunward.migrateStore(board);   // nothing to move in an empty one; here so the two paths match

const duckBoard = { players: {} };
DuckBoard.migrateStore(duckBoard);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  /* The one self-hosted font on the site. Browsers sniff woff2 and would load
     it as octet-stream anyway, but the deployed Worker serves the right type
     and local dev should not be the odd one out. */
  '.woff2': 'font/woff2',
};

/* Resolve a URL path to a file inside public/, or null.
 *
 * The join is done first and the result checked against the directory
 * afterwards, because that is the only order that catches every way out:
 * '..' segments, an absolute path, and on some platforms a symlink. Checking
 * the URL for '..' before joining looks equivalent and is not. */
async function readPublic(pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  let file = path.resolve(publicDir, relative);
  if (!file.startsWith(publicDir)) return null;

  /* A directory means its index, which is what every static host does and what
   * Cloudflare's asset store does in production. Without this, /good-vibes/ is
   * a 404 locally and a game everywhere else — the sort of difference that gets
   * found by someone else, later. */
  if (relative === '' || relative.endsWith('/')) {
    file = path.join(file, 'index.html');
  } else {
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    } catch { /* not there at all; the read below reports it */ }
  }

  // Read every time. This server exists so you can edit a file and reload, and
  // an in-memory cache turns that into "edit, reload, see the old one, and
  // spend ten minutes wondering why the change did nothing".
  let body;
  try {
    body = await readFile(file);
  } catch {
    return null;
  }
  return { body, type: TYPES[path.extname(file)] ?? 'application/octet-stream' };
}

/* Read a request body, or null the moment it is longer than `cap`.
 *
 * Null is returned as soon as the cap is crossed rather than after the upload
 * finishes, and the rest is let run into the ground with resume(): answering
 * a 413 while the client is still sending is allowed, and the alternative —
 * destroying the socket — tends to lose the reply that says why. */
function readBody(req, cap) {
  if (Number(req.headers['content-length']) > cap) {
    req.resume();
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      if (size > cap) return;                 // already answered; draining
      size += chunk.length;
      if (size > cap) { resolve(null); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { if (size <= cap) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

/* A board route, same shape as the Durable Object's fetch: read, parse, hand to
 * the rules module's `serve`, write JSON. Everything that decides anything is
 * in `rules`, which is the same module the Worker loads — so what passes here
 * passes there. Both boards go through this; they differ only in which module
 * and which store they are given. `no-store` because a GET a second later may
 * well be different and a cached 429 would be a player told to wait who did
 * not have to. */
async function handleBoard(req, res, url, rules, store) {
  const query = Object.fromEntries(url.searchParams);
  let reply;
  if (req.method === 'POST' || req.method === 'DELETE') {
    const raw = await readBody(req, rules.MAX_BODY);
    if (raw === null) {
      reply = rules.TOO_LARGE;
    } else {
      let body;
      try { body = JSON.parse(raw.toString('utf8')); } catch { reply = rules.BAD_JSON; }
      if (!reply) reply = rules.serve(store, req.method, body, query, Date.now());
    }
  } else {
    reply = rules.serve(store, req.method, null, query, Date.now());
  }

  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (reply.status === 405) headers.Allow = 'GET, POST, DELETE';
  if (reply.status === 429) headers['Retry-After'] = String(Math.ceil(reply.body.retryIn / 1000));
  res.writeHead(reply.status, headers);
  res.end(JSON.stringify(reply.body));
}

/**
 * Request handler for the Good Vibes dev server.
 *
 * GET /         -> public/index.html
 * GET /<dir>/    -> that directory's index.html
 * GET /<file>    -> that file from public/
 * GET /healthz -> {"status":"ok"}
 * GET|POST|DELETE /api/sunward/board -> Sunward's leaderboard, in memory
 * GET|POST|DELETE /api/duck-duck-quack/board -> the duck leaderboard, in memory
 * anything else -> 404
 *
 * In production the same files come out of Cloudflare's asset store without the
 * Worker running at all, so this exists for local work only — keep it boring,
 * and keep it matching.
 */
export async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const { pathname } = url;

  // Before the method check: these are the paths that take a POST, and the
  // modules behind them have their own answer for every other method.
  if (pathname === BOARD_PATH) return handleBoard(req, res, url, Sunward, board);
  if (pathname === DUCK_BOARD_PATH) return handleBoard(req, res, url, DuckBoard, duckBoard);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  const file = await readPublic(pathname);
  if (file) {
    res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': file.body.length });
    res.end(req.method === 'HEAD' ? undefined : file.body);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}
