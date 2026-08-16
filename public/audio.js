/* Good Vibes — music and sound.
 *
 * Synthesised on the fly, Solarium's way: no files to fetch, no loop to wait
 * on, a look-ahead scheduler queueing notes against the audio clock because
 * setTimeout drifts and music makes drift extremely obvious.
 *
 * Two tracks, one per phase, both original:
 *
 *   build   warm and unhurried, in the direction of Stardew's town themes —
 *           C major with added sixths, a pentatonic lead that wanders rather
 *           than insists, brushes instead of drums. The party is planning;
 *           the music should not be in a hurry either.
 *   battle  its opposite on purpose: E minor over a dorian lift, twice the
 *           tempo, a square-wave riff and an actual kick. The surge gets
 *           urgency, not menace — this is still a garden, even on fire.
 *
 * Nothing plays until a user gesture, because autoplay policy decides that,
 * not us. The mute choice persists per browser.
 */

const midi = n => 440 * Math.pow(2, (n - 69) / 12);

/* ------------------------------------------------------------------ songs --- */

/* A song is bars of sixteen steps. Melodies are written as [step, midi, len]
   with len in steps; chords as one [root, quality] per bar. Quality picks the
   colour notes the pads add: 'maj6', 'min7', 'sus', 'maj7', 'min'. */

const QUALITIES = {
  maj6: [0, 4, 7, 9],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  min:  [0, 3, 7],
  sus:  [0, 5, 7],
};

const BUILD_SONG = {
  bpm: 84,
  swing: 0.12,                    // a light shuffle keeps it from marching
  bars: [
    { chord: [48, 'maj6'] }, { chord: [45, 'min7'] },
    { chord: [41, 'maj7'] }, { chord: [43, 'sus'] },
    { chord: [48, 'maj6'] }, { chord: [52, 'min7'] },
    { chord: [41, 'maj7'] }, { chord: [43, 'sus'] },
  ],
  // C pentatonic wander, phrased in question-and-answer pairs. Rests are what
  // make it pastoral: the tune spends half its time listening.
  lead: [
    [0, 72, 3], [4, 76, 2], [6, 74, 2], [8, 72, 4],
    [16, 69, 3], [20, 72, 2], [24, 67, 6],
    [32, 64, 3], [36, 67, 2], [38, 69, 2], [40, 72, 4],
    [48, 74, 2], [52, 72, 2], [56, 67, 6],
    [64, 72, 3], [68, 76, 2], [70, 77, 2], [72, 79, 4],
    [80, 76, 3], [84, 74, 2], [88, 72, 6],
    [96, 69, 3], [100, 67, 2], [104, 64, 4],
    [112, 67, 2], [114, 69, 2], [116, 72, 8],
  ],
  arpEvery: 2,                    // gentle eighth-note harp under everything
  arpLevel: 0.055,
  leadLevel: 0.11,
  leadType: 'triangle',
  bassLevel: 0.10,
  brush: true,                    // noise brushes on the backbeats
  kick: false,
};

