// Real Chrome extension UI, a fresh profile and synthetic sources only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.execPath)('../node_modules/playwright');
const extension = path.resolve('.');
const output = path.resolve('dist/premium-ui');
fs.mkdirSync(output, { recursive: true });
const report = { checks: [], errors: [], scope: 'Real Chrome MV3, fresh profile, synthetic Q/A. No user browser data or live ChatGPT capture.' };
let context, page;
const check = async (name, run) => { await run(); report.checks.push({ name, passed: true }); console.log('PASS ' + name); };
const rpc = (type, args = {}) => page.evaluate(async ({ type, args }) => {
  const result = await chrome.runtime.sendMessage({ type, args });
  if (!result?.ok) throw Error(result?.error || 'No response');
  return result.data;
}, { type, args });
const shot = name => page.screenshot({ path: path.join(output, name + '.png') });
const contained = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
try {
  context = await chromium.launchPersistentContext(path.join(output, 'profile-' + Date.now()), {
    executablePath: process.env.OPC_TEST_BROWSER ?? 'C:/Users/CZGCw/AppData/Local/Google/Chrome/Application/chrome.exe',
    headless: true, viewport: { width: 1440, height: 1000 },
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--remote-debugging-port=0', '--enable-unsafe-extension-debugging'],
  });
  report.browser = context.browser().version();
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
  await cdp.detach();
  const origin = 'chrome-extension://' + id;
  page = await context.newPage();page.setDefaultTimeout(12000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(origin + '/validation/interaction-browser.html?validationDb=v04-interaction-premium');
  await page.waitForFunction(() => globalThis.interactionTest);
  const seed = await page.evaluate(() => interactionTest.seed());
  const originalSources = await page.evaluate(async () => {
    const s = await interactionTest.readState();return JSON.stringify([s.messages, s.versions, s.relationships, s.canvasLayouts]);
  });
  await page.goto(origin + '/workspace.html?projectId=' + seed.projectIds[0]);
  await page.locator('.ht-point').first().waitFor();
  if(!await page.locator('#project-workspace-button').isVisible())await page.locator('#library-toggle').click();
  await check('Primary navigation, one project overview entry and real Q/A reader', async () => {
    assert.equal(await page.getByRole('button', { name: '项目概览', exact: true }).count(), 1);
    await page.locator('#topics-view-button').waitFor();
    await shot('timeline');
    await page.locator('.ht-point').first().click();await page.locator('.opc-reading-body').waitFor();
    assert((await page.locator('.opc-reading-body').innerText()).includes('ANSWER-TAIL'));
    await shot('reader');await page.locator('.close-detail').click();
  });
  await check('Overview counts, collapsed directory, topic editing and selection actions', async () => {
    await page.locator('#project-workspace-button').click();
    await page.getByLabel('选择 Workspace', { exact: true }).selectOption(seed.workspaceId);
    await page.locator('.workspace-overview').waitFor();
    assert.deepEqual(await page.locator('.workspace-overview-stats dd').allTextContents(), ['2','12','0']);
    assert.equal(await page.locator('.project-workspace-dialog .workspace-topic[open]').count(), 0);
    assert(!await page.locator('.workspace-selection').isVisible());
    await page.locator('.workspace-organize>summary').click();
    await page.getByRole('button', { name: '新建主题', exact: true }).click();
    await page.getByLabel('主题名称', { exact: true }).fill('交互设计 · Interaction Design');
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await page.locator('.topic-summary-heading strong').filter({hasText:'交互设计 · Interaction Design'}).waitFor();
    const unclassified = page.locator('[data-topic-id=""]');
    await unclassified.locator('summary').click();
    await unclassified.locator('input[type=checkbox]').first().check();
    assert(await page.locator('.workspace-selection').isVisible());
    const topic = await page.getByLabel('移动到主题', { exact: true }).locator('option').last().getAttribute('value');
    await page.getByLabel('移动到主题', { exact: true }).selectOption(topic);
    await page.getByRole('button', { name: '移动所选', exact: true }).click();
    const group = page.locator(`[data-topic-id="${topic}"]`);
    await page.waitForFunction(id=>document.querySelector(`[data-topic-id="${id}"] .topic-summary-count`)?.textContent==='1 个问题',topic);
    await group.locator('summary').click();
    await group.getByRole('button', { name: '修改主题名', exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill('已确认的交互原则');
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.topic-summary')?.textContent.includes('已确认的交互原则'));
    while(await page.locator('.project-workspace-dialog .workspace-topic[open]>summary').count())await page.locator('.project-workspace-dialog .workspace-topic[open]>summary').first().click();
    await shot('overview');
  });
  await check('Global Search has an actionable empty state and opens the actual full Q/A', async () => {
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'⌕ 全局检索',exact:true}).click();
    await page.getByLabel('全局检索关键词').fill('no-match-premium-123');
    await page.getByText('没有找到匹配的 Q/A',{exact:true}).waitFor();
    await page.getByLabel('全局检索关键词').fill('QUESTION-TAIL-0_0');
    await page.locator('[data-search-card] .opc-result-open').first().click();
    await page.locator('.opc-reading-body').waitFor();
    assert((await page.locator('.opc-reading-body').innerText()).includes('QUESTION-TAIL-0_0'));
    await page.locator('.close-detail').click();
    await page.locator('#project-workspace-button').click();
    await page.locator('.workspace-overview').waitFor();
  });
  await check('Overview search opens matching Q/A; no results gives next step; Escape leaves no blocker', async () => {
    await page.getByLabel('搜索项目内 Q/A').fill('QUESTION-TAIL-0_0');
    await page.locator('.project-workspace-dialog').getByRole('button', { name: '搜索', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-workspace-card]').length === 1);
    assert(await page.locator('[data-workspace-card]').isVisible());
    await page.getByLabel('搜索项目内 Q/A').fill('no-match-premium-123');
    await page.locator('.project-workspace-dialog').getByRole('button', { name: '搜索', exact: true }).click();
    await page.getByText('没有匹配的 Q/A。试试其他关键词或选择全部来源。').waitFor();
    await page.keyboard.press('Escape');await page.locator('.project-workspace-dialog:not(.knowledge-dialog)').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '时间放大', exact: true }).click();
  });
  await check('Topics empty state, local analysis, compact summaries and persistent expansion', async () => {
    await page.locator('#topics-view-button').click();
    await page.getByText('让对话成为可浏览的主题').waitFor();
    await page.getByRole('button', { name: '本地知识整理', exact: true }).click();
    await page.locator('[data-knowledge-topic]').first().waitFor({ timeout: 30000 });
    assert.equal(await page.locator('.knowledge-dialog .workspace-topic[open]').count(), 0);
    await shot('topics');
    await page.locator('[data-knowledge-topic]>summary').first().click();
    await page.locator('.knowledge-dialog .panel-close').click();
    await page.locator('#topics-view-button').click();
    assert.equal(await page.locator('.knowledge-dialog .workspace-topic[open]').count(),1);
    await page.locator('[data-knowledge-card] input').first().check();
    await page.getByRole('button', { name: '所选加入现有 Deploy', exact: true }).click();
    await page.locator('.deploy-sources').waitFor();
  });
  await check('Deploy generates, copies and exports the complete Context Pack', async () => {
    await page.getByRole('button', { name: '编辑上下文包', exact: true }).click();
    await page.getByLabel('当前用户任务', { exact: true }).fill('继续审查交互设计，保留原始问答。');
    await page.getByRole('button', { name: '编译预览', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.pack-output')?.value.includes('ANSWER-TAIL'));
    const copy = page.getByRole('button', { name: '复制完整上下文', exact: true });
    assert((await copy.getAttribute('class')).includes('primary'));
    await copy.click();
    await page.getByText('已复制完整 Markdown 上下文', { exact: true }).waitFor();
    await shot('deploy');
    await page.locator('.deploy-output-actions .reading-menu>summary').click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 Markdown', exact: true }).click();
    const file = await download;await file.saveAs(path.join(output, 'synthetic-context.md'));
    assert(fs.readFileSync(path.join(output, 'synthetic-context.md'), 'utf8').includes('ANSWER-TAIL'));
  });
  await check('Canvas keeps saved positions and existing relationships', async () => {
    await page.locator('#canvas-view-button').click();await page.locator('.opc-canvas-node').first().waitFor();
    await page.waitForFunction(()=>document.querySelector('#canvas-view-button').getAttribute('aria-pressed')==='true'&&document.querySelector('#deploy-view-button').getAttribute('aria-pressed')==='false');
    await shot('canvas');
    await page.locator('.compact-node-open').first().click();await page.locator('.opc-reading-body').waitFor();
    await page.keyboard.press('Escape');
  });
  await check('390/768/1024 windows keep all primary navigation and close controls reachable', async () => {
    await page.locator('#timeline-view-button').click();
    for (const width of [390, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await contained(), 'page overflow at ' + width);
      await page.locator('#topics-view-button').click();await page.locator('.knowledge-dialog').waitFor({ state: 'visible' });
      const close = page.locator('.knowledge-dialog .panel-close');
      const box = await close.boundingBox();assert(box.x >= 0 && box.x + box.width <= width && box.y >= 0);
      await close.click();
      await page.getByRole('button', { name: '时间放大', exact: true }).click();
      if (width === 390) await shot('narrow');
    }
  });
  await check('Actual Chrome tab zoom 125% and 150% preserves controls', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const factor of [1.25, 1.5]) {
      const actual = await page.evaluate(async factor => {const tab = await chrome.tabs.getCurrent();await chrome.tabs.setZoom(tab.id, factor);return chrome.tabs.getZoom(tab.id);}, factor);
      assert.equal(actual, factor);assert(await contained());
      await page.getByRole('button', { name: '时间放大', exact: true }).click();
      await page.locator('.ht-point').first().click();await page.locator('.opc-reading-body').waitFor();
      await page.locator('.close-detail').click();await shot('zoom-' + factor);
    }
    await page.evaluate(async () => {const tab = await chrome.tabs.getCurrent();await chrome.tabs.setZoom(tab.id, 1);});
  });
  await check('Original messages, versions, saved Canvas positions and manual links remain identical', async () => {
    const actual = await page.evaluate(async () => {const { readState } = await import('./storage/database.js');const s = await readState();return JSON.stringify([s.messages, s.versions, s.relationships, s.canvasLayouts]);});
    assert.equal(actual, originalSources);
    await page.reload();await page.locator('.ht-point').first().waitFor();assert(await contained());
  });
  assert.deepEqual(report.errors, []);report.ok = true;
} catch (error) { report.ok = false;report.error = error.stack;console.error(error);await shot('failure').catch(() => {}); }
finally { await context?.close();fs.writeFileSync(path.join(output, 'REPORT.json'), JSON.stringify(report, null, 2)); }
process.exitCode = report.ok ? 0 : 1;
