// Local-only integration checks. All records are labelled synthetic examples
// in an explicitly isolated IndexedDB namespace. No downloads/system print.
import { command, createDraft, saveDraft } from '../storage/repository.js';
import { parseImport } from '../importers/json.js';
import { getReadMetrics, resetReadMetrics, setReadMetricsEnabled } from '../storage/database.js';
import { DocumentExportPanel } from '../ui/documents.js';

const expect = (value, message) => { if (!value) throw new Error(message); };
const settle = delay => new Promise(resolve => setTimeout(resolve, delay));
async function guardNamespace(namespace) {
  expect(location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname), '必须使用 localhost 隔离验证页面。');
  expect(/^v0[3467]-[a-z0-9-]+$/.test(namespace ?? ''), '缺少明确的 validationDb 隔离标识。');
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('ai-conversation-visual-navigator'); request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => { if (request.result.name !== `acvn-validation-${namespace}`) request.transaction.abort(); };
    request.onsuccess = () => { const actual = request.result.name; request.result.close(); actual === `acvn-validation-${namespace}` ? resolve() : reject(new Error('数据库没有隔离，未写入任何样例。')); };
  });
}

export async function runV1DocumentChecks() {
  const namespace = new URLSearchParams(location.search).get('validationDb'), checks = [], failures = [], ownedProjects = [], frames = [], errors = [];
  const result = () => ({ version: '1.0.0', syntheticDataOnly: true, isolatedDatabase: `acvn-validation-${namespace}`, checkedAt: new Date().toISOString(), passed: checks.length, failed: failures.length, checks, failures,
    scope: 'Actual isolated IndexedDB and product saved-recipe UI plus actual print.html RPC in a same-namespace iframe. Chrome tabs.create intercepted only for this print action. No native printing, downloads, live chats, Word/WPS or extension permissions asserted.' });
  const check = async (name, action) => { try { await action(); checks.push(name); } catch (error) { failures.push({ name, error: error.message }); } };
  await check('新文档集成检查只写真实隔离 localhost 资料库', () => guardNamespace(namespace)); if (failures.length) return result();
  expect(!document.querySelector('dialog[open]'), '请先关闭其他弹窗。');
  const originalGetURL = chrome.runtime.getURL, originalTabCreate = chrome.tabs.create;
  let panel, project, savedRecipeId, printId, first, second, oldVersionId;
  const firstSourceId = `v1-documents-first-${crypto.randomUUID()}`, secondSourceId = `v1-documents-second-${crypto.randomUUID()}`;
  const longBody = '# 完整原始资料\n\n```js\nconst 中文代码 = "完整保留";\n```\n\n| 项目 | 数值 |\n| --- | --- |\n| 中文 | 42 |\n\n' + '完整正文𠀀🤖保留原文\n'.repeat(1000) + 'V1-RECIPE-ORIGINAL-LONG-END';
  const saveSynthetic = async (sourceId, title, answer) => {
    const bundle = await parseImport(JSON.stringify({ provider: 'v1-document-synthetic', conversations: [{ id: sourceId, title, source_url: `https://example.invalid/synthetic/${sourceId}`, messages: [{ id: `${sourceId}-q`, role: 'user', text: `${title}合成原问题` }, { id: `${sourceId}-a`, role: 'assistant', text: answer }] }] }), 'v1-document-synthetic.json');
    const draft = await createDraft(bundle), output = await saveDraft({ draftId: draft.id, projectId: project.id, indices: [0] }); expect(!output.failures.length, '样例导入保存失败。'); return output.results[0];
  };
  const openFrame = async (record = printId) => {
    const frame = document.createElement('iframe'); frame.title = 'V1 打印页合成验证'; frame.style.cssText = 'width:100%;height:480px;border:1px solid #ddd'; frames.push(frame); document.body.append(frame);
    frame.src = `${new URL('../print.html', import.meta.url).href}?record=${encodeURIComponent(record)}&validationDb=${encodeURIComponent(namespace)}`;
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('独立打印页加载超时。')), 6000); frame.onload = () => { clearTimeout(timer); resolve(); }; });
    const start = performance.now(); while (frame.contentDocument.querySelector('#print-button')?.disabled && performance.now() - start < 5000) { if (frame.contentDocument.querySelector('#print-status')?.classList.contains('error')) break; await settle(30); }
    return frame;
  };
  try {
    project = await command('createProject', { name: 'V1 资料包与打印验证 明确合成项目' }); ownedProjects.push(project.id);
    first = await saveSynthetic(firstSourceId, '技术资料', longBody); second = await saveSynthetic(secondSourceId, '学习资料', 'SECOND-SYNTHETIC-BODY-END');
    const sources = await command('documentSources', { projectId: project.id, conversationIds: [first.conversationId, second.conversationId] }), [a, b] = sources.conversations;
    oldVersionId = a.messages[1].versionId;
    panel = new DocumentExportPanel({ api: command, onError: message => errors.push(message) });
    await check('资料包UI保存所选正文、章序、段序与未导出的原问题选择', async () => {
      await panel.open({ projectId: project.id, projectName: project.name, initialMode: 'project' });
      panel.title.value = '我的完整合成资料包'; panel.recipeName.value = '合成已存方案'; panel.includeUser.checked = false;
      const identity = (conversation, message) => JSON.stringify([conversation.id, message.id, message.versionId]), order = [identity(b, b.messages[1]), identity(a, a.messages[1]), identity(a, a.messages[0])];
      panel.chapters = [{ id: 'chosen-chapter', title: '先读学习资料' }, { id: 'empty-preserved', title: '待补充资料' }]; panel.selected = new Set(order); panel.entryOrder = order; panel.assignments = new Map(order.map(id => [id, 'chosen-chapter'])); panel.renderChapters(); panel.renderSources();
      await panel.saveRecipe(false); savedRecipeId = panel.recipe.id;
      const saved = await command('documentRecipeGet', { projectId: project.id, recipeId: savedRecipeId });
      expect(saved.recipe.chapters.length === 2 && saved.recipe.chapters[1].items.length === 0, '空章节或章序丢失。'); expect(saved.recipe.chapters[0].items.length === 3 && !saved.recipe.includeUserPrompts, '排除原问题后用户选择没有保存。');
      expect(saved.recipe.chapters[0].items[0].conversationId === b.id && saved.recipe.chapters[0].items[1].versionId === oldVersionId, '用户段序或确切版本未保存。');
    });
    if (!savedRecipeId) return result();
    await check('源对话更新后关闭重开saved模式，继续读取旧版本完整长正文', async () => {
      panel.dialog.close(); await saveSynthetic(firstSourceId, '技术资料更新', 'V1-NEW-CURRENT-BODY-END');
      resetReadMetrics(); setReadMetricsEnabled(true); try { await panel.open({ projectId: project.id, projectName: project.name, initialMode: 'saved' }); } finally { setReadMetricsEnabled(false); }
      expect(panel.recipe?.id === savedRecipeId && panel.content.querySelector('.document-recipes').open, 'saved入口没有打开已存方案。');
      const spec = panel.specification(); expect(spec.chapters[0].entries[1].text === longBody && spec.chapters[0].entries[1].source.versionId === oldVersionId, '方案悄悄换成了最新正文。');
      expect(panel.selected.size === 3 && panel.chapters[1].title === '待补充资料', '保存选择或空章节丢失。');
      expect(getReadMetrics().filter(row => row.operation === 'documentRecipeGet').every(row => row.fullStateReads === 0 && row.projectIds.every(id => id === project.id)), '历史方案读取扫描了全库或外部项目。');
    });
    await check('段落上移、保存和另存新方案可用；重命名归档后可恢复', async () => {
      const moved = panel.entryOrder[1]; panel.moveEntry(moved, -1); await panel.saveRecipe(false);
      const originalId = panel.recipe.id; await panel.saveRecipe(true); expect(panel.recipe.id !== originalId, '另存覆盖了原方案。');
      panel.recipeName.value = '重命名后的合成方案'; await panel.renameRecipe(); expect(panel.recipe.name === '重命名后的合成方案', '方案名称未持久修改。');
      await panel.archiveRecipe(); expect(panel.recipe.status === 'archived' && !(await command('documentRecipeList', { projectId: project.id })).some(row => row.id === panel.recipe.id), '归档没有从活动列表移除。');
      await panel.archiveRecipe(); expect(panel.recipe.status === 'active', '归档方案不能恢复。');
      const stored = await command('documentRecipeGet', { projectId: project.id, recipeId: panel.recipe.id }); expect(stored.recipe.chapters[0].items[0].versionId === oldVersionId, '段落上移或另存丢失确切版本。');
    });
    await check('PDF动作保存可信快照，打开独立print.html地址且没有blob页', async () => {
      let opened = null;
      chrome.runtime.getURL = path => new URL(`../${path}`, import.meta.url).href;
      chrome.tabs.create = async args => { const url = new URL(args.url); if (url.pathname.endsWith('/print.html')) { opened = url; return { id: -1 }; } return originalTabCreate.call(chrome.tabs, args); };
      panel.format.value = 'pdf'; await panel.export(); chrome.tabs.create = originalTabCreate;
      expect(opened && opened.protocol === 'http:' && opened.pathname.endsWith('/print.html'), '没有打开独立本地打印页面。'); printId = opened.searchParams.get('record'); expect(printId, '打印URL缺少已存快照。');
      const snapshot = await command('documentPrintGet', { snapshotId: printId }); expect(snapshot.document.chapters[0].entries[0].text === longBody, '打印没有按选择顺序重建真实长正文。'); expect(panel.downloadHost.querySelector('a')?.href.includes('print.html?record='), '没有保留重开入口。');
    });
    if (printId) {
      await check('实际独立打印页通过RPC取得完整可选中文本、代码、表格和固定版本', async () => {
        const frame = await openFrame(), doc = frame.contentDocument;
        expect(!doc.querySelector('#print-button').disabled, `打印快照未加载：${doc.querySelector('#print-status').textContent}`);
        expect(doc.querySelector('#print-content').textContent.includes('V1-RECIPE-ORIGINAL-LONG-END') && !doc.querySelector('#print-content').textContent.includes('V1-NEW-CURRENT-BODY-END'), '打印正文被截断或换成latest。');
        expect(doc.querySelector('.export-document pre code') && doc.querySelector('.export-document table') && doc.querySelector('.export-document').textContent.includes(oldVersionId), '代码、表格或确切版本引用缺失。');
        expect(!doc.querySelector('#print-content script,#print-content img,#print-content iframe'), '来源内容执行脚本或自动加载媒体。');
      });
      await check('再次更新源对话后重开同一独立print页，快照仍保持原始全文', async () => {
        await saveSynthetic(firstSourceId, '技术资料第三次更新', 'V1-THIRD-CURRENT-BODY-END'); const frame = await openFrame();
        expect(frame.contentDocument.querySelector('#print-content').textContent.includes('V1-RECIPE-ORIGINAL-LONG-END') && !frame.contentDocument.querySelector('#print-content').textContent.includes('V1-THIRD-CURRENT-BODY-END'), '重开打印页不是固定快照。');
      });
    }
    await check('方案/打印随备份恢复，新项目历史loader和print快照继续保持同一原文', async () => {
      const backup = await command('backup', { projectId: project.id }), draft = await createDraft({ kind: 'backup', filename: 'v1-documents-synthetic-backup.json', payload: backup }), restored = await saveDraft({ draftId: draft.id }); ownedProjects.push(restored.projectId);
      const recipes = await command('documentRecipeList', { projectId: restored.projectId }); expect(recipes.length >= 2, '恢复后的方案列表缺失。');
      const restoredRecipe = await command('documentRecipeGet', { projectId: restored.projectId, recipeId: recipes.find(row => row.name === '重命名后的合成方案').id });
      expect(restoredRecipe.sources.conversations.some(conversation => conversation.messages.some(message => message.text === longBody)), '恢复后历史正文引用丢失。');
      const newBackup = await command('backup', { projectId: restored.projectId }), print = newBackup.records.documentPrints[0]; expect(print.document.project.id === restored.projectId && print.document.chapters[0].entries[0].text === longBody, '打印快照恢复后的项目ID或全文错误。');
      expect(print.id !== printId && print.document.chapters[0].entries[0].source.versionId !== oldVersionId, '恢复仍引用旧项目对象ID。');
    });
    await check('另一页面修改方案后，旧UI保存拒绝覆盖且保留当前草稿选择', async () => {
      const current = panel.recipe, selectionBefore = JSON.stringify(panel.selectionPlan()); await command('documentRecipeRename', { projectId: project.id, recipeId: current.id, expectedRevision: current.revision, name: '另一页面改名' });
      let rejected = false; try { await panel.saveRecipe(false); } catch (error) { rejected = /其他页面更新/.test(error.message); }
      expect(rejected && JSON.stringify(panel.selectionPlan()) === selectionBefore, '并发修改被覆盖或UI草稿选择丢失。');
    });
  } catch (error) { failures.push({ name: 'V1 文档集成执行', error: error.message }); }
  finally {
    setReadMetricsEnabled(false); chrome.tabs.create = originalTabCreate; if (originalGetURL) chrome.runtime.getURL = originalGetURL; else delete chrome.runtime.getURL;
    for (const frame of frames) frame.remove(); if (panel) { if (panel.dialog.open) panel.dialog.close(); panel.dialog.remove(); for (const entry of panel.urls) URL.revokeObjectURL(entry.url); }
    for (const projectId of ownedProjects) { try { const view = await command('view', { projectId }); await command('deleteProject', { projectId, confirmName: view.project.name }); } catch (error) { failures.push({ name: '合成项目清理', error: error.message }); } }
  }
  return result();
}
