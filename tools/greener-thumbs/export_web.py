"""Export the violet as a single self-contained GLB for the browser viewer.

Run inside Blender. This builds the plant via `violet.py`, swaps the leaf
material for one the glTF spec can actually carry, and writes
`public/greener-thumbs/violet.glb` with geometry, skeleton, the wind clip and
all textures embedded.

Three things are deliberate:

**No modifiers are applied.** Subdivision at render level would ship a quarter
of a million vertices to a web page, and applying modifiers to a skinned mesh
risks the exporter baking the armature instead of exporting it as a skin. The
base cage is 17k verts and reads fine with smooth normals; Solidify is dropped
because `side: DoubleSide` in three.js does the same job for free.

**Textures are re-encoded, not reused.** `violet.py` authors its maps as linear
float and marks them Non-Color, which is right for Cycles and wrong for glTF.
Base colour has to be sRGB, and the height map has to become a tangent-space
normal map, because glTF has no bump node.

**Hair is off.** Particle hair has no glTF representation. The browser gets the
sheen term instead, which is what it was standing in for anyway.
"""
import bpy, os, sys
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
    'wind': 0.6,
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
for k, v in (('Sheen Weight', 0.35), ('Sheen Roughness', 0.45)):
    if k in b.inputs:
        b.inputs[k].default_value = v

# slot 0 is the blade — see SLOT_LEAF in violet.py
plant.data.materials[0] = mat

# The pot, rim and soil are procedural noise, and glTF has no procedural
# textures — a node-driven Base Color exports as the socket's unlinked default,
# which is white. Give them the mean of the colours they mix between, so the
# props at least read as terracotta and soil rather than porcelain.
FLAT = {
    'terracotta': ((0.228, 0.080, 0.041, 1.0), 0.82),
    'soil':       ((0.021, 0.015, 0.011, 1.0), 0.97),
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

# Solidify is redundant once the viewer draws both sides, and Subdivision at
# render level would ship ~280k verts to a browser.
for m in list(plant.modifiers):
    if m.type in {'SOLIDIFY', 'SUBSURF'}:
        plant.modifiers.remove(m)


# ---- export ----------------------------------------------------------------
os.makedirs(OUT_DIR, exist_ok=True)
glb = os.path.join(OUT_DIR, 'violet.glb')

keep = {plant.name, rig.name, 'pot', 'rim', 'soil'}
for ob in bpy.context.view_layer.objects:
    ob.select_set(ob.name in keep)
bpy.context.view_layer.objects.active = plant

opts = dict(filepath=glb, export_format='GLB', use_selection=True,
            export_apply=False, export_animations=True, export_skins=True,
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
    'frames': [scene.frame_start, scene.frame_end],
    'clipping_pairs': g['result']['leaf_pairs_intersecting'],
    'unsupported_export_options': dropped,
}
print("exported:", result)
