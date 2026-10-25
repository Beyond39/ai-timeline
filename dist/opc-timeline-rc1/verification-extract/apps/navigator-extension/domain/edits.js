import { id, now, copy, normalizeName, PALETTE, fail } from './common.js';
import { assertPartition } from './indexes.js';

const segmentShape = s => JSON.stringify([s.id, s.title, s.qaIds, s.topicIds, s.active, s.manual, s.replacementIds, s.organizationStatus, s.needsReview, s.organization]);
function preserveOrganizationEvidence(state, segment, before) {
  const originals = before.filter(row => row.organization);
  const evidence = [], signatures = [];
  for (const qaId of segment.qaIds) {
    const prior = originals.find(row => row.qaIds.includes(qaId));
    const refs = prior?.organization.evidence?.filter(ref => ref.qaId === qaId) ?? [];
    const signature = prior?.organization.qaSignatures?.find(row => row.qaId === qaId);
    if (refs.length && signature) {
      evidence.push(...copy(refs)); signatures.push(copy(signature));
    } else {
      const qa = state.qas.find(row => row.id === qaId);
      const refs = [qa.userMessageId, ...qa.responseMessageIds].map(messageId => ({ qaId, messageId,
        versionId: state.messages.find(row => row.id === messageId).currentVersionId }));
      evidence.push(...refs); signatures.push({ qaId, status: qa.status,
        messageVersionIds: Object.fromEntries(refs.map(ref => [ref.messageId, ref.versionId])) });
    }
  }
  segment.organization.evidence = evidence;
  segment.organization.qaSignatures = signatures;
}
// IndexedDB getAll orders by key, not insertion. A tie-breaker survives service-worker restarts.
export const nextRevisionSequence = state => state.revisions.reduce((value, row) => Math.max(value, Number.isSafeInteger(row.sequence) ? row.sequence : 0), state.revisions.length) + 1;
export function editSegment(state, args) {
  const segment = state.segments.find(s => s.id === args.segmentId && s.active); if (!segment) fail('Segment 已变化，请刷新地图。');
  if (segment.revision !== args.baseRevision) fail('该节点已在另一个窗口或采集中更新，请刷新后重试。');
  const affected = [segment], before = [copy(segment)];
  if (args.operation === 'rename') {
    if (!String(args.title ?? '').trim()) fail('标题不能为空。'); segment.title = String(args.title).trim();
  } else if (args.operation === 'topics') {
    const names = [], seenNames = new Set();
    for (const name of String(args.names ?? '').split(/[,，\n]/).map(n => n.trim()).filter(Boolean)) {
      const key = normalizeName(name);
      if (!seenNames.has(key)) { seenNames.add(key); names.push(name); }
    }
    segment.topicIds = [...new Set(names.map(name => {
      let topic = state.topics.find(t => t.projectId === segment.projectId && normalizeName(t.name) === normalizeName(name));
      if (!topic) { topic = { id: id('top'), projectId: segment.projectId, name, color: PALETTE[state.topics.filter(t => t.projectId === segment.projectId).length % PALETTE.length], aliases: [] }; state.topics.push(topic); }
      return topic.id;
    }))];
  } else if (args.operation === 'split') {
    const cut = segment.qaIds.indexOf(args.afterQAId) + 1;
    if (cut < 1 || cut >= segment.qaIds.length) fail('请在两轮 Q/A 之间选择拆分边界。');
    const second = { ...copy(segment), id: id('seg'), title: `${segment.title} · 后半段`, qaIds: segment.qaIds.slice(cut), revision: 0,
      createdAt: now(), replacementIds: [], manual: true, needsReview: Boolean(segment.needsReview) };
    segment.qaIds = segment.qaIds.slice(0, cut); segment.replacementIds = [second.id];
    second.ordinal = state.qas.find(q => q.id === second.qaIds[0]).ordinal; second.time = state.qas.find(q => q.id === second.qaIds[0]).time;
    state.segments.push(second); affected.push(second);
  } else if (args.operation === 'merge') {
    const ordered = state.segments.filter(s => s.active && s.pathId === segment.pathId).sort((a, b) => a.ordinal - b.ordinal);
    const other = ordered[ordered.findIndex(s => s.id === segment.id) + 1];
    if (!other || (args.otherSegmentId && args.otherSegmentId !== other.id)) fail('只能合并同一对话、同一路径中的下一个相邻 Segment。');
    if (args.otherBaseRevision != null && args.otherBaseRevision !== other.revision) fail('相邻节点已变化，请刷新后重试。');
    before.push(copy(other)); affected.push(other);
    segment.qaIds = [...segment.qaIds, ...other.qaIds]; segment.topicIds = [...new Set([...segment.topicIds, ...other.topicIds])];
    if (!segment.organization && other.organization) segment.organization = { ...copy(other.organization), inheritedViaMerge: true };
    if (other.needsReview) { segment.needsReview = true; segment.reviewReason ??= other.reviewReason; }
    other.active = false; other.replacementIds = [segment.id];
  } else fail('不支持的分段操作。');
  for (const item of affected) {
    item.manual = true; item.organizationStatus = item.needsReview ? 'needs_review' : 'confirmed'; item.revision++; item.updatedAt = now();
    if (item.active && item.organization) {
      // Editing navigation does not rerun analysis. Keep the exact historical
      // versions it used; boundary edits only redistribute inherited references.
      if (['split', 'merge'].includes(args.operation)) preserveOrganizationEvidence(state, item, before);
      item.organization.manuallyEditedAt = now();
    }
  }
  assertPartition(state, segment.pathId);
  const revision = { id: id('edit'), projectId: segment.projectId, conversationId: segment.conversationId, pathId: segment.pathId,
    operation: args.operation, actor: 'user', createdAt: now(), sequence: nextRevisionSequence(state), before, after: affected.map(copy), undoneBy: null };
  state.revisions.push(revision);
  const conversation = state.conversations.find(c => c.id === segment.conversationId); conversation.revision++;
  return { segmentId: segment.id, revisionId: revision.id };
}
export function undoLatest(state, projectId) {
  const revision = state.revisions.filter(r => r.projectId === projectId && !r.undoneBy && r.operation !== 'undo').sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (b.sequence ?? 0) - (a.sequence ?? 0))[0];
  if (!revision) fail('没有可撤销的人工修改。');
  const affected = revision.after.map(s => state.segments.find(row => row.id === s.id));
  if (affected.some((s, i) => !s || segmentShape(s) !== segmentShape(revision.after[i]))) fail('采集后成员或其他人工修改已变化，无法直接撤销此边界。请在当前成员上重新拆分或合并。');
  const before = affected.map(copy), priorIds = new Set(revision.before.map(s => s.id));
  for (const restored of revision.before) {
    const current = state.segments.find(s => s.id === restored.id);
    const currentRevision = current.revision;
    for (const key of Object.keys(current)) delete current[key];
    Object.assign(current, copy(restored), { revision: currentRevision + 1, updatedAt: now() });
  }
  for (const item of affected) if (!priorIds.has(item.id)) { item.active = false; item.replacementIds = revision.before.map(s => s.id); item.revision++; }
  for (const item of affected) {
    const firstQA = state.qas.find(q => q.id === item.qaIds[0]);
    if (firstQA) { item.ordinal = firstQA.ordinal; item.time = firstQA.time; }
  }
  const reverse = { id: id('edit'), projectId, conversationId: revision.conversationId, pathId: revision.pathId, operation: 'undo', actor: 'user',
    createdAt: now(), sequence: nextRevisionSequence(state), reversesId: revision.id, before, after: affected.map(copy), undoneBy: null };
  revision.undoneBy = reverse.id; state.revisions.push(reverse); assertPartition(state, revision.pathId);
  if (revision.operation === 'organization' && revision.suggestionId) {
    const suggestion = state.suggestions?.find(s => s.id === revision.suggestionId);
    if (suggestion) { suggestion.status = 'needs_review'; suggestion.revision++; suggestion.undoneAt = now(); suggestion.invalidatedReason = '整次整理已撤销；旧建议的地图版本已变化，请重新生成或重新导出整理包。'; }
  }
  state.conversations.find(c => c.id === revision.conversationId).revision++;
  return { segmentId: revision.before[0].id, revisionId: reverse.id };
}
