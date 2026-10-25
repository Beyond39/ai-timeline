import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { knowledgeFixtures } from '../validation/knowledge-fixtures.mjs';
const {chromium}=createRequire(process.execPath)('../node_modules/playwright');
const profile=path.resolve('dist/knowledge-bge-import-profile'),report={scope:'Real Chrome MV3 Worker benchmark, synthetic corpus, verified imported weights; excludes online download time',rows:[]};let context;
try {
 context=await chromium.launchPersistentContext(profile,{executablePath:'C:/Users/CZGCw/AppData/Local/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
 const cdp=await context.browser().newBrowserCDPSession(),loaded=await cdp.send('Extensions.loadUnpacked',{path:path.resolve('.')});await cdp.detach();report.browser=context.browser().version();
 const page=await context.newPage();await page.goto('chrome-extension://'+loaded.id+'/workspace.html');
 for(const count of [100,300,1000]) {
  const result=await page.evaluate(async documents=>{
   const run=mode=>new Promise((resolve,reject)=>{const worker=new Worker(new URL('./analysis/knowledge-worker.js',location.href),{type:'module'});worker.onmessage=({data})=>{if(data.progress)return;worker.terminate();data.error?reject(Error(data.error)):resolve(data.result);};worker.onerror=e=>{worker.terminate();reject(Error(e.message));};worker.postMessage({action:'analyze',mode,documents});});
   const rows={};for(const mode of ['Lexical','Semantic','Hybrid']){const result=await run(mode);rows[mode]={status:result.status,mode:result.mode,stats:result.stats,embedding:result.embeddingStats,topics:result.topics.length,unclassified:result.unclassifiedCardIds.length};}
   return rows;
  },knowledgeFixtures(count));
  assert.equal(result.Semantic.status,'Semantic');assert.equal(result.Hybrid.status,'Hybrid');assert.equal(result.Hybrid.embedding.hits,count);report.rows.push({count,...result});console.log(JSON.stringify({count,...result}));
 }
 report.ok=true;
}catch(e){report.error=e.stack;report.ok=false;}finally{await context?.close();fs.writeFileSync('dist/KNOWLEDGE_BGE_PERFORMANCE.json',JSON.stringify(report,null,2));}
process.exitCode=report.ok?0:1;
