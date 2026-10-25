// Shared close chrome and one Escape coordinator per document. No global DOM
// observer or prototype patching: observers exist only while a dialog is open.
const documents=new WeakMap(),states=new WeakMap();
const closingText=/^(关闭|关闭弹窗|关闭预览|关闭 Workspace|收起面板)$/;
const valueOf=node=>node.type==='checkbox'||node.type==='radio'?node.checked:node.multiple?[...node.selectedOptions].map(o=>o.value).join('\0'):node.value;
const editable=node=>node.matches?.('input,textarea,select')&&!node.disabled&&!node.readOnly&&!['search','file','range','button','submit','hidden'].includes(node.type)&&!node.closest('[data-close-ignore-edits]');
const controls=node=>[...node.querySelectorAll('input,textarea,select')].filter(editable);

export function PanelCloseButton(onClose,{document=globalThis.document,title='关闭（Esc）',className=''}={}){
  const button=document.createElement('button');button.type='button';button.className=`btn panel-close ${className}`.trim();button.textContent='×';button.setAttribute('aria-label','关闭');button.title=title;
  button.addEventListener('click',event=>{event.preventDefault();onClose(event);});return button;
}
function environment(doc){
  if(documents.has(doc))return documents.get(doc);
  const env={layers:[],observers:0,installs:1};documents.set(doc,env);
  doc.addEventListener('beforetoggle',event=>{if(event.target.tagName==='DIALOG'&&event.newState==='open'&&!states.get(event.target)?.opening)openDialog(event.target);},true);
  doc.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||event.defaultPrevented||event.isComposing)return;
    const top=topState(doc);if(!top)return;
    event.preventDefault();event.stopImmediatePropagation();void requestPanelClose(top.node);
  },true);
  return env;
}
export function installCloseInteractions(doc=globalThis.document){if(doc?.addEventListener)environment(doc);}
function active(state){return state.node.isConnected&&(state.dialog?state.node.open:state.options.isActive?.()??!state.node.hidden);}
function topState(doc){
  const env=environment(doc);env.layers=env.layers.filter(active);
  // Native modal dialogs are always above non-modal panels, regardless of when
  // an async Reader/tooltip finishes loading underneath them.
  return env.layers.filter(s=>s.dialog).at(-1)??env.layers.at(-1);
}
function activate(state){const env=environment(state.node.ownerDocument);env.layers=env.layers.filter(s=>s!==state&&active(s));env.layers.push(state);}
function deactivate(state){const env=environment(state.node.ownerDocument);env.layers=env.layers.filter(s=>s!==state);if(state.observer){state.observer.disconnect();state.observer=null;env.observers--;}state.baseline.clear();state.touched.clear();state.pending=null;}
function stateFor(node){
  let state=states.get(node);if(state)return state;
  state={node,dialog:node.tagName==='DIALOG',options:{},baseline:new Map(),touched:new Set(),pending:null};states.set(node,state);environment(node.ownerDocument);
  if(state.dialog){
    const changed=event=>{if(editable(event.target)){if(!state.baseline.has(event.target))state.baseline.set(event.target,event.target.defaultValue??'');state.touched.add(event.target);}};node.addEventListener('input',changed);node.addEventListener('change',changed);
    node.addEventListener('cancel',event=>{if(state.dispatching)return;event.preventDefault();event.stopImmediatePropagation();void requestPanelClose(node);},true);
    node.addEventListener('close',()=>{if(node.open)return;deactivate(state);state.options.onClosed?.();if(state.returnFocus?.isConnected&&!state.returnFocus.closest('[hidden]'))state.returnFocus.focus({preventScroll:true});});
  }
  return state;
}
export function configurePanelClose(node,options={}){const state=stateFor(node);Object.assign(state.options,options);return state;}
export function resetDialogClose(node,options={}){
  const state=stateFor(node);state.options=options;state.legacy=null;state.baseline.clear();state.touched.clear();
  node.oncancel=null;node.onclose=null;node.onkeydown=null;
  return state;
}
export function markPanelSaved(node){const state=states.get(node);if(state){state.baseline=new Map(controls(node).map(c=>[c,valueOf(c)]));state.touched.clear();}}
export function showPanelDialog(node){
  if(node.open){chrome(stateFor(node));return;}
  const state=stateFor(node);state.opening=true;
  try{openDialog(node);node.showModal();}catch(error){deactivate(state);throw error;}finally{state.opening=false;}
}
function chrome(state){
  const {node}=state,doc=node.ownerDocument;
  for(const child of [...state.baseline.keys()])if(!node.contains(child)){state.baseline.delete(child);state.touched.delete(child);}
  for(const control of controls(node))if(!state.baseline.has(control)||!state.touched.has(control))state.baseline.set(control,valueOf(control));
  const old=[...node.querySelectorAll('button')].filter(b=>b.closest('dialog')===node&&!b.classList.contains('panel-close')&&closingText.test(b.textContent.trim()));
  const legacy=old.find(b=>!b.hidden);if(legacy)state.legacy=legacy;
  for(const button of old)if(!button.hidden)button.hidden=true;
  let header=[...node.children].find(n=>n.matches('.dialog-header,.settings-heading,.panel-close-bar'));
  if(!header){header=doc.createElement('div');header.className='panel-close-bar';const heading=[...node.children].find(n=>n.tagName==='H2');if(heading)header.append(heading);node.prepend(header);}
  header.classList.add('panel-close-header');
  if(!state.button||!node.contains(state.button)){state.button=PanelCloseButton(()=>void requestPanelClose(node),{document:doc});header.append(state.button);}
  else if(state.button.parentElement!==header)header.append(state.button);
  node.classList.add('has-panel-close');
}
function openDialog(node){
  const state=stateFor(node);state.returnFocus=node.ownerDocument.activeElement;state.baseline.clear();state.touched.clear();state.legacy=null;
  chrome(state);activate(state);
  if(!state.observer){state.observer=new MutationObserver(()=>chrome(state));state.observer.observe(node,{childList:true,subtree:true});environment(node.ownerDocument).observers++;}
}
export function registerClosablePanel(node,options){const state=configurePanelClose(node,options);activate(state);return()=>deactivate(state);}
export function releaseClosablePanel(node){const state=states.get(node);if(state)deactivate(state);}
function dirty(state){if(state.options.guardEdits===false)return false;if(state.options.isDirty)return state.options.isDirty();return controls(state.node).some(c=>state.touched.has(c)&&state.baseline.has(c)&&valueOf(c)!==state.baseline.get(c));}
async function confirmDiscard(state){
  const doc=state.node.ownerDocument,dialog=doc.createElement('dialog');dialog.className='release-dialog panel-unsaved-confirm';dialog.setAttribute('aria-label','未保存修改');
  const heading=doc.createElement('h2');heading.textContent='还有未保存的修改';const text=doc.createElement('p');text.textContent='可以继续编辑并使用原界面的保存操作，或明确放弃未保存的输入后关闭。';
  const actions=doc.createElement('div');actions.className='actions';const keep=doc.createElement('button'),discard=doc.createElement('button');keep.type=discard.type='button';keep.className='btn primary';discard.className='btn danger';keep.textContent='继续编辑';discard.textContent='放弃修改并关闭';actions.append(keep,discard);dialog.append(heading,text,actions);doc.body.append(dialog);
  return new Promise(resolve=>{let settled=false;const finish=value=>{if(settled)return;settled=true;dialog.close();dialog.remove();resolve(value);};configurePanelClose(dialog,{guardEdits:false,onClose:()=>finish(false)});keep.addEventListener('click',()=>finish(false));discard.addEventListener('click',()=>finish(true));showPanelDialog(dialog);keep.focus();});
}
export function requestPanelClose(node){
  const state=states.get(node);if(!state||!active(state)||topState(node.ownerDocument)!==state)return Promise.resolve(false);
  if(state.pending)return state.pending;
  state.pending=(async()=>{
    if(state.options.canClose&&!(await state.options.canClose()))return false;
    if(dirty(state)&&!await confirmDiscard(state))return false;
    if(!active(state)||topState(node.ownerDocument)!==state)return false;
    if(state.options.onClose)await state.options.onClose();
    else if(state.legacy?.isConnected){state.legacy.click();}
    else if(state.dialog){const cancel=new Event('cancel',{cancelable:true});state.dispatching=true;try{node.dispatchEvent(cancel);}finally{state.dispatching=false;}if(!cancel.defaultPrevented&&node.open)node.close();}
    return !active(state);
  })().catch(error=>{let status=node.querySelector('.panel-close-error');if(!status){status=node.ownerDocument.createElement('p');status.className='panel-close-error notice error';status.setAttribute('role','alert');node.append(status);}status.textContent='关闭未完成，输入仍保留：'+error.message;return false;}).finally(()=>{state.pending=null;});return state.pending;
}
export function closeInteractionStats(doc=globalThis.document){const env=environment(doc);return {escapeCoordinators:env.installs,openObservers:env.observers,activeLayers:env.layers.filter(active).length};}
