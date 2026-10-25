export const SCHEMA_VERSION = 3;
export const EXTENSION_VERSION = '1.5.1';
export const CAPTURE_ADAPTER_VERSION = 'chatgpt-dom-v7';
export const now = () => new Date().toISOString();
export const id = prefix => `${prefix}_${crypto.randomUUID()}`;
export const copy = value => structuredClone(value);
export const short = (value, length = 65) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
export const normalizeName = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function sourceTime(value, source = null, precision = 'message') {
  if (value === null || value === undefined || value === '') return { value: null, precision: 'unknown', source: null };
  const date = new Date(typeof value === 'number' ? value * (Math.abs(value) < 1e12 ? 1000 : 1) : value);
  if (!Number.isFinite(date.getTime())) return { value: null, precision: 'unknown', source, raw: value };
  return { value: date.toISOString(), precision: /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? 'date_only' : precision, source, raw: value };
}
export function safeURL(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function fail(message) { throw new Error(message); }
export const TOPICS = [['产品', '#2563eb'], ['记忆', '#7c3aed'], ['界面', '#0891b2'], ['工程', '#d97706'], ['研究', '#15803d'], ['智能体', '#db2777']];
export const PALETTE = ['#2563eb', '#7c3aed', '#0891b2', '#d97706', '#15803d', '#db2777', '#4f46e5', '#b45309'];
