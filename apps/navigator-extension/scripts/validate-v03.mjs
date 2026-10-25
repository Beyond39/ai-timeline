import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STORES } from '../storage/database.js';
import { EXTENSION_VERSION, SCHEMA_VERSION } from '../domain/common.js';
import { parseImport } from '../importers/json.js';
import { createProject, saveConversation } from '../domain/captures.js';
import { exportProject, validateBackup, restoreBackup } from '../domain/backup.js';
import { generateRuleSuggestion, getSuggestion } from '../domain/organization.js';

// Explicit synthetic source records; no user content or presumed live DOM.
const fresh = () => ({ ...Object.fromEntries(STORES.map(name => [name, []])), revision: 0 });
const checks = [], failures = [];
async function check(name, fn) { try { await fn(); checks.push(name); console.log(`PASS ${name}`); } catch (error) { failures.push({ name, error: error.stack }); console.error(`FAIL ${name}: ${error.message}`); } }
const raw = '# 标题\n\n完整段落。\n\n```js\nconst x = "<script>";\n```\n\n| 列一 | 列二 |\n| --- | --- |\n| A | B |\n\n' + '超长正文末尾验证。'.repeat(5000) + 'END-RAW';
let env;
await check('导入 Markdown 保留完整原文；显式 plain 不推断结构', async () => {
  const input = await parseImport(JSON.stringify({ provider: 'v03-synthetic', conversations: [{ id: 'v03-body', messages: [
    { id: 'q', role: 'user', text: '完整正文如何保存？' }, { id: 'a', role: 'assistant', text: raw },
    { id: 'q2', role: 'user', text: '# 普通文本', format: 'plain' }
  ] }] }), 'v03-synthetic-example.json');
  assert.equal(input.conversations[0].messages[1].text, raw);
  assert.equal(input.conversations[0].messages[1].presentation.format, 'markdown');
  assert.equal(input.conversations[0].messages[2].presentation.format, 'plain');
  const state = fresh(), project = createProject(state, 'V0.3 明确标记的隔离样例');
  await saveConversation(state, input.conversations[0], project.id);
  env = { state, project, input: input.conversations[0], conversation: state.conversations[0] };
  assert.equal(state.messages.find(m => m.sourceMessageId === 'a').text, raw);
  assert.equal(state.qas.find(q => q.ordinal === 2).status, 'unanswered');
});
await check('DOM 结构是独立可验证呈现；格式改变保留不可变历史版本', async () => {
  const { state, project } = env, source = structuredClone(env.input);
  const body = source.messages.find(m => m.sourceMessageId === 'a');
  body.presentation = { format: 'dom-structured', source: 'dom', status: 'verified_structure', blocks: [
    { type: 'code', text: 'const x = "<script>";', language: 'js' }, { type: 'table', headers: ['列一', '列二'], rows: [['A', 'B']] }
  ] };
  source.diagnostics = { adapterVersion: 'synthetic-v03', pageType: 'conversation', counts: { messages: 3 }, coverage: { kind: 'partial' } };
  const message = state.messages.find(m => m.sourceMessageId === 'a'), old = structuredClone(state.versions.find(v => v.id === message.currentVersionId));
  await saveConversation(state, source, project.id);
  assert.equal(message.versionIds.length, 2); assert.equal(message.text, raw);
  assert.deepEqual(state.versions.find(v => v.id === old.id), old);
  assert.equal(state.versions.find(v => v.id === message.currentVersionId).previousVersionId, old.id);
  body.presentation.blocks[0].text = '外部对象修改';
  assert.equal(message.presentation.blocks[0].text, 'const x = "<script>";');
  assert.equal(state.snapshots.at(-1).diagnostics.adapterVersion, 'synthetic-v03');
});
await check('格式版本变动会使已有建议过期；旧正文及证据仍保留', async () => {
  const { state, project, conversation } = env;
  const suggestion = await generateRuleSuggestion(state, { conversationId: conversation.id, pathId: conversation.currentPathId });
  const input = structuredClone(env.input);
  await saveConversation(state, input, project.id);
  assert.equal((await getSuggestion(state, { suggestionId: suggestion.id })).stale, true);
  assert.equal(state.messages.find(m => m.sourceMessageId === 'a').versionIds.length, 3);
});
await check('V0.3 备份重导入保留全部原文、呈现版本链和诊断快照', async () => {
  const backup = exportProject(env.state, env.project.id); validateBackup(backup);
  assert.equal(backup.schemaVersion, SCHEMA_VERSION); assert.equal(backup.extensionVersion, EXTENSION_VERSION);
  const next = fresh(), result = restoreBackup(next, backup);
  validateBackup(exportProject(next, result.projectId));
  const message = next.messages.find(m => m.sourceMessageId === 'a');
  assert.equal(message.text, raw); assert.equal(message.versionIds.length, 3);
  assert.ok(next.versions.some(v => v.presentation?.format === 'dom-structured'));
  assert.ok(next.snapshots.some(s => s.diagnostics?.adapterVersion === 'synthetic-v03'));
});
await check('Schema 2 旧记录缺少呈现与诊断仍可读取和备份恢复', async () => {
  const backup = exportProject(env.state, env.project.id);
  for (const row of [...backup.records.messages, ...backup.records.versions]) delete row.presentation;
  for (const snapshot of backup.records.snapshots) delete snapshot.diagnostics;
  validateBackup(backup); const next = fresh(); restoreBackup(next, backup);
  assert.ok(next.messages.every(m => typeof m.text === 'string'));
});
const report = { version: EXTENSION_VERSION, checkedAt: new Date().toISOString(), passed: checks.length, failed: failures.length, checks, failures,
  scope: 'Synthetic full-body/presentation/snapshot persistence and version/backup contracts; excludes browser UI and live ChatGPT' };
fs.writeFileSync(new URL('../dist/V03_DATA_VALIDATION_REPORT.json', import.meta.url), JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
