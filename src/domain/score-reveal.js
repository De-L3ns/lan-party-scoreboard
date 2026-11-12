import { previewAwards, rankPlayers, toCents } from './scoring.js';

export function freezeSnapshot(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeSnapshot);
    Object.freeze(value);
  }
  return value;
}

// Capture when entry opens, not when a later realtime refetch replaces the board.
export function captureScoreBaseline(board, game) {
  return freezeSnapshot(structuredClone({
    sessionId: board.session.id, gameId: game.id, gameName: game.name,
    boardRevision: board.revision, scoreRevision: game.score_revision,
    ...(game.format === 'knockout' ? { tournamentRevision: game.tournament_revision } : {}),
    players: board.players, previous: game.awards ?? [],
  }));
}

export function scoreTransition(baseline, teams) {
  const awards = new Map(previewAwards(teams, baseline.players, baseline.previous).map((row) => [row.player_id, row]));
  const before = rankPlayers(baseline.players);
  const after = rankPlayers(baseline.players.map((player) => ({ ...player, points: awards.get(player.id)?.after ?? player.points })));
  const afterById = new Map(after.map((player, index) => [player.id, { player, index }]));
  const rows = before.map((player, beforeIndex) => {
    const next = afterById.get(player.id);
    return {
      ...player, beforeIndex, afterIndex: next.index, beforeRank: player.rank, afterRank: next.player.rank,
      beforePoints: Number(player.points), afterPoints: Number(next.player.points),
      pointChange: (Math.round(Number(next.player.points) * 100) - toCents(player.points)) / 100,
      placeChange: player.rank - next.player.rank,
    };
  });
  return freezeSnapshot({
    sessionId: baseline.sessionId, gameId: baseline.gameId, gameName: baseline.gameName,
    boardRevision: baseline.boardRevision, scoreRevision: baseline.scoreRevision,
    before, after, rows,
    teams: structuredClone(teams.map(({ player_ids, ...team }) => team)),
    awards: [...awards.values()].map((row) => ({ player_id: row.player_id, points: row.award })),
  });
}

// Reflect an acknowledged result while a normal read obtains the new server
// revision. Never replace a newer read with this operation's older snapshot.
export function applyScoreTransition(board, transition) {
  if (board.session.id !== transition.sessionId || board.revision !== transition.boardRevision) return board;
  const entries = new Map(transition.teams.map((team) => [team.id, team]));
  return { ...board, players: transition.after,
    games: board.games.map((game) => game.id !== transition.gameId ? game : {
      ...game, status: 'completed', score_revision: transition.scoreRevision + 1, awards: transition.awards,
      ...(Object.hasOwn(transition, 'mvpPlayerId') ? { mvp_player_id: transition.mvpPlayerId } : {}),
      teams: game.teams.map((team) => {
        const entry = entries.get(team.id);
        if (!entry) return team;
        const { id, result, ...award } = entry;
        return { ...team, result: Number(result), award };
      }),
    }),
  };
}
