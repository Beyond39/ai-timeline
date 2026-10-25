import { id, digest, now, copy, TOPICS, fail, normalizeName } from './common.js';
import { rebuildIndexes, assertPartition } from './indexes.js';

export function findConversation(state, input, projectId = null) {
  const same = state.conversations.filter(c => c.platform === input.platform).sort((a, b) => Number(b.projectId === projectId) - Number(a.projectId === projectId));
  if (input.sourceConversationId) {
    const exact = same.find(c => c.sourceConversationId === input.sourceConversationId); if (exact) return exact;
    // A URL may acquire its conversation ID after the first reply. Promote only with source-ID evidence.
    const reliableIds = new Set(input.messages.map(m => m.sourceMessageId).filter(Boolean));
    const promotions = String(input.method).startsWith('chatgpt-dom') ? same.filter(c => !c.sourceConversationId && c.identity?.basis === 'source_url_fallback' && state.messages.filter(m => m.conversationId === c.id && m.sourceMessageId && reliableIds.has(m.sourceMessageId)).length >= 2) : [];
    return promotions.length === 1 ? promotions[0] : null;
  }
  const stableURL = input.sourceUrl && (!String(input.method).startsWith('chatgpt-dom') || /\/share\/[^/]+/.test(new URL(input.sourceUrl).pathname));
  if (stableURL) return same.find(c => c.sourceUrl === input.sourceUrl && !c.sourceConversationId) ?? null;
  return input.fallbackKey ? same.find(c => c.fallbackKey === input.fallbackKey) ?? null : null;
}
export function createProject(state, name) {
  const trimmed = String(name ?? '').trim(); if (!trimmed) fail('请输入项目名称。');
  const project = { id: id('prj'), name: trimmed, createdAt: now(), updatedAt: now(), displayTimezone: 'Asia/Shanghai' };
  state.projects.push(project);
  TOPICS.forEach(([label, color]) => state.topics.push({ id: id('top'), projectId: project.id, name: label, color, aliases: [] }));
  return project;
}
function signature(m) { return JSON.stringify([m.role, m.text, m.contentTypes, m.attachments?.map(a => [a.type, a.name, a.reference])]); }
function mayMatch(a, b) { return a.role === b.role && !(a.sourceMessageId && b.sourceMessageId && a.sourceMessageId !== b.sourceMessageId) && !(a.sourceNodeId && b.sourceNodeId && a.sourceNodeId !== b.sourceNodeId); }
function fallbackMatches(incoming, old, matched) {
  const positions = new Map(old.map((m, i) => [m.id, i]));
  const assigned = new Map();
  const assign = (i, j, evidence) => {
    if (!incoming[i] || !old[j] || !mayMatch(incoming[i], old[j]) || matched.has(i) || [...matched.values()].some(v => v.message.id === old[j].id)) return;
    matched.set(i, { message: old[j], basis: evidence, confidence: 'uncertain' }); assigned.set(i, j);
  };
  const pairs = list => {
    const result = new Map(); for (let i = 0; i + 1 < list.length; i++) {
      const a = signature(list[i]), b = signature(list[i + 1]); if (a === b) continue;
      const key = `${a}\n${b}`; const values = result.get(key) ?? []; values.push(i); result.set(key, values);
    } return result;
  };
  const oldPairs = pairs(old), newPairs = pairs(incoming);
  for (const [key, indices] of newPairs) {
    const candidates = oldPairs.get(key);
    if (indices.length === 1 && candidates?.length === 1) {
      const i = indices[0], j = candidates[0];
      if (mayMatch(incoming[i], old[j]) && mayMatch(incoming[i + 1], old[j + 1])) {
        assign(i, j, 'unique_ordered_two_message_context'); assign(i + 1, j + 1, 'unique_ordered_two_message_context');
      }
    }
  }
  // Propagate an exact neighbour only from a matched context, in both directions.
  for (const direction of [1, -1]) {
    for (let k = 0; k < incoming.length; k++) {
      const i = direction === 1 ? k : incoming.length - 1 - k;
      if (matched.has(i)) continue;
      const anchor = matched.get(i - direction);
      const j = anchor ? positions.get(anchor.message.id) + direction : null;
      if (j != null && old[j] && signature(incoming[i]) === signature(old[j])) assign(i, j, 'exact_neighbour_of_ordered_anchor');
    }
  }
  for (let i = 0; i < incoming.length; i++) {
    if (matched.has(i) || incoming[i].sourceMessageId) continue;
    const left = matched.get(i - 1), right = matched.get(i + 1);
    if (!left) continue;
    const j = positions.get(left.message.id) + 1, candidate = old[j];
    if (!candidate || candidate.sourceMessageId || !mayMatch(incoming[i], candidate)) continue;
    const bounded = right && positions.get(right.message.id) === j + 1;
    const continued = i === incoming.length - 1 && j === old.length - 1 && incoming[i].rowHint && incoming[i].rowHint === candidate.rowHint &&
      (incoming[i].text.startsWith(candidate.text) || candidate.text.startsWith(incoming[i].text));
    if (bounded || continued) assign(i, j, bounded ? 'changed_body_between_two_ordered_anchors' : 'last_streaming_position_with_prefix_and_anchor');
  }
}
function compatible(old, incoming) {
  const newSet = new Set(incoming); const common = old.filter(k => newSet.has(k));
  if (!common.length) return false;
  let oldPos = -1, newPos = -1;
  for (const key of common) {
    const a = old.indexOf(key), b = incoming.indexOf(key);
    if (b <= newPos) return false;
    if (a > oldPos + 1 && b > newPos + 1) return false;
    oldPos = a; newPos = b;
  }
  return !(oldPos < old.length - 1 && newPos < incoming.length - 1);
}
function unionOrder(old, incoming) {
  const output = old.slice();
  for (let i = 0; i < incoming.length; i++) {
    const key = incoming[i]; if (output.includes(key)) continue;
    const next = incoming.slice(i + 1).find(k => output.includes(k));
    if (next) output.splice(output.indexOf(next), 0, key); else output.push(key);
  }
  return output;
}
export function moveConversation(state, conversation, projectId) {
  const target = state.projects.find(p => p.id === projectId); if (!target) fail('目标项目不存在。');
  const topicMap = new Map();
  const mapTopic = topicId => {
      if (topicMap.has(topicId)) return topicMap.get(topicId);
      const old = state.topics.find(t => t.id === topicId); if (!old) return null;
      let topic = state.topics.find(t => t.projectId === projectId && normalizeName(t.name) === normalizeName(old.name));
      if (!topic) { topic = { ...copy(old), id: id('top'), projectId }; state.topics.push(topic); }
      topicMap.set(topicId, topic.id); return topic.id;
  };
  for (const segment of state.segments.filter(s => s.conversationId === conversation.id)) { segment.topicIds = segment.topicIds.map(mapTopic).filter(Boolean); segment.revision++; }
  for (const store of ['messages', 'versions', 'snapshots', 'paths', 'qas', 'segments', 'revisions', 'suggestions', 'analysisPacks']) for (const item of state[store] ?? []) if (item.conversationId === conversation.id) item.projectId = projectId;
  for (const revision of state.revisions.filter(r => r.conversationId === conversation.id)) {
    for (const seg of [...(revision.before ?? []), ...(revision.after ?? [])]) {
      seg.projectId = projectId; seg.topicIds = seg.topicIds.map(mapTopic).filter(Boolean);
    }
  }
  const remapNavigation = value => {
    if (Array.isArray(value)) { value.forEach(remapNavigation); return; }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.topicIds)) value.topicIds = [...new Set(value.topicIds.map(mapTopic).filter(Boolean))];
    if (value.projectId != null) value.projectId = projectId;
    for (const [key, nested] of Object.entries(value)) if (!['raw', 'rawSource', 'graph', 'identity', 'source', 'scope'].includes(key)) remapNavigation(nested);
  };
  for (const store of ['suggestions', 'analysisPacks']) for (const item of state[store] ?? []) if (item.conversationId === conversation.id) {
    remapNavigation(item);
    if (store === 'suggestions' && !['confirmed', 'rejected'].includes(item.status)) {
      item.status = 'needs_review'; item.reviewReason = '对话已迁移至另一个项目，主题及导航归属发生变化，请重新生成或复核建议。';
    }
  }
  conversation.projectId = projectId;
  conversation.revision++;
}
export async function saveConversation(state, input, projectId, selection = null, manualNative = null) {
  if (!state.projects.some(p => p.id === projectId)) fail('请先选择或创建本地项目。');
  if (!input.messages.length) fail('当前对话没有识别到消息，未保存空记录。');
  const stats = { createdMessages: 0, reusedMessages: 0, changedMessages: 0, uncertainMatches: 0, newPaths: 0 };
  let conversation = findConversation(state, input, projectId);
  if (!conversation) {
    conversation = { id: id('conv'), projectId, platform: input.platform, sourceConversationId: input.sourceConversationId,
      sourceUrl: input.sourceUrl ?? null, fallbackKey: input.fallbackKey ?? null,
      identity: { basis: input.identityBasis, confidence: input.sourceConversationId ? 'provided' : 'uncertain' },
      savedAt: now(), revision: 0, currentPathId: null };
    state.conversations.push(conversation);
  } else if (conversation.projectId !== projectId) moveConversation(state, conversation, projectId);
  if (!conversation.sourceConversationId && input.sourceConversationId) {
    conversation.sourceConversationId = input.sourceConversationId;
    conversation.identity = { basis: 'source_conversation_id_promoted_with_two_source_message_ids', confidence: 'provided' };
  }
  conversation.title = input.title; conversation.sourceUrl = input.sourceUrl ?? conversation.sourceUrl;
  if (input.sourceTime?.value || !conversation.sourceTime) conversation.sourceTime = input.sourceTime;
  if (manualNative) conversation.nativeProject = { id: null, name: String(manualNative), status: 'manual', basis: 'user_selection' };
  else if (conversation.nativeProject?.status !== 'manual' || input.nativeProject?.status === 'provided') conversation.nativeProject = input.nativeProject;
  const prior = state.messages.filter(m => m.conversationId === conversation.id);
  const oldPath = state.paths.find(p => p.id === conversation.currentPathId);
  const byId = new Map(prior.map(m => [m.id, m])), bySource = new Map(prior.filter(m => m.sourceMessageId).map(m => [m.sourceMessageId, m]));
  const byNode = new Map(prior.filter(m => m.sourceNodeId).map(m => [m.sourceNodeId, m]));
  const matched = new Map(); input.messages.forEach((m, i) => {
    if (m.sourceMessageId && bySource.has(m.sourceMessageId)) matched.set(i, { message: bySource.get(m.sourceMessageId), basis: 'source_message_id', confidence: 'provided' });
    else if (m.sourceNodeId && byNode.has(m.sourceNodeId) && mayMatch(m, byNode.get(m.sourceNodeId))) matched.set(i, { message: byNode.get(m.sourceNodeId), basis: 'source_export_node_id', confidence: 'provided' });
  });
  fallbackMatches(input.messages, oldPath?.messageIds.map(k => byId.get(k)).filter(Boolean) ?? [], matched);
  const snapshotId = id('cap'), mapping = new Map(), observations = [], versionIds = {};
  for (let i = 0; i < input.messages.length; i++) {
    const source = input.messages[i], found = matched.get(i);
    const bodyHash = await digest([source.role, source.text, source.contentTypes, source.attachments, source.contentStatus]);
    let message = found?.message;
    if (!message) {
      message = { id: id('msg'), projectId, conversationId: conversation.id, sourceMessageId: source.sourceMessageId, sourceNodeId: source.sourceNodeId ?? null,
        versionIds: [], currentVersionId: null, firstCapturedAt: input.capturedAt, firstSourceOrder: source.position,
        identity: { basis: source.identityBasis, confidence: source.sourceMessageId || source.sourceNodeId ? 'provided' : 'uncertain' } };
      state.messages.push(message); stats.createdMessages++;
    } else { stats.reusedMessages++; if (found.confidence === 'uncertain') stats.uncertainMatches++; }
    if (!message.sourceMessageId && source.sourceMessageId) message.sourceMessageId = source.sourceMessageId;
    if (source.sourceNodeId) message.sourceNodeId = source.sourceNodeId;
    if (message.bodyHash !== bodyHash) {
      if (message.currentVersionId) stats.changedMessages++;
      const version = { id: id('ver'), projectId, conversationId: conversation.id, messageId: message.id, previousVersionId: message.currentVersionId,
        snapshotId, bodyHash, capturedAt: input.capturedAt, text: source.text, role: source.role, contentTypes: source.contentTypes,
        attachments: source.attachments, contentStatus: source.contentStatus, raw: source.raw ?? null };
      state.versions.push(version); message.versionIds.push(version.id); message.currentVersionId = version.id;
    }
    Object.assign(message, { text: source.text, role: source.role, originalRole: source.originalRole ?? source.role, contentTypes: source.contentTypes,
      attachments: source.attachments, contentStatus: source.contentStatus, bodyHash, streaming: source.streaming,
      sourceParentKey: source.sourceParentKey ?? message.sourceParentKey ?? null, rowHint: source.rowHint ?? message.rowHint ?? null,
      lastCapturedAt: input.capturedAt, lastSnapshotId: snapshotId });
    if (source.time?.value || !message.time) message.time = source.time;
    mapping.set(source.key, message.id); versionIds[message.id] = message.currentVersionId;
    observations.push({ messageId: message.id, sourceKey: source.key, sourceNodeId: source.sourceNodeId ?? null, position: source.position,
      basis: found?.basis ?? source.identityBasis, confidence: found?.confidence ?? message.identity.confidence,
      sourceTime: source.time, streaming: source.streaming, sourceParentKey: source.sourceParentKey });
  }
  const nodeToMessage = new Map(input.messages.map(m => [m.nodeKey ?? m.key, mapping.get(m.key)]));
  const sourceToMessage = new Map(state.messages.filter(m => m.conversationId === conversation.id && m.sourceMessageId).map(m => [m.sourceMessageId, m.id]));
  for (const source of input.messages) {
    const message = state.messages.find(m => m.id === mapping.get(source.key));
    message.parentMessageId = source.sourceParentKey != null ? nodeToMessage.get(source.sourceParentKey) ?? sourceToMessage.get(source.sourceParentKey) ?? null : message.parentMessageId ?? null;
  }
  let selectedId = null; const selectedKey = selection ?? input.currentPathKey; const pathIds = [];
  for (const sourcePath of input.paths) {
    const incoming = sourcePath.messageKeys.map(k => mapping.get(k)).filter(Boolean);
    if (!incoming.length) continue;
    const candidates = state.paths.filter(p => p.conversationId === conversation.id && !pathIds.includes(p.id) && compatible(p.messageIds, incoming));
    let path = candidates.find(p => p.sourcePathKeys.includes(sourcePath.key)) ?? candidates.find(p => p.id === conversation.currentPathId) ?? candidates[0];
    if (!path) {
      path = { id: id('path'), projectId, conversationId: conversation.id, messageIds: [], sourcePathKeys: [], snapshotIds: [], createdAt: now() };
      state.paths.push(path); stats.newPaths++;
    }
    path.messageIds = path.messageIds.length ? unionOrder(path.messageIds, incoming) : incoming;
    if (new Set(path.messageIds).size !== path.messageIds.length) fail('路径消息重复，保存已取消。');
    path.sourcePathKeys = [...new Set([...path.sourcePathKeys, sourcePath.key])]; path.snapshotIds.push(snapshotId);
    Object.assign(path, { label: sourcePath.label, status: sourcePath.status, scope: input.scope, lastCapturedMessageIds: incoming, updatedAt: input.capturedAt });
    pathIds.push(path.id); if (sourcePath.key === selectedKey) selectedId = path.id;
  }
  conversation.currentPathId = selectedId ?? conversation.currentPathId ?? null;
  conversation.currentPathStatus = selectedId ? (selection && selection !== input.currentPathKey ? 'user_selected' : 'source_selected') : 'unknown';
  conversation.lastCapturedAt = input.capturedAt; conversation.lastScope = input.scope; conversation.revision++;
  const warnings = [...input.warnings];
  if (stats.uncertainMatches) warnings.push(`${stats.uncertainMatches} 条消息使用上下文回退匹配，匹配依据与不确定性已记录在快照中。`);
  if (stats.newPaths && oldPath) warnings.push('出现新分支或无法确认连续性的采集范围，已另存阅读路径；旧消息和人工整理继续保留。');
  state.snapshots.push({ id: snapshotId, projectId, conversationId: conversation.id, capturedAt: input.capturedAt,
    method: input.method, scope: input.scope, sourceUrl: input.sourceUrl, sourceConversationId: input.sourceConversationId, title: input.title,
    sourceTime: input.sourceTime, nativeProject: input.nativeProject, fileSource: input.fileSource ?? null, messageIds: observations.map(o => o.messageId), messageVersionIds: versionIds,
    observations, graph: copy(input.graph ?? []), pathIds, selectedPathId: selectedId, warnings,
    rawSource: input.raw ?? null, contentHash: await digest(input.messages), stats });
  rebuildIndexes(state, conversation);
  for (const path of state.paths.filter(p => p.conversationId === conversation.id)) assertPartition(state, path.id);
  return { conversationId: conversation.id, projectId, snapshotId, pathId: conversation.currentPathId, warnings, ...stats };
}
