import { el, button, timeLabel } from './dom.js';
import { defaultTrackPreferences, horizontalLayout } from '../domain/timeline-tracks.js';

const palette=['#547899','#6b8d72','#a27855','#8b739c','#518b91','#9a6675'];
const name=c=>c.metadata.title||c.questionPreview;
export class HorizontalTimeline {
  constructor(owner){this.owner=owner;}
  render(host,data){
    this.observer?.disconnect();this.host=host;this.data=data;host.replaceChildren();
    const owner=this.owner;this.preferences=owner.trackPreferences??defaultTrackPreferences(data);owner.trackPreferences=this.preferences;
    const width=Math.max(240,host.clientWidth-2),pref=this.preferences;
    // Upgrade only view preferences. Earlier fixed month/day scales are not a
    // meaningful zoom preference in this new, range-based single axis.
    if(pref.axisVersion!==1){pref.axisVersion=1;pref.axisFit=true;pref.axisSpanMs=0;pref.scrollLeft=0;}
    if(pref.axisFit)pref.axisSpanMs=0;
    this.layout=horizontalLayout(data,pref,width);const layout=this.layout;
    pref.axisSpanMs=layout.visibleSpan;
    const controls=el('div',{class:'ht-controls'},[
      button('选择来源',owner.safe(()=>this.trackDialog(data))),
      button('−',owner.safe(()=>this.zoom(1.5)),'btn',{'aria-label':'时间缩小'}),
      button('＋',owner.safe(()=>this.zoom(1/1.5)),'btn',{'aria-label':'时间放大'}),
      button('适配全部',owner.safe(()=>this.fit()),'btn',{'aria-label':'适配全部'}),
      button('定位最新',()=>{if(layout.latest)this.locate(layout.latest.id);}),
      el('small',{text:`${layout.cards.length} 轮 Q/A · ${layout.tracks.length} 个来源 / 主题`})]);host.append(controls);
    const legend=el('div',{class:'ht-legend'});layout.tracks.forEach((t,i)=>legend.append(el('span',{style:`--source-color:${palette[i%palette.length]}`,text:t.name,title:t.name})));host.append(legend);
    this.scroll=el('div',{class:'ht-scroll',tabindex:0,'aria-label':'单轴时间线：滚轮或左右键平移，拖动空白区域；使用工具栏缩放'});
    const board=el('div',{class:'ht-board',style:`width:${layout.width}px`}),ticks=el('div',{class:'ht-ticks'}),axis=el('div',{class:'ht-axis-line','aria-hidden':'true'});
    const start=Math.ceil(layout.min/layout.tickStep)*layout.tickStep;
    for(let t=start,n=0;t<=layout.max&&n<2000;t+=layout.tickStep,n++)ticks.append(el('time',{style:`left:${layout.position(t)}px`,text:this.date(t,layout.tickStep<86400000)}));
    board.append(ticks,axis);
    const memberships=new Map();for(const m of data.memberships)if(!memberships.has(m.cardId)&&layout.tracks.some(t=>t.id===m.timelineId))memberships.set(m.cardId,m.timelineId);
    const color=c=>palette[Math.max(0,layout.tracks.findIndex(t=>t.id===memberships.get(c.id)))%palette.length];
    for(const c of layout.known)board.append(el('i',{class:'ht-evidence-dot','data-time':c.questionTime.value,style:`left:${layout.position(Date.parse(c.questionTime.value))}px;--source-color:${color(c)}`}));
    for(const point of layout.points){
      if(point.aggregate){const b=button(String(point.cards.length),owner.safe(()=>this.clusterDialog(point.cards)),'ht-density',{'aria-label':`${point.cards.length} 轮密集问答，展开选择`,style:`left:${point.x}px`});board.append(b);}
      else {const c=point.cards[0],node=button('',owner.safe(e=>{
        if(e.ctrlKey||e.metaKey||e.shiftKey){this.toggleChecked(c.id);return;}return owner.openCard(c.id);
      }),`ht-point ${owner.selected===c.id?'selected':''} ${owner.checked.has(c.id)?'checked':''}`,{'data-card-id':c.id,'aria-label':`阅读 ${name(c)}`,title:`${name(c)}\n${c.sourceTitle} · ${timeLabel(c.questionTime)}`,style:`left:${point.x}px;--source-color:${color(c)}`});
      node.append(el('span',{class:'ht-point-preview',text:name(c)}));board.append(node);}
    }
    if(!layout.known.length)board.append(el('div',{class:'ht-empty',text:layout.cards.length?'原始时间未知，请在下方选择问答。':'选择来源会话，沿时间轴浏览完整问答。'}));
    this.scroll.append(board);host.append(this.scroll);
    this.scroll.style.height=`${Math.max(230,document.documentElement.clientHeight-Math.max(140,this.scroll.getBoundingClientRect().top)-85)}px`;
    this.range=el('time',{class:'ht-visible-range'});this.navigator=el('input',{type:'range',min:0,max:1000,value:0,'aria-label':'时间概览：移动可视窗口'});
    const footer=el('div',{class:'ht-footer'},[el('small',{text:'滚轮 / 拖动平移 · Ctrl / Shift 点击多选'}),this.range]);host.append(footer,el('div',{class:'ht-overview'},[el('small',{text:layout.latest?this.date(layout.first):'时间未知'}),this.navigator,el('small',{text:layout.latest?this.date(layout.last):''})]));
    this.scroll.scrollLeft=pref.scrollLeft;
    const update=()=>{const left=this.scroll.scrollLeft,maxLeft=this.scroll.scrollWidth-this.scroll.clientWidth;pref.scrollLeft=left;this.navigator.disabled=maxLeft<1;this.navigator.value=maxLeft?left/maxLeft*1000:0;this.range.textContent=layout.latest?`${this.date(Math.max(layout.first,layout.min+(left-24)/layout.pxPerMs))} — ${this.date(Math.min(layout.last,layout.min+(left+this.scroll.clientWidth-24)/layout.pxPerMs))}`:'原始时间未知';};
    update();this.scroll.addEventListener('scroll',()=>{update();this.scheduleSave();},{passive:true});
    this.navigator.addEventListener('input',()=>{this.scroll.scrollLeft=(this.scroll.scrollWidth-this.scroll.clientWidth)*Number(this.navigator.value)/1000;});
    this.bindPan();
    if(layout.unknown.length){const unknown=el('details',{class:'ht-unknown'},[el('summary',{text:`时间未知 · ${layout.unknown.length} 轮（不会用导入时间代替）`})]);for(const c of layout.unknown)unknown.append(button(name(c),owner.safe(()=>owner.openCard(c.id))));host.append(unknown);}
    if(owner.filters.query){const results=el('details',{open:true,class:'ht-results'},[el('summary',{text:`搜索结果 · ${data.total} 张（按相关性）`})]);for(const c of data.cards.slice(0,40))results.append(button(`${c.sourceTitle} · ${name(c)}`,owner.safe(()=>owner.locate(c.id))));host.prepend(results);}
    this.observer=new ResizeObserver(()=>{if(!this.scroll?.isConnected)return;if(Math.abs(host.clientWidth-2-width)>2){this.capture();this.render(host,data);}});this.observer.observe(host);
    if(!data.preferences||data.preferences.axisVersion!==1)this.scheduleSave();
  }
  date(t,clock=true){return new Date(t).toLocaleString('zh-CN',{timeZone:this.owner.timeZone,month:'2-digit',day:'2-digit',...(clock?{hour:'2-digit',minute:'2-digit'}:{})});}
  bindPan(){
    const scroll=this.scroll;
    scroll.addEventListener('wheel',e=>{
      if(e.ctrlKey||e.metaKey)return;const factor=e.deltaMode===1?16:e.deltaMode===2?scroll.clientWidth:1;
      const delta=(Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY)*factor,left=scroll.scrollLeft;
      scroll.scrollLeft+=delta;if(Math.abs(scroll.scrollLeft-left)>.1)e.preventDefault();
    },{passive:false});
    scroll.addEventListener('pointerdown',e=>{
      if(e.button!==0||e.target.closest('button'))return;const x=e.clientX,left=scroll.scrollLeft;scroll.setPointerCapture(e.pointerId);scroll.classList.add('panning');
      const move=e=>{scroll.scrollLeft=left+x-e.clientX;},stop=()=>{scroll.classList.remove('panning');scroll.removeEventListener('pointermove',move);scroll.removeEventListener('pointerup',stop);scroll.removeEventListener('pointercancel',stop);this.scheduleSave();};
      scroll.addEventListener('pointermove',move);scroll.addEventListener('pointerup',stop);scroll.addEventListener('pointercancel',stop);
    });
    scroll.addEventListener('keydown',e=>{if(e.target!==scroll||e.ctrlKey||e.metaKey)return;if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();scroll.scrollLeft=e.key==='Home'?0:e.key==='End'?scroll.scrollWidth:scroll.scrollLeft+(e.key==='ArrowLeft'?-120:120);}});
  }
  toggleChecked(id){const set=this.owner.checked;set.has(id)?set.delete(id):set.add(id);this.owner.bulkCount.textContent=`已选 ${set.size} 张`;this.owner.bulkCount.parentElement.hidden=!set.size;this.scroll.querySelector(`[data-card-id="${CSS.escape(id)}"]`)?.classList.toggle('checked',set.has(id));}
  async zoom(factor){const old=this.layout,centerTime=old.min+(this.scroll.scrollLeft+this.scroll.clientWidth/2-24)/old.pxPerMs;this.preferences.axisFit=false;this.preferences.axisSpanMs=Math.max(1000,Math.min(old.fitSpan*8,old.visibleSpan*factor));const next=horizontalLayout(this.data,this.preferences,this.host.clientWidth-2);this.preferences.scrollLeft=Math.max(0,next.position(centerTime)-this.scroll.clientWidth/2);this.render(this.host,this.data);await this.save();}
  async fit(){this.preferences.axisFit=true;this.preferences.scrollLeft=0;this.render(this.host,this.data);await this.save();}
  locate(id){const c=this.layout.known.find(c=>c.id===id);if(c)this.scroll.scrollLeft=this.layout.position(Date.parse(c.questionTime.value))-this.scroll.clientWidth/2;this.owner.safe(()=>this.owner.openCard(id))();}
  dialog(){let d=document.querySelector('#track-dialog');if(!d){d=el('dialog',{id:'track-dialog',class:'release-dialog'});document.body.append(d);}return d;}
  async clusterDialog(cards){const d=this.dialog();d.replaceChildren(el('h2',{text:`密集时间段 · ${cards.length} 轮 Q/A`}),button('放大此时间段',this.owner.safe(async()=>{const times=cards.map(c=>Date.parse(c.questionTime.value)),span=Math.max(60000,Math.max(...times)-Math.min(...times));this.preferences.axisFit=false;this.preferences.axisSpanMs=span*1.3;const next=horizontalLayout(this.data,this.preferences,this.host.clientWidth-2);this.preferences.scrollLeft=next.position((Math.min(...times)+Math.max(...times))/2)-this.scroll.clientWidth/2;d.close();this.render(this.host,this.data);await this.save();})));
    for(const c of cards)d.append(el('div',{class:'ht-cluster-item'},[button(name(c),this.owner.safe(async()=>{d.close();await this.owner.openCard(c.id);})),el('small',{text:timeLabel(c.questionTime)}),button(this.owner.checked.has(c.id)?'取消选择':'选择',e=>{this.toggleChecked(c.id);e.target.textContent=this.owner.checked.has(c.id)?'取消选择':'选择';}),button('加入托盘',this.owner.safe(()=>this.owner.addToTray([c.id])))]));d.append(button('关闭',()=>d.close()));d.showModal();}
  async trackDialog(data){const d=this.dialog(),selected=new Set(this.preferences.selectedTimelineIds);d.replaceChildren(el('h2',{text:'选择来源或主题 · 合并到同一时间轴'}));
    for(const t of data.timelines.filter(t=>!t.hidden&&!t.archived)){const input=el('input',{type:'checkbox',value:t.id,checked:selected.has(t.id),'aria-label':`来源 ${t.name}`});input.addEventListener('change',()=>input.checked?selected.add(t.id):selected.delete(t.id));d.append(el('label',{class:'track-choice'},[input,`${t.kind==='source'?'来源':'主题'} · ${t.name}`]));}
    d.append(button('保存选择',this.owner.safe(async()=>{Object.assign(this.preferences,{initialNoActivity:false,selectedTimelineIds:[...selected],trackOrder:[...selected],axisFit:true,scrollLeft:0});d.close();this.render(this.host,data);await this.save();}),'btn primary'),button('取消',()=>d.close()));d.showModal();}
  capture(){if(this.skipCapture){this.skipCapture=false;return;}if(this.scroll?.isConnected)this.preferences.scrollLeft=this.scroll.scrollLeft;}
  scheduleSave(){if(this.preferences.initialNoActivity)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.owner.safe(()=>this.save())(),350);}
  async save(){clearTimeout(this.timer);this.timer=null;if(!this.preferences)return;const value={...this.preferences},projectId=this.owner.projectId,preference=this.preferences;this.queue=(this.queue??Promise.resolve()).catch(()=>{}).then(async()=>{const saved=await this.owner.api('releaseWrite',{projectId,action:'timelinePreferences',...value,expectedRevision:preference.revision??0});preference.revision=saved.revision;});await this.queue;}
  async flush(){try{if(this.timer)await this.save();else await this.queue;}catch(e){this.owner.onError?.(e.message);}}
}
