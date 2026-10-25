import fs from 'node:fs';
import {analyzeConversation,assertStageCoverage} from '../analysis/conversation-analysis.js';
import {conversationDocs} from '../validation/hybrid-fixtures.mjs';
const results=[];
for(const count of [1000,5000]){
  const documents=conversationDocs(Array.from({length:count},(_,i)=>[`Python 切片列表边界示例 ${i+1}`,`Python 切片不修改原始列表。这是明确标记的合成性能样例 ${i+1}。`])),start=performance.now(),memory=process.memoryUsage().heapUsed;
  const result=analyzeConversation(documents);assertStageCoverage(result.stages,documents);
  results.push({count,elapsedMs:Math.round(performance.now()-start),heapDeltaBytes:process.memoryUsage().heapUsed-memory,stages:result.stages.length,items:result.items.length});
}
const report={scope:'Node synthetic offline Conversation engine only; not browser paint timings or independent semantic quality',node:process.version,results};fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/HYBRID_PERFORMANCE.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
