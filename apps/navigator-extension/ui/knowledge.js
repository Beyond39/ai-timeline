import { el, button, ask, showDialog } from './dom.js';
import { cacheGet, cachePut, updateReview } from '../storage/knowledge-cache.js';
import { BGE, importModelFile } from '../analysis/bge.js';
import { ENGINE_VERSION } from '../analysis/knowledge-analysis.js';
import { verifyFragment } from '../analysis/knowledge-keypoints.js';
import { digest } from '../domain/common.js';
import { registerClosablePanel } from './panel-close.js';
import { ConversationKnowledge } from './conversation-knowledge.js';
import { topicSummary } from './topic-summary.js';

export class KnowledgePanel {
  constructor(owner) {
    this.owner=owner;this.epoch=0;this.expandedTopics=new Map();this.expandedConversations=new Map();this.conversation=new ConversationKnowledge(this);
    this.dialog=el('dialog',{class:'project-workspace-dialog knowledge-dialog','aria-label':'本地知识整理'});document.body.append(this.dialog);
    this.dialog.addEventListener('close',()=>{this.cancel();this.releaseClose?.();});
    this.onPageHide=()=>this.cancel();globalThis.addEventListener?.('pagehide',this.onPageHide);
  }
  safe(fn){return this.owner.safe(fn);}
  cancel(){this.conversation.cancel();this.epoch++;if(this.worker){this.worker.terminate();this.worker=null;this.rejectJob?.(new DOMException('已取消，已有结果保留。','AbortError'));this.rejectJob=null;}this.busy=false;}
  destroy(){this.cancel();this.releaseClose?.();this.dialog.remove();globalThis.removeEventListener?.('pagehide',this.onPageHide);}
  async open(projectId=this.owner.projectId) {
    this.cancel();this.projectId=projectId;this.checked=new Set();
    if(!await this.refresh())return;if(!this.dialog.open){this.dialog.show();this.releaseClose=registerClosablePanel(this.dialog,{guardEdits:false,onClose:()=>this.dialog.close()});}
  }
  async refresh(){
    const id=this.projectId,epoch=this.epoch,source=await this.owner.api('knowledgeDocuments',{projectId:id});
    const [run,topicReview,workspace,cardReviews]=await Promise.all([cacheGet('runs',id),cacheGet('reviews','topics:'+id),String(id).startsWith('workspace_')?this.owner.api('workspaceData',{workspaceId:id}).then(d=>d.workspace):null,Promise.all(source.documents.map(async d=>[d.cardId,await cacheGet('reviews','card:'+d.cardId)]))]);
    if(id!==this.projectId||epoch!==this.epoch)return false;
    Object.assign(this,{source,run,topicReview:topicReview??{id:'topics:'+id,revision:0,items:{}},workspace,cardReviews:Object.fromEntries(cardReviews)});
    await this.conversation.setSource(source);if(id!==this.projectId||epoch!==this.epoch)return false;
    this.render();return true;
  }
  job(documents,mode,onProgress) {
    return new Promise((resolve,reject)=>{
      const worker=this.worker=new Worker(new URL('../analysis/knowledge-worker.js',import.meta.url),{type:'module'});this.rejectJob=reject;
      const finish=(error,result)=>{worker.terminate();if(this.worker===worker){this.worker=null;this.rejectJob=null;}error?reject(error):resolve(result);};
      worker.onmessage=({data})=>{if(data.progress)onProgress(data.progress);else finish(data.error?new Error(data.error):null,data.result);};worker.onerror=e=>finish(new Error(e.message||'分析 Worker 无法运行。'));
      worker.postMessage({action:'analyze',documents,mode});
    });
  }
  async analyze(mode='Lexical') {
    if(this.busy)return;const epoch=++this.epoch,projectId=this.projectId,source=this.source,workspace=this.workspace;this.busy=true;this.errorMessage='';
    this.render();
    try {
      const result=await this.job(source.documents,mode,p=>{if(epoch===this.epoch&&this.status?.isConnected)this.status.textContent=p.phase==='model'?`模型 ${p.file??''} · ${p.status??''}${Number.isFinite(p.progress)?' '+Math.round(p.progress)+'%':''}`:`${p.phase==='embedding'?'语义编码':'原文抽取'} ${p.completed??0} / ${p.total??source.documents.length}`;});
      if(epoch!==this.epoch||projectId!==this.projectId)return;
      const current=await this.owner.api('knowledgeDocuments',{projectId});
      if(epoch!==this.epoch)return;
      if(current.corpusHash!==source.corpusHash)throw Error('分析期间来源或人工标签已改变，已有结果保留，请重新整理。');
      if(workspace)await this.owner.api('workspaceWrite',{workspaceId:projectId,action:'knowledgeOrganize',expectedRevision:workspace.revision,analysis:{mode:result.mode,provider:{id:'knowledge',version:1},parameters:result.parameters,topics:result.topics,unclassifiedCardIds:result.unclassifiedCardIds,duplicateCardIds:result.duplicateCardIds,analyzedCount:result.analyzedCount}});
      if(epoch!==this.epoch)return;
      await cachePut('runs',{id:projectId,corpusHash:source.corpusHash,createdAt:Date.now(),...result});
      await this.refresh();
    }catch(e){if(e.name!=='AbortError'){this.errorMessage=e.message;this.owner.onError?.(e.message);}if(this.status?.isConnected)this.status.textContent=e.message;}
    finally{if(epoch===this.epoch){this.busy=false;this.render();}}
  }
  async enableSemantic(){
    const choice=await ask('开启本地语义增强',[],`${BGE.modelId} · 固定预训练模型，约 24 MB 权重。首次需要联网下载，或主动导入离线 ONNX；后续使用本机缓存。推理在本机 Worker/WASM 中运行，不发送聊天内容。下载失败将显示 Semantic Unavailable 并回退到 TF-IDF。`,{confirmLabel:'开启并整理'});
    if(choice)await this.analyze('Hybrid');
  }
  async openCard(doc){this.readerScopeId=this.projectId;this.dialog.close();await this.owner.openIndexedCard({projectId:doc.sourceProjectId,cardId:doc.cardId});}
  async editTopics(change){this.topicReview=await updateReview('topics:'+this.projectId,this.topicReview.revision,row=>{change(row);return row;});await this.refresh();}
  topics(){
    if(this.workspace)return this.workspace.topics.map(t=>({...t,cardIds:Object.entries(this.workspace.assignments).filter(([,id])=>id===t.id).map(([key])=>key)}));
    const overrides=this.topicReview.items;
    const topics=(this.run?.topics??[]).map(t=>({...t,id:t.cardIds.toSorted().join('|')}));
    const retained=Object.values(overrides.topics??{});for(const t of retained)if(!topics.some(x=>x.id===t.id))topics.push({...t,cardIds:[]});
    return topics.map(t=>({...t,...overrides.topics?.[t.id],cardIds:this.source.documents.filter(d=>(Object.hasOwn(overrides.assignments??{},d.cardId)?overrides.assignments[d.cardId]:t.cardIds.includes(d.cardId)?t.id:null)===t.id).map(d=>d.cardId)}));
  }
  render(){
    const root=this.dialog;root.replaceChildren(el('header',{class:'dialog-header'},[el('h2',{text:'知识整理 / Topics'}),button('关闭',()=>root.close())]));
    const docs=this.source?.documents??[],current=this.run?.corpusHash===this.source?.corpusHash;
    const scopeTitle=this.workspace?.name??this.source?.projectName??'当前 Project';
    root.append(el('p',{text:`${scopeTitle} · ${new Set(docs.map(d=>d.conversationId)).size} 个 Conversation · ${docs.length} 张有效 Q/A`}));
    this.status=el('p',{role:'status','aria-live':'polite',text:this.errorMessage|| (this.busy?'正在本机整理，可关闭窗口或取消；Timeline 保持可用。':this.run?`${this.run.status} · ${this.run.version} · ${current?'来源一致':'来源已变化，请重新整理'}${this.run.semanticError?' · 语义失败，当前采用 TF-IDF：'+this.run.semanticError:''}`:'Lexical · 尚未整理')});
    const importer=el('input',{type:'file',accept:'.onnx','aria-label':'导入离线 BGE 模型',hidden:true});
    importer.addEventListener('change',this.safe(async()=>{if(!importer.files[0])return;const imported=await importModelFile(importer.files[0]);this.status.textContent=`离线权重已验证并缓存（${imported.bytes.toLocaleString()} 字节），可开启语义增强。`;}));
    root.append(el('div',{class:'actions'},[button('本地知识整理',this.safe(()=>this.analyze()),'btn primary',{disabled:this.busy||!docs.length}),button('开启语义增强',this.safe(()=>this.enableSemantic()),'btn',{disabled:this.busy||!docs.length}),button('导入离线模型',()=>importer.click(),'btn',{disabled:this.busy}),button('取消计算',()=>{this.cancel();this.render();this.status.textContent='已取消，已保存结果保留。';},'btn',{disabled:!this.busy}),importer]),this.status);
    const conversationDetails=el('details',{class:'knowledge-conversation-details',open:this.expandedConversations.get(this.projectId)??false},[el('summary',{text:'对话阶段与知识详情'}),this.conversation.host]);
    const conversationScope=this.projectId;conversationDetails.addEventListener('toggle',()=>{if(conversationDetails.isConnected)this.expandedConversations.set(conversationScope,conversationDetails.open);});
    root.append(conversationDetails);
    if(!this.run){root.append(el('div',{class:'workspace-empty'},[el('h3',{text:docs.length?'让对话成为可浏览的主题':'还没有可整理的 Q/A'}),el('p',{text:docs.length?'点击“本地知识整理”提取候选主题、关键词和原文片段。基础整理无需语义模型；语义增强可按需开启。':'先导入对话，或在项目概览中关联已保存的 Conversation。'})]));return;}
    const topics=this.topics(),valid=new Set(docs.map(d=>d.cardId)),assigned=new Set(topics.flatMap(t=>t.cardIds).filter(id=>valid.has(id))),groups=[...topics,{id:'',name:'未分类',cardIds:docs.filter(d=>!assigned.has(d.cardId)).map(d=>d.cardId)}];
    root.append(el('p',{class:'muted',text:`${topics.length} 个候选主题 · 未分类 ${docs.length-assigned.size} · 主题归属表示分类；原文摘录与自动标签均待人工审核。`}));
    const targets=el('select',{'aria-label':'知识主题移动目标'},[el('option',{value:'',text:'未分类'}),...topics.map(t=>el('option',{value:t.id,text:t.name}))]);
    const selectedCount=el('span',{role:'status',text:`已选 ${this.checked.size} 张`});
    const selectionActions=el('div',{class:'actions workspace-selection',hidden:!this.checked.size},[selectedCount,targets,button('移动所选卡片',this.safe(async()=>{
      const ids=[...this.checked].filter(id=>valid.has(id));if(!ids.length)throw Error('请先选择卡片。');
      if(this.workspace)await this.owner.api('workspaceWrite',{workspaceId:this.projectId,action:'move',expectedRevision:this.workspace.revision,topicId:targets.value,cardIds:ids});
      else await this.editTopics(row=>{row.items.assignments??={};row.items.topics??={};for(const id of ids)row.items.assignments[id]=targets.value||null;const target=topics.find(t=>t.id===targets.value);if(target)row.items.topics[target.id]={id:target.id,name:target.name,manual:true};});
      this.checked.clear();await this.refresh();
    })),button('所选加入现有 Deploy',this.safe(async()=>{
      const ids=[...this.checked].filter(id=>valid.has(id));if(!ids.length)throw Error('请先选择真实 Q/A；可取消勾选。');
      await this.owner.api('releaseWrite',{projectId:this.projectId,action:'tray',operation:'add',cardIds:ids});
      this.dialog.close();await this.owner.show({projectId:this.projectId,mode:'deploy'});
    }))]);root.append(selectionActions);
    for(const topic of groups) {
      const key=this.projectId+':'+topic.id,representative=docs.find(d=>(topic.representativeCardIds??[]).includes(d.cardId))??docs.find(d=>topic.cardIds.includes(d.cardId));
      const group=el('details',{class:'workspace-topic',open:this.expandedTopics.get(key)??false,'data-knowledge-topic':topic.id},[topicSummary({name:topic.name,count:topic.cardIds.filter(id=>valid.has(id)).length,manual:topic.manual,keywords:topic.keywords,representative:representative?.customTitle||representative?.question||''})]);
      group.addEventListener('toggle',()=>{if(group.isConnected)this.expandedTopics.set(key,group.open);});
      if(topic.id)group.append(el('p',{class:'muted',text:(topic.keywords??[]).join(' · ')}),button('修改主题名',this.safe(async()=>{
        const value=await ask('修改知识主题名',[{name:'name',label:'主题名称',value:topic.name}]);if(!value)return;
        if(this.workspace)await this.owner.api('workspaceWrite',{workspaceId:this.projectId,action:'topicRename',expectedRevision:this.workspace.revision,topicId:topic.id,name:value.name});
        else await this.editTopics(row=>{row.items.topics??={};row.items.topics[topic.id]={id:topic.id,name:value.name.slice(0,60),manual:true};row.items.assignments??={};for(const id of topic.cardIds)row.items.assignments[id]=topic.id;});
        await this.refresh();
      })));
      for(const id of topic.cardIds) {
        const d=docs.find(d=>d.cardId===id);if(!d)continue;
        const check=el('input',{type:'checkbox',checked:this.checked.has(id),'aria-label':'选择知识卡片 '+d.question.slice(0,80)});check.addEventListener('change',()=>{check.checked?this.checked.add(id):this.checked.delete(id);selectedCount.textContent=`已选 ${this.checked.size} 张`;selectionActions.hidden=!this.checked.size;});
        const tags=(this.run.cards[id]?.suggestedTags??[]).map(tag=>({tag,status:this.cardReviews?.[id]?.items?.[ENGINE_VERSION+':tag:'+this.run.cards[id].sourceHash+':'+tag.toLowerCase()]?.status})).filter(t=>t.status!=='rejected');
        group.append(el('article',{class:'workspace-question','data-knowledge-card':id},[check,el('div',{},[button(d.customTitle||d.question.slice(0,140)||'空问题',this.safe(()=>this.openCard(d)),'workspace-question-title'),el('small',{text:`${d.sourceMetadata.title}${topic.representativeCardIds?.includes(id)?' · 代表问题':''}`}),el('p',{class:'muted',text:tags.map(t=>(t.status==='accepted'?'已确认 · ':'候选 · ')+t.tag).join(' / ')})])]));
      }
      root.append(group);
    }
  }
  async mountReader(host,data) {
    await this.conversation.mountReader(host,data);
    let scopeId=this.readerScopeId??this.owner.projectId,run=await cacheGet('runs',scopeId);
    if(!run?.cards?.[data.card.id]&&scopeId!==this.owner.projectId){scopeId=this.owner.projectId;run=await cacheGet('runs',scopeId);}
    const card=run?.cards?.[data.card.id];if(!card||!host.isConnected)return;
    const source=await this.owner.api('knowledgeDocuments',{projectId:scopeId}),doc=source.documents.find(d=>d.cardId===data.card.id);if(!doc||!host.isConnected)return;
    let review=await cacheGet('reviews','card:'+doc.cardId)??{id:'card:'+doc.cardId,revision:0,items:{}};
    const section=el('details',{class:'qa-local-suggestions knowledge-reader','aria-label':'关键原文与智能标签'},[el('summary',{text:'关键原文与智能标签 · '+run.status})]);host.append(section);
    const stale=card.sourceHash!==doc.sourceHash;
    section.append(el('p',{class:'muted',text:stale?'来源或人工特征已变化；旧审核保留，请重新整理。':'候选原文摘录，保留假设与否定语境，请核对完整回答后审核。'}));
    const save=async(key,status,snapshot)=>{review=await updateReview('card:'+doc.cardId,review.revision,row=>{row.items[key]={status,snapshot,at:Date.now()};return row;});};
    const displayed=new Set();
    for(const tag of card.suggestedTags){
      const key=ENGINE_VERSION+':tag:'+card.sourceHash+':'+tag.toLowerCase(),item=review.items[key],row=el('div',{class:'actions'},[el('span',{text:tag})]),state=el('small',{text:item?.status==='accepted'?'已采用建议标签':item?.status==='rejected'?'已拒绝':'待审核'});
      if(item?.status==='rejected')continue;displayed.add(key);
      row.append(button('接受标签',this.safe(async()=>{await save(key,'accepted',{tag});state.textContent='已采用建议标签';}),'btn',{disabled:stale}),button('拒绝标签',this.safe(async()=>{await save(key,'rejected',{tag});state.textContent='已拒绝';}),'btn',{disabled:stale}),state);section.append(row);
    }
    for(const fragment of card.keypoints){
      const key=ENGINE_VERSION+':point:'+await digest([fragment.versionId,fragment.start,fragment.end,fragment.exactText]),item=review.items[key];
      if(item?.status==='rejected')continue;displayed.add(key);
      const valid=verifyFragment(fragment,doc.answerSources),state=el('small',{text:item?.status==='accepted'?'已采用摘录':item?.status==='rejected'?'已拒绝':'待审核'}),row=el('article',{'data-knowledge-evidence':fragment.start},[el('p',{text:fragment.exactText}),el('small',{text:fragment.context?'原章节：'+fragment.context:'来源：原回答版本'}),state]);
      row.append(button('查看原文证据',()=>{
        const source=doc.answerSources.find(s=>s.versionId===fragment.versionId&&s.messageId===fragment.messageId);if(!valid||!source){state.textContent='来源已变化，无法精确定位。';return;}
        const evidence=el('details',{open:true},[el('summary',{text:'原回答版本 · UTF-16 '+fragment.start+'–'+fragment.end}),el('pre',{class:'knowledge-source'},[source.text.slice(Math.max(0,fragment.start-180),fragment.start),el('mark',{text:source.text.slice(fragment.start,fragment.end)}),source.text.slice(fragment.end,Math.min(source.text.length,fragment.end+180))])]);row.append(evidence);evidence.scrollIntoView({block:'nearest'});
      }),button('接受摘录',this.safe(async()=>{await save(key,'accepted',fragment);state.textContent='已采用摘录';}),'btn',{disabled:stale||!valid}),button('拒绝摘录',this.safe(async()=>{await save(key,'rejected',fragment);state.textContent='已拒绝';}),'btn',{disabled:stale}));section.append(row);
    }
    const previous=Object.entries(review.items).filter(([key,value])=>value.status==='accepted'&&key.includes(':tag:')&&!key.includes(card.sourceHash));if(previous.length)section.append(el('p',{text:'保留的既有确认标签：'+previous.map(([,v])=>v.snapshot.tag).join(' · ')}));
    const history=Object.entries(review.items).filter(([key,value])=>!displayed.has(key)&&value.status==='accepted'&&key.includes(':point:'));
    if(history.length)section.append(el('details',{},[el('summary',{text:'保留的既有确认原文摘录'}),...history.map(([,v])=>el('article',{},[el('p',{text:v.snapshot.exactText}),el('small',{text:'历史原文版本：'+v.snapshot.versionId+'；可能与当前版本不同。'})]))]));
    const rejected=Object.values(review.items).filter(v=>v.status==='rejected');if(rejected.length)section.append(el('details',{},[el('summary',{text:'已拒绝记录 · '+rejected.length}),...rejected.map(v=>el('p',{text:v.snapshot.tag??v.snapshot.exactText}))]));
    for(const r of card.related){const target=source.documents.find(d=>d.cardId===r.cardId);if(target)section.append(button(r.reason+' · '+target.question.slice(0,90),this.safe(()=>this.owner.openIndexedCard({projectId:target.sourceProjectId,cardId:target.cardId}))));}
    if(!card.keypoints.length)section.append(el('p',{text:'未找到足够可靠的自然语言知识片段。完整回答保留。'}));
  }
}
