// The render worker, bundled for a browser Worker by scripts/worker-bundle.mjs and embedded in
// main.js. A port of spice-renderer's dist/worker.js: the same symbols, ELK, parsers, warm-up and
// `renderNetlist`, answering over postMessage instead of shared memory. It also runs the
// library's `prepare`, so the parsers are bundled once; its file reader asks the plugin for
// each file by message (docs/adr/0001-runtime-host.md).
import ELK from 'elkjs/lib/elk.bundled.js';
import { renderNetlist } from '#renderer/dist/draw-netlist.js';
import { prepare } from '#renderer/dist/prepare.js';
import { loadSymbols } from '#renderer/dist/schematic.js';
import { parserLoader } from '#renderer/dist/parser/modules.js';
import SYMBOLS from '#renderer/dist/skin/symbols.svg';
import type { FileReader } from '@reonarudo/spice-renderer';
import type { PreparedReply, Reply, Request, ReadRequest, RenderRequest, Started } from '../protocol';

interface Scope {
  onmessage: ((event: { data: Request }) => void) | null;
  postMessage(message: Started | Reply | PreparedReply | ReadRequest): void;
}
const scope = self as unknown as Scope;

type Result = Omit<Reply, 'type' | 'id'>['result'] & { discard?: true };
type Layout = Parameters<typeof renderNetlist>[2];
type Includes = NonNullable<Parameters<typeof renderNetlist>[3]>;
type Dialect = NonNullable<Parameters<typeof renderNetlist>[4]>;

/** An ngspice netlist that touches every common symbol, drawn before the worker reports ready. */
const WARM_UP = 'V1 in 0 1\nR1 in out 1k\nC1 out 0 1u\nQ1 out in 0 npn\nM1 out in 0 0 nmos\nX1 in out box';

/**
 * ELK's bundled build, laying out in this thread as it does under Node. Its layout code, loaded on
 * the first `new ELK()`, looks for `document` and `self`: with `self` and no `document` it decides
 * it *is* ELK's web worker, takes over `self.onmessage` and offers no in-thread worker, so the
 * constructor fails. For that one load a `document` is made to exist, which sends it down the
 * path it takes under Node; it is removed straight after.
 */
function createElk(): InstanceType<typeof ELK> {
  const global = globalThis as { document?: unknown };
  const had = 'document' in global;
  if (!had) global.document = {};
  try {
    return new ELK();
  } finally {
    if (!had) delete global.document;
  }
}

async function start(): Promise<(request: Omit<RenderRequest, 'type' | 'id'>) => Promise<Result>> {
  const symbols = loadSymbols(SYMBOLS);
  const elk = createElk();
  const layout: Layout = (graph) => elk.layout(graph);
  const loadParser = parserLoader('');

  const render = async ({ source, dialect, files, outputBytes }: Omit<RenderRequest, 'type' | 'id'>): Promise<Result> => {
    try {
      await loadParser(dialect);
    } catch {
      return { status: 'failure', message: `the ${dialect} parser could not be loaded` };
    }
    const includes: Includes = {
      files: Object.fromEntries(files.map((file) => [file.key, 'text' in file ? file.text : { error: file.error }]))
    };
    const result = await renderNetlist(source, symbols, layout, includes, dialect as Dialect);
    if (result.status === 'failure') {
      // The netlist reader counts columns from 0; the contract counts them from 1.
      return result.column === undefined ? result : { ...result, column: result.column + 1 };
    }
    if (result.status === 'success' && new TextEncoder().encode(result.output).length > outputBytes) {
      return { status: 'failure', message: `SPICE output exceeds the ${outputBytes}-byte limit` };
    }
    return result;
  };

  // The first layout in a fresh worker costs a few hundred milliseconds of warm-up that must not
  // be charged to an author's budget, so it is spent here, before this worker reports ready.
  const warm = await render({ source: WARM_UP, dialect: 'ngspice', files: [], outputBytes: Infinity });
  if (warm.status !== 'success') throw new Error('the warm-up schematic did not draw');
  return render;
}

/** Answers to this worker's file requests, by request number. */
const reads = new Map<number, (result: { bytes: Uint8Array } | { error: string }) => void>();
let nextRead = 0;

/** The library's FileReader for one prepare request, over messages to the plugin. */
function readerFor(id: number): FileReader {
  return {
    read: (key, { maxBytes }) => new Promise((resolve) => {
      const read = ++nextRead;
      reads.set(read, resolve);
      scope.postMessage({ type: 'read', id, read, key, maxBytes });
    })
  };
}

start().then((render) => {
  scope.onmessage = ({ data }) => {
    switch (data.type) {
      case 'file': {
        const settle = reads.get(data.read);
        reads.delete(data.read);
        settle?.(data.result);
        return;
      }
      case 'prepare': {
        const { id, source, dialect } = data;
        prepare(source, { reader: readerFor(id), dialect }).then(
          (prepared) => scope.postMessage({ type: 'prepared', id, prepared }),
          // `prepare` rejects only for programmer errors; this fence alone shows it.
          (error: unknown) => scope.postMessage({
            type: 'prepared', id, error: error instanceof Error ? error.message : 'The netlist could not be prepared.'
          })
        );
        return;
      }
      case 'render': {
        const { id, ...request } = data;
        render(request).then(
          ({ discard, ...result }) => scope.postMessage(discard ? { type: 'reply', id, result, discard } : { type: 'reply', id, result }),
          // An unexpected error may leave a parser's wasm instance unusable; the plugin discards this worker.
          () => scope.postMessage({ type: 'reply', id, result: { status: 'failure', message: 'the SPICE renderer stopped unexpectedly' }, discard: true })
        );
      }
    }
  };
  scope.postMessage({ type: 'started' });
}, () => {
  // The error would name bundle internals; the reason stays plain and path-free.
  scope.postMessage({ type: 'failed', reason: 'the SPICE layout engine could not start' });
});
