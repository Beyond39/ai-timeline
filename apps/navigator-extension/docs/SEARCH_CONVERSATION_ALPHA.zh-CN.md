# OPC Timeline 1.6.0 Alpha 1 — 搜索、对话管理与相关讨论

2026-10-14。建议测试版本名 **1.6.0-alpha.1**；Chrome manifest、package 和正文版本使用合法的数字版本 **1.6.0**。

本轮按 Search → Conversation Manager → Related Discussions → 回归验收顺序实现。保留原生 ES modules、现有工作台和 IndexedDB V7。全部检索／推荐在本地运行，无新增网络请求、权限、后端、付费 API 或模型下载。

## 使用方式

1. 现有工具栏左侧点击“全局检索”，输入“时间线缩放”、IndexedDB、C++ 模板等；筛选默认折叠。Conversation／Q&A、来源、现有项目、项目集合、日期、收藏和排序可以组合。
2. 点击结果打开完整 Q/A，使用稳定 ID 定位；回答中的命中会滚动并高亮。Markdown 跨节点等无法直接标记的命中显示真实来源片段。打开结果不改变 Timeline／Canvas 的视口。
3. 点击“对话管理”，编辑本地标题／描述、收藏／置顶，创建或重命名项目集合，给对话添加多个集合。多选后支持批量收藏／取消、项目加入／移除、隐藏／恢复。
4. 阅读面板末尾最多显示三条“相关历史讨论”。点击打开原始 Q/A，可以返回上一张。推荐不会创建人工关系、改变标签或采纳状态；加入托盘复用已有 Context Pack。

Ctrl+K／Cmd+K 仅由工作台页面模块处理；编辑 input／textarea／select／contenteditable 时不截获。Esc 关闭搜索，包括搜索框已有文字的情况。

## Search 索引与排序

`domain/search-service.js` 是共用的派生索引。中文按二元组／三元组切分，英文和技术词按单词切分，保留 C++ 等符号。常见疑问词在中文分词前分隔，避免“如何”附近的跨词碎片造成假相关。

倒排表存卡片 ID 和字段词频。排序使用 IDF 与长度归一化的 BM25 风格词频分数，再加精确字段匹配分。权重：卡片标题 8、用户问题 6、对话信息和批注 5、标签／人工判断 4、整理状态 2、完整回答 1。中文紧凑词组允许受约束的 n-gram 召回；混合查询中的英文／数字必须匹配，防止深层关键词后不同编号互相串扰。

索引包含来源原始标题、自定义对话标题／描述、卡片标题、完整 Q/A、主题／标签、批注、用户确认的决定和未解决事项。普通结果只包括 ACTIVE、能定位完整来源版本且未被用户隐藏／归档的卡片。PENDING、HIDDEN_INVALID、工具调用、思考和原始消息节点不成为普通结果。

`storage/search-index.js` 在首用时建索引，每25张让出执行；输入防抖180ms。每次查询先核对数据库 revision。变化后核对轻量卡片／元数据指纹，仅读取正文版本改变的卡片；标题、批注及对话元数据变化复用已有正文字频。已移除／隐藏的卡片删除倒排项；恢复／备份恢复重新纳入。多次读取的 revision 不一致时重试，避免来源和正文属于不同快照。

现有工作区筛选也已改为复用同一索引；没有保留另一套全库 Markdown 扫描。片段直接切自原文，用原文坐标高亮，不生成摘要。

## Conversation Manager 持久化与同步保护

沿用 conversations 表，新增可选字段 `originalTitle`、`customTitle`、`description`、`favorite`、`pinned`、`hidden`、`groups`、`localRevision`、`localUpdatedAt`。旧行按 `title` 兼容；重新导入更新来源 `title/originalTitle`，不覆盖本地字段。

项目集合名保存在现有 projects 的 `conversationGroups` 和 Conversation 的 `groups`，支持多个集合。集合不会移动 Conversation 的 projectId，不重写 TimelineMembership，不破坏关系或 Context Pack 引用。对话编辑使用带全局 revision 的 IndexedDB 原子提交，并检查独立 localRevision，拒绝覆盖另一窗口修改；批量操作先核对全部对象再提交。

来源创建时间未知继续显示未知。最近活动使用已提供的 Q/A 时间，最近同步时间单列。排序默认置顶优先，其后可按活动／创建／标题／卡片数排序。排序和筛选通过已有 chrome.storage.local 保存。

