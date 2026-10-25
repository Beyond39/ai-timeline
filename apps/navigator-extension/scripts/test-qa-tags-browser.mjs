import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const {chromium}=createRequire(process.execPath)('../node_modules/playwright');
const server=spawn(process.execPath,['scripts/serve-validation.mjs','8955'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
let browser;const report={checks:[],errors:[],scope:'Real Edge/Chromium DOM and local IndexedDB; synthetic Q/A only, no live account.'};
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.OPC_TEST_BROWSER??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(8000);page.on('pageerror',e=>report.errors.push(e.message));
 const check=async(name,run)=>{await run();report.checks.push({name,passed:true});console.log('PASS '+name);};
 await page.goto(`http://127.0.0.1:8955/validation/interaction-browser.html?validationDb=v04-interaction-tags-${Date.now()}`);await page.waitForFunction(()=>globalThis.interactionTest);
 const seed=await page.evaluate(()=>interactionTest.seed()),original=await page.evaluate(()=>interactionTest.original);
 const cardId=original.qaMetadata[0].cardId;
 await check('generate offline suggestions for all associated sources without changing manual fields',async()=>{
  await page.evaluate(id=>interactionTest.timeline.workspace.open(id),seed.workspaceId);await page.getByRole('button',{name:'生成项目 Q/A 候选标签',exact:true}).click();await page.locator('.qa-candidate-chip').first().waitFor();
  const state=await page.evaluate(()=>interactionTest.readState());if(state.qaMetadata.filter(m=>m.localSuggestion).length!==12)throw new Error('wrong suggestion count');for(const old of original.qaMetadata){const m=state.qaMetadata.find(m=>m.cardId===old.cardId);for(const k of ['title','tags','topic','notes'])if(JSON.stringify(m[k])!==JSON.stringify(old[k]))throw new Error('manual '+k+' overwritten');}
 });
 await check('Workspace opens same Reader; edit then accept candidates, manual title remains',async()=>{
  await page.locator(`[data-workspace-card="${cardId}"] .workspace-question-title`).click();await page.getByLabel('候选简洁标题',{exact:true}).fill('缩放 · 状态');await page.getByLabel('候选标签',{exact:true}).fill('视口回归，离线分析');await page.getByRole('button',{name:'保存候选编辑',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.qa-local-suggestions')?.textContent.includes('已编辑，待采用'));
  await page.getByRole('button',{name:'采用候选',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.qa-local-suggestions')?.textContent.includes('已采用'));if(await page.locator('.opc-detail-content>h2').textContent()!=='保留的自定义标题')throw new Error('human title replaced');await page.screenshot({path:'dist/QA_LOCAL_SUGGESTIONS.png'});
 });
 await check('repeat analysis uses version cache, accepted tags become searchable, conflicts reject',async()=>{
  const result=await page.evaluate(projectId=>interactionTest.command('qaAnalyze',{projectId}),seed.workspaceId);if(result.generated!==0||result.cached!==12)throw new Error('cache/review reset '+JSON.stringify(result));
  const search=await page.evaluate(()=>interactionTest.command('globalSearch',{query:'视口回归',type:'qa'}));if(!search.results.some(r=>r.cardId===cardId))throw new Error('accepted tag not searchable');
  const stale=await page.evaluate(async({projectId,cardId})=>{try{await interactionTest.command('qaReview',{projectId,cardId,operation:'accept',expectedRevision:0});return false;}catch{return true;}},{projectId:seed.workspaceId,cardId});if(!stale)throw new Error('stale write accepted');
 });
 await check('reload retains edited accepted content; remove automatic content keeps manual tags',async()=>{
  await page.locator('.close-detail').click();await page.reload();await page.waitForFunction(()=>globalThis.interactionTest);await page.evaluate(async({projectId,cardId})=>{await interactionTest.timeline.show({projectId});await interactionTest.timeline.openCard(cardId);},{projectId:seed.projectIds[0],cardId});await page.getByLabel('候选标签',{exact:true}).waitFor();if(await page.getByLabel('候选标签',{exact:true}).inputValue()!=='视口回归，离线分析')throw new Error('edits lost after reload');
  await page.getByRole('button',{name:'移除已采用的自动内容',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.qa-local-suggestions')?.textContent.includes('已拒绝'));
  const state=await page.evaluate(()=>interactionTest.readState()),m=state.qaMetadata.find(m=>m.cardId===cardId),old=original.qaMetadata[0];if(m.autoTags.length||m.autoTitle||m.title!==old.title||JSON.stringify(m.tags)!==JSON.stringify(old.tags)||m.notes!==old.notes)throw new Error('clear altered manual');
 });
 await check('original sources/relations/Canvas survive; library backup preserves suggestions and Project preferences',async()=>{
  await page.evaluate(id=>interactionTest.timeline.show({projectId:id}),seed.workspaceId);
  // Durable source choices are explicit; window-local zoom does not create a
  // shared preference record. Save choices before testing their backup mapping.
  await page.getByRole('button',{name:'选择来源',exact:true}).click();await page.getByRole('button',{name:'保存选择',exact:true}).click();await page.evaluate(()=>interactionTest.timeline.horizontal.flush());
  report.preferencesBeforeBackup=await page.evaluate(id=>{return interactionTest.readState().then(s=>({workspaceId:id,total:s.timelinePreferences.length,workspacePreference:s.timelinePreferences.find(p=>p.projectId===id)??null}));},seed.workspaceId);
  if(!report.preferencesBeforeBackup.workspacePreference?.selectedTimelineIds.length)throw new Error('explicit source choices were not persisted');
  await page.getByRole('button',{name:'时间放大',exact:true}).click();
  await page.evaluate(async original=>{const state=await interactionTest.readState();for(const k of ['messages','versions','qaCards','relationships','canvasLayouts'])if(JSON.stringify(original[k])!==JSON.stringify(state[k]))throw new Error('altered '+k);const backup=await interactionTest.command('memoryExport',{});if(!backup.projects?.length)throw new Error('backup unavailable');await interactionTest.command('memoryImportPreview',{text:JSON.stringify(backup)});const restored=await interactionTest.command('memoryImport',{text:JSON.stringify(backup)}),after=await interactionTest.readState(),w=after.projectWorkspaces.find(w=>w.name===state.projectWorkspaces[0].name&&w.id!==state.projectWorkspaces[0].id),pref=after.timelinePreferences.find(p=>p.projectId===w.id);if(!pref||pref.selectedTimelineIds.some(id=>!after.timelines.some(t=>t.id===id&&restored.projectIds.includes(t.projectId))))throw new Error('restored preference references old sources');if(after.qaMetadata.filter(m=>m.localSuggestion).length!==state.qaMetadata.filter(m=>m.localSuggestion).length*2)throw new Error('suggestions missing from restore');},original);
 });
 report.uiErrors=await page.evaluate(()=>interactionTest.errors);report.ok=!report.errors.length&&!report.uiErrors.length;
}catch(error){report.ok=false;report.error=error.stack;console.error(error);}
finally{await browser?.close();server.kill();fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/QA_TAGS_BROWSER_REPORT.json',JSON.stringify(report,null,2));}
process.exitCode=report.ok?0:1;
