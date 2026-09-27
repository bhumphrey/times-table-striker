/** Generated sound effects via the Web Audio API. No audio files needed. */

export type Sound = 'correct' | 'wrong' | 'goal' | 'conceded' | 'whistle' | 'click' | 'save' | 'newFact';

export class SoundBoard {
  private ctx: AudioContext | null = null;
  muted = false;

  private context(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.15): void {
    const ctx = this.context();
    if (!ctx) return;
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private whistle(start: number, dur: number): void {
    const ctx = this.context();
    if (!ctx) return;
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 2300;
    lfo.frequency.value = 30;
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(osc.frequency);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.08, t0 + 0.02);
    g.gain.setValueAtTime(0.08, t0 + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    lfo.start(t0);
    osc.stop(t0 + dur + 0.02);
    lfo.stop(t0 + dur + 0.02);
  }

  play(sound: Sound): void {
    if (this.muted) return;
    switch (sound) {
      case 'correct':
        this.tone(660, 0, 0.12, 'triangle');
        this.tone(880, 0.08, 0.16, 'triangle');
        break;
      case 'wrong':
        this.tone(220, 0, 0.25, 'sawtooth', 0.07);
        this.tone(165, 0.12, 0.3, 'sawtooth', 0.07);
        break;
      case 'goal':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.1, 0.25, 'square', 0.08));
        this.tone(1047, 0.45, 0.5, 'triangle', 0.12);
        break;
      case 'conceded':
        [392, 330, 262].forEach((f, i) => this.tone(f, i * 0.15, 0.3, 'triangle', 0.1));
        break;
      case 'save':
        this.tone(440, 0, 0.1, 'square', 0.06);
        this.tone(660, 0.08, 0.2, 'triangle');
        break;
      case 'whistle':
        this.whistle(0, 0.35);
        break;
      case 'click':
        this.tone(1200, 0, 0.04, 'square', 0.03);
        break;
      case 'newFact':
        this.tone(784, 0, 0.12, 'sine');
        this.tone(988, 0.1, 0.12, 'sine');
        this.tone(1175, 0.2, 0.2, 'sine');
        break;
    }
  }
}

export const audio = new SoundBoard();
