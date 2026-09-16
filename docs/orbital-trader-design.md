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

**Two axes, four buttons.** A burn is set with **Forward**, **Back**, **Out** and **In**: prograde and retrograde along the way you are already going, and out and in across it. Each is one large button with an arrow and a word. There is no typing, no unit to choose, no handle to drag to the right number, and no third axis to discover.

**The two axes are at right angles**, which is to say out and in are perpendicular to the way you are going rather than along the line from the world — the maneuver-node frame, not true radial. They coincide on a circle and part company everywhere else, and the difference is not academic: on a working eccentric orbit a press of **Out** used to put an eighth of itself into going *faster*, so a button sold as turning the path quietly resized it. Three things follow from squaring them up. Out and in add nothing along the way you are going. The two numbers on a mark's card add up as a triangle, so what the card shows is what the tank is charged. And a ship falling dead straight at a world — where the old axes lay on top of each other and no pair of numbers could express a push across the line — can now be given the one mark that saves it, since braking a radial fall does not lift it and only crossing the line does.

**One press is one step, sized to the orbit.** A press is a fixed fraction (0.5%) of how fast the ship is actually going at the mark, rounded to a number a person would say out loud. The same press is a small change whether you are creeping round a moon at 200 m/s or falling past the Lamp at 30 km/s. Holding a button repeats, and then hurries.

The four directions are drawn around the mark on the chart as well, growing with the burn written down along them, so the pad and the chart say the same thing. They are a legend, not a control: the chart is never something you have to drag accurately.

Planning is free. Nothing is spent until the clock reaches the mark, and a mark can be moved, re-pressed, zeroed or scrapped.

**The tapped point stays on the chart while the card is up.** Two roads can lie a few pixels apart — the one you are on and the one a burn would put you on — and the card that opens names a time, not a place. A breathing ring marks the exact point that was tapped until the card closes, so a player can see which line they hit before pressing anything on it.

**A drag is continuous.** Moving a mark along the road takes the time under the pointer, kept on the lap it was on and between its neighbours — and never more than half a lap from where it was in one pointer event. That last rule closed a bug two playtesters found in ten minutes: once a burn is pushed out to a moon, the yellow road it makes is an ellipse that returns to the very pixel the mark sits on, one whole transfer later, so a finger a few pixels off the white line caught the return leg and put the burn twenty-one laps into the future. A move that far is a misread, not a drag, and is refused.

**A mark says what the engine will do; the gauge says what it costs.** The chart used to label a mark with the size of the burn — "0.12 km/s" — which is the fuel it will spend. Two playtesters read that as their speed, and both were braking at the time: they pressed **Back** to slow down and watched the number climb. It was never speed. A length of engine is positive however you point it. So a mark now reads in the words on the buttons — `back 120 m/s`, `forward 1.2 km/s`, `back 120 m/s · out 40 m/s` — and the cost of the whole plan is shown against the fuel gauge, where the word *fuel* already is: the readout gains "· 0.12 km/s planned" and the gauge grows a hatched stretch at the right-hand end for what the marks will eat. Nothing about a burn that slows you down goes up any more.

**A planned burn is what the lesson calls it.** "Burn" alone meant nothing to two new players; the card that introduces it now says what it is — a point on your path where the engine will fire and change your speed, and nothing happens until the clock gets there.

Burns are **instantaneous impulses**. What you plan is exactly what you get, which removes execution error and keeps the challenge in route design rather than timing reflexes.

### 2.3 Arrival, and Why There Is No Landing

**Nothing lands.** Every harbour in the system is an orbit, and docking means matching one: you arrive by getting close enough and slow enough inside a port's **harbour mouth**, and the port's own lighters carry goods the rest of the way down. A world's surface is scenery and a crash hazard, never a destination.

**How wide a harbour mouth is, is not a design number.** Like a world's reach, it comes out of the world:

> `r_dock = (top of the air) + 5 × radius`

Five of the world's own radii above its weather — above the ground, on a world with no air worth the name. A big world earns a big harbour and a pebble earns a small one, so widening a world widens its approach and no table can quietly disagree with the sky it is describing. Grumm's approach is enormous because Grumm is enormous and carries fourteen hundred kilometres of cloud on top of that, not because somebody typed a number.

Two consequences are worth stating plainly, because the formula means different things at different sizes. On a planet the mouth is a small target — Grumm's is 1% of its sphere of influence and Cinder's 2%, so arriving in a planet's gravity and tying up at it are two separate pieces of flying. On a small moon it is a good part of the well — Glass's mouth is 54% of Glass's reach, Brine's 47%, Slate's 39% — so crossing into a little moon's gravity is most of the way to arriving. That is the shape five radii has: it scales with the ground, and a moon's reach does not.

