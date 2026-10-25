export const CARD_TYPES = ['概念解释', '代码实战', '决策记录', '灵感', '待验证', '方法总结'];
export const ORGANIZATION_STATES = ['未整理', '已确认', '待验证', '已归档'];
export const ADOPTION_STATES = ['未判断', '已采纳', '已否决', '待核实', '已实践'];

// Additive defaults: legacy tags remain intact and independently editable.
export function cardMetadata(value = {}) {
  return { title: '', notes: '', tags: [], contentType: '', organizationStatus: '未整理', adoptionStatus: '未判断', annotationSource: 'user', favorite: false, ...value, topic: value.topic ?? value.tags?.[0] ?? '' };
}
export function metadataTopics(rows) {
  return [...new Set(rows.flatMap(m => [m.topic, ...(m.tags ?? []), ...(m.autoTags??[])]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
