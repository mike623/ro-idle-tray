// WebSocket driver for brain/brain.js (#19): one connection per character to the owned server (#16).
// Node 22 (global WebSocket/fetch) and the Beta tray webview (same origin as the server, cookie auth).
//   Node:    drive({ base: 'http://127.0.0.1:8787', characterId, token })
//   Browser: boot({ profile: 'profile-1' })  — dev-login as the profile's account, then drive its characters
// The brain decides; this file only moves messages. Timers here only wake the brain; pacing is the brain's wall clock.
import { createBrain, observe, tick } from './brain.js';

export function drive({ base, characterId, token, now = Date.now, intervalMs = 250, log = () => {}, brain = createBrain(),
  WebSocketImpl = globalThis.WebSocket }) {
  const auth = token ? { authorization: `Bearer ${token}` } : {};
  const url = `${base.replace(/^http/, 'ws')}/ws?character=${characterId}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  let ws, n = 0, closed = false, opened;
  const ready = new Promise((r) => { opened = r; });

  function step() {
    if (ws?.readyState !== 1) return;
    for (const a of tick(brain, now())) {
      log('>', characterId, a);
      if (a.type === 'command') command(a.command);
      else ws.send(JSON.stringify({ id: ++n, ...a }));
    }
  }
  async function command(c) {
    let m;
    try {
      const r = await fetch(`${base}/api/characters/${characterId}/commands`, { method: 'POST',
        headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ commandId: crypto.randomUUID(), command: c }) });
      const body = await r.json();
      m = { type: 'result', ok: r.ok, error: body.error?.code, view: body.view };
    } catch { m = { type: 'result', ok: false, error: 'NETWORK' }; }
    log('<', characterId, m.ok ? { type: 'result', ok: true } : m);
    observe(brain, m, now());
    step();
  }
  function connect() {
    ws = new WebSocketImpl(url);
    ws.onopen = () => opened();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type !== 'snapshot') log('<', characterId, m);
      observe(brain, m, now());
      step();
    };
    ws.onclose = (ev) => {
      brain.inflight = null;
      log('closed', characterId, ev.code);
      if (!closed && ![4000, 4001, 4401].includes(ev.code)) setTimeout(connect, 2000); // superseded / cap / auth: stay closed
    };
  }
  connect();
  const timer = intervalMs ? setInterval(step, intervalMs) : null;
  return { brain, step, ready, stop() { closed = true; clearInterval(timer); ws.close(); } };
}

export async function boot({ profile, base = location.origin, log = (...x) => console.log('[brain]', ...x) } = {}) {
  if ((await fetch('/api/auth/me')).status === 401) {
    const r = await fetch('/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: profile }) });
    if (r.ok) location.reload(); // the official client reads the login on load
    else log('no account', profile);
    return [];
  }
  const { characters } = await (await fetch('/api/characters')).json();
  // ponytail: drive every character of the account; the brain idles while one is stopped (server caps at 8)
  return characters.map((c) => drive({ base, characterId: c.id, log }));
}
