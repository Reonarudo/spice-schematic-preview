import type { RenderResult } from '@reonarudo/spice-renderer';
import type { FenceAttributes } from './attributes';
import { showBom, showBomLoading, showError, showLoading, showResult, type FenceParts } from './fence';

/** A slow block shows the loading line after this long; a fast one never flickers. */
export const LOADING_DELAY_MS = 150;

export interface DrawOptions {
  attributes: FenceAttributes;
  /** The fence body, for error cards that quote a line. */
  source: string;
  /** Whether this draw may still fill the slot: the block is shown and no later draw started. */
  current(): boolean;
  /** Hears a programmer error before the block shows it. */
  report?(message: string): void;
  delay?: number;
}

/**
 * Fill a block's rendering and BOM slots with what `produce` yields. A slot that is still empty
 * shows "Reading the netlist…" while the fence is prepared and laid out; a slot that already
 * holds a drawing or a table (a block drawn again after an included file changed, a restart or a
 * setting change) keeps it until the new one is ready, as the extension's preview kept a fence's
 * last drawing and table rather than flash a placeholder.
 */
export async function drawBlock(
  { rendering, bom }: Pick<FenceParts, 'rendering' | 'bom'>, produce: () => Promise<RenderResult>, options: DrawOptions
): Promise<void> {
  const slow = window.setTimeout(() => {
    if (!options.current()) return;
    if (!rendering.hasChildNodes()) showLoading(rendering);
    if (!bom.hasChildNodes()) showBomLoading(bom);
  }, options.delay ?? LOADING_DELAY_MS);
  try {
    const result = await produce();
    if (options.current()) {
      showResult(rendering, result, options.attributes, options.source);
      showBom(bom, result);
    }
  } catch (error) {
    // The host throws only for programmer errors; the block shows it rather than staying blank.
    const cause = error instanceof Error ? error.message : String(error);
    options.report?.(`SPICE render failed: ${cause}`);
    if (options.current()) {
      showError(rendering, `The schematic renderer failed: ${cause}`);
      showBom(bom, undefined);
    }
  } finally {
    window.clearTimeout(slow);
  }
}
