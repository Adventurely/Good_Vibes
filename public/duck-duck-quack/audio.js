/* Duck Duck Quack — music.
 *
 * Synthesised on the fly, the way Good Vibes does it: no file to fetch, a
 * look-ahead scheduler queueing notes a little ahead of the audio clock
 * because `setTimeout` drifts and a beat makes drift obvious immediately.
 * Each level gets its own track, keyed by level id — the park, the warren
 * and the orchard don't feel like the same place, so they shouldn't sound
 * like it either — but all three are built to be busy about it: Lemmings'
 * tunes are what this is chasing, and what makes a tracker loop like that
 * work is a bassline with more going on than the chord tones, not a
 * fuller chord.
 *
 * PARK_SONG: a minor walking down to E, funk-shaped: the bass does not
 * just sit on the root, it hits the root, its octave and its fifth in a
 * syncopated pattern that repeats under every chord, and the lead is one
 * riff transposed to whichever root is under it rather than four different
 * melodies — which is exactly the trick a two-channel tracker used to make
 * eight bars feel like one idea instead of four. WARREN_SONG, ORCHARD_SONG
 * and GROVE_SONG below follow the same eight-bar, call-and-response shape,
 * but differ in tempo, swing, register and waveform on purpose: a tunnel is
 * not a park, an orchard is not either of them, and a level with a goose
 * that does not give up is not any of the three.
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

/* Eight bars, four chords twice through: Am7 - G7 - Fmaj - E7, the classic
 * minor walk-down. The second pass is not a plain repeat, though — a tracker
 * loop that plays note-for-note identical bars a second time announces its
 * own loop point, which is the fastest way for a background track to start
 * sounding like a background track. Three things break that up:
 *
 *   - the lead answers itself. Bars 0-3 play `lead`, the call; bars 4-5
 *     play `leadResponse`, pitched higher and syncopated differently — a
 *     real second phrase, not the same hook moved an octave.
 *   - the chord's own quality gets heard. `bass` and `lead` only ever
 *     needed a bar's root, so QUALITIES — the min7/dom7/maj shape of each
 *     chord — sat in the data and never once reached the speaker. `stabAt`
 *     now plays the *other* notes of that chord (everything but the root,
 *     which the bass already owns) as a short off-beat stab, so an Am7
 *     and an E7 finally sound like different chords rather than different
 *     bass notes under the same lead line.
 *   - the last bar gets a pickup: a short snare roll across its last four
 *     steps, the turnaround a live band would play into bar 1 rather than
 *     just stopping and starting over.
 */
