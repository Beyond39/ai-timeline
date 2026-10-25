import fs from 'node:fs';
import { runP0Scenarios } from '../validation/qa-p0-scenarios.mjs';
const report = await runP0Scenarios();
fs.mkdirSync('dist', { recursive: true }); fs.writeFileSync('dist/OPC_P0_REPORT.json', JSON.stringify({ ...report, checkedAt: new Date().toISOString() }, null, 2));
for (const r of report.results) console.log(`${r.passed ? 'PASS' : 'FAIL'} ${r.name}: ${r.actual}`);
process.exitCode = report.ok ? 0 : 1;
