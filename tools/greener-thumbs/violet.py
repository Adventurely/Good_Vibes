"""A parametric African Violet (Saintpaulia ionantha), built in Blender headless.

The point of this file is not the violet. It is that every visible property is a
number at the top — leaf count, cupping, droop, chlorosis, bloom — so a plant's
condition is a parameter set rather than an asset. That is what a care game
needs: "underwatered on day three" has to be a state the model can be *put in*,
not a second model somebody has to sculpt.
"""
import bpy, bmesh, math, random, sys
from mathutils import Vector, Euler

# ---- the whole plant, as numbers ------------------------------------------
P = dict(
    leaves       = 11,
    leaf_len     = 0.115,
    leaf_wide    = 0.085,
    cup          = 0.35,    # how much the blade curls up at the edges
    droop        = 0.0,     # 0 turgid, 1 collapsed — this is thirst
    chlorosis    = 0.0,     # 0 green, 1 yellow — this is nutrient or overwater
    blooms       = 5,
    bloom_open   = 1.0,
    seed         = 7,
)
P.update({k: float(v) if '.' in v else int(v)
          for a in sys.argv[sys.argv.index('--') + 1:] if '=' in a
          for k, v in [a.split('=', 1)]} if '--' in sys.argv else {})

rnd = random.Random(P['seed'])
bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, base, rough=0.5, sss=0.0, sss_col=None, spec=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Roughness"].default_value = rough
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = spec
    # Leaves are thin and lit from behind as much as in front. Subsurface is
    # most of what separates a leaf from a green plastic cutout.
    if sss and "Subsurface Weight" in b.inputs:
        b.inputs["Subsurface Weight"].default_value = sss
        if sss_col and "Subsurface Radius" in b.inputs:
            b.inputs["Subsurface Radius"].default_value = sss_col
    return m


# Chlorosis rides the leaf colour: green drains toward yellow as it climbs.
g = P['chlorosis']
leaf_col = (0.055 + 0.30 * g, 0.20 + 0.20 * g, 0.035 + 0.02 * g)
M_LEAF = mat("leaf", leaf_col, rough=0.72, sss=0.28, sss_col=(0.28, 0.55, 0.18))
M_PETAL = mat("petal", (0.30, 0.10, 0.42), rough=0.42, sss=0.35, sss_col=(0.5, 0.3, 0.6))
M_EYE = mat("eye", (0.95, 0.78, 0.10), rough=0.55)
M_POT = mat("pot", (0.42, 0.19, 0.11), rough=0.82)
M_SOIL = mat("soil", (0.055, 0.040, 0.030), rough=0.95)


