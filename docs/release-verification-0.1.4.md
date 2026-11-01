# Release verification: 0.1.4

Date: 2026-11-01. Tag `0.1.4` on commit 19f1fd3, built and published by the release workflow:
https://github.com/Reonarudo/spice-schematic-preview/actions/runs/41319815181

## Assets

| File | Bytes | SHA-256 | Attestation |
| --- | --- | --- | --- |
| `main.js` | 2512150 | `675af932cf0b7ad076b21c7bfd9d931e4794601cb7a57b198e5453251ba14bb6` | verified with `gh attestation verify` |
| `manifest.json` | 383 | `801d6452814df4440689699146e1636831bcf5891f113b4bbb993b4b2ba21b7d` | verified with `gh attestation verify` |
| `styles.css` | 4417 | `6cff5c69aef355030cff6bde66fc5a297730f8ff33a508513574281800008174` | verified with `gh attestation verify` |

## Checks

- In the workflow: tag matches `manifest.json` and `versions.json`; `npm ci`; `tsc --noEmit`; `npm test` (108 passed,
  0 failed); `npm run build`.
- The released `main.js` contains no Node `fs` module (`require("fs")`, `require("node:fs")`, `fs/promises`): 0 matches.
  Its `require` calls: require("obsidian") 
- Obsidian's review linter on `src/`: no findings. `npm run test:live` against Obsidian 1.14.4: all checks passed,
  including a file above the vault root refused and a `../` path inside the vault read.
- Downloaded assets installed in a throwaway vault in Obsidian 1.14.4: blocks draw in an embedded note (Reading view and
  Live Preview) and in Canvas text and note cards.
