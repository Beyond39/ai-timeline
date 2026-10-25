import { bodyPreview } from './qa-content.js';

// Display only: never write these strings back to a message or annotation.
const comparable = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
const preview = (text, length) => bodyPreview(String(text ?? '').replace(/\$\$[^]*?\$\$|\\\[[^]*?\\\]|\\\([^]*?\\\)|\$[^$\n]+\$/g, '〔公式，详情阅读〕'), length);
function nearDuplicate(a,b) {
  if(Math.min(a.length,b.length)<12)return false;
  const grams = text => new Set(Array.from(text.slice(0,-1),(_,i)=>text.slice(i,i+2)));
  const left=grams(a),right=grams(b);let shared=0;for(const gram of left)if(right.has(gram))shared++;
  return 2*shared/(left.size+right.size)>=.86;
}
export function cardPresentation(card) {
  const question = preview(card.questionPreview, 140), custom = String(card.metadata?.title ?? '').trim();
  const title = custom || card.metadata?.autoTitle || question || '未命名问题', a = comparable(title), b = comparable(question);
  const repeated = a === b || Math.min(a.length, b.length) >= 12 && (a.startsWith(b) || b.startsWith(a)) || nearDuplicate(a,b);
  return { title, question: repeated ? '' : question, answer: preview(card.answerPreview, 180),
    sourceWarning: /\uFFFD/u.test([custom, card.questionPreview, card.answerPreview].join('')) };
}
