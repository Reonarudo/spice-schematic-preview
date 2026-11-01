// The embedded worker bundle, built exactly as main.js embeds it, run under Node through the
// plugin's host. A small prelude gives the bundle the `self` a browser Worker would have. The
// end-to-end expectations of spice-markdown-preview's test/preview.test.ts are kept here: they pin
// the plugin's assumptions about the library's output; drawing itself is spice-renderer's to test.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { prepare as nodePrepare, type FileReader, type Prepared, type RenderResult } from '@reonarudo/spice-renderer';
import { bundleWorker } from '../scripts/worker-bundle.mjs';
import { createHost, type Host, type WorkerLike } from '../src/host';
import { describe } from '../src/fence';
import { fence } from './helpers';

const PRELUDE = `
const { parentPort } = require('node:worker_threads');
// As in a browser Worker, \`self\` is the global scope itself.
globalThis.self = globalThis;
globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
Object.defineProperty(globalThis, 'onmessage', {
  configurable: true,
  set(handler) {
    parentPort.removeAllListeners('message');
    if (handler) parentPort.on('message', (data) => handler({ data }));
  }
});
`;

let source: string;
let host: Host;

function spawn(): WorkerLike {
  const worker = new Worker(PRELUDE + source, { eval: true });
  const like: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (message, transfer) => worker.postMessage(message, transfer as never),
    terminate: () => void worker.terminate()
  };
  worker.on('message', (data) => like.onmessage?.({ data }));
  worker.on('error', (error) => like.onerror?.(error));
  return like;
}

const files = (contents: Record<string, string> = {}): FileReader => ({
  read: async (key) => key in contents ? { bytes: new TextEncoder().encode(contents[key]) } : { error: 'file not found' }
});

/** Prepare in the worker and render, as the plugin does. */
async function draw(body: string, dialect = 'ngspice', reader = files(), through = host): Promise<RenderResult> {
  const outcome = await through.prepare(body, dialect, reader);
  return outcome.status === 'prepared' ? through.render(outcome.prepared) : outcome;
}

before(async () => {
  source = await bundleWorker();
  host = createHost(spawn);
});
after(() => host.dispose());

