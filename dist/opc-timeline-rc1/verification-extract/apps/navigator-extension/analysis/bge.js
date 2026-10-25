import { digest } from '../domain/common.js';
import { PREPROCESSING_VERSION, semanticInput } from './knowledge-text.js';
import { cacheGet, cachePut } from '../storage/knowledge-cache.js';
export const BGE=Object.freeze({modelId:'Xenova/bge-small-zh-v1.5',revision:'75c43b069aac4d136ba6bc1122f995fedcfd2781',runtime:'transformers.js-2.17.2',pooling:'cls',normalize:true,dimensions:512,maxLength:512,quantized:true,backend:'wasm'});
export const MODEL_SHA256='15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc';
export async function importModelFile(file) {
  if(file.size!==24010842)throw Error('需要此固定版本的 model_quantized.onnx（24,010,842 字节）。');
  const data=await file.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==MODEL_SHA256)throw Error('模型 SHA-256 不匹配，未保存。');
  const cache=await caches.open('transformers-cache');await cache.put(`https://huggingface.co/${BGE.modelId}/resolve/${BGE.revision}/onnx/model_quantized.onnx`,new Response(data,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(data.byteLength)}}));
  return {bytes:data.byteLength,sha256:hash};
}
export function validEmbedding(vector) {return (Array.isArray(vector)||vector instanceof Float32Array)&&vector.length===BGE.dimensions&&vector.every(Number.isFinite)&&Math.abs(Math.sqrt(vector.reduce((s,v)=>s+v*v,0))-1)<.005;}
export async function embeddingKey(doc,config=BGE) {return digest([doc.cardId,config,PREPROCESSING_VERSION,await digest(semanticInput(doc))]);}
let extractorPromise;
export async function getExtractor(progress=()=>{}) {
  if(!extractorPromise)extractorPromise=(async()=>{
    const {pipeline,env}=await import('../vendor/bge/transformers.min.js');
    env.allowLocalModels=true;env.useBrowserCache=true;
    env.localModelPath=new URL('../vendor/bge/models/',import.meta.url).href;
    env.backends.onnx.wasm.wasmPaths=new URL('../vendor/bge/',import.meta.url).href;
    env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
    let timer;
    try{return await Promise.race([pipeline('feature-extraction',BGE.modelId,{revision:BGE.revision,quantized:true,progress_callback:progress}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('模型下载或加载超过 120 秒，请重试或导入离线模型。')),120000);})]);}
    finally{clearTimeout(timer);}
  })().catch(error=>{extractorPromise=null;throw error;});
  return extractorPromise;
}
export async function embedDocuments(documents,progress=()=>{}) {
  const start=performance.now(),vectors={},stats={hits:0,computed:0,loadMs:0,inferenceMs:0,totalMs:0,truncated:0,outputType:null,outputDimensions:null};let extractor;
  for(let i=0;i<documents.length;i++) {
    const doc=documents[i],input=semanticInput(doc);if(!input.trim())continue;
    const id=await embeddingKey(doc),cached=await cacheGet('embeddings',id);
    if(cached&&validEmbedding(cached.vector)){vectors[doc.cardId]=cached.vector;stats.hits++;}
    else {
      if(!extractor){const t=performance.now();extractor=await getExtractor(p=>progress({phase:'model',status:p.status,file:p.file,progress:p.progress}));stats.loadMs=performance.now()-t;}
      if(extractor.model.config.hidden_size!==512||extractor.model.config.max_position_embeddings!==512)throw Error('BGE 模型配置不匹配。');
      const encoded=extractor.tokenizer(input,{truncation:false});const tokenCount=encoded.input_ids.dims.at(-1);if(tokenCount>BGE.maxLength)stats.truncated++;
      const t=performance.now(),out=await extractor(input,{pooling:'cls',normalize:true,truncation:true,max_length:BGE.maxLength});
      if(out.type!=='float32'||!(out.data instanceof Float32Array)||out.dims.at(-1)!==512)throw Error('BGE 输出类型或形状不匹配。');
      stats.outputType=out.type;stats.outputDimensions=out.dims;
      const vector=Array.from(out.data);if(!validEmbedding(vector))throw Error('BGE 输出不是有效的 512 维归一化向量。');
      stats.inferenceMs+=performance.now()-t;vectors[doc.cardId]=vector;stats.computed++;
      await cachePut('embeddings',{id,cardId:doc.cardId,config:BGE,vector,tokenCount,usedAt:Date.now()});
    }
    progress({phase:'embedding',completed:i+1,total:documents.length,hits:stats.hits});
  }
  stats.totalMs=performance.now()-start;return {vectors,stats,config:BGE};
}
