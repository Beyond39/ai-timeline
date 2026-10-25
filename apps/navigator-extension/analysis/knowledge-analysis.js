import { buildTfidf, keywords, sparseCosine, normalize, semanticInput } from './knowledge-text.js';
import { extractKeypoints } from './knowledge-keypoints.js';
import { validEmbedding } from './bge.js';
export const ENGINE_VERSION='knowledge-2';
function normalizedDot(a,b){let score=0;for(let i=0;i<a.length;i++)score+=a[i]*b[i];return Math.max(-1,Math.min(1,score));}
export function denseCosine(a,b) {
  if(!validEmbedding(a)||!validEmbedding(b))throw Error('Missing or corrupt BGE embedding');
  return normalizedDot(a,b);
}
export function hybridScore(lexical,semantic,alpha=.4) {
  if(![lexical,semantic,alpha].every(Number.isFinite)||alpha<0||alpha>1)throw Error('Invalid similarity parameters');
  return alpha*lexical+(1-alpha)*semantic;
}
export function analyzeKnowledge(documents,{mode='Lexical',embeddings={},alpha=.4,threshold=mode==='Semantic'?.7:mode==='Hybrid'?.45:.32,maxGroupSize=80}={},progress=()=>{}) {
  if(!['Lexical','Semantic','Hybrid'].includes(mode)||!(threshold>0&&threshold<=1)||!Number.isInteger(maxGroupSize)||maxGroupSize<2)throw Error('Invalid knowledge analysis parameters');
  const started=performance.now(),docs=[...new Map(documents.filter(d=>d.cardId&&!d.hidden&&d.valid!==false).map(d=>[d.cardId,d])).values()].sort((a,b)=>a.cardId.localeCompare(b.cardId));
  if(mode!=='Lexical'&&docs.some(d=>(semanticInput(d)||embeddings[d.cardId])&&!validEmbedding(embeddings[d.cardId])))throw Error('Semantic Unavailable');
  let t=performance.now();const {vectors}=buildTfidf(docs),tfidfMs=performance.now()-t;
  const features=docs.map((d,i)=>keywords(d,vectors[i]));t=performance.now();
  // Dense score matrix is O(n²), bounded to 2,000 cards by the UI service.
  const n=docs.length,matrix=new Float32Array(n*n),lexical=new Float32Array(n*n),semantic=mode==='Lexical'?null:new Float32Array(n*n);
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++) {
    // Vectors were validated once above. Rechecking all 512 dimensions for
    // every pair needlessly multiplied the matrix computation cost.
    const l=sparseCosine(vectors[i],vectors[j]),s=mode==='Lexical'?null:embeddings[docs[i].cardId]&&embeddings[docs[j].cardId]?normalizedDot(embeddings[docs[i].cardId],embeddings[docs[j].cardId]):0;
    const score=mode==='Lexical'?l:mode==='Semantic'?s:hybridScore(l,s,alpha);
    matrix[i*n+j]=matrix[j*n+i]=score;lexical[i*n+j]=lexical[j*n+i]=l;if(semantic)semantic[i*n+j]=semantic[j*n+i]=s;
  }
  const similarityMs=performance.now()-t;t=performance.now();
  const groups=[],duplicates=[],seen=new Set();
  for(let i=0;i<n;i++) {
    const q=normalize(docs[i].question).toLowerCase().replace(/[\p{P}\s]/gu,'');
    if(!q||!vectors[i].size&&mode==='Lexical'){duplicates.push(i);continue;}
    if(seen.has(q)){duplicates.push(i);continue;}seen.add(q);
    let best=null,bestScore=threshold;
    // Complete-link admission is intentionally stricter than connected components:
    // A~B and B~C cannot merge A and C unless A~C also meets the threshold.
    for(const group of groups)if(group.length<maxGroupSize) {
      const score=Math.min(...group.map(j=>matrix[i*n+j]));
      if(score>bestScore||score===bestScore&&!best){best=group;bestScore=score;}
    }
    if(best)best.push(i);else groups.push([i]);
  }
  const topics=[],unclassifiedCardIds=duplicates.map(i=>docs[i].cardId);
  for(const group of groups) {
    if(group.length<2){unclassifiedCardIds.push(...group.map(i=>docs[i].cardId));continue;}
    const terms=new Map();for(const i of group)for(const f of features[i])terms.set(f.term,(terms.get(f.term)??0)+f.score);
    const labelWeight=([term,score])=>score*(/[a-z]/iu.test(term)?1.15:1);
    const labelTerms=[...terms].sort((a,b)=>labelWeight(b)-labelWeight(a)||b[0].length-a[0].length||a[0].localeCompare(b[0])).slice(0,3).map(([term])=>term);
    const representatives=[...group].sort((a,b)=>group.reduce((s,j)=>s+matrix[b*n+j]-matrix[a*n+j],0)||docs[a].cardId.localeCompare(docs[b].cardId));
    topics.push({name:labelTerms.length?labelTerms.slice(0,2).join(' · ').slice(0,60):'待命名主题',keywords:labelTerms,cardIds:group.map(i=>docs[i].cardId),representativeCardIds:representatives.slice(0,3).map(i=>docs[i].cardId),reviewStatus:'pending'});
  }
  const clusterMs=performance.now()-t;t=performance.now();const cards={};
  for(let i=0;i<n;i++) {
    const related=docs.map((d,j)=>({cardId:d.cardId,conversationId:d.conversationId,sourceTitle:d.sourceMetadata?.title,score:matrix[i*n+j],lexical:lexical[i*n+j],semantic:semantic?.[i*n+j]??null,reason:mode==='Lexical'?'关键词相关':mode==='Semantic'?'语义相关':'混合推荐'})).filter((r,j)=>j!==i&&r.score>=(mode==='Lexical'?.08:mode==='Semantic'?.45:.28)).sort((a,b)=>b.score-a.score||a.cardId.localeCompare(b.cardId)).slice(0,5);
    cards[docs[i].cardId]={cardId:docs[i].cardId,sourceHash:docs[i].sourceHash,keywords:features[i],suggestedTags:features[i].map(f=>f.term),keypoints:extractKeypoints(docs[i]),related};
    if(i%25===0)progress({phase:'extract',completed:i,total:n});
  }
  return {version:ENGINE_VERSION,mode,parameters:{alpha,threshold,maxGroupSize},topics,unclassifiedCardIds,duplicateCardIds:duplicates.map(i=>docs[i].cardId),analyzedCount:n,cards,stats:{tfidfMs,similarityMs,clusterMs,extractionMs:performance.now()-t,totalMs:performance.now()-started,matrixBytes:matrix.byteLength+lexical.byteLength+(semantic?.byteLength??0)}};
}
