export class PickerAudio {
  constructor({ contextFactory = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(), storage = () => globalThis.sessionStorage } = {}) {
    this.contextFactory = contextFactory; this.storage = storage;
    this.enabled = true; this.error = ''; this.listeners = new Set(); this.sources = new Set(); this.timers = new Set();
    try { this.enabled = storage()?.getItem('lan-picker-sound') !== 'off'; } catch { /* Memory preserves this tab's choice when storage is blocked. */ }
  }
  subscribe(listener) { this.listeners.add(listener); listener(this.snapshot()); return () => this.listeners.delete(listener); }
  snapshot() { return { enabled: this.enabled, error: this.error }; }
  publish() { for (const listener of this.listeners) listener(this.snapshot()); }
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    try { this.storage()?.setItem('lan-picker-sound', enabled ? 'on' : 'off'); } catch { /* Optional persistence. */ }
    if (!enabled) { this.stopAll(); this.error = ''; }
    this.publish();
  }
  async unlock() {
    if (!this.enabled) return false;
    if (this.unlocking) return this.unlocking;
    let timer;
    this.unlocking = (async () => {
      try {
        if (!this.context || this.context.state === 'closed') {
          this.context = this.contextFactory();
          this.output = this.context.createGain();
          const limiter = this.context.createDynamicsCompressor();
          limiter.threshold.value = -8; limiter.knee.value = 10; limiter.ratio.value = 6; limiter.attack.value = .002; limiter.release.value = .12;
          this.output.gain.value = 0; this.output.connect(limiter); limiter.connect(this.context.destination);
        }
        if (this.context.state !== 'running') await Promise.race([
          this.context.resume(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Audio did not start.')), 1500); }),
        ]);
        if (!this.enabled) return false;
        if (this.context.state !== 'running') throw new Error('Audio is paused by the browser.');
        this.output.gain.setTargetAtTime(1.8, this.context.currentTime, .01);
        this.error = ''; this.publish(); return true;
      } catch {
        this.error = 'Audio unavailable. Switch sound off and on to retry.'; this.publish(); return false;
      } finally { clearTimeout(timer); }
    })();
    try { return await this.unlocking; } finally { this.unlocking = null; }
  }
  perform(callback) {
    if (!this.enabled || this.context?.state !== 'running') return;
    try { this.output.gain.setTargetAtTime(1.8, this.context.currentTime, .01); callback(this.context, this.context.currentTime); }
    catch { this.stopAll(); this.error = 'Audio unavailable. Switch sound off and on to retry.'; this.publish(); }
  }
  source(node, end) {
    this.sources.add(node);
    node.onended = () => { this.sources.delete(node); node.disconnect?.(); };
    node.start(this.context.currentTime); node.stop(end); return node;
  }
  gain(amount, destination = this.output) { const node = this.context.createGain(); node.gain.value = amount; node.connect(destination); return node; }
  noise(duration) {
    const buffer = this.context.createBuffer(1, Math.floor(this.context.sampleRate * duration), this.context.sampleRate);
    const values = buffer.getChannelData(0);
    for (let i = 0; i < values.length; i++) values[i] = Math.random() * 2 - 1;
    const source = this.context.createBufferSource(); source.buffer = buffer; return source;
  }
  stopSources(sources, when) { for (const source of sources) { try { source.stop(when); } catch { /* Already ended. */ } } }
  startSpin(mode, duration = 4.2) {
    this.stopSpin();
    this.perform((context, now) => {
      const bus = this.gain(1), noise = this.noise(.8), filter = context.createBiquadFilter(); noise.loop = true; filter.type = 'lowpass';
      filter.frequency.setValueAtTime(mode === 'rifle' ? 1600 : 1100, now); filter.frequency.exponentialRampToValueAtTime(180, now + duration);
      noise.connect(filter); filter.connect(this.gain(mode === 'rifle' ? .045 : .018, bus));
      const motor = context.createOscillator(); motor.type = mode === 'rifle' ? 'triangle' : 'sawtooth';
      motor.frequency.setValueAtTime(mode === 'rifle' ? 240 : 220, now); motor.frequency.exponentialRampToValueAtTime(mode === 'rifle' ? 55 : 80, now + duration);
      motor.connect(this.gain(mode === 'rifle' ? .035 : .065, bus));
      this.spin = { bus, sources: [noise, motor] };
      this.source(noise, now + duration + .1); this.source(motor, now + duration + .1);
    });
  }
  stopSpin() {
    if (!this.spin) return;
    const { bus, sources } = this.spin; this.spin = null;
    try { bus.gain.cancelScheduledValues(this.context.currentTime); bus.gain.setTargetAtTime(.0001, this.context.currentTime, .015); } catch { /* Context may have closed. */ }
    this.stopSources(sources, this.context.currentTime + .06);
  }
  tick() {
    if (!this.spin) return;
    this.perform((context, now) => {
      const tick = context.createOscillator(), volume = this.gain(.055, this.spin.bus); tick.type = 'square';
      tick.frequency.setValueAtTime(1050, now); tick.frequency.exponentialRampToValueAtTime(330, now + .025);
      volume.gain.exponentialRampToValueAtTime(.0001, now + .035); tick.connect(volume); this.source(tick, now + .04);
    });
  }
  shot() {
    this.perform((context, now) => {
      const noise = this.noise(.16), samples = noise.buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] *= (1 - i / samples.length) ** 2;
      const filter = context.createBiquadFilter(), volume = this.gain(.22); filter.type = 'lowpass'; filter.frequency.value = 2400;
      volume.gain.exponentialRampToValueAtTime(.001, now + .16); noise.connect(filter); filter.connect(volume); this.source(noise, now + .17);
      const thump = context.createOscillator(), gain = this.gain(.18); thump.type = 'triangle'; thump.frequency.setValueAtTime(130, now); thump.frequency.exponentialRampToValueAtTime(35, now + .12);
      gain.gain.exponentialRampToValueAtTime(.001, now + .15); thump.connect(gain); this.source(thump, now + .16);
    });
  }
  drive(collision = false) {
    this.perform((context, now) => {
      const filter = context.createBiquadFilter();
      if (collision) {
        const noise = this.noise(.13), gain = this.gain(.2); filter.type = 'bandpass'; filter.frequency.value = 700;
        gain.gain.exponentialRampToValueAtTime(.001, now + .13); noise.connect(filter); filter.connect(gain); this.source(noise, now + .14);
      } else {
        const engine = context.createOscillator(), volume = this.gain(.001); engine.type = 'sawtooth';
        engine.frequency.setValueAtTime(75, now); engine.frequency.exponentialRampToValueAtTime(330, now + .55); engine.frequency.exponentialRampToValueAtTime(65, now + .8);
        filter.type = 'lowpass'; filter.frequency.value = 1800; volume.gain.linearRampToValueAtTime(.16, now + .08); volume.gain.exponentialRampToValueAtTime(.001, now + .85);
        engine.connect(filter); filter.connect(volume); this.source(engine, now + .86);
      }
    });
  }
  impact(mode) { if (mode === 'trackmania') this.drive(true); else this.shot(); }
  async preview(mode) {
    this.setEnabled(true);
    if (!await this.unlock()) return;
    if (mode === 'rifle') this.shot();
    else {
      this.drive(); const timer = setTimeout(() => { this.timers.delete(timer); this.drive(true); }, 650); this.timers.add(timer);
    }
  }
  stopAll() {
    this.stopSpin();
    for (const timer of this.timers) clearTimeout(timer); this.timers.clear();
    if (this.context) {
      try { this.output.gain.cancelScheduledValues(this.context.currentTime); this.output.gain.setTargetAtTime(0, this.context.currentTime, .01); } catch { /* Closed context. */ }
      this.stopSources(this.sources, this.context.currentTime);
      for (const source of this.sources) { try { source.disconnect?.(); } catch { /* Already disconnected. */ } }
      this.sources.clear();
    }
  }
}

let sharedAudio;
export const getPickerAudio = () => sharedAudio ||= new PickerAudio();
