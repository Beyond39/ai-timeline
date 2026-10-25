# Project Organization MVP（本地开发交付）

交付日期：2026-10-21（Asia/Shanghai）。本轮是 Project Organization V1.1 功能迭代，沿用现有 OPC Timeline 1.6.0 源码；没有发布新版本或生成安装包。

## 本地 Git 与数据安全

- 原分支 `master`；基线提交 `96578ea`，保留之前的三个提交。
- 本地基线标签 `local-v1-before-project-organization`；开发分支 `codex/project-organization-v11`。标签和分支均新建，没有覆盖已有名称。
- 检查时已跟踪文件、暂存区均无未提交修改；没有配置远程仓库。检查了已跟踪文本中的常见密钥和私钥标记，没有发现匹配。
- 原目录有大量未跟踪文件，包含其他应用、文档、输出和 ZIP。没有把这些文件混入基线或功能提交，也没有删除它们。
- `.gitignore` 新增根目录 `data/`、`output/`、ZIP、CRX、私有环境配置的忽略规则；保留 `.env.example` 的例外。
- 未执行 push、hard reset、clean、分支覆盖、开源、发布或付费服务操作。

Git 不备份 IndexedDB。首次新建 Workspace 前会通过原有 Memory 机制保存资料恢复点；全库 JSON 导出现在额外包含 Workspace、主题、人工归属和 Workspace 的上下文包。恢复点仍在同一个浏览器内，不能代替外部文件备份。请使用原有“本地记忆”中的“导出整个资料库”另存文件；单个来源项目的导出只保存原有来源资料。

开发和验证没有读取用户真实 Chrome/Edge 配置或聊天数据库，因而也没有声称已经替用户导出真实资料。

## 运行与使用

真实扩展源码目录是 `apps/navigator-extension/`，其中的 `manifest.json`、`background.js`、`ui/`、`domain/` 和 `storage/` 直接组成扩展；没有另一个 `src/` 构建源目录。`dist/` 是原有本地构建与测试输出。

1. 在原有扩展入口先导出整个资料库，核对下载文件。保留原扩展，不卸载、不清除数据。
2. 使用独立浏览器配置，在扩展管理页开启开发者模式，加载本源码目录，验证新功能。独立配置的数据为空是正常情况，可以导入测试资料。
3. 进入侧栏或时间线中的 **Project Workspace**。
4. 点击“新建 Workspace”，填写名称；进入“关联 Conversation”，勾选多段已导入对话。取消勾选只移除关联，一个 Conversation 可以关联多个 Workspace。
5. 点击“本地算法整理”。主题可以折叠，展开后显示全部真实问题；点击问题打开原有 Q/A 阅读面板。
6. 可改名、移动勾选问题、将所选问题拆为新主题，或合并主题。手工设置在重跑算法时受保护。归档可恢复，没有增加删除原始聊天的 Workspace 操作。
7. 搜索框复用全文 Search，可搜索完整回答，并按来源 Conversation 筛选。
8. 可从整个项目、当前结果、一个主题或勾选问题进入原有 Deploy。阅读面板的“更多操作”也提供“加入当前 Workspace 并打开 Deploy”。

实际升级现有安装时需要沿用原扩展身份与安装目录。改用另一个加载路径或浏览器配置可能打开另一个独立数据库；本次没有自动替换用户现有 `dist/` 安装目录。

不需要服务端、Python 后台、外部 API、API Key 或模型下载。开发环境有 Node 即可运行检查；本环境没有可直接调用的 npm，因此实际使用了等价的 Node 入口：

```powershell
Set-Location D:\mytools\GPT-SaaS\apps\navigator-extension
node scripts/validate-all.mjs
node --experimental-vm-modules scripts/build.mjs --check
node scripts/validate-project-workspace.mjs
node scripts/test-project-workspace-browser.mjs
node scripts/test-search-browser.mjs
```

