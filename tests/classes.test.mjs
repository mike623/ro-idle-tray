import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync, readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('class chart ships with the app and opens from the panel footer', () => {
  const html = read('src/classes.html');
  const src = html.match(/<img[^>]+src="([^"]+)"/)?.[1];
  assert.equal(src, 'class-chart.png');
  assert.ok(existsSync(new URL(`../src/${src}`, import.meta.url)), 'the chart image is bundled');
  assert.match(read('src/index.html'), /id="classes"[^>]*>Classes</);
  const panel = JSON.parse(read('src-tauri/permissions/app.json'))
    .permission.find(p => p.identifier === 'panel-commands').commands.allow;
  assert.ok(panel.includes('open_classes'));
  assert.match(read('src/main.js'), /open_classes/);
});
