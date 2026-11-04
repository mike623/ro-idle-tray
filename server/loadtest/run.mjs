// Load test (#24): seeded bot population (population.mjs) driving the real server over WebSocket with the real brain.
//   node server/loadtest/run.mjs --scenario s1 --bots 100,250,500,1000 --minutes 2 [--speed 1] [--seed 1] [--out file.json]
//   node server/loadtest/run.mjs --scenario s2 --bots 1000            # 30% driven; 200 offline characters return in 10 s
//   node server/loadtest/run.mjs --scenario s6 --bots 500 --minutes 2  # 5% cheating bots + one 12-character multibox
//   node server/loadtest/run.mjs --scenario smoke                      # 100 bots, 2 min; exits 1 on INVARIANT/limits
//   --checkpoint S: SQLite checkpoint interval in wall seconds (server default 30)
// `--bots 100..1000` = 100,250,500,1000. The server runs in a child process (serve.mjs) so its CPU/RSS are its own;
// both processes share one clock: base + (Date.now() − start) × speed. Real shared configs are read at runtime from
// the local capture dir when present (never written anywhere).
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir, cpus, totalmem } from 'node:os';
import { parseArgs } from 'node:util';
import { generate, sharedConfigsFrom } from './population.mjs';
import { createGame, data } from '../game.js';
import { attachOffline } from '../offline.js';
import { openStore } from '../index.js';
import { drive } from '../../brain/client.js';
import { createBrain } from '../../brain/brain.js';
import { mulberry32 } from '../rules/engine.js';

const { values: o } = parseArgs({ options: { scenario: { type: 'string', default: 's1' }, bots: { type: 'string' },
  minutes: { type: 'string' }, speed: { type: 'string', default: '1' }, seed: { type: 'string', default: '1' }, out: { type: 'string' },
  capture: { type: 'string', default: join(homedir(), 'Library/Application Support/com.mikewong.ro-idle-tray/capture') },
  warmup: { type: 'string', default: '20' }, checkpoint: { type: 'string', default: '30' } } });
const scenario = o.scenario;
const steps = (o.bots ?? (scenario === 'smoke' ? '100' : scenario === 's2' ? '1000' : scenario === 's6' ? '500' : '100..1000'))
  .replace('100..1000', '100,250,500,1000').split(',').map(Number);
const minutes = +(o.minutes ?? 2), speed = +o.speed, warmupMs = 1000 * +o.warmup;
const maxBots = Math.max(...steps);

// ---------- population → SQLite ----------
const files = existsSync(o.capture) ? readdirSync(o.capture).filter((n) => n.endsWith('.jsonl')).map((n) => join(o.capture, n)) : [];
const configs = files.length ? sharedConfigsFrom(files) : null;
const pop = generate({ bots: maxBots, seed: +o.seed, configs, cheatPct: scenario === 's6' ? 5 : 0 });
if (scenario === 's6') { // one account boxing 12 characters: the server caps drivers per account at 8
  const extra = generate({ bots: 12, seed: 99, configs, firstId: 2_000_000 }).chars;
  for (const c of extra) Object.assign(c, { account: 'multibox', partyId: null, multibox: true });
  pop.chars.push(...extra);
}
const dir = mkdtempSync(join(tmpdir(), 'ro-load-'));
const db = join(dir, 'load.sqlite');
const base = 1_800_000_000_000, start = Date.now();
const now = () => Math.floor(base + (Date.now() - start) * speed);
{
  const g = attachOffline(createGame({ now }));
  for (const c of pop.chars) {
    if (!g.accounts.has(c.account)) g.accounts.set(c.account, { name: c.account, token: `t-${c.account}` });
    const C = g.addCharacter(c.view, c.account);
    C.partyId = c.partyId;
  }
  for (const p of pop.parties) g.parties.set(p.id, p);
  if (scenario === 's2') { // the returning 70%: last farmed 1–24 h ago (no driven history → engine-sampled rates, the cold case)
    pop.chars.forEach((c, i) => { if (i % 10 >= 3) { const C = g.chars.get(c.view.characterId); C.off.settledAtMs = now() - 3600e3 * (1 + (i * 7919) % 23); } });
  }
  const store = openStore(db);
  store.save(g);
  store.close();
}
const sources = pop.chars.reduce((n, c) => { n[c.configSource] = (n[c.configSource] ?? 0) + 1; return n; }, {});
console.log(`population: ${pop.chars.length} characters, ${new Set(pop.chars.map((c) => c.account)).size} accounts, configs ${JSON.stringify(sources)}`);

