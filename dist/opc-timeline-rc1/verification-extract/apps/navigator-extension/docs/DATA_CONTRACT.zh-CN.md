# V1 数据契约 · Schema2 / IndexedDB4

V1沿用原数据库名并增量升级到4，新增 documentRecipes、documentPrints、conversationLinks；recoveryPoints独立保存整库恢复点，不进入日常业务STORES和项目备份，避免递归快照。升级不清空旧表或重建业务ID。旧Schema2缺少新数组时规范化为空；方案与关联严格校验确切消息/版本/路径，恢复备份重建所有本地引用。整个资料库外部备份格式为acvn-library-backup，含各项目Schema2备份及完整性校验，导入恢复为新项目。meta.appVersion记录升级恢复点版本，revision CAS继续保护并发写入。

以下V0.3契约保留为原有数据结构与索引背景；V1更新详情见 [交付说明](DELIVERY_V1.zh-CN.md)。

# 浏览器内数据与迁移契约 · 备份 Schema 2 / IndexedDB 3 / V0.3.0

## 数据层级

`Project → Conversation → Path → Segment → QA → Message`。Path 显式承载可靠取得的阅读序列；Topic 是独立项目标签，可关联多段。Conversation 的所有已存 Message 也能直接阅读，不要求它们先进入 Q/A。

IndexedDB 名称保持 `ai-conversation-visual-navigator`，数据库版本升级为 **3**；项目备份仍是 **Schema 2**，这两个版本含义不同。V0.1 / V0.2 的数据库原地增量迁移，不清空旧数据、不重建已有对象 ID。version 1 升级继续补齐旧 Segment 组织状态：旧人工节点默认 `confirmed`，已有复核标记优先映射为 `needs_review`，其余节点为 `unorganized`。

version 3 仅补充查询需要的索引和 `snapshotSummaries` 派生 store：`qas / segments / suggestions / analysisPacks.pathId`，`versions.messageId`，`segments.qaIds`（multiEntry），`messages.conversationOrder`（`[conversationId, firstSourceOrder, id]`）。原有 `projectId / conversationId` 索引继续使用。升级期间由既有 snapshots 生成不含正文、原始图和观察明细的摘要；旧 snapshots 不被改写。首次并发读取共享连接 Promise，升级被旧窗口占用时明确提示关闭旧页面。

兼容 V0.1 中大小写不同的标签名称映射到同一 Topic 后产生的重复 `topicIds`：迁移和 Schema 1 备份规范化仅对 Segment 及历史修订快照的主题引用去重，保留首次顺序，并补齐历史快照组织状态，使旧修改继续可撤销。Q/A 与消息 ID 不去重，重复或不一致仍显式报错；Schema 2 备份继续严格校验主题成员。

所有写入经 `storage/repository.js` 和同一个后台写入队列；事务比较 `meta.revision`，仅提交变更记录。人工编辑与建议编辑另校验 `baseRevision`，避免跨窗口无提示覆盖。项目数据属于当前浏览器用户配置和扩展 ID；升级须继续使用原加载目录和扩展身份。

