# 安全与公开发布审计

审计日期：2026-10-25（Asia/Shanghai）。结论：**总体风险高；可本地审阅与合成数据演示，尚不批准公开分发。** 高风险集中于许可/素材权属及人工验收缺口；没有确认的有效凭据泄漏发现。此结论不能替代安全保证。

## 仓库、历史与构建现状

- 初始分支 `codex/opc-premium-ui-refresh`，HEAD `17343f3`。本地另有 master、项目组织和交互分支；没有配置 remote，没有 remote-tracking 分支，无法核验任何 GitHub 端状态或远程提交。
- 全部本地 refs 共 10 个不同提交，日期 2026-10-14～21；两个 local-v1-before-* 标签是本地检查点，不是公开 Release 标签。作者/提交者元数据各有 2 个不同邮箱身份；发布前由所有者确认这些身份信息是否可公开，本报告不抄录地址。不改写历史。
- 初始有 42 个已跟踪文件修改及大量未跟踪源码、文档、vendor 与旧原型。已有工程修复和 AI 模块不能归到本轮名下；HEAD 也不能代表完整当前产品。没有执行 reset、clean、commit、push、强推或更改仓库可见性。
- 真实扩展技术栈为 MV3、原生 JavaScript ES modules、DOM/HTML/CSS、IndexedDB、Chrome storage、本地 Worker/WASM；Node 内置模块构建，无 npm 运行时依赖。旧 Python/SQLite 原型保留，非插件运行依赖。
- 初始 numeric version 1.7.0，发布名仍是旧 RC1。当前准备为 numeric 1.7.1 / `1.7.1-beta.1`，避免 Chrome 版本倒退。没有发布这个版本。

## 发现与等级

| 等级 | 发现 | 当前处理 / 发布前要求 |
| --- | --- | --- |
| 高 | 既有未跟踪 MIT LICENSE 与 Python MIT 声明未获本轮明确确认；图标未找到来源权属记录；转换模型及 vendor 传递 notice 尚需完整核对 | 保留原件、不选择许可证；见 [许可清单](license-review.md)。所有者确认前不能宣称已获分发许可 |
| 高 | 浏览器储存和备份可含完整私人聊天；知识分析/缓存不全在普通备份内 | 文档明确三类数据库与分别备份；不改储存、不清库。人工验证升级与恢复 |
| 中 | 原 README/历史安装说明混有不同版本、旧 Python 定位和“无自动模型调用”等已过时描述 | 新公开入口按当前代码重写；保存历史副本；运行包仅带当前指南，避免误导 |
| 中 | 完整采集使用登录态和未公开的 ChatGPT 页面接口，MAIN world 内读取会话凭据/account cookie | 没有 cookies 权限不等于未接触登录态。隐私说明据实披露；凭据不在返回字段白名单内。真实登录采集仍待验收 |
| 中 | 可选 BGE 联网下载模型；AI 经 loopback 代理发送原始 Q/A 给 OpenAI | 清楚披露目的地、触发、估算与最终外传确认区别；本轮只用 mock 上游，未验证真实付费效果 |
| 中 | Manifest 声明 Chrome 116+；实际浏览器 API/网络策略在各版本差异未遍历；无商店审核结论 | 当前浏览器 MV3 验证有证据；不要宣称全部浏览器/商店兼容 |
| 中 | 根目录全源码旧 ZIP、旧发布包、PDF、生成数据和浏览器 Profile 可能被误上传 | .gitignore 排除输出/归档/报告/凭据；ZIP 使用运行文件白名单；不删除原文件。上传前逐项审阅暂存区，禁止直接上传整个文件夹 |
| 中 | 五个主要回归入口原先依赖开发机运行时路径；部分其他历史浏览器脚本仍有环境依赖 | 本轮五入口改为可选本地 Playwright + 浏览器环境配置；其他脚本不作为本版可移植验收承诺 |
| 低 | 旧文档含本机目录/开发上下文，历史 Git 身份可识别作者 | 运行包排除旧交付记录；源码公开前由所有者审阅身份/本机路径。它们本身不是密钥泄漏 |

## 敏感内容扫描

运行 `python tools/audit-public-source.py`，输出只含规则名称、文件/历史 blob 位置和行号，**不含匹配原文**，不联网验证凭据。范围包括当前源码与被忽略 data/output 的可读文件、根目录两个 ZIP 内可读内容、`git rev-list --objects --all --reflog` 可达的所有历史 blob。排除 PDF 二进制误报后读取了 529 个历史文本 blob。不同提交共享 blob 只扫描一次。

检查常见 provider key、私钥、JWT、凭据 URL、字面凭据、邮箱和会话链接候选。未命中前四类有效格式。凭据候选位于 VM/HTTP/mock 测试，占位语义明确；会话 URL 命中集中在 adapter/validation 的合成测试契约。邮箱候选含安全链接拒绝用例。PDF 二进制随机片段不是可验证邮箱证据，最终工具明确跳过 PDF/图像等二进制。

最终扫描快照计数：工作区可读文件 693、归档内可读文件 584、历史可读 blob 529。脱敏汇总见 [扫描摘要](validation/public-beta-security-scan.json)；后续任何变更或暂存前都应重跑。原始位置报告保留在被忽略的 `tmp/public-beta-final-audit.json`，未公开匹配值。

`validation` 样例的合成来源声明见扩展 `docs/CAPTURE_SAMPLES.zh-CN.md`，不能将其当作用户实际登录页面录制。没有发现足以确认真实个人聊天或真实用户资料已提交的证据；语义隐私仍必须人工复核。当前 data/ 下没有被列出的对话源文件；这不代表浏览器 Profile 没有私人内容，本轮未读取日常 Profile。

本工具不是 gitleaks/trufflehog、依赖漏洞数据库或完整数据取证。未扫描任意不可达 Git 对象、加密 ZIP、OCR、PDF 解压正文、浏览器日常 Profile 或所有未知凭据格式；大文件/生成目录跳过在原始 JSON 中有计数。没有凭据吊销动作，因为没有确认有效泄漏；若人工发现有效凭据，先撤销/轮换，再单独批准历史处置，不能仅增加 .gitignore 当作修复。

## 发布包与外部代码

构建白名单保留所有 runtime 模块、icons、vendored licenses/WASM/tokenizer，排除测试夹具、普通 scripts、旧交付文档、真实数据库、根 ZIP 与 Profile。唯一随包脚本 `scripts/workspace-live-probe.js` 是按需支持探针，不是自动运行入口。第三方文件摘要 pin 被保留；这只是完整性检查，不是恶意代码或 CVE 清零证明。

详细许可兼容性和未知资产见 [license review](license-review.md)，实际网络/存储见 [privacy](privacy.md)，本轮执行证据见 [testing](testing.md)。未找到明确禁止分发的第一方代码证据，但素材权属及传递 notice 仍不足以出具完整公开许可结论。

## 上游安全公告抽查

2026-10-25 查阅了官方公告入口。[KaTeX GHSA-238p-pmpm-9mq7](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7) 列出的受影响范围是 `>=0.11.0, <0.18.2`，本项目固定 0.19.0 不在该公告范围内。[Transformers.js](https://github.com/huggingface/transformers.js/security) 与 [ONNX Runtime](https://github.com/microsoft/onnxruntime/security/advisories) 的仓库入口当时没有列出公开公告；这不等于没有漏洞，也不覆盖所有传递依赖、其他公告来源或未来变化。本轮没有执行完整 SBOM/CVE 数据库扫描，不据此宣称 vendor 安全清零；没有擅自升级这些运行时依赖。
