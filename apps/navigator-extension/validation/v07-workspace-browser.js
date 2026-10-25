// Local validation only. Never packaged or run against the user's database.
import { command, createDraft, saveDraft } from '../storage/repository.js';
import { readState } from '../storage/database.js';
import { parseImport } from '../importers/json.js';
import { validateBackup } from '../domain/backup.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 35));
const wait = async (predicate, description) => {
  const start = performance.now();
  while (!(await predicate())) { if (performance.now() - start > 12000) throw new Error(description); await tick(); }
  await tick();
};
const shown = node => Boolean(node && getComputedStyle(node).display !== 'none' && node.getClientRects().length);
const findButton = (host, text) => [...host.querySelectorAll('button')].find(node => node.textContent.trim() === text);
const host = () => document.querySelector('#conversation-map');
const round = number => [...host().querySelectorAll('.cm-reading > .cm-round')].find(node => node.querySelector('.cm-round-title strong')?.textContent.startsWith(`Q${number} →`));

export async function runV07WorkspaceChecks() {
  const checks = [], failures = [], viewport = { width: innerWidth, height: innerHeight, mode: document.body.dataset.mode ?? null };
  const scope = 'Actual V0.7 product UI and repository/IndexedDB on localhost with explicit v04-v07-* isolated validationDb. All projects, conversations, text, reading labels and backup recovery records are synthetic. No live ChatGPT, user database, download or computer control.';
  const report = () => ({ passed: checks.length, failed: failures.length, checks, failures, scope, viewport });
  const expect = (value, message) => { if (!value) throw new Error(message); };
  const check = async (name, fn) => { try { await fn(); checks.push(name); } catch (error) { failures.push({ name, error: error.message }); } };
  const params = new URLSearchParams(location.search);
  await check('本地 v04-v07 独立验证资料库护栏', () => {
    expect(['localhost', '127.0.0.1', '[::1]'].includes(location.hostname), '必须在本地验证服务器运行。');
    expect(/^v04-v07-[a-z0-9-]+$/.test(params.get('validationDb') ?? ''), '需要明确的 v04-v07-* 隔离资料库。');
    expect(typeof globalThis.chrome?.runtime?.sendMessage === 'function', '本地扩展桥接未就绪。');
    expect(!document.querySelector('dialog[open]'), '请先关闭已有弹窗。');
  });
  if (failures.length) return report();

  const suffix = crypto.randomUUID(), projectName = `V0.7 project → conversation → Q/A · 合成 ${suffix.slice(0, 8)}`;
  const q1 = 'Q1-合成问题：如何完整保存代码和表格？', q2 = 'Q2-合成问题：工具信息如何保留？';
  const longAnswer = '## V0.7 完整回答 · 合成样例\n\n' + '这是用于验证完整正文的合成段落，保留中文内容。\n'.repeat(120) +
    '\n```javascript\nconst complete = "V07-CODE-COMPLETE";\nconsole.log(complete);\n```\n\n| 项目 | 值 |\n| --- | --- |\n| 保存 | V07-TABLE-COMPLETE |\n\nV07-Q1-ANSWER-END';
  let project, primary, unknown, large, primaryMessages, unknownMessages;
  const selectConversation = async conversation => {
    await wait(() => !document.querySelector('#capture-button').disabled, '产品操作一直处于忙碌状态。');
    const state = await readState(), path = state.paths.find(row => row.id === conversation.currentPathId);
    const expectedMessageId = path?.messageIds[0];
    const item = [...document.querySelectorAll('#conversation-list .conversation-item')].find(node => node.dataset.conversationId === conversation.id);
    expect(item, '中部 conversation 列表缺少目标 conversation。'); item.click();
    await wait(() => document.querySelector('#map-title').textContent === conversation.title && [...host().querySelectorAll('.cm-round .cm-message')].some(node => node.dataset.messageId === expectedMessageId), '目标 conversation 正文没有载入。');
  };
  const selectMode = async mode => {
    const ids = { qa: '#qa-view-button', tree: '#tree-view-button', snake: '#snake-view-button' };
    document.querySelector(ids[mode]).click(); await tick();
    for (const [value, selector] of Object.entries(ids)) expect(document.querySelector(selector).getAttribute('aria-pressed') === String(value === mode), `${mode} 模式的 aria-pressed 状态错误。`);
  };
  const messageCard = id => [...host().querySelectorAll('.cm-reading .cm-message')].find(node => node.dataset.messageId === id);
  try {
    await check('实际资料库创建明确标注的三个合成 conversation', async () => {
      project = await command('createProject', { name: projectName });
      const payload = { provider: 'v07-workspace-labelled-synthetic', conversations: [
        { id: `primary-${suffix}`, title: 'V0.7 基础 Q/A · 合成 conversation', messages: [
          { id: 'q1', role: 'user', text: q1 }, { id: 'a1', role: 'assistant', text: longAnswer },
          { id: 'q2', role: 'user', text: q2 }, { id: 'a2', role: 'assistant', text: 'V07-Q2-ANSWER-END：完整助手回答。' },
          { id: 'tool2', role: 'tool', text: 'V07-TOOL-COMPLETE：完整工具正文。' }, { id: 'q3', role: 'user', text: 'Q3-合成问题：这个问题尚未回答。' }
        ] },
        { id: `unknown-${suffix}`, title: 'V0.7 角色未确认 · 合成 conversation', messages: [
          { id: 'unknown-q', role: 'unknown', text: 'V07-UNKNOWN-Q：这是一段尚未确认说话人的问题正文。' },
          { id: 'unknown-a', role: 'unknown', text: 'V07-UNKNOWN-A-END：这是一段尚未确认说话人的回答正文。' }
        ] },
        { id: `large-${suffix}`, title: 'V0.7 83 轮目录图 · 合成 conversation', messages: Array.from({ length: 83 }, (_, index) => [
          { id: `large-q-${index + 1}`, role: 'user', text: `V07-LARGE-Q${index + 1}：明确合成问题。` },
          { id: `large-a-${index + 1}`, role: 'assistant', text: `V07-LARGE-A${index + 1}-END：明确合成完整回答。` }
        ]).flat() }
      ] };
      const bundle = await parseImport(JSON.stringify(payload), 'v07-explicit-synthetic.json');
      for (const message of bundle.conversations[1].messages) { message.roleUnverified = true; message.confirmedRole = 'unknown'; }
      const draft = await createDraft(bundle), saved = await saveDraft({ draftId: draft.id, projectId: project.id, indices: [0, 1, 2] });
      expect(saved.results.length === 3 && !saved.failures.length, '合成 conversation 保存失败。');
      const view = await command('view', { projectId: project.id });
      primary = view.conversations.find(row => row.sourceConversationId === payload.conversations[0].id);
      unknown = view.conversations.find(row => row.sourceConversationId === payload.conversations[1].id);
      large = view.conversations.find(row => row.sourceConversationId === payload.conversations[2].id);
      const state = await readState(); primaryMessages = state.messages.filter(row => row.conversationId === primary.id); unknownMessages = state.messages.filter(row => row.conversationId === unknown.id);
      expect(unknownMessages.length === 2 && unknownMessages.every(row => row.role === 'unknown' && row.roleUnverified), '未确认角色样例缺失。');
    });
    if (!project || !primary) return report();

    await check('通过实际 project 选择器打开 conversation 中部阅读', async () => {
      document.querySelector('#refresh-button').click();
      await wait(() => [...document.querySelector('#project-select').options].some(option => option.value === project.id) && !document.querySelector('#capture-button').disabled, '刷新未显示新建合成项目。');
      const preview = document.querySelector('#preview-dialog[open]');
      if (preview) findButton(preview, '稍后处理')?.click();
      const select = document.querySelector('#project-select'); select.value = project.id; select.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(() => [...document.querySelectorAll('#conversation-list .conversation-item')].some(node => node.dataset.conversationId === primary.id) && !document.querySelector('#capture-button').disabled, '项目选择未刷新中部 conversation 列表。');
      await selectMode('qa'); await selectConversation(primary);
    });
    await check('左侧仅管理 project，conversation 列表移到中部且统计框隐藏', () => {
      expect(!document.querySelector('#project-library #conversation-list'), 'conversation 列表仍在左侧。');
      expect(document.querySelector('.navigator #conversation-library #conversation-list'), 'conversation 列表没有进入中部底部。');
      expect(document.querySelector('#conversation-library').compareDocumentPosition(host()) & Node.DOCUMENT_POSITION_PRECEDING, 'conversation 列表不在 Q/A 中心之后。');
      expect(getComputedStyle(document.querySelector('#project-metrics')).display === 'none', '四统计框仍占据主视觉。');
      expect(!document.querySelector('.workspace-tools').open && !document.querySelector('.advanced-navigation').open, '辅助工具默认未折叠。');
    });
    await check('首轮默认展开问题与完整回答，包含代码、表格与末尾', async () => {
      await wait(() => round(1)?.querySelector('.cm-message') && !host().querySelector('.cm-loading'), '首轮没有完成读取。');
      const first = round(1); expect(first.open, '首轮没有默认展开。'); expect(first.textContent.includes(q1) && first.textContent.includes('V07-Q1-ANSWER-END'), '首轮只有问题或回答尾部丢失。');
      expect(first.querySelector('pre code')?.textContent.includes('V07-CODE-COMPLETE'), '代码未显示。');
      expect(first.querySelector('table')?.textContent.includes('V07-TABLE-COMPLETE'), '表格未显示。');
      expect(first.querySelectorAll('.cm-message').length === 2, '首轮问题和回答未独立显示。');
    });
    await check('目录跳转 Q2 后完整显示回答与工具消息', async () => {
      const directory = host().querySelector('.cm-directory'); directory.open = true;
      const item = [...directory.querySelectorAll('.cm-directory-item')].find(node => node.querySelector('strong')?.textContent.startsWith('Q2 →')); expect(item, '目录缺少 Q2。'); item.click();
      await wait(() => round(2)?.textContent.includes('V07-TOOL-COMPLETE'), 'Q2 回答或工具未完整读取。');
      expect(round(2).open && round(2).textContent.includes('V07-Q2-ANSWER-END') && round(2).querySelectorAll('.cm-message').length === 3, 'Q2 成员或展开状态错误。');
      expect(item.getAttribute('aria-pressed') === 'true', '目录没有标记当前 Q/A。');
      await wait(() => { const box = round(2).getBoundingClientRect(); return box.top >= -1 && box.top < innerHeight && box.bottom > 0; }, '目录跳转没有把目标 Q/A 滚入可视区。');
    });
    await check('Q/A 小箭头折叠与展开保持完整正文', async () => {
      const second = round(2), summary = second.querySelector('.cm-round-summary'); summary.click(); await tick(); expect(!second.open, '小箭头没有收起本轮。');
      summary.click(); await wait(() => second.open && second.textContent.includes('V07-TOOL-COMPLETE'), '重新展开丢失工具或正文。');
    });
    await check('Q3 待回答状态保留，未伪造答案', async () => {
      const third = round(3); expect(third && third.querySelector('summary').textContent.includes('待回答'), '未回答轮次缺失或状态错误。');
      third.querySelector('summary').click(); await wait(() => third.querySelector('.cm-message'), 'Q3 问题正文未读取。');
      expect(third.querySelectorAll('.cm-message').length === 1 && !third.textContent.includes('V07-Q2-ANSWER-END'), '未回答问题混入其他轮答案。');
    });
    await check('右侧详细原文默认收起，展开后只是辅助来源', async () => {
      const pane = document.querySelector('#reader-pane'), toggle = document.querySelector('#reader-toggle');
      expect(!shown(pane) && toggle.getAttribute('aria-expanded') === 'false', '右侧未默认收起。'); toggle.click();
      await wait(() => shown(pane) && toggle.getAttribute('aria-expanded') === 'true' && !document.querySelector('#capture-button').disabled, '详细原文没有展开。');
      expect(shown(host()) && host().querySelector('.cm-reading'), '辅助原文展开隐藏了主 Q/A。'); toggle.click();
      await wait(() => !shown(pane) && !document.querySelector('#capture-button').disabled, '详细原文没有收起。');
    });
    for (const mode of ['tree', 'snake']) await check(`${mode} 模式的 Q/A 节点定位完整正文并同步三个按钮`, async () => {
      await selectMode(mode);
      const answer = primaryMessages.find(row => row.sourceMessageId === 'a1'), node = [...host().querySelectorAll('.cm-diagram-node')].find(row => row.dataset.messageId === answer.id);
      expect(node, '目录图缺少确切答案节点。'); const treeRound = node.closest('.cm-tree-round'); if (treeRound) treeRound.open = true;
      node.click(); await wait(() => round(1)?.open && messageCard(answer.id)?.textContent.includes('V07-Q1-ANSWER-END'), '节点没有打开完整答案。');
      expect(messageCard(answer.id).classList.contains('cm-message-selected'), '节点没有定位确切原文消息。');
      if (mode === 'snake') await wait(() => host().querySelector('.cm-snake-lines > path[marker-end]'), '蛇形图缺少连接线。');
    });
    await check('83 轮目录图分页能继续展开并定位末轮', async () => {
      await selectConversation(large); await selectMode('snake');
      expect(host().querySelectorAll('.cm-diagram-node').length === 120, '首批应显示前60轮的120条 Q/A 节点。');
      const more = host().querySelector('.cm-more'); expect(more, '缺少后续目录图入口。'); more.click(); await tick();
      expect(host().querySelectorAll('.cm-diagram-node').length === 166, '83轮尾批节点未完整显示。');
      const end = [...host().querySelectorAll('.cm-diagram-node')].find(node => node.textContent.includes('V07-LARGE-A83-END')); expect(end, '缺少 A83 节点。'); end.click();
      await wait(() => host().querySelector('.cm-reading .cm-message-selected')?.textContent.includes('V07-LARGE-A83-END'), '末轮节点没有读取完整回答。');
      expect(host().querySelectorAll('.cm-reading .cm-message-selected').length === 1, '旧答案保留了选中框。');
      await wait(() => { const box = host().querySelector('.cm-message-selected').getBoundingClientRect(); return box.top >= -1 && box.top < innerHeight && box.bottom > 0; }, '答案节点没有把目标正文滚入可视区。');
    });
    await check('长正文后可用顶部切换按钮直接抵达 conversation 列表', async () => {
      document.querySelector('#conversation-switch').click();
      await wait(() => { const box = document.querySelector('#conversation-library').getBoundingClientRect(); return box.top >= -1 && box.top < innerHeight && box.bottom > 0; }, '切换按钮没有让 conversation 列表进入可视区。');
    });

    let original, versionsBefore, indexBefore;
    await check('未确认角色 conversation 展示所有正文且不冒充平台 Q/A', async () => {
      await selectMode('qa'); await selectConversation(unknown);
      findButton(host(), '展开全部正文').click();
      await wait(() => host().querySelectorAll('.cm-message').length === 2, '未确认正文没有完整显示。');
      expect(host().textContent.includes('V07-UNKNOWN-A-END') && host().textContent.includes('角色未确认'), '未确认正文或角色说明缺失。');
      expect([...host().querySelectorAll('.cm-round-title strong')].every(node => node.textContent.startsWith('正文')), '尚未标注时已伪造 Q/A。');
      original = await readState(); versionsBefore = JSON.stringify(original.versions.filter(row => row.projectId === project.id));
      indexBefore = JSON.stringify(Object.fromEntries(['qas', 'paths', 'segments', 'snapshots'].map(name => [name, original[name].filter(row => row.projectId === project.id)])));
    });
    await check('正文手动标为问题和回答后组成明确的阅读 Q/A', async () => {
      for (const [source, caption, role] of [['unknown-q', '标为问题', 'user'], ['unknown-a', '标为回答', 'assistant']]) {
        const message = unknownMessages.find(row => row.sourceMessageId === source);
        const card = messageCard(message.id); expect(card, '标注前没有找到目标正文。');
        const control = findButton(card, caption); expect(control && !control.disabled, '缺少可用的阅读标注按钮。'); control.click();
        await wait(async () => (await readState()).messages.find(row => row.id === message.id)?.confirmedRole === role && !!messageCard(message.id)?.textContent.includes('你标注') && !host().querySelector('.cm-loading'), '阅读标注未完成或正文未重新加载。');
      }
      await wait(() => [...host().querySelectorAll('.cm-round-title strong')].some(node => node.textContent.includes('Q1 → A1') && node.textContent.includes('你标注')), '阅读标注没有生成手动 Q/A。');
      expect(host().querySelectorAll('.cm-reading > .cm-round').length === 1 && host().querySelectorAll('.cm-message').length === 2, '手动阅读 Q/A 成员错误或正文遗漏。');
    });
    await check('阅读标注保留平台角色未知、正文版本和权威 Q/A 索引', async () => {
      const after = await readState(), messages = after.messages.filter(row => row.conversationId === unknown.id);
      expect(messages.every(row => row.role === 'unknown' && row.originalRole === 'unknown' && row.roleUnverified), '阅读标注改写平台角色。');
      expect(messages.every(row => row.text === original.messages.find(old => old.id === row.id)?.text && row.currentVersionId === original.messages.find(old => old.id === row.id)?.currentVersionId), '阅读标注改写正文或版本引用。');
      expect(JSON.stringify(after.versions.filter(row => row.projectId === project.id)) === versionsBefore, '阅读标注修改历史版本。');
      expect(JSON.stringify(Object.fromEntries(['qas', 'paths', 'segments', 'snapshots'].map(name => [name, after[name].filter(row => row.projectId === project.id)]))) === indexBefore, '阅读标注修改权威问答索引或采集结构。');
    });
    await check('项目备份及独立恢复保留手动阅读标签与原始角色', async () => {
      const backup = await command('backup', { projectId: project.id }); validateBackup(backup);
      const labels = backup.records.messages.filter(row => row.conversationId === unknown.id);
      expect(labels.length === 2 && labels.every(row => row.role === 'unknown' && row.roleUnverified && ['user', 'assistant'].includes(row.confirmedRole)), '备份没有保留阅读标签。');
      const draft = await createDraft({ kind: 'backup', filename: 'v07-synthetic-reading-label-backup.json', payload: backup }), restored = await saveDraft({ draftId: draft.id });
      const state = await readState(), restoredLabels = state.messages.filter(row => row.projectId === restored.projectId && row.roleUnverified);
      expect(restoredLabels.length === 2 && restoredLabels.every(row => row.role === 'unknown' && ['user', 'assistant'].includes(row.confirmedRole)), '恢复丢失标签或改写平台角色。');
      expect(restored.projectId !== project.id, '备份恢复没有建立独立项目。');
    });
  } catch (error) { failures.push({ name: 'V0.7 工作台验证执行', error: error.message }); }
  return report();
}
