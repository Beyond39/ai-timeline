import { readSnapshot } from './database.js';
import { consistentRead } from './queries.js';
import { getSearchIndex } from './search-index.js';
import { workspaceById, workspaceCards } from '../domain/project-workspace.js';
import { OPC_CORE_STORES } from '../domain/opc.js';
import { LIGHT_RELEASE_STORES } from '../domain/release-data.js';

export async function workspaceData(args = {}) {
  return consistentRead(null, async () => {
    const data = await readSnapshot(['projectWorkspaces','conversations','qaCards','qaMetadata'].map(store=>({store})));
    if (!args.workspaceId) return {value:{workspaces:data.projectWorkspaces,conversations:data.conversations},revisions:[data.revision]};
    const workspace=workspaceById(data,args.workspaceId), cards=workspaceCards(data,workspace);
    let selected=cards.filter(c=>!args.conversationId||c.conversationId===args.conversationId);
    if(String(args.query??'').trim()) {
      const index=await getSearchIndex();const matches=new Set(index.search({query:args.query,type:'qa',scoresOnly:true,cardIds:selected.map(c=>c.id)}).results.map(r=>r.cardId));
      selected=selected.filter(c=>matches.has(c.id));
    }
    const latest=await readSnapshot([]);
    return {value:{workspace,workspaces:data.projectWorkspaces,conversations:data.conversations,cards:selected,total:cards.length},revisions:[data.revision,latest.revision]};
  });
}
export async function workspaceAnalysisCards(state, workspace) {
  const index=await getSearchIndex();
  return workspaceCards(state,workspace).map(c=>({id:c.id,question:index.documents.get(c.id)?.fields.question??c.questionPreview,title:c.metadata.title||c.metadata.autoTitle,tags:[c.metadata.topic,...(c.metadata.tags??[]),...(c.metadata.autoTags??[])].filter(Boolean)}));
}
// Existing Deploy uses a virtual scope. Every source card retains its actual
// projectId and stable ID; only pack/tray records are owned by the Workspace.
export async function workspaceScope(workspaceId, trace = null) {
  // Deploy needs lightweight card/annotation records, never capture bodies or
  // repair archives from unrelated source projects.
  const data=await readSnapshot(['projectWorkspaces','conversations','qaCards','qaMetadata','timelines','memberships','timelinePreferences','relationships','openIssues','decisions','knowledgeFragments','contextTrays'].map(store=>({store})),trace);
  const workspace=workspaceById(data,workspaceId), cards=workspaceCards(data,workspace), ids=new Set(cards.map(c=>c.id)), conversations=new Set(cards.map(c=>c.conversationId));
  const scope={revision:data.revision,project:{id:workspace.id,name:workspace.name},projects:[{id:workspace.id,name:workspace.name}],workspaceCardIds:[...ids],qaCards:cards.map(({metadata,...c})=>c),conversations:data.conversations.filter(c=>conversations.has(c.id))};
  for(const store of [...OPC_CORE_STORES,...LIGHT_RELEASE_STORES])if(store!=='qaCards')scope[store]=(data[store]??[]).filter(r=>r.projectId===workspace.id||['qaMetadata','openIssues','decisions','knowledgeFragments'].includes(store)&&ids.has(r.cardId)||store==='relationships'&&ids.has(r.fromCardId)&&ids.has(r.toCardId));
  scope.timelines=data.timelines.filter(t=>t.kind==='source'&&conversations.has(t.conversationId));
  const timelineIds=new Set(scope.timelines.map(t=>t.id));
  scope.workspaceTimelineIds=[...timelineIds];
  scope.memberships=data.memberships.filter(m=>timelineIds.has(m.timelineId)&&ids.has(m.cardId));
  return scope;
}
