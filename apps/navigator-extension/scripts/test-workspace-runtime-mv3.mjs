// Dedicated Chrome profile, synthetic records, real extension pages and mouse
// input. Missing-terminal-event checks are explicitly controlled fault cases.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { graph, user, body } from '../validation/qa-p0-fixtures.mjs';
import { chromium, browserExecutable as findBrowser } from './browser-runtime.mjs';
const option = (name, fallback) => process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
const extension = path.resolve(option('extension', '.'));
const profile = path.resolve('dist', 'workspace-runtime-profile-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
const report = { startedAt: new Date().toISOString(), scope: 'Isolated Chrome MV3, synthetic records. This is NOT the user failing instance.', extension, profile, checks: [], observations: [], errors: [] };
const sha = value => createHash('sha256').update(value).digest('hex');
report.diskFiles = Object.fromEntries(['ui/app.js', 'ui/opc.js', 'ui/horizontal-timeline.js', 'background.js', 'workspace.html', 'ui/workbench.css'].map(f => [f, sha(fs.readFileSync(path.join(extension, f)))]));
let context, page, peer;
const rpc = (p, type, args = {}) => p.evaluate(async ({ type, args }) => { const r = await chrome.runtime.sendMessage({ type, args }); if (!r?.ok) throw Error(r?.error ?? 'No response'); return r.data; }, { type, args });
const frame = p => p.evaluate(() => new Promise(requestAnimationFrame));
async function check(name, run) {
  try { const evidence = await run(); report.checks.push({ name, status: 'PASS', evidence }); console.log('PASS ' + name); }
  catch (error) { report.checks.push({ name, status: 'FAIL', error: error.stack }); console.log('FAIL ' + name + ': ' + error.message); }
}
async function attach(p) {
  p.setDefaultTimeout(5000); p.on('pageerror', e => report.errors.push(e.message));
  const cdp = await context.newCDPSession(p);
  const parsed = []; cdp.on('Debugger.scriptParsed', e => { if (e.url.startsWith('chrome-extension:')) parsed.push(e); });
  await cdp.send('Debugger.enable');
  const memoryFiles = {};
  for (const file of ['ui/app.js', 'ui/opc.js', 'ui/horizontal-timeline.js']) {
    const script = parsed.find(s => s.url.endsWith('/' + file));
    if (script) { const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId: script.scriptId }); memoryFiles[file] = { sha256: sha(scriptSource), matchesDisk: scriptSource.replace(/\r\n/g, '\n') === fs.readFileSync(path.join(extension, file), 'utf8').replace(/\r\n/g, '\n') }; }
  }
  const { result: proto } = await cdp.send('Runtime.evaluate', { expression: 'import("./ui/opc.js").then(m=>m.OPCTimeline.prototype)', awaitPromise: true });
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.objectId });
  await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function(){window.runtimeProbe={timeline:this.find(t=>t.host?.isConnected),events:[],calls:[]};}', returnByValue: true });
  await cdp.send('Runtime.releaseObject', { objectId: proto.objectId }); await cdp.send('Runtime.releaseObject', { objectId: objects.objectId }); await cdp.detach();
  await p.evaluate(() => {
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'click']) document.addEventListener(type, e => {
      if (!e.target.closest?.('.ht-controls,.ht-point,.ht-density,#project-select')) return;
      runtimeProbe.events.push({ type, pointerId: e.pointerId, buttons: e.buttons, control: e.target.closest('button')?.getAttribute('aria-label'), connected: e.target.isConnected, projectId: runtimeProbe.timeline.projectId });
    }, true);
    for (const [object, names] of [[runtimeProbe.timeline, ['show', 'load', 'render', 'openCard']], [runtimeProbe.timeline.horizontal, ['render', 'zoom']]]) for (const name of names) {
      const original = object[name]; object[name] = function (...args) { runtimeProbe.calls.push({ method: name, projectId: runtimeProbe.timeline.projectId, time: performance.now() }); return original.apply(this, args); };
    }
  });
  report.functionFingerprints ??= await p.evaluate(async () => {
    const t = runtimeProbe.timeline, functions = {}, { OPCTimeline } = await import('./ui/opc.js');
    for (const [name, object, methods] of [['OPCTimeline', OPCTimeline.prototype, ['show', 'load', 'render', 'openCard']], ['HorizontalTimeline', Object.getPrototypeOf(t.horizontal), ['zoom', 'render', 'resizeAfterInteraction']]]) for (const method of methods) if (typeof object[method] === 'function') functions[name + '.' + method] = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(object[method].toString())))].map(b => b.toString(16).padStart(2, '0')).join('');
    return functions;
  });
  return memoryFiles;
}
async function ready(p, id) { await p.waitForFunction(id => document.querySelector('.ht-controls') && !document.querySelector('#timeline-view-button').disabled && (!id || document.querySelector('#project-select').value === id), id); }
async function snapshot(p, label) {
  const value = await p.evaluate(() => {
    const t = runtimeProbe.timeline, h = t.horizontal;
    const controls = Object.fromEntries(['时间放大', '时间缩小'].map(label => {
      const b = document.querySelector('[aria-label="' + label + '"]'), r = b?.getBoundingClientRect(), hit = r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return [label, { connected: b?.isConnected, disabled: b?.disabled, inertAncestor: Boolean(b?.closest('[inert]')), pointerEvents: b && getComputedStyle(b).pointerEvents, hits: Boolean(b && (b === hit || b.contains(hit))), hover: b?.matches(':hover'), box: r && { x: r.x, y: r.y, width: r.width, height: r.height } }];
    }));
    return { entry: document.body.dataset.mode, projectId: t.projectId, renderedProjectId: h.projectId, selectedProjectId: document.querySelector('#project-select').value, hostWidth: h.host.clientWidth, renderCount: runtimeProbe.calls.filter(c => c.method === 'render').length, pxPerMs: h.layout.pxPerMs, visibleSpan: h.layout.visibleSpan, axisFit: h.preferences.axisFit, nodes: [...document.querySelectorAll('.ht-point')].slice(0, 4).map(n => ({ id: n.dataset.cardId, x: parseFloat(n.style.left) })), controls, dialogs: [...document.querySelectorAll('dialog[open]')].map(d => ({ id: d.id, modal: d.matches(':modal'), display: getComputedStyle(d).display })), events: runtimeProbe.events.slice(-20), calls: runtimeProbe.calls.slice(-20) };
  }); report.observations.push({ label, ...value }); return value;
}
async function click(p, label) { const b = await p.getByRole('button', { name: label, exact: true }).boundingBox(); assert(b); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await frame(p); }
async function seed(p, label) {
  const project = await rpc(p, 'createProject', { name: 'Runtime ' + label });
  const rows = []; let parent = 'root';
  for (let i = 0; i < 6; i++) { const q = label + 'q' + i, a = label + 'a' + i; rows.push([q, parent, user(q, 'Synthetic ' + label + ' question ' + i, 1790812800 + i * 86400)], [a, q, body(a, 'Synthetic ' + label + ' answer ' + i)]); parent = a; }
  const raw = graph(rows, parent, 'runtime-' + label); raw.title = 'Synthetic ' + label;
  const draft = await rpc(p, 'importPreview', { text: JSON.stringify(raw), filename: 'runtime-synthetic.json' });
  await rpc(p, 'saveDraft', { draftId: draft.id, projectId: project.id }); return project.id;
}
async function switchProject(p, id) {
  if (!await p.locator('#project-select').isVisible()) await p.locator('#library-toggle').click();
  const select = p.locator('#project-select'), r = await select.boundingBox(), index = await select.evaluate((e, id) => [...e.options].findIndex(o => o.value === id), id);
  await p.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await p.keyboard.press('Home'); for (let i = 0; i < index; i++) await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
  await p.waitForFunction(id => runtimeProbe.timeline.projectId === id && !document.querySelector('#timeline-view-button').disabled, id);
}
try {
  context = await chromium.launchPersistentContext(profile, { executablePath: option('browser', findBrowser()), headless: true, viewport: { width: 1440, height: 1000 }, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
  report.browserVersion = context.browser().version();
  const cdp = await context.browser().newBrowserCDPSession(); const loaded = await cdp.send('Extensions.loadUnpacked', { path: extension }); await cdp.detach();
  const origin = 'chrome-extension://' + loaded.id; report.extensionId = loaded.id;
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); report.worker = await worker.evaluate(() => ({ id: chrome.runtime.id, version: chrome.runtime.getManifest().version }));
  page = await context.newPage(); await page.goto(origin + '/workspace.html'); await page.waitForFunction(() => !document.querySelector('#timeline-view-button').disabled);
  const aid = await seed(page, 'A'); await page.goto(origin + '/workspace.html'); await ready(page); report.memoryFiles = await attach(page);
  await check('loaded Workspace JavaScript is the disk source, worker ID/version agree', async () => { assert(Object.keys(report.memoryFiles).length === 3); assert(Object.values(report.memoryFiles).every(f => f.matchesDisk)); assert.equal(report.worker.id, loaded.id); assert.equal(report.worker.version, JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'))).version); });
  await check('single Project: ten physical +/− clicks change span and actual node positions', async () => {
    const steps = [await snapshot(page, 'single initial')];
    for (const label of [...Array(5).fill('时间放大'), ...Array(5).fill('时间缩小')]) {
      const before = steps.at(-1); await click(page, label); const after = await snapshot(page, label);
      assert(label === '时间放大' ? after.visibleSpan < before.visibleSpan : after.visibleSpan > before.visibleSpan);
      assert.notEqual(after.nodes[1].x, before.nodes[1].x); steps.push(after);
    } return steps.map(s => ({ pxPerMs: s.pxPerMs, visibleSpan: s.visibleSpan, x: s.nodes[1].x }));
  });
  await check('wide Workspace reader is docked and both panels remain usable', async () => {
    await page.locator('.ht-point').first().click(); await page.locator('.opc-reading-body').waitFor();
    await page.waitForFunction(() => { const timeline=document.querySelector('.ht-scroll').getBoundingClientRect(),reader=document.querySelector('.opc-detail').getBoundingClientRect();return timeline.right<=reader.left&&timeline.width>=300; });
    await page.screenshot({path:'dist/WORKBENCH_REDESIGN_MV3.png'});
    await page.locator('.close-detail').click();await page.locator('.opc-detail').waitFor({state:'hidden'});
  });
  // Leave the 1100px CSS max-width first. Resizing a wider window only moves
  // the centered host and would never exercise its ResizeObserver branch.
  await page.setViewportSize({ width: 1000, height: 1000 }); await frame(page); await frame(page);
  for (const label of ['时间放大', '时间缩小']) await check('ResizeObserver between ' + label + ' pointerdown/up preserves the native click', async () => {
    const before = await snapshot(page, 'resize ' + label + ' before'), target = page.getByRole('button', { name: label, exact: true }), handle = await target.elementHandle(), r = await target.boundingBox();
    try {
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down();
      await page.setViewportSize({ width: page.viewportSize().width + 20, height: 1000 }); await frame(page); await frame(page);
      const connected = await handle.evaluate(e => e.isConnected); await page.mouse.up(); await frame(page); const after = await snapshot(page, 'resize ' + label + ' after');
      assert.notEqual(after.hostWidth, before.hostWidth, 'test must actually change observed host width');
      assert(connected, 'ResizeObserver detached the pressed button before pointerup');
      assert(label === '时间放大' ? after.visibleSpan < before.visibleSpan : after.visibleSpan > before.visibleSpan, 'native click did not zoom');
      return { connected, before: before.visibleSpan, after: after.visibleSpan };
    } finally { await page.mouse.up(); }
  });
  await check('ResizeObserver between Q/A pointerdown/up keeps the node and opens its actual Reader', async () => {
    const target = page.locator('.ht-point').first(); await target.scrollIntoViewIfNeeded(); const handle = await target.elementHandle(), id = await target.getAttribute('data-card-id'), r = await target.boundingBox();
    try {
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down(); await page.setViewportSize({ width: page.viewportSize().width + 20, height: 1000 }); await frame(page); await frame(page);
      const connected = await handle.evaluate(e => e.isConnected); await page.mouse.up(); await frame(page); await snapshot(page, 'node resize release');
      assert(connected, 'ResizeObserver detached the pressed Q/A');
      await page.waitForFunction(id => document.querySelector('.opc-detail')?.dataset.cardId === id && document.querySelector('.opc-reading-body')?.textContent.includes('Synthetic A answer'), id);
      await page.keyboard.press('Escape'); return { connected, id };
    } finally { await page.mouse.up(); }
  });
  peer = await context.newPage(); await peer.goto(origin + '/workspace.html'); await ready(peer); await attach(peer);
  await check('a lost terminal pointer event is reconciled by the next real unpressed mouse move', async () => {
    // This synthetic pointerdown deliberately models a lost pointerup/cancel;
    // it is not reported as a naturally observed user-browser event loss.
    await page.evaluate(() => document.querySelector('.ht-controls').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 712, pointerType: 'mouse', button: 0, buttons: 1 })));
    try {
      await rpc(peer, 'renameProject', { projectId: aid, name: 'Runtime after lost pointer' });
      await page.mouse.move(5, 5); await page.mouse.move(12, 12);
      await page.waitForFunction(() => document.querySelector('#map-title').textContent === 'Runtime after lost pointer' && !document.querySelector('#timeline-view-button').disabled, null, { timeout: 2000 });
      await click(page, '时间放大'); return { syntheticFault: true, recoveredWithoutReload: true };
    } finally { await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 712 }))); await frame(page); }
  });
  await check('cancelled data navigation releases its interaction waiter while the real mouse is still held', async () => {
    const target = page.getByRole('button', { name: '时间放大', exact: true }), handle = await target.elementHandle(), r = await target.boundingBox();
    try {
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down();
      await page.evaluate(() => {
        const t = runtimeProbe.timeline, api = t.api; runtimeProbe.cancelAPI = api; runtimeProbe.cancelReadReady = false; runtimeProbe.cancelSettled = false;
        t.api = async (type, args) => { const data = await api(type, args); if (type === 'opcTimeline') runtimeProbe.cancelReadReady = true; return data; };
        runtimeProbe.cancelLoad = t.load().finally(() => { runtimeProbe.cancelSettled = true; });
      });
      await page.waitForFunction(() => runtimeProbe.cancelReadReady); await frame(page); await frame(page);
      await page.evaluate(() => runtimeProbe.timeline.cancelNavigation());
      await page.waitForFunction(() => runtimeProbe.cancelSettled, null, { timeout: 1500 });
      assert(await handle.evaluate(e => e.isConnected)); return { settledBeforePointerUp: true };
    } finally { await page.mouse.up(); await page.evaluate(() => { runtimeProbe.timeline.api = runtimeProbe.cancelAPI; }); await frame(page); }
  });
  const bid = await seed(peer, 'B'), cid = await seed(peer, 'C');
  await check('three independent Projects: native selection, zoom and scope after A/B/C/A', async () => {
    for (const id of [bid, cid, aid]) { await switchProject(page, id); await click(page, '时间放大'); await click(page, '时间缩小'); const s = await snapshot(page, 'selected ' + id); assert.equal(s.projectId, id); assert.equal(s.renderedProjectId, id); }
  });
  await check('separate Workspace tabs retain their own selected Project across refresh', async () => {
    await switchProject(page, aid); await switchProject(peer, bid);
    await page.reload(); await ready(page); await attach(page); const first = await snapshot(page, 'first refreshed'); assert.equal(first.projectId, aid, 'peer overwrote the first window restore state');
    await peer.reload(); await ready(peer); await attach(peer); assert.equal((await snapshot(peer, 'peer refreshed')).projectId, bid);
  });
  await check('Side Panel has independent restore state from Workspace', async () => {
    const panel = await context.newPage(); await panel.goto(origin + '/sidepanel.html'); await ready(panel); await attach(panel); await switchProject(panel, cid);
    await page.reload(); await ready(page); await attach(page); assert.equal((await snapshot(page, 'Workspace after panel selection')).projectId, aid);
    await panel.close(); return { scope: 'sidepanel.html as a tab; native Side Panel tested by test-workspace-sync-mv3.mjs' };
  });
  await check('separate Chrome windows preserve different Projects through refresh and new Workspace entry', async () => {
    const created = context.waitForEvent('page');
    const windowInfo = await peer.evaluate(url => chrome.windows.create({ url, type: 'normal' }), origin + '/workspace.html');
    const otherWindow = await created; let opened;
    try {
      await ready(otherWindow); await attach(otherWindow);
      await switchProject(page, aid); await switchProject(otherWindow, cid);
      await page.reload(); await ready(page); await attach(page); assert.equal((await snapshot(page, 'first Chrome window')).projectId, aid);
      await otherWindow.reload(); await ready(otherWindow); await attach(otherWindow); assert.equal((await snapshot(otherWindow, 'other Chrome window')).projectId, cid);
      const ownWindow = await page.evaluate(() => chrome.windows.getCurrent()); assert.notEqual(ownWindow.id, windowInfo.id);
      await click(page, '时间放大'); await click(otherWindow, '时间放大');
      const reopened = context.waitForEvent('page'); await rpc(page, 'openWorkspace', { projectId: aid }); opened = await reopened; await ready(opened, aid); await attach(opened); assert.equal((await snapshot(opened, 'opened via real Workspace entry')).projectId, aid);
      return { differentChromeWindowIds: [ownWindow.id, windowInfo.id] };
    } finally { await opened?.close(); await otherWindow.close(); }
  });
  await check('original-page diagnostic probe collects +/−/Q/A events and modal hit testing without Q/A text', async () => {
    // Exercise the probe in a normal page without this suite's instance wrappers.
    await switchProject(page, aid); await page.reload(); await ready(page, aid);
    const probeCDP = await context.newCDPSession(page);
    const moduleProbe = fs.existsSync(path.join(extension, 'scripts/workspace-live-probe.js'));
    const expression = moduleProbe ? 'import(chrome.runtime.getURL("scripts/workspace-live-probe.js")).then(()=>globalThis.__opcProbeReady)' : fs.readFileSync('scripts/workspace-live-probe.js', 'utf8');
    const installed = await probeCDP.send('Runtime.evaluate', { expression, includeCommandLineAPI: true, awaitPromise: true, returnByValue: true });
    await probeCDP.detach(); assert(!installed.exceptionDetails, installed.exceptionDetails?.exception?.description);
    await click(page, '时间放大'); await click(page, '时间缩小');
    await page.getByRole('button', { name: '设置与导入选项', exact: true }).click();
    const modal = await page.evaluate(() => __opcLiveProbe.snapshot()); assert(modal.controls['时间放大'].blockedByModal); await page.keyboard.press('Escape');
    const target = page.locator('.ht-point').first(); await target.scrollIntoViewIfNeeded(); const r = await target.boundingBox(); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await page.locator('.opc-reading-body').waitFor(); await page.keyboard.press('Escape');
    await frame(page); const captured = await page.evaluate(() => __opcLiveProbe.stop());
    assert(captured.events.some(e => e.type === 'click' && e.trusted)); assert(captured.calls.some(c => c.method === 'zoom' && c.phase === 'after')); assert(captured.calls.some(c => c.method === 'openCard'));
    assert.equal(captured.errors.length, 0); assert(!JSON.stringify(captured).includes('Synthetic A question')); assert(!JSON.stringify(captured).includes('Synthetic A answer')); assert(await page.evaluate(() => !globalThis.__opcLiveProbe));
    assert.deepEqual(captured.metadata.functions, report.functionFingerprints);
    const output = path.join(path.dirname(option('report', 'dist/WORKSPACE_RUNTIME_MV3_REPORT.json')), 'LIVE_PROBE_SELFTEST.json'); fs.writeFileSync(output, JSON.stringify(captured, null, 2));
    return { output, installation: moduleProbe ? 'self-module-import' : 'console-paste', events: captured.events.length, calls: captured.calls.length, removedInstrumentation: true, modalBlocked: true };
  });
} catch (error) { report.error = error.stack; }
finally {
  await context?.close(); report.finishedAt = new Date().toISOString(); report.ok = !report.error && !report.errors.length && report.checks.every(c => c.status === 'PASS');
  const output = option('report', 'dist/WORKSPACE_RUNTIME_MV3_REPORT.json'); fs.writeFileSync(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, ok: report.ok, checks: report.checks.map(({ name, status }) => ({ name, status })), error: report.error }));
}
process.exitCode = report.ok ? 0 : 1;
