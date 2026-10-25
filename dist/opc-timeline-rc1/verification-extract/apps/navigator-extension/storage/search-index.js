import { readSnapshot, withReadMetrics } from './database.js';
import { readingParts } from '../domain/qa-content.js';
import { SearchService } from '../domain/search-service.js';

const service = new SearchService();
let revision = -1, pending = Promise.resolve(), fingerprints = new Map();
const displayTitle = c => c.customTitle?.trim() || c.originalTitle || c.title;
const body = row => readingParts(row ? [row] : [])[0]?.text ?? '';
async function synchronize(trace) {
  const current = await readSnapshot([],trace); if (current.revision === revision) return service;
  for (let attempt = 0; attempt < 3; attempt++) {
    const data = await readSnapshot(['projects','conversations','qaCards','qaMetadata','decisions','openIssues'].map(store=>({store})),trace);
    const conversations = new Map(data.conversations.map(c=>[c.id,c])), metadata = new Map(data.qaMetadata.map(m=>[m.cardId,m]));
    const reflected = new Map();
    for (const row of [...data.decisions.filter(r=>r.verifiedByUser===true),...data.openIssues].filter(r=>!r.deleted && (!r.confirmationStatus || r.confirmationStatus === 'USER_CONFIRMED'))) { const texts=reflected.get(row.cardId)??[]; texts.push(row.text??'',row.title??'',row.description??'',row.resolutionNote??'',row.userNote??'');reflected.set(row.cardId,texts); }
    const changed = [], next = new Map();
    for (const card of data.qaCards) {
      const c=conversations.get(card.conversationId); if(!c || c.projectId!==card.projectId || card.validity?.state!=='ACTIVE' || c.hidden || c.archived) continue;
      const rawMetadata=metadata.get(card.id)??{},m={...rawMetadata,title:rawMetadata.title||rawMetadata.autoTitle||'',tags:[...(rawMetadata.tags??[]),...(rawMetadata.autoTags??[])]}, reflection=(reflected.get(card.id)??[]).join('\n');
      const fingerprint=JSON.stringify([card.projectId,card.questionVersionId,card.answerVersionIds,card.visibleAnswerIds,card.userMessageId,card.questionTime,m,c.customTitle,c.originalTitle,c.title,c.description,c.favorite,c.groups,reflection]); next.set(card.id,fingerprint);
      if(fingerprints.get(card.id)!==fingerprint) changed.push({card,c,m,reflection});
    }
    for(const id of service.documents.keys()) if(!next.has(id))service.removeCard(id);
    const bodyChanges=changed.filter(({card})=>service.documents.get(card.id)?.bodyKey!==JSON.stringify([card.questionVersionId,card.answerVersionIds,card.visibleAnswerIds,card.userMessageId]));
    const refs=[...new Set(bodyChanges.flatMap(({card})=>[card.questionVersionId,...Object.values(card.answerVersionIds??{})]).filter(Boolean))];
    const bodies=await readSnapshot([{store:'versions',mode:'keys',keys:refs},{store:'messages',mode:'keys',keys:[...new Set(bodyChanges.flatMap(({card})=>[card.userMessageId,...(card.visibleAnswerIds??[])]))]}],trace);
    const versions=new Map(bodies.versions.map(v=>[v.id,v])), messages=new Map(bodies.messages.map(m=>[m.id,m]));
    for(let i=0;i<changed.length;i++) {
      const {card,c,m,reflection}=changed[i], old=service.documents.get(card.id), sameBodies=old?.bodyKey===JSON.stringify([card.questionVersionId,card.answerVersionIds,card.visibleAnswerIds,card.userMessageId]);
      const questionVersion=versions.get(card.questionVersionId), question=questionVersion??messages.get(card.userMessageId);
      const answers=(card.visibleAnswerIds??[]).map(id=>versions.get(card.answerVersionIds?.[id]));
      const valid=sameBodies || question?.role==='user' && question.conversationId===card.conversationId && answers.length>0 && answers.every((v,j)=>v?.role==='assistant' && v.conversationId===card.conversationId && v.messageId===card.visibleAnswerIds[j]);
      if(!valid){service.removeCard(card.id);next.delete(card.id);continue;}
      service.updateCard({id:card.id,projectId:card.projectId,conversationId:c.id,sourceTitle:displayTitle(c),time:card.questionTime,state:'ACTIVE',locatable:true,hidden:false,groups:c.groups??[],favorite:Boolean(m.favorite),conversationFavorite:Boolean(c.favorite),bodyKey:JSON.stringify([card.questionVersionId,card.answerVersionIds,card.visibleAnswerIds,card.userMessageId]),fields:{title:m.title??'',question:sameBodies?old.fields.question:body(question),answer:sameBodies?old.fields.answer:answers.map(body).join('\n\n'),conversation:[c.originalTitle??c.title,c.customTitle,c.description].filter(Boolean).join('\n'),tags:[m.topic,...(m.tags??[])].filter(Boolean).join(' '),notes:m.notes??'',status:[m.contentType,m.organizationStatus,m.adoptionStatus].filter(Boolean).join(' '),reflection}});
      if(i%25===24)await new Promise(resolve=>setTimeout(resolve,0));
    }
    fingerprints=next;
    if(data.revision===bodies.revision){revision=data.revision;return service;}
  }
  throw new Error('本地资料正在更新，请稍后重试搜索。');
}
export function getSearchIndex(trace=null) { const result=pending.then(()=>synchronize(trace));pending=result.catch(()=>{});return result; }
export async function globalSearch(args) { return withReadMetrics('globalSearch',async trace=>(await getSearchIndex(trace)).search(args)); }
export async function relatedDiscussions(args) { const index=await getSearchIndex(),source=index.documents.get(args.cardId);if(source?.projectId!==args.projectId)return [];return index.findRelated(args.cardId); }
