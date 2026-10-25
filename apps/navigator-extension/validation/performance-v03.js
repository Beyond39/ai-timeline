// Explicitly isolated, synthetic actual-IndexedDB validation. Excluded from MV3 package.
import { command, createDraft, saveDraft } from '../storage/repository.js';
import { parseImport } from '../importers/json.js';
import { resetReadMetrics, getReadMetrics, setReadMetricsEnabled, snapshotSummary } from '../storage/database.js';
import { validateBackup } from '../domain/backup.js';
import { command as oldCommand } from './baseline-v021/storage/repository.js';

const expect = (value, message) => { if (!value) throw new Error(message); };
const lastMetric = operation => getReadMetrics().filter(row => row.operation === operation).at(-1);
const bytes = value => new TextEncoder().encode(JSON.stringify(value) ?? '').length;
const totals = trace => Object.values(trace.stores).reduce((sum, row) => ({ loadedRecords: sum.loadedRecords + row.loadedRecords,
  serializedBytes: sum.serializedBytes + row.serializedBytes, retainedRecords: sum.retainedRecords + row.retainedRecords, retainedBytes: sum.retainedBytes + row.retainedBytes }),
  { loadedRecords: 0, serializedBytes: 0, retainedRecords: 0, retainedBytes: 0 });
function scopeIsolated(trace, projectId) { return trace.fullStateReads === 0 && trace.projectIds.every(key => key === projectId); }
export async function runV03StorageValidation() {
  setReadMetricsEnabled(true);
  expect(location.hostname === '127.0.0.1', 'Validation is only allowed on the explicitly isolated localhost origin.');
  const checks = [], failures = [], temporary = [];
  const check = async (name, run) => { try { await run(); checks.push(name); } catch (error) { failures.push({ name, error: error.stack ?? error.message }); } };
  let first, unrelated, saved, conversation, pathId, qas, suggestion, oldVersionId, oldText;
  const payload = suffix => ({ provider: 'v03-storage-synthetic', conversations: [{ id: 'storage-' + suffix, title: '范围读取 · 合成示例', messages: [
    { id: 'q-1', role: 'user', text: '第一问 benchmark-case Ｆｏｏ e\u0301 ﬀ' },
    { id: 'a-1', role: 'assistant', text: '完整长回答 benchmark-case\n' + '仅供隔离验证的可读正文。'.repeat(400) },
    { id: 'q-2', role: 'user', text: '第二问 benchmark-case' },
    { id: 'a-2', role: 'assistant', text: '第二条回答 benchmark-case' },
    { id: 'q-3', role: 'user', text: '没有回答 benchmark-case' }
  ] }] });
  const save = async (projectId, input) => { const draft = await createDraft(await parseImport(JSON.stringify(input), 'storage-v03-example.json')); return saveDraft({ draftId: draft.id, projectId }); };
  await check('范围读取准备：多项目、长正文、未回答真实Q/A', async () => {
    first = await command('createProject', { name: 'V0.3范围回归（合成隔离样例）' }); temporary.push(first);
    unrelated = await command('createProject', { name: 'V0.3无关项目（合成隔离样例）' }); temporary.push(unrelated);
    saved = await save(first.id, payload('target-' + first.id)); await save(unrelated.id, payload('unrelated-' + unrelated.id));
    const view = await command('view', { projectId: first.id }); conversation = view.conversations[0]; pathId = conversation.currentPathId;
    qas = view.qas.slice().sort((a,b) => a.ordinal-b.ordinal); expect(qas.length === 3 && qas[2].status === 'unanswered', '未回答问题或完整轮次缺失');
    await command('organizationExport', { conversationId: conversation.id, pathId });
    suggestion = await command('organizationRules', { conversationId: conversation.id, pathId });
  });
  await check('地图仅项目导航摘要，无正文、整理包和历史证据副本', async () => {
    resetReadMetrics(); const view = await command('view', { projectId: first.id }), trace = lastMetric('view');
    expect(scopeIsolated(trace, first.id), '地图读取了其他项目或整库');
    expect(!trace.stores.analysisPacks && !trace.stores.snapshots, '地图加载了完整整理包/采集快照');
    expect(!view.suggestions[0].groups && !view.suggestions[0].beforeSegments && view.suggestions[0].groupCount > 0, '地图重复保存建议详情');
    expect(!view.messages && !view.versions, '地图返回了全部原文正文');
  });
  await check('单轮仅相关消息/当前版本，长正文完整且不读取snapshot', async () => {
    resetReadMetrics(); const result = await command('qa', { qaId: qas[0].id }), trace = lastMetric('qa');
    expect(scopeIsolated(trace, first.id), '单轮读取了无关项目或整库');
    expect(result.messages[1].text === payload('x').conversations[0].messages[1].text, '长正文被截断');
    expect(trace.stores.messages.loadedRecords === 2 && trace.stores.versions.loadedRecords === 2 && !trace.stores.snapshots && !trace.stores.analysisPacks, '单轮加载了不相关正文/快照/整理包');
    oldVersionId = result.messages[1].currentVersionId; oldText = result.messages[1].text;
  });
  await check('完整对话分页只读取该页面消息正文，无遗漏', async () => {
    const seen = []; let offset = 0;
    do { resetReadMetrics(); const page = await command('conversation', { conversationId: conversation.id, pathId, offset, limit: 2 });
      const trace = lastMetric('conversation'); expect(scopeIsolated(trace, first.id) && trace.stores.messages.loadedRecords === page.messages.length, '分页读取了整个对话正文');
      seen.push(...page.messages.map(message => message.id)); offset = page.nextOffset;
    } while (offset !== null);
    expect(seen.length === 5 && new Set(seen).size === 5, '分页遗漏或重复消息');
  });
  await check('Unicode搜索分页保留总数和原文命中、其余结果不遗漏', async () => {
    const seen = []; let offset = 0;
    do { resetReadMetrics(); const page = await command('search', { projectId: first.id, query: 'benchmark-case', offset, limit: 2 }), trace = lastMetric('search');
      expect(scopeIsolated(trace, first.id) && trace.stores.messages.retainedRecords === 0, '搜索加载了其他项目或积累全部正文');
      expect(page.total === 5 && page.results.every(row => row.excerpt.includes('benchmark-case')), '分页数量/Unicode原文摘要不正确');
      seen.push(...page.results.map(row => row.messageId)); offset = page.nextOffset;
    } while (offset !== null);
    expect(seen.length === 5 && new Set(seen).size === 5, '搜索分页遗漏或重复');
    expect((await command('search', { projectId: first.id, query: 'foo' })).results[0].excerpt.includes('Ｆｏｏ'), '全角字符搜索未映回原文');
    expect((await command('search', { projectId: first.id, query: 'é' })).total > 0, '组合字符搜索丢失');
  });
  await check('读取后的更新即时使建议过期，当前正文与历史版本分离', async () => {
    expect(!(await command('organizationSuggestion', { suggestionId: suggestion.id })).stale, '新建议已错误过期');
    const updated = payload('target-' + first.id); updated.conversations[0].messages[1].text += '\n后续正文版本'; await save(first.id, updated);
    expect((await command('organizationSuggestion', { suggestionId: suggestion.id })).stale, '读取缓存掩盖了更新后的过期');
    let rejected = false; try { await command('organizationApply', { suggestionId: suggestion.id, baseRevision: suggestion.revision, reviewManual: true }); } catch { rejected = true; }
    expect(rejected, '过期建议仍被采用');
    const current = await command('qa', { qaId: qas[0].id }), message = current.messages[1];
    expect(message.versionCount === 2 && message.versions.length === 1 && message.text.endsWith('后续正文版本'), '单轮未只加载当前版本');
    const versions = await command('messageVersions', { messageId: message.id }); expect(versions.versions.some(version => version.id === oldVersionId && version.text === oldText), '历史正文丢失');
    const history = await command('conversation', { conversationId: conversation.id, pathId, targetMessageId: message.id, targetVersionId: oldVersionId, limit: 2 });
    expect(history.messages.find(item => item.id === message.id).versions.some(version => version.id === oldVersionId && version.text === oldText), '确切引用版本定位失败');
  });
  await check('建议详情只读所属对话和来源投影，不读取全部整理包', async () => {
    resetReadMetrics(); await command('organizationSuggestion', { suggestionId: suggestion.id }); const trace = lastMetric('organizationSuggestion');
    expect(scopeIsolated(trace, first.id) && !trace.stores.analysisPacks && !trace.stores.snapshots, '建议详情加载了整库/快照/整理包');
    expect(trace.stores.suggestions.loadedRecords === 1 && trace.stores.versions.bodyRecords === 5, '没有按单建议和当前引用读取');
  });
  await check('项目备份仅该项目，历史证据版本可校验恢复', async () => {
    resetReadMetrics(); const backup = await command('backup', { projectId: first.id }), trace = lastMetric('backup'); validateBackup(backup);
    expect(scopeIsolated(trace, first.id) && backup.records.conversations.length === 1, '备份读取了其他项目');
    const draft = await createDraft({ kind: 'backup', filename: 'storage-v03-backup-example.json', payload: backup }); const restored = await saveDraft({ draftId: draft.id });
    const restoredProject = (await command('projects')).find(project => project.id === restored.projectId); temporary.push(restoredProject);
    const view = await command('view', { projectId: restored.projectId }); expect(view.qas.length === 3 && view.suggestions.some(row => row.stale), '备份恢复与过期状态不正确');
  });
  await check('重开预览保留分享来源到可靠对话ID的消息身份提升依据', async () => {
    const bundle = await parseImport(JSON.stringify(payload('shared-' + first.id)), 'promotion-v03-example.json');
    const input = bundle.conversations[0]; input.platform = 'chatgpt'; input.method = 'chatgpt-dom-synthetic-validation'; input.sourceConversationId = null; input.sourceUrl = `https://chatgpt.com/share/${first.id}`;
    input.identityBasis = 'source_url_fallback'; input.fallbackKey = null;
    const initial = await createDraft({ kind: 'capture', conversations: [input] });
    const savedShare = await saveDraft({ draftId: initial.id, projectId: first.id });
    const promoted = structuredClone(input); promoted.sourceConversationId = `reliable-fixture-${first.id}`; promoted.sourceUrl = `https://chatgpt.com/c/${promoted.sourceConversationId}`;
    const preview = await createDraft({ kind: 'capture', conversations: [promoted] });
    expect(preview.conversations[0].existing?.id === savedShare.results[0].conversationId, '首次预览没有找到有可靠消息证据的旧分享对话');
    const reopened = await command('latestDraft', {});
    expect(reopened.id === preview.id && reopened.conversations[0].existing?.id === preview.conversations[0].existing.id && reopened.conversations[0].existing.savedMessages === 5, '范围重开预览丢失身份提升依据或计数');
    await command('discardDraft', { draftId: preview.id });
  });
  for (const project of temporary.filter(Boolean)) await command('deleteProject', { projectId: project.id, confirmName: project.name });
  const report = { checkedAt: new Date().toISOString(), passed: checks.length, failed: failures.length, checks, failures,
    isolatedDatabase: globalThis.__ACVN_VALIDATION_DATABASE ?? 'provided by the validation host',
    environment: 'Actual IndexedDB on an explicitly isolated localhost Chromium origin; no MV3 permissions or real-account access.' };
  globalThis.__ACVN_V03_STORAGE_REPORT = report; return report;
}

