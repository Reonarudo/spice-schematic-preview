// main.js must not carry Node's file system (the community review flags it): included files are
// read through Obsidian's vault. Builds main.js as `npm run build` does and scans it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('main.js contains no Node fs module and requires only obsidian', () => {
  execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'ignore' });
  const main = readFileSync('main.js', 'utf8');
  for (const needle of ['require("fs")', 'require("node:fs")', '"fs/promises"', 'node:fs']) {
    assert.equal(main.includes(needle), false, needle);
  }
  assert.deepEqual([...new Set(main.match(/require\("[^"]*"\)/g))], ['require("obsidian")']);
});
