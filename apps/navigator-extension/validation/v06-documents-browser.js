// Validation only: actual repository/IndexedDB and real browser DOM on an
// explicitly isolated localhost origin. Never shipped, never reads a live chat.
import { command, createDraft, saveDraft } from '../storage/repository.js';
import { readState, resetReadMetrics, setReadMetricsEnabled, getReadMetrics } from '../storage/database.js';
import { parseImport } from '../importers/json.js';
import { composeDocument } from '../domain/document-export.js';
import { documentToMarkdown, documentToPrintableHtml, renderDocument } from '../exports/render.js';
import { createDocxBytes } from '../exports/docx.js';
import { DocumentExportPanel } from '../ui/documents.js';
import { createV04Demo } from './v04-navigation-browser.js';

const expect = (condition, message) => { if (!condition) throw new Error(message); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const reference = (conversation, message) => ({ conversationId: conversation.id, messageId: message.id, versionId: message.versionId });
const entryCount = spec => spec.chapters.reduce((count, chapter) => count + chapter.entries.length, 0);

async function verifyNamespace(namespace) {
  const expectedName = `acvn-validation-${namespace}`;
  // Checking the connection's real name also catches a URL parameter without
  // the installed validation-only indexedDB.open wrapper. No product mutations
  // happen until this check passes; mismatched upgrade transactions are aborted.
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('ai-conversation-visual-navigator');
    request.onerror = () => reject(request.error ?? new Error('隔离资料库检查失败。'));
    request.onupgradeneeded = () => {
      if (request.result.name !== expectedName) request.transaction.abort();
    };
    request.onsuccess = () => {
      const db = request.result, actualName = db.name; db.close();
      if (actualName !== expectedName) reject(new Error(`数据库没有隔离：${actualName}`)); else resolve();
    };
  });
}

