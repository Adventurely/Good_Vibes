# Surfaces: maps, hair, and calibrating colour

## Contents

1. [Author arrays, not node graphs](#1-author-arrays-not-node-graphs)
2. [The texture-space trap](#2-the-texture-space-trap)
3. [Hair as shells](#3-hair-as-shells)
4. [Calibrate colour against the surface underneath](#4-calibrate-colour-against-the-surface-underneath)
5. [Scanned PBR for the room, painted for the props](#5-scanned-pbr-for-the-room-painted-for-the-props)

---

## 1. Author arrays, not node graphs

Every surface that is actually looked at gets three maps: albedo, height (turned
into a tangent-space normal on export, because glTF has no bump node), and
roughness. Author them as numpy arrays in the species file, keep them in
`TEX_ARRAYS`, and let the exporter re-encode.

The shape of a texture function:

```python
def stem_textures(n):
    u = np.linspace(0.0, 1.0, n)
    U, V = np.meshgrid(u, u, indexing='xy')
    fine = fbm((n, n), 40, octaves=3)      # per-texel grain
    ribs = fbm((n, n), 7, octaves=4)       # slow variation

    red = np.array([0.062, 0.019, 0.015])
    green = np.array([0.048, 0.079, 0.027])
    mix = smoothstep(0.72, 0.99, V)[..., None]
    col = red[None, None, :] * (1 - mix) + green[None, None, :] * mix
    col = col * (1.0 - 0.26 * (ribs - 0.5))[..., None]
    col = col * (1.0 + 0.26 * (fine - 0.5))[..., None]

    h = np.clip(0.5 + 0.46 * (fine - 0.5) + 0.30 * (ribs - 0.5), 0, 1)
    r = np.clip(0.68 + 0.18 * (fine - 0.5) - 0.06 * (ribs - 0.5), 0.42, 0.94)

    TEX_ARRAYS.update(stem_albedo=..., stem_height=h.copy(), stem_rough=r.copy())
    return (make_image(...), make_image(...), make_image(...))
```

Two noise scales — one fine, one slow — is enough for most organic surfaces. The
fine one breaks the highlight; the slow one stops it looking like film grain.

Resolution: match the organ's real size on screen. 1024 for a blade, 512 for a
petal (a fifth the size and there are five of them), 256 for an anther or a
stalk. It is not worth more texels than the thing can show.

## 2. The texture-space trap

**"Near the base" in UV is not "near the centre" of the organ.** This one cost
three rounds of blaming sheen, specular and the environment map in turn.

A corolla lobe is a fan, and its width function opens fast: at `bt = 0.10` — a
tenth of the way along — it is already at 88% of full width. So a throat drawn
where `bt < 0.135` was not a small disc at the middle of the flower; it was a
wedge reaching most of the way to the rim, and five of them meeting made a pale
star across every bloom.

Anything meant to read as "near the centre" has to be measured as a radius in the
organ's own frame:

```python
fanw = np.sin(np.pi * np.maximum(bt, 0.0) ** 0.55) ** 0.5
rad  = np.sqrt(bt ** 2 + (su * fanw * 0.72) ** 2)   # hw/sz averaged over lobes
tw   = (smoothstep(0.150, 0.020, rad) ** 1.7)[..., None]
```

The bright fraction of the map went from 8.2% to 1.6% and the star disappeared.

Relatedly: **the albedo and the normal map can fight.** Veins drawn dark in the
albedo and carved deep in the height map produce a lit ridge beside a dark
groove, which cancels the darkening and adds a highlight. If a feature is meant
to be subtle, it has to be subtle in *both*.

## 3. Hair as shells

Particle hair has no glTF representation. Sheen alone gives the soft response but
not the thing you actually see: a pale halo of separate hairs all round a leaf's
edge, which every photograph of a violet is full of.

A shell does carry. Duplicate the surface, push it out along its own normals,
punch it through with an alpha mask. It skins off the same armature, so it droops
with the organ under it.

**Two layers, not one.** A single layer can only be a texture lying on the
surface — everything it draws is at one height, so nothing overlaps anything and
the hairs have no length. Two at different heights, the far one sparser, give the
overlap that reads as depth, and it is the far one that puts separate lit hairs
on the silhouette:

```python
FUZZ_LAYERS = (
    (0.00072, (0.906, 0.866), (0.046, 0.112, 0.040, 1.0)),
    (0.00160, (0.968, 0.950), (0.062, 0.148, 0.055, 1.0)),
)
```

Practical notes:

- **Build the shell from the pre-Solidify surface.** With `offset = -1.0` the lit
  surface does not move, so a snapshot taken before applying still matches.
  Copying the finished mesh wraps the shell round the new underside too.
- **Offset matters.** At 1.1 mm the near shell stood far enough off the blade
  that the alpha cut it into visible shards rather than hairs. 0.72 mm hugs it
  and reads as velvet at every distance.
- **Roughness 0.95, specular 0.** At 0.62, ten thousand little quads under a
  bright sky each returned a specular pinpoint and the margins crawled with white
  speckle.
- **Cover the stalks too, not just the blades.** A petiole is as hairy as a leaf,
  and stalks are ~2.3k triangles against a blade's 24k, so it is nearly free.
  Leave petals and anthers bare: a petal carries its velvet in the material, and
  pollen is dust.
- **Blend, never threshold.** See `gltf-traps.md` §7 — this is the mipmap
  collapse that made the hairs brighten as the camera closed in.

## 4. Calibrate colour against the surface underneath

Never pick a hair colour, or any overlay colour, in the abstract. The fuzz was
painted `(0.105, 0.130, 0.082)` against a blade albedo of `(0.022, 0.057, 0.019)`
— 4.7× its red and 2.3× its green. So the hairs were not merely brighter than the
leaf, they were **desaturated against it**, which is a grey speck rather than a
pale hair.

Read the mean of the surface map and scale from it, keeping the hue. About 2×
near the surface and 2.5× at the tips lands a soft ~19% lift in value, which is
what velvet does:

```python
la = bpy.data.images['web_leaf_albedo']
px = np.array(la.pixels[:], dtype=np.float32).reshape(la.size[1], la.size[0], 4)
leaf = [float(px[..., i].mean()) for i in range(3)]
```

The blended result is worth computing before you ship it —
`hair * a + leaf * (1 - a)`, with `a` the mask's mean alpha, tells you exactly
how much the surface will lift.

## 5. Scanned PBR for the room, painted for the props

For the greenhouse and the garden, use CC0 scans (ambientCG, Poly Haven), not
canvas-painted textures. A hand-drawn albedo has no normal map and no roughness
map behind it, so every surface answers light identically and the whole room
reads as coloured cardboard however good the pattern is. That was the ceiling the
painted textures hit.

Painted is fine for something small enough that a scan would be wasted next to
the scanned brick — a flowerpot, say.

`repeat` is in metres of surface per tile, because `BoxGeometry` gives every face
a 0..1 UV regardless of how big that face is. A material shared across a 7 m wall
and a 0.6 m coping stone will smear on one of them, so anything needing a
different density gets its own texture instance; cloning a `Texture` shares the
image and costs only the transform.
