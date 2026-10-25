# v1.0 First Release · 工程构建 1.5.0

2026-10-13。继续开发 `apps/navigator-extension`，复用原生 ES modules、Manifest V3、IndexedDB、QACard、SVG 画布、后台命令、恢复点和工作台。产品闭环为 Capture → Structure → Reflect → Deploy。没有另做产品 Demo，`validation` 中的合成输入只是测试夹具，不进入安装包。

当前是可安装的发布候选。基础离线闭环已在实际本地浏览器验证；真实 ChatGPT 页面、安装后的 Chrome MV3 和真正的 125% 浏览器缩放未验证，因此不宣称正式发布的全部五步已经验收。

## Phase 0 · 审计与保护

1. **修改文件**：`storage/database.js`、`domain/backup.js`、`domain/common.js`、`manifest.json`、`package.json`、两份入口 HTML。
2. **主要模块**：数据库 open/commit；normalizeBackup/restoreBackup；initializeMemory 保留使用。
3. **完成情况**：V7→V8 增量创建新表和索引；备份 schema 3 接受 schema 1、2；manifest 工程版本 1.5.0，version_name 标为 v1.0 First Release，避免从已装 1.4.0 倒退版本。
4. **根因和修复**：原数据层没有判断／部署模型。增量扩展而非清库，仍以稳定 card_id 为来源。
5. **迁移**：没有删除旧对象仓库或覆盖原始消息；应用启动建立升级前恢复点。备份恢复重映射新增卡片、片段、决定、时间线和版本引用，冻结输出不改写，旧引用映射可查看。重复身份迁移保留完整归档。
6. **自动测试**：Schema 2 兼容、schema 3 引用恢复、原字节／版本保留测试通过。
7. **浏览器验证**：真实隔离 IndexedDB V7 输入升级到 V8，原批注与升级前恢复点内容核对通过。
8. **未验证**：真实用户 Chrome profile 的升级，未触及用户真实资料库。
9. **遗留问题**：旧扩展代码无法直接打开高版本 IndexedDB；不应通过删库回退。优先使用当前版本的恢复点或完整备份。
10. **下一步**：已继续完成 Capture 数据修复和后续阶段；发布前补真实 profile 升级验收。

## Phase 1 · Capture 与数据正确性

1. **修改文件**：`domain/captures.js`、`adapters/source-adapter.js`、`background.js`、`storage/release.js`、`ui/app.js`。
2. **主要模块**：saveConversation、recordImportFailure、sourceDescriptor、后台 capture 分发。
3. **完成情况**：继续采用已有 ChatGPT 当前页读取与 JSON 兜底；保留当前分支、每轮一卡、增量同步、技术去重、PENDING／HIDDEN_INVALID／ACTIVE、静态组件转换和本地 KaTeX。SourceAdapter 描述来自实际归一化数据，缺失字段不伪造。
4. **根因和修复**：原来完整导入后跳到来源树，违背首用主路径；改为时间线。新增同步统计。读取失败日志与捕获诊断分开，日志失败不能替换原错误。部分抓取不消失已有有效卡片。
5. **数据**：ImportRecord 保存来源、快照、同步时间、新增／更新／隐藏卡数、过程消息数、部分读取、告警与错误。原消息、历史版本和快照保留；同步不修改用户判断或上下文包。
6. **自动测试**：原导入／适配器／全文／P0 套件通过，包括源页切换、授权失败、当前分支、取消与恢复、重复提问、格式和长正文。
7. **浏览器验证**：6 会话 300 轮、多次重复同步、工具／思考／搜索辅助消息、长正文尾部检查通过。旧 P0 浏览器专项在兼容列表呈现下验证解析／存储，产品默认仍为横向时间线。
8. **未验证**：当前真实 ChatGPT DOM／私有接口与已安装 activeTab 授权操作。
9. **遗留问题**：网页能力不足时必须报告部分读取或待确认；当前环境无真实 ChatGPT 标签页。不保证未取得附件正文或动态组件完全还原。
10. **下一步**：真实页面差异采样与回归优先，避免增加未验证的平台抓取器。

## Phase 2 · Timeline 与 Read

