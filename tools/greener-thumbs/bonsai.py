"""A bonsai on a pedestal in a zen garden — the Greener Thumbs title art.

This is not a game asset. It builds one picture: the image on the game's card
and the plate its title screen is laid over. It is parametric in the same way
`violet.py` is, because the styling of a bonsai is exactly the sort of thing
that wants twenty attempts, but nothing here has to be driven at runtime and
nothing here is exported to the browser as geometry.

Run it inside Blender, the same way `violet.py` runs — the MCP bridge, or
`blender --python bonsai.py`. It writes two WebPs into `public/greener-thumbs/`:
the full plate for the title screen, and a small one for the card on the site's
home page. WebP because a photoreal PNG of this is several megabytes and the
card is the first thing the site loads.

Three things are deliberate:

**The foliage is instanced, not modelled.** Each pad is a flattened shell with a
particle system scattering a small leaf over it. What sells foliage at any size
is the broken silhouette, and a hair system gives that for a fraction of what
twelve thousand modelled leaves would cost to build in Python.

**The gravel is raked in the shader, not in geometry.** Concentric rings around
the pedestal are a distance-from-centre sine, which costs nothing and never
tessellates badly. Only the rocks and the ground plane are real geometry.

**The trunk is one spine, sampled twice.** The mesh builder and the branch
placer both read `trunk_spine()`, so a branch cannot end up growing out of
somewhere the trunk is not — the same reason `violet.py` funnels its solver and
its mesh through `blade_xyz`.
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, Matrix

# ---- the whole picture, as numbers ------------------------------------------
P = dict(
    # --- trunk
    trunk_h      = 0.360,   # metres, soil to apex
    trunk_r0     = 0.043,   # radius at the nebari (the flare where it meets soil)
    trunk_r1     = 0.007,   # and at the apex
    trunk_taper  = 1.75,    # >1 keeps the base fat and thins it late, as a real
                            # trunk does — linear taper reads as a traffic cone
    sway         = 0.052,   # how far the S-curve leaves the vertical
    sway_turns   = 1.35,    # how many bends in that curve
    lean         = 0.10,    # radians the whole tree leans toward the camera
    trunk_seg    = 26,      # rings up the trunk
    trunk_ring   = 16,      # points around it
    bark_relief  = 0.0028,  # depth of the vertical fissuring, in metres

    # --- branches and pads
    pads         = 7,
    pad_lo       = 0.30,    # lowest branch, as a fraction of trunk height
    pad_hi       = 1.00,
    pad_r        = 0.085,   # pad radius at the lowest branch
    pad_falloff  = 0.55,    # and how much smaller the top pad is
    pad_flat     = 0.36,    # pads are discs, not spheres — this is their squash
    pad_droop    = 0.16,    # branches fall away from the trunk as they run out
    branch_r     = 0.011,   # where a branch leaves the trunk
    branch_seg   = 9,

    # --- leaves
    leaves       = 2100,    # per pad
    leaf_len     = 0.0135,
    leaf_rand    = 0.45,    # size variation
    leaf_lean    = 0.55,    # how far off the pad normal a leaf may sit

    # --- pot, pedestal, garden
    pot_w        = 0.300, pot_d = 0.215, pot_h = 0.072,
    ped_w        = 0.335, ped_h = 0.620,
    # Radians per metre, not rings per metre: the furrows come out 2*pi/this
    # apart, so 70 puts them 90 mm apart, which is about what a rake leaves.
    rake_freq    = 70.0,
    rake_depth   = 0.48,
    rocks        = 5,
    wall_y       = 3.40,
    wall_h       = 2.20,
    # The sun is aimed by angle, not by a hand-picked point, because a low sun
    # behind the garden is a sun behind a three-metre wall. Azimuth uses the
    # same convention as the camera: 0 is in front, 180 behind, so 235 is over
    # the viewer's left shoulder and a little behind the subject.
    sun_az       = 248.0,
    sun_elev     = 34.0,

    # --- camera and render
    # Far enough back to hold the whole thing — gravel, pedestal, pot, canopy.
    # It is establishing art for a title screen, so the pedestal has to be in
    # it; at 1.95 m on a 105 the frame cut off at the pot.
    cam_dist     = 3.10,
    cam_elev     = 12.5,    # degrees; low, so the tree stands against the wall
    cam_az       = 34.0,
    cam_look     = 0.72,    # the height it is aimed at
    lens         = 76.0,
    fstop        = 2.8,     # shallow: the wall and the far gravel go soft
    samples      = 300,
    big_x        = 1920, big_y = 1140,   # 1.684, the card's aspect
    thumb_x      = 640,  thumb_y = 380,
    exposure     = 0.85,   # stops; AgX sits this scene low without it
    quality      = 92,
    seed         = 11,
    engine       = 'CYCLES',
)

_over = dict(globals().get('BONSAI_P') or {})
if '--' in sys.argv:
    for _a in sys.argv[sys.argv.index('--') + 1:]:
        if '=' in _a:
            _k, _v = _a.split('=', 1)
            try:
                _over[_k] = float(_v) if '.' in _v else int(_v)
            except ValueError:
                _over[_k] = _v
P.update(_over)

_self = globals().get('__file__') or (globals().get('BONSAI_P') or {}).get('here')
if not _self:
    raise RuntimeError("set BONSAI_P['here'] to this file's path, or run with __file__")
HERE = os.path.dirname(os.path.abspath(_self))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_DIR = os.path.join(REPO, 'public', 'greener-thumbs')

rng = np.random.default_rng(int(P['seed']))
import random as _random
rnd = _random.Random(int(P['seed']))

SOIL_Z = P['ped_h'] + P['pot_h'] - 0.010     # the surface the tree grows from
scene = bpy.context.scene


def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
                 bpy.data.particles, bpy.data.worlds, bpy.data.cameras,
                 bpy.data.lights, bpy.data.textures):
        for blk in list(coll):
            try:
                coll.remove(blk, do_unlink=True)
            except Exception:
                pass


clear_scene()


# ---- material helpers, same shape as violet.py's ---------------------------
def principled(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree, m.node_tree.nodes["Principled BSDF"]


def set_if(node, key, val):
    if key in node.inputs:
        node.inputs[key].default_value = val


def noisy(name, c1, c2, scale=40.0, rough=0.85, bump=0.3, detail=6.0,
          distortion=0.0, coord='Object'):
    """Two colours mixed by noise, with the same noise as bump. Everything in
    this scene that is a rough natural surface is a version of this."""
    m, nt, b = principled(name)
    n = nt.nodes
    tc = n.new('ShaderNodeTexCoord'); tc.location = (-900, 0)
    nz = n.new('ShaderNodeTexNoise'); nz.location = (-700, 0)
    nz.inputs['Scale'].default_value = scale
    nz.inputs['Detail'].default_value = detail
    if 'Distortion' in nz.inputs:
        nz.inputs['Distortion'].default_value = distortion
    nt.links.new(tc.outputs[coord], nz.inputs['Vector'])
    mx = n.new('ShaderNodeMixRGB'); mx.location = (-460, 120)
    mx.inputs[1].default_value = (*c1, 1)
    mx.inputs[2].default_value = (*c2, 1)
    nt.links.new(nz.outputs['Fac'], mx.inputs[0])
    nt.links.new(mx.outputs['Color'], b.inputs['Base Color'])
    bp = n.new('ShaderNodeBump'); bp.location = (-460, -200)
    bp.inputs['Strength'].default_value = bump
    nt.links.new(nz.outputs['Fac'], bp.inputs['Height'])
    nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    set_if(b, 'Roughness', rough)
    return m


def bark_material():
    """Bark is vertical: fissures run up the trunk, so the noise that makes them
    has to be stretched along Z before it is read. A plain isotropic noise reads
    as concrete however well it is tuned."""
    m, nt, b = principled("bonsai_bark")
    n = nt.nodes
    tc = n.new('ShaderNodeTexCoord'); tc.location = (-1200, 0)
    # squash Z so the noise cells become long vertical streaks
    mp = n.new('ShaderNodeMapping'); mp.location = (-1000, 0)
    mp.inputs['Scale'].default_value = (1.0, 1.0, 0.16)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])

    # A trunk is 90 mm across, so a "scale" of 26 was barely two cells over the
    # whole of it — which is to say no texture at all, and why this rendered as
    # grey clay. Everything on an object this small has to be an order of
    # magnitude higher than it reads as.
    coarse = n.new('ShaderNodeTexNoise'); coarse.location = (-800, 160)
    coarse.inputs['Scale'].default_value = 190.0
    coarse.inputs['Detail'].default_value = 10.0
    if 'Distortion' in coarse.inputs:
        coarse.inputs['Distortion'].default_value = 1.4
    nt.links.new(mp.outputs['Vector'], coarse.inputs['Vector'])

    fine = n.new('ShaderNodeTexNoise'); fine.location = (-800, -120)
    fine.inputs['Scale'].default_value = 1400.0
    fine.inputs['Detail'].default_value = 8.0
    nt.links.new(mp.outputs['Vector'], fine.inputs['Vector'])

    mx = n.new('ShaderNodeMixRGB'); mx.location = (-520, 200)
    mx.inputs[1].default_value = (0.038, 0.029, 0.023, 1)   # weathered grey-brown
    mx.inputs[2].default_value = (0.115, 0.086, 0.062, 1)   # the lit ridges
    nt.links.new(coarse.outputs['Fac'], mx.inputs[0])
    nt.links.new(mx.outputs['Color'], b.inputs['Base Color'])

    b1 = n.new('ShaderNodeBump'); b1.location = (-520, -260)
    b1.inputs['Strength'].default_value = 0.35
    b1.inputs['Distance'].default_value = 0.0009
    nt.links.new(fine.outputs['Fac'], b1.inputs['Height'])
    b2 = n.new('ShaderNodeBump'); b2.location = (-300, -140)
    b2.inputs['Strength'].default_value = 0.85
    b2.inputs['Distance'].default_value = float(P['bark_relief'])
    nt.links.new(coarse.outputs['Fac'], b2.inputs['Height'])
    nt.links.new(b1.outputs['Normal'], b2.inputs['Normal'])
    nt.links.new(b2.outputs['Normal'], b.inputs['Normal'])

    set_if(b, 'Roughness', 0.86)
    set_if(b, 'Specular IOR Level', 0.18)
    return m


def leaf_material():
    """A small broadleaf. Thin, so it is lit through as much as on, and the
    variation between leaves comes from the instancer rather than a texture."""
    m, nt, b = principled("bonsai_leaf")
    n = nt.nodes
    # Random per instance: object-info Random is a free per-leaf constant, and
    # a canopy where every leaf is the same green is the strongest tell there is.
    oi = n.new('ShaderNodeObjectInfo'); oi.location = (-900, 300)
    ramp = n.new('ShaderNodeValToRGB'); ramp.location = (-660, 300)
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.021, 0.062, 0.014, 1)   # deep shade
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (0.098, 0.155, 0.031, 1)   # sunlit new growth
    nt.links.new(oi.outputs['Random'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])

    nz = n.new('ShaderNodeTexNoise'); nz.location = (-660, -160)
    nz.inputs['Scale'].default_value = 300.0
    bp = n.new('ShaderNodeBump'); bp.location = (-420, -160)
    bp.inputs['Strength'].default_value = 0.25
    bp.inputs['Distance'].default_value = 0.0004
    nt.links.new(nz.outputs['Fac'], bp.inputs['Height'])
    nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])

    set_if(b, 'Roughness', 0.52)
    set_if(b, 'Subsurface Weight', 0.22)
    set_if(b, 'Subsurface Radius', (0.012, 0.026, 0.008))
    set_if(b, 'Subsurface Scale', 0.004)
    set_if(b, 'Specular IOR Level', 0.30)
    return m


def glaze_material():
    """The pot: a dark satin glaze. Glazed ceramic is the one thing in the
    picture with a tight highlight, which is what makes it read as fired clay
    next to all the rough stone around it."""
    m, nt, b = principled("bonsai_pot")
    n = nt.nodes
    tc = n.new('ShaderNodeTexCoord'); tc.location = (-900, 0)
    nz = n.new('ShaderNodeTexNoise'); nz.location = (-700, 0)
    nz.inputs['Scale'].default_value = 60.0
    nz.inputs['Detail'].default_value = 6.0
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    mx = n.new('ShaderNodeMixRGB'); mx.location = (-460, 120)
    mx.inputs[0].default_value = 0.55
    mx.inputs[1].default_value = (0.016, 0.019, 0.021, 1)
    mx.inputs[2].default_value = (0.040, 0.046, 0.047, 1)
    nt.links.new(nz.outputs['Fac'], mx.inputs[0])
    nt.links.new(mx.outputs['Color'], b.inputs['Base Color'])
    rg = n.new('ShaderNodeMapRange'); rg.location = (-460, -180)
    rg.inputs['To Min'].default_value = 0.16
    rg.inputs['To Max'].default_value = 0.34
    nt.links.new(nz.outputs['Fac'], rg.inputs['Value'])
    nt.links.new(rg.outputs['Result'], b.inputs['Roughness'])
    set_if(b, 'Specular IOR Level', 0.55)
    return m


def gravel_material():
    """Raked gravel. The rings are a sine of the distance from the pedestal,
    which is what a rake actually leaves, and the grain is noise on top."""
    m, nt, b = principled("zen_gravel")
    n = nt.nodes
    tc = n.new('ShaderNodeTexCoord'); tc.location = (-1400, 0)
    # distance from the centre of the garden
    sep = n.new('ShaderNodeSeparateXYZ'); sep.location = (-1220, 120)
    nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
    dot = n.new('ShaderNodeVectorMath'); dot.location = (-1220, -140)
    dot.operation = 'LENGTH'
    nt.links.new(tc.outputs['Object'], dot.inputs[0])

    # wobble the radius a little so the rings are hand-raked, not machined
    wob = n.new('ShaderNodeTexNoise'); wob.location = (-1220, -380)
    wob.inputs['Scale'].default_value = 3.0
    nt.links.new(tc.outputs['Object'], wob.inputs['Vector'])
    add = n.new('ShaderNodeMath'); add.location = (-1000, -200)
    add.operation = 'MULTIPLY_ADD'
    add.inputs[1].default_value = 0.035
    nt.links.new(wob.outputs['Fac'], add.inputs[0])
    nt.links.new(dot.outputs['Value'], add.inputs[2])

    mul = n.new('ShaderNodeMath'); mul.location = (-820, -200)
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = float(P['rake_freq'])
    nt.links.new(add.outputs['Value'], mul.inputs[0])
    sin = n.new('ShaderNodeMath'); sin.location = (-640, -200)
    sin.operation = 'SINE'
    nt.links.new(mul.outputs['Value'], sin.inputs[0])

    grain = n.new('ShaderNodeTexNoise'); grain.location = (-820, 220)
    grain.inputs['Scale'].default_value = 420.0
    grain.inputs['Detail'].default_value = 10.0
    nt.links.new(tc.outputs['Object'], grain.inputs['Vector'])

    mx = n.new('ShaderNodeMixRGB'); mx.location = (-460, 200)
    # Grey granite chippings, not sand. The brighter values this had were
    # blowing out under the key and taking the whole lower half of the frame
    # with them — a raked garden is a mid-grey, and it reads far darker than
    # people expect once there is a bright sky over it.
    mx.inputs[1].default_value = (0.056, 0.050, 0.042, 1)
    mx.inputs[2].default_value = (0.112, 0.101, 0.085, 1)
    nt.links.new(grain.outputs['Fac'], mx.inputs[0])
    nt.links.new(mx.outputs['Color'], b.inputs['Base Color'])

    # rake furrows first, then the grain of the stones over them
    b1 = n.new('ShaderNodeBump'); b1.location = (-460, -420)
    b1.inputs['Strength'].default_value = float(P['rake_depth'])
    b1.inputs['Distance'].default_value = 0.010
    nt.links.new(sin.outputs['Value'], b1.inputs['Height'])
    b2 = n.new('ShaderNodeBump'); b2.location = (-260, -260)
    b2.inputs['Strength'].default_value = 0.55
    b2.inputs['Distance'].default_value = 0.0022
    nt.links.new(grain.outputs['Fac'], b2.inputs['Height'])
    nt.links.new(b1.outputs['Normal'], b2.inputs['Normal'])
    nt.links.new(b2.outputs['Normal'], b.inputs['Normal'])

    set_if(b, 'Roughness', 0.93)
    set_if(b, 'Specular IOR Level', 0.22)
    return m


M_BARK = bark_material()
M_LEAF = leaf_material()
M_POT = glaze_material()
M_GRAVEL = gravel_material()
M_SOIL = noisy("bonsai_soil", (0.006, 0.005, 0.004), (0.026, 0.020, 0.014),
               scale=700.0, rough=0.96, bump=0.9, detail=12.0)
M_MOSS = noisy("bonsai_moss", (0.014, 0.043, 0.010), (0.048, 0.098, 0.022),
               scale=500.0, rough=0.90, bump=0.8, detail=10.0)
M_STONE = noisy("pedestal_stone", (0.021, 0.019, 0.016), (0.058, 0.053, 0.045),
                scale=34.0, rough=0.80, bump=0.35, detail=9.0)
M_ROCK = noisy("garden_rock", (0.030, 0.029, 0.027), (0.098, 0.092, 0.083),
               scale=22.0, rough=0.84, bump=0.55, detail=10.0, distortion=1.2)
M_WALL = noisy("garden_wall", (0.075, 0.060, 0.044), (0.140, 0.115, 0.085),
               scale=9.0, rough=0.93, bump=0.22, detail=7.0, coord='Object')


# ---- the trunk, as one spine both the mesh and the branches read ------------
def trunk_spine(t):
    """Position and tangent at height fraction `t` up the trunk.

    A bonsai trunk is never straight and never a single arc — it is a shallow
    S that changes plane as it rises, which is what makes it read as old rather
    than as bent wire. Sampled by the mesh builder and by the branch placer, so
    the two cannot disagree about where the trunk is.
    """
    h = float(P['trunk_h'])
    s = float(P['sway'])
    turns = float(P['sway_turns'])
    a = t * turns * math.tau
    # the sway dies out toward the apex, so the top is calmer than the base
    damp = (1.0 - t) ** 0.75 + 0.15
    x = s * math.sin(a) * damp
    y = s * 0.55 * (math.cos(a * 0.8) - 1.0) * damp
    z = t * h
    lean = float(P['lean'])
    y = y + math.sin(lean) * z
    return Vector((x, y, SOIL_Z + z))


def trunk_radius(t):
    r0, r1 = float(P['trunk_r0']), float(P['trunk_r1'])
    k = float(P['trunk_taper'])
    r = r1 + (r0 - r1) * ((1.0 - t) ** k)
    # the nebari: a hard flare in the last few centimetres before the soil
    return r + r0 * 0.55 * max(0.0, (0.055 - t)) / 0.055 if t < 0.055 else r


def tangent(t, d=1e-3):
    a = trunk_spine(max(0.0, t - d))
    b = trunk_spine(min(1.0, t + d))
    return (b - a).normalized()


def ring_frame(tan):
    """A stable pair of axes across the tangent, so the tube does not twist."""
    up = Vector((0, 0, 1))
    if abs(tan.dot(up)) > 0.98:
        up = Vector((1, 0, 0))
    u = tan.cross(up).normalized()
    v = tan.cross(u).normalized()
    return u, v


def add_tube(bm, pts, radii, rings, mat_idx, lumpy=0.0, seed=0):
    """A tapered tube through `pts`. Used for the trunk and every branch."""
    r = np.random.default_rng(seed)
    prev = None
    first = len(bm.faces)
    for i, (c, rad) in enumerate(zip(pts, radii)):
        if i == 0:
            tan = (pts[1] - pts[0]).normalized()
        elif i == len(pts) - 1:
            tan = (pts[-1] - pts[-2]).normalized()
        else:
            tan = (pts[i + 1] - pts[i - 1]).normalized()
        u, v = ring_frame(tan)
        ring = []
        for k in range(rings):
            th = k / rings * math.tau
            # a trunk is not a circle in section; lumpiness is most of what
            # separates a tree from a length of dowel
            wob = 1.0 + lumpy * (r.random() - 0.5) * 0.6 \
                      + lumpy * 0.35 * math.sin(th * 3.0 + i * 0.7)
            p = c + (u * math.cos(th) + v * math.sin(th)) * rad * wob
            ring.append(bm.verts.new(p))
        bm.verts.ensure_lookup_table()
        if prev:
            for k in range(rings):
                f = bm.faces.new((prev[k], prev[(k + 1) % rings],
                                  ring[(k + 1) % rings], ring[k]))
                f.material_index = mat_idx
        prev = ring
    # cap the tip so a branch does not show a hole end-on
    if prev:
        f = bm.faces.new(prev)
        f.material_index = mat_idx
    return first


SLOT_BARK = 0

bm = bmesh.new()

# --- the trunk itself
seg = int(P['trunk_seg'])
tp = [trunk_spine(i / seg) for i in range(seg + 1)]
tr = [trunk_radius(i / seg) for i in range(seg + 1)]
add_tube(bm, tp, tr, int(P['trunk_ring']), SLOT_BARK, lumpy=0.30,
         seed=int(P['seed']))


# --- branches, one per pad
def branch_points(t0, ang, length, drop):
    """A branch leaves the trunk, runs out, and falls as it goes.

    Bonsai branches are trained down and out; a branch that rises reads as a
    sapling. The fall is quadratic in distance, so it leaves the trunk close to
    horizontal and only drops once it is clear of it.
    """
    base = trunk_spine(t0)
    out = Vector((math.cos(ang), math.sin(ang), 0.0))
    pts, radii = [], []
    n = int(P['branch_seg'])
    r0 = float(P['branch_r']) * (1.0 - 0.45 * t0)
    for i in range(n + 1):
        s = i / n
        # start inside the trunk so the join is buried, not butted against it
        d = (s * 1.06 - 0.06) * length
        z = -drop * (s ** 1.7) * length
        pts.append(base + out * d + Vector((0, 0, z)))
        radii.append(r0 * (1.0 - 0.72 * s))
    return pts, radii


PADS = []
for i in range(int(P['pads'])):
    f = i / max(1, int(P['pads']) - 1)
    t0 = float(P['pad_lo']) + (float(P['pad_hi']) - float(P['pad_lo'])) * f
    t0 = min(t0, 0.97)
    # Branches go round the trunk at the golden angle for the same reason the
    # violet's leaves do: no two neighbours in height are neighbours in angle.
    ang = i * math.radians(137.507) + 0.6
    scale = 1.0 - float(P['pad_falloff']) * f
    length = float(P['pad_r']) * 1.55 * scale
    pts, radii = branch_points(t0, ang, length, float(P['pad_droop']))
    add_tube(bm, pts, radii, 8, SLOT_BARK, lumpy=0.18, seed=int(P['seed']) + i + 1)
    PADS.append(dict(tip=pts[-1], ang=ang, r=float(P['pad_r']) * scale, f=f))

# the apex carries its own pad, sitting directly on the top of the trunk
PADS.append(dict(tip=trunk_spine(1.0) + Vector((0, 0, 0.004)), ang=0.0,
                 r=float(P['pad_r']) * (1.0 - float(P['pad_falloff'])) * 1.05,
                 f=1.0))

tree_me = bpy.data.meshes.new("bonsai_tree")
bm.to_mesh(tree_me)
bm.free()
tree_me.materials.append(M_BARK)
for poly in tree_me.polygons:
    poly.use_smooth = True
tree = bpy.data.objects.new("bonsai_tree", tree_me)
bpy.context.collection.objects.link(tree)
sub = tree.modifiers.new("smooth", 'SUBSURF')
sub.levels, sub.render_levels = 1, 2


# ---- one leaf, instanced thousands of times --------------------------------
def make_leaf():
    """A small ovate leaf with a fold down its midrib.

    Flat cards catch the light all at once and a canopy of them flickers; a
    folded one always has a lit half and a shaded half, which is what makes
    instanced foliage look like foliage.
    """
    L = float(P['leaf_len'])
    W = L * 0.52
    b = bmesh.new()
    U, V = 5, 7
    grid = []
    for a in range(U):
        col = []
        for c in range(V):
            su = (a / (U - 1) - 0.5) * 2.0
            bt = c / (V - 1)
            w = math.sin(math.pi * (0.06 + 0.88 * bt ** 0.8)) ** 0.7
            col.append(b.verts.new((su * w * W,
                                    bt * L,
                                    abs(su) * w * W * 0.30 - 0.05 * L * bt * bt)))
        grid.append(col)
    b.verts.ensure_lookup_table()
    for a in range(U - 1):
        for c in range(V - 1):
            b.faces.new((grid[a][c], grid[a][c + 1],
                         grid[a + 1][c + 1], grid[a + 1][c]))
    me = bpy.data.meshes.new("bonsai_leaf")
    b.to_mesh(me); b.free()
    me.materials.append(M_LEAF)
    for poly in me.polygons:
        poly.use_smooth = True
    ob = bpy.data.objects.new("bonsai_leaf", me)
    bpy.context.collection.objects.link(ob)
    # it exists only to be instanced
    ob.hide_render = ob.hide_viewport = True
    return ob


LEAF = make_leaf()


def add_pad(idx, pad):
    """A flattened shell of foliage, scattered with leaves.

    The shell stays in the render rather than being hidden: it is the dark mass
    inside the pad, and without it every gap between leaves shows sky straight
    through, which is the thing that makes cheap foliage look like a decal.
    """
    r = pad['r']
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=r,
                                          location=pad['tip'])
    shell = bpy.context.active_object
    shell.name = f"pad_{idx}"
    shell.scale = (1.0, 1.0, float(P['pad_flat']))
    # break the sphere so the silhouette is not a dome
    me = shell.data
    g = np.random.default_rng(int(P['seed']) * 31 + idx)
    for v in me.vertices:
        v.co *= 1.0 + 0.30 * (g.random() - 0.5)
        v.co.z += 0.14 * r * (g.random() - 0.5)
    me.materials.append(M_LEAF)
    for poly in me.polygons:
        poly.use_smooth = True

    mod = shell.modifiers.new(f"leaves_{idx}", 'PARTICLE_SYSTEM')
    ps = shell.particle_systems[-1]
    st = ps.settings
    st.type = 'HAIR'
    st.use_advanced_hair = True
    st.count = int(float(P['leaves']) * (0.55 + 0.45 * (1.0 - pad['f'])))
    # For hair rendered as an object it is the HAIR LENGTH that scales the
    # instance, not `particle_size` — at 0.001 every leaf came out a hundredth
    # of a millimetre across, present in the depsgraph and invisible in the
    # render. Leave this at 1.0 and set the real leaf size on the leaf mesh.
    st.hair_length = 1.0
    st.emit_from = 'FACE'
    st.use_emit_random = True
    st.distribution = 'RAND'
    st.render_type = 'OBJECT'
    st.instance_object = LEAF
    st.particle_size = 1.0
    st.size_random = float(P['leaf_rand'])
    st.use_rotation_instance = True
    st.use_rotations = True
    st.rotation_mode = 'NOR'
    st.rotation_factor_random = float(P['leaf_lean'])
    st.phase_factor = 0.0
    st.phase_factor_random = 2.0
    st.child_type = 'NONE'
    ps.seed = int(P['seed']) + idx          # on the system, not on its settings
    try:
        shell.show_instancer_for_render = True
    except Exception:
        pass
    return shell


for i, pad in enumerate(PADS):
    add_pad(i, pad)


# ---- pot, soil, moss, pedestal ---------------------------------------------
def box(name, w, d, h, loc, mat, bevel=0.0):
    """A cube of exactly (w, d, h), centred on `loc`.

    `size=1.0` already makes a cube one unit across, so the scale *is* the
    dimension. Halving it here — the reflex from `size=2.0` cubes — built the
    whole set at half scale, which is what left the pot hanging in the air
    above a pedestal that stopped short of it.
    """
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (w, d, h)
    ob.data.materials.append(mat)
    if bevel:
        bv = ob.modifiers.new("bevel", 'BEVEL')
        bv.width = bevel
        bv.segments = 3
    return ob


PW, PD, PH = float(P['pot_w']), float(P['pot_d']), float(P['pot_h'])
PED_H = float(P['ped_h'])

# The pot is a shallow rectangle with a lip, which is the classic bonsai form.
pot = box("pot", PW, PD, PH, (0, 0, PED_H + PH / 2), M_POT, bevel=0.004)
lip = box("pot_lip", PW * 1.055, PD * 1.075, PH * 0.16,
          (0, 0, PED_H + PH - PH * 0.06), M_POT, bevel=0.003)
# four small feet, so the pot sits on the pedestal rather than melting into it
for sx in (-1, 1):
    for sy in (-1, 1):
        box(f"foot_{sx}_{sy}", 0.030, 0.030, 0.016,
            (sx * PW * 0.35, sy * PD * 0.32, PED_H + 0.008), M_POT, bevel=0.002)

soil = box("soil", PW * 0.93, PD * 0.90, 0.012,
           (0, 0, SOIL_Z - 0.004), M_SOIL)

# moss over the soil, in a couple of low mounds rather than a flat sheet
for i in range(7):
    a = rnd.uniform(0, math.tau)
    rr = rnd.uniform(0.0, 0.40)
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=2, radius=rnd.uniform(0.020, 0.042),
        location=(math.cos(a) * PW * rr, math.sin(a) * PD * rr, SOIL_Z - 0.004))
    mo = bpy.context.active_object
    mo.name = f"moss_{i}"
    mo.scale = (1.0, 1.0, 0.22)
    mo.data.materials.append(M_MOSS)
    for poly in mo.data.polygons:
        poly.use_smooth = True

ped = box("pedestal", float(P['ped_w']), float(P['ped_w']) * 0.92, PED_H,
          (0, 0, PED_H / 2), M_STONE, bevel=0.008)
# a cap and a plinth, so it reads as cut stone rather than an extruded rectangle
box("ped_cap", float(P['ped_w']) * 1.09, float(P['ped_w']) * 1.0, 0.030,
    (0, 0, PED_H - 0.015), M_STONE, bevel=0.005)
box("ped_base", float(P['ped_w']) * 1.14, float(P['ped_w']) * 1.05, 0.042,
    (0, 0, 0.021), M_STONE, bevel=0.006)


# ---- the garden ------------------------------------------------------------
bpy.ops.mesh.primitive_plane_add(size=14.0, location=(0, 0, 0))
ground = bpy.context.active_object
ground.name = "gravel"
ground.data.materials.append(M_GRAVEL)

for i in range(int(P['rocks'])):
    a = rnd.uniform(0, math.tau)
    dist = rnd.uniform(0.62, 1.35)
    s = rnd.uniform(0.055, 0.135)
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=3, radius=s,
        location=(math.cos(a) * dist, math.sin(a) * dist + 0.25, s * 0.42))
    rk = bpy.context.active_object
    rk.name = f"rock_{i}"
    g = np.random.default_rng(int(P['seed']) * 7 + i)
    for v in rk.data.vertices:
        v.co *= 1.0 + 0.40 * (g.random() - 0.5)
    rk.scale = (1.0, rnd.uniform(0.7, 1.1), rnd.uniform(0.42, 0.66))
    rk.rotation_euler = (0, 0, rnd.uniform(0, math.tau))
    rk.data.materials.append(M_ROCK)
    for poly in rk.data.polygons:
        poly.use_smooth = True

# A rendered wall behind, close enough to catch light and far enough to go soft.
# It exists to stop the tree being cut out against a void — a bonsai photographed
# against nothing reads as a product shot, not a garden.
WALL_H = float(P['wall_h'])
wall = box("wall", 16.0, 0.14, WALL_H, (0, float(P['wall_y']), WALL_H / 2), M_WALL)
box("wall_cap", 16.0, 0.26, 0.07, (0, float(P['wall_y']), WALL_H + 0.03), M_STONE,
    bevel=0.014)


# ---- light -----------------------------------------------------------------
world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
wn, wl = world.node_tree.nodes, world.node_tree.links
sky = wn.new('ShaderNodeTexSky')
sky.location = (-400, 0)
try:
    sky.sky_type = 'NISHITA'
    sky.sun_elevation = math.radians(11.0)
    sky.sun_rotation = math.radians(-40.0)
    sky.altitude = 120.0
    sky.air_density = 1.5
    sky.dust_density = 2.4        # late afternoon haze, which softens everything
except Exception:
    pass
bg = wn["Background"]
# The gravel is a flat plane facing a whole hemisphere of sky, so it collects
# far more light than the tree does and blows out long before the tree is
# correctly exposed. Everything here is quieter than it first wants to be.
bg.inputs[1].default_value = 0.40
wl.new(sky.outputs['Color'], bg.inputs[0])

# A sun, not a box of area lights. Outdoors, everything is one hard warm key
# and a large cool sky, and it is the *direction* that sells it — a low sun
# rakes across the gravel and turns the furrows into ridges and shadows, which
# is the only reason to have raked them. Three soft area lights lit this
# evenly from everywhere and produced a shadowless overcast that no amount of
# material tuning was going to rescue.
_saz = math.radians(float(P['sun_az']))
_sel = math.radians(float(P['sun_elev']))
_sr = 6.0
SUN_AT = Vector((math.sin(_saz) * _sr * math.cos(_sel),
                 -math.cos(_saz) * _sr * math.cos(_sel),
                 float(P['cam_look']) + _sr * math.sin(_sel)))

sun = bpy.data.lights.new("sun", 'SUN')
sun.energy = 8.5
sun.color = (1.0, 0.835, 0.635)
sun.angle = math.radians(1.6)      # a crisp shadow, softened just off a point
sun_ob = bpy.data.objects.new("sun", sun)
sun_ob.location = SUN_AT
bpy.context.collection.objects.link(sun_ob)

# The shadow side is now facing camera, so the fill is doing real work rather
# than tidying edges: it is the cool light the sky and the gravel throw back.
fill = bpy.data.lights.new("fill", 'AREA')
fill.energy = 58.0
fill.size = 3.0
fill.color = (0.72, 0.81, 1.0)
fill_ob = bpy.data.objects.new("fill", fill)
fill_ob.location = (-1.10, -2.35, 1.45)
bpy.context.collection.objects.link(fill_ob)

# A small warm kicker on the shaded right flank, so the trunk keeps its round.
rim = bpy.data.lights.new("rim", 'AREA')
rim.energy = 26.0
rim.size = 1.0
rim.color = (1.0, 0.88, 0.70)
rim_ob = bpy.data.objects.new("rim", rim)
rim_ob.location = (2.15, -0.65, 1.05)
bpy.context.collection.objects.link(rim_ob)


def aim(obj, at):
    d = Vector(at) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


LOOK = Vector((0, 0, float(P['cam_look'])))
for L in (sun_ob, fill_ob, rim_ob):
    aim(L, LOOK)


# ---- camera ----------------------------------------------------------------
cam_d = float(P['cam_dist'])
el = math.radians(float(P['cam_elev']))
az = math.radians(float(P['cam_az']))
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = float(P['lens'])
cam_data.dof.use_dof = True
cam_data.dof.aperture_fstop = float(P['fstop'])
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (math.sin(az) * cam_d * math.cos(el),
                -math.cos(az) * cam_d * math.cos(el),
                float(P['cam_look']) + cam_d * math.sin(el))
bpy.context.collection.objects.link(cam)
aim(cam, LOOK)
scene.camera = cam
# focus on the trunk, so the near pad and the wall both fall away
cam_data.dof.focus_distance = (cam.location - Vector((0, 0, SOIL_Z + 0.13))).length


# ---- render ----------------------------------------------------------------
scene.render.film_transparent = False
# One setting per try. These are dynamic enums read out of the OCIO config, so
# a name that does not exist raises — and grouping them meant one bad name took
# the exposure down with it and left whatever the previous run had set. Note
# there is no 'AgX - Medium Contrast': the ladder goes Medium Low, Base, Medium
# High.
for _k, _v in (('view_transform', 'AgX'), ('look', 'AgX - Punchy')):
    try:
        setattr(scene.view_settings, _k, _v)
    except Exception:
        pass
try:
    scene.view_settings.exposure = float(P['exposure'])
except Exception:
    pass

if str(P['engine']).upper().startswith('CYCLES'):
    scene.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'OPTIX'
        prefs.get_devices()
        for dv in prefs.devices:
            dv.use = (dv.type == 'OPTIX')
        scene.cycles.device = 'GPU'
    except Exception:
        scene.cycles.device = 'CPU'
    scene.cycles.samples = int(P['samples'])
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.use_denoising = True
    try:
        scene.cycles.denoiser = 'OPTIX'
    except Exception:
        pass
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False

scene.render.image_settings.file_format = 'WEBP'
try:
    scene.render.image_settings.quality = int(P['quality'])
except Exception:
    pass

os.makedirs(OUT_DIR, exist_ok=True)


def shoot(name, w, h):
    scene.render.resolution_x, scene.render.resolution_y = int(w), int(h)
    scene.render.resolution_percentage = 100
    out = os.path.join(OUT_DIR, name)
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    return out, (os.path.getsize(out) if os.path.exists(out) else 0)


big, big_b = shoot('bonsai.webp', P['big_x'], P['big_y'])
thumb, thumb_b = shoot('bonsai-thumb.webp', P['thumb_x'], P['thumb_y'])

# Two things the wall can do to this picture, both silently, and both of which
# look like a material problem rather than a lighting one.
#
# One: stand between the sun and the tree. A SUN is directional, so that is
# pure trigonometry — follow the ray back from the canopy and see how high it
# is by the time it gets to the wall.
#
# Two — and this is the one that actually bit — clear the tree perfectly well
# and still lay its own shadow across the whole garden. A 3 m wall under a 28
# degree sun throws it 5.6 m, which covered every piece of gravel in frame and
# left a scene that read as flat overcast while the tree above it was in full
# sun. So this measures how far forward that shadow reaches as well.
_d = (SUN_AT - Vector((0, 0, 0.90)))
_z_at_wall = (0.90 + _d.z * (float(P['wall_y']) / _d.y)) if _d.y > 1e-6 else 1e9
_clears = _z_at_wall > float(P['wall_h'])

_hz = math.hypot(_d.x, _d.y) or 1e-9
_shadow_len = float(P['wall_h']) * (_hz / max(_d.z, 1e-9))
_shadow_to_y = float(P['wall_y']) - _shadow_len * (_d.y / _hz) * -1.0
_shadow_to_y = float(P['wall_y']) - _shadow_len * (abs(_d.y) / _hz)
_fg_lit = _shadow_to_y > 0.80        # clear of the pedestal and the near gravel

result = {
    'sun_clears_wall': bool(_clears),
    'sun_ray_height_at_wall': round(float(_z_at_wall), 3),
    'wall_shadow_reaches_y': round(float(_shadow_to_y), 3),
    'foreground_lit': bool(_fg_lit),
    'wall_height': float(P['wall_h']),
    'big': big, 'big_bytes': big_b,
    'thumb': thumb, 'thumb_bytes': thumb_b,
    'pads': len(PADS),
    'leaves_total': sum(len(o.particle_systems) and o.particle_systems[0].settings.count
                        for o in bpy.data.objects if o.name.startswith('pad_')),
    'tris': sum(len(o.data.polygons) for o in bpy.data.objects
                if getattr(o, 'type', None) == 'MESH'),
    'device': getattr(scene.cycles, 'device', None),
}
print("bonsai built:", result)
