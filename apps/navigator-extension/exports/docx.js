import { DOCX_MIME, includedChapters, roleLabel, sourceLines, entrySources, escapeXml as x, entryBlocks, inlineStructure, safeExportLink } from './content.js';
import { createStoredZip } from './zip.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xml = value => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`;
const relation = (id, type, target, external = false) => `<Relationship Id="${x(id)}" Type="${R}/${type}" Target="${x(target)}"${external ? ' TargetMode="External"' : ''}/>`;
const PAGE_WIDTH = 9360;

const styles = xml(`<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:widowControl/><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="200"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="160"/></w:pPr><w:rPr><w:color w:val="000000"/><w:sz w:val="24"/></w:rPr></w:style>
${[1, 2, 3, 4, 5, 6].map(level => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${level === 1 ? 280 : 180}" w:after="100"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="${level === 1 ? 30 : level === 2 ? 26 : 23}"/></w:rPr></w:style>`).join('')}
<w:style w:type="paragraph" w:styleId="MessageLabel"><w:name w:val="Message label"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="342A65"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:fill="F3F4F6"/><w:wordWrap w:val="0"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:fill="F7F7FA"/><w:ind w:left="360"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Source"><w:name w:val="Source"/><w:basedOn w:val="Normal"/><w:pPr><w:wordWrap w:val="0"/><w:spacing w:after="60" w:line="270" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="52525B"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2255AA"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`);

export function createDocxBytes(spec) {
  const chapters = includedChapters(spec), links = new Map(), numbers = [];
  function hyperlink(href) { if (!links.has(href)) links.set(href, `link${links.size + 1}`); return links.get(href); }
  function run(part) {
    const properties = `${part.href ? '<w:rStyle w:val="Hyperlink"/>' : ''}${part.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei"/>' : ''}${part.bold ? '<w:b/>' : ''}${part.italic ? '<w:i/>' : ''}${part.code ? '<w:shd w:fill="F3F4F6"/>' : ''}`;
    const value = String(part.text ?? '').replace(/\r\n?/g, '\n');
    const text = value.split(/(\n|\t)/).map(piece => piece === '\n' ? '<w:br/>' : piece === '\t' ? '<w:tab/>' : `<w:t xml:space="preserve">${x(piece)}</w:t>`).join('');
    const body = `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}${text}</w:r>`;
    return part.href ? `<w:hyperlink r:id="${hyperlink(part.href)}">${body}</w:hyperlink>` : body;
  }
  function paragraph(text, style = 'Normal', markdown = false, properties = '', structure = null) {
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${properties}</w:pPr>${inlineStructure(text, markdown, structure).map(run).join('')}</w:p>`;
  }
  function listNumber(block) {
    const id = numbers.length + 1; numbers.push({ id, ordered: block.ordered, start: Number.isInteger(block.start) && block.start >= 0 ? block.start : 1 }); return id;
  }
  function table(block, markdown) {
    const rows = [...(block.headers.length ? [block.headers] : []), ...block.rows];
    const count = rows.reduce((max, row) => Math.max(max, row.length), 1), cellWidth = Math.floor(PAGE_WIDTH / count);
    const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => `<w:${side} w:val="single" w:sz="4" w:color="D4D4D8"/>`).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="${PAGE_WIDTH}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array.from({ length: count }, () => `<w:gridCol w:w="${cellWidth}"/>`).join('')}</w:tblGrid>${rows.map((row, index) => `<w:tr>${index === 0 && block.headers.length ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${Array.from({ length: count }, (_, column) => `<w:tc><w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/>${index === 0 && block.headers.length ? '<w:shd w:fill="F0F0F4"/>' : ''}</w:tcPr>${paragraph(row[column] ?? '', 'Normal', markdown, '<w:wordWrap w:val="0"/>')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>${paragraph('')}`;
  }
  function blocksXml(blocks, markdown) {
    return blocks.map(block => {
      if (block.type === 'heading') return paragraph(block.text, `Heading${Math.min(6, Math.max(3, Number(block.level) + 2 || 3))}`, markdown, '', block.inline);
      if (block.type === 'code') return `${block.language ? paragraph(block.language, 'Source') : ''}${String(block.text).replace(/\r\n?/g, '\n').split('\n').map(line => paragraph(line, 'Code')).join('')}${paragraph('')}`;
      if (block.type === 'table') return table(block, markdown);
      if (block.type === 'list') { const id = listNumber(block); return block.items.map(item => paragraph(item, 'Normal', markdown, `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`)).join(''); }
      if (block.type === 'quote') return block.blocks && markdown ? blocksXml(block.blocks, markdown).replaceAll('<w:pStyle w:val="Normal"/>', '<w:pStyle w:val="Quote"/>') : paragraph(block.text, 'Quote', markdown, '', block.inline);
      if (block.type === 'rule') return paragraph('────────');
      return paragraph(block.text ?? '', 'Normal', markdown, '', block.inline);
    }).join('');
  }
  const body = [paragraph(spec.title, 'Title')];
  if (spec.subtitle) body.push(paragraph(spec.subtitle, 'Subtitle'));
  body.push(paragraph(`本地项目：${spec.project?.name || '未命名项目'}；导出快照时间：${spec.createdAt || '未知'}`, 'Source'));
  const sources = []; let index = 0;
  for (const chapter of chapters) {
    body.push(paragraph(chapter.title, 'Heading1'));
    for (const entry of chapter.entries) {
      const number = ++index;
      body.push(paragraph(`${roleLabel(entry.source)}${spec.includeSourceAppendix ? ` · 来源 ${number}` : ''}`, 'MessageLabel'));
      const parsed = entryBlocks(entry); body.push(blocksXml(parsed.blocks, parsed.markdown)); sources.push(...entrySources(entry, number));
    }
  }
  if (spec.includeSourceAppendix && sources.length) {
    body.push(paragraph('来源与正文版本', 'Heading1'));
    for (const { source, number } of sources) {
      const lines = sourceLines(source, number);
      body.push(paragraph(lines[0], 'Heading2'));
      const href = safeExportLink(source.sourceUrl);
      body.push(href ? `<w:p><w:pPr><w:pStyle w:val="Source"/></w:pPr>${run({ text: '来源地址：' })}${run({ text: source.sourceUrl, href })}</w:p>` : paragraph(lines[1], 'Source'));
      body.push(...lines.slice(2).map(line => paragraph(line, 'Source')));
    }
  }
  const document = xml(`<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1273" w:bottom="1134" w:left="1273" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  const numbering = xml(`<w:numbering xmlns:w="${W}">${numbers.map(number => `<w:abstractNum w:abstractNumId="${number.id}"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="${number.start}"/><w:numFmt w:val="${number.ordered ? 'decimal' : 'bullet'}"/><w:lvlText w:val="${number.ordered ? '%1.' : '•'}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="360"/></w:tabs><w:ind w:left="360" w:hanging="240"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="${number.id}"><w:abstractNumId w:val="${number.id}"/></w:num>`).join('')}</w:numbering>`);
  const created = spec.createdAt && Number.isFinite(new Date(spec.createdAt).getTime()) ? new Date(spec.createdAt).toISOString() : null;
  // Raw text is retained verbatim in a local custom XML part. Prompt filtering is
  // applied before embedding, and opting out sources removes hidden URLs/IDs.
  const archive = { schemaVersion: 1, title: spec.title, chapters: chapters.map(chapter => ({ title: chapter.title, entries: chapter.entries.map(entry => ({ text: entry.text, presentation: entry.presentation ?? null, ...(spec.includeSourceAppendix ? { source: entry.source } : { role: entry.source.role, roleUnverified: entry.source.roleUnverified, confirmedRole: entry.source.confirmedRole }) })) })) };
  const files = {
    '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'),
    '_rels/.rels': xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relation('document', 'officeDocument', 'word/document.xml')}<Relationship Id="core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>${relation('app', 'extended-properties', 'docProps/app.xml')}</Relationships>`),
    'word/document.xml': document,
    'word/styles.xml': styles,
    'word/numbering.xml': numbering,
    'word/_rels/document.xml.rels': xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relation('styles', 'styles', 'styles.xml')}${relation('numbering', 'numbering', 'numbering.xml')}${relation('originalText', 'customXml', '../customXml/item1.xml')}${[...links].map(([href, id]) => relation(id, 'hyperlink', href, true)).join('')}</Relationships>`),
    'docProps/core.xml': xml(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(spec.title)}</dc:title><dc:creator>对话航图</dc:creator>${created ? `<dcterms:created xsi:type="dcterms:W3CDTF">${x(created)}</dcterms:created>` : ''}</cp:coreProperties>`),
    'docProps/app.xml': xml('<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>对话航图</Application></Properties>'),
    'customXml/item1.xml': xml(`<acvn:originalText xmlns:acvn="urn:acvn:document:1">${x(JSON.stringify(archive))}</acvn:originalText>`)
  };
  return createStoredZip(files);
}
export function createDocxBlob(spec) { return new Blob([createDocxBytes(spec)], { type: DOCX_MIME }); }
