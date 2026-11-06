// The toggle's pure core, ported from spice-markdown-preview's media/preview.js (test/preview-script.test.ts there) with its tables
// unchanged, and the store that keeps it in the plugin's data: three views, docs/bom-view-spec.md sections 9 and 10.7 there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/toggle';
import { ToggleStore, type Entry, type Storage } from '../src/toggle';
import type { View } from '../src/fence';

const memory = (): Storage & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); }
  };
};
const throwing: Storage = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('SecurityError'); },
  removeItem: () => { throw new Error('SecurityError'); }
};

const source = (key: string, ordinal: number, index: number): Entry => ({ key, ordinal, index, view: 'source' });
const bom = (key: string, ordinal: number, index: number): Entry => ({ key, ordinal, index, view: 'bom' });
const views = (...pairs: [number, View][]) => new Map(pairs);

test('match: key first, then ordinal within the key group, then the same index among all fences', () => {
  const table: [string, Entry[], string[], Map<number, View>][] = [
    ['key present picks the ordinal within its group', [source('a', 1, 0)], ['a', 'b', 'a'], views([2, 'source'])],
    ['two identical bodies flipped independently', [source('s', 1, 1)], ['s', 's'], views([1, 'source'])],
    ['both identical bodies flipped', [source('s', 0, 0), source('s', 1, 1)], ['s', 's'], views([0, 'source'], [1, 'source'])],
    ['a key gone from the document falls back to the fence at the same index', [source('old', 0, 2)], ['a', 'b', 'c'], views([2, 'source'])],
    ['an index beyond the document drops the entry', [source('old', 0, 5)], ['a'], views()],
    ['an ordinal beyond the key group drops the entry', [source('a', 2, 0)], ['a', 'a'], views()],
    ['a fence inserted above a flipped one keeps the flip on the right fence', [source('b', 0, 1)], ['n', 'a', 'b'], views([2, 'source'])],
    ['a fence removed above a flipped one keeps the flip on the right fence', [source('b', 0, 2)], ['a', 'b'], views([1, 'source'])],
    ['nothing flipped matches nothing', [], ['a', 'b'], views()],
    ['no fences left matches nothing', [source('a', 0, 0)], [], views()],
    ['two identical bodies keep their own views', [bom('s', 0, 0), source('s', 1, 1)], ['s', 's'], views([0, 'bom'], [1, 'source'])],
    ['a later entry for the same position wins', [source('a', 0, 0), bom('a', 0, 0)], ['a'], views([0, 'bom'])]
  ];
  for (const [name, entries, keys, expected] of table) assert.deepEqual(core.match(entries, keys), expected, name);
});

test('collect describes only real fences, with ordinal, index and view recomputed from the document', () => {
  assert.deepEqual(core.collect(['a', 'b', 'a', 'c'], views([2, 'source'], [3, 'bom'])), [
    source('a', 1, 2),
    bom('c', 0, 3)
  ]);
  assert.deepEqual(core.collect(['a', 'b'], views([7, 'source'])), []);
  assert.deepEqual(core.collect([], views([0, 'bom'])), []);
  // After a fallback match, collect re-keys the entry to the fence it now sits on.
  const after = ['x', 'y', 'z'];
  const flipped = core.match([bom('old', 0, 1)], after);
  assert.deepEqual(core.collect(after, flipped), [bom('y', 0, 1)]);
});

test('a bom entry round-trips through collect and match', () => {
  const keys = ['a', 'b', 'a'];
  const entries = core.collect(keys, views([2, 'bom']));
  assert.deepEqual(entries, [bom('a', 1, 2)]);
  assert.deepEqual(core.match(entries, keys), views([2, 'bom']));
});

test('storageKey names the extension and the document', () => {
  assert.equal(core.storageKey('spice', 'file:///notes/model.md'), 'spice-markdown-preview.view-toggle:file:///notes/model.md');
});

test('save writes the entries, removes the key when nothing is flipped, and load reads them back', () => {
  const storage = memory();
  const entries = [source('a', 0, 0), bom('b', 0, 1)];
  core.save(storage, 'k', entries);
  assert.equal(storage.map.get('k'), JSON.stringify(entries));
  assert.deepEqual(core.load(storage, 'k'), entries);
  core.save(storage, 'k', []);
  assert.equal(storage.map.has('k'), false);
  assert.deepEqual(core.load(storage, 'k'), []);
});

test('load ignores a missing, corrupt or wrongly shaped value', () => {
  const storage = memory();
  assert.deepEqual(core.load(storage, 'k'), []);
  storage.map.set('k', '{not json');
  assert.deepEqual(core.load(storage, 'k'), []);
  storage.map.set('k', '{"key":"a"}');
  assert.deepEqual(core.load(storage, 'k'), []);
});

