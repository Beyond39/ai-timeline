# OPC Timeline — 1.7.1-beta.1

Chrome MV3 extension; numeric manifest/package/export version: `1.7.1`.
Beta release package. Core browsing, organization and exports need no API key or Python service.

From this directory with Node.js 22+:

```powershell
npm test
npm run build
npm run verify:package
```

Load `dist/ai-conversation-visual-navigator` in `chrome://extensions` using Developer mode → Load unpacked. `manifest.json` is directly inside that directory and directly at the root of the generated ZIP. Extract ZIPs first. Existing users must keep the original extension entry and path, back up, reload and reopen pages.

Capture a selected ChatGPT conversation or import JSON; preview, choose a local Project and save. Timeline, Reader, Canvas, search, annotations and Deploy operate on stored records. Optional AI remains experimental, requires a separately started local proxy, and sends selected Q/A text externally only after confirmation. Model downloads contact Hugging Face. Source capture uses ChatGPT's existing session within its own page.

Read the [bundled installation, privacy and acceptance guide](docs/PUBLIC_BETA.md) and [third-party notices](docs/THIRD_PARTY_NOTICES.md). In a source checkout, the repository root README and `docs/` contain the complete architecture, audit, testing and Windows release guide. The ZIP is an extension runtime package; it does not include the optional proxy. Run that proxy from the full source checkout.

中文：此包保留既有 Timeline / Canvas / Deploy 能力，不含私人资料与测试浏览器 Profile。核心资料库、知识缓存与分析历史分开保存；请分别导出资料库和知识分析备份。已安装者保留原路径，不卸载重装。真实登录采集、原用户故障现场和付费 AI 仍需独立人工验收。

Historical development notes remain in the source checkout, including `docs/README-before-public-beta.zh-CN.md`; they are excluded from the runtime ZIP to avoid conflicting installation/version instructions.

The project retains its existing MIT LICENSE. Third-party components keep their own licenses and notices; see docs/THIRD_PARTY_NOTICES.md.