export const PARK_SONG = {
  bpm: 124,
  swing: 0.12,          // a 16th-note shuffle, which is most of what "funky" is
  bars: [
    { chord: [57, 'min7'] }, { chord: [55, 'dom7'] },
    { chord: [53, 'maj'] },  { chord: [52, 'dom7'] },
    { chord: [57, 'min7'], lead: 'response' }, { chord: [55, 'dom7'], lead: 'response' },
    { chord: [53, 'maj'],  lead: 'response' }, { chord: [52, 'dom7'], lead: 'response', fill: true },
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

  // The call: a short hook an octave above the root, syncopated against
  // the bass rather than doubling it — the two only land together on the
  // downbeat.
  lead: [
    [0, 12, 2], [2, 15, 1], [6, 19, 2], [9, 17, 1], [12, 15, 3],
  ],
  // The response: starts on the "and" of beat 1 instead of the downbeat,
  // climbs to a 9th the call never reaches, and resolves down through a
  // passing tone instead of holding — a real answer, not an echo.
  leadResponse: [
    [3, 15, 1], [4, 19, 2], [8, 22, 1], [10, 19, 2], [13, 17, 1], [14, 15, 2],
  ],
  leadType: 'triangle',
  leadCut: 3400,
  leadLevel: 0.08,

  // The stab: every chord tone but the root, on the off-beat, quiet and
  // low-passed — a rhythm-guitar skank sitting between the bass and lead
  // registers, not a pad.
  stabAt: [3, 11],
  stabType: 'sawtooth',
  stabCut: 1100,
  stabLevel: 0.045,

  kickAt: [0, 6, 8, 14],
  snareAt: [4, 12],
  hatAt: [2, 6, 10, 14],
  openHatAt: [15],
};

/* The Warren: underground, mechanical, a digging machine's steady chug
 * rather than a groove. Square wave instead of triangle for a grittier
 * core, heavily low-passed so it reads as gritty-but-warm rather than
 * harsh; a steady four-on-the-floor pulse on the bass root instead of
 * Park's syncopated root/octave/fifth pattern, because a tunnel does not
 * swing. Minor throughout, lower register, barely any swing at all.
 */
export const WARREN_SONG = {
  bpm: 96,
  swing: 0.04,
  bars: [
    { chord: [48, 'min7'] }, { chord: [44, 'maj'] },
    { chord: [51, 'maj'] },  { chord: [46, 'dom7'] },
    { chord: [48, 'min7'], lead: 'response' }, { chord: [44, 'maj'], lead: 'response' },
    { chord: [51, 'maj'],  lead: 'response' }, { chord: [46, 'dom7'], lead: 'response', fill: true },
  ],

  // A steady chug on the root, quarter notes, an octave down — an engine's
  // pulse, not a funk pattern.
  bass: [
    [0, 0, 2], [4, 0, 2], [8, 0, 2], [12, 0, 2],
  ],
  bassType: 'square',
  bassCut: 500,
  bassLevel: 0.14,

  // Sparse, mechanical calls rather than a hook — space is part of the
  // sound of a tunnel.
  lead: [
    [0, 12, 3], [8, 12, 3], [12, 15, 2],
  ],
  leadResponse: [
    [2, 10, 2], [6, 12, 1], [10, 17, 2], [13, 15, 1],
  ],
  leadType: 'square',
  leadCut: 1200,
  leadLevel: 0.06,

  // One stab per bar, not two — sparser than Park across the board.
  stabAt: [7],
  stabType: 'square',
  stabCut: 900,
  stabLevel: 0.035,

  kickAt: [0, 4, 8, 12],
  snareAt: [8],
  hatAt: [2, 10],
  openHatAt: [],
};

/* The Orchard: bright, bouncy, a I-V-vi-IV daylight progression instead of
 * a minor walk-down. Triangle bass keeps Park's warmth but skips through
 * root-octave-fifth-octave instead of a syncopated funk pattern; the lead
 * sits an octave higher and the filters open up (both cutoffs well above
 * Park's) for a lighter, more open top end; the hats are dense and lively
 * rather than sparse, for a daytime-orchard feel instead of a park-at-dusk
 * one.
 */
export const ORCHARD_SONG = {
  bpm: 132,
  swing: 0.18,
  bars: [
    { chord: [60, 'maj'] },  { chord: [55, 'dom7'] },
    { chord: [57, 'min7'] }, { chord: [53, 'maj'] },
    { chord: [60, 'maj'], lead: 'response' },  { chord: [55, 'dom7'], lead: 'response' },
    { chord: [57, 'min7'], lead: 'response' }, { chord: [53, 'maj'], lead: 'response', fill: true },
  ],

  // A skipping root-octave-fifth-octave bounce, eight hits a bar — livelier
  // and denser than Park's syncopated funk pattern.
  bass: [
    [0, 0, 1], [2, 12, 1], [4, 7, 1], [6, 12, 1],
    [8, 0, 1], [10, 12, 1], [12, 7, 1], [14, 12, 1],
  ],
  bassType: 'triangle',
  bassCut: 1400,
  bassLevel: 0.15,

  lead: [
    [0, 19, 2], [3, 22, 1], [6, 24, 2], [10, 22, 1], [13, 19, 2],
  ],
  leadResponse: [
    [1, 22, 1], [4, 26, 2], [8, 24, 1], [11, 22, 2], [14, 19, 1],
  ],
  leadType: 'triangle',
  leadCut: 5000,
  leadLevel: 0.075,

  stabAt: [2, 6, 10, 14],
  stabType: 'sawtooth',
  stabCut: 2000,
  stabLevel: 0.04,

  kickAt: [0, 8],
  snareAt: [4, 12],
  hatAt: [0, 2, 4, 6, 8, 10, 12, 14],
  openHatAt: [7, 15],
};

/* The Grove: a goose that does not give up, so the music does not relax
 * either. Sawtooth rather than triangle or square, for the grittiest edge
 * of the four, and the fastest tempo with the tightest swing — driving
 * rather than funky or bouncy or mechanical. i-VII-VI-V7 instead of a plain
 * walk-down: that last chord is real dominant tension aimed back at the
 * first, which the other three songs never reach for, and it is what makes
 * the loop feel like it is chasing something instead of strolling past it.
 */
export const GROVE_SONG = {
  bpm: 140,
  swing: 0.06,
  bars: [
    { chord: [52, 'min7'] }, { chord: [50, 'dom7'] },
    { chord: [48, 'maj'] },  { chord: [47, 'dom7'] },
    { chord: [52, 'min7'], lead: 'response' }, { chord: [50, 'dom7'], lead: 'response' },
    { chord: [48, 'maj'],  lead: 'response' }, { chord: [47, 'dom7'], lead: 'response', fill: true },
  ],

  // A driving eighth-note pulse, root and fifth only — urgency, not funk.
  bass: [
    [0, 0, 1], [2, 0, 1], [4, 7, 1], [6, 0, 1],
    [8, 0, 1], [10, 0, 1], [12, 7, 1], [14, 0, 1],
  ],
  bassType: 'sawtooth',
  bassCut: 900,
  bassLevel: 0.13,

  // Short, repeated alarm-calls rather than a melody that resolves —
  // a lead that keeps circling back on itself instead of going anywhere.
  lead: [
    [0, 14, 1], [1, 14, 1], [6, 17, 1], [7, 17, 1], [11, 19, 2],
  ],
  leadResponse: [
    [2, 17, 1], [3, 17, 1], [8, 19, 1], [9, 19, 1], [12, 22, 2],
  ],
  leadType: 'sawtooth',
  leadCut: 2400,
  leadLevel: 0.06,

  stabAt: [5, 9, 13],
  stabType: 'sawtooth',
  stabCut: 1300,
  stabLevel: 0.04,

  kickAt: [0, 3, 6, 8, 11, 14],
  snareAt: [4, 12],
  hatAt: [2, 6, 10, 14],
  openHatAt: [15],
};

export const SONGS = { park: PARK_SONG, warren: WARREN_SONG, orchard: ORCHARD_SONG, grove: GROVE_SONG };

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
    const barCfg = cfg.bars[bar];
    const [root, quality] = barCfg.chord;

    for(const [at, semis, len] of cfg.bass){
      if(at === inBar) voice(midi(root - 12 + semis), t, stepLen * len * 0.92, cfg.bassType, cfg.bassLevel, null, cfg.bassCut);
    }

    const leadPattern = barCfg.lead === 'response' ? cfg.leadResponse : cfg.lead;
    for(const [at, semis, len] of leadPattern){
      if(at === inBar) voice(midi(root + semis), t, stepLen * len * 0.85, cfg.leadType, cfg.leadLevel, null, cfg.leadCut);
    }

    // The chord's own shape, finally audible — see the header note above.
    if(cfg.stabAt && cfg.stabAt.includes(inBar)){
      for(const interval of QUALITIES[quality]){
        if(interval === 0) continue; // the bass already has the root
        voice(midi(root + interval), t, stepLen * 0.9, cfg.stabType, cfg.stabLevel, null, cfg.stabCut);
      }
    }

    if(cfg.kickAt.includes(inBar)) voice(112, t, 0.09, 'sine', 0.2, 42);
    if(cfg.snareAt.includes(inBar)) hit(t, 0.09, 0.13, 2200);
    if(cfg.hatAt.includes(inBar)) hit(t, 0.035, 0.05, 8500);
    if(cfg.openHatAt.includes(inBar)) hit(t, 0.15, 0.045, 7500);
    // The turnaround: a quick pickup into the loop's start, on the last bar only.
    if(barCfg.fill && inBar >= 12) hit(t, 0.05, 0.085, 2600);
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
    // "Quack quack" — one call on its own reads as a blip; a duck actually
    // says it twice, the second call close on the heel of the first rather
    // than evenly spaced, and a little quieter and shorter — an echo of the
    // first, not a repeat of it.
    quack(t){
      // A short puff of breath on the attack, under the note rather than
      // in front of it — this is the air, not the voice.
      hit(t, 0.03, 0.05, 1400, 'bandpass');
      quackSyllable(t, 0.18, 0.6);

      const t2 = t + 0.19;
      hit(t2, 0.025, 0.04, 1400, 'bandpass');
      quackSyllable(t2, 0.15, 0.48);
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
