// Tests actual installed-source UI, background and IndexedDB under the isolated
// local source-flow bridge. No live account, downloads or business database.
import { readState } from '../storage/database.js';
import { EXTENSION_VERSION } from '../domain/common.js';

const pause = () => new Promise(resolve => requestAnimationFrame(resolve));
async function until(test) { for (let attempt = 0; attempt < 120; attempt++) { if (test()) return; await pause(); } throw new Error('UI did not reach the expected state'); }
export async function runFullFlowChecks() {
  if (!['localhost', '127.0.0.1'].includes(location.hostname) || !/^v04-v11-/.test(new URLSearchParams(location.search).get('validationDb') ?? '')) throw new Error('Requires an isolated full-conversation validation database');
  const checks = [], failures = [], state = await readState(), originalMode = document.querySelector('.conversation-view-switcher [aria-pressed="true"]')?.id;
  const expect = (value, message) => { if (!value) throw new Error(message); };
  const check = async (name, run) => { try { await run(); checks.push(name); } catch (error) { failures.push({ name, error: error.message }); } };
  const selected = document.querySelector('#conversation-map .conversation-map'), title = document.getElementById('map-title').textContent;
  const conversation = state.conversations.find(row => row.title === title);
  if (!conversation || !selected) throw new Error('Save and open the synthetic full conversation first');
  const path = state.paths.find(row => row.id === conversation.currentPathId), messages = state.messages.filter(row => row.conversationId === conversation.id);
  await check('完整记录包含39条消息，当前路径36条；较早消息与另一分支都已保存', () => {
    expect(conversation.lastScope.kind === 'conversation_record' && conversation.lastScope.history === 'provided', 'Not a full record capture');
    expect(messages.length === 39 && path.messageIds.length === 36, 'Full history or branch bodies missing');
    expect(messages.some(row => row.text.endsWith('FULL-ANSWER-18-END')) && messages.some(row => row.text.endsWith('BRANCH-COMPLETE-END')), 'Main or alternate branch tail missing');
  });
  await check('所有用户和助手角色自动识别，主路径18轮Q/A，无手工标注要求', () => {
    expect(messages.every(row => ['user', 'assistant'].includes(row.role) && !row.roleUnverified && !row.confirmedRole), 'Manual or unknown role remains');
    expect(state.qas.filter(row => row.pathId === path.id).length === 18, 'Automatic Q/A index missing');
    expect(!document.querySelector('#conversation-map .cm-role-controls'), 'Manual role controls present in full capture');
  });
  await check('四种展示入口可见、可点击且不会被折叠工具隐藏', () => {
    for (const id of ['qa-view-button', 'tree-view-button', 'snake-view-button', 'timeline-view-button']) { const control = document.getElementById(id); expect(control?.getClientRects().length && !control.closest('details') && !control.disabled, `${id} unavailable`); }
  });
  await check('树状图显示真实39个消息节点与38条父子连线，重新生成分支并列', async () => {
    document.getElementById('tree-view-button').click(); await until(() => document.querySelectorAll('.cm-tree-node').length === 39);
    expect(document.querySelectorAll('.cm-tree-lines path').length === 38, 'Parent-child lines missing');
    expect(document.querySelectorAll('.cm-other-branch').length === 3, 'Alternate branch not shown');
    const fork = [...document.querySelectorAll('.cm-tree-node')].filter(node => /A1|其他分支/.test(node.textContent)); expect(fork.length >= 2, 'Regenerated answer branch absent');
  });
  await check('图中另一分支可直接切换并读取完整正文，不混入主分支', async () => {
    document.querySelector('.cm-other-branch').click(); await until(() => document.querySelector('.cm-branch-select')?.value !== path.id);
    await until(() => document.querySelector('#conversation-map .cm-reading')?.textContent.includes('ALTERNATE-ANSWER-END'));
    const branch = document.querySelector('.cm-branch-select'); branch.value = path.id; branch.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => document.querySelector('.cm-branch-select')?.value === path.id && document.querySelector('#conversation-map .cm-reading')?.textContent.includes('FULL-ANSWER-1-END'));
  });
  await check('蛇形图完整排列当前分支36个节点，连线可见，末节点定位完整答案', async () => {
    document.getElementById('snake-view-button').click(); await until(() => document.querySelectorAll('.cm-snake-grid .cm-diagram-node').length === 36);
    await until(() => document.querySelectorAll('.cm-snake-lines > path').length === 35);
    const nodes = document.querySelectorAll('.cm-snake-grid .cm-diagram-node'); nodes[nodes.length - 1].click(); await until(() => document.querySelector('.cm-reading')?.textContent.includes('FULL-ANSWER-18-END'));
    expect(document.querySelector('.cm-message-selected')?.textContent.includes('FULL-ANSWER-18-END'), 'Snake node did not locate its full answer');
  });
  await check('时间线展示36个来源时间，按日期分组，时间未被采集时间替代', async () => {
    document.getElementById('timeline-view-button').click(); await until(() => document.querySelectorAll('.cm-timeline-item').length === 36);
    const times = [...document.querySelectorAll('.cm-timeline-time')]; expect(times.length === 36 && times.every(node => node.dateTime), 'Source timestamps missing');
    expect(times[0].dateTime === '2026-09-01T01:00:00.000Z' && times[0].textContent === '09:00:00', 'Wrong source time or timezone');
    expect(document.querySelectorAll('.cm-timeline-day').length === 5, 'Date grouping wrong');
  });
  await check('问答全文可以展开全部36条正文，代码、表格和最后答案完整', async () => {
    document.getElementById('qa-view-button').click(); await until(() => document.getElementById('qa-view-button').getAttribute('aria-pressed') === 'true');
    [...document.querySelectorAll('#conversation-map button')].find(node => node.textContent === '展开全部正文').click();
    await until(() => document.querySelectorAll('#conversation-map .cm-message').length === 36);
    expect(document.querySelector('.cm-reading').textContent.includes('FULL-ANSWER-18-END'), 'Last answer missing');
    expect(document.querySelector('.cm-reading pre code') && document.querySelector('.cm-reading table'), 'Markdown code or table missing');
  });
  await check('正文与图形没有导致页面横向溢出', () => { expect(document.documentElement.scrollWidth <= innerWidth + 1, 'Page overflow'); });
  if (originalMode) document.getElementById(originalMode).click();
  return { version: EXTENSION_VERSION, checkedAt: new Date().toISOString(), passed: checks.length, failed: failures.length, checks, failures,
    scope: 'Actual background, normalized full conversation, UI and isolated IndexedDB in Chromium; source network/Chrome scripting mocked with labelled structured fixtures. No live ChatGPT or MV3 permission acceptance.' };
}