function semantic(type, value) {
  if (type === 'view') return { project: value.project.id, conversations: value.conversations.map(row => row.id), paths: value.paths.map(row => [row.id,row.messageIds]),
    qas: value.qas.map(row => [row.id,row.status]), segments: value.segments.map(row => [row.id,row.title,row.qaIds,row.topicIds,row.active,row.pendingSuggestionIds,row.suggestionNeedsReview]),
    suggestions: value.suggestions.map(row => [row.id,row.status,row.stale,row.staleReason]), topics: value.topics, undoAvailable: value.undoAvailable };
  if (type === 'qa') return { qa: value.qa, conversation: value.conversation.id, path: value.path.id, segment: value.segment.id,
    messages: value.messages.map(message => [message.id,message.text,message.currentVersionId,message.versions.find(version => version.id === message.currentVersionId)?.text]) };
  if (type === 'search') return { results: value.results, total: value.total, nextOffset: value.nextOffset };
  return value;
}
async function baselineMeasure(type, args) {
  const trace = { operation: type, fullStateReads: 0, stores: {}, projectIds: new Set(), scopes: [] };
  const prototype = IDBObjectStore.prototype, original = prototype.getAll;
  prototype.getAll = function(...parameters) {
    const store = this.name, req = original.apply(this, parameters);
    if (store === 'projects') trace.fullStateReads++;
    req.addEventListener('success', () => { const rows = req.result, stat = trace.stores[store] ??= { loadedRecords: 0, serializedBytes: 0, retainedRecords: 0, retainedBytes: 0, bodyRecords: 0 };
      for (const row of rows) { stat.loadedRecords++; stat.serializedBytes += bytes(row); stat.retainedRecords++; stat.retainedBytes += bytes(row); if (row.projectId) trace.projectIds.add(row.projectId); if (typeof row.text === 'string' || row.rawSource != null || row.batches) stat.bodyRecords++; } });
    return req;
  };
  const start = performance.now();
  try { const value = await oldCommand(type, args); trace.elapsedMs = performance.now()-start; return { value, trace: { ...trace, projectIds: [...trace.projectIds] } }; }
  finally { prototype.getAll = original; }
}
const statistics = values => { const ordered = values.slice().sort((a,b) => a-b), sum = values.reduce((a,b) => a+b,0); return { repeats: values.length, minMs: ordered[0], medianMs: ordered[Math.floor(ordered.length/2)], maxMs: ordered.at(-1), meanMs: sum/values.length, observationsMs: values }; };
export async function runV03Performance(onProgress = () => {}) {
  expect(location.hostname === '127.0.0.1' && location.port === '8939', 'Performance must run on dedicated isolated port 8939, separate from UI validation.');
  expect(globalThis.__ACVN_VALIDATION_DATABASE === 'acvn-validation-v03-performance-final', 'Performance requires the explicit synthetic validation database namespace before any fixture writes.');
  onProgress('加载明确标记的500/2000轮及无关项目合成样例');
  setReadMetricsEnabled(true); await command('projects');
  const fixture = await (await fetch('/validation/performance-v03-fixture.json')).json();
  const db = await new Promise((resolve,reject) => { const req = indexedDB.open('ai-conversation-visual-navigator',3); req.onerror = () => reject(req.error); req.onsuccess = () => resolve(req.result); req.onupgradeneeded = () => { throw new Error('请先在该隔离来源调用一次product command("projects")初始化真实数据库。'); }; });
  expect(db.name === 'acvn-validation-v03-performance-final', 'Refusing fixture clear outside the verified synthetic database.');
  await new Promise((resolve,reject) => { const names = [...db.objectStoreNames], tx = db.transaction(names,'readwrite'); for (const name of names) { const store = tx.objectStore(name); store.clear(); if (name === 'snapshotSummaries') for (const row of fixture.state.snapshots) store.put(snapshotSummary(row)); else if (name !== 'meta') for (const row of fixture.state[name] ?? []) store.put(row); }
    tx.objectStore('meta').put({ id: 'revision', value: fixture.state.revision }); tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error); }); db.close();
  const rows = [], correctness = [], repeats = 5;
  for (const selected of fixture.cases) for (const [type,args,label] of [
    ['view',{ projectId: selected.projectId },'打开项目地图'], ['qa',{ qaId: selected.qaId },'读取单轮'],
    ['search',{ projectId: selected.projectId, query: 'benchmark-hit', offset: 35, limit: 35 },'分页全文搜索'],
    ['organizationSuggestion',{ suggestionId: selected.suggestionId },'重复读取建议'] ]) {
    onProgress(`${selected.rounds}轮 · ${label}：预热与${repeats}次配对测量`);
    const oldWarm = await oldCommand(type,args), newWarm = await command(type,args);
    expect(JSON.stringify(semantic(type,oldWarm)) === JSON.stringify(semantic(type,newWarm)), `${selected.rounds}轮 ${type}改造前后结果不一致`); correctness.push(`${selected.rounds}轮 ${label}结果一致`);
    const before = [], after = [];
    setReadMetricsEnabled(false);
    for (let repeat = 0; repeat < repeats; repeat++) {
      // Alternate order to avoid attributing only a warm filesystem/IDB cache to one implementation.
      const runOld = async () => { const start = performance.now(); await oldCommand(type,args); before.push(performance.now()-start); };
      const runNew = async () => { const start = performance.now(); await command(type,args); after.push(performance.now()-start); };
      if (repeat % 2) { await runNew(); await runOld(); } else { await runOld(); await runNew(); }
    }
    // One separate instrumented run observes actual materialized/retained rows.
    // Byte serialization is excluded from the five timing observations above.
    const firstOld = (await baselineMeasure(type,args)).trace;
    setReadMetricsEnabled(true); resetReadMetrics(); await command(type,args); const firstNew = lastMetric(type);
    expect(scopeIsolated(firstNew,selected.projectId), `${type}载入无关项目或整库`);
    if (type === 'qa') expect(firstNew.stores.messages.loadedRecords === 2 && firstNew.stores.versions.loadedRecords === 2 && !firstNew.stores.snapshots, '单轮读取超出当前两条消息/版本');
    rows.push({ rounds: selected.rounds, operation: type, label, before: statistics(before), after: statistics(after),
      baselineRead: { ...totals(firstOld), fullStateReads: firstOld.fullStateReads, projectIds: firstOld.projectIds, stores: firstOld.stores },
      scopedRead: { ...totals(firstNew), fullStateReads: firstNew.fullStateReads, projectIds: firstNew.projectIds, stores: firstNew.stores, scopes: firstNew.scopes }, resultSignatureMatched: true });
  }
  const report = { measuredAt: new Date().toISOString(), fixture: { synthetic: true, ...fixture.scales, serializedStateBytes: bytes(fixture.state) },
    environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGiB: navigator.deviceMemory ?? null, origin: location.origin,
      isolatedDatabase: db.name, databaseMapping: 'Validation-only wrapper maps the canonical product name to this explicit synthetic namespace for both preserved V0.2.1 and V0.3 modules.',
      storage: 'Real IndexedDB; shared initialized V3 synthetic database; same fixture and IDs for both versions' },
    baseline: 'Preserved V0.2.1 code, with ONLY database open version 2->3 for same-origin compatibility. All read algorithms unchanged.',
    measurement: 'One warmup per variant, five paired timing runs alternating order with byte instrumentation disabled. Includes repository, actual IDB and signature computation; excludes UI layout, MV3 permissions, network and fixture preparation. Separate instrumented runs count full materialized cursor/getAll values; retained bytes count projections kept by the DB layer (search result excerpts excluded).',
    rows, correctness, limitations: ['Writes still use full readState + atomic global revision commit.', 'Snapshot/suggestion cursor projections still materialize whole indexed rows before dropping unused fields.', 'Search scans current project text for each requested offset page to maintain exact total and deterministic ordering.', 'Does not represent real ChatGPT DOM or extension lifecycle.'] };
  setReadMetricsEnabled(false); globalThis.__ACVN_V03_PERFORMANCE_REPORT = report; onProgress('实际IndexedDB性能与结果一致性检查完成'); return report;
}
