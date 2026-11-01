// The worker bundle's stand-ins for Node built-ins must answer exactly as Node does: prepare's
// identity is a sha256, and include keys come from path.posix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash as nodeHash, randomBytes } from 'node:crypto';
import { posix as nodePosix } from 'node:path';
import { createHash } from '../src/worker/crypto-stub';
import { posix } from '../src/worker/path-stub';

test('sha256 matches Node for strings, bytes, every padding boundary and several updates', () => {
  const inputs: (string | Uint8Array)[] = ['', 'abc', 'é and ☃ and 𝄞', JSON.stringify(['R1 a 0 1k', 'ngspice', 'x'])];
  for (let length = 0; length <= 130; length++) inputs.push(randomBytes(length));
  inputs.push(randomBytes(100_000));
  for (const data of inputs) {
    assert.equal(createHash('sha256').update(data).digest('hex'), nodeHash('sha256').update(data).digest('hex'), String(data.length));
  }
  assert.equal(createHash('sha256').update('ab').update(new TextEncoder().encode('c')).digest('hex'),
    nodeHash('sha256').update('abc').digest('hex'));
  assert.throws(() => createHash('md5'));
});

test('posix normalize, join and dirname match Node', () => {
  const paths = ['', '.', '..', '/', '//', 'a', 'a/', 'a//b', './a', 'a/./b', 'a/../b', '../a', '../../a/b', 'a/b/../../..', 'a/b/../../../c',
    '/a/../..', '/../a', 'a/..', 'a/../', '...', 'a/.../b', '.a/..b', 'models/q.lib', '../shared/opamp.lib', 'x/./y/../z/', '/a//b///c/'];
  for (const path of paths) {
    assert.equal(posix.normalize(path), nodePosix.normalize(path), `normalize ${JSON.stringify(path)}`);
    assert.equal(posix.dirname(path), nodePosix.dirname(path), `dirname ${JSON.stringify(path)}`);
    for (const other of ['', 'b', '../c', 'd/']) {
      assert.equal(posix.join(path, other), nodePosix.join(path, other), `join ${JSON.stringify([path, other])}`);
    }
  }
  assert.equal(posix.join(), nodePosix.join());
});