1. **修改文件**：`domain/timeline-tracks.js`、`ui/horizontal-timeline.js`、`ui/opc.js`、`ui/release.css`、`storage/opc.js`、`ui/app.js`、入口 HTML。
2. **主要模块**：defaultTrackPreferences、horizontalLayout、HorizontalTimeline、OPCTimeline.openCard/locate。
3. **完成情况**：X 轴真实时间，Y 轴来源／主题轨道；默认最近活跃四来源；轨道勾选、顺序、折叠持久化。支持小时（有可靠时间时）、日／周／月浏览、缩放、水平与垂直滚动、最新／指定卡片定位。密集 Q/A 聚合可展开，微型节点不加载全文。
4. **根因和修复**：旧比较图只是可选大卡片轨道，无默认持久轨道。新布局保留真实 x 锚点，碰撞只改变 y 或聚合；未知时间单列。缩放时重建读取旧滚动值曾覆盖新锚点，已加跳过旧 viewport 捕获。全未知时间不显示虚假的 1970 日期轴。长标题使用正常换行，按实际节点高度调整避让。
5. **数据**：timelinePreferences 保存选择、顺序、折叠、尺度、缩放和滚动值。QACard 时间只读，开关右侧固定阅读面板不重新布局主时间视口。
6. **自动测试**：默认四来源、手动空选择不恢复默认、真实连续时间、20 节点聚合不丢成员、300 轮聚合总数一致。
7. **浏览器验证**：默认四条、人工改为一条后重开保留；49 轮聚合完整展开，1 轮未知时间保留；开关阅读面板水平位置保持；50 个实际微型节点的标题和轨道对齐检查通过。375／768／1024／1440px 和额外 1152px 有效宽度检查无横向溢出。
8. **未验证**：真正 125% 浏览器缩放。内置浏览器没有 zoom 能力，Ctrl+plus／Ctrl+Equal 不改变 devicePixelRatio 或视口；1152px 检查只是 1440/1.25 的等效宽度，不冒充真实缩放。
9. **遗留问题**：非常大时间范围可继续优化窗口导航与虚拟化。不同来源没有原始时间时不能确定真实“最近”顺序，只能稳定展示未知记录。
10. **下一步**：实际 Chrome 125% 与真实页面标题回归。

## Phase 3 · Reflect

1. **修改文件**：`domain/card-metadata.js`、`domain/release-data.js`、`ui/reflection.js`、`ui/opc.js`、`storage/release.js`。
2. **主要模块**：releaseMutation/assertRelease、ReflectionPanel，已有元信息自动保存。
3. **完成情况**：复用 qaMetadata.notes 作为独立 Annotation 等价字段，明确标记“我的批注（用户）”；与 Q/A 正文分离。新增独立采纳状态、OpenIssue CRUD／解决依据、Decision 状态／用户确认／证据／取代／冲突引用，以及来源版本与字符范围严格匹配的手动 KnowledgeFragment。
4. **根因和修复**：原来的整理状态不能表达用户是否采纳，原来的自由备注不足以供编译器读取当前决定。结构化判断不从 AI 回答推断；采纳／推翻决定需用户确认。未确认替代记录不会自动使原确认决定失效。
5. **数据**：adoptionStatus 不同于 organizationStatus 和导入 validity。新建 openIssues、decisions、knowledgeFragments 表；删除采用可恢复的软删除。问题允许独立于有效 Q/A 创建。人工编辑有 revision 冲突保护。
6. **自动测试**：状态独立、用户确认门槛、严格证据范围、来源变化不覆盖判断、备份重映射通过。
7. **浏览器验证**：批注自动保存、用户已实践、已采纳决定／已推翻旧方案／未解决事项、关闭重开恢复通过；中文检索命中这些记录。
8. **未验证**：复杂富文本批注锚点和 AI 判断建议，不属于本轮范围。
9. **遗留问题**：不能靠关键词自动理解任意两段文本的语义矛盾；首版依赖用户明确冲突记录及确认关系，不能自动判断事实正确性。
10. **下一步**：实际用户判断流程反馈及更细证据锚点。

## Phase 4 · Deploy / Context Pack

