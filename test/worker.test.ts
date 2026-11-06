// The embedded worker bundle, built exactly as main.js embeds it, run under Node through the
// plugin's host. A small prelude gives the bundle the `self` a browser Worker would have. The
// end-to-end expectations of spice-markdown-preview's test/preview.test.ts are kept here: they pin
// the plugin's assumptions about the library's output; drawing itself is spice-renderer's to test.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepare as nodePrepare, type BomRow, type FileReader, type Prepared, type RenderResult } from '@reonarudo/spice-renderer';
import { renderNetlist } from '#renderer/dist/draw-netlist.js';
import { parserLoader } from '#renderer/dist/parser/modules.js';
import { loadSymbols } from '#renderer/dist/schematic.js';
import { bundleWorker, rendererDir } from '../scripts/worker-bundle.mjs';
import { createHost, type Host, type WorkerLike } from '../src/host';
import type { WorkerMessage } from '../src/protocol';
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

/** Every message the bundle posted, across the workers spawned, in order. */
const heard: WorkerMessage[] = [];

function spawn(): WorkerLike {
  const worker = new Worker(PRELUDE + source, { eval: true });
  worker.on('message', (data: WorkerMessage) => heard.push(data));
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
  // The mesh reads in tens of milliseconds and lays out in seconds: a 1 s budget always lands between.
  const quick = createHost(spawn, { timeout: 1000 });
  try {
    const slow = Array.from({ length: 200 }, (_, i) => `R${i} n${i % 37} n${(i * 7 + 3) % 41} 1k`).join('\n');
    const result = await draw(slow, 'ngspice', files(), quick);
    // The netlist was read before layout overran: the timeout keeps its rows (one row of 200 resistors).
    assert.equal(result.status, 'timeout');
    assert.equal(result.status === 'timeout' && result.budget, 1000);
    assert.deepEqual(result.status === 'timeout' && result.bom?.map((row) => [row.name, row.value, row.references.length]), [['resistor', '1k', 200]]);
    assert.deepEqual(result.status === 'timeout' && result.notes, []);
    assert.match(describe(result as Exclude<RenderResult, { status: 'success' }>, slow), /^Layout took longer than 1 s/);
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

/**
 * The rows the library's own, unbundled code gives under Node for a prepared fence. The library's
 * runtime cannot start here (this suite's `window` global reaches its worker thread, and ELK then
 * takes its browser path), so its `renderNetlist` runs in this thread with a layout that stops
 * at once: a layout failure after the parse carries the rows.
 */
async function nodeRows(prepared: Prepared): Promise<BomRow[] | undefined> {
  await parserLoader(join(rendererDir, 'vendor', 'parsers'))(prepared.dialect as never);
  const symbols = loadSymbols(readFileSync(join(rendererDir, 'dist', 'skin', 'symbols.svg'), 'utf8'));
  const files = Object.fromEntries(prepared.files.map((file) => [file.key, 'text' in file ? file.text : { error: file.error }]));
  const result = await renderNetlist(prepared.source, symbols, () => { throw new Error('no layout'); }, { files }, prepared.dialect as never);
  return result.status === 'failure' ? result.bom : undefined;
}

test('the bundle posts the parsed stage before its reply, in every dialect, with the rows Node gives', async () => {
  for (const [dialect, body] of [
    ['ngspice', 'D1 a 0 1N4007\nD2 b 0 1N4007\nR1 a b 1k'], ['ltspice', 'R1 a 0 1k\nR2 a 0 1K'], ['pspice', 'R1 a 0 1k\nC1 a 0 1u'],
    ['hspice', 'R1 a 0 1k M=2\nR2 a 0 1k'], ['xyce', 'R1 a 0 1k\nL1 a 0 1m'],
    ['spectre', 'r1 (a 0) resistor r=1k\nsimulator lang=spice\nR2 a 0 1k']
  ] as const) {
    const outcome = await host.prepare(body, dialect, files());
    assert.equal(outcome.status, 'prepared', dialect);
    if (outcome.status !== 'prepared') continue;
    const from = heard.length;
    const result = await host.render(outcome.prepared);
    const mine = heard.slice(from).filter((message) => message.type === 'parsed' || message.type === 'reply');
    assert.deepEqual(mine.map((message) => message.type), ['parsed', 'reply'], dialect);
    const node = await nodeRows(await nodePrepare(body, { reader: files(), dialect }));
    assert.equal(result.status, 'success', dialect);
    if (result.status !== 'success') continue;
    assert.ok(result.bom.length > 0, dialect);
    assert.deepEqual(result.bom, node, dialect);
    const parsed = mine[0];
    assert.deepEqual(parsed?.type === 'parsed' && parsed.bom, node, dialect);
  }
});

test('a netlist that does not read posts no parsed stage, and its failure carries no rows', async () => {
  const from = heard.length;
  const result = await draw('R1 a b 1k\nD1 a');
  assert.equal(result.status, 'failure');
  assert.equal(result.status === 'failure' && result.bom, undefined);
  assert.equal(heard.slice(from).some((message) => message.type === 'parsed'), false);
});

test('the worked example with an include: the included row first, its file named, m=2 apart', async () => {
  const result = await draw('.include "included/stage.cir"\nX1 inp inn vcc vee out LM358\nR1 out fb 1k m=2\nR2 fb 0 1k', 'ngspice',
    files({ 'included/stage.cir': 'R7 c out 4k7\n' }));
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.deepEqual(result.bom, [
    { type: 'resistor', name: 'resistor', value: '4k7', references: [{ ref: 'R7', line: 1, file: 'included/stage.cir' }] },
    { type: 'subcircuit', name: 'subcircuit', title: 'LM358', value: '', references: [{ ref: 'X1', line: 2 }] },
    { type: 'resistor', name: 'resistor', value: '1k m=2', references: [{ ref: 'R1', line: 3 }] },
    { type: 'resistor', name: 'resistor', value: '1k', references: [{ ref: 'R2', line: 4 }] }
  ]);
  assert.equal(result.notes.length, 1);
});
