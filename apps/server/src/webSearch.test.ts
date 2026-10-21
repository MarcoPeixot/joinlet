import { describe, expect, it, vi } from 'vitest';
import { createWebSearch, parseDuckDuckGo, searchQuery } from './webSearch';

const result = (href: string, title = 'PostgreSQL &amp; docs', snippet = '<b>Official</b> manual &#x2014; SQL') => `<h2><a class="result__a" href="${href}">${title}</a></h2><a class="result__snippet">${snippet}</a>`;
const html = result('//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.postgresql.org%2Fdocs%2F&amp;rut=abc');
const fakeFetch = (text: string, status = 200) => vi.fn<typeof fetch>().mockResolvedValue(new Response(text, { status }));

describe('web search backend', () => {
  it('decodes real result markup, unwraps search redirects and removes duplicates, markup and non-public links', () => {
    const found = parseDuckDuckGo(html + html + result('javascript:alert(1)') + result('http://127.0.0.1/a') + result('https://localhost/a') + result('https://user:pass@example.com') + result('https://example.com', '<script>bad</script>Example'));
    expect(found).toEqual([{ title: 'PostgreSQL & docs', url: 'https://www.postgresql.org/docs/', snippet: 'Official manual — SQL' }, { title: 'bad Example', url: 'https://example.com/', snippet: 'Official manual — SQL' }]);
    expect(parseDuckDuckGo(Array.from({ length: 12 }, (_, i) => result(`https://example.com/${i}`)).join(''))).toHaveLength(6);
  });
  it('validates and bounds queries', () => {
    expect(searchQuery({ query: ' site:postgresql.org SQL ' })).toBe('site:postgresql.org SQL');
    for (const query of ['', 'x', 'x'.repeat(401), 'x\ny', null]) expect(searchQuery({ query })).toBeNull();
  });
  it('works without a new key and forwards cancellation with a deadline and fixed endpoint', async () => {
    const fetch = fakeFetch(html), controller = new AbortController();
    expect(await createWebSearch({ fetch })('PostgreSQL docs', controller.signal)).toHaveLength(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://html.duckduckgo.com/html/?q=PostgreSQL+docs');
    expect(init?.redirect).toBe('error');
    controller.abort(); expect(init?.signal?.aborted).toBe(true);
  });
  it('uses the optional official Brave API without including the key in the URL or results', async () => {
    const fetch = fakeFetch(JSON.stringify({ web: { results: [{ title: 'Docs', url: 'https://example.com/docs', description: 'Reference' }] } }));
    expect(await createWebSearch({ fetch, braveKey: 'test-secret' })('docs SQL')).toEqual([{ title: 'Docs', url: 'https://example.com/docs', snippet: 'Reference' }]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain('https://api.search.brave.com/res/v1/web/search?');
    expect(String(url)).not.toContain('test-secret');
    expect(init?.headers).toMatchObject({ 'X-Subscription-Token': 'test-secret' });
  });
  it('distinguishes no results from blocking or unexpected pages, and rejects oversized responses', async () => {
    expect(await createWebSearch({ fetch: fakeFetch('<div class="no-results">No results found</div>') })('not found')).toEqual([]);
    await expect(createWebSearch({ fetch: fakeFetch('<form id="challenge-form">captcha</form>') })('docs SQL')).rejects.toThrow('verificação');
    await expect(createWebSearch({ fetch: fakeFetch('<div>unrecognized</div>') })('docs SQL')).rejects.toThrow('ler os resultados');
    await expect(createWebSearch({ fetch: fakeFetch('rate limited', 429) })('docs SQL')).rejects.toThrow('indisponível');
    await expect(createWebSearch({ fetch: fakeFetch('x'.repeat(1_500_001)) })('docs SQL')).rejects.toThrow('excedeu');
  });
});
