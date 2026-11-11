import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankPlayers } from '../../src/domain/scoring.js';

test('leaderboard ties use consecutive ranks across the podium and list', () => {
  const players = [40, 30, 20, '20.00', 10, '10.00', 0, -5, -5].map((points, i) => ({ id: String(i), name: String(i), points }));
  assert.deepEqual(rankPlayers(players).map((row) => row.rank), [1, 2, 3, 3, 4, 4, 5, 6, 6]);
  assert.deepEqual(rankPlayers([]), []);
});
