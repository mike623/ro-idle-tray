import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const script=new URL('../scripts/api-shapes.mjs',import.meta.url).pathname;
const J=JSON.stringify;
const ev=(seq,body)=>({seq,body,wallMs:1,simTime:2});
const records=[
  {t:1,kind:'http',method:'GET',path:'/api/characters/72397?deferCatchup=1',body:null,status:200,resp:J({characterId:72397,lastSeq:5,snapshot:{skills:{TF_MISS:6}}})},
  {t:2,kind:'http',method:'GET',path:'/api/characters/72468?deferCatchup=1',body:null,status:200,resp:J({characterId:72468,lastSeq:6,clockFrozen:false,snapshot:{skills:{}}})},
  {t:3,kind:'sse',path:'/api/characters/72397/stream?after=5',name:'events',data:J([ev(6,{type:'playerAttack',damage:52,me:[952,123]}),ev(7,{type:'kill',monsterId:1128}),ev(8,{type:'storage',items:[{sid:1,qty:2}]})])},
  {t:4,kind:'http',method:'GET',path:'/api/maps/population',body:null,status:200,resp:J({maps:{'1':[1,0],'2':[3,1]}})},
  {t:5,kind:'http',method:'POST',path:'/api/characters/72397/commands',body:J({commandId:'x',command:{type:'useItem',uid:3}}),status:422,resp:J({error:{code:'GAME_RULE',message:'m'}})},
  {t:6,kind:'http',method:'POST',path:'/api/presence',body:'{}',error:'TypeError: Load failed'},
];

test('prints inferred shape tree per endpoint, SSE event, command and battle event',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ro-shapes-'));
  const file=path.join(dir,'c.jsonl');
  fs.writeFileSync(file,records.map(r=>J(r)).join('\n')+'\nnot json\n');
  const r=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const out=r.stdout;
  assert.match(out,/^## GET \/api\/characters\/:id\?deferCatchup= \(2\) status 200$/m);
  assert.match(out,/^    clockFrozen\?: boolean$/m);   // missing in one sample → optional
  assert.match(out,/^    lastSeq: number$/m);
  assert.match(out,/^        TF_MISS\?: number$/m);
  assert.match(out,/^## SSE events \(1\)$/m);
  assert.match(out,/^## event kill \(1\)$/m);
  assert.match(out,/^  me: \[number\]$/m);
  assert.match(out,/^      \*: \[number\]$/m);           // numeric keys collapse
  assert.match(out,/^  items: \[\{\n    sid: number\n    qty: number\n  \}\]$/m);
  assert.match(out,/^## command useItem \(1\)$/m);
  assert.match(out,/^  uid: number$/m);
  assert.match(out,/^## POST \/api\/characters\/:id\/commands \(1\) status 422$/m);
  assert.match(out,/^## POST \/api\/presence \(1\) status error$/m);
});
