import { assertStageCoverage, stageCards } from './conversation-analysis.js';
const clone=x=>structuredClone(x);
const protectedFields=row=>Object.entries(row?.protections??{}).filter(([,v])=>v).map(([k])=>k);
const overlap=(a,b,docs)=>{const x=stageCards(a,docs).map(d=>d.cardId),y=new Set(stageCards(b,docs).map(d=>d.cardId));return x.filter(id=>y.has(id)).length/Math.max(1,new Set([...x,...y]).size);};
const evidenceKey=item=>JSON.stringify((item.evidence??[]).map(e=>[e.conversationId,e.messageId,e.versionId,e.start,e.end]).sort());
function preserve(old,next){for(const field of protectedFields(old)){next[field]=clone(old[field]);next.protections??={};next.protections[field]=clone(old.protections[field]);}if(old.humanConfirmed)next.humanConfirmed=true;return next;}
export function mergeProtected(previous,candidate,docs){
  const next=clone(candidate);next.retainedManual=clone(previous?.retainedManual??[]);next.conflicts??=[];
  if(!previous)return next;
  preserve(previous.overview,next.overview);
  // A locked range is an immutable interval. Insert its edges and remove new
  // edges inside it; unlocked intervals keep AI's proposed boundaries.
  const locked=previous.stages.filter(s=>s.protections?.range);
  if(locked.length){
    const positions=new Map(docs.map((d,i)=>[d.cardId,i])),edges=new Set([0,docs.length,...next.stages.map(s=>positions.get(s.startCardId))]);
    for(const old of locked){const a=positions.get(old.startCardId),b=positions.get(old.endCardId);if(a==null||b==null){next.conflicts.push({kind:'stale_locked_range',objectId:old.id});continue;}for(const edge of edges)if(edge>a&&edge<=b)edges.delete(edge);edges.add(a);edges.add(b+1);}
    const sorted=[...edges].filter(Number.isInteger).sort((a,b)=>a-b),proposed=next.stages;
    next.stages=sorted.slice(0,-1).map((a,i)=>{const b=sorted[i+1]-1,range={startCardId:docs[a].cardId,endCardId:docs[b].cardId},matches=proposed.filter(s=>overlap(s,range,docs)>0),base=clone(matches.sort((x,y)=>overlap(y,range,docs)-overlap(x,range,docs))[0]);return {...base,...range,id:'stage:'+docs[a].cardId,evidence:matches.flatMap(s=>s.evidence??[]).filter(e=>docs.slice(a,b+1).some(d=>d.cardId===e.cardId))};});
    for(const item of next.items){const card=item.evidence?.[0]?.cardId,stage=next.stages.find(s=>stageCards(s,docs).some(d=>d.cardId===card));if(stage)item.stageId=stage.id;}
  }
  const retain=(row,kind)=>{if(!next.retainedManual.some(x=>x.kind===kind&&x.object.id===row.id&&JSON.stringify(x.object.protections)===JSON.stringify(row.protections)))next.retainedManual.push({kind,object:clone(row)});next.conflicts.push({kind:'manual_mapping',objectId:row.id});};
  for(const old of previous.stages.filter(s=>protectedFields(s).length)){
    const matches=next.stages.map(s=>({s,score:overlap(old,s,docs)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
    if(!matches.length||matches[0].score<.5||matches.length>1&&matches[0].score-matches[1].score<.2){retain(old,'stage');continue;}
    const target=matches[0].s;preserve(old,target);if(old.protections?.range){target.startCardId=old.startCardId;target.endCardId=old.endCardId;target.protections.range=clone(old.protections.range);}
  }
  for(const old of previous.items.filter(k=>protectedFields(k).length)){
    const matches=next.items.filter(k=>evidenceKey(k)===evidenceKey(old));
    if(matches.length===1)preserve(old,matches[0]);else retain(old,'item');
  }
  assertStageCoverage(next.stages,docs);for(const s of next.stages){const range=stageCards(s,docs);s.cardIds=range.map(d=>d.cardId);s.startMessageId=range[0]?.questionSource?.messageId;s.endMessageId=range.at(-1)?.answerSources?.at(-1)?.messageId??range.at(-1)?.questionSource?.messageId;}if(next.conflicts.length)next.status='needs_review';return next;
}
export function reviseAnalysis(analysis,{kind,objectId,field,value,unlock=false},docs){
  const next=clone(analysis),allowed={overview:['title','summary','themes'],stage:['title','summary','range'],item:['content','status','type']};
  if(!allowed[kind]?.includes(field))throw Error('不支持编辑此字段。');
  const object=kind==='overview'?next.overview:(kind==='stage'?next.stages:next.items).find(x=>x.id===objectId);
  if(!object)throw Error('修改对象已变化，请重新打开。');
  const before=field==='range'?{startCardId:object.startCardId,endCardId:object.endCardId}:clone(object[field]);
  if(unlock)delete object.protections?.[field];
  else {
    if(field==='range'){
      const index=next.stages.indexOf(object),start=docs.findIndex(d=>d.cardId===value.startCardId),end=docs.findIndex(d=>d.cardId===value.endCardId);
      if(start<0||end<start||index===0&&start!==0||index===next.stages.length-1&&end!==docs.length-1)throw Error('范围无效：首尾必须覆盖完整 Conversation。');
      if(index>0){const prev=next.stages[index-1],prevStart=docs.findIndex(d=>d.cardId===prev.startCardId);if(start<=prevStart||prev.protections?.range&&prev.endCardId!==docs[start-1].cardId)throw Error('相邻阶段为空或边界已受人工保护。');prev.endCardId=docs[start-1].cardId;prev.protections??={};prev.protections.range={at:new Date().toISOString()};}
      if(index<next.stages.length-1){const following=next.stages[index+1],last=docs.findIndex(d=>d.cardId===following.endCardId);if(end>=last||following.protections?.range&&following.startCardId!==docs[end+1].cardId)throw Error('相邻阶段为空或边界已受人工保护。');following.startCardId=docs[end+1].cardId;following.protections??={};following.protections.range={at:new Date().toISOString()};}
      Object.assign(object,value);
      for(const item of next.items){const first=item.evidence?.[0]?.cardId,target=next.stages.find(s=>stageCards(s,docs).some(d=>d.cardId===first));if(target)item.stageId=target.id;}
    }else if(field==='themes'){if(!Array.isArray(value)||value.some(v=>typeof v!=='string'||v.length>80)||value.length>30)throw Error('主题格式无效。');object[field]=value;}
    else {if(typeof value!=='string'||value.length>10000||!value.trim())throw Error('内容为空或过长。');if(field==='status'&&!['active','pending','superseded'].includes(value))throw Error('状态无效。');if(field==='type'&&!['user_decision','intention','suggestion','verified_result','hypothesis','open_question','action','conclusion'].includes(value))throw Error('类型无效。');object[field]=value;}
    object.protections??={};object.protections[field]={at:new Date().toISOString()};object.humanConfirmed=true;
  }
  assertStageCoverage(next.stages,docs);
  for(const s of next.stages){s.cardIds=stageCards(s,docs).map(d=>d.cardId);s.startMessageId=stageCards(s,docs)[0]?.questionSource?.messageId;s.endMessageId=stageCards(s,docs).at(-1)?.answerSources?.at(-1)?.messageId;}
  return {analysis:next,revision:{kind,objectId:objectId??'overview',field,before,after:field==='range'?{startCardId:object.startCardId,endCardId:object.endCardId}:clone(object[field]),unlock,at:new Date().toISOString(),analysisVersion:analysis.versionId}};
}
export function analysisDiff(a,b){return {summary:a?.overview.summary!==b?.overview.summary,stages:[a?.stages.length??0,b?.stages.length??0],items:[a?.items.length??0,b?.items.length??0],changedTitles:b?.stages.filter(s=>a?.stages.find(x=>x.id===s.id)?.title!==s.title).map(s=>s.title)??[]};}
