# AI Conversation Visual Navigator · 浏览器插件 V0.2.1

中文产品名：**对话航图**。主动采集 ChatGPT 对话，保存在本地项目；生成连续讨论的整理建议，预览、修改并人工确认后更新 Snake 彩色地图，每个片段都能展开完整 Q/A 并追溯原文。无需启动 Python、配置 API Key 或安装 npm 依赖。

## 直接安装

1. Chrome 地址栏输入 `chrome://extensions`，打开“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择：
   `D:\mytools\GPT-SaaS\apps\navigator-extension\dist\ai-conversation-visual-navigator`
3. 固定工具栏的“AI Conversation Visual Navigator”图标。
4. 打开 `https://chatgpt.com` 的一条真实对话，点击插件图标，再点击侧栏的“采集 / 更新当前对话”。
5. 检查预览中的消息数量、正文、来源和范围，选择或创建本地项目，点击“保存到本地项目”。
6. 点击地图节点展开完整问答；通过“项目地图 ↗”打开完整项目页。

当前 ZIP 位于 `dist/ai-conversation-visual-navigator-v0.2.1.zip`。解压后选择含 `manifest.json` 的文件夹。源码根目录本身也可直接加载。**不要用浏览器直接双击 HTML 文件。**

V0.2.1 修复历史证据被导航编辑替换、拆合丢失复核状态 / 后段证据、补采问题后历史证据备份失败、最新预览顺序、Unicode 搜索摘要与高亮、并发数据库连接等问题，并减少同一读取中重复的版本计算。已重新运行核心、回归与隔离浏览器验证，详见 [审查修复报告](docs/REVIEW_FIXES_2026-10-03.zh-CN.md)。下一阶段提示词见 [V0.3 实施任务](docs/NEXT_V0.3_PROMPT.zh-CN.md)。数据库和备份 Schema 仍为 2。

**从 V0.1 升级：先导出项目备份，再到扩展管理页点击已有扩展的刷新按钮，继续使用原加载目录。不要卸载后重装，也不要另换解压目录。**标准安装目录仍为 `dist/ai-conversation-visual-navigator`；如果以前直接加载源码根目录，就继续刷新源码根目录。IndexedDB 原库升级，已有原文、路径、Q/A、分段、主题与人工修订保留；V0.1 备份仍可导入。

Chrome 目标版本为 116+。Edge 在 `edge://extensions` 用同样方式加载；其侧栏、工具栏授权和下载行为需由你实际确认。安装及异常处理见 [中文操作说明](docs/INSTALL.zh-CN.md)。

## 本轮已实现

- 独立建议管线：本地规则根据连续问答、词语与内容变化提出分组；分析方法、版本、源数据版本、明确有序成员及消息 / 正文版本引用单独持久保存，生成后不会直接改图。
- 整理闭环：“整理当前对话”选择路径与范围 → 前后分组对照 → 修改标题、主题和相邻 Q/A 边界 → 保存预览 → 复核人工冲突 → 确认采用 → 地图展开真实成员及原文。支持拒绝建议、重开建议及撤销整次已确认整理。
- 外部模型入口：导出稳定引用整理包、分析提示词与返回格式；长对话按目标轮次分批并附相邻上下文。外部返回完整 `groups` 或汇总全部 `batches` 后导入 JSON，经引用校验再预览确认。**没有自动调用模型 API**；“模型语义结果”来自导入文件的方法声明，不代表插件已验证真实模型调用过程。
- 关系保护：整理范围内连续、有序、完整覆盖，无重复或遗漏，不跨对话 / 分支；不存在的引用报错，源正文或导航结构更新后过期建议不可静默采用；原有人工作业需明确复核。
- 整理状态与主题管理：未整理、待确认、已确认、需要复核筛选；项目同主题保持颜色；主题重命名 / 合并先展示片段、对话和建议影响范围。
- Manifest V3：工具栏打开侧栏、完整项目页、按用户操作读取当前页；页面选择器集中在 `adapters/chatgpt.js`。
- 采集预览：实际消息、角色、内容类型、取得的源 ID、原生项目信息、来源时间精度、采集方法和范围；未知历史、未展示分支及附件缺失明确提示；识别失败给出原因。
- IndexedDB：本地项目、对话、消息、不可变正文版本、采集快照、阅读路径、Q/A、Segment、主题和人工修订。
- 增量保存：源 ID 优先；有依据的上下文回退匹配记录不确定性；同文不全局去重；本次未采集到的旧消息保留；不能确认连续性时另存路径。
- 完整 Q/A：每条用户消息均有轮次；多条助手回答、工具与辅助消息按已存路径分组；无回答仍可读；索引分批、上一轮/下一轮、任意成员跳转、长回答展开、版本及附件信息。
- 地图：真实 Segment 成员、稳定主题颜色和图例、主题筛选、双向 Q/A 定位；连续段改名、标签、相邻合并、边界拆分、最近修改撤销与人工保护。
- 项目：创建、重命名、多对话归属、移动对话（含人工修订）、全文搜索、项目删除。
- 历史导入：ChatGPT `conversations.json` 和现有通用 JSON 的预览；先保留节点图，再恢复 `current_node` 阅读路径；其余分支单独保存。无当前路径时可选择，或保留未知状态。
- 项目备份：原文、来源、版本链、采集图、路径、Q/A、Segment 成员、主题、整理建议、整理包和人工修订一起导出；恢复重建本地引用。已确认地图继续可读；恢复后的旧待确认建议 / 整理包需重新生成或导出，避免使用改变前的本地 ID。

