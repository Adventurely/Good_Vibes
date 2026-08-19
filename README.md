# Game Server

A stand-alone Node server with a game selection menu. No dependencies anywhere —
just the Node standard library and a browser.

```bash
npm start          # then open http://localhost:3000
```

`/` is the menu, built from the game registry. One game ships with it:

- **[Good Vibes](games/good-vibes/README.md)** — a co-op solarpunk roguelike for
  one to five players, at `/games/good-vibes/`

Nothing here is copied into anything else and nothing deploys from it. Clone it,
run it, open the menu, pick a game.

## Requirements

- Node.js 18 or newer

## Running

```bash
npm start
```

The port and bind address can be overridden with environment variables:

```bash
PORT=8080 HOST=127.0.0.1 npm start
```

## Routes

| Route                    | Response                                         |
| ------------------------ | ------------------------------------------------ |
| `/`                      | the game selection menu                          |
| `/api/games`             | the catalogue as JSON — what the menu is built from |
| `/games/<id>/`           | that game's entry page                           |
| `/games/<id>/<file>`     | anything in that game's public directory         |
| `/api/games/<id>/<path>` | that game's WebSocket, if it declares one        |
| `/healthz`               | `{"status":"ok"}`                                |
| anything else            | `404 Not Found`                                  |

A game's files are reachable only under its own prefix, and only from inside its
own public directory — its server code and its manifest are not served.

## Adding a game

A game is a folder under `games/` with a manifest at its root. The server knows
nothing about any particular game: it serves the manifest's public directory,
puts the manifest's copy on the menu, and hands sockets to the manifest's socket
handler.

```js
// games/my-game/game.js
export default {
  id: 'my-game',                          // url-safe; served at /games/my-game/
  title: 'My Game',
  tagline: 'One line under the title',
  blurb: 'A sentence or two on the menu card.',
  players: '1–4',
  entry: 'index.html',                    // inside publicDir
  publicDir: new URL('./public/', import.meta.url),

  socket: {                               // optional
    path: 'ws',                           // /api/games/my-game/ws
    validate({ query }){ return null; },  // a string here refuses with 400
    open(socket, { query }){ /* the socket is yours */ },
  },
};
```

Then one line in `src/games/catalog.js`. Nothing in `src/` changes, and the menu
picks it up on the next start.

**Everything in `publicDir` is public**, including any rule modules the browser
and the server both import — which is the point: a path means the same thing on
disk and over the wire, so what the browser resolves is what a bundler resolves.
Keep server-only code outside it, as `games/good-vibes/server/` is.

`validate` runs **before** the handshake so a request that was never going to
work fails as a plain HTTP error rather than as a socket that says nothing.
`open` receives the accepted socket — `send`, `close`, `onMessage`, `onClose` —
and owns it from then on.

## Layout

```
src/main.js          entry point: npm start
src/config.js        where to listen

src/http/server.js   requests to the router, upgrades to whichever game owns
                     the path
src/http/router.js   the routes above, and nothing that knows what a game is
src/http/static.js   serving files off disk without ever leaving a mount
src/http/respond.js  every reply goes through one of these
src/http/mime.js     content types

src/ws/frames.js     RFC 6455 framing: encode, and pull frames off a stream
src/ws/socket.js     the handshake, and the small socket wrapper above it

src/games/registry.js  what a manifest is, and the catalogue it goes into
src/games/catalog.js   the one file that knows which games exist
src/lobby/page.js      the menu, rendered from the registry

games/good-vibes/    the game — see its own README

test/platform/       routing, static safety, and the upgrade path
test/good-vibes/     the game's rules, its room, and a balance harness
tools/               a bundler that inlines the game into one HTML file
```

`src/ws/` exists because this project has no dependencies and Node ships a
WebSocket *client* but not a server. It is the RFC 6455 handshake, frame
parsing, and nothing else — no extensions, no binary frames. A turn-based game
sends a few kilobytes of JSON per action, so none of that earns its complexity.

## Tests

```bash
npm test
```

`test/platform/` covers the server: that the menu lists what the registry holds,
that a game's files are reachable under its prefix, that nothing outside a
game's public directory ever is, and that the upgrade path refuses what it
should. `test/good-vibes/` covers the game.

## The preview channel

There is a publishing path for looking at Good Vibes without a server: pushing
to the `preview` branch sends the game's `public/` verbatim to GitHub Pages,
where the client's offline `?preview` mode plays a single-seat run against a
fake room. It is the phone-testing URL, and it deliberately cannot host a real
game — rooms and the socket need this server, which Pages cannot run.

    git push origin HEAD:preview        # publish whatever you are looking at

`npm run preview` does the same thing offline, bundling the game into a single
self-contained HTML file in `dist/`.

**One thing is in the way: the default branch.** The `github-pages` environment
accepts deployments only from the repository's **default branch** unless
somebody widens it, so a run from any other branch is refused before its job
starts — it fails in about a second with no runner, no steps and no logs, which
reads like a broken workflow and is not one. The fix is Settings → General →
Default branch → `main`. To keep `preview` publishing too, also add it under
Settings → Environments → `github-pages` → Deployment branches and tags.
