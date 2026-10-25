import { opcState } from './opc.js';
import { getSearchIndex } from './search-index.js';
import { commit, readSnapshot } from './database.js';
import { cardMetadata } from '../domain/card-metadata.js';
import { suggestTags, reviewSuggestion, featureSourceKey, FEATURE_VERSION } from '../domain/tag-suggestions.js';
import { checkRevision } from '../domain/release-data.js';
import { copy, digest, fail, id, now } from '../domain/common.js';

export async function analyzeQA(args){
  const initial=await readSnapshot([]),index=await getSearchIndex(),before=await opcState(args.projectId),state=copy(before);
  if(initial.revision!==before.revision)fail('资料在分析期间变化，请重新运行本地分析。');
  const metadata=new Map(state.qaMetadata.map(m=>[m.cardId,m]));
  const cards=state.qaCards.filter(c=>c.validity?.state==='ACTIVE'&&index.documents.has(c.id)).sort((a,b)=>a.id.localeCompare(b.id));
  const rows=cards.map(c=>{const m=metadata.get(c.id)??{},doc=index.documents.get(c.id);return {id:c.id,conversationId:c.conversationId,sourceKey:featureSourceKey(c),question:doc.fields.question,answer:doc.fields.answer,title:m.title??'',tags:[m.topic,...(m.tags??[])].filter(Boolean)};});
  const corpusKey=await digest(rows),suggestions=suggestTags(rows),selected=args.cardIds?new Set(args.cardIds):new Set(cards.map(c=>c.id));
  if([...selected].some(key=>!cards.some(c=>c.id===key)))fail('所选卡片不在当前有效项目中。');
  let generated=0,cached=0;
  for(let i=0;i<cards.length;i++){
    const c=cards[i];if(!selected.has(c.id))continue;
    let m=metadata.get(c.id),old=m?.localSuggestion;
    if(old?.version===FEATURE_VERSION&&old.sourceKey===rows[i].sourceKey&&old.corpusKey===corpusKey){cached++;continue;}
    if(!m){m={...cardMetadata(),id:id('annotation'),cardId:c.id,projectId:c.projectId,createdAt:now()};state.qaMetadata.push(m);}
    m.localSuggestion={...suggestions[i],corpusKey,generatedAt:now()};m.revision=(m.revision??0)+1;m.updatedAt=now();generated++;
  }
  if(generated)await commit(before,state);
  return {generated,cached,total:selected.size,version:FEATURE_VERSION,method:'local-tfidf-ngram'};
}
export async function reviewQA(args){
  const before=await opcState(args.projectId),state=copy(before),card=state.qaCards.find(c=>c.id===args.cardId&&c.validity?.state==='ACTIVE');
  if(!card)fail('卡片不存在或不在当前项目。');
  const m=state.qaMetadata.find(m=>m.cardId===card.id);if(!m)fail('请先执行本地分析。');
  checkRevision(m,args.expectedRevision);
  const result=reviewSuggestion(m,{...args,sourceKey:featureSourceKey(card)});
  await commit(before,state);return result;
}
