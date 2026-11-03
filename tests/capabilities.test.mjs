import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../src-tauri/${path}`, import.meta.url), 'utf8');
test('game origin can report characters and use scoped chat, without tray administration', () => {
  const manifest = JSON.parse(read('permissions/app.json'));
  const remote = JSON.parse(read('capabilities/remote.json'));
  const allowed = remote.permissions.flatMap(id => manifest.permission.find(p => p.identifier === id)?.commands.allow ?? []);
  assert.deepEqual(allowed.sort(), ['character_report', 'chat_alert_ack', 'chat_alert_open', 'chat_alerts', 'chat_character', 'chat_history', 'chat_memory', 'chat_new', 'chat_send', 'chat_tutorial']);
  assert.deepEqual(remote.windows, ['game-*']);
  assert.deepEqual(remote.remote.urls, ['https://ro-idle.app', 'https://ro-idle.app/*']);
});

test('every registered application command has an explicit capability', () => {
  const permissions = JSON.parse(read('permissions/app.json')).permission;
  const capabilities = ['default', 'remote', 'atlas', 'items'].map(name => JSON.parse(read(`capabilities/${name}.json`)));
  const granted = new Set(capabilities.flatMap(c => c.permissions));
  const allowed = new Set(permissions.filter(p => granted.has(p.identifier)).flatMap(p => p.commands.allow));
  const handlers = read('src/lib.rs').match(/generate_handler!\[([\s\S]*?)\]/)[1]
    .split(',').map(s => s.trim().split('::').at(-1)).filter(Boolean);
  for (const command of handlers) assert.ok(allowed.has(command), `No capability grants ${command}`);
  assert.deepEqual(JSON.parse(read('capabilities/atlas.json')).windows, ['atlas']);
  assert.deepEqual(JSON.parse(read('capabilities/items.json')).windows, ['items']);
  assert.deepEqual(permissions.find(p => p.identifier === 'atlas-commands').commands.allow, ['atlas_characters', 'move_all', 'move_selected']);
});
