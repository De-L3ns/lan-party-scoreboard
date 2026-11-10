import { PickerView } from './view.js';
import { getPickerAudio } from './audio.js';
import { PICKER_MODES } from '../../domain/picker.js';
import { checkSignal, wait } from './motion.js';

export class DraftController {
  constructor(root, { api, refresh, notify, onStateChange = () => {}, view, audio, isHidden = () => document.hidden, pause = wait }) {
    this.root = root; this.api = api; this.refresh = refresh; this.notify = notify; this.onStateChange = onStateChange;
    this.view = view || new PickerView(root, api); this.audio = audio || getPickerAudio(); this.isHidden = isHidden; this.pause = pause;
    this.epoch = 0; this.autoplay = false; this.busy = false; this.disposed = false;
    this.unsubscribeAudio = this.audio.subscribe((state) => this.view.audio(state));
    this.view.bind({
      spin: () => { this.autoplay = false; void this.spin(); },
      autoplay: () => this.toggleAuto(), mode: (mode) => void this.setMode(mode),
      sound: () => void this.toggleSound(),
    });
  }
  get mode() { return this.game?.picker_mode || 'rifle'; }
  get navigationLocked() { return this.busy || Boolean(this.canWrite && this.game?.rolling); }

  update(game, canWrite) {
    if (this.disposed) return;
    const previous = this.game;
    const roster = game.participants.map((player) => player.player_id).sort().join(',');
    const reset = previous && (previous.id !== game.id || this.roster !== roster || game.pick_count < this.lastCount);
    this.game = game; this.canWrite = canWrite; this.roster = roster;
    if (reset || (this.busy && this.kind !== 'observer' && !canWrite)) this.stop(false);
    if (this.busy) { this.lastCount = game.pick_count; this.buttons(); return; }
    this.view.update(game);
    const newPick = previous && !reset && this.lastCount + 1 === game.pick_count;
    this.lastCount = game.pick_count;
    if (newPick && !this.isHidden()) {
      const pick = game.teams.flatMap((team) => team.members).find((member) => member.pick_index === game.pick_count - 1);
      if (pick) { void this.observe(pick); return; }
    }
    if (game.status === 'ready') { this.audio.stopAll(); this.view.complete(); }
    else if (game.rolling && !this.isHidden()) this.view.pending(game.roll_started_at);
    else { this.view.stopGeneric(); this.audio.stopSpin(); }
    this.buttons();
  }
  buttons() {
    if (!this.game || this.disposed) return;
    this.view.controls({ canWrite: this.canWrite && this.game.status === 'drafting', busy: this.busy, pending: this.game.rolling, autoplay: this.autoplay, complete: this.game.status === 'ready', saving: this.kind === 'mode' });
    this.onStateChange();
  }
  begin(kind) {
    this.busy = true; this.kind = kind; this.control = new AbortController(); this.buttons();
    return { epoch: ++this.epoch, signal: this.control.signal };
  }
  async recover(error, signal) {
    if (signal.aborted || error.name === 'AbortError' || this.disposed) return;
    this.autoplay = false; this.notify(`${error.message} Refresh and resume the pick if needed.`, true);
    try { await this.refresh(); } catch { /* Keep the original failure visible and the reserved outcome intact. */ }
  }
  finish(epoch) {
    if (epoch !== this.epoch || this.disposed) return;
    this.busy = false; this.kind = null; this.control = null; this.audio.stopAll(); this.view.cancel();
    this.view.update(this.game); this.lastCount = this.game.pick_count;
    if (this.game.status === 'ready') this.view.complete();
    this.buttons();
    if (this.autoplay && this.canWrite && this.game.status === 'drafting' && !this.isHidden()) this.timer = setTimeout(() => void this.spin(), 950);
    else { this.autoplay = false; this.buttons(); }
  }
  async spin() {
    if (this.disposed || this.busy || !this.canWrite || this.game?.status !== 'drafting' || this.isHidden()) return;
    clearTimeout(this.timer);
    const { epoch, signal } = this.begin('admin'), game = this.game, mode = this.mode;
    try {
      // Unlock synchronously from the click, before the network/animation awaits.
      const audioReady = this.audio.unlock();
      this.view.cancel();
      const roll = await this.api.mutate('begin_roll', { game_id: game.id, revision: game.draft_revision });
      checkSignal(signal); if (this.isHidden()) { this.stop(); return; }
      await audioReady; checkSignal(signal);
      if (!this.view.reduced()) this.audio.startSpin(mode);
      await this.view.aim(roll.player.player_id, { signal, tick: () => this.audio.tick() });
      this.audio.stopSpin();
      await this.pause(this.view.reduced() ? 40 : 320, signal);
      if (mode === 'trackmania') { this.audio.drive(); await this.view.drive(roll.player.player_id, signal); }
      checkSignal(signal); if (this.isHidden()) { this.stop(); return; }
      // Alignment/contact is cosmetic; success effects require a committed pick.
      await this.api.mutate('commit_roll', { game_id: game.id, roll_id: roll.id, revision: roll.revision });
      checkSignal(signal); if (this.isHidden()) { this.stop(); return; }
      this.lastCount = Math.max(this.lastCount || 0, roll.index + 1);
      this.audio.impact(mode);
      const team = this.game.teams.find((row) => row.position === roll.team_position);
      this.view.announce(`${roll.player.name} → ${team?.name || `Team ${String.fromCharCode(65 + roll.team_position)}`}`);
      await Promise.all([this.view.impact(roll.player.player_id, signal), this.refresh()]);
    } catch (error) { await this.recover(error, signal); }
    finally { this.finish(epoch); }
  }
  async observe(pick) {
    const { epoch, signal } = this.begin('observer'), mode = this.mode;
    const player = this.game.participants.find((row) => row.player_id === pick.player_id);
    const team = this.game.teams.find((row) => row.id === pick.team_id);
    try {
      if (!player || !team) return;
      // Only published membership reaches this path; private targets stay private.
      if (!this.view.reduced()) this.audio.startSpin(mode, .6);
      await this.view.aim(player.player_id, { signal, duration: 600, tick: () => this.audio.tick() });
      this.audio.stopSpin();
      if (mode === 'trackmania') { this.audio.drive(); await this.view.drive(player.player_id, signal); }
      checkSignal(signal); if (this.isHidden()) return;
      this.audio.impact(mode); this.view.announce(`${player.name} → ${team.name}`);
      await this.view.impact(player.player_id, signal);
    } catch { /* A cancelled observer animation never changes the published outcome. */ }
    finally { this.finish(epoch); }
  }
  toggleAuto() {
    if (!this.canWrite || this.game?.status !== 'drafting' || this.kind === 'mode') return;
    this.autoplay = !this.autoplay; clearTimeout(this.timer); this.buttons();
    if (this.autoplay && !this.busy) void this.spin();
  }
  async setMode(mode) {
    if (!PICKER_MODES.includes(mode) || !this.canWrite || this.busy || this.game?.rolling || this.game?.status !== 'drafting') return;
    this.autoplay = false; clearTimeout(this.timer); this.audio.stopAll(); this.view.cancel();
    if (mode === this.mode) { this.buttons(); return; }
    const { epoch, signal } = this.begin('mode');
    try {
      await this.api.mutate('set_picker_mode', { game_id: this.game.id, revision: this.game.draft_revision, picker_mode: mode });
      checkSignal(signal); await this.refresh();
    } catch (error) {
      if (!signal.aborted) { this.notify(error.message, true); try { await this.refresh(); } catch { /* Retry through Refresh. */ } }
    } finally { this.finish(epoch); }
  }
  async toggleSound() {
    this.audio.setEnabled(!this.audio.enabled);
    if (this.audio.enabled && await this.audio.unlock()) {
      if (this.busy && this.view.spinning) this.audio.startSpin(this.mode, this.view.remainingDuration);
      else if (!this.busy) this.audio.preview(this.mode);
    }
  }
  stop(render = true) {
    this.epoch += 1; this.autoplay = false; clearTimeout(this.timer); this.control?.abort(); this.control = null;
    this.busy = false; this.kind = null; this.audio.stopAll(); this.view.cancel();
    if (render && this.game && !this.disposed) { this.view.update(this.game); if (this.game.status === 'ready') this.view.complete(); this.buttons(); }
  }
  dispose() {
    if (this.disposed) return;
    this.stop(false); this.disposed = true; this.unsubscribeAudio(); this.view.dispose();
  }
}