def leaf(i):
    """One rounded, cupped, slightly hairy blade on a short petiole."""
    bm = bmesh.new()
    U, V = 9, 13
    for u in range(U):
        for v in range(V):
            su = (u / (U - 1) - 0.5) * 2          # -1..1 across
            sv = v / (V - 1)                       # 0..1 along
            # Saintpaulia leaves are near-circular with a notched base.
            width = math.sin(sv * math.pi) ** 0.55
            x = su * width * P['leaf_wide']
            y = sv * P['leaf_len']
            z = P['cup'] * (su ** 2) * 0.05 - 0.012 * sv     # cup up, tip down
            bm.verts.new((x, y, z))
    bm.verts.ensure_lookup_table()
    for u in range(U - 1):
        for v in range(V - 1):
            a = bm.verts[u * V + v]; b = bm.verts[u * V + v + 1]
            c = bm.verts[(u + 1) * V + v + 1]; d = bm.verts[(u + 1) * V + v]
            bm.faces.new((a, b, c, d))
    me = bpy.data.meshes.new(f"leaf{i}")
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(f"leaf{i}", me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(M_LEAF)
    for p in ob.data.polygons: p.use_smooth = True
    # A rosette: leaves fan out around the crown at a low, slightly random tilt.
    ang = (i / P['leaves']) * math.tau + rnd.uniform(-0.12, 0.12)
    # Thirst is the whole plant giving up at the petiole.
    tilt = math.radians(16 + rnd.uniform(-5, 5)) - P['droop'] * math.radians(58)
    ob.rotation_euler = Euler((tilt, 0, ang), 'XYZ')
    ob.location = (math.sin(ang) * 0.012, math.cos(ang) * 0.012, 0.075)
    sc = 1.0 - 0.06 * P['droop'] + rnd.uniform(-0.07, 0.07)
    ob.scale = (sc, sc, sc)
    # A little thickness, and the fuzz that makes a violet leaf read as velvet.
    ob.modifiers.new("solid", 'SOLIDIFY').thickness = 0.0016
    sub = ob.modifiers.new("sub", 'SUBSURF'); sub.levels = sub.render_levels = 1
    return ob


def bloom(i):
    """Five rounded petals and a yellow eye, on a thin scape above the leaves."""
    ang = (i / max(1, P['blooms'])) * math.tau + 0.7
    r = rnd.uniform(0.018, 0.042)
    hgt = 0.108 + rnd.uniform(0, 0.022)
    cx, cy = math.sin(ang) * r, math.cos(ang) * r
    open_ = P['bloom_open']
    for p in range(5):
        pa = (p / 5) * math.tau + rnd.uniform(-0.08, 0.08)
        bpy.ops.mesh.primitive_circle_add(vertices=10, radius=0.017 * open_,
                                          fill_type='NGON',
                                          location=(cx + math.sin(pa) * 0.016 * open_,
                                                    cy + math.cos(pa) * 0.016 * open_, hgt))
        pet = bpy.context.active_object
        pet.scale = (1.0, 0.72, 0.34)
        pet.rotation_euler = Euler((math.radians(18 * open_), 0, pa), 'XYZ')
        pet.data.materials.append(M_PETAL)
        for f in pet.data.polygons: f.use_smooth = True
        pet.modifiers.new("sub", 'SUBSURF').levels = 1
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.0055,
                                         location=(cx, cy, hgt + 0.0015))
    eye = bpy.context.active_object; eye.scale = (1, 1, 0.6)
    eye.data.materials.append(M_EYE)
    bpy.ops.object.shade_smooth()
    # the scape
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.0016, depth=hgt - 0.04,
                                        location=(cx * 0.6, cy * 0.6, (hgt - 0.02) / 2 + 0.03))
    bpy.context.active_object.data.materials.append(M_LEAF)


# ---- pot and soil ----------------------------------------------------------
bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=0.052, radius2=0.068, depth=0.075,
                                location=(0, 0, 0.0375))
pot = bpy.context.active_object; pot.data.materials.append(M_POT)
bpy.ops.object.shade_smooth()
pot.modifiers.new("solid", 'SOLIDIFY').thickness = 0.003

bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.065, depth=0.006, location=(0, 0, 0.070))
bpy.context.active_object.data.materials.append(M_SOIL)

for i in range(P['leaves']): leaf(i)
for i in range(P['blooms']): bloom(i)

# ---- a soft north-window light, which is what violets actually want --------
world = bpy.data.worlds.new("w"); bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.19, 0.24, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.55

bpy.ops.object.light_add(type='AREA', location=(-0.32, -0.30, 0.42))
key = bpy.context.active_object
key.data.energy = 22; key.data.size = 0.45
key.rotation_euler = Euler((math.radians(46), 0, math.radians(-38)), 'XYZ')
bpy.ops.object.light_add(type='AREA', location=(0.38, -0.10, 0.22))
fill = bpy.context.active_object
fill.data.energy = 5; fill.data.size = 0.5
fill.rotation_euler = Euler((math.radians(74), 0, math.radians(64)), 'XYZ')

bpy.ops.mesh.primitive_plane_add(size=3, location=(0, 0, 0))
bpy.context.active_object.data.materials.append(mat("bench", (0.20, 0.16, 0.13), rough=0.85))

bpy.ops.object.camera_add(location=(0.0, -0.36, 0.20),
                          rotation=Euler((math.radians(74), 0, 0), 'XYZ'))
cam = bpy.context.active_object
cam.data.lens = 62
bpy.context.scene.camera = cam

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = int(P.get('samples', 96))
sc.cycles.use_denoising = True
sc.render.resolution_x = sc.render.resolution_y = int(P.get('res', 420))
sc.render.film_transparent = False
out = P.get('out', '/tmp/claude-0/blendertest/violet.png')
sc.render.filepath = str(out)
bpy.ops.render.render(write_still=True)
print("rendered ->", out)
