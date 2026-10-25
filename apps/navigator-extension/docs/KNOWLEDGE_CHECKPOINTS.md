# Knowledge engine checkpoint evidence

## CP0 — 2026-10-23

- Branch: `codex/v1-interactions-hover`, HEAD `17343f3`. Existing tracked modifications and untracked delivery files predate this task and are retained. No reset, clean, push, commit, user-profile access or source-data upload.
- Stack: native ESM JavaScript, Chrome MV3, no application dependencies/lockfile, custom static linker/ZIP builder. Both HTML entries use `ui/app.js` and `ui/opc.js`.
- Flow: HTML → app → OPCTimeline / ProjectWorkspacePanel → runtime RPC → repository → opcState/workspaceScope → IndexedDB v9. Reader: opcDetail; Deploy: existing releaseWrite/context packs. Canvas and Timeline have separate existing renderers.
- Reuse: `domain/search-service.js` tokenization; `domain/tag-suggestions.js` phrase filtering; existing `projectWorkspaces` topic directory, manual assignments, Reader and Deploy tray. Existing featureVectors and BM25 remain compatible.
- Add: independent analysis documents, TF-IDF/extractive modules, dedicated page Worker, opt-in packaged BGE runtime, separate derived/review/cache IndexedDB, focused integration in Workspace and Reader. Main database version/schema stays unchanged.
- Pre-change Node: `node scripts/validate-all.mjs`: 23 suites + static PASS (`dist/OPC_NODE_REPORT.json`).
- Pre-change real Chrome: `node scripts/test-workspace-runtime-mv3.mjs --report=dist/KNOWLEDGE_CP0_BROWSER.json`: 12 checks PASS. Includes physical zoom changes, point positions, A/B/C/A, pressed-control preservation, separate pages/windows, restore and Reader. Initial sandbox launch failed; isolated elevated test succeeded. Private daily profiles untouched.
- Safety: existing `.gitignore` excludes user data/output/archive and test dist. Test fixtures must be synthetic; no capture bodies in diagnostic logs. Git protects source only, not browser data. No migration of the original database is planned.

Further checkpoints are recorded here after execution; browser inference is never inferred from a build pass.

## CP1

- Files: `analysis/knowledge-text.js`, `storage/knowledge-documents.js`, repository read-only RPC, `scripts/validate-knowledge.mjs`.
- Separate question/title/manual-tag topic fields and original answer versions; shared source Card IDs in virtual Workspace scopes; hidden/invalid cards excluded. NFKC is analysis-only. Readable phrases use existing segmentation/tokenization; C++/Context Pack preserved. Smoothed TF-IDF uses log1p weighted TF and L2 normalization.
- Executed CP1 unit cases PASS; existing 23 Node suites and static check PASS. Unit test caught and corrected technical identifier casing loss before checkpoint completion. Browser UI is not connected yet; CP0 remains the interaction baseline.

## CP2

- Files: `analysis/knowledge-keypoints.js`, extended knowledge tests.
- Original version offsets, Markdown block boundaries, complete list continuation, source validation, conservative code/math/table/quote/explicit counterexample exclusions, configurable MMR. Excerpts remain pending contextual review rather than claimed decisions.
- Executed extraction tests PASS (emoji UTF-16, empty/code-only/formula-only/table-only, negative statements, context, duplicate suppression, invalid offset). Existing regression rerun separately; no interaction module changed.

## CP3

- Files: `analysis/bge.js`, dedicated `knowledge-worker.js`, separate `storage/knowledge-cache.js`, pinned `vendor/bge`, narrow CSP/build updates, `scripts/test-bge-mv3.mjs`.
- Real Chrome 152 MV3 Worker WASM PASS via explicit offline file import, SHA-256 verified against Hugging Face LFS. Three real 512-dimensional vectors, CLS+L2, norms within 1.3e-7 of one; related cosine .6255, unrelated .2681. First imported-weight load 570 ms, three encodings 79 ms, second run 3/3 vector-cache hits in 2.8 ms (`dist/KNOWLEDGE_BGE_OFFLINE_MV3.json`, first measurement).
- Direct first model download failed with network error (`dist/KNOWLEDGE_BGE_MV3.json`); preserve this failure. Parallel public download + hash verification produced the identical official ONNX for offline import. Do not claim direct online download passed.
- Runtime and WASM are packaged, model weights are optional; no Chrome permission added, no original database schema change. Existing 23 suites/static remain passing. CP5 must surface import/download failure and actual mode.

## CP4

