# 第二个独立 Project 交互故障：基于源码的解释

本轮审计现有修复，不把已有修复归为本轮新开发。主要修复在任务开始时已位于未提交工作区，不能只检出 HEAD 就得到现在的行为。历史调查见扩展目录下 `P0_SECOND_PROJECT_AUDIT`、`P0_WORKSPACE_ZOOM_SYNC`、`P0_ATOMIC_PROJECT_NAVIGATION` 和 `P0_SYSTEM_RUNTIME_AUDIT_2026-10-23` 文档；旧报告中的成绩属于历史，本轮结果另列。

## 实际调用链

`workspace.html` / `sidepanel.html` → `ui/app.js` → `OPCTimeline.show/load/render` → `HorizontalTimeline.render/zoom`。节点调用 `openCard`，通过 runtime RPC、service worker 和 repository 读取对应 Project 的正文。Timeline 是按时间计算绝对位置的原生 DOM，不是 React，也不是 Canvas 缩放算法。关系 Canvas 是另一个模式。

## 源码中可核实的不同失效路径

| 失效路径 | 当前修复位置和机制 | 本轮验证方法 |
| --- | --- | --- |
| 新建 B 广播全局内容更新，A 的 Timeline 在 pointerdown/up 中间被重建；旧按钮/节点断开，原生 click 不再完成 | `domain/change-notification.js:changeNotification` 将 createProject 的结果 ID 带入通知；`ui/app.js` 对无关独立 Project 仅更新列表 | 按住 A 的 + 时创建独立 B，检查按钮、真实比例和 click；不能只断言按钮存在 |
| 读取已在途中，按住之后响应返回，依然可能重建 | `OPCTimeline.load` 在响应后调用 `beforeRender`；`waitForViewInteraction` 与帧边界调度延后提交，epoch/abort 使过期读取退出 | 受控在途读取与真实鼠标按住交错，松开后仍完成原 click |
| 工作台与侧栏把 viewport 写入同一共享偏好，用旧 revision 冲突；后续 load 又覆盖刚缩放的状态 | `HorizontalTimeline.views` 以 Project 保存本窗口视口，`preferencesFor` 合并本地状态；`zoom/fit` 不写共享库；`save` 只保存显式来源选择 | 双窗口缩放独立、数据更新不回滚比例、缩放不增加数据库 revision；真正并发标注仍拒绝旧版 |
| 控制器先变成 B、屏幕仍是 A；按钮/正文查错作用域，或失败后选择器与图分离 | `OPCTimeline.show/load` 捕获目标与导航 epoch，准备完成并排空旧项目晚写后才一起提交 scope/data/UI；`ui/app.js` 保留最新项目选择并在失败时恢复壳层 | 加载 B 期间 A 仍可缩放/阅读；失败保持 A；连续 A/B/C/A；忙碌期间保留最后一次原生选择；Canvas 晚写只属于 A |
| 原生下拉框吞掉鼠标释放事件后，pressedPointers 残留，刷新一直等交互结束 | `ui/app.js` 在新鼠标按下、buttons=0 的真实移动/悬停/丢失捕获、blur/隐藏时核对指针；不靠超时假定松开 | 人为遗漏终止事件，再发送真实未按键移动；取消读取释放 waiter 时仍保留真实按住状态 |
| ResizeObserver 是另一条重绘来源，在按住按钮时也能替换 DOM | `HorizontalTimeline.resizeAfterInteraction` 等待同一交互边界，核对 host/data/Project 和 abort，detach 时断开 observer | 分别在 +、−、Q/A 按住期间改变容器宽度，松开后实际缩放/Reader 内容仍正确 |

以上是源码已针对的路径，不等同于“第二个 Project 必然造成数据库损坏”。没有证据支持 UUID 撞车、节点 ID 必然冲突或两入口有两套 Zoom 算法。第二 Project 会增加通知与导航交错机会；单 Project 双窗口也可以触发状态覆盖类问题。

## 关键源码阅读顺序

1. `apps/navigator-extension/domain/change-notification.js`：区分 changed/viewChanged、创建结果作用域。
2. `ui/app.js` 的 `waitForViewInteraction`、`scheduleRefresh`、指针监听、project-select change 与 changed 监听：请求何时排队、何时提交。
3. `ui/opc.js` 的 `cancelNavigation`、`show`、`load`：异步前后身份检查，旧图交互与晚写排空，最后一次性提交。
4. `ui/horizontal-timeline.js` 的 `preferencesFor`、`resizeAfterInteraction`、`zoom`、`save`：窗口局部视口与持久来源选择的区别。
5. `storage/database.js:commit`：同一个 readwrite 事务内比较 meta revision、写变更、递增版本；不是跨事务的“先查再写”。

## 本轮证据和边界

最终 1.7.1 安装目录的生命周期回归 15 项、原生 Side Panel/Workspace 同步 23 项通过，覆盖真实鼠标点击、比例/节点几何、正文归属、失败/迟到响应、并发拒绝、重启与资料摘要保持。运行时指针/resize 套件另有独立报告，最终结果见 [testing](testing.md) 和 `validation/public-beta-results.json`。

所有数据位于全新测试 Profile，均为合成。没有读取、清除、迁移用户日常浏览器资料。用户原来持续失效的那张页面仍未现场确认，因此不能宣称该私人实例已彻底恢复。若复现，先记录版本/加载路径/默认无正文诊断及操作顺序，保留原资料，不以清库或换空 Profile 作为修复证明。
