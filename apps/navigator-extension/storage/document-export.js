import { readSnapshot, withReadMetrics } from './database.js';
import { indexed, keyed, record, consistentRead } from './queries.js';
import { copy, fail, now, safeURL } from '../domain/common.js';
import { getDocumentPrint, listDocumentRecipes, materializeDocumentRecipe } from '../domain/document-recipes.js';

const unknownTime = () => ({ value: null, precision: 'unknown', source: null });
const owns = (row, projectId, conversationId = null) => row && row.projectId === projectId && (conversationId == null || row.conversationId === conversationId);
function ids(value, label) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.some(key => typeof key !== 'string' || !key) || new Set(value).size !== value.length) fail(`${label}必须是有效且不重复的 ID 列表。`);
  return value;
}
function mapRows(rows, label) {
  const result = new Map();
  for (const row of rows ?? []) {
    if (!row?.id || result.has(row.id)) fail(`${label}存在无效或重复记录。`);
    result.set(row.id, row);
  }
  return result;
}
function owned(row, projectId, conversationId, label) {
  if (!owns(row, projectId, conversationId)) fail(`${label}不存在、已移动或不属于当前项目／对话，请重新打开导出。`);
  return row;
}
function pathMembers(path) {
  const members = ids(path.messageIds, '阅读路径消息');
  if (!members) fail('阅读路径缺少消息成员，未导出。');
  return members;
}

// This planner operates on project-scoped navigation records, never a flattened
// set of branch messages. Exporting a selected alternate path must be explicit.
export function planDocumentSelection(records, args) {
  const { projectId } = args ?? {};
  if (!projectId || records.project?.id !== projectId) fail('请先选择有效的本地项目。');
  const conversationIds = ids(args.conversationIds, '对话选择');
  const qaIds = ids(args.qaIds, '问答选择'), segmentIds = ids(args.segmentIds, '片段选择');
  const limited = qaIds != null || segmentIds != null;
  const conversations = mapRows(records.conversations, '对话'), paths = mapRows(records.paths, '阅读路径');
  const qas = mapRows(records.qas, '问答'), segments = mapRows(records.segments, '片段');
  for (const [name, rows] of Object.entries({ conversations: records.conversations, paths: records.paths, qas: records.qas, segments: records.segments, topics: records.topics })) {
    if ((rows ?? []).some(row => row.projectId !== projectId)) fail(`导出导航 ${name} 含跨项目记录，未导出。`);
  }
  const selectedQAs = new Map();
  for (const key of qaIds ?? []) selectedQAs.set(key, owned(qas.get(key), projectId, null, '所选问答'));
  for (const key of segmentIds ?? []) {
    const segment = owned(segments.get(key), projectId, null, '所选片段');
    if (!segment.active) fail('所选片段已被替换，请重新选择当前片段。');
    const memberIds = ids(segment.qaIds, '片段问答成员');
    if (!memberIds?.length) fail('所选片段没有有效问答成员。');
    for (const qaId of memberIds) {
      const qa = owned(qas.get(qaId), projectId, segment.conversationId, '片段引用的问答');
      if (qa.pathId !== segment.pathId) fail('片段引用了另一条阅读路径，未导出。');
      selectedQAs.set(qa.id, qa);
    }
  }
  const derivedConversations = new Set([...selectedQAs.values()].map(row => row.conversationId));
  const requested = conversationIds ?? (limited ? [...derivedConversations] : [...conversations.keys()]);
  if (!requested.length || (limited && !selectedQAs.size)) fail('请选择至少一条对话、问答或片段。');
  const allowed = new Set(requested);
  if ([...derivedConversations].some(key => !allowed.has(key))) fail('所选问答／片段不属于本次选择的对话。');
  const selection = args.pathSelections ?? {};
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) fail('阅读路径选择无效。');
  for (const [conversationId, pathId] of Object.entries(selection)) {
    if (!allowed.has(conversationId) || typeof pathId !== 'string' || !pathId) fail('阅读路径选择不属于本次导出对话。');
  }
  const rows = [];
  for (const conversationId of requested) {
    const conversation = owned(conversations.get(conversationId), projectId, null, '所选对话');
    const candidates = [...paths.values()].filter(row => row.conversationId === conversation.id);
    const selectedId = selection[conversation.id] ?? conversation.currentPathId ?? (records.qaCards == null && candidates.length === 1 ? candidates[0].id : null);
    if (!selectedId) fail(`对话“${conversation.title ?? ''}”的阅读路径未确认，请先选择路径。`);
    const path = owned(paths.get(selectedId), projectId, conversation.id, '所选阅读路径');
    const orderedMessageIds = records.qaCards == null ? pathMembers(path) : path.lastCapturedMessageIds ?? pathMembers(path), memberSet = new Set(orderedMessageIds);
    const selectedMessages = new Set();
    for (const qa of selectedQAs.values()) {
      if (qa.conversationId !== conversation.id) continue;
      if (qa.pathId !== path.id) fail('所选问答不在当前阅读路径；请先明确选择该分支再导出。');
      const responses = ids(qa.responseMessageIds, '问答回答成员');
      if (typeof qa.userMessageId !== 'string' || !responses || responses.includes(qa.userMessageId)) fail('问答原文成员无效。');
      for (const key of [qa.userMessageId, ...responses]) {
        if (!memberSet.has(key)) fail('问答原文成员不在所属阅读路径，未导出。');
        selectedMessages.add(key);
      }
    }
    let messageIds = limited ? orderedMessageIds.filter(key => selectedMessages.has(key)) : orderedMessageIds;
    if (records.qaCards != null) {
      const readable = new Set(records.qaCards.filter(c => c.conversationId === conversation.id && c.pathId === conversation.currentPathId && path.id === conversation.currentPathId && c.validity?.state === 'ACTIVE').flatMap(c => [c.userMessageId, ...c.visibleAnswerIds]));
      messageIds = messageIds.filter(key => readable.has(key));
    }
    if (limited && !messageIds.length) continue;
    rows.push({ conversation, path, messageIds });
  }
  if (!rows.length || !rows.some(row => row.messageIds.length)) fail('当前选择没有可导出的正文。');
  return { projectId, rows };
}

