import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { EXTENSION_VERSION } from '../domain/common.js';

const root = path.resolve(import.meta.dirname, '..'), directory = path.join(root, 'dist', 'opc-tests'); fs.mkdirSync(directory, { recursive: true });
const suites = ['core', 'regressions', 'v03', 'adapter', 'full-conversation', 'reader', 'navigation', 'document-sources', 'document-formats', 'conversation-outline', 'document-recipes', 'v1-links', 'opc', 'opc-improvements', 'qa-p0', 'v14', 'release', 'search-management', 'project-workspace', 'interactions', 'timeline-stability', 'tag-suggestions', 'project-deletion'];
const results = [];
// Knowledge engine pure tests are part of the normal gate; real inference and
// browser regressions remain separately measured browser suites.
suites.push('knowledge','hybrid');
for (const suite of suites) {
  const result = spawnSync(process.execPath, [...(suite==='search-management'?['--expose-gc']:[]),`scripts/validate-${suite}.mjs`], { cwd: root, encoding: 'utf8' });
  fs.writeFileSync(path.join(directory, `${suite}.log`), result.stdout + result.stderr);
  results.push({ suite, passed: result.status === 0, reportedChecks: (result.stdout.match(/^PASS /gm) ?? []).length });
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${suite}`);
  if (result.status !== 0) console.error((result.stdout + result.stderr).slice(-2000));
}
const staticCheck = spawnSync(process.execPath, ['--experimental-vm-modules', 'scripts/build.mjs', '--check'], { cwd: root, encoding: 'utf8' });
results.push({ suite: 'static', passed: staticCheck.status === 0 }); console.log(staticCheck.stdout.trim());
if (staticCheck.status !== 0) console.error(staticCheck.stderr);
const report = { version: EXTENSION_VERSION, ok: results.every(r => r.passed), suites: results, checkedAt: new Date().toISOString(), scope: 'Node domain/renderer/adapter regression and static checks. Browser/IndexedDB tests have a separate report. No live ChatGPT account or installed MV3 assertion.' };
fs.writeFileSync(path.join(root, 'dist', 'OPC_NODE_REPORT.json'), JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
