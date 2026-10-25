# P0 系统审计：Timeline 点击、重绘与窗口恢复

日期：2026-10-23，Asia/Shanghai。源码目录：`D:\mytools\GPT-SaaS\apps\navigator-extension`。

**结果：已修复有修复前反例的代码缺陷；用户原 Workspace 的持续 ＋／− 失效仍未现场定位，不能宣布彻底恢复。** 用户本轮补充：工作台能正常显示，主要是 ＋、− 无法操作，暂时无法提供现场操作记录。本轮没有把“页面能打开”作为缩放验收。

后续继续处理已完成 **1.6.3 实际安装包**：源码、manifest、两入口可见版本、package 和备份导出版本统一；直接加载安装目录后的 12 项交互、23 项原生侧栏同步、15 项生命周期及 333 项 Node 检查全部通过。原故障实例仍未读取、未自动重载。最终交付路径为 `dist/ai-conversation-visual-navigator-v1.6.3.zip`，解压目录 `dist/ai-conversation-visual-navigator`；旧 ZIP 保留。

证据目录：[`output/p0-system-audit-20261023`](../../../output/p0-system-audit-20261023/)。其中的 Chrome Profile 都是新建的隔离 Profile、合成资料；未复制或连接用户的对话数据库。

## A. 真实问题分析

### 已确认的代码缺陷

1. **尺寸回调绕过交互保护。** `HorizontalTimeline.render()` 内的 `ResizeObserver` 在 host 宽度变化超过 2px 时直接调用 `render(host,data)`，不经过 `ui/app.js` 的 `waitForViewInteraction()`。该 render 调用 `replaceChildren()`，可以在原生 pointerdown 与 pointerup 之间删除按钮或 Q/A。此前对后台通知和在途读取的保护没有覆盖这个渲染生产者。
2. **漏掉终止事件后，指针集合无法自行恢复。** 原 `pressedPointers` 只靠 pointerup、pointercancel、window blur 清理。若终止事件没有到达 document，后续即使已观察到鼠标 `buttons=0`，集合也仍不为空，`scheduleRefresh()` 和等待中的项目读取可以一直停止。这里用受控丢失终止事件验证代码后果，没有声称已在用户原页面观察到事件丢失。
3. **已取消读取仍保留交互等待器。** 原 `cancelNavigation()` 使 epoch 失效，却不能结束已经进入 `waitForViewInteraction()` 的 Promise。新测试保持真实鼠标按下，取消读取后，旧 Promise 在松手前仍不结束。这个缺陷与“正常按住期间应该等待”分别测试。
4. **恢复选择由所有页面写入同一个键。** 当前内存 selection 没有被 storage listener 实时灌入别页，但两个 Workspace 或侧栏／工作台都写 `navigatorSelection`。A 选项目 A、B 选项目 B 后，刷新 A 会恢复 B。没有实时覆盖不等于刷新／重开隔离正确。

### 已确认的运行时缺陷与触发链

在 Chrome **152.0.7977.65** 的真实 unpacked MV3 Workspace 中，修复前严格回归记录到：

```text
真实鼠标按下 ＋／−／Q/A
→ Timeline host 实际宽度改变
→ ResizeObserver 回调
→ HorizontalTimeline.render()
→ host.replaceChildren()
→ 原目标 isConnected=false
→ 松开时原目标没有形成 click
→ 没有对应 zoom／openCard，按钮缩放未发生
```

证据：`RUNTIME_BEFORE_ACCEPTANCE.json`。例如 ＋ 的 hostWidth 从 **952** 变为 **972**，renderCount 增加，visibleSpan 仍为 **483840000**；断言失败于 `ResizeObserver detached the pressed button before pointerup`。− 和 Q/A 同样失败。单纯看 pxPerMs 或节点坐标变化不足以判定点击成功，因为尺寸变化本身也会改变坐标。

修复后同一断言保留原目标到松手，＋ 的 visibleSpan 从 **483840000** 变为 **322560000**；− 恢复更大的范围，Q/A 打开实际所属 Conversation 的 Reader。完整事件、几何、身份及调用记录见 `RUNTIME_AFTER_ACCEPTANCE.json`。

本轮还实际复现了跨页／跨 Chrome 窗口的刷新恢复串项目。修复前同一组 12 项验收 **4 PASS / 8 FAIL**；修复后 **12 PASS / 0 FAIL**。两份报告没有 pageerror；失败不需要 JavaScript 异常。

### 尚未验证的怀疑

