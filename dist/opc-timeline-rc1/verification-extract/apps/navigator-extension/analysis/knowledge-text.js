import { tokenize } from '../domain/search-service.js';

export const PREPROCESSING_VERSION = 'knowledge-input-2';
export const normalize = text => (typeof text==='string'?text:'').normalize('NFKC').replace(/\s+/gu, ' ').trim();
const key = text => normalize(text).toLowerCase();
const noise = new Set('你好 谢谢 好的 明白 继续 可以 需要 希望 然后 现在 这里 这样 那样 一下 请问 为什么 如何 怎么 什么 是否 能不能 这个 那个 我们 问题 回答 内容 方法 说明 解释 总结 因此 例如 比如 假设 如果 不是 不要 不能 不应 一定 可能 应该 存在 the and for with how what this that from your have does into using example const return function true false let var'.split(' '));
for(const word of 'app connector 保持 配合 进行 形成 采用 作用 出现 造成 导致 过程 部分 方面 方式 通过 用于 以及 实在 觉得 东西 是不是 案例'.split(' '))noise.add(word);
for(const word of '仅仅 而言 就是 其实 只是 但是 所以 对于 来说 已经 还是 这种 那种 这些 那些 你的 我的 我想 请你 帮我 告诉 详细 解释 使用 实现 处理 支持 完成 首先 接着 最后 目前 really just only please explain use want need would could should also about'.split(' '))noise.add(word);
for(const word of '讨论 话题 换个 另外 另一个 接下来 比较 展开 继续解释'.split(' '))noise.add(word);
const domainTerms='中文关键词提取 关键词提取 多项目时间线 时间线缩放 节点点击 结构化知识总结 分层总结 原文证据 阶段划分 浅拷贝 深拷贝 字典推导式 向量检索 状态同步'.split(' ');
const domainKeys=new Set(domainTerms.map(key));
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('zh',{granularity:'word'}):null;
const technical=/\b(?:Chrome\s+Extension|Service\s+Worker|JSON\s+Schema|Context\s+Pack|LLM\s+API|Structured\s+Outputs|React\s+Native|Node\.js|C\+\+|C#|TF-IDF|GPT(?:-\d[\w.-]*)?|RAG|Python|React|IndexedDB|TypeScript|PostgreSQL)\b/giu;
const canonical=t=>key(t).replace(/chrome\s*extension/gu,'chrome extension').replace(/\b(?:gpt|llm)\s+api\b/gu,'llm api');
function chinesePhrases(source) {
  if(!segmenter)return [];
  const result=[];let phrase='',end=-1;
  const flush=()=>{if(phrase.length>=2)result.push(phrase);phrase='';};
  for(const part of segmenter.segment(source)) {
    const t=part.segment;
    if(!part.isWordLike||!/^[\p{Script=Han}]+$/u.test(t)||noise.has(key(t))||/^[与和的了在把将及或而为对从是也都更很又]$/u.test(t)){flush();end=-1;continue;}
    if(t.length===1&&!/^[性化型器库率度值层端包集轴组态]$/u.test(t)){flush();end=-1;continue;}
    if(part.index!==end||phrase.length+t.length>8)flush();
    phrase+=t;end=part.index+t.length;
  }
  flush();return result;
}

// Statistical n-grams are internal features. Display phrases must be attested
// word segments or technical identifiers, never arbitrary character windows.
export function phrases(text) {
  const source = normalize(text).replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|\$\$[\s\S]*?(?:\$\$|$)|\$[^$\n]*\$/gu, ' ');
  const identifiers = [...source.matchAll(/[A-Za-z][A-Za-z0-9_]*(?:\+\+|#|(?:[.-][A-Za-z0-9]+)+)?/gu)].map(m => m[0]);
  const compounds=chinesePhrases(source),words=segmenter?[...segmenter.segment(source)].filter(s=>s.isWordLike&&s.segment.length>1&&!noise.has(key(s.segment))).map(s=>s.segment):[];
  // Preserve attested mixed-language noun phrases. Stop at verbs, particles and
  // punctuation; never turn internal Chinese search n-grams into display terms.
  const mixed=[...source.matchAll(/(?:[A-Za-z][\w.+#-]*(?:\s+(?:API|Extension))?\s*)[\p{Script=Han}]{2,14}/gu)].map(m=>m[0].split(/如何|怎么|为什么|是否|使用|进行|就是|仅仅|而言|可以|应该|采用|实现|处理|需要|支持|是什么|的|与|和/u)[0].trim()).filter(t=>/[\p{Script=Han}]{2}/u.test(t));
  const protectedTerms=domainTerms.filter(t=>source.includes(t)).concat([...source.matchAll(technical)].map(m=>m[0]).filter(t=>/\s/u.test(t)));
  const candidates = protectedTerms.concat([...source.matchAll(technical)].map(m=>m[0]),mixed,identifiers,compounds,words.filter(t=>!compounds.some(p=>p.length>t.length&&p.includes(t)))).filter(t=>!protectedTerms.some(p=>p!==t&&p.includes(t)));
  const unique=new Map();
  for(const t of candidates)if(!unique.has(key(t))&&!noise.has(key(t))&&t.length>=2&&t.length<=28&&!/^\d|^[._+-]+$|\uFFFD/u.test(t)&&key(source).includes(key(t)))unique.set(key(t),source.slice(key(source).indexOf(key(t)),key(source).indexOf(key(t))+t.length));
  return [...unique.values()];
}
export function themeFields(doc) {
  const question = normalize(doc.question), title = normalize(doc.customTitle);
  return [[question, 3], [key(title) === key(question) ? '' : title, 2], [(doc.manualTags ?? []).join(' '), 4]];
}
export function semanticInput(doc) { return themeFields(doc).map(([text])=>text).filter(Boolean).join('\n'); }
export function buildTfidf(documents, fields = themeFields) {
  const df = new Map();
  const counts = documents.map(doc => {
    const tf = new Map();
    for (const [text, weight] of fields(doc)) for (const term of [...tokenize(normalize(text)), ...phrases(text).map(key)]) tf.set(term, (tf.get(term) ?? 0) + weight);
    for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    return tf;
  });
  const vectors = counts.map(tf => {
    const weights = [...tf].map(([term, n])=>[term, Math.log1p(n) * (Math.log((documents.length + 1) / (df.get(term) + 1)) + 1)]);
    const norm = Math.sqrt(weights.reduce((sum, [,v])=>sum+v*v,0)) || 1;
    return new Map(weights.map(([term,v])=>[term,v/norm]));
  });
  return { vectors, counts, df };
}
export function sparseCosine(a, b) {
  if (a.size > b.size) return sparseCosine(b, a);
  let score = 0; for (const [term, value] of a) score += value * (b.get(term) ?? 0);
  return Math.max(0, Math.min(1, score));
}
export function keywords(doc, vector, limit = 5) {
  const q = themeFields(doc).map(([text])=>text).join(' '), primary = phrases(q);
  // Answer terms help explain keywords but cannot dominate the question's topic.
  const manual=(Array.isArray(doc.manualTags)?doc.manualTags:[]).filter(t=>typeof t==='string'&&normalize(t));
  const candidates = [...new Set([...manual,...(primary.length ? primary : phrases(doc.answer ?? '').slice(0, 60))])];
  const ranked = candidates.map(term => {
    const parts = [...new Set(tokenize(term))];
    const phraseBoost=1+Math.min(.55,Math.max(0,term.length-2)*.06)+(domainKeys.has(key(term))?.35:0);
    const field=normalize(doc.question).toLowerCase().includes(key(term))?'question':manual.some(t=>key(t)===key(term))?'manualTags':'answer';
    return { term, score: (manual.some(t=>key(t)===key(term))?3:0)+phraseBoost*((vector.get(key(term)) ?? 0) + parts.reduce((s,t)=>s+(vector.get(t)??0),0) / Math.max(1,parts.length)), source:{cardId:doc.cardId??doc.id,field,excerpt:term} };
  }).filter(r=>r.score>0&&!noise.has(key(r.term))).sort((a,b)=>b.score-a.score||b.term.length-a.term.length||a.term.localeCompare(b.term));
  const selected=[];
  for(const row of ranked) {
    if(selected.some(r=>canonical(r.term).includes(canonical(row.term))||canonical(row.term).includes(canonical(r.term))))continue;
    selected.push(row); if(selected.length===limit)break;
  }
  return selected;
}
