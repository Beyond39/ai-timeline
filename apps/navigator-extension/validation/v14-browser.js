import { isolateValidationDatabase } from './isolated-db.js';
import { command, mutate } from '../storage/repository.js';
import { readState } from '../storage/database.js';
import { createProject, saveConversation } from '../domain/captures.js';
import { parseImport } from '../importers/json.js';
import { graph, user, body } from './qa-p0-fixtures.mjs';
import { OPCTimeline } from '../ui/opc.js';
import { richBody } from '../ui/body.js';
import { EXTENSION_VERSION } from '../domain/common.js';

const label = new URLSearchParams(location.search).get('validationDb');
if (!/^v04-v14-[a-z0-9-]+$/.test(label ?? '')) throw new Error('Use an isolated v14 validation database');
isolateValidationDatabase(label);
const output = document.querySelector('#results'), key = label + ':report';
let report = { version: EXTENSION_VERSION, ok: false, results: [], scope: 'Synthetic 300 QA; actual local browser, IndexedDB, UI and persistence. Live ChatGPT and installed MV3 untested.' }, projectId;
const show = () => { output.textContent = JSON.stringify(report, null, 2); localStorage.setItem(key, JSON.stringify(report)); };
const ensure = (value, message) => { if (!value) throw new Error(message); };
const check = async (name, run) => { try { const actual = await run(); report.results.push({ name, passed: true, actual }); } catch (e) { report.results.push({ name, passed: false, error: e.stack }); } show(); };
const timeline = new OPCTimeline(document.querySelector('#app'), { api: command, onError: error => { report.uiError = error; show(); } });
function fixture(source) {
  const rows = []; let parent = 'root';
  for (let i = 0; i < 150; i++) {
    rows.push([`q${i}`, parent, user(`q${i}`, `第 ${i + 1} 轮：如何组织插件知识演化与关系标注？`, 1790812800 + source * 86400 + i * 600)]);
    rows.push([`a${i}`, `q${i}`, body(`a${i}`, '# 阅读与关系\n\n这是完整正文。\n\n' + '中文知识归档与数据库设计，保持真实内容和引用。'.repeat(i === 149 ? 1000 : 50) + '\n\n深层关键词全文结尾\n\n```python\nif True:\n    print("<box> & {@body}")\n```\n\n| 项目 | 值 |\n| --- | --- |\n| 轮次 | ' + i + ' |\n\n$$\\frac{x^2}{2}$$\nEND-' + source + '-' + i)]); parent = `a${i}`;
  }
  rows.push(['invalid', 'q0', body('invalid', '', { status: 'cancelled', end_turn: false })]);
  return graph(rows, parent, 'v14-source-' + source);
}
const inputs = [fixture(0), fixture(1)];
const capture = async raw => { const input = (await parseImport(JSON.stringify(raw), 'synthetic-v14.json')).conversations[0]; return mutate(state => saveConversation(state, input, projectId)); };
const write = (action, values) => command('opcWrite', { projectId, action, ...values });
document.querySelector('#run').addEventListener('click', async () => {
  document.querySelector('#run').disabled = true; report.results = []; delete report.uiError;
  await command('memoryInitialize', {});
  projectId = await mutate(state => state.projects.find(p => p.name === 'V14 300QA 合成验收')?.id ?? createProject(state, 'V14 300QA 合成验收').id);
  await check('300轮导入、重复同步与完整尾部', async () => {
    const start = performance.now(); for (const input of inputs) await capture(input); report.importMs = Math.round(performance.now() - start);
    const before = await readState(); for (const input of inputs) await capture(input); const after = await readState();
    ensure(after.qaCards.length === 300 && after.messages.length === before.messages.length && after.versions.length === before.versions.length, 'Duplicate or lost messages');
    const last = after.qaCards.find(c => c.ordinal === 150), detail = await command('opcDetail', { projectId, cardId: last.id }); ensure(detail.answerBody.includes('END-') && detail.answerBody.length > 20000, 'Long answer truncated');
    return { cards: 300, versions: after.versions.length, longAnswerChars: detail.answerBody.length, importMs: report.importMs };
  });
  const all = (await readState()).qaCards, a = all.find(c => c.sourceConversationId === 'v14-source-0' && c.ordinal === 1), b = all.find(c => c.sourceConversationId === 'v14-source-1' && c.ordinal === 1), c = all.find(c => c.sourceConversationId === 'v14-source-0' && c.ordinal === 3);
  await check('多时间线归属与三维标签', async () => {
    await write('metadata', { cardId: a.id, topic: 'OPC', contentType: '代码实战', organizationStatus: '未整理', favorite: true });
    const theme = await write('timeline', { name: '跨来源研究' }), other = await write('timeline', { name: '第二主题' });
    await write('membership', { timelineId: theme.id, cardIds: [a.id, b.id] }); await write('membership', { timelineId: other.id, cardIds: [a.id] }); await write('membership', { timelineId: other.id, cardIds: [a.id], remove: true });
    const filtered = await command('opcPage', { projectId, timelineIds: [theme.id] }); ensure(filtered.total === 2, 'Cross source membership failed');
    const defaults = await command('opcDetail', { projectId, cardId: c.id }); ensure(defaults.metadata.organizationStatus === '未整理', 'New card default state incorrect');
    return '来源线保留；跨来源主题2卡；移除另一主题不删卡；类型/状态独立';
  });
  await check('关系幂等、跨来源与带环网络', async () => {
    const relation = { fromCardId: a.id, toCardId: b.id, type: '修正', directed: true, description: 'B 依赖来源 A 的证据' };
    const first = await write('relationship', relation), again = await write('relationship', relation); ensure(first.id === again.id, 'Duplicate relationship created');
    await write('relationship', { fromCardId: b.id, toCardId: c.id, type: '依赖', directed: true }); await write('relationship', { fromCardId: c.id, toCardId: a.id, type: '启发', directed: true });
    const custom = await write('relationship', { fromCardId: a.id, toCardId: b.id, type: '研究依据', directed: false });
    await write('relationship', { relationshipId: custom.id, expectedRevision: custom.revision, fromCardId: b.id, toCardId: a.id, type: '研究依据', directed: false, description: '说明更新' });
    const saved = await readState(); ensure(saved.relationships.length === 4 && saved.relationships.some(r => r.description === '说明更新'), 'Relation edit/cycle lost');
    return '3节点有向环+自定义无向关系；重复保存同ID；编辑保留';
  });
  await check('隐藏与恢复保留关系、标签和历史索引', async () => {
    const hidden = structuredClone(inputs[0]); hidden.current_node = 'invalid'; await capture(hidden);
    let found = await command('opcPage', { projectId, query: '深层关键词', includeInvalid: true }); ensure(found.total === 300 && found.cards.some(c => c.validity.state === 'HIDDEN_INVALID'), 'Hidden full text unavailable');
    ensure((await readState()).relationships.length === 4, 'Hidden relation deleted'); await capture(inputs[0]); ensure((await command('opcPage', { projectId })).total === 300, 'Recovery failed');
    return '150源卡隐藏→恢复；4关系与元数据/全文索引保留';
  });
  await check('中文全文、多个关键词、字段权重及筛选', async () => {
    await write('metadata', { cardId: c.id, title: '深层关键词 中文', notes: '检索备注测试' });
    const start = performance.now(), hits = await command('opcPage', { projectId, query: '深层关键词 中文' }); report.searchMs = Math.round(performance.now() - start); ensure(hits.total === 300 && hits.cards[0].id === c.id, 'Title relevance or Chinese search failed');
    const filtered = await command('opcPage', { projectId, tag: 'OPC', contentType: '代码实战', organizationStatus: '未整理', favorite: true }); ensure(filtered.total === 1, 'Filters failed');
    ensure((await command('opcPage', { projectId, query: '检索备注测试' })).total === 1, 'Notes not indexed');
    return { hits: hits.total, titleFirst: true, searchMs: report.searchMs };
  });
  await check('三分区与正文 DOM 安全、自动保存标注', async () => {
    await timeline.show({ projectId }); const nodes = [...document.querySelectorAll('.opc-card')]; ensure(nodes.length === 60 && nodes.every(n => n.querySelector('.opc-question') && n.querySelector('.opc-answer') && n.querySelector('.opc-card-tags')), 'Three regions missing');
    await timeline.openCard(a.id); const notes = document.querySelector('.opc-annotation textarea'); notes.value = '自动保存中文备注'; notes.dispatchEvent(new Event('input', { bubbles: true })); await timeline.flushMetadata();
    ensure((await command('opcDetail', { projectId, cardId: a.id })).metadata.notes === notes.value, 'Auto save failed');
    const hostile = richBody('```html\n<script>alert(1)</script>\n```\n\n[bad](javascript:alert)\n\n| a | b |\n| --- | --- |\n| x | y |\n\n$$x^2$$', { format: 'markdown' });
    ensure(!hostile.querySelector('script,[href^="javascript:"]') && hostile.querySelector('table') && hostile.querySelector('math'), 'Unsafe or missing rendering');
    return '60摘要卡；Q/A/标签独立；自动保存成功；代码/表格/MathML安全';
  });
  await check('右侧标签轻量编辑自动持久化', async () => {
    await timeline.tagDialog(timeline.data.cards[0]); const select = document.querySelector('#edit-dialog select[aria-label="整理状态"]'); select.value = '已确认'; select.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#edit-dialog button').click();
    for (let i = 0; i < 50 && document.querySelector('#edit-dialog').open; i++) await new Promise(resolve => setTimeout(resolve, 20));
    const detail = await command('opcDetail', { projectId, cardId: a.id }); ensure(detail.metadata.organizationStatus === '已确认', 'Tag autosave failed'); return '轻量菜单修改后自动提交 IndexedDB';
  });
  await check('画布坐标/视口及重建恢复', async () => {
    await write('layout', { positions: { [a.id]: { x: 0, y: 0 }, [b.id]: { x: 350, y: 0 }, [c.id]: { x: 700, y: 0 } }, viewport: { x: 20, y: 20, zoom: 1 } });
    await timeline.show({ projectId, mode: 'canvas' }); ensure(document.querySelectorAll('.opc-connect-anchor').length === 60, 'Drag anchors absent');
    const rect = timeline.canvas.getBoundingClientRect();
    for (const id of [a.id, c.id]) { const node = timeline.canvasNodes.get(id).getBoundingClientRect(), p = timeline.positions[id]; ensure(Math.abs(node.left - rect.left - timeline.viewport.x - p.x * timeline.viewport.zoom) < 2 && Math.abs(node.top - rect.top - timeline.viewport.y - p.y * timeline.viewport.zoom) < 2, 'Node DOM position differs from saved world coordinates'); }
    ensure(timeline.positions[a.id].x === 0 && timeline.viewport.zoom === 1, 'Layout lost'); await timeline.flushLayout();
    return '60紧凑Q/A节点与锚点；稳定卡片坐标/视口恢复；带环关系可绘制';
  });
  report.persisted = { projectId, cardId: a.id, targetId: b.id, relationshipCount: 4 };
  report.heapBytes = performance.memory?.usedJSHeapSize ?? null;
  report.ok = report.results.every(r => r.passed) && !report.uiError; show(); await timeline.show({ projectId });
});
document.querySelector('#restore').addEventListener('click', async () => {
  report = JSON.parse(localStorage.getItem(key) ?? '{}'); projectId = report.persisted?.projectId;
  if (!projectId) return;
  await check('刷新后的标注、关系、布局和300轮恢复', async () => {
    const page = await command('opcPage', { projectId }), detail = await command('opcDetail', { projectId, cardId: report.persisted.cardId });
    ensure(page.total === 300 && detail.metadata.notes === '自动保存中文备注' && detail.metadata.organizationStatus === '已确认' && (await readState()).relationships.length === 4 && page.layout.positions[detail.card.id], 'Restart data loss');
    await timeline.show({ projectId }); return '新页面连接：300卡、自动保存备注/标签、4关系、布局均恢复';
  }); report.ok = report.results.every(r => r.passed) && !report.uiError; show();
});
document.querySelector('#canvas').addEventListener('click', async () => { projectId ??= JSON.parse(localStorage.getItem(key) ?? '{}').persisted?.projectId; if (projectId) { timeline.selected = null; await timeline.show({ projectId, mode: 'canvas' }); timeline.filters.canvasCardIds = [report.persisted.targetId]; await timeline.load(); } });
document.querySelector('#timeline').addEventListener('click', async () => { if (projectId) await timeline.show({ projectId }); });
document.querySelector('#layout-check').addEventListener('click', async () => { await timeline.flushLayout(); await check('交互后保存的布局与当前坐标一致', async () => { const page = await command('opcPage', { projectId }); ensure(Object.entries(timeline.positions).filter(([id]) => page.layout.positions[id]).every(([id, p]) => p.x === page.layout.positions[id].x && p.y === page.layout.positions[id].y), 'Layout not saved'); return '已移动节点坐标一致'; }); });
document.querySelector('#download').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = 'OPC_V14_BROWSER_REPORT.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
