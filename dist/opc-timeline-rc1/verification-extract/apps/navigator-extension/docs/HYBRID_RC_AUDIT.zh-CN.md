# Hybrid Knowledge RC：审查与实施记录（2026-10-24）

## 实际架构

- 主产品是原生 ES modules 的 MV3 插件。`workspace.html` 与 Side Panel 共用 `ui/app.js`、`OPCTimeline`、阅读器和横向多轨时间线；没有 React。
- 权威 IndexedDB 为 `ai-conversation-visual-navigator` v9：Project → Conversation → immutable MessageVersion；Q/A 卡保存 userMessageId、questionVersionId、visibleAnswerIds、answerVersionIds、ordinal 与 pathId。
- `knowledgeDocuments` 已提供只读卡片投影，但按随机 ID 排序，缺少用户消息引用和轮次，不适合直接做阶段划分。本轮补齐来源字段，按原始 ordinal 分析。
- 现有知识 Worker 使用 TF-IDF、complete-link 聚类、精确 UTF-16 摘录和可选本地 BGE；这是跨卡片整理，不是 Conversation 分层总结。
- 关键词展示候选来自 Intl.Segmenter、相邻中文拼接和 readableTerms，评分仍使用中文二/三字搜索碎片。泛词既进入候选，又因短语结构及问题意图未过滤而获得高分。仅添加停用词不能解决中英混合短语丢失。
- 独立知识缓存 `opc-knowledge-engine-v1` 保存 embeddings/runs/reviews；原有 metadata 人工字段、Workspace 归属保护均须保留。
- 项目导航已有 atomic commit、navigationEpoch 和旧画面作用域保护。新增面板复用此路径，不更改 Timeline 状态管理。
- 根目录 Python 离线引擎有 Responses 提取器，但不共享浏览器 IndexedDB；直接接上会产生第二套事实库。本轮不修改该旧产品。
- 已有按 Project/全库备份、恢复点、增量导入、语法与模块链接检查、Node 回归和真实 MV3 浏览器脚本。

## 决策与顺序

1. 修改前源码检查点：`dist/checkpoints/opc-source-before-hybrid-20261024.zip`；原有用户数据库不迁移、不清理。Node 基线全部通过。浏览器沙箱启动失败后以隔离配置在沙箱外重试。
2. 复用搜索特征作为内部相似度；展示词改为有来源的词组候选、领域词保护、泛动词边界、用户问题权重和包含去重。
3. 新增纯函数 Conversation 引擎：原始轮序、自适应 topic/progress 多信号、连续覆盖验证、三层知识及角色证据校验。
4. 独立分析数据库保存当前快照、历史、逐字段人工修订；单事务更新；重新分析按来源范围匹配，歧义保留人工旧阶段并标记冲突。
5. 最小 Node 本机代理持有环境变量 API Key；固定 OpenAI Responses endpoint、严格 schema、显式确认、预估预算、超时取消、无自动付费重试。公开部署需额外认证/TLS/网关，不把本机模式称为公网安全方案。
6. 知识面板新增单 Conversation 入口，复用原阅读器/Timeline 定位，完成合成评测、Mock 和真实浏览器回归，生成安装包与报告。

官方资料核查：2026-10-24，Responses 的 `text.format` / strict JSON Schema、refusal/incomplete 与 usage。旧 GPT-4.1 mini / GPT-4o mini 页面有弃用标记，因此最终目录默认采用 GPT-5.6 Luna（输入 $0.20 / 输出 $1.20 每百万 token、1,050,000 上下文、128,000 最大输出），另提供 GPT-5.4 mini（$0.75 / $4.50、400,000 上下文、128,000 输出）。两者明确支持 Structured Outputs，普通提取显式 `reasoning.effort=none`。应用另设更小的单次输入/输出质量上限。原生 Node fetch 调用官方 REST 接口，无 SDK 依赖。运行时仍受账户模型权限影响；展示费用为带日期估算，实际账单未知。

- https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses
- https://developers.openai.com/api/docs/models/gpt-5.6-luna
- https://developers.openai.com/api/docs/models/gpt-5.4-mini
- https://developers.openai.com/api/reference/resources/responses/methods/create
