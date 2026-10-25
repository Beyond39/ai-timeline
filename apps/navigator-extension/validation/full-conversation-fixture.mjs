// Deliberately synthetic structured history. Its message count exceeds the
// visible DOM fixture and includes a regenerated-answer branch.
export function fullConversationFixture({ rounds = 18, id = 'synthetic-full-history', title = '完整 Conversation · 自动问答与四种视图 · 合成' } = {}) {
  const mapping = { root: { id: 'root', parent: null, children: [], message: null } }, base = Date.parse('2026-09-01T01:00:00Z') / 1000;
  const add = (key, parent, role, text, time) => {
    mapping[key] = { id: key, parent, children: [], message: { id: `${id}-${key}`, author: { role }, create_time: time,
      content: { content_type: 'text', parts: [text] }, status: 'finished_successfully', metadata: {} } };
    mapping[parent].children.push(key);
  };
  let parent = 'root';
  for (let round = 1; round <= rounds; round++) {
    const time = base + Math.floor((round - 1) / 4) * 86400 + (round - 1) % 4 * 3600;
    const question = round === 1 ? '怎样完整保存一条长 Conversation，并把问题、答案、分支和时间放进一个清楚的阅读界面？' : `第 ${round} 轮：请继续解释第 ${round} 个实现细节，并给出完整例子。`;
    const answer = `## ${round === 1 ? '从完整记录开始阅读' : `第 ${round} 轮完整回答`}\n\n每条消息都保留来源角色和消息时间。问题与答案自动配对，较早的对话无需滚动才能读取。\n\n### 可以怎样浏览\n\n- 问答全文：逐轮阅读问题和完整回答。\n- 树状图：查看真实父子关系和重新生成的分支。\n- 蛇形图：沿当前分支依次浏览消息。\n- 时间线：按对话顺序查看来源日期和时间。\n\n\x60\x60\x60js\nconst conversation = { round: ${round}, complete: true };\nconsole.log(conversation);\n\x60\x60\x60\n\n| 项目 | 结果 |\n| --- | --- |\n| 消息角色 | 自动读取 |\n| 正文范围 | 全部消息记录 |\n\n这是第 ${round} 轮回答的完整尾部。FULL-ANSWER-${round}-END`;
    add(`q${round}`, parent, 'user', question, time); add(`a${round}`, `q${round}`, 'assistant', answer, time + 75); parent = `a${round}`;
  }
  add('alternate-a1', 'q1', 'assistant', '这是第一轮重新生成的另一版回答。消息树应显示并列分支，不能把它接在原回答后面。ALTERNATE-ANSWER-END', base + 120);
  add('alternate-q2', 'alternate-a1', 'user', '请沿着这个分支继续讨论。', base + 160);
  add('alternate-a2', 'alternate-q2', 'assistant', '这是另一个分支的完整结尾。BRANCH-COMPLETE-END', base + 200);
  return { id, conversation_id: id, title, create_time: base, update_time: mapping[parent].message.create_time, current_node: parent, mapping };
}
