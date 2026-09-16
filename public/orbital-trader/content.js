/* Orbital Trader: the world as data.
 *
 * Everything the rules read comes through here: the bodies and their rails,
 * the goods, the ports and what they want, the upgrades, the formulas, and
 * every line of text. The bulk of it is generated from the design tables in
 * tools/orbital-trader/design/ (see data/); this file is the glue that turns
 * those tables into the shape sim.js and the pages expect, and the place for
 * the few things that are code rather than numbers: colours, the belt's
 * rocks, the species table.
 *
 * It must stay declarative and browser-safe. It is imported by the tests
 * under Node and by the pages in a browser, and a throw at its top level
 * breaks both.
 */

import { TUNING } from './data/world.js';
import { ECONOMY } from './data/economy.js';
import { NARRATIVE } from './data/text.js';
import { QUESTBOOK } from './data/quests.js';
import { DIALOGUE } from './data/dialog.js';

/* ------------------------------------------------------------ constants */

const C = TUNING.constants;
export const CONST = {
  MU_LAMP: C.MU_LAMP,
  YEAR_DAYS: C.YEAR_DAYS,
  KMS_PER_AU_DAY: C.KMS_PER_AU_DAY,
  BASE_RATE_DAYS_PER_SEC: C.BASE_RATE_DAYS_PER_SEC,
  SKIP_SECONDS: C.SKIP_SECONDS,
  MAX_WARP: C.MAX_WARP,
  START_PORT: 'tassel',
  START_MONEY: ECONOMY.startingMoney,
  CURRENCY: ECONOMY.currencyName,
  BELT: { inner: TUNING.belt.inner, outer: TUNING.belt.outer },
};

/* -------------------------------------------------------------- species */

export const SPECIES = {
  emberkin: { name: 'Emberkin', plural: 'The Emberkin', adjective: 'Emberkin', colour: '#ff8c42', animal: 'salamanders' },
  otter:    { name: 'Otters',   plural: 'The otters',   adjective: 'otter',    colour: '#6cc24a', animal: 'otters' },
  cat:      { name: 'Cats',     plural: 'The cats',     adjective: 'cat',      colour: '#e9dcc0', animal: 'cats' },
  frog:     { name: 'Frogs',    plural: 'The frogs',    adjective: 'frog',     colour: '#5fb9e6', animal: 'frogs' },
  builders: { name: 'The Builders', plural: 'The Builders', adjective: 'Builder', colour: '#b48cff', animal: 'nobody knows' },
  mixed:    { name: 'All four peoples', plural: 'Everyone', adjective: 'bazaar', colour: '#ffd23f', animal: 'everyone' },
  none:     { name: 'Nobody', plural: 'Nobody', adjective: '', colour: '#9a948a', animal: 'nobody at all' },
};

/* Colours for the chart, by body. Peoples' worlds take their people's hue;
 * the rest are what they are: a violet giant, a glass-snow world, a lamp. */
const BODY_COLOURS = {
  lamp: '#ffd23f', cinder: '#e8683c', scorch: '#b58a5a', veyra: '#f2a65a',
  tassel: '#3fa9dd', slate: '#cfc2a8', moss: '#6cc24a',
  nail: '#e9dcc0', whisker: '#8b8b9e', arc: '#d9c9a3',
  grumm: '#8b6bd6', brine: '#a8c48c', glass: '#cfe8ff', croak: '#9a8fa6',
  haven: '#7fd0c8', maw: '#ffffff',
};

/* --------------------------------------------------------------- bodies */

const normaliseSpecies = s => {
  if(s === 'all') return 'mixed';
  if(s == null || s === 'unknown' || s === 'none') return 'none';
  return s;
};

/* How far a world's gravity is the one that matters: the sphere of influence,
 * which is not a design number but a consequence of how heavy the thing is.
 *
 *     r_soi = a · (m / M)^(2/5)
 *
 * — the standard patched-conic radius, with `a` the body's own orbit about
 * its parent and m/M the mass ratio between them. It is computed here rather
 * than written into the tables so that mass is the only knob: make a world
 * heavier and its reach grows on its own, and no table can quietly disagree
 * with the physics it is supposed to describe. Masses are `mu` (GM), so the
 * ratio is a ratio of mu and the G cancels.
 *
 * A thing with no mass, or nothing to go round, has no reach: the star, and
 * the drifting zones — the belt havens and the Maw — which are places
 * you match speeds with rather than fall towards. */
