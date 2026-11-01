// What the unit tests need of the `obsidian` module, which ships typings only: the file classes
// the vault reader tells apart, and `normalizePath` as obsidian.d.ts documents it. test/setup.ts
// routes `import ... from 'obsidian'` here.
export class TAbstractFile {
  constructor(path) {
    this.path = path;
  }
}

export class TFile extends TAbstractFile {
  constructor(path, stat) {
    super(path);
    this.stat = stat;
  }
}

export class TFolder extends TAbstractFile {}

export function normalizePath(path) {
  return path.replace(/[\\/]+/g, '/').replace(/^\/|\/$/g, '').replace(/[  ]/g, ' ').normalize('NFC') || '/';
}
