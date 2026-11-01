# The view toggle

In Reading view, hovering a `spice` code block below shows a button in its top corner that flips
it between the schematic and the block's source. In Live Preview the same corner holds Obsidian's
own "Edit this block" button, as for Mermaid. This note is the fixture for `npm run test:live`
and the document for the manual checklist: open it in Reading view and in Live Preview, in a
light and a dark theme.

## 1. A plain fence

```spice
V1 in 0 DC 5
R1 in out 10k
C1 out 0 100n
```

## 2. Captioned, centred: the button stays at the column edge

```spice {caption="Figure 1: a voltage divider" align="center"}
V1 in 0 DC 12
R1 in mid 10k
R2 mid 0 10k
```

## 3. Right-aligned with alt: the card stops short of the button's corner

```spice {alt="a resistor to ground" align="right"}
R1 a 0 2k2
```

## 4. Error card: the source view shows the body alone

```spice
R1 a b 1k
Q1 a
```

## 5. Long lines and a tall body: horizontal scroll, height jump

```spice
* An audio amplifier stage, with a comment line that runs well past the width of the column so the source view has to scroll sideways
V1 vcc 0 DC 12
V2 in 0 SIN(0 10m 1k)
C1 in b 10u
R1 vcc b 100k
R2 b 0 22k
Q1 c b e BC547
R3 vcc c 4k7
R4 e 0 1k
C2 e 0 100u
C3 c out 10u
R5 out 0 100k
.model BC547 NPN
```

## 6. Two identical bodies: flip the second one only, then edit this heading

```spice
R1 a 0 1k
```

```spice
R1 a 0 1k
```

## 7. An ordinary fence: no toggle, Obsidian's own copy button

```json
{ "compare": "Obsidian's copy button on hover, no view toggle" }
```

## 8. In a list item and a callout: attributes still apply

- A list item holding a schematic:

    ```spice {caption="Inside a list item"}
    V1 in 0 DC 5
    R1 in 0 1k
    ```

> [!note] A callout
> ```spice {caption="Inside a callout" align="center"}
> V1 in 0 DC 3.3
> R1 in led 330
> D1 led 0 LED
> .model LED D
> ```

## 9. An included file: the op-amp's pins come from `models/opamp.inc`

```spice {caption="An inverting amplifier; X1 is defined in models/opamp.inc"}
.include models/opamp.inc
V1 in 0 SIN(0 1 1k)
R1 in inv 10k
R2 inv out 47k
X1 0 inv out opamp
RL out 0 10k
```

The source view is the fence as written: the `.include` line stays an include line. Edit
`models/opamp.inc` (rename its pins) and this schematic redraws; **Refresh included files** in
the command palette rereads every included file.

## 10. A dialect of its own: in LTspice `$G_VDD` is a global node, not a comment

```spice {dialect="ltspice"}
V1 $G_VDD 0 5
R1 $G_VDD out 10k
R2 out 0 10k
```

## 11. Quirks: a missing include is an error at its line

```spice
.include nowhere.lib
Q1 c b e Q
R1 c 0 1k
```

A block seen for the first time shows *Reading the netlist…* until its netlist is read; the
toggle is already there, and a flip made while it loads survives the swap to the schematic. A
schematic that takes longer than the layout timeout shows a timeout card, which the toggle
treats like any error card.
