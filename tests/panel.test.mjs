import assert from 'node:assert/strict';
import test from 'node:test';
const nodes = new Map();
function get(id) {
  if (!nodes.has(id)) nodes.set(id, {hidden:false, attrs:{}, setAttribute(k,v) { this.attrs[k] = v; }});
  return nodes.get(id);
}
globalThis.document = {getElementById:get, querySelector:get};
const {showPanel, closeSettings} = await import('../src/panel.js');
test('settings replace the character list and closing them restores it', () => {
  const visible = () => ['.stage','ai'].filter((id) => !get(id).hidden);
  showPanel('ai');
  assert.deepEqual(visible(), ['ai']);
  closeSettings();
  assert.deepEqual(visible(), ['.stage']);
});
