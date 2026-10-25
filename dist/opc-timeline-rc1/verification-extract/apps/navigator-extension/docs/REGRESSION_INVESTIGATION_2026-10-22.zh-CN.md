# 2026-10-22 Timeline 紧急回归调查：现场故障尚未定位

## 当前结论

**未修复，不能宣布恢复成功。** 本轮重新取得了 Git 和真实 Chrome 证据，但没有在原失效标签页完成运行时取证。隔离测试成功不能证明该标签页已经恢复，也不能据此断定它只需要刷新。

用户最新描述是网页控件没有悬停反馈且无法点击。这需要观察原页面的鼠标命中、遮挡层、原生 modal/inert 状态及实际加载的事件处理器。不能用缩放算法的静态分析替代现场证据。

## 代码与数据保护

- 分支 `codex/v1-interactions-hover`，HEAD `17343f3292352ab21ad79d70ded81efe66a36dcb`，历史共 10 个提交；当前大量修复尚未提交，不能把它们伪装为某个确定提交。
- 最初和结束时的完整 tracked diff 按 SHA-256 比较相同。本轮没有改动任何既有生产文件，也没有 reset、checkout 覆盖、清库、重载日常扩展或改写用户资料。
- 持久保存目录：`../dist/regression-investigation/`，包含 `working-tree-before.patch`、`working-tree-current.patch`、`key-diff-before.txt` 和 284 个枚举来源文件对应的源文件快照（新诊断脚本排除）。早期临时目录副本不作为持久备份依据。
- 只读核对 Chrome Default 的 OPC 注册：扩展加载自本工程 `apps/navigator-extension`，磁盘 manifest 为 1.6.2，核对的后台、app 和通知模块摘要与源码一致。**这证明磁盘路径一致，不证明已有标签页内存中的代码一致。**
- 仅复制 OPC 自身 IndexedDB 和 Local Extension Settings 到 `../dist/regression-opc-copy/Default`。未复制 Cookie、浏览历史或其他扩展资料。该副本初始包含 1 个 Project、1 个 Conversation、4 张投影 Q/A；报告不输出正文。

## 版本与实际差异

最近一个在本轮确认基础 Timeline 交互正常的 Git 提交为 **`17343f3`**。单 Project 的 ＋、−、Q/A 点击、第二个独立 Project、A/B/C/A 切换及刷新重开等 7 个检查通过。

这不是“整个 HEAD 所有功能通过”：其完整生命周期脚本在合成 B 删除后的 A 备份相等断言失败，差异为旧实现会保存缩放偏好，使 `timelinePreferences` 的 revision/updatedAt 变化。该失败不是 ＋、− 或点击失败，未把它改写为通过。

首次出现用户当前故障的版本或最小变更范围：**尚未确定**。当前磁盘源码同样通过本轮基础交互测试，缺少可复现的正常/故障边界，不能做有效二分，更不能仅凭相邻提交名称指定责任提交。

重点复核的实际差异如下，均包含在保存的 key diff：

| 路径 | HEAD 到当前工作区的关键变化 | 本轮结论 |
| --- | --- | --- |
| `ui/app.js` | 指针期间延后重建；通知补收；最新 Project 选择排队；失败恢复壳层 | 确认存在于未提交改动，隔离普通流程及既有竞态测试通过；未证明是当前现场故障原因 |
| `ui/opc.js` | show/load 先读后提交 Project；提交前等待交互、排空旧项目写入 | 与当前代码逐行对比；普通导航和受控竞态通过；未证明是当前现场故障原因 |
| `ui/horizontal-timeline.js` | 按窗口/Project 保存内存视口；缩放不再写共享偏好；显式来源选择继续持久化 | 实际比例及节点坐标随按钮变化；未证明当前现场按钮收到事件 |
| `domain/timeline-tracks.js` / `domain/timeline-viewport.js` | 相对 HEAD 没有未提交差异 | 不能将本轮新增回归未经证明地归因于这两个模块 |
| Workspace、关闭面板、通知和 CSS | 有既有未提交修改 | 已核对入口共用控制器及布局；仍需要原页面的命中和遮挡证据 |

`97d8feb`、`379dd90`、`fa2b11f`、`817f816`、`5c17c6f` 到 `17343f3` 的历史已检查。最近单 Project 失效尚未复现，因此没有声称在这些提交之间找到了首次故障。

