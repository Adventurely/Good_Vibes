/* Serving files off disk, safely.
 *
 * Each mount is a directory and a URL prefix; nothing outside the directory is
 * reachable, whatever the URL says. The join is done first and the result
 * checked against the root afterwards, because that is the only order that
 * catches every way out: '..' segments, an absolute path, and on some platforms
 * a symlink. Checking the URL for '..' before joining looks equivalent and is
 * not.
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { typeFor } from './mime.js';
import { send, notFound } from './respond.js';

/* A directory on disk that a URL prefix maps onto. */
export function mount(dirUrl){
  const root = typeof dirUrl === 'string' ? dirUrl : fileURLToPath(dirUrl);
  return root.endsWith(path.sep) ? root : root + path.sep;
}

/* Resolve a relative request path inside a mount, or null if it escapes. */
export function resolveIn(root, relative){
  let decoded;
  try{
    decoded = decodeURIComponent(relative);
  }catch{
    return null;                       // a malformed %-escape is not a path
  }
  if(decoded.includes('\0')) return null;
  const file = path.resolve(root, decoded.replace(/^\/+/, ''));
  return file.startsWith(root) ? file : null;
}

/* Read a file inside a mount. Returns null for anything missing, escaping, or
 * not a regular file — a directory read would otherwise throw EISDIR.
 *
 * Read every time. This server exists so you can edit a file and reload, and an
 * in-memory cache turns that into "edit, reload, see the old one, and spend ten
 * minutes wondering why the change did nothing".
 */
export async function readIn(root, relative){
  const file = resolveIn(root, relative);
  if(!file) return null;
  try{
    if(!(await stat(file)).isFile()) return null;
    return { body: await readFile(file), type: typeFor(path.extname(file)) };
  }catch{
    return null;
  }
}

/* Serve a file from a mount, or 404. Returns true when it handled the request. */
export async function serveFrom(res, root, relative){
  const file = await readIn(root, relative);
  if(!file) return false;
  send(res, 200, file.body, { 'Content-Type': file.type });
  return true;
}

export { notFound };
