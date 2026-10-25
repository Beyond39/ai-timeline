# 本轮修改清单与归属

此清单只记录本次公开发布准备。开始时已有 42 个 tracked 修改和大量 untracked 生产代码/报告；其中的业务实现、存储分库、AI 模块和多 Project 修复都不是本轮新增。没有删除或 reset 这些文件，没有建立提交、推送、更改历史或设置 Public。

| 文件 | 本轮修改原因 |
| --- | --- |
| `.gitignore` | 补充根 dist、根 ZIP 摘要、数据库、凭据文件、HAR、日志、测试 Profile、PDF 报告等排除规则，保留 `.env.example` |
| `.gitattributes` | 保留 vendor 固定摘要文件的原始字节，避免 Git 自动换行损坏；应用源码继续正常文本处理，没有批量格式化 |
| `README.md` | 以实际扩展为主、英文为主中文补充，补齐用户指定的 10 类信息、真实截图与 AI/隐私边界 |
| `CHANGELOG.md` | 添加本地 Beta、区分 Git 已提交/未提交修复/历史 Python 版本，不伪造公开版本日期 |
| `SECURITY.md`, `CONTRIBUTING.md` | 更新扩展与旧 Python 的区别、真实测试命令和未配置的私人安全联系渠道 |
| `docs/history/README-before-public-beta.md` | 保存任务开始时的根说明；其中路径/版本属于历史，不作为当前安装指南 |
| `docs/architecture.md`, `docs/privacy.md`, `docs/installation.md` | 对应真实模块/数据流、权限/储存/网络和 Windows 安装升级，说明备份不覆盖所有独立状态 |
| `docs/security-audit.md`, `docs/license-review.md` | 风险分级、脱敏扫描范围与局限、现有未确认 MIT/图标/转换模型和 vendor notice 待办 |
| `docs/multi-project-regression.md` | 从实际修复代码解释通知、指针/resize、局部视口、原子导航与并发，而非猜测 UUID/遮罩问题 |
| `docs/testing.md`, `docs/validation/public-beta-results.json`, `docs/validation/public-beta-package-inputs.json` | 保存真实结果/失败边界、浏览器版本、包/运行文件摘要与可重跑命令；原始 Profile/全文日志不进入公开摘要 |
| `docs/validation/public-beta-security-scan.json` | 公开审计的计数/范围/限制，不复制任何匹配值或私人文件正文 |
| `docs/releases/v1.7.1-beta.1.md`, `docs/release-windows.md` | Release Notes、许可与暂存审查、Private 上传/草稿预发布步骤，执行留给所有者确认 |
| `docs/internship-project-summary.zh-CN.md` | 技术证据、简历措辞、追问和源码阅读顺序，明确不支持的成果表述 |
| `docs/screenshots/README.md`, `timeline-workspace.png`, `native-sidepanel.png` | 本轮真实最终扩展 UI 截图，合成数据、已视觉检查，说明不是 mockup/私人数据 |
| `docs/release-preparation.zh-CN.md`, `docs/release-changes.md` | A–G 交付索引与本清单 |
| `apps/navigator-extension/README.md` | 精简为当前可随包安装说明，避免历史版本指令冲突 |
| `apps/navigator-extension/docs/README-before-public-beta.zh-CN.md` | 保存原扩展 README 全文作为历史，不删历史能力说明 |
| `apps/navigator-extension/docs/PUBLIC_BETA.md`, `THIRD_PARTY_NOTICES.md` | 当前 ZIP 内可独立阅读的安装/隐私/验收与第三方说明 |
| `apps/navigator-extension/manifest.json`, `package.json`, `domain/common.js`, `sidepanel.html`, `workspace.html` | numeric version 同步 1.7.1，manifest `version_name` 为 1.7.1-beta.1，声明 Node >=22；HTML 仅版本文字改动，没有新功能或样式改版 |
| `apps/navigator-extension/scripts/build.mjs` | docs 从整个目录改为两份当前指南白名单；若旧生成目录有多余文件则保留为 previous-build-*，继续固定时间 ZIP，不删源码 |
| `apps/navigator-extension/scripts/verify-package.mjs` | 新增未审 docs/私有目录名排除断言，保留 source/install/ZIP 逐字节检查 |
| `apps/navigator-extension/scripts/browser-runtime.mjs` | test-only：优先普通 checkout 的本地 Playwright，兼容原桌面工具环境；支持配置/发现浏览器 |
| `scripts/diagnose-project-lifecycle-mv3.mjs`, `diagnose-second-project.mjs`, `test-workspace-runtime-mv3.mjs`, `test-workspace-sync-mv3.mjs`, `test-hybrid-browser.mjs`（均在扩展目录） | 五个主要入口改用该 resolver；Hybrid 另修正 Topics 和折叠详情的过期步骤，保留原 18 个断言和两次失败报告 |
| `tools/audit-public-source.py` | 可复跑的只读规则扫描，覆盖文本/ZIP/refs+reflog 历史 blob，只报告位置/规则，不输出匹配值 |
| `.github/workflows/extension.yml` | 定义 Windows/Linux Node 测试、构建与完整性检查；不发布、不上传，远程尚未运行 |

没有修改根 `LICENSE`、`pyproject.toml` 的既有许可声明、任何数据库 schema、存储实现或采集/AI 生产逻辑。`ui/app.js`、`ui/opc.js`、`ui/horizontal-timeline.js` 的本轮工作是阅读与测试，里面已有的修改保留原状。

`tmp/` 中的审阅辅助程序、审计 JSON、独立源码副本及原始日志，和扩展 `dist/` 中的测试 Profile、旧目录/报告及构建输出都是本地验证产物，未被提交。最终只分发经批准的候选 ZIP/摘要和审阅后的汇总，不要用它们代替完整源码提交。
