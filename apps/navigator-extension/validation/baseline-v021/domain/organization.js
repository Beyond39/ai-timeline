import { id, now, copy, digest, fail, normalizeName, PALETTE } from './common.js';
import { assertPartition } from './indexes.js';
import { nextRevisionSequence } from './edits.js';
import { proposeRuleGroups, RULE_METHOD } from '../analysis/rules.js';
import { parseModelResult, analysisPrompt } from '../analysis/model.js';

const activeSegments = (state, pathId) => state.segments.filter(s => s.pathId === pathId && s.active).sort((a, b) => a.ordinal - b.ordinal);
const orderedQAs = (state, pathId) => state.qas.filter(q => q.pathId === pathId).sort((a, b) => a.ordinal - b.ordinal);
const isProtected = segment => segment.manual || segment.organizationStatus === 'confirmed';

function contextObjects(state, args) {
  const conversation = state.conversations.find(c => c.id === args.conversationId);
  if (!conversation) fail('要整理的对话不存在。');
  const path = state.paths.find(p => p.id === (args.pathId ?? conversation.currentPathId) && p.conversationId === conversation.id);
  if (!path) fail('请选择该对话的一条真实阅读路径。');
  assertPartition(state, path.id);
  const qas = orderedQAs(state, path.id), segments = activeSegments(state, path.id);
  return { conversation, path, qas, segments };
}
function referencedMessages(state, qa) {
  return [qa.userMessageId, ...qa.responseMessageIds].map(messageId => {
    const message = state.messages.find(m => m.id === messageId && m.conversationId === qa.conversationId);
    const version = state.versions.find(v => v.id === message?.currentVersionId && v.messageId === messageId);
    if (!message || !version) fail(`Q/A ${qa.ordinal} 的原文或当前版本引用不存在，请先修复来源数据。`);
    return { ...copy(message), evidence: { qaId: qa.id, messageId: message.id, versionId: version.id } };
  });
}
async function fingerprints(state, pathId) {
  const qas = orderedQAs(state, pathId), path = state.paths.find(p => p.id === pathId);
  if (!path) fail('建议引用的阅读路径不存在。');
  const messages = new Map(state.messages.map(message => [message.id, message]));
  const versions = new Map(state.versions.map(version => [version.id, version]));
  const topics = new Map(state.topics.map(topic => [topic.id, topic.name]));
  const messageTuple = (key, conversationId, error) => {
    const message = messages.get(key), version = versions.get(message?.currentVersionId);
    if (!message || message.conversationId !== conversationId || !version || version.messageId !== key) fail(error);
    return [message.id, message.currentVersionId, message.role, message.streaming ?? null, message.contentStatus ?? null, message.bodyHash ?? message.text];
  };
  const pathMessages = path.messageIds.map(key => {
    return messageTuple(key, path.conversationId, '阅读路径中的原文或正文版本引用不存在。');
  });
  const sourceVersion = await digest({ pathId, pathMessages, qas: qas.map(q => ({ id: q.id, ordinal: q.ordinal, status: q.status,
    messages: [q.userMessageId, ...q.responseMessageIds].map(key => messageTuple(key, q.conversationId, `Q/A ${q.ordinal} 的原文或当前版本引用不存在，请先修复来源数据。`)) })) });
  const navigationVersion = await digest(activeSegments(state, pathId).map(s => [s.id, s.revision, s.qaIds, s.title, s.topicIds, s.topicIds.map(key => topics.get(key)).filter(Boolean), s.manual, s.organizationStatus ?? null, s.needsReview ?? false]));
  return { sourceVersion, navigationVersion };
}
function currentFingerprints(state, pathId, cache) {
  if (!cache) return fingerprints(state, pathId);
  // A cache belongs to one immutable read snapshot; writes always recompute.
  if (!cache.has(pathId)) cache.set(pathId, fingerprints(state, pathId));
  return cache.get(pathId);
}
function topicNames(state, segment) { return segment.topicIds.map(k => state.topics.find(t => t.id === k)?.name).filter(Boolean); }
function segmentSnapshot(state, segment) { return { ...copy(segment), topics: topicNames(state, segment) }; }
function qaDetails(state, qa) {
  const messages = referencedMessages(state, qa);
  return { ...copy(qa), messages, evidence: messages.map(m => m.evidence) };
}
function resolveRange(state, context, args) {
  if (!context.qas.length) fail('本路径没有用户 Q/A，暂时无法整理。');
  const start = args.startQAId == null ? 0 : context.qas.findIndex(q => q.id === args.startQAId);
  const end = args.endQAId == null ? context.qas.length - 1 : context.qas.findIndex(q => q.id === args.endQAId);
  if (start < 0 || end < start) fail('整理范围必须属于所选路径，并按原始顺序选择起止 Q/A。');
  const requestedRangeQAIds = context.qas.slice(start, end + 1).map(q => q.id);
  const first = context.segments.find(s => s.qaIds.includes(context.qas[start].id)), last = context.segments.find(s => s.qaIds.includes(context.qas[end].id));
  const actualStart = context.qas.findIndex(q => q.id === first.qaIds[0]), actualEnd = context.qas.findIndex(q => q.id === last.qaIds.at(-1));
  const rangeQAIds = context.qas.slice(actualStart, actualEnd + 1).map(q => q.id);
  return { requestedRangeQAIds, rangeQAIds, warnings: requestedRangeQAIds.length !== rangeQAIds.length ? ['所选端点位于已有片段内部；预览范围已扩展到完整片段边界，确认前请核对。'] : [],
    beforeSegments: context.segments.filter(s => s.qaIds.some(key => rangeQAIds.includes(key))).map(s => segmentSnapshot(state, s)) };
}
function validateGroups(state, suggestion, supplied, { requireEvidence = true, fillEvidence = false } = {}) {
  if (!Array.isArray(supplied) || !supplied.length) fail('建议至少需要一个片段。');
  const expected = suggestion.rangeQAIds, all = [], qaMap = new Map(state.qas.map(q => [q.id, q]));
  const groups = supplied.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`建议片段 ${index + 1} 必须为 JSON 对象。`);
    const title = String(raw.title ?? '').trim(); if (!title) fail(`建议片段 ${index + 1} 的标题不能为空。`);
    if (!Array.isArray(raw.topics) || raw.topics.some(name => typeof name !== 'string' || !name.trim())) fail(`建议片段 ${index + 1} 的主题必须为非空字符串数组。`);
    const topics = [...new Map(raw.topics.map(name => [normalizeName(name), name.trim()])).values()];
    if (!Array.isArray(raw.qaIds) || !raw.qaIds.length) fail(`建议片段 ${index + 1} 没有 Q/A 成员。`);
    for (const key of raw.qaIds) {
      const qa = qaMap.get(key); if (!qa || qa.pathId !== suggestion.pathId || qa.conversationId !== suggestion.conversationId) fail(`建议引用不存在或跨对话 / 分支的 QA：${key}`);
      all.push(key);
    }
    if (raw.preservedSegmentId && !state.segments.some(s => s.id === raw.preservedSegmentId && s.pathId === suggestion.pathId && s.conversationId === suggestion.conversationId)) fail('保留人工片段的 Segment 引用不存在或属于其他路径。');
    const reason = String(raw.reason ?? '').trim(); if (!reason) fail(`建议片段 ${index + 1} 缺少分组理由。`);
    let evidence = raw.evidence;
    if (fillEvidence && evidence == null) evidence = [];
    if (!Array.isArray(evidence) || (requireEvidence && !fillEvidence && !evidence.length)) fail(`建议片段 ${index + 1} 缺少原文引用。`);
    const covered = new Set();
    for (const ref of evidence) {
      if (!ref || !raw.qaIds.includes(ref.qaId)) fail('原文引用 QA 必须属于该建议片段。');
      const qa = qaMap.get(ref.qaId), message = state.messages.find(m => m.id === ref.messageId), version = state.versions.find(v => v.id === ref.versionId);
      if (!message || message.conversationId !== suggestion.conversationId || ![qa.userMessageId, ...qa.responseMessageIds].includes(message.id)) fail(`原文消息引用不存在或不属于指定 QA：${ref.messageId}`);
      if (!version || version.messageId !== message.id) fail(`正文版本引用不存在或不属于指定消息：${ref.versionId}`);
      if (suggestion.allowedEvidence && !suggestion.allowedEvidence.some(item => item.qaId === ref.qaId && item.messageId === ref.messageId && item.versionId === ref.versionId)) fail('模型引用了整理包之外的正文版本，请使用包中稳定引用。');
      covered.add(ref.qaId);
    }
    if (requireEvidence && !fillEvidence && raw.qaIds.some(key => !covered.has(key))) fail(`建议片段 ${index + 1} 的每一轮 Q/A 都需要至少一个原文引用。`);
    if (fillEvidence) evidence = raw.qaIds.flatMap(key => qaDetails(state, qaMap.get(key)).evidence);
    return { title, topics, qaIds: [...raw.qaIds], reason, evidence: evidence.map(ref => ({ qaId: ref.qaId, messageId: ref.messageId, versionId: ref.versionId })),
      ...(raw.preservedSegmentId ? { preservedSegmentId: raw.preservedSegmentId } : {}) };
  });
  if (all.length !== expected.length || all.some((key, index) => key !== expected[index])) fail('建议必须按顺序完整覆盖整理范围：成员真实、连续、不重复、不遗漏，不能跨分支。');
  return groups;
}
function manualConflicts(suggestion) {
  return suggestion.beforeSegments.filter(isProtected).flatMap(segment => {
    const group = suggestion.groups.find(g => g.qaIds.length === segment.qaIds.length && g.qaIds.every((key, i) => key === segment.qaIds[i]));
    const sameTopics = group && JSON.stringify(group.topics.map(normalizeName)) === JSON.stringify((segment.topics ?? []).map(normalizeName));
    return group && group.title === segment.title && sameTopics ? [] : [{ segmentId: segment.id, title: segment.title, reason: '建议将改变已有人工或已确认片段的标题、主题或边界，需要明确复核后才能应用。' }];
  });
}
async function detail(state, suggestion, fingerprintCache = null) {
  const versions = await currentFingerprints(state, suggestion.pathId, fingerprintCache);
  const staleReason = suggestion.invalidatedReason ?? (suggestion.restoredRefState === 'requires_regeneration' ? (suggestion.restoreReason ?? '备份恢复后本地稳定 ID 已变化，请重新生成整理建议。') : versions.sourceVersion !== suggestion.sourceVersion ? '源对话的 Q/A、正文版本或生成状态已更新；请重新生成建议。' : ['pending', 'needs_review'].includes(suggestion.status) && versions.navigationVersion !== suggestion.navigationVersion ? '已有地图标题、标签或边界已变化；请基于当前分段重新生成建议。' : null);
  const stale = Boolean(staleReason), status = ['pending', 'needs_review'].includes(suggestion.status) && stale ? 'needs_review' : suggestion.status;
  return { ...copy(suggestion), status, stale, staleReason, manualConflicts: manualConflicts(suggestion) };
}
function findSuggestion(state, args) {
  const suggestion = state.suggestions.find(s => s.id === args.suggestionId); if (!suggestion) fail('整理建议不存在或已删除。'); return suggestion;
}
function ensureEditable(suggestion, args) {
  if (!['pending', 'needs_review'].includes(suggestion.status)) fail('该建议已确认或已拒绝，请重新生成建议。');
  if (suggestion.revision !== args.baseRevision) fail('整理建议已在另一个窗口修改，请刷新预览。');
}
export async function getOrganizationContext(state, args) {
  const context = contextObjects(state, args), versions = await fingerprints(state, context.path.id);
  const fingerprintCache = new Map([[context.path.id, Promise.resolve(versions)]]);
  return { conversation: copy(context.conversation), path: copy(context.path), paths: state.paths.filter(p => p.conversationId === context.conversation.id).map(copy),
    qas: context.qas.map(q => qaDetails(state, q)), segments: context.segments.map(s => segmentSnapshot(state, s)), topics: state.topics.filter(t => t.projectId === context.conversation.projectId).map(copy),
    suggestions: await Promise.all(state.suggestions.filter(s => s.pathId === context.path.id).map(s => detail(state, s, fingerprintCache))), ...versions };
}
export async function getSuggestion(state, args, fingerprintCache = null) { return detail(state, findSuggestion(state, args), fingerprintCache); }
export async function generateRuleSuggestion(state, args) {
  const context = contextObjects(state, args), range = resolveRange(state, context, args), versions = await fingerprints(state, context.path.id);
  const suggestion = { id: id('suggestion'), projectId: context.conversation.projectId, conversationId: context.conversation.id, pathId: context.path.id, revision: 1,
    status: 'pending', method: { ...RULE_METHOD }, ...range, ...versions, createdAt: now(), groups: [] };
  const qas = context.qas.filter(q => range.rangeQAIds.includes(q.id)).map(q => qaDetails(state, q));
  suggestion.groups = validateGroups(state, suggestion, proposeRuleGroups(qas, suggestion.beforeSegments.filter(isProtected)));
  state.suggestions.push(suggestion); return detail(state, suggestion);
}
export async function exportAnalysisPack(state, args) {
  const context = contextObjects(state, args), range = resolveRange(state, context, args), versions = await fingerprints(state, context.path.id);
  const qas = context.qas.filter(q => range.rangeQAIds.includes(q.id)).map(q => qaDetails(state, q));
  const requestedSize = args.batchSize == null ? 20 : Number(args.batchSize);
  if (!Number.isInteger(requestedSize) || requestedSize < 1 || requestedSize > 100) fail('每批轮次数需为 1 到 100 的整数。');
  const pack = { format: 'acvn-organization-pack', schemaVersion: 1, id: id('analysis'), projectId: context.conversation.projectId, conversationId: context.conversation.id,
    pathId: context.path.id, conversationTitle: context.conversation.title, sourceUrl: context.conversation.sourceUrl ?? null, createdAt: now(), ...versions, ...range, batches: [] };
  for (let start = 0; start < qas.length;) {
    let end = Math.min(start + requestedSize, qas.length);
    const crossingManual = range.beforeSegments.filter(isProtected).find(segment => segment.qaIds.includes(qas[end - 1].id) && segment.qaIds.at(-1) !== qas[end - 1].id);
    if (crossingManual) {
      const first = qas.findIndex(q => q.id === crossingManual.qaIds[0]);
      end = first > start ? first : qas.findIndex(q => q.id === crossingManual.qaIds.at(-1)) + 1;
      if (end - start > requestedSize) pack.warnings.push(`人工片段“${crossingManual.title}”有 ${end - start} 轮，为保留边界，此批超过目标 ${requestedSize} 轮。`);
    }
    const core = qas.slice(start, end), before = qas.slice(Math.max(0, start - 2), start), after = qas.slice(end, end + 2);
    pack.batches.push({ id: `${pack.id}:batch:${pack.batches.length + 1}`, index: pack.batches.length + 1, qaIds: core.map(q => q.id), coreQAIds: core.map(q => q.id),
      contextQAIds: [...before, ...after].map(q => q.id), contextBeforeQAIds: before.map(q => q.id), contextAfterQAIds: after.map(q => q.id), qas: [...before, ...core, ...after],
      beforeSegments: range.beforeSegments.filter(segment => segment.qaIds.some(key => core.some(q => q.id === key))).map(segment => ({ id: segment.id, title: segment.title, topics: segment.topics, qaIds: segment.qaIds, manual: Boolean(isProtected(segment)) })) });
    start = end;
  }
  // Store stable references plus complete input, so imported results can be validated independently of current UI state.
  state.analysisPacks.push(copy(pack));
  return { pack, prompt: analysisPrompt(pack), batches: pack.batches.map(batch => ({ ...copy(batch), pack: { ...copy(pack), batches: [copy(batch)] }, prompt: analysisPrompt(pack, batch) })) };
}
export async function importOrganizationSuggestion(state, args) {
  const result = parseModelResult(args.text), pack = state.analysisPacks.find(p => p.id === result.analysisPackId);
  if (!pack) fail('找不到该结果对应的整理包。请先从当前插件导出整理包，并使用其中的稳定引用。');
  if (pack.restoredRefState === 'requires_regeneration') fail('整理包来自备份恢复，稳定 ID 已变化，请重新导出整理包。');
  if (result.conversationId !== pack.conversationId || result.pathId !== pack.pathId || result.sourceVersion !== pack.sourceVersion) fail('结果的对话、阅读路径或源数据版本与整理包不一致。');
  let supplied = result.groups;
  if (result.batches != null) {
    if (result.groups != null) fail('请使用 groups 或 batches 中的一种返回格式，不能同时提供。');
    if (!Array.isArray(result.batches) || result.batches.length !== pack.batches.length) fail('分批结果需要包含该整理包的全部批次。请汇总后导入，原地图不会改变。');
    const seen = new Set(); supplied = [];
    for (const batch of pack.batches) {
      const received = result.batches.find(b => b.batchId === batch.id);
      if (!received || seen.has(received.batchId)) fail('模型结果缺少批次，或批次 ID 重复。');
      seen.add(received.batchId);
      const ids = Array.isArray(received.groups) ? received.groups.flatMap(g => g.qaIds ?? []) : [];
      if (JSON.stringify(ids) !== JSON.stringify(batch.coreQAIds)) fail('每个批次必须完整覆盖本批核心 Q/A；相邻上下文不能重复成为成员。');
      supplied.push(...received.groups);
    }
  }
  const suggestion = { id: id('suggestion'), projectId: pack.projectId, conversationId: pack.conversationId, pathId: pack.pathId, revision: 1, status: 'pending',
    analysisPackId: pack.id, method: copy(result.method), sourceVersion: pack.sourceVersion, navigationVersion: pack.navigationVersion,
    rangeQAIds: [...pack.rangeQAIds], requestedRangeQAIds: [...pack.requestedRangeQAIds], warnings: [...pack.warnings], beforeSegments: copy(pack.beforeSegments), createdAt: now(),
    allowedEvidence: [...new Map(pack.batches.flatMap(b => b.qas.flatMap(q => q.evidence)).map(ref => [`${ref.qaId}:${ref.messageId}:${ref.versionId}`, ref])).values()], groups: [] };
  suggestion.groups = validateGroups(state, suggestion, supplied);
  const current = await detail(state, suggestion); if (current.stale) suggestion.status = 'needs_review';
  state.suggestions.push(suggestion); return detail(state, suggestion);
}
export async function updateOrganizationSuggestion(state, args) {
  const suggestion = findSuggestion(state, args); ensureEditable(suggestion, args);
  const current = await detail(state, suggestion); if (current.stale) fail(current.staleReason);
  if (!Array.isArray(args.groups)) fail('修改后的建议必须包含分组数组。');
  suggestion.groups = validateGroups(state, suggestion, args.groups.map(group => ({ ...group, reason: group.reason ?? '用户调整建议标题、主题或 Q/A 边界，待确认后应用。' })), { fillEvidence: true });
  suggestion.revision++; suggestion.updatedAt = now(); suggestion.editedByUser = true; return detail(state, suggestion);
}
export async function rejectOrganizationSuggestion(state, args) {
  const suggestion = findSuggestion(state, args); ensureEditable(suggestion, args);
  suggestion.status = 'rejected'; suggestion.revision++; suggestion.updatedAt = now(); return detail(state, suggestion);
}
function ensureTopic(state, projectId, name) {
  let topic = state.topics.find(t => t.projectId === projectId && normalizeName(t.name) === normalizeName(name));
  if (!topic) { topic = { id: id('top'), projectId, name, color: PALETTE[state.topics.filter(t => t.projectId === projectId).length % PALETTE.length], aliases: [] }; state.topics.push(topic); }
  return topic.id;
}
export async function applyOrganizationSuggestion(state, args) {
  const suggestion = findSuggestion(state, args); ensureEditable(suggestion, args);
  const current = await detail(state, suggestion); if (current.stale) fail(current.staleReason);
  const groups = validateGroups(state, suggestion, suggestion.groups);
  if (current.manualConflicts.length && args.reviewManual !== true) fail('建议会改变已有人工设置；请在预览中明确勾选已复核人工冲突。');
  const currentSegments = activeSegments(state, suggestion.pathId).filter(s => s.qaIds.some(key => suggestion.rangeQAIds.includes(key)));
  const before = currentSegments.map(copy), createdAt = now(), revisionId = id('edit'), created = [];
  for (const group of groups) {
    const matching = currentSegments.find(s => s.qaIds.length === group.qaIds.length && s.qaIds.every((key, index) => key === group.qaIds[index]));
    const first = state.qas.find(q => q.id === group.qaIds[0]);
    const segment = matching ?? { id: id('seg'), projectId: suggestion.projectId, conversationId: suggestion.conversationId, pathId: suggestion.pathId, revision: 0, createdAt };
    Object.assign(segment, { title: group.title, topicIds: group.topics.map(name => ensureTopic(state, suggestion.projectId, name)), qaIds: [...group.qaIds],
      ordinal: first.ordinal, time: copy(first.time), manual: true, active: true, revision: segment.revision + 1, updatedAt: createdAt, replacementIds: [], needsReview: false,
      reviewReason: null, organizationStatus: 'confirmed', organization: { suggestionId: suggestion.id, revisionId, method: copy(suggestion.method), sourceVersion: suggestion.sourceVersion,
        evidence: copy(group.evidence), qaSignatures: group.qaIds.map(key => ({ qaId: key, status: state.qas.find(q => q.id === key).status, messageVersionIds: Object.fromEntries(qaDetails(state, state.qas.find(q => q.id === key)).messages.map(m => [m.id, m.currentVersionId])) })),
        reason: group.reason, confirmedAt: createdAt, reviewedManual: current.manualConflicts.length > 0 } });
    if (!matching) state.segments.push(segment); created.push(segment);
  }
  for (const segment of currentSegments) if (!created.includes(segment)) {
    segment.active = false; segment.replacementIds = created.filter(c => c.qaIds.some(key => segment.qaIds.includes(key))).map(c => c.id); segment.revision++; segment.updatedAt = createdAt;
  }
  assertPartition(state, suggestion.pathId);
  const after = [...new Map([...currentSegments, ...created].map(s => [s.id, copy(s)])).values()];
  state.revisions.push({ id: revisionId, projectId: suggestion.projectId, conversationId: suggestion.conversationId, pathId: suggestion.pathId,
    operation: 'organization', actor: 'user', createdAt, sequence: nextRevisionSequence(state), suggestionId: suggestion.id, before, after, undoneBy: null });
  suggestion.status = 'confirmed'; suggestion.confirmedAt = createdAt; suggestion.appliedRevisionId = revisionId; suggestion.revision++;
  state.conversations.find(c => c.id === suggestion.conversationId).revision++;
  return { segmentId: created[0].id, revisionId, suggestionId: suggestion.id };
}
