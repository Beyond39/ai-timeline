import { id, now, fail, copy } from './common.js';

export const RELEASE_STORES = ['openIssues', 'decisions', 'knowledgeFragments', 'contextPacks', 'contextPackItems', 'contextTrays', 'timelinePreferences', 'importRecords'];
export const LIGHT_RELEASE_STORES = RELEASE_STORES.filter(s => !['contextPacks', 'contextPackItems'].includes(s));
export const ISSUE_STATES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
export const DECISION_STATES = ['候选结论', '已采纳决定', '已推翻决定', '待验证决定'];
export const PACK_MODES = ['FULL', 'COMPACT', 'DECISIONS', 'CUSTOM'];
export const CONFIRMATION_STATES = ['USER_CONFIRMED', 'SUGGESTED'];
export function initializeRelease(state) { for (const store of RELEASE_STORES) state[store] ??= []; }
export function checkRevision(row, expected) { if (expected != null && (row?.revision ?? 0) !== expected) fail('此内容已在另一窗口修改。当前编辑没有覆盖，请读取最新版本并核对。'); }
export function owned(state, store, key, projectId) { const row = (state[store] ?? []).find(r => r.id === key && r.projectId === projectId); if (!row) fail('对象不存在或不属于当前项目。'); return row; }
export function confirmedRelation(r) { return (r.confirmationStatus ?? 'USER_CONFIRMED') === 'USER_CONFIRMED'; }
const nonempty = (value, label) => { const text = String(value ?? '').trim(); if (!text) fail(`请填写${label}。`); return text; };
const unique = values => [...new Set(values ?? [])];
export function releaseMutation(state, action, args, sourceVersion = null) {
  initializeRelease(state);
  if (!state.projects.some(p => p.id === args.projectId)) fail('项目不存在。');
  const card = key => owned(state, 'qaCards', key, args.projectId);
  if (['issue', 'decision', 'fragment'].includes(action)) {
    const store = { issue: 'openIssues', decision: 'decisions', fragment: 'knowledgeFragments' }[action];
    const row = args.id ? owned(state, store, args.id, args.projectId) : null;
    checkRevision(row, args.expectedRevision);
    if (args.remove) { if (!row) fail('记录不存在。'); row.deleted = true; row.updatedAt = now(); row.revision = (row.revision ?? 0) + 1; return row; }
    const value = row ?? { id: id(action), projectId: args.projectId, createdAt: now(), revision: 0, author: 'user' };
    const cardId = Object.hasOwn(args, 'cardId') ? args.cardId || null : value.cardId ?? null;
    if (cardId) card(cardId);
    if (action !== 'issue' && !cardId && !value.sourceUnavailable) fail('请选择来源卡片。');
    const next = { ...value, cardId };
    if (action === 'issue') {
      next.title = nonempty(args.title ?? value.title, '问题标题'); next.description = String(args.description ?? value.description ?? '');
      next.status = args.status ?? value.status ?? 'OPEN'; if (!ISSUE_STATES.includes(next.status)) fail('问题状态无效。');
      next.resolutionNote = String(args.resolutionNote ?? value.resolutionNote ?? ''); next.resolvedByCardId = Object.hasOwn(args, 'resolvedByCardId') ? args.resolvedByCardId || null : value.resolvedByCardId ?? null;
      if (next.resolvedByCardId) card(next.resolvedByCardId);
    } else if (action === 'decision') {
      next.text = nonempty(args.text ?? value.text, '决定内容'); next.status = args.status ?? value.status ?? '候选结论';
      if (!DECISION_STATES.includes(next.status)) fail('决定状态无效。');
      next.verifiedByUser = Object.hasOwn(args, 'verifiedByUser') ? args.verifiedByUser === true : value.verifiedByUser ?? false;
      if (['已采纳决定', '已推翻决定'].includes(next.status) && !next.verifiedByUser) fail('采纳或推翻决定必须由用户明确确认。');
      next.evidenceCardIds = unique(args.evidenceCardIds ?? value.evidenceCardIds ?? [cardId]); next.evidenceCardIds.forEach(card);
      next.supersededByDecisionId = Object.hasOwn(args, 'supersededByDecisionId') ? args.supersededByDecisionId || null : value.supersededByDecisionId ?? null;
      if (next.supersededByDecisionId) { if (next.supersededByDecisionId === value.id) fail('决定不能取代自己。'); owned(state, 'decisions', next.supersededByDecisionId, args.projectId); }
      next.conflictsWithDecisionIds = unique(args.conflictsWithDecisionIds ?? value.conflictsWithDecisionIds); next.conflictsWithDecisionIds.forEach(key => { if (key === value.id) fail('决定不能与自己冲突。'); owned(state, 'decisions', key, args.projectId); });
    } else {
      next.title = nonempty(args.title ?? value.title, '摘录标题'); next.userNote = String(args.userNote ?? value.userNote ?? ''); next.fragmentType = 'manual_excerpt';
      if (!row) {
        const owner = card(cardId); if (!sourceVersion || sourceVersion.projectId !== args.projectId || sourceVersion.conversationId !== owner.conversationId) fail('摘录来源版本无效。');
        const messageIds = new Set([owner.userMessageId, ...(owner.userMessageAliases ?? []), ...owner.responseMessageIds, ...(owner.lastActiveAnswerIds ?? [])]);
        if (!messageIds.has(sourceVersion.messageId) || !['user', 'assistant'].includes(sourceVersion.role)) fail('摘录不是该 Q/A 的来源正文。');
        const text = String(args.evidenceText ?? ''), start = Number(args.start), end = Number(args.end), sourceText = sourceVersion.readingText ?? sourceVersion.text;
        if (!text || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || sourceText.slice(start, end) !== text) fail('摘录必须与指定来源版本和字符范围完全一致。');
        Object.assign(next, { sourceVersionId: sourceVersion.id, messageId: sourceVersion.messageId, sourceRange: { start, end }, evidenceText: text, text });
      }
    }
    Object.assign(value, next, { updatedAt: now(), revision: value.revision + 1, deleted: false }); if (!row) state[store].push(value); return value;
  }
  if (action === 'tray') {
    let tray = state.contextTrays.find(t => t.projectId === args.projectId);
    checkRevision(tray, args.expectedRevision);
    const keys = unique(args.cardIds); keys.forEach(card);
    if (!tray) { tray = { id: id('tray'), projectId: args.projectId, cardIds: [], revision: 0 }; state.contextTrays.push(tray); }
    tray.cardIds = args.operation === 'clear' ? [] : args.operation === 'remove' ? tray.cardIds.filter(k => !keys.includes(k)) : args.operation === 'replace' ? keys : unique([...tray.cardIds, ...keys]);
    tray.revision++; tray.updatedAt = now(); return tray;
  }
  if (action === 'timelinePreferences') {
    let row = state.timelinePreferences.find(t => t.projectId === args.projectId); checkRevision(row, args.expectedRevision);
    const selected = unique(args.selectedTimelineIds), order = unique(args.trackOrder ?? selected), collapsed = unique(args.collapsedTimelineIds);
    for (const key of unique([...selected, ...order, ...collapsed])) owned(state, 'timelines', key, args.projectId);
    if (!['hour', 'day', 'week', 'month'].includes(args.scale ?? 'day')) fail('时间尺度无效。');
    const zoom = Number(args.zoom ?? 1); if (!Number.isFinite(zoom) || zoom < .25 || zoom > 8) fail('时间缩放无效。');
    if (!row) { row = { id: id('tracks'), projectId: args.projectId, revision: 0 }; state.timelinePreferences.push(row); }
    Object.assign(row, { selectedTimelineIds: selected, trackOrder: order, collapsedTimelineIds: collapsed, scale: args.scale ?? 'day', zoom,
      scrollLeft: Math.max(0, Number(args.scrollLeft) || 0), scrollTop: Math.max(0, Number(args.scrollTop) || 0),
      ...(args.axisVersion===1 ? {axisVersion:1,axisSpanMs:Math.max(1000,Math.min(3155760000000,Number(args.axisSpanMs)||60000)),axisFit:args.axisFit===true} : {}),
      revision: row.revision + 1, updatedAt: now() }); return row;
  }
  fail('未知的用户判断操作。');
}
export function assertRelease(state) {
  initializeRelease(state);
  const ref = (store, key, row) => { if (key != null) owned(state, store, key, row.projectId); };
  for (const m of state.openIssues) { ref('qaCards', m.cardId, m); ref('qaCards', m.resolvedByCardId, m); if (!ISSUE_STATES.includes(m.status) || !String(m.title ?? '').trim()) fail('未解决问题记录无效。'); }
  for (const d of state.decisions) { ref('qaCards', d.cardId, d); (d.evidenceCardIds ?? []).forEach(k => ref('qaCards', k, d)); ref('decisions', d.supersededByDecisionId, d); (d.conflictsWithDecisionIds ?? []).forEach(k => ref('decisions', k, d)); if (!DECISION_STATES.includes(d.status) || !String(d.text ?? '').trim() || typeof d.verifiedByUser !== 'boolean' || ['已采纳决定', '已推翻决定'].includes(d.status) && !d.verifiedByUser) fail('决定记录或确认状态无效。'); }
  for (const f of state.knowledgeFragments) { ref('qaCards', f.cardId, f); ref('versions', f.sourceVersionId, f); ref('messages', f.messageId, f); if (!f.text || f.text !== f.evidenceText || !Number.isInteger(f.sourceRange?.start) || f.sourceRange.end - f.sourceRange.start !== f.text.length) fail('摘录证据无效。'); }
  for (const t of state.contextTrays) { if (!Array.isArray(t.cardIds) || new Set(t.cardIds).size !== t.cardIds.length) fail('上下文托盘无效。'); t.cardIds.forEach(k => ref('qaCards', k, t)); }
  for (const t of state.timelinePreferences) for (const key of [...t.selectedTimelineIds, ...t.trackOrder, ...t.collapsedTimelineIds]) ref('timelines', key, t);
  for (const p of state.contextPacks) {
    if (!PACK_MODES.includes(p.mode) || typeof p.generatedContent !== 'string' || typeof p.editedContent !== 'string' || !String(p.title ?? '').trim() || !Number.isInteger(p.tokenBudget) || p.tokenBudget < 1) fail('上下文包内容或预算无效。');
    p.selectedCardIds.forEach(k => ref('qaCards', k, p)); p.selectedFragmentIds.forEach(k => ref('knowledgeFragments', k, p));
  }
  const slots = new Set();
  for (const item of state.contextPackItems) { ref('contextPacks', item.packId, item); ref('qaCards', item.cardId, item); ref('knowledgeFragments', item.fragmentId, item); const key = `${item.packId}:${item.cardId}:${item.fragmentId ?? ''}`; if (slots.has(key)) fail('上下文包重复来源项。'); slots.add(key); }
  for (const row of state.importRecords) { ref('conversations', row.conversationId, row); ref('snapshots', row.snapshotId, row); }
}
export function migrateReleaseReferences(state, rewrite, archive) {
  initializeRelease(state); const removed = new Set(archive.unresolved), fix = key => rewrite.get(key) ?? key;
  archive.original.releaseRecords = copy(Object.fromEntries(RELEASE_STORES.map(s => [s, state[s].filter(r => r.projectId === archive.projectId)])));
  for (const row of [...state.openIssues, ...state.decisions, ...state.knowledgeFragments, ...state.contextPackItems]) {
    if (removed.has(row.cardId)) { row.unavailableSourceId = row.cardId; row.cardId = null; row.sourceUnavailable = true; } else if (row.cardId) row.cardId = fix(row.cardId);
    if (row.resolvedByCardId) row.resolvedByCardId = removed.has(row.resolvedByCardId) ? null : fix(row.resolvedByCardId);
    if (row.evidenceCardIds) row.evidenceCardIds = unique(row.evidenceCardIds.filter(k => !removed.has(k)).map(fix));
  }
  // A frozen pack is never regenerated during a migration. Old printed IDs
  // remain resolvable through this explicit map; user-edited output is untouched.
  for (const row of [...state.contextPacks, ...state.contextTrays]) {
    const key = row.selectedCardIds ? 'selectedCardIds' : 'cardIds';
    if (row[key]) { row.unavailableSourceIds = unique([...(row.unavailableSourceIds ?? []), ...row[key].filter(k => removed.has(k))]); row[key] = unique(row[key].filter(k => !removed.has(k)).map(fix)); }
    if (row.generatedContent) row.recoveredReferenceMap = { ...row.recoveredReferenceMap, ...Object.fromEntries(rewrite) };
  }
  const seen=new Set();state.contextPackItems=state.contextPackItems.filter(item=>{const key=`${item.packId}:${item.cardId}:${item.fragmentId??''}`;if(!item.cardId||!seen.has(key)){seen.add(key);return true;}const pack=state.contextPacks.find(p=>p.id===item.packId);if(pack){pack.recoveryWarnings??=[];pack.recoveryWarnings.push('来源身份归并后发现重复包含项；原包含选项完整保留在迁移归档。');}return false;});
}
