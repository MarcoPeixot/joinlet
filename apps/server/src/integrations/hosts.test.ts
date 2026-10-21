import { describe, expect, it, vi } from 'vitest';
import { IntegrationError, checkUrl, normalizeSite, safeFetch } from './hosts';

const SLACK = 'https://hooks.slack.com/services/T000/B000/XXXXXXXX';
const DISCORD = 'https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKLmno1234567890';
const TEAMS = 'https://contoso.webhook.office.com/webhookb2/abc@def/IncomingWebhook/ghi/jkl';
const TEAMS_OUTLOOK = 'https://outlook.office.com/webhook/abc@def/IncomingWebhook/ghi/jkl';

const ok = (kind: Parameters<typeof checkUrl>[0], url: string) => {
  const parsed = checkUrl(kind, url);
  expect('error' in parsed, `${url} → ${'error' in parsed ? parsed.error : ''}`).toBe(false);
};
const refused = (kind: Parameters<typeof checkUrl>[0], url: unknown) => expect('error' in checkUrl(kind, url), String(url)).toBe(true);

describe('checkUrl: the real addresses pass', () => {
  it('accepts each service on its own host', () => {
    ok('slack', SLACK);
    ok('slack', 'https://hooks.slack.com/triggers/T000/123/abcdef');
    ok('discord', DISCORD);
    ok('discord', `${DISCORD}?wait=true`);
    ok('discord', 'https://discord.com/api/v10/webhooks/123456789012345678/abcDEF_ghi-JKLmno1234567890');
    ok('teams', TEAMS);
    ok('teams', TEAMS_OUTLOOK);
    ok('atlassian', 'https://acme.atlassian.net/rest/api/3/issue');
    ok('atlassian', 'https://acme-eu-1.atlassian.net');
    ok('notion', 'https://api.notion.com/v1/pages');
    ok('slack', 'https://HOOKS.SLACK.COM/services/T000/B000/XXXXXXXX');
    ok('notion', 'https://api.notion.com:443/v1/pages');
  });
});

