import { copy, fail, now } from './common.js';

// Reading labels never replace a source role or create inferred Q/A turns.
export function applyCaptureLabels(input, labels = {}) {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) fail('正文标注格式无效。');
  const result = copy(input), messages = new Map(result.messages.map(message => [message.key, message]));
  for (const [key, role] of Object.entries(labels)) {
    const message = messages.get(key);
    if (!message || !message.roleUnverified || message.role !== 'unknown') fail('只允许标注本次采集且角色未确认的正文片段。');
    if (!['unknown', 'user', 'assistant', 'tool'].includes(role)) fail('请选择有效的正文说话人标注。');
    message.confirmedRole = role;
    message.confirmedRoleAt = now();
    message.confirmedRoleBasis = 'user_preview_label';
  }
  return result;
}
