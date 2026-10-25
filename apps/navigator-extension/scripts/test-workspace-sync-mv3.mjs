// Real MV3 pages in a new profile. Instrumentation stays in this test, and logs
// identities, revisions and coordinates only, never conversation bodies.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { graph, user, body } from '../validation/qa-p0-fixtures.mjs';
import { chromium, browserExecutable as findBrowser } from './browser-runtime.mjs';
const diagnostic = process.argv.includes('--diagnostic');
const extension=path.resolve(process.env.OPC_TEST_EXTENSION??'.');
const profile = path.resolve('dist', 'workspace-sync-profile-' + Date.now());
const report = { diagnostic, checks: [], observations: [], errors: [], profile,
  scope: 'Isolated unpacked MV3; real workspace.html and sidepanel.html, synthetic data only.' };
report.extension=extension;
report.loadedFiles=Object.fromEntries(['ui/app.js','ui/opc.js','ui/horizontal-timeline.js'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(extension,file))).digest('hex')]));
fs.mkdirSync(profile, { recursive: true });
let context;
const rpc = (page, type, args = {}) => page.evaluate(async ({ type, args }) => {
  const result = await chrome.runtime.sendMessage({ type, args });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}, { type, args });
async function check(name, run) {
  try { const evidence = await run(); report.checks.push({ name, passed: true, evidence }); console.log('PASS ' + name); }
  catch (error) { report.checks.push({ name, passed: false, error: error.stack }); console.log('FAIL ' + name + ': ' + error.message); if (!diagnostic) throw error; }
}
async function instrument(page) {
  page.on('pageerror', e => report.errors.push(e.message));
  await page.evaluate(async () => {
    const { HorizontalTimeline } = await import('./ui/horizontal-timeline.js');
    window.probe = { calls: [], errors: [], events: [], notices: [] };
    for (const method of ['render', 'zoom', 'fit', 'save']) {
      const original = HorizontalTimeline.prototype[method];
      HorizontalTimeline.prototype[method] = function (...args) {
        probe.h = this;
        if (!this.owner.probed) {
          this.owner.probed = true;
          const onError = this.owner.onError;
          this.owner.onError = message => { probe.errors.push(message); onError?.(message); };
          const api = this.owner.api;
          this.owner.api = async (type, args) => {
            probe.calls.push({ type, action: args?.action, projectId: args?.projectId, revision: args?.expectedRevision });
            return api(type, args);
          };
        }
        probe.events.push({ method, entry: document.body.dataset.mode, projectId: this.projectId,
          before: this.layout?.pxPerMs, span: this.preferences?.axisSpanMs, revision: this.preferences?.revision });
        return original.apply(this, args);
      };
    }
    for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, e => {
      if (e.target.closest('.ht-controls,.ht-point')) probe.events.push({ type, label: e.target.closest('button')?.getAttribute('aria-label') });
    }, true);
    chrome.runtime.onMessage.addListener(m => { if (m.event) probe.notices.push({ event: m.event, action: m.action, projectId: m.projectId }); });
  });
  // Observe the already-rendered default state. Fit All used to hide broken
  // initial viewport/restore state before the first acceptance assertion.
  const cdp=await context.newCDPSession(page);
  const {result:prototype}=await cdp.send('Runtime.evaluate',{expression:'import("./ui/horizontal-timeline.js").then(m=>m.HorizontalTimeline.prototype)',awaitPromise:true});
  const {objects}=await cdp.send('Runtime.queryObjects',{prototypeObjectId:prototype.objectId});
  await cdp.send('Runtime.callFunctionOn',{objectId:objects.objectId,functionDeclaration:'function(){probe.h=this.find(h=>h.host?.isConnected&&h.layout);}',returnByValue:true});
  await cdp.send('Runtime.releaseObject',{objectId:prototype.objectId});await cdp.send('Runtime.releaseObject',{objectId:objects.objectId});await cdp.detach();
  await page.evaluate(() => probe.h.flush());
}
const state = page => page.evaluate(() => {
  const h = probe.h, b = document.querySelector('.ht-board'), s = document.querySelector('.ht-scroll');
  const nodes = [...document.querySelectorAll('.ht-point')];
  return { projectId: h.owner.projectId, scale: h.layout.pxPerMs, span: h.layout.visibleSpan,
    preferenceSpan: h.preferences.axisSpanMs, fit: h.preferences.axisFit, width: b.getBoundingClientRect().width,
    viewport: s.clientWidth, scrollLeft: s.scrollLeft, revision: h.preferences.revision,
    coordinates: nodes.slice(0, 3).map(n => ({ id: n.dataset.cardId, left: parseFloat(n.style.left) })),
    errors: probe.errors, calls: probe.calls, events: probe.events };
});
async function addConversation(page,projectId,label){
  const rows=[];let parent='root';
  for(let i=0;i<6;i++){const q=label+'-q'+i,a=label+'-a'+i;rows.push([q,parent,user(q,'Synthetic question '+label+' '+i,1790812800+i*86400)],[a,q,body(a,'Synthetic answer '+label+' '+i)]);parent=a;}
  const raw=graph(rows,parent,'sync-'+label);raw.title='Synthetic '+label;
  const draft=await rpc(page,'importPreview',{text:JSON.stringify(raw),filename:'synthetic-sync.json'});
  return rpc(page,'saveDraft',{draftId:draft.id,projectId});
}
async function createProject(page,name){
  if(!await page.locator('#new-project').isVisible())await page.locator('#library-toggle').click();
  await page.locator('#new-project').click();await page.locator('#edit-dialog input[name=name]').fill(name);
  await page.locator('#edit-dialog button[type=submit]').click();
  await page.waitForFunction(name=>document.querySelector('#map-title')?.textContent===name&&!document.querySelector('#timeline-view-button').disabled,name);
  // Close the small-screen navigation drawer before testing Timeline controls.
  if(await page.locator('#project-library .panel-close').isVisible())await page.locator('#project-library .panel-close').click();
  return page.locator('#project-select').inputValue();
}
async function switchTo(page,id){
  await page.locator('#project-select').selectOption(id,{force:true});
  await page.waitForFunction(id=>probe.h?.owner.projectId===id&&!document.querySelector('#timeline-view-button').disabled,id);
  await page.locator('.ht-point').first().waitFor();
}
async function digest(page){return page.evaluate(async editedCardId=>{
  const {readState}=await import('./storage/database.js');const data=await readState(),result={};
  for(const key of ['projects','conversations'])result[key]=data[key].map(r=>({id:r.id,projectId:r.projectId})).sort((a,b)=>a.id.localeCompare(b.id));
  for(const key of ['conversations','messages','versions','snapshots','paths','qas','segments','qaCards','qaMetadata','timelines','memberships','relationships','canvasLayouts','timelinePreferences']){
    const rows=data[key].filter(r=>key!=='qaMetadata'||r.cardId!==editedCardId).toSorted((a,b)=>a.id.localeCompare(b.id));
    result[key]={count:rows.length,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows))))].map(b=>b.toString(16).padStart(2,'0')).join('')};
  }return result;
},report.cardId);}
async function zoomRoundTrip(page){
  const revision=await page.evaluate(async()=>(await (await import('./storage/database.js')).readState()).revision);
  const start=await state(page),steps=[start];
  for(const label of ['时间放大','时间缩小'])for(let i=0;i<5;i++){
    const before=await state(page);await page.getByRole('button',{name:label,exact:true}).click();const after=await state(page);
    assert(label==='时间放大'?after.scale>before.scale:after.scale<before.scale);
    assert.notEqual(after.coordinates[1].left,before.coordinates[1].left);steps.push(after);
  }
  assert.equal((await state(page)).errors.length,0);
  assert.equal(await page.evaluate(async()=>(await (await import('./storage/database.js')).readState()).revision),revision,'zoom must not increment shared revision');
  assert(!steps.at(-1).calls.some(c=>c.type==='releaseWrite'&&c.action==='timelinePreferences'));
  return steps.map(s=>({projectId:s.projectId,scale:s.scale,span:s.span,width:s.width,x:s.coordinates[1].left}));
}
async function nodeCheck(page,projectId){
  await page.getByRole('button',{name:'时间放大',exact:true}).click();
  const point=page.locator('.ht-point').first();await point.scrollIntoViewIfNeeded();
  const id=await point.getAttribute('data-card-id'),conversationId=await point.getAttribute('data-conversation-id'),box=await point.boundingBox();
  const hit=await page.evaluate(({x,y})=>{const e=document.elementFromPoint(x,y);return {id:e.closest('[data-card-id]')?.dataset.cardId,pointerEvents:getComputedStyle(e).pointerEvents};},{x:box.x+box.width/2,y:box.y+box.height/2});
  assert.equal(hit.id,id);await point.click();await page.locator('.opc-reading-body').waitFor();
  assert.equal(await page.locator('.opc-detail').getAttribute('data-card-id'),id);
  const detail=await rpc(page,'opcDetail',{projectId,cardId:id});assert.equal(detail.card.conversationId,conversationId);assert.equal(detail.card.projectId,projectId);
  await page.locator('.opc-detail .panel-close').click();return {id,conversationId,projectId,hit};
}
try {
  context = await chromium.launchPersistentContext(profile, { headless: true,
    executablePath: findBrowser(),
    viewport: { width: 1440, height: 1000 }, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--remote-debugging-port=0',...(process.argv.includes('--cdp-load')?['--enable-unsafe-extension-debugging']:['--disable-extensions-except='+extension,'--load-extension='+extension])] });
  report.browserVersion = context.browser()?.version();
  if(process.argv.includes('--cdp-load')){const load=await context.browser().newBrowserCDPSession();report.loaded=await load.send('Extensions.loadUnpacked',{path:extension});await load.detach();}
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const origin = 'chrome-extension://' + new URL(worker.url()).host;
  const workspace = await context.newPage();
  await workspace.goto(origin + '/workspace.html');await workspace.waitForFunction(()=>!document.querySelector('#timeline-view-button').disabled);
  const aid=await createProject(workspace,'Synthetic A');await addConversation(workspace,aid,'A1');
  const seed={projectIds:[aid]};
  await workspace.goto(origin+'/workspace.html?projectId='+aid);
  await workspace.locator('.ht-point').first().waitFor(); await instrument(workspace);
  const cdp=await context.newCDPSession(workspace);
  const nativeOpen=await cdp.send('Runtime.evaluate',{expression:'chrome.windows.getCurrent().then(w=>chrome.sidePanel.open({windowId:w.id}))',userGesture:true,awaitPromise:true,returnByValue:true});
  report.nativeSidePanel={openException:nativeOpen.exceptionDetails?.text,result:nativeOpen.result?.value};
  const targets=await cdp.send('Target.getTargets');report.nativeSidePanel.targets=targets.targetInfos.map(t=>({type:t.type,url:t.url}));await cdp.detach();
  let panel=context.pages().find(p=>p.url().includes('/sidepanel.html'));
  if(!panel){
    const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];
    const attached=await chromium.connectOverCDP('http://127.0.0.1:'+port);
    report.nativeSidePanel.attachedPages=attached.contexts().flatMap(c=>c.pages().map(p=>p.url()));
    panel=attached.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/sidepanel.html'));
  }
  report.nativeSidePanel.playwrightPage=Boolean(panel);
  assert(panel,'An actual native Side Panel target is required; a tab is not counted as Side Panel acceptance');
  await panel.setViewportSize({ width: 420, height: 900 });
  await panel.goto(origin + '/sidepanel.html?projectId=' + seed.projectIds[0]);
  await panel.locator('.ht-point').first().waitFor(); await instrument(panel);
  await check('Workspace + changes scale and rendered coordinates on every one of five clicks', async () => {
    const steps = [await state(workspace)];
    for (let i = 0; i < 5; i++) {
      await workspace.getByRole('button', { name: '时间放大', exact: true }).click();
      await workspace.evaluate(() => probe.h.flush());
      steps.push(await state(workspace));
    }
    report.observations.push({ name: 'workspace-five-plus', steps });
    for (let i = 1; i < steps.length; i++) {
      assert(steps[i].scale > steps[i - 1].scale);
      assert(steps[i].coordinates[1].left > steps[i - 1].coordinates[1].left);
    }
    assert.equal(steps.at(-1).errors.length, 0, 'view-only zoom must not conflict');
    return steps.map(s => ({ scale: s.scale, span: s.span, width: s.width }));
  });
  await check('Same-project data refresh preserves Workspace local zoom', async () => {
    const before = await state(workspace);
    await rpc(panel, 'renameProject', { projectId: seed.projectIds[0], name: 'Synthetic updated project' });
    await workspace.waitForFunction(() => document.querySelector('#map-title').textContent === 'Synthetic updated project' && !document.querySelector('#timeline-view-button').disabled);
    const after = await state(workspace); report.observations.push({ name: 'zoom-after-refresh', before, after });
    assert.equal(after.span, before.span); return { before: before.span, after: after.span };
  });
  await check('Changes received during an open dialog are applied after it closes', async () => {
    await workspace.getByRole('button', { name: '选择来源', exact: true }).click();
    await rpc(panel, 'renameProject', { projectId: seed.projectIds[0], name: 'Synthetic changed during dialog' });
    await workspace.getByRole('button', { name: '取消', exact: true }).click();
    await workspace.waitForFunction(() => document.querySelector('#map-title').textContent === 'Synthetic changed during dialog', null, { timeout: 3000 });
  });
  if(!diagnostic){
    await check('A: one Project / one Conversation, Workspace five + and five −',()=>zoomRoundTrip(workspace));
    await check('A: one Project / one Conversation, native Side Panel five + and five −',()=>zoomRoundTrip(panel));
    for(const [page,label]of [[workspace,'Workspace'],[panel,'Side Panel']]){
      await check(label+' correct Q/A ownership and hit test after zoom',()=>nodeCheck(page,aid));
      await check(label+' Fit All and Locate Latest use actual rendered geometry',async()=>{
        await page.getByRole('button',{name:'适配全部',exact:true}).click();const fit=await state(page);assert(fit.fit);
        await page.getByRole('button',{name:'时间放大',exact:true}).click();await page.getByRole('button',{name:'定位最新',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('.opc-detail')?.dataset.cardId===probe.h.layout.latest.id&&!document.querySelector('.opc-detail').hidden);
        const after=await state(page);assert(after.scrollLeft>0);await page.locator('.opc-detail .panel-close').click();return {fit:fit.span,located:after.scrollLeft};
      });
    }
    await check('Existing Conversation management writes complete while its dialog remains open',async()=>{
      await workspace.locator('.opc-actions-menu>summary').click();
      await workspace.getByRole('button',{name:'对话管理',exact:true}).click();
      await workspace.getByRole('button',{name:'收藏对话 Synthetic A1',exact:true}).click();
      await workspace.getByRole('button',{name:'取消收藏对话 Synthetic A1',exact:true}).waitFor();
      await workspace.locator('#track-dialog .panel-close').click();
      const library=await rpc(panel,'conversationLibrary',{projectId:aid});assert(library.conversations[0].favorite);
    });
    await check('Updates received while refresh is busy are drained after it completes',async()=>{
      await workspace.evaluate(()=>{const t=probe.h.owner,api=t.api;probe.originalAPI=api;probe.releaseBusyRead=null;t.api=async(type,args)=>{const data=await api(type,args);if(type==='opcTimeline'&&!probe.releaseBusyRead)await new Promise(resolve=>probe.releaseBusyRead=resolve);return data;};});
      await rpc(panel,'renameProject',{projectId:aid,name:'Synthetic busy first'});
      await workspace.waitForFunction(()=>Boolean(probe.releaseBusyRead));
      await rpc(panel,'renameProject',{projectId:aid,name:'Synthetic busy latest'});
      await workspace.evaluate(()=>probe.releaseBusyRead());
      await workspace.waitForFunction(()=>document.querySelector('#map-title').textContent==='Synthetic busy latest'&&!document.querySelector('#timeline-view-button').disabled);
      await workspace.evaluate(()=>{probe.h.owner.api=probe.originalAPI;});
    });
    await check('C: second Conversation appears in both views, each zoom remains local',async()=>{
      const spans=await Promise.all([state(workspace),state(panel)]);await addConversation(workspace,aid,'A2');
      for(const page of [workspace,panel])await page.waitForFunction(()=>probe.h.layout.lanes.length===2&&!document.querySelector('#timeline-view-button').disabled);
      assert.equal((await state(workspace)).span,spans[0].span);assert.equal((await state(panel)).span,spans[1].span);
      await zoomRoundTrip(workspace);await zoomRoundTrip(panel);
    });
    let bid;
    await check('B: create second independent Project while Workspace + is pressed',async()=>{
      const button=workspace.getByRole('button',{name:'时间放大',exact:true}),handle=await button.elementHandle(),box=await button.boundingBox(),before=await state(workspace);
      await workspace.mouse.move(box.x+box.width/2,box.y+box.height/2);await workspace.mouse.down();
      bid=await createProject(panel,'Synthetic B');seed.projectIds.push(bid);
      assert(await handle.evaluate(e=>e.isConnected));await workspace.mouse.up();assert((await state(workspace)).scale>before.scale);
      await addConversation(panel,bid,'B1');await panel.locator('.ht-point').first().waitFor();
      await workspace.waitForFunction(id=>[...document.querySelector('#project-select').options].some(o=>o.value===id),bid);
      await zoomRoundTrip(panel);await nodeCheck(panel,bid);
    });
    report.cardId=await workspace.locator('.ht-point').first().getAttribute('data-card-id');
    const protectedCards=(await rpc(workspace,'opcTimeline',{projectId:aid})).cards;
    for(const c of protectedCards.slice(0,2))await rpc(workspace,'opcWrite',{projectId:aid,action:'metadata',cardId:c.id,notes:'Synthetic protected note',tags:['protected'],expectedRevision:c.metadata.revision});
    await rpc(workspace,'opcWrite',{projectId:aid,action:'relationship',fromCardId:protectedCards[0].id,toCardId:protectedCards[1].id,type:'补充',directed:true,description:'Synthetic preserved relation'});
    await rpc(workspace,'opcWrite',{projectId:aid,action:'layout',positions:Object.fromEntries(protectedCards.map((c,i)=>[c.id,{x:i*100,y:0}])),viewport:{x:20,y:20,zoom:1}});
    await workspace.waitForFunction(()=>!document.querySelector('#timeline-view-button').disabled);
    report.dataBefore=await digest(workspace);
    await check('B/E: repeated A/B switches restore each local viewport and correct Q/A',async()=>{
      for(const page of [workspace,panel])for(const id of [bid,aid,bid,aid]){await switchTo(page,id);await zoomRoundTrip(page);await nodeCheck(page,id);}
    });
    await check('D: same-project metadata edit in Side Panel updates Workspace Reader',async()=>{
      const cardId=report.cardId;
      await panel.locator(`.ht-point[data-card-id="${cardId}"]`).scrollIntoViewIfNeeded();await panel.locator(`.ht-point[data-card-id="${cardId}"]`).click();await panel.locator('.opc-reading-body').waitFor();
      await panel.getByRole('textbox',{name:'卡片标题',exact:true}).fill('Synthetic panel edit');await panel.locator('.opc-annotation').getByRole('button',{name:'保存标注',exact:true}).click();
      await workspace.waitForFunction(()=>probe.h.data.cards.some(c=>c.metadata.title==='Synthetic panel edit'));
      await panel.locator('.opc-detail .panel-close').click();
      await workspace.locator(`.ht-point[data-card-id="${cardId}"]`).scrollIntoViewIfNeeded();await workspace.locator(`.ht-point[data-card-id="${cardId}"]`).click();
      await workspace.waitForFunction(()=>document.querySelector('.opc-annotation [aria-label="卡片标题"]')?.value==='Synthetic panel edit');
    });
    await check('D: Workspace edit updates Side Panel, independent simultaneous zoom does not write',async()=>{
      await workspace.getByRole('textbox',{name:'卡片标题',exact:true}).fill('Synthetic workspace edit');await workspace.locator('.opc-annotation').getByRole('button',{name:'保存标注',exact:true}).click();
      await panel.waitForFunction(()=>probe.h.data.cards.some(c=>c.metadata.title==='Synthetic workspace edit'));
      await workspace.locator('.opc-detail .panel-close').click();const panelSpan=(await state(panel)).span;
      await workspace.getByRole('button',{name:'时间放大',exact:true}).click();assert.equal((await state(panel)).span,panelSpan);
      const workspaceSpan=(await state(workspace)).span;await panel.getByRole('button',{name:'时间缩小',exact:true}).click();assert.equal((await state(workspace)).span,workspaceSpan);
    });
    await check('D: real concurrent metadata writes reject one stale edit without overwrite',async()=>{
      const cardId=report.cardId,before=await rpc(workspace,'opcDetail',{projectId:aid,cardId}),revision=before.metadata.revision;
      const results=await Promise.allSettled([rpc(workspace,'opcWrite',{projectId:aid,action:'metadata',cardId,title:'Synthetic race A',expectedRevision:revision}),rpc(panel,'opcWrite',{projectId:aid,action:'metadata',cardId,title:'Synthetic race B',expectedRevision:revision})]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected');assert.match(rejected.reason.message,/另一窗口|其他页面/);
      const after=await rpc(workspace,'opcDetail',{projectId:aid,cardId});assert.equal(after.metadata.revision,revision+1);assert.equal(after.metadata.title,results.find(r=>r.status==='fulfilled').value.title);
      for(const page of [workspace,panel])await page.waitForFunction(title=>probe.h.data.cards.some(c=>c.metadata.title===title)&&!document.querySelector('#timeline-view-button').disabled,after.metadata.title);
      return {accepted:1,rejected:1,revision:after.metadata.revision};
    });
    await check('D: same-project data save while + / − / Q/A is pressed preserves native clicks',async()=>{
      for(const selector of ['[aria-label="时间放大"]','[aria-label="时间缩小"]','.ht-point']){
        const target=workspace.locator(selector).first();await target.scrollIntoViewIfNeeded();const handle=await target.elementHandle(),box=await target.boundingBox(),before=await state(workspace),id=await target.getAttribute('data-card-id');
        await workspace.mouse.move(box.x+box.width/2,box.y+box.height/2);await workspace.mouse.down();
        await rpc(panel,'renameProject',{projectId:aid,name:'Synthetic pointer '+selector});
        assert(await handle.evaluate(e=>e.isConnected));await workspace.mouse.up();
        await workspace.waitForFunction(name=>document.querySelector('#map-title').textContent===name&&!document.querySelector('#timeline-view-button').disabled,'Synthetic pointer '+selector);
        if(id){await workspace.waitForFunction(id=>document.querySelector('.opc-detail')?.dataset.cardId===id&&!document.querySelector('.opc-detail').hidden,id);await workspace.locator('.opc-detail .panel-close').click();}
        else assert(selector.includes('放大')?(await state(workspace)).scale>before.scale:(await state(workspace)).scale<before.scale);
      }
    });
    await check('Late Timeline read cannot reset zoom made after request began',async()=>{
      await workspace.evaluate(()=>{const t=probe.h.owner,api=t.api;t.api=async(type,args)=>{const data=await api(type,args);if(type==='opcTimeline')await new Promise(resolve=>probe.releaseRead=resolve);return data;};probe.originalAPI=api;probe.loading=t.load();});
      await workspace.waitForFunction(()=>Boolean(probe.releaseRead));await workspace.getByRole('button',{name:'时间放大',exact:true}).click();const before=await state(workspace);
      await workspace.evaluate(async()=>{probe.releaseRead();await probe.loading;probe.h.owner.api=probe.originalAPI;});assert.equal((await state(workspace)).span,before.span);
    });
    await check('A read already in flight cannot detach a pressed Workspace +',async()=>{
      await workspace.evaluate(()=>{const t=probe.h.owner,api=t.api;t.api=async(type,args)=>{const data=await api(type,args);if(type==='opcTimeline')await new Promise(resolve=>probe.releaseRead=resolve);return data;};probe.originalAPI=api;probe.releaseRead=null;probe.loading=t.load();});
      await workspace.waitForFunction(()=>Boolean(probe.releaseRead));
      const target=workspace.getByRole('button',{name:'时间放大',exact:true}),handle=await target.elementHandle(),box=await target.boundingBox(),before=await state(workspace);
      await workspace.mouse.move(box.x+box.width/2,box.y+box.height/2);await workspace.mouse.down();
      await workspace.evaluate(()=>{probe.releaseRead();});
      await workspace.evaluate(()=>new Promise(requestAnimationFrame));
      assert(await handle.evaluate(e=>e.isConnected),'in-flight refresh removed pressed control');await workspace.mouse.up();
      await workspace.evaluate(async()=>{await probe.loading;probe.h.owner.api=probe.originalAPI;});assert((await state(workspace)).scale>before.scale);
    });
    await check('E: different Projects edit and zoom independently',async()=>{
      await switchTo(panel,bid);const before=await state(workspace);await rpc(panel,'renameProject',{projectId:bid,name:'Synthetic independent B'});
      await panel.waitForFunction(()=>document.querySelector('#map-title').textContent==='Synthetic independent B'&&!document.querySelector('#timeline-view-button').disabled);
      assert.equal((await state(workspace)).projectId,aid);assert.equal((await state(workspace)).span,before.span);await nodeCheck(panel,bid);await nodeCheck(workspace,aid);
    });
    await check('Late response from a previous Project cannot overwrite the active Project',async()=>{
      await workspace.evaluate(()=>{const t=probe.h.owner,api=t.api;probe.originalAPI=api;probe.releaseOldRead=null;t.api=async(type,args)=>{const data=await api(type,args);if(type==='opcTimeline'&&args.projectId===t.projectId&&!probe.releaseOldRead)await new Promise(resolve=>probe.releaseOldRead=resolve);return data;};probe.oldRead=t.load();});
      await workspace.waitForFunction(()=>Boolean(probe.releaseOldRead));
      await workspace.evaluate(async id=>{probe.h.owner.api=probe.originalAPI;await probe.h.owner.show({projectId:id});},bid);
      await workspace.evaluate(async()=>{probe.releaseOldRead();await probe.oldRead;});assert.equal((await state(workspace)).projectId,bid);await nodeCheck(workspace,bid);
      await workspace.evaluate(id=>probe.h.owner.show({projectId:id}),aid);
    });
    if(process.argv.includes('--knowledge'))await check('Native docked Side Panel runs real BGE Hybrid and returns to unchanged zoom/click interactions',async()=>{
      await panel.locator('#topics-view-button').click();
      await panel.locator('input[aria-label="导入离线 BGE 模型"]').setInputFiles(path.resolve('dist/knowledge-deps/model-verified.onnx'));
      await panel.waitForFunction(()=>document.querySelector('.knowledge-dialog [role=status]')?.textContent.includes('离线权重已验证'));
      await panel.getByRole('button',{name:'开启语义增强',exact:true}).click();await panel.getByRole('button',{name:'开启并整理',exact:true}).click();
      await panel.waitForFunction(()=>!probe.h.owner.knowledge.busy&&probe.h.owner.knowledge.run?.status==='Hybrid',null,{timeout:120000});
      const evidence=await panel.evaluate(()=>({entry:document.body.dataset.mode,mode:probe.h.owner.knowledge.run.mode,embedding:probe.h.owner.knowledge.run.embeddingStats}));
      await panel.locator('.knowledge-dialog .panel-close').click();await zoomRoundTrip(panel);await nodeCheck(panel,bid);return evidence;
    });
    report.dataAfter=await digest(workspace);
    await check('Source identities, Q/A, original text, versions, relations, Canvas and stored viewport hashes unchanged',async()=>assert.deepEqual(report.dataAfter,report.dataBefore));
    await workspace.screenshot({path:'dist/WORKSPACE_SYNC_WORKSPACE.png'});await panel.screenshot({path:'dist/WORKSPACE_SYNC_SIDEPANEL.png'});
    report.uiErrors=await Promise.all([workspace.evaluate(()=>probe.errors),panel.evaluate(()=>probe.errors)]);assert(report.uiErrors.every(errors=>!errors.length));
  }
  report.ok = report.checks.every(c => c.passed) && !report.errors.length;
} catch (error) { report.error = error.stack; report.ok = false; }
finally {
  await context?.close();
  const output = process.argv.find(a => a.startsWith('--report='))?.slice(9) ?? 'dist/WORKSPACE_SYNC_MV3_REPORT.json';
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, ok: report.ok, checks: report.checks.map(c => ({ name: c.name, passed: c.passed })), error: report.error }, null, 2));
}
process.exitCode = report.ok ? 0 : 1;
