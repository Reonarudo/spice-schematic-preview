# Developing SPICE Schematic Preview

How the plugin works inside, and how to build, test and release it. For using the plugin, see
[README.md](README.md).

## How it renders

Rendering runs in a Web Worker inside Obsidian, built from spice-renderer: the seven dialect
parsers compiled to WebAssembly, the Eclipse Layout Kernel (elkjs) and the SVG drawing. The
library's `prepare` step runs in the same worker; the files it asks for are read on the main
thread through Obsidian's vault API (`src/vault-reader.ts`); `main.js` uses no Node module. Nothing is downloaded,
installed or written to disk; the worker is embedded in `main.js` (about 2.5 MB, 0.76 MB
gzipped).

The worker starts with the first schematic drawn, so a vault without spice blocks never loads ELK
or the parsers; included files are watched from the start. Schematics also draw in embedded notes,
hover previews, Canvas cards and exported PDFs (in light colours). Settings appear in Obsidian's
settings search, the dialect as a dropdown. On an Obsidian whose built-in
Chromium predates `light-dark()`, schematics keep the white card in dark themes.

The BOM view's rows come from spice-renderer (1.1.0), beside the schematic. The library's own
worker writes them to its shared buffer before layout, so a timed-out render keeps them; this
plugin's worker posts them instead, as an interim `{ type: 'parsed', id, bom, notes }` message
before layout, and `src/host.ts` joins it to the `timeout` it reports when the layout overruns,
and to a `failure` that lacks it (docs/adr/0001-runtime-host.md). The specification is
spice-markdown-preview's `docs/bom-view-spec.md`; section 10 holds this plugin's differences.

Desktop only for now.

## Development

Requires Node 22 or newer (see `.nvmrc`).

~~~sh
npm ci
npm run lint        # tsc --noEmit
npm test            # node --test: attributes, toggle, scanner, DOM and BOM table, caches, includes, host, settings, stubs, and the real worker bundle
npm run build       # main.js, with the worker bundle embedded
npm run vault       # link this repo into ../test-vault as an enabled plugin, examples in spice/
npm run test:live   # a real Obsidian with a throwaway profile and vault, driven over CDP
~~~

`npm run test:live` needs Obsidian installed (`OBSIDIAN_EXECUTABLE` overrides the path); it
prints where it saved light and dark screenshots. Its fixtures are `examples/view-toggle.md`,
which includes `examples/models/opamp.inc`, and `examples/bom-view.md`, which includes
`examples/included/stage.cir`; before the vault opens it writes a data file as 0.1 wrote it, to
check the migration. The hover-preview and Live Preview checks depend on Obsidian's timing and
fail now and then; run it again before suspecting the plugin.

The renderer is pinned to a release tarball in `package.json` (`.npmrc` sets
`allow-remote=root` for npm 12). To take a new release, edit the URL, run `npm install`, check
`src/worker/entry.ts` against the release's `src/worker.ts` and `src/worker/parser-modules.ts`
against its `src/parser/modules.ts`, and run the tests.


## Releasing

Push a version tag (`x.y.z`, equal to the version in `manifest.json`). The release workflow in
`.github/workflows/release.yml` checks, tests and builds that commit, attests `main.js`,
`manifest.json` and `styles.css`, and publishes them as the release.
