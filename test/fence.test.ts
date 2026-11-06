// The DOM each spice block gets: spice-markdown-preview's test/markdown.test.ts, ported from HTML
// strings to built nodes, with the BOM view of docs/bom-view-spec.md there. Tests about delegating other fences, VS Code's scroll sync (code-line,
// data-line) and its highlighter are gone with the markdown-it rule; Obsidian routes blocks by
// language itself. The slot memory (a fence not ready keeps its last drawing) is the plugin's
// redraw in place, covered in test/block.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BomRow, RenderResult } from '@reonarudo/spice-renderer';
import { buildFence, describe, fenceKey, nextView, setView, showBom, showBomLoading, showError, showLoading, viewOf } from '../src/fence';
import { bom, document, fence, rendering } from './helpers';

const schematic = (output = '<svg xmlns="http://www.w3.org/2000/svg" class="spice" viewBox="4 4 48 101"></svg>', rows: BomRow[] = []): RenderResult =>
  ({ status: 'success', output, bom: rows, notes: [] });
const SIZED = '<svg xmlns="http://www.w3.org/2000/svg" class="spice" viewBox="4 4 48 101" width="48px"></svg>';

const LUCIDE = 'xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_CODE = `<svg ${LUCIDE} class="svg-icon lucide-code-2 spice-icon-code">` +
  '<path d="m18 16 4-4-4-4"></path><path d="m6 8-4 4 4 4"></path><path d="m14.5 4-5 16"></path></svg>';
const ICON_GRAPH = `<svg ${LUCIDE} class="svg-icon lucide-network spice-icon-graph">` +
  '<rect x="16" y="16" width="6" height="6" rx="1"></rect><rect x="2" y="16" width="6" height="6" rx="1"></rect><rect x="9" y="2" width="6" height="6" rx="1"></rect>' +
  '<path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"></path><path d="M12 12V8"></path></svg>';
const ICON_LIST = `<svg ${LUCIDE} class="svg-icon lucide-list spice-icon-list">` +
  '<path d="M3 12h.01"></path><path d="M3 18h.01"></path><path d="M3 6h.01"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M8 6h13"></path></svg>';
const BOM_BUTTON = `<button class="spice-bom-button clickable-icon" type="button" aria-pressed="false" aria-label="BOM view">${ICON_LIST}${ICON_GRAPH}</button>`;
const TOGGLE = `<button class="spice-toggle clickable-icon" type="button" aria-pressed="false" aria-label="Show source">${ICON_CODE}${ICON_GRAPH}</button>`;
const LOADING = '<div class="spice-loading" role="status">Reading the netlist…</div>';

// The DOM contract, asserted exactly once, here.
test('every block is wrapped: BOM button, toggle, rendering slot, BOM slot, then the source <pre>', () => {
  assert.equal(fence('spice', 'R1 a 0 1\n', schematic()).outerHTML,
    `<div class="spice-fence" data-fence-key="997d4f82">${BOM_BUTTON}${TOGGLE}` +
    `<div class="spice-rendering">${SIZED}</div>` +
    '<div class="spice-bom"><div class="spice-bom-empty">No parts.</div></div>' +
    '<pre><code class="language-spice">R1 a 0 1\n</code></pre></div>');
});

test('every path keeps the five children in order: error card, renderer failure, loading', () => {
  const order = (wrapper: Element) => [...wrapper.children].map((child) => child.className || child.tagName.toLowerCase());
  const expected = ['spice-bom-button clickable-icon', 'spice-toggle clickable-icon', 'spice-rendering', 'spice-bom', 'pre'];
  assert.deepEqual(order(fence('spice', 'Q1 a', { status: 'failure', message: 'bad', line: 1 })), expected);
  assert.deepEqual(order(fence('spice', 'R1 a 0 1', { status: 'unavailable', reason: 'gone' })), expected);
  const parts = buildFence(document.createElement('div'), 'R1 a 0 1', fenceKey('R1 a 0 1'));
  assert.deepEqual(order(parts.wrapper), expected);
  showLoading(parts.rendering);
  showBomLoading(parts.bom);
  assert.deepEqual(order(parts.wrapper), expected);
});

test('the fence key is FNV-1a of the exact body', () => {
  assert.equal(fenceKey('R1 a 0 1\n'), '997d4f82');
  assert.equal(fenceKey(''), '811c9dc5');
  assert.equal(fenceKey('R1 a 0 1 \n'), '5003caba');
  // The info string and attributes play no part: same body, same key.
  assert.equal(fence('spice {caption="c" dialect="xyce"}', 'R1 a 0 1\n', schematic()).getAttribute('data-fence-key'), '997d4f82');
});

