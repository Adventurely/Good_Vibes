/* One Durable Object for the whole of Duck Duck Quack's board.
 *
 * Not one per anything: a leaderboard is everyone in one place by definition,
 * so there is nothing to shard by, and one object is what makes "the top ten"
 * one answer rather than a merge of several that each saw a different set of
 * players. The Worker reaches it by name — `idFromName('duck-duck-quack')` —
 * so every request anywhere in the world lands on the same rows.
 *
 * A separate class from SunwardBoard, and deliberately so. The two boards hold
 * different shapes (five counters against a map of levels) and one class with
 * a mode flag would be a class where a change for one game can break the
 * other. The eighty lines below are cheaper than that coupling; everything
 * that decides anything is in `duck-board.js`, which is the module the dev
 * server calls too, so the two ends cannot disagree.
 */

import { DurableObject } from 'cloudflare:workers';
import { serve, migrateStore, MAX_BODY, TOO_LARGE, BAD_JSON } from './duck-board.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

/* Read a body as text, or null the moment it runs past `cap`. Cancelling the
   stream rather than reading it all and measuring afterwards, because the cap
   is the point: the whole body is what we are declining to hold. */
async function readCapped(request, cap){
  if(Number(request.headers.get('content-length')) > cap) return null;
  if(!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for(;;){
    const { done, value } = await reader.read();
    if(done) break;
    size += value.byteLength;
    if(size > cap){ await reader.cancel(); return null; }
    chunks.push(value);
  }
  return new Blob(chunks).text();
}

export class DuckBoard extends DurableObject {
  constructor(ctx, env){
    super(ctx, env);
    /* One key, the whole map. MAX_PLAYERS in the rules module is what keeps it
       under the size a value may be; if that cap ever moves up by an order of
       magnitude, this becomes a key per row and a list() on load. */
    this.store = { players: {} };
    ctx.blockConcurrencyWhile(async () => {
      this.store.players = (await ctx.storage.get('players')) || {};
      // Saved back only if anything actually moved, so a cold start on an
      // up-to-date store writes nothing.
      if(migrateStore(this.store)) await ctx.storage.put('players', this.store.players);
    });
  }

  async fetch(request){
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams);
    let reply;

    if(request.method === 'POST' || request.method === 'DELETE'){
      const raw = await readCapped(request, MAX_BODY);
      if(raw === null){
        reply = TOO_LARGE;
      }else{
        let body;
        try{ body = JSON.parse(raw); }catch{ reply = BAD_JSON; }
        if(!reply){
          reply = serve(this.store, request.method, body, query, Date.now());
          // Only a 200 changed anything; a refusal has nothing to save.
          if(reply.status === 200) await this.ctx.storage.put('players', this.store.players);
        }
      }
    }else{
      reply = serve(this.store, request.method, null, query, Date.now());
    }

    const headers = { ...JSON_HEADERS };
    if(reply.status === 405) headers.Allow = 'GET, POST, DELETE';
    if(reply.status === 429) headers['Retry-After'] = String(Math.ceil(reply.body.retryIn / 1000));
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers });
  }
}
