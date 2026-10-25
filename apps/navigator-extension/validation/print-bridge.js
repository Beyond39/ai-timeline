// Validation only. The actual print UI reads the same isolated DB as its builder.
import { command } from '../storage/repository.js';
import { isolateValidationDatabase } from './isolated-db.js';
const namespace = new URLSearchParams(location.search).get('validationDb');
if (!namespace || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('打印验证需要明确隔离的本地资料库。');
isolateValidationDatabase(namespace);
globalThis.chrome = { runtime: { async sendMessage({ type, args }) { try { return { ok: true, data: await command(type, args) }; } catch (error) { return { ok: false, error: error.message }; } } } };
await import('../ui/print.js');
