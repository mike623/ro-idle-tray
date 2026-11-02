import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
class Element {
  constructor(){this.children=[];this.style={};this.events={};this.attrs={};this.hidden=false;}
  append(...items){this.children.push(...items);}
  addEventListener(event,fn){this.events[event]=fn;}
  setAttribute(k,v){this.attrs[k]=v;}
  getClientRects(){return [];}
}
function widget(invoke,character=()=>null){
  const window={};const document={createElement:()=>new Element()};
  vm.runInNewContext(fs.readFileSync(new URL('../src/tutorial-ui.js',import.meta.url),'utf8'),{window,document,setInterval(){}});
  const container=new Element();const api=window.roIdleTutorial(container,invoke,character);
  return {api,container};
}
const offer=(name)=>({character:name,lesson:{id:'skill-order',title:'技能順序',path:'掛機設定 → 掛機技能 → 套用設定',text:'Move a suitable short cast first.'}});
test('tutorial toggles, offers a setting path and marks only the explicitly learned mechanic',async()=>{
  const calls=[];let state={enabled:false,learned:0,total:5,offer:null};
  const e=widget(async(cmd,args)=>{
    calls.push({cmd,args});
    if(typeof args.enabled==='boolean')state={...state,enabled:args.enabled,offer:offer('Alice')};
    if(args.learned)state={...state,learned:1,offer:null};
    return state;
  });
  await e.api.refresh();
  const [toggle,progress,detail]=e.container.children;
  assert.equal(toggle.attrs['aria-pressed'],'false');
  await toggle.events.click();
  assert.equal(toggle.attrs['aria-pressed'],'true');assert.equal(detail.hidden,false);
  assert.equal(detail.children[1].textContent,'掛機設定 → 掛機技能 → 套用設定');
  await detail.children[3].events.click();
  assert.equal(calls.at(-1).args.learned,'skill-order');assert.equal(detail.hidden,true);assert.equal(progress.textContent,'1/5 已學會');
});
test('late tutorial results cannot display a different character lesson',async()=>{
  let name='Alice',finish;
  const e=widget(async(cmd,args)=>args.character==='Alice'?new Promise((resolve)=>{finish=resolve;}):{enabled:true,learned:0,total:5,offer:offer('Bob')},()=>name);
  const pending=e.api.refresh();name='Bob';await e.api.refresh();finish({enabled:true,learned:0,total:5,offer:offer('Alice')});await pending;
  assert.match(e.container.children[2].children[0].textContent,/Bob/);
});
