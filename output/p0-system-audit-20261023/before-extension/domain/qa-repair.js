import { copy, id, now } from './common.js';
import { structuredText, visibility } from './qa-content.js';
import { migrateReleaseReferences } from './release-data.js';

// A pre-repair image is stored in the same transaction as the derived repair.
// Source versions/snapshots and ambiguous annotations are never deleted.
export function repairConversation(state, conversation, canonicalQuestions = new Map()) {
  state.qaRepairArchives ??= [];
  const legacy = state.qaCards.filter(c => c.conversationId === conversation.id && (c.projectionVersion !== 3 || canonicalQuestions.has(c.id)));
  const versions = new Map(state.versions.map(v => [v.id, v]));
  const messages = new Map(state.messages.filter(m => m.conversationId === conversation.id).map(m => [m.id, m]));
  const sourceImport = legacy.length && state.snapshots.some(s => s.conversationId === conversation.id && ['chatgpt-json-import', 'generic-json-import', 'chatgpt-data-v1'].includes(s.method));
  for (const m of messages.values()) {
    const raw = versions.get(m.currentVersionId)?.raw;
    if (!raw) continue;
    m.completion ??= { status: raw.status ?? null, endTurn: raw.end_turn ?? null, finishType: raw.metadata?.finish_details?.type ?? null, basis: 'source_message_fields' };
    m.channel ??= raw.channel ?? raw.metadata?.channel ?? null; m.recipient ??= raw.recipient ?? null;
    m.isAuxiliary ||= raw.metadata?.is_visually_hidden_from_conversation === true;
    if (sourceImport) {
      const source = typeof raw.text === 'string' ? raw.text : typeof raw.content === 'string' ? raw.content : raw.content?.parts;
      if (source != null) m.readingText = structuredText(source);
    }
    m.readingVisibility = visibility(m);
  }
  if (!legacy.length) return;
  const owned = new Set(legacy.map(c => c.id));
  const archive = { id: id('qaRepair'), projectId: conversation.projectId, conversationId: conversation.id, createdAt: now(),
    migration: 'qa-projection-2-to-3', reason: 'pre_repair_image', original: copy({
      qaCards: legacy, qaMetadata: state.qaMetadata.filter(m => owned.has(m.cardId)), memberships: state.memberships.filter(m => owned.has(m.cardId)),
      relationships: state.relationships.filter(r => owned.has(r.fromCardId) || owned.has(r.toCardId)), canvasLayouts: state.canvasLayouts.filter(l => l.projectId === conversation.projectId),
      qas: state.qas.filter(q => q.conversationId === conversation.id), segments: state.segments.filter(s => s.conversationId === conversation.id)
    }), mappings: [], unresolved: [] };
  state.qaRepairArchives.push(archive);
  for (const c of legacy) {
    // Older ad-hoc nodes sometimes embedded edits in their display record.
    // Do not treat an automatically generated title as a user edit.
    const edits = c.userMetadata ?? c.annotations ?? { notes: c.notes, tags: c.tags, title: c.userTitle };
    if (!state.qaMetadata.some(m => m.cardId === c.id) && (edits.notes || edits.title || edits.tags?.length)) state.qaMetadata.push({
      id: id('annotation'), projectId: c.projectId, cardId: c.id, title: String(edits.title ?? ''), notes: String(edits.notes ?? ''), tags: Array.isArray(edits.tags) ? edits.tags.map(String) : [], createdAt: now(), revision: 0
    });
  }
  const questionFor = c => {
    if (canonicalQuestions.has(c.id)) return canonicalQuestions.get(c.id);
    const direct = messages.get(c.userMessageId); if (direct?.role === 'user') return direct.id;
    const legacyQA = state.qas.find(q => q.id === c.qaId || q.id === c.id); if (messages.get(legacyQA?.userMessageId)?.role === 'user') return legacyQA.userMessageId;
    // Only verified ancestry. Never match a title or body string.
    let node = messages.get(c.userMessageId ?? c.messageId), seen = new Set();
    while (node && !seen.has(node.id)) { seen.add(node.id); if (node.role === 'user') return node.id; node = messages.get(node.parentMessageId); }
    return null;
  };
  const survivors = new Map();
  const rewrite = new Map();
  for (const c of legacy) {
    const questionId = questionFor(c);
    if (!questionId) { archive.unresolved.push(c.id); state.qaCards = state.qaCards.filter(row => row.id !== c.id); continue; }
    const existing = survivors.get(questionId) ?? state.qaCards.find(row => row.conversationId === conversation.id && !owned.has(row.id) && row.projectionVersion === 3 && row.userMessageId === questionId);
    if (existing) { rewrite.set(c.id, existing.id); state.qaCards = state.qaCards.filter(row => row.id !== c.id); }
    else {
      survivors.set(questionId, c); c.userMessageId = questionId; c.logicalUserMessageId = questionId; c.projectionVersion = 3;
      c.responseMessageIds = (c.responseMessageIds ?? []).filter(k => messages.has(k)); c.visibleAnswerIds = [];
      c.pathIds = (c.pathIds ?? []).filter(k => state.paths.some(p => p.id === k && p.conversationId === conversation.id));
      c.validity = { state: 'PENDING', reason: 'legacy_requires_source_confirmation' }; c.answerPreview = '';
      c.questionTime ??= { value: null, source: null, precision: 'unknown', reliability: 'unknown' };
    }
    archive.mappings.push({ from: c.id, to: existing?.id ?? c.id, basis: 'message_identity_or_verified_ancestry' });
  }
  for (const m of state.qaMetadata) if (rewrite.has(m.cardId)) m.cardId = rewrite.get(m.cardId);
  // Conflicting edits are retained in the archive, with explicit recovery IDs.
  const annotations = new Map();
  state.qaMetadata = state.qaMetadata.filter(m => {
    if (archive.unresolved.includes(m.cardId)) return false;
    const first = annotations.get(m.cardId); if (!first) { annotations.set(m.cardId, m); return true; }
    first.tags = [...new Set([...first.tags, ...m.tags])];
    if (m.notes && !first.notes.includes(m.notes)) first.notes = [first.notes, m.notes].filter(Boolean).join('\n\n');
    if (!first.title) first.title = m.title;
    if (first.title && m.title && first.title !== m.title) archive.unresolved.push(m.id);
    return false;
  });
  state.memberships = state.memberships.filter(m => !archive.unresolved.includes(m.cardId));
  const memberKeys = new Set();
  state.memberships = state.memberships.filter(m => { m.cardId = rewrite.get(m.cardId) ?? m.cardId; const key = `${m.timelineId}:${m.cardId}`; if (memberKeys.has(key)) return false; memberKeys.add(key); return true; });
  state.relationships = state.relationships.filter(r => {
    if (archive.unresolved.includes(r.fromCardId) || archive.unresolved.includes(r.toCardId)) return false;
    r.fromCardId = rewrite.get(r.fromCardId) ?? r.fromCardId; r.toCardId = rewrite.get(r.toCardId) ?? r.toCardId;
    if (r.fromCardId === r.toCardId) { archive.unresolved.push(r.id); return false; } return true;
  });
  for (const l of state.canvasLayouts) for (const key of Object.keys(l.positions ?? {})) {
    const to = rewrite.get(key); if (to) { l.positions[to] ??= l.positions[key]; delete l.positions[key]; }
    if (archive.unresolved.includes(key)) delete l.positions[key];
  }
  migrateReleaseReferences(state, rewrite, archive);
}
