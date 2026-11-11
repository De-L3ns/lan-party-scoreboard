import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KnockoutController } from '../../src/features/knockout/controller.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture({ admin = true, status = 'drafting' } = {}) {
  let hidden = false, failCommit = false, blockBegin;
  let state = { id: 'g', format: 'knockout', status, tournament_revision: 0, draft_revision: 0, rolling: false,
    participants: ['a', 'b', 'c', 'd'].map((id) => ({ player_id: id, name: id, titles: [] })),
    knockout_matches: [
      { id: 'm1', round: 0, position: 0, published: status !== 'drafting', player1: status !== 'drafting' ? 'a' : null, player2: status !== 'drafting' ? 'b' : null, status: status !== 'drafting' ? 'ready' : 'waiting' },
      { id: 'm2', round: 0, position: 1, published: true, player1: 'c', player2: 'd', status: 'ready' },
      { id: 'final', round: 1, position: 0, published: true, player1: null, player2: null, status: 'waiting' },
    ], knockout_events: [], knockout_last_result: null };
  const calls = [], effects = [], notices = [];
  const view = { bind(handlers) { this.handlers = handlers; }, update(game, controls) { this.state = controls; },
    reveal(game, match, options) { this.revealOptions = options; effects.push(match.id); }, close() {}, dispose() {}, focusMatch() {} };
  let controller;
  const refresh = async () => controller.update(structuredClone(state), admin);
  const api = { async mutate(operation, input) {
    calls.push({ operation, input });
    if (operation === 'begin_knockout_reveal') {
      if (blockBegin) await blockBegin;
      if (!state.rolling) { state.tournament_revision++; state.rolling = true; }
      return { id: 'reserved-pair', tournament_revision: state.tournament_revision };
    }
    if (operation === 'commit_knockout_reveal') {
      if (failCommit) { failCommit = false; throw new Error('Commit failed'); }
      assert.equal(input.reveal_id, 'reserved-pair');
      Object.assign(state.knockout_matches[0], { published: true, player1: 'a', player2: 'b', status: 'ready' });
      state.knockout_events.push({ id: '1', match_id: 'm1', kind: 'opening', player1: 'a', player2: 'b', valid: true });
      state.tournament_revision++; state.rolling = false; state.status = 'ready';
      return { match_id: 'm1' };
    }
    if (operation === 'record_knockout_winner') {
      assert.equal(input.tournament_revision, state.tournament_revision);
      const m = state.knockout_matches.find((row) => row.id === input.match_id);
      m.status = 'complete'; m.winner_id = input.winner_id; state.tournament_revision++;
      const final = state.knockout_matches[2];
      final[m.id === 'm1' ? 'player1' : 'player2'] = input.winner_id;
      if (final.player1 && final.player2) {
        final.status = 'ready'; state.knockout_events.push({ id: '2', match_id: final.id, kind: 'ready', player1: final.player1, player2: final.player2, valid: true });
      }
      return {};
    }
    if (operation === 'start_game') { state.status = 'playing'; return {}; }
    throw new Error('Unexpected operation');
  } };
  let started = 0;
  controller = new KnockoutController({}, { api, refresh, notify: (message) => notices.push(message), view,
    onStarted: () => { started++; controller.dispose(); }, isHidden: () => hidden });
  controller.update(structuredClone(state), admin);
  return { controller, view, calls, effects, notices, refresh, get state() { return state; }, get started() { return started; },
    publish(next) { state = structuredClone(next); return refresh(); },
    hide() { hidden = true; controller.stop(); }, show() { hidden = false; }, failCommit() { failCommit = true; },
    blockBegin(promise) { blockBegin = promise; } };
}

test('opening pairing is presented only after a successful commit and retries resume the reservation', async () => {
  const f = fixture(); f.failCommit();
  await f.controller.draw(); assert.deepEqual(f.effects, []); assert.equal(f.state.rolling, true);
  await f.controller.draw(); assert.deepEqual(f.effects, ['m1']);
  assert.equal(f.view.revealOptions.context, 'Tournament draw');
  f.view.revealOptions.onClose(); await f.refresh(); assert.deepEqual(f.effects, ['m1']);
});

test('double clicks cannot commit two pairs; hiding after reservation prevents unseen publication', async () => {
  const f = fixture(); let release;
  f.blockBegin(new Promise((resolve) => { release = resolve; }));
  const draw = f.controller.draw(); await flush(); await f.controller.draw();
  assert.equal(f.calls.length, 1);
  f.hide(); release(); await draw;
  assert.equal(f.calls.filter((call) => call.operation === 'commit_knockout_reveal').length, 0);
  assert.deepEqual(f.effects, []);
});

test('one winner waits; the second winner produces exactly one next-opponent reveal', async () => {
  const f = fixture({ status: 'playing' });
  f.controller.select('m1'); f.view.handlers.choose('a'); await f.controller.confirm();
  assert.deepEqual(f.effects, []);
  f.controller.select('m2'); f.view.handlers.choose('c'); await f.controller.confirm();
  assert.deepEqual(f.effects, ['final']); assert.equal(f.view.revealOptions.context, 'Next opponent confirmed');
  await f.refresh(); assert.deepEqual(f.effects, ['final']);
});

test('replay and dismissal preserve an unsubmitted winner selection and do not mutate state', () => {
  const f = fixture({ status: 'playing' });
  f.controller.select('m1'); f.view.handlers.choose('b'); f.controller.replay();
  f.view.revealOptions.onClose(); assert.equal(f.controller.choice, 'b'); assert.deepEqual(f.calls, []);
});

test('visitors observe newly published opponents but cannot draw, confirm, start, or undo', async () => {
  const f = fixture({ admin: false, status: 'playing' });
  await f.controller.draw(); await f.controller.start(); await f.controller.confirm();
  await f.controller.undo({}); assert.deepEqual(f.calls, []);
  const next = structuredClone(f.state), m = next.knockout_matches[0];
  next.knockout_events.push({ id: '1', match_id: m.id, kind: 'opening', player1: m.player1, player2: m.player2, valid: true });
  await f.publish(next); assert.deepEqual(f.effects, ['m1']);
  f.hide(); const newer = structuredClone(next); newer.knockout_events.push({ ...newer.knockout_events[0], id: '2' });
  f.show(); await f.publish(newer); assert.deepEqual(f.effects, ['m1']);
});

test('undo invalidation dismisses an obsolete pairing, and starting navigates even when its refresh would dispose the controller', async () => {
  const f = fixture({ status: 'playing' });
  const next = structuredClone(f.state), final = next.knockout_matches[2];
  Object.assign(final, { player1: 'a', player2: 'c', status: 'ready' });
  next.knockout_events.push({ id: '1', match_id: final.id, player1: 'a', player2: 'c', valid: true });
  await f.publish(next); assert.ok(f.controller.active);
  final.player2 = null; final.status = 'waiting'; next.knockout_events[0].valid = false;
  await f.publish(next); assert.equal(f.controller.active, null);
  const ready = fixture({ status: 'ready' }); await ready.controller.start();
  assert.equal(ready.started, 1); assert.equal(ready.controller.disposed, true);
});
