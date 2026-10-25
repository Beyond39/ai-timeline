// Validation only: real background dispatcher, UI and IndexedDB with synthetic
// tabs and DOM. Never packaged; never accesses a real ChatGPT tab.
import { isolateValidationDatabase } from './isolated-db.js';
import { adapterFixtures, createBrowserFixtureDocument } from './adapter-fixtures.mjs';
import { EXTENSION_VERSION } from '../domain/common.js';
import { fullConversationFixture } from './full-conversation-fixture.mjs';

const namespace = new URLSearchParams(location.search).get('validationDb');
const fullMode = new URLSearchParams(location.search).get('sourceFlow') === 'full';
if (!['localhost', '127.0.0.1'].includes(location.hostname) || !/^v04-(?:v101|v11)-[a-z0-9-]+$/.test(namespace ?? '')) throw new Error('Requires an isolated local source-flow database.');
isolateValidationDatabase(namespace);
const fixtures = ['v6-assistant-marker', 'reported-zero-markers'].map(key => adapterFixtures.find(row => row.key === key));
let index = 0, raceOnce = false, denyOnce = false, adapter;
const sourceId = 7, listeners = new Set();
const session = { captureTabId: sourceId, captureSource: { tabId: sourceId, url: 'https://chatgpt.com/c/previous-toolbar-selection' } };
const calls = [], summary = document.createElement('pre'); summary.id = 'source-flow-report'; summary.style.cssText = 'font-size:12px;max-height:140px;overflow:auto;white-space:pre-wrap';
const show = () => { summary.textContent = JSON.stringify({ extensionVersion: EXTENSION_VERSION, syntheticDataOnly: true, isolatedDatabase: `acvn-validation-${namespace}`, currentFixture: fixtures[index].key,
  selectedSource: session.captureSource, calls }, null, 2); };
