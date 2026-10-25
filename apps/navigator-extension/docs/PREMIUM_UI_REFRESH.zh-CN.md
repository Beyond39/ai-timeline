# V1.3 Premium UI Refresh · 2026-10-25

## Checkpoint 1 — 真实代码审计

基线是当前工作区（工程版本 1.7.0），不是旧 Git HEAD。工作区已有大量未提交功能与 P0 修复；修改前备份本轮涉及文件到 `dist/premium-ui-before/`，创建本地分支 `codex/opc-premium-ui-refresh`。

主要问题：

1. 主界面两处 Project Workspace 入口，筛选区混入知识整理、全局检索和对话管理。Topics 缺少主入口。
2. Project Workspace 默认展开全部问答；项目统计不突出，整理、管理和批量操作平铺。
3. 知识主题默认全展开，代表问题和关键词未形成目录摘要；未分析状态主要是算法术语。
4. Deploy 预览区编译与复制优先级不明确，来源托盘操作过密。
5. workbench.css 已有两段 root 变量覆盖，缺少命名排版、间距、圆角和阴影尺度。
6. 已有单一 Reader、固定关闭区、Markdown/KaTeX、长代码滚动、轻量 Hover、窄屏适配与 reduced-motion，应复用。

实施顺序：统一现有 workbench tokens → 主导航与项目概览 → 共享主题摘要和紧凑卡片 → Deploy 与反馈 → 静态、数据、真实 Chrome MV3 和视觉验收。

保护边界：不改数据库、原文、算法、Canvas 图结构/坐标、Timeline 事件生命周期与 Project 原子切换逻辑；不添加服务、不推送、不清空用户数据。仅用隔离浏览器与合成测试资料。

## 验证记录

改造前：Chrome 本地页面 5 项 workbench 回归通过，桌面和 390px 截图已保存。

## Checkpoint 2 — 最终设计语言与 Tokens

沿用现有原生 HTML / CSS / JavaScript，无新框架、字体下载或图标依赖。统一浅色工作台，雾蓝表示主操作与选择；中性背景区分导航和正文。原有不成熟的历史主题样式没有扩展为新的主题系统。

`ui/workbench.css` 的唯一工作台 `:root` 定义：

| 类别 | Tokens / 数值 |
| --- | --- |
| 背景 / 表面 / 次级表面 | `--bg: #f7f8fa` / `--surface: #fff` / `--surface-subtle: #f1f4f7` |
| 正文 / 辅助文字 | `--text: #263445` / `--muted: #586779` |
| 边框 / 强调色 | `--border: #dce3e9` / `--primary: #3e6382` |
| 间距 | `--space-1/2/3/4/6`: 4 / 8 / 12 / 16 / 24px |
| 字号 | caption / meta / body / card / section / title: 11 / 12 / 13 / 14 / 16 / 20px |
| 圆角 | `--radius-sm / --radius / --radius-lg`: 6 / 10 / 14px |
| 浮层阴影 | `--shadow-panel: 0 12px 40px #2634451a` |
| 控件 | 34px 常规高度；关闭区保留 40px 点击热区；Reader 正文 14px / 1.85 |

不对 Canvas 坐标或 Timeline 几何应用动画。按钮只有 120ms 颜色过渡，并尊重 reduced-motion。

## Checkpoint 3–5 — 实际改动

| 区域 | 改动与保留边界 |
| --- | --- |
| 主导航 | Timeline / Topics / Canvas / Deploy；Topics 打开原有知识面板，不新增路由。保留 Project 选择器；项目概览只有一个常驻入口。全局搜索缩为有可访问名称的图标入口，对话管理进入“更多”。 |
| Timeline | 搜索和工作操作在宽屏共用一行，窄屏分行；移除旧版 1100px 内容限制；轨道使用中性背景和小范围来源色。沿用已有时间刻度、密度节点、选择来源、适配全部、定位最新、滚动、缩放控制器。 |
| Project Workspace | 增加项目名、Conversation / Q/A / Topic 数量和三个工作入口。管理与整理选项折叠；主题默认折叠，展示代表问题、关键词与人工/候选标识。搜索自动展开结果；选择卡片后才出现批量操作。现有 Workspace 仍是关联多个 Conversation 的项目集合，不迁移普通 Project 数据。 |
| Q/A Card | 原文预览与人工标题/算法候选标题/原始问题明确区分；目录去掉重复回答预览，标题限制两行。Canvas 保留原有节点尺寸和坐标，收敛标题、标签、阴影与预览密度。 |
| Reader | 使用唯一原有 Reader，保留完整 Q/A、Markdown/KaTeX、代码横向滚动、固定关闭区、关闭后视口恢复；正文 14px、标题 18px，来源旁标明标题类型。 |
| Topics | 与概览复用 `topic-summary.js`；候选主题展示关键词、代表问题和数量。详情默认折叠，窗口内重新打开保留展开状态；旧“对话阶段与知识详情”整体折叠但所有分析与编辑操作保留。选中后再显示移动/Deploy 操作。 |
| Deploy | 明确项目、来源 Conversation 数量、顺序控制与上下文预览。生成前突出编译，生成后突出复制完整上下文；次要导出保留在菜单。来源标题两行，已在编辑包时“新建上下文包”不再冒充编辑当前包。移除编辑区额外滚动容器。 |
| 空状态与反馈 | 项目未关联对话、无主题、项目搜索无结果、全局搜索无结果、知识未整理均有下一步提示。复用原有分析进度、失败反馈、模型下载/离线导入、Deploy 空托盘和 Reader 重试。没有假称新算法已实现。 |
| 交互保护 | 原生 details / summary 支持键盘；新入口有语义与可访问名称。过滤与临时勾选不再误报未保存内容；真正的编辑仍走既有关闭保护。过期、已脱离 DOM 的折叠事件不再写回展开状态。 |

