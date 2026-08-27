"""Export the violet as a single self-contained GLB for the browser viewer.

Run inside Blender. This builds the plant via `violet.py`, swaps the leaf
material for one the glTF spec can actually carry, and writes
`public/greener-thumbs/violet.glb` with geometry, skeleton, the wind clip and
all textures embedded.

Three things are deliberate:

**Solidify is applied; Subdivision is not.** Subdivision at render level would
ship a quarter of a million vertices to a web page. Solidify has to be applied,
and used not to be, on the stated grounds that `side: DoubleSide` in three.js
did the same job for free — it does not. Double-sided rendering lets you see
the back of a surface; it does not give that surface an edge, and without one
every leaf and petal came out of the browser as bent foil. It is applied here
rather than left to `export_apply`, so the armature is never in the stack while
it happens and the skin cannot get baked in by accident.

**Textures are re-encoded, not reused.** `violet.py` authors its maps as linear
float and marks them Non-Color, which is right for Cycles and wrong for glTF.
Base colour has to be sRGB, and the height map has to become a tangent-space
normal map, because glTF has no bump node.

**Hair is off, and shells stand in for it.** Particle hair has no glTF
representation, so the blade is duplicated twice, pushed out along its normals
and punched through with an alpha mask. See the fuzz section below.
"""
import bpy, bmesh, os, sys
import numpy as np

# `__file__` is not set when this is exec'd with a fresh globals dict, which is
# how the Blender MCP bridge runs it. Fall back to an explicit override.
_self = globals().get('__file__') or (globals().get('EXPORT_P') or {}).get('here')
if not _self:
    raise RuntimeError("set EXPORT_P['here'] to this file's path, or run with __file__")
HERE = os.path.dirname(os.path.abspath(_self))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_DIR = os.path.join(REPO, 'public', 'greener-thumbs')

VIOLET_P = {
    'fuzz': 0,            # no glTF representation; sheen stands in for it
    'wind': 0.0,          # no wind clip is exported; see export_animations below
    'droop': 0.0,
    'engine': 'CYCLES',
}
_over = dict(globals().get('EXPORT_P') or {})
VIOLET_P.update(_over.pop('violet', {}))

g = dict(globals())
g['VIOLET_P'] = VIOLET_P
_src = os.path.join(HERE, 'violet.py')
exec(compile(open(_src, encoding='utf-8').read(), _src, 'exec'), g)

TEX = g['TEX_ARRAYS']
plant, rig = g['plant'], g['rig']
scene = bpy.context.scene


