import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STORES } from '../storage/database.js';
import { createProject, saveConversation, moveConversation } from '../domain/captures.js';
import { parseImport } from '../importers/json.js';
import { exportProject, validateBackup, restoreBackup } from '../domain/backup.js';
import { saveConversationLink, archiveConversationLink, listConversationLinks } from '../domain/conversation-links.js';

const checks = [];
const test = async (name, run) => { await run(); checks.push(name); console.log(`PASS ${name}`); };
const state = { ...Object.fromEntries(STORES.map(name => [name, []])), revision: 0 };
const project = createProject(state, 'V1 关联与记忆 · 合成测试');
const imported = await parseImport(JSON.stringify({ provider: 'v1-labelled-synthetic', conversations: ['one', 'two'].map(key => ({ id: key, title: `合成 ${key}`, messages: [{ id: `${key}-q`, role: 'user', text: `合成问题 ${key}` }, { id: `${key}-a`, role: 'assistant', text: `完整回答 ${key} · CODE-END` }] })) }), 'v1-synthetic.json');
for (const conversation of imported.conversations) await saveConversation(state, conversation, project.id);
const refs = state.conversations.map(conversation => { const message = state.messages.find(row => row.conversationId === conversation.id && row.role === 'assistant'); return { conversationId: conversation.id, messageId: message.id, versionId: message.currentVersionId }; });
let link;
await test('跨Conversation关系绑定确切消息版本，不改变正文和历史', () => {
  const before = JSON.stringify({ messages: state.messages, versions: state.versions }); link = saveConversationLink(state, { projectId: project.id, from: refs[0], to: refs[1], type: 'supports', note: '用户确认的依据' });
  assert.equal(link.basis, 'user_confirmed'); assert.equal(JSON.stringify({ messages: state.messages, versions: state.versions }), before); assert.equal(listConversationLinks(state, { projectId: project.id }).length, 1);
});
await test('旧答案更新后关联仍指向旧版本并显示历史标记', async () => {
  const updated = structuredClone(imported.conversations[0]); updated.messages[1].text = '新版完整回答 · NEW-END'; await saveConversation(state, updated, project.id);
  const listing = listConversationLinks(state, { projectId: project.id }); assert.equal(listing[0].fromSource.versionId, refs[0].versionId); assert.equal(listing[0].fromSource.historical, true); assert.match(listing[0].fromSource.excerpt, /CODE-END/);
});
await test('错误版本、同会话、跨项目与重复关联全部拒绝且不改数据', () => {
  const before = JSON.stringify(state);
  for (const args of [ { from: { ...refs[0], versionId: refs[1].versionId } }, { to: refs[0] }, { projectId: 'other' }, {} ]) assert.throws(() => saveConversationLink(state, { projectId: project.id, from: refs[0], to: refs[1], type: 'supports', ...args }));
  assert.equal(JSON.stringify(state), before);
});
await test('编辑并发版本拒绝；归档与恢复只改关系状态', () => {
  assert.throws(() => saveConversationLink(state, { projectId: project.id, linkId: link.id, expectedRevision: 0, from: refs[0], to: refs[1], type: 'related' }));
  link = archiveConversationLink(state, { projectId: project.id, linkId: link.id, expectedRevision: link.revision }); assert.equal(listConversationLinks(state, { projectId: project.id }).length, 0);
  assert.equal(listConversationLinks(state, { projectId: project.id, archived: true }).length, 1);
  link = archiveConversationLink(state, { projectId: project.id, linkId: link.id, expectedRevision: link.revision, archived: false }); assert.equal(link.status, 'active');
});
await test('备份与恢复重建关系ID但完整保留历史依据和原文', () => {
  const backup = exportProject(state, project.id); validateBackup(backup);
  const result = restoreBackup(state, backup); const restored = state.conversationLinks.find(row => row.projectId === result.projectId);
  assert.notEqual(restored.from.messageId, refs[0].messageId); assert.match(state.versions.find(row => row.id === restored.from.versionId).text, /CODE-END/); validateBackup(exportProject(state, result.projectId));
});
await test('旧Schema2没有新功能数组也可恢复，保留旧Q/A与版本', () => {
  const legacy = exportProject(state, project.id); for (const name of ['documentRecipes', 'documentPrints', 'conversationLinks']) delete legacy.records[name];
  validateBackup(legacy); const result = restoreBackup(state, legacy); assert.equal(state.conversations.filter(row => row.projectId === result.projectId).length, 2);
});
await test('损坏的关联证据备份与引用中的Conversation移动均安全拒绝', () => {
  const bad = exportProject(state, project.id); bad.records.conversationLinks[0].from.versionId = refs[1].versionId; assert.throws(() => validateBackup(bad));
  const target = createProject(state, '合成另一个项目'); const before = JSON.stringify(state); assert.throws(() => moveConversation(state, state.conversations.find(row => row.id === refs[0].conversationId), target.id)); assert.equal(JSON.stringify(state), before);
});
const report = { version: '1.0.0', checkedAt: new Date().toISOString(), syntheticDataOnly: true, passed: checks.length, failed: 0, checks, scope: 'Pure domain/backup checks; actual database upgrades are separately tested in browser.' };
fs.writeFileSync(new URL('../dist/V1_LINKS_VALIDATION_REPORT.json', import.meta.url), JSON.stringify(report, null, 2));