备份沿用 conversations／projects 的既有对象复制和稳定引用重映射；本轮真实 IDB 测试验证了本地编辑、再次同步、备份恢复与新页面重开保留元数据。

## Related Discussions 召回与排序

复用同一倒排索引，按当前卡片标题、问题、主题标签和批注召回候选，不做全库两两比较。标题／问题／标签／批注为主，完整回答权重仅0.18。

候选使用 IDF 加权的 TF-IDF 余弦相似度；阈值0.22。中文不能仅靠一个常见词或单个重叠三字词判相关；英语技术词和多个中文主题片段提供有效证据。小幅优先跨 Conversation，再按可靠时间和稳定ID打破同分。当前问题的精确重复及重复候选被抑制。无足够相关结果时整个区块隐藏，不强行凑三条，也不显示虚构百分比。

20组三元标记样例包含明确相关、同主题不同问法、共同词却无关、跨对话、中英技术词和无相关历史。20/20组的前三条含预期相关项，20/20组排除了对应负例。这是开发者标记的合成测试集，尚未经第一批真实用户评价，不代表普遍语义质量。

## QACard 集成、UI 复用与文件清单

继续使用 QACard ID、Conversation ID、questionVersionId、answerVersionIds 和 ACTIVE 有效性投影；本轮未重新实现解析器。引用不可变的有效正文版本，保留原始 Q/A、来源时间、当前分支、卡片标题／标签／批注、决定与人工关系。

复用 `el/button/ask`、现有 release-dialog、HorizontalTimeline 的弹窗入口、现有 opcDetail／richBody 阅读和批注表单、已有 releaseWrite 托盘及 ContextDeploy。入口在原有紧凑工具栏中，阅读面板底部增量添加推荐，没有第四个主导航、固定推荐侧栏、来源树、大面积紫色块或全局 CSS 重写。只对新增弹窗、结果列表和推荐条目增加局部样式。

新增生产文件：

- `domain/search-service.js`、`domain/conversation-management.js`
- `storage/search-index.js`、`storage/conversation-management.js`
- `ui/global-search.js`、`ui/conversation-library.js`

修改生产文件：

- `background.js`：管理／卡片写入的跨窗口变化广播。
- `domain/captures.js`、`domain/opc.js`：来源标题分离、显示标题和对话可见性过滤；未改解析／时间轴布局算法。
- `storage/opc.js`、`storage/repository.js`：共用搜索及管理／推荐命令、阅读名称覆盖；写入前不持久化显示覆盖值。
- `ui/opc.js`、`ui/app.js`：入口、命中定位、跨项目打开、相关讨论及返回；复用既有卡片编辑。
- `ui/opc.css`：仅新增功能局部样式。
- `ui/context-deploy.js`：复用搜索／管理入口；编译器与已保存上下文包未改写。
- `manifest.json`、`package.json`、`domain/common.js`、`workspace.html`、`sidepanel.html`：Alpha版本和脚本。

验证／文档文件：

- 新增 `validation/search-fixtures.mjs`、`validation/search-management-browser.html`、`validation/search-management-browser.js`。
- 新增 `scripts/validate-search-management.mjs`、`scripts/test-search-browser.mjs`；修改 `scripts/validate-all.mjs` 和验证用 `validation/browser-bridge.js`。
- 新增本交付说明，更新 README 和根 .gitignore。
- `validation/search-baseline/` 是从本地检查点还原的测试快照，`dist/` 是包、报告和截图；均忽略，不提交用户数据，也不进入扩展运行包。

## 自动化与真实浏览器结果

全部通过：18组 Node 套件、输出中 303 条 PASS（20组质量断言另列于报告）；静态语法／导出链接检查；Edge 中8项UI和6项数据／重开验收。数据验收初始300张，备份恢复后全库600张。实际执行了全文尾部定位、高亮、Esc、Ctrl+K编辑保护、界面重命名／收藏、推荐点击及返回、隐藏恢复、重复导入、来源标题更新、确认判断检索、跨项目结果、备份和刷新重开。

Timeline 实际点击缩放／适配并滚轮平移。Canvas 实际拖动节点、拖锚点创建关系、保存、验证已存边渲染及滚轮缩放。Deploy 使用已有托盘创建上下文包编辑器。390px／260px检索弹层无横向溢出。现有 ChatGPT适配器／导入、状态和分支、关系及 Context Pack 的 Node 回归通过。

