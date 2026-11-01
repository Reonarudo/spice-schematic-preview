// The DOM each spice block gets: spice-markdown-preview's test/markdown.test.ts, ported from HTML
// strings to built nodes. Tests about delegating other fences, VS Code's scroll sync (code-line,
// data-line) and its highlighter are gone with the markdown-it rule; Obsidian routes blocks by
// language itself. The slot memory (a fence not ready keeps its last drawing) is the plugin's
// redraw in place, covered in test/block.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RenderResult } from '@reonarudo/spice-renderer';
import { buildFence, describe, fenceKey, isSourceView, setView, showError, showLoading } from '../src/fence';
import { document, fence, rendering } from './helpers';

const schematic = (output = '<svg xmlns="http://www.w3.org/2000/svg" class="spice" viewBox="4 4 48 101"></svg>'): RenderResult => ({ status: 'success', output, notes: [] });
const SIZED = '<svg xmlns="http://www.w3.org/2000/svg" class="spice" viewBox="4 4 48 101" width="48px"></svg>';

const LUCIDE = 'xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_CODE = `<svg ${LUCIDE} class="svg-icon lucide-code-2 spice-icon-code">` +
  '<path d="m18 16 4-4-4-4"></path><path d="m6 8-4 4 4 4"></path><path d="m14.5 4-5 16"></path></svg>';
const ICON_GRAPH = `<svg ${LUCIDE} class="svg-icon lucide-network spice-icon-graph">` +
  '<rect x="16" y="16" width="6" height="6" rx="1"></rect><rect x="2" y="16" width="6" height="6" rx="1"></rect><rect x="9" y="2" width="6" height="6" rx="1"></rect>' +
  '<path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"></path><path d="M12 12V8"></path></svg>';
const TOGGLE = `<button type="button" class="spice-toggle clickable-icon" aria-pressed="false" aria-label="Show source">${ICON_CODE}${ICON_GRAPH}</button>`;
const LOADING = '<div class="spice-loading" role="status">Reading the netlist…</div>';

// The DOM contract, asserted exactly once, here.
test('every block is wrapped: toggle first, rendering slot, then the source <pre>', () => {
  assert.equal(fence('spice', 'R1 a 0 1\n', schematic()).outerHTML,
    `<div class="spice-fence" data-fence-key="997d4f82">${TOGGLE}` +
    `<div class="spice-rendering">${SIZED}</div>` +
    '<pre><code class="language-spice">R1 a 0 1\n</code></pre></div>');
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

test('setView flips the wrapper, the button state and its name, and back', () => {
  const wrapper = fence('spice', 'R1 a 0 1', schematic());
  const button = wrapper.querySelector('button')!;
  assert.equal(button.hasAttribute('title'), false);
  setView(wrapper, true);
  assert.equal(wrapper.getAttribute('data-view'), 'source');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.getAttribute('aria-label'), 'Show schematic');
  assert.equal(isSourceView(wrapper), true);
  setView(wrapper, false);
  assert.equal(wrapper.hasAttribute('data-view'), false);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.getAttribute('aria-label'), 'Show source');
});

test('an error card, a renderer failure and the loading line sit in the rendering slot', () => {
  assert.equal(rendering(fence('spice', 'R1 a 0 1\n', { status: 'failure', message: 'bad' })),
    '<div class="spice-error" role="alert"><pre>bad</pre></div>');
  const parts = buildFence(document, 'R1 a 0 1\n', fenceKey('R1 a 0 1\n'));
  showError(parts.rendering, 'The schematic renderer failed: boom');
  assert.equal(rendering(parts.wrapper), '<div class="spice-error" role="alert"><pre>The schematic renderer failed: boom</pre></div>');
  showLoading(parts.rendering);
  assert.equal(rendering(parts.wrapper), LOADING);
  assert.match(parts.wrapper.outerHTML, /^<div class="spice-fence" data-fence-key="997d4f82"><button /);
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
