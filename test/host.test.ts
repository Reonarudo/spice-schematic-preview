// The host's behaviour against scripted workers: start-up, timeouts, a discarded engine, the
// queue, limits, input checks, dispose, and the file requests a prepare makes. The real worker is
// exercised in worker.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FileReader, Prepared, RenderResult } from '@reonarudo/spice-renderer';
import { createHost, type WorkerLike } from '../src/host';
import type { FileAnswer, Request, WorkerMessage } from '../src/protocol';

type Answer = { result: RenderResult; discard?: true } | 'hang';
interface Script {
  start?: 'ok' | 'fail' | 'silent';
  answer?: (source: string) => Answer;
  /** Files a prepare request asks for, in order; the prepared input lists what came back. */
  reads?: string[];
}

const prepared = (source: string, extra: Partial<Prepared> = {}): Prepared =>
  ({ source, dialect: 'ngspice', files: [], identity: 'a'.repeat(64), ...extra });

/** Workers that start and answer as scripted, recording what they were asked and whether they were stopped. */
function workers(script: Script = {}) {
  const spawned: { requests: Request[]; transfers: number; terminated: boolean }[] = [];
  const spawn = (): WorkerLike => {
    const record = { requests: [] as Request[], transfers: 0, terminated: false };
    spawned.push(record);
    const answers = new Map<number, (answer: FileAnswer['result']) => void>();
    const later = (message: WorkerMessage) => setTimeout(() => { if (!record.terminated) send(message); }, 1);
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage(request, transfer) {
        record.requests.push(request);
        record.transfers += transfer?.length ?? 0;
        if (request.type === 'file') {
          answers.get(request.read)?.(request.result);
          return;
        }
        if (request.type === 'prepare') {
          const { id, source, dialect } = request;
          void (async () => {
            const files = [];
            for (const [index, key] of (script.reads ?? []).entries()) {
              const result = await new Promise<FileAnswer['result']>((resolve) => {
                answers.set(index, resolve);
                later({ type: 'read', id, read: index, key, maxBytes: 100 });
              });
              files.push('bytes' in result ? { key, text: new TextDecoder().decode(result.bytes) } : { key, error: result.error });
            }
            if (source === 'throw') later({ type: 'prepared', id, error: 'limits.files must be a finite positive number' });
            else if (source === 'hang') return;
            else later({ type: 'prepared', id, prepared: { ...prepared(source), dialect: dialect as Prepared['dialect'], files } });
          })();
          return;
        }
        const answer = (script.answer ?? ((source) => ({ result: { status: 'success', output: `<svg>${source}</svg>`, notes: [] } })))(request.source);
        if (answer === 'hang') return;
        later({ type: 'reply', id: request.id, ...answer });
      },
      terminate() { record.terminated = true; }
    };
    const send = (message: WorkerMessage) => worker.onmessage?.({ data: message });
    const start = script.start ?? 'ok';
    if (start !== 'silent') setTimeout(() => send(start === 'ok' ? { type: 'started' } : { type: 'failed', reason: 'the SPICE layout engine could not start' }), 1);
    return worker;
  };
  return { spawn, spawned };
}

const reader = (files: Record<string, string>): FileReader => ({
  read: async (key) => key in files ? { bytes: new TextEncoder().encode(files[key]) } : { error: 'file not found' }
});

test('renders through the worker, starting one engine eagerly', async () => {
  const { spawn, spawned } = workers();
  const host = createHost(spawn);
  assert.equal(spawned.length, 1);
  assert.deepEqual(await host.render(prepared('R1 a 0 1')), { status: 'success', output: '<svg>R1 a 0 1</svg>', notes: [] });
  const request = spawned[0]!.requests[0]!;
  assert.equal(request.type === 'render' && request.outputBytes, 4 * 1024 * 1024);
  host.dispose();
});

test('a prepare runs in the worker, and its file requests are served by the reader on this side', async () => {
  const { spawn, spawned } = workers({ reads: ['models/q.lib', 'missing.lib'] });
  const host = createHost(spawn);
  const outcome = await host.prepare('.include models/q.lib', 'ltspice', reader({ 'models/q.lib': '.model Q PNP' }));
  assert.equal(outcome.status, 'prepared');
  if (outcome.status !== 'prepared') return;
  assert.equal(outcome.prepared.dialect, 'ltspice');
  assert.deepEqual(outcome.prepared.files, [{ key: 'models/q.lib', text: '.model Q PNP' }, { key: 'missing.lib', error: 'file not found' }]);
  // The bytes are transferred, not copied.
  assert.equal(spawned[0]!.transfers, 1);
  host.dispose();
});

test('a reader that throws or answers nonsense becomes a reason, as the library\'s loader words it', async () => {
  const { spawn } = workers({ reads: ['a', 'b'] });
  const host = createHost(spawn);
  let call = 0;
  const odd: FileReader = { read: async () => { if (call++ === 0) throw new Error('/secret/path'); return null as never; } };
  const outcome = await host.prepare('x', 'ngspice', odd);
  assert.deepEqual(outcome.status === 'prepared' && outcome.prepared.files,
    [{ key: 'a', error: 'the file reader failed' }, { key: 'b', error: 'the file reader returned no bytes' }]);
  host.dispose();
});

test('a prepare that throws in the worker is a failure naming the error; one that hangs times out and stops the worker', async () => {
  const { spawn, spawned } = workers();
  const host = createHost(spawn, { prepareTimeout: 20 });
  assert.deepEqual(await host.prepare('throw', 'ngspice', reader({})), { status: 'failure', message: 'limits.files must be a finite positive number' });
  assert.deepEqual(await host.prepare('hang', 'ngspice', reader({})),
    { status: 'failure', message: 'Reading the netlist and its included files took longer than 0.02 s.' });
  assert.equal(spawned[0]!.terminated, true);
  assert.equal((await host.prepare('R1 a 0 1', 'ngspice', reader({}))).status, 'prepared');
  assert.equal(spawned.length, 2);
  host.dispose();
});

