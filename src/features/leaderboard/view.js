import { rankPlayers } from '../../domain/scoring.js';
import { escapeHtml as h, formatPoints, imageMarkup, installImageFallbacks } from '../../lib/html.js';

export function renderLeaderboard(root, players, api) {
  const ranked = rankPlayers(players);
  if (!ranked.length) {
    root.innerHTML = '<p class="empty-state">No players yet. An admin can add the first players.</p>';
    return;
  }
  const card = (player) => `<article class="player-card rank-${player.rank}" aria-label="${h(player.name)}, rank ${player.rank}, ${formatPoints(player.points)} points">
    <span class="player-rank">${player.rank}</span>${imageMarkup(api.imageUrl(player.image_path), player.name)}
    <div class="player-details"><h3>${h(player.name)}</h3>${player.titles.map((title) => `<span class="player-title">${h(title)}</span>`).join('')}${player.archived ? '<small class="muted">Archived player</small>' : ''}</div>
    <strong class="player-points">${formatPoints(player.points)}<small>points</small></strong></article>`;
  const podium = (player, index) => `<article class="podium-player podium-place-${index + 1} medal-${player.rank}" aria-label="${h(player.name)}, rank ${player.rank}, ${formatPoints(player.points)} points">
    <div class="podium-profile">${imageMarkup(api.imageUrl(player.image_path), player.name)}
      <div class="player-details"><h3>${h(player.name)}</h3>${player.titles.map((title) => `<span class="player-title">${h(title)}</span>`).join('')}${player.archived ? '<small class="muted">Archived player</small>' : ''}</div>
    </div>
    <div class="podium-step"><span class="podium-medal"><span class="podium-rank">${player.rank}</span></span>
      <strong class="player-points">${formatPoints(player.points)}<small>points</small></strong></div>
  </article>`;
  root.innerHTML = `<div class="podium" aria-label="Top three players">${ranked.slice(0, 3).map(podium).join('')}</div><div class="player-list">${ranked.slice(3).map(card).join('')}</div>`;
  installImageFallbacks(root);
}
