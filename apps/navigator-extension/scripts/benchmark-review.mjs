import fs from 'node:fs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { STORES } from '../storage/database.js';
import { parseImport } from '../importers/json.js';
import { createProject, saveConversation } from '../domain/captures.js';
import { generateRuleSuggestion, getSuggestion } from '../domain/organization.js';

const baseline = process.argv.includes('--baseline');
const directory = new URL('../dist/', import.meta.url);
fs.mkdirSync(directory, { recursive: true });
const fixtureFile = new URL('REVIEW_PERFORMANCE_FIXTURE.json', directory);
let state;
if (baseline) {
  state = { ...Object.fromEntries(STORES.map(name => [name, []])), revision: 0 };
  const project = createProject(state, '性能验证 · 500 轮隔离样例');
  const messages = Array.from({ length: 500 }, (_, i) => [
    { id: `u-${i}`, role: 'user', text: `聊天采集 DOM 和消息存储，第 ${i + 1} 轮。` },
    { id: `a-${i}`, role: 'assistant', text: '这段是明确标记的合成样例正文，用于检查持续保存、完整阅读和导航。'.repeat(35) }
  ]).flat();
  const input = await parseImport(JSON.stringify({ provider: 'benchmark-fixture', conversations: [{ id: 'review-large', messages }] }), 'benchmark-example.json');
  const saved = await saveConversation(state, input.conversations[0], project.id);
  const suggestion = await generateRuleSuggestion(state, { conversationId: saved.conversationId, pathId: saved.pathId });
  for (let i = 1; i < 40; i++) state.suggestions.push({ ...structuredClone(suggestion), id: `benchmark-suggestion-${i}` });
  fs.writeFileSync(fixtureFile, JSON.stringify(state));
} else state = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
const cache = new Map(), start = performance.now(), values = [];
for (const row of state.suggestions) values.push(await getSuggestion(state, { suggestionId: row.id }, cache));
const elapsedMs = Number((performance.now() - start).toFixed(2));
assert.ok(values.every(row => !row.stale && row.status === 'pending'));
const report = { checkedAt: new Date().toISOString(), mode: baseline ? 'before-request-cache' : 'after-request-cache',
  qas: state.qas.length, messages: state.messages.length, suggestions: values.length, elapsedMs,
  sourceVersion: values[0].sourceVersion, navigationVersion: values[0].navigationVersion,
  scope: 'Bounded synthetic fixture; suggestion detail computation only, excludes browser/storage/rendering' };
if (!baseline) {
  const before = JSON.parse(fs.readFileSync(new URL('REVIEW_PERFORMANCE_BEFORE.json', directory), 'utf8'));
  assert.equal(report.sourceVersion, before.sourceVersion); assert.equal(report.navigationVersion, before.navigationVersion);
  report.beforeMs = before.elapsedMs; report.speedup = Number((before.elapsedMs / elapsedMs).toFixed(2));
}
fs.writeFileSync(new URL(baseline ? 'REVIEW_PERFORMANCE_BEFORE.json' : 'REVIEW_PERFORMANCE_AFTER.json', directory), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
