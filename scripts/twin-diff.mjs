// Side-by-side twin test (#23): `node scripts/twin-diff.mjs <capture dir | capture.jsonl…> [--speed 60] [--hours H]
//   [--out docs/offline-backend/twin-report.md] [--l2-seeds 1000]`
// L1 formula check (scripts/formula-check.py on a frozen copy of the captures), L2 fight replay (tests/l2-fights.mjs),
// L3 session rates: every captured character gets a twin seeded from its first captured view (T0), driven by our
// brain (brain/client.js over WebSocket) against our server on an accelerated clock for the same simulated time the
// real character farmed, then kills/h, EXP/h, zeny/h, deaths, potions and drops are compared. L4 needs an offline-cycle
// capture that does not exist yet. Read-only towards the capture files and ro-idle.app.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const ACTIVE_GAP_MS = 60e3; // same rule as server/offline.js: longer pauses are not farming time
const ZENY = { autoSell: 1, shopSell: 1, autoBuy: -1, shopBuy: -1 };
export const METRICS = ['kills', 'baseExp', 'zeny', 'deaths', 'potions', 'drops'];
const COUNTS = new Set(['kills', 'deaths', 'potions', 'drops']);

/** Session counters from event bodies. */
export function tally(bodies) {
  const t = Object.fromEntries(METRICS.map((k) => [k, 0]));
  const n = { baseExp: 0, zeny: 0 }; // events behind the non-count metrics (their Poisson error)
  for (const b of bodies) {
    if (b.type === 'kill') t.kills++;
    else if (b.type === 'exp') { t.baseExp += b.base; n.baseExp++; }
    else if (b.type === 'death') t.deaths++;
    else if (b.type === 'useItem') t.potions++;
    else if (b.type === 'pickup') t.drops += b.qty;
    if (ZENY[b.type]) { t.zeny += ZENY[b.type] * b.zeny; n.zeny++; }
  }
  return Object.defineProperty(t, 'n', { value: n }); // non-enumerable: tables and equality see the metrics only
}

const parse = (line) => { try { return JSON.parse(line); } catch { return null; } };
const charId = (path) => +path?.match(/^\/api\/characters\/(\d+)/)?.[1];

/** Per character: T0 view (first captured GET view), events after it, active farming time. */
export function realSessions(lines) {
  const t0 = new Map(), events = new Map();
  for (const line of lines) {
    const r = typeof line === 'string' ? parse(line) : line;
    if (!r) continue;
    if (r.kind === 'http' && r.method === 'GET' && r.status === 200 && /^\/api\/characters\/\d+$/.test(r.path?.split('?')[0])) {
      const v = typeof r.resp === 'string' ? JSON.parse(r.resp) : r.resp;
      if (v?.snapshot && !t0.has(v.characterId)) t0.set(v.characterId, v);
    } else if (r.kind === 'sse' && r.name === 'events') {
      const id = charId(r.path), list = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      const m = events.get(id) ?? events.set(id, new Map()).get(id);
      for (const e of list) m.set(e.seq, e);
    }
  }
  return [...t0.values()].map((v) => {
    const evs = [...(events.get(v.characterId)?.values() ?? [])].filter((e) => e.seq > v.lastSeq).sort((a, b) => a.simTime - b.simTime || a.seq - b.seq);
    let activeMs = 0;
    for (let i = 1; i < evs.length; i++) { const d = evs[i].simTime - evs[i - 1].simTime; if (d < ACTIVE_GAP_MS) activeMs += d; }
    return { id: v.characterId, t0: v, job: v.snapshot.character.job, baseLv: v.snapshot.character.baseLv, mapId: v.snapshot.mapId,
      activeMs, counts: tally(evs.map((e) => e.body)) };
  });
}

/**
 * Twin vs real rate. Counts: two-sample Poisson z-test (95%); non-counts (EXP, zeny) use the relative error of
 * `relErrFrom` counts (the exp / zeny events behind them). Passes inside the CI or within ±10% of the real rate.
 */
