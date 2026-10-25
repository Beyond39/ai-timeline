import { parseImport } from '../importers/json.js';
import { createProject, saveConversation } from '../domain/captures.js';
import { STORES } from '../storage/database.js';
import { syncCards, timelinePage, opcMutation, assertOPC } from '../domain/opc.js';
import { readingParts, readableStatic, visibility } from '../domain/qa-content.js';
import { exportProject, validateBackup, restoreBackup } from '../domain/backup.js';
import { parseMarkdown } from '../ui/body.js';
import { assembleDocumentSources } from '../storage/document-export.js';
import { composeDocument } from '../domain/document-export.js';
import { includedChapters } from '../exports/content.js';
import { createDocumentPrint } from '../domain/document-recipes.js';
import { basic, branches, graph, user, body } from './qa-p0-fixtures.mjs';

const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const fresh = () => { const state = Object.fromEntries(STORES.map(s => [s, []])); return { state, project: createProject(state, 'P0 合成测试') }; };
const capture = async (ctx, payload) => saveConversation(ctx.state, (await parseImport(JSON.stringify(payload), 'p0-synthetic.json')).conversations[0], ctx.project.id);
const answer = ctx => readingParts(ctx.state.qaCards[0].visibleAnswerIds.map(k => ctx.state.messages.find(m => m.id === k))).map(m => m.text).join('\n\n');
export async function runP0Scenarios() {
  const results = [];
  const test = async (name, input, expected, run) => {
    try { const actual = await run(); results.push({ name, input, expected, actual, passed: true }); }
    catch (e) { results.push({ name, input, expected, actual: e.message, passed: false }); }
  };
  await test('1 普通完整 Q/A', 'final + finished_successfully + end_turn:true；缺提问时间', '一张 ACTIVE；时间未知；保留全部原始节点', async () => {
    const c = fresh(); await capture(c, basic()); ensure(c.state.qaCards.length === 1 && c.state.qaCards[0].validity.state === 'ACTIVE', '完整答案未生效');
    ensure(c.state.qaCards[0].questionTime.value === null, '伪造提问时间'); ensure(c.state.versions.length === 2, '原始节点丢失'); return '1 ACTIVE；questionTime=null；2 原始版本';
  });
  await test('2 中间状态与多段最终正文', 'analysis/commentary、工具参数/返回、空消息、两段 final', '一张卡片合并两段正文；无工具状态；一个导出回答单元', async () => {
    const c = fresh(), payload = graph([
      ['q', 'root', user('q')], ['analysis', 'q', body('analysis', '内部推理', { channel: 'analysis', end_turn: false })],
      ['call', 'analysis', body('call', '{"query":"private"}', { recipient: 'browser', channel: 'commentary', end_turn: false })],
      ['tool', 'call', { id: 'tool', author: { role: 'tool' }, content: { parts: ['搜索结果'] }, status: 'finished_successfully' }],
      ['empty', 'tool', body('empty', '', { end_turn: false })], ['a1', 'empty', body('a1', '正文第一段', { end_turn: false })], ['a2', 'a1', body('a2', '正文第二段')]
    ], 'a2'); await capture(c, payload);
    ensure(c.state.qaCards.length === 1 && c.state.qaCards[0].visibleAnswerIds.length === 2, '片段归组错误'); ensure(answer(c) === '正文第一段\n\n正文第二段', '中间状态泄漏或正文遗漏');
    const sources = assembleDocumentSources({ ...c.state, project: c.project }, { projectId: c.project.id });
    const entries = includedChapters(composeDocument(sources, { includeUserPrompts: false }))[0].entries;
    ensure(entries.length === 1 && entries[0].sourceParts.length === 2, '导出未集中正文与来源');
    const spec = composeDocument(sources), print = createDocumentPrint(c.state, { projectId: c.project.id, selection: { title: '集中导出', includeUserPrompts: false, chapters: spec.chapters.map(ch => ({ title: ch.title, items: ch.entries.map(e => e.source) })) } });
    ensure(includedChapters(c.state.documentPrints.find(p => p.id === print.id).document)[0].entries.length === 1, '打印快照未集中同轮回答');
    ensure(c.state.snapshots[0].rawSource.mapping.call.message.content.parts[0].includes('private'), '原始工具参数被删除'); return '2 正文片段→1 卡片/导出回答；全部7消息保留';
  });
  await test('3 生成后取消', '先in_progress，再cancelled；历史good分支存在', 'PENDING→HIDDEN_INVALID；不回退good', async () => {
    const c = fresh(); await capture(c, branches('stream')); const id = c.state.qaCards[0].id; ensure(timelinePage(c.state).total === 0, '生成中进入时间线');
    await capture(c, branches('bad')); ensure(c.state.qaCards[0].id === id && c.state.qaCards[0].validity.state === 'HIDDEN_INVALID' && answer(c) === '', '取消未隐藏'); return 'PENDING→HIDDEN_INVALID；0可见；ID不变';
  });
  await test('4 完整分支切换无效分支', 'good→bad；附加备注/标签/主题成员', '隐藏同卡；用户数据原样保留', async () => {
    const c = fresh(); await capture(c, branches('good')); const card = c.state.qaCards[0]; opcMutation(c.state, 'metadata', { projectId: c.project.id, cardId: card.id, notes: '备注', tags: ['标签'] });
    const t = opcMutation(c.state, 'timeline', { projectId: c.project.id, name: '主题' }); opcMutation(c.state, 'membership', { projectId: c.project.id, timelineId: t.id, cardIds: [card.id] });
    const before = JSON.stringify(c.state.qaMetadata); await capture(c, branches('bad')); ensure(card.validity.state === 'HIDDEN_INVALID' && timelinePage(c.state).total === 0 && before === JSON.stringify(c.state.qaMetadata) && c.state.memberships.length === 2, '隐藏破坏用户数据'); return 'HIDDEN_INVALID；备注/标签/2成员均保留';
  });
  await test('5 恢复有效分支', 'good→bad→good', '恢复原卡与原标注；不新建', async () => {
    const c = fresh(); await capture(c, branches('good')); const id = c.state.qaCards[0].id; await capture(c, branches('bad')); await capture(c, branches('good'));
    ensure(c.state.qaCards.length === 1 && c.state.qaCards[0].id === id && timelinePage(c.state).total === 1 && answer(c) === '历史完整答案', '恢复重复或错正文'); return '原ID恢复ACTIVE；1卡片';
  });
  await test('6 重复导入与状态版本', '相同输入导入三次；只更改status/end_turn', '无重复卡/正文版本；状态变更独立留版本', async () => {
    const c = fresh(); const payload = basic(); for (let i = 0; i < 3; i++) await capture(c, payload);
    ensure(c.state.qaCards.length === 1 && c.state.messages.length === 2 && c.state.versions.length === 2, '重复导入增加身份'); payload.mapping.a.message.status = 'cancelled'; await capture(c, payload);
    ensure(c.state.versions.length === 3 && c.state.qaCards[0].validity.state === 'HIDDEN_INVALID', '状态变化未版本化'); return '1卡/2消息；状态变更保存第3版本';
  });
  await test('7 不同轮次同文提问', 'q1,a1,q2,a2；问题文字完全一样，真实消息ID不同', '保留两张卡', async () => {
    const c = fresh(); await capture(c, graph([['q1', 'root', user('q1', '同文', 1700000000)], ['a1', 'q1', body('a1', '答1')], ['q2', 'a1', user('q2', '同文', 1700010000)], ['a2', 'q2', body('a2', '答2')]], 'a2'));
    ensure(c.state.qaCards.length === 2 && timelinePage(c.state).total === 2, '文本去重误删真实提问'); return '2 ACTIVE；不同真实提问保留';
  });
  await test('8 取消重试与多模型分支', '同一用户ID多助手分支；用户编辑为共享父节点的兄弟；相邻新用户ID重试', '有图证据的同槽提问同卡；线性新提问不擅自归并', async () => {
    const c = fresh(), payload = graph([['q', 'root', user('q')], ['a', 'q', body('a', '模型A')], ['q-edit', 'root', user('q-edit')], ['b', 'q-edit', body('b', '模型B')], ['retry', 'b', user('retry')], ['c', 'retry', body('c', '再次提问')]], 'a');
    await capture(c, payload); const id = c.state.qaCards[0].id; payload.current_node = 'b'; await capture(c, payload); ensure(c.state.qaCards.length === 1 && c.state.qaCards[0].id === id && answer(c) === '模型B', '图证据同槽身份未归并');
    payload.current_node = 'c'; await capture(c, payload); ensure(c.state.qaCards.length === 2, '相邻新提问误合并'); return '兄弟槽切换保持同ID；线性再次提问保留第二卡';
  });
  await test('9 Markdown/动态组件/代码混合', '标题列表表格公式、代码内<box>和大括号；代码外box/body/each', '保留真实代码；组件安全静态转换或诊断；不执行', async () => {
    const input = '# 标题\n\n- 项目\n\n```js\nconst x = { html: "<box>", template: "{#each x}" };\n```\n\n<box><h2>静态标题</h2><p>保留 {value} 与 2 < 3</p>{@body data}{#each items as item}<p>{item}</p>{/each}<script>evil()</script></box>\n\n| 列 | 值 |\n| --- | --- |\n| 甲 | 乙 |\n\n$$x^2$$';
    const output = readableStatic(input), code = parseMarkdown(output).find(b => b.type === 'code'); ensure(code.text.includes('"<box>"') && code.text.includes('{#each x}'), '代码符号损坏');
    ensure(output.includes('静态标题') && output.includes('{value}') && !output.includes('evil()') && output.includes('动态内容无法静态还原') && !output.includes('{@body data}'), '组件源码泄漏或编造动态值');
    ensure(parseMarkdown(output).some(b => b.type === 'table') && output.includes('$$x^2$$'), 'Markdown或数学源码丢失');
    ensure(readableStatic('说明中的 <box>、{value} 与 x < y').includes('<box>'), '普通编程符号被全局删除');
    const html = readableStatic('<box><p>{answer}</p><table><tr><th>列</th></tr><tr><td>值</td></tr></table></box>'); ensure(parseMarkdown(html).some(b => b.type === 'table') && !html.includes('{answer}') && html.includes('动态表达式'), 'HTML表格或动态表达式泄漏');
    ensure(visibility({ role: 'assistant', text: '思考了 5 秒' }) === 'body', '仍然依靠关键词过滤'); return '静态标题、表格可读；代码原样；动态安全诊断；公式保留';
  });
  await test('10 旧污染迁移及用户数据恢复', '同用户A1.1/A1.2重复卡、助手节点作起点、不可映射孤儿；各含标注与关系', '可靠节点合并；标注/成员/关系保留；孤儿归档；可备份恢复', async () => {
    const c = fresh(); await capture(c, basic()); const first = c.state.qaCards[0]; first.projectionVersion = 2;
    const duplicate = { ...structuredClone(first), id: 'legacy-A1.2', projectionVersion: 2, userMessageId: first.responseMessageIds[0] }; c.state.qaCards.push(duplicate);
    const orphan = { ...structuredClone(first), id: 'legacy-orphan', userMessageId: 'unresolvable' }; c.state.qaCards.push(orphan);
    c.state.qaMetadata.push({ id: 'legacy-edit', projectId: c.project.id, cardId: duplicate.id, title: '保留标题', notes: '旧备注', tags: ['旧标签'] }, { id: 'orphan-edit', projectId: c.project.id, cardId: orphan.id, title: '孤儿', notes: '待恢复', tags: [] });
    const theme = opcMutation(c.state, 'timeline', { projectId: c.project.id, name: '主题线' }); c.state.memberships.push({ id: 'legacy-member', projectId: c.project.id, timelineId: theme.id, cardId: duplicate.id });
    await capture(c, graph([['q2', 'root', user('q2')], ['a2', 'q2', body('a2', '目标')]], 'a2', 'target')); const target = c.state.qaCards.find(q => q.conversationId !== first.conversationId);
    c.state.relationships.push({ id: 'legacy-rel', projectId: c.project.id, fromCardId: duplicate.id, toCardId: target.id, type: '引用', directed: true, description: '保留说明' });
    c.state.canvasLayouts.push({ id: 'layout', projectId: c.project.id, positions: { [duplicate.id]: { x: 12, y: 34 } }, viewport: { x: 0, y: 0, zoom: 1 } });
    syncCards(c.state, c.state.conversations.find(v => v.id === first.conversationId)); assertOPC(c.state);
    ensure(c.state.qaCards.length === 2 && c.state.qaMetadata[0].cardId === first.id && c.state.qaMetadata[0].notes === '旧备注' && c.state.relationships[0].fromCardId === first.id && c.state.canvasLayouts[0].positions[first.id].x === 12, '迁移丢失标注或引用');
    ensure(c.state.qaRepairArchives[0].original.qaMetadata.some(m => m.notes === '待恢复') && c.state.qaRepairArchives[0].unresolved.includes(orphan.id), '孤儿编辑静默丢弃');
    const backup = exportProject(c.state, c.project.id); validateBackup(backup); const restored = fresh(); restoreBackup(restored.state, backup); assertOPC(restored.state);
    ensure(restored.state.qaRepairArchives.length === 1 && restored.state.qaMetadata[0].notes === '旧备注', '恢复丢失归档'); return '2来源各1卡；旧标注/关系/位置重映射；孤儿完整归档；备份恢复成功';
  });
  await test('11 部分加载与未知当前分支', '只读取后半段；随后缺current_node', '未读旧卡不删除；未知选择PENDING，不回退历史', async () => {
    const c = fresh(); await capture(c, basic()); const card = c.state.qaCards[0], input = (await parseImport(JSON.stringify(graph([['q2', 'root', user('q2')], ['a2', 'q2', body('a2', '答2')]], 'a2')), 'partial.json')).conversations[0];
    input.scope.branches = 'unknown'; input.scope.kind = 'loaded_page'; await saveConversation(c.state, input, c.project.id); ensure(c.state.qaCards.includes(card) && card.validity.state === 'ACTIVE', '部分读取把旧卡当删除');
    const unknown = basic(); unknown.current_node = null; await capture(c, unknown); ensure(c.state.qaCards.length === 2 && c.state.qaCards.every(q => q.validity.state === 'PENDING') && timelinePage(c.state).total === 0, '未知当前路径回退历史'); return '部分读取保留旧卡；未知选择2卡PENDING';
  });
  await test('12 缺少完成证据', '正文很长、含“思考/搜索”，但无status/end_turn；final缺end_turn', '均PENDING，不使用文字/字数猜完成', async () => {
    const c = fresh(), payload = basic(); delete payload.mapping.a.message.status; delete payload.mapping.a.message.end_turn; payload.mapping.a.message.content.parts = ['已搜索网站；思考了几秒。'.repeat(2000)]; await capture(c, payload);
    ensure(c.state.qaCards[0].validity.state === 'PENDING', '无完成证据被当有效'); payload.mapping.a.message.status = 'finished_successfully'; await capture(c, payload); ensure(c.state.qaCards[0].validity.state === 'PENDING', '消息完成冒充整轮完成'); return '两种输入均PENDING；字数与关键词不参与判断';
  });
  await test('13 长对话分页与完整尾部', '2000轮真实图形结构的合成对话；每答案1200字；末答案20万字', '2000张ACTIVE；列表≤60摘要；详情正文不截断', async () => {
    const c = fresh(), rows = []; let parent = 'root';
    for (let i = 0; i < 2000; i++) { rows.push([`q${i}`, parent, user(`q${i}`, `问题 ${i}`, 1700000000 + i * 60)], [`a${i}`, `q${i}`, body(`a${i}`, (i === 1999 ? '长'.repeat(200000) : '正文'.repeat(600)) + `END-${i}`)]); parent = `a${i}`; }
    const start = performance.now(); await capture(c, graph(rows, parent)); const importMs = Math.round(performance.now() - start), pageStart = performance.now(), page = timelinePage(c.state), pageMs = Math.round(performance.now() - pageStart);
    ensure(c.state.qaCards.length === 2000 && page.cards.length === 60 && page.total === 2000 && page.cards.every(card => card.answerPreview.length <= 240), '长对话分页或摘要有误');
    const last = c.state.qaCards.at(-1), text = readingParts(last.visibleAnswerIds.map(k => c.state.messages.find(m => m.id === k)))[0].text; ensure(text.length > 200000 && text.endsWith('END-1999'), '长答案截断');
    return `2000 ACTIVE；60摘要；20万字尾部完整；归组${importMs}ms，分页${pageMs}ms`;
  });
  await test('14 取消片段后明确完成及嵌套工具参数', '同用户链中取消片段→明确final；文本parts内tool_call对象', '仅新完成正文生效；取消/嵌套工具参数不显示', async () => {
    const c = fresh(), payload = graph([['q', 'root', user('q')], ['cancel', 'q', body('cancel', '取消旧片段', { status: 'cancelled' })], ['final', 'cancel', body('final', '有效新答案')]], 'final');
    payload.mapping.final.message.content.parts.push({ type: 'tool_call', description: '不应展示工具参数' }); await capture(c, payload);
    ensure(c.state.qaCards[0].validity.state === 'ACTIVE' && answer(c) === '有效新答案', '历史取消片段污染新正文或工具参数泄漏'); return 'ACTIVE；仅有效新答案；取消与工具参数原始保留';
  });
  await test('15 旧分支重复身份与备份后重同步', '旧版同父用户槽两卡各有冲突标题、备注；恢复后切换分支', '一稳定身份；备注合并；冲突标题归档；恢复不重复', async () => {
    const c = fresh(), payload = graph([['q', 'root', user('q')], ['a', 'q', body('a', '答A')], ['q-edit', 'root', user('q-edit')], ['b', 'q-edit', body('b', '答B')]], 'a'); await capture(c, payload);
    const first = c.state.qaCards[0], otherUser = c.state.messages.find(m => m.sourceMessageId === 'q-edit');
    const duplicate = { ...structuredClone(first), id: 'old-branch-duplicate', projectionVersion: 2, userMessageId: otherUser.id, logicalUserMessageId: otherUser.id }; c.state.qaCards.push(duplicate);
    c.state.qaMetadata.push({ id: 'one-edit', projectId: c.project.id, cardId: first.id, title: '标题A', tags: ['A'], notes: '备注A' }, { id: 'two-edit', projectId: c.project.id, cardId: duplicate.id, title: '标题B', tags: ['B'], notes: '备注B' });
    payload.current_node = 'b'; await capture(c, payload); ensure(c.state.qaCards.length === 1 && c.state.qaCards[0].id === first.id && c.state.qaMetadata[0].notes.includes('备注B') && c.state.qaRepairArchives[0].original.qaMetadata.some(m => m.title === '标题B'), '分支重复或冲突编辑丢失');
    const restored = fresh(); restoreBackup(restored.state, exportProject(c.state, c.project.id)); const conversation = restored.state.conversations[0], id = restored.state.qaCards[0].id; syncCards(restored.state, conversation); assertOPC(restored.state);
    ensure(restored.state.qaCards.length === 1 && restored.state.qaCards[0].id === id && restored.state.qaCards[0].userMessageAliases.every(k => restored.state.messages.some(m => m.id === k)), '恢复后别名或稳定身份丢失'); return '同槽旧卡合并；两备注/标签保留；冲突标题归档；恢复重同步1卡';
  });
  await test('16 迁移后同消息正文更新', '旧投影迁移生成阅读缓存；同一助手ID随后更新正文', '稳定卡ID；新正文替换旧缓存；原版本只读保留', async () => {
    const c = fresh(), payload = basic(); await capture(c, payload); const card = c.state.qaCards[0], oldVersion = c.state.messages.find(m => m.sourceMessageId === 'a').currentVersionId, oldBody = c.state.versions.find(v => v.id === oldVersion).text;
    card.projectionVersion = 2; syncCards(c.state, c.state.conversations[0]); ensure(c.state.messages.some(m => m.readingText), '迁移输入未产生旧缓存');
    payload.mapping.a.message.content.parts = ['同身份的新完整答案']; await capture(c, payload);
    ensure(c.state.qaCards.length === 1 && c.state.qaCards[0].id === card.id && answer(c) === '同身份的新完整答案' && c.state.versions.find(v => v.id === oldVersion).text === oldBody, '旧缓存覆盖新回答或原版本被改写'); return '原卡显示新正文；旧不可变版本保留';
  });
  return { ok: results.every(r => r.passed), provenance: 'Explicit synthetic fixtures; no real historical data supplied.', results, liveChatGPT: { tested: false, reason: 'User has no historical sample or specified live conversation.' } };
}