test('the bundle carries no Node module imports', () => {
  assert.doesNotMatch(source, /require\(["']node:|from["']node:/);
});

test('a schematic is one <svg class="spice"> with a viewBox and no size, sized from the viewBox in the block', async () => {
  const result = await draw('V1 in 0 AC 1\nR1 in out 10k\nC1 out 0 100n');
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  const root = /^<svg [^>]*>/.exec(result.output)![0];
  assert.match(root, /^<svg class="spice"/);
  assert.match(root, /\sviewBox="[^"]+"/);
  assert.doesNotMatch(root, /\swidth=|\sheight=/);
  const wrapper = fence('spice {caption="RC low-pass" algin="typo"}', 'V1 in 0 AC 1', result);
  assert.match(wrapper.querySelector('figure.spice-figure > svg.spice')!.getAttribute('width')!, /^[0-9.]+px$/);
  assert.equal(wrapper.querySelector('figcaption')!.textContent, 'RC low-pass');
});

test('prepare in the worker gives the identity Node\'s prepare gives', async () => {
  const body = '.include models.lib\nQ1 c b e Q\nR1 c 0 1k';
  const reader = files({ 'models.lib': '.model Q PNP' });
  const outcome = await host.prepare(body, 'LTspice', reader);
  assert.equal(outcome.status, 'prepared');
  if (outcome.status !== 'prepared') return;
  const expected: Prepared = await nodePrepare(body, { reader, dialect: 'LTspice' });
  assert.deepEqual(outcome.prepared, expected);
});

test('a netlist error quotes its line with a caret, and the reader\'s notes arrive with the drawing', async () => {
  const failed = await draw('R1 a b 1k\nD1 a');
  assert.equal(failed.status === 'failure' && describe(failed, 'R1 a b 1k\nD1 a'), 'D1 needs 2 nodes; found 1.\n\n2 │ D1 a\n         ^');
  const noted = await draw('Q1 c b e BC547\nR1 c 0 1k');
  assert.deepEqual(noted.status === 'success' && noted.notes, ['Line 1: model BC547 of Q1 is not defined here; drawn as NPN.']);
});

test('a fence draws with its included files, and an unreadable one is an error at its include', async () => {
  const good = await draw('.include models.lib\nQ1 c b e Q\nR1 c 0 1k', 'ngspice', files({ 'models.lib': '.model Q PNP' }));
  // A PNP: the emitter pin is the one on top, drawn with the arrow on the upper leg.
  assert.match(good.status === 'success' ? good.output : '', /<path d="m14,9 6,-1 -3,-5 z" class="detail"/);
  const body = 'R1 a 0 1\n.include nowhere.lib';
  const missing = await draw(body);
  assert.equal(missing.status === 'failure' && describe(missing, body), 'nowhere.lib could not be read: file not found\n\n2 │ .include nowhere.lib\n             ^');
});

test('nested includes are followed and keyed relative to the note', async () => {
  const result = await draw('.include lib/top.inc\nX1 a b amp', 'ngspice', files({
    'lib/top.inc': '.include parts/amp.sub\n',
    'lib/parts/amp.sub': '.subckt amp in out\nR1 in out 1k\n.ends\n'
  }));
  assert.equal(result.status, 'success');
});

test('the dialect is read in any case, an unknown one fails the fence naming the six, and dialects differ', async () => {
  assert.equal((await draw('R1 a 0 1k', 'HSPICE')).status, 'success');
  assert.deepEqual(await draw('R1 a 0 1k', 'nope'),
    { status: 'failure', message: '"nope" is not a SPICE dialect; use one of ngspice, ltspice, pspice, hspice, xyce, spectre' });
  // In LTspice `$` is not a comment, so `$G_VDD` is a node; in ngspice it ends the card.
  const dollar = 'R1 $G_VDD out 1k\nR2 out 0 1k';
  assert.equal((await draw(dollar, 'ltspice')).status, 'success');
  const ngspice = await draw(dollar, 'ngspice');
  assert.match(ngspice.status === 'failure' ? ngspice.message : '', /R1 needs 2 nodes; found 0/);
});

test('every dialect\'s parser loads in the worker, Spectre with its SPICE mode', async () => {
  for (const [dialect, body] of [
    ['ngspice', 'R1 a 0 1k'], ['ltspice', 'R1 a 0 1k'], ['pspice', 'R1 a 0 1k'], ['hspice', 'R1 a 0 1k'], ['xyce', 'R1 a 0 1k'],
    ['spectre', 'r1 (a 0) resistor r=1k\nsimulator lang=spice\nR2 a 0 1k']
  ] as const) {
    const result = await draw(body, dialect);
    assert.equal(result.status, 'success', `${dialect}: ${JSON.stringify(result).slice(0, 200)}`);
  }
});

test('timeouts are reported with the budget, and the next fence gets a fresh worker', async () => {
  const quick = createHost(spawn, { timeout: 100 });
  try {
    const slow = Array.from({ length: 200 }, (_, i) => `R${i} n${i % 37} n${(i * 7 + 3) % 41} 1k`).join('\n');
    const result = await draw(slow, 'ngspice', files(), quick);
    assert.deepEqual(result, { status: 'timeout', budget: 100 });
    assert.match(describe(result as Exclude<RenderResult, { status: 'success' }>, slow), /^Layout took longer than 0\.1 s/);
    assert.equal((await draw('R1 a 0 1k', 'ngspice', files(), quick)).status, 'success');
  } finally {
    quick.dispose();
  }
});

test('author text in an error stays text', async () => {
  for (const body of ['R1 a <img src=x onerror=alert(1)>', 'Q1 <script>alert(1)</script>', '.include "<img src=x>.lib"\nR1 a 0 1']) {
    const wrapper = fence('spice', body, await draw(body));
    assert.equal(wrapper.querySelectorAll('.spice-rendering img, .spice-rendering script').length, 0, body);
  }
});

test('ten concurrent fences each get their own schematic', async () => {
  const bodies = Array.from({ length: 10 }, (_, i) => `R${i} n${i} 0 1k`);
  const results = await Promise.all(bodies.map((body) => draw(body)));
  results.forEach((result, i) => {
    assert.equal(result.status, 'success');
    assert.match(result.status === 'success' ? result.output : '', new RegExp(`>R${i}<`));
  });
});
