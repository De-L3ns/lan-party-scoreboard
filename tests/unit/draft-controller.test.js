import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DraftController } from '../../src/features/teams/controller.js';
import { checkSignal } from '../../src/features/teams/motion.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture(count = 2) {
  const events = [], notices = [], calls = [], root = { hidden: false };
  let hidden = false, permission = true, pending = null, failCommit = false;
  let server = { id: 'game', format: 'teams', picker_mode: 'rifle', status: 'drafting', draft_revision: 0, pick_count: 0, total_players: count, team_count: 2, rolling: false,
    participants: Array.from({ length: count }, (_, i) => ({ player_id: `p${i}`, name: `Player ${i}`, image_path: null, titles: [] })),
    teams: [{ id: 'a', position: 0, name: 'Team A', members: [] }, { id: 'b', position: 1, name: 'Team B', members: [] }] };
  const view = {
    bind(handlers) { this.handlers = handlers; }, audio() {}, reduced: () => false,
    setFullMotion(value) { this.fullMotion = value; events.push(['full-motion', value]); },
    update(game) { events.push(['view', game.pick_count]); },
    controls(state) { this.state = state; root.hidden = state.complete && !state.busy; },
    complete() { events.push(['complete']); }, pending() { events.push(['pending']); },
    stopGeneric() {}, cancel() { events.push(['cancel']); }, dispose() { events.push(['dispose']); },
    announce(message) { events.push(['announce', message]); },
    async aim(id, { signal }) { checkSignal(signal); events.push(['aim', id]); },
    async drive(id, signal) { checkSignal(signal); events.push(['drive', id]); },
    async impact(id, signal) { checkSignal(signal); events.push(['impact', id]); },
  };
  const audio = {
    enabled: true, subscribe(listener) { listener({ enabled: true, error: '' }); return () => events.push(['unsubscribe']); },
    async unlock() { events.push(['unlock']); return true; },
    startSpin() { events.push(['spin-sound']); }, stopSpin() {}, stopAll() { events.push(['silence']); }, tick() {},
    drive() { events.push(['engine']); }, impact(mode) { events.push(['impact-sound', mode]); },
    setEnabled(value) { this.enabled = value; }, async preview() {},
  };
  let controller;
  const snapshot = () => structuredClone(server);
  const refresh = async () => controller.update(snapshot(), permission);
  const api = { imageUrl: () => null, async mutate(operation, input) {
    calls.push({ operation, input });
    if (operation === 'begin_roll') {
      if (input.revision !== server.draft_revision) throw Error('Stale draft');
      if (!pending) {
        server.rolling = true; server.draft_revision += 1;
        pending = { id: `roll-${server.pick_count}`, revision: server.draft_revision, index: server.pick_count, team_position: server.pick_count % 2, player: server.participants[server.pick_count] };
      }
      await refresh(); return structuredClone(pending);
    }
    if (operation === 'commit_roll') {
      if (failCommit) { failCommit = false; throw Error('Network failed'); }
      assert.equal(input.roll_id, pending.id);
      assert.equal(input.revision, pending.revision);
      const team = server.teams[pending.team_position];
      team.members.push({ player_id: pending.player.player_id, team_id: team.id, pick_index: pending.index });
      server.pick_count += 1; server.draft_revision += 1; server.rolling = false;
      server.status = server.pick_count === count ? 'ready' : 'drafting'; pending = null;
      events.push(['committed']); return { team_id: team.id };
    }
    if (operation === 'set_picker_mode') {
      assert.equal(server.rolling, false); assert.equal(input.revision, server.draft_revision);
      server.picker_mode = input.picker_mode; server.draft_revision += 1; return {};
    }
    throw Error('Unexpected operation');
  } };
  controller = new DraftController(root, { api, refresh, notify: (...args) => notices.push(args), view, audio, isHidden: () => hidden, pause: async (ms, signal) => { events.push(['pause', ms]); checkSignal(signal); } });
  controller.update(snapshot(), true);
  return { controller, view, audio, root, calls, events, notices, refresh, snapshot, get server() { return server; },
    setHidden(value) { hidden = value; }, setPermission(value) { permission = value; }, failNextCommit() { failCommit = true; },
    publish(game) { server = structuredClone(game); controller.update(snapshot(), permission); } };
}

