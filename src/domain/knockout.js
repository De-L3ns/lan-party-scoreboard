export const knockoutMatches = (game) => [...(game.knockout_matches || [])].sort((a, b) => a.round - b.round || a.position - b.position);
export const knockoutRounds = (game) => [...new Set(knockoutMatches(game).map((match) => match.round))];
export function roundLabel(round, count) {
  const remaining = count - round;
  return remaining === 1 ? 'Final' : remaining === 2 ? 'Semifinals' : remaining === 3 ? 'Quarterfinals' : `Round of ${2 ** remaining}`;
}
export const matchLabel = (game, match) => `${roundLabel(match.round, knockoutRounds(game).length)} · Match ${match.position + 1}`;
export function knockoutChampion(game) {
  const final = knockoutMatches(game).at(-1);
  return final?.status === 'complete' ? final.winner_id : null;
}
export function knockoutPlaces(game) {
  const winner = knockoutChampion(game);
  if (!winner) return new Map();
  const rounds = knockoutRounds(game).length;
  const places = new Map([[winner, 1]]);
  for (const match of knockoutMatches(game)) {
    if (match.status !== 'complete') continue;
    const loser = [match.player1, match.player2].find((id) => id !== match.winner_id);
    if (loser) places.set(loser, 2 ** (rounds - match.round - 1) + 1);
  }
  return places;
}
export function validReveal(game, event) {
  const match = game.knockout_matches?.find((row) => row.id === event.match_id);
  const published = game.knockout_events?.find((row) => String(row.id) === String(event.id));
  return Boolean(event.valid && published?.valid !== false && match?.published && match.player1 && match.player2
    && match.player1 === event.player1 && match.player2 === event.player2);
}

// Presentation event IDs are monotonic strings (Postgres bigint); avoid Number precision loss.
export class KnockoutReveals {
  constructor() { this.cursor = null; this.queue = []; }
  update(game, hidden = false) {
    const events = [...(game.knockout_events || [])].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
    this.queue = this.queue.filter((event) => validReveal(game, event));
    const fresh = this.cursor === null || hidden ? [] : events.filter((event) => BigInt(event.id) > this.cursor && validReveal(game, event));
    if (events.length) this.cursor = BigInt(events.at(-1).id);
    else if (this.cursor === null) this.cursor = 0n;
    if (hidden) this.queue = [];
    else this.queue.push(...fresh);
    return this.queue;
  }
  clear() { this.queue = []; }
}
