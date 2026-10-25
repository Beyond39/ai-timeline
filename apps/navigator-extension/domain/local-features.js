import { tokenize } from './search-service.js';

// Shared TF-IDF implementation used by Workspace grouping and Q/A suggestions.
export function featureVectors(cards, maxFeatures = 256, fields = card => [[card.question,3],[card.title,2],[(card.tags??[]).join(' '),4]], terms = tokenize) {
  const df=new Map();
  const counts=cards.map(card=>{
    const tf=new Map();
    for(const [text,weight] of fields(card))for(const term of terms(String(text??'').normalize('NFKC').toLowerCase().slice(0,6000)))tf.set(term,(tf.get(term)??0)+weight);
    for(const term of tf.keys())df.set(term,(df.get(term)??0)+1);
    return tf;
  });
  const ranked=counts.map(tf=>[...tf].map(([term,n])=>[term,(1+Math.log(n))*Math.log(1+cards.length/df.get(term))]).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,maxFeatures));
  const vectors=ranked.map(weights=>{const norm=Math.hypot(...weights.map(([,n])=>n))||1;return new Map(weights.map(([term,n])=>[term,n/norm]));});
  return {counts,df,ranked,vectors};
}
