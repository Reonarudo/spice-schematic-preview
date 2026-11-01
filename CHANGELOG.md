# Changelog

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
