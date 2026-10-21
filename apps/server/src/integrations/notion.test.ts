import { describe, expect, it } from 'vitest';
import { publishToNotion, testNotion } from './notion';
import { fakeFetch, json } from './testing';
import type { Call } from './testing';

const cfg = { token: 'ntn_secret_token_1234', parentPageId: 'a'.repeat(32) };
const PAGE_ID = '11111111-2222-3333-4444-555555555555';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';

/** The happy-path Notion: pages, appends and the two-step file upload. */
function notion(overrides: (call: Call) => Response | undefined = () => undefined) {
  return fakeFetch((call) => {
    const custom = overrides(call);
    if (custom) return custom;
    const { pathname } = new URL(call.url);
    if (pathname === '/v1/pages' && call.method === 'POST') return json({ id: PAGE_ID, url: 'https://www.notion.so/Pagina-11111111222233334444555555555555' });
    if (pathname === '/v1/file_uploads') return json({ id: 'up-1', upload_url: 'https://api.notion.com/v1/file_uploads/up-1/send' });
    if (pathname === '/v1/file_uploads/up-1/send') return json({ id: 'up-1', status: 'uploaded' });
    if (pathname === `/v1/blocks/${PAGE_ID}/children`) return json({ results: [] });
    return json({ message: 'unexpected' }, 500);
  });
}

