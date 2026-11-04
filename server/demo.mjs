// Minimal scripted brain for a smoke session against a running server (real clock):
// node server/demo.mjs <characterId> <token> [fights=1] [base=http://127.0.0.1:8787]
// search → attack (waiting out TOO_EARLY) → kill → pick up every drop; prints one line per message.
import WebSocket from 'ws';

const [id, token, fights = '1', base = 'http://127.0.0.1:8787'] = process.argv.slice(2);
const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?character=${id}&token=${token}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const pending = new Map();
let n = 0, drops = [], interval = 1000;
const line = (dir, x) => console.log(`${new Date().toISOString().slice(11, 23)} ${dir} ${JSON.stringify(x)}`);
ws.on('message', (raw) => {
  const x = JSON.parse(raw);
  if (x.type === 'snapshot') interval = x.snapshot.derived.attackIntervalMs;
  if (x.type === 'snapshot') return line('<', { type: 'snapshot', lastSeq: x.lastSeq, mapId: x.snapshot.mapId, hp: x.snapshot.character.hp });
  if (x.type === 'events') for (const e of x.events) { line('<', e); if (e.body.type === 'drop') drops.push(e.body.itemId); }
  if (x.type === 'result') { pending.get(x.id)?.(x); pending.delete(x.id); }
});
const send = (msg) => new Promise((r) => { const m = { id: ++n, ...msg }; pending.set(m.id, (res) => { const { events, ...rest } = res; line('<', rest); r(res); }); line('>', m); ws.send(JSON.stringify(m)); });

ws.once('open', async () => {
  for (let i = 0; i < +fights; i++) {
    const found = await send({ type: 'search' });
    if (!found.ok) break;
    for (;;) {
      const r = await send({ type: 'attack', uid: found.uid });
      if (r.ok && r.events.some((e) => e.body.type === 'kill')) break;
      if (r.error === 'NO_TARGET') break;
      await sleep(r.ok ? interval : (r.retryAt ?? Date.now() + 100) - Date.now()); // the server gates swings; retryAt says when
    }
    await sleep(50);
    for (const itemId of drops.splice(0)) await send({ type: 'pickup', itemId });
  }
  ws.close();
});
