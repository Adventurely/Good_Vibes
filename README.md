# Good Vibes

> ## ⚠️ Read this before pushing to `main`
>
> **Pushing to `main` publishes `public/` to Tool Haven and redeploys the live
> site.** The game now has a server, and that server is **not** in `public/` —
> so a deploy ships a client that talks a protocol the deployed site does not
> answer. Worse, `public/content.js` is imported by Tool Haven's Worker, where a
> missing export is a top-level throw that takes the **whole site down,
> sign-in included**.
>
> Nobody working in this repository can read the Worker's source. The steps
> below are written so none of them require guessing what it contains.

### What is true here, and what is documented from the other side

| | |
| --- | --- |
| ✅ Verified in this repo | `public/` is browser-safe: no Node imports, no `process`, no `Buffer` |
| ✅ Verified in this repo | Every name `content.js` has ever exported is still exported (a test pins it) |
| ✅ Verified in this repo | The workflow copies **only** `source/public/.` — `src/` never leaves |
| ✅ Documented | What the Worker imports and what its room does with it — see [docs/tool-haven-server.md](docs/tool-haven-server.md) |
| ✅ Done | The Worker runs a port of `src/rooms.js` and speaks this client's protocol |
| ❓ Cannot be checked here | Whether the `TOOL_HAVEN_TOKEN` secret exists (manual sync until it does) |

### Steps before a deploy

1. **Run `npm test`.** The publish workflow runs it too and will not sync a
   failing build. The `published contract` test is the one that matters here:
   it asserts every name this module has ever exported still resolves.
2. **Check the import list in [docs/tool-haven-server.md](docs/tool-haven-server.md)
   still matches what you changed.** The Worker's imports from `content.js`
   are documented there now; if you renamed or removed anything it lists,
   that is a shim-and-re-port situation, not a push.
3. **For each name that changed shape, check it against this repo.** Two things changed
   shape without changing name, and neither throws — they return `undefined`,
   which is harder to spot than a crash:
   - `COMBAT_ACTIONS` is now an alias of `CARDS`. A card's owner field is
     `classId`; it used to be `classOnly`.
   - The ids `patch`, `arc`, `douse`, `brace` (cards) and `pylon`, `condenser`,
     `bulwark`, `rig` (buildings) no longer exist.
4. **The deployed rooms speak this client's protocol.** The porting guide
   that used to live here has been executed: Tool Haven's Durable Object runs
   a port of `src/rooms.js` (same rules, same views, same messages), with the
   signed-in session as the seat token and full mid-run persistence. The
   complete reference for how the deployed server behaves — identity,
   protocol, persistence, hibernation, and every difference from
   `node src/server.js` — is **[docs/tool-haven-server.md](docs/tool-haven-server.md)**.

### Changing the game vs changing the server

`src/rooms.js` stays the source of truth for the rules, and the deployed
Worker runs a port of it. The split that keeps the two honest:

- **Rules and content change here**, with tests. `content.js` ships as-is to
  the Worker; `rooms.js` changes need re-porting by someone with Tool Haven
  access (the ported file is marked with exactly what its seams are).
- **Deploy order is Worker first, then `public/`** whenever the protocol
  grows — the client must never talk a protocol the live server does not.

### If the site is already down

The cause is almost certainly a missing export. Add it back to `content.js` as
a shim returning something harmless and correctly shaped — see the
`compatibility shims` section at the bottom of that file for the two that exist
— add its name to `PUBLISHED` in `test/content.test.js`, and push.

---


A co-op solarpunk roguelike, and the pixel art page it grew out of. No
dependencies anywhere — just the Node standard library and a browser.

- **`public/play.html`** is the game: lobby, build phase, and the surge.
- **`public/index.html`** is the hello world page and the style guide the whole
  thing is drawn from.