# ---- textures the spec can carry ------------------------------------------
def as_image(name, rgb, srgb):
    """rgb is (N, N, 3) linear float with row 0 at v=0, as `violet.py` authors it.

    Blender applies the colour transform on save, so writing linear values into
    an image tagged sRGB produces a correctly encoded file, and tagging it
    Non-Color writes the raw numbers — which is what a normal or roughness map
    needs.

    No row reversal, for the same reason `make_image` no longer does one: these
    maps are authored in the direction the UVs run, and flipping them ran every
    map backwards down its own surface.
    """
    n = rgb.shape[0]
    img = bpy.data.images.new(name, n, n, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    rgba = np.ones((n, n, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(rgb, 0.0, 1.0)
    img.pixels.foreach_set(np.ascontiguousarray(rgba).ravel())
    img.file_format = 'PNG'
    img.pack()
    return img


def normal_from_height(h, strength=2.6):
    """Tangent-space normal map. glTF has no bump node, so the height field has
    to be differentiated here instead of in the shader."""
    gy, gx = np.gradient(h.astype(np.float64))
    nx, ny = -gx * strength * h.shape[0] / 512.0, -gy * strength * h.shape[0] / 512.0
    nz = np.ones_like(nx)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx * inv * 0.5 + 0.5,
                     ny * inv * 0.5 + 0.5,
                     nz * inv * 0.5 + 0.5], axis=-1)


IMG_ALB = as_image("web_leaf_albedo", TEX['albedo'], srgb=True)
IMG_NRM = as_image("web_leaf_normal", normal_from_height(TEX['height']), srgb=False)
IMG_RGH = as_image("web_leaf_rough",
                   np.repeat(TEX['rough'][..., None], 3, axis=-1), srgb=False)


# ---- a leaf material glTF understands --------------------------------------
mat = bpy.data.materials.new("violet_leaf_web")
mat.use_nodes = True
nt = mat.node_tree
b = nt.nodes["Principled BSDF"]

ta = nt.nodes.new('ShaderNodeTexImage'); ta.image = IMG_ALB; ta.location = (-700, 260)
tr = nt.nodes.new('ShaderNodeTexImage'); tr.image = IMG_RGH; tr.location = (-700, 0)
tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = IMG_NRM; tn.location = (-700, -260)
tn.image.colorspace_settings.name = 'Non-Color'
nm = nt.nodes.new('ShaderNodeNormalMap'); nm.location = (-420, -260)
nm.inputs['Strength'].default_value = 1.0

nt.links.new(ta.outputs['Color'], b.inputs['Base Color'])
nt.links.new(tr.outputs['Color'], b.inputs['Roughness'])
nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
b.inputs['Metallic'].default_value = 0.0
# Sheen Tint for the same reason it is set on the corolla below: the exporter
# writes KHR_materials_sheen's *colour* and throws the weight away, and
# Blender's default tint is white. This blade was shipping sheenColorFactor
# [1, 1, 1] — a full-strength white gloss over every leaf, which under a
# greenhouse sky is a sheet of glare rather than velvet.
for k, v in (('Sheen Weight', 0.35), ('Sheen Roughness', 0.45),
             ('Sheen Tint', (0.30, 0.34, 0.24, 1.0))):
    if k in b.inputs:
        b.inputs[k].default_value = v

# ---- and the same treatment for the corolla ---------------------------------
"""The petals were washing out in the browser and were correct in Blender, and
the reason is the colour space rather than the colour.

`violet.py` authors every map as linear float and tags it Non-Color, which is
right for Cycles. The blade already gets re-encoded on the way out — that is
what `as_image` is for — but the petal maps were going straight into the GLB
still tagged Non-Color. glTF has no such tag: a baseColorTexture is sRGB by
definition, so the browser took linear numbers and applied an sRGB decode to
them a second time. Everything came out lighter and flatter than authored,
which is exactly what "washed out" looks like.
"""
IMG_PALB = as_image("web_petal_albedo", TEX['petal_albedo'], srgb=True)
IMG_PNRM = as_image("web_petal_normal", normal_from_height(TEX['petal_height'], 0.9), srgb=False)
IMG_PRGH = as_image("web_petal_rough",
                    np.repeat(TEX['petal_rough'][..., None], 3, axis=-1), srgb=False)

pmat = bpy.data.materials.new("violet_petal_web")
pmat.use_nodes = True
pnt = pmat.node_tree
pb = pnt.nodes["Principled BSDF"]
pa = pnt.nodes.new('ShaderNodeTexImage'); pa.image = IMG_PALB; pa.location = (-700, 260)
pr = pnt.nodes.new('ShaderNodeTexImage'); pr.image = IMG_PRGH; pr.location = (-700, 0)
pn = pnt.nodes.new('ShaderNodeTexImage'); pn.image = IMG_PNRM; pn.location = (-700, -260)
pn.image.colorspace_settings.name = 'Non-Color'
pnm = pnt.nodes.new('ShaderNodeNormalMap'); pnm.location = (-420, -260)
pnt.links.new(pa.outputs['Color'], pb.inputs['Base Color'])
pnt.links.new(pr.outputs['Color'], pb.inputs['Roughness'])
pnt.links.new(pn.outputs['Color'], pnm.inputs['Color'])
pnt.links.new(pnm.outputs['Normal'], pb.inputs['Normal'])
pb.inputs['Metallic'].default_value = 0.0
# NOTE: 'Sheen Weight' does not survive to the browser as a strength.
# KHR_materials_sheen carries a colour and a roughness, and three.js sets
# `material.sheen = 1` whenever the extension is present — the weight has to
# live in the colour instead. The viewer sets the final values; these are only
# what Blender previews with.
# What the exporter writes is Sheen *Tint*, as `sheenColorFactor` — the weight
# is dropped on the floor. Left at Blender's default white it exports as
# [1,1,1], which is a full-strength white gloss over the whole petal: the
# glare. A dark violet tint means the file itself is sane even before the
# viewer clamps the strength.
for k, v in (('Sheen Weight', 0.30), ('Sheen Roughness', 0.42),
             ('Sheen Tint', (0.22, 0.16, 0.34, 1.0)),
             ('Specular IOR Level', 0.05)):
    if k in pb.inputs:
        pb.inputs[k].default_value = v

# slot 2 is the corolla — see SLOT_PETAL in violet.py
plant.data.materials[2] = pmat

# slot 0 is the blade — see SLOT_LEAF in violet.py
plant.data.materials[0] = mat

# ---- and the anthers, which are the middle of every flower ------------------
IMG_EALB = as_image("web_eye_albedo", TEX['eye_albedo'], srgb=True)
IMG_ENRM = as_image("web_eye_normal", normal_from_height(TEX['eye_height'], 2.0), srgb=False)
IMG_ERGH = as_image("web_eye_rough",
                    np.repeat(TEX['eye_rough'][..., None], 3, axis=-1), srgb=False)

emat = bpy.data.materials.new("violet_eye_web")
emat.use_nodes = True
ent = emat.node_tree
eb = ent.nodes["Principled BSDF"]
ea = ent.nodes.new('ShaderNodeTexImage'); ea.image = IMG_EALB; ea.location = (-700, 260)
er = ent.nodes.new('ShaderNodeTexImage'); er.image = IMG_ERGH; er.location = (-700, 0)
en = ent.nodes.new('ShaderNodeTexImage'); en.image = IMG_ENRM; en.location = (-700, -260)
en.image.colorspace_settings.name = 'Non-Color'
enm = ent.nodes.new('ShaderNodeNormalMap'); enm.location = (-420, -260)
ent.links.new(ea.outputs['Color'], eb.inputs['Base Color'])
ent.links.new(er.outputs['Color'], eb.inputs['Roughness'])
ent.links.new(en.outputs['Color'], enm.inputs['Color'])
ent.links.new(enm.outputs['Normal'], eb.inputs['Normal'])
eb.inputs['Metallic'].default_value = 0.0
# No sheen at all, and almost no specular. Pollen is dust: the one thing an
# anther must never do is catch a highlight.
if 'Specular IOR Level' in eb.inputs:
    eb.inputs['Specular IOR Level'].default_value = 0.06

# slot 3 is the anthers — see SLOT_EYE in violet.py
plant.data.materials[3] = emat

# The pot, rim and soil are procedural noise, and glTF has no procedural
# textures — a node-driven Base Color exports as the socket's unlinked default,
# which is white. Give them the mean of the colours they mix between, so the
# props at least read as terracotta and soil rather than porcelain.
FLAT = {
    'terracotta': ((0.228, 0.080, 0.041, 1.0), 0.82),
    'soil':       ((0.021, 0.015, 0.011, 1.0), 0.97),
    # The anthers used to be on this list, as a `noisy()` procedural flattened
    # to its mean. A flat colour is the best a flat colour can do, and what it
    # looked like was two cream beads: no grain, no slit, no relief. They are
    # image-mapped now, like the blade and the corolla, and `blob()` in
    # violet.py gives them the UVs to sample it with.
}
for m in bpy.data.materials:
    hit = next((v for k, v in FLAT.items() if m.name.startswith(k)), None)
    if not hit or not m.use_nodes:
        continue
    col, rough = hit
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if not bsdf:
        continue
    for sock in ('Base Color', 'Normal', 'Roughness'):
        for link in list(bsdf.inputs[sock].links):
            m.node_tree.links.remove(link)
    bsdf.inputs['Base Color'].default_value = col
    bsdf.inputs['Roughness'].default_value = rough

# ---- thickness -------------------------------------------------------------
"""Solidify is not redundant, and dropping it was the reason the plant looked
like it was cut out of paper.

The old note here said `side: DoubleSide` in three.js did the same job for
free. It does not. Double-sided rendering means you can *see* the back of a
surface; it does not give that surface an edge. A blade or a petal with no
thickness has a zero-width silhouette, so every leaf ends at a hard line and
every petal reads as a bent sheet of foil — which is exactly what it looked
like next to the Cycles render, where the same modifier was doing its job.

Thickness is per material, because the plant is not made of one substance. A
Saintpaulia leaf is fleshy, about a millimetre; a corolla lobe is a third of
that; the stems, the style and the anthers are closed tubes and spheres that
already have volume and need nothing added inside them.

Subdivision stays off. It quadruples every face on the plant *and* on the fuzz
shells that copy it, for smoothing that Draco's normal quantisation would eat
half of anyway. Thickness was the complaint; thickness is what this buys."""
SHELL_W = {0: 1.00,     # SLOT_LEAF  — the blade
           2: 0.34,     # SLOT_PETAL — a corolla lobe is much thinner
           1: 0.0,      # SLOT_STEM  — closed tubes, nothing to add
           3: 0.0}      # SLOT_EYE   — closed spheres, likewise
LEAF_THICK = 0.0011

# The fuzz shells below have to be built on the surface as it is *now*: with
# offset = -1 Solidify grows entirely inward, so this snapshot and the finished
# top surface stay in the same place, and the shells keep their clearance.
BASE_ME = plant.data.copy()

_w = {}
for poly in plant.data.polygons:
    f = SHELL_W.get(poly.material_index, 0.0)
    for vi in poly.vertices:
        _w[vi] = max(_w.get(vi, 0.0), f)
_vg = plant.vertex_groups.new(name="thickness")
for vi, w in _w.items():
    if w > 0.0:
        _vg.add([vi], w, 'REPLACE')

for m in list(plant.modifiers):
    if m.type == 'SUBSURF':
        plant.modifiers.remove(m)
_sol = next(m for m in plant.modifiers if m.type == 'SOLIDIFY')
_sol.thickness = LEAF_THICK
_sol.offset = -1.0                    # inward, so the lit surface does not move
_sol.use_even_offset = True
_sol.use_rim = True                   # the rim faces *are* the visible edge
_sol.use_rim_only = False
_sol.vertex_group = _vg.name
_sol.thickness_vertex_group = 0.0     # weight 0 means no thickness, not minimum

for ob in bpy.context.view_layer.objects:
    ob.select_set(False)
plant.select_set(True)
bpy.context.view_layer.objects.active = plant
bpy.ops.object.modifier_apply(modifier=_sol.name)

# The zero-weight slots came through as a duplicate of themselves in the same
# place — coincident, reversed, and z-fighting. Welding at a micron collapses
# those back into the single surface they were, and takes the degenerate poles
# of every `blob()` with them.
_bm = bmesh.new()
_bm.from_mesh(plant.data)
_before = len(_bm.faces)
bmesh.ops.remove_doubles(_bm, verts=_bm.verts[:], dist=1e-6)
bmesh.ops.dissolve_degenerate(_bm, dist=1e-6, edges=_bm.edges[:])
_welded = _before - len(_bm.faces)
_bm.to_mesh(plant.data)
_bm.free()
plant.data.polygons.foreach_set('use_smooth', [True] * len(plant.data.polygons))


# ---- the fuzz, as a shell ---------------------------------------------------
"""Particle hair has no glTF representation, so this used to ship nothing and
let the sheen term stand in for it. Sheen gives the soft response but not the
thing you actually see: a violet leaf has a pale halo of separate hairs all
round its edge, and every photograph of one is full of it.

Shells do carry. The blade is duplicated, pushed out along its own normals, and
punched through with an alpha mask, so what survives reads as thousands of
little hairs standing off the surface — most of all on the silhouette, which is
exactly where fuzz is visible and where a sheen term can never put anything.
Each shell skins off the same armature, so they droop with the leaf under them.

There are two of them now, and that is the difference between velvet and haze.
A single layer can only ever be a texture lying on the surface: everything it
draws is at one height, so nothing overlaps anything and the hairs have no
length. Two layers at different heights, the far one sparser, give the overlap
that reads as depth — and it is the far one, standing 1.6 mm off the blade,
that puts separate lit hairs on the silhouette instead of a fringe."""
# 512, not 1024. This is a pure binary noise mask, which is as close to
# incompressible as an image gets — the pair of them at 1024 were 205 KB of a
# 870 KB file, more than every other map on the plant put together. At 512 a
# texel across a 40 mm blade is about 0.08 mm, which is the width of an actual
# Saintpaulia hair, so the coarser map is also the more truthful one.
FUZZ_TEX = 512

# (offset, mask thresholds, base colour). The far shell keeps only hairs the
# near one already drew at full strength, so a hair is one object standing off
# the surface rather than two unrelated speckles at two heights.
FUZZ_LAYERS = (
    # 0.72 mm. At 1.1 on its own the shell stood far enough off the blade that
    # the alpha cut it into visible shards rather than into hairs.
    #
    # The thresholds were (0.855, 0.780), which is 22% of the blade covered in
    # pale flecks a millimetre above it — from any distance that is not velvet,
    # it is mould. And the near layer is the one seen face-on, so it is the one
    # that has to disappear into the leaf: it is only a shade lighter than the
    # blade under it now, and it is the far layer's job to be visible.
    #
    # Brightness is the other half of it. A hair is translucent, but it is also
    # 0.05 mm across, so what a pixel of leaf actually gets is a hair's colour
    # averaged with the blade behind it. Painted at four times the blade's own
    # albedo these read as frost on any leaf that was not in direct sun — most
    # of them, in a greenhouse — so they are closer to the leaf now and it is
    # the light that is allowed to make them pale, not the paint.
    (0.00072, (0.906, 0.866), (0.105, 0.130, 0.082, 1.0)),
    # and the tips, sparse enough to read as separate hairs against the sky
    (0.00160, (0.968, 0.950), (0.225, 0.260, 0.185, 1.0)),
)

_r = np.random.default_rng(4)
_n = _r.random((FUZZ_TEX, FUZZ_TEX))

shells = []
for _li, (_off, (_hi, _lo), _col) in enumerate(FUZZ_LAYERS):
    # Two thresholds per layer, so the mask is not a uniform dither: a sparse
    # scatter of stronger hairs over a fine haze of weaker ones.
    _alpha = np.where(_n > _hi, 1.0, np.where(_n > _lo, 0.70, 0.0))
    _img = bpy.data.images.new("violet_fuzz_alpha%d" % _li, FUZZ_TEX, FUZZ_TEX,
                               alpha=True, float_buffer=True)
    _img.colorspace_settings.name = 'Non-Color'
    _rgba = np.ones((FUZZ_TEX, FUZZ_TEX, 4), dtype=np.float32)
    _rgba[..., 3] = _alpha
    _img.pixels.foreach_set(np.ascontiguousarray(_rgba).ravel())
    _img.file_format = 'PNG'
    _img.pack()

    fuzz_mat = bpy.data.materials.new("violet_fuzz%d" % _li)
    fuzz_mat.use_nodes = True
    _ft = fuzz_mat.node_tree
    _fb = _ft.nodes["Principled BSDF"]
    _fa = _ft.nodes.new('ShaderNodeTexImage')
    _fa.image = _img
    _fa.location = (-500, 0)
    _ft.links.new(_fa.outputs['Alpha'], _fb.inputs['Alpha'])
    # Hairs are near-colourless and translucent — they read as a pale rim where
    # the light comes through them, which is most of what velvet looks like.
    _fb.inputs['Base Color'].default_value = _col
    # Hairs are not glossy. At 0.62, ten thousand little quads under a bright
    # sky each returned a specular pinpoint, and the leaf margins came out
    # crawling with white speckle rather than looking like velvet.
    _fb.inputs['Roughness'].default_value = 0.95
    _fb.inputs['Metallic'].default_value = 0.0
    if 'Specular IOR Level' in _fb.inputs:
        _fb.inputs['Specular IOR Level'].default_value = 0.0
    # What we want is glTF alphaMode MASK — an alpha-blended shell of ten
    # thousand little quads is ten thousand sorting decisions a depth buffer
    # cannot make, and a cutout has none to get wrong. Blender 5 removed the
    # 'CLIP' blend mode the exporter used to turn into MASK, so there is no
    # longer a way to say it from here: this comes out as BLEND whatever we do,
    # and the viewer converts it back to a cutout on load.
    for _bm_name in ('CLIP', 'BLEND'):
        try:
            fuzz_mat.blend_method = _bm_name
            break
        except Exception:
            continue
    try:
        fuzz_mat.alpha_threshold = 0.35
    except Exception:
        pass

    shell = plant.copy()
    # BASE_ME is the plant as it stood before Solidify — which is still the
    # surface the blade presents, because Solidify grows inward. Copying the
    # finished mesh instead would wrap the shell round the new underside too,
    # doubling it for hairs nobody can see.
    shell.data = BASE_ME.copy()
    shell.name = "violet_fuzz%d" % _li
    bpy.context.collection.objects.link(shell)

    _bm = bmesh.new()
    _bm.from_mesh(shell.data)
    # keep the blade only — no fuzz on the stems, the petals or the anthers
    _drop = [f for f in _bm.faces if f.material_index != 0]
    bmesh.ops.delete(_bm, geom=_drop, context='FACES')
    _bm.verts.ensure_lookup_table()
    for v in _bm.verts:
        v.co += v.normal * _off
    _bm.to_mesh(shell.data)
    _bm.free()

    shell.data.materials.clear()
    shell.data.materials.append(fuzz_mat)
    for m in list(shell.modifiers):
        if m.type in {'SOLIDIFY', 'SUBSURF', 'PARTICLE_SYSTEM'}:
            shell.modifiers.remove(m)
    shells.append(shell)


# ---- export ----------------------------------------------------------------
os.makedirs(OUT_DIR, exist_ok=True)
glb = os.path.join(OUT_DIR, 'violet.glb')

keep = {plant.name, rig.name, 'pot', 'rim', 'soil'} | {sh.name for sh in shells}
for ob in bpy.context.view_layer.objects:
    ob.select_set(ob.name in keep)
bpy.context.view_layer.objects.active = plant

opts = dict(filepath=glb, export_format='GLB', use_selection=True,
            # The wind clip is not shipped. Driving the leaf bones and the
            # droop offset from the same rotations made the two fight: a gust
            # would wind the outer leaves past their own blades and they would
            # curl through themselves. The skin still exports — droop needs
            # those bones — but nothing animates them.
            export_apply=False, export_animations=False, export_skins=True,
            export_yup=True, export_materials='EXPORT',

            # --- geometry
            # Worth having, but know what it is worth: the vertex data is 15% of
            # this file and the six texture maps are 82%, so Draco alone takes
            # 7.6 MB to about 6.6 MB and no further. It is the textures below
            # that actually move the number.
            export_draco_mesh_compression_enable=True,
            export_draco_mesh_compression_level=7,
            export_draco_position_quantization=14,
            export_draco_normal_quantization=10,
            export_draco_texcoord_quantization=12,
            # Joints and weights ride in "generic". Below about 12 bits the
            # skin starts to pop visibly on the outermost leaf bones, which are
            # the ones that move furthest.
            export_draco_generic_quantization=12,

            # --- textures, which are the actual payload
            # A normal map is close to incompressible as PNG — that one map was
            # 2.8 MB on its own. These are foliage under a soft key, not surface
            # detail anybody inspects at 1:1, so lossy is the right trade.
            export_image_format='WEBP',
            export_image_quality=92,
            )

# Option names drift between Blender versions, and one unknown key is a
# TypeError that takes the entire export down with it. Keep what this build
# actually understands and report the rest, rather than silently falling back
# to a core set that quietly drops the compression this whole change is for.
_props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
dropped = sorted(k for k in opts if k not in _props)
bpy.ops.export_scene.gltf(**{k: v for k, v in opts.items() if k in _props})

result = {
    'glb': glb,
    'bytes': os.path.getsize(glb) if os.path.exists(glb) else 0,
    'verts': len(plant.data.vertices),
    'bones': len(rig.pose.bones),
    'materials': [m.name for m in plant.data.materials],
    'petal_albedo_srgb': IMG_PALB.colorspace_settings.name,
    'fuzz_tris': [len(sh.data.polygons) for sh in shells],
    'solidified_verts': len(plant.data.vertices),
    'welded_faces': _welded,
    'materials_slots': [m.name for m in plant.data.materials],
    'frames': [scene.frame_start, scene.frame_end],
    'clipping_pairs': g['result']['leaf_pairs_intersecting'],
    'unsupported_export_options': dropped,
}
print("exported:", result)
