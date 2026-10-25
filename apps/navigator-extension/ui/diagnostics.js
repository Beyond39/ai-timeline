import { el, button, badge, labelRole } from './dom.js';

const REASONS = {
  unsupported_page: '当前页面不支持采集，请打开 ChatGPT 对话。',
  messages_not_loaded: '当前页面尚未取得消息，请等待加载或滚动后重试。',
  messages_not_found: '未识别到对话消息。若正文已经显示，请复制诊断信息检查页面结构；滚动不一定能解决。',
  structure_unrecognized: '页面已有内容，但消息角色或结构无法识别。请复制诊断信息检查适配器，或使用 JSON 导入。',
  source_tab_closed: '来源标签页已关闭，请重新打开目标对话。',
  source_changed: '开始采集前来源发生变化，请再次点击“采集当前对话”。',
  access_denied: '当前网页没有采集授权，请在来源页点击插件图标。',
  adapter_execution_failed: '页面采集未完成，请等待页面稳定后重试。',
  page_changed: '观察期间页面已切换，请重新采集。',
  duplicate_source_ids: '页面出现重复消息标识，无法可靠区分消息。',
  partial_scope: '本次仅取得已加载消息，完整历史是否已加载未知。',
  generating: '回答仍在生成或正文发生变化，可保存后再更新。',
  body_unavailable: '部分消息正文不可取得。',
  reference_only: '附件或媒体只有引用，正文未下载。',
  source_id_unknown: '部分消息没有可靠源 ID，采用保守匹配。',
  role_unverified: '已读取当前对话区域的正文片段，但说话人或完整轮次未确认。可以保存并直接阅读，也可在预览中标注说话人。',
  scrolled_partial: '已向上加载一屏并采集；仍不代表完整历史。',
  scroll_unavailable: '没有找到可继续向上滚动的对话区域，已采集当前取得的内容。',
  uncovered_content: '当前页仍有可读内容未被采集边界覆盖，请复制诊断帮助定位。',
  full_conversation: '已读取该条 Conversation 返回的完整消息图。问题、回答、时间和分支来自消息记录；附件保留引用。',
  conversation_not_saved: '对话尚未获得正式地址，请完成第一轮回答后再完整读取。',
  conversation_access_denied: '无法访问完整对话记录，请确认页面已登录且对话可访问后重试。',
  conversation_data_unavailable: '未取得完整对话记录，请重试或导入 ChatGPT 导出文件。',
  selected_branch_unavailable: '无法确认页面当前分支，未更新已保存的问答。请等页面稳定后重试。',
  conversation_data_incomplete: '消息或分支记录不完整，本次完整读取未完成。',
  conversation_roles_unavailable: '完整消息角色没有取得，本次完整读取未完成。',
  conversation_read_timeout: '完整对话读取超时，请检查连接后重试。',
  conversation_too_large: '对话超过单次读取容量，请使用 ChatGPT 导出文件导入。',
  capture_rate_limited: '来源暂时限制读取频率，请稍后重试。'
};
const CAPABILITY_VALUES = new Set(['not_checked', 'unknown', 'unknown_unloaded', 'not_collected', 'unavailable', 'available', 'partial', 'text_only', 'observed_blocks', 'source_ids', 'partial_source_ids', 'context_fallback', 'partial_provided', 'provided', 'provided_graph']);
const CAPABILITY_KEYS = ['text', 'structure', 'messageIdentity', 'parents', 'nativeProject', 'sourceTime', 'history', 'branches', 'attachmentBodies'];
const COUNT_KEYS = ['messages', 'reliableSourceIds', 'unknownSourceIds', 'generating', 'bodyUnavailable', 'attachments', 'referenceOnly', 'structuredMessages'];
const STRUCTURE_KEYS = ['mainRegions', 'threadRegions', 'authorRoleMarkers', 'visibleAuthorRoleMarkers', 'turnContainers', 'visibleTurnContainers', 'readableBodyBlocks', 'candidateMessages', 'loadingIndicators', 'semanticRoleMarkers', 'userMarkers', 'assistantMarkers', 'visibleUserMarkers', 'visibleAssistantMarkers', 'richBodyBlocks', 'unclaimedRichBlocks', 'outOfScopeBodyBlocks'];
const ROLES = ['user', 'assistant', 'tool', 'function', 'system', 'developer', 'unknown'];
const PAGE_TYPES = new Set(['unsupported', 'conversation', 'project_conversation', 'chatgpt_other', 'unknown']);
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const knownNotices = values => (Array.isArray(values) ? values : []).filter(item => Object.hasOwn(REASONS, item?.code)).map(item => ({ code: item.code, reason: REASONS[item.code] }));

/** Strict whitelist. Imported diagnostics and exceptions cannot introduce a URL,
 * body, account, project/title, message ID or arbitrary exception text by default. */