// ---------- server child ----------
const child = fork(new URL('./serve.mjs', import.meta.url), ['--db', db, '--base', String(base), '--start', String(start), '--speed', String(speed), '--checkpoint', String(1000 * +o.checkpoint)]);
const stats = [];
const port = await new Promise((res) => child.on('message', (x) => { if (x.type === 'ready') res(x.port); else if (x.type === 'stats') stats.push({ at: Date.now(), ...x }); }));
const url = `http://127.0.0.1:${port}`;

// ---------- client-side measurement ----------
const cl = { rtt: [], cmdRtt: [], bytesIn: 0, bytesOut: 0, wsErrors: 0, closes: {} };
class MeteredWS extends WebSocket {
  sent = new Map();
  constructor(u) {
    super(u);
    this.addEventListener('message', (ev) => {
      cl.bytesIn += Buffer.byteLength(ev.data);
      const id = /^\{"type":"result","id":(\d+)/.exec(ev.data)?.[1];
      if (id && this.sent.has(+id)) { cl.rtt.push(performance.now() - this.sent.get(+id)); this.sent.delete(+id); }
    });
    this.addEventListener('close', (ev) => { cl.closes[ev.code] = (cl.closes[ev.code] ?? 0) + 1; });
    this.addEventListener('error', () => { cl.wsErrors++; });
  }
  send(s) { cl.bytesOut += Buffer.byteLength(s); const id = /"id":(\d+)/.exec(s)?.[1]; if (id) this.sent.set(+id, performance.now()); super.send(s); }
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => { const t = performance.now(); const r = await realFetch(u, init); if (/\/commands$/.test(String(u))) cl.cmdRtt.push(performance.now() - t); return r; };

const tokenOf = (c) => `t-${c.account}`;
const running = [];
const startBot = (c) => running.push(c.cheat ? cheater(c) : drive({ base: url, characterId: c.view.characterId, token: tokenOf(c), now,
  intervalMs: Math.max(1, 250 / speed), brain: createBrain({ monsters: data.monsters }), WebSocketImpl: MeteredWS }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// S6 cheaters: raw WebSocket clients breaking the rules; every reply is tallied by error code.
const cheats = {};
let cheatN = 0;
const cheatRng = mulberry32(+o.seed + 7); // forged uids are seeded like the population
function cheater(c) {
  const kind = ['speed', 'forge'][cheatN++ % 2], id = c.view.characterId, map = c.view.snapshot.mapId;
  const ws = new WebSocket(`${url.replace('http', 'ws')}/ws?character=${id}&token=${tokenOf(c)}`);
  let n = 0, uid = null, timer, interval = 0, lastOk = 0, recalled = 0;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'snapshot') interval = m.snapshot.derived.attackIntervalMs;
    if (m.type !== 'result') return;
    const k = `${kind}:${m.ok ? 'ok' : m.error}`;
    cheats[k] = (cheats[k] ?? 0) + 1;
    if (m.uid) uid = m.uid;
    if (m.ok && m.events?.some((e) => e.body.type === 'playerAttack')) { // accepted swings must stay ≥ the ASPD interval apart
      const t = now();
      if (lastOk && interval) cheats.minSwingGapVsAspd = Math.min(cheats.minSwingGapVsAspd ?? Infinity, +((t - lastOk) / interval).toFixed(3));
      lastOk = t;
    }
    if (m.error === 'NO_TARGET' || m.error === 'IN_FIGHT') uid = null;
    if (m.error === 'NO_MONSTERS' && Date.now() - recalled > 2000 && (recalled = Date.now())) realFetch(`${url}/api/characters/${id}/commands`, { method: 'POST', // died → back to its map
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenOf(c)}` }, body: JSON.stringify({ command: { type: 'selectMap', mapId: map } }) });
  };
  ws.onopen = () => { timer = setInterval(() => {
    if (kind === 'forge') return ws.send(JSON.stringify({ id: ++n, type: 'attack', uid: 1 + Math.floor(cheatRng() * 1e5) }));
    ws.send(JSON.stringify(uid ? { id: ++n, type: 'attack', uid } : { id: ++n, type: 'search' })); // spam faster than ASPD
  }, 50 / Math.min(speed, 10)); };
  return { stop() { clearInterval(timer); ws.close(); } };
}

// ---------- measurement windows ----------
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3); };
function measure(fromAt, toAt, bots) {
  const ss = stats.filter((s) => s.at > fromAt && s.at <= toAt);
  if (!ss.length) return { bots, wallS: 0, missingServerReports: true, invariants: 0, acts: {} };
  const wall = ss.reduce((n, s) => n + s.wallMs, 0) / 1000;
  const all = (k) => ss.flatMap((s) => s[k]);
  const sum = (k) => ss.reduce((n, s) => n + s[k], 0);
  const acts = {};
  for (const s of ss) for (const [k, v] of Object.entries(s.acts)) acts[k] = (acts[k] ?? 0) + v;
  return { bots, wallS: +wall.toFixed(1), fightP50: pct(all('fight'), 0.5), fightP99: pct(all('fight'), 0.99), fights: all('fight').length,
    actP99: pct(all('act'), 0.99), tickP99: pct(all('tick'), 0.99), checkoutP50: pct(all('checkout'), 0.5), checkoutP99: pct(all('checkout'), 0.99),
    checkouts: all('checkout').length, cpuPct: +(100 * sum('cpuMs') / 1000 / wall).toFixed(1), rssMB: +(ss.at(-1)?.rss / 2 ** 20).toFixed(1),
    heapMB: +(ss.at(-1)?.heap / 2 ** 20).toFixed(1), loopP99Ms: Math.max(0, ...ss.map((s) => s.loopP99)), eventsPerS: +(sum('events') / wall).toFixed(1),
    dbWritesPerS: +(sum('dbWrites') / wall).toFixed(3), checkpointMsMax: Math.max(0, ...all('checkpointMs')), dbBytes: ss.at(-1)?.dbBytes, invariants: sum('invariants'), acts };
}
function clientWindow(c0, bots, wallS) {
  return { rttP50: pct(cl.rtt.slice(c0.rtt), 0.5), rttP99: pct(cl.rtt.slice(c0.rtt), 0.99), rtts: cl.rtt.length - c0.rtt,
    cmdRttP99: pct(cl.cmdRtt.slice(c0.cmd), 0.99), cmds: cl.cmdRtt.length - c0.cmd,
    wsBytesPerCharS: +((cl.bytesIn - c0.bytesIn + cl.bytesOut - c0.bytesOut) / bots / wallS).toFixed(1),
    wsInBytesPerCharS: +((cl.bytesIn - c0.bytesIn) / bots / wallS).toFixed(1) };
}
const mark = () => ({ rtt: cl.rtt.length, cmd: cl.cmdRtt.length, bytesIn: cl.bytesIn, bytesOut: cl.bytesOut });
const genCpu = () => process.cpuUsage();

// ---------- scenarios ----------
const result = { scenario, steps: [], machine: { cpus: cpus().length, model: cpus()[0].model, memGB: +(totalmem() / 2 ** 30).toFixed(0), node: process.version },
  speed, seed: +o.seed, population: { chars: pop.chars.length, configSources: sources }, startedAt: new Date().toISOString() };
const honest = pop.chars.filter((c) => !c.multibox);
const idle = await sleep(6000).then(() => measure(Date.now() - 6000, Date.now(), 0)); // baseline: seeded, nobody driving
result.idle = idle;

async function steady(bots, ms, extra = {}) {
  await sleep(warmupMs);
  const t0 = Date.now(), c0 = mark(), g0 = genCpu();
  await sleep(ms);
  const t1 = Date.now() + 100;
  await sleep(2200); // last server report lands
  const w = measure(t0, t1, bots), g = process.cpuUsage(g0);
  const step = { ...w, ...clientWindow(c0, bots, (t1 - t0) / 1000), loadGenCpuPct: +(100 * (g.user + g.system) / 1000 / (t1 - t0)).toFixed(1), ...extra };
  step.rssPerCharKB = +((step.rssMB - idle.rssMB) * 1024 / bots).toFixed(1);
  result.steps.push(step);
  console.log(JSON.stringify(step));
  return step;
}

if (scenario === 's1' || scenario === 'smoke' || scenario === 's6') {
  for (const n of steps) {
    const add = honest.slice(running.length, n);
    for (let i = 0; i < add.length; i++) { startBot(add[i]); if (i % 20 === 19) await sleep(200); }
    if (scenario === 's6' && n === maxBots) for (const c of pop.chars.filter((x) => x.multibox)) startBot(c);
    await steady(n, minutes * 60e3, scenario === 's6' ? { cheaters: honest.slice(0, n).filter((c) => c.cheat).length } : {});
  }
  if (scenario === 's6') result.cheats = { ...cheats, multiboxCloses: cl.closes };
}

if (scenario === 's2') {
  const driven = honest.filter((_, i) => i % 10 < 3), back = honest.filter((_, i) => i % 10 >= 3).slice(0, 200);
  driven.forEach(startBot);
  await steady(driven.length, 60e3, { phase: 'driven 30%' });
  const views = [], c0 = mark(), t0 = Date.now();
  await Promise.all(back.map(async (c, i) => {
    await sleep(i * 10000 / back.length);
    const s = performance.now();
    const r = await realFetch(`${url}/api/characters/${c.view.characterId}`, { headers: { authorization: `Bearer ${tokenOf(c)}` } });
    const v = await r.json();
    views.push({ ms: performance.now() - s, status: r.status, backlogMs: v.backlogMs, frozen: v.clockFrozen });
    startBot(c);
  }));
  const storm = { returns: views.length, stormS: (Date.now() - t0) / 1000, viewP50: pct(views.map((x) => x.ms), 0.5), viewP99: pct(views.map((x) => x.ms), 0.99),
    errors: views.filter((x) => x.status !== 200).length, stillFrozen: views.filter((x) => x.frozen).length };
  await sleep(2500);
  Object.assign(storm, measure(t0, Date.now(), driven.length + back.length), { rttP99: pct(cl.rtt.slice(c0.rtt), 0.99) });
  result.storm = storm;
  console.log(JSON.stringify({ storm }));
  await steady(driven.length + back.length, 60e3, { phase: 'after storm' });
}

running.forEach((b) => b.stop());
child.send('stop');
await new Promise((r) => child.on('exit', r));
rmSync(dir, { recursive: true, force: true });
result.finishedAt = new Date().toISOString();
if (o.out) writeFileSync(o.out, JSON.stringify(result, null, 1));

if (scenario === 'smoke') { // pass limits for the PR smoke (generous: laptop, shared CI)
  const s = result.steps[0];
  const fails = [s.invariants && `server errors ${s.invariants}`, !(s.fightP99 <= 50) && `fight p99 ${s.fightP99} ms`,
    !(s.rttP99 <= 100) && `RTT p99 ${s.rttP99} ms`, !(s.fights > 0) && 'no fights resolved'].filter(Boolean); // null (no samples) fails
  console.log(fails.length ? `SMOKE FAIL: ${fails.join(', ')}` : 'SMOKE OK');
  process.exit(fails.length ? 1 : 0);
}
process.exit(0);
