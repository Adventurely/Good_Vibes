# One simulation, three species

> How the three specifications reconcile into a single state and visual
> parameter vocabulary. This is the data model the game is built on.

# ONE PLANT MODEL — shared vocabulary for violet / daylily / daffodil

## 0. The architectural contract

**A species may supply only: coefficients, response-curve shapes, enum selections, a phenology graph, a primordium/reserve timing table, and a blendshape stack. A species may never add a state variable, a visual parameter, or a code branch.** Everything below is sized to make that true. Where it can't be true, it's in §6.

Three unifications carry most of the weight:

1. **`necrosis_origin` (enum) + `necrosis_front` (scalar)** replaces every "yellowing" special case. Drought is TIP or MARGIN; rot is BASE; freeze is WHOLE; cold-water ring spot is POINT_LOCAL. All three specs independently insist that collapsing these into one generic yellowing destroys the game — the enum is the fix, and it's four bytes.
2. **`lesion_field {density, size_mm, hue, arrangement}`** where `arrangement ∈ {SCATTERED, VEIN_ALIGNED, MIDRIB_LINE, CONTACT_LINE, DROPLET_RING, COLONY_DISC}`. That one bank is rust pustules, leaf streak, ring spot, salt-rim band, powdery mildew, and thrips stipple. The arrangement enum *is* the diagnosis.
3. **`flex_localization` (0 = distributed catenary, 1 = single sharp node)**. Violet petiole sag = 0.0; daylily cantilever = 0.2; daffodil crease = 1.0; daffodil gooseneck = 1.0 on the scape; daylily scape lodging = 0.6. One wilt rig, no exceptions. Every spec warns against "uniform bend along the whole length" — this parameter is the thing that prevents it.

---

## 1. STATE — the simulation's truth

### 1a. Environment (world, sampled at specimen position — inputs, not specimen state)

