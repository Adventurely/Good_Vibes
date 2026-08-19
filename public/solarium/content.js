/* Save Solarium — game content.
 *
 * Everything here is data: the five classes, their cards, the enemies, and the
 * pixel art. It is imported by the Durable Object (which is authoritative) and
 * shipped to the client for rendering, so it must stay free of any runtime
 * dependency on either side.
 *
 * Sprites are rows of palette keys. '.' is transparent. Keeping art as text
 * means no image requests, no binary assets in the repo, and a sprite can be
 * edited in place without a tool.
 */

export const SOLAR_PER_ROUND = 3;
export const HAND_SIZE = 4;
export const FIGHTS_BEFORE_BOSS = 3;

/* Sprites live in art.js. The engine never touches them — enemies reference an
   art key by name and the client resolves it — so the rules bundle stays free
   of a few hundred lines of pixels. */

/* ============================================================== classes === */

export const CLASSES = [
  {
    id: 'engineal',
    downLine: 'Power is lost. Systems shutting down...',
    name: 'EngiNeal',
    archetype: 'Engineer · support',
    hp: 34,
    blurb: 'Builds the thing that fixes the thing. Turns scrap into solar and hands it to everyone else.',
    colour: '#f2913d',
    deck: ['patch-panel', 'patch-panel', 'overclock', 'scrap-shot']
  },
  {
    id: 'mistypalm',
    downLine: 'The garden... keep it watered for me.',
    name: 'Misty Palm',
    archetype: 'Cleric · healer',
    hp: 32,
    blurb: 'Grew the greenhouse that fed the block. Keeps people standing longer than they should.',
    colour: '#5fd3d3',
    deck: ['dew-touch', 'dew-touch', 'photosynthesis', 'thorn-lash']
  },
  {
    id: 'turt',
    downLine: "Shell's cracked. Get behind someone else.",
    name: 'Turt',
    archetype: 'Tank',
    hp: 48,
    blurb: 'Carries the roof garden on his back. Nothing gets past him quickly.',
    colour: '#2f7d3f',
    deck: ['shell-up', 'shell-up', 'taunt', 'slam']
  },
  {
    id: 'defty',
    downLine: 'Too slow. First time for everything.',
    name: 'Defty',
    archetype: 'Rogue',
    hp: 28,
    blurb: 'Salvage runner. In and out before the drones finish booting.',
    colour: '#3f7bd9',
    deck: ['quick-cut', 'quick-cut', 'rust-dust', 'vanish']
  },
  {
    id: 'mrknight',
    downLine: 'Forgive me. My blade has rusted.',
    name: 'Mr. Knight',
    archetype: 'Fighter',
    hp: 40,
    blurb: 'Wears reclaimed plate and very good manners. Hits extremely hard.',
    colour: '#ffd34e',
    deck: ['sun-strike', 'sun-strike', 'brace', 'flourish']
  }
];

/* ================================================================ cards === */
/* effect verbs are resolved in engine.js — nothing here executes. */

