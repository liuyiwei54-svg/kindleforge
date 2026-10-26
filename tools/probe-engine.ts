/**
 * Lead's engine probe: converts a real Chinese TXT with the same code path the
 * browser worker uses, then inspects the EPUB's structure with plain zip reads.
 * Usage: npx tsx tools/probe-engine.ts
 */
import { writeFileSync } from 'node:fs';
import { convert } from '../lib/engine';
import JSZip from 'jszip';

const text = `铸书 · 测试样章

第一章 起风了

　　夜里十一点，城市还没有睡。她把最后一封邮件发出去，忽然想起很多年前在老家读到的一句话——
　　“书是随身携带的避难所。”

第二章 纸与光

　　Kindle 的屏幕不发光，它只是把光反射回来。这一点让它在深夜里显得格外安静。
　　“更绿色”不是一句口号：少一次上传，就少一份带宽与一台常开的服务器。

第三章 结尾

　　完。
`;

const input = { name: '铸书测试.txt', data: new Uint8Array(Buffer.from(text, 'utf8')) };

async function main() {
const started = Date.now();
const result = await convert(input, {
  target: 'epub',
  options: {
    typography: { indent: 2, lineHeight: 1.7, justify: true, fontFamily: 'serif' },
    device: 'paperwhite',
    toc: true,
    cover: true,
  },
});

writeFileSync('/tmp/probe-out.epub', result.data);
console.log('engine:', result.engine, 'ms:', result.durationMs, 'bytes:', result.data.length);
console.log('warnings:', result.warnings);
console.log('book:', result.book);

const zip = await JSZip.loadAsync(result.data);
const names = Object.keys(zip.files);
console.log('entries:', names.length);
const first = names[0];
const mimetype = await zip.files['mimetype'].async('string');
// Compression method lives on the private entry; 0 === STORED.
const method = (zip.files.mimetype as unknown as { _data?: { compressionMethod?: number } })._data
  ?.compressionMethod;
console.log('first entry:', first, '| mimetype:', mimetype.trim(), '| method:', method);

const opfName = names.find((n) => n.endsWith('.opf'));
if (opfName) {
  const opf = await zip.files[opfName].async('string');
  console.log('opf:', opfName, 'title:', /<dc:title[^>]*>([^<]+)/.exec(opf)?.[1]);
  console.log('has nav:', opf.includes('properties="nav"'), '| has ncx:', opf.includes('toc.ncx'));
}
const navName = names.find((n) => n.endsWith('nav.xhtml'));
if (navName) {
  const nav = await zip.files[navName].async('string');
  console.log('nav entries:', (nav.match(/<a\b/g) ?? []).length);
}
let chinese = false;
for (const n of names.filter((n) => n.endsWith('.xhtml') && !n.includes('nav'))) {
  const html = await zip.files[n].async('string');
  if (html.includes('避难所')) chinese = true;
}
console.log('chinese preserved:', chinese, '| total ms:', Date.now() - started);
}

main().catch((e) => { console.error(e); process.exit(1); });
