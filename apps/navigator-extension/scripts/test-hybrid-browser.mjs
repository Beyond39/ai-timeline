import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {graph,user,body} from '../validation/qa-p0-fixtures.mjs';
import {hybridFixtures,rawAnalysisFor} from '../validation/hybrid-fixtures.mjs';
import {analyzeConversation} from '../analysis/conversation-analysis.js';
import {MODEL_CATALOG} from '../analysis/ai-protocol.js';
import {createProxy} from '../../../tools/opc-ai-proxy.mjs';
import { chromium, browserExecutable as findBrowser } from './browser-runtime.mjs';
const report={scope:'Real Edge MV3 + actual loopback HTTP proxy + mocked upstream OpenAI; isolated synthetic conversations; no real paid API',checks:[],errors:[],realAPI:false};
let context,page,proxy,providerMode='success',release,started=false;
const token='synthetic-pairing-token-for-browser-tests-only';
const check=async(name,fn)=>{const evidence=await fn();report.checks.push({name,passed:true,evidence});console.log('PASS '+name);};
const rpc=(type,args={})=>page.evaluate(async({type,args})=>{const r=await chrome.runtime.sendMessage({type,args});if(!r.ok)throw Error(r.error);return r.data;},{type,args});
async function attach(){const cdp=await context.newCDPSession(page);const {result:p}=await cdp.send('Runtime.evaluate',{expression:'import("./ui/opc.js").then(m=>m.OPCTimeline.prototype)',awaitPromise:true});const {objects}=await cdp.send('Runtime.queryObjects',{prototypeObjectId:p.objectId});await cdp.send('Runtime.callFunctionOn',{objectId:objects.objectId,functionDeclaration:'function(){globalThis.testOwner=this.find(x=>x.host?.isConnected);}',returnByValue:true});await cdp.detach();}
function rawGraph(rows,label){let parent='root';const pairs=[];rows.forEach((d,i)=>{const q=label+'q'+i,a=label+'a'+i;pairs.push([q,parent,user(q,d.question,1790812800+i*86400)],[a,q,body(a,d.answerSources[0].text)]);parent=a;});const raw=graph(pairs,parent,'hybrid-'+label);raw.title='合成 Hybrid '+label;return raw;}
async function seed(projectId,raw){const d=await rpc('importPreview',{text:JSON.stringify(raw),filename:'synthetic-hybrid.json'});return rpc('saveDraft',{projectId,draftId:d.id});}
const current=()=>page.evaluate(()=>testOwner.knowledge.conversation.record);
async function waitIdle(){await page.waitForFunction(()=>testOwner.knowledge.conversation.record?.current&&!testOwner.knowledge.conversation.busy);}
// The shared app owns this entry as the top-level Topics button. The old
// "本地知识整理" toolbar fallback exists only in standalone embedded hosts.
async function openKnowledge(){
  await page.getByRole('button',{name:'Topics',exact:true}).click();
  const details=page.locator('.knowledge-conversation-details');
  await details.waitFor();
  if(await details.getAttribute('open')===null)await details.locator(':scope > summary').click();
  await page.locator('.conversation-knowledge').waitFor();await waitIdle();
}
async function closeKnowledge(){if(await page.locator('.knowledge-dialog').isVisible())await page.locator('.knowledge-dialog > .dialog-header').getByRole('button',{name:'关闭',exact:true}).click();}
async function editTitle(label){await page.locator('.ck-stage').first().getByRole('button',{name:'编辑标题',exact:true}).click();await page.locator('#edit-dialog [name=value]').fill(label);await page.locator('#edit-dialog button[type=submit]').click();await page.waitForFunction(label=>testOwner.knowledge.conversation.record.current.stages.some(s=>s.title===label),label);}
async function startAI(){await page.getByRole('button',{name:'AI 深度总结',exact:true}).click();await page.getByRole('button',{name:'查看估算',exact:true}).click();await page.getByRole('button',{name:'确认发送并分析',exact:true}).click();}
async function snapshot(){return page.evaluate(async()=>{const {readState}=await import('./storage/database.js');const s=await readState();return JSON.stringify(Object.fromEntries(['messages','versions','qaCards','qaMetadata','relationships','canvasLayouts'].map(k=>[k,s[k]])));});}
try{
  const profile=path.resolve('dist/hybrid-profile-'+Date.now());fs.mkdirSync(profile,{recursive:true});
  context=await chromium.launchPersistentContext(profile,{executablePath:findBrowser('edge'),headless:true,viewport:{width:1440,height:1040},args:['--disable-extensions-except='+path.resolve('.'),'--load-extension='+path.resolve('.')]});
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),origin=worker.url().match(/^chrome-extension:\/\/[^/]+/u)[0];report.browser=context.browser().version();
  const provider={analyze:async(request,signal)=>{
    started=true;
    if(providerMode==='fail')throw Object.assign(Error('合成配额不足；已有版本保留。'),{code:'quota',status:429});
    if(providerMode==='wait')await new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(Object.assign(Error('合成请求已取消'),{code:'cancelled'})),{once:true});});
    const input=JSON.parse(request.input[0].content),wire=input.untrustedConversation;
    const docs=wire.map(d=>({...d,sourceProjectId:'synthetic-upstream',question:d.questionSource.text,answer:d.answerSources.map(s=>s.text).join('\n')})),raw=rawAnalysisFor(docs);
    const offline=analyzeConversation(docs);raw.stages=offline.stages.map(s=>({...s,items:offline.items.filter(k=>k.stageId===s.id)}));raw.overview.summary='这是浏览器 Mock API 的结构化总结；请核对原文。';
    return {data:raw,usage:{input_tokens:200,output_tokens:80,total_tokens:280,cached_input_tokens:0},responseModel:MODEL_CATALOG[0].id};
  }};
  ({server:proxy}=createProxy({provider,token,allowedOrigins:[origin]}));await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(8787,'127.0.0.1',resolve);});
  await check('real HTTP proxy rejects wrong pairing credentials and unapproved origins',async()=>{const wrong=await fetch('http://127.0.0.1:8787/v1/config',{headers:{Origin:origin,Authorization:'Bearer invalid'}}),foreign=await fetch('http://127.0.0.1:8787/v1/config',{headers:{Origin:'https://untrusted.invalid',Authorization:'Bearer '+token}});assert.equal(wrong.status,401);assert.equal(foreign.status,403);});
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));await page.goto(origin+'/workspace.html');await page.waitForFunction(()=>!document.querySelector('#timeline-view-button').disabled);
  const A=await rpc('createProject',{name:'Hybrid A'}),B=await rpc('createProject',{name:'Hybrid B'}),fixture=hybridFixtures.find(f=>f.id==='python-topics'),rawA=rawGraph(fixture.documents,'A');
  await seed(A.id,rawA);await seed(A.id,rawGraph(hybridFixtures.find(f=>f.id==='decision').documents,'A-decision'));await seed(B.id,rawGraph(fixture.documents,'B'));
  await page.goto(origin+'/workspace.html?projectId='+A.id);await page.locator('.ht-point').first().waitFor();await attach();const original=await snapshot();
  await check('offline auto analysis is source-preserving and creates chronological stages in real IndexedDB',async()=>{await openKnowledge();const option=page.locator('select[aria-label="知识 Conversation"] option').filter({hasText:'合成 Hybrid A'}).first();await page.getByLabel('知识 Conversation',{exact:true}).selectOption(await option.getAttribute('value'));await waitIdle();const record=await current();assert(record.current.stages.length>=1);assert.equal(await snapshot(),original);return {stages:record.current.stages.length,versions:record.versions.length};});
  const selectedConversation=(await current()).conversationId;
  await check('field edits automatically protected; rerun updates other fields and saves a new version',async()=>{await editTitle('人工阶段标题');const before=await current();await page.getByRole('button',{name:'更新本地阶段',exact:true}).click();await waitIdle();const after=await current();assert(after.current.stages.some(s=>s.title==='人工阶段标题'&&s.protections.title));assert.equal(after.versions.length,before.versions.length+1);return {revision:after.revision};});
  await check('stage navigation locates real Timeline and reader shows owning stage',async()=>{await page.locator('.ck-stage').first().getByRole('button',{name:'在时间线查看阶段',exact:true}).click();await page.locator('.opc-reading-body').waitFor();await page.locator('.ck-reader-stage').waitFor();assert(await page.locator('.ht-point.knowledge-stage-range').count()>0);await page.locator('.close-detail').click();});
  await check('evidence opens exact original message substring with highlight',async()=>{await openKnowledge();await page.getByLabel('知识 Conversation',{exact:true}).selectOption(selectedConversation);await waitIdle();await page.locator('.ck-stage').first().getByRole('button',{name:/原文证据 1/}).first().click();await page.locator('.ck-evidence mark').waitFor();assert((await page.locator('.ck-evidence mark').textContent()).length>0);await page.locator('.close-detail').click();});
  await openKnowledge();await page.getByLabel('知识 Conversation',{exact:true}).selectOption(selectedConversation);await waitIdle();
  await check('real loopback pairing, model choice and explicit cost/upload confirmation',async()=>{
    await page.getByRole('button',{name:'连接 AI 代理',exact:true}).click();await page.locator('#edit-dialog [name=token]').fill(token);await page.locator('#edit-dialog button[type=submit]').click();await page.waitForFunction(()=>testOwner.knowledge.conversation.config?.models?.length>0);
    const before=(await current()).versions.length;await startAI();await page.waitForFunction(()=>testOwner.knowledge.conversation.record?.current.mode==='ai'&&!testOwner.knowledge.conversation.busy);
    const r=await current();assert.equal(r.versions.length,before+1);assert(r.current.stages.some(s=>s.title==='人工阶段标题'));assert.equal(r.current.run.usage.total_tokens,280);assert.equal(r.current.run.actualCostUSD,null);assert(!JSON.stringify(r).includes(token));assert.equal(await snapshot(),original);return {usage:r.current.run.usage,mode:r.current.mode};
  });
  await check('same request reuses cached AI result and records cache hit',async()=>{await startAI();await waitIdle();assert((await current()).current.run.cacheHit);});
  await check('editing while AI pending keeps current human fields when completion arrives',async()=>{
    providerMode='wait';started=false;
    // Different max output changes the cache key, with visible user confirmation.
    await page.getByRole('button',{name:'AI 深度总结',exact:true}).click();await page.locator('#edit-dialog [name=maxOutputTokens]').fill('3501');await page.getByRole('button',{name:'查看估算',exact:true}).click();await page.getByRole('button',{name:'确认发送并分析',exact:true}).click();
    for(let i=0;i<100&&!started;i++)await new Promise(r=>setTimeout(r,25));assert(started);await editTitle('分析期间人工标题');release();await waitIdle();assert((await current()).current.stages.some(s=>s.title==='分析期间人工标题'));providerMode='success';
  });
  await check('cancelled API leaves previous version intact and next task works',async()=>{
    const previous=(await current()).current.versionId;providerMode='wait';started=false;await page.getByRole('button',{name:'AI 深度总结',exact:true}).click();await page.locator('#edit-dialog [name=maxOutputTokens]').fill('3502');await page.getByRole('button',{name:'查看估算',exact:true}).click();await page.getByRole('button',{name:'确认发送并分析',exact:true}).click();for(let i=0;i<100&&!started;i++)await new Promise(r=>setTimeout(r,25));assert(started);await page.getByRole('button',{name:'取消分析',exact:true}).click();await waitIdle();assert.equal((await current()).current.versionId,previous);providerMode='success';
  });
  await check('proxy failure preserves offline and historical versions',async()=>{
    const previous=(await current()).current.versionId;providerMode='fail';await page.getByRole('button',{name:'AI 深度总结',exact:true}).click();await page.locator('#edit-dialog [name=maxOutputTokens]').fill('3503');await page.getByRole('button',{name:'查看估算',exact:true}).click();await page.getByRole('button',{name:'确认发送并分析',exact:true}).click();await page.waitForFunction(()=>!testOwner.knowledge.conversation.busy&&testOwner.knowledge.conversation.message.includes('配额'));assert.equal((await current()).current.versionId,previous);providerMode='success';
  });
  await check('historical restore keeps latest human title, overview edits and revision log',async()=>{await page.locator('.ck-history > summary').click();await page.getByRole('button',{name:'恢复此版本',exact:true}).last().click();await page.waitForFunction(()=>Boolean(testOwner.knowledge.conversation.record.current.restoredFrom));const r=await current();assert(r.current.stages.some(s=>s.title==='分析期间人工标题'));assert(r.revisions.some(x=>x.kind==='restore'&&x.before!==x.after));});
  await check('atomic competing analysis commits reject stale completion',async()=>{const results=await page.evaluate(async()=>{const k=testOwner.knowledge.conversation,{saveAnalysis}=await import('./storage/conversation-analyses.js'),base=k.record.current.versionId,candidate=structuredClone(k.record.current);const results=await Promise.allSettled([saveAnalysis(candidate,k.docs,{baseVersionId:base}),saveAnalysis(candidate,k.docs,{baseVersionId:base})]);return results.map(r=>r.status);});assert.equal(results.filter(x=>x==='fulfilled').length,1);assert.equal(results.filter(x=>x==='rejected').length,1);});
  await check('analysis in A then switching to independent B cannot write across project boundary',async()=>{
    await page.evaluate(async()=>{const k=testOwner.knowledge.conversation,{loadAnalysis}=await import('./storage/conversation-analyses.js');k.record=await loadAnalysis(k.projectId,k.conversationId);});providerMode='wait';started=false;
    await page.getByRole('button',{name:'AI 深度总结',exact:true}).click();await page.locator('#edit-dialog [name=maxOutputTokens]').fill('3504');await page.getByRole('button',{name:'查看估算',exact:true}).click();await page.getByRole('button',{name:'确认发送并分析',exact:true}).click();for(let i=0;i<100&&!started;i++)await new Promise(r=>setTimeout(r,25));assert(started);
    // The existing workbench deliberately queues navigation while a dialog is
    // open. Closing it cancels the pending task before committing the switch.
    await page.locator('#project-select').selectOption(B.id,{force:true});await closeKnowledge();await page.waitForFunction(id=>testOwner.projectId===id,B.id);providerMode='success';release?.();await openKnowledge();const b=await current();assert.equal(b.projectId,B.id);assert(b.current.mode==='offline');assert(b.current.stages.every(s=>s.cardIds.every(id=>id.includes(b.conversationId))));await closeKnowledge();
    const before=await page.evaluate(()=>testOwner.horizontal.layout.visibleSpan);await page.getByRole('button',{name:'时间放大',exact:true}).click();const after=await page.evaluate(()=>testOwner.horizontal.layout.visibleSpan);assert(after<before);await page.locator('.ht-point').first().click();await page.locator('.opc-reading-body').waitFor();return {projectId:b.projectId,before,after};
  });
  await check('refresh/reload persists B analysis and keeps Timeline and reader usable',async()=>{await page.reload();await page.locator('.ht-point').first().waitFor();await attach();await openKnowledge();assert.equal((await current()).projectId,B.id);await page.screenshot({path:'dist/HYBRID_KNOWLEDGE.png'});await closeKnowledge();await page.locator('.ht-point').first().click();await page.locator('.opc-reading-body').waitFor();});
  await check('knowledge archive export/import is additive and cannot overwrite latest manual edits',async()=>{const result=await page.evaluate(async()=>{const {exportAnalyses,importAnalyses,loadAnalysis}=await import('./storage/conversation-analyses.js'),data=await exportAnalyses();await importAnalyses(data);const first=data.records[0],loaded=await loadAnalysis(first.projectId,first.conversationId);return {count:data.records.length,retained:loaded.importedManual.length,revision:loaded.revision};});assert(result.count>=2);assert(result.retained>0);return result;});
  await check('source update while AI pending rejects stale result and invalidates old message-version evidence',async()=>{
    await page.locator('.close-detail').click();await openKnowledge();
    await page.getByRole('button',{name:'连接 AI 代理',exact:true}).click();await page.locator('#edit-dialog [name=token]').fill(token);await page.locator('#edit-dialog button[type=submit]').click();await page.waitForFunction(()=>Boolean(testOwner.knowledge.conversation.config));
    const previous=(await current()).current.versionId;providerMode='wait';started=false;await page.getByRole('button',{name:'AI 深度总结',exact:true}).click();await page.locator('#edit-dialog [name=maxOutputTokens]').fill('3600');await page.getByRole('button',{name:'查看估算',exact:true}).click();await page.getByRole('button',{name:'确认发送并分析',exact:true}).click();for(let i=0;i<100&&!started;i++)await new Promise(r=>setTimeout(r,25));assert(started);
    const updated=rawGraph(fixture.documents,'B');updated.mapping.Bq0.message.content.parts[0]+='（合成更新）';await seed(B.id,updated);release();await page.waitForFunction(()=>!testOwner.knowledge.conversation.busy&&testOwner.knowledge.conversation.message.includes('原文已更新'));assert.equal((await current()).current.versionId,previous);
    const valid=await page.evaluate(async()=>{const k=testOwner.knowledge.conversation,{validateEvidence}=await import('./analysis/conversation-analysis.js');return validateEvidence(k.record.current.stages[0].evidence[0],await k.currentDocs()).valid;});assert.equal(valid,false);providerMode='success';await closeKnowledge();await openKnowledge();await page.getByRole('button',{name:'更新本地阶段',exact:true}).click();await waitIdle();assert.notEqual((await current()).current.versionId,previous);
  });
  await check('refresh during an active analysis preserves committed data and never automatically retries',async()=>{
    const previous=(await current()).current.versionId;providerMode='wait';started=false;await page.getByRole('button',{name:'AI 深度总结',exact:true}).click();await page.locator('#edit-dialog [name=maxOutputTokens]').fill('3601');await page.getByRole('button',{name:'查看估算',exact:true}).click();await page.getByRole('button',{name:'确认发送并分析',exact:true}).click();for(let i=0;i<100&&!started;i++)await new Promise(r=>setTimeout(r,25));assert(started);await page.reload();await page.locator('.ht-point').first().waitFor();await attach();providerMode='success';release?.();await openKnowledge();assert.equal((await current()).current.versionId,previous);assert.equal(await page.evaluate(()=>testOwner.knowledge.conversation.busy),false);assert((await current()).runs.some(r=>['running','cancelled','failed'].includes(r.status)));await page.screenshot({path:'dist/HYBRID_KNOWLEDGE.png'});
  });
  await check('shared Side Panel entry opens saved knowledge at narrow width without horizontal overflow',async()=>{await page.goto(origin+'/sidepanel.html?projectId='+B.id);await page.setViewportSize({width:390,height:850});await page.locator('.ht-point').first().waitFor();await attach();await openKnowledge();assert.equal((await current()).projectId,B.id);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const box=await page.locator('.knowledge-dialog').boundingBox();assert(box.x>=0&&box.x+box.width<=390);await page.screenshot({path:'dist/HYBRID_KNOWLEDGE_NARROW.png'});});
  assert.deepEqual(report.errors,[]);report.ok=true;
}catch(e){report.ok=false;report.error=e.stack;console.error(e.stack);}
finally{await context?.close();if(proxy)await new Promise(resolve=>proxy.close(resolve));fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/HYBRID_BROWSER_REPORT.json',JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,checks:report.checks.length,errors:report.errors,report:'dist/HYBRID_BROWSER_REPORT.json'}));}
process.exitCode=report.ok?0:1;
