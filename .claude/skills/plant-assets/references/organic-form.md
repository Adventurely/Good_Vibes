# Geometry that reads as grown

The complaint that drove most of this was "quick cylinders with a draft on them".
What follows is the set of moves that reliably reads as a plant instead. None of
them is expensive; most are a few lines inside a loop you are already writing.

## Contents

1. [Winding decides normals, and normals decide everything else](#1-winding-decides-normals-and-normals-decide-everything-else)
2. [Cross-sections change along their length](#2-cross-sections-change-along-their-length)
3. [Paths wander, pinned at both ends](#3-paths-wander-pinned-at-both-ends)
4. [Thickness is not monotonic](#4-thickness-is-not-monotonic)
5. [Close every tube](#5-close-every-tube)
6. [Build from endpoints, never from guessed rotations](#6-build-from-endpoints-never-from-guessed-rotations)
7. [Botanical specifics that pay for themselves](#7-botanical-specifics-that-pay-for-themselves)
8. [Scale is the dimension](#8-scale-is-the-dimension)

---

## 1. Winding decides normals, and normals decide everything else

Which way round a grid's quads are wound falls out of whatever frame the surface
was built in. Nobody checks it, because on a double-sided material a flipped
normal is invisible — until something *uses* the normal. Two things do:

- **Solidify grows away from it**, so thickness lands on the wrong side.
- **Hair shells are pushed along it**, so every hair ends up under the leaf.

The violet's blade faced the floor for a commit, and the symptom reported was
"the hairs are only on the underside of the leaves". Same bug.

Decide the winding from the geometry rather than inheriting it:

```python
ai, bi = U // 2, V // 2
e_b = grid[ai][bi + 1].co - grid[ai][bi].co
e_a = grid[ai + 1][bi].co - grid[ai][bi].co
up_hint = (W(0.0, 0.0, 1.0) - W(0.0, 0.0, 0.0)).normalized()
quad = (((0, 0), (0, 1), (1, 1), (1, 0)) if e_b.cross(e_a).dot(up_hint) >= 0
        else ((0, 0), (1, 0), (1, 1), (0, 1)))
for a in range(U - 1):
    for b_ in range(V - 1):
        f = bm.faces.new(tuple(grid[a + da][b_ + db] for da, db in quad))
```

Sample mid-surface, not at a corner — corners are where the geometry is
degenerate. Do the same for petals against `face_up`. For closed solids built
independently, `bmesh.ops.recalc_face_normals` is the shortcut.

**Verify it**, don't assume: compare the bounding box of the shell against the
bounding box of the surface it sits on. If the shell's maximum is *below* the
surface's, the normals point the wrong way.

## 2. Cross-sections change along their length

This is the single biggest difference between a stalk and a length of tapered
pipe, and it costs three cosines.

A Saintpaulia petiole is round and swollen where it leaves the compost; by the
time it reaches the blade it has flattened and opened the channel the midrib sits
in. Morph between those two states as a function of position along the tube:

```python
_t = _i / _n
gr = GROOVE * (0.10 + 0.90 * _t ** 1.4)     # channel deepens toward the blade
flat = 0.05 + 0.13 * _t                     # and the section flattens
for k in range(RING):
    th = k / RING * math.tau                # th = 0 is the upper face
    d = abs(((th + math.pi) % math.tau) - math.pi)
    rr = R0 * rs * (1.0 - gr * math.exp(-(d / 0.62) ** 2))
    rr *= 1.0 + flat * math.cos(2 * th)
    rr *= 1.0 + 0.035 * math.cos(5 * th + _t * 2.2 + GROOVE * 9.0)  # flutes
```

Three ingredients, each doing separate work:

- **A gaussian notch** at one angle → a channel or groove. `d` is the wrapped
  angular distance from "up", so the groove stays on the upper face wherever the
  tube bends.
- **`cos(2·th)`** → an ellipse; make it grow along the length and the section
  flattens as it climbs.
- **A higher harmonic that drifts** (`cos(5·th + f(t))`) → shallow flutes that
  rotate as they rise, so the tube is not a surface of revolution.

For the frame, project world up perpendicular to the tangent so the groove keeps
facing up as the tube bends:

```python
ref = Vector((1, 0, 0)) if abs(tan.z) > 0.94 else Vector((0, 0, 1))
uu = (ref - tan * ref.dot(tan)).normalized()
ww = tan.cross(uu).normalized()
```

Give each instance its own `GROOVE` from `rnd` so no two organs are identical.

## 3. Paths wander, pinned at both ends

A dead-straight stalk is the giveaway that it was extruded. But a wander that
does not return to zero moves the endpoints, and the endpoints usually have to be
exact — the base enters the compost, the tip meets the blade. Pin it:

```python
_side = Vector((math.cos(_ph), math.sin(_ph), 0.0))
for _i, (pt, rs, sv) in enumerate(raw):
    _s = _i / (len(raw) - 1)
    stalk.append((pt + _side * (_amp * math.sin(_s * math.pi) ** 0.9
                                * math.sin(_s * 2.7 + _ph)), rs, sv))
```

`sin(s·π)` is zero at both ends and 1 in the middle; the second sine gives the
shape of the wander; `_ph` is a per-organ random phase.

Apply one wander over the *whole* path, in world space, after assembling it. Two
wanders on two segments will not match at the junction and you get a kink.

For a path with a required start and end, a quadratic Bézier with a control point
that fixes the *departure direction* is usually all you need. A flower stalk that
leaves the compost near-vertical and takes all its lean in the last third reads
as a posy held over the foliage; a straight line from base to head reads as a
spoke stuck in a pot:

```python
ctrl = Vector((base.x * 0.80 + top.x * 0.20,
               base.y * 0.80 + top.y * 0.20,
               base.z + (hgt - base.z) * 0.74))
def scape_pt(sv):
    return base * ((1 - sv) ** 2) + ctrl * (2 * (1 - sv) * sv) + top * (sv * sv)
```

## 4. Thickness is not monotonic

A linear taper is a draft angle. Real organs swell and narrow:

```python
raw.append((W(0.0, y, z), 1.00 - 0.28 * t + 0.09 * math.sin(t * math.pi), sv))
```

Thickest at the base, a slight swelling a third of the way up, a real narrowing
where the next organ takes over. Peduncles carry a node swelling where the
pedicels come off. Petioles are fleshiest where they leave the soil.

## 5. Close every tube

Every open tube on this plant turned out to be visible from somewhere. Cap both
ends of every extrusion — a cap is one n-gon and costs nothing:

```python
if prev is None:
    cap = bm.faces.new(tuple(reversed(ring)))   # note the reversal
    cap.material_index = SLOT_STEM
else:
    ...
prev = ring
_cap = bm.faces.new(tuple(prev))                # and the far end
```

"Hidden by something else" is not the same as closed. Put the boundary-edge count
in the build report and keep it at zero — see `verification.md`.

## 6. Build from endpoints, never from guessed rotations

This has failed twice on props and the failure is always the same shape: apply a
rotation that seems right, look at it from one angle, ship it. A watering can
whose spout mouth sat above its rim. Twenty-six roof rafters floating diagonally,
because the roof *plane's* rotation was applied to boxes whose length ran along a
different axis.

Write a `strut(a, b, w, h, mat)` that takes two endpoints and works out its own
orientation. Then the thing physically connects the two points it is supposed to
connect, and no angle of view can embarrass it.

## 7. Botanical specifics that pay for themselves

A handful of species-specific facts do more than any amount of general polish,
because they are what an eye uses to identify the plant:

- **Zygomorphy.** A Saintpaulia corolla is bilateral, not radial: two small
  dorsal lobes held back, three larger ventral ones fanned below, on a very short
  tube. Spacing five petals at 72° builds a periwinkle.
- **Enantiostyly.** The style is deflected hard left or right of the floral axis,
  a coin toss per flower. A hair of geometry, and the most specific thing about
  the bloom.
- **Where organs attach.** A violet has no visible trunk *because* every petiole
  and scape runs the whole way into the compost and they pack tight enough to be
  the stem. Get this wrong and the plant floats.
- **Presentation angle.** A violet presents its face outward and up. At 16° of
  lean every bloom was edge-on from any normal camera height and read as a flat
  purple plate.
- **The margin is not an arc.** Waves along the silhouette do more at small sizes
  than anything happening in the middle of a blade.

Look these up per species before modelling; `tools/greener-thumbs/species/` has
the research for the three planned ones.

## 8. Scale is the dimension

`bpy.ops.mesh.primitive_cube_add(size=1.0)` is already one unit across, so
scaling by `h / 2` halves it. A whole scene came out at half size that way. When
you build a `box(w, h, d, ...)` helper, make the scale *be* the dimension and
never think about it again.
