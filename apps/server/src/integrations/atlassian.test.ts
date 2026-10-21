import { describe, expect, it } from 'vitest';
import { createJiraIssue, publishToConfluence, testAtlassian } from './atlassian';
import { fakeFetch, json } from './testing';
import type { Call } from './testing';

const auth = { site: 'https://acme.atlassian.net', email: 'ana@acme.com', token: 'atl_secret_token_5555' };
const basic = `Basic ${Buffer.from(`${auth.email}:${auth.token}`).toString('base64')}`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
const space = { spaceKey: 'ENG', parentId: '777' };

const path = (call: Call) => `${call.method} ${new URL(call.url).pathname}${new URL(call.url).search}`;

/** A Confluence with one optional existing page. */
function confluence(options: { existing?: { id: string; version: number }; attachment?: string } = {}, override: (call: Call) => Response | undefined = () => undefined) {
  return fakeFetch((call) => {
    const custom = override(call);
    if (custom) return custom;
    const url = new URL(call.url);
    if (call.method === 'GET' && url.pathname === '/wiki/rest/api/content') {
      return json({ results: options.existing ? [{ id: options.existing.id, version: { number: options.existing.version } }] : [] });
    }
    if (call.method === 'POST' && url.pathname === '/wiki/rest/api/content') return json({ id: '4242', _links: { base: 'https://acme.atlassian.net/wiki', webui: '/spaces/ENG/pages/4242/Pagamentos' } });
    if (call.method === 'PUT' && /^\/wiki\/rest\/api\/content\/\d+$/.test(url.pathname)) return json({ id: options.existing!.id, _links: { base: 'https://acme.atlassian.net/wiki', webui: '/spaces/ENG/pages/9/Pagamentos' } });
    if (call.method === 'GET' && /\/child\/attachment$/.test(url.pathname)) return json({ results: options.attachment ? [{ id: options.attachment }] : [] });
    if (call.method === 'POST' && /\/child\/attachment(\/[\w-]+\/data)?$/.test(url.pathname)) return json({ results: [{ id: 'att1' }] });
    return json({ message: 'unexpected' }, 500);
  });
}

