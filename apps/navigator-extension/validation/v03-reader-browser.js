// This local validation module is excluded from the installed extension.
import { command, createDraft, saveDraft } from '../storage/repository.js';
import { parseImport } from '../importers/json.js';
import { Reader } from '../ui/reader.js';
import { el } from '../ui/dom.js';

const settle = () => new Promise(resolve => setTimeout(resolve, 25));
export async function runReaderBrowserValidation() {
  const checks = [], failures = [], calls = [], selected = [];
  const expect = (value, description) => { if (!value) throw new Error(description); };
  const check = async (name, fn) => { const start = performance.now(); try { await fn(); checks.push({ name, elapsedMs: +(performance.now() - start).toFixed(2) }); } catch (error) { failures.push({ name, error: error.message }); } };
  const fixtureId = crypto.randomUUID();
  const originalText = '# 完整阅读 · 明确标记的合成样例\n\n本段用于核对 Markdown、代码与表格，包含 **强调** 和 `inline()`。\n\n- 正文始终保留\n- 折叠只影响显示\n\n> 历史证据引用确切版本。\n\n```javascript\nconst value = "<script>alert(1)</script>";\nconst longLine = "' + 'horizontal-overflow-'.repeat(35) + '";\nconsole.log(value);\n```\n\n| 项目 | 值 |\n| --- | --- |\n| 正文 | 保留完整 |\n| 安全性 | `<img onerror=alert(1)>` |\n\n' + '这是长回答内容，仅为本地验证样例。'.repeat(160) + '\n\nORIGINAL-COMPLETE-END\n\n![外部图片](https://example.invalid/no-network.png)\n\n<script>window.__ACVN_UNSAFE_EXECUTED = true</script>\n\n公式原表达式：$$x^2$$';
  const payload = { provider: 'v03-reader-validation', conversations: [{ id: fixtureId, title: 'V0.3 阅读验证 · 代码表格与历史（合成样例）', messages: [
    { id: 'q-first', role: 'user', text: '第一轮完整阅读测试：Ｆｏｏ 与 e\u0301，保持原文。' },
    { id: 'a-rich', role: 'assistant', text: originalText },
    { id: 'tool-reader', role: 'tool', text: 'TOOL-COMPLETE：工具正文默认折叠但可读。' },
    { id: 'a-extra', role: 'assistant', text: '同一问题的第二条助手消息。' },
    { id: 'q-second', role: 'user', text: '第二轮读取与切换。' },
    { id: 'a-second', role: 'assistant', text: '| 编号 | 回答 |\n| --- | --- |\n| 2 | SECOND-QA-BODY |' },
    { id: 'q-unanswered', role: 'user', text: '尚未回答的真实用户轮次（验证样例）。' }
  ] }] };
  const fixture = el('section', { class: 'reader-v03-fixture', style: 'margin:20px;padding:18px;border:2px solid #6366f1;background:white;border-radius:12px' }, [el('h2', { text: 'V0.3 完整阅读 · 独立隔离样例' }), el('p', { class: 'muted', text: '真实 IndexedDB 与产品 Reader；数据为明确标记的合成样例，未连接 ChatGPT / MV3 权限。' })]);
  const host = el('div', { class: 'reader', style: 'width:360px;max-width:100%;height:660px;max-height:75vh;position:static;border:1px solid #e2e8f0;border-radius:9px;padding:16px;overflow-y:auto' }); fixture.append(host); document.body.append(fixture);
  const api = async (type, args) => { const value = await command(type, args); calls.push({ type, args: structuredClone(args), messageCount: value?.messages?.length ?? null, returnedVersionCount: value?.messages?.reduce((total, message) => total + (message.versions?.length ?? 0), 0) ?? null }); return value; };
  const reader = new Reader(host, { api, onSelect: (qa, segment) => selected.push({ qaId: qa.id, segmentId: segment?.id }), onEdit: () => {}, onMove: () => {}, onError: message => { failures.push({ name: 'Reader交互', error: message }); } });
  let projectId, conversationId, pathId, qaIds, messageId, originalVersionId, versionPayload;
  const save = async data => { const draft = await createDraft(await parseImport(JSON.stringify(data), 'v03-reader-validation-example.json')); return saveDraft({ draftId: draft.id, projectId, indices: [0] }); };

  await check('通过真实导入预览 / saveDraft建立可读取项目', async () => {
    projectId = (await command('createProject', { name: 'V0.3 阅读验证 · 明确合成样例' })).id; await save(payload);
    const view = await command('view', { projectId }); reader.setView(view); conversationId = view.conversations[0].id; pathId = view.conversations[0].currentPathId;
    qaIds = view.qas.filter(qa => qa.pathId === pathId).sort((a, b) => a.ordinal - b.ordinal).map(qa => qa.id); expect(qaIds.length === 3, '未回答问题也必须形成Q/A');
    const qa = await command('qa', { qaId: qaIds[0] }); expect(qa.messages.length === 4, '一轮必须包含用户、多助手与工具');
    const answer = qa.messages.find(message => message.role === 'assistant' && message.text === originalText); expect(answer?.presentation?.format === 'markdown', '导入呈现信息未保存'); messageId = answer.id; originalVersionId = answer.currentVersionId;
    await reader.showPath(conversationId, pathId, qaIds[0]); expect(selected.at(-1)?.qaId === qaIds[0], 'Reader选择未联动真实QA');
  });
  await check('窄Reader显示完整代码、表格、工具和多助手正文', async () => {
    const answer = host.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`), detail = answer?.querySelector('.answer-detail'); expect(detail && !detail.open, '长回答应默认折叠'); detail.open = true; await settle();
    expect(answer.querySelector('pre code')?.textContent.includes('horizontal-overflow-'), '代码正文丢失'); expect(answer.querySelectorAll('table').length === 1, '表格未渲染'); expect(answer.textContent.includes('ORIGINAL-COMPLETE-END'), '长正文尾部被截断');
    const pre = answer.querySelector('.code-block pre'); expect(pre.scrollWidth > pre.clientWidth, '长代码未在窄侧栏提供横向滚动'); expect(answer.querySelector('.table-scroll'), '表格缺少横向滚动容器');
    expect(host.textContent.includes('同一问题的第二条助手消息'), '第二条助手消息丢失'); const tool = host.querySelector('.message-card.tool .answer-detail'); expect(tool && !tool.open, '工具消息没有独立折叠'); tool.open = true; await settle();
    expect(tool.textContent.includes('TOOL-COMPLETE'), '工具完整正文不可读'); expect(answer.querySelector('.body-copy'), '缺少复制整条正文入口'); expect(answer.querySelector('.code-toolbar .body-copy'), '缺少复制代码入口');
  });
  await check('渲染不执行源HTML或自动加载外部图片', async () => {
    const answer = host.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`); expect(answer.querySelectorAll('script,img,iframe,object,svg').length === 0, '来源生成可执行节点或外部图片');
    expect(globalThis.__ACVN_UNSAFE_EXECUTED !== true, '来源脚本被执行'); expect(answer.textContent.includes('未自动加载'), '图片缺少未请求状态'); expect(answer.textContent.includes('未安装本地公式排版'), '公式支持范围未准确说明');
  });
  await check('原文入口保留完整未修改Markdown正文', async () => {
    const original = host.querySelector(`[data-message-id="${CSS.escape(messageId)}"] .original-body`); expect(original, '原始正文入口缺失'); original.open = true; await settle();
    expect(original.querySelector('.message-text')?.textContent === originalText, '原始正文被渲染或截断');
  });
  await check('Q/A切换、未回答状态与地图成员选择保持真实ID', async () => {
    await reader.displayQA(qaIds[1]); expect(host.textContent.includes('SECOND-QA-BODY'), '下一轮正文未读取'); expect(selected.at(-1)?.qaId === qaIds[1], '下一轮选择未更新');
    await reader.displayQA(qaIds[2]); expect(host.textContent.includes('没有关联助手回答'), '未回答状态缺失'); expect(host.querySelectorAll('.message-card').length === 1, '未回答问题被遗漏或错误拼回答');
    const view = await command('view', { projectId }); expect(view.segments.some(segment => segment.id === selected.at(-1)?.segmentId && segment.qaIds.includes(qaIds[2])), '选择对象未映射真实Segment');
  });
  await check('Unicode搜索结果定位原始正文并高亮全角和组合字符', async () => {
    const results = await command('search', { projectId, query: 'foo' }), hit = results.results.find(row => row.qaId === qaIds[0]); expect(hit, '全角搜索未命中真实QA');
    await reader.showPath(conversationId, pathId, hit.qaId, 'foo', hit.messageId); expect([...host.querySelectorAll('mark')].some(mark => mark.textContent === 'Ｆｏｏ'), '全角命中未映射原文');
    await reader.displayQA(qaIds[0], 'é'); expect([...host.querySelectorAll('mark')].some(mark => mark.textContent === 'e\u0301'), '组合字符命中未映射原文');
  });
  await check('源更新保存三个不可变版本且单轮仅返回当前正文版本', async () => {
    const update = structuredClone(payload); update.conversations[0].messages[1].text = '## 中间正文版本\n\nINTERMEDIATE-ONLY'; await save(update);
    update.conversations[0].messages[1].text = '## 当前正文版本\n\nCURRENT-LATEST-ONLY'; await save(update);
    const qa = await command('qa', { qaId: qaIds[0] }), answer = qa.messages.find(message => message.id === messageId); expect(answer.versionCount === 3, '不可变历史版本未保留'); expect(answer.versions.length === 1 && answer.versions[0].id === answer.currentVersionId, '单轮加载了不需要的所有历史版本');
    reader.setView(await command('view', { projectId }));
  });
  await check('历史引用仅读取当前与指定版本并展开确切历史正文', async () => {
    versionPayload = await command('conversation', { conversationId, pathId, targetMessageId: messageId, targetVersionId: originalVersionId });
    const answer = versionPayload.messages.find(message => message.id === messageId); expect(answer.versions.length === 2, '历史定位加载了其他不相关版本'); expect(answer.versions.some(version => version.id === originalVersionId && version.text === originalText), '确切旧正文未读取');
    const previousCalls = calls.filter(call => call.type === 'messageVersions').length; await reader.showConversation(conversationId, pathId, messageId, 0, '', originalVersionId);
    const version = host.querySelector(`[data-version-id="${CSS.escape(originalVersionId)}"]`); expect(version?.textContent.includes('ORIGINAL-COMPLETE-END'), '历史引用被跳到当前正文'); expect(version?.classList.contains('highlight'), '历史引用未明确标注'); expect(host.textContent.includes('CURRENT-LATEST-ONLY'), '当前正文同时丢失');
    expect(calls.filter(call => call.type === 'messageVersions').length === previousCalls, '定位历史引用不应偷偷加载所有版本');
    const original = version.querySelector('.original-body'); original.open = true; await settle(); expect(original.querySelector('.message-text').textContent === originalText, '旧版本原文不完整');
  });
  await check('其余历史版本经用户主动按钮按消息读取', async () => {
    const card = host.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`), control = [...card.querySelectorAll('button')].find(node => node.textContent === '读取其余历史版本'); expect(control, '历史按需读取按钮缺失'); control.click();
    for (let attempt = 0; attempt < 80 && control.isConnected; attempt++) await settle();
    expect(card.querySelectorAll('[data-version-id]').length === 3, '按消息加载其余版本失败'); expect(card.textContent.includes('INTERMEDIATE-ONLY'), '中间版本正文不可读');
    expect(calls.filter(call => call.type === 'messageVersions').at(-1)?.args.messageId === messageId, '历史读取未限定消息');
  });
  // Leave the exact historical body visible as a reproducible screenshot target.
  if (conversationId && originalVersionId) try { await reader.showConversation(conversationId, pathId, messageId, 0, '', originalVersionId); } catch { /* Included above if contract failed. */ }
  const report = { checkedAt: new Date().toISOString(), passed: checks.length, failed: failures.length, checks, failures, fixture: { projectId, conversationId, pathId, qaIds, messageId, originalVersionId }, calls,
    environment: 'Actual local Chromium DOM, actual IndexedDB and repository import/save/read flow; Chrome API bridged; synthetic labelled content. Native clipboard permission and real MV3/ChatGPT not asserted.' };
  fixture.prepend(el('p', { class: report.failed ? 'preview-warnings' : 'muted', text: `阅读验证：${report.passed} 项通过，${report.failed} 项失败；360px 阅读区，原文约 ${originalText.length.toLocaleString()} 字符。` })); globalThis.__ACVN_READER_V03_REPORT = report; return report;
}
