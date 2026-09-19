# Good Vibe Beats — Design Decisions Snapshot

Named **Good Vibe Beats** and served at `/gvb/`; the prototype below called
itself "Good Vibes Drums", which is the same game under its working title.

Handoff snapshot, written against the single-file prototype. The prototype has
since been ported into the repo at `public/gvb/` — `content.js` (the rules, pure
and tested in Node), `audio.js` (the Web Audio kit), `play.html`, `index.html`
and `shot.js` (the shelf card). The scoring was checked against the prototype
over ~420,000 combinations before the prototype was retired; the numbers below
are the numbers that shipped.

Items marked **Decided** came from Jack. Items marked **Prototype default** are
values picked to make it playable; tune freely. Items marked **Open** still need
a decision.

---

## 1. Core concept (Decided)

- A rhythm game in the Good Vibes collection built around a **drum pad**.
- The game **prioritizes syncopated rhythms**: hitting between beats (off-beats, anticipations, fills) is what earns big points.
- Platforms: **phone (touch) and desktop (keyboard)**, both first-class.
- Vibe: **chill, no fail**. Missing notes never ends a song; it just scores less.

## 2. Pads and progression

- **Decided:** start with **4 pads**; more pads unlock through **XP / levels earned by playing** (no real-money purchases).
- **Prototype default:** Kick (F), Snare (G), Hat (H), Clap (J). Tom (D) unlocks at Lv 2, Crash (K) at Lv 3.
- **Prototype default:** 500 XP per level. Jam XP = score / 50. Learn XP = 10 per star, plus 40 per newly earned star.
- **Prototype default:** pad grid is 2×2, growing to 3×2 (2×3 on narrow phones) once extra pads unlock. Locked pads show dimmed.

## 3. Game modes and session structure

### Learn (tutorial) — Decided
- **Call and response**, used **only in beginner levels**.
- The game plays a groove; the player hears it, then plays it back.
- The player must get a **visual countdown and a metronome countdown** before their turn so they never have to copy immediately or guess when to start.
- Current flow per lesson (one bar each):
  1. **Listen in** — big 4-3-2-1 on screen + loud clicks
  2. **Listen** — the groove plays, pads flash as cues, soft click underneath
  3. **Your turn in** — big 4-3-2-1 again + loud clicks
  4. **Play** — player copies it; steady medium click + four beat dots
- Grading (prototype default): hit must match pad + 16th-note step within ±90 ms. Accuracy = matched / (expected + 0.5 × extra hits). Stars: ≥90% = 3, ≥70% = 2, ≥40% = 1.
- Prototype lessons (in order): Backbone, Eighth hats, The "and", The push, Off-beat claps, Sixteenths, Tresillo, Clave.

### Jam (freestyle) — Decided
- **Endless freestyle until the song ends.** No prescribed notes.
- Player makes up their own beats; the game scores **whether the beats fit the song's time signature** and gives **more points for interesting rhythms**: syncopation, upbeat playing, fills, etc.
- **No on-screen beat grid** — play by feel. (Beat dots show only during the count-in.)
- A 4-beat visual + metronome count-in before the song starts.

## 4. Jam scoring spec

Tempo and time signature come from song metadata, not audio analysis. Hits are adjusted by the calibrated latency offset, then snapped to the nearest 16th note or 8th-note triplet (triplet only if clearly closer and off the beat).

| Rule | Prototype value |
|---|---|
| Timing window | Perfect ≤ 35 ms = 100 pts, Good ≤ 80 ms = 50 pts, beyond = off-grid, 0 pts (no penalty) |
| Groove anchor | +20 for kick on beats 1/3, snare or clap on 2/4 |
| Upbeat ("&") | ×1.5 |
| Syncopated ("e"/"a") or triplet swing | ×2 |
| Push | +75 when a hit lands on the "&" or "a" before a beat and the beat itself is left empty |
| Fill | +300 when the last 2 beats of a 4-bar phrase contain ≥5 distinct 16th positions and a hit lands on the next "1" |
| Fresh bar | +100 when a bar's pattern is <50% similar (Jaccard) to the previous bar |
| Locked-in bar | +30 when a bar is ≥85% similar to the previous bar |
| Anti-mashing | More than 6 hits within one beat → points × (6 / hits)² |
| Duplicates | Same pad, same grid slot = ignored |

## 5. Feedback and visuals (Decided)

