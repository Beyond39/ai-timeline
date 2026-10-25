import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire(process.execPath)('../node_modules/playwright');
const server=spawn(process.execPath,['scripts/serve-validation.mjs','8959'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
const report={checks:[],errors:[],scope:'Real headless Chromium, isolated IndexedDB synthetic fixture; shared workbench presentation, not a live ChatGPT account.'};
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.OPC_TEST_BROWSER??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));page.setDefaultTimeout(8000);
 const check=async(name,fn)=>{await fn();report.checks.push({name,passed:true});console.log('PASS '+name);};
 await page.goto('http://127.0.0.1:8959/validation/interaction-browser.html?validationDb=v04-interaction-design-'+Date.now());await page.waitForFunction(()=>globalThis.interactionTest);await page.evaluate(()=>interactionTest.seed());
 await page.evaluate(()=>document.body.dataset.mode='workspace');
 await check('Desktop reader is docked without covering the timeline; selected node is accessible',async()=>{
  await page.locator('.ht-point').first().click();await page.locator('.opc-reading-body').waitFor();
  await page.waitForFunction(()=>{const s=document.querySelector('.ht-scroll').getBoundingClientRect(),d=document.querySelector('.opc-detail').getBoundingClientRect();return s.right<=d.left&&s.width>300;});
  assert.equal(await page.locator('.ht-point.selected').getAttribute('aria-pressed'),'true');
  await page.screenshot({path:'dist/WORKBENCH_REDESIGN_DESKTOP.png'});
 });
 await check('Long code scrolls inside the reader and close chrome stays visible',async()=>{
  await page.evaluate(()=>{const pre=document.querySelector('.opc-reading-body pre');pre.textContent='const longLine = '+ 'very_long_identifier.'.repeat(100);});
  const pre=page.locator('.opc-reading-body pre').first();assert(await pre.evaluate(e=>e.scrollWidth>e.clientWidth));
  await page.locator('.opc-detail-content').evaluate(e=>e.scrollTop=e.scrollHeight);
  const close=page.locator('.close-detail');await close.click();await page.locator('.opc-detail').waitFor({state:'hidden'});
  assert.equal(await page.locator('.ht-point[aria-pressed=true]').count(),0);
 });
 await check('Visible node labels do not overlap within each lane',async()=>{
  await page.getByRole('button',{name:'时间放大',exact:true}).click();
  const labels=await page.locator('.ht-point-label').evaluateAll(rows=>rows.map(e=>{const r=e.getBoundingClientRect();return {lane:e.closest('button').dataset.conversationId,left:r.left,right:r.right};}));assert(labels.length>0);
  for(const lane of new Set(labels.map(l=>l.lane))){const rows=labels.filter(l=>l.lane===lane).sort((a,b)=>a.left-b.left);for(let i=1;i<rows.length;i++)assert(rows[i-1].right<=rows[i].left);}
 });
 await check('390/768/1024 widths contain the workbench and keep reader close reachable',async()=>{
  for(const width of [390,768,1024]){
   await page.setViewportSize({width,height:850});await page.getByRole('button',{name:'适配全部',exact:true}).click();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow at '+width);
   await page.locator('.ht-point').first().click();await page.locator('.opc-reading-body').waitFor();
   const box=await page.locator('.close-detail').boundingBox();assert(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=850);
   if(width===390)await page.screenshot({path:'dist/WORKBENCH_REDESIGN_NARROW.png'});
   await page.keyboard.press('Escape');await page.locator('.opc-detail').waitFor({state:'hidden'});
  }
 });
 await check('Read failure shows an actionable retry that restores the full reader',async()=>{
  await page.evaluate(()=>{const t=interactionTest.timeline,api=t.api;let fail=true;t.api=async(type,args)=>{if(type==='opcDetail'&&fail){fail=false;throw Error('Synthetic read failure');}return api(type,args);};});
  await page.locator('.ht-point').first().click();await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'重试读取'}).click();await page.locator('.opc-reading-body').waitFor();await page.locator('.close-detail').click();
 });
 report.ok=!report.errors.length;
}catch(e){report.ok=false;report.error=e.stack;console.error(e);}
finally{await browser?.close();server.kill();fs.writeFileSync('dist/WORKBENCH_REDESIGN_REPORT.json',JSON.stringify(report,null,2));}
process.exitCode=report.ok?0:1;