| Store | 实际关键字段与引用 |
| --- | --- |
| projects | id、name、createdAt、displayTimezone；本地名称不从来源文件名生成身份 |
| conversations | id、projectId、platform、sourceConversationId、sourceUrl、identity、nativeProject、sourceTime、currentPathId、currentPathStatus、lastScope、revision |
| messages | id、conversationId、sourceMessageId、sourceNodeId、parentMessageId、sourceParentKey、role、text、presentation、contentTypes、attachments、contentStatus、time、bodyHash、currentVersionId、versionIds、identity、latestObservation；源节点 ID 不伪装成源消息 ID |
| versions | id、messageId、previousVersionId、snapshotId、bodyHash、text、presentation、role、contentTypes、attachments、contentStatus、raw、capturedAt；正文或取得的结构表示变化时新建，不覆盖旧版本 |
| snapshots | id、conversationId、method、scope、diagnostics、capturedAt、sourceUrl、fileSource（文件名 / UTF8 解码文本 SHA256 / hashBasis）、messageIds、messageVersionIds、observations、graph、pathIds、selectedPathId、warnings、rawSource、stats |
| snapshotSummaries | 派生的对话采集摘要：id、projectId、conversationId、capturedAt、method、scope、warnings、diagnostics、stats、messageCount、graphNodeCount、pathIds；不含 rawSource、graph、observations、messageVersionIds 或正文；不进入项目备份 |
| paths | id、conversationId、messageIds（有序且不重复）、lastCapturedMessageIds、sourcePathKeys、status、scope、snapshotIds；可靠当前指针与浏览选择区分 |
| qas | id、conversationId、pathId、ordinal、userMessageId、responseMessageIds、assistantMessageIds、toolMessageIds、status、preview、time、notSeenInLatest |
| segments | id、conversationId、pathId、qaIds（明确有序成员）、title、topicIds、manual、active、revision、needsReview、reviewReason、replacementIds、ordinal、time、organizationStatus；已确认整理另有 organization 原文证据与方法来源 |
| topics | id、projectId、name、color、aliases；同项目仅按规范化名称精确复用，不进行语义自动合并 |
| revisions | id、conversationId、pathId、operation、actor、before / after Segment 快照、createdAt、undoneBy；organization 操作另存 suggestionId，整次撤销生成反向记录 |
| drafts | 采集 / 导入预览、原始输入、选择来源、results、failures、targetProjectId、createdAt、sequence；逐条成功记录用于中断后避免重复提交。最新预览按时间及持久序号选取，不依赖 IndexedDB 主键顺序 |
| suggestions | id、projectId、conversationId、pathId、revision、status、method、requestedRangeQAIds、rangeQAIds、beforeSegments、groups、sourceVersion、navigationVersion、warnings；模型建议另存 analysisPackId、allowedEvidence；确认关联 appliedRevisionId |
| analysisPacks | id、projectId、conversationId、pathId、sourceVersion、navigationVersion、requestedRangeQAIds、rangeQAIds、beforeSegments、batches；每批包含核心与相邻上下文 QA ID、完整 Q/A 和消息 / 版本证据 |
| meta | 全局 revision；用于 IndexedDB 原子提交冲突检查 |

时间统一保存 ISO UTC 与来源字段，中文界面按 Asia/Shanghai 展示。`time.value=null`、`precision=unknown` 表示未知；`capturedAt` 不参与讨论发生时间排序。Message 保留当前正文便于搜索，versions 保留不可变历史正文，snapshot.messageVersionIds 指向当次确切版本。

`snapshotSummaries` 是可重新派生的查询缓存，权威采集记录仍是 `snapshots`。保存、恢复或删除 snapshot 时，在同一提交事务内更新 / 删除对应摘要。它不属于导出记录或引用校验对象，不以缓存替代原文证据。升级生成摘要需要遍历历史 snapshots；此一次性迁移仍可能读取大记录。

## 采集诊断与真实覆盖

ChatGPT 适配器 `chatgpt-dom-v3` 集中保存角色、正文、稳定消息 ID、父 ID、轮次、附件、生成控件和项目属性选择器。选择器沿用 V0.2.1 代码并增加结构提取与可见性处理；本轮合成样例验证不代表已观察登录后当前 ChatGPT 的 DOM，也不代表真实 MV3 授权已验收。

失败区分 `unsupported_page`、`messages_not_loaded`、`structure_unrecognized`、`source_tab_closed`、`access_denied`、`page_changed` 和 `duplicate_source_ids`；正文缺失、生成中、附件仅引用和部分范围以成功采集中的状态表达。没有任何消息时，加载标记 / 已知轮次容器仅用于保守区分“尚未取得”与“结构不能识别”，不猜测账号登录状态。用户滚动后重采走原增量身份规则，不删除本次未展示的已存消息。

`diagnostics` 保存适配器版本、页面类型、消息 / 角色 / 源 ID / 生成 / 正文缺失 / 结构 / 附件计数、能力、缺失原因和诊断技术详情；它进入每次采集 snapshot，并作为预览依据。`scope.coverage.fullHistory=unknown`，`history=unknown_unloaded`，`branches=not_collected`。数量只描述当前已加载且可识别的 DOM，不表示完整对话；未展示分支、来源时间和原生项目归属不能确认时保持未知。650 ms 的未变观察记录 `stable_observed`，不证明回答已完成。

可复制诊断通过 `ui/diagnostics.js` 的严格白名单重新生成：默认只包含适配器版本、页面类型、计数、能力及预定义中文错误 / 状态原因，不复制原始技术异常、正文、账号、来源地址、标题、项目名或消息 ID。来源链接 / 标题等额外字段只有在界面先展示附加内容并由用户勾选后才进入 `userAttached`，不会自动发送到外部。

## 原始正文与安全排版

`text` 永远保存原始取得的可读文本；排版由 `presentation` 选择，不将摘要、地图标题或整理理由当作正文。导入文本使用 `format=markdown` 或 `plain`，显式普通文本保持普通文本；Markdown 原文不被转换成 HTML 后回写。

