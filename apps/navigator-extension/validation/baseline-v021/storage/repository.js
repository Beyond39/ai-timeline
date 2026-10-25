import { readState, commit, STORES } from './database.js';
import { copy, id, now, short, fail } from '../domain/common.js';
import { createProject, findConversation, saveConversation, moveConversation } from '../domain/captures.js';
import { editSegment, undoLatest } from '../domain/edits.js';
import { exportProject, validateBackup, restoreBackup } from '../domain/backup.js';
import { getOrganizationContext, generateRuleSuggestion, exportAnalysisPack, importOrganizationSuggestion, getSuggestion, updateOrganizationSuggestion, applyOrganizationSuggestion, rejectOrganizationSuggestion } from '../domain/organization.js';
import { previewTopicChange, applyTopicChange } from '../domain/topics.js';
import { latestDraftRecord, nextDraftSequence } from '../domain/drafts.js';
import { findTextMatches, normalizeForSearch } from '../domain/search.js';

let queue = Promise.resolve();
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
      existing: (() => { const match = findConversation(state, c); return match ? { id: match.id, projectId: match.projectId, savedMessages: state.messages.filter(m => m.conversationId === match.id).length } : null; })() })), results: draft.results, failures: draft.failures };
}
export async function latestDraft() { const state = await readState(); const draft = latestDraftRecord(state.drafts); return draft ? preview(state, draft) : null; }
export async function saveDraft(args, progress) {
  let state = await readState(), draft = state.drafts.find(d => d.id === args.draftId); if (!draft) fail('预览已过期，请重新采集或导入。');
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
        const result = { ...await saveConversation(s, record.conversations[index], projectId, args.pathSelections?.[index], args.manualNative), index };
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
  const s = await readState(); return s.projects.map(p => ({ ...p, conversationCount: s.conversations.filter(c => c.projectId === p.id).length }));
}
export async function projectView(projectId) {
  const s = await readState(); const project = s.projects.find(p => p.id === projectId); if (!project) fail('项目不存在。');
  const fingerprintCache = new Map();
  const suggestions = await Promise.all(s.suggestions.filter(r => r.projectId === projectId).map(r => getSuggestion(s, { suggestionId: r.id }, fingerprintCache)));
  const segments = s.segments.filter(r => r.projectId === projectId).map(segment => {
    const pending = suggestions.filter(r => ['pending', 'needs_review'].includes(r.status) && r.pathId === segment.pathId && r.rangeQAIds.some(k => segment.qaIds.includes(k)));
    return { ...segment, organizationStatus: segment.needsReview ? 'needs_review' : segment.organizationStatus ?? (segment.manual ? 'confirmed' : 'unorganized'),
      pendingSuggestionIds: pending.map(r => r.id), suggestionNeedsReview: pending.some(r => r.stale || r.status === 'needs_review') };
  });
  return { project, revision: s.revision, suggestions, segments, ...Object.fromEntries(['conversations', 'paths', 'qas', 'topics'].map(name => [name, s[name].filter(r => r.projectId === projectId)])),
    undoAvailable: s.revisions.some(r => r.projectId === projectId && !r.undoneBy && r.operation !== 'undo') };
}
function fullMessage(state, messageId) {
  const message = state.messages.find(m => m.id === messageId); if (!message) fail('原文消息不存在。');
  return { ...message, versions: state.versions.filter(v => v.messageId === message.id),
    latestObservation: state.snapshots.find(s => s.id === message.lastSnapshotId)?.observations.find(o => o.messageId === message.id) ?? null };
}
export async function readQA(qaId) {
  const s = await readState(), qa = s.qas.find(q => q.id === qaId); if (!qa) fail('问答不存在。');
  const conversation = s.conversations.find(c => c.id === qa.conversationId), path = s.paths.find(p => p.id === qa.pathId);
  return { qa, conversation, path, segment: s.segments.find(seg => seg.active && seg.qaIds.includes(qa.id)), messages: [qa.userMessageId, ...qa.responseMessageIds].map(key => fullMessage(s, key)) };
}
export async function readConversation({ conversationId, pathId = null, offset = 0, targetMessageId = null, limit = 35 }) {
  const s = await readState(), conversation = s.conversations.find(c => c.id === conversationId); if (!conversation) fail('对话不存在。');
  const paths = s.paths.filter(p => p.conversationId === conversationId), path = paths.find(p => p.id === pathId);
  const messages = s.messages.filter(m => m.conversationId === conversationId).sort((a, b) => a.firstSourceOrder - b.firstSourceOrder || a.id.localeCompare(b.id));
  const ids = path ? path.messageIds : messages.map(m => m.id);
  limit = Math.max(1, Math.min(Number(limit) || 35, 80));
  const index = targetMessageId ? ids.indexOf(targetMessageId) : -1;
  if (index >= 0) offset = Math.floor(index / limit) * limit;
  offset = Math.max(0, Number(offset) || 0);
  return { conversation, paths, path, total: ids.length, offset, nextOffset: offset + limit < ids.length ? offset + limit : null,
    messages: ids.slice(offset, offset + limit).map(key => fullMessage(s, key)),
    snapshots: s.snapshots.filter(snap => snap.conversationId === conversationId).map(({ rawSource, graph, observations, messageVersionIds, ...snap }) => ({ ...snap, graphNodeCount: graph.length })) };
}
export async function search({ projectId, query, offset = 0, limit = 35 }) {
  const s = await readState(), needle = normalizeForSearch(query); if (!needle.trim()) return { results: [], total: 0, nextOffset: null };
  const results = [];
  for (const c of s.conversations.filter(c => c.projectId === projectId)) {
    const qas = s.qas.filter(q => q.conversationId === c.id);
    if (normalizeForSearch(c.title).includes(needle)) results.push({ conversationId: c.id, title: c.title, type: 'title', excerpt: c.title, qaId: qas.find(q => q.pathId === c.currentPathId)?.id ?? qas[0]?.id ?? null, messageId: null });
    for (const m of s.messages.filter(m => m.conversationId === c.id)) {
      const match = findTextMatches(m.text, query, 1)[0]; if (!match) continue;
      const choices = qas.filter(q => q.userMessageId === m.id || q.responseMessageIds.includes(m.id));
      const qa = choices.find(q => q.pathId === c.currentPathId) ?? choices[0];
      results.push({ conversationId: c.id, title: c.title, type: m.role, excerpt: m.text.slice(Math.max(0, match.start - 45), match.end + 115), qaId: qa?.id ?? null, messageId: m.id, pathId: qa?.pathId ?? null });
    }
  }
  offset = Math.max(0, Number(offset) || 0); limit = Math.min(Number(limit) || 35, 80);
  return { results: results.slice(offset, offset + limit), total: results.length, nextOffset: offset + limit < results.length ? offset + limit : null };
}
export async function command(type, args) {
  if (type === 'projects') return listProjects();
  if (type === 'view') return projectView(args.projectId);
  if (type === 'qa') return readQA(args.qaId);
  if (type === 'conversation') return readConversation(args);
  if (type === 'search') return search(args);
  if (type === 'latestDraft') return latestDraft();
  if (type === 'backup') return exportProject(await readState(), args.projectId);
  if (type === 'organizationContext') return getOrganizationContext(await readState(), args);
  if (type === 'organizationSuggestion') return getSuggestion(await readState(), args);
  if (type === 'topicPreview') return previewTopicChange(await readState(), args);
  return mutate(async state => {
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
    if (type === 'deleteProject') {
      const p = state.projects.find(p => p.id === args.projectId); if (!p || p.name !== args.confirmName) fail('项目名确认不一致，未删除数据。');
      for (const name of STORES) {
        if (name === 'projects') state[name] = state[name].filter(r => r.id !== p.id);
        else if (name === 'drafts') state[name] = state[name].filter(d => !d.results.some(r => r.projectId === p.id));
        else state[name] = state[name].filter(r => r.projectId !== p.id);
      } return { deleted: true };
    }
    if (type === 'discardDraft') { state.drafts = state.drafts.filter(d => d.id !== args.draftId); return { discarded: true }; }
    fail('未知的数据操作。');
  });
}
