# P0：第二个独立 Project 的交互审计与修复

日期：2026-10-21（Asia/Shanghai）。本轮只处理已有 Timeline 的跨项目通知故障，没有新增产品功能。开始时仓库已有上一轮未提交的关闭交互、安全删除等修改；本轮保留它们，没有重做、撤销或重新开发这些功能。

## 1. 是否复现

**是，复现了跨 Workspace 创建 / 保存第二个独立 Project 时，取消当前 Timeline 点击的故障。**

准确步骤（全新隔离 Profile、合成数据）：

1. 在实际扩展页面创建来源 Project A，导入两条独立 Conversation；实际放大、缩小、点击正确 Q/A 均正常。
2. 在另一 Workspace 标签页中创建独立 Project B。同时，在 A 页按住 `+`，创建完成后再松开。
3. 修复前 A 的原按钮 `isConnected=false`，松手后比例不变。对修复前包运行同一个回归断言，稳定失败于 `Creating B destroyed A pressed +`。
4. B 已存在后，在 A 的 `+`、`−` 或圆形 Q/A 节点上按住鼠标，由 B 页保存项目名称，再回 A 松开。三者都记录到 pointerdown / pointerup，但没有 click；没有执行 zoom / openCard，比例和 selected 均不变。

故障当时没有打开的 modal / 遮挡层；elementFromPoint 命中实际按钮 / 节点；未出现页面异常或 Promise rejection。与用户补充的“应该无异常”相容。

**未复现**“仅创建 B，等待页面稳定后便持续永久无法操作”。普通单窗口 A → B → A、A/B/C 切换，在修复前也能通过。不能将本次已证实的按键取消扩大成所有持续失效场景均已定位。

## 2. 确认根因与调用链

```text
ui/app.js #new-project click → ask → rpc('createProject')
  → background.js dispatch()
  → storage/repository.js command() → mutate()
  → domain/captures.js createProject()（crypto.randomUUID 生成身份）
  → storage/database.js commit()（revision 检查、单事务保存）
  → background.js broadcast('changed')
  → 所有 Workspace 的 ui/app.js runtime.onMessage
  → reload(true) → rpc('projects') / rpc('view') → showCenter()
  → OPCTimeline.show() → load() → render()
  → host.replaceChildren() → HorizontalTimeline.render()
  → 新的 + / − / Q/A button；按住的原 button 已被移除
  → pointerup 不再与原 pointerdown 对应，浏览器不派发原 click
```

关键位置：

- `ui/app.js`：`#new-project` 处理约 461 行；`reload()` 115 行；`showCenter()` 96 行；运行时通知处理 564 行。修复前的 `changed` 处理完全不比较 Project ID，直接重建当前页面。
- `domain/change-notification.js`：`changeNotification()` 3 行。修复前新建 Project 的请求只有 name，没有 projectId，通知因此变成无作用域的全局 changed。
- `background.js`：`dispatch()` 的 saveDraft 123 行、普通写入通知 134 行。导入完成也发送无作用域 changed。
- `ui/opc.js`：`show()` 47 行、`load()` 58 行、`render()` 89 行；render 移除原 host 子节点。圆形节点的 click 最终调用 `openCard()` 243 行。
- `ui/horizontal-timeline.js`：`render()` 11 行注册真实按钮 click，`zoom()` 约 80 行计算并重绘坐标。它们在故障时没有收到原 click，修改坐标算法无法补回这次点击。

第二个 Project 提供了另一个本不应改变 A 视图的写入来源。问题不在第二个 UUID，也不在一个 Project 里有多条 Conversation。三个控件一同失效，是因为它们共同所在的 DOM 被通知刷新替换，发生在 click 形成之前。单纯增加 Project 数量不是充分条件；**另页写入通知与当前鼠标操作重叠**才是本次证实的触发条件。

审计覆盖与排除：

