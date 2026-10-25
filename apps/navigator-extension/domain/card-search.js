export const searchText = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
export const queryTerms = query => [...new Set(searchText(query).split(/\s+/).filter(Boolean))];

// Unicode substring matching supports Chinese without a native tokenizer.
// Each term must match; weights distinguish titles, Q, preview and full A.
export function cardSearchScore(card, metadata, question, answer, query) {
  const fields = [[metadata.title||metadata.autoTitle, 100], [question, 70], [card.questionPreview, 70], [card.answerPreview, 45],
    [answer, 20], [[metadata.topic, metadata.contentType, metadata.organizationStatus, metadata.adoptionStatus, ...(metadata.tags ?? []),...(metadata.autoTags??[])].join(' '), 30], [metadata.notes, 25], [metadata.reflectionText, 40]]
    .map(([text, weight]) => [searchText(text), weight]);
  let score = 0;
  for (const term of queryTerms(query)) {
    const weight = Math.max(0, ...fields.filter(([text]) => text.includes(term)).map(([, weight]) => weight));
    if (!weight) return 0;
    score += weight;
  }
  return score;
}
