import { isolateValidationDatabase } from './isolated-db.js';
import { STORES, readState, memoryMetadata, commit } from '../storage/database.js';
import { command, mutate } from '../storage/repository.js';
import { saveConversation, createProject } from '../domain/captures.js';
import { parseImport } from '../importers/json.js';
import { basic, branches, graph, user, body } from './qa-p0-fixtures.mjs';
import { runP0Scenarios } from './qa-p0-scenarios.mjs';
import { OPCTimeline } from '../ui/opc.js';

import { richBody } from '../ui/body.js';
import { EXTENSION_VERSION } from '../domain/common.js';
import { readRecoveryPoint } from '../storage/memory.js';

const label = new URLSearchParams(location.search).get('validationDb');
if (!/^v04-p0-[a-z0-9-]+$/.test(label ?? '')) throw new Error('必须使用独立专项测试资料库');
isolateValidationDatabase(label);
let report = { version: EXTENSION_VERSION, results: [], ok: false, scope: 'Local browser, synthetic data and real IndexedDB. No live ChatGPT or installed MV3 assertion.' };
const output = document.querySelector('#results'), savedKey = `${label}:p0-report`;
const show = () => { output.textContent = JSON.stringify(report, null, 2); localStorage.setItem(savedKey, JSON.stringify(report)); };
const check = async (name, expected, run) => {
  try { const actual = await run(); report.results.push({ name, expected, actual, passed: true }); }
  catch (e) { report.results.push({ name, expected, actual: e.message, passed: false }); }
};
const ensure = (ok, message) => { if (!ok) throw new Error(message); };
const capture = async (payload, projectId) => mutate(state => saveConversation(state, payload, projectId));
const input = async p => (await parseImport(JSON.stringify(p), 'browser-p0-synthetic.json')).conversations[0];
async function prepareV6() {
  if ((await indexedDB.databases()).length) return;
  const state = Object.fromEntries(STORES.map(s => [s, []])), project = createProject(state, 'V6 污染迁移 · 合成');
  await saveConversation(state, await input(basic()), project.id);
  const card = state.qaCards[0]; card.projectionVersion = 2;
  state.qaCards.push({ ...structuredClone(card), id: 'legacy-fragment', projectionVersion: 2, userMessageId: card.responseMessageIds[0] });
  state.qaMetadata.push({ id: 'legacy-note', projectId: project.id, cardId: 'legacy-fragment', title: '人工标题', notes: '旧备注保留', tags: ['旧标签'] });
  state.memberships.push({ id: 'legacy-member', projectId: project.id, cardId: 'legacy-fragment', timelineId: state.timelines[0].id });
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('ai-conversation-visual-navigator', 6), stores = STORES.filter(s => s !== 'qaRepairArchives');
    req.onupgradeneeded = () => { for (const s of [...stores, 'meta']) req.result.createObjectStore(s, { keyPath: 'id' }); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { const db = req.result, tx = db.transaction([...stores, 'meta'], 'readwrite');
      for (const s of stores) for (const row of state[s]) tx.objectStore(s).put(row);
      tx.objectStore('meta').put({ id: 'revision', value: 1 }); tx.objectStore('meta').put({ id: 'appVersion', value: '1.3.0' });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  });
}
await prepareV6();
const timeline = new OPCTimeline(document.querySelector('#timeline'), { api: command, legacyList:true, onError: e => { report.uiError = e; show(); } });
let fullCardId;const full = new OPCTimeline(document.querySelector('#full'), { api: command, onError: e => { report.uiError = e; show(); } });
async function display(projectId) {
  await timeline.show({ projectId, mode: 'timeline' });
  const state = await readState(), conversation = state.conversations.find(c => c.projectId === projectId && c.sourceConversationId === 'p0-source');
  await full.show({projectId,mode:'timeline'});fullCardId=state.qaCards.find(c=>c.conversationId===conversation.id&&c.validity.state==='ACTIVE')?.id;if(fullCardId)await full.openCard(fullCardId);
}
document.querySelector('#run').addEventListener('click', async () => {
  document.querySelector('#run').disabled = true;
  report.results = [];
  const domain = await runP0Scenarios(); report.domain = domain; show();
  let projectId, cardId;
  await check('V6→V8 schema 与污染迁移', '自动恢复点+归档；两片旧卡→一卡；旧标注迁移', async () => {
    await command('memoryInitialize', {}); const state = await readState(); projectId = state.projects[0].id;
    await command('opcEnsure', { projectId }); const repaired = await readState(), metadata = await memoryMetadata(), status = await command('memoryStatus', {});
    ensure(metadata.databaseVersion === 8 && repaired.qaCards.length === 1 && repaired.qaMetadata[0].notes === '旧备注保留' && repaired.qaRepairArchives.length === 1 && status.points.length === 1, '迁移或恢复点不完整');
    const recovery = await readRecoveryPoint(status.points[0].id);
    ensure(recovery.projects[0].records.qaCards.length === 2, '恢复点未保存修复前原貌'); cardId = repaired.qaCards[0].id; return 'DB8；1卡；旧备注；1归档；1可读取恢复点';
  });
  if (!projectId) { report.ok = false; show(); return; }
  await check('迁移缓存与同身份新正文', '旧缓存不能覆盖同一消息新版本；详情显示新全文', async () => {
    const payload = basic(); payload.mapping.a.message.content.parts = ['迁移后同身份新正文']; await capture(await input(payload), projectId);
    const detail = await command('opcDetail', { projectId, cardId }); ensure(detail.answerBody === '迁移后同身份新正文', '旧缓存遮蔽新正文'); return '同一消息/卡片显示新全文，旧版本保留';
  });
  await check('当前分支同步事务', 'ACTIVE→PENDING→HIDDEN_INVALID→ACTIVE；ID与标注不变', async () => {
    for (const [selected, expected] of [['good', 'ACTIVE'], ['stream', 'PENDING'], ['bad', 'HIDDEN_INVALID'], ['good', 'ACTIVE']]) {
      await capture(await input(branches(selected)), projectId); const state = await readState(), card = state.qaCards.find(c => c.id === cardId), page = await command('opcPage', { projectId });
      ensure(card.validity.state === expected && (expected === 'ACTIVE' ? page.total === 1 : page.total === 0), `分支 ${selected} 可见性错误`);
    }
    const state = await readState(); ensure(state.qaCards.length === 1 && state.qaMetadata[0].notes === '旧备注保留', 'ID或用户编辑丢失'); return '4状态同步；同ID；备注保留';
  });
  await check('重复/多段正文持久化与导出', '两段正文合并；重复导入不重复；导出同轮唯一单元', async () => {
    const payload = await input(graph([['q', 'root', user('q')], ['s', 'q', body('s', '状态应隐藏', { channel: 'commentary', end_turn: false })], ['a1', 's', body('a1', '# 完整正文\n\n- 列表项', { end_turn: false })], ['a2', 'a1', body('a2', '| 名称 | 值 |\n| --- | --- |\n| 甲 | 乙 |\n\n```js\nconst x = { html: "<box>" };\n```\n\n<box><h2>组件静态标题</h2>{@body data}</box>\n\n$$\\frac{x^2}{2}$$\n\nTAIL-END')]], 'a2'));
    await capture(payload, projectId); await capture(payload, projectId);
    const detail = await command('opcDetail', { projectId, cardId }); ensure(detail.answers.length === 2 && detail.answerBody.includes('TAIL-END') && !detail.answerBody.includes('状态应隐藏'), '正文丢失或状态泄漏');
    const sources = await command('documentSources', { projectId }); ensure(sources.conversations[0].messages.length === 3, '导出包含工具状态或遗漏片段'); return '同卡2答案片段；完整尾部；导出仅问题+2片段';
  });
  await check('事务冲突无部分写入', '过期revision拒绝；当前标注与原始版本不改变', async () => {
    const before = await readState(); await command('opcWrite', { projectId, action: 'metadata', cardId, notes: '并发新备注' }); const current = await readState();
    const stale = structuredClone(before); stale.messages[0].text = '错误覆盖'; let refused = false; try { await commit(before, stale); } catch { refused = true; }
    const after = await readState(); ensure(refused && JSON.stringify(after.messages) === JSON.stringify(current.messages) && after.qaMetadata[0].notes === '并发新备注', '冲突造成部分覆盖'); return '旧事务拒绝；正文/标注均保留';
  });
  await check('真实DOM渲染', '1卡；全文合并；heading/table/code/math；无状态、A1.x、原文控件', async () => {
    await display(projectId); await timeline.openCard(cardId);
    const detail = document.querySelector('.opc-detail'), normal = document.querySelector('#full');
    ensure(detail.querySelector('table') && detail.querySelector('pre code') && detail.querySelector('math mfrac') && detail.innerText.includes('TAIL-END'), 'Markdown/公式/尾部渲染失败');
    ensure(normal.querySelectorAll('.cm-round').length <= 1 && normal.innerText.includes('TAIL-END') && !/A\d+\.\d+|状态应隐藏|查看原始正文/.test(normal.innerText), '旧阅读器显示内部单元');
    const safe = richBody('$\\unsupported{x}$', { format: 'markdown' }); ensure(safe.querySelector('.math-source'), '不支持宏没有安全降级'); return '标题/代码/表格/MathML有效；全文干净；安全降级';
  });
  await check('来源树返回正常全文', '切回全文后重新按有效卡片读取；无工具/片段序号', async () => {
    await full.show({projectId,mode:'canvas'});await full.show({projectId,mode:'timeline'});if(fullCardId)await full.openCard(fullCardId);
    const text = document.querySelector('#full').innerText; ensure(text.includes('TAIL-END') && !/状态应隐藏|A\d+\.\d+|查看原始正文/.test(text), '模式切换绕过有效性筛选'); return '返回全文仍为同轮完整干净正文';
  });
  await command('opcWrite', { projectId, action: 'layout', positions: { [cardId]: { x: 123, y: 456 } }, viewport: { x: 0, y: 0, zoom: 1 } });
  const other = await input(graph([['u', 'root', user('u')], ['a', 'u', body('a', '关联目标')]], 'a', 'browser-target')); await capture(other, projectId);
  const target = (await readState()).qaCards.find(c => c.sourceConversationId === 'browser-target'); await command('opcWrite', { projectId, action: 'relationship', fromCardId: cardId, toCardId: target.id, type: '引用', directed: true, description: '刷新保留' });
  report.persisted = { projectId, cardId }; report.ok = domain.ok && report.results.every(r => r.passed); show(); document.querySelector('#run').disabled = false;
});
document.querySelector('#reload-check').addEventListener('click', async () => {
  report = JSON.parse(localStorage.getItem(savedKey) ?? '{}');
  await check('页面重启后持久化', '卡片身份、标签、备注、关系、归属、布局、迁移归档均在', async () => {
    const state = await readState(), { projectId, cardId } = report.persisted, card = state.qaCards.find(c => c.id === cardId);
    ensure(card?.validity.state === 'ACTIVE' && state.qaMetadata[0].notes === '并发新备注' && state.qaMetadata[0].tags.includes('旧标签') && state.relationships[0].description === '刷新保留' && state.memberships.some(m => m.cardId === cardId) && state.canvasLayouts[0].positions[cardId].y === 456 && state.qaRepairArchives.length === 1, '重启后数据丢失');
    await display(projectId); return '重启后全部持久化字段与恢复归档保留';
  });
  report.ok = report.domain?.ok && report.results.every(r => r.passed); show();
});
document.querySelector('#download').addEventListener('click', () => { const link = document.createElement('a'); link.download = 'OPC_P0_BROWSER_REPORT.json'; link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); link.click(); });