const BATTLE_SONG = {
  bpm: 138,
  swing: 0,
  bars: [
    { chord: [40, 'min'] }, { chord: [40, 'min'] },
    { chord: [43, 'maj6'] }, { chord: [45, 'min7'] },
    { chord: [40, 'min'] }, { chord: [38, 'sus'] },
    { chord: [43, 'maj6'] }, { chord: [47, 'min'] },
  ],
  // An insisting riff rather than a wander — short cells, chromatic lean at
  // the turn, the same figure shifted with the chords so it reads as one idea.
  lead: [
    [0, 64, 1], [2, 67, 1], [4, 64, 1], [6, 71, 2], [10, 69, 1], [12, 67, 2],
    [16, 64, 1], [18, 67, 1], [20, 64, 1], [22, 74, 2], [26, 71, 1], [28, 69, 2],
    [32, 67, 1], [34, 71, 1], [36, 67, 1], [38, 74, 2], [42, 76, 1], [44, 74, 2],
    [48, 72, 1], [50, 69, 1], [52, 72, 1], [54, 76, 2], [58, 74, 1], [60, 71, 2],
    [64, 64, 1], [66, 67, 1], [68, 64, 1], [70, 71, 2], [74, 69, 1], [76, 67, 2],
    [80, 62, 1], [82, 65, 1], [84, 62, 1], [86, 69, 2], [90, 67, 1], [92, 65, 2],
    [96, 67, 1], [98, 71, 1], [100, 67, 1], [102, 74, 2], [106, 76, 1], [108, 74, 2],
    [112, 71, 1], [114, 74, 1], [116, 79, 4], [122, 76, 1], [124, 74, 1], [126, 71, 1],
  ],
  arpEvery: 4,
  arpLevel: 0.04,
  leadLevel: 0.085,
  leadType: 'square',
  bassLevel: 0.13,
  brush: false,
  kick: true,
};

export const SONGS = { build: BUILD_SONG, battle: BATTLE_SONG };

/* ------------------------------------------------------------------ engine --- */

