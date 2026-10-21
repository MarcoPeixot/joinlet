import { checkUrl, normalizeSite } from './hosts';

/**
 * `integrations.json` next to settings.json in the config folder (0600, never in the repo, never sent back to the
 * browser beyond `…abcd` hints). Same rules as settings.ts: everything read from disk is untrusted and re-validated,
 * a patch replaces only what it names, and `null` removes.
 */

export const WEBHOOK_KINDS = ['slack', 'teams', 'discord'] as const;
export type WebhookKind = (typeof WEBHOOK_KINDS)[number];
export const NOTIFY_EVENTS = ['version', 'pr', 'drift'] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export interface IntegrationsFile {
  version: 1;
  webhooks: Partial<Record<WebhookKind, { url: string; events: NotifyEvent[] }>>;
  notion?: { token: string; parentPageId?: string };
  atlassian?: { site: string; email: string; token: string };
  confluence?: { spaceKey: string; parentId?: string };
  jira?: { projectKey: string; issueType: string };
}

export interface IntegrationsView {
  webhooks: Record<WebhookKind, { configured: boolean; host: string | null; hint: string | null; events: NotifyEvent[] }>;
  notion: { configured: boolean; hint: string | null; parentPageId: string | null };
  atlassian: { configured: boolean; site: string | null; email: string | null; hint: string | null };
  confluence: { spaceKey: string | null; parentId: string | null };
  jira: { projectKey: string | null; issueType: string | null };
}

export const emptyFile = (): IntegrationsFile => ({ version: 1, webhooks: {} });

const GROUPS = ['webhooks', 'notion', 'atlassian', 'confluence', 'jira'] as const;
const MAX_TOKEN = 400;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (record: Record<string, unknown>, key: string): unknown => (Object.hasOwn(record, key) ? record[key] : undefined);
const hint = (secret: string) => `…${secret.slice(-4)}`;

type Checked<T> = T | { error: string };
const isError = (value: unknown): value is { error: string } => isObject(value) && typeof value.error === 'string';

function cleanToken(raw: unknown, what: string): Checked<string> {
  if (typeof raw !== 'string' || !raw.trim()) return { error: `Informe o token ${what}.` };
  const token = raw.trim();
  if (/\s/.test(token)) return { error: `O token ${what} não pode ter espaços.` };
  if (token.length > MAX_TOKEN) return { error: `O token ${what} é longo demais.` };
  return token;
}

function cleanEvents(raw: unknown): Checked<NotifyEvent[]> {
  if (!Array.isArray(raw)) return { error: 'Os eventos precisam ser uma lista (version, pr, drift).' };
  if (raw.some((event) => !(NOTIFY_EVENTS as readonly unknown[]).includes(event))) return { error: 'Evento desconhecido: use version, pr ou drift.' };
  return NOTIFY_EVENTS.filter((event) => raw.includes(event));
}

