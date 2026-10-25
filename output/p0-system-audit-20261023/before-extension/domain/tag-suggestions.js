import { featureVectors } from './local-features.js';
import { tokenize } from './search-service.js';
import { fail, now } from './common.js';
export const FEATURE_VERSION=1;
const noise=new Set('app connector 请问 请你 帮我 给我 一下 谢谢 你好 这次 需要 希望 然后 现在 这里 这样 那样 帮忙 详细 解释 回答 继续 处理 任务 实现 怎么样 能不能 想要 告诉 能够 一些 还有 这些 那些 上面 下面 以上 其中 我想 请帮 可以 能不 不要 请给 关于 说明 如何 怎么 什么 为什么 是否 一个 这个 那个 我们 进行 使用 以及 相关 问题 内容 方法 设计 完整 真实 测试 example const return function true false let var the and for with how what this that from your have does into using'.split(' '));
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('zh',{granularity:'word'}):null;
const words=text=>segmenter?[...[...segmenter.segment(featureText(text).toLowerCase().slice(0,6000))].filter(s=>s.isWordLike&&s.segment.length>=2).map(s=>s.segment),...tokenize(featureText(text)).filter(t=>/^[a-z][a-z0-9_+#.-]+$/i.test(t))]:tokenize(featureText(text));
export const readableTerms=text=>words(text).filter(t=>!noise.has(t)&&t.length<=28);
export const featureSourceKey=card=>JSON.stringify([card.questionVersionId??null,card.answerVersionIds??{},card.visibleAnswerIds??[],card.validity?.state]);
export function featureText(value){return String(value??'').normalize('NFKC').replace(/\$app\b/gu,' ').replace(/请帮我|请问|请你|帮我|给我|一下|谢谢|你好|能不能|怎么样|我想要|我想|告诉我|能否|需要|希望|然后|现在/gu,' ').replace(/\s+/g,' ').trim();}
export function suggestTags(cards){
  const fields=c=>[[featureText(c.question),3],[featureText(c.answer).slice(0,3000),.6],[featureText(c.title),2],[(c.tags??[]).map(featureText).join(' '),4]];
  const {ranked,counts,df}=featureVectors(cards,256,fields,text=>[...tokenize(text),...words(text)]);
  return cards.map((card,i)=>{
    const explicit=new Set((card.tags??[]).map(t=>t.normalize('NFKC').toLowerCase()));
    const readable=new Set(fields(card).flatMap(([text])=>words(text)));
    const ordered=ranked[i].filter(([term])=>readable.has(term)&&!noise.has(term)&&!/^\d+(?:\.\d+)?$/.test(term)&&term.length<=28&&!/^[._+-]+$/.test(term))
      .map(([term,score])=>({term,score:score*(/^[\p{Script=Han}]{3}$/u.test(term)?1.25:1)+(explicit.has(term)?4:0),tf:counts[i].get(term),df:df.get(term)}))
      .sort((a,b)=>b.score-a.score||b.term.length-a.term.length||a.term.localeCompare(b.term));
    const selected=[...new Set(card.tags??[])].filter(t=>t.trim()&&t.length<=28&&!noise.has(t.toLowerCase())).slice(0,5).map(term=>({term,score:4,tf:counts[i].get(term.toLowerCase())??0,df:df.get(term.toLowerCase())??0,manualPriority:true}));
    for(const f of ordered){if(selected.length>=5)break;if(selected.some(s=>s.term.toLowerCase().includes(f.term)||f.term.includes(s.term.toLowerCase())))continue;selected.push(f);}
    // This is an extractive keyword title, never a claimed natural-language summary.
    const tags=selected.map(f=>f.term),title=tags.length>=2?tags.slice(0,3).join(' · '):'待命名';
    return {cardId:card.id,conversationId:card.conversationId,version:FEATURE_VERSION,sourceKey:card.sourceKey,title,tags,topicCandidate:tags.length>=2?tags.slice(0,2).join(' / '):null,features:selected,method:'local-tfidf-ngram',status:'pending',sourceMarkers:/\$app\b/u.test(card.question??'')?['source_contains_$app']:[]};
  });
}
export function reviewSuggestion(metadata,args){
  const suggestion=metadata.localSuggestion;
  if(args.operation==='clear'){metadata.autoTitle='';metadata.autoTags=[];metadata.autoProvenance=null;if(suggestion)suggestion.status='rejected';}
  else if(!suggestion||suggestion.version!==FEATURE_VERSION||suggestion.sourceKey!==args.sourceKey)fail('来源或算法已变化，请重新本地分析。');
  else if(args.operation==='reject')suggestion.status='rejected';
  else if(args.operation==='accept'||args.operation==='edit'){
    const title=String(args.title??suggestion.title).trim(),tags=args.tags??suggestion.tags;
    if(title.length>80||!Array.isArray(tags)||tags.length>5||tags.some(t=>typeof t!=='string'||t.trim().length>28))fail('候选标题最多80字，标签最多5个且各不超过28字。');
    suggestion.title=title;suggestion.tags=[...new Set(tags.map(t=>t.trim()).filter(Boolean))];
    if(args.operation==='accept'){metadata.autoTitle=title==='待命名'?'':title;metadata.autoTags=[...suggestion.tags];metadata.autoProvenance={version:suggestion.version,method:suggestion.method,sourceKey:suggestion.sourceKey};suggestion.status='accepted';}
    else suggestion.status='edited';
  }else if(args.operation!=='clear')fail('未知的候选审核操作。');
  metadata.updatedAt=now();metadata.revision=(metadata.revision??0)+1;return metadata;
}
