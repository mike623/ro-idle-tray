#!/usr/bin/env node
// Print the inferred JSON shape tree of captured API traffic (capture/*.jsonl).
// Usage: node scripts/api-shapes.mjs <capture.jsonl...>
// Sections: one per "METHOD path" (ids → :id, query values dropped), per SSE event name,
// per command `type` (POST /commands body.command) and per battle event `body.type`.
// A key with `?` was missing in some samples; id-keyed objects collapse to `*`.
import fs from 'node:fs';

const blank=()=>({n:0,types:new Set(),obj:null,arr:null});
function add(s,v){
  s.n++;
  if(Array.isArray(v)){s.arr??=blank();for(const x of v)add(s.arr,x);if(!v.length)s.types.add('[]');}
  else if(v&&typeof v==='object'){
    s.obj??={n:0,keys:new Map()};s.obj.n++;
    for(const [k,x] of Object.entries(v)){if(!s.obj.keys.has(k))s.obj.keys.set(k,blank());add(s.obj.keys.get(k),x);}
  } else s.types.add(v===null?'null':typeof v);
}
function merge(d,s){
  d.n+=s.n;s.types.forEach(t=>d.types.add(t));
  if(s.arr)merge(d.arr??=blank(),s.arr);
  if(s.obj){d.obj??={n:0,keys:new Map()};d.obj.n+=s.obj.n;
    for(const [k,c] of s.obj.keys){if(!d.obj.keys.has(k))d.obj.keys.set(k,blank());merge(d.obj.keys.get(k),c);}}
}
// id-keyed maps (all-numeric keys, or >40 lowercase ids like map names) collapse to one `*` entry
function collapse(o){
  const keys=[...o.keys.keys()];
  if(!keys.length||!(keys.every(k=>/^\d+$/.test(k))||keys.length>40&&keys.every(k=>/^[a-z0-9_]+$/.test(k))))return o;
  const m=blank();for(const c of o.keys.values())merge(m,c);
  return {n:o.n,keys:new Map([['*',m]])};
}
function print(s,ind){
  const parts=[...s.types].filter(t=>t!=='[]'||!s.arr);
  if(s.arr){if(!s.arr.obj&&!s.arr.arr){parts.unshift(`[${[...s.arr.types].join('|')}]`);return {head:parts.join('|'),tail:[]};}
    const r=print(s.arr,ind);parts.unshift('['+r.head);r.tail[r.tail.length-1]+=']';return {head:parts.join('|'),tail:r.tail};}
  const tail=[];
  if(s.obj){parts.push('{');const o=collapse(s.obj);
    for(const [k,c] of o.keys){const r=print(c,ind+'  ');
      tail.push(`${ind}  ${k}${c.n<o.n&&k!=='*'?'?':''}: ${r.head}`,...r.tail);}
    tail.push(ind+'}');}
  return {head:parts.join('|'),tail};
}
const tree=s=>{const r=print(s,'');return [r.head,...r.tail];};

const sections=new Map();
const at=(name,v)=>{if(!sections.has(name))sections.set(name,{n:0,status:new Set(),body:blank(),resp:blank()});
  const sec=sections.get(name);sec.n++;if(v!==undefined)add(sec.resp,v);return sec;};
const parse=t=>{try{return typeof t==='string'?JSON.parse(t):t;}catch{return undefined;}};
const norm=p=>{const [pathname,q]=p.split('?');
  return pathname.replace(/\/\d+(?=\/|$)/g,'/:id')+(q?'?'+[...new URLSearchParams(q).keys()].map(k=>k+'=').join('&'):'');};
function events(v){for(const e of Array.isArray(v)?v:v?.events??[])if(e?.body?.type)at('event '+e.body.type,e.body);}

for(const file of process.argv.slice(2))for(const line of fs.readFileSync(file,'utf8').split('\n')){
  const r=parse(line);if(!r||typeof r!=='object')continue;
  if(r.kind==='http'){
    const resp=parse(r.resp),body=parse(r.body);
    const sec=at(`${r.method} ${norm(r.path)}`,resp);sec.status.add(r.status??'error');
    if(body!==undefined&&body!==null)add(sec.body,body);
    if(body?.command?.type)at('command '+body.command.type,body.command);
    if(/\/events\?/.test(r.path))events(resp);
  } else if(r.kind==='sse'){
    const data=parse(r.data);at('SSE '+r.name,data);if(r.name==='events')events(data);
  }
}
const out=[];
for(const [name,sec] of [...sections].sort(([a],[b])=>a.localeCompare(b))){
  out.push(`## ${name} (${sec.n})${sec.status.size?' status '+[...sec.status].join(','):''}`);
  if(sec.body.n)out.push('body:',...tree(sec.body).map(l=>'  '+l));
  if(sec.status.size)out.push('resp:',...tree(sec.resp).map(l=>'  '+l));
  else out.push(...tree(sec.resp));
  out.push('');
}
process.stdout.write(out.join('\n'));
