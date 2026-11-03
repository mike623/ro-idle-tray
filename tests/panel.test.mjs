import assert from 'node:assert/strict';
import test from 'node:test';
const nodes = new Map();
function get(id) {
  if (!nodes.has(id)) nodes.set(id, {hidden:false, attrs:{}, setAttribute(k,v) { this.attrs[k] = v; }});
  return nodes.get(id);
}
globalThis.document = {getElementById:get, querySelector:get};
const {showPanel, closeSettings} = await import('../src/panel.js');
test('settings restores the selected view; the assistant floats over the list and its footer button reflects it', () => {
  const visible = () => ['.stage','assistant','ai'].filter((id) => !get(id).hidden);
  for (const name of ['assistant','list']) {
    showPanel(name);
    showPanel('ai');
    assert.deepEqual(visible(), ['ai']);
    closeSettings();
    assert.deepEqual(visible(), name === 'assistant' ? ['.stage','assistant'] : ['.stage']);
    assert.equal(get('assistant-fab').attrs['aria-expanded'], String(name === 'assistant'));
  }
});
