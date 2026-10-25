export function fixturePayload() {
  const questions = ['ChatGPT 聊天采集如何读取 DOM 页面消息？', '聊天采集 DOM 如何读取正文和附件？', '聊天采集 DOM 如何识别流式回答变化？', '问答阅读器如何折叠和展开完整长回答？', '问答阅读器如何实现上一轮和下一轮？', '问答阅读界面如何定位完整对话原文？', '这个问题目前还没有回答'];
  const messages = questions.flatMap((text, i) => {
    const rows = [{ id: `q-${i}`, role: 'user', text }];
    if (i === 1) rows.push({ id: 'tool-1', role: 'tool', text: '工具观察：附件只有引用，未取得正文。' });
    if (i < questions.length - 1) rows.push({ id: `a-${i}`, role: 'assistant', text: i === 3 ? '问答阅读器长回答原文。'.repeat(280) : i < 3 ? '聊天采集 DOM 页面实际消息；未知信息保持未知。' : '问答阅读器完整正文、上一轮下一轮和原文定位。' });
    return rows;
  });
  return { provider: 'validation-fixture', project_title: 'V0.2 验证样例（隔离）', conversations: [
    { id: 'fixture-primary', title: '验证样例 · 聊天采集与问答阅读', messages },
    { id: 'fixture-secondary', title: '验证样例 · 项目中的第二条对话', messages: [{ id: 'other-q', role: 'user', text: '跨对话搜索稳定引用' }, { id: 'other-a', role: 'assistant', text: '搜索应定位真实 Q/A 和原文消息。' }] }
  ] };
}
