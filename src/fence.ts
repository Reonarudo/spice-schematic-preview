import type { BomRow, RenderResult } from '@reonarudo/spice-renderer';
import type { FenceAttributes } from './attributes';
import { themeSvg } from './theme';

/**
 * The DOM every spice code block gets: the port of spice-markdown-preview's markdown.ts, built as
 * nodes rather than HTML strings. Text from the note (captions, alt text, the source view, error
 * messages) only ever becomes text nodes or attribute values. The schematic is the renderer's
 * output, drawn by its own SVG writer; it is parsed as XML, never as HTML.
 *
 *   div.spice-fence[data-fence-key][data-view?]      data-view: absent (rendering), "source" or "bom"
 *     button.spice-bom-button   list and graph glyphs; leads to the BOM view and back
 *     button.spice-toggle   both glyphs; the stylesheet shows the one naming the view a click leads to.
 *                           Both buttons are Reading view only: in Live Preview Obsidian's own
 *                           "Edit this block" button serves, as for Mermaid, and the stylesheet hides them.
 *     div.spice-rendering   the schematic (in a figure when captioned or aligned), an error card, or the loading line
 *     div.spice-bom         the BOM table, or one sentence saying why there is none
 *     pre > code.language-spice   the fence as written, hidden until the reader flips the fence
 *
 * The DOM contract is spice-markdown-preview's docs/bom-view-spec.md, section 5, as amended for
 * this plugin in section 10: the BOM style is a body class, not a class on the BOM slot.
 */

/** The class on every schematic's root `<svg>`, set by the renderer, and the prefix of every class the stylesheet selects. */
export const BASE_CLASS = 'spice';

/** What a fence shows instead of its rendering: its source, or its BOM. */
export type View = 'source' | 'bom';

export function isView(value: unknown): value is View {
  return value === 'source' || value === 'bom';
}

/** The status line of both slots while a fence is being prepared and drawn. */
const LOADING = 'Reading the netlist…';

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
// button Mermaid and every rendered code block get in Live Preview, `list` for the BOM, and
// `network` for the way back, which both buttons share.
const LUCIDE = 'xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_CODE = `<svg ${LUCIDE} class="svg-icon lucide-code-2 ${BASE_CLASS}-icon-code">` +
  '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>';
const ICON_GRAPH = `<svg ${LUCIDE} class="svg-icon lucide-network ${BASE_CLASS}-icon-graph">` +
  '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/>' +
  '<path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg>';

const ICON_LIST = `<svg ${LUCIDE} class="svg-icon lucide-list ${BASE_CLASS}-icon-list">` +
  '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/></svg>';

/** The toggle's name in each view: what a click shows. */
const LABEL_SHOW_SOURCE = 'Show source';
const LABEL_SHOW_RENDERING = 'Show schematic';
/** The BOM button's name, constant like the extension's: the glyph says where a click leads. */
const LABEL_BOM = 'BOM view';

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
  bomButton: HTMLButtonElement;
  toggle: HTMLButtonElement;
  rendering: HTMLElement;
  bom: HTMLElement;
}

/**
 * The wrapper with its two buttons, empty rendering and BOM slots, and the source view (the
 * fence as written), built inside `parent` (the element Obsidian hands the code block processor)
 * with Obsidian's `createEl`, so every element belongs to the window the block is drawn in,
 * pop-out windows included.
 */
export function buildFence(parent: HTMLElement, body: string, key: string): FenceParts {
  const wrapper = parent.createDiv({ cls: `${BASE_CLASS}-fence`, attr: { 'data-fence-key': key } });
  // `clickable-icon` is Obsidian's own icon-button class, so the buttons take the app's look.
  const button = (cls: string, label: string, icons: string[]): HTMLButtonElement => {
    const made = wrapper.createEl('button', {
      cls: `${BASE_CLASS}-${cls} clickable-icon`,
      attr: { type: 'button', 'aria-pressed': 'false', 'aria-label': label }
    });
    for (const icon of icons) made.append(parseSvg(wrapper.doc, icon)!);
    return made;
  };
  const bomButton = button('bom-button', LABEL_BOM, [ICON_LIST, ICON_GRAPH]);
  const toggle = button('toggle', LABEL_SHOW_SOURCE, [ICON_CODE, ICON_GRAPH]);
  const rendering = wrapper.createDiv({ cls: `${BASE_CLASS}-rendering` });
  const bom = wrapper.createDiv({ cls: `${BASE_CLASS}-bom` });
  wrapper.createEl('pre').createEl('code', { cls: `language-${BASE_CLASS}`, text: body });
  return { wrapper, bomButton, toggle, rendering, bom };
}

/** Show a wrapper's source view, its BOM view, or (`undefined`) its rendering. Each button is pressed only in its own view. */
export function setView(wrapper: Element, view: View | undefined): void {
  if (view) wrapper.setAttribute('data-view', view);
  else wrapper.removeAttribute('data-view');
  const toggle = wrapper.querySelector(`.${BASE_CLASS}-toggle`);
  toggle?.setAttribute('aria-pressed', view === 'source' ? 'true' : 'false');
  toggle?.setAttribute('aria-label', view === 'source' ? LABEL_SHOW_RENDERING : LABEL_SHOW_SOURCE);
  wrapper.querySelector(`.${BASE_CLASS}-bom-button`)?.setAttribute('aria-pressed', view === 'bom' ? 'true' : 'false');
}

