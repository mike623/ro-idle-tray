import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../src/bubble.js', import.meta.url),'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
class Element {
  constructor() { this.children=[]; this.events={}; this.attrs={}; this.style={}; this.hidden=false; this.value=''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children=nodes; }
  get childElementCount() { return this.children.length; }
  addEventListener(type,fn) { this.events[type]=fn; }
  setAttribute(key,value) { this.attrs[key]=value; }
  focus() {}
  get textContent() { return this.text ?? this.children.map((n)=>n.textContent).join(''); }
  set textContent(value) { this.text=value; }
}
function environment(alertInfo={unread:0,nudge:''},alertRows=[{role:'assistant',text:'Event explanation from log',event_id:'2:1'}]) {
  const elements = new Map();
  const get = (id) => { if(!elements.has(id)) elements.set(id,new Element()); return elements.get(id); };
  get('box').hidden=true;
  const root = {getElementById:get,querySelector:get,addEventListener(){}};
  let mode;
  const calls=[];
  let serverCharacter = 'Alice';
  let finish;
  const window = {events:{},addEventListener(type,fn){this.events[type]=fn;}};
  window.top=window;
  window.roIdleTutorial=()=>({refresh:async()=>{}});
  window.__TAURI__={core:{Channel:class {},invoke:async(cmd,args)=>{
    calls.push({cmd,args});
    if(cmd==='chat_character') return {name:serverCharacter,class:'弓箭手',base:18,hp:72,maxHp:100};
    if(cmd==='chat_alerts') return alertInfo;
    if(cmd==='chat_alert_open') return {rows:alertRows,ids:['2:1']};
    if(cmd==='chat_alert_ack') return {unread:0,nudge:''};
    if(cmd==='chat_memory') return {count:1,fact:'Safe farming'};
    if(cmd==='chat_history') return [{role:'assistant',text:`History for ${args.character}`}];
    if(cmd==='chat_plan') return {pages:['弓箭手技能說明','爆刺刺客培養攻略','裝備逐件保留判定'],suggested:['弓箭手技能說明'],selected:['裝備逐件保留判定'],note:''};
    if(cmd==='chat_plan_set') return {selected:args.pages,note:args.note};
    if(cmd==='chat_send') return new Promise((resolve)=>{finish=resolve;});
    return [];
  }}};
  const document={readyState:'complete',getElementById:()=>null,body:new Element(),createElement(tag){
    const element=new Element(); element.tagName=tag; element.attachShadow=(options)=>{mode=options.mode;return root;};return element;
  }};
  vm.runInNewContext(source,{window,document,Date});
  return {get,window,calls,mode:()=>mode,finish:(rows)=>finish(rows),setCharacter:(name)=>{serverCharacter=name;}};
}
test('bubble isolates styles, restores the active thread and ignores old replies after switching characters',async()=>{
  const e=environment(); await tick();
  assert.equal(e.mode(),'closed');
  assert.equal(e.get('pill-label').textContent,'問 Alice');
  await e.get('pill').events.click(); await tick();
  assert.equal(e.get('box').hidden,false);
  assert.match(e.get('messages').textContent,/History for Alice/);
  e.get('input').value='Why did I die?';
  const pending=e.get('form').events.submit({preventDefault(){}}); await tick();
  const send=e.calls.find((c)=>c.cmd==='chat_send');
  assert.equal(send.args.character,'Alice');
  e.window.events['ro-idle-chat-state']({detail:{name:'Bob',class:'劍士',base:20,hp:90,maxHp:120}});await tick();
  send.args.onEvent.onmessage({kind:'text',text:'Private Alice reply'});
  e.finish([{role:'assistant',text:'Private Alice reply'}]);await pending;await tick();
  assert.equal(e.get('pill-label').textContent,'問 Bob');
  assert.match(e.get('messages').textContent,/History for Bob/);
  assert.doesNotMatch(e.get('messages').textContent,/Alice/);
  e.get('close').events.click();
  assert.equal(e.get('box').hidden,true);
  assert.equal(e.get('pill').attrs['aria-expanded'],'false');
});

test('clicking an unread nudge opens its log explanation and clears the badge',async()=>{
  const e=environment({unread:1,nudge:'魔菇 Lv16'});await tick();
  assert.match(e.get('pill').attrs['aria-label'],/1 則未讀/);
  assert.equal(e.get('badge').textContent,'1');
  assert.equal(e.get('nudge').textContent,'魔菇 Lv16');
  await e.get('pill').events.click();await tick();
  assert.equal(e.calls.find((c)=>c.cmd==='chat_alert_open').args.character,'Alice');
  assert.match(e.get('messages').textContent,/Event explanation from log/);
  assert.doesNotMatch(e.get('pill').attrs['aria-label'],/未讀/);
  assert.equal(e.get('badge').hidden,true);
});

test('a character change discovered while opening never acknowledges unseen alerts',async()=>{
  const e=environment({unread:1,nudge:'Alice alert'});await tick();
  e.setCharacter('Bob');await e.get('pill').events.click();await tick();
  assert.equal(e.get('title').textContent,'Bob');
  assert.equal(e.calls.filter((c)=>c.cmd==='chat_alert_ack').length,0);
  assert.equal(e.calls.filter((c)=>c.cmd==='chat_alert_open').length,0);
});