// Shared by the real IndexedDB loader and deterministic source-contract tests.
// Version bodies are immutable; mismatched cached message bodies are rejected.
export function assembleDocumentSources(records, args, { createdAt = now(), revision = null } = {}) {
  const plan = planDocumentSelection(records, args), messages = mapRows(records.messages, '消息'), versions = mapRows(records.versions, '正文版本');
  const qas = mapRows(records.qas, '问答'), topics = mapRows(records.topics, '主题');
  const conversations = plan.rows.map(({ conversation, path, messageIds }) => {
    const tagsByMessage = new Map();
    for (const segment of records.segments ?? []) {
      if (!segment.active || segment.conversationId !== conversation.id || segment.pathId !== path.id) continue;
      const names = (segment.topicIds ?? []).map(key => {
        const topic = owned(topics.get(key), plan.projectId, null, '已保存主题');
        return topic.name;
      }).filter(name => typeof name === 'string' && name.trim());
      for (const qaId of segment.qaIds ?? []) {
        const qa = owned(qas.get(qaId), plan.projectId, conversation.id, '主题片段引用的问答');
        if (qa.pathId !== path.id) fail('主题片段引用了另一条路径，未导出。');
        for (const messageId of [qa.userMessageId, ...(qa.responseMessageIds ?? [])]) {
          const prior = tagsByMessage.get(messageId) ?? new Set(); names.forEach(name => prior.add(name)); tagsByMessage.set(messageId, prior);
        }
      }
    }
    return {
      id: conversation.id, title: conversation.title ?? '未命名对话', sourceUrl: safeURL(conversation.sourceUrl),
      pathId: path.id, pathLabel: path.label ?? '保存的阅读路径',
      scopeDescription: path.scope?.description ?? conversation.lastScope?.description ?? '仅导出所选保存路径；未取得的历史、分支与附件正文不在本次范围。',
      sourceTime: copy(conversation.sourceTime ?? unknownTime()), capturedAt: conversation.lastCapturedAt ?? null,
      messages: messageIds.map(key => {
        const message = owned(messages.get(key), plan.projectId, conversation.id, '阅读路径中的消息');
        if (!message.currentVersionId || (Array.isArray(message.versionIds) && !message.versionIds.includes(message.currentVersionId))) fail('消息当前版本关联不一致，未导出。');
        const version = owned(versions.get(message.currentVersionId), plan.projectId, conversation.id, '消息当前正文版本');
        if (version.messageId !== message.id || typeof version.text !== 'string' || message.text !== version.text || message.role !== version.role ||
          (message.bodyHash && version.bodyHash && message.bodyHash !== version.bodyHash) || JSON.stringify(message.presentation ?? null) !== JSON.stringify(version.presentation ?? null)) fail('消息正文与当前不可变版本不一致，请刷新后重试。');
        return {
          id: message.id, versionId: version.id, role: version.role ?? 'unknown', roleUnverified: message.roleUnverified === true,
          qaCardId: records.qaCards?.find(c => c.userMessageId === message.id || c.visibleAnswerIds.includes(message.id))?.id ?? null,
          confirmedRole: message.confirmedRole ?? null, text: version.text,
          presentation: copy(version.presentation ?? { format: 'plain', source: 'saved', status: 'text_only' }),
          sourceMessageId: message.sourceMessageId ?? null, sourceTime: copy(message.time ?? unknownTime()),
          capturedAt: version.capturedAt ?? null, topicNames: [...(tagsByMessage.get(message.id) ?? [])]
        };
      })
    };
  });
  return { project: { id: records.project.id, name: records.project.name }, createdAt, snapshotRevision: revision, conversations };
}

