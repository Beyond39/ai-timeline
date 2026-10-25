# Project Memory Engine：供 ChatGPT 讨论的当前项目上下文

更新于 2026-09-24，依据真实代码与 39 项自动测试。项目目录仍叫 `GPT-SaaS`；当前产品版本是 **V0.4.2 Local Alpha**。下面的“已实现”指代码和模拟测试通过，不代表真实语义质量已经得到用户认可。

## 产品目标

把同一项目中分散在 ChatGPT、Claude、Qwen、Gemini 等 AI 对话里的信息，整理成可编辑的跨对话 Topic Tree。用户可以从主题、摘要和结论回到原始对话，并修正 AI 归类。短期只做本地个人工作台；不做云 SaaS、登录、Agent、自主浏览器操作或模型训练。

## 已经实现

- **输入与保存**：ChatGPT `conversations.json`、通用 JSON、网页选择 `.json/.txt/.md` 文件、粘贴对话、导入预览与确认；显式 `User:` / `Assistant:` 可识别角色，其他文本完整保存为原文。保留来源版本、重复和 inactive 状态。
- **知识对象**：Project、Conversation、Message、Sentence、Q/A、Fragment、Topic、Topic Tree、Evidence、Knowledge File、Revision、Review、Context Package，复用同一套 SQLite 数据模型。
- **两种编译**：Offline 使用规则，无密钥即可运行；Semantic 调用 OpenAI Responses Provider，用结构化输出做批量轮次分段、主题抽取、跨对话主题匹配和层级建议。对原文、片段、候选主题建指纹缓存，避免明显重复调用。
- **证据与纠错**：主题可查看片段与原句，并打开完整原始对话。可重命名、移动、合并、新建主题，修改片段归属；人工修改持久化并在重新编译后保留。低置信度候选进入待复核列表，可报告问题。
- **界面与评价**：本地三栏网页，选择文件/粘贴、编译进度、Topic Tree、Topic Detail、Evidence Inspector，支持抽查最多 20 个片段并保存片段边界、主题、证据、摘要和重复主题评价。
- **工程验证**：`python -m unittest -q` 运行 39 项测试通过；新增 `python -m ai_memory doctor` 只读检查状态；Windows 双击 `Open Project Memory.cmd` 或运行 `python -m ai_memory launch` 可打开应用。服务绑定 `127.0.0.1`。

## 当前真实运行状态

默认路径 `data/ai-memory.sqlite` 已创建，但用户真实项目、真实对话、Topic 和人工评价仍都是 **0**。本机进程没有检测到 `OPENAI_API_KEY` 或 `AI_MEMORY_MODEL`。真实 OpenAI 调用尚未执行，现有语义测试使用 Fake Provider；仓库示例对话是合成数据。因此，“能运行语义流程”有代码和模拟测试支持，“对我的真实对话分得好”仍未知。

## 下一步，按优先级

1. 用 3–5 段本人授权、必要时脱敏的真实项目对话，在同一项目中粘贴或导入。先检查原文、角色、来源和证据是否正确。
2. 在本机临时设置 API Key 和支持结构化输出的模型 ID，运行 Semantic Compile。不要把密钥写进仓库或聊天记录。若暂时没有密钥，先用 Offline 完成导入与证据检查。
3. 抽查至少 20 个片段，重点记录切分错误、主题错归、重复主题、无证据摘要及断链证据。AI 可汇总错误并修改代码，但产品是否符合用户思路需要本人判断。
4. 依据真实错误排序修复：优先分段、主题匹配、摘要忠实度或 UI 流程中影响最大的一个。重复真实试用，直到核心任务稳定。随后再决定是否进入 V0.5。

不要仅凭合成测试继续堆功能。长单轮消息内部的主题切分、复杂多主题归属、其他平台专用文本解析、备份恢复、安装包与云端能力仍未完成。

## 最终理想形态

用户导入多平台真实对话后，系统持续形成可维护、可搜索、可追溯的项目知识树；新来源只重编译受影响部分；AI 提供建议，人能快速纠错与批准；摘要、决策、开放问题都能回到证据；可以安全地导出经核对的上下文给其他 AI。商业化、多用户和自动 Agent 属于更远期选择，不是 V0.4.2 验收条件。

## 可直接发给 ChatGPT 的请求

> 请基于这份 V0.4.2 项目上下文讨论下一步。区分“代码已实现”和“真实用户语义质量未验证”。我希望尽量把工程、测试、文档和错误分析交给 AI，自己只提供少量真实对话、配置本机密钥并判断结果是否符合我的知识结构。请给出 20 个片段的人工抽查方案、通过标准、错误优先级和下一轮 AI 开发任务；不要默认我要做云 SaaS 或 Agent。

核对入口：`README.md`、`docs/V0.4.2_FIRST_SEMANTIC_MEMORY.md`、`docs/PROJECT_ASSESSMENT_2026-09-24.md`、`ai_memory/`、`tests/`。运行命令：`python -m ai_memory doctor`、`python -m ai_memory launch`、`python -m unittest -q`。
