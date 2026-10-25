import { short, normalizeName } from '../domain/common.js';

export const RULE_METHOD = { kind: 'rules', name: '连续轮次与关键词规则', version: '0.2.0' };
const THEMES = [
  { name: '聊天采集', title: '聊天采集方案', words: ['采集', '抓取', '读取聊天', '读取对话', 'DOM', '选择器', 'content script', '消息识别', '流式'] },
  { name: '问答阅读', title: '问答阅读界面', words: ['阅读器', '阅读界面', '长回答', '问答阅读', '展开回答', '上一轮', '下一轮', 'Q/A'] },
  { name: '地图整理', title: '地图与讨论整理', words: ['地图', '分段', 'segment', '节点', '合并', '拆分', '主题', '整理建议'] },
  { name: '数据存储', title: '数据存储与关系', words: ['IndexedDB', '数据库', '存储', '数据契约', '版本', '数据关系', '增量更新', '持久'] },
  { name: '导入备份', title: '历史导入与备份', words: ['导入', '备份', 'conversations.json', '导出', '恢复'] },
  { name: '模型分析', title: '模型分析与适配', words: ['模型', '语义', 'AI分析', '分析提示', 'API', '结构化分析'] },
  { name: '安装发布', title: '插件安装与交付', words: ['安装', '发布', '打包', 'Chrome', 'Edge', 'Manifest', 'MV3', 'ZIP'] }
];

function classify(qa) {
  const question = normalizeName(qa.messages[0]?.text), answer = normalizeName(qa.messages.slice(1).map(m => m.text).join('\n')).slice(0, 6000);
  const scores = THEMES.map(theme => ({ theme, score: theme.words.reduce((sum, word) => sum + (question.includes(normalizeName(word)) ? 3 : 0) + (answer.includes(normalizeName(word)) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score);
  const best = scores[0];
  return best.score >= 2 ? best.theme : null;
}
function evidence(qas) {
  return qas.flatMap(qa => qa.evidence);
}
export function proposeRuleGroups(qas, manualSegments) {
  const locked = new Map(manualSegments.map(s => [s.qaIds[0], s])), byId = new Map(qas.map(q => [q.id, q])), groups = [];
  for (let index = 0; index < qas.length;) {
    const qa = qas[index], manual = locked.get(qa.id);
    if (manual) {
      const members = manual.qaIds.map(key => byId.get(key));
      groups.push({ title: manual.title, topics: [...manual.topics], qaIds: [...manual.qaIds],
        reason: '保留已有人工标题、主题与边界；规则没有覆盖这些设置。', evidence: evidence(members), preservedSegmentId: manual.id });
      index += members.length; continue;
    }
    const theme = classify(qa), members = [qa]; index++;
    while (index < qas.length && !locked.has(qas[index].id) && members.length < 8) {
      const nextTheme = classify(qas[index]);
      if (!theme || nextTheme?.name !== theme.name) break;
      members.push(qas[index]); index++;
    }
    groups.push({ title: theme?.title ?? (short(qa.messages[0]?.text, 42) || '待命名讨论'), topics: theme ? [theme.name] : [], qaIds: members.map(q => q.id),
      reason: theme ? `连续 ${members.length} 轮中出现“${theme.name}”关键词；规则在关键词变化、人工边界或每组 8 轮的上限处另起片段。规则仅作初步导航建议。` : '未识别到可靠的共享关键词，保留单轮边界，等待人工或模型复核。', evidence: evidence(members) });
  }
  return groups;
}
