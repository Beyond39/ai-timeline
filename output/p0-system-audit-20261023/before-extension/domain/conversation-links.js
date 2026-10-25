import { id, now, copy, fail, short } from './common.js';

export const LINK_TYPES = { related: '相关讨论', supports: '支持', contradicts: '不同观点', depends_on: '依赖' };
export function linkEvidence(state, projectId, reference) {
  const conversation = state.conversations.find(row => row.id === reference?.conversationId && row.projectId === projectId);
  const message = state.messages.find(row => row.id === reference?.messageId && row.projectId === projectId && row.conversationId === conversation?.id);
  const version = state.versions.find(row => row.id === reference?.versionId && row.projectId === projectId && row.messageId === message?.id && row.conversationId === conversation?.id);
  if (!conversation || !message || !version || !message.versionIds.includes(version.id)) fail('关联必须指向同项目中确切保存的消息和正文版本。');
  return { conversationId: conversation.id, messageId: message.id, versionId: version.id };
}
export function saveConversationLink(state, args) {
  if (!state.projects.some(row => row.id === args.projectId)) fail('项目不存在。');
  const from = linkEvidence(state, args.projectId, args.from), to = linkEvidence(state, args.projectId, args.to);
  if (from.conversationId === to.conversationId) fail('请选择另一条 Conversation 建立跨会话关联。');
  if (!Object.hasOwn(LINK_TYPES, args.type)) fail('请选择有效的关联类型。');
  const note = String(args.note ?? '').trim(); if (note.length > 2000) fail('关联说明请控制在2000字以内。');
  const existing = args.linkId ? (state.conversationLinks ?? []).find(row => row.id === args.linkId && row.projectId === args.projectId) : null;
  if (args.linkId && !existing) fail('关联不存在或不属于当前项目。');
  if (existing && (existing.revision !== args.expectedRevision || existing.status !== 'active')) fail('关联已变化或归档，请重新打开后修改。');
  const duplicate = (state.conversationLinks ?? []).find(row => row.id !== existing?.id && row.projectId === args.projectId && row.status === 'active' && row.type === args.type && JSON.stringify(row.from) === JSON.stringify(from) && JSON.stringify(row.to) === JSON.stringify(to));
  if (duplicate) fail('这两个正文版本之间已存在相同关联。');
  const time = now(), record = existing ?? { id: id('link'), projectId: args.projectId, createdAt: time, revision: 0, history: [] };
  if (existing) record.history.push({ at: time, operation: 'edit', from: copy(record.from), to: copy(record.to), type: record.type, note: record.note });
  Object.assign(record, { from, to, type: args.type, note, status: 'active', basis: 'user_confirmed', updatedAt: time, revision: record.revision + 1 });
  state.conversationLinks ??= []; if (!existing) state.conversationLinks.push(record);
  return copy(record);
}
export function archiveConversationLink(state, { projectId, linkId, expectedRevision, archived = true }) {
  const row = (state.conversationLinks ?? []).find(record => record.id === linkId && record.projectId === projectId);
  if (!row || row.revision !== expectedRevision) fail('关联已变化，请刷新后重试。');
  if (!archived) { linkEvidence(state, projectId, row.from); linkEvidence(state, projectId, row.to); }
  row.history.push({ at: now(), operation: archived ? 'archive' : 'restore' });
  row.status = archived ? 'archived' : 'active'; row.updatedAt = now(); row.revision++;
  return copy(row);
}
export function listConversationLinks(state, { projectId, conversationId = null, archived = false }) {
  if (!state.projects.some(row => row.id === projectId)) fail('项目不存在。');
  const describe = ref => {
    const conversation = state.conversations.find(row => row.id === ref.conversationId && row.projectId === projectId);
    const message = state.messages.find(row => row.id === ref.messageId && row.projectId === projectId);
    const version = state.versions.find(row => row.id === ref.versionId && row.messageId === message?.id && row.projectId === projectId);
    return { ...ref, title: conversation?.title ?? '来源已移动', excerpt: short(version?.text ?? '', 180), historical: message?.currentVersionId !== ref.versionId, available: Boolean(conversation && message?.conversationId === conversation.id && version?.conversationId === conversation.id) };
  };
  return (state.conversationLinks ?? []).filter(row => row.projectId === projectId && row.status === (archived ? 'archived' : 'active') && (!conversationId || [row.from.conversationId, row.to.conversationId].includes(conversationId)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(row => ({ ...copy(row), fromSource: describe(row.from), toSource: describe(row.to) }));
}
