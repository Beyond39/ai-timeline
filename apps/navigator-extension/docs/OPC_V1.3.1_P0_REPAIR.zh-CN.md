# OPC Timeline 1.3.1：导入与数据正确性专项交付

本轮沿用原 MV3、原生 ES Modules、IndexedDB 和现有阅读、备份、导出流程。未新增关系画布功能，未重设计 UI。当前分支内同一轮的全部有效正文集中到一张卡片、一份回答中；常规文档导出与打印也集中输出，保留各片段的来源版本。

## 技术根因

1. `domain/opc.js` 原来遍历所有历史路径，再用同一用户消息的最后一次投影覆盖卡片。当前路径优先并不能证明没有混入历史分支；缺失 current_node 时仍会遍历其他路径。
2. `domain/captures.js` 的阅读路径采用 unionOrder 保存历史成员。直接用这个累计成员集合投影，会把本次没有选中的旧回答带入。现在原累计路径继续用于来源归档，正式卡片只读取 `lastCapturedMessageIds`。
3. 原来“存在可读文字”即 answered。结构化采集白名单没有 end_turn、finish_details，正文 hash 也未包括完成状态，因此仅状态变化不会生成独立来源版本。
4. 原状态过滤使用“思考了／已搜索”等正文正则，既会误判正常回答，又无法识别真正的工具状态。现在只依据角色、channel、recipient、内容类型、状态字段。
5. 旧全文阅读器逐个绘制响应消息，所以出现 A1.1、A1.2、空卡和重复控件。现在正常全文与详情使用统一卡片投影，响应正文集中显示；来源树和版本查看仍用于排查。
6. 原富文本转换全局删除大括号内容；同时遇到混合代码块就跳过整个转换。现在代码区是不可变的转换边界，组件区转静态内容或安全诊断。
7. 旧投影没有明确状态机和错误卡片修复归档。旧节点上不同用户编辑可能无法映射到正式问答；现在先保存修复前原貌，可靠映射的编辑合并，冲突和孤儿继续保留。

## 实际修改文件

| 文件 | 作用 |
| --- | --- |
| `adapters/conversation-data.js` | 来源消息白名单增加 end_turn、finish_details，继续只读同源采集 |
| `importers/json.js` | 标准化完成证据，保留 raw |
| `domain/qa-validity.js`（新增） | 基于证据判断 ACTIVE / HIDDEN_INVALID / PENDING |
| `domain/qa-content.js` | 去除正文关键词判断；过滤结构化工具／取消记录；安全静态转换 |
| `domain/captures.js` | 状态变化进入不可变版本；不保留陈旧当前分支；用户消息不使用正文上下文去重 |
| `domain/opc.js` | 当前分支投影、稳定逻辑身份、可靠别名、正常列表有效性筛选与不变量校验 |
| `domain/qa-repair.js`（新增） | 旧卡修复、归档、用户编辑合并、关系／成员／坐标重映射 |
| `storage/database.js` | IndexedDB V7 增加 qaRepairArchives，沿用原 revision 事务机制 |
| `storage/opc.js` | 投影升级检测、确切正文版本读取、集中完整回答 |
| `domain/backup.js` | 旧备份规范化迁移；归档、逻辑身份及正文版本引用随备份恢复 |
| `ui/opc.js` | 详情集中显示完整回答；待确认／隐藏数量说明 |
| `ui/conversation-map.js` | 正常全文只读 ACTIVE；切换视图重新筛选；取消 A1.x 正文分拆 |
| `ui/body.js`、`ui/math.js`（后者新增） | Markdown 与本地 MathML；复杂公式保留表达式，不执行宏 |
| `storage/document-export.js`、`domain/document-export.js`、`domain/document-recipes.js` | 常规导出选当前有效正文，打印与资料包传递同轮身份 |
| `exports/content.js`、`exports/render.js`、`exports/docx.js` | 同轮多片段集中排版；来源附录保留所有片段版本；静态组件转换 |
| `domain/common.js`、`manifest.json`、`package.json`、`workspace.html`、`sidepanel.html` | 版本统一为 1.3.1 |
| `validation/qa-p0-fixtures.mjs`、`validation/qa-p0-scenarios.mjs`（新增） | 明确标注的合成回归输入与逐项结果 |
| `validation/qa-p0-browser.html`、`validation/qa-p0-browser.js`（新增） | 隔离真实 IndexedDB 的浏览器迁移、事务、重启、DOM 验收 |
| `scripts/validate-qa-p0.mjs`（新增）、`scripts/validate-all.mjs` | 专项报告及全量测试入口 |
| `scripts/validate-opc.mjs`、`scripts/validate-opc-improvements.mjs`、`scripts/validate-reader.mjs` | 旧测试改为提供明确的完成／状态证据，验证新状态规则和公式排版 |

