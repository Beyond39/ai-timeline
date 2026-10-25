export const nextDraftSequence = drafts => drafts.reduce((value, row) => Math.max(value,
  Number.isSafeInteger(row.sequence) ? row.sequence : 0), 0) + 1;

export function latestDraftRecord(drafts) {
  const time = row => Number.isFinite(Date.parse(row.createdAt)) ? Date.parse(row.createdAt) : 0;
  return drafts.slice().sort((a, b) => time(b) - time(a) || (b.sequence ?? 0) - (a.sequence ?? 0) ||
    String(b.id).localeCompare(String(a.id)))[0] ?? null;
}
