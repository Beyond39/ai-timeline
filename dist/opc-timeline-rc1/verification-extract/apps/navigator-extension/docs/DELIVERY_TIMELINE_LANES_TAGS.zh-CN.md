# OPC Timeline：缩放稳定性、多会话轨道与本地 Q/A 候选

> 后续追加的统一关闭与 Project 安全删除交付见 [DELIVERY_UNIFIED_CLOSE_PROJECT_DELETE.zh-CN.md](DELIVERY_UNIFIED_CLOSE_PROJECT_DELETE.zh-CN.md)。按钮的当前统一 aria-label 为「关闭」；本文件保留此前分阶段实现与测试记录。

日期：2026-10-21（Asia/Shanghai）。本轮直接修改现有原生 JavaScript / Chrome MV3 扩展，没有引入 UI 框架、模型运行时或扩展权限。

## 1. 使用入口与交付边界

1. 在 Project Workspace 里关联 Conversation，点击「打开项目时间线」。每个 Conversation 一条轨道，共享连续真实时间。
2. 「选择来源」可恢复隐藏轨道，也可「显示全部来源」。初次默认最多最近活动的 4 个来源；没有禁止查看全部。
3. 滚轮、左右键和空白拖动保持横向平移；Shift + 滚轮、上下键、PageUp / PageDown 或纵向滚动条浏览其他轨道。
4. 「整理 → 本地候选标签」分析当前项目，Workspace 的「生成项目 Q/A 候选标签」分析关联来源；Reader 也可以只分析当前卡片。
5. Reader 的「本地候选」区可修改候选标题和标签，保存编辑、采用或拒绝。主题特征只作提示，不自动更改人工主题归属。
6. Reader 右上角 × 或 Esc 关闭。已打开其他 dialog 时，Esc 优先交给该弹窗。

Project 时间线和来源 Canvas 共用原有入口、Reader 与 Deploy。Canvas 继续使用原来源项目保存的位置、关系和视口；本轮没有新增跨原始 Project 的 Canvas 关系存储模型。Workspace 跨来源 Deploy 沿用现有虚拟范围。来源内人工关系、批注与主题编辑入口保留；跨原始 Project 的新关系不在本轮支持范围内。

## 2. 初始检查与 Git 安全

- 起始分支：`codex/v1-interactions-hover`，起始 HEAD：`97d8feb`。
- 初始已跟踪文件没有未提交改动，仓库有大量现有未跟踪文件；均未清理、移动或纳入无关提交。
- 未发现适用的 `AGENTS.md`；测试、源码、Schema 均先读取再修改。
- IndexedDB 版本维持 **9**，项目备份 Schema 维持 **3**。没有清库或升级迁移。
- 本轮仅本地提交，没有 push、发布、上传、训练模型或向外部 API 发送聊天。
- 独立阶段提交：`379dd90` 缩放与保存归属；`fa2b11f` 多轨；`817f816` 本地候选；`5c17c6f` Reader 和真实 MV3 导航修复。最终文档、回归补充与容器高度修复在后续本地提交中。

## 3. 缩放失效：确认的机制与证据

### 3.1 名义缩放与实际坐标分离

旧 `horizontalLayout()` 使用 `min((width-48)/visibleSpan, 1000000/fitSpan)` 限制像素比例，却仍将没有按该限制校正的请求值作为 `visibleSpan` 返回。多年跨度连续放大后，名义范围继续缩小，实际节点坐标已不变；此时第一次按 − 也可能仍落在隐含上限内，节点继续不动。

现在 `timeline-viewport.js` 先计算真实有效范围，再供 renderer 和 controller 共用：

```text
usable = viewportWidth - 48
minSpan = max(1000ms, fitSpan × usable / 1,000,000)
maxSpan = max(minSpan, fitSpan × 8)
visibleSpan = clamp(requestedSpan, minSpan, maxSpan)
pxPerMs = usable / visibleSpan
x(t) = 24 + (t - minTime) × pxPerMs
```