- 用户原 ＋／− 是否根本没有命中，是否 disabled、原生 modal 的隐式 inert、显式 inert、透明覆盖层或异常 pointer-events 阻止交互。
- 原页面是否持有旧 1.6.1／早期 1.6.2 内存代码，是否与 service worker 的代际不同。
- 原页面的持续失效是否由尺寸回调反复触发、指针等待残留或其他因素造成。

以上都不能用本轮隔离测试替代现场证据。没有认定 IndexedDB 损坏，也没有把“第二个 Project 的存在”视为充分原因。

### 历史证据与回归边界

已阅读 `P0_WORKSPACE_ZOOM_SYNC.zh-CN.md`、`P0_SECOND_PROJECT_AUDIT.zh-CN.md`、`P0_ATOMIC_PROJECT_NAVIGATION.zh-CN.md`、`REGRESSION_INVESTIGATION_2026-10-22.zh-CN.md`，并核对实际未提交代码与 Git。

分支为 `codex/v1-interactions-hover`，HEAD 为 `17343f3`，历史共 10 个提交。ResizeObserver 直接重建的逻辑已经存在于 HEAD，`git log -S 'new ResizeObserver'` 指向最早保存该文件的 `54a2e27` checkpoint；这不是已找到用户持续失效首次出现的提交。历史报告中“HEAD 基本交互通过”只证明那些测试顺序，不能排除按住时真正改变 host 宽度的缺陷。用户原持续故障的正常／故障边界仍无法确定。

此前几个已证实的通知／原子导航修复保留；推翻的是“通知与读取都受保护，所以所有重绘都安全”这一不完整推论。`ResizeObserver` 清理得当，并不等于其回调在交互中安全。

## B. 根因与修复

| 文件与函数 | 本轮变更及依据 |
| --- | --- |
| `ui/horizontal-timeline.js`：`render`、`resizeAfterInteraction`、`detach` | 尺寸重绘进入与数据读取相同的交互边界；同一轮尺寸通知合并为一个等待；应用前检查 host、data、Project 和连接状态；detach 时 abort 已过期等待。用户松手形成 click 后才允许重建。保留现有坐标算法和 DOM 设计，未重构整个 Timeline |
| `ui/app.js`：指针监听、`waitForViewInteraction` | 鼠标按下记录类型；从后续 mouse pointermove／pointerover／lostpointercapture 的 `buttons=0` 恢复漏掉的终止事件；保留实际按住时的阻塞和独立 touch／pen 身份；隐藏／blur 解除已离开页面的手势。没有固定时间后强行释放或轮询刷新 |
| `ui/app.js`、`ui/opc.js`：等待器、`load`、`show`、`cancelNavigation`、`destroy` | 等待支持 AbortSignal；读取换代、取消导航及销毁结束旧等待并移除监听。等待解除后仍重新检查 epoch／Project，不能让取消的读取提交 |
| `ui/selection-state.js`、`ui/app.js`：`persist`、`initialize` | 优先恢复本标签页 sessionStorage；其次使用当前 Chrome 窗口／入口的 storage.session 默认值，再使用按入口分开的 local 默认值。旧 navigatorSelection 只作兼容读取，不再写回。显式 URL Project 参数继续覆盖默认值 |
| `domain/runtime-build.js`、`background.js`：`runtimeInfo` | 增加只读代际标识 `p0-interaction-lifecycle-20261023.1`，用于区别同为 1.6.2 的内存代码；返回 worker 实际使用的标识、扩展 ID 和 manifest version |
| `ui/app.js`：`runtimeStateSnapshot` | 按需提供非正文的导航／交互快照，没有持续记录用户操作或暴露数据库内容 |
| `scripts/workspace-live-probe.js` | 可在原旧页面安装的被动探针，记录命中、composedPath、连接状态、disabled／inert／modal、比例、坐标、调用与通知、内存函数及 CSS 规则指纹；停止时恢复方法和监听器，不执行 Fit、reload 或数据写入 |
| `scripts/test-workspace-runtime-mv3.mjs`、`package.json` | 新增真实 Chrome 回归及入口，记录运行脚本来源与磁盘摘要，覆盖 12 项严格验收，并验证探针适用于本轮修复前代码 |
| `scripts/test-workspace-sync-mv3.mjs` | 去掉测试开始时的 Fit 和预先写入 timelinePreferences；通过只读获取已存在的实例，直接验收默认状态。保留原有几何、归属、冲突和数据摘要断言 |
| `scripts/inspect-loaded-extension.mjs` | 补全入口、CSS、控制器等摘要；兼容 manifest 不嵌在 Preferences 的注册；明确区分元数据、磁盘和内存，不将不存在的运行版本字段猜成磁盘版本 |

