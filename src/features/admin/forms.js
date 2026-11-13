import { escapeHtml as h, formatPoints, imageMarkup, installImageFallbacks } from '../../lib/html.js';
import { toCents } from '../../domain/scoring.js';
import { openKnockoutAwards } from '../knockout/awards.js';
import { createResultSaver } from '../games/result-saver.js';
import { mvpSelectionMarkup } from '../games/mvp.js';

const field = (label, name, value = '', extra = '') => `<label>${h(label)}<input name="${name}" value="${h(value)}" ${extra}></label>`;

export function createAdminForms({ dialog, api, client, config, getBoard, refresh, notify, selectGame, selectSession, onResultSaved }) {
  const resultSaved = onResultSaved ?? (async () => { selectGame(null); await refresh(); notify('Result saved.'); });
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

    result(game, presenter = dialog, onSaved = resultSaved) {
      const board = structuredClone(getBoard());
      game = structuredClone(game);
      if (game.format === 'knockout') return openKnockoutAwards(presenter, { game, board, api, onSaved });
      const saver = createResultSaver({ board, game, api, onSaved });
      const freeForAll = game.format === 'ffa';
      const entries = game.teams;
      const player = (id) => game.participants?.find((row) => row.player_id === id) ?? board.players.find((row) => row.id === id);
      const read = (form) => entries.map((team) => {
        const get = (key) => form.elements[`${team.id}-${key}`]?.value;
        const custom = Object.fromEntries(team.members.map((member) => [member.player_id, get(member.player_id)]));
        const result = freeForAll ? get('amount') : get('result');
        try { toCents(result); } catch (error) { throw new Error(`${team.name}: ${error.message}`); }
        const mode = freeForAll ? 'equal' : get('mode');
        if (mode === 'custom') {
          for (const member of team.members) {
            try { toCents(custom[member.player_id]); } catch (error) { throw new Error(`${player(member.player_id).name}: ${error.message}`); }
          }
        } else {
          try { toCents(get('amount')); } catch (error) { throw new Error(`${team.name}: ${error.message}`); }
        }
        return { id: team.id, result, mode, amount: get('amount'), custom, player_ids: team.members.map((member) => member.player_id) };
      });
      const modes = (form) => {
        form.querySelectorAll('[data-team]').forEach((group) => {
          const mode = group.querySelector('select')?.value ?? 'equal';
          group.querySelector('[data-amount]').hidden = mode === 'custom';
          group.querySelector('[data-custom]').hidden = mode !== 'custom';
          group.querySelectorAll('[data-amount] input').forEach((input) => { input.disabled = mode === 'custom'; input.required = mode !== 'custom'; });
          group.querySelectorAll('[data-custom] input').forEach((input) => { input.disabled = mode !== 'custom'; input.required = mode === 'custom'; });
        });
      };
      const form = presenter.open({ title: `${game.score_revision ? 'Correct' : 'Record'} result: ${game.name}`, submit: 'Save results', content: `${entries.map((team) => `<fieldset class="result-team" data-team="${team.id}"><legend>${freeForAll ? imageMarkup(api.imageUrl(player(team.members[0].player_id).image_path), team.name, 'small-portrait') : ''}${h(team.name)}</legend>${freeForAll ? '' : `<ul class="result-entry-roster">${team.members.map((member) => { const p = player(member.player_id); return `<li>${imageMarkup(api.imageUrl(p.image_path), p.name, 'small-portrait')}<strong>${h(p.name)}</strong></li>`; }).join('')}</ul>`}<div class="form-grid">${freeForAll ? '' : field(game.direction === 'lower' ? 'Result (lower wins)' : 'Result (higher wins)', `${team.id}-result`, team.result ?? '', 'inputmode="decimal" required')}
        ${freeForAll ? '' : `<label>Award rule<select name="${team.id}-mode"><option value="equal" ${team.award?.mode === 'equal' ? 'selected' : ''}>Points per player</option><option value="split" ${team.award?.mode === 'split' ? 'selected' : ''}>Split total pool</option><option value="custom" ${team.award?.mode === 'custom' ? 'selected' : ''}>Custom per player</option></select></label>`}
        <div data-amount>${field(freeForAll ? 'Player points' : 'Award / pool', `${team.id}-amount`, team.award?.amount ?? '0', 'inputmode="decimal"')}</div></div><div data-custom class="form-grid">${freeForAll ? '' : team.members.map((member) => field(player(member.player_id).name, `${team.id}-${member.player_id}`, team.award?.custom?.[member.player_id] ?? '0', 'inputmode="decimal"')).join('')}</div></fieldset>`).join('')}${mvpSelectionMarkup(game)}${field(game.score_revision ? 'Reason for correction' : 'Note (optional)', 'reason', '', `${game.score_revision ? 'required' : ''} maxlength="500"`)}`,
        onInput: modes,
        onSubmit: async (form) => saver.save(read(form), form.elements.reason.value, form.elements.mvp_player_id?.value),
      });
      modes(form); installImageFallbacks(form);
      return form;
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
