import { describe, expect, it } from 'vitest';
import { applyPatch, buildView, emptyFile, parseIntegrationsFile } from './config';
import type { IntegrationsFile } from './config';

const SLACK = 'https://hooks.slack.com/services/T000/B000/XXXXXXXXabcd';
const must = (file: IntegrationsFile, patch: unknown): IntegrationsFile => {
  const next = applyPatch(file, patch);
  if (typeof next === 'string') throw new Error(next);
  return next;
};

describe('applyPatch', () => {
  it('stores a webhook with every event by default', () => {
    const file = must(emptyFile(), { webhooks: { slack: { url: SLACK } } });
    expect(file.webhooks.slack).toEqual({ url: SLACK, events: ['version', 'pr', 'drift'] });
  });

  it('changes events without resending the URL, and removes with null', () => {
    let file = must(emptyFile(), { webhooks: { discord: { url: 'https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKLmno1234' } } });
    file = must(file, { webhooks: { discord: { events: ['pr', 'pr', 'version'] } } });
    expect(file.webhooks.discord!.events).toEqual(['version', 'pr']);
    file = must(file, { webhooks: { discord: null } });
    expect(file.webhooks.discord).toBeUndefined();
  });

  it('refuses a webhook URL outside the allowlist, with a pt-BR reason', () => {
    expect(applyPatch(emptyFile(), { webhooks: { slack: { url: 'https://evil.com/services/T/B/X' } } })).toMatch(/Slack/);
    expect(applyPatch(emptyFile(), { webhooks: { slack: { url: 'http://hooks.slack.com/services/T/B/X' } } })).toMatch(/https/);
    expect(applyPatch(emptyFile(), { webhooks: { teams: { url: SLACK } } })).toMatch(/Teams/);
  });

  it('needs a URL before events can be set, and rejects unknown events and kinds', () => {
    expect(applyPatch(emptyFile(), { webhooks: { slack: { events: ['pr'] } } })).toMatch(/endereço/i);
    expect(applyPatch(emptyFile(), { webhooks: { slack: { url: SLACK, events: ['boom'] } } })).toMatch(/evento/i);
    expect(applyPatch(emptyFile(), { webhooks: { whatsapp: { url: SLACK } } })).toMatch(/desconhecido|inválid/i);
    expect(applyPatch(emptyFile(), { webhooks: { slack: { url: SLACK, events: 'pr' } } })).toMatch(/evento/i);
  });

  it('stores Notion credentials and accepts the parent page as id, dashed id or URL', () => {
    const id = '0123456789abcdef0123456789abcdef';
    for (const raw of [id, '01234567-89ab-cdef-0123-456789abcdef', `https://www.notion.so/Minha-Pagina-${id}`, `https://www.notion.so/ws/Minha-Pagina-${id}?pvs=4`]) {
      expect(must(emptyFile(), { notion: { token: 'ntn_abc123', parentPageId: raw } }).notion).toEqual({ token: 'ntn_abc123', parentPageId: id });
    }
    expect(applyPatch(emptyFile(), { notion: { token: 'ntn_abc', parentPageId: 'not a page' } })).toMatch(/página/i);
    expect(applyPatch(emptyFile(), { notion: { parentPageId: id } })).toMatch(/token/i);
  });

  it('keeps a stored token when a patch only changes another field', () => {
    let file = must(emptyFile(), { notion: { token: 'ntn_abc123' } });
    file = must(file, { notion: { parentPageId: 'f'.repeat(32) } });
    expect(file.notion).toEqual({ token: 'ntn_abc123', parentPageId: 'f'.repeat(32) });
    file = must(file, { notion: { parentPageId: null } });
    expect(file.notion).toEqual({ token: 'ntn_abc123' });
  });

  it('normalises the Atlassian site and validates the email and token', () => {
    const file = must(emptyFile(), { atlassian: { site: 'Acme', email: 'a@b.co', token: 'tok123' } });
    expect(file.atlassian).toEqual({ site: 'https://acme.atlassian.net', email: 'a@b.co', token: 'tok123' });
    expect(applyPatch(emptyFile(), { atlassian: { site: 'evil.com', email: 'a@b.co', token: 't' } })).toMatch(/site/i);
    expect(applyPatch(emptyFile(), { atlassian: { site: 'acme', email: 'nope', token: 't' } })).toMatch(/e-mail/i);
    expect(applyPatch(emptyFile(), { atlassian: { site: 'acme', email: 'a@b.co', token: 'has space' } })).toMatch(/espaços/);
    expect(applyPatch(emptyFile(), { atlassian: { site: 'acme', email: 'a@b.co' } })).toMatch(/token/i);
  });

  it('validates the Confluence space and the Jira project', () => {
    const file = must(emptyFile(), { confluence: { spaceKey: 'ENG', parentId: '12345' }, jira: { projectKey: 'eng', issueType: 'Task' } });
    expect(file.confluence).toEqual({ spaceKey: 'ENG', parentId: '12345' });
    expect(file.jira).toEqual({ projectKey: 'ENG', issueType: 'Task' });
    expect(applyPatch(emptyFile(), { confluence: { spaceKey: 'a b' } })).toMatch(/espaço/i);
    expect(applyPatch(emptyFile(), { confluence: { spaceKey: 'ENG', parentId: 'abc' } })).toMatch(/página/i);
    expect(applyPatch(emptyFile(), { jira: { projectKey: '1', issueType: 'Task' } })).toMatch(/projeto/i);
    expect(applyPatch(emptyFile(), { jira: { projectKey: 'ENG', issueType: '' } })).toMatch(/tipo/i);
    expect(must(file, { jira: null }).jira).toBeUndefined();
  });

  it('refuses a non-object body, unknown groups and __proto__ keys without touching Object.prototype', () => {
    expect(applyPatch(emptyFile(), 'x')).toMatch(/objeto/);
    expect(applyPatch(emptyFile(), [])).toMatch(/objeto/);
    expect(applyPatch(emptyFile(), { magic: {} })).toMatch(/desconhecid/i);
    expect(applyPatch(emptyFile(), JSON.parse('{"webhooks":{"__proto__":{"url":"x"}}}'))).toMatch(/desconhecid|inválid/i);
    expect(applyPatch(emptyFile(), JSON.parse('{"__proto__":{"polluted":true}}'))).toMatch(/desconhecid|inválid/i);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('does not mutate the file it was given', () => {
    const file = must(emptyFile(), { notion: { token: 'a1' } });
    const copy = structuredClone(file);
    must(file, { notion: { token: 'b2' }, webhooks: { slack: { url: SLACK } } });
    expect(file).toEqual(copy);
  });
});

describe('parseIntegrationsFile (untrusted JSON from disk)', () => {
  it('falls back to empty on missing or broken files', () => {
    expect(parseIntegrationsFile(null)).toEqual(emptyFile());
    expect(parseIntegrationsFile('{nope')).toEqual(emptyFile());
    expect(parseIntegrationsFile('[1]')).toEqual(emptyFile());
  });

  it('re-validates everything: a hand-edited bad host or key is dropped, the rest survives', () => {
    const text = JSON.stringify({
      webhooks: { slack: { url: 'https://evil.com/services/T/B/X', events: ['pr'] }, discord: { url: 'https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKLmno1234', events: ['pr', 'zzz'] } },
      notion: { token: 'ntn_abc' },
      atlassian: { site: 'http://acme.atlassian.net', email: 'a@b.co', token: 't' },
      jira: { projectKey: 'ENG', issueType: 'Bug' },
    });
    const file = parseIntegrationsFile(text);
    expect(file.webhooks.slack).toBeUndefined();
    expect(file.webhooks.discord?.events).toEqual(['pr']);
    expect(file.notion).toEqual({ token: 'ntn_abc' });
    expect(file.atlassian).toBeUndefined();
    expect(file.jira).toEqual({ projectKey: 'ENG', issueType: 'Bug' });
  });

  it('treats __proto__ as a plain name', () => {
    parseIntegrationsFile('{"__proto__":{"polluted":true},"webhooks":{"__proto__":{"url":"x"}}}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('buildView (what GET answers: never a secret)', () => {
  it('shows status and …abcd hints only', () => {
    const file = must(emptyFile(), {
      webhooks: { slack: { url: SLACK, events: ['pr'] } },
      notion: { token: 'ntn_supersecret9876', parentPageId: 'a'.repeat(32) },
      atlassian: { site: 'acme', email: 'a@b.co', token: 'atl_supersecret5555' },
      confluence: { spaceKey: 'ENG' },
      jira: { projectKey: 'ENG', issueType: 'Task' },
    });
    const view = buildView(file);
    expect(view.webhooks.slack).toEqual({ configured: true, host: 'hooks.slack.com', hint: '…abcd', events: ['pr'] });
    expect(view.webhooks.teams).toEqual({ configured: false, host: null, hint: null, events: [] });
    expect(view.notion).toEqual({ configured: true, hint: '…9876', parentPageId: 'a'.repeat(32) });
    expect(view.atlassian).toEqual({ configured: true, site: 'https://acme.atlassian.net', email: 'a@b.co', hint: '…5555' });
    expect(view.confluence).toEqual({ spaceKey: 'ENG', parentId: null });
    expect(view.jira).toEqual({ projectKey: 'ENG', issueType: 'Task' });
    const json = JSON.stringify(view);
    for (const secret of ['supersecret', 'XXXXXXXX', 'T000/B000', '/services/']) expect(json).not.toContain(secret);
  });

  it('is all empty for a new file', () => {
    const view = buildView(emptyFile());
    expect(view.notion).toEqual({ configured: false, hint: null, parentPageId: null });
    expect(view.atlassian).toEqual({ configured: false, site: null, email: null, hint: null });
  });
});
