import { exportWorkspaceData, validateWorkspaceData, restoreWorkspaceData, libraryChecksumInput } from '../domain/workspace-backup.js';
import { workspaceData, workspaceAnalysisCards } from './project-workspace.js';
import { workspaceById, workspaceMutation } from '../domain/project-workspace.js';
import { analyzeQA, reviewQA } from './tag-suggestions.js';
import { knowledgeDocuments } from './knowledge-documents.js';
import { projectDeletionPreview, deleteProjectData } from '../domain/project-deletion.js';
import { loadConversationLibrary, writeConversationManagement } from './conversation-management.js';
import { globalSearch, relatedDiscussions } from './search-index.js';
import { readState, commit, STORES, readSnapshot, withReadMetrics } from './database.js';
import { opcPage, opcDetail, opcState, opcRaw } from './opc.js';
import { releaseInfo, loadPack, writeRelease, compilePack, sourceVersion } from './release.js';
import { OPC_STORES, syncCards, opcMutation } from '../domain/opc.js';
import { copy, id, now, short, fail } from '../domain/common.js';
import { createProject, findConversation, saveConversation, moveConversation } from '../domain/captures.js';
import { editSegment, undoLatest } from '../domain/edits.js';
import { exportProject, validateBackup, restoreBackup, BACKUP_STORES } from '../domain/backup.js';
import { getOrganizationContext, generateRuleSuggestion, exportAnalysisPack, importOrganizationSuggestion, getSuggestion, summarizeSuggestion, updateOrganizationSuggestion, applyOrganizationSuggestion, rejectOrganizationSuggestion } from '../domain/organization.js';
import { previewTopicChange, applyTopicChange } from '../domain/topics.js';
import { latestDraftRecord, nextDraftSequence } from '../domain/drafts.js';
import { findTextMatches, normalizeForSearch } from '../domain/search.js';
import { applyCaptureLabels } from '../domain/capture-labels.js';
import { loadDocumentSources, loadDocumentRecipeList, loadDocumentRecipe, loadDocumentPrint } from './document-export.js';
import { saveDocumentRecipe, renameDocumentRecipe, archiveDocumentRecipe, createDocumentPrint } from '../domain/document-recipes.js';
import { loadConversationOutline } from './conversation-outline.js';
import { labelMessageRole } from '../domain/conversation-outline.js';
import { saveConversationLink, archiveConversationLink, listConversationLinks } from '../domain/conversation-links.js';
import { initializeMemory, makeRecoveryPoint, memoryStatus, readRecoveryPoint } from './memory.js';
import { digest, EXTENSION_VERSION } from '../domain/common.js';
import { emptyState, record, indexed, keyed, segmentNavigation, suggestionNavigation, snapshotNavigation, consistentRead, sourceProjection, relatedMessages, projectState, conversationState } from './queries.js';

