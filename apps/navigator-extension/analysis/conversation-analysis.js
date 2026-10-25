import { buildTfidf, keywords, sparseCosine, normalize } from './knowledge-text.js';

export const CONVERSATION_ENGINE='adaptive-hybrid-1';
export const PROMPT_VERSION='conversation-evidence-1';
export const ITEM_TYPES=['user_decision','intention','suggestion','verified_result','hypothesis','open_question','action','conclusion'];
export const decisionSignal=t=>/(?:我(?:决定|选择|选用|选|确认|采用)|最终(?:决定|选择|采用)|确定(?:用|选择)|就用|改用|决定使用|I (?:choose|decided|confirm)|let.s use)/iu.test(t)&&!/(?:如果|假如|假设|比如|例如|觉得|应该|可能|是否|要不要|不确定|尚未决定)/u.test(t);
const verifiedSignal=t=>/(?:测试(?:全部)?通过|验证(?:通过|完成|成功)|已(?:经)?(?:修复|解决|完成)|确认.*(?:正常|成功)|works now|tests? pass)/iu.test(t)&&!/(?:如果|假如|假设|例如|比如|应该|可能|计划|预计|希望|尚未|还没|没有|并未|未完成|未通过|尚未|似乎)/u.test(t);
const tentative=t=>/(?:觉得|应该|可能|假设|也许|似乎|probably|might|hypothesis)/iu.test(t);
export function orderedDocuments(documents) {
  if(!Array.isArray(documents)||!documents.length)throw Error('当前 Conversation 没有可分析的有效 Q/A。');
  const docs=documents.filter(d=>d&&typeof d.cardId==='string'&&typeof d.question==='string'&&typeof d.conversationId==='string');
  if(docs.length!==documents.length||new Set(docs.map(d=>d.cardId)).size!==docs.length||new Set(docs.map(d=>d.conversationId)).size!==1||new Set(docs.map(d=>d.sourceProjectId)).size!==1)throw Error('Conversation 分析来源无效或跨项目。');
  if(docs.some(d=>!Number.isInteger(d.ordinal)||d.ordinal<1)||new Set(docs.map(d=>d.ordinal)).size!==docs.length)throw Error('原始 Q/A 顺序不明确，请重新导入可靠的阅读路径。');
  return [...docs].sort((a,b)=>a.ordinal-b.ordinal);
}
export function messageSources(documents) {
  return documents.flatMap(d=>[d.questionSource,...(d.answerSources??[])].filter(s=>s&&typeof s.text==='string').map(s=>({...s,role:s===d.questionSource?'user':'assistant',cardId:d.cardId,conversationId:d.conversationId})));
}
export function evidenceFor(source,start=0,end=source.text.length) {
  return {conversationId:source.conversationId,messageId:source.messageId,versionId:source.versionId,cardId:source.cardId,role:source.role,start,end,quote:source.text.slice(start,end),valid:true};
}
export function validateEvidence(ref,documents,allowedCardIds=null) {
  const source=messageSources(documents).find(s=>s.messageId===ref?.messageId&&s.versionId===ref?.versionId&&s.conversationId===ref?.conversationId&&s.cardId===ref?.cardId&&s.role===ref?.role);
  const valid=Boolean(source&&(!allowedCardIds||allowedCardIds.includes(source.cardId))&&Number.isInteger(ref.start)&&Number.isInteger(ref.end)&&ref.start>=0&&ref.end>ref.start&&ref.end<=source.text.length&&typeof ref.quote==='string'&&source.text.slice(ref.start,ref.end)===ref.quote);
  return {...ref,valid};
}
function evidenceContext(ref,docs){const s=messageSources(docs).find(s=>s.messageId===ref.messageId&&s.versionId===ref.versionId&&s.cardId===ref.cardId);if(!s)return '';const before=s.text.slice(0,ref.start),after=s.text.slice(ref.end);return before.slice(Math.max(before.lastIndexOf('。'),before.lastIndexOf('\n'),before.lastIndexOf('!'))+1)+ref.quote+after.split(/[。\n!?！？]/u)[0];}
export function assertStageCoverage(stages,documents) {
  const ids=documents.map(d=>d.cardId);let next=0;
  if(!stages.length)throw Error('阶段不能为空。');
  for(const stage of stages){const start=ids.indexOf(stage.startCardId),end=ids.indexOf(stage.endCardId);if(start!==next||end<start)throw Error('阶段必须连续、按原始顺序覆盖每个 Q/A，不能重叠或遗漏。');next=end+1;}
  if(next!==ids.length)throw Error('阶段没有覆盖完整 Conversation。');
  return true;
}
export function stageCards(stage,docs){const a=docs.findIndex(d=>d.cardId===stage.startCardId),b=docs.findIndex(d=>d.cardId===stage.endCardId);return a<0||b<a?[]:docs.slice(a,b+1);}
function intent(text){
  if(decisionSignal(text))return 'decision';
  if(verifiedSignal(text))return 'verification';
  if(/(?:仍然|还是|依然).*(?:报错|失败|不行)|not working/iu.test(text))return 'diagnosis';
  if(/(?:尝试|修复|修改|改成|解决方案|实施|patch|fix)/iu.test(text))return 'repair';
  if(/(?:原因|分析|为什么|排查|定位|复现|diagnos|root cause)/iu.test(text))return 'diagnosis';
  return 'exploration';
}
export function segmentConversation(documents) {
  const docs=orderedDocuments(documents),{vectors}=buildTfidf(docs),keywordRows=docs.map((d,i)=>keywords(d,vectors[i],7)),features=keywordRows.map(rows=>rows.slice(0,6).map(x=>x.term.toLowerCase())),boundaries=[],diagnostics=[];let start=0,stageReason='continuation',stageSignals=null,stageTerms=new Set(features[0]);
  for(let i=1;i<docs.length;i++){
    const left=docs.slice(Math.max(start,i-2),i),right=docs.slice(i,Math.min(docs.length,i+2));
    let sim=0;for(let a=i-left.length;a<i;a++)for(let b=i;b<i+right.length;b++)sim+=sparseCosine(vectors[a],vectors[b]);sim/=left.length*right.length;
    const previous=intent(docs[i-1].question),current=intent(docs[i].question),q=docs[i].question;
    const explicitTopic=/(?:换个(?:话题|问题)|另一个(?:话题|问题)|现在(?:讨论|学习)|接下来(?:学习|讨论)|另外[，,：:]|switch (?:topic|to)|new topic)/iu.test(q);
    const explicitProgress=/(?:现在|接下来|已经|仍然|还是|确认|验证|最终|决定|改用|不行|测试通过|原因找到|定位到了|I choose|tests pass)/iu.test(q);
    const previousTerms=stageTerms,novel=features[i].length?features[i].filter(t=>![...previousTerms].some(p=>p.includes(t)||t.includes(p))).length/features[i].length:0;
    const shortImportant=current==='decision'||current==='verification';
    const progressShift=(previous!==current&&current!=='exploration'&&(explicitProgress||i-start>=2)||current==='decision'&&/(?:最终|改用|改为|instead)/iu.test(q))&&!/^\s*(?:继续|展开|详细|再解释|举例)/u.test(q);
    const nextCoherent=i+1<docs.length&&sparseCosine(vectors[i],vectors[i+1])>.17;
    const shared=[...vectors[i].keys()].filter(t=>vectors[i-1].has(t)),anchoredContinuity=shared.some(t=>/^[a-z][\w+#.-]*$/iu.test(t))&&shared.some(t=>/^[\p{Script=Han}]{2,}$/u.test(t));
    const topicShift=!anchoredContinuity&&sim<.22&&novel>=.65&&features[i].length>0&&(i-start>=2||nextCoherent)&&!/^(?:那|所以|继续|为什么|也就是|这样|这个|如果|还是)/u.test(q);
    const score=(1-sim)*.35+novel*.2+(explicitTopic?.5:0)+(progressShift?.45:0);
    const cut=explicitTopic||(progressShift&&(shortImportant||i-start>=2))||(topicShift&&score>.45);
    diagnostics.push({beforeCardId:docs[i].cardId,similarity:+sim.toFixed(4),novelty:+novel.toFixed(4),previousIntent:previous,intent:current,explicitTopic,progressShift,score:+score.toFixed(4),accepted:cut});
    if(cut){boundaries.push({start,end:i-1,reason:stageReason,signals:stageSignals});start=i;stageReason=explicitTopic||topicShift&&!progressShift?'topic_shift':'progress_shift';stageSignals=diagnostics.at(-1);stageTerms=new Set(features[i]);}else for(const term of features[i])stageTerms.add(term);
  }
  boundaries.push({start,end:docs.length-1,reason:boundaries.length?stageReason:'single_stage',signals:stageSignals});
  return {docs,boundaries,diagnostics,features,vectors,keywordRows};
}
function sentences(source){
  const result=[];for(const m of source.text.matchAll(/[^\n。！？!?]+[。！？!?]?/gu)){const leading=m[0].length-m[0].trimStart().length,text=m[0].trim();if(text.length>=3&&!/^\s*(?:```|~~~|[|#])/u.test(text))result.push({text,start:m.index+leading,end:m.index+leading+text.length});}return result;
}
function offlineItems(docs,stages){
  const items=[],stageByCard=new Map(stages.flatMap(s=>stageCards(s,docs).map(d=>[d.cardId,s])));
  for(const source of messageSources(docs))for(const sentence of sentences(source)){
    const t=sentence.text;let type=null,status='active';
    if(source.role==='user'&&decisionSignal(t))type='user_decision';
    else if(source.role==='user'&&verifiedSignal(t))type='verified_result';
    else if(source.role==='assistant'&&/(?:建议|推荐|可以考虑|recommend|suggest)/iu.test(t))type='suggestion';
    else if(/(?:仍未|尚未|未解决|还没|待验证|不确定|仍然.*(?:失败|报错)|unresolved)/iu.test(t))type='open_question';
    else if(tentative(t)){type='hypothesis';status='pending';}
    else if(source.role==='user'&&/(?:我想|打算|希望|计划|准备|intend|plan to)/iu.test(t))type='intention';
    else if(/(?:下一步|待办|后续需要|TODO|next step)/iu.test(t))type='action';
    else if(source.role==='assistant'&&/(?:结论|因此|所以|总之)/u.test(t)){type='conclusion';status='pending';}
    if(!type)continue;
    const stage=stageByCard.get(source.cardId);
    items.push({id:'item:'+source.messageId+':'+sentence.start,type,content:t,status,stageId:stage.id,evidence:[evidenceFor(source,sentence.start,sentence.end)],origin:'offline',reviewStatus:status==='pending'?'needs_review':'source_attested',protections:{}});
  }
  return supersedeDecisions(items);
}
export function supersedeDecisions(items){
  const decisions=items.filter(x=>x.type==='user_decision'&&x.status!=='superseded');
  for(let i=0;i<decisions.length;i++)for(let j=i+1;j<decisions.length;j++){
    const old=decisions[i],next=decisions[j];
    const chosen=old.content.match(/(?:选择|选用|采用|就用|改用|使用|choose)\s*([A-Za-z][\w.+-]*)/iu)?.[1];
    const explicit=chosen&&new RegExp('(?:不用|放弃|不再使用|替代|instead of)\\s*'+chosen.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&'),'iu').test(next.content);
    const sameChoice=/改用|改为|instead/iu.test(next.content)&&chosen&&/(?:模型|model|方案|High|Medium|Low|GPT)/iu.test(old.content+next.content)&&/(?:模型|model|方案|High|Medium|Low|GPT)/iu.test(next.content);
    if(explicit||sameChoice){old.status='superseded';old.supersededBy=next.id;break;}
  }
  return items;
}
export function analyzeConversation(documents){
  const {docs,boundaries,diagnostics,keywordRows}=segmentConversation(documents),keywordsById=new Map(docs.map((d,i)=>[d.cardId,keywordRows[i]]));
  const terms=new Map();keywordRows.forEach(rows=>rows.forEach(k=>{const key=k.term.toLowerCase(),old=terms.get(key);terms.set(key,{term:k.term,score:(old?.score??0)+k.score,evidence:[...(old?.evidence??[]),k.source]});}));
  const themes=[];for(const t of [...terms.values()].sort((a,b)=>b.score-a.score))if(!themes.some(x=>x.term.toLowerCase().includes(t.term.toLowerCase())||t.term.toLowerCase().includes(x.term.toLowerCase()))){themes.push(t);if(themes.length===8)break;}
  const stages=boundaries.map(b=>{
    const range=docs.slice(b.start,b.end+1),first=range[0],last=range.at(-1),stageTerms=[...new Set(range.flatMap(d=>keywordsById.get(d.cardId).slice(0,3).map(x=>x.term)))].slice(0,3);
    const sources=messageSources([first,last]),evidence=sources.filter(s=>s.text.trim()).map(s=>evidenceFor(s,0,Math.min(s.text.length,220)));
    return {id:'stage:'+first.cardId,startCardId:first.cardId,endCardId:last.cardId,startMessageId:first.questionSource?.messageId,endMessageId:last.answerSources?.at(-1)?.messageId??last.questionSource?.messageId,title:stageTerms.join(' · ').slice(0,80)||'讨论记录',summary:range.length===1?normalize(first.question).slice(0,220):`从“${normalize(first.question).slice(0,90)}”推进到“${normalize(last.question).slice(0,90)}”。`,coreQuestion:first.question.slice(0,500),reason:b.reason,boundarySignals:b.signals,evidence,protections:{}};
  });
  assertStageCoverage(stages,docs);const items=offlineItems(docs,stages),decisions=items.filter(x=>x.type==='user_decision'&&x.status!=='superseded'),verified=items.filter(x=>x.type==='verified_result');
  const summary=`围绕${themes.slice(0,3).map(t=>t.term).join('、')||'原始问题'}展开 ${docs.length} 轮讨论，共 ${stages.length} 个候选阶段。`+(decisions.length?` 用户明确决定：${decisions.at(-1).content}`:'')+(verified.length?` 用户报告验证结果：${verified.at(-1).content}`:'');
  return {schemaVersion:1,projectId:docs[0].sourceProjectId,conversationId:docs[0].conversationId,mode:'offline',engineVersion:CONVERSATION_ENGINE,promptVersion:PROMPT_VERSION,status:'completed',overview:{title:themes.slice(0,2).map(t=>t.term).join(' · ')||docs[0].sourceMetadata?.title||'对话记录',summary,themes:themes.map(t=>t.term),themeEvidence:themes,evidence:[...decisions,...verified].flatMap(x=>x.evidence),protections:{}},stages,items,diagnostics,conflicts:[]};
}
export function validateAIAnalysis(raw,documents){
  const docs=orderedDocuments(documents);
  if(!raw||!raw.overview||typeof raw.overview.title!=='string'||typeof raw.overview.summary!=='string'||!Array.isArray(raw.overview.themes)||!raw.overview.themes.every(t=>typeof t==='string')||!Array.isArray(raw.stages)||!raw.stages.length)throw Error('AI 返回结构无效。');
  const issues=[];const refs=(evidence,ids)=>{if(!Array.isArray(evidence))throw Error('证据结构无效。');return evidence.map(e=>validateEvidence(e,docs,ids));};
  const items=[];
  const stages=raw.stages.map((s,i)=>{
    if(typeof s.title!=='string'||typeof s.summary!=='string'||!Array.isArray(s.items))throw Error('AI 阶段结构无效。');
    const stage={id:'stage:'+s.startCardId,startCardId:s.startCardId,endCardId:s.endCardId,title:s.title.slice(0,160),summary:s.summary.slice(0,5000),reason:s.reason,coreQuestion:s.coreQuestion??'',protections:{}};
    const range=stageCards(stage,docs),ids=range.map(d=>d.cardId);stage.evidence=refs(s.evidence,ids);stage.reviewStatus=stage.evidence.length&&stage.evidence.every(e=>e.valid)?'needs_review':'invalid_evidence';
    stage.startMessageId=range[0]?.questionSource?.messageId;stage.endMessageId=range.at(-1)?.answerSources?.at(-1)?.messageId??range.at(-1)?.questionSource?.messageId;
    for(const [j,k] of s.items.entries()){
      if(!ITEM_TYPES.includes(k.type)||typeof k.content!=='string')throw Error('AI 知识条目类型无效。');
      const evidence=refs(k.evidence,ids),valid=evidence.length>0&&evidence.every(e=>e.valid);let type=k.type,status=['active','pending','superseded'].includes(k.status)?k.status:'pending';
      const user=evidence.filter(e=>e.valid&&e.role==='user');
      if(type==='user_decision'&&(!valid||!user.some(e=>decisionSignal(evidenceContext(e,docs))))){type=evidence.some(e=>e.role==='assistant')?'suggestion':'intention';status='pending';}
      if(type==='verified_result'&&(!valid||!user.some(e=>verifiedSignal(evidenceContext(e,docs))))){type='hypothesis';status='pending';}
      if(!valid){status='pending';issues.push({kind:'invalid_evidence',stageId:stage.id,itemId:'ai:'+i+':'+j});}
      items.push({id:'ai:'+i+':'+j,type,content:k.content.slice(0,6000),status,stageId:stage.id,evidence,origin:'openai',reviewStatus:valid?'needs_review':'invalid_evidence',protections:{}});
    }
    if(stage.reviewStatus==='invalid_evidence')issues.push({kind:'stage_evidence',stageId:stage.id});return stage;
  });
  assertStageCoverage(stages,docs);
  const evidence=refs(raw.overview.evidence,docs.map(d=>d.cardId));
  if(!evidence.length||evidence.some(e=>!e.valid))issues.push({kind:'overview_evidence'});
  return {schemaVersion:1,projectId:docs[0].sourceProjectId,conversationId:docs[0].conversationId,mode:'ai',engineVersion:CONVERSATION_ENGINE,promptVersion:PROMPT_VERSION,status:issues.length?'needs_review':'completed',overview:{title:raw.overview.title.slice(0,160),summary:raw.overview.summary.slice(0,10000),themes:raw.overview.themes.slice(0,20),evidence,reviewStatus:'needs_review',protections:{}},stages,items:supersedeDecisions(items),conflicts:issues,diagnostics:[]};
}
