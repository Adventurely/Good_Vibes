/* One Durable Object per room code.
 *
 * The object is the only writer of game state, which is what makes cheating a
 * non-issue: clients send intents, the engine validates them, and the object
 * broadcasts a per-player view that omits everyone else's hand.
 *
 * WebSockets use the hibernation API so an idle room costs nothing while five
 * people argue about who takes the last Sunflower.
 */

import { DurableObject } from 'cloudflare:workers';
import * as G from './solarium.js';

/* Rooms outlive deploys. A room saved by an older build can be missing fields
   that newer rules assume exist, and the failure is ugly and far from the
   cause — Object.entries(undefined) throwing deep inside the enemy phase, for
   instance. Fill the gaps on load rather than defending at every use site. */
function migrate(state){
  if(!state) return null;
  state.turret ||= {};
  state.events ||= [];
  state.enemies ||= [];
  state.players ||= [];
  if(typeof state.version !== 'number') state.version = 0;
  if(typeof state.round !== 'number') state.round = 0;
  if(typeof state.level !== 'number') state.level = 0;
  for(const p of state.players){
    p.draw ||= []; p.hand ||= []; p.discard ||= []; p.deck ||= [];
    for(const k of ['hp','maxHp','shield','solar','bonusSolar','might','thorns','regen','weaken']){
      if(typeof p[k] !== 'number') p[k] = 0;
    }
    // networks became an array of required networks after the first build.
    if(p.network !== undefined && p.networks === undefined) delete p.network;
  }
  for(const e of state.enemies){
    if(typeof e.shield !== 'number') e.shield = 0;
    if(typeof e.rust !== 'number') e.rust = 0;
  }
  return state;
}

export class SolariumRoom extends DurableObject {
  constructor(ctx, env){
    super(ctx, env);
    this.state = null;
    ctx.blockConcurrencyWhile(async () => {
      this.state = migrate((await ctx.storage.get('state')) || null);
    });
  }

  async fetch(request){
    const url = new URL(request.url);

    if(request.headers.get('Upgrade') !== 'websocket'){
      return new Response('Expected a WebSocket.', { status: 426 });
    }

    const code = (url.searchParams.get('code') || '').toUpperCase();
    const name = url.searchParams.get('name') || 'Player';
    const pid = url.searchParams.get('pid') || crypto.randomUUID();
    const create = url.searchParams.get('create') === '1';
    // Dev rooms are declared when the room is first opened and never after, so
    // the controls cannot appear partway through somebody's real run.
    const dev = url.searchParams.get('dev') === '1';

    if(!this.state){
      if(!create) return new Response('No such room.', { status: 404 });
      // Seed from the code so a room's shuffles are stable across restarts.
      let seed = 0;
      for(const ch of code) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
      this.state = G.newRoom(code, seed || 1, dev);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid, name });

    try{
      const existing = this.state.players.find(p => p.id === pid);
      if(existing){
        existing.connected = true;          // reconnect keeps your seat and deck
        existing.name = name;
      }else{
        G.addPlayer(this.state, pid, name);
      }
    }catch(err){
      /* Do not hang up on a failed join.
       *
       * Closing here is why "that run has already started" and "this room is
       * full" both surfaced to the player as a bare disconnection, with no way
       * to tell a real network drop from a rule they tripped over. The socket
       * stays open and carries the reason instead. */
      server.send(JSON.stringify({ t: 'rejected', message: err.message }));
      return new Response(null, { status: 101, webSocket: client });
    }

    await this.save();
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw){
    let msg;
    try{ msg = JSON.parse(raw); }catch{ return; }
    const { pid } = ws.deserializeAttachment() || {};
    if(!pid || !this.state) return;

    try{
      switch(msg.t){
        case 'class':   G.setClass(this.state, pid, msg.classId); break;
        case 'ready':   G.setReady(this.state, pid, msg.ready); break;
        case 'start':   G.startRun(this.state, pid); break;
        case 'play':    G.playCard(this.state, pid, msg.index, msg.target, msg.as); break;
        case 'end':     G.endTurn(this.state, pid, msg.as); break;
        case 'unend':   G.unendTurn(this.state, pid, msg.as); break;
        case 'dev':     G.devCommand(this.state, pid, msg.cmd, msg.arg); break;
        case 'reward':  G.pickReward(this.state, pid, msg.card); break;
        case 'again': {
          // Same people, same seats, fresh run.
          const players = this.state.players.map(p => ({ id: p.id, name: p.name, connected: p.connected }));
          const seed = (this.state.seed * 7 + 13) | 0;
          this.state = G.newRoom(this.state.code, seed);
          for(const p of players){ G.addPlayer(this.state, p.id, p.name); }
          break;
        }
        case 'ping': return;               // keepalive, no state change

        /* Pointer positions are chatter, not game state: relayed straight to
           the other seats, never validated, never saved, never versioned. At
           fifteen updates a second from five players, persisting them would
           be the busiest thing in the room and none of it matters. */
        case 'cursor': {
          const wire = JSON.stringify({
            t: 'cursor', pid,
            x: Math.max(-0.2, Math.min(1.2, Number(msg.x) || 0)),
            y: Math.max(-0.2, Math.min(1.2, Number(msg.y) || 0)),
            target: typeof msg.target === 'string' ? msg.target.slice(0, 40) : null,
            // The card being lined up, so the table can see it coming.
            card: typeof msg.card === 'string' ? msg.card.slice(0, 40) : null
          });
          for(const other of this.ctx.getWebSockets()){
            const who = other.deserializeAttachment() || {};
            if(who.pid !== pid){ try{ other.send(wire); }catch{ /* closing */ } }
          }
          return;
        }

        default: return;
      }
      this.state.version++;
      await this.save();
      this.broadcast();
    }catch(err){
      ws.send(JSON.stringify({ t: 'error', message: err.message }));
    }
  }

  async webSocketClose(ws){
    const { pid } = ws.deserializeAttachment() || {};
    if(!this.state || !pid) return;
    const p = this.state.players.find(x => x.id === pid);
    if(p) p.connected = false;

    // In the lobby a leaver should free their class; mid-fight their seat is
    // held so they can rejoin, but the round must not wait on them.
    if(this.state.phase === 'lobby'){
      this.state.players = this.state.players.filter(x => x.connected);
    }else if(this.state.phase === 'playing'){
      try{ G.endTurn(this.state, pid); }catch{ /* already ended */ }
    }
    await this.save();
    this.broadcast();
  }

  async save(){
    await this.ctx.storage.put('state', this.state);
  }

  broadcast(){
    const sockets = this.ctx.getWebSockets();
    for(const ws of sockets){
      const { pid } = ws.deserializeAttachment() || {};
      try{
        ws.send(JSON.stringify({ t: 'state', state: G.viewFor(this.state, pid) }));
      }catch{ /* socket already gone; close handler will tidy up */ }
    }
    // Events are a one-shot animation feed, not part of the durable record.
    this.state.events = [];
  }
}
