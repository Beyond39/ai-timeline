import { el, button, badge, ask, rpc, labelRole, labelStatus, savedTime, timeLabel, plainBody } from './dom.js';
import { Reader } from './reader.js';
import { SnakeMap } from './map.js';
import { OrganizationPanel } from './organization.js';
import { TopicManager } from './topics.js';

const $ = selector => document.querySelector(selector);
const panel = document.body.dataset.mode === 'panel';
const parameters = new URLSearchParams(location.search);
const sourceTabId = parameters.has('sourceTab') ? Number(parameters.get('sourceTab')) : null;
let projects = [], view = null, busy = 0, searchEpoch = 0, exportURL = null;
let selection = { projectId: null, conversationId: null, filterConversationId: '', pathId: null, segmentId: null, qaId: null, topicId: '', stateFilter: '', allPaths: false, query: '' };
const notice = (text, error = false) => { $('#notice').hidden = !text; $('#notice').textContent = text; $('#notice').classList.toggle('error', error); };
const persist = () => chrome.storage.local.set({ navigatorSelection: selection });
const guard = fn => async (...args) => {
  if (busy) return; busy++; $('#capture-button').disabled = true; $('#import-button').disabled = true;
  try { await fn(...args); } catch (e) { notice(e.message, true); }
  finally { busy--; $('#capture-button').disabled = false; $('#import-button').disabled = false; }
};
const map = new SnakeMap($('#map'), segment => guard(() => reader.showSegment(segment.id))());
const reader = new Reader($('#reader'), {
  api: rpc, onError: message => notice(message, true), onEdit: (operation, segment) => guard(() => edit(operation, segment))(), onMove: conversation => guard(() => move(conversation))(),
  onSelect: async (qa, segment) => {
    Object.assign(selection, { conversationId: qa.conversationId, pathId: qa.pathId, qaId: qa.id, segmentId: segment?.id ?? null });
    if (segment && !visibleSegments().some(s => s.id === segment.id)) { selection.topicId = ''; selection.stateFilter = ''; selection.filterConversationId = qa.conversationId; renderMap(); }
    map.select(segment?.id, !panel); renderPathChoices(); await persist();
  }
});
const organizer = new OrganizationPanel({ api: rpc, onError: message => notice(message, true),
  onApplied: async result => {
    Object.assign(selection, { conversationId: result.conversationId ?? selection.conversationId, pathId: result.pathId ?? selection.pathId,
      filterConversationId: result.conversationId ?? selection.conversationId, segmentId: result.segmentId, qaId: null, topicId: '', stateFilter: '' });
    await reload(true); notice('整次整理已确认，地图已更新；全部问答与原文保留，可撤销最近修改。');
  },
  onNavigate: async target => {
    Object.assign(selection, { conversationId: target.conversationId, filterConversationId: target.conversationId, pathId: target.pathId, topicId: '', stateFilter: '' });
    await reload();
    if (target.qaId) await reader.showPath(target.conversationId, target.pathId, target.qaId, '', target.messageId);
    if (target.messageId) await reader.showConversation(target.conversationId, target.pathId, target.messageId, 0, '', target.versionId ?? null);
  }
});
const topicManager = new TopicManager({ api: rpc, onError: message => notice(message, true), onChanged: async () => { await reload(true); notice('主题更新已保存，同一项目的颜色与引用已同步。'); } });
function fillProjects() {
  const control = $('#project-select'); control.replaceChildren(...projects.map(p => el('option', { value: p.id, text: `${p.name}（${p.conversationCount} 条对话）` })));
  if (!projects.length) control.append(el('option', { value: '', text: '尚无项目 · 采集后创建' }));
  control.value = selection.projectId ?? '';
  for (const selector of ['#rename-project', '#export-button', '#delete-project', '#manage-topics']) $(selector).disabled = !view;
  $('#organize-button').disabled = !view?.conversations.length;
}
async function reload(restoreReader = false) {
  const previousProjectId = view?.project.id;
  projects = await rpc('projects');
  if (!projects.some(p => p.id === selection.projectId)) selection.projectId = projects[0]?.id ?? null;
  view = selection.projectId ? await rpc('view', { projectId: selection.projectId }) : null;
  if (previousProjectId !== view?.project.id) { searchEpoch++; $('#search-results').hidden = true; $('#search-results').replaceChildren(); }
  fillProjects();
  if (!view) {
    $('#map-title').textContent = '先保存一条真实对话'; $('#project-stats').textContent = '数据只保存在这个浏览器的插件内。';
    $('#map-count').textContent = '0 轮'; $('#conversation-select').replaceChildren(el('option', { text: '暂无对话', value: '' }));
    $('#path-select').replaceChildren(el('option', { text: '暂无路径', value: '' })); $('#conversation-list').replaceChildren();
    $('#legend').replaceChildren(); $('#topic-filter').replaceChildren(el('option', { text: '所有主题', value: '' }));
    map.render([], { conversations: [], topics: [] }, null); $('#undo-button').disabled = true;
    $('#reader').replaceChildren(el('div', { class: 'empty' }, [el('h2', { text: '从真实对话开始' }), el('p', { text: '在 ChatGPT 对话页点击插件图标，再点击采集。也可以导入 conversations.json 或现有通用 JSON。' })])); return;
  }
  reader.setView(view);
  if (selection.topicId && selection.topicId !== '__none' && !view.topics.some(t => t.id === selection.topicId)) selection.topicId = '';
  if (selection.conversationId && !view.conversations.some(c => c.id === selection.conversationId)) Object.assign(selection, { conversationId: null, pathId: null, qaId: null, segmentId: null });
  if (!view.conversations.some(c => c.id === selection.filterConversationId)) selection.filterConversationId = '';
  const pending = view.suggestions.filter(s => ['pending', 'needs_review'].includes(s.status));
  $('#project-stats').textContent = `${view.conversations.length} 条对话 · ${view.segments.filter(s => s.active).length} 个片段 · ${view.qas.length} 个路径轮次 · ${pending.length} 条待处理建议（分支共享的问题按路径分别计数）`;
  $('#map-title').textContent = view.project.name; $('#map-subtitle').textContent = '来源已知时按对话时间排列；时间未知时保留对话内顺序。每个节点展开真实成员。';
  const conversationSelect = $('#conversation-select');
  conversationSelect.replaceChildren(el('option', { value: '', text: '全部对话 · 项目地图' }), ...view.conversations.map(c => el('option', { value: c.id, text: c.title })));
  conversationSelect.value = selection.filterConversationId;
  $('#conversation-list').replaceChildren(...view.conversations.map(c => {
    const control = button('', guard(() => chooseConversation(c.id)), `conversation-item ${selection.conversationId === c.id ? 'selected' : ''}`);
    control.append(el('strong', { text: c.title }), el('span', { class: 'muted', text: `${view.paths.filter(p => p.conversationId === c.id).length} 条已存路径 · ${c.lastScope?.kind === 'loaded_page' ? '页面部分采集' : '文件范围'}` })); return control;
  }));
  $('#topic-filter').replaceChildren(el('option', { value: '', text: '所有主题' }), el('option', { value: '__none', text: '未分类' }), ...view.topics.map(t => el('option', { value: t.id, text: t.name })));
  $('#topic-filter').value = selection.topicId; $('#all-paths').checked = selection.allPaths;
  $('#undo-button').disabled = !view.undoAvailable; renderPathChoices(); renderMap();
  if (restoreReader) {
    const existing = view.segments.find(s => s.id === selection.segmentId && s.active);
    if (existing) await reader.showSegment(existing.id, selection.qaId);
    else if (selection.conversationId) {
      const c = view.conversations.find(c => c.id === selection.conversationId);
      const pathId = view.paths.some(p => p.id === selection.pathId) ? selection.pathId : c.currentPathId ?? view.paths.find(p => p.conversationId === c.id)?.id;
      await reader.showPath(c.id, pathId, selection.qaId);
    }
  }
  if (!selection.conversationId) $('#reader').replaceChildren(el('div', { class: 'empty' }, [el('h2', { text: '选择项目中的讨论片段' }), el('p', { text: '每个节点均来自这个项目实际保存的 Q/A；空项目可通过采集或导入加入对话。' })]));
  await persist();
}
function renderPathChoices() {
  if (!view) return;
  const control = $('#path-select'), c = view.conversations.find(c => c.id === (selection.conversationId || selection.filterConversationId));
  if (!c) { control.replaceChildren(el('option', { value: '', text: '选择对话后可切换分支' })); control.disabled = true; return; }
  control.disabled = false;
  const paths = view.paths.filter(p => p.conversationId === c.id);
  control.replaceChildren(...paths.map(p => el('option', { value: p.id, text: `${p.id === c.currentPathId ? '当前已确认 · ' : ''}${p.label}（${view.qas.filter(q => q.pathId === p.id).length} 轮）` })));
  control.value = paths.some(p => p.id === selection.pathId) ? selection.pathId : c.currentPathId ?? paths[0]?.id ?? '';
}
function visibleSegments() {
  if (!view) return [];
  const ids = new Set(view.conversations.filter(c => !selection.filterConversationId || c.id === selection.filterConversationId).map(c => c.id));
  const selectedPaths = new Map(view.conversations.map(c => [c.id, c.id === selection.conversationId && view.paths.some(p => p.id === selection.pathId) ? selection.pathId : c.currentPathId ?? view.paths.find(p => p.conversationId === c.id)?.id]));
  const conversationOrder = view.conversations.slice().sort((a, b) => {
    const timeA = a.sourceTime?.value, timeB = b.sourceTime?.value;
    if (timeA && timeB) return timeA.localeCompare(timeB);
    if (timeA || timeB) return timeA ? -1 : 1;
    return view.conversations.indexOf(a) - view.conversations.indexOf(b);
  });
  const positions = new Map(conversationOrder.map((c, i) => [c.id, i])); const pathOrder = new Map(view.paths.map((p, i) => [p.id, i]));
  return view.segments.filter(s => s.active && ids.has(s.conversationId) && (selection.allPaths || s.pathId === selectedPaths.get(s.conversationId)) &&
    (!selection.stateFilter || (selection.stateFilter === 'pending' ? s.pendingSuggestionIds?.length : selection.stateFilter === 'needs_review' ? s.organizationStatus === 'needs_review' || s.suggestionNeedsReview : s.organizationStatus === selection.stateFilter)) &&
    (!selection.topicId || (selection.topicId === '__none' ? !s.topicIds.length : s.topicIds.includes(selection.topicId)))).sort((a, b) => positions.get(a.conversationId) - positions.get(b.conversationId) || pathOrder.get(a.pathId) - pathOrder.get(b.pathId) || a.ordinal - b.ordinal);
}
function renderMap() {
  if (!view) return;
  const segments = visibleSegments(); $('#map-count').textContent = `${segments.length} 个片段 · ${segments.reduce((total, s) => total + s.qaIds.length, 0)} 轮`;
  $('#topic-filter').value = selection.topicId; $('#conversation-select').value = selection.filterConversationId;
  $('#state-filter').value = selection.stateFilter;
  const topics = view.topics.filter(t => view.segments.some(s => s.active && s.topicIds.includes(t.id)));
  $('#legend').replaceChildren(button('全部主题', () => { selection.topicId = ''; renderMap(); persist(); }), ...topics.map(topic => {
    const control = button('', () => { selection.topicId = selection.topicId === topic.id ? '' : topic.id; renderMap(); persist(); });
    const dot = el('span', { class: 'color-dot' }); dot.style.setProperty('--topic-color', topic.color); control.append(dot, document.createTextNode(topic.name)); return control;
  }), el('span', { class: 'muted', text: '灰色：未分类' }));
  map.render(segments, view, selection.segmentId);
}
async function chooseConversation(conversationId) {
  selection.filterConversationId = conversationId; selection.conversationId = conversationId;
  selection.segmentId = null; selection.qaId = null;
  const conversation = view.conversations.find(c => c.id === conversationId);
  if (conversation) {
    selection.pathId = conversation.currentPathId ?? view.paths.find(p => p.conversationId === conversationId)?.id;
    renderPathChoices(); renderMap(); await reader.showPath(conversationId, selection.pathId);
  } else { renderMap(); await persist(); }
}
async function edit(operation, segment) {
  const args = { operation, segmentId: segment.id, baseRevision: segment.revision };
  if (operation === 'rename') {
    const values = await ask('重命名讨论片段', [{ name: 'title', label: '片段标题', value: segment.title }], '只修改导航标题，完整问题与回答原文继续保留。'); if (!values) return; args.title = values.title;
  } else if (operation === 'topics') {
    const names = segment.topicIds.map(k => view.topics.find(t => t.id === k)?.name ?? '').join('，');
    const values = await ask('设置主题标签', [{ name: 'names', label: '主题名称，以逗号分隔；第一个作为地图主色', value: names, required: false }], '同名主题在这个项目中使用同一个持久颜色。留空表示未分类。'); if (!values) return; args.names = values.names;
  } else if (operation === 'split') {
    const values = await ask('选择 Q/A 拆分边界', [{ name: 'afterQAId', label: '在这一轮之后拆分', options: segment.qaIds.slice(0, -1).map(k => { const q = view.qas.find(q => q.id === k); return { value: k, label: `第 ${q.ordinal} 轮 · ${q.preview}` }; }) }], `当前 ${segment.qaIds.length} 轮将分成两段；全部成员和原文保留。`); if (!values) return; args.afterQAId = values.afterQAId;
  } else if (operation === 'merge') {
    const ordered = view.segments.filter(s => s.active && s.pathId === segment.pathId).sort((a, b) => a.ordinal - b.ordinal);
    const next = ordered[ordered.findIndex(s => s.id === segment.id) + 1]; if (!next) throw new Error('当前已是本路径最后一段，没有下一相邻段可合并。');
    const values = await ask('合并相邻讨论片段', [], `“${segment.title}”（${segment.qaIds.length} 轮）＋“${next.title}”（${next.qaIds.length} 轮）→ ${segment.qaIds.length + next.qaIds.length} 轮。两段属于同一对话与阅读路径，合并保留第一段标题与两段主题。`); if (!values) return;
    args.otherSegmentId = next.id; args.otherBaseRevision = next.revision;
  }
  const result = await rpc('editSegment', args); selection.segmentId = result.segmentId; await reload(true); notice('人工修改已保存，可撤销最近修改；重新采集会保留你的标题、主题和边界。');
}
async function move(conversation) {
  const values = await ask('调整这条对话的本地项目', [{ name: 'projectId', label: '目标项目', value: conversation.projectId, options: projects.map(p => ({ value: p.id, label: p.name })) }], '连同消息、版本、Q/A、分段和人工修订一起移动。来源原生项目另行记录。'); if (!values || values.projectId === conversation.projectId) return;
  await rpc('moveConversation', { conversationId: conversation.id, projectId: values.projectId }); selection.projectId = values.projectId; await reload(true); notice('对话及人工整理已移入目标本地项目。');
}
async function runSearch(offset = 0) {
  if (!view) throw new Error('请先创建或选择项目。');
  const query = $('#search-input').value.trim(); selection.query = query; const epoch = ++searchEpoch;
  if (!query) { $('#search-results').hidden = true; return; }
  const data = await rpc('search', { projectId: view.project.id, query, offset }); if (epoch !== searchEpoch) return;
  const host = $('#search-results'); host.hidden = false;
  if (!offset) host.replaceChildren(el('h3', { text: `原文搜索 · ${data.total} 个结果` })); else host.querySelector('.load-more')?.remove();
  data.results.forEach(result => {
    const control = button('', guard(async () => {
      selection.conversationId = result.conversationId; selection.filterConversationId = result.conversationId; selection.topicId = '';
      if (result.qaId) {
        const q = view.qas.find(q => q.id === result.qaId); selection.pathId = q.pathId; renderMap(); renderPathChoices();
        await reader.showPath(q.conversationId, q.pathId, q.id, query, result.messageId);
      } else { renderMap(); await reader.showConversation(result.conversationId, result.pathId ?? null, result.messageId, 0, query); }
    }), 'search-result');
    control.append(el('strong', { text: `${result.title} · ${result.type === 'title' ? '对话标题' : labelRole(result.type)}` }), el('p', { text: result.excerpt })); host.append(control);
  });
  if (!data.total) host.append(el('p', { class: 'muted', text: '这个项目的已保存正文中没有匹配内容。可换词，或采集 / 导入更多历史。' }));
  if (data.nextOffset !== null) host.append(button(`继续读取结果（已显示 ${offset + data.results.length} / ${data.total}）`, guard(() => runSearch(data.nextOffset)), 'btn load-more'));
  await persist();
}
function previewMessages(container, messages) {
  let limit = 0; const show = () => {
    container.querySelector('.load-more')?.remove(); const end = Math.min(limit + 15, messages.length);
    for (let i = limit; i < end; i++) {
      const m = messages[i]; const card = el('article', { class: 'message-card' }, [el('strong', { text: `${i + 1} · ${labelRole(m.role)}` }), plainBody(m.text || (m.contentStatus === 'empty' ? '（来源提供了空正文）' : '（正文未取得）')),
        el('p', { class: 'message-info', text: `${timeLabel(m.time)} · 源消息 ID：${m.sourceMessageId ?? '未知'} · 源节点 ID：${m.sourceNodeId ?? '未知'} · ${m.attachments.length} 个非文本 / 附件引用` })]);
      if (m.streaming === 'generating') card.append(badge('正在生成，稍后更新', 'warning')); container.append(card);
    }
    limit = end; if (limit < messages.length) container.append(button(`预览更多消息（${limit} / ${messages.length}）`, show, 'btn load-more'));
  }; show();
}
function showPreview(draft) {
  const dialog = $('#preview-dialog'); dialog.replaceChildren();
  const close = () => dialog.close();
  dialog.append(el('div', { class: 'dialog-header' }, [el('h2', { text: draft.kind === 'backup' ? '项目备份恢复预览' : '采集 / 导入预览' }), button('关闭', close)]));
  const content = el('div', { class: 'dialog-body' });
  content.append(el('p', { class: 'muted', text: draft.filename ? `文件：${draft.filename}${draft.isExample ? ' · 明确标记：示例文件' : ''}` : '本次由你主动触发，仅读取当前页面实际可取得的内容。' }));
  const choices = projects.map(p => el('option', { value: p.id, text: p.name }));
  const target = el('select', {}, [el('option', { value: draft.kind === 'backup' ? '__restore' : '__new', text: draft.kind === 'backup' ? '恢复为独立的新项目（保留全部人工整理）' : '＋ 创建新的本地项目' }), ...choices]);
  const newName = el('input', { placeholder: '新项目名称', value: draft.projectHint ?? '' });
  const existingProject = draft.conversations?.find(c => c.existing)?.existing.projectId;
  if (draft.kind !== 'backup') target.value = draft.targetProjectId ?? existingProject ?? selection.projectId ?? '__new';
  const native = el('input', { placeholder: '可选：手动记录来源原生项目名；留空保留已取得信息' });
  const projectNote = el('p', { class: 'muted' });
  const updateTarget = () => {
    newName.hidden = target.value !== '__new';
    const moves = draft.conversations?.some(c => c.existing && c.existing.projectId !== target.value && target.value !== '__new');
    projectNote.textContent = draft.kind === 'backup' ? '恢复使用新的本地对象 ID，保留来源 ID、版本链、成员关系与人工调整；选择现有项目会追加一份恢复记录。' : moves ? '所选项目与已有记录不同：保存会将这些已识别对话及其人工整理移到所选项目。' : '同一对话再次保存会增量更新；未采集到的旧消息继续保留。';
  };
  target.addEventListener('change', updateTarget); updateTarget();
  content.append(el('label', { class: 'field' }, [el('span', { text: '本地项目归属' }), target]), newName, projectNote);
  if (draft.kind !== 'backup') content.append(el('label', { class: 'field' }, [el('span', { text: '来源原生项目（与插件本地项目分别保存）' }), native]));
  dialog.append(content);
  const checks = [], pathSelects = [], list = el('div', { class: 'preview-list' });
  if (draft.kind === 'backup') list.append(el('p', { text: `项目：${draft.projectName} · ${draft.counts.conversations} 条对话 · ${draft.counts.messages} 条消息 · ${draft.counts.segments} 个有效 Segment。备份结构关系已静态解析，恢复后由你实际核对。` }));
  else draft.conversations.forEach(c => {
    const check = el('input', { type: 'checkbox', checked: true }); checks.push({ index: c.index, check });
    const block = el('div', { class: 'preview-conversation' }, [el('label', { class: 'check' }, [check, el('h3', { text: c.title })]),
      el('div', { class: 'reader-meta' }, [badge(`${c.messages.length} 条消息`), badge(`${c.messages.filter(m => m.role === 'user').length} 条用户问题`), badge(`${c.paths.length} 条可读路径`), c.existing ? badge(`已有对话 · 已存 ${c.existing.savedMessages} 条`, 'good') : badge('新对话')]),
      el('p', { class: 'message-info', text: `来源地址：${c.sourceUrl ?? '未知（文件未提供实际地址）'}\n来源对话标识：${c.sourceConversationId ?? '未知'}\n标识依据：${c.identityBasis}\n来源时间：${timeLabel(c.sourceTime)}\n采集时间：${savedTime(c.capturedAt)}\n方法：${c.method}\n范围：${c.scope.description}\n角色：${[...new Set(c.messages.map(m => labelRole(m.role)))].join('、')}` })]);
    if (c.paths.length) {
      const path = el('select', {}, [el('option', { value: '', text: '当前路径未知 / 仅保存关系，稍后选择浏览' }), ...c.paths.map(p => el('option', { value: p.key, text: `${p.label} · ${p.messageKeys.length} 条消息 · ${p.status}` }))]);
      path.value = c.currentPathKey ?? ''; pathSelects.push({ index: c.index, path });
      block.append(el('label', { class: 'field' }, [el('span', { text: '当前阅读路径：有可靠 current_node 时已恢复；其他分支分别保存' }), path]));
    }
    block.append(el('div', { class: 'preview-warnings' }, [el('ul', {}, c.warnings.map(w => el('li', { text: w })))]));
    const messages = el('div', { class: 'preview-messages' }); const detail = el('details', {}, [el('summary', { text: '检查实际取得的消息正文（分批预览）' }), messages]);
    detail.addEventListener('toggle', () => { if (detail.open && !messages.childNodes.length) previewMessages(messages, c.messages); });
    block.append(detail); list.append(block);
  });
  dialog.append(list);
  const save = button(draft.kind === 'backup' ? '恢复项目备份' : '保存到本地项目', guard(async () => {
    const indices = checks.filter(c => c.check.checked).map(c => c.index);
    if (draft.kind !== 'backup' && !indices.length) throw new Error('请至少选择一条对话。');
    if (target.value === '__new' && !newName.value.trim()) throw new Error('请输入新项目名称。');
    save.disabled = true;
    try {
      const result = await rpc('saveDraft', { draftId: draft.id, indices, projectId: target.value.startsWith('__') ? null : target.value,
        newProjectName: target.value === '__new' ? newName.value.trim() : null, pathSelections: Object.fromEntries(pathSelects.filter(p => p.path.value).map(p => [p.index, p.path.value])), manualNative: native.value.trim() || null });
      close(); selection.projectId = result.results?.[0]?.projectId ?? result.projectId;
      const first = result.results?.[0];
      if (first) Object.assign(selection, { conversationId: first.conversationId, filterConversationId: first.conversationId, pathId: first.pathId, segmentId: null, qaId: null, topicId: '' });
      else Object.assign(selection, { conversationId: null, filterConversationId: '', pathId: null, qaId: null, segmentId: null, topicId: '' });
      await reload(true);
      if (result.failures?.length) notice(`已保存 ${result.results.length} 条；${result.failures.length} 条失败，已保留预览供重试：\n${result.failures.map(f => `${f.title}：${f.error}`).join('\n')}`, true);
      else notice(result.restored ? '备份已恢复，原文、版本、成员与人工调整已写入本地项目。' : `已保存 ${result.results.length} 条对话。新增 ${result.results.reduce((sum, r) => sum + r.createdMessages, 0)} 条消息；正文变化 ${result.results.reduce((sum, r) => sum + r.changedMessages, 0)} 条；上下文匹配 ${result.results.reduce((sum, r) => sum + r.uncertainMatches, 0)} 条（依据已记录）。`);
    } finally { save.disabled = false; }
  }), 'btn primary');
  dialog.append(el('div', { class: 'preview-footer' }, [el('p', { class: 'footnote', text: '保存后的全部正文可在阅读器访问。回答生成中可先保留快照，稍后主动更新。' }),
    el('div', { class: 'actions' }, [button('丢弃此预览', guard(async () => { await rpc('discardDraft', { draftId: draft.id }); close(); })), button('稍后处理', close), save])]));
  if (!dialog.open) dialog.showModal();
}
$('#capture-button').addEventListener('click', guard(async () => {
  notice('正在识别当前 ChatGPT 页，并观察消息是否仍在变化…');
  showPreview(await rpc('capture', { sourceTabId: panel ? null : sourceTabId })); notice('已读取采集预览，请核对范围、角色和正文后保存。');
}));
$('#import-button').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', guard(async event => {
  const file = event.target.files[0]; if (!file) return;
  notice(`正在解析 ${file.name}…`);
  try { showPreview(await rpc('importPreview', { text: await file.text(), filename: file.name })); notice('导入预览已准备好；保存前可选择对话、项目及阅读路径。'); } finally { event.target.value = ''; }
}));
$('#open-workspace').addEventListener('click', guard(() => rpc('openWorkspace', selection)));
$('#refresh-button').addEventListener('click', guard(async () => { await reload(true); const draft = await rpc('latestDraft'); if (draft) showPreview(draft); notice('已重新读取本地保存数据。'); }));
$('#new-project').addEventListener('click', guard(async () => {
  const values = await ask('创建本地项目', [{ name: 'name', label: '项目名称' }], '可以将多条来源对话归入同一个长期项目。'); if (!values) return;
  const project = await rpc('createProject', values); Object.assign(selection, { projectId: project.id, conversationId: null, filterConversationId: '', pathId: null, segmentId: null, qaId: null }); await reload(); notice('项目已创建，可以开始采集或导入。');
}));
$('#rename-project').addEventListener('click', guard(async () => {
  const values = await ask('重命名本地项目', [{ name: 'name', label: '项目名称', value: view.project.name }]); if (!values) return;
  await rpc('renameProject', { projectId: view.project.id, ...values }); await reload(true);
}));
$('#project-select').addEventListener('change', guard(async event => {
  Object.assign(selection, { projectId: event.target.value, conversationId: null, filterConversationId: '', pathId: null, qaId: null, segmentId: null, topicId: '' }); await reload();
  $('#reader').replaceChildren(el('div', { class: 'empty' }, [el('h2', { text: '选择项目中的讨论片段' }), el('p', { text: '所有节点均来自这个项目实际保存的 Q/A。' })]));
}));
$('#conversation-select').addEventListener('change', guard(event => chooseConversation(event.target.value)));
$('#path-select').addEventListener('change', guard(async event => {
  selection.pathId = event.target.value; selection.segmentId = null; selection.qaId = null; renderMap(); await reader.showPath(selection.conversationId || selection.filterConversationId, selection.pathId);
}));
$('#all-paths').addEventListener('change', event => { selection.allPaths = event.target.checked; renderMap(); persist(); });
$('#topic-filter').addEventListener('change', event => { selection.topicId = event.target.value; renderMap(); persist(); });
$('#search-form').addEventListener('submit', event => { event.preventDefault(); guard(() => runSearch())(); });
$('#clear-search').addEventListener('click', () => { searchEpoch++; $('#search-input').value = ''; selection.query = ''; $('#search-results').hidden = true; persist(); });
$('#undo-button').addEventListener('click', guard(async () => { const result = await rpc('undo', { projectId: view.project.id }); selection.segmentId = result.segmentId; selection.qaId = null; await reload(true); notice('最近的人工修改已撤销，反向修订也已保留。'); }));
$('#organize-button').addEventListener('click', guard(async () => {
  const conversationId = selection.conversationId || selection.filterConversationId || view.conversations[0]?.id;
  if (!conversationId) throw new Error('请先保存一条对话。');
  selection.conversationId = conversationId;
  const conversation = view.conversations.find(c => c.id === conversationId);
  const pathId = view.paths.some(p => p.id === selection.pathId && p.conversationId === conversationId) ? selection.pathId : conversation.currentPathId ?? view.paths.find(p => p.conversationId === conversationId)?.id;
  selection.pathId = pathId; await organizer.open({ conversationId, pathId });
}));
$('#manage-topics').addEventListener('click', guard(() => topicManager.open(view)));
$('#state-filter').addEventListener('change', event => { selection.stateFilter = event.target.value; renderMap(); persist(); });
$('#export-button').addEventListener('click', guard(async () => {
  const backup = await rpc('backup', { projectId: view.project.id }); if (exportURL) URL.revokeObjectURL(exportURL);
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })); exportURL = url;
  const link = el('a', { href: url, download: `${view.project.name.replace(/[<>:"/\\|?*]/g, '_')}-ACVN-backup-${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })}.json` }); document.body.append(link); link.click(); link.remove();
  notice('项目备份已准备，内容包含完整原文、来源、版本链、Q/A、Segment 成员及人工调整。');
  $('#notice').append(document.createTextNode(' '), el('a', { href: url, download: link.download, text: '点击下载备份 JSON' }));
}));
$('#delete-project').addEventListener('click', guard(async () => {
  const name = view.project.name; const values = await ask('删除本地项目及原始数据', [{ name: 'confirmName', label: `输入项目名“${name}”确认` }], '这会删除该本地项目的对话、消息、版本、地图与修订。需要保留时先导出备份。'); if (!values) return;
  await rpc('deleteProject', { projectId: view.project.id, confirmName: values.confirmName }); Object.assign(selection, { projectId: null, conversationId: null, filterConversationId: '', qaId: null, segmentId: null }); await reload(); notice('本地项目及其已保存原始数据已删除。');
}));
chrome.runtime.onMessage.addListener(message => {
  if (message.event === 'progress') notice(`正在保存 ${message.processed} / ${message.total} 条对话${message.title ? ` · ${message.title}` : ''}。已完成条目会独立提交。`);
  if (message.event === 'changed' && !busy && !$('#preview-dialog').open && !$('#edit-dialog').open && !organizer.isOpen) guard(() => reload(true))();
});
async function initialize() {
  const settings = await chrome.storage.local.get('navigatorSelection'); selection = { ...selection, ...settings.navigatorSelection };
  for (const key of ['projectId', 'conversationId', 'pathId', 'segmentId', 'qaId']) if (parameters.has(key)) selection[key] = parameters.get(key);
  if (parameters.has('conversationId')) selection.filterConversationId = selection.conversationId;
  await reload(true); $('#search-input').value = selection.query ?? '';
  if (selection.query && view) await runSearch();
  const draft = await rpc('latestDraft'); if (draft) showPreview(draft);
}
guard(initialize)();
