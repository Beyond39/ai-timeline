// Explicit synthetic regression inputs. No private or real ChatGPT history.
export const body = (id, text, extra = {}) => ({ id, author: { role: 'assistant' }, content: { content_type: 'text', parts: [text] }, status: 'finished_successfully', end_turn: true, channel: 'final', ...extra });
export const user = (id, text = '相同问题', time = null) => ({ id, author: { role: 'user' }, content: { content_type: 'text', parts: [text] }, status: 'finished_successfully', create_time: time });
export function graph(rows, current, conversationId = 'p0-source') {
  const mapping = { root: { parent: null, children: [], message: null } };
  for (const [id, parent, message] of rows) mapping[id] = { parent, children: [], message };
  for (const [id, node] of Object.entries(mapping)) if (node.parent) mapping[node.parent].children.push(id);
  return { id: conversationId, title: 'P0 回归 · 明确合成', current_node: current, mapping };
}
export const basic = () => graph([['q', 'root', user('q')], ['a', 'q', body('a', '# 完整答案\n\n- 第一项\n\n```js\nconst value = { x: "<box>" };\n```\n\n| 列 | 值 |\n| --- | --- |\n| A | B |\n\n$$x^2$$')]], 'a');
export const branches = current => graph([
  ['q', 'root', user('q')], ['good', 'q', body('good', '历史完整答案')],
  ['bad', 'q', body('bad', '已取消片段', { status: 'cancelled', end_turn: false })],
  ['stream', 'q', body('stream', '当前正在生成', { status: 'in_progress', end_turn: false })],
  ['empty', 'q', body('empty', '')]
], current);
