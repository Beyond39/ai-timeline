# P0：完整网页工作台 Zoom 与跨窗口同步修复

日期：2026-10-22（Asia/Shanghai）。仓库根目录：`D:\mytools\GPT-SaaS`。本轮开始已有大量未提交修改；保留这些改动，没有重置、清库或创建提交。下文只归属本轮新增修复。

## A. 根因分析

### 实际架构与完整链路

| 层级 | 实际路径（相对仓库根目录）与函数 |
| --- | --- |
| 扩展入口 | `apps/navigator-extension/manifest.json`：MV3，module service worker 为 `background.js`；Side Panel 为 `sidepanel.html`；options/full page 为 `workspace.html` |
| 页面入口 | `apps/navigator-extension/sidepanel.html`（`data-mode=panel`）、`workspace.html`（`data-mode=workspace`）都加载 `ui/app.js`。工作台额外布局样式没有独立 Zoom 实现 |
| 页面状态 | `apps/navigator-extension/ui/app.js`：`initialize()` → `reload()` → `showCenter()` → `OPCTimeline.show()`；`navigatorSelection` 是恢复偏好，各页面当前 selection 在各自内存中；没有 storage listener 把另一页的选择注入当前页 |
| 共用控制器 | `apps/navigator-extension/ui/opc.js`：`OPCTimeline.show()` → `load()` → `render()` → `HorizontalTimeline.render()`；Q/A click → `openCard()` → `opcDetail` → 正文详情 |
| 缩放与绘图 | `apps/navigator-extension/ui/horizontal-timeline.js`：按钮的真实 click → `zoom()` / `fit()`；`domain/timeline-viewport.js`：`zoomViewport()` / `timelineViewport()`；`domain/timeline-tracks.js`：`horizontalLayout()` / `defaultTrackPreferences()` |
| 渲染方式 | 原生 DOM，按 `pxPerMs` 计算节点的绝对 `left`、board width、滚动窗口；时间轴没有 SVG viewBox / Canvas transform，也没有 React。Canvas 是另一个既有浏览模式 |
| 数据查询 | `ui/dom.js:rpc()` → `chrome.runtime.sendMessage` → `background.js:dispatch()` → `storage/repository.js:command()`；`opcTimeline` → `storage/opc.js:opcPage()` → `opcState()` / `domain/opc.js:timelinePage()` → `storage/database.js:readSnapshot()` |
| 数据写入 | 同一个后台仓库队列 `auxiliary()` / `mutate()` 串行运行；`opcWrite` / `releaseWrite` → 各领域 mutation → `storage/database.js:commit()` |
| 持久化权威 | 两入口相同扩展 origin 的 IndexedDB：`ai-conversation-visual-navigator`，版本 **9**。Projects、Conversations、原始消息/版本、Q/A、metadata、memberships、tags、relationships 都来自该库；按 `projectId` 索引读取。不是两个独立数据库 |
| 通知 | 提交后 `background.js` → `domain/change-notification.js:changeNotification()` → Runtime 广播 → `ui/app.js` 的 `onMessage`。`changed` 刷新共享内容；`viewChanged` 不重建 Timeline |
| 其他存储 | `chrome.storage.local` 保存选择恢复、草稿和布局偏好；`chrome.storage.session` 保存采集来源绑定。没有以 `chrome.storage.sync`、localStorage 或 BroadcastChannel 作为本链路共享内容源。HTTP 验证页有隔离模拟环境，本轮主要验收使用真实扩展 origin |

### 1. 工作台缩放回滚与冲突

修复前 `HorizontalTimeline.zoom()` / `fit()` 在重绘后调用 `save()`；滚动和首次轴初始化也会安排保存。它们把轴范围、平移和来源选择写入同一个按 Project 保存的 `timelinePreferences` 记录，使用该页面缓存的 `revision`。

侧栏和完整网页各持有一个偏好副本；保存视图只广播 `viewChanged`，另一页不会更新它的版本副本。于是同一 Project 中，侧栏先写，工作台继续用旧 revision 保存缩放就会冲突。精确提示来自 `domain/release-data.js:checkRevision()`：

