export const revealClock = {
  now: () => performance.now(),
  frame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
  wait: (callback, ms) => setTimeout(callback, ms),
  cancelWait: (id) => clearTimeout(id),
};

// Positions, not point digits, change on each frame. Movement always runs and
// does not depend on CSS transitions or a saved/system motion preference.
export class ScoreRevealMotion {
  constructor({ onFrame, onFinish, clock = revealClock, hold = 500, duration = 1800 }) {
    Object.assign(this, { onFrame, onFinish, clock, hold, duration });
    this.version = 0;
  }

  play() {
    this.cancel();
    const version = this.version;
    const finish = () => { if (version === this.version) { this.cancel(); this.onFinish(); } };
    try {
      this.onFrame(0);
      this.timer = this.clock.wait(() => {
        if (version !== this.version) return;
        this.timer = null;
        const start = this.clock.now();
        const tick = (now) => {
          if (version !== this.version) return;
          try {
            const progress = Math.min(1, Math.max(0, (now - start) / this.duration));
            const eased = progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
            this.onFrame(eased);
            if (progress < 1) this.frame = this.clock.frame(tick);
            else finish();
          } catch { finish(); }
        };
        this.frame = this.clock.frame(tick);
      }, this.hold);
    } catch { finish(); }
  }

  cancel() {
    this.version++;
    if (this.timer != null) this.clock.cancelWait(this.timer);
    if (this.frame != null) this.clock.cancelFrame(this.frame);
    this.timer = this.frame = null;
  }
}
