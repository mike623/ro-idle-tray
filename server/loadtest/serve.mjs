// Load-test server process (forked by run.mjs): the real server (startServer) on the shared accelerated clock, with
// timing hooks around the game object. Reports to the parent over IPC every `--report` ms:
// action latency (brain actions; attack/cast = fight resolution), tick latency, checkout latency, CPU, RSS,
// events emitted, DB checkpoints (count, bytes), INVARIANT errors (console.error from the server).
import { parseArgs } from 'node:util';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { statSync } from 'node:fs';
import { startServer } from '../index.js';

const { values: o } = parseArgs({ options: { db: { type: 'string' }, base: { type: 'string' }, start: { type: 'string' },
  speed: { type: 'string', default: '1' }, report: { type: 'string', default: '2000' }, checkpoint: { type: 'string', default: '30000' } } });
const speed = +o.speed, base = +o.base, start = +o.start;
const now = () => Math.floor(base + (Date.now() - start) * speed);

const m = { fight: [], act: [], tick: [], checkout: [], checkpointMs: [], events: 0, dbWrites: 0, dbBytes: 0, invariants: 0, acts: {} };
const errorLog = console.error;
// every console.error of the server: INVARIANT 500s, guarded brain-action / tick errors (an over-count, never an under-count)
console.error = (...x) => { m.invariants++; if (m.invariants <= 5) errorLog(...x); };

const srv = await startServer({ port: 0, db: o.db, now, seed: 1, tickMs: Math.max(1, 250 / speed), checkpointMs: +o.checkpoint, maxDrivers: 8 });
const g = srv.game;
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
const act = g.act;
g.act = (id, a) => {
  const t0 = process.hrtime.bigint();
  const r = act(id, a);
  const d = ms(t0);
  (a?.type === 'attack' || a?.type === 'cast' ? m.fight : m.act).push(d);
  const k = `${a?.type}:${r.ok ? 'ok' : r.error}`;
  m.acts[k] = (m.acts[k] ?? 0) + 1;
  return r;
};
const tick = g.tick;
g.tick = () => { const t0 = process.hrtime.bigint(); tick(); m.tick.push(ms(t0)); };
const checkout = g.checkout;
// ponytail: ≤ 2 µs = nothing to settle (live character), not counted as a checkout
g.checkout = (C) => { const t0 = process.hrtime.bigint(); const r = checkout(C); const d = ms(t0); if (d > 0.002) m.checkout.push(d); return r; };
const onEmit = g.onEmit;
g.onEmit = (C, out) => { m.events += out.length; onEmit?.(C, out); };
const dump = g.dump;
// checkpoint = dump + JSON.stringify + SQLite write, all synchronous: the microtask after dump() runs once it is done
g.dump = () => {
  const t0 = process.hrtime.bigint();
  queueMicrotask(() => { m.checkpointMs.push(ms(t0)); m.dbBytes = statSync(o.db).size; });
  m.dbWrites++;
  return dump();
};

const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
let cpu = process.cpuUsage(), at = Date.now();
setInterval(() => {
  const c = process.cpuUsage(cpu), t = Date.now();
  process.send({ type: 'stats', wallMs: t - at, cpuMs: (c.user + c.system) / 1000, rss: process.memoryUsage().rss,
    heap: process.memoryUsage().heapUsed, loopP99: loop.percentile(99) / 1e6, ...m, chars: g.chars.size });
  cpu = process.cpuUsage(); at = t; loop.reset();
  Object.assign(m, { fight: [], act: [], tick: [], checkout: [], checkpointMs: [], events: 0, dbWrites: 0, invariants: 0, acts: {} });
}, +o.report);
process.send({ type: 'ready', port: srv.port });
process.on('message', async (x) => { if (x === 'stop') { await srv.close(); process.exit(0); } });
