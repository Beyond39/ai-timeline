import { el, button, timeLabel, showDialog } from './dom.js';
import { configurePanelClose } from './panel-close.js';

export function snippetBody(snippet) {
  const node=el('p',{class:'opc-search-snippet'});let start=0;
  for(const range of snippet.ranges??[]){node.append(document.createTextNode(snippet.text.slice(start,range.start)),el('mark',{text:snippet.text.slice(range.start,range.end)}));start=range.end;}
  node.append(document.createTextNode(snippet.text.slice(start)));return node;
}
export class GlobalSearch {
  constructor(owner){this.owner=owner;this.epoch=0;}
  open(initial=''){if(this.dialog?.open)return Promise.resolve();if(this.opening)return this.opening;this.opening=this.show(initial).finally(()=>{this.opening=null;});return this.opening;}
  async show(initial='') {
    await this.owner.flushMetadata();
    const d=this.owner.horizontal.dialog();configurePanelClose(d,{guardEdits:false});this.dialog=d;d.classList.add('opc-library-dialog');d.replaceChildren();
    const query=el('input',{type:'search',value:initial,placeholder:'如：时间线缩放、IndexedDB、C++ 模板','aria-label':'全局检索关键词'});
    const results=el('div',{class:'opc-search-results'}),status=el('p',{class:'muted',role:'status',text:'检索本地所有项目的有效 Q/A、对话名称、标签和批注。点击结果打开完整问答。'});
    const info=await this.owner.api('conversationLibrary',{});
    const choose=(label,options)=>el('select',{'aria-label':label},options.map(([value,text])=>el('option',{value,text})));
    const type=choose('结果类型',[['all','全部'],['conversation','Conversation'],['qa','Q&A']]),source=choose('限定对话',[['','所有对话'],...info.conversations.filter(c=>!c.hidden&&!c.archived).map(c=>[c.id,c.displayTitle])]);
    const project=choose('限定项目',[['','所有项目'],...info.projects.map(p=>[p.id,p.name])]),group=choose('项目集合',[['','所有项目集合'],...info.groups.map(g=>[g,g])]);
    const from=el('input',{type:'date','aria-label':'搜索开始日期'}),to=el('input',{type:'date','aria-label':'搜索结束日期'}),favorite=el('input',{type:'checkbox','aria-label':'搜索仅收藏'}),sort=choose('搜索排序',[['relevance','相关度'],['time','最新时间']]);
    const filters=el('details',{},[el('summary',{text:'筛选'}),el('div',{class:'opc-library-filters'},[source,project,group,from,to,el('label',{},[favorite,'仅收藏']),sort])]);
    const form=el('form',{class:'opc-global-search-form'},[query,type,el('button',{type:'submit',class:'btn',text:'搜索'}),button('关闭',()=>d.close())]);
    d.append(el('h2',{text:'全局检索'}),form,filters,status,results);
    const run=async(offset=0)=>{
      clearTimeout(this.timer);const epoch=++this.epoch;if(!query.value.trim()){results.replaceChildren();status.textContent='输入关键词，搜索本地所有有效问答。';return;}
      status.textContent='检索本地索引…';
      const data=await this.owner.api('globalSearch',{query:query.value,type:type.value,conversationId:source.value,projectId:project.value,group:group.value,dateFrom:from.value,dateTo:to.value,favorite:favorite.checked,sort:sort.value,timeZone:this.owner.timeZone,offset});
      if(epoch!==this.epoch||!d.open)return;
      if(!offset)results.replaceChildren();results.querySelector('.opc-search-more')?.remove();status.textContent=`${data.total} 条结果 · 本地索引 ${data.indexedCards} 张有效 Q/A`;
      for(const row of data.results){const open=button(row.title,this.owner.safe(async()=>{d.close();await this.owner.openIndexedCard(row);}), 'opc-result-open');
        results.append(el('article',{class:'opc-search-result','data-search-card':row.cardId},[open,el('small',{text:`${row.type} · ${row.sourceTitle} · ${timeLabel(row.time)}`}),snippetBody(row.snippet),button('加入上下文托盘',this.owner.safe(async()=>{await this.owner.api('releaseWrite',{projectId:row.projectId,action:'tray',operation:'add',cardIds:[row.cardId]});status.textContent='已加入该项目的上下文托盘。';}))]));}
      if(data.nextOffset!=null)results.append(button('更多结果',this.owner.safe(()=>run(data.nextOffset)),'btn opc-search-more'));
    };
    const schedule=()=>{++this.epoch;clearTimeout(this.timer);this.timer=setTimeout(this.owner.safe(()=>run()),180);};
    query.addEventListener('input',schedule);for(const control of [type,source,project,group,from,to,favorite,sort])control.addEventListener('change',schedule);
    form.addEventListener('submit',this.owner.safe(async e=>{e.preventDefault();await run();}));d.onclose=()=>{++this.epoch;clearTimeout(this.timer);};showDialog(d);query.focus();if(initial)await run();
  }
}
