// A block's rendering slot over time: the loading line, a drawing kept while the block is drawn
// again (the extension's "a fence not ready yet keeps its slot's last drawing"), late draws, and a
// throwing renderer degrading its block alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RenderResult } from '@reonarudo/spice-renderer';
import { drawBlock } from '../src/block';
import { buildFence, fenceKey } from '../src/fence';
import { document, rendering } from './helpers';

const svg = (text: string): RenderResult => ({ status: 'success', output: `<svg xmlns="http://www.w3.org/2000/svg" class="spice"><text>${text}</text></svg>`, notes: [] });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => {
  let resolve!: (result: RenderResult) => void;
  const promise = new Promise<RenderResult>((done) => { resolve = done; });
  return { promise, resolve };
};
const block = () => buildFence(document, 'R1 a 0 1', fenceKey('R1 a 0 1'));

test('a new block shows "Reading the netlist…" while it is pending, then the schematic', async () => {
  const parts = block();
  const pending = deferred();
  const done = drawBlock(parts.rendering, () => pending.promise, { attributes: {}, source: 'R1 a 0 1', current: () => true, delay: 5 });
  await sleep(20);
  assert.equal(rendering(parts.wrapper), '<div class="spice-loading" role="status">Reading the netlist…</div>');
  pending.resolve(svg('new'));
  await done;
  assert.match(rendering(parts.wrapper), />new<\/text>/);
});

test('a fast block never shows the loading line', async () => {
  const parts = block();
  await drawBlock(parts.rendering, async () => svg('fast'), { attributes: {}, source: '', current: () => true, delay: 5 });
  await sleep(20);
  assert.match(rendering(parts.wrapper), />fast<\/text>/);
});

test('a block drawn again keeps its old drawing until the new one is ready, and the source view shows the new body', async () => {
  const parts = buildFence(document, 'R1 a 0 1k', fenceKey('R1 a 0 1k'));
  await drawBlock(parts.rendering, async () => svg('old'), { attributes: {}, source: '', current: () => true });
  const pending = deferred();
  const done = drawBlock(parts.rendering, () => pending.promise, { attributes: {}, source: '', current: () => true, delay: 5 });
  await sleep(20);
  assert.match(rendering(parts.wrapper), />old<\/text>/);
  assert.equal(parts.wrapper.querySelector('pre > code')!.textContent, 'R1 a 0 1k');
  pending.resolve({ status: 'failure', message: 'bad' });
  await done;
  assert.equal(rendering(parts.wrapper), '<div class="spice-error" role="alert"><pre>bad</pre></div>', 'an error replaces a drawing like a drawing');
});

test('a draw that is no longer current leaves the slot alone', async () => {
  const parts = block();
  await drawBlock(parts.rendering, async () => svg('first'), { attributes: {}, source: '', current: () => true });
  await drawBlock(parts.rendering, async () => svg('stale'), { attributes: {}, source: '', current: () => false });
  assert.match(rendering(parts.wrapper), />first<\/text>/);
});

test('a throwing renderer degrades its block alone, and is reported', async () => {
  const parts = block();
  const reported: string[] = [];
  await drawBlock(parts.rendering, async () => { throw new TypeError('not prepared'); },
    { attributes: {}, source: '', current: () => true, report: (message) => reported.push(message) });
  assert.equal(rendering(parts.wrapper), '<div class="spice-error" role="alert"><pre>The schematic renderer failed: not prepared</pre></div>');
  assert.deepEqual(reported, ['SPICE render failed: not prepared']);
});