test('renders run one at a time, in order', async () => {
  let active = 0;
  let most = 0;
  const { spawn } = workers({
    answer: (source) => {
      active++;
      most = Math.max(most, active);
      setTimeout(() => { active--; }, 1);
      return { result: { status: 'success', output: source, notes: [] } };
    }
  });
  const host = createHost(spawn);
  const sources = Array.from({ length: 10 }, (_, i) => `R${i} a 0 1`);
  const results = await Promise.all(sources.map((source) => host.render(prepared(source))));
  assert.deepEqual(results.map((result) => result.status === 'success' && result.output), sources);
  assert.equal(most, 1);
  host.dispose();
});

test('a render past the budget times out, stops the worker, and the next render starts a fresh one', async () => {
  const { spawn, spawned } = workers({ answer: (source) => source === 'slow' ? 'hang' : { result: { status: 'success', output: 'ok', notes: [] } } });
  const host = createHost(spawn, { timeout: 200 });
  assert.deepEqual(await host.render(prepared('slow')), { status: 'timeout', budget: 200 });
  assert.equal(spawned[0]!.terminated, true);
  assert.equal((await host.render(prepared('fast'))).status, 'success');
  assert.equal(spawned.length, 2);
  host.dispose();
});

test('a reply marked discard is returned, and its engine is not used again', async () => {
  const { spawn, spawned } = workers({ answer: (source) => source === 'boom'
    ? { result: { status: 'failure', message: 'the SPICE renderer stopped unexpectedly' }, discard: true }
    : { result: { status: 'success', output: 'ok', notes: [] } } });
  const host = createHost(spawn);
  assert.deepEqual(await host.render(prepared('boom')), { status: 'failure', message: 'the SPICE renderer stopped unexpectedly' });
  assert.equal(spawned[0]!.terminated, true);
  assert.equal((await host.render(prepared('R1 a 0 1'))).status, 'success');
  assert.equal(spawned.length, 2);
  host.dispose();
});

test('an engine that fails or never starts makes a job unavailable, and is retried next time', async () => {
  const failing = workers({ start: 'fail' });
  const host = createHost(failing.spawn);
  assert.deepEqual(await host.render(prepared('R1 a 0 1')), { status: 'unavailable', reason: 'the SPICE layout engine could not start' });
  assert.equal(failing.spawned[0]!.terminated, true);
  assert.deepEqual(await host.prepare('R1 a 0 1', 'ngspice', reader({})), { status: 'unavailable', reason: 'the SPICE layout engine could not start' });
  assert.equal(failing.spawned.length, 2);
  host.dispose();

  const silent = workers({ start: 'silent' });
  const stuck = createHost(silent.spawn, { startupTimeout: 20 });
  assert.deepEqual(await stuck.render(prepared('R1 a 0 1')), { status: 'unavailable', reason: 'the SPICE layout worker did not start within 20 ms' });
  stuck.dispose();
});

test('the source limit and a prepared failure are answered before the worker sees the source', async () => {
  const { spawn, spawned } = workers();
  const host = createHost(spawn, { limits: { sourceChars: 5 } });
  assert.deepEqual(await host.render(prepared('R1 a 0 1k')), { status: 'failure', message: 'SPICE source exceeds the 5-character limit' });
  assert.deepEqual(await host.render(prepared('R1', { failure: { message: 'bad', line: 2 } })), { status: 'failure', message: 'bad', line: 2 });
  assert.equal(spawned[0]!.requests.length, 0);
  assert.equal((await host.render(prepared('R1'))).status, 'success');
  host.dispose();
});

test('render takes only what prepare returned', () => {
  const { spawn } = workers();
  const host = createHost(spawn);
  for (const input of [
    undefined, 'R1 a 0 1', prepared('x', { identity: 'short' }), prepared('x', { dialect: 'NGSPICE' as never }),
    prepared('x', { files: [{ key: 'a', text: 'x', error: 'y' } as never] }), prepared('x', { files: [{ key: 'a', text: '' }, { key: 'a', text: '' }] })
  ]) {
    assert.throws(() => host.render(input as Prepared), TypeError, JSON.stringify(input));
  }
  assert.throws(() => host.prepare(42 as never, 'ngspice', reader({})), TypeError);
  assert.throws(() => host.prepare('x', 'ngspice', {} as never), TypeError);
  host.dispose();
});

test('dispose stops the worker and settles jobs in flight and queued as unavailable', async () => {
  const { spawn, spawned } = workers({ answer: () => 'hang' });
  const host = createHost(spawn, { timeout: 60000 });
  const pending: Promise<unknown>[] = [host.render(prepared('a')), host.prepare('hang', 'ngspice', reader({})), host.render(prepared('b'))];
  await new Promise((resolve) => setTimeout(resolve, 10));
  host.dispose();
  const stopped = { status: 'unavailable', reason: 'the renderer was stopped' };
  assert.deepEqual(await Promise.all(pending), [stopped, stopped, stopped]);
  assert.equal(spawned[0]!.terminated, true);
  assert.deepEqual(await host.render(prepared('c')), stopped);
  assert.equal(spawned.length, 1);
});

test('options are validated as the library validates them', () => {
  const { spawn } = workers();
  for (const options of [{ timeout: 0 }, { timeout: Number.NaN }, { startupTimeout: -1 }, { prepareTimeout: 0 }, { limits: { sourceChars: Infinity } }, { limits: { outputBytes: 0 } }]) {
    assert.throws(() => createHost(spawn, options), TypeError, JSON.stringify(options));
  }
});
