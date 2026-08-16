# Good Vibes

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
| Hero sprites | 24 &times; 32, one skeleton under the whole cast |
| Terrain tiles | 16 &times; 16, noise rather than motifs so they tile |
| Buildings | 16 &times; 16, transparent at the corners |
| Icons — materials, salvage, cards, marks | 8 &times; 8 |

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
public/art.js       the palette, the tiles, and every sprite, as text
public/play.html    the game: lobby, build phase, the surge, the hand
public/pixel.js     bitmap font and canvas helpers, shared by both pages
public/index.html   the pixel art hello world page and its style guide
src/app.js          dev server: static files out of public/
src/server.js       HTTP server entry point
test/content.test.js validates every table above and the rules over them
test/server.test.js integration tests
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
| Spends on | potions | buildings | fireballs |
| Health | 30 | 32 | **22** |

The Wizard is the roster's glass floor and a test enforces it: strictly the
lowest hp of any class. It has the best basic attack and the worst basic guard,
which is the whole class in two cards.

Everything gatherable stands on the build map. `SPAWNS` puts out 5 herbs, 5
salvage caches and 3 spell pages; herbs need growable ground, caches and pages
only need somewhere walkable. `CACHE_YIELD` is fixed rather than rolled, so a
player can count what a trip is worth before spending the walk. Pages are
scarce on purpose — every fireball is a page somebody chose to burn.

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

A deck is nine cards — eight class cards plus the universal `hold` — so at three
a turn it cycles about every three turns and a fight sees the whole thing twice.

`deckFor(classId, buildings)` is the two-phase loop's point of contact, and it
is literal: **what you built is what you draw.** Every standing building deals a
copy of what it `grants` into *everyone's* deck, because the pylon belongs to
the site and not to whoever bolted it down.

Shuffling and dealing are pure functions taking the generator, like everything
else that rolls here. A client that shuffled for itself would hold cards the
room never dealt it, and a replayed room would deal a different hand than the
one that was played. Each player needs their own stream, too, or one player's
draw shifts everyone else's. `draw()` returns new piles rather than mutating,
because two callers sharing an array is how a hand ends up in somebody else's
deck.

Cards are the *only* interface in a fight. There is no second list of things you
can do — a card that costs pages is dealt like any other and simply greys out
when the library is empty, which is a bad draw the player caused.

### The build phase

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

Click a herb or a cache on the map to gather it, or use the buttons under the
map, which send the identical intent and are the path that works from a
keyboard. Pick a building, then click where it goes; the tile previews the
structure and refuses water, rubble, another building and any tile with a herb
still standing on it.

**The phase turns when everyone is ready.** `readyState` counts only connected
players, so a party is not held in the build phase by someone whose train went
into a tunnel, and it returns counts rather than a boolean because "3 of 4
ready" is what the UI has to draw. A tick flies over each hero who has
committed and three dots over each one still deciding — the same mark answers
"are we waiting on you" in a fight, where it means a card is locked in.

Map generation is seeded — `seededRandom(seedFromCode(code))` — so a room code
is a ruin, the same one on the server, in the client, and in the tests.

### Buildings

A building is a tile you spent and a card the whole party draws afterwards. The
opening is deliberately a decision: `STARTING_SALVAGE` affords the Workbench
*or* the Arc Pylon and never both, and nothing in tier 2 at all — economy or
teeth, pick one, live with it for a cycle. That property is pinned by a test
rather than left to a comment, so a later balance pass cannot quietly make the
first move free.

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

`EFFECT_KINDS` lists what the engine implements: `heal`, `regen`, `ward`, and
`strike`. **`strike` is implemented in the offline preview only** — the Tool
Haven room has not grown it yet, so it works when you play the preview and does
nothing in a real room. Known gap, held open by a test.

## What is not built yet

Honest status, so nobody discovers these at the table:

- **Multiplayer does not work.** Everything below the lobby is the offline
  preview. The room object in Tool Haven does not implement the two-phase loop,
  the deck, or `strike`.
- **Hands are private and nothing supports that.** The room broadcasts one state
  object to every client; a hand needs a per-player view.
- **The site does not persist.** Terrain is regenerated and `buildings` is reset
  every round, so the base you built in round one is gone in round two. The
  persistent site is the design; this is the gap.
- **Only the Alchemist has a mechanic of her own.** The Engineer's powered
  weapons and the Wizard's prepared spells are designed, not written, so those
  two currently play as decks with a different mix.
- **Decks do not persist between rounds.** Cards brewed and granted during a
  build phase carry into that round's fight, but the next build phase starts
  from the same nine.
- **Nobody can die.** Damage is clamped above zero in the preview, and there is
  no down state, no party wipe and no lose condition.
- **Enemies only ever hit the local player** — no round-robin across a party.
- **Gathering teleports you** to the node rather than walking there.
- Per-class card systems — the Engineer's powered weapons, the Alchemist's
  brewed one-shots, the Wizard's prepared spells — are designed, not written.

## Where the game lives

The client is all here. The server is not, and cannot be: rooms are Durable
Objects, and a Durable Object binding is declared in the Worker that owns it —
Tool Haven's `wrangler.jsonc`. So the game is split, deliberately, along the
line of what a bad push costs:

| Half | Repo | If it breaks |
| --- | --- | --- |
| Client — art, UI, the loop | here | one page on the site |
| Rules and room state | `Adventurely/Tool-Haven` (`src/game/good-vibes.js`, `src/good-vibes-room.js`) | the whole site, including sign-in |

That is why the high-churn half is the one that syncs automatically. Working
here needs no access to the other repo at all.

**The room is the only writer of game state.** The client sends intents and the
engine decides what they mean. Keep it that way: it is what makes cheating a
non-issue, and it is what makes this half safe to move fast in.

## Playing locally

`npm start` serves the pages, but not the socket — `/api/good-vibes/ws` only
exists on Tool Haven, so joining a room will sit there reconnecting. Rooms are
best tested on the deployed site. Everything that does not need one — the
scene, the palette, the page itself — works offline.

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
