/**
 * Prepare `spice` fences: read the netlist in its dialect and load the files its `.include` and
 * `.lib` cards name, through the renderer's `prepare` (run in the render worker, ADR 0001), and
 * keep the outcome. The port of spice-markdown-preview's include-files.ts.
 *
 * Obsidian's rules decide whether files may be read at all: only from a vault on this computer,
 * only for a note in it. Reading itself (paths relative to the note that stay inside the vault,
 * never through a symlink, never over the size limits, never a file that changes mid-read) is
 * the renderer's `nodeFileReader`, rooted at the vault's folder, on the main thread. Errors never
 * reveal an absolute path.
 */
import { posix } from 'node:path';
import type { FileReader, NodeFileReaderOptions } from '@reonarudo/spice-renderer';
import type { PrepareOutcome } from './host';

interface Entry {
  readonly note: string;
  /** Vault paths of every file the reader was asked for, found or not, so a vault event can invalidate the entry. */
  readonly paths: Set<string>;
  bytes: number;
  readonly outcome: Promise<PrepareOutcome>;
}

/** All prepared fences' included files together may be this large: vendor model libraries run to megabytes. */
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 512;

const FULL = 'The included files of open documents exceed the 64 MiB cache. ' +
  'Close unused Markdown documents and run SPICE Schematic Preview: Refresh included files.';

/** A reader that refuses every file with one reason; netlists that include nothing never call it. */
export const refuse = (error: string): FileReader => ({ read: async () => ({ error }) });

/** Where the vault is, for the library's reader; `undefined` when it is not a folder on this computer. */
export interface Vault {
  /** Absolute path of the vault's folder. */
  basePath(): string | undefined;
  /** Absolute path of a vault path. */
  fullPath(path: string): string;
}

/**
 * The Obsidian file reader adapter: the vault rules first, then the library's reader rooted at the
 * vault's folder. `record` hears the vault path of every file asked for.
 */
export function readerFor(
  nodeFileReader: (options: NodeFileReaderOptions) => FileReader,
  vault: Vault,
  note: string,
  record: (path: string) => void
): FileReader {
  const root = vault.basePath();
  if (root === undefined) return refuse('files are read only from a local folder');
  if (!note) return refuse('the note is not in this vault');
  const reader = nodeFileReader({ root, document: vault.fullPath(note) });
  return {
    async read(key, options) {
      record(posix.join(posix.dirname(note), key));
      const result = await reader.read(key, options);
      // The library's wording is about a site's content root; here the root is the vault.
      return 'error' in result && result.error === 'the file is outside the content root'
        ? { error: 'it is outside this vault' }
        : result;
    }
  };
}

/** Prepare one fence: the host's `prepare`, with the reader that serves it. */
export type Prepare = (source: string, dialect: string, reader: FileReader) => Promise<PrepareOutcome>;

/**
 * Prepared render inputs per note, dialect and fence body. Preparing the same fence again while
 * it is pending shares the first preparation. Only prepared inputs and the cache-full message are
 * kept; an unavailable or timed-out worker is asked again next time.
 */
export class IncludeFiles {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;

  constructor(
    private readonly prepareFence: Prepare,
    private readonly reader: (note: string, record: (path: string) => void) => FileReader
  ) {}

  /** The cache key of a fence in `note` read in `dialect`. */
  static key(note: string, dialect: string, source: string): string {
    return JSON.stringify([note, dialect, source]);
  }

  /** The render input for a fence in `note` read in `dialect`, or the result to show instead. */
  prepare(note: string, source: string, dialect: string): Promise<PrepareOutcome> {
    const key = IncludeFiles.key(note, dialect, source);
    const found = this.entries.get(key);
    if (found) {
      // Re-insert so Map order tracks recency and the first key is the least recently used.
      this.entries.delete(key);
      this.entries.set(key, found);
      return found.outcome;
    }
    if (this.entries.size >= MAX_ENTRIES) this.remove(this.entries.keys().next().value!);

    const paths = new Set<string>();
    const settle = async (): Promise<PrepareOutcome> => {
      let outcome: PrepareOutcome;
      try {
        outcome = await this.prepareFence(source, dialect, this.reader(note, (path) => paths.add(path)));
      } catch (error) {
        // `prepare` throws only for programmer errors; this fence alone shows it.
        outcome = { status: 'failure', message: error instanceof Error ? error.message : 'The netlist could not be prepared.' };
      }
      // Invalidated or cleared while pending: the caller gets this outcome, the cache does not.
      if (this.entries.get(key) !== entry) return outcome;
      if (outcome.status !== 'prepared') {
        if (outcome.status !== 'failure') this.entries.delete(key);
        return outcome;
      }
      const bytes = outcome.prepared.files.reduce((sum, file) => sum + ('text' in file ? file.text.length : 0), 0);
      if (this.bytes + bytes > MAX_CACHE_BYTES) return { status: 'failure', message: FULL };
      entry.bytes = bytes;
      this.bytes += bytes;
      return outcome;
    };
    const entry: Entry = { note, paths, bytes: 0, outcome: Promise.resolve().then(settle) };
    this.entries.set(key, entry);
    return entry.outcome;
  }

  /** Forget every prepared fence, so included files are read again. */
  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  /**
   * Forget the fences that read the file at vault path `path`, or anything under a folder there,
   * and return their keys so the blocks showing them can be drawn again.
   */
  invalidate(path: string): string[] {
    const removed: string[] = [];
    for (const [key, entry] of this.entries) {
      if ([...entry.paths].some((read) => read === path || read.startsWith(path + '/'))) {
        this.remove(key);
        removed.push(key);
      }
    }
    return removed;
  }

  /** Forget the fences of a note that is gone. */
  forget(note: string): void {
    for (const [key, entry] of this.entries) if (entry.note === note) this.remove(key);
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      this.bytes -= entry.bytes;
      this.entries.delete(key);
    }
  }
}
