# GitHub 仓库整理交付记录

## A. 原始问题与证据

公开初始提交 34596bd7 有 437 个条目（含 1 个 Gitlink），其中正式 apps/navigator-extension 源码不存在，只有 62 个 search-baseline 快照文件；197 个根 dist 文件、168 个 output 文件、3 个数据库文件与少量文档进入历史。实际文件系统也缺少正式源码，不是现有 .gitignore 规则把它们隐藏了。

完整版本仍在 codex/opc-premium-ui-refresh 的 7d814a11；本轮从该树恢复 470 个缺失文件，无覆盖本地已有文件。首次提交是另一个 root commit，未包含完整开发树。没有可恢复的旧暂存区快照证明“1807 个暂存项”如何逐项变成 437 项，因此不编造具体命令经过。能够证实的是两份树和物理源码的差异。当前 .gitignore 并未广泛忽略正式插件目录；问题是错误源树/文件缺失和对生成目录保护不足。

121 MB fixture 在本地旧开发历史里仍可达，公开 main 历史没有该 blob；不会 merge 或推送那些分支。根 dist 的 WASM 等有用资源已在正式 vendor 中恢复，不能只因文件大而移除。

## B. 实际修改

恢复正式插件和 Node 测试、原型 Python 与测试、架构契约、文档、CI。修正 .gitignore，移除生成目录和数据库的 Git 追踪但保留本地文件。网站只有本地独立仓库且无 remote/.gitmodules，不是构建依赖；只取消错误 Gitlink 并忽略该路径，未改其源码或 .git。

重写中文 README、安全/许可/测试/发布文档；.gitattributes 固定 LF 检出且保护 vendor 原始字节。构建白名单新增主 LICENSE，校验主许可与根目录相同；补齐 ONNX notices 和模型说明。产品运行逻辑、UI 与 schema 保持恢复源原样。

## C. 验证

Node 25 套件和静态门禁通过；Python 39 测试通过。隔离 MV3 Project 生命周期 15 项、侧栏同步 23 项、指针/尺寸 13 项、Hybrid mock 18 项通过。命令见 testing.md。安装包逐项解压比较和 SHA-256 通过；最终文件数量、摘要及独立克隆状态见 validation/repository-finalization.json。

## D. Git 与同步

本地备份引用 backup/public-before-finalization-20261025 与 backup/source-before-finalization-20261025。保留 main 为主分支，采用普通后续提交，不改写已有公开历史、不推送其他开发分支。源码与清理提交：3a5ae6b9。独立克隆的完整测试/构建/校验和 MV3 回归通过；最终证据提交不改变运行包输入。远程同步与 CI 见下方发布状态。

## E. Release

目标 v1.7.1-beta.1 Pre-release，安装文件位于 apps/navigator-extension/dist/ai-conversation-visual-navigator-v1.7.1.zip，校验值位于同目录 SHA256SUMS.txt。ZIP 共 143 个文件，6,370,543 字节；SHA-256：4968f520389837ed0ca6bb58307ff083de25f6941a129dca500583882ee8871a。在线状态见下方发布状态。

## F. 剩余范围

原公开提交中的空数据库和生成副本仍留在历史；数据库原件检查未发现业务数据、WAL 或空页残留，因此没有按隐私泄漏重写历史。完整范围与限制见 security-audit.md。真实登录采集、私人旧配置/原位升级、真实付费 AI、Word/WPS 和全版本浏览器兼容未验证。GitHub Actions 以实际远程运行结果为准。

## 发布状态（已核实）

- 已正常推送源码提交 `3a5ae6b9` 与证据提交 `3256575b` 到 origin/main，没有强推、改写历史或推送其他分支。本记录由后续文档提交落库。
- 已发布 [v1.7.1-beta.1 Pre-release](https://github.com/Beyond39/ai-timeline/releases/tag/v1.7.1-beta.1)，tag 指向 `3256575b6bbb16bc468402203780a962f8ae5c58`。
- 5 个附件：插件 ZIP、SHA256SUMS.txt、安装/隐私说明、第三方说明、MIT LICENSE。全部上传摘要核对通过；公开 ZIP 下载也已实际下载并重新计算摘要，与本地和独立克隆相同。
- [插件 CI](https://github.com/Beyond39/ai-timeline/actions/runs/40176083836)：Windows/Linux 两个 job 成功，包含 Node 测试、源码门禁、构建和包校验。
- [Python CI](https://github.com/Beyond39/ai-timeline/actions/runs/40176083787)：Windows/Linux × Python 3.11/3.12 四个 job 成功。
- 源码跟踪清单 481 文件，其中正式插件 342 文件；运行包 143 文件。机器证据见 [repository-finalization.json](validation/repository-finalization.json)。

[下载插件 ZIP](https://github.com/Beyond39/ai-timeline/releases/download/v1.7.1-beta.1/ai-conversation-visual-navigator-v1.7.1.zip) · [校验值](https://github.com/Beyond39/ai-timeline/releases/download/v1.7.1-beta.1/SHA256SUMS.txt)