- Files: `analysis/knowledge-analysis.js`, worker orchestration, extended unit/model tests.
- Three real modes verified in Chrome using actual BGE vectors: same related pair Lexical .0496, Semantic .6255, Hybrid .3951 (alpha .4). Raw scores remain diagnostic, not percentages. Stable Card IDs and scoped sources retained.
- Complete-link leader grouping prevents transitive connected-component merging, maximum group size 80, singleton/duplicate/unreliable inputs remain unclassified; phrase-only labeler and real representative IDs. Conservative defaults are engineering starting points, not validated optimums.
- CP1–4 unit tests PASS; 23 pre-existing suites/static PASS. Three-model comparison and vector cache remain real Chrome tests, not unit mocks.

## CP5 — verified integration

- Files: `ui/knowledge.js`, small hooks in existing `ui/opc.js` and `ui/project-workspace.js`, `domain/project-workspace.js:knowledgeOrganize`, scoped CSS. No Timeline renderer/Zoom implementation changed.
- Reuses existing Workspace topics/manual membership and Deploy tray. Normal Project analysis has the same directory with independent persistent topic overrides. Reader receives exact version evidence and per-item review controls. Source database stays v9; all new analysis/cache/reviews live in separate `opc-knowledge-engine-v1`.
- First real Chrome flow passed 100-card Lexical, actual Hybrid inference, Timeline geometric zoom while computing, offline unavailable fallback, actual file import, source identity, Reader evidence and reviews. It stopped at a test locator that selected a hidden `<option>` after successful topic rename; locator corrected and full flow rerun. Do not count the unexecuted tail of that first run as passed.
- Final full UI rerun passed: manual title/tags and initial Canvas layout protected by source digests; topic rename/move and rerun; source Reader; per-tag/per-excerpt accepted/rejected persistence; Deploy tray deduplication; A/B/C/A and reload; 100-card virtual Workspace shares original identities; reimport keeps reviews. Asynchronous background refresh must not cancel a Workspace directory opened over the same unchanged source Project; a discovered race was fixed and the full flow rerun.

## CP6 — actual measurements and regression

- `dist/KNOWLEDGE_CP6_P0_BROWSER.json`: 12/12 original true Chrome Workspace checks PASS, after final page lifecycle changes. Includes A/B/C/A and real zoom/node geometry, independent windows, pointer lifecycle, Reader.
- `dist/KNOWLEDGE_NATIVE_SIDEPANEL.json`: 24/24 PASS; native docked Side Panel (not a substitute tab), real BGE Hybrid, ± geometry and Reader after closing knowledge UI, dual Project writes and source/Canvas/view digests.
- `dist/KNOWLEDGE_FLOW_MV3.json`: full synthetic 100-card flow; explicit offline fallback, hash-verified ONNX import, actual model vectors, actual Project switch during analysis cancels worker and closes panel, corrupted embedding recomputed, controlled real WASM fetch rejection falls back to Lexical, real page close preserves prior result. Final extension-reload result is recorded in this report.
- `dist/KNOWLEDGE_BGE_PERFORMANCE.json`: actual MV3 100/300/1000; final cached Hybrid analysis ~184/596/3151 ms plus vector-cache ~41/100/307 ms. Raw phase timings retained. Cold/new-vector timings preserved in the BEFORE report; no claim that cache timings are first-load timings.
- `dist/KNOWLEDGE_QUALITY.json`: 200/200 extracted fragments mechanically match exact original synthetic answer version offsets. Human quality metrics are null; `KNOWLEDGE_HUMAN_REVIEW.tsv` is an unfilled independent review worksheet. No fabricated P@5/R@5/acceptance rate.
- Normal gate: 24 Node suites (23 existing + knowledge) and static ES module/HTML/asset checks PASS. Packaged artifact integrity is a separate build/verify result.
- `KNOWLEDGE_ENGINE_EXPLAINED.md` at repository root and the extension docs directory covers real paths/functions, formulas, cache/schema, user review, complexity, measured performance, limits and interview questions.
- Pre-change unpacked build matches all six CP0 runtime file SHA-256 values. Preserved directory `dist/knowledge-stable-baseline-20261023` and archive `dist/OPC-PRE-KNOWLEDGE-1.6.3.zip` before updating generated artifacts. No Git commit/push/reset/clean, no user profile/data access.
- Remaining: first online model download is unreliable in this network; validated offline import works. Independent human relevance/tag/topic assessment has not been performed. Existing source backup does not yet include the new independent knowledge database. Those are explicit limits, not hidden PASS claims.
- Real hot-reload initially failed in the CDP-created profile with Developer mode off; the pre-change stable build was also disabled as unsupportedDeveloperExtension. Enabling Developer mode ONLY in the isolated test profile and awaiting the newly started Worker resolved the harness issue. Actual extension reload then preserved source hashes and model cache and produced real Hybrid output (99 hits + 1 recomputation after the deliberate cache fault). No production workaround or user-browser setting change.
- Final model checks explicitly require float32 / Float32Array with [1,512] output; a >512-token synthetic question triggers recorded truncation and real valid inference. Empty semantic input is labelled unavailable and falls back, never claimed as a successful embedding.
