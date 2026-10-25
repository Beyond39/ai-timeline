import fs from 'node:fs';
import { analyzeKnowledge } from '../analysis/knowledge-analysis.js';
import { verifyFragment } from '../analysis/knowledge-keypoints.js';
import { knowledgeFixtures } from '../validation/knowledge-fixtures.mjs';
const documents=knowledgeFixtures(100),result=analyzeKnowledge(documents);
let fragments=0,verified=0;
for(const doc of documents)for(const point of result.cards[doc.cardId].keypoints){fragments++;if(verifyFragment(point,doc.answerSources))verified++;}
const rows=documents.slice(0,20).map(doc=>({cardId:doc.cardId,question:doc.question,suggestedTags:result.cards[doc.cardId].suggestedTags.join(' / '),humanRelevantCardIds:'',humanAcceptedTags:'',humanAcceptedFragmentOffsets:'',humanTopicReadable:'',humanMoveToTopic:'',reviewStatus:'pending'}));
const tsv=[Object.keys(rows[0]).join('\t'),...rows.map(row=>Object.values(row).map(v=>String(v).replace(/[\t\r\n]/g,' ')).join('\t'))].join('\n');
fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/KNOWLEDGE_HUMAN_REVIEW.tsv',tsv);
const report={scope:'Automatic exact source matching on synthetic data; human judgements NOT collected',fragments,verified,exactSourceMatchRate:fragments?verified/fragments:null,humanMetrics:{precisionAt5:null,recallAt5:null,tagAcceptance:null,keypointAcceptance:null,topicReadability:null},samples:documents.slice(0,3).map(doc=>({question:doc.question,tags:result.cards[doc.cardId].suggestedTags,point:result.cards[doc.cardId].keypoints[0]?.exactText})),topics:result.topics.map(t=>t.name)};
fs.writeFileSync('dist/KNOWLEDGE_QUALITY.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
