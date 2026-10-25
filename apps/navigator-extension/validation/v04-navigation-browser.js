// Explicit synthetic examples, real repository/IndexedDB and product DOM. Excluded from package.
import { command, createDraft, saveDraft } from '../storage/repository.js';
import { parseImport } from '../importers/json.js';
import { ProjectNavigator } from '../ui/navigator.js';
import { Reader } from '../ui/reader.js';
import { visibleSegments, resolveReadingPosition } from '../domain/navigation.js';
import { el } from '../ui/dom.js';

export async function createV04Demo() {
  const project = await command('createProject', { name: '对话视觉导航器 · 示例项目' });
  const entries = [
    ['产品定位与插件范围', '产品', ['插件第一版应该解决什么问题？', '如何把长期项目与多条对话放在一起？', '小的 Q/A 怎样进入项目地图？', '本地保存和手动确认应该怎样工作？']],
    ['页面采集与来源保留', '工程', ['当前页面采集可以保存哪些内容？', '历史消息与其他分支如何区别？', '原文更新后怎样保留旧版本？', '来源范围和诊断信息如何显示？']],
    ['工作台布局与主题颜色', '界面', ['怎样让项目、对话和问答的层次更清楚？', '主题配色如何保持一致？', '阅读工具太多，怎样留出正文空间？', '窄侧栏如何展开项目导航？']],
    ['问答阅读与回溯路径', '记忆', ['怎样回到上次阅读的位置？', '片段拆分后怎样找到原来的问答？', '长回答如何展开而不丢失正文？', '怎样查看本轮的确切历史版本？']],
    ['下一轮验证与待办', '研究', ['真实浏览器安装后先验证哪一条流程？', '怎样确认所有问答成员仍然保留？', '项目备份恢复怎样核对？', '下一轮是否加入跨对话关联？']]
  ];
  const conversations = entries.map(([title, topic, questions], index) => ({ id: `v04-demo-${project.id}-${index}`, title, messages: questions.flatMap((text, ordinal) => [
    { id: `q-${ordinal}`, role: 'user', text },
    ...(index === 4 && ordinal === 3 ? [] : [{ id: `a-${ordinal}`, role: 'assistant', text: index === 2 && ordinal === 2 ?
      '## 把正文放在阅读的中心\n\n保留现有紫色主操作和主题色，按使用频率整理工具。\n\n- 项目导航可以收起。\n- 来源和编辑操作按需展开。\n- 问答目录支持逐轮跳转。\n\n| 阅读入口 | 作用 |\n| --- | --- |\n| 片段问答 | 查看连续讨论 |\n| 继续阅读 | 回到已存位置 |\n| 专注阅读 | 扩大正文区域 |\n\n所有入口都引用同一份问答和原文。' :
      `这是明确标记的合成示例，用来展示“${topic}”讨论的阅读与导航。\n\n### ${text}\n\n从真实保存的对话进入片段，再逐轮阅读完整问题和回答。主题颜色只标记导航，原文、来源及历史版本继续保留。\n\n选择项目地图中的任一入口，都应定位同一轮问答。` }])
  ]) }));
  const draft = await createDraft(await parseImport(JSON.stringify({ provider: 'v04-labelled-synthetic', conversations }), 'v04-ui-labelled-example.json'));
  await saveDraft({ draftId: draft.id, projectId: project.id, indices: conversations.map((_, index) => index) });
  let view = await command('view', { projectId: project.id });
  for (const conversation of view.conversations) {
    const index = entries.findIndex(entry => entry[0] === conversation.title);
    const suggestion = await command('organizationRules', { conversationId: conversation.id, pathId: conversation.currentPathId });
    const groups = suggestion.groups.map((group, i) => ({ ...group, title: i === 0 ? entries[index][0] : `${entries[index][0]} · 延伸讨论`, topics: index === 2 ? ['界面', '产品'] : [entries[index][1]] }));
    const updated = await command('organizationUpdate', { suggestionId: suggestion.id, baseRevision: suggestion.revision, groups });
    await command('organizationApply', { suggestionId: updated.id, baseRevision: updated.revision, reviewManual: true });
  }
  return { projectId: project.id, name: project.name, label: '所有内容均为合成示例；来源地址及时间未知。' };
}
export async function runV04BrowserValidation() {
  const checks = [], failures = [], callbacks = [];
  const check = async (name, fn) => { try { await fn(); checks.push(name); } catch (error) { failures.push({ name, error: error.message }); } };
  const expect = (condition, message) => { if (!condition) throw new Error(message); };
  const project = await command('createProject', { name: 'V0.4 导航验证 · 合成样例' });
  const payload = { provider: 'v04-synthetic', conversations: [{ id: crypto.randomUUID(), title: '65 轮分页验证 · 合成样例', messages: Array.from({ length: 65 }, (_, i) => [{ id: `q${i}`, role: 'user', text: `完整验证第 ${i + 1} 轮` }, ...(i === 64 ? [] : [{ id: `a${i}`, role: 'assistant', text: `ANSWER-${i + 1}-COMPLETE` }])]).flat() }] };
  const draft = await createDraft(await parseImport(JSON.stringify(payload), 'v04-labelled-65-example.json'));
  await saveDraft({ draftId: draft.id, projectId: project.id, indices: [0] });
  const view = await command('view', { projectId: project.id }), segments = visibleSegments(view), conversation = view.conversations[0];
  const section = el('section', { class: 'v04-fixture', style: 'padding:20px;background:white;border:2px solid #6366f1;flex:none;max-height:400px;overflow:auto' }), host = el('div'); section.append(host); document.body.append(section);
  const navigator = new ProjectNavigator(host, { onSegment: segment => callbacks.push(segment.id), onConversation: id => callbacks.push(id), onQA: qa => callbacks.push(qa.id), onReset: () => {} });
  await check('对话总览使用真实对话ID和完整成员数量', () => { navigator.render(segments, view, null, { mode: 'overview' }); host.querySelector('.overview-card').click(); expect(callbacks.at(-1) === conversation.id && host.textContent.includes('65 轮问答'), '总览引用或计数错误'); });
  await check('问答首批60轮、继续加载完整65轮且保留未回答状态', () => {
    navigator.render(segments, view, null, { mode: 'qas' }); expect(host.querySelectorAll('.qa-map-row').length === 60, '首批超过60轮');
    host.querySelector('.load-more').click(); expect(host.querySelectorAll('.qa-map-row').length === 65, '尾批遗漏'); expect(host.textContent.includes('未回答'), '未回答轮次被丢弃');
  });
  await check('来自阅读器的末页选择自动展开并高亮确切QA', () => {
    navigator.render(segments, view, null, { mode: 'snake' }); navigator.render(segments, view, null, { mode: 'qas' });
    const qa = view.qas.find(row => row.ordinal === 65), segment = segments.find(row => row.qaIds.includes(qa.id)); navigator.select(segment.id, false, qa.id);
    expect(host.querySelectorAll('.qa-map-row').length === 65 && host.querySelector('.qa-map-row.selected')?.dataset.qaId === qa.id, '末页未展开或选中错误');
    host.querySelector('.qa-map-row.selected').click(); expect(callbacks.at(-1) === qa.id, '点击未传真实QA');
  });
  await check('主题折叠状态在筛选重绘后保留', async () => {
    navigator.render(segments, view, null, { mode: 'topics' }); const detail = host.querySelector('.topic-tree'); detail.querySelector('summary').click();
    await new Promise(resolve => setTimeout(resolve, 25)); const open = detail.open;
    navigator.render(segments, view, null, { mode: 'topics' }); expect(host.querySelector('.topic-tree').open === open, '显式折叠被重置');
  });
  await check('片段问答入口仅显示对应成员，阅读器保留所有正文操作', async () => {
    navigator.render(segments, view, null, { mode: 'qas', segmentId: segments[0].id }); expect(host.querySelectorAll('.qa-map-row').length === segments[0].qaIds.length, '片段范围错误');
    const readerHost = el('div'); section.append(readerHost); let browseId;
    const reader = new Reader(readerHost, { api: command, onSelect: () => {}, onBrowse: segment => { browseId = segment.id; }, onError: message => { throw new Error(message); } }); reader.setView(view); await reader.showSegment(segments[0].id);
    [...readerHost.querySelectorAll('button')].find(node => node.textContent === '查看本段问答列表').click();
    expect(browseId === segments[0].id && readerHost.textContent.includes('ANSWER-1-COMPLETE'), '成员入口或正文缺失');
    expect(readerHost.querySelector('.reader-edit-menu') && readerHost.querySelector('.reader-context'), '来源或编辑入口丢失');
  });
  await check('真实拆分后阅读位置恢复到新片段且保留同一QA', async () => {
    const first = segments[0]; if (first.qaIds.length < 2) {
      const next = segments[1]; await command('editSegment', { operation: 'merge', segmentId: first.id, otherSegmentId: next.id, otherBaseRevision: next.revision, baseRevision: first.revision });
    }
    let updated = await command('view', { projectId: project.id }); const merged = updated.segments.find(row => row.active && row.qaIds.includes(first.qaIds[0])), qaId = merged.qaIds.at(-1);
    const qa = updated.qas.find(row => row.id === qaId), position = { projectId: project.id, qaId, pathId: qa.pathId, conversationId: qa.conversationId, segmentId: merged.id };
    await command('editSegment', { operation: 'split', segmentId: merged.id, baseRevision: merged.revision, afterQAId: merged.qaIds[0] });
    updated = await command('view', { projectId: project.id }); const resumed = resolveReadingPosition(updated, position);
    expect(resumed?.qa.id === qaId && resumed.segment.id !== position.segmentId, '拆分后位置失效');
  });
  section.remove(); return { passed: checks.length, failed: failures.length, checks, failures, checkedAt: new Date().toISOString(), environment: 'Actual Chromium DOM + repository + IndexedDB; labelled synthetic data; Chrome APIs bridged.' };
}
