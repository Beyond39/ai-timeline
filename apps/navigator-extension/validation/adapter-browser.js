import { adapterFixtures, fixtureOrigin, createBrowserFixtureDocument } from './adapter-fixtures.mjs';
import { diagnosticPanel, buildDiagnosticReport } from '../ui/diagnostics.js';
import { EXTENSION_VERSION } from '../domain/common.js';

const summary = document.querySelector('#adapter-summary'), list = document.querySelector('#adapter-results');
const iframe = document.querySelector('#adapter-fixture');
const assert = (condition, reason) => { if (!condition) throw new Error(reason); };
document.querySelector('#run-adapter').addEventListener('click', async event => {
  event.target.disabled = true; list.replaceChildren(); summary.textContent = '正在运行真实 DOM 合成样例…';
  const checks = [], failures = [];
  try {
    const source = await (await fetch('../adapters/chatgpt.js', { cache: 'no-store' })).text();
    // The URL is explicitly synthetic test input. This wrapper is excluded from
    // every extension release and is never used to claim a live ChatGPT capture.
    const load = new Function('location', 'document', 'getComputedStyle', 'Node', 'setTimeout', source + '\nreturn globalThis.__ACVN_CHATGPT__;');
    for (const fixture of adapterFixtures) {
      const row = document.createElement('li'); list.append(row);
      try {
        const fixtureDocument = createBrowserFixtureDocument(fixture, iframe.contentDocument);
        const adapter = load(new URL(fixture.url), fixtureDocument, iframe.contentWindow.getComputedStyle.bind(iframe.contentWindow), iframe.contentWindow.Node, callback => {
          if (fixture.loadedTree) createBrowserFixtureDocument({ ...fixture, tree: fixture.loadedTree }, fixtureDocument);
          if (fixture.changedText) fixtureDocument.querySelector('[data-message-id="assistant-one"] [data-message-content]').textContent = fixture.changedText;
          setTimeout(callback, 0);
        });
        const result = await adapter.collect();
        if (fixture.expectedError) { assert(!result.ok, '应拒绝失败样例'); assert(result.errorCode === fixture.expectedError, '错误类别不一致'); }
        else {
          assert(result.ok, result.reason ?? '采集失败'); assert(result.conversation.messages.length === fixture.expectedMessages, '实际消息数量不一致');
          if (fixture.expectedMode) assert(result.diagnostics.captureMode === fixture.expectedMode, '读取模式不一致');
          if (fixture.expectedRoles) assert(JSON.stringify(result.conversation.messages.map(message => message.role)) === JSON.stringify(fixture.expectedRoles), '明确角色或未知状态不一致');
          if (fixture.expectedSourceIds) assert(JSON.stringify(result.conversation.messages.map(message => message.sourceMessageId)) === JSON.stringify(fixture.expectedSourceIds), '消息来源身份不一致');
          fixture.expectedContains?.forEach((phrases, index) => phrases.forEach(phrase => assert(result.conversation.messages[index].text.includes(phrase), '完整正文或尾部丢失')));
          if (fixture.key === 'reported-zero-markers') {
            assert(result.diagnostics.pageStructure.authorRoleMarkers === 0 && result.diagnostics.pageStructure.readableBodyBlocks === 5, '用户诊断同型结构数量不一致');
            assert(result.conversation.messages.every(message => message.role === 'unknown' && message.roleUnverified), '不能由正文格式猜测说话人');
            assert(result.conversation.messages.at(-1).text.endsWith('ROLELESS-END。'), '未取得完整尾部');
          }
          assert(result.conversation.scope.coverage.fullHistory === 'unknown', '不能宣称完整历史');
          if (fixture.key === 'stream') assert(result.conversation.messages[1].streaming === 'generating', '变化正文未标记生成中');
          if (fixture.key === 'section-turns') {
            const messages = result.conversation.messages, answer = messages[1];
            assert(messages.map(row => row.role).join('|') === 'user|assistant', 'section 角色不一致');
            assert(answer.text.endsWith('这是回答的完整尾部。'), '长回答末尾未保留');
            assert(answer.presentation.blocks.find(row => row.type === 'code').text === 'open\nhigh\nlow\nclose\nvolume\nreturns', 'section 代码不完整');
            assert(!answer.text.includes('ChatGPT said:') && !answer.text.includes('Copy'), '角色标题或按钮进入正文');
          }
          if (fixture.key === 'outside-main') assert(result.diagnostics.pageStructure.candidateMessages === 2, 'main 外结构诊断不一致');
          if (fixture.key === 'structured') {
            const message = result.conversation.messages[1], code = message.presentation.blocks.find(block => block.type === 'code'), table = message.presentation.blocks.find(block => block.type === 'table');
            assert(code.text === 'const value = "<script>";\nconsole.log(value);', '代码未完整保留');
            assert(table.headers.join('|') === '字段|状态' && table.rows[0].join('|') === '来源时间|未知', '真实 DOM 表格单元格未保留');
            assert(!message.text.includes('Copy'), '复制控制按钮进入正文');
            document.querySelector('#adapter-diagnostic').replaceChildren(diagnosticPanel(result.diagnostics, { extras: { sourceUrl: result.conversation.sourceUrl, title: result.conversation.title } }));
            const defaultCopy = JSON.stringify(buildDiagnosticReport(result.diagnostics));
            assert(!defaultCopy.includes('synthetic-code') && !defaultCopy.includes('代码 / 表格'), '默认诊断泄漏来源地址或标题');
          }
        }
        checks.push(fixture.label); row.textContent = `通过：${fixture.label}`;
      } catch (error) { failures.push({ name: fixture.label, error: error.message }); row.textContent = `失败：${fixture.label} — ${error.message}`; }
    }
    try {
      const fixture = adapterFixtures.find(row => row.key === 'reported-zero-markers'), fixtureDocument = createBrowserFixtureDocument(fixture, iframe.contentDocument);
      const scroller = fixtureDocument.querySelector('main'); scroller.style.height = '220px'; scroller.style.overflowY = 'auto';
      const spacer = fixtureDocument.createElement('div'); spacer.style.height = '1000px'; scroller.insertBefore(spacer, scroller.firstChild); scroller.scrollTop = 700;
      const before = scroller.scrollTop;
      const adapter = load(new URL(fixture.url), fixtureDocument, iframe.contentWindow.getComputedStyle.bind(iframe.contentWindow), iframe.contentWindow.Node, callback => setTimeout(callback, 0));
      const result = await adapter.collect({ loadEarlier: true });
      assert(result.ok && result.conversation.messages.length === 5, '上滚后正文未完整取得');
      assert(scroller.scrollTop < before && before - scroller.scrollTop <= 220, '未只向上移动一屏');
      assert(result.diagnostics.notices.some(row => row.code === 'scrolled_partial') && result.conversation.scope.coverage.fullHistory === 'unknown', '上滚范围提示不准确');
      checks.push('实际滚动容器上滚一屏且继续保留5段正文');
      const row = document.createElement('li'); row.textContent = '通过：实际滚动容器上滚一屏且继续保留5段正文'; list.append(row);
    } catch (error) { failures.push({ name: '实际滚动容器上滚一屏', error: error.message }); }
  } catch (error) { failures.push({ name: 'harness', error: error.message }); }
  const report = { version: EXTENSION_VERSION, adapterVersion: 'chatgpt-dom-v7', checkedAt: new Date().toISOString(), fixtureOrigin, passed: checks.length, failed: failures.length, checks, failures,
    scope: 'Actual browser DOM with explicitly synthetic URL inputs; no user account, extension installation or permission acceptance.' };
  document.querySelector('#adapter-report').textContent = JSON.stringify(report, null, 2);
  summary.textContent = `完成：${checks.length} 项通过，${failures.length} 项失败。范围：合成结构的真实 DOM 回归。`;
  globalThis.__ACVN_ADAPTER_BROWSER_REPORT__ = report;
  event.target.disabled = false;
});