On the chart the mouth is a dashed ring with **a small anchor hung at the top of it**, green where they will take your lines and amber where they will not yet. The anchor is there because a dashed circle round a world is the same shape as three other things the chart draws — a sphere of influence, an atmosphere, a hollow rock — and this is the only one you can tie up inside.

**Two kinds of harbour.** At most worlds, tying up means being in orbit: the mouth is a circle your whole orbit has to fit inside, gravity holds you there, and getting captured is the manoeuvre. A **rendezvous** is the other kind — no orbit to wait in, so the harbour asks the two questions it always asked instead: near enough, and slow enough beside it. Which one a place uses is authored (`harbour: "rendezvous"`) rather than derived, because it is a fact about the yards and not a consequence of the mass; a body with no mass at all is a rendezvous by default, having no orbit to offer.

**Nail and Whisker are worlds you orbit.** They are the two biggest rocks in the Belt — 449 km and 329 km — with real weight, a reach, a mouth five radii over the ground like everybody else's, and a parking orbit you sit in. That was a deliberate choice over making them rendezvous harbours: the run out to them is the lesson the two crew quests are hung on, and the lesson is the tutorial's own skill — get into an orbit, bring the high point inside the mouth — asked for again somewhere it matters. The change matters more than the numbers suggest. Nail used to be a three-hundred-thousand-kilometre bubble in the Belt: aim vaguely at the Belt and you were docked. Its mouth is 2700 km now, which makes reaching it a real approach.

**The Maw is the one rendezvous left.** It has no surface to stand five radii off and no air over it, so it keeps the authored mouth the five-radii formula has nothing to act on, and a pilot arrives by matching speeds. Because there is nothing to fall into, **the intercept mark is the instrument you fly it on**. See §2.6.1.

This is a scope decision as much as a fictional one. Landing would need a second control scheme, a second set of physics, and a second art problem, and it would buy nothing the orbital game does not already have. The fiction absorbs it easily: Tassel is an ocean of floating harbour cities that meet ships in orbit, the cats cannot survive a heavy world at all, and the frogs' balloon villages have no ground under them either.

The player therefore **starts in orbit**, not moored. A new game opens with the ship already going round Tassel — *low* round it, high point under one planet-diameter of altitude, so the ocean fills the chart and visibly turns underneath — with a road drawn ahead of it and a crate in the hold. There is nothing to cast off from and nothing to press before the chart means something. The harbour itself is higher up, at the docking altitude every other orbit in the game is measured from; tying up and casting off again is what puts a ship there.

### 2.3.1 Forgiveness Systems

Arrival uses a **docking zone** around each port, sized by the rule in 2.3. Entering it below a relative-speed threshold counts as arrival. If the player comes in too fast, they can simply plan a correction burn and try again. Mid-course corrections are cheap and encouraged. Planning previews show everything the player needs, so failure comes from choices, not surprises.

Running out of fuel is not a game over, and there are two ways out of it, which cost different things.

A **tow** can be called at any time, stranded or not. A tug comes from the nearest port that sells fuel, charges a fixed sum by distance, and takes months. If the purse cannot cover it the Tassel harbour bank fronts the rest and takes the difference out of later sales — so a tow always works, but it can leave a ship in debt.

A **distress call** opens only when the tank is completely empty and the ship is adrift. It goes to the last dock the ship tied up at, they come and get you, and they take **half of everything you have**. No days, no debt, and the hold comes with you. The price is a share rather than a sum on purpose: half of nothing is nothing, so the one player a tow cannot rescue — dry tank, empty purse, nobody to lend to them — is rescued for free. That is the floor under the guarantee that nothing costs a save.

The two are a real choice rather than a better and a worse. A tow is usually far cheaper in coin and costs a season; a distress call is instant and expensive, and gets more expensive the better the run has been going. And the destination differs: a tug takes you to whatever is nearest, which may be nowhere you were going, while a distress call takes you back to the port you set out from. If that port sells nothing to burn — the Arc and the Maw do not — the call is answered by the nearest port that does, and the card says so rather than delivering a dry ship somewhere it could never leave.

A stranding remains a natural hook for an event.

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

**The sky was squeezed by three.** Every orbit about the Lamp is a third of the size it was, and the Lamp is a third of the mass. Those two together are the whole trick: `v = √(μ/r)` with both halves moved the same way leaves every speed — and so **every delta-v in the game unchanged**. What changes is time. A lap, a transfer and a launch window all take a third as long, so Tassel's year is **120 days**, a crossing to Cinder is **43 days** instead of 129, and a missed window there costs **104 days** instead of 313. The sky was hard to hit because a player got one attempt a session; now they get three, at the same price in fuel.