export function compareRate({ real, realH, twin, twinH, relErrFrom }) {
  const r = real / realH, w = twin / twinH;
  const within10 = Math.abs(w - r) <= 0.1 * Math.abs(r) || (r === 0 && w === 0);
  let se;
  if (relErrFrom) {
    const rel = Math.sqrt(1 / Math.max(1, relErrFrom.real) + 1 / Math.max(1, relErrFrom.twin));
    se = rel * Math.max(Math.abs(r), Math.abs(w));
  } else se = Math.sqrt(Math.max(real, 1) / realH ** 2 + Math.max(twin, 1) / twinH ** 2); // ≥1 event: CI of an empty count
  const z = se ? (w - r) / se : 0;
  return { real: r, twin: w, z, ok: within10 || Math.abs(z) <= 1.96 };
}

// ---------- L3: run the twins ----------
export async function runTwins(sessions, { hours, speed = 60, seed = 1, log = () => {} }) {
  const { startServer } = await import('../server/index.js');
  const { seedCapture } = await import('../server/seed.js');
  const { drive } = await import('../brain/client.js');
  const { createBrain } = await import('../brain/brain.js');
  const { data } = await import('../server/game.js');
  const dir = mkdtempSync(join(tmpdir(), 'twin-'));
  const start = performance.now(), base = Date.now();
  const now = () => Math.floor(base + (performance.now() - start) * speed);
  const srv = await startServer({ port: 0, db: join(dir, 'twin.sqlite'), now, seed, tickMs: Math.max(1, 250 / speed), checkpointMs: 0 });
  const g = srv.game, token = 'twin';
  // T0 views as one synthetic capture: party/kill-event from the same capture are not needed for the twins' rates.
  seedCapture(g, sessions.map((s) => JSON.stringify({ kind: 'http', method: 'GET', status: 200, path: `/api/characters/${s.id}`, resp: s.t0 })),
    { account: 'twin', token });
  // the captured party: every twin in one party (the real 8 farmed as one party on one map)
  g.parties.set(1, { id: 1, name: 'twins', leaderId: sessions[0].id, expShare: 'even', itemShare: 'each' });
  const got = new Map(sessions.map((s) => [s.id, []]));
  for (const s of sessions) {
    const C = g.chars.get(s.id);
    C.partyId = 1;
    if (!C.running) g.command(s.id, { command: { type: 'start' } });
    g.subscribe(s.id, (type, evs) => { if (type === 'events') for (const e of evs) got.get(s.id).push(e.body); });
  }
  const t0 = now();
  const drivers = sessions.map((s) => drive({ base: `http://127.0.0.1:${srv.port}`, characterId: s.id, token, now,
    intervalMs: Math.max(1, 250 / speed), brain: createBrain({ monsters: data.monsters }) }));
  const endAt = t0 + hours * 3600e3;
  while (now() < endAt) {
    await new Promise((r) => setTimeout(r, 1000));
    log(`  twins: ${((now() - t0) / 3600e3).toFixed(2)} / ${hours.toFixed(2)} sim h`);
  }
  const simMs = now() - t0;
  drivers.forEach((d) => d.stop());
  await srv.close();
  rmSync(dir, { recursive: true, force: true });
  return { simMs, wallMs: performance.now() - start, twins: sessions.map((s) => ({ id: s.id, counts: tally(got.get(s.id)) })) };
}

// ---------- report ----------
const fmt = (x) => (Math.abs(x) >= 100 ? Math.round(x).toLocaleString('en-US') : x.toFixed(1));

