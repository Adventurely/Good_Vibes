"""Objective checks for a plant asset, to be run inside Blender.

A screenshot proves one camera angle at one moment. A number in the build report
is checked on every build forever, which is why each of these exists: every one
of them corresponds to something that shipped broken and that nobody could see.

Import from a species exporter rather than re-deriving the BVH code:

    import sys; sys.path.insert(0, r"<repo>/.claude/skills/plant-assets/scripts")
    import mesh_checks

    result['boundary_edges_by_slot'] = mesh_checks.boundary_edges_by_slot(plant.data)
    result['clipping_pairs']         = mesh_checks.self_intersections(me, BLADE_FACES)
    result['organs_in_props']        = mesh_checks.intersections_with(me, BLADE_FACES,
                                                                      [pot, rim])

Everything here is read-only: nothing mutates the scene.
"""

import bpy
import bmesh
import numpy as np


# ---- geometry ---------------------------------------------------------------

def boundary_edges_by_slot(mesh):
    """Open holes in `mesh`, counted per material slot.

    A boundary edge — one with a single adjacent face — is a hole. Every open
    tube on the violet turned out to be visible from somewhere: petiole bases
    from under the rosette, the corolla tube from behind a bloom, the scape at
    the join. "Hidden by something else" is not the same as closed.

    Returns {} for a watertight mesh, which is what a finished plant should
    report. Run it on the mesh you are about to export, after any Solidify: the
    rim faces Solidify adds are what close an open blade, so running it earlier
    reports holes that will not ship.
    """
    bm = bmesh.new()
    bm.from_mesh(mesh)
    holes = {}
    for e in bm.edges:
        if len(e.link_faces) == 1:
            mi = e.link_faces[0].material_index
            holes[mi] = holes.get(mi, 0) + 1
    bm.free()
    return {str(k): v for k, v in sorted(holes.items())}


def self_intersections(mesh, ranges):
    """Intersecting face pairs between different organs of the same mesh.

    `ranges` is a list of (first_face, last_face) per organ. Exact rather than a
    proxy — BVHTree.overlap does real triangle-triangle intersection.

    Two things decide whether this is useful:

    * **Run it on the base mesh**, before Solidify and Subdivision. Those
      thicken what is already there, so a base mesh clean by a reasonable margin
      stays clean, and checking the thickened one just reports the margin.

    * **Scope each range to the part you actually mean.** When the violet's
      petioles started converging in the compost, a range spanning the whole
      leaf went from 0 to 102 "intersections" overnight — all of them by design,
      because eighteen stalks meeting in one place overlap on purpose. Record
      blade faces only. A check that cries wolf is worse than no check, because
      the next real one gets ignored.

    Returns a list of [organ_i, organ_j, overlapping_face_pairs].
    """
    from mathutils.bvhtree import BVHTree
    co = [v.co for v in mesh.vertices]
    trees = [BVHTree.FromPolygons(
        co, [tuple(f.vertices) for f in mesh.polygons[a:b]],
        all_triangles=False, epsilon=0.0) for (a, b) in ranges]
    hits = []
    for x in range(len(trees)):
        for y in range(x + 1, len(trees)):
            ov = trees[x].overlap(trees[y])
            if ov:
                hits.append([x, y, len(ov)])
    return hits


def intersections_with(mesh, ranges, obstacles):
    """Organ faces that intersect a prop — a pot, a rim, a pedestal.

    `self_intersections` only ever compares organs with each other, so a blade
    could pass clean through a pot rim and nothing would say a word. It was
    doing exactly that. Same exact triangle test, aimed outward.

    The obstacles carry an object transform and the plant mesh usually does not,
    so their vertices are lifted into world space before the trees are built.

    Returns a list of [organ_index, obstacle_name, overlapping_face_pairs].
    """
    from mathutils.bvhtree import BVHTree
    co = [v.co for v in mesh.vertices]
    obs = []
    for ob in obstacles:
        mw = ob.matrix_world
        obs.append((ob.name, BVHTree.FromPolygons(
            [mw @ v.co for v in ob.data.vertices],
            [tuple(f.vertices) for f in ob.data.polygons],
            all_triangles=False, epsilon=0.0)))
    hits = []
    for li, (a, b) in enumerate(ranges):
        tree = BVHTree.FromPolygons(
            co, [tuple(f.vertices) for f in mesh.polygons[a:b]],
            all_triangles=False, epsilon=0.0)
        for nm, ot in obs:
            ov = tree.overlap(ot)
            if ov:
                hits.append([li, nm, len(ov)])
    return hits


