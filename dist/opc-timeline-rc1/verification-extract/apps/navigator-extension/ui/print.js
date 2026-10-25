import { el, rpc } from './dom.js';
import { renderDocument, DOCUMENT_STYLES } from '../exports/render.js';
import { validateDocument } from '../exports/content.js';

const states = new WeakMap();
const PRINT_STYLES = `body[data-mode="print"]{background:#f4f6fb;margin:0}.print-toolbar{max-width:960px;margin:18px auto;padding:16px 22px;background:white;border:1px solid #e1e6ef;border-radius:12px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}.print-toolbar strong{font-size:16px}.print-toolbar p{font-size:12px;color:#64748b;margin:7px 0 0;line-height:1.7}.print-status{max-width:900px;margin:12px auto;font-size:12px;color:#64748b;padding:0 16px;line-height:1.7}.print-status.error{color:#b45309}.print-content{margin:18px auto 32px;max-width:960px;background:white;box-shadow:0 8px 24px #3341550a}.print-content>.export-document{max-width:900px}@media(max-width:600px){.print-toolbar{margin:12px;padding:14px}.print-toolbar .actions{width:100%}.print-content{margin:12px 0}}@media print{body[data-mode="print"]{background:white}.print-toolbar,.print-status{display:none!important}.print-content{max-width:none;margin:0;box-shadow:none}.print-content>.export-document{max-width:none;margin:0}}`;

export async function loadPrintPage({ api = rpc, location = globalThis.location, host = document.querySelector('#print-content'), status = document.querySelector('#print-status'), printButton = document.querySelector('#print-button') } = {}) {
  if (!host || !status || !printButton) throw new Error('打印页面缺少必要的显示区域。');
  const epoch = (states.get(host)?.epoch ?? 0) + 1; states.set(host, { epoch });
  printButton.disabled = true; host.replaceChildren(); status.classList.remove('error'); status.textContent = '正在读取已保存的打印快照…';
  try {
    const snapshotId = new URLSearchParams(location.search).get('record');
    if (!snapshotId || !/^[A-Za-z0-9_-]{5,200}$/.test(snapshotId)) throw new Error('打印快照链接不完整。请回到资料包窗口，重新生成打印版。');
    const snapshot = await api('documentPrintGet', { snapshotId });
    if (states.get(host)?.epoch !== epoch) return;
    if (!snapshot?.document || snapshot.id !== snapshotId || snapshot.document.project?.id !== snapshot.projectId) throw new Error('打印快照的项目或身份不一致，未显示资料。');
    validateDocument(snapshot.document);
    host.replaceChildren(el('style', { text: DOCUMENT_STYLES + PRINT_STYLES }), renderDocument(document, snapshot.document));
    document.title = `${snapshot.document.title} · 打印版`;
    status.textContent = `已读取选定版本的完整正文。快照保存于 ${snapshot.createdAt || '未知时间'}，后续对话更新不会改变本页内容。`;
    printButton.disabled = false; return snapshot;
  } catch (error) {
    if (states.get(host)?.epoch !== epoch) return;
    status.classList.add('error'); status.textContent = error.message; host.replaceChildren(el('p', { class: 'empty', text: '无法读取该打印快照。已保存的对话和资料包方案仍可在插件中查看。' }));
    return null;
  }
}

if (document.body?.dataset.mode === 'print') {
  document.head.append(el('style', { text: PRINT_STYLES }));
  document.querySelector('#print-button').addEventListener('click', () => { if (!document.querySelector('#print-button').disabled) window.print(); });
  document.querySelector('#print-retry').addEventListener('click', () => loadPrintPage());
  loadPrintPage();
}
