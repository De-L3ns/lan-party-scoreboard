import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DraftController } from '../../src/features/teams/controller.js';

function fixture() {
  const elements = new Map();
  const root = { hidden: false, querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '', setAttribute() {}, replaceChildren() { this.innerHTML = ''; this.textContent = ''; } });
    return elements.get(selector);
  }, querySelectorAll: () => [] };
  const controller = new DraftController(root, { api: { imageUrl: () => null }, refresh() {}, notify() {} });
  const players = [{ player_id: 'a', name: 'Nova', titles: [] }, { player_id: 'b', name: 'Pixel', titles: [] }];
  const drafting = { id: 'game', draft_revision: 1, status: 'drafting', pick_count: 1, total_players: 2, team_count: 2, rolling: false, participants: players,
    teams: [{ id: 'one', name: 'Team A', members: [{ player_id: 'a', team_id: 'one', pick_index: 0 }] }, { id: 'two', name: 'Team B', members: [] }] };
  const ready = { ...drafting, status: 'ready', draft_revision: 2, pick_count: 2, teams: [drafting.teams[0], { ...drafting.teams[1], members: [{ player_id: 'b', team_id: 'two', pick_index: 1 }] }] };
  return { root, controller, drafting, ready, elements };
}

test('finishing a draw clears the single-player reveal and hides the picker', () => {
  const { root, controller, drafting, ready, elements } = fixture();
  controller.update(drafting, true);
  assert.equal(root.hidden, false);
  assert.match(elements.get('.pick-result').innerHTML, /Nova/);
  assert.match(elements.get('.wheel-stage').innerHTML, /Pixel/);
  controller.update(ready, true);
  assert.equal(root.hidden, true);
  assert.equal(elements.get('.pick-result').innerHTML, '');
  assert.equal(elements.get('.wheel-stage').innerHTML, '');
  assert.equal(elements.get('.draft-buttons').hidden, true);
});

test('the final spin finishes before the picker is hidden; reopening a ready draw stays clear', () => {
  const { root, controller, drafting, ready, elements } = fixture();
  controller.update(drafting, true);
  controller.busy = true;
  controller.update(ready, true);
  assert.equal(root.hidden, false);
  controller.busy = false;
  controller.update(ready, true);
  assert.equal(root.hidden, true);
  assert.equal(elements.get('.pick-result').innerHTML, '');
  controller.update(ready, false);
  assert.equal(root.hidden, true);
});
