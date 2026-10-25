# OPC Timeline 1.6.2：多 Project 交互故障调查与修复

日期：2026-10-22。工程目录：`D:\mytools\GPT-SaaS\apps\navigator-extension`。

本轮已经修改实际代码，并在隔离 Chrome 中验证了可复现的项目切换缺陷。普通生命周期与受控竞态测试分开记录；受控测试延迟真实读取的返回、或明确注入读取失败，不把这些条件描述为已在用户私人 Profile 中观察到的实际错误。用户当前持续失效页面的现场读取未完成，因此不能声称已证明其所有表现只有一个原因。

## 1. 架构与调查范围

| 环节 | 实际实现 |
| --- | --- |
| 两个入口 | `workspace.html` 和 `sidepanel.html` 共用 `ui/app.js`、`ui/opc.js`、`ui/horizontal-timeline.js`；原生 JavaScript，没有 React |
| 左侧独立项目 | `#new-project` → `createProject` → `resetProjectNavigation` / `reload` → `showCenter` → `OPCTimeline.show`。本轮测试从这个真实入口创建 A、B、C |
| 另一种集合 | `ProjectWorkspacePanel` 管理 `workspace_…` 集合及其关联 Conversation，与上述独立 Project 分开验收 |
| Timeline | `HorizontalTimeline` 计算 `pxPerMs`、节点绝对位置、画板宽度和滚动范围；＋ / − 执行 `zoom`，圆形节点执行 `openCard` / `opcDetail` |
| 数据权威 | 同一扩展 origin 的 IndexedDB `ai-conversation-visual-navigator`，数据库版本 9；页面经 Runtime 调用同一个后台仓库，按 Project 读取 |
| UI 状态 | 每页内存中的 selection、控制器、数据快照和本窗口 / 本 Project 的 viewport；`chrome.storage.local` 中的选择用于恢复，不把另一窗口的当前选择灌入本窗口 |
| 同步 | 后台提交后广播 `changed` / `viewChanged`；内容更新合并补收，视口操作不写共享数据库 |

没有发现需要清空数据或迁移数据库来修复本轮问题的证据。

## 2. 已取得运行证据的根因

### 2.1 目标项目提前接管旧画面

本轮修改前的 `OPCTimeline.show(B)` 在 B 的读取成功前，就把 `this.projectId` / scope 改为 B，清空 `trackPreferences`，而 A 的 DOM 仍然可见。节点处理器运行时读取控制器上的 Project ID，水平轴重绘也读取控制器当前偏好。

真实 Chrome 中保留 B 的读取结果暂不返回后，记录到：

- 控制器属于 B，正在显示的水平轴仍属于 A。
- 点击 A 的 ＋ 后，实际比例没有改变：前后均为 `0.000002673921130952381`。
- 点击 A 的节点，实际 `opcDetail` 请求却携带 B 的 Project ID 和 A 的 card ID。
- 释放 B 的读取后，保留的 A 节点选择还可能被用于 B，导航以“卡片不存在。”结束。

证据：`dist/PROJECT_ATOMIC_BEFORE.json` 的 `navigationEvidence`、`snapshots` 和失败断言。该旧报告的 `reader: true` 只代表详情容器曾显示，不代表正文读取成功；最终测试已增强为检查真实问题、回答正文及 Conversation 归属。

失效边界是目标 scope 提前赋值与目标数据尚未提交之间的间隔。读取失败时，旧实现也没有恢复旧 scope；只增加 click 监听器、修改按钮事件或只丢弃迟到响应，都不能纠正已经提前改掉的归属。

### 2.2 忙碌时丢弃用户最新选择，形成持续错位

原 `#project-select` change 处理器受通用 `guard` 保护，`busy` 时直接返回。但原生 select 的值已经被浏览器改了：B 还在加载时再选择 C，处理器丢弃 C；B 完成后，选择框仍为 C，控制器与画面则为 B。等待并不会补执行被丢掉的请求。

