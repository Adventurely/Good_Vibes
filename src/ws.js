/* A WebSocket server in the standard library, and nothing else.
 *
 * This project has no dependencies on purpose, and Node ships a WebSocket
 * *client* but not a server — so the handshake and the framing are here. It is
 * about a hundred and fifty lines of RFC 6455 and then it is done: text frames
 * in, text frames out, ping answered, close handled.
 *
 * What is deliberately not here: extensions (no permessage-deflate), binary
 * frames, and backpressure beyond what a socket write already does. A turn
 * based game sends a few kilobytes of JSON per action, so none of that earns
 * its complexity.
 */

import crypto from 'node:crypto';

/* The magic string from the RFC. The client sends a random key, the server
   echoes back a hash of it with this appended — that is the whole proof that
   the other end understood the upgrade rather than a proxy guessing. */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OP = { text: 0x1, close: 0x8, ping: 0x9, pong: 0xa };

/* Frames a payload for sending. Server frames are never masked; the length
   takes one of three shapes depending on how big the payload is, which is the
   only fiddly part. */
function frame(payload, opcode = OP.text){
  const body = Buffer.from(payload, 'utf8');
  const length = body.length;

  let header;
  if(length < 126){
    header = Buffer.alloc(2);
    header[1] = length;
  }else if(length < 65536){
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  }else{
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;                  // FIN set, one frame per message
  return Buffer.concat([header, body]);
}

/* Pulls whole frames out of a rolling buffer.
 *
 * TCP does not hand over messages, it hands over bytes: one read can hold two
 * frames, or half of one. So the buffer is kept between reads and only drained
 * when a frame is complete.
 */
function drain(state, onMessage, onClose, onPing){
  for(;;){
    const buf = state.buffer;
    if(buf.length < 2) return;

    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let length = buf[1] & 0x7f;
    let offset = 2;

    if(length === 126){
      if(buf.length < offset + 2) return;
      length = buf.readUInt16BE(offset);
      offset += 2;
    }else if(length === 127){
      if(buf.length < offset + 8) return;
      const big = buf.readBigUInt64BE(offset);
      // A frame this large is not something this game sends, and treating it as
      // a number silently would be a bug that only shows up under load.
      if(big > BigInt(Number.MAX_SAFE_INTEGER)) return onClose(1009, 'frame too large');
      length = Number(big);
      offset += 8;
    }

    let mask = null;
    if(masked){
      if(buf.length < offset + 4) return;
      mask = buf.subarray(offset, offset + 4);
      offset += 4;
    }

    if(buf.length < offset + length) return;   // frame not all here yet

    const payload = Buffer.from(buf.subarray(offset, offset + length));
    if(mask) for(let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    state.buffer = buf.subarray(offset + length);

    if(opcode === OP.text) onMessage(payload.toString('utf8'));
    else if(opcode === OP.ping) onPing(payload);
    else if(opcode === OP.close) return onClose(1000, 'client closed');
    // pong and continuation frames are ignored: this server never fragments
    // and never needs to hear that a ping came back.
  }
}

/* Is this request asking to become a WebSocket? */
export const isUpgrade = req =>
  String(req.headers.upgrade || '').toLowerCase() === 'websocket'
  && String(req.headers['sec-websocket-version'] || '') === '13'
  && typeof req.headers['sec-websocket-key'] === 'string';

/* Completes the handshake and returns a small socket wrapper.
 *
 * The wrapper is deliberately tiny — send, close, and two callbacks — because
 * everything above it should be reasoning about the game, not about frames.
 */
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
