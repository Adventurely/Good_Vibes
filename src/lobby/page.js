/* The game selection menu.
 *
 * Rendered from the registry rather than written out, so a game added to
 * catalog.js appears here without this file changing. Self-contained: no
 * stylesheet to fetch, no script, no fonts — the menu should be up before any
 * particular game is.
 */

const escape = value => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const card = game => `
      <li class="game">
        <a class="card" href="${escape(game.href)}">
          <h2>${escape(game.title)}</h2>
          <p class="tagline">${escape(game.tagline)}</p>
          <p class="blurb">${escape(game.blurb)}</p>
          <p class="meta"><span class="players">${escape(game.players)} players</span><span class="go">Play →</span></p>
        </a>
      </li>`;

const EMPTY = `
      <li class="empty">
        <p>No games are installed. Add a manifest under <code>games/</code> and
        register it in <code>src/games/catalog.js</code>.</p>
      </li>`;

export function lobbyPage(games){
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Games</title>
<style>
  :root{
    color-scheme: dark;
    --bg:#0f1410; --panel:#18201a; --edge:#2b3a2e;
    --ink:#e6efe4; --dim:#9fb3a0; --accent:#8fd694;
  }
  *{ box-sizing:border-box; }
  body{
    margin:0; min-height:100vh; background:var(--bg); color:var(--ink);
    font:16px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif;
    display:flex; flex-direction:column; align-items:center;
    padding:clamp(1.5rem, 5vw, 4rem) 1.25rem;
  }
  header{ text-align:center; margin-bottom:2.5rem; }
  h1{ margin:0 0 .35rem; font-size:clamp(1.75rem,4vw,2.5rem); letter-spacing:-.02em; }
  header p{ margin:0; color:var(--dim); }
  ul{ list-style:none; padding:0; margin:0; width:100%; max-width:60rem;
      display:grid; gap:1.25rem; grid-template-columns:repeat(auto-fit, minmax(18rem, 1fr)); }
  .card{
    display:flex; flex-direction:column; height:100%; gap:.5rem;
    padding:1.5rem; border:1px solid var(--edge); border-radius:12px;
    background:var(--panel); color:inherit; text-decoration:none;
    transition:border-color .15s ease, transform .15s ease;
  }
  .card:hover, .card:focus-visible{ border-color:var(--accent); transform:translateY(-2px); }
  .card:focus-visible{ outline:2px solid var(--accent); outline-offset:3px; }
  h2{ margin:0; font-size:1.3rem; }
  .tagline{ margin:0; color:var(--accent); font-size:.95rem; }
  .blurb{ margin:.25rem 0 0; color:var(--dim); font-size:.95rem; flex:1; }
  .meta{ display:flex; justify-content:space-between; align-items:center;
         margin:.75rem 0 0; font-size:.85rem; color:var(--dim); }
  .go{ color:var(--accent); font-weight:600; }
  .empty{ color:var(--dim); text-align:center; }
  code{ background:#0b0f0c; padding:.15em .4em; border-radius:4px; }
  footer{ margin-top:3rem; color:var(--dim); font-size:.85rem; }
</style>
</head>
<body>
  <header>
    <h1>Games</h1>
    <p>Pick something to play.</p>
  </header>
  <main>
    <ul>${games.length ? games.map(card).join('') : EMPTY}
    </ul>
  </main>
  <footer>Served locally · <a href="/healthz" style="color:var(--accent)">status</a></footer>
</body>
</html>
`;
}
