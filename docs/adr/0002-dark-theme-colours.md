# 0002: Dark-theme colours by role, not by inverting the drawing

Status: accepted, 2026-11-01.

## Context

Mermaid diagrams in Obsidian follow the theme. The plugins first did the same with
`filter: invert(1) hue-rotate(180deg)`, which keeps every label's contrast with its own box but
flips every colour, readable or not: gnuplot's yellow line turned dark olive, SMILES chlorine a dark
green, light-blue and orange lines went dim. A Graphviz graph's own background could not be told
from the renderer's default.

## Decision

`src/theme.ts` gives each colour in the drawing a dark counterpart by its role, computed once when
the plugin inserts the SVG, in OKLab so hue is kept:

- **Ink** (strokes, the `color` property, dark marks such as arrowheads, dark text): lightened
  only as far as needed to read on Obsidian's dark page, 3:1 for lines and marks, 5:1 for text
  (4.5 plus a margin for text on a darkened pastel box). Near-black greys become `--text-normal`.
- **Areas** (fills of L 0.4 and up, gradient stops): lightness mirrored between white and the
  page, so paper becomes the page and pale boxes become dark ones.
- **Knockout text** (near-white text, L 0.75 and up with almost no colour, drawn on a dark fill):
  mirrored like an area. Coloured light text, such as a bright green atom label, is ink.
- A fill set on a group that holds text counts as text, so a group colouring its labels reaches
  the text target.
- Text inside a group that also holds a filled shape is checked against that shape's dark fill;
  near-black marks such as arrowheads never count as what a label sits on.

Each colour is written as `light-dark(<original>, <dark>)`, the original text kept verbatim, and
the stylesheet sets the drawing's `color-scheme` to `dark` only in a dark theme with "Follow dark
themes" on. Switching theme or setting needs no re-render; the light theme and the white card are
exactly the renderer's colours.

## Consequences

- Readable colours stay as they are; only what would not read changes.
- The dark targets are measured against Obsidian's default dark page (#1e1e1e) and text
  (#dadada); a custom theme with a much lighter dark background gets less margin.
- Colours the module cannot parse (`url()`, `currentColor`, unknown names) are left alone; so is
  anything a renderer sets in an embedded `<style>`, unless the plugin handles it.
- Flat drawings (pikchr) have no groups, so text on a dark author-chosen fill relies on the
  knockout rule.

## spice-renderer specifics

- A schematic is black line art with no fills of its own: the root `<svg>` sets `fill="none"` and
  `stroke="#000"`, every symbol, wire and junction inherits that stroke, every label (part names,
  values, net labels such as `$g_vdd`, pin names on subcircuit boxes) is a `<text fill="#000"
  stroke="none">`, and arrowheads such as a bipolar transistor's are `path fill="#000"`. There are
  no colours other than black, no `<style>` element and no background shape.
- So in a dark theme with "Follow dark themes" on, everything takes Obsidian's `--text-normal`
  (near-black ink), on the page with no card. `scripts/test-live.mjs` measures part names, pin
  names, net labels and wires in the real Obsidian: text at least 4.5:1 and wires at least 3:1
  against the page, with the exact original black in the light theme and with the setting off.
- Text's `stroke="none"` and the root's `fill="none"` are not colours and are left alone.