> 此内容已在另一窗口修改。当前编辑没有覆盖，请读取最新版本并核对。

随后真实内容通知进入 `OPCTimeline.load()`，原实现只要读到持久化 preferences，就用它重新生成 `trackPreferences`，覆盖工作台刚更新的缩放。

`dist/WORKSPACE_SYNC_BEFORE.json` 保留了修复前实际 MV3 证据：

- 工作台五次 `+` 的 click/zoom 均执行；实际 `pxPerMs` 从 `9.723349567099567e-7` 增至 `0.000007383668577516234`，节点坐标和 board width 也变化。
- 同时记录到 11 条上述错误报告。该数包含保存失败和 flush 报告同一失败，**不等于 11 次独立写冲突**。
- 再由另一页保存同一项目名称，工作台 visibleSpan 从 `140174222.2222222` 回到持久化的 `1064448000`。该测试失败于前后 span 不相等。

这属于用户要求分类中的 **D（更新后被状态覆盖）**，并伴随 **F（视图操作错误依赖共享版本写入）**。保存拒绝本身没有直接执行 rollback；实际覆盖发生在之后的 `load()`。不能把它描述成数据库拒绝时立即回滚。

### 2. 节点与按钮点击丢失

补测还复现了另一条独立链路：Timeline 数据读取已经在途中，用户才按住 `+`；读取返回后 `OPCTimeline.render()` 调用 `host.replaceChildren()`，按住的原按钮断开，松手无法形成原 click。`dist/WORKSPACE_SYNC_INFLIGHT_BEFORE.json` 中实际断言失败：`in-flight refresh removed pressed control`。

这属于 **A（浏览器没有向原按钮派发完整 click）**。不依赖透明遮罩、disabled、z-index 或鼠标平移捕获。已有修复只处理无关 Project 的通知，或只在通知开始时检查交互，不能覆盖这个顺序相反的场景。

修复后的测试保留 elementFromPoint、真实 pointerdown / pointerup / click、项目/会话/节点 ID、实际缩放范围与坐标。没有只以“按钮存在”断言成功。

### 3. 同步漏更新

原 `ui/app.js` 在 busy 或 `dialog[open]` 时直接忽略 `changed`，没有保留待处理标记；保存期间或弹窗期间发生的真正修改就可能永远不刷新。修复前“弹窗中另一页改项目名、关闭弹窗”测试超时，见 `WORKSPACE_SYNC_BEFORE.json` 第三项。

这与缩放有交集（刷新时覆盖本地 viewport），但**不是单一数据库故障**：共享 UI 偏好写入、异步渲染取消点击、通知被丢弃是三项不同缺陷。

### 4. 为什么侧栏看起来正常、第二个 Project 的作用

两个入口使用相同 Timeline 和状态代码。单窗口、或持有最新偏好版本的窗口可正常操作；本轮复现中，侧栏先写入后，工作台的偏好版本落后。不存在已证实的“工作台专有 Zoom 算法坏了、侧栏算法不同”。相反顺序下侧栏也可能遇到共享偏好冲突，不能保证侧栏天然免疫。

第二个 Project **不是必要条件，也不是充分条件**；一个 Project 的双窗口已经能复现偏好冲突和刷新回滚。新增/编辑另一 Project 会增加通知、切换和读取重叠机会，但没有发现 UUID、存储键或 Conversation 归属冲突。既有无关 Project 只更新项目列表的修复保留，本轮没有让它等待 Timeline 鼠标释放。

### 5. 并发安全结论

`domain/opc.js` / `domain/release-data.js` 继续核对对象 expectedRevision；后台队列串行处理本扩展页面的写入。数据库 `commit()` 在**同一 IndexedDB readwrite 事务中**读取 meta revision、比较、写 changed records、增加 revision；不匹配时 abort。

因此不是把前端“先读版本、再写记录”当作原子 CAS。真正同时写同一旧版标注的测试，实际结果为一次接受、一次拒绝，最终记录只增加一次 revision。没有删除或放宽冲突检测，也没有通过重试覆盖另一方。

