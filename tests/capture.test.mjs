import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../src/capture.js', import.meta.url), 'utf8');

test('records api traffic, skips auth, throttles repeated GETs and snapshots', async () => {
  const recs = [];
  const res = text => ({ status: 200, clone: () => ({ text: async () => text }) });
  class ES { constructor() { this.l = {}; } addEventListener(n, f) { (this.l[n] ||= []).push(f); } fire(n, data) { this.l[n]?.forEach(f => f({ data })); } }
  const window = {
    fetch: async () => res('{"ok":1}'),
    EventSource: ES,
    __TAURI_INTERNALS__: { invoke: async (_, a) => { recs.push(JSON.parse(a.payload.rec)); } },
  };
  vm.runInNewContext(`const RO_IDLE_PROFILE = 'profile-1';${source}`, { window, Date });
  await window.fetch('/api/auth/login', { method: 'POST', body: '{"password":"x"}' });
  await window.fetch('/api/characters/c1?deferCatchup=1');
  await window.fetch('/api/characters/c1?deferCatchup=1');
  await window.fetch('/api/characters/c1/commands', { method: 'POST', body: '{"command":{"type":"equip"}}' });
  await window.fetch('/assets/x.js');
  const es = new window.EventSource('/api/characters/c1/stream?after=0');
  es.fire('snapshot', '{"a":1}');
  es.fire('snapshot', '{"a":2}');
  es.fire('events', '[1]');
  await new Promise(r => setTimeout(r, 0));
  const kinds = recs.map(r => r.kind === 'http' ? `${r.method} ${r.path}` : `${r.kind}:${r.name ?? ''}`);
  assert.deepEqual(kinds, [
    'GET /api/characters/c1?deferCatchup=1',
    'POST /api/characters/c1/commands',
    'sse-open:', 'sse:snapshot', 'sse:events',
  ]);
  assert.equal(recs[1].body, '{"command":{"type":"equip"}}');
  assert.equal(recs[1].resp, '{"ok":1}');
  assert.ok(!JSON.stringify(recs).includes('password'));
});
