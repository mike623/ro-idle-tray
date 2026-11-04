import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/skills.js',import.meta.url),'utf8');
function game(reply, points=3) {
  let snapshot={character:{name:'Mage',skillPoints:points,skills:{MG_SRECOVERY:10}}};
  const calls=[];
  const ctx=vm.createContext({AbortSignal,crypto:{randomUUID:()=> 'uuid'},fetch:async(url,options)=>{
    const body=JSON.parse(options.body); calls.push(body.command);
    assert.equal(url,'/api/characters/id/commands');
    return reply(body.command,snapshot);
  }});
  vm.runInContext(source,ctx);
  return {calls,run:rows=>ctx.roIdleApplySkills(rows,'id','Mage',()=>snapshot,s=>{snapshot=s;})};
}
const success=(command,s)=>{
  const next=structuredClone(s);
  for(const id of command.skills) {next.character.skills[id]=(next.character.skills[id]??0)+1;next.character.skillPoints--;}
  return {ok:true,json:async()=>({view:{snapshot:next}})};
};
test('spends only available points in order, skips achieved targets, returns partial levels',async()=>{
  const g=game(success);
  const result=await g.run([{id:'MG_SRECOVERY',target:10},{id:'MG_FIREBOLT',target:10},{id:'MG_COLDBOLT',target:10}]);
  assert.equal(g.calls.length,1);
  assert.deepEqual(g.calls[0],{type:'learnSkills',skills:Array(3).fill('MG_FIREBOLT')});
  assert.deepEqual(Array.from(result,r=>r.level),[10,3,0]);
  assert.match(result[2].reason,/技能點不足/);
});
test('server prerequisite rejection skips that skill and permits the next suggestion',async()=>{
  const g=game((c,s)=>c.skills[0]==='MG_FROSTDIVER'?{ok:false,status:400,json:async()=>({error:{message:'需要冰箭術 Lv 5'}})}:success(c,s));
  const r=await g.run([{id:'MG_FROSTDIVER',target:1},{id:'MG_COLDBOLT',target:2}]);
  assert.equal(g.calls.length,2); assert.match(r[0].reason,/需要/); assert.equal(r[1].level,2);
});
test('uncertain transport failure stops without retrying or spending on later skills',async()=>{
  const g=game(()=>{throw new Error('offline');});
  const r=await g.run([{id:'MG_FIREBOLT',target:1},{id:'MG_COLDBOLT',target:2}]);
  assert.equal(g.calls.length,1); assert.match(r[0].reason,/結果不確定/); assert.equal(r[1].reason,'未執行');
});
test('invalid and duplicate targets are rejected before any command',async()=>{
  const g=game(success);
  for(const rows of [[{id:'x',target:1}],[{id:'MG_FIREBOLT',target:11}],[{id:'MG_FIREBOLT',target:1},{id:'MG_FIREBOLT',target:2}]]) await assert.rejects(g.run(rows),/無效/);
  assert.equal(g.calls.length,0);
});
test('missing confirmation stops later requests',async()=>{
  const g=game(()=>({ok:true,json:async()=>({})}));
  const r=await g.run([{id:'MG_FIREBOLT',target:1},{id:'MG_COLDBOLT',target:2}]);
  assert.equal(g.calls.length,1); assert.match(r[0].reason,/未收到技能升級確認/);
});
test('a switched character is rejected before spending',async()=>{
  const ctx=vm.createContext({});
  vm.runInContext(source,ctx);
  await assert.rejects(ctx.roIdleApplySkills([{id:'MG_FIREBOLT',target:1}],'id','Mage',
    ()=>({character:{name:'Other'}}),()=>{}),/角色已切換/);
});