/** The view a wrapper shows; `undefined` for its rendering. */
export function viewOf(wrapper: Element): View | undefined {
  const view = wrapper.getAttribute('data-view');
  return isView(view) ? view : undefined;
}

/**
 * Where a click leads (docs/bom-view-spec.md section 5, rule 6): each button to its own view from
 * anywhere, and back to the rendering from its own view.
 */
export function nextView(current: View | undefined, clicked: View): View | undefined {
  return current === clicked ? undefined : clicked;
}

/** The status line while a fence is being prepared and drawn. */
export function showLoading(rendering: HTMLElement): void {
  rendering.empty();
  rendering.createDiv({ cls: `${BASE_CLASS}-loading`, attr: { role: 'status' }, text: LOADING });
}

// The BOM slot (docs/bom-view-spec.md section 4): a table, or one sentence chosen by rule.
const BOM_NO_PARTS = 'No parts.';
const BOM_NOT_READ = 'The netlist did not read, so there are no parts.';
const BOM_NOT_RUNNING = 'The schematic renderer is not running, so there are no parts.';

/** The BOM slot while a fence is being prepared and read. */
export function showBomLoading(bom: HTMLElement): void {
  bom.empty();
  bom.createDiv({ cls: `${BASE_CLASS}-bom-empty`, attr: { role: 'status' }, text: LOADING });
}

/**
 * The library's result in the BOM slot. The table shows whenever the result carries rows (a
 * success, a timeout or a layout failure alike); otherwise one sentence says why there are none.
 * `undefined` is no result at all: the renderer threw.
 */
export function showBom(bom: HTMLElement, result: RenderResult | undefined): void {
  bom.empty();
  const rows = result && result.status !== 'unavailable' ? result.bom : undefined;
  if (rows && rows.length > 0) {
    drawBomTable(bom, rows);
    return;
  }
  const sentence = !result || result.status === 'unavailable' ? BOM_NOT_RUNNING : rows ? BOM_NO_PARTS : BOM_NOT_READ;
  bom.createDiv({ cls: `${BASE_CLASS}-bom-empty`, text: sentence });
}

/** The summary line and the table; the File column only when a row names a file. Every cell is a text node. */
function drawBomTable(bom: HTMLElement, rows: readonly BomRow[]): void {
  const withFile = rows.some((row) => row.references.some((reference) => reference.file !== undefined));
  const partCount = rows.reduce((sum, row) => sum + row.references.length, 0);
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  // Shown by the stylesheet only in the card style; `dir="auto"` puts the number first in a right-to-left note.
  bom.createEl('p', { cls: `${BASE_CLASS}-bom-summary`, attr: { dir: 'auto' }, text: `${plural(partCount, 'part')} in ${plural(rows.length, 'row')}` });
  const table = bom.createEl('table', { cls: `${BASE_CLASS}-bom-table` });
  const head = table.createEl('thead').createEl('tr');
  head.createEl('th', { cls: `${BASE_CLASS}-bom-qty`, attr: { scope: 'col' }, text: 'Qty' });
  for (const name of withFile ? ['References', 'Type', 'Value', 'File'] : ['References', 'Type', 'Value']) {
    head.createEl('th', { attr: { scope: 'col' }, text: name });
  }
  const body = table.createEl('tbody');
  for (const row of rows) {
    const tr = body.createEl('tr');
    tr.createEl('td', { cls: `${BASE_CLASS}-bom-qty`, text: String(row.references.length) });
    tr.createEl('td', { cls: `${BASE_CLASS}-bom-refs`, text: row.references.map((reference) => reference.ref).join(', ') });
    tr.createEl('td', { cls: `${BASE_CLASS}-bom-type`, text: row.name });
    tr.createEl('td', { cls: `${BASE_CLASS}-bom-value`, text: [row.title, row.value].filter(Boolean).join(' ') });
    if (withFile) {
      const files = [...new Set(row.references.flatMap((reference) => reference.file === undefined ? [] : [reference.file]))];
      tr.createEl('td', { cls: `${BASE_CLASS}-bom-file`, text: files.join(', ') });
    }
  }
}

/** An error card in place of the schematic. */
export function showError(rendering: HTMLElement, text: string): void {
  rendering.empty();
  rendering.createDiv({ cls: `${BASE_CLASS}-error`, attr: { role: 'alert' } }).createEl('pre', { text });
}

/**
 * Put the schematic in `rendering`: in a figure when captioned or aligned, with the alt text as an
 * accessible name inside the figure, so a caption stays outside the image role.
 */
function place(rendering: HTMLElement, schematic: Element, attributes: FenceAttributes): void {
  const figure = attributes.caption === undefined && attributes.align === undefined
    ? rendering
    : rendering.createEl('figure', {
      cls: attributes.align ? `${BASE_CLASS}-figure ${BASE_CLASS}-align-${attributes.align}` : `${BASE_CLASS}-figure`
    });
  const holder = attributes.alt === undefined ? figure : figure.createDiv({ attr: { role: 'img', 'aria-label': attributes.alt } });
  holder.append(schematic);
  if (attributes.caption !== undefined) figure.createEl('figcaption', { text: attributes.caption });
}

/** The library's result in the rendering slot: the schematic, or an error card quoting `source`. */
export function showResult(rendering: HTMLElement, result: RenderResult, attributes: FenceAttributes, source: string): void {
  if (result.status !== 'success') {
    showError(rendering, describe(result, source));
    return;
  }
  const svg = parseSvg(rendering.doc, result.output);
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
  rendering.empty();
  place(rendering, svg, attributes);
}