报告：`dist/OPC_NODE_REPORT.json`、`dist/SEARCH_MANAGEMENT_NODE_REPORT.json`、`dist/SEARCH_MANAGEMENT_BROWSER_REPORT.json`。

截图：`SEARCH_UI_BEFORE.png`／`SEARCH_UI_AFTER.png`、`SEARCH_CONVERSATION_MANAGER.png`、`SEARCH_RELATED_READER.png`、`SEARCH_CANVAS_REGRESSION.png`、`SEARCH_DEPLOY_REGRESSION.png`、`SEARCH_FULL_WORKSPACE.png`、`SEARCH_UI_390.png`／`SEARCH_UI_260.png`。基线引用 Git `54a2e27`；主页面背景、字体、卡片尺寸、单轴、画布算法和阅读面板宽度保持。

## 实际性能

Node 合成数据、30次搜索／推荐平均和最大值；单位ms。显式 GC 后记录 Node 堆差值，不能等同整个浏览器占用或保证所有机器相同。

| Q/A数量 | 建索引 | 搜索均值 / 最大 | 推荐均值 / 最大 | 单卡批注索引更新 | 重建索引 | 堆增量 |
| --- | --- | --- | --- | --- | --- | --- |
| 300 | 147.4 | 3.73 / 12.37 | 2.48 / 12.15 | 0.104 | 160.0 | 4.26 MiB |
| 1000 | 487.5 | 13.46 / 42.20 | 8.24 / 42.14 | 0.040 | 572.4 | 14.20 MiB |

Edge 300卡首次读取+建索引+查询 83.5 ms；16ms计时器记录 5 个样本，最大间隔 18.3 ms。备份恢复后600卡，20次暖搜索平均 1.20 ms、推荐平均 28.36 ms。新页面600卡首用读取／重建／查询 184.2 ms。

卡片标注后的浏览器索引追踪显示 fullStateReads=0，messages／versions 正文记录载入为0；仍核对300张卡片的轻量头和元数据。单卡纯索引更新与数据库端到端修改的时间不同，不能混用。

## 尚未执行的验收与限制

- **登录真实 ChatGPT 的实地采集、Chrome/Edge实际安装MV3、关闭浏览器/扩展后台休眠后再启动：未执行。** 已执行真实 Edge 本地页面、真实隔离 IndexedDB、新页面刷新与缓存重建，以及合成导入／适配器回归。Chrome运行时API使用验证桥接。
- 索引在内存中保存，后台重新启动会按来源数据重建。超出1000卡、极长真实资料库的占用及实际MV3启动成本尚未测量。
- 传统文本推荐不理解同义词／因果关系；跨语言无共同词时可能漏召回。没有使用付费API或 embedding。阈值只由当前合成样例校准。
- 来源时间未知不能参加限定日期搜索；导入时间只作为同步时间显示。项目集合属于本地组织元数据，不是把既有对话迁移到另一个储存项目。
- 冷启动分批让出执行但仍在当前进程建索引，超长单卡可能增加延迟；不是后台神经模型或Worker搜索系统。

## 安装、版本与恢复

加载目录：`dist/ai-conversation-visual-navigator`。ZIP：`dist/ai-conversation-visual-navigator-v1.6.0.zip`。已经加载该稳定目录的用户可在扩展管理页面刷新后测试；保持同一扩展身份即可继续使用原来的 IndexedDB。新版本仍使用既有升级恢复点流程。

本目录起初没有Git；先只对扩展源码建立 `54a2e27` 检查点，之后保存本轮功能和验收／版本提交。原有其它文件保持未跟踪，未提交私人聊天、Cookie、Key或数据库，也未推送远程。

复跑：

```powershell
cd D:\mytools\GPT-SaaS\apps\navigator-extension
node scripts/validate-all.mjs
node scripts/test-search-browser.mjs
node --experimental-vm-modules scripts/build.mjs
node scripts/verify-package.mjs
```

浏览器脚本使用临时配置；可通过 OPC_TEST_BROWSER 指定已有 Chromium/Edge、OPC_TEST_PORT 指定空闲本地端口、OPC_BASELINE_REF 指定基线提交。基线不存在时从本地Git自动重建。安装包不包含这些测试代码或测试数据。
