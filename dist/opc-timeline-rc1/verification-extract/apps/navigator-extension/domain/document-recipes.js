import { copy, fail, id, now, safeURL } from './common.js';
import { composeDocument } from './document-export.js';

const formats = new Set(['docx', 'pdf', 'md', 'html']);
const roles = new Set(['unknown', 'user', 'assistant', 'tool']);
const key = ref => JSON.stringify([ref?.conversationId, ref?.pathId, ref?.messageId, ref?.versionId]);
const required = (value, label) => { if (typeof value !== 'string' || !value.trim()) fail(`请填写有效的${label}。`); return value.trim(); };
const unknownTime = () => ({ value: null, precision: 'unknown', source: null });
function projectFor(state, projectId) { const project = state.projects?.find(row => row.id === projectId); if (!project) fail('资料包所属本地项目不存在。'); return project; }
function storedRecipe(state, projectId, recipeId) {
  projectFor(state, projectId);
  const recipe = state.documentRecipes?.find(row => row.id === recipeId && row.projectId === projectId);
  if (!recipe) fail('资料包方案不存在或不属于当前项目。'); return recipe;
}
function expectedRecipe(recipe, expectedRevision) { if (!Number.isInteger(expectedRevision) || expectedRevision !== recipe.revision) fail('资料包方案已在其他页面更新，请重新打开后再保存。'); }
function resolveRef(state, projectId, ref) {
  if (!ref || ['conversationId', 'pathId', 'messageId', 'versionId'].some(field => typeof ref[field] !== 'string' || !ref[field])) fail('资料包缺少确切的对话、路径、消息或正文版本引用。');
  if (ref.projectId != null && ref.projectId !== projectId) fail('正文引用不属于当前本地项目。');
  const conversation = state.conversations?.find(row => row.id === ref.conversationId && row.projectId === projectId);
  const path = state.paths?.find(row => row.id === ref.pathId && row.projectId === projectId && row.conversationId === ref.conversationId);
  const message = state.messages?.find(row => row.id === ref.messageId && row.projectId === projectId && row.conversationId === ref.conversationId);
  const version = state.versions?.find(row => row.id === ref.versionId && row.projectId === projectId && row.conversationId === ref.conversationId && row.messageId === ref.messageId);
  if (!conversation || !path || !message || !version || !Array.isArray(path.messageIds) || !path.messageIds.includes(message.id) || !Array.isArray(message.versionIds) || !message.versionIds.includes(version.id)) fail('方案引用的正文已删除、移动或不属于所选路径；已保存方案仍保留，请重新选择来源。');
  if (typeof version.text !== 'string' || typeof version.role !== 'string') fail('方案引用的不可变正文版本无效。');
  return { conversation, path, message, version };
}
function canonicalRef(state, projectId, ref, previous = null) {
  const { conversation, path, message, version } = resolveRef(state, projectId, ref);
  // Metadata is derived from saved records, never from caller-supplied bodies.
  // Reopening/copying a recipe retains its existing annotation/time snapshot.
  const prior = previous && key(previous) === key(ref) ? previous : null;
  const pending = version.role === 'unknown';
  const annotation = prior ? prior.confirmedRole ?? null : message.confirmedRole ?? null;
  const canonical = {
    conversationId: conversation.id, pathId: path.id, messageId: message.id, versionId: version.id,
    role: version.role, roleUnverified: pending || (!prior && message.currentVersionId === version.id && message.roleUnverified === true) || prior?.roleUnverified === true,
    confirmedRole: pending && roles.has(annotation) ? annotation : null,
    sourceTime: copy(prior?.sourceTime ?? message.time ?? unknownTime()), capturedAt: version.capturedAt ?? null,
    conversationTitle: prior?.conversationTitle ?? conversation.title ?? '未命名对话', sourceUrl: safeURL(prior ? prior.sourceUrl : conversation.sourceUrl),
    pathLabel: prior?.pathLabel ?? path.label ?? '保存的阅读路径', scopeDescription: prior?.scopeDescription ?? path.scope?.description ?? conversation.lastScope?.description ?? '仅包含方案选定的已保存正文；未取得的历史、分支与附件正文不在本次范围。'
  };
  if ((Object.hasOwn(ref, 'role') && ref.role !== canonical.role) || (Object.hasOwn(ref, 'confirmedRole') && (ref.confirmedRole ?? null) !== canonical.confirmedRole) ||
    (Object.hasOwn(ref, 'roleUnverified') && canonical.role !== 'unknown' && ref.roleUnverified !== canonical.roleUnverified) ||
    (ref.sourceTime != null && JSON.stringify(ref.sourceTime) !== JSON.stringify(canonical.sourceTime))) fail('正文的角色、阅读标注或来源时间已变化，请重新读取来源或打开已存方案。');
  return canonical;
}

