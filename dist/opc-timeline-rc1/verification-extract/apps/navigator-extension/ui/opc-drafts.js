// Small editable metadata drafts only. Chat bodies stay in IndexedDB.
export class AnnotationDrafts {
  constructor({ storage = globalThis.localStorage, session = globalThis.sessionStorage, onError = null } = {}) {
    this.storage = storage; this.onError = onError; this.cache = new Map(); this.pending = new Map();
    try { this.owner = session?.getItem('opcDraftOwner') || crypto.randomUUID(); session?.setItem('opcDraftOwner', this.owner); }
    catch { this.owner = crypto.randomUUID(); }
  }
  prefix(projectId, cardId) { return `opcDraft:${projectId}:${cardId}:`; }
  get(projectId, cardId) {
    const prefix = this.prefix(projectId, cardId), ownKey = prefix + this.owner;
    if (this.cache.has(ownKey)) return this.cache.get(ownKey);
    let result = null;
    try {
      const own = this.storage?.getItem(ownKey);
      if (own) result = { ...JSON.parse(own), storageKey: ownKey };
      else for (let i = 0; i < (this.storage?.length ?? 0); i++) {
        const key = this.storage.key(i); if (!key.startsWith(prefix)) continue;
        const candidate = JSON.parse(this.storage.getItem(key));
        if (!result || candidate.updatedAt > result.updatedAt) result = { ...candidate, storageKey: key };
      }
    } catch (e) { this.onError?.(`无法恢复标注草稿：${e.message}`); }
    this.cache.set(ownKey, result); return result;
  }
  set(projectId, cardId, value) {
    const key = this.prefix(projectId, cardId) + this.owner, previous = this.cache.get(key);
    const draft = { ...value, updatedAt: Date.now(), storageKey: key, recoveredFrom: previous?.storageKey !== key ? previous?.storageKey : previous?.recoveredFrom };
    this.cache.set(key, draft); this.pending.set(key, draft);
    clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 150); return draft;
  }
  flush() {
    clearTimeout(this.timer);
    for (const [key, draft] of this.pending) {
      try { this.storage?.setItem(key, JSON.stringify(draft)); this.pending.delete(key); }
      catch (e) { this.onError?.(`草稿本地保存失败，请点击保存标注：${e.message}`); }
    }
  }
  remove(projectId, cardId) {
    const key = this.prefix(projectId, cardId) + this.owner, draft = this.cache.get(key);
    this.pending.delete(key); this.cache.set(key, null);
    try { this.storage?.removeItem(key); if (draft?.recoveredFrom) this.storage?.removeItem(draft.recoveredFrom); else if (draft?.storageKey !== key && draft?.storageKey) this.storage?.removeItem(draft.storageKey); }
    catch (e) { this.onError?.(`标注已保存，草稿清理失败：${e.message}`); }
  }
}