- `npm start` serves both. See [Playing locally](#playing-locally) — the game's
  server half lives in another repo, so a room needs the deployed site.

## The page

`public/index.html` is a single self-contained file: a 320&times;180 canvas
scene, upscaled by an integer factor with nearest-neighbour filtering. There are
no images and no font files — the bitmap font, the sprites, the sky gradient and
the landscape are all drawn from data in the page itself, so the whole thing is
portable anywhere a browser runs.

Below the scene the page prints the style guide it was built from: the 16-colour
palette with hex values, and the sizes everything is authored at.

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
| Props — tent, trees, panel, workbench | bigger than a tile, bottom-anchored |
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
| Combat | enemy idle bob, hit recoil and flash, a death dissolve, a parallax treeline |

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

This repo is where the work happens; it is not what serves it. The site is
[Tool Haven](https://github.com/Adventurely/Tool-Haven), a Cloudflare Worker
that Workers Builds redeploys within a minute of any push to its `main`.

So publishing is a copy, not a deploy. `.github/workflows/publish-to-tool-haven.yml`
runs on every push to `main` here: it runs the tests, copies `public/` into
Tool Haven's `tools/good-vibes/`, and commits. Cloudflare does the rest. The
page then lives at `/tools/good-vibes/` on the site, behind its Cloudflare
Access sign-in.

Nothing deploys from this repo directly, and there is no `wrangler.toml` here
on purpose — deploying a worker from here would either create a stray second
worker or, with the wrong name, overwrite Tool Haven itself.

**One-time setup.** The workflow needs push access to the other repo, which a
`GITHUB_TOKEN` does not have. Create a fine-grained personal access token
scoped to `Adventurely/Tool-Haven` with **Contents: read and write**, then add
it to this repo as a secret named `TOOL_HAVEN_TOKEN` (Settings → Secrets and
variables → Actions). Until that exists the workflow fails at the checkout
step, and nothing reaches the site.

**Registering a new slug.** The workflow syncs files but does not touch Tool
Haven's `data/manifest.json`, which is what puts a card on its homepage. Adding
a second page there is a one-time manual edit in that repo. `good-vibes` is
already registered.

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
| `/`        | The pixel art hello world page    |
| `/healthz` | `{"status":"ok"}`                 |
| anything else | `404 Not Found`                |

## Tests

```bash
npm test
```

## Layout

```
public/content.js   the game as data — classes, cards, resources, buildings,
                    enemies, rounds, and the pure functions over them
public/art.js       the palette, the tiles and their cuts, the props, and every
                    sprite, as text
public/fx.js        what a resolved effect looks and sounds like, card first
                    and effect kind second, so nothing lands silently
public/audio.js     the two phase tracks and every sound, synthesised
public/play.html    the game: lobby, build phase, the surge, the hand
public/pixel.js     bitmap font and canvas helpers, shared by both pages
public/index.html   the pixel art hello world page and its style guide
src/app.js          static files out of public/
src/ws.js           a WebSocket server, standard library only
src/rooms.js        the authoritative game state: rooms, seats, phases
src/server.js       http + the socket route
test/content.test.js validates every table above and the rules over them
test/rooms.test.js  drives a real room: what a card resolves to, statuses,
                    kills, levelling, and that the client has an animation and
                    a sound for all of it
test/server.test.js integration tests
test/balance.mjs    not a test — a harness. Plays whole runs at every table
                    size and reports the win rate against the 60% target
```

**`content.js` is the file to edit.** It is imported by the browser *and* by
the authoritative room object in Tool Haven, which is what stops the rules and
the UI ever disagreeing about what a potion does. It is also why the file stays
declarative — a throw at its top level would take the whole Worker down — and
why `test/content.test.js` checks the shape of every class before the publish
workflow will sync anything.

Adding a class is a block in `CLASSES`, a deck in `STARTING_DECKS`, and a sprite
in `art.js`. Every field is documented above the array, and the test names the
one you missed. Two seats are still open; `OPEN_ROLES` says what the party is
short of and the lobby shows them as locked rather than pretending the roster is
full.

`COMBAT_ACTIONS` is a **deprecated alias of `CARDS`**, kept only because the
Tool Haven room imports this module and a missing export there is a throw at the
top of the Worker — which takes the whole site down, sign-in included. Delete it
once the room reads `CARDS`.

**`art.js` is client-only** — the engine references an art key by name and
never reads a sprite. A mistake in there can break a picture but not the
Worker, which makes it the safest file in the project to experiment in.

## The game

Solarpunk co-op roguelike for up to five. A ruin is growing back and the blight
is growing with it; you have three rounds to make the site defensible before the
Extractor wakes up in the fourth.

**A round is two phases.** You build on a site, everyone readies up, and the
blight surges onto a combat map of its own. Clear the wave and the next round
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

### Three classes, three economies

Every class spends a different pool, earned a different way, on a different
thing. A test holds the line, because two classes that both gather and both
spend would be one class with two sprites.

| | Alchemist | Engineer | Wizard |
| --- | --- | --- | --- |
| Flag | `craft` | `build` | `cast` |
| Pool | `stash` (herbs) | `salvage` | `pages` |
| Spends on | potions + the garden | buildings | spellcraft |
| Health | 30 | 32 | **22** |

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

Salvage also arrives *after* a fight: `salvageAfterCombat` pays each Engineer a
rolled share and each standing building a fixed one. Building is how you stop
being at the mercy of the roll.

### Brewing

Brewing does not fill a rack — it puts cards in the Alchemist's deck. A recipe
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

Brewed cards are **consumed**: playing one takes it out of the deck for good
rather than sending it to the discard. That is what stops a good brew being a
permanent upgrade, and it is why the Alchemist's deck changes shape every fight
where the Engineer's only grows.

They are shuffled in rather than kept on a tray. Three Sunsalves in a nine-card
deck *dilute* it — you might draw healing when you needed a guard — and that
cost is what makes gathering a decision instead of pure upside.

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
Core is `(10+5)x2 = 30`; the same two sockets reversed are 25. Each modifier
exists exactly once, so that 30 is the ceiling the example promises, not a
floor a second doubler slips past.

**Charges are copies in the deck.** At every surge the Wizard's deck is
written fresh from the book: her slim kit plus `charges` copies of each spell
as composed right now. A played copy is spent for the fight; the book deals it
again next surge. That is `composeSpell`, `rollOffers`, `takeOffer`,
`moveModifier` and `wizardCombatDeck` in `content.js` — pure, shared, and the
reason the bench, the deck list and the surge can never disagree about what a
Fireball has become.

Some inks do more than move numbers: a ward on cast, a heal for half the
damage dealt, a page back on a kill, a copy stacked into the opening hand, a
strike that reaches the farthest thing in the lane instead of the nearest, and
a seal that pays in blood but can never take the caster's last point.

> **Deployed rooms don't speak this yet.** The `page`/`pick`/`mod` intents
> (and the garden's `plant`/`harvest`) exist in `src/rooms.js` and the
> offline preview; the Tool Haven Worker is a hand-port that predates them
> and safely ignores them until it is re-ported. The old page-ammo wizard
> path is untouched for exactly that reason.

### Moving

Point, click, walk. A click on the map names a destination; `pathTo` finds the
route with a breadth-first flood over walkable ground, and the sprite is stepped
along it a tile at a time so distance is something the player watches rather
than reads. Walking onto a herb picks it up — having to click it again would be
a second click for a decision already made.

Routing is pure and shared for the usual reason: the room has to be able to
check that a click was reachable rather than trust a client that says it walked
there. BFS rather than A* because the site is 30x17, so the whole board is
cheaper to flood than a heuristic is to tune.

The spawner uses the same flood. Terrain rolls islands — a pocket of grass
behind a pond — and a Cellsap on one is a node the player can see, walk at, and
never reach; `reachableFrom` keeps every node on ground a hero can get to.

### The hand

Everyone holds a deck. A turn is **draw three, play one, discard the hand** —
the two you did not play go down with the one you did.

Three is small on purpose. Five players commit simultaneously, so a hand has to
be readable in about three seconds or four people sit watching a fifth think,
and a planning problem you cannot coordinate is just a wait. Discarding the
whole hand is what keeps a turn atomic: nobody holds a card for three rounds
waiting for a setup the other four cannot see coming.

A deck is ten cards — eight class cards plus the two universals, `strike` and
`hold` — so at three a turn it cycles about every three turns and a fight sees
the whole thing twice. The universals are the floor of a turn rather than a
choice: something to swing and something to duck behind, so no hand is ever
three cards you cannot afford. Strike hits for 3, the weakest attack in the
game on purpose — a party that spent its round on economy and drew nothing is
still in the fight, but only just.

`deckFor(classId)` builds the opening deck once, and everything after that adds
to it in place — the Alchemist brewing, the Engineer buying a barrel. A deck
rebuilt at the surge would throw away the build phase that paid for it. The
Wizard is the deliberate exception: hers is `wizardCombatDeck`, written fresh
from the book at every surge, because for her the build phase *is* the deck
and re-dealing it is what makes a spell's charges per-combat without a counter
anywhere.

Shuffling and dealing are pure functions taking the generator, like everything
else that rolls here. A client that shuffled for itself would hold cards the
room never dealt it, and a replayed room would deal a different hand than the
one that was played. Each player needs their own stream, too, or one player's
draw shifts everyone else's. `draw()` returns new piles rather than mutating,
because two callers sharing an array is how a hand ends up in somebody else's
deck.

Cards are the *only* interface in a fight. There is no second list of things you
can do — a card that costs power is dealt like any other and simply greys out
when the pool is empty, which is a bad draw the player caused. A crafted spell
never greys: the book already paid for it at the bench.

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
the workbench they put up last one.

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
stash, garden and recipes, the Engineer's salvage, buildings, power and
workbench, the Wizard's library, draft, bench and satchel. Each is hidden
whole, heading included, on the rule power was
already hidden by — a readout you cannot act on is one you learn to skip past,
and a live heading over the words "only the Alchemist can brew" spends a
section of the screen on saying no. The client branches on the `craft`, `build`
and `cast` flags in `CLASSES`, never on the class id, so a fourth class gets a
panel by declaring what it can do.

This is presentation only. `stash`, `salvage`, `pages` and `power` are
room-level fields that `viewFor` sends to everyone regardless of class; what
changed is which of them a given seat draws.

**The phase turns when everyone is ready.** `readyState` counts only connected
players, so a party is not held in the build phase by someone whose train went
into a tunnel, and it returns counts rather than a boolean because "3 of 4
ready" is what the UI has to draw. A tick flies over each hero who has
committed and three dots over each one still deciding — the same mark answers
"are we waiting on you" in a fight, where it means a card is locked in.

Map generation is seeded — `seededRandom(seedFromCode(code))` — so a room code
is a ruin, the same one on the server, in the client, and in the tests.

### Buildings, power and the bolt gun

Two buildings, and they are the Engineer's whole mechanic.

| | Costs | Gives |
| --- | --- | --- |
| **Solar Panel** | 3 Screws + 2 Plating | +1 power a fight. Build as many as you like |
| **Workbench** | 4 Screws + 3 Pipe | Upgrades the bolt gun. Max one |

> **The panel is drawn two tiles across but occupies one.** That is deliberate
> and temporary: a real footprint is a `content.js` signature change and
> therefore a `src/rooms.js` re-port. See **[Multi-tile buildings](#multi-tile-buildings-not-built-yet)**.

**Power is the only pool nobody carries.** Panels make it, a fight spends it,
and whatever is left at the end evaporates — `powerFrom` recomputes it at every
surge. Hoarding is not a strategy; you either spent the sunlight this round or
you did not. It is also the only pool that is *hidden from the rest of the
party*, because nobody else can spend it and a number you cannot use is one you
learn to skip past.

The Engineer opens holding one **Bolt Gun**: 1 power for a strike of 9, the
hardest hit in any opening deck. It is not consumed — the gun is a gun, not a
potion — so it cycles back through the discard like any basic. What changes is
how many there are and how hard they hit, and both are bought at the workbench:

| Upgrade | Base cost | Does |
| --- | --- | --- |
| **Second Barrel** | 3 Screws + 2 Pipe | another Bolt Gun into the deck |
| **Overcharged Coil** | 2 Plating + 1 Coil | every bolt hits for 3 more |

Both repeat, and both get dearer each time by `step` — an Engineer who never
stops upgrading should feel the cost rather than compound for free.
`cardEffect(id, upgrades)` is what applies the damage, so `CARDS` stays
declarative and the client and the room cannot disagree about how hard a bolt
hits.

The opening is a decision. `STARTING_SALVAGE` covers a Solar Panel *or* a
Workbench and deliberately not both — power now against upgrades later — and
two tests pin it: one that the panel is always affordable on round one, because
a bolt gun with nothing to draw on is a dead card in an opening hand, and one
that buying either leaves the other out of reach.

### The surge

Combat is a **lane, not a field**: `COMBAT_H` is eight rows of the map's width,
because the wave closes from one side and a full-height board spent most of its
pixels on ground nobody crosses. It generates its own terrain and is a diorama
of the numbers — everything clickable is in the wave row and the hand below it.

An enemy is authored by its distance and its damage. `dist` is how many turns
the party has before it arrives; `hits` is what each turn costs once it does.
Every resolved action closes the whole wave by one stride, so there is no free
action — a heal is a turn you did not spend on something still walking toward
you. Strikes hit the enemy you aimed at, or the nearest one if you did not.

Waves scale by **composition, not stats**: a later round sends more and faster
things rather than the same thing with a bigger number, because "there are four
of them now" is legible on a screen in a way "+2 hp" never is. A test proves the
boss cannot leak into an earlier round.

#### Levelling a fight to the table

`waveFor(round, partySize)` spends a **threat budget** rather than trimming a
fixed list. Each enemy carries a `threat` — what one of it is worth against one
player — and each round carries a `THREAT_PER_PLAYER` figure. Filling cycles the
round's pattern while the budget covers the next thing and the lane has room
(`WAVE_CAP`, six, is what the lane can show without sprites sharing rows); the
remainder then **promotes** the weakest enemy present up the tier ladder. So a
bigger table meets a fuller lane *and* worse things in it, rather than the
five-player fight with three enemies deleted.

Two numbers refuse to be levelled that way and get their own treatment:

- **The party is worth more than the players in it.** `PARTY_SYNERGY` makes the
  budget superlinear. At a linear budget, settings that left a solo player
  winning three runs in five had two players winning ninety-seven — a second
  player brings a whole second class, somebody to spread the round-robin over,
  and the ability to lose a member and keep fighting.
- **The boss is always exactly one thing**, so it cannot scale by arriving in
  different numbers. `BOSS_SCALING` grows the Extractor's health *and* what it
  swings for. The damage matters more than it looks: a single enemy hits one
  player a round, so at a table of three the same number is a third of the
  pressure it is on a table of one.

**These are measured, not argued.** `node test/balance.mjs` drives the real
`Room` over the real protocol through whole runs — a build phase that gathers,
builds and brews, then combat played by a model of somebody paying attention but
not solving the game — and reports the win rate per table size:

```
node test/balance.mjs             400 runs per table size
node test/balance.mjs 1000        a tighter interval
node test/balance.mjs 400 1       one table size
```

The target is 60%. At the numbers currently in `content.js` it lands **69% /
63% / 78%** for one, two and three players, and the harness prints per-class
damage under each row so the composition behind a number is visible. The full
table runs friendliest on purpose: it is the only one with a Wizard, she is
the party's damage by design (about double anyone else's), and the harness
plays her bench well. The threat values are coarse (1, 2, 3.5), so a tenth of
a point can flip a whole enemy into or out of a wave and move a win rate forty
points — tune with the harness open, never by eye.

#### What the blight leaves behind

Damage is a number and is over; an **ailment** is the same monster still costing
you something three turns later. `AILMENTS` holds three, and each takes a
different thing away: `rot` takes health every round and guard cannot stop it,
`weak` takes damage off everything you swing, and `stun` takes the turn itself.
They refresh rather than stack — two Sporelings should be twice as many things
to kill, not four rot ticks a round on one person.

An enemy's `ability` names which one it lands and `every` how many of its blows
have to land first, counted on `enemies[].landed`. **A blow that guard swallowed
whole never counts**, which is the reason to spend a card on a ward against a
Creeper rather than trade with it: you are not buying health, you are buying the
two rounds of Weakened that would have followed. The cadence is arithmetic on a
counter rather than a roll, so a replayed room lands the same statuses.

Statuses age at one fixed point in the turn — `tickAilments()`, after the cards
resolve and *before* the wave lands new ones — so a rot dealt this round does
not also tick this round, and a one-round stun lasts exactly the one turn it
says it does. Effects granted by a card carry `fresh`, which survives its first
ageing: a buff aged the same evening it was given would be a zero-round buff.

#### The party cards

Every class opens with two cards that are only worth holding because there is
another seat at the table: the Alchemist's Blight Censer and Restorative
Vapours, the Engineer's Bulwark and Jumper Cables, the Wizard's Lend a Page and
Cinder Nova. Bulwark is the shape of all of them — guard on everyone, worse per
head than Shore Up on one, so it is the wrong card at a table of one and the
best card in the deck at a table of five.

Lend a Page is the clearest of them: it does no damage, it lands on somebody
else's *next* turn, and it is worth a page only if that person then swings. Two
people have to agree about a round in advance. One copy each rather than two, on
purpose — a card you hold every other turn is a rotation, not a moment.

Only one of them could have been dead weight solo, and it is not: with nobody
down, Jumper Cables jolts whoever is worst off instead of doing nothing.

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
`applyState()` in `play.html`, and `docs/tool-haven-server.md` for why that is
the only state update the client is allowed to defer.

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

Doing it properly is a `content.js` signature change, and that makes
`src/rooms.js` a re-port for someone with Tool Haven access. Worth doing, worth
doing deliberately:

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
- The `{id, x, y}` record is a **persistence** contract — Tool Haven stores it
  and mid-run rooms survive redeploys, so a stored room can come back holding
  the old shape after a new deploy.
- The hover ghost and the placement preview in `play.html` outline one tile.

## What is not built yet

Honest status, so nobody discovers these at the table:

- **The deployed Worker predates the scriptorium and the garden.** The
  `page`/`pick`/`mod` and `plant`/`harvest` intents live in `src/rooms.js` and
  the offline preview; the Tool Haven Durable Object safely ignores them until
  someone with access re-ports it. Deployed rooms still run the old page-ammo
  wizard, whose cards and costs are kept in `content.js` untouched for exactly
  that reason.
- **A hand of nothing but costed cards is possible late.** An Engineer with
  several Bolt Guns and no power can draw three unplayable cards; *Do nothing*
  is the way out, and it is always available.
- **The full table runs friendliest.** 78% measured against a 60% target,
  because the Wizard is the only pure damage seat and only the three-player
  table has one. Levelling by composition rather than by head-count is a
  future dial; `PARTY_SYNERGY` and `BOSS_SCALING` are the current ones.
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

### Private hands

This is the first per-player state in the game, and it is why views are built
per socket rather than broadcast whole. You get your own `deck`, `discard` and
`hand` as arrays; everybody else arrives as `deckCount`, `discardCount` and
`handCount`. Their `intent` says *that* they committed, never *what* — a hand
is secret right up to the moment the round resolves.

### Determinism

Every shuffle and every roll comes from a generator the room owns, and each
player has their own stream keyed off their id, so one player drawing cannot
shift anyone else's draw. Combat resolves in player-id order and never in the
order the clicks arrived: the same commitments have to produce the same round
however the network delivered them.

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
