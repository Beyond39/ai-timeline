# Reproducible validation

Run date: 2026-10-25 (Asia/Shanghai). These are observed results, not coverage percentages or evidence of real-user semantic accuracy. Machine-readable checked-in evidence is [validation/public-beta-results.json](validation/public-beta-results.json); full raw reports, browser profiles and logs remain in ignored local output.

## Observed results

| Check | Result | Scope / local evidence |
| --- | --- | --- |
| Existing Node tests | PASS: 25 functional suites, 378 reported `PASS` lines; separate static gate | `apps/navigator-extension/dist/OPC_NODE_REPORT.json`; document-formats also executes assertions but emits no `PASS` lines, so 378 is not a comprehensive assertion count |
| Static build | PASS: 110 runtime JS files, 277 local module references | ES module parse/link without evaluation, assets, HTML hooks/CSP primitives/icons; not functional proof |
| Runtime ZIP verification | PASS: 139 files | Versions/source/install/decompressed ZIP bytes and SHA-256; report `PACKAGE_CHECK_REPORT.json` |
| Final installed-directory Project lifecycle | PASS: 15 checks | `PUBLIC_BETA_PACKAGED_LIFECYCLE.json`; native Chrome MV3, 1040 px start, independent A/B/C, ordinary mouse, late/failed reads, source dialog, Canvas late save, deletion, reload/reopen and browser restart |
| Final installed-directory Workspace/Side Panel sync | PASS: 23 checks | `PUBLIC_BETA_PACKAGED_SYNC.json`; actual native Side Panel target, both zoom directions, source identity, edit propagation, stale concurrent rejection and raw/source/layout digest preservation |
| Final installed-directory pointer/resize runtime | PASS: 13 checks | `PUBLIC_BETA_PACKAGED_RUNTIME.json`; loaded script/source comparison, physical clicks, resize during press, missing release and independent restore state |
| Hybrid browser/proxy | PASS: 18 checks after correcting stale test UI steps | `HYBRID_BROWSER_REPORT.json`; real Edge MV3/IndexedDB/loopback HTTP, mocked OpenAI upstream; source-directory load, not the final runtime ZIP; narrow Side Panel HTML entry is not a claim of native dock manipulation |
| Existing second-Project diagnostic | PASS: 25 checks | `PUBLIC_BETA_SECOND_PROJECT.json`; source-directory Edge MV3, fresh synthetic Profile; +/−/Q/A gestures remain connected and functional; overlaps lifecycle/sync coverage |
| Legacy Python prototype | PASS: 39 tests | `tmp/public-beta-python-tests.log`; temporary databases and loopback HTTP stub; separate product, not extension coverage |
| Independent clean-source rebuild | See machine-readable evidence | Fresh temporary source copy, no node_modules or old dist; tests/build/verify and digest comparison against original package. Same Node/zlib environment only |
| GitHub Actions | NOT RUN | Added workflow defines Windows/Linux Node tests/build/integrity; no repository push or remote CI execution occurred |
| Live signed-in ChatGPT / paid OpenAI / original failing private Profile | NOT RUN | Requires owner-controlled acceptance; no success claim |

The 15+23+13 checks overlap in behavior; do not present their sum as independent quality samples. Initial source-directory runs also passed but are not added again. Full raw reports record actual browser versions and script SHA-256; the summary preserves those relevant fingerprints without profile paths, conversation IDs or credentials.

The final packaged Chrome runs recorded Chrome 155.0.8059.85; the Hybrid run recorded Edge 156.0.4314.42. These observations do not establish the compatibility of every browser version allowed by the manifest.

## Core commands

From repository root:

```powershell
Set-Location apps/navigator-extension
npm test
npm run check
npm run build
npm run verify:package
```

No npm install is needed for these steps. Node 22+ is required; validated with 24.22.1. Some browser runners still contain historical developer-environment assumptions. The five runners documented below use the new test-only resolver; no runtime dependency is added to the extension.

## Optional native browser tests (Windows)

From `apps/navigator-extension`, install the pinned optional test tool:

