# OPC Timeline V1.0 RC1：安装与使用

日期：2026-10-24。产品名称 V1.0 RC1；插件内部版本 1.7.0，以便从已有 1.6.x 正常升级。

这是可安装的本地知识工作台候选版本。默认 Offline 不上传对话；AI 增强使用本机可信代理。真实 OpenAI 调用和真实资料的独立人工质量验收尚未完成。

## 安装或升级

1. 新用户解压 `OPC-Timeline-V1.0-RC1.zip`。在 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions` 打开开发者模式，选择“加载已解压的扩展程序”，指向包内 `apps/navigator-extension`。
2. 也可以单独解压 `ai-conversation-visual-navigator-v1.7.0.zip` 并加载其中含 manifest.json 的目录；纯 Offline 不需要启动服务。
3. 已有用户先导出原资料库备份，知识面板另行导出知识备份。保留原扩展条目、ID 和加载路径，在原加载目录更新文件，再点扩展的“重新加载”，关闭旧工作台后重新打开。不要通过卸载再安装来升级。
4. 点击扩展图标打开 Side Panel；扩展详情的“扩展程序选项”打开完整 Web Workbench。两个入口共享同一插件 Origin 的本地数据与实现；Workbench 不是旧 Python Alpha 网页。

源码构建（项目的 `apps/navigator-extension` 目录）：

```powershell
npm test
npm run build
npm run verify:package
```

运行以上构建只需要 Node.js 22 或更新版本，不需 npm install。浏览器开发测试另需 Playwright 和 Chrome/Edge；本仓库脚本可使用 Codex 的既有 Playwright 运行环境。

## 完整工作流程

1. 导入 ChatGPT 导出的 JSON，或在获授权的 ChatGPT 标签页主动采集，预览后保存到 Project。
2. 在 Timeline 点击“本地知识整理”。Conversation Knowledge 区域选择一个 Conversation；首次打开会在本机 Worker 识别主题和候选阶段，之后优先读取已保存版本。
3. 先读整体摘要，再点击阶段导航。阶段展开后可查看摘要、知识条目、原文证据及转折类型。
4. “在时间线查看阶段”复用原有多轨 Timeline，定位首个 Q/A 并标亮对应范围。点击 Timeline 节点，阅读器会显示它所属的讨论阶段。
5. “原文证据”打开真实问题或回答，按消息版本和 UTF-16 原文范围高亮。证据失效会阻止精确跳转并保留历史内容。
6. 编辑标题、摘要、主题、阶段范围或条目的内容/类型/状态，保存后该字段自动受保护；相邻阶段范围会一起调整以保证连续覆盖。“解除保护”仅允许后续自动分析重新生成该字段。
7. 查看“分析版本与主要差异”，可恢复历史版本。恢复会保留当前仍受保护的人工修正。来源已变化的旧版本不能直接覆盖当前原文。
8. 下次打开继续使用已保存分析。原文导入更新后会提示旧来源，点击“更新本地阶段”重新分析。没有后台自动付费重试。

编辑阶段范围使用原始 Q/A 轮次；不能让相邻阶段为空、重叠或遗漏。拆分或合并导致人工字段归属不明确时，旧人工内容进入“待复核与保留人工内容”，由你核对并复制到合适的新阶段。

## 可选 AI：启动可信本机代理

插件不接收或存储 OpenAI API Key。代理只监听 `127.0.0.1:8787`，持有服务器进程环境变量中的密钥，校验确切插件 Origin 和独立配对令牌，限制并发、请求频率和运行预算。

在完整候选包的根目录，使用 Node.js 22 或更新版本。先从扩展管理页复制自己的扩展 ID，在 PowerShell 配置：

```powershell
$opcSecret = Read-Host 'OpenAI API Key（仅在本机输入）' -AsSecureString
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', $opcSecret).Password
$env:OPC_ALLOWED_ORIGINS = 'chrome-extension://替换为你的32位插件ID'
$env:OPC_SESSION_BUDGET_USD = '2'
node tools/opc-ai-proxy.mjs
```

终端会显示本机配对令牌；它不是 API Key。可以通过 `OPC_PROXY_TOKEN` 显式设置至少 24 字符随机令牌，不设置则每次启动自动生成。`.env.example` 仅是参考，不会自动加载。

在知识面板点击“连接 AI 代理”，输入上述**配对令牌**。令牌仅保存在当前页内存，刷新后需要重新连接。代理通过 CORS 只允许配置的确切插件 Origin，插件没有新增任意网站访问权限；所有 AI 请求仅发往固定本机地址。Windows 防火墙或浏览器本地网络访问策略可能需要允许本机连接。

点击“AI 深度总结”，选择当前 Conversation、模型和预算，查看输入规模、保守 Token 上界、预计调用数与费用上界，再确认发送给 OpenAI。短对话一次调用；长对话按完整 Q/A 分块提取，再全局整合、复核连续阶段和原文证据；分块边缘不会被强制当作讨论边界。

默认 GPT-5.6 Luna；可选择 GPT-5.4 mini。普通总结显式关闭推理。目录与价格已于 2026-10-24 核对官方文档，但账户是否有权限、服务地区和当日模型可用性只能由真实集成确定。模型不支持严格结构化输出时会明确失败，不降级为不受校验的文本。

本机部署适合个人使用和演示。公网托管需要另外部署 TLS、用户认证、租户权限、持久化配额/审计和密钥管理；本候选包不提供公网 SaaS。请勿把代理监听地址改成公网地址。

## 隐私、费用与失败

- Offline 文本处理、阶段、摘要和缓存均在本机；原有 BGE 语义增强只有主动启用/导入模型后运行，首次下载会单独提示。
- AI 必须每次确认后才上传所选 Conversation。内容包括该范围原始问题、回答、消息 ID、候选阶段及必要的原文证据；没有工具执行、远程 URL 访问或消息内指令执行能力。
- 默认单任务预算 $0.15、输入估计上界 80,000 tokens、每次输出上限 3,500 tokens；最多 12 个分块加一次全局整合。单个 Q/A 超过质量限制会拒绝，不会静默截断。可在确认页调整允许范围内的限额。
- Token 预估使用 UTF-8 字节上界与请求开销，是保守估算，不是精确 tokenizer 数量。按已核实单价估计费用；展示实际 API usage，**真实账单金额始终未知**。缓存折扣、服务端计费差异可能使估价不同于账单。
- 代理按估算上界为每次任务预留本次运行预算（默认 $2），失败也保留预留，因为已发出的请求可能产生费用。它不是跨重启的账户账单限额，账户端预算仍由账户持有人管理。
- 相同原文/模型/参数/提示版本可命中代理内存缓存；不同模型或参数不会复用。缓存不落盘，代理退出即消失。
- 超时、取消、限流、无效凭据、配额不足、无效 JSON、拒绝或不完整响应均保留现有结果。没有自动付费重试。取消、关页和刷新不能保证撤回已经产生的费用。
- 已开始/失败/取消的任务会写入独立任务记录；刷新不会自动续跑或重试。Project 切换遵守既有弹窗保护：关闭知识面板先取消任务，再提交新 Project。

## 数据、备份和回滚

原始资料库仍为 IndexedDB `ai-conversation-visual-navigator` v9，消息版本保持不可变。本轮没有升级或清空它。原有跨卡片知识缓存仍为 `opc-knowledge-engine-v1`；新增分层知识独立保存于 `opc-conversation-analyses-v1`。

原有项目/全库备份格式不变。新增知识不会被旧格式自动包含，需另点“导出知识备份”，保存分析版本、任务和人工修订。知识导入对已有 ID 只追加历史与保留内容，不覆盖当前人工版本。请同时保存原始资料和知识备份，备份可能含私人原文，不要随安装包分享。

已知兼容边界：旧资料库恢复成新 Project 会重新生成本地 ID；本 RC 尚不自动把旧知识档案重新绑定到新 ID。跨浏览器/Profile 转移不在本 RC 的验收承诺内。原 Profile/扩展 Origin 下的升级、刷新和继续使用已验证；跨 ID 的人工成果请保留档案，人工重建绑定或等待后续迁移工具。

没有自动清理已确认人工历史；历史默认分批显示。修改前源码检查点在开发目录 `dist/checkpoints/opc-source-before-hybrid-20261024.zip`，它不进入发布包。回退源码保留三个数据库；旧版不会读取新增分析库，但不会删除新增知识。

## 需要了解的限制

- Offline 是保守的规则与统计提取，不保证理解全部语义；用户报告“已验证”表示来源中的陈述，不是本工具替用户完成了验证。
- AI 引用通过程序校验仍不能证明总结中的每个语义推论正确。AI 知识默认为待人工核查；尤其应检查归因、否定和最终决定。
- 只分析当前有效、可追溯的已导入 Q/A，不臆造没有采集到的分支和回答。
- 现阶段只提供 OpenAI Provider；没有云同步、多 Agent、多人协作、计费账户系统或商店自动发布。
- 真实 API、真实 ChatGPT 账户采集、用户私人浏览器 Profile 和独立人工质量评估仍需后续授权验收。

官方接口与模型依据：

- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
