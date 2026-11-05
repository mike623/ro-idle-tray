// Owned ro-idle server (#16): `node server/index.js --port 8787 --db server/data.sqlite`.
// REST read paths + commands in the captured shapes (docs/offline-backend/api.md), SSE stream, and a WebSocket
// `/ws?character=<id>&token=<t>` per driven character for brain actions. State lives in memory (server/game.js) and
// is checkpointed to SQLite every --checkpoint seconds, on driver disconnect and on shutdown.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { WebSocketServer } from 'ws';
import { createGame } from './game.js';
import { attachOffline } from './offline.js';
import { mulberry32 } from './rules/engine.js';

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  const put = db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
  return {
    load: () => JSON.parse(db.prepare('SELECT v FROM kv WHERE k = ?').get('state')?.v ?? '{}'),
    save: (game) => put.run('state', JSON.stringify(game.dump())), // ponytail: one row for all state; split per character if it grows
    close: () => db.close(),
  };
}

// ponytail: captured shapes, always empty — social/cosmetics/rankings are outside phase 1; fill when a phase needs them
const STUBS = {
  '/api/costumes': { costumes: [] },
  '/api/shared-configs': { rows: [] },
  '/api/vending': { shops: [], heldItems: [] },
  '/api/world-mvp': { mvps: [] },
  '/api/bans': { bans: [] },
};
const CHAR_STUBS = {
  guild: { guild: null, invites: [], skills: {}, directory: [] },
  mail: { inbox: [], sent: [], fee: 1000, maxItems: 5, maxNote: 60, ttlDays: 14 },
  trade: { trade: null },
  'shared-configs': { rows: [] },
  arena: { arena: null },
  duels: { duels: [] },
  lounge: { lounge: null },
  'world-mvp': { mvps: [] },
};

