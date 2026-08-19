/* The front door on good-vibe-games.com.
 *
 * Two jobs, and deliberately nothing else. Static files come out of
 * Cloudflare's asset store without this code running at all — the Worker is
 * only invoked for paths that do not match a file — so the one thing left to
 * route is the socket. Everything the game knows lives behind that socket, in
 * a Durable Object per room code.
 *
 * There is no sign-in, by choice. The room code is the secret: whoever has it
 * can take a seat, which is how you hand a game to four friends in a message
 * rather than in an onboarding flow. The cost is that a short code is a
 * guessable code, and the answer to that is a longer code, not an account.
 */

import { GameRoom } from './room-do.js';
import { SolariumRoom } from './solarium-do.js';

export { GameRoom, SolariumRoom };

const WS_PATH = '/api/good-vibes/ws';
const SOLARIUM_WS = '/api/solarium/ws';
const CODE_RE = /^[A-Z0-9]{4,6}$/;

// Where the root used to be a single game, before there were two of them.
const MOVED = {
  '/play.html': '/good-vibes/play.html',
  '/title.js': '/good-vibes/title.js',
};

export default {
  async fetch(request, env){
    const url = new URL(request.url);

    if(url.pathname === WS_PATH){
      if(request.headers.get('Upgrade') !== 'websocket'){
        return new Response('Expected a WebSocket.', { status: 426 });
      }

      const code = (url.searchParams.get('code') || '').toUpperCase();
      const token = url.searchParams.get('token') || '';
      // Validated here rather than in the object, because a bad code should
      // not be allowed to name — and so create — a Durable Object.
      if(!CODE_RE.test(code) || !token){
        return new Response('Bad room code.', { status: 400 });
      }

      /* `idFromName` is what makes the code mean something: the same four
         characters reach the same object anywhere in the world, which is the
         whole reason the rooms are Durable Objects and not a Map. */
      const id = env.ROOM.idFromName(`${code}`);
      return env.ROOM.get(id).fetch(new Request(url.toString(), request));
    }

    /* Save Solarium, the other game. Same shape and a separate object class, so
       the two never share a room even if somebody uses the same four letters
       for both — which is exactly what a memorable code invites. */
    if(url.pathname === SOLARIUM_WS){
      if(request.headers.get('Upgrade') !== 'websocket'){
        return new Response('Expected a WebSocket.', { status: 426 });
      }
      const code = (url.searchParams.get('code') || '').toUpperCase();
      if(!CODE_RE.test(code)) return new Response('Bad room code.', { status: 400 });

      const id = env.SOLARIUM.idFromName(`${code}`);
      return env.SOLARIUM.get(id).fetch(new Request(url.toString(), request));
    }

    /* The game used to be the whole site, so its pages sat at the root. Anyone
       who kept a link from that week should land on the game rather than on a
       404 they cannot interpret. */
    const moved = MOVED[url.pathname];
    if(moved) return Response.redirect(new URL(moved, url).toString(), 301);

    // Anything that was not a file and is not the socket. The asset store
    // answers with its own 404 rather than this Worker inventing one.
    return env.ASSETS.fetch(request);
  },
};
