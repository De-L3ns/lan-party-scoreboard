import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setHtml, installImageFallbacks } from '../../src/lib/html.js';
import { renderLeaderboard } from '../../src/features/leaderboard/view.js';
import { renderGames, renderTeams } from '../../src/features/games/view.js';
import { KnockoutView } from '../../src/features/knockout/view.js';

function container() {
  return { writes: 0, firstChild: null, lastChild: null, html: '', classList: { toggle() {} },
    set innerHTML(html) { this.writes++; this.html = html; this.firstChild = html ? {} : null; this.lastChild = html ? {} : null; },
    get innerHTML() { return this.html; }, querySelectorAll: () => [] };
}
const api = { imageUrl: (path) => path || '' };
const players = [{ id: 'a', player_id: 'a', name: 'Alice', points: 10, titles: [], image_path: '/alice.png' },
  { id: 'b', player_id: 'b', name: 'Bob', points: 5, titles: [], image_path: '/bob.png' }];
function game(format = 'knockout') {
  return { id: 'g', name: 'Tekken', format, status: 'playing', direction: 'lower', total_players: 2,
    participants: structuredClone(players), teams: players.map((player, position) => ({ id: `t${player.id}`, name: player.name, position, result: null, members: [{ player_id: player.id }] })),
    knockout_matches: [{ id: 'f', round: 0, position: 0, status: 'ready', player1: 'a', player2: 'b', winner_id: null }] };
}

test('unchanged live refresh keeps leaderboard, active game and roster nodes; changed data renders', () => {
  const cases = [
    { data: structuredClone(players), render: (root, data) => renderLeaderboard(root, data, api), change: (data) => { data[0].points = 12; } },
    { data: [game()], render: (root, data) => renderGames(root, data, api), change: (data) => { data[0].status = 'completed'; } },
    ...['ffa', 'teams'].map((format) => ({ data: game(format), render: (root, data) => renderTeams(root, data, api), change: (data) => { data.teams[0].result = 1; } })),
  ];
  for (const { data, render, change } of cases) {
    const root = container();
    render(root, data);
    const node = root.firstChild;
    render(root, structuredClone(data));
    assert.equal(root.writes, 1);
    assert.equal(root.firstChild, node);
    change(data); render(root, data);
    assert.equal(root.writes, 2);
  }
});

test('render cache recovers after another view clears the container', () => {
  const root = container();
  setHtml(root, '<p>Standings</p>');
  root.innerHTML = '';
  assert.equal(setHtml(root, '<p>Standings</p>'), true);
  assert.equal(root.writes, 3);
});

test('a failed portrait remains a fallback on unchanged refreshes', () => {
  const root = container();
  let onError, removed = false;
  const image = { addEventListener: (_, handler) => { onError = handler; }, remove: () => { removed = true; } };
  root.querySelectorAll = () => removed ? [] : [image];
  setHtml(root, '<div><img src="missing.png"></div>');
  installImageFallbacks(root); onError();
  assert.equal(setHtml(root, '<div><img src="missing.png"></div>'), false);
  assert.equal(removed, true);
  assert.equal(root.writes, 1);
});

test('bracket refresh and winner choice preserve portrait sections, scroll and focus', () => {
  const oldDocument = globalThis.document;
  const sections = Object.fromEntries(['.ko-layout', '.ko-arena > header', '.ko-bracket-scroll', '.ko-selected', '.ko-results', '.ko-actions'].map((selector) => [selector, container()]));
  sections['.ko-bracket-scroll'].scrollLeft = 120;
  sections['.ko-bracket-scroll'].scrollTop = 20;
  const control = (id) => ({ dataset: { id }, classList: { toggle() {} }, setAttribute() {} });
  const choices = [control('a'), control('b')], confirm = {};
  const focused = { dataset: { ko: 'choose', id: 'a' }, focus() { assert.fail('Unchanged focus should be preserved'); } };
  const root = { contains: (node) => node === focused,
    querySelector: (selector) => selector === '[data-ko=confirm]' ? confirm : sections[selector],
    querySelectorAll: (selector) => selector === '[data-ko=choose]' ? choices : [] };
  globalThis.document = { activeElement: focused };
  try {
    const view = { root, api }, data = game();
    const state = { selected: 'f', choice: null, busy: false, canWrite: true, canSetup: false };
    KnockoutView.prototype.update.call(view, data, state);
    const portraitNode = sections['.ko-selected'].firstChild;
    KnockoutView.prototype.update.call(view, structuredClone(data), state);
    KnockoutView.prototype.update.call(view, data, { ...state, choice: 'a' });
    assert.equal(confirm.disabled, false);
    KnockoutView.prototype.update.call(view, data, { ...state, choice: 'a', busy: true });
    assert.equal(confirm.disabled, true);
    assert.equal(choices[0].disabled, true);
    assert.equal(sections['.ko-selected'].writes, 1);
    assert.equal(sections['.ko-selected'].firstChild, portraitNode);
    assert.equal(sections['.ko-bracket-scroll'].writes, 1);
    assert.equal(sections['.ko-bracket-scroll'].scrollLeft, 120);
    data.knockout_matches[0].status = 'complete'; data.knockout_matches[0].winner_id = 'a';
    KnockoutView.prototype.update.call(view, data, state);
    assert.equal(sections['.ko-selected'].writes, 2);
    assert.equal(sections['.ko-bracket-scroll'].writes, 2);
    data.status = 'completed'; data.mvp_player_id = 'b';
    KnockoutView.prototype.update.call(view, data, state);
    assert.match(sections['.ko-results'].innerHTML, /aria-label="Game MVP"[\s\S]*?<strong>Bob<\/strong>/);
    assert.equal(sections['.ko-results'].hidden, false);
    data.mvp_player_id = null;
    KnockoutView.prototype.update.call(view, data, state);
    assert.doesNotMatch(sections['.ko-results'].innerHTML, /game-mvp/);
  } finally { globalThis.document = oldDocument; }
});
