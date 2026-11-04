import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../src/bubble.js', import.meta.url),'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const plain = (v) => JSON.parse(JSON.stringify(v));
class Element {
  constructor() { this.children=[]; this.events={}; this.attrs={}; this.style={}; this.hidden=false; this.value=''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children=nodes; }
  get childElementCount() { return this.children.length; }
  addEventListener(type,fn) { this.events[type]=fn; }
  setAttribute(key,value) { this.attrs[key]=value; }
  setRangeText(text,start,end) { this.value=this.value.slice(0,start)+text+this.value.slice(end); }
  focus() {}
  get textContent() { return this.text ?? this.children.map((n)=>n.textContent).join(''); }
  set textContent(value) { this.text=value; }
}
// panel: true mounts the one assistant like chat.js does; false boots a game window's launcher.
function environment({panel=true,unread=0,history=[],replies={}}={}) {
  const elements = new Map();
  const get = (id) => { if(!elements.has(id)) elements.set(id,new Element()); return elements.get(id); };
  get('box').hidden=true; get('plan').hidden=true;
  const root = {getElementById:get,querySelector:get,addEventListener(){}};
  const calls=[];
  let finish;
  const window = {events:{},addEventListener(type,fn){this.events[type]=fn;}};
  window.top=window;
  window.roIdleTutorial=()=>({refresh:async()=>{}});
  window.__TAURI__={core:{Channel:class {},invoke:async(cmd,args)=>{
    calls.push({cmd,args});
    if(cmd in replies) return replies[cmd](args);
    if(cmd==='chat_alerts') return {unread,nudge:unread ? '死亡 · 魔菇 Lv16' : ''};
    if(cmd==='chat_alert_open') { unread=0; return {rows:[...history,{role:'assistant',text:`@${args.character} · 戰鬥紀錄事件（Unix 毫秒 1762130000000）\ndeath · 魔菇 Lv16`,event_id:`${args.character}:2:1`}],ids:['2:1']}; }
    if(cmd==='chat_alert_ack') return {unread:0,nudge:''};
    if(cmd==='chat_memory') return {count:1,fact:'Safe farming'};
    if(cmd==='chat_history') return history;
    if(cmd==='chat_plan') return {pages:['弓箭手技能說明','爆刺刺客培養攻略','裝備逐件保留判定'],suggested:['弓箭手技能說明'],selected:['裝備逐件保留判定'],note:''};
    if(cmd==='chat_plan_set') return {selected:args.pages,note:args.note};
    if(cmd==='chat_send') return new Promise((resolve)=>{finish=resolve;});
    return null;
  }}};
  const document={readyState:'complete',currentScript:{hasAttribute:()=>panel},getElementById:()=>null,body:new Element(),createElement(tag){
    const element=new Element(); element.tagName=tag; element.attachShadow=()=>root; return element;
  }};
  vm.runInNewContext(source,{window,document,Date,setTimeout});
  const assistant = panel ? window.roIdleAssistant(new Element(),{roster:()=>['Alice','Bob','Bob2'],groups:()=>'[]',summary:()=>'3 角色'}) : null;
  const send = async (text,rows) => {
    get('form input').value=text;
    const pending=get('form').events.submit({preventDefault(){}}); await tick();
    finish(rows); await pending; await tick();
  };
  return {get,window,calls,assistant,send,finish:(rows)=>finish(rows)};
}
const answerBody = (e,i) => e.get('messages').children[i].children[1].children[1];

test('a game window only launches the panel assistant, with its badge and nudge',async()=>{
  const e=environment({panel:false,unread:1});
  e.window.events['ro-idle-chat-state']({detail:{name:'Alice'}}); await tick();
  assert.equal(e.get('pill-label').textContent,'問 Alice');
  assert.equal(e.get('badge').textContent,'1');
  assert.equal(e.get('nudge').textContent,'死亡 · 魔菇 Lv16');
  e.get('pill').events.click(); await tick();
  assert.equal(e.calls.at(-1).cmd,'chat_open_panel');
  assert.equal(e.calls.filter((c)=>c.cmd==='chat_send' || c.cmd==='chat_history').length,0);
});

test('asking about a character prefills @name and posts its unread events into the one thread',async()=>{
  const e=environment({unread:1});
  await e.assistant.ask('Alice'); await tick();
  assert.equal(e.get('form input').value,'@Alice ');
  assert.equal(e.calls.find((c)=>c.cmd==='chat_alert_open').args.global,true);
  assert.deepEqual(plain(e.calls.find((c)=>c.cmd==='chat_alert_ack').args),{character:'Alice',ids:['2:1']});
  const card=e.get('messages').children[0].children[1].children[0];
  assert.equal(card.className,'alert');
  assert.match(card.children[0].textContent,/⚠ Alice · 紀錄事件/);
  assert.equal(e.get('plan-btn').textContent,'📖 Alice 跟隨：裝備逐件保留判定');
});