export function createAudio(){
  let ctx = null, bus = null;
  let timer = null, step = 0, nextTime = 0;
  let song = null, songName = null;
  let muted = false;
  try{ muted = localStorage.getItem('gv-muted') === '1'; }catch{ /* private mode */ }

  function ensure(){
    if(!ctx){
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      bus = ctx.createGain();
      bus.gain.value = muted ? 0 : 0.5;
      bus.connect(ctx.destination);
    }
    if(ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function voice(freq, t, dur, type, vol, glideTo){
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if(glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function hit(t, dur, vol, cut, type = 'highpass'){
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = cut;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t);
  }

  /* ---- the sequencer ---------------------------------------------------- */

  function scheduleStep(s, t){
    const cfg = song;
    const stepsPerBar = 16;
    const totalSteps = cfg.bars.length * stepsPerBar;
    const pos = s % totalSteps;
    const bar = Math.floor(pos / stepsPerBar);
    const inBar = pos % stepsPerBar;
    const stepLen = 60 / cfg.bpm / 4;
    const [root, quality] = cfg.bars[bar].chord;
    const tones = QUALITIES[quality];

    // Bass: roots on the downbeats; battle walks them in eighths.
    if(inBar === 0 || inBar === 8 || (cfg.kick && inBar % 4 === 2)){
      voice(midi(root - 12), t, stepLen * 3.4, 'sine', cfg.bassLevel);
    }

    // Arpeggio: the chord climbed one note at a time, forever.
    if(inBar % cfg.arpEvery === 0){
      const tone = tones[(pos / cfg.arpEvery | 0) % tones.length];
      voice(midi(root + 12 + tone), t, stepLen * 1.8, 'triangle', cfg.arpLevel);
    }

    // Lead.
    for(const [at, note, len] of cfg.lead){
      if(at === pos) voice(midi(note), t, stepLen * len * 0.95, cfg.leadType, cfg.leadLevel);
    }

    // Percussion.
    if(cfg.brush && (inBar === 4 || inBar === 12)) hit(t, 0.08, 0.05, 5200);
    if(cfg.kick){
      if(inBar % 4 === 0) voice(120, t, 0.1, 'sine', 0.16, 45);
      if(inBar === 4 || inBar === 12) hit(t, 0.1, 0.1, 1800);
      if(inBar % 2 === 1) hit(t, 0.03, 0.03, 7000);
    }
  }

  function pump(){
    const stepLen = 60 / song.bpm / 4;
    while(nextTime < ctx.currentTime + 0.12){
      const swing = (step % 2 === 1) ? song.swing * stepLen : 0;
      scheduleStep(step, nextTime + swing);
      step += 1;
      nextTime += stepLen;
    }
  }

  function play(name){
    if(songName === name) return;
    if(!ctx) { songName = name; song = SONGS[name] || null; return; }  // starts on first gesture
    songName = name;
    song = SONGS[name] || null;
    clearInterval(timer);
    timer = null;
    if(!song) return;
    step = 0;
    nextTime = ctx.currentTime + 0.05;
    timer = setInterval(() => pump(), 40);
  }

  /* Called from the first user gesture: builds the context and starts
     whatever play() was asked for while the page had no audio yet. */
  function unlock(){
    ensure();
    if(song && !timer){
      step = 0;
      nextTime = ctx.currentTime + 0.05;
      timer = setInterval(() => pump(), 40);
    }
  }

  function stop(){
    clearInterval(timer);
    timer = null;
    song = null;
    songName = null;
  }

  function setMuted(next){
    muted = !!next;
    try{ localStorage.setItem('gv-muted', muted ? '1' : '0'); }catch{ /* fine */ }
    if(bus) bus.gain.value = muted ? 0 : 0.5;
  }

  /* ---- sound effects ---------------------------------------------------- */

  /* Keyed by the fx events the room emits, plus a few client-side moments.
     Short, quiet, and layered over the music bus so the mute covers both. */
  const SFX = {
    fireball(t){ hit(t, 0.28, 0.14, 900, 'bandpass'); voice(720, t, 0.3, 'sawtooth', 0.07, 110); },
    arc(t){ voice(1800, t, 0.12, 'square', 0.05, 2600); voice(900, t + 0.05, 0.1, 'square', 0.05, 300); },
    strike(t){ hit(t, 0.07, 0.12, 2600); voice(220, t + 0.02, 0.08, 'triangle', 0.06, 140); },
    hit(t){ voice(150, t, 0.12, 'sine', 0.14, 60); hit(t, 0.06, 0.06, 700, 'lowpass'); },
    heal(t){ [76, 79, 84].forEach((n, i) => voice(midi(n), t + i * 0.07, 0.16, 'sine', 0.06)); },
    ward(t){ voice(midi(64), t, 0.3, 'triangle', 0.07); voice(midi(71), t + 0.02, 0.28, 'triangle', 0.05); },
    regen(t){ [72, 76].forEach((n, i) => voice(midi(n), t + i * 0.09, 0.2, 'sine', 0.05)); },
    gather(t){ voice(midi(84), t, 0.09, 'triangle', 0.07, midi(88)); },
    brew(t){ hit(t, 0.15, 0.05, 1200, 'bandpass'); voice(midi(67), t + 0.05, 0.2, 'sine', 0.06, midi(74)); },
    build(t){ hit(t, 0.05, 0.12, 3000); hit(t + 0.12, 0.05, 0.1, 2400); voice(330, t + 0.12, 0.07, 'square', 0.03); },
    phase(t){ [60, 67, 72].forEach((n, i) => voice(midi(n), t + i * 0.05, 0.4, 'triangle', 0.07)); },
    down(t){ voice(midi(55), t, 0.4, 'triangle', 0.08, midi(43)); },
    won(t){ [60, 64, 67, 72, 76].forEach((n, i) => voice(midi(n), t + i * 0.09, 0.5, 'triangle', 0.07)); },
    lost(t){ [55, 51, 48].forEach((n, i) => voice(midi(n), t + i * 0.22, 0.6, 'triangle', 0.06)); },
  };

  function sfx(name){
    if(muted || !ctx) return;
    const fn = SFX[name];
    if(fn) fn(ctx.currentTime + 0.01);
  }

  /* Is there a sound under this name? The client asks before falling back from
     a card's own sound to its effect kind's, so a card with no entry lands on
     `strike` or `heal` rather than on silence. */
  const has = name => Object.prototype.hasOwnProperty.call(SFX, name);

  return { play, stop, unlock, sfx, has, setMuted, isMuted: () => muted, current: () => songName };
}
