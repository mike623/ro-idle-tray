import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';

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

test('the web search key has its own Keychain-backed field', () => {
  assert.match(html, /id="ai-tavily-key"[^>]*type="password"/);
  assert.match(html, /id="ai-tavily-state"[^>]*>Saved in Keychain</);
  assert.match(main, /tavilyKey: \$\("ai-tavily-key"\)\.value \|\| null/);
  assert.match(main, /\$\("ai-tavily-state"\)\.hidden = !s\.hasTavilyKey/);
});

test('keys are described as stored in the Keychain, never a local file', () => {
  assert.doesNotMatch(html, /Encrypted locally/i);
  assert.match(html, /id="ai-keystate"[^>]*>Saved in Keychain</);
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
