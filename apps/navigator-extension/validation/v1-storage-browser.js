// Validation only. Synthetic V0.7 rows are seeded in an explicitly isolated
// database before the real V1 UI opens it. Never included in a release.
import { STORES, readState, snapshotSummary, memoryMetadata } from '../storage/database.js';
import { createProject, saveConversation } from '../domain/captures.js';
import { parseImport } from '../importers/json.js';
import { command } from '../storage/repository.js';
import { exportProject, validateBackup } from '../domain/backup.js';
import { MemoryPanel } from '../ui/memory.js';

const OLD_STORES = STORES.filter(name => !['documentRecipes', 'documentPrints', 'conversationLinks'].includes(name));
const guard = () => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || !/^v04-v1-[a-z0-9-]+$/.test(new URLSearchParams(location.search).get('validationDb') ?? '')) throw new Error('V1升级验证必须使用明确隔离的本地 v04-v1-* 资料库。');
};
export async function prepareV3MemoryBaseline() {
  guard();
  const namespace = new URLSearchParams(location.search).get('validationDb');
  if ((await indexedDB.databases()).some(db => ['ai-conversation-visual-navigator', `acvn-validation-${namespace}`].includes(db.name))) return;
  const state = { ...Object.fromEntries(STORES.map(name => [name, []])), revision: 7 }, project = createProject(state, 'V0.7 原资料 · 明确合成升级样例');
  const imported = await parseImport(JSON.stringify({ provider: 'v1-migration-labelled-synthetic', conversations: [{ id: 'v1-old-conversation', title: '升级前完整 Q/A · 合成', messages: [
    { id: 'old-q', role: 'user', text: '升级后，我的问题和 GPT 回答仍要保留。' }, { id: 'old-a', role: 'assistant', text: '完整旧回答。\n```js\nconst retained = true;\n```\nV1-MIGRATION-ANSWER-END' }
  ] }] }), 'v1-migration-synthetic.json');
  await saveConversation(state, imported.conversations[0], project.id);
  const before = structuredClone(state);
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('ai-conversation-visual-navigator', 3);
    req.onupgradeneeded = () => { for (const name of [...OLD_STORES, 'snapshotSummaries', 'meta']) req.result.createObjectStore(name, { keyPath: 'id' }); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { const db = req.result; if (db.name !== `acvn-validation-${namespace}`) { db.close(); reject(new Error('升级验证数据库没有隔离。')); return; }
      const tx = db.transaction([...OLD_STORES, 'snapshotSummaries', 'meta'], 'readwrite');
      for (const name of OLD_STORES) for (const row of state[name]) tx.objectStore(name).put(row);
      for (const row of state.snapshots) tx.objectStore('snapshotSummaries').put(snapshotSummary(row));
      tx.objectStore('meta').put({ id: 'revision', value: state.revision }); tx.objectStore('meta').put({ id: 'appVersion', value: '0.7.0' });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = tx.onabort = () => reject(tx.error);
    };
  });
  sessionStorage.setItem(`v1-baseline:${namespace}`, JSON.stringify(before));
}
export async function runV1MemoryChecks() {
  const checks = [], failures = [], check = async (name, run) => { try { await run(); checks.push(name); } catch (error) { failures.push({ name, error: error.message }); } };
  const expect = (condition, reason) => { if (!condition) throw new Error(reason); };
  await check('记忆升级验证仅允许明确隔离的本地资料库', guard);
  if (failures.length) return { passed: 0, failed: failures.length, failures };
  const namespace = new URLSearchParams(location.search).get('validationDb'), before = JSON.parse(sessionStorage.getItem(`v1-baseline:${namespace}`) ?? 'null');
  let status, exported, created;
  await check('真实V3升级到V4且此前所有业务行逐字段保持', async () => {
    expect(before, '缺少升级前合成资料，请用全新namespace及legacyV3=1打开。');
    await command('memoryInitialize', {}); const metadata = await memoryMetadata(), state = await readState();
    expect(metadata.databaseVersion === 4 && metadata.appVersion === '1.0.0', '数据库或应用版本没有正确升级。');
    const ordered = rows => JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)));
    for (const name of OLD_STORES) expect(ordered(state[name]) === ordered(before[name]), `升级修改了原${name}记录。`);
  });
  await check('升级前自动恢复点包含完整问答与旧正文版本', async () => {
    status = await command('memoryStatus', {}); expect(status.points.some(row => row.reason === 'version_upgrade' && row.fromVersion === '0.7.0'), '未建立升级前恢复点。');
    exported = await command('memoryExport', {}); expect(exported.projects[0].records.messages.some(row => row.text.includes('V1-MIGRATION-ANSWER-END')), '备份丢失旧回答尾部。'); exported.projects.forEach(validateBackup);
  });
  await check('重复打开新版不会删除旧资料或重复建立升级恢复点', async () => {
    const a = await readState(), count = status.points.length; await command('memoryInitialize', {}); const b = await readState();
    expect(JSON.stringify(a) === JSON.stringify(b), '初始化改变了业务资料。'); expect((await command('memoryStatus', {})).points.length === count, '重复建立同版升级恢复点。');
  });
  await check('手动恢复点不改变任何业务行或既有版本', async () => {
    const a = await readState(); created = await command('memoryCreate', { name: 'V1 手动恢复点 · 合成' }); const b = await readState();
    expect(JSON.stringify(a) === JSON.stringify(b) && created.messageCount === 2, '建立恢复点改变了原资料。');
  });
  await check('恢复点恢复为独立项目，原项目和旧版本仍保留', async () => {
    const result = await command('memoryRestore', { pointId: created.id, expectedChecksum: created.checksum }), state = await readState();
    expect(result.projectIds.length === 1 && result.projectIds[0] !== before.projects[0].id, '恢复覆盖了原项目。');
    expect(state.messages.filter(row => row.text.includes('V1-MIGRATION-ANSWER-END')).length === 2, '恢复没有完整保留原文副本。');
    for (const project of state.projects) validateBackup(exportProject(state, project.id));
  });
  await check('旧恢复点校验码与损坏资料库备份安全拒绝', async () => {
    const a = await readState(); let rejected = 0;
    try { await command('memoryRestore', { pointId: created.id, expectedChecksum: 'wrong' }); } catch { rejected++; }
    const damaged = structuredClone(exported); damaged.projects[0].records.messages[0].text += 'BAD';
    try { await command('memoryImport', { text: JSON.stringify(damaged) }); } catch { rejected++; }
    expect(rejected === 2 && JSON.stringify(a) === JSON.stringify(await readState()), '错误恢复请求改变了当前资料。');
  });
  await check('资料库外部备份预览与恢复保持原项目，不依赖扩展ID', async () => {
    const preview = await command('memoryImportPreview', { text: JSON.stringify(exported) }); expect(preview.messages === 2 && preview.projects === 1, '资料库备份预览数量错误。');
    const result = await command('memoryImport', { text: JSON.stringify(exported) }), state = await readState(); expect(result.projectIds.length === 1 && state.projects.length === 3, '资料库导入覆盖旧项目。');
  });
  await check('整理建议归档与恢复不改变原文，旧revision操作拒绝', async () => {
    const baseline = await readState(), conversation = baseline.conversations.find(row => row.projectId === before.projects[0].id);
    const suggestion = await command('organizationRules', { conversationId: conversation.id, pathId: conversation.currentPathId });
    const archived = await command('organizationArchive', { projectId: conversation.projectId, suggestionId: suggestion.id, expectedRevision: suggestion.revision });
    expect(archived.archived && (await command('organizationArchiveList', {})).some(row => row.id === suggestion.id && row.archivedAt), '归档没有保留可恢复记录。');
    let rejected = false; try { await command('organizationArchive', { projectId: conversation.projectId, suggestionId: suggestion.id, expectedRevision: suggestion.revision, archived: false }); } catch { rejected = true; }
    expect(rejected, '过期的建议归档revision没有拒绝。');
    const current = (await readState()).suggestions.find(row => row.id === suggestion.id);
    await command('organizationArchive', { projectId: conversation.projectId, suggestionId: suggestion.id, expectedRevision: current.revision, archived: false });
    expect(JSON.stringify((await readState()).messages) === JSON.stringify(baseline.messages), '归档改变了原文。');
  });
  await check('关闭后旧恢复请求不会关闭重新打开的记忆窗口或切换项目', async () => {
    let completeOld, restored = 0;
    const delayed = new Promise(resolve => { completeOld = resolve; });
    const panel = new MemoryPanel({ api: async type => type === 'memoryStatus' ? { projects: 1, conversations: 1, messages: 2, versions: 2,
      points: [{ id: 'synthetic-point', name: '合成异步窗口测试', createdAt: new Date().toISOString(), projectCount: 1, messageCount: 2, checksum: 'synthetic' }] } : type === 'organizationArchiveList' ? [] : delayed, onRestored: () => { restored++; } });
    try {
      await panel.open(); [...panel.dialog.querySelectorAll('button')].find(node => node.textContent === '恢复为新项目').click();
      panel.close(); await panel.open(); const current = panel.dialog; completeOld({ projectIds: ['synthetic-old'] });
      await new Promise(resolve => setTimeout(resolve, 20)); expect(current.open && panel.dialog === current && restored === 0, '旧恢复响应干扰了新的窗口。');
    } finally { panel.close(); }
  });
  return { version: '1.0.0', checkedAt: new Date().toISOString(), passed: checks.length, failed: failures.length, checks, failures,
    scope: 'Actual IndexedDB V3→V4 migration, real memory repository, complete synthetic old Q/A and immutable versions; explicit isolated localhost database. No live user data.' };
}
