import { id, copy, fail } from './common.js';
import { RELEASE_STORES } from './release-data.js';

// Supplemental library backup, separate from the existing per-source Project
// backup contract. All original source projects are backed up by that contract.
export function exportWorkspaceData(state) {
  const workspaces=copy(state.projectWorkspaces??[]), ids=new Set(workspaces.map(w=>w.id));
  const cardIds=new Set((state.qaCards??[]).map(c=>c.id)), conversationIds=new Set((state.conversations??[]).map(c=>c.id));
  for(const w of workspaces){w.conversationIds=w.conversationIds.filter(k=>conversationIds.has(k));w.assignments=Object.fromEntries(Object.entries(w.assignments).filter(([k])=>cardIds.has(k)));w.manualCardIds=w.manualCardIds.filter(k=>cardIds.has(k));}
  return {version:1,workspaces,records:Object.fromEntries(RELEASE_STORES.map(store=>[store,copy((state[store]??[]).filter(r=>ids.has(r.projectId)))]))};
}
export function validateWorkspaceData(data, projects) {
  if(data==null)return;
  const conversations=new Set(projects.flatMap(p=>p.records.conversations.map(c=>c.id))),cards=new Set(projects.flatMap(p=>p.records.qaCards.map(c=>c.id))),ids=new Set();
  const occupied=new Set(projects.flatMap(p=>[p.project?.id,...Object.values(p.records).flatMap(rows=>rows.map(r=>r.id))]).filter(Boolean));
  if(data.version!==1||!Array.isArray(data.workspaces)||!data.records)fail('Workspace 备份格式无效。');
  for(const w of data.workspaces){
    if(typeof w.id!=='string'||!w.id.startsWith('workspace_')||occupied.has(w.id)||typeof w.name!=='string'||!w.name.trim()||!Number.isInteger(w.revision)||w.revision<0||!Array.isArray(w.conversationIds)||w.conversationIds.some(k=>!conversations.has(k))||!Array.isArray(w.topics)||!w.assignments||Array.isArray(w.assignments)||!Array.isArray(w.manualCardIds))fail('Workspace 备份身份或引用无效。');
    ids.add(w.id);occupied.add(w.id);const topics=new Set(w.topics.map(t=>t.id));
    if(topics.size!==w.topics.length||w.topics.some(t=>typeof t.id!=='string'||occupied.has(t.id)||typeof t.name!=='string'||!t.name.trim())||Object.values(w.assignments).some(t=>t!=null&&!topics.has(t)))fail('Workspace 备份主题引用无效。');
    for(const t of w.topics)occupied.add(t.id);
    // Stale card assignments may survive a source removal, but must remain
    // backed-up source references. Export prunes dangling references below.
    if(Object.keys(w.assignments).some(k=>!cards.has(k))||w.manualCardIds.some(k=>!cards.has(k)))fail('Workspace 备份卡片引用无效。');
  }
  for(const store of RELEASE_STORES){if(!Array.isArray(data.records[store]))fail('Workspace 备份缺少数据表。');for(const r of data.records[store]){if(typeof r.id!=='string'||occupied.has(r.id)||!ids.has(r.projectId))fail('Workspace 备份数据归属无效。');occupied.add(r.id);}}
  const references=Object.fromEntries(['qaCards','knowledgeFragments','openIssues','decisions','versions','messages','contextPacks'].map(store=>[store,new Set([...projects.flatMap(p=>(p.records[store]??[]).map(r=>r.id)),...(data.records[store]??[]).map(r=>r.id)])]));
  const scalarRefs={cardId:'qaCards',fragmentId:'knowledgeFragments',packId:'contextPacks',sourceVersionId:'versions',messageId:'messages',resolvedByCardId:'qaCards',supersededByDecisionId:'decisions'};
  const arrayRefs={selectedCardIds:'qaCards',cardIds:'qaCards',selectedFragmentIds:'knowledgeFragments',selectedIssueIds:'openIssues',evidenceCardIds:'qaCards',conflictsWithDecisionIds:'decisions'};
  for(const store of RELEASE_STORES)for(const r of data.records[store]){
    for(const [key,target]of Object.entries(scalarRefs))if(r[key]!=null&&!references[target].has(r[key]))fail('Workspace 备份来源引用无效。');
    for(const [key,target]of Object.entries(arrayRefs))if(r[key]!=null&&(!Array.isArray(r[key])||r[key].some(k=>!references[target].has(k))))fail('Workspace 备份来源成员无效。');
    if(store==='contextPacks'&&(!Array.isArray(r.selectedCardIds)||!Array.isArray(r.selectedFragmentIds)||typeof r.generatedContent!=='string'||typeof r.editedContent!=='string'))fail('Workspace 上下文包结构无效。');
    if(store==='contextPackItems'&&!data.records.contextPacks.some(p=>p.id===r.packId&&p.projectId===r.projectId))fail('Workspace 上下文项归属无效。');
  }
}
export function restoreWorkspaceData(state, data, referenceMap) {
  if(!data)return;
  const mapping=new Map(Object.entries(referenceMap));
  for(const w of data.workspaces){mapping.set(w.id,id('workspace'));for(const t of w.topics)mapping.set(t.id,id('workspaceTopic'));}
  for(const rows of Object.values(data.records))for(const row of rows)mapping.set(row.id,id('workspaceRecord'));
  const scalarRefs=new Set(['id','projectId','cardId','conversationId','topicId','packId','fragmentId','sourceVersionId','messageId','questionVersionId','resolvedByCardId','supersededByDecisionId']);
  const arrayRefs=new Set(['conversationIds','manualCardIds','cardIds','selectedCardIds','selectedFragmentIds','selectedIssueIds','evidenceCardIds','conflictsWithDecisionIds','unclassifiedCardIds','duplicateCardIds','representativeCardIds','orderedCardIds','selectedTimelineIds','trackOrder','collapsedTimelineIds','knownTimelineIds']);
  const prose=new Set(['name','title','text','question','answer','generatedContent','editedContent','description','userNote','targetTask','projectGoal','constraints','warnings']);
  const remap=(value,key='')=>{
    if(prose.has(key))return copy(value);
    if(scalarRefs.has(key))return mapping.get(value)??value;
    if(arrayRefs.has(key))return value.map(k=>mapping.get(k)??k);
    if(key==='assignments')return Object.fromEntries(Object.entries(value).map(([k,v])=>[mapping.get(k)??k,mapping.get(v)??v]));
    if(['answerVersionIds','lastActiveAnswerVersionIds','recoveredReferenceMap'].includes(key))return Object.fromEntries(Object.entries(value).map(([k,v])=>[mapping.get(k)??k,mapping.get(v)??v]));
    if(key==='sourceVersions')return {...copy(value),cards:Object.fromEntries(Object.entries(value.cards??{}).map(([k,v])=>[mapping.get(k)??k,remap(v)])),...Object.fromEntries(['decisions','issues','fragments','relations'].map(field=>[field,(value[field]??[]).map(([k,...rest])=>[mapping.get(k)??k,...rest])]))};
    if(Array.isArray(value))return value.map(v=>remap(v));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v,k)]));return value;
  };
  state.projectWorkspaces??=[];
  for(const w of data.workspaces)state.projectWorkspaces.push(remap(w));
  for(const store of RELEASE_STORES){state[store]??=[];for(const row of data.records[store]){
    const restored=remap(row);
    if(store==='contextPacks')restored.recoveredReferenceMap={...restored.recoveredReferenceMap,...Object.fromEntries(mapping)};
    state[store].push(restored);
  }}
}
export const libraryChecksumInput = (projects, workspaceData) => workspaceData ? {projects,workspaceData} : projects;
