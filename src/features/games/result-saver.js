import { captureScoreBaseline, freezeSnapshot, scoreTransition } from '../../domain/score-reveal.js';
import { toCents } from '../../domain/scoring.js';

// Shared by individual, team, and bracket-derived awards. Only acknowledgement
// can publish a transition; retries always retain the original board revision.
export function createResultSaver({ board, game, api, onSaved }) {
  const baseline = captureScoreBaseline(board, game);
  const supportsMvp = Object.hasOwn(game, 'mvp_player_id');
  const previousMvp = game.mvp_player_id ?? null;
  const participants = new Set((game.participants ?? []).map((player) => player.player_id));
  let pending;
  let saved;
  return {
    async save(entries, reason = '', mvpPlayerId = previousMvp) {
      if (saved) return saved;
      if (pending) return pending;
      const teams = structuredClone(entries);
      for (const team of teams) toCents(team.result);
      reason = reason.trim();
      if (baseline.scoreRevision > 0 && !reason) throw new Error('A correction needs a reason.');
      if (reason.length > 500) throw new Error('Reason exceeds 500 characters.');
      mvpPlayerId = mvpPlayerId || null;
      if (mvpPlayerId && !participants.has(mvpPlayerId)) throw new Error('Choose an MVP from this game’s participants.');
      if (mvpPlayerId && !supportsMvp) throw new Error('MVP selection needs a database update. Apply the game MVP migration before saving an MVP.');
      const transition = scoreTransition(baseline, teams);
      const input = freezeSnapshot({
        game_id: baseline.gameId, revision: baseline.scoreRevision, board_revision: baseline.boardRevision,
        ...(baseline.tournamentRevision !== undefined ? { tournament_revision: baseline.tournamentRevision } : {}),
        ...(supportsMvp ? { mvp_player_id: mvpPlayerId } : {}),
        teams: teams.map(({ player_ids, ...team }) => team), reason,
      });
      pending = (async () => {
        let result;
        try { result = await api.mutate('save_result', input); }
        catch (error) {
          if (/^Scores changed\./.test(error.message)) {
            const failure = new Error('Scores changed. Return to the scoreboard, refresh, and reopen results to review before saving.', { cause: error });
            failure.code = error.code; throw failure;
          }
          throw error;
        }
        saved = freezeSnapshot({ ...transition, eventId: result.id, ...(supportsMvp ? { mvpPlayerId } : {}) });
        await onSaved(saved);
        return saved;
      })();
      try { return await pending; }
      finally { pending = null; }
    },
  };
}
