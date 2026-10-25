import { command, createDraft, latestDraft, mutate, saveDraft } from '../storage/repository.js';
import { parseImport } from '../importers/json.js';
import { plainBody } from '../ui/dom.js';

export async function runBrowserRegressions() {
  const checks = [], failures = [];
  const check = async (name, fn) => {
    try { await fn(); checks.push(name); } catch (error) { failures.push({ name, error: error.message }); }
  };
  const expect = (value, message) => { if (!value) throw new Error(message); };
  await check('最近导入预览按时间而非 IndexedDB 主键选择', async () => {
    const bundle = await parseImport(JSON.stringify({ provider: 'regression-fixture', conversations: [{ id: 'draft-case', messages: [{ id: 'draft-q', role: 'user', text: '预览顺序隔离样例' }] }] }), 'draft-regression-example.json');
    const newId = 'draft:regression:a-new', oldId = 'draft:regression:z-old';
    try {
      await mutate(state => { state.drafts.push({ ...structuredClone(bundle), id: newId, createdAt: '2100-01-02T00:00:00.000Z', sequence: 2, results: [], failures: [] },
        { ...structuredClone(bundle), id: oldId, createdAt: '2100-01-01T00:00:00.000Z', sequence: 1, results: [], failures: [] }); });
      expect((await latestDraft()).id === newId, '错误地重新打开了更早的导入预览');
    } finally {
      await command('discardDraft', { draftId: newId }); await command('discardDraft', { draftId: oldId });
    }
  });
  const text = 'ﬀ'.repeat(500) + ' Ｆｏｏ Café e\u0301 🤖 target-search';
  let projectId;
  await check('Unicode 搜索摘要使用原文偏移且包含命中词', async () => {
    const project = await command('createProject', { name: '回归验证 · Unicode 搜索（隔离样例）' }); projectId = project.id;
    const bundle = await parseImport(JSON.stringify({ provider: 'regression-fixture', conversations: [{ id: crypto.randomUUID(), title: 'Unicode 回归', messages: [{ id: 'unicode-q', role: 'user', text }] }] }), 'unicode-regression-example.json');
    const draft = await createDraft(bundle); await saveDraft({ draftId: draft.id, projectId });
    const results = await command('search', { projectId, query: 'target-search' });
    expect(results.results.some(row => row.excerpt.includes('target-search')), '归一化后的索引被当作原文索引，摘要丢失命中词');
  });
  await check('全角及组合字符搜索与阅读器高亮一致', async () => {
    const results = await command('search', { projectId, query: 'foo' });
    expect(results.total > 0, '全角搜索没有找到保存的原文');
    const body = plainBody(text, 'foo'); expect(body.querySelector('mark')?.textContent === 'Ｆｏｏ', '搜索命中但全文没有高亮');
    expect(plainBody(text, 'é').querySelectorAll('mark').length === 2, '组合字符没有按原文位置高亮');
    expect(plainBody('🤖 ﬀ', 'f').querySelector('mark')?.textContent === 'ﬀ', '扩展字符高亮切断原文');
  });
  await check('并发首次读取共享一个 IndexedDB 连接请求', async () => {
    const cold = await import(`../storage/database.js?cold=${crypto.randomUUID()}`);
    const original = indexedDB.open; let calls = 0;
    indexedDB.open = function(...args) { if (args[0] === 'ai-conversation-visual-navigator') calls++; return original.apply(this, args); };
    try { await Promise.all([cold.readState(), cold.readState(), cold.readState()]); }
    finally { indexedDB.open = original; }
    expect(calls === 1, `并发读取创建了 ${calls} 个连接，版本升级时可能遗留未关闭连接`);
  });
  return { checkedAt: new Date().toISOString(), passed: checks.length, failed: failures.length, checks, failures,
    environment: 'Isolated local Chromium origin, actual IndexedDB, actual repository and DOM rendering' };
}
