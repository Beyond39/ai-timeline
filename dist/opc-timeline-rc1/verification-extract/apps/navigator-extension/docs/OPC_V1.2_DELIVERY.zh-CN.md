# OPC Timeline 1.2 开发与验收记录

本次直接修改 `apps/navigator-extension`，延续原生 ES Modules、Manifest V3 与现有 IndexedDB。没有创建独立演示产品，也没有引入 React、远程依赖或 AI API。

## 现状审查

- 入口：`background.js` 通过用户主动授权的 `activeTab` 读取当前 ChatGPT 对话，结构化读取使用当前页面的同源 GET 请求；兼容旧 DOM 采集和 JSON 导入。
- 身份：已保存源会话 ID、源消息 ID、分支路径、原始消息时间、采集快照和正文版本。DOM 采集可能只有不确定的身份或缺失时间。
- 存储：原有 IndexedDB V4 支持项目索引、按范围读取、乐观并发检查及原文历史，继续复用，升级为 V5。
- 归组：`indexes.js` 原来已建立用户消息起始的 Q/A 索引；问题发生在 `conversation-map.js` 再次逐条渲染助手消息，以及原有时间线逐消息展示。多片段因此呈现为 A1.1、A1.2，操作按钮随片段重复。
- 正文：原导入器收集字符串及少量对象文本，没有充分利用 channel、recipient、结构化块和工具状态分类；空消息及分析消息也被送入普通阅读视图。
- 安全排版：原有 `body.js` 已安全创建 Markdown DOM 节点，无 `innerHTML` 执行。继续复用标题、列表、引用、代码、表格与安全链接处理。

## 第一阶段：导入、归组、正文与模型

主要文件：`domain/qa-content.js`、`domain/opc.js`、`importers/json.js`、`adapters/conversation-data.js`、`domain/captures.js`、`storage/database.js`、`storage/opc.js`、`storage/repository.js`、`domain/backup.js`。

- 复用 `messages`、`versions`、`snapshots` 表作为 RawMessage 的身份、原始内容和历史版本。原始 JSON 与隐藏消息不删除。
- 新增 `qaCards`（QACard）、`timelines`（Timeline）、`memberships`（TimelineMembership）、`relationships`（Relationship）、`canvasLayouts`（CanvasLayout）。`qaMetadata` 单独保存用户标题、标签和备注，`relationTypes` 保存自定义类型。
- QACard ID 绑定本地会话与稳定用户消息引用；同一用户问题在多个分支中的当前回答按选定源路径投影，其他分支及原文历史仍由原阅读器保留。修改或重新导入不清除元数据或关系。
- 同一轮的用户可见助手片段按消息顺序共同显示。通过角色、频道、收件目标和消息类型排除工具调用、分析、状态、空正文；不同消息中相同的正文不会仅因为字符串相同而丢失。
- 结构化标题、列表、表格、代码转为可读 Markdown；整个 HTML/JSX 组件文档提取静态内容。代码示例仍保留；不执行导入的脚本、不加载外部图片。
- 提问时间、回答时间、首次导入时间分开保存。时间包含原始来源、精度及可靠性。缺失时间显示“时间未知”，不使用导入时间代替。
- V5 新建模型表，旧库首次进入时间线时投影已有消息。原来的整理、导出、分支和版本查询继续可用。

验证：`validate-opc.mjs`、原有 core、regressions、adapter、full-conversation、reader、backup 相关测试通过。浏览器验收确认状态隐藏、多个回答片段、安全 Markdown 与 V4→V5 迁移。

阶段遗留：ChatGPT 内部读取接口仍可能随网页版本变动；没有在当前登录账号上运行真实网页采集。下一阶段为时间线与多线管理，已继续完成。

## 第二阶段：时间线与多线归属

主要文件：`ui/opc.js`、`ui/opc.css`、`ui/app.js`、`workspace.html`、`sidepanel.html`、`domain/opc.js`、`storage/opc.js`。

- 新用户和旧版首次升级默认进入时间线。时间线在同一项目中汇总来源及主题成员。
- 摘要卡片显示真实提问时间、问题标题、回答预览、来源、标签及关系数；点击后按需取得完整正文，侧边详情支持编辑元数据。
- 支持全文、标题、标签、备注搜索，北京时间日期筛选及标签筛选。
- 每页最多 60 张摘要，服务端上限 100；默认目录查询不读取 messages、versions 或 snapshots。
- 自动来源时间线、手工主题时间线；创建、重命名、隐藏、归档、恢复；单张或批量添加和从主题移除。移除成员只删除 membership，不删除原始卡片。
- 多线对照共用连续提问时间坐标；同一时间横坐标一致，以垂直叠放解决拥挤。未知时间单列，明确仅对照当前页。
- 时间线没有历史时间拖动操作。

验证：多线归属、成员移除、重复导入、真实时间排序、未知时间、共享时间坐标和索引查询验证通过。下一阶段为关系及画布，已继续完成。

## 第三阶段：关系标注与画布

主要文件：`domain/opc.js`、`storage/opc.js`、`storage/repository.js`、`ui/opc.js`、`ui/opc.css`。

