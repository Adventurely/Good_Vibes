"""The Blender-to-glTF translation layer, shared by every species.

Each species authors its own geometry and its own texture arrays. What they all
have in common is the set of things that are correct in Blender and wrong in the
browser, and those belong in one file rather than one per species — every one of
them below cost a round to find on the violet, and the daylily should not have
to find them again.

The full catalogue, with the symptoms, is in
`.claude/skills/plant-assets/references/gltf-traps.md`.
"""
import bpy
import bmesh
import numpy as np


def as_image(name, rgb, srgb):
    """(N, N, 3) linear float -> a Blender image the exporter will read right.

    A `baseColorTexture` is sRGB by definition, so linear numbers tagged
    Non-Color get an sRGB decode applied a second time in the browser and
    everything arrives lighter and flatter. That is what "washed out" looks
    like. Normal and roughness maps stay Non-Color, because those really are
    raw numbers.

    Row 0 is v = 0 and stays there. A flip runs every map backwards down its own
    surface, which is subtle on a leaf and catastrophic on a flower.
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
    to be differentiated here rather than in the shader."""
    gy, gx = np.gradient(h.astype(np.float64))
    nx, ny = -gx * strength * h.shape[0] / 512.0, -gy * strength * h.shape[0] / 512.0
    nz = np.ones_like(nx)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx * inv * 0.5 + 0.5,
                     ny * inv * 0.5 + 0.5,
                     nz * inv * 0.5 + 0.5], axis=-1)


