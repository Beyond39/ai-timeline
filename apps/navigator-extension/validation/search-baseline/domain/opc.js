import { id, now, copy, fail } from './common.js';
import { readingParts, bodyPreview, markdownPreview, visibility } from './qa-content.js';
import { answerValidity } from './qa-validity.js';
import { repairConversation } from './qa-repair.js';
import { cardMetadata, CARD_TYPES, ORGANIZATION_STATES, ADOPTION_STATES, metadataTopics } from './card-metadata.js';
import { RELEASE_STORES, assertRelease, CONFIRMATION_STATES } from './release-data.js';

export const OPC_CORE_STORES = ['qaCards', 'qaMetadata', 'timelines', 'memberships', 'relationships', 'canvasLayouts', 'relationTypes', 'qaRepairArchives'];
export const OPC_STORES = [...OPC_CORE_STORES, ...RELEASE_STORES];
export const DEFAULT_RELATIONS = ['延续', '补充', '修正', '推翻', '反驳', '依赖', '引用', '启发', '主题相关'];
export const cardId = (conversationId, questionId) => `card:${conversationId}:${questionId}`;
export const sourceTimelineId = conversationId => `timeline:${conversationId}`;
const dateFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' });
export function initializeOPC(state) { for (const store of OPC_STORES) state[store] ??= []; }
export function syncCards(state, conversation) {
  initializeOPC(state);
  const messages = new Map(state.messages.filter(m => m.conversationId === conversation.id).map(m => [m.id, m]));
  const current = state.paths.find(p => p.id === conversation.currentPathId);
  const graphConfirmed = ['provided_graph', 'complete_graph'].includes(conversation.lastScope?.branches) && current?.status === 'reliable_graph';
  const questionSlots = new Map();
  if (graphConfirmed) for (const m of messages.values()) if (m.role === 'user' && !m.isAuxiliary && m.sourceNodeId && m.sourceParentKey) {
    const slot = questionSlots.get(m.sourceParentKey) ?? []; slot.push(m.id); questionSlots.set(m.sourceParentKey, slot);
  }
  const groups = new Map(), canonicalQuestions = new Map();
  if (graphConfirmed) for (const c of state.qaCards.filter(c => c.conversationId === conversation.id)) {
    const m = messages.get(c.userMessageId); if (!m?.sourceNodeId || !m.sourceParentKey || m.role !== 'user') continue;
    const group = groups.get(m.sourceParentKey) ?? []; group.push(c); groups.set(m.sourceParentKey, group);
  }
  for (const group of groups.values()) if (group.length > 1) for (const c of group) canonicalQuestions.set(c.id, group[0].logicalUserMessageId ?? group[0].userMessageId);
  repairConversation(state, conversation, canonicalQuestions);
  // The accumulated path is archival. Only this capture's selected chain is
  // eligible; a missing current selection must not fall back to a saved leaf.
  const paths = current ? [current] : [];
  const cards = new Map(state.qaCards.map(c => [c.id, c]));
  const byQuestion = new Map(state.qaCards.map(c => [`${c.conversationId}:${c.userMessageId}`, c]));
  for (const c of state.qaCards) for (const alias of c.userMessageAliases ?? []) byQuestion.set(`${c.conversationId}:${alias}`, c);
  const timelineId = state.timelines.find(t => t.kind === 'source' && t.conversationId === conversation.id)?.id ?? sourceTimelineId(conversation.id);
  let timeline = state.timelines.find(t => t.id === timelineId);
  if (!timeline) { timeline = { id: timelineId, projectId: conversation.projectId, conversationId: conversation.id, kind: 'source', name: conversation.title, hidden: false, archived: false, createdAt: now() }; state.timelines.push(timeline); }
  Object.assign(timeline, { name: conversation.title, updatedAt: now() });
  const membershipKeys = new Set(state.memberships.map(m => `${m.timelineId}:${m.cardId}`));
  const observed = new Set();
  const snapshot = state.snapshots.filter(s => s.conversationId === conversation.id).at(-1);
  const completeGraph = ['provided_graph', 'complete_graph'].includes(conversation.lastScope?.branches) && current?.status === 'reliable_graph';
  const siblingQuestions = question => {
    if (!completeGraph || !question.sourceParentKey || !question.sourceNodeId) return [question.id];
    return questionSlots.get(question.sourceParentKey) ?? [question.id];
  };
  for (const path of paths) {
    let question = null, responses = [], ordinal = 0;
    const finish = () => {
      if (!question) return;
      const parts = readingParts(responses.filter(m => m.role === 'assistant' && visibility(m) === 'body'));
      const aliases = siblingQuestions(question);
      const stable = cards.get(cardId(conversation.id, question.id)) ?? byQuestion.get(`${conversation.id}:${question.id}`) ?? aliases.map(alias => byQuestion.get(`${conversation.id}:${alias}`)).find(Boolean);
      const key = stable?.id ?? cardId(conversation.id, question.id);
      const validity = answerValidity(question, responses, parts);
      const visible = validity.state === 'ACTIVE' ? parts : [];
      const projection = { id: key, projectionVersion: 3, projectId: conversation.projectId, conversationId: conversation.id, sourceConversationId: conversation.sourceConversationId,
        logicalUserMessageId: stable?.logicalUserMessageId ?? stable?.userMessageId ?? question.id, userMessageAliases: [...new Set([...(stable?.userMessageAliases ?? []), ...aliases])],
        sourceUrl: conversation.sourceUrl, sourceTitle: conversation.title, userMessageId: question.id, responseMessageIds: responses.map(m => m.id),
        questionVersionId: snapshot?.messageVersionIds?.[question.id] ?? question.currentVersionId,
        visibleAnswerIds: visible.map(m => m.id), answerVersionIds: Object.fromEntries(visible.map(m => [m.id, snapshot?.messageVersionIds?.[m.id] ?? m.currentVersionId])),
        pathIds: [...new Set([...(stable?.pathIds ?? []), path.id])], pathId: path.id, ordinal,
        identity: { basis: aliases.length > 1 ? 'source_graph_user_sibling_slot' : question.sourceMessageId ? 'source_message_id' : question.identity?.basis ?? 'local_message_id', confidence: question.identity?.confidence ?? 'unknown' },
        questionTime: { ...copy(question.time ?? { value: null, source: null, precision: 'unknown' }), reliability: question.time?.value ? question.time.precision === 'date_only' ? 'date_only' : 'provided' : 'unknown' },
        answerTime: { ...copy(parts.at(-1)?.time ?? { value: null, source: null, precision: 'unknown' }), reliability: parts.at(-1)?.time?.value ? 'provided' : 'unknown' },
        importedAt: stable?.importedAt ?? question.firstCapturedAt ?? now(), updatedAt: conversation.lastCapturedAt ?? now(),
        questionPreview: bodyPreview(question.text, 160) || '问题正文未取得', answerPreview: bodyPreview(visible.map(m => m.text).join('\n\n'), 240), answerRenderPreview: markdownPreview(visible.map(m => m.text).join('\n\n')),
        validity: { ...validity, checkedAt: conversation.lastCapturedAt ?? now(), snapshotId: snapshot?.id ?? null },
        status: validity.state === 'ACTIVE' ? 'answered' : validity.state === 'PENDING' ? 'generating' : 'incomplete' };
      // Retain an immutable reference for explicit hidden-record search/recovery.
      if (validity.state === 'ACTIVE') {
        projection.lastActiveAnswerIds = [...projection.visibleAnswerIds];
        projection.lastActiveAnswerVersionIds = { ...projection.answerVersionIds };
      }
      const inconclusive = ['completion_evidence_missing', 'answer_not_observed', 'question_unconfirmed', 'question_body_unavailable', 'answer_body_unavailable'].includes(validity.reason);
      if (stable?.validity?.state === 'ACTIVE' && !completeGraph && inconclusive && stable.userMessageId === question.id &&
        (!responses.length || responses.every(m => stable.responseMessageIds.includes(m.id)))) {
        // An incomplete observation of the same path cannot invalidate a saved answer.
        observed.add(key); return;
      }
      observed.add(key);
      if (stable) Object.assign(stable, projection); else { state.qaCards.push(projection); cards.set(key, projection); byQuestion.set(`${conversation.id}:${question.id}`, projection); }
      if (!membershipKeys.has(`${timelineId}:${key}`)) { state.memberships.push({ id: id('member'), projectId: conversation.projectId, timelineId, cardId: key, createdAt: now() }); membershipKeys.add(`${timelineId}:${key}`); }
    };
    for (const key of path.lastCapturedMessageIds ?? path.messageIds) {
      const message = messages.get(key); if (!message || message.isAuxiliary) continue;
      if (message.role === 'user') { finish(); question = message; responses = []; ordinal++; } else if (question) responses.push(message);
    }
    finish();
  }
  for (const c of state.qaCards.filter(c => c.conversationId === conversation.id && !observed.has(c.id))) {
      if (completeGraph || !current && ['provided_graph', 'complete_graph'].includes(conversation.lastScope?.branches)) {
      c.validity = { state: current ? 'HIDDEN_INVALID' : 'PENDING', reason: current ? 'not_on_selected_branch' : 'selected_branch_unknown', checkedAt: now() };
      c.visibleAnswerIds = []; c.answerVersionIds = {}; c.answerPreview = ''; c.answerRenderPreview = '';
    }
    // Partial history is not a deletion signal. Unobserved rows stay intact.
  }
}
export function assertOPC(state) {
  initializeOPC(state);
  const maps = Object.fromEntries(OPC_STORES.map(s => [s, new Map(state[s].map(r => [r.id, r]))]));
  const conversations = new Map(state.conversations.map(c => [c.id, c])), messages = new Map(state.messages.map(m => [m.id, m]));
  const paths = new Map(state.paths.map(p => [p.id, p]));
  const versions = new Map((state.versions ?? []).map(v => [v.id, v]));
  const ref = (store, key, owner) => { const row = maps[store].get(key); if (!row || row.projectId !== owner.projectId) fail('时间线或卡片引用缺失 / 跨项目。'); return row; };
  const logicalCards = new Set();
  for (const c of state.qaCards) {
    const logicalId = `${c.conversationId}:${c.logicalUserMessageId ?? c.userMessageId}`;
    if (logicalCards.has(logicalId)) fail('同一个用户问题不能存在重复卡片。'); logicalCards.add(logicalId);
    if (messages.get(c.userMessageId)?.role !== 'user') fail('Q/A 起始消息必须是用户问题。');
    if (conversations.get(c.conversationId)?.projectId !== c.projectId || messages.get(c.userMessageId)?.conversationId !== c.conversationId || !Array.isArray(c.responseMessageIds) || c.responseMessageIds.some(k => messages.get(k)?.conversationId !== c.conversationId)) fail('Q/A 来源引用无效。');
    if (!Array.isArray(c.visibleAnswerIds) || c.visibleAnswerIds.some(k => !c.responseMessageIds.includes(k)) || !Array.isArray(c.pathIds) || c.pathIds.some(k => paths.get(k)?.conversationId !== c.conversationId) || !c.questionTime || c.questionTime.value != null && !Number.isFinite(Date.parse(c.questionTime.value))) fail('Q/A 正文或时间投影无效。');
    if (c.projectionVersion === 3) {
      if (!['ACTIVE', 'PENDING', 'HIDDEN_INVALID'].includes(c.validity?.state) || messages.get(c.logicalUserMessageId)?.role !== 'user' || messages.get(c.logicalUserMessageId)?.conversationId !== c.conversationId) fail('Q/A 状态或逻辑提问身份无效。');
      if (c.validity.state !== 'ACTIVE' && c.visibleAnswerIds.length) fail('未完成或无效问答不能暴露回答投影。');
      if (c.validity.state === 'ACTIVE' && (!c.visibleAnswerIds.length || c.visibleAnswerIds.some(k => {
        const v = versions.get(c.answerVersionIds?.[k]); return !v || v.messageId !== k || v.conversationId !== c.conversationId || v.role !== 'assistant';
      }))) fail('有效回答缺少不可变来源版本。');
      if (c.questionVersionId != null) { const v = versions.get(c.questionVersionId); if (!v || v.messageId !== c.userMessageId || v.conversationId !== c.conversationId || v.role !== 'user') fail('提问正文版本引用无效。'); }
      if (c.lastActiveAnswerIds != null && (!Array.isArray(c.lastActiveAnswerIds) || c.lastActiveAnswerIds.some(k => {
        const v = versions.get(c.lastActiveAnswerVersionIds?.[k]); return !v || v.messageId !== k || v.conversationId !== c.conversationId || v.role !== 'assistant';
      }))) fail('历史有效回答版本引用无效。');
    }
  }
  for (const t of state.timelines) if (!['source', 'theme'].includes(t.kind) || !String(t.name ?? '').trim() || t.kind === 'source' && conversations.get(t.conversationId)?.projectId !== t.projectId) fail('时间线来源或类型无效。');
  const members = new Set();
  for (const m of state.memberships) { ref('qaCards', m.cardId, m); ref('timelines', m.timelineId, m); const key = `${m.timelineId}:${m.cardId}`; if (members.has(key)) fail('重复时间线成员。'); members.add(key); }
  const metadataOwners = new Set();
  for (const m of state.qaMetadata) { ref('qaCards', m.cardId, m); if (metadataOwners.has(m.cardId)) fail('一张卡片不能存在重复元数据。'); metadataOwners.add(m.cardId); if (typeof m.title !== 'string' || typeof m.notes !== 'string' || !Array.isArray(m.tags) || m.tags.some(t => typeof t !== 'string') ||
    m.topic != null && typeof m.topic !== 'string' || m.contentType != null && m.contentType !== '' && !CARD_TYPES.includes(m.contentType) || m.organizationStatus != null && !ORGANIZATION_STATES.includes(m.organizationStatus) || m.adoptionStatus!=null&&!ADOPTION_STATES.includes(m.adoptionStatus) || m.favorite != null && typeof m.favorite !== 'boolean') fail('卡片元数据格式无效。'); }
  for (const r of state.relationships) { ref('qaCards', r.fromCardId, r); ref('qaCards', r.toCardId, r); if (r.fromCardId === r.toCardId || !String(r.type ?? '').trim() || typeof r.directed !== 'boolean'||r.confirmationStatus!=null&&!CONFIRMATION_STATES.includes(r.confirmationStatus)) fail('关系内容无效。'); }
  for (const l of state.canvasLayouts) {
    if (!l.viewport || ![l.viewport.x, l.viewport.y, l.viewport.zoom].every(Number.isFinite) || l.viewport.zoom < .05 || l.viewport.zoom > 3) fail('画布视口无效。');
    for (const [key, position] of Object.entries(l.positions ?? {})) { ref('qaCards', key, l); if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) fail('画布坐标无效。'); }
  }
  assertRelease(state);
}
export function opcMutation(state, action, args) {
  initializeOPC(state);
  if (!state.projects.some(p => p.id === args.projectId)) fail('项目不存在。');
  const lookups = new Map();
  const owned = (store, key) => { if (!lookups.has(store)) lookups.set(store, new Map(state[store].filter(r => r.projectId === args.projectId).map(r => [r.id, r]))); const row = lookups.get(store).get(key); if (!row) fail('对象不存在或不属于当前项目。'); return row; };
  const checkRevision = row => { if (args.expectedRevision != null && (row?.revision ?? 0) !== args.expectedRevision) fail('内容已在另一窗口修改。请重新读取最新内容再保存；当前修改未覆盖已有数据。'); };
  if (action === 'metadata') {
    const card = owned('qaCards', args.cardId);
    let metadata = state.qaMetadata.find(m => m.cardId === card.id);
    checkRevision(metadata);
    if (!metadata) { metadata = { ...cardMetadata(), id: id('annotation'), cardId: card.id, projectId: card.projectId, createdAt: now() }; state.qaMetadata.push(metadata); }
    Object.assign(metadata, cardMetadata(metadata));
    if (Object.hasOwn(args, 'contentType') && args.contentType !== '' && !CARD_TYPES.includes(args.contentType)) fail('无效的内容类型。');
    if (Object.hasOwn(args, 'organizationStatus') && !ORGANIZATION_STATES.includes(args.organizationStatus)) fail('无效的整理状态。');
    if (Object.hasOwn(args, 'adoptionStatus') && !ADOPTION_STATES.includes(args.adoptionStatus)) fail('无效的采纳状态。');
    if (Object.hasOwn(args, 'adoptionStatus')) metadata.adoptionStatus = args.adoptionStatus;
    if (Object.hasOwn(args, 'notes')) metadata.annotationSource = 'user';
    for (const key of ['topic', 'contentType', 'organizationStatus']) if (Object.hasOwn(args, key)) metadata[key] = String(args[key]).trim();
    if (Object.hasOwn(args, 'favorite')) metadata.favorite = Boolean(args.favorite);
    for (const key of ['title', 'notes']) if (Object.hasOwn(args, key)) metadata[key] = String(args[key]);
    if (Object.hasOwn(args, 'tags')) { if (!Array.isArray(args.tags)) fail('标签必须是列表。'); metadata.tags = [...new Set(args.tags.map(String).map(s => s.trim()).filter(Boolean))]; }
    metadata.updatedAt = now(); metadata.revision = (metadata.revision ?? 0) + 1; return metadata;
  }
  if (action === 'timeline') {
    let t = args.timelineId ? owned('timelines', args.timelineId) : null;
    checkRevision(t);
    if (!t) { if (!String(args.name ?? '').trim()) fail('请输入时间线名称。'); t = { id: id('timeline'), projectId: args.projectId, kind: 'theme', createdAt: now(), hidden: false, archived: false }; state.timelines.push(t); }
    if (Object.hasOwn(args, 'name')) { if (t.kind !== 'theme' || !String(args.name).trim()) fail('仅主题线可以重命名，名称不能为空。'); t.name = String(args.name).trim(); }
    for (const key of ['hidden', 'archived']) if (Object.hasOwn(args, key)) t[key] = Boolean(args[key]);
    t.updatedAt = now(); t.revision = (t.revision ?? 0) + 1; return t;
  }
  if (action === 'membership') {
    const t = owned('timelines', args.timelineId); if (t.kind !== 'theme') fail('来源时间线由导入维护。');
    if (!Array.isArray(args.cardIds)) fail('卡片成员必须是列表。');
    const keys = [...new Set(args.cardIds)], keySet = new Set(keys); keys.forEach(key => owned('qaCards', key));
    if (args.remove) state.memberships = state.memberships.filter(m => m.timelineId !== t.id || !keySet.has(m.cardId));
    else { const existing = new Set(state.memberships.filter(m => m.timelineId === t.id).map(m => m.cardId)); for (const key of keys) if (!existing.has(key)) state.memberships.push({ id: id('member'), projectId: args.projectId, timelineId: t.id, cardId: key, createdAt: now() }); }
    return { count: keys.length };
  }
  if (action === 'relationship') {
    const existing = args.relationshipId ? owned('relationships', args.relationshipId) : null;
    checkRevision(existing);
    if (args.remove) { if (!existing) fail('关系不存在。'); state.relationships = state.relationships.filter(r => r.id !== existing.id); return { removed: true }; }
    owned('qaCards', args.fromCardId); owned('qaCards', args.toCardId);
    if (args.fromCardId === args.toCardId || !String(args.type ?? '').trim()) fail('请选择不同卡片并填写关系类型。');
    const values = { fromCardId: args.fromCardId, toCardId: args.toCardId, type: String(args.type).trim(), directed: args.directed !== false, description: String(args.description ?? '').trim() };
    values.confirmationStatus = args.confirmationStatus ?? existing?.confirmationStatus ?? 'USER_CONFIRMED'; if (!CONFIRMATION_STATES.includes(values.confirmationStatus)) fail('关系确认状态无效。');
    const duplicate = state.relationships.find(r => r.projectId === args.projectId && r.id !== existing?.id && r.type === values.type && r.directed === values.directed && (r.confirmationStatus ?? 'USER_CONFIRMED') === values.confirmationStatus && String(r.description ?? '').trim() === values.description &&
      (r.fromCardId === values.fromCardId && r.toCardId === values.toCardId || !values.directed && r.fromCardId === values.toCardId && r.toCardId === values.fromCardId));
    if (duplicate) { if (existing) fail('已存在相同关系，请编辑已有关系。'); return duplicate; }
    const r = existing ?? { id: id('relation'), projectId: args.projectId, createdAt: now() };
    Object.assign(r, values, { updatedAt: now() });
    r.revision = (r.revision ?? 0) + 1;
    if (!existing) state.relationships.push(r);
    if (!DEFAULT_RELATIONS.includes(r.type) && !state.relationTypes.some(t => t.projectId === args.projectId && t.name === r.type)) state.relationTypes.push({ id: id('relationType'), projectId: args.projectId, name: r.type });
    return r;
  }
  if (action === 'layout') {
    let l = state.canvasLayouts.find(l => l.projectId === args.projectId);
    if (!l) { l = { id: id('layout'), projectId: args.projectId, positions: {}, viewport: { x: 0, y: 0, zoom: 1 } }; state.canvasLayouts.push(l); }
    // Check all touched coordinates before changing any of them. Unrelated
    // nodes may have moved since this window loaded the canvas.
    for (const [key, p] of Object.entries(args.positions ?? {})) {
      owned('qaCards', key); if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) fail('画布坐标无效。');
      if (args.expectedPositions && Object.hasOwn(args.expectedPositions, key)) { const expected = args.expectedPositions[key], current = l.positions[key]; if (expected == null ? current != null : !current || current.x !== expected.x || current.y !== expected.y) fail('这个节点已在另一窗口移动。请刷新画布再调整；原位置未被覆盖。'); }
    }
    if (args.expectedViewport && ['x', 'y', 'zoom'].some(key => args.expectedViewport[key] !== l.viewport[key])) fail('视口已在另一窗口改变。请刷新画布后重试。');
    for (const [key, p] of Object.entries(args.positions ?? {})) { owned('qaCards', key); if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) fail('画布坐标无效。'); l.positions[key] = { x: p.x, y: p.y }; }
    if (args.viewport) { const v = args.viewport; if (![v.x, v.y, v.zoom].every(Number.isFinite) || v.zoom < .05 || v.zoom > 3) fail('画布缩放无效。'); l.viewport = copy(v); }
    l.updatedAt = now(); l.revision = (l.revision ?? 0) + 1; return l;
  }
  fail('未知的时间线操作。');
}
export function timelinePage(data, args = {}) {
  const annotations = new Map(data.qaMetadata.map(m => [m.cardId, m]));
  const selected = new Set(args.timelineIds ?? []), visible = new Set(data.timelines.filter(t => !t.hidden && !t.archived).map(t => t.id));
  const memberships = data.memberships.filter(m => selected.size ? selected.has(m.timelineId) : visible.has(m.timelineId));
  const ids = new Set(args.allCards ? data.qaCards.map(c => c.id) : memberships.map(m => m.cardId)), counts = new Map();
  for (const r of data.relationships) for (const key of [r.fromCardId, r.toCardId]) counts.set(key, (counts.get(key) ?? 0) + 1);
  const rows = data.qaCards.filter(c => (c.validity?.state === 'ACTIVE' || args.includeInvalid) && ids.has(c.id) && (!args.conversationId || c.conversationId === args.conversationId)).map(c => ({ ...c, metadata: cardMetadata(annotations.get(c.id)), relationshipCount: counts.get(c.id) ?? 0 }));
  const day = value => value ? args.timeZone ? new Intl.DateTimeFormat('sv-SE', { timeZone: args.timeZone }).format(new Date(value)) : dateFormatter.format(new Date(value)) : null;
  const filtered = rows.filter(c => (!args.cardId || c.id === args.cardId) && (!args.tag || c.metadata.topic === args.tag || c.metadata.tags.includes(args.tag)) && (!args.contentType || c.metadata.contentType === args.contentType) &&
    (!args.organizationStatus || c.metadata.organizationStatus === args.organizationStatus) && (!args.favorite || c.metadata.favorite) && (!args.date || day(c.questionTime.value) === args.date) &&
    (!args.dateFrom || day(c.questionTime.value) >= args.dateFrom) && (!args.dateTo || c.questionTime.value && day(c.questionTime.value) <= args.dateTo) && (!args.matchedCardIds || args.matchedCardIds.has(c.id)));
  filtered.sort((a, b) => (args.searchScores ? (args.searchScores.get(b.id) ?? 0) - (args.searchScores.get(a.id) ?? 0) : 0) || (a.questionTime.value ? Date.parse(a.questionTime.value) : Infinity) - (b.questionTime.value ? Date.parse(b.questionTime.value) : Infinity) || a.conversationId.localeCompare(b.conversationId) || a.ordinal - b.ordinal || a.id.localeCompare(b.id));
  const number = (value, fallback) => Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback;
  const limit = Math.min(100, Math.max(1, number(args.limit ?? 60, 60)));
  const revealed = args.revealCardId ? filtered.findIndex(c => c.id === args.revealCardId) : -1;
  const offset = filtered.length ? revealed >= 0 ? Math.floor(revealed / limit) * limit : Math.min(Math.max(0, number(args.offset ?? 0, 0)), Math.floor((filtered.length - 1) / limit) * limit) : 0;
  const page = args.timelineAllCards ? filtered : filtered.slice(offset, offset + limit), pageIds = new Set(page.map(c => c.id));
  const pinIds = new Set((args.canvasCardIds ?? []).slice(0, 40));
  const pinnedCards = data.qaCards.filter(c => (c.validity?.state === 'ACTIVE' || args.includeInvalid) && pinIds.has(c.id) && !pageIds.has(c.id)).map(c => ({ ...c, metadata: cardMetadata(annotations.get(c.id)), relationshipCount: counts.get(c.id) ?? 0 }));
  const renderedIds = new Set([...pageIds, ...pinnedCards.map(c => c.id)]);
  let min = Infinity, max = -Infinity, known = 0;
  for (const c of filtered) if (c.questionTime.value) { const t = Date.parse(c.questionTime.value); min = Math.min(min, t); max = Math.max(max, t); known++; }
  return { cards: page, pinnedCards, total: filtered.length, syncCounts: { pending: data.qaCards.filter(c => c.validity?.state === 'PENDING').length, hidden: data.qaCards.filter(c => c.validity?.state === 'HIDDEN_INVALID').length }, offset, nextOffset: offset + limit < filtered.length ? offset + limit : null,
    timeRange: { min: known ? min : null, max: known ? max : null, known, unknown: filtered.length - known },
    timelines: data.timelines, memberships: memberships.filter(m => renderedIds.has(m.cardId)), relationships: data.relationships.filter(r => renderedIds.has(r.fromCardId) || renderedIds.has(r.toCardId)),
    topics: metadataTopics(data.qaMetadata), sources: [...new Map(data.qaCards.map(c => [c.conversationId, { id: c.conversationId, title: c.sourceTitle }])).values()], preferences: data.timelinePreferences?.[0] ?? null, tray: data.contextTrays?.[0] ?? null,
    relationTypes: [...new Set([...DEFAULT_RELATIONS, ...data.relationTypes.map(r => r.name)])], layout: data.canvasLayouts[0] ?? null };
}
