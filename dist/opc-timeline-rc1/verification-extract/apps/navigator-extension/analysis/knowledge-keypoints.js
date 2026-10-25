import { buildTfidf, sparseCosine, phrases } from './knowledge-text.js';
export const EXTRACTION_VERSION='extractive-mmr-1';

// Offsets always refer to the unchanged version.text string (UTF-16 units).
export function markdownBlocks(text) {
  const lines=[...text.matchAll(/[^\n]*(?:\n|$)/g)].filter(m=>m[0]);
  const blocks=[];let i=0,heading='';
  while(i<lines.length) {
    const line=lines[i],trim=line[0].trim();
    if(!trim){i++;continue;}
    if(/^#{1,6}\s/u.test(trim)){heading=trim.replace(/^#+\s*/u,'');i++;continue;}
    const fence=trim.match(/^(`{3,}|~{3,})/u),math=/^(?:\$\$|\\\[)/u.test(trim);
    if(fence||math) {
      const marker=fence?.[1],end=math?(trim.startsWith('$$')?'$$':'\\]'):marker;
      if(!(math&&trim.length>end.length&&trim.endsWith(end))) {i++;while(i<lines.length&&!lines[i][0].trim().startsWith(end))i++;}
      i++;continue;
    }
    const start=line.index,list=/^\s*(?:[-*+]|\d+[.)])\s/u.test(line[0]),quote=/^\s*>/u.test(line[0]);
    i++;
    while(i<lines.length&&lines[i][0].trim()&&!/^\s*(?:#{1,6}\s|`{3,}|~{3,}|\$\$|\\\[)/u.test(lines[i][0])) {
      if(list&&/^\s*(?:[-*+]|\d+[.)])\s/u.test(lines[i][0]))break;
      if(!list&&/^\s*(?:[-*+]|\d+[.)])\s/u.test(lines[i][0]))break;
      if(quote!==/^\s*>/u.test(lines[i][0]))break;
      i++;
    }
    let end=lines[i-1].index+lines[i-1][0].replace(/\r?\n$/u,'').length;
    const exactText=text.slice(start,end);
    blocks.push({start,end,exactText,heading,kind:quote?'quote':list?'list':'paragraph'});
  }
  return blocks;
}
export function extractKeypoints(doc,{lambda=.72,maxPoints=4,minScore=.14}={}) {
  if(!(lambda>=0&&lambda<=1))throw new Error('Invalid MMR lambda');
  const candidates=[];
  for(const source of doc.answerSources??[])for(const block of markdownBlocks(source.text)) {
    const t=block.exactText;
    if(t.length<14||t.length>1800||block.kind==='quote'||/\|.*\||```|~~~|\$\$|\\\[|\\\]/u.test(t)||/假设|反例|错误示例|反面|仅供举例/u.test(t+' '+block.heading))continue;
    // Inline formula delimiters must be balanced; never normalize these offsets.
    if((t.match(/(?<!\\)\$/g)??[]).length%2)continue;
    if((t.match(/\\\(/g)??[]).length!==(t.match(/\\\)/g)??[]).length||(t.match(/(?<!\\)`/g)??[]).length%2)continue;
    if(/^(?:[-*+\d.)\s]*)(?:好的|当然|谢谢|希望以上|下面我|让我|你好)/u.test(t))continue;
    candidates.push({...block,cardId:doc.cardId,sourceType:'answer-version',messageId:source.messageId,versionId:source.versionId,methodVersion:EXTRACTION_VERSION,reviewStatus:'pending',context: block.heading||null,interpretation:'原文摘录，待核对上下文'});
  }
  if(!candidates.length)return [];
  const rows=[{question:doc.question},...candidates.map(c=>({question:c.exactText}))];
  const {vectors}=buildTfidf(rows),query=vectors[0];
  const scored=candidates.map((c,i)=>({fragment:c,vector:vectors[i+1],score:.55*sparseCosine(query,vectors[i+1])+.25*Math.min(1,phrases(c.exactText).length/8)+.2*Math.min(1,c.exactText.length/100)}));
  const selected=[];
  while(selected.length<maxPoints&&scored.length) {
    const ranked=scored.map(row=>({...row,mmr:lambda*row.score-(1-lambda)*Math.max(0,...selected.map(s=>sparseCosine(s.vector,row.vector)))})).sort((a,b)=>b.mmr-a.mmr||a.fragment.start-b.fragment.start||String(a.fragment.versionId).localeCompare(String(b.fragment.versionId)));
    const best=ranked[0];if(best.mmr<minScore)break;
    scored.splice(scored.findIndex(r=>r.fragment===best.fragment),1);
    if(selected.some(s=>s.fragment.exactText===best.fragment.exactText))continue;
    selected.push(best);
  }
  return selected.map(({fragment,score,mmr})=>({...fragment,score,mmr}));
}
export function verifyFragment(fragment,sources) {
  const source=sources.find(s=>s.versionId===fragment.versionId&&s.messageId===fragment.messageId);
  return Boolean(source&&Number.isInteger(fragment.start)&&fragment.start>=0&&Number.isInteger(fragment.end)&&fragment.end>fragment.start&&source.text.slice(fragment.start,fragment.end)===fragment.exactText);
}
