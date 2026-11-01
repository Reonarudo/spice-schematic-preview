# SPICE Schematic Preview

Draws SPICE netlists in `spice` code blocks as circuit schematics in Obsidian, in Reading view
and Live Preview. It draws; it never simulates. A port of the VS Code extension of the same
name.

## Usage

~~~markdown
```spice
* RC low-pass driving an emitter follower
V1 in 0 AC 1
R1 in mid 10k
C1 mid 0 100n
Q1 vcc mid out 2N3904
R2 out 0 1k
VCC vcc 0 5
.model 2N3904 NPN
```
~~~

Only `spice` blocks are drawn; `cir`, `ngspice` and other languages are left alone. Placement
and wiring are automatic: the netlist says what is connected, not where it goes. What each
element is drawn as, and how each dialect is read, is described in the
[VS Code extension's README](https://github.com/Reonarudo/spice-markdown-preview#what-is-drawn);
the same library, [spice-renderer](https://github.com/Reonarudo/spice-renderer), draws both.

The first line of a SPICE file is its title; a code block has none, so start a title with `*`
to make it a comment.

## Fence attributes

A `spice` fence may carry an attribute block:

~~~markdown
```spice {alt="A CMOS inverter" caption="Figure 1: CMOS inverter" align="center"}
M1 out in vdd vdd pch
M2 out in 0 0 nch
.model nch NMOS
.model pch PMOS
```
~~~

- `alt`: an accessible name, for readers using assistive technology.
- `caption`: plain text shown beneath the schematic.
- `align`: `left`, `center` or `right`.
- `class`: an extra CSS class on the `<svg>`, alongside the built-in `spice` class.
- `dialect`: the SPICE dialect this block is written in (see below).

Values must be quoted, with single or double quotes; a backslash escapes a matching quote or a
backslash. Values are plain text, never Markdown or HTML. Anything unrecognised is ignored and
the schematic still renders; turn on **Debug logging** in the plugin's settings to see what was
ignored in the developer console.

Attributes are read from the note's text. Where Obsidian renders a block without its note (some
embeds and exports), the schematic renders bare, in the **Dialect** setting's dialect.

## Dialects

A block is read in the dialect its `dialect` attribute names (`ngspice`, `ltspice`, `pspice`,
`hspice`, `xyce` or `spectre`, in any case), else in the **Dialect** setting's (default
`ngspice`). Files a block includes are read in its dialect. An attribute value that is not a
dialect is an error naming the six. The language word is always `spice`: the dialect is never
guessed from the content, and ` ```ltspice ` is not drawn.

## Included files

`.include`, `.inc` and `.lib` read files, as SPICE does, so a model library can decide which
transistors are PNP and name a subcircuit's pins:

~~~markdown
```spice
.include models/opamp.inc
X1 0 inv out opamp
R1 in inv 10k
R2 inv out 47k
```
~~~

Paths are relative to the note and must stay inside the vault, through no symbolic link;
otherwise the include is an error at its line, saying why. Includes may nest, up to 8 levels.
A file may be 8 MB; a block may include 32 files and 16 MB in all; all blocks' included files
together are cached up to 64 MiB. Only text is read, and only names and elements are taken from
it; nothing is run.

A change to an included file made in Obsidian, or picked up by Obsidian from disk, redraws the
blocks that use it. **Refresh included files** in the command palette rereads every included
file and draws every block again (it also retries blocks that timed out).

## Viewing the source

The plugin follows Obsidian's own handling of Mermaid diagrams:

- **Live Preview:** hovering a schematic shows Obsidian's **Edit this block** button in its top
  corner, which opens the code block for editing, as for Mermaid. Live Preview always shows the
  schematic.
- **Reading view:** hovering a schematic shows a button of the same look in the same corner,
  **Show source**, which flips the block to its source: the block as written, so an `.include`
  line stays an include line. **Show schematic** flips it back. A flipped block stays flipped
  across re-renders, reopening the note and restarting Obsidian, and in every Reading view of the
  note. Two blocks with the same body are told apart by their order. **Show every schematic in
  this note** in the command palette flips them all back.

## Errors and limits

A netlist error is shown in place of the schematic, quoting the line with a caret under the
column. A netlist may have up to 400 elements and 64 000 characters. Layout is limited by the
**Layout timeout** setting (seconds, 0.5 to 60, default 3); a circuit that takes longer shows a
timeout message until it changes, and a change to the setting restarts the layout worker and
retries it. Densely connected circuits of a few hundred parts can need more than the default.
Reading a block's netlist and included files may take 10 seconds.

Schematics follow the theme, as Mermaid diagrams do. In a dark theme they sit on the page in
dark-theme colours: the renderer draws black line art, so wires, symbols and every label (part
names, values, net labels, pin names) take Obsidian's own text colour. In a light theme they sit on
a white card with their exact colours. To keep every schematic on a white card, turn off **Follow
dark themes** in the plugin's settings. See `docs/adr/0002-dark-theme-colours.md`.

## Settings

- **Dialect**: the dialect blocks without a `dialect` attribute are read in.
- **Layout timeout**: seconds allowed to lay out one schematic.
- **Follow dark themes** (on by default): in a dark theme, draw schematics on the page in
  dark-theme colours instead of on a white card.
- **Debug logging**: report ignored attributes and the netlist reader's notes (an undefined
  model drawn as NPN, a skipped library, `K` coupling) in the developer console.

## Commands

- **Refresh included files**
- **Show every schematic in this note**
- **Restart renderer**

## How it renders

Rendering runs in a Web Worker inside Obsidian, built from spice-renderer: the seven dialect
parsers compiled to WebAssembly, the Eclipse Layout Kernel (elkjs) and the SVG drawing. The
library's `prepare` step runs in the same worker; the files it asks for are read on the main
thread by the library's own file reader, rooted at the vault's folder. Nothing is downloaded,
installed or written to disk; the worker is embedded in `main.js` (about 2.5 MB, 0.76 MB
gzipped). See `docs/adr/0001-runtime-host.md`.

The worker starts with the first schematic drawn, so a vault without spice blocks never loads ELK
or the parsers; included files are watched from the start. Schematics also draw in embedded notes,
hover previews, Canvas cards and exported PDFs (in light colours). Settings appear in Obsidian's
settings search on 1.13 and later, the dialect as a dropdown. On an Obsidian whose built-in
Chromium predates `light-dark()`, schematics keep the white card in dark themes.

Desktop only: included files are read from the vault's folder on disk.

## Development

Requires Node 22 or newer (see `.nvmrc`).

~~~sh
npm ci
npm run lint        # tsc --noEmit
npm test            # node --test: attributes, toggle, scanner, DOM, caches, includes, host, stubs, and the real worker bundle
npm run build       # main.js, with the worker bundle embedded
npm run vault       # link this repo into ../test-vault as an enabled plugin, examples in spice/
npm run test:live   # a real Obsidian with a throwaway profile and vault, driven over CDP
~~~

`npm run test:live` needs Obsidian installed (`OBSIDIAN_EXECUTABLE` overrides the path); it
prints where it saved light and dark screenshots. `examples/view-toggle.md` is its fixture and
includes `examples/models/opamp.inc`.

The renderer is pinned to a release tarball in `package.json` (`.npmrc` sets
`allow-remote=root` for npm 12). To take a new release, edit the URL, run `npm install`, check
`src/worker/entry.ts` against the release's `src/worker.ts` and `src/worker/parser-modules.ts`
against its `src/parser/modules.ts`, and run the tests.

## License

MIT for this plugin. `main.js` embeds spice-renderer (MIT), whose parsers carry flex, Bison and
Emscripten code and whose symbols and layout code are adapted from netlistsvg (MIT), elkjs
(EPL-2.0) and @xmldom/xmldom (MIT); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
