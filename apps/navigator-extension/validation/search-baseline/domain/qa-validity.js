// Evidence only: never infer completion or identity from wording, length or time.
export function completionEvidence(message) {
  const raw = message.raw ?? {}, status = message.completion?.status ?? raw.status ?? null;
  const endTurn = message.completion?.endTurn ?? raw.end_turn ?? null;
  const finish = message.completion?.finishType ?? raw.metadata?.finish_details?.type ?? null;
  return { status, endTurn, finishType: finish, basis: message.completion?.basis ?? (status != null || endTurn != null ? 'source_message_fields' : 'unavailable') };
}
export function evidenceState(message) {
  const e = completionEvidence(message);
  if (['cancelled', 'canceled', 'interrupted', 'failed', 'error', 'finished_cancelled', 'finished_with_error'].includes(e.status) || ['cancelled', 'canceled', 'error'].includes(e.finishType)) return 'invalid';
  if (['in_progress', 'pending', 'queued'].includes(e.status) || message.streaming === 'generating') return 'pending';
  if (['finished_successfully', 'complete', 'completed'].includes(e.status)) return 'complete';
  return 'unknown';
}
export function answerValidity(question, responses, parts) {
  if (evidenceState(question) === 'invalid') return { state: 'HIDDEN_INVALID', reason: 'question_cancelled_or_failed' };
  if (question.roleUnverified || evidenceState(question) === 'pending') return { state: 'PENDING', reason: 'question_unconfirmed' };
  if (question.contentStatus === 'body_unavailable') return { state: 'PENDING', reason: 'question_body_unavailable' };
  if (!String(question.text ?? '').trim() && !question.attachments?.length) return { state: 'HIDDEN_INVALID', reason: 'empty_question' };
  const assistantOrTool = responses.filter(m => ['assistant', 'tool', 'function'].includes(m.role) && !m.isAuxiliary);
  const last = assistantOrTool.at(-1);
  if (!last) return { state: 'PENDING', reason: 'answer_not_observed' };
  if (evidenceState(last) === 'invalid') return { state: 'HIDDEN_INVALID', reason: 'selected_answer_cancelled_or_failed' };
  if (evidenceState(last) === 'pending') return { state: 'PENDING', reason: 'selected_answer_generating' };
  if (last.contentStatus === 'body_unavailable') return { state: 'PENDING', reason: 'answer_body_unavailable' };
  if (!parts.length) return { state: last.role === 'assistant' && evidenceState(last) === 'complete' ? 'HIDDEN_INVALID' : 'PENDING', reason: 'no_readable_final_body' };
  if (last.role !== 'assistant' || parts.at(-1).id !== last.id) return { state: 'PENDING', reason: 'branch_ends_before_final_body' };
  if (parts.some(m => evidenceState(m) === 'invalid')) return { state: 'HIDDEN_INVALID', reason: 'cancelled_body' };
  if (parts.some(m => m.roleUnverified || evidenceState(m) !== 'complete' || m.contentStatus === 'body_unavailable')) return { state: 'PENDING', reason: 'completion_evidence_missing' };
  const terminal = completionEvidence(last);
  if (terminal.endTurn === false) return { state: 'PENDING', reason: 'turn_not_finished' };
  // Generic explicit complete/completed is accepted as supplied completion;
  // ChatGPT finished_successfully is a message status, not an end-of-turn flag.
  if (terminal.status === 'finished_successfully' && terminal.endTurn !== true) return { state: 'PENDING', reason: 'end_turn_evidence_missing' };
  return { state: 'ACTIVE', reason: 'source_confirmed_complete' };
}