达到边界时明确禁用相应缩放按钮。六年跨度、240/1000/1600px 视口的单元回归验证：每次尚未到边界的 + 都实际增加 `pxPerMs`；到上限后第一次 − 即可改变坐标。浏览器回归也检查真实范围或滚动宽度变化，不只检查 click。

### 3.2 旧视图延迟保存读了新项目 ID

旧 `HorizontalTimeline.save()` 从随导航变化的 `owner.projectId` 取保存对象，而 preferences、拖动清理和滚动保存 timer 属于旧 renderer。导航、未完成手势或延迟保存交错时，旧轨道 ID / 视口可能向新项目提交，触发归属检查或错误状态。浅复制还让排队保存中的数组受到后续修改。

现在 renderer 记录自己渲染时的项目 ID；每次保存深复制值并捕获归属，队列执行时再读取该 preference 对象的最新 revision。`show()` 在切换前 capture、detach、flush，且提前使旧 load / Reader epoch 失效。单元测试在排队后修改 owner 项目和轨道数组，断言写入仍属于旧项目且值没有串改。

### 3.3 真实 MV3 才暴露的全局导航模式不同步

Workspace 的新时间线入口最初只调用组件 `show(mode:'timeline')`，全局 `navigatorSelection.conversationMode` 仍可能是 Canvas。真实后台通知或页面重载后，`showCenter()` 按旧模式恢复 Canvas。仅测独立组件不能发现这个问题。

`onScopeChange` 现在同步视图模式和 Workspace ID，`showCenter()` 在相同来源项目下恢复相应虚拟范围，Canvas 则继续回到来源项目。真实 MV3 回归从 Canvas 打开 Workspace 时间线，再进行后台候选审核、页面重载和扩展 `runtime.reload()`，确认双轨仍在且 + / − 仍改变实际滚动范围。

### 3.4 其他排查结果

- 上一轮已有 `viewChanged` 轻量通知，本轮保留并测试「保存偏好不能拆掉正在按下的按钮或节点」。不能把上一轮修复算成本轮新发现。
- 清除了元信息保存后对已不存在的 `horizontal.measureNodes()` 的调用；该调用会在保存完成后抛出错误。
- 新关联来源会被旧选择漏掉：记录 `knownTimelineIds`，只把新来源补到默认少量选择中；人工隐藏和显式空选择保留，移除关联的轨道会从当前偏好中剔除。
- 容器宽度使用实际 scroll clientWidth，并预留稳定滚动条槽，避免多轨纵向滚动条令「适配全部」残留横向溢出。
- 窗口只变高度时，旧 width-only ResizeObserver 不更新 inline 高度。现在 `sizeScroll()` 处理 resize / 容器尺寸变化，不强制重渲染，并在 detach 清理监听器。
- 没有通过提高 z-index 或延迟强制刷新掩盖缩放；未发现需修补的透明遮罩。保留弹窗原有 modal 行为。

以上是代码、单元测试和隔离浏览器确认的机制，不代表已在用户原有 Chrome 配置及私人数据上复现了所有历史卡死情形。

## 4. Scope、共享时间与多轨布局

```text
ProjectWorkspacePanel → OPCTimeline.show → storage/opc.opcState
  来源 Project → 原项目卡片 / 轨道
  Workspace → workspaceScope：以 conversationIds 选择现有卡片 / 轨道
→ opcPage → selectTimeline → horizontalLayout → HorizontalTimeline
```

`timelineScope()` 明确区分 `conversation` 和 `project`；`selectTimeline()` 统一选择轨道、成员和 ACTIVE 卡片，单一来源产生 Conversation Scope，多来源产生 Project Scope。`OPCTimeline.scope` 表示导航所属范围，`layout.scope` 表示当前可见选择的具体范围。

Workspace 不复制 Q/A、不迁移 Conversation、不改卡片的 `projectId`。来源 `timelines` / `memberships` 只读投影进入虚拟范围；浏览偏好以 Workspace ID 独立保存。原稳定 `card.id`、`conversationId` 保留。

