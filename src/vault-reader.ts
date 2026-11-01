/**
 * The renderer's `FileReader` over Obsidian's vault API: files a note's fences name are read with
 * `vault.readBinary`, never with Node's `fs`, so only files in this vault can be read. The wording
 * of every refusal is the renderer's `nodeFileReader`'s, and none reveals a path. This file is
 * identical in gnuplot-plot-preview and spice-schematic-preview.
 *
 * Keys are relative to the note's folder and resolved here, POSIX style, against the vault root;
 * a key that would climb above it is refused unread. Files in hidden (dot) folders are not in
 * Obsidian's index, so they are "not found".
 */

/** The renderer's `FileReader` (`@reonarudo/gnuplot-renderer`, `@reonarudo/spice-renderer`). */
export interface FileReader {
  read(key: string, options: { maxBytes: number }): Promise<{ bytes: Uint8Array } | { error: string }>;
}

/** The slice of a vault entry this needs: a file has `stat`, a folder has `children`. */
export interface VaultEntry {
  path: string;
  stat?: { size: number };
  children?: unknown;
}

/** The slice of Obsidian's `Vault` this needs. */
export interface VaultLike {
  getAbstractFileByPath(path: string): VaultEntry | null;
  readBinary(file: never): Promise<ArrayBuffer>;
}

/**
 * The vault path `key` names, relative to `folder` (vault-relative, '' for the root), as Obsidian
 * writes paths: '/'-separated, no leading or trailing slash, NFC; '' is the vault root itself.
 * `undefined` when `key` is not a relative path inside the vault: empty, with a backslash,
 * absolute, or climbing above the root.
 */
export function resolveKey(folder: string, key: string): string | undefined {
  if (key === '' || key.includes('\\') || key.startsWith('/') || /^[A-Za-z]:/.test(key)) return undefined;
  const parts = folder.split('/').filter((part) => part !== '' && part !== '.');
  for (const part of key.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/').normalize('NFC');
}

/** The folder of a vault path, '' for a note at the vault root. */
function folderOf(notePath: string): string {
  const slash = notePath.lastIndexOf('/');
  return slash < 0 ? '' : notePath.slice(0, slash);
}

/**
 * A reader for the note at `notePath` (vault-relative). `record` receives the vault-relative path
 * of every file asked for, found or not, so a vault event for it can draw the block again.
 */
export function vaultFileReader(vault: VaultLike, notePath: string, record: (path: string) => void): FileReader {
  const folder = folderOf(notePath);
  return {
    async read(key, { maxBytes }) {
      if (typeof key !== 'string' || key.includes('\0')) return { error: 'the file name is not valid' };
      const target = resolveKey(folder, key);
      if (target === undefined) return { error: 'the file is outside this vault' };
      record(target);
      try {
        // The vault root itself ('.', 'a/..') is a folder.
        if (target === '') return { error: 'not a regular file' };
        const file = vault.getAbstractFileByPath(target);
        if (!file) return { error: 'file not found' };
        if (file.children !== undefined || !file.stat) return { error: 'not a regular file' };
        if (file.stat.size > maxBytes) return { error: `the file exceeds the ${maxBytes}-byte limit` };
        // The file may have grown since Obsidian last measured it.
        const buffer = await vault.readBinary(file as never);
        if (buffer.byteLength > maxBytes) return { error: `the file exceeds the ${maxBytes}-byte limit` };
        return { bytes: new Uint8Array(buffer.slice(0)) };
      } catch {
        return { error: 'the file could not be read' };
      }
    }
  };
}
