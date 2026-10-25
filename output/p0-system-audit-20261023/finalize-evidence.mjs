import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const directory=import.meta.dirname,root=path.resolve(directory,'../..'),extension=path.join(root,'apps/navigator-extension');
const read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const before=read('RUNTIME_BEFORE_ACCEPTANCE.json'),after=read('RELEASE_RUNTIME_1.6.3.json'),sync=read('RELEASE_SYNC_1.6.3.json'),lifecycle=read('RELEASE_LIFECYCLE_1.6.3.json'),node=read('NODE_RELEASE_1.6.3.json'),pack=read('RELEASE_PACKAGE_1.6.3.json');
const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));
assert.equal(before.checks.length,12);assert.equal(before.checks.filter(c=>c.status==='FAIL').length,8);
assert(after.ok&&sync.ok&&lifecycle.ok&&node.ok);assert.equal(after.checks.length,12);assert(after.checks.every(c=>c.status==='PASS'));
assert.equal(sync.checks.length,23);assert.equal(lifecycle.checks.length,15);
assert.equal(after.worker.version,manifest.version);assert.equal(node.version,manifest.version);assert(pack.passed);assert.equal(pack.version,manifest.version);
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for(const[file,value]of Object.entries(after.diskFiles))assert.equal(hash(path.join(extension,file)),value,'Runtime acceptance source changed: '+file);
for(const report of [sync,lifecycle])for(const[file,value]of Object.entries(report.loadedFiles))assert.equal(hash(path.join(extension,file)),value,'Other acceptance source changed: '+file);
const changed=['background.js','ui/app.js','ui/opc.js','ui/horizontal-timeline.js','package.json','manifest.json','domain/common.js','workspace.html','sidepanel.html','scripts/build.mjs','scripts/verify-package.mjs'],added=['ui/selection-state.js','domain/runtime-build.js','scripts/workspace-live-probe.js'];
for(const file of ['scripts/build.mjs','scripts/verify-package.mjs']){
  const snapshot=path.join(directory,'before',file);
  if(fs.existsSync(snapshot))continue;
  // These tracked files had no starting changes. Verify that fact before using
  // HEAD as their pre-edit snapshot; never reconstruct over user modifications.
  assert(!fs.readFileSync(path.join(directory,'working-tree-before.patch'),'utf8').includes(`diff --git a/apps/navigator-extension/${file} `));
  const original=spawnSync('git',['show','HEAD:apps/navigator-extension/'+file],{cwd:root,encoding:'utf8'});assert.equal(original.status,0);
  fs.mkdirSync(path.dirname(snapshot),{recursive:true});fs.writeFileSync(snapshot,original.stdout);
}
let patch='';
for(const file of changed){
  const diff=spawnSync('git',['diff','--no-index','--no-ext-diff','--',path.join(directory,'before',file),path.join(extension,file)],{encoding:'utf8'});
  assert([0,1].includes(diff.status),diff.stderr);
  const target='apps/navigator-extension/'+file;
  patch+=diff.stdout.replace(/^diff --git .*$/m,`diff --git a/${target} b/${target}`).replace(/^--- .*$/m,`--- a/${target}`).replace(/^\+\+\+ .*$/m,`+++ b/${target}`);
}
for(const file of added){
  const target='apps/navigator-extension/'+file,lines=fs.readFileSync(path.join(extension,file),'utf8').replace(/\r\n/g,'\n').trimEnd().split('\n');
  patch+=`diff --git a/${target} b/${target}\nnew file mode 100644\n--- /dev/null\n+++ b/${target}\n@@ -0,0 +1,${lines.length} @@\n`+lines.map(line=>'+'+line+'\n').join('');
}
fs.writeFileSync(path.join(directory,'production-change.patch'),patch);
const summary={checkedAt:new Date().toISOString(),timezone:'Asia/Shanghai',build:'p0-interaction-lifecycle-20261023.1',manifestVersion:manifest.version,actualUserInstance:'NOT TESTED — user reports +/− remain affected; live Chrome URL verification stopped Computer Use again, user currently cannot provide manual records.',
  browserVersion:after.browserVersion,syntheticOnly:true,
  reports:{before:{file:'RUNTIME_BEFORE_ACCEPTANCE.json',checks:12,failed:8},after:{file:'RELEASE_RUNTIME_1.6.3.json',checks:12,failed:0},nativeSidePanelSync:{file:'RELEASE_SYNC_1.6.3.json',checks:23,failed:0},projectLifecycle:{file:'RELEASE_LIFECYCLE_1.6.3.json',checks:15,failed:0},node:{file:'NODE_RELEASE_1.6.3.json',suites:node.suites.filter(s=>s.suite!=='static').length,checks:node.suites.reduce((sum,s)=>sum+(s.reportedChecks??0),0),failed:0}},
  package:{file:'RELEASE_PACKAGE_1.6.3.json',archive:pack.archive,sha256:pack.sha256,bytes:pack.bytes,files:pack.files},
  sourceHashesMatchRuntimeReports:true,
  finalSourceHashes:Object.fromEntries([...changed,...added,'scripts/test-workspace-runtime-mv3.mjs','scripts/workspace-live-probe.js','scripts/test-workspace-sync-mv3.mjs','scripts/inspect-loaded-extension.mjs','docs/P0_SYSTEM_RUNTIME_AUDIT_2026-10-23.zh-CN.md'].map(file=>[file,hash(path.join(extension,file))])),
  functionFingerprints:{before:before.functionFingerprints,after:after.functionFingerprints},
  productionPatchScope:'Only this round: runtime interaction fixes, version coherence, build/verification support and opt-in live probe. Test runners, README and report are separate workspace files; prior uncommitted changes excluded.',
  dataProtection:'No live IndexedDB read/write, browser restart, schema migration, reset, commit or push. Only OPC registration metadata was read from daily profiles.'};
fs.writeFileSync(path.join(directory,'AUDIT_SUMMARY.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({ok:true,reports:summary.reports,sourceHashesMatchRuntimeReports:true,productionPatch:'production-change.patch'},null,2));