Moons kept their distance from their planets, Scorch included: it had to move in when the squeeze shrank Cinder's reach below it, and moved back out to 0.00045 au when Cinder swapped places with Veyra and got its reach back.

**The two Emberkin worlds then changed places.** Veyra took the inner orbit at 0.1 au and Cinder the outer at 0.2. This is a quest-line fix rather than a fictional one: the line sends a ship to Cinder at job five and to Veyra at job eight, and the inner orbit is the expensive one — so before the swap the line asked for the 18.5 km/s world first and the 6.5 km/s world three jobs later, with a starter tank of 14. Now the errand comes before the expedition. The checker asserts that ordering by name, because it is the line that depends on it.

| | orbit | to dock there | crossing | windows every | year |
|---|---|---|---|---|---|
| **Veyra** | 0.1 au | 18.5 km/s | 31 d | 24 d | 20 d |
| **Cinder** | 0.2 au | 6.5 km/s | 43 d | 104 d | 56 d |

**The sky is built at KSP's scale.** Every body is a tenth of the size a real one would be and many times denser, which is the trick that makes a world a place rather than a backdrop: Tassel is 996 km across, has 9.25 m/s² at the ground, air to 70 km, and a reach of 60,300 km — a Kerbin. A new game opens at 150 km, eighty above the air, on an orbit that takes thirty-six minutes of game time — high enough that the chart shows daylight between the ship and the ocean rather than a lighter apparently skimming it. Local flying is correspondingly cheap: the first lesson is a quarter of a km/s. Interplanetary flying is *not*, because a small world gives almost no gravity assist on departure or arrival, and that trade is deliberate.

**The clock is slow on purpose.** At ×1, one lap of that opening orbit takes **about eleven real minutes**. That is the fastest thing in the sky and everything else is slower still, so at ×1 almost nothing else appears to move.

It was tuned to exactly ten when the opening orbit was a hundred kilometres up. Raising that orbit to a hundred and fifty stretched the lap to eleven and a quarter rather than speeding the clock up to keep the round number, because the clock is the thing every *other* body's motion is read against: winding it on twelve per cent to preserve a figure nobody can time would have set the whole sky moving faster at ×1, which is the one thing this decision exists to prevent. That is the intended reading: an orbit is a place you are, not an animation you watch. Watching the sky turn is what skipping is for.

**There is no ladder of warp speeds.** A strip of ×1 / ×10 / ×100 buttons asks the player to answer a question they do not have — *how fast should time go?* — when the question they actually have is *when do I want to be there?* So time is skipped by pointing at a place:

- Tap anywhere on your drawn road and choose **Skip to here**, or press **Skip to it** on a burn, a crossing, or a near pass.
- A confirmation says how far off that moment is in game time and how long the wait will be in real seconds.
- On yes, the clock runs at exactly the rate that covers the stretch in **about ten seconds**, and stops itself on arrival.

Anything worth being awake for cancels the skip and drops the clock back to ×1: a burn firing, a change of sphere of influence, a harbour mouth, a toll, a dry tank. The only control the clock has besides skipping is a **hold**.

A cap on the rate means the longest hauls take proportionally more than ten seconds; the confirmation says so rather than promising ten.

### 2.6.1 The Chart

Two rules keep the chart readable, and both of them are about refusing to show things.

**The chart is repainted whole, every frame, and its cost is the size of the backing store.** Nothing on it is cached — ground, four hundred stars, the Scatter, every rail, the road, the worlds — and it does not need to be, because the arithmetic behind it is cheap: at 1600×1000 the drawing commands take about 2 ms a frame to issue and the rest is the rasteriser filling pixels. That makes the frame time very nearly linear in pixel count: **13 ms at one device pixel per CSS point, 25 at one and a half, 37 at two.**

A retina screen asks for two, which is four times the pixels of an ordinary one — so on a high-DPI display the chart ran at twenty-seven frames a second and dragging it visibly stuttered. This was never about the kernel: the same measurement on a build from before any of this week's work gives the same 37 ms.

So **the resolution follows the gesture.** At rest the chart paints at the full device ratio and the pixel art is as sharp as the screen can show. While the view is being moved by hand — a drag, a wheel, a pinch — it paints at half that, until a fifth of a second after the last of it: 37 ms becomes 12. Nobody can see the difference in pixel art that is sliding under their finger, and everybody can see twenty-seven frames a second. The clock moving the ship does not trigger it, because the chart is locked to the ship and the sky under it barely stirs. The switch happens at the top of a draw and nowhere else, since resizing a canvas discards its contents and resets the context.

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

