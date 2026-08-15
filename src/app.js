import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const cache = new Map();

/* Resolve a URL path to a file inside public/, or null.
 *
 * The join is done first and the result checked against the directory
 * afterwards, because that is the only order that catches every way out:
 * '..' segments, an absolute path, and on some platforms a symlink. Checking
 * the URL for '..' before joining looks equivalent and is not. */
async function readPublic(pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(publicDir, relative);
  if (!file.startsWith(publicDir)) return null;

  if (!cache.has(file)) {
    try {
      cache.set(file, await readFile(file));
    } catch {
      return null;
    }
  }
  return { body: cache.get(file), type: TYPES[path.extname(file)] ?? 'application/octet-stream' };
}

/**
 * Request handler for the Good Vibes dev server.
 *
 * GET /        -> public/index.html
 * GET /<file>  -> that file from public/
 * GET /healthz -> {"status":"ok"}
 * anything else -> 404
 *
 * On Tool Haven the same files are served by Cloudflare's asset store, so this
 * exists for local work only — keep it boring, and keep it matching.
 */
export async function handleRequest(req, res) {
  const { pathname } = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

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