export async function startServer({ port = 8787, db = 'server/data.sqlite', now = Date.now, seed, tickMs = 250, checkpointMs = 30000,
  maxDrivers = 8, clientCache = 'server/client-cache', upstream = 'https://ro-idle.app', logErrors = false } = {}) {
  const store = openStore(db);
  const game = attachOffline(createGame({ now, rng: seed == null ? Math.random : mulberry32(seed), maxDrivers }));
  game.restore(store.load());
  let closed = false;
  const checkpoint = () => { if (!closed) store.save(game); };
  const drivers = new Map(); // charId → ws
  const viewers = new Set(); // open SSE streams { account, res }

  // Admin dashboard (/admin): ring buffer of log lines + live tail. Localhost only (server binds 127.0.0.1).
  const started = Date.now();
  const counters = { http: 0, httpErrors: 0, wsActions: 0, wsRejected: 0, events: 0 };
  const logRing = [];
  const tails = new Set();
  // kind: sys (connects, HTTP errors) · intent (client → server action) · event (server → client) · hit (per-hit event noise)
  const log = (line, toConsole = logErrors, kind = 'sys') => {
    const rec = { t: Date.now(), kind, line };
    logRing.push(rec);
    if (logRing.length > 5000) logRing.shift();
    for (const w of tails) w(rec);
    if (toConsole) console.log(line);
  };
  const QUIET = new Set(['playerAttack', 'monsterAttack', 'mobSkill', 'searching', 'found']); // per-hit noise: hidden by default on the dashboard
  const prevEmit = game.onEmit;
  game.onEmit = (C, out) => {
    prevEmit?.(C, out);
    counters.events += out.length;
    for (const e of out) log(`${C.id} ${C.name} ← ${e.body.type} ${brief(e.body)}`, false, QUIET.has(e.body.type) ? 'hit' : 'event');
  };

  const accountOf = (req, url) => {
    const auth = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)ro_token=([^;]+)/)?.[1];
    const token = auth ?? cookie ?? url.searchParams.get('token');
    // ponytail: plain local tokens, linear scan over accounts; hash + index if this ever leaves localhost
    return token ? [...game.accounts.values()].find((a) => a.token === token)?.name : undefined;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    counters.http++;
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': randomUUID(), ...headers });
      res.end(JSON.stringify(body));
    };
    const fail = (status, code, message, extra) => {
      counters.httpErrors++;
      log(`${status} ${req.method} ${url.pathname} ${code}`); // shape mismatches the real client hits
      send(status, { error: { code, message }, ...extra });
    };
    try {
      const body = req.method === 'POST' ? await readJson(req) : undefined;
      const p = url.pathname;
      if (req.method === 'GET' && p.startsWith('/brain/')) return serveBrain(res, p);
      if (p === '/admin') return raw(res, 200, TYPES['.html'], readFileSync(new URL('./admin.html', import.meta.url)));
      if (p === '/admin/state') return send(200, adminState());
      if (p === '/admin/log') return adminLog(req, res);
      if (req.method === 'GET' && !p.startsWith('/api/')) return await serveClient(res, p);
      if (p === '/api/auth/config') return send(200, { authMode: 'dev', google: false });
      if (p === '/api/auth/dev-login' && req.method === 'POST') {
        const a = game.accounts.get(body?.username);
        if (!a) return fail(401, 'UNAUTHENTICATED', '帳號不存在');
        return send(200, { ok: true }, { 'set-cookie': `ro_token=${a.token}; Path=/; HttpOnly; SameSite=Lax` });
      }
      if (p === '/api/auth/logout') return send(200, { ok: true }, { 'set-cookie': 'ro_token=; Path=/; Max-Age=0' });
      const account = accountOf(req, url);
      if (!account) return fail(401, 'UNAUTHENTICATED', '請先登入');
      if (p === '/api/auth/me') return send(200, { provider: 'dev', googleLinked: false, sponsor: false, username: account });
      if (p === '/api/characters') return send(200, { characters: game.charsOf(account).map((C) => ({ id: C.id, name: C.name,
        running: C.running, deleteAfterMs: null, frozen: false, job: C.snapshot.character.job, baseLv: C.snapshot.character.baseLv,
        jobLv: C.snapshot.character.jobLv, mapId: C.snapshot.mapId })) });
      if (p === '/api/maps/population') return send(200, game.population());
      if (p === '/api/kill-event') return send(200, { event: game.killEvent, nowMs: now() });
      if (p === '/api/storage') return send(200, { storage: game.storageFor(account) });
      if (p === '/api/presence') { game.online(account); return send(200, { ok: true }); }
      if (p === '/api/rankings') return send(200, { rankings: { updatedAt: now(), cacheSeconds: 30, overall: [] } });
      if (STUBS[p]) return send(200, STUBS[p]);

      const m = p.match(/^\/api\/characters\/(\d+)(?:\/([\w-]+))?(?:\/.*)?$/);
      if (!m) return fail(404, 'NOT_FOUND', 'not found');
      const C = game.chars.get(+m[1]);
      if (!C || C.account !== account) return fail(404, 'NOT_FOUND', '角色不存在');
      const after = +(url.searchParams.get('after') ?? 0) || 0;
      const seenSeq = C.lastSeq; // stream default `after`: before the checkout, so its gap is reported
      // deferCatchup=1 returns the pending backlog; the stream open (or a plain GET / summary / command) settles it
      if ((m[2] === undefined && !url.searchParams.has('deferCatchup')) || m[2] === 'stream' || m[2] === 'summary') game.checkout(C);
      if (m[2] === 'stream') game.online(account);
      switch (m[2]) {
        case undefined: { const v = game.view(C); game.online(account); return send(200, v); }
        case 'events': return send(200, game.events(C, after, Math.min(1000, +(url.searchParams.get('limit') ?? 1000) || 1000)));
        case 'summary': return send(200, game.summary(C, after));
        case 'party': // the client applies a party write reply as the party view, so writes fail loudly instead
          return req.method === 'POST' ? fail(422, 'GAME_RULE', '尚未支援隊伍操作') : send(200, game.partyView(C));
        case 'nearby': return send(200, { mapId: C.snapshot.mapId, characters: [] });
        case 'commands': {
          if (req.method !== 'POST' || !body?.command) return fail(400, 'INVALID_REQUEST', 'command required');
          const r = game.command(C.id, body);
          const { type, ...args } = body.command;
          log(`${C.id} ${C.name} → command ${type} ${brief(args)}${brief(args) ? ' ' : ''}${r.status < 300 ? 'ok' : `rejected ${r.body?.error?.code ?? r.status}`}`, false, 'intent');
          return send(r.status, r.body);
        }
        case 'stream': return stream(req, res, C, url, seenSeq);
        default:
          if (CHAR_STUBS[m[2]]) return send(200, CHAR_STUBS[m[2]]);
          if (req.method === 'POST') return send(200, { ok: true }); // ponytail: social writes (lounge heartbeat…) accepted as no-ops
          return fail(404, 'NOT_FOUND', 'not found');
      }
    } catch (err) {
      if (err instanceof SyntaxError) return fail(400, 'INVALID_REQUEST', 'bad json');
      console.error(err);
      log(`500 ${req.method} ${url.pathname} ${err.message}`, false);
      fail(500, 'INVARIANT', String(err.message));
    }
  });

  function adminState() {
    return {
      uptimeMs: Date.now() - started, rssMb: Math.round(process.memoryUsage().rss / 1e5) / 10, counters,
      drivers: drivers.size, viewers: viewers.size,
      characters: [...game.chars.values()].map((C) => {
        const c = C.snapshot.character;
        return { id: C.id, name: C.name, account: C.account, job: c.job, baseLv: c.baseLv, jobLv: c.jobLv, mapId: C.snapshot.mapId,
          hp: c.hp, maxHp: C.snapshot.derived?.maxHp ?? c.maxHp, zeny: c.zeny, activity: C.snapshot.activity ?? null,
          running: C.running, driven: drivers.has(C.id), driverUa: drivers.get(C.id)?.ua ?? null, lastSeq: C.lastSeq };
      }),
    };
  }
  function adminLog(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const w = (rec) => res.write(`data: ${JSON.stringify(rec)}\n\n`);
    logRing.forEach(w);
    tails.add(w);
    req.on('close', () => tails.delete(w));
  }

  function serveBrain(res, p) {
    const name = p.slice('/brain/'.length);
    const file = new URL(`../brain/${name}`, import.meta.url);
    if (!/^[\w-]+\.js$/.test(name) || !existsSync(file)) return raw(res, 404, 'text/plain', 'not found');
    raw(res, 200, TYPES['.js'], readFileSync(file));
  }
  // Official client bundle, cached locally on first GET (public static files only: no query, no credentials sent upstream).
  // The cache dir is gitignored: never commit or redistribute it.
  async function serveClient(res, p) {
    if (!/^\/[\w.\/@-]*$/.test(p) || p.split('/').includes('..')) return raw(res, 404, 'text/plain', 'not found');
    const key = p.endsWith('/') ? `${p}__index.html` : extname(p) ? p : `${p}/__index.html`;
    const file = join(clientCache, key);
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    if (existsSync(file)) return raw(res, 200, type, readFileSync(file));
    const up = await fetch(upstream + p, { redirect: 'follow' }).catch(() => null);
    if (!up?.ok) { log(`404 GET ${p} (upstream ${up?.status ?? 'unreachable'})`); return raw(res, 404, 'text/plain', 'not found'); }
    const bytes = Buffer.from(await up.arrayBuffer());
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    raw(res, 200, up.headers.get('content-type') ?? type, bytes);
  }

  function stream(req, res, C, url, seenSeq) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const write = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    write('snapshot', game.streamHello(C));
    write('chatCursor', { cursor: 0 });
    const after = +(url.searchParams.get('after') ?? seenSeq);
    const back = game.events(C, after, Infinity);
    if (back.gap) write('gap', {});
    if (back.events.length) write('events', back.events);
    const off = game.subscribe(C.id, write);
    const v = { account: C.account, write, res };
    viewers.add(v);
    req.on('close', () => { off(); viewers.delete(v); });
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => drive(ws, req, url));
  });

  function drive(ws, req, url) {
    const out = (x) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(x));
    const account = accountOf(req, url);
    const C = game.chars.get(+url.searchParams.get('character'));
    if (!account || !C || C.account !== account) { log(`ws refused ${url.searchParams.get('character')} UNAUTHENTICATED`); return ws.close(4401, 'UNAUTHENTICATED'); }
    const prev = drivers.get(C.id);
    const driven = [...drivers.keys()].filter((id) => game.chars.get(id).account === account && id !== C.id);
    if (driven.length >= game.maxDrivers) { out({ type: 'error', error: 'DRIVER_LIMIT', limit: game.maxDrivers }); return ws.close(4001, 'DRIVER_LIMIT'); }
    if (prev) { prev.send(JSON.stringify({ type: 'superseded' })); prev.close(4000, 'superseded'); }
    ws.ua = req.headers['user-agent'] ?? 'none'; // shows on the dashboard: who runs the brain (Beta webview, Node bot…)
    drivers.set(C.id, ws);
    game.driverOn(C.id);
    log(`${C.id} ${C.name} brain connected from ${req.socket.remoteAddress} ua="${req.headers['user-agent'] ?? 'none'}"`, false);
    const off = game.subscribe(C.id, (type, data) => out(type === 'events' ? { type, events: data } : { type, ...data }));
    out({ type: 'snapshot', ...game.streamHello(C) });
    ws.on('message', (raw) => {
      let a;
      try { a = JSON.parse(raw); } catch { return out({ type: 'result', ok: false, error: 'INVALID_REQUEST' }); }
      let r;
      try { r = game.act(C.id, a); } catch (err) { // an engine bug must not take every other character down with it
        console.error(err);
        r = { ok: false, error: 'INVARIANT' };
      }
      counters.wsActions++;
      if (!r.ok) counters.wsRejected++;
      const { id: _id, type, ...args } = a ?? {};
      log(`${C.id} ${C.name} → ${type} ${brief(args)}${brief(args) ? ' ' : ''}${r.ok ? 'ok' : `rejected ${r.error ?? ''}`}`, false, 'intent');
      out({ type: 'result', id: a.id, ...r });
    });
    ws.on('close', () => {
      off();
      if (drivers.get(C.id) === ws) { drivers.delete(C.id); game.driverOff(C.id); log(`${C.id} ${C.name} brain disconnected`, false); }
      checkpoint();
    });
  }

  /** Closes streams of accounts with no input for 20 min (`idle`; the client reopens on activity). */
  const sweep = () => {
    for (const v of viewers) if (game.idleViewer(v.account)) { v.write('idle', {}); v.res.end(); viewers.delete(v); }
  };
  const timers = [];
  if (tickMs) timers.push(setInterval(() => {
    try { game.tick(); } catch (err) { console.error(err); } // same guard as brain actions: one bad fight must not stop the world
    sweep();
  }, tickMs));
  if (checkpointMs) timers.push(setInterval(checkpoint, checkpointMs));
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    port: server.address().port, game, checkpoint, sweep,
    close: async () => {
      timers.forEach(clearInterval);
      for (const ws of wss.clients) ws.terminate();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      checkpoint();
      closed = true;
      store.close();
    },
  };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8' };
// One-line summary of an event body for the admin log: scalar fields only.
const brief = (b) => Object.entries(b).filter(([k, v]) => k !== 'type' && v !== null && typeof v !== 'object').slice(0, 6)
  .map(([k, v]) => `${k}=${v}`).join(' ');
const raw = (res, status, type, body) => { res.writeHead(status, { 'content-type': type }); res.end(body); };

async function readJson(req) {
  let s = '';
  for await (const chunk of req) { s += chunk; if (s.length > 1e6) throw new SyntaxError('too large'); }
  return s ? JSON.parse(s) : {};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { port: { type: 'string', default: '8787' }, db: { type: 'string', default: 'server/data.sqlite' },
    checkpoint: { type: 'string', default: '30' }, 'max-drivers': { type: 'string', default: '8' },
    'client-cache': { type: 'string', default: 'server/client-cache' } } });
  const srv = await startServer({ port: +values.port, db: values.db, checkpointMs: 1000 * +values.checkpoint, maxDrivers: +values['max-drivers'],
    clientCache: values['client-cache'], logErrors: true });
  console.log(`ro-idle server on http://127.0.0.1:${srv.port} (db ${values.db})`);
  const stop = async () => { await srv.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
