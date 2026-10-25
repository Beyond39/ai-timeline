const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });
// Uppercase avoids context-dependent lowercase mappings (for example Greek sigma).
export const normalizeForSearch = value => String(value ?? '').normalize('NFKC').toUpperCase();

export function findTextMatches(value, query, limit = 300) {
  const original = String(value ?? ''), needle = normalizeForSearch(query);
  if (!needle.trim()) return [];
  const normalized = normalizeForSearch(original), hits = [];
  for (let offset = 0; hits.length < limit;) {
    const start = normalized.indexOf(needle, offset); if (start < 0) break;
    hits.push({ normalizedStart: start, normalizedEnd: start + needle.length, start: -1, end: -1 });
    offset = start + needle.length;
  }
  if (!hits.length) return [];
  let cursor = 0, hitIndex = 0;
  for (const { segment, index } of graphemes.segment(original)) {
    const end = cursor + normalizeForSearch(segment).length;
    while (hitIndex < hits.length && hits[hitIndex].normalizedStart < end) {
      const hit = hits[hitIndex]; if (hit.start < 0) hit.start = index;
      if (hit.normalizedEnd > end) break;
      hit.end = index + segment.length; hitIndex++;
    }
    cursor = end; if (hitIndex === hits.length) break;
  }
  const ranges = [];
  for (const hit of hits) {
    if (hit.start < 0 || hit.end < 0) continue;
    const prior = ranges.at(-1);
    if (prior && prior.end >= hit.start) prior.end = Math.max(prior.end, hit.end);
    else ranges.push({ start: hit.start, end: hit.end });
  }
  return ranges;
}
