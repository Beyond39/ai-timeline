# 当前阶段与下一步（2026-09-24）

## 当前阶段

项目处于 **V0.4.2 Local Alpha**。网页已经能选择 JSON/TXT/MD 文件或粘贴对话，预览后导入；语义模式可调用 OpenAI Provider，按轮次识别主题边界、抽取有证据的主题，并判断跨对话归并。三栏工作台支持原文回溯、主题调整、片段改归属、问题报告与最多 20 个片段的人工抽查。默认 Offline 模式无需 API Key。

数据库沿用现有 Topic、Fragment、Review、Revision 和 Evidence 体系，schema V6 增加语义缓存与人工纠错记录。当前 39 项自动测试通过。详细设计与操作见 [V0.4.2 使用与实现说明](V0.4.2_FIRST_SEMANTIC_MEMORY.md)，分项评分与投入估算见 [项目评估](PROJECT_ASSESSMENT_2026-09-24.md)。

本机默认数据库已经创建，但项目、对话与人工评价仍都是 0；当前进程也未检测到 API Key 与模型变量。运行 `python -m ai_memory doctor` 可随时重新检查，且不会改变数据库。

## 尚未完成的验证

1. **真人语义质量验收**：自动测试使用 Fake Provider，未调用用户本机真实 API。示例文件是合成的；尚不清楚真实复杂对话的片段、主题归并和摘要质量是否达到用户认可。
2. **真实长对话边界**：语义分段以用户轮次为边界。一条极长消息内的多议题会得到多个主题候选，但仍是同一 Fragment。
3. **复杂待复核操作**：低置信度匹配已有归入、新建或忽略入口；一个候选同时属于多个已有主题时，还需要通过片段修改补充人工判断。
4. **平台专用文本解析**：只有显式 `User:` / `Assistant:` 等标记能可靠拆角色。其他格式完整保存为原文，尚无 Claude/Gemini/Qwen 专用文本结构识别。

## 下一步建议

先用 3–5 段本人授权、可脱敏的真实项目对话运行 Semantic Compile，然后在“抽查片段”中至少检查 20 个片段，记录 `fragment_correct`、`topic_correct`、`evidence_correct`、`summary_supported`、`duplicate_topic`。重点观察别名归并、遗漏主题、证据断链和误判的决策。根据这些人工结果，再决定先改分段、匹配还是摘要提示词。

Windows 可双击项目根目录的 `Open Project Memory.cmd`，或运行 `python -m ai_memory launch` 自动打开浏览器。本地地址：`http://127.0.0.1:8765`。若没有密钥，先用 Offline 检查导入和证据。要试 Semantic，在服务启动前设置 `OPENAI_API_KEY` 与 `AI_MEMORY_MODEL`；密钥不得写入仓库。

`output/` 仍只放可重建的本机生成结果。历史 PDF 在 `docs/reports/`，已提交的演示资料在 `examples/`。
