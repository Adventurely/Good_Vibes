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
  WARP_LEVELS: C.WARP_LEVELS,
  START_PORT: 'tessel',
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
  chorus:   { name: 'The Chorus', plural: 'The Chorus', adjective: 'Chorus',   colour: '#b48cff', animal: 'nobody knows' },
  mixed:    { name: 'All four peoples', plural: 'Everyone', adjective: 'bazaar', colour: '#ffd23f', animal: 'everyone' },
  none:     { name: 'Nobody', plural: 'Nobody', adjective: '', colour: '#9a948a', animal: 'nobody at all' },
};

/* The four peoples who trade, remember and hold grudges. The Chorus are gone
 * and nobody lives at the Lantern, so neither keeps a reputation. */
export const PEOPLES = ['emberkin', 'otter', 'cat', 'frog'];

/* Colours for the chart, by body. Peoples' worlds take their people's hue;
 * the rest are what they are: a violet giant, a glass-snow world, a lamp. */
const BODY_COLOURS = {
  lamp: '#ffd23f', cinder: '#e8683c', wanderwell: '#f2a65a', tagalong: '#cbb8a0',
  tessel: '#3fa9dd', pip: '#cfc2a8', bramble: '#6cc24a', ledger: '#d8b45a',
  arc: '#d9c9a3', clawrock: '#b58a5a', grumm: '#8b6bd6', mossback: '#5e8f4a',
  lillimoor: '#7fd0c8', widdershins: '#9a8fa6', chime: '#cfe8ff', hush: '#8b8b9e',
  merrow: '#bfe9ff', lantern: '#ffffff',
};

/* --------------------------------------------------------------- bodies */

const normaliseSpecies = s => {
  if(s === 'all') return 'mixed';
  if(s == null || s === 'unknown' || s === 'none') return 'none';
  return s;
};

export const BODIES = TUNING.bodies.map(b => ({
  ...b,
  species: normaliseSpecies(b.species),
  e: b.e ?? 0, omega: b.omega ?? 0, M0: b.M0 ?? 0, retrograde: !!b.retrograde,
  mu: b.mu ?? 0,
  soi: b.soi ?? null,
  colour: BODY_COLOURS[b.id] ?? null,
}));

const bodyIndex = new Map(BODIES.map(b => [b.id, b]));
export const bodyById = id => bodyIndex.get(id);

/* The Scatter's rocks and the Arc's debris: decorative, deterministic, and on
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

/* Passengers travel by contract, not by the crate; the table's boarding-fee
 * rows are bookkeeping the game does not need. */
export const GOODS = ECONOMY.goods.filter(g => g.category !== 'passenger').map(g => ({
  ...g,
  units: g.units ?? 1,
  lifetimeDays: g.lifetimeDays ?? null,
  needsRefrigeration: !!g.needsRefrigeration,
  producedAt: g.producedAt ?? [],
  demandBy: g.demandBy ?? {},
}));
const goodIds = new Set(GOODS.map(g => g.id));

/* ---------------------------------------------------------------- ports */

const NO_OFFERS = new Set(['mossback', 'lantern', 'hush', 'chime']);
export const PORTS = Object.fromEntries(Object.entries(ECONOMY.ports).map(([id, p]) => {
  const body = bodyIndex.get(id);
  return [id, {
    /* The sky is the authority on who lives where: the price list calls Chime
       and Hush frog and cat ports, and the design document is clear that the
       Chorus are gone and nobody has taken their place. */
    species: normaliseSpecies(body?.species ?? p.species),
    climate: body?.climate ?? p.climate,
    marketSize: p.marketSize ?? 1,
    fuelPricePerKms: p.fuelPricePerKms ?? null,
    shipyard: !!p.shipyard,
    upgrades: p.upgrades ?? [],
    sells: (p.sells ?? []).filter(s => goodIds.has(s.good)),
    buys: (p.buys ?? []).filter(s => goodIds.has(s.good)),
    gifts: p.gifts ?? null,
    openWithin: p.openWhen?.rAuBelow ?? null,
    passengers: !NO_OFFERS.has(id),
    towAllowed: id !== 'wanderwell' && id !== 'lantern',
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
  alignment: F.alignment,
  saturation: F.saturation,
  perishable: F.perishable,
  reputation: F.reputation,
  haggle: F.haggle ?? { spread: 0.07 },
  volatility: F.volatility ?? { bySpecies: {} },
  market: { disinterestMul: 0.6, resaleCap: 0.75 },
  aerobrake: { k: 0.5, maxFraction: 0.6, floorApo: 1.25 },
  toll: { ...F.toll, cooldownDays: 30, maxCargoFraction: 0.4, giftRep: 3, giftChance: 0.35 },
  tow: { ...F.tow, minDays: 3, crashMul: 1.5 },
  contract: { ...F.contract, refreshDays: 10, latePayMul: 0.4, earlyFraction: 0.5 },
};

/* ---------------------------------------------------------- contracts */

const DELIVERY = /crate|load|lot|parcel|case|cultures|fashions/i;
export const CONTRACT_TEMPLATES = ECONOMY.contracts.templates.map(t => {
  const out = { ...t, kind: DELIVERY.test(t.text) && !/apprentice|scholar|pilgrim|song-keeper|crew|cousins|family|caretakers|banker/i.test(t.text) ? 'delivery' : 'passenger' };
  out.units = out.kind === 'delivery' ? 4 : 1;
  // The table names a climate the sky does not have; it means the tavern.
  if(out.toClimate === 'chill'){ delete out.toClimate; out.toPorts = ['clawrock']; }
  if(typeof out.toClimate === 'string') out.toClimate = [out.toClimate];
  if(typeof out.fromClimate === 'string') out.fromClimate = [out.fromClimate];
  if(out.species === 'any') out.species = 'otter';
  return out;
});

/* ----------------------------------------------------------------- text */

export const GLOSSARY = NARRATIVE.glossary ?? [];
export const TEXT = NARRATIVE;
TEXT.logTemplates ??= {};
TEXT.logTemplates.aerobrake ??= 'Skimmed {body}: {dv} shed to the clouds.';
TEXT.events ??= {};
TEXT.events.tollWaved ??= '{captain} looks over an empty hold, laughs, and waves you through.';