```powershell
npm install --no-save --package-lock=false playwright@1.62.1
$env:OPC_TEST_BROWSER = Join-Path $env:LOCALAPPDATA 'Google/Chrome/Application/chrome.exe'
$env:OPC_TEST_EXTENSION = 'dist/ai-conversation-visual-navigator'
node scripts/diagnose-project-lifecycle-mv3.mjs --navigation-races --width=1040 --start-narrow --report=dist/PUBLIC_BETA_PACKAGED_LIFECYCLE.json
node scripts/test-workspace-sync-mv3.mjs --cdp-load --report=dist/PUBLIC_BETA_PACKAGED_SYNC.json
node scripts/test-workspace-runtime-mv3.mjs --extension=dist/ai-conversation-visual-navigator --report=dist/PUBLIC_BETA_PACKAGED_RUNTIME.json
```

Use the actual installed browser path if Chrome is installed elsewhere. These Chrome runners use the extension debugging/CDP APIs of the tested recent browser; the manifest's minimum Chrome 116 is not a promise that the test-control API exists there. They create a new profile under ignored extension `dist/`, never the normal browser profile. Runtime's `--browser=` can override the environment. No test should be pointed at a private profile.

The older second-Project diagnostic and Hybrid runner use Edge's unpacked-extension launch flags. Select Edge explicitly:

```powershell
$env:OPC_TEST_BROWSER = Join-Path ${env:ProgramFiles(x86)} 'Microsoft/Edge/Application/msedge.exe'
Remove-Item Env:OPC_TEST_EXTENSION -ErrorAction SilentlyContinue
node scripts/diagnose-second-project.mjs --expect-fixed --report=dist/PUBLIC_BETA_SECOND_PROJECT.json
node scripts/test-hybrid-browser.mjs
```

Hybrid binds loopback port 8787 and uses a mock provider; do not run another proxy on that port. It never reads a real API key for the mock. The narrow entry check uses the real `sidepanel.html` inside MV3, not the docked Chrome panel. Raw reports must remain private until reviewed.

## Failures observed and resolved during preparation

Initial browser process launches exited with Windows access restrictions; the unchanged suites passed when allowed to launch their isolated browser. Python initially had five loopback socket access errors (`WinError 10013`); all 39 passed after running with loopback access. These were environment failures, not silently counted as passing product checks.

Hybrid then failed because its locator expected the removed toolbar `本地知识整理` button. Source `ui/app.js` binds `#topics-view-button`; `ui/opc.js` intentionally omits the old fallback when that button exists. The first locator correction exposed a second obsolete assumption: `ui/knowledge.js` puts conversation details in a collapsed `<details>`. The test now clicks actual `Topics`, expands the real summary when closed, and retains all 18 assertions. Before-fix reports remain at `PUBLIC_BETA_HYBRID_BEFORE.json` and `PUBLIC_BETA_HYBRID_COLLAPSED_BEFORE.json`. No production behavior was changed for this test.

## Owner's manual acceptance

- On an existing installation, export both backup types, keep the same path/ID and upgrade; compare Projects, source versions, notes/tags, relationships, Canvas positions, Deploy and analysis history.
- In the previously failing Profile: add a second independent Project using the visible +, import a different conversation, switch A/B/C/A, use +/− repeatedly, click Q/A after zoom, refresh/reopen and open the real Side Panel. Record actual content/geometry, not just button availability. Do not clear storage to “fix” the test.
- In an authorized signed-in ChatGPT account: ordinary and Project conversations, source switching, incomplete/streaming replies, permission denial and missing content. Full and partial capture must be labeled correctly.
- Test project/library plus knowledge backup restore in an isolated profile; verify privacy before sharing exports.
- Inspect DOCX in Word/WPS and print/PDF output, 100%/125% browser zoom, narrow layout, keyboard navigation and Edge separately.
- If choosing to test real AI later, confirm data permission and spending separately, use private environment credentials, inspect outgoing scope and provider-side policy. This preparation does not require such a call.
