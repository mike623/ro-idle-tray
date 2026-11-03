import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../src/move.js', import.meta.url), 'utf8');
function game(fetch, buttons = [{textContent:'開始掛機'}]) {
  return vm.runInNewContext(`${source}; roIdleMove`, {
    fetch, document: {querySelectorAll: () => buttons},
    AbortSignal, crypto: {randomUUID: () => 'command-uuid'},
  });
}
const snapshot = {character:{name:'Knight'}, mapId:'prontera'};

test('switches with the game command and confirms the returned map', async () => {
  let called = 0;
  const move = game(async (url, options) => {
    called++;
    assert.equal(url, '/api/characters/char-1/commands');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.headers['x-ro-client'], '1');
    assert.deepEqual(JSON.parse(options.body), {commandId:'command-uuid', command:{type:'selectMap', mapId:'prt_fild08'}});
    return {ok:true, json:async () => ({view:{snapshot:{...snapshot, mapId:'prt_fild08'}}})};
  });
  assert.equal((await move('prt_fild08', 'char-1', snapshot)).mapId, 'prt_fild08');
  await move('prontera', 'char-1', snapshot);
  assert.equal(called, 1, 'already at destination does not issue a command');
});

test('rejects absent or inactive characters without issuing commands', async () => {
  const fetch = () => assert.fail('must not send');
  for (const [id, snap, buttons] of [[null,snapshot,undefined], ['char-1',null,undefined], ['char-1',snapshot,[]]]) {
    await assert.rejects(game(fetch, buttons)('prt_fild08', id, snap), /No character/);
  }
});

test('reports server, network and unconfirmed results without retrying', async () => {
  for (const [fetch, error] of [
    [async () => ({ok:false, json:async () => ({error:{message:'Character busy'}})}), /Character busy/],
    [async () => ({ok:true, json:async () => ({view:{snapshot}})}), /not confirmed/],
    [async () => {throw new Error('Network down');}, /Network down/],
  ]) {
    let calls = 0;
    await assert.rejects(game((...args) => { calls++; return fetch(...args); })('prt_fild08', 'char-1', snapshot), error);
    assert.equal(calls, 1);
  }
});

const html = await fs.readFile(new URL('../src/atlas.html', import.meta.url), 'utf8');
const atlasSource = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
function atlas(invoke, characters = [{profile:1,name:'Knight'},{profile:2,name:'Mage'}]) {
  const nodes = new Map();
  const make = () => ({value:'', childNodes:[], dataset:{}, style:{}, textContent:'', disabled:false, hidden:false,
    append(...children) {this.childNodes.push(...children);},
    replaceChildren(...children) {this.childNodes = children;},
    setAttribute() {}, addEventListener() {},
  });
  const get = id => { if (!nodes.has(id)) nodes.set(id, make()); return nodes.get(id); };
  const buttons = [make(), make()];
  const selectedButtons = [make(), make()];
  const calls = [];
  const context = vm.createContext({
    MAPS:[['prontera','Town','town',0,[],[],[]]], MAPS_UPDATED:'today',
    document:{getElementById:get, createElement:make,
      querySelectorAll:s => s === '.move-all' ? buttons : s === '.move-selected' ? selectedButtons : []},
    window:{__TAURI__:{core:{invoke:(command, args) => {
      calls.push({command, args});
      return command === 'atlas_characters' ? Promise.resolve(characters) : invoke(command, args);
    }}}},
  });
  vm.runInContext(atlasSource, context);
  return {
    calls, get, buttons, selectedButtons,
    ready:() => vm.runInContext('window.atlasRefresh()', context),
    inPlay:() => vm.runInContext('characters.length', context),
    choose:(...profiles) => vm.runInContext(
      `chosen.clear(); ${profiles.map(p => `chosen.add(${p});`).join('')} updateChooseCount(); syncMoveButtons();`, context),
    move:() => vm.runInContext('moveAll("prontera", "Town")', context),
    moveSelected:() => vm.runInContext('moveSelected("prontera", "Town")', context),
  };
}

test('lists characters in play and enables selection-based moves', async () => {
  const ui = atlas(() => assert.fail('must not move yet'));
  await ui.ready();
  assert.equal(ui.inPlay(), 2);
  assert.equal(ui.get('cast').hidden, false);
  assert.equal(ui.get('cast-count').textContent, '0/2 selected');
  assert.ok(ui.selectedButtons.every(b => b.disabled), 'no picks means no selected move');

  ui.choose(2, 1);
  assert.equal(ui.get('cast-count').textContent, '2/2 selected');
  assert.ok(ui.selectedButtons.every(b => !b.disabled));
  assert.equal(ui.selectedButtons[0].textContent, 'Move selected (2)');
});

test('moves only the ticked characters and reports per-character results', async () => {
  let moved;
  const ui = atlas((command, args) => {
    moved = {command, args};
    return Promise.resolve([{profile:1, name:'Knight', error:null}, {profile:2, name:'Mage', error:'Busy'}]);
  });
  await ui.ready();
  ui.choose(1, 2);
  await ui.moveSelected();
  assert.equal(moved.command, 'move_selected');
  assert.deepEqual(JSON.parse(JSON.stringify(moved.args)), {mapId:'prontera', profiles:[1, 2]});
  assert.match(ui.get('move-status').textContent, /1\/2 characters at Town.*Mage: Busy/);
});

test('refuses a selected move with no characters ticked', async () => {
  const ui = atlas(() => assert.fail('must not move without a selection'));
  await ui.ready();
  await ui.moveSelected();
  assert.match(ui.get('move-status').textContent, /Select at least one character/);
});

test('refreshing drops characters that are no longer in play', async () => {
  const inPlay = [{profile:1,name:'Knight'},{profile:2,name:'Mage'}];
  const ui = atlas(() => assert.fail('must not move'), inPlay);
  await ui.ready();
  ui.choose(1, 2);
  assert.equal(ui.get('cast-count').textContent, '2/2 selected');
  inPlay.splice(1, 1);
  await ui.ready();
  assert.equal(ui.get('cast-count').textContent, '1/1 selected');
  assert.equal(ui.selectedButtons[0].textContent, 'Move selected (1)');
});

test('bulk UI blocks overlapping moves and reports partial failures', async () => {
  let finish, calls = 0;
  const ui = atlas((command, args) => {
    calls++;
    assert.equal(command, 'move_all');
    assert.equal(args.mapId, 'prontera');
    return new Promise(resolve => {finish = resolve;});
  });
  await ui.ready();
  const pending = ui.move();
  assert.ok(ui.buttons.every(b => b.disabled));
  assert.ok(ui.selectedButtons.every(b => b.disabled));
  await ui.move();
  assert.equal(calls, 1);
  finish([{name:'Knight',error:null}, {name:'Mage',error:'Busy'}]);
  await pending;
  assert.match(ui.get('move-status').textContent, /1\/2 characters at Town.*Mage: Busy/);
  assert.ok(ui.buttons.every(b => !b.disabled));
});

test('bulk UI restores buttons when the backend fails', async () => {
  const ui = atlas(async () => {throw new Error('No characters currently in play');});
  await ui.ready();
  await ui.move();
  assert.match(ui.get('move-status').textContent, /No characters currently in play/);
  assert.ok(ui.buttons.every(b => !b.disabled));
});
