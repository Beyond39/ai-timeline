import { STORES, snapshotSummary } from '../storage/database.js';
import { OPC_STORES, opcMutation } from '../domain/opc.js';
import { createProject, saveConversation } from '../domain/captures.js';
import { parseImport } from '../importers/json.js';

export async function prepareOPCV4() {
  const withAnnotations = new URLSearchParams(location.search).get('legacyOPC5') === '1';
  const namespace = new URLSearchParams(location.search).get('validationDb');
  if (!/^v04-opc-migration[a-z0-9-]*$/.test(namespace ?? '')) throw new Error('迁移验收必须使用隔离资料库。');
  if ((await indexedDB.databases()).length) return;
  const state = { ...Object.fromEntries(STORES.map(s => [s, []])), revision: 7 }, project = createProject(state, withAnnotations ? '旧版 V5 标注升级验收' : '旧版 V4 升级验收');
  const bundle = await parseImport(JSON.stringify({ provider: 'opc-migration', conversations: [{ id: 'old', title: '旧版对话', messages: [
    { id: 'q', role: 'user', text: '旧问题时间缺失' }, { id: 'analysis', role: 'assistant', channel: 'analysis', text: '旧内部分析' }, { id: 'a', role: 'assistant', text: '# 旧答案\n\n完整正文保留 MIGRATION-END' },
    ...(withAnnotations ? [{ id: 'q2', role: 'user', text: '另一张旧卡片' }, { id: 'a2', role: 'assistant', text: '旧回答' }] : [])
  ] }] }), 'opc-migration.json'); await saveConversation(state, bundle.conversations[0], project.id);
  for (const m of state.messages) { delete m.channel; delete m.recipient; delete m.readingVisibility; }
  if (withAnnotations) {
    const card = state.qaCards[0], target = state.qaCards[1];
    opcMutation(state, 'metadata', { projectId: project.id, cardId: card.id, title: '旧人工标题', tags: ['旧标签'], notes: '旧备注' });
    const theme = opcMutation(state, 'timeline', { projectId: project.id, name: '旧主题线' });
    opcMutation(state, 'membership', { projectId: project.id, timelineId: theme.id, cardIds: [card.id] });
    opcMutation(state, 'relationship', { projectId: project.id, fromCardId: card.id, toCardId: target.id, type: '引用', directed: true, description: '旧关系说明' });
    opcMutation(state, 'layout', { projectId: project.id, positions: { [card.id]: { x: 321, y: 123 } }, viewport: { x: 15, y: 25, zoom: .75 } });
    for (const c of state.qaCards) delete c.projectionVersion;
    for (const name of ['qaMetadata', 'timelines', 'relationships', 'canvasLayouts']) for (const row of state[name]) delete row.revision;
    localStorage.setItem(`${namespace}:opcMigrationIdentity`, JSON.stringify({ cardId: card.id, themeId: theme.id, relationshipId: state.relationships[0].id }));
  }
  const stores = withAnnotations ? STORES : STORES.filter(s => !OPC_STORES.includes(s));
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('ai-conversation-visual-navigator', withAnnotations ? 5 : 4);
    req.onupgradeneeded = () => { for (const s of [...stores, 'snapshotSummaries', 'meta']) req.result.createObjectStore(s, { keyPath: 'id' }); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      if (db.name !== `acvn-validation-${namespace}`) { db.close(); reject(new Error('隔离失败')); return; }
      const tx = db.transaction([...stores, 'snapshotSummaries', 'meta'], 'readwrite');
      for (const s of stores) for (const row of state[s]) tx.objectStore(s).put(row);
      for (const row of state.snapshots) tx.objectStore('snapshotSummaries').put(snapshotSummary(row));
      tx.objectStore('meta').put({ id: 'revision', value: 7 }); tx.objectStore('meta').put({ id: 'appVersion', value: withAnnotations ? '1.2.0' : '1.1.0' });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  });
}
