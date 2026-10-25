import { mergeProtected, reviseAnalysis } from '../analysis/analysis-revisions.js';
export const analysisKey=(projectId,conversationId)=>JSON.stringify([projectId,conversationId]);
let connection;
function database(){
  if(!connection)connection=new Promise((resolve,reject)=>{const req=indexedDB.open('opc-conversation-analyses-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('records',{keyPath:'id'});req.onsuccess=()=>{req.result.onversionchange=()=>{req.result.close();connection=null;};resolve(req.result);};req.onerror=()=>{connection=null;reject(req.error);};});return connection;
}
export async function loadAnalysis(projectId,conversationId){const db=await database();return new Promise((resolve,reject)=>{const req=db.transaction('records').objectStore('records').get(analysisKey(projectId,conversationId));req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(req.error);});}
async function update(projectId,conversationId,fn){
  const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite'),store=tx.objectStore('records'),req=store.get(analysisKey(projectId,conversationId));let result,error;
    req.onsuccess=()=>{try{const old=req.result??{id:analysisKey(projectId,conversationId),projectId,conversationId,revision:0,versions:[],revisions:[]};result=fn(structuredClone(old));result.revision=old.revision+1;store.put(result);}catch(e){error=e;tx.abort();}};
    tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(error??tx.error??Error('分析保存失败，已有版本保留。'));
  });
}
export async function saveAnalysis(candidate,docs,{baseVersionId=null}={}){
  return update(candidate.projectId,candidate.conversationId,row=>{
    if((row.current?.versionId??null)!==baseVersionId)throw Error('已有更新的分析完成，请重新打开；新旧版本均未被覆盖。');
    if(row.current&&row.current.sourceHash!==candidate.sourceHash){candidate=structuredClone(candidate);candidate.conflicts??=[];candidate.conflicts.push({kind:'source_changed',message:'来源变化，历史证据请重新核对。'});}
    const next=mergeProtected(row.current,candidate,docs);for(const s of next.stages){const a=docs.findIndex(d=>d.cardId===s.startCardId),b=docs.findIndex(d=>d.cardId===s.endCardId);s.cardIds=docs.slice(a,b+1).map(d=>d.cardId);}next.versionId=crypto.randomUUID();next.createdAt=new Date().toISOString();
    row.versions.push(structuredClone(next));row.current=next;if(next.run){row.runs??=[];const key=next.run.requestId??next.versionId,rowRun={...next.run,id:key,versionId:next.versionId};const index=row.runs.findIndex(r=>r.id===key);if(index<0)row.runs.push(rowRun);else row.runs[index]=rowRun;}return row;
  });
}
export async function journalAnalysisRun(projectId,conversationId,run){return update(projectId,conversationId,row=>{row.runs??=[];const index=row.runs.findIndex(r=>r.id===run.id);if(index<0)row.runs.push(structuredClone(run));else row.runs[index]={...row.runs[index],...structuredClone(run)};return row;});}
export async function editAnalysis(projectId,conversationId,expectedRevision,change,docs){return update(projectId,conversationId,row=>{if(row.revision!==expectedRevision||!row.current)throw Error('人工编辑已有更新，请重新打开。');const {analysis,revision}=reviseAnalysis(row.current,change,docs);row.current=analysis;row.revisions.push(revision);return row;});}
export async function restoreAnalysis(projectId,conversationId,expectedRevision,versionId,docs,sourceHash){
  return update(projectId,conversationId,row=>{if(row.revision!==expectedRevision)throw Error('版本已变化，请重新打开。');const old=row.versions.find(v=>v.versionId===versionId);if(!old)throw Error('历史版本不存在。');if(old.sourceHash!==sourceHash)throw Error('历史版本与当前原文不同，不能覆盖；可导出旧版本核对。');const before=row.current?.versionId,next=mergeProtected(row.current,old,docs);next.versionId=crypto.randomUUID();next.createdAt=new Date().toISOString();next.restoredFrom=versionId;row.versions.push(structuredClone(next));row.current=next;row.revisions.push({kind:'restore',before,after:next.versionId,at:next.createdAt});return row;});
}
// Portable, separate knowledge archive. Source backups remain byte-compatible.
export async function exportAnalyses(){const db=await database();return new Promise((resolve,reject)=>{const r=db.transaction('records').objectStore('records').getAll();r.onsuccess=()=>resolve({format:'opc-conversation-analyses',version:1,exportedAt:new Date().toISOString(),records:r.result});r.onerror=()=>reject(r.error);});}
export async function importAnalyses(payload){
  if(payload?.format!=='opc-conversation-analyses'||payload.version!==1||!Array.isArray(payload.records))throw Error('知识备份格式无效。');
  const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');let error,count=0;
    try{for(const incoming of payload.records){if(typeof incoming.projectId!=='string'||typeof incoming.conversationId!=='string'||incoming.id!==analysisKey(incoming.projectId,incoming.conversationId)||!Array.isArray(incoming.versions)||!Array.isArray(incoming.revisions)||!incoming.current)throw Error('知识备份记录无效。');const r=store.get(incoming.id);r.onsuccess=()=>{if(r.result){const merged=r.result;merged.versions.push(...incoming.versions.filter(v=>!merged.versions.some(x=>x.versionId===v.versionId)));merged.revisions.push(...incoming.revisions);merged.importedManual??=[];merged.importedManual.push(incoming.current);merged.revision++;store.put(merged);}else store.put(incoming);count++;};}}catch(e){error=e;tx.abort();}
    tx.oncomplete=()=>resolve(count);tx.onabort=tx.onerror=()=>reject(error??tx.error);
  });
}
