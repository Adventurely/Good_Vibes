/* Orbital Trader — music.
 *
 * Synthesised on the fly, the way the other games here do it: no file to
 * fetch, nothing to buffer, and a look-ahead scheduler queueing notes a little
 * ahead of the audio clock, because `setInterval` drifts and a beat makes
 * drift obvious in seconds.
 *
 * Two tracks, one for each of the two states a ship is ever in:
 *
 *   flight  the open sky. Slow — sixty-six to the minute — and mostly pads:
 *           D major with ninths and a lydian lean, sustained chords under a
 *           pentatonic line that spends more of its time resting than playing.
 *           Most of a voyage is a coast, and the tune coasts too. No drums.
 *   port    tied up. Warmer and busier: G major with sixths, a bass that walks
 *           root, fifth and octave under every bar, brushes on the backbeats,
 *           a lilt to it. A market, not an engine room — nothing here is
 *           urgent, because nothing at a port is.
 *
 * Both loop, and a change of state cross-fades from one to the other rather
 * than cutting: a docking is an arrival and it should sound like one, not
 * like a channel changing.
 *
 * Nothing plays until the browser lets it, which is a user gesture on most of
 * them and a matter of policy on all of them. The player's two choices — on
 * or off, and how loud — persist per browser under their own key.
 */

const midi = n => 440 * Math.pow(2, (n - 69) / 12);

/* --------------------------------------------------------------- prefs --- */

/* One key, one small object. The store is a parameter for the same reason it
   is in sim.js: the tests run without a browser, and a private window without
   localStorage gets the defaults rather than an exception. */
export const MUSIC_KEY = 'ot:music:v1';
export const DEFAULT_PREFS = Object.freeze({ on: true, level: 0.7 });

function store(given){
  if(given) return given;
  try{ return globalThis.localStorage ?? null; }catch{ return null; }
}
const clampLevel = v => Math.max(0, Math.min(1, Number(v)));

export function readMusicPrefs(st){
  let raw = null;
  try{ raw = store(st)?.getItem(MUSIC_KEY) ?? null; }catch{ raw = null; }
  if(raw == null) return { ...DEFAULT_PREFS };
  try{
    const p = JSON.parse(raw);
    return {
      on: typeof p?.on === 'boolean' ? p.on : DEFAULT_PREFS.on,
      level: Number.isFinite(Number(p?.level)) ? clampLevel(p.level) : DEFAULT_PREFS.level,
    };
  }catch{ return { ...DEFAULT_PREFS }; }
}

export function writeMusicPrefs(prefs, st){
  const clean = { on: !!prefs.on, level: clampLevel(prefs.level) };
  try{ store(st)?.setItem(MUSIC_KEY, JSON.stringify(clean)); return true; }catch{ return false; }
}

/* --------------------------------------------------------------- songs --- */

/* A song is bars of sixteen steps. The lead is written as [step, midi, len]
   with len in steps and step counted from the top of the loop; the bass as
   [step, semitones above the root, len], counted within each bar, so one
   pattern walks under every chord. `chord` is [root, quality], and the
   quality picks the notes the pad holds for the bar. */

export const QUALITIES = {
  maj:  [0, 4, 7],
  maj6: [0, 4, 7, 9],
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  min7: [0, 3, 7, 10],
  sus:  [0, 5, 7],
};

const FLIGHT_SONG = {
  bpm: 66,
  swing: 0,
  bars: [
    { chord: [50, 'maj9'] }, { chord: [55, 'maj7'] },
    { chord: [59, 'min7'] }, { chord: [57, 'sus'] },
    { chord: [50, 'maj9'] }, { chord: [54, 'min7'] },
    { chord: [55, 'maj7'] }, { chord: [57, 'sus'] },
  ],
  // D major pentatonic, long notes, phrased as a question over the first four
  // bars and an answer over the last four that lands back on the third of D.
  lead: [
    [0, 78, 6], [8, 81, 4], [12, 83, 3],
    [16, 81, 8], [26, 78, 4],
    [32, 74, 6], [40, 76, 4], [44, 78, 3],
    [48, 76, 10], [60, 74, 3],
    [64, 78, 4], [68, 81, 4], [72, 86, 7],
    [80, 85, 4], [84, 83, 4], [88, 81, 6],
    [96, 83, 6], [104, 78, 4], [108, 79, 3],
    [112, 76, 8], [122, 74, 5],
  ],
  leadType: 'triangle',
  leadLevel: 0.075,
  leadCut: 2400,
  pad: { level: 0.05, cut: 900 },
  arpEvery: 4,
  arpLevel: 0.028,
  bass: [[0, 0, 14]],
  bassType: 'sine',
  bassLevel: 0.11,
  brushAt: [],
  tickAt: [],
};

