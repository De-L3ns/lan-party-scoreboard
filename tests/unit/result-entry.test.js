import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAdminForms } from '../../src/features/admin/forms.js';

function fixture(format='teams', revision=0, mvp=undefined) {
  const players=['a','b','c'].map((id,i)=>({id,name:`Player ${id}`,points:10+i,image_path:null,titles:[]}));
  const board={session:{id:'lan'},revision:8,players};
  const game={id:'g',name:'Game',format,score_revision:revision,direction:'lower',awards:revision?[{player_id:'a',points:5}]:[],
    participants:players.map(p=>({...p,player_id:p.id})),teams:format==='ffa'?players.map(p=>({id:`t${p.id}`,name:p.name,members:[{player_id:p.id}]})):[{id:'team',name:'The team',members:players.map(p=>({player_id:p.id}))}]};
  const elements={reason:{value:revision?'Correction':'Note'}};
  if (mvp !== undefined) {
    game.mvp_player_id = mvp;
    elements.mvp_player_id = { value: mvp ?? '' };
  }
  const groups=game.teams.map(team=>{
    elements[`${team.id}-result`]={value:'3.25'};elements[`${team.id}-amount`]={value:'10'};elements[`${team.id}-mode`]={value:'equal'};
    for(const {player_id} of team.members)if(format==='teams')elements[`${team.id}-${player_id}`]={value:'0'};
    const amount={},custom={};
    return {amount,custom,querySelector:selector=>selector==='select'?(format==='teams'?elements[`${team.id}-mode`]:null):selector==='[data-amount]'?amount:custom,
      querySelectorAll:selector=>selector==='[data-amount] input'?[elements[`${team.id}-amount`]]:team.members.map(p=>elements[`${team.id}-${p.player_id}`]).filter(Boolean)};
  });
  const form={elements,querySelectorAll:selector=>selector==='[data-team]'?groups:[]};
  const calls=[],transitions=[];let page,fail=false;
  const api={imageUrl:()=>'',mutate:async (...args)=>{calls.push(args);if(fail)throw Error('Connection lost');return{id:'event'};}};
  createAdminForms({getBoard:()=>board,api,onResultSaved:t=>transitions.push(t)}).result(game,{open(options){page=options;return form;}});
  return {board,game,page,form,groups,calls,transitions,fail:value=>{fail=value;}};
}

test('free-for-all submits once directly with saved identities and separate results/points', async () => {
  const f=fixture('ffa');
  assert.equal(f.page.submit,'Save results');assert.doesNotMatch(f.page.content,/result-preview|Preview awards/);
  assert.match(f.page.content,/portrait-fallback/);assert.doesNotMatch(f.page.content,/Award rule/);
  f.board.revision=99;f.board.players[0].points=1000;f.game.score_revision=9;
  await f.page.onSubmit(f.form);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0][1].board_revision,8);assert.equal(f.calls[0][1].revision,0);
  assert.ok(f.calls[0][1].teams.every(t=>t.mode==='equal'&&t.result==='3.25'&&t.amount==='10'));
  assert.equal(f.transitions[0].rows.find(p=>p.id==='a').afterPoints,20);
});

test('individual and team results save an optional MVP, prefill corrections, and allow clearing', async () => {
  for (const format of ['ffa', 'teams']) {
    const f = fixture(format, 0, null);
    assert.match(f.page.content, /MVP \(optional\)/);
    assert.match(f.page.content, /<option value="">No MVP<\/option>/);
    f.form.elements.mvp_player_id.value = 'b';
    await f.page.onSubmit(f.form);
    assert.equal(f.calls[0][1].mvp_player_id, 'b');
    assert.equal(f.transitions[0].mvpPlayerId, 'b');
    assert.equal(f.transitions[0].rows.find(p => p.id === 'b').pointChange, 10);
    const correction = fixture(format, 1, 'b');
    assert.match(correction.page.content, /value="b" selected/);
    correction.form.elements.mvp_player_id.value = '';
    await correction.page.onSubmit(correction.form);
    assert.equal(correction.calls[0][1].mvp_player_id, null);
    assert.equal(correction.transitions[0].mvpPlayerId, null);
  }
});

test('team award modes preserve members and input values, including split remainders', async () => {
  for(const mode of ['equal','split','custom']) {
    const f=fixture();f.form.elements['team-mode'].value=mode;
    f.form.elements['team-a'].value='2.25';f.form.elements['team-b'].value='-1';f.form.elements['team-c'].value='0';
    f.page.onInput(f.form);
    assert.equal(f.groups[0].amount.hidden,mode==='custom');assert.equal(f.groups[0].custom.hidden,mode!=='custom');
    assert.equal(f.form.elements['team-amount'].disabled,mode==='custom');assert.equal(f.form.elements['team-a'].disabled,mode!=='custom');
    assert.equal(f.form.elements['team-a'].value,'2.25');
    await f.page.onSubmit(f.form);
    assert.equal(f.calls[0][1].teams[0].mode,mode);assert.equal(f.transitions[0].rows.length,3);
    const changes=new Map(f.transitions[0].rows.map(p=>[p.id,p.pointChange]));
    assert.deepEqual(['a','b','c'].map(id=>changes.get(id)),mode==='equal'?[10,10,10]:mode==='split'?[3.33,3.33,3.34]:[2.25,-1,0]);
  }
});

test('direct corrections subtract old awards; failed saves retain fields and do not reveal', async () => {
  const f=fixture('ffa',1);f.fail(true);
  f.form.elements['ta-amount'].value='7.25';
  await assert.rejects(f.page.onSubmit(f.form),/Connection lost/);
  assert.equal(f.transitions.length,0);assert.equal(f.form.elements['ta-amount'].value,'7.25');
  f.fail(false);await f.page.onSubmit(f.form);
  const a=f.transitions[0].rows.find(p=>p.id==='a');assert.equal(a.afterPoints,12.25);assert.equal(a.pointChange,2.25);
  assert.equal(f.calls[1][1].reason,'Correction');assert.deepEqual(f.calls[0],f.calls[1]);
});

test('invalid result or selected custom points blocks save without disturbing other fields', async () => {
  const f=fixture();f.form.elements['team-result'].value='bad';
  await assert.rejects(f.page.onSubmit(f.form),/The team: Enter a number/);
  f.form.elements['team-result'].value='3';f.form.elements['team-mode'].value='custom';f.form.elements['team-b'].value='1.001';
  await assert.rejects(f.page.onSubmit(f.form),/decimal/);assert.equal(f.calls.length,0);
  assert.equal(f.form.elements['team-amount'].value,'10');
});
