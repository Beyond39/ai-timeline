import { readSnapshot, withReadMetrics } from './database.js';
import { record, indexed, keyed, consistentRead } from './queries.js';
import { buildConversationOutline } from '../domain/conversation-outline.js';
import { short, fail } from '../domain/common.js';

export function loadConversationOutline(args) {
  return withReadMetrics('conversationOutline', trace => consistentRead(trace, async () => {
    const navigation = await readSnapshot([record('conversations', args.conversationId, 'conversation'), indexed('paths', 'conversationId', args.conversationId),
      indexed('qas', 'conversationId', args.conversationId)], trace);
    if (!navigation.conversation || navigation.conversation.projectId !== args.projectId) fail('Conversation 不属于当前本地项目。');
    const selectedPathId = args.pathId ?? navigation.conversation.currentPathId ?? (navigation.paths.length === 1 ? navigation.paths[0].id : null);
    const path = navigation.paths.find(row => row.id === selectedPathId);
    if (!path) fail('请先选择有效阅读路径。');
    const messageIds = [...new Set(navigation.paths.flatMap(row => row.messageIds ?? []))];
    const source = await readSnapshot([keyed('messages', messageIds, row => ({ id: row.id, projectId: row.projectId, conversationId: row.conversationId,
      role: row.role, roleUnverified: row.roleUnverified, isAuxiliary: row.isAuxiliary, confirmedRole: row.confirmedRole, currentVersionId: row.currentVersionId,
      time: row.time, parentMessageId: row.parentMessageId, sourceMessageId: row.sourceMessageId,
      textPreview: short(row.text ?? '', 180), textLength: row.text?.length ?? 0, streaming: row.streaming, contentStatus: row.contentStatus }))], trace);
    return { value: buildConversationOutline({ ...navigation, messages: source.messages }, args), revisions: [navigation.revision, source.revision] };
  }));
}
