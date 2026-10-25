# 许可与资源来源

本轮沿用开发分支 `7d814a11` 中既有 MIT `LICENSE` 和 Python 元数据，不另行更换项目许可证。运行包新增同一份 `LICENSE`，校验脚本检查其与根许可一致。

| 组件 | 仓库证据与处理 |
| --- | --- |
| 第一方代码与文档 | 根目录及扩展目录 `LICENSE`；保留原版权声明 |
| 图标 | `scripts/create_icons.py` 的几何绘制；本轮重建四种尺寸，RGBA 像素全部与已提交图标一致；PNG 压缩字节因编码环境不同而不同，未替换原图 |
| KaTeX 0.19.0 | `vendor/katex/LICENSE`、README、provenance 和构建摘要校验 |
| Transformers.js 2.17.2 | `vendor/bge/LICENSE-transformers`（Apache-2.0）、PROVENANCE 与固定摘要；保留 bundle 内组件声明 |
| ONNX Runtime Web 1.14.0 | `vendor/bge/LICENSE-onnxruntime`（MIT）；补入官方同版本 `ThirdPartyNotices-onnxruntime.txt`，随 WASM 分发 |
| BGE tokenizer/config | 保存 Xenova 固定 revision 的 `README.upstream.md`；配置和 tokenizer 已入库；权重不在运行包中 |

上游资料：[Transformers.js 2.17.2 license](https://github.com/huggingface/transformers.js/blob/2.17.2/LICENSE)、[ONNX 1.14.0 notices](https://github.com/microsoft/onnxruntime/blob/v1.14.0/ThirdPartyNotices.txt)、[Xenova 固定版本模型说明](https://huggingface.co/Xenova/bge-small-zh-v1.5/blob/75c43b069aac4d136ba6bc1122f995fedcfd2781/README.md)。随包许可与来源文件应在后续发布中继续保留；新增外部资产需附来源。

本记录提供可核对的资源来源，不代表完整法律审查或依赖漏洞审计。旧准备记录见 `history/license-review-before-finalization.md`；其中待确认的图标来源在本轮已由生成脚本与像素对比补证。
