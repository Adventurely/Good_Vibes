# Greener Thumbs — asset tooling

Early work on a third game for good-vibe-games.com: collect plant specimens and
keep them alive in a greenhouse. Photorealistic 3D, ecologically accurate, no
crossbreeding. Three starting species: **African Violet**, **Daylily**,
**Yellow Daffodil**.

This directory is the asset pipeline. Two of its outputs now ship: the browser
scene reads `violet.glb`, and the title screen and the card on the home page are
both `bonsai.webp`.

## What is here

    violet.py      a parametric African Violet, built and rendered headless
    export_web.py  the same plant as a GLB the browser can carry
    bonsai.py      the title art: a bonsai on a pedestal in a zen garden
    species/       what each plant IS, how it declines, and the shared
                   state model all three are simulated by
    v-h.png        the violet, healthy
    w-bad.png      it, neglected — see "what is broken"

## What it feeds

    public/greener-thumbs/index.html   title screen, over bonsai.webp
    public/greener-thumbs/play.html    the greenhouse, reading violet.glb
    public/greener-thumbs/bonsai.webp        1920x1140 plate, ~88 KB
    public/greener-thumbs/bonsai-thumb.webp  640x380 card,  ~18 KB
    public/greener-thumbs/violet.glb         Draco + WebP,  ~428 KB

`play.html` takes `?dev=1`. Without it you get the room and a name plate; with
it you get the inspector — thirst, chlorosis, wind, wireframe, skeleton, and a
close-up framing. The switch on the title screen is what sets it, and it
remembers your choice.

The GLB is Draco-compressed with WebP textures, which took it from 7.65 MB to
428 KB. Draco alone would not have: the vertex data was 15% of that file and
the six texture maps were 82% of it. If it ever balloons again, look at the
maps before the mesh.

## Where the textures come from

