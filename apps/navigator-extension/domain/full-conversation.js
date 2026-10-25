import { parseImport } from '../importers/json.js';
import { EXTENSION_VERSION } from './common.js';

export const DATA_ADAPTER_VERSION = 'chatgpt-data-v1';
export async function normalizeConversationData(result) {
  if (!result?.ok || !result.conversation?.mapping) throw new Error('没有取得完整结构化对话。');
  const bundle = await parseImport(JSON.stringify(result.conversation), 'conversation-record.json');
  const conversation = bundle.conversations[0]; delete conversation.fileSource;
  if (!conversation.currentPathKey || conversation.paths.some(path => path.status !== 'reliable_graph')) throw new Error('对话分支关系不完整。');
  const counts = { messages: conversation.messages.length, reliableSourceIds: conversation.messages.length, unknownSourceIds: 0,
    generating: conversation.messages.filter(row => row.streaming === 'generating').length, bodyUnavailable: conversation.messages.filter(row => row.contentStatus === 'body_unavailable').length,
    attachments: conversation.messages.reduce((sum, row) => sum + row.attachments.length, 0), referenceOnly: 0, structuredMessages: 0, roles: {} };
  counts.referenceOnly = counts.attachments;
  counts.structuredMessages = conversation.messages.filter(message => message.text && message.presentation.format === 'markdown').length;
  for (const message of conversation.messages) { message.roleUnverified = false; counts.roles[message.role] = (counts.roles[message.role] ?? 0) + 1; }
  for (const path of conversation.paths) path.label = path.isCurrent ? '当前对话分支 · 全部消息' : `其他分支 ${conversation.paths.filter(row => !row.isCurrent).indexOf(path) + 1}`;
  const coverage = { kind: 'complete_graph', fullHistory: 'provided', observedMessages: counts.messages, branches: 'provided_graph',
    description: '已读取该 Conversation 本次返回的全部消息记录和分支，不依赖页面滚动。附件保留引用。' };
  const notices = [{ code: 'full_conversation', reason: coverage.description }];
  if (counts.generating) notices.push({ code: 'generating' });
  if (counts.bodyUnavailable) notices.push({ code: 'body_unavailable' });
  if (counts.attachments) notices.push({ code: 'reference_only' });
  const diagnostics = { extensionVersion: EXTENSION_VERSION, adapterVersion: DATA_ADAPTER_VERSION,
    pageType: /\/g\//.test(result.sourceUrl) ? 'project_conversation' : 'conversation', status: 'recognized', captureMode: 'structured_conversation', counts,
    capabilities: { text: counts.bodyUnavailable ? 'partial' : 'available', structure: 'provided', messageIdentity: 'source_ids', parents: 'provided',
      nativeProject: conversation.nativeProject.status, sourceTime: conversation.messages.some(row => row.time.value) ? 'provided' : 'unknown', history: 'provided', branches: 'provided_graph', attachmentBodies: 'unavailable' },
    coverage, errors: [], notices };
  Object.assign(conversation, { sourceUrl: result.sourceUrl, method: DATA_ADAPTER_VERSION, adapterVersion: DATA_ADAPTER_VERSION, diagnostics,
    scope: { kind: 'conversation_record', captureMode: 'structured_conversation', history: 'provided', branches: 'provided_graph', attachments: 'references_only', coverage,
      observedMessageCount: counts.messages, description: coverage.description }, warnings: counts.attachments ? ['图片、文件等附件保留来源引用，附件文件本体未下载。'] : [] });
  return conversation;
}
