import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist'), target = path.join(dist, 'ai-conversation-visual-navigator');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const packageMetadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.version, packageMetadata.version, 'Package and manifest versions differ');
const common = fs.readFileSync(path.join(root, 'domain/common.js'), 'utf8');
assert.equal(common.match(/EXTENSION_VERSION\s*=\s*'([^']+)'/)?.[1], manifest.version, 'Backup export version differs');
for (const page of ['workspace.html', 'sidepanel.html']) assert.ok(fs.readFileSync(path.join(root, page), 'utf8').includes(`本地对话资料库 · ${manifest.version}`), `Visible version differs in ${page}`);
const archiveName = `ai-conversation-visual-navigator-v${manifest.version}.zip`;
const archive = fs.readFileSync(path.join(dist, archiveName));
const staticReport = JSON.parse(fs.readFileSync(path.join(dist, 'STATIC_CHECK_REPORT.json'), 'utf8'));
assert.equal(staticReport.version, manifest.version);
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory()
    ? walk(path.join(directory, item.name)) : [path.join(directory, item.name)]);
}
const files = new Map(walk(target).map(file => [path.relative(target, file).split(path.sep).join('/'), fs.readFileSync(file)]));
assert.equal(files.size, staticReport.runtimeFiles, 'Install folder has unexpected files');
for (const [name, data] of files) {
  assert.ok(!/^(?:validation|scripts|dist)\//.test(name), `Validation-only content shipped: ${name}`);
  assert.ok(data.equals(fs.readFileSync(path.join(root, name))), `Install/source mismatch: ${name}`);
}
// Read the central directory of our standard, non-ZIP64 build archive and
// compare actual decompressed bytes rather than trusting the file list alone.
const end = archive.length - 22;
assert.equal(archive.readUInt32LE(end), 0x06054b50, 'ZIP ending missing');
assert.equal(archive.readUInt16LE(end + 10), files.size);
let cursor = archive.readUInt32LE(end + 16);
const centralSize = archive.readUInt32LE(end + 12), centralStart = cursor, seen = new Set();
for (let index = 0; index < files.size; index++) {
  assert.equal(archive.readUInt32LE(cursor), 0x02014b50, 'ZIP central entry missing');
  const method = archive.readUInt16LE(cursor + 10), size = archive.readUInt32LE(cursor + 20);
  const unpackedSize = archive.readUInt32LE(cursor + 24), nameLength = archive.readUInt16LE(cursor + 28);
  const extraLength = archive.readUInt16LE(cursor + 30), commentLength = archive.readUInt16LE(cursor + 32);
  const localOffset = archive.readUInt32LE(cursor + 42), name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
  assert.ok(files.has(name) && !seen.has(name), `Unknown or duplicate ZIP entry: ${name}`); seen.add(name);
  assert.equal(archive.readUInt32LE(localOffset), 0x04034b50);
  assert.equal(archive.readUInt16LE(localOffset + 8), method);
  const localNameLength = archive.readUInt16LE(localOffset + 26), localExtraLength = archive.readUInt16LE(localOffset + 28);
  assert.equal(archive.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8'), name);
  const dataStart = localOffset + 30 + localNameLength + localExtraLength, compressed = archive.subarray(dataStart, dataStart + size);
  assert.ok(method === 8 || method === 0, 'ZIP compression unsupported');
  const data = method === 8 ? inflateRawSync(compressed) : compressed;
  assert.equal(data.length, unpackedSize); assert.ok(data.equals(files.get(name)), `ZIP/install mismatch: ${name}`);
  cursor += 46 + nameLength + extraLength + commentLength;
}
assert.equal(cursor - centralStart, centralSize); assert.equal(cursor, end);
const sha256 = createHash('sha256').update(archive).digest('hex');
assert.ok(fs.readFileSync(path.join(dist, 'SHA256SUMS.txt'), 'utf8').includes(`${sha256}  ${archiveName}`));
const report = { version: manifest.version, checkedAt: new Date().toISOString(), passed: true, files: files.size,
  archive: archiveName, bytes: archive.length, sha256, checks: ['Version metadata consistent', 'Source/install directory byte equality',
    'All ZIP entries decompressed and compared to install directory', 'ZIP structure and SHA256 consistent', 'Validation fixtures/scripts excluded'],
  scope: 'Artifact integrity only; does not execute the installed extension' };
fs.writeFileSync(path.join(dist, 'PACKAGE_CHECK_REPORT.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
