# Orbital Trader (Working Title): Design Document

**Status:** Early draft, revised. Sections 2.2, 2.3, 2.6 and 2.6.1 record decisions made after the first playable build. Sections marked **TBD** are intentionally undecided and collect open questions rather than decisions.

---

## 1. Overview

### 1.1 Pitch

A cozy, single-player 2D orbital trading game. You pilot a small merchant ship around a warm orange star called the Lamp, carrying goods and passengers between the worlds of four very different peoples. You don't steer like a car. You control your velocity, plan burns, and watch your trajectory bend around planets and moons. Beginners take the slow road on simple transfer orbits. Experts borrow speed from gas giants and arrive faster and cheaper than anyone thought possible.

### 1.2 Design Pillars

**The physics is the game.** Every system (trade, upgrades, events, story) should feed back into orbital decisions. If a feature could exist unchanged in a game without orbits, it should be reconsidered.

**The math matters to the fiction.** Orbital concepts get in-world meaning. A Hohmann transfer is "the slow road." A transfer window is a festival. A gravity assist is borrowing speed from a grumpy planet. The world explains the math, and the math shapes the world.

**Forgiving, but not stakes-free.** Perfect burns are never required. Mistakes cost time and fuel, not the save file. When losses happen, they are recoverable and should generate story.

**People are the reason to travel.** Profit gets you moving, but the species, their cultures, and their mysteries are what pull you somewhere new.

### 1.3 Target Players

The game is single-player and non-combat. It serves three motivations, loosely following Bartle's player types. **Narrative players** are driven by events, characters, and the long-term mystery. **Experimenters** are driven by the physics: finding cheaper routes, chaining gravity assists, intercepting the comet. **Achievers** are driven by ship upgrades, wealth, and unlocking new regions. Competitive, "killer"-type drives are not a target, though some can be channeled through non-combat rivalry (see Section 6.4).

---

## 2. Core Mechanics

### 2.1 Flight Model

The game is top-down 2D with the Lamp fixed at the origin. All planets and moons move **on rails**: their positions are predetermined Keplerian orbits calculated as a function of time, so there is no n-body simulation.

The ship uses **patched conics**. At any moment it feels the gravity of exactly one body: the smallest sphere of influence (SOI) that contains it. When the ship crosses an SOI boundary, its position and velocity are converted into the new body's reference frame (by adding or subtracting that body's velocity), and the new body becomes its sole gravitational influence.

Each body has a **fixed, hand-tuned SOI radius** rather than one calculated from mass and distance. This keeps the math simple, lets designers tune approaches for fun, and avoids edge cases such as a moon drifting outside an eccentric planet's shrinking SOI (relevant for Tagalong around Wanderwell).

Because the ship follows a single conic inside each SOI, trajectories can be solved analytically. That makes path prediction exact and cheap, and it keeps time warp stable at any speed. Retrograde orbits (Widdershins) require no special handling.

### 2.2 Maneuver Planning

**A child should be able to plan a burn.** That is the bar, and it sets the whole shape of the control:

**Tap your road.** One gesture on the drawn path is the only way in. It offers two things at that moment — write a burn down here, or run the clock to here — and says how far off the moment is either way.

**Two axes, four buttons.** A burn is set with **Forward**, **Back**, **Out** and **In**: prograde and retrograde along the way you are already going, radial out and in across it. Each is one large button with an arrow and a word. There is no typing, no unit to choose, no handle to drag to the right number, and no third axis to discover.

**One press is one step, sized to the orbit.** A press is a fixed fraction (0.5%) of how fast the ship is actually going at the mark, rounded to a number a person would say out loud. The same press is a small change whether you are creeping round a moon at 200 m/s or falling past the Lamp at 30 km/s. Holding a button repeats, and then hurries.

The four directions are drawn around the mark on the chart as well, growing with the burn written down along them, so the pad and the chart say the same thing. They are a legend, not a control: the chart is never something you have to drag accurately.

