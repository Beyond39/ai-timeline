import { el, button, labelRole } from './dom.js';
import { prepareDialogLayout } from './dialog-layout.js';
import { LINK_TYPES } from '../domain/conversation-links.js';

export class ConnectionsPanel {
  constructor({ api, onNavigate, onError }) { Object.assign(this, { api, onNavigate, onError }); this.epoch = 0; this.archived = false; }
  close() { this.epoch++; this.dialog?.close(); this.dialog?.remove(); this.dialog = null; }
  async open(scope) {
    this.close(); const epoch = this.epoch, dialog = this.dialog = el('dialog', { class: 'connections-dialog' }), body = el('div', { class: 'dialog-body' }, [el('p', { text: '正在读取关联…' })]);
    dialog.append(el('div', { class: 'dialog-header' }, [el('div', {}, [el('span', { class: 'eyebrow', text: 'CONNECTED CONVERSATIONS' }), el('h2', { text: '关联讨论' })]), button('关闭', () => this.close())]), body);
    document.body.append(dialog); prepareDialogLayout(dialog); dialog.showModal(); dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    try {
      const [sources, links] = await Promise.all([this.api('connectionSources', { projectId: scope.projectId }), this.api('connectionList', { projectId: scope.projectId, archived: this.archived })]);
      if (epoch !== this.epoch) return;
      const message = el('p', { class: 'muted', role: 'status' });
      const perform = action => async event => { const control = event?.currentTarget; if (control) control.disabled = true; try { await action(); } catch (error) { if (epoch !== this.epoch) return; message.textContent = error.message; this.onError?.(error.message); } finally { if (control) control.disabled = false; } };
      body.replaceChildren(el('p', { class: 'muted', text: '由你确认讨论之间的关系。每一端都绑定确切的正文版本，更新回答后仍可核对原来的依据。' }),
        button(this.archived ? '查看使用中的关联' : '查看已归档关联', async () => { this.archived = !this.archived; await this.open(scope); }), message);
      if (!this.archived && sources.conversations.length >= 2) {
        const form = el('section', { class: 'connection-create' }), selects = [];
        for (const [label, initial] of [['来自这条讨论', scope.conversationId], ['关联到另一条讨论', sources.conversations.find(row => row.id !== scope.conversationId)?.id]]) {
          const conversation = el('select', { 'aria-label': label }, sources.conversations.map(row => el('option', { value: row.id, text: row.title })));
          conversation.value = initial || sources.conversations[0].id;
          const evidence = el('select', { 'aria-label': `${label}的正文依据` });
          const fill = () => { evidence.replaceChildren(...sources.messages.filter(row => row.conversationId === conversation.value).map(row => el('option', { value: row.id, text: `${labelRole(row.role)} · ${row.textPreview || '正文未取得'}` }))); };
          conversation.addEventListener('change', fill); fill(); selects.push({ conversation, evidence });
          form.append(el('label', { class: 'field' }, [el('span', { text: label }), conversation]), el('label', { class: 'field' }, [el('span', { text: '选择确切正文' }), evidence]));
        }
        const type = el('select', { 'aria-label': '关联类型' }, Object.entries(LINK_TYPES).map(([value, text]) => el('option', { value, text })));
        const note = el('textarea', { 'aria-label': '关联说明', placeholder: '为什么把两段讨论联系起来？（可选）', rows: 3, maxLength: 2000 });
        form.append(el('label', { class: 'field' }, [el('span', { text: '关系' }), type]), note,
          button('保存关联', perform(async () => {
            const references = selects.map(choice => { const row = sources.messages.find(item => item.id === choice.evidence.value && item.conversationId === choice.conversation.value); if (!row) throw new Error('请选择实际保存的正文。'); return { conversationId: row.conversationId, messageId: row.id, versionId: row.currentVersionId }; });
            await this.api('connectionSave', { projectId: scope.projectId, from: references[0], to: references[1], type: type.value, note: note.value }); if (epoch === this.epoch) await this.open(scope);
          }), 'btn primary'));
        body.append(el('details', { class: 'connection-editor' }, [el('summary', { text: '＋ 建立关联' }), form]));
      }
      if (!links.length) body.append(el('div', { class: 'empty' }, [el('h3', { text: this.archived ? '还没有归档的关联' : '把分散的讨论联系起来' }), el('p', { text: sources.conversations.length < 2 ? '先在同项目保存至少两条 Conversation。' : '选择两个具体问题或回答，建立一条有出处的关联。' })]));
      for (const link of links) {
        const card = el('section', { class: 'connection-card' }, [el('strong', { text: LINK_TYPES[link.type] }), link.note ? el('p', { text: link.note }) : null]);
        for (const endpoint of [link.fromSource, link.toSource]) card.append(el('div', { class: 'connection-evidence' }, [el('strong', { text: endpoint.title }), el('p', { class: 'muted', text: endpoint.excerpt || '正文不可用' }),
          button(endpoint.historical ? '查看当时的正文' : '查看这段正文', perform(async () => { this.close(); await this.onNavigate?.(endpoint); }), 'btn quiet', { disabled: !endpoint.available })]));
        card.append(button(this.archived ? '恢复关联' : '归档关联', perform(async () => { await this.api('connectionArchive', { projectId: scope.projectId, linkId: link.id, expectedRevision: link.revision, archived: !this.archived }); if (epoch === this.epoch) await this.open(scope); }))); body.append(card);
      }
    } catch (error) { if (epoch === this.epoch) body.replaceChildren(el('p', { class: 'error', text: error.message })); }
  }
}
