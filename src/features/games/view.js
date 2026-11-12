import { escapeHtml as h, formatPoints, imageMarkup, installImageFallbacks, setHtml } from '../../lib/html.js';
import { gameMvpMarkup } from './mvp.js';

export const formatLabel = (game) => ({ ffa: 'Free-for-all', teams: 'Team-based', knockout: 'Knockout Tournament' })[game.format] || 'Team-based';
export const statusLabel = (game) => ({ setup: 'Setup', drafting: 'Drafting', ready: game.format === 'knockout' ? 'Bracket ready' : game.format === 'ffa' ? 'Players ready' : 'Teams ready', playing: 'In progress', completed: 'Completed' }[game.status]);

export function renderGames(root, games, api, canManage = false) {
  const active = games.find((game) => game.status === 'playing');
  const pending = games.filter((game) => ['setup', 'drafting', 'ready'].includes(game.status) && (canManage || (game.format !== 'ffa' && game.total_players > 0)));
  const completed = games.filter((game) => game.status === 'completed');
  const tile = active ? `<button class="active-game-tile" data-action="select-game" data-id="${active.id}"><span class="eyebrow">Active game</span><span class="status-label">In progress</span><strong>${h(active.name)}</strong>${active.details ? `<span class="muted">${h(active.details)}</span>` : ''}<span class="active-matchup">${active.format !== 'teams' ? formatLabel(active) : active.teams.map((team) => h(team.name)).join(' · ')}</span><span class="active-avatars">${active.participants.slice(0, 8).map((player) => imageMarkup(api.imageUrl(player.image_path), player.name, 'small-portrait')).join('')}</span><span class="tile-bottom">${active.participants.length} players <span aria-hidden="true">↗</span></span></button>` : '';
  const cards = (rows, label) => rows.length ? `<h2 class="games-label">${label}</h2>${rows.map((game) => `<button class="game-card" data-action="select-game" data-id="${game.id}"><span><strong>${h(game.name)}</strong><small>${formatLabel(game)}</small>${game.details ? `<small>${h(game.details)}</small>` : ''}</span><span class="status-label">${game.status === 'completed' ? 'Report ↗' : canManage ? 'Continue setup →' : 'View draft ↗'}</span></button>`).join('')}` : '';
  if (setHtml(root, tile + cards(pending, canManage ? 'Setup' : 'Game draws') + cards(completed, 'Completed games'))) installImageFallbacks(root);
}

export function rosterMarkup(game, team, api) {
  return team.members.map((member) => {
    const player = game.participants.find((row) => row.player_id === member.player_id);
    return `<li>${imageMarkup(api.imageUrl(player.image_path), player.name, 'small-portrait')}<div><strong>${h(player.name)}</strong><small>${h(player.titles.join(' · '))}</small></div></li>`;
  }).join('');
}

export function renderTeams(root, game, api) {
  const teams = [...game.teams].sort((a, b) => {
    if (a.result === null || b.result === null) return a.position - b.position;
    return (game.direction === 'lower' ? 1 : -1) * (Number(a.result) - Number(b.result)) || a.position - b.position;
  });
  root.classList.toggle('individual-results', game.format === 'ffa');
  if (game.format === 'ffa') {
    const html = gameMvpMarkup(game, api) + teams.map((team) => {
      const player = game.participants.find((row) => row.player_id === team.members[0]?.player_id);
      return `<article class="individual-result">${imageMarkup(api.imageUrl(player.image_path), player.name)}<div class="player-details"><h3>${h(player.name)}</h3><small class="muted">${h(player.titles.join(' · '))}</small></div>${team.result === null ? '' : `<strong class="individual-score">${formatPoints(team.result)}<small>result</small></strong>`}</article>`;
    }).join('');
    if (setHtml(root, html)) installImageFallbacks(root);
    return;
  }
  const html = gameMvpMarkup(game, api) + teams.map((team) => `<section class="team-card" style="--team-color:var(--team-${team.position % 4})"><header><h3>${h(team.name)}</h3>${team.result === null ? '' : `<strong>${formatPoints(team.result)}</strong>`}</header><ul>${rosterMarkup(game, team, api)}</ul></section>`).join('');
  if (setHtml(root, html)) installImageFallbacks(root);
}
