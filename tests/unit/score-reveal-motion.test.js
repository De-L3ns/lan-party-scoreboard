import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ScoreRevealMotion } from '../../src/features/leaderboard/motion.js';
import { ScoreReveal } from '../../src/features/leaderboard/reveal.js';
import { ScoreRevealView } from '../../src/features/leaderboard/reveal-view.js';

function scheduler() {
  let now=0,id=0;const tasks=new Map();
  const add=(callback,ms)=>{const key=++id;tasks.set(key,{at:now+ms,callback});return key;};
  const clock={now:()=>now,frame:cb=>add(cb,16),cancelFrame:key=>tasks.delete(key),wait:add,cancelWait:key=>tasks.delete(key)};
  function advance(ms) {const end=now+ms;let guard=0;while(tasks.size){const [key,task]=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(task.at>end)break;tasks.delete(key);now=task.at;task.callback(now);assert.ok(++guard<10000);}now=end;}
  return {clock,advance,tasks};
}

test('sliding writes intermediate coordinates in both directions over multiple frames', () => {
  const s=scheduler(),frames=[];let finishes=0;
  const elements=new Map(['up','down'].map(id=>[id,{style:{}}]));
  const view={rows:elements,beforeOffsets:new Map([['up',200],['down',0]]),afterOffsets:new Map([['up',0],['down',200]]),list:{classList:{toggle(){}}}};
  const motion=new ScoreRevealMotion({clock:s.clock,onFrame:progress=>{ScoreRevealView.prototype.position.call(view,progress);frames.push(progress);},onFinish:()=>{finishes++;}});
  motion.play();assert.equal(frames.length,1);s.advance(499);assert.equal(frames.length,1);
  s.advance(901);
  const up=parseFloat(elements.get('up').style.transform.slice(11)),down=parseFloat(elements.get('down').style.transform.slice(11));
  assert.ok(up>0&&up<200);assert.ok(down>0&&down<200);assert.ok(frames.length>20);assert.equal(finishes,0);
  s.advance(2000);assert.equal(finishes,1);assert.equal(frames.at(-1),1);assert.equal(s.tasks.size,0);
});

test('cancelling, replaying, and frame failures cannot leave scheduled work', () => {
  const s=scheduler(),frames=[];let finishes=0,fail=false;
  const motion=new ScoreRevealMotion({clock:s.clock,onFrame:p=>{if(fail)throw Error('Layout failed');frames.push(p);},onFinish:()=>finishes++});
  motion.play();s.advance(800);motion.cancel();const count=frames.length;s.advance(5000);assert.equal(frames.length,count);assert.equal(finishes,0);
  motion.play();assert.equal(frames.at(-1),0);s.advance(2500);assert.equal(finishes,1);assert.equal(s.tasks.size,0);
  fail=true;motion.play();assert.equal(finishes,2);assert.equal(s.tasks.size,0);
});

function fixture(legacyOptions={}) {
  const s=scheduler();
  let before=0,finished=0,closed=0,opened=0,positions=[];
  const view={open(){opened++;},before(){before++;},position:p=>positions.push(p),settle(){finished++;},close(){},dispose(){}};
  const options={...legacyOptions,view,clock:s.clock,onClosed:()=>closed++};
  const reveal=new ScoreReveal(options),transition=Object.freeze({sessionId:'lan',gameId:'g',eventId:'e',rows:Object.freeze([{afterPoints:106,pointChange:30}])});
  return {s,options,reveal,transition,get before(){return before;},get finished(){return finished;},get closed(){return closed;},get opened(){return opened;},get positions(){return positions;}};
}

test('every reveal and replay animates without consulting legacy disabled or system preferences', () => {
  let preferenceReads=0;
  const f=fixture({reducedMotion:()=>{preferenceReads++;return true;},storage:()=>{preferenceReads++;return{getItem:()=> 'false'};}});
  f.reveal.open(f.transition);f.s.advance(1400);
  assert.ok(f.positions.some(p=>p>0&&p<1));assert.equal(f.finished,0);
  f.s.advance(1500);assert.equal(f.finished,1);
  f.reveal.replay();assert.equal(f.positions.at(-1),0);f.s.advance(1400);
  assert.ok(f.positions.at(-1)>0&&f.positions.at(-1)<1);assert.equal(f.finished,1);
  assert.equal(preferenceReads,0);
  assert.equal(f.transition.rows[0].afterPoints,106);assert.equal(f.transition.rows[0].pointChange,30);
  f.s.advance(1500);assert.equal(f.finished,2);assert.equal(f.s.tasks.size,0);
});

test('a reveal is local, deduplicated, frozen across refresh, and cancellable on session/access loss', () => {
  const f=fixture();assert.equal(f.reveal.open(f.transition),true);assert.equal(f.reveal.open(f.transition),false);assert.equal(f.opened,1);
  f.reveal.sync('lan',true);assert.equal(f.reveal.transition,f.transition);
  f.s.advance(1000);f.reveal.replay();assert.equal(f.positions.at(-1),0);
  f.reveal.close();const count=f.positions.length;f.s.advance(5000);assert.equal(f.positions.length,count);assert.equal(f.closed,1);
  f.reveal.open({...f.transition,eventId:'e2'});f.reveal.sync('other',true);assert.equal(f.s.tasks.size,0);assert.equal(f.reveal.transition,null);
  f.reveal.open({...f.transition,eventId:'e3'});f.reveal.sync('lan',false);assert.equal(f.reveal.transition,null);
  f.reveal.dispose();assert.equal(f.reveal.open({...f.transition,eventId:'e4'}),false);assert.equal(f.s.tasks.size,0);
});
