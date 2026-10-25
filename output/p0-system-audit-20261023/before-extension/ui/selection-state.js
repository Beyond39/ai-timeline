// Content is shared in IndexedDB. Navigation belongs to this page; a reload
// must not adopt the Project most recently selected in another open page.
export function selectionState(mode, { storage = chrome.storage, session = globalThis.sessionStorage, windows = chrome.windows } = {}) {
  const key = `navigatorSelection:${mode}`;
  const windowKey = Promise.resolve(windows?.getCurrent?.()).then(w => Number.isInteger(w?.id) ? `${key}:${w.id}` : null).catch(() => null);
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  return {
    async read() {
      try { const current = object(JSON.parse(session.getItem(key))); if (current) return current; } catch { /* Use durable defaults if session storage is unavailable or malformed. */ }
      const scoped = await windowKey;
      if (scoped && storage.session) { const current = object((await storage.session.get(scoped))[scoped]); if (current) return current; }
      const saved = await storage.local.get([key, 'navigatorSelection']);
      // Legacy is read-only migration input. Never write another page's key.
      return object(saved[key]) ?? object(saved.navigatorSelection) ?? {};
    },
    async write(value) {
      const snapshot = { ...value };
      try { session.setItem(key, JSON.stringify(snapshot)); } catch { /* The window-scoped fallback remains available. */ }
      const scoped = await windowKey;
      await Promise.all([storage.local.set({ [key]: snapshot }), ...(scoped && storage.session ? [storage.session.set({ [scoped]: snapshot })] : [])]);
    }
  };
}
