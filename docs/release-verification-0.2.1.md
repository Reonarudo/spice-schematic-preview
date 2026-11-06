# Release verification: 0.2.1

Date: 2026-11-06. Tag `0.2.1` on commit d50c46a, built and published by the release workflow:
https://github.com/Reonarudo/spice-schematic-preview/actions/runs/42237730279

The one change from 0.2.0: `src/main.ts` names the main window's document (`this.app.workspace.containerEl.doc`)
instead of the global `document`, clearing the two `obsidianmd/prefer-active-doc` warnings 0.2.0 shipped with.

## Assets

| File | Bytes | SHA-256 | Attestation |
| --- | --- | --- | --- |
| `main.js` | 2518580 | `725dd3a6eabd5542291d5b4d242b1219d9b7d9d056b69c69c2218f40313c5d46` | verified with `gh attestation verify` |
| `manifest.json` | 383 | `87a81c82aa9ba7e70c8efb547ef08f240caac439713e91ef392b45e7be78488e` | verified with `gh attestation verify` |
| `styles.css` | 9478 | `1471c8c147b7de7acea7b1e5de8c1321a5bfbf028cb0dd4cd81316d075551e0f` | verified with `gh attestation verify` |

All three are byte-identical to a local `npm run build` of the tag.

## Checks

- In the workflow: tag matches `manifest.json` and `versions.json`; `npm ci`; `tsc --noEmit`; `npm test` (133 passed,
  0 failed); `npm run build`.
- The released `main.js` contains no Node `fs` module (`require("fs")`, `require("node:fs")`, `fs/promises`): 0 matches.
  Its `require` calls: require("obsidian")
- Obsidian's review linter (`eslint-plugin-obsidianmd` 0.5.0, recommended config) on `src/`: no findings.
- `npm run test:live` against Obsidian 1.15.0, with the downloaded assets installed in its throwaway vault:
  37 live checks passed. (The first run's output was not captured; the recorded run is the second.)
- No manual checklist: the change does not alter behaviour; 0.2.0's checklist (BOM view spec 11.5) stands.
