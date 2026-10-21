import { describe, expect, it } from 'vitest';
import { attachmentImage, confluenceLanguage, escapeXml, toStorage } from './confluenceStorage';

/** A tiny well-formedness check: CDATA removed, every tag closed in order, no stray `<` or `&`. */
function wellFormed(xml: string): boolean {
  const body = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<&]*(?:&(?:amp|lt|gt|quot|apos);[^"<&]*)*")*)\s*(\/?)>/g;
  let last = 0;
  for (const m of body.matchAll(tag)) {
    const between = body.slice(last, m.index);
    if (/<|&(?!(?:amp|lt|gt|quot|apos);)/.test(between)) return false;
    last = m.index + m[0].length;
    if (m[4]) continue;
    if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else stack.push(m[2]!);
  }
  const tail = body.slice(last);
  return stack.length === 0 && !/<|&(?!(?:amp|lt|gt|quot|apos);)/.test(tail);
}

describe('escapeXml', () => {
  it('escapes the five XML characters and drops characters XML forbids', () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe('a &amp; b &lt; c &gt; d &quot; e &apos; f');
    expect(escapeXml('a\u0000b\u0008c\u000bd\u001fe￾f￿g')).toBe('abcdefg');
    expect(escapeXml('tab\there\nnewline')).toBe('tab\there\nnewline');
    expect(escapeXml('ok 😀')).toBe('ok 😀');
    expect(escapeXml('lone \uD800 surrogate')).toBe('lone  surrogate');
  });
});

describe('toStorage', () => {
  it('converts headings, paragraphs and inline styles', () => {
    const xml = toStorage('# T\n\n###### H6\n\nUm **forte**, *ênfase*, ~~riscado~~ e `código`.');
    expect(xml).toContain('<h1>T</h1>');
    expect(xml).toContain('<h6>H6</h6>');
    expect(xml).toContain('<p>Um <strong>forte</strong>, <em>ênfase</em>, <span style="text-decoration: line-through;">riscado</span> e <code>código</code>.</p>');
    expect(wellFormed(xml)).toBe(true);
  });

  it('nests inline styles in a stable order', () => {
    expect(toStorage('***x***')).toContain('<strong><em>x</em></strong>');
    expect(toStorage('[**a**](https://x.com)')).toContain('<a href="https://x.com"><strong>a</strong></a>');
  });

  it('converts lists with nesting and tasks', () => {
    const xml = toStorage('- a\n  - a1\n- b\n\n1. um\n2. dois\n\n- [x] feito\n- [ ] fazer');
    expect(xml).toContain('<ul><li>a<ul><li>a1</li></ul></li><li>b</li></ul>');
    expect(xml).toContain('<ol><li>um</li><li>dois</li></ol>');
    expect(xml).toContain('<ac:task-list>');
    expect(xml).toMatch(/<ac:task><ac:task-id>1<\/ac:task-id><ac:task-status>complete<\/ac:task-status><ac:task-body>feito<\/ac:task-body><\/ac:task>/);
    expect(xml).toMatch(/<ac:task><ac:task-id>2<\/ac:task-id><ac:task-status>incomplete<\/ac:task-status><ac:task-body>fazer<\/ac:task-body><\/ac:task>/);
    expect(wellFormed(xml)).toBe(true);
  });

  it('wraps code in the code macro with CDATA, splitting a closing CDATA sequence', () => {
    const xml = toStorage('```ts\nconst a = "<b>" && 1;\n```');
    expect(xml).toBe('<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">javascript</ac:parameter><ac:plain-text-body><![CDATA[const a = "<b>" && 1;]]></ac:plain-text-body></ac:structured-macro>');
    const tricky = toStorage('```\na ]]> b\n```');
    expect(tricky).toContain('<![CDATA[a ]]]]><![CDATA[> b]]>');
    expect(tricky).not.toContain('<ac:parameter');
    expect(wellFormed(tricky)).toBe(true);
  });

  it('converts tables with header cells', () => {
    const xml = toStorage('| A | B |\n|---|---|\n| 1 | **2** |\n| 3 |');
    expect(xml).toBe('<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>1</td><td><strong>2</strong></td></tr><tr><td>3</td><td></td></tr></tbody></table>');
    expect(wellFormed(xml)).toBe(true);
  });

  it('converts quotes and rules', () => {
    const xml = toStorage('> citado\n\n---');
    expect(xml).toBe('<blockquote><p>citado</p></blockquote><hr />');
  });

  it('keeps a hard line break', () => {
    expect(toStorage('a  \nb')).toContain('<p>a<br />b</p>');
  });

  it('escapes everything the author typed (HTML, entities, CDATA, attributes)', () => {
    const xml = toStorage('<script>alert(1)</script> & <ac:structured-macro ac:name="html">\n\n[a"b](https://x.com/?q="x"&y=<z>)');
    expect(xml).not.toContain('<script');
    expect(xml).not.toContain('<ac:structured-macro ac:name="html">');
    expect(wellFormed(xml)).toBe(true);
    expect(xml).toContain('&lt;script&gt;');
  });

  it('never links a scheme other than http(s)', () => {
    const xml = toStorage('[x](javascript:alert(1)) [y](ri:attachment) [z](https://ok.com)');
    expect(xml).not.toContain('javascript');
    expect(xml.match(/<a /g)).toHaveLength(1);
    expect(xml).toContain('<a href="https://ok.com">z</a>');
  });

  it('prefixes the diagram image macro when asked', () => {
    const xml = toStorage('# T', { attachment: { filename: 'diagrama.svg', alt: 'Diagrama "A"' } });
    expect(xml.startsWith('<p><ac:image ac:alt="Diagrama &quot;A&quot;"><ri:attachment ri:filename="diagrama.svg" /></ac:image></p>')).toBe(true);
    expect(wellFormed(xml)).toBe(true);
  });

  it('is empty for an empty document', () => {
    expect(toStorage('')).toBe('');
  });

  it('produces well-formed XML for a realistic doc', () => {
    const md = '# Pagamentos\n\nTexto com [link](https://x.com/a?b=1&c=2) e `a<b`.\n\n- um\n  - dois & três\n\n```yaml\na: "b"\n```\n\n| x | y |\n|---|---|\n| <i> | & |\n\n> nota <b>\n';
    expect(wellFormed(toStorage(md))).toBe(true);
  });
});

describe('confluenceLanguage', () => {
  it('keeps only languages the code macro knows', () => {
    expect(confluenceLanguage('ts')).toBe('javascript');
    expect(confluenceLanguage('js')).toBe('javascript');
    expect(confluenceLanguage('sh')).toBe('bash');
    expect(confluenceLanguage('PYTHON')).toBe('python');
    expect(confluenceLanguage('yaml')).toBe('yaml');
    expect(confluenceLanguage('klingon')).toBeNull();
    expect(confluenceLanguage('')).toBeNull();
    expect(confluenceLanguage('__proto__')).toBeNull();
  });
});

describe('attachmentImage', () => {
  it('escapes the file name and alt text', () => {
    expect(attachmentImage({ filename: 'a"b.svg', alt: '<x>' })).toBe('<ac:image ac:alt="&lt;x&gt;"><ri:attachment ri:filename="a&quot;b.svg" /></ac:image>');
  });
});
