# Good Vibes

A co-op solarpunk roguelike for one to five players. No dependencies anywhere —
just the Node standard library and a browser.

This is one game inside a stand-alone game server; see the [repository
README](../../README.md) for the server, the menu and how to add another game.

```bash
npm start        # from the repository root
```

Then open <http://localhost:3000/games/good-vibes/>.

- **`public/index.html`** is the title screen: a generated ruin with the party
  walking it, a theme, and a way in.
- **`public/play.html`** is the game: lobby, build phase, and the surge.
- **`public/shared/`** is the rule book, imported by the browser *and* by the
  authoritative room — which is what stops the two ever disagreeing.
- **`server/`** is the room: seats, phases, intents, and the surge.

## Layout

```
game.js             the manifest the server reads: id, menu copy, socket route

public/shared/      the game as data, and the pure functions over them. Imported
                    by the browser and by the room, so the rules and the UI
                    cannot disagree. index.js is the barrel everything imports:
  party, grid, rng, effects, materials, buildings, classes, phases, cards,
  spellcraft            leaves — these depend on nothing
  record, lookups       the run's record; class and cost lookups
  pages, garden, rules  spawn counts, the pots, deck and movement rules
  enemies, worldgen     waves and their telegraph; terrain, camp and items

public/art.js       the palette, the tiles and their cuts, the props, and every
                    sprite, as text
public/stage.js     the surge's backdrop, painted rather than tiled: sky,
                    skyline, hedge, and a plaza with a sun laid into it
public/fx.js        what a resolved effect looks and sounds like, card first
                    and effect kind second, so nothing lands silently
public/audio.js     the three tracks — title, build, surge — and every sound,
                    synthesised, no files
public/pixel.js     bitmap font and canvas helpers, shared by both pages
public/play.html    the game: lobby, build phase, the surge, the hand
public/title.js     the title screen: a real generated site with the real party
                    walking it, drawn from the same modules the game uses
public/index.html   the landing page the title screen is mounted in

server/room.js      the room's lifecycle: seats, phases, and the run. The class
                    is assembled from the three files below
server/view.js      what each seat is allowed to see
server/actions.js   the build phase: every intent, all validated server-side
server/combat.js    the surge: commitment, resolution, and every effect
server/rooms.js     the live rooms, keyed by code
```

**`public/shared/` is where the rules are.** Both ends import it, which is why
it stays declarative: a throw at the top level of any module in there takes
down whichever end asked for it. `test/good-vibes/content.test.js` checks the
shape of every table before any of it can ship.

Adding a class is a block in `CLASSES` (`shared/classes.js`), a deck in
`STARTING_DECKS` (`shared/cards.js`), and a sprite in `art.js`. Every field is
documented above the array, and the test names the one you missed. The roster is
**five of five** — Alchemist, Engineer, Wizard, Hauler, Grafter — so
`OPEN_ROLES` is empty; a sixth seat would need `PARTY_SIZE` moved first, which a
test pins.

`COMBAT_ACTIONS` is a **deprecated alias of `CARDS`**, kept because a name that
has ever been exported is pinned by the published-contract test. Delete it once
nothing reads it.

