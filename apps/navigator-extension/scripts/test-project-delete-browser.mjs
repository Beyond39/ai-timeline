import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const {chromium}=createRequire(process.execPath)('../node_modules/playwright');
const server=spawn(process.execPath,['scripts/serve-validation.mjs','8957'],{windowsHide:true,stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
let browser;const report={checks:[],errors:[],scope:'Synthetic source Project deletion in a fresh isolated local IndexedDB; no user data touched.'};
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.OPC_TEST_BROWSER??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(`http://127.0.0.1:8957/validation/interaction-browser.html?validationDb=v04-interaction-delete-${Date.now()}`);await page.waitForFunction(()=>globalThis.interactionTest);await page.evaluate(()=>interactionTest.seed());
 const check=async(name,run)=>{const actual=await page.evaluate(run);report.checks.push({name,passed:true,actual});console.log('PASS '+name);};
 await check('prepare cross-source Workspace with frozen manual Deploy output',async()=>{
  const t=interactionTest,s=await t.readState();let w=await t.command('workspaceWrite',{action:'create',name:'删除保护的共享项目'});w=await t.command('workspaceWrite',{workspaceId:w.id,expectedRevision:w.revision,action:'conversations',conversationIds:s.conversations.map(c=>c.id)});
  const deleted=s.projects[0],other=s.projects[1],cards=[s.qaCards.find(c=>c.projectId===deleted.id),s.qaCards.find(c=>c.projectId===other.id)];
  const p=await t.command('releaseWrite',{projectId:w.id,action:'pack',title:'删除前冻结内容',mode:'FULL',tokenBudget:50000,selectedCardIds:cards.map(c=>c.id)});const compiled=await t.command('contextCompile',{projectId:w.id,packId:p.id,expectedRevision:p.revision});const pack=await t.command('releaseWrite',{projectId:w.id,action:'pack',packId:p.id,expectedRevision:compiled.pack.revision,editedContent:compiled.pack.generatedContent+'\n人工尾注必须保留'});
  await t.command('releaseWrite',{projectId:w.id,action:'tray',operation:'add',cardIds:cards.map(c=>c.id)});await t.command('releaseWrite',{projectId:w.id,action:'decision',cardId:cards[0].id,text:'保留的 Workspace 人工决定',status:'候选结论',verifiedByUser:false});
  t.deleteFixture={workspaceId:w.id,deleted,other,pack};t.deleteOriginal=await t.readState();return {sources:2,workspace:w.id};
 });
 await check('wrong confirmation and changed preview fail without deleting or creating a recovery point',async()=>{
  const t=interactionTest,{deleted}=t.deleteFixture,preview=await t.command('projectDeletePreview',{projectId:deleted.id}),initial=await t.readState(),mem=await t.command('memoryStatus',{});let rejected=0;
  for(const args of [{confirmName:'错误名称'},{confirmName:deleted.name,expectedRevision:preview.revision-1}])try{await t.command('deleteProject',{projectId:deleted.id,...args});}catch{rejected++;}
  const after=await t.readState(),later=await t.command('memoryStatus',{});if(rejected!==2||JSON.stringify(initial)!==JSON.stringify(after)||later.points.length!==mem.points.length)throw new Error('invalid deletion changed data');return preview;
 });
 await check('successful deletion writes a recovery point and keeps unrelated source + frozen output',async()=>{
  const t=interactionTest,{deleted,other,workspaceId,pack}=t.deleteFixture;await t.timeline.horizontal.flush();const preview=await t.command('projectDeletePreview',{projectId:deleted.id}),result=await t.command('deleteProject',{projectId:deleted.id,confirmName:deleted.name,expectedRevision:preview.revision}),s=await t.readState(),mem=await t.command('memoryStatus',{});
  if(!result.recoveryPointId||!mem.points.some(p=>p.id===result.recoveryPointId))throw new Error('missing pre-delete recovery');if(s.projects.some(p=>p.id===deleted.id)||s.messages.some(m=>m.projectId===deleted.id))throw new Error('deleted source remains');
  for(const store of ['conversations','messages','versions','qaCards','qaMetadata','relationships','canvasLayouts'])if(JSON.stringify(s[store].filter(r=>r.projectId===other.id))!==JSON.stringify(t.deleteOriginal[store].filter(r=>r.projectId===other.id)))throw new Error('unrelated source changed '+store);
  const preserved=s.contextPacks.find(p=>p.id===pack.id);if(preserved.editedContent!==pack.editedContent||preserved.generatedContent!==pack.generatedContent||!preserved.sourceUnavailable)throw new Error('frozen/manual pack altered');const w=s.projectWorkspaces.find(w=>w.id===workspaceId);if(w.conversationIds.some(id=>!s.conversations.some(c=>c.id===id)))throw new Error('dangling association');const decision=s.decisions.find(d=>d.projectId===workspaceId);if(decision.text!=='保留的 Workspace 人工决定'||!decision.sourceUnavailable||decision.cardId!==null)throw new Error('manual decision lost');t.deleteRecoveryId=result.recoveryPointId;return result;
 });
 await check('remaining Workspace zoom and library backup work after deletion; recovery restores as new projects',async()=>{
  const t=interactionTest;await t.timeline.show({projectId:t.deleteFixture.workspaceId});const h=t.timeline.horizontal,before=h.layout.pxPerMs;await h.zoom(1/1.5);if(h.layout.pxPerMs<=before)throw new Error('post-delete Workspace zoom ineffective');
  const backup=await t.command('memoryExport',{});await t.command('memoryImportPreview',{text:JSON.stringify(backup)});const memory=await t.command('memoryStatus',{}),point=memory.points.find(p=>p.id===t.deleteRecoveryId),restored=await t.command('memoryRestore',{pointId:point.id,expectedChecksum:point.checksum}),s=await t.readState();if(restored.projectIds.length!==2||!s.projects.some(p=>p.name===t.deleteFixture.deleted.name+'（备份恢复）'&&p.id!==t.deleteFixture.deleted.id))throw new Error('recovery did not restore source safely');return {restoredProjects:restored.projectIds.length};
 });
 report.ok=!report.errors.length;
}catch(error){report.ok=false;report.error=error.stack;console.error(error);}
finally{await browser?.close();server.kill();fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/PROJECT_DELETE_BROWSER_REPORT.json',JSON.stringify(report,null,2));}
process.exitCode=report.ok?0:1;
