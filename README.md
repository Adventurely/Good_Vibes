# Good Vibe Games

Two games and the site that serves them: **Good Vibes**, built here, and
**Save Solarium**, which moved in from another repo. One Worker, one domain,
one deploy.

> ## Pushing to `main` deploys both games
>
> `main` builds and deploys **good-vibe-games.com**. Each game's client and its
> rules ship in the same Worker from the same commit, so they cannot end up
> disagreeing with each other — which is the whole reason the games live here.
>
> `npm test` before you push. Nothing else is required, and nothing in this
> repository can take another site down any more.

### What is checked here, and what is not

| | |
| --- | --- |
| ✅ Verified in this repo | `public/` is browser-safe: no Node imports, no `process`, no `Buffer` |
| ✅ Verified in this repo | `src/rooms.js` runs on Workers: no `node:` built-ins, and no `Date.now()` or `Math.random()` |
| ✅ Verified in this repo | Both games answer on their own paths, and each keeps its own `content.js` |
| ✅ Verified in this repo | Every name `content.js` has ever exported is still exported (a test pins it) |
| ✅ Verified in this repo | A room survives eviction — `serialize`/`restore`, including the generator's draw count |
| ✅ Verified in this repo | The Worker builds, binds and bundles — `npm run check` |
| ⚠️ Half set up | GitHub Pages is on, but the `github-pages` environment only allows the default branch — see [The preview channel](#the-preview-channel) |

### If the site is down

Check the build first: Cloudflare's dashboard, Workers & Pages → good-vibes →
the latest deployment. A build that failed leaves the previous one serving, so
"my change is not there" and "the site is down" are different problems.

If the pages load but no room will connect, the socket is the thing to look at
— `/api/good-vibes/ws` or `/api/solarium/ws` in `src/worker.js`, and the two
Durable Object bindings in `wrangler.jsonc`. If a room connects but comes back empty after being left
alone, that is `serialize()` in `rooms.js` missing a field, which the
hibernation tests exist to catch before it ships.

---


A co-op solarpunk roguelike. No dependencies anywhere — just the Node standard
library and a browser.

- **`public/index.html`** is the title screen: a generated ruin with the party
  walking it, a theme, and a way in.
- **`public/play.html`** is the game: lobby, build phase, and the surge.
- `npm start` serves both, socket included. See [Playing locally](#playing-locally).

## The title screen

`public/index.html` is the landing page, and the thing on it is
`public/title.js`: a 480&times;262 canvas showing a solarpunk ruin from above,
with a camp in the middle of it and the party walking around gathering what
grew there. It upscales by an integer factor with nearest-neighbour filtering,
and there are no images and no font files anywhere in it.

**It is not an illustration of the game — it is the game, running.** The site
comes out of `generateTerrain`, the herbs and salvage out of `spawnItems`, and
the heroes walk to them along routes `pathTo` found, which is the same
pathfinder the build phase uses. That is the point: a hand-drawn title screen
goes stale the first time somebody adds a class, and this one cannot. A new
class appears on it, a new terrain kind appears under it, a new material
appears in somebody's hands, all without anyone remembering to update a
mock-up. The sky above the horizon is the only thing drawn just for this page —
the ground is pushed down to make room for it, because the camp is stamped at
the centre of every map and the first cut put the logo directly over the
nicest thing in the scene.

The theme is a third song in `audio.js` (`SONGS.title`), synthesised like the
other two: D major, no minor chord anywhere in the loop, a square lead over an
eighth-note arpeggio with a kick under it. Nothing plays until a gesture,
because autoplay policy decides that and not us, and the mute choice is stored
in the same key the game reads — turning the music off here does not mean
turning it back on inside a fight.

Below the screen the page says what the game is, lists the classes straight out
of `CLASSES` (locked seats included, so the party reads as incomplete rather
than as three), and keeps the palette in a drawer for anyone who opens it.

### Art conventions

These are the rules the scene follows. Keeping to them is what makes new art
look like it belongs with the old art.

| Thing              | Convention                                             |
| ------------------ | ------------------------------------------------------ |
| Resolution         | 320 &times; 180 internal, scaled by whole numbers only |
| Palette            | 16 colours, no exceptions, no blending                 |
| Font               | 5 &times; 7 bitmap, 1px tracking, ink outline          |
| Character sprites  | 12 &times; 16, 2 frames per animation                  |
| Gradients          | 4 &times; 4 ordered (Bayer) dither between palette stops |
| Depth              | Distant things lighter and bluer, near things darker   |

Fractional coordinates are the one thing to watch for: `fillRect` antialiases
them, and a soft edge is obvious the moment the canvas is scaled up.

**The game draws bigger.** The table above is this page's scene. `play.html`
shares the palette and the font but authors at its own sizes, because a face
needs more than nine pixels across:

| Thing | Size |
| --- | --- |
| Hero sprites | 32 &times; 40, one skeleton under the whole cast |
| Terrain tiles | 16 &times; 16, noise rather than motifs so they tile |
| Terrain cuts | 1–3 per kind, picked per tile from a coordinate hash |
| Props — tent, trees, panel | bigger than a tile, bottom-anchored |
| Buildings (card art) | 16 &times; 16, transparent at the corners |
| Icons — materials, salvage, cards, marks | 8 &times; 8 |

Heroes are built from a silhouette rather than fixed-width rows — a skull that
rounds at the crown and a jaw that narrows is most of what makes a head look
like a head at this size, and the first cut at 32 &times; 40 framed every face in
a rigid rectangle and read as a box.

**A kind can be cut more than one way.** `TERRAIN_ART` is one tile per kind and
`TERRAIN_VARIANTS` is the list it comes from; the renderer picks a cut per tile
from `hash2(x, y)`, so the ground varies without ever shimmering between
redraws. Every grass tile used to be pixel-identical to every other, which read
as wallpaper however good the individual tile was.

**`PROP_ART` is for things too big for the tile they stand on.** Props are drawn
in the depth-sorted layer with the heroes rather than in the ground pass, which
is what lets you walk behind a tree. Everything in that layer is sorted by its
**ground line in pixels**, not by its tile row: a building top-aligned to its
tile and a hero stood on the tile's floor cannot be compared by row, and used to
be ordered by whichever was pushed into the list first.

**Both canvases clip to below the header strip, and the strip draws last.** A
sprite that overhangs the top of the map is correct — it is a tall thing
standing on the top row — but a tree is three tiles high and a hero two and a
half, so on row 0 they begin sixteen and eight pixels *above* the canvas and
used to paint straight through the title. Clipping means nothing has to know how
tall anything else is, and it covers the ready marks, which fly ten pixels over
a sprite's head, and the combat effects, which lob twenty-six above their start.

### Things that move

There was no frame loop at all until recently — sprites redrew on a click, a
hover or a resolved card, so a site nobody was touching was a still picture.
There is one loop now, driving both canvases:

| | |
| --- | --- |
| Idle breath | one pixel, on the rows above a hero's `split`, out of phase per player |
| Facing | `blit` mirrors at read time, so the cast walks the way it looks |
| Campfire | three frames, plus a pool of light dithered onto the ground |
| Footprints | a few seconds of prints behind a walking hero, on soft ground only |
| Combat | enemy idle bob, hit recoil and flash, a death dissolve, drifting seeds and turning turbines |

It is only affordable because **the ground is cached**. `drawTerrain` is about
130,000 `fillRect`s for the build map and it used to run on every hover twitch;
terrain is a pure function of the tiles and their coordinates, so it is painted
once into an offscreen canvas and stamped back with one `drawImage`. Measured in
the preview, a frame holds 60fps with no spikes.

`prefers-reduced-motion` parks the loop on a clean static frame rather than
juddering, and a hidden tab stops drawing entirely.

**The light changes with the round** — morning, then low gold, then dusk when
the Array wakes. It is a palette remap, not a wash over the top: every pixel is
still one flat opaque palette colour, just a different one by evening. Only the
ground is graded, because grading the cast too made three classes that are meant
to read apart at a glance converge on the same dim brown.

## Hosting

One Worker on **good-vibe-games.com** serves the shelf and both games.

    good-vibe-games.com
      ├── /                    the shelf: public/index.html
      ├── /good-vibes/         Good Vibes
      ├── /solarium/           Save Solarium
      ├── /api/good-vibes/ws   src/worker.js → GameRoom,     one per room code
      └── /api/solarium/ws     src/worker.js → SolariumRoom, one per room code

`public/` ships verbatim, no build step. The Worker is not invoked for files at
all — assets are matched first — so the clients cost zero Worker calls and each
socket costs one.

**Each game keeps its own directory**, and it has to: both ship a `content.js`
and an `art.js`, they are entirely different tables, and the directory is the
only thing keeping them apart. A test asserts each path answers with its own.

**The rules exist once per game.** `src/room-do.js` imports `Room` from
`src/rooms.js`, and `src/solarium-do.js` imports `src/solarium.js`, which in
turn reads `public/solarium/content.js` — the same module its browser imports.
The alternative, which both games have lived through, is a hand-written copy of
the rules on the server that has to be edited in step with every change and
drifts silently when it is not.

**The two games never share a room.** They are separate Durable Object classes,
so a Good Vibes party and a Solarium party that both pick `RUST` get separate
rooms. Memorable codes invite exactly that collision.

There is no sign-in, by choice: the room code is the secret. That is how you
hand a game to four friends in a message instead of in an onboarding flow, and
the cost is that a short code is a guessable code. The answer to that is a
longer code, not an account.

**`npm start` serves all of it** — the shelf, both games, and both sockets.
Rooms live in a Map locally and in a Durable Object in production; the rules
module is the same either way.

**Deploys are GitHub Actions**, not Cloudflare's Workers Builds:
`.github/workflows/deploy.yml` runs the tests, builds the Worker with
`wrangler deploy --dry-run`, and — only then, and only on `main` — uploads it.
One `wrangler deploy` ships the Worker, both room classes and the whole of
`public/` together, so a client and the socket it talks to can never be
different ages.

Keeping it here rather than in the dashboard buys two things: a pull request
gets the same verdict a push does, from a job that holds no credentials; and a
build that fails is a red check next to the commit rather than a state of the
site nobody was told about. **Do not also connect Workers Builds** — two
services watching `main` is two deploys per push, racing to be last.

**One-time setup**, all of it outside this repo:

1. **An API token.** Cloudflare dashboard → My Profile → API Tokens → Create,
   from the **Edit Cloudflare Workers** template. That template already carries
   the `Workers Scripts: Edit` permission an upload needs; Durable Objects need
   nothing beyond it.
2. **Two repository secrets** (Settings → Secrets and variables → Actions):
   `CLOUDFLARE_API_TOKEN` from step 1, and `CLOUDFLARE_ACCOUNT_ID`, which is in
   the right-hand column of Workers & Pages → Overview.
3. **The domain.** After the first successful deploy the Worker exists but
   answers on nothing; bind `good-vibe-games.com` under its Settings → Domains
   & Routes. If another service still holds that hostname it has to release it
   first — one hostname, one service.

Durable Objects need no plan upgrade: the SQLite-backed classes this uses are
on the free tier. Nothing about the deploy depends on the repository's default
branch — `on: push: branches: [main]` is enough on its own, which is the one
way it is easier than the Pages channel below.

### The preview channel

There is a second, lesser publishing path for looking at the game without a
server: pushing anything to the `preview` branch sends `public/` verbatim to
GitHub Pages, where the client's offline `?preview` mode plays a single-seat
run against a fake room. It is the phone-testing URL, and it deliberately
cannot host a real game — rooms and the socket need the deployed Worker.

    git push origin HEAD:preview        # publish whatever you are looking at

Pages is switched on and its source is GitHub Actions, so the workflow itself
is in order. The workflow follows both `main` and `preview`, so the site keeps
up with the branch the repo actually lives on and `preview` is the extra
channel for publishing something that is not on `main` yet.

**What is still in the way: the default branch.** It is
`claude/node-server-hello-world-28lx0w` — the three-file hello world from the
first session — and not `main`. That breaks the deploy, because the
`github-pages` environment accepts deployments only from the **default
branch** unless somebody widens it. A run from `main` or `preview` is
therefore refused before its job starts: it fails in about a second with no
runner, no steps and no logs, which reads like a broken workflow and is not
one. Nothing in a workflow file can lift this; the environment gate sits
above it.

The fix is Settings → General → Default branch → `main`, which is worth doing
on its own account now the repo is public — the default branch is what a
visitor lands on, and right now that is a hello world, not the game. To keep
`preview` publishing too, also add it under Settings → Environments →
`github-pages` → Deployment branches and tags.

## Requirements

- Node.js 18 or newer

## Running

```bash
npm start
```

Then open http://localhost:3000.

The port and bind address can be overridden with environment variables:

```bash
PORT=8080 HOST=127.0.0.1 npm start
```

## Routes

| Route      | Response                          |
| ---------- | --------------------------------- |
| `/`        | The title screen                  |
| `/healthz` | `{"status":"ok"}`                 |
| anything else | `404 Not Found`                |

## Tests

```bash
npm test
```

## Layout

```
public/good-vibes/content.js  the game as data — classes, cards, resources, buildings,
                    enemies, rounds, and the pure functions over them
public/good-vibes/pack.js  the Hauler's bag: the shapes, the items, and the pure
                    geometry over them. Re-exported by content.js, and it
                    imports nothing from it — that cycle would be a throw
public/art.js       the palette, the tiles and their cuts, the props, and every
                    sprite, as text
public/stage.js     the surge's backdrop, painted rather than tiled: sky,
                    skyline, hedge, and a plaza with a sun laid into it
public/fx.js        what a resolved effect looks and sounds like, card first
                    and effect kind second, so nothing lands silently
public/audio.js     the three tracks — title, build, surge — and every sound,
                    synthesised, no files
public/play.html    the game: lobby, build phase, the surge, the options
public/pixel.js     bitmap font and canvas helpers, shared by both pages
public/title.js     the title screen: a real generated site with the real party
                    walking it, drawn from the same modules the game uses
public/index.html   the landing page the title screen is mounted in
src/rooms.js        Good Vibes' authoritative game state: rooms, seats, phases
                    — and the only copy of it, imported by both servers below
src/solarium.js     Save Solarium's rules engine: pure functions over a state
                    object, ported from the repo the game came from
src/worker.js       the deployed front door: assets, and both socket routes
src/room-do.js      one Durable Object per Good Vibes room code
src/solarium-do.js  one Durable Object per Save Solarium room code
public/index.html   the shelf: both games, thumbnails painted by their own
                    renderers rather than screenshotted
public/solarium/    Save Solarium, client and content
wrangler.jsonc      what Cloudflare builds and what it binds
src/server.js       the local server: http + the socket route
src/app.js          static files out of public/, for local work only
src/ws.js           a WebSocket server, standard library only, likewise local
test/content.test.js validates every table above and the rules over them
test/pack.test.js   the pack: rotation, the cut corners, the draw, the budget
test/rooms.test.js  drives a real room: what a card resolves to, statuses,
                    kills, levelling, and that the client has an animation and
                    a sound for all of it
test/server.test.js integration tests
test/balance.mjs    not a test — a harness. Plays whole runs at every table
                    size and reports the win rate against the 60% target
```

**`content.js` is the file to edit.** It is imported by the browser *and* by
the authoritative room, which is what stops the rules and the UI ever
disagreeing about what a potion does. It is also why the file stays
declarative — a throw at its top level would take the Worker down — and
why `test/content.test.js` checks the shape of every class before the deploy
workflow will ship anything.

Adding a class is a block in `CLASSES`, two basics and a list in `CLASS_BASICS`
and `CLASS_ACTIONS`, and a sprite
in `art.js`. Every field is documented above the array, and the test names the
one you missed. The roster is **five of five** — Alchemist, Engineer, Wizard,
Hauler, Grafter — so `OPEN_ROLES` is empty; it is kept as an export because the
Worker imports this module, and a sixth seat would need `PARTY_SIZE` moved
first, which a test pins.

`COMBAT_ACTIONS` is a **deprecated alias of `CARDS`**. It was kept because a
second repo imported this module and a missing export there was a throw at the
top of somebody else's Worker. That repo no longer imports anything from here,
so the alias is now deletable: drop it, and drop its name from `PUBLISHED` in
`test/content.test.js` in the same commit.

**`art.js` is client-only** — the engine references an art key by name and
never reads a sprite. A mistake in there can break a picture but not the
Worker, which makes it the safest file in the project to experiment in.

## The game

Solarpunk co-op roguelike for up to five. A ruin is growing back and the blight
is growing with it; you have three rounds to make the site defensible before the
Extractor wakes up in the fourth.

**A round is two phases.** You build on a site, everyone readies up, and the
blight surges onto a painted stage of its own. Clear the wave and the next round
begins. `phaseCard()` names each turn — "Round One — Build Phase / The party
plans." — from content rather than the client, so the screen animates words it
cannot misquote.

`ROUNDS` is the posted schedule: three named sites, then **The Array**, where
the boss is. `ROUNDS_BEFORE_BOSS` and `BOSS_ROUND` are derived from each other
and pinned by a test, so the run cannot end up one round longer than the wave
tables know about.

A round is **simultaneous** — everyone commits and the whole round resolves when
the last one is in. Five players never watch each other think, and resolution
order is fixed by player id so the same commitments always produce the same
round however the network delivered them.

### Five classes, five economies

Every class spends a different pool, earned a different way, on a different
thing. A test holds the line, because two classes that both gather and both
spend would be one class with two sprites.

| | Alchemist | Engineer | Wizard | Hauler | Grafter |
| --- | --- | --- | --- | --- | --- |
| Flag | `craft` | `build` | `cast` | `haul` | `scout` |
| Pool | `stash` (herbs) | `salvage` (3 kinds) | `pages` | **room** | `uses` |
| Spends on | potions + the garden | the works | spellcraft | the pack | canker |
| Health | 30 | 32 | **22** | 38 | 26 |

The Hauler is the only one that does not spend a pool at all: three items
arrive at his feet every build phase whether he wants them or not, the bag is
smaller than they are, and what does not fit is left on the ground. He spends
*room*. See **[The pack](#the-pack)**.

The Wizard is the roster's glass floor and a test enforces it: strictly the
lowest hp of any class, with a floor of a basic attack and the worst basic
guard. Everything she is, she writes at the bench — see
**[The scriptorium](#the-scriptorium)**.

Everything gatherable stands on the build map. `SPAWNS` puts out 5 herbs, 5
salvage caches and a spell-page cache; herbs need growable ground, caches and
pages only need somewhere walkable. `CACHE_YIELD` is fixed rather than rolled,
so a player can count what a trip is worth before spending the walk. The map's
pages are the bonus — the library itself pays `PAGES_PER_ROUND` at each build
phase while a Wizard is seated, because the draft is her whole game and a round
with no page is a round spent watching.

**Herbs are exactly one per material.** There is no move budget — you can walk
anywhere on the site and pick up everything on it — so the limit on brewing has
to be how much grew. One node per material makes both halves structural rather
than lucky: every recipe is always *possible*, because nothing is ever missing,
and no sweep ever pays for all three, because ten units on a site cannot cover
the eleven that one of each costs. Six nodes drawn purely by weight regularly
grew a site with no Dewglass and no Rustbloom on it — a round where nothing
could be brewed at all, which is the worst thing scarcity can do.

Salvage also arrives *after* a fight: `salvageAfterCombat` pays each seat with
a `salvage` stat a rolled share, and nothing else. Buildings used to pay an
income on top and no longer do — every one of them now buys a standing payout
instead, and a building that also handed back the salvage it cost would be
paying twice for one tile.

### Brewing

Brewing fills a rack. A recipe
has `makes`, and one brew deals several copies, which is what makes the walk
across the site worth the trouble: a Sunpetal you bent down for is three heals,
not one.

| Potion | Costs | Makes | The card does |
| --- | --- | --- | --- |
| Sunsalve | 2 Sunpetal + 1 Dewglass | 3 | heal 6 |
| Stillwater | 2 Dewglass + 1 Copperfern | 2 | ward 6 |
| Greenfire | 1 Cellsap + 1 Rustbloom | 2 | strike 8 |

Each is strictly better than the basic it echoes — Tonic heals 4, Steady Hands
wards 4, Acid Flask strikes 3 — because brewing should always feel like an
upgrade over the card it dilutes. Between the three, every material on the map
has a use, so no herb is ever pointless to bend down for.

Brewed doses are **consumed**: taking one takes it off the rack for good. That
is what stops a good brew being a permanent upgrade, and it is why the
Alchemist's rack changes shape every fight where the Engineer's power just comes
back.

They are hers for the whole run rather than the fight that follows the brew,
which is the shape of her economy against the other four: the Engineer's panels
refill every surge and the Wizard's charges refill every round, but a Sunsalve
spent in round one is not there for the Array. She is the only seat whose
question is *which fight*, and the rack is where that question lives.

### The garden

Three pots by the campfire, and the Alchemist's reason to think past the round
in front of her. Planting takes one cutting of any herb out of the stash;
each round the cutting sits it climbs the yield ladder — `potYield` pays 2,
then 4, then 6 of that material — and harvesting empties the pot back into the
stash. Harvesting what you just planted refunds the cutting and nothing more,
so a misclick is free and there is no same-round loop to farm.

The pots persist across rounds the way the buildings do; they are the part of
her economy that compounds. Every build phase asks the same quiet question of
each pot: brew it this fight, or let it grow toward the boss — her copy of the
Wizard's compound-or-spend tension, in soil. Drag a stash chip onto a pot, or
tap the chip and tap the pot; tap a plant to harvest it.

### The pack

The Hauler's build phase, and the first economy in this game that is a **shape
rather than a number**.

Three items land at his feet every build phase, unasked for and unchosen. The
bag is smaller than they are. What fits is his for the run; what is still loose
when the surge starts is left where it lies.

```
   round 1            round 2            round 3            round 4
   . . . . .          . X X X .          . X X X .          X X X X X
   . X X X .          . X X X .          X X X X X          X X X X X
   X X X X X          X X X X X          X X X X X          X X X X X
   X X X X X          X X X X X          X X X X X          X X X X X
      13                 16                 18                 20
```

**The bag growing is the progression, and it has to be.** The items churn, so
the thing that compounds across a run cannot be the items — it has to be the
container, which is also the only sentence his own bio asks for: *knows to
within a kilo what they can take, and takes that much*. It is legible the way
the wave tables are legible: a bag that visibly grows a row is something you
see, where "+2 capacity" is something you read.

It grows on a schedule rather than being bought, on the precedent the library
already sets — `PAGES_PER_ROUND` pays the Wizard a page every build phase
simply for being seated, because the draft is her whole game. The pack is his
whole game, and health is the one pool in this project that never comes back,
so charging him health for the thing the seat is *made of* would be a toll on
existing. He can pay 3 health to pull the next expansion forward a round, and
that is the only place blood touches the bench.

**A kit is an option; ballast is a number.** Eleven and four:

| | | |
| --- | --- | --- |
| **Kit** | 3–5 cells, awkward | puts a card in his list for as long as it is in the bag |
| **Ballast** | 1–2 cells | flat, applied once as the fight opens, never asks for a turn |

Ballast exists because a packing puzzle without small pieces is a puzzle with
dead holes in it — every inventory-tetris game ever made carries ammunition and
herbs for exactly that reason. A Ballast Plate opens the fight at `heft 2` for
free, which is the whole thesis: the bag is the half of his ramp he does not
bleed for, and packing well is what buys him the health to also afford covering.

**`CLASS_ACTIONS.hauler` is empty, and that is the point.** Set Your Feet, Get
Behind Me and Leg Up were his entire class list and are now pack items with
their numbers unchanged. His floor is two basics; everything above it is
something he found room for. The room appends the rest per player from
`packedCards`, exactly as it appends the Wizard's book — what a seat can do is
not always knowable from its class id. Get Behind Me starts in the bag, because
every other seat has a floor it cannot draw beneath and a Hauler whose first
three finds were all ballast would otherwise open a run with nothing at all.

**No draft, and deliberately not.** An offer of three to keep one is the
Wizard's bench, and a second one would be her build phase in another colour.
The decision here is never *which* — it is *where*, and it is only a decision
because the bag is smaller than what arrives. Round one fits its draw with room
to spare; from round two the bag is full and every find is a swap rather than an
addition. By the boss he is cutting about half of what he has been handed.

A kit already in the bag is never rolled again, the way `rollOffers` refuses a
spell already in the book — a duplicate unique ability is a dead draw. Ballast
repeats freely, because two Ration Tins is four health a round and the whole job
of a small piece is to be the thing that fills the hole.

**One thing to watch, and it is the interaction to balance first.** Heft is
additive on every strike and never wears off, the Winch Crossbow is `strike 6`
free and unlimited, and Set Your Feet stacks. A bag holding a Crossbow, two
Plates and Set Your Feet is throwing 10 a round by turn two, from a seat with 38
health — where a Fireball is 10 for two charges. Free-unlimited strikes and
stacking heft in the same bag is the thing that could make him the strongest
seat by round three; the balance harness already shows him leading damage *and*
guard at every table size. The fix is not to nerf heft, which is what makes him
a battery — it is that the free kits should mostly not be strikes.

**Where the code lives.** `public/good-vibes/pack.js`, re-exported by
`content.js`. The property that matters was never "one file" — it is one
*import surface*, and a re-exported name is on the module's namespace object
identically to a local one, so the Worker's import, the browser's, and the
published-contract test cannot tell the difference. The rule that keeps it safe:
**`pack.js` imports nothing from `content.js`**, because a cycle between them
would put a live binding in the temporal dead zone at module scope, which here
is a throw at the top of the deployed Worker.

Nothing in the item table needed a new effect kind. Every one is something
`EFFECT_KINDS` already lists and the room already resolves, so `fx.js` falls
back to the verb and none of them lands silently — and `test/rooms.test.js`
plays every one of the new strikes through a real room to prove it.

### The scriptorium

The Wizard does not buy spells. She assembles them, and it is her whole build
phase.

A page spent turns over a **draft of three** — spells she has not learned and
modifiers she does not own, rares weighted low — and she keeps one. `SPELLS`
holds the three bones (Fireball, strike 10, 2 charges; Cinder Nova, the lane
for 4, 2 charges; Lend a Page, might 4, 2 charges) and `MODIFIERS` the ten
inks, from a plain `+5 damage` to a rare `x2 damage, -1 charge`. A spell has
**three sockets**; modifiers drag in, out, and between spells freely in any
build phase — and their order is the arithmetic's order. Kindling into a Twin
Core is `(10+5)x2 = 30`; the same two sockets reversed are 25. Duplicates are
a real find — a second Kindling can turn up, and two spells can carry the
same ink — with rares kept genuinely rare by `MODIFIER_WEIGHTS` instead.

**Charges are what a cast costs.** `charges` used to be how many copies of a
spell went into the deck the surge dealt her; it is the price of casting it out
of a pool that fills at the start of a fight and comes back `CHARGE_REGEN` at
the top of every round. Nothing is dealt and nothing is rebuilt — what she can
cast is read off the book every time it is asked for, so a spell drafted or
re-socketed mid-run is castable on the very next round. That is `composeSpell`,
`rollOffers`, `takeOffer` and `moveModifier` in `content.js` — pure, shared, and
the reason the bench, the option list and the surge can never disagree about
what a Fireball has become.

Some inks do more than move numbers: a ward on cast, a heal for half the
damage dealt, a page back on a kill, a copy stacked into the opening hand, a
strike that reaches the farthest thing in the lane instead of the nearest, and
a seal that pays in blood but can never take the caster's last point.

### Moving

Point, click, walk. A click on the map names a destination; `pathTo` finds the
route with a breadth-first flood over walkable ground, and the sprite is stepped
along it a tile at a time so distance is something the player watches rather
than reads. Walking onto a node picks it up — having to click it again would be
a second click for a decision already made.

**What a node pays is a stat, not a permission.** `nodeYield` prices every kind
off the stat its class was already built around: herbs off `gather`, caches off
`salvage`, pages off `cast`. So the same tile is worth a different amount
depending on who stoops — the Alchemist is worth two of anybody at a herb, the
Engineer three of a Hauler at a cache — and a seat the stat prices at nothing
gets nothing, leaves the node standing, and says so in the log.

That is deliberately not the locked door this replaced. Herbs were once the
Alchemist's alone, which made four of the five seats walk past the thing the
build phase is mostly made of and left a party without her unable to brew at
all. Nothing is now gated to a seat the party can do without: every live class
gathers, three of the five crack caches, and a page is refused only to the four
seats that could never spend one — `openPage` has always refused them anyway.
What it stops is the Wizard walking off with a crate of pipe he cannot read.

Routing is pure and shared for the usual reason: the room has to be able to
check that a click was reachable rather than trust a client that says it walked
there. BFS rather than A* because the site is 30x17, so the whole board is
cheaper to flood than a heuristic is to tune.

The spawner uses the same flood. Terrain rolls islands — a pocket of grass
behind a pond — and a Cellsap on one is a node the player can see, walk at, and
never reach; `reachableFrom` keeps every node on ground a hero can get to.

### The options

A turn is **pick one thing from a list you can always see**. No deck, no hand,
no discard, no shuffle.

There was a deck. Ten or eleven cards, three drawn a turn, one played, the rest
discarded. It is gone, and the reason is one table:

```
flask  wrench  spark  shoulder  hook      ->  strike 3
steady shore   sign   weight    bramble   ->  ward 3
```

Every class opened with six cards that were **two cards wearing five sets of
names**, and `CLASS_KITS` said so in its own comment — *the basics are identical
under the rename*. Six of ten for the Alchemist, the Wizard and the Hauler;
**seven of ten for the Engineer**. Draw three and play one out of that and the
majority of turns in this game were a 3-damage hit or a 3-point ward whoever you
were sitting as, with the interesting cards buried underneath.

A deck earns that cost by becoming an engine, and it never could here: a run is
four fights, a deck of ten cycles about once per fight, so it paid the whole
price of randomness and never collected. Where variance comes from instead is
the wave, the site and the draft — see
**[Levelling a fight to the table](#levelling-a-fight-to-the-table)**.

#### Two free basics, and they are not the same two numbers

`CLASS_BASICS` gives every seat one swing and one guard, free and unlimited.
The numbers are the point:

| | swing | guard | |
| --- | --- | --- | --- |
| Alchemist | 3 | 3 | middling at both, as she is at everything |
| Engineer | 3 | 4 | hits like a tool, holds like a wall |
| Wizard | **5** | **2** | the best free swing in the game and the worst free guard |
| Hauler | 4 | 4 | the most health and the heaviest hands |
| Grafter | 3 | 3 | plain, because her damage is supposed to arrive late |

The Wizard's line is the roster's glass floor stated twice — she already had the
lowest health, and now she says the same thing again in what she can do for
nothing. A test pins that the swings and guards are *not* all equal, because
flattening them is exactly the state this replaced.

Universal Strike and Hold are superseded and in nobody's list. They stay in
`CARDS` only because removing an export is a bet on what the deployed Worker
imports, and that bet is declined here as everywhere else.

#### Five economies, which were always there

The shuffle was a translation layer over five limits that already existed in
`content.js`. Taking it out did not invent them; it stopped hiding them.

| | who | refills | reads |
| --- | --- | --- | --- |
| `stocked` | Alchemist | never — brewing is the only way back | a rack of bottles, carried the whole run |
| `power` | Engineer | every fight, from the panels | one pool, everything draining it at a different rate |
| `chargeCost` | Wizard | `CHARGE_REGEN` at the top of every round | this round or next |
| `hpCost` | Hauler | never | he has always paid in health, and pays for the sharp half of the bag |
| `packed` | Hauler | never depletes, because it never spends | **the sixth, and the odd one out** — see below |
| `uses` | Grafter, for now | every fight | her old copy counts, one for one |

**`packed` is the only limit that is not a count of uses.** The other five all
answer "how many times"; the pack answers "how many things", and it is paid once
in the build phase in floor space rather than at each play. A kit in the bag is
an option every round of the fight for nothing — the cost was the three other
things that then could not go in. It is the only economy in the game where the
question is what you *have* rather than what you can afford to spend, which is
what a backpack means and the reason it earns a row of its own.

`RECIPES.makes` used to deal three Sunsalves into a shuffle; it puts three in
the rack, which is what it always meant. `SPELLS.charges` used to be how many
copies of a spell went into her deck; it is what a cast costs. Raising a panel
used to push a Bolt Gun card into the Engineer's deck and hope he drew it; a
panel buys the power to fire what the chips already bought. In every case the
mechanic is unchanged and the indirection is gone.

The Grafter is in the `uses` column because she has no economy of her own yet —
`CLASS_EXTRAS` has always admitted that, and it is the field to empty when she
grows one.

#### What an option says on its face

Unaffordable options are **greyed, never hidden**, and they say *why*: "not
enough charge" and "the rack is empty" are different facts, and a player who can
see which one applies can do something about one of them. `actionCost` names the
pool and `actionReady` returns a reason rather than a boolean, so the room and
the client answer that question out of the same function and cannot disagree.

Costs are paid at **resolution**, not on the click — a commitment can still be
taken back, and a charge spent on an action that was never taken would be gone
for nothing. Affordability is checked twice for the same reason: two seats
committing against one panel's worth of power is a legal pair of clicks, and
the second to resolve has to find the pool empty rather than take it negative.

Two things changed shape rather than porting cleanly:

- **Graft** put a Cutting on top of an ally's deck, which guaranteed it in their
  hand next round. There is no deck to sit on top of, so it arrives as a *use*
  on their board — if anything sharper, because it is there the moment it is
  bound and everyone can see it.
- **An Opening Word** put its spell at the top of the deck. It now opens the
  fight with a charge *over* the cap: the same promise — you get to say the big
  thing first — in the currency that still exists. It decays on its own, because
  the per-round top-up stops at `CHARGE_CAP`.

### The build phase

**The site is generated once a run and kept.** Walking back onto the slab you
cleared last round and finding your panel still bolted to it is the entire
reason to build anything, so terrain and structures persist and only the crop
is reseeded — `respawnItems` puts a fresh crop of herbs and caches on ground
that is already there. The pots and the spellbook persist with the site.

That reseeding is building-aware, which does two jobs at once. Nothing sprouts
underneath a structure, and a pocket this round's building walled off stops
being somewhere the crop can land — the spawner floods with the buildings in
place, so what it plants is what a hero can still walk to. Spawn tiles are
building-aware for the same reason: nobody should open a round standing inside
the array they put up last one.

The site is a 30 &times; 17 grid of 16px tiles — a grid because every question
the build phase asks is about neighbours, and a grid answers those with
arithmetic instead of geometry. Terrain decides three things: whether you can
stand on a tile, whether a structure can go there, and whether anything grows
there.

Terrain is random, so the generator has a promise to keep: `BASE_ROOM` is the
smallest *connected* buildable pocket a site may roll, checked by
`largestBuildableArea` with a flood fill over a hundred seeds in the tests.
Counting buildable tiles would not do — thirty tiles in three pockets separated
by water is not somewhere a base goes.

Click a herb or a cache on the map to walk there and gather it, or step a tile
at a time with the arrow keys — a canvas cannot be tabbed through, so the keys
are the path that works without a pointer. Both send the same `moveTo` intent,
so the room still decides whether the step was legal and arriving is still what
picks a node up. Pick a building, then click where it goes; the tile previews
the structure and refuses water, rubble, another building and any tile with a
herb still standing on it.

**The map is the only list of what is on the site.** There was a second one
under it — every standing node as a row of buttons — and it said nothing the
tiles did not already show while costing a section of screen to say it.

### The camp

Dead centre of every site, on every seed, there is a fire in a clearing with a
tent standing over it. It is the one fixed thing on a map that is otherwise
rolled, which is what makes walking back to it feel like coming back rather than
arriving somewhere new.

**The fire is the middle, not the tent.** A tent is somewhere you sleep; the
fire is the thing people actually gather at, so the camp is arranged around the
fire and the party spawns in a ring about it, with the tent above as a backdrop.

```
     :###:      the tent, 3x3, solid
     :###:
     :###:
     :::::
     51:2:      the party
     ::*::      the fire
     :4:3:
     :::::      the clearing
```

**It is terrain, not a building.** Every rule that matters — walking, building,
growing, spawning, pathing — already reads `TERRAIN`, so three table entries and
a stamp buy the whole footprint:

| kind | walk | build | grows | |
| --- | --- | --- | --- | --- |
| `tent` | ✗ | ✗ | ✗ | the 3&times;3 shelter, above the clearing |
| `camp` | ✓ | ✓ | ✗ | the trodden clearing |
| `fire` | ✗ | ✗ | ✗ | one tile at its centre |

The fire is solid for the same reason a pond is — you do not stand in a fire —
and because ring zero has to be unavailable for "spawns *around* the fire" to
mean anything.

**Nothing grows near it.** A tree is a canopy three tiles tall, so one standing
south of the camp sorts *in front* of the tent and swallows it; that happened on
**49% of sites**, and over the fire specifically on 28%. The tree pass refuses
any cell inside `inCamp(x, y, 2)` — tested on the same draw it already made, so
the number of `random()` calls is unchanged and the replay guarantee holds. Both
numbers are now 0/120.

Nothing in `src/rooms.js` changed for any of it, which means nothing needed
re-porting to the deployed room — it delegates all of this to `content.js`, and
`content.js` is imported there directly.

Two things the stamp has to keep. It runs **last**, after the tree pass, and
**clears its own ground**: rolled blind, the centre came up water or a crevice on
better than one site in ten and the tent floated in a pond. And it makes **no
call to `random()`**, or every existing room code would render a different ruin
everywhere else on the map.

`spawnTile`'s `offset` is a seat index rather than a sideways shift of the search
window. It used to slide the whole window east, which strung the party out in a
line — seat five could open the round seven tiles from camp with nobody in
sight. Candidates are ordered by ring out from the fire and then clockwise
around it, so five players stand round it the way five people stand round a
fire. Same signature, so the deployed room is unaffected — and because the fire
itself is unwalkable, the ring is the nearest thing the ordering can offer.

**One panel per class.** Below the map you get the pool you spend and the verb
you have, and nothing belonging to somebody else's economy: the Alchemist's
stash, garden and recipes, the Engineer's salvage, buildings, lines and
abilities, the Wizard's library, draft, bench and satchel, the Hauler's pack.
Each is hidden whole, heading included, on the rule power was
already hidden by — a readout you cannot act on is one you learn to skip past,
and a live heading over the words "only the Alchemist can brew" spends a
section of the screen on saying no. The client branches on the `craft`, `build`,
`cast` and `haul` flags in `CLASSES`, never on the class id, so a class gets a
panel by declaring what it can do — which is exactly how the Hauler got his:
one flag on his entry in `CLASSES`, and the bench appeared.

This is presentation only. `stash`, `salvage`, `pages` and `power` are
room-level fields that `viewFor` sends to everyone regardless of class; what
changed is which of them a given seat draws. The pack is per seat rather than
per room, and it is public for the same reason every other pool is: a packing
puzzle is the best thing in this game to lean over somebody's shoulder at, and
whether the Stretcher went in is whether anybody is getting back up.

**The phase turns when everyone is ready.** `readyState` counts only connected
players, so a party is not held in the build phase by someone whose train went
into a tunnel, and it returns counts rather than a boolean because "3 of 4
ready" is what the UI has to draw. A tick flies over each hero who has
committed and three dots over each one still deciding — the same mark answers
"are we waiting on you" in a fight, where it means a card is locked in.

Map generation is seeded — `seededRandom(seedFromCode(code))` — so a room code
is a ruin, the same one on the server, in the client, and in the tests.

### The works

The Engineer does not have a deck, a bench or a bag. He has a **base that keeps
working while everybody else is taking their turn**, and that is the whole seat.

Nothing else in this game contributes on a round it is not acting in. The
Wizard has to cast, the Hauler has to swing, the Alchemist has to pour. A
machine does not care whether the person who built it is busy, or asleep, or
face down in the rubble — so the payout runs regardless, and a downed Engineer
is still the reason the party is winning.

This replaced a seat that had no job. His three class cards were Bolt Gun,
Bulwark and Jumper Cables; by the time the Hauler's bag landed, all three were
in it and better — a Rigging Tarp is the same `wardAll 3` for free, a Stretcher
revives for 8 instead of 6 at a cost of one health, and a Sledge hits for 11.
He was paying a currency he had to build infrastructure for, to do things
another seat did better for nothing. So he stopped having cards.

#### Three piles, and only one of them is a fork

| | Buys | Rarity |
| --- | --- | --- |
| **Screws** | The works: panels and the four payout lines | Common |
| **Coil** | The community machines | Uncommon |
| **Chips** | Abilities | Rare |

Pipe and Plating folded into Screws when the piles went from four to three:
four resources across two spends was bookkeeping, three across three is a
shape.

The split exists so that **helping the party is never a sacrifice**. Coil buys
nothing the Engineer can point at a monster, and screws buy nothing anybody
else can touch, so the two never compete — a player is never choosing between
their own win rate and the table's.

The fork is *inside* screws, and it is self-referential:

- **Panels are the power to fire an ability.**
- **Lines are what the ability is worth.**

All array and no line: plenty of power, and Close Ranks guards for nothing. All
line and no array: a fat number you cannot afford to pull. `STARTING_SALVAGE`
is 6 screws, which is exactly two panels *or* one line's first tier, and a test
pins that a first buy always leaves the other out of reach.

#### The five lines

Four pay the party, at the top of every round, automatically. One pays him.

| Line | Pays | When | Drawn by |
| --- | --- | --- | --- |
| **The array** | power, to the Engineer | per fight | — |
| **The windbreak** | guard on every seat | top of every round | Close Ranks |
| **The carillon** | a harder swing for every seat | top of every round | All Hands |
| **The heliostat** | damage on the nearest enemy | top of every round | Sunlance |
| **The cistern** | health for every seat | **once, when the fight ends** | nothing |

**A panel makes 1, or 2 with another panel orthogonally beside it.** That is
the one line that is not a plain sum, and it is what makes the map a puzzle:
the array wants a contiguous run and a rolled ruin is full of holes. Rubble,
water, trees and crevices are unbuildable, herb nodes hold their tile until
somebody takes them, and the camp is stamped through the middle. Finding six
clear tiles in a row is a real problem, and every line building competes for
the same ground because each tier has to touch the one below it.

**The cistern is the odd one and deliberately so.** Healing every round was
simply the best thing a line could do, so it fires once and pays more — economy
between fights rather than sustain inside one. Nothing draws it, which is what
stops the mend line turning into a spike, and a test pins that no card ever
names it.

#### What chips buy

| Ability | Chips | Does | Power | Needs |
| --- | --- | --- | --- | --- |
| **Bolt Gun** | 2 | strike 9 | 1 | — |
| **Close Ranks** | 2 | guard one seat for `DRAW ×` the windbreak | 1 | Trellis |
| **All Hands** | 2 | one seat swings `DRAW ×` the carillon harder | 1 | Carillon |
| **Sunlance** | 3 | strike one enemy for `DRAW ×` the heliostat | 2 | Heliostat |
| **Hold the Charge** | 3 | every line pays nothing now and **double** next | 1 | — |

Four of the five have no number of their own. `DRAW` times what the line pays,
onto one target — so **the card's text is written on the map**. Close Ranks off
a bare Trellis is 5 guard; with the windbreak grown in it is 15, from the same
chip. Nothing else in this game is priced by looking at the board.

`DRAW` is `PARTY_SIZE`, and that is the fiction: the whole crew's share of one
round, pulled through a single line. It is a **flat multiplier rather than an
actual redistribution**, because a redistribution is worth five times as much
at a full table and nothing at all alone, and this seat has to be playable by
one person. Hold the Charge is the same idea on the other axis — it
concentrates across *rounds* instead of across people.

The Bolt Gun is the exception that makes the seat playable at all: a flat
number off a bare panel, needing nothing standing. `STARTING_SALVAGE` carries
exactly two chips, and a test pins that it covers it.

**All Hands is the sharpest thing here, and on purpose.** `might` is a term
inside `strikePower` and it lands on the target's *next* turn, exactly as the
Wizard's Ember Rune does. Players can see each other's commitments before a
round resolves, so a Wizard who watches All Hands land on her picks Cinder
Nova — and `strikeAll` carries the might to every enemy in the lane. That is a
coordination play with a real ceiling on it, and it is the number most likely
to want tuning first.

#### The community: four machines for somebody else's build phase

| Building | Cost | Gives | Stands |
| --- | --- | --- | --- |
| **Pulp Press** | 5 coil | The Wizard drafts a page more each build phase | beside `water` |
| **Glasshouse** | 5 coil | Every pot the Alchemist pulls is worth one more | on `grass` |
| **The Barrow** | 5 coil | The Hauler's bag grows a round early | at the camp |
| **Windrow** | 5 coil | One more use of everything the Grafter counts | beside a `tree` |

This is the role nobody else can occupy. Ember Rune, Graft and Leg Up hand an
ally something for one round inside a fight; these are the only things in the
project that reach another seat's *economy*. The Barrow is the neatest of them:
`gridFor` already clamps at both ends, so it is `gridFor(round + barrows)` and
nothing else — and what the Hauler sees is a row of his bag arriving early
rather than a number he has to read.

#### Where a thing may stand

`placeRefusal` folds the terrain, the occupancy, the cap and the building's own
rule into **one answer, and returns a reason rather than a boolean** — the same
contract `actionReady` follows. The client draws that string, the room refuses
with the same function, and the placement ghost is computed from it, so the
cursor can never promise a tile the click will bounce off. Six predicates cover
all nineteen buildings: `beside`, `near`, `on`, `onOrNear`, `clearOf`, `camp`,
plus a `needs` count.

Only the panel may be built twice. A second Trellis would pay the same line
again for no decision — the tiers above it are what a line is *for*.

**A standing building can be walked to a better tile, for nothing.** Clicking
one picks it up; clicking a tile puts it down. That gesture was free — a
building's tile is not walkable, so `pathTo` always refused it and the click
did nothing at all. Moving is free and build-phase only on the precedent
`moveMod` already sets: a spell is re-socketed at the desk rather than
mid-surge, and rearranging something already paid for should not cost twice. An
array is a shape, and a shape you cannot adjust is one nobody dares start.

`moveRefusal` asks two questions. The destination is `placeRefusal` against a
board the building has been lifted off — which settles the cap for free, since
a Trellis is not a second Trellis when the first one is the thing in your
hands. Then: **a move may not strand anything.** Without that, every adjacency
rule here is decoration — you would place the Trellis, hang the Living Wall off
it, and walk the Trellis to the far side of the site. `strandedIn` asks each
remaining building about its own tile against a board it has been taken out of,
which is the question `placeRefusal` already answers, so a predicate added
there is one this honours for free.

#### What this replaced

`UPGRADES`, `upgradeCost` and `buyUpgrade` are gone, along with the Workbench
that sold them. They were a second progression system beside the buildings, and
they were the one that decided the fight — which made every placement
decoration and every purchase the game. The three names stay exported and
answer emptily, because this module is imported at the top of a Worker nobody
working here can read the source of, and an import of a name that is not
exported takes the whole site down. See the published contract at the foot of
`test/content.test.js`.

### The surge

Combat is a **standoff**, in the shape of a Slay the Spire fight: the party on
the left facing right, the wave on the right facing left, both stood on one
ground line, everything present from the first turn and everything acting on
every one of them. `COMBAT_H` is eight rows of the map's width, which is the
band the fight fits in, and the Engineer's standing buildings are drawn along
the hedge line behind it, so the half of the round you spent building is visible
in the half you spent it for.

**The stage is painted, not generated** (`public/stage.js`). The fight was drawn
out of the same tile set as the build map — `generateCombatTerrain` rolled the
board and the same grass, water and rubble were stamped across it — so the most
dramatic screen in the game looked like a smaller copy of the least dramatic
one. Nothing on a standoff field is walked on, stood in, built on or gathered
from, so the ground has no rules left to carry and does not need to be made of
tiles: `paintStage` draws a sky in three dithered stops, a solarpunk skyline of
terraced towers, canopied domes, turning turbines and ivied chimneys, a hedge
for them to stand behind, and a plaza in one-point perspective with a twelve-
spoked sun mosaic inlaid at its centre. One palette per round takes the run from
full afternoon through low gold and dusk to the Array after dark, where the
floor goes dim and the mosaic is the thing that glows. Everything is hashed off
its coordinates rather than rolled, so the whole backdrop bakes to one offscreen
canvas per round and never shimmers; the only live layer over it is a couple of
dozen drifting seeds, which is what keeps a standoff from looking like a paused
game. The room still generates the combat terrain — it is a frozen export and
part of the seeded stream — the client simply no longer draws it.

It was a lane before this. Enemies carried a `dist` — a count of rounds before
they arrived — and the wave walked down the board while the party shot at it.
That made the opening turns of every fight free, the closing turns crowded, and
the most interesting question on the board "which of these is nearest", which is
not an interesting question. **`dist` is gone.** An enemy is authored by its
health and its damage, and it is *there*.

What replaced the tension of watching something walk at you is the **telegraph**
(`intentOf`): every living enemy publishes what it is about to do, one round
ahead. You cannot see a monster coming any more; you can see what it is about to
do, which is a decision rather than a countdown.

#### Four things an enemy can be about to do

The telegraph used to say one thing — a number, an ailment, and which seat the
blow was lined up on — because there was only one thing an enemy did. It hit
somebody. Everything else about a monster was a stat, and a fight was the same
unreadable exchange every round with different arithmetic in it.

An enemy has a **`pattern`** now, and it is the largest single thing an enemy
is. `hp` and `hits` say how much trouble it is; the pattern says what *kind*.
`ENEMY_INTENTS` holds the four, and they are four because each asks the party a
different question:

| | what lands | what it asks |
| --- | --- | --- |
| `attack` | full damage, on **everybody** | can you absorb this |
| `blight` | half damage on everybody, and the ailment is the point | can you refuse this |
| `charge` | nothing, and `CHARGE_MULTIPLIER`&times; next round | can you answer it in one round |
| `bolster` | nothing, and `BOLSTER_STEP` more damage for the rest of the fight | can you afford to ignore it |

A Sporeling alternates attack and blight. A Rust Hulk winds up, lands the big
one, then doses. The Extractor is the only thing that walks all four, and the
only thing that bolsters — a boss the party lets run gets permanently worse,
which is the pressure a single enemy cannot apply by arriving in numbers.

The pattern cycles on `enemy.turn`, a counter the room keeps, so it is
arithmetic rather than a roll: a replayed room runs the same fight, and the
telegraph reads the next entry without a second copy of the rule. Everything the
plate says comes out of `intentOf`, `enemyDamage` and `blightDamage` — and
`advanceWave` resolves the round by calling those same three functions, so what
the party was promised is exactly what arrives.

**An attack lands on the whole party.** This is the change everything else falls
out of. It was a round-robin before — every enemy swung, each swing found one
seat, and `waveTargets` rotated the opening seat so a five-player fight did not
gang up on seat one. Two things were wrong with it. A wave of two against a
table of five was mostly a wave hitting nobody, so a bigger table was *safer*
per head at the exact moment it should have been under more pressure. And the
damage a party actually took came down to a rotation nobody could see or
influence, which made "who is it aimed at" the most important fact on the board
and the one the party had no card for. `waveTargets` is gone. What an enemy is
about to do is the question now, not who it picked.

**Guard comes off the top of each seat's own share.** Five players facing a
swing of four is five separate subtractions, not one pool of four. That is what
makes the party-wide defends worth their worse per-head numbers: a Rigging Tarp
over five seats blunts five shares of every swing in the round, which is a
different card from the one that put guard on five people who mostly were not
going to be hit. It is also why the Engineer's windbreak is worth building —
one point a round, paid to everybody, is five subtractions off five swings.

**A dose that guard swallows whole leaves nothing behind.** The best rule in the
old model survives intact, and it is now the whole reason `blight` is its own
intent rather than a rider on a lucky swing: a Creeper *tells you* it is about
to weaken the party, and a round of guard is how you refuse. An ailment used to
arrive on every nth landed hit, counted on a hidden `landed` counter — the
interesting half of a monster was invisible until it fired. The boss's ring of
three walks on `enemy.cast`, and a dose the party guarded off entirely does not
advance it, so refusing one is genuinely refusing it rather than merely
surviving it.

**`cover` keeps its sentence.** The Hauler is still the only seat that decides
who takes a blow: they stand in front of each ally's share in turn, a point of
guard per point of damage, until the guard runs out and the wave goes back to
finding everybody. Nothing was added to make that work — it is the same number
on the same card, read against a swing that now has more shares in it.

#### A round is a sequence, not a flash

Everything a round resolves is **numbered**. Each seat's card takes a beat, in
player-id order; then one beat for the quiet gap where rot and canker bite; then
each enemy's intent takes a beat of its own. The room stamps the beat onto every
fx event it emits (`event()` does it in one place rather than at forty call
sites) and the client plays one beat at a time — `startVolley` takes the events
sharing the lowest step and the frame loop comes back for the next.

The room still resolves the whole round in one pass and sends one view. The beat
is a stamp on what already happened, not a pause in the server, so nothing about
determinism or the wire protocol changes.

This was tolerable when a swing found one seat: four or five things happening to
four or five different people reads as a turn even played together. It stopped
being tolerable the moment an attack landed on everybody — five simultaneous hit
sparks with five guards coming off at once is not something a person can read.
The hold at the end of a round grew with it: `playbackMs` costs the whole
sequence out in advance, because the wave now dies at the end of a run of beats
rather than in the only one.

A round opens with the phase card, then the two sides **walk onto the field**,
and the cards go live once everybody is in place. Three beats: what this is, who
is here, go.

Waves scale by **composition, not stats**: a later round sends more and worse
things rather than the same thing with a bigger number, because "there are four
of them now" is legible on a screen in a way "+2 hp" never is. A test proves the
boss cannot leak into an earlier round.

#### Levelling a fight to the table

**One dial, and it is health.**

| | scales with the table |
| --- | --- |
| how many enemies | no — fixed per round. Round one is three things, whoever turned up |
| what they swing for | no — `ENEMIES` is what it swings for, at every size |
| how much health they have | **yes**, and it is the only thing that does |

`waveFor(round, partySize)` returns the round's literal wave and ignores its
second argument. `enemyStats(type, partySize)` is the only place the table size
reaches a fight, and `HP_PER_PLAYER` is the only number it reads.

It used to spend a **threat budget**: each enemy carried a `threat` — what one
of it was worth against one player — each round carried a `THREAT_PER_PLAYER`
figure, and a bigger table met a fuller lane *and* worse things in it. That was
the right shape while a swing found one seat, because five enemies against five
players was five blows a round however you arranged them.

It stopped being the right shape the moment an attack landed on the whole party.
An enemy's damage is now multiplied by the head count before any dial touches
it, so adding enemies for a bigger table multiplies the pressure twice over —
the fifth Sporeling is worth five times to a table of five what the first one is
worth to a solo player. Measured, that was a table of four winning one run in
twenty against a target of three in five. `threat`, `THREAT_PER_PLAYER`,
`PARTY_SYNERGY` and `threatBudget` are all gone; `WAVE_CAP` stays, as the
ceiling of six any future round has to be authored under.

Health is the number that *should* scale, and the argument is short: a party
puts out roughly its head count in damage, so a wave carrying its head count in
health is the same fight taking the same number of rounds. Everything else a
bigger table brings — more guard, more heals, somebody to lose and keep
fighting — is what makes it a party rather than a longer solo run. The boss
keeps its own share (`BOSS_SCALING.hp`) for the reason it has always had its own
treatment: it is one thing, and it cannot scale by arriving in different
numbers.

**These are measured, not argued.** `node test/balance.mjs` drives the real
`Room` over the real protocol through whole runs — a build phase that gathers,
builds and brews, then combat played by a model of somebody paying attention but
not solving the game — and reports the win rate per table size:

```
node test/balance.mjs             400 runs per table size
node test/balance.mjs 1000        a tighter interval
node test/balance.mjs 400 1       one table size
```

The target is 60%. **The structure is right and the numbers are not.** At 200
runs a size:

```
1 player 0%   2 players 0%   3 players 0%   4 players 0%   5 players 0%
```

Read that as two separate results. The first is the one this rewrite was for:
**the curve is flat.** Table size has stopped mattering, which is exactly what
fixed count + flat damage + linear health was supposed to buy — before it, the
same harness read 56 / 36 / 16 / 5 / 9 and every dial had to be five dials.
What is left is one global difficulty knob rather than five curves that fight
each other.

The second is that the knob is set far too hot. The arithmetic is legible now,
which is the point of the model. Round one sends two Sporelings and a Creeper,
all three of which open on `attack`, for **seven damage on every seat on turn
one**. A solo Wizard has 22 health, a free swing worth 5 and a wave worth 22
health to chew through: she needs four rounds and has three. Every table size
dies in rounds one and two, and four in five of those losses are round one.

Nothing here is broken. A traced solo round one takes exactly the seven the
plates promise, a three-player wave carries exactly 3&times; the health, and the
removal of the deck moved this number very little in either direction — the
party's floor came up (every seat now always has its best basic rather than
whatever it drew) and the ceiling came down slightly (no more lucky opening
Fireball). What decides these runs is the opening wave, not the options.

Three places to turn it, in the order worth trying:

- **Round one's wave.** Three things all swinging on turn one is the hardest
  opening the game has ever had. Two, or three with one of them opening on
  something that is not `attack`, is the cheapest fix.
- **Opening intents.** Every enemy starts at `turn: 0`, so a wave whose patterns
  all begin with `attack` opens at maximum pressure with no variety — the
  telegraph has nothing to say on the round it matters most. Staggering each
  enemy's starting `turn` by its position would spread a wave's intents from the
  first round and cost nothing.
- **`HP_PER_PLAYER`.** This one changes how the *sizes* sit relative to each
  other rather than the global difficulty, so reach for it only once the flat
  line is at the right height.
#### What the blight leaves behind

Damage is a number and is over; an **ailment** is the same monster still costing
you something three turns later. `AILMENTS` holds three, and each takes a
different thing away: `rot` takes health every round and guard cannot stop it,
`weak` takes damage off everything you swing, and `stun` takes the turn itself.
They refresh rather than stack — two Sporelings should be twice as many things
to kill, not four rot ticks a round on one person.

An ailment arrives on a **`blight` intent** and nowhere else. An enemy's
`ability` names which one it leaves — or which ring of them, for the boss — and
`blightOf` reads `enemies[].cast` to say which is next. It used to ride in on
every nth landed hit, counted on a hidden `landed` counter, which meant the
interesting half of a monster was invisible until it fired; a Creeper announces
it now, a round in advance, and **a dose that guard swallowed whole leaves
nothing behind and does not advance the ring**. That is the reason to spend a
card on a ward against a Creeper rather than trade with it: you are not buying
health, you are buying the two rounds of Weakened that would have followed. The
cadence is arithmetic on a counter rather than a roll, so a replayed room lands
the same statuses.

Statuses age at one fixed point in the turn — `tickAilments()`, after the cards
resolve and *before* the wave lands new ones — so a rot dealt this round does
not also tick this round, and a one-round stun lasts exactly the one turn it
says it does. Effects granted by a card carry `fresh`, which survives its first
ageing: a buff aged the same evening it was given would be a zero-round buff.

#### Seats four and five

**The Hauler** is the only seat that buys with health. `hpCost` sits beside
`pageCost` and `powerCost`, and `cardPlayable` refuses the play that would take
the last point — a card must never be the thing that kills you. It buys two
things: `heft`, the only buff in the game that does not expire before the fight
does (it is a term inside `strikePower`, so it is added to everything that seat
swings), and `cover`, the only card that changes *who* a blow lands on. Cover
has no charge counter: the number on the card is literally how much wave it
buys, a point of guard per point of damage, because the redirect ends when the
guard runs out. Which means the Engineer warding the Hauler is the Hauler
covering for longer, with nothing added to make it so.

What he does with all that is **[the pack](#the-pack)** — the build-phase verb
he spent four rounds of this project not having.

A swing lands on the whole party now, so what cover buys is stated in shares
rather than in blows: the Hauler steps in front of each ally's share in turn
until the guard is spent, and the seats it did not reach take their own. Same
card, same number, same sentence — read against a swing that has more shares in
it. It is a straightforwardly better card at a full table than it was, and that
is one of several reasons the balance numbers above need redoing.

**The Grafter** deals `canker` — the only damage that is not a strike. It never
routes through `strikePower`, so Might, Heft and Weakened are all irrelevant to
it in both directions; it ticks inside the round whether or not she acted, so a
stun cannot take it off the table; and it keeps arriving after she goes down.
A ring cut for 3 pays 3, then 2, then 1 — six across three rounds, starting the
round *after* it was cut. It refreshes rather than stacks, for the reason an
ailment does: additive would pay out triangularly and three rings on one Rust
Hulk would be forty-five damage. Her `scout` flag also deepens what a site puts
out — salvage and pages, never herbs, because the herb count is the one number
scarcity rests on.

`Graft` is the only effect that changes what somebody else can do: it puts a
Cutting on an ally's board as a use, there the moment it is bound and visible to
everybody. A Cutting is a strike, so it lands for four plus whatever that arm is
carrying.

#### Aiming at your own side

`targetsAlly` had been on five cards for a while and the client never read it,
so every one of them silently landed on whoever played it. Combat has an **ally
row** now, beside the wave row, and which row a card aims from is keyed off its
**effect kind** and never its icon — Bramble is a `defend` that hits nothing,
Graft is a `buff` that lands on somebody else, and Get Behind Me is a `defend`
that must not be aimable at all.

#### The party cards

Every class has something only worth holding because there is another seat at
the table: the Alchemist's Blight Censer and Restorative Vapours, the Wizard's
Ember Rune and Cinder Nova, the Hauler's Get Behind Me, Leg Up and Rigging
Tarp, the Grafter's Graft, and the Engineer's Close Ranks and All Hands. The
Tarp is the shape of most of them — guard on everyone, worse per head than
Shore Up on one, so it is the wrong card at a table of one and the best card in
the bag at a table of five.

Ember Rune is the clearest of them: it does no damage, it lands on somebody
else's *next* turn, and it is worth a page only if that person then swings. Two
people have to agree about a round in advance. One copy each rather than two, on
purpose — a card you hold every other turn is a rotation, not a moment.

**None of them is dead weight alone, and the Engineer's are the reason the rule
had to be written down.** Close Ranks and All Hands are `DRAW ×` what a line
pays rather than a share of it redistributed, so they are worth exactly the
same to one player as to five; Hold the Charge concentrates across rounds
instead of across people for the same reason. A seat whose whole kit only works
at a full table is a seat nobody can learn.

#### Ending

A run ends on the `over` phase, and `over` is its own screen. It was nobody's
screen for a while: the build view was whatever was left after lobby and combat
had been ruled out, so a party wiped at the boss landed on the build screen
showing round 4 of 3, drawn over a combat lane the map could not read, with
nothing on it that did anything. It reads as the game breaking rather than as
the game ending, which is exactly what it was.

What it shows now is the record. Every seat accumulates six numbers across the
whole run — `damage`, `kills`, `guard`, `mended`, `revived`, `taken` — and the
end screen shows them twice: medals for who led each column, and the full grid
underneath for anyone who wants to argue with the medals. `runHighlights()` in
`content.js` picks the leaders, drops columns nobody scored on so a run where
nobody healed does not award Health Restored for zero, and breaks ties toward
the earlier seat. Overkill is not credited — a Fireball into a Sporeling on two
health is two points of damage, or the scoreboard rewards bad aim.

The screen is worth reaching while working on it, so there are two deep links
that go straight there with a plausible record on them:

```
play.html?preview=lost
play.html?preview=won
```

**Another run** (`{t:'restart'}`, host-only, `over`-phase-only) takes the party
back to the lobby with seats and classes kept and everything a run accumulated
dropped. The seed moves with a run counter — `seedFromCode(`${code}#${run}`)` —
because a second attempt on the same site is a memory test rather than a second
attempt.

#### Dying visibly

A kill emits `{t:'fx', kind:'slain', target, enemy, last}`, and `last` marks the
one that emptied the lane. The client dissolves the body over ~900ms; on the
last one it holds the combat board open for **1.9 seconds** before letting the
next round's splash land, because the room ends a round the instant the wave is
empty and sends the kill and the next phase in the same message. Without the
hold you never saw the thing you spent four turns killing. See
`applyState()` in `play.html`: it is the only state update the client is
allowed to defer, because everything else the room sends is authoritative.

#### Effects, on screen and in the ear

Resolving an effect emits an `fx` event beside the log line, and the client
stages what arrived together as one volley on the combat canvas. An `fx` names
the **card** when a card caused it and the **effect kind** when nothing did, and
`public/fx.js` reads its two tables in that order: card first, kind second.

The fallback is the part worth keeping. A card with its own row looks and sounds
like itself — Fireball lobs, Spark crackles — and a card without one falls back
to its verb, so a new strike-kind card jabs and cracks the way Strike does the
day it is written. Keyed on cards alone the tables were already one card short:
Greenfire resolved in silence with nothing on screen, and every card added later
would have joined it. `test/rooms.test.js` plays every attack card through a
real room and fails if any of them resolves to no animation or no sound, which
is why the dispatch is a module and not a block inside the page.

`EFFECT_KINDS` lists what the engine implements, and all of it is implemented in
the room as well as the preview: `heal`, `regen`, `ward` and `strike` on one
target; `healAll`, `wardAll` and `strikeAll` on the whole party or the whole
wave; and `cleanse`, `revive` and `might` on an ally. The party-wide kinds are
written as their own kinds rather than a `targets: 'all'` flag, because "who does
this land on" is the first thing a player reads off a card and a flag is not
something you can read. `test/rooms.test.js` fails if any of them resolves to no
animation or no sound.

## Multi-tile buildings (not built yet)

The Solar Panel is **drawn** two tiles across and **occupies** one. The camp got
away without this because terrain is per-cell already — nine cells of `tent` are
nine solid cells for free — but a *building* is one record with one `x,y`, and
every rule reads it that way.

Doing it properly is a `content.js` signature change, and `src/rooms.js`
follows it. Worth doing, worth doing deliberately:

- `BUILDINGS` entries gain `w`/`h`.
- `canBuildAt(terrain, buildings, nodes, x, y, buildingId)` has to learn what is
  being placed, and check **every covered cell** plus the map bounds — today it
  checks one tile and relies on `tileAt` returning `null` off-map.
- `walkableAt` has to block every covered cell, not just the origin. It is the
  single chokepoint through which buildings block anything: `reachableFrom`,
  `pathTo`, `spawnItems` and `spawnTile` all go through it, so widening it there
  fixes all of them at once.
- **One record must stay one structure.** `buildingsOf`, `powerFrom`,
  `canBuildMore` and `salvageAfterCombat` all count array entries, so storing a
  2&times;2 panel as four records would pay four power, count four toward `max`,
  and pay income four times.
- The `{id, x, y}` record is a **persistence** contract — the Durable Object
  stores it and mid-run rooms survive redeploys, so a stored room can come back
  holding the old shape after a new deploy.
- The hover ghost and the placement preview in `play.html` outline one tile.

## What is not built yet

Honest status, so nobody discovers these at the table:

- **The fight is far too hard at every table size.** 0% against a 60% target:
  round one puts seven damage on every seat on turn one, and four in five losses
  are round one. The *shape* is right — the curve is flat, so table size has
  stopped mattering and there is one difficulty knob instead of five — but
  nobody has turned it yet. Known and deliberate debt; see **[Levelling a fight
  to the table](#levelling-a-fight-to-the-table)** for the measurements, the
  traced arithmetic, and the three places to turn it.
- **The Grafter has no economy.** Her four options are limited by a per-fight
  `uses` count carried over one-for-one from her old deck, which is a
  placeholder and reads as one. Every other seat's limit says something about
  the class; hers says "three of these". `CLASS_EXTRAS` and the `uses` column
  are what to empty when she grows one.
- **The Hauler's pack needs a balance pass.** The system is built and the
  numbers are first-draft. Free-unlimited strikes and stacking heft in the same
  bag is the interaction to look at first — see **[The pack](#the-pack)**. His
  identity is no longer a price without a verb, which is what this replaced.
- **Nothing has replaced the deck as a source of in-fight variance, on purpose.**
  A surge is now fully deterministic given its commitments. The plan is that
  variance lives in the wave, the site and the draft instead — none of which has
  been built yet. Until it is, a fight is the same fight every time you meet it.
- **Modifier duplicates share a face.** Two of the same modifier cannot exist
  (the draft refuses), but a modifier moved between two spells that each could
  hold it is found satchel-first — a wart only a hand-edited book can reach.
- **Gathering teleports you** to the node rather than walking there.

## Where the game lives

**The server is in this repo now**, in `src/`, and it is the authority. Clients
send intents and get back a view; they never decide anything — not what a card
does, not whether a tile was reachable, not whose turn resolved first.

```
src/ws.js      a WebSocket server in the standard library and nothing else
src/rooms.js   the authoritative state: rooms, seats, phases, intents
src/server.js  http + the socket route at /api/good-vibes/ws
```

`ws.js` exists because this project has no dependencies and Node ships a
WebSocket *client* but not a server. It is the RFC 6455 handshake, frame
parsing, and nothing else — no extensions, no binary frames. A turn-based game
sends a few kilobytes of JSON per action, so none of that earns its complexity.

Every rule in `rooms.js` comes out of `public/content.js` — the same module the
browser imports. That is the whole point of keeping that file pure: the two
ends cannot disagree about what a potion does.

### Rooms and seats

A room is a code. Join `#ABCD` and you are in it; the first player is the host
and only the host can start the run.

**A seat is a character.** Pick a class in the lobby and it is yours — the room
refuses a class somebody else has taken, because two Alchemists would both be
spending the same stash with the same verbs. The seat is held by a **token**,
not a connection: the client keeps one in `sessionStorage`, so a dropped socket
comes back to the character it was playing rather than to a new one.

**The host is a role, not a person.** `rehost()` hands the room to the oldest
still-connected seat whenever the current host is gone, in any phase. It used to
do that in the lobby only, which meant a host who closed their laptop mid-run
left a party that reached the end screen with nobody able to press *Another
run* — `start` and `restart` are both host-only, and there was no host.

### Coming and going

Everything about a phase turning goes through one method, **`settle()`**, and
four things call it: committing, readying, dropping and rejoining. That is not
tidiness for its own sake — each of those four can change the answer to "is the
room still waiting on anybody", and before they shared a rule, two of them
simply did not ask.

Both halves of the rule count **the people who are here to be counted**:

- The build phase turns when every connected seat is ready.
- A combat round resolves when every connected seat that is up has committed.

Which means a disconnect can complete a phase, and has to. Two seats in and the
third closes a tab used to leave the round unresolved until that person came
back — which, if they had gone to bed, was never. The same freeze had a build
phase version: two ready, the third drops, and the surge never comes.

**Rejoining works mid-fight**, which is the point of holding a seat by token.
There is nothing to restore but the seat. A returning player's pools are their
own state and never went anywhere, which is one more thing the deck's removal
made simpler rather than harder.

Leaving *after* committing is a different thing from leaving before it, and the
room treats it as one: `resolve()` walks intents rather than connections, so the
card you chose is the card that resolves whether or not you are still there to
watch it.

### A commitment is a pencil

A choice can be changed — swapped for another card, or taken back to undecided
with `{t:'take'}` — right up until the last seat is in, which is the moment the
round resolves and there is nothing left to change it against.

It used to be final the instant it was made, which punished exactly the wrong
person. The fastest reader at the table commits first, watches two allies commit
around them, realises the plan is now wrong, and is the one seat that cannot
adapt. In a co-op game where the whole round resolves at once, that is
backwards. The last player to commit is the one who does not get to reconsider,
and that is a fair price for being last.

The client shows you the card you have chosen — lifted and lit rather than
dimmed, because it is a choice that stands rather than one that has been taken
away — and *Do nothing* becomes *Take it back* while you hold one.

### Public pools

This used to be **Private hands**, and it was the first per-player state in the
game: you got your own `deck`, `discard` and `hand` as arrays, everybody else
arrived as counts, and an ally's `intent` said *that* they had committed and
never *what*.

None of that exists. A hand was secret because a hand is a hand; a list of
options is not, and in a co-op game there was never a reason for it to be. So
`charges`, `stock` and `uses` go out for **every** seat, and anybody can see
that the Wizard has one charge left, that the rack is down to its last Sunsalve,
and that the Hauler can still afford to cover. The cards that need two people to
agree about a round in advance — Ember Rune, All Hands, Graft — finally have
something to agree over. All Hands is the sharpest of them for exactly this
reason: a Wizard who watches it land on her can still pick the Nova.

Views are still built per socket, because one thing is still yours alone: your
own `intent` comes back in full and nobody else's does. That is the price of
being able to change it — a player who cannot see which option they chose cannot
meaningfully choose another one — and it keeps the last shred of simultaneity
that makes a round a commitment rather than a negotiation.

The client shows you the option you have chosen, lifted and lit rather than
dimmed, because it is a choice that stands rather than one that has been taken
away — and *Do nothing* becomes *Take it back* while you hold one.

### Determinism

Every roll comes from a generator the room owns. Combat resolves in player-id
order and never in the order the clicks arrived: the same commitments have to
produce the same round however the network delivered them.

There is a good deal less to be deterministic about than there was. Shuffling
and dealing were the largest users of the seeded stream and both are gone, so
what is left rolling is the site, the spawns, the spell draft and the salvage
after a fight — all of it in the build phase, none of it inside a round. A
surge is now fully deterministic given its commitments, which is what lets the
telegraph promise exactly what will land.

The beat numbers a round is played back on are stamped on the way out and change
none of this: the room resolves the whole round in one pass and sends one view,
and the client is what spreads it over time.
## Playing locally

`npm start` serves the pages **and the socket**. Open
`http://localhost:3000/play.html`, hit *New room*, and share the address — the
code travels in the fragment, so anyone who can reach the host can join by
opening the same link. On a LAN that is `http://<your-ip>:3000/play.html#CODE`.

Two browser windows on one machine work too, as long as they are separate
profiles or one is private: the seat token lives in `sessionStorage`, so two
tabs of the same profile would try to claim the same seat.

**Preview the site** on the join screen is the exception, and it exists because
none of this could otherwise be looked at until it was deployed. It generates a
site locally and gives you **the whole party — one player, three characters**.
Click a portrait to take control of one; the map click routes whoever is
selected. Every class has a verb the others do not — gather and brew, build,
cast — and playing all three is the only way to walk the loop end to end
without three people in the room.

Walking, gathering, brewing, building, readying up, drawing a hand and playing
cards all work, so a full cycle can be walked through offline. Each character
readies separately, because that is what the room will ask for.

Two deep links skip the clicking, and the screenshot tooling drives both:

```
/play.html?preview          straight into a build phase
/play.html?preview=combat   straight into a fight
```

It is the one place the client writes game state, and it is fenced behind a
`demo` flag for exactly that reason. In a real room every one of those
decisions belongs to the room, and a second implementation of them here is the
disagreement this architecture exists to prevent. Preview is a preview of the
drawing, not a second copy of the game — do not grow it into one.