export const CARDS = {
  /* --- EngiNeal ------------------------------------------------------- */
  'patch-panel': { name: 'Patch Panel', cost: 1, cls: 'engineal', kind: 'skill', target: 'ally',
    text: 'Give an ally 6 Shield.',
    voice: 'Bit of plate, four bolts. Good as new.', fx: [{ op: 'shield', v: 6 }], art: 'panel' },
  'overclock': { name: 'Overclock', cost: 1, cls: 'engineal', kind: 'power', target: 'ally',
    text: 'An ally gains 2 Solar next round.',
    voice: 'Past the red line is where it gets interesting.', fx: [{ op: 'grantSolar', v: 2 }], art: 'bolt' },
  'scrap-shot': { name: 'Scrap Shot', cost: 1, cls: 'engineal', kind: 'attack', target: 'enemy',
    text: 'Deal 6 damage.',
    voice: 'Everything\'s a projectile if you\'re brave enough.', fx: [{ op: 'damage', v: 6 }], art: 'gear' },
  'solar-array': { name: 'Solar Array', cost: 2, cls: 'engineal', kind: 'power', target: 'party',
    text: 'Everyone gains 1 Solar next round.',
    voice: 'Panels up. Nobody stand in the light.', fx: [{ op: 'grantSolarAll', v: 1 }], art: 'sun' },
  'turret': { name: 'Sprout Turret', cost: 2, cls: 'engineal', kind: 'power', target: 'self',
    text: 'At the end of each round, deal 4 damage to a random enemy.',
    voice: 'She\'s got opinions. I let her have them.', fx: [{ op: 'turret', v: 4 }], art: 'gear' },
  // Costs Solar deliberately. At 0 it draws itself back out of a reshuffled
  // discard and can be replayed forever — a free infinite-draw engine.
  'recycle': { name: 'Recycle', cost: 1, cls: 'engineal', kind: 'skill', target: 'self',
    text: 'Draw 2 cards.',
    voice: 'Nothing\'s rubbish. It\'s just early.', fx: [{ op: 'draw', v: 2 }], art: 'loop' },

  /* --- Misty Palm ----------------------------------------------------- */
  'dew-touch': { name: 'Dew Touch', cost: 1, cls: 'mistypalm', kind: 'skill', target: 'ally',
    text: 'Heal an ally 7.',
    voice: 'Hold still. This is the easy part.', fx: [{ op: 'heal', v: 7 }], art: 'drop' },
  'photosynthesis': { name: 'Photosynthesis', cost: 1, cls: 'mistypalm', kind: 'power', target: 'ally',
    text: 'An ally gains 3 Regrowth.',
    voice: 'Turn your face to it. That\'s the whole trick.', fx: [{ op: 'regen', v: 3 }], art: 'leaf' },
  'thorn-lash': { name: 'Thorn Lash', cost: 1, cls: 'mistypalm', kind: 'attack', target: 'enemy',
    text: 'Deal 5 damage.',
    voice: 'Even soft things grow points.', fx: [{ op: 'damage', v: 5 }], art: 'thorn' },
  'bloom': { name: 'Bloom', cost: 2, cls: 'mistypalm', kind: 'skill', target: 'party',
    text: 'Heal the whole party 5.',
    voice: 'Everyone breathe. Everyone grow.', fx: [{ op: 'healAll', v: 5 }], art: 'leaf' },
  'cleanse': { name: 'Cleanse', cost: 1, cls: 'mistypalm', kind: 'skill', target: 'ally',
    text: 'Remove all Rust from an ally and heal 3.',
    voice: 'Rust is only rot that got organised.', fx: [{ op: 'cleanse' }, { op: 'heal', v: 3 }], art: 'drop' },
  'greenhouse': { name: 'Greenhouse', cost: 2, cls: 'mistypalm', kind: 'power', target: 'party',
    text: 'The party gains 2 Regrowth.',
    voice: 'I\'ve made somewhere warm. Stay in it.', fx: [{ op: 'regenAll', v: 2 }], art: 'leaf' },

  /* --- Turt ----------------------------------------------------------- */
  'shell-up': { name: 'Shell Up', cost: 1, cls: 'turt', kind: 'skill', target: 'self',
    text: 'Gain 9 Shield.',
    voice: 'Tuck in. Wait it out.', fx: [{ op: 'shieldSelf', v: 9 }], art: 'shell' },
  'taunt': { name: 'Hold The Line', cost: 1, cls: 'turt', kind: 'skill', target: 'self',
    text: 'Enemies target you this round. Gain 4 Shield.',
    voice: 'Behind me. All of you. Now.',
    fx: [{ op: 'taunt' }, { op: 'shieldSelf', v: 4 }], art: 'shell' },
  'slam': { name: 'Slam', cost: 1, cls: 'turt', kind: 'attack', target: 'enemy',
    text: 'Deal 7 damage.',
    voice: 'I don\'t hit often. I hit once.', fx: [{ op: 'damage', v: 7 }], art: 'fist' },
  'bulwark': { name: 'Bulwark', cost: 2, cls: 'turt', kind: 'skill', target: 'party',
    text: 'Give the party 5 Shield.',
    voice: 'Borrow some shell. I\'ve plenty.', fx: [{ op: 'shieldAll', v: 5 }], art: 'shell' },
  'retaliate': { name: 'Retaliate', cost: 1, cls: 'turt', kind: 'power', target: 'self',
    text: 'Thorns 4 this round — attackers take 4.',
    voice: 'Hit me. See how it goes.', fx: [{ op: 'thorns', v: 4 }], art: 'thorn' },
  'earthshake': { name: 'Earthshake', cost: 2, cls: 'turt', kind: 'attack', target: 'enemies',
    text: 'Deal 6 damage to all enemies.',
    voice: 'One foot. That\'s all it takes.', fx: [{ op: 'damageAll', v: 6 }], art: 'fist' },

  /* --- Defty ---------------------------------------------------------- */
  'quick-cut': { name: 'Quick Cut', cost: 0, cls: 'defty', kind: 'attack', target: 'enemy',
    text: 'Deal 3 damage.',
    voice: 'Didn\'t even slow down.', fx: [{ op: 'damage', v: 3 }], art: 'blade' },
  'rust-dust': { name: 'Rust Dust', cost: 1, cls: 'defty', kind: 'skill', target: 'enemy',
    text: 'Apply 4 Rust. Rust deals 1 damage per stack each round.',
    voice: 'A pinch in the joints. You\'ll notice later.',
    fx: [{ op: 'rust', v: 4 }], art: 'dust' },
  'vanish': { name: 'Vanish', cost: 1, cls: 'defty', kind: 'skill', target: 'self',
    text: 'Gain 6 Shield and draw a card.',
    voice: 'Was I ever there? Prove it.',
    fx: [{ op: 'shieldSelf', v: 6 }, { op: 'draw', v: 1 }], art: 'smoke' },
  'backstab': { name: 'Backstab', cost: 2, cls: 'defty', kind: 'attack', target: 'enemy',
    text: 'Deal 14 damage to an enemy that already has Rust, otherwise 7.',
    voice: 'The rust does the work. I take the credit.',
    fx: [{ op: 'damageRusted', v: 7, v2: 14 }], art: 'blade' },
  'flurry': { name: 'Flurry', cost: 1, cls: 'defty', kind: 'attack', target: 'enemy',
    text: 'Deal 3 damage three times.',
    voice: 'Three. Before you\'d counted one.', fx: [{ op: 'damage', v: 3, times: 3 }], art: 'blade' },
  'smoke-bomb': { name: 'Smoke Bomb', cost: 1, cls: 'defty', kind: 'skill', target: 'party',
    text: 'Party gains 4 Shield.',
    voice: 'Nobody look. Especially you lot.', fx: [{ op: 'shieldAll', v: 4 }], art: 'smoke' },

  /* --- Mr. Knight ----------------------------------------------------- */
  'sun-strike': { name: 'Sun Strike', cost: 1, cls: 'mrknight', kind: 'attack', target: 'enemy',
    text: 'Deal 8 damage.',
    voice: 'Struck in good faith, sir.', fx: [{ op: 'damage', v: 8 }], art: 'sword' },
  'brace': { name: 'Brace', cost: 1, cls: 'mrknight', kind: 'skill', target: 'self',
    text: 'Gain 7 Shield.',
    voice: 'I shall not be moved. Kind of you to try.', fx: [{ op: 'shieldSelf', v: 7 }], art: 'shield' },
  'flourish': { name: 'Flourish', cost: 2, cls: 'mrknight', kind: 'attack', target: 'enemies',
    text: 'Deal 7 damage to all enemies.',
    voice: 'All of you at once, then. Very well.', fx: [{ op: 'damageAll', v: 7 }], art: 'sword' },
  'oath': { name: 'Oath of Noon', cost: 1, cls: 'mrknight', kind: 'power', target: 'self',
    text: 'Gain 2 Might this fight — attacks deal 2 more.',
    voice: 'By the light at its highest, I am sworn.', fx: [{ op: 'might', v: 2 }], art: 'sun' },
  'riposte': { name: 'Riposte', cost: 1, cls: 'mrknight', kind: 'attack', target: 'enemy',
    text: 'Deal 5 damage and gain 5 Shield.',
    voice: 'After you. Then, regrettably, me.',
    fx: [{ op: 'damage', v: 5 }, { op: 'shieldSelf', v: 5 }], art: 'sword' },
  'sunbreaker': { name: 'Sunbreaker', cost: 3, cls: 'mrknight', kind: 'attack', target: 'enemy',
    text: 'Deal 20 damage.',
    voice: 'I do apologise. This will be loud.', fx: [{ op: 'damage', v: 20 }], art: 'sword' },

  /* --- neutral rewards, offered to anyone -------------------------------- */
  'salvage': { name: 'Salvage', cost: 0, cls: null, kind: 'skill', target: 'self',
    text: 'Gain 1 Solar.',
    voice: 'Something useful, somewhere in all this.', fx: [{ op: 'solar', v: 1 }], art: 'gear' },
  'sunflower': { name: 'Sunflower', cost: 1, cls: null, kind: 'skill', target: 'ally',
    text: 'Heal an ally 4 and give 4 Shield.',
    voice: 'It grew here. That means we can.',
    fx: [{ op: 'heal', v: 4 }, { op: 'shield', v: 4 }], art: 'sun' },
  'scrap-bolt': { name: 'Scrap Bolt', cost: 1, cls: null, kind: 'attack', target: 'enemy',
    text: 'Deal 6 damage.',
    voice: 'Sharp end forward. Usually.', fx: [{ op: 'damage', v: 6 }], art: 'bolt' }
};

