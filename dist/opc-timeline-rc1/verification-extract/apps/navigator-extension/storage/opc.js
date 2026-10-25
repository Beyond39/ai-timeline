import { workspaceScope } from './project-workspace.js';
import { getSearchIndex } from './search-index.js';
import { conversationTitle } from '../domain/conversation-management.js';
import { readSnapshot, withReadMetrics } from './database.js';
import { OPC_CORE_STORES, timelinePage } from '../domain/opc.js';
import { LIGHT_RELEASE_STORES } from '../domain/release-data.js';
import { readingParts, contentDiagnostics } from '../domain/qa-content.js';
import { cardMetadata } from '../domain/card-metadata.js';
import { fail } from '../domain/common.js';
import { consistentRead } from './queries.js';
import { timelineScope } from '../domain/timeline-scope.js';

export async function opcState(projectId, trace = null) {
  if(String(projectId).startsWith('workspace_'))return workspaceScope(projectId,trace);
  const data = await readSnapshot([{ store: 'projects', key: projectId, mode: 'get', name: 'project' },
    ...['conversations', ...OPC_CORE_STORES, ...LIGHT_RELEASE_STORES].map(store => ({ store, index: 'projectId', key: projectId }))], trace);
  if (!data.project) fail('项目不存在。');
  return { ...data, projects: [data.project] };
}
export async function opcPage(args) {
  return withReadMetrics('opcPage', trace => consistentRead(trace, async () => {
    const data = await opcState(args.projectId, trace), revisions = [data.revision];
    let matchedCardIds = null, searchScores = null;
    if(String(args.query??'').trim()){const index=await getSearchIndex();searchScores=new Map(index.search({...args,...(data.workspaceCardIds?{projectId:undefined,cardIds:data.workspaceCardIds}:{}),type:'qa',scoresOnly:true}).results.map(r=>[r.cardId,r.score]));const current=await readSnapshot([]);revisions.push(current.revision);}
    if (searchScores) matchedCardIds = new Set(searchScores.keys());
    const conversations=new Map(data.conversations.map(c=>[c.id,c]));
    data.qaCards=data.qaCards.map(c=>({...c,sourceTitle:conversations.has(c.conversationId)?conversationTitle(conversations.get(c.conversationId)):c.sourceTitle}));
    data.timelines=data.timelines.map(t=>{const c=conversations.get(t.conversationId);return c?{...t,name:conversationTitle(c),hidden:Boolean(t.hidden||c.hidden||c.archived)}:t;});
    return { value: { ...timelinePage(data, { ...args, matchedCardIds, searchScores }), scope:timelineScope(args.projectId,args.conversationId), needsProjection: data.qaCards.some(c => c.projectionVersion !== 3 || !c.questionVersionId) }, revisions };
  }));
}
export async function opcDetail(args) {
  return withReadMetrics('opcDetail', trace => consistentRead(trace, async () => {
    const header = await readSnapshot([{ store: 'qaCards', mode: 'get', key: args.cardId, name: 'card' }], trace);
    const c = header.card; if (!c || c.projectId !== args.projectId && !(String(args.projectId).startsWith('workspace_')&&(await workspaceScope(args.projectId,trace)).workspaceCardIds.includes(c.id))) fail('卡片不存在。');
    const data = await readSnapshot([{store:'conversations',mode:'get',key:c.conversationId,name:'conversation'}, { store: 'messages', mode: 'keys', keys: [c.userMessageId, ...c.visibleAnswerIds] },
      { store: 'qaMetadata', index: 'cardId', key: c.id },
      ...['openIssues', 'decisions', 'knowledgeFragments'].map(store => ({ store, index: 'cardId', key: c.id })),
      { store: 'relationships', index: 'fromCardId', key: c.id, name: 'outgoing' }, { store: 'relationships', index: 'toCardId', key: c.id, name: 'incoming' }], trace);
    const messages = new Map(data.messages.map(m => [m.id, m]));
    const answerVersions = await readSnapshot([{ store: 'versions', mode: 'keys', keys: [...(c.questionVersionId ? [c.questionVersionId] : []), ...Object.values(c.answerVersionIds ?? {})] }], trace);
    const versionMap = new Map(answerVersions.versions.map(v => [v.id, v]));
    const currentQuestion = messages.get(c.userMessageId), questionVersion = versionMap.get(c.questionVersionId);
    const question = currentQuestion && questionVersion ? { ...currentQuestion, ...questionVersion, id: currentQuestion.id } : currentQuestion, answers = c.validity?.state === 'ACTIVE' ? readingParts(c.visibleAnswerIds.map(k => {
      const m = messages.get(k), v = versionMap.get(c.answerVersionIds?.[k]);
      return m && v ? { ...m, ...v, id: m.id, sourceMessageId: m.sourceMessageId } : m;
    }).filter(m => m?.role === 'assistant')) : [];
    const relationships = [...new Map([...data.outgoing, ...data.incoming].filter(r => r.projectId === args.projectId).map(r => [r.id, r])).values()];
    const related = await readSnapshot([{ store: 'qaCards', mode: 'keys', keys: relationships.map(r => r.fromCardId === c.id ? r.toCardId : r.fromCardId), name: 'relatedCards' }], trace);
    return { value: { card: { ...c, sourceTitle: data.conversation ? conversationTitle(data.conversation) : c.sourceTitle }, metadata: cardMetadata(data.qaMetadata.find(m => m.cardId === c.id)), question,
      questionBody: readingParts(question ? [question] : [])[0]?.text ?? '',
      answers, answerBody: answers.map(m => m.text).join('\n\n'), diagnostics: [...contentDiagnostics(questionVersion?.text??question?.text??'',readingParts(question?[question]:[])[0]?.text??''),...answers.flatMap(m => [...(m.presentation?.diagnostics ?? []),...contentDiagnostics(versionMap.get(c.answerVersionIds?.[m.id])?.text ?? m.text, m.text)])], relationships, relatedCards: related.relatedCards.map(r => ({ id: r.id, questionPreview: r.questionPreview, sourceTitle: r.sourceTitle, validity: r.validity })),
      reflection: { issues: data.openIssues.filter(r => !r.deleted), decisions: data.decisions.filter(r => !r.deleted), fragments: data.knowledgeFragments.filter(r => !r.deleted) },
      rawMessageIds: [c.userMessageId, ...c.responseMessageIds] }, revisions: [header.revision, data.revision, answerVersions.revision, related.revision] };
  }));
}
export async function opcRaw(args) {
  const detail = await opcDetail(args);
  const raw = await readSnapshot([{ store: 'messages', mode: 'keys', keys: detail.rawMessageIds }]);
  const all = await readSnapshot([{ store: 'versions', mode: 'keys', keys: raw.messages.map(m => m.currentVersionId) }]);
  return { messages: raw.messages, rawVersions: all.versions };
}