- 从详情“建立关系”后点击另一个节点，或通过“搜索关系目标”搜索所有来源卡片。
- 默认类型：延续、补充、修正、反驳、依赖、引用、主题相关。可直接输入自定义类型。
- 支持来源→目标、反向和无向关系，说明文字、创建/修改时间，编辑及删除。
- 详情只展示当前卡片关系，提供目标导航。普通时间线不绘制所有跨线连接。
- 画布复用同一批卡片及关系，支持节点拖动、背景平移、缩放、连线方向及类型、点击连线编辑、搜索、定位、自动排列、适应画布。
- 保存和恢复节点坐标及视口。保存队列和页面退出刷新减少连续拖动及切换视图时的位置丢失。

验证：浏览器使用真实 IndexedDB，通过关系表单建立跨来源有向关系，并确认画布显示连线、位置与缩放恢复。下一阶段为性能、布局与交付，已继续完成。

## 第四阶段：回归、性能与交付

主要文件：`scripts/validate-opc.mjs`、`scripts/validate-all.mjs`、`validation/opc-browser.js`、`validation/opc-migration.js`、`validation/browser-bridge.js`、`ui/dom.js`、`ui/navigator.js`、`ui/conversation-map.js`、`ui/conversation-map.css`、`manifest.json`、`package.json`。

- 移除蛇形图入口及 `ui/map.js`、蛇形布局方法和样式；原历史基线验证快照保留。
- 修复 datalist 属性赋值导致关系表单打不开的问题。
- 修复对话迁移被原有引用保护拒绝前，不应提前修改新增模型的项目归属。
- 关系、成员、坐标的写入按项目读取新增模型，不复制全部聊天正文。
- 备份包含卡片、元数据、时间线、关系及布局；恢复时重建引用和坐标键，旧备份缺少新表仍可读取。
- 原有 12 个 Node 测试套件和新增 OPC 套件、静态检查通过。日志及摘要在 `dist/opc-tests`、`dist/OPC_NODE_REPORT.json`。
- 浏览器验收包含 17 项交互/存储/性能检查，刷新重启后 5 项持久化检查，以及旧库迁移 4 项检查。使用真实 Chromium DOM 与 IndexedDB，扩展 runtime API 由隔离本地桥接模拟。
- 实际导入 180 轮长对话，列表只渲染 60 个摘要，最后一轮完整长答案尾部可读；另有 10,000 张摘要的领域排序/分页测试。

## 安装与使用

1. 在 `chrome://extensions` 或 `edge://extensions` 打开开发者模式。
2. 加载已解压目录 `dist/ai-conversation-visual-navigator`。升级现有安装时保持原来的扩展身份/已加载路径，点击重新加载，避免另装为不同扩展造成看不到原有数据库。
3. 打开 ChatGPT 的 `/c/...` 对话，点击浏览器插件图标，再点击“导入当前对话”。确认原有导入预览中的项目后保存。
4. 在时间线浏览，点击卡片标注，添加到主题时间线或建立关系；通过“关系画布”调整位置。新增数据仍保存在此浏览器内。
5. 原文与完整资料库可通过原有备份及“记忆”功能导出。

## 重复执行验收

在扩展目录运行：

```powershell
node scripts/validate-all.mjs
node --experimental-vm-modules scripts/build.mjs
node scripts/verify-package.mjs
node scripts/serve-validation.mjs 8939
```

浏览器打开 `http://127.0.0.1:8939/workspace.html?validationDb=v04-opc-check`，点击“运行 OPC 浏览器验收”，刷新后点击“验证 OPC 重启持久化”，可保存 JSON 报告。旧库升级单独打开 `http://127.0.0.1:8939/workspace.html?validationDb=v04-opc-migration-check&legacyOPC=1`，点击“验证 OPC 旧库升级”。每个隔离名应使用独立用途；测试脚本不进入安装包。

## 明确的边界及下一步

- 尚未完成真实 ChatGPT 登录页面、Chrome/Edge 已安装 MV3 扩展的人工端到端验证；当前测试不将本地桥接冒称真实采集。
- 未提供完整附件正文、动态图表/交互组件执行或数学公式专用排版；已取得的静态内容和附件引用可读，原始记录可排查。
- 卡片关系支持同一项目下不同来源/主题时间线，跨项目关系沿用项目隔离规则。
- 画布和对照按当前页展示；可通过搜索/筛选及分页浏览长历史，后续可加入空间虚拟化与跨页邻居展开。
- 全文搜索按项目扫描已保存消息，导入仍复用原来的原子全状态写入。极大资料库的导入和搜索尚未做专业设备上的容量基准，后续可增设全文索引和分批写入。
- 下一步优先执行真实 ChatGPT 页面采集、浏览器关闭再打开以及不同扩展窗口同时编辑的验收，再依据实际数据优化索引。

隐私：未新增浏览器权限。基础处理本地完成，没有上传正文到第三方，扩展页仍限制 `connect-src 'none'`；仅用户主动采集时在已授权 ChatGPT 页面执行同源只读请求，临时登录凭证不返回到扩展。
