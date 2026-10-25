import { fail, now } from './common.js';

export function projectDeletionPreview(state,args){
  const project=state.projects.find(p=>p.id===args.projectId);if(!project)fail('项目不存在，未删除数据。');
  const ids=store=>new Set((state[store]??[]).filter(r=>r.projectId===project.id).map(r=>r.id)),conversations=ids('conversations'),cards=ids('qaCards');
  return {projectId:project.id,name:project.name,revision:state.revision,conversations:conversations.size,cards:cards.size,messages:ids('messages').size,versions:ids('versions').size,workspaces:(state.projectWorkspaces??[]).filter(w=>w.conversationIds.some(id=>conversations.has(id))).map(w=>({id:w.id,name:w.name}))};
}
export function deleteProjectData(state,args,stores){
  const preview=projectDeletionPreview(state,args);
  if(preview.name!==args.confirmName)fail('项目名确认不一致，未删除数据。');
  if(args.expectedRevision!=null&&args.expectedRevision!==state.revision)fail('项目资料已变化，请重新检查删除范围；未删除数据。');
  const removed=Object.fromEntries(stores.map(store=>[store,new Set((state[store]??[]).filter(r=>store==='projects'?r.id===args.projectId:r.projectId===args.projectId).map(r=>r.id))]));
  const derivedStores=['timelinePreferences','contextTrays','openIssues','decisions','knowledgeFragments','contextPacks'],original=new Map(derivedStores.flatMap(store=>(state[store]??[]).map(row=>[row.id,JSON.stringify(row)])));
  const gone=(store,id)=>removed[store]?.has(id),keep=(store,values=[])=>values.filter(id=>!gone(store,id));
  for(const store of stores){
    if(store==='projectWorkspaces')continue;
    if(store==='drafts'){state.drafts=state.drafts.filter(d=>d.projectId!==args.projectId).map(d=>d.results?{...d,results:d.results.filter(r=>r.projectId!==args.projectId)}:d);continue;}
    state[store]=(state[store]??[]).filter(r=>!removed[store].has(r.id));
  }
  for(const w of state.projectWorkspaces??[]){
    const touched=w.conversationIds.some(id=>gone('conversations',id))||Object.keys(w.assignments).some(id=>gone('qaCards',id))||w.manualCardIds.some(id=>gone('qaCards',id))||w.topics.some(t=>(t.representativeCardIds??[]).some(id=>gone('qaCards',id)));if(!touched)continue;
    w.conversationIds=keep('conversations',w.conversationIds);w.manualCardIds=keep('qaCards',w.manualCardIds);w.assignments=Object.fromEntries(Object.entries(w.assignments).filter(([id])=>!gone('qaCards',id)));
    for(const topic of w.topics)topic.representativeCardIds=keep('qaCards',topic.representativeCardIds);
    if(w.analysis){for(const key of ['unclassifiedCardIds','duplicateCardIds'])w.analysis[key]=keep('qaCards',w.analysis[key]);for(const t of w.analysis.topics??[])t.cardIds=keep('qaCards',t.cardIds);w.analysis.sourceChanged=true;}
    w.revision++;w.updatedAt=now();
  }
  for(const p of state.timelinePreferences??[])for(const key of ['selectedTimelineIds','trackOrder','collapsedTimelineIds','knownTimelineIds'])if(p[key])p[key]=keep('timelines',p[key]);
  for(const tray of state.contextTrays??[])tray.cardIds=keep('qaCards',tray.cardIds);
  for(const store of ['openIssues','decisions','knowledgeFragments'])for(const row of state[store]??[]){
    if(gone('qaCards',row.cardId)){row.unavailableSourceId=row.cardId;row.cardId=null;row.sourceUnavailable=true;}
    for(const [key,target] of [['resolvedByCardId','qaCards'],['supersededByDecisionId','decisions'],['sourceVersionId','versions'],['messageId','messages']])if(gone(target,row[key]))row[key]=null;
    if(row.evidenceCardIds)row.evidenceCardIds=keep('qaCards',row.evidenceCardIds);if(row.conflictsWithDecisionIds)row.conflictsWithDecisionIds=keep('decisions',row.conflictsWithDecisionIds);
  }
  state.contextPackItems=(state.contextPackItems??[]).filter(r=>!gone('qaCards',r.cardId)&&!gone('knowledgeFragments',r.fragmentId));
  for(const pack of state.contextPacks??[]){
    const missing=(pack.selectedCardIds??[]).filter(id=>gone('qaCards',id));
    if(missing.length){pack.unavailableSourceIds=[...new Set([...(pack.unavailableSourceIds??[]),...missing])];pack.sourceUnavailable=true;}
    for(const [key,store] of [['selectedCardIds','qaCards'],['selectedFragmentIds','knowledgeFragments'],['selectedIssueIds','openIssues']])if(pack[key])pack[key]=keep(store,pack[key]);
    // Frozen generated/edited content and its historical evidence stay intact.
  }
  for(const store of derivedStores)for(const row of state[store]??[])if(original.get(row.id)!==JSON.stringify(row)){row.revision=(row.revision??0)+1;row.updatedAt=now();}
  return {deleted:true,projectId:args.projectId,affectedWorkspaces:preview.workspaces.length};
}
