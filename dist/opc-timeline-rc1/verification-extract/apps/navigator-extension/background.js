import { parseImport } from './importers/json.js';
import { command, createDraft, saveDraft } from './storage/repository.js';
import { CAPTURE_ADAPTER_VERSION, EXTENSION_VERSION } from './domain/common.js';
import { readConversationData } from './adapters/conversation-data.js';
import { normalizeConversationData, DATA_ADAPTER_VERSION } from './domain/full-conversation.js';
import { recordImportFailure } from './storage/release.js';
import { changeNotification } from './domain/change-notification.js';
import { RUNTIME_BUILD } from './domain/runtime-build.js';

const broadcast = (event, data = {}) => chrome.runtime.sendMessage({ event, ...data }).catch(() => {});
const captureReasons = {
  unsupported_page: '当前页面不支持采集。请打开 ChatGPT 的对话页面。',
  access_denied: '当前页面没有采集授权。请在目标 ChatGPT 页面点击工具栏插件图标，再尝试采集。',
  source_tab_closed: '来源标签页已关闭。请重新打开目标 ChatGPT 对话，并点击工具栏插件图标。',
  source_changed: '开始采集前来源发生变化。请再次点击“采集当前对话”。',
  page_changed: '采集期间页面已切换。请在目标对话页再次点击采集。',
  conversation_not_saved: '这条对话尚未获得正式地址。请完成第一轮回答后再完整读取。',
  conversation_access_denied: '无法读取这条对话的完整记录。请确认该页面已登录且对话可访问，再重试。',
  conversation_data_unavailable: '未能取得这条对话的完整记录。请重试；也可以导入 ChatGPT 导出的 conversations.json。',
  selected_branch_unavailable: '页面可见的消息路径与来源分支不一致，无法可靠确认当前回答。请等分支切换完成后重新导入；已有资料仍保留。',
  conversation_data_incomplete: '来源返回的消息或分支记录不完整，本次完整读取未完成。请重试。',
  conversation_roles_unavailable: '来源没有返回完整的消息角色，本次完整读取未完成。请重试。',
  conversation_read_timeout: '完整对话读取超时，请检查当前页面连接后重试。',
  conversation_too_large: '这条对话超过单次读取容量，请使用 ChatGPT 导出文件导入。',
  capture_rate_limited: '来源暂时限制读取频率，请稍后重试。',
  adapter_execution_failed: '页面采集没有完成。请等待页面稳定后重试；已有本地数据继续保留。'
};
function captureError(code, diagnostics = null, reason = null) {
  const message = reason ?? captureReasons[code] ?? captureReasons.adapter_execution_failed;
  const error = new Error(message); error.code = code; error.errorCode = code;
  error.diagnostics = diagnostics ?? {
    extensionVersion: EXTENSION_VERSION, adapterVersion: CAPTURE_ADAPTER_VERSION, pageType: code === 'unsupported_page' ? 'unsupported' : 'unknown', status: 'failed', counts: { messages: 0, roles: {} },
    capabilities: { text: 'not_checked', messageIdentity: 'not_checked', history: 'unknown_unloaded', branches: 'not_collected', attachmentBodies: 'unavailable' },
    errors: [{ code, reason: message }], notices: [],
    coverage: { kind: 'partial_scope', observedMessages: 0, fullHistory: 'unknown', branches: 'not_collected' }
  }; error.diagnostics.extensionVersion = EXTENSION_VERSION; return error;
}
const conversationKey = value => { const url = new URL(value), match = url.pathname.match(/\/(c|share)\/([^/]+)/); return `${url.hostname}:${match ? `${match[1]}:${match[2]}` : url.pathname}`; };
const supportedSource = value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && ['chatgpt.com', 'chat.openai.com'].includes(url.hostname); } catch { return false; } };
async function captureSourceStatus(args = {}) {
  const stored = await chrome.storage.session.get(['captureSource', 'captureTabId']);
  const paired = stored.captureSource;
  let tabId = args.sourceTabId;
  if (!Number.isInteger(tabId)) {
    // A capture click selects the current page, not the URL remembered when
    // the toolbar icon originally opened the panel. Extension workspace tabs
    // use the most recent toolbar-selected source, with the old URL parameter
    // serving only as a fallback for sessions opened before that selection.
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active && !active.url?.startsWith(chrome.runtime.getURL(''))) {
      if (!active.url && active.id !== (paired?.tabId ?? stored.captureTabId)) return { available: false, code: 'access_denied', reason: captureReasons.access_denied };
      tabId = active.id;
    } else tabId = paired?.tabId ?? stored.captureTabId ?? args.fallbackSourceTabId;
  }
  if (!Number.isInteger(tabId)) return { available: false, code: 'access_denied', reason: captureReasons.access_denied };
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return { available: false, code: 'access_denied', reason: captureReasons.access_denied };
    if (!supportedSource(tab.url)) return { available: false, code: 'unsupported_page', reason: captureReasons.unsupported_page };
    return { available: true, tabId, title: tab.title || '当前 ChatGPT 页面', url: tab.url,
      changed: Boolean(paired?.tabId === tabId && paired.url && conversationKey(paired.url) !== conversationKey(tab.url)) };
  } catch { return { available: false, code: 'source_tab_closed', reason: captureReasons.source_tab_closed }; }
}
async function rebindCaptureSource(args) {
  const source = await captureSourceStatus(args);
  if (!source.available) throw captureError(source.code ?? 'access_denied');
  if (!args.expectedSourceUrl || source.url !== args.expectedSourceUrl) throw captureError('source_changed');
  await chrome.storage.session.set({ captureTabId: source.tabId, captureSource: { tabId: source.tabId, url: source.url } });
  return { rebound: true, tabId: source.tabId };
}
chrome.action.onClicked.addListener(tab => {
  // Invoke directly within the action gesture; don't await storage before opening the panel.
  const opening = chrome.sidePanel?.open ? chrome.sidePanel.open({ windowId: tab.windowId }) : Promise.reject(new Error('Side Panel API 不可用'));
  chrome.storage.session.set({ captureTabId: tab.id, captureSource: { tabId: tab.id, url: tab.url ?? null } }).catch(() => {});
  opening.catch(() => chrome.tabs.create({ url: chrome.runtime.getURL(`workspace.html?sourceTab=${tab.id}`) }));
});
async function capture(args) {
  try {
    const sourceTab = await captureSourceStatus(args);
    if (!sourceTab.available) throw captureError(sourceTab.code ?? 'access_denied');
    const tabId = sourceTab.tabId;
    // Explicit source-dialog captures must still match what the user reviewed.
    // Direct captures take a fresh snapshot and keep the adapter's race guard.
    if (args.expectedSourceUrl && conversationKey(args.expectedSourceUrl) !== conversationKey(sourceTab.url)) throw captureError('source_changed');
    if (args.captureMode !== 'loaded') {
      const responses = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: readConversationData, args: [{ expectedSourceUrl: sourceTab.url }] });
      const data = responses.find(row => row.frameId === 0)?.result;
      if (!data?.ok) {
        const error = captureError(data?.errorCode ?? 'conversation_data_unavailable'); error.diagnostics.adapterVersion = DATA_ADAPTER_VERSION; throw error;
      }
      const current = await chrome.tabs.get(tabId);
      if (!current.url || conversationKey(current.url) !== conversationKey(sourceTab.url)) throw captureError('page_changed');
      let conversation;
      try { conversation = await normalizeConversationData(data); } catch { throw captureError('conversation_data_incomplete'); }
      await chrome.storage.session.set({ captureTabId: tabId, captureSource: { tabId, url: sourceTab.url } });
      return createDraft({ kind: 'capture', filename: null, sourceTabId: tabId, conversations: [conversation] });
    }
    await chrome.scripting.executeScript({ target: { tabId }, files: ['adapters/chatgpt.js'] });
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: async options => globalThis.__ACVN_CHATGPT__.collect(options), args: [{ loadEarlier: args.loadEarlier === true, expectedSourceUrl: sourceTab.url ?? null }] });
    const result = results.find(r => r.frameId === 0)?.result;
    if (!result?.ok) throw captureError(result?.errorCode ?? 'adapter_execution_failed', result?.diagnostics, result?.reason);
    const current = await chrome.tabs.get(tabId);
    if (!current.url || conversationKey(current.url) !== conversationKey(sourceTab.url)) throw captureError('page_changed');
    result.diagnostics = { ...result.diagnostics, extensionVersion: EXTENSION_VERSION };
    result.conversation.diagnostics = result.diagnostics;
    await chrome.storage.session.set({ captureTabId: tabId, captureSource: { tabId, url: sourceTab.url } });
    return createDraft({ kind: 'capture', filename: null, sourceTabId: tabId, conversations: [result.conversation] });
  } catch (e) {
    if (e.diagnostics) { if (args.captureMode !== 'loaded') e.diagnostics.adapterVersion = DATA_ADAPTER_VERSION; throw e; }
    if (/No tab with id|Invalid tab ID|tab was closed|tab not found/i.test(e.message)) throw captureError('source_tab_closed');
    if (/Cannot access|Missing host permission|extensions gallery|permission|not allowed|Cannot read properties.*get/i.test(e.message)) throw captureError('access_denied');
    if (/Frame with ID|frame was removed|No frame/i.test(e.message)) throw captureError('adapter_execution_failed');
    throw captureError('adapter_execution_failed');
  }
}
const writes = new Set(['qaAnalyze','qaReview','workspaceWrite','conversationManage','opcWrite','releaseWrite','opcEnsure','createProject', 'renameProject', 'editSegment', 'undo', 'moveConversation', 'deleteProject', 'discardDraft',
  'organizationRules', 'organizationExport', 'organizationImport', 'organizationUpdate', 'organizationApply', 'organizationReject', 'organizationArchive', 'topicApply', 'labelMessageRole',
  'memoryRestore', 'memoryImport', 'connectionSave', 'connectionArchive', 'documentRecipeSave', 'documentRecipeRename', 'documentRecipeArchive']);
