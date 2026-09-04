# Correct in Blender, wrong in the browser

A catalogue of translation failures, each of which shipped and each of which was
invisible in Cycles. If a material arrives in the viewer looking wrong, the
answer is almost certainly on this page.

## Contents

1. [Colour space](#1-colour-space)
2. [Procedural materials export as white](#2-procedural-materials-export-as-white)
3. [Sheen carries a colour, not a weight](#3-sheen-carries-a-colour-not-a-weight)
4. [Geometry with no UVs samples texel (0, 0)](#4-geometry-with-no-uvs-samples-texel-0-0)
5. [DoubleSide is not thickness](#5-doubleside-is-not-thickness)
6. [Applying modifiers to a skinned mesh](#6-applying-modifiers-to-a-skinned-mesh)
7. [Alpha modes, and why MASK is a trap](#7-alpha-modes-and-why-mask-is-a-trap)
8. [Materials rebuilt in the viewer lose their name](#8-materials-rebuilt-in-the-viewer-lose-their-name)
9. [Draco and WebP settings](#9-draco-and-webp-settings)
10. [Export options drift between Blender versions](#10-export-options-drift-between-blender-versions)

---

## 1. Colour space

Author every map as linear float and tag it `Non-Color`. That is right for
Cycles and **wrong for glTF**: a `baseColorTexture` is sRGB by definition, so a
browser handed linear numbers applies an sRGB decode a second time and everything
comes out lighter and flatter. That is exactly what "washed out" looks like.

Re-encode base colour on the way out. Normal and roughness maps stay `Non-Color`,
because those really are raw numbers.

```python
def as_image(name, rgb, srgb):
    """rgb is (N, N, 3) linear float with row 0 at v = 0."""
    n = rgb.shape[0]
    img = bpy.data.images.new(name, n, n, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    rgba = np.ones((n, n, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(rgb, 0.0, 1.0)
    img.pixels.foreach_set(np.ascontiguousarray(rgba).ravel())
    img.file_format = 'PNG'
    img.pack()
    return img
```

**Do not reverse rows.** `meshgrid` puts `bt = 0` in row 0, and the UVs assign
`bt = 0` to `v = 0`, so a flip runs every map backwards down its own surface. On
a leaf that merely reverses the midrib taper, which is subtle enough to go
unnoticed for weeks. On a petal it paints the pale throat across the tips, and
five of those meeting is a cream ring around every flower.

## 2. Procedural materials export as white

glTF has no procedural textures. A node-driven `Base Color` exports as the
socket's *unlinked default*, which is white. This is silent — Cycles renders
beautifully and the browser shows porcelain.

Two ways out, and prefer the first:

- **Bake to images.** Anything that is actually seen: anthers, petioles, blades,
  petals. Author arrays in the species file, stash them in `TEX_ARRAYS`, and
  build a `*_web` material in the exporter.
- **Flatten to the mean.** Only for props that are never inspected — the pot,
  the soil. Keep a `FLAT` dict of `(rgba, roughness)` and unlink the sockets.

The anthers were on the flat list, and a flat colour is the best a flat colour
can do: two smooth cream beads in the middle of every flower. They needed real
maps, and — the part that is easy to miss — real UVs to sample them with.

## 3. Sheen carries a colour, not a weight

`KHR_materials_sheen` has `sheenColorFactor` and `sheenRoughnessFactor`. There
is nowhere to put a weight. Blender's exporter writes **Sheen Tint** and drops
Sheen Weight on the floor, and three.js sets `material.sheen = 1` whenever the
extension is present.

So a carefully-chosen `Sheen Weight = 0.30` arrives at full strength, and a tint
left at Blender's default white ships as `sheenColorFactor: [1, 1, 1]` — a
full-strength white gloss over the whole surface. That is the glare.

Set the tint in Blender so the *file* is sane, and set the strength in the viewer
where it can actually be expressed:

```python
for k, v in (('Sheen Weight', 0.30), ('Sheen Roughness', 0.42),
             ('Sheen Tint', (0.22, 0.16, 0.34, 1.0))):
    if k in bsdf.inputs:
        bsdf.inputs[k].default_value = v
```

```js
if (/petal/i.test(m.name || '')) {
  m.sheen = 0.12; m.sheenRoughness = 0.75;
  if (m.sheenColor) m.sheenColor.setRGB(0.22, 0.16, 0.34);
  m.specularIntensity = 0.03; m.envMapIntensity = 0.45;
}
```

Every material with any sheen at all needs its tint set. The stems were missed
in one pass and shipped white gloss for a commit.

## 4. Geometry with no UVs samples texel (0, 0)

Easy to forget on helper builders. `blob()` and `filament()` made the anthers,
the style and the corolla tube without ever writing to the UV layer, so every
loop sat at the origin of whatever map its material slot pointed at.

On the anthers that meant one flat colour, which no amount of texture work could
fix. On the corolla tube it meant the *white of the throat*, painted on the
outside of the flower — a pair of pale hexagons visible under every bloom.

Write UVs in every builder, keyed by vertex rather than by loop order, and use
`k + 1` rather than `(k + 1) % RING` on the seam column so it gets `u = 1`
instead of wrapping the map backwards in one strip:

```python
corners = ((ring[a][k],                k,     a),
           (ring[a][(k + 1) % ES],     k + 1, a),
           (ring[a + 1][(k + 1) % ES], k + 1, a + 1),
           (ring[a + 1][k],            k,     a + 1))
f = bm.faces.new(tuple(v for v, _, _ in corners))
want = {v: (uu / ES, v0 + (v1 - v0) * vv / ES) for v, uu, vv in corners}
for lp in f.loops:
    lp[uvl].uv = want[lp.vert]
```

Give each builder a `uv=(v0, v1)` range so a part can sample a chosen band of a
shared map — the corolla tube takes `(0.46, 0.76)`, mid-petal violet, because
that is the colour the back of a corolla actually is.

## 5. DoubleSide is not thickness

`side: THREE.DoubleSide` lets you *see* the back of a surface. It does not give
that surface an edge. A blade or a petal with no thickness has a zero-width
silhouette, so every leaf ends at a hard line and every petal reads as bent foil.

Solidify has to be applied. Thickness is per material, because a plant is not
made of one substance:

```python
SHELL_W = {0: 1.00,   # blade — fleshy, about a millimetre
           2: 0.34,   # corolla lobe — a third of that
           1: 0.0,    # stems: closed tubes, nothing to add inside them
           3: 0.0}    # anthers: closed spheres, likewise
```

`offset = -1.0` so it grows *inward* and the lit surface does not move — which
matters because the hair shells are positioned relative to that surface. Weight-0
slots come through as a coincident reversed duplicate of themselves, so weld them
back afterwards:

```python
bmesh.ops.remove_doubles(_bm, verts=_bm.verts[:], dist=1e-6)
bmesh.ops.dissolve_degenerate(_bm, dist=1e-6, edges=_bm.edges[:])
```

Subdivision stays off. It quadruples every face on the plant *and* on the shells
that copy it, for smoothing Draco's normal quantisation would eat half of.

### Turn Even Thickness OFF, and measure that you did

`use_even_offset` divides the offset by the sine of the angle between adjacent
faces, so a folded surface keeps its thickness *through* the fold. On gentle
geometry it is free. On anything tightly creased the divisor goes to nothing and
the modifier throws vertices into the next postcode.

The daylily shipped for a month with every collapsed flower as a spiky origami
crane, because a spent tepal is hooked right round and then twisted — nothing but
acute creases. Measured over the whole plant, a **0.4 mm shell displaced vertices
by up to 62 mm.** It cost the open flowers 24 mm too; they simply carried it
better, which is why one bloom looked beautiful and the one below it looked
folded. `solidify_mode = 'NON_MANIFOLD'` is not the answer either — 41 mm on the
same geometry. Plain extrude is: 0.0004 m, which is the shell.

What you give up is real and invisible: a shell measured along the normal rather
than perpendicular to the fold, so a crease is thinner than the flat either side
of it by the cosine of half its angle. On a millimetre of leaf that is nothing.

**This is the trap's real shape, and it is why it survived so long: the render
everybody looks at is the species file, and the species file never runs the
exporter.** Cycles showed a correct, shrivelled little flower the whole time.
Only the GLB had spikes. So put a number on it, in the build report:

```python
_pre = KDTree(len(plant.data.vertices))          # before the modifier
for i, v in enumerate(plant.data.vertices):
    _pre.insert(v.co, i)
_pre.balance()
...
worst = max(_pre.find(v.co)[2] for v in plant.data.vertices)   # after
result['shell_displacement_max'] = round(worst, 5)
```

A shell of `thickness` must not move any vertex further than `thickness` off the
surface it was built on. Both species read exactly their own shell now — the
daylily 0.0012, the violet 0.0011. Anything larger is the modifier inventing
geometry, and no screenshot of the authoring render will ever show it to you.

## 6. Applying modifiers to a skinned mesh

Do not rely on `export_apply=True` for a mesh with an armature. Apply Solidify by
hand, with the armature never in the stack while it happens, so the skin cannot
get baked in by accident:

```python
for ob in bpy.context.view_layer.objects:
    ob.select_set(False)
plant.select_set(True)
bpy.context.view_layer.objects.active = plant
bpy.ops.object.modifier_apply(modifier=_sol.name)
```

Blender warns "Applied modifier was not first"; that is expected and harmless.

**An unweighted vertex inside a skinned mesh collapses to the origin.** Anything
that does not deform — a crown, a prop, a pot — belongs in a separate object, not
in the plant's mesh.

## 7. Alpha modes, and why MASK is a trap

Blender 5 removed the `CLIP` blend mode its exporter turned into `alphaMode:
MASK`, so masks come over as `BLEND` whatever you do.

Do not "fix" that by forcing `alphaTest` in the viewer. **A threshold does not
survive mipmapping.** The fraction of a binary noise mask that passes a threshold
collapses as the mip chain averages it toward its mean — measured on the violet's
fuzz mask against `alphaTest = 0.35`:

| mip | texels | passing |
|---|---|---|
| 0 (close) | 512² | 13.4% |
| 1 | 256² | 8.2% |
| 2 | 128² | 0.7% |
| 3+ (far) | 64² | 0% |

So the hairs did not exist at a distance and covered an eighth of the leaf up
close. The user's report was "they get brighter as I zoom in", which is exactly
what that table says.

Linear blending has no threshold to collapse: the pixel is
`hair * a + leaf * (1 - a)`, and averaging `a` down the mip chain averages the
result with it, so the mix is identical at every distance and only *structure*
changes with zoom. `depthWrite` must go off with it — a blended surface that
writes depth discards everything behind it.

```js
if (/fuzz/i.test(m.name || '')) {
  m.transparent = true; m.alphaTest = 0; m.depthWrite = false;
  m.envMapIntensity = 0.25;
  if (m.map) m.map.anisotropy = 8;
}
```

## 8. Materials rebuilt in the viewer lose their name

The mesh exports as one primitive per material slot, and GLTFLoader turns those
into separate meshes. Picking "the" skinned mesh out of a traverse lands on
whichever came last — match on the *material*, wherever it turns up.

And when you rebuild a material (e.g. `MeshStandardMaterial` →
`MeshPhysicalMaterial` so it can carry sheen), **give the new one a name.**
Anonymous, it matches none of the `/petal/i`-style overrides and silently keeps
three.js defaults for everything not listed — which is how a blade ended up with
`specularIntensity: 1` answering the greenhouse sky like polished stone.

## 9. Draco and WebP settings

```python
export_draco_mesh_compression_enable=True,
export_draco_mesh_compression_level=7,
export_draco_position_quantization=14,
export_draco_normal_quantization=10,
export_draco_texcoord_quantization=12,
export_draco_generic_quantization=12,   # joints and weights ride here; below
                                        # ~12 the skin pops on outer leaf bones
export_image_format='WEBP',
export_image_quality=92,
```

Textures dominate. Measure the split before optimising: on the violet, geometry
was 15% of the file and the maps 82%, so Draco alone moved 7.6 MB to 6.6 MB and
WebP did the rest.

A pure binary noise mask is close to incompressible — the pair of 1024² fuzz
masks were 205 KB of an 870 KB file. 512 is both cheaper and more truthful: a
texel across a 40 mm blade is then about 0.08 mm, which is the width of a real
hair.

## 10. Export options drift between Blender versions

One unknown key is a `TypeError` that takes the whole export down. Filter against
what this build actually understands, and *report* what was dropped rather than
silently falling back to a core set:

```python
_props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
dropped = sorted(k for k in opts if k not in _props)
bpy.ops.export_scene.gltf(**{k: v for k, v in opts.items() if k in _props})
```

The same applies to view settings. `'AgX - Medium Contrast'` is not a valid look
name and failed silently inside a shared `try`, taking the exposure line with it.
Set one thing per `try`.
