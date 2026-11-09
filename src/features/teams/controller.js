import { animateWheel, renderWheel } from './wheel.js';
import { escapeHtml as h, imageMarkup, installImageFallbacks } from '../../lib/html.js';

export class DraftController {
  constructor(root, { api, refresh, notify, onStateChange = () => {} }) {
    this.root = root; this.api = api; this.refresh = refresh; this.notify = notify;
    this.onStateChange = onStateChange;
    this.epoch = 0; this.autoplay = false; this.busy = false;
    root.innerHTML = '<div class="draft-caption"><span class="draft-target"></span><span class="draft-count"></span></div><div class="wheel-stage"></div><div class="pick-result" role="status" aria-live="polite"></div><div class="draft-buttons"><button class="button primary spin-button">Spin for a player ↻</button><button class="button auto-button" aria-pressed="false">Auto draw</button></div>';
    this.$ = (selector) => root.querySelector(selector);
    this.$('.spin-button').onclick = () => { this.autoplay = false; void this.spin(); };
    this.$('.auto-button').onclick = () => {
      this.autoplay = !this.autoplay;
      this.buttons();
      if (this.autoplay && !this.busy) void this.spin();
      else if (!this.autoplay) clearTimeout(this.timer);
    };
  }

  update(game, canWrite) {
    if (this.game && this.game.id !== game.id) this.stop();
    this.game = game; this.canWrite = canWrite;
    if (!canWrite && this.busy) this.stop();
    this.root.hidden = game.status === 'ready' && !this.busy;
    this.$('.draft-count').textContent = `${game.pick_count} / ${game.total_players}`;
    this.buttons();
    if (this.busy) return;
    const signature = `${game.id}:${game.draft_revision}:${game.pick_count}:${game.rolling}:${canWrite}`;
    if (this.signature === signature) return;
    this.signature = signature;
    this.animation?.cancel();
    const picked = game.teams.flatMap((team) => team.members).sort((a, b) => b.pick_index - a.pick_index)[0];
    this.$('.draft-target').textContent = game.status === 'drafting' ? `Next: Team ${String.fromCharCode(65 + game.pick_count % game.team_count)}` : 'Teams ready';
    if (game.status === 'ready') {
      this.$('.wheel-stage').replaceChildren();
      this.$('.pick-result').replaceChildren();
    } else if (game.rolling) {
      this.$('.wheel-stage').innerHTML = renderWheel(this.remaining());
      this.$('.pick-result').textContent = 'Picking a player…';
      const wheel = this.$('.draw-wheel');
      if (wheel && !document.hidden && Date.now() - Date.parse(game.roll_started_at) < 12000 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.animation = wheel.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 1800, iterations: Infinity });
      }
    } else if (picked) {
      this.$('.wheel-stage').innerHTML = game.status === 'drafting' ? renderWheel(this.remaining()) : '';
      this.showSelection(game.participants.find((player) => player.player_id === picked.player_id), game.teams.find((team) => team.id === picked.team_id).name);
    } else {
      this.$('.wheel-stage').innerHTML = renderWheel(this.remaining());
      this.$('.pick-result').textContent = '';
    }
  }

  remaining() {
    const assigned = new Set(this.game.teams.flatMap((team) => team.members.map((member) => member.player_id)));
    return this.game.participants.filter((player) => !assigned.has(player.player_id));
  }

  buttons() {
    const enabled = this.canWrite && this.game?.status === 'drafting';
    this.$('.draft-buttons').hidden = !enabled;
    this.$('.spin-button').disabled = this.busy;
    this.$('.spin-button').textContent = this.busy ? 'Spinning…' : this.game?.rolling ? 'Resume pick ↻' : 'Spin for a player ↻';
    this.$('.auto-button').textContent = this.autoplay ? 'Pause auto draw' : 'Auto draw';
    this.$('.auto-button').setAttribute('aria-pressed', String(this.autoplay));
    this.onStateChange();
  }

  showSelection(player, team) {
    this.$('.pick-result').innerHTML = `<div class="selected-player">${imageMarkup(this.api.imageUrl(player.image_path), player.name)}<div><strong>${h(player.name)}</strong><small>${h(player.titles.join(' · '))}</small></div><span>${h(team)}</span></div>`;
    installImageFallbacks(this.root);
  }

  async spin() {
    if (this.busy || !this.canWrite || this.game.status !== 'drafting') return;
    this.busy = true; this.buttons();
    clearTimeout(this.timer);
    const epoch = ++this.epoch;
    const gameId = this.game.id;
    try {
      const roll = await this.api.mutate('begin_roll', { game_id: gameId, revision: this.game.draft_revision });
      if (epoch !== this.epoch || document.hidden) return;
      this.$('.draft-target').textContent = `Picking for Team ${String.fromCharCode(65 + roll.team_position)}`;
      this.$('.pick-result').textContent = 'Picking a player…';
      this.animation?.cancel();
      this.animation = await animateWheel(this.$('.wheel-stage'), this.remaining(), roll.player.player_id);
      await this.animation.finished;
      if (epoch !== this.epoch || document.hidden) return;
      await this.api.mutate('commit_roll', { game_id: gameId, roll_id: roll.id, revision: roll.revision });
      await this.refresh();
    } catch (error) {
      this.autoplay = false;
      if (epoch === this.epoch && error.name !== 'AbortError') this.notify(`${error.message} Refresh, then resume the pick if needed.`, true);
      await this.refresh();
    } finally {
      if (epoch === this.epoch) {
        this.busy = false; this.signature = null;
        this.update(this.game, this.canWrite);
        if (this.autoplay && this.canWrite && this.game.status === 'drafting') this.timer = setTimeout(() => void this.spin(), 1500);
        else this.autoplay = false;
        this.buttons();
      }
    }
  }

  stop() {
    this.epoch += 1; this.autoplay = false; this.busy = false;
    clearTimeout(this.timer); this.animation?.cancel(); this.signature = null;
    if (this.game) { this.buttons(); this.update(this.game, this.canWrite); }
  }

  dispose() {
    this.epoch += 1; this.autoplay = false; clearTimeout(this.timer); this.animation?.cancel();
  }
}
