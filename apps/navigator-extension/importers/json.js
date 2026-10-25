import { digest, sourceTime, safeURL, now, fail } from '../domain/common.js';
import { structuredText, visibility, contentDiagnostics } from '../domain/qa-content.js';

function presentationInfo(message, markdownDefault) {
  // A presentation hint does not change the raw text or assert exact page formatting.
  const requested = message.presentation?.format ?? message.format ?? message.content_format;
  const markdown = requested === 'markdown' || (!requested && markdownDefault);
  return { format: markdown ? 'markdown' : 'plain', source: 'import', status: 'text_only',
    basis: requested === 'markdown' ? 'explicit_import_format' : markdownDefault && !requested ? 'import_text_markdown_rendering' : 'plain_import_text' };
}
function contentInfo(message, markdownDefault) {
  const presentation = presentationInfo(message, markdownDefault), context = { decodeEntities: presentation.format === 'markdown' };
  const content = message.content;
  const parts = typeof message.text === 'string' ? [message.text] : typeof content === 'string' ? [content] :
    Array.isArray(content?.parts) && content.parts.length ? content.parts : typeof content?.text === 'string' ? [content.text] : typeof content?.content === 'string' ? [content.content] :
    Array.isArray(content?.thoughts) ? content.thoughts.map(thought => [thought.summary, thought.content].filter(value => typeof value === 'string').join('\n')) : [];
  const texts = [], attachments = [];
  for (const part of parts) {
    if (typeof part === 'string') texts.push(structuredText(part, 0, context));
    else if (part && typeof part === 'object') {
      const text = structuredText(part, 0, context) || null;
      if (text !== null) texts.push(text);
      else attachments.push({ type: part.content_type ?? part.type ?? 'unknown', name: part.name ?? part.filename ?? null,
        reference: part.asset_pointer ?? part.url ?? part.file_id ?? null, status: 'reference_only', raw: part });
    }
  }
  for (const a of message.metadata?.attachments ?? message.attachments ?? []) {
    attachments.push({ type: a.mime_type ?? a.type ?? 'attachment', name: a.name ?? a.filename ?? null,
      reference: a.id ?? a.url ?? null, status: 'reference_only', raw: a });
  }
  if (!parts.length && content && typeof content === 'object' && content.content_type && content.content_type !== 'text') {
    attachments.push({ type: content.content_type, name: content.name ?? content.filename ?? null,
      reference: content.asset_pointer ?? content.file_id ?? content.url ?? null, status: 'reference_only', raw: content });
  }
  const text = texts.join('\n');
  const providedText = parts.some(p => typeof p === 'string');
  return { text, presentation: { ...presentation, normalized: true, diagnostics: contentDiagnostics(parts.filter(p => typeof p === 'string').join('\n'), text) }, contentTypes: [typeof content === 'object' ? content?.content_type ?? 'unknown' : 'text'], attachments,
    contentStatus: text ? (attachments.length ? 'text_with_references' : 'available') : !attachments.length && providedText ? 'empty' : 'body_unavailable' };
}
function messageRecord(message, key, position, parentKey, sourceMessageId, identityBasis, markdownDefault = false) {
  const role = String(message.author?.role ?? message.role ?? 'unknown');
  const record = { key, nodeKey: key, sourceMessageId, identityBasis, role, originalRole: role,
    channel: message.channel ?? message.metadata?.channel ?? null, recipient: message.recipient ?? null,
    completion: { status: message.opc_observation?.status ?? message.status ?? null, endTurn: message.opc_observation?.endTurn ?? message.end_turn ?? null, finishType: message.metadata?.finish_details?.type ?? null,
      basis: message.opc_observation?.basis ?? (message.status != null || message.end_turn != null ? 'source_message_fields' : 'unavailable') },
    isAuxiliary: message.metadata?.is_visually_hidden_from_conversation === true || ['user_editable_context', 'model_editable_context'].includes(message.content?.content_type),
    sourceParentKey: parentKey ?? null, relationStatus: parentKey ? 'provided' : 'unknown', position,
    time: sourceTime(message.create_time ?? message.created_at, message.create_time != null ? 'message.create_time' : 'message.created_at'),
    streaming: message.status === 'in_progress' ? 'generating' : ['finished_successfully', 'complete', 'completed'].includes(message.status) ? 'complete' : 'unknown', ...contentInfo(message, markdownDefault), raw: message };
  record.readingVisibility = visibility(record); return record;
}
function graphPaths(nodes, current, warnings) {
  const byKey = new Map(nodes.map(n => [n.key, n]));
  const parents = new Set(nodes.map(n => n.parent).filter(Boolean));
  const leaves = nodes.filter(n => !parents.has(n.key)).map(n => n.key);
  const endpoints = [...new Set([...(current && byKey.has(current) ? [current] : []), ...leaves])];
  const paths = [], covered = new Set();
  for (const end of endpoints) {
    let key = end; const seen = new Set(), chain = []; let complete = true;
    while (key) {
      if (seen.has(key) || !byKey.has(key)) { complete = false; warnings.push('部分节点的父链缺失或存在循环，路径仅按可确认关系保留。'); break; }
      seen.add(key); const node = byKey.get(key); chain.unshift(node); key = node.parent;
    }
    const messageKeys = chain.filter(n => n.messageKey).map(n => n.messageKey);
    messageKeys.forEach(k => covered.add(k));
    if (messageKeys.length) paths.push({ key: `leaf:${end}`, label: end === current ? '导出文件指定的当前路径' : `分支 ${paths.length + 1}`,
      messageKeys, nodeKeys: chain.map(n => n.key), status: complete ? 'reliable_graph' : 'partial_graph', isCurrent: end === current });
  }
  for (const node of nodes) if (node.messageKey && !covered.has(node.messageKey)) {
    paths.push({ key: `orphan:${node.key}`, label: '未连通消息（关系待确认）', messageKeys: [node.messageKey], nodeKeys: [node.key], status: 'unknown', isCurrent: false });
  }
  return paths;
}
function chatGPTConversation(item, index, hash) {
  const warnings = [], messages = [], graph = [];
  for (const [nodeId, node] of Object.entries(item.mapping ?? {})) {
    if (!node || typeof node !== 'object') { warnings.push(`节点 ${nodeId} 无法识别。`); continue; }
    const message = node.message;
    graph.push({ key: nodeId, parent: node.parent == null ? null : String(node.parent), children: (node.children ?? []).map(String), messageKey: message ? nodeId : null });
    if (message && typeof message === 'object') {
      const record = messageRecord(message, nodeId, messages.length, node.parent, message.id ? String(message.id) : null, message.id ? 'export.message.id' : 'export.mapping.node_id', true);
      record.sourceNodeId = nodeId; messages.push(record);
    }
  }
  const current = item.current_node == null ? null : String(item.current_node);
  const paths = graphPaths(graph, current, warnings);
  const hasCurrent = paths.some(p => p.isCurrent);
  if (!hasCurrent) warnings.push('文件没有可恢复的 current_node；当前路径未知，请选择阅读路径。');
  const sid = item.id ?? item.conversation_id;
  return { title: String(item.title ?? `未命名对话 ${index + 1}`), platform: 'openai-chatgpt', sourceConversationId: sid == null ? null : String(sid),
    identityBasis: sid != null ? 'export.conversation.id' : 'identical_file_and_record', fallbackKey: `${hash}:${index}`,
    sourceUrl: safeURL(item.source_url ?? item.url), sourceTime: sourceTime(item.create_time, 'conversation.create_time', 'conversation'),
    nativeProject: item.project_id ? { id: String(item.project_id), name: null, basis: 'export.project_id', status: 'provided' } : { id: null, name: null, basis: null, status: 'unknown' },
    messages, graph, paths, currentPathKey: hasCurrent ? paths.find(p => p.isCurrent).key : null,
    capturedAt: now(), method: 'chatgpt-json-import', scope: { kind: 'export_file', history: 'file_contents_only', branches: 'provided_graph', attachments: 'references_only', description: '导出文件中实际提供的消息与节点；附件文件正文未导入。' },
    warnings: [...new Set(warnings)], raw: item };
}
function genericConversation(item, index, payload, hash) {
  if (!item || !Array.isArray(item.messages)) fail(`第 ${index + 1} 条对话缺少 messages 数组。`);
  const messages = item.messages.map((m, i) => {
    if (!m || typeof m !== 'object') fail(`第 ${index + 1} 条对话第 ${i + 1} 条消息无效。`);
    return messageRecord(m, m.id == null ? `position:${i}` : String(m.id), i, m.parent_id == null ? null : String(m.parent_id), m.id == null ? null : String(m.id), m.id == null ? 'file_order_context' : 'generic.message.id', true);
  });
  if (new Set(messages.map(m => m.key)).size !== messages.length) fail(`第 ${index + 1} 条对话含重复消息 ID，无法安全生成关系。`);
  const warnings = [], hasGraph = messages.some(m => m.sourceParentKey !== null);
  const graph = messages.map(m => ({ key: m.key, messageKey: m.key, parent: m.sourceParentKey, children: [] }));
  const current = item.current_node ?? item.current_message_id;
  const paths = hasGraph ? graphPaths(graph, current == null ? null : String(current), warnings) : [{ key: 'file-order', label: '文件中的消息顺序', messageKeys: messages.map(m => m.key), status: 'provided_order', isCurrent: true }];
  if (hasGraph && !paths.some(p => p.isCurrent)) warnings.push('存在父子关系，但没有可靠的当前路径；请选择分支。');
  if (!hasGraph) warnings.push('按文件给定顺序阅读；父子关系未知，未把前一条消息推测成父消息。');
  return { title: String(item.title ?? `未命名对话 ${index + 1}`), platform: String(payload.provider ?? 'generic-llm'),
    sourceConversationId: item.id == null ? null : String(item.id), identityBasis: item.id == null ? 'identical_file_and_record' : 'generic.conversation.id', fallbackKey: `${hash}:${index}`,
    sourceUrl: safeURL(item.source_url ?? item.url), sourceTime: sourceTime(item.created_at, 'conversation.created_at', 'conversation'),
    nativeProject: payload.project_id ? { id: String(payload.project_id), name: payload.project_title ?? null, basis: 'generic.project_id', status: 'provided' } : { id: null, name: null, basis: null, status: 'unknown' },
    messages, graph: hasGraph ? graph : [], paths, currentPathKey: paths.find(p => p.isCurrent)?.key ?? null,
    capturedAt: now(), method: 'generic-json-import', scope: { kind: 'import_file', history: 'file_contents_only', branches: hasGraph ? 'provided_graph' : 'unknown', attachments: 'references_only', description: '仅包含文件实际提供的消息；无法证明源平台完整历史范围。' }, warnings, raw: item };
}
export async function parseImport(text, filename) {
  let payload; try { payload = JSON.parse(text); } catch (e) { fail(`JSON 解析失败：${e.message}`); }
  if (payload?.format === 'acvn-project-backup') return { kind: 'backup', filename, payload };
  const hash = await digest(text);
  const chatgpt = Array.isArray(payload) || !!payload?.mapping;
  const items = Array.isArray(payload) ? payload : payload?.mapping ? [payload] : payload?.conversations;
  if (!Array.isArray(items) || !items.length) fail('没有识别到对话。支持 ChatGPT conversations.json、包含 conversations 数组的通用 JSON 和项目备份。');
  if (chatgpt && !items.every(item => item && typeof item.mapping === 'object')) fail('ChatGPT 导出数组中存在缺失 mapping 的记录。');
  const conversations = items.map((item, i) => chatgpt ? chatGPTConversation(item, i, hash) : genericConversation(item, i, payload, hash));
  conversations.forEach(c => { c.fileSource = { name: filename, sha256: hash, hashBasis: 'UTF8-decoded-text' }; });
  if (conversations.some(c => new Set(c.messages.map(m => m.sourceMessageId).filter(Boolean)).size !== c.messages.filter(m => m.sourceMessageId).length)) fail('导出中出现重复源消息 ID，请先检查文件。原文件未修改。');
  return { kind: 'conversations', filename, sourceHash: hash, projectHint: payload.project_title ?? null,
    isExample: /demo|example|示例|演示/i.test(filename), conversations, rawText: text };
}
