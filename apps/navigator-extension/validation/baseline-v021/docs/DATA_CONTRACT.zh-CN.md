# 浏览器内数据与迁移契约 · Schema 2 / V0.2

## 数据层级

`Project → Conversation → Path → Segment → QA → Message`。Path 显式承载可靠取得的阅读序列；Topic 是独立项目标签，可关联多段。Conversation 的所有已存 Message 也能直接阅读，不要求它们先进入 Q/A。

IndexedDB 名称保持 `ai-conversation-visual-navigator`，数据库版本升级为 2。V0.1 的 version 1 数据库原地迁移：仅补充缺失 store / index 和 Segment 组织状态，不清空旧数据、不重建已有对象 ID。旧人工节点默认 `confirmed`，已有复核标记优先映射为 `needs_review`，其余节点为 `unorganized`。

兼容 V0.1 中大小写不同的标签名称映射到同一 Topic 后产生的重复 `topicIds`：迁移和 Schema 1 备份规范化仅对 Segment 及历史修订快照的主题引用去重，保留首次顺序，并补齐历史快照组织状态，使旧修改继续可撤销。Q/A 与消息 ID 不去重，重复或不一致仍显式报错；Schema 2 备份继续严格校验主题成员。

所有写入经 `storage/repository.js` 和同一个后台写入队列；事务比较 `meta.revision`，仅提交变更记录。人工编辑与建议编辑另校验 `baseRevision`，避免跨窗口无提示覆盖。项目数据属于当前浏览器用户配置和扩展 ID；升级须继续使用原加载目录和扩展身份。

| Store | 实际关键字段与引用 |
| --- | --- |
| projects | id、name、createdAt、displayTimezone；本地名称不从来源文件名生成身份 |
| conversations | id、projectId、platform、sourceConversationId、sourceUrl、identity、nativeProject、sourceTime、currentPathId、currentPathStatus、lastScope、revision |
| messages | id、conversationId、sourceMessageId、sourceNodeId、parentMessageId、sourceParentKey、role、text、contentTypes、attachments、contentStatus、time、bodyHash、currentVersionId、versionIds、identity；源节点 ID 不伪装成源消息 ID |
| versions | id、messageId、previousVersionId、snapshotId、bodyHash、text、role、contentTypes、attachments、contentStatus、raw、capturedAt；正文变化时新建 |
| snapshots | id、conversationId、method、scope、capturedAt、sourceUrl、fileSource（文件名 / UTF8 解码文本 SHA256 / hashBasis）、messageIds、messageVersionIds、observations、graph、pathIds、selectedPathId、warnings、rawSource、stats |
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

指纹缓存仅属于一次只读快照请求；同一路径的多个建议共享计算，不跨请求复用。写入、确认和冲突检查仍重新计算，签名内容及排序与 V0.2.0 一致。

整理包格式为 `acvn-organization-pack`、格式版本 `schemaVersion=1`；这是独立交换格式，不是项目数据库 Schema 2。包提供每批 `coreQAIds` 和前后各最多两轮 `contextQAIds`；上下文仅帮助分析，不重复成为批次成员。外部结果使用 `acvn-organization-result`、`schemaVersion=1`，可以提交完整 `groups`，或汇总全部批次的 `batches` 后导入。缺少批次、重复成员、错误消息 / 版本引用或跨路径引用均拒绝，不改变原地图。

## 主题修改与影响范围

同项目按规范化名称精确复用 Topic，同一 Topic 的颜色用于所有关联节点。重命名保留颜色；合并保留目标主题的颜色，并保留旧名称为别名。不会把同名主题推断为因果关系。

重命名 / 合并先返回受影响有效节点、对话、建议、历史修订和整理包数量，以及 `token`。提交时重算影响签名；全局 revision 或相关记录已变化则要求重新预览。操作更新当前及历史 Segment 快照的主题引用，防止撤销产生悬空标签；受影响待确认建议标记复核。移动对话、将备份恢复至已有项目时，同名主题复用目标项目现有颜色。

## 导入、来源与备份

ChatGPT mapping 的根、空消息节点、parent 和 children 在采集快照原始图及 rawSource 中保存；叶链还原路径，有 current_node 则记录可靠当前路径。断链、循环或未连通消息不静默删除，存为部分 / 未知路径。现有通用 JSON 的缺失 ID 不由位置伪装成平台源 ID；缺失 parent 不由上一条消息伪造。

V0.2.1 项目备份 `format=acvn-project-backup`、`schemaVersion=2`、`extensionVersion=0.2.1`，含 project 和所有项目关系 stores，包括 suggestions、analysisPacks，不导出临时 drafts / meta。仍可读取 V0.1 的 `schemaVersion=1` 和 V0.2.0 的 Schema 2 备份；规范化副本补充缺少的建议 / 整理包数组和旧节点组织状态，不改用户导入的原始载荷。

恢复校验引用、消息 / 版本归属、路径、证据和有效 Segment 分区，重分配本地对象 ID，并按新 path / question 引用重建稳定 QA ID；只重映射本地引用字段，不改平台 ID、原始 JSON 和来源图。正文版本链、Segment 成员、整理依据和人工修订一起保留。附件只有引用时，恢复也保留“正文未取得”状态。

V0.2.1 进一步拒绝循环版本链、当前版本不在历史内、Q/A 轮次 / 回答组与原路径不一致及漏掉用户轮次。补采到遗漏的用户问题会改变当前回答归属；旧证据不能按当前归属直接判错，须从该路径有序快照重放已观察到的消息，证明引用版本曾存在且当时属于该用户问题。不存在对应历史采集依据的跨 Q/A 证据仍拒绝。

本地 ID 重建会改变签名。恢复后的建议与整理包标记 `restoredRefState=requires_regeneration` 和 `restoreReason`；未确认建议进入 `needs_review`，需重新生成建议 / 导出整理包后才能确认或导入对应模型结果。历史已确认 / 已拒绝记录与证据继续保留，已生效的地图仍可阅读和追溯。V0.1 程序不能直接打开 version 2 数据库，不能通过简单降级源码回退。

## 复用旧工程的范围

本次先阅读 `docs/PROJECT_ASSESSMENT_2026-09-24.md`、`docs/PLUGIN_PIVOT_ASSESSMENT_2026-10-02.md` 和用户 PDF 的原文 / 关系 / 编辑 / 插件 / 迁移章节，再参考 `ai_memory/connectors`、`qa.py`、`fragments.py`、`service.py`、`tree.py` 相关实现。

迁移原导入预览与规范化来源设计、正文版本保全、消息 → 问答映射、按用户轮次的连续分组、精确主题名称复用、人工覆盖优先和事务修订原则。修正旧版只配直接父用户的单回答 Q/A、漏未答问题、分支时间平铺及整份文件哈希充当对话身份等边界。Python 工程保留，首版无服务桥接和模型依赖。