export function soiRadius(mu, a, parentMu){
  if(!(mu > 0) || !(a > 0) || !(parentMu > 0)) return null;
  return a * Math.pow(mu / parentMu, 2 / 5);
}

/* How wide a harbour mouth is: five of the world's own radii above the top of
 * its air — or above the ground, on a world with no air to speak of.
 *
 *     r_dock = atmo + 5 · radius
 *
 * Derived here for the same reason the sphere of influence is: size is the
 * knob, and a table of hand-written mouths can quietly disagree with the
 * worlds it is describing. A big world earns a big harbour, a pebble earns a
 * small one, and a world with weather earns the room its weather takes up —
 * Grumm's approach is wide because Grumm is wide and has fourteen hundred
 * kilometres of cloud on top of that, not because somebody typed a number.
 *
 * The drifting havens keep theirs. Nail, Whisker and the Maw have no surface
 * to be five times of and no air over it — their radius is a dot on a chart,
 * not a ground — so the formula has nothing to act on and the authored mouth
 * stands. */
export function dockRange(radius, atmo){
  if(!(radius > 0)) return null;
  return Math.max(radius, atmo ?? radius) + 5 * radius;
}

/* Two kinds of harbour, and which one a place has is about the place rather
 * than about its mass. Most worlds pull hard enough that tying up means being
 * in orbit round them: the mouth is a circle your whole orbit has to fit
 * inside, and gravity holds you there while you trade.
 *
 * A rendezvous is the other kind. The Maw has no weight at all, so there is no
 * orbit round it to wait in: you come alongside instead — near enough, slow
 * enough, and somebody throws you a line. Anything weightless is one of these
 * whether or not a table says so, and `harbour: "rendezvous"` is there to make
 * one of a world that does have a little pull, should a yard ever be built
 * somewhere too small to orbit. Nothing uses that today. */
export const isRendezvous = b => b?.harbour === 'rendezvous' || !((b?.mu ?? 0) > 0);

const rawMu = Object.fromEntries(TUNING.bodies.map(b => [b.id, b.mu ?? 0]));
export const BODIES = TUNING.bodies.map(b => ({
  ...b,
  species: normaliseSpecies(b.species),
  e: b.e ?? 0, omega: b.omega ?? 0, M0: b.M0 ?? 0, retrograde: !!b.retrograde,
  mu: b.mu ?? 0,
  soi: soiRadius(b.mu ?? 0, b.a ?? 0, rawMu[b.parent] ?? 0),
  // A world's mouth comes from its size; a drifting haven keeps the one it was given.
  zoneRadius: (b.mu ?? 0) > 0 ? dockRange(b.radius ?? 0, b.atmo) : b.zoneRadius,
  rendezvous: isRendezvous(b),
  colour: BODY_COLOURS[b.id] ?? null,
}));

const bodyIndex = new Map(BODIES.map(b => [b.id, b]));
export const bodyById = id => bodyIndex.get(id);

/* The Belt's rocks and the Arc's debris: decorative, deterministic, and on
 * their own circular rails so they turn with the sky. Generated once here
 * rather than stored, because ten thousand numbers in a JSON file would be
 * ten thousand numbers nobody could review. */
