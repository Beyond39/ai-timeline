// Validation only: real product UI/repository/IndexedDB, a local bridge for Chrome runtime APIs.
// Never packaged or used on the user's ChatGPT page.
import { command, createDraft, saveDraft } from '../storage/repository.js';
import { parseImport } from '../importers/json.js';
import { readState } from '../storage/database.js';
import { fixturePayload } from './fixture.mjs';
import { runBrowserRegressions } from './regressions.js';
import { isolateValidationDatabase } from './isolated-db.js';
import { adapterFixtures, createBrowserFixtureDocument } from './adapter-fixtures.mjs';
import { CAPTURE_ADAPTER_VERSION } from '../domain/common.js';

const validationNamespace = new URLSearchParams(location.search).get('validationDb');
if (validationNamespace) isolateValidationDatabase(validationNamespace);
if (['legacyOPC', 'legacyOPC5'].some(key => new URLSearchParams(location.search).get(key) === '1')) await (await import('./opc-migration.js')).prepareOPCV4();
const captureFixtureKey = new URLSearchParams(location.search).get('captureFixture');
let syntheticSourceChanged = new URLSearchParams(location.search).get('sourceChanged') === '1';
if (new URLSearchParams(location.search).get('legacyV3') === '1') await (await import('./v1-storage-browser.js')).prepareV3MemoryBaseline();
async function captureSyntheticFixture(options = {}) {
  // Only an explicitly isolated test origin may synthesize a capture. This
  // bridge never ships and does not access a live ChatGPT/account/browser tab.
  if (!validationNamespace) throw new Error('采集合成样例必须指定独立的验证资料库。');
  const fixture = adapterFixtures.find(row => row.key === captureFixtureKey);
  if (!fixture || fixture.expectedError) throw new Error('请选择可识别的明确合成采集样例。');
  const frame = document.createElement('iframe'); frame.title = '隔离合成采集 DOM'; frame.style.cssText = 'position:absolute;left:-10000px;width:800px;height:500px'; document.body.append(frame);
  try {
    const fixtureDocument = createBrowserFixtureDocument(fixture, frame.contentDocument);
    const source = await (await fetch('/adapters/chatgpt.js', { cache: 'no-store' })).text();
    const load = new Function('location', 'document', 'getComputedStyle', 'Node', 'setTimeout', source + '\nreturn globalThis.__ACVN_CHATGPT__;');
    const adapter = load(new URL(fixture.url), fixtureDocument, frame.contentWindow.getComputedStyle.bind(frame.contentWindow), frame.contentWindow.Node, setTimeout);
    const result = await adapter.collect(options);
    if (!result.ok) { const error = new Error(result.reason); error.code = result.errorCode; error.diagnostics = result.diagnostics; throw error; }
    return createDraft({ kind: 'capture', filename: null, sourceTabId: null, conversations: [result.conversation] });
  } finally { frame.remove(); }
}

