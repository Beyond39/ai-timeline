# Installation, build and upgrade (Windows)

## Build from source

Install Git and Node.js 22+ and open PowerShell at the repository root. This project was validated with Node 24.22.1. The build uses only Node built-ins and already vendored runtime assets; `npm install` is unnecessary for core build/tests.

```powershell
Set-Location apps/navigator-extension
node --version
npm test
npm run check
npm run build
npm run verify:package
Get-FileHash dist/ai-conversation-visual-navigator-v1.7.1.zip -Algorithm SHA256
Get-Content dist/SHA256SUMS.txt
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` for those commands. The commands do not initialize or modify your normal browser's data. Build reports and test profiles go in ignored `dist/` directories.

Expected outputs under `apps/navigator-extension/dist/`:

- `ai-conversation-visual-navigator/manifest.json` — loadable directory root.
- `ai-conversation-visual-navigator-v1.7.1.zip` — ZIP has `manifest.json` directly at its root.
- `SHA256SUMS.txt`, `STATIC_CHECK_REPORT.json`, `PACKAGE_CHECK_REPORT.json` — integrity evidence, not functional test proof.

The archive uses a sorted file list, fixed ZIP timestamps and built-in deflate. Rebuilding unchanged inputs with the same Node/zlib environment should yield the same ZIP digest. Cross-version compressor bytes are not guaranteed identical. A shrunk package allowlist moves a previous generated installation directory to `previous-build-*` rather than deleting it. Runtime source directories and storage schemas are preserved.

The repository's `.gitattributes` preserves pinned vendor bytes and fixes application text to LF across clean Windows/Linux checkouts. Compare package digests using the same Node/zlib version; compressor changes across versions can still change ZIP bytes.

## First install

1. Open `chrome://extensions`, enable Developer mode and choose **Load unpacked**.
2. Select the generated `ai-conversation-visual-navigator` directory. Confirm its first level contains `manifest.json`; do not select the repository root or the ZIP itself.
3. Verify name **OPC Timeline**, numeric version **1.7.1**, and open the extension's Workspace from extension options. Pin the toolbar action if desired.
4. Create two independent local Projects with synthetic content and run the [manual checks](testing.md). Only then try authorized private content.

For ZIP installation, extract into a dedicated permanent directory before loading. Edge uses `edge://extensions`; this preparation does not claim complete Edge acceptance. Loading the extension source directory directly also works, but keep the chosen path stable for future updates.

## Existing data: upgrade in place

Export project/library backups and the separate knowledge backup first. Record the current extension ID and loaded directory from the extension details page. Close extension pages; update the same directory, reload the **same existing entry**, then reopen Workspace/Side Panel. Do not uninstall or clear storage. Check old Projects, raw text, notes, relationships, Canvas positions and analysis history. The preparation changes no database schema or storage technology.

New paths or other browser profiles can have a different extension origin. Missing content there is not proof that the original data were deleted. Return to the original entry/profile and inspect before attempting restore. Keep original backups private.

## Core usage

Open a saved ChatGPT conversation, click the toolbar action, capture and preview, then select/create a Project and save. If full capture fails, inspect its error; do not treat a page fragment as a complete conversation. JSON import offers an alternate controlled input. Timeline Q/A nodes open Reader; add tags/notes, use Canvas relationships, select sources and assemble Deploy/context packages. Export backups regularly.

## Optional local AI proxy (experimental)

The runtime ZIP deliberately excludes the proxy. Use the full source checkout and Node 22+. Read [privacy](privacy.md) first. From the repository root, set `OPC_ALLOWED_ORIGINS` to the exact `chrome-extension://` origin shown by your installed extension. Set `OPENAI_API_KEY` privately in the process environment and optionally `OPC_SESSION_BUDGET_USD`; do not write a real key into a tracked file or command transcript. Then run:

```powershell
node tools/opc-ai-proxy.mjs
```

Connect using the proxy's pairing token in the knowledge view. Review scope/estimate, then explicitly confirm sending before any OpenAI analysis. Prices/models in `analysis/ai-protocol.js` are versioned estimates and need review before paid use. Offline analysis and core features work without this process. This preparation has not exercised a real paid API.
