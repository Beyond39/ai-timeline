import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { adapterFixtures, fixtureOrigin, element, message } from '../validation/adapter-fixtures.mjs';
import { domModel } from '../validation/adapter-dom-model.mjs';
import { buildDiagnosticReport } from '../ui/diagnostics.js';
import { STORES } from '../storage/database.js';
import { createProject, saveConversation } from '../domain/captures.js';
import { exportProject, validateBackup, restoreBackup } from '../domain/backup.js';
import { EXTENSION_VERSION, CAPTURE_ADAPTER_VERSION } from '../domain/common.js';
import { readConversationData } from '../adapters/conversation-data.js';
import { normalizeConversationData, DATA_ADAPTER_VERSION } from '../domain/full-conversation.js';
import { applyCaptureLabels } from '../domain/capture-labels.js';

const source = fs.readFileSync(new URL('../adapters/chatgpt.js', import.meta.url), 'utf8');
const checks = [], failures = [], results = new Map();
const plain = value => JSON.parse(JSON.stringify(value));
async function check(name, fn) {
  try { await fn(); checks.push(name); console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function captureFixture(fixture, options = {}) {
  const dom = domModel(fixture), location = new URL(fixture.url);
  const context = vm.createContext({ ...dom, location, URL, setTimeout: callback => {
    if (fixture.loadedTree) {
      const loaded = domModel({ ...fixture, tree: fixture.loadedTree });
      dom.document.childNodes = loaded.document.childNodes;
      dom.document.childNodes.forEach(node => { node.parentElement = dom.document; });
    }
    if (fixture.changedText) dom.document.querySelector('[data-message-id="assistant-one"] [data-message-content]').textContent = fixture.changedText;
    callback();
  } });
  vm.runInContext(source, context);
  return plain(await context.__ACVN_CHATGPT__.collect(options));
}
for (const fixture of adapterFixtures) await check(`适配器 ${fixture.label}`, async () => {
  const result = await captureFixture(fixture); results.set(fixture.key, result);
  if (fixture.expectedError) { assert.equal(result.ok, false); assert.equal(result.errorCode, fixture.expectedError); assert.equal(result.diagnostics.errors[0].code, fixture.expectedError); }
  else {
    assert.equal(result.ok, true); assert.equal(result.conversation.messages.length, fixture.expectedMessages); assert.equal(result.diagnostics.counts.messages, fixture.expectedMessages);
    assert.equal(result.conversation.scope.coverage.fullHistory, 'unknown');
    if (fixture.expectedMode) assert.equal(result.diagnostics.captureMode, fixture.expectedMode);
    if (fixture.expectedRoles) assert.deepEqual(result.conversation.messages.map(message => message.role), fixture.expectedRoles);
    if (fixture.expectedSourceIds) assert.deepEqual(result.conversation.messages.map(message => message.sourceMessageId), fixture.expectedSourceIds);
    if (fixture.expectedContains) fixture.expectedContains.forEach((phrases, index) => phrases.forEach(phrase => assert.ok(result.conversation.messages[index].text.includes(phrase), `第${index + 1}条缺少完整正文 ${phrase}`)));
  }
});

await check('普通对话的父子 / 时间 / 未展示分支保持未知', async () => {
  const c = results.get('ordinary').conversation;
  assert.equal(c.messages[0].sourceParentKey, null); assert.equal(c.messages[0].time.value, null);
  assert.equal(c.nativeProject.status, 'unknown'); assert.equal(c.scope.branches, 'not_collected');
  assert.equal(c.messages[0].presentation.format, 'plain'); assert.equal(c.sourceConversationId, 'synthetic-conversation');
});
await check('项目路径不推测原生名称，只有确实提供的属性进入记录', async () => {
  const c = results.get('project').conversation;
  assert.equal(c.diagnostics.pageType, 'project_conversation'); assert.equal(c.nativeProject.basis, 'DOM.data-project-id');
  const fixture = structuredClone(adapterFixtures.find(row => row.key === 'ordinary')); fixture.url = 'https://chatgpt.com/g/not-proven/c/example';
  assert.equal((await captureFixture(fixture)).conversation.nativeProject.status, 'unknown');
});
await check('流式变化按源消息 ID 比较并标为生成中', async () => {
  const c = results.get('stream').conversation;
  assert.equal(c.messages[1].streaming, 'generating'); assert.equal(c.diagnostics.counts.generating, 1);
  assert.equal(c.messages[1].text, '观察期间新增的回答文字。'); assert.equal(c.messages[1].sourceMessageId, 'assistant-one');
});
await check('DOM 代码和表格结构可验证，控制按钮不进入正文', async () => {
  const message = results.get('structured').conversation.messages[1], presentation = message.presentation;
  assert.equal(presentation.format, 'dom-structured'); assert.equal(presentation.status, 'verified_structure');
  const code = presentation.blocks.find(block => block.type === 'code'), table = presentation.blocks.find(block => block.type === 'table');
  assert.equal(code.text, 'const value = "<script>";\nconsole.log(value);'); assert.equal(code.language, 'javascript');
  assert.deepEqual(table.headers, ['字段', '状态']); assert.deepEqual(table.rows, [['来源时间', '未知']]);
  assert.ok(message.text.includes(code.text)); assert.ok(message.text.includes('来源时间')); assert.equal(message.text.includes('Copy'), false);
  assert.equal(presentation.blocks.find(block => block.type === 'paragraph' && block.inline)?.inline.map(part => part.text).join(''), '请使用 const x = 1。');
});
await check('空消息和附件引用分别计数，缺失不成为假正文', async () => {
  assert.equal(results.get('missing-body').diagnostics.counts.bodyUnavailable, 2);
  const c = results.get('tools-attachments').conversation;
  assert.equal(c.diagnostics.counts.referenceOnly, 1); assert.equal(c.messages[0].attachments[0].status, 'reference_only');
  assert.equal(c.diagnostics.capabilities.attachmentBodies, 'unavailable');
});
await check('隐藏 / 复制控制内容不进入可读正文和结构', async () => {
  const fixture = { label: '合成隐藏边界', url: 'https://chatgpt.com/c/hidden-synthetic', tree: element('main', {}, element('article', { 'data-testid': 'conversation-turn-hidden' }, element('div', { 'data-message-author-role': 'assistant', 'data-message-id': 'hidden-one' },
    element('div', { class: 'markdown' }, element('p', {}, '可见正文'), element('p', { hidden: '' }, '隐藏正文'), element('div', { style: 'display:none' }, '未显示内容'), element('button', {}, '复制控制'), element('pre', {}, element('code', {}, 'visible-code')))))) };
  const row = (await captureFixture(fixture)).conversation.messages[0];
  assert.equal(row.text.includes('隐藏正文'), false); assert.equal(row.text.includes('未显示内容'), false); assert.equal(row.text.includes('复制控制'), false);
  assert.equal(row.presentation.format, 'dom-structured'); assert.equal(row.presentation.textCoverage, 'all_readable_characters');
});
await check('结构未完整覆盖可读文字时回退原始普通文本', async () => {
  const fixture = { label: '合成未知列表结构', url: 'https://chatgpt.com/c/unknown-list', tree: element('main', {}, element('article', { 'data-testid': 'conversation-turn-list' }, element('div', { 'data-message-author-role': 'assistant', 'data-message-id': 'list-one' },
    element('div', { class: 'markdown' }, element('ul', {}, '列表中的额外可读文字', element('li', {}, '列表项')), element('pre', {}, element('code', {}, 'code')))))) };
  const row = (await captureFixture(fixture)).conversation.messages[0];
  assert.ok(row.text.includes('列表中的额外可读文字')); assert.equal(row.presentation.format, 'plain');
});
await check('DOM 文本中的 Markdown 符号不会被伪装成页面结构', async () => {
  const fixture = { label: '合成纯文本 Markdown', url: 'https://chatgpt.com/c/plain-markdown', tree: element('main', {}, message('user', 'literal-markdown', '# 原始文本\n```js\nconst x = 1;\n```')) };
  const row = (await captureFixture(fixture)).conversation.messages[0]; assert.equal(row.presentation.format, 'plain'); assert.ok(row.text.startsWith('# 原始文本'));
});

const fresh = () => ({ ...Object.fromEntries(STORES.map(store => [store, []])), revision: 0 });
await check('同文不同可靠源 ID 保存为独立消息 / 问答', async () => {
  const state = fresh(), project = createProject(state, '合成适配器回归');
  await saveConversation(state, results.get('same-text').conversation, project.id);
  assert.equal(state.messages.length, 4); assert.equal(state.qas.length, 2); assert.equal(new Set(state.messages.map(message => message.sourceMessageId)).size, 4);
});
await check('未答、多助手 / 工具 / 辅助消息均保留真实 Q/A', async () => {
  const state = fresh(), project = createProject(state, '合成适配器回归');
  await saveConversation(state, results.get('unanswered').conversation, project.id);
  assert.equal(state.qas.length, 2); assert.equal(state.qas.find(qa => qa.ordinal === 2).status, 'unanswered');
  const c = structuredClone(results.get('tools-attachments').conversation);
  c.messages.push({ ...c.messages.at(-1), sourceMessageId: 'a-tools-two', key: 'dom:4', position: 4, text: '第二条助手回答。' }); c.paths[0].messageKeys.push('dom:4');
  await saveConversation(state, c, project.id);
  const qa = state.qas.find(row => state.conversations.find(conv => conv.id === row.conversationId)?.sourceConversationId === 'synthetic-tools');
  assert.equal(qa.assistantMessageIds.length, 2); assert.equal(qa.toolMessageIds.length, 1); assert.equal(qa.responseMessageIds.length, 4);
});
await check('补采中间用户问题更新回答归属，滚动补采保留旧消息和原路径', async () => {
  const state = fresh(), project = createProject(state, '合成补采回归');
  await saveConversation(state, results.get('missing-middle-before').conversation, project.id);
  const firstQA = state.qas[0], firstMessageId = firstQA.userMessageId, assistantId = firstQA.assistantMessageIds[0];
  await saveConversation(state, results.get('missing-middle-after').conversation, project.id);
  assert.equal(state.messages.length, 3); assert.equal(state.qas.length, 2); assert.equal(firstQA.responseMessageIds.length, 0);
  assert.equal(state.qas.find(qa => qa.ordinal === 2).assistantMessageIds[0], assistantId);
  await saveConversation(state, results.get('partial-after-scroll').conversation, project.id);
  assert.equal(state.messages.length, 3); assert.ok(state.paths[0].messageIds.includes(firstMessageId)); assert.equal(state.qas.length, 2);
  assert.equal(state.qas.find(qa => qa.userMessageId === firstMessageId).notSeenInLatest, true);
  validateBackup(exportProject(state, project.id));
});
await check('正文结构与诊断进入不可变版本 / 快照并经备份恢复', async () => {
  const state = fresh(), project = createProject(state, '合成正文结构回归');
  await saveConversation(state, results.get('structured').conversation, project.id);
  const message = state.messages.find(row => row.sourceMessageId === 'code-one'), version = state.versions.find(row => row.id === message.currentVersionId);
  assert.deepEqual(version.presentation, message.presentation); assert.equal(message.presentation.format, 'dom-structured');
  assert.equal(state.snapshots[0].diagnostics.adapterVersion, 'chatgpt-dom-v7');
  const backup = exportProject(state, project.id); validateBackup(backup);
  const restored = fresh(), result = restoreBackup(restored, backup);
  assert.deepEqual(restored.versions.find(row => row.presentation?.format === 'dom-structured').presentation, version.presentation);
  validateBackup(exportProject(restored, result.projectId));
});
await check('默认可复制诊断严格不包含正文、账号、URL、标题、项目或源 ID', async () => {
  const malicious = structuredClone(results.get('ordinary').diagnostics);
  malicious.sourceUrl = 'https://secret.invalid/private-account'; malicious.title = 'secret-title'; malicious.text = 'secret-body'; malicious.projectName = 'secret-project';
  malicious.counts.roles['secret-account'] = 1; malicious.capabilities.sourceTime = 'secret-account'; malicious.technical = { account: 'secret-account' };
  malicious.pageStructure = { mainRegions: 1, threadRegions: 2, candidateMessages: 'secret-body', loadingIndicators: -1, extra: 'secret-account https://secret.invalid/private-account' };
  malicious.errors.push({ code: 'access_denied', reason: 'secret-account https://secret.invalid/private-account' });
  const text = JSON.stringify(buildDiagnosticReport(malicious));
  for (const forbidden of ['secret-account', 'secret.invalid', 'secret-title', 'secret-body', 'secret-project', 'user-one', 'synthetic-conversation']) assert.equal(text.includes(forbidden), false);
  assert.equal(buildDiagnosticReport(malicious).errors.at(-1).reason.includes('授权'), true);
  assert.equal(buildDiagnosticReport(malicious, { sourceUrl: malicious.sourceUrl, title: malicious.title }).userAttached.title, 'secret-title');
  assert.equal(buildDiagnosticReport(malicious).pageStructure.threadRegions, 2); assert.equal(buildDiagnosticReport(malicious).pageStructure.candidateMessages, 0);
  assert.equal(buildDiagnosticReport(malicious).pageStructure.loadingIndicators, 0);
});

await check('main 外的真实来源结构读取问题与回答，不受空 main 限制', async () => {
  const result = results.get('outside-main');
  assert.equal(result.diagnostics.pageType, 'project_conversation');
  assert.equal(result.diagnostics.pageStructure.threadRegions, 1);
  assert.equal(result.diagnostics.pageStructure.candidateMessages, 2);
  assert.deepEqual(result.conversation.messages.map(row => row.role), ['user', 'assistant']);
  assert.ok(result.conversation.messages[1].text.endsWith('正文已显示，即使不在 main 内也应读取。'));
});
await check('section 回退完整保留代码、尾部、角色及源身份，并排除说话人和按钮', async () => {
  const messages = results.get('section-turns').conversation.messages;
  assert.deepEqual(messages.map(row => row.role), ['user', 'assistant']);
  assert.deepEqual(messages.map(row => row.sourceMessageId), ['section-u', 'section-a']);
  assert.equal(messages[1].raw.roleBasis, 'DOM.data-turn');
  assert.ok(messages[1].text.endsWith('这是回答的完整尾部。'));
  assert.equal(messages[1].presentation.format, 'dom-structured');
  assert.equal(messages[1].presentation.blocks.find(row => row.type === 'code').text, 'open\nhigh\nlow\nclose\nvolume\nreturns');
  for (const message of messages) for (const control of ['You said:', 'ChatGPT said:', 'Copy', '复制回答']) assert.equal(message.text.includes(control), false);
});
await check('新结构保存后可阅读完整 QA，并可完整备份恢复', async () => {
  const state = fresh(), project = createProject(state, '合成 section 保存展示');
  const result = await saveConversation(state, results.get('section-turns').conversation, project.id);
  assert.equal(state.qas.length, 1); assert.equal(state.qas[0].assistantMessageIds.length, 1);
  assert.ok(state.messages.find(row => row.id === state.qas[0].assistantMessageIds[0]).text.endsWith('这是回答的完整尾部。'));
  const backup = exportProject(state, project.id); validateBackup(backup);
  const restored = fresh(), restoredProject = restoreBackup(restored, backup);
  validateBackup(exportProject(restored, restoredProject.projectId));
  assert.equal(restored.messages.find(row => row.role === 'assistant').text, state.messages.find(row => row.role === 'assistant').text);
  assert.equal(result.createdMessages, 2);
});
await check('明确说话人标题可识别，格式和位置不能替代角色证据', async () => {
  const messages = results.get('speaker-headings').conversation.messages;
  assert.deepEqual(messages.map(row => row.role), ['user', 'assistant']);
  assert.equal(messages[1].raw.roleBasis, 'DOM.speaker-heading');
  assert.equal(messages[1].text, '这是助手的完整回答。');
  assert.equal(results.get('body-without-role').conversation.messages[0].role, 'unknown');
});
await check('混合标记保持顺序、未知消息 ID 不由轮次标记猜出', async () => {
  assert.deepEqual(results.get('mixed-markers').conversation.messages.map(row => row.sourceMessageId), ['mixed-u', 'mixed-a', 'mixed-u2']);
  const messages = results.get('no-source-id').conversation.messages;
  assert.ok(messages.every(row => row.sourceMessageId === null && row.identityBasis === 'ordered_context_fallback'));
  assert.deepEqual(messages.map(row => row.rowHint), ['turn-only-u', 'turn-only-a']);
});
await check('结构计数解释失败，不将可见正文和空就绪页面一律当成加载中', async () => {
  const rendered = buildDiagnosticReport(results.get('rendered-with-busy').diagnostics);
  assert.equal(rendered.captureMode, 'body_fallback'); assert.equal(rendered.counts.roles.unknown, 1);
  assert.equal(rendered.pageStructure.visibleTurnContainers, 1); assert.equal(rendered.pageStructure.readableBodyBlocks, 1);
  assert.equal(results.get('empty-ready').errorCode, 'messages_not_found');
  assert.equal(results.get('not-loaded').errorCode, 'messages_not_loaded');
});
await check('只接受弹层内有明确线程或轮次依据的对话，普通弹层不采集', async () => {
  const messages = results.get('project-dialog').conversation.messages;
  assert.deepEqual(messages.map(row => row.sourceMessageId), ['dialog-u', 'dialog-a']);
  assert.equal(messages[1].text, '项目弹层中的完整回答。');
  assert.ok(messages.every(row => !row.text.includes('普通弹层预览')));
});
await check('用户实际诊断数量同型时正文回退读取5段，不猜测角色或ID', async () => {
  const result = results.get('reported-zero-markers'), structure = result.diagnostics.pageStructure;
  assert.equal(structure.mainRegions, 1); assert.equal(structure.threadRegions, 0); assert.equal(structure.authorRoleMarkers, 0); assert.equal(structure.turnContainers, 0); assert.equal(structure.readableBodyBlocks, 5);
  assert.equal(result.conversation.messages.length, 5); assert.ok(result.conversation.messages.every(message => message.role === 'unknown' && message.roleUnverified && message.sourceMessageId === null));
  assert.equal(result.diagnostics.counts.roles.unknown, 5); assert.ok(result.diagnostics.notices.some(row => row.code === 'role_unverified'));
  assert.equal(result.conversation.messages[1].presentation.blocks.find(block => block.type === 'code').text, 'open\nhigh\nlow\nclose\nvolume\nreturns');
  assert.ok(result.conversation.messages.at(-1).text.endsWith('ROLELESS-END。'));
});
await check('嵌套正文保留代码前后文字，复制控件不进正文', async () => {
  const message = results.get('fallback-nested').conversation.messages[0];
  assert.ok(message.text.startsWith('代码前完整文字。')); assert.ok(message.text.endsWith('NESTED-END。')); assert.ok(message.text.includes('const result = 42;'));
  assert.equal(message.presentation.blocks.find(block => block.type === 'code').text, 'const result = 42;');
  assert.equal(results.get('fallback-navigation').conversation.messages[0].text, '当前对话真实正文 SAFE-BODY。');
});
await check('未知角色正文可保存、重复补采、标注和恢复备份，不编造问答', async () => {
  const state = fresh(), project = createProject(state, '用户诊断同型 · 合成正文');
  const raw = results.get('reported-zero-markers').conversation, original = JSON.stringify(raw);
  const annotated = applyCaptureLabels(raw, { 'dom:0': 'user', 'dom:1': 'assistant' });
  assert.equal(JSON.stringify(raw), original); assert.equal(annotated.messages[0].role, 'unknown'); assert.equal(annotated.messages[0].confirmedRole, 'user');
  await saveConversation(state, annotated, project.id); const ids = state.messages.map(message => message.id);
  assert.equal(state.messages.length, 5); assert.equal(state.qas.length, 0);
  await saveConversation(state, raw, project.id); assert.deepEqual(state.messages.map(message => message.id), ids); assert.equal(state.messages[0].confirmedRole, 'user');
  const backup = exportProject(state, project.id); validateBackup(backup); const restored = fresh(); const result = restoreBackup(restored, backup);
  validateBackup(exportProject(restored, result.projectId)); assert.equal(restored.messages.find(message => message.text === raw.messages[0].text).confirmedRole, 'user');
  assert.ok(restored.messages.some(message => message.text.endsWith('ROLELESS-END。')));
});
await check('正文标注拒绝伪造引用、平台已确认角色和不合法值', () => {
  const raw = results.get('reported-zero-markers').conversation;
  assert.throws(() => applyCaptureLabels(raw, { missing: 'user' }), /本次采集/);
  assert.throws(() => applyCaptureLabels(raw, { 'dom:0': 'admin' }), /有效/);
  assert.throws(() => applyCaptureLabels(results.get('ordinary').conversation, { 'dom:0': 'assistant' }), /角色未确认/);
});
await check('assistant-message语义标记确认角色；完整消息边界保留代码前后全文', () => {
  const [question, answer] = results.get('v6-assistant-marker').conversation.messages;
  assert.equal(answer.raw.roleBasis, 'DOM.assistant-message-marker'); assert.equal(answer.roleUnverified, false);
  assert.ok(answer.text.startsWith('完整回答开头 MARKER-BEGIN。')); assert.ok(answer.text.endsWith('MARKER-END。'));
  assert.equal(answer.text.includes(question.text), false); assert.equal(question.text.includes('MARKER-BEGIN'), false);
  assert.equal(answer.presentation.blocks.find(block => block.type === 'code').text, 'const value = 42;\nconsole.log(value);');
  assert.equal(answer.text.includes('Copy'), false);
});
await check('角色边界中的所有正文块、代码和表格合成完整答案，而非第一选择器子集', () => {
  const answer = results.get('v6-complete-owner').conversation.messages[1];
  assert.ok(answer.text.startsWith('选择器之外的回答开头')); assert.ok(answer.text.endsWith('OWNER-END。'));
  assert.equal(answer.presentation.format, 'dom-structured'); assert.equal(answer.presentation.textCoverage, 'all_readable_characters');
  assert.deepEqual(answer.presentation.blocks.find(block => block.type === 'table').rows, [['close', '100']]);
  assert.equal(answer.text.includes('复制代码'), false);
});
await check('宽正文CSS与零标记嵌套正文分别保留问题和回答，不根据样式推断角色', () => {
  const reliable = results.get('v6-wide-css-turns').conversation.messages, unknown = results.get('v6-zero-marker-nested').conversation.messages;
  assert.deepEqual(reliable.map(message => message.role), ['user', 'assistant']);
  assert.equal(reliable[0].text.includes('WIDE-ANSWER'), false); assert.equal(reliable[1].text.includes('WIDE-QUESTION'), false);
  assert.deepEqual(unknown.map(message => message.role), ['unknown', 'unknown']);
  assert.equal(unknown[0].text, '独立问题 NESTED-QUESTION。'); assert.equal(unknown[1].text.includes('NESTED-QUESTION'), false);
  assert.ok(unknown[1].text.endsWith('NESTED-ANSWER-END。')); assert.ok(unknown.every(message => message.roleUnverified));
});
await check('混合页面保留未知回答与完整保存引用，同时不冒充已确认助手轮次', async () => {
  const raw = results.get('v6-mixed-unknown-answer').conversation;
  assert.equal(raw.scope.captureMode, 'mixed_markers'); assert.ok(raw.diagnostics.notices.some(notice => notice.code === 'role_unverified'));
  const state = fresh(), project = createProject(state, 'V6 合成混合正文保存'); await saveConversation(state, raw, project.id);
  assert.equal(state.messages.length, 2); assert.equal(state.qas.length, 1); assert.equal(state.qas[0].responseMessageIds.length, 1); assert.equal(state.qas[0].assistantMessageIds.length, 0);
  assert.ok(state.messages.find(message => message.role === 'unknown').text.endsWith('UNKNOWN-ANSWER-END。'));
  const backup = exportProject(state, project.id); validateBackup(backup); const restored = fresh(), target = restoreBackup(restored, backup);
  validateBackup(exportProject(restored, target.projectId)); assert.equal(restored.messages.length, 2);
});
await check('共享ID的混合正文记录真实来源但不重复伪造独立消息身份', async () => {
  const raw = results.get('v6-shared-boundary-mixed').conversation;
  assert.ok(raw.messages.every(message => message.sourceMessageId === null && message.sharedSourceMessageId === 'v6-shared-outer'));
  assert.deepEqual(raw.messages.map(message => message.role), ['user', 'unknown']);
  const state = fresh(), project = createProject(state, 'V6 共享边界正文保存'); await saveConversation(state, raw, project.id);
  await saveConversation(state, raw, project.id); assert.equal(state.messages.length, 2); assert.equal(state.qas[0].responseMessageIds.length, 1);
  validateBackup(exportProject(state, project.id));
});
await check('未知排版容器的前中后顺序完整保留，不把中段移到结尾', () => {
  const text = results.get('v6-css-interleaving').conversation.messages[0].text;
  assert.ok(text.indexOf('BEFORE-FORMAT') < text.indexOf('MIDDLE-FORMAT')); assert.ok(text.indexOf('MIDDLE-FORMAT') < text.indexOf('AFTER-FORMAT'));
});
await check('明确问题和助手答案保存为真实QA并保留完整答案版本', async () => {
  const state = fresh(), project = createProject(state, 'V6 问答完整展示');
  await saveConversation(state, results.get('v6-assistant-marker').conversation, project.id);
  assert.equal(state.qas.length, 1); assert.equal(state.qas[0].assistantMessageIds.length, 1);
  const answer = state.messages.find(message => message.id === state.qas[0].assistantMessageIds[0]), version = state.versions.find(row => row.id === answer.currentVersionId);
  assert.equal(answer.role, 'assistant'); assert.equal(version.text, answer.text); assert.ok(version.text.endsWith('MARKER-END。'));
  assert.ok(!state.messages.find(message => message.id === state.qas[0].userMessageId).text.includes('MARKER-BEGIN'));
  validateBackup(exportProject(state, project.id));
});
await check('通用section、宽CSS和共用turn的多轮分别保持Q1,A1,Q2,A2', () => {
  for (const key of ['v7-multi-turn-generic-section', 'v7-multi-turn-wide-css-section', 'v7-multi-turn-shared-turn']) {
    const messages = results.get(key).conversation.messages;
    assert.deepEqual(messages.map(message => message.role), ['user', 'unknown', 'user', 'unknown']);
    assert.equal(messages[0].text.includes('ANSWER'), false); assert.equal(messages[2].text.includes('ANSWER'), false);
    assert.equal(messages[1].text.includes('QUESTION'), false); assert.equal(messages[1].text.includes('ANSWER-TWO'), false);
    assert.equal(messages[3].text.includes('QUESTION'), false); assert.equal(messages[3].text.includes('ANSWER-ONE'), false);
  }
  const answers = results.get('v7-multi-turn-wide-css-section').conversation.messages.filter(message => message.role === 'unknown');
  assert.deepEqual(answers.map(answer => answer.presentation.blocks.filter(block => block.type === 'code').map(block => block.text)), [['first_code_one()', 'first_code_two()'], ['second_code_one()', 'second_code_two()']]);
});
await check('多轮未知答案按真实阅读顺序保存进对应响应组，不冒充助手或移到其他问题', async () => {
  const state = fresh(), project = createProject(state, 'V7 多轮独立未知答案');
  await saveConversation(state, results.get('v7-multi-turn-generic-section').conversation, project.id);
  const qas = state.qas.sort((a, b) => a.ordinal - b.ordinal);
  assert.equal(qas.length, 2); assert.ok(qas.every(qa => qa.assistantMessageIds.length === 0 && qa.responseMessageIds.length === 1));
  assert.ok(state.messages.find(message => message.id === qas[0].responseMessageIds[0]).text.endsWith('GENERIC-ANSWER-ONE-END。'));
  assert.ok(state.messages.find(message => message.id === qas[1].responseMessageIds[0]).text.endsWith('GENERIC-ANSWER-TWO-END。'));
  assert.ok(state.messages.filter(message => message.role === 'unknown').every(message => message.roleUnverified));
  validateBackup(exportProject(state, project.id));
});
await check('旧版仅保存问题的资料补采完整答案，保留原问题身份和版本且无需迁移schema', async () => {
  const full = results.get('v7-multi-turn-generic-section').conversation, old = structuredClone(full);
  old.method = 'chatgpt-dom-v6'; old.adapterVersion = 'chatgpt-dom-v6'; old.messages = old.messages.filter(message => message.role === 'user');
  old.messages.forEach((message, index) => { message.position = index; }); old.paths[0].messageKeys = old.messages.map(message => message.key);
  const state = fresh(), project = createProject(state, 'V4/V6 问题资料补采合成验证'); await saveConversation(state, old, project.id);
  const priorQuestions = state.messages.map(message => ({ id: message.id, currentVersionId: message.currentVersionId, text: message.text }));
  validateBackup(exportProject(state, project.id));
  await saveConversation(state, full, project.id);
  assert.equal(state.conversations.length, 1); assert.equal(state.messages.length, 4); assert.equal(state.qas.length, 2);
  for (const prior of priorQuestions) {
    const question = state.messages.find(message => message.id === prior.id); assert.equal(question.text, prior.text); assert.equal(question.currentVersionId, prior.currentVersionId);
  }
  assert.ok(state.qas.every(qa => qa.responseMessageIds.length === 1));
  const backup = exportProject(state, project.id); validateBackup(backup); const restored = fresh(), result = restoreBackup(restored, backup);
  validateBackup(exportProject(restored, result.projectId)); assert.equal(restored.messages.length, 4);
});
await check('匿名结构计数解释未覆盖范围，默认诊断不含正文ID地址或任意属性值', () => {
  const raw = results.get('v7-out-of-scope-signature').diagnostics;
  assert.equal(raw.pageStructure.unclaimedRichBlocks, 1); assert.equal(raw.pageStructure.outOfScopeBodyBlocks, 1);
  assert.ok(raw.notices.some(notice => notice.code === 'uncovered_content'));
  for (const value of Object.values(raw.pageStructure)) assert.ok(Number.isSafeInteger(value) && value >= 0);
  const malicious = structuredClone(raw); malicious.pageStructure.userMarkers = 'SECRET-ACCOUNT'; malicious.pageStructure.arbitrary = 'SECRET-ACCOUNT';
  const report = buildDiagnosticReport(malicious), text = JSON.stringify(report);
  assert.equal(report.pageStructure.userMarkers, 0); assert.equal(report.pageStructure.unclaimedRichBlocks, 1);
  for (const forbidden of ['SECRET-ACCOUNT', 'v7-scope-u', 'CURRENT-SCOPE-QUESTION', 'UNRELATED-OUTSIDE-MAIN', 'https://']) assert.equal(text.includes(forbidden), false);
});
await check('明确div角色与无标记长回答分别确认或保留未知，代码表格尾部不截断', () => {
  const direct = results.get('v7-div-turns'); assert.equal(direct.conversation.messages[1].raw.roleBasis, 'DOM.data-turn');
  assert.equal(direct.diagnostics.pageStructure.visibleAssistantMarkers, 1);
  const unknown = results.get('v7-unmarked-long-tail').conversation.messages[1];
  assert.equal(unknown.role, 'unknown'); assert.equal(unknown.roleUnverified, true); assert.equal(unknown.sourceMessageId, null);
  assert.equal(unknown.presentation.blocks.find(block => block.type === 'code').text.split('console.log').length - 1, 1600);
  assert.deepEqual(unknown.presentation.blocks.find(block => block.type === 'table').rows, [['完整单元格']]);
  assert.ok(unknown.text.endsWith('LONG-ANSWER-AFTER-TABLE-END。'));
});
await check('可靠消息ID边界合并正文片段，完整保留且不同源ID继续独立', async () => {
  const raw = results.get('fallback-shared-id').conversation;
  assert.equal(raw.messages.length, 1); assert.equal(raw.messages[0].sourceMessageId, 'shared-source-a');
  assert.ok(raw.messages[0].text.includes('第一段独立正文。')); assert.ok(raw.messages[0].text.endsWith('SHARED-END。'));
  const state = fresh(), project = createProject(state, '合成共享来源片段'); await saveConversation(state, raw, project.id);
  const next = structuredClone(raw); next.messages.forEach(message => { message.sourceMessageId = 'shared-source-b'; message.nodeKey = 'shared-source-b'; });
  await saveConversation(state, next, project.id); assert.equal(state.messages.length, 2);
  validateBackup(exportProject(state, project.id)); assert.equal(state.qas.length, 0);
});
await check('可选上滚找不到滚动区时保留正文且明确部分范围', async () => {
  const result = await captureFixture(adapterFixtures.find(fixture => fixture.key === 'reported-zero-markers'), { loadEarlier: true });
  assert.equal(result.ok, true); assert.equal(result.conversation.messages.length, 5); assert.ok(result.diagnostics.notices.some(row => row.code === 'scroll_unavailable'));
  assert.equal(result.conversation.scope.coverage.fullHistory, 'unknown');
});
await check('上滚只移动一个正文祖先视口，仍保持部分历史范围', async () => {
  const fixture = structuredClone(adapterFixtures.find(row => row.key === 'reported-zero-markers'));
  fixture.tree.attrs.style = 'overflow-y: auto'; fixture.scrollSimulation = { selector: 'main', scrollTop: 1000, scrollHeight: 2500, clientHeight: 400 };
  const result = await captureFixture(fixture, { loadEarlier: true });
  assert.ok(result.diagnostics.notices.some(row => row.code === 'scrolled_partial')); assert.equal(result.conversation.messages.length, 5);
  assert.equal(result.conversation.scope.coverage.fullHistory, 'unknown');
});
await check('执行脚本前来源发生变化时，在正文和上滚之前拒绝', async () => {
  const fixture = adapterFixtures.find(row => row.key === 'reported-zero-markers');
  const result = await captureFixture(fixture, { loadEarlier: true, expectedSourceUrl: 'https://chatgpt.com/c/other-source' });
  assert.equal(result.ok, false); assert.equal(result.errorCode, 'source_changed'); assert.equal(result.diagnostics.counts.messages, 0);
  assert.equal(JSON.stringify(result.diagnostics).includes('other-source'), false);
});

function backgroundHarness({ tabError = null, scriptError = null, adapterResult = null, pairedSource = null, sourceUrl = 'https://chatgpt.com/c/synthetic-roleless', sourceTitle = null, scripts = [],
  activeTab = { id: 2, url: 'chrome-extension://synthetic-extension/workspace.html' }, tabLookup = null } = {}) {
  let listener;
  const session = { captureTabId: 1, captureSource: pairedSource }, writes = [], drafts = [];
  const chrome = { runtime: { id: 'synthetic-extension', getURL: value => `chrome-extension://synthetic-extension/${value}`, sendMessage: async () => {}, onMessage: { addListener: fn => { listener = fn; } } },
    action: { onClicked: { addListener: () => {} } }, sidePanel: { open: async () => {} }, storage: { session: { set: async values => { Object.assign(session, values); writes.push(plain(values)); }, get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, session[key]])) } },
    tabs: { get: async id => { if (tabError) throw new Error(tabError); return tabLookup ? tabLookup(id) : { id, ...(sourceUrl ? { url: sourceUrl } : {}), ...(sourceTitle ? { title: sourceTitle } : {}) }; }, query: async () => activeTab ? [activeTab] : [], create: async () => ({ id: 2 }) },
    scripting: { executeScript: async args => { scripts.push(args); if (scriptError) throw new Error(scriptError); return args.files ? [] : [{ frameId: 0, result: plain(adapterResult) }]; } } };
  const code = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8').replace(/^import .*;\r?$/gm, '');
  vm.runInContext(code, vm.createContext({ chrome, URL, URLSearchParams, CAPTURE_ADAPTER_VERSION, EXTENSION_VERSION, readConversationData, normalizeConversationData, DATA_ADAPTER_VERSION, createDraft: async bundle => { drafts.push(plain(bundle)); return bundle; }, command: async () => {}, parseImport: async () => {}, saveDraft: async () => {} }));
  return { session, writes, drafts, send: (type, args) => new Promise(resolve => listener({ type, args: { ...(type === 'capture' ? { captureMode: 'loaded' } : {}), ...args } }, { id: chrome.runtime.id, url: chrome.runtime.getURL('sidepanel.html') }, resolve)) };
}
async function backgroundCapture({ sourceTabId = 1, loadEarlier = false, ...options } = {}) {
  return backgroundHarness(options).send('capture', { sourceTabId, loadEarlier });
}
await check('后台区分来源页已关闭与网页授权不可用且不复制 Chrome 原异常', async () => {
  const closed = await backgroundCapture({ tabError: 'No tab with id: 123' }); assert.equal(closed.errorCode, 'source_tab_closed');
  const denied = await backgroundCapture({ scriptError: 'Cannot access contents of url https://secret.invalid/account' }); assert.equal(denied.errorCode, 'access_denied');
  assert.equal(JSON.stringify(denied).includes('secret.invalid'), false); assert.equal(closed.diagnostics.errors[0].code, 'source_tab_closed');
});
await check('后台识别失败返回结构化诊断且不建立预览', async () => {
  const result = await backgroundCapture({ adapterResult: results.get('fallback-multiple-main') });
  assert.equal(result.ok, false); assert.equal(result.errorCode, 'structure_unrecognized'); assert.equal(result.diagnostics.pageType, 'conversation');
});
await check('工作台沿用最近图标选定的来源标签，传递一次上滚选项', async () => {
  const scripts = [], result = await backgroundCapture({ sourceTabId: null, pairedSource: { tabId: 7, url: 'https://chatgpt.com/g/custom/c/synthetic-roleless' },
    sourceUrl: 'https://chatgpt.com/g/custom/c/synthetic-roleless?display=1', loadEarlier: true, scripts, adapterResult: results.get('reported-zero-markers') });
  assert.equal(result.ok, true); assert.equal(result.data.sourceTabId, 7); assert.ok(scripts.every(script => script.target.tabId === 7));
  assert.equal(scripts[1].args[0].loadEarlier, true);
});
await check('同标签切换对话后直接采集当前页，无需重新绑定且预览诊断不泄漏地址', async () => {
  const scripts = [], sourceUrl = 'https://chatgpt.com/c/secret-new', harness = backgroundHarness({ pairedSource: { tabId: 1, url: 'https://chatgpt.com/c/secret-old' }, sourceUrl, scripts,
    adapterResult: results.get('reported-zero-markers') });
  const result = await harness.send('capture', { sourceTabId: null });
  assert.equal(result.ok, true); assert.equal(scripts.length, 2); assert.equal(scripts[1].args[0].expectedSourceUrl, sourceUrl);
  assert.equal(result.data.conversations[0].messages.length, 5); assert.equal(harness.drafts.length, 1); assert.equal(harness.session.captureSource.url, sourceUrl);
  const diagnostic = buildDiagnosticReport(result.data.conversations[0].diagnostics);
  assert.equal(diagnostic.extensionVersion, EXTENSION_VERSION); assert.equal(JSON.stringify(diagnostic).includes('secret-new'), false); assert.equal(JSON.stringify(diagnostic).includes('secret-old'), false);
});
await check('前置来源检查诊断使用实际适配器常量，未采集不伪装DOM观察', async () => {
  const result = await backgroundCapture({ sourceUrl: 'https://unsupported.invalid/secret' });
  assert.equal(result.errorCode, 'unsupported_page'); assert.equal(result.diagnostics.adapterVersion, CAPTURE_ADAPTER_VERSION);
  assert.equal(result.diagnostics.extensionVersion, EXTENSION_VERSION); assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(result.diagnostics.counts.messages, 0); assert.equal(result.diagnostics.capabilities.text, 'not_checked');
});
await check('来源面板仍可明确选择当前来源并在同一标签采集', async () => {
  const scripts = [], expectedSourceUrl = 'https://chatgpt.com/c/explicit-new-source';
  const harness = backgroundHarness({ pairedSource: { tabId: 7, url: 'https://chatgpt.com/c/old-source' }, sourceUrl: expectedSourceUrl, sourceTitle: '明确选择的新对话 · 合成', scripts,
    adapterResult: results.get('v7-no-css-answer') });
  const status = await harness.send('captureSourceStatus', { sourceTabId: 7 }); assert.equal(status.ok, true); assert.equal(status.data.changed, true); assert.equal(status.data.url, expectedSourceUrl);
  assert.equal(harness.writes.length, 0);
  const rebound = await harness.send('captureSourceRebind', { sourceTabId: 7, expectedSourceUrl });
  assert.equal(rebound.ok, true); assert.equal(rebound.data.rebound, true); assert.equal(harness.session.captureSource.url, expectedSourceUrl);
  const result = await harness.send('capture', { sourceTabId: 7, expectedSourceUrl }); assert.equal(result.ok, true); assert.equal(result.data.sourceTabId, 7);
  assert.equal(result.data.conversations[0].messages.length, 2); assert.ok(scripts.every(script => script.target.tabId === 7));
  assert.equal(scripts[1].args[0].expectedSourceUrl, expectedSourceUrl);
});
await check('来源在预览和确认之间又变化时拒绝绑定，且不给其他活跃标签采集', async () => {
  const scripts = [], harness = backgroundHarness({ pairedSource: { tabId: 1, url: 'https://chatgpt.com/c/old-source' }, sourceUrl: 'https://chatgpt.com/c/newer-than-preview', scripts });
  const result = await harness.send('captureSourceRebind', { sourceTabId: 1, expectedSourceUrl: 'https://chatgpt.com/c/previewed-source' });
  assert.equal(result.ok, false); assert.equal(result.errorCode, 'source_changed'); assert.equal(harness.writes.length, 0); assert.equal(scripts.length, 0);
  assert.equal(JSON.stringify(result).includes('newer-than-preview'), false); assert.equal(harness.session.captureSource.url, 'https://chatgpt.com/c/old-source');
});

