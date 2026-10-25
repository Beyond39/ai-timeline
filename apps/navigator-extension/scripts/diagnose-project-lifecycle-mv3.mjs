// Lifecycle diagnosis without Fit All, reload-as-repair, forced clicks, or seed
// preference writes. All projects and conversations are synthetic in a new profile.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { graph, user, body } from '../validation/qa-p0-fixtures.mjs';
import { chromium, browserExecutable as findBrowser } from './browser-runtime.mjs';
const extension=path.resolve(process.env.OPC_TEST_EXTENSION??'.');
const browserExecutable=findBrowser();
const width=Number(process.argv.find(v=>v.startsWith('--width='))?.slice(8)??1040);
const profile=path.resolve('dist','project-lifecycle-profile-'+Date.now());fs.mkdirSync(profile,{recursive:true});
const report={startedAt:new Date().toISOString(),version:JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8')).version,profile,extension,browserExecutable,width,checks:[],snapshots:[],errors:[],navigationRaces:process.argv.includes('--navigation-races'),scope:'Native Chrome MV3, isolated profile, synthetic records; default viewport state is never repaired by Fit All. Navigation race checks use explicit read gates and injected failures, ordinary lifecycle checks do not.'};
report.loadedFiles=Object.fromEntries(['ui/app.js','ui/opc.js','ui/horizontal-timeline.js','ui/workbench.css'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(extension,file))).digest('hex')]));
let context,workspace;
const rpc=(page,type,args={})=>page.evaluate(async({type,args})=>{const r=await chrome.runtime.sendMessage({type,args});if(!r.ok)throw Error(r.error);return r.data;},{type,args});
async function attach(page){
  page.on('pageerror',e=>report.errors.push({kind:'pageerror',message:e.message}));
  await page.evaluate(()=>{window.lifecycle={events:[],calls:[]};for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,e=>{lifecycle.events.push({type,target:e.target.tagName,id:e.target.id,class:e.target.className,label:e.target.closest('button')?.getAttribute('aria-label')});},true);});
  const cdp=await context.newCDPSession(page);
  const {result:proto}=await cdp.send('Runtime.evaluate',{expression:'import("./ui/opc.js").then(m=>m.OPCTimeline.prototype)',awaitPromise:true});
  const {objects}=await cdp.send('Runtime.queryObjects',{prototypeObjectId:proto.objectId});
  await cdp.send('Runtime.callFunctionOn',{objectId:objects.objectId,functionDeclaration:'function(){lifecycle.timeline=this.find(t=>t.host?.isConnected);}',returnByValue:true});
  await cdp.send('Runtime.releaseObject',{objectId:proto.objectId});await cdp.send('Runtime.releaseObject',{objectId:objects.objectId});await cdp.detach();
  await page.evaluate(()=>{for(const [object,methods]of [[lifecycle.timeline,['show','load','render','openCard']],[lifecycle.timeline.horizontal,['zoom','fit','render']]])for(const method of methods){const original=object[method];object[method]=function(...args){lifecycle.calls.push({method,projectId:lifecycle.timeline.projectId,time:performance.now()});return original.apply(this,args);};}});
}
async function snapshot(page,name){
  const s=await page.evaluate(()=>{
    const t=lifecycle.timeline,h=t.horizontal,scroll=document.querySelector('.ht-scroll'),plus=document.querySelector('[aria-label="时间放大"]'),nav=document.querySelector('#project-library');
    const box=e=>{const b=e?.getBoundingClientRect();return b&&{x:b.x,y:b.y,width:b.width,height:b.height};};
    const b=box(plus),hit=b&&document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
    return {entry:document.body.dataset.mode,innerWidth,selectedProject:document.querySelector('#project-select').value,activeProject:t.projectId,bodyClass:document.body.className,
      scale:h.layout?.pxPerMs,span:h.layout?.visibleSpan,axisFit:h.preferences?.axisFit,renderedProject:h.projectId,dataScope:h.data?.scope,epoch:t.epoch,navigationEpoch:t.navigationEpoch,viewBusy:document.querySelector('#timeline-view-button').disabled,nodes:[...document.querySelectorAll('.ht-point')].map(n=>({id:n.dataset.cardId,conversationId:n.dataset.conversationId,x:parseFloat(n.style.left)})),
      scroll:scroll&&{width:scroll.clientWidth,board:scroll.scrollWidth,left:scroll.scrollLeft},plus:{box:b,disabled:plus?.disabled,pointerEvents:plus&&getComputedStyle(plus).pointerEvents,hitId:hit?.id,hitClass:hit?.className,hitsButton:plus===hit||plus?.contains(hit)},
      library:{box:box(nav),display:getComputedStyle(nav).display,position:getComputedStyle(nav).position,zIndex:getComputedStyle(nav).zIndex},dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>({id:d.id,class:d.className})),calls:lifecycle.calls.slice(-25),events:lifecycle.events.slice(-25)};
  });report.snapshots.push({name,...s});return s;
}
async function createProject(page,name){
  if(!await page.locator('#new-project').isVisible())await page.locator('#library-toggle').click();
  await page.locator('#new-project').click();await page.locator('#edit-dialog input[name=name]').fill(name);await page.locator('#edit-dialog button[type=submit]').click();
  await page.waitForFunction(name=>document.querySelector('#map-title').textContent===name&&!document.querySelector('#timeline-view-button').disabled,name);
  return page.locator('#project-select').inputValue();
}
async function importConversation(page,projectId,label,count=5){
  const rows=[];let parent='root';for(let i=0;i<count;i++){const q=label+'q'+i,a=label+'a'+i;rows.push([q,parent,user(q,'Synthetic '+label+' question '+i,1790812800+i*86400)],[a,q,body(a,'Synthetic '+label+' answer '+i)]);parent=a;}
  const raw=graph(rows,parent,'lifecycle-'+label);raw.title='Synthetic '+label;
  const draft=await rpc(page,'importPreview',{text:JSON.stringify(raw),filename:'lifecycle-synthetic.json'});await rpc(page,'saveDraft',{draftId:draft.id,projectId});
  await page.waitForFunction(id=>lifecycle.timeline.projectId===id&&lifecycle.timeline.data?.cards.length>0&&!document.querySelector('#timeline-view-button').disabled,projectId);
}
async function ordinaryClick(page,label){
  const button=page.getByRole('button',{name:label,exact:true}),box=await button.boundingBox();assert(box);
  // A physical pointer at the visible button center; never bypasses hit testing.
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await page.evaluate(()=>new Promise(requestAnimationFrame));
}
async function chooseNativeProject(page,id){
  if(!await page.locator('#project-select').isVisible())await page.locator('#library-toggle').click();
  const select=page.locator('#project-select'),index=await select.evaluate((e,id)=>[...e.options].findIndex(o=>o.value===id),id),box=await select.boundingBox();assert(index>=0);
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await page.keyboard.press('Home');for(let i=0;i<index;i++)await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
}
async function nativeProject(page,id){
  // A completed selection is the starting point for ordinary navigation. The
  // race checks deliberately use chooseNativeProject directly while busy.
  await page.waitForFunction(()=>!document.querySelector('#timeline-view-button').disabled);
  if(await page.evaluate(id=>document.querySelector('#project-select').value===id&&lifecycle.timeline.projectId===id&&lifecycle.timeline.horizontal.projectId===id&&!document.querySelector('#timeline-view-button').disabled,id))return;
  await chooseNativeProject(page,id);
  await page.waitForFunction(id=>document.querySelector('#project-select').value===id&&lifecycle.timeline.projectId===id&&lifecycle.timeline.horizontal.projectId===id&&!document.querySelector('#timeline-view-button').disabled,id);
}
async function interactions(page,name){
  const before=await snapshot(page,name+' before');await ordinaryClick(page,'时间放大');const zoomed=await snapshot(page,name+' after +');
  await page.waitForTimeout(500);const settled=await snapshot(page,name+' after async settle');
  assert(zoomed.scale>before.scale,'+ did not change actual scale');assert.equal(settled.span,zoomed.span,'zoom was later reset');
  await ordinaryClick(page,'时间缩小');const out=await snapshot(page,name+' after −');assert(out.scale<zoomed.scale,'− did not change actual scale');
  assert(before.nodes.length>0,'missing circular Q/A');const point=page.locator('.ht-point').first(),id=await point.getAttribute('data-card-id');
  const box=await point.boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  await page.waitForFunction(id=>document.querySelector('.opc-detail')?.dataset.cardId===id&&!document.querySelector('.opc-detail').hidden&&document.querySelector('.opc-reading-body'),id,{timeout:3000});
  const detail=await rpc(page,'opcDetail',{projectId:before.activeProject,cardId:id});
  assert.equal(detail.card.conversationId,await point.getAttribute('data-conversation-id'));
  const readerText=await page.locator('.opc-reading-body').textContent();assert(readerText.includes('Synthetic '+detail.card.sourceTitle.replace('Synthetic ','')+' question'),'Reader question belongs to another Conversation');assert(readerText.includes(' answer '),'Reader answer was not loaded');
  assert.equal(await page.evaluate(()=>lifecycle.timeline.selected),id);await page.keyboard.press('Escape');await page.locator('.opc-detail').waitFor({state:'hidden'});
  return {projectId:before.activeProject,before:before.scale,after:zoomed.scale,out:out.scale,id};
}
async function check(name,run){try{const evidence=await run();report.checks.push({name,passed:true,evidence});console.log('PASS '+name);}catch(error){report.checks.push({name,passed:false,error:error.stack});throw error;}}
async function launch(){
  context=await chromium.launchPersistentContext(profile,{executablePath:browserExecutable,headless:!process.argv.includes('--headed'),viewport:{width:process.argv.includes('--start-narrow')?width:Math.max(1440,width),height:1000},ignoreDefaultArgs:['--disable-extensions'],args:['--remote-debugging-port=0','--enable-unsafe-extension-debugging']});
  report.browserVersion=context.browser().version();const browserCDP=await context.browser().newBrowserCDPSession();await browserCDP.send('Extensions.loadUnpacked',{path:extension});await browserCDP.detach();
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');return 'chrome-extension://'+new URL(worker.url()).host;
}
try{
  const origin=await launch();
  workspace=await context.newPage();workspace.setDefaultTimeout(7000);await workspace.goto(origin+'/workspace.html');await workspace.waitForFunction(()=>!document.querySelector('#timeline-view-button').disabled);await attach(workspace);
  const aid=await createProject(workspace,'Lifecycle A');await importConversation(workspace,aid,'A');
  if(width<1440)await workspace.setViewportSize({width,height:1000});
  // Establish the known-good one-Project state with the navigation intentionally
  // collapsed, exactly as a user returning to their Timeline would leave it.
  if(await workspace.locator('#project-library .panel-close').isVisible())await workspace.locator('#project-library .panel-close').click();
  await check('one Project, default zoom, ordinary mouse clicks',()=>interactions(workspace,'one Project A'));
  const bid=await createProject(workspace,'Lifecycle B');await snapshot(workspace,'B created empty');
  await check('an empty second independent Project does not break A interactions',async()=>{await nativeProject(workspace,aid);const evidence=await interactions(workspace,'A with empty B');await nativeProject(workspace,bid);return evidence;});
  await importConversation(workspace,bid,'B',3);
  await check('same Workspace creates second independent Project, default zoom without closing navigation',()=>interactions(workspace,'two Projects B'));
  await check('native project select popup switches B to A, then ordinary zoom and node clicks',async()=>{
    await nativeProject(workspace,aid);
    await workspace.waitForTimeout(600);await snapshot(workspace,'native Project select settled');
    return interactions(workspace,'native selected A');
  });
  if(process.argv.includes('--navigation-races')){
    await check('visible Project A remains interactive while Project B is loading',async()=>{
      await workspace.evaluate(id=>{
        const t=lifecycle.timeline,api=t.api;lifecycle.originalAPI=api;lifecycle.releaseProjectRead=null;lifecycle.cardReads=[];
        t.api=async(type,args)=>{if(type==='opcDetail')lifecycle.cardReads.push({projectId:args.projectId,cardId:args.cardId});const data=await api(type,args);if(type==='opcTimeline'&&args.projectId===id)await new Promise(resolve=>lifecycle.releaseProjectRead=resolve);return data;};
        lifecycle.navigation=t.show({projectId:id});
      },bid);
      await workspace.waitForFunction(()=>Boolean(lifecycle.releaseProjectRead));
      const before=await snapshot(workspace,'B loading, A visible');
      await ordinaryClick(workspace,'时间放大');const after=await snapshot(workspace,'A zoom during B load');
      const point=workspace.locator('.ht-point').first();await point.scrollIntoViewIfNeeded();const id=await point.getAttribute('data-card-id'),box=await point.boundingBox();await workspace.mouse.click(box.x+box.width/2,box.y+box.height/2);
      const reader=await workspace.waitForFunction(id=>document.querySelector('.opc-detail')?.dataset.cardId===id&&!document.querySelector('.opc-detail').hidden&&document.querySelector('.opc-reading-body')?.textContent.includes('Synthetic A answer'),id,{timeout:1500}).then(()=>true,()=>false);
      const reads=await workspace.evaluate(()=>lifecycle.cardReads);await snapshot(workspace,'node click during B load');
      const completion=await workspace.evaluate(async()=>{lifecycle.releaseProjectRead();const result=await lifecycle.navigation.then(()=>({ok:true}),e=>({ok:false,error:e.message}));lifecycle.timeline.api=lifecycle.originalAPI;return result;});
      report.navigationEvidence={before:{owner:before.activeProject,rendered:before.renderedProject,scale:before.scale},after:{owner:after.activeProject,rendered:after.renderedProject,scale:after.scale},reader,reads,completion};
      assert.equal(before.activeProject,aid,'controller adopted B before its data was ready');
      assert(after.scale>before.scale,'visible A + was reset by target B state');assert(reader,'visible A Q/A could not open');assert(reads.every(r=>r.projectId===aid),'A card queried through B scope');
      await workspace.evaluate(id=>lifecycle.timeline.show({projectId:id}),aid);
      return report.navigationEvidence;
    });
    await check('failed target read preserves the visible Project and its handlers',async()=>{
      await nativeProject(workspace,aid);
      const failure=await workspace.evaluate(async id=>{const t=lifecycle.timeline,api=t.api;t.api=(type,args)=>type==='opcTimeline'&&args.projectId===id?Promise.reject(Error('Synthetic target read failure')):api(type,args);try{await t.show({projectId:id});return false;}catch{return true;}finally{t.api=api;}},bid);
      assert(failure);const after=await snapshot(workspace,'failed B read leaves A');assert.equal(after.activeProject,aid);assert.equal(after.renderedProject,aid);return interactions(workspace,'A after B read failed');
    });
    await check('a source-selection dialog keeps its Project until saving and closing during target loading',async()=>{
      const before=await rpc(workspace,'opcTimeline',{projectId:aid});
      await workspace.evaluate(id=>{const t=lifecycle.timeline,api=t.api;lifecycle.originalAPI=api;lifecycle.releaseDialogRead=null;t.api=async(type,args)=>{const data=await api(type,args);if(type==='opcTimeline'&&args.projectId===id&&!lifecycle.releaseDialogRead)await new Promise(resolve=>lifecycle.releaseDialogRead=resolve);return data;};},bid);
      await chooseNativeProject(workspace,bid);await workspace.waitForFunction(()=>Boolean(lifecycle.releaseDialogRead));await workspace.getByRole('button',{name:'选择来源',exact:true}).click();
      await workspace.evaluate(()=>lifecycle.releaseDialogRead());await workspace.waitForTimeout(150);const during=await snapshot(workspace,'A source dialog during B load');
      report.dialogEvidence={owner:during.activeProject,rendered:during.renderedProject,dialogs:during.dialogs};assert.equal(during.activeProject,aid,'target committed while the old Project dialog remained open');
      await workspace.getByRole('button',{name:'保存选择',exact:true}).click();await workspace.locator('#track-dialog').waitFor({state:'hidden'});
      await workspace.waitForFunction(id=>lifecycle.timeline.projectId===id&&!document.querySelector('#timeline-view-button').disabled,bid);await workspace.evaluate(()=>{lifecycle.timeline.api=lifecycle.originalAPI;});
      const after=await rpc(workspace,'opcTimeline',{projectId:aid});assert.deepEqual(after.preferences.selectedTimelineIds,before.timelines.map(t=>t.id));
      await nativeProject(workspace,aid);return interactions(workspace,'A after source dialog save during B load');
    });
    await check('a Canvas edit completed during target loading is saved only to the source Project',async()=>{
      await workspace.evaluate(async id=>{await lifecycle.timeline.show({projectId:id,mode:'canvas'});await lifecycle.timeline.flushLayout();},aid);
      const node=workspace.locator('.compact-node-open').first(),cardId=await node.evaluate(e=>e.closest('[data-card-id]').dataset.cardId);
      const original=await rpc(workspace,'opcPage',{projectId:aid});
      await workspace.evaluate(id=>{const t=lifecycle.timeline,api=t.api;lifecycle.originalAPI=api;lifecycle.releaseCanvasRead=null;t.api=async(type,args)=>{const data=await api(type,args);if(type==='opcTimeline'&&args.projectId===id)await new Promise(resolve=>lifecycle.releaseCanvasRead=resolve);return data;};lifecycle.canvasNavigation=t.show({projectId:id,mode:'timeline'});},bid);
      await workspace.waitForFunction(()=>Boolean(lifecycle.releaseCanvasRead));const box=await node.boundingBox();
      await workspace.mouse.move(box.x+45,box.y+25);await workspace.mouse.down();await workspace.mouse.move(box.x+95,box.y+55,{steps:6});await workspace.mouse.up();
      const moved=await workspace.evaluate(id=>({...lifecycle.timeline.positions[id]}),cardId);assert.notDeepEqual(moved,original.layout.positions[cardId]);
      await workspace.evaluate(async()=>{lifecycle.releaseCanvasRead();await lifecycle.canvasNavigation;await lifecycle.timeline.flushLayout();lifecycle.timeline.api=lifecycle.originalAPI;});
      const after=await rpc(workspace,'opcPage',{projectId:aid}),target=await rpc(workspace,'opcPage',{projectId:bid});
      report.canvasEvidence={cardId,before:original.layout?.positions[cardId],moved,saved:after.layout?.positions[cardId],targetHasSourceCard:Boolean(target.layout?.positions[cardId])};
      assert.deepEqual(after.layout?.positions[cardId],moved,'source Canvas edit was lost after the target committed');assert(!target.layout?.positions[cardId],'source layout leaked into target Project');
      await workspace.evaluate(id=>lifecycle.timeline.show({projectId:id,mode:'timeline'}),aid);return report.canvasEvidence;
    });
  }
  await check('refresh and reopen Workspace with two independent Projects preserve working default controls',async()=>{
    await workspace.reload();await workspace.waitForFunction(()=>!document.querySelector('#timeline-view-button').disabled&&document.querySelector('.ht-point'));await attach(workspace);await interactions(workspace,'two Projects refreshed');
    const url=workspace.url();await workspace.close();workspace=await context.newPage();workspace.setDefaultTimeout(7000);await workspace.goto(url);await workspace.waitForFunction(()=>document.querySelector('.ht-point')&&!document.querySelector('#timeline-view-button').disabled);await attach(workspace);return interactions(workspace,'two Projects reopened');
  });
  const cid=await createProject(workspace,'Lifecycle C');await importConversation(workspace,cid,'C',1);
  await check('three independent Projects, third with one Q/A, default zoom and Reader',()=>interactions(workspace,'three Projects C'));
  await check('native A/B/C/A switches keep correct ownership without Fit',async()=>{for(const id of [aid,bid,cid,aid]){await nativeProject(workspace,id);await interactions(workspace,'three Projects '+id);}return {projectIds:[aid,bid,cid]};});
  if(process.argv.includes('--navigation-races'))await check('a newer native Project choice during a pending read is never discarded',async()=>{
    await workspace.evaluate(id=>{const t=lifecycle.timeline,api=t.api;lifecycle.originalAPI=api;lifecycle.releaseRapidRead=null;t.api=async(type,args)=>{const data=await api(type,args);if(type==='opcTimeline'&&args.projectId===id&&!lifecycle.releaseRapidRead)await new Promise(resolve=>lifecycle.releaseRapidRead=resolve);return data;};},bid);
    await chooseNativeProject(workspace,bid);await workspace.waitForFunction(()=>Boolean(lifecycle.releaseRapidRead));
    await chooseNativeProject(workspace,cid);await snapshot(workspace,'C chosen while B pending');await workspace.evaluate(()=>lifecycle.releaseRapidRead());
    const committed=await workspace.waitForFunction(id=>lifecycle.timeline.projectId===id&&document.querySelector('#project-select').value===id&&!document.querySelector('#timeline-view-button').disabled,cid,{timeout:2500}).then(()=>true,()=>false);
    const final=await snapshot(workspace,'latest native selection settled');report.rapidEvidence={requested:cid,selected:final.selectedProject,active:final.activeProject,rendered:final.renderedProject};
    await workspace.evaluate(()=>{lifecycle.timeline.api=lifecycle.originalAPI;});assert(committed,'the newer Project selection was dropped while busy');return interactions(workspace,'latest C after pending B');
  });
  if(process.argv.includes('--navigation-races'))await check('a failed native Project selection restores selector, title and active scope together',async()=>{
    await nativeProject(workspace,aid);
    await workspace.evaluate(id=>{const t=lifecycle.timeline,api=t.api;lifecycle.originalAPI=api;t.api=(type,args)=>type==='opcTimeline'&&args.projectId===id?Promise.reject(Error('Synthetic page project read failure')):api(type,args);},bid);
    await chooseNativeProject(workspace,bid);await workspace.waitForFunction(()=>!document.querySelector('#timeline-view-button').disabled&&document.querySelector('#notice.error'));
    const after=await snapshot(workspace,'failed native B selection settled');await workspace.evaluate(()=>{lifecycle.timeline.api=lifecycle.originalAPI;});
    assert.equal(after.activeProject,aid);assert.equal(after.selectedProject,aid,'failed B selection left selector/active Project inconsistent');return interactions(workspace,'A after native B failure');
  });
  await check('delete synthetic B, then A/C continue working and A source data survives',async()=>{
    const before=await rpc(workspace,'backup',{projectId:aid});await nativeProject(workspace,bid);
    if(!await workspace.locator('#delete-project').isVisible()){if(!await workspace.locator('#project-select').isVisible())await workspace.locator('#library-toggle').click();await workspace.locator('.library-actions>summary').click();}
    await workspace.locator('#delete-project').click();await workspace.locator('#edit-dialog input[name=confirmName]').fill('Lifecycle B');await workspace.locator('#edit-dialog button[type=submit]').click();
    await workspace.waitForFunction(()=>![...document.querySelector('#project-select').options].some(o=>o.textContent.startsWith('Lifecycle B'))&&!document.querySelector('#timeline-view-button').disabled);
    for(const id of [aid,cid]){await nativeProject(workspace,id);await interactions(workspace,'after deleting B '+id);}
    const after=await rpc(workspace,'backup',{projectId:aid});assert.deepEqual(after.records,before.records);
  });
  await check('browser process restart preserves independent Projects and their working controls',async()=>{
    await context.close();const reopenedOrigin=await launch();assert.equal(reopenedOrigin,origin);
    workspace=await context.newPage();workspace.setDefaultTimeout(7000);await workspace.setViewportSize({width,height:1000});await workspace.goto(origin+'/workspace.html');
    await workspace.waitForFunction(()=>!document.querySelector('#timeline-view-button').disabled&&document.querySelector('.ht-point'));await attach(workspace);
    for(const id of [aid,cid]){await nativeProject(workspace,id);await interactions(workspace,'browser restarted '+id);}
  });
  assert.deepEqual(report.errors,[],'unexpected browser errors');report.ok=true;
}catch(error){report.ok=false;report.error=error.stack;if(workspace&&!workspace.isClosed()){await snapshot(workspace,'failure').catch(()=>{});await workspace.screenshot({path:'dist/PROJECT_LIFECYCLE_FAILURE.png'}).catch(()=>{});}}
finally{await context?.close();report.finishedAt=new Date().toISOString();const output=process.argv.find(v=>v.startsWith('--report='))?.slice(9)??'dist/PROJECT_LIFECYCLE_DIAGNOSTIC.json';fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({output,ok:report.ok,checks:report.checks,error:report.error},null,2));}
process.exitCode=report.ok?0:1;