`domain/timeline-viewport.js`、`domain/timeline-tracks.js`、`domain/change-notification.js`、`ui/panel-close.js` 和四份指定 CSS 与本轮开始时逐字节相同，见 `UNCHANGED_AUDITED_FILES.json`。manifest、两份 HTML、common 导出版本和 package 在继续交付时仅为统一 1.6.3 版本标识而修改，不以改版本号代替逻辑修复。

打包脚本只额外允许 `scripts/workspace-live-probe.js` 这一个按需诊断支持文件，未把 fixtures、其他测试脚本或资料打入包。探针不会随工作台自动运行；原页按需采集和新包采集使用相同路径。包内 153 个文件、源码、安装目录和 ZIP 解压字节逐项核对一致；最终校验值在包旁的 SHA-256 文件及 `RELEASE_PACKAGE_1.6.3.json` 中。

### 持久化与同步

内容权威仍是同一扩展 origin 下的 IndexedDB `ai-conversation-visual-navigator`（版本 9）；页面仍通过后台仓库访问它。Zoom／pan 仍属于当前页面的内存视口，明确来源选择才持久化。没有修改 schema、数据迁移、原文、Canvas 格式或 expectedRevision 冲突检测。

后台提交后广播、busy／弹窗期间保留 pendingRefresh、无关独立 Project 仅更新列表、同项目刷新保留当前视口、迟到读取失效保护均复验。真正同时写同一标注旧 revision 的结果仍为一次成功、一次拒绝，未自动覆盖或放宽检查。原始消息／版本、Q/A、关系、Canvas 和已有视口偏好的保护摘要一致。

## C. 浏览器现场状态

| 核对项 | 结果与边界 |
| --- | --- |
| 用户 Chrome 注册的扩展 ID | `kckhiofgkmoilpdcdonjgnnpdmjcacaj` |
| 加载路径 | `D:\mytools\GPT-SaaS\apps\navigator-extension`，和正在编辑的源码一致 |
| 扫描范围 | Chrome 与 Edge 的 Default／Profile N 注册元数据；只发现 Chrome Default 的这一条 OPC，Edge 未发现 OPC。未声称检查了本机所有自定义资料根目录 |
| 磁盘版本 | 调查开始为 **1.6.2**；继续交付后为 **1.6.3**，对应新 ZIP。runtime build 和文件摘要继续用于核对内存代码；旧 ZIP 保留 |
| 注册的运行版本字段 | 此注册元数据未提供 manifest version，记录为 null，不推断 |
| 原 Workspace 内存 JS／CSS | **NOT TESTED** |
| 原 service worker 的实际代际 | **NOT TESTED**；不能用其注册目录或磁盘摘要替代 |
| 修改后的代码是否已加载 | 专用测试 Profile：已通过 Debugger 的脚本源与磁盘摘要比较、worker ID／版本、探针 build 验证。用户原标签页：**NOT TESTED** |

注册证据为 `REGISTRATION_BEFORE.json`／`REGISTRATION_AFTER.json`，继续交付后的磁盘核对为 `REGISTRATION_RELEASE_1.6.3.json`。源码目录测试的 ID 可以与日常 Profile 相同；1.6.3 安装目录测试的 ID 会因路径不同而变化。两者都使用隔离 Profile，不是用户原实例。不要把新的 dist 路径作为另一个扩展条目加载到日常 Profile 来替代原条目，否则会改变扩展 origin，原资料可能暂时不可见。

本轮先枚举了可用浏览器连接及 Chrome 窗口，没有先刷新、重载或关闭原页面。浏览器连接仅提供空的应用内浏览器，没有连接用户 Chrome。Computer Use 读取 Chrome 时返回：`could not determine the current browser URL on Windows with enough confidence to enforce policy`，并中止本轮 Computer Use。随即停止现场控制，没有绕过限制改用另一种桌面自动化。

[computer-use SKILL.md](C:/Users/CZGCw/.codex/plugins/cache/openai-bundled/computer-use/26.1016.61520/skills/computer-use/SKILL.md) 引用的 [guidance.md](C:/Users/CZGCw/.codex/plugins/cache/openai-bundled/computer-use/26.1016.61520/docs/guidance.md) 要求：`If Computer Use reports that the turn ended or that the user stopped Computer Use, stop issuing app input.` 这是停止原页面操作的明确要求；仓库审计与专用 Profile 自动化继续进行。

