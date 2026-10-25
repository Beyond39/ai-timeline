// Read-only UI diagnostics apart from synthetic fixture creation in a NEW profile.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { graph, user, body } from '../validation/qa-p0-fixtures.mjs';
import { chromium, browserExecutable as findBrowser } from './browser-runtime.mjs';
const expectFixed = process.argv.includes('--expect-fixed');
const extension = path.resolve(process.env.OPC_TEST_EXTENSION ?? '.');
const browserExecutable = findBrowser('edge');
const profile = path.resolve('dist', 'p0-second-project-profile-' + Date.now());
const report = { startedAt: new Date().toISOString(), profile, extension, browserExecutable, expectFixed, checks: [], errors: [], snapshots: [], gestures: [], scope: 'Native unpacked MV3, fresh isolated browser profile, synthetic data only; no private Q/A bodies logged.' };
report.loadedFiles = Object.fromEntries(['background.js', 'ui/app.js', 'domain/change-notification.js'].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(extension, file))).digest('hex')]));
fs.mkdirSync(profile, { recursive: true });
let context;
async function rpc(page, type, args = {}) {
  return page.evaluate(async ({ type, args }) => {
    const r = await chrome.runtime.sendMessage({ type, args });
    if (!r.ok) throw new Error(r.error);
    return r.data;
  }, { type, args });
}
async function instrument(page) {
  page.on('pageerror', e => report.errors.push({ kind: 'pageerror', message: e.message, stack: e.stack }));
  page.on('console', m => { if (m.type() === 'error') report.errors.push({ kind: 'console', message: m.text() }); });
  await page.evaluate(async () => {
    const { OPCTimeline } = await import('./ui/opc.js');
    const { HorizontalTimeline } = await import('./ui/horizontal-timeline.js');
    window.p0 = { events: [], calls: [], messages: [], rejections: [], renders: 0 };
    addEventListener('unhandledrejection', e => p0.rejections.push({ message: String(e.reason?.message ?? e.reason), stack: e.reason?.stack }));
    chrome.runtime.onMessage.addListener(m => { if (m.event) p0.messages.push({ event: m.event, projectId: m.projectId, action: m.action }); });
    for (const [proto, method] of [[OPCTimeline.prototype, 'render'], [OPCTimeline.prototype, 'openCard'], [HorizontalTimeline.prototype, 'zoom']]) {
      const original = proto[method];
      proto[method] = function (...args) {
        p0.timeline = this.owner ?? this;
        p0.calls.push({ method, id: method === 'openCard' ? args[0] : undefined, projectId: p0.timeline.projectId });
        if (method === 'render') p0.renders++;
        return original.apply(this, args);
      };
    }
    for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, e => {
      p0.events.push({ type, target: e.target.className, label: e.target.closest('button')?.getAttribute('aria-label'), cardId: e.target.closest('[data-card-id]')?.dataset.cardId, path: e.composedPath().slice(0, 5).map(n => n.tagName ?? n.nodeName) });
    }, true);
  });
}
async function snapshot(page, name) {
  const state = await page.evaluate(async () => {
    const { closeInteractionStats } = await import('./ui/panel-close.js');
    const t = window.p0?.timeline, h = t?.horizontal, scroll = document.querySelector('.ht-scroll');
    const stored = (await chrome.storage.local.get('navigatorSelection')).navigatorSelection;
    return {
      url: location.href, selectedProject: document.querySelector('#project-select')?.value,
      activeProjectId: t?.projectId, activeConversationId: stored?.conversationId, activePathId: stored?.pathId,
      scope: t?.scope, zoom: h?.layout?.pxPerMs, span: h?.layout?.visibleSpan,
      pan: scroll ? { x: scroll.scrollLeft, y: scroll.scrollTop } : null,
      points: document.querySelectorAll('.ht-point').length,
      controls: document.querySelectorAll('.ht-controls button').length,
      container: scroll ? { width: scroll.clientWidth, height: scroll.clientHeight, board: scroll.scrollWidth } : null,
      dialogs: [...document.querySelectorAll('dialog[open]')].map(d => ({ id: d.id, class: d.className })),
      closeStats: closeInteractionStats(), renders: p0.renders, messages: p0.messages, rejections: p0.rejections
    };
  });
  report.snapshots.push({ name, ...state });
  const cdp = await context.newCDPSession(page), listeners = {};
  for (const [label, expression] of Object.entries({ document: 'document', window: 'window', zoom: 'document.querySelector("[aria-label=时间放大]")', point: 'document.querySelector(".ht-point")' })) {
    const { result } = await cdp.send('Runtime.evaluate', { expression });
    const { listeners: rows } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    listeners[label] = rows.map(r => ({ type: r.type, capture: r.useCapture }));
    await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
  }
  state.listeners = listeners; report.snapshots.at(-1).listeners = listeners; await cdp.detach();
}
async function exercise(page, name) {
  await page.getByRole('button', { name: '适配全部', exact: true }).click();
  // First zoom exposes the actual controller reference through instrumentation.
  const before = await page.locator('.ht-scroll').evaluate(e => e.scrollWidth);
  await page.getByRole('button', { name: '时间放大', exact: true }).click();
  await page.waitForFunction(() => Boolean(p0.timeline?.horizontal.layout));
  const zoomIn = await page.evaluate(() => ({ scale: p0.timeline.horizontal.layout.pxPerMs, span: p0.timeline.horizontal.layout.visibleSpan }));
  await page.getByRole('button', { name: '时间缩小', exact: true }).click();
  const zoomOut = await page.evaluate(() => ({ scale: p0.timeline.horizontal.layout.pxPerMs, span: p0.timeline.horizontal.layout.visibleSpan }));
  const point = page.locator('.ht-point').first();
  await point.scrollIntoViewIfNeeded();
  const id = await point.getAttribute('data-card-id'), box = await point.boundingBox();
  const hit = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return { class: e?.className, cardId: e?.closest('[data-card-id]')?.dataset.cardId, pointerEvents: e ? getComputedStyle(e).pointerEvents : null }; }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await point.click();
  await page.locator('.opc-reading-body').waitFor();
  const selected = await page.evaluate(() => p0.timeline.selected);
  const readerId = await page.locator('.opc-detail').getAttribute('data-card-id');
  const passed = zoomIn.scale > zoomOut.scale && zoomIn.span < zoomOut.span && selected === id && readerId === id && hit.cardId === id;
  report.checks.push({ name, passed, beforeWidth: before, zoomIn, zoomOut, cardId: id, selected, hit });
  await page.locator('.opc-detail .panel-close').click();
  await snapshot(page, name);
  if (!passed) throw new Error('Interaction failed: ' + name);
}
async function addConversation(page, projectId, label) {
  const rows = []; let parent = 'root';
  for (let i = 0; i < 5; i++) { const q = label + '-q-' + i, a = label + '-a-' + i; rows.push([q, parent, user(q, 'Synthetic question ' + label + ' ' + i, 1790812800 + i * 86400)], [a, q, body(a, 'Synthetic answer ' + label + ' ' + i)]); parent = a; }
  const raw = graph(rows, parent, 'p0-' + label); raw.title = 'Synthetic ' + label; const text = JSON.stringify(raw);
  const draft = await rpc(page, 'importPreview', { text, filename: 'synthetic-p0.json' });
  return rpc(page, 'saveDraft', { draftId: draft.id, projectId });
}
async function createProjectUI(page, name) {
  if (!await page.locator('#new-project').isVisible()) await page.locator('#library-toggle').click();
  const menu = page.locator('.library-actions'); if (await menu.getAttribute('open') === null) await menu.locator('summary').click();
  await page.locator('#new-project').click();
  await page.locator('#edit-dialog input[name=name]').fill(name);
  await page.locator('#edit-dialog button[type=submit]').click();
  await page.waitForFunction(name => document.querySelector('#project-select')?.selectedOptions[0]?.textContent.includes(name), name);
  await page.waitForFunction(() => !document.querySelector('#timeline-view-button').disabled);
  return page.locator('#project-select').inputValue();
}
async function switchTo(page, id) {
  await page.locator('#project-select').selectOption(id, { force: true });
  await page.waitForFunction(id => document.querySelector('#project-select')?.value === id && document.querySelector('#map-title')?.textContent && !document.querySelector('#timeline-view-button').disabled, id);
  await page.locator('.ht-point').first().waitFor();
}
async function dataDigest(page) {
  return page.evaluate(async () => {
    const { readState } = await import('./storage/database.js'); const s = await readState(), result = {};
    for (const key of ['messages', 'versions', 'snapshots', 'paths', 'qas', 'segments', 'qaCards', 'qaMetadata', 'relationships', 'canvasLayouts', 'memberships', 'timelines']) {
      const rows = s[key].toSorted((a, b) => a.id.localeCompare(b.id));
      result[key] = { count: rows.length, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows))))].map(b => b.toString(16).padStart(2, '0')).join('') };
    }
    return result;
  });
}
try {
  context = await chromium.launchPersistentContext(profile, { headless: true, executablePath: browserExecutable, viewport: { width: 1440, height: 1000 }, ignoreDefaultArgs: ['--disable-extensions'], args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
  report.browserVersion = context.browser()?.version();
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 });
  worker.on('console', m => { if (m.type() === 'error') report.errors.push({ kind: 'worker', message: m.text() }); });
  const origin = 'chrome-extension://' + new URL(worker.url()).host;
  let a = await context.newPage(); a.setDefaultTimeout(10000);
  await a.goto(origin + '/workspace.html'); await a.waitForFunction(() => !document.querySelector('#timeline-view-button').disabled);
  await instrument(a);
  const aid = await createProjectUI(a, 'P0 A'); await addConversation(a, aid, 'A1'); await addConversation(a, aid, 'A2');
  await a.locator('.ht-point').first().waitFor(); await exercise(a, 'one independent Project, two Conversations');
  // Create the second independent Project in another real Workspace while A
  // has a pressed + button. This includes the previously unscoped create event.
  const creator = await context.newPage(); creator.setDefaultTimeout(10000); await creator.goto(origin + '/workspace.html?projectId=' + aid); await creator.locator('.ht-point').first().waitFor();
  const pressed = await a.getByRole('button', { name: '时间放大', exact: true }).elementHandle(), pressedBox = await pressed.boundingBox();
  const scaleBeforeCreate = await a.evaluate(() => p0.timeline.horizontal.layout.pxPerMs);
  await a.mouse.move(pressedBox.x + pressedBox.width / 2, pressedBox.y + pressedBox.height / 2); await a.mouse.down();
  const bid = await createProjectUI(creator, 'P0 B');
  await a.waitForFunction(id => [...document.querySelector('#project-select').options].some(o => o.value === id), bid);
  const createConnected = await pressed.evaluate(e => e.isConnected); await a.mouse.up();
  const scaleAfterCreate = await a.evaluate(() => p0.timeline.horizontal.layout.pxPerMs);
  if (expectFixed) { const passed = createConnected && scaleAfterCreate > scaleBeforeCreate; report.checks.push({ name: 'creating B during A press retains actual + click and refreshes project list', passed, connected: createConnected, before: scaleBeforeCreate, after: scaleAfterCreate }); if (!passed) throw new Error('Creating B destroyed A pressed +'); }
  await addConversation(creator, bid, 'B'); await creator.close(); await switchTo(a, bid);
  console.log('Created A then B through UI');
  await exercise(a, 'second independent Project B'); await switchTo(a, aid); await exercise(a, 'return to A after B creation'); await switchTo(a, bid); await exercise(a, 'return to B');
  const cid = await createProjectUI(a, 'P0 C'); await addConversation(a, cid, 'C');
  for (const [id, name] of [[cid, 'C'], [aid, 'A'], [bid, 'B']]) { await switchTo(a, id); await exercise(a, 'three Projects switch ' + name); }
  const aData = await rpc(a, 'opcTimeline', { projectId: aid }), aCards = aData.cards;
  await rpc(a, 'opcWrite', { projectId: aid, action: 'metadata', cardId: aCards[0].id, title: 'P0 preserved manual title', notes: 'Synthetic protected note', tags: ['P0 protected'], expectedRevision: aCards[0].metadata.revision });
  await rpc(a, 'opcWrite', { projectId: aid, action: 'relationship', fromCardId: aCards[0].id, toCardId: aCards[1].id, type: '补充', directed: true, description: 'Synthetic protected relationship' });
  await rpc(a, 'opcWrite', { projectId: aid, action: 'layout', positions: Object.fromEntries(aCards.map((c, i) => [c.id, { x: i % 3 * 320, y: Math.floor(i / 3) * 270 }])), viewport: { x: 20, y: 20, zoom: 1 } });
  report.dataBefore = await dataDigest(a);
  const viewA = await rpc(a, 'view', { projectId: aid }), viewB = await rpc(a, 'view', { projectId: bid });
  const url = (id, v, sourceTab) => origin + '/workspace.html?' + new URLSearchParams({ projectId: id, conversationId: v.conversations[0].id, pathId: v.conversations[0].currentPathId, sourceTab });
  await a.goto(url(aid, viewA, '1141874990')); await a.locator('.ht-point').first().waitFor(); await instrument(a); await exercise(a, 'A exact parameter shape, alone');
  let b = await context.newPage(); b.setDefaultTimeout(10000); await b.goto(url(bid, viewB, '1141874990')); await b.locator('.ht-point').first().waitFor(); await instrument(b);
  await exercise(a, 'A with B open, same sourceTab'); await exercise(b, 'B with A open, same sourceTab');
  // Deterministic overlap: hold a real pointer on each control while another
  // independent Project commits an actual edit through the service worker.
  for (const selector of ['[aria-label="时间放大"]', '[aria-label="时间缩小"]', '.ht-point']) {
    await a.getByRole('button', { name: '时间放大', exact: true }).click();
    const target = a.locator(selector).first(); await target.scrollIntoViewIfNeeded(); const handle = await target.elementHandle(), box = await target.boundingBox();
    const targetCardId = await target.getAttribute('data-card-id');
    const start = await a.evaluate(() => ({ scale: p0.timeline.horizontal.layout.pxPerMs, selected: p0.timeline.selected, events: p0.events.length, calls: p0.calls.length }));
    await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await a.mouse.down();
    await rpc(b, 'renameProject', { projectId: bid, name: 'P0 B edited ' + selector });
    await a.waitForFunction(() => !document.querySelector('#timeline-view-button').disabled);
    await a.waitForTimeout(150);
    const connected = await handle.evaluate(e => e.isConnected); await a.mouse.up();
    if (expectFixed && selector === '.ht-point') await a.waitForFunction(id => p0.timeline.selected === id && document.querySelector('.opc-detail')?.dataset.cardId === id, targetCardId);
    const end = await a.evaluate(start => ({ scale: p0.timeline.horizontal.layout.pxPerMs, selected: p0.timeline.selected, events: p0.events.slice(start.events), calls: p0.calls.slice(start.calls), overlays: [...document.querySelectorAll('dialog[open]')].map(d => d.className) }), start);
    const passed = connected && end.events.some(e => e.type === 'click') && (selector === '.ht-point' ? end.selected === targetCardId : selector.includes('放大') ? end.scale > start.scale : end.scale < start.scale);
    report.gestures.push({ selector, connected, passed, start, end });
    if (expectFixed) { report.checks.push({ name: 'real pointer survives B save: ' + selector, passed }); if (!passed) throw new Error('Lost native click during independent Project update: ' + selector); }
    if (await a.locator('.opc-detail').isVisible()) await a.locator('.opc-detail .panel-close').click();
  }
  await b.close(); await exercise(a, 'A after closing B');
  // Single Conversation selection, Canvas, Search and Deploy through real UI.
  await a.getByRole('button', { name: '选择来源', exact: true }).click();
  const sources = a.locator('#track-dialog input[type=checkbox]'); for (let i = 0; i < await sources.count(); i++) await sources.nth(i).setChecked(i === 0);
  await a.getByRole('button', { name: '保存选择', exact: true }).click(); await exercise(a, 'single Conversation under independent Project A');
  await a.getByRole('button', { name: 'Canvas', exact: true }).click(); await a.locator('.compact-node-open').first().click(); await a.locator('.opc-reading-body').waitFor(); await a.locator('.opc-detail .panel-close').click();
  report.checks.push({ name: 'existing Canvas opens original Reader after cross-project edits', passed: true });
  await a.getByRole('button', { name: 'Timeline', exact: true }).click();
  await a.getByRole('searchbox', { name: '搜索 Q/A', exact: true }).fill('Synthetic question A'); await a.locator('.opc-filters').getByRole('button', { name: '搜索', exact: true }).click();
  await a.locator('.ht-results button').first().click(); await a.locator('.opc-reading-body').waitFor();
  if (!(await a.locator('.opc-reading-body').innerText()).includes('Synthetic question A')) throw new Error('Search opened wrong synthetic Q/A');
  report.checks.push({ name: 'existing Search opens matching original Q/A', passed: true });
  await a.getByRole('button', { name: '加入上下文托盘', exact: true }).click(); await a.getByRole('button', { name: 'Deploy', exact: true }).click(); await a.getByRole('button', { name: '编辑上下文包', exact: true }).click();
  await a.getByRole('button', { name: '编译预览', exact: true }).click(); await a.waitForFunction(() => document.querySelector('.pack-output')?.value.includes('Synthetic answer A'));
  report.checks.push({ name: 'existing Deploy compiles original source answer', passed: true });
  await a.getByRole('button', { name: 'Timeline', exact: true }).click();
  await a.locator('.ht-scroll').waitFor(); await a.locator('.opc-reading-body').waitFor();
  await a.locator('.opc-detail .panel-close').click(); await a.locator('.opc-detail').waitFor({ state: 'hidden' });
  await a.locator('.opc-filters').getByRole('button', { name: '清除', exact: true }).click();
  b = await context.newPage(); b.setDefaultTimeout(10000); await b.goto(url(bid, viewB, '999999')); await b.locator('.ht-point').first().waitFor(); await instrument(b);
  await exercise(a, 'A with different sourceTab B'); await exercise(b, 'B with different sourceTab A');
  await a.close(); await exercise(b, 'B after closing A'); await b.reload(); await b.locator('.ht-point').first().waitFor(); await instrument(b); await exercise(b, 'B after page reload');
  const reloaded = context.waitForEvent('serviceworker', { timeout: 15000 });
  await b.evaluate(() => chrome.runtime.reload()).catch(e => { if (!/context|closed|destroyed/i.test(e.message)) throw e; }); await reloaded;
  b = await context.newPage(); b.setDefaultTimeout(10000); await b.goto(url(bid, viewB, '999999')); await b.locator('.ht-point').first().waitFor(); await instrument(b); await exercise(b, 'B after actual extension reload');
  report.dataAfter = await dataDigest(b); const dataUnchanged = JSON.stringify(report.dataBefore) === JSON.stringify(report.dataAfter);
  report.checks.push({ name: 'original Q/A, versions, annotations, manual relationships and Canvas layout hashes unchanged', passed: dataUnchanged });
  if (!dataUnchanged) throw new Error('Protected source/organization data changed');
  report.ok = report.checks.every(c => c.passed) && !report.errors.length;
} catch (error) { report.error = error.stack; report.ok = false; }
finally { await context?.close(); report.finishedAt = new Date().toISOString(); const output = process.argv.find(arg => arg.startsWith('--report='))?.slice(9) ?? (expectFixed ? 'dist/P0_SECOND_PROJECT_AFTER.json' : 'dist/P0_SECOND_PROJECT_DIAGNOSTIC.json'); fs.writeFileSync(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, ok: report.ok, checks: report.checks.length, errors: report.errors, gestures: report.gestures.map(g => ({ selector: g.selector, connected: g.connected, passed: g.passed })), error: report.error }, null, 2)); }
process.exitCode = report.ok ? 0 : 1;