describe('publishToConfluence', () => {
  it('creates a page in the space under the parent, in storage format', async () => {
    const { fetch, calls } = confluence();
    const result = await publishToConfluence({ fetch }, auth, space, { title: 'Pagamentos', markdown: '# Pagamentos\n\nTexto **forte**.' });
    expect(result).toEqual({ ok: true, url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/4242/Pagamentos', warnings: [] });
    expect(calls.map(path)).toEqual(['GET /wiki/rest/api/content?type=page&spaceKey=ENG&title=Pagamentos&expand=version&limit=2', 'POST /wiki/rest/api/content']);
    expect(calls[1]!.headers.authorization).toBe(basic);
    expect(calls[1]!.json).toEqual({
      type: 'page',
      title: 'Pagamentos',
      space: { key: 'ENG' },
      ancestors: [{ id: '777' }],
      body: { storage: { value: '<h1>Pagamentos</h1><p>Texto <strong>forte</strong>.</p>', representation: 'storage' } },
    });
  });

  it('updates the page with the same title (version + 1) instead of failing on a duplicate', async () => {
    const { fetch, calls } = confluence({ existing: { id: '9', version: 3 } });
    const result = await publishToConfluence({ fetch }, auth, space, { title: 'Pagamentos', markdown: 'novo' });
    expect(result).toMatchObject({ ok: true, url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/9/Pagamentos' });
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(new URL(put.url).pathname).toBe('/wiki/rest/api/content/9');
    expect(put.json).toMatchObject({ id: '9', type: 'page', title: 'Pagamentos', space: { key: 'ENG' }, version: { number: 4 } });
    expect((put.json as { ancestors?: unknown }).ancestors).toBeUndefined();
  });

  it('attaches the diagram SVG (multipart, no-check token) and references it from the page', async () => {
    const { fetch, calls } = confluence();
    const result = await publishToConfluence({ fetch }, auth, space, { title: 'T', markdown: 'x', svg: SVG, svgName: 'checkout.svg' });
    expect(result).toMatchObject({ ok: true, warnings: [] });
    const create = calls.find((c) => c.method === 'POST' && new URL(c.url).pathname === '/wiki/rest/api/content')!;
    expect((create.json as { body: { storage: { value: string } } }).body.storage.value).toContain('<ri:attachment ri:filename="checkout.svg" />');
    const upload = calls.find((c) => new URL(c.url).pathname === '/wiki/rest/api/content/4242/child/attachment' && c.method === 'POST')!;
    expect(upload.headers['x-atlassian-token']).toBe('no-check');
    expect(upload.headers.authorization).toBe(basic);
    const file = upload.form!.get('file') as File;
    expect(file.name).toBe('checkout.svg');
    expect(await file.text()).toBe(SVG);
  });

  it('replaces the data of an attachment that already exists', async () => {
    const { fetch, calls } = confluence({ existing: { id: '9', version: 1 }, attachment: 'att77' });
    await publishToConfluence({ fetch }, auth, space, { title: 'T', markdown: 'x', svg: SVG });
    expect(calls.map(path)).toContain('POST /wiki/rest/api/content/9/child/attachment/att77/data');
  });

  it('refuses an unsafe SVG before any request', async () => {
    const { fetch, calls } = confluence();
    expect(await publishToConfluence({ fetch }, auth, space, { title: 'T', markdown: 'x', svg: '<svg onload="x"/>' })).toMatchObject({ ok: false, status: 400 });
    expect(calls).toHaveLength(0);
  });

  it('warns, keeping the page, when the attachment fails', async () => {
    const { fetch } = confluence({}, (call) => (call.method === 'POST' && call.url.endsWith('/child/attachment') ? json({ message: 'nope' }, 400) : undefined));
    const result = await publishToConfluence({ fetch }, auth, space, { title: 'T', markdown: 'x', svg: SVG });
    expect(result).toMatchObject({ ok: true, url: expect.stringContaining('/pages/4242') });
    expect((result as { warnings: string[] }).warnings.join(' ')).toMatch(/diagrama/i);
  });

  it('builds the link itself when the service answers with an unexpected one', async () => {
    const { fetch } = confluence({}, (call) => (call.method === 'POST' && new URL(call.url).pathname === '/wiki/rest/api/content' ? json({ id: '4242', _links: { base: 'https://evil.com/wiki', webui: '/x' } }) : undefined));
    const result = await publishToConfluence({ fetch }, auth, space, { title: 'T', markdown: 'x' });
    expect(result).toMatchObject({ ok: true, url: 'https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=4242' });
  });

  it('does not use an id the service made up in a URL path', async () => {
    const { fetch, calls } = confluence({}, (call) => (call.method === 'POST' && new URL(call.url).pathname === '/wiki/rest/api/content' ? json({ id: '../../../user' }) : undefined));
    const result = await publishToConfluence({ fetch }, auth, space, { title: 'T', markdown: 'x', svg: SVG });
    expect(calls.some((c) => c.url.includes('user'))).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('turns HTTP errors into pt-BR messages without the token', async () => {
    const cases: [number, RegExp][] = [[401, /credenciais/i], [403, /permiss/i], [404, /espaço/i], [400, /recusou|erro 400/i], [429, /limite/i], [500, /erro 500/i]];
    for (const [status, pattern] of cases) {
      const { fetch } = confluence({}, (call) => (call.method === 'POST' && new URL(call.url).pathname === '/wiki/rest/api/content' ? json({ message: `bad ${auth.token}` }, status) : undefined));
      const result = await publishToConfluence({ fetch }, auth, space, { title: 'T', markdown: 'x' });
      expect(result.ok).toBe(false);
      const error = (result as { error: string }).error;
      expect(error, String(status)).toMatch(pattern);
      expect(error).not.toContain(auth.token);
    }
  });

  it('refuses a stored site outside Atlassian (a hand-edited file) before any request', async () => {
    const { fetch, calls } = confluence();
    const result = await publishToConfluence({ fetch }, { ...auth, site: 'https://evil.com' }, space, { title: 'T', markdown: 'x' });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('does not follow a redirect (the credentials would go with it)', async () => {
    const { fetch, calls } = confluence({}, () => new Response(null, { status: 302, headers: { location: 'https://evil.com/' } }));
    const result = await publishToConfluence({ fetch }, auth, space, { title: 'T', markdown: 'x' });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('encodes the title and space in the lookup', async () => {
    const { fetch, calls } = confluence();
    await publishToConfluence({ fetch }, auth, { spaceKey: 'ENG' }, { title: 'A & B "c" #1', markdown: 'x' });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('title')).toBe('A & B "c" #1');
    expect(calls[1]!.json).not.toHaveProperty('ancestors');
  });
});

const jira = { projectKey: 'ENG', issueType: 'Task' };
const concern = { id: 'c1', diagram: 'checkout', element: 'API', message: 'A fila não aparece no desenho.\nVerificar com o time.' };

describe('createJiraIssue', () => {
  const issue = (override: (call: Call) => Response | undefined = () => undefined) =>
    fakeFetch((call) => override(call) ?? json({ id: '10001', key: 'ENG-42', self: 'https://acme.atlassian.net/rest/api/3/issue/10001' }, 201));

  it('creates the issue from a concern, with an ADF description', async () => {
    const { fetch, calls } = issue();
    const result = await createJiraIssue({ fetch }, auth, jira, concern, { diagramTitle: 'Checkout' });
    expect(result).toEqual({ ok: true, key: 'ENG-42', url: 'https://acme.atlassian.net/browse/ENG-42' });
    expect(path(calls[0]!)).toBe('POST /rest/api/3/issue');
    expect(calls[0]!.headers.authorization).toBe(basic);
    const fields = (calls[0]!.json as { fields: Record<string, unknown> }).fields;
    expect(fields.project).toEqual({ key: 'ENG' });
    expect(fields.issuetype).toEqual({ name: 'Task' });
    expect(fields.labels).toEqual(['strukt']);
    expect(String(fields.summary)).toContain('Checkout');
    expect(String(fields.summary)).not.toMatch(/\n/);
    expect(String(fields.summary).length).toBeLessThanOrEqual(250);
    const description = fields.description as { type: string; version: number; content: { type: string; content?: { text?: string }[] }[] };
    expect(description).toMatchObject({ type: 'doc', version: 1 });
    expect(JSON.stringify(description)).toContain('A fila não aparece no desenho.');
    expect(JSON.stringify(description)).toContain('API');
  });

  it('bounds a long message in the summary but keeps it whole in the description', async () => {
    const { fetch, calls } = issue();
    await createJiraIssue({ fetch }, auth, jira, { ...concern, message: 'm'.repeat(900) }, {});
    const fields = (calls[0]!.json as { fields: { summary: string; description: unknown } }).fields;
    expect(fields.summary.length).toBeLessThanOrEqual(250);
    expect(JSON.stringify(fields.description)).toContain('m'.repeat(900));
  });

  it('does not trust the key in the response for the link', async () => {
    const { fetch } = issue(() => json({ key: '../../evil' }, 201));
    expect(await createJiraIssue({ fetch }, auth, jira, concern, {})).toMatchObject({ ok: false });
  });

  it('turns Jira errors into pt-BR messages, keeping the field message', async () => {
    const { fetch } = issue(() => json({ errorMessages: [], errors: { issuetype: 'Specify a valid issue type' } }, 400));
    const result = await createJiraIssue({ fetch }, auth, jira, concern, {});
    expect(result).toMatchObject({ ok: false, status: 502, error: expect.stringContaining('Specify a valid issue type') });
    const cases: [number, RegExp][] = [[401, /credenciais/i], [403, /permiss/i], [404, /projeto/i]];
    for (const [status, pattern] of cases) {
      const r = await createJiraIssue({ fetch: issue(() => json({ message: `x ${auth.token}` }, status)).fetch }, auth, jira, concern, {});
      expect((r as { error: string }).error, String(status)).toMatch(pattern);
      expect((r as { error: string }).error).not.toContain(auth.token);
    }
  });

  it('rejects an empty concern', async () => {
    const { fetch, calls } = issue();
    expect(await createJiraIssue({ fetch }, auth, jira, { ...concern, message: '  ' }, {})).toMatchObject({ ok: false, status: 400 });
    expect(calls).toHaveLength(0);
  });
});

describe('testAtlassian', () => {
  it('checks the account, the Confluence space and the Jira project that are configured', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      const p = new URL(call.url).pathname;
      if (p === '/rest/api/3/myself') return json({ displayName: 'Ana' });
      if (p === '/wiki/rest/api/space/ENG') return json({ key: 'ENG' });
      if (p === '/rest/api/3/project/ENG') return json({ key: 'ENG' });
      return json({}, 404);
    });
    const result = await testAtlassian({ fetch }, auth, { confluence: space, jira });
    expect(result).toEqual({ ok: true, detail: expect.stringContaining('Ana') });
    expect(result.detail).toMatch(/Confluence/);
    expect(result.detail).toMatch(/Jira/);
    expect(calls).toHaveLength(3);
  });

  it('reports which part failed', async () => {
    const { fetch } = fakeFetch((call) => (new URL(call.url).pathname === '/rest/api/3/myself' ? json({ displayName: 'Ana' }) : json({}, 404)));
    const result = await testAtlassian({ fetch }, auth, { confluence: space, jira });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/espaço|projeto/i);
  });

  it('reports a refused account', async () => {
    const { fetch } = fakeFetch(() => json({}, 401));
    expect(await testAtlassian({ fetch }, auth, {})).toEqual({ ok: false, detail: expect.stringMatching(/credenciais/i) });
  });
});