function xorshift(seed){
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export const BELT_ROCKS = (() => {
  const { inner, outer, count = 1400, seed = 11 } = TUNING.belt;
  const rnd = xorshift(seed);
  const rocks = [];
  for(let i = 0; i < count; i++){
    // Denser towards the middle of the annulus, thinner at the edges.
    const u = (rnd() + rnd()) / 2;
    const r = inner + (outer - inner) * u;
    rocks.push({ r, th0: rnd() * Math.PI * 2, n: Math.sqrt(C.MU_LAMP / (r * r * r)), big: rnd() < 0.08 });
  }
  return rocks;
})();
export const ARC_DEBRIS = (() => {
  const arc = bodyIndex.get('arc');
  if(!arc) return [];
  const { count = 220, spreadRad = 0.9, seed = 5 } = TUNING.arcDebris ?? {};
  const rnd = xorshift(seed);
  const n = Math.sqrt(C.MU_LAMP / (arc.a ** 3));
  const out = [];
  for(let i = 0; i < count; i++){
    // Trailing behind the segment, thinning with distance, a little scatter in radius.
    const behind = -Math.pow(rnd(), 1.6) * spreadRad;
    const r = arc.a * (1 + (rnd() - 0.5) * 0.02);
    out.push({ r, th0: arc.M0 + arc.omega + behind, n });
  }
  return out;
})();

/* ---------------------------------------------------------------- goods */

/* A crate is a crate: light goods take one unit of the hold, heavy ones three.
 * The table says "Light" or "Heavy" because that is what a dockhand says, and
 * basePrice is per crate, so a heavy crate of cheap ore still costs more than a
 * light one of the same stuff per unit of hold. */
const UNITS = { light: 1, heavy: 3 };
export const GOODS = ECONOMY.goods.map(g => ({
  ...g,
  units: UNITS[g.weight] ?? 1,
  needsTempControl: !!g.needsTempControl,
  producedAt: g.producedAt ?? [],
  stock: g.stock ?? [1, 1],
  buyers: g.buyers ?? [],
  lovedBy: g.lovedBy ?? [],
}));
const goodIndex = new Map(GOODS.map(g => [g.id, g]));
export const goodById = id => goodIndex.get(id);

/* ---------------------------------------------------------------- ports */

/* The goods table names who wants a thing, and it names them the way a trader
 * would: sometimes a port ("Veyra"), sometimes a whole people ("Otters"), and
 * once "Everyone". So a list is read against a port and its people, not looked
 * up in one index. A producer never appears on its own buying list — a stall
 * that buys back what it is selling two feet away is a money pump. */
const speciesAt = portId => normaliseSpecies(bodyIndex.get(portId)?.species ?? ECONOMY.ports[portId]?.species);
/* "Everyone" means everyone there is: a port with nobody living at it is not
   a customer, whatever the table says. */
const namesPort = (list, id) => {
  const sp = speciesAt(id);
  return list.some(x => (x === 'everyone' ? sp !== 'none' : x === id || x === sp));
};
export const lovesGood = (portId, goodId) => {
  const g = goodById(goodId);
  return !!g && !!ECONOMY.ports[portId] && namesPort(g.lovedBy, portId);
};
/* Loving a thing is wanting it. The table lists the two separately because
   they answer different questions — who will take it, and who will pay
   stupidly for it — but a people who love a good and are not on its buyer
   list would be a stall that turns away the one customer who cares. */
export const wantsGood = (portId, goodId) => {
  const g = goodById(goodId);
  if(!g || !ECONOMY.ports[portId] || g.producedAt.includes(portId)) return false;
  return namesPort(g.buyers, portId) || lovesGood(portId, goodId);
};
export const REGION_OF = Object.fromEntries(Object.entries(ECONOMY.ports).map(([id, p]) => [id, p.region ?? null]));

export const PORTS = Object.fromEntries(Object.entries(ECONOMY.ports).map(([id, p]) => {
  const body = bodyIndex.get(id);
  return [id, {
    /* The sky is the authority on who lives where: where the price list and
       the body table disagree about a port's people, the body table wins. */
    species: normaliseSpecies(body?.species ?? p.species),
    climate: body?.climate ?? p.climate,
    marketSize: p.marketSize ?? 1,
    fuelPricePerKms: p.fuelPricePerKms ?? null,
    shipyard: !!p.shipyard,
    region: p.region ?? null,
    /* The shelves are not written down per port any more: a stall sells what
       the place produces and buys what the goods table says it wants, so one
       row in one table moves both ends of a trade. How *much* is on the shelf
       is rolled per visit and lives in the save, not here. */
    sells: GOODS.filter(g => g.producedAt.includes(id)).map(g => ({ good: g.id, priceMul: 1 })),
    buys: GOODS.filter(g => wantsGood(id, g.id)).map(g => ({ good: g.id, priceMul: 1 })),
    openWithin: p.openWhen?.rAuBelow ?? null,
    towAllowed: id !== 'maw',
  }];
}));

/* ------------------------------------------------------------- upgrades */

const KEY_NAMES = {
  heatshield: 'heatShield', tempcontrol: 'tempControl',
  gravsensors: 'gravSensors', cryocooling: 'cryoCooling',
};
/* Tanks and holds are fitted anywhere there is a pump, so their shelf is
   written as "*" rather than as thirteen port ids that would have to be kept
   in step with the sky. Everything else names its port, because where you buy
   it is half of what it is: gravitational sensors are a cat instrument, and
   the rest come off an Emberkin bench. */
const EVERY_YARD = Object.keys(PORTS).filter(id => PORTS[id].fuelPricePerKms != null);
export const UPGRADES = ECONOMY.upgrades.map(u => {
  const out = { ...u, soldAt: u.soldAt === '*' ? EVERY_YARD : (u.soldAt ?? null) };
  if(u.kind === 'tank'){ out.value = TUNING.ship.tanks[u.tier].dv_kms; out.effect = `Holds ${out.value} km/s.`; }
  if(u.kind === 'hold'){ out.value = TUNING.ship.holds[u.tier].units; out.effect = `${out.value} units of cargo.`; }
  if(u.kind === 'key') out.key = KEY_NAMES[u.id] ?? u.id;
  return out;
});

/* ------------------------------------------------------------- formulas */

const F = ECONOMY.formulas;
export const FORMULAS = {
  stock: F.stock,
  demand: F.demand,
  reputation: F.reputation,
  haggle: F.haggle ?? { spread: 0.07 },
  volatility: F.volatility ?? { bySpecies: {} },
  /* Aerobraking. The shed is a fraction of the speed at the bottom of the
     dive, and the fraction goes with the square of how deep the dive goes, so
     the band of air is not one thing but two. The top of it is a feather: a
     graze takes a per cent or two, costs nothing, and a pilot can walk an
     orbit down over as many laps as they have days for. The bottom of it is a
     wall: aim a few kilometres over the ground and the planet takes nearly
     everything in a single lap, which is the maneuver a heat shield is for.
     What stops that from being a crash is the floor below — the pass will
     never leave the far end of the orbit inside the air — so the worst a deep
     dive does is park you low, in an orbit you must burn to climb out of, with
     a hull that probably felt it. That is the trade: fuel and risk against
     days. The risk and repair figures live beside these in the design table,
     and they are what makes the deep line cost something. */
  aerobrake: { k: 1.4, depthPower: 2, maxFraction: 0.9, floorApo: 1.25, ...(F.aerobrake ?? {}) },
  toll: { ...F.toll, cooldownDays: 30, maxCargoFraction: 0.4, giftRep: 3, giftChance: 0.35 },
  tow: { ...F.tow, minDays: 3, crashMul: 1.5 },
};

/* ----------------------------------------------------------------- text */

export const GLOSSARY = NARRATIVE.glossary ?? [];
export const TEXT = NARRATIVE;

/* The errands, and what the crew say. Both used to be keys in narrative.json,
 * which was fine while there were three of one and none of the other and is
 * not fine now: a quest is a record with a dozen fields and rules about them,
 * and a table of records wants a file where its shape can be written down at
 * the top and checked at build time. They are their own tables now, and
 * quests.json and dialog.json each open with the format they hold.
 *
 * Nothing but the shape changed. `quests` and `dialog` are read here so that
 * the rest of the game keeps asking content.js for content and never has to
 * know how many files it came out of. */
export const QUESTS = QUESTBOOK.quests ?? [];
export const DIALOG = DIALOGUE.exchanges ?? [];
TEXT.logTemplates ??= {};
TEXT.logTemplates.aerobrake ??= 'Air braked at {body}: {dv} shed to the clouds.';
TEXT.events ??= {};
TEXT.events.tollWaved ??= '{captain} looks over an empty hold, laughs, and waves you through.';