export function buildDiagnosticReport(input = {}, extras = null) {
  const report = {
    format: 'acvn-capture-diagnostic',
    extensionVersion: /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:\.\d{1,5})?$/.test(input.extensionVersion ?? '') ? input.extensionVersion : 'unknown',
    adapterVersion: /^[a-z0-9_-]{1,48}$/i.test(input.adapterVersion ?? '') ? input.adapterVersion : 'unknown',
    pageType: PAGE_TYPES.has(input.pageType) ? input.pageType : 'unknown',
    status: input.status === 'failed' ? 'failed' : 'recognized',
    captureMode: ['message_markers', 'body_fallback', 'mixed_markers', 'structured_conversation'].includes(input.captureMode) ? input.captureMode : 'unknown',
    counts: Object.fromEntries(COUNT_KEYS.map(key => [key, number(input.counts?.[key])])),
    capabilities: Object.fromEntries(CAPABILITY_KEYS.map(key => [key, CAPABILITY_VALUES.has(input.capabilities?.[key]) ? input.capabilities[key] : 'unknown'])),
    errors: knownNotices(input.errors), notices: knownNotices(input.notices)
  };
  report.counts.roles = Object.fromEntries(ROLES.filter(role => number(input.counts?.roles?.[role])).map(role => [role, number(input.counts.roles[role])]));
  const knownRoleCount = Object.values(report.counts.roles).reduce((sum, count) => sum + count, 0);
  if (knownRoleCount < report.counts.messages) report.counts.roles.unknown = (report.counts.roles.unknown ?? 0) + report.counts.messages - knownRoleCount;
  if (input.pageStructure && typeof input.pageStructure === 'object') report.pageStructure = Object.fromEntries(STRUCTURE_KEYS.map(key => [key, number(input.pageStructure[key])]));
  if (extras && typeof extras === 'object') {
    report.userAttached = {};
    for (const key of ['sourceUrl', 'title', 'projectName', 'text']) if (typeof extras[key] === 'string') report.userAttached[key] = extras[key];
  }
  return report;
}
export async function copyDiagnostic(input, extras = null) {
  const text = JSON.stringify(buildDiagnosticReport(input, extras), null, 2);
  if (!navigator.clipboard?.writeText) throw new Error('当前页面无法自动复制，请展开诊断信息后手动复制。');
  await navigator.clipboard.writeText(text); return text;
}
export function diagnosticPanel(input, { title = '采集状态与范围', extras = null } = {}) {
  const report = buildDiagnosticReport(input), counts = report.counts;
  const root = el('section', { class: 'capture-diagnostics' });
  root.append(el('h3', { text: title }));
  if (report.status === 'failed') root.append(el('p', { class: 'notice', text: report.errors[0]?.reason ?? '采集未完成，已有本地数据保留。' }));
  else {
    root.append(el('div', { class: 'badges' }, [badge(`本次取得 ${counts.messages} ${report.captureMode === 'body_fallback' ? '段正文' : '条消息'}`), badge(`可靠源标识 ${counts.reliableSourceIds} 条`), badge(counts.generating ? `生成中 ${counts.generating} 条` : '未观察到生成变化')]));
    const roleText = Object.entries(counts.roles).map(([role, count]) => `${labelRole(role)} ${count} 条`).join('；');
    root.append(el('p', { text: roleText || '消息角色未知' }), el('p', { class: 'notice', text: report.captureMode === 'structured_conversation' ? '已取得该 Conversation 返回的全部消息记录和分支，不依赖页面滚动。消息角色自动识别；附件文件本体未下载。' : '只覆盖本次已加载的消息。更早历史、未展示分支和未取得的附件正文保持未知。' }),
      el('p', { text: `正文未取得：${counts.bodyUnavailable} 条；附件 / 媒体仅引用：${counts.referenceOnly} 个；已取得结构：${counts.structuredMessages} 条。` }));
  }
  for (const notice of report.notices.filter(item => item.code !== 'partial_scope')) root.append(el('p', { class: 'muted', text: notice.reason }));
  const details = el('details', {}, [el('summary', { text: '详细诊断（不含正文、账号、来源链接或项目名）' }), el('pre', { class: 'diagnostic-report', text: JSON.stringify(report, null, 2) })]);
  root.append(details);
  const attached = buildDiagnosticReport(input, extras).userAttached;
  let include = null;
  if (attached && Object.keys(attached).length) {
    const names = { sourceUrl: '完整来源地址', title: '对话标题', projectName: '项目名称', text: '完整正文' };
    include = el('input', { type: 'checkbox', 'aria-label': '主动附加来源内容到诊断' });
    root.append(el('label', { class: 'field' }, [include, el('span', { text: `主动附加：${Object.keys(attached).map(key => names[key]).join('、')}。默认不附加。` })]),
      el('details', {}, [el('summary', { text: '先查看将附加的内容' }), el('pre', { class: 'diagnostic-report', text: JSON.stringify(attached, null, 2) })]));
  }
  const status = el('p', { class: 'muted', role: 'status' });
  root.append(button('复制诊断信息', async () => {
    try { await copyDiagnostic(input, include?.checked ? attached : null); status.textContent = include?.checked ? '已复制诊断及你主动附加的内容。' : '已复制诊断；不含正文、账号、来源链接或项目名。'; }
    catch (error) { status.textContent = error.message; details.open = true; }
  }), status);
  return root;
}
