/* The catalogue of games this server knows how to serve.
 *
 * A game is a folder under games/ with a manifest at its root. The server does
 * not know anything about any particular game: it serves the manifest's client
 * directory, lists the manifest's metadata on the menu, and hands sockets to
 * the manifest's socket handler. Adding a second game is writing a manifest and
 * one line in catalog.js — nothing in src/ changes.
 *
 * A manifest is:
 *
 *   id        url-safe slug, permanent — the client is served at /games/<id>/
 *   title     what the menu shows
 *   tagline   one line under the title on the menu card
 *   blurb     a sentence or two; what the game is
 *   players   human-readable player count, e.g. '1–5'
 *   entry     file inside publicDir that /games/<id>/ resolves to
 *   publicDir file: URL of the directory served at /games/<id>/. Everything in
 *             it is public, including any rule modules the browser and the
 *             server both import — so what a path means on disk and what it
 *             means over the wire are the same thing.
 *   socket    optional { path, validate, open } — see below
 *
 * socket.path is the last segment of /api/games/<id>/<path>. validate({ query })
 * runs before the handshake and returns an error string to refuse with 400, so
 * a bad request never becomes a WebSocket. open(socket, { query }) runs after,
 * and owns the socket from then on.
 */

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const REQUIRED = ['id', 'title', 'tagline', 'blurb', 'players', 'entry', 'publicDir'];

const catalog = new Map();

export function register(game){
  for(const field of REQUIRED){
    if(!game?.[field]) throw new Error(`game manifest is missing ${field}`);
  }
  if(!ID_RE.test(game.id)) throw new Error(`game id ${JSON.stringify(game.id)} is not url-safe`);
  if(catalog.has(game.id)) throw new Error(`two games claim the id ${game.id}`);
  catalog.set(game.id, game);
  return game;
}

export const games = () => [...catalog.values()];

export const gameById = id => catalog.get(id) ?? null;

/* What the menu and GET /api/games say about a game. Deliberately not the
   whole manifest: publicDir and the socket handler are server business. */
export const describe = game => ({
  id: game.id,
  title: game.title,
  tagline: game.tagline,
  blurb: game.blurb,
  players: game.players,
  href: `/games/${game.id}/`,
});
