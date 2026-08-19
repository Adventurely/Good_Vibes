/* Routing.
 *
 *   GET /                        the game selection menu
 *   GET /healthz                 {"status":"ok"}
 *   GET /api/games               what the menu is built from, as JSON
 *   GET /games/<id>/             that game's entry page
 *   GET /games/<id>/<file>       anything in that game's public directory
 *
 * Nothing here knows what a game is beyond its manifest, and no path outside a
 * game's own directories is reachable through it.
 */

import { games, gameById, describe } from '../games/catalog.js';
import { lobbyPage } from '../lobby/page.js';
import { mount, serveFrom } from './static.js';
import { html, json, notFound, methodNotAllowed, redirect } from './respond.js';

/* Mount points are resolved once: the same game always maps to the same
   directory, and resolving per request would be work for no answer. */
const mounts = new Map();

function mountFor(game){
  let root = mounts.get(game.id);
  if(!root){
    root = mount(game.publicDir);
    mounts.set(game.id, root);
  }
  return root;
}

export async function handleRequest(req, res){
  const { pathname } = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if(req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res);

  if(pathname === '/') return html(res, lobbyPage(games().map(describe)));
  if(pathname === '/healthz') return json(res, { status: 'ok' });
  if(pathname === '/api/games') return json(res, { games: games().map(describe) });

  const match = pathname.match(/^\/games\/([^/]+)(\/.*)?$/);
  if(!match) return notFound(res);

  const game = gameById(decodeURIComponent(match[1]));
  if(!game) return notFound(res);

  // /games/<id> without the slash would make every relative import in the page
  // resolve one directory too high.
  const rest = match[2];
  if(rest === undefined) return redirect(res, `/games/${game.id}/`);

  const relative = rest === '/' ? game.entry : rest;
  return (await serveFrom(res, mountFor(game), relative)) || notFound(res);
}
