// Helpers the tests share: a DOM, and one fence built the way the plugin builds it.
import { Window } from 'happy-dom';
import { installObsidianDom } from './obsidian-dom';
import type { RenderResult } from '@reonarudo/spice-renderer';
import { parseAttributes } from '../src/attributes';
import { buildFence, fenceKey, showBom, showResult } from '../src/fence';

export const window = new Window();
installObsidianDom(window as never);
export const document = window.document as unknown as Document;

/** A fence with info string `info` and `body`, its rendering and BOM slots filled with `result`. */
export function fence(info: string, body: string, result: RenderResult): HTMLElement {
  const parts = buildFence(document.createElement('div'), body, fenceKey(body));
  showResult(parts.rendering, result, parseAttributes(info).attributes, body);
  showBom(parts.bom, result);
  return parts.wrapper;
}

/** The rendering slot's inner HTML, so the exact-markup tests assert only the rendering. */
export function rendering(wrapper: Element): string {
  return wrapper.querySelector('.spice-rendering')!.innerHTML;
}

/** The BOM slot's inner HTML. */
export function bom(wrapper: Element): string {
  return wrapper.querySelector('.spice-bom')!.innerHTML;
}
