// Runs against real IndexedDB and production modules in an isolated localhost DB.
import { command, createDraft, saveDraft } from '../storage/repository.js';
import { parseImport } from '../importers/json.js';
import { readState, memoryMetadata, setReadMetricsEnabled, resetReadMetrics, getReadMetrics } from '../storage/database.js';
import { OPCTimeline, comparePositions } from '../ui/opc.js';
import { EXTENSION_VERSION } from '../domain/common.js';

const assert = (value, message) => { if (!value) throw new Error(message); };
const namespace = new URLSearchParams(location.search).get('validationDb');
const markerKey = `${namespace}:opc-browser-marker`;
const reportKey = `${namespace}:opc-browser-reports`;
const host = document.createElement('section'); host.id = 'opc-test-host';
const output = document.createElement('pre'); output.id = 'opc-report'; output.style.cssText = 'white-space:pre-wrap;max-height:400px;overflow:auto';
const run = document.createElement('button'); run.textContent = '运行 OPC 浏览器验收'; run.id = 'run-opc';
const restart = document.createElement('button'); restart.textContent = '验证 OPC 重启持久化'; restart.id = 'run-opc-restart';
document.querySelector('details')?.append(run, restart, output); document.body.append(host);
const download = document.createElement('button'); download.textContent = '保存 OPC 验收报告'; document.querySelector('details')?.append(download);
download.onclick = () => {
  const reports = JSON.parse(localStorage.getItem(reportKey) ?? '[]');
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: EXTENSION_VERSION, reports }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'OPC_BROWSER_REPORT.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
};
if (['legacyOPC', 'legacyOPC5'].some(key => new URLSearchParams(location.search).get(key) === '1')) {
  const migration = document.createElement('button'); migration.textContent = '验证 OPC 旧库升级'; document.querySelector('details').append(migration);
  migration.onclick = () => report(async check => {
    const state = await readState(), projectId = state.projects[0].id;
    if (new URLSearchParams(location.search).get('legacyOPC5') === '1') {
      check((await memoryMetadata()).databaseVersion === 6, '原 V5 标注资料库升级至 V6');
      check(state.messages.length === 5 && state.versions.length === 5 && state.snapshots.length === 1, '升级保留原始消息、版本及快照');
      const page = await command('opcPage', { projectId }), card = page.cards[0];
      const detail = await command('opcDetail', { projectId, cardId: card.id });
      const identity = JSON.parse(localStorage.getItem(`${namespace}:opcMigrationIdentity`) ?? '{}');
      check(page.total === 2 && card.id === identity.cardId && detail.relationships[0].id === identity.relationshipId && page.timelines.some(t => t.id === identity.themeId) && detail.metadata.title === '旧人工标题' && detail.metadata.notes === '旧备注' && detail.metadata.tags[0] === '旧标签', '升级保留稳定卡片ID及旧标题、标签和备注');
      check(page.timelines.some(t => t.name === '旧主题线') && page.memberships.some(m => m.cardId === card.id && page.timelines.find(t => t.id === m.timelineId)?.kind === 'theme'), '升级保留主题时间线归属');
      check(detail.relationships[0].directed && detail.relationships[0].description === '旧关系说明' && page.layout.positions[card.id].x === 321 && page.layout.viewport.zoom === .75, '升级保留有向关系、说明和画布布局');
      return;
    }
    check((await memoryMetadata()).databaseVersion === 6, '原 IndexedDB V4 升级为 V6，并建立卡片与关系索引');
    check(state.messages.length === 3 && state.versions.length === 3 && state.snapshots.length === 1, '升级保留全部消息、版本及原始快照');
    const page = await command('opcPage', { projectId }); check(page.total === 1, '旧对话自动建立一个 Q/A 卡片及来源时间线');
    const detail = await command('opcDetail', { projectId, cardId: page.cards[0].id });
    check(detail.card.questionTime.value === null && detail.answers.length === 1 && detail.answers[0].text.includes('MIGRATION-END'), '旧版缺失时间保持未知，通过原始版本恢复分析频道并隐藏内部分析');
  });
}
async function report(fn) {
  const checks = [], check = (value, name) => { assert(value, name); checks.push(name); };
  try {
    assert(/^v04-opc-/.test(namespace ?? ''), '必须使用隔离的 v04-opc-* 资料库'); await fn(check);
    const result = { ok: true, checks, environment: 'Chromium, real IndexedDB; extension runtime APIs locally bridged', timestamp: new Date().toISOString() };
    output.textContent = JSON.stringify(result, null, 2); localStorage.setItem(reportKey, JSON.stringify([...JSON.parse(localStorage.getItem(reportKey) ?? '[]'), result]));
  } catch (e) { output.textContent = JSON.stringify({ ok: false, checks, error: e.stack }, null, 2); }
}
run.onclick = () => report(async check => {
  run.disabled = true;
  try {
    const project = await command('createProject', { name: 'OPC 验收 · 合成数据' });
    const payload = { provider: 'opc-browser', conversations: [{ id: 'first', title: '设计讨论', messages: [
      { id: 'q', role: 'user', text: '如何组织时间线？', created_at: '2026-10-01T10:00:00Z' },
      { id: 'thinking', role: 'assistant', channel: 'analysis', text: '内部分析，不应出现在正文' },
      { id: 'tool', role: 'tool', text: '工具结果' }, { id: 'empty', role: 'assistant', text: '' },
      { id: 'state', role: 'assistant', text: '思考了 7 秒' },
      { id: 'a1', role: 'assistant', text: '# 时间线设计\n\n- 每轮一张卡片\n\n```js\nconst local = true;\n```' },
      { id: 'a2', role: 'assistant', text: '| 功能 | 状态 |\n| --- | --- |\n| 本地 | 可用 |\n\n[不执行](javascript:alert) <script>alert(1)</script>\n\nCOMPLETE-END' },
      { id: 'unknown-q', role: 'user', text: '没有时间的提问' }, { id: 'unknown-a', role: 'assistant', text: '未知时间' }
    ] }, { id: 'second', title: '开发讨论', messages: [{ id: 'q2', role: 'user', text: '依赖哪张卡片？', created_at: '2026-10-10T10:00:00Z' }, { id: 'a3', role: 'assistant', text: '跨线连接' }] }] };
    const save = async () => { const draft = await createDraft(await parseImport(JSON.stringify(payload), 'opc-browser-fixture.json')); const result = await saveDraft({ draftId: draft.id, projectId: project.id }); assert(!result.failures.length, '导入失败'); };
    await save(); await save();
    let data = await command('opcPage', { projectId: project.id });
    check(data.total === 3, '重复导入不生成重复卡片，每轮完整问答只占一张卡片');
    const first = data.cards.find(c => c.sourceTitle === '设计讨论' && c.ordinal === 1), other = data.cards.find(c => c.sourceTitle === '开发讨论');
    check(data.cards.at(-1).questionTime.value === null, '真实时间排序，未知时间单列');
    const errors = [];
    const ui = new OPCTimeline(host, { api: command, onError: e => errors.push(e) }); await ui.show({ projectId: project.id });
    check(host.querySelectorAll('.opc-card').length === 3 && !host.querySelector('.message-rich'), '列表只渲染摘要');
    await ui.openCard(first.id);
    check(host.querySelectorAll('.opc-detail h1').length === 1 && host.querySelectorAll('.opc-detail li').length === 1 && host.querySelectorAll('.opc-detail table').length === 1 && host.querySelectorAll('.opc-detail pre code').length === 1, '详情安全渲染 Markdown 标题、列表、代码块和表格');
    check(!host.querySelector('.opc-detail script') && !host.querySelector('.opc-detail a[href^="javascript"]'), '导入脚本与有害链接不执行');
    check(host.querySelector('.opc-detail').textContent.includes('COMPLETE-END') && !host.querySelector('.opc-detail').textContent.includes('思考了 7 秒') && !host.querySelector('.opc-detail').textContent.includes('内部分析'), '完整回答保留多个片段，状态及空正文隐藏');
    const form = host.querySelector('.opc-annotation'); form.querySelector('input').value = '阅读标题'; form.querySelectorAll('input')[1].value = '产品，设计'; form.querySelector('textarea').value = '浏览器备注';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 50; i++) { const value = await command('opcDetail', { projectId: project.id, cardId: first.id }); if (value.metadata.notes === '浏览器备注') break; await new Promise(r => setTimeout(r, 20)); }
    check((await command('opcDetail', { projectId: project.id, cardId: first.id })).metadata.notes === '浏览器备注', '通过详情表单保存标签与备注');
    const theme = await command('opcWrite', { projectId: project.id, action: 'timeline', name: '主题 · 产品' });
    await command('opcWrite', { projectId: project.id, action: 'membership', timelineId: theme.id, cardIds: [first.id, other.id] });
    await command('opcWrite', { projectId: project.id, action: 'membership', timelineId: theme.id, cardIds: [first.id], remove: true });
    const memberships = (await command('opcPage', { projectId: project.id })).memberships;
    check(memberships.some(m => m.cardId === first.id) && memberships.some(m => m.cardId === other.id && m.timelineId === theme.id), '多线引用与移除成员互不影响');
    await ui.load(); await ui.relationshipDialog(first.id, other.id);
    const dialog = document.querySelector('#edit-dialog'); dialog.querySelector('input[list]').value = '依赖'; dialog.querySelector('textarea').value = '跨线说明';
    dialog.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 50; i++) { data = await command('opcPage', { projectId: project.id }); if (data.relationships.length) break; await new Promise(r => setTimeout(r, 20)); }
    check(data.relationships.length === 1 && data.relationships[0].directed && data.relationships[0].toCardId === other.id, '通过关系表单建立跨线有向标注');
    await ui.show({ projectId: project.id, mode: 'canvas' });
    check(host.querySelectorAll('.opc-canvas-node').length === 3 && host.querySelectorAll('.opc-edge').length === 1, '画布共用卡片与关系，显示方向和类型');
    ui.positions[first.id] = { x: 432, y: 210 }; ui.moveNode(first.id); ui.drawEdges(); ui.viewport = { x: 31, y: 42, zoom: .9 }; ui.scheduleLayout([first.id], true); await ui.flushLayout();
    ui.destroy(); await ui.show({ projectId: project.id, mode: 'canvas' });
    check(ui.positions[first.id].x === 432 && ui.viewport.zoom === .9, '销毁并重新创建视图恢复节点位置与缩放');
    const model = comparePositions(data.cards, 1800); check(model.positions.get(other.id) > model.positions.get(first.id) && !model.positions.has(data.cards.find(c => !c.questionTime.value).id), '对照坐标由真实提问时间决定，未知时间不伪造坐标');
    setReadMetricsEnabled(true); resetReadMetrics(); await command('opcPage', { projectId: project.id });
    check(getReadMetrics().every(m => !m.stores.messages && !m.stores.versions && !m.stores.snapshots && m.fullStateReads === 0), '目录查询不读取消息、正文版本或原始快照');
    resetReadMetrics(); await command('opcDetail', { projectId: project.id, cardId: first.id });
    check(getReadMetrics()[0].stores.messages.loadedRecords === 3, '详情只读取问题与两个可见回答片段，不加载工具及内部分析正文');
    resetReadMetrics(); await command('opcPage', { projectId: project.id, query: '每轮一张卡片' }); await command('opcPage', { projectId: project.id, query: '每轮一张卡片', offset: 60 });
    check(!getReadMetrics()[1].stores.messages, '相同全文搜索翻页复用当前数据库版本的命中缓存');
    await ui.openCard(first.id);
    const localNotes = host.querySelector('.opc-annotation textarea'); localNotes.value = '未保存草稿'; localNotes.dispatchEvent(new Event('input', { bubbles: true }));
    await ui.load(); check(host.querySelector('.opc-annotation textarea').value === '未保存草稿', '刷新视图保留正在编辑的草稿');
    const saved = await command('opcDetail', { projectId: project.id, cardId: first.id });
    await command('opcWrite', { projectId: project.id, action: 'metadata', cardId: first.id, notes: '另一窗口修改', expectedRevision: saved.metadata.revision });
    await ui.load(); check(host.querySelector('.opc-conflict') && host.querySelector('.opc-annotation textarea').value === '未保存草稿', '另一窗口修改后展示冲突并保留本地草稿');
    host.querySelector('.opc-annotation').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 50 && !errors.length; i++) await new Promise(r => setTimeout(r, 20));
    check(errors.length === 1 && (await command('opcDetail', { projectId: project.id, cardId: first.id })).metadata.notes === '另一窗口修改', '过期标注保存失败，未覆盖另一窗口内容'); errors.length = 0;
    const latest = await command('opcDetail', { projectId: project.id, cardId: first.id });
    ui.drafts.remove(project.id, first.id); await command('opcWrite', { projectId: project.id, action: 'metadata', cardId: first.id, notes: '浏览器备注', expectedRevision: latest.metadata.revision });
    const largeProject = await command('createProject', { name: 'OPC 长对话 · 合成数据' });
    const largeMessages = Array.from({ length: 180 }, (_, i) => [
      { id: `long-q-${i}`, role: 'user', text: `长对话问题 ${i}`, created_at: new Date(1700000000000 + i * 3600000).toISOString() },
      { id: `long-a-${i}`, role: 'assistant', text: '# 长回答\n\n' + '只在展开详情时读取完整段落。'.repeat(400) + `\nTAIL-${i}` }
    ]).flat();
    const largeDraft = await createDraft(await parseImport(JSON.stringify({ provider: 'opc-long', conversations: [{ id: 'long', title: '180轮长对话', messages: largeMessages }] }), 'opc-long.json'));
    const largeResult = await saveDraft({ draftId: largeDraft.id, projectId: largeProject.id }); check(!largeResult.failures.length, '180轮长对话真实导入成功');
    await ui.show({ projectId: largeProject.id, mode: 'timeline' });
    check(host.querySelectorAll('.opc-card').length === 60 && !host.querySelector('.message-rich') && ui.data.total === 180, '长对话只渲染60个摘要，避免加载全部完整回答');
    const final = await command('opcPage', { projectId: largeProject.id, offset: 120 }); await ui.openCard(final.cards.at(-1).id);
    check(host.querySelector('.opc-detail').textContent.includes('TAIL-179'), '最后一轮长回答尾部完整可读');
    await ui.locate(final.cards.at(-1).id); check(ui.filters.offset === 120 && host.querySelectorAll('.opc-card').length === 60, '跨页定位回到目标所在页，保留相邻卡片');
    const firstLarge = await command('opcPage', { projectId: largeProject.id });
    await command('opcWrite', { projectId: largeProject.id, action: 'relationship', fromCardId: firstLarge.cards[0].id, toCardId: final.cards.at(-1).id, type: '延续' });
    ui.filters.offset = 0; ui.filters.canvasCardIds = [final.cards.at(-1).id]; await ui.show({ projectId: largeProject.id, mode: 'canvas' });
    check(host.querySelectorAll('.opc-canvas-node').length === 61 && host.querySelectorAll('.opc-edge').length === 1, '画布按需展开跨页关联节点并显示真实连接');
    const fresh = await command('opcDetail', { projectId: largeProject.id, cardId: firstLarge.cards[0].id }); await ui.openCard(fresh.card.id);
    const draftNotes = host.querySelector('.opc-annotation textarea'); draftNotes.value = '重启待恢复草稿'; draftNotes.dispatchEvent(new Event('input', { bubbles: true })); ui.drafts.flush();
    check(!errors.length, '浏览器交互未产生未处理错误');
    const bodies = (await readState()).messages.length;
    localStorage.setItem(markerKey, JSON.stringify({ projectId: project.id, first: first.id, other: other.id, theme: theme.id, bodies, draftProjectId: largeProject.id, draftCardId: fresh.card.id }));
    check(Boolean(localStorage.getItem(markerKey)), '已保存重启校验标记');
    ui.destroy(); host.remove(); document.querySelector('#refresh-button').click();
  } finally { run.disabled = false; }
});
restart.onclick = () => report(async check => {
  const marker = JSON.parse(localStorage.getItem(markerKey) ?? 'null'); assert(marker, '先运行 OPC 浏览器验收，然后刷新页面');
  const data = await command('opcDetail', { projectId: marker.projectId, cardId: marker.first });
  check(data.metadata.notes === '浏览器备注' && data.metadata.tags.includes('设计') && data.metadata.title === '阅读标题', '页面重启后标题、标签、备注仍存在');
  check(data.relationships[0]?.description === '跨线说明' && data.relationships[0].directed, '重启后跨线有向关系与说明仍存在');
  const page = await command('opcPage', { projectId: marker.projectId });
  check(page.layout.positions[marker.first].x === 432 && page.layout.viewport.zoom === .9, '重启后画布位置和缩放仍存在');
  check(page.memberships.some(m => m.timelineId === marker.theme && m.cardId === marker.other), '重启后主题时间线引用仍存在');
  check((await readState()).messages.length === marker.bodies, '持久化标注没有改变原始消息数');
  const drafts = new (await import('../ui/opc-drafts.js')).AnnotationDrafts();
  check(drafts.get(marker.draftProjectId, marker.draftCardId)?.notes === '重启待恢复草稿', '页面重启后未保存的编辑草稿仍可恢复');
});