所有轨道复用同一 `min/max/pxPerMs`。纵向每轨 100px，同一真实时间在任意轨道得到同一 X。聚合桶键为 `conversationId + floor(x/24)`，相邻来源不会混成一个聚合点；同来源密集 Q/A 继续通过原 clusterDialog 展开。

仅实现真实时间模式，没有压缩长空白。年份明确显示。无时间 Q/A 不绘制伪造刻度，不使用导入时间填充；按来源和原 ordinal 在「时间未知」区访问。适配全部覆盖当前选中轨道；要覆盖所有来源，先显示全部来源。定位最新使用当前选中来源中最晚可信时间，并将对应轨道滚入视野。

Project 内全文搜索会以允许的 `workspaceCardIds` 查询本地全文索引，不会错误地将虚拟 Workspace ID 当成原始 Project ID 过滤掉全部结果。Search 结果仍调用同一个 Reader。

## 5. 本地特征、标题和标签的真实算法

仓库原有 `search-service.js` 的中文 2/3-gram 和英文技术词 tokenizer，以及 `AlgorithmProvider` 的 TF-IDF。没有发现实际加载的 BGE / embedding 模型。本轮提取 `local-features.js` 共用 TF-IDF，并没有另造搜索引擎。

候选流程：

1. Unicode NFKC、大小写和空白规范化，仅处理派生特征。
2. 复用中文 n-gram、英文及 C++ / C# 等技术词；使用浏览器内置 `Intl.Segmenter` 约束可读候选，减少「态闭包」这类跨词碎片。不支持 Segmenter 的环境退回 n-gram。
3. 过滤口语、常见无信息词和纯数字。人工已有标签优先入选，原人工文本始终保留。
4. 加权输入：Q=3、A=0.6、人工标题=2、人工标签=4。每字段最多分析 6000 字符，回答特征窗口最多 3000；完整原文不截断或改写。
5. `weight = (1 + ln(weightedTF)) × ln(1 + N/DF)`，每卡最多保留 256 个特征；再做可读性过滤、词长和重复包含过滤、少量排序加权，输出通常 2–5 个候选。
6. 标题由少量关键词组合，例如「react · resizeobserver · timeline」；这是可编辑的**关键词式标题**，不是自然语言摘要。信息不足时可以少于 2 个标签并显示「待命名」，不会硬造结论。
7. 主题特征候选只展示；现有 Workspace 聚类仍保留人工主题和归属，自动主题名改用关键词，停止将截断的整句提问当 Topic。

每个建议保存 `cardId/conversationId` 和候选特征的词频、文档频率、分数，Reader 可查看选择原因。优先沿用人工标签的原因单独标明。

源码搜索没有发现 `$app` 展示模板；卡片标题使用 textContent。运行时若原始导入问题包含精确 `$app` 标记，会在建议中记录 `source_contains_$app` 并告知来自原文；只从派生特征中排除此精确标记。没有删除所有 `$`，数学公式、代码和原始 Q/A 不动。

## 6. 人工内容、自动建议与缓存如何共存

沿用 `qaMetadata`，新增可选 JSON 字段，无需 Schema 升级：

| 字段 | 含义 |
| --- | --- |
| `title/tags/topic/notes` | 原有人工字段，本地分析和采用候选不覆盖 |
| `localSuggestion` | 候选标题、标签、主题特征、算法版本、来源键、语料键、状态 |
| `autoTitle/autoTags` | 用户明确采用的自动内容，与人工字段分开 |
| `autoProvenance` | 已采用自动内容的算法与来源版本 |

状态是 pending / edited / accepted / rejected。展示优先级为人工标题 → 已采用自动标题 → 原始问题预览。自动 Chip 明确带「自动」，Workspace 未审核内容带「候选」。人工主题不被候选 Topic 改写。

