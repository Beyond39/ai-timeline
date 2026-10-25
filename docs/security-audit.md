# 公开仓库安全审计（2026-10-25）

审计对象：公开初始提交 `34596bd770240255373975a8f12c4eb433857b16`、本地恢复源 `7d814a11`、当前源码与 refs/reflog 可达历史。未确认有效密钥或真实私人聊天泄漏；不据此承诺不存在未知格式或语义隐私风险。

## 已提交数据库

从 Git blob 原件提取三文件至被忽略的临时审计目录，没有打印聊天或凭据。不是只检查最新工作区文件。

- `data/ai-memory.sqlite`：483,328 字节，SQLite integrity_check 为 ok；38 张表中仅 schema_meta 有 1 行（schema_version=6），37 张业务表均为 0 行。
- 页面大小 4,096 字节，共 118 页，freelist=0；110 个空 B-tree 页面未使用空间全部为零。非空页对应 schema、schema_meta 及其索引。
- `data/ai-memory.sqlite-wal`：Git 原件 0 字节，无 WAL frame。
- `data/ai-memory.sqlite-shm`：32,768 字节，SQLite 索引辅助文件，无聊天业务记录证据。

三文件已从最新索引移除，本地原件保留并忽略。原提交仍在 main 历史中，**没有宣称历史中的数据库文件消失**。在未发现真实业务数据、密钥或残留内容的条件下，采用普通后续提交，没有为删除空数据库而改写公开历史。若将来发现新的隐私证据，必须另行备份、审核远程状态并取得所有者对历史重写的明确授权。

## 凭据、聊天与历史副本

`python tools/audit-public-source.py --output tmp/finalization-security-scan.json` 扫描工作区可读文件、ZIP 内文本及所有 refs/reflog 可达的 Git 文本 blob。首次本轮结果：694 个工作区文本、770 个归档文本、689 个历史文本 blob。常见 provider-key、私钥、JWT、带凭据 URL 均无命中。

字面凭据候选来自 validate-full-conversation、validate-hybrid 与 source-flow-bridge 的合成 VM/mock 测试；邮箱候选来自 validate-reader 的安全链接拒绝测试。对话 URL 候选属于采集与 fixture 契约。报告只保留规则、路径和行号，不公开匹配值。生成目录在工作区扫描中排除，但已提交 dist/output 的文本通过 Git 历史扫描覆盖；归档也解包扫描。运行包另做白名单与逐文件校验。

检查了旧 output 审计 JSON/补丁与测试 fixture 的来源。没有把生成目录全部认作真实数据，也没有把验证样例全部删除。必要的手写 validation、基准与合成 fixture 保留；search-baseline 是可再生成的源码快照，不是必须提交的独立 golden。

## 远程与本地保护

远程公开仓库只有 main，初始 SHA 与本地一致。备份引用：`backup/public-before-finalization-20261025` 与 `backup/source-before-finalization-20261025`，仅留本地，不推送其他开发分支。只对 origin/main 做正常快进推送。独立网站仓库的源码与 .git 不动；移除误入父仓库的无 URL Gitlink。

## 范围与限制

没有读取用户正常浏览器 Profile、调用付费 API、联网验证候选密钥，也没有删除用户数据。不包含任意不可达 Git 对象、OCR/PDF 全文取证、加密文件或未知凭据格式的完备检测。二进制 PDF 通过来源/用途审查，不视为已经全面文本扫描。发现有效泄漏时需要立即撤销或轮换服务方凭据；仅删除最新文件不足以修复泄漏。

截图仅采用隔离测试的合成数据。可选 AI 的正文外传、模型下载及浏览器存储边界见 [privacy.md](privacy.md)。先前发布准备的历史结论留存于 `history/security-audit-before-finalization.md`；以本页和本轮验证记录为准。

## 本轮最终补查

最后一次扫描读取 704 个工作区文本、770 个归档文本、712 个历史文本 blob；新增邮箱候选集中于官方 ONNX notices、模型说明中的公开版权/作者联系信息。常见密钥、私钥、JWT、凭据 URL 仍无命中。另以 pypdf 提取 7 份历史 PDF 的 91 页文本并应用相同规则，候选为 0；不包含图像 OCR 或完整语义取证。生成 PDF 已停止追踪，本地原件保留。

GitHub 私密漏洞报告已启用；安全入口见根 SECURITY.md。最终工作树 481 个文件，其中正式扩展 342 个；源码门禁检查排除生成目录、数据库、Gitlink 和公开历史中的大型 fixture。发布包的精确摘要及独立克隆结果见 validation/repository-finalization.json。