test('final assignment is confirmed before success effects; completion collapses only after the reveal', async () => {
  const f = fixture();
  await f.controller.spin();
  let release;
  f.view.impact = async () => { await new Promise((resolve) => { release = resolve; }); };
  const last = f.controller.spin(); await flush();
  assert.equal(f.server.status, 'ready');
  assert.equal(f.root.hidden, false, 'Keep the final reveal visible until it finishes');
  release(); await last;
  assert.equal(f.root.hidden, true);
  assert.ok(f.events.findIndex(([name]) => name === 'committed') < f.events.findIndex(([name]) => name === 'impact'));
  assert.ok(f.events.some(([name]) => name === 'complete'));
  const effects = f.events.filter(([name]) => name === 'impact').length;
  await f.refresh();
  assert.equal(f.events.filter(([name]) => name === 'impact').length, effects, 'Refetching ready teams must not replay a pick');
});

test('TrackMania aligns and drives into the reserved player; only a successful commit triggers impact', async () => {
  const f = fixture(); await f.controller.setMode('trackmania');
  await f.controller.spin();
  const names = f.events.map(([name]) => name);
  assert.ok(names.indexOf('aim') < names.indexOf('drive'));
  assert.ok(names.indexOf('drive') < names.indexOf('committed'));
  assert.ok(names.indexOf('committed') < names.indexOf('impact'));
  assert.deepEqual(f.events.find(([name]) => name === 'impact-sound'), ['impact-sound', 'trackmania']);
  f.controller.dispose();
});

test('organizer spins keep full timing under reduced motion and clear the override afterward', async () => {
  const f = fixture();
  f.view.reduced = () => !f.view.fullMotion;
  let release;
  f.view.aim = async (_, { signal, duration }) => {
    assert.equal(f.view.fullMotion, true); assert.equal(f.view.reduced(), false);
    assert.equal(duration, undefined, 'Organizer uses the normal 4.2 second default');
    await new Promise(resolve => { release = resolve; }); checkSignal(signal);
  };
  const pending = f.controller.spin(); await flush();
  assert.equal(f.view.fullMotion, true); assert.ok(f.events.some(([name]) => name === 'spin-sound'));
  release(); await pending;
  assert.ok(f.events.some(([name, ms]) => name === 'pause' && ms === 320));
  assert.equal(f.view.fullMotion, false); assert.equal(f.view.reduced(), true);
  f.controller.dispose();
});

test('mode changes preserve completed assignments and do not prepare or reroll a draft', async () => {
  const f = fixture(5); await f.controller.spin();
  const before = f.snapshot(); await f.controller.setMode('trackmania');
  assert.deepEqual(f.server.teams, before.teams);
  assert.deepEqual(f.server.participants, before.participants);
  assert.equal(f.server.pick_count, before.pick_count);
  assert.equal(f.controller.mode, 'trackmania');
  assert.equal(f.calls.filter(({ operation }) => operation === 'begin_roll').length, 1);
  assert.equal(f.calls.filter(({ operation }) => operation === 'set_picker_mode').length, 1);
  f.controller.dispose();
});

test('double clicks and mode changes during a reserved pick cannot create another outcome', async () => {
  const f = fixture(); let release;
  f.view.aim = async (_, { signal }) => { await new Promise((resolve) => { release = resolve; }); checkSignal(signal); };
  const first = f.controller.spin(); await flush();
  assert.equal(f.controller.navigationLocked, true);
  await f.controller.spin(); await f.controller.setMode('trackmania');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].operation, 'begin_roll');
  release(); await first;
  assert.equal(f.server.pick_count, 1); f.controller.dispose();
});

