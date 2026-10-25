# V0.4.1：已显示正文却无法采集的兼容性修复

日期：2026-10-07。扩展版本：0.4.1；采集适配器：chatgpt-dom-v4。

## 用户遇到的问题及定位边界

用户在 ChatGPT 项目对话中已经看到正文和代码，滚动后仍失败；默认诊断为 `project_conversation / messages_not_loaded / messages=0`。截图能证明页面有内容，不能确定具体 DOM 节点或属性。当前工具只能访问内置浏览器，不能访问用户实际 Chrome / Edge 标签页；本次没有读取用户对话或扩展资料库。

旧版存在两个可确认的限制：角色选择器仅为 `main [data-message-author-role]`，轮次回退只检查 main 内的测试标记或 article；而 main 存在且旧轮次选择器为空，就被判成“尚未加载”。因此 main 外的消息会漏掉，section 轮次也缺少角色回退，错误提示可能误导用户重复滚动。

## 代码修改

- 全页面查找明确的消息角色，排除导航、旁栏、表单、输入框、菜单、隐藏节点和控制按钮；不再以 main 为唯一消息范围。
- 项目对话位于 dialog 弹层时，只要当前消息确实属于 thread 或明确标记的对话轮次，仍允许采集；普通弹层中的预览不进入对话。
- 支持 section / article 轮次的明确 `data-turn` 角色、明确说话人标题及 user-message 标记。优先取内部角色节点，避免轮次和内部消息重复保存；保持页面顺序，不凭位置或 Markdown 样式猜说话人。
- 回退仍保留代码、表格与完整正文。已确认的内部消息 ID 继续使用；缺少消息 ID 时保留未知，不把轮次 ID 冒充成消息 ID。
- 观察窗口结束后再次查找，允许期间刚出现的消息进入预览；来源切换和重复 ID 继续拒绝。
- 分开“真正有加载标记”“已有内容但无法确认结构”“没有识别到消息”，不再全部提示滚动。
- 默认诊断新增匿名结构计数：main/thread 区域、角色标记、轮次、正文块、候选消息和加载标记的数量。严格数字白名单，不带正文、标题、账号、实际 HTML 或链接。

没有新增联网功能、模型调用、扩展权限或数据库迁移。原消息版本、问答身份、人工整理和备份结构继续使用。

## 已完成验证

- 六组 Node 检查共 **114 项通过**：core 17、regressions 16、adapter 51、reader 13、v03 数据 5、navigation 12。
- **29 个实际浏览器 DOM 合成样例通过**，包括 main 外对话、section 缺少 author-role、明确说话人、代码尾部、导航排除、项目对话弹层、隐藏祖先、未知角色和延迟加载。
- 用更新前保留的 V0.4.0 安装目录做三组对照：旧版对 main 外消息、section 轮次和说话人标题均失败；修复后对应样例均识别到两条消息。
- 在实际 IndexedDB 的独立命名空间 `acvn-validation-v04-capture-fix-20261007` 完成“采集 → 预览 → 新建项目 → 保存 → 展示代码及回答尾部 → 再次采集 → 保存 → 重载”。重复保存新增 0 条消息，仍为一条对话；重载后原问答和完整代码可读；浏览器没有记录到错误日志。

证据位于 `dist/ADAPTER_VALIDATION_REPORT.json`、`dist/V041_ADAPTER_BROWSER_REPORT.json`、`dist/V041_CAPTURE_BASELINE_REPORT.json`、`dist/V041_CAPTURE_FLOW_REPORT.json`、`dist/V041_CAPTURE_FLOW.jpg`。隔离示例与浏览器桥接不进入安装包，也没有写入用户扩展资料库。

上述结果验证的是实际浏览器中的合成结构和产品代码，**不代表已经在用户实际登录页面确认修复成功**。升级后需在原失败对话复测；如果当前页面仍有另外一种结构，新诊断能帮助进一步定位。

## 已安装用户怎么更新和再试

1. 如已有重要项目，先在插件“项目管理 → 导出备份”保存一份。
2. 关闭旧侧栏和插件项目页，打开原浏览器扩展管理页：Chrome 为 `chrome://extensions`，Edge 为 `edge://extensions`。
3. 找到原有 AI Conversation Visual Navigator 条目，点击它的圆形刷新箭头。保留原条目、扩展 ID 和加载目录，不移除重装。
4. 确认条目版本变为 **0.4.1**。标准目录已原地更新：

   `D:\mytools\GPT-SaaS\apps\navigator-extension\dist\ai-conversation-visual-navigator`

5. 回到原来失败的 ChatGPT 对话，等待回答生成结束，在该标签页重新点击工具栏插件图标。
6. 点击“采集 / 更新当前对话”，核对消息与正文，选择本地项目并点击“保存到本地项目”。
7. 查看问答列表，展开完整长回答，核对代码和回答末尾。

成功预览或失败诊断的 `adapterVersion` 应为 **chatgpt-dom-v4**。如果仍为 v3，浏览器还在运行旧代码，需要确认刷新的是原来的条目和目录。

首次安装包为 `dist/ai-conversation-visual-navigator-v0.4.1.zip`；也可直接加载上述标准目录。如果原来加载的是另一处自行解压的副本，应先确认管理页“详细信息”中的来源路径，再用本版覆盖原目录并刷新原条目，保持原扩展身份。

仍失败时复制默认诊断和具体提示即可，不必附加正文或完整来源地址。新版 `pageStructure` 数量能区分根区域、角色与轮次识别问题。

## 公开参考与范围

- [chat-dump-bookmarklet 的维护说明](https://github.com/mauriziofonte/chat-dump-bookmarklet/blob/main/README.md)：项目作者描述 section data-turn 和部分无 author-role 轮次。
- [ai-conversation-navigator DOM 参考](https://github.com/JoonJ14/ai-conversation-navigator/blob/main/DOM-REFERENCE.md)：公开的角色、轮次和说话人标题结构参考。

这些是其他项目的公开观察，用于扩展兼容性样例，不能替代用户页面的现场 DOM 证据。本次实现没有复制其完整解析器。