1. **修改文件**：`domain/context-pack.js`、`storage/release.js`、`ui/context-deploy.js`、`ui/opc.js`、`ui/reflection.js`。
2. **主要模块**：packMutation、compileContextPack、orderContextCards、contextSourceManifest、applyCompilation、exportPack、ContextDeploy。
3. **完成情况**：时间线、画布、搜索、阅读面板可加托盘；托盘增删、幂等、排序、清空；跨来源五卡创建包。FULL／COMPACT／DECISIONS／CUSTOM、目标任务、明确约束、包含字段、排序、预算、输出预览／人工编辑、自动保存、复制、Markdown／通用 Prompt 导出、保存包重新打开和 Project Briefing 预设均本地执行。
4. **根因和修复**：原项目仅有资料包导出，没有可继续任务的用户判断编译。只用确认关系驱动依赖；循环保留人工顺序并提示；修正／推翻名称不证明事实。旧方案只按用户确认状态标注。历史 Q/A 放在动态长度文本围栏内，来源与当前用户任务区分。预算超出提示而不截断。COMPACT 优先用户摘录，否则按完整语义块取材并披露省略；没有确认决定时 DECISIONS 不编造。
5. **数据**：contextPacks 与 contextPackItems 保存稳定引用、四模式设置、顺序与包含字段、生成／手动内容、来源版本、编译告警和编辑历史。contextTrays 独立持久化。来源变化提示，不能无提示改写已存包；显式重编译之前完整保存旧手动版本。
6. **自动测试**：五卡跨会话、旧方案和当前决定分离、问题和批注保留、依赖顺序、候选关系不驱动、循环／冲突、注入边界、预算、四模式、手动历史、来源变化、备份恢复通过。300 轮 FULL 包保留全部 300 个答案尾部。
7. **浏览器验证**：五卡／三来源／两确认关系／新旧决定／未解决事项真实本地端到端通过；四模式、Briefing、来源变化和旧编辑恢复通过。实际剪贴板与最终预览逐字符一致；Markdown 文件导出与预览一致。完整工作台 Timeline → Deploy → 已存包已验证。
8. **未验证**：粘贴进实际登录的新 ChatGPT／Claude／Codex 页面。本轮不自动控制或发送这些网站，不申请新跨站权限。
9. **遗留问题**：token 数为明确标记的离线估算，无模型 tokenizer；不声称准确计费。没有外部 LLM 摘要、RAG 或 MCP Server。超预算需要用户调整范围／模式／预算。
10. **下一步**：真实用户选材与跨模型粘贴反馈；优先模板可读性与可靠性，不扩建云基础设施。

## Phase 5 · 搜索、验收与发布准备

1. **修改文件**：`domain/card-search.js`、`storage/opc.js`、`ui/release.css`、`scripts/validate-release.mjs`、`scripts/validate-all.mjs`、`validation/first-release-browser.*` 和使用文档。
2. **主要模块**：中文多关键词搜索、用户判断检索、有界正文加载、发布套件和 package 校验。
3. **完成情况**：离线搜索覆盖标题、Q/A、标签、批注、决定、问题和摘录；结果可阅读、定位、加入托盘。三主入口保持 Timeline／Canvas／Deploy，旧来源树与原始阅读放二级入口。首用空状态说明导入→阅读→上下文包流程，不卡在空画布。
4. **根因和修复**：只查原消息无法命中用户决定／问题，已纳入同一缓存、revision 失效和权重。新资料模型阻止跨项目移动破坏引用；复制／导出在未保存冲突时拒绝使用错版本。日志失败不能遮盖原导入错误。
5. **迁移**：新模型均纳入完整备份与恢复。疑义旧卡归并保存新资料原貌，冻结包与人工编辑不在迁移时生成；重复包含项保留归档并告警。
6. **自动测试**：最终 `node scripts/validate-all.mjs` 汇总为准；包含原 16 套加 release 套件。构建和 ZIP／安装目录字节一致性单独校验。
7. **浏览器验证**：本地真实 IndexedDB、产品工作台、300 轮导入、包编译、搜索、复制、文件导出、重开恢复及四宽度几何。报告在 `dist/OPC_FIRST_RELEASE_BROWSER_REPORT.json`；对应截图与合成导出样例保存在 dist。
8. **未验证**：真实 ChatGPT、Chrome 已装扩展、125% 真缩放、完整浏览器进程内存和帧率剖析。单次毫秒测量不是所有设备的性能保证。
9. **遗留问题**：后台兼容性会随 ChatGPT 字段变化；本地首查按项目读取来源文本，超大库后续可引入增量索引。用户项目内支持跨会话／时间线，跨项目关系未开放。
10. **下一步**：按清单在真实 Chrome profile 完成剩余阻塞验收后，才标记正式 v1.0 发布；不提前增加新平台与付费服务。

## 运行与交付

```text
cd apps/navigator-extension
node scripts/validate-all.mjs
node --experimental-vm-modules scripts/build.mjs
node scripts/verify-package.mjs
node scripts/serve-validation.mjs 8942
```

本地专项页面使用 `validation/first-release-browser.html?validationDb=v04-release-your-unique-name`。运行后刷新并检查恢复。迁移测试每次使用新隔离名，避免把已升级库当旧库。P0 专项使用 `validation/qa-p0-browser.html?validationDb=v04-p0-your-unique-name`。

安装目录 `dist/ai-conversation-visual-navigator`；发布候选 ZIP `dist/ai-conversation-visual-navigator-v1.5.0.zip`。保留同一原扩展条目与目录进行重新加载，不清库、不另建 ID 以免误以为资料丢失。历史 ZIP 保留。
