# 运行输出

`output/` 只放本机运行时生成的文件，统一写入 `generated/`。这里的知识文件和 Context Package 都可以重新生成；权威数据保存在 SQLite 数据库中。不要把自己的导出文件、API Key 或真实对话提交到仓库。

- `generated/knowledge/`：编译出的知识文件。
- `generated/context/`：手动导出的 Context Package。

已提交的演示结果在 `examples/expected-output/learning-demo/`；历史 PDF 报告在 `docs/reports/`。这两类资料不再混在运行输出中。
