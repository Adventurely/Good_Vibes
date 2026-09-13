# Orbital Trader (Working Title): Design Document

**Status:** Early draft, revised. Sections 2.2, 2.3, 2.6 and 2.6.1 record decisions made after the first playable build. Sections marked **TBD** are intentionally undecided and collect open questions rather than decisions.

---

## 1. Overview

### 1.1 Pitch

A cozy, single-player 2D orbital trading game. You pilot a small merchant ship around a warm orange star called the Lamp, carrying goods between the worlds of four very different peoples. You don't steer like a car. You control your velocity, plan burns, and watch your trajectory bend around planets and moons. Beginners take the slow road on simple transfer orbits. Experts borrow speed from gas giants and arrive faster and cheaper than anyone thought possible.

### 1.2 Design Pillars

**The physics is the game.** Every system (trade, upgrades, events, story) should feed back into orbital decisions. If a feature could exist unchanged in a game without orbits, it should be reconsidered.

**The math matters to the fiction.** Orbital concepts get in-world meaning. A Hohmann transfer is "the slow road." A transfer window is a festival. A gravity assist is borrowing speed from a grumpy planet. The world explains the math, and the math shapes the world.

**Forgiving, but not stakes-free.** Perfect burns are never required. Mistakes cost time and fuel, not the save file. When losses happen, they are recoverable and should generate story.

**People are the reason to travel.** Profit gets you moving, but the species, their cultures, and their mysteries are what pull you somewhere new.

### 1.3 Target Players

The game is single-player and non-combat. It serves three motivations, loosely following Bartle's player types. **Narrative players** are driven by events, characters, and the long-term mystery. **Experimenters** are driven by the physics: finding cheaper routes, chaining gravity assists, threading a salvage intercept. **Achievers** are driven by ship upgrades, wealth, and unlocking new regions. Competitive, "killer"-type drives are not a target, though some can be channeled through non-combat rivalry (see Section 7.4).

---

## 2. Core Mechanics

### 2.1 Flight Model

The game is top-down 2D with the Lamp fixed at the origin. All planets and moons move **on rails**: their positions are predetermined Keplerian orbits calculated as a function of time, so there is no n-body simulation.

The ship uses **patched conics**. At any moment it feels the gravity of exactly one body: the smallest sphere of influence (SOI) that contains it. When the ship crosses an SOI boundary, its position and velocity are converted into the new body's reference frame (by adding or subtracting that body's velocity), and the new body becomes its sole gravitational influence.

No body carries a hand-written SOI radius. A reach is `a · (mu/mu_parent)^(2/5)` — the standard patched-conic radius — computed from the body's own mass and orbit, so mass is the only knob and no table can quietly disagree with the physics. The invariant checker then proves what a hand-tuned table used to promise: that no moon ever leaves its parent's reach and that sibling moons keep their distance.

Because the ship follows a single conic inside each SOI, trajectories can be solved analytically. That makes path prediction exact and cheap, and it keeps time warp stable at any speed. Retrograde orbits (Croak) require no special handling.

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

This is a scope decision as much as a fictional one. Landing would need a second control scheme, a second set of physics, and a second art problem, and it would buy nothing the orbital game does not already have. The fiction absorbs it easily: Tassel is an ocean of floating harbour cities that meet ships in orbit, the cats cannot survive a heavy world at all, and the frogs' balloon villages have no ground under them either.

The player therefore **starts in orbit**, not moored. A new game opens with the ship already going round Tassel — *low* round it, high point under one planet-diameter of altitude, so the ocean fills the chart and visibly turns underneath — with a road drawn ahead of it and a crate in the hold. There is nothing to cast off from and nothing to press before the chart means something. The harbour itself is higher up, at the docking altitude every other orbit in the game is measured from; tying up and casting off again is what puts a ship there.

### 2.3.1 Forgiveness Systems

Arrival uses a generous **docking zone** around each port. Entering it below a relative-speed threshold counts as arrival. If the player comes in too fast, they can simply plan a correction burn and try again. Mid-course corrections are cheap and encouraged. Planning previews show everything the player needs, so failure comes from choices, not surprises.

