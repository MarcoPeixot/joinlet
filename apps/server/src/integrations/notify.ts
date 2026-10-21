import { WEBHOOK_KINDS } from './config';
import type { IntegrationsFile, NotifyEvent, WebhookKind } from './config';
import { IntegrationError, safeFetch } from './hosts';
import type { FetchLike } from './hosts';

/** Webhook notifications: one message per event, rendered in each service's own format. */

export type NotifyPayload =
  | { event: 'version'; diagram: string; message: string; author: 'ai' | 'agent' }
  | { event: 'pr'; title: string; url: string; branch?: string }
  | { event: 'drift'; count: number; items: string[]; source?: string }
  | { event: 'test' };

export interface WebhookResult {
  kind: WebhookKind;
  ok: boolean;
  detail: string;
}

interface Message {
  title: string;
  lines: string[];
  link?: { url: string; label: string };
}

const LABEL: Record<WebhookKind, string> = { slack: 'Slack', teams: 'Teams', discord: 'Discord' };
const MAX_LINE = 240;
const MAX_ITEMS = 8;

/** One line of text from the author: no control characters, no line breaks, bounded. */
// eslint-disable-next-line no-control-regex
const clean = (text: string, max = MAX_LINE) => {
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Only a plain https URL can be linked: `|`, `<` and `>` would break out of Slack's `<url|label>` syntax. */
const linkable = (url: string) => /^https:\/\/[^\s|<>"]{1,500}$/.test(url);

export function formatMessage(payload: NotifyPayload): Message {
  switch (payload.event) {
    case 'version':
      return {
        title: payload.author === 'ai' ? 'Nova versão salva pela IA' : 'Nova versão salva por um agente',
        lines: [`Diagrama: ${clean(payload.diagram, 80)}`, `Mensagem: ${clean(payload.message)}`],
      };
    case 'pr':
      return {
        title: 'PR de arquitetura aberto',
        lines: [`Título: ${clean(payload.title)}`, ...(payload.branch ? [`Branch: ${clean(payload.branch, 120)}`] : [])],
        ...(linkable(payload.url) ? { link: { url: payload.url, label: 'Abrir o PR' } } : {}),
      };
    case 'drift': {
      const count = Math.max(0, Math.trunc(payload.count));
      const shown = payload.items.slice(0, MAX_ITEMS).map((item) => `• ${clean(item)}`);
      const rest = Math.max(0, count - shown.length);
      return {
        title: 'Deriva encontrada na arquitetura',
        lines: [
          `${count} ${count === 1 ? 'item diverge' : 'itens divergem'} do código${payload.source ? ` (${clean(payload.source, 60)})` : ''}.`,
          ...shown,
          ...(rest > 0 ? [`… e mais ${rest}.`] : []),
        ],
      };
    }
    case 'test':
      return { title: 'Teste do Joinlet', lines: ['A integração está configurada e este aviso chegou.'] };
  }
}

const escapeSlack = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeTeams = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function body(kind: WebhookKind, message: Message): Record<string, unknown> {
  switch (kind) {
    case 'slack': {
      const link = message.link ? `\n<${message.link.url}|${escapeSlack(message.link.label)}>` : '';
      return { text: `*${escapeSlack(message.title)}*\n${message.lines.map(escapeSlack).join('\n')}${link}` };
    }
    case 'discord': {
      const link = message.link ? `\n<${message.link.url}>` : '';
      const content = `**${message.title}**\n${message.lines.join('\n')}${link}`;
      // allowed_mentions: a version message written by an agent must never ping @everyone.
      return { username: 'Joinlet', content: content.slice(0, 2_000), allowed_mentions: { parse: [] } };
    }
    case 'teams':
      return {
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        summary: message.title,
        themeColor: '5B5BD6',
        title: message.title,
        text: message.lines.map(escapeTeams).join('\n\n'),
        ...(message.link ? { potentialAction: [{ '@type': 'OpenUri', name: message.link.label, targets: [{ os: 'default', uri: message.link.url }] }] } : {}),
      };
  }
}

/** Sends one message; a failure is a result, never a throw, and never mentions the URL (it is a secret). */
export async function sendWebhook(fetchImpl: FetchLike, kind: WebhookKind, url: string, payload: NotifyPayload): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await safeFetch(fetchImpl, kind, url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body(kind, formatMessage(payload))),
    });
    void res.body?.cancel().catch(() => undefined);
    if (res.ok) return { ok: true, detail: `Aviso enviado ao ${LABEL[kind]}.` };
    return { ok: false, detail: `O ${LABEL[kind]} respondeu com erro ${res.status}.` };
  } catch (error) {
    return { ok: false, detail: error instanceof IntegrationError ? error.message : `Não foi possível falar com o ${LABEL[kind]}.` };
  }
}

/** Every webhook subscribed to the event, in parallel. */
export async function notifyAll(fetchImpl: FetchLike, file: IntegrationsFile, payload: NotifyPayload & { event: NotifyEvent }): Promise<WebhookResult[]> {
  const targets = WEBHOOK_KINDS.flatMap((kind) => {
    const hook = file.webhooks[kind];
    return hook?.events.includes(payload.event) ? [{ kind, url: hook.url }] : [];
  });
  return Promise.all(targets.map(async ({ kind, url }) => ({ kind, ...(await sendWebhook(fetchImpl, kind, url, payload)) })));
}
