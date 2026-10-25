# 追加交付：统一关闭交互与 Project 安全删除

日期：2026-10-21（Asia/Shanghai）。基于上一轮交付 `17343f3`，继续在 `codex/v1-interactions-hover` 修改。未清理原有未跟踪文件；没有 push、发布或操作用户真实 Project。

## 调整的界面

| 界面 | 本轮处理 |
| --- | --- |
| Q/A Reader、Canvas Card 详情、Search Result 详情 | 复用原有同一个 Reader；顶部独立关闭栏，正文单独滚动，× 不遮文字，加载中也可关闭 |
| 辅助 Conversation 原文 Reader | 原阅读头部接入共享关闭与层级管理；导航与专注阅读操作保留 |
| Project Workspace | 右上角 ×；长目录滚动后仍可见 |
| 关联 Conversation 子弹窗 | × / Esc 检查未保存的关联选择；只关闭最上层，不提交关联变更 |
| Workspace Deploy | × 为主要关闭入口；关闭前沿用原 `flush()` 保存，返回目录的重复关闭按钮移除 |
| Conversation 管理、全局 Search | 顶部共享 ×；筛选和已保存管理操作不误判为未保存表单 |
| 卡片标签编辑 | × / Esc 等待原保存队列；冲突时不静默关闭，原本地草稿保留 |
| 项目新建、编辑、删除确认，以及主题编辑 | 通用 `ask()` / Topic dialog 接入关闭；输入有变化时先选择继续编辑或明确放弃 |
| 时间线管理、来源选择、密集 Q/A 选择 | 共享 ×；保留真正的保存、隐藏、归档、缩放和轨道操作 |
| 关系编辑、问题、决定、手动摘录 | 共享 × 和未保存输入保护；保存与删除动作仍有清晰原语义 |
| 文档导出、资料包、整理预览 | 共享关闭；用户实际编辑才触发未保存提示，异步加载默认值不误报；保存方案后更新基线 |
| 备份恢复、来源引用、采集来源、导入预览、设置、同步记录 | 经统一 `showDialog()` 入口接入，保留既有清理、异步失效与关闭回调 |
| Canvas 悬浮预览 | 增加可点击 ×；退出后恢复来源卡片焦点，Esc 不同时关闭后方 Reader，仍避免遮住来源卡片和控件 |
| 窄屏项目导航 Drawer | 右上角 × / Esc；关闭后恢复导航按钮焦点。桌面普通导航折叠继续使用原入口 |
| 提示消息 | 使用同款 ×，只隐藏该提示，不删除数据或关闭外层编辑窗 |

所有主要关闭按钮均为真实 `button`，`aria-label="关闭"`，tooltip 描述关闭对象与 Esc；至少 40 × 40px。真正的返回上一张 Q/A、回到来源时间线、普通折叠，以及 + / −、添加、移除、删除关系等动作没有改成关闭按钮。

## 轻量共享实现

核心文件：`ui/panel-close.js`。

- `PanelCloseButton()`：统一图标、可访问性、热区与样式。
- `showPanelDialog()`（由 `dom.js` 导出为 `showDialog()`）：先准备关闭栏和生命周期，再调用原生 `showModal()`。所有应用内 modal 入口均走此函数；不修改 DOM 原型，不依赖新增框架，也不依赖单一新版 beforetoggle 事件完成初始化。
- `registerClosablePanel()` / `releaseClosablePanel()`：为 Reader、Drawer、浮层管理显示与关闭层级。
- `requestPanelClose()`：只处理当前最上层，串行处理一次关闭请求，先检查未保存内容，再运行既有保存或清理逻辑。
- 一个 document 只有一个 Esc 协调器。原生 modal 总高于非 modal 面板；同类按实际打开顺序处理。Esc 的一次按键不会穿透关闭多层；输入法合成期间不抢占 Esc。
- `MutationObserver` 仅在 modal 打开时观察其子节点，用于兼容原项目重建弹窗内容；关闭后 disconnect。没有监视整页的常驻 DOM observer。
- 复用 `#edit-dialog` / `#track-dialog` 前清理旧的 oncancel、onclose、onkeydown。时间线管理原来未触发便残留的 once cancel 回调，改为每次会话设置。
- 原生 modal 负责原有遮罩；本轮没有添加透明遮挡层。closed dialog 不继续拦截 pointer events。

