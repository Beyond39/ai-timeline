import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(process.execPath),{chromium}=require('../node_modules/playwright');
const phase=process.argv.find(a=>a.startsWith('--phase='))?.split('=')[1]??'all',baseline=process.argv.includes('--baseline');
const server=spawn(process.execPath,['scripts/serve-validation.mjs','8953'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error('Validation server exited '+code)));});
let browser;
try{browser=await chromium.launch({headless:true,executablePath:process.env.OPC_TEST_BROWSER??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});}catch(e){server.kill();throw e;}
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(7000);
const report={phase,baseline,checks:[],errors,browser:'Isolated Edge/Chromium; synthetic local origin; no installed MV3 or live account assertion'};
const check=async(name,run)=>{try{const actual=await run();report.checks.push({name,passed:true,actual});console.log('PASS '+name);}catch(e){report.checks.push({name,passed:false,error:e.message});console.log('FAIL '+name+' '+e.message);await page.screenshot({path:'dist/INTERACTION_FAILURE.png'}).catch(()=>{});if(!baseline)throw e;}};
const snapshot=()=>page.evaluate(()=>{const t=interactionTest.timeline,h=t.horizontal;return {span:h.layout.visibleSpan,width:h.scroll.clientWidth,board:h.scroll.scrollWidth,left:h.scroll.scrollLeft,preference:h.preferences.axisSpanMs};});
const drag=async(x,y,dx,dy)=>{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:8});await page.mouse.up();};
const closeReader=async()=>{const button=page.locator('.opc-detail').getByRole('button',{name:'关闭',exact:true});if(await button.isVisible())await button.click();};
try{
 await page.goto(`http://127.0.0.1:8953/validation/interaction-browser.html?validationDb=v04-interaction-${Date.now()}`);await page.waitForFunction(()=>globalThis.interactionTest);const seed=await page.evaluate(()=>interactionTest.seed());
 if(['all','timeline'].includes(phase)){
  await check('single Conversation zoom really changes scale; pan and wheel change scroll',async()=>{
   await page.getByRole('button',{name:'选择来源',exact:true}).click();const choices=page.locator('#track-dialog input');for(const c of await choices.all())await c.uncheck();await choices.first().check();await page.getByRole('button',{name:'保存选择',exact:true}).click();
   const before=await snapshot();await page.getByRole('button',{name:'时间放大',exact:true}).click();const zoomed=await snapshot();if(zoomed.span>=before.span||zoomed.board<=zoomed.width)throw new Error('zoom had no range effect '+JSON.stringify({before,zoomed}));
   const box=await page.locator('.ht-scroll').boundingBox();await drag(box.x+box.width*.65,box.y+90,-100,0);const panned=await snapshot();if(panned.left===zoomed.left)throw new Error('drag did not pan');
   await page.mouse.move(box.x+box.width*.3,box.y+80);await page.mouse.wheel(0,-80);await page.waitForFunction(left=>interactionTest.timeline.horizontal.scroll.scrollLeft!==left,panned.left);return {before,zoomed,panned};
  });
  await check('view-save notification preserves pressed controls and pan surface',async()=>{
   await page.evaluate(()=>interactionTest.notifications(true));const control=page.getByRole('button',{name:'时间放大',exact:true}),handle=await control.elementHandle(),box=await control.boundingBox(),before=await snapshot();
   await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.evaluate(()=>interactionTest.timeline.horizontal.save());await page.waitForTimeout(100);
   if(!await handle.evaluate(e=>e.isConnected))throw new Error('view save detached pressed zoom button');await page.mouse.up();await page.waitForFunction(span=>interactionTest.timeline.horizontal.layout.visibleSpan<span,before.span);
   if(await page.evaluate(()=>interactionTest.notifications(false))!==0)throw new Error('view-only change rebuilt workbench');
  });
  await check('zoom out, fit, latest and actual point click open complete Reader',async()=>{
   const before=await snapshot();await page.getByRole('button',{name:'时间缩小',exact:true}).click();if((await snapshot()).span<=before.span)throw new Error('zoom out ineffective');await page.getByRole('button',{name:'适配全部',exact:true}).click();
   if((await snapshot()).board>(await snapshot()).width+3)throw new Error('fit still overflows');
   await page.locator('.ht-point').first().click();await page.getByText('Q · 原始用户提问',{exact:true}).waitFor();if(!await page.locator('.opc-reading-body').textContent().then(t=>t.includes('ANSWER-TAIL-')))throw new Error('Reader truncated');await closeReader();
   await page.getByRole('button',{name:'定位最新',exact:true}).click();await page.getByText('Q · 原始用户提问',{exact:true}).waitFor();await closeReader();
  });
 }
 if(['all','reading'].includes(phase)){
  await closeReader();await page.evaluate(id=>interactionTest.timeline.show({projectId:id,mode:'canvas'}),seed.projectIds[0]);await closeReader();
  await check('real Canvas header click opens existing full Reader',async()=>{await page.locator('.compact-node-open').first().click();await page.getByText('Q · 原始用户提问',{exact:true}).waitFor();const text=await page.locator('.opc-reading-body').textContent();if(!text.includes('QUESTION-TAIL-')||!text.includes('ANSWER-TAIL-'))throw new Error('truncated body');if(!await page.locator('.opc-reading-body pre code').count()||!await page.locator('.opc-reading-body math').count())throw new Error('code/math rendering lost');await closeReader();});
  await check('after node drag, next normal click reads without moving node',async()=>{const box=await page.locator('.compact-node-open').first().boundingBox();await drag(box.x+45,box.y+25,50,30);const moved=await page.evaluate(()=>({...interactionTest.timeline.positions}));await page.locator('.compact-node-open').first().click();await page.getByText('Q · 原始用户提问',{exact:true}).waitFor();if(JSON.stringify(moved)!==JSON.stringify(await page.evaluate(()=>interactionTest.timeline.positions)))throw new Error('plain click moved a node');await closeReader();});
 }
 if(['all','hover'].includes(phase)){
  await closeReader();await page.evaluate(id=>interactionTest.timeline.show({projectId:id,mode:'canvas'}),seed.projectIds[0]);
  const popup=page.locator('.card-hover-preview'),nodes=page.locator('.opc-canvas-node');
  const park=async()=>{await page.mouse.move(8,8);await page.locator('#status').click();await page.waitForTimeout(350);};
  await check('hover waits ~300ms, uses raw Q/A, correct source and single fixed portal',async()=>{
   await park();await nodes.first().hover();await page.waitForTimeout(130);if(await popup.isVisible())throw new Error('preview appeared before delay');await popup.waitFor({state:'visible'});
   const text=await popup.textContent();if(!text.includes('Q · ')||!text.includes('A · ')||!text.includes('来源 Conversation'))throw new Error('preview content/source missing');
   const geometry=await popup.evaluate(p=>({parent:p.parentElement.tagName,position:getComputedStyle(p).position,pointer:getComputedStyle(p).pointerEvents,transform:getComputedStyle(p).transform}));if(geometry.parent!=='BODY'||geometry.position!=='fixed'||geometry.pointer!=='none'||geometry.transform!=='none')throw new Error('preview affects world or hit testing');
   if(await page.locator('.card-hover-preview:not([hidden])').count()!==1)throw new Error('more than one preview');await page.screenshot({path:'dist/CANVAS_HOVER_PREVIEW.png'});return geometry;
  });
  await check('Escape/leave/fast traversal cancel tooltip; delayed local read cannot leave stale preview',async()=>{
   await page.keyboard.press('Escape');await popup.waitFor({state:'hidden'});await park();await nodes.first().hover();await page.waitForTimeout(60);await nodes.nth(1).hover();await page.waitForTimeout(60);await page.mouse.move(8,8);await page.waitForTimeout(400);if(await popup.isVisible())throw new Error('fast traversal left preview');
   await page.evaluate(()=>{const t=interactionTest.timeline,h=t.hoverPreview;t.originalHoverLoad=h.load;h.cache.clear();h.load=args=>new Promise(resolve=>{t.finishHover=async()=>resolve(await t.originalHoverLoad(args));});});
   await nodes.first().hover();await page.waitForFunction(()=>Boolean(interactionTest.timeline.finishHover));await page.mouse.move(8,8);await page.evaluate(()=>interactionTest.timeline.finishHover());await page.waitForTimeout(50);if(await popup.isVisible())throw new Error('stale async hover reopened');await page.evaluate(()=>{interactionTest.timeline.hoverPreview.load=interactionTest.timeline.originalHoverLoad;});
  });
  await check('hover closes during node drag, Canvas pan/zoom and actual edge connection',async()=>{
   await park();await nodes.first().hover();await popup.waitFor({state:'visible'});const box=await page.locator('.compact-node-open').first().boundingBox();await page.mouse.move(box.x+40,box.y+25);await page.mouse.down();await page.mouse.move(box.x+80,box.y+50,{steps:8});await page.waitForTimeout(350);if(await popup.isVisible())throw new Error('preview during drag');await page.mouse.up();if(await page.locator('.opc-detail:not([hidden])').count())throw new Error('drag opened Reader');
   const before=await page.evaluate(()=>({...interactionTest.timeline.viewport})),canvas=await page.locator('.opc-canvas').boundingBox();await drag(canvas.x+canvas.width-35,canvas.y+50,-60,20);if((await page.evaluate(()=>interactionTest.timeline.viewport.x))===before.x)throw new Error('Canvas pan failed');
   await page.mouse.move(canvas.x+canvas.width-40,canvas.y+60);await page.mouse.wheel(0,-60);await page.waitForFunction(z=>interactionTest.timeline.viewport.zoom!==z,before.zoom);if(await popup.isVisible())throw new Error('preview during zoom');
   await page.evaluate(()=>{const t=interactionTest.timeline;t.viewport={x:20,y:20,zoom:1};t.applyViewport();});
   const anchor=await page.locator('.opc-connect-anchor').nth(2).boundingBox(),target=await nodes.nth(4).boundingBox();await drag(anchor.x+anchor.width/2,anchor.y+anchor.height/2,target.x+target.width/2-anchor.x-anchor.width/2,target.y+40-anchor.y-anchor.height/2);
   await page.getByLabel('关系类型（可输入自定义类型）',{exact:true}).fill('交互测试关系');await page.getByRole('button',{name:'保存关系',exact:true}).click();await page.waitForFunction(()=>interactionTest.timeline.data.relationships.some(r=>r.type==='交互测试关系'));if(await popup.isVisible())throw new Error('preview during connection');
  });
  await check('edge-of-window placement avoids card, remains unscaled and leaves click operational',async()=>{
   await page.setViewportSize({width:1000,height:850});await page.evaluate(()=>{const t=interactionTest.timeline,card=t.canvasCards[0],p=t.positions[card.id];t.viewport={x:document.documentElement.clientWidth-295-p.x*.8,y:90-p.y*.8,zoom:.8};t.applyViewport();});await park();await nodes.first().hover();await popup.waitFor({state:'visible'});
   const p=await popup.boundingBox(),n=await nodes.first().boundingBox();if(p.x<0||p.y<0||p.x+p.width>1000||p.y+p.height>850)throw new Error('preview clipped at window edge');if(p.x<n.x+n.width&&p.x+p.width>n.x&&p.y<n.y+n.height&&p.y+p.height>n.y)throw new Error('preview covers hovered card');await page.screenshot({path:'dist/CANVAS_HOVER_EDGE.png'});
   await page.locator('.compact-node-open').first().click();await page.getByText('Q · 原始用户提问',{exact:true}).waitFor();await popup.waitFor({state:'hidden'});const saved=await page.evaluate(()=>({...interactionTest.timeline.viewport}));await closeReader();if(JSON.stringify(saved)!==JSON.stringify(await page.evaluate(()=>interactionTest.timeline.viewport)))throw new Error('closing Reader reset viewport');
  });
  await check('keyboard focused node previews, Enter opens full Reader; selection/footer actions remain independent',async()=>{
   await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{const t=interactionTest.timeline;t.viewport={x:20,y:20,zoom:1};t.applyViewport();});await park();await nodes.first().focus();await popup.waitFor({state:'visible'});await page.keyboard.press('Enter');await page.getByText('Q · 原始用户提问',{exact:true}).waitFor();await closeReader();
   const before=await page.evaluate(()=>({...interactionTest.timeline.positions}));await nodes.nth(2).locator('input[type=checkbox]').check();if(await page.locator('.opc-detail:not([hidden])').count())throw new Error('selection opened Reader');await nodes.nth(2).getByRole('button',{name:'＋ 上下文',exact:true}).click();await page.waitForFunction(()=>interactionTest.timeline.data.tray?.cardIds.length>0);if(JSON.stringify(before)!==JSON.stringify(await page.evaluate(()=>interactionTest.timeline.positions)))throw new Error('footer action moved node');
  });
 }
 if(phase==='all'){
  await check('two associated Conversations / Workspace close / single source return preserve Timeline interactions',async()=>{
   await closeReader();await page.evaluate(async id=>{await interactionTest.timeline.show({projectId:interactionTest.timeline.projectId,mode:'timeline'});await interactionTest.timeline.workspace.open(id);},seed.workspaceId);
   if(await page.locator('[data-workspace-card]').count()!==12)throw new Error('Workspace lost associated cards');
   await page.locator('.project-workspace-dialog .workspace-topic>summary').first().click();
   const target=seed.cards.find(c=>c.sourceTitle==='来源 Conversation 1');await page.locator(`[data-workspace-card="${target.id}"] .workspace-question-title`).click();await page.waitForFunction(id=>document.querySelector('.opc-detail')?.dataset.cardId===id,target.id);if(!(await page.locator('.opc-detail-content>p.muted').first().textContent()).includes(target.sourceTitle))throw new Error('wrong source Conversation');await closeReader();
   if(await page.locator('dialog[open]').count())throw new Error('Workspace left modal overlay');
   await page.getByRole('button',{name:'选择来源',exact:true}).click();for(const option of await page.locator('#track-dialog input').all())await option.check();await page.getByRole('button',{name:'保存选择',exact:true}).click();
   const before=await snapshot();await page.getByRole('button',{name:'时间放大',exact:true}).click();if((await snapshot()).span>=before.span)throw new Error('multi Conversation zoom failed');
   await page.getByRole('button',{name:'选择来源',exact:true}).click();const options=page.locator('#track-dialog input');for(const option of await options.all())await option.uncheck();await options.first().check();await page.getByRole('button',{name:'保存选择',exact:true}).click();await page.getByRole('button',{name:'时间放大',exact:true}).click();const b=await page.locator('.ht-scroll').boundingBox(),left=(await snapshot()).left;await drag(b.x+b.width*.6,b.y+80,-60,0);if((await snapshot()).left===left)throw new Error('single Conversation pan failed after return');
  });
  await check('late Reader request cannot overwrite another Project or reopened Reader',async()=>{
   await closeReader();await page.evaluate(cardId=>{const t=interactionTest.timeline,api=t.api;t.savedApi=api;t.api=async(type,args)=>{const data=await api(type,args);if(type==='opcDetail'&&args.cardId===cardId){t.oldReaderReached=true;await new Promise(resolve=>t.releaseOldReader=resolve);}return data;};t.oldReader=t.openCard(cardId);},seed.cards[0].id);
   await page.waitForFunction(()=>interactionTest.timeline.oldReaderReached);await page.evaluate(id=>interactionTest.timeline.show({projectId:id,mode:'timeline'}),seed.projectIds[1]);await page.locator('.ht-point').first().click();await page.getByText('Q · 原始用户提问',{exact:true}).waitFor();
   await page.evaluate(async()=>{const t=interactionTest.timeline;t.releaseOldReader();await t.oldReader;t.api=t.savedApi;});const body=await page.locator('.opc-reading-body').textContent();if(!body.includes('ANSWER-TAIL-2_'))throw new Error('stale Project Reader won race');await closeReader();
  });
  await check('original bodies/IDs/sources/notes/relations survive; moved coordinates and existing Deploy persist',async()=>page.evaluate(async projectId=>{
   const t=interactionTest.timeline;await t.show({projectId,mode:'canvas'});await t.flushLayout();const after=await interactionTest.readState(),before=interactionTest.original;
   for(const store of ['messages','versions','qaCards','conversations','qaMetadata','projectWorkspaces'])if(JSON.stringify(before[store])!==JSON.stringify(after[store]))throw new Error('source state changed: '+store);
   for(const relation of before.relationships)if(!after.relationships.some(r=>JSON.stringify(r)===JSON.stringify(relation)))throw new Error('original relation lost');
   const original=before.canvasLayouts.find(l=>l.projectId===projectId),current=after.canvasLayouts.find(l=>l.projectId===projectId),changed=Object.keys(original.positions).filter(k=>JSON.stringify(original.positions[k])!==JSON.stringify(current.positions[k]));if(changed.length!==1)throw new Error('unexpected moved node count '+changed.length);
   const card=t.data.cards[0],pack=await interactionTest.command('releaseWrite',{projectId,action:'pack',title:'交互回归 Deploy',mode:'FULL',selectedCardIds:[card.id],tokenBudget:50000}),compiled=await interactionTest.command('contextCompile',{projectId,packId:pack.id,expectedRevision:pack.revision}),detail=await interactionTest.command('opcDetail',{projectId,cardId:card.id});if(!compiled.pack.generatedContent.includes(detail.questionBody)||!compiled.pack.generatedContent.includes(detail.answerBody))throw new Error('Deploy lost full source');return {unchangedSourceTables:6,originalRelations:before.relationships.length,movedNodes:changed.length,deploy:true};
  },seed.projectIds[0]));
  await check('emulated touch tap reads full Q/A without a hover overlay',async()=>{
   const touch=await browser.newContext({hasTouch:true,isMobile:true,viewport:{width:390,height:850}});
   try{const p=await touch.newPage();p.setDefaultTimeout(7000);p.on('pageerror',e=>errors.push(e.message));await p.goto(`http://127.0.0.1:8953/validation/interaction-browser.html?validationDb=v04-interaction-touch-${Date.now()}`);await p.waitForFunction(()=>globalThis.interactionTest);await p.evaluate(async()=>{const seed=await interactionTest.seed();await interactionTest.timeline.show({projectId:seed.projectIds[0],mode:'canvas'});});await p.locator('.compact-node-open').first().tap();await p.getByText('Q · 原始用户提问',{exact:true}).waitFor();if(!(await p.locator('.opc-reading-body').textContent()).includes('ANSWER-TAIL-'))throw new Error('touch Reader incomplete');if(await p.locator('.card-hover-preview:not([hidden])').count())throw new Error('touch tap left hover');
   }finally{await touch.close();}
  });
 }
 report.uiErrors=await page.evaluate(()=>interactionTest.errors);report.ok=report.checks.every(c=>c.passed)&&!errors.length&&!report.uiErrors.length;
}catch(e){report.fatal=e.stack;report.ok=false;}
finally{fs.mkdirSync('dist',{recursive:true});fs.writeFileSync(`dist/INTERACTIONS_${baseline?'BASELINE':phase.toUpperCase()}_REPORT.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,errors,fatal:report.fatal},null,2));await browser.close();server.kill();}
process.exitCode=report.ok||baseline?0:1;
