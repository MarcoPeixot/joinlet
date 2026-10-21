import { describe, expect, it, vi } from 'vitest';
import { createIntegrations, parseJiraBody, parseNotifyBody, parsePublishBody } from './index';
import { fakeFetch, json } from './testing';

const SLACK = 'https://hooks.slack.com/services/T000/B000/XXXXXXXXabcd';
const DISCORD = 'https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKLmno1234';

function memoryFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  return { files, fs: { read: async (path: string) => files.get(path) ?? null, write: async (path: string, text: string) => void files.set(path, text) } };
}

const make = async (handler: Parameters<typeof fakeFetch>[0] = () => new Response(null, { status: 204 }), initial: Record<string, string> = {}) => {
  const disk = memoryFs(initial);
  const net = fakeFetch(handler);
  const integrations = createIntegrations({ file: '/cfg/integrations.json', fs: disk.fs, fetch: net.fetch });
  await integrations.load();
  return { integrations, disk, net };
};

describe('createIntegrations: settings', () => {
  it('starts empty, saves a patch to disk and answers with hints only', async () => {
    const { integrations, disk } = await make();
    expect(integrations.view().notion.configured).toBe(false);
    const view = await integrations.update({ webhooks: { slack: { url: SLACK } }, notion: { token: 'ntn_supersecret9876' } });
    expect(typeof view).toBe('object');
    expect(JSON.stringify(view)).not.toContain('supersecret');
    expect(JSON.stringify(view)).not.toContain('XXXXXXXX');
    const saved = JSON.parse(disk.files.get('/cfg/integrations.json')!);
    expect(saved.notion.token).toBe('ntn_supersecret9876');
    expect(saved.webhooks.slack.url).toBe(SLACK);
  });

  it('returns the pt-BR reason and writes nothing when the patch is invalid', async () => {
    const { integrations, disk } = await make();
    expect(await integrations.update({ webhooks: { slack: { url: 'https://evil.com/services/T/B/X' } } })).toMatch(/Slack/);
    expect(disk.files.size).toBe(0);
  });

  it('reloads from disk on the next start and re-validates it', async () => {
    const first = await make();
    await first.integrations.update({ notion: { token: 'ntn_abc123' }, webhooks: { discord: { url: DISCORD, events: ['pr'] } } });
    const second = await make(undefined, Object.fromEntries(first.disk.files));
    expect(second.integrations.view().notion.configured).toBe(true);
    expect(second.integrations.view().webhooks.discord.events).toEqual(['pr']);
    const hostile = await make(undefined, { '/cfg/integrations.json': JSON.stringify({ webhooks: { slack: { url: 'https://evil.com/services/T/B/X' } } }) });
    expect(hostile.integrations.view().webhooks.slack.configured).toBe(false);
  });

  it('does not lose updates that arrive together', async () => {
    const { integrations } = await make();
    await Promise.all([integrations.update({ notion: { token: 'ntn_one11' } }), integrations.update({ jira: { projectKey: 'ENG', issueType: 'Task' } }), integrations.update({ webhooks: { slack: { url: SLACK } } })]);
    const view = integrations.view();
    expect([view.notion.configured, view.jira.projectKey, view.webhooks.slack.configured]).toEqual([true, 'ENG', true]);
  });
});