/* Cards a class can be offered after a fight — its own list plus neutrals. */
export function rewardPool(classId){
  return Object.keys(CARDS).filter(id => {
    const c = CARDS[id];
    if(c.cls === null) return true;
    if(c.cls !== classId) return false;
    // Starters are already in the deck; rewards should feel like additions.
    return !CLASSES.find(k => k.id === classId).deck.includes(id);
  });
}

/* =============================================================== enemies == */

export const ENEMIES = {
  rustmite: { name: 'Rust Mite', art: 'rustmite', hp: 18,
    moves: [{ kind: 'attack', v: 6 }, { kind: 'rust', v: 2 }] },
  smogwisp: { name: 'Smog Wisp', art: 'smogwisp', hp: 14,
    moves: [{ kind: 'attack', v: 5 }, { kind: 'weaken', v: 1 }] },
  scraphound: { name: 'Scrap Hound', art: 'scraphound', hp: 26,
    moves: [{ kind: 'attack', v: 9 }, { kind: 'attack', v: 5, times: 2 }] },
  drillmech: { name: 'Drill Mech', art: 'drillmech', hp: 34,
    moves: [{ kind: 'attack', v: 12 }, { kind: 'shield', v: 8 }, { kind: 'attackAll', v: 5 }] },
  // Boss HP is multiplied by party size in startFight — it is the one fight
  // that cannot answer a bigger party by bringing more bodies.
  extractor: { name: 'THE EXTRACTOR', art: 'extractor', hp: 62, boss: true,
    moves: [{ kind: 'attackAll', v: 7 }, { kind: 'attack', v: 18 },
            { kind: 'rustAll', v: 3 }, { kind: 'shield', v: 15 }] }
};

