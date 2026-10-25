import { el, button, showDialog } from './dom.js';
import { ISSUE_STATES, DECISION_STATES } from '../domain/release-data.js';

const dialog = () => { let node=document.querySelector('#reflection-dialog');if(!node){node=el('dialog',{id:'reflection-dialog',class:'release-dialog'});document.body.append(node);}node.replaceChildren();node.oncancel=null;return node; };
const field = (form,label,input) => { form.append(el('label',{class:'field'},[el('span',{text:label}),input])); return input; };
const choose = (label,values,current,multiple=false) => {const node=el('select',{'aria-label':label,multiple},values.map(v=>el('option',{value:v.id??v,text:v.text??v.title??v,selected:multiple?(current??[]).includes(v.id):false})));if(!multiple)node.value=current??'';return node;};
export class ReflectionPanel {
  constructor(owner){this.owner=owner;}
  async data(){return this.owner.api('releaseInfo',{projectId:this.owner.projectId});}
  mount(host,detail){
    const r=detail.reflection??{issues:[],decisions:[],fragments:[]}, section=el('section',{class:'reflect-panel'},[el('h3',{text:'我的判断 · 用户填写'}),el('p',{class:'muted',text:'批注、决定和问题独立于历史 AI 回答；来源同步不会覆盖这些记录。'})]);
    section.append(el('div',{class:'actions'},[button('记录未解决问题',this.owner.safe(()=>this.issueDialog(detail.card.id))),button('记录决定',this.owner.safe(()=>this.decisionDialog(detail.card.id))),button('手动摘录',this.owner.safe(()=>this.fragmentDialog(detail)))]));
    for(const issue of r.issues)section.append(el('div',{class:'reflect-entry'},[el('strong',{text:issue.title}),el('small',{text:`用户问题 · ${issue.status}${issue.resolutionNote?' · '+issue.resolutionNote:''}`}),button('编辑问题',this.owner.safe(()=>this.issueDialog(detail.card.id,issue)))]));
    for(const decision of r.decisions)section.append(el('div',{class:'reflect-entry'},[el('p',{text:decision.text}),el('small',{text:`${decision.status} · ${decision.verifiedByUser?'用户已确认':'未确认'}${decision.supersededByDecisionId?' · 已记录取代关系':''}`}),button('编辑决定',this.owner.safe(()=>this.decisionDialog(detail.card.id,decision)))]));
    for(const fragment of r.fragments)section.append(el('div',{class:'reflect-entry'},[el('strong',{text:fragment.title}),el('small',{text:'用户摘录 · 保留来源版本'}),button('编辑摘录',this.owner.safe(()=>this.fragmentDialog(detail,fragment)))]));
    host.append(section);
  }
  async save(action,values,d){await this.owner.api('releaseWrite',{projectId:this.owner.projectId,action,...values});d.close();await this.owner.load();}
  async issueDialog(cardId=null,row=null){
    const data=await this.data(),d=dialog(),form=el('form',{class:'dialog-body'});form.append(el('h2',{text:row?'编辑未解决问题':'记录未解决问题'}));
    const source=field(form,'来源卡片（可独立记录）',choose('问题来源',[{id:'',text:'独立问题记录'},...data.cards.map(c=>({id:c.id,text:c.sourceTitle+' · '+c.title}))],row?.cardId??cardId??''));
    const title=field(form,'问题标题',el('input',{'aria-label':'问题标题',required:true,value:row?.title??''})), description=field(form,'问题描述',el('textarea',{'aria-label':'问题描述',rows:4,value:row?.description??''}));
    const status=field(form,'处理状态',choose('问题处理状态',ISSUE_STATES,row?.status??'OPEN')), resolution=field(form,'解决说明',el('textarea',{'aria-label':'解决说明',rows:3,value:row?.resolutionNote??''}));
    const resolved=field(form,'后续解决依据 Q/A',choose('解决依据',[{id:'',text:'未指定'},...data.cards.filter(c=>c.validity?.state==='ACTIVE').map(c=>({id:c.id,text:c.title}))],row?.resolvedByCardId??''));
    form.append(el('button',{type:'submit',class:'btn primary',text:'保存问题'}),button('取消',()=>d.close()));
    if(row)form.append(button('删除问题',this.owner.safe(()=>this.save('issue',{id:row.id,expectedRevision:row.revision,remove:true},d))));
    form.addEventListener('submit',this.owner.safe(async e=>{e.preventDefault();await this.save('issue',{id:row?.id,expectedRevision:row?.revision??0,cardId:source.value,title:title.value,description:description.value,status:status.value,resolutionNote:resolution.value,resolvedByCardId:resolved.value},d);}));d.append(form);showDialog(d);
  }
  async decisionDialog(cardId,row=null){
    const data=await this.data(),d=dialog(),form=el('form',{class:'dialog-body'});form.append(el('h2',{text:row?'编辑我的决定':'记录我的决定'}));
    const text=field(form,'决定内容（用户）',el('textarea',{'aria-label':'决定内容',required:true,rows:5,value:row?.text??''})),status=field(form,'决定状态',choose('决定状态',DECISION_STATES,row?.status??'候选结论'));
    const verified=el('input',{type:'checkbox',checked:row?.verifiedByUser??false,'aria-label':'用户明确确认决定'});form.append(el('label',{},[verified,'我已核对并确认这条决定（用户）']));
    const other=data.decisions.filter(r=>r.id!==row?.id),superseded=field(form,'本决定被哪条决定取代',choose('取代本决定的记录',[{id:'',text:'未被取代'},...other.map(r=>({id:r.id,text:r.status+' · '+r.text}))],row?.supersededByDecisionId??''));
    const conflicts=field(form,'冲突决定（可多选）',choose('冲突决定',other.map(r=>({id:r.id,text:r.text})),row?.conflictsWithDecisionIds??[],true));
    const evidence=field(form,'依据 Q/A（可多选）',choose('决定依据',data.cards.map(c=>({id:c.id,text:c.sourceTitle+' · '+c.title})),row?.evidenceCardIds??[cardId],true));
    form.append(el('button',{type:'submit',class:'btn primary',text:'保存决定'}),button('取消',()=>d.close()));if(row)form.append(button('删除决定',this.owner.safe(()=>this.save('decision',{id:row.id,expectedRevision:row.revision,remove:true},d))));
    form.addEventListener('submit',this.owner.safe(async e=>{e.preventDefault();await this.save('decision',{id:row?.id,expectedRevision:row?.revision??0,cardId,text:text.value,status:status.value,verifiedByUser:verified.checked,supersededByDecisionId:superseded.value,conflictsWithDecisionIds:[...conflicts.selectedOptions].map(o=>o.value),evidenceCardIds:[...evidence.selectedOptions].map(o=>o.value)},d);}));d.append(form);showDialog(d);
  }
  async fragmentDialog(detail,row=null){
    const d=dialog(),form=el('form',{class:'dialog-body'});form.append(el('h2',{text:row?'编辑手动摘录':'从来源正文手动摘录'}));
    const title=field(form,'摘录标题',el('input',{'aria-label':'摘录标题',required:true,value:row?.title??''})),note=field(form,'摘录批注（用户）',el('textarea',{'aria-label':'摘录批注',rows:3,value:row?.userNote??''}));
    let range=row?.sourceRange,sourceVersionId=row?.sourceVersionId,evidenceText=row?.text;
    if(!row){
      const versions=[{id:detail.card.questionVersionId,text:'完整问题'},...Object.values(detail.card.answerVersionIds??{}).map((id,i)=>({id,text:`有效回答正文 ${i+1}`}))].filter(v=>v.id);
      const select=field(form,'来源正文版本',choose('摘录来源版本',versions,versions[0]?.id)); const original=field(form,'来源正文（选中要摘录的文字）',el('textarea',{'aria-label':'摘录来源正文',readOnly:true,rows:8}));
      const excerpt=field(form,'选中的来源摘录',el('textarea',{'aria-label':'选中摘录',readOnly:true,rows:4}));
      const load=async()=>{const v=await this.owner.api('sourceVersion',{projectId:this.owner.projectId,cardId:detail.card.id,versionId:select.value});original.value=v.text;sourceVersionId=select.value;range=null;evidenceText='';excerpt.value='';};
      select.addEventListener('change',this.owner.safe(load));form.append(button('使用选中文字',()=>{const start=original.selectionStart,end=original.selectionEnd;range={start,end};evidenceText=original.value.slice(start,end);excerpt.value=evidenceText;}));await load();
    }else form.append(el('pre',{class:'source-excerpt',text:row.text}));
    form.append(el('button',{type:'submit',class:'btn primary',text:'保存摘录'}),button('取消',()=>d.close()));if(row)form.append(button('删除摘录',this.owner.safe(()=>this.save('fragment',{id:row.id,expectedRevision:row.revision,remove:true},d))));
    form.addEventListener('submit',this.owner.safe(async e=>{e.preventDefault();if(!row&&!evidenceText)throw new Error('请先在来源正文中选择文字，并点击“使用选中文字”。');await this.save('fragment',{id:row?.id,expectedRevision:row?.revision??0,cardId:detail.card.id,title:title.value,userNote:note.value,sourceVersionId,evidenceText,start:range?.start,end:range?.end},d);}));d.append(form);showDialog(d);
  }
}
