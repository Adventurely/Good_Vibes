"""Export the daylily as a self-contained GLB for the browser viewer.

Run inside Blender. Builds the plant via `daylily.py`, re-encodes its maps for
glTF and writes `public/greener-thumbs/daylily.glb`.

Three differences from the violet's exporter, all of them botanical:

**No hair shells.** A daylily is glabrous — no trichomes anywhere on leaf,
scape or tepal. The violet's two alpha-blended shells are a third of its file
and none of that applies here.

**Thickness differs by organ more sharply.** A blade is 0.8-1.5 mm and fleshy;
a tepal is 0.3-0.8 mm and translucent; scapes, pedicels, buds, filaments and the
perianth tube are closed tubes that already have volume.

**Subsurface has to survive.** The tepals glow when backlit and an opaque tepal
shader destroys the flower, so the material carries a transmission-ish sheen
rather than being flattened to a diffuse orange.

Everything else — colour space, procedural flattening, applying Solidify by
hand, the Draco and WebP settings — lives in `web_common.py`, because those are
the traps that are the same for every species and finding them twice would be
the whole point of writing them down.
"""
import bpy, os, sys
import numpy as np

_self = globals().get('__file__') or (globals().get('EXPORT_P') or {}).get('here')
if not _self:
    raise RuntimeError("set EXPORT_P['here'] to this file's path, or run with __file__")
HERE = os.path.dirname(os.path.abspath(_self))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_DIR = os.path.join(REPO, 'public', 'greener-thumbs')
for _p in (HERE, os.path.join(REPO, '.claude', 'skills', 'plant-assets', 'scripts')):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import web_common as W
import mesh_checks

DAYLILY_P = {'engine': 'CYCLES'}
_over = dict(globals().get('EXPORT_P') or {})
DAYLILY_P.update(_over.pop('daylily', {}))
DAYLILY_P['here'] = os.path.join(HERE, 'daylily.py')

g = dict(globals())
g['DAYLILY_P'] = DAYLILY_P
_src = os.path.join(HERE, 'daylily.py')
exec(compile(open(_src, encoding='utf-8').read(), _src, 'exec'), g)

TEX = g['TEX_ARRAYS']
plant, rig, me = g['plant'], g['rig'], g['me']
SLOT_LEAF, SLOT_SCAPE = g['SLOT_LEAF'], g['SLOT_SCAPE']
SLOT_TEPAL, SLOT_EYE = g['SLOT_TEPAL'], g['SLOT_EYE']
scene = bpy.context.scene


# ---- materials the spec can carry ------------------------------------------
# The blade: semi-glossy, parallel-veined, with the keel line as its highlight.
# Its sheen tint is a pale green rather than white — see the note in
# web_common.mapped_material about where the weight goes.
mat_leaf, _ = W.mapped_material(
    "daylily_leaf_web", TEX['leaf_albedo'], TEX['leaf_height'], TEX['leaf_rough'],
    normal_strength=2.0, sheen_tint=(0.16, 0.24, 0.10), sheen_rough=0.50,
    specular=0.28, prefix="web_leaf")

mat_scape, _ = W.mapped_material(
    "daylily_scape_web", TEX['scape_albedo'], TEX['scape_height'], TEX['scape_rough'],
    normal_strength=1.8, sheen_tint=(0.16, 0.22, 0.11), sheen_rough=0.46,
    specular=0.22, prefix="web_scape")

# The corolla. Tepals are 0.3-0.8 mm thick and translucent; three.js gets the
# strength in the viewer, this only has to ship a file that is not already wrong.
mat_tepal, _ = W.mapped_material(
    "daylily_tepal_web", TEX['tepal_albedo'], TEX['tepal_height'], TEX['tepal_rough'],
    normal_strength=1.5, sheen_tint=(0.34, 0.14, 0.04), sheen_rough=0.55,
    specular=0.10, prefix="web_tepal")

plant.data.materials[SLOT_LEAF] = mat_leaf
plant.data.materials[SLOT_SCAPE] = mat_scape
plant.data.materials[SLOT_TEPAL] = mat_tepal

# The pot and the compost are noise graphs and nobody inspects them. The anthers
# are NOT on this list: they are already a flat colour by choice, which is a
# different thing from being flattened because glTF could not carry them.
W.flatten_procedurals({
    'terracotta': ((0.228, 0.080, 0.041, 1.0), 0.82),
    'soil':       ((0.021, 0.015, 0.011, 1.0), 0.97),
})


# ---- thickness -------------------------------------------------------------
# A blade is fleshy at about 1.2 mm; a tepal is a third of that and thin enough
# to glow. Scapes, pedicels, buds, filaments, anthers and the perianth tube are
# closed tubes and spheres with volume already, so they take nothing.
_snap, _welded = W.apply_solidify(
    plant,
    {SLOT_LEAF: 1.00, SLOT_TEPAL: 0.34, SLOT_SCAPE: 0.0, SLOT_EYE: 0.0},
    0.0012)


# ---- export ----------------------------------------------------------------
os.makedirs(OUT_DIR, exist_ok=True)
glb = os.path.join(OUT_DIR, 'daylily.glb')

keep = {plant.name, rig.name, 'pot', 'rim', 'soil'}
for ob in bpy.context.view_layer.objects:
    ob.select_set(ob.name in keep)
bpy.context.view_layer.objects.active = plant

dropped = W.write_glb(W.export_opts(glb))

summary = mesh_checks.glb_summary(glb)
result = {
    'glb': glb,
    'bytes': summary['bytes'],
    'image_bytes': summary['image_bytes'],
    'geometry_bytes': summary['other_bytes'],
    'verts': len(plant.data.vertices),
    'bones': len(rig.pose.bones),
    'materials': [m.name for m in plant.data.materials],
    'welded_faces': _welded,
    # Post-Solidify, so this is the whole plant and it has to be empty: the rim
    # faces Solidify adds are what close an open blade or an open tepal.
    'boundary_edges_by_slot': mesh_checks.boundary_edges_by_slot(plant.data),
    'fan_flatness': g['result'].get('fan_flatness'),
    'blade_pairs_same_fan': g['result'].get('blade_pairs_same_fan'),
    'blade_pairs_cross_fan': g['result'].get('blade_pairs_cross_fan'),
    # The corolla, which had no clipping check at all when this file was
    # written — which is exactly why six tepals shipped intersecting each
    # other at the throat, every spent flower shipped as a knot of 2721
    # face-pairs, and two blooms shipped inside one another on one branch.
    'tepal_pairs_adjacent': g['result'].get('tepal_pairs_adjacent'),
    'tepal_pairs_nonadjacent': g['result'].get('tepal_pairs_nonadjacent'),
    'tepal_pairs_cross_flower': g['result'].get('tepal_pairs_cross_flower'),
    'tepal_vs_blade': g['result'].get('tepal_vs_blade'),
    'tepal_in_pot': g['result'].get('tepal_in_pot'),
    'blooms_demoted_to_buds': g['result'].get('blooms_demoted_to_buds'),
    'unsupported_export_options': dropped,
}
print("exported:", result)