证据：`dist/PROJECT_SELECTION_BEFORE.json` 的 `rapidEvidence`：`requested = selected = C`，`active = rendered = B`。这是独立于单次指针取消的持续状态错位。

读取失败还有相似的壳层问题：即使控制器保留 A，项目选择框已经显示 B。证据：`dist/PROJECT_FAILED_SELECTION_BEFORE.json`。本轮统一补上选择框、标题、导航数据与已显示控制器的恢复。

### 2.3 切换期间的旧弹窗和待保存画布

保留旧画面可操作，还必须处理读取期间产生的新编辑，不能只在读取前 flush 一次。

- 读取已开始后打开 A 的来源弹窗，旧实现会在弹窗仍打开时提交 B，使弹窗与控制器属于不同项目。证据：`dist/PROJECT_ATOMIC_DIALOG_BEFORE.json`。
- 读取期间在 A 完成画布拖动，目标提交过早替换了 `savedPositions`。晚执行的 A 保存使用了错误的基线，最后一次拖动未保存。证据：`dist/PROJECT_ATOMIC_CANVAS_BEFORE.json`，期望位置约 `(48.30, 28.98)`，实际仍为 `(0, 0)`。

这两项是在本轮补查中发现并修正的切换边界问题，不能当作已经在用户私人数据中发生过的事实。

### 2.4 工作台窄窗口导航样式冲突

1040 CSS px 的干净工作台同时存在 `library-collapsed library-open` 时，桌面的 collapsed 规则覆盖了打开抽屉规则，导航仍是 `display:none`。侧栏有更具体的样式，因此表现不同。证据：`dist/PROJECT_DRAWER_BEFORE.json` 的 computed style 和创建按钮不可见结果。

本轮增加只作用于窄工作台、明确打开状态的样式规则。它是独立布局缺陷，没有证据将其认定为用户持续 Zoom 故障的唯一解释。

## 3. 从第二个 Project 到失效的触发链

左侧 ＋ 创建 B → 后台创建并发出通知 → 当前页面重新查询项目及 view → `showCenter` 请求 B → 旧实现先改变控制器 scope、再等待 B 的 Timeline → 间隔中仍可见的 A 按钮或节点使用 B 的状态 → 发生缩放重置或跨 Project 详情查询。

同一过程中继续选择其他项目，旧 guard 又可能丢弃最新选择；读取或详情失败后没有一致恢复，错位便可在等待后持续存在。

普通两项目生命周期在隔离数据中并非每次自动失败，因此本报告不把“数据库里恰好有两个项目”当作已证明的充分条件。受控读取门用于把有问题的先后顺序固定下来；普通 A/B/C 创建、切换、刷新和重开测试没有这个门。用户私人 Profile 中为何稳定进入持续失效状态，仍未取得现场调用链。

## 4. 工作台与侧栏差异、之前修复的不足

两入口没有两套 Zoom 算法，也没有证实 Project UUID 或节点 DOM ID 碰撞。它们的布局、视口宽度、当时选择、请求时序和所持偏好版本不同；侧栏在某些顺序下正常，不等于其共用控制器天然免疫。

旧修复分别处理过通知触发的重建、点击取消、共享偏好覆盖。它们没有保证项目身份与画面一起提交，也没有补执行 busy 时被丢弃的原生选择。之前主要使用关联 Conversation / Workspace 或加载完成后的交互测试，也不足以覆盖本轮发现的中途操作和失败恢复。1.6.2 增加独立 Project 的真实左侧创建流程，并明确测量这些边界。

## 5. 修复实现

