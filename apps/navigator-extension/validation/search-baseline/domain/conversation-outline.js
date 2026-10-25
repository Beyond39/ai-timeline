import { fail, short, now, copy } from './common.js';

const effectiveRole = message => message.isAuxiliary ? { role: 'context', basis: 'platform' } : message.role === 'unknown' && message.roleUnverified && ['user', 'assistant', 'tool'].includes(message.confirmedRole)
  ? { role: message.confirmedRole, basis: 'manual' } : { role: message.roleUnverified ? 'unknown' : message.role ?? 'unknown', basis: message.roleUnverified || message.role === 'unknown' ? 'unverified' : 'platform' };

// This is a reading directory, not a replacement for source roles or the Q/A
// index. Manual labels are visible as manual, and unassigned bodies never vanish.
export function buildConversationOutline({ conversation, paths, messages, qas = [] }, { projectId, conversationId, pathId = null } = {}) {
  if (!conversation || conversation.id !== conversationId || conversation.projectId !== projectId) fail('Conversation 不存在或不属于当前项目。');
  const ownedPaths = paths.filter(path => path.conversationId === conversationId && path.projectId === projectId);
  const selected = pathId ?? conversation.currentPathId ?? (ownedPaths.length === 1 ? ownedPaths[0].id : null);
  const path = ownedPaths.find(row => row.id === selected);
  if (!path) fail('请先选择这个 Conversation 的有效阅读路径。');
  if (!Array.isArray(path.messageIds) || new Set(path.messageIds).size !== path.messageIds.length) fail('阅读路径的消息成员无效。');
  const byId = new Map(messages.map(message => [message.id, message]));
  const ordered = path.messageIds.map(messageId => {
    const message = byId.get(messageId);
    if (!message || message.projectId !== projectId || message.conversationId !== conversationId) fail('阅读路径引用了缺失或其他 Conversation 的正文。');
    return message;
  });
  const qaByQuestion = new Map(qas.filter(qa => qa.projectId === projectId && qa.conversationId === conversationId && qa.pathId === path.id).map(qa => [qa.userMessageId, qa]));
  const rounds = []; let active = null, ordinal = 0, orphan = 0;
  const start = (message, question) => {
    const qa = question && effectiveRole(message).basis === 'platform' ? qaByQuestion.get(message.id) : null;
    const round = { id: qa?.id ?? `reading:${path.id}:${message.id}`, qaId: qa?.id ?? null, ordinal: question ? ++ordinal : null,
      labelBasis: effectiveRole(message).basis, title: short(message.textPreview ?? message.text ?? '') || (question ? '问题正文未取得' : '辅助消息'),
      status: question ? 'unanswered' : 'unverified', questionMessageId: question ? message.id : null,
      responseMessageIds: [], messageIds: [], messageSummaries: [], orphanOrdinal: question ? null : ++orphan };
    rounds.push(round); return round;
  };
  for (const message of ordered) {
    const role = effectiveRole(message);
    if (role.role === 'user') active = start(message, true);
    else if (!active) start(message, false);
    const round = active ?? rounds[rounds.length - 1];
    if (message.id !== round.questionMessageId && round.questionMessageId) round.responseMessageIds.push(message.id);
    round.messageIds.push(message.id);
    round.messageSummaries.push({ id: message.id, role: message.role, isAuxiliary: message.isAuxiliary === true, roleUnverified: message.roleUnverified === true, confirmedRole: message.confirmedRole ?? null,
      effectiveRole: role.role, roleBasis: role.basis, time: copy(message.time ?? { value: null }), currentVersionId: message.currentVersionId, textPreview: message.textPreview ?? short(message.text ?? '', 180),
      textLength: message.textLength ?? message.text?.length ?? 0 });
    if (role.basis === 'manual') round.labelBasis = 'manual';
  }
  for (const round of rounds) if (round.questionMessageId) {
    const answer = round.messageSummaries.filter(message => message.id !== round.questionMessageId && message.effectiveRole === 'assistant');
    const contents = round.messageIds.map(key => byId.get(key));
    round.status = answer.length ? contents.some(message => message.streaming === 'generating') ? 'generating'
      : contents.some(message => message.contentStatus === 'body_unavailable') ? 'incomplete' : 'answered'
      : round.responseMessageIds.length ? 'role_unverified' : 'unanswered';
    // A stored reliable Q/A may include unknown auxiliary bodies. It remains
    // usable only if our displayed membership matches its actual index.
    const qa = qaByQuestion.get(round.questionMessageId);
    if (round.qaId && (qa.responseMessageIds.length !== round.responseMessageIds.length || qa.responseMessageIds.some((id, i) => id !== round.responseMessageIds[i]))) round.qaId = null;
  }
  const diagramPaths = ownedPaths.filter(row => !conversation.latestPathIds?.length || conversation.latestPathIds.includes(row.id) || row.id === path.id);
  const diagramIds = [...new Set(diagramPaths.flatMap(row => row.messageIds))];
  const messageTree = diagramIds.map(id => byId.get(id)).filter(message => message?.projectId === projectId && message.conversationId === conversationId).map(message => ({
    id: message.id, parentMessageId: diagramIds.includes(message.parentMessageId) ? message.parentMessageId : null,
    role: effectiveRole(message).role, isAuxiliary: message.isAuxiliary === true, time: copy(message.time ?? { value: null }), textPreview: message.textPreview ?? short(message.text ?? '', 180),
    pathId: (diagramPaths.find(row => row.id === path.id && row.messageIds.includes(message.id)) ?? diagramPaths.find(row => row.messageIds.includes(message.id)))?.id,
    onSelectedPath: path.messageIds.includes(message.id) }));
  return { conversation: copy(conversation), path: copy(path), paths: copy(ownedPaths), rounds, totalMessages: ordered.length,
    allMessageCount: diagramIds.length, branchCount: diagramPaths.length, messageTree,
    graphBasis: diagramPaths.every(row => row.status === 'reliable_graph') ? 'provided' : 'reading_groups',
    unknownMessages: ordered.filter(message => effectiveRole(message).basis === 'unverified').length,
    scopeDescription: path.scope?.description ?? conversation.lastScope?.description ?? '当前保存阅读路径；未展示的历史和分支保持未知。' };
}

export function labelMessageRole(state, { projectId, conversationId, pathId, messageId, role, expectedVersionId }) {
  const conversation = state.conversations.find(row => row.id === conversationId && row.projectId === projectId);
  const path = state.paths.find(row => row.id === pathId && row.projectId === projectId && row.conversationId === conversationId);
  const message = state.messages.find(row => row.id === messageId && row.projectId === projectId && row.conversationId === conversationId);
  if (!conversation || !path || !message || !path.messageIds.includes(messageId)) fail('标注正文不存在、已移动或不属于当前阅读路径。');
  if (message.role !== 'unknown' || !message.roleUnverified) fail('平台已确认的角色不能用阅读标注替换。');
  if (!['unknown', 'user', 'assistant', 'tool'].includes(role)) fail('请选择问题、回答、工具或未确认。');
  if (!expectedVersionId || message.currentVersionId !== expectedVersionId) fail('正文版本已更新，请重新打开后标注。');
  message.confirmedRole = role; message.confirmedRoleAt = now(); message.confirmedRoleBasis = 'user_reading_label';
  return { projectId, conversationId, pathId, messageId, role, basis: 'manual_reading_only' };
}
