import { describe, expect, it } from 'vitest';
import {
  countWords,
  decodeEntities,
  detectChapterHeading,
  detectLanguage,
  detectTextEncoding,
  escapeHtml,
  fileAsName,
  htmlToText,
  imageSize,
  isSceneBreak,
  languageTag,
  normalizeResourcePath,
  resolveZipPath,
  sanitizeHtml,
  slugify,
  splitParagraphs,
  truncateText,
  naturalCompare,
} from '../lib/engine/util';
import { tinyPng } from './engine.helpers';

describe('bytes / text primitives', () => {
  it('escapes and decodes entities round-trip', () => {
    const raw = `A & B <tag> "quoted" 'single'`;
    const escaped = escapeHtml(raw);
    expect(escaped).not.toContain('<tag>');
    expect(decodeEntities(escaped)).toBe(raw);
    expect(decodeEntities('&#20320;&#22909;&amp;&#x4e16;&#x754c;')).toBe('你好&世界');
    expect(decodeEntities('&hellip;&mdash;&nbsp;')).toBe('…—\u00a0');
  });

  it('truncates by characters without cutting the ellipsis', () => {
    expect(truncateText('一二三四五六七八九十', 6)).toBe('一二三四五…');
    expect(truncateText('short', 20)).toBe('short');
  });

  it('builds a romanised file-as name but leaves CJK untouched', () => {
    expect(fileAsName('Jane Austen')).toBe('Austen, Jane');
    expect(fileAsName('刘慈欣')).toBe('刘慈欣');
  });

  it('slugifies for filenames and keeps CJK', () => {
    expect(slugify('雨夜书店 / Rainy Night')).toBe('雨夜书店-rainy-night');
    expect(slugify('***')).toBe('book');
  });

  it('orders page names the way a human expects', () => {
    const names = ['page10.png', 'page2.png', 'page1.png'];
    expect(names.sort(naturalCompare)).toEqual(['page1.png', 'page2.png', 'page10.png']);
  });

  it('normalises and resolves archive paths', () => {
    expect(normalizeResourcePath('./images/../images/a b.jpg')).toBe('images/a b.jpg');
    expect(resolveZipPath('OEBPS/text', '../images/x.png')).toBe('OEBPS/images/x.png');
    expect(resolveZipPath('OEBPS', 'chapter.xhtml#frag')).toBe('OEBPS/chapter.xhtml');
  });
});

describe('text metrics', () => {
  it('counts CJK characters and latin words together', () => {
    expect(countWords('这是中文 hello world 123')).toBe(4 + 3);
  });

  it('detects language from a sample', () => {
    expect(detectLanguage('这是一段中文，用来测试语言检测。')).toBe('zh');
    expect(detectLanguage('This is an English paragraph about lighthouses.')).toBe('en');
    expect(languageTag('zh')).toBe('zh-CN');
    expect(languageTag('en-us')).toBe('en-US');
    expect(languageTag('not a language')).toBe('zh-CN');
  });
});

describe('encoding detection', () => {
  const gbBytes = new Uint8Array([
    181, 218, 210, 187, 213, 194, 32, 178, 226, 202, 212, 10, 10, 213, 226, 202, 199, 210, 187, 182,
    206, 214, 208, 206, 196, 206, 196, 215, 214, 163, 172, 211, 195, 192, 180, 188, 236, 178, 233,
    177, 224, 194, 235, 204, 189, 178, 226, 202, 199, 183, 241, 213, 253, 200, 183, 161, 163, 10,
  ]);
  const big5Bytes = new Uint8Array([
    178, 196, 164, 64, 179, 185, 32, 180, 250, 184, 213, 10, 10, 179, 111, 172, 79, 164, 64, 172,
    113, 164, 164, 164, 229, 164, 229, 166, 114, 161, 65, 165, 206, 168, 211, 192, 203, 172, 100,
    189, 115, 189, 88, 176, 187, 180, 250, 172, 79, 167, 95, 165, 191, 189, 84, 161, 67, 10,
  ]);

  it('honours a UTF-8 BOM', () => {
    const data = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('你好')]);
    expect(detectTextEncoding(data)).toMatchObject({ text: '你好', encoding: 'utf-8' });
  });

  it('honours a UTF-16LE BOM', () => {
    const data = new Uint8Array([0xff, 0xfe, 0x2c, 0x7b, 0x00, 0x4e, 0xe0, 0x7a]);
    expect(detectTextEncoding(data).text).toContain('第一章');
  });

  it('detects GB18030 (simplified) without a BOM', () => {
    const decoded = detectTextEncoding(gbBytes);
    expect(decoded.encoding).toBe('gb18030');
    expect(decoded.text).toContain('第一章 测试');
    expect(decoded.text).toContain('这是一段中文文字');
    expect(decoded.warnings[0]).toContain('GB18030');
  });

  it('detects Big5 (traditional) without a BOM', () => {
    const decoded = detectTextEncoding(big5Bytes);
    expect(decoded.encoding).toBe('big5');
    expect(decoded.text).toContain('第一章 測試');
    expect(decoded.text).toContain('這是一段中文文字');
  });

  it('decodes plain UTF-8 without warnings', () => {
    const decoded = detectTextEncoding(new TextEncoder().encode('普通 UTF-8 文本'));
    expect(decoded.encoding).toBe('utf-8');
    expect(decoded.warnings).toEqual([]);
  });
});