// These domain operations change only the supplied in-memory state. IndexedDB,
// Chrome storage, tabs and rendering are owned by their respective adapters.
export function normalizeDocumentSelection(state, { projectId, selection, sourceRecipeId = null, sourceRevision = null }) {
  projectFor(state, projectId);
  if (!selection || !Array.isArray(selection.chapters) || !selection.chapters.length) fail('资料包需要至少一个章节。');
  let prior = null;
  if (sourceRecipeId) { prior = storedRecipe(state, projectId, sourceRecipeId); if (sourceRevision != null) expectedRecipe(prior, sourceRevision); }
  const priorRefs = new Map((prior?.chapters ?? []).flatMap(chapter => chapter.items.map(ref => [key(ref), ref]))), used = new Set(), messagesUsed = new Set(), chapterIds = new Set(), pathByConversation = new Map();
  let total = 0;
  const chapters = selection.chapters.map((chapter, index) => {
    const chapterId = chapter.id == null ? `chapter-${index}` : required(chapter.id, '章节标识');
    if (chapterIds.has(chapterId)) fail('章节标识重复，请重新设置资料包。'); chapterIds.add(chapterId);
    if (!Array.isArray(chapter.items)) fail('章节选择必须是正文引用列表。');
    const items = chapter.items.map(ref => {
      const item = canonicalRef(state, projectId, ref, priorRefs.get(key(ref))), identity = key(item);
      if (used.has(identity)) fail('同一正文版本被重复放入多个位置，请保留一个位置。'); used.add(identity);
      if (messagesUsed.has(item.messageId)) fail('同一消息的多个版本需要分别建立资料包，不能混为一份正文。'); messagesUsed.add(item.messageId);
      if (pathByConversation.has(item.conversationId) && pathByConversation.get(item.conversationId) !== item.pathId) fail('同一对话的不同分支需要分别建立资料包，不能合并为单一阅读顺序。');
      pathByConversation.set(item.conversationId, item.pathId); total++; return item;
    });
    return { id: chapterId, title: required(chapter.title, '章节标题'), items };
  });
  if (!total) fail('请为资料包选择至少一段正文。');
  const format = selection.format ?? 'docx'; if (!formats.has(format)) fail('资料包文件格式无效。');
  return { title: required(selection.title, '资料标题'), ...(selection.subtitle ? { subtitle: String(selection.subtitle) } : {}),
    includeUserPrompts: selection.includeUserPrompts !== false, includeSourceAppendix: selection.includeSourceAppendix !== false, format, chapters };
}
function summary(recipe) { return { id: recipe.id, projectId: recipe.projectId, name: recipe.name, title: recipe.title, revision: recipe.revision, status: recipe.status,
  createdAt: recipe.createdAt, updatedAt: recipe.updatedAt, chapterCount: recipe.chapters.length, entryCount: recipe.chapters.reduce((sum, chapter) => sum + chapter.items.length, 0), format: recipe.format }; }
export function listDocumentRecipes(state, { projectId, includeArchived = false }) {
  projectFor(state, projectId);
  return (state.documentRecipes ?? []).filter(row => row.projectId === projectId && (includeArchived || row.status !== 'archived')).slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.id.localeCompare(b.id)).map(summary);
}
export function getDocumentRecipe(state, { projectId, recipeId }) { return copy(storedRecipe(state, projectId, recipeId)); }
export function saveDocumentRecipe(state, { projectId, recipeId = null, expectedRevision = null, sourceRecipeId = recipeId, sourceRevision = null, name, selection }, { timestamp = now(), newId = null } = {}) {
  const existing = recipeId ? storedRecipe(state, projectId, recipeId) : null;
  if (existing) { expectedRecipe(existing, expectedRevision); if (existing.status === 'archived') fail('方案已归档，请另存为新方案。'); }
  const chosen = normalizeDocumentSelection(state, { projectId, selection, sourceRecipeId, sourceRevision: sourceRevision ?? (sourceRecipeId === recipeId ? expectedRevision : null) });
  const record = { ...chosen, id: existing?.id ?? newId ?? id('documentRecipe'), projectId, name: required(name ?? chosen.title, '方案名称'),
    revision: (existing?.revision ?? 0) + 1, status: 'active', createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp };
  if (!existing && state.documentRecipes?.some(row => row.id === record.id)) fail('资料包方案标识已存在。');
  state.documentRecipes ??= [];
  if (existing) state.documentRecipes[state.documentRecipes.indexOf(existing)] = record; else state.documentRecipes.push(record);
  return copy(record);
}
export function renameDocumentRecipe(state, { projectId, recipeId, expectedRevision, name }, { timestamp = now() } = {}) {
  const recipe = storedRecipe(state, projectId, recipeId); expectedRecipe(recipe, expectedRevision);
  recipe.name = required(name, '方案名称'); recipe.revision++; recipe.updatedAt = timestamp; return copy(recipe);
}
export function archiveDocumentRecipe(state, { projectId, recipeId, expectedRevision, archived = true }, { timestamp = now() } = {}) {
  const recipe = storedRecipe(state, projectId, recipeId); expectedRecipe(recipe, expectedRevision);
  recipe.status = archived ? 'archived' : 'active'; recipe.revision++; recipe.updatedAt = timestamp; return copy(recipe);
}