describe('createIntegrations: test', () => {
  it('sends a test message to a configured webhook', async () => {
    const { integrations, net } = await make();
    await integrations.update({ webhooks: { slack: { url: SLACK } } });
    expect(await integrations.test('slack')).toEqual({ ok: true, detail: expect.stringMatching(/Slack/) });
    expect(net.calls).toHaveLength(1);
    expect(JSON.stringify(net.calls[0]!.json)).toMatch(/Teste/);
  });

  it('says what is missing', async () => {
    const { integrations, net } = await make();
    expect(await integrations.test('teams')).toEqual({ ok: false, detail: expect.stringMatching(/configur/i) });
    expect(await integrations.test('notion')).toEqual({ ok: false, detail: expect.stringMatching(/configur/i) });
    expect(await integrations.test('atlassian')).toEqual({ ok: false, detail: expect.stringMatching(/configur/i) });
    expect(await integrations.test('whatsapp' as never)).toEqual({ ok: false, detail: expect.stringMatching(/desconhecid/i) });
    expect(net.calls).toHaveLength(0);
  });

  it('tests Notion and Atlassian', async () => {
    const { integrations } = await make((call) => (new URL(call.url).pathname.includes('myself') ? json({ displayName: 'Ana' }) : json({ name: 'Bot' })));
    await integrations.update({ notion: { token: 'ntn_abc123' }, atlassian: { site: 'acme', email: 'a@b.co', token: 'tok123' } });
    expect((await integrations.test('notion')).ok).toBe(true);
    expect((await integrations.test('atlassian')).detail).toMatch(/Ana/);
  });
});

describe('createIntegrations: notify', () => {
  it('delivers to subscribed webhooks and never throws', async () => {
    const { integrations, net } = await make((call) => (call.url.includes('slack') ? new Response('x', { status: 500 }) : new Response(null, { status: 204 })));
    await integrations.update({ webhooks: { slack: { url: SLACK }, discord: { url: DISCORD, events: ['pr'] } } });
    const results = await integrations.notify({ event: 'pr', title: 'T', url: 'https://github.com/a/b/pull/1' });
    expect(results.map((r) => [r.kind, r.ok]).sort()).toEqual([['discord', true], ['slack', false]]);
    expect(await integrations.notify({ event: 'version', diagram: 'd', message: 'm', author: 'ai' })).toHaveLength(1);
    expect(net.calls).toHaveLength(3);
  });

  it('survives a webhook that makes fetch throw', async () => {
    const disk = memoryFs();
    const integrations = createIntegrations({ file: '/c/i.json', fs: disk.fs, fetch: vi.fn(async () => { throw new Error('offline'); }) as never });
    await integrations.load();
    await integrations.update({ webhooks: { slack: { url: SLACK } } });
    await expect(integrations.notify({ event: 'drift', count: 1, items: ['a'] })).resolves.toEqual([{ kind: 'slack', ok: false, detail: expect.any(String) }]);
  });

  it('notifies drift once per distinct set of findings, and again after it clears', async () => {
    const { integrations, net } = await make();
    await integrations.update({ webhooks: { slack: { url: SLACK } } });
    await integrations.notifyDrift('/repo', ['a', 'b']);
    await integrations.notifyDrift('/repo', ['b', 'a']);
    expect(net.calls).toHaveLength(1);
    await integrations.notifyDrift('/repo', ['a', 'b', 'c']);
    expect(net.calls).toHaveLength(2);
    await integrations.notifyDrift('/repo', []);
    await integrations.notifyDrift('/repo', ['a', 'b', 'c']);
    expect(net.calls).toHaveLength(3);
    await integrations.notifyDrift('/other', ['a', 'b', 'c']);
    expect(net.calls).toHaveLength(4);
  });
});

describe('createIntegrations: publish and Jira', () => {
  it('needs the credentials of the chosen service', async () => {
    const { integrations, net } = await make();
    expect(await integrations.publish('notion', { title: 'T', markdown: 'x' })).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/Notion/) });
    expect(await integrations.publish('confluence', { title: 'T', markdown: 'x' })).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/Atlassian|Confluence/) });
    expect(await integrations.createJiraIssue({ concern: { id: 'c', diagram: 'd', message: 'm' } })).toMatchObject({ ok: false, status: 400 });
    expect(net.calls).toHaveLength(0);
  });

  it('publishes to Notion with the saved token', async () => {
    const { integrations, net } = await make((call) => (new URL(call.url).pathname === '/v1/pages' ? json({ id: '11111111-2222-3333-4444-555555555555', url: 'https://www.notion.so/x' }) : json({})));
    await integrations.update({ notion: { token: 'ntn_abc123', parentPageId: 'a'.repeat(32) } });
    expect(await integrations.publish('notion', { title: 'T', markdown: '# x' })).toMatchObject({ ok: true });
    expect(net.calls[0]!.headers.authorization).toBe('Bearer ntn_abc123');
  });

  it('creates a Jira issue with the saved project', async () => {
    const { integrations, net } = await make(() => json({ key: 'ENG-1' }, 201));
    await integrations.update({ atlassian: { site: 'acme', email: 'a@b.co', token: 'tok123' }, jira: { projectKey: 'eng', issueType: 'Bug' } });
    expect(await integrations.createJiraIssue({ concern: { id: 'c1', diagram: 'checkout', message: 'm' }, diagramTitle: 'Checkout' })).toEqual({ ok: true, key: 'ENG-1', url: 'https://acme.atlassian.net/browse/ENG-1' });
    expect((net.calls[0]!.json as { fields: { issuetype: unknown } }).fields.issuetype).toEqual({ name: 'Bug' });
  });
});

