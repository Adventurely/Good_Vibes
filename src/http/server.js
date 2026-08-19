/* The server: HTTP requests to the router, upgrades to whichever game owns the
 * path. Both halves are wired here so neither has to know about the other. */

import http from 'node:http';

import { gameById } from '../games/catalog.js';
import { isUpgrade, accept } from '../ws/socket.js';
import { handleRequest } from './router.js';

/* /api/games/<id>/<socket path> — namespaced by game for the same reason the
   client files are: a second game must not have to negotiate for a URL. */
const SOCKET_RE = /^\/api\/games\/([^/]+)\/(.+)$/;

function refuse(socket, status, reason){
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function createServer(){
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(err => {
      console.error('Request failed:', err);
      if(!res.headersSent){
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Internal Server Error');
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const match = url.pathname.match(SOCKET_RE);

    if(!match || !isUpgrade(req)) return refuse(socket, 400, 'Bad Request');

    const game = gameById(decodeURIComponent(match[1]));
    if(!game?.socket || match[2] !== game.socket.path) return refuse(socket, 404, 'Not Found');

    // Validated before the handshake, so a request that was never going to work
    // fails as a plain HTTP error rather than as a socket that says nothing.
    const context = { query: url.searchParams, req };
    const problem = game.socket.validate?.(context);
    if(problem) return refuse(socket, 400, 'Bad Request');

    try{
      game.socket.open(accept(req, socket, head), context);
    }catch(err){
      console.error(`Socket for ${game.id} failed to open:`, err);
      socket.destroy();
    }
  });

  return server;
}