| 文件 | 本轮行为变化 |
| --- | --- |
| `ui/opc.js` | show 保存目标请求，load 使用捕获的 Project、模式和过滤器准备数据；读取成功且请求仍有效后，才同步提交 scope、数据、过滤器、偏好、布局和 DOM。旧图在这之前继续属于旧项目；切换时清除旧节点选择 |
| `ui/opc.js` | 提交前等待旧 Project 的弹窗 / 指针操作结束，并排空期间新产生的标注、Canvas 和来源选择保存，再次检查导航序号。没有固定延迟、频繁刷新或覆盖性重试 |
| `ui/app.js` | 项目选择保留最新目标，立刻令旧导航失效，忙碌结束后执行最新目标；项目列表更新保留这个待处理选择 |
| `ui/app.js` | 记录最近成功显示的 view；目标读取失败时恢复其壳层和选择，保留旧 Timeline 的归属，并显示错误 |
| `ui/app.js` | 交互等待器区分跨项目提交与同项目更新；跨项目提交等旧弹窗关闭，同项目的弹窗内保存仍可完成，避免相互等待 |
| `ui/workbench.css` | 修正窄工作台明确打开抽屉时的规则优先级 |
| 版本文件 | manifest、package、导出版本、两入口可见版本统一为 1.6.2，区别于此前多个 1.6.1 包 |

已有按窗口 / Project 保存的本地缩放与滚动视口、可靠通知补收、旧读取失效保护仍然保留。显式来源选择继续持久化并检查版本；刷新或重开后允许重新初始化窗口视口，资料和来源选择保留。

## 6. 跨窗口同步与并发

同步问题不是一个数据库损坏结论。之前已复现并修复的独立问题包括：视口保存错误依赖共享 preference revision、内容刷新覆盖本地缩放、busy / 弹窗时忽略通知，以及数据读取已在途时重建按住的按钮。详见历史 `P0_WORKSPACE_ZOOM_SYNC.zh-CN.md`。

1.6.2 保留这些修复，并在新的项目切换状态协调下复验。真实 Chrome 通过 `chrome.sidePanel.open()` 打开停靠侧栏；测试连接实际 side panel target，不使用普通标签页替代侧栏。

真正同时修改同一旧版本标注，实际结果仍是一次成功、一次安全拒绝，revision 只增加一次。`storage/database.js` 的事务内版本比较、后台写入队列与对象 expectedRevision 检查保留。没有关闭冲突检测或自动覆盖另一窗口的标注。双向内容传播与视口独立是分别验证的。

## 7. 已完成验证与最终安装目录验收

全部数据为专用 Chrome / Edge Profile 或隔离 localhost IndexedDB 中的合成记录，没有删除、导入或修改用户私人 Project。

| 验收内容 | 实测结果 / 报告 |
| --- | --- |
| Chrome 1440 px：一个 Project、空的第二 Project、B 导入不同 Conversation、第三 Project 单 Q/A、A/B/C/A 原生选择、＋ / − / 正文归属 | 15 项生命周期检查通过；`dist/PROJECT_ATOMIC_WIDE_AFTER.json` |
| 1040 px 干净入口、旧图中途交互、来源弹窗、Canvas 晚保存、快速选择、失败恢复 | 已通过；`dist/PROJECT_ATOMIC_NARROW_AFTER.json`；最终安装目录完整 15 项也已通过 |
| Workspace 刷新、关闭重开、删除合成 B 后 A/C 正常、整个 Chrome 进程重启 | 宽窗口完整生命周期通过；检查保留的 A 记录、真实轴比例和 Q/A 正文 |
| 原生 Chrome 侧栏与工作台双向修改、各自缩放、跨项目隔离、并发保护、指针交互及内容摘要 | 23 项通过；`dist/PROJECT_ATOMIC_SYNC_CHROME.json` |
| 独立第二项目及关联 Conversation 区分的既有回归 | 25 项通过；`dist/P0_ATOMIC_SECOND_PROJECT.json` |
| Timeline / Canvas / Reader / Deploy 原有交互 | 14 项浏览器交互、14 项项目时间线、8 项原生 MV3、9 项 Workspace 浏览器检查通过 |
| 全文搜索及管理、标签、备份恢复 | 浏览器检查通过；`SEARCH_MANAGEMENT_BROWSER_REPORT.json`、`QA_TAGS_BROWSER_REPORT.json` |
| 领域回归、静态检查 | 23 组 / 333 项通过；`dist/OPC_NODE_REPORT.json`，另有 ES module / HTML / manifest 检查 |
| 最终 1.6.2 安装目录 | 真实 Chrome 1040 px 完整生命周期 15 项、实际侧栏双窗口验收 23 项通过；`dist/PROJECT_ATOMIC_PACKAGED_LIFECYCLE.json`、`dist/PROJECT_ATOMIC_PACKAGED_SYNC.json`；报告记录加载的运行文件 SHA-256 |
| 用户现有日常 Chrome Profile 的故障页面 | 未完成现场验证，不能记为通过 |

