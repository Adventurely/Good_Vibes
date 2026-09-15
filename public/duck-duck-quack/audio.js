/* Duck Duck Quack — music.
 *
 * Synthesised on the fly, the way Good Vibes does it: no file to fetch, a
 * look-ahead scheduler queueing notes a little ahead of the audio clock
 * because `setTimeout` drifts and a beat makes drift obvious immediately.
 * This game gets one track rather than three — one level does not need a
 * different mood for a title screen than it needs for itself — but it is
 * built to be busy about it: Lemmings' tunes are what this is chasing,
 * and what makes a tracker loop like that work is a bassline with more
 * going on than the chord tones, not a fuller chord.
 *
 * A minor walking down to E, funk-shaped: the bass does not just sit on the
 * root, it hits the root, its octave and its fifth in a syncopated pattern
 * that repeats under every chord, and the lead is one riff transposed to
 * whichever root is under it rather than four different melodies — which is
 * exactly the trick a two-channel tracker used to make eight bars feel like
 * one idea instead of four.
 *
 * Nothing plays until a user gesture, because autoplay policy decides that,
 * not us. The mute choice persists per browser, under its own key so it
 * cannot collide with any other game's.
 */

const midi = n => 440 * Math.pow(2, (n - 69) / 12);

/* ------------------------------------------------------------------ song --- */

const QUALITIES = {
  maj:  [0, 4, 7],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
};

/* Eight bars, four of them repeated: Am7 - G7 - Fmaj - E7, the classic minor
 * walk-down, twice through. `bass` and `lead` are one riff each, written once
 * as [step, semitones off the bar's root, length in steps] and replayed under
 * every bar at that bar's own root — the whole reason four chords reads as one
 * groove instead of four unrelated bars.
 */
export const PARK_SONG = {
  bpm: 124,
  swing: 0.12,          // a 16th-note shuffle, which is most of what "funky" is
  bars: [
    { chord: [57, 'min7'] }, { chord: [55, 'dom7'] },
    { chord: [53, 'maj'] },  { chord: [52, 'dom7'] },
    { chord: [57, 'min7'] }, { chord: [55, 'dom7'] },
    { chord: [53, 'maj'] },  { chord: [52, 'dom7'] },
  ],

  // Root, root, octave, root, fifth, root, octave, root — the "on the one"
  // shape under all eight bars, an octave below the chord's own root.
  bass: [
    [0, 0, 3], [3, 0, 1], [4, 12, 2], [6, 0, 2],
    [8, 7, 2], [10, 0, 1], [12, 12, 2], [14, 0, 2],
  ],
  /* Triangle rather than sawtooth or square, and both filtered — a saw and
     a square are the two waveforms that read as "video game" before a
     single note plays, because they carry every harmonic at full strength;
     a triangle only carries the odd ones and carries them quietly, which is
     most of the difference between a chiptune and a synth bass. */
  bassType: 'triangle',
  bassCut: 700,          // low-passed for a rounder, less buzzy low end
  bassLevel: 0.17,

  // A short hook an octave above the root, syncopated against the bass
  // rather than doubling it — the two only land together on the downbeat.
  lead: [
    [0, 12, 2], [2, 15, 1], [6, 19, 2], [9, 17, 1], [12, 15, 3],
  ],
  leadType: 'triangle',
  leadCut: 3400,
  leadLevel: 0.08,

  kickAt: [0, 6, 8, 14],
  snareAt: [4, 12],
  hatAt: [2, 6, 10, 14],
  openHatAt: [15],
};

export const SONGS = { park: PARK_SONG };

/* ------------------------------------------------------------------ engine --- */

