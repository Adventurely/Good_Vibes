import http from 'node:http';

import { handleRequest } from './app.js';
import { isUpgrade, accept } from './ws.js';
import { roomFor, dropIfEmpty } from './rooms.js';

const WS_PATH = '/api/good-vibes/ws';
const CODE_RE = /^[A-Z0-9]{4,6}$/;

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('Request failed:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('Internal Server Error');
  });
});

/* The socket half. Same route the deployed site uses, so the client does not
 * care whether it is talking to this or to the deployed Worker.
 *
 * The token in the query string is the seat, not the connection: a dropped
 * socket comes back to the character it was playing rather than to a new one.
 */
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const code = (url.searchParams.get('code') || '').toUpperCase();
  const token = url.searchParams.get('token') || '';

  if(url.pathname !== WS_PATH || !isUpgrade(req) || !CODE_RE.test(code) || !token){
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    return socket.destroy();
  }

  const ws = accept(req, socket, head);
  const room = roomFor(code);
  const player = room.join(token, ws);

  if(!player){
    // Refused rather than dropped: "the room is full" is something the player
    // can act on, and a silent close looks like a network fault.
    ws.send(JSON.stringify({
      t: 'rejected',
      message: room.phase === 'lobby' ? 'That room is full.' : 'That run has already started.',
    }));
    ws.close();
    return dropIfEmpty(room);
  }

  ws.onMessage(text => {
    let msg;
    try{ msg = JSON.parse(text); }catch{ return; }
    try{
      room.handle(player, msg);
    }catch(err){
      console.error(`Room ${code}: ${err.stack || err}`);
      ws.send(JSON.stringify({ t: 'error', message: 'That did not work.' }));
    }
  });

  ws.onClose(() => {
    room.leave(player);
    room.broadcast();
    dropIfEmpty(room);
  });

  room.broadcast();
});

server.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
  console.log(`Rooms on ws://${host}:${port}${WS_PATH}?code=XXXX`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
