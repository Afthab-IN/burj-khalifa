import { BPM, SHOW_LENGTH } from './fountain';
import { mulberry32 } from './noise';

// An original piece for the fountain, written in code: D Hijaz (D Eb F# G A Bb C),
// a pad, an oud-like pluck, darbuka-style drums and a string swell for the finale.
// Its sections line up with the fountain choreography (same BPM, same timeline).
const BEAT = 60 / BPM;
const D = 146.83; // D3
const HIJAZ = [0, 1, 4, 5, 7, 8, 10]; // semitones
const hz = (deg: number, oct = 0) => {
  const o = Math.floor(deg / 7);
  const step = HIJAZ[((deg % 7) + 7) % 7];
  return D * Math.pow(2, (step + 12 * (o + oct)) / 12);
};

export class Music {
  ctx: AudioContext | null = null;
  out!: GainNode;
  private noise!: AudioBuffer;
  private playing: AudioScheduledSourceNode[] = [];
  enabled = true;

  private ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.enabled ? 0.7 : 0;
    const verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    this.out.connect(ctx.destination);
    this.out.connect(verb).connect(wet).connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return ctx;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.ctx) this.out.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, 0.15);
  }

  stop() {
    for (const s of this.playing) { try { s.stop(); } catch { /* already stopped */ } }
    this.playing = [];
  }

  /** Schedule the whole piece starting now. */
  play() {
    const ctx = this.ensure();
    this.stop();
    const t0 = ctx.currentTime + 0.05;
    const rnd = mulberry32(2026);
    const bars = Math.ceil(SHOW_LENGTH / (BEAT * 4));
    // chord roots (scale degrees) per bar: i - vii - VI - V, the Hijaz cadence
    const prog = [0, -1, -2, -3];
    for (let bar = 0; bar < bars; bar++) {
      const tb = t0 + bar * 4 * BEAT;
      const sec = (tb - t0);
      const root = prog[bar % 4];
      // pad
      const padGain = sec < 6 ? 0.05 : sec < 44 ? 0.07 : 0.1;
      for (const d of [0, 2, 4]) this.pad(hz(root + d, -1), tb, 4 * BEAT, padGain);
      if (sec >= 44) for (const d of [0, 2, 4, 7]) this.strings(hz(root + d, 0), tb, 4 * BEAT, 0.035 + (sec - 44) * 0.004);
      // drums from bar 2: maqsum (D T _ T D _ T _)
      if (sec >= 6) {
        const pat = ['D', 'T', '', 'T', 'D', '', 'T', ''];
        for (let i = 0; i < 8; i++) {
          const t = tb + i * BEAT * 0.5;
          if (pat[i] === 'D') this.doum(t, sec > 36 ? 0.9 : 0.7);
          else if (pat[i] === 'T') this.tek(t, 0.35);
          else if (sec > 18 && rnd() < 0.5) this.tek(t, 0.15);
        }
      }
      // pluck melody: wanders the scale, resolves to the chord root each bar
      if (sec >= 2) {
        let deg = root + 7;
        const notes = sec < 18 ? 4 : 8;
        for (let i = 0; i < notes; i++) {
          const t = tb + i * (4 * BEAT / notes);
          deg += [-1, 1, 2, -2, 1, -1, 0][Math.floor(rnd() * 7)];
          if (i === notes - 1) deg = root + 7;
          this.pluck(hz(deg, 1), t, sec > 26 ? 0.16 : 0.12);
        }
      }
    }
    // final hit
    const end = t0 + SHOW_LENGTH;
    this.doum(end, 1);
    for (const d of [0, 4, 7]) this.strings(hz(d, 0), end, 2.5, 0.08);
  }

  private track<T extends AudioScheduledSourceNode>(n: T) { this.playing.push(n); return n; }

  private pad(f: number, t: number, dur: number, g: number) {
    const ctx = this.ctx!;
    for (const det of [-6, 6]) {
      const o = this.track(ctx.createOscillator()); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const a = ctx.createGain();
      a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(g, t + 0.6); a.gain.setValueAtTime(g, t + dur - 0.3); a.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.4);
      o.connect(lp).connect(a).connect(this.out); o.start(t); o.stop(t + dur + 0.5);
    }
  }

  private strings(f: number, t: number, dur: number, g: number) {
    const ctx = this.ctx!;
    const o = this.track(ctx.createOscillator()); o.type = 'sawtooth'; o.frequency.value = f;
    const vib = ctx.createOscillator(); vib.frequency.value = 5.2; const vg = ctx.createGain(); vg.gain.value = f * 0.006;
    vib.connect(vg).connect(o.frequency); vib.start(t); vib.stop(t + dur + 0.6); this.track(vib);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    const a = ctx.createGain();
    a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(g, t + 0.4); a.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5);
    o.connect(lp).connect(a).connect(this.out); o.start(t); o.stop(t + dur + 0.6);
  }

  private pluck(f: number, t: number, g: number) {
    const ctx = this.ctx!;
    const o = this.track(ctx.createOscillator()); o.type = 'triangle'; o.frequency.value = f;
    const o2 = this.track(ctx.createOscillator()); o2.type = 'square'; o2.frequency.value = f * 2.003;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 3; bp.Q.value = 1.2;
    const a = ctx.createGain(); const a2 = ctx.createGain(); a2.gain.value = 0.15;
    a.gain.setValueAtTime(g, t); a.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(a); o2.connect(a2).connect(bp).connect(a); a.connect(this.out);
    o.start(t); o.stop(t + 0.8); o2.start(t); o2.stop(t + 0.8);
  }

  private doum(t: number, g: number) {
    const ctx = this.ctx!;
    const o = this.track(ctx.createOscillator()); o.type = 'sine';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.25);
    const a = ctx.createGain(); a.gain.setValueAtTime(g, t); a.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(a).connect(this.out); o.start(t); o.stop(t + 0.5);
  }

  private tek(t: number, g: number) {
    const ctx = this.ctx!;
    const n = this.track(ctx.createBufferSource()); n.buffer = this.noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 3200; hp.Q.value = 1.5;
    const a = ctx.createGain(); a.gain.setValueAtTime(g, t); a.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    n.connect(hp).connect(a).connect(this.out); n.start(t, Math.random() * 0.5); n.stop(t + 0.1);
  }
}
