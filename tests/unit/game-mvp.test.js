import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gameMvpMarkup, mvpSelectionMarkup } from '../../src/features/games/mvp.js';
import { createResultSaver } from '../../src/features/games/result-saver.js';
import { applyScoreTransition } from '../../src/domain/score-reveal.js';
import { renderTeams } from '../../src/features/games/view.js';

const api = { imageUrl: path => path || '' };
function fixture() {
  const players = ['a', 'b'].map(id => ({ id, player_id: id, name: `Saved ${id}`, points: 0, titles: [], image_path: null }));
  const game = { id: 'g', name: 'Game', status: 'playing', score_revision: 0, mvp_player_id: null,
    participants: structuredClone(players), teams: [{ id: 't', position: 0, name: 'Team', result: null, members: players.map(p => ({ player_id: p.id })) }] };
  const board = { session: { id: 'lan' }, revision: 7, players, games: [game] };
  const entries = [{ id: 't', result: '1', mode: 'equal', amount: '5', player_ids: ['a', 'b'] }];
  const calls = [], saved = [];
  const make = (mutate = async (...args) => { calls.push(args); return { id: 'event' }; }) =>
    createResultSaver({ board, game, api: { mutate }, onSaved: t => saved.push(t) });
  return { board, game, entries, calls, saved, make };
}

test('MVP uses the saved game identity and escapes names, titles, IDs, and image paths', () => {
  const game = { status: 'completed', mvp_player_id: 'a"', participants: [
    { player_id: 'z', name: 'Zelda', titles: [] },
    { player_id: 'a"', name: 'Alice <script>', titles: ['<Captain>'], image_path: 'saved".png' },
  ] };
  const select = mvpSelectionMarkup(game), report = gameMvpMarkup(game, api);
  assert.ok(select.indexOf('Alice') < select.indexOf('Zelda'));
  assert.match(select, /value="a&quot;" selected/);
  assert.match(report, /Alice &lt;script&gt;/);
  assert.match(report, /&lt;Captain&gt;/);
  assert.match(report, /src="saved&quot;.png"/);
  assert.doesNotMatch(report, /<script>|<Captain>/);
  for (const update of [{ mvp_player_id: null }, { mvp_player_id: 'outsider' }, { status: 'playing' }]) {
    assert.equal(gameMvpMarkup({ ...game, ...update }, api), '');
  }
});

test('MVP saves with results, contributes no bonus, and stays coherent before the next board read', async () => {
  const f = fixture();
  await f.make().save(f.entries, '', 'b');
  assert.equal(f.calls[0][1].mvp_player_id, 'b');
  assert.deepEqual(f.saved[0].awards, [{ player_id: 'a', points: 5 }, { player_id: 'b', points: 5 }]);
  const confirmed = applyScoreTransition(f.board, f.saved[0]);
  assert.equal(confirmed.games[0].mvp_player_id, 'b');
  assert.match(gameMvpMarkup(confirmed.games[0], api), /Saved b/);
  assert.equal(f.game.mvp_player_id, null);
  const clear = applyScoreTransition(f.board, { ...f.saved[0], mvpPlayerId: null });
  assert.equal(clear.games[0].mvp_player_id, null);
});

test('unknown participants and an unapplied MVP migration fail before saving points', async () => {
  const f = fixture(), saver = f.make();
  f.game.participants.push({ player_id: 'later' });
  await assert.rejects(saver.save(f.entries, '', 'later'), /participants/);
  await assert.rejects(saver.save(f.entries, '', 'outsider'), /participants/);
  delete f.game.mvp_player_id;
  await assert.rejects(f.make().save(f.entries, '', 'a'), /database update/);
  assert.equal(f.calls.length, 0);
  await f.make().save(f.entries);
  assert.equal(Object.hasOwn(f.calls[0][1], 'mvp_player_id'), false);
});

test('MVP is optional, retained by default in corrections, and can be cleared explicitly', async () => {
  for (const [previous, selected, expected] of [[null, undefined, null], ['a', undefined, 'a'], ['a', '', null]]) {
    const f = fixture();
    f.game.mvp_player_id = previous;
    f.game.score_revision = 1;
    await f.make().save(f.entries, 'Change result', selected);
    assert.equal(f.calls[0][1].mvp_player_id, expected);
    assert.equal(f.saved[0].mvpPlayerId, expected);
  }
});

test('retrying a failed MVP save retains the same submission and reveals only the acknowledged result', async () => {
  const f = fixture(); let fail = true;
  const saver = f.make(async (...args) => { f.calls.push(args); if (fail) throw Error('Offline'); return { id: 'event' }; });
  await assert.rejects(saver.save(f.entries, '', 'b'), /Offline/);
  assert.equal(f.saved.length, 0);
  fail = false;
  await saver.save(f.entries, '', 'b');
  assert.deepEqual(f.calls[0], f.calls[1]);
  assert.equal(f.saved.length, 1);
});

test('team and individual reports show the saved MVP once and remove it when cleared', () => {
  for (const format of ['teams', 'ffa']) {
    const { game } = fixture();
    Object.assign(game, { format, status: 'completed', mvp_player_id: 'b' });
    if (format === 'ffa') game.teams = game.participants.map((p, i) => ({ id: p.player_id, position: i, result: 1, members: [{ player_id: p.player_id }] }));
    const root = { innerHTML: '', querySelectorAll: () => [], classList: { toggle() {} } };
    renderTeams(root, game, api);
    assert.equal((root.innerHTML.match(/aria-label="Game MVP"/g) || []).length, 1);
    assert.match(root.innerHTML, /game-mvp[\s\S]*?<strong>Saved b<\/strong>/);
    game.mvp_player_id = null; renderTeams(root, game, api);
    assert.doesNotMatch(root.innerHTML, /game-mvp/);
  }
});
