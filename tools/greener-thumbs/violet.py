"""A parametric African Violet (Saintpaulia ionantha), rigged.

The point of this file is not the violet. It is that every visible property is a
number in `P` — leaf count, cupping, droop, chlorosis, bloom — so a plant's
condition is a parameter set rather than an asset. That is what a care game
needs: "underwatered on day three" has to be a state the model can be *put in*,
not a second model somebody has to sculpt.

Two things changed from the first version, and they are the same thing twice:

**Leaves bend on a bone chain instead of rotating rigidly.** The old `droop`
swung each leaf at the crown, which closed eleven rigid blades over the pot like
a fist. Each leaf now runs on a 4-bone chain and each bone takes a larger share
of the total angle, so the blade *curves* — the crown stays upright and the tip
hangs, which is what losing turgor actually looks like.

**Wind is the same rig, oscillating.** Because the leaves already bend on bones,
gentle sway is a phase-offset wobble on those bones, largest at the tip and
lagging as it travels outward. It also lets wind read plant state: a thirsty
plant is already bent, and moves less.

Textures are generated here, in numpy, from the same vein field the geometry
quilts itself with — so the impressed veins in the normal map land exactly on
the ridges in the mesh. That correspondence is what was missing when this
looked like green plastic.

Run inside Blender 5.x. Override parameters with a `VIOLET_P` dict in globals,
or `-- key=value` on a headless command line.
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, Euler

# ---- the whole plant, as numbers ------------------------------------------
P = dict(
    leaves      = 18,
    segs        = 4,        # bones per leaf: 1 petiole + 3 blade
    blade_len   = 0.062,
    blade_wide  = 0.034,    # half-width, so a blade about as wide as it is long
    petiole     = 0.020,    # short: a violet's blade dominates its stalk
    arch        = 0.10,     # how far the spine bows over across its own length
    tilt_old    = 4.0,      # degrees: the oldest, outermost leaf lies flattest
    tilt_young  = 34.0,     # and the newest stands up in the middle
    size_falloff= 0.42,     # how much smaller the newest leaf is than the oldest
    spiral_off  = 0.0,      # rotate the whole phyllotaxis
    crown_r     = 0.0072,   # petioles attach this far off the stem axis
    stem_rise   = 0.010,    # and the stem elongates this much over the rosette
    # Clearance is deliberately close to the blade's own thickness. A violet
    # rosette nestles — the leaves rest on each other. Ask for much more room
    # than this and the solver stacks them into a mound instead of a rosette.
    xy_near     = 0.006,    # two points this close in plan are stacked
    clearance   = 0.0018,   # and must be at least this far apart vertically
    max_lift    = 0.012,    # cap, so the rosette cannot become a column
    # The crown sits below the rim, so the flattest leaves try to leave the pot
    # through its wall. A real leaf goes over: the petiole lifts, the blade
    # crosses the rim, and it droops outside. Only the leaves that actually foul
    # the rim are raised, and only as far as they must be.
    rim_clear   = 0.0016,   # how far above the rim a blade has to pass
    tilt_cap    = 42.0,     # and the steepest a leaf may be raised to do it
    cup         = 0.30,     # how much the blade curls up at the edges
    quilt       = 0.45,     # the bullate puffing between veins
    droop       = 0.0,      # 0 turgid, 1 collapsed — this is thirst
    # `flex_magnitude_deg` of the shared wilt rig, one per organ. The rig is
    # meant to drive every organ a species has — the parameter model calls out
    # scape lodging and a daffodil gooseneck by name — and for a long time this
    # file only ever bent the leaves, so a thirsty violet held its flowers up
    # while its foliage went over the pot.
    flex_leaf_deg   = 78.0,
    flex_stalk_deg  = 62.0,   # a peduncle is thinner than a petiole and has a
                              # bloom on the end of it, so it gives up sooner —
                              # but it is shorter, so it has less to give
    chlorosis   = 0.0,      # 0 green, 1 yellow — this is nutrient or overwater
    blooms      = 6,
    bloom_open  = 1.0,
    seed        = 7,
    wind        = 0.6,      # 0 still, 1 breezy
    frames      = 96,       # one loop, at 24fps
    fuzz        = 140000,   # hair strands over the blades; 0 turns them off
    fuzz_len    = 0.0010,   # 1.0 mm; longer than this fringes the margin and
                            # starts reading as moss rather than velvet
    fuzz_rad    = 0.000015, # and 0.015 mm thick — thicker than this reads as
                            # speckle rather than velvet, however many there are
    nicks       = 0.5,      # margin damage: 0 is a factory leaf, 1 is chewed
    tex         = 1024,
    samples     = 220,
    res_x       = 1280,
    res_y       = 960,
    cam_dist    = 0.55,     # metres; the rosette is about 0.19 across
    cam_elev    = 26.0,     # degrees above the bench
    cam_az      = 32.0,
    lens        = 85.0,
    fstop       = 11.0,     # shallow at this scale — it is a macro shot
    hdri        = '',
    env_rot     = 0.6,
    env_str     = 1.0,
    engine      = 'CYCLES',
)

_over = dict(globals().get('VIOLET_P') or {})
if '--' in sys.argv:
    for _a in sys.argv[sys.argv.index('--') + 1:]:
        if '=' in _a:
            _k, _v = _a.split('=', 1)
            try:
                _over[_k] = float(_v) if '.' in _v else int(_v)
            except ValueError:
                _over[_k] = _v
P.update(_over)

NLAT = 7                       # lateral vein pairs
TEX_ARRAYS = {}                # linear float maps, for the web exporter
POT_TOP = 0.0655               # the rim
SOIL_Z = 0.0605                # the surface the plant grows out of
CROWN_Z = SOIL_Z + 0.0015      # and the crown sits just clear of it

# The rim written once, because the placement solver and the mesh builder both
# need it and a second copy is exactly how a leaf ends up passing through a rim
# that moved. RIM_TOP is what a blade has to clear; the band is where it counts.
RIM_R, RIM_T = 0.0565, 0.0035          # torus major and minor radius
RIM_IN, RIM_OUT = RIM_R - RIM_T, RIM_R + RIM_T
RIM_TOP = POT_TOP + RIM_T
rng = np.random.default_rng(int(P['seed']))
import random as _random
rnd = _random.Random(int(P['seed']))

scene = bpy.context.scene


def clear_scene():
    """Empty the file without reloading it.

    Deliberately not `read_factory_settings` (it wipes user preferences, and the
    OptiX device selection lives there) and not `read_homefile` either — loading
    a file mid-script invalidates the `bpy.context` the rest of the script is
    holding, so the first operator afterwards fails with a missing active
    object. Removing the datablocks by hand leaves the context intact, and works
    the same way headless.
    """
    scene.world = None
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in list(bpy.data.collections):
        try:
            bpy.data.collections.remove(coll)
        except Exception:
            pass
    for blocks in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
                   bpy.data.actions, bpy.data.cameras, bpy.data.lights,
                   bpy.data.images, bpy.data.node_groups, bpy.data.worlds):
        for d in list(blocks):
            if d.users == 0:
                try:
                    blocks.remove(d)
                except Exception:
                    pass


clear_scene()


# ---- the vein field, which geometry and texture both read ------------------
def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a + 1e-9), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def vein_field(su, bt):
    """Saintpaulia venation. `su` is -1..1 across the blade, `bt` 0..1 along it.

    Returns 0..1, where 1 is on a vein. Laterals are lines of constant
    (bt - |su|*shear), which is what makes them sweep forward toward the tip as
    they run outward, the way a real leaf's do.
    """
    su = np.asarray(su, dtype=np.float64)
    bt = np.asarray(bt, dtype=np.float64)
    asu = np.abs(su)
    mw = 0.060 * (1.0 - 0.55 * bt)                       # midrib tapers to the tip
    mid = np.clip(1.0 - asu / np.maximum(mw, 1e-6), 0.0, 1.0)
    lat = (bt - asu * 0.40) * NLAT
    d = np.abs(lat - np.round(lat))
    lateral = np.clip(1.0 - d / 0.13, 0.0, 1.0)
    # laterals do not start at the midrib and do not reach the margin
    lateral *= smoothstep(0.04, 0.18, asu) * (1.0 - smoothstep(0.84, 1.0, asu))
    return np.clip(np.maximum(mid, lateral * 0.85), 0.0, 1.0)


def blade_width(bt):
    """Ovate with a rounded tip, and a crenate (scalloped) margin."""
    bt = np.asarray(bt, dtype=np.float64)
    # the domain is inset at both ends so the blade keeps width at the tip and
    # stays broad at the base — a violet leaf is round, not lance-shaped
    t = 0.045 + 0.895 * np.clip(bt, 0, 1) ** 0.80
    w = np.sin(np.pi * t) ** 0.62
    return w * (1.0 + 0.016 * np.sin(bt * 44.0))


def fbm(shape, res, octaves=5, rough=0.55):
    """Value noise, summed. Blender ships numpy, so this costs nothing."""
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


# ---- textures: authored linear, so both maps stay Non-Color ---------------
def make_image(name, arr):
    """arr is (N, N, 4) float with row 0 at v=0 — the same direction the UVs run.

    This used to reverse the rows, on the stated belief that the array had a
    top-left origin. It does not: `meshgrid` puts bt=0 in row 0, and both the
    blade and the petal assign bt=0 to v=0, so reversing sent every map down its
    surface backwards. On a leaf that merely ran the midrib taper and the
    lateral sweep the wrong way, which is subtle enough to have gone unnoticed.
    On a petal it painted the pale throat across the tips instead of the centre,
    and five of those meeting is the pale ring that outlined every flower.
    """
    img = bpy.data.images.new(name, arr.shape[1], arr.shape[0],
                              alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    flat = np.ascontiguousarray(arr).ravel().astype(np.float32)
    img.pixels.foreach_set(flat)
    img.pack()
    return img


def leaf_textures(n):
    u = np.linspace(0.0, 1.0, n)
    U, V = np.meshgrid(u, u, indexing='xy')
    su, bt = U * 2.0 - 1.0, V
    vein = vein_field(su, bt)

    mottle = fbm((n, n), 3, octaves=5)
    fine = fbm((n, n), 24, octaves=3)

    g = float(P['chlorosis'])
    # linear values: violets are a very dark, slightly blue green
    dark = np.array([0.010, 0.036, 0.008])
    lite = np.array([0.022, 0.072, 0.016])
    yellow = np.array([0.120, 0.115, 0.016])
    # barely lighter than the blade: on a real violet the veins are mostly an
    # impression in the surface, not a colour. Painting them bright was what
    # made the leaves look printed.
    veinc = np.array([0.021, 0.050, 0.015])

    base = dark[None, None, :] + (lite - dark)[None, None, :] * (mottle ** 1.4)[..., None]
    # chlorosis arrives between the veins first, which is what makes it read as
    # a deficiency rather than a colour slider
    inter = np.clip(g * (1.0 - vein * 0.75), 0.0, 1.0)[..., None]
    base = base * (1 - inter) + yellow[None, None, :] * inter
    col = base * (1 - vein[..., None] * 0.45) + veinc[None, None, :] * (vein[..., None] * 0.45)
    # the margin darkens slightly, as it does on a real blade
    col = col * (1.0 - 0.25 * smoothstep(0.88, 1.0, np.abs(su)))[..., None]

    # Papillae catch the light as a fine glitter of bright points, which is
    # the texture a macro photograph of a violet is full of and the thing that
    # most obviously separates a petal from painted plastic.
    sparkle = (fbm((n, n), 90, octaves=2) > 0.62).astype(np.float64)
    col = col + sparkle[..., None] * 0.032

    alb = np.ones((n, n, 4)); alb[..., :3] = np.clip(col, 0, 1)

    # veins are impressed; the tissue between them puffs up; fuzz on top
    h = 0.5 + 0.30 * (1.0 - vein) * (mottle - 0.5) * 2.0 - 0.34 * vein + 0.05 * (fine - 0.5)
    ht = np.ones((n, n, 4)); ht[..., :3] = np.clip(h, 0, 1)[..., None]

    # veins a touch glossier; the fuzz between them scatters
    r = np.clip(0.68 - 0.16 * vein + 0.10 * (fine - 0.5), 0.2, 0.95)
    rg = np.ones((n, n, 4)); rg[..., :3] = r[..., None]

    # kept in linear float for whoever wants to re-encode them — the web export
    # needs sRGB 8-bit PNGs and a normal map, and regenerating the vein field a
    # second time to get them would be a second chance to disagree with the mesh
    TEX_ARRAYS.update(albedo=alb[..., :3].copy(), height=h.copy(), rough=r.copy())
    return (make_image("violet_albedo", alb),
            make_image("violet_height", ht),
            make_image("violet_rough", rg))


def petal_textures(n):
    """The corolla, which was the last flat colour left on the plant.

    A petal is not a small leaf. Its venation fans out of the throat rather than
    running to a tip, the tissue is thin enough that the margin glows, and it
    has a pale throat that a leaf has no equivalent for. Same three maps, so the
    material below is the same shape as the leaf's.
    """
    u = np.linspace(0.0, 1.0, n)
    U, V = np.meshgrid(u, u, indexing='xy')
    su, bt = U * 2.0 - 1.0, V

    mottle = fbm((n, n), 4, octaves=5)
    fine = fbm((n, n), 26, octaves=3)

    # What repeats across a petal is the *angle* out of the throat, not the
    # distance across it — dividing by `bt` is the whole difference between a
    # fan of veins and a set of parallel stripes.
    # It has to be an *angle*. Writing the fan as the ratio su/bt let the
    # frequency blow up as it approached the base, so the veins bunched into
    # concentric rings there and the flower came out a camellia. atan2 is
    # bounded, so the spacing stays even the whole way down the petal.
    fan = np.arctan2(su, np.maximum(bt, 0.05))
    v = np.abs(np.sin(fan * 3.4))
    veins = smoothstep(0.60, 0.0, v) * smoothstep(0.08, 0.40, bt)

    # Distance from the middle of the *flower*, not along the petal.
    #
    # This is the one that mattered. A lobe is a fan, and `blade_width` opens
    # it fast: at bt = 0.10 — a tenth of the way along — it is already 88% of
    # its full width. So anything drawn "near the base" in bt is not a small
    # patch at the centre of the flower, it is a wedge reaching most of the way
    # to the rim, and five of those meeting is the pale star that has been
    # sitting across the face of every bloom. `hw/sz` is 0.62 for the dorsal
    # lobes and 0.78 for the ventral ones; 0.72 splits them.
    fanw = np.sin(np.pi * np.maximum(bt, 0.0) ** 0.55) ** 0.5
    rad = np.sqrt(bt ** 2 + (su * fanw * 0.72) ** 2)

    # Enough red to be violet. At (0.052, 0.005, 0.205) there was almost none
    # in it, and a purple with no red in it is periwinkle — which is what the
    # corolla was reading as against the greens of the greenhouse.
    deep = np.array([0.074, 0.009, 0.222])      # the body of the petal
    pale = np.array([0.142, 0.044, 0.328])      # the margin, where it is thinnest
    # Small and warm rather than big and cream. A Saintpaulia is saturated
    # almost the whole way to its centre; a wide pale base on five overlapping
    # petals adds up to a cream ring the flower does not have.
    # Not a cream dot. In every close-up the pale zone is a broad white flare
    # out of the centre, covering a third of each lobe before the colour takes
    # over — on a magenta cultivar it is nearly white.
    throat = np.array([0.420, 0.400, 0.360])

    col = deep[None, None, :] + (pale - deep)[None, None, :] * (mottle ** 1.3)[..., None]
    # a petal thins toward its edge, so the edge is paler — and that ring of
    # lighter colour is most of what says "thin" before any light gets through
    # At 0.60 this drew a pale outline round every petal, and five of those meet
    # in a ring — a bright moulded rim is precisely what a plastic flower has.
    col = col + (pale - deep)[None, None, :] * (0.18 * smoothstep(0.82, 1.0, np.abs(su)))[..., None]
    col = col + (pale - deep)[None, None, :] * (0.12 * smoothstep(0.92, 1.0, bt))[..., None]
    # a violet carries a deeper wash around the throat before the pale eye
    col = col * (1.0 - 0.30 * smoothstep(0.40, 0.12, rad))[..., None]
    tw = (smoothstep(0.150, 0.020, rad) ** 1.7)[..., None]
    col = col * (1 - tw) + throat[None, None, :] * tw
    # veins are a deeper crease in the colour, never a drawn line — but at 0.38
    # they did not register at all, and what did not register was a flat wash.
    # 0.66 overshot the other way: paired with the relief below it put a pale
    # star across the face of every flower, and a Saintpaulia's venation is
    # barely visible in a photograph taken from the front.
    col = col * (1.0 - 0.34 * veins[..., None])

    alb = np.ones((n, n, 4)); alb[..., :3] = np.clip(col, 0, 1)

    # Ribbed along the veins, with the tissue between them lifting a little.
    # At 0.30 the groove walls were steep enough to turn every vein into a lit
    # ridge and a dark one, which is where the star came from: the albedo drew
    # the veins dark and the normal map lit them right back up again.
    h = 0.5 - 0.13 * veins + 0.16 * (mottle - 0.5) + 0.05 * (fine - 0.5)
    ht = np.ones((n, n, 4)); ht[..., :3] = np.clip(h, 0, 1)[..., None]

    # matte and faintly velvety; the creases catch a little more than the rest
    r = np.clip(0.74 - 0.10 * veins + 0.08 * (fine - 0.5), 0.40, 0.95)
    rg = np.ones((n, n, 4)); rg[..., :3] = r[..., None]

    TEX_ARRAYS.update(petal_albedo=alb[..., :3].copy(),
                      petal_height=h.copy(), petal_rough=r.copy())
    return (make_image("violet_petal_albedo", alb),
            make_image("violet_petal_height", ht),
            make_image("violet_petal_rough", rg))


def stem_textures(n):
    """Petioles and scapes, which are not green.

    In every photograph of a Saintpaulia the stalks are a dusky red-brown for
    most of their length and only turn green up under the blade, and they are
    as hairy as the leaves are. This was one flat sage colour with a sheen on
    it, which is what made the middle of the plant read as a bundle of tubing.

    v runs from the compost to the blade; u runs once around the stalk, with
    u = 0 on the grooved upper face.
    """
    u = np.linspace(0.0, 1.0, n)
    U, V = np.meshgrid(u, u, indexing='xy')
    fine = fbm((n, n), 40, octaves=3)
    ribs = fbm((n, n), 7, octaves=4)

    red = np.array([0.062, 0.019, 0.015])       # where it leaves the compost
    green = np.array([0.048, 0.079, 0.027])     # and up under the blade
    # The green is confined to the last stretch under the blade. Blended from
    # halfway the stalk came out salmon pink, which is a colour no Saintpaulia
    # has ever been — the photographs are dusky maroon nearly to the top.
    mix = smoothstep(0.72, 0.99, V)[..., None]
    col = red[None, None, :] * (1 - mix) + green[None, None, :] * mix
    # ribbed along its length, which is what a fleshy stalk does, and mottled
    # across it, which is what stops a tube reading as extruded
    col = col * (1.0 - 0.26 * (ribs - 0.5))[..., None]
    col = col * (1.0 + 0.26 * (fine - 0.5))[..., None]
    # the channel on the upper face sits in its own shadow
    col = col * (1.0 - 0.20 * np.exp(-((np.minimum(U, 1.0 - U)) / 0.09) ** 2))[..., None]

    alb = np.ones((n, n, 4)); alb[..., :3] = np.clip(col, 0, 1)

    # Hairs as relief. A violet's petiole is as hairy as its blade, and a shell
    # over something 3 mm across cannot carry all of it — most of what reads as
    # fuzz on a stalk at arm's length is the way it breaks up the highlight.
    h = np.clip(0.5 + 0.46 * (fine - 0.5) + 0.30 * (ribs - 0.5), 0, 1)
    ht = np.ones((n, n, 4)); ht[..., :3] = h[..., None]

    r = np.clip(0.68 + 0.18 * (fine - 0.5) - 0.06 * (ribs - 0.5), 0.42, 0.94)
    rg = np.ones((n, n, 4)); rg[..., :3] = r[..., None]

    TEX_ARRAYS.update(stem_albedo=alb[..., :3].copy(),
                      stem_height=h.copy(), stem_rough=r.copy())
    return (make_image("violet_stem_albedo", alb),
            make_image("violet_stem_height", ht),
            make_image("violet_stem_rough", rg))


def anther_textures(n):
    """The two yellow anthers, which are the middle of the flower.

    These were the last thing on the plant still wearing a flat colour, and in
    close-up that is exactly what they looked like: two smooth cream beads. A
    Saintpaulia anther is a dry sac with a slit down one face and a surface
    entirely covered in pollen. The grain is the point — and it has to be a map
    rather than a noise node, because glTF has no procedural textures and a
    node-driven Base Color exports as the socket's unlinked default.

    UVs come from `blob()`: u runs once around the sac, v from tip to tip.
    """
    u = np.linspace(0.0, 1.0, n)
    U, V = np.meshgrid(u, u, indexing='xy')

    # pollen as discrete grains rather than a haze — thresholded fine noise over
    # a slower mottle, so the sac is dusted unevenly the way a real one is
    grain = smoothstep(0.42, 0.74, fbm((n, n), 34, octaves=3, rough=0.62))
    mottle = fbm((n, n), 5, octaves=4)

    # the dehiscence slit: one line down the face that splits open to shed
    slit = (np.exp(-((U - 0.5) / 0.045) ** 2)
            * smoothstep(0.06, 0.24, V) * smoothstep(0.96, 0.76, V))

    deep = np.array([0.300, 0.170, 0.012])
    bright = np.array([0.860, 0.720, 0.190])
    col = deep[None, None, :] + (bright - deep)[None, None, :] * np.clip(
        0.34 + 0.52 * grain + 0.22 * (mottle - 0.5), 0, 1)[..., None]
    col = col * (1.0 - 0.62 * slit)[..., None]
    # and it darkens where it meets the filament, instead of being one even
    # yellow the whole way round — a bead is even, an anther is not
    col = col * (1.0 - 0.30 * smoothstep(0.16, 0.0, V))[..., None]
    col = col * (1.0 - 0.30 * smoothstep(0.84, 1.0, V))[..., None]

    alb = np.ones((n, n, 4)); alb[..., :3] = np.clip(col, 0, 1)

    h = np.clip(0.46 + 0.34 * grain + 0.10 * (mottle - 0.5) - 0.40 * slit, 0, 1)
    ht = np.ones((n, n, 4)); ht[..., :3] = h[..., None]

    # Pollen is dust. Nothing here is allowed to be shiny: two glossy beads in
    # the middle of the flower is most of what made the bloom read as moulded.
    r = np.clip(0.88 - 0.10 * grain + 0.06 * (mottle - 0.5), 0.72, 0.98)
    rg = np.ones((n, n, 4)); rg[..., :3] = r[..., None]

    TEX_ARRAYS.update(eye_albedo=alb[..., :3].copy(),
                      eye_height=h.copy(), eye_rough=r.copy())
    return (make_image("violet_eye_albedo", alb),
            make_image("violet_eye_height", ht),
            make_image("violet_eye_rough", rg))


ALB, HGT, ROU = leaf_textures(int(P['tex']))
# Half resolution: a petal is a fifth the size of a blade on screen and there
# are five of them per bloom, so the memory is better spent on the leaves.
P_ALB, P_HGT, P_ROU = petal_textures(max(128, int(P['tex']) // 2))
# 2 mm across on a 55 mm plant. 256 is already more texels than it can show.
A_ALB, A_HGT, A_ROU = anther_textures(256)
S_ALB, S_HGT, S_ROU = stem_textures(256)


# ---- materials -------------------------------------------------------------
def principled(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree, m.node_tree.nodes["Principled BSDF"]


def set_if(node, key, val):
    if key in node.inputs:
        node.inputs[key].default_value = val


def leaf_material():
    m, nt, b = principled("violet_leaf")
    n = nt.nodes
    tex_a = n.new('ShaderNodeTexImage'); tex_a.image = ALB; tex_a.location = (-820, 300)
    tex_h = n.new('ShaderNodeTexImage'); tex_h.image = HGT; tex_h.location = (-820, 0)
    tex_r = n.new('ShaderNodeTexImage'); tex_r.image = ROU; tex_r.location = (-820, -300)

    # the underside of a Saintpaulia leaf is paler and often flushed red
    back = n.new('ShaderNodeMixRGB'); back.location = (-460, 300)
    back.inputs[2].default_value = (0.085, 0.055, 0.045, 1)
    geo = n.new('ShaderNodeNewGeometry'); geo.location = (-820, 560)
    nt.links.new(tex_a.outputs['Color'], back.inputs[1])
    nt.links.new(geo.outputs['Backfacing'], back.inputs[0])

    # sub-millimetre fuzz, chained *under* the vein bump so both survive. This
    # is the hair layer — a violet leaf is not smooth anywhere, and a perfectly
    # smooth dark green surface reads as rubber no matter how good the veins are.
    fz = n.new('ShaderNodeTexNoise'); fz.location = (-1100, -420)
    fz.inputs['Scale'].default_value = 320.0
    fz.inputs['Detail'].default_value = 8.0
    fz.inputs['Roughness'].default_value = 0.75
    fuzz = n.new('ShaderNodeBump'); fuzz.location = (-800, -420)
    fuzz.inputs['Strength'].default_value = 0.22
    fuzz.inputs['Distance'].default_value = 0.0008
    nt.links.new(fz.outputs['Fac'], fuzz.inputs['Height'])

    bump = n.new('ShaderNodeBump'); bump.location = (-460, -60)
    bump.inputs['Strength'].default_value = 0.6
    bump.inputs['Distance'].default_value = 0.004
    nt.links.new(tex_h.outputs['Color'], bump.inputs['Height'])
    nt.links.new(fuzz.outputs['Normal'], bump.inputs['Normal'])

    # every leaf on a real plant is a slightly different green — one texture
    # across eleven identical blades is a strong tell. `leafvar` is a per-leaf
    # constant written into the mesh, so this costs one attribute lookup.
    attr = n.new('ShaderNodeAttribute'); attr.location = (-1100, 620)
    attr.attribute_name = 'leafvar'
    tint = n.new('ShaderNodeMixRGB'); tint.location = (-820, 620)
    tint.inputs[1].default_value = (0.76, 1.02, 0.68, 1)     # young, bluer
    tint.inputs[2].default_value = (1.24, 1.04, 0.90, 1)     # older, yellower
    nt.links.new(attr.outputs['Fac'], tint.inputs[0])
    mul = n.new('ShaderNodeMixRGB'); mul.location = (-240, 380)
    mul.blend_type = 'MULTIPLY'
    mul.inputs[0].default_value = 1.0
    nt.links.new(back.outputs['Color'], mul.inputs[1])
    nt.links.new(tint.outputs['Color'], mul.inputs[2])

    nt.links.new(mul.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(tex_r.outputs['Color'], b.inputs['Roughness'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])

    # a leaf is thin and lit from behind as much as in front
    # enough to glow at the margins where the blade is thin, and no more —
    # scattering the whole leaf is what turned a dark green into sage
    set_if(b, 'Subsurface Weight', 0.11)
    set_if(b, 'Subsurface Radius', (0.010, 0.022, 0.006))
    set_if(b, 'Subsurface Scale', 0.005)
    # and it is covered in fine hairs, which is the whole velvet look
    set_if(b, 'Sheen Weight', 0.20)
    set_if(b, 'Sheen Roughness', 0.45)
    set_if(b, 'Sheen Tint', (0.42, 0.50, 0.34, 1))
    # a broad white specular over a dark leaf is what was greying it out — a
    # real leaf's highlight is narrow and mostly at grazing angles
    set_if(b, 'Specular IOR Level', 0.16)
    return m


def petal_material():
    """The same construction as the leaf, tuned for tissue two cells thick."""
    m, nt, b = principled("violet_petal")
    n = nt.nodes
    tex_a = n.new('ShaderNodeTexImage'); tex_a.image = P_ALB; tex_a.location = (-820, 300)
    tex_h = n.new('ShaderNodeTexImage'); tex_h.image = P_HGT; tex_h.location = (-820, 0)
    tex_r = n.new('ShaderNodeTexImage'); tex_r.image = P_ROU; tex_r.location = (-820, -300)

    # A Saintpaulia petal is finely papillate — thousands of little domed
    # cells — and that is what makes it read as velvet rather than as vinyl.
    # Far too small to put in a map, so it goes in as noise, chained under the
    # vein bump exactly the way the leaf chains its hairs.
    nap = n.new('ShaderNodeTexNoise'); nap.location = (-1100, -420)
    nap.inputs['Scale'].default_value = 420.0
    nap.inputs['Detail'].default_value = 7.0
    nap.inputs['Roughness'].default_value = 0.72
    velvet = n.new('ShaderNodeBump'); velvet.location = (-800, -420)
    velvet.inputs['Strength'].default_value = 0.20
    velvet.inputs['Distance'].default_value = 0.0004
    nt.links.new(nap.outputs['Fac'], velvet.inputs['Height'])

    bump = n.new('ShaderNodeBump'); bump.location = (-460, -60)
    bump.inputs['Strength'].default_value = 0.35
    bump.inputs['Distance'].default_value = 0.0012
    nt.links.new(tex_h.outputs['Color'], bump.inputs['Height'])
    nt.links.new(velvet.outputs['Normal'], bump.inputs['Normal'])

    # Six identical purples is the same tell that eleven identical greens was.
    # `leafvar` is already a per-part constant on the mesh, so the blooms can
    # read it exactly the way the blades do.
    attr = n.new('ShaderNodeAttribute'); attr.location = (-1100, 620)
    attr.attribute_name = 'leafvar'
    tint = n.new('ShaderNodeMixRGB'); tint.location = (-820, 620)
    tint.inputs[1].default_value = (0.91, 0.94, 1.08, 1)     # a bluer bloom
    tint.inputs[2].default_value = (1.09, 0.97, 0.98, 1)     # a redder one
    nt.links.new(attr.outputs['Fac'], tint.inputs[0])
    mul = n.new('ShaderNodeMixRGB'); mul.location = (-240, 380)
    mul.blend_type = 'MULTIPLY'
    mul.inputs[0].default_value = 1.0
    nt.links.new(tex_a.outputs['Color'], mul.inputs[1])
    nt.links.new(tint.outputs['Color'], mul.inputs[2])

    nt.links.new(mul.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(tex_r.outputs['Color'], b.inputs['Roughness'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])

    # This is the single biggest reason the old flat purple read as plastic:
    # plastic is opaque. A petal is lit through as much as it is lit on, and it
    # scatters much further than a leaf does because there is far less of it.
    # Enough to light the tissue through, and no more. At 0.45 with a 6 mm
    # scale the scattering ran right out to the silhouette and left a white
    # rim hugging every petal, which read as a moulded edge rather than a
    # glow — the thinner the geometry, the less of this it takes.
    set_if(b, 'Subsurface Weight', 0.28)
    set_if(b, 'Subsurface Radius', (0.060, 0.022, 0.090))
    set_if(b, 'Subsurface Scale', 0.0022)
    set_if(b, 'Sheen Weight', 0.34)
    set_if(b, 'Sheen Roughness', 0.30)
    set_if(b, 'Sheen Tint', (0.72, 0.62, 0.86, 1))
    # and no broad white gloss, which is the other half of looking moulded
    set_if(b, 'Specular IOR Level', 0.13)
    return m


def stem_material():
    """Image-mapped, and still translucent: a petiole held against the light
    glows, which is half of why a violet looks alive rather than moulded."""
    m, nt, b = principled("violet_stem")
    ta = nt.nodes.new('ShaderNodeTexImage'); ta.image = S_ALB; ta.location = (-700, 240)
    tr = nt.nodes.new('ShaderNodeTexImage'); tr.image = S_ROU; tr.location = (-700, 0)
    th = nt.nodes.new('ShaderNodeTexImage'); th.image = S_HGT; th.location = (-700, -240)
    bp = nt.nodes.new('ShaderNodeBump'); bp.location = (-420, -240)
    bp.inputs['Strength'].default_value = 0.80
    bp.inputs['Distance'].default_value = 0.0005
    nt.links.new(ta.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(tr.outputs['Color'], b.inputs['Roughness'])
    nt.links.new(th.outputs['Color'], bp.inputs['Height'])
    nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    set_if(b, 'Subsurface Weight', 0.30)
    set_if(b, 'Subsurface Radius', (0.02, 0.03, 0.01))
    set_if(b, 'Subsurface Scale', 0.010)
    set_if(b, 'Sheen Weight', 0.45)
    set_if(b, 'Sheen Roughness', 0.35)
    set_if(b, 'Sheen Tint', (0.34, 0.30, 0.24, 1))
    set_if(b, 'Specular IOR Level', 0.30)
    return m


def anther_material():
    """Image-mapped, for the same reason the blade and the corolla are: a noise
    node looks right in Cycles and exports as nothing at all."""
    m, nt, b = principled("violet_eye")
    ta = nt.nodes.new('ShaderNodeTexImage'); ta.image = A_ALB; ta.location = (-700, 240)
    tr = nt.nodes.new('ShaderNodeTexImage'); tr.image = A_ROU; tr.location = (-700, 0)
    th = nt.nodes.new('ShaderNodeTexImage'); th.image = A_HGT; th.location = (-700, -240)
    bp = nt.nodes.new('ShaderNodeBump'); bp.location = (-420, -240)
    bp.inputs['Strength'].default_value = 0.60
    bp.inputs['Distance'].default_value = 0.00035
    nt.links.new(ta.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(tr.outputs['Color'], b.inputs['Roughness'])
    nt.links.new(th.outputs['Color'], bp.inputs['Height'])
    nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    set_if(b, 'Specular IOR Level', 0.22)
    return m


def simple(name, base, rough=0.6, sss=0.0, sss_r=(0.02, 0.02, 0.02),
           sheen=0.0, spec=0.5, sheen_tint=(0.34, 0.38, 0.28)):
    m, nt, b = principled(name)
    set_if(b, 'Base Color', (*base, 1))
    set_if(b, 'Roughness', rough)
    set_if(b, 'Specular IOR Level', spec)
    if sss:
        set_if(b, 'Subsurface Weight', sss)
        set_if(b, 'Subsurface Radius', sss_r)
        set_if(b, 'Subsurface Scale', 0.010)
    if sheen:
        set_if(b, 'Sheen Weight', sheen)
        set_if(b, 'Sheen Roughness', 0.35)
        # The tint is not cosmetic. glTF's KHR_materials_sheen carries a colour
        # and a roughness and has nowhere to put a weight, so Blender's exporter
        # writes the tint and drops the weight — leaving this at its default
        # white shipped a full-strength white gloss over every stem and scape.
        set_if(b, 'Sheen Tint', (*sheen_tint, 1))
    return m


def noisy(name, c1, c2, scale=40.0, rough=0.85, bump=0.3, detail=6.0):
    """Procedural colour and bump variation — pot, soil, bench."""
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


M_LEAF = leaf_material()
M_STEM = stem_material()
M_PETAL = petal_material()
# An anther is a dry sac covered in pollen, not a bead. This was a `noisy()`
# procedural, which was right in Cycles and shipped to the browser as a flat
# cream colour with no relief at all — two smooth beads in the middle of every
# flower. It is a real map now, and `blob()` gives it real UVs to sample.
M_EYE = anther_material()
# Hairs are near-colourless and translucent; they read as a pale rim where the
# light comes through them, which is most of what "velvet" looks like up close.
M_HAIR = simple("violet_hair", (0.34, 0.40, 0.26), rough=0.42, sheen=0.5)


# ---- one mesh for the whole plant, one armature to bend it -----------------
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
varl = bm.verts.layers.float.new("leafvar")   # one constant per leaf
SLOT_LEAF, SLOT_STEM, SLOT_PETAL, SLOT_EYE = 0, 1, 2, 3
weights = []          # (vert_index, bone_name, weight)
bones = []            # (name, head, tail, up, parent)
LEAF_FACES = []       # (first, last) face index per leaf, for the clipping check
BLADE_VERTS = []      # blade-only vertices, so hair emits from the blade alone


def frame(ang, tilt, origin):
    """The rosette places each leaf by an azimuth and an elevation."""
    ca, sa = math.cos(ang), math.sin(ang)
    ct, st = math.cos(tilt), math.sin(tilt)

    def to_world(x, y, z):
        y2, z2 = y * ct - z * st, y * st + z * ct
        return Vector((x * ca - y2 * sa + origin[0],
                       x * sa + y2 * ca + origin[1],
                       z2 + origin[2]))
    return to_world


def chain(prefix, pts, ups):
    """A bone per segment, each one the child of the last."""
    names = []
    for s in range(len(pts) - 1):
        nm = f"{prefix}_{s}"
        bones.append((nm, pts[s], pts[s + 1], ups[s],
                      f"{prefix}_{s - 1}" if s else None))
        names.append(nm)
    return names


def bind(vidx, sv, names):
    """Tent weights along the chain: smooth, and exact at both ends."""
    k = len(names)
    ws = [max(0.0, 1.0 - abs(sv - (i + 0.5) / k) * k) for i in range(k)]
    tot = sum(ws) or 1.0
    for nm, w in zip(names, ws):
        if w > 1e-5:
            weights.append((vidx, nm, w / tot))


def margin_nicks(BT, seed, amount):
    """A few localised bites out of one leaf's margin.

    Nothing in nature is die-cut, and eighteen blades with identical outlines is
    a stronger tell than any material setting. Deterministic in `seed`, so a
    given leaf keeps its damage across rebuilds.
    """
    if amount <= 0:
        return np.ones_like(BT)
    r = np.random.default_rng(int(seed))
    out = np.ones_like(BT)
    for _ in range(int(r.integers(1, 4))):
        c = r.uniform(0.15, 0.92)
        w = r.uniform(0.02, 0.06)
        d = r.uniform(0.05, 0.22) * amount
        out = out - d * np.exp(-(((BT - c) / w) ** 2))
    return np.clip(out, 0.45, 1.0)


def crown_at(ang, cz):
    """Where this leaf's petiole leaves the stem.

    The offset has to point the same way the leaf does. `frame` sends local +y
    to (-sin, cos), so the offset is (-sin, cos) as well. Writing it as
    (+sin, cos) — which is what this did — aims the base the wrong way at every
    azimuth except 0 and 180 degrees, and that is what was dragging neighbouring
    petioles back across the axis into one another.
    """
    cr = float(P['crown_r'])
    return (-math.sin(ang) * cr, math.cos(ang) * cr, cz)


def blade_xyz(SU, BT, ang, tilt, scl, cz, lseed=0):
    """Blade surface points in world space, vectorised.

    The placement solver and the mesh builder both go through here, so the two
    can never disagree about where a leaf actually is — which they would, given
    the chance, and the solver would then certify geometry it had never seen.
    """
    pet, bl = float(P['petiole']), float(P['blade_len'])
    total = pet + bl
    pf = pet / total
    SV = pf + (1.0 - pf) * BT
    Y = SV * total * scl
    Z = -float(P['arch']) * (SV ** 2) * total * scl
    VE = vein_field(SU, BT)
    X = (SU * blade_width(BT) * margin_nicks(BT, lseed, float(P['nicks']))
         * float(P['blade_wide']) * scl)
    ZZ = Z + (float(P['cup']) * (SU ** 2) * 0.020
              + float(P['quilt']) * (1.0 - VE) * 0.0042) * scl
    ca, sa = math.cos(ang), math.sin(ang)
    ct, st = math.cos(tilt), math.sin(tilt)
    Y2 = Y * ct - ZZ * st
    Z2 = Y * st + ZZ * ct
    ox, oy, _ = crown_at(ang, 0.0)
    return np.stack([X * ca - Y2 * sa + ox,
                     X * sa + Y2 * ca + oy,
                     Z2 + cz], axis=-1), VE


def spine_lowest_over_rim(tilt, scl, cz):
    """How low the blade's centreline gets while it is out over the rim.

    Testing the centreline alone is enough because it is the lowest line on the
    blade: `cup` and `quilt` only ever *add* to ZZ, so every off-centre point
    sits above it, and the rim is a solid of revolution so azimuth cannot
    matter. Returns None when the leaf is too short to reach the rim at all.
    """
    total = float(P['petiole']) + float(P['blade_len'])
    arch = float(P['arch'])
    cr = float(P['crown_r'])
    ct, st = math.cos(tilt), math.sin(tilt)
    lo = None
    for k in range(241):
        sv = k / 240.0
        y = sv * total * scl
        zz = -arch * sv * sv * total * scl
        rad = cr + (y * ct - zz * st)
        if RIM_IN <= rad <= RIM_OUT:
            z = cz + (y * st + zz * ct)
            lo = z if lo is None else min(lo, z)
    return lo


def rim_droop_budget(tilt, scl, cz):
    """How far this leaf may rotate DOWN before its blade reaches the rim.

    `rim_safe_tilt` solves the same geometry upward — the smallest tilt that
    carries the blade over the rim — and wilting is that question backwards: a
    leaf bending under thirst is a leaf whose tilt is falling, and it may fall
    exactly as far as the clearance it started with.

    Without this the rosette simply rotates through the pot. Measured on the
    deformed mesh, the violet went from 0 leaf-vs-pot intersections turgid to 9
    at a quarter thirsty and 27 collapsed, and nothing said a word, because the
    build report runs on the REST mesh and droop is a pose.

    A real leaf does not pass through the pot either: it comes to rest ON the
    rim and drapes over it, which is what clamping here produces.
    """
    need = RIM_TOP + float(P['rim_clear'])
    if spine_lowest_over_rim(tilt, scl, cz) is None:
        return math.radians(180.0)       # never reaches the rim; nothing to hit
    lo_t, hi_t = -math.radians(30.0), tilt
    if spine_lowest_over_rim(hi_t, scl, cz) is not None and             spine_lowest_over_rim(hi_t, scl, cz) < need:
        return 0.0                       # already resting on it; do not go lower
    for _ in range(40):
        mid = 0.5 * (lo_t + hi_t)
        z = spine_lowest_over_rim(mid, scl, cz)
        if z is None or z >= need:
            hi_t = mid
        else:
            lo_t = mid
    return max(0.0, tilt - hi_t)


def rim_safe_tilt(tilt, scl, cz):
    """Raise a leaf just enough to carry its blade over the rim, not through it.

    The oldest leaves lie flattest and the crown sits below the rim, so those
    are the ones that foul it. Raising the whole rosette to fix four leaves
    would cost the spread that makes it read as a rosette, so this finds the
    smallest tilt that clears and stops there — a leaf already clear is
    returned untouched. Monotonic in tilt over this range, hence the bisection.
    """
    need = RIM_TOP + float(P['rim_clear'])
    lo = spine_lowest_over_rim(tilt, scl, cz)
    if lo is None or lo >= need:
        return tilt
    hi_t = math.radians(float(P['tilt_cap']))
    if hi_t <= tilt:
        return tilt
    top = spine_lowest_over_rim(hi_t, scl, cz)
    if top is not None and top < need:
        return hi_t                      # cannot clear; cap rather than spiral
    lo_t = tilt
    for _ in range(40):
        mid = 0.5 * (lo_t + hi_t)
        z = spine_lowest_over_rim(mid, scl, cz)
        if z is None or z >= need:
            hi_t = mid
        else:
            lo_t = mid
    return hi_t


# The grid the rosette is sampled on. At module scope because the droop budget
# solves against the same clouds, and two grids that differ by a point would be
# two different plants agreeing that they do not touch.
SU, BT = np.meshgrid(np.linspace(-1.0, 1.0, 9),
                     np.linspace(0.0, 1.0, 11), indexing='ij')


def solve_rosette():
    """Lay the leaves down oldest first, lifting each to clear what is already
    there.

    Overlapping in plan view is not the problem — a real rosette does that
    everywhere. Interpenetrating is. So each new leaf is raised by exactly the
    amount needed to sit above whatever it shadows, which is also the order the
    plant grows in, so the result reads as stacking rather than as leaves that
    have been shoved apart.
    """
    n = int(P['leaves'])
    near = float(P['xy_near'])
    gap = float(P['clearance'])
    placed, samples = [], []
    for i in range(n):
        age = i / max(1, n - 1)
        # Golden-angle phyllotaxis: successive leaves land 137.507 degrees
        # apart, so any two that end up near each other in angle are several
        # steps apart in age, and therefore already at different heights.
        ang = i * math.radians(137.507) + float(P['spiral_off'])
        tilt = math.radians(float(P['tilt_old'])
                            + (float(P['tilt_young']) - float(P['tilt_old'])) * age)
        scl = (1.0 - float(P['size_falloff']) * age) * (1.0 + rnd.uniform(-0.04, 0.04))
        # the stem elongates as it grows, so leaves close in angle but far apart
        # in age are separated vertically — which is what keeps the petioles
        # from growing through each other where they all meet
        cz = CROWN_Z + age * float(P['stem_rise'])
        # Over the rim, not through it. Done before the stacking lift below,
        # which only ever raises the leaf further, so this stays conservative.
        tilt = rim_safe_tilt(tilt, scl, cz)
        lseed = rnd.randrange(1, 10 ** 6)

        pts, _ = blade_xyz(SU, BT, ang, tilt, scl, cz, lseed)
        pts = pts.reshape(-1, 3)

        lift = 0.0
        for prev in samples:
            d = np.hypot(pts[:, None, 0] - prev[None, :, 0],
                         pts[:, None, 1] - prev[None, :, 1])
            over = d < near
            if not over.any():
                continue
            # how far below the older leaf does this one sit, where they meet?
            need = (prev[None, :, 2] + gap) - pts[:, None, 2]
            need = np.where(over, need, -np.inf)
            lift = max(lift, float(need.max()))
        lift = max(0.0, min(lift, float(P['max_lift'])))
        cz += lift
        pts[:, 2] += lift
        placed.append(dict(ang=ang, tilt=tilt, scl=scl, cz=cz, age=age,
                           lift=lift, lseed=lseed))
        samples.append(pts)
    return placed


PLACE = solve_rosette()


def rosette_top():
    """The highest the foliage actually reaches.

    The blooms used to sit at a hard-coded height, which was fine right up until
    carrying the outer leaves over the rim raised them and the flowers ended up
    underneath their own plant. A violet blooms just clear of its foliage, so
    measure the foliage rather than guessing at it — then any change to leaf
    geometry moves the flowers with it instead of silently burying them.
    """
    total = float(P['petiole']) + float(P['blade_len'])
    arch, cup = float(P['arch']), float(P['cup'])
    top = CROWN_Z
    for pl in PLACE:
        ct, st = math.cos(pl['tilt']), math.sin(pl['tilt'])
        for k in range(81):
            sv = k / 80.0
            y = sv * total * pl['scl']
            # the cupped margin is the highest line on the blade, not the spine
            zz = -arch * sv * sv * total * pl['scl'] + cup * 0.020 * pl['scl']
            top = max(top, pl['cz'] + (y * st + zz * ct))
    return top


ROSETTE_TOP = rosette_top()


def add_leaf(i):
    segs = int(P['segs'])
    pet, bl = float(P['petiole']), float(P['blade_len'])
    total = pet + bl
    pf = pet / total

    pl = PLACE[i]
    ang, tilt, scl, age = pl['ang'], pl['tilt'], pl['scl'], pl['age']
    # older leaves have had longer to yellow
    lv = min(1.0, max(0.0, 1.0 - age * 0.85 + rnd.uniform(-0.08, 0.08)))
    crown = crown_at(ang, pl['cz'])
    W = frame(ang, tilt, crown)

    # the spine, in the leaf's own frame, gently arching over. `arch` is a
    # fraction of the leaf's own length, so it stays proportional at any size.
    def spine(sv):
        y = sv * total * scl
        z = -float(P['arch']) * (sv ** 2) * total * scl
        return y, z

    pending = []          # (vert_index, sv) — bound once the chain exists

    # --- the stalk: compost to blade, in one piece
    #
    # A violet has no trunk. Every petiole and every flower stalk runs the
    # whole way down into the compost, and they converge so tightly at the
    # middle that the stem they share is invisible — the stalks themselves are
    # what fills it. The pass before this one drew that shared stem as a solid
    # column, which is the one thing a photograph of a Saintpaulia never shows.
    # Each leaf keeps its own attachment height, because that is what stops
    # neighbouring petioles growing through one another; it simply carries its
    # stalk the rest of the way down, in toward the axis, and into the soil.
    #
    # Nor is a petiole a tapered cylinder. It is fleshy, thickest where it
    # leaves the compost, and its upper face carries a channel that runs the
    # whole length — the groove that makes a violet leaf sit the way it does.
    # That channel is most of what tells the eye this is a plant and not a
    # length of dowel, and it costs two lines inside the ring.
    RING, RSTEP, PSTEP = 14, 6, 6
    GROOVE = 0.24 + 0.07 * rnd.random()
    R0 = 0.0031 * scl

    # where it enters the compost: close to the axis, and scattered a little so
    # that eighteen of them read as a bundle rather than as a starburst
    _rb = 0.0020 + 0.0028 * rnd.random()
    _ba = ang + rnd.uniform(-0.40, 0.40)
    B = Vector((-math.sin(_ba) * _rb, math.cos(_ba) * _rb, SOIL_Z - 0.005))
    K = Vector(crown)
    C = Vector((B.x * 0.72 + K.x * 0.28, B.y * 0.72 + K.y * 0.28, K.z))

    raw = []                       # (point, radius scale, sv)
    for a in range(RSTEP):
        t = a / RSTEP
        pt = B * ((1 - t) ** 2) + C * (2 * (1 - t) * t) + K * (t * t)
        # fleshiest at the compost, easing to the width it carries up the leaf
        raw.append((pt, 1.22 - 0.22 * t ** 0.8, 0.0))
    for a in range(PSTEP + 1):
        sv = pf * a / PSTEP
        t = a / PSTEP
        y, z = spine(sv)
        # not a straight draft: a slight swelling a third of the way up, then a
        # real narrowing where the blade takes over
        raw.append((W(0.0, y, z),
                    1.00 - 0.28 * t + 0.09 * math.sin(t * math.pi), sv))

    # and a wander over the whole length, pinned to zero at both ends so the
    # stalk still meets the compost and the blade exactly where it must
    _ph = rnd.uniform(0, math.tau)
    _amp = 0.0013 * scl
    _side = Vector((math.cos(_ph), math.sin(_ph), 0.0))
    _n = len(raw) - 1
    stalk = []
    for _i, (pt, rs, sv) in enumerate(raw):
        _s = _i / _n
        stalk.append((pt + _side * (_amp * math.sin(_s * math.pi) ** 0.9
                                    * math.sin(_s * 2.7 + _ph)), rs, sv))

    prev = None
    for _i, (c, rs, sv) in enumerate(stalk):
        if _i == 0:
            tan = (stalk[1][0] - c).normalized()
        elif _i == _n:
            tan = (c - stalk[_i - 1][0]).normalized()
        else:
            tan = (stalk[_i + 1][0] - stalk[_i - 1][0]).normalized()
        ref = Vector((1, 0, 0)) if abs(tan.z) > 0.94 else Vector((0, 0, 1))
        uu = (ref - tan * ref.dot(tan)).normalized()     # "up" across the tube
        ww = tan.cross(uu).normalized()
        # The cross-section is not the same shape the whole way up, and that is
        # most of the difference between a stalk and a length of tapered pipe.
        # Where it leaves the compost it is round and swollen; by the time it
        # reaches the blade it has flattened and opened the channel that the
        # midrib sits in. Morphing between the two costs three cosines.
        _t = _i / _n
        gr = GROOVE * (0.10 + 0.90 * _t ** 1.4)          # channel deepens
        flat = 0.05 + 0.13 * _t                          # and it flattens
        ring = []
        for k in range(RING):
            th = k / RING * math.tau                     # th = 0 is the top
            d = abs(((th + math.pi) % math.tau) - math.pi)
            rr = R0 * rs * (1.0 - gr * math.exp(-(d / 0.62) ** 2))
            rr *= 1.0 + flat * math.cos(2 * th)
            # shallow flutes, drifting round as they climb — a fleshy stalk is
            # never a surface of revolution
            rr *= 1.0 + 0.035 * math.cos(5 * th + _t * 2.2 + GROOVE * 9.0)
            v = bm.verts.new(c + (uu * math.cos(th) + ww * math.sin(th)) * rr)
            ring.append(v)
            pending.append((len(bm.verts) - 1, sv))
        if prev is None:
            # Closed. The blade hides the top end and the compost hides this
            # one, but "hidden by something else" is not the same as closed,
            # and a 3 mm hole looking straight up a petiole is what you get the
            # first time the camera goes under the rosette.
            cap = bm.faces.new(tuple(reversed(ring)))
            cap.material_index = SLOT_STEM
        else:
            for k in range(RING):
                f = bm.faces.new((prev[k], prev[(k + 1) % RING],
                                  ring[(k + 1) % RING], ring[k]))
                f.material_index = SLOT_STEM
                for lp, _u, _v in zip(f.loops, (k, k + 1, k + 1, k),
                                      (_i - 1, _i - 1, _i, _i)):
                    lp[uvl].uv = (_u / RING, _v / _n)
        prev = ring
    _pcap = bm.faces.new(tuple(prev))     # and the top, where the blade starts
    _pcap.material_index = SLOT_STEM
    bm.verts.ensure_lookup_table()

    # --- blade: a grid, placed by the same function the solver measured
    U, V = 23, 31
    SU, BT = np.meshgrid(np.linspace(-1.0, 1.0, U),
                         np.linspace(0.0, 1.0, V), indexing='ij')
    XYZ, VE = blade_xyz(SU, BT, ang, tilt, scl, pl['cz'], pl['lseed'])

    # The clipping check compares leaf against leaf, and it has to compare
    # *blades*: eighteen stalks converging on one point in the compost overlap
    # each other by design, and counting that as clipping buries the real
    # thing under a hundred false positives.
    b0 = len(bm.faces)
    start = len(bm.verts)
    grid = []
    for a in range(U):
        col = []
        for b_ in range(V):
            sv = pf + (1 - pf) * float(BT[a, b_])
            v = bm.verts.new((float(XYZ[a, b_, 0]),
                              float(XYZ[a, b_, 1]),
                              float(XYZ[a, b_, 2])))
            v[varl] = lv
            col.append(v)
            pending.append((start + a * V + b_, sv))
            BLADE_VERTS.append(start + a * V + b_)
        grid.append(col)
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()

    # Which way round the quads are wound decides which way the blade faces,
    # and the answer is not obvious: it falls out of the frame `blade_xyz`
    # builds in, and it came out pointing at the floor. On a double-sided
    # material that is invisible — right up until something *uses* the normal.
    # Two things do. Solidify grows away from it, so the thickness was being
    # added on top of the leaf instead of underneath; and the fuzz shells are
    # pushed along it, so every hair on the plant ended up hanging under the
    # leaf it belongs to, which is precisely where a violet has none. Decide it
    # once from the geometry rather than guessing at the winding.
    ai, bi = U // 2, V // 2
    e_b = grid[ai][bi + 1].co - grid[ai][bi].co
    e_a = grid[ai + 1][bi].co - grid[ai][bi].co
    up_hint = (W(0.0, 0.0, 1.0) - W(0.0, 0.0, 0.0)).normalized()
    quad = (((0, 0), (0, 1), (1, 1), (1, 0)) if e_b.cross(e_a).dot(up_hint) >= 0
            else ((0, 0), (1, 0), (1, 1), (0, 1)))

    for a in range(U - 1):
        for b_ in range(V - 1):
            f = bm.faces.new(tuple(grid[a + da][b_ + db] for da, db in quad))
            f.material_index = SLOT_LEAF
            for lp in f.loops:
                idx = lp.vert.index - start
                lp[uvl].uv = ((idx // V) / (U - 1), (idx % V) / (V - 1))
    b1 = len(bm.faces)

    # --- the chain this leaf bends on
    pts, ups = [], []
    for s in range(segs + 1):
        y, z = spine(s / segs)
        pts.append(W(0.0, y, z))
        ups.append((W(0.0, y, z + 1.0) - W(0.0, y, z)).normalized())
    names = chain(f"L{i}", pts, ups)

    for vi, sv in pending:
        bind(vi, sv, names)
    LEAF_FACES.append((b0, b1))


def add_bloom(j):
    """Five petals and a yellow eye on a scape that clears the rosette."""
    ang = (j / max(1, int(P['blooms']))) * math.tau + 0.7 + rnd.uniform(-0.2, 0.2)
    bv = rnd.random()               # this bloom's own shade, read by M_PETAL
    r = rnd.uniform(0.014, 0.042)   # spread, or they read as one purple mass
    # violets bloom just clear of their own foliage, not on tall stems — and
    # "clear of the foliage" has to be measured, or it stops being true
    hgt = ROSETTE_TOP + 0.005 + rnd.uniform(0, 0.011)
    op = float(P['bloom_open'])
    # The scape starts in the compost too, near the axis, and leans out only
    # near its head — which is why a violet in bloom reads as a posy held up
    # over the foliage rather than as a set of spokes stuck into a pot. It used
    # to begin a third of the way out at crown height, on nothing.
    _sa = ang + rnd.uniform(-0.35, 0.35)
    _sr = 0.0016 + 0.0024 * rnd.random()
    base = Vector((math.sin(_sa) * _sr, math.cos(_sa) * _sr, SOIL_Z - 0.005))
    top = Vector((math.sin(ang) * r, math.cos(ang) * r, hgt))
    # nearly upright out of the soil, and all the lean in the last third
    ctrl = Vector((base.x * 0.80 + top.x * 0.20,
                   base.y * 0.80 + top.y * 0.20,
                   base.z + (hgt - base.z) * 0.74))

    def scape_pt(sv):
        return (base * ((1 - sv) ** 2) + ctrl * (2 * (1 - sv) * sv)
                + top * (sv * sv))

    segs = 3
    pts = [scape_pt(s_ / segs) for s_ in range(segs + 1)]
    ups = [Vector((1, 0, 0)) for _ in pts]
    names = chain(f"B{j}", pts, ups)

    # --- scape
    RING, ST = 10, 9
    _sph = rnd.uniform(0, math.tau)
    _samp = 0.0016
    _sside = Vector((math.cos(_sph), math.sin(_sph), 0.0))
    _spine = []
    for a_ in range(ST + 1):
        sv = a_ / ST
        c = scape_pt(sv)
        # the same pinned wander the petioles get: a flower stalk that is dead
        # straight is the giveaway that it was extruded rather than grown
        c = c + _sside * (_samp * math.sin(sv * math.pi) ** 0.9
                          * math.sin(sv * 2.3 + _sph))
        # thickest at the compost, narrowing under the head, with the slight
        # swelling a peduncle carries where the pedicels will come off it
        rr = 0.00165 * (1.0 - 0.44 * sv + 0.10 * math.sin(sv * math.pi * 1.6))
        _spine.append((c, rr, sv))

    prev = None
    for a_, (c, rr, sv) in enumerate(_spine):
        if a_ == 0:
            tan = (_spine[1][0] - c).normalized()
        elif a_ == ST:
            tan = (c - _spine[a_ - 1][0]).normalized()
        else:
            tan = (_spine[a_ + 1][0] - _spine[a_ - 1][0]).normalized()
        ref = Vector((1, 0, 0)) if abs(tan.z) > 0.94 else Vector((0, 0, 1))
        uu = (ref - tan * ref.dot(tan)).normalized()
        ww = tan.cross(uu).normalized()
        ring = []
        for k in range(RING):
            th = k / RING * math.tau
            d = abs(((th + math.pi) % math.tau) - math.pi)
            # a shallower channel than the petiole's, but a scape has one
            rq = rr * (1.0 - 0.13 * math.exp(-(d / 0.7) ** 2))
            v = bm.verts.new(c + (uu * math.cos(th) + ww * math.sin(th)) * rq)
            ring.append(v)
            bind(len(bm.verts) - 1, sv, names)
        if prev is None:
            cap = bm.faces.new(tuple(reversed(ring)))
            cap.material_index = SLOT_STEM
        else:
            for k in range(RING):
                f = bm.faces.new((prev[k], prev[(k + 1) % RING],
                                  ring[(k + 1) % RING], ring[k]))
                f.material_index = SLOT_STEM
                for lp, _u, _v in zip(f.loops, (k, k + 1, k + 1, k),
                                      (a_ - 1, a_ - 1, a_, a_)):
                    lp[uvl].uv = (_u / RING, _v / ST)
        prev = ring
    _scap = bm.faces.new(tuple(prev))       # closed at the top, see add_leaf
    _scap.material_index = SLOT_STEM
    bm.verts.ensure_lookup_table()

    # --- the corolla, as a frame that faces up and leans a little outward,
    # which is how a violet actually presents its face
    # A violet presents its face outward and up, not straight up. At 16 deg
    # every bloom was seen edge-on from any normal camera height and read as
    # a flat purple plate; the face is the whole flower, so it has to tip.
    lean = math.radians(36) + rnd.uniform(-0.14, 0.14)
    cl, sl = math.cos(lean), math.sin(lean)
    ra = Vector((math.sin(ang), math.cos(ang), 0.0))     # outward, in plan
    ta = Vector((ra.y, -ra.x, 0.0))                      # across it
    up = Vector((0.0, 0.0, 1.0))
    face_up = (up * cl + ra * sl).normalized()
    face_ra = (ra * cl - up * sl).normalized()

    # A Saintpaulia corolla is zygomorphic, not radial: two small dorsal lobes
    # up top and three larger ones fanned below, on a very short corolla tube.
    # Spacing all five at 72 degrees — which is what this did — builds a
    # periwinkle. The bilateral arrangement is the single strongest cue that
    # this is a violet and not a generic five-petalled flower.
    #
    # `pa` is measured around the flower's face from `face_ra`, which points up
    # and outward, so pa = 0 is the top of the face.
    LOBES = [
        (math.radians(-38), 0.0122),   # dorsal pair, small and held back
        (math.radians(38),  0.0122),
        (math.radians(132), 0.0178),   # ventral trio, large and fanned
        (math.radians(180), 0.0186),   # the lowest lobe is the biggest of all
        (math.radians(228), 0.0178),
    ]
    for p, (pa0, sz0) in enumerate(LOBES):
        pa = pa0 + rnd.uniform(-0.05, 0.05)
        sz = sz0 * op
        hw = (0.62 if p < 2 else 0.78) * sz
        d_out = (face_ra * math.cos(pa) + ta * math.sin(pa)).normalized()
        d_side = d_out.cross(face_up).normalized()
        # 11 x 13 was not enough to carry the undulation below. The wave
        # amplitude was landing on a grid coarse enough that every crest came
        # out as a hard crease between two flat facets, so the whole corolla
        # read as folded paper — which is the opposite of what the ripple is
        # there to do. Same shape, four times the quads, still under 200 verts
        # a lobe.
        PU, PV = 15, 17
        cols = []
        pstart = len(bm.verts)
        for a in range(PU):
            col = []
            for b_ in range(PV):
                su = (a / (PU - 1) - 0.5) * 2
                bt = b_ / (PV - 1)
                # A real petal margin is not a clean arc — it waves slightly,
                # and that irregularity along the silhouette does more for
                # realism at this size than anything happening in the middle.
                w = math.sin(math.pi * bt ** 0.55) ** 0.5
                w *= 1.0 + 0.10 * math.sin(su * 7.0 + p * 2.1) * bt
                # A violet presents a flat face. Curling the sides up as hard as
                # this did turned five overlapping petals into a crumpled shell
                # — the shape was doing more to make it look moulded than the
                # material ever was.
                # A petal is not a smooth sheet. Broad, low undulation across
                # the blade is what stops a big curved surface reading as
                # vacuum-formed — before this the only relief anywhere on the
                # corolla was the creases where one lobe crossed another, and
                # no amount of roughness in the material could stand in for it.
                rip = (math.sin(su * 5.3 + p * 1.7) * math.sin(bt * 4.1 + p * 0.9)
                       + 0.45 * math.sin(su * 9.7 - bt * 6.3 + p * 2.6))
                # The margin ruffle, and it is the whole shape of the flower.
                # Photographs of a real corolla show edges that wave in and out
                # of plane by a good fraction of a millimetre — the petals are
                # never the clean arcs this was drawing. Concentrated in |su|^3
                # so the middle of the blade stays calm and only the rim moves,
                # which is what makes it read as a frill rather than a crumple.
                ruf = math.sin(su * 3.1 + bt * 8.5 + p * 1.9) * (abs(su) ** 3) * bt
                pt = (top + d_out * (bt * sz) + d_side * (su * w * hw)
                      + face_up * sz * (-0.09 * bt * bt + 0.035 * (su ** 2) * bt
                                        + 0.017 * rip * bt + 0.098 * ruf))
                v = bm.verts.new(pt)
                v[varl] = bv
                col.append(v)
                bind(len(bm.verts) - 1, 1.0, names)
            cols.append(col)
        bm.verts.ensure_lookup_table()
        bm.verts.index_update()
        # Same question as the blade, same answer: decide the winding from the
        # geometry. A lobe whose normal points into the flower gets its
        # thickness added on the visible side and its shading fought over.
        pe_b = cols[PU // 2][PV // 2 + 1].co - cols[PU // 2][PV // 2].co
        pe_a = cols[PU // 2 + 1][PV // 2].co - cols[PU // 2][PV // 2].co
        pquad = (((0, 0), (0, 1), (1, 1), (1, 0))
                 if pe_b.cross(pe_a).dot(face_up) >= 0
                 else ((0, 0), (1, 0), (1, 1), (0, 1)))
        for a in range(PU - 1):
            for b_ in range(PV - 1):
                f = bm.faces.new(tuple(cols[a + da][b_ + db]
                                       for da, db in pquad))
                f.material_index = SLOT_PETAL
                # `su` across, `bt` along — the same coordinates the petal was
                # built in, so the texture cannot disagree with the geometry
                for lp in f.loops:
                    idx = lp.vert.index - pstart
                    lp[uvl].uv = ((idx // PV) / (PU - 1), (idx % PV) / (PV - 1))

    def blob(c, rr, squash, slot, ES=12, uv=(0.0, 1.0)):
        """A small sphere: an anther, or the stigma on the end of the style.

        It carries UVs now. Without them every loop sat at (0, 0) and sampled
        one texel of whatever map the slot points at — which is why the anthers
        stayed a single flat colour however good their texture was, and why the
        corolla tube below came out wearing the white of the throat."""
        v0, v1 = uv
        rings = []
        for a in range(ES + 1):
            ph = a / ES * math.pi
            ring = []
            for k in range(ES):
                th = k / ES * math.tau
                ring.append(bm.verts.new((c.x + math.sin(ph) * math.cos(th) * rr,
                                          c.y + math.sin(ph) * math.sin(th) * rr,
                                          c.z + math.cos(ph) * rr * squash)))
                bind(len(bm.verts) - 1, 1.0, names)
            rings.append(ring)
        bm.verts.ensure_lookup_table()
        for a in range(ES):
            for k in range(ES):
                corners = ((rings[a][k],                 k,     a),
                           (rings[a][(k + 1) % ES],      k + 1, a),
                           (rings[a + 1][(k + 1) % ES],  k + 1, a + 1),
                           (rings[a + 1][k],             k,     a + 1))
                try:
                    f = bm.faces.new(tuple(v for v, _, _ in corners))
                except ValueError:
                    continue
                f.material_index = slot
                # keyed by vertex rather than by loop order, and using k + 1
                # rather than (k + 1) % ES, so the seam column gets u = 1
                # instead of wrapping the map backwards in one strip
                want = {v: (uu / ES, v0 + (v1 - v0) * vv / ES)
                        for v, uu, vv in corners}
                for lp in f.loops:
                    lp[uvl].uv = want[lp.vert]

    def filament(pts, rr, slot, RING=6, uv=(0.0, 1.0)):
        """A thin tube through `pts` — the style, and the corolla tube.

        Closed at both ends. Every open tube on this plant has turned out to be
        visible from somewhere."""
        v0, v1 = uv
        first = None
        prev = None
        for i, c in enumerate(pts):
            if i == 0:
                tan = (pts[1] - pts[0]).normalized()
            elif i == len(pts) - 1:
                tan = (pts[-1] - pts[-2]).normalized()
            else:
                tan = (pts[i + 1] - pts[i - 1]).normalized()
            axis = Vector((0, 0, 1))
            if abs(tan.dot(axis)) > 0.95:
                axis = Vector((1, 0, 0))
            u = tan.cross(axis).normalized()
            w2 = tan.cross(u).normalized()
            ring = []
            for k in range(RING):
                th = k / RING * math.tau
                ring.append(bm.verts.new(c + (u * math.cos(th) + w2 * math.sin(th)) * rr))
                bind(len(bm.verts) - 1, 1.0, names)
            bm.verts.ensure_lookup_table()
            if first is None:
                first = ring
            if prev:
                n = max(1, len(pts) - 1)
                for k in range(RING):
                    corners = ((prev[k],                 k,     i - 1),
                               (prev[(k + 1) % RING],    k + 1, i - 1),
                               (ring[(k + 1) % RING],    k + 1, i),
                               (ring[k],                 k,     i))
                    f = bm.faces.new(tuple(v for v, _, _ in corners))
                    f.material_index = slot
                    want = {v: (uu / RING, v0 + (v1 - v0) * vv / n)
                            for v, uu, vv in corners}
                    for lp in f.loops:
                        lp[uvl].uv = want[lp.vert]
            prev = ring
        for cap, flip in ((first, True), (prev, False)):
            if cap is None:
                continue
            fc = bm.faces.new(tuple(reversed(cap)) if flip else tuple(cap))
            fc.material_index = slot
            for lp in fc.loops:
                lp[uvl].uv = (0.5, v0 if flip else v1)

    # The corolla tube. Very short on a violet — but with no tube at all, five
    # petals converge on one point and the centre of the flower reads as a seam.
    # It samples the middle of the petal map, not the base of it. The map's
    # v = 0 end is the pale throat, and an untextured tube reading texel (0, 0)
    # put that white on the *outside* of the corolla — which from behind is the
    # two pale hexagons visible under every bloom in the game. The back of a
    # violet's corolla is violet.
    filament([top - face_up * 0.0034 + face_ra * -0.0006,
              top - face_up * 0.0012,
              top + face_up * 0.0008], 0.0021, SLOT_PETAL,
             RING=12, uv=(0.46, 0.76))

    # two fat yellow anthers, which is the detail that says Saintpaulia rather
    # than "small purple flower"
    for e in (-1, 1):
        blob(top + face_up * 0.0026 + ta * (e * 0.0021) + face_ra * 0.0010,
             0.0021, 0.85, SLOT_EYE)

    # Every Saintpaulia is enantiostylous: the style is deflected hard to the
    # left or right of the floral axis instead of standing up the middle, and
    # which way is a coin toss per flower. It is a hair of geometry and the
    # most specific thing about the bloom — a straight central style, or none
    # at all, reads as almost any other small purple flower.
    hand = 1 if rnd.random() < 0.5 else -1
    style = [top
             + face_up * (0.0012 + 0.0030 * (i / 5))
             + ta * (hand * 0.0042 * (i / 5) ** 2)
             + face_ra * (0.0008 * (i / 5))
             for i in range(6)]
    # 0.22 mm and 5 mm long. The first attempt at this was twice as thick and
    # twice as long, and a style that reads as a stick is worse than no style.
    filament(style, 0.00022, SLOT_STEM)
    blob(style[-1], 0.00040, 1.0, SLOT_STEM, ES=6)   # the stigma, 0.4 mm across


for i in range(int(P['leaves'])):
    add_leaf(i)
for j in range(int(P['blooms'])):
    add_bloom(j)

me = bpy.data.meshes.new("violet")
bm.to_mesh(me)
bm.free()
for m in (M_LEAF, M_STEM, M_PETAL, M_EYE):
    me.materials.append(m)
for poly in me.polygons:
    poly.use_smooth = True

plant = bpy.data.objects.new("violet", me)
# `context.collection` is the ACTIVE collection, and in background Blender
# there is no active one - it is None, and this file could only ever be built
# from the GUI. `scene.collection` is the master collection and always exists,
# so the violet can now be rebuilt headless the way the daylily can.
bpy.context.scene.collection.objects.link(plant)


# ---- the armature ----------------------------------------------------------
arm_data = bpy.data.armatures.new("violet_rig")
rig = bpy.data.objects.new("violet_rig", arm_data)
bpy.context.scene.collection.objects.link(rig)
# A freshly linked object is not in the view layer until it is resynced, and
# mode_set polls the view layer rather than the collection. Selecting forces it.
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

groups = {nm: plant.vertex_groups.new(name=nm) for (nm, _, _, _, _) in bones}
for (vi, nm, w) in weights:
    g = groups.get(nm)
    if g:
        g.add([vi], w, 'REPLACE')

# hair emits from the blade only — not the petiole, the scapes or the petals
blade_vg = plant.vertex_groups.new(name="blade")
blade_vg.add(sorted(set(BLADE_VERTS)), 1.0, 'REPLACE')

amod = plant.modifiers.new("rig", 'ARMATURE'); amod.object = rig
sol = plant.modifiers.new("thickness", 'SOLIDIFY')
sol.thickness, sol.offset = 0.00075, 0.0
sub = plant.modifiers.new("smooth", 'SUBSURF')
sub.levels, sub.render_levels = 1, 2
plant.parent = rig


# ---- the fuzz, which is what makes a violet leaf a violet leaf -------------
# At a full-plant framing individual hairs are sub-pixel; what they buy is the
# lit rim at the silhouette, and that rim is a strong photographic cue no amount
# of sheen on a bare surface reproduces. Added last so it sits on top of the
# armature and subdivision in the modifier stack.
if int(P['fuzz']) > 0:
    me.materials.append(M_HAIR)
    hair_slot = len(me.materials)          # particles index material slots from 1
    plant.modifiers.new("fuzz", 'PARTICLE_SYSTEM')
    psys = plant.particle_systems[-1]
    st = psys.settings
    st.type = 'HAIR'
    st.count = int(P['fuzz'])
    st.hair_length = float(P['fuzz_len'])
    st.hair_step = 2
    st.use_advanced_hair = True
    st.material = hair_slot
    st.use_modifier_stack = True
    psys.vertex_group_density = "blade"    # never from the petioles or petals
    # factor_random is a length in Blender units, NOT a fraction of hair_length.
    # Anything on the order of 0.1 adds tens of centimetres of random length to a
    # 1.7 mm hair, which fills the frame and takes ten minutes to render.
    jitter = float(P['fuzz_len']) * 0.25
    for k, v in (('root_radius', float(P['fuzz_rad'])),
                 ('tip_radius', float(P['fuzz_rad']) * 0.35),
                 ('radius_scale', 1.0), ('factor_random', jitter),
                 ('phase_factor_random', 0.7), ('child_type', 'INTERPOLATED'),
                 ('child_nbr', 1), ('rendered_child_count', 2),
                 ('child_length', 0.85), ('child_radius', float(P['fuzz_len']) * 0.9),
                 ('clump_factor', -0.08),
                 ('roughness_endpoint', float(P['fuzz_len']) * 0.3),
                 ('roughness_end_shape', 1.0)):
        try:
            setattr(st, k, v)
        except Exception:
            pass


# ---- droop and wind, both of them the same rig -----------------------------
SHARE = [0.10, 0.20, 0.32, 0.38]          # each bone takes more than the last

for pb in rig.pose.bones:
    pb.rotation_mode = 'XYZ'

droop = float(P['droop'])
total_droop = math.radians(float(P['flex_leaf_deg'])) * droop

# How far each leaf is allowed to fall before it is resting on the rim. Solved
# once here from the same `spine_lowest_over_rim` the placement used, and
# published onto the bone as a custom property so the VIEWER can apply the same
# limit — it drives this rig live off a slider, so a budget that existed only in
# Blender would keep the render honest and let the browser go on clipping.
def _blade_cloud(pl, fall, step=1):
    """The leaf as a point cloud, at a given fall. Same `blade_xyz` the mesh is
    built from, subsampled — the budget below needs shape, not resolution."""
    pts, _ = blade_xyz(SU, BT, pl['ang'], pl['tilt'] - fall, pl['scl'],
                       pl['cz'], pl['lseed'])
    return pts.reshape(-1, 3)[::step]


def _passes_through(a, a0, b, near, gap):
    """Has blade `a` gone THROUGH blade `b`, rather than come to rest on it?

    The distinction matters and the obvious test gets it wrong. "Overlapping in
    plan and within `gap` in height" flags two leaves lying against each other,
    which is what a rosette does at rest and what a wilting one does much more
    of — clamp on that and the plant stops drooping at all, which is what the
    first version of this did.

    So the test is a change of SIDE. Where the two overlap in plan, take the
    sign of the height difference in the leaf's undrooped pose `a0`; a crossing
    is that sign reversing by more than `gap`. Resting is allowed; passing
    through is not.
    """
    d = np.hypot(a[:, None, 0] - b[None, :, 0], a[:, None, 1] - b[None, :, 1])
    over = d < near
    if not over.any():
        return False
    was = a0[:, None, 2] - b[None, :, 2]
    now = a[:, None, 2] - b[None, :, 2]
    flipped = (was > 0) & (now < -gap)          # was above, is now below
    return bool((over & flipped).any())


# How far each leaf may fall. Two limits, solved together: the rim it must not
# go through, and the leaves already placed, which it must come to rest ON
# rather than pass through. A wilting rosette really does pile up on itself —
# clamping is what that looks like, and it is also why the outer leaves still
# fall furthest, since they are the ones with room underneath them.
#
# Published onto each leaf's root bone as a custom property, because the VIEWER
# drives this rig live off a slider: a budget that existed only in Blender would
# keep the render honest and let the browser go on clipping.
_near, _gap = float(P['xy_near']), float(P['clearance'])
DROOP_LIMIT = []
_settled = []
for _i, _pl in enumerate(PLACE):
    _k = 1.0 + 0.25 * math.sin(_i * 2.4)
    _hi = min(math.radians(float(P['flex_leaf_deg'])) * _k,
              rim_droop_budget(_pl['tilt'], _pl['scl'], _pl['cz']))
    _lo = 0.0
    _rest = _blade_cloud(_pl, 0.0)
    if _settled and _hi > 0.0:
        def _bad(f):
            mine = _blade_cloud(_pl, f)
            return any(_passes_through(mine, _rest, _c, _near, _gap)
                       or _passes_through(_c, _c, mine, _near, _gap)
                       for _c in _settled)
        if _bad(_hi):
            for _ in range(14):
                _mid = 0.5 * (_lo + _hi)
                if _bad(_mid):
                    _hi = _mid
                else:
                    _lo = _mid
            _hi = _lo
    DROOP_LIMIT.append(_hi)
    _settled.append(_blade_cloud(_pl, _hi))

for i in range(int(P['leaves'])):
    # outer leaves give up first; the crown is the last thing to go
    k = 1.0 + 0.25 * math.sin(i * 2.4)
    limit = DROOP_LIMIT[i] if i < len(DROOP_LIMIT) else math.radians(180.0)
    # SHARE sums to 1, so the tip's total rotation is `total_droop * k` and the
    # clamp is one division rather than a search.
    if total_droop * k > limit:
        k = limit / total_droop if total_droop > 1e-9 else 0.0
    for s in range(int(P['segs'])):
        nm = f"L{i}_{s}"
        if nm in rig.pose.bones:
            share = SHARE[s] if s < len(SHARE) else SHARE[-1]
            pb = rig.pose.bones[nm]
            pb.rotation_euler.x = -total_droop * share * k

# Carried to the viewer on the ARMATURE OBJECT, not on the bones: Blender's
# glTF exporter writes object custom properties into node `extras` and does not
# do the same for bone ones — the first attempt put them on `pb.bone` and the
# GLB came out with extras on nought of its 97 nodes. Indexed by leaf, radians.
rig["droop_limits"] = [float(v) for v in DROOP_LIMIT]

# The flowers go over with the foliage. A violet whose leaves have collapsed
# while its blooms stand up straight is the single most obvious tell that the
# wilt is a rig effect rather than a plant.
STALK_SHARE = [0.22, 0.34, 0.44]
stalk_droop = math.radians(float(P['flex_stalk_deg'])) * droop
for j in range(int(P['blooms'])):
    kk = 1.0 + 0.18 * math.sin(j * 1.7)
    for s in range(3):
        nm = f"B{j}_{s}"
        if nm in rig.pose.bones:
            share = STALK_SHARE[s] if s < len(STALK_SHARE) else STALK_SHARE[-1]
            rig.pose.bones[nm].rotation_euler.x = -stalk_droop * share * kk

wind = float(P['wind'])
FR = int(P['frames'])
scene.frame_start, scene.frame_end = 1, FR
scene.render.fps = 24

if wind > 0.0:
    for i in range(int(P['leaves'])):
        phase = rnd.uniform(0, math.tau)
        # a thirsty leaf has already given up; it moves less
        gain = wind * (1.0 - 0.55 * droop)
        for s in range(int(P['segs'])):
            nm = f"L{i}_{s}"
            if nm not in rig.pose.bones:
                continue
            pb = rig.pose.bones[nm]
            base_x = pb.rotation_euler.x
            amp = math.radians(1.1 + 2.3 * s) * gain      # the tip moves most
            lag = s * 0.55                                # and it lags behind
            for f in range(0, FR + 1, 6):
                t = f / FR
                a = (math.sin(math.tau * t + phase - lag) * 0.75
                     + math.sin(math.tau * 2 * t + phase * 1.7 - lag) * 0.25)
                b = (math.sin(math.tau * t + phase * 0.6 - lag + 1.1) * 0.8
                     + math.sin(math.tau * 3 * t + phase - lag) * 0.2)
                pb.rotation_euler.x = base_x + amp * a
                pb.rotation_euler.z = amp * b * 1.3
                # keys land on 1..FR+1, and only 1..FR is rendered — so the
                # wrap frame exists to interpolate towards but is never shown,
                # which is what makes the loop seamless instead of stuttering
                # on a duplicated pose
                pb.keyframe_insert("rotation_euler", frame=f + 1)
    for j in range(int(P['blooms'])):
        phase = rnd.uniform(0, math.tau)
        for s in range(2):
            nm = f"B{j}_{s}"
            if nm not in rig.pose.bones:
                continue
            pb = rig.pose.bones[nm]
            amp = math.radians(1.4 + 2.0 * s) * wind
            for f in range(0, FR + 1, 6):
                t = f / FR
                pb.rotation_euler.x = amp * math.sin(math.tau * t + phase - s * 0.5)
                pb.rotation_euler.z = amp * 1.1 * math.sin(
                    math.tau * t + phase * 0.7 - s * 0.5 + 1.4)
                # keys land on 1..FR+1, and only 1..FR is rendered — so the
                # wrap frame exists to interpolate towards but is never shown,
                # which is what makes the loop seamless instead of stuttering
                # on a duplicated pose
                pb.keyframe_insert("rotation_euler", frame=f + 1)

    def action_fcurves(action):
        """Blender 4.4 moved f-curves into slotted actions; 5.x has no
        `action.fcurves` at all. Walk whichever layout this build has."""
        if hasattr(action, 'fcurves'):
            return list(action.fcurves)
        out = []
        for layer in getattr(action, 'layers', []):
            for strip in getattr(layer, 'strips', []):
                for cb in getattr(strip, 'channelbags', []):
                    out.extend(cb.fcurves)
        return out

    if rig.animation_data and rig.animation_data.action:
        for fc in action_fcurves(rig.animation_data.action):
            for kp in fc.keyframe_points:
                # auto-clamped handles flatten the peaks of a sine, which reads
                # as a stutter at the end of each swing
                kp.interpolation = 'BEZIER'
                kp.handle_left_type = kp.handle_right_type = 'AUTO'
            fc.update()


# ---- pot, soil, bench ------------------------------------------------------
# These take Object coordinates, and the pot is about 0.11 units across — so a
# "scale" of 22 was barely two cycles over the whole pot, i.e. no texture at
# all. Everything here has to be an order of magnitude higher than it looks.
M_POT = noisy("terracotta", (0.165, 0.052, 0.026), (0.290, 0.108, 0.055),
              scale=340.0, rough=0.82, bump=0.55, detail=10.0)
M_SOIL = noisy("soil", (0.008, 0.006, 0.005), (0.034, 0.024, 0.017),
               scale=900.0, rough=0.97, bump=1.0, detail=12.0)
M_BENCH = noisy("bench", (0.085, 0.055, 0.034), (0.170, 0.108, 0.064),
                scale=6.0, rough=0.62, bump=0.28, detail=8.0)

bpy.ops.mesh.primitive_cone_add(vertices=72, radius1=0.041, radius2=0.056,
                                depth=0.066, location=(0, 0, 0.033))
pot = bpy.context.active_object
pot.name = "pot"

# A cone primitive arrives capped at both ends, and the crown sits 4 mm below
# the top cap — so the pot was a sealed vessel with a terracotta lid, every leaf
# had to pass through that lid to get out of it, and the soil underneath could
# never be seen at all. Take the lid off and leave the base on: Solidify below
# is what gives the wall its thickness, so an open mouth is still a solid pot.
_bm = bmesh.new()
_bm.from_mesh(pot.data)
_lid = [f for f in _bm.faces
        if len(f.verts) > 4 and f.calc_center_median().z > 0.0]
bmesh.ops.delete(_bm, geom=_lid, context='FACES')
_bm.to_mesh(pot.data)
_bm.free()

pot.data.materials.append(M_POT)
for p in pot.data.polygons:
    p.use_smooth = True
pot.modifiers.new("solid", 'SOLIDIFY').thickness = 0.0035

bpy.ops.mesh.primitive_torus_add(major_radius=RIM_R, minor_radius=RIM_T,
                                 major_segments=72, minor_segments=10,
                                 location=(0, 0, POT_TOP))
rim = bpy.context.active_object; rim.name = "rim"
rim.data.materials.append(M_POT)
for p in rim.data.polygons:
    p.use_smooth = True

bpy.ops.mesh.primitive_cylinder_add(vertices=72, radius=0.0535, depth=0.004,
                                    location=(0, 0, 0.0585))
soil = bpy.context.active_object; soil.name = "soil"
soil.data.materials.append(M_SOIL)
sd = soil.modifiers.new("bump", 'SUBSURF'); sd.levels = sd.render_levels = 2

bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, 0))
bench = bpy.context.active_object; bench.name = "bench"
bench.data.materials.append(M_BENCH)


# ---- world -----------------------------------------------------------------
world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
wn, wl = world.node_tree.nodes, world.node_tree.links
bg = wn["Background"]
bg.inputs[1].default_value = float(P['env_str'])

hdri = str(P['hdri'])
has_env = bool(hdri and os.path.exists(hdri))
if has_env:
    env = wn.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(hdri)
    env.location = (-400, 0)
    mp = wn.new('ShaderNodeMapping'); mp.location = (-620, 0)
    mp.inputs['Rotation'].default_value = (0, 0, float(P['env_rot']))
    tc = wn.new('ShaderNodeTexCoord'); tc.location = (-820, 0)
    wl.new(tc.outputs['Generated'], mp.inputs['Vector'])
    wl.new(mp.outputs['Vector'], env.inputs['Vector'])
    wl.new(env.outputs['Color'], bg.inputs[0])
else:
    bg.inputs[0].default_value = (0.16, 0.19, 0.24, 1)


def aim(obj, at):
    d = Vector(at) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


# A window-shaped key, even when there is an HDRI. A studio probe is
# deliberately shadowless, and with no dominant direction the leaves have no
# form and the pot casts nothing onto the bench — which is most of why the
# first renders read as a clay model.
bpy.ops.object.light_add(type='AREA', location=(-0.36, -0.30, 0.44))
key = bpy.context.active_object
key.name = "key"
key.data.shape = 'RECTANGLE'
key.data.size, key.data.size_y = 0.55, 0.40
# low, deliberately: the HDRI is already carrying the exposure, and this light
# is here for direction and a cast shadow, not for brightness
key.data.energy = 7.0 if has_env else 22.0
aim(key, (0, 0, 0.070))

# and a soft bounce off the other side, so the shadow side is not dead
bpy.ops.object.light_add(type='AREA', location=(0.44, -0.10, 0.18))
fill = bpy.context.active_object
fill.name = "fill"
fill.data.size, fill.data.energy = 0.60, 1.8
aim(fill, (0, 0, 0.070))


# ---- camera: a close product shot, with the depth of field that implies ----
target = Vector((0, 0, 0.074))
_el = math.radians(float(P['cam_elev']))
_az = math.radians(float(P['cam_az']))
_dist = float(P['cam_dist'])
cam_loc = Vector((_dist * math.cos(_el) * math.sin(_az),
                  -_dist * math.cos(_el) * math.cos(_az),
                  _dist * math.sin(_el) + target.z))
bpy.ops.object.camera_add(location=cam_loc)
cam = bpy.context.active_object
cam.name = "cam"
d = target - cam_loc
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = float(P['lens'])
cam.data.dof.use_dof = True
# focus a little in front of centre, so the blooms and the near leaves carry
# the sharpness and the far side of the rosette falls away
cam.data.dof.focus_distance = d.length * 0.94
cam.data.dof.aperture_fstop = float(P['fstop'])
scene.camera = cam


# ---- render ----------------------------------------------------------------
scene.render.resolution_x = int(P['res_x'])
scene.render.resolution_y = int(P['res_y'])
scene.render.film_transparent = False
# One per try, because these are dynamic enums out of the OCIO config and a
# name that is not in it raises. 'AgX - Medium Contrast' is not in it — the
# ladder runs Medium Low, Base, Medium High — so this had been quietly setting
# nothing at all, and the look was whatever the last run happened to leave.
for _k, _v in (('view_transform', 'AgX'), ('look', 'AgX - Base Contrast')):
    try:
        setattr(scene.view_settings, _k, _v)
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
    scene.cycles.use_denoising = True
    try:
        scene.cycles.denoiser = 'OPTIX'
    except Exception:
        pass
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    # ribbons rather than thick curves: at 1.7 mm the difference is invisible
    # and there are a quarter of a million of them
    try:
        scene.cycles.curve_shape = 'RIBBONS'
    except Exception:
        pass
else:
    # 4.2 called it BLENDER_EEVEE_NEXT; 5.x folded it back into BLENDER_EEVEE
    _avail = scene.render.bl_rna.properties['engine'].enum_items.keys()
    scene.render.engine = ('BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in _avail
                           else 'BLENDER_EEVEE')
    try:
        scene.eevee.taa_render_samples = 64
    except Exception:
        pass

scene.frame_set(1)

def check_clipping(mesh, ranges):
    """Count intersecting face pairs between different leaves.

    Exact rather than a proxy — BVHTree.overlap does real triangle-triangle
    intersection. Run against the base mesh, before Solidify and Subdivision:
    those thicken what is already there, so a base mesh that is clean by a
    reasonable margin stays clean.
    """
    from mathutils.bvhtree import BVHTree
    co = [v.co for v in mesh.vertices]
    trees = []
    for (a, b) in ranges:
        trees.append(BVHTree.FromPolygons(
            co, [tuple(f.vertices) for f in mesh.polygons[a:b]],
            all_triangles=False, epsilon=0.0))
    hits = []
    for x in range(len(trees)):
        for y in range(x + 1, len(trees)):
            ov = trees[x].overlap(trees[y])
            if ov:
                hits.append([x, y, len(ov)])
    return hits


def check_pot_clipping(mesh, ranges, obstacles):
    """Count leaf faces that intersect the pot or its rim.

    `check_clipping` only ever compares leaves with each other, so a blade could
    pass clean through the rim and nothing here would say a word — which is
    exactly what it was doing. Same exact triangle test, aimed at the pot.

    The obstacles carry an object transform and the plant does not, so their
    vertices are lifted into world space before the trees are built.
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


