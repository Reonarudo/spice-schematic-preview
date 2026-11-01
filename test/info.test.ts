import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locate, scanFences } from '../src/info';

test('finds spice fences with their line, info string and body', () => {
  const text = '# T\n\n```spice {caption="c"}\nbox\narrow\n```\n\ntext\n\n~~~spice\ncircle\n~~~\n';
  assert.deepEqual(scanFences(text, 'spice'), [
    { line: 2, info: 'spice {caption="c"}', body: 'box\narrow' },
    { line: 9, info: 'spice', body: 'circle' }
  ]);
});

test('only the first word of the info string names the language, as in Obsidian', () => {
  const text = '```Spice\na\n```\n```spice2\nb\n```\n```spice extra\nc\n```\n``` spice\nd\n```';
  assert.deepEqual(scanFences(text, 'spice').map((f) => f.body), ['c', 'd']);
});

test('a spice fence quoted inside another fence is not a fence', () => {
  const text = '````markdown\n```spice\nbox\n```\n````\n\n```spice\nreal\n```';
  assert.deepEqual(scanFences(text, 'spice').map((f) => f.body), ['real']);
});

test('a closing fence must use the same character and be at least as long', () => {
  const text = '````spice\nbox\n```\n~~~~\n````\n';
  assert.deepEqual(scanFences(text, 'spice'), [{ line: 0, info: 'spice', body: 'box\n```\n~~~~' }]);
});

test('a backtick fence whose info contains a backtick is not a fence', () => {
  assert.deepEqual(scanFences('```spice `x`\nbox\n```', 'spice'), []);
});

test('an unclosed fence runs to the end of the note', () => {
  assert.deepEqual(scanFences('```spice\nbox\narrow', 'spice'), [{ line: 0, info: 'spice', body: 'box\narrow' }]);
});

test('fences in blockquotes and list items lose their container prefix', () => {
  const quoted = '> ```spice {alt="q"}\n> box\n> ```\n';
  assert.deepEqual(scanFences(quoted, 'spice'), [{ line: 0, info: 'spice {alt="q"}', body: 'box' }]);
  const nested = '- item\n\n    ```spice\n    box\n      indented\n    ```\n';
  assert.deepEqual(scanFences(nested, 'spice'), [{ line: 2, info: 'spice', body: 'box\n  indented' }]);
  // Leaving the blockquote closes the fence.
  assert.deepEqual(scanFences('> ```spice\n> box\nafter', 'spice'), [{ line: 0, info: 'spice', body: 'box' }]);
});

test('CRLF line endings are handled', () => {
  assert.deepEqual(scanFences('```spice\r\nbox\r\n```\r\n', 'spice'), [{ line: 0, info: 'spice', body: 'box' }]);
});

test('locate picks the fence in the section, or the matching body when a section holds several', () => {
  const fences = scanFences('```spice\na\n```\n- x\n  ```spice\n  b\n  ```\n- y\n  ```spice\n  c\n  ```\n', 'spice');
  assert.equal(locate(fences, 0, 2, 'a'), 0);
  assert.equal(locate(fences, 3, 10, 'c\n'), 2);
  assert.equal(locate(fences, 3, 10, 'b'), 1);
  // No body matches: the first in range.
  assert.equal(locate(fences, 3, 10, 'zzz'), 1);
  assert.equal(locate(fences, 20, 30, 'a'), -1);
});