describe('checkUrl: SSRF adversarial cases', () => {
  const cases: [string, Parameters<typeof checkUrl>[0], unknown][] = [
    ['plain http', 'slack', 'http://hooks.slack.com/services/T/B/X'],
    ['other scheme', 'slack', 'ftp://hooks.slack.com/services/T/B/X'],
    ['file scheme', 'notion', 'file:///etc/passwd'],
    ['javascript scheme', 'notion', 'javascript:alert(1)'],
    ['loopback name', 'atlassian', 'https://localhost/'],
    ['loopback v4', 'atlassian', 'https://127.0.0.1/'],
    ['loopback v6', 'notion', 'https://[::1]/'],
    ['v4-mapped v6', 'notion', 'https://[::ffff:127.0.0.1]/'],
    ['metadata service', 'atlassian', 'https://169.254.169.254/latest/meta-data/'],
    ['private 10/8', 'slack', 'https://10.0.0.1/services/T/B/X'],
    ['decimal ip', 'notion', 'https://2130706433/'],
    ['hex ip', 'notion', 'https://0x7f000001/'],
    ['octal ip', 'notion', 'https://0177.0.0.1/'],
    ['short ip', 'notion', 'https://127.1/'],
    ['userinfo that names the real host', 'slack', 'https://hooks.slack.com@evil.com/services/T/B/X'],
    ['userinfo with password', 'notion', 'https://api.notion.com:secret@evil.com/v1/pages'],
    ['userinfo on the real host', 'notion', 'https://user@api.notion.com/v1/pages'],
    ['host as a subdomain of the attacker', 'slack', 'https://hooks.slack.com.evil.com/services/T/B/X'],
    ['host as a prefix', 'slack', 'https://evilhooks.slack.com.evil.com/services/T/B/X'],
    ['lookalike suffix', 'atlassian', 'https://acme.atlassian.net.evil.com/'],
    ['lookalike without dot', 'atlassian', 'https://evilatlassian.net/'],
    ['atlassian in the path', 'atlassian', 'https://evil.com/.atlassian.net'],
    ['atlassian in the query', 'atlassian', 'https://evil.com/?x=.atlassian.net'],
    ['atlassian in the fragment', 'atlassian', 'https://evil.com/#.atlassian.net'],
    ['apex atlassian.net', 'atlassian', 'https://atlassian.net/'],
    ['nested subdomain', 'atlassian', 'https://a.b.atlassian.net/'],
    ['teams nested subdomain', 'teams', 'https://a.b.webhook.office.com/webhookb2/x'],
    ['teams apex', 'teams', 'https://webhook.office.com/webhookb2/x'],
    ['teams lookalike', 'teams', 'https://contoso.webhook.office.com.evil.com/webhookb2/x'],
    ['trailing dot', 'slack', 'https://hooks.slack.com./services/T/B/X'],
    ['non-default port', 'notion', 'https://api.notion.com:8443/v1/pages'],
    ['port 80', 'notion', 'https://api.notion.com:80/v1/pages'],
    ['backslash trick', 'slack', 'https://hooks.slack.com\\@evil.com/services/T/B/X'],
    ['backslash path', 'slack', 'https://evil.com\\.hooks.slack.com/services/T/B/X'],
    ['whitespace', 'slack', 'https://hooks.slack.com /services/T/B/X'],
    ['tab inside host', 'slack', 'https://hooks.slack.com\t.evil.com/services/T/B/X'],
    ['newline injection', 'slack', 'https://hooks.slack.com/services/T/B/X\r\nHost: evil.com'],
    ['NUL byte', 'slack', 'https://hooks.slack.com/services/T/B/X\u0000'],
    ['unicode lookalike host', 'slack', 'https://hooks.slаck.com/services/T/B/X'],
    ['fullwidth dot', 'slack', 'https://hooks。slack。com/services/T/B/X'],
    ['wrong service for the host', 'slack', DISCORD],
    ['slack host, wrong path', 'slack', 'https://hooks.slack.com/api/chat.postMessage'],
    ['slack path traversal', 'slack', 'https://hooks.slack.com/services/../admin'],
    ['slack encoded traversal', 'slack', 'https://hooks.slack.com/services/%2e%2e/admin'],
    ['discord wrong path', 'discord', 'https://discord.com/api/users/@me'],
    ['discord lookalike host', 'discord', 'https://discordapp.com.evil.com/api/webhooks/123456789012345678/abcDEF_ghi-JKLmno'],
    ['discord token shape', 'discord', 'https://discord.com/api/webhooks/abc/def'],
    ['teams wrong path', 'teams', 'https://contoso.webhook.office.com/admin'],
    ['outlook wrong path', 'teams', 'https://outlook.office.com/mail/inbox'],
    ['notion subdomain', 'notion', 'https://evil.api.notion.com/v1/pages'],
    ['notion www', 'notion', 'https://www.notion.so/page'],
    ['empty', 'slack', ''],
    ['not a url', 'slack', 'hooks.slack.com/services/T/B/X'],
    ['protocol relative', 'slack', '//hooks.slack.com/services/T/B/X'],
    ['number', 'slack', 123],
    ['null', 'slack', null],
    ['object', 'slack', { href: SLACK }],
    ['too long', 'slack', `${SLACK}/${'a'.repeat(3000)}`],
  ];
  for (const [name, kind, url] of cases) it(`refuses ${name}`, () => refused(kind, url));

  it('gives a pt-BR reason', () => {
    expect(checkUrl('slack', 'http://hooks.slack.com/services/T/B/X')).toEqual({ error: expect.stringMatching(/https/i) });
    expect(checkUrl('slack', 'https://evil.com/')).toEqual({ error: expect.stringContaining('Slack') });
  });
});

describe('normalizeSite', () => {
  it('turns a name, a host or a URL into the https origin', () => {
    expect(normalizeSite('acme')).toBe('https://acme.atlassian.net');
    expect(normalizeSite(' Acme.atlassian.net ')).toBe('https://acme.atlassian.net');
    expect(normalizeSite('https://acme.atlassian.net/jira/software')).toBe('https://acme.atlassian.net');
  });
  it('refuses anything that is not a single Atlassian Cloud site', () => {
    for (const raw of ['', 'evil.com', 'acme.atlassian.net.evil.com', 'http://acme.atlassian.net', 'user@acme.atlassian.net', 'acme.atlassian.net:8443', 'a b', '-acme', 'acme/../x', 'a.b.atlassian.net', 42, null]) {
      expect(typeof normalizeSite(raw), String(raw)).toBe('object');
    }
  });
});

