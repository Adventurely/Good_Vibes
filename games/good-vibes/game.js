/* Good Vibes — the manifest the server reads.
 *
 * Everything the platform needs to serve this game and nothing it does not:
 * where the client lives, what the menu should say, and what to do with a
 * socket once it has been upgraded. The rules are in server/ and shared/.
 */

import { roomFor, dropIfEmpty } from './server/rooms.js';

/* A room code is short enough to read out loud and long enough not to collide
   with the one being played in the next room. */
const CODE_RE = /^[A-Z0-9]{4,6}$/;

const codeFrom = query => (query.get('code') || '').toUpperCase();

export default {
  id: 'good-vibes',
  title: 'Good Vibes',
  tagline: 'A co-op solarpunk roguelike',
  blurb: 'Five survivors rebuild a ruin between surges. Gather, build and brew '
       + 'in the daylight; hold the line together when the blight comes.',
  players: '1–5',

  entry: 'index.html',
  publicDir: new URL('./public/', import.meta.url),

  socket: {
    path: 'ws',

    /* Refused before the handshake: a socket that was never going to work is
       better as a 400 than as an open connection that says nothing. */
    validate({ query }){
      if(!CODE_RE.test(codeFrom(query))) return 'a room code of 4-6 letters or digits is required';
      if(!query.get('token')) return 'a seat token is required';
      return null;
    },

    /* The token in the query string is the seat, not the connection: a dropped
       socket comes back to the character it was playing rather than to a new
       one. */
    open(socket, { query }){
      const code = codeFrom(query);
      const room = roomFor(code);
      const player = room.join(query.get('token'), socket);

      if(!player){
        // Refused rather than dropped: "the room is full" is something the
        // player can act on, and a silent close looks like a network fault.
        socket.send(JSON.stringify({
          t: 'rejected',
          message: room.phase === 'lobby' ? 'That room is full.' : 'That run has already started.',
        }));
        socket.close();
        return dropIfEmpty(room);
      }

      socket.onMessage(text => {
        let msg;
        try{ msg = JSON.parse(text); }catch{ return; }
        try{
          room.handle(player, msg);
        }catch(err){
          console.error(`Room ${code}: ${err.stack || err}`);
          socket.send(JSON.stringify({ t: 'error', message: 'That did not work.' }));
        }
      });

      socket.onClose(() => {
        room.leave(player);
        room.broadcast();
        dropIfEmpty(room);
      });

      room.broadcast();
    },
  },
};
