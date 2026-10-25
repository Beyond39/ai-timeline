import fs from 'node:fs';
import { analyzeKnowledge } from '../analysis/knowledge-analysis.js';
import { knowledgeFixtures } from '../validation/knowledge-fixtures.mjs';
const rows=[];
for(const count of [100,300,1000]) {
 const before=process.memoryUsage().heapUsed,result=analyzeKnowledge(knowledgeFixtures(count));
 const row={count,mode:result.mode,...result.stats,heapDeltaBytes:process.memoryUsage().heapUsed-before,topics:result.topics.length,unclassified:result.unclassifiedCardIds.length};rows.push(row);console.log(JSON.stringify(row));
}
fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/KNOWLEDGE_PERFORMANCE.json',JSON.stringify({runtime:process.version,scope:'Node synthetic lexical benchmark, not browser/semantic quality or peak RSS',rows},null,2));
