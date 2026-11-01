// An in-memory vault with the slice of Obsidian's Vault the vault reader uses.
import { TFile, TFolder, type Vault } from 'obsidian';

export interface FakeVault {
  vault: Vault;
  files: Map<string, string | Uint8Array>;
  reads: string[];
  /** Called before each read finishes, so a test can hold a read or change the file under it. */
  beforeRead?: (path: string) => Promise<void> | void;
  failReads?: boolean;
}

export function fakeVault(initial: Record<string, string | Uint8Array> = {}): FakeVault {
  const fake: FakeVault = { vault: undefined as unknown as Vault, files: new Map(Object.entries(initial)), reads: [] };
  const bytes = (content: string | Uint8Array) => typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const sizes = new Map<string, number>();
  fake.vault = {
    getAbstractFileByPath(path: string) {
      const content = fake.files.get(path);
      if (content !== undefined) {
        // What Obsidian last measured; a test may grow the file after this.
        sizes.set(path, bytes(content).length);
        return new (TFile as unknown as new (path: string, stat: object) => TFile)(path, { size: bytes(content).length, mtime: 0, ctime: 0 });
      }
      if ([...fake.files.keys()].some((key) => key.startsWith(path + '/'))) return new (TFolder as unknown as new (path: string) => TFolder)(path);
      return null;
    },
    async readBinary(file: TFile) {
      fake.reads.push(file.path);
      await fake.beforeRead?.(file.path);
      if (fake.failReads) throw new Error(`EACCES: /Users/someone/vault/${file.path}`);
      const content = fake.files.get(file.path);
      if (content === undefined) throw new Error('ENOENT');
      const data = bytes(content);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    }
  } as unknown as Vault;
  return fake;
}
