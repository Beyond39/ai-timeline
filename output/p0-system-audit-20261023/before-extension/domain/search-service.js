import { searchText, queryTerms } from './card-search.js';
import { findTextMatches } from './search.js';

const stop = new Set('如何 怎么 什么 为什么 是否 一个 这个 那个 我们 可以 进行 使用 以及 相关 问题 内容 方法 设计 the and for with how what this that from your have does into using'.split(' '));
export function tokenize(value) {
  const text = searchText(value), terms = [];
  for (const match of text.matchAll(/[\p{Script=Han}]+|[\p{L}\p{N}][\p{L}\p{N}_+#.-]*/gu)) {
    const word = match[0];
    if (/\p{Script=Han}/u.test(word)) {
      for(const chunk of word.split(/如何|怎么|什么|为什么|是否|一个|这个|那个|我们|可以|进行|使用|以及|相关|问题|内容|方法|设计/u))for (const size of [2, 3]) for (let i = 0; i <= chunk.length - size; i++) {
        const part = chunk.slice(i, i + size); if (!stop.has(part)) terms.push(part);
      }
    } else if (word.length > 1 && !stop.has(word)) terms.push(word);
  }
  return terms;
}
const weights = { title: 8, question: 6, conversation: 5, notes: 5, tags: 4, reflection: 4, status: 2, answer: 1 };
const relatedWeights = { title: 5, question: 4, tags: 3, notes: 2, answer: .18 };
const frequencies = text => { const counts = new Map(); for (const t of tokenize(text)) counts.set(t, (counts.get(t) ?? 0) + 1); return counts; };

// Derived, disposable index. Postings carry field TF; source text is kept only
// for honest snippets and incremental comparison, never rewritten or persisted.
export class SearchService {
  constructor() { this.documents = new Map(); this.postings = new Map(); }
  removeCard(id) {
    const old = this.documents.get(id); if (!old) return;
    for (const term of old.terms.keys()) { const p = this.postings.get(term); p?.delete(id); if (!p?.size) this.postings.delete(term); }
    this.documents.delete(id);
  }
  updateCard(doc) {
    const old = this.documents.get(doc.id);
    const fields = Object.fromEntries(Object.keys(weights).map(k => [k, String(doc.fields?.[k] ?? '')]));
    const terms = new Map(), vectors = {};
    for (const [field, value] of Object.entries(fields)) {
      const counts = old?.fields[field] === value ? old.vectors[field] : frequencies(value); vectors[field] = counts;
      const length = [...counts.values()].reduce((a, b) => a + b, 0);
      for (const [term, tf] of counts) {
        const scores = terms.get(term) ?? { search: 0, related: 0 };
        scores.search += weights[field] * tf / (tf + 1.2 * (.7 + .3 * length / 80));
        scores.related += (relatedWeights[field] ?? 0) * (1 + Math.log(tf)); terms.set(term, scores);
      }
    }
    this.removeCard(doc.id);
    const normalized=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,old?.fields[k]===v?old.normalized[k]:searchText(v)]));
    const indexed = { ...doc, fields, vectors, terms, normalized }; this.documents.set(doc.id, indexed);
    for (const [term, scores] of terms) { const p = this.postings.get(term) ?? new Map(); p.set(doc.id, scores); this.postings.set(term, p); }
  }
  updateConversationMetadata(conversationId, values) {
    for (const doc of [...this.documents.values()]) if (doc.conversationId === conversationId) this.updateCard({ ...doc, ...values, fields: { ...doc.fields, conversation: values.searchText ?? doc.fields.conversation } });
  }
  async buildIndex(documents) {
    this.documents.clear(); this.postings.clear();
    for (let i = 0; i < documents.length; i++) { this.updateCard(documents[i]); if (i % 25 === 24) await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  idf(term) { return Math.log(1 + (this.documents.size + .5) / ((this.postings.get(term)?.size ?? 0) + .5)); }
  eligible(doc, args) {
    if (args.cardIds && !args.cardIds.includes(doc.id)) return false;
    if (doc.hidden || doc.state !== 'ACTIVE' || !doc.locatable) return false;
    if (args.projectId && doc.projectId !== args.projectId || args.conversationId && doc.conversationId !== args.conversationId || args.group && !(doc.groups ?? []).includes(args.group)) return false;
    if (args.favorite && !(doc.favorite || doc.conversationFavorite)) return false;
    const date = Number.isFinite(Date.parse(doc.time?.value)) ? new Intl.DateTimeFormat('sv-SE', { timeZone: args.timeZone ?? 'Asia/Shanghai' }).format(new Date(doc.time.value)) : null;
    return !((args.dateFrom || args.dateTo) && !date || args.dateFrom && date < args.dateFrom || args.dateTo && date > args.dateTo);
  }
  snippet(doc, query) {
    const needles = queryTerms(query), tokens = [...new Set(tokenize(query))];
    for(const fallback of [false,true])for (const field of ['title', 'question', 'notes', 'tags', 'status', 'reflection', 'answer', 'conversation']) {
      const text = doc.fields[field];
      let matches = needles.flatMap(t => findTextMatches(text, t, 8));
      if (!matches.length && fallback) matches = tokens.flatMap(t => findTextMatches(text, t, 2));
      if (!matches.length) continue;
      matches.sort((a, b) => a.start - b.start);
      const start = Math.max(0, matches[0].start - 45), end = Math.min(text.length, Math.max(start + 170, matches[0].end));
      const ranges = matches.filter(r => r.start >= start && r.end <= end).map(r => ({ start: r.start - start, end: r.end - start })).sort((a,b)=>a.start-b.start);
      const merged = []; for (const r of ranges) { const previous = merged.at(-1); if (previous && r.start <= previous.end) previous.end = Math.max(previous.end, r.end); else merged.push(r); }
      return { text: text.slice(start, end), ranges: merged, field, match: text.slice(matches[0].start, matches[0].end), offset: matches[0].start };
    }
    return { text: doc.fields.question.slice(0, 170), ranges: [], field: 'question', match: '', offset: 0 };
  }
  result(doc, score, query, includeSnippet=true) { return { id: doc.id, cardId: doc.id, projectId: doc.projectId, conversationId: doc.conversationId, title: doc.fields.title || doc.fields.question.slice(0, 120), sourceTitle: doc.sourceTitle, time: doc.time, score, snippet: includeSnippet ? this.snippet(doc, query) : null, type: 'Q&A' }; }
  search(args = {}) {
    const query = String(args.query ?? '').trim(), groups = queryTerms(query), terms = [...new Set(tokenize(query))];
    const candidates = new Set();
    for (const term of terms) for (const id of this.postings.get(term)?.keys() ?? []) candidates.add(id);
    // One-character queries are a bounded exceptional metadata/body lookup.
    if (!terms.length && query) for (const id of this.documents.keys()) candidates.add(id);
    const results = [];
    for (const id of candidates) {
      const doc = this.documents.get(id); if (!this.eligible(doc, args)) continue;
      const normalized = Object.values(doc.normalized);
      if (!groups.every(g => normalized.some(f => f.includes(g)) || (() => { const ts = [...new Set(tokenize(g))]; const hits = ts.filter(t => doc.terms.has(t)).length; return ts.length >= 3 && hits >= 2 && hits / ts.length >= .5 && ts.filter(t=>!/[\p{Script=Han}]/u.test(t)).every(t=>normalized.some(f=>f.includes(t))); })())) continue;
      let score = terms.reduce((n, t) => n + (doc.terms.get(t)?.search ?? 0) * this.idf(t), 0);
      for (const g of groups) for (const [field, value] of Object.entries(doc.fields)) if (doc.normalized[field].includes(g)) score += weights[field] * 3;
      results.push(this.result(doc, score, query, false));
    }
    results.sort((a, b) => (args.sort === 'time' ? (Date.parse(b.time?.value) || 0) - (Date.parse(a.time?.value) || 0) : b.score - a.score) || a.id.localeCompare(b.id));
    const type = args.type ?? 'all';
    let rows = type === 'qa' ? results : [...(type === 'conversation' ? [] : results)];
    if (type !== 'qa') {
      const byConversation = new Map();
      for (const result of results) { const doc = this.documents.get(result.id); if (groups.every(g => searchText(doc.fields.conversation).includes(g)) && !byConversation.has(doc.conversationId)) byConversation.set(doc.conversationId, { ...result, id: doc.conversationId, title: doc.sourceTitle, type: 'Conversation', snippet: null }); }
      rows = [...byConversation.values(), ...rows];
    }
    const offset = Math.max(0, Number(args.offset) || 0), limit = args.scoresOnly ? rows.length : Math.min(60, Math.max(1, Number(args.limit) || 30));
    return { results: rows.slice(offset, offset + limit).map(row=>{if(args.scoresOnly)return row;const doc=this.documents.get(row.cardId);return {...row,snippet:this.snippet(row.type==='Conversation'?{...doc,fields:{...doc.fields,title:'',question:'',answer:'',notes:'',tags:'',reflection:''}}:doc,query)};}), total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null, indexedCards: this.documents.size };
  }
  findRelated(cardId, limit = 3) {
    const source = this.documents.get(cardId); if (!source || !this.eligible(source, {})) return [];
    const primary = new Set(['title', 'question', 'tags', 'notes'].flatMap(k => [...source.vectors[k].keys()]));
    const terms = [...primary].sort((a, b) => this.idf(b) - this.idf(a)).slice(0, 80), candidates = new Set();
    for (const term of terms) for (const id of this.postings.get(term)?.keys() ?? []) if (id !== cardId) candidates.add(id);
    const norm = doc => Math.sqrt([...doc.terms].reduce((n, [t, s]) => n + (s.related * this.idf(t)) ** 2, 0));
    const sourceNorm = norm(source), ranked = [];
    for (const id of candidates) {
      const doc = this.documents.get(id); if (!this.eligible(doc, {})) continue;
      const otherPrimary = new Set(['title','question','tags','notes'].flatMap(k=>[...doc.vectors[k].keys()]));
      const shared = terms.filter(t => otherPrimary.has(t));
      // A lone general Chinese bigram cannot establish a meaningful topic.
      if (!shared.some(t => !/\p{Script=Han}/u.test(t) && t.length >= 3) && new Set(shared.filter(t=>t.length === 2).join('')).size < 4) continue;
      let dot = 0; for (const [term, scores] of source.terms) dot += scores.related * (doc.terms.get(term)?.related ?? 0) * this.idf(term) ** 2;
      const cosine = dot / (sourceNorm * norm(doc) || 1); if (cosine < .22) continue;
      ranked.push({ doc, score: cosine + (doc.conversationId !== source.conversationId ? .025 : 0), shared });
    }
    ranked.sort((a,b)=>b.score-a.score || (Date.parse(a.doc.time?.value)||Infinity)-(Date.parse(b.doc.time?.value)||Infinity) || a.doc.id.localeCompare(b.doc.id));
    const seen = new Set([searchText(source.fields.question)]), results = [];
    for (const {doc,score,shared} of ranked) { const fingerprint = searchText(doc.fields.question); if (seen.has(fingerprint)) continue; seen.add(fingerprint); results.push(this.result(doc,score,shared.slice(0,8).join(' '))); if (results.length >= Math.min(3,limit)) break; }
    return results;
  }
  stats() { return { documents: this.documents.size, terms: this.postings.size, postings: [...this.postings.values()].reduce((n,p)=>n+p.size,0), textBytes: new TextEncoder().encode([...this.documents.values()].map(d=>Object.values(d.fields).join('')).join('')).byteLength }; }
}
