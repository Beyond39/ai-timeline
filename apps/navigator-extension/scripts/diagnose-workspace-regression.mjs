// Read a dedicated test profile only. Reports contain geometry and identities,
// never Q/A text. A copied OPC store must not be pointed at a live profile.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(process.execPath)('../node_modules/playwright');
const option=(name,fallback)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
const profile=path.resolve(option('profile','dist/regression-opc-copy'));
assert(profile.startsWith(path.resolve('dist')+path.sep),'Only isolated dist profiles are allowed');
assert(!fs.existsSync(path.join(profile,'SingletonLock')),'Profile must not be running');
const extension=path.resolve(option('extension','.'));
const report={profile,extension,startedAt:new Date().toISOString(),checks:[],observations:[],errors:[],files:Object.fromEntries(['ui/app.js','ui/opc.js','ui/horizontal-timeline.js','ui/workbench.css'].map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(extension,f))).digest('hex')]))};
let context,page;
async function attach(){
  const cdp=await context.newCDPSession(page);
  const {result:p}=await cdp.send('Runtime.evaluate',{expression:'import("./ui/opc.js").then(m=>m.OPCTimeline.prototype)',awaitPromise:true});
  const {objects}=await cdp.send('Runtime.queryObjects',{prototypeObjectId:p.objectId});
  await cdp.send('Runtime.callFunctionOn',{objectId:objects.objectId,functionDeclaration:'function(){window.regression={timeline:this.find(t=>t.host?.isConnected),calls:[],events:[],errors:[]};}',returnByValue:true});
  await cdp.detach();
  await page.evaluate(()=>{
    const t=regression.timeline;
    for(const [obj,methods] of [[t,['load','show','render','openCard']],[t.horizontal,['zoom','render']]])for(const key of methods){const original=obj[key];obj[key]=function(...args){regression.calls.push({method:key,time:performance.now(),projectId:t.projectId});return original.apply(this,args);};}
    const onError=t.onError;t.onError=m=>{regression.errors.push(m);onError?.(m);};
    for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,e=>regression.events.push({type,target:e.target.closest('button')?.getAttribute('aria-label')??e.target.tagName}),true);
  });
}
async function snapshot(label){const s=await page.evaluate(()=>{
  const t=regression.timeline,h=t.horizontal,b=document.querySelector('[aria-label="时间放大"]'),r=b?.getBoundingClientRect(),hit=r&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
  return {projectId:t.projectId,renderedProject:h.projectId,scale:h.layout?.pxPerMs,span:h.layout?.visibleSpan,preferenceSpan:h.preferences?.axisSpanMs,axisFit:h.preferences?.axisFit,selected:document.querySelector('#project-select')?.value,width:h.scroll?.clientWidth,nodes:document.querySelectorAll('.ht-point').length,zoom:{disabled:b?.disabled,box:r&&{x:r.x,y:r.y,width:r.width,height:r.height},hit:hit?.className,hitsButton:b===hit||b?.contains(hit)},dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),busy:document.querySelector('#timeline-view-button')?.disabled,errors:regression.errors,calls:regression.calls.slice(-20),events:regression.events.slice(-20),coordinates:[...document.querySelectorAll('.ht-point')].slice(0,3).map(n=>({id:n.dataset.cardId,x:parseFloat(n.style.left)}))};
});report.observations.push({label,...s});return s;}
async function click(label){const b=await page.getByRole('button',{name:label,exact:true}).boundingBox();assert(b,'Control missing');await page.mouse.click(b.x+b.width/2,b.y+b.height/2);await page.evaluate(()=>new Promise(requestAnimationFrame));}
async function check(name,run){try{await run();report.checks.push({name,passed:true});console.log('PASS '+name);}catch(e){report.checks.push({name,passed:false,error:e.message});console.log('FAIL '+name+': '+e.message);}}
try{
  context=await chromium.launchPersistentContext(profile,{executablePath:option('browser','C:/Users/CZGCw/AppData/Local/Google/Chrome/Application/chrome.exe'),headless:!process.argv.includes('--headed'),viewport:{width:Number(option('width','1440')),height:1000},ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
  report.browserVersion=context.browser().version();const cdp=await context.browser().newBrowserCDPSession();const loaded=await cdp.send('Extensions.loadUnpacked',{path:extension});await cdp.detach();
  report.extensionId=loaded.id;page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.setDefaultTimeout(5000);
  const query=option('query','');
  await page.goto('chrome-extension://'+loaded.id+'/workspace.html?'+query);
  await page.waitForFunction(()=>document.querySelector('.ht-controls')&&!document.querySelector('#timeline-view-button').disabled);
  await attach();await page.waitForTimeout(500);await snapshot('entry');
  await check('physical pointer reaches the visible zoom control and activates hover',async()=>{const b=page.getByRole('button',{name:'时间放大',exact:true}),r=await b.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);assert(await b.evaluate(e=>e.matches(':hover')),'visible + did not receive hover');const s=await snapshot('hover');assert(s.zoom.hitsButton,'another element covers +');});
  report.counts=await page.evaluate(async()=>{const s=await(await import('./storage/database.js')).readState();return Object.fromEntries(Object.entries(s).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length]));});
  await check('deep link + and − change scale without Fit or source selection',async()=>{const before=await snapshot('before +');await click('时间放大');const after=await snapshot('after +');await page.waitForTimeout(500);const settled=await snapshot('settled +');assert(after.scale>before.scale,'+ did not increase actual scale');assert.equal(settled.scale,after.scale,'scale was reset after +');await click('时间缩小');assert((await snapshot('after −')).scale<after.scale,'− did not decrease actual scale');});
  await check('visible Q/A opens Reader with loaded question and answer',async()=>{const point=page.locator('.ht-point').first();await point.scrollIntoViewIfNeeded();const id=await point.getAttribute('data-card-id'),b=await point.boundingBox();await page.mouse.click(b.x+b.width/2,b.y+b.height/2);await page.waitForFunction(id=>document.querySelector('.opc-detail')?.dataset.cardId===id&&document.querySelector('.opc-reading-body')?.textContent.length>0,id,{timeout:3000});await snapshot('Reader');await page.keyboard.press('Escape');});
  report.ok=report.checks.every(c=>c.passed)&&!report.errors.length;
}catch(e){report.ok=false;report.error=e.stack;if(page&&!page.isClosed())report.failure=await page.evaluate(()=>({notice:document.querySelector('#notice')?.textContent,controls:document.querySelectorAll('.ht-controls').length,readyState:document.readyState})).catch(()=>null);}
finally{await context?.close();report.finishedAt=new Date().toISOString();const output=option('report','dist/REGRESSION_DATA_COPY.json');fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({output,ok:report.ok,checks:report.checks,error:report.error,errors:report.errors},null,2));}
process.exitCode=report.ok?0:1;
