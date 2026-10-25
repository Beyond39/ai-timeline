// Test-only loader: ordinary checkouts use local Playwright. The optional
// runtime fallback preserves the original desktop development environment.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  try { playwright = createRequire(process.execPath)('../node_modules/playwright'); }
  catch { throw new Error('Browser tests need Playwright 1.62.1. From apps/navigator-extension run: npm install --no-save --package-lock=false playwright@1.62.1'); }
}
export const chromium = playwright.chromium;
export function browserExecutable(prefer = 'chrome') {
  if (process.env.OPC_TEST_BROWSER) return process.env.OPC_TEST_BROWSER;
  const candidates = process.platform === 'win32' ? [
    path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.PROGRAMFILES ?? '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Microsoft/Edge/Application/msedge.exe')
  ] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  if (prefer === 'edge' && process.platform === 'win32') candidates.unshift(candidates.pop());
  const installed = candidates.find(file => fs.existsSync(file));
  if (!installed) throw new Error('Set OPC_TEST_BROWSER to the absolute path of a compatible Chrome/Edge executable.');
  return installed;
}
