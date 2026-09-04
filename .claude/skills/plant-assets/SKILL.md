---
name: plant-assets
description: >-
  How to build a photorealistic, parametric plant asset for Greener Thumbs —
  authored in Blender with bpy/bmesh, exported as a Draco+WebP GLB, and rendered
  in the three.js greenhouse. Covers the whole pipeline: parameter dicts and
  placement solvers, geometry that reads as grown rather than extruded, hair
  shells, texture authoring, the Blender-to-glTF translation traps that make a
  model look right in Cycles and wrong in the browser, and the objective build
  checks that catch all of it without a screenshot. Use this whenever the task
  touches a plant asset in this repo — a new species (daylily, daffodil, and
  anything after), a new organ on an existing one, a change to violet.py or
  export_web.py or the viewer's plant materials, or a complaint about how a
  plant looks in the game. Also use it for any "correct in Blender, wrong in the
  browser" symptom, for anything about leaves, petals, petioles, stems, roots,
  flowers, fuzz, velvet, wilt or bloom geometry, and any time a plant needs to
  be compared against a photograph. Reach for it even when the request sounds
  like a small fix — most of the bugs it documents looked like small fixes.
---

# Building a plant asset

The African violet in `tools/greener-thumbs/violet.py` is the reference
implementation. Everything below was learned by getting it wrong first, usually
in a way that was invisible in the place it was authored. Read this before
touching a plant, and read the reference file for whatever part you are working
on.

## The pipeline

Three files, three jobs, and the seams between them are where the bugs live.

| File | Job |
|---|---|
| `tools/greener-thumbs/<species>.py` | The plant itself, as numbers. Runs in Blender, builds one bmesh + an armature, authors its own texture arrays. Renders in Cycles. |
| `tools/greener-thumbs/export_web.py` | Translation. Re-encodes maps for glTF, bakes procedural materials into images, applies modifiers, builds the fuzz shells, writes the GLB. |
| `public/greener-thumbs/play.html` | The viewer. Per-material overrides that glTF cannot express, lighting, droop. |

`tools/greener-thumbs/species/shared-parameter-model.md` is the agreed parameter
vocabulary across violet / daylily / daffodil. Read it before inventing a new
parameter name — the simulation binds to those names, and a species that invents
its own is a species the care model cannot drive.

## The one rule

**When it looks right where you authored it and wrong where it ships, the bug is
in the translation. When both agree and it still looks wrong, stop adjusting the
lighting and go and measure the map.**

Nearly every defect in this asset's history was one of those two. The pale star
across every flower survived three rounds of sheen, specular and environment
tuning because it was in the albedo. The anthers looked like cream beads in
Cycles while their texture was a saturated gold, because the key light was
blowing them out. Adjust what you have measured, not what you have looked at.

## Order of work

**1. Photographs first, and the photograph wins.** Botanical reasoning will
happily produce something a plant does not look like. A Saintpaulia's petioles
attach at different heights up a short stem, so a stem was modelled — a solid
tapered column, correct botany, and the one thing a photograph never shows,
because the stalks pack so tightly around it that they *are* the stem. When the
reference and the reasoning disagree, the reference is right and the reasoning is
missing something.

**2. The plant is a `P` dict of numbers, and condition is a point in it.** Not a
separate wilted model — `droop`, `chlorosis` and `bloom_open` are parameters the
same generator is run at. Anything a species needs that the shared vocabulary
does not have is a conversation about the vocabulary, not a local addition.

**3. Solve placement, then build — and solve it for every pose the plant has.**
Leaves that clip are a solver problem, not a modelling problem. `solve_rosette()` places every leaf by measuring the ones
already placed, `rim_safe_tilt()` raises only the blades that actually foul the
pot rim, `rosette_top()` measures the foliage so the flowers can clear it. The
rule that keeps this honest: **the solver and the mesh builder must call the same
function.** `blade_xyz()` is used by both, so they cannot disagree about where a
leaf is — and if they could, the solver would certify geometry it had never seen.

A rosette spaced only at rest is spaced for one pose out of the range the plant
actually occupies. Wilting rotates every leaf down about its own base, so leaves
that merely cleared each other standing up converge and pass through — and the
same rotation walks them straight through the pot. Both are budget problems with
the same shape as `rim_safe_tilt`: solve **how far each organ may fall** before
it comes to rest on the rim, or on the organ beneath it, and clamp there. A real
leaf does the same thing; it drapes over the rim rather than through it.

Two traps in that budget, both of which cost a round:

* Test for **passing through**, not for proximity. "Overlapping in plan and
  within `gap` in height" flags two leaves lying against each other, which is
  what a rosette does at rest and much more of when it wilts. Clamp on that and
  the plant stops drooping at all. The test that works is a change of side:
  where they overlap, take the sign of the height difference in the undrooped
  pose and fail it only when that sign reverses.
