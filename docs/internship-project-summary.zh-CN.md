# OPC Timeline：实习项目技术证据

定位：已实现主要能力的 Chrome 扩展，把长 ChatGPT 对话变为有来源版本的 Q/A 时间线、关系画布与上下文包。不是新建 SaaS；本轮只做公开发布整理。下面的项目贡献表述需与本人实际参与范围一致，不把代理完成的审计或已有代码归为个人独立原创。

## 真实技术栈与模块

原生 JavaScript ES modules、HTML/CSS/DOM；Chrome Manifest V3、module service worker、activeTab/scripting、Side Panel、runtime 消息和 chrome.storage；IndexedDB v9、项目索引/版本冲突保护；Node 22+ 内置模块做解析/链接检查、固定时间 ZIP、SHA-256 与解压逐字节验证。测试包括 Node 脚本、Playwright 驱动真实 Chrome/Edge MV3、隔离 Profile 与合成夹具。

知识部分实际使用本地 TF-IDF/规则、Web Worker、Transformers.js 2.17.2、ONNX Runtime Web 1.14.0 WASM，以及可选 BGE-small-zh-v1.5 Chinese 512 维模型。没有训练自有模型；模型数据下载和本地推理不是云端 RAG 服务。OpenAI 客户端/本机认证代理、预算/确认、证据验证及分析修订确实存在，但本轮只验证 mock 上游，不能写“生产级 AI 已上线”。仓库还保留 Python 标准库/SQLite 原型，与插件储存不是同一系统。

模块边界：采集适配器/JSON importer → 预览/领域身份与来源版本 → service worker repository/事务 → Timeline/Reader/Canvas → 人工标注/关系/Deploy → 文档/备份。知识缓存和分析历史分库，不替换原库。见 [architecture](architecture.md)。

## 能讲清楚的真实工程问题

1. **异步重绘取消原生点击。** 读取、跨窗口通知、ResizeObserver 都能在 pointerdown/up 之间替换 DOM。修复统一等待真实交互边界；不是给按钮提高 z-index。控制异步返回顺序并测实际 pxPerMs、节点位置和 Reader 正文。
2. **跨窗口局部视口与共享内容混在同一偏好。** 现在缩放/平移保留在本窗口按 Project 的 Map；来源选择继续持久化并检查 revision。独立视口不等于禁用共享同步。
3. **导航作用域和画面分离。** 目标身份/epoch 在 await 前捕获，读取成功、排空旧项目晚写、复查 epoch 后原子提交；保留忙碌期间最后一次选择，失败恢复。避免 A 的节点用 B 的 Project 查询。
4. **并发安全与人工内容保护。** IndexedDB 在同一事务内做 revision 比较，冲突拒绝而不静默覆盖。AI 分析也核对来源版本和当前分析版本，保留人工字段与历史。
5. **可复现交付和证据边界。** 源码不依赖开发者私有运行时即可核心构建；对 139 文件的 source/install/ZIP 逐字节比对，固定 ZIP 元数据。签名/商店审核和实际账号采集是另外的验收，不用静态检查冒充。

这些交互修复在本轮开始时已存在；本轮新增的是复核、测试工具路径/过期步骤修正、文档与打包约束。完整解释见 [multi-project-regression](multi-project-regression.md)。

## 可复现测试与演示

从扩展目录 `npm test`、`npm run build`、`npm run verify:package`。本轮：25 Node 功能套件、378 条可计数 PASS 输出，另有静态门禁；最终安装目录生命周期 15、原生侧栏同步 23、指针/resize 13 项通过；Hybrid 18 项为 mock 上游；旧 Python 39 测试单独通过。不把重复行为简单加总，不声称覆盖率或用户规模。

演示顺序：合成 A/B 独立项目 → 各导入不同对话 → Timeline 缩放和打开原文 → 快速切换/刷新 → 在侧栏改标注并在工作台看到同步 → 两边独立缩放 → Canvas 关系与 Deploy → 导出备份。异常演示可运行已有受控读取失败/迟到测试，不在个人数据上故障注入。

截图来自真实合成数据 UI；运行命令、浏览器和哈希见 [testing](testing.md) 与 `validation/public-beta-results.json`。没有测用户数量、全浏览器性能、测试覆盖率或线上稳定性。

## 简历可用表述（按本人贡献调整）

- 开发 Chrome MV3 对话管理扩展，使用原生 JavaScript、IndexedDB 和 service worker，实现来源可追溯的 Q/A 时间线、关系画布、标注搜索和上下文包导出。
- 针对多 Project/双窗口下的交互竞态，将本地视口与共享内容分离，以导航 epoch、提交前身份校验和指针交互协调保护缩放/阅读；通过隔离浏览器生命周期与并发回归核验。
- 建立 Node 领域回归、原生 MV3 自动化和源码/安装目录/ZIP 字节一致性验证流程，补充权限/外传/备份边界文档并准备可重建 Beta 包。

不建议写“自研大模型”“百万用户”“性能提升百分比”“100% 覆盖率”“自动 AI 生产可用”或把 512 维 Chinese 模型写成 384 维 English 模型。

## 面试官可能追问

| 问题 | 回答必须回到的代码/证据 |
| --- | --- |
| 为什么鼠标事件监听还在，按钮仍点不动？ | DOM 替换发生在 down/up 中间，旧 target 断开；`ui/app.js`、`ui/horizontal-timeline.js` 的交互边界和 resize 测试 |
| epoch 与 AbortController 各解决什么？ | epoch 阻止旧结果提交；abort 释放等待/过期工作；仅取消 fetch 不能覆盖所有本地 await |
| 为什么不把所有窗口 UI 写进 chrome.storage.sync？ | 视口是窗口局部，内容才共享；当前实际无 sync 管线；冲突/隐私/用户意图不同 |
| revision 比较是否真原子？ | `storage/database.js:commit` 在同一 readwrite transaction 比较 meta 并写；后台队列加对象 expectedRevision |
| MAIN world 和 activeTab 有什么风险？ | 只有明确授权页面采集；登录态暂留网页；返回图白名单，但正文仍私密；无 host 权限不代表零网络 |
| 模型和词法分析如何降级？ | `analysis/bge.js` 的固定 revision/维数/校验、失败状态与离线流程；不编造语义质量 |
| AI 引用原文是否就一定正确？ | 引用 ID/版本/范围/子串可验证，但结论仍需人工核对；`conversation-analysis.js` / `analysis-revisions.js` |
| 备份是否覆盖所有状态？ | 主库、独立知识数据库与 Cache Storage 分别说明；普通备份不涵盖所有缓存/分析历史 |
| 为什么不用框架/替换数据库？ | 现有原生模块足以承载本轮；目标保留产品能力、审计发布；不声称选型从零设计或全部最优 |

## 建议精读

先 `manifest.json` / `background.js` / `ui/dom.js:rpc`，再 `storage/repository.js` / `storage/database.js`，然后 `ui/app.js` / `ui/opc.js:show,load` / `ui/horizontal-timeline.js`；最后 `adapters/conversation-data.js`、`analysis/ai-client.js` / `ai-protocol.js`、`tools/opc-ai-proxy.mjs`、`analysis/analysis-revisions.js` 和相应测试。每层至少自己画出一条读、一条写、一条失败恢复路径。
