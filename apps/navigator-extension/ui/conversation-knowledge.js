import { el, button, ask, savedTime } from './dom.js';
import { digest } from '../domain/common.js';
import { orderedDocuments, stageCards, validateAIAnalysis, validateEvidence } from '../analysis/conversation-analysis.js';
import { analysisDiff } from '../analysis/analysis-revisions.js';
import { loadAnalysis, saveAnalysis, editAnalysis, restoreAnalysis, exportAnalyses, importAnalyses, journalAnalysisRun } from '../storage/conversation-analyses.js';
import { LocalAIClient } from '../analysis/ai-client.js';
const types={user_decision:'用户明确决定',intention:'用户意向',suggestion:'助手建议',verified_result:'用户报告已验证',hypothesis:'未验证假设',open_question:'未解决问题',action:'后续行动',conclusion:'阶段结论'};
const statuses={active:'当前有效',pending:'待核查',superseded:'已被替代'};
const sourceHash=docs=>digest(docs.map(d=>[d.cardId,d.sourceHash]));
function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=el('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export class ConversationKnowledge {
  constructor(parent){this.parent=parent;this.owner=parent.owner;this.host=el('section',{class:'conversation-knowledge','aria-label':'Conversation Knowledge'});this.client=new LocalAIClient();this.epoch=0;}
  safe(fn){return this.owner.safe(fn);}
  cancel(){this.epoch++;clearInterval(this.progressTimer);this.controller?.abort();if(this.requestId)this.client.cancel(this.requestId);this.requestId=null;this.worker?.terminate();this.rejectWorker?.(new DOMException('已取消','AbortError'));this.worker=null;this.rejectWorker=null;this.busy=false;}
  async setSource(source,conversationId=null){
    this.cancel();this.source=source;this.scopeId=source.projectId;const ids=[...new Set(source.documents.map(d=>d.conversationId))];
    this.conversationId=ids.includes(conversationId)?conversationId:ids.includes(this.conversationId)?this.conversationId:ids[0];await this.select(this.conversationId);
  }
  async select(id){this.cancel();const epoch=this.epoch;this.conversationId=id;this.record=null;this.message='';if(!id){this.docs=[];this.render();return;}
    this.docs=orderedDocuments(this.source.documents.filter(d=>d.conversationId===id));this.projectId=this.docs[0].sourceProjectId;this.hash=await sourceHash(this.docs);const record=await loadAnalysis(this.projectId,id);if(epoch!==this.epoch)return;this.record=record;this.render();if(!record)await this.offline();
  }
  workerAnalysis(docs){return new Promise((resolve,reject)=>{const worker=this.worker=new Worker(new URL('../analysis/knowledge-worker.js',import.meta.url),{type:'module'});this.rejectWorker=reject;const finish=(e,r)=>{worker.terminate();this.worker=null;this.rejectWorker=null;e?reject(e):resolve(r);};worker.onmessage=({data})=>finish(data.error?Error(data.error):null,data.result);worker.onerror=()=>finish(Error('本地分析 Worker 未能运行。'));worker.postMessage({action:'conversation',documents:docs});});}
  async currentDocs(){const source=await this.owner.api('knowledgeDocuments',{projectId:this.scopeId});return orderedDocuments(source.documents.filter(d=>d.conversationId===this.conversationId));}
  async offline(){
    if(this.busy||!this.docs?.length)return;const epoch=++this.epoch,hash=this.hash,docs=this.docs,base=this.record?.current?.versionId??null;this.busy=true;this.message='正在本机识别讨论阶段…';this.render();
    try{const candidate=await this.workerAnalysis(docs);if(epoch!==this.epoch)return;if(await sourceHash(await this.currentDocs())!==hash)throw Error('来源在分析期间发生变化，请重新打开；历史版本已保留。');if(epoch!==this.epoch)return;candidate.sourceHash=hash;candidate.run={provider:'offline',algorithmVersion:candidate.engineVersion,sourceHash:hash,usage:null,actualCostUSD:null,status:'completed',createdAt:new Date().toISOString()};this.record=await saveAnalysis(candidate,docs,{baseVersionId:base});this.message='本地分析已保存；无需 API。';}
    catch(e){if(e.name!=='AbortError')this.message=e.message;}finally{if(epoch===this.epoch){this.busy=false;this.render();}}
  }
  async connect(){
    // The loopback server explicitly grants this exact extension origin via
    // CORS. Host permissions are unnecessary for a normal CORS fetch.
    const values=await ask('连接本机 AI 代理',[{name:'token',label:'代理配对令牌',type:'password'}],`先按安装文档启动本机代理，并将 OPC_ALLOWED_ORIGINS 设为 ${location.origin}。API Key 仅放服务端环境变量；这里不接收 API Key。配对令牌仅在本页内存保存。`);if(!values)return;this.config=await this.client.connect(values.token.trim());this.message='本机代理已连接。';this.render();
  }
  async prepareAI(){
    if(this.busy)return;if(!this.config){await this.connect();if(!this.config)return;}
    const epoch=this.epoch;
    const values=await ask('AI 深度总结：范围与预算',[
      {name:'scope',label:'分析范围',options:[{value:this.conversationId,label:`当前 Conversation · ${this.docs.length} 轮 Q/A`}]},
      {name:'model',label:'结构化提取模型',options:this.config.models.map(m=>({value:m.id,label:m.label}))},
      {name:'maxInputTokens',label:'输入 Token 上限（保守估计）',value:'80000'},
      {name:'maxOutputTokens',label:'每次调用输出 Token 上限',value:'3500'},
      {name:'budgetUSD',label:'本任务最高估算预算（USD）',value:'0.15'}
    ],'仅在下一步确认后，当前对话的原始问题和回答才会通过本机代理发送给 OpenAI。长对话会显示分段调用总数；没有自动付费重试。',{confirmLabel:'查看估算'});
    if(!values||epoch!==this.epoch)return;
    const options={model:values.model,maxInputTokens:Number(values.maxInputTokens),maxOutputTokens:Number(values.maxOutputTokens),budgetUSD:Number(values.budgetUSD)},estimate=await this.client.estimate(this.docs,options);
    if(epoch!==this.epoch)return;
    const confirm=await ask('确认发送给 OpenAI',[],`${this.docs.length} 轮 Q/A；${new TextEncoder().encode(JSON.stringify(this.docs)).byteLength.toLocaleString()} 字节。计划 ${estimate.calls} 次调用，输入估计上界 ${estimate.inputTokenUpperBound.toLocaleString()} tokens，输出上限 ${estimate.outputTokenUpperBound.toLocaleString()} tokens。费用估计上界 $${estimate.estimatedMaximumUSD.toFixed(5)}，你的预算 $${options.budgetUSD}。价格核对日期 ${estimate.pricingAsOf}。这不是账单金额。取消可能无法撤回已产生的费用。`,{confirmLabel:'确认发送并分析'});
    if(confirm&&epoch===this.epoch)await this.ai(options,estimate);
  }
  async ai(options,estimate){
    if(this.busy)return;const epoch=++this.epoch,hash=this.hash,docs=this.docs,projectId=this.projectId,conversationId=this.conversationId,base=this.record?.current?.versionId??null;
    this.controller=new AbortController();const controller=this.controller,requestId=this.requestId=crypto.randomUUID();this.busy=true;this.message=`AI 分析中 · 最多 ${estimate.calls} 次调用。可取消，已有版本保留。`;this.render();
    let providerRun=null;
    const run=async()=>{
      const latest=await loadAnalysis(projectId,conversationId);if((latest?.current?.versionId??null)!==base)throw Error('其他页面已更新分析，请重新打开。');
      const result=await this.client.analyze(docs,options,requestId,controller.signal);providerRun=result.run;if(epoch!==this.epoch||controller.signal.aborted)return;
      if(await sourceHash(await this.currentDocs())!==hash)throw Error('AI 返回时原文已更新，未覆盖已有分析。');if(epoch!==this.epoch)return;
      const candidate=validateAIAnalysis(result.raw,docs);candidate.sourceHash=hash;candidate.run={...result.run,requestId,sourceHash:hash,cacheHit:result.cacheHit};
      const saved=await saveAnalysis(candidate,docs,{baseVersionId:base});if(epoch!==this.epoch)return;this.record=saved;this.message=result.cacheHit?'已复用相同 AI 结果缓存。':'AI 结果已保存；请核对候选知识与原文。';
    };
    let progressTimer;
    try{
      const journal=await journalAnalysisRun(projectId,conversationId,{id:requestId,requestId,provider:'openai',model:options.model,sourceHash:hash,status:'running',createdAt:new Date().toISOString(),estimatedMaximumUSD:estimate.estimatedMaximumUSD,actualCostUSD:null});if(epoch!==this.epoch)throw new DOMException('已取消','AbortError');this.record=journal;
      progressTimer=this.progressTimer=setInterval(()=>{this.client.progress(requestId).then(p=>{if(epoch===this.epoch&&p.total&&this.statusNode?.isConnected)this.statusNode.textContent=`AI 分析：已完成 ${p.completed} / ${p.total} 次调用，正在核对证据。`;}).catch(()=>{});},2500);
      if(navigator.locks)await navigator.locks.request('opc-ai:'+projectId+':'+conversationId,{ifAvailable:true},async lock=>{if(!lock)throw Error('此 Conversation 已在另一页面分析。');await run();});else await run();
    }
    catch(e){const failedRun={...providerRun,...e.run,id:requestId,requestId,sourceHash:hash,status:controller.signal.aborted?'cancelled':'failed',provider:'openai',model:options.model,actualCostUSD:null};const journal=await journalAnalysisRun(projectId,conversationId,failedRun).catch(()=>null);if(epoch===this.epoch){if(journal)this.record=journal;this.message=e.message;this.failedRun=failedRun;}}
    finally{clearInterval(progressTimer);if(epoch===this.epoch){this.busy=false;this.controller=null;this.requestId=null;this.render();}}
  }
  async edit(kind,row,field){
    const epoch=this.epoch,docs=await this.currentDocs();if(await sourceHash(docs)!==this.hash)throw Error('来源已变化，请重新打开后编辑。');
    let fields,value;
    if(field==='range'){const range=stageCards(row,this.docs);fields=[{name:'start',label:'起始轮次',value:String(range[0]?.ordinal)},{name:'end',label:'结束轮次',value:String(range.at(-1)?.ordinal)}];}
    else fields=[{name:'value',label:field==='status'?'状态':field==='type'?'知识类型':'内容',value:field==='themes'?row[field].join('，'):row[field],multiline:['summary','content'].includes(field),...(field==='status'?{options:Object.entries(statuses).map(([value,label])=>({value,label}))}:{}),...(field==='type'?{options:Object.entries(types).map(([value,label])=>({value,label}))}:{})}];
    const result=await ask('修改并保护此字段',fields,'保存后此字段受人工保护；其他字段仍可自动更新。');if(!result||epoch!==this.epoch)return;
    if(field==='range')value={startCardId:docs.find(d=>d.ordinal===Number(result.start))?.cardId,endCardId:docs.find(d=>d.ordinal===Number(result.end))?.cardId};else value=field==='themes'?result.value.split(/[，,]/u).map(x=>x.trim()).filter(Boolean):result.value;
    this.record=await editAnalysis(this.projectId,this.conversationId,this.record.revision,{kind,objectId:row.id,field,value},docs);this.render();
  }
  fieldActions(kind,row,fields){return el('div',{class:'actions ck-edit-actions'},fields.flatMap(field=>[button('编辑'+({title:'标题',summary:'摘要',range:'范围',themes:'主题',content:'内容',status:'状态',type:'类型'}[field]),this.safe(()=>this.edit(kind,row,field)),'btn small'),...(row.protections?.[field]?[button('解除'+({title:'标题',summary:'摘要',range:'范围',themes:'主题',content:'内容',status:'状态',type:'类型'}[field])+'保护',this.safe(async()=>{this.record=await editAnalysis(this.projectId,this.conversationId,this.record.revision,{kind,objectId:row.id,field,unlock:true},this.docs);this.render();}),'btn small')]:[])]));}
  async jump(stage){
    const ids=stageCards(stage,this.docs).map(d=>d.cardId),projectId=this.projectId;this.parent.dialog.close();await this.owner.openIndexedCard({projectId,cardId:stage.startCardId});if(this.owner.projectId!==projectId)return;await this.owner.navigate('timeline',stage.startCardId);for(const n of this.owner.host.querySelectorAll('[data-card-id]'))n.classList.toggle('knowledge-stage-range',ids.includes(n.dataset.cardId));
  }
  async showEvidence(ref){
    const docs=await this.currentDocs(),checked=validateEvidence(ref,docs);if(!checked.valid)throw Error('原文或引用范围已变化，旧证据不能精确定位；历史版本仍保留。');
    const source=docs.flatMap(d=>[d.questionSource,...d.answerSources]).find(s=>s.messageId===ref.messageId&&s.versionId===ref.versionId);
    this.parent.dialog.close();await this.owner.openIndexedCard({projectId:this.projectId,cardId:ref.cardId});const host=this.owner.detail?.querySelector('.opc-detail-content');if(!host||this.owner.projectId!==this.projectId)return;
    const box=el('details',{open:true,class:'ck-evidence','aria-label':'知识原文证据'},[el('summary',{text:`${ref.role==='user'?'用户':'助手'} · 消息 ${ref.messageId} · UTF-16 ${ref.start}–${ref.end}`}),el('pre',{class:'knowledge-source'},[source.text.slice(Math.max(0,ref.start-160),ref.start),el('mark',{text:ref.quote}),source.text.slice(ref.end,ref.end+160)])]);host.prepend(box);box.scrollIntoView({block:'nearest'});
  }
  evidenceLinks(refs){return el('div',{class:'actions ck-evidence-links'},(refs??[]).slice(0,8).map((e,i)=>button(`原文证据 ${i+1} · ${e.role==='user'?'用户':'助手'}${e.valid===false?' · 无效':''}`,this.safe(()=>this.showEvidence(e)),'btn small',{disabled:e.valid===false})));}
  render(){
    const host=this.host;host.replaceChildren(el('h3',{text:'Conversation Knowledge · 对话知识'}));const docs=this.source?.documents??[],groups=[...new Set(docs.map(d=>d.conversationId))];
    const select=el('select',{'aria-label':'知识 Conversation'},groups.map(id=>el('option',{value:id,text:docs.find(d=>d.conversationId===id)?.sourceMetadata.title??id})));select.value=this.conversationId??'';select.addEventListener('change',this.safe(()=>this.select(select.value)));host.append(select);
    const importer=el('input',{type:'file',accept:'.json',hidden:true,'aria-label':'导入知识备份'});importer.addEventListener('change',this.safe(async()=>{if(importer.files[0]){await importAnalyses(JSON.parse(await importer.files[0].text()));await this.select(this.conversationId);}}));
    this.statusNode=el('p',{role:'status','aria-live':'polite',text:this.message||'默认离线；AI 分析需要你逐次确认。'});
    host.append(el('div',{class:'actions'},[button('更新本地阶段',this.safe(()=>this.offline()),'btn',{disabled:this.busy||!this.docs?.length}),button('AI 深度总结',this.safe(()=>this.prepareAI()),'btn primary',{disabled:this.busy||!this.docs?.length}),button(this.config?'重新连接 AI 代理':'连接 AI 代理',this.safe(()=>this.connect())),button('取消分析',()=>{this.cancel();this.message='已取消，已有版本保留；已发出的调用可能产生费用。';this.render();},'btn',{disabled:!this.busy}),button('导出知识备份',this.safe(async()=>download(await exportAnalyses(),'OPC-knowledge-backup.json'))),button('导入知识备份',()=>importer.click()),importer]),this.statusNode);
    const a=this.record?.current;if(!a)return;
    host.append(el('p',{class:'muted',text:`${a.mode==='ai'?'AI 增强':'Offline'} · ${a.engineVersion} · ${savedTime(a.createdAt)} · 版本 ${this.record.versions.length} · ${a.sourceHash===this.hash?'来源一致':'来源已更新，旧证据待复核'}`}));
    if(a.run?.usage)host.append(el('p',{class:'muted',text:`实际 Token：输入 ${a.run.usage.input_tokens} / 输出 ${a.run.usage.output_tokens}。按用量估计 $${a.run.estimatedCostFromUsageUSD?.toFixed(5)??'未知'}；实际账单金额未知。`}));
    const overview=el('article',{class:'ck-overview'},[el('h3',{text:a.overview.title}),el('p',{text:a.overview.summary}),el('p',{class:'ck-themes',text:a.overview.themes.join(' · ')}),this.evidenceLinks(a.overview.evidence),this.fieldActions('overview',a.overview,['title','summary','themes'])]);host.append(overview);
    for(const type of ['user_decision','open_question','action']){const rows=a.items.filter(k=>k.type===type&&k.status!=='superseded');if(rows.length)host.append(el('div',{class:'ck-outcomes'},[el('strong',{text:types[type]}),...rows.slice(-5).map(k=>el('p',{text:(k.reviewStatus==='needs_review'?'待复核 · ':'')+k.content})),...(rows.length>5?[el('small',{text:`另有 ${rows.length-5} 项，请在对应阶段展开查看。`})]:[])]));}
    const nav=el('nav',{class:'ck-stage-nav','aria-label':'阶段导航'});a.stages.forEach((s,i)=>nav.append(button(`${i+1}. ${s.title}`,()=>{const target=host.querySelector(`[data-stage-index="${i}"]`);if(target){target.open=true;target.scrollIntoView({block:'nearest'});}},'btn small')));host.append(nav);
    a.stages.forEach((s,i)=>{const range=stageCards(s,this.docs),box=el('details',{class:'ck-stage',open:i===0,'data-stage-index':i,'data-stage-id':s.id},[el('summary',{text:`${i+1}. ${s.title} · Q/A ${range[0]?.ordinal??'?'}–${range.at(-1)?.ordinal??'?'}`}),el('p',{text:s.summary}),el('small',{class:'muted',text:`转折：${{topic_shift:'话题变化',progress_shift:'解决进程变化',continuation:'延续',single_stage:'单一阶段'}[s.reason]??s.reason}`}),button('在时间线查看阶段',this.safe(()=>this.jump(s))),this.fieldActions('stage',s,['title','summary','range']),this.evidenceLinks(s.evidence)]);
      const list=el('div',{class:'ck-items'}),stageItems=a.items.filter(k=>k.stageId===s.id);let limit=30;
      const draw=()=>{list.replaceChildren(...stageItems.slice(0,limit).map(k=>el('article',{class:'ck-item','data-knowledge-item':k.id},[el('strong',{text:`${types[k.type]} · ${statuses[k.status]}${k.humanConfirmed?' · 人工确认':k.origin==='openai'?' · AI 候选，待核查':''}`}),el('p',{text:k.content}),this.evidenceLinks(k.evidence),this.fieldActions('item',k,['content','status','type'])])));if(limit<stageItems.length)list.append(button(`显示更多知识（剩余 ${stageItems.length-limit}）`,()=>{limit+=30;draw();}));};draw();box.append(list);host.append(box);});
    if(a.conflicts?.length||a.retainedManual?.length||this.record.importedManual?.length)host.append(el('details',{class:'ck-conflicts'},[el('summary',{text:`待复核与保留人工内容 · ${a.conflicts.length}`}),...(a.retainedManual??[]).map(r=>el('article',{},[el('strong',{text:r.object.title??types[r.object.type]??'人工修订'}),el('p',{text:r.object.summary??r.object.content??'已保留人工字段，可复制到合适的新阶段。'})])),...(this.record.importedManual??[]).map(r=>el('p',{text:r.overview?.summary??'导入的人工版本已保留'})),...a.conflicts.map(c=>el('p',{text:({manual_mapping:'人工修改无法可靠对应新阶段，已保留旧内容，请核对后手动安排。',stale_locked_range:'锁定的原文范围已变化，请核对。',source_changed:'来源已更新，历史证据需要重新核对。',invalid_evidence:'知识条目有未通过校验的证据，请核对原文。',stage_evidence:'阶段摘要的证据不完整，仍待核查。',overview_evidence:'整体摘要的证据不完整，仍待核查。'}[c.kind]??'分析存在待复核内容。')}))]));
    const history=el('details',{class:'ck-history'},[el('summary',{text:`分析版本与主要差异 · ${this.record.versions.length} · 人工修订 ${this.record.revisions.length}`})]);
    for(const r of (this.record.runs??[]).slice(-8).reverse())history.append(el('p',{class:'muted',text:`任务 ${r.provider} / ${r.model??r.algorithmVersion} · ${r.status==='running'&&!this.busy?'上次任务未完成，未自动重试':r.status} · ${savedTime(r.createdAt)}${r.status==='cancelled'||r.status==='failed'?' · 可能已产生费用，实际金额未知':''}`}));
    for(const v of [...this.record.versions].reverse().slice(0,this.historyLimit??30)){const diff=analysisDiff(v,a);history.append(el('article',{},[el('strong',{text:`${savedTime(v.createdAt)} · ${v.mode} · ${v.versionId.slice(0,8)}`}),el('p',{text:v.overview.summary}),el('small',{text:`阶段 ${diff.stages.join(' → ')}，知识 ${diff.items.join(' → ')}；摘要${diff.summary?'有变化':'一致'}`} ),button('恢复此版本',this.safe(async()=>{const current=await this.currentDocs();this.record=await restoreAnalysis(this.projectId,this.conversationId,this.record.revision,v.versionId,current,await sourceHash(current));this.render();}))]));}if(this.record.versions.length>(this.historyLimit??30))history.append(button('显示更多历史版本',()=>{this.historyLimit=(this.historyLimit??30)+30;this.render();this.host.querySelector('.ck-history').open=true;}));host.append(history);
  }
  async mountReader(host,data){
    const record=await loadAnalysis(data.card.projectId,data.card.conversationId);if(!host.isConnected||!record?.current)return;
    const stage=record.current.stages.find(s=>s.cardIds?.includes(data.card.id));
    const target=stage??record.current.stages.find(s=>s.startCardId===data.card.id||s.endCardId===data.card.id);if(!target)return;
    host.prepend(el('div',{class:'ck-reader-stage'},[el('strong',{text:'所属讨论阶段：'+target.title}),button('查看对话知识与阶段',this.safe(async()=>{await this.parent.open(data.card.projectId);await this.select(data.card.conversationId);}))]));
  }
}
