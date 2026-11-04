import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('battle view only loads art through hosts the roasset:// proxy allows', () => {
  const hosts = new Set([...read('src-tauri/src/battle.rs').matchAll(/\("([a-z0-9.-]+)", "\//g)].map(m => m[1]));
  const used = [...read('src/battle.js').matchAll(/asset\('([a-z0-9.-]+)'/g)].map(m => m[1]);
  assert.ok(used.length >= 4);
  for (const host of used) assert.ok(hosts.has(host), `${host} is not an allowed mirror`);
});

test('battle view is opened from the character detail and bundles no Gravity art', () => {
  assert.match(read('src/index.html'), /class="map-link battle-link"/);
  assert.match(read('src/main.js'), /invoke\("open_battle", \{ name: info\.name \}\)/);
  assert.doesNotMatch(read('src/battle.html') + read('src/battle.js'), /src="ui\/|url\(ui\//);
});
