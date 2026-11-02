import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync(new URL('../scripts/extract-maps.mjs',import.meta.url),'utf8');
function run(skills) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ro-extract-'));
  fs.mkdirSync(path.join(dir,'scripts'));fs.mkdirSync(path.join(dir,'src'));
  fs.writeFileSync(path.join(dir,'scripts/extract.mjs'),source);
  for(const file of ['atlas-data.js','game-data.json']) fs.writeFileSync(path.join(dir,'src',file),'previous');
  const bundle='{version:1,items:[],monsters:[{id:1,name:"Safe",lv:1,hp:100,atk:[5,10],baseExp:20}],maps:[{id:"safe",name:"Safe map",spawns:[{monsterId:1,count:10}]}],skills:'+JSON.stringify(skills)+'}/*隊員每多 1 人，經驗 +`,20,`%（最多 +`,100,`% 隊員 Base Level 差距超過 `,15,` 時不能均分*/';
  const preload=`globalThis.fetch=async(url)=>({text:async()=>String(url).endsWith('.js')?${JSON.stringify(bundle)}:'<script src="/assets/index-test.js"></script>'});`;
  fs.writeFileSync(path.join(dir,'fetch.mjs'),preload);
  const result=spawnSync(process.execPath,['--import',path.join(dir,'fetch.mjs'),path.join(dir,'scripts/extract.mjs')],{encoding:'utf8'});
  return {dir,result,read:(file)=>fs.readFileSync(path.join(dir,'src',file),'utf8')};
}
test('invalid live data leaves both previous artifacts untouched',()=>{
  const e=run([]);
  try { assert.notEqual(e.result.status,0);assert.equal(e.read('atlas-data.js'),'previous');assert.equal(e.read('game-data.json'),'previous'); }
  finally { fs.rmSync(e.dir,{recursive:true,force:true}); }
});
test('refresh publishes matching atlas and knowledge from a fixed bundle',()=>{
  const e=run([{id:'SKILL',name:'Skill'}]);
  try { assert.equal(e.result.status,0,e.result.stderr);const data=JSON.parse(e.read('game-data.json'));assert.equal(data.monsters[0].hp,100);assert.equal(data.partyRules.evenShareLevelLimit,15);assert.match(e.read('atlas-data.js'),/index-test.js/);assert.equal(data.source,'https://ro-idle.app/assets/index-test.js'); }
  finally { fs.rmSync(e.dir,{recursive:true,force:true}); }
});
