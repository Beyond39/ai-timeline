// The only browser AI network boundary: authenticated loopback proxy. API keys
// never enter this process. Pairing tokens live in memory until page closes.
const PROXY='http://127.0.0.1:8787';
export class LocalAIClient {
  constructor(){this.token=null;}
  async connect(token){if(typeof token!=='string'||token.length<24)throw Error('请输入代理启动窗口中的配对令牌；不要输入 OpenAI API Key。');if(/^sk-/u.test(token))throw Error('这里接收本机配对令牌，不能输入 OpenAI API Key。');this.token=token;try{return await this.request('/v1/config');}catch(e){this.token=null;throw e;}}
  disconnect(){this.token=null;}
  async request(path,body=null,signal=null){
    if(!this.token)throw Error('请先连接本机 AI 代理。');
    const timeout=AbortSignal.timeout(path==='/v1/analyze'?300000:15000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    let response;try{response=await fetch(PROXY+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+this.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:combined,credentials:'omit',redirect:'error'});}catch{if(signal?.aborted)throw new DOMException('已取消，已有版本保留。已发出的调用可能产生费用。','AbortError');throw Error(timeout.aborted?'本机代理响应超时，已有版本保留；没有自动重试。':'本机 AI 代理无法连接，请检查启动状态、授权 Origin 和浏览器权限。');}
    let data;try{data=await response.json();}catch{throw Error('本机代理返回无效 JSON。');}
    if(!response.ok){const error=Error(typeof data.error==='string'?data.error.slice(0,300):'AI 分析未完成。');error.code=data.code;error.run=data.run;throw error;}return data;
  }
  analyze(documents,options,requestId,signal){return this.request('/v1/analyze',{documents,options,requestId,consent:true},signal);}
  estimate(documents,options){return this.request('/v1/estimate',{documents,options});}
  cancel(requestId){return this.request('/v1/cancel',{requestId}).catch(()=>{});}
  progress(requestId){return this.request('/v1/progress?requestId='+encodeURIComponent(requestId));}
}
