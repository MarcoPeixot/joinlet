import { describe, expect, it } from 'vitest';
import { parseCitationHref } from '../chat/citationAddress';
import { escapeHtml, hrefRule, renderMarkdown } from './markdown';

const cites = (href: string) => parseCitationHref(href) !== null;

describe('renderMarkdown before the sanitizer loads', () => {
  it('returns escaped text, never raw HTML', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> **b**');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
  it('escapes quotes and ampersands', () => {
    expect(escapeHtml(`a&b"c'd`)).toBe('a&amp;b&quot;c&#39;d');
  });
});

describe('hrefRule (what the sanitizer does with a link)', () => {
  it.each([
    ['https://example.com/a', false, 'web'],
    ['http://example.com', true, 'web'],
    ['#secao', false, 'keep'],
    ['#secao', true, 'keep'],
    ['javascript:alert(1)', true, 'drop'],
    ['data:text/html,<script>1</script>', true, 'drop'],
    ['doc:adr', true, 'drop'],
    ['/relative', true, 'drop'],
    [null, true, 'drop'],
  ] as const)('%s (citations %s) → %s', (href, citations, rule) => {
    expect(hrefRule(href, citations ? cites : undefined)).toBe(rule);
  });

  it('keeps an internal citation address only where citations are on, and only when it is exactly one', () => {
    expect(hrefRule('#cite/api/Order%20Service', cites)).toBe('keep');
    expect(hrefRule('#cite/api/Order%20Service')).toBe('drop');
    for (const bad of ['#cite/api', '#cite/api/', '#cite/../x/y', '#cite/api/a/b', '#cite/api/<x>', '#cite/api/a"b', '#cite/api/a b', '#cite/api/%zz', '#CITE/api/x', '#Cite/api/x', '#cite/-x/y']) {
      expect(hrefRule(bad, cites)).toBe('drop');
    }
  });

  it('does not let a citation address smuggle in another scheme', () => {
    for (const bad of ['#cite/javascript:alert(1)/x', 'javascript:#cite/api/x', ' #cite/api/x', '#cite/api/x#y', '#cite/api/x?y=1']) {
      expect(hrefRule(bad, cites)).not.toBe('keep');
    }
  });
});
