import { el, button } from './dom.js';
import { prepareDialogLayout } from './dialog-layout.js';

export class TopicManager {
  constructor({ api, onChanged, onError }) {
    this.api = api; this.onChanged = onChanged; this.onError = onError;
    this.dialog = el('dialog', { class: 'topic-dialog', 'aria-label': '管理项目主题' });
    document.body.append(this.dialog);
  }

  ask(title, fields, explanation = '') {
    const dialog = this.dialog;
    dialog.replaceChildren();
    dialog.setAttribute('aria-label', title);
    const form = el('form', { class: 'dialog-body', method: 'dialog', id: 'topic-dialog-form' });
    if (explanation) form.append(el('p', { class: 'muted', text: explanation }));
    const controls = fields.map(field => {
      const control = field.options
        ? el('select', { name: field.name, 'aria-label': field.label }, field.options.map(option => el('option', { value: option.value, text: option.label })))
        : el('input', { name: field.name, type: 'text', 'aria-label': field.label, required: field.required ?? true, value: field.value ?? '', placeholder: field.placeholder ?? '' });
      if (field.options && field.value != null) control.value = field.value;
      form.append(el('label', { class: 'field' }, [el('span', { text: field.label }), control]));
      return control;
    });
    let resolve;
    const result = new Promise(done => { resolve = done; });
    const cancel = () => { dialog.close(); resolve(null); };
    const confirm = el('button', { type: 'submit', class: 'btn primary', text: '确认' });
    // HTML's form association retains required-field validation and Enter
    // submission while the footer stays outside the scrolling form.
    confirm.setAttribute('form', form.id);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const values = Object.fromEntries(controls.map(control => [control.name, control.value]));
      dialog.close(); resolve(values);
    });
    dialog.oncancel = () => resolve(null);
    dialog.append(el('header', { class: 'dialog-header' }, [el('h2', { text: title }), button('关闭', cancel)]), form,
      el('footer', { class: 'preview-footer' }, [el('div', { class: 'actions' }, [button('取消', cancel), confirm])]));
    prepareDialogLayout(dialog);
    dialog.showModal();
    controls[0]?.focus();
    return result;
  }

  async open(view) {
    if (!view.topics.length) throw new Error('项目还没有主题。可在整理建议或片段“主题标签”中创建。');
    const fields = [
      { name: 'topicId', label: '要调整的主题', options: view.topics.map(t => ({ value: t.id, label: t.name })) },
      { name: 'operation', label: '操作', options: [{ value: 'rename', label: '重命名（保留颜色）' }, { value: 'merge', label: '合并到另一主题（使用目标颜色）' }] }
    ];
    const choice = await this.ask('管理项目主题', fields, '先计算影响范围，再由你确认；主题标签表示分类。'); if (!choice) return;
    const topic = view.topics.find(t => t.id === choice.topicId);
    const values = choice.operation === 'rename' ? await this.ask('设置主题新名称', [{ name: 'name', label: '名称', value: topic.name }]) :
      await this.ask('选择合并目标主题', [{ name: 'targetTopicId', label: '合并到', options: view.topics.filter(t => t.id !== topic.id).map(t => ({ value: t.id, label: t.name })) }], `“${topic.name}”会成为目标主题的别名。`);
    if (!values) return;
    if (choice.operation === 'merge' && !values.targetTopicId) throw new Error('需要另一个主题作为合并目标。');
    const impact = await this.api('topicPreview', { projectId: view.project.id, ...choice, ...values });
    const description = `${topic.name} → ${choice.operation === 'rename' ? values.name : view.topics.find(t => t.id === values.targetTopicId)?.name}\n影响 ${impact.segmentCount} 个有效片段、${impact.conversationCount} 条对话、${impact.suggestionCount} 条整理建议。已有修订中的标签引用会同步维护；待确认建议会要求复核。`;
    const confirmed = await this.ask('确认主题影响范围', [], description); if (!confirmed) return;
    await this.api('topicApply', { ...impact, ...choice, ...values, projectId: view.project.id }); await this.onChanged();
  }
}
