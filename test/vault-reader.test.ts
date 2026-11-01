// The vault reader against a fake vault: resolution relative to the note, the vault's bounds,
// the library's wording, size limits, and the paths it records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveKey, vaultFileReader } from '../src/vault-reader';
import { fakeVault } from './fake-vault';

const LIMIT = { maxBytes: 100 };
const text = (result: { bytes: Uint8Array } | { error: string }) => 'bytes' in result ? new TextDecoder().decode(result.bytes) : result;

test('files beside the note, in a subfolder, and up through .. inside the vault are read', async () => {
  const fake = fakeVault({ 'notes/a.inc': 'A', 'notes/models/b.lib': 'B', 'shared/c.lib': 'C', 'root.inc': 'R' });
  const recorded: string[] = [];
  const reader = vaultFileReader(fake.vault, 'notes/demo.md', (path) => recorded.push(path));
  assert.equal(text(await reader.read('a.inc', LIMIT)), 'A');
  assert.equal(text(await reader.read('models/b.lib', LIMIT)), 'B');
  assert.equal(text(await reader.read('../shared/c.lib', LIMIT)), 'C');
  assert.equal(text(await reader.read('./models/../a.inc', LIMIT)), 'A');
  assert.equal(text(await vaultFileReader(fake.vault, 'top.md', () => {}).read('root.inc', LIMIT)), 'R');
  assert.deepEqual(recorded, ['notes/a.inc', 'notes/models/b.lib', 'shared/c.lib', 'notes/a.inc']);
});

test('anything outside the vault, absolute or with backslashes is refused unread; NUL is not a valid name', async () => {
  const fake = fakeVault({ 'x.inc': 'X' });
  const recorded: string[] = [];
  const reader = vaultFileReader(fake.vault, 'notes/demo.md', (path) => recorded.push(path));
  for (const key of ['../../outside.inc', '../../../etc/passwd', '/etc/passwd', 'C:/x.inc', 'c:x', 'models\\x.inc', '']) {
    assert.deepEqual(await reader.read(key, LIMIT), { error: 'the file is outside this vault' }, JSON.stringify(key));
  }
  assert.deepEqual(await reader.read(42 as never, LIMIT), { error: 'the file name is not valid' });
  assert.deepEqual(await reader.read('x\0.inc', LIMIT), { error: 'the file name is not valid' });
  assert.deepEqual(fake.reads, []);
  assert.deepEqual(recorded, []);
  // Climbing to the vault root itself stays inside the vault: it is a folder, not a file.
  for (const key of ['..', 'notes/../..']) {
    assert.deepEqual(await reader.read(key, LIMIT), { error: 'not a regular file' }, JSON.stringify(key));
  }
  assert.deepEqual(fake.reads, []);
});

test('missing files and folders are named as the library names them, and still recorded', async () => {
  const fake = fakeVault({ 'notes/models/q.lib': 'Q' });
  const recorded: string[] = [];
  const reader = vaultFileReader(fake.vault, 'notes/demo.md', (path) => recorded.push(path));
  assert.deepEqual(await reader.read('missing.lib', LIMIT), { error: 'file not found' });
  assert.deepEqual(await reader.read('models', LIMIT), { error: 'not a regular file' });
  assert.deepEqual(recorded, ['notes/missing.lib', 'notes/models']);
});

test('a file over the limit is refused by its size before reading, and one that grew after it was measured too', async () => {
  const fake = fakeVault({ 'big.inc': 'x'.repeat(101), 'grows.inc': 'small' });
  const reader = vaultFileReader(fake.vault, 'demo.md', () => {});
  assert.deepEqual(await reader.read('big.inc', LIMIT), { error: 'the file exceeds the 100-byte limit' });
  assert.deepEqual(fake.reads, [], 'not read at all');
  fake.beforeRead = (path) => { fake.files.set(path, 'y'.repeat(500)); };
  assert.deepEqual(await reader.read('grows.inc', LIMIT), { error: 'the file exceeds the 100-byte limit' });
});

test('a read that throws becomes a plain reason that reveals no path', async () => {
  const fake = fakeVault({ 'secret/q.lib': 'Q' });
  fake.failReads = true;
  const result = await vaultFileReader(fake.vault, 'demo.md', () => {}).read('secret/q.lib', LIMIT);
  assert.deepEqual(result, { error: 'the file could not be read' });
  assert.doesNotMatch(JSON.stringify(result), /Users|vault|secret/);
});

test('the bytes are a fresh copy', async () => {
  const fake = fakeVault({ 'a.inc': new Uint8Array([65, 66]) });
  const result = await vaultFileReader(fake.vault, 'demo.md', () => {}).read('a.inc', LIMIT);
  assert.ok('bytes' in result && result.bytes instanceof Uint8Array && result.bytes.length === 2);
  if ('bytes' in result) result.bytes[0] = 0;
  assert.equal((fake.files.get('a.inc') as Uint8Array)[0], 65);
});

test('resolveKey applies . and .. within the vault and refuses the rest', () => {
  assert.equal(resolveKey('a/b', 'c.inc'), 'a/b/c.inc');
  assert.equal(resolveKey('a/b', '../../c.inc'), 'c.inc');
  assert.equal(resolveKey('a/b', '../../../c.inc'), undefined);
  assert.equal(resolveKey('', 'x//y/./z'), 'x/y/z');
  assert.equal(resolveKey('', '.'), '', 'the vault root itself');
});
