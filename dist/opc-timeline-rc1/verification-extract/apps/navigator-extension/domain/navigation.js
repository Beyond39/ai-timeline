// Derived navigation only: no body copies, inferred relations or data mutations.
export function visibleSegments(view, selection = {}) {
  if (!view) return [];
  const conversations = view.conversations ?? [], paths = view.paths ?? [];
  const conversationIds = new Set(conversations.filter(row => !selection.filterConversationId || row.id === selection.filterConversationId).map(row => row.id));
  const pathsByConversation = new Map();
  for (const path of paths) if (!pathsByConversation.has(path.conversationId)) pathsByConversation.set(path.conversationId, path.id);
  const selectedPath = paths.find(path => path.id === selection.pathId && path.conversationId === selection.conversationId);
  const selectedPaths = new Map(conversations.map(row => [row.id, row.id === selectedPath?.conversationId ? selectedPath.id : row.currentPathId ?? pathsByConversation.get(row.id)]));
  const ordered = conversations.map((row, index) => ({ row, index })).sort((a, b) => {
    const first = a.row.sourceTime?.value, second = b.row.sourceTime?.value;
    return first && second ? first.localeCompare(second) || a.index - b.index : first ? -1 : second ? 1 : a.index - b.index;
  });
  const order = new Map(ordered.map(({ row }, index) => [row.id, index])), pathOrder = new Map(paths.map((row, index) => [row.id, index]));
  return (view.segments ?? []).filter(row => row.active && conversationIds.has(row.conversationId) && (selection.allPaths || row.pathId === selectedPaths.get(row.conversationId)) &&
    (!selection.stateFilter || (selection.stateFilter === 'pending' ? row.pendingSuggestionIds?.length : selection.stateFilter === 'needs_review' ? row.needsReview || row.organizationStatus === 'needs_review' || row.suggestionNeedsReview : row.organizationStatus === selection.stateFilter)) &&
    (!selection.topicId || (selection.topicId === '__none' ? !row.topicIds.length : row.topicIds.includes(selection.topicId))))
    .sort((a, b) => order.get(a.conversationId) - order.get(b.conversationId) || pathOrder.get(a.pathId) - pathOrder.get(b.pathId) || a.ordinal - b.ordinal);
}
export function qaNavigation(view, segments, segmentId = null) {
  const qas = new Map((view.qas ?? []).map(row => [row.id, row]));
  return segments.filter(row => !segmentId || row.id === segmentId).flatMap(segment => segment.qaIds.flatMap(id => {
    const qa = qas.get(id);
    return qa && qa.pathId === segment.pathId && qa.conversationId === segment.conversationId ? [{ qa, segment }] : [];
  }));
}
export function conversationOverview(view, segments) {
  const rows = new Map((view.conversations ?? []).map(conversation => [conversation.id, { conversation, segments: [], qaCount: 0, topicIds: new Set(), reviewCount: 0 }]));
  for (const segment of segments) {
    const row = rows.get(segment.conversationId); if (!row) continue;
    row.segments.push(segment); row.qaCount += segment.qaIds.length;
    segment.topicIds.forEach(id => row.topicIds.add(id));
    if (segment.needsReview || segment.suggestionNeedsReview) row.reviewCount++;
  }
  return [...rows.values()].map(row => ({ ...row, topicIds: [...row.topicIds] }));
}
export function topicGroups(view, segments) {
  const topics = new Map((view.topics ?? []).map(row => [row.id, row])), groups = new Map();
  for (const segment of segments) for (const id of segment.topicIds.length ? segment.topicIds : ['__none']) {
    if (!groups.has(id)) groups.set(id, { id, name: topics.get(id)?.name ?? '未分类', color: topics.get(id)?.color ?? '#8090a7', segments: [], qaCount: 0 });
    const group = groups.get(id); group.segments.push(segment); group.qaCount += segment.qaIds.length;
  }
  return [...groups.values()].sort((a, b) => (a.id === '__none') - (b.id === '__none') || b.qaCount - a.qaCount || a.name.localeCompare(b.name, 'zh-CN'));
}
export function resolveReadingPosition(view, position) {
  if (!position || position.projectId !== view?.project?.id) return null;
  const qa = view.qas.find(row => row.id === position.qaId && row.pathId === position.pathId && row.conversationId === position.conversationId);
  const conversation = view.conversations.find(row => row.id === qa?.conversationId);
  const path = view.paths.find(row => row.id === qa?.pathId && row.conversationId === qa?.conversationId);
  if (!qa || !conversation || !path) return null;
  const segment = view.segments.find(row => row.active && row.pathId === qa.pathId && row.qaIds.includes(qa.id));
  return { qa, conversation, path, segment };
}
