import type { RenderResult } from '@reonarudo/spice-renderer';
import type { FenceAttributes } from './attributes';
import { themeSvg } from './theme';

/**
 * The DOM every spice code block gets: the port of spice-markdown-preview's markdown.ts, built as
 * nodes rather than HTML strings. Text from the note (captions, alt text, the source view, error
 * messages) only ever becomes text nodes or attribute values. The schematic is the renderer's
 * output, drawn by its own SVG writer; it is parsed as XML, never as HTML.
 *
 *   div.spice-fence[data-fence-key][data-view?]
 *     button.spice-toggle   both glyphs; the stylesheet shows the one naming the other view.
 *                           Reading view only: in Live Preview Obsidian's own "Edit this block"
 *                           button serves, as for Mermaid, and the stylesheet hides this one.
 *     div.spice-rendering   the schematic (in a figure when captioned or aligned), an error card, or the loading line
 *     pre > code.language-spice   the fence as written, hidden until the reader flips the fence
 */

/** The class on every schematic's root `<svg>`, set by the renderer, and the prefix of every class the stylesheet selects. */
export const BASE_CLASS = 'spice';

/** The text of the error report shown in place of a schematic: the extension's, unchanged but for the setting's name. */
export function describe(result: Exclude<RenderResult, { status: 'success' }>, source: string): string {
  if (result.status === 'timeout') {
    const seconds = (result.budget / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });
    return `Layout took longer than ${seconds} s (the "Layout timeout" setting). ` +
      'Split the circuit into several fences, or raise the limit.';
  }
  if (result.status === 'unavailable') {
    return `The schematic renderer could not start: ${result.reason}. It will retry on the next render.`;
  }
  // Echo the line the reader names, with a caret under the column, so the author need not count.
  const lines = source.split('\n');
  const text = result.line !== undefined ? lines[result.line - 1]?.replace(/\r$/, '') : undefined;
  if (text === undefined || result.line === undefined) return result.message;
  const gutter = `${result.line} │ `;
  // Columns are 1-based. One past the end is allowed: that is where the reader points when a
  // token is missing.
  const column = Math.min(Math.max((result.column ?? 1) - 1, 0), text.length + 1);
  return `${result.message}\n\n${gutter}${text}\n${' '.repeat(gutter.length + column)}^`;
}