Planning is free. Nothing is spent until the clock reaches the mark, and a mark can be moved, re-pressed, zeroed or scrapped.

Burns are **instantaneous impulses**. What you plan is exactly what you get, which removes execution error and keeps the challenge in route design rather than timing reflexes.

### 2.3 Arrival, and Why There Is No Landing

**Nothing lands.** Every harbour in the system is an orbit, and docking means matching one: you arrive by getting close enough and slow enough inside a port's **harbour mouth**, and the port's own lighters carry goods the rest of the way down. A world's surface is scenery and a crash hazard, never a destination.

This is a scope decision as much as a fictional one. Landing would need a second control scheme, a second set of physics, and a second art problem, and it would buy nothing the orbital game does not already have. The fiction absorbs it easily: Tessel is an ocean of floating harbour cities that meet ships in orbit, the cats cannot survive a heavy world at all, and the frogs' balloon villages have no ground under them either.

The player therefore **starts in orbit**, not moored. A new game opens with the ship already going round Tessel — *low* round it, high point under one planet-diameter of altitude, so the ocean fills the chart and visibly turns underneath — with a road drawn ahead of it and a crate in the hold. There is nothing to cast off from and nothing to press before the chart means something. The harbour itself is higher up, at the docking altitude every other orbit in the game is measured from; tying up and casting off again is what puts a ship there.

### 2.3.1 Forgiveness Systems

Arrival uses a generous **docking zone** around each port. Entering it below a relative-speed threshold counts as arrival. If the player comes in too fast, they can simply plan a correction burn and try again. Mid-course corrections are cheap and encouraged. Planning previews show everything the player needs, so failure comes from choices, not surprises.

Running out of fuel is not a game over. A stranded ship can call for a tow at a cost in money and time, and a stranding is a natural hook for an event.

### 2.4 Skill Curve

The skill curve is built into the physics rather than layered on top.

| Stage | Technique | In-world name | Payoff |
|---|---|---|---|
| Opening | Tessel's low opening orbit out to Pip, its nearest moon | The first delivery | One tap, one push, one crossing: the whole game in five minutes |
| Beginner | Moon-to-moon hops around Tessel | "Hopping the rafts" | Learning SOI transitions in a safe space |
| Beginner | Hohmann transfers | "The slow road" | Cheap, reliable, slow |
| Intermediate | Faster direct transfers | "Running hot" | Speed at a fuel cost |
| Intermediate | Rendezvous and intercepts | "Matching" | Access to moving targets (other ships, Wanderwell) |
| Advanced | Gravity assists at Grumm | "Borrowing from Grumm" | Fast *and* cheap routes to the outer system |
| Advanced | Aerobraking (requires heat shield) | "Skimming" | Free braking at atmospheric worlds |
| Expert | Comet intercepts, Chorus routes | "Catching Merrow" | Rare goods, secrets, bragging rights |

### 2.5 Fuel and Delta-V