describe('safeFetch', () => {
  const res = (status: number, headers: Record<string, string> = {}, body = '{}') => new Response(body, { status, headers });

  it('never lets fetch follow redirects by itself', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => res(200));
    await safeFetch(fetch, 'notion', 'https://api.notion.com/v1/users/me', { method: 'GET' });
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' });
  });

  it('refuses a URL outside the allowlist before any request', async () => {
    const fetch = vi.fn();
    await expect(safeFetch(fetch, 'notion', 'https://evil.com/', {})).rejects.toBeInstanceOf(IntegrationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not follow a redirect to a host outside the allowlist (and never sends the credentials there)', async () => {
    const fetch = vi.fn(async () => res(307, { location: 'https://evil.com/steal' }));
    await expect(safeFetch(fetch, 'notion', 'https://api.notion.com/v1/pages', { method: 'POST', headers: { authorization: 'Bearer secret' } })).rejects.toThrow(/redirecion/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not follow redirects to loopback, metadata, other schemes or userinfo tricks', async () => {
    for (const location of ['http://127.0.0.1/', 'https://169.254.169.254/', 'file:///etc/passwd', 'https://api.notion.com@evil.com/', '//evil.com/', 'https://api.notion.com.evil.com/']) {
      const fetch = vi.fn(async () => res(307, { location }));
      await expect(safeFetch(fetch, 'notion', 'https://api.notion.com/v1/pages', {}), location).rejects.toBeInstanceOf(IntegrationError);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it('does not follow a redirect to another allowlisted origin either (credentials stay on the origin they were meant for)', async () => {
    const fetch = vi.fn(async () => res(307, { location: 'https://other.atlassian.net/rest/api/3/myself' }));
    await expect(safeFetch(fetch, 'atlassian', 'https://acme.atlassian.net/rest/api/3/myself', {})).rejects.toBeInstanceOf(IntegrationError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses 301/302/303 (they would turn a POST into a GET) and a redirect without Location', async () => {
    for (const status of [301, 302, 303]) {
      const fetch = vi.fn(async () => res(status, { location: 'https://api.notion.com/v1/other' }));
      await expect(safeFetch(fetch, 'notion', 'https://api.notion.com/v1/pages', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(IntegrationError);
    }
    await expect(safeFetch(async () => res(307), 'notion', 'https://api.notion.com/v1/pages', {})).rejects.toBeInstanceOf(IntegrationError);
  });

  it('follows a 307/308 inside the same origin and allowlist, a bounded number of times', async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return calls.length === 1 ? res(308, { location: '/v1/pages/moved' }) : res(200, {}, '{"ok":true}');
    });
    const out = await safeFetch(fetch, 'notion', 'https://api.notion.com/v1/pages', { method: 'POST', body: '{}' });
    expect(out.status).toBe(200);
    expect(calls).toEqual(['https://api.notion.com/v1/pages', 'https://api.notion.com/v1/pages/moved']);

    const loop = vi.fn(async () => res(307, { location: '/v1/pages' }));
    await expect(safeFetch(loop, 'notion', 'https://api.notion.com/v1/pages', {})).rejects.toBeInstanceOf(IntegrationError);
    expect(loop.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('keeps the webhook path rule on a same-origin redirect', async () => {
    const fetch = vi.fn(async () => res(307, { location: '/api/chat.postMessage' }));
    await expect(safeFetch(fetch, 'slack', SLACK, { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(IntegrationError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('puts a deadline on every request', async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return res(200);
    });
    await safeFetch(fetch, 'notion', 'https://api.notion.com/v1/users/me', {});
  });

  it('reports a network failure without leaking the URL (a webhook URL is a secret)', async () => {
    const fetch = vi.fn(async () => { throw new TypeError(`fetch failed for ${SLACK}`); });
    const error = await safeFetch(fetch, 'slack', SLACK, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrationError);
    expect((error as Error).message).not.toContain('XXXXXXXX');
  });
});
