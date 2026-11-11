import { knockoutChampion } from './knockout.js';

export const activeGame = (games) => games.find((game) => game.status === 'playing');

export function gameScreen(game, requested = '', isAdmin = true) {
  if (!game) return 'players';
  if (game.status === 'completed') return requested === 'results' && isAdmin ? 'results' : 'report';
  if (game.status === 'playing') return requested === 'results' && isAdmin && (game.format !== 'knockout' || knockoutChampion(game)) ? 'results' : 'playing';
  if (!isAdmin) return game.format === 'ffa' ? 'playing' : 'draw';
  if (requested === 'players' || game.status === 'setup' || game.format === 'ffa') return 'players';
  if (requested === 'names' && game.status === 'ready' && game.format === 'teams') return 'names';
  return 'draw';
}

export function needsRedraw(game, input) {
  if (!game?.total_players) return false;
  const ids = new Set(input.player_ids);
  return game.format !== input.format || (input.format === 'teams' && game.team_count !== input.team_count)
    || ids.size !== game.participants.length || game.participants.some((player) => !ids.has(player.player_id));
}

export function validateTeamNames(teams) {
  const names = teams.map(({ id, name }) => ({ id, name: name.trim() }));
  if (names.some(({ name }) => !name || [...name].length > 40 || /^team [a-h]$/i.test(name))) {
    throw new Error('Give every team a name of 1–40 characters.');
  }
  if (new Set(names.map(({ name }) => name.toLowerCase())).size !== names.length) throw new Error('Give each team a different name.');
  return names;
}
