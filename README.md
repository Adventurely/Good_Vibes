# Good Vibes

A minimal Node.js HTTP server that serves a pixel art hello world page. No
dependencies — just the Node standard library.

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
public/content.js   the game as data — classes, materials, recipes, levels
public/art.js       the palette and every sprite, as text
public/play.html    the game: lobby, class select, and the run
public/pixel.js     bitmap font and canvas helpers
public/index.html   the pixel art hello world page and its style guide
src/app.js          dev server: static files out of public/
src/server.js       HTTP server entry point
test/content.test.js validates the class and sprite data
test/server.test.js integration tests
```

**`content.js` is the file to edit.** It is imported by the browser *and* by
the authoritative room object in Tool Haven, which is what stops the rules and
the UI ever disagreeing about what a potion does. It is also why the file stays
declarative — a throw at its top level would take the whole Worker down — and
why `test/content.test.js` checks the shape of every class before the publish
workflow will sync anything.

Adding a class is a block in `CLASSES` and a sprite in `art.js`. Every field is
documented above the array, and the test names the one you missed. Four seats
are still open; `OPEN_ROLES` says what the party is short of and the lobby
shows them as locked rather than pretending the roster is full.

**`art.js` is client-only** — the engine references an art key by name and
never reads a sprite. A mistake in there can break a picture but not the
Worker, which makes it the safest file in the project to experiment in.

## The game

Solarpunk roguelike. Five levels down through a ruin that is growing back, and
the ruin itself is the pressure: blight is ambient damage every round, rising
per level, so standing still costs health.

A round is **simultaneous** — everyone commits an action and the whole round
resolves when the last one is in. Five players never watch each other think,
and resolution order is fixed by player id so the same commitments always
produce the same round however the network delivered them.

Materials go to a **shared stash**: anyone can gather, and the Alchemist brews
from the pool for the whole party. That is the Alchemist's role — it gathers
double and it is the only class that can turn the pile into potions.

**There are no enemies yet, on purpose.** What a fight looks like depends on
the four classes built to fight it, so blight stands in as the pressure until
those exist. The loop underneath it is real and finishable today.

`pixel.js` is the file that keeps this looking like one game. Both pages import
the same palette and the same glyphs rather than carrying a copy, so a colour
can only be changed in one place — which is the only way a style guide stays
true once there is more than one screen.

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
exists on Tool Haven, so the lobby will sit there reconnecting. The lobby is
best tested on the deployed site. Everything that does not need a room — the
scene, the palette, the page itself — works offline.
