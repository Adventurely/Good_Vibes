#!/usr/bin/env node
/* Bundle the game into one self-contained HTML fragment for a Claude artifact.
 *
 * The artifact host wraps whatever it is given in its own <!doctype>/<head>/
 * <body> skeleton and its CSP blocks every network request — so the page must
 * carry everything: no module imports to fetch, no server to reach. This
 * script takes the game's play.html, inlines its five ES-module imports with
 * esbuild, forces the client's own offline preview mode (the ?preview path,
 * which never opens the WebSocket), and emits a fragment: title, style, body
 * markup, and one dependency-free script.
 *
 * Usage: node tools/preview-artifact.mjs [outfile]   (default dist/preview.html)
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = resolve(process.argv[2] || join(root, 'dist', 'preview.html'));
const gameDir = join(root, 'games', 'good-vibes', 'public');
const html = readFileSync(join(gameDir, 'play.html'), 'utf8');

/* Pull the three pieces out of the full document. Anchored, and they throw
   when the anchor moves, because a bundle built from a half-matched page
   would publish a broken game rather than fail here. */
function slice(source, from, to, label){
  const start = source.indexOf(from);
  if(start === -1) throw new Error(`play.html: cannot find start of ${label} (${from})`);
  const end = source.indexOf(to, start + from.length);
  if(end === -1) throw new Error(`play.html: cannot find end of ${label} (${to})`);
  return source.slice(start + from.length, end);
}

const style = slice(html, '<style>', '</style>', 'style block');
const body = slice(html, '<body>', '<script type="module">', 'body markup');
let entry = slice(html, '<script type="module">', '</script>', 'game script');

/* The artifact URL carries no query string, so the ?preview deep link cannot
   be the switch — make offline preview the default instead. '' is the plain
   ?preview behaviour: boot into the build phase, ready up to reach combat. */
const bootLine = "new URLSearchParams(location.search).get('preview');";
if(!entry.includes(bootLine)) throw new Error('play.html: preview boot line moved; update this script to match');
entry = entry.replace(bootLine, "new URLSearchParams(location.search).get('preview') ?? '';");

/* Bundle from inside the game's public/ so the ./shared/index.js-style imports
   resolve the same way they do in the browser. IIFE output, so the inlined
   result asks the page to fetch nothing. */
const entryFile = join(gameDir, '.preview-entry.mjs');
writeFileSync(entryFile, entry);
let js;
try {
  js = execFileSync('npx', ['--yes', 'esbuild', entryFile, '--bundle', '--format=iife'], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
} finally {
  rmSync(entryFile, { force: true });
}

/* </script> inside an inline script ends the script wherever it appears,
   even mid-string — the classic inline-JS injection footgun. */
js = js.replaceAll('</script>', '<\\/script>');

const fragment = `<title>Good Vibes</title>
<style>
${style}
</style>
${body}
<script>
${js}
</script>
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, fragment);
console.log(`wrote ${outFile} (${(fragment.length / 1024).toFixed(0)} KiB)`);
