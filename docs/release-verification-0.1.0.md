# Release verification: 0.1.0 (pre-release)

Date: 2026-11-01. Tag `0.1.0` on commit 67252cf. GitHub pre-release:
https://github.com/Reonarudo/spice-schematic-preview/releases/tag/0.1.0

## Assets

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `main.js` | 2516604 | `fc1035082442cbd5d5b777bb232b950cd7f006a64cac508b5f90a0e6ab5ee023` |
| `manifest.json` | 382 | `cea5018b889c71c4c2b8cdfbd26b31a071b6908ce73c642642e8447a73c22765` |
| `styles.css` | 4417 | `6cff5c69aef355030cff6bde66fc5a297730f8ff33a508513574281800008174` |

Desktop only: yes. Minimum Obsidian version: 1.5.0.

## Checks on the tagged tree

- `npm run lint` (tsc): clean.
- Obsidian's review linter (`eslint-plugin-obsidianmd` 0.4.2, recommended config) on `src/`: no errors, no warnings.
- `npm test`: 100 passed, 0 failed.
- `npm run test:live` against Obsidian 1.14.4: 24 live checks passed.

## The published assets

- Downloaded with `gh release download 0.1.0` into an empty directory; `shasum -a 256 -c SHA256SUMS`: all OK; `main.js`
  byte-identical to the build from the tagged tree.
- Installed into a throwaway vault in Obsidian 1.14.4 with a throwaway profile: blocks draw, with captions, in an embedded
  note (Reading view and Live Preview) and in Canvas text and note cards.

## Not yet verified

- On real phones (iOS, Android) through BRAT: not applicable, the plugin is desktop-only.
