import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KnockoutReveals, knockoutPlaces, knockoutChampion, roundLabel, validReveal } from '../../src/domain/knockout.js';
import { gameScreen, needsRedraw } from '../../src/domain/game-flow.js';
import { bracketMarkup, playerProfile, selectedMatchMarkup, KnockoutView } from '../../src/features/knockout/view.js';
import { renderGames } from '../../src/features/games/view.js';

const match = (id, round, position, player1, player2, winner_id = null) => ({ id, round, position, player1, player2, winner_id, published: true, status: winner_id ? player2 ? 'complete' : 'bye' : player1 && player2 ? 'ready' : 'waiting' });
const event = (id, m, kind = 'ready') => ({ id: String(id), match_id: m.id, player1: m.player1, player2: m.player2, kind, valid: true });
const game = (matches = []) => ({ id: 'g', name: 'Tekken <8>', format: 'knockout', status: 'playing', direction: 'lower', knockout_matches: matches, knockout_events: [], teams: [], participants: 'abcdefgh'.split('').map((id) => ({ player_id: id, name: id, titles: ['The <host>', 'A & B'], image_path: null })), total_players: 8 });
const api = { imageUrl: () => null };

test('finishing places follow elimination rounds with ties; byes earn no victory or place', () => {
  const g = game([
    match('q1', 0, 0, 'a', 'b', 'a'), match('q2', 0, 1, 'c', 'd', 'c'),
    match('q3', 0, 2, 'e', 'f', 'e'), match('q4', 0, 3, 'g', 'h', 'g'),
    match('s1', 1, 0, 'a', 'c', 'a'), match('s2', 1, 1, 'e', 'g', 'e'), match('f', 2, 0, 'a', 'e', 'a'),
  ]);
  assert.equal(knockoutChampion(g), 'a');
  assert.deepEqual([...knockoutPlaces(g).values()].sort((a, b) => a - b), [1, 2, 3, 3, 5, 5, 5, 5]);
  const uneven = game([match('a', 0, 0, 'a', null, 'a'), match('b', 0, 1, 'b', 'c', 'b'), match('f', 1, 0, 'a', 'b', 'b')]);
  assert.deepEqual(Object.fromEntries(knockoutPlaces(uneven)), { b: 1, c: 3, a: 2 });
  uneven.knockout_matches.at(-1).status = 'ready';
  assert.equal(knockoutPlaces(uneven).size, 0);
});

test('labels and result routes handle two-player finals and 64-player brackets', () => {
  assert.equal(roundLabel(0, 1), 'Final'); assert.equal(roundLabel(0, 6), 'Round of 64');
  const g = game([match('f', 0, 0, 'a', 'b')]);
  assert.equal(gameScreen(g, 'results'), 'playing');
  g.knockout_matches[0].winner_id = 'a'; g.knockout_matches[0].status = 'complete';
  assert.equal(gameScreen(g, 'results'), 'results');
  assert.equal(gameScreen(g, 'results', false), 'playing');
  assert.equal(gameScreen({ ...g, status: 'ready' }, 'names'), 'draw');
  assert.equal(needsRedraw({ ...g, total_players: 2, participants: g.participants.slice(0, 2) }, { format: 'knockout', player_ids: ['a', 'b'], team_count: 2 }), false);
});

test('events baseline on joining, deduplicate refetches, and preserve bigint ordering', () => {
  const m = match('s', 1, 0, 'a', 'b'), g = game([m]);
  const reveals = new KnockoutReveals();
  g.knockout_events = [event('9007199254740992', m)];
  assert.equal(reveals.update(g).length, 0);
  g.knockout_events.push(event('9007199254740993', m));
  assert.equal(reveals.update(g).length, 1);
  assert.equal(reveals.update(g).length, 1);
  reveals.clear(); assert.equal(reveals.update(g).length, 0);
  g.knockout_events.push(event('9007199254740994', m));
  assert.equal(reveals.update(g, true).length, 0);
  assert.equal(reveals.update(g).length, 0);
});

test('undo invalidates queued opponents; byes and unpublished pairings cannot produce versus reveals', () => {
  const m = match('s', 1, 0, 'a', 'b'), g = game([m]), reveals = new KnockoutReveals();
  reveals.update(g); g.knockout_events.push(event(1, m)); reveals.update(g);
  m.player2 = null; m.status = 'waiting';
  assert.equal(reveals.update(g).length, 0);
  assert.equal(validReveal(g, event(2, m)), false);
  m.player2 = 'b'; m.published = false;
  assert.equal(validReveal(g, event(3, m)), false);
});

