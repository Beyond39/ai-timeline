import { el, button, savedTime, showDialog } from './dom.js';
import { prepareDialogLayout } from './dialog-layout.js';

export class MemoryPanel {
  constructor({ api, onRestored, onError, onChanged }) { Object.assign(this, { api, onRestored, onError, onChanged }); this.epoch = 0; }
  close() { this.epoch++; this.dialog?.close(); this.dialog?.remove(); this.dialog = null; }
  async open() {
    this.close(); const epoch = this.epoch;
    const dialog = this.dialog = el('dialog', { class: 'memory-dialog' });
    const body = el('div', { class: 'dialog-body' }, [el('p', { text: '正在读取本地记忆…' })]);
    dialog.append(el('div', { class: 'dialog-header' }, [el('div', {}, [el('span', { class: 'eyebrow', text: 'LOCAL MEMORY' }), el('h2', { text: '记忆与备份' })]), button('关闭', () => this.close())]), body);
    document.body.append(dialog); prepareDialogLayout(dialog); showDialog(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    try {
      const status = await this.api('memoryStatus'); if (epoch !== this.epoch) return;
      body.replaceChildren(el('p', { text: `此浏览器保存 ${status.projects} 个项目、${status.conversations} 个 Conversation、${status.messages} 条正文和 ${status.versions} 份历史版本。` }),
        el('p', { class: 'muted', text: '更新沿用原资料库，并在首次打开新版时为已有资料建立恢复点。恢复会创建新项目，不覆盖当前资料。卸载扩展或清除浏览器资料仍可能丢失本地数据，请另存备份。' }),
        el('p', { class: 'muted', text: '“导出整个资料库”包含 Project Workspace 的对话关联、主题、人工调整和上下文包。单个来源项目的备份只包含其原有资料。' }));
      const field = el('input', { type: 'text', placeholder: '恢复点名称（可选）', 'aria-label': '恢复点名称', maxLength: 100 });
      const message = el('p', { class: 'muted', role: 'status' });
      const perform = action => async event => { const control = event?.currentTarget; if (control) control.disabled = true; try { await action(); } catch (error) { if (epoch !== this.epoch) return; message.textContent = error.message; this.onError?.(error.message); } finally { if (control) control.disabled = false; } };
      const file = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
      body.append(el('label', { class: 'field' }, [el('span', { text: '保存当前资料的恢复点' }), field]),
        el('div', { class: 'actions' }, [button('建立恢复点', perform(async () => { await this.api('memoryCreate', { name: field.value || undefined }); if (epoch === this.epoch) await this.open(); }), 'btn primary'),
          button('导出整个资料库', perform(async () => {
            const data = await this.api('memoryExport'); if (epoch !== this.epoch) return;
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), link = el('a', { href: url, download: `conversation-memory-${new Date().toISOString().slice(0, 10)}.json` });
            dialog.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); message.textContent = '已请求保存资料库备份，请核对浏览器下载。';
          })), button('导入资料库备份', () => file.click())]), file, message,
        el('h3', { text: '可恢复的资料' }));
      file.addEventListener('change', async () => {
        const selected = file.files[0]; if (!selected) return;
        try {
          const text = await selected.text(), preview = await this.api('memoryImportPreview', { text }); if (epoch !== this.epoch) return;
          const confirm = el('section', { class: 'memory-point' }, [el('strong', { text: selected.name }), el('p', { text: `包含 ${preview.projects} 个项目、${preview.conversations} 个 Conversation、${preview.messages} 条正文。恢复为独立新项目。` })]);
          confirm.append(button('确认恢复这些项目', perform(async () => { const result = await this.api('memoryImport', { text }); if (epoch !== this.epoch) return; this.close(); await this.onRestored?.(result); }), 'btn primary'), button('取消', () => confirm.remove())); body.append(confirm);
        } catch (error) { message.textContent = error.message; } finally { file.value = ''; }
      });
      if (!status.points.length) body.append(el('p', { class: 'muted', text: '尚未建立恢复点；现有正文与历史版本仍保存在本地。' }));
      for (const point of status.points) {
        const row = el('section', { class: 'memory-point' }, [el('strong', { text: point.name }), el('p', { class: 'muted', text: `${savedTime(point.createdAt)} · ${point.projectCount} 个项目 · ${point.messageCount} 条正文` })]);
        row.append(button('恢复为新项目', perform(async () => {
          const result = await this.api('memoryRestore', { pointId: point.id, expectedChecksum: point.checksum }); if (epoch !== this.epoch) return; this.close(); await this.onRestored?.(result);
        }))); body.append(row);
      }
      const suggestions = await this.api('organizationArchiveList'); if (epoch !== this.epoch) return;
      if (suggestions.length) {
        const archived = el('details', { class: 'memory-archives' }, [el('summary', { text: `整理建议与归档 · ${suggestions.length} 份` })]);
        for (const suggestion of suggestions) {
          const row = el('section', { class: 'memory-point' }, [el('strong', { text: suggestion.title }), el('p', { class: 'muted', text: `${suggestion.projectName} · ${suggestion.archivedAt ? '已归档' : '使用中'} · ${savedTime(suggestion.createdAt)}` })]);
          row.append(button(suggestion.archivedAt ? '恢复建议' : '归档建议', perform(async () => { await this.api('organizationArchive', { projectId: suggestion.projectId, suggestionId: suggestion.id, expectedRevision: suggestion.revision, archived: !suggestion.archivedAt }); if (epoch !== this.epoch) return; await this.onChanged?.(); await this.open(); }))); archived.append(row);
        }
        body.append(archived);
      }
    } catch (error) { if (epoch === this.epoch) body.replaceChildren(el('p', { class: 'error', text: error.message })); }
  }
}
