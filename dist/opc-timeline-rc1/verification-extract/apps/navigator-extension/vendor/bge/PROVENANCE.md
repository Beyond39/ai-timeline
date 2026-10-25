# Packaged BGE runtime

Transformers.js **2.17.2**, official npm `@xenova/transformers` distribution. Downloaded bytes verified against npm tarball SHA-1 `7448d73b90f67bced66f39fe2dd656adc891fde5`; CDN files byte-identical to official tarball. The browser ESM bundle includes ONNX Runtime Web **1.14.0**. No npm installation is required to load the extension. An isolated attempted package-manager installation failed on network timeouts; it is not part of the runtime.

- `transformers.min.js`: SHA-256 `bcf7cf304e51f470ed59409622b9d6ffbad80dfcf5baf6a40c919e4b9c4ff812`
- `ort-wasm-simd.wasm`: SHA-256 `9bd07bababc65f53d061f457233eeae501be7ceb8a2adb9eef52d87fe776d865`
- `ort-wasm.wasm`: non-SIMD fallback, from the same npm tarball.
- `LICENSE-transformers`: upstream Apache 2.0 license. Bundle retains upstream component notices.
- `LICENSE-onnxruntime`: upstream ONNX Runtime 1.14.0 MIT license.

Source: https://registry.npmjs.org/@xenova/transformers/-/transformers-2.17.2.tgz . The published `src/pipelines.js:FeatureExtractionPipeline._call` applies `result.slice(null, 0)` for CLS and `result.normalize(2,-1)` for L2. Tokenizer automatically truncates to its `model_max_length=512`; unrelated pipeline max_length options are not relied on.

Model data are opt-in, not bundled executable code: https://huggingface.co/Xenova/bge-small-zh-v1.5 at revision `75c43b069aac4d136ba6bc1122f995fedcfd2781`, quantized ONNX weights. See upstream BAAI model card for MIT model license and CLS encoding instructions. Model config has hidden_size **512** (the Chinese small model is not the 384-dimensional English small model), max_position_embeddings **512**.

No remotely hosted JavaScript/WASM is executed. Worker points ORT wasmPaths at this packaged directory, single thread, no proxy/service-worker state. CSP permits WASM compilation and Hugging Face model-data origins; no new Chrome permissions.