export function createAudio(){
  let ctx = null, bus = null;
  let timer = null, step = 0, nextTime = 0;
  let song = null, songName = null;
  let muted = false;
  try{ muted = localStorage.getItem('ddq-muted') === '1'; }catch{ /* private mode */ }

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

  /* One note. `cut` is optional — a low-pass cutoff that gives the funk bass
     its rounded, plucked shape instead of a raw sawtooth buzz. */
  function voice(freq, t, dur, type, vol, glideTo, cut){
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if(glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = o;
    if(cut){
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cut;
      f.Q.value = 1.2;
      o.connect(f);
      out = f;
    }
    out.connect(g).connect(bus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /* Filtered noise: kick's click aside, every drum here is one of these.
     `sweepTo` is optional — a filter that opens or closes as the noise
     plays, rather than sitting at one fixed cutoff, which is what turns a
     click into a puff of air with a shape to it. */
  function hit(t, dur, vol, cut, type = 'highpass', sweepTo){
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type;
    f.frequency.setValueAtTime(cut, t);
    if(sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
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
    const [root] = cfg.bars[bar].chord;

    for(const [at, semis, len] of cfg.bass){
      if(at === inBar) voice(midi(root - 12 + semis), t, stepLen * len * 0.92, cfg.bassType, cfg.bassLevel, null, cfg.bassCut);
    }
    for(const [at, semis, len] of cfg.lead){
      if(at === inBar) voice(midi(root + semis), t, stepLen * len * 0.85, cfg.leadType, cfg.leadLevel, null, cfg.leadCut);
    }

    if(cfg.kickAt.includes(inBar)) voice(112, t, 0.09, 'sine', 0.2, 42);
    if(cfg.snareAt.includes(inBar)) hit(t, 0.09, 0.13, 2200);
    if(cfg.hatAt.includes(inBar)) hit(t, 0.035, 0.05, 8500);
    if(cfg.openHatAt.includes(inBar)) hit(t, 0.15, 0.045, 7500);
  }

  function pump(){
    const stepLen = 60 / song.bpm / 4;
    while(nextTime < ctx.currentTime + 0.12){
      // Swing on the off 16th only, which is what keeps a shuffle from
      // turning into a slower straight beat.
      const swing = (step % 2 === 1) ? song.swing * stepLen : 0;
      scheduleStep(step, nextTime + swing);
      step += 1;
      nextTime += stepLen;
    }
  }

  function play(name){
    if(songName === name) return;
    if(!ctx){ songName = name; song = SONGS[name] || null; return; } // starts on first gesture
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
    try{ localStorage.setItem('ddq-muted', muted ? '1' : '0'); }catch{ /* fine */ }
    if(bus) bus.gain.value = muted ? 0 : 0.5;
  }

  /* ---- sound effects ------------------------------------------------ */

  /* A quack, built the way a quack actually works rather than as one blip —
   * which is what an earlier pass of this was, and it sounded like a
   * microwave because that is what a bare sawtooth through one filter is.
   *
   * Three formants in parallel rather than one bandpass: a single filter
   * gives a nasal "wah", but a bank of them is what gives a sound a throat.
   * The middle of the note dips and comes back up rather than holding flat,
   * which is what makes it land as "qua-ack" — two syllables of one call —
   * instead of one flat blast. And a slow warble on the frequency supplies
   * the rasp; a perfectly steady pitch is a synth patch, never an animal.
   */
  const QUACK_FORMANTS = [[850, 7, 1], [1900, 9, 0.55], [3000, 11, 0.28]];

  function quackSyllable(t, dur, vol){
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(430, t);
    o.frequency.exponentialRampToValueAtTime(590, t + 0.022);
    o.frequency.exponentialRampToValueAtTime(240, t + dur);

    // The rasp: a slow warble either side of the note, not enough to read
    // as vibrato, just enough to stop it sitting perfectly still.
    const rasp = ctx.createOscillator();
    rasp.type = 'sine';
    rasp.frequency.value = 50;
    const raspDepth = ctx.createGain();
    raspDepth.gain.value = 26;
    rasp.connect(raspDepth).connect(o.frequency);

    // The articulation: a dip a third of the way through and back up. This
    // is the "qu-ack" split, not the pitch bend above — that shapes the
    // note, this shapes the syllable.
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.32, t + dur * 0.32);
    env.gain.exponentialRampToValueAtTime(1, t + dur * 0.48);
    env.gain.setValueAtTime(1, t + dur * 0.62);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const out = ctx.createGain();
    out.gain.value = vol;
    env.connect(out).connect(bus);

    // Each formant falls with the pitch as the bill closes, same as the
    // note itself, just centred at a different resonance.
    for(const [freq, q, level] of QUACK_FORMANTS){
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(freq, t);
      band.frequency.exponentialRampToValueAtTime(freq * 0.62, t + dur);
      band.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = level;
      o.connect(band).connect(fg).connect(env);
    }

    o.start(t); o.stop(t + dur + 0.02);
    rasp.start(t); rasp.stop(t + dur + 0.02);
  }

  /* The duckling that just made it.
   *
   * Loud on purpose, relative to the music bed it plays over (bassLevel
   * 0.17, leadLevel 0.08) — this is the one sound in the game that means
   * "a duckling just made it home", and it was getting lost under the
   * backing track instead of landing as a payoff.
   */
  const SFX = {
    quack(t){
      // A short puff of breath on the attack, under the note rather than
      // in front of it — this is the air, not the voice.
      hit(t, 0.03, 0.05, 1400, 'bandpass');
      quackSyllable(t, 0.22, 0.6);
    },

    /* The duckling that didn't — two sounds, not one, matching the poof it
     * plays alongside (see art.js): a puff of air for the burst of down,
     * and a soft knock underneath for the landing. This can fire up to
     * nine times in one run, so both halves stay quiet — it has to read as
     * a small shame, not a punishment, or it turns grating fast.
     */
    lost(t){
      // The puff: noise swept bright to dark as it settles, rather than
      // sitting at one muffled cutoff the whole time.
      hit(t, 0.2, 0.17, 2400, 'bandpass', 420);
      // The thump: a low sine falling under the puff, for the landing
      // rather than for the feathers.
      voice(150, t, 0.12, 'sine', 0.14, 62, 300);
    },
  };

  function sfx(name){
    if(muted || !ctx) return;
    const fn = SFX[name];
    if(fn) fn(ctx.currentTime + 0.01);
  }

  /* Whether the context is actually producing sound, as opposed to merely
     existing. iOS Safari in particular can leave a freshly-created context
     `suspended` even after `resume()` is called from inside a gesture
     handler — the call does not throw, it just does not always take on the
     first try, which is why the page has to keep listening for a gesture
     rather than assuming the first one worked. */
  const isRunning = () => Boolean(ctx) && ctx.state === 'running';

  return { play, stop, unlock, sfx, setMuted, isMuted: () => muted, isRunning, current: () => songName };
}
