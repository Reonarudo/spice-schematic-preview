// Loaded before every test file (package.json `test`): the host uses `window.setTimeout`, as an
// Obsidian plugin should, so under Node `window` is the global object; and `obsidian`, which
// ships typings only, resolves to test/obsidian-stub.mjs.
import { register } from 'node:module';

(globalThis as { window?: unknown }).window ??= globalThis;
register('./obsidian-loader.mjs', import.meta.url);