test('acknowledgement contains pending IDs rather than the whole durable history',async()=>{
  const rows=Array.from({length:1001},(_,i)=>({role:'assistant',text:'Past event',event_id:`old:${i}`}));
  const e=environment({unread:1,nudge:'New event'},rows);await tick();await e.get('pill').events.click();await tick();
  assert.deepEqual(Array.from(e.calls.find((c)=>c.cmd==='chat_alert_ack').args.ids),['2:1']);
});

test('an alert row shows its headline and summary and folds the raw log lines',async()=>{
  const text='戰鬥紀錄事件（Unix 毫秒 1762130000000）\ndeath · 魔菇 Lv16\n\n事件前最近 2 筆紀錄中，有 1 次怪物攻擊／技能紀錄，合計傷害 40。\ntargetSkip · 小野豬 Lv7 · reason=whitelist\nsearching';
  const e=environment({unread:1,nudge:'死亡'},[{role:'assistant',text,event_id:'2:1'}]);await tick();
  await e.get('pill').events.click();await tick();
  const card=e.get('messages').children[0].children[1].children[0];
  assert.equal(card.className,'alert');
  assert.match(card.children[0].textContent,/紀錄事件/);
  assert.equal(card.children[1].textContent,'death · 魔菇 Lv16');
  const details=card.children[3];
  assert.match(details.children[0].textContent,/最近 2 筆紀錄/);
  assert.match(details.children[1].textContent,/targetSkip/);
});

test('replies render bold, code and tip blocks as nodes and the final 追問 line becomes chips',async()=>{
  const reply='放了 **109** 次\n> 建議改法\n> 加條件 `目標 HP 高於 40%`\n追問：為什麼要這樣排？｜改完幫我檢查';
  const e=environment();await tick();
  await e.get('pill').events.click();await tick();
  e.get('input').value='Why?';
  const pending=e.get('form').events.submit({preventDefault(){}});await tick();
  e.finish([{role:'user',text:'Why?'},{role:'assistant',text:reply}]);await pending;await tick();
  const kids=e.get('messages').children;
  const body=kids[1].children[1].children[1];
  assert.equal(body.children[0].children[1].tagName,'b');
  assert.equal(body.children[0].children[1].textContent,'109');
  const tip=body.children[1];
  assert.equal(tip.className,'tip');
  assert.equal(tip.children[0].textContent,'建議改法');
  assert.equal(tip.children[1].children[1].tagName,'code');
  assert.equal(tip.children[1].children[1].textContent,'目標 HP 高於 40%');
  assert.doesNotMatch(body.textContent,/追問/);
  const chips=kids[2];
  assert.equal(chips.className,'starters');
  assert.deepEqual(chips.children.map((c)=>c.textContent),['為什麼要這樣排？','改完幫我檢查']);
});

test('player pins guide pages and a note to the character chat',async()=>{
  const e=environment(); await tick();
  await e.get('pill').events.click(); await tick();
  assert.equal(e.get('plan-btn').textContent,'📖 跟隨：裝備逐件保留判定');
  await e.get('plan-btn').events.click(); await tick();
  assert.equal(e.get('plan').hidden,false);
  assert.equal(e.get('form').hidden,true);
  const boxes=e.get('plan-list').children.filter((n)=>n.tagName==='label').map((l)=>l.children[0]);
  assert.deepEqual([...boxes.map((b)=>b.value)],['弓箭手技能說明','爆刺刺客培養攻略','裝備逐件保留判定']);
  assert.deepEqual([...boxes.map((b)=>b.checked)],[false,false,true]);
  boxes[0].checked=true; e.get('plan-list').events.change({target:boxes[0]});
  assert.equal(e.get('plan-count').textContent,'已選 2／3');
  e.get('plan-note').value='  走 DEX  ';
  await e.get('plan-save').events.click(); await tick();
  const set=e.calls.find((c)=>c.cmd==='chat_plan_set');
  assert.deepEqual(JSON.parse(JSON.stringify(set.args)),{character:'Alice',pages:['裝備逐件保留判定','弓箭手技能說明'],note:'走 DEX'});
  assert.equal(e.get('plan').hidden,true);
  assert.equal(e.get('form').hidden,false);
  assert.equal(e.get('plan-btn').textContent,'📖 跟隨：裝備逐件保留判定、弓箭手技能說明、我的指示');
});

test('repeated tool calls fold into one chip with a count',async()=>{
  const e=environment(); await tick();
  await e.get('pill').events.click(); await tick();
  e.get('input').value='How efficient?';
  e.get('form').events.submit({preventDefault(){}}); await tick();
  const send=e.calls.find((c)=>c.cmd==='chat_send');
  for (const t of ['get_log_summary','get_log_summary','get_log_summary','game_lookup']) send.args.onEvent.onmessage({kind:'tool',name:t});
  const answer=e.get('messages').children.at(-1);
  const chips=answer.children[1].children[0];
  assert.deepEqual([...chips.children.map((c)=>c.textContent)],['⌕ 讀取紀錄 ×3','⌕ 查詢資料']);
});
