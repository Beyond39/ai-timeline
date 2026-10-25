# GPT-SaaS / Project Memory Engine

2026-10-24：**OPC Timeline V1.0 RC1（扩展 1.7.0）**已增加离线主题/阶段、可选 OpenAI 分层总结、证据校验、人工保护和分析历史。安装、运行及本机代理见 [RC 指南](apps/navigator-extension/docs/HYBRID_RC_GUIDE.zh-CN.md)，已验证范围与外部限制见 [RC 测试报告](apps/navigator-extension/docs/HYBRID_RC_TEST_REPORT.zh-CN.md)。下面的 Python Alpha 与旧插件记录保留供历史参考。

**浏览器插件 V1.0.0 功能版：对话航图**。本版实现明确来源重新绑定、完整回答兼容、本地记忆与恢复点、可保存的资料包、确切正文版本关联、独立打印页和16px正文新UI。源码与稳定加载目录见 [插件说明](apps/navigator-extension/README.md)，升级与验收范围见 [V1交付](apps/navigator-extension/docs/DELIVERY_V1.zh-CN.md)，目标见 [V1产品纲领](apps/navigator-extension/docs/PRODUCT_CHARTER_V1.zh-CN.md)。当前仍需实际GPT页面、原生Chrome／Edge与Word／WPS／PDF验收。

**旧 Python 引擎 V0.4.2 Local Alpha** 可以从网页选择文件或粘贴真实对话，预览后导入，并用可选的 OpenAI Semantic 模式生成跨对话主题树。主题、片段和原句可以互相追溯，人工修改的片段归属会在再次编译时保留。操作见 [V0.4.2 使用与实现说明](docs/V0.4.2_FIRST_SEMANTIC_MEMORY.md)；原有接口见 [OpenAPI V0.4](contracts/openapi-v0.4.yaml)。

如果你想先判断当前完成度、暂时不配置 API，请看 [当前阶段与下一步](docs/CURRENT_STAGE_AND_NEXT_STEPS.md) 和 [项目评估](docs/PROJECT_ASSESSMENT_2026-09-24.md)。要和其他 AI 讨论后续开发，可直接提供 [项目上下文](docs/PROJECT_CONTEXT_FOR_CHATGPT.md)。

## V0.4.2 快速开始

Windows：双击项目根目录的 **Open Project Memory.cmd**。它会初始化本地数据库、启动服务并打开浏览器。关闭命令窗口即停止服务。

PowerShell 中也可以运行：

```powershell
python -m ai_memory launch
```

如果浏览器未自动弹出，手动打开 `http://127.0.0.1:8765`。点“选择文件”导入 `examples/v042-semantic-demo.json`，或直接粘贴对话。默认 Offline 模式不需要密钥。真实语义编译在启动服务前配置 `OPENAI_API_KEY` 与 `AI_MEMORY_MODEL`，然后在网页选择 Semantic。运行 `python -m ai_memory doctor` 可只读检查真实数据、密钥和评测进度，不会创建数据库。该版本尚未用用户真实资料与真实付费 API 完成质量验收。

本项目虽然沿用 `GPT-SaaS` 目录名，但产品面向所有 LLM。目标是把 ChatGPT、Claude、Gemini、其他 AI 导出以及未来的本地模型会话，规范化为可查询、可追溯、可重放的项目知识层。

## V0.4 项目编译快速体验

```powershell
python -m ai_memory preview docs/evals/fixtures/v04-mixed-synthetic.json
python -m ai_memory import docs/evals/fixtures/v04-mixed-synthetic.json
python -m ai_memory projects
python -m ai_memory compile-project <project_id>
python -m ai_memory serve
```

在本机打开 `http://127.0.0.1:8765`，选择项目、浏览主题树并逐句核对来源。默认离线规则用于验证流程；面向真实复杂项目时，可以显式选择 OpenAI 提取器及模型。仓库没有真实大型项目数据，因此实际质量需要用用户授权、脱敏的样本评测。

## V0.3 原有能力

V0.3 在可追溯事实库和跨对话知识编译之上，加入了按对话缓存的 Q/A 单元、保守的标签归并、三栏总结界面、时间线与 Context Package。默认启发式提取完全离线，不需要安装数据库服务器，也不会发送对话到外部服务：

```powershell
python -m ai_memory init
python -m ai_memory import examples/learning-project.json
python -m ai_memory projects
python -m ai_memory questions
python -m ai_memory search 复习
python -m ai_memory analyze
python -m ai_memory compile
python -m ai_memory topics
python -m ai_memory knowledge
python -m ai_memory review 学习方法 approve --note "已核对原文"
python -m ai_memory serve
```

运行最后一条命令后，在浏览器打开 `http://127.0.0.1:8765`。左侧选择主题，中间核对总结，右侧查看原句来源；页面下方可以查看 Q/A 单元和时间线。

新的运行结果位于 `output/generated/knowledge/`。每个主题文件区分核心内容、相关问题、AI 扩展和来源证据。仓库自带的学习示例输出保存在 `examples/expected-output/learning-demo/`，它只是演示，不限定产品领域。未选择 `--extractor openai` 时不会调用任何外部模型。

详细说明见 `docs/V0.2.1_CHANGELOG_AND_LEARNING.md` 与 `docs/V0.3_DEVELOPER_GUIDE.md`。实际接口定义见 `contracts/openapi-v0.3.yaml`。

### 可选 OpenAI 提取器

```powershell
$env:OPENAI_API_KEY="你的密钥"
python -m ai_memory compile --extractor openai --model "你明确选择的模型ID"
```

密钥只从环境变量读取，不写入数据库。请求使用 Responses API 的 JSON Schema 结构化输出，并设置 `store: false`；模型只能引用本次输入中真实存在的句子 ID。

## 当前交付

- `docs/PROJECT_IMPLEMENTATION_GUIDE.md`：完整产品与技术实施报告。
- `docs/reports/`：历史 PDF 指导书与版本报告。
- `docs/V0.2.1_CHANGELOG_AND_LEARNING.md`：Q/A、哈希缓存和标签复核设计。
- `docs/V0.3_DEVELOPER_GUIDE.md`：本地总结界面、时间线和上下文包指南。
- `docs/V0.4_DEVELOPER_GUIDE.md`：项目主题树、来源生命周期和评测指南。
- `contracts/openapi-v0.4.yaml`：V0.4 本地接口定义。
- `contracts/openapi-v0.3.yaml`：V0.3 本地接口定义。
- `schemas/qa-unit.v0.2.1.schema.json`：Q/A 单元的数据契约。
- `examples/expected-output/learning-demo/`：由学习示例生成的演示知识和上下文，不是训练数据。
- `output/generated/`：今后本地运行产生的可重建知识与上下文。
- `schemas/domain-model.schema.json`：AI 抽取结果的 JSON Schema 基线。
- `contracts/openapi.yaml`：产品后端 API 草案。
- `infra/postgres/001_initial.sql`：核心关系模型草案。
- `apps/`、`workers/`、`packages/`：按报告建立的后续开发边界。

V0.4 仍是本地 Alpha，服务只能监听本机回环地址。下一步应先用真实、脱敏的大项目检验主题质量、重复节点和无证据结论，再决定自动层级建议与更强的语义匹配。
