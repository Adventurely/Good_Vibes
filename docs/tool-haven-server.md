# The deployed server: multiplayer and persistence on Tool Haven

This is the documentation for the half of the game nobody in this repository
can see. The live site is a Cloudflare Worker in the private
`Adventurely/Tool-Haven` repo; this file describes exactly what that Worker
does with our game, so the ❓ rows in the README's deploy warning are now
answered here. It was written by reading and porting both sides, and the
behaviours below are pinned by that repo's test suite (20 assertions driving
the ported room over the wire).

**The one-line summary:** the deployed server is a port of this repo's
`src/rooms.js` — same rules, same protocol, same per-player views — wrapped in
a Cloudflare Durable Object that adds real authentication and real
persistence. Game rules live *here*; if you change `rooms.js`, the change must
be re-ported (see [Keeping the two in sync](#keeping-the-two-in-sync)).

---

## Architecture

```
browser ── wss://…/api/good-vibes/ws?code=QF7K&token=…
   │
   ▼
Cloudflare Worker (Tool Haven src/worker.js)
   1. session cookie → signed-in account, or the socket is refused (401)
   2. tool grant check: the account must hold `good-vibes` (admins implicitly do)
   3. room code validated: /^[A-Z0-9]{4,6}$/, folded to upper case
   4. identity STAMPED onto the URL: pid = account id, name = username
   │
   ▼
Durable Object: one `GoodVibesRoom` per room code (idFromName(code))
   └── holds a ported copy of this repo's Room class
       · same handle(): class / ready / start / intent messages
       · same viewFor(): per-seat views, hands secret
       · plus: serialisation to survive hibernation (see Persistence)
```

One Durable Object exists per room code, created on first join and addressed
by the code itself — the same code always reaches the same object, from any
Cloudflare location.

## Identity: who a seat belongs to

This is the biggest deliberate difference from the local server, and it is a
**seam** change, not a rules change:

| | local (`src/server.js`) | deployed |
| --- | --- | --- |
| seat token | client-chosen string in the URL | **the signed-in account id** |
| the client's `token=` param | is the seat | **ignored** |
| display name | `{t:'name'}` message | session username on join; `{t:'name'}` still works |

The Worker writes `pid` and `name` into the socket URL *after*
authentication, overwriting whatever the browser sent. The room object trusts
those fields, which is safe precisely because no browser can set them. What
this buys:

- **Reconnects are free and unforgeable.** Close the tab, come back
  tomorrow, join the same code — you are the same character, because you are
  the same account. There is no token to lose and none to steal.
- **Joining as somebody else is not a thing a URL can do.** Locally, anyone
  who knows your token string is you. On the site, a seat is an account.
- **Two tabs, one account** land on the same seat. The room only marks the
  seat disconnected when the *last* socket for that account closes.

## The wire protocol

Identical to `src/rooms.js` — the deployed room passes every message to the
ported `handle()` untouched.

**Client → server** (all JSON):

| message | meaning |
| --- | --- |
| `{t:'ping'}` | keepalive; changes nothing, never answered |
| `{t:'name', name}` | rename (≤24 chars); session username wins on rejoin |
| `{t:'class', classId}` | claim a class in the lobby (`null` releases it) |
| `{t:'ready', ready}` | lobby: flag for the host · build: vote to bring the surge |
| `{t:'start'}` | host only; deals decks, generates the site, enters build |
| `{t:'intent', intent}` | everything in play — see below |

Build-phase intents: `moveTo {x,y}` (pathfinds; refused if unreachable),
`gather {node}`, `brew {recipe}` (Alchemist), `place {building,x,y}` and
`upgrade {upgrade}` (Engineer). Combat intents: `play {card,index,target}`
and `wait`. All validation is server-side; an illegal intent is simply not
applied.

**Server → client:**

| message | meaning |
| --- | --- |
| `{t:'state', state}` | your view, after anything changed — see Secrecy |
| `{t:'rejected', message}` | join refused (room full / run already started); socket stays open so the reason is readable |
| `{t:'error', message}` | a message you sent threw; goes only to you |

Inside `state.events` (drained per player, delivered exactly once): `log`
(prose), `phase` (splash card: `title`, `subtitle`), `fx` (animation:
`kind`, `player`, `target`) and `moved` (a walk path to animate).

An `fx` names a **card** when a card caused it and an **effect kind**
otherwise; the client resolves card-first, kind-second (see `public/fx.js`),
so a new card animates and sounds like its verb on the day it is written.
Three `fx` kinds carry extra fields and are worth naming:

| fx | extra fields | what the client does with it |
| --- | --- | --- |
| `slain` | `target`, `enemy`, `last` | dissolves the body over ~900ms. `last: true` means that kill emptied the lane, and the client **holds the combat board open for 1.9s** before applying the rest of the update |
| `ail` | `ail` (`rot` / `weak` / `stun`), `from` | motes falling onto the player who was afflicted |
| `rot` | `player` | the per-round tick of an existing Blightrot |

The hold is the one place the client defers a state update. The room ends a
round the instant the wave is empty and sends the kill and the next phase in
the same message — correct of it, and it meant the last enemy of a round died
on the same frame the build-phase splash covered it. `applyState()` in
`play.html` splits that one update in two: the enemy deaths land on the board
already on screen, and everything that follows from the round being over waits
out the animation. Nothing is dropped and nothing is decided client-side —
it is one update, shown in the order a person wants to watch it. Reduced
motion skips the hold with the rest of the motion.

## Secrecy: what another player can see of you

The room builds a separate view per socket — there is no broadcast state.
From any other seat you are: name, class, hp, position, connection, ready
flag, `deckCount` / `discardCount` / `handCount`, and — once you have
committed — the *fact* of your intent (`{t:'play'}`), never which card. Your
own view is the only one carrying your `deck`, `discard` and `hand` as actual
cards. This is enforced at the server; no client setting can widen it.

## Persistence

The Durable Object stores the room after **every** handled message, under a
single storage key. What is stored is the complete serialised room:

```
code, seed, serial,                     — identity and the seat counter
rngCalls,                               — see "The generator survives"
phase, round, outcome,
site,                                   — the run's ground, generated once and kept
terrain, nodes, buildings, enemies,
stash, salvage, pages, upgrades, power, — every shared pool
players[]                               — everything per seat except the socket:
                                          token, name, class, hp, position,
                                          deck / discard / hand, block, intent,
                                          effects, undelivered events
```

Two fields in there are newer than the rest and easy to drop in a re-port,
because both are counters the fight reads rather than state the fight sets:

- `players[].effects` — the statuses a player is carrying (`rot`, `weak`,
  `stun`, `might`, `regen`), each `{kind, amount, rounds, fresh, from}`. These
  are **public** in the view: an Alchemist deciding whether to spend a Censer
  has to be able to see who is rotting.
- `enemies[].landed` — how many blows that enemy has landed. The ailment
  cadence is arithmetic on this counter rather than a roll, so it has to
  survive a wake or a Rust Hulk starts counting again every time the room
  sleeps.

### What that means in practice

- **A run survives everything short of deletion.** Server redeploys,
  Cloudflare moving the object between machines, every player closing their
  laptop — the run is still there when the code is rejoined. This is
  *stronger* than the local server, which holds rooms in memory and drops
  them when the last socket closes.
- **Mid-run rooms are resumable by design.** Everyone can leave a
  half-finished run and pick it up tomorrow; seats reattach by account.
- **Finished and never-started rooms clear themselves.** When the last
  player disconnects from a room whose phase is `over` (run finished) or
  `lobby` (never started), the object deletes its storage so the code can
  host a fresh run — matching the local server's `dropIfEmpty`. A room
  mid-`build`/`combat` is the one case deliberately kept.
- **There is no meta-progression store.** Nothing persists *across* runs —
  no accounts-level unlocks, no run history. When a run ends, its storage is
  the only record and it clears on the way out. If we ever want run history
  or unlocks, that is a D1 table on the Tool Haven side, not room storage.

### The generator survives (and why `rngCalls` exists)

Everything random — site generation, item spawns, salvage rolls — comes from
one seeded generator owned by the room. A generator is a closure and cannot
be stored, so the room stores **the seed plus how many draws have happened**
and replays that many draws on wake. The port's test suite proves a restored
generator continues the exact stream the stored one would have produced.
Per-player shuffle streams (`streamFor`) need no such treatment: they are
recreated fresh per operation and are pure functions of `(seed, player id)`.

### Delivered events never come back

Broadcast happens **before** save, always. Broadcasting drains each player's
one-shot event queue (splash cards, logs, fx), so the state that reaches
storage is the drained one. The one time this ordering was reversed, every
hibernation wake replayed the previously delivered events — the phase splash
popped up on every card play. The ordering is load-bearing; there is a
comment on the deployed `save()` saying exactly this.

Events for *disconnected* players do accumulate in storage — on purpose.
They are delivered when that seat reconnects.

## Hibernation, in one paragraph

Cloudflare evicts idle Durable Objects from memory while keeping their
WebSockets alive (the "hibernation API"). Any message can therefore arrive at
a freshly re-constructed object. The deployed room handles this by restoring
itself from storage in the constructor, and by never storing socket handles
on players — each seat instead holds a sender that looks up the live sockets
for its account at call time. An eviction and wake is invisible to players:
same room, same hands, same generator, socket still open.

## Differences from the local server, complete list

| behaviour | local `npm start` + `node src/server.js` | deployed |
| --- | --- | --- |
| authentication | none — any token string | Tool Haven sign-in + `good-vibes` grant |
| seat identity | client token string | account id (client token ignored) |
| display name | `Player N` until `{t:'name'}` | session username, `{t:'name'}` still honoured |
| room lifetime | in memory; dropped when last socket closes | stored; mid-run rooms survive empty, finished/lobby rooms self-clear |
| run resumability | none | full — rejoin the code, resume the run |
| redeploy behaviour | all rooms lost | all rooms kept |
| rules, protocol, views | `src/rooms.js` | port of the same file |

## Keeping the two in sync

The port is a copy with seams changed, not a fork of the rules:

1. **Game rules change here first** — `src/rooms.js` and `public/content.js`,
   with tests. `content.js` needs no porting at all: the deployed Worker
   imports the synced copy directly, which is why the README's export
   contract (`PUBLISHED` in `test/content.test.js`) matters — a dropped
   export is a Worker-wide crash on the live site.
2. **`rooms.js` changes must be re-ported** by someone with Tool Haven
   access. The ported file is `src/game/good-vibes.js` there, marked with a
   header saying exactly what the seams are: `join(token, socket, name)`
   takes the session name, `serialize()`/`restore()` exist for hibernation,
   player ids come from an instance counter, and there is no module-level
   room registry (the Durable Object *is* the registry).
3. **The protocol is the contract.** If a client change needs a new message
   or a new field in the view, that is a `rooms.js` change (step 2), and the
   client must tolerate the old server until the port lands — the deploy
   order is Worker first, then `public/`.

## Operational notes

- The socket path on the live site is `/api/good-vibes/ws`. It is checked
  against the `good-vibes` tool grant *specifically* — signing in is not
  enough; the account needs the tool. Admin accounts hold every tool.
- Rejections are messages, not hang-ups: a full room or an in-progress run
  answers `{t:'rejected'}` on an open socket, so the player reads why.
- An exception while handling your message becomes `{t:'error'}` to you
  alone; the room state is unchanged and nobody else hears about it.
- There is no way to spectate: a socket that reaches the room is a seat or a
  rejection.
