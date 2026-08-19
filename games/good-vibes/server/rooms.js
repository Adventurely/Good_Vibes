/* The live rooms, keyed by code.
 *
 * A room is created on first join and dropped when the last socket for it
 * closes. Nothing here survives a restart: this is the local server, and the
 * deployed one persisted rooms instead — see docs/history/tool-haven-server.md
 * for that design.
 */

import { Room } from './room.js';

const rooms = new Map();

export function roomFor(code){
  let room = rooms.get(code);
  if(!room){
    room = new Room(code);
    rooms.set(code, room);
  }
  return room;
}

export function dropIfEmpty(room){
  if(room.empty) rooms.delete(room.code);
}

export const roomCount = () => rooms.size;