**Every drawn rail carries a lead: a short bright stretch just ahead of its world, ending in a chevron.** Which way a moon is going is the first thing an aiming card asks a player to know — "thirty degrees ahead of Slate" — and on a faint grey circle two new players could not tell ahead from behind. The lead is sampled from the same function that places the world, so it sits on the rail rather than on a tangent to it, and it is left off rails too small on screen to carry one.

**Where the road first cuts a world's rail, the chart says where that world
will be.** Two orange diamonds, and nothing joining them: one on the road at
the crossing, one on the rail at the place that world has reached by then.
This is the reading interplanetary flight actually turns on. Crossing Veyra's
orbit means nothing on its own — the road and the rail are both drawn, so the
crossing has always been visible — but crossing it with Veyra a quarter of a
lap away means you left too early, and the gap between the marks is how much
too early.

The same refusal as the road itself: **one crossing, the soonest, and no
more.** A long ellipse cuts five rails going out and the same five coming
back, and ten honest pairs of diamonds is a chart nobody can read. The rail
also has to be on the screen — a crossing of a ring nobody can see is two
marks in the dark with nothing to be against. And the pair is left unjoined
on purpose: a dashed line between them was the obvious thing to draw and the
wrong one, because a straight line across a chart of curves reads as a path
you could fly.

**A world you are already going round is not an encounter — unless you have just fallen into it.** A parking orbit reaches its low point once a lap; that is where you already are, and marking it would put a crosshair under the ship in the opening frame of every game. But a skip ends at every change of reach, so the door into a world is exactly where a pilot gets put down, and on the hyperbola they arrived on the low point ahead *is* the encounter — at a rendezvous it is the one moment the ship can be tied up. Suppressing it left the panel offering nothing but the way out the far side, and at ×1 the crossing of Nail's reach is nine real minutes of watching. So the rule is keyed on the orbit being closed, not on it being yours.

**Where the road comes nearest a world, the chart puts a crosshair, and the panel puts a number beside it.** One per world, at the *first* close pass and never the second — a road that cuts the same rail three laps running earns one mark, the same refusal the road itself makes. The line reads *closest approach to Nail: 1,250 km at 4.75 km/s, in 146 days*, and it is two numbers rather than one on purpose.

This is the whole instrument at a place with no gravity worth the name. At a planet you aim roughly, get captured, and tidy up afterwards; the well does most of the work and being a few thousand kilometres out is forgiven. At a rendezvous nothing catches you, so arriving means putting the ship in the same place *and* at the same speed, and the only way to see whether a burn is doing that is a mark that says how close and how fast. A readout that said "inside docking range" on distance alone would send a pilot 146 days down a road to discover on arrival that they were going four times too fast to tie up, so where the pass is inside a rendezvous mouth but over its speed limit, the line says so and says what to match it to.

**A port is marked within a tenth of its own orbit, and that is the number that makes the mark useful.** Measured against a world's reach alone — twice the sphere of influence, which is what the mark was originally cut to — the crosshair does not exist until the road is nearly right. Fifty metres a second off a five-kilometre burn to Nail leaves the pass 1,480 Mm out: inside one per cent of the answer, and still far outside twice Nail's reach. So the pilot pushed the burn through the entire useful range of it with a blank chart, and the mark appeared only once they no longer needed it. That is a rosette for arriving, not an instrument.

There is no aim helper on the chart — `trimToTarget` exists in the kernel and is not wired to a button — so every road is flown by pushing a burn around and watching this one number come down. A tenth of the world's own orbit is the scale at which "am I anywhere near it" is a real question; it grows with the system, so a road to Grumm gets a Grumm-sized band; and it stays a signal rather than a decoration, because a world crosses its own band's width in a few days and a road that misses the timing is still not marked. The noise cost is near zero: a road only ever sweeps past the handful of worlds between its low point and its high one, and measured across the roads out of Tassel the widest band tried never put more than two crosshairs on the chart.

**The panel beside the chart does not repeat it.** Flying, the ship menu is three tabs — Ship, Quests, Crew — and the Astrolabe when it is fitted; the port menu replaces them while you are tied up. It used to carry two more while flying, and both were deleted: *Orbit* recited the low point, high point, height, speed and lap of an orbit the chart was already drawing and labelling, and *Burns* listed the marks you set and move **on the chart** without being able to edit one. A panel of numbers about a picture, beside the picture, is a worse place to work than the picture.

Three things in them were load-bearing and moved rather than went. **Ahead** — what the road runs into next, the crossings, the air brakes, the intercept lines above — is now the first thing on the Ship tab while flying, above everything the ship is made of, because it is the only thing in the panel the chart cannot say better. The **tow** and the **distress call** went with it: an empty tank is the one hole a tow cannot always dig you out of, since a tow has a price and a purse can be empty, so the floor under it has to live somewhere a stranded pilot can find without being told.