Running out of fuel is not a game over. A stranded ship can call for a tow at a cost in money and time, and a stranding is a natural hook for an event.

### 2.4 Skill Curve

The skill curve is built into the physics rather than layered on top.

| Stage | Technique | In-world name | Payoff |
|---|---|---|---|
| Opening | Tassel's low opening orbit out to Slate, its nearest moon | The first errand | One tap, one push, one crossing: the whole game in five minutes |
| Beginner | Moon-to-moon hops around Tassel | "Hopping the moons" | Learning SOI transitions in a safe space |
| Beginner | Hohmann transfers | "The slow road" | Cheap, reliable, slow |
| Intermediate | Faster direct transfers | "Running hot" | Speed at a fuel cost |
| Intermediate | Rendezvous and intercepts | "Matching" | Access to moving targets (the belt havens, other ships) |
| Advanced | Gravity assists at Grumm | "Borrowing from Grumm" | Fast *and* cheap routes to the outer system |
| Advanced | Aerobraking (requires heat shield) | "Skimming" | Free braking at atmospheric worlds |
| Expert | The long haul to the Maw | "The deep dark" | Rare goods, secrets, bragging rights |

### 2.5 Fuel and Delta-V

Fuel is the only resource for movement and is displayed to the player as a delta-v budget. Refueling costs money, and fuel prices vary by port (cheap near Cinder's refineries, expensive in the outer system).

**Tank capacity is a soft gate.** A starter tank makes distant destinations difficult, not impossible. Achievers can buy their way past the gate with bigger tanks. Experimenters can bypass it with efficient routing, which rewards skill with early access.

### 2.6 Time

The game clock runs continuously, and every body moves along its orbit as time passes. Time is the second currency alongside fuel. Time pressure comes from perishable cargo and from quests with a deadline on them. (A port can keep seasonal hours; nothing in the sky uses that yet.)

**The sky is built at KSP's scale.** Every body is a tenth of the size a real one would be and many times denser, which is the trick that makes a world a place rather than a backdrop: Tassel is 498 km across, has 9.25 m/s² at the ground, air to 70 km, and a reach of 116,500 km — a Kerbin. A new game opens at 75 km, five above the air, on an orbit that takes thirty minutes of game time. Local flying is correspondingly cheap: the first lesson is a quarter of a km/s. Interplanetary flying is *not*, because a small world gives almost no gravity assist on departure or arrival, and that trade is deliberate.

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
| Bulk | Iron ore, refined steel, cryo fuel | Cheap, durable, low margin. Three units of hold a crate, so a hold runs out long before a shelf does. |
| Craft | Engine parts, tide glass, prayer lanterns | The working middle of the price list. |
| Fresh | Riverfish, medicinal herbs and gel | Organic, and priced as fashion is: they move with a market's mood. They no longer rot — see below. |
| Climate-sensitive | Riverfish, fire crystals, ancient cider, ice lenses, medicinal gel, smuggled medicine | Require temperature control (a gate-key upgrade), and **pay ×1.5** for it. Not all of them are cold: fire crystals are a thing you keep *steady*. |
| Luxuries | Ember silk, frog tea, frogwood instruments | High value, and the things a people loves. |
| Contraband | Stolen arms, forged medals, cybernetics | Whisker's whole shelf. |
| Relics | Arc fragments, reactor coils, storm crystals | Rare, often tied to story and upgrades. |

**One table drives both ends of every trade.** Each good names where it is made,
who buys it, and who *loves* it — and "who" is named the way a trader would name
them, sometimes a port (Veyra) and sometimes a whole people (Otters). A stall
sells what its port produces and buys what the goods table says it wants; no
port carries a hand-written price list. Loving a thing is wanting it: a people
who love a good are on its buyer list whether or not the table says so twice.

**What a port pays is a table with four corners.** Two questions — does this
port want it, and is it out of the good's own region — and the answer is the
multiple of base price they pay:

| | same system | another region |
|---|---|---|
| **loves it** | ×2.5 | **×5.5** |
| **wants it** | ×1.5 | ×2.5 |
| neither | ×0.6 | ×0.6 |

Space is hard and there are few merchants who cross between peoples, so
**carrying a loved good to another people is the trade the game is about**, and
the same run inside one system is worth a fraction of it. A good nobody named
goes at a loss to whoever will take it, and a stall never buys back what it is
selling two feet away — a producer pays the ×0.6, capped at three quarters of
its own asking price, or the dock would be a money pump.

It used to be a region multiplier times a love multiplier, which could not hit
all four corners at once: making the in-system numbers right dragged the
cross-region ones down with them. A table has no such trouble, and it can be
told to a player in one sentence.

**Temperature control pays ×1.5 on top**, so a loved cold good carried across
regions runs about ×8 what it cost. That is the best cargo in the game and it
sits behind an Engineer and a 2,800-cowrie box (§2.8), which is the point.

**Shelves are what a merchant keeps, not what a factory makes.** Every good has
a stock range, a stall's shelf is rolled inside it and scaled by the port's
`marketSize` — Tassel is the capital and keeps twice the table, Croak is a
hamlet and keeps a third — and the shelf is rolled again when you come back
from somewhere else. Waiting at a dock does nothing; trading elsewhere is the
restock. **The shelf is the only limit on how much you can move at once**, and
it is limit enough: the price does not rise as you empty it.

**There is no supply and demand.** A stall's prices do not remember what you
sold it last month and do not move as its shelf empties. Both rules existed to
stop one loop being the whole game, and the stock limit does that better and
without asking a player to model a market they cannot see. What is left that
moves a price is species character, not economics: Emberkin markets wobble
±15% on a slow wave per good, otter ports roll ±7% per good per day, frogs and
cats do neither.

**Nothing spoils.** Goods used to lose value in transit, down to a tenth. It
made the six organic goods regional by force — Cinder is ninety-four days from
Tassel and nothing with a shelf life survives the crossing — and it did it
without warning anybody, because a freshness bar only appeared once the cargo
was already aboard. Time and hold room are still what limit a run. A crate is
no longer one of them.

**Jobs are priced against this table**, not against a number somebody liked:
fetching work pays more than selling the same goods on the open market at the
same destination would, and a test holds that line as prices move (§5.1.1).

Money is treated as a **key** (to upgrades, access, and relationships) rather than a scoreboard.

### 2.8 Upgrades

**Built, and this is the whole rack.** Two categories, as before.

**Soft gates** raise the ceiling of what is comfortably reachable: the fuel
tank and the cargo hold. Three buyable sizes each, over the stock fitting the
ship arrives with — four rungs in all, and the stock one is on no rack
anywhere, because you own it before you have been anywhere.

| | Stock | 1st | 2nd | 3rd |
|---|---|---|---|---|
| Tank | 14 km/s | Long-haul, 22 | Deep-sky, 30 | Deep-dark, 40 |
| Hold | 24 units | Raft, 40 | Barge, 64 | Barn, 90 |

They are **basics: fitted anywhere with a fuel pump**, which is every port but
the Arc and the Maw, where nobody sells anything at all. The first size up is
coin and nothing else. **The second and third want the Engineer aboard** — the
berth quest #6 fills — on the rule that a dock hand will bolt a bigger tank on
for anybody, and will not cut into a hull for a captain with nobody aboard who
could put it back together. That is the first thing crew have ever done
mechanically (§7.2).

The tank ladder is the map: 22 is what opens Cinder, whose arrival is most of
its bill; 40 is what makes the Maw a journey you come back from. The checker
asserts both, and that each rung is larger than the one below it.

**Gate keys** unlock techniques, cargo or places. Each names the bench it comes
off, because where you buy a thing is half of what it is.

| Upgrade | Bought at | Wants | Does |
|---|---|---|---|
| Temperature control | Cinder | Engineer | Carries the six goods that will not keep at hold temperature |
| Gravitational sensors | Nail | — | *Nothing yet.* Will show gravitational phenomena on the chart |
| Heat shielding | Cinder | Engineer | *Nothing yet.* Will allow risky aerobraking |
| Cryo hull cooling | Cinder | Engineer, heat shielding | *Nothing yet.* Will make that aerobraking safe |

**Three of the four are sold and wired to nothing.** That is deliberate and it
is said out loud: each row on the rack carries "not fitted to anything yet",
because selling a captain a box that does nothing without saying so is a
swindle, and because the alternative — holding the upgrade back until the
mechanic lands — means the mechanic arrives with no place to be bought.

Aerobraking is the one that used to work. A shielded ship could skim Grumm's
air and be captured by it, free. That is switched off: risky and safe skims are
two different manoeuvres, neither is built, and until they are, the clouds are
lethal to everybody. The arithmetic survives in `effectiveNodes`, which takes a
`skim` flag so a test can still reach it rather than leaving it to rot behind a
flag no caller can set.

**What went.** Engine tiers are gone — fuel cost the same everywhere the moment
they were removed, which is one fewer axis and one fewer thing to price. The
Whisker dampener is gone with them, so there is nothing to hide behind in the
Belt: the only let-off on a cat toll is the cooldown, and a captain is never
asked twice inside a month.

The guiding principle is that upgrades should **expand options, not erase challenge.**

---

## 3. Motivation Design

### 3.1 Psychological Framework

The design leans on Self-Determination Theory, which holds that people stay engaged when an activity feeds three needs.

**Competence** comes from the core mechanic. Nailing a difficult intercept is intrinsically rewarding, and the feedback should make that skill visible, for example by showing fuel saved compared with the direct route.

**Autonomy** comes from route choice. There is rarely one correct path, only trade-offs between time, fuel, risk, and who you meet along the way.

**Relatedness** comes from the four peoples. Players travel to see who's there, and species remember how you've treated them.

**Curiosity** drives exploration. Near worlds hint at far ones (the scholars on Glass, rumours about the Maw), creating information gaps players want to close.

### 3.2 Guardrails

**Avoid the overjustification trap.** Strong external rewards can smother intrinsic fun. If profit becomes the goal, players will grind the optimal loop even while bored. Market saturation was the first answer to that and has been withdrawn (§2.7): it asked a player to model something they could not see, and the stall's own stock does the same job in plain sight. Shifting alignments and money-as-key still counter it, and what actually stops one loop being the whole game is that the loop is small — a shelf holds what it holds.

**Losses sting roughly twice as hard as equal gains.** Use them sparingly, and make them recoverable and story-generating.

### 3.3 Goal Layers

One goal should always be in sight at each timescale.

| Layer | Examples |
|---|---|
| Opening | One pebble, bought on Slate, for your aunt |
| Short-term | This quest, this cargo, this transfer window |
| Medium-term | A new upgrade, a relationship with a people, reaching a new region |
| Long-term | The Builders' mystery and the Maw |

Section 5 is the first twenty quests, which is the opening and short-term
layers written out: the line walks outward one region at a time and hands over
a crew member at the end of each.

---

## 4. Setting

> **Status.** This section is the current setting, and the game now flies it.
> §4.5 records what happened to the map that was there before. What is *not*
> done is balance: the new ports carry no market rows yet, and the Δv ladder
> out to Grumm and the Maw has not been re-tuned around the new spacing.

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
| **Grumm** | Gas giant | Vast, stormy, inhabited |
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

**Grumm.** Vast, stormy, atmospheric.

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

### 4.5 What Carried Across

The sky is sixteen bodies and one belt region. Four of the built worlds only
changed their names, one moved, ten were dropped, and six were built new.

| Built before | Now | Note |
|---|---|---|
| The Lamp | **The Lamp** | unchanged |
| Cinder | **Cinder** | unchanged; the Emberkin homeworld |
| Tessel | **Tassel** | spelling only |
| Pip | **Slate** | still the tutorial moon |
| Bramble | **Moss** | |
| Grumm | **Grumm** | keeps its name, and is now a port: the balloon docks |
| The Arc | **The Arc** | keeps its name; moved out from 2.2 au to 2.7, beyond the Belt |
| The Far Lantern | **The Maw** | the same place in the sky, a different thing to find |

**Built new.** Scorch (Cinder's mining moon), Veyra (the wealthy Emberkin world
at 0.6 au), Nail and Whisker (the two cat havens, at 2.15 and 2.38 au inside
the Belt), and Brine, Glass, Croak and Haven (the four frog moons of Grumm).
Croak runs retrograde, which is Widdershins' one idea kept.

**Dropped.** Wanderwell, Tagalong, Ledger, Claw Rock, Mossback, Lillimoor,
Widdershins, Chime, Hush and Merrow's Comet, with everything written for them:
the periapsis festival, the comet bazaar, the banking raft, and the old endgame
at Chime and Hush. The Maw does the endgame's job now. The Scatter, which was a
belt region rather than a body, is the Belt, and it moved inward from 2.6–3.2
au to 2.0–2.5 so the Arc could ride just outside it.

**What moved with them.** The dampener used to be lying about at Hush, was
fitted for money and no questions on Whisker, and is now off the rack
altogether (§2.8). The tow debt used to be
owed to Ledger and is now owed to the harbour bank on Tassel. Goods whose
producer was dropped were re-sourced rather than deleted, so the price list is
the length it always was.

**Saves.** A version 2 save names places that are not in the sky any more, and
a version 3 save's hold is full of goods that were replaced wholesale, so the
save format is at version 4 and anything older is refused at the door.

---

## 5. The Quest Line

The first twenty quests, in the order a player meets them. The line walks
outward — Tassel's moons, then the Emberkin worlds, then the Belt, then the
frog system — so that every new place arrives with a reason to be there, and
each of the three crew members is the reward for the stretch that introduces
their people.

**Seventeen of the twenty are built** — every one that is not salvage. They
are written out in `narrative.json`, they work, and a player meets them: the
Requests tab on the dock menu lists whatever jobs the port you are tied up at
is offering, and you can hold three at once.

The three that are not built, and why:

| # | Quest | Why not |
|---|---|---|
| 14 | First Salvage | salvage, which is flight the game does not have |
| 15 | Lost Cargo | salvage |
| 20 | What Is This Worth? | needs a thing to find, not a person — the appraiser exists now |

Both quest chains run. Crew is settled far enough to pay out (§7.2): three of
the seventeen hand over a person, and finishing one fills that berth. Salvage
flight is what is left, and #20 needs an Arc fragment to exist as a good
before it can be asked for.

| # | Quest | Type | Route / Goal | Reward |
|---|---|---|---|---|
| 1 | First Shipment | Retrieval | Slate: retrieve shiny moon pebbles → Tassel | Tutorial; unlocks trading |
| 2 | A Taste of Home | Delivery | Tassel → Moss: deliver moonfish oil | Credits |
| 3 | Green Medicine | Retrieval | Moss: retrieve medicinal herbs → Tassel | Credits |
| 4 | A Message for Slate | Message | Tassel → Slate | Credits |
| 5 | The Heavy Stuff | Delivery | Slate → Cinder: deliver iron ore | Credits |
| 6 | Engine Trouble | Retrieval | Cinder: retrieve spare engine parts → Slate | **Emberkin Engineer** |
| 7 | A Favor for an Engineer | Message | Cinder → Scorch: deliver a message | Credits / faction reputation |
| 8 | Emberkin Luxury | Retrieval | Scorch: retrieve fire crystals → Veyra | Credits |
| 9 | The Collector | Shopping List | Veyra: acquire pearls, coral carvings, precision clock | Large payout |
| 10 | Faction Business | Message | Veyra → Cinder: deliver confidential message | Faction reputation |
| 11 | Into the Belt | Delivery | Cinder → Nail: deliver reactor coils | Credits |
| 12 | Something Shiny | Retrieval | Nail: retrieve salvaged sensors → Veyra | Credits |
| 13 | A Cat's Request | Quest Chain | Nail → several cat settlements | **Cat Navigator** |
| 14 | First Salvage | Salvage | With the cat navigator: recover a drifting wreck | Salvage + credits *(not built)* |
| 15 | Lost Cargo | Salvage | Belt: intercept a derelict cargo ship | Salvage *(not built)* |
| 16 | Medicine Run | Delivery | Nail → Brine: deliver medicinal supplies | Credits |
| 17 | The Amber Collector | Retrieval | Brine: retrieve brine amber → Veyra | Credits |
| 18 | A Frog's Question | Message | Brine → Glass: deliver a message | Credits / frog reputation |
| 19 | Appraisal | Shopping List | Brine: bring an arc shard, storm crystals and reactor coils to be looked at | **Frog Appraiser** |
| 20 | What Is This Worth? | Appraisal / Retrieval | With the frog appraiser: investigate an Arc fragment | Major lore reveal *(not built)* |

### 5.1 The Types

Seven kinds. **Five of them are built**; the two that need new flight are not.

A quest is written as data — its type, the ports it names, the goods it wants
— and the steps are generated from that. Authored wording wins where a quest
supplies it, so the opening errand still says "Bring it home to Tassel" rather
than anything a generator would produce. Adding a quest is a few lines in
`narrative.json` and no code.

| Type | Steps it earns | Built |
|---|---|---|
| Retrieval | one *acquire* per good, then *handover* at the destination | yes |
| Delivery | *handover* only — the goods come aboard when you accept | yes |
| Shopping List | one *acquire* per line on the list, then *handover* | yes |
| Quest Chain | one *visit* per stop, in order, then *handover* | yes |
| Message | *handover* with nothing in it: be there, that is all | yes |
| Salvage | — | no |
| Appraisal | mechanically a retrieval | via retrieval |

Three step primitives do all of it. **acquire** is satisfied by having the
goods aboard, however you came by them. **visit** is satisfied by being tied up
at a port. **handover** is satisfied by being tied up at the destination with
the goods, and it is the one step that takes something out of the hold.

Retrieval and shopping run on the same machinery. The difference — one good
from a named place against a list from anywhere — is in the telling, not the
rules, and saying so is cheaper than inventing a mechanical distinction.

**Salvage** is still the outlier: intercept something that is not a port, a
drifting wreck on its own rail, matched like a harbour with no harbour in it.
It needs new *flight*, not just new bookkeeping, and it is the first real use
of the Belt for something other than passing through.

### 5.1.1 Taking a Job On

**Three at once, and no more.** Finished jobs do not count against the three;
abandoning one gives the berth straight back.

**A delivery is loaded when you accept it**, at the sender's expense, so you
need the hold room before you can say yes — twelve units of ore is half a
starter hold, and that is the job. A consignment is in the hold but it is not
stock: it cannot be sold, the market's Aboard list does not show it, the cats
do not count it when they work out a toll, and giving the job up puts it over
the side. The toll rule matters — a crossing that took somebody's consignment
would kill a job with no way back.

A message weighs nothing, which is the whole joke.

**A job has to be worth doing.** A retrieval pays more than selling the same
goods on the open market at the same destination would — otherwise a player who
understood the market would never take one — and a test holds that line as
prices move.

Every quest names the port it is offered at, so a board has something to read.

**There is still no board.** Fourteen quests are written, tested and flyable,
and the opening errand is the only one a player can take, because there is
nowhere to press. That is the last piece.

### 5.2 What the Line Needs That the Game Does Not Have

1. ~~**Crew as a reward.**~~ Done, as far as the line needs. Three of the
   twenty hand over a person — Brikka the Emberkin engineer at #6, Celia the cat
   navigator at #13, Wicket the frog appraiser at #19 — one each from the three
   peoples whose region the player has just finished crossing. Finishing one
   of those quests fills that berth and the Crew menu shows who is in it. What
   a crew member *does* is still open (§7.2); the quests no longer wait on it.
2. **Faction reputation.** #7 and #10 pay in it. The game keeps reputation per
   *people*, not per house, and the Emberkin are explicitly factional — so
   either the Emberkin score splits into houses, or "faction reputation" means
   the Emberkin score and the houses stay fiction.
3. ~~A weightless parcel, for the four message quests.~~ Done: a message
   carries no goods, so it costs no hold room.
4. ~~A set-counting quest step, for #9 and #19.~~ Done: a shopping list earns
   one step per line and closes when they are all aboard at the destination.
5. **Things in space that are not ports**, for #14 and #15. Still open, and
   still the only part of the line that needs new flight.
6. ~~A quest board.~~ Done: the dock menu's Requests tab lists the jobs the
   port you are tied up at is offering, and a ship can hold three at once.
   The randomly generated contract board that used to sit behind a Passengers
   tab is gone, along with passengers themselves; quests are the whole of it.

### 5.3 Notes Against the Goods Table

Checked against the shipped price list. Three wanted a decision; all three are
settled, and the settlements are written into the quests.

- **#2, moonfish oil to Moss.** Moss is not a buyer of it. Settled as a
  delivery: the oil is handed to you on Tassel and to a named farm on Moss, so
  the market is never consulted and the pay is the quest's own.
- **#9, the collector's list.** Pearls and coral carvings are made on Tassel,
  so the list is a round trip home. Precision clocks are made on Veyra, where
  the collector is, so the third item is bought from under their nose. Kept as
  the joke, and House Ahl is written as finding it funny.
- **#16, "medicinal supplies" out of Nail.** Settled as Whisker's smuggled
  medicine, routed through Nail — the first quest that asks a player to do
  something the market would not. A delivery hands you the goods, so Nail
  never needed to stock them and Brine never needed to buy them. It is also
  the one quest that needs temperature control before anybody can hand it to
  you.

Everything else lines up with the table as shipped: iron ore to Cinder, engine
parts to Slate, fire crystals to Veyra (who love them), reactor coils to Nail
(who love them), salvaged sensors and brine amber to Veyra.

---

## 6. Technical Notes

**Decided since the first draft.** Reaches are computed from mass rather than written down (2.1), and the invariant checker proves the promises a hand-tuned table used to make. The Belt is decorative — a field of drawn rocks — and the two cat havens inside it are massless rendezvous zones with a harbour mouth rather than bodies with a well, as are the Arc and the Maw: a pilot arrives at those by matching speeds, not by falling in.

**Still to tune.** Gravity-assist approaches at Grumm, and the Δv ladder between the tanks now that the map has been respaced.

---

## 7. Undecided Systems (TBD)

### 7.1 Player Character — TBD

The shipped Crew menu names the captain **Finn**, an otter who left their raft. That explains flying solo, makes the player a slight outsider in their own culture, and gives each crew member the role of a surrogate raft. Leaving the species open or customizable is still the alternative, and the card is one line of `narrative.json` if it changes; the captain's own blurb is written without a pronoun so a change of species costs nothing.

### 7.2 Crew — TBD

**The three berths fill.** The Crew menu is reachable docked or in flight. It
shows Finn with a pixel-art portrait, then three berths — Engineer,
Navigator, Appraiser — and each is the reward for one of the three quests in
the line that pays in a person (§5). Until that quest is finished the berth
reads only **Missing Engineer** and shows an empty chair: who does that work
and where you would have to go to ask is something to find out, not something
the menu tells you before you have been anywhere. Finish the quest and the
berth fills with a name, a species, a portrait and a line:

| Berth | Who | People | From |
|---|---|---|---|
| Engineer | Brikka | Emberkin | #6 Engine Trouble |
| Navigator | Celia | Cats | #13 A Cat's Request |
| Appraiser | Wicket | Frogs | #19 Appraisal |

`state.crew` carries a slot per berth, null until earned and then `{ role,
from, joinedAt }` — who they are, which job brought them, and when.

**The Engineer now does something**, and is the only one who does. The second
and third size of tank and hold, and every gate key but the cat sensors, are
refused to a ship with an empty engineer's berth (§2.8). No bonus, no discount,
no change to flight — a gate, which is the cheapest kind of effect to add and
the easiest to take back. The navigator and the appraiser still do nothing, and
the shape of that first effect is the argument for what they might: something a
yard or a market checks, rather than a number quietly folded into a burn.

The captain is drawn as an otter. §7.1 still has that down as a proposal, but
the shipped fiction already leans that way — the game opens among otters, and
Uncle Theo and Aunt Nellie are family — so the portrait follows the fiction
and is written to be the one sprite in the game that is easy to replace. All
five portraits — captain, the three crew, and the empty chair — are 24×24
character grids in `sprites.js` sharing one ink legend, drawn to a cached data
URL by `portraitURL(id)`.

What is still open is most of what the berths are for: whether the other two
get effects of their own, whether anybody can be recruited outside the quest
line, and whether three is the number. Note what the Engineer's gate does to
the line's ordering — quest #6 now sits in front of the whole upper rack, and
in front of fire crystals at #8, so the errand that was a story beat is load
bearing.

Crew reacting to the player's burns is a desired feature, working as characterization, soft tutorial, and feedback on skill. Early flavor notes per species: Emberkin crew cheer big burns and complain through long coasts. Otter crew are chatty, point out sights, and grow anxious when the radio goes quiet. Cat crew love tight slingshots, mock safe routes, and are secretly terrified of landing. Frog crew hum during coasts, dislike high-g burns, and never complain about the slow road.

How crew relate to the player's standing with each species is also unsettled: each of the three comes from the people whose region their quest crosses, so reputation and crew already move together in the fiction without being wired together in the code.

### 7.3 Events — TBD

Coasting stretches are natural pacing gaps and the likely home for events. The guiding principle is that events should ask for **orbital decisions** where possible, not just text choices.

Candidates from brainstorming include distress beacons (requiring a rendezvous), rival traders racing to the same market, stowaways in the hold, solar flares threatening sensitive cargo, hitchhikers on passing asteroids, cat toll intercepts in the Belt (escapable through maneuvering), and letters or radio chatter that advance character stories mid-flight.

Open questions include event frequency, trigger conditions (location, cargo, reputation, time), and how events tie into species relationships.

### 7.4 Competition and Rivalry — TBD

Options for channeling competitive drives without combat include a named rival trader who taunts the player over the radio and races them to markets, economic plays like cornering a market before a festival, and asynchronous route leaderboards or ghost trajectories. None are committed.

### 7.5 Ending and Long-Term Goal — TBD

The Builders and the Maw are the long-term hook, with breadcrumbs at the Arc, on Whisker, and in the research station under the ice on Glass. Undecided: what the Builder station at the Maw is for, what the Builders were and why they vanished, whether reaching the Maw ends the game or opens a post-game, and how the frogs' songs pay off.

### 7.6 Art Direction — TBD

A fully hand-drawn navigation chart was considered and ruled out as unrealistic in scope. Visual style, UI treatment, and how species are presented (portraits, animated sprites, text only) are undecided.

**Decided since the first draft.** The bodies are sixteen-pixel sprites — generated for the spheres, hand-drawn for everything that is not one — and a new game opens with a six-and-a-half-second pixel film of a harbour lighter leaving Tassel's ocean: out of the water, through the cloud deck, and into the dark. It is a cutscene over an orbital rendezvous rather than a landing (2.3): the lighter touches water, the merchant ship never does, and the player still starts in orbit with nothing to cast off from. It plays for a new ship only, it is skippable with any key, and the clock waits for it.

### 7.7 Open Technical Questions

**Decided since the first draft**, and recorded above rather than here: burns are instantaneous impulses (2.2); the control is four buttons on two axes, reached by tapping the road (2.2); there is no landing and the game starts in orbit (2.3); the clock runs at ten real minutes to a lap of the low orbit the game opens in, with no warp ladder and skipping by pointing at a place (2.6); the chart is locked to the body the ship orbits and draws only the immediate orbit plus the next crossing (2.6.1); the opening mission is a single errand to Slate.

**Still open.** Distance compression beyond the inner system needs prototyping. Docking-zone size and speed thresholds need tuning for the right level of forgiveness. The representation of belts and debris fields (Section 6) is settled; what a player can *do* in the Belt beyond docking at the two havens is not. Whether landing is ever added — and if so, whether it is a third control scheme or a cutscene over an orbital rendezvous — is deferred, not refused.