没有修改 `horizontal-timeline.js`、Project 原子切换、指针生命周期、数据库、采集、算法和 Canvas 图数据。未新增 API 或外部服务。

## 修改文件清单（仅本轮）

所有路径相对于 `apps/navigator-extension/`；已有未提交修改不算本轮新增成果。

- `sidepanel.html`、`workspace.html`：Topics 导航和项目概览名称。
- `ui/app.js`：Topics 按钮接入原有知识面板。
- `ui/workbench.css`：统一 tokens、工作区排版和响应式。
- `ui/opc.js`：整理菜单、搜索入口、标题来源标识；未改初始化/手势逻辑。
- `ui/project-workspace.js`：概览、折叠主题目录、选择操作和搜索状态。
- `ui/topic-summary.js`（新增）：共享主题摘要组件。
- `ui/knowledge.js`：目录摘要、详情折叠、选择操作和空状态。
- `ui/context-deploy.js`：来源摘要、主操作优先级和新建包命名。
- `ui/global-search.js`：无结果提示。
- `domain/card-presentation.js`：只读的标题来源展示字段。
- `scripts/test-premium-ui-mv3.mjs`（新增）：本轮真实 Chrome 扩展 UI 验收。
- `scripts/test-interactions-browser.mjs`、`scripts/test-workspace-sync-mv3.mjs`、`scripts/test-panel-close-browser.mjs`：按新菜单与折叠目录操作，保留原回归断言。
- `package.json`：增加 `test:premium-ui-mv3`，无新增依赖。
- `docs/PREMIUM_UI_REFRESH.zh-CN.md`（本文件）：审计、设计、交付和验收记录。

## Checkpoint 6 — 构建与回归

本轮测试使用 Chrome **155.0.8059.85**，全新独立配置和合成对话。真实扩展测试运行 `chrome-extension://` 页面和 service worker；Side Panel 同步套件包含原生侧栏目标。不是用构建通过替代 UI 验收。

| 测试 | 结果 | 证据（相对本目录） |
| --- | --- | --- |
| Node：25 套功能/数据测试 + 静态检查 | 378 项通过；26 套检查通过 | [OPC_NODE_REPORT](../dist/OPC_NODE_REPORT.json) |
| 多项目运行时、按下/抬起期间 ResizeObserver、窗口状态恢复 | 13 / 13 | [WORKSPACE_RUNTIME](../dist/WORKSPACE_RUNTIME_MV3_REPORT.json) |
| 一、二、三个 Project；空第二项目；异步切换与保存、重启 | 15 / 15 | [PROJECT_LIFECYCLE](../dist/PROJECT_LIFECYCLE_DIAGNOSTIC.json) |
| 原生 Side Panel / Workspace 同步、并发保存与点击 | 23 / 23 | [WORKSPACE_SYNC](../dist/WORKSPACE_SYNC_MV3_REPORT.json) |
| Canvas 拖动/连线、Hover 穿透、真实卡片点击、键盘与触摸模拟 | 14 / 14 | [INTERACTIONS](../dist/INTERACTIONS_ALL_REPORT.json) |
| 本轮概览/Topics/搜索/Deploy/数据保护/真实缩放 | 10 / 10 | [PREMIUM_UI](../dist/premium-ui/REPORT.json) |
| 未保存输入、Esc 最上层关闭、重复开关无遮挡 | 8 / 8 | [PANEL_CLOSE](../dist/PANEL_CLOSE_BROWSER_REPORT.json) |
| Reader 排版、错误重试、390 / 768 / 1024px、标签不重叠 | 5 / 5 | [WORKBENCH](../dist/WORKBENCH_REDESIGN_REPORT.json) |
| 实际构建安装目录再次验证 P0 | 13 / 13；不计入上述 88 项独立场景 | [PACKAGED_RUNTIME](../dist/premium-ui/PACKAGED_RUNTIME_REPORT.json) |
| 构建与包完整性 | JS 语法与模块依赖通过；源码/安装目录/ZIP 字节一致 | [STATIC](../dist/STATIC_CHECK_REPORT.json)、[PACKAGE](../dist/PACKAGE_CHECK_REPORT.json) |

