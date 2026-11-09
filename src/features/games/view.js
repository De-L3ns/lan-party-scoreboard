import { escapeHtml as h, formatPoints, imageMarkup, installImageFallbacks } from '../../lib/html.js';

export const formatLabel = (game) => game.format === 'ffa' ? 'Free-for-all' : 'Team-based';
export const statusLabel = (game) => ({ setup: 'Setup', drafting: 'Drafting', ready: game.format === 'ffa' ? 'Players ready' : 'Teams ready', playing: 'In play', completed: 'Completed' }[game.status]);

export function renderGames(root, games, selectedId) {
  root.innerHTML = games.length ? games.map((game) => `<button class="game-card ${selectedId === game.id ? 'selected' : ''}" data-action="select-game" data-id="${game.id}" aria-pressed="${selectedId === game.id}"><span><strong>${h(game.name)}</strong><small>${formatLabel(game)}</small>${game.details ? `<small>${h(game.details)}</small>` : ''}</span><span class="status-label">${statusLabel(game)}</span></button>`).join('') : '<p class="empty-state">No games yet.</p>';
}

export function renderTeams(root, game, api) {
  const teams = [...game.teams].sort((a, b) => {
    if (a.result === null || b.result === null) return a.position - b.position;
    return (game.direction === 'lower' ? 1 : -1) * (Number(a.result) - Number(b.result)) || a.position - b.position;
  });
  root.classList.toggle('individual-results', game.format === 'ffa');
  if (game.format === 'ffa') {
    root.innerHTML = teams.map((team) => {
      const player = game.participants.find((row) => row.player_id === team.members[0]?.player_id);
      return `<article class="individual-result">${imageMarkup(api.imageUrl(player.image_path), player.name)}<div class="player-details"><h3>${h(player.name)}</h3><small class="muted">${h(player.titles.join(' · '))}</small></div><strong class="individual-score">${team.result === null ? '<small>Ready</small>' : `${formatPoints(team.result)}<small>result</small>`}</strong></article>`;
    }).join('');
    installImageFallbacks(root);
    return;
  }
  root.innerHTML = teams.map((team) => `<section class="team-card" style="--team-color:var(--team-${team.position % 4})"><header><h3>${h(team.name)}</h3><strong>${team.result === null ? `${team.members.length} players` : formatPoints(team.result)}</strong></header><ul>${team.members.map((member) => {
    const player = game.participants.find((row) => row.player_id === member.player_id);
    return `<li>${imageMarkup(api.imageUrl(player.image_path), player.name, 'small-portrait')}<div><strong>${h(player.name)}</strong><small>${h(player.titles.join(' · '))}</small></div></li>`;
  }).join('') || '<li class="muted">Awaiting players</li>'}</ul></section>`).join('');
  installImageFallbacks(root);
}
