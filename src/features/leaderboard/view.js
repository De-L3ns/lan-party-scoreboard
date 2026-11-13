import { rankPlayers } from '../../domain/scoring.js';
import { escapeHtml as h, formatPoints, imageMarkup, installImageFallbacks, setHtml } from '../../lib/html.js';

export function renderLeaderboard(root, players, api, games = []) {
  const ranked = rankPlayers(players);
  if (!ranked.length) {
    setHtml(root, '<p class="empty-state">No players yet. An admin can add the first players.</p>');
    return;
  }
  const mvpCounts = new Map();
  for (const game of games) {
    if (game.status === 'completed' && game.mvp_player_id) {
      mvpCounts.set(game.mvp_player_id, (mvpCounts.get(game.mvp_player_id) ?? 0) + 1);
    }
  }
  const stars = (player) => {
    const count = mvpCounts.get(player.id) ?? 0;
    if (!count) return '';
    const label = `${count} MVP ${count === 1 ? 'award' : 'awards'}`;
    return `<span class="player-mvp-stars" role="img" aria-label="${label}" title="${label}">${'<span class="player-mvp-star" aria-hidden="true">★</span>'.repeat(count)}</span>`;
  };
  const allZero = ranked.every((player) => Number(player.points) === 0);
  const card = (player) => `<article class="player-card${allZero ? '' : ` rank-${player.rank}`}" aria-label="${h(player.name)}, ${allZero ? 'not ranked yet' : `rank ${player.rank}`}, ${formatPoints(player.points)} points">
    <span class="player-rank">${allZero ? '—' : player.rank}</span>${imageMarkup(api.imageUrl(player.image_path), player.name)}
    <div class="player-details"><h3>${h(player.name)}</h3>${stars(player)}${player.titles.map((title) => `<span class="player-title">${h(title)}</span>`).join('')}${player.archived ? '<small class="muted">Archived player</small>' : ''}</div>
    <strong class="player-points">${formatPoints(player.points)}<small>points</small></strong></article>`;
  if (allZero) {
    if (setHtml(root, `<div class="player-list">${ranked.map(card).join('')}</div>`)) installImageFallbacks(root);
    return;
  }
  const profile = (player) => `<article class="podium-profile" aria-label="${h(player.name)}, rank ${player.rank}, ${formatPoints(player.points)} points">${imageMarkup(api.imageUrl(player.image_path), player.name)}
      <div class="player-details"><h3>${h(player.name)}</h3>${stars(player)}${player.titles.map((title) => `<span class="player-title">${h(title)}</span>`).join('')}${player.archived ? '<small class="muted">Archived player</small>' : ''}</div>
    </article>`;
  const groups = [1, 2, 3].map((rank) => ranked.filter((player) => player.rank === rank)).filter((group) => group.length);
  const podium = (group) => {
    const first = group[0], shared = group.length > 1;
    return `<section class="podium-player podium-place-${first.rank} medal-${first.rank}${shared ? ' shared-podium' : ''}" aria-label="${shared ? 'Shared ' : ''}place ${first.rank}">
      <div class="podium-profiles">${group.map(profile).join('')}</div>
      <div class="podium-step"><span class="podium-medal"><span class="podium-rank">${first.rank}</span></span>${shared ? `<span class="podium-shared">Shared by ${group.length} players</span>` : ''}
        <strong class="player-points">${formatPoints(first.points)}<small>${shared ? 'points each' : 'points'}</small></strong></div>
    </section>`;
  };
  if (setHtml(root, `<div class="podium" data-places="${groups.length}" aria-label="Top three places">${groups.map(podium).join('')}</div><div class="player-list">${ranked.filter((player) => player.rank > 3).map(card).join('')}</div>`)) installImageFallbacks(root);
}
