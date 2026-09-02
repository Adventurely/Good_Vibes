# Knowing it is right

Two hard-won facts shape everything here. First, the failures that survive
longest are the ones that look fine where you authored them. Second, you will
regularly be unable to take a screenshot of the thing you actually shipped — the
browser pane goes down, the render lies about exposure, or you are three
abstraction layers from the pixel. So the checks have to be numbers.

## Contents

1. [Do not judge colour from the authoring render](#1-do-not-judge-colour-from-the-authoring-render)
2. [The checks that belong in every build](#2-the-checks-that-belong-in-every-build)
3. [Isolation testing: prove which term it is](#3-isolation-testing-prove-which-term-it-is)
4. [Inspecting what actually shipped](#4-inspecting-what-actually-shipped)
5. [Measuring in the browser without a screenshot](#5-measuring-in-the-browser-without-a-screenshot)
6. [Verifying the deploy](#6-verifying-the-deploy)

---

## 1. Do not judge colour from the authoring render

This has cost two rounds on two different materials for the same reason. The
authoring scene is lit by one hot area light under AgX. Under it the anthers
rendered as smooth cream beads and the petioles as salmon pink — and both times
the map underneath was exactly what had been asked for: the anthers mean linear
`(0.53, 0.41, 0.09)`, a saturated gold; the petioles `(0.060, 0.018, 0.014)`, a
dusky maroon. The render was blowing them out. Nothing was wrong.

Read the array, not the picture:

```python
img = bpy.data.images['web_stem_albedo']
px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
[round(float(px[row, :, i].mean()), 4) for i in range(3)]   # row 0 is v = 0
```

If the numbers are the colour you authored, the render is lying and the fix is
`scene.view_settings.exposure`, not the texture. A diagnostic render at
−0.6 EV tells you far more than one at the default.

## 2. The checks that belong in every build

Put these in the exporter's `result` dict. A screenshot proves one camera angle
at one moment; a number in the build report is checked forever.

| Check | Meaning | Want |
|---|---|---|
| `boundary_edges_by_slot` | open holes, per material | `{}` |
| `clipping_pairs` | organ-vs-organ intersections, **one entry per organ type**, split by whether the overlap is by design | `0` |
| `leaves_in_pot` | organ-vs-prop intersections | `0` |
| `materials` | that the slots hold the *web* materials | no Cycles names |
| `unsupported_export_options` | options this Blender build dropped | `[]` |
| `bytes`, `verts`, `fuzz_tris` | budget, so a regression is visible | trend |

**Scope each check to what you mean.** When the petioles started converging in
the compost, a clipping check that spanned the whole leaf went from 0 to 102
"intersections" — all of them by design, because eighteen stalks meeting in one
place overlap on purpose. It reads blade faces only now. A check that cries wolf
is worse than no check, because the next real one gets ignored.

**Every organ type that can overlap needs its own entry, and a new organ ships
with a new check or it ships unmeasured.** The daylily inherited the violet's
blade checks and had none at all for its corolla — so it shipped with every
adjacent pair of tepals in every flower intersecting at the throat, every spent
flower a knot of 2721 face-pairs, and two open blooms inside one another on one
branch. Three separate faults, none of them visible in the build report,
because the report only ever asked about leaves. The fix was one afternoon; the
reason it was needed for a month is that nothing counted.

Split a clipping number by what the two halves *mean*, or it cannot be read:

| Split | Fault, or by design? |
|---|---|
| blades, same fan vs different fans | same fan is a fault — they share a plane and should nest. Different fans is what a clump does |
| tepals, by angular distance around the flower | six tepals sit 60° apart, so index distance *is* angular distance. Neighbours crossing means the throat is over-subscribed; anything further apart crossing means a tepal has swept most of the way round |
| tepals, same flower vs different flowers | within a flower is a corolla fault; between flowers is a *placement* fault on the scape, and it is fixed somewhere else entirely |

`mesh_checks.between(mesh, ranges_a, ranges_b)` is for the cross-group
questions — corolla against foliage — because asking `self_intersections`
means re-deriving both within-group answers and filtering them back out, and
those have different right answers.

`scripts/mesh_checks.py` in this skill has all of them ready to import.

## 3. Isolation testing: prove which term it is

When something looks wrong and you have a hypothesis, do not tune — **zero
things out one at a time and see what changes.** In the viewer, live:

```js
// is the pale wash specular, or is it in the albedo?
const m = window.gt.scene.getObjectByName('violet_3').material;
m.sheen = 0; m.specularIntensity = 0; m.envMapIntensity = 0;
m.needsUpdate = true;
window.gt.renderer.render(window.gt.scene, window.gt.camera);
```

If the artefact survives all three, it is not lighting. Swap `map` for a flat
colour next; if it survives that too, it is geometry. Three cheap steps beat
three rounds of guessing, and this is exactly how the pale star on the corolla
was finally traced to the albedo after sheen, specular and the environment map
had each been "fixed" in turn.

Dev mode exposes `window.gt = { THREE, scene, camera, renderer, controls,
applyTime, house, out }` for precisely this.

## 4. Inspecting what actually shipped

Parse the GLB. Do not trust what you think you exported:

```python
import json, struct
b = open(path, 'rb').read()
off = 12
while off < len(b):
    ln, ty = struct.unpack_from('<I4s', b, off)
    if ty == b'JSON':
        j = json.loads(b[off + 8:off + 8 + ln].decode('utf-8')); break
    off += 8 + ln

for m in j['materials']:
    print(json.dumps(m))
for i, im in enumerate(j.get('images', [])):
    print(i, im.get('name'), im.get('mimeType'),
          j['bufferViews'][im['bufferView']]['byteLength'])
```

That is how `sheenColorFactor: [1, 1, 1]` was found after two rounds of guessing,
and how the image/geometry byte split gets measured before anyone optimises the
wrong one.

## 5. Measuring in the browser without a screenshot

JavaScript still runs when the pane cannot composite. You can get numbers even
when you cannot get a picture:

```js
// geometry: is the shell above the surface, or below it?
const bb = o => { o.geometry.computeBoundingBox();
  const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
  return [+b.min.y.toFixed(5), +b.max.y.toFixed(5)]; };

// lighting: what is actually reaching the plant?
scene.traverse(o => { if (o.isLight) {
  const w = new THREE.Vector3(); o.getWorldPosition(w);
  console.log(o.type, o.intensity, w.distanceTo(P),
              o.isPointLight ? o.intensity / w.distanceTo(P) ** 2 : null);
}});
```

That second one settled "the plant is black at night" without a single pixel: two
lamps at 2.16 m delivering ~1.2 each, roughly half surviving the angle onto an
up-facing leaf, against a leaf albedo of 0.03 — while the pale stone pedestal
under it read as properly lit. Nothing was broken; the light was in the wrong
place, and the fix was a third lamp over the pedestal rather than a brighter
room.

If the canvas has a non-zero size but frames are not compositing, `gl.readPixels`
after an explicit `renderer.render()` still returns real pixel data, so
region-mean luminance is available as a last resort.

## 6. Verifying the deploy

Push to `main` **is** the deploy, so verify what actually landed rather than what
you built. The GitHub Pages mirror is reachable from the Browser tools where the
Cloudflare domain is not, and serves the same `public/` verbatim:

```js
const r = await fetch('./violet.glb', {cache: 'reload'});
const b = await r.arrayBuffer();
const h = await crypto.subtle.digest('SHA-256', b);
```

Compare that against a local hash. Byte-identical is the only answer that means
anything — file size alone is not enough, because a change to six float values
leaves the size untouched.

Read failures rather than inferring them:

```bash
gh run view <id> --repo Adventurely/Good_Vibes --log-failed
gh run rerun <id> --repo Adventurely/Good_Vibes
```

A deploy that fails in about a second with no steps at all was rejected before
the job started — that is the `github-pages` environment's branch allowlist, not
anything in the workflow file.
