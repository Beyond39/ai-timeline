// Build and static validation only. Never import application modules or start a browser.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceTextModule } from 'node:vm';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const entries = ['manifest.json', 'background.js', 'sidepanel.html', 'workspace.html', 'print.html', 'adapters', 'analysis', 'domain', 'exports', 'importers', 'storage', 'ui', 'vendor', 'icons', 'README.md', 'docs'];
function walk(directory) { return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(item => item.isDirectory() ? walk(path.join(directory, item.name)) : [path.join(directory, item.name)]); }
function local(relative, from = root) {
  const resolved = path.resolve(from, relative);
  if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) throw new Error(`Missing or nonlocal package reference: ${relative}`);
  return resolved;
}
const files = entries.flatMap(name => { const absolute = local(name); return fs.statSync(absolute).isDirectory() ? walk(absolute) : [absolute]; });
const manifest = JSON.parse(fs.readFileSync(local('manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3 || manifest.background.type !== 'module') throw new Error('Expected a Manifest V3 module service worker.');
if (manifest.host_permissions?.length || manifest.content_scripts?.length) throw new Error('First version must use explicit activeTab collection.');
for (const target of [manifest.background.service_worker, manifest.side_panel.default_path, manifest.options_ui.page, ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) local(target);
let javascript = 0, moduleReferences = 0;
const modules = new Map();
for (const file of files.filter(file => /\.(js|mjs)$/.test(file))) {
  const code = fs.readFileSync(file, 'utf8');
  const vendoredKaTeX = path.relative(root, file) === path.join('vendor', 'katex', 'katex.mjs');
  if (vendoredKaTeX && createHash('sha256').update(code).digest('hex') !== 'e5bc26598084ad869939ecaa262673814f26ed586312a409b5f8427c01e4f681') throw new Error('Vendored KaTeX 0.19.0 checksum changed. Review provenance before updating.');
  const module = new SourceTextModule(code, { identifier: file }); modules.set(file, module); javascript++;
  for (const specifier of module.dependencySpecifiers) { local(specifier, path.dirname(file)); moduleReferences++; }
  if (/\b(?:eval\s*\(|new\s+Function\s*\(|XMLHttpRequest\s*\()/m.test(code)) throw new Error(`Unexpected remote or dynamic-code primitive: ${file}`);
  // KaTeX's Parser.fetch is token consumption; only its pinned distribution
  // may contain that method name. Browser networking is still limited to capture.
  if (/\bfetch\s*\(/m.test(code) && path.relative(root, file) !== path.join('adapters', 'conversation-data.js') && !vendoredKaTeX) throw new Error(`Unexpected network request: ${file}`);
}
for (const module of modules.values()) if (module.status === 'unlinked') await module.link((specifier, from) => {
  const dependency = modules.get(local(specifier, path.dirname(from.identifier)));
  if (!dependency) throw new Error(`ES module is not in the package: ${specifier}`);
  return dependency;
});
// There is intentionally no module.evaluate(): this is syntax / export linkage inspection.
for (const name of ['sidepanel.html', 'workspace.html']) {
  const text = fs.readFileSync(local(name), 'utf8');
  for (const match of text.matchAll(/(?:src|href)="([^"]+)"/g)) local(match[1]);
  if (/\son\w+\s*=|javascript:|<script\b[^>]*>\s*[^<\s]/i.test(text)) throw new Error(`Inline JavaScript is not allowed: ${name}`);
  const ids = [...text.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate UI ID: ${name}`);
  const code = fs.readFileSync(local('ui/app.js'), 'utf8') + fs.readFileSync(local('ui/dom.js'), 'utf8');
  for (const match of code.matchAll(/(?:\$|querySelector)\(['"]#([a-z][\w-]*)['"]\)/g)) if (!ids.includes(match[1])) throw new Error(`Missing UI hook ${match[1]} in ${name}`);
}
for (const [size, filename] of Object.entries(manifest.icons)) {
  const png = fs.readFileSync(local(filename));
  if (png.readUInt32BE(16) !== Number(size) || png.readUInt32BE(20) !== Number(size)) throw new Error(`Incorrect icon dimensions: ${filename}`);
}
const report = { version: manifest.version, checkedAt: new Date().toISOString(), runtimeFiles: files.length, javascriptFiles: javascript,
  scope: 'Build/static inspection only. Functional results are separate: core/regression/adapter/reader/navigation/document/outline Node reports and V07_* browser reports. Local browser bridge and synthetic fixtures are not live GPT/MV3/download/print/Word verification.',
  moduleReferences, checks: ['JavaScript syntax and ES module linkage (VM parse/link, no evaluation)', 'Local ES module and manifest references', 'HTML assets and UI element hooks', 'No inline scripts / remote execution primitives', 'PNG dimensions'],
  automatedTestsRun: false, endToEndTestsRun: false, browserFunctionTestsRun: false, applicationCodeExecuted: false };
console.log(`Static checks passed: ${javascript} JS files, ${moduleReferences} local module references, ${files.length} package files.`);
if (checkOnly) process.exit(0);
const dist = path.resolve(root, 'dist');
const target = path.resolve(dist, 'ai-conversation-visual-navigator');
if (target !== path.join(root, 'dist', 'ai-conversation-visual-navigator')) throw new Error('Output path validation failed.');
fs.mkdirSync(target, { recursive: true });
for (const source of files) { const destination = path.join(target, path.relative(root, source)); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(source, destination); }
fs.writeFileSync(path.join(dist, 'STATIC_CHECK_REPORT.json'), JSON.stringify(report, null, 2));
const expected = new Set(files.map(file => path.relative(root, file)));
const extras = walk(target).filter(file => !expected.has(path.relative(target, file)));
if (extras.length) throw new Error('Existing build directory contains obsolete files. Move it aside before rebuilding.');
const crcTable = Array.from({ length: 256 }, (_, i) => { let v = i; for (let j = 0; j < 8; j++) v = (v >>> 1) ^ ((v & 1) ? 0xedb88320 : 0); return v >>> 0; });
function crc32(data) { let crc = 0xffffffff; for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]; return (crc ^ 0xffffffff) >>> 0; }
const chunks = [], central = []; let offset = 0;
for (const source of files) {
  const name = Buffer.from(path.relative(root, source).replaceAll(path.sep, '/')), data = fs.readFileSync(source), compressed = deflateRawSync(data), crc = crc32(data);
  const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0x21, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
  chunks.push(header, name, compressed);
  const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10);
  directory.writeUInt16LE(0x21, 14); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
  central.push(directory, name); offset += header.length + name.length + compressed.length;
}
const centralBuffer = Buffer.concat(central), ending = Buffer.alloc(22);
ending.writeUInt32LE(0x06054b50); ending.writeUInt16LE(files.length, 8); ending.writeUInt16LE(files.length, 10); ending.writeUInt32LE(centralBuffer.length, 12); ending.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...chunks, centralBuffer, ending]), archiveName = `ai-conversation-visual-navigator-v${manifest.version}.zip`;
fs.writeFileSync(path.join(dist, archiveName), archive);
fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), `${createHash('sha256').update(archive).digest('hex')}  ${archiveName}\n`);
console.log(`Loadable folder: ${target}`); console.log(`ZIP: ${path.join(dist, archiveName)}`);