/** The fence key: FNV-1a, 32-bit, of the exact body, as eight hex digits. */
export function fenceKey(body: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// Both glyphs ship; the stylesheet shows the one naming the view a click leads to. They are the
// Lucide icons Obsidian draws its own block buttons with: `code-2`, as on the "Edit this block"
// button Mermaid and every rendered code block get in Live Preview, and `network` for the way back.
const LUCIDE = 'xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_CODE = `<svg ${LUCIDE} class="svg-icon lucide-code-2 ${BASE_CLASS}-icon-code">` +
  '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>';
const ICON_GRAPH = `<svg ${LUCIDE} class="svg-icon lucide-network ${BASE_CLASS}-icon-graph">` +
  '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/>' +
  '<path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg>';

/** The button's name in each view: what a click shows. */
const LABEL_SHOW_SOURCE = 'Show source';
const LABEL_SHOW_RENDERING = 'Show schematic';

/** An SVG document's root, imported into `doc`, or nothing when the markup is not a well-formed `<svg>`. */
function parseSvg(doc: Document, markup: string): Element | undefined {
  const Parser = doc.defaultView?.DOMParser ?? DOMParser;
  const parsed = new Parser().parseFromString(markup, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!root || root.localName !== 'svg' || parsed.getElementsByTagName('parsererror').length > 0) return undefined;
  return doc.importNode(root, true);
}

export interface FenceParts {
  wrapper: HTMLElement;
  button: HTMLButtonElement;
  rendering: HTMLElement;
}

/** The wrapper with its toggle, an empty rendering slot, and the source view: the fence as written. */
export function buildFence(doc: Document, body: string, key: string): FenceParts {
  const wrapper = doc.createElement('div');
  wrapper.className = `${BASE_CLASS}-fence`;
  wrapper.setAttribute('data-fence-key', key);

  const button = doc.createElement('button');
  button.type = 'button';
  // `clickable-icon` is Obsidian's own icon-button class, so the button takes the app's look.
  button.className = `${BASE_CLASS}-toggle clickable-icon`;
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', LABEL_SHOW_SOURCE);
  for (const icon of [ICON_CODE, ICON_GRAPH]) button.append(parseSvg(doc, icon)!);

  const rendering = doc.createElement('div');
  rendering.className = `${BASE_CLASS}-rendering`;

  const pre = doc.createElement('pre');
  const code = doc.createElement('code');
  code.className = `language-${BASE_CLASS}`;
  code.textContent = body;
  pre.append(code);

  wrapper.append(button, rendering, pre);
  return { wrapper, button, rendering };
}

/** Flip a wrapper between its rendering and its source view. */
export function setView(wrapper: Element, source: boolean): void {
  if (source) wrapper.setAttribute('data-view', 'source');
  else wrapper.removeAttribute('data-view');
  const button = wrapper.querySelector(`.${BASE_CLASS}-toggle`);
  button?.setAttribute('aria-pressed', source ? 'true' : 'false');
  button?.setAttribute('aria-label', source ? LABEL_SHOW_RENDERING : LABEL_SHOW_SOURCE);
}

export function isSourceView(wrapper: Element): boolean {
  return wrapper.getAttribute('data-view') === 'source';
}

/** The status line while a fence is being prepared and drawn. */
export function showLoading(rendering: HTMLElement): void {
  const doc = rendering.ownerDocument;
  const line = doc.createElement('div');
  line.className = `${BASE_CLASS}-loading`;
  line.setAttribute('role', 'status');
  line.textContent = 'Reading the netlist…';
  rendering.replaceChildren(line);
}

/** An error card in place of the schematic. */
export function showError(rendering: HTMLElement, text: string): void {
  const doc = rendering.ownerDocument;
  const card = doc.createElement('div');
  card.className = `${BASE_CLASS}-error`;
  card.setAttribute('role', 'alert');
  const pre = doc.createElement('pre');
  pre.textContent = text;
  card.append(pre);
  rendering.replaceChildren(card);
}

/** Alt text as an accessible name inside the figure, so a caption stays outside the image role. */
function wrap(doc: Document, schematic: Element, attributes: FenceAttributes): Element {
  let node = schematic;
  if (attributes.alt !== undefined) {
    const image = doc.createElement('div');
    image.setAttribute('role', 'img');
    image.setAttribute('aria-label', attributes.alt);
    image.append(node);
    node = image;
  }
  if (attributes.caption === undefined && attributes.align === undefined) return node;
  const figure = doc.createElement('figure');
  figure.className = attributes.align
    ? `${BASE_CLASS}-figure ${BASE_CLASS}-align-${attributes.align}`
    : `${BASE_CLASS}-figure`;
  figure.append(node);
  if (attributes.caption !== undefined) {
    const caption = doc.createElement('figcaption');
    caption.textContent = attributes.caption;
    figure.append(caption);
  }
  return figure;
}

/** The library's result in the rendering slot: the schematic, or an error card quoting `source`. */
export function showResult(rendering: HTMLElement, result: RenderResult, attributes: FenceAttributes, source: string): void {
  if (result.status !== 'success') {
    showError(rendering, describe(result, source));
    return;
  }
  const doc = rendering.ownerDocument;
  const svg = parseSvg(doc, result.output);
  if (!svg) {
    showError(rendering, 'The schematic renderer failed: it returned a schematic that could not be read');
    return;
  }
  // Every colour gets its dark-theme counterpart; the stylesheet decides which one shows.
  themeSvg(svg);
  // The renderer emits a `viewBox` and no size, so a small circuit would otherwise stretch to the
  // column; its units are pixels. The stylesheet still scales a wide one down.
  const width = /^\S+\s+\S+\s+([0-9.]+)\s/.exec(svg.getAttribute('viewBox')?.trim() ?? '')?.[1];
  if (width) svg.setAttribute('width', `${width}px`);
  // The author's class joins the root's `spice` class, so the stylesheet's sizing still applies.
  if (attributes.class) svg.setAttribute('class', `${svg.getAttribute('class') ?? ''} ${attributes.class}`.trim());
  rendering.replaceChildren(wrap(doc, svg, attributes));
}