## 本轮重新运行的真实浏览器结果

浏览器：Chrome 152.0.7977.65。下表报告均为本轮新执行，文件位于扩展工程的 `dist/`。

| 报告 | 范围 | 结果 |
| --- | --- | --- |
| `REGRESSION_CURRENT_BEFORE.json` | 当前源码，合成数据；单 Project、2/3 个独立 Project、实际鼠标、原生选择器、加载中交互、失败恢复、Canvas、浏览器重启 | 15/15 通过 |
| `REGRESSION_SYNC_BEFORE.json` | 当前源码；`chrome.sidePanel.open()` 实际原生侧栏与 Workspace；双向修改、视口独立、并发拒绝、按住按钮期间通知、数据摘要 | 23/23 通过 |
| `REGRESSION_HEAD.json` | Git HEAD 的隔离导出 | 基础交互前 7 项通过，第 8 项备份严格相等失败；不能记为全套通过 |
| `REGRESSION_DATA_COPY_BEFORE.json` | 用户 OPC 数据副本，用户完整 Project/Conversation/Path/sourceTab 入口，1440px；没有先 Fit 或修改来源选择 | ＋/−实际比例、Q/A Reader 2/2 通过 |
| `REGRESSION_DATA_COPY_1040.json` | 同一数据副本和完整入口，1040px | 2/2 通过 |
| `REGRESSION_DATA_COPY_768.json` | 同一数据副本和完整入口，768px | 2/2 通过 |
| `REGRESSION_DATA_COPY_HEADED.json` | 有可见窗口的 Chrome，同一数据副本和入口，1440px；增加真实鼠标移动后的 `:hover` 与 elementFromPoint 命中 | 3/3 通过 |
| `REGRESSION_HEAD_DATA_COPY*.json` | 尝试将 IndexedDB 目录改到历史导出版本的不同扩展 origin | 未进入 Timeline，属于副本准备失败；不作为正常版本、数据丢失或产品回归证据 |
| 原日常 Chrome 故障标签页 | 用户报告无悬停反馈、无法点击 | **未完成现场验证，不能记为通过** |

用户数据副本 1440px 的实际 `pxPerMs`：`0.00018586543472476003` → ＋后 `0.00027879815208714005` → −后 `0.00018586543472476003`，等待异步稳定后没有回滚。这个证据只适用于新建的隔离页面。

## 实际修复与新增文件

生产功能修复：**无**。尚未取得原故障根因，不添加推测性补丁、不回退有效功能、不重新打包发布。

新增 `scripts/diagnose-workspace-regression.mjs`：仅允许使用本工程 `dist/` 内的隔离 Profile，读取实际 Timeline 实例，记录比例、按钮命中、Project 身份、事件及错误，执行悬停、＋、−和 Q/A 点击；不输出 Q/A 正文，不硬编码用户 Project/Conversation ID。新脚本语法检查已通过。示例：

```powershell
node scripts/diagnose-workspace-regression.mjs --profile=dist/regression-opc-copy '--query=<工作台地址问号后的参数>' --headed --report=dist/REGRESSION_DATA_COPY_HEADED.json
```

## 现场取证阻塞与继续条件

读取日常 Chrome 窗口时，Computer Use 返回：`could not determine the current browser URL on Windows with enough confidence to enforce policy`，并停止本轮 Computer Use。没有绕过该检查继续控制该窗口。

[computer-use SKILL.md](C:/Users/CZGCw/.codex/plugins/cache/openai-bundled/computer-use/26.1016.61520/skills/computer-use/SKILL.md) 引用的 guidance 明确要求：`If Computer Use reports that the turn ended or that the user stopped Computer Use, stop issuing app input.` 这是停止继续输入的明确要求；不是用户数据发生故障的原因，也不是要求回滚代码的理由。

此外只读确认日常 Chrome 未开放 remote debugging 接口，不能直接用现有调试端口读取原故障页。没有为此改动用户浏览器启动设置。

下一步需要将原故障工作台保持在前台，**不先刷新、重载扩展、关闭弹窗或重新导入数据**，在后续轮次重新进行只读现场识别，取得 `elementFromPoint`、modal/inert、事件和已加载函数的证据。若仍无法取得原页面证据，必须继续报告未定位，不能把隔离验收包装成修复成功。
