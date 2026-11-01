// The results cache: spice-markdown-preview's preview.ts cache rules (test/preview.test.ts there),
// keyed by the prepared input's identity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Prepared, RenderResult } from '@reonarudo/spice-renderer';
import { createResults } from '../src/cache';

const input = (n: number, source = 'R1 a 0 1k'): Prepared => ({ source, dialect: 'ngspice', files: [], identity: String(n).padStart(64, '0') });
const ok: RenderResult = { status: 'success', output: '<svg/>', notes: [] };

test('renders once per identity, sharing a render still in flight', async () => {
  let calls = 0;
  const results = createResults(async () => { calls++; return ok; });
  await Promise.all([results.render(input(1)), results.render(input(1))]);
  await results.render(input(1));
  // Same body, other identity (another dialect, other included files): rendered again.
  await results.render(input(2));
  assert.equal(calls, 2);
});

test('timeouts and failures are cached until cleared; unavailable and rejections never are', async () => {
  const calls: string[] = [];
  const outcomes: Record<string, RenderResult> = {
    t: { status: 'timeout', budget: 100 },
    f: { status: 'failure', message: 'bad' },
    u: { status: 'unavailable', reason: 'gone' }
  };
  const results = createResults(async (prepared) => {
    calls.push(prepared.source);
    if (prepared.source === 'x') throw new Error('bug');
    return outcomes[prepared.source]!;
  });
  const ids: Record<string, number> = { t: 1, f: 2, u: 3, x: 4 };
  for (const source of ['t', 'f', 'u', 't', 'f', 'u']) await results.render(input(ids[source]!, source));
  await assert.rejects(results.render(input(4, 'x')));
  await assert.rejects(results.render(input(4, 'x')));
  assert.deepEqual(calls, ['t', 'f', 'u', 'u', 'x', 'x']);
  results.clear();
  await results.render(input(1, 't'));
  assert.equal(calls.length, 7, 'a cleared timeout is retried');
});

test('the least recently used identity is evicted first', async () => {
  const calls: number[] = [];
  const results = createResults(async (prepared) => { calls.push(Number(prepared.identity)); return ok; }, () => {}, 2);
  for (const n of [1, 2, 1, 3, 1, 2]) await results.render(input(n));
  assert.deepEqual(calls, [1, 2, 3, 2]);
});

test('the netlist reader\'s notes are logged once per fresh render, labelled with the first line', async () => {
  const logged: string[] = [];
  const results = createResults(async () => ({ status: 'success', output: '<svg/>', notes: ['Line 1: model BC547 of Q1 is not defined here; drawn as NPN.'] }), (line) => logged.push(line));
  await results.render(input(1, 'Q1 c b e BC547\nR1 c 0 1k'));
  await results.render(input(1, 'Q1 c b e BC547\nR1 c 0 1k'));
  await results.render(input(2, `* ${'x'.repeat(80)}\nR1 a 0 1`));
  assert.deepEqual(logged, [
    'Q1 c b e BC547: Line 1: model BC547 of Q1 is not defined here; drawn as NPN.',
    `* ${'x'.repeat(57)}…: Line 1: model BC547 of Q1 is not defined here; drawn as NPN.`
  ]);
});