## 身份和状态

卡片 ID 保留既有本地身份，逻辑键是会话与逻辑用户消息。`logicalUserMessageId` 固定，`userMessageId` 指向当前实际提问，`userMessageAliases` 记录由可靠来源图确认的同一用户槽。只有可靠图中具有相同父节点的用户兄弟分支才作为同槽编辑／重试归并。两个线性用户消息，即使文字相同、时间相邻，也不擅自合并。

对于 DOM 中共享同一可靠来源边界的记录，仅在该边界内某个角色唯一时使用身份匹配。未标识用户消息不再使用正文、相邻文字、字数或时间推断同一身份。这可能保留无法证实的重复观测，但不会误删真实提问。

| 状态 | 条件 | 正常时间线 |
| --- | --- | --- |
| ACTIVE | 可读最终正文，相关片段状态明确完成，ChatGPT 末段 end_turn=true | 显示完整有效回答 |
| HIDDEN_INVALID | 当前末段明确取消／失败，或已完成却无可读最终正文；完整来源图确认不在所选分支 | 隐藏，保留来源与全部用户编辑 |
| PENDING | 生成中、没有读到回答、未确定当前分支，或完成证据缺失 | 暂不作为有效问答显示，保留原数据 |

generic JSON 明确提供 complete/completed 时按其给定完成语义处理；ChatGPT finished_successfully 只代表消息成功，不代替 end_turn。不会因为最后一个片段有文字就假定整轮完成。分析、工具和取消片段可以保留在原始链中，但不进入阅读正文。

部分页面历史未加载不是删除信号。未观测卡片不删除、不清除标注；来源分支未知时也不会自动选择旧分支。一次采集失败不会写入空快照替换已有资料。

`answerVersionIds` 保存正式回答的确切不可变版本。`validity` 保存原因、检查时间与快照。正文来源版本与 qaMetadata、memberships、relationships、canvasLayouts 分离，同步不会覆盖人工编辑。

## 迁移与恢复

- IndexedDB 从 V6 升到 V7，新增 `qaRepairArchives`，原始 messages / versions / snapshots 不删除。
- 应用版本升级继续使用原 memory 恢复点机制。修复前完整项目副本仍能通过现有资料恢复功能读取和恢复。
- Q/A 投影从 2 升为 3。旧卡在重新投影前保存修复前原貌和编辑引用；该归档和修复在同一 revision 校验的写事务内提交。
- 可证明属于同一提问的片段卡归并：标签取并集，备注保留并合并，成员去重，关系及坐标重映射。两个不同标题不能同时成为主标题，冲突标题完整保存在归档中。
- 无法证明起始提问身份的节点从正式投影移出，旧正文来源保留，编辑、关系、位置保存在 `qaRepairArchives.original`；`unresolved` 记录待恢复 ID，`mappings` 记录可靠映射依据。
- 项目／资料库 JSON 备份包含 qaRepairArchives。需要手动找回孤儿编辑时，在备份中搜索原节点 ID、`notes` 或 `unresolved`，核对来源后通过现有卡片备注／标签编辑恢复。不会按相似标题自动安置到另一张卡片。
- 旧打印快照、历史资料包及来源版本保持原来确切来源语义；新建常规导出以当前有效卡片筛选。

## 实际验证

执行：`node scripts/validate-all.mjs`。15 个 Node 测试套件通过，包含 16 个 P0 场景；静态模块链接和打包校验另行执行。专项每项输入、预期和实际结果见 `dist/OPC_P0_REPORT.json`。

