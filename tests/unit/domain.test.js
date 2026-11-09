import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocate, previewAwards, rankPlayers, toCents } from '../../src/domain/scoring.js';
import { destinationForPick, validateDraft, validateParticipants } from '../../src/domain/draft.js';
import { escapeHtml } from '../../src/lib/html.js';

test('equal and custom awards use exact minor units', () => {
  assert.deepEqual(allocate({ mode: 'equal', amount: '10' }, ['a', 'b']).map((row) => row.cents), [1000, 1000]);
  assert.deepEqual(allocate({ mode: 'custom', custom: { a: '-1.25', b: '0' } }, ['a', 'b']).map((row) => row.cents), [-125, 0]);
});
test('split pools preserve cents, including negative adjustments', () => {
  assert.deepEqual(allocate({ mode: 'split', amount: '10' }, ['a', 'b', 'c']).map((row) => row.cents), [333, 333, 334]);
  assert.deepEqual(allocate({ mode: 'split', amount: '-10' }, ['a', 'b', 'c']).map((row) => row.cents), [-333, -333, -334]);
});
test('invalid precision and non-finite values never enter a preview', () => {
  for (const value of ['', 'NaN', 'Infinity', '1.001', '1e2', '999999999999']) assert.throws(() => toCents(value));
  assert.equal(toCents('-0.01'), -1);
  assert.throws(() => allocate({ mode: 'equal', amount: 10 }, []));
});
test('correcting a previous result replaces its contribution', () => {
  const rows = previewAwards([{ mode: 'equal', amount: 5, player_ids: ['a'] }], [{ id: 'a', points: 30 }], [{ player_id: 'a', points: 10 }]);
  assert.deepEqual(rows, [{ player_id: 'a', award: 5, before: 30, after: 25 }]);
});
test('ties share a rank without mutating the roster', () => {
  const rows = [{ name: 'B', points: 10 }, { name: 'A', points: 10 }, { name: 'C', points: 5 }];
  assert.deepEqual(rankPlayers(rows).map(({ name, rank }) => [name, rank]), [['A', 1], ['B', 1], ['C', 3]]);
  assert.equal(rows[0].name, 'B');
});
test('draft destinations cycle A B C and keep extras on earliest teams', () => {
  assert.deepEqual(Array.from({ length: 5 }, (_, index) => destinationForPick(index, 2)), [0, 1, 0, 1, 0]);
  assert.deepEqual(Array.from({ length: 7 }, (_, index) => destinationForPick(index, 3)), [0, 1, 2, 0, 1, 2, 0]);
  assert.throws(() => validateDraft(['a', 'a'], 2));
  assert.throws(() => validateDraft(['a', 'b'], 3));
  assert.doesNotThrow(() => validateDraft(['a', 'b'], 2));
});
test('profile and game text cannot inject HTML', () => {
  assert.equal(escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
});

test('free-for-all accepts up to 64 distinct participants without a team count', () => {
  const ids = Array.from({ length: 64 }, (_, index) => `player-${index}`);
  assert.doesNotThrow(() => validateParticipants(ids));
  for (const invalid of [[], ['a'], ['a', 'a'], [...ids, 'extra']]) assert.throws(() => validateParticipants(invalid));
  assert.throws(() => validateDraft(ids, 64));
});

test('individual result corrections replace only each participant’s prior award', () => {
  const rows = previewAwards([
    { mode: 'equal', amount: '7.25', player_ids: ['a'] },
    { mode: 'equal', amount: '2', player_ids: ['b'] },
  ], [{ id: 'a', points: 20 }, { id: 'b', points: 9 }], [{ player_id: 'a', points: 10 }, { player_id: 'b', points: 5 }]);
  assert.deepEqual(rows.map(({ player_id, after }) => ({ player_id, after })), [{ player_id: 'a', after: 17.25 }, { player_id: 'b', after: 6 }]);
});
