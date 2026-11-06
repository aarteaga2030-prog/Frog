// Tiny synthesized sound kit (no audio files needed).
export class SFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    // White noise buffer reused by several effects.
    const len = this.ctx.sampleRate * 1.0;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._startHum();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  get t() { return this.ctx.currentTime; }

  _startHum() {
    const c = this.ctx;
    this.humFilter = c.createBiquadFilter();
    this.humFilter.type = 'lowpass';
    this.humFilter.frequency.value = 320;
    this.humGain = c.createGain();
    this.humGain.gain.value = 0;
    this.humOsc1 = c.createOscillator();
    this.humOsc2 = c.createOscillator();
    this.humOsc1.type = 'sawtooth';
    this.humOsc2.type = 'sawtooth';
    this.humOsc1.frequency.value = 72;
    this.humOsc2.frequency.value = 73.6;
    this.humOsc1.connect(this.humFilter);
    this.humOsc2.connect(this.humFilter);
    this.humFilter.connect(this.humGain);
    this.humGain.connect(this.master);
    this.humOsc1.start();
    this.humOsc2.start();
  }

  // on: saber ignited; intensity: 0..1 based on blade speed
  hum(on, intensity = 0) {
    if (!this.ctx) return;
    const now = this.t;
    const g = on ? 0.05 + intensity * 0.06 : 0;
    this.humGain.gain.setTargetAtTime(g, now, 0.05);
    this.humFilter.frequency.setTargetAtTime(320 + intensity * 900, now, 0.04);
    this.humOsc1.frequency.setTargetAtTime(72 + intensity * 30, now, 0.05);
    this.humOsc2.frequency.setTargetAtTime(73.6 + intensity * 31, now, 0.05);
  }

  _noise(dur, { type = 'bandpass', f0 = 800, f1 = 800, q = 1, vol = 0.3, attack = 0.005 } = {}) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const filt = c.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, this.t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), this.t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, this.t);
    g.gain.exponentialRampToValueAtTime(vol, this.t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, this.t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(this.t, Math.random() * 0.5);
    src.stop(this.t + dur + 0.05);
  }

  _tone(dur, { type = 'sine', f0 = 440, f1 = 440, vol = 0.2, attack = 0.005 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, this.t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), this.t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, this.t);
    g.gain.exponentialRampToValueAtTime(vol, this.t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, this.t + dur);
    o.connect(g).connect(this.master);
    o.start(this.t);
    o.stop(this.t + dur + 0.05);
  }

  ignite() {
    if (!this.ctx) return;
    this._tone(0.45, { type: 'sawtooth', f0: 60, f1: 180, vol: 0.12, attack: 0.02 });
    this._noise(0.4, { f0: 300, f1: 2500, q: 2, vol: 0.12 });
  }

  swing() {
    if (!this.ctx) return;
    this._noise(0.28, { f0: 400, f1: 1800, q: 3, vol: 0.22, attack: 0.04 });
    this._tone(0.28, { type: 'sawtooth', f0: 110, f1: 70, vol: 0.06, attack: 0.03 });
  }

  blaster() {
    if (!this.ctx) return;
    this._tone(0.18, { type: 'square', f0: 1400, f1: 180, vol: 0.06 });
    this._tone(0.14, { type: 'sine', f0: 2200, f1: 300, vol: 0.05 });
  }

  deflect(perfect = false) {
    if (!this.ctx) return;
    this._tone(0.3, { type: 'triangle', f0: perfect ? 2400 : 1700, f1: perfect ? 1900 : 900, vol: 0.14 });
    this._noise(0.12, { type: 'highpass', f0: 3000, f1: 2000, q: 1, vol: 0.2 });
  }

  clash() {
    if (!this.ctx) return;
    this._noise(0.35, { f0: 2500, f1: 600, q: 0.8, vol: 0.35 });
    this._tone(0.4, { type: 'sawtooth', f0: 220, f1: 90, vol: 0.12 });
  }

  hit() {
    if (!this.ctx) return;
    this._noise(0.2, { f0: 1800, f1: 300, q: 1.5, vol: 0.3 });
    this._tone(0.15, { type: 'square', f0: 300, f1: 80, vol: 0.08 });
  }

  explode() {
    if (!this.ctx) return;
    this._noise(0.7, { type: 'lowpass', f0: 1800, f1: 60, q: 0.7, vol: 0.5 });
    this._tone(0.5, { type: 'sine', f0: 120, f1: 30, vol: 0.3 });
  }

  hurt() {
    if (!this.ctx) return;
    this._tone(0.25, { type: 'sawtooth', f0: 260, f1: 120, vol: 0.15 });
    this._noise(0.15, { type: 'lowpass', f0: 900, f1: 200, vol: 0.2 });
  }

  push() {
    if (!this.ctx) return;
    this._noise(0.6, { type: 'lowpass', f0: 1200, f1: 80, q: 1, vol: 0.45, attack: 0.02 });
    this._tone(0.5, { type: 'sine', f0: 90, f1: 40, vol: 0.3, attack: 0.01 });
  }

  jump(double = false) {
    if (!this.ctx) return;
    this._tone(0.15, { type: 'sine', f0: double ? 500 : 300, f1: double ? 1100 : 700, vol: 0.12 });
  }

  croak() {
    if (!this.ctx) return;
    this._tone(0.22, { type: 'square', f0: 140, f1: 90, vol: 0.08 });
  }

  throwSaber() {
    if (!this.ctx) return;
    this._noise(0.9, { f0: 600, f1: 1400, q: 4, vol: 0.18, attack: 0.05 });
  }

  wave() {
    if (!this.ctx) return;
    [392, 523, 659].forEach((f, i) => {
      setTimeout(() => this._tone(0.35, { type: 'triangle', f0: f, f1: f, vol: 0.1 }), i * 110);
    });
  }

  gameOver() {
    if (!this.ctx) return;
    [392, 330, 262, 196].forEach((f, i) => {
      setTimeout(() => this._tone(0.5, { type: 'triangle', f0: f, f1: f * 0.98, vol: 0.12 }), i * 220);
    });
  }
}
