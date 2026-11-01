# Third-party notices

The plugin's own TypeScript, tests, build scripts and stylesheet are MIT licensed (see
`LICENSE`). This does not relicense what `main.js` embeds.

`main.js` embeds a Web Worker bundle built from the following, and the main-thread part
embeds the renderer's file reader and dialect list. The renderer's licence copies are in
`node_modules/@reonarudo/spice-renderer/licenses/` and its provenance in its
`THIRD_PARTY_NOTICES.md`; keep them with any redistribution.

## SPICE renderer

[spice-renderer](https://github.com/Reonarudo/spice-renderer) 1.0.0 (MIT) supplies the
netlist reader, the element catalogue, `prepare`, the file reader, the layout glue and the SVG
drawing. It carries:

- the generated dialect parsers (`vendor/parsers/*.cjs`, all seven embedded): scanners and
  parsers generated from its own MIT-licensed grammars with GNU flex 2.6.4 (skeleton under the
  flex licence, `licenses/flex-COPYING`) and GNU Bison 3.8.2 (skeleton under GPL-3.0-or-later
  with the Bison exception, which permits distributing the generated parser under any terms),
  compiled to WebAssembly with the Emscripten 6.0.9 runtime (MIT / University of
  Illinois/NCSA, `licenses/emscripten-LICENSE`);
- symbols (`dist/skin/symbols.svg`, embedded as text) and layout code adapted from
  [netlistsvg](https://github.com/nturley/netlistsvg) 1.0.2 by Neil Turley (MIT,
  `licenses/NETLISTSVG-LICENSE`).

## elkjs (Eclipse Layout Kernel)

[`elkjs`](https://www.npmjs.com/package/elkjs) 0.12.0, `lib/elk.bundled.js`, by Kiel
University and the ELK contributors, places every symbol and routes every wire. It is embedded
unmodified and used under the **Eclipse Public License 2.0** (it is dual-licensed EPL-2.0 OR
GPL-3.0-or-later); the licence text is in the renderer's `licenses/ELKJS-EPL-2.0.md` and in
`node_modules/elkjs/LICENSE.md`. Source: <https://github.com/kieler/elkjs> and
<https://github.com/eclipse/elk>.

## xmldom

[`@xmldom/xmldom`](https://github.com/xmldom/xmldom) 0.9.12 (MIT, `licenses/XMLDOM-LICENSE`),
which the renderer uses to read its symbol file and build each schematic.

## Code written for the worker bundle

`src/worker/path-stub.ts` follows the algorithms of Node.js's `lib/path.js` (MIT, copyright
Node.js contributors and Joyent, Inc.) so that include keys come out as Node computes them.
SHA-256 in `src/worker/crypto-stub.ts` is written from FIPS 180-4.

The exact versions are locked in `package-lock.json`.
