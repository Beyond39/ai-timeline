import { copy, fail, safeURL } from './common.js';

const unknownTime = () => ({ value: null, precision: 'unknown', source: null });
const keyFor = (conversationId, messageId, versionId) => JSON.stringify([conversationId, messageId, versionId]);

// The document is an ephemeral export snapshot. Chapters and order express the
// user's choices only; no roles, topics, ancestry or missing history are inferred.
export function composeDocument(sources, options = {}) {
  if (typeof sources?.project?.id !== 'string' || !sources.project.id || typeof sources.project.name !== 'string' || !Array.isArray(sources.conversations)) fail('导出来源缺少本地项目或对话。');
  if (options.projectId != null && options.projectId !== sources.project.id) fail('导出设置不属于当前来源项目。');
  const catalog = new Map(), conversationIds = new Set(), messageOwners = new Map(), versionOwners = new Map();
  for (const conversation of sources.conversations) {
    if (typeof conversation?.id !== 'string' || !conversation.id || conversationIds.has(conversation.id) || (conversation.projectId != null && conversation.projectId !== sources.project.id) || typeof conversation.pathId !== 'string' || !conversation.pathId || !Array.isArray(conversation.messages)) fail('导出对话身份、路径或项目归属无效。');
    conversationIds.add(conversation.id);
    for (const message of conversation.messages) {
      if (typeof message?.id !== 'string' || !message.id || typeof message.versionId !== 'string' || !message.versionId || typeof message.text !== 'string' || (message.projectId != null && message.projectId !== sources.project.id) ||
        (message.conversationId != null && message.conversationId !== conversation.id)) fail('导出消息或版本身份无效。');
      if (messageOwners.has(message.id)) fail('导出来源存在重复或跨对话消息身份。');
      if (versionOwners.has(message.versionId)) fail('导出来源的正文版本关联了多条消息。');
      messageOwners.set(message.id, conversation.id);
      versionOwners.set(message.versionId, message.id);
      catalog.set(keyFor(conversation.id, message.id, message.versionId), { conversation, message });
    }
  }
  const includeUserPrompts = options.includeUserPrompts !== false, includeSourceAppendix = options.includeSourceAppendix !== false;
  const inputChapters = options.chapters ?? sources.conversations.map(conversation => ({ title: conversation.title ?? '未命名对话',
    items: conversation.messages.map(message => ({ conversationId: conversation.id, messageId: message.id, versionId: message.versionId })) }));
  if (!Array.isArray(inputChapters) || !inputChapters.length) fail('请添加至少一个导出章节。');
  const seen = new Set(), chapters = inputChapters.map(chapter => {
    if (typeof chapter?.title !== 'string' || !chapter.title.trim() || !Array.isArray(chapter.items)) fail('请为章节填写标题并选择正文。');
    const entries = [];
    for (const ref of chapter.items) {
      if (typeof ref?.conversationId !== 'string' || typeof ref.messageId !== 'string' || typeof ref.versionId !== 'string' ||
        (ref.projectId != null && ref.projectId !== sources.project.id)) fail('章节原文引用无效或属于其他项目。');
      const key = keyFor(ref.conversationId, ref.messageId, ref.versionId), resolved = catalog.get(key);
      if (!resolved) fail('所选消息或版本不在本次来源中，请刷新并重新选择。');
      if (ref.pathId != null && ref.pathId !== resolved.conversation.pathId) fail('章节原文引用不属于所选阅读路径。');
      const { conversation, message } = resolved;
      if (!includeUserPrompts && message.role === 'user' && message.roleUnverified !== true) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ text: message.text, presentation: copy(message.presentation ?? { format: 'plain', source: 'saved', status: 'text_only' }),
        source: {
          conversationId: conversation.id, conversationTitle: conversation.title ?? '未命名对话', sourceUrl: safeURL(conversation.sourceUrl),
          pathId: conversation.pathId, pathLabel: conversation.pathLabel ?? '保存的阅读路径', scopeDescription: conversation.scopeDescription ?? null,
          messageId: message.id, versionId: message.versionId, role: message.role ?? 'unknown', roleUnverified: message.roleUnverified === true, qaCardId: message.qaCardId ?? null,
          confirmedRole: message.confirmedRole ?? null, sourceMessageId: message.sourceMessageId ?? null,
          sourceTime: copy(message.sourceTime ?? unknownTime()), capturedAt: message.capturedAt ?? null
        } });
    }
    return { title: chapter.title.trim(), entries };
  });
  if (!chapters.some(chapter => chapter.entries.length)) fail('当前选择没有可导出的正文，请选择回答或保留问题正文。');
  const title = options.title == null ? `${sources.project.name} · 对话资料` : String(options.title).trim();
  if (!title) fail('请填写资料标题。');
  return { schemaVersion: 1, title, ...(options.subtitle ? { subtitle: String(options.subtitle) } : {}), createdAt: sources.createdAt,
    project: { id: sources.project.id, name: sources.project.name }, includeUserPrompts, includeSourceAppendix, chapters };
}