export async function loadDocumentSources(args) {
  if (!args?.projectId) fail('请先选择本地项目。');
  return withReadMetrics('documentSources', trace => consistentRead(trace, async () => {
    // All navigation is loaded by project index. User-supplied IDs never trigger
    // primary-key reads of another project's conversation or body records.
    const navigation = await readSnapshot([
      record('projects', args.projectId, 'project'),
      ...['conversations', 'paths', 'qas', 'segments', 'topics', 'qaCards'].map(store => indexed(store, 'projectId', args.projectId))
    ], trace);
    const plan = planDocumentSelection(navigation, args), messageIds = plan.rows.flatMap(row => row.messageIds);
    const bodies = await readSnapshot([keyed('messages', messageIds, row => {
      owned(row, args.projectId, null, '消息正文'); return row;
    })], trace);
    // A changed revision invalidates the entire attempt before validation; retry
    // with fresh ownership/path/version records instead of joining old and new.
    if (navigation.revision !== bodies.revision) return { value: null, revisions: [navigation.revision, bodies.revision] };
    const versions = await readSnapshot([keyed('versions', bodies.messages.map(row => row.currentVersionId).filter(Boolean), row => {
      owned(row, args.projectId, null, '不可变正文版本'); return row;
    })], trace);
    if (versions.revision !== navigation.revision) return { value: null, revisions: [navigation.revision, bodies.revision, versions.revision] };
    return { value: assembleDocumentSources({ ...navigation, messages: bodies.messages, versions: versions.versions }, args, { revision: navigation.revision }),
      revisions: [navigation.revision, bodies.revision, versions.revision] };
  }));
}

export async function loadDocumentRecipeList(args) {
  if (!args?.projectId) fail('请先选择本地项目。');
  return withReadMetrics('documentRecipeList', trace => consistentRead(trace, async () => {
    const records = await readSnapshot([record('projects', args.projectId, 'project'), indexed('documentRecipes', 'projectId', args.projectId)], trace);
    return { value: listDocumentRecipes({ projects: records.project ? [records.project] : [], documentRecipes: records.documentRecipes }, args), revisions: [records.revision] };
  }));
}

// Recipe references intentionally select immutable historical versions. The
// current-source loader above stays strict about latest bodies for new exports.
export async function loadDocumentRecipe(args) {
  if (!args?.projectId || !args.recipeId) fail('请先选择有效的资料包方案。');
  return withReadMetrics('documentRecipeGet', trace => consistentRead(trace, async () => {
    const navigation = await readSnapshot([record('projects', args.projectId, 'project'), record('documentRecipes', args.recipeId, 'recipe'),
      ...['conversations', 'paths', 'qaCards'].map(store => indexed(store, 'projectId', args.projectId))], trace);
    const recipe = navigation.recipe;
    if (!navigation.project || !recipe || recipe.projectId !== args.projectId) fail('资料包方案不存在或不属于当前项目。');
    const refs = recipe.chapters.flatMap(chapter => chapter.items);
    const sources = await readSnapshot([
      keyed('messages', refs.map(ref => ref.messageId), row => { owned(row, args.projectId, null, '方案消息'); const { id, projectId, conversationId, versionIds, sourceMessageId } = row; return { id, projectId, conversationId, versionIds, sourceMessageId }; }),
      keyed('versions', refs.map(ref => ref.versionId), row => { owned(row, args.projectId, null, '方案不可变正文版本'); return row; })
    ], trace);
    if (navigation.revision !== sources.revision) return { value: null, revisions: [navigation.revision, sources.revision] };
    return { value: { recipe: copy(recipe), sources: materializeDocumentRecipe({ projects: [navigation.project], conversations: navigation.conversations, paths: navigation.paths, qaCards: navigation.qaCards, messages: sources.messages, versions: sources.versions }, recipe, { revision: navigation.revision }) }, revisions: [navigation.revision, sources.revision] };
  }));
}

export async function loadDocumentPrint(args) {
  if (!args?.snapshotId) fail('缺少打印快照标识。');
  return withReadMetrics('documentPrintGet', trace => consistentRead(trace, async () => {
    const loaded = await readSnapshot([record('documentPrints', args.snapshotId, 'snapshot')], trace);
    if (!loaded.snapshot || (args.projectId != null && loaded.snapshot.projectId !== args.projectId)) fail('打印快照不存在或不属于指定项目。');
    const project = await readSnapshot([record('projects', loaded.snapshot.projectId, 'project')], trace);
    if (loaded.revision !== project.revision) return { value: null, revisions: [loaded.revision, project.revision] };
    return { value: getDocumentPrint({ projects: project.project ? [project.project] : [], documentPrints: [loaded.snapshot] }, args), revisions: [loaded.revision, project.revision] };
  }));
}
