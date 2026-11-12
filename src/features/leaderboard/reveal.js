import { ScoreRevealMotion } from './motion.js';
import { ScoreRevealView } from './reveal-view.js';

export class ScoreReveal {
  constructor({ api, onClosed = () => {}, view, clock }) {
    this.onClosed = onClosed;
    this.seen = new Set();
    this.view = view ?? new ScoreRevealView({ api, onReplay: () => this.replay(),
      onClose: () => this.close() });
    this.motion = new ScoreRevealMotion({ clock,
      onFrame: (progress) => { if (this.transition) this.view.position(progress); },
      onFinish: () => { if (this.transition) this.view.settle(); },
    });
  }

  open(transition) {
    const key = `${transition.sessionId}:${transition.gameId}:${transition.eventId}`;
    if (this.disposed || this.seen.has(key)) return false;
    this.close({ restoreFocus: false });
    this.transition = transition; this.seen.add(key);
    this.view.open(transition);
    this.replay();
    return true;
  }

  replay() {
    if (!this.transition || this.disposed) return;
    this.motion.cancel();
    try { this.view.before(); this.motion.play(); }
    catch { this.view.settle(); }
  }

  sync(sessionId, isAdmin) {
    if (this.transition && (this.transition.sessionId !== sessionId || !isAdmin)) this.close({ restoreFocus: false });
  }

  close({ restoreFocus = true } = {}) {
    const wasOpen = Boolean(this.transition);
    this.transition = null; this.motion.cancel(); this.view.close();
    if (wasOpen && restoreFocus) this.onClosed();
  }

  dispose() {
    this.disposed = true;
    this.close({ restoreFocus: false }); this.view.dispose(); this.seen.clear();
  }
}
