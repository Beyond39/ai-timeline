import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const {chromium}=createRequire(process.execPath)('../node_modules/playwright');
const offlineFile=process.argv.find(a=>a.startsWith('--offline-file='))?.slice(15);
const profile=path.resolve(offlineFile?'dist/knowledge-bge-import-profile':'dist/knowledge-bge-profile');fs.mkdirSync(profile,{recursive:true});
const report={scope:'Real Chrome MV3 Worker, synthetic input only',errors:[],checks:[]};let context,progressTimer;
try {
  context=await chromium.launchPersistentContext(profile,{executablePath:'C:/Users/CZGCw/AppData/Local/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
  const cdp=await context.browser().newBrowserCDPSession(),loaded=await cdp.send('Extensions.loadUnpacked',{path:path.resolve('.')});await cdp.detach();
  report.browser=context.browser().version();const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  page.on('requestfailed',r=>console.log('Model resource failure: '+new URL(r.url()).pathname+' '+r.failure()?.errorText));
  await page.goto('chrome-extension://'+loaded.id+'/workspace.html');
  if(offlineFile){await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='model-import-probe';document.body.append(input);});await page.locator('#model-import-probe').setInputFiles(path.resolve(offlineFile));report.offlineImport=await page.evaluate(async()=>{const {importModelFile}=await import('./analysis/bge.js');return importModelFile(document.querySelector('#model-import-probe').files[0]);});}
  let previous='';progressTimer=setInterval(()=>page.evaluate(()=>globalThis.bgeProgress).then(p=>{const message=JSON.stringify(p);if(message!==previous){console.log('PROGRESS '+message);previous=message;}}).catch(()=>{}),10000);
  report.result=await page.evaluate(async()=>{
    const documents=['IndexedDB 事务如何保持数据一致性？','浏览器数据库写入怎样保证原子性？','蛋糕烘焙需要多少面粉？'].map((question,i)=>({cardId:'synthetic-bge-'+i,question}));
    const run=()=>new Promise((resolve,reject)=>{const w=new Worker(new URL('./analysis/knowledge-worker.js',location.href),{type:'module'});const timer=setTimeout(()=>{w.terminate();reject(Error('真实模型推理超时'));},480000);w.onmessage=({data})=>{if(data.progress){globalThis.bgeProgress=data.progress;return;}clearTimeout(timer);w.terminate();if(data.error)reject(Error(data.error));else resolve(data.result);};w.onerror=e=>{clearTimeout(timer);w.terminate();reject(Error(e.message));};w.postMessage({documents});});
    const a=await run(),b=await run();const vs=Object.values(a.vectors),dot=(x,y)=>x.reduce((s,v,i)=>s+v*y[i],0);
    const {analyzeKnowledge}=await import('./analysis/knowledge-analysis.js');
    const modes=Object.fromEntries(['Lexical','Semantic','Hybrid'].map(mode=>{const result=analyzeKnowledge(documents,{mode,embeddings:a.vectors});return [mode,{mode:result.mode,topics:result.topics.map(t=>t.name),related:result.cards[documents[0].cardId].related}];}));
    return {config:a.config,first:a.stats,second:b.stats,modes,dimensions:vs.map(v=>v.length),norms:vs.map(v=>Math.sqrt(dot(v,v))),similarity:{related:dot(vs[0],vs[1]),unrelated:dot(vs[0],vs[2])},stable:JSON.stringify(a.vectors)===JSON.stringify(b.vectors)};
  });
  assert(report.result.dimensions.every(d=>d===512));assert(report.result.norms.every(n=>Math.abs(n-1)<.005));assert(report.result.stable);assert.equal(report.result.second.hits,3);assert(report.result.similarity.related>report.result.similarity.unrelated);report.checks.push('Real normalized BGE vectors, related > unrelated, persistent vector-cache hits');report.ok=!report.errors.length;
}catch(e){report.error=e.stack;report.ok=false;}
finally{clearInterval(progressTimer);await context?.close();fs.writeFileSync(offlineFile?'dist/KNOWLEDGE_BGE_OFFLINE_MV3.json':'dist/KNOWLEDGE_BGE_MV3.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
process.exitCode=report.ok?0:1;
