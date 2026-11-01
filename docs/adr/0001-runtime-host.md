# 0001: Render in a browser Worker built from the renderer's worker code, and prepare there too

Status: accepted, 2026-10-31.

## Context

spice-renderer is a Node library. `createRuntime()` starts a `node:worker_threads` Worker and
`render()` blocks on it with `Atomics.wait`; `prepare(source, { reader, dialect, limits })`
runs in the calling thread, loads the dialect's parser there, follows `.include`, `.inc` and
`.lib` up to 8 levels through a `FileReader`, and names the result with a sha256 `identity`.
The VS Code extension calls both from the extension host. An Obsidian plugin runs on the
window's main thread of Electron's renderer process.

The pikchr pilot's spike (`pikchr-diagram-preview/docs/spike-worker-threads.md`) measured, in
Obsidian 1.14.4 (Electron 43.7.7, Node 24.21.0), that `worker_threads` loads but cannot create a
Worker, that `ELECTRON_RUN_AS_NODE` is fused off, and that a browser `Worker` started from a
blob URL runs an esbuild bundle of a renderer's worker code. That decided the runtime for all
the plugins: the plugin builds the worker bundle, embeds it in `main.js`, and talks to it by
`postMessage`. This ADR records how that applies to spice-renderer, whose worker is the
heaviest, and where `prepare` runs.

What does not bundle as written in spice-renderer 1.0.0:

- `dist/worker.js` reads `dist/skin/symbols.svg` with `readFileSync`, loads ELK through
  `createRequire`, and loads parsers through `parserLoader(directory)` in
  `dist/parser/modules.js`, which `require`s `<directory>/<dialect>.cjs` by computed path.
- The seven parsers (`vendor/parsers/*.cjs`, about 100 KB each) are Emscripten builds
  (`SINGLE_FILE`, `ENVIRONMENT=node`, `WASM_ASYNC_COMPILATION=0`) that read `__dirname`,
  `__filename` and `process.argv` at load and reach `fs` and `crypto` only on dead paths.
- `dist/prepare.js` hashes with `node:crypto`'s synchronous `createHash`, computes its parser
  folder with `node:url` at load, and `dist/include-paths.js` resolves keys with `node:path`'s
  `posix`.
- ELK's bundled build, loaded inside a browser worker (a `self`, no `document`), decides it is
  ELK's own web worker: it takes over `self.onmessage` and exports no in-thread worker, so
  `new ELK()` throws.

## Decision

1. `src/worker/entry.ts` ports `dist/worker.js`: the same symbols, warm-up netlist, parser
   loading, `renderNetlist`, column shift and output limit, answering by message. Everything
   else is imported unchanged from the installed package; nothing in it is edited.
2. `scripts/worker-bundle.mjs` substitutes what does not bundle, without touching the
   renderer's parsing or drawing:
   - `dist/parser/modules.js` is replaced by `src/worker/parser-modules.ts`, the same loader
     (one load per module, outcomes kept, Spectre loading both of its languages, the same
     messages) over a static map of the seven modules, handed to the renderer's own registry;
   - `symbols.svg` is embedded with esbuild's text loader;
   - `elkjs/lib/elk.bundled.js` is imported directly; for its one first load a `document` is
     made to exist so it takes the path it takes under Node (in-thread layout), then removed;
   - `node:fs`, `node:crypto`, `node:path`, `node:url` are aliased to small stubs: a throwing
     `readFileSync`; SHA-256 in plain code (Web Crypto's digest is asynchronous); Node's own
     posix `normalize`/`join`/`dirname` algorithms; a `fileURLToPath`. `test/stubs.test.ts`
     compares the hash and the path functions with Node's. `process`, `__dirname` and
     `__filename` are injected as in the pilot.
3. `prepare` runs in the worker (option (a)). The worker's `FileReader` asks the plugin for
   each file by message (`read` → `file`, bytes transferred), and the plugin answers with the
   library's `nodeFileReader({ root: <vault folder>, document: <note's absolute path> })` on
   the main thread, keeping its containment, symlink, size and changed-while-read checks. Its
   "the file is outside the content root" is reworded "it is outside this vault".
4. `src/host.ts` ports `createRuntime` with the library's options, defaults (3 s layout,
   10 s start-up, 64 000 characters, 4 MiB output), input check (`isPrepared`), wording and
   recovery, and adds `prepare` to the same queue with its own 10 s budget. One worker; jobs run
   one at a time.

### Why prepare runs in the worker

- The parsers are bundled once. The alternative, (b), runs `prepare` on the main thread from
  a `main.js` built for Node with the built-ins external, and bundles the parsers into
  `main.js` a second time: measured with the same substitution, that adds 725 617 bytes
  (246 936 gzipped) to `main.js` on top of the worker's copy.
- Instantiating a parser (synchronous wasm compile of about 70 KB) and parsing large model
  libraries (up to 16 MiB per fence) would run on Obsidian's UI thread under (b); in the worker
  they cannot stall typing or scrolling, and a parser that hangs is stopped by the budget.
- The identity is the library's: `test/worker.test.ts` checks that the worker's prepared input
  equals Node's `prepare` for the same fence, dialect and files.
- The cost is a message round trip per included file, negligible next to the layout.

## Consequences

- `main.js` is the whole plugin with `manifest.json` and `styles.css`: 2 475 019 bytes
  (756 499 gzipped), of which the embedded worker is 2 336 205 bytes (740 154 gzipped): ELK's
  bundled build (1.6 MB), the seven parsers (0.7 MB), the reader, drawing and xmldom. Nothing
  is downloaded, written or extracted. The main thread `require`s only `fs`, `fs/promises` and
  `path` (for the library's file reader), which Obsidian's desktop renderer provides.
- A browser Worker has no heap cap like `resourceLimits`; a runaway layout is stopped only by
  the time limit.
- `src/worker/entry.ts` and `src/worker/parser-modules.ts` must be kept in step with the
  renderer's `worker.ts` and `parser/modules.ts`; `test/worker.test.ts` runs the embedded
  bundle against every dialect, includes, errors and timeouts. The ELK `document` shim depends
  on how elkjs 0.12 detects its environment.
- `isDesktopOnly` stays `true`: reading included files needs the vault's folder on disk.