### 2.2.1 The Astrolabe

**A transfer is won or lost before the burn.** Thirty degrees off the window, Cinder to Tassel costs **+2.6 to +3.8 km/s** on top of a perfect 6.5 — 47% of a starter tank becomes 65–74% — and sixty degrees off makes it 13.8 of 14, which is to say impossible. None of that was visible anywhere. The chart draws the road and the rail; the orange diamonds say how far out of phase you are; nothing turned that into fuel.

The Astrolabe is the instrument that does. It is a key upgrade, and its tab appears in the ship's menu when it is fitted and not before. One line for each world that goes round the Lamp — **moons are not on it**, because a moon is reached from the world it belongs to, which is a manoeuvre rather than a window — and each line carries:

| | |
|---|---|
| **Perfect** | within 5% of what this crossing costs at its best. Go now. |
| **Good** | within 25%. |
| **Bad** | dearer than that, but the tank can still pay it. |
| **Impossible** | more than the tank holds. |

Each row is a name, a verdict, the cost and flight time of leaving today, and **the days until the next window** — a dash where no window helps, because the crossing is past this tank at every phase, and the word **now** where the window is the one you are standing in. That last case is not a nicety. The countdown is to the *next* window, so the moment a wait lands the row read `PERFECT` over `103 d`, which together say the instrument is wrong; it is the first thing anybody sees after using the button, and it made a correct instrument look broken. A window that is open says so and stops offering to be waited for. Waiting is nearly always the answer otherwise: thirty degrees is about nine days at Cinder, and nine days are free. The four words do the explaining; the rows do not.

The cost comes from Lambert, searched over flight times from half the Hohmann time to half again as long. The cheapest conic at a bad phase is a very slow one — a two-year crawl out to Grumm, priced as though it were a bargain — and an instrument that recommends that is lying by omission, so the search only offers roads a person would actually fly.

**Tapping a world's rail asks the clock to wait until that world gets there.**
The other half of the same question. Everything else on the chart answers
"where will I be"; until this, nothing answered "when is anybody else
anywhere". A tap on the ring a world travels on offers the same skip-ahead
card a tap on your own road does, with the time counted to the moment that
world reaches the point under your finger — so the usual way to plan a
transfer is to tap a rail, read the wait, and burn from there. The road wins a
tie over a rail and a world wins over both, because a rail runs straight
through its own world and a planet has to stay tappable. It works tied up as
well as adrift, which is where the waiting mostly happens.

**A skip has to be able to end at a mooring**, and for a long time it could
not: the frame loop cleared a skip's stop on every frame that saw a docked
ship, so a wait started at a port set the clock to nine days a second and
nothing ever turned it off. Ten seconds took you to the window; twenty put you
ninety days past it, and the clock readout was invisible throughout because it
keys off the same stop that had just been discarded. The Astrolabe's own
Wait-for-it button is on a tab you read while tied up, which is how a working
instrument came to be "always wrong". The rule the loop wanted was that
*arriving* ends a skip — a tow can dock you in the middle of one — not that
being docked forbids having one.

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

**What the table says, and who can read it.** Every good carries a *nature*
line — what the thing physically is, and never who wants it. Pressure-resistant
glass that glows in the dark. Stone that is heavy, permanent, and the only
thing a terrace will stand on. Metal still warm a year out of the ground. It is
on hover and behind the "i" beside every good's name, on the shelf and in the
hold alike, and it is free to everyone, because it is written on the crate.

The rest is the appraiser's (§7.2). Until Wicket is aboard, a port's **They
love** and **They want** lists are two lists of names with no prices on them,
and no good will tell you which of a people's moons is the one that loves it.
A captain closes that gap by carrying some and finding out. Wicket closes it by
looking: prices appear on the lists, and every good's "i" gains *loved by* and
*wanted by* in the same words the table uses — sometimes a port, sometimes a
whole people. She is a shortcut through reasoning that was always possible,
which is the only kind of knowledge worth selling a journey for.

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
| Gravitational sensors | Nail | — | Puts the Knot on the chart for a crew with no navigator to have told them |
| Heat shielding | Cinder | Engineer | Lets the ship fly through air instead of into it — aerobraking, at a price |
| Cryo hull cooling | Cinder | Engineer, heat shielding | Takes the price off: the same passes, no risk |

**A rendezvous has to say what it is waiting for.** It is the one state in the game where the ship is exactly where it wants to be and doing the wrong thing about it: inside Whisker's mouth, thirty thousand kilometres from the harbour, going five and a half kilometres a second past it. There is no gravity to finish the job — being near a rendezvous is not being caught by one — so the ship will sail straight out the far side unless the pilot matches its speed. The Ahead panel therefore leads with the harbour the ship is inside, live while the burn brings the number down: *Whisker is right here, and there is nothing to fall into: 32,800 km off and closing at 5.55 km/s. Match its speed to 1000 m/s or under and it will take you* — and then *Whisker will take you now*. Inside the mouth with only the speed wrong is also no longer greyed in the HUD, because that is not "nowhere near it", it is the most actionable thing on the screen.

