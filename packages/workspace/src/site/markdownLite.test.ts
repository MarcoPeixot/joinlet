import { describe, expect, it } from 'vitest';
import { renderMarkdownLite } from './markdownLite';

const docs = (slug: string) => (slug === 'api' ? '../docs/api.html' : null);
const render = (md: string) => renderMarkdownLite(md, { resolveDoc: docs });

const TAGS = new Set(['h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'pre', 'code', 'strong', 'em', 'blockquote', 'hr', 'a', 'br']);
/** Every `<` in the output must start one of OUR tags, with only our attributes: text is escaped, so this is the whole surface. */
function expectSafe(html: string): void {
  for (const m of html.matchAll(/<(\/?)([a-zA-Z0-9]*)([^>]*)>/g)) {
    expect(TAGS.has(m[2]!.toLowerCase()), `tag ${m[0]}`).toBe(true);
    if (m[2] === 'a' && !m[1]) expect(m[3]).toMatch(/^ href="(?:https?:\/\/[^"<>\s]*|\.\.\/docs\/[A-Za-z0-9._~-]+\.html)" rel="noopener noreferrer"( target="_blank")?$/i);
    else expect(m[3]).toBe('');
  }
}

describe('renderMarkdownLite', () => {
  it('renders the supported blocks', () => {
    const html = render('# Título\n\nUm **forte** e *itálico* com `código`.\n\n- a\n- b\n\n1. um\n2. dois\n\n> citação\n\n---\n\n```ts\nconst a = 1 < 2;\n```');
    expect(html).toContain('<h2>Título</h2>');
    expect(html).toContain('<p>Um <strong>forte</strong> e <em>itálico</em> com <code>código</code>.</p>');
    expect(html).toContain('<ul><li>a</li><li>b</li></ul>');
    expect(html).toContain('<ol><li>um</li><li>dois</li></ol>');
    expect(html).toContain('<blockquote><p>citação</p></blockquote>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<pre><code>const a = 1 &lt; 2;</code></pre>');
    expectSafe(html);
  });

  it('links http(s) with rel/target and rewrites doc: only for existing docs', () => {
    const html = render('[site](https://exemplo.com/a?x=1&y=2) [api](doc:api) [nada](doc:nada) [x](HTTP://A.com)');
    expect(html).toContain('<a href="https://exemplo.com/a?x=1&amp;y=2" rel="noopener noreferrer" target="_blank">site</a>');
    expect(html).toContain('<a href="../docs/api.html" rel="noopener noreferrer">api</a>');
    expect(html).toContain(' nada ');
    expect(html).not.toContain('doc:nada');
    expect(html).toContain('href="HTTP://A.com"');
    expectSafe(html);
  });

  const hostile: [string, string][] = [
    ['script', '<script>alert(1)</script>'],
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['js link', '[x](javascript:alert(1))'],
    ['js link spaced', '[x](  javascript:alert(1))'],
    ['js link tab', '[x](java\tscript:alert(1))'],
    ['js link entity', '[x](&#106;avascript:alert(1))'],
    ['js link upper', '[x](JAVASCRIPT:alert(1))'],
    ['js link ctrl', '[x](\u0001javascript:alert(1))'],
    ['data link', '[x](data:text/html;base64,PHNjcmlwdD4=)'],
    ['vbscript', '[x](vbscript:msgbox)'],
    ['protocol relative', '[x](//evil.com)'],
    ['image', '![x](https://evil.com/a.png)'],
    ['attr breakout', '[x](https://a.com/"onmouseover="alert(1))'],
    ['quote in url', "[x](https://a.com/'><script>alert(1)</script>)"],
    ['label breakout', '[<script>alert(1)</script>](https://a.com)'],
    ['code breakout', '`</code><script>alert(1)</script>`'],
    ['fence breakout', '```\n</code></pre><script>alert(1)</script>\n```'],
    ['html block', '<div onclick="x()">oi</div>'],
    ['entity', '&lt;script&gt;alert(1)&lt;/script&gt; &#60;script&#62;'],
    ['unbalanced fence', '```\n<script>alert(1)</script>'],
    ['heading', '# <img src=x onerror=alert(1)>'],
    ['list', '- <svg onload=alert(1)>'],
    ['doc link weird', '[x](doc:../../etc/passwd) [y](doc:api" onclick="x)'],
  ];
  it.each(hostile)('neutralises: %s', (_name, md) => {
    const html = render(md);
    expectSafe(html);
    expect(html).not.toMatch(/<(script|img|svg|div|iframe)/i);
  });

  it('never emits a non-http(s)/doc href', () => {
    for (const [, md] of hostile) for (const m of render(md).matchAll(/href="([^"]*)"/g)) expect(m[1]).toMatch(/^(https?:\/\/|\.\.\/docs\/)/i);
  });

  it('is linear on emphasis, bracket and backtick bombs', () => {
    for (const bomb of ['*'.repeat(50_000), '**'.repeat(25_000), '*a'.repeat(25_000), '['.repeat(50_000), '[a](b'.repeat(10_000), '`'.repeat(50_000), '`a'.repeat(25_000), '_*'.repeat(25_000), '[x](https://a.com)'.repeat(2000)]) {
      const start = performance.now();
      expectSafe(render(bomb));
      expect(performance.now() - start).toBeLessThan(1500);
    }
  });

  it('handles a 1 MB single line and many lines quickly and bounded', () => {
    const start = performance.now();
    const html = render('a '.repeat(500_000));
    expect(html.length).toBeLessThan(1_200_000);
    expect(render(`${'- x\n'.repeat(200_000)}`).length).toBeGreaterThan(0);
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it('notes truncation of huge input in pt-BR', () => {
    expect(render('a\n\n'.repeat(400_000))).toContain('conteúdo truncado');
  });

  it('closes unbalanced fences and tolerates empty input, CRLF and control chars', () => {
    expect(render('```\nabc')).toBe('<pre><code>abc</code></pre>');
    expect(render('')).toBe('');
    expect(render('a\r\nb')).toBe('<p>a\nb</p>');
    expect(render('a\u0000b‮ok')).toBe('<p>abok</p>');
  });
});

describe('heading trailing hashes', () => {
  it('strips closing hashes only when preceded by a space', () => {
    expect(render('## Title ##  ')).toContain('<h3>Title</h3>');
    expect(render('## C#')).toContain('<h3>C#</h3>');
    expect(render('## ###')).not.toContain('<h3></h3>');
  });

  it('is linear on a long run of spaces', () => {
    const start = performance.now();
    render(`## a${' '.repeat(100_000)}b`);
    render(`## a${' '.repeat(100_000)}#`);
    expect(performance.now() - start).toBeLessThan(300);
  });
});