export async function runDocumentBrowserChecks() {
  const checks = [], failures = [], panels = [];
  const namespace = new URLSearchParams(location.search).get('validationDb');
  const scope = 'Actual IndexedDB/repository documentSources and browser DocumentExportPanel on an explicitly isolated localhost validationDb; labelled synthetic projects only. Checks current immutable versions, saved topics, cross-conversation chapters, no-QA unknown bodies, read-only composition and async close/reopen. Does not trigger downloads, new tabs, printing, live ChatGPT capture, MV3 permissions or Word/WPS applications.';
  const result = () => ({ passed: checks.length, failed: failures.length, checks, failures, scope, checkedAt: new Date().toISOString(), isolatedDatabase: namespace ? `acvn-validation-${namespace}` : null });
  const check = async (name, run) => {
    try { await run(); checks.push(name); }
    catch (error) { failures.push({ name, error: error.message }); }
  };
  await check('文档测试仅在真实隔离 localhost 资料库运行', async () => {
    expect(location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname), '必须使用本地验证服务器。');
    expect(/^v0[346]-[a-z0-9-]+$/.test(namespace ?? ''), '必须提供明确的独立 validationDb。');
    expect(!document.querySelector('dialog[open]'), '请先关闭其他弹窗。');
    await verifyNamespace(namespace);
  });
  if (failures.length) return result();

  let fixture, sources, outside, unknownId, longId, longSourceId, longText, oldVersionId, longMessageId, currentVersionId;
  const importSynthetic = async (projectId, sourceId, title, messages, { unknown = false } = {}) => {
    const parsed = await parseImport(JSON.stringify({ provider: 'v06-documents-labelled-synthetic', conversations: [{
      id: sourceId, title, source_url: `https://example.invalid/synthetic/${sourceId}`, created_at: '2025-01-01T00:00:00Z', messages
    }] }), 'v06-documents-labelled-example.json');
    if (unknown) parsed.conversations[0].messages.forEach((message, index) => Object.assign(message, { role: 'unknown', originalRole: 'unknown', roleUnverified: true,
      ...(index === 0 ? { confirmedRole: 'user', confirmedRoleBasis: 'labelled_synthetic_fixture' } : {}) }));
    const draft = await createDraft(parsed), saved = await saveDraft({ draftId: draft.id, projectId, indices: [0] });
    expect(!saved.failures.length && saved.results[0], '合成样例保存失败。');
    return saved.results[0];
  };
  try {
    await check('建立带真实主题与跨对话成员的明确合成项目', async () => {
      fixture = await createV04Demo();
      await command('renameProject', { projectId: fixture.projectId, name: 'V0.6 文档浏览器验证 · 明确合成样例' });
      const view = await command('view', { projectId: fixture.projectId });
      expect(view.conversations.length === 5 && view.segments.some(segment => segment.active && segment.topicIds.length), '演示项目的对话或主题不完整。');
    });
    if (!fixture) return result();
    await check('真实存储支持完全没有问答索引的未知角色正文', async () => {
      const sourceId = `v06-unknown-${crypto.randomUUID()}`;
      const saved = await importSynthetic(fixture.projectId, sourceId, '零角色标记正文 · 合成样例', Array.from({ length: 5 }, (_, index) => ({
        id: `body-${index}`, role: 'unknown', text: `UNKNOWN-BODY-${index}\n\n完整代码正文末尾-${index}-END`, format: 'plain'
      })), { unknown: true });
      unknownId = saved.conversationId;
      const view = await command('view', { projectId: fixture.projectId });
      expect(!view.qas.some(qa => qa.conversationId === unknownId), '未知正文意外获得推测问答。');
      const loaded = await command('documentSources', { projectId: fixture.projectId, conversationIds: [unknownId] });
      const spec = composeDocument(loaded, { includeUserPrompts: false });
      expect(entryCount(spec) === 5 && spec.chapters[0].entries[0].source.role === 'unknown', '未知角色正文被隐藏或删除。');
      expect(spec.chapters[0].entries[0].source.confirmedRole === 'user', '人工阅读标注丢失。');
    });
    await check('建立长正文与两代不可变版本，并保留实际保存主题', async () => {
      longSourceId = `v06-long-${crypto.randomUUID()}`;
      const first = await importSynthetic(fixture.projectId, longSourceId, '长文档与版本 · 合成样例', [{ id: 'long-q', role: 'user', text: '真实合成问题', created_at: '2025-01-02T03:04:05Z' }, { id: 'long-a', role: 'assistant', text: 'OLD-IMMUTABLE-VERSION-END' }]);
      longId = first.conversationId;
      const previous = await command('documentSources', { projectId: fixture.projectId, conversationIds: [longId] });
      oldVersionId = previous.conversations[0].messages[1].versionId; longMessageId = previous.conversations[0].messages[1].id;
      longText = '# 完整合成长正文\n\n```js\nconst 中文 = "<script>";\n```\n\n| 列 | 数据 |\n| --- | --- |\n| 中文 | 42 |\n\n' + '长正文𠀀🤖保留换行\n'.repeat(1800) + 'V06-BROWSER-LONG-END';
      await importSynthetic(fixture.projectId, longSourceId, '长文档与版本 · 合成样例', [{ id: 'long-q', role: 'user', text: '真实合成问题', created_at: '2025-01-02T03:04:05Z' }, { id: 'long-a', role: 'assistant', text: longText }]);
      const view = await command('view', { projectId: fixture.projectId }), segment = view.segments.find(row => row.active && row.conversationId === longId);
      await command('editSegment', { operation: 'topics', segmentId: segment.id, baseRevision: segment.revision, names: '文档真实保存主题' });
      const versions = await command('messageVersions', { messageId: longMessageId });
      expect(versions.versions.length === 2 && versions.versions.find(row => row.id === oldVersionId)?.text === 'OLD-IMMUTABLE-VERSION-END', '旧不可变版本缺失或变更。');
      currentVersionId = versions.currentVersionId;
    });
    await check('项目来源按项目索引读取，不扫描其他项目正文', async () => {
      outside = await command('createProject', { name: 'V0.6 外部项目拒绝验证 · 合成样例' });
      const other = await importSynthetic(outside.id, `v06-outside-${crypto.randomUUID()}`, '另一个项目的正文 · 合成样例', [{ id: 'outside-q', role: 'user', text: '外部问题' }, { id: 'outside-a', role: 'assistant', text: 'OUTSIDE-PROJECT-SHOULD-NOT-EXPORT' }]);
      outside.conversationId = other.conversationId;
      resetReadMetrics(); setReadMetricsEnabled(true);
      try { sources = await command('documentSources', { projectId: fixture.projectId }); }
      finally { setReadMetricsEnabled(false); }
      const traces = getReadMetrics().filter(trace => trace.operation === 'documentSources');
      expect(traces.length === 1 && traces[0].fullStateReads === 0, '导出来源读取了全库。');
      expect(traces[0].projectIds.every(id => id === fixture.projectId), '导出读取了另一个项目记录。');
      expect(!sources.conversations.some(conversation => conversation.id === outside.conversationId), '资料包夹带其他项目对话。');
      let rejected = false;
      try { await command('documentSources', { projectId: fixture.projectId, conversationIds: [outside.conversationId] }); } catch { rejected = true; }
      expect(rejected, '跨项目对话选择未被拒绝。');
    });
    if (!sources) return result();
    await check('documentSources 保留完整正文、实际当前版本、已存主题和独立时间', () => {
      const conversation = sources.conversations.find(row => row.id === longId), answer = conversation.messages.find(row => row.id === longMessageId), question = conversation.messages.find(row => row.role === 'user');
      expect(answer.text === longText && answer.versionId === currentVersionId && answer.versionId !== oldVersionId, '完整当前版本正文未保留。');
      expect(answer.presentation.format === 'markdown' && answer.topicNames.includes('文档真实保存主题'), '呈现或实际主题缺失。');
      expect(question.sourceTime.value === '2025-01-02T03:04:05.000Z' && question.sourceTime.value !== question.capturedAt, '来源时间被采集时间替代。');
      expect(answer.sourceTime.value === null && conversation.sourceUrl.includes('example.invalid'), '未知时间或真实保存URL不正确。');
    });
    await check('同项目跨对话章节保持手动顺序与完整独立来源引用', () => {
      const long = sources.conversations.find(row => row.id === longId), unknown = sources.conversations.find(row => row.id === unknownId);
      const spec = composeDocument(sources, { title: '跨对话资料包 · 合成测试', chapters: [
        { title: '手动第二话题先读', items: [reference(unknown, unknown.messages[4]), reference(long, long.messages[1])] },
        { title: '手动第一话题后读', items: [reference(long, long.messages[0])] }
      ] });
      expect(spec.chapters[0].entries[0].source.conversationId === unknownId && spec.chapters[0].entries[1].source.conversationId === longId, '章节成员顺序或跨对话来源不正确。');
      expect(spec.chapters[0].entries[1].text === longText && spec.chapters[0].entries[1].source.versionId === currentVersionId, '资料包正文或版本丢失。');
      expect(spec.chapters[1].title === '手动第一话题后读', '手动标题丢失。');
    });
    await check('实际问答／片段导出严格限制成员与当前路径', async () => {
      const view = await command('view', { projectId: fixture.projectId }), conversation = view.conversations.find(row => row.id !== unknownId && row.id !== longId);
      const qa = view.qas.find(row => row.conversationId === conversation.id && row.pathId === conversation.currentPathId), segment = view.segments.find(row => row.active && row.qaIds.includes(qa.id));
      const qaSources = await command('documentSources', { projectId: fixture.projectId, qaIds: [qa.id], pathSelections: { [conversation.id]: qa.pathId } });
      expect(qaSources.conversations.length === 1 && qaSources.conversations[0].messages.length === 1 + qa.responseMessageIds.length, '问答范围夹带其他成员。');
      const segmentSources = await command('documentSources', { projectId: fixture.projectId, segmentIds: [segment.id], pathSelections: { [conversation.id]: segment.pathId } });
      const expected = new Set(view.qas.filter(row => segment.qaIds.includes(row.id)).flatMap(row => [row.userMessageId, ...row.responseMessageIds]));
      expect(segmentSources.conversations[0].messages.length === expected.size && segmentSources.conversations[0].messages.every(message => expected.has(message.id)), '片段范围不是实际成员集合。');
    });
    const beforeExport = JSON.stringify(await readState());
    await check('预览、Markdown、打印版和 DOCX 构建保持完整且不执行外部内容', () => {
      const long = sources.conversations.find(row => row.id === longId), spec = composeDocument(sources, { chapters: [{ title: '完整文件测试', items: [reference(long, long.messages[1])] }] });
      const markdown = documentToMarkdown(spec), html = documentToPrintableHtml(spec), docx = createDocxBytes(spec), preview = renderDocument(document, spec);
      expect(markdown.includes(longText) && html.includes('V06-BROWSER-LONG-END') && preview.textContent.includes('V06-BROWSER-LONG-END'), '长文档末尾遗漏。');
      expect(preview.querySelector('pre') && preview.querySelector('table') && !preview.querySelector('script,img,iframe'), '代码表格未保留或出现外部执行内容。');
      expect(docx[0] === 0x50 && docx[1] === 0x4b && docx.byteLength > longText.length, 'DOCX压缩包未生成。');
    });
    await check('读取与文件构建不修改任何 IndexedDB 业务资料和版本', async () => {
      expect(JSON.stringify(await readState()) === beforeExport, '导出构建改变了原文、版本、主题、片段或资料库修订。');
    });

    const errors = [], calls = [], a = deferred(), b = deferred();
    const panel = new DocumentExportPanel({ api: async (type, args) => {
      calls.push({ type, args }); return args.conversationIds ? a.promise : b.promise;
    }, onError: message => errors.push(message) });
    panels.push(panel);
    const firstConversation = sources.conversations.find(row => row.id !== unknownId && row.id !== longId);
    let pendingA, pendingB;
    await check('打开A后立即关闭并重开B，新会话独立发起第二次读取', async () => {
      pendingA = panel.open({ projectId: fixture.projectId, projectName: sources.project.name, conversationId: firstConversation.id, pathId: firstConversation.pathId, initialMode: 'conversation' });
      expect(calls.length === 1 && panel.exportButton.disabled, 'A 未进入忙碌读取。');
      panel.dialog.close();
      // Intentionally reopen before the queued native close event is dispatched.
      pendingB = panel.open({ projectId: fixture.projectId, projectName: sources.project.name, initialMode: 'project' });
      expect(calls.length === 2 && panel.dialog.open, 'B 被旧会话busy锁阻挡。');
      await settle();
      b.resolve(structuredClone(sources)); await pendingB;
      expect(panel.sources?.project.id === fixture.projectId && panel.sources.conversations.length === sources.conversations.length, 'B 被旧 close 事件失效。');
      expect(!panel.previewButton.disabled && !panel.exportButton.disabled && !panel.scope.disabled, 'B 控件未恢复。');
    });
    await check('B先完成后A才返回，不覆盖新来源、章节、范围或按钮', async () => {
      const before = panel.sources && JSON.stringify(panel.sources);
      a.resolve({ ...structuredClone(sources), conversations: [structuredClone(firstConversation)] });
      if (pendingA) await pendingA;
      expect(panel.mode === 'project' && panel.scope.value === 'project' && panel.sources && JSON.stringify(panel.sources) === before, 'A 的迟到结果覆盖了B。');
      expect(panel.chapters.length === sources.conversations.length && !panel.exportButton.disabled && !panel.previewButton.disabled, 'A 的清理改变了B的章节或按钮。');
      expect(errors.length === 0, '旧请求错误泄露到新会话。');
    });
    if (panel.sources) {
      await check('单段取消后对话计数、半选状态与实际文件成员一致', () => {
        const conversation = panel.sourceHost.querySelector('.document-conversation'), include = conversation.querySelector('.document-message-row input[type="checkbox"]');
        const count = panel.selected.size;
        include.checked = false; include.dispatchEvent(new Event('change', { bubbles: true }));
        const all = conversation.querySelector(':scope > label.check input[type="checkbox"]');
        expect(panel.selected.size === count - 1 && all.indeterminate && !all.checked, '对话全选状态没有更新。');
        expect(conversation.querySelector('summary').textContent.includes(`${conversation.querySelectorAll('.document-message-row').length - 1} /`), '对话汇总段数未更新。');
        expect(entryCount(panel.specification()) === count - 1, '实际文档包含已取消的消息。');
      });
      await check('已存主题分组与完整预览可用，调整选择使旧下载入口失效', () => {
        panel.groupByTopics();
        expect(panel.chapters.some(chapter => chapter.title === '文档真实保存主题') && panel.chapters.some(chapter => chapter.title === '待归类正文'), '保存主题或未知正文分组缺失。');
        panel.showPreview(); expect(!panel.preview.hidden && panel.preview.textContent.includes('V06-BROWSER-LONG-END'), '预览缺少完整长正文。');
        const stale = document.createElement('a'); stale.textContent = '过期合成下载入口'; panel.downloadHost.append(stale);
        panel.includeSources.checked = false; panel.includeSources.dispatchEvent(new Event('change', { bubbles: true }));
        expect(panel.preview.hidden && panel.downloadHost.childNodes.length === 0, '修改选择后旧预览或下载入口未失效。');
      });
    }
    await check('界面章节编辑与预览仍不修改保存项目、原文和版本', async () => {
      expect(JSON.stringify(await readState()) === beforeExport, '文件界面编辑修改了已保存资料。');
    });
  } catch (error) { failures.push({ name: '文档浏览器验证执行', error: error.message }); }
  finally {
    setReadMetricsEnabled(false);
    for (const panel of panels) { if (panel.dialog.open) panel.dialog.close(); panel.dialog.remove(); }
  }
  return result();
}
