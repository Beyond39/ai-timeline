import { embedDocuments } from './bge.js';
import { analyzeKnowledge } from './knowledge-analysis.js';
import { pruneEmbeddings } from '../storage/knowledge-cache.js';
import { analyzeConversation } from './conversation-analysis.js';
self.onmessage=async({data})=>{
  const progress=p=>self.postMessage({progress:p});
  try {
    if(data.action==='conversation'){self.postMessage({result:analyzeConversation(data.documents)});return;}
    if(data.action!=='analyze'){const result=await embedDocuments(data.documents,progress);self.postMessage({result});return;}
    if(data.documents.length>2000)throw Error('首版单次最多分析 2000 张 Q/A，请缩小项目范围。');
    let embeddings={},embeddingStats=null,semanticError=null,mode=data.mode??'Lexical';
    if(mode!=='Lexical')try{const result=await embedDocuments(data.documents,progress);embeddings=result.vectors;embeddingStats=result.stats;if(data.documents.length&&!Object.keys(embeddings).length)throw Error('当前范围没有可编码的有效主题文本。');await pruneEmbeddings();}catch(e){semanticError=e.message;mode='Lexical';}
    const result=analyzeKnowledge(data.documents,{...data.parameters,mode,embeddings},progress);
    result.requestedMode=data.mode??'Lexical';result.semanticError=semanticError;result.embeddingStats=embeddingStats;
    if(semanticError)result.status='Semantic Unavailable';else result.status=mode;
    self.postMessage({result});
  }
  catch(error){self.postMessage({error:error.message});}
};
