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

/* The four peoples who trade, remember and hold grudges. The Builders are gone
 * and nobody lives at the Maw, so neither keeps a reputation. */
export const PEOPLES = ['emberkin', 'otter', 'cat', 'frog'];

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

const rawMu = Object.fromEntries(TUNING.bodies.map(b => [b.id, b.mu ?? 0]));
export const BODIES = TUNING.bodies.map(b => ({
  ...b,
  species: normaliseSpecies(b.species),
  e: b.e ?? 0, omega: b.omega ?? 0, M0: b.M0 ?? 0, retrograde: !!b.retrograde,
  mu: b.mu ?? 0,
  soi: soiRadius(b.mu ?? 0, b.a ?? 0, rawMu[b.parent] ?? 0),
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
  lifetimeDays: g.lifetimeDays ?? null,
  needsRefrigeration: !!g.needsRefrigeration,
  producedAt: g.producedAt ?? [],
  stock: g.stock ?? [1, 1],
  buyers: g.buyers ?? [],
  lovedBy: g.lovedBy ?? [],
}));
const goodIds = new Set(GOODS.map(g => g.id));
const goodIndex = new Map(GOODS.map(g => [g.id, g]));
export const goodById = id => goodIndex.get(id);

/* ---------------------------------------------------------------- ports */

const NO_OFFERS = new Set(['maw']);

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
    upgrades: p.upgrades ?? [],
    region: p.region ?? null,
    /* The shelves are not written down per port any more: a stall sells what
       the place produces and buys what the goods table says it wants, so one
       row in one table moves both ends of a trade. How *much* is on the shelf
       is rolled per visit and lives in the save, not here. */
    sells: GOODS.filter(g => g.producedAt.includes(id)).map(g => ({ good: g.id, priceMul: 1 })),
    buys: GOODS.filter(g => wantsGood(id, g.id)).map(g => ({ good: g.id, priceMul: 1 })),
    gifts: p.gifts ?? null,
    openWithin: p.openWhen?.rAuBelow ?? null,
    passengers: !NO_OFFERS.has(id),
    towAllowed: id !== 'maw',
  }];
}));

/* ------------------------------------------------------------- upgrades */

const KEY_NAMES = { heatshield: 'heatShield', refrigeration: 'refrigeration', sensors: 'sensors', stealth: 'stealth' };
export const UPGRADES = ECONOMY.upgrades.map(u => {
  const out = { ...u, soldAt: u.soldAt ?? null };
  if(u.kind === 'tank') out.value = TUNING.ship.tanks[u.tier].dv_kms;
  if(u.kind === 'engine') out.value = TUNING.ship.engines[u.tier].fuelPriceMul;
  if(u.kind === 'hold') out.value = TUNING.ship.holds[u.tier].units;
  if(u.kind === 'key') out.key = KEY_NAMES[u.id] ?? u.id;
  if(u.kind === 'tank') out.effect = `Holds ${out.value} km/s.`;
  if(u.kind === 'hold') out.effect = `${out.value} units of cargo.`;
  if(u.kind === 'engine') out.effect = out.value < 1 ? `Fuel costs ${Math.round((1 - out.value) * 100)}% less to buy.` : 'The engine you came with.';
  return out;
});

/* ------------------------------------------------------------- formulas */

const F = ECONOMY.formulas;
export const FORMULAS = {
  region: F.region,
  loved: F.loved,
  stock: F.stock,
  saturation: F.saturation,
  perishable: F.perishable,
  reputation: F.reputation,
  haggle: F.haggle ?? { spread: 0.07 },
  volatility: F.volatility ?? { bySpecies: {} },
  market: { disinterestMul: 0.6, resaleCap: 0.75 },
  /* Aerobraking. The shed is a fraction of the speed at the bottom of the
     dive, scaled by how deep into the air the dive goes — and the fraction has
     to be small, because the design sells skimming as *free braking*, not as a
     free crash landing. At half the periapsis speed a single pass dumped the
     ship into a circle just above the cloud tops, which costs more to climb
     out of than capturing would have cost in the first place. A few per cent a
     pass lets a pilot walk an orbit down over several passes and stop where
     they want to be, which is the technique the design is describing. */
  aerobrake: { k: 0.04, maxFraction: 0.12, floorApo: 1.25 },
  toll: { ...F.toll, cooldownDays: 30, maxCargoFraction: 0.4, giftRep: 3, giftChance: 0.35 },
  tow: { ...F.tow, minDays: 3, crashMul: 1.5 },
  contract: { ...F.contract, refreshDays: 10, latePayMul: 0.4, earlyFraction: 0.5 },
};

/* ---------------------------------------------------------- contracts */

const DELIVERY = /crate|load|lot|parcel|case|fashions|medicine/i;
export const CONTRACT_TEMPLATES = ECONOMY.contracts.templates.map(t => {
  const out = { ...t, kind: DELIVERY.test(t.text) && !/apprentice|scholar|pilgrim|song-keeper|crew|cousins|family|caretakers|banker/i.test(t.text) ? 'delivery' : 'passenger' };
  out.units = out.kind === 'delivery' ? 4 : 1;
  if(typeof out.toClimate === 'string') out.toClimate = [out.toClimate];
  if(typeof out.fromClimate === 'string') out.fromClimate = [out.fromClimate];
  if(out.species === 'any') out.species = 'otter';
  return out;
});

/* ----------------------------------------------------------------- text */

export const GLOSSARY = NARRATIVE.glossary ?? [];
export const TEXT = NARRATIVE;
TEXT.logTemplates ??= {};
TEXT.logTemplates.aerobrake ??= 'Air braked at {body}: {dv} shed to the clouds.';
TEXT.events ??= {};
TEXT.events.tollWaved ??= '{captain} looks over an empty hold, laughs, and waves you through.';
