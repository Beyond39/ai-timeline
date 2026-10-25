> 历史发布准备记录。当前仓库与公开发布状态以 [repository-finalization.md](repository-finalization.md) 为准。

# OPC Timeline 公开发布准备交付

2026-10-25（Asia/Shanghai）。结果：**本地 1.7.1-beta.1 候选包与审计材料已备齐；尚不具备自动公开发布批准。** 没有推送、创建 GitHub Release、公开仓库、强推或改写历史。保留已有产品能力、未提交业务修复和存储方案。

| 交付 | 文档/证据 |
| --- | --- |
| A 安全审查 | [风险分级与敏感扫描](security-audit.md)、[许可兼容性与素材权属](license-review.md) |
| B 实际修改及原因 | [逐文件清单与已有改动归属](release-changes.md) |
| C README、架构、安装 | [项目 README](../README.md)、[架构](architecture.md)、[隐私](privacy.md)、[Windows 安装/升级](installation.md) |
| D 构建测试/回归 | [执行结果与复跑命令](testing.md)、[机器可读摘要](validation/public-beta-results.json)、[包输入指纹](validation/public-beta-package-inputs.json)、[多 Project 实际修复解释](multi-project-regression.md) |
| E GitHub/Release 指南 | [Windows 操作](release-windows.md)、[Release Notes](releases/v1.7.1-beta.1.md)、[Changelog](../CHANGELOG.md) |
| F 实习技术证据 | [技术总结、简历表述、面试追问与源码](internship-project-summary.zh-CN.md) |
| G 人工发布门槛 | 下方清单；未完成项没有计为通过 |

最终本地包：`apps/navigator-extension/dist/ai-conversation-visual-navigator-v1.7.1.zip`，6,328,557 字节，139 文件。安装目录 `apps/navigator-extension/dist/ai-conversation-visual-navigator`，ZIP 根直接是 manifest。Chrome numeric version 1.7.1，显示发布名 1.7.1-beta.1。

SHA-256：`1a119ad550db506ec351b09f204c0bbe5f4b410b60d234216c16a70c70a69b5e`。独立无旧 dist/node_modules 的源码副本重跑 Node 测试、构建及验证，包摘要相同（同 Node/zlib/源文件字节环境；不是所有系统重建都必然逐字节相同）。

实测：25 Node 功能套件、378 条可计数 PASS 输出，静态/ZIP 校验通过；最终安装目录生命周期 15、原生 Side Panel 同步 23、指针/resize 13 项通过；Hybrid source 18 项通过但 OpenAI 上游为 mock；旧 Python 原型 39 测试通过。真实截图位于 [screenshots](screenshots/README.md)。不声明覆盖率、用户量、真实性能或语义准确率。

## G 发布前必需人工检查

- [ ] 所有者确认根 MIT LICENSE 是否真实意愿、第一方贡献权属和 Python 元数据一致性；本轮没有选许可证。
- [ ] 提供/确认四个 icon 的来源许可，核对转换模型/tokenizer 的具体归属以及 Transformers/ONNX 传递通知。保留上游文本。
- [ ] 审查所有最终暂存源码、合成数据、旧文档及 Git 身份邮箱；不上传根全源码 ZIP、真实聊天、Profile、PDF/生成报告、凭据或原始备份。自动扫描不是零泄漏保证。
- [ ] 在原安装路径/原扩展 ID/日常 Profile 上先备份再升级，核对原数据和此前持续失效页面；本轮隔离通过不能替代该现场验收。
- [ ] 用本人授权的登录账号验收真实 ChatGPT 完整采集、切页/权限失败和附件边界；不得把 DOM 片段冒充全量。
- [ ] 在隔离环境验证主库备份和独立知识备份恢复；核对 DOCX 的 Word/WPS 效果、PDF 打印、浏览器 125% 和 Edge 行为。
- [ ] 在许可和资料审查完成后的完整提交上做干净 clone/build；查看实际 GitHub Actions，配置安全私报联系渠道。
- [ ] 若日后测试付费 AI，单独确认正文授权与预算、账户/模型兼容、当前价格和生成证据质量。当前文档明确标为实验，未测试不得宣传为正式稳定能力。
- [ ] 由本人分别决定上传、Public 可见性、预发布和商店提交；本轮不执行这些动作。

总体发布风险仍为高，主要是许可/素材权属和人工验收尚缺，不是已经确认存在有效 API Key 泄漏。发现真实凭据时应先撤销/轮换，历史处理需另外明确批准。