const banner = document.createElement('details'); banner.open = true;
banner.style.cssText = 'padding:8px 16px;background:#fff7d6;font-size:13px';
const heading = document.createElement('summary'); heading.textContent = `V${EXTENSION_VERSION} ${fullMode ? '完整对话与四视图' : '旧DOM来源切换'}验证 · 合成来源，真实后台、UI 和隔离 IndexedDB`; banner.append(heading);
const switchSource = document.createElement('button'); switchSource.type = 'button'; switchSource.className = 'btn'; switchSource.textContent = '切换到合成对话 B';
switchSource.addEventListener('click', () => { index = 1; show(); });
const raceSource = document.createElement('button'); raceSource.type = 'button'; raceSource.className = 'btn'; raceSource.textContent = '模拟下次采集期间切页';
raceSource.addEventListener('click', () => { index = 0; raceOnce = true; show(); });
banner.append(switchSource, raceSource, summary); document.body.prepend(banner);
if (fullMode) {
  const deny = document.createElement('button'); deny.type = 'button'; deny.className = 'btn'; deny.textContent = '模拟完整记录访问失败'; deny.addEventListener('click', () => { denyOnce = true; });
  const verify = document.createElement('button'); verify.type = 'button'; verify.className = 'btn'; verify.textContent = '运行完整读取与四视图验证';
  const output = document.createElement('pre'); output.id = 'full-flow-check-result'; output.style.cssText = 'max-height:160px;overflow:auto;white-space:pre-wrap;font-size:12px';
  verify.addEventListener('click', async () => { verify.disabled = true; output.textContent = '正在验证…'; try { output.textContent = JSON.stringify(await (await import('./full-flow-browser-checks.js')).runFullFlowChecks(), null, 2); } catch (error) { output.textContent = error.stack; } finally { verify.disabled = false; } });
  banner.insertBefore(deny, summary); banner.insertBefore(verify, summary); banner.append(output);
} else document.getElementById('capture-kind').value = 'loaded';
const frame = document.createElement('iframe'); frame.title = '合成 ChatGPT DOM'; frame.style.cssText = 'position:absolute;left:-10000px;width:1000px;height:800px'; document.body.append(frame);
const preferenceKey = key => `${namespace}:${key}`;
const local = { async get(key) { return { [key]: JSON.parse(localStorage.getItem(preferenceKey(key)) ?? 'null') }; }, async set(values) { for (const [key, value] of Object.entries(values)) localStorage.setItem(preferenceKey(key), JSON.stringify(value)); } };
const getURL = value => new URL(value, location.origin + '/').href;
globalThis.chrome = {
  runtime: { id: 'synthetic-source-flow', getURL, onMessage: { addListener: listener => listeners.add(listener) },
    async sendMessage(message) {
      if (message.event) { for (const listener of listeners) listener(message, { id: 'synthetic-source-flow', url: getURL('workspace.html') }, () => {}); return; }
      const response = await new Promise(resolve => {
        for (const listener of listeners) if (listener(message, { id: 'synthetic-source-flow', url: getURL('workspace.html') }, resolve) === true) return;
        resolve({ ok: false, error: 'No background listener' });
      });
      if (['capture', 'captureSourceRebind', 'saveDraft'].includes(message.type)) {
        calls.push({ type: message.type, ok: response.ok, errorCode: response.errorCode ?? null,
          sourceTabId: message.type === 'capture' && response.ok ? session.captureSource.tabId : undefined,
          messages: response.data?.conversations?.[0]?.messages.length, branches: response.data?.conversations?.[0]?.paths.length,
          captureMode: response.data?.conversations?.[0]?.scope.captureMode,
          expectedSourceUrl: message.args?.expectedSourceUrl ?? null }); show();
      }
      return response;
    }
  },
  action: { onClicked: { addListener() {} } }, sidePanel: { async open() {} },
  storage: { local, session: { async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, session[key]])); }, async set(values) { Object.assign(session, values); show(); } } },
  tabs: { async query() { return [{ id: 2, url: getURL('workspace.html') }]; }, async get(id) { if (id !== sourceId) throw new Error('No tab with id'); return { id, url: fixtures[index].url, title: fixtures[index].label }; }, async create() { throw new Error('Validation does not open external tabs'); } },
  scripting: { async executeScript(options) {
    if (options.target.tabId !== sourceId) throw new Error('Unexpected source tab');
    if (options.world === 'MAIN') {
      const sourceURL = new URL(fixtures[index].url), id = sourceURL.pathname.match(/\/c\/([^/]+)/)[1];
      const data = fullConversationFixture({ id, rounds: 18, title: index === 0 ? '完整 Conversation · 自动问答与四种视图 · 合成' : '另一条完整 Conversation · 合成' });
      const denial = denyOnce; denyOnce = false;
      if (raceOnce) { index = 1; sourceURL.href = fixtures[index].url; raceOnce = false; }
      const fakeFetch = async target => {
        const sessionRequest = new URL(target).pathname === '/api/auth/session';
        const status = !sessionRequest && denial ? 403 : 200;
        return { ok: status === 200, status, headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify(sessionRequest ? { accessToken: 'isolated-validation-credential' } : data) };
      };
      const invoke = new Function('location', 'document', 'fetch', 'AbortController', 'setTimeout', 'clearTimeout', 'URL', 'options', `return (${options.func.toString()})(options);`);
      return [{ frameId: 0, result: await invoke(sourceURL, { title: data.title, cookie: '' }, fakeFetch, AbortController, setTimeout, clearTimeout, URL, options.args[0]) }];
    }
    if (options.files) {
      const fixture = fixtures[index], fixtureDocument = createBrowserFixtureDocument(fixture, frame.contentDocument);
      const source = await (await fetch('/adapters/chatgpt.js', { cache: 'no-store' })).text();
      const load = new Function('location', 'document', 'getComputedStyle', 'Node', 'setTimeout', source + '\nreturn globalThis.__ACVN_CHATGPT__;');
      const adapterLocation = new URL(fixture.url);
      adapter = load(adapterLocation, fixtureDocument, frame.contentWindow.getComputedStyle.bind(frame.contentWindow), frame.contentWindow.Node, setTimeout);
      if (raceOnce) { index = 1; adapterLocation.href = fixtures[index].url; raceOnce = false; }
      return [];
    }
    return [{ frameId: 0, result: await adapter.collect(options.args[0]) }];
  } }
};
show();
await import('../background.js');
await import('../ui/app.js');