export const MAX_ENEMIES = 6;

/* Health each rank-and-file enemy gains per extra player, tuned by simulating
   runs at every party size. Adding bodies alone does not work: area attacks
   like Flourish and Earthshake hit all of them, so a wider party clears a
   wider fight faster than a narrow one. Health is the axis area damage cannot
   cheat, and a couple of extra bodies bring the incoming damage back up. */
/* The run has a shape as well as a difficulty. The encounter tables already put
   nastier things in the later fights, but every enemy hit as hard on fight one
   as on fight three, so the curve was flat underneath the casting. These tilt
   it: the first fight is a warm-up you are meant to win while you learn your
   deck, the third is meant to hurt before the Extractor ever appears. Indexed by
   level; the boss is scaled by party size on its own and ignores these. */
export const LEVEL_HP  = [0.74, 1.0, 1.26];
export const LEVEL_DMG = [0.72, 1.0, 1.22];

export const MOB_HP_PER_EXTRA_PLAYER = 1.1;

/* Damage matters more than health did. A full party stacks Turt's taunt, Misty
   Palm's heals and EngiNeal's shields, and a fixed attack split five ways never
   threatens any of it. Single-target damage scales hardest; area attacks scale
   gently because they already reach everyone. */
export const MOB_DMG_PER_EXTRA_PLAYER = 0.16;
export const MOB_AOE_PER_EXTRA_PLAYER = 0.18;

/* Returns the enemy keys plus the size of the unscaled encounter.
 *
 * Bodies are added one per extra player, and startFight then divides the
 * encounter's total health across however many bodies there are. Adding whole
 * enemies without that correction produced a sawtooth — three and four players
 * met the same number of extra enemies, so a party of four had a far easier
 * run than either neighbour. Total health now rises smoothly with headcount
 * while the number of things on screen still grows. */
export function buildEncounter(level, partySize, rng){
  if(level >= FIGHTS_BEFORE_BOSS){
    return { keys: ['extractor'], baseCount: 1 };
  }
  const tables = [
    ['rustmite', 'smogwisp'],
    ['rustmite', 'scraphound'],
    ['scraphound', 'drillmech', 'smogwisp']
  ];
  let base = tables[Math.min(level, tables.length - 1)].slice();

  // Small parties get fewer bodies, not just weaker ones. Health can be spread
  // thin, but every enemy still attacks once a round, and three attackers
  // against a single hero is a losing race no amount of health-scaling fixes.
  base = base.slice(0, Math.max(2, Math.min(base.length, partySize + 1)));

  const baseCount = base.length;
  const extra = Math.min(partySize - 1, MAX_ENEMIES - baseCount);
  for(let i = 0; i < extra; i++) base.push(base[Math.floor(rng() * baseCount)]);
  return { keys: base, baseCount };
}
