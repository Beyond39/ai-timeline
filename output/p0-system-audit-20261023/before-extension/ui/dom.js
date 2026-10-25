import { findTextMatches } from '../domain/search.js';
import { installCloseInteractions, resetDialogClose, showPanelDialog as showDialog } from './panel-close.js';
export { showDialog };
installCloseInteractions();

export function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'text') node.textContent = value ?? '';
    else if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== undefined) { if (key in node && !key.startsWith('aria-') && key !== 'list') node[key] = value; else node.setAttribute(key, value); }
  }
  for (const child of (Array.isArray(children) ? children : [children])) if (child != null) node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  return node;
}
export const button = (text, click, className = 'btn', attributes = {}) => el('button', { type: 'button', class: className, text, onClick: click, ...attributes });
export const badge = (text, className = '') => el('span', { class: `badge ${className}`, text });
export const labelRole = role => ({ user: '用户', assistant: '助手', tool: '工具', function: '工具', system: '系统', developer: '开发者', unknown: '未确认角色' }[role] ?? `其他角色：${role ?? '未知'}`);
export const labelStatus = status => ({ answered: '有回答', unanswered: '未回答 / 未采集到回答', generating: '生成中 · 可更新', incomplete: '内容缺失' }[status] ?? '状态未知');
export function timeLabel(time) {
  if (!time?.value) return '来源时间未知';
  const date = new Date(time.value);
  if (!Number.isFinite(date.getTime())) return '来源时间未知';
  if (time.precision === 'date_only') return `${date.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}（仅日期）`;
  return `${date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（${({ message: '消息时间', conversation: '对话时间', date_only: '仅日期' }[time.precision] ?? time.precision)}）`;
}
export const savedTime = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未知';
export async function rpc(type, args = {}) {
  const result = await chrome.runtime.sendMessage({ type, args });
  if (!result?.ok) {
    const error = new Error(result?.error ?? '扩展后台暂时没有响应，请重新打开插件。');
    error.code = result?.errorCode ?? result?.code ?? null;
    error.diagnostics = result?.diagnostics ?? null;
    throw error;
  }
  return result.data;
}
export function plainBody(text, query = '') {
  const body = el('div', { class: 'message-text' });
  if (!query) { body.textContent = text; return body; }
  let start = 0;
  for (const match of findTextMatches(text, query)) {
    body.append(document.createTextNode(text.slice(start, match.start)), el('mark', { text: text.slice(match.start, match.end) }));
    start = match.end;
  }
  body.append(document.createTextNode(text.slice(start))); return body;
}
export function ask(title, fields, explanation = '', {confirmLabel='确认',danger=false} = {}) {
  const dialog = document.querySelector('#edit-dialog'); resetDialogClose(dialog);dialog.replaceChildren();
  const form = el('form', { class: 'dialog-body', method: 'dialog' });
  form.append(el('h2', { text: title }), el('p', { class: 'muted', text: explanation }));
  const inputs = fields.map(field => {
    const control = field.options ? el('select', { name: field.name, 'aria-label': field.label }, field.options.map(o => el('option', { value: o.value, text: o.label }))) : el('input', { name: field.name, 'aria-label': field.label, type: 'text', required: field.required ?? true, value: field.value ?? '', placeholder: field.placeholder ?? '' });
    if (field.options && field.value != null) control.value = field.value;
    form.append(el('label', { class: 'field' }, [el('span', { text: field.label }), control])); return control;
  });
  let resolve;
  const result = new Promise(r => { resolve = r; });
  const cancel = () => { dialog.close(); resolve(null); };
  form.append(el('div', { class: 'actions' }, [button('取消', cancel), el('button', { type: 'submit', class: danger?'btn danger':'btn primary', text: confirmLabel })]));
  form.addEventListener('submit', event => { event.preventDefault(); const values = Object.fromEntries(inputs.map(input => [input.name, input.value])); dialog.close(); resolve(values); });
  dialog.oncancel = () => resolve(null); dialog.append(form); showDialog(dialog); inputs[0]?.focus(); return result;
}
export async function openSource(value) {
  try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol)) return; await chrome.tabs.create({ url: url.href }); } catch { /* Unknown or unavailable source remains local. */ }
}