const PORT_SONG = {
  bpm: 96,
  swing: 0.1,
  bars: [
    { chord: [55, 'maj6'] }, { chord: [60, 'maj7'] },
    { chord: [57, 'min7'] }, { chord: [62, 'sus'] },
    { chord: [55, 'maj6'] }, { chord: [52, 'min7'] },
    { chord: [60, 'maj7'] }, { chord: [62, 'sus'] },
  ],
  // A market tune: short cells that climb and fall back, the same idea moved
  // to sit on each chord, with the last bar left open so the loop arrives.
  lead: [
    [0, 79, 2], [2, 83, 2], [4, 86, 3], [8, 83, 2], [10, 81, 2], [12, 79, 3],
    [16, 84, 2], [18, 88, 2], [20, 86, 3], [24, 83, 2], [26, 81, 2], [28, 84, 4],
    [32, 81, 2], [34, 84, 2], [36, 88, 3], [40, 86, 2], [42, 84, 2], [44, 81, 3],
    [48, 79, 2], [50, 81, 2], [52, 86, 4], [58, 81, 2], [60, 78, 3],
    [64, 79, 2], [66, 83, 2], [68, 86, 3], [72, 88, 2], [74, 86, 2], [76, 83, 3],
    [80, 88, 2], [82, 86, 2], [84, 83, 3], [88, 81, 2], [90, 79, 2], [92, 76, 3],
    [96, 84, 3], [100, 88, 2], [102, 86, 2], [104, 83, 4], [110, 81, 2],
    [112, 79, 2], [114, 81, 2], [116, 83, 3], [120, 86, 2], [122, 90, 5],
  ],
  leadType: 'triangle',
  leadLevel: 0.085,
  leadCut: 3200,
  pad: { level: 0.03, cut: 1100 },
  arpEvery: 2,
  arpLevel: 0.038,
  // Root, fifth, root, and an octave pickup into the next bar.
  bass: [[0, 0, 3], [6, 7, 2], [8, 0, 3], [14, 12, 2]],
  bassType: 'triangle',
  bassLevel: 0.13,
  brushAt: [4, 12],
  tickAt: [2, 6, 10, 14],
};

export const SONGS = { flight: FLIGHT_SONG, port: PORT_SONG };

/* -------------------------------------------------------------- engine --- */

/* How loud "all the way up" is. The tracks are mixed to sit under a game
   that is mostly reading; a slider at full should still leave room for the
   player's own room. */
const MASTER = 0.75;
const LOOKAHEAD = 0.14;         // seconds of notes queued ahead of the clock
const FADE = 1.4;               // seconds a track takes to hand over

