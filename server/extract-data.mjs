// Regenerate server/data/rules.json from the public game bundle: `node server/extract-data.mjs [bundle.js]`.
// Only the static data literal is evaluated, in an empty VM context (same approach as scripts/extract-maps.mjs).
// Keeps what the server's rules need and src/game-data.json lacks: job tables, item combat/trade fields, refine, shops.
import fs from 'node:fs';
import vm from 'node:vm';

let s;
if (process.argv[2]) s = fs.readFileSync(process.argv[2], 'utf8');
else {
  const html = await (await fetch('https://ro-idle.app/')).text();
  s = await (await fetch(`https://ro-idle.app${html.match(/\/assets\/index-[^"]+\.js/)[0]}`)).text();
}
const start = s.indexOf('{version:1,items:[');
let depth = 0, i = start, q = null;
for (; i < s.length; i++) {
  const ch = s[i];
  if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
  if (ch === '`' || ch === '"' || ch === "'") q = ch;
  else if (ch === '{' || ch === '[') depth++;
  else if (ch === '}' || ch === ']') { depth--; if (depth === 0) break; }
}
const data = vm.runInNewContext(`(${s.slice(start, i + 1)})`, Object.create(null), { timeout: 2000 });
const items = Object.fromEntries(data.items.map(({ desc, aliases, unidentifiedName, ...it }) => [it.id, it]));
const jobs = Object.fromEntries(data.jobs.map(({ name, jobChange, ...j }) => [j.id, j]));
fs.writeFileSync(new URL('./data/rules.json', import.meta.url), JSON.stringify({ jobs, items, refine: data.refine, shops: data.shops }));