Without that, the whole screen agrees the place is broken. The anchor only appears once docking is already possible, the mouth is an unlabelled ring at that zoom, and a player who has just learned that Nail has a reach you fall into will reasonably conclude that Whisker is missing one.

**All four do something now.** They were not always: the rack carries a "not
fitted to anything yet" line for any row that is ahead of its mechanic, because
selling a captain a box that does nothing without saying so is a swindle, and
because the alternative — holding the upgrade back until the mechanic lands —
means the mechanic arrives with no place to be bought. Nothing wears that line
today.

**Aerobraking.** Without a heat shield the air is a wall and the hull meets it.
With one, a periapsis inside the air inserts a free retrograde node at the
bottom of the dive, and how much it takes goes with the *square* of how deep
the dive goes:

    shed = min(maxFraction, k · depth²) · v_periapsis      k 1.4, cap 0.9

so the band of air is two different places. The top of it is a feather — a
graze a few kilometres under the cloud tops takes two or three per cent, costs
nothing, and a patient pilot can walk an orbit down over as many laps as they
have days for. The bottom of it is a wall: aim a few kilometres over the ground
and the planet takes an arrival's whole excess in one lap. A ship falling into
Tassel at 1 km/s of excess leaves a 7 km pass in a closed orbit, having spent
no fuel.

What stops that from being a crash is the floor. However hard a pass bites, the
node is clipped so the far end of the resulting orbit still clears the air
(`floorApo`, 1.25 × the cloud tops), and once a ship is sitting on that floor
further passes shed nothing. The worst a deep dive can do is park you low, in
an orbit you must burn to climb out of.

The price is the hull. `skimRisk` is convex — the first 350 m/s of a pass is
free and the rest grows with the square, capped at 85% — so splitting a hard
brake across four shallow laps is genuinely safer rather than the same risk
spread thinner, and the pilot who takes the days is playing better rather than
just slower. The measured shape at Tassel: a 60 km graze is free, a 40 km pass
sheds a quarter of the speed at about one chance in ten of damage, a 7 km pass
captures outright at one in six against a slow arrival and near-certainly hurts
against a fast one. Cryo cooling sets that to zero at any depth, which is the
whole of the difference between the two boxes on the rack: the heat shield buys
the manoeuvre, the cooling buys it cheap.

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

**Naming.** Each people names from its own well, so a name says where somebody
is from before anything else does. The wells are:

| People | Scheme | In the game |
|---|---|---|
| Otters | Short, soft, one or two syllables, from small birds, weather and water | Finn, Wren, Theo, Nellie |
| Emberkin | Indian given names, and an institution rather than a family — `Name of the Ninth Forge`, `House Rathore`. The institution is the important half | Kiran, Devika, House Rathore |
| Cats | Japanese given names | Tsuki, Kaede, Haru, Rin |
| Frogs | Two syllables, always | Wicket |

The rule that matters is that these are wells, not costumes: a new quest giver
is named by picking from the right one, and a name that does not fit its people
is a bug in the fiction the same way a wrong price is a bug in the market.

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

*(Every distance in this section is from before the sky was squeezed by three — see 2.6. Divide by three for where things actually are.)*

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

**Twenty-four jobs are built.** They are written out in `quests.json`, they
work, and a player meets them: the Requests tab on the dock menu lists whatever
jobs the port you are tied up at is offering, and you can hold three at once.

**Salvage is built**, and it turned out to need no new flight at all. The
manoeuvre it wanted — come alongside a thing with no gravity and hold there —
is the Maw's rendezvous, which was finished for the Maw and works anywhere.
A wreck is a body in `tuning.json` with no mass, a mouth, a closing speed and
a drift reach, deliberately *not* in the price list: a derelict has no stall,
no pump, no board and nobody to talk to, so it has one menu rather than four
empty ones. Seven of them are in the sky:

| Wreck | Where | The job |
|---|---|---|
| The Cutter's Jaw | round Slate | an otter mining tender over the yards it worked |
| The Ashfall | an ellipse between Veyra and Cinder | an Emberkin ore hauler that lost its tank |
| The Tin Whistle | the inner Belt | a cat prospector that went quiet mid-sentence |
| Grandmother's Patience | the Belt | an otter long-hauler a long way from water |
| The Sixth Forge | the Belt, between the havens | an Emberkin freighter, still crated |
| Hull 41 | the outer Belt | a hull with a yard number and no name |
| The Long Sweet | a wide circle above Haven | a frog cider transport, perfectly intact |

