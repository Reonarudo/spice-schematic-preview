import { BASE_CLASS, isView, type View } from './fence';

/**
 * The view toggle's memory: which fences of a note the reader left in source view or BOM view.
 * The pure core (`match`, `collect`, `storageKey`, `load`, `save`) is spice-markdown-preview's
 * media/preview.js, unchanged apart from types; only the storage moved, from the preview's
 * `localStorage` to this plugin's data file.
 *
 * A flipped fence is an entry { key, ordinal, index, view }: its fence key, its ordinal among the
 * fences sharing that key, its index among all of the note's spice fences, in document order, and
 * the view it was left in. An entry written by 0.1 has no view: it is a source flip.
 */
export interface Entry {
  key: string;
  ordinal: number;
  index: number;
  view: View;
}

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The views to show, by position: the key's group at `ordinal` if the key is present, else `index`. A later entry for the same position wins. */
export function match(entries: Entry[], keys: string[]): Map<number, View> {
  const groups = new Map<string, number[]>();
  keys.forEach((key, position) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(position);
  });
  const views = new Map<number, View>();
  for (const entry of entries) {
    const group = groups.get(entry.key);
    const target = group ? group[entry.ordinal] : (entry.index < keys.length ? entry.index : undefined);
    if (target !== undefined) views.set(target, entry.view);
  }
  return views;
}

/** The entries describing the flipped positions, recomputed from the document so they only ever name real fences. */
export function collect(keys: string[], views: ReadonlyMap<number, View>): Entry[] {
  const seen = new Map<string, number>();
  const entries: Entry[] = [];
  keys.forEach((key, index) => {
    const ordinal = seen.get(key) || 0;
    seen.set(key, ordinal + 1);
    const view = views.get(index);
    if (view !== undefined) entries.push({ key, ordinal, index, view });
  });
  return entries;
}

export function storageKey(base: string, uri: string): string {
  return `${base}-markdown-preview.view-toggle:${uri}`;
}

/** The stored entries, normalised: a 0.1 entry without a view is a source flip; anything else malformed is dropped. None when storage is unavailable. */
export function load(storage: Storage, key: string): Entry[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry: unknown): Entry[] => {
      const { key, ordinal, index, view = 'source' } = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      if (typeof key !== 'string' || typeof ordinal !== 'number' || typeof index !== 'number') return [];
      return isView(view) ? [{ key, ordinal, index, view }] : [];
    });
  } catch {
    return [];
  }
}

/** Mirror the entries to storage; the key is removed when nothing is flipped. A storage that throws is memory-only. */
export function save(storage: Storage, key: string, entries: Entry[]): void {
  try {
    if (entries.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(entries));
  } catch {
    // Memory-only: the flip still holds for this rendering, not a reload.
  }
}

/** Saved toggles: note path to entries, as kept in the plugin's data file. */
export type Toggles = Record<string, Entry[]>;

/** The toggles of every note, over the plugin's data; `changed` is called after each write. */
export class ToggleStore {
  private readonly record: Toggles;
  private readonly storage: Storage;
  private readonly changed: () => void;

  constructor(initial: unknown, changed: () => void) {
    // No prototype: a note may be called `__proto__` or `constructor`.
    const record: Toggles = Object.create(null) as Toggles;
    if (initial && typeof initial === 'object' && !Array.isArray(initial)) {
      for (const [path, entries] of Object.entries(initial)) if (Array.isArray(entries)) record[path] = entries as Entry[];
    }
    this.record = record;
    const prefix = storageKey(BASE_CLASS, '');
    const path = (key: string) => key.slice(prefix.length);
    this.storage = {
      getItem: (key) => Object.hasOwn(record, path(key)) ? JSON.stringify(record[path(key)]) : null,
      setItem: (key, value) => {
        record[path(key)] = JSON.parse(value) as Entry[];
        changed();
      },
      removeItem: (key) => {
        if (!Object.hasOwn(record, path(key))) return;
        delete record[path(key)];
        changed();
      }
    };
    this.changed = changed;
  }

  /** The view the fence at `index` among the note's `keys` was left in; `undefined` for its rendering. */
  viewOf(notePath: string, keys: string[], index: number): View | undefined {
    return match(load(this.storage, storageKey(BASE_CLASS, notePath)), keys).get(index);
  }

  /**
   * Remember the fence at `index` in `view`, or in its rendering when `view` is undefined,
   * re-keying the note's entries to its current fences. A note's 0.1 entries are rewritten with a
   * view on its first save.
   */
  set(notePath: string, keys: string[], index: number, view: View | undefined): void {
    const key = storageKey(BASE_CLASS, notePath);
    const views = match(load(this.storage, key), keys);
    if (view) views.set(index, view);
    else views.delete(index);
    save(this.storage, key, collect(keys, views));
  }

  /** Forget every flip in a note, to source and to BOM view alike. */
  clear(notePath: string): void {
    save(this.storage, storageKey(BASE_CLASS, notePath), []);
  }

  /** Follow a note to its new path. */
  rename(oldPath: string, newPath: string): void {
    if (!Object.hasOwn(this.record, oldPath)) return;
    this.record[newPath] = this.record[oldPath]!;
    delete this.record[oldPath];
    this.changed();
  }

  /** The data to persist. */
  toJSON(): Toggles {
    return this.record;
  }
}