部分旧纯关闭按钮保留为隐藏的兼容调用点，由新 × 委托其原逻辑，以保留 epoch 清理、移除临时弹窗、资源回收等行为；不再作为可见的主要关闭入口。临时的重新编译确认框也补充 close 后移除，避免反复打开留下节点。

## 未保存内容的处理

普通表单记录初始值和用户实际触碰的输入。× 或 Esc 遇到未保存变化，会打开最上层提示：

- **继续编辑**：回到原表单，输入和焦点保留。
- **放弃修改并关闭**：明确确认后才关闭原界面。
- 原表单原有保存按钮继续可用；确认框自身的 × / Esc 等价于继续编辑。

只将用户 input / change 视为编辑，不把异步加载来源、默认选择或程序更新文本当成未保存修改。已完成文档方案保存会更新编辑基线。

Reader 批注、卡片标签、Workspace Deploy 沿用原有自动保存与本地草稿机制。新增候选标题、标签输入也使用现有 `AnnotationDrafts`，按原始 Project / 卡片保存，关闭后重新打开可以恢复。没有新增数据库表或迁移。

标签保存失败或 revision 冲突时保留编辑窗及草稿；不会通过 × 隐藏失败状态。Reader 的迟到正文请求仍受 detailEpoch 保护，关闭后不会自行重开。

## 与 P0 Timeline 的联合验证

保留上一轮的有效缩放范围、视图归属保存、轻量 viewChanged 通知和全局模式同步修复。本轮进一步验证：

1. 两个以上原始 Project 往返，反复开关 Workspace / 来源选择后，+ / − 改变实际坐标比例或滚动宽度。
2. 关闭所有 modal 后，空白拖动可以继续平移，页面没有遗留的原生 modal 遮罩。
3. Reader → Canvas → Workspace → Timeline 继续读取原有卡片；Canvas 拖动、连线和 hover 保持正常。
4. Reader、浮层及多层 modal 共存时，一次 Esc 只关闭最上层。
5. 重复开关结束后：Esc 协调器仍为 1、打开状态的 modal observer 为 0、活动关闭层为 0。
6. 390px Reader 长正文真实发生滚动，正文区域顶部不越过关闭栏底部，× 保持可点击。

## Project 安全删除

检查发现原删除实现只按 `projectId` 清表，可能留下关联 Workspace 的无效来源、轨道和托盘引用。原 UI 也在确认框返回后才读取 view.project.id；现在先捕获项目身份，避免确认对象漂移。

新增 `domain/project-deletion.js` 的纯状态操作，以及 repository 中的 `projectDeletePreview` / 安全 delete 流程：

1. 等待当前批注、视口和 Deploy 保存，预览 Conversation、Q/A、消息、版本数量及受影响的 Workspace。
2. 仍须输入准确项目名称；最终动作明确标为「删除此项目」，没有用 × 表达删除。
3. 使用预览 revision 拒绝已变化的资料范围。
4. 删除前通过**现有恢复点机制**建立本地恢复点；恢复点失败或数据在期间变化时，不提交删除。
5. 同一事务删除该来源 Project 的记录，清理关联 Workspace 的失效关联、轨道选择、托盘、成员及引用。
6. 其他来源项目的原文、标注、关系和 Canvas 布局保持原样。Workspace 人工主题及其他成员保留；已冻结生成内容、手动 Deploy 编辑保留，并用已有的来源不可用标记表示被删来源。
7. 恢复点仍按原机制恢复为新 Project，不强行覆盖当前资料。删除并非安全擦除：备份恢复点和已保存的 Workspace 派生内容仍保留，这是 UI 中说明的恢复语义。

×、Esc、取消或放弃删除确认输入只退出确认，不调用 deleteProject。Workspace 本身沿用既有归档 / 恢复，本轮没有扩展新的 Workspace 永久删除模型。

IndexedDB 仍为版本 9，备份 Schema 仍为 3，没有新增 Chrome 权限。本轮测试中的实际删除全部针对隔离 profile 内刚生成的合成项目，没有删除用户现有项目。

## 实际测试

仅以下本轮实际重跑的报告作为证据，不能把 dist 内其他旧报告计入本轮。

