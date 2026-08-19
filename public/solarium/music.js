/* Save Solarium — background music.
 *
 * Synthesised on the fly, like the sound effects: no files to fetch and no
 * loop to wait on. A small look-ahead scheduler queues notes against the audio
 * clock rather than setTimeout, because timers drift and music makes drift
 * extremely obvious.
 *
 * The progression brightens or darkens by stage — the Glasshouse Quarter is a
 * major key with the arpeggio up front, the Extractor Yard is lower, minor and
 * heavier on the drums.
 */

const BPM = 116;
const STEP = 60 / BPM / 4;          // sixteenth notes
const LOOKAHEAD = 0.12;             // schedule this far ahead of the clock

const midi = n => 440 * Math.pow(2, (n - 69) / 12);

/* Four bars per stage. Each entry is [rootMidi, thirdOffset] — a minor third
   is what makes the last stage feel like the sun is going out. */
const STAGES = [
  { name: 'bright', chords: [[60, 4], [55, 4], [57, 3], [53, 4]], arp: 0.09, drums: 0.5, bass: 0.10 },
  { name: 'warm',   chords: [[60, 4], [57, 3], [53, 4], [55, 4]], arp: 0.09, drums: 0.6, bass: 0.11 },
  { name: 'tense',  chords: [[57, 3], [53, 4], [60, 4], [55, 4]], arp: 0.08, drums: 0.7, bass: 0.12 },
  { name: 'boss',   chords: [[45, 3], [41, 4], [48, 4], [40, 4]], arp: 0.07, drums: 0.9, bass: 0.14 }
];

export function createMusic(getCtx){
  let timer = null, step = 0, nextTime = 0, stage = 0, bus = null, playing = false;

  function ensureBus(ctx){
    if(bus) return bus;
    bus = ctx.createGain();
    bus.gain.value = 0.5;
    bus.connect(ctx.destination);
    return bus;
  }

  function voice(ctx, freq, t, dur, type, vol, glideTo){
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if(glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ensureBus(ctx));
    o.start(t); o.stop(t + dur + 0.02);
  }

  function hit(ctx, t, dur, vol, cut){
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = cut;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(ensureBus(ctx));
    src.start(t);
  }

  function scheduleStep(ctx, s, t){
    const cfg = STAGES[Math.min(stage, STAGES.length - 1)];
    const bar = Math.floor(s / 16) % cfg.chords.length;
    const [root, third] = cfg.chords[bar];
    const inBar = s % 16;

    // Bass on the downbeat and the and-of-three: enough to walk, not to crowd.
    if(inBar === 0 || inBar === 6 || inBar === 10)
      voice(ctx, midi(root - 12), t, STEP * 3.2, 'sawtooth', cfg.bass);

    // Arpeggio: root, third, fifth, octave on eighths.
    if(inBar % 2 === 0){
      const tones = [root, root + third, root + 7, root + 12];
      const note = tones[(s / 2) % tones.length];
      voice(ctx, midi(note), t, STEP * 1.6, 'triangle', cfg.arp);
    }

    // A soft pad holds the chord under everything, once a bar.
    if(inBar === 0){
      voice(ctx, midi(root), t, STEP * 14, 'sine', 0.045);
      voice(ctx, midi(root + third), t, STEP * 14, 'sine', 0.032);
      voice(ctx, midi(root + 7), t, STEP * 14, 'sine', 0.028);
    }

    // Kit.
    if(inBar === 0 || inBar === 8) voice(ctx, 140, t, 0.16, 'sine', 0.16 * cfg.drums, 46);
    if(inBar === 4 || inBar === 12) hit(ctx, t, 0.14, 0.10 * cfg.drums, 1200);
    if(inBar % 2 === 0) hit(ctx, t, 0.03, 0.03 * cfg.drums, 6000);
  }

  function pump(){
    const ctx = getCtx();
    if(!ctx) return;
    while(nextTime < ctx.currentTime + LOOKAHEAD){
      scheduleStep(ctx, step, nextTime);
      nextTime += STEP;
      step = (step + 1) % (16 * 4);
    }
  }

  return {
    get playing(){ return playing; },

    start(){
      const ctx = getCtx();
      if(!ctx || playing) return;
      playing = true;
      step = 0;
      nextTime = ctx.currentTime + 0.08;
      ensureBus(ctx).gain.setTargetAtTime(0.5, ctx.currentTime, 0.4);
      pump();
      timer = setInterval(pump, 25);
    },

    stop(){
      playing = false;
      if(timer) clearInterval(timer);
      timer = null;
      const ctx = getCtx();
      // Fade rather than cut; a hard stop mid-note clicks.
      if(ctx && bus) bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.15);
    },

    setStage(n){ stage = Math.max(0, Math.min(STAGES.length - 1, n | 0)); },
    get stageName(){ return STAGES[Math.min(stage, STAGES.length - 1)].name; }
  };
}
