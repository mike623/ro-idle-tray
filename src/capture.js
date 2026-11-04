// Dev builds only (see lib.rs): record raw ro-idle.app API traffic to
// <config>/capture/<profile>-YYYY-MM-DD.jsonl so a local backend can be built
// against real payloads. Auth/account calls are never recorded.
(() => {
  const emit = rec => window.__TAURI_INTERNALS__?.invoke('plugin:event|emit',
    { event: 'ro-idle-capture', payload: { profile: RO_IDLE_PROFILE, rec: JSON.stringify({ t: Date.now(), ...rec }) } })
    .catch(() => {});
  // ponytail: snapshots and polled GETs repeat every few seconds; keep one per key per minute.
  const seen = {};
  const fresh = key => {
    if (Date.now() - (seen[key] || 0) < 60000) return false;
    seen[key] = Date.now();
    return true;
  };
  const SKIP = /\/api\/(auth|account)\//;
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    const url = String(input?.url ?? input);
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const method = (init?.method || input?.method || 'GET').toUpperCase();
    if (!path.startsWith('/api/') || SKIP.test(path)) return p;
    if (method === 'GET' && !fresh(method + path.split('?')[0])) return p;
    const body = typeof init?.body === 'string' ? init.body : null;
    p.then(r => r.clone().text().then(text => emit({ kind: 'http', method, path, body, status: r.status, resp: text })))
      .catch(e => emit({ kind: 'http', method, path, body, error: String(e) }));
    return p;
  };
  // Every named event the game's bundle listens for on its stream.
  const NAMES = ['message', 'snapshot', 'events', 'chat', 'chatCursor', 'gap', 'idle', 'arena', 'arenaNotice',
    'lounge', 'trade', 'restart', 'superseded', 'watchLimit'];
  const OrigES = window.EventSource;
  window.EventSource = class extends OrigES {
    constructor(url, opts) {
      super(url, opts);
      const path = String(url).replace(/^https?:\/\/[^/]+/, '');
      emit({ kind: 'sse-open', path });
      for (const name of NAMES) this.addEventListener(name, e => {
        if (name === 'snapshot' && !fresh('sse:snapshot')) return;
        emit({ kind: 'sse', path, name, id: e.lastEventId || null, data: e.data });
      });
    }
  };
})();