function l1(captureDir) {
  const bundle = resolve('.scratch/bundle.js');
  if (!existsSync(bundle)) return { text: 'Skipped: `.scratch/bundle.js` (the public client bundle) is absent.', ok: null };
  let out, code = 0;
  try { out = execFileSync('python3', ['-I', 'scripts/formula-check.py', captureDir, bundle], { maxBuffer: 1 << 26 }).toString(); }
  catch (e) { out = String(e.stdout); code = e.status; }
  const rows = [...out.matchAll(/^(\w+)\s+(\d+)\s+(\d+)\s+(\d+)( \(\w+\))?$/gm)].map((m) => ({ name: m[1], ok: +m[2], miss: +m[3], skip: +m[4], tag: m[5]?.trim() ?? '' }));
  const failing = out.match(/FAILING adopted formulas: (.*)/)?.[1] ?? '?';
  return { rows, failing, code };
}

async function l2(seeds) {
  const { fights, replay } = await import('../tests/l2-fights.mjs');
  const rs = fights.map((f) => replay(f, seeds));
  const pick = (sel) => ({ n: sel.length, pass: sel.filter((r) => r.pass).length });
  const worst = rs.filter((r) => !r.pass && r.own).map((r) => ({ ...r, miss: Object.entries(r.metrics).filter(([, m]) => !m.ok) }))
    .sort((a, b) => b.miss.length - a.miss.length).slice(0, 8);
  return { own: pick(rs.filter((r) => r.own)), solo: pick(rs.filter((r) => r.solo)), helped: pick(rs.filter((r) => !r.own)), all: pick(rs), worst };
}

export function l3Table(sessions, run) {
  const rows = [], outliers = [];
  for (const s of sessions) {
    const w = run.twins.find((x) => x.id === s.id).counts;
    const realH = s.activeMs / 3600e3, twinH = run.simMs / 3600e3;
    const cells = METRICS.map((k) => {
      const c = compareRate({ real: s.counts[k], realH, twin: w[k], twinH, relErrFrom: COUNTS.has(k) ? null : { real: s.counts.n[k], twin: w.n[k] } });
      const ratio = c.real ? c.twin / c.real : c.twin ? Infinity : 1;
      outliers.push({ id: s.id, job: s.job, k, ...c, ratio });
      return `${c.ok ? '✅' : '❌'} ${fmt(c.real)} → ${fmt(c.twin)}`;
    });
    rows.push(`| ${s.id} | ${s.job} ${s.baseLv} | ${s.mapId} | ${realH.toFixed(2)} | ${cells.join(' | ')} |`);
  }
  const worst = outliers.filter((o) => !o.ok).sort((a, b) => Math.abs(Math.log(b.ratio || 1e-9)) - Math.abs(Math.log(a.ratio || 1e-9))).slice(0, 8);
  return { rows, worst, pass: outliers.filter((o) => o.ok).length, total: outliers.length };
}

