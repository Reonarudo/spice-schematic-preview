# Release verification: 0.1.3

Date: 2026-11-01. Tag `0.1.3` on commit 279f3f5, built and published by the release workflow:
https://github.com/Reonarudo/spice-schematic-preview/actions/runs/41311559432

## Assets

| File | Bytes | SHA-256 | Attestation |
| --- | --- | --- | --- |
| `main.js` | 2515148 | `8ee1ca2604b7c969b242e0c680b733ad9e8ca6884090f1cf50e91c61532f2a1a` | verified with `gh attestation verify` |
| `manifest.json` | 383 | `b9dc29e39b3b879105b3c73a5fc5c024d92f4e12e77d6d071dd8c5b78abc0436` | verified with `gh attestation verify` |
| `styles.css` | 4417 | `6cff5c69aef355030cff6bde66fc5a297730f8ff33a508513574281800008174` | verified with `gh attestation verify` |

## Checks

- In the workflow: tag matches `manifest.json` and `versions.json`; `npm ci`; `tsc --noEmit`; `npm test` (100 passed,
  0 failed); `npm run build`.
- Obsidian's review linter on `src/`: no findings. No `display()` method and no `!important` remain, the two
  community directory warnings on 0.1.2.
- `npm run test:live` against Obsidian 1.14.4 on the tagged tree: all checks passed.
- Downloaded assets installed in a throwaway vault in Obsidian 1.14.4: blocks draw in an embedded note.