* The viewer drives the rig **live off a slider**, so a budget solved in Blender
  has to reach it. Object custom properties export as glTF node `extras` and
  bone ones do not — put the per-organ limits on the armature object as a list
  and set `export_extras=True`, or the render stays honest while the browser
  goes on clipping.

**And flowers wilt with the leaves.** The shared parameter model calls out scape
lodging and a daffodil gooseneck by name — one wilt rig, every organ. A plant
whose foliage has collapsed while its blooms stand up straight is the clearest
possible tell that the wilt is a rig effect rather than a plant, and it is what
both species did until somebody looked.

**4. Build organs that have grown.** See `references/organic-form.md`. The short
version: a tapered cylinder is never right, cross-sections change along their
length, paths wander, and every tube is closed at both ends.

**5. Author surfaces as maps, not as node graphs.** See `references/surfaces.md`.
glTF has no procedural textures, so anything driven by a noise node ships as the
socket's unlinked default.

**6. Translate deliberately.** See `references/gltf-traps.md`. This is the
longest reference because it is where the most time has been lost.

**7. Verify by measurement.** See `references/verification.md`, and use
`scripts/mesh_checks.py`.

## The build report is the deliverable, not the render

Every export prints a dict. Treat a new entry in it as the way you close out a
bug class permanently — a screenshot proves one camera angle at one moment; a
number in the build report is checked on every build forever.

The violet's report carries, and a new species should carry the same:

```python
result = {
    'bytes': ...,
    'verts': ...,
    'materials': [m.name for m in plant.data.materials],
    'clipping_pairs': ...,             # organ-vs-organ intersections
    'boundary_edges_by_slot': {...},   # open holes, per material slot
    'unsupported_export_options': [],  # options this Blender build dropped
    'shell_displacement_max': ...,     # a shell must not move the surface
                                       # further than the shell — see gltf-traps
    'leaf_pairs_at_droop_1': ...,      # the checks above, on the DEFORMED mesh,
    'leaves_in_pot_at_droop_1': ...,   # at both ends of the condition range
}
```

Each of those exists because something shipped broken and nobody could see it:

- **`clipping_pairs`** — leaves passing through each other, and separately
  through the pot. Scope it to the organ you mean: when the petioles started
  converging in the compost, a check that spanned the whole leaf went from 0 to
  102 "intersections" overnight, all of them by design. A check that cries wolf
  is worse than no check, so `LEAF_FACES` records blade faces only.
- **`boundary_edges_by_slot`** — a boundary edge is a hole. Every open tube on
  this plant turned out to be visible from somewhere: petiole bases from under
  the rosette, the corolla tube from behind a bloom, the scape at the join. It
  should read `{}`.
- **`materials`** — that the slots hold the *web* materials, not the Cycles ones.
  A silent failure here is how the anthers shipped white.

## Budget

**Measure the split before optimising it, and measure it again later** — the
answer moves. On the violet's first pass textures were 82% of the file and
geometry 15%, so Draco alone took 7.6 MB to 6.6 MB and no further while Draco
*plus* WebP took it to 428 KB. Today the same asset is 897 KB and the split has
inverted: 215 KB of images against 682 KB of everything else, because thickness,
two hair shells and finer stalks all landed on the geometry side. Optimising the
textures now would be work aimed at a quarter of the file.

`mesh_checks.glb_summary(path)` prints the split. Run it before deciding what to
cut.

## References

Read the one that matches what you are doing. They are catalogues; you do not
need all of them at once.

- **`references/gltf-traps.md`** — everything that is correct in Blender and
  wrong in the browser: colour space, procedural materials, sheen, UVs,
  modifiers, alpha modes, Draco settings. Read this before writing any part of
  an exporter, and read it again when a material arrives looking wrong.
- **`references/organic-form.md`** — what makes geometry read as grown: winding
  and normals, cross-sections that morph, wander pinned at both ends, closed
  tubes, and the botanical specifics that buy the most realism per vertex.
- **`references/surfaces.md`** — authoring texture arrays, the texture-space
  trap, hair shells, and calibrating colour against the surface underneath.
- **`references/verification.md`** — how to know a plant is right, including when
  you cannot take a screenshot.

## Bundled script

`scripts/mesh_checks.py` runs inside Blender and holds the checks that belong in
every species' build report — boundary edges, organ-vs-organ and organ-vs-prop
intersection, image colour means, and alpha coverage down the mip chain. Import
it from a species exporter rather than rewriting the BVH code:

```python
import sys; sys.path.insert(0, r"<repo>/.claude/skills/plant-assets/scripts")
import mesh_checks
result['boundary_edges_by_slot'] = mesh_checks.boundary_edges_by_slot(plant.data)
result['clipping_pairs'] = mesh_checks.self_intersections(me, BLADE_FACES)
```
