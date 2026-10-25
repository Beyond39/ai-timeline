// Validation-only namespace; never packaged. Even if a browser bridge reuses a
// storage context across localhost ports, fixtures cannot touch its default DB.
export function isolateValidationDatabase(label) {
  if (!/^v0[34]-[a-z0-9-]+$/.test(label)) throw new Error('Invalid isolated fixture namespace');
  const canonical = 'ai-conversation-visual-navigator', name = `acvn-validation-${label}`;
  const originalOpen = indexedDB.open.bind(indexedDB), originalDatabases = indexedDB.databases?.bind(indexedDB);
  indexedDB.open = (requested, ...args) => originalOpen(requested === canonical ? name : requested, ...args);
  if (originalDatabases) indexedDB.databases = async () => (await originalDatabases()).filter(row => row.name === name).map(row => ({ ...row, name: canonical }));
  return name;
}
