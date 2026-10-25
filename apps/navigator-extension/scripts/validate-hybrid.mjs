import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hybridFixtures,conversationDocs,rawAnalysisFor} from '../validation/hybrid-fixtures.mjs';
import {analyzeConversation,assertStageCoverage,validateAIAnalysis,validateEvidence,orderedDocuments,stageCards} from '../analysis/conversation-analysis.js';
import {mergeProtected,reviseAnalysis} from '../analysis/analysis-revisions.js';
import {buildTfidf,keywords,phrases} from '../analysis/knowledge-text.js';
import {planAnalysis,responseRequest,parseResponse,MODEL_CATALOG} from '../analysis/ai-protocol.js';
import {AnalysisService,OpenAIProvider,createProxy} from '../../../tools/opc-ai-proxy.mjs';
const checks=[];const check=async(name,fn)=>{await fn();checks.push({name,passed:true});console.log('PASS '+name);};
const quality=[];let tp=0,fp=0,fn=0;
for(const f of hybridFixtures){await check('synthetic '+f.id,()=>{
  if(f.invalid){assert.throws(()=>analyzeConversation(f.documents));return;}
  const before=JSON.stringify(f.documents),result=analyzeConversation(f.documents);assert.equal(JSON.stringify(f.documents),before);assertStageCoverage(result.stages,f.documents);
  const predicted=result.stages.slice(1).map(s=>f.documents.findIndex(d=>d.cardId===s.startCardId)),reference=f.referenceBoundaries;
  const hit=predicted.filter(b=>reference.includes(b)).length;tp+=hit;fp+=predicted.length-hit;fn+=reference.length-hit;
  quality.push({id:f.id,reference,predicted,exact:JSON.stringify(reference)===JSON.stringify(predicted)});
  const terms=f.documents.flatMap((d,i)=>keywords(d,buildTfidf(f.documents).vectors[i]).map(k=>k.term));
  for(const t of f.forbidden??[])assert(!terms.includes(t),'noise survived: '+t);
  for(const t of f.required??[])assert(terms.some(k=>k.toLowerCase().includes(t.toLowerCase())),'missing technical term: '+t);
  for(const item of result.items)assert(item.evidence.every(e=>validateEvidence(e,f.documents).valid));
  if(f.facts==='decision'){assert(result.items.some(k=>k.type==='suggestion'&&k.content.includes('High')));assert(result.items.some(k=>k.type==='user_decision'&&k.status==='superseded'));assert(result.items.some(k=>k.type==='user_decision'&&k.content.includes('Medium')&&k.status==='active'));}
  if(f.facts==='intention'||f.facts==='negation')assert(!result.items.some(k=>k.type==='verified_result'||k.type==='user_decision'));
  if(f.facts==='suggestion')assert(!result.items.some(k=>k.type==='user_decision'));
});}
const docs=hybridFixtures.find(f=>f.id==='python-topics').documents;
await check('coverage rejects overlap, gaps, reverse, mixed projects and duplicate order',()=>{
  const a=analyzeConversation(docs);for(const stages of [[a.stages[1],a.stages[0]],a.stages.slice(1),[a.stages[0],a.stages[0]]])assert.throws(()=>assertStageCoverage(stages,docs));
  assert.throws(()=>orderedDocuments([...docs,{...docs[0],cardId:'other',sourceProjectId:'other'}]));
  assert.deepEqual(analyzeConversation([...docs].reverse()).stages,a.stages);
});
await check('AI source roles, versions, text, ranges and cross-conversation evidence are verified',()=>{
  const raw=rawAnalysisFor(docs),ref=raw.overview.evidence[0];for(const change of [{role:'assistant'},{versionId:'fake'},{conversationId:'other'},{start:1},{quote:'invented'},{end:99999},{messageId:'fake'}])assert(!validateEvidence({...ref,...change},docs).valid);
  raw.stages[0].items[0]={type:'user_decision',content:'助手建议就是用户选择',status:'active',evidence:[{...ref,role:'assistant'}]};const checked=validateAIAnalysis(raw,docs);assert.equal(checked.items[0].status,'pending');assert.notEqual(checked.items[0].type,'user_decision');assert(checked.conflicts.length);
});
await check('AI expectation is not completion; nonexistent evidence remains pending',()=>{
  const d=hybridFixtures.find(f=>f.id==='intention').documents,raw=rawAnalysisFor(d);raw.stages[0].items[0]={type:'verified_result',content:'全部完成',status:'active',evidence:raw.overview.evidence};assert.equal(validateAIAnalysis(raw,d).items[0].type,'hypothesis');
  raw.stages[0].items[0].evidence=[];assert.equal(validateAIAnalysis(raw,d).items[0].reviewStatus,'invalid_evidence');
});
await check('field-level title protected while summary updates; split ambiguity retained',()=>{
  let old=analyzeConversation(docs);old=reviseAnalysis(old,{kind:'stage',objectId:old.stages[0].id,field:'title',value:'人工标题'},docs).analysis;
  const newer=analyzeConversation(docs);newer.stages[0].summary='更新摘要';const merged=mergeProtected(old,newer,docs);assert.equal(merged.stages[0].title,'人工标题');assert.equal(merged.stages[0].summary,'更新摘要');
  const split=structuredClone(newer),first=split.stages[0];split.stages.splice(0,1,{...first,endCardId:docs[0].cardId},{...first,id:'new',startCardId:docs[1].cardId});const conflict=mergeProtected(old,split,docs);assert(conflict.retainedManual.some(r=>r.object.title==='人工标题'));
});
await check('manual boundaries preserve contiguous partition and reject protected neighbor changes',()=>{
  const old=analyzeConversation(docs),s=old.stages[0],edited=reviseAnalysis(old,{kind:'stage',objectId:s.id,field:'range',value:{startCardId:docs[0].cardId,endCardId:docs[2].cardId}},docs).analysis;
  assertStageCoverage(edited.stages,docs);const combined=analyzeConversation(docs);combined.stages=[{...combined.stages[0],endCardId:docs.at(-1).cardId}];const merged=mergeProtected(edited,combined,docs);assert.equal(merged.stages[0].endCardId,docs[2].cardId);assertStageCoverage(merged.stages,docs);assert.deepEqual(merged.stages.flatMap(s=>s.cardIds),docs.map(d=>d.cardId));
});
await check('manual knowledge content/status are independently protected and unlocking allows regeneration',()=>{
  let old=validateAIAnalysis(rawAnalysisFor(docs),docs);const id=old.items[0].id;
  old=reviseAnalysis(old,{kind:'item',objectId:id,field:'content',value:'人工核查后的知识'},docs).analysis;
  old=reviseAnalysis(old,{kind:'item',objectId:id,field:'status',value:'active'},docs).analysis;
  let candidate=validateAIAnalysis(rawAnalysisFor(docs),docs);candidate.items[0].content='AI 新内容';let merged=mergeProtected(old,candidate,docs);assert.equal(merged.items[0].content,'人工核查后的知识');assert.equal(merged.items[0].status,'active');
  old=reviseAnalysis(merged,{kind:'item',objectId:id,field:'content',unlock:true},docs).analysis;merged=mergeProtected(old,candidate,docs);assert.equal(merged.items[0].content,'AI 新内容');assert.equal(merged.items[0].status,'active');
});
await check('structured request, conservative preflight budgets and unknown model rejection',()=>{
  const p=planAnalysis(docs),r=responseRequest(p.model.id,docs,null,3500);assert.equal(r.store,false);assert.equal(r.text.format.strict,true);assert.equal(r.reasoning.effort,'none');assert(!JSON.stringify(r).includes('Bearer'));
  assert.throws(()=>planAnalysis(docs,{model:'unverified-model'}));assert.throws(()=>planAnalysis(docs,{budgetUSD:.0000001}));assert.throws(()=>planAnalysis(docs,{maxInputTokens:1000}));
});
const response=(raw,usage={input_tokens:123,output_tokens:45,total_tokens:168})=>({status:'completed',model:MODEL_CATALOG[0].id,output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(raw)}]}],usage});
await check('response usage, incomplete, refusal and invalid JSON parsing',()=>{
  assert.equal(parseResponse(response(rawAnalysisFor(docs))).usage.total_tokens,168);
  for(const r of [{status:'incomplete'}, {status:'completed',output:[{content:[{type:'refusal'}]}]}, {status:'completed',output:[{content:[{type:'output_text',text:'broken'}]}]}])assert.throws(()=>parseResponse(r));
});
await check('mock OpenAI provider fixed endpoint, request schema, credential isolation and errors',async()=>{
  let sent;const provider=new OpenAIProvider({apiKey:'test-only-secret',transport:async(url,options)=>{sent={url,options};return {ok:true,json:async()=>response(rawAnalysisFor(docs))};}});const out=await provider.analyze(responseRequest(MODEL_CATALOG[0].id,docs,null,3500),new AbortController().signal);assert.equal(sent.url,'https://api.openai.com/v1/responses');assert(!sent.options.body.includes('test-only-secret'));assert.equal(out.usage.input_tokens,123);
  for(const status of [401,403,404,429,500]){const p=new OpenAIProvider({apiKey:'secret',transport:async()=>({ok:false,status,json:async()=>({error:{message:'secret echoed upstream'}})})});await assert.rejects(()=>p.analyze({},new AbortController().signal),e=>!e.message.includes('secret'));}
});
await check('mock service cache, no-consent/duplicate prevention, actual usage and no fictional invoice',async()=>{
  let calls=0;const service=new AnalysisService({provider:{analyze:async request=>{calls++;return parseResponse(response(rawAnalysisFor(docs)));}}}),signal=new AbortController().signal;
  await assert.rejects(()=>service.run({documents:docs,options:{},requestId:'no'},signal));
  const one=await service.run({documents:docs,options:{},requestId:'one',consent:true},signal);assert.equal(one.run.actualCostUSD,null);assert.equal(one.run.usage.input_tokens,123);
  const two=await service.run({documents:docs,options:{},requestId:'two',consent:true},signal);assert(two.cacheHit);assert.equal(calls,1);
  await assert.rejects(()=>service.run({documents:docs,options:{},requestId:'one',consent:true},signal));
});
await check('mock cancellation, timeout, network and quota failures never retry',async()=>{
  const ctrl=new AbortController();ctrl.abort();const service=new AnalysisService({provider:{analyze:()=>{throw Error('should not call');}}});await assert.rejects(()=>service.run({documents:docs,options:{},requestId:'cancel',consent:true},ctrl.signal));
  const transport=async(_,o)=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Error('abort'))));const p=new OpenAIProvider({apiKey:'secret',transport,timeoutMs:15});const keepAlive=setInterval(()=>{},50);try{await assert.rejects(()=>p.analyze({},new AbortController().signal),e=>e.code==='timeout');}finally{clearInterval(keepAlive);}
  const n=new OpenAIProvider({apiKey:'secret',transport:async()=>{throw Error('secret');}});await assert.rejects(()=>n.analyze({},new AbortController().signal),e=>e.code==='network'&&!e.message.includes('secret'));
  const q=new OpenAIProvider({apiKey:'secret',transport:async()=>({ok:false,status:429,json:async()=>({error:{code:'insufficient_quota'}})})});await assert.rejects(()=>q.analyze({},new AbortController().signal),e=>e.code==='quota');
});
await check('incomplete API response records known billed usage even though no analysis is accepted',async()=>{
  const service=new AnalysisService({provider:{analyze:async()=>parseResponse({status:'incomplete',usage:{input_tokens:90,output_tokens:12,total_tokens:102}})}});
  await assert.rejects(()=>service.run({documents:docs,options:{},requestId:'incomplete-usage',consent:true},new AbortController().signal),e=>e.run.calls===1&&e.run.partialUsage[0].total_tokens===102&&e.run.actualCostUSD===null);
});
await check('proxy rejects missing authentication, wildcard origins and public host',()=>{
  assert.throws(()=>createProxy({provider:{},token:'short',allowedOrigins:['*']}));assert.throws(()=>createProxy({apiKey:'x',token:'x'.repeat(24),allowedOrigins:['https://public.example']}));
});
await check('long API plan preserves QA order, budgets every map and integration call, sums usage',async()=>{
  const long=conversationDocs(Array.from({length:28},(_,i)=>['Python 切片研究 '+i,'Python 切片边界示例。'.repeat(45)])),options={maxInputTokens:200000,budgetUSD:1,maxOutputTokens:1200},plan=planAnalysis(long,options);assert(plan.chunks.length>1);
  assert.deepEqual(plan.chunks.flatMap(c=>c.map(d=>d.cardId)),long.map(d=>d.cardId));
  let calls=0;const service=new AnalysisService({provider:{analyze:async request=>{calls++;const input=JSON.parse(request.input[0].content);let raw;if(input.integration){const all=input.integration.parts.flatMap(p=>p.stages);raw={overview:{title:'整体结果',summary:'分段后按证据整合。',themes:['Python 切片'],evidence:input.integration.evidence.slice(0,1)},stages:[{...all[0],endCardId:all.at(-1).endCardId,items:[]}]};}else raw=rawAnalysisFor(input.untrustedConversation.map(d=>({...d,question:d.questionSource.text})));return parseResponse(response(raw));}}});
  const result=await service.run({documents:long,options,requestId:'long',consent:true},new AbortController().signal);assert.equal(calls,plan.calls);assert.equal(result.run.usage.total_tokens,168*plan.calls);assertStageCoverage(validateAIAnalysis(result.raw,long).stages,long);assert.equal(result.raw.stages.length,1);assert(result.raw.stages[0].items[0].evidence.length>=plan.chunks.length);
});
await check('clipping away a hypothetical prefix cannot turn a user quote into a decision',()=>{
  const d=conversationDocs([['假设我决定选择 High 模型，这只是举例。','请勿当作已决定。']]),raw=rawAnalysisFor(d),e=raw.overview.evidence[0],start=e.quote.indexOf('我决定');raw.stages[0].items=[{type:'user_decision',status:'active',content:'用户选择 High',evidence:[{...e,start,end:start+'我决定选择 High 模型'.length,quote:'我决定选择 High 模型'}]}];assert.notEqual(validateAIAnalysis(raw,d).items[0].type,'user_decision');
});
const precision=tp/(tp+fp||1),recall=tp/(tp+fn||1),f1=2*tp/(2*tp+fp+fn||1),exact=quality.filter(q=>q.exact).length/quality.length;
const report={synthetic:true,corpusSize:hybridFixtures.length,referenceKind:'Author-defined synthetic reference boundaries; independent human review NOT collected',checks,segmentation:{tp,fp,fn,precision,recall,boundaryF1:f1,exactConversationRate:exact,conversations:quality},realAPI:false,mockAPI:true,humanReviewPending:true};
fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/HYBRID_QUALITY.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({checks:checks.length,boundaryF1:f1,exact,disagreements:quality.filter(q=>!q.exact)}));
// Quality gate includes false boundaries on single-topic and explicit shifts.
assert(f1>=.72,'Boundary F1 on declared synthetic references below RC gate');assert(exact>=.65,'Too many synthetic conversations disagree with references');