| 测试 | 结果 / 报告 |
| --- | --- |
| 全量 Node 与静态检查 | 23 组、332 项 PASS，另有静态检查；`dist/OPC_NODE_REPORT.json` |
| 统一关闭新增验收 | 8 组全部通过，其中逐个实际打开 14 类弹窗；`dist/PANEL_CLOSE_BROWSER_REPORT.json` |
| Project 删除 / 恢复 | 4 组全部通过，含错误名称、过期预览、自动恢复点、其他来源不变、冻结编辑保留、删除后缩放及恢复；`dist/PROJECT_DELETE_BROWSER_REPORT.json` |
| 多项目 Timeline | 14 项全部通过，含 A–J、长正文、Esc、加载中关闭与未知时间；`dist/TIMELINE_PROJECT_BROWSER_REPORT.json` |
| 原有完整交互 | 14 项，Canvas 点击、拖动、hover、关系、Reader、Deploy；`dist/INTERACTIONS_ALL_REPORT.json` |
| 本地标签 | 5 项，审核、草稿、持久化、搜索与备份；`dist/QA_TAGS_BROWSER_REPORT.json` |
| Search / 对话管理 | 8 项 UI + 5 项数据库检查；`dist/SEARCH_MANAGEMENT_BROWSER_REPORT.json` |
| Workspace | 9 项，含 200 张 Q/A、5 个来源、Deploy、备份恢复与浏览器进程重启；`dist/PROJECT_WORKSPACE_BROWSER_REPORT.json` |
| 真实 MV3 | 8 项，含后台消息、页面和扩展重载、删除确认 × 不提交、390px Drawer 关闭；`dist/INTERACTION_MV3_REPORT.json` |
| 打包校验 | 构建目录逐字节比对、ZIP 解压和 SHA-256；`dist/PACKAGE_CHECK_REPORT.json` |

浏览器为本机隔离 **Edge/Chromium**，未使用用户既有浏览器 profile。没有声称完成 Chrome 品牌浏览器、私人历史数据、真实线上 ChatGPT 捕获的人工验收。以上通过结果以对应 JSON 的实际执行时间和检查项为准。

### 最后一次重复复测的限制

收尾时准备再次执行的三组浏览器测试（完整交互、Project 删除 / 恢复、Workspace），被自动审批服务的用量额度限制阻止，命令没有执行；这不是测试失败或安全判定。表中对应结果来自本轮此前已经完成的成功执行，不代表这三组在最终文件状态下又完整重复了一遍。之后 Reader 独立滚动区、焦点和共享关闭入口的调整，已有统一关闭、多项目 Timeline、标签、Search 与 MV3 的针对性实际测试覆盖。

最新完整 Node 检查为 23 组、332 项通过，静态检查和最终安装包校验通过。没有绕过审批去启动浏览器。本轮源文件已经保存；需要审批的本地 Git 提交尚未执行，HEAD 仍为上一轮的 `17343f3`。

## 文件与交付

- 新增：`ui/panel-close.js`、`domain/project-deletion.js`、`scripts/test-panel-close-browser.mjs`、`scripts/test-project-delete-browser.mjs`、`scripts/validate-project-deletion.mjs`。
- UI 接入：`ui/dom.js`、`ui/opc.js`、`ui/app.js`、`ui/horizontal-timeline.js`、`ui/project-workspace.js`、`ui/conversation-library.js`、`ui/global-search.js`、`ui/tag-suggestions.js`、`ui/card-preview.js`。
- 其他 modal 接入：`ui/context-deploy.js`、`ui/dialog-layout.js`、`ui/documents.js`、`ui/organization.js`、`ui/topics.js`、`ui/reflection.js`、`ui/memory.js`、`ui/connections.js`、`ui/capture-source.js`。
- 保存与样式：`storage/repository.js`、`ui/styles.css`、`ui/workbench.css`。
- 测试入口与旧断言适配：`package.json`、`scripts/validate-all.mjs` 及已有 interaction / MV3 / Search / Timeline / Q/A 标签浏览器脚本。统一 aria-label 后，测试按所属面板定位关闭按钮，不再假定整页只有一个「关闭」。
- 新增入口：`npm run test:panel-close-browser`、`npm run test:project-deletion`、`npm run test:project-delete-browser`。
- 安装目录：`dist/ai-conversation-visual-navigator/`；ZIP：`dist/ai-conversation-visual-navigator-v1.6.0.zip`。

普通折叠不增加关闭图标；未引入新框架、数据库模型迁移、模型服务或外部网络调用。建议在自己的 Chrome 中重新加载扩展后，用真实多个 Project 再复验一次，尤其是未保存编辑、多个弹层和长历史数据的组合。
