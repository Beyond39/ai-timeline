// ZIP "store" records work offline in both extension pages and service workers.
// ZIP64 is deliberately rejected rather than emitting a corrupt large archive.
const encoder = new TextEncoder();
const crcTable = Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); return value >>> 0; });
export function crc32(data) { let crc = 0xffffffff; for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]; return (crc ^ 0xffffffff) >>> 0; }
function record(size) { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) }; }
export function createStoredZip(files) {
  const records = Object.entries(files); if (records.length > 65535) throw new Error('导出文件数超过 ZIP 支持范围。');
  const localChunks = [], centralChunks = []; let offset = 0;
  for (const [path, value] of records) {
    const name = encoder.encode(path), data = typeof value === 'string' ? encoder.encode(value) : value;
    if (!(data instanceof Uint8Array) || name.length > 65535 || data.length > 0xffffffff) throw new Error('导出内容超过 ZIP 支持范围。');
    const checksum = crc32(data), local = record(30), directory = record(46);
    local.view.setUint32(0, 0x04034b50, true); local.view.setUint16(4, 20, true); local.view.setUint16(6, 0x800, true); local.view.setUint16(12, 0x21, true);
    local.view.setUint32(14, checksum, true); local.view.setUint32(18, data.length, true); local.view.setUint32(22, data.length, true); local.view.setUint16(26, name.length, true);
    directory.view.setUint32(0, 0x02014b50, true); directory.view.setUint16(4, 20, true); directory.view.setUint16(6, 20, true); directory.view.setUint16(8, 0x800, true); directory.view.setUint16(14, 0x21, true);
    directory.view.setUint32(16, checksum, true); directory.view.setUint32(20, data.length, true); directory.view.setUint32(24, data.length, true); directory.view.setUint16(28, name.length, true); directory.view.setUint32(42, offset, true);
    localChunks.push(local.bytes, name, data); centralChunks.push(directory.bytes, name); offset += local.bytes.length + name.length + data.length;
    if (offset > 0xffffffff) throw new Error('导出文件过大，请缩小导出范围。');
  }
  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0), ending = record(22);
  ending.view.setUint32(0, 0x06054b50, true); ending.view.setUint16(8, records.length, true); ending.view.setUint16(10, records.length, true); ending.view.setUint32(12, centralSize, true); ending.view.setUint32(16, offset, true);
  const output = new Uint8Array(offset + centralSize + ending.bytes.length); let position = 0;
  for (const chunk of [...localChunks, ...centralChunks, ending.bytes]) { output.set(chunk, position); position += chunk.length; }
  return output;
}
