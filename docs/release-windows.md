# Windows 发布操作

主分支为 main，远程为 https://github.com/Beyond39/ai-timeline。当前版本 1.7.1-beta.1，数字版本 1.7.1。实际状态见 [本轮报告](repository-finalization.md)。

1. 从干净克隆运行扩展 npm test、npm run build、npm run verify:package。
2. 独立浏览器测试只使用合成数据和临时配置；不要加载私人 Profile。
3. 审查 git diff --cached --stat 和追踪清单，确认 data/output/dist、环境密钥与大型 fixture 均不在索引。
4. 创建普通提交，先核对远程 main，再正常推送；遇到远程新增提交先获取和整合，不能用强推覆盖。
5. 创建针对已验证 main 提交的 v1.7.1-beta.1 Pre-release，上传安装 ZIP、SHA256SUMS.txt 和安装/第三方说明。
6. 核对远程 tag、附件大小与摘要，记录 Release URL。GitHub 自动生成的源码 ZIP 不是插件安装包。

代理问题可仅对当前命令清空代理：git -c http.proxy= -c https.proxy= push origin main。不要改全局配置或推送所有本地分支。

本地旧开发历史包含大型 fixture，且与公开 main 的根提交不同；本轮从已核验源码恢复文件，创建正常后续提交，没有 merge 旧开发历史。只有识别到需要删除的真实隐私数据、完成备份与影响说明并得到所有者明确授权后，才可另行安排带精确 lease 的历史修复。