def facing(mesh, material_index, axis=(0.0, 0.0, 1.0), tol=0.15):
    """Which way a surface's faces point, as a sanity check on winding.

    Winding falls out of whatever frame a surface was built in, and on a
    double-sided material a flipped normal is invisible — until something *uses*
    the normal. Solidify grows away from it, so thickness lands on the wrong
    side; hair shells are pushed along it, so every hair ends up under the leaf.
    The violet's blade faced the floor for a commit and the symptom reported was
    "the hairs are only on the underside".

    Run this on a snapshot taken *before* Solidify. Afterwards a solid has a top
    and a bottom, so the count comes out near 50/50 and means nothing — the
    function says so in `note` when it sees that, because misreading it is
    easier than it sounds.

    Returns {'with': n, 'against': n, 'edge_on': n, 'note': str|None}.
    """
    ax = np.array(axis, dtype=float)
    ax /= np.linalg.norm(ax)
    out = {'with': 0, 'against': 0, 'edge_on': 0}
    for p in mesh.polygons:
        if p.material_index != material_index:
            continue
        d = float(np.dot(np.array(p.normal[:]), ax))
        out['with' if d > tol else 'against' if d < -tol else 'edge_on'] += 1
    lo, hi = sorted((out['with'], out['against']))
    out['note'] = ('near 50/50 — this mesh is probably already solidified; '
                   'snapshot before applying it' if hi and lo / hi > 0.75 else None)
    return out