function listCaptures(args) {
  const files = args.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((n) => n.endsWith('.jsonl')).map((n) => join(p, n)) : [p]));
  const dir = mkdtempSync(join(tmpdir(), 'twin-capture-')); // frozen copy: the capture may still be growing
  for (const f of files) cpSync(f, join(dir, basename(f)));
  return { dir, files: files.map((f) => join(dir, basename(f))) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { speed: { type: 'string', default: '60' },
    hours: { type: 'string' }, out: { type: 'string', default: 'docs/offline-backend/twin-report.md' }, 'l2-seeds': { type: 'string', default: '1000' },
    'min-hours': { type: 'string', default: '1' }, json: { type: 'string' } } });
  if (!positionals.length) { console.error('usage: node scripts/twin-diff.mjs <capture dir | capture.jsonl…> [--speed 60] [--hours H]'); process.exit(2); }
  const cap = listCaptures(positionals);
  const log = (m) => console.error(m);
  log('L1 formula check…');
  const L1 = l1(cap.dir);
  log('L2 fight replay…');
  const L2 = await l2(+values['l2-seeds']);
  log('L3 reading captures…');
  const sessions = realSessions(cap.files.flatMap((f) => readFileSync(f, 'utf8').split('\n')))
    .filter((s) => s.activeMs >= +values['min-hours'] * 3600e3).sort((a, b) => a.id - b.id);
  const median = [...sessions.map((s) => s.activeMs)].sort((a, b) => a - b)[Math.floor(sessions.length / 2)] / 3600e3;
  const hours = values.hours ? +values.hours : median;
  log(`L3 ${sessions.length} twins for ${hours.toFixed(2)} sim h at ×${values.speed}…`);
  const run = await runTwins(sessions, { hours, speed: +values.speed, log });
  const L3 = l3Table(sessions, run);
  rmSync(cap.dir, { recursive: true, force: true });
  if (values.json) writeFileSync(values.json, JSON.stringify({ L1, L2, sessions: sessions.map(({ t0, ...s }) => s), run }, null, 1));
  const pct = (x) => `${x.pass}/${x.n} = ${(100 * x.pass / x.n).toFixed(1)}%`;
  const md = `# Twin report (#23)

Generated ${new Date().toISOString().slice(0, 10)} by \`node scripts/twin-diff.mjs <capture dir>\` from ${cap.files.length} local capture files
(the user's own 8-character party; read-only). Character ids and jobs only; no names or chat.

## L1 formulas (\`scripts/formula-check.py\`)

Failing adopted formulas: **${L1.failing ?? 'n/a'}** (exit ${L1.code ?? '—'}).

| Formula | OK | MISS | SKIP | |
|---|---|---|---|---|
${(L1.rows ?? []).map((r) => `| ${r.name} | ${r.ok} | ${r.miss} | ${r.skip} | ${r.tag} |`).join('\n')}

## L2 fight replay (engine, ${values['l2-seeds']} seeds per fight, real within simulated p5–p95 on duration, damage taken, hits)

| Set | Pass |
|---|---|
| own-finish (bar ≥ 90%) | ${pct(L2.own)} ${L2.own.pass / L2.own.n >= 0.9 ? '✅' : '❌'} |
| solo from \`found\` | ${pct(L2.solo)} |
| party-helped (not judged: a solo replay cannot reproduce party damage) | ${pct(L2.helped)} |
| all | ${pct(L2.all)} |

Worst own-finish fights: ${L2.worst.map((r) => `\`${r.id}\` ${r.job} vs ${r.mobId} (${r.miss.map(([k, m]) => `${k} real ${m.real} vs p5–p95 ${m.p5}–${m.p95}`).join('; ')})`).join(' · ') || 'none'}

## L3 session rates (twins: our brain + server)

${sessions.length} twins seeded from their first captured view (T0), one party, driven by \`brain/client.js\` over WebSocket
for ${(run.simMs / 3600e3).toFixed(2)} simulated hours (median real farming time; clock ×${values.speed}, ${(run.wallMs / 60e3).toFixed(1)} min wall).
Real farming time = sum of gaps < 60 s between the character's events after T0. Each cell: real/h → twin/h
(deaths, potions, drops are per hour too). ✅ = inside the two-sample Poisson 95% CI or within ±10%; EXP and zeny use
the relative error of the exp / zeny event counts behind them. ${L3.pass}/${L3.total} cells pass.

| Char | Job Lv | Map | Real h | Kills/h | Base EXP/h | Zeny/h | Deaths/h | Potions/h | Drops/h |
|---|---|---|---|---|---|---|---|---|---|
${L3.rows.join('\n')}

Worst outliers: ${L3.worst.map((o) => `${o.id} ${o.job} ${o.k} ${fmt(o.real)} → ${fmt(o.twin)} (×${Number.isFinite(o.ratio) ? o.ratio.toFixed(2) : '∞'})`).join(' · ') || 'none'}

## L4 offline checkout

Skipped: no capture of a full-party offline/return cycle on ro-idle.app exists yet (needed: party offline ≥ 1 h, then
return, with the catch-up summary recorded).
`;
  writeFileSync(values.out, md);
  log(`wrote ${values.out}`);
}