test('an invalidated old event stays invalid even when the same opponents qualify again', () => {
  const m = match('s', 1, 0, 'a', 'b'), g = game([m]), reveals = new KnockoutReveals();
  reveals.update(g); g.knockout_events = [event(1, m)]; reveals.update(g);
  g.knockout_events[0] = { ...g.knockout_events[0], valid: false };
  g.knockout_events.push(event(2, m));
  assert.deepEqual(reveals.update(g).map((row) => row.id), ['2']);
});

test('bracket and profiles use saved artwork/tags and escape player content', () => {
  const g = game([match('q', 0, 0, 'a', 'b', 'a'), match('f', 1, 0, 'a', null)]);
  g.participants[0].name = '<Alice>';
  const html = bracketMarkup(g, 'q', api);
  assert.match(html, /&lt;Alice&gt;/); assert.match(html, /OUT/); assert.match(html, /Winner of match 2/);
  const profile = playerProfile(g.participants[0], api);
  assert.match(profile, /The &lt;host&gt;/); assert.match(profile, /A &amp; B/);
  assert.doesNotMatch(profile, /<Alice>/);
  const root = { innerHTML: '', querySelectorAll: () => [] };
  renderGames(root, [g], api);
  assert.match(root.innerHTML, /Knockout Tournament/); assert.doesNotMatch(root.innerHTML, /Team A/);
});

test('automatic advancement shows one real player and a destination without a fake opponent', () => {
  const g = game([match('bye', 0, 0, 'a', null, 'a'), match('played', 0, 1, 'b', 'c'), match('f', 1, 0, 'a', null)]);
  const bye = selectedMatchMarkup(g, { selected: 'bye', canWrite: true }, api);
  assert.match(bye, /Automatic advance/); assert.match(bye, /Direct to final/);
  assert.match(bye, /has no opening opponent/);
  assert.equal((bye.match(/class="ko-profile/g) || []).length, 1);
  assert.doesNotMatch(bye, />Bye<|ko-unknown|ko-pair|>VS<|data-ko="replay"|data-ko="confirm"/);
  const bracket = bracketMarkup(g, 'bye', api);
  assert.match(bracket, /Automatic advance/); assert.match(bracket, /Direct to final/);
  assert.doesNotMatch(bracket, />Bye</);
  const automaticCard = bracket.match(/<button class="ko-match ko-auto-match[\s\S]*?<\/button>/)?.[0];
  assert.ok(automaticCard);
  assert.doesNotMatch(automaticCard, /versus|To be decided/);
  const reverseSlot = { ...g, knockout_matches: [{ ...g.knockout_matches[0], player1: null, player2: 'a' }, ...g.knockout_matches.slice(1)] };
  assert.match(selectedMatchMarkup(reverseSlot, { selected: 'bye' }, api), /has no opening opponent/);
});

test('public match details omit organizer controls', () => {
  const g = game([match('played', 0, 0, 'b', 'c')]);
  const publicMatch = selectedMatchMarkup(g, { selected: 'played', canWrite: false }, api);
  assert.match(publicMatch, /Show versus/); assert.doesNotMatch(publicMatch, /Select the winner|data-ko="confirm"|data-ko="choose"/);
});

test('versus screen has exactly one back action, with a separate next action only when needed', () => {
  const g = game([match('f', 0, 0, 'a', 'b')]);
  const button = { focus() {}, addEventListener() {} };
  const dialog = { innerHTML: '', querySelectorAll: () => [], querySelector: () => button, showModal() {} };
  const view = { dialog, api, close() {}, dismiss() {} };
  for (const hasNext of [false, true]) {
    KnockoutView.prototype.reveal.call(view, g, g.knockout_matches[0], {
      context: 'Matchup', hasNext, next: hasNext ? 'Next matchup →' : 'Back to bracket', onNext() {}, onClose() {},
    });
    assert.equal((dialog.innerHTML.match(/>Back to bracket<\/button>/g) || []).length, 1);
    assert.equal((dialog.innerHTML.match(/<button /g) || []).length, hasNext ? 2 : 1);
  }
});