const listeners = new Set();
const changed = () => queueMicrotask(() => listeners.forEach(callback => callback({ event: 'changed' })));
const writes = new Set(['conversationManage','opcWrite','releaseWrite','opcEnsure','createProject','renameProject','editSegment','undo','moveConversation','deleteProject','discardDraft','organizationRules','organizationExport','organizationImport','organizationUpdate','organizationApply','organizationReject','organizationArchive','topicApply','labelMessageRole','memoryRestore','memoryImport','connectionSave','connectionArchive','documentRecipeSave','documentRecipeRename','documentRecipeArchive']);
const preferenceKey = key => validationNamespace ? `${validationNamespace}:${key}` : key;
const local = { async get(key) { return { [key]: JSON.parse(localStorage.getItem(preferenceKey(key)) ?? 'null') }; }, async set(values) { for (const [key, value] of Object.entries(values)) localStorage.setItem(preferenceKey(key), JSON.stringify(value)); } };
globalThis.chrome = {
  runtime: { getURL(path) { const url = new URL(path, location.origin); if (validationNamespace) url.searchParams.set('validationDb', validationNamespace); return url.href; }, onMessage: { addListener(fn) { listeners.add(fn); } }, async sendMessage(message) {
    try {
      const { type, args = {} } = message; let data;
      if (type === 'capture') {
        if (syntheticSourceChanged) { const error = new Error('来源标签已切换到另一条对话。'); error.code = 'source_changed'; error.diagnostics = { adapterVersion: CAPTURE_ADAPTER_VERSION, pageType: 'unknown', status: 'failed', counts: { messages: 0 }, errors: [{ code: 'source_changed' }] }; throw error; }
        if (captureFixtureKey) return { ok: true, data: await captureSyntheticFixture(args) };
        const error = new Error('隔离验证环境不连接真实 ChatGPT；此按钮需在安装后的扩展中体验。');
        error.code = 'access_denied'; error.diagnostics = { adapterVersion: CAPTURE_ADAPTER_VERSION, pageType: 'unknown', status: 'failed', counts: { messages: 0 }, errors: [{ code: 'access_denied' }] };
        throw error;
      }
      else if (type === 'captureSourceStatus') data = { available: Boolean(captureFixtureKey), tabId: 999, title: 'V1 明确合成的 ChatGPT 来源', url: adapterFixtures.find(row => row.key === captureFixtureKey)?.url, changed: syntheticSourceChanged };
      else if (type === 'captureSourceRebind') { if (args.expectedSourceUrl !== adapterFixtures.find(row => row.key === captureFixtureKey)?.url || args.sourceTabId !== 999) throw new Error('合成来源绑定不一致。'); syntheticSourceChanged = false; data = { rebound: true, tabId: 999 }; }
      else if (type === 'importPreview') data = await createDraft(await parseImport(args.text, args.filename));
      else if (type === 'saveDraft') { data = await saveDraft(args); changed(); }
      else if (type === 'openWorkspace') { window.open('/workspace.html', '_blank'); data = {}; }
      else { data = await command(type, args); if (writes.has(type)) changed(); }
      return { ok: true, data };
    } catch (error) { return { ok: false, error: error.message, errorCode: error.code ?? null, diagnostics: error.diagnostics ?? null }; }
  } }, storage: { local }, tabs: { async create({ url }) { window.open(url, '_blank'); return {}; } }
};

async function prepareLegacyDatabase() {
  const databases = await indexedDB.databases();
  if (databases.some(db => db.name === 'ai-conversation-visual-navigator')) return;
  const state = await (await fetch('/validation/v01-state.json')).json();
  if (new URLSearchParams(location.search).has('duplicate')) {
    state.segments[0].topicIds = [state.topics[0].id, state.topics[0].id];
    for (const snapshot of [...state.revisions[0].before, ...state.revisions[0].after]) snapshot.topicIds = [state.topics[0].id, state.topics[0].id];
  }
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('ai-conversation-visual-navigator', 1);
    request.onupgradeneeded = () => { for (const name of [...Object.keys(state).filter(name => name !== 'revision'), 'meta']) request.result.createObjectStore(name, { keyPath: 'id' }); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, names = [...Object.keys(state).filter(name => name !== 'revision'), 'meta'], tx = db.transaction(names, 'readwrite');
      for (const name of names) if (name !== 'meta') for (const row of state[name]) tx.objectStore(name).put(row);
      tx.objectStore('meta').put({ id: 'revision', value: state.revision });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = tx.onabort = () => reject(tx.error);
    };
  });
}
if (new URLSearchParams(location.search).has('legacy')) await prepareLegacyDatabase();

