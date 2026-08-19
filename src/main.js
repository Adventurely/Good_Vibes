#!/usr/bin/env node
/* Entry point: npm start.
 *
 * A stand-alone server. Nothing is copied anywhere, nothing is deployed from
 * here — clone it, run it, open the menu, pick a game. */

import { config } from './config.js';
import { createServer } from './http/server.js';
import { games } from './games/catalog.js';

const server = createServer();

server.listen(config.port, config.host, () => {
  const { host, port } = config;
  console.log(`Games on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`);
  for(const game of games()){
    console.log(`  ${game.title.padEnd(16)} /games/${game.id}/`);
  }
});

for(const signal of ['SIGINT', 'SIGTERM']){
  process.on(signal, () => server.close(() => process.exit(0)));
}