所有主要界面均连接实际 IndexedDB 数据，没有内置演示项目；初始节点为“未分类”灰色，设置主题后呈现彩色。已有工程的 `examples/*demo.json` 可通过导入体验，文件名含 demo/example/示例/演示时预览会标记示例。

## 手动体验与限制

请按 [手动体验清单](docs/MANUAL_CHECKLIST.zh-CN.md) 核对真实页面。完整 [交付范围与未验证事项](docs/DELIVERY.zh-CN.md) 和 [数据 / 迁移契约](docs/DATA_CONTRACT.zh-CN.md) 随包提供。

本轮已取得用户允许，执行了域功能检查，并进行隔离浏览器验证；具体结果与范围以交付说明和 `dist` 内验证报告为准。隔离验证使用标记的固定数据，不访问你的账号。真实 Chrome / Edge 安装、工具栏与侧栏授权、ChatGPT 当前 DOM、真实流式回答和附件采集仍需实际确认。

## 构建与源码结构

```powershell
cd D:\mytools\GPT-SaaS\apps\navigator-extension
node --experimental-vm-modules scripts/build.mjs --check
node --experimental-vm-modules scripts/build.mjs
node scripts/verify-package.mjs
```

功能回归：`node scripts/validate-core.mjs` 与 `node scripts/validate-regressions.mjs`。浏览器验证入口：`node scripts/serve-validation.mjs`，再打开它输出的本地地址；只有该隔离来源包含验证按钮，安装包不包含测试入口。性能对比为本次保存的固定合成样例，可运行 `node scripts/benchmark-review.mjs` 复核；不要用 `--baseline` 覆盖已保存的修复前测量。

构建不运行应用模块；它通过 Node VM 只解析语法、静态链接模块（不 evaluate），检查本地依赖引用、Manifest / HTML 资源、界面 ID 和 PNG 尺寸，再复制加载目录、生成 ZIP、SHA256 及 `dist/STATIC_CHECK_REPORT.json`。图标已包含；若需重生成，可用带 Pillow 的 Python 运行 `scripts/create_icons.py`。

```text
background.js          工具栏、采集授权、消息路由、保存进度
adapters/chatgpt.js     集中维护的页面 detect / collect / normalize
analysis/              本地规则适配器、外部模型结构化结果与提示词接口
importers/json.js       ChatGPT 节点图与通用 JSON 解析
domain/                来源匹配、Q/A 索引、分段编辑、建议校验、主题与备份关系
storage/               IndexedDB 事务与统一 repository 接口
ui/                    共享中文界面、完整阅读器、Snake 地图、整理预览、主题管理
sidepanel.html         侧栏入口
workspace.html         完整项目页
docs/                  安装、体验清单、数据契约、交付说明
scripts/               静态检查、打包、图标生成
validation/            隔离验证素材与浏览器桥接（不进入发布包）
dist/                  可加载插件、ZIP、校验和、静态检查报告
```

保留原有 `ai_memory/` 和 Python 运行方式。迁移依据为原导入器、来源版本、Q/A 映射、按用户轮次的连续分组以及人工覆盖优先规则；浏览器版本新增未答轮次、回答组、分支、稳定逻辑身份和明确成员。没有把原 Python 服务搬入插件。