## B. 修复代码

生产代码只修改三个文件，保留 UI、存储版本和布局算法：

1. `apps/navigator-extension/ui/horizontal-timeline.js`：`views` 以 Project ID 保存本窗口 viewport；`preferencesFor()` 在共享数据更新时恢复本窗口轴范围/平移。`zoom()`、`fit()`、滚动、拖动和密集节点放大不再写数据库。显式来源选择仍调用 `save()`，保留版本检查和原来持久化记录中的旧 viewport 字段；不把本窗口 viewport 写回去。
2. `apps/navigator-extension/ui/opc.js`：`load()` 在任何 await 之前取得请求 epoch / Project ID；响应及交互等待后再次核验。合并最新共享内容与本地 viewport，避免迟到响应覆盖当前缩放/项目。可选 `beforeRender` 只用于等候尚未完成的指针操作，不强制卸载重挂组件。
3. `apps/navigator-extension/ui/app.js`：待刷新标记合并通知；在操作完成、dialog close、pointerup/cancel 后安排帧边界处理；已在途的读取在应用前也等待指针结束。保留无关 Project 的即时项目列表更新。`reload()` 使用请求序号/目标项目核对，过期返回不改页面。没有新增任意延迟、轮询或重试次数。

测试与交付文件：

- `apps/navigator-extension/scripts/test-workspace-sync-mv3.mjs`：真实 Workspace 与真正通过 `chrome.sidePanel.open()` 创建的停靠 Side Panel；新 Profile、合成数据、测试内临时 instrumentation、数值/DOM/所有权/同步/并发/完整性断言。若不能连接原生侧栏则失败，不用标签页冒充验收。
- `apps/navigator-extension/scripts/test-interactions-mv3.mjs`：显式构造来源选择保存所需的默认偏好，避免旧测试把“缩放必然创建持久化记录”作为前置条件；保留 viewChanged 不移除按住节点的测试。
- `apps/navigator-extension/scripts/test-timeline-project-browser.mjs`：项目切换检查本地 viewport 的归属；页面重开仍验证已存来源选择和原始资料。旧断言错误要求 Zoom 产生持久化写入，已更新为本轮要求。
- `apps/navigator-extension/package.json`：新增 `test:workspace-sync-mv3` 测试入口。
- 本报告。测试日志只记录身份、版本与几何数据；生产代码没有调试日志。

## C. 测试结果

主要证据：`dist/WORKSPACE_SYNC_CHROME_REPORT.json`，本机 Chrome **152.0.7977.65**，全新隔离 Profile，原生 Side Panel target 连接成功。报告含加载目录、三个修复文件的 SHA-256、每次缩放的比例/范围/坐标、DOM 命中、检查结果及数据摘要。

| 验收 | 结果 |
| --- | --- |
| A：单 Project / 单 Conversation，完整网页连续 + 五次 / − 五次，每次实际坐标改变 | PASS |
| A：原生 Side Panel 同样的五次放大/缩小 | PASS |
| 两入口 Fit All、Locate Latest、Zoom 后 Q/A click、Reader ID / Conversation / Project 归属 | PASS |
| B：按住 A 的 + 时从侧栏创建 B；两个独立 Project 反复切换与缩放 | PASS |
| C：单 Project 新增第二 Conversation，两窗口显示新增轨道且各自 viewport 保留 | PASS |
| D：侧栏 → 工作台、工作台 → 侧栏的真实 Reader 标注编辑 | PASS |
| D：两个窗口分别缩放，另一窗口比例独立；数据库 revision 不因缩放增加 | PASS |
| D：同一旧 revision 的真实并发标注写入，恰好一次成功、一次安全拒绝 | PASS |
| 弹窗 / busy 时的更新在结束后补收；既有对话管理在弹窗中保存可完成 | PASS |
| 同项目另页写入发生在 +、−、Q/A 按住期间；以及读取已在途后才按住 + | PASS |
| 迟到的 Timeline 响应不重置新 Zoom，不覆盖后来选择的另一个 Project | PASS |
| E：两个入口选不同 Project，编辑、缩放、节点详情不串线 | PASS |
| 原始数据与非目标标注、关系、Canvas、已有持久化 viewport 摘要一致 | PASS |
| 现有 Node 回归 23 组 / 333 项，另有静态检查 | PASS |
| 既有 Timeline/Canvas 浏览器交互、项目时间线与原生 MV3 回归 | PASS |
| 用户日常 Chrome Profile 中已经打开的旧页面、私人数据的现场操作 | NOT TESTED |

