// Local trusted boundary. Run with Node >=22. No dependencies, storage or logs
// of conversation bodies / upstream credentials. Never listens on a public IP.
import http from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { MODEL_CATALOG, planAnalysis, responseRequest, parseResponse, tokenUpperBound, AI_PROMPT_VERSION } from '../apps/navigator-extension/analysis/ai-protocol.js';
import { orderedDocuments, analyzeConversation, validateAIAnalysis, assertStageCoverage, supersedeDecisions } from '../apps/navigator-extension/analysis/conversation-analysis.js';

const upstreamErrors={401:['invalid_key','服务端 OpenAI 凭据无效。'],403:['forbidden','当前账户无权使用此模型。'],404:['model_unavailable','当前账户不可用此模型。'],429:['rate_limited','OpenAI 限流，请稍后手动重试。']};
const fault=(code,message,status=400)=>Object.assign(Error(message),{code,status});
export class OpenAIProvider {
  constructor({apiKey,transport=globalThis.fetch,timeoutMs=90000}){this.apiKey=apiKey;this.transport=transport;this.timeoutMs=timeoutMs;}
  async analyze(request,signal){
    const timeout=AbortSignal.timeout(this.timeoutMs),combined=AbortSignal.any([signal,timeout]);let response;
    try{response=await this.transport('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.apiKey},body:JSON.stringify(request),signal:combined});}
    catch{if(signal.aborted)throw fault('cancelled','分析已取消；已发出的调用可能仍产生费用。',499);if(timeout.aborted)throw fault('timeout','OpenAI 请求超时；已有结果保留，没有自动重试。',504);throw fault('network','无法连接 OpenAI，已有结果保留。',502);}
    if(!response.ok){let quota=false;try{const e=await response.json();quota=e?.error?.code==='insufficient_quota';}catch{}const [code,message]=quota?['quota','OpenAI 配额不足，请检查服务端账户。']:(upstreamErrors[response.status]??['upstream','OpenAI 请求失败，请核对模型及结构化输出兼容性。']);throw fault(code,message,response.status===429?429:502);}
    let body;try{body=await response.json();}catch{throw fault('invalid_json','OpenAI 返回无法解析的响应。',502);}return parseResponse(body);
  }
}
export class AnalysisService {
  constructor({provider,catalog=MODEL_CATALOG,maxSessionUSD=2}){this.provider=provider;this.catalog=catalog;this.maxSessionUSD=maxSessionUSD;this.reservedUSD=0;this.cache=new Map();this.usedIds=new Set();this.busy=false;}
  estimate(documents,options){try{const docs=orderedDocuments(documents);return planAnalysis(docs,options,this.catalog);}catch(e){throw fault('invalid_limits',e.message);}}
  async run({documents,options,consent,requestId},signal,onProgress=()=>{}){
    if(consent!==true)throw fault('consent','必须明确确认发送给 OpenAI。');
    if(typeof requestId!=='string'||requestId.length>100||this.usedIds.has(requestId))throw fault('duplicate','任务 ID 已使用；不会重复发起付费请求。',409);
    const docs=orderedDocuments(documents),plan=this.estimate(docs,options),key=createHash('sha256').update(JSON.stringify([docs,options,AI_PROMPT_VERSION])).digest('hex');
    if(signal.aborted)throw fault('cancelled','分析已取消。',499);
    if(this.cache.has(key)){onProgress({completed:0,total:0,cacheHit:true});return {...structuredClone(this.cache.get(key)),cacheHit:true};}
    if(this.busy)throw fault('busy','代理已有分析任务，请等待或取消后再试。',409);
    if(this.reservedUSD+plan.estimatedMaximumUSD>this.maxSessionUSD)throw fault('session_budget','代理本次运行预算已达到限制。',429);
    this.usedIds.add(requestId);this.busy=true;this.reservedUSD+=plan.estimatedMaximumUSD;
    // Failed/aborted calls retain the full reservation: the provider may have
    // billed them even without returning usage. Never assume cancellation free.
    const usages=[],models=[],parts=[];let calls=0,attempts=0;
    const call=async(request)=>{if(signal.aborted)throw fault('cancelled','分析已取消。',499);attempts++;const result=await this.provider.analyze(request,signal);usages.push(result.usage);models.push(result.responseModel);onProgress({completed:++calls,total:plan.calls});return result.data;};
    try{
      for(const chunk of plan.chunks){const raw=await call(responseRequest(plan.model.id,chunk,analyzeConversation(chunk),plan.maxOutputTokens));parts.push({raw,checked:validateAIAnalysis(raw,chunk)});}
      let raw;
      if(parts.length===1)raw=parts[0].raw;
      else {
        // Global integration can merge artificial chunk edges, but all card
        // ranges and source references are revalidated against the originals.
        const evidence=parts.flatMap(p=>p.checked.stages.flatMap(s=>s.evidence.filter(e=>e.valid))).slice(0,100);
        const integration={task:'Synthesize the overall outcome and refine the COMPLETE chronological stage partition from the ordered validated records. Chunk edges are NOT discussion boundaries: merge them when the same discussion continues. Return all stages, each QA exactly once. Cite only provided exact evidence. Preserve decisions, unresolved issues and provenance.',orderedCardIds:docs.map(d=>d.cardId),parts:parts.map(p=>({overview:p.checked.overview,stages:p.checked.stages,items:p.checked.items})),evidence};
        const request=responseRequest(plan.model.id,[],null,plan.maxOutputTokens,integration);
        if(tokenUpperBound(request)>plan.integrationInput)throw fault('integration_limit','分段整合超过已确认输入预算；分段调用已记录，没有继续付费整合。');
        const overall=await call(request);validateAIAnalysis(overall,docs);
        // Preserve extracted map items even if the global response omits them.
        // Reassign using evidence ranges, never the old stage array position.
        const positions=new Map(docs.map((d,i)=>[d.cardId,i]));
        raw={overview:overall.overview,stages:overall.stages.map(s=>{const a=positions.get(s.startCardId),b=positions.get(s.endCardId),items=[...s.items];for(const item of parts.flatMap(p=>p.raw.stages.flatMap(t=>t.items))){const anchor=positions.get(item.evidence?.[0]?.cardId);if(anchor>=a&&anchor<=b){const same=items.find(x=>x.type===item.type&&x.content===item.content);if(!same)items.push(structuredClone(item));else for(const ref of item.evidence)if(!same.evidence.some(e=>e.messageId===ref.messageId&&e.versionId===ref.versionId&&e.start===ref.start&&e.end===ref.end))same.evidence.push(ref);}}return {...s,items};})};
      }
      const analysis=validateAIAnalysis(raw,docs);assertStageCoverage(analysis.stages,docs);analysis.items=supersedeDecisions(analysis.items);
      const usage=usages.every(Boolean)?usages.reduce((a,u)=>({input_tokens:a.input_tokens+u.input_tokens,output_tokens:a.output_tokens+u.output_tokens,total_tokens:a.total_tokens+u.total_tokens,cached_input_tokens:a.cached_input_tokens+u.cached_input_tokens}),{input_tokens:0,output_tokens:0,total_tokens:0,cached_input_tokens:0}):null;
      const result={raw,run:{provider:'openai',model:plan.model.id,responseModels:models,promptVersion:AI_PROMPT_VERSION,algorithmVersion:analysis.engineVersion,usage,partialUsage:usages,actualCostUSD:null,estimatedCostFromUsageUSD:usage?(usage.input_tokens*plan.model.inputPerMillion+usage.output_tokens*plan.model.outputPerMillion)/1e6:null,estimatedMaximumUSD:plan.estimatedMaximumUSD,pricingAsOf:plan.pricingAsOf,createdAt:new Date().toISOString(),status:analysis.status,calls},cacheHit:false};
      this.cache.set(key,structuredClone(result));if(this.cache.size>20)this.cache.delete(this.cache.keys().next().value);return result;
    }catch(e){if(e.usage)usages.push(e.usage);e.run={provider:'openai',model:plan.model.id,status:signal.aborted?'cancelled':'failed',calls:attempts,completedCalls:calls,partialUsage:usages,actualCostUSD:null,reservedMaximumUSD:plan.estimatedMaximumUSD};throw e;}
    finally{this.busy=false;}
  }
}
export function createProxy({apiKey,token,allowedOrigins,provider,maxSessionUSD=2,catalog=MODEL_CATALOG}){
  if(!provider&&!apiKey)throw Error('服务端缺少 OPENAI_API_KEY。');
  if(typeof token!=='string'||token.length<24||!allowedOrigins?.length||allowedOrigins.some(o=>!/^chrome-extension:\/\/[a-p]{32}$/u.test(o)))throw Error('必须配置至少 24 字符配对令牌和确切的插件 Origin。');
  const service=new AnalysisService({provider:provider??new OpenAIProvider({apiKey}),catalog,maxSessionUSD}),active=new Map();let windowStart=Date.now(),requests=0;
  const server=http.createServer(async(req,res)=>{
    const origin=req.headers.origin;
    const send=(status,data)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}};
    if(!allowedOrigins.includes(origin)||!/^127\.0\.0\.1(?::\d+)?$/u.test(req.headers.host??'')){send(403,{error:'来源或 Host 未获授权。',code:'origin'});return;}
    res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Private-Network','true');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    const supplied=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+token);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){send(401,{error:'本机代理配对令牌无效。',code:'auth'});return;}
    if(Date.now()-windowStart>60000){windowStart=Date.now();requests=0;}if(++requests>60){send(429,{error:'本机代理请求过于频繁。',code:'rate_limited'});return;}
    if(req.method==='GET'&&req.url==='/v1/config'){send(200,{models:catalog,defaultModel:catalog[0].id,mode:'loopback-only',sessionBudgetUSD:maxSessionUSD});return;}
    if(req.method==='GET'&&req.url.startsWith('/v1/progress?')){const id=new URL(req.url,'http://127.0.0.1').searchParams.get('requestId');send(200,active.get(id)?.progress??{completed:0,total:0,state:'finished_or_unknown'});return;}
    if(req.method!=='POST'||!['/v1/estimate','/v1/analyze','/v1/cancel'].includes(req.url)){send(404,{error:'接口不存在。'});return;}
    let body='';try{for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2_000_000)throw fault('too_large','请求超过 2 MB。',413);}const args=JSON.parse(body);
      if(req.url==='/v1/cancel'){active.get(args.requestId)?.controller.abort();send(200,{cancelled:true});return;}
      if(req.url==='/v1/estimate'){const {chunks,...plan}=service.estimate(args.documents,args.options);send(200,{...plan,chunkCount:chunks.length});return;}
      const controller=new AbortController();if(active.has(args.requestId))throw fault('duplicate','任务已在运行。',409);const job={controller,progress:{completed:0,total:0,state:'running'}};active.set(args.requestId,job);res.on('close',()=>{if(!res.writableEnded)controller.abort();});
      try{const result=await service.run(args,controller.signal,p=>{job.progress={...p,state:'running'};});send(200,result);}finally{active.delete(args.requestId);}
    }catch(e){send(e.status??400,{error:e.code?e.message:'分析未完成，请核对输入；已有版本保留。',code:e.code??'invalid_request',run:e.run??null});}
  });server.requestTimeout=300000;server.headersTimeout=10000;return {server,service};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const token=process.env.OPC_PROXY_TOKEN||randomBytes(24).toString('hex'),allowedOrigins=(process.env.OPC_ALLOWED_ORIGINS??'').split(',').map(x=>x.trim()).filter(Boolean),maxSessionUSD=Number(process.env.OPC_SESSION_BUDGET_USD??'2');if(!Number.isFinite(maxSessionUSD)||maxSessionUSD<=0||maxSessionUSD>20)throw Error('运行预算必须在 0–20 USD 之间。');const {server}=createProxy({apiKey:process.env.OPENAI_API_KEY,token,allowedOrigins,maxSessionUSD});server.listen(8787,'127.0.0.1',()=>{console.log('OPC local AI proxy: http://127.0.0.1:8787');console.log('一次性本机配对令牌（不是 API Key）: '+token);console.log('仅允许: '+allowedOrigins.join(', '));});server.on('error',()=>{console.error('本机代理无法监听 8787，请检查端口占用。');process.exitCode=1;});}catch(e){console.error(e.message);process.exitCode=1;}
}