DOM 采集只有实际取得代码、表格、段落、标题、列表、引用和行内代码结构时，才保存 `format=dom-structured`、`source=dom`、`status=verified_structure`、`blocks`。代码以 text / language 保存；表格以 headers / rows 的字符串数组保存；不保存可执行来源 HTML。结构化块按原顺序投影的可读字符必须与原始正文去空白后完全一致，否则整条回退 `plain / text_only`，原始完整正文仍保留。DOM 中看起来像 Markdown 的普通文字不会被猜成页面结构。

新保存正文的 `bodyHash` 包含 role、text、contentTypes、attachments、contentStatus 和 presentation。正文相同但取得的格式信息变化也可能生成新版本；旧历史 text / presentation 不被替换或批量猜测补齐。旧记录没有 presentation 时默认安全普通文本。渲染与原文分开，支持复制整条、复制代码、完整原文展开和独立历史版本排版。

本地排版使用安全 DOM 元素，不直接插入来源 HTML；链接协议受限，外部图片默认只显示引用，公式保留原表达式。长文折叠只影响显示；搜索高亮仍映射到完整原始字符范围。定位整理证据时读取指定消息与对应 versionId，明显标注历史版本并展开确切正文，不以最新正文冒充历史。

## 读取范围与事务边界

`storage/database.js.readSnapshot()` 为查询描述建立只读事务；多阶段查询校验各阶段 `meta.revision` 相同，最多重试 3 次，仍变化时明确拒绝混合快照。查询缓存只在本次读取内使用。当前读取接口如下：

| repository / RPC 入口 | 读取与保留的范围 |
| --- | --- |
| projects | 项目记录与对话身份 / projectId 投影，用于项目计数；不读消息正文 |
| view | 所选项目的对话、路径、Q/A、主题、分段导航、建议摘要及撤销状态；不加载其他项目或整理包 batches；有建议时只补取相关路径的消息 / 当前版本签名投影 |
| qa | 指定 QA、其对话 / 路径头、关联活动 Segment、该问题及回答组的消息和当前版本；不读取全对话正文或所有历史版本 |
| messageVersions | 用户展开历史时，按 messageId 索引读取该消息的历史版本；不读取其他消息版本 |
| conversation | 该对话路径与采集摘要，按默认 35 / 最多 80 条消息分页取得正文；指定 targetMessageId 定位所在页，targetVersionId 额外按键取得确切历史版本 |
| search | 所选项目对话 / Q/A 导航，逐对话索引游标扫描当前完整正文，只保留当前结果页与总计；默认 35 / 最多 80 结果，提供 nextOffset，无固定结果上限 |
| organizationContext | 该对话及其路径的当前正文、导航与建议；不读取无关项目或所有 analysisPacks 正文 |
| organizationSuggestion | 指定一份建议，加其对话源 / 导航的签名投影；不读取其他建议 groups 或整理包 batches |
| backup | 只按所选项目读取全部权威关系、历史原文与整理包，用于完整导出；不会压缩或省略证据 |

按索引的游标投影减少跨项目读取和持久保留量，但 IndexedDB 仍先物化所访问的完整行，再做 JavaScript 投影；不能把 retainedBytes 等同于实际 loaded / serializedBytes。地图路径和 Q/A 导航仍按整个所选项目读取。搜索每页为取得准确总数会重新扫描所选项目当前正文，不是倒排全文索引；分页限制结果内存，不截断原文或隐去后续结果。

所有写操作仍以整库 `readState()` 和副本进行领域校验，最终只在一个比较全局 revision 的原子事务提交变更。确认、撤销、备份恢复和主题影响检查仍重算相关签名，不让查询投影或缓存掩盖源更新。大导入、写入、大备份与整理包正文副本仍是下一轮优化点；本版本没有声称全操作均已范围化。

新采集把该消息的小型 `latestObservation` 同时保存到 Message，单轮阅读无需加载可能包含整份导出文件的 snapshot.rawSource。旧消息缺少该字段时返回 `null`，界面用未知 / 未按需提供表达；原 snapshot.observations 仍在备份里，不为补一个显示字段而默认载入大原始文件。无 firstSourceOrder 的旧恢复记录在完整对话读取时使用仅该对话身份 / 顺序投影兜底，不漏掉原文。

## 逻辑身份与安全的增量规则