| 场景 | 实际行为 |
| --- | --- |
| 普通完整 Q/A | 一张 ACTIVE，缺提问时间仍为 null |
| 多中间状态＋多段最终回答 | 两段正文合并为一卡／一个导出、打印回答，所有原始记录保留 |
| 生成后取消 | PENDING→HIDDEN_INVALID，未显示旧分支答案 |
| 完整切无效分支 | 同一卡隐藏，备注、标签、主题成员保留 |
| 无效恢复完整 | 原 ID 恢复，无新增重复卡 |
| 三次重复导入 | 同一卡／同消息，只有状态改变才增加版本 |
| 不同轮次同文提问 | 保留两张 ACTIVE |
| 取消重试／多个模型分支 | 有图证据同槽保持 ID；线性再次提问保留第二卡 |
| Markdown、组件与代码混合 | 标题、列表、表格可读；代码符号保留；动态内容明确降级 |
| 旧污染数据迁移 | 编辑／关系／坐标重映射，孤儿归档，备份恢复成功 |
| 部分历史／未知当前分支 | 不删除未读旧卡；未知分支 PENDING，不回退 |
| 无完成证据 | 长文本和“搜索／思考”字样均不参与判断，保持 PENDING |
| 2,000 轮＋20 万字末答案 | 2,000 ACTIVE，列表 60 摘要，20 万字尾部完整 |
| 取消片段后新完成正文 | 仅新完成正文生效，嵌套工具参数不展示 |
| 旧分支重复卡／冲突标注／恢复重同步 | 同槽一身份，备注标签保留，冲突标题归档，恢复无重复 |
| 迁移后同身份正文更新 | 原卡显示新全文，旧阅读缓存不遮蔽新版本，原始版本不改写 |

本地浏览器执行真实 IndexedDB V6→V7、恢复点读取、四种分支状态同步、重复导入、revision 冲突、Markdown／MathML DOM、来源树返回正常全文、页面重启恢复。报告见 `dist/OPC_P0_BROWSER_REPORT.json`。这些验证来自隔离本地页面，复用产品模块；不能作为安装后的 MV3 或真实 ChatGPT 网站验收结果。

性能数字记录在各报告中，是该设备与合成数据下的测量，不是所有真实长对话的性能保证。

## 尚未完成的实站验收与限制

用户本轮没有真实历史导出样本，也没有提供可验证的真实 ChatGPT 对话。本轮真实历史样本回归、安装后 Chrome MV3 导入和真实 ChatGPT 长对话验收均未测试，不宣称全部验收通过。

没有可靠完成字段的 DOM／旧导入数据会保持 PENDING。需要从当前 ChatGPT 对话重新完整读取以取得证据，不能靠长度、关键词或等待时间猜测完成。

动态组件依赖运行时值时无法还原：显示静态已知内容或诊断，保留 raw。不会执行导入脚本，不生成并不存在的最终文本。

本地 MathML 支持常见变量、上下标、分数、平方根和部分符号；复杂 TeX 环境、宏和完整排版不支持，保留可读原始表达式。附件只保留引用，没有下载图片／文件正文。

无法证明同一次重试的不同用户 ID 不会自动合并。孤儿编辑提供恢复归档，需要依据来源人工核对。

下一阶段建议：使用一份真实长对话导出，覆盖现场取消／恢复／模型分支切换，完成已安装扩展的当前页面导入验收；只对发现的实际来源字段差异补适配与回归样本。本轮不继续增加产品功能。

## 本地运行与安装

解压 `dist/ai-conversation-visual-navigator-v1.3.1.zip`，或在浏览器扩展管理页面重新加载既有安装目录 `dist/ai-conversation-visual-navigator`。1.3.0 ZIP 保留，可用于代码回退；资料回退使用升级前恢复点或 JSON 备份。

可重复浏览器测试：运行 `node scripts/serve-validation.mjs 8940`，打开 `http://127.0.0.1:8940/validation/qa-p0-browser.html?validationDb=v04-p0-your-unique-name`，点击“运行专项验收”，刷新页面后点击“刷新后检查持久化”，下载报告。每次新迁移验收使用新的隔离名称，避免把已经升级过的测试库当作 V6 输入。

浏览器测试文件与脚本不进入安装包。权限保持 activeTab、scripting、sidePanel、storage、unlimitedStorage；正文默认本地处理，没有 AI API、CDN 或第三方正文上传。
