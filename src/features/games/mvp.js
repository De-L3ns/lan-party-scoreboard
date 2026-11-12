import { escapeHtml as h, imageMarkup } from '../../lib/html.js';

export function mvpSelectionMarkup(game) {
  const participants = [...game.participants].sort((a, b) => a.name.localeCompare(b.name));
  return `<label>MVP (optional)<select name="mvp_player_id"><option value="">No MVP</option>${participants.map((player) => `<option value="${h(player.player_id)}" ${player.player_id === game.mvp_player_id ? 'selected' : ''}>${h(player.name)}</option>`).join('')}</select></label>`;
}

export function gameMvpMarkup(game, api) {
  if (game.status !== 'completed' || !game.mvp_player_id) return '';
  const player = game.participants.find((row) => row.player_id === game.mvp_player_id);
  if (!player) return '';
  return `<section class="game-mvp" aria-label="Game MVP"><span class="game-mvp-star" aria-hidden="true">★</span>${imageMarkup(api.imageUrl(player.image_path), player.name, 'small-portrait')}<div><span class="game-mvp-label">MVP</span><strong>${h(player.name)}</strong>${player.titles?.length ? `<small>${h(player.titles.join(' · '))}</small>` : ''}</div></section>`;
}