Fuel is the only resource for movement and is displayed to the player as a delta-v budget. Refueling costs money, and fuel prices vary by port (cheap near Cinder's refineries, expensive in the outer system).

**Tank capacity is a soft gate.** A starter tank makes distant destinations difficult, not impossible. Achievers can buy their way past the gate with bigger tanks. Experimenters can bypass it with efficient routing, which rewards skill with early access.

### 2.6 Time

The game clock runs continuously, and every body moves along its orbit as time passes. Time is the second currency alongside fuel. Time pressure comes from perishable cargo, passenger deadlines, and scheduled orbital events such as Wanderwell's periapsis market and Merrow's Comet's passes.

**The sky is built at KSP's scale.** Every body is a tenth of the size a real one would be and many times denser, which is the trick that makes a world a place rather than a backdrop: Tessel is 498 km across, has 9.25 m/s² at the ground, air to 70 km, and a reach of 116,500 km — a Kerbin. A new game opens at 75 km, five above the air, on an orbit that takes thirty minutes of game time. Local flying is correspondingly cheap: the first lesson is a quarter of a km/s. Interplanetary flying is *not*, because a small world gives almost no gravity assist on departure or arrival, and that trade is deliberate.

**The clock is slow on purpose.** At ×1, one lap of that opening orbit takes **ten real minutes**. That is the fastest thing in the sky and everything else is slower still, so at ×1 almost nothing else appears to move. That is the intended reading: an orbit is a place you are, not an animation you watch. Watching the sky turn is what skipping is for.

**There is no ladder of warp speeds.** A strip of ×1 / ×10 / ×100 buttons asks the player to answer a question they do not have — *how fast should time go?* — when the question they actually have is *when do I want to be there?* So time is skipped by pointing at a place:

- Tap anywhere on your drawn road and choose **Skip to here**, or press **Skip to it** on a burn, a crossing, or a near pass.
- A confirmation says how far off that moment is in game time and how long the wait will be in real seconds.
- On yes, the clock runs at exactly the rate that covers the stretch in **about ten seconds**, and stops itself on arrival.

Anything worth being awake for cancels the skip and drops the clock back to ×1: a burn firing, a change of sphere of influence, a harbour mouth, a toll, a dry tank. The only control the clock has besides skipping is a **hold**.

A cap on the rate means the longest hauls take proportionally more than ten seconds; the confirmation says so rather than promising ten.

### 2.6.1 The Chart

Two rules keep the chart readable, and both of them are about refusing to show things.

**The view is locked to the world you are going round.** The chart is always centred on the smallest sphere of influence containing the ship, and it changes when that changes — crossing into a moon's reach swings the chart to that moon and re-frames it. The zoom follows the drawn road: it re-frames when the road grows past the edge of the screen or shrinks to a knot in the middle, and leaves the player's own zooming alone in between.

**Panning rides the lock instead of replacing it.** The chart can be dragged — one finger, two fingers, or the arrow keys when no burn is selected — but what is stored is not a position in the sky. It is an offset from the thing last focused, and the thing last focused is looked up again every frame, so a pan keeps its meaning as the world it is measured from moves: look a little ahead of your ship and it stays a little ahead of your ship; drag over a moon and the view travels with the moon. The original objection stands and is answered rather than ignored — a view that can be lost is a view somebody has to get back — so focusing anything at all (tapping a body, pressing `f`, the ◎ button) sets the offset back to nothing, and ◎ lights while the view is off its lock.

**The road shows the orbit you are on and the one thing that happens next.** Never more. It is always exactly one of three pictures:

| | What is drawn |
|---|---|
| **Stable** | One lap of the ellipse, with periapsis and apoapsis marked and labelled with their heights. |
| **Exit** | The arc out to the edge of this world's reach, the crossing marked, and then one lap of the orbit it leaves you on around the parent, in a second colour. No intercepts are computed in that new orbit. |
| **Enter** | The arc in to a moon's reach, the crossing marked, and then the path around the moon with its periapsis. Nothing past that first crossing is chased. |

The road has three voices and they always mean the same thing: the orbit you are on now, the orbit your burns put you on, and the orbit waiting on the far side of the crossing.

A road that predicts nine encounters is a road nobody can read, and every prediction past the first is a guess that a single burn will erase anyway. One crossing at a time is enough.

### 2.7 Trading

Trade is built around one central tension: **time versus fuel.**

| Cargo type | Examples | Behavior |
|---|---|---|
| Bulk | Ore, grain, ice | Cheap, durable, low margin. The slow road is fine. |
| Perishables | Fresh produce, Emberkin fashions | Value decays in transit. Rewards fast routes. |
| Passengers | Travelers of all four species | Pay for speed or comfort, often with special requests. |
| Climate-sensitive | Frog goods, frog passengers | Require refrigeration (a gate-key upgrade). |
| Luxuries | Inner-world crafts, frog songs | High value, driven by species demand. |
| Relics | Chorus artifacts | Rare, often tied to story and upgrades. |

Markets respond to the sky. **Alignment-driven prices:** when two worlds swing close, trade between them floods and prices drop, while worlds far from their partners grow hungry for goods. **Market saturation:** selling the same good repeatedly in one market lowers its price, which discourages grinding a single loop. **Species demand:** each people wants what only others produce, so trade becomes a way of connecting cultures.

Money is treated as a **key** (to upgrades, access, and relationships) rather than a scoreboard.

### 2.8 Upgrades

Upgrades fall into two categories.

**Soft gates** raise the ceiling of what's comfortably reachable. These include larger fuel tanks, more efficient engines, and larger cargo holds. Skilled play can bypass them.

**Gate keys** unlock new techniques, cargo, or places. Each one gives experimenters a new toy rather than removing challenge.

| Upgrade | Unlocks | Likely source |
|---|---|---|
| Heat shield | Aerobraking at Grumm | Emberkin engine smiths, Cinder |
| Refrigeration | Frog passengers, cold-chain cargo | Otter shipwrights, Pip |
| Stealth system | Slipping past cat tolls in the Scatter | Chorus relic, Hush's dampener |
| Long-range sensors | Comet tracking, Arc salvage sites | Cat salvagers, the Arc |

The guiding principle is that upgrades should **expand options, not erase challenge.**

---

## 3. Motivation Design

### 3.1 Psychological Framework

The design leans on Self-Determination Theory, which holds that people stay engaged when an activity feeds three needs.

**Competence** comes from the core mechanic. Nailing a difficult intercept is intrinsically rewarding, and the feedback should make that skill visible, for example by showing fuel saved compared with the direct route.

**Autonomy** comes from route choice. There is rarely one correct path, only trade-offs between time, fuel, risk, and who you meet along the way.

**Relatedness** comes from the four peoples. Players travel to see who's there, and species remember how you've treated them.

**Curiosity** drives exploration. Near worlds hint at far ones (frog songs about Chime, corvid-era rumors about the Far Lantern), creating information gaps players want to close.

### 3.2 Guardrails

**Avoid the overjustification trap.** Strong external rewards can smother intrinsic fun. If profit becomes the goal, players will grind the optimal loop even while bored. Market saturation, shifting alignments, and money-as-key all counter this.

**Losses sting roughly twice as hard as equal gains.** Use them sparingly, and make them recoverable and story-generating.

### 3.3 Goal Layers

One goal should always be in sight at each timescale.

| Layer | Examples |
|---|---|
| Opening | One crate, already in the hold, for Pip |
| Short-term | This delivery, this passenger, this transfer window |
| Medium-term | A new upgrade, a relationship with a people, reaching a new region |
| Long-term | The Chorus mystery and the Far Lantern |

---

## 4. Setting

> **Status.** This section is the current setting. Sections 1–3 and 5–6 still
> name bodies from the earlier map (Pip, Bramble, Ledger, Grumm, Wanderwell,
> Chime, Hush, Merrow's Comet, the Scatter, the Far Lantern, the Chorus) and
> have not been brought across yet, and neither has the game itself. Nothing
> below is implemented.

### 4.1 Tone

Warm, whimsical, and curious, with a quiet undercurrent of mystery. The system is lived-in and a little silly on the surface, with an ancient, unanswered question at its edge.

Whimsy comes through the fiction rather than through cartoonishness. Orbital concepts get plain in-world names, planets have personalities, and each culture grows out of the physical facts of its home.

### 4.2 The Peoples

Four living species, one extinct. Each has one thing it is better at than anybody else, and that strength is what a player goes to them for.

**🦦 Otters — Tassel**

- Playful, friendly, chatty, persistent
- Social, relationship-oriented merchants
- Reputation and connections over wealth
- Curious, nosy, terrible secret-keepers
- **Strength: Connections**

**🦎 Emberkin — Inner Worlds**

- Reptilian, proud, competitive, materialistic
- Highly factional: houses, guilds, corporations, military orders
- Status-conscious and contract-oriented
- Industrial, wealthy, politically divided
- **Strength: Wealth**

**🐈 Cats — Asteroid Belt**

- Solitary, clever, pragmatic, suspicious
- Salvagers, mechanics, scavengers
- Personal freedom over institutions
- Extensive Arc salvage culture
- **Strength: Stuff**

**🐸 Frogs — Gas Giant & Moons**

- Peaceful, spiritual, patient, long-lived
- Philosophical, historical, community-oriented
- Floating cities and ancient traditions
- Slow-moving but deeply knowledgeable
- **Strength: Knowledge**

**The Builders — Extinct**

- Unknown species, unknown name
- Creators of the Arc and the outer-system station
- Incomprehensible technology
- Mysterious disappearance
- **Strength: Technology**

### 4.3 Major Bodies

| Body | Type | Character |
|---|---|---|
| **The Lamp** | Star | Warm, orange, dangerous |
| **Cinder** | Emberkin planet | Industrial, volcanic, crowded |
| **Scorch** | Cinder moon | Barren, mining, frontier |
| **Veyra** | Emberkin planet | Wealthy, luxurious, factional |
| **Tassel** | Ocean planet | Friendly, bustling, aquatic |
| **Slate** | Tassel moon | Rocky, industrial, tutorial |
| **Moss** | Tassel moon | Green, lush, agricultural |
| **The Belt** | Asteroid belt | Chaotic, improvised, lawless |
| **Nail** | Cat settlement | Friendly, scrappy, communal |
| **Whisker** | Cat settlement | Shady, illicit, dangerous |
| **The Arc** | Ancient station | Enormous, abandoned, mysterious |
| **The Giant** | Gas giant | Vast, stormy, inhabited |
| **Brine** | Frog moon | Ammonia seas, chemical-rich |
| **Glass** | Frog moon | Icy, scientific, subterranean |
| **Croak** | Frog moon | Retrograde, isolated, spiritual |
| **Haven** | Frog moon | Beautiful, peaceful, populous |
| **The Maw** | Ancient station | Remote, impossible, endgame |

### 4.4 The Worlds

#### Tassel

**Slate — Tutorial Moon.** Rocky, barren, industrial.

- Otter mining colonies
- Shipyards
- Basic trading
- First navigation lessons
- Easy orbital transfers
- Tutorial starting area

**Moss.** Green, lush, oceanic.

- Agriculture
- Medicine
- Exotic plants
- Otter settlements
- Social quests
- Crew introductions

#### Emberkin

**Cinder.** Industrial, volcanic, crowded.

- Metals
- Fuel
- Machinery
- Factories
- Factional politics
- Industrial contracts

**Scorch.** Barren, mineral-rich, frontier.

- Mining
- Cheap materials
- Dangerous jobs
- Stranded ships
- Rougher Emberkin

**Veyra.** Wealthy, luxurious, competitive.

- Luxury goods
- High-value trading
- Corporate factions
- Auctions
- Status-driven customers

#### Asteroid Belt

**Nail.** Friendly, scrappy.

- Repairs
- Salvage
- Cheap parts
- Cat mechanics
- Informal trade

**Whisker.** Shady, lawless.

- Smuggling
- Black market
- Stolen goods
- Illegal Arc technology
- Mercenaries

**The Arc.** Ancient, enormous, incomprehensible.

- Salvage
- Ancient technology
- Exploration
- Major mystery
- Gradually unlocked areas

#### Frog System

**The Giant.** Vast, stormy, atmospheric.

- Floating cities
- Frog civilization
- Medicine
- Spiritual centers

**Brine.** Ammonia seas, alien, chemical-rich.

- Pharmaceuticals
- Chemicals
- Floating settlements
- Strange biology

**Glass.** Icy, beautiful, subterranean.

- Research
- Subsurface ocean
- Ancient history
- Builder studies

**Croak.** Retrograde, isolated, austere.

- Difficult orbital transfer
- Frog ascetics
- Spiritual quests
- Lore-heavy
- Minimal commerce

**Haven.** Peaceful, beautiful, populous.

- Frog capital
- Pilgrimages
- Festivals
- Philosophy
- Major trade hub

#### The Outer Mystery

**The Maw.** Remote, ancient, impossible.

- Miniature black hole
- Builder station
- Unexplained orbit
- Late-game destination
- Final mystery

---

## 5. Technical Notes

Fixed SOI radii should be tuned so that no moon ever leaves its parent's SOI, and so that gravity-assist approaches at Grumm feel generous. The Arc and the Scatter need a decision on representation: the Scatter is likely decorative, with Claw Rock and a handful of named rocks as dockable bodies, while the Arc segment needs its own small SOI. Merrow's Comet has negligible gravity, so it may use a rendezvous zone instead of a true SOI.

---

## 6. Undecided Systems (TBD)

### 6.1 Player Character — TBD

A leading proposal is that the player is an otter who left their raft. That would explain flying solo, make the player a slight outsider in their own culture, and give each crew member the role of a surrogate raft. The alternative is leaving the player's species open or customizable.

### 6.2 Crew — TBD

Crew reacting to the player's burns is a desired feature, working as characterization, soft tutorial, and feedback on skill. Early flavor notes per species: Emberkin crew cheer big burns and complain through long coasts. Otter crew are chatty, point out sights, and grow anxious when the radio goes quiet. Cat crew love tight slingshots, mock safe routes, and are secretly terrified of landing. Frog crew hum during coasts, dislike high-g burns, and never complain about the slow road.

Open questions include how crew are recruited, how many the ship can carry, whether crew have mechanical effects or are purely narrative, and how crew relate to the player's standing with each species.

### 6.3 Events — TBD

Coasting stretches are natural pacing gaps and the likely home for events. The guiding principle is that events should ask for **orbital decisions** where possible, not just text choices.

Candidates from brainstorming include distress beacons (requiring a rendezvous), rival traders racing to the same market, stowaways in the hold, solar flares threatening sensitive cargo, hitchhikers on passing asteroids, cat toll intercepts in the Scatter (escapable through maneuvering), and letters or radio chatter that advance character stories mid-flight.

Open questions include event frequency, trigger conditions (location, cargo, reputation, time), and how events tie into species relationships.

### 6.4 Competition and Rivalry — TBD

Options for channeling competitive drives without combat include a named rival trader who taunts the player over the radio and races them to markets, economic plays like cornering a market before a festival, and asynchronous route leaderboards or ghost trajectories. None are committed.

### 6.5 Ending and Long-Term Goal — TBD

The Chorus mystery and the Far Lantern are the long-term hook, with breadcrumbs at the Arc, Chime, and Hush. Undecided: what the Far Lantern actually is, what the Chorus were and why they vanished, whether reaching the Lantern ends the game or opens a post-game, and how the frogs' songs and Chorus routes pay off.

### 6.6 Art Direction — TBD

A fully hand-drawn navigation chart was considered and ruled out as unrealistic in scope. Visual style, UI treatment, and how species are presented (portraits, animated sprites, text only) are undecided.

### 6.7 Open Technical Questions

**Decided since the first draft**, and recorded above rather than here: burns are instantaneous impulses (2.2); the control is four buttons on two axes, reached by tapping the road (2.2); there is no landing and the game starts in orbit (2.3); the clock runs at ten real minutes to a lap of the low orbit the game opens in, with no warp ladder and skipping by pointing at a place (2.6); the chart is locked to the body the ship orbits and draws only the immediate orbit plus the next crossing (2.6.1); the opening mission is a single delivery to Pip.

**Still open.** Distance compression beyond the inner system needs prototyping. Docking-zone size and speed thresholds need tuning for the right level of forgiveness. The representation of belts, debris fields, and the comet (Section 5) needs a final decision. Whether landing is ever added — and if so, whether it is a third control scheme or a cutscene over an orbital rendezvous — is deferred, not refused.