## D. 验收结果

下表的 PASS 均限定为新建 Chrome Profile、合成资料；原用户实例单列。

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 单 Project | PASS | 默认视口 5 次 ＋、5 次 −，每次 visibleSpan／实际节点 left 改变；无先行 Fit |
| 多 Project | PASS | UI 创建空第二项目、独立 A/B/C、单 Q/A 项目、A/B/C/A 原生选择；节点详情验证正确问题和回答的 Conversation 归属 |
| 网页缩放 | PASS | 连续十次、宽度变化期间按住 ＋／−、两个真实 Chrome 窗口的独立交互 |
| 原生侧栏缩放 | PASS | `chrome.sidePanel.open()` 创建真实停靠侧栏，连接 sidepanel target 后连续 5 次 ＋／5 次 −；没有用普通标签页冒充这一项 |
| 节点点击 | PASS | 真鼠标、elementFromPoint、原目标连接状态、实际 Reader 正文与归属；包括按住时尺寸变化 |
| 跨窗口同步 | PASS | 实际侧栏与 Workspace 双向标注、两 Conversation、无关 Project 通知、独立视口、同 revision 并发安全拒绝、保护摘要一致 |
| 异步竞态 | PASS | 通知与 pointerdown 重叠、读取已在途后按住、迟到读取、取消等待器、busy／弹窗补收、读取失败、Canvas 晚保存 |
| 刷新恢复 | PASS | 每标签页及两 Chrome 窗口的 Project 不串；完整入口打开新 Workspace；关闭重开、浏览器进程重启，资料与控件有效 |
| 用户原 ＋／− 持续失效现场 | NOT TESTED | Computer Use 中止，用户暂时无法提供操作记录；没有将上述 PASS 转记到这一行 |

1.6.3 最终安装目录的主要报告：

- `RELEASE_RUNTIME_1.6.3.json`：12 项 PASS，实际内存 JS 与安装目录一致、worker／manifest／页面版本均为 1.6.3，随包探针 self-module-import、隐私及卸载自测通过。
- `RELEASE_SYNC_1.6.3.json`：原生 Side Panel 与 Workspace 的 23 项 PASS，默认／保留视口的循环验收未先 Fit，双向内容、独立视口、并发拒绝与保护摘要通过。
- `RELEASE_LIFECYCLE_1.6.3.json`：15 项 PASS，UI 创建独立 A/B/C、受控延迟／失败／晚保存以及浏览器重启。
- `NODE_RELEASE_1.6.3.json`：23 组、333 项 Node 检查及静态检查通过。
- `RELEASE_PACKAGE_1.6.3.json`：153 个文件与 ZIP 实际解压字节、版本及 SHA-256 一致。只证明制品完整性，功能由前三份报告证明。

此前源码调查阶段的报告保留：

- `RUNTIME_BEFORE_ACCEPTANCE.json`：本轮开始保存的关键源码组成的隔离反例，12 项中 8 FAIL。不是 Git 某个历史发布版本，也不是用户原页面。
- `RUNTIME_AFTER_ACCEPTANCE.json`：同一组 12 项断言全部 PASS，包含探针导入／隐私／卸载自测和两个真实 Chrome 窗口；修复前重放另验证了旧代际探针兼容。
- `NATIVE_SYNC_AFTER.json`：真实 Chrome 原生侧栏 + Workspace，23 项 PASS，已去除 Fit／预写偏好的测试准备。
- `PROJECT_LIFECYCLE_AFTER.json`：真实 Chrome 1040px 干净入口和受控导航竞态，15 项 PASS。
- `NODE_AFTER.json`：23 组、333 项 Node 回归 PASS；另有静态解析／链接检查。
- `LIVE_PROBE_SELFTEST.json`：当前代际探针自测，只有合成资料的身份、事件及几何，不含问题／回答正文。

早期 `RUNTIME_BEFORE.json` 的“resize PASS”发生于 host 被 CSS `max-width:1100px` 限制、实际宽度没变的情形，不能作为 ResizeObserver 验收。测试随后增加了 **hostWidth 必须实际变化** 的断言；以上只采用最终 `*_ACCEPTANCE.json` 作为前后对比。中间探针自测失败报告也保留，不伪装为功能通过。

测试分层：Node 是算法／领域检查；本轮主要功能报告是实际 Chrome MV3 Workspace／原生 Side Panel；部分“终止事件丢失／延迟读取”用例明确注入故障。探针 modal 检查会在合成页面主动打开设置窗，不能据此断言原现场有 modal。