test('load migrates a 0.1 entry without a view to source, and drops unknown views and malformed entries', () => {
  const storage = memory();
  storage.map.set('k', JSON.stringify([
    { key: 'a', ordinal: 0, index: 0 },
    { key: 'b', ordinal: 0, index: 1, view: 'bom' },
    { key: 'c', ordinal: 0, index: 2, view: 'table' },
    { key: 'd', ordinal: 0, view: 'source' },
    { key: 5, ordinal: 0, index: 4 },
    null,
    'e',
    { key: 'f', ordinal: 0, index: 5, view: 'source', extra: true }
  ]));
  assert.deepEqual(core.load(storage, 'k'), [source('a', 0, 0), bom('b', 0, 1), source('f', 0, 5)]);
});

test('a storage that throws degrades to memory-only: load is empty and save does not throw', () => {
  assert.deepEqual(core.load(throwing, 'k'), []);
  assert.doesNotThrow(() => core.save(throwing, 'k', [source('a', 0, 0)]));
  assert.doesNotThrow(() => core.save(throwing, 'k', []));
});

test('the store reads entries from plugin data, ignoring anything that is not a list', () => {
  const store = new ToggleStore({ 'a.md': [bom('k', 0, 0)], 'b.md': 'junk' }, () => {});
  assert.equal(store.viewOf('a.md', ['k'], 0), 'bom');
  assert.deepEqual({ ...store.toJSON() }, { 'a.md': [bom('k', 0, 0)] });
  for (const junk of [null, undefined, 'x', 3, []]) assert.deepEqual({ ...new ToggleStore(junk, () => {}).toJSON() }, {});
});

test('set flips one fence among identical bodies, re-keys, and reports each change', () => {
  let changes = 0;
  const store = new ToggleStore({}, () => { changes++; });
  store.set('n.md', ['s', 's', 't'], 1, 'source');
  assert.deepEqual({ ...store.toJSON() }, { 'n.md': [source('s', 1, 1)] });
  assert.equal(store.viewOf('n.md', ['s', 's', 't'], 0), undefined);
  assert.equal(store.viewOf('n.md', ['s', 's', 't'], 1), 'source');
  // A fence inserted above keeps the flip on the same body.
  assert.equal(store.viewOf('n.md', ['new', 's', 's', 't'], 2), 'source');
  store.set('n.md', ['s', 's', 't'], 1, undefined);
  assert.deepEqual({ ...store.toJSON() }, {});
  assert.equal(changes, 2);
});

test('set takes a view: a fence moves between source and BOM view, and its twin keeps its own', () => {
  const store = new ToggleStore({}, () => {});
  const keys = ['s', 's'];
  store.set('n.md', keys, 0, 'bom');
  store.set('n.md', keys, 1, 'source');
  assert.equal(store.viewOf('n.md', keys, 0), 'bom');
  assert.equal(store.viewOf('n.md', keys, 1), 'source');
  store.set('n.md', keys, 0, 'source');
  assert.deepEqual({ ...store.toJSON() }, { 'n.md': [source('s', 0, 0), source('s', 1, 1)] });
  store.clear('n.md');
  assert.deepEqual({ ...store.toJSON() }, {});
});

test('a 0.1 data file reads as source flips, and is rewritten with views on the first save', () => {
  const store = new ToggleStore({ 'n.md': [{ key: 'a', ordinal: 0, index: 0 }, { key: 'b', ordinal: 0, index: 1, view: 'table' }] }, () => {});
  assert.equal(store.viewOf('n.md', ['a', 'b'], 0), 'source');
  assert.equal(store.viewOf('n.md', ['a', 'b'], 1), undefined, 'an unknown view is dropped');
  store.set('n.md', ['a', 'b', 'c'], 2, 'bom');
  assert.deepEqual({ ...store.toJSON() }, { 'n.md': [source('a', 0, 0), bom('c', 0, 2)] });
});

test('notes are kept apart, follow a rename, and clear forgets them', () => {
  const store = new ToggleStore({}, () => {});
  store.set('a.md', ['k'], 0, 'source');
  store.set('b.md', ['k'], 0, 'bom');
  store.rename('a.md', 'folder/a.md');
  assert.equal(store.viewOf('a.md', ['k'], 0), undefined);
  assert.equal(store.viewOf('folder/a.md', ['k'], 0), 'source');
  store.clear('b.md');
  assert.deepEqual(Object.keys(store.toJSON()), ['folder/a.md']);
  store.rename('missing.md', 'x.md');
  assert.deepEqual(Object.keys(store.toJSON()), ['folder/a.md']);
});

test('a note path that is also an Object.prototype name is stored as data', () => {
  const store = new ToggleStore({}, () => {});
  assert.equal(store.viewOf('constructor', ['k'], 0), undefined);
  store.set('__proto__', ['k'], 0, 'bom');
  assert.equal(store.viewOf('__proto__', ['k'], 0), 'bom');
});

test('the stored data survives a JSON round trip, as saveData does', () => {
  const store = new ToggleStore({}, () => {});
  store.set('__proto__', ['k'], 0, 'source');
  store.set('a.md', ['k'], 0, 'bom');
  const reloaded = new ToggleStore(JSON.parse(JSON.stringify(store.toJSON())), () => {});
  assert.equal(reloaded.viewOf('__proto__', ['k'], 0), 'source');
  assert.equal(reloaded.viewOf('a.md', ['k'], 0), 'bom');
});
