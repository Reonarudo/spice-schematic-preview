# SPICE Schematic Preview

Turn SPICE netlists in your notes into circuit schematics. Write a `spice` code block and the
schematic appears in its place, in Reading view and Live Preview. The plugin only draws circuits;
it never simulates them. Desktop only.

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

## Features

- Schematics in Reading view, Live Preview, embedded notes, hover previews, Canvas cards and
  exported PDFs.
- Six SPICE dialects: ngspice, LTspice, PSpice, HSPICE, Xyce and Spectre.
- Model libraries and subcircuits from files in your vault, through `.include` and `.lib`.
- Captions, alignment and alt text for each schematic.
- A button to see a netlist without leaving Reading view.
- Follows your theme: schematics stay readable in dark themes.
- Works offline.

## Install

1. In Obsidian, open **Settings → Community plugins** and turn off **Restricted mode** if it's on.
2. Select **Browse**, search for **SPICE Schematic Preview**, then select **Install** and
   **Enable**.

To install by hand instead, download `main.js`, `manifest.json` and `styles.css` from the
[latest release](https://github.com/Reonarudo/spice-schematic-preview/releases/latest) into
`<your vault>/.obsidian/plugins/spice-schematic-preview/`, then enable the plugin.

## Writing netlists

Put the netlist in a code block tagged `spice`. Placement and wiring are automatic: the netlist
says what's connected, not where it goes. The first line of a SPICE file is its title, but a code
block has none, so start a title line with `*` to make it a comment.

### What gets drawn

| Element | Drawn as |
| --- | --- |
| `R`, `C`, `L` | Resistor, capacitor, inductor, with the value |
| `D` | Diode, with its model |
| `V`, `I` | Voltage or current source |
| `Q` | NPN or PNP transistor, from its `.model` |
| `M` | NMOS or PMOS transistor, from its `.model` |
| `X` | A box named after the subcircuit, with its pin names |
| Other elements | A box saying what the element is |

Every connection to ground (`0` or `gnd`) gets its own ground symbol, and global nodes get net
labels. Simulation commands such as `.tran` are skipped.

### Dialects

Blocks are read as ngspice unless you choose otherwise, either for all blocks with the **Dialect**
setting or for one block with the `dialect` option:

~~~markdown
```spice {dialect="ltspice"}
V1 in 0 PULSE(0 5 0 1n 1n 5u 10u)
R1 in out 1k
C1 out 0 1n
```
~~~

The dialect names are `ngspice`, `ltspice`, `pspice`, `hspice`, `xyce` and `spectre`. The
[spice-renderer documentation](https://github.com/Reonarudo/spice-renderer#dialects) lists what
each one reads.

### Model libraries and subcircuits

`.include`, `.inc` and `.lib` read files from your vault, as SPICE does:

~~~markdown
```spice
.include models/opamp.inc
X1 0 inv out opamp
R1 in inv 10k
R2 inv out 47k
```
~~~

- Paths start from the note's folder. `../` reaches other folders of the vault.
- Only files in your vault can be read. A path that leads outside it shows "the file is outside
  this vault".
- Files in hidden folders (names starting with `.`) aren't found, because Obsidian doesn't index
  them.
- Included files may include others, up to 8 levels deep. Only names and elements are taken from
  them; nothing is run.
- When an included file changes, the schematics that use it redraw. **Refresh included files** in
  the command palette rereads every file.

### Captions and other options

Add options in braces after `spice`:

~~~markdown
```spice {caption="Figure 1: CMOS inverter" align="center" alt="A CMOS inverter"}
M1 out in vdd vdd pch
M2 out in 0 0 nch
.model nch NMOS
.model pch PMOS
```
~~~

| Option | What it does |
| --- | --- |
| `dialect` | The SPICE dialect of this block, as above. |
| `caption` | Text shown under the schematic. |
| `align` | `left`, `center` or `right`. |
| `alt` | A description read aloud by screen readers. |
| `class` | A CSS class, for styling the schematic with a CSS snippet. |

Put each value in quotes. Values are plain text, not Markdown. If an option is misspelled, it's
ignored and the schematic still appears; an unknown dialect is shown as an error that lists the
six.

## Viewing the netlist

- **Reading view:** hover over a schematic and select the **</>** button in its corner to see the
  netlist as written. Select it again to see the schematic. Obsidian remembers which schematics you
  switched, even after a restart. **Show every schematic in this note** in the command palette
  switches them all back.
- **Live Preview:** select Obsidian's own **Edit this block** button, just as for a Mermaid
  diagram.

## Dark and light themes

Schematics follow your theme. In a dark theme, wires, symbols and labels take your theme's text
colour on the page. In a light theme, schematics appear on a white card.

To always show schematics on a white card, turn off **Follow dark themes** in the plugin's
settings.

## Settings

| Setting | What it does |
| --- | --- |
| **Dialect** | The dialect for blocks without a `dialect` option. ngspice by default. |
| **Layout timeout** | How long laying out a schematic may take before it's shown as an error. 3 seconds by default, from 0.5 to 60. |
| **Follow dark themes** | On by default. Turn off to keep every schematic on a white card. |
| **Debug logging** | Writes ignored options and notes from the netlist reader, such as an undefined transistor model, to the developer console. |

## Commands

| Command | What it does |
| --- | --- |
| **Refresh included files** | Reads every included file again and redraws every schematic. |
| **Show every schematic in this note** | Switches every block in the note back from netlist to schematic. |
| **Restart renderer** | Starts the schematic engine afresh and redraws open notes. |

## When something goes wrong

- **A mistake in the netlist:** the error appears in place of the schematic, quoting the line with
  a caret under the problem.
- **"Took longer than…":** the layout hit the **Layout timeout**. Densely connected circuits of a
  few hundred parts may need more time; raise the limit in settings.
- **Size limits:** a netlist may have up to 400 elements and 64,000 characters. An included file
  may be up to 8 MB, and a block may include up to 32 files and 16 MB in all.

## Privacy

Schematics are drawn on your device, inside Obsidian. The plugin doesn't connect to the internet
and doesn't collect any data. It reads only the files your netlists include, and only from your
vault, through Obsidian. It never writes files.

## Credits

Schematics are laid out by the [Eclipse Layout Kernel](https://www.eclipse.org/elk/) through
[elkjs](https://github.com/kieler/elkjs), with symbols from [netlistsvg](https://github.com/nturley/netlistsvg).
The licenses of the software built into this plugin are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Released under the [MIT License](LICENSE). To build or change the plugin, see
[DEVELOPMENT.md](DEVELOPMENT.md).
