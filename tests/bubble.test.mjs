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
    if(cmd==='chat_send') return new Promise((resolve)=>{finish=resolve;});
    return [];
  }}};
  const document={readyState:'complete',getElementById:()=>null,body:new Element(),createElement(){
    const element=new Element(); element.attachShadow=(options)=>{mode=options.mode;return root;};return element;
  }};
  vm.runInNewContext(source,{window,document,Date});
  return {get,window,calls,mode:()=>mode,finish:(rows)=>finish(rows),setCharacter:(name)=>{serverCharacter=name;}};
}
test('bubble isolates styles, restores the active thread and ignores old replies after switching characters',async()=>{
  const e=environment(); await tick();
  assert.equal(e.mode(),'closed');
  assert.equal(e.get('pill').textContent,'問 Alice');
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
  assert.equal(e.get('pill').textContent,'問 Bob');
  assert.match(e.get('messages').textContent,/History for Bob/);
  assert.doesNotMatch(e.get('messages').textContent,/Alice/);
  e.get('close').events.click();
  assert.equal(e.get('box').hidden,true);
  assert.equal(e.get('pill').attrs['aria-expanded'],'false');
});

test('clicking an unread nudge opens its log explanation and clears the badge',async()=>{
  const e=environment({unread:1,nudge:'魔菇 Lv16'});await tick();
  assert.match(e.get('pill').textContent,/1 則未讀/);
  await e.get('pill').events.click();await tick();
  assert.equal(e.calls.find((c)=>c.cmd==='chat_alert_open').args.character,'Alice');
  assert.match(e.get('messages').textContent,/Event explanation from log/);
  assert.doesNotMatch(e.get('pill').textContent,/未讀/);
});

test('a character change discovered while opening never acknowledges unseen alerts',async()=>{
  const e=environment({unread:1,nudge:'Alice alert'});await tick();
  e.setCharacter('Bob');await e.get('pill').events.click();await tick();
  assert.equal(e.get('title').textContent,'✦ Bob');
  assert.equal(e.calls.filter((c)=>c.cmd==='chat_alert_ack').length,0);
  assert.equal(e.calls.filter((c)=>c.cmd==='chat_alert_open').length,0);
});

test('acknowledgement contains pending IDs rather than the whole durable history',async()=>{
  const rows=Array.from({length:1001},(_,i)=>({role:'assistant',text:'Past event',event_id:`old:${i}`}));
  const e=environment({unread:1,nudge:'New event'},rows);await tick();await e.get('pill').events.click();await tick();
  assert.deepEqual(Array.from(e.calls.find((c)=>c.cmd==='chat_alert_ack').args.ids),['2:1']);
});