def mapped_material(name, albedo, height, rough, normal_strength=2.0,
                    sheen_tint=None, sheen_rough=0.42, specular=None,
                    prefix=""):
    """A glTF-safe Principled BSDF from three arrays.

    Sheen is set as a *tint*, never as a weight. KHR_materials_sheen carries a
    colour and a roughness and has nowhere to put a weight, so Blender's
    exporter writes the tint and drops the weight, and three.js sets
    `material.sheen = 1` whenever the extension is present. Left at Blender's
    default white that ships as a full-strength white gloss over the whole
    surface, which is the glare. Set the tint here so the file is sane; set the
    strength in the viewer, where it can actually be expressed.
    """
    ia = as_image(prefix + "_albedo", albedo, srgb=True)
    inr = as_image(prefix + "_normal", normal_from_height(height, normal_strength),
                   srgb=False)
    ir = as_image(prefix + "_rough", np.repeat(rough[..., None], 3, axis=-1),
                  srgb=False)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    ta = nt.nodes.new('ShaderNodeTexImage'); ta.image = ia; ta.location = (-700, 260)
    tr = nt.nodes.new('ShaderNodeTexImage'); tr.image = ir; tr.location = (-700, 0)
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = inr; tn.location = (-700, -260)
    tn.image.colorspace_settings.name = 'Non-Color'
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.location = (-420, -260)
    nt.links.new(ta.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(tr.outputs['Color'], b.inputs['Roughness'])
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Metallic'].default_value = 0.0
    if sheen_tint is not None and 'Sheen Tint' in b.inputs:
        b.inputs['Sheen Tint'].default_value = (*sheen_tint, 1.0)
        if 'Sheen Roughness' in b.inputs:
            b.inputs['Sheen Roughness'].default_value = sheen_rough
    if specular is not None and 'Specular IOR Level' in b.inputs:
        b.inputs['Specular IOR Level'].default_value = specular
    return m, (ia, inr, ir)


def flatten_procedurals(flat):
    """`flat` maps a material-name prefix to ((r, g, b, a), roughness).

    glTF has no procedural textures: a node-driven Base Color exports as the
    socket's unlinked default, which is white. Anything anybody actually looks
    at needs real maps; this is only for props that are never inspected — a pot,
    some compost. Getting that distinction wrong is how a violet shipped with
    white anthers in the middle of every flower.
    """
    for m in bpy.data.materials:
        hit = next((v for k, v in flat.items() if m.name.startswith(k)), None)
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


def apply_solidify(plant, weights, thickness, base_snapshot=False):
    """Give the surfaces thickness, per material slot, and bake it in.

    `side: DoubleSide` in three.js lets you see the back of a surface; it does
    not give that surface an edge. A blade or a tepal with no thickness has a
    zero-width silhouette, so every leaf ends at a hard line and every petal
    reads as bent foil.

    `weights` maps material index to a fraction of `thickness`, because a plant
    is not made of one substance: a fleshy blade is about a millimetre, a tepal
    a third of that, and closed tubes and spheres need nothing added inside
    them. Weight-0 slots come through as a coincident reversed duplicate of
    themselves, so they are welded back afterwards.

    Applied by hand rather than via `export_apply`, so the armature is never in
    the stack while it happens and the skin cannot get baked in by accident.
    `offset = -1` grows the thickness inward, which keeps the lit surface where
    anything positioned against it — a hair shell, say — expects to find it.

    Returns (base_mesh_copy or None, welded_face_count, worst_displacement).

    That third number is the guard. A shell of `thickness` should not move any
    vertex further than `thickness` off the surface it was built on, so the
    measurement is simply: for every vertex afterwards, the distance to the
    nearest vertex before. It reads 0.0004 m on the daylily, which is the shell.
    It read 0.062 m for as long as Even Thickness was on, and nothing said so -
    the render that gets looked at is `daylily.py`, which never runs this file.
    """
    snap = plant.data.copy() if base_snapshot else None
    from mathutils.kdtree import KDTree
    _before = KDTree(len(plant.data.vertices))
    for _vi, _v in enumerate(plant.data.vertices):
        _before.insert(_v.co, _vi)
    _before.balance()

    w = {}
    for poly in plant.data.polygons:
        f = weights.get(poly.material_index, 0.0)
        for vi in poly.vertices:
            w[vi] = max(w.get(vi, 0.0), f)
    vg = plant.vertex_groups.new(name="thickness")
    for vi, ww in w.items():
        if ww > 0.0:
            vg.add([vi], ww, 'REPLACE')

    for m in list(plant.modifiers):
        if m.type == 'SUBSURF':
            plant.modifiers.remove(m)
    sol = next(m for m in plant.modifiers if m.type == 'SOLIDIFY')
    sol.thickness = thickness
    sol.offset = -1.0
    # Even Thickness OFF, and this is the whole reason the spent daylily flowers
    # shipped as origami cranes.
    #
    # It divides the offset by the sine of the angle between adjacent faces, so
    # that a folded surface keeps its thickness through the fold. On gentle
    # geometry that is free. On a collapsed tepal - hooked right round by
    # `spent_recurve` and then twisted - every crease is acute, the divisor goes
    # to nothing, and a 0.4 mm shell displaces vertices by up to 62 mm. Measured
    # over the whole plant: with it on, 301 spent-tepal vertices and 67 open ones
    # move more than 2 mm off the surface they were built on; with it off, the
    # worst displacement anywhere is 0.0004 m, which is the shell.
    #
    # It cost the OPEN flowers 24 mm too - they just carried it better, which is
    # why one bloom looked beautiful and the one below it looked folded.
    #
    # What is given up is real but invisible at this scale: a shell measured
    # along the normal rather than perpendicular to the fold, so a crease is
    # thinner than the flat either side of it by the cosine of half its angle.
    # On 0.4 mm of tepal and 1.2 mm of blade that is nothing. NON_MANIFOLD mode
    # was tried too and is worse here: 41 mm on the spent flowers.
    sol.use_even_offset = False
    sol.use_rim = True
    sol.use_rim_only = False
    sol.vertex_group = vg.name
    sol.thickness_vertex_group = 0.0

    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    plant.select_set(True)
    bpy.context.view_layer.objects.active = plant
    bpy.ops.object.modifier_apply(modifier=sol.name)

    worst = 0.0
    for _v in plant.data.vertices:
        worst = max(worst, _before.find(_v.co)[2])

    bm = bmesh.new()
    bm.from_mesh(plant.data)
    before = len(bm.faces)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges[:])
    welded = before - len(bm.faces)
    bm.to_mesh(plant.data)
    bm.free()
    plant.data.polygons.foreach_set('use_smooth', [True] * len(plant.data.polygons))
    return snap, welded, worst


def export_opts(glb):
    """Draco plus WebP, and the quantisation levels that were arrived at rather
    than guessed. Below about 12 bits on the generic stream — which is where
    joints and weights ride — the skin starts to pop on the bones that move
    furthest."""
    return dict(
        filepath=glb, export_format='GLB', use_selection=True,
        export_apply=False, export_animations=False, export_skins=True,
        export_yup=True, export_materials='EXPORT',
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12,
        export_draco_generic_quantization=12,
        export_image_format='WEBP',
        export_image_quality=92,
    )


def write_glb(opts):
    """One unknown option key is a TypeError that takes the whole export down,
    and option names drift between Blender versions. Filter to what this build
    understands and *report* what was dropped, rather than silently falling back
    to a core set and losing the compression the filtering was for."""
    props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    dropped = sorted(k for k in opts if k not in props)
    bpy.ops.export_scene.gltf(**{k: v for k, v in opts.items() if k in props})
    return dropped
