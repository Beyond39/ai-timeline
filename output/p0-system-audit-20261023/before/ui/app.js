import { el, button, badge, ask, rpc, labelRole, labelStatus, savedTime, timeLabel, plainBody, showDialog } from './dom.js';
import { Reader } from './reader.js';
import { ProjectNavigator } from './navigator.js';
import { OrganizationPanel } from './organization.js';
import { TopicManager } from './topics.js';
import { diagnosticPanel } from './diagnostics.js';
import { prepareDialogLayout, routeDialogNotice } from './dialog-layout.js';
import { DocumentExportPanel } from './documents.js';
import { OPCTimeline } from './opc.js';
import { MemoryPanel } from './memory.js';
import { CaptureSourcePanel } from './capture-source.js';
import { ConnectionsPanel } from './connections.js';
import { visibleSegments as deriveVisibleSegments, resolveReadingPosition, qaNavigation } from '../domain/navigation.js';
import { normalizeForSearch } from '../domain/search.js';
import { PanelCloseButton, registerClosablePanel, releaseClosablePanel, requestPanelClose } from './panel-close.js';

const $ = selector => document.querySelector(selector);
const panel = document.body.dataset.mode === 'panel';
const parameters = new URLSearchParams(location.search);
const sourceTabId = parameters.has('sourceTab') ? Number(parameters.get('sourceTab')) : null;
const conversationModes = [['#timeline-view-button', 'timeline'], ['#canvas-view-button', 'canvas'], ['#deploy-view-button','deploy']];
let projects = [], view = null, committedView=null, busy = 0, searchEpoch = 0, exportURL = null;
let reloadEpoch=0,pendingRefresh=false,pendingProjectId=null,refreshFrame=null;
const pressedPointers=new Set();
const waitingViewReads=new Set();
function waitForViewInteraction({changingProject=false}={}){
  const ready=()=>!pressedPointers.size&&(!changingProject||!document.querySelector('dialog[open]'));
  if(ready())return;
  return new Promise(resolve=>waitingViewReads.add({ready,resolve}));
}
function scheduleRefresh(){
  if(refreshFrame!==null||!pendingRefresh&&pendingProjectId===null&&!waitingViewReads.size)return;
  // Apply queued notifications at a paint boundary after the native click.
  refreshFrame=requestAnimationFrame(()=>{
    refreshFrame=null;
    if(pressedPointers.size)return;
    for(const read of waitingViewReads)if(read.ready()){waitingViewReads.delete(read);read.resolve();}
    if(busy||document.querySelector('dialog[open]'))return;
    if(pendingProjectId!==null){
      const projectId=pendingProjectId;pendingProjectId=null;pendingRefresh=false;
      guard(async()=>{resetProjectNavigation();selection.projectId=projectId;await reload();})();
    }else if(pendingRefresh){pendingRefresh=false;guard(()=>reload(true))();}
  });
}
document.addEventListener('pointerdown',event=>pressedPointers.add(event.pointerId),true);
for(const type of ['pointerup','pointercancel'])document.addEventListener(type,event=>{pressedPointers.delete(event.pointerId);scheduleRefresh();},true);
window.addEventListener('blur',()=>{pressedPointers.clear();scheduleRefresh();});
document.addEventListener('close',scheduleRefresh,true);
let selection = { projectId: null, conversationId: null, filterConversationId: '', pathId: null, segmentId: null, qaId: null, topicId: '', stateFilter: '', allPaths: false, query: '', mapMode: panel ? 'qas' : 'overview', conversationMode: 'timeline', browseSegmentId: null };
let readingPositions = {}, layout = { libraryCollapsed: true }, readingFocused = false, positionWrite = Promise.resolve(), noticeTimer;
const notice = (text, error = false) => {
  clearTimeout(noticeTimer);
  if (routeDialogNotice(document.querySelector('dialog[open]'), text, error)) { $('#notice').hidden = true; return; }
  const host = $('#notice'); host.hidden = !text; host.textContent = text; host.classList.toggle('error', error);
  if (text) {
    host.append(PanelCloseButton(()=>{host.hidden=true;clearTimeout(noticeTimer);},{title:'关闭提示',className:'notice-close'}));
    if (!error) noticeTimer = setTimeout(() => { host.hidden = true; }, 8000);
  }
};
const persist = () => chrome.storage.local.set({ navigatorSelection: { ...selection } });
const guard = fn => async (...args) => {
  if (busy) return; busy++;for(const [id] of conversationModes)$(id).disabled=true; $('#capture-button').disabled = true; $('#import-button').disabled = true;
  try { await fn(...args); } catch (e) { notice(e.message, true); }
  finally { busy--;for(const [id] of conversationModes)$(id).disabled=false; $('#capture-button').disabled = false; $('#import-button').disabled = false;scheduleRefresh(); }
};
const map = new ProjectNavigator($('#map'), {
  onSegment: segment => guard(async () => { setDetailReader(true); await reader.showSegment(segment.id); await showCenter(); })(),
  onConversation: conversationId => guard(() => chooseConversation(conversationId))(),
  onQA: (qa, segment) => guard(async () => { setDetailReader(true); await reader.showSegment(segment.id, qa.id); await showCenter(); })(),
  onReset: () => { Object.assign(selection, { topicId: '', stateFilter: '', browseSegmentId: null }); renderMap(); persist(); }
});
const reader = new Reader($('#reader'), {
  api: rpc, onError: message => notice(message, true), onEdit: (operation, segment) => guard(() => edit(operation, segment))(), onMove: conversation => guard(() => move(conversation))(),
  onBrowse: segment => {
    setReadingFocus(false); Object.assign(selection, { mapMode: 'qas', browseSegmentId: segment.id, filterConversationId: segment.conversationId });
    renderMap(); renderConversationSelection(); persist();
    document.querySelector('.advanced-navigation').open = true;
    if (panel || matchMedia('(max-width:720px)').matches) $('#map').scrollIntoView({ block: 'start' });
  },
  onSelect: async (qa, segment) => {
    Object.assign(selection, { conversationId: qa.conversationId, pathId: qa.pathId, qaId: qa.id, segmentId: segment?.id ?? null });
    if (segment && !visibleSegments().some(s => s.id === segment.id)) { selection.topicId = ''; selection.stateFilter = ''; selection.filterConversationId = qa.conversationId; renderMap(); }
    map.select(segment?.id, !panel, qa.id); renderPathChoices(); renderBreadcrumbs(); renderConversationSelection();
    await saveReadingPosition(qa, segment); await persist();
  }
});
const organizer = new OrganizationPanel({ api: rpc, onError: message => notice(message, true),
  onApplied: async result => {
    Object.assign(selection, { conversationId: result.conversationId ?? selection.conversationId, pathId: result.pathId ?? selection.pathId,
      filterConversationId: result.conversationId ?? selection.conversationId, segmentId: result.segmentId, qaId: null, topicId: '', stateFilter: '' });
    selection.mapMode = 'qas'; selection.browseSegmentId = null;
    await reload(true); notice('整次整理已确认，地图已更新；全部问答与原文保留，可撤销最近修改。');
  },
  onNavigate: async target => {
    Object.assign(selection, { conversationId: target.conversationId, filterConversationId: target.conversationId, pathId: target.pathId, topicId: '', stateFilter: '' });
    await reload();
    if (target.qaId) await reader.showPath(target.conversationId, target.pathId, target.qaId, '', target.messageId);
    if (target.messageId) await reader.showConversation(target.conversationId, target.pathId, target.messageId, 0, '', target.versionId ?? null);
  }
});
const topicManager = new TopicManager({ api: rpc, onError: message => notice(message, true), onChanged: async () => { await reload(true); notice('主题更新已保存，同一项目的颜色与引用已同步。'); } });
const documentExporter = new DocumentExportPanel({ api: rpc, onError: message => notice(message, true) });
const memoryPanel = new MemoryPanel({ api: rpc, onError: message => notice(message, true), onChanged: () => reload(true), onRestored: async result => {
  resetProjectNavigation(); selection.projectId = result.projectIds[0] ?? selection.projectId; await reload(); notice('记忆已恢复为新项目；原来的资料仍保留。');
} });
const captureSourcePanel = new CaptureSourcePanel({ api: rpc, onCapture: (tabId, expectedSourceUrl) => { if (busy) { notice('来源已绑定。请等待当前操作完成后再点击采集。', true); return; } return guard(() => performCapture(tabId, expectedSourceUrl))(); } });
const connectionsPanel = new ConnectionsPanel({ api: rpc, onError: message => notice(message, true), onNavigate: async target => {
  Object.assign(selection, { conversationId: target.conversationId, filterConversationId: target.conversationId, qaId: null, segmentId: null, pathId: null });
  const path = view?.paths.find(row => row.conversationId === target.conversationId && row.messageIds?.includes(target.messageId)); selection.pathId = path?.id ?? null;
  await showCenter({ targetMessageId: target.messageId }); renderConversationSelection(); setDetailReader(true);
  await reader.showConversation(target.conversationId, selection.pathId, target.messageId, 0, '', target.versionId);
  $('#reader-pane').scrollIntoView({ block: 'start', behavior: 'smooth' }); await persist();
} });
const opc = new OPCTimeline($('#conversation-map'), { api: rpc,beforeRender:waitForViewInteraction, onError: message => notice(message, true),onScopeChange:async(scope,mode)=>{selection.conversationMode=mode;if(scope.workspace){selection.timelineWorkspaceId=scope.projectId;selection.workspaceSourceProjectId=view?.project.id;}else if(mode==='timeline')selection.timelineWorkspaceId=null;await persist();},onOpenGlobalCard:async(row)=>{await opc.flushMetadata();resetProjectNavigation();selection.timelineWorkspaceId=null;selection.projectId=row.projectId;selection.conversationMode='timeline';await persist();await reload();await opc.openCard(row.cardId,{searchHit:row.snippet});},onModeChange:async(mode,targetCardId)=>{selection.conversationMode=mode;await persist();const scopeId=mode!=='canvas'&&selection.workspaceSourceProjectId===view.project.id&&selection.timelineWorkspaceId;await opc.show({projectId:scopeId||view.project.id,mode,targetCardId});for(const[selector,value]of conversationModes)$(selector).setAttribute('aria-pressed',String(value===mode));} });
window.addEventListener('pagehide', () => opc.flushLayout());
function setDetailReader(open) {
  document.body.classList.toggle('detail-reader-open', open);
  const pane=$('#reader-pane');if(open){const chrome=pane.querySelector('.reader-chrome');chrome.classList.add('panel-close-header');if(!chrome.querySelector('.panel-close'))chrome.append(PanelCloseButton(()=>void requestPanelClose(pane),{title:'关闭原文详情（Esc）'}));registerClosablePanel(pane,{guardEdits:false,isActive:()=>document.body.classList.contains('detail-reader-open'),onClose:()=>setDetailReader(false)});}else releaseClosablePanel(pane);
  $('#reader-toggle').setAttribute('aria-expanded', String(open)); $('#reader-toggle').textContent = open ? '收起详细原文' : '展开详细原文';
  if (!open) setReadingFocus(false);
}
async function showCenter() {
  if (!['timeline','canvas','deploy'].includes(selection.conversationMode)) selection.conversationMode='timeline';
  for (const [id,mode] of conversationModes) $(id).setAttribute('aria-pressed',String(mode===selection.conversationMode));
  if (!view) { opc.destroy(); $('#conversation-map').replaceChildren(el('div',{class:'capture-onboarding'},[el('h2',{text:'从历史对话开始'}),el('p',{text:'打开 ChatGPT 对话，点击“导入当前对话”。每轮有效问答成为一个时间点；点击阅读，再加入上下文。'})])); return; }
  let scopeId=selection.conversationMode!=='canvas'&&selection.workspaceSourceProjectId===view.project.id&&selection.timelineWorkspaceId;
  if(scopeId){const data=await rpc('workspaceData',{});if(!data.workspaces.some(w=>w.id===scopeId)){selection.timelineWorkspaceId=null;scopeId=null;}}
  if(scopeId)opc.sourceProjectId=view.project.id;
  await opc.show({projectId:scopeId||view.project.id,mode:selection.conversationMode});
  if(opc.projectId===(scopeId||view.project.id))$('#map-title').textContent=view.project.name;
}
function fillProjects() {
  const control = $('#project-select'); control.replaceChildren(...projects.map(p => el('option', { value: p.id, text: `${p.name}（${p.conversationCount} 个 conversation）` })));
  if (!projects.length) control.append(el('option', { value: '', text: '尚无项目 · 采集后创建' }));
  control.value = pendingProjectId ?? selection.projectId ?? '';
  for (const selector of ['#rename-project', '#export-button', '#delete-project', '#manage-topics']) $(selector).disabled = !view;
  $('#organize-button').disabled = !view?.conversations.length;
  $('#document-export-button').disabled = !view?.conversations.length;
  $('#document-bundle-button').disabled = !view?.conversations.length;
}
async function reload(restoreReader = false) {
  const epoch=++reloadEpoch,requestedProjectId=selection.projectId;
  try {
  const previousProjectId = view?.project.id;
  const rows=await rpc('projects'),projectId=rows.some(p=>p.id===requestedProjectId)?requestedProjectId:rows[0]?.id??null;
  const nextView=projectId?await rpc('view',{projectId}):null;
  const key=nextView&&`navigatorReadingPosition:${projectId}`,settings=key?await chrome.storage.local.get(key):{};
  if(epoch!==reloadEpoch||selection.projectId!==requestedProjectId)return;
  if(pressedPointers.size||document.querySelector('dialog[open]')){pendingRefresh=true;scheduleRefresh();return;}
  projects=rows;selection.projectId=projectId;view=nextView;
  if(settings[key])readingPositions[projectId]=settings[key];
  if (previousProjectId !== view?.project.id) { searchEpoch++; $('#search-results').hidden = true; $('#search-results').replaceChildren(); }
  fillProjects();
  if (!view) {
    setDetailReader(false); await showCenter();committedView=null;
    setReadingFocus(false);
    $('#map-title').textContent = '先保存一条真实对话'; $('#project-stats').textContent = '数据只保存在这个浏览器的插件内。';
    $('#map-count').textContent = '0 轮'; $('#conversation-select').replaceChildren(el('option', { text: '暂无对话', value: '' }));
    $('#path-select').replaceChildren(el('option', { text: '暂无路径', value: '' })); $('#conversation-list').replaceChildren();
    $('#legend').replaceChildren(); $('#topic-filter').replaceChildren(el('option', { text: '所有主题', value: '' }));
    map.render([], { conversations: [], topics: [] }, null); $('#undo-button').disabled = true;
    $('#project-metrics').replaceChildren(); $('#breadcrumbs').replaceChildren(); $('#library-count').textContent = '0'; renderResume(); $('#reader-focus').disabled = true;
    $('#reader').replaceChildren(el('div', { class: 'empty' }, [el('h2', { text: '从真实对话开始' }), el('p', { text: '在 ChatGPT 对话页点击插件图标，再点击采集。也可以导入 conversations.json 或现有通用 JSON。' })])); return;
  }
  reader.setView(view);
  $('#reader-focus').disabled = !view.qas.length;
  if (!['overview', 'qas', 'topics', 'qas'].includes(selection.mapMode)) selection.mapMode = panel ? 'qas' : 'overview';
  if (!view.segments.some(row => row.active && row.id === selection.browseSegmentId)) selection.browseSegmentId = null;
  if (selection.topicId && selection.topicId !== '__none' && !view.topics.some(t => t.id === selection.topicId)) selection.topicId = '';
  if (selection.conversationId && !view.conversations.some(c => c.id === selection.conversationId)) Object.assign(selection, { conversationId: null, pathId: null, qaId: null, segmentId: null });
  if (!selection.conversationId && view.conversations.length) Object.assign(selection, { conversationId: view.conversations[0].id, filterConversationId: view.conversations[0].id, pathId: view.conversations[0].currentPathId, qaId: null, segmentId: null });
  if (!view.conversations.some(c => c.id === selection.filterConversationId)) selection.filterConversationId = '';
  const pending = view.suggestions.filter(s => ['pending', 'needs_review'].includes(s.status));
  $('#project-stats').textContent = `${view.conversations.length} 个 conversation${pending.length ? ` · ${pending.length} 条待处理建议` : ''}`;
  $('#project-stats').title = '分支共享的问题按路径分别计数。';
  $('#map-subtitle').textContent = '项目 › Conversation › Q/A。选择下方 Conversation，展开问题和完整回答。';
  renderMetrics(); renderResume(); $('#library-count').textContent = String(view.conversations.length);
  const conversationSelect = $('#conversation-select');
  conversationSelect.replaceChildren(el('option', { value: '', text: '全部对话 · 项目地图' }), ...view.conversations.map(c => el('option', { value: c.id, text: c.title })));
  conversationSelect.value = selection.filterConversationId;
  renderConversationList();
  $('#topic-filter').replaceChildren(el('option', { value: '', text: '所有主题' }), el('option', { value: '__none', text: '未分类' }), ...view.topics.map(t => el('option', { value: t.id, text: t.name })));
  $('#topic-filter').value = selection.topicId; $('#all-paths').checked = selection.allPaths;
  $('#undo-button').disabled = !view.undoAvailable; renderPathChoices(); renderMap();
  await showCenter();
  if(epoch!==reloadEpoch)return;
  committedView=view;
  if (restoreReader && document.body.classList.contains('detail-reader-open')) {
    const existing = view.segments.find(s => s.id === selection.segmentId && s.active);
    if (existing) await reader.showSegment(existing.id, selection.qaId);
    else if (selection.conversationId) {
      const c = view.conversations.find(c => c.id === selection.conversationId);
    const pathId = view.paths.some(p => p.id === selection.pathId && p.conversationId === c.id) ? selection.pathId : c.currentPathId ?? view.paths.find(p => p.conversationId === c.id)?.id;
      await reader.showPath(c.id, pathId, selection.qaId);
    }
  }
  if (!selection.conversationId) $('#reader').replaceChildren(el('div', { class: 'empty' }, [el('h2', { text: '选择项目中的讨论片段' }), el('p', { text: '每个节点均来自这个项目实际保存的 Q/A；空项目可通过采集或导入加入对话。' })]));
  await persist();
  } catch(error) {
    if(epoch===reloadEpoch&&committedView&&(opc.projectId===committedView.project.id||opc.scope?.workspace&&opc.sourceProjectId===committedView.project.id)){
      // A failed target read does not change the displayed controller. Restore
      // its shell from the last committed snapshot without another data read.
      view=committedView;resetProjectNavigation();selection.projectId=view.project.id;
      const first=view.conversations[0];selection.conversationId=first?.id??null;selection.pathId=first?.currentPathId??null;
      reader.setView(view);fillProjects();$('#map-title').textContent=view.project.name;
      $('#project-stats').textContent=`${view.conversations.length} 个 conversation`;
      $('#conversation-select').replaceChildren(el('option',{value:'',text:'全部对话 · 项目地图'}),...view.conversations.map(c=>el('option',{value:c.id,text:c.title})));
      $('#topic-filter').replaceChildren(el('option',{value:'',text:'所有主题'}),el('option',{value:'__none',text:'未分类'}),...view.topics.map(t=>el('option',{value:t.id,text:t.name})));
      renderMetrics();renderResume();renderConversationList();renderPathChoices();renderMap();renderBreadcrumbs();
    }
    throw error;
  }
}
function renderPathChoices() {
  if (!view) return;
  const control = $('#path-select'), c = view.conversations.find(c => c.id === (selection.conversationId || selection.filterConversationId));
  if (!c) { control.replaceChildren(el('option', { value: '', text: '选择对话后可切换分支' })); control.disabled = true; return; }
  control.disabled = false;
  const paths = view.paths.filter(p => p.conversationId === c.id);
  control.replaceChildren(...paths.map(p => el('option', { value: p.id, text: `${p.id === c.currentPathId ? '当前已确认 · ' : ''}${p.label}（${view.qas.filter(q => q.pathId === p.id).length} 轮）` })));
  control.value = paths.some(p => p.id === selection.pathId) ? selection.pathId : c.currentPathId ?? paths[0]?.id ?? '';
}
function visibleSegments() { return deriveVisibleSegments(view, selection); }
function renderMap() {
  if (!view) return;
  const segments = visibleSegments();
  if (selection.browseSegmentId && !segments.some(row => row.id === selection.browseSegmentId)) selection.browseSegmentId = null;
  const scoped = segments.filter(row => !selection.browseSegmentId || row.id === selection.browseSegmentId);
  $('#map-count').textContent = selection.mapMode === 'qas' ? `${qaNavigation(view, scoped).length} 轮问答` : `${segments.length} 个片段 · ${segments.reduce((total, s) => total + s.qaIds.length, 0)} 轮`;
  $('#topic-filter').value = selection.topicId; $('#conversation-select').value = selection.filterConversationId;
  $('#state-filter').value = selection.stateFilter;
  const topics = view.topics.filter(t => view.segments.some(s => s.active && s.topicIds.includes(t.id)));
  $('#legend').replaceChildren(button('全部主题', () => { selection.topicId = ''; renderMap(); persist(); }), ...topics.map(topic => {
    const control = button('', () => { selection.topicId = selection.topicId === topic.id ? '' : topic.id; renderMap(); persist(); });
    const dot = el('span', { class: 'color-dot' }); dot.style.setProperty('--topic-color', topic.color); control.append(dot, document.createTextNode(topic.name)); return control;
  }), el('span', { class: 'muted', text: '灰色：未分类' }));
  for (const control of document.querySelectorAll('[data-map-mode]')) control.setAttribute('aria-pressed', String(control.dataset.mapMode === selection.mapMode));
  $('#project-overview').classList.toggle('selected', selection.mapMode === 'overview' && !selection.filterConversationId);
  $('#legend').hidden = selection.mapMode === 'overview';
  renderBreadcrumbs();
  map.render(segments, view, selection.segmentId, { mode: selection.mapMode, qaId: selection.qaId, segmentId: selection.mapMode === 'qas' ? selection.browseSegmentId : null,
    conversationId: selection.filterConversationId, contentFiltered: Boolean(selection.topicId || selection.stateFilter),
    filtered: Boolean(selection.topicId || selection.stateFilter || selection.filterConversationId) });
}
async function chooseConversation(conversationId) {
  selection.filterConversationId = conversationId; selection.conversationId = conversationId;
  selection.segmentId = null; selection.qaId = null; selection.browseSegmentId = null; selection.mapMode = conversationId && view.qas.some(qa => qa.conversationId === conversationId) ? 'qas' : 'overview';
  const conversation = view.conversations.find(c => c.id === conversationId);
  if (conversation) {
    selection.pathId = conversation.currentPathId ?? view.paths.find(p => p.conversationId === conversationId)?.id;
    renderPathChoices(); renderMap(); renderConversationSelection(); closeLibraryDrawer(); await showCenter();
    if (document.body.classList.contains('detail-reader-open')) await reader.showPath(conversationId, selection.pathId);
    $('#conversation-map').scrollIntoView({ block: 'start' }); await persist();
  } else { renderMap(); await persist(); }
}
function renderMetrics() { $('#project-metrics').hidden = true; $('#project-metrics').replaceChildren(); }
function renderConversationList() {
  if (!view) return;
  const query = normalizeForSearch($('#conversation-search').value).trim();
  const rows = view.conversations.filter(row => !query || normalizeForSearch(row.title).includes(query));
  $('#conversation-list').replaceChildren(...rows.map(c => {
    const control = button('', guard(() => chooseConversation(c.id)), `conversation-item ${selection.filterConversationId === c.id ? 'selected' : ''}`);
    control.dataset.conversationId = c.id; control.setAttribute('aria-pressed', String(selection.filterConversationId === c.id));
    const count = view.qas.filter(qa => qa.conversationId === c.id && qa.pathId === (c.currentPathId ?? view.paths.find(path => path.conversationId === c.id)?.id)).length;
    control.append(el('span', { class: 'conversation-item-icon', text: '↗', 'aria-hidden': 'true' }), el('span', { class: 'conversation-item-copy' }, [el('strong', { text: c.title }), el('span', { class: 'muted', text: `${count ? `${count} 轮平台 Q/A` : '已存正文 · 可阅读／标注 Q/A'} · ${c.lastScope?.kind === 'loaded_page' ? '部分采集' : '已保存'}` })])); return control;
  }));
  if (!rows.length) $('#conversation-list').append(el('p', { class: 'muted', text: query ? '没有匹配的对话标题。' : '保存后，对话会出现在这里。' }));
}
function renderConversationSelection() {
  for (const control of $('#conversation-list').querySelectorAll('[data-conversation-id]')) {
    const selected = control.dataset.conversationId === selection.filterConversationId;
    control.classList.toggle('selected', selected); control.setAttribute('aria-pressed', String(selected));
  }
}
function renderBreadcrumbs() {
  if (!view) return;
  const host = $('#breadcrumbs'); host.replaceChildren(button(view.project.name, showOverview, 'breadcrumb-root'));
  const conversation = view.conversations.find(row => row.id === selection.filterConversationId);
  if (conversation) host.append(el('span', { text: '/ conversation /' }), button(conversation.title, guard(() => chooseConversation(conversation.id)), 'breadcrumb-link'));
  const segment = view.segments.find(row => row.active && row.id === selection.browseSegmentId);
  if (selection.mapMode === 'qas' && segment) host.append(el('span', { text: '/' }), el('span', { class: 'breadcrumb-current', text: segment.title }));
}
function showOverview() {
  Object.assign(selection, { filterConversationId: '', topicId: '', stateFilter: '', browseSegmentId: null, mapMode: 'overview' });
  renderMap(); renderConversationSelection(); closeLibraryDrawer(); persist();
  $('#conversation-library').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function renderResume() {
  const position = resolveReadingPosition(view, readingPositions[view?.project.id]);
  $('#resume-reading').disabled = !position;
  $('#resume-reading').textContent = position ? `继续阅读 · 第 ${position.qa.ordinal} 轮 →` : '继续阅读';
  $('#resume-reading').title = position ? position.conversation.title : '阅读一轮问答后，会为这个项目记录位置。';
}
function saveReadingPosition(qa, segment) {
  if (!view || qa.projectId !== view.project.id) return;
  const position = { projectId: view.project.id, conversationId: qa.conversationId, pathId: qa.pathId, qaId: qa.id, segmentId: segment?.id ?? null, updatedAt: new Date().toISOString() };
  // Serialize this page's rapid next/previous clicks; use the captured project ID after awaits.
  positionWrite = positionWrite.catch(() => {}).then(async () => {
    readingPositions[position.projectId] = position;
    // Separate project keys avoid one window overwriting another project's bookmark.
    await chrome.storage.local.set({ [`navigatorReadingPosition:${position.projectId}`]: position }); renderResume();
  });
  return positionWrite;
}
function setReadingFocus(value) {
  if (value) setDetailReader(true);
  readingFocused = value; document.body.classList.toggle('reading-focused', value);
  $('#reader-focus').setAttribute('aria-pressed', String(value)); $('#reader-focus').textContent = value ? '返回地图 ↙' : '专注阅读 ↗';
}
function closeLibraryDrawer() { document.body.classList.remove('library-open'); renderLibraryToggle(); }
function renderLibraryToggle() {
  document.body.style.setProperty('--workspace-header-bottom', `${document.querySelector('.app-header').getBoundingClientRect().bottom}px`);
  const narrow = panel || matchMedia('(max-width:1050px)').matches;
  const open = narrow ? document.body.classList.contains('library-open') : !layout.libraryCollapsed;
  const library=$('#project-library'),heading=library.querySelector('.library-section-heading');let close=heading.querySelector('.panel-close');if(!close){close=PanelCloseButton(()=>void requestPanelClose(library),{title:'关闭项目导航（Esc）'});heading.append(close);}close.hidden=!narrow;
  if(narrow&&open)registerClosablePanel(library,{guardEdits:false,isActive:()=>document.body.classList.contains('library-open'),onClose:()=>{closeLibraryDrawer();$('#library-toggle').focus({preventScroll:true});}});else releaseClosablePanel(library);
  $('#library-toggle').setAttribute('aria-expanded', String(open)); $('#library-toggle').setAttribute('aria-label', open ? '收起项目导航' : '展开项目导航');
}
function resetProjectNavigation() {
  Object.assign(selection, { conversationId: null, filterConversationId: '', pathId: null, segmentId: null, qaId: null, topicId: '', stateFilter: '', browseSegmentId: null, mapMode: panel ? 'qas' : 'overview' });
  $('#conversation-search').value = ''; setReadingFocus(false); closeLibraryDrawer();
}
async function edit(operation, segment) {
  const args = { operation, segmentId: segment.id, baseRevision: segment.revision };
  if (operation === 'rename') {
    const values = await ask('重命名讨论片段', [{ name: 'title', label: '片段标题', value: segment.title }], '只修改导航标题，完整问题与回答原文继续保留。'); if (!values) return; args.title = values.title;
  } else if (operation === 'topics') {
    const names = segment.topicIds.map(k => view.topics.find(t => t.id === k)?.name ?? '').join('，');
    const values = await ask('设置主题标签', [{ name: 'names', label: '主题名称，以逗号分隔；第一个作为地图主色', value: names, required: false }], '同名主题在这个项目中使用同一个持久颜色。留空表示未分类。'); if (!values) return; args.names = values.names;
  } else if (operation === 'split') {
    const values = await ask('选择 Q/A 拆分边界', [{ name: 'afterQAId', label: '在这一轮之后拆分', options: segment.qaIds.slice(0, -1).map(k => { const q = view.qas.find(q => q.id === k); return { value: k, label: `第 ${q.ordinal} 轮 · ${q.preview}` }; }) }], `当前 ${segment.qaIds.length} 轮将分成两段；全部成员和原文保留。`); if (!values) return; args.afterQAId = values.afterQAId;
  } else if (operation === 'merge') {
    const ordered = view.segments.filter(s => s.active && s.pathId === segment.pathId).sort((a, b) => a.ordinal - b.ordinal);
    const next = ordered[ordered.findIndex(s => s.id === segment.id) + 1]; if (!next) throw new Error('当前已是本路径最后一段，没有下一相邻段可合并。');
    const values = await ask('合并相邻讨论片段', [], `“${segment.title}”（${segment.qaIds.length} 轮）＋“${next.title}”（${next.qaIds.length} 轮）→ ${segment.qaIds.length + next.qaIds.length} 轮。两段属于同一对话与阅读路径，合并保留第一段标题与两段主题。`); if (!values) return;
    args.otherSegmentId = next.id; args.otherBaseRevision = next.revision;
  }
  const result = await rpc('editSegment', args); selection.segmentId = result.segmentId; await reload(true); notice('人工修改已保存，可撤销最近修改；重新采集会保留你的标题、主题和边界。');
}
async function move(conversation) {
  const values = await ask('调整这条对话的本地项目', [{ name: 'projectId', label: '目标项目', value: conversation.projectId, options: projects.map(p => ({ value: p.id, label: p.name })) }], '连同消息、版本、Q/A、分段和人工修订一起移动。来源原生项目另行记录。'); if (!values || values.projectId === conversation.projectId) return;
  await rpc('moveConversation', { conversationId: conversation.id, projectId: values.projectId }); selection.projectId = values.projectId; await reload(true); notice('对话及人工整理已移入目标本地项目。');
}
async function runSearch(offset = 0) {
  if (!view) throw new Error('请先创建或选择项目。');
  const query = $('#search-input').value.trim(); selection.query = query; const epoch = ++searchEpoch;
  if (!query) { $('#search-results').hidden = true; return; }
  const data = await rpc('search', { projectId: view.project.id, query, offset }); if (epoch !== searchEpoch) return;
  const host = $('#search-results'); host.hidden = false;
  if (!offset) host.replaceChildren(el('h3', { text: `原文搜索 · ${data.total} 个结果` })); else host.querySelector('.load-more')?.remove();
  data.results.forEach(result => {
    const control = button('', guard(async () => {
      Object.assign(selection, { conversationId: result.conversationId, filterConversationId: result.conversationId, topicId: '', stateFilter: '', browseSegmentId: null, mapMode: 'qas' });
      renderConversationSelection();
      if (result.qaId) {
        const q = view.qas.find(q => q.id === result.qaId); selection.pathId = q.pathId; renderMap(); renderPathChoices();
        selection.qaId = q.id; await showCenter({ qaId: q.id, targetMessageId: result.messageId });
        setDetailReader(true); await reader.showPath(q.conversationId, q.pathId, q.id, query, result.messageId);
      } else {
        const conversation = view.conversations.find(row => row.id === result.conversationId);
        selection.pathId = result.pathId ?? conversation.currentPathId; selection.qaId = null;
        renderMap(); renderPathChoices(); await showCenter({ targetMessageId: result.messageId });
        setDetailReader(true); await reader.showConversation(result.conversationId, result.pathId ?? null, result.messageId, 0, query);
      }
    }), 'search-result');
    control.append(el('strong', { text: `${result.title} · ${result.type === 'title' ? '对话标题' : labelRole(result.type)}` }), el('p', { text: result.excerpt })); host.append(control);
  });
  if (!data.total) host.append(el('p', { class: 'muted', text: '这个项目的已保存正文中没有匹配内容。可换词，或采集 / 导入更多历史。' }));
  if (data.nextOffset !== null) host.append(button(`继续读取结果（已显示 ${offset + data.results.length} / ${data.total}）`, guard(() => runSearch(data.nextOffset)), 'btn load-more'));
  await persist();
}
function previewMessages(container, messages) {
  let limit = 0; const show = () => {
    container.querySelector('.load-more')?.remove(); const end = Math.min(limit + 15, messages.length);
    for (let i = limit; i < end; i++) {
      const m = messages[i]; const card = el('article', { class: 'message-card' }, [el('strong', { text: `${i + 1} · ${labelRole(m.role)}` }), plainBody(m.text || (m.contentStatus === 'empty' ? '（来源提供了空正文）' : '（正文未取得）')),
        el('p', { class: 'message-info', text: `${timeLabel(m.time)} · 源消息 ID：${m.sourceMessageId ?? '未知'} · 源节点 ID：${m.sourceNodeId ?? '未知'} · ${m.attachments.length} 个非文本 / 附件引用` })]);
      if (m.streaming === 'generating') card.append(badge('正在生成，稍后更新', 'warning')); container.append(card);
    }
    limit = end; if (limit < messages.length) container.append(button(`预览更多消息（${limit} / ${messages.length}）`, show, 'btn load-more'));
  }; show();
}
function showPreview(draft, { resumed = false } = {}) {
  const dialog = $('#preview-dialog'); dialog.replaceChildren();
  const close = () => dialog.close();
  dialog.append(el('div', { class: 'dialog-header' }, [el('h2', { text: draft.kind === 'backup' ? '项目备份恢复预览' : '采集 / 导入预览' }), button('关闭', close)]));
  const content = el('div', { class: 'dialog-body' });
  content.append(el('p', { class: 'muted', text: resumed ? '这是上次保留的预览，还没有重新读取来源。可以保存这次记录，或重新完整读取当前对话。' : draft.filename ? `文件：${draft.filename}${draft.isExample ? ' · 明确标记：示例文件' : ''}` : draft.conversations?.[0]?.scope.kind === 'conversation_record' ? '本次读取整条 Conversation 的消息记录，包含较早消息和其他分支。问题与回答按来源角色自动识别。' : '本次仅读取当前页面已加载的正文，不代表整条 Conversation。' }));
  const choices = projects.map(p => el('option', { value: p.id, text: p.name }));
  const target = el('select', {}, [el('option', { value: draft.kind === 'backup' ? '__restore' : '__new', text: draft.kind === 'backup' ? '恢复为独立的新项目（保留全部人工整理）' : '＋ 创建新的本地项目' }), ...choices]);
  const newName = el('input', { placeholder: '新项目名称', value: draft.projectHint ?? '' });
  const existingProject = draft.conversations?.find(c => c.existing)?.existing.projectId;
  if (draft.kind !== 'backup') target.value = draft.targetProjectId ?? existingProject ?? selection.projectId ?? '__new';
  const native = el('input', { placeholder: '可选：手动记录来源原生项目名；留空保留已取得信息' });
  const projectNote = el('p', { class: 'muted' });
  const updateTarget = () => {
    newName.hidden = target.value !== '__new';
    const moves = draft.conversations?.some(c => c.existing && c.existing.projectId !== target.value && target.value !== '__new');
    projectNote.textContent = draft.kind === 'backup' ? '恢复使用新的本地对象 ID，保留来源 ID、版本链、成员关系与人工调整；选择现有项目会追加一份恢复记录。' : moves ? '所选项目与已有记录不同：保存会将这些已识别对话及其人工整理移到所选项目。' : '同一对话再次保存会增量更新；未采集到的旧消息继续保留。';
  };
  target.addEventListener('change', updateTarget); updateTarget();
  content.append(el('label', { class: 'field' }, [el('span', { text: '本地项目归属' }), target]), newName, projectNote);
  if (draft.kind !== 'backup') content.append(el('details', { class: 'preview-advanced' }, [el('summary', { text: '来源项目标注（可选）' }),
    el('label', { class: 'field' }, [el('span', { text: '来源原生项目（与插件本地项目分别保存）' }), native])]));
  dialog.append(content);
  const checks = [], pathSelects = [], bodyLabels = {}, list = el('div', { class: 'preview-list' });
  if (draft.kind === 'backup') list.append(el('p', { text: `项目：${draft.projectName} · ${draft.counts.conversations} 条对话 · ${draft.counts.messages} 条消息 · ${draft.counts.segments} 个有效 Segment。备份结构关系已静态解析，恢复后由你实际核对。` }));
  else draft.conversations.forEach(c => {
    const check = el('input', { type: 'checkbox', checked: true }); checks.push({ index: c.index, check });
    const block = el('div', { class: 'preview-conversation' }, [el('label', { class: 'check' }, [check, el('h3', { text: c.title })]),
      el('div', { class: 'reader-meta' }, [badge(c.scope.captureMode === 'body_fallback' ? `${c.messages.length} 段正文（轮次未确认）` : `${c.messages.length} 条消息`), badge(c.scope.captureMode === 'body_fallback' ? '角色未自动识别' : `${c.messages.filter(m => m.role === 'user').length} 条用户问题`), badge(`${c.paths.length} 条可读路径`), c.existing ? badge(`已有对话 · 已存 ${c.existing.savedMessages} 条`, 'good') : badge('新对话')]),
      el('details', {}, [el('summary', { text: '来源地址、时间与采集方式' }), el('p', { class: 'message-info', text: `来源地址：${c.sourceUrl ?? '未知（文件未提供实际地址）'}\n来源对话标识：${c.sourceConversationId ?? '未知'}\n标识依据：${c.identityBasis}\n来源时间：${timeLabel(c.sourceTime)}\n采集时间：${savedTime(c.capturedAt)}\n方法：${c.method}\n范围：${c.scope.description}\n角色：${[...new Set(c.messages.map(m => labelRole(m.role)))].join('、')}` })])]);
    if (c.diagnostics) block.append(diagnosticPanel(c.diagnostics, {
      extras: { sourceUrl: c.sourceUrl, title: c.title }, title: '本次页面采集状态'
    }));
    if (c.messages.some(message => message.roleUnverified)) {
      const labels = el('details', {}, [el('summary', { text: '正文片段与说话人标注（可选）' }),
        el('p', { class: 'footnote', text: '页面没有提供可靠角色标记。可以先保留“未确认角色”并保存原文；标注只帮助阅读，不会被当作平台角色或自动生成问答轮次。' })]);
      for (const message of c.messages.filter(row => row.roleUnverified)) {
        const role = el('select', { 'aria-label': `标注第 ${message.position + 1} 段正文的说话人` },
          [['unknown', '未确认角色'], ['user', '用户（你标注）'], ['assistant', '助手（你标注）'], ['tool', '工具（你标注）']].map(([value, text]) => el('option', { value, text })));
        role.value = message.confirmedRole ?? 'unknown';
        role.addEventListener('change', () => { bodyLabels[c.index] ??= {}; bodyLabels[c.index][message.key] = role.value; });
        labels.append(el('label', { class: 'field' }, [el('span', { text: `第 ${message.position + 1} 段 · ${message.text.slice(0, 90)}` }), role]));
      }
      block.append(labels);
    }
    if (c.paths.length) {
      const path = el('select', {}, [el('option', { value: '', text: '当前路径未知 / 仅保存关系，稍后选择浏览' }), ...c.paths.map(p => el('option', { value: p.key, text: `${p.label} · ${p.messageKeys.length} 条消息 · ${p.status}` }))]);
      path.value = c.currentPathKey ?? ''; pathSelects.push({ index: c.index, path });
      block.append(el('label', { class: 'field' }, [el('span', { text: '当前阅读路径：有可靠 current_node 时已恢复；其他分支分别保存' }), path]));
    }
    if (c.warnings.length) block.append(el('details', { class: 'preview-limitations' }, [el('summary', { text: `采集范围与说明（${c.warnings.length} 项）` }),
      el('div', { class: 'preview-warnings' }, [el('ul', {}, c.warnings.map(w => el('li', { text: w })))])]));
    const messages = el('div', { class: 'preview-messages' }); const detail = el('details', {}, [el('summary', { text: '检查实际取得的消息正文（分批预览）' }), messages]);
    detail.addEventListener('toggle', () => { if (detail.open && !messages.childNodes.length) previewMessages(messages, c.messages); });
    block.append(detail); list.append(block);
  });
  dialog.append(list);
  const save = button(draft.kind === 'backup' ? '恢复项目备份' : '保存到本地项目', guard(async () => {
    const indices = checks.filter(c => c.check.checked).map(c => c.index);
    if (draft.kind !== 'backup' && !indices.length) throw new Error('请至少选择一条对话。');
    if (target.value === '__new' && !newName.value.trim()) throw new Error('请输入新项目名称。');
    save.disabled = true;
    try {
      const result = await rpc('saveDraft', { draftId: draft.id, indices, projectId: target.value.startsWith('__') ? null : target.value,
        newProjectName: target.value === '__new' ? newName.value.trim() : null, bodyLabels, pathSelections: Object.fromEntries(pathSelects.filter(p => p.path.value).map(p => [p.index, p.path.value])), manualNative: native.value.trim() || null });
      close(); resetProjectNavigation(); selection.projectId = result.results?.[0]?.projectId ?? result.projectId;
      const first = result.results?.[0];
      selection.conversationMode = 'timeline';
      if (first) Object.assign(selection, { conversationId: first.conversationId, filterConversationId: first.conversationId, pathId: first.pathId, segmentId: null, qaId: null, topicId: '', mapMode: 'qas' });
      else Object.assign(selection, { conversationId: null, filterConversationId: '', pathId: null, qaId: null, segmentId: null, topicId: '' });
      await reload(true);
      if (first && !view.qas.some(qa => qa.conversationId === first.conversationId)) { selection.mapMode = 'overview'; renderMap(); await persist(); }
      if (result.failures?.length) notice(`已保存 ${result.results.length} 条；${result.failures.length} 条失败，已保留预览供重试：\n${result.failures.map(f => `${f.title}：${f.error}`).join('\n')}`, true);
      else notice(result.restored ? '备份已恢复，原文、版本、成员与人工调整已写入本地项目。' : `已保存 ${result.results.length} 条对话。新增 ${result.results.reduce((sum, r) => sum + r.createdMessages, 0)} 条消息；正文变化 ${result.results.reduce((sum, r) => sum + r.changedMessages, 0)} 条；上下文匹配 ${result.results.reduce((sum, r) => sum + r.uncertainMatches, 0)} 条（依据已记录）。`);
    } finally { save.disabled = false; }
  }), 'btn primary');
  dialog.append(el('div', { class: 'preview-footer' }, [el('p', { class: 'footnote', text: '保存后的全部正文可在阅读器访问。回答生成中可先保留快照，稍后主动更新。' }),
    el('div', { class: 'actions' }, [button('丢弃此预览', guard(async () => { await rpc('discardDraft', { draftId: draft.id }); close(); })), button('稍后处理', close), save])]));
  prepareDialogLayout(dialog);
  if (resumed && draft.kind === 'capture') dialog.querySelector('.preview-footer .actions').prepend(button('重新采集', guard(async () => { close(); await performCapture(); })));
  if (!dialog.open) showDialog(dialog);
}
async function performCapture(explicitTabId = null, expectedSourceUrl = null) {
  const captureMode = $('#capture-kind').value;
  notice(captureMode === 'full' ? '正在完整读取当前 Conversation 的消息、问答角色、时间和全部分支…' : '正在读取当前页面已加载的正文…');
  try {
    showPreview(await rpc('capture', { projectId:selection.projectId, sourceTabId: explicitTabId, fallbackSourceTabId: sourceTabId, expectedSourceUrl, captureMode, loadEarlier: $('#capture-load-earlier').checked })); notice(captureMode === 'full' ? '当前对话记录已读取，问答按来源角色识别。保存后可在时间线阅读并构建上下文包。' : '已读取页面正文；本次采集不代表完整历史。');
  } catch (error) {
    if (error.diagnostics) {
      const dialog = $('#preview-dialog'); dialog.replaceChildren(
        el('div', { class: 'dialog-header' }, [el('h2', { text: '本次采集未完成' }), button('关闭', () => dialog.close())]),
        el('div', { class: 'dialog-body' }, [el('p', { text: error.message }), diagnosticPanel(error.diagnostics)]));
      if (captureMode === 'full' || ['source_changed', 'page_changed'].includes(error.code)) dialog.querySelector('.dialog-body').prepend(button(captureMode === 'full' ? '重新完整读取' : '采集当前对话', guard(async () => { dialog.close(); await performCapture(); }), 'btn primary'));
      prepareDialogLayout(dialog);
      if (!dialog.open) showDialog(dialog);
    }
    throw error;
  }
}
$('#settings-button').addEventListener('click', () => showDialog($('#workspace-settings')));
$('#settings-close').addEventListener('click', () => $('#workspace-settings').close());
$('#capture-button').addEventListener('click', guard(() => performCapture()));
$('#capture-source-button').addEventListener('click', () => { if (busy) { notice('请等待当前操作完成后再选择采集来源。', true); return; } captureSourcePanel.open({ fallbackSourceTabId: sourceTabId }); });
$('#memory-button').addEventListener('click', () => memoryPanel.open());
$('#connections-button').addEventListener('click', () => { if (view) connectionsPanel.open({ projectId: view.project.id, conversationId: selection.conversationId }); else notice('先创建或选择本地项目。'); });
$('#saved-bundles-button').addEventListener('click', guard(() => openDocumentExport('saved')));
$('#import-button').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', guard(async event => {
  const file = event.target.files[0]; if (!file) return;
  notice(`正在解析 ${file.name}…`);
  try { showPreview(await rpc('importPreview', { text: await file.text(), filename: file.name })); notice('导入预览已准备好；保存前可选择对话、项目及阅读路径。'); } finally { event.target.value = ''; }
}));
$('#open-workspace').addEventListener('click', guard(() => rpc('openWorkspace', selection)));
const openDocumentExport = mode => {
  const conversationId = selection.conversationId || selection.filterConversationId || view?.conversations[0]?.id;
  return documentExporter.open({ projectId: view?.project.id, projectName: view?.project.name, conversationId,
    qaId: selection.qaId, segmentId: selection.segmentId, pathId: selection.pathId, initialMode: mode });
};
$('#document-export-button').addEventListener('click', guard(() => openDocumentExport('conversation')));
$('#document-bundle-button').addEventListener('click', guard(() => openDocumentExport('project')));
$('#refresh-button').addEventListener('click', guard(async () => { await reload(true); const draft = await rpc('latestDraft'); if (draft) showPreview(draft, { resumed: true }); notice('已重新读取本地保存数据。'); }));
$('#project-workspace-button').addEventListener('click',guard(()=>opc.workspace.open()));
$('#new-project').addEventListener('click', guard(async () => {
  const values = await ask('创建本地项目', [{ name: 'name', label: '项目名称' }], '可以将多条来源对话归入同一个长期项目。'); if (!values) return;
  const project = await rpc('createProject', values); resetProjectNavigation(); selection.projectId = project.id; await reload(); notice('项目已创建，可以开始采集或导入。');
}));
$('#rename-project').addEventListener('click', guard(async () => {
  const values = await ask('重命名本地项目', [{ name: 'name', label: '项目名称', value: view.project.name }]); if (!values) return;
  await rpc('renameProject', { projectId: view.project.id, ...values }); await reload(true);
}));
$('#project-select').addEventListener('change', event => {
  // A native select still changes while another read is busy. Retain the latest
  // intent instead of silently dropping it and leaving the selector/plot split.
  pendingProjectId=event.target.value;++reloadEpoch;opc.cancelNavigation();scheduleRefresh();
});
$('#conversation-select').addEventListener('change', guard(event => chooseConversation(event.target.value)));
$('#path-select').addEventListener('change', guard(async event => {
  selection.pathId = event.target.value; selection.segmentId = null; selection.qaId = null; selection.browseSegmentId = null; renderMap(); await showCenter();
  if (document.body.classList.contains('detail-reader-open')) await reader.showPath(selection.conversationId || selection.filterConversationId, selection.pathId);
  await persist();
}));
for (const [id, mode] of conversationModes) $(id).addEventListener('click', guard(async () => {
  selection.conversationMode = mode; await showCenter();
  for (const [selector, value] of conversationModes) $(selector).setAttribute('aria-pressed', String(value === mode));
  await persist();
}));
$('#reader-toggle').addEventListener('click', guard(async () => {
  const open = !document.body.classList.contains('detail-reader-open'); setDetailReader(open);
  if (open && selection.conversationId) {
    if (selection.qaId) await reader.showPath(selection.conversationId, selection.pathId, selection.qaId);
    else await reader.showConversation(selection.conversationId, selection.pathId);
  }
}));
$('#all-paths').addEventListener('change', event => { selection.allPaths = event.target.checked; renderMap(); persist(); });
$('#topic-filter').addEventListener('change', event => { selection.topicId = event.target.value; renderMap(); persist(); });
$('#search-form').addEventListener('submit', event => { event.preventDefault(); guard(() => runSearch())(); });
$('#clear-search').addEventListener('click', () => { searchEpoch++; $('#search-input').value = ''; selection.query = ''; $('#search-results').hidden = true; persist(); });
$('#undo-button').addEventListener('click', guard(async () => { const result = await rpc('undo', { projectId: view.project.id }); selection.segmentId = result.segmentId; selection.qaId = null; await reload(true); notice('最近的人工修改已撤销，反向修订也已保留。'); }));
$('#organize-button').addEventListener('click', guard(async () => {
  const conversationId = selection.conversationId || selection.filterConversationId || view.conversations[0]?.id;
  if (!conversationId) throw new Error('请先保存一条对话。');
  selection.conversationId = conversationId;
  const conversation = view.conversations.find(c => c.id === conversationId);
  const pathId = view.paths.some(p => p.id === selection.pathId && p.conversationId === conversationId) ? selection.pathId : conversation.currentPathId ?? view.paths.find(p => p.conversationId === conversationId)?.id;
  selection.pathId = pathId; await organizer.open({ conversationId, pathId });
}));
$('#manage-topics').addEventListener('click', guard(() => topicManager.open(view)));
$('#state-filter').addEventListener('change', event => { selection.stateFilter = event.target.value; renderMap(); persist(); });
$('#export-button').addEventListener('click', guard(async () => {
  const backup = await rpc('backup', { projectId: view.project.id }); if (exportURL) URL.revokeObjectURL(exportURL);
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })); exportURL = url;
  const link = el('a', { href: url, download: `${view.project.name.replace(/[<>:"/\\|?*]/g, '_')}-ACVN-backup-${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })}.json` }); document.body.append(link); link.click(); link.remove();
  notice('项目备份已准备，内容包含完整原文、来源、版本链、Q/A、Segment 成员及人工调整。');
  $('#notice').append(document.createTextNode(' '), el('a', { href: url, download: link.download, text: '点击下载备份 JSON' }));
}));
$('#delete-project').addEventListener('click', guard(async () => {
  const projectId = view.project.id;
  await opc.flushMetadata();await opc.horizontal.flush();await opc.flushLayout();await opc.deploy.flush();
  const preview=await rpc('projectDeletePreview',{projectId}),name=preview.name;
  const values=await ask('删除本地项目及原始数据',[{name:'confirmName',label:`输入项目名“${name}”确认`}],`将删除 ${preview.conversations} 个 Conversation、${preview.cards} 张 Q/A、${preview.messages} 条消息与 ${preview.versions} 个正文版本。涉及 ${preview.workspaces.length} 个 Workspace：只移除已删来源的关联，其余来源、人工主题和已保存的 Deploy 内容保留。删除前自动建立本地恢复点；关闭此确认窗不会删除数据。`,{confirmLabel:'删除此项目',danger:true});if(!values)return;
  await rpc('deleteProject', { projectId, confirmName: values.confirmName,expectedRevision:preview.revision }); resetProjectNavigation();selection.timelineWorkspaceId=null; selection.projectId = null;
  delete readingPositions[projectId]; await chrome.storage.local.set({ [`navigatorReadingPosition:${projectId}`]: null });
  await reload(); notice('本地项目已删除；删除前的本地恢复点已保留，可从“备份与恢复点”恢复。');
}));
$('#conversation-search').addEventListener('input', renderConversationList);
$('#project-overview').addEventListener('click', showOverview);
$('#conversation-switch').addEventListener('click', () => {
  setReadingFocus(false); $('#conversation-library').scrollIntoView({ block: 'start', behavior: 'smooth' });
});
for (const control of document.querySelectorAll('[data-map-mode]')) control.addEventListener('click', () => {
  selection.mapMode = control.dataset.mapMode; selection.browseSegmentId = null; renderMap(); persist();
});
$('#resume-reading').addEventListener('click', guard(async () => {
  const position = resolveReadingPosition(view, readingPositions[view?.project.id]);
  if (!position) { renderResume(); notice('之前的阅读位置已变化，请从当前地图重新选择。'); return; }
  Object.assign(selection, { conversationId: position.conversation.id, filterConversationId: position.conversation.id, pathId: position.path.id,
    qaId: position.qa.id, segmentId: position.segment?.id ?? null, topicId: '', stateFilter: '', browseSegmentId: null, mapMode: 'qas' });
  renderPathChoices(); renderMap(); renderConversationSelection(); closeLibraryDrawer();
  await showCenter({ qaId: position.qa.id }); $('#conversation-map').scrollIntoView({ block: 'start' });
  if (document.body.classList.contains('detail-reader-open')) {
    if (position.segment) await reader.showSegment(position.segment.id, position.qa.id);
    else await reader.showPath(position.conversation.id, position.path.id, position.qa.id);
  }
  notice(`已回到“${position.conversation.title}”的第 ${position.qa.ordinal} 轮。`);
}));
$('#reader-focus').addEventListener('click', () => setReadingFocus(!readingFocused));
$('#library-toggle').addEventListener('click', () => {
  if (readingFocused) setReadingFocus(false);
  if (panel || matchMedia('(max-width:1050px)').matches) document.body.classList.toggle('library-open');
  else { layout.libraryCollapsed = !layout.libraryCollapsed; document.body.classList.toggle('library-collapsed', layout.libraryCollapsed); chrome.storage.local.set({ navigatorLayout: layout }); }
  renderLibraryToggle();
});
matchMedia('(max-width:1050px)').addEventListener('change', closeLibraryDrawer);
window.addEventListener('resize', renderLibraryToggle);
document.addEventListener('keydown', event => {
  const editing = event.target.closest('input,textarea,select,[contenteditable="true"]');
  if (document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape') { setReadingFocus(false); closeLibraryDrawer(); return; }
  if (editing || event.ctrlKey || event.metaKey) return;
  if (event.key === '/' && !event.altKey) { event.preventDefault(); setReadingFocus(false); $('#search-input').focus(); }
  if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key) && reader.content?.isConnected && reader.selected) {
    event.preventDefault();
    const current = reader.members.findIndex(row => row.id === reader.selected.id), next = reader.members[current + (event.key === 'ArrowLeft' ? -1 : 1)];
    if (next) guard(() => reader.displayQA(next.id))();
  }
});
chrome.runtime.onMessage.addListener(message => {
  if (message.event === 'progress') notice(`正在保存 ${message.processed} / ${message.total} 条对话${message.title ? ` · ${message.title}` : ''}。已完成条目会独立提交。`);
  if (message.event !== 'changed') return;
  if (view && message.projectId && message.projectId !== view.project.id && !String(message.projectId).startsWith('workspace_') && !String(opc.projectId).startsWith('workspace_')) {
    // A different independent Project cannot change this Timeline. Refresh only
    // the library choices; replacing the Timeline here destroys a pressed node
    // before pointerup, cancelling native clicks on +, − and Q/A alike.
    rpc('projects').then(rows => { projects = rows; fillProjects(); }).catch(error => notice(error.message, true));
    return;
  }
  pendingRefresh=true;scheduleRefresh();
});
async function initialize() {
  try { await rpc('memoryInitialize'); } catch (error) { notice(`升级恢复点尚未建立：${error.message} 已保存的资料仍在，请打开“记忆”另存备份。`, true); }
  const [settings, positions, preferences] = await Promise.all(['navigatorSelection', 'navigatorReadingPositions', 'navigatorLayout'].map(key => chrome.storage.local.get(key)));
  selection = { ...selection, ...settings.navigatorSelection };
  if (!settings.navigatorSelection?.opcVersion || !['timeline', 'canvas','deploy'].includes(selection.conversationMode)) selection.conversationMode = 'timeline';
  selection.opcVersion = 2; readingPositions = positions.navigatorReadingPositions ?? {};
  layout.libraryCollapsed = preferences.navigatorLayout?.libraryCollapsed !== false;
  document.body.classList.toggle('library-collapsed', layout.libraryCollapsed); renderLibraryToggle();
  for (const key of ['projectId', 'conversationId', 'pathId', 'segmentId', 'qaId']) if (parameters.has(key)) selection[key] = parameters.get(key);
  if (parameters.has('conversationId')) selection.filterConversationId = selection.conversationId;
  await reload(true); $('#search-input').value = selection.query ?? '';
  if (selection.query && view) await runSearch();
  const draft = await rpc('latestDraft'); if (draft) showPreview(draft, { resumed: true });
}
guard(initialize)();