| 层级 | 检查结果 |
| --- | --- |
| Workspace HTML / 初始化 | `workspace.html` 加载 `ui/app.js`；initialize 从 local storage 恢复，再由 URL projectId / conversationId / pathId 覆盖；reload 校验对话归属。测试按用户提供的参数结构生成新 ID，未硬编码其业务 ID |
| Project / 数据库 | createProject → mutate → commit；来源数据按 projectId 索引读取。写入在 service worker 队列串行，IDB revision 冲突会拒绝覆盖。没有清库或更改数据库模型 |
| Timeline / 尺寸 | opcPage → timelinePage → defaultTrackPreferences / horizontalLayout → timelineViewport；实际 pxPerMs / visibleSpan 有记录。ResizeObserver 与 resize 在 detach 时清理；本次没有改动布局或缩放算法 |
| Pointer / Pan | 检查 pointer-drag、Timeline bindPan、click、wheel、capture 和传播。节点按钮不进入空白平移捕获；本次断点是原节点被移除，不是 capture 或 preventDefault 拦截 |
| Overlay | 故障时 open dialogs 为零，elementFromPoint 命中原控件；未通过提高 z-index 修复 |
| 跨页面 | background runtime 广播导致重建；没有 BroadcastChannel 或 storage.onChanged 把别页的 selection 注入当前页面。navigatorSelection 为共享恢复偏好，当前页面在内存中各自保存 selection |
| sourceTab | 只用于采集来源绑定 / fallback；不参与 Timeline 数据查询或节点 click。相同、不同 sourceTab 均测试 |
| 全局缓存 | DB connection / 查询模块按各执行上下文实例化；搜索缓存按数据库 revision 更新。没有发现“第 2 个 Project 覆盖第 1 个控制器”的证据 |

## 3. 实际最小修改

1. `domain/change-notification.js`：createProject 使用**保存结果**中的 id 作为通知 Project ID。moveConversation 影响来源和目标，继续发全局通知。
2. `background.js`：把保存结果传入 changeNotification；saveDraft 的完成通知携带实际 projectId；恢复等无法确定单项目影响的结果仍保留全局通知。
3. `ui/app.js`：独立 A 收到明确属于独立 B 的 changed，只刷新项目列表，不调用 reload / showCenter，不移除 A 的 Timeline。仍能在列表看到新增 B。当前项目、未知范围、Workspace 及跨项目移动继续使用原刷新流程，避免漏掉关联数据变化。
4. 版本标识升为 **1.6.1**：`manifest.json`、`domain/common.js`、`package.json`、`workspace.html`、`sidepanel.html`，避免新旧包同名难以核对。打包校验发现页面顶部仍显示旧号后，已同步两个页面的版本文字，布局和交互未改动。

没有改动缩放、时间坐标、原始 Q/A、人工关系或 Canvas 布局算法；没有增加强制页面刷新、延时重试或更高 z-index。这里不承诺解决同项目并发编辑时的所有 UI 生命周期问题。

测试文件：`scripts/diagnose-second-project.mjs`（真实扩展回归）、`scripts/validate-interactions.mjs`（通知语义断言）、`scripts/inspect-loaded-extension.mjs`（只读加载目录核对）。入口：`npm run test:second-project-browser`。诊断包装只存在于测试脚本，不进入安装包或用户页面。

## 4. 测试证据

| 验证 | 本轮结果 |
| --- | --- |
| 一个来源 Project、两条 Conversation | 实际放大、缩小、正确 Q/A Reader，通过 |
| 第二个独立 Project | UI 实际创建 B；A 按住 + 时创建 B，原按钮保留，列表出现 B，松手实际放大；B、A、B 轮换通过 |
| 第三个 Project | UI 创建 C；C、A、B 逐次实际缩放和正确 Reader，通过 |
| 多 Workspace | A/B 同时存在、分别缩放和打开 Q/A；关闭 B 后 A、关闭 A 后 B，通过 |
| 三种控件 | B 另页写入期间 A 的 +、−、圆形节点保持连接，均形成 click；scale 实际改变，Reader selected 与详情 cardId 均等于被点击 ID |
| URL 参数 | projectId + conversationId + pathId + sourceTab；相同与不同 sourceTab，通过 |
| 页面 / 扩展重载 | 真正 page.reload 与 chrome.runtime.reload 后重新进入，缩放及 Reader 通过 |
| 原有功能 | 单 Conversation 来源选择、Project 多 Conversation、Canvas 点开 Reader、Search 命中原 Q/A、Deploy 编译原回答，通过 |
| 数据无损 | messages、versions、snapshots、paths、qas、segments、qaCards、qaMetadata、relationships、canvasLayouts、memberships、timelines 共 12 类记录，测试前后数量及 SHA-256 一致 |
| 异常 / 事件 | 页面及 Promise 无异常。各 Project 状态下 document 监听器 6 个、缩放按钮与节点 click 各 1 个（含诊断）；同模式切换未累积。Canvas 模式自身额外两个 scroll / resize 监听与浏览模式有关，未用其推定故障 |
| 原有 MV3 回归 | 8 项全部通过，含跨页 view-save、Workspace、页面与扩展重载 |
| Node / 静态 | 23 组、333 项通过；另有静态检查（报告共 24 个条目） |

