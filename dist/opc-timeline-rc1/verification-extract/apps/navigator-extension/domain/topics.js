import { copy, digest, fail, normalizeName, now } from './common.js';

const navigationChildren = value => Object.entries(value).filter(([key]) => !['raw', 'rawSource', 'graph', 'identity', 'source', 'scope'].includes(key));
function hasTopic(value, topic) {
  if (Array.isArray(value)) return value.some(row => hasTopic(row, topic));
  if (!value || typeof value !== 'object') return false;
  if (value.topicId === topic.id || value.topicIds?.includes(topic.id)) return true;
  if (Array.isArray(value.topics) && value.topics.some(label => typeof label === 'string' && normalizeName(label) === normalizeName(topic.name))) return true;
  return navigationChildren(value).some(([, nested]) => hasTopic(nested, topic));
}
function replaceTopic(value, topic, target) {
  if (Array.isArray(value)) { value.forEach(row => replaceTopic(row, topic, target)); return; }
  if (!value || typeof value !== 'object') return;
  if (value.topicId === topic.id) value.topicId = target.id;
  if (Array.isArray(value.topicIds)) value.topicIds = [...new Set(value.topicIds.map(key => key === topic.id ? target.id : key))];
  if (Array.isArray(value.topics)) value.topics = [...new Map(value.topics.map(label => {
    const updated = typeof label === 'string' && normalizeName(label) === normalizeName(topic.name) ? target.name : label;
    return [typeof updated === 'string' ? normalizeName(updated) : JSON.stringify(updated), updated];
  })).values()];
  for (const [, nested] of navigationChildren(value)) replaceTopic(nested, topic, target);
}
export async function previewTopicChange(state, args) {
  const { projectId, topicId, operation } = args;
  if (!['rename', 'merge'].includes(operation)) fail('请选择主题重命名或合并。');
  const topic = state.topics.find(row => row.id === topicId && row.projectId === projectId);
  if (!topic) fail('主题不存在或不属于当前项目。');
  let name = String(args.name ?? '').trim(), target = null;
  if (operation === 'rename') {
    if (!name) fail('主题名称不能为空。');
    if (name.length > 100) fail('主题名称请限制为 100 个字符以内。');
    if (state.topics.some(row => row.projectId === projectId && row.id !== topic.id && normalizeName(row.name) === normalizeName(name))) fail('同名主题已存在，请使用主题合并。');
  } else {
    target = state.topics.find(row => row.id === args.targetTopicId && row.projectId === projectId);
    if (!target || target.id === topic.id) fail('请选择当前项目中不同的目标主题。');
    name = target.name;
  }
  const segments = state.segments.filter(row => row.projectId === projectId && row.topicIds.includes(topic.id));
  const suggestions = (state.suggestions ?? []).filter(row => row.projectId === projectId && hasTopic(row, topic));
  const revisions = state.revisions.filter(row => row.projectId === projectId && hasTopic(row, topic));
  const packs = (state.analysisPacks ?? []).filter(row => row.projectId === projectId && hasTopic(row, topic));
  const token = await digest({ operation, projectId, topicId, name, targetTopicId: target?.id ?? null, revision: state.revision ?? 0, topic, target, segments, suggestions, revisions, packs });
  return { token, projectId, topicId, operation, name, targetTopicId: target?.id ?? null, topic: copy(topic), target: copy(target),
    segmentCount: segments.filter(row => row.active).length, allSegmentCount: segments.length,
    conversationCount: new Set(segments.filter(row => row.active).map(row => row.conversationId)).size,
    suggestionCount: suggestions.length, pendingSuggestionCount: suggestions.filter(row => !['confirmed', 'rejected'].includes(row.status)).length,
    revisionCount: revisions.length, analysisPackCount: packs.length };
}
export async function applyTopicChange(state, args) {
  const impact = await previewTopicChange(state, args);
  if (!args.token || impact.token !== args.token) fail('主题影响范围已发生变化，请重新预览后确认。');
  const original = state.topics.find(row => row.id === impact.topicId), old = copy(original);
  const target = impact.operation === 'merge' ? state.topics.find(row => row.id === impact.targetTopicId) : original;
  if (impact.operation === 'rename') {
    original.name = impact.name;
    original.aliases = [...new Set([...(original.aliases ?? []), old.name])].filter(label => normalizeName(label) !== normalizeName(original.name));
  } else {
    target.aliases = [...new Set([...(target.aliases ?? []), old.name, ...(old.aliases ?? [])])].filter(label => normalizeName(label) !== normalizeName(target.name));
  }
  target.updatedAt = now();
  const conversations = new Set();
  for (const segment of state.segments.filter(row => row.projectId === impact.projectId && hasTopic(row, old))) {
    replaceTopic(segment, old, target); segment.revision = (segment.revision ?? 0) + 1; segment.updatedAt = now(); conversations.add(segment.conversationId);
  }
  for (const store of ['revisions', 'suggestions', 'analysisPacks']) for (const row of state[store] ?? []) {
    if (row.projectId !== impact.projectId || !hasTopic(row, old)) continue;
    replaceTopic(row, old, target);
    if (store === 'suggestions' && !['confirmed', 'rejected'].includes(row.status)) {
      row.status = 'needs_review'; row.reviewReason = '主题名称或关联已调整，建议的标签与导航发生变化，请重新生成或复核。'; row.updatedAt = now();
    }
  }
  if (impact.operation === 'merge') state.topics = state.topics.filter(row => row.id !== original.id);
  for (const conversation of state.conversations.filter(row => conversations.has(row.id))) conversation.revision = (conversation.revision ?? 0) + 1;
  const project = state.projects.find(row => row.id === impact.projectId); if (project) project.updatedAt = now();
  return { projectId: impact.projectId, topicId: target.id, name: target.name, color: target.color, impact };
}
