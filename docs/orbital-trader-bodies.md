# The Lamp System: Every Body

A reference table of every astral body in Orbital Trader — star, planet, moon,
and the handful of places that are dockable without being worlds.

Compiled from the three places the sky is actually written down:
`docs/orbital-trader-design.md` §4.4 (the fiction),
`tools/orbital-trader/design/tuning.json` (the orbits and masses), and
`tools/orbital-trader/design/narrative.json` (the port blurbs). Numbers below
are derived from the tuning JSON; the generated `public/orbital-trader/data/*.js`
mirror it, so it is the one source to edit.

Eighteen bodies orbit the Lamp or something orbiting it: one star, six
planets, eight moons, one station, and two drifting places. Plus the Scatter,
which is a belt rather than a body.

---

## The bodies

| Body | Kind | Orbits | Orbit | Period | Who's there | Description |
|---|---|---|---|---|---|---|
| **The Lamp** | Star | — | at the origin | — | — | A warm orange star at the centre of everything. The chart's fixed point, and the only thing in the sky that is purely a hazard: it has no reach of its own because its reach is all of it. |
| **Cinder** | Planet | The Lamp | 0.3 au, circular | 59 d | Emberkin homeworld | Tidally locked, with a molten dayside, a frozen nightside, and every Emberkin city crowded into the twilight band between. The year lasts fifty-nine days, so the New Year party has never entirely stopped. The best engines anywhere are built here by people who will not live to see them wear out. Deep in the Lamp's well: falling in costs more than climbing out. |
| **Wanderwell** | Planet | The Lamp | 0.5–3.5 au, e = 0.75 | 2.8 y | Emberkin summer colony | A summer colony on an orbit that cannot make up its mind, swinging from scorched to frozen and back past the belt. At its low point the Emberkin arrive in their thousands and the market fills a valley; on the way out they leave all at once. The market is a migration, and its periapsis is a calendar players learn to plan around. |
| ↳ **Tagalong** | Moon | Wanderwell | 102,000 km, e = 0.02 | 14.5 d | Small otter raft | A pebble of a moon with a raft of otters on it, minding the empty colony through a two-year winter. There is a dock, a stove, and a great deal of conversation saved up. The only off-season trade at Wanderwell, with thin stock and a warm welcome. |
| **Tessel** | Planet | The Lamp | 1.0 au, circular | 360 d | Otter rafts | An ocean world with cities floating on it, lashed into rafts that drift and re-tie as the families argue and forgive. Every rumour in the system lands here first and leaves improved. The starting port, and the body the whole sky is scaled around: 498 km of radius, 9.25 m/s² at the ground, air to 70 km. A new game opens 75 km up, five above the air. |
| ↳ **Pip** | Moon | Tessel | 8,400 km, circular | 2.0 d | Otter shipwrights | A small moon that is mostly dry dock, crane, and argument about tolerances. The otters here fit your ship with anything they have, handle every upgrade, and have strong opinions about your paint. Destination of the opening delivery — one tap, one push, one crossing. |
| ↳ **Bramble** | Moon | Tessel | 17,400 km, circular | 6.4 d | Otter farming raft | A moon under hedgerows, feeding half the inner system out of terraced fields. The otters here work with their hands and distrust anyone who does not; they mean Ledger. The first place anybody flies to after Pip. |
| ↳ **Ledger** | Moon | Tessel | 33,200 km, circular | 13.1 d | Otter banking raft | Vaults, counting houses, and the calm of people who have read the whole contract. Most trade ventures in the inner system were financed here, which is why Ledger is quietly certain of its own importance. It calls Bramble the dirt. The Bramble–Ledger hop is the second lesson. |
| **The Arc** | Station | The Lamp | 2.2 au, circular | 3.3 y | Cat salvagers | The last unbroken segment of a shattered Chorus ring, turning slowly with its own wreckage strung out behind it along the same orbit. Cats work it in the weightlessness they were born for, cutting out pieces of something nobody can read. The best salvage in the system, the source of relic upgrades, and a place nobody is comfortable. It has just enough mass for a whisper of a reach. |
| **Claw Rock** | Zone | The Lamp | 2.9 au, e = 0.01 | 4.9 y | Cat homeland | A rock with a tavern in it, in the middle of the belt everyone has to cross. The cats keep the Scatter by oath rather than by force, and Claw Rock is where the oaths get argued over. No gravity worth the name — you match speeds with it and knock. The tavern is genuinely very good. |
| **Grumm** | Planet | The Lamp | 5.0 au, circular | 11.2 y | Frog balloon villages | A grumpy violet gas giant with the deepest gravity well in the system and the premier slingshot: a Hohmann arrival turns 147° at one and a half radii. Frogs live in balloon villages in its cold upper clouds, and a heat shield turns those clouds into free braking. The gateway to Chime and beyond — and the one world with no harbour of its own. |
| ↳ **Mossback** | Moon | Grumm | 102,000 km, circular | 3.2 d | None (it is alive) | A moon-sized creature asleep in a close orbit around Grumm, its shell grown over with moss forests. It has not moved in anyone's memory. Pilgrims come to put their hands on the moss and listen to the heartbeat, and go home changed in ways they cannot explain. |
| ↳ **Lillimoor** | Moon | Grumm | 281,000 km, circular | 14.5 d | Frog homeworld | Ammonia seas under a violet sky, with lily-pad villages spread across them and frogs who will still be having this conversation when you get back. No property and no hurry: they give freely, do not haggle, and remember who gives back across generations. They pay handsomely for inner-world luxuries, in their own way. |
| ↳ **Widdershins** | Moon | Grumm | 536,000 km, **retrograde** | 38 d | Cat exiles | A captured moon going the wrong way round Grumm, with cat exiles on it who chose the expense of the approach as a kind of door. Matching it from a prograde Grumm orbit costs twice its orbital speed, which keeps visitors away — exactly the point. Its goods are rare because getting here costs what it costs. |
| **Chime** | Planet | The Lamp | 9.0 au, circular | 27 y | Chorus ruins | A cold world where glass falls from the sky as snow and the whole planet rings, faintly, all the time. The Chorus did something here and did not write down what. The frogs sing about it; almost nobody has been, and the ones who have do not describe it well. |
| ↳ **Hush** | Moon | Chime | 76,600 km, circular | 5.2 d | Chorus ruins | A dark moon over a ringing world, where the ringing stops completely. The Chorus built a dampener here, and an empty observatory under it, and pointed the observatory at the Far Lantern. The silence inside is not the absence of sound but the presence of something taking it away. |
| **Merrow's Comet** | Zone | The Lamp | 0.4–14 au, e = 0.944 | 19.3 y | All four species | A comet with a bazaar on it — the only place all four peoples live in the same rooms. It falls through the inner system once in nineteen years and spends the rest of its time out in the dark keeping its own hours. Negligible gravity, so you rendezvous rather than orbit. Catching it is a thing people become known for, and the signature skill check of the game. |
| **The Far Lantern** | Zone | The Lamp | 18 au, circular | 76 y | ??? | Something at the edge of the system that blinks at intervals nobody has found a pattern in. The Chorus pointed Hush's observatory at it. That is everything anyone knows, and it is the long-term goal. |

