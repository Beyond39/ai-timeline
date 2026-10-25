import { id, short, now } from './common.js';

export function rebuildIndexes(state, conversation) {
  const messages = new Map(state.messages.filter(m => m.conversationId === conversation.id).map(m => [m.id, m]));
  for (const path of state.paths.filter(p => p.conversationId === conversation.id)) {
    const units = []; let unit = null;
    for (const messageId of path.messageIds) {
      const message = messages.get(messageId); if (!message) continue;
      if (message.role === 'user') {
        unit = { id: `qa:${path.id}:${message.id}`, projectId: conversation.projectId, conversationId: conversation.id,
          pathId: path.id, ordinal: units.length + 1, userMessageId: message.id, responseMessageIds: [],
          assistantMessageIds: [], toolMessageIds: [], preview: short(message.text) || (message.contentStatus === 'empty' ? '（空问题正文）' : '（问题正文不可取得）'), time: message.time };
        units.push(unit);
      } else if (unit) {
        unit.responseMessageIds.push(message.id);
        if (message.role === 'assistant') unit.assistantMessageIds.push(message.id);
        if (message.role === 'tool' || message.role === 'function') unit.toolMessageIds.push(message.id);
      }
    }
    for (const qa of units) {
      const group = [messages.get(qa.userMessageId), ...qa.responseMessageIds.map(k => messages.get(k))];
      qa.status = !qa.assistantMessageIds.length ? 'unanswered' : group.some(m => m.streaming === 'generating') ? 'generating' : group.some(m => m.contentStatus === 'body_unavailable') ? 'incomplete' : 'answered';
      qa.answerScope = path.scope?.kind === 'loaded_page' ? 'captured_page_only' : 'saved_path_only';
      qa.notSeenInLatest = !path.lastCapturedMessageIds.includes(qa.userMessageId);
      const existing = state.qas.find(q => q.id === qa.id);
      if (existing) Object.assign(existing, qa); else state.qas.push(qa);
    }
    const ordered = new Map(units.map((qa, i) => [qa.id, i]));
    const segments = state.segments.filter(s => s.pathId === path.id && s.active);
    const owners = new Map(segments.flatMap(s => s.qaIds.map(k => [k, s])));
    // Retain manual outer boundaries; newly acquired turns inside them are visible and flagged.
    for (let i = 0; i < units.length; i++) {
      const qa = units[i]; if (owners.has(qa.id)) continue;
      let left = i - 1, right = i + 1;
      while (left >= 0 && !owners.has(units[left].id)) left--;
      while (right < units.length && !owners.has(units[right].id)) right++;
      const leftOwner = left >= 0 ? owners.get(units[left].id) : null;
      const rightOwner = right < units.length ? owners.get(units[right].id) : null;
      if (leftOwner && leftOwner === rightOwner) {
        leftOwner.qaIds.push(qa.id); leftOwner.qaIds.sort((a, b) => ordered.get(a) - ordered.get(b));
        leftOwner.needsReview = true; leftOwner.reviewReason = '补采到原有连续边界内的新轮次；标题、主题和外侧人工边界已保留，请复核成员。';
        leftOwner.organizationStatus = 'needs_review';
        leftOwner.revision++; owners.set(qa.id, leftOwner);
      } else {
        const segment = { id: id('seg'), projectId: conversation.projectId, conversationId: conversation.id, pathId: path.id,
          title: qa.preview, qaIds: [qa.id], topicIds: [], manual: false, active: true, revision: 1, createdAt: now(), needsReview: false, replacementIds: [], organizationStatus: 'unorganized' };
        state.segments.push(segment); segments.push(segment); owners.set(qa.id, segment);
      }
    }
    for (const segment of segments) {
      segment.ordinal = ordered.get(segment.qaIds[0]) + 1;
      segment.time = state.qas.find(q => q.id === segment.qaIds[0])?.time ?? { value: null, precision: 'unknown', source: null };
      if (segment.organization?.qaSignatures) {
        const changed = segment.qaIds.some(key => {
          const qa = units.find(q => q.id === key), prior = segment.organization.qaSignatures.find(q => q.qaId === key);
          const current = qa ? Object.fromEntries([qa.userMessageId, ...qa.responseMessageIds].map(k => [k, messages.get(k)?.currentVersionId ?? null])) : null;
          return !prior || !current || Object.keys(prior.messageVersionIds ?? {}).length !== Object.keys(current).length ||
            Object.keys(current).some(messageId => prior.messageVersionIds?.[messageId] !== current[messageId]) ||
            (prior.status != null && prior.status !== qa.status);
        });
        if (changed && !segment.needsReview) {
          segment.needsReview = true; segment.organizationStatus = 'needs_review'; segment.revision++;
          segment.reviewReason = '已确认整理所依据的正文版本或回答组已更新；人工标题、主题和边界仍保留，请复核。';
        }
      }
    }
  }
}
export function assertPartition(state, pathId) {
  const units = state.qas.filter(q => q.pathId === pathId).sort((a, b) => a.ordinal - b.ordinal);
  const positions = new Map(units.map((q, i) => [q.id, i])), seen = new Set();
  for (const seg of state.segments.filter(s => s.pathId === pathId && s.active)) {
    if (!seg.qaIds.length) throw new Error('Segment 不能没有成员。');
    seg.qaIds.forEach((key, i) => {
      if (!positions.has(key) || seen.has(key) || (i > 0 && positions.get(key) !== positions.get(seg.qaIds[i - 1]) + 1)) throw new Error('Segment 成员必须连续、无重叠且指向真实 Q/A。');
      seen.add(key);
    });
  }
  if (seen.size !== units.length) throw new Error('分段必须覆盖本路径中的所有 Q/A。');
}
