import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(process.execPath),{chromium}=require('../node_modules/playwright');
const browserPath=process.env.OPC_TEST_BROWSER??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
for(const file of ['storage/database.js','domain/release-data.js','domain/common.js']){
 const destination=path.resolve('dist/project-v8',file);fs.mkdirSync(path.dirname(destination),{recursive:true});
 fs.writeFileSync(destination,execFileSync('git',['show',`local-v1-before-project-organization:apps/navigator-extension/${file}`]));
}
const server=spawn(process.execPath,['scripts/serve-validation.mjs','8951'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
const profileDirectory=path.resolve('dist','project-browser-profile-'+Date.now());
const launchOptions={headless:true,executablePath:browserPath,viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']};
const context=await chromium.launchPersistentContext(profileDirectory,launchOptions),browser=context.browser(),page=await context.newPage(),errors=[],namespace='v04-project-'+Date.now();
page.on('pageerror',e=>errors.push(e.message));
const report={ok:false,browser:browserPath,isolatedContext:true,profileDirectory,namespace,checks:[],errors,scope:'Real Chromium/Edge DOM and IndexedDB on isolated localhost with synthetic sources. No user profile, live ChatGPT or installed MV3 assertion.'};
const test=async(name,fn)=>{try{const details=await fn();report.checks.push({name,passed:true,details});console.log('PASS '+name);}catch(e){report.checks.push({name,passed:false,error:e.stack});console.log('FAIL '+name+' '+e.message);throw e;}};
try{
 await page.goto(`http://127.0.0.1:8951/validation/project-workspace-browser.html?validationDb=${namespace}`);await page.waitForFunction(()=>globalThis.workspaceTest);
 await test('200 synthetic Q/A across five source projects imported',async()=>{const s=await page.evaluate(()=>workspaceTest.seed());if(s.qaCards.length!==200||s.conversations.length!==5||s.qaCards.some(c=>c.validity.state!=='ACTIVE'))throw new Error('invalid seed');return {cards:s.qaCards.length,conversations:s.conversations.length};});
 await test('UI create, associate five Conversations, organize and open directory',async()=>{
   await page.getByRole('button',{name:'Project Workspace',exact:true}).click();await page.getByRole('button',{name:'新建 Workspace',exact:true}).click();await page.getByLabel('项目名称',{exact:true}).fill('本地开发测试');await page.getByRole('button',{name:'确认',exact:true}).click();
   await page.getByRole('button',{name:'关联 Conversation',exact:true}).click();for(const checkbox of await page.locator('.workspace-conversation-list input').all())await checkbox.check();await page.getByRole('button',{name:'保存关联',exact:true}).click();
   await page.getByRole('button',{name:'本地算法整理',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.project-workspace-dialog')?.textContent.includes('上次整理 200'));
   const n=await page.locator('[data-workspace-card]').count();if(n!==200)throw new Error('directory count '+n);await page.screenshot({path:'dist/PROJECT_WORKSPACE_DESKTOP.png'});
   return page.evaluate(()=>({topics:workspaceTest.timeline.workspace.row.topics.length,analysis:workspaceTest.timeline.workspace.row.analysis}));
 });
 await test('UI rename, move, split/merge and rerun protect manual changes',async()=>{
   const group=page.locator('.workspace-topic').first();await group.getByRole('button',{name:'修改主题名'}).click();await page.getByLabel('名称',{exact:true}).fill('人工确认主题');await page.getByRole('button',{name:'确认',exact:true}).click();
   await page.getByRole('button',{name:'本地算法整理',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.workspace-topic')?.textContent.includes('人工确认主题'));
   await page.locator('[data-workspace-card] input').first().check();await page.getByRole('button',{name:'所选拆为新主题',exact:true}).click();await page.getByLabel('新主题名称').fill('手工拆分');await page.getByRole('button',{name:'确认',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.project-workspace-dialog')?.textContent.includes('手工拆分 · 1 个问题'));
   const split=page.locator('.workspace-topic').filter({has:page.locator('summary',{hasText:'手工拆分'})});await split.getByRole('button',{name:'合并到其他主题'}).click();await page.getByRole('button',{name:'确认',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.project-workspace-dialog')?.textContent.includes('手工拆分'));
 });
 await test('project-scoped search covers full answers and source filter',async()=>{
   await page.getByLabel('搜索项目内 Q/A').fill('answer_199');await page.locator('.project-workspace-dialog').getByRole('button',{name:'搜索',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-workspace-card]').length===1);
   const otherSource=await page.evaluate(()=>workspaceTest.timeline.workspace.data.conversations.find(c=>c.id!==workspaceTest.timeline.workspace.data.cards[0].conversationId).id);await page.getByLabel('按来源 Conversation 筛选').selectOption(otherSource);await page.waitForFunction(()=>document.querySelectorAll('[data-workspace-card]').length===0);
   await page.getByLabel('搜索项目内 Q/A').fill('');await page.getByLabel('按来源 Conversation 筛选').selectOption('');await page.locator('.project-workspace-dialog').getByRole('button',{name:'搜索',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-workspace-card]').length===200);
 });
 await test('Project → original Reader → existing Deploy editor/compile/copy',async()=>{
   await page.locator('[data-workspace-card] .workspace-question-title').first().click();await page.waitForFunction(()=>document.querySelector('.opc-detail')?.textContent.includes('原始用户提问'));
   await page.locator('.opc-detail').getByRole('button',{name:'更多操作'}).count().then(async count=>{if(count)await page.locator('.opc-detail').getByRole('button',{name:'更多操作'}).click();});
   const action=page.locator('.opc-detail').getByRole('button',{name:'加入当前 Workspace 并打开 Deploy',exact:true});if(!await action.isVisible())await page.locator('.reading-menu summary').click();await action.click();
   await page.getByRole('button',{name:'编辑上下文包',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.deploy-settings'));
   await page.getByRole('button',{name:/预览/}).first().click();await page.waitForFunction(()=>document.querySelector('.pack-output')?.value.includes('原文保留'));
   await page.getByRole('button',{name:'复制完整上下文',exact:true}).click();
   const copied=await page.evaluate(async()=>({text:await navigator.clipboard.readText(),preview:document.querySelector('.pack-output').value}));if(copied.text.replace(/\r\n?/g,'\n')!==copied.preview)throw new Error('clipboard differs from pack preview '+JSON.stringify({textLength:copied.text.length,previewLength:copied.preview.length,textStart:copied.text.slice(0,90),previewStart:copied.preview.slice(0,90)}));
   await page.screenshot({path:'dist/PROJECT_WORKSPACE_DEPLOY.png'});
 });
 await test('cross-source pack idempotence, exact text and source IDs',async()=>page.evaluate(async()=>{
   const t=workspaceTest,w=t.timeline.workspace.row,s=await t.readState(),cards=s.conversations.slice(0,2).map(c=>s.qaCards.find(q=>q.conversationId===c.id));
   for(let i=0;i<2;i++)await t.command('releaseWrite',{projectId:w.id,action:'tray',operation:'add',cardIds:cards.map(c=>c.id)});
   const info=await t.command('releaseInfo',{projectId:w.id});if(new Set(info.tray.cardIds).size!==info.tray.cardIds.length)throw new Error('duplicate tray');
   const sameSource=s.qaCards.find(c=>c.conversationId===cards[0].conversationId&&c.id!==cards[0].id);cards.push(sameSource);
   await t.command('opcWrite',{projectId:cards[0].projectId,action:'relationship',fromCardId:cards[0].id,toCardId:sameSource.id,type:'依赖',directed:true,description:'人工确认依赖'});
   const issue=await t.command('releaseWrite',{projectId:cards[0].projectId,action:'issue',cardId:cards[0].id,title:'原来源待解决事项'});
   const pack=await t.command('releaseWrite',{projectId:w.id,action:'pack',selectedIssueIds:[issue.id],title:'跨来源精确原文',mode:'FULL',selectedCardIds:cards.flatMap(c=>[c.id,c.id]),tokenBudget:100000});
   const compiled=await t.command('contextCompile',{projectId:w.id,packId:pack.id,expectedRevision:pack.revision});
   if(compiled.pack.compilation.orderedCardIds.indexOf(sameSource.id)>compiled.pack.compilation.orderedCardIds.indexOf(cards[0].id))throw new Error('confirmed Canvas dependency omitted');
   const unrelated=await t.command('workspaceWrite',{action:'create',name:'临时权限范围测试'});let rejected=false;try{await t.command('releaseWrite',{projectId:unrelated.id,action:'tray',operation:'add',cardIds:[cards[0].id]});}catch{rejected=true;}if(!rejected)throw new Error('unassociated card authorized');
   await t.command('workspaceWrite',{workspaceId:unrelated.id,expectedRevision:0,action:'archive'});
   for(const c of cards){const d=await t.command('opcDetail',{projectId:c.projectId,cardId:c.id});if(!compiled.pack.generatedContent.includes(d.questionBody)||!compiled.pack.generatedContent.includes(d.answerBody))throw new Error('pack lost original text');}
   if((await t.readState()).qaCards.some(c=>c.projectId===w.id))throw new Error('source project rewritten');return {cards:pack.selectedCardIds.length};
 }));
 await page.keyboard.press('Escape');await page.locator('.opc-detail').getByRole('button',{name:'返回 Project Workspace',exact:true}).evaluate(e=>e.click());
 await test('many-to-many, repeated import, hidden/invalid exclusion, backup restoration',async()=>page.evaluate(async()=>{
   const t=workspaceTest,before=await t.readState(),w=before.projectWorkspaces.find(x=>x.name==='本地开发测试'),other=await t.command('workspaceWrite',{action:'create',name:'共享 Conversation'});
   await t.command('workspaceWrite',{action:'conversations',workspaceId:other.id,expectedRevision:0,conversationIds:[w.conversationIds[0]]});
   const renamed=w.topics.find(t=>t.name==='人工确认主题');if(!renamed)throw new Error('rename lost');
   await t.reimport();let after=await t.readState();if(after.qaCards.length!==200||JSON.stringify(after.projectWorkspaces.find(x=>x.id===w.id))!==JSON.stringify(w))throw new Error('repeat import changed workspace');
   await t.command('conversationManage',{projectId:after.conversations[1].projectId,conversationIds:[after.conversations[1].id],values:{hidden:true}});
   await t.mutate(s=>{const c=s.qaCards.find(c=>c.conversationId===s.conversations[2].id);c.validity.state='PENDING';c.visibleAnswerIds=[];c.answerPreview='';c.answerRenderPreview='';c.answerVersionIds={};});
   if((await t.command('workspaceData',{workspaceId:w.id})).cards.length!==159)throw new Error('hidden/invalid leaked');
   const backup=await t.command('memoryExport',{});if(!backup.workspaceData)throw new Error('workspace missing from backup');
   const restored=await t.command('memoryImport',{text:JSON.stringify(backup)});after=await t.readState();if(after.projectWorkspaces.length!==6||restored.projectIds.length!==5)throw new Error('restore missing workspaces');
   const r=after.projectWorkspaces.find(x=>x.name===w.name&&x.id!==w.id);if(r.name!==w.name||!r.topics.some(t=>t.name==='人工确认主题'))throw new Error('manual backup lost');
   const point=await t.command('memoryCreate',{name:'Workspace synthetic recovery'});await t.command('memoryRestore',{pointId:point.id,expectedChecksum:point.checksum});
   return {restoredProjects:restored.projectIds.length,workspaceCopies:(await t.readState()).projectWorkspaces.length};
 }));
 await test('page reload persists associations and manual topics; responsive directory',async()=>{
   await page.reload();await page.waitForFunction(()=>globalThis.workspaceTest);await page.evaluate(async()=>{await workspaceTest.ready();const data=await workspaceTest.command('workspaceData',{});await workspaceTest.timeline.workspace.open(data.workspaces.find(x=>x.name==='本地开发测试').id);});
   if(!await page.getByText('人工确认主题',{exact:false}).count())throw new Error('manual change lost after reload');
   for(const width of [390,720]){await page.setViewportSize({width,height:900});await page.screenshot({path:`dist/PROJECT_WORKSPACE_${width}.png`});const overflow=await page.locator('.project-workspace-dialog').evaluate(e=>e.scrollWidth>e.clientWidth+2);if(overflow)throw new Error('horizontal dialog overflow '+width);}
 });
 report.ok=report.checks.every(c=>c.passed)&&!errors.length;report.uiErrors=await page.evaluate(()=>workspaceTest.errors);report.ok&&=!report.uiErrors.length;
 await test('browser process restart preserves Workspace topics, associations and packs',async()=>{
   await context.close();const restarted=await chromium.launchPersistentContext(profileDirectory,launchOptions);
   try{const reopened=await restarted.newPage();await reopened.goto(`http://127.0.0.1:8951/validation/project-workspace-browser.html?validationDb=${namespace}`);await reopened.waitForFunction(()=>globalThis.workspaceTest);
    return await reopened.evaluate(async()=>{const t=workspaceTest,s=await t.ready(),w=s.projectWorkspaces.find(w=>w.name==='本地开发测试');if(w.conversationIds.length!==5||!w.topics.some(t=>t.name==='人工确认主题'))throw new Error('lost workspace on browser restart');const info=await t.command('releaseInfo',{projectId:w.id});if(info.packs.length<2)throw new Error('lost workspace packs');return {conversations:w.conversationIds.length,packs:info.packs.length};});
   }finally{await restarted.close();}
 });
}catch(e){report.fatal=e.stack;await page.screenshot({path:'dist/PROJECT_WORKSPACE_FAILURE.png'}).catch(()=>{});report.dom=await page.locator('body').innerText().catch(()=>null);}
finally{fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/PROJECT_WORKSPACE_BROWSER_REPORT.json',JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,fatal:report.fatal,errors,uiErrors:report.uiErrors},null,2));await browser.close();server.kill();}
process.exitCode=report.ok?0:1;
