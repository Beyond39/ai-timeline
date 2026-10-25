import { el } from './dom.js';
import { previewPlacement } from '../domain/preview-placement.js';
import { PanelCloseButton, registerClosablePanel, releaseClosablePanel, requestPanelClose } from './panel-close.js';

// Shared plain-text projection of existing source bodies. It never sends data,
// runs an organizer, parses partial Markdown, or edits a source record.
export function cardPreviewContent(data) {
  const excerpt=(text,limit)=>{const chars=Array.from(String(text??''));return chars.slice(0,limit).join('')+(chars.length>limit?'…':'');};
  return [el('strong',{text:excerpt(data.metadata?.title||data.card.questionPreview||data.questionBody,90)}),
    el('small',{class:'muted',text:data.card.sourceTitle}),
    el('p',{'data-preview-question':true,text:'Q · '+excerpt(data.questionBody,200)}),
    el('p',{'data-preview-answer':true,text:'A · '+excerpt(data.answerBody,320)}),
    el('small',{class:'muted',text:'单击卡片查看完整 Q/A · Esc 关闭预览'})];
}

let nextPreviewId=0;
export class CardHoverPreview {
  constructor({load,allowed,onError,delay=300}) {
    Object.assign(this,{load,allowed,onError,delay});this.sequence=0;this.cache=new Map();
    this.portal=el('aside',{class:'card-hover-preview',role:'tooltip',id:'card-hover-preview-'+(++nextPreviewId),hidden:true});document.body.append(this.portal);
    this.onMotion=()=>this.moving();
    this.portal.addEventListener('pointerenter',()=>clearTimeout(this.leaveTimer));this.portal.addEventListener('pointerleave',()=>this.close());
    globalThis.addEventListener('scroll',this.onMotion,true);globalThis.addEventListener('resize',this.onMotion);
  }
  bind(node,card,projectId) {
    const enter=event=>{if(event.pointerType!=='touch')this.request(node,card,projectId);};
    const focus=event=>{if(event.target===node||event.target.closest('.compact-node-open'))this.request(node,card,projectId);};
    const leave=event=>{if(this.anchor===node){if(event?.relatedTarget&&this.portal.contains(event.relatedTarget))return;if(this.portal.hidden){this.close();return;}this.sequence++;clearTimeout(this.leaveTimer);this.leaveTimer=setTimeout(()=>this.close(),100);}};
    const blur=event=>{if(!node.contains(event.relatedTarget))leave();};
    const press=()=>this.close();
    for(const [event,fn]of [['pointerenter',enter],['pointerleave',leave],['focusin',focus],['focusout',blur],['pointerdown',press]])node.addEventListener(event,fn);
    return {dispose:()=>{if(this.anchor===node)this.close();for(const [event,fn]of [['pointerenter',enter],['pointerleave',leave],['focusin',focus],['focusout',blur],['pointerdown',press]])node.removeEventListener(event,fn);}};
  }
  request(node,card,projectId) {
    this.close();if(this.paused||Date.now()<(this.blockedUntil??0)||!this.allowed())return;
    const sequence=this.sequence;this.anchor=node;
    this.timer=setTimeout(async()=>{
      this.timer=null;
      try{
        const key=JSON.stringify([projectId,card.id,card.questionVersionId,card.answerVersionIds,card.metadata?.revision,card.updatedAt]);
        let data=this.cache.get(key);
        if(!data){const full=await this.load({projectId,cardId:card.id});data={card:{id:full.card.id,sourceTitle:full.card.sourceTitle,questionPreview:full.card.questionPreview},metadata:{title:full.metadata.title},questionBody:full.questionBody.slice(0,1000),answerBody:full.answerBody.slice(0,1500)};this.cache.set(key,data);if(this.cache.size>40)this.cache.delete(this.cache.keys().next().value);}
        if(sequence!==this.sequence||!node.isConnected||this.paused||!this.allowed())return;
        this.portal.replaceChildren(el('div',{class:'panel-close-bar panel-close-header'},[PanelCloseButton(()=>void requestPanelClose(this.portal),{title:'关闭预览（Esc）'})]),...cardPreviewContent(data));this.portal.hidden=false;
        registerClosablePanel(this.portal,{guardEdits:false,onClose:()=>this.close()});
        const viewport={width:document.documentElement.clientWidth,height:document.documentElement.clientHeight},avoid=[...document.querySelectorAll('.opc-canvas-node,button,input,select,textarea,summary,.opc-detail:not([hidden])')]
          .filter(control=>control!==node&&!node.contains(control)&&!this.portal.contains(control)).map(control=>control.getBoundingClientRect()).filter(rect=>rect.width>0&&rect.height>0);
        let position;
        for(const width of [340,280,220]){
          this.portal.style.width=Math.min(width,viewport.width-16)+'px';
          position=previewPlacement(node.getBoundingClientRect(),this.portal.getBoundingClientRect(),viewport,12,8,avoid);
          if(position)break;
        }
        if(!position){this.close();return;}
        this.portal.style.left=position.left+'px';this.portal.style.top=position.top+'px';
        node.setAttribute('aria-describedby',this.portal.id);
      }catch(error){if(sequence===this.sequence){this.close();this.onError?.(error.message);}}
    },this.delay);
  }
  close(){clearTimeout(this.timer);clearTimeout(this.leaveTimer);this.timer=null;this.sequence++;const anchor=this.anchor,restore=this.portal.contains(document.activeElement);releaseClosablePanel(this.portal);this.portal.hidden=true;anchor?.removeAttribute('aria-describedby');this.anchor=null;if(restore&&anchor?.isConnected){this.blockedUntil=Date.now()+this.delay;anchor.focus({preventScroll:true});}}
  pause(){this.paused=true;this.close();}
  resume(){this.paused=false;this.moving();}
  moving(){this.blockedUntil=Date.now()+this.delay;this.close();}
  dispose(){this.close();this.portal.remove();globalThis.removeEventListener('scroll',this.onMotion,true);globalThis.removeEventListener('resize',this.onMotion);this.cache.clear();}
}
