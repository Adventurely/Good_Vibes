"""Hemerocallis fulva — the orange daylily — as a parameter set.

Run inside Blender. Builds one mesh for the whole plant plus an armature that
bends it, and renders a product shot. `export_web.py` runs this same file and
translates the result for the browser.

Read `.claude/skills/plant-assets/SKILL.md` before changing anything here. The
three facts from `species/daylily.md` that this file is organised around, and
that a generic foliage generator gets wrong:

**The fan is a plane.** Daylily leaves are strictly distichous — two-ranked,
alternating exactly 180 degrees, all in one flattened plane like a hand of
cards. Every instinct in a procedural generator is to distribute them radially,
and that instinct produces something unmistakably not-a-daylily which is very
hard for a non-botanist to name as wrong. All the variety comes from rotating
whole fans against each other, never from breaking the phyllotaxy inside one.

**The leaf is a cantilever, not an arc.** Rigid and near-straight for the basal
third to half, then curvature increasing monotonically to a tip that may hang
past vertical. And the inflection point *moves toward the base* as turgor drops
— a fixed-shape leaf that merely rotates downward when dry reads as a hinge.

**Six tepals in two different whorls.** Three outer sepals, narrower and
smoother; three inner petals, half again as wide and carrying the ruffling.
Making all six identical is the classic modelling bug for this genus. And they
are fused at the base into a perianth tube: a six-petal fan with no tube reads
as a lily, which this plant emphatically is not.
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, Euler, Matrix

# ---- the whole plant, as numbers ------------------------------------------
# Sizes are metres. A nursery-pot specimen at the small end of "standard":
# leaves 46 cm, scapes 68 cm, flowers 11 cm across.
P = dict(
    # --- architecture. `fans` is the master vigour parameter: scape count
    # derives from mature fans, so a thin clump is a clump with few flowers.
    fans        = 3,        # 1 in year one, 6-12 at year three
    fan_splay   = 42.0,     # degrees between neighbouring fan planes. Offsets
                            # sit 20-60 deg off their parent, never uniform
    fan_spread  = 0.030,    # how far offset crowns sit from the parent
    leaves      = 15,       # per fan, strictly two-ranked; real fans 6-20
    leaf_len    = 0.62,
    leaf_wide   = 0.0115,   # half-width at the widest point: a 2.3 cm blade
    rank_grad   = 0.58,     # innermost leaf length as a fraction of outermost
    jitter      = 3.0,      # degrees out of the fan plane. 0 is a cardboard
                            # cut-out; past 8 the fan stops being a plane
    splay       = 4.0,      # and a *progressive* 2-6 degrees per rank, so
                            # the fan opens like a spread hand of cards.
                            # Without it the leaves that share a side nest
                            # inside one plane and pass through each other
    internode   = 0.0038,   # how far up the crown each successive leaf sits.
                            # The crown is compressed — 2-5 cm for the whole fan
                            # — so this has to stay small or the fan telescopes

    # --- leaf form. See the cantilever note in the docstring.
    keel_base   = 108.0,    # interior V angle where the blade leaves the crown
    keel_tip    = 170.0,    # and where it ends: the V opens as it goes
    elev_out    = 72.0,     # outermost leaf's launch angle above horizontal
    elev_in     = 86.0,     # innermost: nearly vertical
    # 88 sent the outer leaves almost straight down and the foliage collapsed
    # into a tuft with the scapes towering over it. A daylily's foliage is a
    # wide arching mound about half the height of its scapes, not a tussock.
    decl_out    = 46.0,     # outermost tip, degrees below horizontal
    decl_in     = 4.0,      # innermost barely turns over at all
    onset_out   = 0.42,     # straight fraction before the bend starts
    onset_in    = 0.58,
    twist       = 44.0,     # axial twist base to tip, degrees
    tip_len     = 0.16,     # fraction of the blade given to the acuminate point

    # --- scape and bloom
    scapes      = 2,
    scape_h     = 0.62,     # standards are 60-90 cm and stand about half
                            # again above the foliage, not three times it
    scape_r     = 0.0042,   # radius at the base
    branches    = 3,        # ascending, upper shorter than lower
    buds        = 13,       # a real scape carries 8-40 at mixed maturities
    open_blooms = 2,        # a mature scape opens 1-3 a day
    spent       = 2,        # and yesterday's are still hanging there
    flower_d    = 0.112,    # face-on diameter
    tube_len    = 0.030,    # the perianth tube. Omit it and this is a lily
    sepal_ratio = 0.60,     # sepal width as a fraction of petal width
    recurve     = 34.0,     # degrees the tepal tips bend back
    ruffle      = 0.0055,   # petal margin ruffle amplitude, metres

    # --- condition. Shared vocabulary across the three species; the same
    # generator run at a different point, never a second model.
    droop       = 0.0,      # 0 turgid, 1 collapsed — this is turgor, inverted
    chlorosis   = 0.0,      # 0 green, 1 yellow
    necrosis    = 0.0,      # tip dieback front, 0..1 from the tip inward
    bloom_open  = 1.0,
    spent_t     = 1.0,      # how far yesterday's flowers have twisted shut
    spent_pinch = 0.36,     # how far in the rag draws toward its own axis at
                            # the tip
    spent_recurve = 74.0,   # extra degrees the tip curls over when spent. At
                            # this value the tip comes back to the tepal's own
                            # base line — the wad really does hook right round
                            # — which is why the twist has to be bounded by the
                            # arc the tepals give up rather than by the shape
    spent_shell = 0.0024,   # metres the two whorls part radially as they
                            # collapse: the petals lie over the sepals rather
                            # than merging into one surface. Appearance only —
                            # the wedge bound below is what makes the collapse
                            # safe, and the checks read zero with this at 0
    spent_narrow = 0.42,    # the share of its open arc a crumpled tepal keeps.
                            # This is what buys the twist its room: the arc a
                            # tepal gives up is the angle it can rotate through
                            # without reaching its neighbour
    spent_twist = 34.0,     # degrees the rag winds through, base to tip. It is
                            # CLAMPED to the slack computed in add_flower, so
                            # raising it past what the tepals have given up
                            # does nothing rather than producing a knot. The
                            # spent tepal curls almost right round — its tip
                            # comes back to its own base line — so a twist that
                            # crosses a wedge boundary walks one tepal's tip
                            # through the next one's waist, and no reshaping
                            # downstream recovers it

    # --- production
    seed        = 11,
    tex         = 1024,
    samples     = 200,
    res_x       = 1100,
    res_y       = 1400,
    cam_dist    = 2.05,     # metres; the clump is about 1.0 across
    cam_elev    = 14.0,
    cam_az      = 34.0,
    lens        = 70.0,
    fstop       = 6.0,
    env_str     = 1.0,
    engine      = 'CYCLES',
)

_over = dict(globals().get('DAYLILY_P') or {})
if '--' in sys.argv:
    for _a in sys.argv[sys.argv.index('--') + 1:]:
        if '=' in _a:
            _k, _v = _a.split('=', 1)
            try:
                _over[_k] = float(_v) if '.' in _v else int(_v)
            except ValueError:
                _over[_k] = _v
P.update(_over)

TEX_ARRAYS = {}
POT_TOP = 0.205                # the rim of a 24 cm nursery pot
SOIL_Z = 0.190
# The crown is planted 2.0-2.5 cm BELOW the surface — deeper invites rot,
# shallower invites frost heave — so the blades emerge from the compost and
# nothing above it may look like a stem. Sitting it proud of the soil, which is
# what the first pass did, put three green thimbles on the surface.
CROWN_Z = SOIL_Z - 0.020
RIM_R, RIM_T = 0.117, 0.006
RIM_TOP = POT_TOP + RIM_T

rng = np.random.default_rng(int(P['seed']))
import random as _random
rnd = _random.Random(int(P['seed']))

scene = bpy.context.scene


def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
                 bpy.data.armatures, bpy.data.actions, bpy.data.curves):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)


clear_scene()


# ---- small maths -----------------------------------------------------------
def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a + 1e-12), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def fbm(shape, res, octaves=5, rough=0.55):
    total = np.zeros(shape)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        r = res * (2 ** o)
        g = rng.random((r + 1, r + 1))
        yi = np.linspace(0, r, shape[0]); xi = np.linspace(0, r, shape[1])
        y0 = np.floor(yi).astype(int); x0 = np.floor(xi).astype(int)
        y1 = np.minimum(y0 + 1, r);     x1 = np.minimum(x0 + 1, r)
        fy = (yi - y0)[:, None]; fx = (xi - x0)[None, :]
        fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
        a = g[np.ix_(y0, x0)]; b = g[np.ix_(y0, x1)]
        c = g[np.ix_(y1, x0)]; d = g[np.ix_(y1, x1)]
        total += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy)
        norm += amp; amp *= rough
    return total / norm


def make_image(name, arr):
    """arr is (N, N, 4) float with row 0 at v = 0 — the direction the UVs run.

    No row reversal. See the colour-space note in the plant-assets skill: a flip
    here runs every map backwards down its own surface, which on a strap leaf
    would put the dying tip at the base.
    """
    img = bpy.data.images.new(name, arr.shape[1], arr.shape[0],
                              alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.ascontiguousarray(arr).ravel().astype(np.float32))
    img.pack()
    return img


# ---- the leaf, which is the plant ------------------------------------------
def keel_angle(t, turgor_close):
    """Interior V angle at fraction `t` along the blade, in radians.

    Deepest at the base and opening toward the tip, and closing a further
    20-40 degrees as the leaf dries — the keel is this species' turgor gauge,
    and closing it is the first thing that must happen when `droop` rises, before
    anything bends. A leaf that bends without its section changing reads as an
    animation rather than as dehydration.
    """
    a = float(P['keel_base']) + (float(P['keel_tip']) - float(P['keel_base'])) * (t ** 0.75)
    return math.radians(a - turgor_close)


def blade_width(t):
    """Half-width along the blade, peaking 25-35% up from the base.

    A leaf widest at its base looks like an iris. `t**0.35 * (1-t)**0.75` peaks
    at 0.318, which is the middle of the observed range; the 0.05 offset keeps
    the sheathing base from pinching to nothing, and the tip still reaches zero
    so the point stays acuminate.
    """
    s = ((t + 0.05) ** 0.35) * ((1.0 - t) ** 0.75)
    return s / 0.5266


def leaf_spine(L, elev, onset, decl, n):
    """Centreline of one blade, in its own frame: +y is out, +z is up.

    A cantilever under self-weight, not a circular arc. Straight for `onset` of
    its length, then curvature increasing monotonically to the tip. Returns
    (points, tangents), both length n+1.
    """
    th0, th1 = math.radians(elev), -math.radians(decl)
    tans = []
    for i in range(n + 1):
        s = i / n
        f = 0.0 if s <= onset else ((s - onset) / (1.0 - onset)) ** 1.75
        th = th0 + (th1 - th0) * f
        tans.append(Vector((0.0, math.cos(th), math.sin(th))))
    pts, ds = [Vector((0.0, 0.0, 0.0))], L / n
    for i in range(n):
        pts.append(pts[-1] + tans[i] * ds)
    return pts, tans


def leaf_rank(i, n):
    """Rank 0..1 for leaf `i`, 0 being the oldest and outermost.

    Two-ranked means leaf 0 and leaf 1 are on opposite sides and are the two
    oldest; ranks advance in pairs inward. Returned alongside the side so the
    caller cannot get the alternation wrong by accident.
    """
    side = 1.0 if (i % 2 == 0) else -1.0
    r = (i // 2) / max(1, (n - 1) // 2)
    return r, side


def lerp(a, b, t):
    return a + (b - a) * t


# ---- one mesh for the whole plant ------------------------------------------
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
varl = bm.verts.layers.float.new("organvar")   # one constant per organ
SLOT_LEAF, SLOT_SCAPE, SLOT_TEPAL, SLOT_EYE = 0, 1, 2, 3
weights = []          # (vert_index, bone_name, weight)
bones = []            # (name, head, tail, up, parent)
BLADE_FACES = []      # (first, last) face index per blade
FREE_FACES = []       # and the distal part of each, which is what may not cross
BLADE_FAN = []        # which fan each blade belongs to, for the flatness check
FREE_FROM = 7         # station at which a blade has left the sheathing bundle
TEPAL_FACES = []      # (first, last) face index per tepal, six per flower
TEPAL_FLOWER = []     # which flower each tepal belongs to
TEPAL_WHORL = []      # 0 = outer whorl (sepal), 1 = inner whorl (petal)
TWIST_SLACK = []      # (asked, available, used) degrees of spent twist
BLOOMS = []           # (world centre, radius) of every corolla already placed
DEMOTED = []          # blooms that found nowhere to go and carry a bud instead


def frame(az, origin):
    """World transform for an organ whose local +y points along azimuth `az`.

    Note which axis gets `cos`. The obvious rotation matrix sends local +x to
    the azimuth and +y ninety degrees off it, which puts a fan's plane
    perpendicular to where its layout said — undetectable with several fans at
    random azimuths, and instantly visible on one. Local +y is the direction of
    growth here and local +x runs across the blade.
    """
    ca, sa = math.cos(az), math.sin(az)

    def to_world(x, y, z):
        return Vector((origin[0] + y * ca - x * sa,
                       origin[1] + y * sa + x * ca,
                       origin[2] + z))
    return to_world


def chain(prefix, pts, ups):
    """A bone per segment through `pts`. Returns the bone names in order."""
    names = []
    for i in range(len(pts) - 1):
        nm = f"{prefix}_{i}"
        parent = names[-1] if names else None
        bones.append((nm, pts[i].copy(), pts[i + 1].copy(), ups[i].copy(), parent))
        names.append(nm)
    return names


def bind(vidx, sv, names):
    """Weight a vertex to the chain at normalised position `sv` along it."""
    n = len(names)
    if n == 0:
        return
    f = max(0.0, min(0.999999, sv)) * n
    i = int(f)
    t = f - i
    if i >= n:
        i, t = n - 1, 1.0
    weights.append((vidx, names[i], 1.0 - t if i + 1 < n else 1.0))
    if i + 1 < n:
        weights.append((vidx, names[i + 1], t))


# ---- the blade -------------------------------------------------------------
TUBE_L = float(P['tube_len'])   # the perianth tube: the fused tepal bases
TUBE_R = 0.0062                 # and the radius of its mouth

NS, NW = 26, 9          # stations along the blade, points across it
SEGS = 5                # bones per leaf
TURGOR_CLOSE = 32.0     # degrees the keel closes between full turgor and limp


def add_leaf(fan_az, crown, i, n, tag):
    """One keeled strap blade, placed by rank within its fan.

    Rank drives length, launch angle, where the bend starts and how far the tip
    goes over — all four together, because that covariation is what makes a fan
    look grown rather than assembled. Turgor then moves the same four again, in
    the same direction the plant does: the section closes first, the inflection
    migrates toward the base, and only then does the tip go further over.
    """
    r, side = leaf_rank(i, n)
    d = float(P['droop'])

    L = float(P['leaf_len']) * lerp(1.0, float(P['rank_grad']), r) * rnd.uniform(0.93, 1.07)
    elev = lerp(P['elev_out'], P['elev_in'], r)
    onset = lerp(P['onset_out'], P['onset_in'], r) * (1.0 - 0.62 * d)
    decl = lerp(P['decl_out'], P['decl_in'], r)
    decl = decl + (118.0 - decl) * 0.55 * d
    close = TURGOR_CLOSE * d
    W = float(P['leaf_wide']) * lerp(1.0, 0.80, r)
    tw = (math.radians(float(P['twist'])) * rnd.uniform(0.55, 1.30)
          * (1.0 if rnd.random() < 0.5 else -1.0))

    # Progressive splay, not random jitter, is what separates the leaves that
    # share a side. Ranks 0, 2, 4 ... are nested inside one plane on the same
    # side of the crown, and nested is a hair away from intersecting: each one
    # has to be fanned a couple of degrees further out than the last, which is
    # what a real fan does and why it looks like a spread hand of cards.
    pair = i // 2
    npair = max(1, (n - 1) // 2)
    az = (fan_az + (0.0 if side > 0 else math.pi)
          + math.radians(float(P['splay']) * (pair - npair * 0.5)) * side
          + math.radians(rnd.uniform(-1, 1) * float(P['jitter'])))
    base = Vector((crown.x, crown.y, crown.z + float(P['internode']) * (i // 2)))
    Wf = frame(az, base)

    pts, tans = leaf_spine(L, elev, onset, decl, NS)

    # a value per organ, so the material can vary leaf to leaf without a
    # separate map: older leaves have had longer to yellow at the tips
    lv = min(1.0, max(0.0, 1.0 - r * 0.35 + rnd.uniform(-0.07, 0.07)))

    b0 = b_free = len(bm.faces)
    pending = []
    rows = []
    for j in range(NS):
        t = j / NS
        c, tan = pts[j], tans[j]
        sv_ = tan.cross(Vector((0.0, 0.0, 1.0)))
        if sv_.length < 1e-7:
            sv_ = Vector((1.0, 0.0, 0.0))
        sv_.normalize()
        uv_ = sv_.cross(tan).normalized()
        a = tw * (t ** 1.2)
        S = sv_ * math.cos(a) + uv_ * math.sin(a)
        U = uv_ * math.cos(a) - sv_ * math.sin(a)

        w = W * blade_width(t)
        rise = w * math.tan((math.pi - keel_angle(t, close)) * 0.5)
        row = []
        for k in range(NW):
            su = (k / (NW - 1)) * 2.0 - 1.0
            # 1.15 rather than 1.0 rounds the bottom of the V. A hard crease
            # along the midrib catches a specular line that no real leaf has.
            p = c + S * (su * w) + U * (rise * (abs(su) ** 1.15))
            v = bm.verts.new(Wf(p.x, p.y, p.z))
            v[varl] = lv
            row.append(v)
            pending.append((len(bm.verts) - 1, t))
        rows.append(row)

    apex = bm.verts.new(Wf(pts[NS].x, pts[NS].y, pts[NS].z))
    apex[varl] = lv
    pending.append((len(bm.verts) - 1, 1.0))
    bm.verts.ensure_lookup_table()

    # Winding decided from the geometry, never inherited. Solidify grows away
    # from the normal and anything shelled is pushed along it, so a blade that
    # faces the ground takes its thickness and its highlights with it.
    e_u = rows[NS // 2][NW // 2 + 1].co - rows[NS // 2][NW // 2].co
    e_v = rows[NS // 2 + 1][NW // 2].co - rows[NS // 2][NW // 2].co
    up_hint = Wf(0.0, 0.0, 1.0) - Wf(0.0, 0.0, 0.0)
    # Note the sign. For the quad (j,k) (j+1,k) (j+1,k+1) (j,k+1) the face
    # normal works out as e_v x e_u, which is the *opposite* of the obvious
    # e_u x e_v — get it backwards and every blade faces the floor, which the
    # `blade_facing` check reported as 230 up against 4596 down.
    quad = (((0, 0), (0, 1), (1, 1), (1, 0)) if e_u.cross(e_v).dot(up_hint) >= 0
            else ((0, 0), (1, 0), (1, 1), (0, 1)))

    for j in range(NS - 1):
        if j == FREE_FROM:
            # Below this the blades sheath one another at the crown, which is
            # what a fan *is* — counting that as clipping buries a real fault
            # under ninety-odd false ones. The violet learned this the same way.
            b_free = len(bm.faces)
        for k in range(NW - 1):
            vs = tuple(rows[j + dj][k + dk] for dj, dk in quad)
            f = bm.faces.new(vs)
            f.material_index = SLOT_LEAF
            want = {rows[j + dj][k + dk]: ((k + dk) / (NW - 1), (j + dj) / NS)
                    for dj, dk in quad}
            for lp in f.loops:
                lp[uvl].uv = want[lp.vert]
    for k in range(NW - 1):
        a_, b_ = rows[NS - 1][k], rows[NS - 1][k + 1]
        f = bm.faces.new((a_, b_, apex) if quad[1] == (0, 1) else (b_, a_, apex))
        f.material_index = SLOT_LEAF
        for lp, uu in zip(f.loops, (k / (NW - 1), (k + 1) / (NW - 1), 0.5)):
            lp[uvl].uv = (uu, 1.0)
    b1 = len(bm.faces)
    BLADE_FACES.append((b0, b1))       # the whole blade, for margin counting
    FREE_FACES.append((b_free, b1))    # and the part that must not cross

    seg_pts, seg_ups = [], []
    for s in range(SEGS + 1):
        q = pts[min(NS, int(round(s / SEGS * NS)))]
        seg_pts.append(Wf(q.x, q.y, q.z))
        seg_ups.append(Wf(q.x, q.y, q.z + 1.0) - Wf(q.x, q.y, q.z))
    names = chain(f"{tag}", seg_pts, seg_ups)
    for vi, sv in pending:
        bind(vi, sv, names)
    return L, names


# ---- the crown, which is the packed leaf bases -----------------------------
def add_crown(c, rr, hh):
    """A short whitish collar where the blades converge at soil level.

    Photographs of a daylily do show this — a 2-5 cm pale zone between the green
    leaf bases and the roots — so unlike the violet's imaginary trunk it earns
    its place. Kept low and wide so it reads as packed leaf bases rather than as
    a stem: a daylily has no stem above ground and nothing here may suggest one.
    """
    RING, ST = 14, 5
    prev = None
    for a in range(ST + 1):
        t = a / ST
        z = c.z - 0.012 + (hh + 0.012) * t
        r = rr * (1.0 - 0.34 * t ** 1.5)
        ring = [bm.verts.new((c.x + math.cos(k / RING * math.tau) * r,
                              c.y + math.sin(k / RING * math.tau) * r, z))
                for k in range(RING)]
        bm.verts.ensure_lookup_table()
        if prev is None:
            f = bm.faces.new(tuple(reversed(ring)))
            f.material_index = SLOT_SCAPE
        else:
            for k in range(RING):
                f = bm.faces.new((prev[k], prev[(k + 1) % RING],
                                  ring[(k + 1) % RING], ring[k]))
                f.material_index = SLOT_SCAPE
                for lp, uu, vv in zip(f.loops, (k, k + 1, k + 1, k),
                                      (a - 1, a - 1, a, a)):
                    lp[uvl].uv = (uu / RING, vv / ST)
        prev = ring
    f = bm.faces.new(tuple(prev))
    f.material_index = SLOT_SCAPE


# ---- tubes: scapes, branches, pedicels, filaments ---------------------------
def tube(pts, radii, slot, RING=10, uv=(0.0, 1.0), names=None, svs=None,
         cap=True, cap_start=None, cap_end=None):
    """A closed tube through `pts`, one radius per station.

    Closed at both ends unless told otherwise, because on the violet every open
    tube turned out to be visible from somewhere and each one was found by being
    shown a screenshot of it rather than by the build saying so.
    """
    v0, v1 = uv
    n = max(1, len(pts) - 1)
    first = prev = None
    for i, c in enumerate(pts):
        if i == 0:
            tan = (pts[1] - c).normalized()
        elif i == n:
            tan = (c - pts[i - 1]).normalized()
        else:
            tan = (pts[i + 1] - pts[i - 1]).normalized()
        ref = Vector((1, 0, 0)) if abs(tan.z) > 0.94 else Vector((0, 0, 1))
        uu = (ref - tan * ref.dot(tan)).normalized()
        ww = tan.cross(uu).normalized()
        ring = []
        for k in range(RING):
            th = k / RING * math.tau
            v = bm.verts.new(c + (uu * math.cos(th) + ww * math.sin(th)) * radii[i])
            ring.append(v)
            if names:
                bind(len(bm.verts) - 1, (svs[i] if svs else i / n), names)
        bm.verts.ensure_lookup_table()
        if first is None:
            first = ring
        if prev is not None:
            # `slot` may be a list, one entry per segment, so a single closed
            # tube can change material along its length. Splitting it into two
            # tubes instead leaves two coincident open rings at the join — an
            # invisible hole, but the boundary-edge check finds it and it is
            # right to.
            si = slot[i - 1] if isinstance(slot, (list, tuple)) else slot
            for k in range(RING):
                f = bm.faces.new((prev[k], prev[(k + 1) % RING],
                                  ring[(k + 1) % RING], ring[k]))
                f.material_index = si
                for lp, _u, _v in zip(f.loops, (k, k + 1, k + 1, k),
                                      (i - 1, i - 1, i, i)):
                    lp[uvl].uv = (_u / RING, v0 + (v1 - v0) * _v / n)
        prev = ring
    # Per-end, because two tubes that abut must not each cap the join. A bud
    # whose green half and colour-broken tip both closed put a disc between
    # them, and on a tapering tube that disc reads as a cone stuck on the end.
    for ring_, flip, want in ((first, True, cap if cap_start is None else cap_start),
                              (prev, False, cap if cap_end is None else cap_end)):
        if not want:
            continue
        fc = bm.faces.new(tuple(reversed(ring_)) if flip else tuple(ring_))
        fc.material_index = (slot[0 if flip else -1]
                             if isinstance(slot, (list, tuple)) else slot)
        for lp in fc.loops:
            lp[uvl].uv = (0.5, v0 if flip else v1)
    return first, prev


def organ_frame(origin, zdir, ref=None):
    """A local frame with +z along `zdir`. Returns a point transformer."""
    z = Vector(zdir).normalized()
    r = Vector(ref) if ref else Vector((0.0, 0.0, 1.0))
    if abs(z.dot(r)) > 0.94:
        r = Vector((1.0, 0.0, 0.0))
    x = (r - z * r.dot(z)).normalized()
    y = z.cross(x)

    def to_world(p):
        return Vector(origin) + x * p[0] + y * p[1] + z * p[2]
    return to_world


def bezier(a, c, b, s):
    return a * ((1 - s) ** 2) + c * (2 * (1 - s) * s) + b * (s * s)


# ---- the flower ------------------------------------------------------------
# 9 across was not enough for the margin frill: a five-lobed ruffle over nine
# points aliases into a staircase along the silhouette, which is the one place
# a tepal's outline is actually read.
TEP_NS, TEP_NW = 15, 15


def tepal_spine(half_w, L, th0, th1, spent, sector):
    """Stations down one tepal's midrib, with the half-width allowed at each.

    `tepal()` builds from this and the placement solver measures from it, so
    the two cannot disagree about where a corolla reaches or how wide it gets.
    A solver working from `flower_d` instead understates the reach by about a
    fifth, because a tepal is measured along an arc that curves over.
    """
    # A rag shrinks in both directions. Shortening it alone left a full-width
    # tepal on a third-length spine — wider than the radius it sits at along
    # its whole length — which is why every tepal of every spent flower passed
    # through every other one, 2721 face-pairs a flower against the open
    # bloom's 78.
    Lf = L * lerp(1.0, 0.30, spent)
    half_wf = half_w * lerp(1.0, 0.34, spent)
    th1f = th1 + math.radians(float(P['spent_recurve'])) * spent
    dirs = []
    for i in range(TEP_NS + 1):
        s = i / TEP_NS
        th = th0 + (th1f - th0) * (s ** 1.35)
        dirs.append(Vector((math.sin(th), 0.0, math.cos(th))))
    pts = [Vector((TUBE_R, 0.0, TUBE_L))]
    ds = Lf / TEP_NS
    for i in range(TEP_NS):
        pts.append(pts[-1] + dirs[i] * ds)
    ws = []
    for i in range(TEP_NS + 1):
        t = i / TEP_NS
        # Widest just past halfway and drawn to a point. At (1.02 - t)**0.55
        # the tip was still 11% of full width, which renders as a squared-off
        # notch with the backface showing through it.
        w = half_wf * (((t + 0.10) ** 0.55) * ((1.005 - t) ** 0.80) / 0.4655)
        # ...but never wider than the arc this tepal owns. Six tepals sit at 60
        # degree intervals, so at radius r the arc from one midrib to the next
        # is pi*r/3, and `sector` is this tepal's share of it. The shape
        # function alone asks for 3.15x that at the throat and stays over one
        # until mid-length, which is exactly the span where adjacent tepals
        # used to intersect. Clamping rather than reshaping leaves the tip
        # silhouette — the part that is actually read — untouched, and turns
        # the base into the claw a Hemerocallis tepal really has.
        ws.append(min(w, sector * math.pi * max(pts[i].x, 1e-5) / 3.0))
    return pts, dirs, ws


def tepal(Wf, ang, half_w, L, th0, th1, ruffle_amp, lobes, chan, slot, spent,
          sector=1.0, shell=0.0, twist=0.0):
    """One tepal, built in the flower's frame and rotated into place.

    Sepals and petals are the same builder at different widths and ruffle: the
    outer whorl is 0.45-0.75 of the inner's width and carries almost no frill.
    Making all six identical is the classic modelling error for this genus, so
    the two whorls are separate calls with different numbers rather than one
    loop over six.

    `spent` runs the daily death. Every daylily flower lasts one day, so the
    collapsed state is on screen constantly and it is not a wilted open flower —
    it is a wet rag twisted through several turns and shrunk to about a third.
    That needs the twist and the radial pinch; a scale alone reads as a shrunken
    flower, and then the plant looks sick every day of the game.
    """
    pts, dirs, ws = tepal_spine(half_w, L, th0, th1, spent, sector)
    ca, sa = math.cos(ang), math.sin(ang)

    rows = []
    b0 = len(bm.faces)
    for i in range(TEP_NS + 1):
        t = i / TEP_NS
        c, dv = pts[i], dirs[min(i, TEP_NS)]
        across = Vector((0.0, 1.0, 0.0))
        upv = dv.cross(across).normalized() * -1.0
        # Widest just past halfway and drawn to a point. At (1.02 - t)**0.55
        # the tip was still 11% of full width, which renders as a squared-off
        # notch with the backface showing through it.
        w = ws[i]
        # At the mouth the tepals are still effectively fused, so they have to
        # tile the throat rather than cut across it as flat chords. Lay the row
        # on the arc there and let it flatten into a strap by mid-length; for
        # small angles the two agree, so the blend is seamless.
        wrap = max(0.0, 1.0 - t / 0.45) ** 1.5
        row = []
        for k in range(TEP_NW):
            su = (k / (TEP_NW - 1)) * 2.0 - 1.0
            lat = su * w
            up = (chan * w * (su * su)
                  + ruffle_amp * math.sin(su * lobes * math.pi)
                  * (abs(su) ** 2.2) * (t ** 0.7))
            if wrap > 0.0:
                phi = lat / max(c.x, 1e-5)
                p = Vector((c.x, lat, c.z)).lerp(
                    Vector((c.x * math.cos(phi), c.x * math.sin(phi), c.z)),
                    wrap) + upv * up
            else:
                p = c + across * lat + upv * up
            if spent > 0.0:
                a = spent * math.radians(twist) * (t ** 1.2)
                cb, sb = math.cos(a), math.sin(a)
                p = Vector((p.x * cb - p.y * sb, p.x * sb + p.y * cb, p.z))
                kk = lerp(1.0, float(P['spent_pinch']), spent * (t ** 0.8))
                p = Vector((p.x * kk, p.y * kk, p.z))
                if shell:
                    # and each whorl onto its own radius, ramped in from the
                    # tube so the throat stays fused
                    rr = math.hypot(p.x, p.y)
                    if rr > 1e-6:
                        k2 = 1.0 + shell * spent * (t ** 0.8) / rr
                        p = Vector((p.x * k2, p.y * k2, p.z))
            q = Vector((p.x * ca - p.y * sa, p.x * sa + p.y * ca, p.z))
            row.append(bm.verts.new(Wf(q)))
        rows.append(row)
    bm.verts.ensure_lookup_table()

    e_u = rows[TEP_NS // 2][TEP_NW // 2 + 1].co - rows[TEP_NS // 2][TEP_NW // 2].co
    e_v = rows[TEP_NS // 2 + 1][TEP_NW // 2].co - rows[TEP_NS // 2][TEP_NW // 2].co
    face_up = Wf(Vector((0.0, 0.0, 1.0))) - Wf(Vector((0.0, 0.0, 0.0)))
    quad = (((0, 0), (0, 1), (1, 1), (1, 0)) if e_u.cross(e_v).dot(face_up) >= 0
            else ((0, 0), (1, 0), (1, 1), (0, 1)))
    for i in range(TEP_NS):
        for k in range(TEP_NW - 1):
            f = bm.faces.new(tuple(rows[i + dj][k + dk] for dj, dk in quad))
            f.material_index = slot
            want = {rows[i + dj][k + dk]: ((k + dk) / (TEP_NW - 1), (i + dj) / TEP_NS)
                    for dj, dk in quad}
            for lp in f.loops:
                lp[uvl].uv = want[lp.vert]
    return b0, len(bm.faces)


def whorl_sectors(spent):
    """Each whorl's share of the 60 degrees between one midrib and the next,
    and the twist that share leaves free.

    The two shares are in the same proportion as the two whorls' widths, so a
    wider `sepal_ratio` moves the slit rather than making the sepals overlap,
    and they sum to less than one — the remainder is the gap you can see
    daylight through between two tepals, which a real flower has and which also
    has to survive Solidify putting a 0.4 mm rim on each margin.

    A collapsed tepal is crumpled, so it keeps only part of the arc it held
    open — and the arc it gives up is exactly the budget the progressive twist
    may spend. Every pair of tepals is at least 60 degrees apart at the centre,
    so if no tepal's margin can reach its neighbour's, nothing can cross
    whatever the spine does in between. That last clause is the whole point:
    the spent spine hooks right round until its tip is back on its own base
    line, so the shape offers no help and only the angle bound does.
    """
    _sr = float(P['sepal_ratio'])
    SEC_GAP = 0.86
    narrow = lerp(1.0, float(P['spent_narrow']), spent)
    sec_p = SEC_GAP / (1.0 + _sr) * narrow
    sec_s = SEC_GAP * _sr / (1.0 + _sr) * narrow
    slack = math.degrees(math.pi / 3.0
                         - math.atan(sec_p * math.pi / 3.0)
                         - math.atan(sec_s * math.pi / 3.0))
    tw = min(float(P['spent_twist']), slack * 0.92) if spent > 0.0 else 0.0
    return sec_p, sec_s, slack, tw


def corolla_bound(scale=1.0, spent=0.0, open_t=1.0):
    """A sphere containing the whole corolla: (depth along the axis, radius).

    Walked from `tepal_spine` with the same collapse applied, so the placement
    solver measures the flower that will actually be built rather than a
    nominal one. Sizing it from `flower_d` instead understates the reach by
    about a fifth, because a tepal is measured along an arc that curves over.
    """
    R = float(P['flower_d']) * 0.5 * scale
    Lt = R * 1.48
    sec_p, sec_s, _sl, _tw = whorl_sectors(spent)
    th0 = math.radians(22.0)
    th1 = math.radians(74.0 + float(P['recurve']) * open_t)
    ring = []
    for half_w, L, th1w, sec in ((R * 0.30 * float(P['sepal_ratio']),
                                  Lt * 0.94, th1 + math.radians(9.0), sec_s),
                                 (R * 0.30, Lt, th1, sec_p)):
        pts, _d, ws = tepal_spine(half_w, L, th0, th1w, spent, sec)
        for i, c in enumerate(pts):
            t = i / TEP_NS
            kk = lerp(1.0, float(P['spent_pinch']), spent * (t ** 0.8))
            rho = c.x * kk + float(P['spent_shell']) * spent * (t ** 0.8)
            w = ws[i] * kk
            ring.append((rho + w, c.z, w))
    lo = min(z for _r, z, _w in ring)
    hi = max(z for _r, z, _w in ring)
    best = None
    for k in range(41):                     # slide the centre along the axis
        zc = lo + (hi - lo) * k / 40.0
        rad = max(math.hypot(r, z - zc) + 0.4 * w for r, z, w in ring)
        if best is None or rad < best[1]:
            best = (zc, rad)
    return best


def corolla_swept(scale=1.0, spent=0.0, open_t=1.0):
    """The corolla as spheres down its six tepal midribs, in the flower's frame.

    `corolla_bound` is most of the way empty — a corolla is a shallow bowl of
    six straps, not a ball — so refusing every placement whose bounding spheres
    touch throws out arrangements a real clump makes every day. This is the
    same walk kept local, used as the second opinion when the cheap test fails.
    """
    R = float(P['flower_d']) * 0.5 * scale
    Lt = R * 1.48
    sec_p, sec_s, _sl, tw = whorl_sectors(spent)
    th0 = math.radians(22.0)
    th1 = math.radians(74.0 + float(P['recurve']) * open_t)
    out = []
    for half_w, L, th1w, sec, shell, aoff in (
            (R * 0.30 * float(P['sepal_ratio']), Lt * 0.94,
             th1 + math.radians(9.0), sec_s, -float(P['spent_shell']), 0.0),
            (R * 0.30, Lt, th1, sec_p, float(P['spent_shell']), 0.5)):
        pts, _d, ws = tepal_spine(half_w, L, th0, th1w, spent, sec)
        for j in range(3):
            ang = (j + aoff) * math.tau / 3.0
            for i in range(0, TEP_NS + 1, 2):
                t = i / TEP_NS
                kk = lerp(1.0, float(P['spent_pinch']), spent * (t ** 0.8))
                rho = pts[i].x * kk + shell * spent * (t ** 0.8)
                a = ang + spent * math.radians(tw) * (t ** 1.2)
                out.append((Vector((rho * math.cos(a), rho * math.sin(a),
                                    pts[i].z)), ws[i] * kk * 1.25))
    return out


def add_flower(origin, axis, scale=1.0, spent=0.0, open_t=1.0):
    """A whole Hemerocallis flower: tube, two whorls, six stamens and a style."""
    Wf = organ_frame(origin, axis)
    R = float(P['flower_d']) * 0.5 * scale
    pw = R * 0.30                     # petal half-width
    sw = pw * float(P['sepal_ratio'])
    # Tepal length is measured along its own arc, and the arc curves over: a
    # tepal as long as the flower's radius only reaches about two thirds of the
    # way out, so the bloom renders a third smaller than `flower_d` claims.
    Lt = R * 1.48

    # The perianth tube. Six tepals meeting at a point read as a lily, and this
    # plant is not one — no bulb, no true stem, and a fused tube 1.5-5 cm long.
    npt = 6
    tp = [Wf(Vector((0.0, 0.0, TUBE_L * i / npt))) for i in range(npt + 1)]
    tr = [lerp(0.0026, TUBE_R, (i / npt) ** 1.6) * scale for i in range(npt + 1)]
    tube(tp, tr, SLOT_SCAPE, RING=12)

    faces = []
    fi = len(TEPAL_FACES) // 6        # six tepals per flower, always
    th0 = math.radians(22.0)
    th1 = math.radians(74.0 + float(P['recurve']) * open_t)
    sec_p, sec_s, slack, tw = whorl_sectors(spent)
    TWIST_SLACK.append((round(float(P['spent_twist']), 1), round(slack, 1),
                        round(tw, 1)))
    for j in range(3):
        # outer whorl: sepals, narrower and almost unruffled
        faces.append(tepal(Wf, j * math.tau / 3.0, sw, Lt * 0.94,
                           th0, th1 + math.radians(9.0),
                           float(P['ruffle']) * 0.22 * scale, 3.0, 0.16,
                           SLOT_TEPAL, spent, sec_s,
                           -float(P['spent_shell']), tw))
        TEPAL_FACES.append(faces[-1])
        TEPAL_FLOWER.append(fi)
        TEPAL_WHORL.append(0)
        # inner whorl: petals, wider and carrying the frill
        faces.append(tepal(Wf, (j + 0.5) * math.tau / 3.0, pw, Lt,
                           th0, th1,
                           float(P['ruffle']) * scale, 5.0, 0.22,
                           SLOT_TEPAL, spent, sec_p,
                           float(P['spent_shell']), tw))
        TEPAL_FACES.append(faces[-1])
        TEPAL_FLOWER.append(fi)
        TEPAL_WHORL.append(1)

    if spent > 0.55:
        return faces                  # the sexual parts collapse with the rag

    # six stamens: filaments in a shallow upward arc, versatile anthers
    for j in range(6):
        a = (j + 0.25) * math.tau / 6.0
        fl = R * 1.02
        base = Vector((TUBE_R * 0.55 * math.cos(a), TUBE_R * 0.55 * math.sin(a), TUBE_L))
        tip = Vector((math.cos(a) * fl * 0.62, math.sin(a) * fl * 0.62, TUBE_L + fl * 0.74))
        ctl = Vector((math.cos(a) * fl * 0.10, math.sin(a) * fl * 0.10, TUBE_L + fl * 0.62))
        pts = [Wf(bezier(base, ctl, tip, i / 7.0)) for i in range(8)]
        tube(pts, [0.0011 * scale] * 8, SLOT_SCAPE, RING=6)
        # the anther is hinged across the filament, not along it — "versatile",
        # and it is why a daylily's anthers hang at an angle to their stalks
        d = (pts[-1] - pts[-2]).normalized()
        side = d.cross(Vector((0.0, 0.0, 1.0)))
        side = side.normalized() if side.length > 1e-6 else Vector((1.0, 0.0, 0.0))
        al = 0.009 * scale
        ap = [pts[-1] + side * (al * (i / 4.0 - 0.5)) for i in range(5)]
        ar = [0.0009, 0.0021, 0.0024, 0.0021, 0.0009]
        tube(ap, [r * scale for r in ar], SLOT_EYE, RING=6)

    # one style, exceeding the anthers by 0.5-2 cm, with a capitate stigma
    sl = R * 1.30
    base = Vector((0.0, 0.0, TUBE_L))
    tip = Vector((sl * 0.50, 0.0, TUBE_L + sl * 0.80))
    ctl = Vector((sl * 0.06, 0.0, TUBE_L + sl * 0.66))
    pts = [Wf(bezier(base, ctl, tip, i / 8.0)) for i in range(9)]
    tube(pts, [0.0010 * scale] * 9, SLOT_SCAPE, RING=6)
    d = (pts[-1] - pts[-2]).normalized()
    tube([pts[-1] - d * 0.0012, pts[-1] + d * 0.0016],
         [0.0016 * scale, 0.0013 * scale], SLOT_SCAPE, RING=6)
    return faces


def add_bud(origin, axis, stage, scale=1.0):
    """Stages 0-2: pinhead green, elongating spindle, full size with colour break.

    A scape must hold buds at every maturity at once — fat colour-broken ones low
    down and pinheads at the tips. A scape whose buds are all the same is
    instantly, obviously wrong, and this is the strongest flowering realism cue
    the species has.
    """
    L = lerp(0.009, 0.082, stage ** 1.3) * scale
    rad = lerp(0.0016, 0.0072, stage ** 1.1) * scale
    n = 9
    up = Vector(axis).normalized()
    tipd = (up * 0.72 + Vector((0.0, 0.0, 1.0)) * 0.28).normalized()
    a = Vector(origin)
    b = a + tipd * L
    c = a + up * (L * 0.62)
    pts = [bezier(a, c, b, i / n) for i in range(n + 1)]
    # fattest a third of the way up and drawn to a long point, which is what
    # "gently upcurved spindle" means; a symmetric bulge reads as a capsule
    radii = [rad * (((i / n) + 0.06) ** 0.42) * ((1.04 - i / n) ** 0.85) / 0.475
             for i in range(n + 1)]
    radii[0] = rad * 0.26
    radii[-1] = rad * 0.06
    # colour break: the cultivar colour shows at the bud tip the evening before
    if stage > 0.86:
        # Colour break: the cultivar colour appears at the bud tip the evening
        # before it opens, which is the transition the player wakes up to.
        cut = int(n * 0.80)
        slots = [SLOT_SCAPE if i < cut else SLOT_TEPAL for i in range(n)]
        tube(pts, radii, slots, RING=9)
    else:
        tube(pts, radii, SLOT_SCAPE, RING=9)


# ---- the scape, and everything hanging off it ------------------------------
def scape_organs(nb):
    """What each pedicel on one scape is carrying, lowest first.

    A real scape holds 8-40 buds at every maturity simultaneously and opens
    flowers sequentially from the base branch upward, so the lower pedicels are
    the ones that have already been and gone. Yesterday's blooms are still
    hanging there as twisted rags — they do not abscise — and a plant carrying
    several days of them is perfectly healthy. That is this species' whole
    daily loop and it has to be visible in one still frame.
    """
    out = []
    for _ in range(int(P['spent'])):
        out.append(('spent', 1.0))
    for _ in range(int(P['open_blooms'])):
        out.append(('open', 1.0))
    rest = max(0, nb - len(out))
    for i in range(rest):
        # maturity falls off toward the tip: fat colour-broken buds low down,
        # pinheads at the top
        out.append(('bud', max(0.06, 0.96 - 0.92 * (i / max(1, rest - 1)))))
    return out


def add_scape(fan_az, crown, tag):
    """A leafless stalk from the centre of a mature fan, branched near the top."""
    h = float(P['scape_h']) * rnd.uniform(0.90, 1.10)
    lean_az = fan_az + rnd.uniform(-1.0, 1.0) * 0.9
    base = Vector((crown.x, crown.y, SOIL_Z - 0.006))
    top = base + Vector((math.cos(lean_az) * h * 0.15,
                         math.sin(lean_az) * h * 0.15, h))
    ctl = base + Vector((0.0, 0.0, h * 0.74))     # near-vertical out of the fan
    n = 16
    pts = [bezier(base, ctl, top, i / n) for i in range(n + 1)]
    r0 = float(P['scape_r'])
    radii = [r0 * (1.0 - 0.52 * (i / n) ** 0.9) for i in range(n + 1)]

    seg = 5
    seg_pts = [pts[int(round(i / seg * n))] for i in range(seg + 1)]
    names = chain(tag, seg_pts, [Vector((1.0, 0.0, 0.0))] * (seg + 1))
    tube(pts, radii, SLOT_SCAPE, RING=9, names=names,
         svs=[i / n for i in range(n + 1)])

    nb = max(1, int(P['branches']))
    cand = []
    for bi in range(nb):
        u = 0.66 + 0.28 * (bi / max(1, nb - 1))
        o = pts[int(u * n)]
        # ascending, and the upper branches are shorter than the lower ones
        blen = lerp(0.17, 0.06, bi / max(1, nb - 1)) * (h / 0.68)
        baz = lean_az + (bi - (nb - 1) * 0.5) * 1.9 + rnd.uniform(-0.3, 0.3)
        bdir = Vector((math.cos(baz) * 0.66, math.sin(baz) * 0.66, 0.75)).normalized()
        btip = o + bdir * blen
        bctl = o + Vector((0.0, 0.0, blen * 0.55))
        bp = [bezier(o, bctl, btip, i / 6.0) for i in range(7)]
        br = [r0 * 0.58 * (1.0 - 0.45 * (i / 6.0)) for i in range(7)]
        tube(bp, br, SLOT_SCAPE, RING=7, names=names, svs=[u] * 7)
        # Two pedicels per branch, and far enough apart on it to matter. They
        # used to be bp[5] and bp[6] — adjacent points on a 6-17 cm branch, so
        # about 2 cm apart carrying flowers 11 cm across.
        for j in (2, 6):
            cand.append((j // 4, bi, bp[j], bdir, u))
    cand.append((2, nb, pts[n], (pts[n] - pts[n - 1]).normalized(), 1.0))
    # Stride across the branches rather than filling them one at a time. The
    # plan is ordered spent, spent, open, open, buds — so consecutive filling
    # put both open blooms on the SAME branch, which is where the two
    # interpenetrating corollas came from. Sorting by rung-then-branch spreads
    # each kind over branches that point 100+ degrees apart.
    cand.sort(key=lambda c: (c[0], c[1]))
    slots = [(o, d, u) for _r, _b, o, d, u in cand]

    plan = scape_organs(len(slots))
    for (o, bdir, u), (kind, val) in zip(slots, plan):
        pl0 = rnd.uniform(0.018, 0.042)
        yaw0 = math.atan2(bdir.y, bdir.x)

        def aim_at(yaw, pl, kind):
            """Pedicel direction, its tip, and the face the flower presents."""
            bx, by = math.cos(yaw), math.sin(yaw)
            pdir = Vector((bx * 0.80, by * 0.80, 0.60)).normalized()
            out = Vector((bx, by, 0.0)).normalized()
            if kind == 'open':
                # a daylily presents its face outward and a little up, on a
                # short pedicel, generally at or above foliage height
                ax = (out * 0.72 + Vector((0.0, 0.0, 1.0)) * 0.58).normalized()
            else:
                # and yesterday's hangs limp off the same pedicel
                ax = (out * 0.34 - Vector((0.0, 0.0, 1.0)) * 0.82).normalized()
            return pdir, o + pdir * pl, ax

        pdir, pe, axis = aim_at(yaw0, pl0, kind)
        if kind in ('open', 'spent'):
            sp = float(P['spent_t']) if kind == 'spent' else 0.0
            ot = 1.0 if kind == 'spent' else float(P['bloom_open'])
            depth, crad = corolla_bound(1.0, sp, ot)
            # Solve the placement instead of trusting the layout. Ordering the
            # plan across branches stopped two blooms sharing one branch at the
            # seed this plant ships at, and still fouled at four of the other
            # seeds tried — two scapes lean together and their corollas meet in
            # the middle, which no ordering rule can see. A pedicel is 1.5-5 cm
            # and free to point anywhere off its branch, so there is real room
            # to search; take the best gap found and only give up if none of it
            # clears.
            swept = corolla_swept(1.0, sp, ot)
            best = None
            for att in range(32):
                yaw = yaw0 + ((att % 8) - 3.5) * 0.40
                pl = min(0.050, pl0 * (1.0 + 0.18 * (att // 8)))
                pd2, pe2, ax2 = aim_at(yaw, pl, kind)
                centre = pe2 + ax2 * depth
                near = [b for b in BLOOMS
                        if (centre - b[0]).length < crad + b[1]]
                world = None
                if not near:
                    gap = 1.0
                else:
                    Wf2 = organ_frame(pe2, ax2)
                    world = [(Wf2(q), r) for q, r in swept]
                    gap = min((pw - qw).length - (r1 + r2)
                              for pw, r1 in world
                              for b in near for qw, r2 in b[2])
                if best is None or gap > best[0]:
                    best = (gap, pd2, pe2, ax2, centre, world)
                if gap >= 0.0:
                    break
            gap, pdir, pe, axis, centre, world = best
            if gap < 0.0:
                # Nowhere on this pedicel clears. A bud is a truthful thing for
                # a scape to be carrying, and it is the only option here that
                # does not ship two corollas inside each other.
                DEMOTED.append((kind, round(gap, 4)))
                kind, val = 'bud', 0.68
            else:
                if world is None:
                    Wf2 = organ_frame(pe, axis)
                    world = [(Wf2(q), r) for q, r in swept]
                BLOOMS.append((centre, crad, world))
        pp = [bezier(o, o + pdir * ((pe - o).length * 0.55), pe, i / 4.0)
              for i in range(5)]
        tube(pp, [r0 * 0.34, r0 * 0.31, r0 * 0.29, r0 * 0.27, r0 * 0.26],
             SLOT_SCAPE, RING=6, names=names, svs=[u] * 5)
        if kind == 'open':
            add_flower(pe, axis, 1.0, 0.0, float(P['bloom_open']))
        elif kind == 'spent':
            add_flower(pe, axis, 1.0, float(P['spent_t']), 1.0)
        else:
            add_bud(pe, pdir, val)
    return names


# ---- materials (flat for now; maps come once the form is right) ------------
def principled(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree, m.node_tree.nodes["Principled BSDF"]


def set_if(node, key, val):
    if key in node.inputs:
        node.inputs[key].default_value = val


# ---- textures: authored linear, so every map stays Non-Color ---------------
def leaf_textures(n):
    """The blade. u runs across it with the midrib at 0.5; v base to tip.

    Parallel-veined with no reticulation — that is the monocot giveaway and the
    single easiest way to tell this from the violet's netted blade. Everything
    else here is condition: `chlorosis` unmasks the carotenoids, `necrosis`
    advances a dieback front from the tip, and the two are separate channels on
    purpose. Collapsing them turns senescence into a health bar, and on this
    species that would be a lie — older outer leaves brown at the tips
    regardless of care, which is ageing, not neglect.
    """
    u = np.linspace(0.0, 1.0, n)
    U, V = np.meshgrid(u, u, indexing='xy')
    su = U * 2.0 - 1.0

    fine = fbm((n, n), 34, octaves=3)
    slow = fbm((n, n), 5, octaves=4)

    # Longitudinal veins: straight, parallel, unbranched. A fan of veins or any
    # cross-linking would read as a dicot leaf.
    vein = np.abs(np.sin(su * 13.0 * math.pi))
    vein = smoothstep(0.55, 0.02, vein)
    # and the midrib, which is a single deeper line down the centre
    mid = np.exp(-((su / 0.055) ** 2))

    deep = np.array([0.048, 0.118, 0.026])
    pale = np.array([0.104, 0.205, 0.052])
    col = deep[None, None, :] + (pale - deep)[None, None, :] * (slow ** 1.2)[..., None]
    col = col * (1.0 - 0.20 * vein)[..., None]
    col = col * (1.0 + 0.16 * (fine - 0.5))[..., None]
    # the keel line: paler where the abaxial midrib catches the light, which is
    # the most diagnostic thing about a daylily's silhouette
    col = col + (pale - deep)[None, None, :] * (0.34 * mid)[..., None]
    # blades emerge yellow-green and deepen; the base stays a shade lighter
    col = col + (pale - deep)[None, None, :] * (0.22 * smoothstep(0.16, 0.0, V))[..., None]

    ch = float(P['chlorosis'])
    if ch > 0.0:
        gold = np.array([0.310, 0.235, 0.030])
        col = col * (1 - ch * 0.85) + gold[None, None, :] * (ch * 0.85)

    nec = float(P['necrosis'])
    if nec > 0.0:
        # A hard green-to-brown boundary reads as a texture error. The yellow
        # transition band between dead and living tissue is what sells it.
        band = 0.12
        front = 1.0 - nec
        dead = smoothstep(front, front + band * 0.45, V)
        yell = smoothstep(front - band, front, V) * (1.0 - dead)
        brown = np.array([0.082, 0.048, 0.018])
        gold = np.array([0.280, 0.210, 0.028])
        col = (col * (1 - dead - yell)[..., None]
               + brown[None, None, :] * dead[..., None]
               + gold[None, None, :] * yell[..., None])

    alb = np.ones((n, n, 4)); alb[..., :3] = np.clip(col, 0, 1)

    h = np.clip(0.5 - 0.22 * vein + 0.30 * mid + 0.14 * (slow - 0.5)
                + 0.06 * (fine - 0.5), 0, 1)
    ht = np.ones((n, n, 4)); ht[..., :3] = h[..., None]

    # semi-glossy on the upper face, and glabrous — no trichomes anywhere, which
    # is the other thing that separates this from the violet
    r = np.clip(0.40 + 0.14 * (fine - 0.5) - 0.10 * mid + 0.08 * (slow - 0.5),
                0.22, 0.72)
    if nec > 0.0:
        r = np.clip(r + 0.42 * smoothstep(1.0 - nec, 1.0 - nec + 0.05, V), 0.22, 0.96)
    rg = np.ones((n, n, 4)); rg[..., :3] = r[..., None]

    TEX_ARRAYS.update(leaf_albedo=alb[..., :3].copy(),
                      leaf_height=h.copy(), leaf_rough=r.copy())
    return (make_image("daylily_leaf_albedo", alb),
            make_image("daylily_leaf_height", ht),
            make_image("daylily_leaf_rough", rg))


def tepal_textures(n):
    """A tepal of Hemerocallis fulva: tawny orange over a gold-green throat.

    The pattern is concentric outward from the centre of the *flower* — throat,
    then an eye band in a darker contrasting colour, then the base colour, with
    a paler midrib stripe up each tepal. Transitions are 2-5 mm gradients, never
    hard rings.

    And it has to be measured as a radius in the flower's own frame, not as a
    distance along the tepal. A tepal is widest near its middle, so anything
    drawn at "low v" is a wedge reaching well out from the centre rather than a
    ring around it — that mistake put a pale star across every violet bloom for
    three rounds while sheen, specular and the environment map were each blamed
    in turn.
    """
    u = np.linspace(0.0, 1.0, n)
    U, V = np.meshgrid(u, u, indexing='xy')
    su = U * 2.0 - 1.0

    fine = fbm((n, n), 30, octaves=3)
    slow = fbm((n, n), 6, octaves=4)

    # the width profile the geometry actually uses, so the two cannot disagree
    w = (((V + 0.10) ** 0.55) * ((1.005 - V) ** 0.80) / 0.4655)
    # half-width over length for a petal: pw = R*0.30, L = R*1.48
    rad = np.sqrt(V ** 2 + (su * w * 0.203) ** 2)

    tawny = np.array([0.470, 0.088, 0.010])      # H. fulva is the wild species
    lighter = np.array([0.610, 0.170, 0.024])    # colour: tawny orange, no pink
    eye = np.array([0.240, 0.026, 0.008])        # the darker band above the throat
    throat = np.array([0.520, 0.360, 0.020])     # gold-green, and it glows

    col = tawny[None, None, :] + (lighter - tawny)[None, None, :] * (slow ** 1.1)[..., None]
    # The eye: a wide darker band above the throat, diffuse at both edges. It
    # has to start where the throat has finished — overlapping them let the gold
    # win and fulva lost the red-orange zone that identifies it.
    eb = smoothstep(0.17, 0.26, rad) * smoothstep(0.46, 0.32, rad)
    col = col * (1 - 0.80 * eb)[..., None] + eye[None, None, :] * (0.80 * eb)[..., None]
    # the throat, which is the last thing before the tube
    tw = (smoothstep(0.155, 0.045, rad) ** 1.15)[..., None]
    col = col * (1 - tw) + throat[None, None, :] * tw
    # a paler midrib stripe the length of the tepal — most cultivars show one
    mid = np.exp(-((su / 0.10) ** 2)) * smoothstep(0.12, 0.34, V)
    col = col + (lighter - tawny)[None, None, :] * (0.55 * mid)[..., None]
    # veins fan out along the tepal rather than across it
    vn = smoothstep(0.55, 0.0, np.abs(np.sin(su * 5.0 * math.pi)))
    col = col * (1.0 - 0.14 * vn * smoothstep(0.15, 0.5, V))[..., None]
    col = col * (1.0 + 0.14 * (fine - 0.5))[..., None]

    alb = np.ones((n, n, 4)); alb[..., :3] = np.clip(col, 0, 1)

    h = np.clip(0.5 + 0.20 * mid - 0.16 * vn * V + 0.16 * (slow - 0.5)
                + 0.08 * (fine - 0.5), 0, 1)
    ht = np.ones((n, n, 4)); ht[..., :3] = h[..., None]

    # 'Diamond dusting': raised epidermal cells that scatter light as a
    # crystalline sparkle. Cultivar-specific and subtle on fulva, so it lives in
    # the roughness rather than in a separate specular map.
    r = np.clip(0.52 - 0.10 * mid + 0.20 * (fine - 0.5), 0.28, 0.80)
    rg = np.ones((n, n, 4)); rg[..., :3] = r[..., None]

    TEX_ARRAYS.update(tepal_albedo=alb[..., :3].copy(),
                      tepal_height=h.copy(), tepal_rough=r.copy())
    return (make_image("daylily_tepal_albedo", alb),
            make_image("daylily_tepal_height", ht),
            make_image("daylily_tepal_rough", rg))


def scape_textures(n):
    """Scapes, pedicels, buds and the perianth tube: one green, lightly ribbed."""
    u = np.linspace(0.0, 1.0, n)
    U, V = np.meshgrid(u, u, indexing='xy')
    fine = fbm((n, n), 36, octaves=3)
    ribs = fbm((n, n), 8, octaves=4)
    base = np.array([0.058, 0.122, 0.034])
    pale = np.array([0.118, 0.196, 0.062])
    col = base[None, None, :] + (pale - base)[None, None, :] * (ribs ** 1.1)[..., None]
    col = col * (1.0 + 0.20 * (fine - 0.5))[..., None]
    ch = float(P['chlorosis'])
    if ch > 0.0:
        gold = np.array([0.300, 0.228, 0.032])
        col = col * (1 - ch * 0.7) + gold[None, None, :] * (ch * 0.7)
    alb = np.ones((n, n, 4)); alb[..., :3] = np.clip(col, 0, 1)
    h = np.clip(0.5 + 0.34 * (fine - 0.5) + 0.24 * (ribs - 0.5), 0, 1)
    ht = np.ones((n, n, 4)); ht[..., :3] = h[..., None]
    r = np.clip(0.46 + 0.18 * (fine - 0.5), 0.26, 0.82)
    rg = np.ones((n, n, 4)); rg[..., :3] = r[..., None]
    TEX_ARRAYS.update(scape_albedo=alb[..., :3].copy(),
                      scape_height=h.copy(), scape_rough=r.copy())
    return (make_image("daylily_scape_albedo", alb),
            make_image("daylily_scape_height", ht),
            make_image("daylily_scape_rough", rg))


L_ALB, L_HGT, L_ROU = leaf_textures(int(P['tex']))
T_ALB, T_HGT, T_ROU = tepal_textures(max(256, int(P['tex']) // 2))
S_ALB, S_HGT, S_ROU = scape_textures(256)


def mapped(name, alb, hgt, rou, bump=0.6, dist=0.0006, sss=0.0,
           sss_r=(0.02, 0.03, 0.01), spec=0.5):
    """A Principled BSDF driven by three images and a bump node.

    Every surface anyone actually looks at is built this way rather than from a
    noise graph: glTF has no procedural textures, so a node-driven Base Color
    exports as the socket's unlinked default, which is white.
    """
    m, nt, b = principled(name)
    ta = nt.nodes.new('ShaderNodeTexImage'); ta.image = alb; ta.location = (-700, 250)
    tr = nt.nodes.new('ShaderNodeTexImage'); tr.image = rou; tr.location = (-700, 0)
    th = nt.nodes.new('ShaderNodeTexImage'); th.image = hgt; th.location = (-700, -250)
    bp = nt.nodes.new('ShaderNodeBump'); bp.location = (-420, -250)
    bp.inputs['Strength'].default_value = bump
    bp.inputs['Distance'].default_value = dist
    nt.links.new(ta.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(tr.outputs['Color'], b.inputs['Roughness'])
    nt.links.new(th.outputs['Color'], bp.inputs['Height'])
    nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    set_if(b, 'Specular IOR Level', spec)
    if sss:
        set_if(b, 'Subsurface Weight', sss)
        set_if(b, 'Subsurface Radius', sss_r)
        set_if(b, 'Subsurface Scale', 0.012)
    return m


def simple(name, base, rough=0.6, sss=0.0, sss_r=(0.02, 0.03, 0.01), spec=0.5):
    m, nt, b = principled(name)
    set_if(b, 'Base Color', (*base, 1))
    set_if(b, 'Roughness', rough)
    set_if(b, 'Specular IOR Level', spec)
    if sss:
        set_if(b, 'Subsurface Weight', sss)
        set_if(b, 'Subsurface Radius', sss_r)
        set_if(b, 'Subsurface Scale', 0.010)
    return m


M_LEAF = mapped("daylily_leaf", L_ALB, L_HGT, L_ROU, bump=0.55, dist=0.0009,
                sss=0.22, spec=0.42)
M_SCAPE = mapped("daylily_scape", S_ALB, S_HGT, S_ROU, bump=0.55, dist=0.0005,
                 sss=0.20, spec=0.40)
# Tepals are 0.3-0.8 mm thick and glow when backlit. An opaque tepal shader
# destroys the flower, so the subsurface term here is doing real work rather
# than being a garnish.
# 0.62 with a bright radius scattered so much light back out that a saturated
# tawny map rendered as pale peach — the flower has to glow when backlit without
# going translucent in direct light.
M_TEPAL = mapped("daylily_tepal", T_ALB, T_HGT, T_ROU, bump=0.45, dist=0.0007,
                 sss=0.34, sss_r=(0.26, 0.075, 0.022), spec=0.34)
# Versatile anthers bearing yellow-gold to brown pollen. On fulva they are the
# dark note in the middle of an orange flower.
M_EYE = simple("daylily_eye", (0.115, 0.052, 0.014), rough=0.80)


# ---- the clump -------------------------------------------------------------
def fan_layout(n):
    """Where each fan sits and which way its plane faces.

    A clump increases by producing offset fans at the crown edge, each rotated
    20-60 degrees from its parent. That rotation is the single parameter that
    decides whether this reads as a daylily or as ornamental grass: interlocking
    flat planes, not a radial blob. Uniform spacing would give a rosette by
    another route, so the step is randomised inside the observed range.
    """
    out, az = [], rnd.uniform(0.0, math.tau)
    for k in range(n):
        if k == 0:
            pos = Vector((0.0, 0.0, CROWN_Z))
        else:
            a2 = (k - 1) / max(1, n - 1) * math.tau + rnd.uniform(-0.6, 0.6)
            dd = float(P['fan_spread']) * rnd.uniform(0.75, 1.30)
            pos = Vector((math.cos(a2) * dd, math.sin(a2) * dd, CROWN_Z))
        out.append((az, pos))
        step = math.radians(float(P['fan_splay']) * rnd.uniform(0.55, 1.45))
        az += step * (1.0 if rnd.random() < 0.5 else -1.0)
    return out


FANS = fan_layout(int(P['fans']))
LEAF_CHAINS = []
for _fi, (_az, _pos) in enumerate(FANS):
    _n = int(P['leaves']) - (0 if _fi == 0 else 2)      # offsets are younger
    add_crown(_pos, 0.016, 0.024)
    for _i in range(_n):
        _L, _nm = add_leaf(_az, _pos, _i, _n, f"F{_fi}L{_i}")
        LEAF_CHAINS.append(_nm)
        BLADE_FAN.append(_fi)

SCAPE_CHAINS = []
for _fi, (_az, _pos) in enumerate(FANS):
    # Only mature fans flower, and an offset in its first year does not. That is
    # why `fans` is the master vigour parameter rather than a cosmetic one.
    if _fi >= int(P['scapes']):
        continue
    SCAPE_CHAINS.append(add_scape(_az, _pos, f"S{_fi}"))


# ---- mesh and armature -----------------------------------------------------
me = bpy.data.meshes.new("daylily")
bm.to_mesh(me)
bm.free()
for m in (M_LEAF, M_SCAPE, M_TEPAL, M_EYE):
    me.materials.append(m)
for poly in me.polygons:
    poly.use_smooth = True

plant = bpy.data.objects.new("daylily", me)
bpy.context.collection.objects.link(plant)

arm_data = bpy.data.armatures.new("daylily_rig")
rig = bpy.data.objects.new("daylily_rig", arm_data)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.update()
for o in bpy.context.view_layer.objects:
    o.select_set(False)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for (nm, head, tail, up, parent) in bones:
    eb = arm_data.edit_bones.new(nm)
    eb.head, eb.tail = head, tail
    try:
        eb.align_roll(Vector(up))
    except Exception:
        pass
    if parent and parent in arm_data.edit_bones:
        eb.parent = arm_data.edit_bones[parent]
        eb.use_connect = True
bpy.ops.object.mode_set(mode='OBJECT')

groups = {}
for (nm, *_rest) in bones:
    groups[nm] = plant.vertex_groups.new(name=nm)
for (vi, nm, w) in weights:
    g = groups.get(nm)
    if g:
        g.add([vi], w, 'REPLACE')

plant.modifiers.new("rig", 'ARMATURE').object = rig
sol = plant.modifiers.new("thickness", 'SOLIDIFY')
sol.thickness, sol.offset = 0.0011, -1.0
plant.parent = rig


# ---- pot, soil, bench ------------------------------------------------------
def noisy(name, c1, c2, scale=40.0, rough=0.85, bump=0.3, detail=6.0):
    m, nt, b = principled(name)
    n = nt.nodes
    tc = n.new('ShaderNodeTexCoord'); tc.location = (-900, 0)
    nz = n.new('ShaderNodeTexNoise'); nz.location = (-700, 0)
    nz.inputs['Scale'].default_value = scale
    nz.inputs['Detail'].default_value = detail
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
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


M_POT = noisy("terracotta", (0.165, 0.052, 0.026), (0.290, 0.108, 0.055),
              scale=110.0, rough=0.82, bump=0.55, detail=10.0)
M_SOIL = noisy("soil", (0.008, 0.006, 0.005), (0.034, 0.024, 0.017),
               scale=300.0, rough=0.97, bump=1.0, detail=12.0)
M_BENCH = noisy("bench", (0.085, 0.055, 0.034), (0.170, 0.108, 0.064),
                scale=6.0, rough=0.62, bump=0.28, detail=8.0)

bpy.ops.mesh.primitive_cone_add(vertices=80, radius1=0.086, radius2=0.117,
                                depth=0.205, location=(0, 0, 0.1025))
pot = bpy.context.active_object
pot.name = "pot"
_pb = bmesh.new()
_pb.from_mesh(pot.data)
bmesh.ops.delete(_pb, geom=[f for f in _pb.faces
                            if len(f.verts) > 4 and f.calc_center_median().z > 0.0],
                 context='FACES')
_pb.to_mesh(pot.data)
_pb.free()
pot.data.materials.append(M_POT)
for p in pot.data.polygons:
    p.use_smooth = True
pot.modifiers.new("solid", 'SOLIDIFY').thickness = 0.005

bpy.ops.mesh.primitive_torus_add(major_radius=RIM_R, minor_radius=RIM_T,
                                 major_segments=80, minor_segments=10,
                                 location=(0, 0, POT_TOP))
rim = bpy.context.active_object; rim.name = "rim"
rim.data.materials.append(M_POT)
for p in rim.data.polygons:
    p.use_smooth = True

bpy.ops.mesh.primitive_cylinder_add(vertices=80, radius=0.112, depth=0.008,
                                    location=(0, 0, SOIL_Z - 0.004))
soil = bpy.context.active_object; soil.name = "soil"
soil.data.materials.append(M_SOIL)
soil.modifiers.new("bump", 'SUBSURF').levels = 2

bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
bench = bpy.context.active_object; bench.name = "bench"
bench.data.materials.append(M_BENCH)


# ---- world, camera, render -------------------------------------------------
world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[1].default_value = float(P['env_str'])
world.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.48, 0.56, 1)

key = bpy.data.lights.new("key", 'AREA')
key.energy, key.size = 420.0, 1.6
key_o = bpy.data.objects.new("key", key)
key_o.location = (1.9, -1.5, 2.4)
bpy.context.collection.objects.link(key_o)

fill = bpy.data.lights.new("fill", 'AREA')
fill.energy, fill.size = 90.0, 2.4
fill_o = bpy.data.objects.new("fill", fill)
fill_o.location = (-2.2, -1.0, 1.1)
bpy.context.collection.objects.link(fill_o)


def aim(obj, at):
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (Vector(at) - obj.location).to_track_quat('-Z', 'Y')


aim(key_o, (0, 0, 0.55))
aim(fill_o, (0, 0, 0.45))

cam_d = bpy.data.cameras.new("cam")
cam_d.lens = float(P['lens'])
cam_d.dof.use_dof = True
cam_d.dof.aperture_fstop = float(P['fstop'])
cam = bpy.data.objects.new("cam", cam_d)
bpy.context.collection.objects.link(cam)
scene.camera = cam
_az = math.radians(float(P['cam_az']))
_el = math.radians(float(P['cam_elev']))
_d = float(P['cam_dist'])
_target = Vector((0.0, 0.0, 0.52))
cam.location = _target + Vector((math.sin(_az) * _d * math.cos(_el),
                                 -math.cos(_az) * _d * math.cos(_el),
                                 _d * math.sin(_el)))
aim(cam, _target)
cam_d.dof.focus_distance = (cam.location - _target).length

scene.render.engine = 'CYCLES' if P['engine'] == 'CYCLES' else 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x = int(P['res_x'])
scene.render.resolution_y = int(P['res_y'])
scene.render.film_transparent = False
# Render Region persists in a .blend and silently crops every render to a
# rectangle somebody dragged out once. It cost a round here: the plant projected
# to the middle of the frame and the render came back showing only bench.
scene.render.use_border = False
scene.render.use_crop_to_border = False
try:
    scene.cycles.samples = int(P['samples'])
except Exception:
    pass
try:
    scene.cycles.device = 'GPU'
except Exception:
    pass
try:
    scene.cycles.use_denoising = True
except Exception:
    pass
# One setting per try. These were once in a shared block, and an invalid look
# name failed silently and took the exposure line down with it.
try:
    scene.view_settings.view_transform = 'AgX'
except Exception:
    pass
try:
    scene.view_settings.look = 'AgX - Base Contrast'
except Exception:
    pass
try:
    scene.view_settings.exposure = 0.2
except Exception:
    pass


# ---- what the build actually produced --------------------------------------
def _flatness():
    """How flat each fan is: extent along its own axis over extent across it.

    This is the numeric form of "is it a daylily or is it ornamental grass".
    Every instinct in a procedural generator distributes leaves radially, and
    the result is very hard for a non-botanist reviewer to name as wrong — but
    a fan is a plane, so it has a ratio, and the ratio is checkable. Above about
    6 reads as a hand of cards; near 1 is a rosette by another name.

    It also catches the frame bug that produced this check. Local +y has to land
    on the fan's azimuth; send it ninety degrees off and each fan's plane is
    perpendicular to where the layout put it, which is invisible once several
    fans are at random azimuths.
    """
    out = []
    for fi, (az, _pos) in enumerate(FANS):
        axis = Vector((math.cos(az), math.sin(az), 0.0))
        norm = Vector((-math.sin(az), math.cos(az), 0.0))
        vs = set()
        for bi, (a, b) in enumerate(BLADE_FACES):
            if BLADE_FAN[bi] != fi:
                continue
            for f in me.polygons[a:b]:
                vs.update(f.vertices)
        if not vs:
            continue
        co = [me.vertices[i].co for i in vs]
        al = [c.dot(axis) for c in co]
        nl = [c.dot(norm) for c in co]
        across = max(1e-6, max(nl) - min(nl))
        out.append(round((max(al) - min(al)) / across, 2))
    return out


def _checks():
    out = {}
    try:
        _here = os.path.dirname(os.path.abspath(
            globals().get('__file__') or (globals().get('DAYLILY_P') or {}).get('here', '.')))
        _sk = os.path.abspath(os.path.join(_here, '..', '..', '.claude',
                                           'skills', 'plant-assets', 'scripts'))
        if _sk not in sys.path:
            sys.path.insert(0, _sk)
        import mesh_checks
        _be = mesh_checks.boundary_edges_by_slot(me)
        # A blade is an open strip until Solidify closes it with rim faces, and
        # Solidify is a modifier that the exporter applies — so slot 0 is
        # *expected* to have a boundary here and only the closed organs must be
        # watertight. The exporter checks the whole mesh again afterwards, which
        # is where the number has to reach zero.
        out['open_blade_margins'] = _be.pop(str(SLOT_LEAF), 0)
        out['open_tepal_margins'] = _be.pop(str(SLOT_TEPAL), 0)
        out['boundary_edges_closed_slots'] = _be
        # Split by fan, because the two halves mean different things. Two
        # leaves of the *same* fan crossing is a fault: they share a plane and
        # should nest. Leaves of different fans crossing is what a clump does —
        # real blades lie across one another — so a small number there is the
        # model being right, not wrong, and lumping them into one integer makes
        # the check unreadable.
        _hits = mesh_checks.self_intersections(me, FREE_FACES)
        out['blade_pairs_same_fan'] = sum(
            1 for h in _hits if BLADE_FAN[h[0]] == BLADE_FAN[h[1]])
        out['blade_pairs_cross_fan'] = sum(
            1 for h in _hits if BLADE_FAN[h[0]] != BLADE_FAN[h[1]])
        out['blades_in_pot'] = len(
            mesh_checks.intersections_with(me, FREE_FACES, [pot, rim]))
        # The corolla, split the same way and for the same reason. A flower's
        # six tepals sit at 60 degree intervals, so index distance IS angular
        # distance: 1 apart are the neighbours whose margins nearly touch, and
        # anything further apart crossing means a tepal has swept most of the
        # way round the flower. Two *different* flowers crossing is a placement
        # fault on the scape, not a corolla fault, so it is counted separately.
        _tp = mesh_checks.self_intersections(me, TEPAL_FACES)
        _adj = _far = _xf = 0
        for i, j, _n in _tp:
            if TEPAL_FLOWER[i] != TEPAL_FLOWER[j]:
                _xf += 1
            elif min((i - j) % 6, (j - i) % 6) == 1:
                _adj += 1
            else:
                _far += 1
        out['tepal_pairs_adjacent'] = _adj
        out['tepal_pairs_nonadjacent'] = _far
        out['tepal_pairs_cross_flower'] = _xf
        # And the corolla against the foliage. A tepal through a leaf blade is
        # never right, unlike two blades of different fans crossing, so it gets
        # its own number rather than being folded into a total.
        out['tepal_vs_blade'] = sum(
            h[2] for h in mesh_checks.between(me, TEPAL_FACES, FREE_FACES))
        out['tepal_in_pot'] = len(
            mesh_checks.intersections_with(me, TEPAL_FACES, [pot, rim]))
        out['blooms_demoted_to_buds'] = len(DEMOTED)
        out['spent_twist_asked_avail_used'] = (
            sorted(set(TWIST_SLACK))[-1] if TWIST_SLACK else None)
        out['blade_facing'] = mesh_checks.facing(me, SLOT_LEAF)
        out['fan_flatness'] = _flatness()
    except Exception as e:
        out['checks_unavailable'] = repr(e)[:200]
    return out


result = {
    'verts': len(me.vertices),
    'polys': len(me.polygons),
    'bones': len(bones),
    'fans': len(FANS),
    'blades': len(BLADE_FACES),
    'engine': scene.render.engine,
}
result.update(_checks())
print("daylily built:", result)
