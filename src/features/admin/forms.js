import { escapeHtml as h, formatPoints, imageMarkup, installImageFallbacks } from '../../lib/html.js';
import { previewAwards, toCents } from '../../domain/scoring.js';
import { validateDraft, validateParticipants } from '../../domain/draft.js';

const field = (label, name, value = '', extra = '') => `<label>${h(label)}<input name="${name}" value="${h(value)}" ${extra}></label>`;

export function createAdminForms({ dialog, api, client, config, getBoard, refresh, notify, selectGame, selectSession }) {
  return {
    login() {
      dialog.open({ title: 'Admin access', submit: 'Sign in', content: `${config.adminEmail ? '' : field('Organizer email', 'email', '', 'type="email" required autocomplete="username"')}${field('Passcode', 'password', '', 'type="password" required autocomplete="current-password"')}`,
        async onSubmit(form) {
          const values = new FormData(form);
          const { error } = await client.auth.signInWithPassword({ email: config.adminEmail || values.get('email').trim(), password: values.get('password') });
          if (error) throw new Error('Sign-in failed. Check your credentials and try again.');
          const { data: admin, error: checkError } = await client.rpc('is_admin');
          if (checkError || !admin) {
            await client.auth.signOut({ scope: 'local' });
            notify('This account is not an authorized organizer. Enroll its user ID in admin_users.', true);
            throw new Error('This account is not an authorized organizer. Add its user ID to admin_users.');
          }
          await refresh(); notify('Admin access unlocked.');
        },
      });
    },

    player(player) {
      const sessionId = getBoard().session.id;
      let uploadedPath;
      let uploadedFile;
      const form = dialog.open({ title: player ? `Edit ${player.name}` : 'Add player', content: `${field('Player name', 'name', player?.name ?? '', 'required maxlength="50"')}
        <label>Titles / achievements (one per line, up to five)<textarea name="titles" rows="3" maxlength="404">${h(player?.titles.join('\n') ?? '')}</textarea></label>
        <label>Player PNG (up to 2 MiB)<input name="image" type="file" accept="image/png"></label>
        ${player?.image_path ? `<label class="check-row"><input type="checkbox" name="remove_image">Remove current image</label>` : ''}
        ${player ? `<label class="check-row"><input type="checkbox" name="archived" ${player.archived ? 'checked' : ''}>Archive player (exclude from future drafts)</label>` : ''}`,
        async onSubmit(form) {
          const data = new FormData(form);
          const titles = data.get('titles').split('\n').map((title) => title.trim()).filter(Boolean);
          if (titles.length > 5 || titles.some((title) => title.length > 80)) throw new Error('Use up to five titles, at most 80 characters each.');
          const file = data.get('image');
          let path = data.get('remove_image') ? null : player?.image_path ?? null;
          if (file?.size) {
            if (file !== uploadedFile && (file.name !== uploadedFile?.name || file.lastModified !== uploadedFile?.lastModified || file.size !== uploadedFile?.size)) {
              uploadedPath = await api.uploadImage(file); uploadedFile = file;
            }
            path = uploadedPath;
          }
          await api.mutate('save_player', { session_id: sessionId, ...(player ? { id: player.id, revision: player.revision } : {}), name: data.get('name').trim(), titles, image_path: path, archived: Boolean(data.get('archived')) });
          await refresh(); notify('Player saved.');
        },
      });
      if (player?.image_path) {
        form.querySelector('.dialog-content').insertAdjacentHTML('afterbegin', imageMarkup(api.imageUrl(player.image_path), player.name));
        installImageFallbacks(form);
      }
    },

    roster() {
      const board = getBoard();
      const form = dialog.open({ title: 'Players', submit: 'Add player', content: `<div class="roster-list">${board.roster.map((player) => `<button type="button" class="roster-item" data-player="${player.id}">${imageMarkup(api.imageUrl(player.image_path), player.name, 'small-portrait')}<span>${h(player.name)}${player.archived ? ' · archived' : ''}</span><span>Edit →</span></button>`).join('') || '<p>No players yet.</p>'}</div>`, onSubmit: () => { this.player(); return false; } });
      form.querySelectorAll('[data-player]').forEach((button) => { button.onclick = () => this.player(board.roster.find((player) => player.id === button.dataset.player)); });
      installImageFallbacks(form);
    },

    game() {
      const sessionId = getBoard().session.id;
      dialog.open({ title: 'New game', content: `${field('Game name', 'name', '', 'required maxlength="100"')}<label>Game format<select name="format"><option value="teams">Team-based</option><option value="ffa">Free-for-all</option></select></label>${field('Mode, map or details', 'details', '', 'maxlength="300"')}<label>Result ranking<select name="direction"><option value="higher">Higher score wins</option><option value="lower">Lowest score/time wins</option></select></label><p class="form-help">Team-based games use a random team draft. Free-for-all games score each participant individually. For times, enter numeric seconds (up to two decimal places).</p>`,
        async onSubmit(form) {
          const values = Object.fromEntries(new FormData(form));
          const game = await api.mutate('create_game', { ...values, session_id: sessionId });
          selectGame(game.id); await refresh(); notify(values.format === 'ffa' ? 'Game created. Select the participating players.' : 'Game created. Select players to draft teams.');
        },
      });
    },

    draft(game) {
      const players = getBoard().roster.filter((player) => !player.archived);
      if (game.format === 'ffa') {
        dialog.open({ title: `Participants: ${game.name}`, submit: 'Save participants', content: `<p class="form-help">Every player competes individually. Select 2–64 participants.</p><fieldset class="participant-list"><legend>Participating players</legend>${players.map((player) => `<label class="check-row"><input type="checkbox" name="player" value="${player.id}" ${!game.total_players || game.participants.some((row) => row.player_id === player.id) ? 'checked' : ''}>${h(player.name)}</label>`).join('')}</fieldset>`,
          async onSubmit(form) {
            const ids = new FormData(form).getAll('player');
            validateParticipants(ids);
            await api.mutate('prepare_draw', { game_id: game.id, revision: game.draft_revision, player_ids: ids, confirm_redraw: Boolean(game.total_players) });
            await refresh(); notify('Participants saved. Ready to play or enter individual results.');
          },
        });
        return;
      }
      dialog.open({ title: game.total_players ? `Redraw: ${game.name}` : `Draft: ${game.name}`, submit: 'Prepare draft', content: `<p class="form-help">One player per spin. Team A → Team B → next team → Team A.</p><fieldset class="participant-list"><legend>Participating players</legend>${players.map((player) => `<label class="check-row"><input type="checkbox" name="player" value="${player.id}" ${!game.total_players || game.participants.some((row) => row.player_id === player.id) ? 'checked' : ''}>${h(player.name)}</label>`).join('')}</fieldset><label>Number of teams<select name="team_count">${Array.from({ length: Math.min(8, players.length) - 1 }, (_, index) => `<option value="${index + 2}" ${game.team_count === index + 2 ? 'selected' : ''}>${index + 2}</option>`).join('')}</select></label>${game.total_players ? '<label class="check-row"><input type="checkbox" name="confirm" required>Replace this game’s existing draft and revealed assignments</label>' : ''}`,
        async onSubmit(form) {
          const data = new FormData(form);
          const ids = data.getAll('player');
          const teamCount = Number(data.get('team_count'));
          validateDraft(ids, teamCount);
          await api.mutate('prepare_draw', { game_id: game.id, revision: game.draft_revision, player_ids: ids, team_count: teamCount, confirm_redraw: Boolean(data.get('confirm')) });
          await refresh(); notify('Draft prepared. Spin to pick the first player.');
        },
      });
    },

    result(game) {
      const board = getBoard();
      const freeForAll = game.format === 'ffa';
      const read = (form) => game.teams.map((team) => {
        const get = (key) => form.elements[`${team.id}-${key}`]?.value;
        const custom = Object.fromEntries(team.members.map((member) => [member.player_id, get(member.player_id)]));
        toCents(get('result'));
        return { id: team.id, result: get('result'), mode: freeForAll ? 'equal' : get('mode'), amount: get('amount'), custom, player_ids: team.members.map((member) => member.player_id) };
      });
      const preview = (form) => {
        form.querySelectorAll('[data-team]').forEach((group) => {
          const mode = group.querySelector('select')?.value ?? 'equal';
          group.querySelector('[data-amount]').hidden = mode === 'custom';
          group.querySelector('[data-custom]').hidden = mode !== 'custom';
        });
        try {
          const teams = read(form);
          teams.forEach((team) => {
            const group = form.querySelector(`[data-team="${team.id}"]`);
            group.querySelector('[data-amount]').hidden = team.mode === 'custom';
            group.querySelector('[data-custom]').hidden = team.mode !== 'custom';
          });
          const rows = previewAwards(teams, board.players, game.awards);
          form.querySelector('.result-preview').innerHTML = `<table><caption>Player points preview</caption><thead><tr><th>Player</th><th>Before</th><th>After</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${h(board.players.find((player) => player.id === row.player_id).name)}</td><td>${formatPoints(row.before)}</td><td>${formatPoints(row.after)}</td></tr>`).join('')}</tbody></table>`;
        } catch (error) { form.querySelector('.result-preview').textContent = error.message; }
      };
      const form = dialog.open({ title: `${game.score_revision ? 'Correct' : 'Record'} result: ${game.name}`, submit: 'Preview awards', content: `${game.teams.map((team) => `<fieldset class="result-team" data-team="${team.id}"><legend>${h(team.name)}</legend><div class="form-grid">${field(game.direction === 'lower' ? 'Result (lower wins)' : 'Result (higher wins)', `${team.id}-result`, team.result ?? '', 'inputmode="decimal" required')}
        ${freeForAll ? '' : `<label>Award rule<select name="${team.id}-mode"><option value="equal" ${team.award?.mode === 'equal' ? 'selected' : ''}>Points per player</option><option value="split" ${team.award?.mode === 'split' ? 'selected' : ''}>Split total pool</option><option value="custom" ${team.award?.mode === 'custom' ? 'selected' : ''}>Custom per player</option></select></label>`}
        <div data-amount>${field(freeForAll ? 'Player points' : 'Award / pool', `${team.id}-amount`, team.award?.amount ?? '0', 'inputmode="decimal"')}</div></div><div data-custom class="form-grid">${freeForAll ? '' : team.members.map((member) => field(board.players.find((player) => player.id === member.player_id).name, `${team.id}-${member.player_id}`, team.award?.custom?.[member.player_id] ?? '0', 'inputmode="decimal"')).join('')}</div></fieldset>`).join('')}${field(game.score_revision ? 'Reason for correction' : 'Note (optional)', 'reason', '', `${game.score_revision ? 'required' : ''} maxlength="500"`)}<div class="result-preview"></div><p class="form-help">Saving replaces this game’s earlier player awards. Other games and adjustments stay intact.</p>`,
        onInput(form) {
          form.dataset.confirmed = '';
          form.querySelector('[type=submit]').textContent = 'Preview awards';
          preview(form);
        },
        async onSubmit(form) {
          const teams = read(form);
          previewAwards(teams, board.players, game.awards);
          if (!form.dataset.confirmed) {
            preview(form); form.dataset.confirmed = 'yes';
            form.querySelector('[type=submit]').textContent = 'Confirm and apply result';
            return false;
          }
          await api.mutate('save_result', { game_id: game.id, revision: game.score_revision, board_revision: board.revision, teams: teams.map(({ player_ids, ...team }) => team), reason: form.elements.reason.value.trim() });
          await refresh(); notify('Result saved. Standings updated.');
        },
      });
      // Show the correct mode controls before result fields have been completed.
      form.querySelectorAll('[data-team]').forEach((group) => {
        const mode = group.querySelector('select')?.value ?? 'equal';
        group.querySelector('[data-amount]').hidden = mode === 'custom';
        group.querySelector('[data-custom]').hidden = mode !== 'custom';
      });
    },

    adjust() {
      const board = getBoard();
      dialog.open({ title: 'Individual adjustment', submit: 'Apply adjustment', content: `<label>Player<select name="player_id">${board.players.map((player) => `<option value="${player.id}">${h(player.name)}</option>`).join('')}</select></label>${field('Points (negative for a penalty)', 'points', '', 'required inputmode="decimal"')}${field('Reason', 'reason', '', 'required maxlength="500"')}<p class="form-help">Adds an independent score entry. It can be reversed from the history.</p>`,
        async onSubmit(form) {
          const values = Object.fromEntries(new FormData(form)); toCents(values.points);
          await api.mutate('adjust_points', { ...values, session_id: board.session.id });
          await refresh(); notify('Adjustment recorded.');
        },
      });
    },

    history() {
      const board = getBoard();
      const reversed = new Set(board.events.map((event) => event.reversed_event_id));
      const form = dialog.open({ title: 'Score history', submit: 'Close', content: `<div class="audit-list">${board.events.map((event) => `<article><header><strong>${h(event.kind)}</strong><time>${h(new Date(event.created_at).toLocaleString())}</time></header><p>${h(event.reason)}</p><small>${event.allocations.map((row) => `${h(board.players.find((player) => player.id === row.player_id)?.name ?? 'Player')}: ${formatPoints(row.points)}`).join(' · ')}</small>${board.session.active && event.kind === 'adjustment' && !reversed.has(event.id) ? `<button type="button" class="button" data-reverse="${event.id}">Reverse adjustment</button>` : ''}</article>`).join('') || '<p>No score entries yet.</p>'}</div>`, onSubmit: () => true });
      form.querySelectorAll('[data-reverse]').forEach((button) => {
        button.onclick = () => dialog.open({ title: 'Reverse adjustment', content: field('Reason', 'reason', '', 'required maxlength="500"'), async onSubmit(nextForm) {
          await api.mutate('adjust_points', { session_id: board.session.id, reverse_id: button.dataset.reverse, reason: nextForm.elements.reason.value.trim() });
          await refresh(); notify('Adjustment reversed.');
        } });
      });
    },

    reset() {
      const board = getBoard();
      dialog.open({ title: 'Start a new LAN', submit: 'Archive and start fresh', content: `<p>Archive <strong>${h(board.session.name)}</strong> privately and reset scores to zero. Players and artwork are kept.</p>${field('New LAN name', 'name', '', 'required maxlength="100"')}<label class="check-row"><input name="confirm" type="checkbox" required>I confirm this LAN should be archived</label>`, async onSubmit(form) {
        const result = await api.mutate('reset_lan', { session_id: board.session.id, name: form.elements.name.value.trim(), confirmed: true });
        selectGame(null); selectSession(result.id); await refresh(); notify('New LAN started. Previous scores are in the private archive.');
      } });
    },
  };
}
