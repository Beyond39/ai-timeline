// Generate disposable compatibility fixtures from the previously delivered V0.1 implementation.
import fs from 'node:fs';
import { fixturePayload } from '../validation/fixture.mjs';
import { parseImport } from '../dist/ai-conversation-visual-navigator/importers/json.js';
import { createProject, saveConversation } from '../dist/ai-conversation-visual-navigator/domain/captures.js';
import { editSegment } from '../dist/ai-conversation-visual-navigator/domain/edits.js';
import { exportProject } from '../dist/ai-conversation-visual-navigator/domain/backup.js';
const stores = ['projects','conversations','messages','versions','snapshots','paths','qas','segments','topics','revisions','drafts'];
if (JSON.parse(fs.readFileSync(new URL('../dist/ai-conversation-visual-navigator/manifest.json', import.meta.url))).version !== '0.1.0') throw new Error('Legacy fixtures are already checked in; generation requires the original V0.1 loadable modules.');
const state = Object.fromEntries(stores.map(name => [name, []])); state.revision = 0;
const project = createProject(state, 'V0.1 迁移验证（隔离样例）');
const input = await parseImport(JSON.stringify(fixturePayload()), 'validation-example.json');
for (const conversation of input.conversations) await saveConversation(state, conversation, project.id);
const segment = state.segments[0]; editSegment(state, { segmentId: segment.id, baseRevision: segment.revision, operation: 'rename', title: 'V0.1 人工标题 · 必须保留' });
fs.mkdirSync(new URL('../validation/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../validation/v01-state.json', import.meta.url), JSON.stringify(state, null, 2));
fs.writeFileSync(new URL('../validation/v01-backup.json', import.meta.url), JSON.stringify(exportProject(state, project.id), null, 2));
console.log('Generated V0.1 compatibility fixtures from the original delivered modules; no user data read.');
