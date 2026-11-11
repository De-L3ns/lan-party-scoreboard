import { escapeHtml as h, imageMarkup, installImageFallbacks } from '../../lib/html.js';
import { createPageForm } from '../../lib/page-form.js';
import { validateDraft, validateParticipants } from '../../domain/draft.js';
import { needsRedraw, validateTeamNames } from '../../domain/game-flow.js';
import { rosterMarkup } from './view.js';

export class GameSetup {
  constructor(root, { game, board, api, canWrite, onSubmit, onFormatChange = () => {} }) {
    this.game = game;
    this.canWrite = canWrite;
    this.api = api;
    this.onFormatChange = onFormatChange;
    this.playerIds = new Set(game?.total_players ? game.participants.map((row) => row.player_id) : board.roster.filter((row) => !row.archived).map((row) => row.id));
    this.page = createPageForm(root, { canSubmit: () => this.canWrite && this.valid });
    this.form = this.page.open({ title: 'Select players', submit: 'Assign teams', content: `<div class="setup-layout"><section><div class="roster-tools"><strong class="selected-count" role="status"></strong><button type="button" class="text-button select-all">Deselect all</button></div><div class="setup-roster"></div></section>
      <aside class="setup-settings"><label>Game name<input name="name" required maxlength="100" value="${h(game?.name ?? '')}"></label><label>Map / details<input name="details" maxlength="300" value="${h(game?.details ?? '')}"></label>
      <label>Format<select name="format"><option value="teams" ${!game || game.format === 'teams' ? 'selected' : ''}>Team-based</option><option value="ffa" ${game?.format === 'ffa' ? 'selected' : ''}>Free-for-all</option><option value="knockout" ${game?.format === 'knockout' ? 'selected' : ''}>Knockout Tournament</option></select></label>
      <label class="ranking-field">Ranking<select name="direction"><option value="higher" ${game?.direction !== 'lower' ? 'selected' : ''}>Highest score wins</option><option value="lower" ${game?.direction === 'lower' ? 'selected' : ''}>Lowest score/time wins</option></select></label>
      <label class="team-count-field">Teams<select name="team_count">${Array.from({ length: 7 }, (_, i) => `<option value="${i + 2}" ${game?.team_count === i + 2 ? 'selected' : ''}>${i + 2}</option>`).join('')}</select></label>
      <label class="check-row redraw-confirm" hidden><input name="confirm_redraw" type="checkbox">Replace existing assignments</label><p class="selection-error form-error" role="status"></p></aside></div>`,
      onInput: () => this.updateControls(),
      onSubmit: async () => {
        const input = this.read();
        if (input.format === 'teams') validateDraft(input.player_ids, input.team_count); else validateParticipants(input.player_ids);
        await onSubmit({ ...input, ...(game ? { game_id: game.id, revision: game.draft_revision } : {}), session_id: board.session.id });
      },
    });
    this.form.addEventListener('change', () => this.updateControls());
    this.form.querySelector('.select-all').onclick = () => {
      const inputs = [...this.form.querySelectorAll('[name=player]')];
      const all = inputs.every((input) => input.checked);
      inputs.forEach((input) => { input.checked = !all; });
      this.updateControls();
    };
    this.update(board, canWrite);
    installImageFallbacks(root);
  }

  read() {
    const data = new FormData(this.form);
    return { name: data.get('name').trim(), details: data.get('details').trim(), format: data.get('format'), direction: data.get('format') === 'knockout' ? 'lower' : data.get('direction'), team_count: Number(data.get('team_count')), player_ids: data.getAll('player'), confirm_redraw: Boolean(data.get('confirm_redraw')) };
  }

  updateControls() {
    const input = this.read();
    this.playerIds = new Set(input.player_ids);
    const count = input.player_ids.length;
    this.onFormatChange(input.format);
    const redraw = needsRedraw(this.game, input);
    this.form.querySelector('.selected-count').textContent = `${count} selected`;
    this.form.querySelector('.select-all').textContent = [...this.form.querySelectorAll('[name=player]')].every((row) => row.checked) ? 'Deselect all' : 'Select all';
    this.form.querySelector('.team-count-field').hidden = input.format !== 'teams';
    this.form.querySelector('.ranking-field').hidden = input.format === 'knockout';
    this.form.querySelector('.redraw-confirm').hidden = !redraw;
    this.form.elements.confirm_redraw.required = redraw;
    this.form.elements.name.setCustomValidity(input.name ? '' : 'Enter a game name.');
    let error = '';
    try { if (input.format === 'teams') validateDraft(input.player_ids, input.team_count); else validateParticipants(input.player_ids); }
    catch (failure) { error = failure.message; }
    this.form.querySelector('.selection-error').textContent = error;
    this.valid = !error && Boolean(input.name) && (!redraw || input.confirm_redraw);
    this.form.querySelector('[type=submit]').textContent = ({ ffa: 'Start game', teams: 'Assign teams', knockout: 'Draw tournament' })[input.format];
    this.page.update();
  }

  update(board, canWrite) {
    this.canWrite = canWrite;
    const players = board.roster.filter((player) => !player.archived && board.players.some((row) => row.id === player.id));
    const signature = JSON.stringify(players);
    if (signature !== this.rosterSignature) {
      this.rosterSignature = signature;
      const roster = this.form.querySelector('.setup-roster');
      roster.innerHTML = players.map((player) => `<label class="participant-card"><input type="checkbox" name="player" value="${player.id}" ${this.playerIds.has(player.id) ? 'checked' : ''}>${imageMarkup(this.api.imageUrl(player.image_path), player.name)}<strong>${h(player.name)}</strong></label>`).join('');
      installImageFallbacks(roster);
    }
    this.updateControls();
  }

  get busy() { return this.page.busy; }
  dispose() { this.page.dispose(); }
}

export class TeamNames {
  constructor(root, { game, api, canWrite, onSubmit }) {
    this.canWrite = canWrite;
    this.page = createPageForm(root, { canSubmit: () => this.canWrite });
    this.form = this.page.open({ title: 'Name the teams', submit: 'Start game', content: `<div class="team-grid naming-grid">${game.teams.map((team) => `<section class="team-card" style="--team-color:var(--team-${team.position % 4})"><div class="team-name-field"><label for="name-${team.id}">${h(team.name)}<input id="name-${team.id}" name="${team.id}" required maxlength="40" placeholder="Team name" value="${/^Team [A-H]$/.test(team.name) ? '' : h(team.name)}"></label></div><ul>${rosterMarkup(game, team, api)}</ul></section>`).join('')}</div>`,
      onSubmit: async (form) => {
        const data = new FormData(form);
        const teams = validateTeamNames(game.teams.map((team) => ({ id: team.id, name: data.get(team.id) })));
        await onSubmit({ game_id: game.id, revision: game.draft_revision, teams });
      },
    });
    installImageFallbacks(root);
  }
  update(canWrite) { this.canWrite = canWrite; this.page.update(); }
  get busy() { return this.page.busy; }
  dispose() { this.page.dispose(); }
}