修复前的 FAIL 报告有意保留为反例证据，不能当作当前版本的运行结果；当前验收报告单独标识。

重复执行（PowerShell，在 `D:\mytools\GPT-SaaS\apps\navigator-extension`）：

```powershell
# Chrome 隔离原生扩展验收：启动专用测试 Profile，通过 CDP 加载本仓库。
$env:OPC_TEST_BROWSER='C:/Users/CZGCw/AppData/Local/Google/Chrome/Application/chrome.exe'
node scripts/test-workspace-sync-mv3.mjs --cdp-load --report=dist/WORKSPACE_SYNC_CHROME_REPORT.json

# Edge 使用现有 unpacked 启动方式，仍连接实际 Side Panel。
$env:OPC_TEST_BROWSER='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node scripts/test-workspace-sync-mv3.mjs --report=dist/WORKSPACE_SYNC_EDGE_REPORT.json
node scripts/diagnose-second-project.mjs --expect-fixed --report=dist/P0_SECOND_PROJECT_CURRENT.json
node scripts/test-interactions-mv3.mjs
node scripts/test-interactions-browser.mjs
node scripts/test-timeline-project-browser.mjs
node scripts/validate-all.mjs
node --experimental-vm-modules scripts/build.mjs
node scripts/verify-package.mjs
```

Chrome 的测试加载接口只在本脚本创建的新 Profile 中使用。[Chromium 官方协议定义](https://chromium.googlesource.com/chromium/src/+/e8c195582bdb9edfde0f906c150f5e98af414c44/third_party/blink/public/devtools_protocol/browser_protocol.pdl)说明了 `Extensions.loadUnpacked` 所需的 pipe / extension-debugging 启动参数。没有修改用户现有 Chrome 配置，也没有连接用户的日常浏览数据。

## D. 数据安全

- IndexedDB 名称、版本 9、object stores、索引、持久化数据格式全部未改；无迁移、无清库、无原文重写。
- 既有持久化 viewport 在页面初次打开时兼容读取。此后 Zoom / pan 属于当前页面、当前 Project；关闭页面后会从已有偏好/适配状态重新开始。本轮没有新增“跨页面恢复每次 Zoom”的功能。
- 显式来源选择继续持久化；其保存沿用原有对象版本检查，并保留已存旧 viewport 字段。
- 合成验收保存两个独立 Project、三条 Conversation、18 张 Q/A；对消息、版本、快照、路径、Q/A、归属、关系、非目标标注、Canvas 和已存偏好计算数量 / SHA-256。故意编辑的标题与项目名称单独排除，其他数据前后一致。
- 没有操作用户已有 Profile 的真实数据。已有 Node / 浏览器测试使用原有的人工标注、人工关系和 Canvas fixture 作额外保护。

## E. 剩余问题与应用方式

本报告列出的可复现缺陷已修复；三个核心标准已在真实 Chrome 扩展环境中验收。没有把用户未提供运行时记录的所有“单页持续完全无变化”现象一概归因于本轮已证实的链路。用户私人 Profile / 已运行旧代码的标签页未现场验收。

源码与安装包更新不会自动替换浏览器已加载的 service worker / 页面代码。使用更新后的源码加载目录或安装包后，在扩展管理页重新加载 OPC，并重新打开工作台使其使用新代码；这只是应用版本更新，不是修复逻辑中的页面刷新。关闭旧页面前应先完成其中的编辑。项目资料仍在原 IndexedDB 中。

没有新增 UI、修改样式、改版号、推送或提交代码。发布物沿用当前 1.6.1 版本标识，以文件摘要和本报告区分本次修复。