test('the source view shows the fence as written: an include stays an include line', () => {
  const wrapper = fence('spice', '.include models.lib\nQ1 c b e Q\n', schematic());
  assert.equal(wrapper.querySelector('pre > code.language-spice')!.textContent, '.include models.lib\nQ1 c b e Q\n');
});

test('the source view is the body as text, never markup', () => {
  const wrapper = fence('spice', 'R1 a <b>0</b> 1\n<img src=x onerror=alert(1)>', schematic());
  assert.equal(wrapper.querySelector('pre > code')!.textContent, 'R1 a <b>0</b> 1\n<img src=x onerror=alert(1)>');
  assert.equal(wrapper.querySelectorAll('pre img, pre b').length, 0);
});

test('setView shows each of the three views, pressing only that view\'s button; the toggle names what it shows', () => {
  const wrapper = fence('spice', 'R1 a 0 1', schematic());
  const toggle = wrapper.querySelector('.spice-toggle')!;
  const bomButton = wrapper.querySelector('.spice-bom-button')!;
  assert.equal(toggle.hasAttribute('title'), false);
  assert.equal(bomButton.hasAttribute('title'), false);
  const look = () => [wrapper.getAttribute('data-view'), viewOf(wrapper), bomButton.getAttribute('aria-pressed'),
    toggle.getAttribute('aria-pressed'), toggle.getAttribute('aria-label'), bomButton.getAttribute('aria-label')];
  setView(wrapper, 'source');
  assert.deepEqual(look(), ['source', 'source', 'false', 'true', 'Show schematic', 'BOM view']);
  setView(wrapper, 'bom');
  assert.deepEqual(look(), ['bom', 'bom', 'true', 'false', 'Show source', 'BOM view']);
  setView(wrapper, undefined);
  assert.deepEqual(look(), [null, undefined, 'false', 'false', 'Show source', 'BOM view']);
  wrapper.setAttribute('data-view', 'nonsense');
  assert.equal(viewOf(wrapper), undefined);
});

test('each button leads to its view from anywhere, and back to the rendering from its own', () => {
  assert.equal(nextView(undefined, 'bom'), 'bom');
  assert.equal(nextView('bom', 'bom'), undefined);
  assert.equal(nextView('source', 'bom'), 'bom');
  assert.equal(nextView(undefined, 'source'), 'source');
  assert.equal(nextView('source', 'source'), undefined);
  assert.equal(nextView('bom', 'source'), 'source');
});

