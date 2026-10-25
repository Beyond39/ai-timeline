import { el, button } from './dom.js';
import { featureSourceKey, FEATURE_VERSION } from '../domain/tag-suggestions.js';
export class TagSuggestionsPanel {
  constructor(owner){this.owner=owner;}
  mount(host,data){
    const owner=this.owner,projectId=owner.projectId,cardId=data.card.id,s=data.metadata.localSuggestion;
    const draftProjectId=data.card.projectId,draftKey='suggestion:'+cardId,draft=owner.drafts.get(draftProjectId,draftKey);
    const section=el('section',{class:'qa-local-suggestions','aria-label':'本地候选标签'},[el('h3',{text:'本地候选 · 待人工审核'}),el('p',{class:'muted',text:'TF-IDF / 中文 n-gram；关键词式标题，不是语义摘要。人工标题、标签和主题优先。'})]);host.append(section);
    const generate=button(s?'重新分析本卡':'生成本卡候选',owner.safe(async()=>{await owner.flushMetadata();generate.disabled=true;try{await owner.api('qaAnalyze',{projectId,cardIds:[cardId]});await owner.load();}finally{generate.disabled=false;}}));section.append(generate);
    if(!s){section.append(el('p',{text:'尚未分析；仅在本机运行。'}));return;}
    const stale=s.sourceKey!==featureSourceKey(data.card)||s.version!==FEATURE_VERSION;
    section.append(el('small',{text:`${s.status==='accepted'?'已采用':s.status==='rejected'?'已拒绝':s.status==='edited'?'已编辑，待采用':'待审核'} · 来源：${data.card.sourceTitle}${stale?' · 来源或算法已变化，请重新分析':''}`}));
    if(s.sourceMarkers?.length)section.append(el('p',{class:'muted',text:'原始导入问题中含 $app 标记；只在候选特征中排除此标记，完整原文保留。'}));
    const title=el('input',{value:draft?.title??s.title,'aria-label':'候选简洁标题',maxLength:80}),tags=el('input',{value:draft?.tags??s.tags.join('，'),'aria-label':'候选标签',placeholder:'最多5个标签，用逗号分隔'});
    section.append(el('label',{class:'field'},['候选简洁标题',title]),el('label',{class:'field'},['候选标签',tags]));
    if(s.topicCandidate)section.append(el('small',{text:'主题特征候选：'+s.topicCandidate+'（不会自动修改主题归属）'}));
    const status=el('p',{role:'status',text:draft?'已恢复本地候选草稿；请核对后保存或采用。':''}),controls=el('div',{class:'actions'});
    const remember=()=>{owner.drafts.set(draftProjectId,draftKey,{title:title.value,tags:tags.value,sourceKey:s.sourceKey});owner.drafts.flush();status.textContent='候选草稿已在本地保留，关闭后可继续编辑。';};for(const input of [title,tags])input.addEventListener('input',remember);
    const review=operation=>owner.safe(async()=>{await owner.flushMetadata();for(const b of controls.querySelectorAll('button'))b.disabled=true;try{await owner.api('qaReview',{projectId,cardId,operation,title:title.value,tags:tags.value.split(/[,，]/).map(t=>t.trim()).filter(Boolean),expectedRevision:data.metadata.revision??0});if(operation!=='clear')owner.drafts.remove(draftProjectId,draftKey);await owner.load();}catch(e){status.textContent=e.message+'；当前候选编辑仍保留。';for(const b of controls.querySelectorAll('button'))b.disabled=stale;throw e;}});
    controls.append(button('采用候选',review('accept'),'btn primary',{disabled:stale}),button('保存候选编辑',review('edit'),'btn',{disabled:stale}),button('拒绝候选',review('reject'),'btn',{disabled:stale}));
    if(data.metadata.autoTitle||data.metadata.autoTags?.length)controls.append(button('移除已采用的自动内容',review('clear')));
    section.append(controls,status,el('details',{},[el('summary',{text:'为什么选择这些词'}),...s.features.map(f=>el('p',{text:f.manualPriority?`${f.term} · 优先沿用你已有的标签。`:`${f.term} · TF-IDF ${f.score.toFixed(3)} · 加权词频 ${f.tf} · 出现于 ${f.df} 张 Q/A；问题权重高于回答。`}))]));
  }
}
