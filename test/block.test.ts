// A block's rendering and BOM slots over time: the loading line, a drawing and a table kept while
// the block is drawn again (the extension's "a fence not ready yet keeps its slot's last drawing
// and table"), late draws, and a throwing renderer degrading its block alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RenderResult } from '@reonarudo/spice-renderer';
import { drawBlock } from '../src/block';
import { buildFence, fenceKey } from '../src/fence';
import { bom, document, rendering } from './helpers';

const svg = (text: string): RenderResult => ({ status: 'success', output: `<svg xmlns="http://www.w3.org/2000/svg" class="spice"><text>${text}</text></svg>`, bom: [], notes: [] });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => {
  let resolve!: (result: RenderResult) => void;
  const promise = new Promise<RenderResult>((done) => { resolve = done; });
  return { promise, resolve };
};
const block = () => buildFence(document.createElement('div'), 'R1 a 0 1', fenceKey('R1 a 0 1'));

test('a new block shows "Reading the netlist…" while it is pending, then the schematic', async () => {
  const parts = block();
  const pending = deferred();
  const done = drawBlock(parts, () => pending.promise, { attributes: {}, source: 'R1 a 0 1', current: () => true, delay: 5 });
  await sleep(20);
  assert.equal(rendering(parts.wrapper), '<div class="spice-loading" role="status">Reading the netlist…</div>');
  assert.equal(bom(parts.wrapper), '<div class="spice-bom-empty" role="status">Reading the netlist…</div>');
  pending.resolve(svg('new'));
  await done;
  assert.match(rendering(parts.wrapper), />new<\/text>/);
  assert.equal(bom(parts.wrapper), '<div class="spice-bom-empty">No parts.</div>');
});

test('a fast block never shows the loading line', async () => {
  const parts = block();
  await drawBlock(parts, async () => svg('fast'), { attributes: {}, source: '', current: () => true, delay: 5 });
  await sleep(20);
  assert.match(rendering(parts.wrapper), />fast<\/text>/);
});

test('a block drawn again keeps its old drawing until the new one is ready, and the source view shows the new body', async () => {
  const parts = buildFence(document.createElement('div'), 'R1 a 0 1k', fenceKey('R1 a 0 1k'));
  await drawBlock(parts, async () => svg('old'), { attributes: {}, source: '', current: () => true });
  const pending = deferred();
  const done = drawBlock(parts, () => pending.promise, { attributes: {}, source: '', current: () => true, delay: 5 });
  await sleep(20);
  assert.match(rendering(parts.wrapper), />old<\/text>/);
  assert.equal(parts.wrapper.querySelector('pre > code')!.textContent, 'R1 a 0 1k');
  pending.resolve({ status: 'failure', message: 'bad' });
  await done;
  assert.equal(rendering(parts.wrapper), '<div class="spice-error" role="alert"><pre>bad</pre></div>', 'an error replaces a drawing like a drawing');
});

test('a draw that is no longer current leaves the slot alone', async () => {
  const parts = block();
  await drawBlock(parts, async () => svg('first'), { attributes: {}, source: '', current: () => true });
  await drawBlock(parts, async () => svg('stale'), { attributes: {}, source: '', current: () => false });
  assert.match(rendering(parts.wrapper), />first<\/text>/);
});

test('a throwing renderer degrades its block alone, and is reported', async () => {
  const parts = block();
  const reported: string[] = [];
  await drawBlock(parts, async () => { throw new TypeError('not prepared'); },
    { attributes: {}, source: '', current: () => true, report: (message) => reported.push(message) });
  assert.equal(rendering(parts.wrapper), '<div class="spice-error" role="alert"><pre>The schematic renderer failed: not prepared</pre></div>');
  assert.equal(bom(parts.wrapper), '<div class="spice-bom-empty">The schematic renderer is not running, so there are no parts.</div>');
  assert.deepEqual(reported, ['SPICE render failed: not prepared']);
});

test('a block drawn again keeps its old table until the new result is ready', async () => {
  const parts = block();
  const row = (value: string): RenderResult => ({ status: 'success', output: '<svg xmlns="http://www.w3.org/2000/svg" class="spice"/>',
    bom: [{ type: 'resistor', name: 'resistor', value, references: [{ ref: 'R1', line: 1 }] }], notes: [] });
  await drawBlock(parts, async () => row('1k'), { attributes: {}, source: '', current: () => true });
  const pending = deferred();
  const done = drawBlock(parts, () => pending.promise, { attributes: {}, source: '', current: () => true, delay: 5 });
  await sleep(20);
  assert.equal(parts.bom.querySelector('.spice-bom-value')!.textContent, '1k');
  pending.resolve({ status: 'failure', message: 'bad', line: 1 });
  await done;
  assert.equal(bom(parts.wrapper), '<div class="spice-bom-empty">The netlist did not read, so there are no parts.</div>');
});
