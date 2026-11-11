import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAdminForms } from '../../src/features/admin/forms.js';

function fixture({ awards = [], revision = 0 } = {}) {
  const names = { a: 'Alice', b: 'Bob', c: 'Aaron', d: 'Zelda' };
  const game = { id: 'g', name: 'Tekken', format: 'knockout', score_revision: revision, tournament_revision: 8, awards,
    participants: Object.entries(names).map(([player_id, name]) => ({ player_id, name, image_path: null })),
    teams: ['d', 'c', 'b', 'a'].map((id) => ({ id: `t${id}`, name: names[id], members: [{ player_id: id }] })),
    knockout_matches: [
      { id: 's1', round: 0, position: 0, status: 'complete', player1: 'a', player2: 'd', winner_id: 'a' },
      { id: 's2', round: 0, position: 1, status: 'complete', player1: 'b', player2: 'c', winner_id: 'b' },
      { id: 'f', round: 1, position: 0, status: 'complete', player1: 'a', player2: 'b', winner_id: 'a' }],
  };
  const calls = [], button = {}, preview = {};
  let page, saved = 0, failure;
  const form = { dataset: {}, elements: { 'rank-1-points': { value: '10' }, 'rank-2-points': { value: '5' }, 'rank-3-points': { value: '2.50' }, reason: { value: 'Correction' } },
    querySelectorAll: () => [], querySelector: (selector) => selector === '.result-preview' ? preview : button };
  const api = { imageUrl: () => '', mutate: async (...args) => { calls.push(args); if (failure) throw failure; } };
  const forms = createAdminForms({ getBoard: () => ({ revision: 42, players: Object.entries(names).map(([id, name]) => ({ id, name, points: 10 })) }),
    api, selectGame() {}, refresh: async () => { saved += 1; }, notify() {} });
  forms.result(game, { open(options) { page = options; return form; } });
  return { game, page, form, calls, preview, button, get saved() { return saved; }, fail(error) { failure = error; } };
}

test('one field per rank lists players and applies the full amount to each tied player', async () => {
  const { game, page, form, calls, preview } = fixture();
  assert.deepEqual([...page.content.matchAll(/data-rank="(\d+)"/g)].map((row) => row[1]), ['1', '2', '3']);
  assert.equal((page.content.match(/name="rank-\d+-points"/g) || []).length, 3);
  assert.match(page.content, /3rd place/);
  assert.ok(page.content.indexOf('Aaron') < page.content.indexOf('Zelda'));
  assert.deepEqual(game.teams.map((team) => team.id), ['td', 'tc', 'tb', 'ta']);
  assert.equal(await page.onSubmit(form), false);
  assert.equal(calls.length, 0);
  assert.equal((preview.innerHTML.match(/New total: 12.5/g) || []).length, 2);
  await page.onSubmit(form);
  assert.deepEqual(calls[0], ['save_result', { game_id: 'g', tournament_revision: 8, revision: 0, board_revision: 42,
    teams: [{ id: 'ta', result: '1', mode: 'equal', amount: '10' }, { id: 'tb', result: '2', mode: 'equal', amount: '5' },
      { id: 'tc', result: '3', mode: 'equal', amount: '2.50' }, { id: 'td', result: '3', mode: 'equal', amount: '2.50' }], reason: 'Correction' }]);
});

test('corrections prefill equal rank awards and subtract each previous contribution', () => {
  const { page, form, preview } = fixture({ revision: 1, awards: [{ player_id: 'a', points: 10 }, { player_id: 'b', points: 5 }, { player_id: 'c', points: 2.5 }, { player_id: 'd', points: '2.50' }] });
  assert.match(page.content, /name="rank-3-points" value="2.5"/);
  assert.match(page.content, /Reason for correction/);
  form.elements['rank-3-points'].value = '3.75';
  page.onInput(form);
  assert.equal((preview.innerHTML.match(/New total: 11.25/g) || []).length, 2);
});

test('legacy unequal tied awards require an explicit shared replacement', async () => {
  const { page, form, calls } = fixture({ revision: 1, awards: [{ player_id: 'c', points: 2 }, { player_id: 'd', points: 3 }] });
  assert.match(page.content, /name="rank-3-points" value=""/);
  assert.match(page.content, /Previous award: 2/);
  assert.match(page.content, /Previous award: 3/);
  form.elements['rank-3-points'].value = '';
  await assert.rejects(page.onSubmit(form), /3rd place: Enter a number/);
  form.elements['rank-3-points'].value = '2.555';
  await assert.rejects(page.onSubmit(form), /two decimal/);
  assert.equal(calls.length, 0);
});

test('editing invalidates confirmation; failed saves preserve rank values for retry', async () => {
  const f = fixture();
  await f.page.onSubmit(f.form);
  f.form.elements['rank-1-points'].value = '12.25';
  f.page.onInput(f.form);
  assert.equal(await f.page.onSubmit(f.form), false);
  assert.equal(f.calls.length, 0);
  f.fail(new Error('Connection lost'));
  await assert.rejects(f.page.onSubmit(f.form), /Connection lost/);
  assert.equal(f.saved, 0);
  assert.equal(f.form.elements['rank-1-points'].value, '12.25');
  f.fail(null);
  await f.page.onSubmit(f.form);
  assert.equal(f.saved, 1);
});
