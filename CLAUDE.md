# Working in this repo

## Git

**Push finished work to `main`.** When a feature is done and the tests pass,
push it to `main` — don't leave it sitting on a branch waiting to be asked
about, and don't open a pull request unless asked for one. Development still
happens on whatever working branch the session was given; `main` is where it
lands once it is finished.

Before pushing to `main`, fetch it first: it moves under you while you work.
Merge it into the working branch, resolve anything that conflicts, and run the
tests on the merged tree — not on the tree you developed against.

## Tests

`npm test` runs everything (`node --test`). The whole suite takes a few minutes.

The `*-balance.mjs` files in `test/` are harnesses rather than tests — they are
not picked up by `node --test`. Each plays its game the way an unimaginative
player would and prints what the first few years look like. Run one by hand
(`node test/orbital-balance.mjs`) when a change could move the economy or the
flight model, and read its numbers as a shape rather than a pass or a fail.

## Generated content

`public/orbital-trader/data/*.js` is generated. Edit the JSON under
`tools/orbital-trader/design/` and run `node tools/orbital-trader/build-content.mjs`.
Editing the generated module directly gets overwritten by the next build, and
a test checks that the two agree.

The design tables are one per subject: `tuning.json` (the sky), `economy.json`
(goods, ports, prices), `narrative.json` (in-world text), `quests.json` (the
errands), `dialog.json` (what the crew say, and where) and `events.json` (what
can happen between one reach and the next). The last three each
open with a `notes` block describing their record format, and the build step
checks every record against it and refuses to write anything if one is wrong —
so a table that does not keep to its own shape fails loudly rather than
shipping.