export function materializeDocumentRecipe(state, recipe, { createdAt = now(), revision = null } = {}) {
  const project = projectFor(state, recipe.projectId), grouped = new Map();
  for (const chapter of recipe.chapters) for (const ref of chapter.items) {
    const { conversation, path, version } = resolveRef(state, project.id, ref);
    if (ref.role != null && ref.role !== version.role) fail('方案角色与不可变版本不一致。');
    let group = grouped.get(conversation.id);
    if (!group) {
      group = { id: conversation.id, projectId: project.id, title: ref.conversationTitle ?? conversation.title ?? '未命名对话', sourceUrl: safeURL(Object.hasOwn(ref, 'sourceUrl') ? ref.sourceUrl : conversation.sourceUrl),
        pathId: path.id, pathLabel: ref.pathLabel ?? path.label ?? '保存的阅读路径', scopeDescription: ref.scopeDescription ?? path.scope?.description ?? conversation.lastScope?.description ?? '已保存阅读路径', messages: [] };
      grouped.set(conversation.id, group);
    } else if (group.pathId !== path.id) fail('方案包含同一对话的多条分支，未合并导出。');
    const qaCard = state.qaCards?.find(c => c.conversationId === conversation.id && c.pathId === path.id && c.validity?.state === 'ACTIVE' && (c.userMessageId === ref.messageId || c.answerVersionIds?.[ref.messageId] === version.id));
    group.messages.push({ id: ref.messageId, projectId: project.id, conversationId: conversation.id, versionId: version.id, role: version.role, qaCardId: qaCard?.id ?? null,
      roleUnverified: ref.roleUnverified === true || version.role === 'unknown', confirmedRole: roles.has(ref.confirmedRole) ? ref.confirmedRole : null,
      text: version.text, presentation: copy(version.presentation ?? { format: 'plain', source: 'saved', status: 'text_only' }), sourceMessageId: state.messages.find(row => row.id === ref.messageId)?.sourceMessageId ?? null,
      sourceTime: copy(ref.sourceTime ?? unknownTime()), capturedAt: version.capturedAt ?? null, topicNames: [] });
  }
  return { project: { id: project.id, name: project.name }, createdAt, snapshotRevision: revision, conversations: [...grouped.values()] };
}
export function documentRecipeSpecification(state, recipe, options = {}) {
  return composeDocument(materializeDocumentRecipe(state, recipe, options), { projectId: recipe.projectId, title: recipe.title, subtitle: recipe.subtitle,
    includeUserPrompts: recipe.includeUserPrompts, includeSourceAppendix: recipe.includeSourceAppendix, chapters: recipe.chapters.map(chapter => ({ title: chapter.title, items: chapter.items })) });
}
export function createDocumentPrint(state, { projectId, selection, recipeId = null, expectedRevision = null }, { timestamp = now(), newId = null } = {}) {
  const chosen = normalizeDocumentSelection(state, { projectId, selection, sourceRecipeId: recipeId, sourceRevision: expectedRevision });
  const document = documentRecipeSpecification(state, { ...chosen, projectId }, { createdAt: timestamp, revision: state.revision ?? null });
  const snapshot = { id: newId ?? id('documentPrint'), projectId, createdAt: timestamp, document };
  if (state.documentPrints?.some(row => row.id === snapshot.id)) fail('打印快照标识已存在。'); state.documentPrints ??= []; state.documentPrints.push(snapshot); return { id: snapshot.id, projectId, createdAt: timestamp };
}
export function getDocumentPrint(state, { snapshotId, projectId = null }) {
  const snapshot = state.documentPrints?.find(row => row.id === snapshotId && (projectId == null || row.projectId === projectId));
  if (!snapshot) fail('打印快照不存在或已随项目删除，请重新打开资料包生成。'); projectFor(state, snapshot.projectId); return copy(snapshot);
}
