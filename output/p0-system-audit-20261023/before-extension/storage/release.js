import { readSnapshot, commit } from './database.js';
import { opcState } from './opc.js';
import { releaseMutation, owned, checkRevision } from '../domain/release-data.js';
import { packMutation, compileContextPack, applyCompilation, contextSourceManifest, packSettings } from '../domain/context-pack.js';
import { copy, fail, id, now } from '../domain/common.js';
import { cardMetadata } from '../domain/card-metadata.js';
import { readingParts } from '../domain/qa-content.js';

export async function releaseInfo(args) {
  const data = await opcState(args.projectId);
  const packs = await readSnapshot([{ store: 'contextPacks', index: 'projectId', key: args.projectId, project: p => ({ id: p.id, title: p.title, mode: p.mode, updatedAt: p.updatedAt, compiledAt: p.compiledAt, revision: p.revision }) }]);
  if (packs.revision !== data.revision) return releaseInfoRetry(args);
  return info(data, packs.contextPacks);
}
async function releaseInfoRetry(args) {
  const data = await opcState(args.projectId), packs = await readSnapshot([{ store: 'contextPacks', index: 'projectId', key: args.projectId, project: p => ({ id: p.id, title: p.title, mode: p.mode, updatedAt: p.updatedAt, compiledAt: p.compiledAt, revision: p.revision }) }]);
  if (packs.revision !== data.revision) fail('资料正在变化，请重新读取。'); return info(data, packs.contextPacks);
}
function info(data, packs) {
  const metadata = new Map(data.qaMetadata.map(m => [m.cardId, m]));
  return { project: data.project, cards: data.qaCards.map(c => ({ id: c.id, title: metadata.get(c.id)?.title || c.questionPreview, sourceTitle: c.sourceTitle, questionTime: c.questionTime, validity: c.validity })),
    packs, tray: data.contextTrays[0] ?? { cardIds: [], revision: 0 }, decisions: data.decisions.filter(r => !r.deleted), issues: data.openIssues.filter(r => !r.deleted), fragments: data.knowledgeFragments.filter(r => !r.deleted), importRecords: data.importRecords.slice().sort((a,b) => b.syncedAt.localeCompare(a.syncedAt)).slice(0,30) };
}
async function packState(args) {
  const light = await opcState(args.projectId), packData = await readSnapshot([{ store: 'contextPacks', mode: 'get', key: args.packId, name: 'pack' }, { store: 'contextPackItems', index: 'packId', key: args.packId }]);
  if (light.revision !== packData.revision) fail('来源正在更新，请重新读取后再保存。');
  if (!packData.pack || packData.pack.projectId !== args.projectId) fail('上下文包不存在。');
  return { ...light, contextPacks: [packData.pack], contextPackItems: packData.contextPackItems };
}
export async function loadPack(args) {
  const data = await packState(args), pack = data.contextPacks[0];
  return { pack, items: data.contextPackItems, sourceChanged: Boolean(pack.compiledAt) && JSON.stringify(pack.sourceVersions) !== JSON.stringify(contextSourceManifest(pack, data)),
    settingsChanged: Boolean(pack.compiledAt) && JSON.stringify(pack.compiledSettings) !== JSON.stringify(packSettings(pack, data.contextPackItems)) };
}
export async function writeRelease(args) {
  let before = args.action === 'pack' && args.packId ? await packState(args) : await opcState(args.projectId), version = null;
  if (args.action === 'fragment' && !args.id) {
    const source = await readSnapshot([{ store: 'versions', mode: 'get', key: args.sourceVersionId, name: 'version' }]);
    if (source.revision !== before.revision || !source.version) fail('摘录来源已变化，请重试。');
    version = { ...source.version, readingText: readingParts([source.version])[0]?.text ?? '' };
  }
  const state = copy(before), result = args.action === 'pack' ? packMutation(state, args) : releaseMutation(state, args.action, args, version);
  await commit(before, state); return result;
}
export async function sourceVersion(args){
  const data=await readSnapshot([{store:'qaCards',mode:'get',key:args.cardId,name:'card'},{store:'versions',mode:'get',key:args.versionId,name:'version'}]);
  if(!data.card||!data.version||!((data.card.projectId===args.projectId || String(args.projectId).startsWith('workspace_') && (await opcState(args.projectId)).workspaceCardIds.includes(data.card.id)) && data.version.projectId===data.card.projectId)||!new Set([data.card.questionVersionId,...Object.values(data.card.answerVersionIds??{})]).has(args.versionId))fail('来源正文版本不属于此卡片的当前有效投影。');
  return {id:data.version.id,text:readingParts([data.version])[0]?.text??'',role:data.version.role};
}
export async function recordImportFailure(args){
  const headers=await readSnapshot([{store:'conversations',project:c=>({id:c.id,projectId:c.projectId,sourceUrl:c.sourceUrl,sourceConversationId:c.sourceConversationId})}]);
  let url;try{url=new URL(args.sourceUrl);}catch{return {logged:false};}if(!['chatgpt.com','chat.openai.com'].includes(url.hostname))return {logged:false};
  const sourceId=url.pathname.match(/\/c\/([\w-]+)/)?.[1],conversation=headers.conversations.find(c=>c.sourceUrl===args.sourceUrl||sourceId&&c.sourceConversationId===sourceId),projectId=conversation?.projectId??args.projectId;if(!projectId)return {logged:false};
  const before=await opcState(projectId),state=copy(before);
  state.importRecords.push({id:id('import'),projectId,conversationId:conversation?.id??null,snapshotId:null,sourceUrl:args.sourceUrl,syncedAt:now(),status:'FAILED',newCardCount:0,updatedCardCount:0,hiddenCardCount:0,skippedMessageCount:0,partial:true,scope:{kind:'failed_read'},warnings:[],errors:[String(args.code??'read_failed')]});
  await commit(before,state);return {logged:true};
}
export async function compilePack(args) {
  const before = await packState(args), pack = before.contextPacks[0]; checkRevision(pack, args.expectedRevision);
  const cards = pack.selectedCardIds.map(key => owned(before, 'qaCards', key, args.projectId));
  const questionHeaders = await readSnapshot([{ store: 'messages', mode: 'keys', keys: cards.filter(c => !c.questionVersionId).map(c => c.userMessageId), project: m => ({ id: m.id, currentVersionId: m.currentVersionId }) }]);
  const questionVersions = new Map(questionHeaders.messages.map(m => [m.id, m.currentVersionId]));
  const keys = [...new Set(cards.flatMap(c => [c.questionVersionId ?? questionVersions.get(c.userMessageId), ...Object.values(c.answerVersionIds ?? {})]).filter(Boolean))];
  const versions = await readSnapshot([{ store: 'versions', mode: 'keys', keys }]);
  if (versions.revision !== before.revision || questionHeaders.revision !== before.revision) fail('来源在编译期间更新，已有包没有被覆盖，请重试。');
  const byVersion = new Map(versions.versions.map(v => [v.id, v])), metadata = new Map(before.qaMetadata.map(m => [m.cardId, m]));
  const sources = cards.map(card => { const q = byVersion.get(card.questionVersionId ?? questionVersions.get(card.userMessageId));
    return { card, metadata: cardMetadata(metadata.get(card.id)), questionBody: readingParts(q ? [q] : [])[0]?.text ?? '',
      answerBody: card.validity.state === 'ACTIVE' ? readingParts(card.visibleAnswerIds.map(k => byVersion.get(card.answerVersionIds[k])).filter(Boolean)).map(v => v.text).join('\n\n') : '' };
  });
  const state = copy(before), result = compileContextPack(pack, before, sources, before.contextPackItems), updated = applyCompilation(state.contextPacks[0], result);
  await commit(before, state); return { pack: updated, sourceChanged: false, settingsChanged: false, items: state.contextPackItems };
}
