import http from 'node:http';
import { randomUUID } from 'node:crypto';

import { handleRequest } from './app.js';
import { isUpgrade, accept } from './ws.js';
import { roomFor, dropIfEmpty } from './rooms.js';
import * as Solarium from './solarium.js';

const WS_PATH = '/api/good-vibes/ws';
const SOLARIUM_WS = '/api/solarium/ws';
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

  if(url.pathname === SOLARIUM_WS && isUpgrade(req) && CODE_RE.test(code)){
    return solariumUpgrade(req, socket, head, url, code);
  }

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

/* Save Solarium, locally.
 *
 * In production each room is a Durable Object; here they are a Map, exactly as
 * Good Vibes' rooms are. The rules are the same module either way — this is
 * only the socket end of it, so the game can be played on a laptop with two
 * tabs rather than only after a deploy.
 */
const solariumRooms = new Map();

function solariumUpgrade(req, socket, head, url, code){
  const name = url.searchParams.get('name') || 'Player';
  const pid = url.searchParams.get('pid') || randomUUID();
  const create = url.searchParams.get('create') === '1';
  const dev = url.searchParams.get('dev') === '1';

  let room = solariumRooms.get(code);
  if(!room){
    if(!create){
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      return socket.destroy();
    }
    // Seed from the code, so a room's shuffles are stable across restarts.
    let seed = 0;
    for(const ch of code) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
    room = { state: Solarium.newRoom(code, seed || 1, dev), seats: new Map() };
    solariumRooms.set(code, room);
  }

  const ws = accept(req, socket, head);
  room.seats.set(pid, ws);

  const broadcast = () => {
    for(const [who, sock] of room.seats){
      try{ sock.send(JSON.stringify({ t: 'state', state: Solarium.viewFor(room.state, who) })); }
      catch{ /* going away; the close handler tidies */ }
    }
    room.state.events = [];
  };

  try{
    const seated = room.state.players.find(p => p.id === pid);
    if(seated){ seated.connected = true; seated.name = name; }
    else Solarium.addPlayer(room.state, pid, name);
  }catch(err){
    // A rule, not a network fault — say which, and leave the socket open.
    ws.send(JSON.stringify({ t: 'rejected', message: err.message }));
  }

  ws.onMessage(text => {
    let msg;
    try{ msg = JSON.parse(text); }catch{ return; }
    if(msg.t === 'ping') return;
    if(msg.t === 'cursor'){
      const wire = JSON.stringify({ t: 'cursor', pid, x: msg.x, y: msg.y,
        target: msg.target ?? null, card: msg.card ?? null });
      for(const [who, sock] of room.seats){ if(who !== pid) try{ sock.send(wire); }catch{} }
      return;
    }
    try{
      switch(msg.t){
        case 'class':  Solarium.setClass(room.state, pid, msg.classId); break;
        case 'ready':  Solarium.setReady(room.state, pid, msg.ready); break;
        case 'start':  Solarium.startRun(room.state, pid); break;
        case 'play':   Solarium.playCard(room.state, pid, msg.index, msg.target, msg.as); break;
        case 'end':    Solarium.endTurn(room.state, pid, msg.as); break;
        case 'unend':  Solarium.unendTurn(room.state, pid, msg.as); break;
        case 'dev':    Solarium.devCommand(room.state, pid, msg.cmd, msg.arg); break;
        case 'reward': Solarium.pickReward(room.state, pid, msg.card); break;
        case 'again': {
          const seats = room.state.players.map(p => ({ id: p.id, name: p.name }));
          room.state = Solarium.newRoom(room.state.code, (room.state.seed * 7 + 13) | 0);
          for(const p of seats) Solarium.addPlayer(room.state, p.id, p.name);
          break;
        }
        default: return;
      }
      room.state.version++;
      broadcast();
    }catch(err){
      ws.send(JSON.stringify({ t: 'error', message: err.message }));
    }
  });

  ws.onClose(() => {
    room.seats.delete(pid);
    const seated = room.state.players.find(p => p.id === pid);
    if(seated) seated.connected = false;
    if(room.state.phase === 'lobby'){
      room.state.players = room.state.players.filter(p => p.connected);
    }else if(room.state.phase === 'playing'){
      try{ Solarium.endTurn(room.state, pid); }catch{ /* already ended */ }
    }
    if(room.seats.size === 0) solariumRooms.delete(code);
    else broadcast();
  });

  broadcast();
}

server.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
  console.log(`Good Vibes rooms on ws://${host}:${port}${WS_PATH}?code=XXXX`);
  console.log(`Save Solarium rooms on ws://${host}:${port}${SOLARIUM_WS}?code=XXXX`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