describe('publishToNotion', () => {
  it('creates a child page of the configured parent with the converted blocks', async () => {
    const { fetch, calls } = notion();
    const result = await publishToNotion({ fetch }, cfg, { title: 'Pagamentos', markdown: '# Pagamentos\n\nTexto **forte**.\n\n- um\n- dois' });
    expect(result).toEqual({ ok: true, url: 'https://www.notion.so/Pagina-11111111222233334444555555555555', warnings: [] });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe('https://api.notion.com/v1/pages');
    expect(call!.headers.authorization).toBe(`Bearer ${cfg.token}`);
    expect(call!.headers['notion-version']).toBe('2022-06-28');
    const body = call!.json as { parent: unknown; properties: unknown; children: { type: string }[] };
    expect(body.parent).toEqual({ page_id: cfg.parentPageId });
    expect(body.properties).toEqual({ title: { title: [{ type: 'text', text: { content: 'Pagamentos' } }] } });
    expect(body.children.map((b) => b.type)).toEqual(['heading_1', 'paragraph', 'bulleted_list_item', 'bulleted_list_item']);
  });

  it('uploads the diagram SVG and puts it first as an image block', async () => {
    const { fetch, calls } = notion();
    const result = await publishToNotion({ fetch }, cfg, { title: 'T', markdown: 'texto', svg: SVG, svgName: 'diagrama.svg' });
    expect(result).toMatchObject({ ok: true, warnings: [] });
    const [create, send, page] = calls;
    expect(create!.url).toBe('https://api.notion.com/v1/file_uploads');
    expect(create!.json).toEqual({ filename: 'diagrama.svg', content_type: 'image/svg+xml' });
    expect(send!.url).toBe('https://api.notion.com/v1/file_uploads/up-1/send');
    expect(send!.headers['content-type']).toBeUndefined();
    const file = send!.form!.get('file') as File;
    expect(file.name).toBe('diagrama.svg');
    expect(file.type).toContain('image/svg+xml');
    expect(await file.text()).toBe(SVG);
    expect((page!.json as { children: { type: string; image?: unknown }[] }).children[0]).toEqual({ object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: 'up-1' } } });
  });

  it('refuses an unsafe SVG before touching Notion', async () => {
    const { fetch, calls } = notion();
    const result = await publishToNotion({ fetch }, cfg, { title: 'T', markdown: 'x', svg: '<svg><script>alert(1)</script></svg>' });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(calls).toHaveLength(0);
  });

  it('still publishes the text when the image upload fails, and says so', async () => {
    const { fetch, calls } = notion((call) => (call.url.endsWith('/v1/file_uploads') ? json({ message: 'file type not supported' }, 400) : undefined));
    const result = await publishToNotion({ fetch }, cfg, { title: 'T', markdown: 'x', svg: SVG });
    expect(result).toMatchObject({ ok: true });
    expect((result as { warnings: string[] }).warnings.join(' ')).toMatch(/diagrama/i);
    expect((calls.at(-1)!.json as { children: { type: string }[] }).children.map((b) => b.type)).toEqual(['paragraph']);
  });

  it('does not follow an upload URL that points off api.notion.com', async () => {
    const { fetch, calls } = notion((call) => (call.url.endsWith('/v1/file_uploads') ? json({ id: 'up-1', upload_url: 'https://evil.com/steal' }) : undefined));
    const result = await publishToNotion({ fetch }, cfg, { title: 'T', markdown: 'x', svg: SVG });
    expect((result as { warnings: string[] }).warnings.join(' ')).toMatch(/diagrama/i);
    expect(calls.some((c) => c.url.includes('evil.com'))).toBe(false);
    expect(calls.some((c) => c.headers.authorization === `Bearer ${cfg.token}` && c.url.includes('evil'))).toBe(false);
  });

  it('appends the blocks that do not fit one request', async () => {
    const { fetch, calls } = notion();
    const markdown = Array.from({ length: 230 }, (_, i) => `Parágrafo ${i}`).join('\n\n');
    const result = await publishToNotion({ fetch }, cfg, { title: 'T', markdown });
    expect(result).toMatchObject({ ok: true });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['POST /v1/pages', `PATCH /v1/blocks/${PAGE_ID}/children`, `PATCH /v1/blocks/${PAGE_ID}/children`]);
    expect((calls[0]!.json as { children: unknown[] }).children).toHaveLength(100);
    expect((calls[2]!.json as { children: unknown[] }).children).toHaveLength(30);
  });

  it('reports a partial publish as a warning, with the page link', async () => {
    const { fetch } = notion((call) => (call.method === 'PATCH' ? json({ message: 'rate limited' }, 429) : undefined));
    const markdown = Array.from({ length: 150 }, (_, i) => `P ${i}`).join('\n\n');
    const result = await publishToNotion({ fetch }, cfg, { title: 'T', markdown });
    expect(result).toMatchObject({ ok: true, url: expect.stringContaining('notion.so') });
    expect((result as { warnings: string[] }).warnings.join(' ')).toMatch(/parte|incompleta/i);
  });

  it('turns Notion errors into pt-BR messages without the token', async () => {
    const cases: [number, RegExp][] = [[401, /token/i], [403, /permiss|compartilh/i], [404, /compartilh|encontrad/i], [429, /limite/i], [500, /erro 500/i]];
    for (const [status, pattern] of cases) {
      const { fetch } = notion((call) => (call.url.endsWith('/v1/pages') ? json({ message: `bad ${cfg.token}` }, status) : undefined));
      const result = await publishToNotion({ fetch }, cfg, { title: 'T', markdown: 'x' });
      expect(result.ok).toBe(false);
      const error = (result as { error: string }).error;
      expect(error, String(status)).toMatch(pattern);
      expect(error).not.toContain(cfg.token);
    }
  });

  it('does not use a page id the server made up (it goes into a URL path)', async () => {
    const { fetch, calls } = notion((call) => (call.url.endsWith('/v1/pages') ? json({ id: '../../v1/users', url: 'https://evil.com/x' }) : undefined));
    const markdown = Array.from({ length: 150 }, (_, i) => `P ${i}`).join('\n\n');
    const result = await publishToNotion({ fetch }, cfg, { title: 'T', markdown });
    expect(calls.some((c) => c.url.includes('users'))).toBe(false);
    expect(JSON.stringify(result)).not.toContain('evil.com');
  });

  it('requires a parent page', async () => {
    const { fetch, calls } = notion();
    const result = await publishToNotion({ fetch }, { token: cfg.token }, { title: 'T', markdown: 'x' });
    expect(result).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/página/i) });
    expect(calls).toHaveLength(0);
  });

  it('bounds the title and refuses an empty one', async () => {
    const { fetch, calls } = notion();
    await publishToNotion({ fetch }, cfg, { title: `${'t'.repeat(500)}\n`, markdown: 'x' });
    expect((calls[0]!.json as { properties: { title: { title: { text: { content: string } }[] } } }).properties.title.title[0]!.text.content.length).toBeLessThanOrEqual(200);
    expect(await publishToNotion({ fetch }, cfg, { title: '  ', markdown: 'x' })).toMatchObject({ ok: false, status: 400 });
  });

  it('warns about content Notion truncates', async () => {
    const { fetch } = notion();
    const rows = Array.from({ length: 150 }, (_, i) => `| ${i} |`).join('\n');
    const result = await publishToNotion({ fetch }, cfg, { title: 'T', markdown: `| N |\n|---|\n${rows}` });
    expect((result as { warnings: string[] }).warnings.join(' ')).toMatch(/tabela/i);
  });
});

describe('testNotion', () => {
  it('checks the token and the parent page', async () => {
    const { fetch, calls } = fakeFetch((call) => (call.url.endsWith('/v1/users/me') ? json({ name: 'Joinlet Bot' }) : json({ id: PAGE_ID })));
    expect(await testNotion({ fetch }, cfg)).toEqual({ ok: true, detail: expect.stringContaining('Joinlet Bot') });
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/v1/users/me', `/v1/pages/${cfg.parentPageId}`]);
  });

  it('explains an unshared parent page', async () => {
    const { fetch } = fakeFetch((call) => (call.url.endsWith('/v1/users/me') ? json({ name: 'Bot' }) : json({ code: 'object_not_found', message: 'x' }, 404)));
    expect(await testNotion({ fetch }, cfg)).toEqual({ ok: false, detail: expect.stringMatching(/compartilh/i) });
  });

  it('reports a refused token', async () => {
    const { fetch } = fakeFetch(() => json({ message: 'API token is invalid.' }, 401));
    expect(await testNotion({ fetch }, cfg)).toEqual({ ok: false, detail: expect.stringMatching(/token/i) });
  });
});
