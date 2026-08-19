/* The handshake, and the small socket wrapper everything above it talks to.
 *
 * The wrapper is deliberately tiny — send, close, and two callbacks — because
 * everything above it should be reasoning about the game, not about frames.
 */

import crypto from 'node:crypto';

import { OP, frame, drain } from './frames.js';

/* The magic string from the RFC. The client sends a random key, the server
   echoes back a hash of it with this appended — that is the whole proof that
   the other end understood the upgrade rather than a proxy guessing. */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/* Is this request asking to become a WebSocket? */
export const isUpgrade = req =>
  String(req.headers.upgrade || '').toLowerCase() === 'websocket'
  && String(req.headers['sec-websocket-version'] || '') === '13'
  && typeof req.headers['sec-websocket-key'] === 'string';

/* Completes the handshake and returns the wrapper. */
export function accept(req, socket, head){
  const key = req.headers['sec-websocket-key'];
  const digest = crypto.createHash('sha1').update(key + GUID).digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${digest}\r\n\r\n`,
  );

  socket.setNoDelay(true);
  const state = { buffer: head && head.length ? Buffer.from(head) : Buffer.alloc(0) };
  const handlers = { message: () => {}, close: () => {} };
  let open = true;

  const finish = () => {
    if(!open) return;
    open = false;
    handlers.close();
    socket.destroy();
  };

  socket.on('data', chunk => {
    state.buffer = Buffer.concat([state.buffer, chunk]);
    try{
      drain(state, text => handlers.message(text), finish, payload => {
        if(open) socket.write(frame(payload.toString('utf8'), OP.pong));
      });
    }catch{
      finish();                                // a malformed frame ends the socket
    }
  });

  socket.on('error', finish);
  socket.on('close', finish);

  return {
    get open(){ return open; },
    send(text){
      if(!open) return false;
      try{ return socket.write(frame(text)); }
      catch{ finish(); return false; }
    },
    close(){
      if(!open) return;
      try{ socket.write(frame('', OP.close)); }catch{ /* already gone */ }
      finish();
    },
    onMessage(fn){ handlers.message = fn; },
    onClose(fn){ handlers.close = fn; },
  };
}