- Feedback shows **both** as **live pop-ups** during play ("Syncopated", "Push", "Fill!", "Fresh", "Locked in", "Too busy") **and** an **end-of-song breakdown**.
- Look: **clean and minimal; pads pulse with color** on hit.
- Prototype color language: blue = on the beat, teal = upbeat, pink = syncopated, amber = fill/push, grey = off-grid.
- Prototype typeface: Bricolage Grotesque. Light and dark themes via CSS tokens; respects reduced motion.
- End-of-song breakdown lists: score, XP gained, level-ups/new pads, perfect/good/off-grid counts, groove anchors, upbeats, syncopated hits, pushes, fills, fresh bars, locked-in bars, syncopation share.

## 6. Music

- **Decided (name):** the game is **Good Vibe Beats**, served at `/gvb/`.
  Singular *Vibe*, like the site.
- **Decided:** worlds are **genres** — a **mix of genres as separate worlds**, each with its own songs and drum-kit feel.
- **Decided:** songs are **curated by default**; **custom songs unlock later** (prototype placeholder: Lv 5).
- **Decided (latest):** Jack **really wants real music, specifically tracks stripped of percussion** so players make their own beats. This supersedes the earlier "Spotify at the center" direction for the core game.
- **Constraint:** Spotify cannot supply drumless audio. The embed only streams the full mix, exposes no audio data, and gives 30-second previews to logged-out users; Spotify also cut tempo/beat analysis for new apps (late 2024). Ripping or stem-splitting Spotify audio is not allowed.
- **Open — source of drumless tracks.** Options discussed:
  - Stock libraries that sell stems (e.g. Epidemic Sound, Soundstripe) — drop the drum stem. Verify the license covers in-game/app use.
  - Commission drumless tracks from indie producers with a game license.
  - AI stem separation (Demucs, LALAL.AI, Moises) — only on music Jack owns or has licensed.
  - Keep Spotify as an optional later "drum over your own music" mode (full mix, tap-to-sync, looser timing).
  - Claude's suggestion: commissioned drumless tracks + a stem library.
- **Implementation direction for self-hosted tracks:** play audio files through the Web Audio API with exact BPM, time signature, and first-downbeat offset stored per track. That removes the need for tap-to-sync and keeps timing precise.
- **Prototype stand-in:** two synthesized drumless grooves — Lo-fi world "Dusty Keys" (84 BPM) and Funk world "Pocket Change" (104 BPM), 24 bars each, bass + keys + soft shaker.

## 7. Timing and calibration

- Timing calibration screen: 16 clicks at 120 BPM, player taps along; median offset of taps 5–16 is stored (clamped −50 to +300 ms). Default before calibrating = device's reported base + output latency.
- All scheduling uses `AudioContext.currentTime` with a 25 ms / 150 ms lookahead scheduler. Hits read `currentTime` minus the offset.
- Saved locally (`localStorage`, keys prefixed `gvd_`): XP, lesson stars, calibration offset.

## 8. Hosting

- **Decided:** host on **Good Vibes**; Good Vibes games live in a **code repo**. Commit the prototype there.
- A preview copy is also published as a Claude artifact.

## 8a. What the port found (new)

- **Above about 94 BPM, "off the grid" is unreachable.** A hit is off-grid only
  if it is further than the 80 ms good window from *every* grid line, and the
  furthest anything can be from the nearest sixteenth is half a sixteenth. Past
  the tempo where half a sixteenth is narrower than the window, every hit lands
  on something. Funk world (104 BPM) is already past that line, so its results
  screen always reads `Off the grid: 0` and the good window decides nothing.
  Lo-fi world (84 BPM) is below it and behaves as written. Pinned by a test so a
  change to `GOOD_MS`, or a new world at a new tempo, is a decision rather than a
  surprise. Belongs with item 6 below.
- **The lessons only ever use the four starting pads**, which is enforced by a
  test: a lesson that asked for the tom would be a lesson nobody below Level 2
  could pass.
- **The typeface is now self-hosted.** The prototype loaded Bricolage Grotesque
  from Google Fonts, which would have made GVB the only page on Good Vibes to
  fetch anything third-party. **Decided:** keep the face, serve it ourselves —
  `public/gvb/font/`, one variable woff2 covering 200–800, latin subset, with
  the SIL OFL beside it. Settled.

## 9. Open items / next steps

1. Pick the drumless music source and licensing (section 6).
2. Replace synthesized grooves with a track loader: audio file + metadata (`bpm`, `timeSignature`, `firstDownbeatSec`, `world`, `bars`).
3. Support time signatures other than 4/4 in scoring (scoring currently assumes 4 beats per bar).
4. Decide the final list of genre worlds and their per-world bonuses (e.g. clave pattern bonus in a Latin world, ghost notes in funk).
5. Design the custom-song unlock (what "custom" means once Spotify isn't the core).
6. Tune scoring values and timing windows from playtesting.
7. Expand the lesson ladder and decide how beginner levels hand off to freestyle.
