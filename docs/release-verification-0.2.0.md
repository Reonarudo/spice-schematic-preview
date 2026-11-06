# Release verification: 0.2.0

Date: 2026-11-06. Tag `0.2.0` on commit 85c3f9a, built and published by the release workflow:
https://github.com/Reonarudo/spice-schematic-preview/actions/runs/42204454795

## Assets

| File | Bytes | SHA-256 | Attestation |
| --- | --- | --- | --- |
| `main.js` | 2518535 | `05e18734916831207cb7b9a55ae4c6f920151da7933bc8d97366757ca8c4f848` | verified with `gh attestation verify` |
| `manifest.json` | 383 | `86bc7a82a92044b5404f97b1b69e9f41b52f4b1bd2e66d41be1c19bc499fd094` | verified with `gh attestation verify` |
| `styles.css` | 9478 | `1471c8c147b7de7acea7b1e5de8c1321a5bfbf028cb0dd4cd81316d075551e0f` | verified with `gh attestation verify` |

All three are byte-identical to a local `npm run build` of the tag.

## Checks

- In the workflow: tag matches `manifest.json` and `versions.json`; `npm ci`; `tsc --noEmit`; `npm test` (133 passed,
  0 failed); `npm run build`.
- spice-renderer 1.1.0 installed from its release tarball
  (`sha512-skfMv1ZD88LiNpw8NmW30D6SSpNIcCa6uwDV8zhxjihxhUmidrX9ES6s7zRie1kt4eUc+nMKFU7mVuC7L+d9aA==`).
- The released `main.js` contains no Node `fs` module (`require("fs")`, `require("node:fs")`, `fs/promises`): 0 matches.
  Its `require` calls: require("obsidian")
- Obsidian's review linter (`eslint-plugin-obsidianmd` 0.5.0, recommended config) on `src/`: 0 errors, 2 warnings,
  `obsidianmd/prefer-active-doc` at `src/main.ts:148-149`. Kept: those lines register the main window's document on
  purpose; pop-out windows arrive through `window-open`, and `activeDocument` would pick whichever window has focus.
- `npm run test:live` against Obsidian 1.15.0, with the downloaded assets installed in its throwaway vault:
  37 live checks passed.
- Manual checklist (BOM view spec 11.5) passed: the three BOM table styles in light and dark, Card with
  "Follow dark themes" on and off, a pop-out window takes the body class, the RTL block with Obsidian's
  Right-to-left setting.
