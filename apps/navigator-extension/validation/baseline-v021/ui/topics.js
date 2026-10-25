import { el, button, ask } from './dom.js';

export class TopicManager {
  constructor({ api, onChanged, onError }) { this.api = api; this.onChanged = onChanged; this.onError = onError; }
  async open(view) {
    if (!view.topics.length) throw new Error('项目还没有主题。可在整理建议或片段“主题标签”中创建。');
    const fields = [
      { name: 'topicId', label: '要调整的主题', options: view.topics.map(t => ({ value: t.id, label: t.name })) },
      { name: 'operation', label: '操作', options: [{ value: 'rename', label: '重命名（保留颜色）' }, { value: 'merge', label: '合并到另一主题（使用目标颜色）' }] }
    ];
    const choice = await ask('管理项目主题', fields, '先计算影响范围，再由你确认；主题标签表示分类。'); if (!choice) return;
    const topic = view.topics.find(t => t.id === choice.topicId);
    const values = choice.operation === 'rename' ? await ask('设置主题新名称', [{ name: 'name', label: '名称', value: topic.name }]) :
      await ask('选择合并目标主题', [{ name: 'targetTopicId', label: '合并到', options: view.topics.filter(t => t.id !== topic.id).map(t => ({ value: t.id, label: t.name })) }], `“${topic.name}”会成为目标主题的别名。`);
    if (!values) return;
    if (choice.operation === 'merge' && !values.targetTopicId) throw new Error('需要另一个主题作为合并目标。');
    const impact = await this.api('topicPreview', { projectId: view.project.id, ...choice, ...values });
    const description = `${topic.name} → ${choice.operation === 'rename' ? values.name : view.topics.find(t => t.id === values.targetTopicId)?.name}\n影响 ${impact.segmentCount} 个有效片段、${impact.conversationCount} 条对话、${impact.suggestionCount} 条整理建议。已有修订中的标签引用会同步维护；待确认建议会要求复核。`;
    const confirmed = await ask('确认主题影响范围', [], description); if (!confirmed) return;
    await this.api('topicApply', { ...impact, ...choice, ...values, projectId: view.project.id }); await this.onChanged();
  }
}