const banner = document.createElement('details'); banner.open = true; banner.style.cssText = 'padding:9px 14px;background:#fff7d6;border-bottom:1px solid #e1cc83;font:12px sans-serif;flex:none';
const validationSummary = document.createElement('summary'); validationSummary.style.cssText = 'cursor:pointer;margin-bottom:5px';
validationSummary.textContent = '验证环境 · 合成示例 / 扩展 API 本地桥接'; banner.append(validationSummary);
const run = document.createElement('button'); run.className = 'btn'; run.textContent = '运行 IndexedDB 集成验证';
const output = document.createElement('pre'); output.id = 'validation-result'; output.style.cssText = 'white-space:pre-wrap;max-height:180px;overflow:auto;font-size:11px';
const update = document.createElement('button'); update.className = 'btn'; update.textContent = '验证对话正文更新';
update.addEventListener('click', async () => {
  update.disabled = true;
  try {
    const state = await readState(), payload = fixturePayload();
    payload.conversations[0].messages.find(m => m.id === 'a-3').text += '\n浏览器验证追加正文：新的版本必须保留旧版本。';
    const draft = await createDraft(await parseImport(JSON.stringify(payload), 'validation-update-example.json'));
    await saveDraft({ draftId: draft.id, projectId: state.projects[0].id, indices: [0] });
    output.textContent = '正文更新已保存，检查旧建议过期与历史版本原文入口。'; changed();
  } catch (error) { output.textContent = error.message; }
  finally { update.disabled = false; }
});
banner.append(run, update, output); document.body.prepend(banner);
const regressions = document.createElement('button'); regressions.className = 'btn'; regressions.textContent = '运行新增回归验证';
regressions.addEventListener('click', async () => {
  regressions.disabled = true;
  try { output.textContent = JSON.stringify(await runBrowserRegressions(), null, 2); changed(); }
  catch (error) { output.textContent = error.stack; }
  finally { regressions.disabled = false; }
});
banner.insertBefore(regressions, output);
const v03Reader = document.createElement('button'); v03Reader.className = 'btn'; v03Reader.textContent = '运行 V0.3 正文浏览器验证';
v03Reader.addEventListener('click', async () => {
  v03Reader.disabled = true;
  try { output.textContent = JSON.stringify(await (await import('./v03-reader-browser.js')).runReaderBrowserValidation(), null, 2); changed(); }
  catch (error) { output.textContent = error.stack; }
  finally { v03Reader.disabled = false; }
});
banner.insertBefore(v03Reader, output);
const v04Navigation = document.createElement('button'); v04Navigation.className = 'btn'; v04Navigation.textContent = '运行 V0.4 导航浏览器验证';
v04Navigation.addEventListener('click', async () => {
  v04Navigation.disabled = true;
  try { output.textContent = JSON.stringify(await (await import('./v04-navigation-browser.js')).runV04BrowserValidation(), null, 2); changed(); }
  catch (error) { output.textContent = error.stack; }
  finally { v04Navigation.disabled = false; }
});
const v04Demo = document.createElement('button'); v04Demo.className = 'btn'; v04Demo.textContent = '创建 V0.4 界面示例项目';
v04Demo.addEventListener('click', async () => {
  v04Demo.disabled = true;
  try { output.textContent = JSON.stringify(await (await import('./v04-navigation-browser.js')).createV04Demo(), null, 2); changed(); }
  catch (error) { output.textContent = error.stack; }
  finally { v04Demo.disabled = false; }
});
banner.insertBefore(v04Navigation, output); banner.insertBefore(v04Demo, output);
const v06Layout = document.createElement('button'); v06Layout.id = 'run-v06-layout'; v06Layout.className = 'btn'; v06Layout.textContent = '运行 V0.6 弹窗布局验证';
v06Layout.addEventListener('click', async () => {
  v06Layout.disabled = true;
  try { output.textContent = JSON.stringify(await (await import('./v06-layout-browser.js')).runModalLayoutChecks(), null, 2); }
  catch (error) { output.textContent = error.stack; }
  finally { v06Layout.disabled = false; }
});
banner.insertBefore(v06Layout, output);
const v06Documents = document.createElement('button'); v06Documents.id = 'run-v06-documents'; v06Documents.className = 'btn'; v06Documents.textContent = '运行 V0.6 文档资料包验证';
v06Documents.addEventListener('click', async () => {
  v06Documents.disabled = true;
  try { output.textContent = JSON.stringify(await (await import('./v06-documents-browser.js')).runDocumentBrowserChecks(), null, 2); changed(); }
  catch (error) { output.textContent = error.stack; }
  finally { v06Documents.disabled = false; }
});
banner.insertBefore(v06Documents, output);
for (const [key, label, file, method] of [
  ['ui', '运行 V1 UI 验证', './v1-ui-browser.js', 'runV1UIChecks'],
  ['storage', '运行 V1 记忆验证', './v1-storage-browser.js', 'runV1MemoryChecks'],
  ['documents', '运行 V1 资料包验证', './v1-documents-browser.js', 'runV1DocumentChecks'],
  ['capture', '运行 V0.7 采集验证', './v07-capture-browser.js', 'runCaptureBrowserChecks'],
  ['workspace', '运行 V0.7 工作台验证', './v07-workspace-browser.js', 'runV07WorkspaceChecks'],
  ['map', '运行 V0.7 Q/A 模块验证', './v07-conversation-map-browser.js', 'runConversationMapChecks']
]) {
  const control = document.createElement('button'); control.id = `run-v07-${key}`; control.className = 'btn'; control.textContent = label;
  control.addEventListener('click', async () => {
    control.disabled = true; output.textContent = '';
    try { output.textContent = JSON.stringify(await (await import(file))[method](), null, 2); }
    catch (error) { output.textContent = error.stack; }
    finally { control.disabled = false; }
  });
  banner.insertBefore(control, output);
}
run.addEventListener('click', async () => {
  run.disabled = true; const passed = []; const expect = (value, label) => { if (!value) throw new Error(label); passed.push(label); };
  try {
    let state = await readState();
    expect(state.suggestions && state.analysisPacks, 'V0.1 IndexedDB 已升级并保留旧记录');
    expect(state.segments.some(s => s.title === 'V0.1 人工标题 · 必须保留'), '旧人工标题保留');
    expect(state.segments.every(s => new Set(s.topicIds).size === s.topicIds.length) && state.revisions.every(r => [...r.before,...r.after].every(s => new Set(s.topicIds).size === s.topicIds.length)), '旧重复主题及历史修订引用已兼容迁移');
    const project = state.projects[0], conversation = state.conversations[0], pathId = conversation.currentPathId;
    const sourceCount = state.messages.length;
    const first = await command('organizationRules', { conversationId: conversation.id, pathId });
    expect(first.status === 'pending', '规则建议先待确认');
    const edited = await command('organizationUpdate', { suggestionId: first.id, baseRevision: first.revision,
      groups: first.groups.map(g => ({ ...g, title: g.title + ' · 浏览器校验' })) });
    const beforeApply = await readState();
    const applied = await command('organizationApply', { suggestionId: edited.id, baseRevision: edited.revision, reviewManual: true });
    state = await readState();
    expect(state.messages.length === sourceCount && state.segments.some(s => s.id === applied.segmentId && s.active), '确认只更新导航，原文仍保留');
    const qaId = state.segments.find(s => s.id === applied.segmentId).qaIds[0];
    const qa = await command('qa', { qaId }); expect(qa.messages.length > 0 && qa.segment.id === applied.segmentId, '真实 QA 与地图成员联动');
    await command('undo', { projectId: project.id });
    state = await readState();
    expect(JSON.stringify(state.segments.filter(s => s.active).map(s => [s.id,s.title,s.qaIds,s.topicIds])) === JSON.stringify(beforeApply.segments.filter(s => s.active).map(s => [s.id,s.title,s.qaIds,s.topicIds])), '整次整理可撤销');
    const rejected = await command('organizationRules', { conversationId: conversation.id, pathId });
    await command('organizationReject', { suggestionId: rejected.id, baseRevision: rejected.revision });
    expect((await command('organizationSuggestion', { suggestionId: rejected.id })).status === 'rejected', '拒绝建议持久保存');
    const malformed = await command('organizationRules', { conversationId: conversation.id, pathId });
    const original = await readState(); let failed = false;
    try { await command('organizationUpdate', { suggestionId: malformed.id, baseRevision: malformed.revision, groups: [{ ...malformed.groups[0], qaIds: ['missing-qa'] }] }); } catch { failed = true; }
    expect(failed && JSON.stringify(await readState()) === JSON.stringify(original), '错误引用失败且事务未改变原数据');
    const backup = await command('backup', { projectId: project.id });
    const draft = await createDraft({ kind: 'backup', filename: 'browser-verification-backup.json', payload: backup });
    const restored = await saveDraft({ draftId: draft.id });
    const view = await command('view', { projectId: restored.projectId });
    expect(view.conversations.length === 2 && view.segments.some(s => s.title === 'V0.1 人工标题 · 必须保留'), 'V0.2 备份恢复保留原文与人工调整');
    const search = await command('search', { projectId: project.id, query: '稳定引用' }); expect(search.results.some(r => r.qaId && r.messageId), '多对话搜索保留真实引用');
    const report = { passed: passed.length, checks: passed, environment: 'Chromium in-app browser + actual IndexedDB; Chrome APIs locally bridged', checkedAt: new Date().toISOString() };
    globalThis.__ACVN_VALIDATION_REPORT = report; output.textContent = JSON.stringify(report, null, 2); changed();
  } catch (error) { output.textContent = `失败（已通过 ${passed.length} 项）：${error.stack}`; }
  finally { run.disabled = false; }
});
if (new URLSearchParams(location.search).get('opcPreview') === '1' && validationNamespace?.startsWith('v04-opc-')) {
  banner.hidden = true;
  const project = (await command('projects')).find(p => p.name === 'OPC 验收 · 合成数据');
  if (project) await local.set({ navigatorSelection: { projectId: project.id, conversationMode: 'timeline', opcVersion: 1 } });
}
if(validationNamespace?.startsWith('v04-ux-')){
  banner.hidden=true;
  document.addEventListener('wheel',event=>{const viewport=event.target.closest?.('.ht-scroll');if(viewport)viewport.dataset.validationWheel=JSON.stringify({deltaX:event.deltaX,deltaY:event.deltaY,shiftKey:event.shiftKey});},{capture:true,passive:true});
}
await import('../ui/app.js');
if (validationNamespace?.startsWith('v04-opc-')) await import('./opc-browser.js');
