import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankPlayers } from '../../src/domain/scoring.js';
import { renderLeaderboard } from '../../src/features/leaderboard/view.js';

test('leaderboard ties use consecutive ranks across the podium and list', () => {
  const players = [40, 30, 20, '20.00', 10, '10.00', 0, -5, -5].map((points, i) => ({ id: String(i), name: String(i), points }));
  assert.deepEqual(rankPlayers(players).map((row) => row.rank), [1, 2, 3, 3, 4, 4, 5, 6, 6]);
  assert.deepEqual(rankPlayers([]), []);
});

const render = (points) => {
  const root = { innerHTML: '', querySelectorAll: () => [] };
  renderLeaderboard(root, points.map((score, i) => ({ id: String(i), name: `Player ${i}`, points: score, titles: [] })), { imageUrl: () => '' });
  return root.innerHTML;
};

test('everyone tied in the top three places shares their step; lower ranks remain in the list', () => {
  const html = render([40, 40, 30, 30, 20, 20, 10, 10]);
  const steps = [...html.matchAll(/<section class="podium-player[\s\S]*?<\/section>/g)].map(([step]) => step);
  assert.equal(steps.length, 3);
  for (let rank = 1; rank <= 3; rank++) {
    const step = steps[rank - 1];
    assert.match(step, new RegExp(`podium-place-${rank}`));
    assert.equal((step.match(/class="podium-profile"/g) || []).length, 2);
    assert.equal((step.match(/class="podium-step"/g) || []).length, 1);
    assert.match(step, /Shared by 2 players/);
  }
  const list = html.split('<div class="player-list">')[1];
  assert.equal((list.match(/class="player-card rank-4"/g) || []).length, 2);
  for (let i = 0; i < 8; i++) assert.equal((html.match(new RegExp(`<h3>Player ${i}</h3>`, 'g')) || []).length, 1);
});

test('an all-zero roster has a regular list without podium places or rank-one labels', () => {
  for (const count of [1, 2, 64]) {
    const html = render(Array.from({ length: count }, (_, i) => i % 2 ? '0.00' : 0));
    assert.doesNotMatch(html, /podium|Shared by|rank-1|, rank 1,/);
    assert.equal((html.match(/class="player-card"/g) || []).length, count);
    assert.equal((html.match(/not ranked yet/g) || []).length, count);
    assert.equal((html.match(/class="player-rank">—/g) || []).length, count);
    for (let i = 0; i < count; i++) assert.equal((html.match(new RegExp(`<h3>Player ${i}</h3>`, 'g')) || []).length, 1);
  }
  assert.match(render([10, 0, 0]), /podium-place-2[\s\S]*Shared by 2 players/);
});

test('a fully tied nonzero 64-player board uses one shared first-place step without dropping anyone', () => {
  const html = render(Array(64).fill(10));
  assert.match(html, /data-places="1"/);
  assert.match(html, /Shared by 64 players/);
  assert.equal((html.match(/class="podium-profile"/g) || []).length, 64);
  assert.equal((html.match(/class="podium-step"/g) || []).length, 1);
  assert.doesNotMatch(html, /class="player-card/);
  assert.match(render([2, 1]), /data-places="2"/);
  assert.match(render([]), /No players yet/);
});
