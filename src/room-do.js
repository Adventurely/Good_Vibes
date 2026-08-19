/* One Durable Object per room code.
 *
 * The game itself is `Room` in rooms.js — the same module `npm start` runs, not
 * a copy of it. This object is only the seams: sockets, and surviving eviction.
 * That is the whole point of hosting the game on its own Worker. The rules used
 * to exist twice, here and in the repo, and every rule change had to be made in
 * both by hand; now there is one.
 *
 * Identity is the client's token, exactly as on the local server: a room code
 * is the only thing standing between a player and a seat, by choice. The token
 * is the seat, not the connection — a dropped socket comes back to the
 * character it was playing rather than to a fresh one.
 *
 * Sockets are never stored on players directly. Each player gets a sender that
 * looks up the live hibernatable sockets by token at call time, which is what
 * makes a wake after eviction transparent: the closure survives in memory while
 * the object is warm, and after a reload `restore` hands every seat a new one.
 */

import { DurableObject } from 'cloudflare:workers';
import { Room } from './rooms.js';

export class GameRoom extends DurableObject {
  constructor(ctx, env){
    super(ctx, env);
    this.room = null;
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get('room');
      if(stored){
        this.room = Room.restore(stored);
        for(const p of this.room.players) p.socket = this.senderFor(p.token);
      }
    });
  }

  /* A socket-shaped object that finds the live connection(s) for a seat when
     asked to send, rather than holding one that hibernation will kill. Two tabs
     on one token both get the state, which is what makes a second screen work
     without the room knowing anything about screens. */
  senderFor(token){
    const ctx = this.ctx;
    return {
      open: true,
      send: (str) => {
        for(const ws of ctx.getWebSockets()){
          const who = ws.deserializeAttachment() || {};
          if(who.token === token){
            try{ ws.send(str); }catch{ /* closing; the close handler tidies */ }
          }
        }
      },
    };
  }

  async fetch(request){
    const url = new URL(request.url);

    if(request.headers.get('Upgrade') !== 'websocket'){
      return new Response('Expected a WebSocket.', { status: 426 });
    }

    const code = (url.searchParams.get('code') || '').toUpperCase();
    const token = url.searchParams.get('token') || '';
    // The Worker checks both before forwarding, so reaching here without them
    // is a bug rather than a bad client. Refuse rather than invent a player.
    if(!code || !token) return new Response('No room or no seat.', { status: 400 });

    if(!this.room) this.room = new Room(code);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ token });

    const player = this.room.join(token, this.senderFor(token));
    if(!player){
      /* Refused rather than dropped: "the room is full" is something the
         player should read, not infer from a dead socket. */
      server.send(JSON.stringify({
        t: 'rejected',
        message: this.room.phase === 'lobby'
          ? 'That room is full.'
          : 'That run has already started.',
      }));
      return new Response(null, { status: 101, webSocket: client });
    }

    this.room.broadcast();
    await this.save();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw){
    let msg;
    try{ msg = JSON.parse(raw); }catch{ return; }
    const { token } = ws.deserializeAttachment() || {};
    if(!token || !this.room) return;
    const player = this.room.players.find(p => p.token === token);
    if(!player) return;
    if(msg.t === 'ping') return;               // keepalive, changes nothing

    try{
      this.room.handle(player, msg);
      await this.save();
    }catch(err){
      // Errors go back to the one player who caused them, not the whole room.
      try{ ws.send(JSON.stringify({ t: 'error', message: 'That did not work.' })); }catch{ /* gone */ }
    }
  }

  async webSocketClose(ws){ await this.dropped(ws); }

  // A socket that errors never reaches webSocketClose. Without this the player
  // stays listed as connected and the room waits on somebody who is gone.
  async webSocketError(ws){ await this.dropped(ws); }

  async dropped(ws){
    const { token } = ws.deserializeAttachment() || {};
    if(!this.room || !token) return;
    // Only mark the seat away when its last socket is gone — one player can
    // have two tabs open, and closing one should not fold the character.
    const stillHere = this.ctx.getWebSockets().some(other =>
      other !== ws && (other.deserializeAttachment() || {}).token === token);
    if(stillHere) return;
    const player = this.room.players.find(p => p.token === token);
    if(!player) return;
    this.room.leave(player);

    /* The local server drops an empty room outright; here the answer depends
       on what the room was doing. A finished or never-started room clears so
       the code can host a fresh run — but a run in progress is kept: everyone
       stepping away and coming back to the same fight tomorrow is what a
       Durable Object buys over an in-memory map. */
    if(this.room.empty && (this.room.phase === 'over' || this.room.phase === 'lobby')){
      this.room = null;
      await this.ctx.storage.deleteAll();
      return;
    }

    this.room.broadcast();
    await this.save();
  }

  /* The Room broadcasts inside its own handlers, and broadcasting drains each
     player's one-shot event queue — so the state that reaches storage is the
     drained one. Saving first would replay every delivered splash and log line
     on the next wake. */
  async save(){
    await this.ctx.storage.put('room', this.room.serialize());
  }
}