浏览器合计 **88 个独立验收场景通过**：61 个原生 MV3 场景、27 个本地页面 DOM 场景；另对构建包重复运行 13 个 P0 场景。测试中曾因新菜单、默认折叠和异步保存改变操作路径而失败，已修正测试定位/等待并重跑；没有跳过原有数据保护和点击断言。

实际验证 `chrome.tabs.setZoom` / `getZoom` 的 1.25 和 1.5，不以 CSS 缩放冒充浏览器缩放。Deploy 完成真实剪贴板复制操作及 Markdown 下载；测试断言输出含原文末尾标记。原始消息、版本、人工连线和保存的 Canvas 布局在本轮浏览操作前后逐字相同。

本机 `npm` 没有进入命令路径，执行的是相同的 Node 入口：`node scripts/validate-all.mjs`、`node --experimental-vm-modules scripts/build.mjs`、`node scripts/verify-package.mjs`，没有将命令不可用记作测试通过。

## 截图与交付

所有截图来自合成数据，不含私人聊天。前后对照使用同一交互测试页：

| 对照 | 改造前 | 改造后 |
| --- | --- | --- |
| 桌面 Reader + Timeline | [Before](../dist/premium-ui-before/desktop.png) | [After](../dist/WORKBENCH_REDESIGN_DESKTOP.png) |
| 390px Reader | [Before](../dist/premium-ui-before/narrow.png) | [After](../dist/WORKBENCH_REDESIGN_NARROW.png) |

完整扩展最终截图：[Timeline](../dist/premium-ui/timeline.png) · [Project Overview](../dist/premium-ui/overview.png) · [Reader](../dist/premium-ui/reader.png) · [Topics](../dist/premium-ui/topics.png) · [Canvas](../dist/premium-ui/canvas.png) · [Deploy](../dist/premium-ui/deploy.png) · [390px](../dist/premium-ui/narrow.png) · [125%](../dist/premium-ui/zoom-1.25.png) · [150%](../dist/premium-ui/zoom-1.5.png)。

可加载目录：`dist/ai-conversation-visual-navigator/`。安装 ZIP：`dist/ai-conversation-visual-navigator-v1.7.0.zip`。本轮 V1.3 是 UI 设计任务名称，工程版本保持当前 1.7.0，避免倒退已有版本链。旧 1.7.0 ZIP 和本轮修改前源文件保存在 `dist/premium-ui-before/`。未重新加载或替换用户当前浏览器中的扩展条目。

更新已有安装时保持原扩展条目和加载路径；不要删除扩展或清空 IndexedDB。新配置中的验收不等于用户正在使用的旧配置现场验收。

## 未验证范围与风险

- 未在用户已安装、含私人数据的 Chrome 配置中现场验收，也没有采集真实登录态 ChatGPT。全部实际浏览器检查均为隔离 Chrome 自动化。
- 本轮没有重新下载语义模型、运行真实付费 AI 调用或评估算法质量；复用了已有实现与反馈。知识结果只用本地 Lexical 路径做浏览器验收。
- 既有历史浏览器脚本并未全部重跑。旧脚本如果直接点击已折叠内容，需先展开；本次运行的相关脚本已按真实 UI 更新。
- Topics 展开状态在当前窗口内保留；Project 目录沿用本地保存的折叠偏好。未新增跨窗口同步的布局系统。
- 没有新做移动 App、Question Map 算法或深色主题。极大量数据的长期性能、系统高对比模式和屏幕阅读器人工评审仍未单独验收。

## Git 与后续建议

本地分支：`codex/opc-premium-ui-refresh`。本轮没有 commit 或 push；工作区仍包含进入任务前已有的大量修改和未跟踪文件。没有 reset、clean 或覆盖未提交源文件，没有删除用户 IndexedDB 或 Q/A。

后续优先：用实际日常工作流程评审源 Project 与多来源项目集合的命名关系；对数千 Q/A 的主题目录按需渲染做独立性能迭代；在明确需求后再做成熟的深色模式与 Question Map，避免与本轮稳定交互混在一起。