test('the thread is shared: messages go to the global chat with the panel groups',async()=>{
  const e=environment();
  await e.assistant.ask(null);
  await e.send('Where is everyone?',[{role:'user',text:'Where is everyone?'},{role:'assistant',text:'All at 妙勒尼山脈'}]);
  const send=e.calls.find((c)=>c.cmd==='chat_send');
  assert.equal(send.args.character,undefined);
  assert.equal(send.args.groups,'[]');
  assert.match(e.get('messages').textContent,/妙勒尼山脈/);
});

test('replies render bold, code and tip blocks as nodes and the final 追問 line becomes chips',async()=>{
  const e=environment();
  await e.assistant.ask(null);
  await e.send('Why?',[{role:'user',text:'Why?'},{role:'assistant',text:'放了 **109** 次\n> 建議改法\n> 加條件 `目標 HP 高於 40%`\n追問：為什麼要這樣排？｜改完幫我檢查'}]);
  const body=answerBody(e,1);
  assert.equal(body.children[0].children[1].tagName,'b');
  const tip=body.children[1];
  assert.equal(tip.className,'tip');
  assert.equal(tip.children[1].children[1].textContent,'目標 HP 高於 40%');
  assert.doesNotMatch(body.textContent,/追問/);
  assert.deepEqual(e.get('messages').children[2].children.map((c)=>c.textContent),['為什麼要這樣排？','改完幫我檢查']);
});

test('stat lines apply to the @character the question named, after two clicks',async()=>{
  const e=environment({replies:{apply_stats:()=>[{stat:'dex',target:40},{stat:'vit',target:25}]}});
  await e.assistant.ask(null);
  await e.send('@Bob2 points?',[{role:'user',text:'@Bob2 points?'},{role:'assistant',text:'建議如下\n> 建議改法\n> **DEX 40**\n> VIT +10'}]);
  const b=answerBody(e,1).children[1].children.at(-1);
  assert.equal(b.textContent,'套用到自動配點');
  await b.onclick();
  assert.equal(e.calls.filter((c)=>c.cmd==='apply_stats').length,0);
  await b.onclick();
  assert.deepEqual(plain(e.calls.find((c)=>c.cmd==='apply_stats').args),{character:'Bob2',rows:[{stat:'dex',n:40,add:false},{stat:'vit',n:10,add:true}]});
  assert.equal(b.textContent,'✓ 已套用：DEX 40、VIT 25');
});

test('a tip without an @character gets no stat button',async()=>{
  const e=environment();
  await e.assistant.ask(null);
  await e.send('points?',[{role:'user',text:'points?'},{role:'assistant',text:'> 建議改法\n> DEX 40'}]);
  assert.equal(answerBody(e,1).children[0].children.some((c)=>c.textContent==='套用到自動配點'),false);
});

test('tool calls fold into one summary line with counts',async()=>{
  const e=environment();
  await e.assistant.ask(null);
  e.get('form input').value='How efficient?';
  e.get('form').events.submit({preventDefault(){}}); await tick();
  const send=e.calls.find((c)=>c.cmd==='chat_send');
  for (const t of ['get_log_summary','get_log_summary','get_log_summary','game_lookup']) send.args.onEvent.onmessage({kind:'tool',name:t});
  const [sum,list]=e.get('messages').children.at(-1).children[1].children[0].children;
  assert.equal(sum.textContent,'⌕ 4 次查詢：讀取紀錄 ×3、查詢資料');
  assert.equal(list.children.length,4);
});

test('typing @ suggests characters and picking one focuses its plan',async()=>{
  const e=environment();
  await e.assistant.ask(null);
  assert.equal(e.get('plan-btn').hidden,true);
  const input=e.get('form input');
  input.value='how is @Bo'; input.events.input(); await tick();
  assert.deepEqual(e.get('mentions').children.map((b)=>b.textContent),['@Bob','@Bob2']);
  e.get('mentions').children[1].events.click(); await tick();
  assert.equal(input.value,'how is @Bob2 ');
  assert.equal(e.get('plan-btn').hidden,false);
  assert.equal(e.calls.filter((c)=>c.cmd==='chat_plan').at(-1).args.character,'Bob2');
});

test('player pins guide pages and a note to the focused character',async()=>{
  const e=environment();
  await e.assistant.ask('Alice'); await tick();
  await e.get('plan-btn').events.click(); await tick();
  assert.equal(e.get('plan').hidden,false);
  const boxes=e.get('plan-list').children.filter((n)=>n.tagName==='label').map((l)=>l.children[0]);
  assert.deepEqual([...boxes.map((b)=>b.checked)],[false,false,true]);
  boxes[0].checked=true; e.get('plan-list').events.change({target:boxes[0]});
  e.get('plan-note').value='  走 DEX  ';
  await e.get('plan-save').events.click(); await tick();
  assert.deepEqual(plain(e.calls.find((c)=>c.cmd==='chat_plan_set').args),{character:'Alice',pages:['裝備逐件保留判定','弓箭手技能說明'],note:'走 DEX'});
  assert.equal(e.get('plan-btn').textContent,'📖 Alice 跟隨：裝備逐件保留判定、弓箭手技能說明、我的指示');
});
