// spice-markdown-preview's test/include-files.test.ts, ported: files read through the vault
// reader (a fake vault here), the dialect in the key, stale loads, and invalidation by vault path.
// `prepare` is the library's own, run here in Node; in the plugin it runs in the render worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as library from '@reonarudo/spice-renderer';
import type { Prepared } from '@reonarudo/spice-renderer';
import type { PrepareOutcome } from '../src/host';
import { IncludeFiles } from '../src/include-files';
import { vaultFileReader } from '../src/vault-reader';
import { fakeVault } from './fake-vault';

/** The error the netlist reader will report at the fence's include, or `undefined`. */
const unread = (outcome: PrepareOutcome) => outcome.status !== 'prepared'
  ? (outcome.status === 'failure' ? outcome.message : outcome.status)
  : outcome.prepared.failure?.message ?? outcome.prepared.files.find((file) => 'error' in file)?.['error' as never];

test('fences read their files through the vault, keyed by dialect, discarding stale loads', async () => {
  const fake = fakeVault({ 'docs/models/q.lib': '.model Q PNP\n', 'docs/other.md': '' });
  let prepares = 0;
  let gate: Promise<void> | undefined;
  fake.beforeRead = () => gate;
  const files = new IncludeFiles(
    async (source, dialect, reader) => { prepares++; return { status: 'prepared', prepared: await library.prepare(source, { reader, dialect }) }; },
    (note, record) => vaultFileReader(fake.vault, note, record)
  );
  const note = 'docs/demo.md';
  const source = '.include models/q.lib\nQ1 c b e Q\nR1 c 0 1k';
  const reads = () => fake.reads.length;

  // Netlists without includes never read; a file above the vault's root is refused unread.
  assert.equal(unread(await files.prepare(note, 'R1 a 0 1k', 'ngspice')), undefined);
  assert.equal(unread(await files.prepare(note, '.include ../../outside.lib\nR1 a 0 1', 'ngspice')), 'the file is outside this vault');
  assert.equal(reads(), 0);

  // The dialect is part of the key, and reaches `prepare`.
  const hspice = await files.prepare(note, source, 'HSPICE');
  assert.equal(hspice.status === 'prepared' && hspice.prepared.dialect, 'hspice');
  assert.equal(unread(await files.prepare(note, source, 'nope')), '"nope" is not a SPICE dialect; use one of ngspice, ltspice, pspice, hspice, xyce, spectre');
  const readsBefore = reads();

  // Invalidate while the first load is still pending: its result must not repopulate the cache.
  let open!: () => void;
  gate = new Promise((resolve) => { open = resolve; });
  const first = files.prepare(note, source, 'ngspice');
  while (reads() === readsBefore) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.deepEqual(files.invalidate('docs/models/q.lib'), [IncludeFiles.key(note, 'HSPICE', source), IncludeFiles.key(note, 'ngspice', source)], 'recorded by vault path');
  open();
  gate = undefined;
  await first;
  const prepared = await files.prepare(note, source, 'ngspice');
  assert.equal(unread(prepared), undefined);
  assert.deepEqual(prepared.status === 'prepared' && prepared.prepared.files.map((file) => file.key), ['models/q.lib']);
  assert.equal(reads(), readsBefore + 2);
  const count = prepares;
  assert.equal(await files.prepare(note, source, 'ngspice'), prepared, 'cached');
  assert.equal(prepares, count);

  // A missing file is watched too, so recreating it prepares the fence again.
  fake.files.delete('docs/models/q.lib');
  assert.equal(files.invalidate('docs/models/q.lib').length, 1);
  assert.equal(unread(await files.prepare(note, source, 'ngspice')), 'file not found');
  fake.files.set('docs/models/q.lib', '.model Q NPN\n');
  assert.equal(files.invalidate('docs/models').length, 1, 'a folder event covers the files under it');
  assert.equal(unread(await files.prepare(note, source, 'ngspice')), undefined);
  assert.deepEqual(files.invalidate('docs/model'), [], 'a sibling with a common prefix is not under it');
  assert.deepEqual(files.invalidate('docs/other.lib'), []);

  // Fences of a deleted note are forgotten.
  files.forget(note);
  const again = prepares;
  await files.prepare(note, source, 'ngspice');
  assert.equal(prepares, again + 1);
});

test('an unavailable worker is asked again next time; a programmer error is kept for the fence', async () => {
  const outcomes: PrepareOutcome[] = [
    { status: 'unavailable', reason: 'the renderer was stopped' },
    { status: 'prepared', prepared: { source: 'x', dialect: 'ngspice', files: [], identity: '0'.repeat(64) } satisfies Prepared }
  ];
  let calls = 0;
  const files = new IncludeFiles(async () => outcomes[calls++]!, () => ({ read: async () => ({ error: 'no' }) }));
  assert.equal((await files.prepare('a.md', 'x', 'ngspice')).status, 'unavailable');
  assert.equal((await files.prepare('a.md', 'x', 'ngspice')).status, 'prepared');
  assert.equal(calls, 2);

  let thrown = 0;
  const broken = new IncludeFiles(async () => { thrown++; throw new TypeError('limits must be an object'); }, () => ({ read: async () => ({ error: 'no' }) }));
  assert.deepEqual(await broken.prepare('a.md', 'x', 'ngspice'), { status: 'failure', message: 'limits must be an object' });
  await broken.prepare('a.md', 'x', 'ngspice');
  assert.equal(thrown, 1);
});