**`art.js` is client-only** — the engine references an art key by name and never
reads a sprite. A mistake in there can break a picture but not the room, which
makes it the safest file in the project to experiment in.

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
Core is `(10+5)x2 = 30`; the same two sockets reversed are 25. Duplicates are
a real find — a second Kindling can turn up, and two spells can carry the
same ink — with rares kept genuinely rare by `MODIFIER_WEIGHTS` instead.

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
> (and the garden's `plant`/`harvest`) exist in `server/` and the
> offline preview; the Tool Haven Worker was a hand-port that predated them
> and safely ignores them until it is re-ported. The old page-ammo wizard
> path is untouched for exactly that reason.

### Moving

Point, click, walk. A click on the map names a destination; `pathTo` finds the
route with a breadth-first flood over walkable ground, and the sprite is stepped
along it a tile at a time so distance is something the player watches rather
than reads. Walking onto a node picks it up — having to click it again would be
a second click for a decision already made, and **anyone can pick up anything**:
herbs, caches and pages are all for whoever gets there.

Herbs used to be the Alchemist's alone — everybody else walked over one and it
stayed where it grew. That made four of the five seats walk past the thing the
build phase is mostly made of, and it made a party without her unable to brew at
all, which is not scarcity but a locked door. She is still far and away the best
at it: `gather` is 2 on her and 1 on everybody else, so the same node is worth
twice as much when she is the one who stoops. It is a reason to send her rather
than a rule about who is allowed.

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

Every class opens with the same six cards wearing different names: three
basic attacks and three basic wards, all at 3 (`CLASS_KITS` — the Alchemist's
flasks and steady hands, the Engineer's wrenches and shoring, the Wizard's
sparks and signs). The basics are the floor of a turn and nothing more;
everything a class actually *is* comes out of its build phase, so the deck a
fight sees is six basics plus whatever the round paid for. At three cards a
turn a kit cycles fast, and a player learns what is in theirs by round two.
(`STARTING_DECKS` and the `strike`/`hold` universals still exist for the
deployed Worker, which deals the older decks.)

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

Nothing in `server/` changed for any of it, which means nothing needed
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
> therefore a `server/` change. See **[Multi-tile buildings](#multi-tile-buildings-not-built-yet)**.

**Power is the only pool nobody carries.** Panels make it, a fight spends it,
and whatever is left at the end evaporates — `powerFrom` recomputes it at every
surge. Hoarding is not a strategy; you either spent the sunlight this round or
you did not. It is also the only pool that is *hidden from the rest of the
party*, because nobody else can spend it and a number you cannot use is one you
learn to skip past.

The **Bolt Gun** — 1 power for a strike of 9 — arrives with the first Second
Barrel: the Engineer builds her gun the way the Wizard writes her spells. It
is not consumed — the gun is a gun, not a potion — so it cycles back through
the discard like any basic. How many there are and how hard they hit are both
bought at the workbench:

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
(`intentOf`): every living enemy publishes what it is about to do — the damage,
the ailment its next landed blow would leave, and **which seat it is aimed at**.
It is derived, never stored, off the same counters `advanceWave` reads, so there
is no second copy of the rule to drift. You cannot see a monster coming any
more; you can see what it is about to do, which is a decision rather than a
countdown.

Who each blow lands on is one function, `waveTargets`, shared by the engine and
the telegraph — the moment a card could *change* the answer, two copies of that
rule would have been a bug waiting. It also rotates the opening seat each round:
deterministic round-robin was invisible while the wave arrived a piece at a
time, and glaring once all of it swings at once, because with two enemies and
three seats the third was never hit.

A round opens with the phase card, then the two sides **walk onto the field**,
and the cards go live once everybody is in place. Three beats: what this is, who
is here, go.

Waves scale by **composition, not stats**: a later round sends more and worse
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

The target is 60%. At the numbers currently in `content.js` it lands **53% /
65% / 61% / 54% / 62%** for one through five players — every table size inside
seven points of it.

That took one correction worth knowing about. The harness used to seat the
first N classes in roster order, so every three-player number was the
Alchemist, the Engineer and the Wizard, and every two-player number was the two
of them without her — and she is the party's damage by design. The curve it
drew was mostly a picture of who was sitting down rather than how many, and it
did not move when the dials did. It rotates the roster by the run index now, so
each size averages over every composition.

The threat values are coarse (1, 2, 3.5), so a tenth of a point can flip a
whole enemy into or out of a wave and move a win rate forty points — tune with
the harness open, never by eye. The sharpest edge in the file is the
Extractor's own `hits`: at a table of one it is the only thing swinging, and
three to four took solo from 72% to 6%.

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

#### Seats four and five

**The Hauler** is the only seat that buys with health. `hpCost` sits beside
`pageCost` and `powerCost`, and `cardPlayable` refuses the play that would take
the last point — a card must never be the thing that kills you. It buys two
things: `heft`, the only buff in the game that does not expire before the fight
does (it is a term inside `strikePower`, so it multiplies everything that seat
swings), and `cover`, the only card that changes *who* a blow lands on. Cover
has no charge counter: the number on the card is literally how much wave it
buys, a point of guard per point of damage, because the redirect ends when the
guard runs out. Which means the Engineer warding the Hauler is the Hauler
covering for longer, with nothing added to make it so.

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

`Graft` is the only effect that changes what somebody else will be holding: it
puts a Cutting on the top of an ally's deck, which means it is in their hand
next round, guaranteed. A Cutting is a strike, so it lands for four plus
whatever that arm is carrying.

#### Aiming at your own side

`targetsAlly` had been on five cards for a while and the client never read it,
so every one of them silently landed on whoever played it. Combat has an **ally
row** now, beside the wave row, and which row a card aims from is keyed off its
**effect kind** and never its icon — Bramble is a `defend` that hits nothing,
Graft is a `buff` that lands on somebody else, and Get Behind Me is a `defend`
that must not be aimable at all.

#### The party cards

Every class opens with cards that are only worth holding because there is
another seat at the table: the Alchemist's Blight Censer and Restorative
Vapours, the Engineer's Bulwark and Jumper Cables, the Wizard's Ember Rune and
Cinder Nova, the Hauler's Get Behind Me and Leg Up, the Grafter's Graft. Bulwark is the shape of all of them — guard on everyone, worse per
head than Shore Up on one, so it is the wrong card at a table of one and the
best card in the deck at a table of five.

Ember Rune is the clearest of them: it does no damage, it lands on somebody
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
`applyState()` in `play.html`, and `docs/history/tool-haven-server.md` for why that is
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
`server/` a change to the room. Worth doing, worth
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
- The `{id, x, y}` record is a **persistence** contract — a persisting host stores it
  and mid-run rooms survive redeploys, so a stored room can come back holding
  the old shape after a new deploy.
- The hover ghost and the placement preview in `play.html` outline one tile.

## What is not built yet

Honest status, so nobody discovers these at the table:

- **The deployed Worker predates the scriptorium and the garden.** The
  `page`/`pick`/`mod` and `plant`/`harvest` intents live in `server/` and
  the offline preview; an older hand-ported room safely ignores them until
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

**The room is the authority**, and it is in `server/`. Clients send intents and
get back a view; they never decide anything — not what a card does, not whether
a tile was reachable, not whose turn resolved first.

```
server/room.js     the lifecycle: seats, phases, and the run
server/view.js     what each seat is allowed to see
server/actions.js  the build phase: every intent, validated server-side
server/combat.js   the surge: commitment, resolution, every effect
server/rooms.js    the live rooms, keyed by code
```

The four files are one class. `room.js` declares it and mixes the other three
into its prototype, so every method runs against the same room's `this` — they
are separate files because they are separate concerns, not separate objects.

The socket itself is not here: the server owns the WebSocket, hands this game
the ones addressed to `/api/games/good-vibes/ws`, and `game.js` wires them to a
room. See the [repository README](../../README.md).

Every rule in `server/` comes out of `public/shared/` — the same modules the
browser imports. That is the whole point of keeping them pure: the two ends
cannot disagree about what a potion does.

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
`http://localhost:3000/games/good-vibes/play.html`, hit *New room*, and share the address — the
code travels in the fragment, so anyone who can reach the host can join by
opening the same link. On a LAN that is
`http://<your-ip>:3000/games/good-vibes/play.html#CODE`.

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
/games/good-vibes/play.html?preview          straight into a build phase
/games/good-vibes/play.html?preview=combat   straight into a fight
```

It is the one place the client writes game state, and it is fenced behind a
`demo` flag for exactly that reason. In a real room every one of those
decisions belongs to the room, and a second implementation of them here is the
disagreement this architecture exists to prevent. Preview is a preview of the
drawing, not a second copy of the game — do not grow it into one.
