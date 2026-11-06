import type { BomRow, IncludedFile, Prepared, RenderResult } from '@reonarudo/spice-renderer';

/**
 * Messages between the plugin and its render worker (docs/adr/0001-runtime-host.md).
 *
 * spice-renderer's own worker answers through a SharedArrayBuffer so its host can block with
 * `Atomics.wait`. Obsidian renders code blocks asynchronously, so this worker answers with plain
 * messages instead. It also runs the library's `prepare`, whose file reader lives on the main
 * thread: the worker asks for each included file by message and waits for the bytes.
 */

/** The plugin asks for one fence to be prepared: read in its dialect, its includes loaded. */
export interface PrepareRequest {
  type: 'prepare';
  id: number;
  source: string;
  dialect: string;
}

/** The plugin's answer to one `read`: the file's bytes, or why it cannot be read. */
export interface FileAnswer {
  type: 'file';
  id: number;
  read: number;
  result: { bytes: Uint8Array } | { error: string };
}

/** The plugin asks for one prepared fence to be drawn: the library's worker request. */
export interface RenderRequest {
  type: 'render';
  id: number;
  source: string;
  dialect: Prepared['dialect'];
  files: IncludedFile[];
  outputBytes: number;
}

export type Request = PrepareRequest | FileAnswer | RenderRequest;

/** The worker's first message, once: its engine started, or why it did not. */
export type Started = { type: 'started' } | { type: 'failed'; reason: string };

/** While preparing request `id`, the worker needs the file `key` (relative to the note's folder). */
export interface ReadRequest {
  type: 'read';
  id: number;
  read: number;
  key: string;
  maxBytes: number;
}

/** The worker's answer to a prepare request; `error` only for a programmer error in `prepare`. */
export type PreparedReply =
  | { type: 'prepared'; id: number; prepared: Prepared }
  | { type: 'prepared'; id: number; error: string };

/**
 * The parsed stage of render request `id`: the BOM rows and the reader's notes, posted once the
 * netlist is read and before layout begins, so a render the host abandons as a timeout still has
 * them (docs/bom-view-spec.md section 10.2 in spice-markdown-preview).
 */
export interface Parsed extends ParsedStage {
  type: 'parsed';
  id: number;
}

/** A render's parsed stage without the message envelope: what `renderNetlist` hands `onParsed`. */
export interface ParsedStage {
  bom: BomRow[];
  notes: string[];
}

/** The worker's answer to a render request, and whether its engine must not be used again. */
export interface Reply {
  type: 'reply';
  id: number;
  result: RenderResult;
  discard?: true;
}

export type WorkerMessage = Started | ReadRequest | PreparedReply | Parsed | Reply;
