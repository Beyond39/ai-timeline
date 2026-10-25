import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readConversationData } from '../adapters/conversation-data.js';
import { normalizeConversationData, DATA_ADAPTER_VERSION } from '../domain/full-conversation.js';
import { fullConversationFixture } from '../validation/full-conversation-fixture.mjs';
import { createProject, saveConversation } from '../domain/captures.js';
import { buildConversationOutline } from '../domain/conversation-outline.js';
import { exportProject, validateBackup, restoreBackup } from '../domain/backup.js';
import { buildDiagnosticReport } from '../ui/diagnostics.js';
import { STORES } from '../storage/database.js';
import { EXTENSION_VERSION, CAPTURE_ADAPTER_VERSION } from '../domain/common.js';

const checks = [], failures = [], payload = fullConversationFixture({ rounds: 160 });
const url = `https://chatgpt.com/g/synthetic-project/c/${payload.id}`;
const fresh = () => ({ ...Object.fromEntries(STORES.map(name => [name, []])), revision: 0 });
const plain = value => JSON.parse(JSON.stringify(value));
async function check(name, run) { try { await run(); checks.push(name); console.log(`PASS ${name}`); } catch (error) { failures.push({ name, error: error.stack }); console.error(`FAIL ${name}: ${error.message}`); } }
async function read({ data = payload, expectedSourceUrl = url, sourceUrl = url, status = 200, contentType = 'application/json', token = 'synthetic-private-token', onRequest = null } = {}) {
  const calls = [], location = new URL(sourceUrl);
  const fetch = async (target, options) => {
    calls.push({ target, options }); onRequest?.(location, calls.length);
    const isSession = new URL(target).pathname === '/api/auth/session', responseData = isSession ? { accessToken: token, sensitiveSessionField: 'must-not-return' } : data;
    return { ok: isSession || status === 200, status: isSession ? 200 : status, headers: new Headers({ 'content-type': isSession ? 'application/json' : contentType }), text: async () => JSON.stringify(responseData) };
  };
  // Same serialization boundary as executeScript: no imported closure helpers.
  const context = vm.createContext({ location, document: { title: '合成来源', cookie: '_account=synthetic-team' }, URL, fetch, AbortController, setTimeout, clearTimeout });
  const result = await vm.runInContext(`(${readConversationData.toString()})(${JSON.stringify({ expectedSourceUrl })})`, context);
  return { result: plain(result), calls };
}