证据文件（均在 dist）：

- `P0_SECOND_PROJECT_BEFORE.json`：修复前首次诊断，三个控件均断开、无 click、无异常。
- `P0_SECOND_PROJECT_COUNTERFACTUAL.json`：**有意保留的预期失败**；旧安装包运行同一个严格回归，在新建 B 时失败，比例不变。不能当作当前版本的失败。
- `P0_SECOND_PROJECT_AFTER.json`：当前源码真实 MV3 25 项通过。
- `P0_SECOND_PROJECT_PACKAGED.json`：1.6.1 安装目录的真实 MV3 25 项通过；收尾同步页面版本文字后重新构建并通过完整性校验，三个故障链路 JS 摘要与该浏览器报告一致。
- `P0_SECOND_PROJECT_CHROME.json`：Chrome 152 隔离启动尝试，等待扩展 service worker 超时，**0 项功能测试执行**，不计为通过。
- `INTERACTION_MV3_REPORT.json`、`OPC_NODE_REPORT.json`：本轮已有回归与静态结果。
- `P0_LOADED_EXTENSION_AUDIT.json`：用户现有 Chrome Profile 中 OPC 的注册目录与磁盘文件摘要；没有读取聊天或历史记录。
- `PACKAGE_CHECK_REPORT.json`：源码、安装目录逐字节一致，ZIP 解压比对及 SHA-256。

## 5. 仍未验证与加载核对

只读核对发现，本机运行中的 Chrome 为 152.0.7977.65。默认 Profile 注册的 OPC ID 为 `kckhiofgkmoilpdcdonjgnnpdmjcacaj`，加载路径为 `D:\mytools\GPT-SaaS\apps\navigator-extension`，而非另一份 dist。磁盘版本已为 1.6.1，三个关键文件摘要与本轮源码一致。

注册信息没有返回运行时 manifest 版本；不能仅凭磁盘文件证明现有后台和旧 Workspace 标签页已重新加载。当前浏览器连接工具也没有连接用户的 Chrome。未读取私人 Q/A、没有改动真实 Profile、没有替用户关闭其浏览器或清空数据。隔离浏览器验证不等于在用户既有 Profile 上复现其持续失效情况。

成功的实际扩展功能测试使用 Edge/Chromium 隔离 Profile。也尝试了已安装 Chrome 152 的新 Profile，等待扩展 service worker 15 秒后超时，尚未取得 Chrome 品牌浏览器的功能验收结果；没有关闭安全限制来强行加载。不能把这次启动尝试算作 Chrome 功能测试通过。

人工核对步骤：在 `chrome://extensions` 找到 OPC Timeline，确认上述加载目录，点击重新加载；重新打开 A、B 的 Workspace（关闭旧扩展页面不删除项目）。确认显示 1.6.1，逐个实际 +、−、点击不同 Q/A，再创建 C 轮换。若仍持续失效，需要该时刻的实际运行时状态 / 首条异常，不能用本次受控场景推定其原因。

## 6. Git 状态

分支：`codex/v1-interactions-hover`；HEAD：`17343f3`。本轮新增修改均保存在工作区，尚未新增 Git 提交，没有 push。开始已有 29 个跟踪文件修改及其他未跟踪资料；没有清理、重置或全量暂存它们。

本轮变动：三个故障链路文件、五个版本标识文件、上述诊断 / 回归脚本、package 测试入口、README 指向本文、本文。此前关闭按钮、安全删除、多轨、标签等代码均为之前的工作，不作为本轮新增修复。`dist/P0_SECOND_PROJECT_ONLY.patch` 单独保存本轮差异，相对于本轮开始时的工作区；已通过只检查、不修改文件的反向应用检查。

## 7. 简短工程解释

不是第二个 Project 把缩放参数算坏了，而是它的新建 / 保存通知让另一个页面重建了界面。鼠标按下时的按钮在松开前消失了，三个控件便都收不到完整点击。这不会必然产生 Console 报错。

之前只阻止“保存视图偏好”通知重建，仍留下“新建 / 修改另一个 Project”通知这条路径；只测试预先建好的多项目，也不会捕获按住按钮时新建 B 的差异。现在无关项目只刷新列表，原控件保留；同一个回归在旧包失败、在修复后通过。将此并发创建 / 保存用例保留在回归中，可以防止相同路径再次漏测。

结论限定为：**已修复并验证这条可复现的跨项目点击取消根因；未将未复现的持续失效现象宣称为彻底修复。**