---

## The numbers

Lengths in kilometres. **Reach** is the sphere of influence, computed from mass
alone as `r = a · (μ/μ_parent)^(2/5)` — no table stores it. **Harbour** is the
docking altitude; **mouth** is the radius of the docking zone around it. The
sky is built at KSP scale: every body is a tenth the size a real one would be
and many times denser.

| Body | Diameter | Reach | Harbour | Mouth | Air to | Note |
|---|---|---|---|---|---|---|
| The Lamp | 1,495,979 | — | — | — | — | Radius is the crash radius; its reach is everything |
| Cinder | 898 | 112,725 | 10,215 | 20,429 | — | Fuel is cheapest here, at the refineries |
| Wanderwell | 898 | 883,819 | 12,768 | 25,537 | — | Reach swells and shrinks with the orbit |
| Tagalong | 598 | 5,480 | 1,532 | 1,788 | — | Never near the edge of Wanderwell's reach |
| Tessel | 1,011 | 118,240 | 3,064 | 5,107 | 577 | Game opens at 75 km; harbour is at 2,521 km |
| Pip | 299 | 2,325 | 434 | 741 | — | The smallest reach in the system — easy to fly past |
| Bramble | 598 | 4,355 | 766 | 1,379 | — | |
| Ledger | 598 | 7,828 | 1,021 | 2,298 | — | |
| The Arc | 299 | 11,926 | 1,021 | 2,554 | — | 220 pieces of debris trail it along its orbit |
| Claw Rock | 299 | — (massless) | — | 299,196 | — | Rendezvous zone, not an orbit |
| Grumm | 14,960 | 7,444,018 | — | — | 8,976 | No port: the frogs' villages are not a harbour |
| Mossback | 329 | 2,092 | 409 | 664 | — | |
| Lillimoor | 1,197 | 7,056 | 1,277 | 2,043 | — | Capture from a Hohmann arrival ≈ 4.7 km/s |
| Widdershins | 898 | 10,043 | 2,554 | 3,064 | — | Retrograde |
| Chime | 1,197 | 6,437,654 | 15,322 | 30,644 | — | |
| Hush | 598 | 2,776 | 664 | 894 | — | |
| Merrow's Comet | 299 | — (massless) | — | 448,794 | — | Rendezvous zone |
| The Far Lantern | 299 | — (massless) | — | 1,495,979 | — | Rendezvous zone |

---

## Places that are not bodies

| Place | Where | What it is |
|---|---|---|
| **The Scatter** | 2.6–3.2 au | The asteroid belt every outward route must cross, and therefore the chokepoint the cats collect tolls in. Decorative: 1,400 procedurally seeded rocks on their own circular rails, thickest through the middle of the annulus. Claw Rock is its only dockable address. |
| **The Arc's debris** | Along the Arc's 2.2 au orbit | 220 seeded fragments spread about 0.9 radians behind the intact segment. Scenery, plus the marked salvage sites long-range sensors are for. |
| **Chorus ruins** | The Arc, Chime, Hush, the Far Lantern | Not a body but the thread through four of them: everything the extinct Chorus built is *tuned*, has no doors, stairs or seats, and is the source of relic upgrades. |

---

## Notes

- **Species.** Each people lives where its biology puts it on the temperature
  gradient: Emberkin inside Tessel's orbit (Cinder, Wanderwell), otters across
  the temperate middle (Tessel and its moons, Tagalong), frogs in the deep cold
  (Grumm, Lillimoor, Mossback), cats wherever there is microgravity (the Arc,
  the Scatter, Widdershins). Only Merrow's Comet mixes all four.
- **Radii are placeholder for most worlds.** Tessel (506 km) and Grumm
  (7,480 km) are tuned; everything else uses a round 1–4 × 10⁻⁶ au. Masses are
  tuned independently, so surface gravity derived from the pair is off-scale for
  several bodies (Chime and Wanderwell both read hundreds of m/s²). Harmless
  today — nothing lands, and nothing in the sim reads surface gravity — but
  worth fixing before any body's surface becomes visible or its low orbits get
  quoted.
- **Docking altitudes scale together.** Every in-system length took the same
  factor as the mass rescale, so every reach-relative proportion is where it
  was before.
