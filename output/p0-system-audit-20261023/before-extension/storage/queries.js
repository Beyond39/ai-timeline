import { STORES, readSnapshot } from './database.js';
import { fail } from '../domain/common.js';

export const emptyState = () => ({ ...Object.fromEntries(STORES.map(name => [name, []])), revision: 0 });
export const record = (store, key, name = store, project = null) => ({ store, key, name, mode: 'get', ...(project ? { project } : {}) });
export const indexed = (store, index, key, project = null, name = store) => ({ store, index, key, name, ...(project ? { project } : {}) });
export const keyed = (store, keys, project = null, name = store) => ({ store, keys: [...new Set(keys)], name, mode: 'keys', ...(project ? { project } : {}) });
export const lightMessage = row => ({ id: row.id, projectId: row.projectId, conversationId: row.conversationId, currentVersionId: row.currentVersionId,
  role: row.role, streaming: row.streaming, contentStatus: row.contentStatus, bodyHash: row.bodyHash, ...(row.bodyHash ? {} : { text: row.text }) });
export const lightVersion = row => ({ id: row.id, projectId: row.projectId, conversationId: row.conversationId, messageId: row.messageId });
export function segmentNavigation(row) {
  const { organization, ...navigation } = row;
  return { ...navigation, organizationStatus: row.organizationStatus ?? (row.needsReview ? 'needs_review' : row.manual ? 'confirmed' : 'unorganized'),
    ...(organization ? { organization: { method: organization.method, reason: organization.reason, confirmedAt: organization.confirmedAt,
      inheritedViaMerge: organization.inheritedViaMerge } } : {}) };
}
export function suggestionNavigation(row) {
  const { groups, beforeSegments, allowedEvidence, ...summary } = row;
  return { ...summary, groupCount: groups?.length ?? row.groupCount ?? 0 };
}
export function snapshotNavigation(row) {
  const { rawSource, graph, observations, messageVersionIds, ...summary } = row;
  return { ...summary, graphNodeCount: graph?.length ?? 0 };
}
export async function consistentRead(trace, run) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await run();
    if (result.revisions.every(value => value === result.revisions[0])) return result.value;
  }
  fail('数据正在另一个窗口更新，请稍后重新打开阅读内容。');
}
export async function sourceProjection(state, pathIds, trace, { fullText = false } = {}) {
  const keys = state.paths.filter(path => pathIds.has(path.id)).flatMap(path => path.messageIds);
  const source = await readSnapshot([keyed('messages', keys, fullText ? null : lightMessage)], trace);
  const versions = await readSnapshot([keyed('versions', source.messages.map(message => message.currentVersionId).filter(Boolean), lightVersion)], trace);
  state.messages = source.messages; state.versions = versions.versions;
  return [source.revision, versions.revision];
}
export async function relatedMessages(ids, trace, { targetMessageId = null, targetVersionId = null } = {}) {
  const initial = await readSnapshot([keyed('messages', ids)], trace);
  const versionIds = initial.messages.flatMap(message => [message.currentVersionId, ...(message.id === targetMessageId && targetVersionId ? [targetVersionId] : [])]).filter(Boolean);
  // A snapshot can contain the entire exported input. Never materialize it just
  // to show one message's match basis; new captures persist that small observation.
  const related = await readSnapshot([keyed('versions', versionIds)], trace);
  if (targetVersionId && !related.versions.some(version => version.id === targetVersionId && version.messageId === targetMessageId)) fail('整理引用的原文版本不存在或不属于指定消息。');
  const messages = initial.messages.map(message => ({ ...message, versionCount: message.versionIds?.length ?? 1,
    versions: related.versions.filter(version => version.messageId === message.id),
    latestObservation: message.latestObservation ?? null }));
  const byId = new Map(messages.map(message => [message.id, message]));
  return { messages: ids.map(key => { const message = byId.get(key); if (!message) fail('原文消息不存在。'); return message; }), revisions: [initial.revision, related.revision] };
}
export async function projectState(projectId, stores, trace) {
  const result = await readSnapshot([record('projects', projectId, 'project'), ...stores.map(store => indexed(store, 'projectId', projectId))], trace);
  if (!result.project) fail('项目不存在。');
  return { ...emptyState(), ...result, projects: [result.project] };
}
export async function conversationState(conversationId, trace, { fullText = false, suggestions = true } = {}) {
  const initial = await readSnapshot([record('conversations', conversationId, 'conversation')], trace);
  if (!initial.conversation) fail('对话不存在。');
  const projectId = initial.conversation.projectId;
  const navigation = await readSnapshot([
    record('projects', projectId, 'project'), indexed('topics', 'projectId', projectId),
    ...['paths', 'qas', 'segments'].map(store => indexed(store, 'conversationId', conversationId)),
    ...(suggestions ? [indexed('suggestions', 'conversationId', conversationId)] : [])
  ], trace);
  const state = { ...emptyState(), ...navigation, projects: [navigation.project], conversations: [initial.conversation] };
  const sourceRevisions = await sourceProjection(state, new Set(state.paths.map(path => path.id)), trace, { fullText });
  return { state, revisions: [initial.revision, navigation.revision, ...sourceRevisions] };
}
