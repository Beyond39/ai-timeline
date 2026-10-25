import { opcState } from './opc.js';
import { getSearchIndex } from './search-index.js';
import { readSnapshot } from './database.js';
import { digest } from '../domain/common.js';
import { PREPROCESSING_VERSION } from '../analysis/knowledge-text.js';

export async function knowledgeDocuments({ projectId }) {
  const index=await getSearchIndex(), scope=await opcState(projectId);
  const metadata=new Map(scope.qaMetadata.map(m=>[m.cardId,m]));
  const conversations=new Map(scope.conversations.filter(c=>!c.hidden&&!c.archived).map(c=>[c.id,c]));
  const cards=scope.qaCards.filter(c=>c.validity?.state==='ACTIVE'&&!c.hidden&&!c.archived&&!metadata.get(c.id)?.hidden&&conversations.has(c.conversationId)&&index.documents.has(c.id)).sort((a,b)=>a.id.localeCompare(b.id));
  const snapshot=await readSnapshot([{store:'versions',mode:'keys',keys:[...new Set(cards.flatMap(c=>[c.questionVersionId,...Object.values(c.answerVersionIds??{})]).filter(Boolean))]}]);
  if(scope.revision!==snapshot.revision)throw new Error('分析来源正在变化，请重新运行。');
  const versions=new Map(snapshot.versions.map(v=>[v.id,v]));
  const documents=[];
  for(const card of cards) {
    const m=metadata.get(card.id)??{},c=conversations.get(card.conversationId),indexed=index.documents.get(card.id);
    const answerSources=(card.visibleAnswerIds??[]).map(messageId=>({messageId,versionId:card.answerVersionIds?.[messageId],text:versions.get(card.answerVersionIds?.[messageId])?.text})).filter(s=>typeof s.text==='string');
    const question=versions.get(card.questionVersionId)?.text??indexed.fields.question;
    const doc={cardId:card.id,conversationId:card.conversationId,sourceProjectId:card.projectId,scopeId:projectId,ordinal:card.ordinal,questionSource:{messageId:card.userMessageId,versionId:card.questionVersionId,role:'user',text:question},question,answer:answerSources.map(s=>s.text).join('\n\n'),answerSources:answerSources.map(s=>({...s,role:'assistant'})),customTitle:m.title??'',manualTags:m.tags??[],sourceMetadata:{title:c.customTitle||c.originalTitle||c.title||card.sourceTitle,questionVersionId:card.questionVersionId,answerVersionIds:card.answerVersionIds},preprocessingVersion:PREPROCESSING_VERSION};
    if(typeof doc.question!=='string')doc.question='';if(typeof doc.customTitle!=='string')doc.customTitle='';doc.manualTags=Array.isArray(doc.manualTags)?doc.manualTags.filter(t=>typeof t==='string'):[];
    const {scopeId,...source}=doc;doc.sourceHash=await digest(source);documents.push(doc);
  }
  return {projectId,projectName:scope.project?.name??scope.projects?.[0]?.name??'当前 Project',revision:scope.revision,documents,corpusHash:await digest(documents.map(d=>[d.cardId,d.sourceHash]))};
}