Everything in the greenhouse that is brick, tile, wood, stone or grass is a
scanned PBR set from [ambientCG](https://ambientcg.com), which is CC0 — no
attribution required, kept here because it is worth knowing what is ours:

    brick_*   Bricks023      the dwarf wall
    tile_*    Tiles101       the encaustic floor
    wood_*    Wood062        benches, shelving, tool handles
    stone_*   Concrete034    pedestal, coping, gravel
    grass_*   Grass004       the lawn

Downsampled to 512 (1024 for brick and tile) and re-encoded as WebP — 1.5 MB
for the set, in `public/greener-thumbs/tex/`. Colour maps at quality 82,
normal and roughness at 92, because a blocky normal map shows up as faceting
across a whole surface and a blocky albedo does not.

They replaced textures painted into canvases at load. That was cheap and it
was the ceiling: a hand-drawn albedo has no normal or roughness map behind it,
so every surface answers the light identically and the room reads as coloured
cardboard however good the pattern is.

**Egress works from a local machine.** The cloud session recorded that every
asset host refused at the proxy; ambientCG and Poly Haven, API and CDN both,
are reachable from here. That is the whole reason this pass was possible.

## The colour-space trap, which cost a round

`violet.py` authors every map as **linear float tagged Non-Color**, which is
what Cycles wants. glTF has no such tag — a `baseColorTexture` is sRGB by
definition. So any map that goes into the GLB still tagged Non-Color gets an
sRGB decode applied to linear numbers, and comes out lighter and flatter than
authored: correct in Blender, washed out in the browser.

`as_image()` in `export_web.py` exists to re-encode on the way out, and the
blade already went through it. The corolla did not, and that — not the colour
values — is why the flowers were pale. Anything new that ships a base colour
map has to go through `as_image(..., srgb=True)`.

## Two more traps of the same shape

Both cost a round for the same reason the colour-space one did: the thing looked
right where it was authored and wrong where it shipped, so the difference was
never in front of you at the same time.

**`side: DoubleSide` is not thickness.** Solidify used to be stripped before
export, on the reasoning that a double-sided material shows the back of a
surface so the modifier was redundant. It shows the back; it does not give the
surface an edge. A zero-thickness blade has a zero-width silhouette, so every
leaf ends at a hard line and every petal reads as bent foil — which is exactly
what the browser was showing while Cycles, with the modifier still in the stack,
showed a plant. It is applied by hand now rather than left to `export_apply`,
so the armature is never in the stack while it happens.

**Texture space is not flower space.** The corolla's pale throat was drawn where
`bt < 0.135` — the first eighth of a lobe's *length*. But a lobe is a fan, and
`sin(pi * bt**0.55)**0.5` is already at 88% of full width by `bt = 0.10`. So the
throat was not a small disc at the middle of the flower, it was a wedge reaching
most of the way to the rim, and five of them meeting made a pale star that sat
across the face of every bloom through several rounds of blaming sheen,
specular and the environment map in turn. Anything meant to read as "near the
centre" has to be measured as a radius in the flower's own frame:

```python
fanw = np.sin(np.pi * np.maximum(bt, 0.0) ** 0.55) ** 0.5
rad  = np.sqrt(bt ** 2 + (su * fanw * 0.72) ** 2)
```

The general lesson, twice over: when the browser and Cycles disagree, the bug is
in the translation between them; when they agree and it still looks wrong, stop
adjusting the lighting and go and measure the map.

**Geometry with no UVs samples texel (0, 0).** `blob()` and `filament()` built
the anthers, the style and the corolla tube without ever writing to the UV
layer, so every loop sat at the origin of whatever map its material slot points
at. On the anthers that meant a flat colour no texture could fix; on the corolla
tube it meant the white of the throat, painted on the *outside* of the flower,
which is the pair of pale hexagons that were visible under every bloom.

## A violet has no trunk

Worth stating plainly, because the obvious fix was the wrong one.

Every petiole starts at `crown_at(...)`, which is a point off the axis at that
leaf's own height, and the older the leaf the higher that is. Nothing was drawn
between those attachment points and the compost, so from under the rosette the
plant was a bundle of tubes ending in mid-air. The first fix was to model the
stem they share as a solid tapered column — which is defensible botany and
completely wrong on the reference: a photograph of a Saintpaulia shows no trunk
at all, because the stalks are packed so tightly around it that they *are* the
stem. What you see is eighteen fleshy stalks converging into the soil.

So each leaf keeps its own attachment height — that is what stops neighbouring
petioles growing through one another — and carries its stalk the rest of the
way down, in toward the axis, and 5 mm under the surface. Eighteen of them
overlap near the middle, and that overlap is the point. The same goes for every
scape: a flower stalk leaves the compost almost upright and takes all its lean
in the last third, which is why a violet in bloom reads as a posy held up over
the foliage rather than as spokes stuck in a pot.

Two consequences worth knowing:

- **The clipping check has to be scoped to blades.** `LEAF_FACES` used to span
  the whole leaf, stalk included. Eighteen stalks converging on one point in
  the compost overlap by design, so the check went from 0 to 102 "intersecting
  pairs" overnight and would have buried a real one.
- **A stalk is not a tapered cylinder.** It is fleshy and swollen where it
  leaves the compost, and by the time it reaches the blade it has flattened and
  opened the channel the midrib sits in. The cross-section morphs between those
  two along its length — three cosines in the ring loop — and that, plus a
  wander pinned to zero at both ends, is most of the difference between a plant
  and a length of tapered pipe.

## Do not judge colour from the Blender render

This has now cost two rounds, on two different materials, for the same reason.

The authoring scene is lit by one hot area light under AgX. Under it the
anthers rendered as smooth cream beads and the petioles as salmon pink, and
both times the map underneath was exactly what had been asked for — the anthers
mean linear (0.53, 0.41, 0.09), a saturated gold, and the petioles (0.060,
0.018, 0.014), a dusky maroon. The render was blowing them out; nothing was
wrong with the texture.

Read the array, not the picture:

```python
img = bpy.data.images['web_stem_albedo']
px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
[round(float(px[row, :, i].mean()), 4) for i in range(3)]   # row 0 is v = 0
```

If the numbers are the colour you authored, the render is lying and the fix is
`scene.view_settings.exposure`, not the texture.

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

**Three things that were wrong are fixed** (Aug 2026): leaves no longer clip the
pot — the pot was a sealed cone with a lid on it, and the crown sat underneath
that lid; the petals had no UVs and no texture; and `make_image` reversed every
texture's rows, which ran all of them backwards down their own surface. There is
a `check_pot_clipping()` beside `check_clipping()` now, because the old check
only ever compared leaves with each other and could not see the pot at all.

**The wilt is still worth revisiting.** `droop` should make the outer leaves hang
down beside the pot like wet cloth, from the tip back, with the crown staying
upright. Instead eleven rigid blades close over the pot like a fist, and the pot
shows through the gaps. Two attempts at it:

1. Rotating the whole leaf at the crown — swung the leaves into the camera.
2. Rotating less, and curving the blade down along its length, and moving the
   attachment point out to the rim — better, still a dome.

`species/african-violet.md` explains why, and it is not the reason either
attempt assumed. A wilting violet does not droop uniformly:

> The OLDEST outer tier goes first ... the blade tips drop 3-6 cm and drape over
> the pot rim ... **The crown and the inner tier stay upright and level — this
> outside-in gradient is the diagnostic silhouette.**

`violet.py` droops every leaf by the same amount, so eleven blades rotate
together and close over the pot like a fist. There is no gradient, so there is
no silhouette to read. The fix is two things, not one:

1. **Droop by tier.** Leaf age is already implicit in the rosette index — the
   outer tier should take nearly all of the droop and the crown almost none.
2. **Bend, don't rotate.** A blade should curve along a three-segment bone
   chain, each segment rotating a little more than the last, so the leaf goes
   limp instead of tilting rigidly. The armature code for this is proven and
   just is not wired in yet.

Which is the argument for writing the specification before the model, rather
than after.

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