浏览器脚本需要 Playwright 和本地 Chromium 系浏览器。默认使用本机 Edge，可用 `OPC_TEST_BROWSER` 指定独立 Chrome 的可执行路径。测试用 localhost、合成数据、隔离数据库名称；新的 Workspace 浏览器脚本还在 `dist/` 下创建独立配置并验证进程关闭后重开。迁移测试从本地基线标签读取 v8 数据库实现到忽略的 `dist/project-v8/`，不会修改原始源码。测试辅助文件不进入扩展运行包。

## Q/A 卡片修复

- 原来默认标题来自 `questionPreview`，下方又显示一次 Q。现在使用独立的 `cardPresentation` 展示投影：相同、前缀重复或二元字符 Dice 相似度至少 0.86 的标题/Q 不重复展示；用户标题本身保留。
- Q 和 A 预览最多两行，分别限制在 140/180 字符；Canvas 也复用展示投影，保持节点、配色、字体与手工布局机制。
- A 预览使用纯文本；公式显示阅读提示，完整 Markdown、代码与 KaTeX 公式仍交给原有阅读面板。卡片操作继续收纳在原菜单。
- U+FFFD 不被删除或猜测替换。原始版本含 U+FFFD 时提示可能是上游解码/导入前损坏；源版本不含而阅读投影出现时标记渲染链路问题。合成测试验证了两条诊断路径，没有据此判断用户真实资料是否损坏。
- 没有修改原始消息、版本正文、标签或自定义标题来实现展示去重。

## Workspace 与数据兼容

IndexedDB 从版本 8 升到 9，只新增 `projectWorkspaces` 表，不删除、重命名或搬迁旧表。v8→v9 浏览器测试用基线数据库写入五个来源项目、200 张卡片，升级后逐表比较原记录，内容不变。

现有 `projects` 继续承担来源资料分区、导入和原有备份。新的 Workspace 是轻量关联目录，记录如下：

```text
Workspace { id, name, conversationIds[], topics[], assignments{cardId:topicId|null},
            manualCardIds[], revision, archived, analysis, createdAt, updatedAt }
Topic     { id, name, manual, representativeCardIds[] }
```

关联列表天然支持多对多；卡片仍使用原来的 `id`、`conversationId`、来源 `projectId` 和不可变正文版本。重复导入不触碰 Workspace 表。冲突检查同时使用 Workspace revision 和已有数据库全局 revision，另一窗口发生更新时拒绝静默覆盖。

主题成员关系没有写入 Canvas 的 `relationships`，也不会自动声明“依赖、修正、反驳”。人工改名会保护该主题的已有成员；人工移动、拆分、合并产生的成员归属同样保留；人工设为“未分类”也受保护。重跑只替换自动分组，可能保留空的人工主题。

折叠状态和最近选中的 Workspace 使用已有浏览器本地设置保存；正文和主题归属保存在 IndexedDB。折叠这类界面偏好不属于全库数据备份。

新全库备份包含可选 `workspaceData.version=1` 补充段，校验码覆盖原始项目和补充段。仍能读取没有该段的旧全库备份和旧恢复点。新备份包含 Workspace 的部分需要本轮实现读取；旧版代码会拒绝不匹配的校验码，不应手工删改校验字段。

恢复使用原有 `restoreBackup` 重建来源对象，补充段随后映射 Conversation/Card/Topic/Pack 引用；用户编写的名称、正文和已编译内容不做字符串替换。历史内容中的旧引用通过 `recoveredReferenceMap` 保持可追溯。恢复新增对象，不覆盖当前记录。备份引用损坏时会拒绝导入。

## 本地算法与参数

`OrganizationProvider` 定义输入/输出形状，本轮只有 `AlgorithmProvider` 被实例化：

```text
输入  {cards:[{id, question, title, tags}]}
输出  {provider, parameters, topics:[{name, keywords, cardIds, representativeCardIds}],
       unclassifiedCardIds, duplicateCardIds, analyzedCount}
```

在数据库边界先排除隐藏/归档 Conversation、隐藏卡片和非 ACTIVE 卡片；组织阶段再规范化分析副本并排除完全重复的问题。重复问题的原卡片保留，默认在未分类显示。

