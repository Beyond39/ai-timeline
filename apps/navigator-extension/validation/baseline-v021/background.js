import { parseImport } from './importers/json.js';
import { command, createDraft, saveDraft } from './storage/repository.js';

const broadcast = (event, data = {}) => chrome.runtime.sendMessage({ event, ...data }).catch(() => {});
chrome.action.onClicked.addListener(tab => {
  // Invoke directly within the action gesture; don't await storage before opening the panel.
  const opening = chrome.sidePanel?.open ? chrome.sidePanel.open({ windowId: tab.windowId }) : Promise.reject(new Error('Side Panel API 不可用'));
  chrome.storage.session.set({ captureTabId: tab.id }).catch(() => {});
  opening.catch(() => chrome.tabs.create({ url: chrome.runtime.getURL(`workspace.html?sourceTab=${tab.id}`) }));
});
async function capture(args) {
  let tabId = args.sourceTabId;
  if (!Number.isInteger(tabId)) {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active && !active.url?.startsWith(chrome.runtime.getURL(''))) tabId = active.id;
    else tabId = (await chrome.storage.session.get('captureTabId')).captureTabId;
  }
  if (!Number.isInteger(tabId)) throw new Error('没有当前网页授权。请在 ChatGPT 对话页点击工具栏插件图标，再采集。');
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['adapters/chatgpt.js'] });
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: async () => globalThis.__ACVN_CHATGPT__.collect() });
    const result = results.find(r => r.frameId === 0)?.result;
    if (!result?.ok) throw new Error(result?.reason ?? '页面适配器没有返回可识别数据。');
    await chrome.storage.session.set({ captureTabId: tabId });
    return createDraft({ kind: 'capture', filename: null, sourceTabId: tabId, conversations: [result.conversation] });
  } catch (e) {
    if (/Cannot access|Missing host permission|extensions gallery|Frame with ID|No tab with id/i.test(e.message)) throw new Error('当前页授权不可用或标签页已关闭。请在目标 ChatGPT 对话页再次点击插件图标；刷新、切换来源或跨站导航后可能需要重新授权。');
    throw e;
  }
}
const writes = new Set(['createProject', 'renameProject', 'editSegment', 'undo', 'moveConversation', 'deleteProject', 'discardDraft',
  'organizationRules', 'organizationExport', 'organizationImport', 'organizationUpdate', 'organizationApply', 'organizationReject', 'topicApply']);
async function dispatch(type, args) {
  if (type === 'capture') return capture(args);
  if (type === 'importPreview') return createDraft(await parseImport(args.text, String(args.filename ?? 'import.json')));
  if (type === 'saveDraft') {
    const result = await saveDraft(args, data => broadcast('progress', data)); broadcast('changed'); return result;
  }
  if (type === 'openWorkspace') {
    const parameters = new URLSearchParams();
    for (const key of ['projectId', 'conversationId', 'segmentId', 'qaId', 'pathId']) if (args[key]) parameters.set(key, args[key]);
    const sourceTab = (await chrome.storage.session.get('captureTabId')).captureTabId;
    if (Number.isInteger(sourceTab)) parameters.set('sourceTab', sourceTab);
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(`workspace.html?${parameters}`) }); return { tabId: tab.id };
  }
  const result = await command(type, args); if (writes.has(type)) broadcast('changed'); return result;
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!message?.type || message.event) return false;
  if (sender.id !== chrome.runtime.id || sender.tab?.url && !sender.tab.url.startsWith(chrome.runtime.getURL('')) || !sender.url?.startsWith(chrome.runtime.getURL(''))) {
    reply({ ok: false, error: '仅允许扩展自身的页面访问本地资料。' }); return false;
  }
  dispatch(message.type, message.args ?? {}).then(data => reply({ ok: true, data }), e => reply({ ok: false, error: e.message ?? '操作失败，已保存数据仍保留。' }));
  return true;
});