_clip = check_clipping(me, LEAF_FACES)
_pot = check_pot_clipping(me, LEAF_FACES, [pot, rim])

# The same two questions asked of the plant as it will be SEEN, at both ends of
# the thirst range. The pair above run on the mesh this file built; wilt is a
# pose, so they cannot see it, and they read exactly the same on a collapsed
# plant as on a turgid one while the collapsed one had 22 leaf faces inside its
# own pot and 33 pairs of leaves through each other.
import importlib as _il, sys as _sys
_sys.path.insert(0, r"E:\Claude\Good-Vibe-Games\Good_Vibes\.claude\skills\plant-assets\scripts")
import mesh_checks as _mc
_il.reload(_mc)
_wilt = {}
for _d in (0.0, 1.0):
    _td = math.radians(float(P['flex_leaf_deg'])) * _d
    for _i in range(int(P['leaves'])):
        _k = 1.0 + 0.25 * math.sin(_i * 2.4)
        _lim = DROOP_LIMIT[_i] if _i < len(DROOP_LIMIT) else math.radians(180.0)
        if _td * _k > _lim:
            _k = _lim / _td if _td > 1e-9 else 0.0
        for _s in range(int(P['segs'])):
            _nm = f"L{_i}_{_s}"
            if _nm in rig.pose.bones:
                _sh = SHARE[_s] if _s < len(SHARE) else SHARE[-1]
                rig.pose.bones[_nm].rotation_euler.x = -_td * _sh * _k
    _sd = math.radians(float(P['flex_stalk_deg'])) * _d
    for _j in range(int(P['blooms'])):
        _kk = 1.0 + 0.18 * math.sin(_j * 1.7)
        for _s in range(3):
            _nm = f"B{_j}_{_s}"
            if _nm in rig.pose.bones:
                _sh = STALK_SHARE[_s] if _s < len(STALK_SHARE) else STALK_SHARE[-1]
                rig.pose.bones[_nm].rotation_euler.x = -_sd * _sh * _kk
    _dm, _was = _mc.deformed(plant)
    _wilt['leaf_pairs_at_droop_%g' % _d] = len(_mc.self_intersections(_dm, LEAF_FACES))
    _wilt['leaves_in_pot_at_droop_%g' % _d] = len(
        _mc.intersections_with(_dm, LEAF_FACES, [pot, rim]))
    _mc.restore(_was)

result = {
    'leaf_pairs_intersecting': len(_clip),
    'clip_detail': _clip[:8],
    'leaves_in_pot': len(_pot),
    'pot_detail': _pot[:8],
    **_wilt,
    'verts': len(me.vertices),
    'polys': len(me.polygons),
    'bones': len(rig.pose.bones),
    'engine': scene.render.engine,
    'device': getattr(scene.cycles, 'device', None),
    'frames': [scene.frame_start, scene.frame_end],
    'hdri': hdri if (hdri and os.path.exists(hdri)) else 'none (area light)',
}
print("violet built:", result)
