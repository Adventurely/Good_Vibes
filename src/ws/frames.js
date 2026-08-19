/* RFC 6455 framing, and nothing else.
 *
 * This project has no dependencies on purpose, and Node ships a WebSocket
 * *client* but not a server — so the framing is here. Text frames in, text
 * frames out, ping answered, close handled.
 *
 * What is deliberately not here: extensions (no permessage-deflate), binary
 * frames, and backpressure beyond what a socket write already does. A turn
 * based game sends a few kilobytes of JSON per action, so none of that earns
 * its complexity.
 */

export const OP = { text: 0x1, close: 0x8, ping: 0x9, pong: 0xa };

/* Frames a payload for sending. Server frames are never masked; the length
   takes one of three shapes depending on how big the payload is, which is the
   only fiddly part. */
export function frame(payload, opcode = OP.text){
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
export function drain(state, onMessage, onClose, onPing){
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