await check('无需滚动读取323条消息与两个分支，包含页面之外的最早问题和最后答案', async () => {
  const { result, calls } = await read(); assert.equal(result.ok, true); assert.equal(result.messageCount, 323); assert.equal(calls.length, 2);
  const conversation = await normalizeConversationData(result); assert.equal(conversation.messages.length, 323); assert.equal(conversation.paths.length, 2);
  assert.ok(conversation.messages.find(row => row.key === 'q1').text.includes('长 Conversation'));
  assert.ok(conversation.messages.find(row => row.key === 'a160').text.endsWith('FULL-ANSWER-160-END'));
  assert.ok(conversation.messages.find(row => row.key === 'alternate-a2').text.endsWith('BRANCH-COMPLETE-END'));
});
await check('所有请求仅GET当前来源；临时授权只在页面内使用，不返回或保存凭证', async () => {
  const { result, calls } = await read(); assert.ok(calls.every(call => new URL(call.target).origin === 'https://chatgpt.com' && call.options.method === 'GET' && call.options.credentials === 'same-origin' && call.options.redirect === 'error'));
  assert.equal(calls[1].options.headers.Authorization, 'Bearer synthetic-private-token');
  assert.equal(JSON.stringify(result).includes('synthetic-private-token'), false); assert.equal(JSON.stringify(result).includes('must-not-return'), false);
});
await check('结构化角色自动识别，正文代码表格尾部与时间完整保留', async () => {
  const conversation = await normalizeConversationData((await read()).result);
  assert.equal(conversation.messages.filter(row => row.roleUnverified).length, 0); assert.ok(conversation.messages.every(row => ['user', 'assistant'].includes(row.role)));
  const answer = conversation.messages.find(row => row.key === 'a1'); assert.ok(answer.text.includes('console.log(conversation)') && answer.text.includes('| 项目 | 结果 |')); assert.ok(answer.time.value);
  assert.equal(conversation.scope.history, 'provided'); assert.equal(conversation.diagnostics.captureMode, 'structured_conversation');
});
await check('当前路径含160轮自动问答，另一分支单独保存；重复完整读取不重复消息', async () => {
  const conversation = await normalizeConversationData((await read()).result), state = fresh(), project = createProject(state, '完整记录合成项目');
  await saveConversation(state, conversation, project.id); assert.equal(state.messages.length, 323); assert.equal(state.paths.length, 2);
  assert.equal(state.qas.filter(row => row.pathId === state.conversations[0].currentPathId).length, 160);
  const again = await saveConversation(state, conversation, project.id); assert.equal(again.createdMessages, 0); assert.equal(again.changedMessages, 0); assert.equal(state.messages.length, 323);
  const outline = buildConversationOutline({ conversation: state.conversations[0], paths: state.paths, messages: state.messages, qas: state.qas }, { projectId: project.id, conversationId: state.conversations[0].id });
  assert.equal(outline.rounds.length, 160); assert.equal(outline.unknownMessages, 0); assert.equal(outline.graphBasis, 'provided'); assert.equal(outline.messageTree.length, 323); assert.equal(outline.branchCount, 2);
  assert.ok(outline.rounds.every(round => round.messageSummaries.every(message => message.time.value)));
  const q1 = state.messages.find(row => row.sourceNodeId === 'q1'), alternatives = outline.messageTree.filter(row => row.parentMessageId === q1.id); assert.equal(alternatives.length, 2);
  const backup = exportProject(state, project.id); validateBackup(backup); const restored = fresh(); const recovery = restoreBackup(restored, backup); assert.equal(restored.messages.length, 323); assert.equal(restored.paths.length, 2);
  const restoredOutline = buildConversationOutline({ conversation: restored.conversations[0], paths: restored.paths, messages: restored.messages, qas: restored.qas }, { projectId: recovery.projectId, conversationId: restored.conversations[0].id });
  assert.equal(restoredOutline.messageTree.length, 323); assert.equal(restoredOutline.branchCount, 2); assert.equal(restoredOutline.graphBasis, 'provided');
  assert.ok(restoredOutline.rounds.every(round => round.messageSummaries.every(message => message.time.value))); validateBackup(exportProject(restored, recovery.projectId));
});
await check('旧版未知角色有可靠来源ID时自动修复，保留旧正文版本和人工标注历史', async () => {
  const conversation = await normalizeConversationData((await read()).result), legacy = structuredClone(conversation), state = fresh(), project = createProject(state, '旧采集修复');
  const source = legacy.messages.find(row => row.key === 'a1'); source.role = 'unknown'; source.roleUnverified = true; source.confirmedRole = 'user'; legacy.scope.kind = 'loaded_page';
  await saveConversation(state, legacy, project.id); const message = state.messages.find(row => row.sourceNodeId === 'a1'), previousVersion = message.currentVersionId;
  const repaired = await saveConversation(state, conversation, project.id); assert.equal(repaired.createdMessages, 0); assert.equal(repaired.changedMessages, 1);
  assert.equal(message.role, 'assistant'); assert.equal(message.roleUnverified, false); assert.ok(message.versionIds.includes(previousVersion)); assert.equal(state.versions.find(row => row.id === previousVersion).role, 'unknown');
  const outline = buildConversationOutline({ conversation: state.conversations[0], paths: state.paths, messages: state.messages, qas: state.qas }, { projectId: project.id, conversationId: state.conversations[0].id });
  assert.equal(outline.unknownMessages, 0); assert.equal(outline.rounds[0].messageSummaries[1].effectiveRole, 'assistant'); validateBackup(exportProject(state, project.id));
});
await check('旧首页采集有两个可靠消息锚点时完整读取升级原记录，不重复创建Conversation', async () => {
  const conversation = await normalizeConversationData((await read()).result), legacy = structuredClone(conversation), state = fresh(), project = createProject(state, '首页来源升级');
  Object.assign(legacy, { sourceConversationId: null, identityBasis: 'source_url_fallback', sourceUrl: 'https://chatgpt.com/', method: 'chatgpt-dom-v7' });
  await saveConversation(state, legacy, project.id); const original = state.conversations[0].id; const result = await saveConversation(state, conversation, project.id);
  assert.equal(state.conversations.length, 1); assert.equal(result.conversationId, original); assert.equal(state.conversations[0].sourceConversationId, payload.id); assert.equal(result.createdMessages, 0);
});
await check('隐藏的来源上下文保留在记录中，但不会伪装为用户提出的一轮问题', async () => {
  const data = structuredClone(payload), hidden = { id: 'hidden-context', parent: 'root', children: ['q1'], message: { id: 'context-source', author: { role: 'user' }, content: { content_type: 'user_editable_context' }, metadata: { is_visually_hidden_from_conversation: true } } };
  data.mapping['hidden-context'] = hidden; data.mapping.root.children = ['hidden-context']; data.mapping.q1.parent = 'hidden-context';
  const conversation = await normalizeConversationData((await read({ data })).result), state = fresh(), project = createProject(state, '上下文合成验证'); await saveConversation(state, conversation, project.id);
  const outline = buildConversationOutline({ conversation: state.conversations[0], paths: state.paths, messages: state.messages, qas: state.qas }, { projectId: project.id, conversationId: state.conversations[0].id });
  assert.equal(outline.rounds.filter(row => row.questionMessageId).length, 160); assert.ok(state.messages.find(row => row.sourceNodeId === 'hidden-context').isAuxiliary); assert.equal(outline.rounds[0].questionMessageId, null); validateBackup(exportProject(state, project.id));
});
await check('来源在请求之前或请求过程中切换时拒绝，且错误不带正文或凭证', async () => {
  const before = await read({ expectedSourceUrl: 'https://chatgpt.com/c/other' }); assert.equal(before.result.errorCode, 'source_changed'); assert.equal(before.calls.length, 0);
  const during = await read({ onRequest: (location, index) => { if (index === 2) location.href = 'https://chatgpt.com/c/changed'; } }); assert.equal(during.result.errorCode, 'page_changed'); assert.equal(JSON.stringify(during.result).includes('private-token'), false);
});
await check('来源身份不匹配、缺少当前节点或缺少父节点时不会伪称完整', async () => {
  const wrong = structuredClone(payload); wrong.conversation_id = 'another-conversation'; assert.equal((await read({ data: wrong })).result.errorCode, 'source_changed');
  for (const mutate of [data => { delete data.mapping[data.current_node]; }, data => { data.mapping.q1.parent = 'missing'; }, data => { data.has_missing_messages = true; }]) {
    const data = structuredClone(payload); mutate(data); assert.equal((await read({ data })).result.errorCode, 'conversation_data_incomplete');
  }
});
await check('角色缺失、重复消息ID和循环消息图均拒绝，不让用户手工补标签', async () => {
  const unknown = structuredClone(payload); delete unknown.mapping.a1.message.author.role; assert.equal((await read({ data: unknown })).result.errorCode, 'conversation_roles_unavailable');
  const duplicate = structuredClone(payload); duplicate.mapping.a1.message.id = duplicate.mapping.q1.message.id; assert.equal((await read({ data: duplicate })).result.errorCode, 'conversation_roles_unavailable');
  const cycle = structuredClone(payload); cycle.mapping.root.parent = cycle.current_node; cycle.mapping[cycle.current_node].children.push('root'); assert.equal((await read({ data: cycle })).result.errorCode, 'conversation_data_incomplete');
});
await check('接口授权失败、限流或返回HTML时明确失败，不退化成几段正文的完整预览', async () => {
  for (const [options, expected] of [[{ status: 401 }, 'conversation_access_denied'], [{ status: 403 }, 'conversation_access_denied'], [{ status: 429 }, 'capture_rate_limited'], [{ status: 500 }, 'conversation_data_unavailable'], [{ contentType: 'text/html' }, 'conversation_data_unavailable'], [{ token: '' }, 'conversation_access_denied']]) assert.equal((await read(options)).result.errorCode, expected);
});
await check('未分配Conversation地址不读取最近另一条；不支持页面不发请求', async () => {
  for (const [sourceUrl, code] of [['https://chatgpt.com/', 'conversation_not_saved'], ['https://evil.invalid/c/a', 'unsupported_page'], ['http://chatgpt.com/c/a', 'unsupported_page']]) { const response = await read({ sourceUrl }); assert.equal(response.result.errorCode, code); assert.equal(response.calls.length, 0); }
});
await check('完整记录诊断能区分DOM采集，默认仍无正文、标题、账号和来源地址', async () => {
  const conversation = await normalizeConversationData((await read()).result), report = buildDiagnosticReport(conversation.diagnostics);
  assert.equal(report.extensionVersion, EXTENSION_VERSION); assert.equal(report.adapterVersion, DATA_ADAPTER_VERSION); assert.equal(report.captureMode, 'structured_conversation'); assert.equal(report.capabilities.branches, 'provided_graph');
  const text = JSON.stringify(report); assert.equal(text.includes('长 Conversation'), false); assert.equal(text.includes(url), false); assert.equal(text.includes('synthetic-team'), false); assert.equal(text.includes('synthetic-private-token'), false);
});
await check('后台默认使用MAIN完整读取，只成功记录进入草稿，接口失败不执行DOM脚本', async () => {
  const code = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8').replace(/^import .*;\r?$/gm, '');
  for (const ok of [true, false]) {
    let listener; const scripts = [], drafts = [], writes = [];
    const session = { captureTabId: 7, captureSource: { tabId: 7, url: 'https://chatgpt.com/c/old-source' } };
    const response = ok ? (await read()).result : { ok: false, errorCode: 'conversation_access_denied' };
    const chrome = { runtime: { id: 'synthetic', getURL: path => `chrome-extension://synthetic/${path}`, sendMessage: async () => {}, onMessage: { addListener: fn => { listener = fn; } } },
      action: { onClicked: { addListener() {} } }, storage: { session: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, session[key]])), set: async value => { writes.push(value); Object.assign(session, value); } } },
      tabs: { get: async id => ({ id, url }), query: async () => [{ id: 7, url }] }, scripting: { executeScript: async args => { scripts.push(args); return [{ frameId: 0, result: response }]; } } };
    vm.runInContext(code, vm.createContext({ chrome, URL, URLSearchParams, CAPTURE_ADAPTER_VERSION, EXTENSION_VERSION, DATA_ADAPTER_VERSION, readConversationData, normalizeConversationData,
      createDraft: async draft => { drafts.push(draft); return draft; }, command() {}, parseImport() {}, saveDraft() {} }));
    const result = await new Promise(resolve => listener({ type: 'capture', args: {} }, { id: 'synthetic', url: 'chrome-extension://synthetic/workspace.html' }, resolve));
    assert.equal(scripts.length, 1); assert.equal(scripts[0].world, 'MAIN'); assert.equal(result.ok, ok); assert.equal(drafts.length, ok ? 1 : 0); assert.equal(writes.length, ok ? 1 : 0);
    if (ok) assert.equal(drafts[0].conversations[0].messages.length, 323); else assert.equal(result.errorCode, 'conversation_access_denied');
  }
});
const report = { version: EXTENSION_VERSION, checkedAt: new Date().toISOString(), passed: checks.length, failed: failures.length, checks, failures,
  scope: 'Serialized MAIN-world function with mocked same-origin read-only responses, actual normalization/save/backup/outline and mocked background routing. No real account or live endpoint acceptance.' };
fs.writeFileSync(new URL('../dist/FULL_CONVERSATION_VALIDATION_REPORT.json', import.meta.url), JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
