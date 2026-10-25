# License and asset review — maintainer decision required

No project license was selected by this preparation. A root MIT `LICENSE` was already present as an untracked file, and `pyproject.toml` already says MIT. Both were preserved. Before publication, the owner must confirm whether those declarations are intended, establish authorship/rights, and explicitly approve the license. Do not treat this report as legal clearance.

| Component | Evidence in source | Preliminary compatibility / remaining action |
| --- | --- | --- |
| First-party extension/Python/docs | Existing root MIT file; Python MIT metadata; local Git history | Owner must confirm rights and license scope, including generated or contributed material |
| KaTeX 0.19.0 | `vendor/katex/LICENSE`, README and provenance JSON; build SHA-256 pin | MIT notice preserved; audit current upstream separately before any upgrade |
| Transformers.js 2.17.2 | `vendor/bge/LICENSE-transformers`, `PROVENANCE.md`; bundle digest pin | Apache-2.0 text retained; verify embedded dependency notices/any upstream NOTICE obligations before publication |
| ONNX Runtime Web 1.14.0 | `vendor/bge/LICENSE-onnxruntime`; two local WASM files | MIT text retained; inspect transitive runtime notices, not just top-level package license |
| BGE Chinese tokenizer/config and optional weights | `vendor/bge/models/Xenova/bge-small-zh-v1.5/`, fixed model revision in `analysis/bge.js` | Upstream BAAI card declares MIT; converted artifact/tokenizer notice and exact-revision provenance require final owner review. Weights are not bundled in the runtime ZIP |
| Icons | `icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png` | No authorship/source license record found beside these assets; owner must attest creation or provide redistribution permission |
| Historical PDFs, screenshots, source exports | Local `docs/reports/`, `output/`, root ZIPs | Do not redistribute unreviewed files. Generated/private outputs are ignored; text/source fixtures reviewed as synthetic |

MIT and Apache-2.0 components can generally be distributed together while preserving their own terms and notices; that does not decide the license of first-party code. Retain all third-party texts and attribution. This is not a complete dependency vulnerability scan or legal opinion. No installed npm runtime dependency graph exists; the significant dependencies are checked-in vendor bundles. Updating them is outside this preparation's scope.

Primary evidence checked on 2026-10-25:

- [Transformers.js 2.17.2 Apache license](https://github.com/huggingface/transformers.js/blob/2.17.2/LICENSE)
- [BAAI BGE-small-zh-v1.5 model card](https://huggingface.co/BAAI/bge-small-zh-v1.5/raw/main/README.md) (`license: mit`)
- [Converted model repository](https://huggingface.co/Xenova/bge-small-zh-v1.5/tree/main) (exact revision in source; raw exact-revision card could not be retrieved in this audit)
- [KaTeX security guidance](https://katex.org/docs/security)

If the owner wants a permissive license, the existing MIT draft is one option after ownership/notice confirmation. Apache-2.0 is another option with explicit patent terms. Neither is selected here. Public source visibility and permission to redistribute are separate decisions.