def shell_clearance(surface_obj, shell_obj, samples=500):
    """Whether a hair shell sits outside its surface or has sunk inside it.

    Signed distance along the surface normal, sampled over the shell. Positive
    means the shell is on the lit side, which is where hairs belong; negative
    means the surface's winding was backwards when the shell was pushed out, and
    every hair on the plant is hanging underneath the leaf it belongs to. That
    happened, and the symptom reported was "the hairs are only on the underside".

    Do not do this with bounding boxes. The obvious version — compare the two
    objects' z-extents — is wrong whenever the shell covers only part of the
    object, which is the normal case: a shell over blades and stalks stops well
    below a plant whose flowers stand above them, so it reports "below" on a
    perfectly good shell. Ask the surface, not the bounding box.

    Returns min / mean / max signed clearance and the fraction outside.
    """
    from mathutils.bvhtree import BVHTree
    smw = surface_obj.matrix_world
    tree = BVHTree.FromPolygons(
        [smw @ v.co for v in surface_obj.data.vertices],
        [tuple(f.vertices) for f in surface_obj.data.polygons],
        all_triangles=False, epsilon=0.0)
    hmw = shell_obj.matrix_world
    verts = shell_obj.data.vertices
    step = max(1, len(verts) // max(1, samples))
    signed = []
    for i in range(0, len(verts), step):
        p = hmw @ verts[i].co
        loc, nor, _idx, _dist = tree.find_nearest(p)
        if loc is None:
            continue
        signed.append(float((p - loc).dot(nor)))
    if not signed:
        return {'samples': 0, 'outside_fraction': None}
    a = np.array(signed)
    return {'samples': int(a.size),
            'min_mm': round(float(a.min()) * 1000, 3),
            'mean_mm': round(float(a.mean()) * 1000, 3),
            'max_mm': round(float(a.max()) * 1000, 3),
            'outside_fraction': round(float((a > 0).mean()), 3)}


# ---- images -----------------------------------------------------------------

def image_array(name):
    """A Blender image as (H, W, 4) float, in whatever space it is tagged."""
    img = bpy.data.images[name]
    return np.array(img.pixels[:], dtype=np.float32).reshape(
        img.size[1], img.size[0], 4)


def mean_linear(name, rows=(0.0, 0.25, 0.5, 0.75, 1.0)):
    """Mean linear RGB of an image, overall and at chosen v positions.

    Use this instead of looking at a render. The authoring scene's key light is
    hot enough under AgX that a saturated gold reads as cream and a dusky maroon
    reads as salmon pink — that has cost two rounds on two materials, and both
    times the map underneath was exactly what had been asked for. If these
    numbers are the colour you authored, the render is lying and the fix is
    `scene.view_settings.exposure`.

    Row 0 is v = 0, matching the direction the UVs run.
    """
    px = image_array(name)[..., :3]
    n = px.shape[0]
    out = {'mean': [round(float(px[..., i].mean()), 4) for i in range(3)]}
    for f in rows:
        r = min(n - 1, int(f * (n - 1)))
        out['v=%.2f' % f] = [round(float(px[r, :, i].mean()), 4) for i in range(3)]
    return out


def alpha_coverage_by_mip(name, threshold=0.35):
    """What fraction of an alpha mask survives `threshold` at each mip level.

    This is the check that explains "the hairs get brighter as I zoom in". A
    threshold does not survive mipmapping: as the chain averages a binary noise
    mask toward its mean, the fraction passing collapses. Measured on the
    violet's near fuzz shell against 0.35 — 13.4% at mip 0, 8.2% at mip 1, 0.7%
    at mip 2, nothing beyond. So there were no hairs at a distance and an eighth
    of the leaf was covered up close, which is the camera changing the plant.

    If the numbers fall away like that, do not tune the threshold — switch the
    material to linear alpha blending, where the pixel is
    `over * a + under * (1 - a)` and averaging `a` averages the result with it,
    so the mix is identical at every distance. Turn `depthWrite` off with it.

    Returns {'mean_alpha': x, 'mip0_512px': f, 'mip1_256px': f, ...}.
    """
    a = image_array(name)[..., 3]
    out = {'mean_alpha': round(float(a.mean()), 4)}
    lvl, k = a.copy(), 0
    while lvl.shape[0] >= 8:
        out['mip%d_%dpx' % (k, lvl.shape[0])] = round(float((lvl > threshold).mean()), 4)
        lvl = lvl.reshape(lvl.shape[0] // 2, 2, lvl.shape[1] // 2, 2).mean(axis=(1, 3))
        k += 1
    return out


def overlay_lift(under_name, layers):
    """What an alpha-blended overlay actually does to the surface beneath it.

    `layers` is [(rgb_tuple, alpha_image_name), ...] applied in order. Use it to
    pick hair colour: never choose one in the abstract. The fuzz was painted
    (0.105, 0.130, 0.082) against a blade albedo of (0.022, 0.057, 0.019) —
    4.7x its red and 2.3x its green, so the hairs were not merely brighter than
    the leaf, they were *desaturated* against it, which is a grey speck rather
    than a pale hair. Roughly 2x the surface near it and 2.5x at the tips lands
    a ~19% lift in value with the hue kept, which is what velvet does.
    """
    under = np.array([float(image_array(under_name)[..., i].mean())
                      for i in range(3)])
    mix = under.copy()
    steps = []
    for rgb, alpha_name in layers:
        c = np.array(rgb[:3], dtype=float)
        a = float(image_array(alpha_name)[..., 3].mean())
        mix = c * a + mix * (1 - a)
        steps.append({'colour': [round(float(v), 4) for v in c],
                      'mean_alpha': round(a, 4),
                      'x_surface': [round(float(v / w), 2) for v, w in zip(c, under)]})
    return {'surface': [round(float(v), 4) for v in under],
            'layers': steps,
            'result': [round(float(v), 4) for v in mix],
            'lift_pct': [round(float((v / w - 1) * 100), 1) for v, w in zip(mix, under)]}


# ---- the shipped file -------------------------------------------------------

def glb_summary(path):
    """Materials, images and the byte split of a finished GLB.

    Read what shipped, not what you think you exported. This is how
    `sheenColorFactor: [1, 1, 1]` was found after two rounds of guessing at the
    petal glare, and how the image/geometry split gets measured before anyone
    optimises the wrong one — on the violet, geometry was 15% of the file and
    the maps 82%.
    """
    import json
    import struct
    b = open(path, 'rb').read()
    off, j = 12, None
    while off < len(b):
        ln, ty = struct.unpack_from('<I4s', b, off)
        if ty == b'JSON':
            j = json.loads(b[off + 8:off + 8 + ln].decode('utf-8'))
            break
        off += 8 + ln
    if j is None:
        raise ValueError('no JSON chunk in %s' % path)
    bv = j['bufferViews']
    imgs = [(im.get('name'), im.get('mimeType'), bv[im['bufferView']]['byteLength'])
            for im in j.get('images', [])]
    img_bytes = sum(n for _, _, n in imgs)
    return {'bytes': len(b),
            'image_bytes': img_bytes,
            'other_bytes': len(b) - img_bytes,
            'images': imgs,
            'materials': j.get('materials', [])}
