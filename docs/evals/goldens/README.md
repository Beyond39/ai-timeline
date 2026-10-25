# 金标结果

运行 `python -m ai_memory eval-export <project_id> --output docs/evals/goldens/<name>.csv` 生成待审表。人工填写 `expected`、`verdict`（`pass`/`fail`）和 `notes` 后，再运行 `eval-report`。未审行不计为通过。

由人工审核的问题、主张、决策、任务、关系与证据定位。模型或提示升级前必须回归。
