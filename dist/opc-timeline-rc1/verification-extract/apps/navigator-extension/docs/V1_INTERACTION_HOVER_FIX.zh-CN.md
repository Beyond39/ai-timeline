# V1 交互修复与 Canvas 悬浮预览

日期：2026-10-21。范围：修复交互、复用完整阅读、增加本地 Hover Preview；未新增算法、Question Map、外部 API 或发布包。

## 检查点与数据安全

开始时分支为 `codex/project-organization-v11`，HEAD `596b9e6`；已跟踪源码和暂存区干净。大量既有未跟踪文件保留原状。新建本地标签 `local-v1-before-interactions-hover` 和分支 `codex/v1-interactions-hover`，没有覆盖已有分支/标签、push、hard reset 或 clean。

本轮没有改变数据库版本、表结构、原始消息、版本、Card ID、Conversation 归属、Workspace 关联或备份格式。没有删除 IndexedDB、重置节点位置或人工关系。测试仅使用独立配置和合成数据；没有访问用户真实浏览器配置。原有恢复点和全库备份机制保留。

源码仍在 `D:\mytools\GPT-SaaS\apps\navigator-extension`。已有安装若加载该目录，在扩展管理页重新加载即可使用；本轮没有更新旧 `dist` 安装目录，也没有替用户切换扩展身份或迁移私人数据。

## 根因与修复

1. **视图保存触发全量重建。** 原 `background.dispatch` 将所有 `releaseWrite` / `opcWrite` 都广播为 `changed`；`app.js` 收到该事件会 `reload(true) → showCenter → opc.show/load/render`。时间线缩放/平移偏好和 Canvas 坐标也走这条链，可能在 pointerdown 与 click 之间移除原节点。现在仅 `timelinePreferences` 和 `layout` 发 `viewChanged`，持久化照常，当前工作台不因此重建；正文、标注、关系、项目调整仍发 `changed`。
2. **Canvas 按下即捕获指针。** 旧节点 `pointerdown` 不区分是否真正拖动，就在 article 上 capture。点击内部阅读 button 时，释放后的 click 目标可能变成 article，原 button 的阅读回调不执行。基线真实鼠标测试复现了正常点击和拖动后再点击打不开 Reader。现在移动达到 5 个屏幕像素才开始捕获；普通按下和微小抖动保留原生 click。
3. **拖动后的残留 click 拦截。** 旧实现临时加 `once` 拦截器；当释放点没有产生对应 click 时，它可能吞掉下一次正常点击。共享手势处理只抑制本次拖动的释放点击，下一次物理按下会清除状态；键盘 activation 不受影响。
4. **旧阅读请求可回写新视图。** 原 `show/render` 没有及时使 pending `opcDetail` 失效。现在读取前捕获 project、panel 和 request epoch；切换、重建、关闭及 destroy 使旧请求失效。测试特意延迟 A 项目请求，再打开 B 项目，释放旧请求后仍保留 B 的正确 Q/A。
5. **重绘的事件清理不完整。** 时间线观察器、活动 pan 和 Canvas document 级拖拽监听器现在在重绘/切换/销毁时清理；pointercancel、lostcapture、Escape、窗口失焦均结束手势。

单 Conversation 基线中，Timeline 的范围缩放、空白拖动和滚轮本身能工作；没有把它们误报为全部失效。修复针对实际保存/重绘链和已复现的 Canvas 点击问题，没有通过单纯提高层级伪装修复。

## Timeline 调用链

- `＋ / − → HorizontalTimeline.zoom → 根据当前 layout 计算中心时间与新 span → horizontalLayout → render → save`。缩放确实改变时间范围及 board 宽度；适配全部设置 axisFit，恢复全范围。
- 背景 `pointerdown → pointermove → scrollLeft → scroll 更新概览和范围 → debounce save`；滚轮沿用原交互，将主要 delta 作用于横向 scroll，Ctrl/Meta 保留原行为。
- `定位最新 → 当前 this.layout.latest → locate`；点按时间点、未知时间列表或密集分组中的问题，均调用同一 `OPCTimeline.openCard`。
- `save → releaseWrite(timelinePreferences) → IndexedDB → viewChanged`，不再额外重建当前工作台。缩放本身为重算刻度和聚合点而重绘是正常行为，与保存后额外重建有区别。
- 适配全部后若时间轴刚好容纳全部数据，滚动范围为零；放大后可平移。这是范围行为，未人为制造空白可拖动区域。

