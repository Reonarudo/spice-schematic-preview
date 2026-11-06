# Changelog

## 0.2.1 (2026-11-06)

- The BOM table style and **Follow dark themes** are applied to the main window's document by name
  rather than through the global `document`, as Obsidian's review linter asks. No change in behaviour.

## 0.2.0 (2026-11-06)

- **The BOM view.** In Reading view a second button beside **</>** shows a block's parts as a
  table: quantity, references, type, value, and the included file when the block includes files.
  Identical parts share a row. The rows come from spice-renderer 1.1.0. A timed-out or
  unlaid-out schematic keeps its table; a netlist with a mistake says it has no parts.
- **BOM table style** setting: Plain (the default), Compact or Card. A change restyles every
  table at once, without a redraw; Card follows **Follow dark themes**.
- A BOM view is remembered like a netlist view, and **Show every schematic in this note**
  switches both back. Netlist views saved by 0.1 still open as netlist views; the data file
  gains a `view` on each entry the first time it is saved.
- Live Preview ignores a saved BOM view, as it ignores a saved netlist view: blocks always show
  their schematic there.
- The netlist reader's notes are logged (with **Debug logging**) for timed-out schematics too.
- The two buttons need more room in a block's corner: a schematic and a source view keep 68 and
  76 pixels clear at the inline end, up from 36 and 44.

## 0.1.4 (2026-11-01)

- Included files (`.include`, `.inc`, `.lib`) are read through Obsidian's vault API instead of
  Node's file system: only files in the vault, relative to the note (`../` may reach another
  folder of the vault); a path above the vault is an error, "the file is outside this vault".
  Files in hidden folders are not in Obsidian's index and are reported as not found. `main.js`
  no longer contains Node's `fs` module, or any Node module.

## 0.1.3 (2026-11-01)

- Settings come only from Obsidian's declarative settings definitions; the older `display()`
  method, needed only before Obsidian 1.13, is gone (the minimum is 1.14.4).

## 0.1.2 (2026-11-01)

- Releases are built by GitHub Actions from the tagged commit, with signed build provenance
  attestations for `main.js`, `manifest.json` and `styles.css`. Check a download with
  `gh attestation verify main.js -R Reonarudo/spice-schematic-preview`.
- Releases carry only the files Obsidian installs; `SHA256SUMS` is gone, as the attestations
  cover it.

## 0.1.1 (2026-11-01)

- The minimum Obsidian version is now 1.14.4, the version every check ran against; 1.5.0 was
  never tested.

## 0.1.0 (2026-11-01)

First version, ported from the VS Code extension
[spice-schematic-preview](https://github.com/Reonarudo/spice-markdown-preview) 0.4.0.

- `spice` code blocks are drawn as circuit schematics in Reading view and Live Preview.
- Schematics follow dark themes as Mermaid's do: each colour gets a dark-theme counterpart by its
  role (the black line art and labels take Obsidian's text colour), switching with the theme
  without a re-render; a setting keeps them on a white card instead.
- Attribute blocks on the fence: `alt`, `caption`, `align`, `class`, `dialect`.
- Six dialects (ngspice, LTspice, PSpice, HSPICE, Xyce, Spectre); a fence's `dialect` attribute
  wins over the **Dialect** setting (default ngspice).
- `.include`, `.inc` and `.lib` read files beside the note, inside the vault, nested up to 8
  levels. Editing an included file redraws the blocks that use it; **Refresh included files**
  rereads everything and retries cached timeouts.
- In Reading view, a button on every block flips it between the schematic and its source (the
  fence as written). It looks and sits like Obsidian's own "Edit this block" button and appears
  on hover. Flips are remembered per note, follow renames, and apply in every Reading view of the
  note.
- In Live Preview the block always shows its schematic, and Obsidian's own "Edit this block"
  button opens it for editing, as for Mermaid.
- Netlist errors quote the line with a caret; timeouts, the 64 000-character limit and the
  64 MiB cache of included files behave as in the VS Code extension.
- Rendering and `prepare` run in a Web Worker inside Obsidian, from spice-renderer 1.0.0's
  parsers, layout (elkjs) and drawing; no Node install is needed.
- Settings: dialect, layout timeout (restarts the worker), following dark themes, debug logging;
  listed in Obsidian's settings search (1.13 and later).
- The renderer starts with the first schematic drawn, not when Obsidian starts.
- Schematics draw in embedded notes, hover previews, Canvas and PDF export, and are built with
  Obsidian's DOM helpers, so pop-out windows get their own elements.
- On an Obsidian whose Chromium lacks `light-dark()`, schematics keep their white card.
- Commands: restart the renderer; refresh included files; show every schematic in the current
  note.
