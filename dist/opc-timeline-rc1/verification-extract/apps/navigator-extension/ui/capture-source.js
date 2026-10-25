import { el, button, showDialog } from './dom.js';
import { prepareDialogLayout } from './dialog-layout.js';

export class CaptureSourcePanel {
  constructor({ api, onCapture }) { Object.assign(this, { api, onCapture }); this.epoch = 0; }
  close() { this.epoch++; this.dialog?.close(); this.dialog?.remove(); this.dialog = null; }
  async open(args = {}) {
    this.close(); const epoch = this.epoch, dialog = this.dialog = el('dialog', { class: 'capture-source-dialog' }), body = el('div', { class: 'dialog-body' }, [el('p', { text: '正在核对来源…' })]);
    dialog.append(el('div', { class: 'dialog-header' }, [el('h2', { text: '采集来源' }), button('关闭', () => this.close())]), body); document.body.append(dialog); prepareDialogLayout(dialog); showDialog(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    try {
      const source = await this.api('captureSourceStatus', args); if (epoch !== this.epoch) return;
      if (!source.available) { body.replaceChildren(el('p', { text: source.reason }), el('p', { class: 'muted', text: '在需要采集的 ChatGPT 页面点击工具栏插件图标，再打开这里。' })); return; }
      body.replaceChildren(el('strong', { text: source.title }), el('p', { class: 'muted source-address', text: source.url }),
        el('p', { text: source.changed ? '这个标签当前打开了另一条对话，可以直接采集。上面是本次来源的标题和地址。' : '将采集上面这个标签页当前打开的对话。' }));
      const status = el('p', { role: 'status', class: 'muted' });
      const capture = button('采集这条对话', async () => {
        capture.disabled = true;
        try { await this.api('captureSourceRebind', { sourceTabId: source.tabId, expectedSourceUrl: source.url }); if (epoch !== this.epoch) return; this.close(); await this.onCapture?.(source.tabId, source.url); }
        catch (error) { status.textContent = error.message; capture.disabled = false; }
      }, 'btn primary'); body.append(capture, status);
    } catch (error) { if (epoch === this.epoch) body.replaceChildren(el('p', { class: 'error', text: error.message })); }
  }
}