async function dispatch(type, args) {
  if(type==='runtimeInfo')return {build:RUNTIME_BUILD,extensionId:chrome.runtime.id,version:chrome.runtime.getManifest().version};
  if (type === 'captureSourceStatus') return captureSourceStatus(args);
  if (type === 'captureSourceRebind') return rebindCaptureSource(args);
  if (type === 'capture') {try{return await capture(args);}catch(error){try{await recordImportFailure({sourceUrl:args.expectedSourceUrl,projectId:args.projectId,code:error.errorCode??error.code});}catch{/* A logging failure must never replace the original capture diagnostic. */}throw error;}}
  if (type === 'importPreview') return createDraft(await parseImport(args.text, String(args.filename ?? 'import.json')));
  if (type === 'saveDraft') {
    const result = await saveDraft(args, data => broadcast('progress', data)); broadcast('changed', { projectId: result.projectId ?? null, action: 'saveDraft' }); return result;
  }
  if (type === 'openWorkspace') {
    const parameters = new URLSearchParams();
    for (const key of ['projectId', 'conversationId', 'segmentId', 'qaId', 'pathId']) if (args[key]) parameters.set(key, args[key]);
    const sourceTab = (await chrome.storage.session.get('captureTabId')).captureTabId;
    if (Number.isInteger(sourceTab)) parameters.set('sourceTab', sourceTab);
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(`workspace.html?${parameters}`) }); return { tabId: tab.id };
  }
  const result = await command(type, args);
  if (writes.has(type)) { const { event, ...data } = changeNotification(type,args,result); broadcast(event,data); }
  return result;
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!message?.type || message.event) return false;
  if (sender.id !== chrome.runtime.id || sender.tab?.url && !sender.tab.url.startsWith(chrome.runtime.getURL('')) || !sender.url?.startsWith(chrome.runtime.getURL(''))) {
    reply({ ok: false, error: '仅允许扩展自身的页面访问本地资料。' }); return false;
  }
  dispatch(message.type, message.args ?? {}).then(data => reply({ ok: true, data }), e => reply({ ok: false, error: e.message ?? '操作失败，已保存数据仍保留。', errorCode: e.errorCode ?? e.code ?? null, diagnostics: e.diagnostics ?? null }));
  return true;
});
