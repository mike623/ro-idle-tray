import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../src-tauri/${path}`, import.meta.url), 'utf8');
test('game origin can report characters and open the assistant window, without chat or tray administration', () => {
  const manifest = JSON.parse(read('permissions/app.json'));
  const remote = JSON.parse(read('capabilities/remote.json'));
  const allowed = remote.permissions.flatMap(id => manifest.permission.find(p => p.identifier === id)?.commands.allow ?? []);
  assert.deepEqual(allowed.sort(), ['character_report', 'chat_alerts', 'chat_tutorial', 'open_assistant']);
  assert.deepEqual(remote.windows, ['game-*']);
  assert.deepEqual(remote.remote.urls, ['https://ro-idle.app', 'https://ro-idle.app/*']);
});

test('every registered application command has an explicit capability', () => {
  const permissions = JSON.parse(read('permissions/app.json')).permission;
  const capabilities = ['default', 'remote', 'atlas', 'items', 'assistant'].map(name => JSON.parse(read(`capabilities/${name}.json`)));
  const granted = new Set(capabilities.flatMap(c => c.permissions));
  const allowed = new Set(permissions.filter(p => granted.has(p.identifier)).flatMap(p => p.commands.allow));
  const handlers = read('src/lib.rs').match(/generate_handler!\[([\s\S]*?)\]/)[1]
    .split(',').map(s => s.trim().split('::').at(-1)).filter(Boolean);
  for (const command of handlers) assert.ok(allowed.has(command), `No capability grants ${command}`);
  assert.deepEqual(JSON.parse(read('capabilities/atlas.json')).windows, ['atlas']);
  assert.deepEqual(JSON.parse(read('capabilities/items.json')).windows, ['items']);
  assert.deepEqual(JSON.parse(read('capabilities/assistant.json')).windows, ['assistant']);
  // Only the assistant window sends chat; the panel just opens it.
  const panelAllow = permissions.find(p => p.identifier === 'panel-commands').commands.allow;
  assert.ok(!panelAllow.some(c => c.startsWith('chat_')), 'panel should not hold chat commands');
  // Every command the embedded assistant invokes must be granted to the assistant window.
  const assistantAllow = permissions.find(p => p.identifier === 'assistant-commands').commands.allow;
  const bubble = readFileSync(new URL('../src/bubble.js', import.meta.url), 'utf8');
  const embedded = bubble.slice(0, bubble.indexOf('if (!embed) {')) + bubble.slice(bubble.indexOf("$('close')"));
  for (const [, cmd] of embedded.matchAll(/invoke\('([a-z_]+)'/g)) assert.ok(assistantAllow.includes(cmd), `assistant window lacks ${cmd}`);
  assert.deepEqual(permissions.find(p => p.identifier === 'atlas-commands').commands.allow, ['atlas_characters', 'move_all', 'move_selected']);
});