复用 Search 的 `tokenize`：中文二/三元字符片段、英文/代码单词、停用词过滤。NFKC、大小写和空白规范化仅用于分析。问题权重 3、标题 2、标签 4；每个文本字段最多 6000 字符。采用 `(1 + log(tf)) * log(1 + N/df)` 权重，保留每张卡片最多 256 个特征并作 L2 归一化。

按稳定卡片 ID 顺序做确定性 leader 分组；新问题只有与该组每个现有问题的余弦相似度都至少 **0.32** 才加入，避免相似度链把无关问题串成一个大主题。至少两张不同问题才形成主题，否则进入未分类。组名优先使用至少两张卡片共有的真实标签，否则取代表问题的前 45 字；同时计算前三个关键词和最多三个真实代表问题。参数没有被包装成复杂管理界面，可在 Provider 构造参数中调整。

算法不会生成回答摘要、结论、因果或时间关系。它对表达差异较大的中英文同义句会保守拆组，人工合并是预期工作流。

实际合成测试例子（并非用户私人聊天）：

| 自动目录名称 | 真实问题数量 |
| --- | ---: |
| 数据库事务并发冲突的重试策略 实例2 | 16 |
| IndexedDB transaction conflict retry backoff | 10 |
| IndexedDB 数据库事务冲突如何重试？ 实例12 | 14 |
| Canvas 拖动节点如何保存世界坐标？ 实例40 | 10 |
| Canvas 节点拖动世界坐标持久化 实例41 | 10 |

这些结果说明词面算法会把同一宽泛主题拆成几个候选组，并不假装具备跨语言语义能力。无输入、仅停用词、孤立问题以及完全重复问题另有测试，允许不生成任何主题。

100/200/300 张合成问题的单次本地组织实测约 11/10/19 毫秒，仅作本机参考，不包含 IndexedDB、首次全文索引和 UI 渲染。完整分组输出和参数保存在 `dist/PROJECT_WORKSPACE_NODE_REPORT.json`。

## Reader、Canvas 与 Deploy

点击目录中的问题会按真实来源项目打开现有 `OPCTimeline.openIndexedCard` / Q/A Reader；返回入口保留 Workspace。可以从 Reader 定位原 Canvas 节点，原拖动位置、人工边及修订机制保持原实现。

Deploy 原组件 `ContextDeploy`、托盘、`packMutation`、`compileContextPack`、预览、编辑、历史和复制均被复用。Workspace 只是新增来源作用域：托盘/包以 Workspace 为所有者，源卡片和源批注不改归属。只有当前 Workspace 的有效关联卡片可被选择，重复 ID 去重。已有来源中的人工确认关系会参与原 Context Pack 的依赖排序，不由主题成员关系推导新关系。来源未解决事项也能被上下文包引用，编辑权限仍按原所有者检查。

测试比较编译内容包含原 Reader 的完整问题与回答，并比较实际剪贴板和预览；Windows 剪贴板的 CRLF 与 textarea 的 LF 在测试比较时作换行规范化。

## 已执行验证与边界

- `validate-all.mjs`：19 个 Node 功能套件 + 静态检查全部通过，报告共记录 314 条 PASS；包括新增 11 项 Workspace 场景。
- 新 Workspace 浏览器脚本：9 个场景全部通过，零 pageerror/界面错误；覆盖真实 v8→v9 升级、五个来源项目/200 Q/A、主题编辑与重跑、全文搜索/来源过滤、Reader/Deploy/复制、跨来源包去重、人工 Canvas 依赖复用、无关联卡片拒绝、重复导入、隐藏/失效过滤、全库备份/恢复点恢复、390/720 宽度、页面刷新和浏览器进程重启。
- 原 Search/Conversation Management 浏览器脚本：300 张合成卡片，8 个 UI 场景 + 5 个数据库场景 + 1 个重开场景通过；包括 Timeline、Canvas、Search、Conversation Manager、Reader 和 Deploy 回归。
- `build.mjs --check`：79 个 JS、198 个本地模块引用、130 个运行文件的静态链接/资源/CSP 相关检查通过；没有生成安装包。
- 浏览器使用独立的 **Edge/Chromium** 配置和真实 IndexedDB。没有安装可用的 Chrome，因此未完成 Chrome 品牌浏览器的实装 MV3 测试；没有用单元测试替代这项结论。
- 没有测试真实账户采集、真实用户数据迁移、Chrome 扩展更新过程、操作系统原生下载文件保存或跨机器恢复。已有完整套件并不等于这些人工验收也已完成。

