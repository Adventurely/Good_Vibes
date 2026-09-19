/* Good Vibe Beats — the noise.
 *
 * Every sound here is synthesised on the fly, the way the rest of Good Vibes
 * does it: nothing to fetch, nothing to wait for, and a drum that is ready the
 * first frame the page is. That matters more here than in the other games — a
 * rhythm game whose kick arrives two hundred milliseconds after the finger is
 * a rhythm game that is wrong about everything it then tells you.
 *
 * A drum is an envelope and a filter and not much else. A kick is a sine
 * falling from 160 Hz to 42; a snare is filtered noise with a triangle under
 * it; a clap is the same noise gated four times in thirty milliseconds, which
 * is what makes a clap sound like several hands rather than one. None of this
 * is a sampled kit and none of it is trying to be: it is trying to be legible
 * at a glance, so that six pads sound like six different things on a phone
 * speaker.
 *
 * Client-only, and deliberately so — this file touches `AudioContext` on every
 * line and there is nothing in it a test could sensibly assert. The rules live
 * in content.js, which has no idea any of this exists.
 *
 * --- Everything is scheduled, nothing is played -----------------------------
 *
 * Every function takes an absolute `t` on the audio clock and schedules for
 * then. Nothing here ever plays "now": `setTimeout` drifts by whole
 * milliseconds under load and a listener hears that immediately as a stumble,
 * so the page runs a look-ahead scheduler and hands this file times that are
 * already in the future. The one exception is a pad under a finger, which is
 * scheduled at `currentTime` because the finger has already happened.
 */

let ctx = null, master = null, noiseBuf = null;

/* Made on the first gesture, because autoplay policy decides that, not us. */
export function ensureAudio(){
  if(!ctx){
    const Ctor = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctor({ latencyHint: 'interactive' });

    /* A compressor across the whole thing. Six pads, a bassline and a pad
       chord can all land on the same sixteenth, and without this that sums
       past one and clips — which on a phone speaker is a crack, not a
       drummer. */
    const comp = ctx.createDynamicsCompressor();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp);
    comp.connect(ctx.destination);

    /* One second of noise, made once and looped. Three of the six drums are
       filtered noise, and building a fresh buffer per hit is forty-four
       thousand `Math.random()` calls on the audio thread's critical path. */
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for(let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if(ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export const audioCtx = () => ctx;
export const now = () => ctx ? ctx.currentTime : 0;
export const out = () => master;
export const bus = (gain = 1) => { const g = ctx.createGain(); g.gain.value = gain; g.connect(master); return g; };

/* What the device admits it will take to get a sound out. Used until the
   player calibrates, and it is usually an underestimate — which is why there
   is a calibration screen at all. */
export const reportedLatency = () => ctx ? (ctx.baseLatency || 0) + (ctx.outputLatency || 0) : 0;

/* ------------------------------------------------------------ the pieces */

/* Exponential, never linear, and never to zero: `exponentialRampToValueAtTime`
   throws on a zero target, and a linear fade on a drum tail sounds like
   somebody pulling a fader. */
function env(g, t, peak, decay){
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
}
function noise(t, dur, dest){
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf; s.loop = true;
  s.connect(dest); s.start(t); s.stop(t + dur);
}
function filt(type, freq, q){
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq;
  if(q) f.Q.value = q;
  return f;
}
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

/* ---------------------------------------------------------------- the kit */

export const DRUMS = {
  kick(t, v, dest){
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    env(g, t, 1 * v, 0.4);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.45);
  },
  snare(t, v, dest){
    const f = filt('highpass', 1200), g = ctx.createGain();
    env(g, t, 0.6 * v, 0.2);
    f.connect(g); g.connect(dest); noise(t, 0.25, f);
    // The body under the rattle. Without it a snare is a hi-hat with a long tail.
    const o = ctx.createOscillator(), g2 = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = 190;
    env(g2, t, 0.4 * v, 0.1);
    o.connect(g2); g2.connect(dest); o.start(t); o.stop(t + 0.12);
  },
  hat(t, v, dest){
    const f = filt('highpass', 7500), g = ctx.createGain();
    env(g, t, 0.35 * v, 0.06);
    f.connect(g); g.connect(dest); noise(t, 0.08, f);
  },
  clap(t, v, dest){
    /* Four gates in thirty milliseconds, then a tail. A clap is several hands
       not quite together, and one envelope on noise is a hiss. */
    const f = filt('bandpass', 1600, 0.9), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    for(const o of [0, 0.011, 0.022]){
      g.gain.setValueAtTime(0.8 * v, t + o);
      g.gain.exponentialRampToValueAtTime(0.12 * v, t + o + 0.009);
    }
    g.gain.setValueAtTime(0.7 * v, t + 0.031);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    f.connect(g); g.connect(dest); noise(t, 0.25, f);
  },
  tom(t, v, dest){
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.25);
    env(g, t, 0.8 * v, 0.4);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.45);
  },
  crash(t, v, dest){
    const f = filt('highpass', 5000), g = ctx.createGain();
    env(g, t, 0.35 * v, 1.4);
    f.connect(g); g.connect(dest); noise(t, 1.5, f);
  },
};

