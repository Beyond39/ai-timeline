import { runV03StorageValidation, runV03Performance } from './performance-v03.js';
import { isolateValidationDatabase } from './isolated-db.js';
globalThis.__ACVN_VALIDATION_DATABASE = isolateValidationDatabase('v03-performance-final');
const result = document.querySelector('#result'), status = document.querySelector('#status'), buttons = [...document.querySelectorAll('button')];
const run = async task => {
  buttons.forEach(button => { button.disabled = true; }); result.textContent = '';
  try { const report = await task(message => { status.textContent = message; }); result.textContent = JSON.stringify(report, null, 2); status.textContent = report.failed ? `完成：${report.failed}项失败` : '完成：全部验证通过'; }
  catch (error) { status.textContent = '失败'; result.textContent = error.stack ?? error.message; }
  finally { buttons.forEach(button => { button.disabled = false; }); }
};
document.querySelector('#validate').addEventListener('click', () => run(runV03StorageValidation));
document.querySelector('#benchmark').addEventListener('click', () => run(runV03Performance));
