// Creates explicitly synthetic fixtures. Actual IndexedDB comparisons run via the
// separate local performance page; this script does not claim browser measurements.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORES } from '../storage/database.js';
import { parseImport } from '../importers/json.js';
import { createProject, saveConversation } from '../domain/captures.js';
import { generateRuleSuggestion, exportAnalysisPack } from '../domain/organization.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineDatabase = path.join(root, 'validation', 'baseline-v021', 'storage', 'database.js');
if (!fs.existsSync(baselineDatabase)) throw new Error('Prepare validation/baseline-v021 from the preserved V0.2.1 package first.');
const baseline = fs.readFileSync(baselineDatabase, 'utf8');
if (!baseline.includes('indexedDB.open(DATABASE, 3)')) fs.writeFileSync(baselineDatabase, baseline.replace('indexedDB.open(DATABASE, 2)', 'indexedDB.open(DATABASE, 3)'));
const state = { ...Object.fromEntries(STORES.map(store => [store, []])), revision: 1 }, cases = [];
for (const rounds of [500, 2000, 1000]) {
  const project = createProject(state, `性能隔离样例 · ${rounds === 1000 ? '无关项目' : '目标项目'} · ${rounds}轮（合成）`);
  const messages = Array.from({ length: rounds }, (_, index) => [
    { id: `u-${rounds}-${index}`, role: 'user', text: `明确标记的合成问答 ${index + 1}：中文全文搜索 Ｆｏｏ e\u0301 主题采集与存储。` },
    { id: `a-${rounds}-${index}`, role: 'assistant', text: `${'这是合成的长回答，用于验证原文完整性、范围读取和性能，不来自真实ChatGPT页面。'.repeat(index % 25 === 0 ? 240 : 30)}\n命中 benchmark-hit ${index + 1}。` }
  ]).flat();
  const payload = await parseImport(JSON.stringify({ provider: 'v03-benchmark-synthetic', conversations: [{ id: `benchmark-${rounds}`, title: `${rounds}轮合成对话`, messages }] }), 'performance-v03-example.json');
  const saved = await saveConversation(state, payload.conversations[0], project.id);
  if (rounds !== 1000) {
    const suggestion = await generateRuleSuggestion(state, { conversationId: saved.conversationId, pathId: saved.pathId });
    for (let repeat = 1; repeat < 12; repeat++) state.suggestions.push({ ...structuredClone(suggestion), id: `benchmark-${rounds}-suggestion-${repeat}` });
    const qas = state.qas.filter(qa => qa.pathId === saved.pathId).sort((a, b) => a.ordinal - b.ordinal);
    await exportAnalysisPack(state, { conversationId: saved.conversationId, pathId: saved.pathId, startQAId: qas[0].id, endQAId: qas[59].id, batchSize: 20 });
    cases.push({ rounds, projectId: project.id, conversationId: saved.conversationId, pathId: saved.pathId, qaId: qas[Math.floor(rounds / 2)].id, suggestionId: suggestion.id });
  }
}
const fixture = { synthetic: true, label: '明确标记的多项目长对话合成样例；不代表当前ChatGPT DOM', createdAt: new Date().toISOString(), cases,
  scales: { targetRounds: [500, 2000], unrelatedProjectRounds: 1000, projects: state.projects.length, messages: state.messages.length, suggestions: state.suggestions.length, analysisPacks: state.analysisPacks.length }, state };
const output = path.join(root, 'validation', 'performance-v03-fixture.json'); fs.writeFileSync(output, JSON.stringify(fixture));
console.log(JSON.stringify({ fixture: output, bytes: fs.statSync(output).size, scales: fixture.scales, baselineCompatibilityPatch: 'Only indexedDB.open database version 2 -> 3; all V0.2.1 read algorithms unchanged.' }, null, 2));