/* ------------------------------------------------------------- the backing */

export function bass(t, m, dur, dest){
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(m);
  const f = filt('lowpass', 700), g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.45, t + 0.01);
  g.gain.setValueAtTime(0.45, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f); f.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.02);
}

export function keys(t, notes, dur, vol, dest){
  for(const m of notes){
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const o = ctx.createOscillator(); o.frequency.value = mtof(m);
    // An octave above at a fifth of the level, which is the cheapest way to
    // make a sine sound like something with a hammer in it.
    const o2 = ctx.createOscillator(); o2.frequency.value = mtof(m) * 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.22;
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(dest);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
}

export function shaker(t, v, dest){
  const f = filt('highpass', 6000), g = ctx.createGain();
  env(g, t, 0.07 * v, 0.04);
  f.connect(g); g.connect(dest); noise(t, 0.06, f);
}

/* The metronome. A square rather than a sine, because a click has to cut
   through a full band mix without being loud, and a sine at low level under a
   bassline is inaudible exactly when it is needed. */
export function click(t, accent, vol, dest){
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = accent ? 1600 : 1050;
  env(g, t, vol, 0.03);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.05);
}

/* ------------------------------------------------------------- a whole song
 *
 * Builds the event list for one of content.js's synth tracks. Returned rather
 * than scheduled, because the page owns the clock and the look-ahead: this file
 * knows what a bar of Funk world sounds like and nothing at all about when it
 * is going to be played.
 */
export function trackEvents(track, t0, dest){
  const spb = 60 / track.bpm, bar = spb * track.beatsPerBar, step = spb / 4;
  const events = [];
  for(let i = 0; i < track.bars; i++){
    const bt = t0 + i * bar, ci = i % track.roots.length;
    for(const [s, m, d] of track.bass(track.roots[ci])){
      events.push({ t: bt + s * step, fn: t => bass(t, m, d * step, dest) });
    }
    for(const [s, d, v] of track.keys){
      events.push({ t: bt + s * step, fn: t => keys(t, track.chords[ci], d * step, v, dest) });
    }
    // Eighth-note shaker, accented off the beat: it marks the "and" without
    // marking it so hard that the player is only ever copying it.
    for(let s = 0; s < 16; s += 2){
      events.push({ t: bt + s * step, fn: t => shaker(t, s % 4 === 0 ? 0.6 : 1, dest) });
    }
  }
  // One last chord so the song stops rather than being cut off.
  events.push({ t: t0 + track.bars * bar, fn: t => keys(t, track.chords[0], bar, 0.06, dest) });
  return events;
}