`qaAnalyze` 通过已有本地索引取得原文；`qaReview` 带 metadata revision 做乐观并发检查。来源键含问题版本、回答版本与 ACTIVE 状态；语料键是输入 Q/A、人工标题和标签的 SHA-256，算法键为 `FEATURE_VERSION`。全部匹配时重跑复用建议及其审核状态。来源或算法改变时旧建议不能直接采用；重新分析不会改人工字段，也不会删除已采用内容。

分析前后核对数据库 revision，提交仍做原有事务 revision 检查；并发更新时拒绝本次结果，避免旧正文特征被记到新版本。恢复备份后来源 ID 已映射，旧字符串来源键会失配，建议需要重新生成，人工和已采用内容保留。

删除错误自动标签：在候选输入框中删除该标签后采用；也可「移除已采用的自动内容」，该操作即使来源已变化也可用，不会移除人工标题或标签。编辑后先「保存候选编辑」可持久保留未采用内容。

## 7. Reader 状态与事件流

Timeline 单轨 / 多轨、Canvas、Search、Workspace → `openCard()` / `openIndexedCard()` → `opcDetail()` → 唯一 Reader。Workspace Reader 校验成员归属，人工元信息仍写回该卡片的真实来源项目。

`detailEpoch` 让迟到的异步正文无法覆盖已关闭或已换项目的 Reader。× 是实际 button，`aria-label="关闭详情"`、tooltip 带 Esc；sticky 置于阅读面板右上角，在窄屏和面板内部滚到底部仍可点击。`closeCard()` 隐藏面板、清选中样式、使旧请求失效、保存未完成标注，并在适当时恢复焦点（preventScroll）；不重置 Timeline 范围、Canvas 视口或 Project。

Esc 在已有其他 dialog、已 preventDefault、输入法合成期间不抢占。原「收起详情」按钮已移除。原始正文、复制、批注、判断、关联、搜索命中和 Deploy 入口保留。

## 8. 模块与修改文件

以下路径相对 `apps/navigator-extension/`，完整本轮文件列表也可由 `git diff 97d8feb --name-only` 查看。

- Scope / 坐标 / 缩放：`domain/timeline-scope.js`、`domain/timeline-tracks.js`、`domain/timeline-viewport.js`。
- 本地特征与建议：`domain/local-features.js`、`domain/tag-suggestions.js`、`domain/organization-provider.js`。
- 元信息与显示：`domain/card-metadata.js`、`domain/card-presentation.js`、`domain/card-search.js`、`domain/opc.js`。
- 持久化：`domain/release-data.js`、`domain/backup.js`、`domain/workspace-backup.js`、`storage/opc.js`、`storage/project-workspace.js`、`storage/tag-suggestions.js`、`storage/repository.js`、`storage/search-index.js`。
- UI：`ui/app.js`、`ui/horizontal-timeline.js`、`ui/opc.js`、`ui/project-workspace.js`、`ui/tag-suggestions.js`、`ui/workbench.css`。
- 后台写操作注册：`background.js`；测试入口：`package.json`、`scripts/validate-all.mjs`。
- 新测试：`scripts/validate-timeline-stability.mjs`、`scripts/validate-tag-suggestions.mjs`、`scripts/test-timeline-project-browser.mjs`、`scripts/test-qa-tags-browser.mjs`。
- 原测试适配与扩展：`scripts/test-interactions-browser.mjs`、`scripts/test-interactions-mv3.mjs`、`scripts/test-search-browser.mjs`。

## 9. 实际验证及限制

仅将本轮实际重跑的报告作为证据，不将 dist 内旧报告当本轮结果。

