# Greener Thumbs — asset tooling

Early work on a third game for good-vibe-games.com: collect plant specimens and
keep them alive in a greenhouse. Photorealistic 3D, ecologically accurate, no
crossbreeding. Three starting species: **African Violet**, **Daylily**,
**Yellow Daffodil**.

This directory is the asset pipeline, not the game. Nothing here ships to the
site yet.

## What is here

    violet.py    a parametric African Violet, built and rendered headless
    v-h.png      it, healthy
    w-bad.png    it, neglected — see "what is broken"

## Running it

Blender is used as a Python module, so there is nothing to install but a wheel:

    pip install bpy          # Blender 5.0.1, ~1 GB
    python3 violet.py

Renders to `violet.png`. Every visible property is a number in the `P` dict at
the top of the file — leaf count, cupping, droop, chlorosis, bloom count, bloom
openness — which is the point. A plant's condition has to be a **parameter set
the model can be put into**, not a second model somebody sculpts. Three species
times four growth stages times a dozen decline states is not an art task anybody
finishes; the same three models driven by numbers is.

## What works

- Blender 5.0.1 headless via `bpy`, full Python API
- Procedural mesh building, shape keys, and armature bone chains — the rig a
  leaf needs to move in wind
- PBR materials with subsurface scattering, which is most of what separates a
  leaf from green plastic
- glTF/GLB export, with Draco compression available
- Cycles CPU path tracing: 420x420 at 96 samples in ~21 s on 4 cores

## What is broken

**The wilt is wrong.** `droop` should make the outer leaves lose turgor and hang
down beside the pot like wet cloth, from the tip back, with the crown staying
upright. Instead eleven rigid blades close over the pot like a fist, and the pot
shows through the gaps. Two attempts at it:

1. Rotating the whole leaf at the crown — swung the leaves into the camera.
2. Rotating less, and curving the blade down along its length, and moving the
   attachment point out to the rim — better, still a dome.

The likely fix is that a leaf should bend along a **bone chain** rather than
being rotated as a rigid body: three segments, each rotating a little more than
the last, so the blade curves instead of tilting. The armature code to do that
is already proven (see the rig test in the session history) — it just is not
wired into `violet.py` yet.

**It is not photorealistic**, and the gap is textures. Photoreal foliage is
largely scanned albedo, normal and translucency maps. The geometry here is
reasonable; the surfaces are flat colour. Two ways forward: source scanned leaf
maps (Poly Haven, ambientCG, Megascans, or photographs of a real violet), or
write procedural shader-node texturing for veins, mottling and the velvet sheen
a Saintpaulia leaf has. The first is better and needs network access.

## Why this was slow in the cloud session

Worth recording so nobody re-discovers it:

- **No GPU.** EEVEE will not start (`libEGL` missing). Cycles CPU on 4 cores
  only — fine for authoring, far too slow for bulk turntable rendering.
- **Egress was blocked.** Every 3D asset host — Poly Haven, ambientCG,
  Sketchfab, Fab, Quixel — and even `download.blender.org` refused at the
  proxy. `pypi` and `npm` were the only package sources open, which is the only
  reason `bpy` was installable at all.
- **Blender MCP could not be used.** It connects to a Blender running on the
  user's own machine over localhost; a remote container has no route there.

A local machine fixes all three at once: GPU EEVEE turns a 21-second render into
under a second, asset libraries become reachable, and Blender MCP works.

## Design decisions so far

- **Three species, chosen to be mechanically different.** The violet is fussy
  and punishes carelessness within a day. The daylily is nearly unkillable and
  each bloom lasts exactly one day. The daffodil is a bulb: it needs cold
  dormancy, and if its foliage is cut before it dies back naturally there is no
  bloom *next* season — a mistake whose consequence arrives a week later.
- **A season is one real week.** Plants are cared for daily; neglect shows and
  can kill.
- **Free sign-up**, one Durable Object per player, saved collections. This is
  the first game on the site to need identity — the other two are
  share-a-room-code and deliberately accountless. Tool Haven's `src/auth.js`
  already implements sessions and password hashing against D1 and is worth
  reading before writing any of it again.
- **Wind should be a vertex shader**, not baked animation: cheaper, never loops
  visibly, and it can read plant state so a thirsty plant moves less.

## Next

1. Fix the wilt with a bone chain per leaf.
2. Procedural leaf texturing — veins, mottle, sheen — or sourced scans.
3. Daylily and daffodil generators against the same parameter vocabulary.
4. glTF export with Draco, and a three.js greenhouse to view them in.
5. The care simulation, which is independent of all the art above.
