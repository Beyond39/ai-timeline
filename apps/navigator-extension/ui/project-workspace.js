import { el, button, ask, showDialog } from './dom.js';
import { cardPresentation } from '../domain/card-presentation.js';
import { ContextDeploy } from './context-deploy.js';
import { configurePanelClose } from './panel-close.js';
import { topicSummary } from './topic-summary.js';

export class ProjectWorkspacePanel {
  constructor(owner) {
    this.owner=owner;this.checked=new Set();this.collapsed=new Set();this.query='';this.conversationId='';
    this.dialog=el('dialog',{class:'project-workspace-dialog','aria-label':'Project Workspace'});document.body.append(this.dialog);
  }
  safe(fn){return this.owner.safe(async()=>{if(this.busy)return;this.busy=true;try{await fn();}finally{this.busy=false;}});}
  async open(workspaceId=this.workspaceId){
    if(workspaceId===undefined&&globalThis.chrome?.storage?.local){const saved=await chrome.storage.local.get('opcWorkspaceSelection');workspaceId=saved.opcWorkspaceSelection;}
    if(workspaceId&&globalThis.chrome?.storage?.local){const saved=await chrome.storage.local.get('opcWorkspaceDirectory:'+workspaceId);this.savedDirectory=saved['opcWorkspaceDirectory:'+workspaceId];}
    this.workspaceId=workspaceId;
    await this.refresh();if(!this.dialog.open)showDialog(this.dialog);
    if(globalThis.chrome?.storage?.local)await chrome.storage.local.set({opcWorkspaceSelection:this.workspaceId??null});
  }
  async refresh(){
    this.data=await this.owner.api('workspaceData',{workspaceId:this.workspaceId,query:this.query,conversationId:this.conversationId});
    this.row=this.data.workspace;
    if(this.row&&this.directoryScope!==this.row.id){this.collapsed=new Set(this.savedDirectory??[...this.row.topics.map(t=>t.id),'']);this.directoryScope=this.row.id;this.savedDirectory=null;}
    else if(this.row)for(const topic of this.row.topics)if(!this.previousTopics?.has(topic.id))this.collapsed.add(topic.id);
    this.previousTopics=new Set(this.row?.topics.map(t=>t.id)??[]);
    this.render();
  }
  async write(action,values={}){
    const row=await this.owner.api('workspaceWrite',{workspaceId:this.workspaceId,expectedRevision:this.row?.revision,action,...values});
    this.workspaceId=row.id;await this.refresh();if(globalThis.chrome?.storage?.local)await chrome.storage.local.set({opcWorkspaceSelection:row.id});return row;
  }
  async create(){const values=await ask('新建 Project Workspace',[{name:'name',label:'项目名称'}],'关联已导入的对话；原始聊天与来源 ID 保留。');if(values){await this.write('create',values);this.checked.clear();}}
  async manage(){
    const dialog=el('dialog',{'aria-label':'关联 Conversation',class:'workspace-conversation-dialog'}),selected=new Set(this.row.conversationIds);
    dialog.append(el('h2',{text:'关联多个 Conversation'}),el('p',{text:'取消勾选只移除关联。一个 Conversation 可以出现在多个 Workspace。'}));
    const list=el('div',{class:'workspace-conversation-list'});
    for(const c of this.data.conversations){const check=el('input',{type:'checkbox',checked:selected.has(c.id)});check.addEventListener('change',()=>check.checked?selected.add(c.id):selected.delete(c.id));list.append(el('label',{},[check,el('span',{text:c.customTitle||c.title||c.id}),c.hidden||c.archived?el('small',{text:'隐藏／归档'}):null]));}
    dialog.append(list,button('保存关联',this.safe(async()=>{await this.write('conversations',{conversationIds:[...selected]});dialog.close();})),button('取消',()=>dialog.close()));
    dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);showDialog(dialog);
  }
  async openCard(card){
    this.dialog.close();await this.owner.openIndexedCard({projectId:card.projectId,cardId:card.id});
    // Keep the project directory and selection available after reading a source.
  }
  async deploy(cardIds=[]){
    if(cardIds.length)await this.owner.api('releaseWrite',{projectId:this.row.id,action:'tray',operation:'add',cardIds});
    const dialog=el('dialog',{class:'workspace-deploy-dialog','aria-label':'Workspace Deploy'}),host=el('div');
    const deployOwner={api:this.owner.api,host,safe:fn=>this.owner.safe(fn),drafts:this.owner.drafts,horizontal:this.owner.horizontal,globalSearch:this.owner.globalSearch,library:this.owner.library,onError:this.owner.onError,navigate:async(mode,key)=>{
      await panel.flush();dialog.close();if(key){const c=this.data.cards.find(c=>c.id===key)??(await this.owner.api('workspaceData',{workspaceId:this.row.id})).cards.find(c=>c.id===key);if(c)await this.openCard(c);}else await this.open();
    }};
    const panel=new ContextDeploy(deployOwner);
    configurePanelClose(dialog,{guardEdits:false,onClose:async()=>{await panel.flush();dialog.close();}});
    dialog.append(el('h2',{text:'Workspace Deploy'}),host);
    dialog.addEventListener('cancel',event=>{event.preventDefault();this.owner.safe(async()=>{await panel.flush();dialog.close();})();});
    dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);showDialog(dialog);await panel.show(this.row.id);
  }
  render(){
    this.dialog.replaceChildren(el('header',{class:'dialog-header'},[el('h2',{text:'项目概览'}),button('关闭',()=>this.dialog.close())]));
    const select=el('select',{'aria-label':'选择 Workspace'},[el('option',{value:'',text:'选择项目 Workspace'}),...this.data.workspaces.map(w=>el('option',{value:w.id,text:w.name+(w.archived?'（已归档）':'')}))]);select.value=this.workspaceId??'';
    select.addEventListener('change',this.safe(async()=>{this.query='';this.conversationId='';this.checked.clear();await this.open(select.value||null);}));
    const toolbar=el('div',{class:'actions workspace-switcher','data-close-ignore-edits':true},[select,button('新建 Workspace',this.safe(()=>this.create()))]);this.dialog.append(toolbar);
    if(!this.row){this.dialog.append(el('p',{class:'muted',text:'新建一个 Workspace，把多个历史 Conversation 关联到同一项目。原始来源保持稳定。'}));return;}
    const w=this.row;
    const management=el('details',{class:'workspace-management'},[el('summary',{text:'项目管理'}),el('div',{class:'actions'},[button('重命名',this.safe(async()=>{const values=await ask('重命名 Workspace',[{name:'name',label:'名称',value:w.name}]);if(values)await this.write('rename',values);})),button(w.archived?'恢复项目':'归档项目',this.safe(()=>this.write('archive',{archived:!w.archived}))),button('关联 Conversation',this.safe(()=>this.manage()))])]);toolbar.append(management);
    const overview=el('section',{class:'workspace-overview','aria-label':'项目概览统计'},[
      el('p',{class:'eyebrow',text:w.archived?'已归档 · 可恢复':'PROJECT OVERVIEW'}),el('h3',{text:w.name}),
      el('dl',{class:'workspace-overview-stats'},[[w.conversationIds.length,'Conversation'],[this.data.total,'有效 Q/A'],[w.topics.length,'已整理主题']].map(([value,label])=>el('div',{},[el('dt',{text:label}),el('dd',{text:String(value)})]))),
      el('div',{class:'actions'},[button('打开项目时间线',this.safe(async()=>{this.dialog.close();await this.owner.show({projectId:w.id,mode:'timeline'});}),'btn primary'),button('知识整理 / Topics',this.safe(async()=>{this.dialog.close();await this.owner.knowledge.open(w.id);})),button('打开项目 Deploy',this.safe(()=>this.deploy()))]),
    ]);this.dialog.append(overview);
    if(!w.conversationIds.length)this.dialog.append(el('div',{class:'workspace-empty'},[el('h3',{text:'先关联对话，建立项目上下文'}),el('p',{text:'从已导入的 Conversation 中选择来源，再浏览时间线或整理主题。'}),button('关联 Conversation',this.safe(()=>this.manage()),'btn primary')]));
    const search=el('input',{value:this.query,placeholder:'搜索项目内 Q/A','aria-label':'搜索项目内 Q/A'}),source=el('select',{'aria-label':'按来源 Conversation 筛选'},[el('option',{value:'',text:'全部来源'}),...this.data.conversations.filter(c=>w.conversationIds.includes(c.id)).map(c=>el('option',{value:c.id,text:c.customTitle||c.title}))]);source.value=this.conversationId;
    search.type='search';
    const form=el('form',{class:'actions workspace-filters','data-close-ignore-edits':true},[search,source,button('搜索',this.safe(async()=>{this.query=search.value;this.conversationId=source.value;await this.refresh();}))]);form.addEventListener('submit',event=>{event.preventDefault();this.safe(async()=>{this.query=search.value;this.conversationId=source.value;await this.refresh();})();});source.addEventListener('change',this.safe(async()=>{this.conversationId=source.value;this.query=search.value;await this.refresh();}));this.dialog.append(el('h3',{class:'workspace-section-title',text:'主题目录'}),form);
    const organize=el('details',{class:'workspace-organize'},[el('summary',{text:'整理与标签选项'})]);
    organize.append(el('div',{class:'actions'},[button('本地算法整理',this.safe(()=>this.write('organize')), 'btn',{disabled:w.archived||!this.data.total}),button('新建主题',this.safe(async()=>{const values=await ask('新建主题',[{name:'name',label:'主题名称'}]);if(values)await this.write('topicCreate',values);})),button('当前结果加入 Deploy',this.safe(()=>this.deploy(this.data.cards.map(c=>c.id))), 'btn',{disabled:!this.data.cards.length})]));this.dialog.append(organize);
    this.dialog.append(el('p',{class:'footnote',text:w.analysis?`上次整理 ${w.analysis.analyzedCount} 个不同问题；${w.analysis.duplicateCardIds.length} 张重复问题保留在未分类。人工修改受保护，重新整理仅更新自动归属。`:'免费离线整理，不发送聊天内容；不会生成回答摘要或 Canvas 关系。'}));
    organize.append(button('生成项目 Q/A 候选标签',this.safe(async()=>{await this.owner.flushMetadata();await this.owner.api('qaAnalyze',{projectId:w.id});await this.refresh();}),'btn',{disabled:!this.data.total}),el('small',{class:'muted',text:'点击问题进入统一 Reader 审核候选；自动主题特征不会覆盖人工归属。'}));
    if(!w.topics.length&&this.data.total)this.dialog.append(el('p',{class:'workspace-empty',text:'还没有主题。打开“整理与标签选项”进行本地整理，或新建主题手动归类。'}));
    if(!this.data.cards.length&&(this.query||this.conversationId))this.dialog.append(el('p',{class:'workspace-empty',role:'status',text:'没有匹配的 Q/A。试试其他关键词或选择全部来源。'}));
    const valid=new Set(this.data.cards.map(c=>c.id));this.checked=new Set([...this.checked].filter(key=>valid.has(key)));
    const target=el('select',{'aria-label':'移动到主题'},[el('option',{value:'',text:'未分类'}),...w.topics.map(t=>el('option',{value:t.id,text:t.name}))]);
    const counter=el('span',{text:`已选 ${this.checked.size} 张`});this.counter=counter;
    const selectionActions=el('div',{class:'actions workspace-selection','data-close-ignore-edits':true,hidden:!this.checked.size},[counter,target,button('移动所选',this.safe(async()=>{await this.write('move',{cardIds:[...this.checked],topicId:target.value});this.checked.clear();this.render();})),button('所选拆为新主题',this.safe(async()=>{
      if(!this.checked.size)throw new Error('请先选择问题。');const values=await ask('拆分为新主题',[{name:'name',label:'新主题名称'}]);if(!values)return;const saved=await this.write('topicCreate',values);await this.write('move',{topicId:saved.topics.at(-1).id,cardIds:[...this.checked]});this.checked.clear();this.render();
    })),button('所选加入 Deploy',this.safe(()=>this.deploy([...this.checked])))]);this.dialog.append(selectionActions);
    for(const t of [...w.topics,{id:'',name:'未分类'}]){
      const cards=this.data.cards.filter(c=>(w.assignments[c.id]||'')===t.id);
      const representative=cards.find(c=>t.representativeCardIds?.includes(c.id))??cards[0];
      const group=el('details',{class:'workspace-topic',open:Boolean(this.query)||!this.collapsed.has(t.id),'data-topic-id':t.id},[topicSummary({name:t.name,count:cards.length,manual:t.manual,keywords:t.keywords,representative:representative?cardPresentation(representative).title:''})]);
      group.addEventListener('toggle',()=>{
        if(!group.isConnected||this.query)return;
        const changed=group.open?this.collapsed.delete(t.id):!this.collapsed.has(t.id);
        if(!group.open)this.collapsed.add(t.id);
        if(changed&&globalThis.chrome?.storage?.local)this.owner.safe(()=>chrome.storage.local.set({['opcWorkspaceDirectory:'+w.id]:[...this.collapsed]}))();
      });
      const actions=el('div',{class:'actions'},[button('主题加入 Deploy',this.safe(()=>this.deploy(cards.map(c=>c.id))),'btn',{disabled:!cards.length})]);
      if(t.id)actions.append(button('修改主题名',this.safe(async()=>{const values=await ask('修改主题名称',[{name:'name',label:'名称',value:t.name}]);if(values)await this.write('topicRename',{topicId:t.id,...values});})),button('合并到其他主题',this.safe(async()=>{const others=w.topics.filter(x=>x.id!==t.id);if(!others.length)throw new Error('请先创建另一个主题。');const values=await ask('合并主题',[{name:'targetTopicId',label:'目标主题',value:others[0].id,options:others.map(x=>({value:x.id,label:x.name}))}],'成员归属将作为人工调整保存。');if(values)await this.write('merge',{topicId:t.id,...values});})));
      group.append(actions);
      for(const c of cards){const p=cardPresentation(c),check=el('input',{type:'checkbox',checked:this.checked.has(c.id),'aria-label':`选择 ${p.title}`});check.addEventListener('change',()=>{check.checked?this.checked.add(c.id):this.checked.delete(c.id);counter.textContent=`已选 ${this.checked.size} 张`;selectionActions.hidden=!this.checked.size;});
        group.append(el('article',{class:'workspace-question','data-workspace-card':c.id,'data-close-ignore-edits':true},[check,el('div',{},[button(p.title,this.safe(()=>this.openCard(c)),'workspace-question-title'),el('small',{class:'muted',text:(this.data.conversations.find(x=>x.id===c.conversationId)?.customTitle||this.data.conversations.find(x=>x.id===c.conversationId)?.title||c.sourceTitle)+(t.representativeCardIds?.includes(c.id)?' · 代表问题':'')+' · '+p.titleOrigin}),p.question?el('p',{text:p.question}):null,p.sourceWarning?el('small',{text:'源文本含 U+FFFD，请核对原始版本'}):null])]));}
      const nodes=new Map([...group.querySelectorAll('[data-workspace-card]')].map(n=>[n.dataset.workspaceCard,n.querySelector('div')]));
      for(const c of cards){const node=nodes.get(c.id),s=c.metadata.localSuggestion;for(const tag of (c.metadata.autoTags??[]).slice(0,3))node?.append(el('span',{class:'qa-auto-chip',text:'自动 · '+tag}));if(s&&s.status!=='rejected'&&s.status!=='accepted')for(const tag of s.tags.slice(0,3))node?.append(el('span',{class:'qa-candidate-chip',text:'候选 · '+tag}));}
      if(!cards.length)group.append(el('p',{class:'muted',text:'此筛选下没有问题。'}));this.dialog.append(group);
    }
  }
}
