# OPC Timeline UI / UX 首轮升级（2026-10-23）

## 工程与设计判断

原生 JavaScript；workspace.html 与 sidepanel.html 共用 opc.js、horizontal-timeline.js 和 workbench.css。仓库已有大量未提交的业务与稳定性修复，本次仅在此基础上增量修改，没有回退原有工作。

优先问题是节点缺乏可扫读标题、来源标签挤占顶部、浮层遮挡时间线、元信息挤窄长篇正文、来源回溯隐藏过深及失败读取缺少重试入口。

## 实现及取舍

- 统一中性底色、蓝色强调、字号层级、4/8/12/16/24 间距尺度、按钮与焦点状态；复用已有组件，无新依赖。
- Project 标题突出，导航与搜索可换行，来源条横向滚动并截断长标题，保留完整提示与隐藏轨道操作。
- 横向多轨、共享时间坐标及聚合算法不变；增加轨道底色与横向固定名称。节点和所属轨道颜色一致。
- 节点与下一节点之间至少有 72px 时显示序号与省略标题，最大宽度 160px；密集处仍用原来的聚合展开。悬停或键盘焦点可读完整标题，不增加推测连线。
- 至少 1280px 的工作台 Timeline 采用并排阅读；小窗口与扩展侧栏继续保留可关闭浮层。现有 ResizeObserver 及点击边界保护负责布局变化，没有新增手势系统。
- 阅读区固定关闭栏、正文独立滚动、Q/A 层次分明，代码与表格内部滚动。真实来源入口、复制回答可直接访问。
- 紧凑显示已保存的类型、整理状态、采纳状态、标签；没有通过关键词猜测“决策”或处理进展。保留编辑、自动保存、草稿和冲突保护，标题编辑同步时间节点名称。
- 读取失败提供真实错误与重试，沿用请求代次和 Project 归属检查；选中节点提供 aria-pressed，沿用 Escape、弹窗关闭优先级和焦点返回。

没有修改核心手势、Project 状态管理、API、数据库、存储格式、NLP 或知识提取算法；没有删除、迁移用户数据。测试数据仅用于隔离浏览器配置与验证数据库。

未新增 Knowledge Tree / Project Overview：保留现有 Project Workspace 和知识整理入口，不在缺乏可靠主题层级时编造树。阅读信息条和现有模式边界可以承载后续真实字段。面板暂不支持手动调宽，采用响应式比例，避免新增拖动手势冲突。

## 验证与复现

在 apps/navigator-extension 运行：

- `node scripts/validate-all.mjs`：24 套 Node 检查及静态模块/资源检查通过。
- `node scripts/test-timeline-project-browser.mjs`：14 项真实浏览器检查通过，覆盖缩放、拖动、多 Project 集合切换、节点展开、关闭、刷新恢复、未知时间、纵向滚动及迟到读取。
- `node scripts/test-workbench-redesign-browser.mjs`：5 项布局检查，覆盖并排阅读、选中语义、长代码内部滚动、标题无重叠、390/768/1024px 页面无横向溢出、读取错误重试。
- `node scripts/test-workspace-runtime-mv3.mjs`：真实 Chrome MV3 隔离配置，覆盖三个独立 Project A/B/C/A、点击与 ResizeObserver 竞态、多标签/窗口恢复、侧栏独立状态，以及完整工作台并排阅读布局。
- `node --experimental-vm-modules scripts/build.mjs`：生成可加载扩展目录与 ZIP。

报告：dist/OPC_NODE_REPORT.json、dist/TIMELINE_PROJECT_BROWSER_REPORT.json、dist/WORKBENCH_REDESIGN_REPORT.json、dist/WORKSPACE_RUNTIME_MV3_REPORT.json。

截图：dist/WORKBENCH_REDESIGN_MV3.png、dist/WORKBENCH_REDESIGN_DESKTOP.png、dist/WORKBENCH_REDESIGN_NARROW.png，均为合成测试数据。

浏览器启动需要沙箱外运行。上述浏览器验收使用真实 Chromium/Chrome，但不等同于私人 Chrome Profile 或在线 ChatGPT 账户采集验收。原有采集解析回归通过，本轮没有在登录账户内重新采集真实对话。未知时间不使用导入时间补造位置；密集轨道需缩放或打开聚合列表阅读。