test('failed commit shows no success effect and a retry uses the same reserved player and roll', async () => {
  const f = fixture(); f.failNextCommit(); await f.controller.spin();
  assert.equal(f.server.pick_count, 0); assert.equal(f.server.rolling, true);
  assert.equal(f.events.some(([name]) => name === 'impact'), false);
  assert.equal(f.events.some(([name]) => name === 'impact-sound'), false);
  await f.controller.setMode('trackmania');
  assert.equal(f.calls.some(({ operation }) => operation === 'set_picker_mode'), false);
  await f.controller.spin();
  const aims = f.events.filter(([name]) => name === 'aim').map(([, id]) => id);
  assert.deepEqual(aims, ['p0', 'p0']);
  const commits = f.calls.filter(({ operation }) => operation === 'commit_roll');
  assert.equal(commits[0].input.roll_id, commits[1].input.roll_id);
  assert.equal(f.server.pick_count, 1); f.controller.dispose();
});

test('hiding or disposing a picker cancels work without committing an unseen player', async () => {
  const f = fixture(); let release;
  f.view.aim = async (_, { signal }) => { await new Promise((resolve) => { release = resolve; }); checkSignal(signal); };
  const pick = f.controller.spin(); await flush();
  f.setHidden(true); f.controller.stop(); release(); await pick;
  assert.equal(f.server.rolling, true); assert.equal(f.server.pick_count, 0);
  assert.equal(f.calls.some(({ operation }) => operation === 'commit_roll'), false);
  assert.equal(f.events.some(([name]) => name === 'silence'), true);
  f.controller.dispose();
  assert.ok(f.events.some(([name]) => name === 'unsubscribe'));
});

test('public observers animate only newly published membership and cannot mutate mode or draw', async () => {
  const f = fixture(); f.setPermission(false); await f.refresh();
  await f.controller.spin(); await f.controller.setMode('trackmania');
  assert.equal(f.calls.length, 0);
  const published = f.snapshot(); published.pick_count = 1; published.teams[0].members.push({ player_id: 'p0', team_id: 'a', pick_index: 0 });
  f.publish(published); await flush();
  assert.equal(f.events.filter(([name]) => name === 'impact').length, 1);
  await f.refresh(); await flush();
  assert.equal(f.events.filter(([name]) => name === 'impact').length, 1);
  assert.equal(f.calls.length, 0); f.controller.dispose();
});

test('opening an existing draft does not celebrate historical assignments', () => {
  const f = fixture(); f.controller.dispose();
  const root = {}, game = f.snapshot(); game.pick_count = 1; game.teams[0].members.push({ player_id: 'p0', team_id: 'a', pick_index: 0 });
  const effects = f.events.length;
  const controller = new DraftController(root, { api: {}, refresh() {}, notify() {}, view: f.view, audio: f.audio, isHidden: () => false });
  controller.update(game, false);
  assert.equal(f.events.slice(effects).some(([name]) => name === 'impact'), false); controller.dispose();
});

test('autoplay pause completes the current pick without starting another', async () => {
  const f = fixture(5); let release;
  f.view.aim = async (_, { signal }) => { await new Promise((resolve) => { release = resolve; }); checkSignal(signal); };
  f.controller.toggleAuto(); await flush(); f.controller.toggleAuto(); release(); await flush();
  assert.equal(f.server.pick_count, 1); assert.equal(f.controller.autoplay, false);
  assert.equal(f.calls.filter(({ operation }) => operation === 'begin_roll').length, 1); f.controller.dispose();
});

test('an unavailable audio device does not stop the authoritative draw', async () => {
  const f = fixture(); f.audio.unlock = async () => false;
  await f.controller.spin(); assert.equal(f.server.pick_count, 1);
  f.controller.dispose();
});

test('a refetch with the same participants in a different order does not cancel a reserved pick', async () => {
  const f = fixture(); let release;
  f.view.aim = async (_, { signal }) => { await new Promise((resolve) => { release = resolve; }); checkSignal(signal); };
  const pick = f.controller.spin(); await flush();
  const next = f.snapshot(); next.participants.reverse(); f.publish(next);
  assert.equal(f.controller.busy, true);
  release(); await pick;
  assert.equal(f.server.pick_count, 1);
  assert.equal(f.server.teams[0].members[0].player_id, 'p0');
  f.controller.dispose();
});
