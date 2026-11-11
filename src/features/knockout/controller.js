import { KnockoutView } from './view.js';
import { KnockoutReveals, knockoutMatches, knockoutRounds, roundLabel, validReveal } from '../../domain/knockout.js';

export class KnockoutController {
  constructor(root, { api, refresh, notify, onStarted, onUndo, onStateChange = () => {}, view, isHidden = () => document.hidden }) {
    Object.assign(this, { api, refresh, notify, onStarted, onUndo, onStateChange, isHidden });
    this.view = view || new KnockoutView(root, api);
    this.reveals = new KnockoutReveals(); this.busy = false; this.disposed = false; this.epoch = 0;
    this.view.bind({ match: (id) => this.select(id), choose: (id) => { this.choice = id; this.render(); },
      draw: () => void this.draw(), confirm: () => void this.confirm(), replay: () => this.replay(),
      start: () => void this.start(), undo: () => this.requestUndo() });
  }
  get navigationLocked() { return this.busy; }
  update(game, canWrite, canSetup = canWrite) {
    if (this.disposed) return;
    if (this.game && this.game.id !== game.id) { this.stop(); this.reveals = new KnockoutReveals(); }
    this.game = game; this.canWrite = canWrite; this.canSetup = canSetup;
    const match = game.knockout_matches?.find((row) => row.id === this.selected);
    if (!match) this.selected = knockoutMatches(game).find((row) => row.status === 'ready')?.id || knockoutMatches(game)[0]?.id;
    if (!match || match.status !== 'ready' || ![match.player1, match.player2].includes(this.choice)) this.choice = null;
    this.reveals.update(game, this.isHidden() || Boolean(this.suppressNext)); this.suppressNext = false;
    if (this.active?.event && !validReveal(game, this.active.event)) { this.view.close(); this.active = null; }
    if (this.active?.replay) {
      const current = game.knockout_matches?.find((row) => row.id === this.active.match.id);
      if (!current || current.player1 !== this.active.match.player1 || current.player2 !== this.active.match.player2) { this.view.close(); this.active = null; }
    }
    if (!canWrite && this.busy) this.stop();
    this.render(); this.pump();
  }
  render() {
    if (this.disposed || !this.game) return;
    this.view.update(this.game, { selected: this.selected, choice: this.choice, busy: this.busy, canWrite: this.canWrite, canSetup: this.canSetup });
    this.onStateChange();
  }
  select(id) { this.selected = id; this.choice = null; this.render(); }
  async run(operation, after) {
    if (this.disposed || this.busy || !this.canWrite || this.isHidden()) return false;
    this.busy = true; const epoch = ++this.epoch; this.render();
    try {
      await operation(() => !this.disposed && this.epoch === epoch && !this.isHidden() && this.canWrite);
      if (this.disposed || this.epoch !== epoch) return false;
      await this.refresh();
      if (this.disposed || this.epoch !== epoch) return false;
      await after?.();
      return true;
    } catch (error) {
      if (!this.disposed && this.epoch === epoch) {
        this.notify(error.message, true);
        await this.refresh().catch(() => {});
      }
      return false;
    } finally {
      if (!this.disposed && this.epoch === epoch) { this.busy = false; this.render(); this.pump(); }
    }
  }
  async draw() {
    if (!this.canSetup || this.game?.status !== 'drafting') return false;
    const game = this.game;
    return this.run(async (alive) => {
      const reservation = await this.api.mutate('begin_knockout_reveal', { game_id: game.id, tournament_revision: game.tournament_revision });
      if (!alive()) return;
      const result = await this.api.mutate('commit_knockout_reveal', { game_id: game.id, reveal_id: reservation.id, tournament_revision: reservation.tournament_revision });
      this.pendingFocus = result.match_id;
    }, () => {
      if (this.pendingFocus) this.selected = this.pendingFocus;
      const match = this.game.knockout_matches?.find((row) => row.id === this.pendingFocus);
      if (match?.status === 'bye') {
        const player = this.game.participants.find((row) => row.player_id === match.winner_id);
        this.notify(`${player.name} advances directly to ${roundLabel(match.round + 1, knockoutRounds(this.game).length).toLowerCase()}.`);
      }
    });
  }
  async confirm() {
    const match = this.game?.knockout_matches?.find((row) => row.id === this.selected);
    if (this.game?.status !== 'playing' || match?.status !== 'ready' || ![match.player1, match.player2].includes(this.choice)) return false;
    const input = { game_id: this.game.id, tournament_revision: this.game.tournament_revision, match_id: match.id, winner_id: this.choice };
    return this.run(() => this.api.mutate('record_knockout_winner', input), () => {
      this.choice = null;
      const next = knockoutMatches(this.game).find((row) => row.status === 'ready');
      if (next) this.selected = next.id;
    });
  }
  async start() {
    if (!this.canSetup || this.game?.status !== 'ready') return false;
    return this.run(async () => {
      await this.api.mutate('start_game', { game_id: this.game.id, revision: this.game.draft_revision });
      await this.onStarted?.();
    });
  }
  requestUndo() {
    if (this.busy || !this.canWrite || this.game?.status !== 'playing' || !this.game.knockout_last_result) return;
    this.onUndo?.({ game_id: this.game.id, tournament_revision: this.game.tournament_revision, result_id: this.game.knockout_last_result, confirmed: true });
  }
  async undo(input) { return this.run(() => this.api.mutate('undo_knockout_result', input), () => { this.choice = null; }); }
  pump() {
    if (this.disposed || this.busy || this.active || this.isHidden()) return;
    const event = this.reveals.queue.shift();
    if (!event) return;
    const match = this.game.knockout_matches.find((row) => row.id === event.match_id);
    this.selected = match.id; this.choice = null;
    this.show(match, event.kind === 'opening' ? 'Tournament draw' : 'Next opponent confirmed', { event });
  }
  replay() {
    if (this.busy || this.isHidden()) return;
    const match = this.game?.knockout_matches?.find((row) => row.id === this.selected);
    if (!match?.player1 || !match.player2) return;
    this.show(match, 'Matchup', { replay: true });
  }
  show(match, context, state) {
    this.active = { ...state, match };
    const nextDraw = !state.replay && state.event?.kind === 'opening' && this.canSetup && this.game.status === 'drafting';
    const dismiss = (continueQueue = false) => {
      this.active = null; this.view.close();
      if (!continueQueue) this.reveals.clear();
      this.render(); this.view.focusMatch?.(this.selected);
      if (continueQueue) this.pump();
    };
    this.render();
    const hasNext = Boolean(nextDraw || this.reveals.queue.length);
    this.view.reveal(this.game, match, { context, hasNext, next: hasNext ? 'Next matchup →' : 'Back to bracket',
      onNext: () => { dismiss(hasNext); if (nextDraw && !this.active) void this.draw(); }, onClose: () => dismiss() });
  }
  stop() { this.epoch++; this.busy = false; this.suppressNext = true; this.reveals.clear(); this.active = null; this.view.close(); }
  dispose() { this.stop(); this.disposed = true; this.view.dispose(); }
}
