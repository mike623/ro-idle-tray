import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const read = (path) => fs.readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
const html = await read('index.html');
const main = await read('main.js');

test('the model field is a searchable picker of provider models, not free text', () => {
  assert.doesNotMatch(html, /<select id="ai-model"/);
  assert.doesNotMatch(html, /<input id="ai-model"/);
  assert.match(html, /id="ai-model-trigger"[^>]*aria-haspopup="listbox"/);
  assert.match(html, /id="ai-model-search"[^>]*placeholder="Search models…"/);
  assert.match(html, /id="ai-model-list" role="listbox"/);
  assert.match(html, /id="ai-model-hint"[^>]*aria-live="polite"/);
  assert.match(main, /invoke\("ai_list_models"\)/);
});

test('the picker filters models as you type and supports the keyboard', () => {
  assert.match(main, /addEventListener\("input", \(\) => \{/);
  assert.match(main, /toLowerCase\(\)\.includes\(query\)/);
  assert.match(main, /e\.key === "ArrowDown" \|\| e\.key === "ArrowUp"/);
  assert.match(main, /e\.key === "Enter"/);
  assert.match(main, /e\.key === "Escape"/);
});

test('a refresh button re-runs model discovery', () => {
  assert.match(html, /<button[^>]*id="ai-model-refresh"[^>]*aria-label="Reload model list"/);
  assert.match(main, /\$\("ai-model-refresh"\)\.addEventListener\("click"/);
  assert.match(main, /await aiLoadModels\(\)/);
});

test('the web search key has its own encrypted field', () => {
  assert.match(html, /id="ai-tavily-key"[^>]*type="password"/);
  assert.match(html, /id="ai-tavily-state"[^>]*>Encrypted locally</);
  assert.match(main, /tavilyKey: \$\("ai-tavily-key"\)\.value \|\| null/);
  assert.match(main, /\$\("ai-tavily-state"\)\.hidden = !s\.hasTavilyKey/);
});

test('no settings text mentions the old Keychain storage', () => {
  assert.doesNotMatch(html, /Keychain/i);
  assert.match(html, /id="ai-keystate"[^>]*>Encrypted locally</);
});

test('the request format is a saved setting', () => {
  assert.match(html, /<select id="ai-format"/);
  assert.match(main, /format: \$\("ai-format"\)\.value/);
  assert.match(main, /\$\("ai-format"\)\.value = s\.format \?\? "auto"/);
});

test('the picker keeps the saved name when the list cannot load and prefers it when it can', () => {
  // A saved name the provider no longer offers stays selectable.
  assert.match(main, /function aiRevealModel\(value\)/);
  assert.match(main, /aiModelCandidates\(\)/);
  // A saved model present in the list stays selected; otherwise the first valid one wins.
  assert.match(main, /if \(models\.includes\(saved\)\)/);
  assert.match(main, /aiRevealModel\(models\[0\]\)/);
  assert.match(main, /Could not list models:/);
});


test('context label follows the selected model and labels the fallback for unknown capacity', () => {
  const label = { textContent: '' };
  const context = vm.createContext({
    $: () => label,
    aiModelValue: 'large',
    aiModelCatalog: { contextTokens: { large: 128000 }, fallbackContextTokens: 1000000 },
  });
  const render = main.slice(main.indexOf('function aiShowModelContext()'), main.indexOf('function aiRenderModels()'));
  vm.runInContext(render + 'aiShowModelContext();', context);
  assert.equal(label.textContent, 'Context: 128,000 tokens');
  context.aiModelValue = 'unknown';
  vm.runInContext('aiShowModelContext();', context);
  assert.equal(label.textContent, 'Context: unknown · 1,000,000 tokens (fallback)');
  context.aiModelCatalog = null;
  vm.runInContext('aiShowModelContext();', context);
  assert.equal(label.textContent, 'Context: unavailable');
  assert.match(html, /id="ai-model-context"[^>]*aria-live="polite"/);
});

test('dropdown options show their own context, including million-token models', () => {
  const element = () => ({
    dataset: {}, children: [], value: '',
    setAttribute() {}, addEventListener() {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
  });
  const elements = Object.fromEntries(['ai-model-search', 'ai-model-list', 'ai-model-empty'].map(id => [id, element()]));
  const context = vm.createContext({
    $: id => elements[id],
    document: { createElement: element, createElementNS: element },
    aiModelCandidates: () => ['large', 'small', 'unknown'],
    aiModelCatalog: { contextTokens: { large: 1000000, small: 128000 }, fallbackContextTokens: 1000000 },
    aiModelValue: 'large', aiModelActive: -1, aiModelFiltered: [],
  });
  const render = main.slice(main.indexOf('function aiRenderModels()'), main.indexOf('function aiHighlightModel('));
  vm.runInContext(render + 'aiRenderModels();', context);
  assert.deepEqual(elements['ai-model-list'].children.map(item => item.children[1].textContent), [
    'Context: 1,000,000 tokens', 'Context: 128,000 tokens', 'Context: 1,000,000 tokens (fallback)',
  ]);
  assert.equal(elements['ai-model-list'].children[0].dataset.value, 'large');
});
