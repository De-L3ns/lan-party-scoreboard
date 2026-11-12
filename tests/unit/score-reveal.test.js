import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyScoreTransition, captureScoreBaseline, scoreTransition } from '../../src/domain/score-reveal.js';
import { createResultSaver } from '../../src/features/games/result-saver.js';

const player = (id, points) => ({ id, name: id, points, titles: ['Title'], image_path: `${id}.png` });
const award = (id, amount) => ({ id: `team-${id}`, result: '1', mode: 'equal', amount, player_ids: [id] });
const fixture = () => ({ board: { session: { id: 'lan' }, revision: 42, players: [player('A', 100), player('B', 90), player('C', 80), player('D', 70)] },
  game: { id: 'game', name: 'TrackMania', score_revision: 0, awards: [] } });

test('transition snapshots the full roster, including a nonparticipant losing places', () => {
  const { board, game } = fixture();
  const baseline = captureScoreBaseline(board, game);
  board.players[0].name = 'Later name'; board.players[0].points = 999; board.players[0].titles.push('Later title');
  const transition = scoreTransition(baseline, [award('C', '30'), award('D', '25')]);
  assert.deepEqual(transition.after.map(p => [p.id, p.points, p.rank]), [['C',110,1],['A',100,2],['D',95,3],['B',90,4]]);
  const a = transition.rows.find(p => p.id === 'A'), c = transition.rows.find(p => p.id === 'C');
  assert.equal(a.pointChange, 0); assert.equal(a.placeChange, -1); assert.equal(a.afterIndex, 1);
  assert.equal(a.name, 'A'); assert.deepEqual(a.titles, ['Title']);
  assert.equal(c.placeChange, 2); assert.equal(c.beforeIndex, 2); assert.equal(c.afterIndex, 0);
  assert.equal(c.pointChange, 30);
  assert.ok(Object.isFrozen(transition)); assert.ok(Object.isFrozen(transition.rows)); assert.ok(Object.isFrozen(a.titles));
});

test('corrections show the net difference, with fixed precision and dense ties', () => {
  const { board, game } = fixture();
  game.score_revision = 1; game.awards = [{ player_id: 'A', points: '15' }];
  const transition = scoreTransition(captureScoreBaseline(board, game), [award('A', '25'), award('C', '10')]);
  assert.equal(transition.rows[0].afterPoints, 110); assert.equal(transition.rows[0].pointChange, 10);
  assert.deepEqual(transition.after.map(p => p.rank), [1,2,2,3]);
  const b = transition.rows.find(p => p.id === 'B');
  assert.equal(b.placeChange, 0); assert.equal(b.afterRank, 2);
  const negative = scoreTransition(captureScoreBaseline(board, game), [{ result:'1', mode:'split', amount:'-10', player_ids:['B','C','D'] }]);
  assert.deepEqual(negative.rows.slice(1).map(p => p.pointChange), [-3.33,-3.33,-3.34]);
});

test('unchanged ranks, zero awards, custom penalties, and 64 players retain every identity', () => {
  const { board, game } = fixture();
  const noChange = scoreTransition(captureScoreBaseline(board, game), [award('A', '0')]);
  assert.ok(noChange.rows.every(p => p.placeChange === 0 && p.pointChange === 0));
  board.players = Array.from({ length:64 }, (_, i) => player(`P${String(i).padStart(2,'0')}`, i));
  const custom = { result:'2', mode:'custom', custom:{P00:'100.25',P63:'-100.25'}, player_ids:['P00','P63'] };
  const transition = scoreTransition(captureScoreBaseline(board, game), [custom]);
  assert.equal(transition.rows.length, 64); assert.equal(new Set(transition.rows.map(p=>p.id)).size, 64);
  assert.equal(transition.after[0].id, 'P00'); assert.equal(transition.after.at(-1).id, 'P63');
  assert.equal(transition.rows.find(p=>p.id==='P63').pointChange, -100.25);
});

test('saving waits for acknowledgement, freezes submitted data, and presents once', async () => {
  const { board, game } = fixture(), calls = [], reveals = [];
  let acknowledge;
  const saver = createResultSaver({ board, game, api:{mutate:async (...args)=>{calls.push(args);return new Promise(resolve=>{acknowledge=resolve;});}}, onSaved:transition=>reveals.push(transition) });
  const entries = [award('C','30')];
  const first = saver.save(entries, ' note '), duplicate = saver.save(entries, ' note ');
  board.revision=100;board.players[2].points=999;entries[0].amount='500';
  assert.equal(calls.length,1);assert.equal(reveals.length,0);
  assert.equal(calls[0][1].board_revision,42);assert.equal(calls[0][1].teams[0].amount,'30');
  acknowledge({id:'event'});
  assert.equal(await first, await duplicate);assert.equal(reveals.length,1);
  assert.equal(reveals[0].eventId,'event');assert.equal(reveals[0].after[0].points,110);
  await saver.save(entries,'another attempt');assert.equal(calls.length,1);assert.equal(reveals.length,1);
});

test('failed and stale submissions preserve the original baseline and can retry safely', async () => {
  const { board, game }=fixture(),calls=[],reveals=[];
  let fail=true;
  const saver=createResultSaver({board,game,api:{mutate:async (...args)=>{calls.push(args);if(fail)throw Error('Scores changed. Reload and review.');return{id:'saved'};}},onSaved:t=>reveals.push(t)});
  await assert.rejects(saver.save([award('C','30')]),/Scores changed/);
  assert.equal(reveals.length,0);
  board.revision=99;board.players[0].points=1000;
  fail=false;await saver.save([award('C','30')]);
  assert.deepEqual(calls[0],calls[1]);assert.equal(reveals[0].before[0].points,100);
});

test('invalid result, award, duplicate recipients, and missing correction reasons never save', async () => {
  const {board,game}=fixture();let saves=0;
  const make=()=>createResultSaver({board,game,api:{mutate:()=>{saves++;}},onSaved(){}});
  await assert.rejects(make().save([{...award('A','1'),result:'no'}]),/number/);
  await assert.rejects(make().save([award('A','1.001')]),/decimal/);
  await assert.rejects(make().save([award('A','1'),award('A','2')]),/duplicate/);
  game.score_revision=1;await assert.rejects(make().save([award('A','2')],'  '),/reason/);
  assert.equal(saves,0);
});

test('acknowledged cache updates remain coherent if refresh fails and never overwrite a newer board', () => {
  const {board,game}=fixture();
  game.status='playing';game.teams=[{id:'team-C',result:null,award:null,members:[{player_id:'C'}]}];board.games=[game];
  const transition=scoreTransition(captureScoreBaseline(board,game),[award('C','30')]);
  const confirmed=applyScoreTransition(board,transition);
  assert.equal(confirmed.players.find(p=>p.id==='C').points,110);
  assert.equal(confirmed.games[0].status,'completed');assert.equal(confirmed.games[0].score_revision,1);
  assert.equal(confirmed.games[0].teams[0].result,1);assert.equal(confirmed.games[0].teams[0].award.amount,'30');
  assert.deepEqual(confirmed.games[0].awards,[{player_id:'C',points:30}]);
  assert.equal(board.games[0].status,'playing');assert.equal(board.players[2].points,80);
  const newer={...board,revision:43};assert.equal(applyScoreTransition(newer,transition),newer);
  const anotherLan={...board,session:{id:'another'}};assert.equal(applyScoreTransition(anotherLan,transition),anotherLan);
});