An eighth is designed and not written: it is taken at the Arc and leads into
the debris trailing behind it, where the key item for the closing line is. Hull
41 is the thread that points at it — Arc glass in a ship that was never near
the Arc — and it says so in as many words when you hand it in.

Both quest chains run. Crew is settled far enough to pay out (§7.2): three jobs
hand over a person, and finishing one fills that berth. #20 still needs an Arc
fragment to exist as a thing to *investigate* rather than a good to carry.

| # | Quest | Type | Route / Goal | Reward |
|---|---|---|---|---|
| 1 | First Shipment | Retrieval | Slate: retrieve shiny moon pebbles → Tassel | Tutorial; unlocks trading |
| 2 | A Taste of Home | Delivery | Tassel → Moss: deliver moonfish oil | Credits |
| 3 | Green Medicine | Retrieval | Moss: retrieve medicinal herbs → Tassel | Credits |
| 4 | A Message for Slate | Message | Tassel → Slate | Credits |
| 5 | The Heavy Stuff | Delivery | Slate → Cinder: deliver iron ore | Credits |
| 6 | Engine Trouble | Delivery | Cinder: spares → Scorch, its own moon | **Emberkin Engineer** |
| 7 | A Favor for an Engineer | Message | Cinder → Scorch: deliver a message | Credits / faction reputation |
| 8 | Emberkin Luxury | Retrieval | Scorch: retrieve fire crystals → Veyra | Credits |
| 9 | The Collector | Shopping List | Veyra: acquire pearls, coral carvings, precision clock | Large payout |
| 10 | Faction Business | Message | Veyra → Cinder: deliver confidential message | Faction reputation |
| 11 | Into the Belt | Delivery | Cinder → Nail: deliver reactor coils | Credits |
| 12 | Something Shiny | Retrieval | Nail: retrieve salvaged sensors → Veyra | Credits |
| 13 | A Cat's Request | Message | Nail → Whisker, the rock next door | **Cat Navigator** |
| 14 | First Salvage | Salvage | With the cat navigator: recover a drifting wreck | Credits — seven of these are built |
| 15 | Lost Cargo | Salvage | Belt: intercept a derelict cargo ship | Credits — four of the seven are in the Belt |
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
`quests.json` and no code — the file opens with the record format, and the
build step refuses a record that does not keep to it.

| Type | Steps it earns | Built |
|---|---|---|
| Retrieval | one *acquire* per good, then *handover* at the destination | yes |
| Delivery | *handover* only — the goods come aboard when you accept | yes |
| Shopping List | one *acquire* per line on the list, then *handover* | yes |
| Quest Chain | one *visit* per stop, in order, then *handover* | yes |
| Message | *handover* with nothing in it: be there, that is all | yes |
| Salvage | *recover* at the wreck, then *handover* at the destination | yes |
| Appraisal | mechanically a retrieval | via retrieval |

Three step primitives do all of it. **acquire** is satisfied by having the
goods aboard, however you came by them. **visit** is satisfied by being tied up
at a port. **handover** is satisfied by being tied up at the destination with
the goods, and it is the one step that takes something out of the hold.

Retrieval and shopping run on the same machinery. The difference — one good
from a named place against a list from anywhere — is in the telling, not the
rules, and saying so is cheaper than inventing a mechanical distinction.

**Salvage** added the one step that runs the other way. *acquire*, *visit* and
*handover* all read the hold or the dock; **recover** is the only step that
puts something *into* the hold, and it is the mirror of handover in every
respect — the haul rides as a consignment, so it cannot be sold and the cats do
not count it for a toll.

Two rules keep it honest. Coming alongside takes the cat navigator, which is
the harbour's own rule applied a crossing earlier: a salvage job is refused at
the board rather than at the far end, because a crossing spent to be told no is
a crossing thrown away. And arriving with a full hold does not fail the job —
the step simply does not tick, so a pilot can make room and come back. The
wreck is not going anywhere.

It is also the first real use of the Belt for something other than passing
through: four of the seven are out there.

### 5.1.1 Taking a Job On

**An Astrolabe, or you stay in this sky.** A job whose route leaves the system it was handed out in cannot be taken without one. Every crossing in the line is gated on it — the first is job five, Slate to Cinder — and it is on every rack in the game at 900 cowries, the cheapest key there is, because a ship that cannot leave the sky it is in cannot go and fetch the thing that lets it leave.

**Three at once, and no more.** Finished jobs do not count against the three;
abandoning one gives the berth straight back.

