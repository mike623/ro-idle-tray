import assert from 'node:assert/strict';
import test from 'node:test';
const nodes = new Map();
function get(id) {
  if (!nodes.has(id)) nodes.set(id, {hidden:false, attrs:{}, setAttribute(k,v) { this.attrs[k] = v; }});
  return nodes.get(id);
}
globalThis.document = {getElementById:get, querySelector:get};
const {showPanel, closeSettings} = await import('../src/panel.js');
test('settings restores the selected panel and only one content section is visible', () => {
  for (const name of ['assistant','list']) {
    showPanel(name);
    showPanel('ai');
    assert.deepEqual(['list','assistant','ai'].filter((id) => !get(id).hidden), ['ai']);
    closeSettings();
    assert.deepEqual(['list','assistant','ai'].filter((id) => !get(id).hidden), [name]);
    assert.equal(get('assistant-tab').attrs['aria-pressed'], String(name === 'assistant'));
  }
});