describe('paragraphs, chapters, scene breaks', () => {
  it('joins hard-wrapped Chinese lines without inventing spaces', () => {
    expect(splitParagraphs('第一行中文\n第二行中文\n\nHello\nworld')).toEqual([
      '第一行中文第二行中文',
      'Hello world',
    ]);
  });

  it('recognises Chinese, English and special chapter headings', () => {
    for (const line of [
      '第一章 初遇',
      '第12回',
      '第三卷',
      'Chapter 3',
      'CHAPTER IV',
      'CHAPTERXIII.',
      '序章',
      '楔子',
      '番外一',
      '尾声',
      'Prologue',
    ]) {
      expect(detectChapterHeading(line), line).not.toBeNull();
    }
    expect(detectChapterHeading('这是第一句话，不是标题。')).toBeNull();
    expect(detectChapterHeading('   ')).toBeNull();
    expect(detectChapterHeading('第一章 初遇')?.title).toBe('第一章 初遇');
    expect(detectChapterHeading('CHAPTERXIII.')?.title).toBe('CHAPTER XIII.');
  });

  it('detects the scene separators people actually type', () => {
    for (const line of ['***', '* * *', '---', '— — —', '◇◇◇', '###']) {
      expect(isSceneBreak(line), line).toBe(true);
    }
    expect(isSceneBreak('普通的一行文字')).toBe(false);
  });
});

describe('sanitiser', () => {
  const raw = `<html><head><title>t</title></head><body>
    <nav>菜单</nav>
    <div class="wrap"><h2 id="x">标题</h2>
    <p style="color:red" onclick="steal()">正文 <strong>粗</strong> &amp; <em>斜</em><script>alert(1)</script></p>
    <p>第二段<br>换行</p>
    <ul><li>一</li></ul>
    <blockquote>引用</blockquote>
    <table><tr><td colspan="2">格</td></tr></table>
    <a href="javascript:evil()">坏链接</a><a href="https://example.com">好链接</a>
    <img src="javascript:alert(1)"><img src="images/ok.png" alt="图">
    </div></body></html>`;

  it('keeps structure and drops scripts, styles, nav and handlers', () => {
    const { html } = sanitizeHtml(raw);
    expect(html).toContain('<h2>标题</h2>');
    expect(html).toContain('<strong>粗</strong>');
    expect(html).toContain('<em>斜</em>');
    expect(html).toContain('<blockquote>引用</blockquote>');
    expect(html).toContain('<td colspan="2">格</td>');
    expect(html).toContain('<img src="images/ok.png" alt="图"/>');
    expect(html).not.toContain('script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('菜单');
    expect(html).toContain('<a href="https://example.com">好链接</a>');
  });

  it('produces balanced XHTML for sloppy input', () => {
    const { html } = sanitizeHtml('<p>一<p>二<div>三</p></div><b>四');
    expect((html.match(/<p>/g) ?? []).length).toBe((html.match(/<\/p>/g) ?? []).length);
    expect((html.match(/<b>/g) ?? []).length).toBe((html.match(/<\/b>/g) ?? []).length);
  });

  it('lets the caller rewrite or drop images', () => {
    const dropped: string[] = [];
    const { html, droppedImages } = sanitizeHtml(
      '<p><img src="https://x/y.png"><img src="images/a.png"></p>',
      {
        resolveImage: (src) => (src.startsWith('http') ? null : `../${src}`),
        onImageDropped: (src) => dropped.push(src),
      },
    );
    expect(droppedImages).toBe(1);
    expect(dropped[0]).toContain('https://x/y.png');
    expect(html).toBe('<p><img src="../images/a.png" alt=""/></p>');
  });

  it('flattens markup to text with paragraph breaks', () => {
    expect(htmlToText('<p>一</p><p>二<br/>三</p><hr/><p>四</p>')).toBe('一\n二\n三\n\n***\n\n四');
  });
});

describe('image dimensions without native deps', () => {
  it('reads PNG size from the IHDR header', () => {
    const size = imageSize(tinyPng());
    expect(size).toEqual({ width: 64, height: 96, mediaType: 'image/png' });
  });

  it('returns null for non-images', () => {
    expect(imageSize(new TextEncoder().encode('not an image'))).toBeNull();
  });
});
