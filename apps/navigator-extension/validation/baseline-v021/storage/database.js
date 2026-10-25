export const STORES = ['projects', 'conversations', 'messages', 'versions', 'snapshots', 'paths', 'qas', 'segments', 'topics', 'revisions', 'drafts', 'suggestions', 'analysisPacks'];
const DATABASE = 'ai-conversation-visual-navigator';
let connectionPromise;
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
async function open() {
  if (connectionPromise) return connectionPromise;
  const req = indexedDB.open(DATABASE, 3);
  req.onupgradeneeded = event => {
    const db = req.result;
    for (const name of [...STORES, 'meta']) {
      const store = db.objectStoreNames.contains(name) ? req.transaction.objectStore(name) : db.createObjectStore(name, { keyPath: 'id' });
      if (!['projects', 'meta', 'drafts'].includes(name) && !store.indexNames.contains('projectId')) store.createIndex('projectId', 'projectId', { unique: false });
      if (['messages', 'versions', 'snapshots', 'paths', 'qas', 'segments', 'suggestions', 'analysisPacks'].includes(name) && !store.indexNames.contains('conversationId')) store.createIndex('conversationId', 'conversationId', { unique: false });
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
export async function readState() {
  const db = await open(), tx = db.transaction([...STORES, 'meta'], 'readonly'), done = complete(tx);
  const pending = STORES.map(name => request(tx.objectStore(name).getAll()).then(rows => [name, rows]));
  const version = request(tx.objectStore('meta').get('revision'));
  const results = await Promise.all([...pending, version, done]);
  const meta = results[STORES.length];
  const state = { ...Object.fromEntries(results.slice(0, STORES.length)), revision: meta?.value ?? 0 };
  for (const row of state.segments) row.organizationStatus ??= row.needsReview ? 'needs_review' : row.manual ? 'confirmed' : 'unorganized';
  return state;
}
export async function commit(before, after) {
  const db = await open(), tx = db.transaction([...STORES, 'meta'], 'readwrite'), done = complete(tx);
  const req = tx.objectStore('meta').get('revision'); let conflict = false;
  req.onsuccess = () => {
    if ((req.result?.value ?? 0) !== before.revision) { conflict = true; tx.abort(); return; }
    for (const name of STORES) {
      const previous = new Map((before[name] ?? []).map(row => [row.id, JSON.stringify(row)]));
      const present = new Set(); const store = tx.objectStore(name);
      for (const row of after[name] ?? []) { present.add(row.id); if (previous.get(row.id) !== JSON.stringify(row)) store.put(row); }
      for (const row of before[name] ?? []) if (!present.has(row.id)) store.delete(row.id);
    }
    tx.objectStore('meta').put({ id: 'revision', value: before.revision + 1 });
  };
  try { await done; } catch (e) { if (conflict) throw new Error('另一个窗口已更新数据，请刷新后重试。'); throw e; }
}
