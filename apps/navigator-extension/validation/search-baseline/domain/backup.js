import { SCHEMA_VERSION, EXTENSION_VERSION, id, now, copy, fail, normalizeName } from './common.js';
import { assertPartition } from './indexes.js';
import { OPC_STORES, assertOPC, cardId, syncCards } from './opc.js';

export const BACKUP_STORES = ['conversations', 'messages', 'versions', 'snapshots', 'paths', 'qas', 'segments', 'topics', 'revisions', 'suggestions', 'analysisPacks', 'documentRecipes', 'documentPrints', 'conversationLinks', ...OPC_STORES];
const OPTIONAL_V1_STORES = ['suggestions', 'analysisPacks'];
export function normalizeBackup(payload) {
  if (payload?.format !== 'acvn-project-backup' || ![1, 2, SCHEMA_VERSION].includes(payload.schemaVersion)) fail('备份格式或 schemaVersion 不受支持。');
  const normalized = copy(payload);
  normalized.records ??= {};
  for (const name of ['documentRecipes', 'documentPrints', 'conversationLinks', ...OPC_STORES]) normalized.records[name] ??= [];
  if (normalized.schemaVersion === 1) {
    for (const name of OPTIONAL_V1_STORES) normalized.records[name] ??= [];
    const navigation = [...(normalized.records.segments ?? []), ...(normalized.records.revisions ?? []).flatMap(row => [...(row.before ?? []), ...(row.after ?? [])])];
    for (const segment of navigation) {
      if (Array.isArray(segment.topicIds)) segment.topicIds = [...new Set(segment.topicIds)];
      segment.organizationStatus ??= segment.needsReview ? 'needs_review' : segment.manual ? 'confirmed' : 'unorganized';
    }
  }
  for (const segment of normalized.records.segments ?? []) segment.organizationStatus ??= segment.needsReview ? 'needs_review' : segment.manual ? 'confirmed' : 'unorganized';
  if (normalized.records.qaCards.some(c => c.projectionVersion !== 3)) {
    const state = { ...normalized.records, projects: [normalized.project] };
    for (const c of state.conversations) syncCards(state, c);
    for (const store of OPC_STORES) normalized.records[store] = state[store];
  }
  return normalized;
}
export function exportProject(state, projectId) {
  const project = state.projects.find(p => p.id === projectId); if (!project) fail('项目不存在。');
  return { format: 'acvn-project-backup', schemaVersion: SCHEMA_VERSION, extensionVersion: EXTENSION_VERSION, exportedAt: now(),
    project: copy(project), records: Object.fromEntries(BACKUP_STORES.map(name => [name, copy((state[name] ?? []).filter(r => r.projectId === projectId))])) };
}
export function validateBackup(payload) {
  payload = normalizeBackup(payload);
  if (!payload.project?.id || !String(payload.project.name ?? '').trim()) fail('备份缺少项目身份或名称。');
  const allIds = new Set([payload.project.id]); const sets = {};
  for (const name of BACKUP_STORES) {
    if (!Array.isArray(payload.records?.[name])) fail(`备份缺少 ${name} 数据。`);
    sets[name] = new Map();
    for (const row of payload.records[name]) {
      if (!row?.id || allIds.has(row.id) || row.projectId !== payload.project.id) fail(`备份 ${name} 含重复 ID 或跨项目记录。`);
      allIds.add(row.id); sets[name].set(row.id, row);
    }
  }
  const requireRef = (name, value, label) => { if (value != null && !sets[name].has(value)) fail(`备份关系缺失：${label}。`); };
  const members = (name, values, label) => { if (!Array.isArray(values) || new Set(values).size !== values.length || values.some(key => key == null)) fail(`备份成员列表无效：${label}。`); values.forEach(k => requireRef(name, k, label)); };
  for (const name of ['messages', 'versions', 'snapshots', 'paths', 'qas', 'segments', 'revisions', 'suggestions', 'analysisPacks']) for (const row of payload.records[name]) { if (!row.conversationId) fail(`备份 ${name} 缺少所属对话。`); requireRef('conversations', row.conversationId, `${name}.conversationId`); }
  for (const c of payload.records.conversations) {
    requireRef('paths', c.currentPathId, 'conversation.currentPathId');
    if (c.currentPathId && sets.paths.get(c.currentPathId).conversationId !== c.id) fail('对话当前路径的归属不一致。');
    if (c.latestPathIds != null) {
      members('paths', c.latestPathIds, 'conversation.latestPathIds');
      if (c.latestPathIds.some(key => sets.paths.get(key).conversationId !== c.id)) fail('对话最新分支的归属不一致。');
    }
  }
  for (const m of payload.records.messages) {
    requireRef('messages', m.parentMessageId, 'message.parentMessageId'); requireRef('versions', m.currentVersionId, 'message.currentVersionId');
    members('versions', m.versionIds, 'message.versionIds');
    if (typeof m.text !== 'string') fail('备份消息正文类型无效。');
    if (sets.versions.get(m.currentVersionId)?.messageId !== m.id) fail('消息当前版本关联不一致。');
    if (!m.versionIds.includes(m.currentVersionId)) fail('消息当前正文版本必须包含在版本历史中。');
    if (m.versionIds.some(key => sets.versions.get(key)?.messageId !== m.id)) fail('消息历史版本关联不一致。');
    if (m.parentMessageId && sets.messages.get(m.parentMessageId)?.conversationId !== m.conversationId) fail('消息父子关系不能跨对话。');
  }
  for (const v of payload.records.versions) {
    requireRef('messages', v.messageId, 'version.messageId'); requireRef('versions', v.previousVersionId, 'version.previousVersionId'); requireRef('snapshots', v.snapshotId, 'version.snapshotId');
    if (sets.messages.get(v.messageId)?.conversationId !== v.conversationId || (v.previousVersionId && sets.versions.get(v.previousVersionId)?.messageId !== v.messageId)) fail('正文版本的消息或前一版本归属不一致。');
    if (v.snapshotId && sets.snapshots.get(v.snapshotId)?.conversationId !== v.conversationId) fail('正文版本的采集快照归属不一致。');
  }
  const visitedVersions = new Set();
  for (const version of payload.records.versions) {
    const chain = new Set(); let current = version;
    while (current && !visitedVersions.has(current.id)) {
      if (chain.has(current.id)) fail('备份正文版本链存在循环。');
      chain.add(current.id); current = sets.versions.get(current.previousVersionId);
    }
    chain.forEach(key => visitedVersions.add(key));
  }
  for (const p of payload.records.paths) {
    members('messages', p.messageIds, 'path.messageIds'); members('messages', p.lastCapturedMessageIds, 'path.lastCapturedMessageIds'); members('snapshots', p.snapshotIds, 'path.snapshotIds');
    if (p.messageIds.some(k => sets.messages.get(k).conversationId !== p.conversationId)) fail('路径不能跨对话。');
    if (p.lastCapturedMessageIds.some(k => !p.messageIds.includes(k))) fail('最近采集消息不在所属阅读路径。');
    if (p.snapshotIds.some(k => sets.snapshots.get(k).conversationId !== p.conversationId)) fail('路径采集快照不能跨对话。');
  }
  const logicalQAs = new Set();
  const expectedQAs = new Map();
  for (const path of payload.records.paths) {
    let unit = null, ordinal = 0;
    for (const messageId of path.messageIds) {
      const message = sets.messages.get(messageId);
      if (message.role === 'user') {
        unit = { ordinal: ++ordinal, responseMessageIds: [], assistantMessageIds: [], toolMessageIds: [] };
        expectedQAs.set(`${path.id}:${messageId}`, unit);
      } else if (unit) {
        unit.responseMessageIds.push(messageId);
        if (message.role === 'assistant') unit.assistantMessageIds.push(messageId);
        if (['tool', 'function'].includes(message.role)) unit.toolMessageIds.push(messageId);
      }
    }
  }
  for (const q of payload.records.qas) {
    requireRef('paths', q.pathId, 'qa.pathId'); requireRef('messages', q.userMessageId, 'qa.userMessageId'); members('messages', q.responseMessageIds, 'qa.responses');
    if (sets.messages.get(q.userMessageId)?.role !== 'user' || sets.paths.get(q.pathId)?.conversationId !== q.conversationId) fail('Q/A 起始消息或路径归属不一致。');
    if ([q.userMessageId, ...q.responseMessageIds].some(k => !sets.paths.get(q.pathId).messageIds.includes(k))) fail('Q/A 消息不在所属路径。');
    const logicalId = `${q.pathId}:${q.userMessageId}`;
    if (logicalQAs.has(logicalId)) fail('同一路径的同一条用户消息不能生成重复 Q/A。'); logicalQAs.add(logicalId);
    const expected = expectedQAs.get(logicalId);
    if (!expected || q.ordinal !== expected.ordinal || ['responseMessageIds', 'assistantMessageIds', 'toolMessageIds'].some(key =>
      !Array.isArray(q[key]) || q[key].length !== expected[key].length || q[key].some((id, index) => id !== expected[key][index]))) {
      fail('备份 Q/A 的轮次或回答组与原始路径不一致，不能跨下一条用户问题。');
    }
  }
  if (logicalQAs.size !== expectedQAs.size) fail('备份 Q/A 必须覆盖路径中的全部用户轮次。');
  for (const s of payload.records.segments) {
    requireRef('paths', s.pathId, 'segment.pathId'); members('qas', s.qaIds, 'segment.members'); members('topics', s.topicIds, 'segment.topics');
    if (sets.paths.get(s.pathId)?.conversationId !== s.conversationId || s.qaIds.some(k => sets.qas.get(k).pathId !== s.pathId || sets.qas.get(k).conversationId !== s.conversationId)) fail('Segment 的路径或成员不能跨对话、跨分支。');
  }
  for (const s of payload.records.snapshots) {
    members('messages', s.messageIds, 'snapshot.messageIds'); members('paths', s.pathIds, 'snapshot.pathIds');
    if (s.messageIds.some(k => sets.messages.get(k).conversationId !== s.conversationId) || s.pathIds.some(k => sets.paths.get(k).conversationId !== s.conversationId)) fail('采集快照关系不能跨对话。');
    for (const [key, v] of Object.entries(s.messageVersionIds ?? {})) {
      requireRef('messages', key, 'snapshot.message'); requireRef('versions', v, 'snapshot.version');
      if (sets.versions.get(v)?.messageId !== key) fail('采集快照的消息与正文版本关联不一致。');
    }
  }
  for (const t of payload.records.topics) if (!/^#[0-9a-f]{6}$/i.test(t.color)) fail('主题颜色格式无效。');
  const exactEvidence = ref => {
    if (!ref?.conversationId || !ref.messageId || !ref.versionId) fail('备份中的正文引用缺少确切身份。');
    requireRef('conversations', ref.conversationId, 'evidence.conversationId'); requireRef('messages', ref.messageId, 'evidence.messageId'); requireRef('versions', ref.versionId, 'evidence.versionId');
    const message = sets.messages.get(ref.messageId), version = sets.versions.get(ref.versionId);
    if (message.conversationId !== ref.conversationId || version.conversationId !== ref.conversationId || version.messageId !== ref.messageId || !message.versionIds.includes(ref.versionId)) fail('备份中的正文版本不属于引用消息或 Conversation。');
    if (ref.pathId) { requireRef('paths', ref.pathId, 'evidence.pathId'); const path = sets.paths.get(ref.pathId); if (path.conversationId !== ref.conversationId || !path.messageIds.includes(ref.messageId)) fail('备份中的正文引用不属于保存路径。'); }
  };
  for (const recipe of payload.records.documentRecipes) {
    if (!recipe.name || !Array.isArray(recipe.chapters) || !['active', 'archived'].includes(recipe.status)) fail('备份资料包方案结构无效。');
    for (const chapter of recipe.chapters) { if (!Array.isArray(chapter.items)) fail('备份资料包章节成员无效。'); for (const ref of chapter.items) { exactEvidence(ref); if (ref.role != null && ref.role !== sets.versions.get(ref.versionId).role) fail('备份资料包角色与确切版本不一致。'); } }
  }
  for (const print of payload.records.documentPrints) {
    if (print.document?.project?.id !== payload.project.id || !Array.isArray(print.document?.chapters)) fail('备份打印快照不属于当前项目。');
    for (const chapter of print.document.chapters) for (const entry of chapter.entries ?? []) {
      exactEvidence(entry.source); if (typeof entry.text !== 'string' || entry.text !== sets.versions.get(entry.source.versionId).text || entry.source.role !== sets.versions.get(entry.source.versionId).role) fail('备份打印正文或角色与确切版本不一致。');
    }
  }
  for (const link of payload.records.conversationLinks) {
    if (!['active', 'archived'].includes(link.status) || !['related', 'supports', 'contradicts', 'depends_on'].includes(link.type)) fail('备份关联类型或状态无效。');
    exactEvidence(link.from); exactEvidence(link.to);
    if (link.from.conversationId === link.to.conversationId) fail('备份跨会话关联指向同一 Conversation。');
    for (const old of link.history ?? []) if (old.from || old.to) { exactEvidence(old.from); exactEvidence(old.to); }
  }
  const scalarRefs = { conversationId: 'conversations', pathId: 'paths', qaId: 'qas', messageId: 'messages', versionId: 'versions', segmentId: 'segments', preservedSegmentId: 'segments', suggestionId: 'suggestions', analysisPackId: 'analysisPacks', revisionId: 'revisions', appliedRevisionId: 'revisions', undoneBy: 'revisions', reversesId: 'revisions', currentVersionId: 'versions', previousVersionId: 'versions', userMessageId: 'messages', currentPathId: 'paths', parentMessageId: 'messages', lastSnapshotId: 'snapshots', snapshotId: 'snapshots', selectedPathId: 'paths' };
  const arrayRefs = { qaIds: 'qas', rangeQAIds: 'qas', requestedRangeQAIds: 'qas', coreQAIds: 'qas', contextQAIds: 'qas', contextBeforeQAIds: 'qas', contextAfterQAIds: 'qas', messageIds: 'messages', versionIds: 'versions', topicIds: 'topics', replacementIds: 'segments', lastCapturedMessageIds: 'messages', responseMessageIds: 'messages', assistantMessageIds: 'messages', toolMessageIds: 'messages', pathIds: 'paths', snapshotIds: 'snapshots' };
  const historicalEvidence = new Map();
  function belongsToHistoricalQA(ref) {
    const key = `${ref.qaId}:${ref.messageId}:${ref.versionId}`;
    if (historicalEvidence.has(key)) return historicalEvidence.get(key);
    const qa = sets.qas.get(ref.qaId), path = sets.paths.get(qa.pathId);
    const members = new Set(path.messageIds), seen = new Set();
    let versionSeen = false, valid = false;
    // Compatible recaptures preserve the relative order of saved messages.
    // Replay the observed prefixes to prove past ownership rather than trusting
    // a suggestion's own claim after a newly acquired user turn changes it.
    for (const snapshotId of path.snapshotIds) {
      const snapshot = sets.snapshots.get(snapshotId);
      for (const messageId of snapshot.messageIds) if (members.has(messageId)) seen.add(messageId);
      versionSeen ||= snapshot.messageVersionIds?.[ref.messageId] === ref.versionId;
      if (!versionSeen || !seen.has(qa.userMessageId) || !seen.has(ref.messageId)) continue;
      let userMessageId = null;
      for (const messageId of path.messageIds) {
        if (!seen.has(messageId)) continue;
        if (sets.messages.get(messageId).role === 'user') userMessageId = messageId;
        if (messageId === ref.messageId) { valid = userMessageId === qa.userMessageId; break; }
      }
      if (valid) break;
    }
    historicalEvidence.set(key, valid); return valid;
  }
  function validateReferences(value, owner, label) {
    if (Array.isArray(value)) { value.forEach((row, index) => validateReferences(row, owner, `${label}[${index}]`)); return; }
    if (!value || typeof value !== 'object') return;
    if (value.qaId != null) requireRef('qas', value.qaId, `${label}.qaId`);
    if (value.messageId != null) requireRef('messages', value.messageId, `${label}.messageId`);
    if (value.versionId != null) requireRef('versions', value.versionId, `${label}.versionId`);
    for (const [key, nested] of Object.entries(value)) {
      if (['raw', 'rawSource', 'graph', 'identity', 'nativeProject', 'scope', 'source'].includes(key)) continue;
      if (scalarRefs[key]) requireRef(scalarRefs[key], nested, `${label}.${key}`);
      if (arrayRefs[key]) members(arrayRefs[key], nested, `${label}.${key}`);
      if (key === 'qaId' && nested != null && (sets.qas.get(nested).conversationId !== owner.conversationId || (owner.pathId && sets.qas.get(nested).pathId !== owner.pathId))) fail('建议、整理包或修订中的 Q/A 引用跨对话或路径。');
      if (['qaIds', 'rangeQAIds', 'requestedRangeQAIds', 'coreQAIds', 'contextQAIds', 'contextBeforeQAIds', 'contextAfterQAIds'].includes(key) && nested.some(qaId => sets.qas.get(qaId).conversationId !== owner.conversationId || (owner.pathId && sets.qas.get(qaId).pathId !== owner.pathId))) fail('建议、整理包或修订中的 Q/A 成员跨对话或路径。');
      if (key === 'messageId' && nested != null && sets.messages.get(nested).conversationId !== owner.conversationId) fail('建议、整理包或修订中的消息引用跨对话。');
      if (key === 'versionId' && nested != null && (sets.versions.get(nested).conversationId !== owner.conversationId || (value.messageId && sets.versions.get(nested).messageId !== value.messageId))) fail('原文证据的消息与版本关联不一致。');
      if (key === 'messageId' && nested != null && value.qaId && ![sets.qas.get(value.qaId).userMessageId, ...sets.qas.get(value.qaId).responseMessageIds].includes(nested) && !belongsToHistoricalQA(value)) fail('原文证据的消息不属于指定 Q/A，且没有对应的历史采集依据。');
      if (key === 'pathId' && nested != null && sets.paths.get(nested).conversationId !== owner.conversationId) fail('建议、整理包或修订中的路径归属不一致。');
      if (key === 'messageVersionIds') for (const [messageId, versionId] of Object.entries(nested ?? {})) {
        requireRef('messages', messageId, `${label}.messageVersionIds.message`); requireRef('versions', versionId, `${label}.messageVersionIds.version`);
        if (sets.versions.get(versionId)?.messageId !== messageId || sets.messages.get(messageId)?.conversationId !== owner.conversationId) fail('整理签名的消息与版本关联不一致。');
      }
      validateReferences(nested, owner, `${label}.${key}`);
    }
  }
  for (const store of ['segments', 'revisions', 'suggestions', 'analysisPacks']) for (const row of payload.records[store]) validateReferences(row, row, store);
  const state = { ...payload.records }; for (const path of payload.records.paths) assertPartition(state, path.id);
  assertOPC(state);
  return { conversations: payload.records.conversations.length, messages: payload.records.messages.length, segments: payload.records.segments.filter(s => s.active).length };
}
export function restoreBackup(state, payload, projectId = null) {
  validateBackup(payload);
  payload = normalizeBackup(payload);
  let project = projectId ? state.projects.find(p => p.id === projectId) : null;
  if (projectId && !project) fail('目标项目不存在。');
  if (!project) { project = { ...copy(payload.project), id: id('prj'), name: `${payload.project.name}（备份恢复）`, restoredAt: now() }; state.projects.push(project); }
  const mapping = new Map([[payload.project.id, project.id]]);
  for (const name of BACKUP_STORES) for (const row of payload.records[name]) mapping.set(row.id, id(name.slice(0, 3)));
  const sharedTopics = new Map((state.topics ?? []).filter(row => row.projectId === project.id).map(row => [normalizeName(row.name), row.id]));
  for (const topic of payload.records.topics) {
    const key = normalizeName(topic.name);
    if (sharedTopics.has(key)) mapping.set(topic.id, sharedTopics.get(key)); else sharedTopics.set(key, mapping.get(topic.id));
  }
  for (const qa of payload.records.qas) mapping.set(qa.id, `qa:${mapping.get(qa.pathId)}:${mapping.get(qa.userMessageId)}`);
  for (const card of payload.records.qaCards) mapping.set(card.id, cardId(mapping.get(card.conversationId), mapping.get(card.logicalUserMessageId ?? card.userMessageId)));
  // Only local-reference fields are remapped. Platform IDs, raw JSON and source graph stay intact.
  const scalar = new Set(['id', 'projectId', 'conversationId', 'messageId', 'pathId', 'qaId', 'versionId', 'segmentId', 'preservedSegmentId', 'suggestionId', 'analysisPackId', 'revisionId', 'appliedRevisionId', 'userMessageId', 'currentVersionId', 'previousVersionId', 'currentPathId', 'parentMessageId', 'lastSnapshotId', 'snapshotId', 'selectedPathId', 'undoneBy', 'reversesId', 'cardId', 'timelineId', 'fromCardId', 'toCardId']);
  const arrays = new Set(['qaIds', 'rangeQAIds', 'requestedRangeQAIds', 'coreQAIds', 'contextQAIds', 'contextBeforeQAIds', 'contextAfterQAIds', 'topicIds', 'replacementIds', 'messageIds', 'lastCapturedMessageIds', 'versionIds', 'responseMessageIds', 'assistantMessageIds', 'toolMessageIds', 'pathIds', 'latestPathIds', 'snapshotIds']);
  function remap(value, key = '') {
    if (key === 'positions') return Object.fromEntries(Object.entries(value).map(([k, v]) => [mapping.get(k) ?? k, copy(v)]));
    if (['visibleAnswerIds', 'lastActiveAnswerIds', 'userMessageAliases'].includes(key)) return value.map(k => mapping.get(k) ?? k);
    if (key === 'logicalUserMessageId') return mapping.get(value) ?? value;
    if (['questionVersionId', 'packId', 'fragmentId', 'sourceVersionId', 'resolvedByCardId', 'supersededByDecisionId'].includes(key)) return mapping.get(value) ?? value;
    if (['selectedCardIds', 'selectedFragmentIds', 'selectedIssueIds', 'evidenceCardIds', 'conflictsWithDecisionIds', 'cardIds', 'selectedTimelineIds', 'trackOrder', 'collapsedTimelineIds', 'orderedCardIds'].includes(key)) return value.map(k => mapping.get(k) ?? k);
    if (key === 'sourceVersions') return { ...copy(value), cards: Object.fromEntries(Object.entries(value.cards ?? {}).map(([k, v]) => [mapping.get(k) ?? k, v ? { ...v, questionVersionId: mapping.get(v.questionVersionId) ?? v.questionVersionId, answerVersionIds: remap(v.answerVersionIds ?? {}, 'answerVersionIds') } : null])),
      decisions: (value.decisions ?? []).map(([k, ...rest]) => [mapping.get(k) ?? k, ...rest]), issues: (value.issues ?? []).map(([k, ...rest]) => [mapping.get(k) ?? k, ...rest]), fragments: (value.fragments ?? []).map(([k, version, revision]) => [mapping.get(k) ?? k, mapping.get(version) ?? version, revision]), relations: (value.relations ?? []).map(([k, ...rest]) => [mapping.get(k) ?? k, ...rest]) };
    if (key === 'qaCardId') return mapping.get(value) ?? value;
    if (['raw', 'rawSource', 'graph', 'identity', 'nativeProject', 'scope', 'original', 'mappings', 'unresolved'].includes(key)) return copy(value);
    if (scalar.has(key)) return mapping.get(value) ?? value;
    if (arrays.has(key)) { const mapped = value.map(k => mapping.get(k) ?? k); return key === 'topicIds' ? [...new Set(mapped)] : mapped; }
    if (['messageVersionIds', 'answerVersionIds', 'lastActiveAnswerVersionIds'].includes(key)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [mapping.get(k) ?? k, mapping.get(v) ?? v]));
    if (Array.isArray(value)) return value.map(v => remap(v));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, k)]));
    return value;
  }
  for (const name of BACKUP_STORES) {
    state[name] ??= [];
    for (const row of payload.records[name]) {
      const restored = remap(row);
      if (name === 'contextPacks') restored.recoveredReferenceMap = { ...restored.recoveredReferenceMap, ...Object.fromEntries(mapping) };
      if (name === 'topics') {
        const shared = state.topics.find(topic => topic.id === restored.id);
        if (shared) { shared.aliases = [...new Set([...(shared.aliases ?? []), ...(restored.aliases ?? []), restored.name])].filter(label => normalizeName(label) !== normalizeName(shared.name)); continue; }
      }
      if (['suggestions', 'analysisPacks'].includes(name)) {
        restored.restoredRefState = 'requires_regeneration'; restored.restoreReason = '备份恢复重建了本地对象 ID，源数据及导航签名必须重新生成；原始建议与证据已保留。';
        if (name === 'suggestions' && !['confirmed', 'rejected'].includes(restored.status)) { restored.status = 'needs_review'; restored.reviewReason = restored.restoreReason; }
      }
      state[name].push(restored);
    }
  }
  return { projectId: project.id, restored: true, conversations: payload.records.conversations.length };
}