function restoreLibrary(state,payload){
  const restored=payload.projects.map(project=>restoreBackup(state,project,null,{includeMapping:true}));
  restoreWorkspaceData(state,payload.workspaceData,Object.assign({},...restored.map(r=>r.referenceMap)));
  return {projectIds:restored.map(r=>r.projectId)};
}
let queue = Promise.resolve();
function auxiliary(operation) {
  const next = queue.then(operation); queue = next.catch(() => {}); return next;
}
export function mutate(operation) {
  const next = queue.then(async () => {
    const before = await readState(), state = copy(before), output = await operation(state);
    await commit(before, state); return output;
  });
  queue = next.catch(() => {}); return next;
}
export async function createDraft(bundle) {
  return mutate(state => {
    const draft = { ...bundle, id: id('draft'), createdAt: now(), sequence: nextDraftSequence(state.drafts), results: [], failures: [] };
    // Discard only superseded, uncommitted capture previews; imports remain recoverable.
    state.drafts = state.drafts.filter(d => d.kind !== 'capture' || d.results.length);
    state.drafts.push(draft); return preview(state, draft);
  });
}
function preview(state, draft) {
  if (draft.kind === 'backup') return { id: draft.id, kind: 'backup', filename: draft.filename, projectName: draft.payload.project?.name, counts: validateBackup(draft.payload) };
  return { id: draft.id, kind: draft.kind, filename: draft.filename, isExample: draft.isExample ?? false, projectHint: draft.projectHint, targetProjectId: draft.targetProjectId ?? null,
    conversations: draft.conversations.map((c, index) => ({ ...c, raw: undefined, graph: undefined, index,
      messages: c.messages.map(m => ({ ...m, raw: undefined })),
      existing: (() => { const match = findConversation(state, c); return match ? { id: match.id, projectId: match.projectId, savedMessages: state.messageCounts?.get(match.id) ?? state.messages.filter(m => m.conversationId === match.id).length } : null; })() })), results: draft.results, failures: draft.failures };
}
export async function latestDraft() {
  return withReadMetrics('latestDraft', trace => consistentRead(trace, async () => {
    const headers = await readSnapshot([{ store: 'drafts', project: row => ({ id: row.id, createdAt: row.createdAt, sequence: row.sequence }) }], trace);
    const latest = latestDraftRecord(headers.drafts); if (!latest) return { value: null, revisions: [headers.revision] };
    const loaded = await readSnapshot([record('drafts', latest.id, 'draft'), { store: 'conversations' }], trace);
    if (!loaded.draft) return { value: null, revisions: [headers.revision, loaded.revision] };
    const state = { ...emptyState(), conversations: loaded.conversations, messageCounts: new Map() };
    // A share URL saved before the platform exposed its conversation ID may later
    // be promoted using two reliable source message IDs. Preview must use the
    // same evidence as save, without reading candidate message bodies or versions.
    const candidates = new Set((loaded.draft.conversations ?? []).filter(input => input.sourceConversationId && (String(input.method).startsWith('chatgpt-dom') || input.method === 'chatgpt-data-v1') &&
      !loaded.conversations.some(conversation => conversation.platform === input.platform && conversation.sourceConversationId === input.sourceConversationId))
      .flatMap(input => loaded.conversations.filter(conversation => conversation.platform === input.platform && !conversation.sourceConversationId && conversation.identity?.basis === 'source_url_fallback').map(conversation => conversation.id)));
    const identities = await readSnapshot([...candidates].map(key => indexed('messages', 'conversationId', key, row => ({ id: row.id, projectId: row.projectId, conversationId: row.conversationId, sourceMessageId: row.sourceMessageId }), `identity:${key}`)), trace);
    state.messages = [...candidates].flatMap(key => identities[`identity:${key}`]);
    const matches = (loaded.draft.conversations ?? []).map(input => findConversation(state, input)).filter(Boolean);
    const counts = await readSnapshot([...new Set(matches.map(row => row.id))].map(key => ({ store: 'messages', index: 'conversationId', key, name: key, mode: 'count' })), trace);
    for (const match of matches) state.messageCounts.set(match.id, counts[match.id]);
    return { value: preview(state, loaded.draft), revisions: [headers.revision, loaded.revision, identities.revision, counts.revision] };
  }));
}
export async function saveDraft(args, progress) {
  const { draft } = await readSnapshot([record('drafts', args.draftId, 'draft')]); if (!draft) fail('预览已过期，请重新采集或导入。');
  let projectId = args.projectId;
  if (args.newProjectName) projectId = await mutate(s => {
    const record = s.drafts.find(d => d.id === args.draftId);
    if (record.targetProjectId && s.projects.some(p => p.id === record.targetProjectId)) return record.targetProjectId;
    const created = createProject(s, args.newProjectName).id; record.targetProjectId = created; return created;
  });
  if (draft.kind === 'backup') return mutate(s => { const record = s.drafts.find(d => d.id === args.draftId); const output = restoreBackup(s, record.payload, projectId); s.drafts = s.drafts.filter(d => d.id !== args.draftId); return output; });
  if (!projectId) fail('请先选择或创建本地项目。');
  const indices = args.indices ?? draft.conversations.map((_, i) => i); const results = [], failures = [];
  if (!Array.isArray(indices) || !indices.length || new Set(indices).size !== indices.length || indices.some(index => !Number.isInteger(index) || !draft.conversations[index])) fail('请选择有效且不重复的对话索引。');
  for (let position = 0; position < indices.length; position++) {
    const index = indices[position]; if (!Number.isInteger(index) || !draft.conversations[index]) fail('选择的对话索引无效。');
    progress?.({ processed: position, total: indices.length, title: draft.conversations[index].title });
    try {
      const output = await mutate(async s => {
        const record = s.drafts.find(d => d.id === args.draftId);
        const existing = record.results.find(r => r.index === index); if (existing) return existing;
        const input = applyCaptureLabels(record.conversations[index], args.bodyLabels?.[index] ?? {});
        const result = { ...await saveConversation(s, input, projectId, args.pathSelections?.[index], args.manualNative), index };
        record.results.push(result); return result;
      }); results.push(output);
    } catch (e) { failures.push({ index, title: draft.conversations[index].title, error: e.message }); }
  }
  await mutate(s => {
    const record = s.drafts.find(d => d.id === args.draftId); record.failures = failures;
    if (!failures.length) s.drafts = s.drafts.filter(d => d.id !== args.draftId);
  });
  progress?.({ processed: indices.length, total: indices.length });
  return { projectId, results, failures };
}
export async function listProjects() {
  return withReadMetrics('projects', async trace => {
    const s = await readSnapshot([{ store: 'projects' }, { store: 'conversations', project: row => ({ id: row.id, projectId: row.projectId }) }], trace);
    return s.projects.map(p => ({ ...p, conversationCount: s.conversations.filter(c => c.projectId === p.id).length }));
  });
}
export async function projectView(projectId) {
  return withReadMetrics('view', trace => consistentRead(trace, async () => {
    const navigation = await readSnapshot([record('projects', projectId, 'project'), ...['conversations', 'paths', 'qas', 'topics'].map(store => indexed(store, 'projectId', projectId)),
      indexed('segments', 'projectId', projectId, segmentNavigation), indexed('suggestions', 'projectId', projectId, suggestionNavigation),
      indexed('revisions', 'projectId', projectId, row => ({ id: row.id, projectId: row.projectId, undoneBy: row.undoneBy, operation: row.operation }))], trace);
    if (!navigation.project) fail('项目不存在。');
    const s = { ...emptyState(), ...navigation, projects: [navigation.project] };
    const versions = s.suggestions.length ? await sourceProjection(s, new Set(s.suggestions.map(row => row.pathId)), trace) : [];
    const fingerprintCache = new Map();
    const suggestions = await Promise.all(s.suggestions.filter(row => !row.archivedAt).map(row => summarizeSuggestion(s, row, fingerprintCache)));
    const segments = s.segments.map(segment => {
      const pending = suggestions.filter(row => ['pending', 'needs_review'].includes(row.status) && !row.archivedAt && row.pathId === segment.pathId && row.rangeQAIds.some(key => segment.qaIds.includes(key)));
      return { ...segment, pendingSuggestionIds: pending.map(row => row.id), suggestionNeedsReview: pending.some(row => row.stale || row.status === 'needs_review') };
    });
    return { value: { project: s.project, revision: s.revision, suggestions, segments, ...Object.fromEntries(['conversations', 'paths', 'qas', 'topics'].map(name => [name, s[name]])),
      undoAvailable: s.revisions.some(row => !row.undoneBy && row.operation !== 'undo') }, revisions: [navigation.revision, ...versions] };
  }));
}
export async function readQA(qaId) {
  return withReadMetrics('qa', trace => consistentRead(trace, async () => {
    const initial = await readSnapshot([record('qas', qaId, 'qa')], trace), qa = initial.qa; if (!qa) fail('问答不存在。');
    const navigation = await readSnapshot([record('conversations', qa.conversationId, 'conversation'), record('paths', qa.pathId, 'path', row => {
      const { messageIds, lastCapturedMessageIds, sourcePathKeys, snapshotIds, ...header } = row;
      return { ...header, messageCount: messageIds?.length ?? 0, snapshotCount: snapshotIds?.length ?? 0 };
    }), indexed('segments', 'qaIds', qa.id, segmentNavigation)], trace);
    const source = await relatedMessages([qa.userMessageId, ...qa.responseMessageIds], trace);
    return { value: { qa, conversation: navigation.conversation, path: navigation.path, segment: navigation.segments.find(segment => segment.active && segment.qaIds.includes(qa.id)), messages: source.messages },
      revisions: [initial.revision, navigation.revision, ...source.revisions] };
  }));
}
export async function messageVersions(messageId) {
  return withReadMetrics('messageVersions', trace => consistentRead(trace, async () => {
    const result = await readSnapshot([record('messages', messageId, 'message', row => ({ id: row.id, currentVersionId: row.currentVersionId, versionIds: row.versionIds })), indexed('versions', 'messageId', messageId)], trace);
    if (!result.message) fail('原文消息不存在。');
    const order = new Map((result.message.versionIds ?? []).map((key, index) => [key, index]));
    return { value: { messageId, currentVersionId: result.message.currentVersionId, versions: result.versions.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity)) }, revisions: [result.revision] };
  }));
}
export async function readConversation({ conversationId, pathId = null, offset = 0, targetMessageId = null, targetVersionId = null, limit = 35 }) {
  return withReadMetrics('conversation', trace => consistentRead(trace, async () => {
    const navigation = await readSnapshot([record('conversations', conversationId, 'conversation'), indexed('paths', 'conversationId', conversationId), indexed('snapshotSummaries', 'conversationId', conversationId, null, 'snapshots')], trace);
    if (!navigation.conversation) fail('对话不存在。');
    const path = navigation.paths.find(row => row.id === pathId);
    if (pathId && !path) fail('该阅读路径不存在或不属于这条对话。');
    let ids = path?.messageIds, keyRevision = navigation.revision;
    if (!ids) {
      const keys = await readSnapshot([{ store: 'messages', index: 'conversationOrder', mode: 'indexKeys', name: 'ordered', range: IDBKeyRange.bound([conversationId, -Infinity], [conversationId, Infinity, '\uffff']) },
        { store: 'messages', index: 'conversationId', key: conversationId, name: 'count', mode: 'count' }], trace);
      ids = keys.ordered.map(row => row.id); keyRevision = keys.revision;
      // Older externally restored records may lack firstSourceOrder. Retain them rather than hiding messages.
      if (ids.length !== keys.count) {
        const fallback = await readSnapshot([indexed('messages', 'conversationId', conversationId, row => ({ id: row.id, firstSourceOrder: row.firstSourceOrder }))], trace);
        ids = fallback.messages.sort((a, b) => (a.firstSourceOrder ?? Infinity) - (b.firstSourceOrder ?? Infinity) || a.id.localeCompare(b.id)).map(row => row.id); keyRevision = fallback.revision;
      }
    }
    const size = Math.max(1, Math.min(Number(limit) || 35, 80)), targetIndex = targetMessageId ? ids.indexOf(targetMessageId) : -1;
    const start = targetIndex >= 0 ? Math.floor(targetIndex / size) * size : Math.max(0, Math.floor(Number(offset) || 0));
    const source = await relatedMessages(ids.slice(start, start + size), trace, { targetMessageId, targetVersionId });
    return { value: { conversation: navigation.conversation, paths: navigation.paths, path, total: ids.length, offset: start, nextOffset: start + size < ids.length ? start + size : null,
      messages: source.messages, snapshots: navigation.snapshots }, revisions: [navigation.revision, keyRevision, ...source.revisions] };
  }));
}
export async function search({ projectId, query, offset = 0, limit = 35 }) {
  return withReadMetrics('search', trace => consistentRead(trace, async () => {
    const needle = normalizeForSearch(query); if (!needle.trim()) return { value: { results: [], total: 0, offset: 0, nextOffset: null }, revisions: [] };
    const start = Math.max(0, Math.floor(Number(offset) || 0)), size = Math.max(1, Math.min(Number(limit) || 35, 80));
    const navigation = await readSnapshot([indexed('conversations', 'projectId', projectId), indexed('qas', 'projectId', projectId)], trace);
    const messagesToQA = new Map(), firstQA = new Map();
    const conversations = new Map(navigation.conversations.map(conversation => [conversation.id, conversation]));
    for (const qa of navigation.qas) {
      const conversation = conversations.get(qa.conversationId); if (!conversation) continue;
      if (!firstQA.has(conversation.id) || qa.pathId === conversation.currentPathId && firstQA.get(conversation.id).pathId !== conversation.currentPathId) firstQA.set(conversation.id, qa);
      for (const key of [qa.userMessageId, ...qa.responseMessageIds]) if (!messagesToQA.has(key) || qa.pathId === conversation.currentPathId && messagesToQA.get(key).pathId !== conversation.currentPathId) messagesToQA.set(key, qa);
    }
    const titleHits = new Map(navigation.conversations.map(conversation => [conversation.id, normalizeForSearch(conversation.title).includes(needle)
      ? { conversationId: conversation.id, title: conversation.title, type: 'title', excerpt: conversation.title, qaId: firstQA.get(conversation.id)?.id ?? null, messageId: null } : null]));
    const results = []; let total = 0;
    const collect = result => { if (total >= start && results.length < size) results.push(result); total++; };
    // One indexed cursor per conversation preserves V0.2.1 result ordering. Full
    // current text is scanned once per request but never retained outside its page.
    const revisions = [navigation.revision];
    // Scan one conversation at a time so primary-key order is stable across pages.
    for (const conversation of navigation.conversations) {
      if (titleHits.get(conversation.id)) collect(titleHits.get(conversation.id));
      const result = await readSnapshot([indexed('messages', 'conversationId', conversation.id, message => {
        const match = findTextMatches(message.text, query, 1)[0]; if (!match) return null;
        const qa = messagesToQA.get(message.id);
        collect({ conversationId: conversation.id, title: conversation.title, type: message.role, excerpt: message.text.slice(Math.max(0, match.start - 45), match.end + 115), qaId: qa?.id ?? null, messageId: message.id, pathId: qa?.pathId ?? null });
        return null;
      }, `scan:${conversation.id}`)], trace);
      revisions.push(result.revision);
    }
    return { value: { results, total, offset: start, nextOffset: start + size < total ? start + size : null }, revisions };
  }));
}
async function readOrganizationContext(args) {
  return withReadMetrics('organizationContext', trace => consistentRead(trace, async () => {
    const result = await conversationState(args.conversationId, trace, { fullText: true });
    const state = result.state;
    state.suggestions = state.suggestions.filter(row => !row.archivedAt).map(row => ({ ...suggestionNavigation(row), groups: [], beforeSegments: [] }));
    const context = await getOrganizationContext(state, args);
    const cache = new Map(); context.suggestions = await Promise.all(state.suggestions.filter(row => row.pathId === context.path.id).map(row => summarizeSuggestion(state, row, cache)));
    return { value: context, revisions: result.revisions };
  }));
}
async function readSuggestion(args) {
  return withReadMetrics('organizationSuggestion', trace => consistentRead(trace, async () => {
    const selected = await readSnapshot([record('suggestions', args.suggestionId, 'suggestion')], trace);
    if (!selected.suggestion) fail('整理建议不存在或已删除。');
    const result = await conversationState(selected.suggestion.conversationId, trace, { suggestions: false });
    result.state.suggestions = [selected.suggestion];
    return { value: await getSuggestion(result.state, args), revisions: [selected.revision, ...result.revisions] };
  }));
}
export async function command(type, args) {
  if(type==='knowledgeDocuments')return knowledgeDocuments(args);
  if(type==='projectDeletePreview')return projectDeletionPreview(await readState(),args);
  if(type==='deleteProject')return auxiliary(async()=>{
    const before=await readState(),state=copy(before),result=deleteProjectData(state,args,STORES);
    const point=await makeRecoveryPoint({name:'删除「'+before.projects.find(p=>p.id===args.projectId).name+'」前的资料',reason:'project_delete'});
    if(point.dataRevision!==before.revision)fail('删除前资料已变化，恢复点已保留，请重新确认；未删除数据。');
    await commit(before,state);return {...result,recoveryPointId:point.id};
  });
  if(type==='qaAnalyze')return auxiliary(()=>analyzeQA(args));
  if(type==='qaReview')return auxiliary(()=>reviewQA(args));
  if(type==='workspaceData')return workspaceData(args);
  if(type==='workspaceWrite'&&args.action==='create'){await auxiliary(async()=>{const snapshot=await readSnapshot([{store:'projectWorkspaces',mode:'count',name:'count'}]);if(!snapshot.count)await makeRecoveryPoint({name:'启用 Project Workspace 前的资料',reason:'project_workspace_baseline'});});}
  if(type==='workspaceWrite')return mutate(async state=>workspaceMutation(state,args,args.action==='organize'?await workspaceAnalysisCards(state,workspaceById(state,args.workspaceId)):null));
  if (type === 'releaseInfo') return releaseInfo(args);
  if (type === 'sourceVersion') return sourceVersion(args);
  if (type === 'contextPack') return loadPack(args);
  if (type === 'releaseWrite') return auxiliary(() => writeRelease(args));
  if (type === 'contextCompile') return auxiliary(() => compilePack(args));
  if (type === 'opcEnsure') return mutate(state => {
    const versions = new Map(state.versions.map(v => [v.id, v]));
    for (const m of state.messages) if (!m.readingVisibility) { const raw = versions.get(m.currentVersionId)?.raw; m.channel ??= raw?.channel; m.recipient ??= raw?.recipient; }
    for (const c of state.conversations.filter(c => c.projectId === args.projectId)) syncCards(state, c);
    return { ready: true };
  });
  if (type === 'conversationLibrary') return loadConversationLibrary(args);
  if (type === 'conversationManage') return auxiliary(()=>writeConversationManagement(args));
  if (type === 'globalSearch') return globalSearch(args);
  if (type === 'relatedDiscussions') return relatedDiscussions(args);
  if (type === 'opcPage') return opcPage(args);
  if (type === 'opcTimeline') return opcPage({ ...args, timelineAllCards: true });
  if (type === 'opcDetail') return opcDetail(args);
  if (type === 'opcRaw') return opcRaw(args);
  if (type === 'opcWrite') return auxiliary(async () => {
    // Annotation edits do not load or clone chat bodies, versions or snapshots.
    if(String(args.projectId).startsWith('workspace_')){
      const scope=await opcState(args.projectId),card=scope.qaCards.find(c=>c.id===(args.cardId??args.fromCardId));
      if(!card)fail('请选择一个当前项目内的来源卡片。');
      if(!['metadata','relationship'].includes(args.action))fail('请在来源会话中编辑主题或画布；项目时间线仅保存浏览偏好。');
      if(args.action==='relationship'&&!scope.qaCards.some(c=>c.id===args.toCardId&&c.projectId===card.projectId))fail('跨来源项目的关系请先在来源画布中管理。');
      args={...args,projectId:card.projectId};
    }
    const before = await opcState(args.projectId), state = copy(before);
    const result = opcMutation(state, args.action, args);
    await commit(before, state); return result;
  });
  if (type === 'organizationArchiveList') {
    const data = await readSnapshot([{ store: 'projects' }, { store: 'conversations', project: row => ({ id: row.id, title: row.title }) },
      { store: 'suggestions', project: row => ({ id: row.id, projectId: row.projectId, conversationId: row.conversationId, revision: row.revision ?? 0, method: row.method,
        status: row.status, archivedAt: row.archivedAt ?? null, createdAt: row.createdAt }) }]);
    return data.suggestions.map(row => ({ ...row, projectName: data.projects.find(project => project.id === row.projectId)?.name ?? '未知项目', title: data.conversations.find(conversation => conversation.id === row.conversationId)?.title ?? '来源未知' }));
  }
  if (type === 'documentRecipeList') return loadDocumentRecipeList(args);
  if (type === 'documentRecipeGet') return loadDocumentRecipe(args);
  if (type === 'documentPrintGet') return loadDocumentPrint(args);
  if (type === 'memoryInitialize') return auxiliary(initializeMemory);
  if (type === 'memoryStatus') return memoryStatus();
  if (type === 'memoryCreate') return auxiliary(() => makeRecoveryPoint(args));
  if (type === 'memoryExport') {
    const state = await readState(), projects = state.projects.map(project => exportProject(state, project.id)); projects.forEach(validateBackup);
    const workspaceData=exportWorkspaceData(state);validateWorkspaceData(workspaceData,projects);
    return { format: 'acvn-library-backup', formatVersion: 1, extensionVersion: EXTENSION_VERSION, exportedAt: now(), projects, workspaceData, checksum: await digest(libraryChecksumInput(projects,workspaceData)) };
  }
  if (['memoryImportPreview', 'memoryImport'].includes(type)) {
    let payload; try { payload = JSON.parse(args.text); } catch { fail('资料库备份不是有效 JSON。'); }
    if (payload?.format !== 'acvn-library-backup' || payload.formatVersion !== 1 || !Array.isArray(payload.projects) || payload.checksum !== await digest(libraryChecksumInput(payload.projects,payload.workspaceData))) fail('资料库备份格式或校验码无效。');
    payload.projects.forEach(validateBackup);validateWorkspaceData(payload.workspaceData,payload.projects);
    if (type === 'memoryImportPreview') return { projects: payload.projects.length, conversations: payload.projects.reduce((sum, project) => sum + project.records.conversations.length, 0), messages: payload.projects.reduce((sum, project) => sum + project.records.messages.length, 0) };
    return mutate(state => restoreLibrary(state,payload));
  }
  if (type === 'memoryRestore') {
    const point = await readRecoveryPoint(args.pointId); if (args.expectedChecksum !== point.checksum) fail('恢复点已变化，请重新打开后再恢复。');
    return mutate(state => restoreLibrary(state,point));
  }
  if (type === 'connectionSources') {
    const result = await readSnapshot([record('projects', args.projectId, 'project'), indexed('conversations', 'projectId', args.projectId),
      { store: 'messages', index: args.conversationId ? 'conversationId' : 'projectId', key: args.conversationId || args.projectId,
        project: row => row.projectId === args.projectId ? { id: row.id, conversationId: row.conversationId, currentVersionId: row.currentVersionId, role: row.role,
          roleUnverified: row.roleUnverified, confirmedRole: row.confirmedRole, textPreview: short(row.text, 120), firstSourceOrder: row.firstSourceOrder } : null }]);
    if (!result.project) fail('项目不存在。'); result.messages.sort((a, b) => (a.firstSourceOrder ?? 0) - (b.firstSourceOrder ?? 0)); return result;
  }
  if (type === 'connectionList') return withReadMetrics('connectionList', async trace => listConversationLinks(await projectState(args.projectId, ['conversationLinks', 'conversations', 'messages', 'versions'], trace), args));
  if (type === 'conversationOutline') return loadConversationOutline(args);
  if (type === 'documentSources') return loadDocumentSources(args);
  if (type === 'projects') return listProjects();
  if (type === 'view') return projectView(args.projectId);
  if (type === 'qa') return readQA(args.qaId);
  if (type === 'messageVersions') return messageVersions(args.messageId);
  if (type === 'conversation') return readConversation(args);
  if (type === 'search') return search(args);
  if (type === 'latestDraft') return latestDraft();
  if (type === 'backup') return withReadMetrics('backup', async trace => exportProject(await projectState(args.projectId, BACKUP_STORES, trace), args.projectId));
  if (type === 'organizationContext') return readOrganizationContext(args);
  if (type === 'organizationSuggestion') return readSuggestion(args);
  if (type === 'topicPreview') return withReadMetrics('topicPreview', async trace => previewTopicChange(await projectState(args.projectId, ['segments', 'topics', 'suggestions', 'analysisPacks', 'revisions'], trace), args));
  return mutate(async state => {
    if (type === 'documentRecipeSave') return saveDocumentRecipe(state, args);
    if (type === 'documentRecipeRename') return renameDocumentRecipe(state, args);
    if (type === 'documentRecipeArchive') return archiveDocumentRecipe(state, args);
    if (type === 'documentPrintSave') return createDocumentPrint(state, args);
    if (type === 'connectionSave') return saveConversationLink(state, args);
    if (type === 'connectionArchive') return archiveConversationLink(state, args);
    if (type === 'organizationArchive') {
      const row = state.suggestions.find(item => item.id === args.suggestionId && item.projectId === args.projectId);
      if (!row || (row.revision ?? 0) !== args.expectedRevision) fail('整理建议已变化，请重新打开后再归档。');
      row.archivedAt = args.archived === false ? null : now(); row.revision = (row.revision ?? 0) + 1; return { id: row.id, archived: Boolean(row.archivedAt) };
    }
    if (['organizationApply', 'organizationUpdate'].includes(type) && state.suggestions.find(item => item.id === args.suggestionId)?.archivedAt) fail('这份建议已归档，请先恢复再操作。');
    if (type === 'labelMessageRole') return labelMessageRole(state, args);
    if (type === 'organizationRules') return generateRuleSuggestion(state, args);
    if (type === 'organizationExport') return exportAnalysisPack(state, args);
    if (type === 'organizationImport') return importOrganizationSuggestion(state, args);
    if (type === 'organizationUpdate') return updateOrganizationSuggestion(state, args);
    if (type === 'organizationApply') return applyOrganizationSuggestion(state, args);
    if (type === 'organizationReject') return rejectOrganizationSuggestion(state, args);
    if (type === 'topicApply') return applyTopicChange(state, args);
    if (type === 'createProject') return createProject(state, args.name);
    if (type === 'renameProject') { const project = state.projects.find(p => p.id === args.projectId); if (!project || !String(args.name ?? '').trim()) fail('项目不存在或名称为空。'); project.name = String(args.name).trim(); project.updatedAt = now(); return project; }
    if (type === 'editSegment') return editSegment(state, args);
    if (type === 'undo') return undoLatest(state, args.projectId);
    if (type === 'moveConversation') { const c = state.conversations.find(c => c.id === args.conversationId); if (!c) fail('对话不存在。'); moveConversation(state, c, args.projectId); return { projectId: args.projectId }; }
    if (type === 'discardDraft') { state.drafts = state.drafts.filter(d => d.id !== args.draftId); return { discarded: true }; }
    fail('未知的数据操作。');
  });
}
