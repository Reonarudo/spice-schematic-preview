import type { FileReader, Prepared, RenderResult } from '@reonarudo/spice-renderer';
import { DIALECT_NAMES } from '#renderer/dist/dialect.js';
import type { FileAnswer, PreparedReply, ReadRequest, Reply, Request, Started, WorkerMessage } from './protocol';

/**
 * The render host: spice-renderer's `createRuntime`, ported from a blocking Node worker to an
 * asynchronous browser Worker (docs/adr/0001-runtime-host.md). Options, limits, defaults, input
 * checks and the wording of every result are the library's; what changed is that `render`
 * returns a promise, the worker answers by message, and the worker also runs `prepare`, reading
 * included files through a FileReader that stays on this side.
 */

/** What the host needs from a worker; a browser `Worker` satisfies it, and so does the test adapter. */
export interface WorkerLike {
  onmessage: ((event: { data: WorkerMessage }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: Request, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface HostOptions {
  /** Milliseconds per layout; default 3000. */
  timeout?: number;
  /** Milliseconds per engine start; default 10000. */
  startupTimeout?: number;
  /** Milliseconds to prepare one fence, its included files read; default 10000. */
  prepareTimeout?: number;
  limits?: {
    /** Whole fence body, in string length; default 64000. */
    sourceChars?: number;
    /** Success output, in UTF-8 bytes; default 4 MiB. */
    outputBytes?: number;
  };
}

/** What preparing a fence gives: the render input, or the result to show instead. */
export type PrepareOutcome = { status: 'prepared'; prepared: Prepared } | Exclude<RenderResult, { status: 'success' }>;

export interface Host {
  /** The library's `prepare` in the worker; `reader` serves its file requests. Queued with renders. */
  prepare(source: string, dialect: string, reader: FileReader): Promise<PrepareOutcome>;
  /** Renders are queued and run one at a time on one worker. */
  render(input: Prepared): Promise<RenderResult>;
  /** Stops the worker; a job still waiting settles as unavailable. */
  dispose(): void;
}

/** A host-wide option: absent for its default, else a finite positive number. */
function option(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a finite positive number`);
  }
  return value;
}

/** Whether a value has the shape `prepare` gives, so the worker is never handed anything else. The library's check. */
function isPrepared(input: unknown): input is Prepared {
  if (typeof input !== 'object' || input === null) return false;
  const { source, dialect, files, identity, failure } = input as Record<string, unknown>;
  return typeof source === 'string' && typeof dialect === 'string' && (DIALECT_NAMES as readonly string[]).includes(dialect) &&
    typeof identity === 'string' && /^[0-9a-f]{64}$/.test(identity) &&
    (failure === undefined || (typeof failure === 'object' && failure !== null &&
      typeof (failure as { message?: unknown }).message === 'string')) &&
    Array.isArray(files) && files.every((file: unknown) => {
      const { key, text, error } = (file ?? {}) as Record<string, unknown>;
      return typeof key === 'string' && (typeof text === 'string') !== (typeof error === 'string');
    }) && new Set(files.map((file: { key: string }) => file.key)).size === files.length;
}

type Answer = Reply | PreparedReply;

interface Engine {
  worker: WorkerLike;
  started: Promise<Started>;
  /** Settle `started` now; a later answer from the worker is ignored. */
  abandon(): void;
  pending: Map<number, (answer: Answer | undefined) => void>;
  readers: Map<number, FileReader>;
}

const STOPPED = { status: 'unavailable', reason: 'the renderer was stopped' } as const;

export function createHost(spawnWorker: () => WorkerLike, options: HostOptions = {}): Host {
  const timeout = option(options.timeout, 'timeout', 3000);
  const startupTimeout = option(options.startupTimeout, 'startupTimeout', 10000);
  const prepareTimeout = option(options.prepareTimeout, 'prepareTimeout', 10000);
  const sourceChars = option(options.limits?.sourceChars, 'limits.sourceChars', 64000);
  const outputBytes = option(options.limits?.outputBytes, 'limits.outputBytes', 4 * 1024 * 1024);

  let current: Engine | undefined;
  let disposed = false;
  let nextId = 0;
  let queue: Promise<unknown> = Promise.resolve();

  /** Serve one of the worker's file requests through the reader of the prepare request that made it. */
  const serve = (engine: Engine, request: ReadRequest): void => {
    const reader = engine.readers.get(request.id);
    const answer = (result: FileAnswer['result']): void => {
      if (current !== engine) return;
      const message: FileAnswer = { type: 'file', id: request.id, read: request.read, result };
      engine.worker.postMessage(message, 'bytes' in result ? [result.bytes.buffer as ArrayBuffer] : []);
    };
    if (!reader) {
      answer({ error: 'the file reader failed' });
      return;
    }
    // The library's own `load` turns a rejection into this reason; the reader is called the same way.
    Promise.resolve()
      .then(() => reader.read(request.key, { maxBytes: request.maxBytes }))
      .then((result) => {
        if (result && typeof result === 'object' && 'bytes' in result && result.bytes instanceof Uint8Array) {
          // A copy, so the transfer never detaches a buffer the reader still holds.
          answer({ bytes: result.bytes.slice() });
        } else if (result && typeof result === 'object' && 'error' in result) {
          answer({ error: typeof result.error === 'string' ? result.error : 'unreadable' });
        } else {
          answer({ error: 'the file reader returned no bytes' });
        }
      }, () => answer({ error: 'the file reader failed' }));
  };

  const spawn = (): Engine => {
    const worker = spawnWorker();
    const pending = new Map<number, (answer: Answer | undefined) => void>();
    const engine: Engine = { worker, started: Promise.resolve({ type: 'started' }), abandon: () => {}, pending, readers: new Map() };
    engine.started = new Promise<Started>((resolve) => {
      engine.abandon = () => {
        clearTimeout(timer);
        resolve({ type: 'failed', reason: 'the renderer was stopped' });
      };
      const timer = setTimeout(
        () => resolve({ type: 'failed', reason: `the SPICE layout worker did not start within ${startupTimeout} ms` }),
        startupTimeout
      );
      worker.onmessage = ({ data }) => {
        if (data.type === 'reply' || data.type === 'prepared') {
          pending.get(data.id)?.(data);
          return;
        }
        if (data.type === 'read') {
          serve(engine, data);
          return;
        }
        clearTimeout(timer);
        resolve(data);
      };
    });
    // A crash surfaces to the waiting job as a timeout, as in the library.
    worker.onerror = () => {};
    current = engine;
    return engine;
  };

  /** Terminate this engine; jobs still waiting on it settle as unavailable. */
  const stop = (engine: Engine): void => {
    // A job still waiting for this engine to start is not kept waiting for the start-up limit.
    engine.abandon();
    engine.worker.terminate();
    for (const settle of engine.pending.values()) settle(undefined);
    engine.pending.clear();
    engine.readers.clear();
    if (current === engine) current = undefined;
  };

  type Outcome<T> = { engine: Engine; answer: T } | Exclude<RenderResult, { status: 'success' | 'failure' }>;

  /** Send one request to a started engine and wait for its answer, at most `budget` ms. */
  const exchange = async <T extends Answer>(
    budget: number,
    send: (engine: Engine, id: number) => void
  ): Promise<Outcome<T>> => {
    if (disposed) return STOPPED;
    const engine = current ?? spawn();
    const started = await engine.started;
    if (disposed) return STOPPED;
    if (started.type === 'failed') {
      stop(engine);
      return { status: 'unavailable', reason: started.reason };
    }
    const id = ++nextId;
    let timedOut = false;
    const answer = await new Promise<Answer | undefined>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        engine.pending.delete(id);
        resolve(undefined);
      }, budget);
      engine.pending.set(id, (reply) => {
        clearTimeout(timer);
        engine.pending.delete(id);
        resolve(reply);
      });
      send(engine, id);
    });
    engine.readers.delete(id);
    if (timedOut) {
      stop(engine);
      return { status: 'timeout', budget };
    }
    if (!answer) return STOPPED;
    return { engine, answer: answer as T };
  };

  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const result = queue.then(job);
    queue = result.catch(() => {});
    return result;
  };

  // Start the first engine now, so the first fence does not wait for ELK to load.
  spawn();

  return {
    prepare(source, dialect, reader) {
      if (typeof source !== 'string') throw new TypeError('prepare() takes the fence body as a string');
      if (typeof dialect !== 'string') throw new TypeError('dialect must be a string');
      if (typeof reader?.read !== 'function') throw new TypeError('reader must have a read() method');
      return enqueue(async (): Promise<PrepareOutcome> => {
        const outcome = await exchange<PreparedReply>(prepareTimeout, (engine, id) => {
          engine.readers.set(id, reader);
          engine.worker.postMessage({ type: 'prepare', id, source, dialect });
        });
        if (!('answer' in outcome)) {
          return outcome.status === 'timeout'
            ? { status: 'failure', message: `Reading the netlist and its included files took longer than ${outcome.budget / 1000} s.` }
            : outcome;
        }
        const { answer } = outcome;
        return 'error' in answer ? { status: 'failure', message: answer.error } : { status: 'prepared', prepared: answer.prepared };
      });
    },
    render(input) {
      if (!isPrepared(input)) throw new TypeError('render() takes what prepare() returned for the fence');
      const { source } = input;
      if (source.length > sourceChars) {
        return Promise.resolve({ status: 'failure', message: `SPICE source exceeds the ${sourceChars}-character limit` });
      }
      if (input.failure) return Promise.resolve({ status: 'failure', ...input.failure });
      const files = input.files.map((file) => ('text' in file ? { key: file.key, text: file.text } : { key: file.key, error: file.error }));
      return enqueue(async (): Promise<RenderResult> => {
        const outcome = await exchange<Reply>(timeout, (engine, id) => {
          engine.worker.postMessage({ type: 'render', id, source, dialect: input.dialect, files, outputBytes });
        });
        if (!('answer' in outcome)) return outcome;
        if (outcome.answer.discard) stop(outcome.engine);
        return outcome.answer.result;
      });
    },
    dispose() {
      disposed = true;
      if (current) stop(current);
    }
  };
}