describe('request parsers', () => {
  it('parsePublishBody', () => {
    expect(parsePublishBody({ target: 'notion', title: 'T', markdown: 'x' })).toEqual({ target: 'notion', input: { title: 'T', markdown: 'x' } });
    expect(parsePublishBody({ target: 'confluence', title: 'T', markdown: 'x', svg: '<svg/>', svgName: 'a.svg' })).toEqual({ target: 'confluence', input: { title: 'T', markdown: 'x', svg: '<svg/>', svgName: 'a.svg' } });
    for (const bad of [null, 'x', { target: 'slack', title: 'T', markdown: 'x' }, { target: 'notion', markdown: 'x' }, { target: 'notion', title: 'T' }, { target: 'notion', title: 'T', markdown: 5 }, { target: 'notion', title: 'T', markdown: 'x', svg: 5 }]) {
      expect(typeof parsePublishBody(bad), JSON.stringify(bad)).toBe('string');
    }
  });

  it('parseNotifyBody accepts only the three real events and bounds the text', () => {
    expect(parseNotifyBody({ event: 'version', diagram: 'd', message: 'm', author: 'ai' })).toEqual({ event: 'version', diagram: 'd', message: 'm', author: 'ai' });
    expect(parseNotifyBody({ event: 'drift', count: 2, items: ['a', 'b'] })).toEqual({ event: 'drift', count: 2, items: ['a', 'b'] });
    expect(parseNotifyBody({ event: 'pr', title: 't', url: 'https://x.com/1' })).toEqual({ event: 'pr', title: 't', url: 'https://x.com/1' });
    for (const bad of [null, { event: 'test' }, { event: 'version', diagram: 'd', message: 'm', author: 'human' }, { event: 'version', diagram: 5, message: 'm', author: 'ai' }, { event: 'drift', count: -1, items: [] }, { event: 'drift', count: 1, items: [1] }, { event: 'pr', title: 't' }, { event: 'boom' }]) {
      expect(typeof parseNotifyBody(bad), JSON.stringify(bad)).toBe('string');
    }
    const big = parseNotifyBody({ event: 'drift', count: 5, items: Array.from({ length: 500 }, () => 'x'.repeat(2_000)) });
    expect(typeof big).toBe('object');
    expect((big as { items: string[] }).items.length).toBeLessThanOrEqual(20);
    expect((big as { items: string[] }).items.every((i) => i.length <= 300)).toBe(true);
  });

  it('parseJiraBody validates the concern', () => {
    expect(parseJiraBody({ concern: { id: 'c1', diagram: 'checkout', element: 'API', message: 'm' }, diagramTitle: 'T' })).toEqual({ concern: { id: 'c1', diagram: 'checkout', element: 'API', message: 'm' }, diagramTitle: 'T' });
    for (const bad of [null, {}, { concern: null }, { concern: { id: '../x', diagram: 'd', message: 'm' } }, { concern: { id: 'c', diagram: 'd bad', message: 'm' } }, { concern: { id: 'c', diagram: 'd', message: '' } }, { concern: { id: 'c', diagram: 'd', message: 5 } }]) {
      expect(typeof parseJiraBody(bad), JSON.stringify(bad)).toBe('string');
    }
  });
});