That was true from the start and did not look it: the Quests tab listed a
finished job wherever it had been taken on, sitting among the live ones with
its steps all ticked, and nothing on the tab said it was no longer one of the
three. The tab now leads with **`N of 3 in hand`** and keeps the finished ones
underneath their own heading, newest first, with their steps dropped — a
record of the trip rather than a list of things to do. There will be twenty of
them by the end, so they are compact on purpose.

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

### 5.1.2 The two early berths

Both crew quests were long hauls and a player reached them late. A crew member
is a mechanic — the engineer's berth is what the deep-sky tank is gated on, the
navigator's is what puts the Knot on the chart and the second crossing on the
road — and a mechanic handed over in the last hour is one nobody gets to use.

So both are local hops now. **Engine Trouble** is a delivery from Cinder to
Scorch, its own moon, which needs no Astrolabe because it never leaves Cinder's
sky and needs no capital because a delivery is handed to you. **A Cat's
Request** is a message from Nail to Whisker, which weighs nothing and costs no
hold. Neither asks the player to cross the system for a person they have not
met yet.

The pair also carry the lesson for the change under them: Nail and Whisker have
mass now, so both runs are flown by getting into an orbit round a small world
and bringing the high point inside the mouth — the same skill the tutorial
teaches at Slate, asked for again somewhere it matters.

### 5.2 What the Line Needs That the Game Does Not Have

1. ~~**Crew as a reward.**~~ Done, as far as the line needs. Three of the
   twenty hand over a person — Kiran the Emberkin engineer at #6, Tsuki the cat
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
   built now, and it needed no new flight: the rendezvous written for the Maw
   works at any weightless thing on a rail.
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

**Decided since the first draft.** Reaches are computed from mass and harbour mouths from size rather than written down (2.1, 2.3), and the invariant checker proves the promises a hand-tuned table used to make. The Belt is decorative — a field of drawn rocks — but Nail and Whisker are not two of them: they are bodies with wells, reaches and mouths like any other, and are docked at in orbit. The Arc is a small body you orbit too. The Maw is the last massless zone with an authored mouth, and it carries a *drift reach* four times that mouth which has no effect on any path at all: inside it the burn axes are measured against the target instead of against the Lamp, so forward and back are relative closing speed and out and in are away and toward. Holding a ship there against nothing is what the cat navigator's berth buys, along with the two numbers it is flown on — distance at intercept and relative speed.

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
| Engineer | Kiran (he) | Emberkin | #6 Engine Trouble (Cinder → Scorch) |
| Navigator | Tsuki (she) | Cats | #13 A Cat's Request (Nail → Whisker) |
| Appraiser | Wicket (he) | Frogs | #19 Appraisal |

`state.crew` carries a slot per berth, null until earned and then `{ role,
from, joinedAt }` — who they are, which job brought them, and when.

**Two of the three berths now do something**, and both do it the same way: a
thing the world already contains is refused to a ship with nobody aboard who
can reach it. No bonuses, no discounts, no numbers folded quietly into a burn.

**The Engineer** gates the rack. The second and third size of tank and hold,
and every gate key but the cat sensors, are refused while her berth is empty
(§2.8).

**The Appraiser** gates *knowing what a thing is worth*, which is a different
claim from knowing what it is (§2.7). Every good carries a nature line —
pressure-resistant, glows in the dark, warm a year out of the ground — readable
by anybody, on hover or behind the "i" beside its name. That much is written on
the crate. What no captain can see until Wicket is aboard is which of a
people's four moons is the one that *loves* a thing rather than merely taking
it, and what any of them would pay: a stall's wants are a list of names until
she is there to put numbers on them. The reasoning is the game in the gap —
glass that will not crack under pressure, and a world at the bottom of an
ocean — and she is the shortcut, bought with a journey.

The Navigator still does nothing. Two effects in, the pattern is clear enough
to say what hers should be: something the sky already knows and a ship cannot
read without her.

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

**Decided since the first draft**, and recorded above rather than here: burns are instantaneous impulses (2.2); the control is four buttons on two axes, reached by tapping the road (2.2); there is no landing and the game starts in orbit (2.3); the clock is tuned to a lap of the low orbit the game opens in, about eleven real minutes, with no warp ladder and skipping by pointing at a place (2.6); the chart is locked to the body the ship orbits and draws only the immediate orbit plus the next crossing (2.6.1); the opening mission is a single errand to Slate.

**Still open.** Distance compression beyond the inner system needs prototyping. Docking-zone size and speed thresholds need tuning for the right level of forgiveness. The representation of belts and debris fields (Section 6) is settled; what a player can *do* in the Belt beyond docking at the two havens is not. Whether landing is ever added — and if so, whether it is a third control scheme or a cutscene over an orbital rendezvous — is deferred, not refused.