## Canvas 交互如何共存

`bindPointerDrag` 共享按下、阈值、capture、释放、取消和清理生命周期：

| 操作 | 行为 |
| --- | --- |
| 点击阅读区或节点空白 | 进入原有完整 Reader |
| Enter / Space 聚焦节点 | 进入同一 Reader |
| 拖动阅读区/节点空白 | 超过 5px 后按 Canvas zoom 换算世界坐标，保存实际移动节点 |
| 背景拖动 | 只改 viewport；不会触发节点阅读 |
| 拖动连接锚点 | 显示临时线，释放到目标节点后打开原关系编辑对话框 |
| 点击/键盘激活连接锚点 | 保留原关系选择入口 |
| 勾选、标签、上下文按钮 | 独立控件，不作为节点拖动起点，也不触发阅读 |
| Escape / 取消 / 失焦 | 结束活动手势；节点/背景取消时恢复该手势起点，不写入半次移动 |

节点移动只传已移动坐标，viewport 和关系使用原有保存、冲突校验与渲染。关闭 Reader 仅隐藏面板，不重绘或重置 Canvas/Timeline。没有使用全 Canvas 透明遮罩。节点本身重叠时仍按原来的绘制顺序命中；本轮没有重做节点堆叠系统。

## Hover Preview

- `CardHoverPreview.bind` 接收卡片节点、稳定卡片和来源项目；pointer 停留或键盘聚焦后等待 **300ms**。短暂经过不读取详情、不弹出浮层。
- 延迟结束后只调用本地 `opcDetail`，复用已有不可变 Q/A 读取链。展示真实自定义标题、来源 Conversation、问题前 200 字符、回答前 320 字符以及点击提示；预览采用纯文本，不把截断的 Markdown/LaTeX 交给渲染器。
- 单实例最多显示一个浮层，缓存最多 40 条有界片段。缓存键含项目、Card ID、正文版本和元数据 revision；不缓存整份大回答，不执行 TF-IDF/Embedding，不调用外部服务。
- 浮层以 `position:fixed` 挂在 body，脱离 Canvas transform/overflow。`previewPlacement` 默认宽 340px，必要时收窄为 280/220px；优先尝试卡片右/左/下/上，再尝试窗口空位，避开其他可见卡片、按钮和 Reader，限制在窗口边缘内；没有足够空位时不显示，仍可点击阅读全文。
- 浮层 `pointer-events:none`，不占据 Canvas 的事件命中。定位时避开邻近卡片与可见控件，不锁住操作区域。
- 离开、Escape、滚动、resize、视图移动、点击阅读、切换、重绘和销毁均关闭。按下拖动/连线时暂停，结束后需要新的停留/聚焦触发。序号检查阻止离开后的异步读取再弹出旧预览。
- 触屏不依赖 Hover；保留 tap 完整阅读。已做触屏模拟，未做实体触屏设备验收。

## Reader 与未来结果展示

Timeline、Canvas、Search、Workspace 结果继续进入 `OPCTimeline.openCard` / `openIndexedCard`。详情仍由原 `storage/opc.opcDetail` 读取来源版本，原 `richBody` 渲染完整 Markdown、代码及本地 MathML。没有第二套完整 Reader，也没有使用卡片预览字段替代正文。

未来 `Project → Topic → QACard` 的结果继续用稳定 `cardId + 原来源 projectId` 调用 `openIndexedCard`。需要快速预览时可复用 `cardPreviewContent`、`CardHoverPreview` 和 `previewPlacement`；主题归属与人工 Canvas 边继续分离。本轮未改组织算法或新增自动布局。

## 测试与真实边界