复跑（扩展源码目录内）：

```powershell
node scripts/test-workspace-runtime-mv3.mjs --report=dist/WORKSPACE_RUNTIME_MV3_REPORT.json
$env:OPC_TEST_BROWSER='C:/Users/CZGCw/AppData/Local/Google/Chrome/Application/chrome.exe'
node scripts/test-workspace-sync-mv3.mjs --cdp-load --report=dist/WORKSPACE_SYNC_CURRENT.json
node scripts/diagnose-project-lifecycle-mv3.mjs --navigation-races --width=1040 --start-narrow --report=dist/PROJECT_LIFECYCLE_CURRENT.json
node scripts/validate-all.mjs
node --experimental-vm-modules scripts/build.mjs --check
```

## E. 剩余问题与安全现场诊断

**尚未真正验收用户当前持续失效的原 ＋／−。** 修复后的新页面在严格场景中正常，不等于旧页面已加载新代码，也不能把刷新本身称为根因修复。用户目前无法操作，当前交付不要求其立刻完成诊断。

条件具备时，保持故障页，不先刷新／重载／关闭弹窗。在原 Workspace 的 F12 → Console 使用仓库中已经自测的探针：

```javascript
await import(chrome.runtime.getURL('scripts/workspace-live-probe.js'));
await __opcProbeReady;
```

这会导入原页面已经缓存的控制器模块，取其内存函数指纹；不会重新执行已加载 app、Fit、reload、读取 IndexedDB 或写入项目。未收到控制器调用前，比例从已渲染的时间证据点推导并明确标注来源；只有一个已知时间而无法推导时记录 unavailable，不捏造控制器状态。新代际可以额外读取 pending／pressed／waiter 快照，旧代际缺少该导出会明确标为 unavailable。

手动悬停 ＋、点击 ＋／− 和一个可见 Q/A 后：

```javascript
copy(__opcLiveProbe.stop())
```

输出可作为文本保存；stop 会恢复包装过的方法、移除监听器，不关闭弹窗，不改动资料。如果 import 或 runtime 本身报错，保留该错误即可，不先重载以消除现场。当前真实加载目录是源码目录，因此 scripts 路径可用；其他历史安装包若无该文件，可将 `scripts/workspace-live-probe.js` 整份粘贴进同一 Console。

收到记录后按以下证据区分，不先假定原因：

| 分类 | 要看的证据 |
| --- | --- |
| A：未命中 | 按钮中心 hit／hitsButton、composedPath、pointerover／hover；用 blocker 元素而非猜 z-index |
| B：受阻止 | `:disabled`、显式 inert、`dialog:modal` 导致的隐式 inert、pointer-events、实际覆盖命中 |
| C：按下但未形成点击 | pointerdown／up／click 序列、原目标 originalTargetConnected、同期 render |
| D：click 未调用 zoom | click 路径与 method=zoom 的 before／after 是否对应 |
| E：zoom 未改状态 | pxPerMs／visibleSpan／axisSpanMs 前后及边界 disabled |
| F：状态改变但未绘图 | render 调用、实际节点 left／box 及比例对照 |
| G：随后被覆盖 | zoom 后样本与 load／show／render／notification 的时间顺序 |
| H：内存旧代际 | 函数 SHA-256 对比两份 acceptance 报告的 functionFingerprints；worker build 与 page app.build；CSS 使用解析规则指纹，不与原始 CSS 字节摘要混比 |

开始的 tracked diff、关键文件快照、文件摘要和修复前隔离目录均保存在证据目录。`production-change.patch` 单独记录本轮运行修复、版本统一、构建／制品校验支持和按需现场探针，已通过只检查的反向应用验证；测试脚本、README 和本文另外保存在工作区。构建／校验脚本经初始 diff 确认原先无用户改动，再从 HEAD 保存其原始基线。`AUDIT_SUMMARY.json` 核对最终源码与三份安装目录浏览器验收的摘要一致。

本轮未 reset、清库、关闭日常 Chrome、修改数据库 schema、创建提交或推送。此前未提交的关闭、删除、标签、Canvas 等改动保留，不归为本轮成果。交付为当前源码、1.6.3 安装目录／ZIP 及证据；历史旧版 ZIP 未重打包，不能用旧包验收本轮代码。用户现有条目注册的仍是源码目录，磁盘已更新；页面与 worker 是否加载新代际仍需实际核对，不能只看磁盘版本。