test('an error card, a renderer failure and the loading line sit in the rendering slot', () => {
  assert.equal(rendering(fence('spice', 'R1 a 0 1\n', { status: 'failure', message: 'bad' })),
    '<div class="spice-error" role="alert"><pre>bad</pre></div>');
  const parts = buildFence(document.createElement('div'), 'R1 a 0 1\n', fenceKey('R1 a 0 1\n'));
  showError(parts.rendering, 'The schematic renderer failed: boom');
  assert.equal(rendering(parts.wrapper), '<div class="spice-error" role="alert"><pre>The schematic renderer failed: boom</pre></div>');
  showLoading(parts.rendering);
  assert.equal(rendering(parts.wrapper), LOADING);
  assert.match(parts.wrapper.outerHTML, /^<div class="spice-fence" data-fence-key="997d4f82"><button class="spice-bom-button /);
});

test('a bare fence emits the schematic unwrapped', () => {
  assert.equal(rendering(fence('spice', 'R1 a 0 1', schematic())), SIZED);
});

test('alt becomes an accessible name, caption a figure, align a class', () => {
  assert.equal(rendering(fence('spice {alt="A divider" caption="Figure 1" align="center"}', 'R1 a 0 1', schematic())),
    `<figure class="spice-figure spice-align-center"><div role="img" aria-label="A divider">${SIZED}</div><figcaption>Figure 1</figcaption></figure>`);
});

test('align alone still produces a figure to carry the class', () => {
  assert.equal(rendering(fence('spice {align="right"}', 'R1 a 0 1', schematic())), `<figure class="spice-figure spice-align-right">${SIZED}</figure>`);
});

test('class lands on the root svg beside the base class, as text', () => {
  const wrapper = fence('spice {class="wide &quot;x\\" onload=\\"y"}', 'R1 a 0 1', schematic());
  const svg = wrapper.querySelector('.spice-rendering > svg')!;
  assert.equal(svg.getAttribute('class'), 'spice wide &quot;x" onload="y');
  assert.equal(svg.getAttribute('onload'), null);
});

test('a fence class cannot break out of the class attribute', () => {
  const wrapper = fence(`spice {class='x" onload="alert(1)"><img src=x onerror=alert(1)>'}`, 'R1 a 0 1', schematic());
  assert.equal(wrapper.querySelectorAll('img').length, 0);
  assert.equal(wrapper.querySelector('.spice-rendering > svg')!.getAttribute('onload'), null);
});

test('attribute text stays text, including quotes, markup and Markdown', () => {
  const wrapper = fence('spice {alt="<img src=x onerror=alert(1)>" caption="**bold** & \\"quoted\\""}', 'R1 a 0 1', schematic());
  assert.equal(wrapper.querySelectorAll('img, strong').length, 0);
  assert.equal(wrapper.querySelector('[role="img"]')!.getAttribute('aria-label'), '<img src=x onerror=alert(1)>');
  assert.equal(wrapper.querySelector('figcaption')!.textContent, '**bold** & "quoted"');
});

test('malformed attributes are ignored and the schematic still renders bare', () => {
  assert.equal(rendering(fence('spice {alt="unterminated}', 'R1 a 0 1', schematic())), SIZED);
});

const BODY = 'R1 a b 1k\nQ1 a';

test('a netlist error quotes its line with a caret under the column', () => {
  const wrapper = fence('spice', BODY, { status: 'failure', message: 'Q1 needs 3 nodes; found 1.', line: 2, column: 6 });
  assert.equal(wrapper.querySelector('.spice-error pre')!.textContent, 'Q1 needs 3 nodes; found 1.\n\n2 │ Q1 a\n         ^');
});

test('an error with no line, or a line outside the fence, shows the message only; text stays text', () => {
  const wrapper = fence('spice', 'R1 a 0 1', { status: 'failure', message: 'bad <b>thing</b>', line: 9, column: 1 });
  assert.equal(rendering(wrapper), '<div class="spice-error" role="alert"><pre>bad &lt;b&gt;thing&lt;/b&gt;</pre></div>');
  assert.equal(describe({ status: 'failure', message: 'The netlist exceeds the 64 KB limit.' }, 'R1 a 0 1'), 'The netlist exceeds the 64 KB limit.');
});

test('a timeout and an unavailable renderer have fixed wording', () => {
  assert.equal(describe({ status: 'timeout', budget: 3000 }, ''),
    'Layout took longer than 3 s (the "Layout timeout" setting). Split the circuit into several fences, or raise the limit.');
  assert.equal(describe({ status: 'timeout', budget: 2500 }, ''),
    'Layout took longer than 2.5 s (the "Layout timeout" setting). Split the circuit into several fences, or raise the limit.');
  assert.match(rendering(fence('spice', 'R1 a 0 1', { status: 'unavailable', reason: 'out of <memory>' })),
    /<pre>The schematic renderer could not start: out of &lt;memory&gt;\. It will retry on the next render\.<\/pre>/);
});

test('a caret sits under the 1-based column, and one past the end of the line', () => {
  assert.equal(describe({ status: 'failure', message: 'bad', line: 1, column: 4 }, 'R1 a 0 1'), 'bad\n\n1 │ R1 a 0 1\n       ^');
  assert.equal(describe({ status: 'failure', message: 'bad', line: 1, column: 99 }, 'R1'), 'bad\n\n1 │ R1\n       ^');
  assert.equal(describe({ status: 'failure', message: 'bad', line: 1 }, 'R1\r\nR2'), 'bad\n\n1 │ R1\n    ^');
});

test('a schematic without a viewBox is left unsized', () => {
  assert.equal(rendering(fence('spice', 'R1 a 0 1', schematic('<svg xmlns="http://www.w3.org/2000/svg" class="spice"></svg>'))),
    '<svg xmlns="http://www.w3.org/2000/svg" class="spice"></svg>');
});

test('output that is not a well-formed <svg> becomes an error card, not markup', () => {
  for (const output of ['<img src=x onerror=alert(1)>', '<svg><unclosed></svg>', 'plain text', '<html><body/></html>']) {
    assert.equal(rendering(fence('spice', 'R1 a 0 1', schematic(output))),
      '<div class="spice-error" role="alert"><pre>The schematic renderer failed: it returned a schematic that could not be read</pre></div>', output);
  }
});

test('every colour of the schematic gets its dark-theme counterpart, the original kept for light', () => {
  const output = '<svg xmlns="http://www.w3.org/2000/svg" class="spice" viewBox="4 4 48 101" fill="none" stroke="#000">' +
    '<text fill="#000" stroke="none" class="nodelabel">$g_vdd</text><path class="wire" d="M0 0h1"/></svg>';
  const svg = fence('spice', 'R1 a 0 1', schematic(output)).querySelector('.spice-rendering > svg')!;
  assert.equal(svg.getAttribute('style'), 'stroke:light-dark(#000, var(--text-normal))');
  assert.equal(svg.querySelector('text')!.getAttribute('style'), 'fill:light-dark(#000, var(--text-normal))');
  assert.equal(svg.getAttribute('width'), '48px');
});

// The BOM table (docs/bom-view-spec.md sections 3.4, 3.5 and 4), drawn from rows as the renderer returns them.

const ref = (name: string, line: number, file?: string) => file === undefined ? { ref: name, line } : { ref: name, line, file };
const BRIDGE: BomRow[] = [
  { type: 'vsource', name: 'voltage source', value: 'SIN(0 12 50)', references: [ref('VAC', 1)] },
  { type: 'diode', name: 'diode', value: '1N4007', references: [ref('D1', 2), ref('D2', 3), ref('D3', 4), ref('D4', 5)] },
  { type: 'capacitor', name: 'capacitor', value: '1000u', references: [ref('C1', 6)] },
  { type: 'resistor', name: 'resistor', value: '1k', references: [ref('RL', 7)] }
];
const INCLUDES: BomRow[] = [
  { type: 'resistor', name: 'resistor', value: '4k7', references: [ref('R7', 1, 'included/stage.cir')] },
  { type: 'subcircuit', name: 'subcircuit', title: 'LM358', value: '', references: [ref('X1', 2)] },
  { type: 'resistor', name: 'resistor', value: '1k m=2', references: [ref('R1', 3)] },
  { type: 'resistor', name: 'resistor', value: '1k', references: [ref('R2', 4)] }
];
const OPAMP: BomRow[] = [
  { type: 'subcircuit', name: 'subcircuit', title: 'opamp', value: '', references: [ref('X1', 2), ref('X2', 5)] },
  { type: 'vcvs', name: 'voltage-controlled voltage source', title: 'VCVS', value: '100k', references: [ref('E1', 9)] }
];

/** The table as text: the header row, then each body row, cell by cell. */
const cells = (wrapper: Element) => [...wrapper.querySelectorAll('.spice-bom-table tr')]
  .map((row) => [...row.children].map((cell) => cell.textContent));

test('the bridge rectifier: four diodes in one row, the quantity right-aligned, no File column', () => {
  const wrapper = fence('spice', 'VAC ac1 ac2 SIN(0 12 50)', schematic(undefined, BRIDGE));
  assert.deepEqual(cells(wrapper), [
    ['Qty', 'References', 'Type', 'Value'],
    ['1', 'VAC', 'voltage source', 'SIN(0 12 50)'],
    ['4', 'D1, D2, D3, D4', 'diode', '1N4007'],
    ['1', 'C1', 'capacitor', '1000u'],
    ['1', 'RL', 'resistor', '1k']
  ]);
  assert.equal(bom(wrapper),
    '<p class="spice-bom-summary" dir="auto">7 parts in 4 rows</p>' +
    '<table class="spice-bom-table"><thead><tr><th class="spice-bom-qty" scope="col">Qty</th><th scope="col">References</th><th scope="col">Type</th><th scope="col">Value</th></tr></thead>' +
    '<tbody><tr><td class="spice-bom-qty">1</td><td class="spice-bom-refs">VAC</td><td class="spice-bom-type">voltage source</td><td class="spice-bom-value">SIN(0 12 50)</td></tr>' +
    '<tr><td class="spice-bom-qty">4</td><td class="spice-bom-refs">D1, D2, D3, D4</td><td class="spice-bom-type">diode</td><td class="spice-bom-value">1N4007</td></tr>' +
    '<tr><td class="spice-bom-qty">1</td><td class="spice-bom-refs">C1</td><td class="spice-bom-type">capacitor</td><td class="spice-bom-value">1000u</td></tr>' +
    '<tr><td class="spice-bom-qty">1</td><td class="spice-bom-refs">RL</td><td class="spice-bom-type">resistor</td><td class="spice-bom-value">1k</td></tr></tbody></table>');
});

test('includes and multiplicity: the File column, a fence part\'s file cell empty, the title as the Value', () => {
  assert.deepEqual(cells(fence('spice', '.include "included/stage.cir"', schematic(undefined, INCLUDES))), [
    ['Qty', 'References', 'Type', 'Value', 'File'],
    ['1', 'R7', 'resistor', '4k7', 'included/stage.cir'],
    ['1', 'X1', 'subcircuit', 'LM358', ''],
    ['1', 'R1', 'resistor', '1k m=2', ''],
    ['1', 'R2', 'resistor', '1k', '']
  ]);
});

test('the Value is the title, a space, then the tail; a row\'s files are distinct, in first-reference order', () => {
  const rows: BomRow[] = [
    ...OPAMP,
    { type: 'resistor', name: 'resistor', value: '1k', references: [ref('R1', 1, 'b.cir'), ref('R2', 2), ref('R3', 1, 'a.cir'), ref('R4', 3, 'b.cir')] },
    { type: 'resistor', name: 'resistor', value: '', references: [ref('R9', 9)] }
  ];
  assert.deepEqual(cells(fence('spice', 'X1 a b opamp', schematic(undefined, rows))), [
    ['Qty', 'References', 'Type', 'Value', 'File'],
    ['2', 'X1, X2', 'subcircuit', 'opamp', ''],
    ['1', 'E1', 'voltage-controlled voltage source', 'VCVS 100k', ''],
    ['4', 'R1, R2, R3, R4', 'resistor', '1k', 'b.cir, a.cir'],
    ['1', 'R9', 'resistor', '', '']
  ]);
  const one = fence('spice', 'R9 a 0', schematic(undefined, [rows[3]!]));
  assert.equal(one.querySelector('.spice-bom-summary')!.textContent, '1 part in 1 row');
});

test('every cell is text, never markup', () => {
  const rows: BomRow[] = [{ type: 'resistor', name: 'resistor', value: '<b>1k</b> <img src=x onerror=alert(1)>', references: [ref('R<i>1</i>', 1, '<script>.cir')] }];
  const wrapper = fence('spice', 'R1 a 0 1k', schematic(undefined, rows));
  assert.equal(wrapper.querySelectorAll('.spice-bom b, .spice-bom img, .spice-bom i, .spice-bom script').length, 0);
  assert.deepEqual(cells(wrapper)[1], ['1', 'R<i>1</i>', 'resistor', '<b>1k</b> <img src=x onerror=alert(1)>', '<script>.cir']);
});

test('empty states, one sentence each, chosen by what the result carries', () => {
  const EMPTY = (text: string) => `<div class="spice-bom-empty">${text}</div>`;
  const NOT_READ = EMPTY('The netlist did not read, so there are no parts.');
  const NOT_RUNNING = EMPTY('The schematic renderer is not running, so there are no parts.');
  assert.equal(bom(fence('spice', 'R1 a 0 1', schematic())), EMPTY('No parts.'));
  assert.equal(bom(fence('spice', 'Q1 a', { status: 'failure', message: 'Q1 needs 3 nodes; found 1.', line: 1 })), NOT_READ);
  assert.equal(bom(fence('spice', 'R1 a 0 1', { status: 'timeout', budget: 100 })), NOT_READ);
  assert.equal(bom(fence('spice', 'R1 a 0 1', { status: 'failure', message: 'the SPICE renderer stopped unexpectedly' })), NOT_READ);
  assert.equal(bom(fence('spice', 'R1 a 0 1', { status: 'timeout', budget: 100, bom: [], notes: [] })), EMPTY('No parts.'));
  assert.equal(bom(fence('spice', 'R1 a 0 1', { status: 'unavailable', reason: 'gone' })), NOT_RUNNING);
  const parts = buildFence(document.createElement('div'), 'R1 a 0 1', fenceKey('R1 a 0 1'));
  showBom(parts.bom, undefined);
  assert.equal(bom(parts.wrapper), NOT_RUNNING, 'the renderer threw');
  showBomLoading(parts.bom);
  assert.equal(bom(parts.wrapper), '<div class="spice-bom-empty" role="status">Reading the netlist…</div>');
});

test('a timeout or a layout failure that carries rows shows the table beside its error card', () => {
  const timedOut = fence('spice', 'D1 a 0 1N4007', { status: 'timeout', budget: 100, bom: BRIDGE, notes: [] });
  assert.match(rendering(timedOut), /^<div class="spice-error" role="alert"><pre>Layout took longer than 0\.1 s/);
  assert.equal(cells(timedOut).length, 5);
  const failed = fence('spice', 'D1 a 0 1N4007', { status: 'failure', message: 'The schematic could not be laid out (x).', bom: BRIDGE, notes: [] });
  assert.equal(failed.querySelector('.spice-bom-summary')!.textContent, '7 parts in 4 rows');
});