| 测试入口 / 报告 | 本轮结果与范围 |
| --- | --- |
| `npm test` / `dist/OPC_NODE_REPORT.json` | 22 组 Node 测试、330 个 PASS，另有静态检查，共 23 个通过的 suite 条目 |
| `test:timeline-project-browser` / `TIMELINE_PROJECT_BROWSER_REPORT.json` | A–J，跨来源全文定位、× / Esc / 390px、焦点、纵滚、未知时间与加载中关闭，共 14 项 |
| `test:qa-tags-browser` / `QA_TAGS_BROWSER_REPORT.json` | 生成、编辑、采用、拒绝/移除、版本缓存、搜索、重载和备份恢复，5 项 |
| `test:interactions-browser` / `INTERACTIONS_ALL_REPORT.json` | 原 Timeline / Canvas / hover / 关系 / Reader / Deploy，14 项 |
| `test:interactions-mv3` / `INTERACTION_MV3_REPORT.json` | 真实未打包 MV3、后台通知、原生多轨、原生标签审核、页面与扩展重载，6 项 |
| `test:search-browser` / `SEARCH_MANAGEMENT_BROWSER_REPORT.json` | Search 8 项 UI + 5 项数据库检查，含 260px / 390px 和全文尾部定位 |
| `test:project-browser` / `PROJECT_WORKSPACE_BROWSER_REPORT.json` | 200 Q/A / 5 来源，人工整理、Deploy 复制、备份恢复和浏览器进程重启，9 项 |
| `npm run build` + `npm run verify:package` | 源码/安装目录逐字节一致，ZIP 全量解压比对和 SHA-256 检查 |

浏览器使用本机 **Edge/Chromium**，在全新隔离 profile 中仅写入合成数据；真实 MV3 测试实际调用了 `chrome.runtime.reload()`，不是仅重绘组件。没有可用的 Chrome 品牌浏览器路径，因此没有声称完成用户当前 Chrome profile / 私人聊天、线上 ChatGPT 捕获或全部历史故障顺序的人工验收。

初始单会话基线本来通过；增强的多项目、MV3 集成和窗口高度测试先发现失败，修复后才计为通过。最终报告以运行生成的 JSON 为准。需要用户最后在真实 Chrome 中加载交付目录，使用自己的 Project 重复关键动作，尤其含异常导入时间和较大历史数据的情形。

数据兼容性：原始消息/版本/Q/A ID、已保存 Canvas 布局、人工关系和批注有实际前后完整性比较；新增建议随原有 qaMetadata 备份，Workspace 偏好的轨道引用在资料库恢复时映射到新来源。没有改 manifest 权限，没有高风险迁移。

## 10. 复杂度、未实现部分与下一轮建议

设 C 为卡片数、M 为成员数、T 为选择轨道数。布局排序约 O(C log C)，聚合 O(C)；部分轨道选择和着色仍使用数组查找，最坏带有 O(MT + CT)，本轮没有做大规模虚拟化。节点全部进入 DOM，大量历史记录的性能仍需继续测量。默认少量轨道能减轻初次渲染，但不是硬性轨道上限。

本地特征的主要成本是有界文本分词、每卡词表排序和全语料 DF；约 O(总分析字符 + Σ Vᵢ log Vᵢ)，空间含各卡词表和已有全文索引。缓存键摘要还要扫描完整输入文本。Workspace 原有 complete-link 聚类最坏 O(N² × 特征比较成本)，不能宣称是线性或神经语义分析。

尚未实现：压缩长空白的断点模式、BGE 向量、自然语言高质量摘要、跨原始 Project 的 Canvas 关系编辑、新的轨道拖动排序、大规模 Timeline 虚拟化。候选主题只是可审核的特征，无法理解复杂语义或保证词组都合适；人工标题、标签、主题仍是最终依据。

下一轮建议：保持 TF-IDF 为可解释基线；在明确本地运行与模型下载方式后增加可选 BGE provider，先按问题版本缓存向量，再用于语义相似度和相关 Q/A。主题可同时显示关键词权重、相似度、来源证据和人工边界；对比纯 TF-IDF 与混合方案的分组质量。Embedding 用于检索和聚类，不冒充摘要生成。若要自然语言摘要，应另行设计可选、明确授权的本地生成环节，并延续候选 / 人工确认的隔离。
