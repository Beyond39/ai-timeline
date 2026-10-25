import { id, now, fail } from './common.js';
import { AlgorithmProvider } from './organization-provider.js';

export const WORKSPACE_STORE = 'projectWorkspaces';
export function workspaceById(state, workspaceId) {
  const row = (state.projectWorkspaces ?? []).find(w=>w.id===workspaceId);
  if (!row) fail('Project Workspace 不存在。'); return row;
}
export function workspaceCards(state, workspace) {
  const conversations = new Set((state.conversations??[]).filter(c=>workspace.conversationIds.includes(c.id)&&!c.hidden&&!c.archived).map(c=>c.id));
  const metadata = new Map((state.qaMetadata??[]).map(m=>[m.cardId,m]));
  return (state.qaCards??[]).filter(c=>conversations.has(c.conversationId)&&c.validity?.state==='ACTIVE'&&!c.hidden&&!c.archived&&!metadata.get(c.id)?.hidden)
    .map(c=>({...c,metadata:metadata.get(c.id)??{}}));
}
const name = value => { const text=String(value??'').trim(); if(!text||text.length>100)fail('名称需为 1–100 字。');return text; };
export function workspaceMutation(state, args, analysisCards = null) {
  state.projectWorkspaces ??= [];
  if(args.action==='create') { const row={id:id('workspace'),name:name(args.name),conversationIds:[],topics:[],assignments:{},manualCardIds:[],revision:0,createdAt:now(),updatedAt:now(),archived:false};state.projectWorkspaces.push(row);return row; }
  const row=workspaceById(state,args.workspaceId);
  if(args.expectedRevision !== row.revision)fail('Workspace 已在另一页面修改，请刷新后重试；你的修改未覆盖。');
  const topic = key => { const t=row.topics.find(t=>t.id===key);if(!t)fail('主题不存在。');return t; };
  if(args.action==='rename')row.name=name(args.name);
  else if(args.action==='archive')row.archived=args.archived!==false;
  else if(args.action==='conversations') {
    const ids=[...new Set(args.conversationIds??[])];
    if(ids.some(key=>!state.conversations.some(c=>c.id===key)))fail('所选对话不存在。');row.conversationIds=ids;
  } else if(args.action==='organize'||args.action==='knowledgeOrganize') {
    const cards=analysisCards??workspaceCards(state,row).map(c=>({id:c.id,question:c.questionPreview,title:c.metadata.title,tags:[c.metadata.topic,...(c.metadata.tags??[])].filter(Boolean)}));
    const result=args.action==='knowledgeOrganize'?args.analysis:new AlgorithmProvider().organize({cards});
    if(args.action==='knowledgeOrganize'){
      const valid=new Set(workspaceCards(state,row).map(c=>c.id)),seen=new Set();
      if(!result||!['Lexical','Semantic','Hybrid'].includes(result.mode)||!Array.isArray(result.topics)||!Array.isArray(result.unclassifiedCardIds)||!Array.isArray(result.duplicateCardIds))fail('知识整理结果格式无效。');
      for(const group of result.topics){if(typeof group.name!=='string'||!group.name.trim()||group.name.length>60||!Array.isArray(group.cardIds)||!Array.isArray(group.representativeCardIds)||group.representativeCardIds.some(k=>!group.cardIds.includes(k)))fail('主题来源无效。');for(const key of group.cardIds){if(!valid.has(key)||seen.has(key))fail('主题含有失效、重复或范围外卡片。');seen.add(key);}}
      if(result.unclassifiedCardIds.some(k=>!valid.has(k)||seen.has(k)))fail('未分类来源无效。');
    }
    const manual=new Set(row.manualCardIds), retained=row.topics.filter(t=>t.manual||Object.entries(row.assignments).some(([key,value])=>value===t.id&&manual.has(key)));
    row.assignments=Object.fromEntries(Object.entries(row.assignments).filter(([key])=>manual.has(key)));
    row.topics=retained;
    for(const group of result.topics) {
      const cardIds=group.cardIds.filter(key=>!manual.has(key));if(!cardIds.length)continue;
      const t={id:id('workspaceTopic'),name:group.name,manual:false,representativeCardIds:group.representativeCardIds,keywords:group.keywords??[]};row.topics.push(t);
      for(const key of cardIds)row.assignments[key]=t.id;
    }
    row.analysis={...result,topics:result.topics.map(t=>({name:t.name,cardIds:t.cardIds})),runAt:now()};
  } else if(args.action==='topicCreate')row.topics.push({id:id('workspaceTopic'),name:name(args.name),manual:true,representativeCardIds:[]});
  else if(args.action==='topicRename'){Object.assign(topic(args.topicId),{name:name(args.name),manual:true});row.manualCardIds=[...new Set([...row.manualCardIds,...Object.entries(row.assignments).filter(([,t])=>t===args.topicId).map(([k])=>k)])];}
  else if(args.action==='move') {
    if(args.topicId)topic(args.topicId);
    const valid=new Set(workspaceCards(state,row).map(c=>c.id));const ids=[...new Set(args.cardIds??[])];
    if(!ids.length||ids.some(key=>!valid.has(key)))fail('选择包含隐藏、失效或项目外卡片，请刷新。');
    for(const key of ids)row.assignments[key]=args.topicId||null;
    row.manualCardIds=[...new Set([...row.manualCardIds,...ids])];if(args.topicId)topic(args.topicId).manual=true;
  } else if(args.action==='merge') {
    const source=topic(args.topicId),target=topic(args.targetTopicId);if(source.id===target.id)fail('不能合并到自身。');
    const moved=[];for(const[key,value]of Object.entries(row.assignments))if(value===source.id||value===target.id){row.assignments[key]=target.id;moved.push(key);}
    row.manualCardIds=[...new Set([...row.manualCardIds,...moved])];target.manual=true;row.topics=row.topics.filter(t=>t.id!==source.id);
  } else fail('未知 Workspace 操作。');
  row.revision++;row.updatedAt=now();return row;
}