分阶段已运行 Timeline 浏览器测试、Reader/Canvas 浏览器测试、Hover 浏览器测试；随后完成集成和旧功能回归。

- `node scripts/validate-all.mjs`：20 个功能套件及静态检查通过，其中新增手势/定位/通知 8 项单元场景；报告共记录 322 条 PASS。
- `node scripts/test-interactions-browser.mjs`：14 项真实 DOM/鼠标/键盘及触屏模拟场景通过；包括缩放范围实际变化、保存时按下按钮不脱离 DOM、Canvas 阅读和拖动后的点击、延迟/异步取消、平移缩放连线互斥、窗口边缘、来源关联/返回、Reader 跨项目竞态、代码和数学公式、原数据完整性以及原 Deploy 编译。
- 数据对比检查 `messages / versions / qaCards / conversations / qaMetadata / projectWorkspaces` 原记录未变；原有关系保留，仅测试主动拖动的一个节点坐标变化并持久化。新连线是测试中明确创建的独立合成关系。
- `node scripts/test-interactions-mv3.mjs`：**真实未打包 MV3** 在全新 Edge 配置中通过 3 项检查：service worker 保存通知、按住时间点期间保存后正常释放阅读、Canvas 完整阅读和本地 Hover。
- 原 `test-search-browser.mjs`：300 张合成卡片，8 个 UI、5 个数据库、1 个重开场景通过，覆盖 Timeline、Canvas、Search、Conversation Manager、Reader、Deploy。
- 原 `test-project-workspace-browser.mjs`：9 项通过，包含主题人工调整、跨来源 Reader/Deploy、备份恢复和浏览器重启持久化。
- `build.mjs --check` 通过：语法、模块链接、资源和原有网络/CSP 检查；另外在仅含 Git 管理源码的隔离副本中完成实际构建；产物只位于忽略的 `tmp/`，不覆盖原有 `dist`，也没有发布。

最终报告均无已知失败场景。基线报告保留了修复前 Canvas 点击的两个失败。开发过程中的测试等待、命中遮挡节点和测试断言问题已修正；不把它们写成产品功能。没有可用的 Chrome 品牌浏览器，因此未完成该品牌的实装测试；完成的是 Edge 的真实 Chromium 鼠标及 MV3 测试。没有测试私人资料、真实 ChatGPT 采集或实体触屏。

报告及截图位于忽略的 `dist/`：`INTERACTIONS_BASELINE_REPORT.json`、`INTERACTIONS_TIMELINE_REPORT.json`、`INTERACTIONS_READING_REPORT.json`、`INTERACTIONS_HOVER_REPORT.json`、`INTERACTIONS_ALL_REPORT.json`、`INTERACTION_MV3_REPORT.json`、`INTERACTION_NODE_REPORT.json`、`INTERACTION_BUILD_REPORT.json`、`OPC_NODE_REPORT.json`、`CANVAS_HOVER_PREVIEW.png`、`CANVAS_HOVER_EDGE.png`、`INTERACTION_MV3.png`。

## 文件与兼容性

修改：`background.js`、`ui/horizontal-timeline.js`、`ui/opc.js`、`ui/opc.css`、`package.json`、`scripts/validate-all.mjs`。

新增：`domain/change-notification.js`、`domain/preview-placement.js`、`ui/pointer-drag.js`、`ui/card-preview.js`、`scripts/validate-interactions.mjs`、`scripts/test-interactions-browser.mjs`、`scripts/test-interactions-mv3.mjs`、`validation/interaction-browser.html`、`validation/interaction-browser.js`、本文档。

数据库和备份格式没有迁移风险。本轮的 `viewChanged` 不触发其他窗口立即同步视图；需要刷新/重新进入才能读取另一个窗口的最新位置偏好，原有写入冲突检查仍保留。极小窗口或巨大节点没有空位时会抑制 Hover，完整阅读入口仍可用。真实源数据更新仍可重建视图，活动拖动会被取消并保留原坐标。升级前照常另存原有全库备份，不卸载扩展、不清除数据库。