源对话 ID 在同平台内优先匹配；备份恢复产生副本时优先在用户选定项目中匹配。没有 ID 的稳定实际来源地址可作回退。ChatGPT 首页地址不作为对话身份；完全没有可靠身份时，仅同一份文件哈希与记录位置可用于重导相同文件，不把标题或单条文本当作逻辑身份。

Message 首选对话内源 ID；缺失时使用唯一的有序双消息上下文及相邻锚点。流式无 ID 内容变化需双侧锚点，或末尾位置提示、邻接锚点和正文前缀共同支持。所有回退记录 `basis` 和 `confidence=uncertain`。不同可靠源 ID 不因正文相同而合并，歧义不强行覆盖。

有重合且源序兼容的路径保留旧成员、插入新成员；两边都在同一锚点区间出现不同成员时另存分支，无重合时另存不连续采集范围。每次导出的独立分支不在同一快照内互相扩展。旧消息、旧路径和其人工分段保留；没有把未出现推断为源删除。

## Q/A 与 Segment 约束

Q/A 不依赖模型。每条路径从用户消息开始，到下一条用户消息之前形成回答组；工具、系统和未知角色作为相关辅助成员保留，开头未归属用户的问题前置消息在 Conversation Reader 可读。无助手回答也产生索引；内容缺失、生成中和部分范围分别显示。

QA ID 由本地 path ID 与用户 message ID 派生，Segment 成员直接引用 QA ID，地图、搜索和阅读器共享这些 ID。在同一路径内，有效 Segment 覆盖全部 QA、无重复且成员连续。合并只允许同一对话同一路径源序相邻节点；拆分只允许真实成员边界。其他分支单独表达。

人工名称、主题和外侧边界不在更新时重置。补采进入同一段内部的新 QA 时维持原边界连续性并标记复核，不隐藏新内容。来源映射不确定时分开保留，避免套用人工修订。合并后的旧节点以 inactive / replacementIds 保留；拆分保留第一段 ID，记录第二段替代引用。撤销检查当前相关成员形状，不覆盖已经改变的成员。

## 整理建议、确认与版本

`suggestions` 与已生效的 `segments` 分开保存。建议状态为 `pending`、`confirmed`、`rejected` 或 `needs_review`；地图节点的组织状态为 `unorganized`、`confirmed` 或 `needs_review`，待确认状态由该节点所在路径的待处理建议共同表达。生成、修改、拒绝、取消预览均不会直接重写有效分段。

每个建议组保存 `title`、`topics` 名称数组、连续有序 `qaIds`、`reason` 和 `evidence[{qaId,messageId,versionId}]`。模型结果的每个成员至少需一条整理包允许的原文证据。成员必须恰好覆盖 `rangeQAIds`；如果用户选定端点处于旧片段内部，范围扩展到完整片段边界，并提供警告。未整理范围继续保留原节点，因此有效 Segment 仍覆盖整条路径。

`sourceVersion` 是所选路径消息顺序、当前正文版本、角色 / 内容状态和 Q/A 索引的 SHA-256 签名；`navigationVersion` 是当前有效 Segment 的 ID、修订号、成员、标题、主题 ID / 名称和人工 / 复核状态的 SHA-256 签名。它们不是来源平台的版本号。确认前重算签名，正文、阅读顺序或导航发生变化时要求重新生成，不静默采用旧建议。

规则建议使用 `method.kind=rules`；导入语义结果要求 `method.kind=model`、实际模型名称和分析版本。规则先保留人工或已确认片段；外部建议改变这些设置时，预览列出冲突，用户须明确复核。确认通过引用与分区校验后，在同一事务内更新 Segment、建议状态和 `operation=organization` 批量修订。

已确认 Segment 的 `organization` 保存 `suggestionId`、`revisionId`、分析方法、源签名、理由、证据和 `qaSignatures[].messageVersionIds`。补采或正文版本变化时仍保留标题、标签及人工边界，并标记需要复核；阅读器持续使用真实 QA / Message 引用读取完整内容。撤销整次整理恢复修改前节点并记录反向修订，不能覆盖其后已经改变的分段。

V0.2.1 中，重命名和改主题只修改导航，保留原整理证据 / 签名。拆分按成员分配原证据；合并保留两侧原证据，首段未整理时可继承后段组织记录并标记 `inheritedViaMerge=true`。新纳入且无历史签名的成员记录编辑时的当前引用。拆合不清除已有 `needsReview`。这些人工边界编辑不代表模型或规则重新分析过正文。

