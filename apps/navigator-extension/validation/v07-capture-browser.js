// Validation only: actual browser DOM with deliberately synthetic ChatGPT URL
// inputs. No live-site capture, Chrome permissions, user account or DB access.
import { adapterFixtures, createBrowserFixtureDocument, fixtureOrigin } from './adapter-fixtures.mjs';
import { STORES } from '../storage/database.js';
import { createProject, saveConversation } from '../domain/captures.js';
import { exportProject, validateBackup } from '../domain/backup.js';
import { EXTENSION_VERSION } from '../domain/common.js';

const expect = (condition, reason) => { if (!condition) throw new Error(reason); };
const fresh = () => ({ ...Object.fromEntries(STORES.map(store => [store, []])), revision: 0 });

export async function runCaptureBrowserChecks() {
  const checks = [], failures = [], results = new Map();
  const check = async (name, run) => { try { await run(); checks.push(name); } catch (error) { failures.push({ name, error: error.message }); } };
  const scope = 'Actual browser DOM and pure save/backup domain with maintained labelled synthetic fixtures. No live ChatGPT, real account, extension installation/permission acceptance, IndexedDB writes, downloads, or network beyond the localhost adapter source.';
  const result = () => ({ version: EXTENSION_VERSION, adapterVersion: 'chatgpt-dom-v7', checkedAt: new Date().toISOString(), passed: checks.length, failed: failures.length, checks, failures, scope, fixtureOrigin });
  await check('仅允许本地合成DOM采集验证', () => {
    expect(location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname), '请在本地验证服务器运行。');
  });
  if (failures.length) return result();
  const frame = document.createElement('iframe'); frame.title = 'V0.7 脱敏合成采集测试';
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1000px;height:800px'; document.body.append(frame);
  const previous = globalThis.__ACVN_CHATGPT__;
  try {
    const source = await (await fetch('/adapters/chatgpt.js', { cache: 'no-store' })).text();
    const load = new Function('location', 'document', 'getComputedStyle', 'Node', 'setTimeout', source + '\nreturn globalThis.__ACVN_CHATGPT__;');
    for (const fixture of adapterFixtures.filter(row => /^v[67]-/.test(row.key))) await check(`真实DOM：${fixture.label}`, async () => {
      const fixtureDocument = createBrowserFixtureDocument(fixture, frame.contentDocument);
      const adapter = load(new URL(fixture.url), fixtureDocument, frame.contentWindow.getComputedStyle.bind(frame.contentWindow), frame.contentWindow.Node, setTimeout);
      const captured = await adapter.collect(); results.set(fixture.key, captured);
      expect(adapter.version === 'chatgpt-dom-v7', '运行了旧适配器。');
      if (fixture.expectedError) {
        expect(!captured.ok && captured.errorCode === fixture.expectedError, '错误类型不正确。'); return;
      }
      expect(captured.ok, captured.reason ?? '采集失败。');
      const messages = captured.conversation.messages;
      expect(messages.length === fixture.expectedMessages, `正文数量不正确：${messages.length}`);
      if (fixture.expectedMode) expect(captured.diagnostics.captureMode === fixture.expectedMode, '识别模式不正确。');
      if (fixture.expectedRoles) expect(JSON.stringify(messages.map(message => message.role)) === JSON.stringify(fixture.expectedRoles), '角色与明确证据不一致。');
      if (fixture.expectedSourceIds) expect(JSON.stringify(messages.map(message => message.sourceMessageId)) === JSON.stringify(fixture.expectedSourceIds), '消息身份或未知来源处理不正确。');
      fixture.expectedContains?.forEach((phrases, index) => phrases.forEach(phrase => expect(messages[index].text.includes(phrase), `第${index + 1}段丢失完整正文：${phrase}`)));
      expect(captured.conversation.scope.coverage.fullHistory === 'unknown', '不能宣称完整历史。');
      expect(messages.filter(message => message.role === 'unknown').every(message => message.roleUnverified), '未知角色被冒充确认角色。');
      if (messages.some(message => message.roleUnverified)) expect(captured.diagnostics.notices.some(notice => notice.code === 'role_unverified'), '未知正文缺少准确诊断说明。');
    });
    await check('真实DOM：问题与助手答案分离、代码结构及前后全文完整', () => {
      const [question, answer] = results.get('v6-assistant-marker').conversation.messages;
      expect(answer.role === 'assistant' && answer.raw.roleBasis === 'DOM.assistant-message-marker', '助手标记未识别。');
      expect(!answer.text.includes(question.text) && !question.text.includes('MARKER-BEGIN'), '问题与答案混合。');
      expect(answer.text.startsWith('完整回答开头') && answer.text.endsWith('MARKER-END。'), '答案开头或结尾遗漏。');
      expect(answer.presentation.blocks.find(block => block.type === 'code')?.text === 'const value = 42;\nconsole.log(value);', '代码正文不完整。');
      expect(!answer.text.includes('Copy'), '复制按钮混入正文。');
    });
    await check('真实DOM：未知嵌套排版原文顺序保持前中后', () => {
      const text = results.get('v6-css-interleaving').conversation.messages[0].text;
      expect(text.indexOf('BEFORE-FORMAT') < text.indexOf('MIDDLE-FORMAT') && text.indexOf('MIDDLE-FORMAT') < text.indexOf('AFTER-FORMAT'), '正文排版片段顺序改变。');
    });
    await check('真实DOM：通用section多轮问题与未知答案分开，不合并也不重排', () => {
      for (const key of ['v7-multi-turn-generic-section', 'v7-multi-turn-wide-css-section', 'v7-multi-turn-shared-turn']) {
        const messages = results.get(key).conversation.messages;
        expect(messages.map(message => message.role).join('|') === 'user|unknown|user|unknown', '多轮未按独立DOM分支排序。');
        expect(!messages[1].text.includes('QUESTION') && !messages[1].text.includes('ANSWER-TWO'), '第一答案包含其他问题或第二答案。');
        expect(!messages[3].text.includes('QUESTION') && !messages[3].text.includes('ANSWER-ONE'), '第二答案包含其他问题或第一答案。');
      }
      const answers = results.get('v7-multi-turn-wide-css-section').conversation.messages.filter(message => message.role === 'unknown');
      expect(JSON.stringify(answers.map(answer => answer.presentation.blocks.filter(block => block.type === 'code').map(block => block.text))) === JSON.stringify([['first_code_one()', 'first_code_two()'], ['second_code_one()', 'second_code_two()']]), '同一答案的多段代码不完整。');
    });
    await check('采集结果保存为真实QA，完整助手正文与不可变版本相同', async () => {
      const captured = results.get('v6-assistant-marker').conversation, before = JSON.stringify(captured);
      const state = fresh(), project = createProject(state, 'V0.7 完整答案 · 内存合成样例');
      await saveConversation(state, captured, project.id);
      expect(state.qas.length === 1 && state.qas[0].assistantMessageIds.length === 1, '保存后未形成真实问题和助手答案。');
      const answer = state.messages.find(message => message.id === state.qas[0].assistantMessageIds[0]), version = state.versions.find(row => row.id === answer.currentVersionId);
      expect(answer.text.endsWith('MARKER-END。') && answer.text === version.text && answer.role === 'assistant', '保存或版本关联丢失答案。');
      validateBackup(exportProject(state, project.id)); expect(JSON.stringify(captured) === before, '保存更改了采集来源对象。');
    });
    await check('混合页面未知回答保留并可备份，不推测已确认助手身份', async () => {
      const captured = results.get('v6-mixed-unknown-answer').conversation, state = fresh(), project = createProject(state, 'V0.7 未知回答 · 内存合成样例');
      await saveConversation(state, captured, project.id);
      expect(state.messages.length === 2 && state.qas[0].responseMessageIds.length === 1 && state.qas[0].assistantMessageIds.length === 0, '未知回答被漏掉或角色被推测。');
      expect(state.messages.find(message => message.role === 'unknown').text.endsWith('UNKNOWN-ANSWER-END。'), '未知回答完整尾部丢失。');
      validateBackup(exportProject(state, project.id));
    });
  } catch (error) { failures.push({ name: '采集浏览器验证执行', error: error.message }); }
  finally {
    frame.remove();
    if (previous === undefined) delete globalThis.__ACVN_CHATGPT__; else globalThis.__ACVN_CHATGPT__ = previous;
  }
  return result();
}
