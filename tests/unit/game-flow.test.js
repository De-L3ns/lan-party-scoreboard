import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeGame, gameScreen, needsRedraw, validateTeamNames } from '../../src/domain/game-flow.js';
import { renderGames, renderTeams } from '../../src/features/games/view.js';

test('returning from names preserves a completed draft and started games cannot return to setup', () => {
  const ready = { status: 'ready', format: 'teams' };
  assert.equal(gameScreen(ready), 'draw');
  assert.equal(gameScreen(ready, 'names'), 'names');
  assert.equal(gameScreen(ready, 'draw'), 'draw');
  assert.equal(gameScreen({ ...ready, status: 'drafting' }, 'names'), 'draw');
  for (const requested of ['', 'players', 'draw', 'names']) {
    assert.equal(gameScreen({ ...ready, status: 'playing' }, requested), 'playing');
    assert.equal(gameScreen({ ...ready, status: 'completed' }, requested), 'report');
  }
  assert.equal(gameScreen({ status: 'playing' }, 'results'), 'results');
  assert.equal(gameScreen({ status: 'completed' }, 'results'), 'results');
});

test('free-for-all skips team assignment and names, including resumed setups', () => {
  assert.equal(gameScreen({ format: 'ffa', status: 'ready' }, 'names'), 'players');
  assert.equal(gameScreen({ format: 'ffa', status: 'playing' }), 'playing');
});

test('public links resolve to read-only drafts, game rosters, or reports', () => {
  for (const requested of ['players', 'names', 'results']) {
    assert.equal(gameScreen({ format: 'teams', status: 'ready' }, requested, false), 'draw');
    assert.equal(gameScreen({ format: 'teams', status: 'playing' }, requested, false), 'playing');
    assert.equal(gameScreen({ format: 'teams', status: 'completed' }, requested, false), 'report');
  }
});

test('only changed membership, format, or team count needs a confirmed redraw', () => {
  const game = { format: 'teams', team_count: 2, total_players: 3, participants: [{ player_id: 'a' }, { player_id: 'b' }, { player_id: 'c' }] };
  const input = { format: 'teams', team_count: 2, player_ids: ['c', 'b', 'a'] };
  assert.equal(needsRedraw(game, input), false);
  assert.equal(needsRedraw(game, { ...input, name: 'New game name', direction: 'lower' }), false);
  assert.equal(needsRedraw(game, { ...input, team_count: 3 }), true);
  assert.equal(needsRedraw(game, { ...input, format: 'ffa' }), true);
  assert.equal(needsRedraw(game, { ...input, player_ids: ['a', 'b'] }), true);
  assert.equal(needsRedraw(game, { ...input, player_ids: ['a', 'b', 'd'] }), true);
  assert.equal(needsRedraw(null, input), false);
  assert.equal(needsRedraw({ ...game, total_players: 0 }, input), false);
});

test('team names must be entered, distinct after trimming, and within the length limit', () => {
  for (const name of ['', ' \t\n ', 'a'.repeat(41), 'Team A', 'team h']) {
    assert.throws(() => validateTeamNames([{ id: 'one', name }]));
  }
  assert.throws(() => validateTeamNames([{ id: 'one', name: ' Pirates ' }, { id: 'two', name: 'pirates' }]));
  assert.deepEqual(validateTeamNames([{ id: 'one', name: '  Packet Pirates  ' }, { id: 'two', name: 'Rush Hour' }]), [{ id: 'one', name: 'Packet Pirates' }, { id: 'two', name: 'Rush Hour' }]);
  assert.doesNotThrow(() => validateTeamNames([{ id: 'one', name: 'a'.repeat(40) }]));
});

const api = { imageUrl: () => null };
const root = () => ({ innerHTML: '', querySelectorAll: () => [], classList: { toggle() {} } });
const participant = { player_id: 'p', name: 'Nova', image_path: null, titles: [] };
const game = { id: 'g', name: 'Counter-Strike', format: 'teams', status: 'playing', total_players: 1, participants: [participant], teams: [{ id: 't', position: 0, name: 'Rush <Hour>', result: null, members: [{ player_id: 'p' }] }] };

test('scoreboard has no idle tile; the active tile uses escaped team names and opens the game', () => {
  const element = root();
  renderGames(element, [], api, true);
  assert.equal(element.innerHTML, '');
  renderGames(element, [game], api, true);
  assert.match(element.innerHTML, /Active game/);
  assert.match(element.innerHTML, /In progress/);
  assert.match(element.innerHTML, /Rush &lt;Hour&gt;/);
  assert.match(element.innerHTML, /data-action="select-game" data-id="g"/);
  assert.equal(activeGame([{ ...game, status: 'completed' }, game]), game);
  assert.equal(activeGame([{ ...game, status: 'completed' }]), undefined);
});

test('visitors can open a revealed draft and completed report without setup controls', () => {
  const element = root();
  renderGames(element, [{ ...game, status: 'setup', total_players: 0 }, { ...game, id: 'draft', status: 'drafting' }, { ...game, id: 'done', status: 'completed' }], api, false);
  assert.doesNotMatch(element.innerHTML, /data-id="g"/);
  assert.match(element.innerHTML, /View draft/);
  assert.match(element.innerHTML, /Report/);
  assert.doesNotMatch(element.innerHTML, /Continue setup/);
});

test('in-progress rosters show the assigned players with no ready labels or invented results', () => {
  const element = root();
  renderTeams(element, game, api);
  assert.match(element.innerHTML, /Nova/);
  assert.match(element.innerHTML, /Rush &lt;Hour&gt;/);
  renderTeams(element, { ...game, format: 'ffa' }, api);
  assert.match(element.innerHTML, /Nova/);
  assert.doesNotMatch(element.innerHTML, /Rush|Ready|<small>result<\/small>/);
});
