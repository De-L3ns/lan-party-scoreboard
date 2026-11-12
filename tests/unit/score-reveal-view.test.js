import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureScoreBaseline, scoreTransition } from '../../src/domain/score-reveal.js';
import { ScoreRevealView } from '../../src/features/leaderboard/reveal-view.js';

function fixture() {
  const original={document:globalThis.document,window:globalThis.window,ResizeObserver:globalThis.ResizeObserver};
  const classes=()=>{const set=new Set();return{add:key=>set.add(key),remove:key=>set.delete(key),toggle:(key,value)=>value?set.add(key):set.delete(key)};};
  const listeners=new Map(),resizes=new Set(),heights={a:72,b:100,c:80};
  let markup='',observer,removed=false,closes=0;
  const list={children:[],style:{},dataset:{},classList:classes(),append(row){this.children=this.children.filter(child=>child!==row);this.children.push(row);}};
  const controls={'[data-replay]':{},'[data-done]':{},'[data-summary]':{textContent:''}};
  const dialog={open:false,setAttribute(){},addEventListener:(event,handler)=>listeners.set(event,handler),removeEventListener:event=>listeners.delete(event),
    querySelector:selector=>selector==='.score-reveal-list'?list:controls[selector],querySelectorAll:()=>[],
    showModal(){this.open=true;},close(){this.open=false;listeners.get('close')?.();},remove(){removed=true;},replaceChildren(){markup='';list.children=[];},
    set innerHTML(html){
      markup=html;list.children=[];
      for(const match of html.matchAll(/<li class="score-reveal-row" data-player="([^"]+)" data-direction="([^"]+)">([\s\S]*?)<\/li>/g)) {
        const [,id,direction,body]=match;
        const rank={textContent:body.match(/class="score-reveal-rank">([^<]+)/)[1]};
        const total={textContent:body.match(/class="score-reveal-total">([^<]+)/)[1]};
        const points={textContent:body.match(/class="score-reveal-points [^"]*">([^<]+)/)[1]};
        list.children.push({dataset:{player:id,direction},style:{},attributes:{},querySelector:selector=>selector==='.score-reveal-rank'?rank:selector==='.score-reveal-total'?total:points,
          getBoundingClientRect:()=>({height:heights[id]}),setAttribute(key,value){this.attributes[key]=value;}});
      }
    },get innerHTML(){return markup;},
  };
  globalThis.document={createElement:()=>dialog,body:{append(){}}};
  globalThis.window={addEventListener:(event,callback)=>resizes.add(callback),removeEventListener:(event,callback)=>resizes.delete(callback)};
  globalThis.ResizeObserver=class {constructor(callback){this.callback=callback;this.watched=[];this.disconnected=false;observer=this;}observe(node){this.watched.push(node);}disconnect(){this.disconnected=true;}};
  const board={session:{id:'lan'},revision:1,players:[{id:'a',name:'A <script>',points:100},{id:'b',name:'B',points:90},{id:'c',name:'C',points:80}]};
  const transition=scoreTransition(captureScoreBaseline(board,{id:'g',name:'Race',score_revision:0}),[{result:'1',mode:'equal',amount:'30',player_ids:['c']}]);
  const view=new ScoreRevealView({api:{imageUrl:()=>''},onReplay(){},onClose(){closes++;}});
  return {view,transition,list,dialog,controls,resizes,heights,get observer(){return observer;},get removed(){return removed;},get closes(){return closes;},restore(){Object.assign(globalThis,original);}};
}

test('real reveal view measures wrapped rows, preserves nodes, and keeps points static throughout travel', () => {
  const f=fixture();
  try {
    f.view.open(f.transition);f.view.before();
    assert.match(f.dialog.innerHTML,/A &lt;script&gt;/);assert.doesNotMatch(f.dialog.innerHTML,/<script>/);
    assert.doesNotMatch(f.dialog.innerHTML,/data-motion|checkbox|Animate movement/);
    const c=f.view.rows.get('c'),a=f.view.rows.get('a');
    const values=()=>[...f.view.rows.values()].map(row=>[row.querySelector('.score-reveal-total').textContent,row.querySelector('.score-reveal-points').textContent]);
    const firstValues=values();assert.equal(c.querySelector('.score-reveal-total').textContent,'110');
    assert.equal(c.style.transform,'translateY(184px)');assert.equal(a.style.transform,'translateY(0px)');
    f.view.position(.5);assert.equal(c.style.transform,'translateY(92px)');assert.equal(a.style.transform,'translateY(43px)');
    assert.deepEqual(values(),firstValues);
    f.view.settle();assert.deepEqual(f.list.children.map(row=>row.dataset.player),['c','a','b']);
    assert.equal(c.querySelector('.score-reveal-rank').textContent,1);assert.equal(c.attributes['aria-posinset'],'1');
    f.view.before();assert.equal(f.view.rows.get('c'),c);assert.equal(c.style.transform,'translateY(184px)');
    assert.deepEqual(values(),firstValues);assert.equal(f.list.children.length,3);
    f.heights.c=120;f.observer.callback();f.view.position(.5);assert.equal(a.style.transform,'translateY(63px)');
    assert.equal(f.observer.watched.length,4);assert.equal(f.resizes.size,1);
    f.view.close();assert.equal(f.observer.disconnected,true);assert.equal(f.resizes.size,0);
    assert.equal(f.dialog.innerHTML,'');assert.equal(f.view.rows.size,0);assert.equal(f.closes,1);
    f.view.dispose();assert.equal(f.removed,true);
  } finally {f.restore();}
});

test('native dismissal cleans resize work; opening another reveal does not reuse private content', () => {
  const f=fixture();
  try {
    f.view.open(f.transition);const old=f.observer;
    f.dialog.close();assert.equal(old.disconnected,true);assert.equal(f.closes,1);
    f.view.close();assert.equal(f.dialog.innerHTML,'');
    f.view.open(f.transition);assert.notEqual(f.observer,old);assert.equal(f.resizes.size,1);
    f.view.dispose();assert.equal(f.resizes.size,0);
  } finally {f.restore();}
});
