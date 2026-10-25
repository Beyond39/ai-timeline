import { el } from './dom.js';

// Shared directory presentation. Membership, edits and source IDs stay with
// their existing owners; summaries never become stored source text.
export function topicSummary({ name, count, manual, keywords = [], representative = '' }) {
  return el('summary', { class: 'topic-summary' }, [
    el('span', { class: 'topic-summary-heading' }, [
      el('strong', { text: name }),
      el('span', { class: 'topic-summary-count', text: `${count} 个问题` }),
      el('small', { class: 'topic-summary-status', text: manual ? '人工确认' : name === '未分类' ? '待整理' : '候选主题' }),
    ]),
    keywords.length ? el('span', { class: 'topic-summary-keywords', text: keywords.slice(0, 4).join(' · ') }) : null,
    representative ? el('span', { class: 'topic-summary-preview', text: `代表问题 · ${representative}` }) : null,
  ]);
}