| Var | Range | Notes |
|---|---|---|
| `dli` | 0–30 mol/m²/d | rolling daily integral |
| `peak_illuminance` | 0–120 000 lux | drives LIGHT_EXCESS separately from DLI |
| `photoperiod_h` | 0–24 | read only by species with a photoperiod gate (none of these three — keep it, it's free) |
| `air_temp_C` | −40 … +45 | |
| `substrate_temp_C` | −40 … +40 | **separate from air.** Chill is measured here; cold-soil rot acceleration reads here |
| `vpd_kPa` | 0–6 | *derived* from RH+temp. **RH is never read directly** (see §6.2) |
| `foliar_wetness_h` | 0–72 | hours of free water on tissue. Feeds all foliar disease |
| `air_movement` | 0–1 | mitigates disease independent of humidity |
| `substrate_water` | 0–1 | normalized VWC |
| `drainage` | 0–1 | multiplier on how fast water leaves; rot risk = f(water × warmth × (1−drainage)) |
| `substrate_ec` | 0–3 dS/m | |
| `substrate_pH` | 4.0–9.0 | drives interveinal chlorosis only |
| `applied_water_temp_C` | 0–40 | player-visible. Only violet has a low threshold, but the variable is universal |
| `hygiene` | 0–1 | litter, crowding, debris. Feeds fungal pressure |
| `container` | null or `{vol_L, depth_cm, rim_material}` | null = in ground: high thermal + water buffering, natural leaching |
| `planting_depth_cm` | 0–25 | |

### 1b. Physiology (per specimen, persistent)

| Var | Range | Notes |
|---|---|---|
| `hydration` | 0–1 | fast pool, hours |
| `water_stress` | 0–1 | integrated deficit; splits into two outputs (§3) |
| **`reserve`** | 0–1 | **the ledger. Never reset at a season boundary.** |
| `chill_units` | 0–2000 h | hours in (0 °C, 9 °C] at `substrate_temp_C` |
| `thermal_time` | 0–5000 °C·d | phenology advance |
| `nutrition` | 0–1 | adequacy |
| `nitrogen_excess` | 0–1 | separate axis — excess N is a decline mode in all three |
| `salinity_load` | 0–1 | ∫EC·dt since last leach |
| `light_deficit` | 0–1 | rolling 14-day DLI shortfall → etiolation |
| `radiant_overload` | 0–1 | rolling excess over `bleach_threshold_lux` |
| `cold_injury` / `heat_injury` | 0–1 each | accumulated, non-decaying |
| `root_mass` | 0–1 | + `root_regenerable: bool` (daffodil = false after autumn) |
| **`crown_integrity`** | 0–1 | **the only mortality variable in the game.** Leaf damage never kills anything |
| `pathogen_load{}` | 0–1 each | `{soft_rot, foliar_fungal, mildew, botrytis}` |
| `pest_load{}` | 0–1 each | `{meristem_borer, sap_feeder, browser}` |
| `groom_debt` | 0–1 | unremoved spent flowers / dead leaves / unripe capsules |
| `age_cycles` / `age_days` | int / float | |
| `phase` + `phase_t` | enum from species graph, 0–1 | |
| `shoot_units[]` | array | see 1c |
| `primordia[]` | queue | see 1d |

### 1c. Shoot unit (the module that unifies rosette / fan / nose)

Violet = 1 unit (+ suckers). Daylily = 1–30 fans. Daffodil = 1–12 noses. **Suckers, offset fans, and bulb offsets are the same object**, which is why overcrowding is one decline mode, not three.

`{ rank, age_cycles, vigour 0–1, azimuth_deg, tilt_deg 0–25, origin_offset_cm, depth_offset_cm, emergence_lag_days 0–5, integrity 0–1 }`

`carrying_capacity` is a species coefficient; `Σvigour` falls as `unit_count / capacity` rises. That single relation produces violet suckering (bloom −40 %/sucker), daylily undivided-clump decline, and daffodil congestion blindness.

### 1d. Organ instances

**Leaf:** `{ rank (0 = newest), age_days, turgor 0–1, chlorophyll 0–1, carotenoid_unmask 0–1, size_latched_cm (never shrinks), damage_mask RGBA, necrosis_front 0–1, necrosis_origin enum, attached bool }`

**Inflorescence axis:** `{ length_cm, thickness_cm, integrity 0–1, flex_node_pos, flex_node_deg, slots[] }`

**Flower slot:** `{ bloom_phase 0–1, viability 0–1, open_hours, substance 0–1, pigment_wash 0–1, blemish_mask }`

### 1e. Primordium (the delayed-consequence object — see §5)

`{ kind, commit_phase, release_phase, lag_days, vigour 0–1, viability 0–1 }`

---

## 2. VISUAL PARAMETERS — what Blender binds to

Tagged: **[INST]** instancing/count, **[XF]** transform/rig driver, **[SK]** shape key, **[MAT]** material input.

**Architecture (latched at expansion; never animated backwards)**
- `unit_count` **[INST]** 1–30
- `unit_azimuth / tilt / scale / depth_offset` **[XF]** per unit
- `organ_count` **[INST]** 2–45
- `organ_length_cm` **[XF]** 1.5–90 · `organ_width_cm` **[XF]** 0.2–6.5
- `rank_length_gradient` **[XF]** 0.6–1.5 (outer:inner)
- `phyllotaxy_mode` enum `{SPIRAL_137, DISTICHOUS_180}` + `jitter_deg` 0–8 **[XF]**
- `internode_cm` **[XF]** 0.3–1.0
- `meristem_exposure_cm` **[XF]** 0–6 — violet neck, daffodil bulb neck, daylily 0
- `support_stalk_count / height_cm / thickness_cm` **[INST][XF]**

**Posture — the wilt rig (six drivers, all three species)**
- `section_collapse` 0–1 **[SK]** — keel closing / petiole hydrostat softening. **Fires before any bend.**
- `flex_onset` 0–1 **[XF]** — fraction along organ where bending starts; migrates toward base as turgor drops
- `flex_magnitude_deg` 0–140 **[XF]**
- `flex_localization` 0–1 **[XF]** — catenary ↔ discrete crease
- `elevation_deg` −50 … +90 **[XF]** — base carriage angle
- `tip_declination_deg` −20 … +120 **[XF]**
- `axial_twist_deg` 0–90 **[SK]**
- `margin_curl_deg` −40 … +40 **[SK]** (− down-roll, + cup-up)
- `blade_flatten` 0–1 **[SK]** — senescent thinning

**Surface**
- `chlorophyll` 0–1 **[MAT]** → albedo ramp
- `carotenoid_unmask` 0–1 **[MAT]** → the buttery-gold path. **Must be a separate channel from necrosis**, or senescence renders as a health bar
- `bleach` 0–1 **[MAT]**
- `necrosis_front` 0–1 + `necrosis_origin` enum + `boundary_roughness` 0.3–0.8 + `transition_band_cm` 0.5–4 **[MAT]**
- `damage_mask_RGBA` **[MAT]** 512² per organ, write-only, never cleared
- `lesion_field {density, size_mm, hue, arrangement}` **[MAT]**
- `grazing_scatter` 0–1 **[MAT]** — one term for violet trichome retro-reflection *and* daffodil glaucous wax. Both brighten/pale at grazing angles and kill specular
- `hydrophobicity` 0–1 **[MAT]** — droplet beading. Violet 0.95, daffodil 0.9, daylily 0.4. Drives the same bead-geometry shader
- `gloss` 0–1, `anthocyanin` 0–1 **[MAT]**
- `surface_rub` 0–1 **[MAT]** — wax/bloom removed by handling (daffodil streaks, violet collapsed trichomes over dead cells)

**Reproductive**
- `flower_open_t` 0–1 **[SK]** → drives the per-species blendshape stack
- `flower_size_scalar` 0.4–1.2 **[XF]**, `reflex_deg` −10…+90 **[SK]**, `ruffle_amp_cm` 0–1.5 **[SK]**
- `substance` 0–1 **[SK][MAT]** — thickness/limpness/translucency together
- `pigment_wash` 0–1 **[MAT]** — heat/light fade
- `spent_t` 0–1 **[SK]** → species deformer: violet = abscise, daylily = twist 180–540° + shrink to 0.2–0.4, daffodil = limp brown skirt
- `axis_flex_node_pos / _deg` **[XF]** — gooseneck, lodging, scape flop: one rig

**Substrate / context**
- `substrate_wetness_visual` 0–1 **[MAT]** — pale/shrunk/pulled-from-wall ↔ dark/glossy/algal. **This carries half the diagnostic load** and must not be slaved to `substrate_water` alone (it lags)
- `surface_deposit {amount, type ∈ SALT|MYCELIUM|SCLEROTIA|ALGAE}` **[MAT]**
- `litter_count` **[INST]**, `substrate_heave` 0–1 **[SK]**
- `specimen_bounds_cm` **[XF]** — drives camera framing (see §6.3)

---

## 3. STATE → VISUAL, and where the species actually differ

The species profile is a flat coefficient table. Illustrative rows:

| Coefficient | Violet | Daylily | Daffodil |
|---|---|---|---|
| `flex_localization` | 0.0 | 0.2 | 1.0 |
| `wilt_order` | rank descending (outer first) | rank descending | rank descending |
| `rot_order` | **rank ascending (crown first)** | **rank ascending** | **rank ascending** |
| `drought_necrosis_origin` | MARGIN | TIP | TIP |
| `water_stress → turgor` weight | 1.0 | **0.25** | 0.8 |
| `water_stress → primordium.viability` weight | 0.3 | **0.95 (SCAPE phase only)** | 0.4 |
| `vpd_sensitivity` | 0.9 | 0.1 | **0.0** |
| `foliar_wetness → disease` | 0.7 (botrytis/mildew) | 0.9 (rust/streak) | 0.2 |
| `bleach_threshold_lux` | 25 000 | 90 000 (pale cvs 60 000) | 80 000 |
| `etiolation_dli_floor` | 4 | 10 | 6 |
| `petiole_stretch_multiplier` (low light) | 1.5–2.5× | 1.3× | 1.4× |
| `chill_requirement_h` | **0** | 0 or 900 (dormant cv) | 1200 |
| `flower_senescence_mode` | RATE_INTEGRATED | **SCHEDULED** | RATE_INTEGRATED |
| `flower_lifespan_h` | 400 | **24** | 340 |
| `senescence_Q10` | 2.0 | **1.0 (ignored)** | 2.4 |
| `brittleness` (snap on contact) | **1.0** | 0.15 | 0.2 |
| `pollination_probability` | **0.0** | 0.6 | 0.5 |
| `browser_susceptibility` | 0.0 | **0.9** | **0.0** (lycorine) |
| `carrying_capacity` (shoot units) | 1 | 12 | 4 |
| `phenology_rate_mult` | 6.0 | 1.0 | 9.0 (spring) |
| `damage_rate_mult` | 1.0 | 1.0 | 1.0 |
| `repair_rate_mult` | 0.15 | 0.4 | 0.2 |
| `cycle_length_weeks` | 1 | 1 | **4** |

The only structural per-species assets are (a) the phenology graph, (b) the flower blendshape stack, (c) the spent-flower deformer. Everything else above is numbers.

**Genuinely different behaviour that falls out of numbers, not branches:**
- Daylily drought blasts buds while leaves look fine — because `water_stress→primordium` is 0.95 and `→turgor` is 0.25, gated to the SCAPE phase.
- Daffodil wilts by collapsing the keel *then* creasing — `section_collapse` fires at turgor 0.8, `flex_localization` = 1.0.
- Violet ring spot is a cold-shock lesion — `applied_water_temp_C` delta > 8 °C AND `hydrophobicity` > 0.8 (droplets persist) → `lesion_field.arrangement = DROPLET_RING`, permanent write to `damage_mask.R`. Daffodil has the same code path and never triggers it, because its threshold delta is 25 °C.

---

## 4. Shared vs species-specific declines

**All 36 decline entries across the three specs reduce to 11 archetypes.** None needs a species-specific code path.

| # | Archetype | Violet | Daylily | Daffodil |
|---|---|---|---|---|
| 1 | WATER_DEFICIT | drought droop; low-humidity bud blast | bud blast; sustained drought | growth drought; recharge drought |
| 2 | WATER_EXCESS → ROT **(the only death path in all three)** | crown rot | bacterial/southern blight | Fusarium basal rot; summer-wet |
| 3 | LIGHT_DEFICIT | etiolation, bloom stop | etiolation, scape collapse | etiolation, lodging |
| 4 | LIGHT_EXCESS | bleach + cup-over | dark-cv melt / pale-cv bleach | warm-flower bleach |
| 5 | THERMAL_INJURY (signed) | cold draft; **cold-water ring spot**; heat bud abort | freeze; >35 °C melt | freeze; >21 °C fast fade |
| 6 | NUTRIENT_IMBALANCE | salt rim burn, centre stunt | excess N flop | excess N, blindness |
| 7 | BIOTIC_SURFACE | mildew, botrytis, thrips | rust, leaf streak, thrips | — |
| 8 | BIOTIC_MERISTEM | cyclamen mite (`response: KNOT`) | gall midge (bud-local) | bulb fly (`response: PROLIFERATE`) |
| 9 | CONGESTION | suckering | undivided clump | offset congestion |
| 10 | MECHANICAL | snapped petioles | deer browsing | cut foliage, broken roots |
| 11 | TIMING_DEFICIT | (weak: grooming → next flush) | (weak: seed set → rebloom) | chill shortfall, ethylene abort, recharge shortfall |

Notes on the two that look species-specific but aren't:
- **Ring spot is not a new mode.** The spec says explicitly it's chilling injury to palisade cells. It's archetype 5 with a `POINT_LOCAL` geometry and a very low threshold. The reason only violet shows it is `hydrophobicity` × threshold, both numbers.
- **Cyclamen mite and bulb fly are the same archetype.** Both destroy the growing point. `meristem_damage` 0–1 with `response ∈ {KNOT, PROLIFERATE}` gives violet's clenched grey fist and daffodil's grassiness from one parameter.

Species-specific-*flavoured* but shared-mechanism: the `surface_deposit.type` enum (salt / algae / sclerotia / pink mycelium) is pure art data.

---

## 5. The daffodil's delayed consequence, without a special case

Two generic mechanisms. Neither mentions daffodil.

**(a) `reserve` is an integrator with a species-declared source window and sink event.**

```
d(reserve)/dt = k_gain · Σ_leaves(green_area · chlorophyll · turgor)
                       · light_efficiency(dli) · water_efficiency(hydration)
                       · phase_weight[phase]
              − k_drain · (groom_debt + seed_set_load + Σ units.vigour_demand)
```

Cutting the foliage early sets `green_area → 0`. The integrand goes to zero. No rule about cutting exists anywhere in the code — it falls out of "reserve integrates green leaf area." Two-weeks-post-flower being twice as damaging as four-weeks is automatic: it's a longer missing slice of the integral, continuous, not a flag.

`phase_weight` is where the species differ: daffodil sets RECHARGE = 1.0 and everything else ≈ 0.2; daylily sets SUMMER_PLATEAU = 1.0; violet sets every phase to 1.0 (continuous source, continuous sink → the lag collapses to days and is invisible, which is correct for violet).

**(b) `primordia[]` — organs committed early, released late, viability mutable in between.**

```
primordium { kind, commit_phase, release_phase, lag_days, vigour, viability }
```

- Violet peduncle: lag 12 d. Grooming and DLI during the window set `vigour`.
- Daylily bud: lag 18 d. Drought during SCAPE writes `viability → 0` (bud blast); gall midge writes it too.
- Daffodil flower: lag 250 d. Ethylene writes `viability → 0` during dormancy.

Then one shared gate function, used by all three:

```
expressed_size = base · sigmoid(chill_units) · g(reserve) · primordium.viability · unit.vigour
```

Violet's chill sigmoid is a constant 1. Daffodil's floors at 400 units and saturates at 1400, which is exactly what produces the *graded* short-scape failure the spec demands — flower opening down inside the leaf fan — rather than a binary blind/not-blind. Ethylene damage and chill deficit stay visually distinguishable for free: ethylene kills `viability` (full-height scape, dead bud), chill kills the sigmoid (short scape, live bud). Same equation, different term.

**Legibility (the spec's own hardest problem, and it generalizes):** add one shared verb, `probe(specimen)`, returning storage-organ firmness, mass-vs-size, and a coarse reserve hint. Lift a bulb, heft a violet pot, squeeze a daylily crown. And surface `chill_units` as an environmental cue (frost on the rim), never as a number.

---

## 6. Conflicts — what genuinely cannot be unified, and my ruling

**6.1 Time compression is irreconcilable, and it is the biggest one.** Violet wants bloom at 6× and damage at 1×. Daylily wants bloom at exactly 1:1 and everything else compressed. Daffodil needs four weeks per cycle. *Ruling:* one real clock; per-species **rate multipliers on named process channels** (`phenology`, `vegetative`, `damage`, `repair`, `reserve`), never on time itself. Damage = 1.0 for all three (every spec says so independently); repair < damage always, which preserves the fast-harm/slow-healing asymmetry all three specs call the truest thing about their species. **But:** the residual is real and unfixable by data — a violet flower will last 2.5 game days and a daylily flower 1 game day, silently implying they're comparable when they differ 20× in reality. I would surface the ratio in the codex ("1 game day ≈ 6 real days for this plant") rather than hide it.

**6.2 Humidity.** Violet: below 35 % RH → bud blast. Daylily: humidity matters only via disease. Daffodil: "if your engine has a humidity axis, this plant should ignore it." *Ruling:* **delete the humidity→plant path entirely.** RH is an input to two derived quantities only — `vpd_kPa` (feeds WATER_DEFICIT) and `foliar_wetness_h` (feeds BIOTIC_SURFACE). Then violet is a high `vpd_sensitivity`, daylily is a high `foliar_wetness→disease`, daffodil is two zeros. All three specs become true simultaneously.

**6.3 Scale.** Violet 26 cm in a 9 cm pot; daylily clump 60–120 cm; daffodil 45 cm. The violet spec warns it photographs identically to a cabbage without a size cue. *Ruling:* `specimen_bounds_cm` is a first-class parameter and the camera rig frames from it; a scale-reference prop is mandatory in the specimen view, not optional set dressing.

**6.4 Indoor container vs outdoor ground.** Violet is pot-only (rim salt burn needs a geometrically real rim); daylily is ground-only (deer, division, soil-line sclerotia); daffodil is both. *Ruling:* `container` is nullable. Null = high thermal buffering, high water buffering, natural leaching, browser events enabled. Rim-contact salt burn requires `container.rim_material` and leaf–rim collision; it simply never fires in the ground. No branch.

**6.5 Spent-flower semantics directly conflict.** Daylily: spent blooms must **never** be scored as damage or the plant is permanently, wrongly sick. Violet: petals left on leaves invite Botrytis. Daffodil: deadhead the ovary but leave the green scape standing. *Ruling:* `spent_t` is a lifecycle state and **never an input to any health term.** Litter feeds `hygiene`, which feeds fungal pressure; and `groom_debt` drains `reserve`. Both are indirect and both are per-species coefficients. Daylily sets the fungal coefficient near zero and the reserve drain to seed-set only, which is exactly what its spec asks for.

**6.6 Dormancy.** Violet: "do not build a dormant phase" — flat prohibition. Daylily: cultivar-class dependent (three classes). Daffodil: four months mandatory, and the emptiness *is* the species. *Ruling:* phenology is a per-species **graph**, not a shared enum. Violet's graph has no DORMANT node; it can't be reached, so nothing special-cases it. The conflict that survives is UI: a shared "season" frame implies all three are in the same part of a cycle. Fix with `cycle_length_weeks` (1/1/4) and let the daffodil visibly occupy four of the game's weeks. Do not compress its dormancy to make it fit — its spec is explicit that this deletes the mechanic.

**6.7 Daylily's inverted drought response breaks a naive `turgor`.** If water stress has one output, modelling daylily drought as leaf-wilt-first is backwards for the species. *Ruling:* `water_stress` has two weighted outputs (tissue vs reproductive) and a phase gate. Two floats in the profile.

**6.8 Root regeneration.** Daffodil roots grow once per year and never regenerate; violet and daylily regrow roots continuously. *Ruling:* `root_regenerable: bool` plus a phase gate on the regrowth term. A daffodil whose roots are broken in January is crippled for the season and no amount of watering fixes it — that's the boolean doing its job, and it's the same field the other two set to true.

**6.9 Violet leaves snap; the others bend.** *Ruling:* `brittleness` coefficient on a contact event → permanent organ detachment + a `meristem_exposure_cm` increment. Violet 1.0, others ~0.15. The scar-accumulation path is shared and is what makes `meristem_exposure_cm` the honest long-term care record for violet and daffodil alike.

**What I'd cut:** `photoperiod_h` and `substrate_pH` earn their place only marginally (none of the three is photoperiodic; only violet has a pH lockout). Keep them — they're two floats and they're the cheapest insurance against species four being photoperiodic.