await check('从新对话首页跳转正式对话地址后可直接导入', async () => {
  const scripts = [], sourceUrl = 'https://chatgpt.com/c/newly-created', harness = backgroundHarness({ pairedSource: { tabId: 1, url: 'https://chatgpt.com/' }, sourceUrl, scripts,
    activeTab: { id: 1, url: sourceUrl }, adapterResult: results.get('v7-no-css-answer') });
  const result = await harness.send('capture', {}); assert.equal(result.ok, true); assert.equal(harness.drafts.length, 1); assert.equal(scripts[1].args[0].expectedSourceUrl, sourceUrl);
});
await check('侧栏切到另一已授权ChatGPT标签时读取当前标签而非旧来源', async () => {
  const scripts = [], sourceUrl = 'https://chatgpt.com/c/current-active', harness = backgroundHarness({ pairedSource: { tabId: 7, url: 'https://chatgpt.com/c/old-background' },
    activeTab: { id: 99, url: sourceUrl }, sourceUrl, scripts, adapterResult: results.get('v7-no-css-answer') });
  const status = await harness.send('captureSourceStatus', {}); assert.equal(status.data.tabId, 99);
  const result = await harness.send('capture', {}); assert.equal(result.ok, true); assert.equal(result.data.sourceTabId, 99); assert.ok(scripts.every(script => script.target.tabId === 99));
  assert.equal(harness.session.captureSource.tabId, 99);
});
await check('旧工作台地址的sourceTab仅作后备，最近图标选择优先', async () => {
  const scripts = [], harness = backgroundHarness({ pairedSource: { tabId: 7, url: 'https://chatgpt.com/c/current-source' }, scripts, adapterResult: results.get('v7-no-css-answer') });
  const result = await harness.send('capture', { fallbackSourceTabId: 1 }); assert.equal(result.ok, true); assert.equal(result.data.sourceTabId, 7); assert.ok(scripts.every(script => script.target.tabId === 7));
});
await check('显式选择的来源不被其他活动ChatGPT标签替换', async () => {
  const scripts = [], sourceUrl = 'https://chatgpt.com/c/reviewed-source', harness = backgroundHarness({ activeTab: { id: 99, url: 'https://chatgpt.com/c/unrelated' }, sourceUrl, scripts,
    adapterResult: results.get('v7-no-css-answer') });
  const result = await harness.send('capture', { sourceTabId: 7, expectedSourceUrl: sourceUrl }); assert.equal(result.ok, true); assert.ok(scripts.every(script => script.target.tabId === 7));
});
await check('活动页面不支持或没有授权时不偷偷采集旧后台对话', async () => {
  for (const [activeTab, code] of [[{ id: 99, url: 'https://unsupported.invalid/secret' }, 'unsupported_page'], [{ id: 99 }, 'access_denied']]) {
    const scripts = [], harness = backgroundHarness({ activeTab, pairedSource: { tabId: 7, url: 'https://chatgpt.com/c/old' },
      tabLookup: id => ({ id, url: activeTab.url }), scripts });
    const result = await harness.send('capture', {}); assert.equal(result.errorCode, code); assert.equal(scripts.length, 0); assert.equal(harness.drafts.length, 0); assert.equal(harness.writes.length, 0);
  }
});
await check('显式来源缺少地址授权时拒绝执行脚本，诊断不泄漏异常', async () => {
  const scripts = [], result = await backgroundCapture({ sourceUrl: null, scripts });
  assert.equal(result.errorCode, 'access_denied'); assert.equal(scripts.length, 0); assert.equal(result.diagnostics.capabilities.text, 'not_checked');
});
await check('来源面板确认之后再次换页时仍拒绝读取另一条对话', async () => {
  const scripts = [], harness = backgroundHarness({ sourceUrl: 'https://chatgpt.com/c/changed-again', scripts });
  const result = await harness.send('capture', { sourceTabId: 1, expectedSourceUrl: 'https://chatgpt.com/c/reviewed' });
  assert.equal(result.errorCode, 'source_changed'); assert.equal(scripts.length, 0); assert.equal(harness.drafts.length, 0); assert.equal(harness.writes.length, 0);
});
await check('读取开始前适配器发现切页时不建立预览、不改来源', async () => {
  const scripts = [], failure = await captureFixture(adapterFixtures.find(row => row.key === 'reported-zero-markers'), { expectedSourceUrl: 'https://chatgpt.com/c/race' });
  const harness = backgroundHarness({ scripts, adapterResult: failure });
  const result = await harness.send('capture', {}); assert.equal(result.errorCode, 'source_changed'); assert.equal(harness.drafts.length, 0); assert.equal(harness.writes.length, 0);
  assert.equal(result.diagnostics.extensionVersion, EXTENSION_VERSION);
});
await check('采集返回后又切换对话时不把旧结果放进新来源预览', async () => {
  let reads = 0; const scripts = [], harness = backgroundHarness({ scripts, adapterResult: results.get('v7-no-css-answer'),
    tabLookup: id => ({ id, url: `https://chatgpt.com/c/${++reads === 1 ? 'initial' : 'changed-after-collection'}` }) });
  const result = await harness.send('capture', {}); assert.equal(result.errorCode, 'page_changed'); assert.equal(scripts.length, 2); assert.equal(harness.drafts.length, 0); assert.equal(harness.writes.length, 0);
  assert.equal(JSON.stringify(result).includes('changed-after-collection'), false);
});

const report = { version: EXTENSION_VERSION, adapterVersion: 'chatgpt-dom-v7', checkedAt: new Date().toISOString(), fixtureOrigin, passed: checks.length, failed: failures.length, checks, failures,
  scope: 'Node VM with a limited synthetic DOM model, domain save/backup and mocked Chrome message routing. Not actual ChatGPT DOM or MV3 permission acceptance.' };
fs.mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../dist/ADAPTER_VALIDATION_REPORT.json', import.meta.url), JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
