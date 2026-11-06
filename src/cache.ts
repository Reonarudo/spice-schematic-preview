import type { Prepared, RenderResult } from '@reonarudo/spice-renderer';

export interface Results {
  render(prepared: Prepared): Promise<RenderResult>;
  /** Forget every outcome, so a cached timeout is retried. */
  clear(): void;
}

const MAX_RESULTS = 96;

/**
 * Remember outcomes by the prepared input's identity, a digest of the fence, its dialect and its
 * included files: spice-markdown-preview's preview.ts cache. Obsidian runs a code block processor
 * again whenever a section is re-rendered, so without this every pass would lay the circuit out
 * again. Identical inputs rendered at the same time share one render. Timeouts are kept: a circuit
 * too large to lay out would otherwise cost its whole budget on every pass. `unavailable` is not
 * kept, nor is a rejection: neither says anything about the netlist.
 *
 * `log` receives the netlist reader's notes, once per fresh render, labelled with the fence's first
 * line: from any result carrying them, a timeout or failure after the netlist was read included.
 */
export function createResults(
  render: (prepared: Prepared) => Promise<RenderResult>,
  log: (line: string) => void = () => {},
  max = MAX_RESULTS
): Results {
  const entries = new Map<string, Promise<RenderResult>>();
  return {
    render(prepared) {
      const key = prepared.identity;
      const hit = entries.get(key);
      if (hit) {
        // Most recently used goes last; the first key is evicted first.
        entries.delete(key);
        entries.set(key, hit);
        return hit;
      }
      const pending = render(prepared);
      entries.set(key, pending);
      if (entries.size > max) entries.delete(entries.keys().next().value!);
      pending.then((result) => {
        // A timeout or a layout failure keeps the notes of the netlist it read.
        if (result.status !== 'unavailable') for (const note of result.notes ?? []) log(`${label(prepared.source)}: ${note}`);
        if (result.status === 'unavailable' && entries.get(key) === pending) entries.delete(key);
      }, () => {
        if (entries.get(key) === pending) entries.delete(key);
      });
      return pending;
    },
    clear() {
      entries.clear();
    }
  };
}

function label(source: string): string {
  const first = source.trim().split('\n', 1)[0]!.trim();
  return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}