export function createAudio({ store: st } = {}){
  let ctx = null, bus = null;
  let prefs = readMusicPrefs(st);
  /* The run: one song playing through its own gain node, so a change of song
     can fade the old run out while the new one starts under it. */
  let run = null;
  let wanted = null;              // the song asked for while there was no context yet

  const AudioCtx = () => globalThis.AudioContext || globalThis.webkitAudioContext;
  const busLevel = () => (prefs.on ? prefs.level * MASTER : 0);

  function ensure(){
    if(!ctx){
      const C = AudioCtx();
      if(!C) return null;
      ctx = new C();
      bus = ctx.createGain();
      bus.gain.value = busLevel();
      bus.connect(ctx.destination);
    }
    if(ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  const isRunning = () => !!ctx && ctx.state === 'running';

  /* One note. `cut` is optional — a low-pass that rounds a triangle off into
     something closer to a plucked string than a buzz. */
  function voice(out, freq, t, dur, type, vol, cut){
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if(cut){
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = cut; f.Q.value = 0.9;
      o.connect(f); node = f;
    }
    node.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /* A pad note: the same thing with a slow swell in and a long tail out, so a
     bar's chord arrives like weather rather than like a key press. */
  function pad(out, freq, t, dur, vol, cut){
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    const rise = Math.min(0.8, dur * 0.3), fall = Math.min(1.2, dur * 0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + rise);
    g.gain.setValueAtTime(vol, t + dur - fall);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cut; f.Q.value = 0.6;
    o.connect(f).connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /* Filtered noise: the brushes, and the tick between them. */
  function hit(out, t, dur, vol, cut, type = 'highpass'){
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = cut;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t);
  }

  /* ---- the sequencer ---------------------------------------------------- */

  function scheduleStep(r, s, t){
    const cfg = r.song, out = r.out;
    const totalSteps = cfg.bars.length * 16;
    const pos = s % totalSteps;
    const bar = Math.floor(pos / 16);
    const inBar = pos % 16;
    const stepLen = 60 / cfg.bpm / 4;
    const [root, quality] = cfg.bars[bar].chord;
    const tones = QUALITIES[quality];

    // The pad: the whole chord, held for the bar and a little over it.
    if(inBar === 0 && cfg.pad){
      for(const tone of tones) pad(out, midi(root + tone), t, stepLen * 16 + 0.5, cfg.pad.level, cfg.pad.cut);
    }

    for(const [at, semis, len] of cfg.bass){
      if(at === inBar) voice(out, midi(root - 12 + semis), t, stepLen * len * 0.92, cfg.bassType, cfg.bassLevel, 420);
    }

    // The arpeggio: the chord climbed one note at a time, an octave up.
    if(cfg.arpEvery && inBar % cfg.arpEvery === 0){
      const tone = tones[(pos / cfg.arpEvery | 0) % tones.length];
      voice(out, midi(root + 12 + tone), t, stepLen * cfg.arpEvery * 0.9, 'triangle', cfg.arpLevel, 1800);
    }

    for(const [at, note, len] of cfg.lead){
      if(at === pos) voice(out, midi(note), t, stepLen * len * 0.92, cfg.leadType, cfg.leadLevel, cfg.leadCut);
    }

    if(cfg.brushAt.includes(inBar)) hit(out, t, 0.09, 0.05, 4800);
    if(cfg.tickAt.includes(inBar)) hit(out, t, 0.03, 0.022, 8000);
  }

  function pump(r){
    const stepLen = 60 / r.song.bpm / 4;
    while(r.nextTime < ctx.currentTime + LOOKAHEAD){
      const swing = (r.step % 2 === 1) ? r.song.swing * stepLen : 0;
      scheduleStep(r, r.step, r.nextTime + swing);
      r.step += 1;
      r.nextTime += stepLen;
    }
  }

  function startRun(name){
    const song = SONGS[name];
    if(!song) return null;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.exponentialRampToValueAtTime(1, ctx.currentTime + (run ? FADE : 0.3));
    out.connect(bus);
    const r = { name, song, out, step: 0, nextTime: ctx.currentTime + 0.05, timer: null };
    r.timer = setInterval(() => pump(r), 40);
    return r;
  }

  function endRun(r, fade = FADE){
    if(!r) return;
    clearInterval(r.timer);
    r.timer = null;
    const now = ctx.currentTime;
    r.out.gain.cancelScheduledValues(now);
    r.out.gain.setValueAtTime(Math.max(0.0001, r.out.gain.value), now);
    r.out.gain.exponentialRampToValueAtTime(0.0001, now + fade);
    /* Notes already queued ring on into the fade; the node goes once they
       have nowhere left to go. */
    setTimeout(() => { try{ r.out.disconnect(); }catch{ /* already gone */ } }, (fade + 3) * 1000);
  }

  /* ---- what the page calls ---------------------------------------------- */

  /* Ask for a song by name. With no context yet — before the first gesture,
     or with the music switched off — it is only remembered, and starts when
     there is one. Asking for the song already playing is a no-op, so the
     page can call this every frame it likes. */
  function play(name){
    wanted = name;
    if(!ctx || !prefs.on) return;
    if(run?.name === name) return;
    const old = run;
    run = startRun(name);
    endRun(old);
  }

  /* From a user gesture: builds the context and starts whatever play() asked
     for while there was nothing to play it through. No-ops once running, so
     it is safe to hang off every gesture there is. */
  function unlock(){
    if(!prefs.on) return;
    if(!ensure()) return;
    if(wanted && !run) play(wanted);
  }

  function stop(){
    if(run) endRun(run, 0.2);
    run = null;
    wanted = null;
  }

  /* The tab going away and coming back. A hidden tab's timers are throttled
     to once a second, a long way past the look-ahead, so the music would
     stutter in the background rather than play; and the game's own clock
     stops when the tab is hidden anyway. Suspending the context stops the
     clock the scheduler works against, so it simply picks up where it was. */
  function hidden(isHidden){
    if(!ctx) return;
    if(isHidden) ctx.suspend().catch(() => {});
    else if(prefs.on) ctx.resume().catch(() => {});
  }

  function applyBus(){
    if(!bus) return;
    bus.gain.setTargetAtTime(busLevel(), ctx.currentTime, 0.05);
  }

  function setOn(on){
    prefs = { ...prefs, on: !!on };
    writeMusicPrefs(prefs, st);
    if(!prefs.on){
      if(run) endRun(run, 0.4);
      run = null;
      applyBus();
      return;
    }
    if(ctx){
      applyBus();
      if(wanted) play(wanted);
    }
    else unlock();
  }

  function setLevel(level){
    prefs = { ...prefs, level: clampLevel(level) };
    writeMusicPrefs(prefs, st);
    applyBus();
  }

  return {
    play, stop, unlock, hidden,
    setOn, setLevel,
    isOn: () => prefs.on,
    level: () => prefs.level,
    isRunning,
    current: () => run?.name ?? null,
  };
}
