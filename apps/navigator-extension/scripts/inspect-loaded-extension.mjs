// Read extension registration metadata only. Never open history, cookies, chat
// stores, preferences unrelated to OPC, or a live browser's IndexedDB.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const roots = process.argv.slice(2).filter(a=>!a.startsWith('--'));
const output = process.argv.find(a=>a.startsWith('--report='))?.slice(9) ?? 'dist/P0_LOADED_EXTENSION_AUDIT.json';
const workspace = path.resolve(import.meta.dirname,'..');
if (!roots.length) throw new Error('Pass the browser User Data root(s) explicitly.');
const hash = file => fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
const files = ['manifest.json','workspace.html','sidepanel.html','background.js','ui/app.js','ui/opc.js','ui/horizontal-timeline.js','ui/workbench.css','ui/workspace.css','ui/v1-workspace.css','ui/v07-workspace.css','ui/panel-close.js','domain/change-notification.js','domain/runtime-build.js'];
const result = { checkedAt: new Date().toISOString(), workspace, runtimeStatus:'NOT TESTED: registration and disk do not identify the in-memory page or worker generation.', scope: 'Read-only OPC extension registration and code hashes; no private Q/A or browser history.', browsers: [] };
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  const localStatePath = path.join(root, 'Local State');
  const localState = fs.existsSync(localStatePath) ? JSON.parse(fs.readFileSync(localStatePath, 'utf8')) : {};
  const profiles = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && /^(Default|Profile \d+)$/.test(e.name)).map(e => e.name);
  const browser = { root, lastUsedProfile: localState.profile?.last_used, lastActiveProfiles: localState.profile?.last_active_profiles, extensions: [] };
  for (const profile of profiles) for (const name of ['Preferences', 'Secure Preferences']) {
    const pref = path.join(root, profile, name); if (!fs.existsSync(pref)) continue;
    const data = JSON.parse(fs.readFileSync(pref, 'utf8'));
    for (const [id, e] of Object.entries(data.extensions?.settings ?? {})) {
      const directory = path.isAbsolute(e.path ?? '') ? e.path : path.join(root, profile, 'Extensions', e.path ?? '');
      const manifestPath = path.join(directory, 'manifest.json'), disk = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
      if (e.manifest?.name !== 'OPC Timeline' && disk?.name !== 'OPC Timeline' && !String(e.path).includes('navigator-extension')) continue;
      browser.extensions.push({ profile, metadataFile: name, id, state: e.state ?? null, location: e.location, path: directory, registeredVersion: e.manifest?.version ?? null, registeredVersionName: e.manifest?.version_name ?? null, diskVersion: disk?.version, code: Object.fromEntries(files.map(file => { const sha256=hash(path.join(directory,file));return [file,{sha256,matchesWorkspace:sha256!==null&&sha256===hash(path.join(workspace,file))}]; })) });
    }
  }
  result.browsers.push(browser);
}
fs.writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