每次缩放检查真实 `pxPerMs` / visibleSpan；本轮生命周期使用按钮中心物理鼠标点击、原生 select 弹出选择、节点真实点击及正文断言。没有先点 Fit、强制 click 或注入偏好来修复默认状态。测试中的短观察间隔只用于确认缩放不会稍后回滚，不进入生产代码。

标签备份测试曾失败，另存 `dist/QA_TAGS_VIEW_ONLY_PRECONDITION_BEFORE.json`：备份前持久化偏好记录数量为 0。旧测试以缩放代替明确来源保存，本轮修正为先在真实来源弹窗点击“保存选择”，仍严格检查恢复后的引用映射和原文完整性；没有改动恢复算法来迎合测试。

重复执行（在工程目录中，PowerShell）：

```powershell
node scripts/diagnose-project-lifecycle-mv3.mjs --navigation-races --width=1440 --report=dist/PROJECT_ATOMIC_WIDE_AFTER.json
node scripts/diagnose-project-lifecycle-mv3.mjs --navigation-races --width=1040 --start-narrow --report=dist/PROJECT_ATOMIC_NARROW_AFTER.json
$env:OPC_TEST_BROWSER='C:/Users/CZGCw/AppData/Local/Google/Chrome/Application/chrome.exe'
node scripts/test-workspace-sync-mv3.mjs --cdp-load --report=dist/PROJECT_ATOMIC_SYNC_CHROME.json
node scripts/validate-all.mjs
node --experimental-vm-modules scripts/build.mjs
node scripts/verify-package.mjs
$env:OPC_TEST_EXTENSION='dist/ai-conversation-visual-navigator'
node scripts/diagnose-project-lifecycle-mv3.mjs --navigation-races --width=1040 --start-narrow --report=dist/PROJECT_ATOMIC_PACKAGED_LIFECYCLE.json
node scripts/test-workspace-sync-mv3.mjs --cdp-load --report=dist/PROJECT_ATOMIC_PACKAGED_SYNC.json
```

## 8. 数据保护、应用方式与剩余边界

本轮没有修改数据库 schema、重置用户资料或放宽并发保护。原始消息、版本、Q/A 归属、非目标标注、关系、Canvas 和已存来源偏好都有摘要或记录一致性检查；切换期间的画布移动另有明确的正确持久化断言。

交付为 `dist/ai-conversation-visual-navigator-v1.6.2.zip` 和 `dist/ai-conversation-visual-navigator`。已安装用户应保持原扩展条目及原加载目录，以新文件更新原目录，再重新加载原条目、重开工作台，核对底部版本 1.6.2。更换 unpacked 路径可能产生不同扩展 origin，使旧数据暂时不可见；本轮不通过换空资料库验收修复。

已验证 Chrome 152.0.7977.65 的隔离原生 MV3、相应 Edge 回归、合成数据与受控时序。尚未覆盖用户私人资料、其日常窗口的 DOM / 控制台、所有旧浏览器版本、任意第三方扩展干扰及真实登录 ChatGPT 采集。本轮修复的是已取得证据的故障路径；用户原现场的持续失效仍需用更新后的真实页面确认，不能将这一项包装成已通过。