指纹缓存仅属于一次只读快照请求；同一路径的多个建议共享计算，不跨请求复用。写入、确认和冲突检查仍重新计算。源签名形状保持 V0.2.1 的当前版本引用及 bodyHash（旧无 hash 时保留正文回退）；纯读取投影不会改签名。重新采集取得新的 presentation 时会形成新正文版本，因此建议可能正常过期；历史建议 / 证据继续保留，提示重新生成，不能静默采用。

整理包格式为 `acvn-organization-pack`、格式版本 `schemaVersion=1`；这是独立交换格式，不是项目数据库 Schema 2。包提供每批 `coreQAIds` 和前后各最多两轮 `contextQAIds`；上下文仅帮助分析，不重复成为批次成员。外部结果使用 `acvn-organization-result`、`schemaVersion=1`，可以提交完整 `groups`，或汇总全部批次的 `batches` 后导入。缺少批次、重复成员、错误消息 / 版本引用或跨路径引用均拒绝，不改变原地图。

## 主题修改与影响范围

同项目按规范化名称精确复用 Topic，同一 Topic 的颜色用于所有关联节点。重命名保留颜色；合并保留目标主题的颜色，并保留旧名称为别名。不会把同名主题推断为因果关系。

重命名 / 合并先返回受影响有效节点、对话、建议、历史修订和整理包数量，以及 `token`。提交时重算影响签名；全局 revision 或相关记录已变化则要求重新预览。操作更新当前及历史 Segment 快照的主题引用，防止撤销产生悬空标签；受影响待确认建议标记复核。移动对话、将备份恢复至已有项目时，同名主题复用目标项目现有颜色。

## 导入、来源与备份

ChatGPT mapping 的根、空消息节点、parent 和 children 在采集快照原始图及 rawSource 中保存；叶链还原路径，有 current_node 则记录可靠当前路径。断链、循环或未连通消息不静默删除，存为部分 / 未知路径。现有通用 JSON 的缺失 ID 不由位置伪装成平台源 ID；缺失 parent 不由上一条消息伪造。

V0.3.0 项目备份 `format=acvn-project-backup`、`schemaVersion=2`、`extensionVersion=0.3.0`，含 project 和所有项目关系 stores，包括 suggestions、analysisPacks、presentation 与采集 diagnostics，不导出临时 drafts / meta 或 snapshotSummaries 缓存。仍可读取 V0.1 的 `schemaVersion=1` 和 V0.2 / V0.2.1 的 Schema 2 备份；规范化副本补充缺少的建议 / 整理包数组和旧节点组织状态，不改用户导入的原始载荷。缺少 presentation 的旧正文保持普通文本。

恢复校验引用、消息 / 版本归属、路径、证据和有效 Segment 分区，重分配本地对象 ID，并按新 path / question 引用重建稳定 QA ID；只重映射本地引用字段，不改平台 ID、原始 JSON 和来源图。正文版本链、Segment 成员、整理依据和人工修订一起保留。附件只有引用时，恢复也保留“正文未取得”状态。

V0.2.1 进一步拒绝循环版本链、当前版本不在历史内、Q/A 轮次 / 回答组与原路径不一致及漏掉用户轮次。补采到遗漏的用户问题会改变当前回答归属；旧证据不能按当前归属直接判错，须从该路径有序快照重放已观察到的消息，证明引用版本曾存在且当时属于该用户问题。不存在对应历史采集依据的跨 Q/A 证据仍拒绝。

本地 ID 重建会改变签名。恢复后的建议与整理包标记 `restoredRefState=requires_regeneration` 和 `restoreReason`；未确认建议进入 `needs_review`，需重新生成建议 / 导出整理包后才能确认或导入对应模型结果。历史已确认 / 已拒绝记录与证据继续保留，已生效的地图仍可阅读和追溯。V0.1 / V0.2 旧程序不能直接打开 version 3 数据库，不能通过简单降级源码回退。

## 复用旧工程的范围

本次先阅读 `docs/PROJECT_ASSESSMENT_2026-09-24.md`、`docs/PLUGIN_PIVOT_ASSESSMENT_2026-10-02.md` 和用户 PDF 的原文 / 关系 / 编辑 / 插件 / 迁移章节，再参考 `ai_memory/connectors`、`qa.py`、`fragments.py`、`service.py`、`tree.py` 相关实现。

迁移原导入预览与规范化来源设计、正文版本保全、消息 → 问答映射、按用户轮次的连续分组、精确主题名称复用、人工覆盖优先和事务修订原则。修正旧版只配直接父用户的单回答 Q/A、漏未答问题、分支时间平铺及整份文件哈希充当对话身份等边界。Python 工程保留，首版无服务桥接和模型依赖。