可查看：`dist/OPC_NODE_REPORT.json`、`dist/PROJECT_WORKSPACE_NODE_REPORT.json`、`dist/PROJECT_WORKSPACE_BROWSER_REPORT.json`、`dist/SEARCH_MANAGEMENT_BROWSER_REPORT.json`，以及 `PROJECT_WORKSPACE_DESKTOP.png`、`PROJECT_WORKSPACE_DEPLOY.png`、`PROJECT_WORKSPACE_390.png`。

## 修改文件

新增：

- `domain/card-presentation.js`：卡片展示投影。
- `domain/organization-provider.js`：Provider 契约和免费本地算法。
- `domain/project-workspace.js`：关联、主题和人工保护规则。
- `domain/workspace-backup.js`：全库备份补充段的校验与恢复。
- `storage/project-workspace.js`：目录读取、全文搜索和 Deploy 来源作用域。
- `ui/project-workspace.js`：项目目录和轻量管理入口。
- `scripts/validate-project-workspace.mjs`、`scripts/test-project-workspace-browser.mjs`。
- `validation/project-fixtures.mjs`、`validation/project-workspace-browser.html`、`validation/project-workspace-browser.js`：独立合成数据与验收页面。
- 本文档。

修改：

- 根 `.gitignore`。
- `storage/database.js`、`storage/repository.js`、`storage/opc.js`、`storage/release.js`、`storage/memory.js`。
- `domain/backup.js`、`domain/context-pack.js`、`domain/qa-content.js`、`domain/release-data.js`、`domain/search-service.js`。
- `ui/app.js`、`ui/opc.js`、`ui/opc.css`、`ui/context-deploy.js`、`ui/memory.js`。
- `background.js`、`workspace.html`、`sidepanel.html`、`package.json`、`scripts/validate-all.mjs`。

## 遗留风险与下一轮

- v9 数据库不能直接交给只支持 v8 的旧扩展打开。回退前保留外部全库备份；不要为回退删除数据库。
- 中文 n-gram 与词面相似度无法可靠理解语义、代码含义或跨语言同义；本轮不对真实资料聚类质量作超出合成测试的承诺。数千张以上尚无性能验收；算法当前适合本轮 100–300 张规模。
- 原有“来源项目”和新的跨对话 Workspace 都保留，避免破坏已有导入和管理机制；入口文字有所区分，但用户仍需理解关联与移动来源资料的差别。
- 关联被移除或来源变为隐藏/失效后，已有冻结包仍保留历史内容；重新编译时需要移除失效选择或恢复来源，不会默默编造替代正文。删除来源原始项目是原有高风险操作，不属于 Workspace 的移除/归档流程。
- 历史更早版本的卡片身份修复、损坏备份、大规模并发和不完整外部导出仍需继续积累真实样本验证。新的备份结构会拒绝损坏引用，原资料不被覆盖。
- 下一轮 LocalEmbeddingProvider：沿用相同输入输出、卡片 ID 与人工保护，增加用户主动启用的轻量向量特征并比较质量；不要默认下载模型。
- 下一轮 Question Map：复用 Topic IDs、成员和代表问题作为目录/导航，Canvas 人工语义边继续独立；先提供筛选与跳转，再考虑布局。
- 下一轮 QwenAPIProvider：按同一契约提供可选实现；发送前让用户选择范围、查看内容并明确授权，密钥存储和限额单独设计；继续校验返回的原始 Card ID，不能让模型结果覆盖人工调整。