/** A Notion page id: 32 hex, dashed UUID, or a notion.so URL ending in one (→ 32 hex). */
function cleanNotionPage(raw: unknown): Checked<string> {
  const invalid = { error: 'O ID da página do Notion é inválido (use o ID ou o link da página).' };
  if (typeof raw !== 'string') return invalid;
  const text = raw.trim();
  if (/^[0-9a-f]{32}$/i.test(text)) return text.toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return text.replace(/-/g, '').toLowerCase();
  const url = /^https:\/\/(?:www\.)?notion\.(?:so|site)\/[^\s?#]*?([0-9a-f]{32})(?:[?#]\S*)?$/i.exec(text);
  return url ? url[1]!.toLowerCase() : invalid;
}

function patchWebhook(file: IntegrationsFile, kind: WebhookKind, raw: unknown): IntegrationsFile | string {
  const webhooks = { ...file.webhooks };
  if (raw === null) {
    delete webhooks[kind];
    return { ...file, webhooks };
  }
  if (!isObject(raw)) return `Corpo inválido: "webhooks.${kind}" precisa ser um objeto ou null.`;
  const current = file.webhooks[kind];
  let url = current?.url;
  const rawUrl = own(raw, 'url');
  if (rawUrl !== undefined) {
    const checked = checkUrl(kind, rawUrl);
    if ('error' in checked) return checked.error;
    url = checked.href;
  }
  if (!url) return `Informe o endereço do webhook do ${kind === 'slack' ? 'Slack' : kind === 'teams' ? 'Teams' : 'Discord'}.`;
  let events = current?.events ?? [...NOTIFY_EVENTS];
  const rawEvents = own(raw, 'events');
  if (rawEvents !== undefined) {
    const checked = cleanEvents(rawEvents);
    if (isError(checked)) return checked.error;
    events = checked;
  }
  webhooks[kind] = { url, events };
  return { ...file, webhooks };
}

function patchNotion(file: IntegrationsFile, raw: unknown): IntegrationsFile | string {
  if (raw === null) return omit(file, 'notion');
  if (!isObject(raw)) return 'Corpo inválido: "notion" precisa ser um objeto ou null.';
  const rawToken = own(raw, 'token');
  const token = rawToken === undefined ? file.notion?.token : cleanToken(rawToken, 'do Notion');
  if (isError(token)) return token.error;
  if (!token) return 'Informe o token da integração do Notion.';
  let parentPageId = file.notion?.parentPageId;
  const rawPage = own(raw, 'parentPageId');
  if (rawPage === null) parentPageId = undefined;
  else if (rawPage !== undefined) {
    const page = cleanNotionPage(rawPage);
    if (isError(page)) return page.error;
    parentPageId = page;
  }
  return { ...file, notion: { token, ...(parentPageId ? { parentPageId } : {}) } };
}

function patchAtlassian(file: IntegrationsFile, raw: unknown): IntegrationsFile | string {
  if (raw === null) return omit(file, 'atlassian');
  if (!isObject(raw)) return 'Corpo inválido: "atlassian" precisa ser um objeto ou null.';
  const current = file.atlassian;
  const rawSite = own(raw, 'site');
  const site = rawSite === undefined ? current?.site : normalizeSite(rawSite);
  if (isError(site)) return site.error;
  const rawEmail = own(raw, 'email');
  const email = rawEmail === undefined ? current?.email : typeof rawEmail === 'string' ? rawEmail.trim() : undefined;
  if (email !== undefined && !/^[^\s@]{1,100}@[^\s@]{1,200}\.[^\s@]{2,}$/.test(email)) return 'O e-mail da conta Atlassian é inválido.';
  const rawToken = own(raw, 'token');
  const token = rawToken === undefined ? current?.token : cleanToken(rawToken, 'da Atlassian');
  if (isError(token)) return token.error;
  if (!site) return 'Informe o site da Atlassian (por exemplo, empresa.atlassian.net).';
  if (!email) return 'Informe o e-mail da conta Atlassian.';
  if (!token) return 'Informe o token da Atlassian.';
  return { ...file, atlassian: { site, email, token } };
}

function patchConfluence(file: IntegrationsFile, raw: unknown): IntegrationsFile | string {
  if (raw === null) return omit(file, 'confluence');
  if (!isObject(raw)) return 'Corpo inválido: "confluence" precisa ser um objeto ou null.';
  const rawKey = own(raw, 'spaceKey');
  const spaceKey = rawKey === undefined ? file.confluence?.spaceKey : typeof rawKey === 'string' && /^~?[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/.test(rawKey.trim()) ? rawKey.trim() : null;
  if (spaceKey === null) return 'A chave do espaço do Confluence é inválida (letras, números, "-" e "_").';
  if (!spaceKey) return 'Informe a chave do espaço do Confluence.';
  let parentId = file.confluence?.parentId;
  const rawParent = own(raw, 'parentId');
  if (rawParent === null || rawParent === '') parentId = undefined;
  else if (rawParent !== undefined) {
    if (typeof rawParent !== 'string' || !/^\d{1,20}$/.test(rawParent.trim())) return 'O ID da página-mãe do Confluence é inválido (só números).';
    parentId = rawParent.trim();
  }
  return { ...file, confluence: { spaceKey, ...(parentId ? { parentId } : {}) } };
}

function patchJira(file: IntegrationsFile, raw: unknown): IntegrationsFile | string {
  if (raw === null) return omit(file, 'jira');
  if (!isObject(raw)) return 'Corpo inválido: "jira" precisa ser um objeto ou null.';
  const rawKey = own(raw, 'projectKey');
  const projectKey = rawKey === undefined ? file.jira?.projectKey : typeof rawKey === 'string' && /^[A-Za-z][A-Za-z0-9_]{1,19}$/.test(rawKey.trim()) ? rawKey.trim().toUpperCase() : null;
  if (projectKey === null) return 'A chave do projeto do Jira é inválida (por exemplo, ENG).';
  const rawType = own(raw, 'issueType');
  const issueType = rawType === undefined ? file.jira?.issueType : typeof rawType === 'string' && /^[\p{L}\p{N} _.-]{1,60}$/u.test(rawType.trim()) ? rawType.trim() : null;
  if (issueType === null) return 'O tipo de tarefa do Jira é inválido (por exemplo, Task).';
  if (!projectKey) return 'Informe a chave do projeto do Jira.';
  return { ...file, jira: { projectKey, issueType: issueType ?? 'Task' } };
}

function omit(file: IntegrationsFile, key: Exclude<keyof IntegrationsFile, 'version' | 'webhooks'>): IntegrationsFile {
  const { [key]: _removed, ...rest } = file;
  return rest;
}

/** POST /api/integrations body → the next file, or a pt-BR reason. Never mutates `file`. */
export function applyPatch(file: IntegrationsFile, raw: unknown): IntegrationsFile | string {
  if (!isObject(raw)) return 'Corpo inválido: envie um objeto JSON.';
  let next: IntegrationsFile | string = { ...file, webhooks: { ...file.webhooks } };
  for (const group of Object.keys(raw)) {
    if (!(GROUPS as readonly string[]).includes(group)) return `Corpo inválido: grupo desconhecido "${group.slice(0, 40)}".`;
  }
  const webhooks = own(raw, 'webhooks');
  if (webhooks !== undefined) {
    if (!isObject(webhooks)) return 'Corpo inválido: "webhooks" precisa ser um objeto.';
    for (const kind of Object.keys(webhooks)) {
      if (!(WEBHOOK_KINDS as readonly string[]).includes(kind)) return `Corpo inválido: webhook desconhecido "${kind.slice(0, 40)}".`;
      next = patchWebhook(next, kind as WebhookKind, own(webhooks, kind));
      if (typeof next === 'string') return next;
    }
  }
  const steps: [string, (file: IntegrationsFile, raw: unknown) => IntegrationsFile | string][] = [['notion', patchNotion], ['atlassian', patchAtlassian], ['confluence', patchConfluence], ['jira', patchJira]];
  for (const [group, patch] of steps) {
    const value = own(raw, group);
    if (value === undefined) continue;
    next = patch(next, value);
    if (typeof next === 'string') return next;
  }
  return next;
}

/** The file as read from disk: untrusted, so each group is re-validated on its own and a bad one is dropped. */
export function parseIntegrationsFile(text: string | null): IntegrationsFile {
  let file = emptyFile();
  if (!text) return file;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return file;
  }
  if (!isObject(raw)) return file;
  const take = (patch: Record<string, unknown>) => {
    const next = applyPatch(file, patch);
    if (typeof next !== 'string') file = next;
  };
  const webhooks = own(raw, 'webhooks');
  if (isObject(webhooks)) {
    for (const kind of WEBHOOK_KINDS) {
      const hook = own(webhooks, kind);
      if (!isObject(hook)) continue;
      const events = Array.isArray(own(hook, 'events')) ? NOTIFY_EVENTS.filter((event) => (own(hook, 'events') as unknown[]).includes(event)) : undefined;
      take({ webhooks: { [kind]: { url: own(hook, 'url'), ...(events ? { events } : {}) } } });
    }
  }
  for (const group of ['notion', 'atlassian', 'confluence', 'jira'] as const) {
    const value = own(raw, group);
    if (isObject(value)) take({ [group]: value });
  }
  return file;
}

export function buildView(file: IntegrationsFile): IntegrationsView {
  const hook = (kind: WebhookKind) => {
    const entry = file.webhooks[kind];
    return entry ? { configured: true, host: new URL(entry.url).hostname, hint: hint(new URL(entry.url).pathname), events: [...entry.events] } : { configured: false, host: null, hint: null, events: [] };
  };
  return {
    webhooks: { slack: hook('slack'), teams: hook('teams'), discord: hook('discord') },
    notion: { configured: !!file.notion, hint: file.notion ? hint(file.notion.token) : null, parentPageId: file.notion?.parentPageId ?? null },
    atlassian: { configured: !!file.atlassian, site: file.atlassian?.site ?? null, email: file.atlassian?.email ?? null, hint: file.atlassian ? hint(file.atlassian.token) : null },
    confluence: { spaceKey: file.confluence?.spaceKey ?? null, parentId: file.confluence?.parentId ?? null },
    jira: { projectKey: file.jira?.projectKey ?? null, issueType: file.jira?.issueType ?? null },
  };
}
