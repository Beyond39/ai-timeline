# 构建与测试记录

日期：2026-10-25，Asia/Shanghai。以下为本轮重新执行结果，早期准备记录在 `history/testing-before-finalization.md`。

| 检查 | 本轮结果 | 边界 |
| --- | --- | --- |
| Node 功能测试 | 25 个套件通过，378 条报告 PASS；另有不按此格式计数的断言 | 非覆盖率，非真实账户采集 |
| 静态检查 | 110 个 JS、277 个模块引用通过 | 语法/链接、MV3、资源、HTML hook、图标及固定摘要 |
| 构建与 ZIP 校验 | 通过；最终数量与摘要见 `validation/repository-finalization.json` | 每个 ZIP 项解压后与安装目录和源码逐字节比较 |
| MV3 Project 生命周期 | 15 项通过 | 独立 A/B/C，第二项目后缩放/节点，加载失败/竞态、切换、重启 |
| MV3 Workspace/原生侧栏同步 | 23 项通过 | 双向缩放、并发旧写拒绝、跨项目隔离、来源摘要不变 |
| MV3 指针/尺寸回归 | 13 项通过 | 真实鼠标、按下期间 resize、丢失释放事件、独立恢复状态 |
| Hybrid 分析流程 | 18 项通过 | 真实 MV3/IndexedDB 和 loopback，OpenAI 上游是 mock，未付费调用 |
| Python 原型 | 39 个 unittest 通过 | 原型组件，非插件依赖 |
| 独立 Git 克隆 | 状态与摘要见机器记录和本轮报告 | 不复制开发目录隐藏文件或 node_modules |
| GitHub Actions | 推送后另查实际运行状态 | 本地通过不等于远程 CI 通过 |

生命周期、同步与指针测试使用本机 Chrome `155.0.8059.85`；Hybrid 使用 Edge Chromium `156.0.4314.42`。均采用新建隔离 Profile；当前浏览器实测不能替代全部 Chrome 版本验收。Node `24.22.1`，可选测试 Playwright `1.62.1`。

## 核心命令

从仓库根目录：

```powershell
cd apps/navigator-extension
npm test
npm run check
npm run build
npm run verify:package
```

无需 npm install；Node 22+，PowerShell 若禁止 npm.ps1 请用 npm.cmd。SHA256SUMS.txt 与 PACKAGE_CHECK_REPORT.json 在被忽略的插件 dist 中。发布摘要另保存为已审阅的机器记录。

## 可选浏览器测试

在插件目录安装测试工具（不是运行依赖）：

```powershell
npm install --no-save --package-lock=false playwright@1.62.1
$env:OPC_TEST_BROWSER = '实际 Chrome 或 Edge 可执行文件绝对路径'
$env:OPC_TEST_EXTENSION = 'dist/ai-conversation-visual-navigator'
node scripts/diagnose-project-lifecycle-mv3.mjs --navigation-races --width=1040 --start-narrow --report=dist/FINALIZATION_LIFECYCLE.json
node scripts/test-workspace-sync-mv3.mjs --cdp-load --report=dist/FINALIZATION_SYNC.json
node scripts/test-workspace-runtime-mv3.mjs --extension=dist/ai-conversation-visual-navigator --report=dist/FINALIZATION_RUNTIME.json
node scripts/test-hybrid-browser.mjs
```

Hybrid 会绑定本机 8787 端口且使用 mock 上游，不能与另一个代理同时运行。当前开发环境可复用随运行时提供的 Playwright；独立克隆的核心检查不依赖它。历史其他浏览器 runner 可能仍有开发机路径假设，不将全部脚本宣称为可移植入口。

本轮首次浏览器启动受系统访问限制而退出、Python 五项 loopback 请求出现 WinError 10013；获得测试进程/本机连接权限后，原命令通过，没有将最初失败计作通过。

## 必须另行验收的范围

真实登录 ChatGPT 采集、原私人故障 Profile、已有安装的原位升级与备份恢复、付费 AI 输出质量、Word/WPS/PDF 最终显示和全部旧版 Chrome 未在本轮验证。测试数据全部为合成内容；不清空用户资料库来获得通过结果。多 Project 15/23/13 项存在覆盖重叠，不能相加当作独立质量样本。
