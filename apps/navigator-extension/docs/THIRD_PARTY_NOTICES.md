# Third-party components

First-party OPC Timeline code retains the existing MIT LICENSE included at the package root. Third-party components retain their own terms.

| Packaged component | License text / provenance |
| --- | --- |
| KaTeX 0.19.0 | `vendor/katex/LICENSE` (MIT), `vendor/katex/provenance.json`, `vendor/katex/README.md` |
| Transformers.js 2.17.2 | `vendor/bge/LICENSE-transformers` (Apache-2.0), `vendor/bge/PROVENANCE.md`; preserve bundled component notices |
| ONNX Runtime Web 1.14.0 JavaScript/WASM | `vendor/bge/LICENSE-onnxruntime` (MIT); runtime bundled by Transformers.js |
| BGE-small-zh-v1.5 configuration/tokenizer | `vendor/bge/models/Xenova/bge-small-zh-v1.5/`; upstream [BAAI card](https://huggingface.co/BAAI/bge-small-zh-v1.5) declares MIT; conversion at Xenova revision `75c43b069aac4d136ba6bc1122f995fedcfd2781` |

Optional quantized ONNX weights are downloaded/imported by explicit setup, not inside this ZIP. Check their terms before use/redistribution. Icons reproduce from scripts/create_icons.py (RGBA pixel comparison). The fixed-revision converted-model README and ONNX 1.14.0 ThirdPartyNotices are preserved beside the runtime; see docs/license-review.md in the source repository. Runtime JavaScript/WASM is local; do not replace it with CDN execution without review.
