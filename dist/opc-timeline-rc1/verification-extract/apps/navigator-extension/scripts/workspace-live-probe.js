// Paste this entire file into DevTools Console of the ORIGINAL failing page.
// No reload, click simulation, storage read/write, network or Q/A text capture.
globalThis.__opcProbeReady = (async () => {
  if (globalThis.__opcLiveProbe) throw Error('Probe already installed; use __opcLiveProbe.stop() first.');
  const module = await import(chrome.runtime.getURL('ui/opc.js'));
  const horizontalModule = await import(chrome.runtime.getURL('ui/horizontal-timeline.js'));
  // Discover an existing controller on its next real method call. Do not force
  // a render/Fit to obtain it. DOM evidence remains available if no click lands.
  let timeline = null;
  const app = await import(chrome.runtime.getURL('ui/app.js'));
  const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const element = n => n?.nodeType === 1 ? { tag: n.tagName, id: n.id || null, class: typeof n.className === 'string' ? n.className : null, cardId: n.dataset.cardId ?? null } : null;
  const box = n => { const r = n?.getBoundingClientRect(); return r && { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const samples = [], events = [], calls = [], errors = [], restores = [];
  let active = true;
  const push = (list, value) => { if (active) { list.push(value); if (list.length > 300) list.shift(); } };
  const control = n => n?.closest?.('[aria-label="时间放大"],[aria-label="时间缩小"],.ht-point,.ht-density');
  function snapshot() {
    const h = timeline?.horizontal, appState = app.runtimeStateSnapshot?.(), modal = document.querySelector('dialog:modal');
    const dots = [...document.querySelectorAll('.ht-evidence-dot[data-time]')].map(n => ({ t: Date.parse(n.dataset.time), x: parseFloat(n.style.left) })).filter(p => Number.isFinite(p.t) && Number.isFinite(p.x));
    const first = dots[0], next = first && dots.find(p => p.t !== first.t), derivedScale = next ? (next.x - first.x) / (next.t - first.t) : null;
    const viewport = document.querySelector('.ht-scroll')?.clientWidth;
    const controls = Object.fromEntries(['时间放大', '时间缩小'].map(label => {
      const b = document.querySelector('[aria-label="' + label + '"]'), r = box(b), hit = r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return [label, { connected: b?.isConnected, disabled: b?.matches(':disabled'), inertAncestor: element(b?.closest('[inert]')), blockedByModal: Boolean(b && modal && !modal.contains(b)), pointerEvents: b && getComputedStyle(b).pointerEvents, zIndex: b && getComputedStyle(b).zIndex, hover: b?.matches(':hover'), box: r, hit: element(hit), hitsButton: Boolean(b && (b === hit || b.contains(hit))) }];
    }));
    return { time: performance.now(), page: location.pathname, entry: document.body.dataset.mode, projectId: timeline?.projectId ?? appState?.displayedProjectId ?? null, renderedProjectId: h?.projectId ?? null, selectedProjectId: document.querySelector('#project-select')?.value, scaleSource: h?.layout ? 'controller' : derivedScale > 0 ? 'derived-from-rendered-evidence-dots' : 'unavailable', pxPerMs: h?.layout?.pxPerMs ?? derivedScale, visibleSpan: h?.layout?.visibleSpan ?? (derivedScale > 0 ? (Math.max(240, viewport) - 48) / derivedScale : null), axisSpanMs: h?.preferences?.axisSpanMs ?? null, axisFit: h?.preferences?.axisFit ?? null, renderCount: h?.renderCount ?? null, controls, app: appState ?? 'unavailable in this loaded generation', dialogs: [...document.querySelectorAll('dialog[open]')].map(d => ({ ...element(d), modal: d.matches(':modal'), hidden: d.hidden, display: getComputedStyle(d).display, box: box(d) })), inertElements: [...document.querySelectorAll('[inert]')].slice(0, 20).map(element), nodes: [...document.querySelectorAll('.ht-point')].slice(0, 8).map(n => ({ ...element(n), left: parseFloat(n.style.left), box: box(n) })) };
  }
  const functions = {};
  for (const [name, object, methods] of [['OPCTimeline', module.OPCTimeline.prototype, ['show', 'load', 'render', 'openCard']], ['HorizontalTimeline', horizontalModule.HorizontalTimeline.prototype, ['zoom', 'render', 'resizeAfterInteraction']]]) for (const method of methods) {
    if (typeof object[method] === 'function') functions[name + '.' + method] = await hash(object[method].toString());
  }
  const styles = [];
  for (const sheet of document.styleSheets) {
    if (!sheet.href?.startsWith(chrome.runtime.getURL(''))) continue;
    try { styles.push({ path: new URL(sheet.href).pathname, parsedRulesSha256: await hash([...sheet.cssRules].map(r => r.cssText).join('\n')) }); } catch { styles.push({ path: new URL(sheet.href).pathname, unreadable: true }); }
  }
  const initial = snapshot();
  for (const [object, methods] of [[module.OPCTimeline.prototype, ['show', 'load', 'render', 'openCard']], [horizontalModule.HorizontalTimeline.prototype, ['zoom', 'render']]]) for (const method of methods) {
    const original = object[method], hadOwn = Object.hasOwn(object, method);
    const wrapped = function (...args) {
      const owner = this.owner ?? this;
      if (owner.host?.ownerDocument !== document || !owner.host.isConnected) return original.apply(this, args);
      timeline = owner;
      push(calls, { method, phase: 'before', projectId: timeline.projectId, state: snapshot() });
      let result;
      try { result = original.apply(this, args); } catch (error) { push(errors, { method, name: error.name }); throw error; }
      // Observe the original promise without replacing its identity or result.
      Promise.resolve(result).then(() => push(calls, { method, phase: 'after', projectId: timeline.projectId, state: snapshot() }), error => push(errors, { method, name: error.name }));
      return result;
    };
    object[method] = wrapped;
    restores.push(() => { if (object[method] === wrapped) { if (hadOwn) object[method] = original; else delete object[method]; } });
  }
  const listen = (target, type, fn) => { target.addEventListener(type, fn, true); restores.push(() => target.removeEventListener(type, fn, true)); };
  for (const type of ['pointerover', 'pointerdown', 'pointerup', 'pointercancel', 'click']) listen(document, type, e => {
    const node = control(e.target); if (!node) return;
    push(events, { type, time: performance.now(), pointerId: e.pointerId, buttons: e.buttons, trusted: e.isTrusted, projectId: timeline?.projectId ?? null, target: element(node), connected: node.isConnected, path: e.composedPath().filter(n => n.nodeType === 1).slice(0, 8).map(element), hit: element(document.elementFromPoint(e.clientX, e.clientY)) });
    requestAnimationFrame(() => push(samples, { trigger: type, originalTargetConnected: node.isConnected, ...snapshot() }));
  });
  listen(window, 'error', e => push(errors, { type: 'error', name: e.error?.name, file: e.filename?.startsWith(chrome.runtime.getURL('')) ? new URL(e.filename).pathname : 'external-or-unknown', line: e.lineno }));
  listen(window, 'unhandledrejection', e => push(errors, { type: 'unhandledrejection', name: e.reason?.name }));
  const onMessage = m => { if (['changed', 'viewChanged'].includes(m.event)) push(events, { type: 'notification', event: m.event, action: m.action, projectId: m.projectId, time: performance.now() }); };
  chrome.runtime.onMessage.addListener(onMessage); restores.push(() => chrome.runtime.onMessage.removeListener(onMessage));
  const metadata = { checkedAt: new Date().toISOString(), extensionId: chrome.runtime.id, runtimeManifestVersion: chrome.runtime.getManifest().version, visibleVersion: document.querySelector('.brand span')?.textContent.match(/\d+\.\d+\.\d+/)?.[0] ?? null, entry: location.pathname, functions, styles, scope: 'Original in-memory module fingerprints and passive event/state trace. Parsed CSS rule hashes are not raw file hashes. No Q/A bodies, history or storage contents.' };
  const report = () => ({ metadata, initial, current: snapshot(), samples, events, calls, errors });
  globalThis.__opcLiveProbe = { report, snapshot, stop() { const result = report(); active = false; restores.reverse().forEach(restore => restore()); delete globalThis.__opcLiveProbe; delete globalThis.__opcProbeReady; return result; } };
  // Older workers can reject this read-only diagnostic; preserve that evidence.
  metadata.worker = await chrome.runtime.sendMessage({ type: 'runtimeInfo', args: {} }).then(r => r?.ok ? r.data : { unavailable: true }, () => ({ unavailable: true }));
  return { metadata, initial, next: 'Manually hover and click +, −, then a visible Q/A. Run copy(__opcLiveProbe.stop()) to copy the trace and remove instrumentation.' };
})();
