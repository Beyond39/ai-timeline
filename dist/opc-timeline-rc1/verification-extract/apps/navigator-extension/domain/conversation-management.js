import { fail, now } from './common.js';

export const conversationTitle = c => String(c.customTitle ?? '').trim() || c.originalTitle || c.title || '未命名对话';
export function conversationLibrary(data, args = {}) {
  const counts=new Map(), activity=new Map();
  for(const card of data.qaCards??[])if(card.validity?.state==='ACTIVE'){counts.set(card.conversationId,(counts.get(card.conversationId)??0)+1);const t=Date.parse(card.questionTime?.value);if(Number.isFinite(t))activity.set(card.conversationId,Math.max(activity.get(card.conversationId)??0,t));}
  const conversations=(data.conversations??[]).filter(c=>!args.projectId||c.projectId===args.projectId).map(c=>({...c,originalTitle:c.originalTitle??c.title,displayTitle:conversationTitle(c),qaCount:counts.get(c.id)??0,activityTime:activity.has(c.id)?new Date(activity.get(c.id)).toISOString():null,createdTime:c.sourceTime?.value??null}));
  const groups=[...new Set([...(data.projects??[]).filter(p=>!args.projectId||p.id===args.projectId).flatMap(p=>p.conversationGroups??[]),...conversations.flatMap(c=>c.groups??[])])].sort();
  return {conversations,projects:(data.projects??[]).map(p=>({id:p.id,name:p.name})),groups};
}
export function manageConversations(state,args) {
  const project=state.projects.find(p=>p.id===args.projectId);if(!project)fail('项目不存在。');
  if(args.action==='group') {
    const name=String(args.name??'').trim(),old=String(args.oldName??'').trim();if(!name||name.length>100)fail('请填写不超过100字的项目集合名称。');
    const names=new Set([...(project.conversationGroups??[]),...state.conversations.filter(c=>c.projectId===project.id).flatMap(c=>c.groups??[])]);
    if(old&&!names.has(old))fail('项目集合不存在。');if(name!==old&&names.has(name))fail('已存在同名项目集合。');
    if(old){names.delete(old);for(const c of state.conversations.filter(c=>c.projectId===project.id&&(c.groups??[]).includes(old))){c.groups=c.groups.map(g=>g===old?name:g);c.localRevision=(c.localRevision??0)+1;}}
    names.add(name);project.conversationGroups=[...names];return {name};
  }
  const ids=[...new Set(args.conversationIds??[])];if(!ids.length)fail('请先选择对话。');
  const rows=ids.map(id=>{const c=state.conversations.find(c=>c.id===id&&c.projectId===project.id);if(!c)fail('对话不存在或不属于当前项目。');if(args.expectedRevisions&&args.expectedRevisions[id]!== (c.localRevision??0))fail('对话已在另一窗口修改，请刷新后重试。');return c;});
  for(const key of ['addGroup','removeGroup'])if(Object.hasOwn(args,key)&&(typeof args[key]!=='string'||!args[key].trim()||args[key].length>100))fail('请选择有效的项目集合。');
  if(args.addGroup&&!new Set([...(project.conversationGroups??[]),...state.conversations.filter(c=>c.projectId===project.id).flatMap(c=>c.groups??[])]).has(args.addGroup))fail('项目集合已改变，请刷新后重试。');
  const values=args.values??{};
  if(Object.hasOwn(values,'groups')&&(!Array.isArray(values.groups)||values.groups.some(g=>typeof g!=='string'||!g.trim()||g.length>100)))fail('项目集合格式无效。');
  if(Object.hasOwn(values,'customTitle')&&typeof values.customTitle!=='string'||Object.hasOwn(values,'description')&&typeof values.description!=='string')fail('标题和描述必须是文本。');
  for(const c of rows){c.originalTitle??=c.title;for(const k of ['customTitle','description'])if(Object.hasOwn(values,k))c[k]=values[k].trim();for(const k of ['favorite','pinned','hidden'])if(Object.hasOwn(values,k))c[k]=Boolean(values[k]);if(Object.hasOwn(values,'groups'))c.groups=[...new Set(values.groups.map(g=>g.trim()))];if(args.addGroup)c.groups=[...new Set([...(c.groups??[]),String(args.addGroup)])];if(args.removeGroup)c.groups=(c.groups??[]).filter(g=>g!==args.removeGroup);c.localRevision=(c.localRevision??0)+1;c.localUpdatedAt=now();}
  return {updated:rows.length};
}
