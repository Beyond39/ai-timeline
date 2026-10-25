import { featureVectors } from './local-features.js';
import { readableTerms } from './tag-suggestions.js';

/** Provider contract: organize({cards:[{id,question,title,tags}]}) ->
 * {provider, parameters, topics:[{name,cardIds,representativeCardIds}], unclassifiedCardIds}.
 * IDs are authoritative; providers never produce answers, chronology or Canvas edges.
 * Future providers may implement this contract; none are loaded or contacted here.
 */
export class OrganizationProvider {
  organize() { throw new Error('OrganizationProvider.organize must be implemented'); }
}
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const dot = (a, b) => { let result = 0; for (const [term, weight] of a) result += weight * (b.get(term) ?? 0); return result; };
export class AlgorithmProvider extends OrganizationProvider {
  constructor({ threshold = .32, minGroupSize = 2, maxFeatures = 256 } = {}) {
    super();
    if (!(threshold > 0 && threshold <= 1) || !Number.isInteger(minGroupSize) || minGroupSize < 2 || !Number.isInteger(maxFeatures) || maxFeatures < 8) throw new Error('Invalid organization parameters');
    this.parameters = { threshold, minGroupSize, maxFeatures };
  }
  organize({ cards }) {
    const seen = new Set(), duplicates = [], rows = [];
    for (const card of [...cards].sort((a,b) => a.id.localeCompare(b.id))) {
      const key = normalize(card.question).replace(/[\p{P}\s]/gu, '');
      if (!key || card.hidden || card.valid === false) continue;
      if (seen.has(key)) { duplicates.push(card.id); continue; }
      seen.add(key); rows.push(card);
    }
    const {vectors} = featureVectors(rows,this.parameters.maxFeatures);
    // Deterministic leader clustering with complete-link admission. This avoids
    // transitive similarity chains forcing unrelated questions into one topic.
    const groups = [];
    for (let i=0; i<rows.length; i++) {
      let best = null, score = this.parameters.threshold;
      if (vectors[i].size) for (const group of groups) {
        const similarity = Math.min(...group.map(j=>dot(vectors[i],vectors[j])));
        if (similarity >= score) { best = group; score = similarity; }
      }
      if (best) best.push(i); else groups.push([i]);
    }
    const topics = [], unclassifiedCardIds = [];
    for (const group of groups) {
      if (group.length < this.parameters.minGroupSize || !vectors[group[0]].size) { unclassifiedCardIds.push(...group.map(i=>rows[i].id)); continue; }
      const representatives = [...group].sort((a,b)=>group.reduce((s,j)=>s+dot(vectors[b],vectors[j])-dot(vectors[a],vectors[j]),0) || rows[a].id.localeCompare(rows[b].id));
      const tags = new Map(); for (const i of group) for(const tag of new Set(rows[i].tags??[])) if(tag.trim()) tags.set(tag,(tags.get(tag)??0)+1);
      const tag = [...tags].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0];
      const terms = new Map(); for (const i of group) for(const [term,n] of vectors[i]) terms.set(term,(terms.get(term)??0)+n);
      const readable=new Set(group.flatMap(i=>readableTerms(rows[i].question+' '+rows[i].title+' '+(rows[i].tags??[]).join(' '))));
      const keywords = [...terms].filter(([t])=>readable.has(t)).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([t])=>t).filter((t,i,all)=>!all.slice(0,i).some(v=>v.includes(t))).slice(0,3);
      topics.push({ name: tag || keywords.join(' · ') || '待命名', keywords, cardIds: group.map(i=>rows[i].id), representativeCardIds: representatives.slice(0,3).map(i=>rows[i].id) });
    }
    return { provider: { id: 'algorithm', version: 1 }, parameters: this.parameters, topics, unclassifiedCardIds, duplicateCardIds: duplicates, analyzedCount: rows.length };
  }
}
