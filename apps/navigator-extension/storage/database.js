import { RELEASE_STORES } from '../domain/release-data.js';
export const STORES = ['projectWorkspaces', 'projects', 'conversations', 'messages', 'versions', 'snapshots', 'paths', 'qas', 'segments', 'topics', 'revisions', 'drafts', 'suggestions', 'analysisPacks', 'documentRecipes', 'documentPrints', 'conversationLinks', 'qaCards', 'qaMetadata', 'timelines', 'memberships', 'relationships', 'canvasLayouts', 'relationTypes', 'qaRepairArchives', ...RELEASE_STORES];
const DATABASE = 'ai-conversation-visual-navigator';
let connectionPromise;
const metricHistory = [];
let metricsEnabled = false;
export function setReadMetricsEnabled(value) { metricsEnabled = Boolean(value); }
const bytes = value => new TextEncoder().encode(JSON.stringify(value) ?? '').byteLength;
export function resetReadMetrics() { metricHistory.length = 0; }
export function getReadMetrics() { return structuredClone(metricHistory); }
export async function withReadMetrics(operation, run) {
  const trace = { operation, measured: metricsEnabled, startedAt: new Date().toISOString(), elapsedMs: 0, fullStateReads: 0, stores: {}, projectIds: new Set(), scopes: [] };
  const start = performance.now();
  try { return await run(trace); }
  finally {
    trace.elapsedMs = Number((performance.now() - start).toFixed(3)); trace.projectIds = [...trace.projectIds];
    if (trace.measured) { metricHistory.push(trace); if (metricHistory.length > 100) metricHistory.shift(); }
  }
}
function observe(trace, store, value, projected = value) {
  if (!trace?.measured || value == null) return;
  const row = trace.stores[store] ??= { loadedRecords: 0, serializedBytes: 0, retainedRecords: 0, retainedBytes: 0, bodyRecords: 0 };
  row.loadedRecords++; row.serializedBytes += bytes(value);
  if (projected != null) { row.retainedRecords++; row.retainedBytes += bytes(projected); }
  if (typeof value.text === 'string' || value.rawSource != null || Array.isArray(value.batches)) row.bodyRecords++;
  if (value.projectId) trace.projectIds.add(value.projectId);
}
const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const complete = tx => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务未完成，原数据未覆盖。')); });
function migrateLegacySegment(row) {
  let changed = false;
  if (!row.organizationStatus) { row.organizationStatus = row.needsReview ? 'needs_review' : row.manual ? 'confirmed' : 'unorganized'; changed = true; }
  if (Array.isArray(row.topicIds)) {
    const unique = [...new Set(row.topicIds)];
    if (unique.length !== row.topicIds.length) { row.topicIds = unique; changed = true; }
  }
  return changed;
}
// Derived navigation cache only; authoritative snapshots remain immutable and in
// project backups. Count fields avoid keeping ordered message/graph/body copies.
export function snapshotSummary(row) {
  return { id: row.id, projectId: row.projectId, conversationId: row.conversationId, capturedAt: row.capturedAt, method: row.method,
    sourceConversationId: row.sourceConversationId ?? null, sourceUrl: row.sourceUrl ?? null, scope: row.scope, fileSource: row.fileSource ?? null,
    stats: row.stats, warnings: row.warnings ?? [], diagnostics: row.diagnostics ?? null,
    messageCount: row.messageIds?.length ?? 0, graphNodeCount: row.graph?.length ?? 0, pathIds: row.pathIds ?? [], selectedPathId: row.selectedPathId ?? null };
}
async function open() {
  if (connectionPromise) return connectionPromise;
  const req = indexedDB.open(DATABASE, 9);
  req.onupgradeneeded = event => {
    const db = req.result;
    for (const name of [...STORES, 'snapshotSummaries', 'recoveryPoints', 'meta']) {
      const store = db.objectStoreNames.contains(name) ? req.transaction.objectStore(name) : db.createObjectStore(name, { keyPath: 'id' });
      if (!['projects', 'meta', 'drafts'].includes(name) && !store.indexNames.contains('projectId')) store.createIndex('projectId', 'projectId', { unique: false });
      if (['messages', 'versions', 'snapshots', 'snapshotSummaries', 'paths', 'qas', 'segments', 'suggestions', 'analysisPacks'].includes(name) && !store.indexNames.contains('conversationId')) store.createIndex('conversationId', 'conversationId', { unique: false });
      if (['qas', 'segments', 'suggestions', 'analysisPacks'].includes(name) && !store.indexNames.contains('pathId')) store.createIndex('pathId', 'pathId', { unique: false });
      if (name === 'versions' && !store.indexNames.contains('messageId')) store.createIndex('messageId', 'messageId', { unique: false });
      if (name === 'segments' && !store.indexNames.contains('qaIds')) store.createIndex('qaIds', 'qaIds', { unique: false, multiEntry: true });
      if (name === 'messages' && !store.indexNames.contains('conversationOrder')) store.createIndex('conversationOrder', ['conversationId', 'firstSourceOrder', 'id'], { unique: false });
      const opcIndexes = { qaCards: ['conversationId'], qaMetadata: ['cardId'], memberships: ['timelineId', 'cardId'], relationships: ['fromCardId', 'toCardId'], openIssues: ['cardId'], decisions: ['cardId'], knowledgeFragments: ['cardId'], contextPackItems: ['packId', 'cardId'], importRecords: ['conversationId'] };
      for (const key of opcIndexes[name] ?? []) if (!store.indexNames.contains(key)) store.createIndex(key, key, { unique: false });
    }
    if (event.oldVersion < 3) {
      const summaries = req.transaction.objectStore('snapshotSummaries'), cursor = req.transaction.objectStore('snapshots').openCursor();
      cursor.onsuccess = () => { const item = cursor.result; if (!item) return; summaries.put(snapshotSummary(item.value)); item.continue(); };
    }
    if (event.oldVersion < 2) {
      for (const name of ['segments', 'revisions']) {
        const cursor = req.transaction.objectStore(name).openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result; if (!item) return;
          const row = item.value;
          const images = name === 'segments' ? [row] : [...(row.before ?? []), ...(row.after ?? [])];
          let changed = false;
          for (const image of images) if (migrateLegacySegment(image)) changed = true;
          if (changed) item.update(row);
          item.continue();
        };
      }
    }
  };
  const pending = new Promise((resolve, reject) => {
    let blocked = false;
    req.onsuccess = () => {
      const db = req.result;
      if (blocked) { db.close(); return; }
      const clear = () => { if (connectionPromise === pending) connectionPromise = null; };
      db.onversionchange = () => { db.close(); clear(); }; db.onclose = clear;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      blocked = true; reject(new Error('资料库升级被其他插件页面占用。请关闭旧版插件页面后重试，原数据仍保留。'));
    };
  });
  connectionPromise = pending;
  pending.catch(() => { if (connectionPromise === pending) connectionPromise = null; });
  return pending;
}
export async function memoryMetadata() {
  const db = await open(), tx = db.transaction('meta', 'readonly'), done = complete(tx);
  const values = await Promise.all([request(tx.objectStore('meta').get('appVersion')), request(tx.objectStore('meta').get('revision')), done]);
  return { appVersion: values[0]?.value ?? null, revision: values[1]?.value ?? 0, databaseVersion: db.version };
}
export async function persistRecoveryPoint(point, { expectedRevision, appVersion = null } = {}) {
  const db = await open(), tx = db.transaction(['recoveryPoints', 'meta'], 'readwrite'), done = complete(tx);
  let conflict = false;
  const revision = tx.objectStore('meta').get('revision');
  revision.onsuccess = () => {
    if ((revision.result?.value ?? 0) !== expectedRevision) { conflict = true; tx.abort(); return; }
    if (point) tx.objectStore('recoveryPoints').add(point);
    if (appVersion) tx.objectStore('meta').put({ id: 'appVersion', value: appVersion });
  };
  try { await done; } catch (error) { if (conflict) throw new Error('资料正在另一页面更新，请重试建立恢复点；原数据没有改变。'); throw error; }
}
export async function readState(trace = null) {
  if (!trace) return withReadMetrics('readState (full atomic mutation / validation baseline)', item => readState(item));
  trace.fullStateReads++;
  const db = await open(), tx = db.transaction([...STORES, 'meta'], 'readonly'), done = complete(tx);
  const pending = STORES.map(name => request(tx.objectStore(name).getAll()).then(rows => { for (const row of rows) observe(trace, name, row); return [name, rows]; }));
  const version = request(tx.objectStore('meta').get('revision'));
  const results = await Promise.all([...pending, version, done]);
  const meta = results[STORES.length];
  const state = { ...Object.fromEntries(results.slice(0, STORES.length)), revision: meta?.value ?? 0 };
  for (const row of state.segments) row.organizationStatus ??= row.needsReview ? 'needs_review' : row.manual ? 'confirmed' : 'unorganized';
  return state;
}
// Each request list shares one readonly transaction and the same meta revision. Cursor
// projection limits retained memory; metrics also count full IDB rows materialized.
export async function readSnapshot(specifications, trace = null) {
  const db = await open(), names = [...new Set([...specifications.map(spec => spec.store), 'meta'])];
  const tx = db.transaction(names, 'readonly'), done = complete(tx);
  const pending = specifications.map(spec => {
    const store = tx.objectStore(spec.store), source = spec.index ? store.index(spec.index) : store;
    if (trace?.measured) trace.scopes.push({ store: spec.store, index: spec.index ?? 'primary-key', key: spec.key ?? null, mode: spec.mode ?? 'cursor' });
    if (spec.mode === 'get') return request(store.get(spec.key)).then(row => { const value = row == null ? null : spec.project ? spec.project(row) : row; observe(trace, spec.store, row, value); return [spec.name ?? spec.store, value]; });
    if (spec.mode === 'keys') return Promise.all((spec.keys ?? []).map(key => request(store.get(key)).then(row => { const value = row == null ? null : spec.project ? spec.project(row) : row; observe(trace, spec.store, row, value); return value; }))).then(rows => [spec.name ?? spec.store, rows.filter(row => row != null)]);
    if (spec.mode === 'count') return request(source.count(spec.key)).then(value => [spec.name ?? spec.store, value]);
    if (spec.mode === 'indexKeys') return new Promise((resolve, reject) => {
      const rows = [], cursor = source.openKeyCursor(spec.range ?? (spec.key == null ? null : IDBKeyRange.only(spec.key)), spec.direction ?? 'next');
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => { const item = cursor.result; if (!item) { resolve([spec.name ?? spec.store, rows]); return; } const row = { id: item.primaryKey, indexKey: item.key }; observe(trace, spec.store, row); rows.push(row); item.continue(); };
    });
    return new Promise((resolve, reject) => {
      const rows = []; let visited = 0; const cursor = source.openCursor(spec.key == null ? null : IDBKeyRange.only(spec.key), spec.direction ?? 'next');
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item || (spec.limit != null && rows.length >= spec.limit)) { resolve([spec.name ?? spec.store, rows]); return; }
        try {
          const row = item.value;
          const value = spec.project ? spec.project(row, item.primaryKey) : row;
          observe(trace, spec.store, row, value);
          if (spec.visit) spec.visit(row, item.primaryKey);
          if (visited++ >= (spec.offset ?? 0) && value != null) rows.push(value);
          item.continue();
        } catch (error) { reject(error); tx.abort(); }
      };
    });
  });
  const results = await Promise.all([...pending, request(tx.objectStore('meta').get('revision')), done]);
  return { ...Object.fromEntries(results.slice(0, specifications.length)), revision: results[specifications.length]?.value ?? 0 };
}
export async function commit(before, after) {
  const db = await open(), tx = db.transaction([...STORES, 'snapshotSummaries', 'meta'], 'readwrite'), done = complete(tx);
  const req = tx.objectStore('meta').get('revision'); let conflict = false;
  req.onsuccess = () => {
    if ((req.result?.value ?? 0) !== before.revision) { conflict = true; tx.abort(); return; }
    for (const name of STORES) {
      const previous = new Map((before[name] ?? []).map(row => [row.id, JSON.stringify(row)]));
      const present = new Set(); const store = tx.objectStore(name);
      for (const row of after[name] ?? []) {
        present.add(row.id);
        if (previous.get(row.id) !== JSON.stringify(row)) { store.put(row); if (name === 'snapshots') tx.objectStore('snapshotSummaries').put(snapshotSummary(row)); }
      }
      for (const row of before[name] ?? []) if (!present.has(row.id)) { store.delete(row.id); if (name === 'snapshots') tx.objectStore('snapshotSummaries').delete(row.id); }
    }
    tx.objectStore('meta').put({ id: 'revision', value: before.revision + 1 });
  };
  try { await done; } catch (e) { if (conflict) throw new Error('另一个窗口已更新数据，请刷新后重试。'); throw e; }
}
