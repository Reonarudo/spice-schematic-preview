# Release verification: 0.1.2

Date: 2026-11-01. Tag `0.1.2` on commit 50723f9, built and published by the release workflow:
https://github.com/Reonarudo/spice-schematic-preview/actions/runs/41310119208

## Assets

| File | Bytes | SHA-256 | Attestation |
| --- | --- | --- | --- |
| `main.js` | 2516514 | `bf178692d8929f2460aba6f70b53dc95871654e8a9bf7fd24544200124bb1785` | verified with `gh attestation verify` |
| `manifest.json` | 383 | `5830191cf2ac0d1000508034388e5083e58b41b5ade6c923873be0999dbda105` | verified with `gh attestation verify` |
| `styles.css` | 4417 | `6cff5c69aef355030cff6bde66fc5a297730f8ff33a508513574281800008174` | verified with `gh attestation verify` |

The release carries only these three files.

## Checks

- In the workflow: tag matches `manifest.json` and `versions.json`; `npm ci`; `tsc --noEmit`; `npm test`
  (100 passed, 0 failed); `npm run build`.
- Downloaded assets installed in a throwaway vault in Obsidian 1.14.4: blocks draw in an embedded note (Reading view and
  Live Preview) and in Canvas text and note cards.
- `main.js` differs from 0.1.1 only in the embedded copy of this repository's `LICENSE`, which lost a trailing
  sentence so GitHub recognises it as MIT.
