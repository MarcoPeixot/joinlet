import { describe, expect, it, vi } from 'vitest';
import { applyPatch, emptyFile } from './config';
import type { IntegrationsFile } from './config';
import { formatMessage, notifyAll, sendWebhook } from './notify';
import type { NotifyPayload } from './notify';

const SLACK = 'https://hooks.slack.com/services/T000/B000/XXXXXXXXabcd';
const TEAMS = 'https://contoso.webhook.office.com/webhookb2/abc@def/IncomingWebhook/ghi/jkl';
const DISCORD = 'https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKLmno1234';

const configured = (patch: unknown): IntegrationsFile => {
  const file = applyPatch(emptyFile(), patch);
  if (typeof file === 'string') throw new Error(file);
  return file;
};
const all = configured({ webhooks: { slack: { url: SLACK }, teams: { url: TEAMS }, discord: { url: DISCORD } } });

const version: NotifyPayload = { event: 'version', diagram: 'checkout', message: 'Adiciona fila', author: 'agent' };
const pr: NotifyPayload = { event: 'pr', title: 'docs(arch): checkout', url: 'https://github.com/acme/repo/pull/7', branch: 'strukt/checkout-2026-10-03' };
const drift: NotifyPayload = { event: 'drift', count: 3, items: ['checkout › API: arquivo não encontrado', 'checkout › DB: trecho mudou'], source: 'Precisão' };

const okResponse = () => new Response(null, { status: 204 });

describe('formatMessage', () => {
  it('describes each event in pt-BR', () => {
    expect(formatMessage(version).title).toMatch(/versão/i);
    expect(formatMessage(version).lines.join('\n')).toContain('checkout');
    expect(formatMessage({ ...version, author: 'ai' }).title).toMatch(/IA/);
    expect(formatMessage({ ...version, author: 'agent' }).title).toMatch(/agente/i);
    expect(formatMessage(pr).lines.join('\n')).toContain('strukt/checkout-2026-10-03');
    expect(formatMessage(drift).title).toMatch(/deriva|diverg/i);
    expect(formatMessage(drift).lines.join('\n')).toContain('3');
  });

  it('bounds the text and strips control characters', () => {
    const long = formatMessage({ ...version, message: `${'x'.repeat(5_000)}\u0007\u0000` });
    expect(long.lines.join('').length).toBeLessThan(800);
    expect(long.lines.join('')).not.toMatch(/[\u0000-\u0008]/);
    const items = formatMessage({ ...drift, items: Array.from({ length: 100 }, (_, i) => `item ${i}`) });
    expect(items.lines.length).toBeLessThan(15);
  });
});

describe('sendWebhook payloads', () => {
  const capture = async (kind: 'slack' | 'teams' | 'discord', payload: NotifyPayload) => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => okResponse());
    const file = all;
    const result = await sendWebhook(fetch, kind, file.webhooks[kind]!.url, payload);
    expect(result.ok).toBe(true);
    const [url, init] = fetch.mock.calls[0]!;
    return { url: String(url), init: init!, body: JSON.parse(String(init!.body)) as Record<string, unknown> };
  };

  it('posts JSON to Slack with mrkdwn-safe text', async () => {
    const { url, init, body } = await capture('slack', { ...version, message: 'olha <!channel> & <@U123> <https://evil.com|clique>' });
    expect(url).toBe(SLACK);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    const text = String(body.text);
    expect(text).not.toContain('<!channel>');
    expect(text).not.toContain('<@U123>');
    expect(text).not.toContain('<https://evil.com|clique>');
    expect(text).toContain('&lt;!channel&gt;');
  });

  it('links the pull request in Slack and Discord, and suppresses embeds/mentions in Discord', async () => {
    const slack = await capture('slack', pr);
    expect(String(slack.body.text)).toContain('<https://github.com/acme/repo/pull/7|');
    const discord = await capture('discord', { ...version, message: '@everyone @here <@123>' });
    expect(discord.body.allowed_mentions).toEqual({ parse: [] });
    expect(String(discord.body.content).length).toBeLessThanOrEqual(2_000);
    expect(discord.body.username).toBe('Joinlet');
  });

  it('sends a MessageCard to Teams', async () => {
    const { body } = await capture('teams', drift);
    expect(body['@type']).toBe('MessageCard');
    expect(body['@context']).toBe('https://schema.org/extensions');
    expect(String(body.title)).toMatch(/deriva|diverg/i);
    expect(JSON.stringify(body)).toContain('checkout');
  });

  it('does not link a PR URL that is not https (it would break out of the Slack link syntax)', async () => {
    const slack = await capture('slack', { ...pr, url: 'https://x.com/a|b>c' });
    expect(String(slack.body.text)).not.toContain('<https://x.com/a|b>c|');
    const none = await capture('slack', { ...pr, url: 'javascript:alert(1)' });
    expect(String(none.body.text)).not.toContain('javascript:');
  });

  it('reports failures without leaking the URL', async () => {
    const down = vi.fn(async () => new Response('bad', { status: 404 }));
    const result = await sendWebhook(down, 'slack', SLACK, version);
    expect(result).toEqual({ ok: false, detail: expect.stringContaining('404') });
    expect(JSON.stringify(result)).not.toContain('XXXXXXXX');
    const rejected = await sendWebhook(vi.fn(async () => { throw new Error(`boom ${SLACK}`); }), 'slack', SLACK, version);
    expect(rejected.ok).toBe(false);
    expect(JSON.stringify(rejected)).not.toContain('XXXXXXXX');
  });

  it('never calls a URL that left the allowlist (a hand-edited file)', async () => {
    const fetch = vi.fn();
    const result = await sendWebhook(fetch, 'slack', 'https://evil.com/services/T/B/X', version);
    expect(result.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not follow a webhook redirect', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 307, headers: { location: 'https://evil.com/' } }));
    const result = await sendWebhook(fetch, 'slack', SLACK, version);
    expect(result.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('notifyAll', () => {
  it('sends only to the webhooks subscribed to the event', async () => {
    const file = configured({ webhooks: { slack: { url: SLACK, events: ['pr'] }, teams: { url: TEAMS, events: ['version'] }, discord: { url: DISCORD } } });
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string | URL | Request) => { urls.push(String(url)); return okResponse(); });
    const results = await notifyAll(fetch, file, version);
    expect(results.map((r) => r.kind).sort()).toEqual(['discord', 'teams']);
    expect(urls.sort()).toEqual([DISCORD, TEAMS].sort());
  });

  it('keeps going when one webhook fails and never throws', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => (String(url).includes('slack') ? new Response('no', { status: 500 }) : okResponse()));
    const results = await notifyAll(fetch, all, pr);
    expect(results).toHaveLength(3);
    expect(results.find((r) => r.kind === 'slack')!.ok).toBe(false);
    expect(results.filter((r) => r.ok)).toHaveLength(2);
  });

  it('does nothing without webhooks', async () => {
    const fetch = vi.fn();
    expect(await notifyAll(fetch, emptyFile(), version)).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
