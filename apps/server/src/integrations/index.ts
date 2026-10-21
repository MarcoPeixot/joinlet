import type { FetchLike } from './hosts';
import { createJiraIssue, publishToConfluence, testAtlassian } from './atlassian';
import type { JiraConcern, JiraOutcome } from './atlassian';
import { WEBHOOK_KINDS, applyPatch, buildView, emptyFile, parseIntegrationsFile } from './config';
import type { IntegrationsFile, IntegrationsView, WebhookKind } from './config';
import { notifyAll, sendWebhook } from './notify';
import type { NotifyPayload, WebhookResult } from './notify';
import { publishToNotion, testNotion } from './notion';
import { MAX_MARKDOWN, fail } from './shared';
import type { PublishInput, PublishOutcome } from './shared';
import { MAX_SVG } from './svgCheck';

export type { IntegrationsView } from './config';
export type { NotifyPayload, WebhookResult } from './notify';
export type { PublishOutcome } from './shared';
export type { JiraOutcome } from './atlassian';

/**
 * Integrations behind /api/integrations: webhook notifications, publishing docs to Notion/Confluence and creating
 * Jira tasks. Credentials live in `integrations.json` (0600) on the server's machine; `fetch` is injected, so tests
 * never touch the network.
 */

export interface IntegrationsDeps {
  /** Absolute path of integrations.json. */
  file: string;
  /** `write` creates the folder (0700) and the file (0600); main.ts passes Node's fs, tests an in-memory map. */
  fs: { read(path: string): Promise<string | null>; write(path: string, text: string): Promise<void> };
  fetch: FetchLike;
}

export type TestTarget = WebhookKind | 'notion' | 'atlassian';

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (record: Record<string, unknown>, key: string): unknown => (Object.hasOwn(record, key) ? record[key] : undefined);
const MISSING: Record<string, string> = { teams: 'Teams', slack: 'Slack', discord: 'Discord' };

export function createIntegrations(deps: IntegrationsDeps) {
  let file: IntegrationsFile = emptyFile();
  let queue: Promise<unknown> = Promise.resolve();
  const lastDrift = new Map<string, string>();

  /** Writes are serialised: two patches in flight must not overwrite each other. */
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  const net = { fetch: deps.fetch };

  return {
    async load(): Promise<void> {
      file = parseIntegrationsFile(await deps.fs.read(deps.file).catch(() => null));
    },
    view: (): IntegrationsView => buildView(file),
    update: (patch: unknown): Promise<IntegrationsView | string> =>
      serial(async () => {
        const next = applyPatch(file, patch);
        if (typeof next === 'string') return next;
        await deps.fs.write(deps.file, `${JSON.stringify(next, null, 2)}\n`);
        file = next;
        return buildView(file);
      }),

    async test(target: TestTarget): Promise<{ ok: boolean; detail: string }> {
      if ((WEBHOOK_KINDS as readonly string[]).includes(target)) {
        const hook = file.webhooks[target as WebhookKind];
        if (!hook) return { ok: false, detail: `Configure o webhook do ${MISSING[target]} antes de testar.` };
        return sendWebhook(deps.fetch, target as WebhookKind, hook.url, { event: 'test' });
      }
      if (target === 'notion') return file.notion ? testNotion(net, file.notion) : { ok: false, detail: 'Configure o token do Notion antes de testar.' };
      if (target === 'atlassian') {
        return file.atlassian
          ? testAtlassian(net, file.atlassian, { ...(file.confluence ? { confluence: file.confluence } : {}), ...(file.jira ? { jira: file.jira } : {}) })
          : { ok: false, detail: 'Configure o site, o e-mail e o token da Atlassian antes de testar.' };
      }
      return { ok: false, detail: 'Serviço desconhecido.' };
    },

    /** Fire-and-forget friendly: resolves with one result per subscribed webhook and never rejects. */
    async notify(payload: NotifyPayload & { event: 'version' | 'pr' | 'drift' }): Promise<WebhookResult[]> {
      try {
        return await notifyAll(deps.fetch, file, payload);
      } catch (error) {
        console.error(error);
        return [];
      }
    },

    /** Drift is polled: it notifies once per distinct set of findings per scope (a repo) and again after it clears. */
    async notifyDrift(scope: string, items: readonly string[], source?: string): Promise<WebhookResult[]> {
      if (!items.length) {
        lastDrift.delete(scope);
        return [];
      }
      const signature = [...items].sort().join('\n');
      if (lastDrift.get(scope) === signature) return [];
      lastDrift.set(scope, signature);
      return this.notify({ event: 'drift', count: items.length, items: items.slice(0, 20), ...(source ? { source } : {}) });
    },

    async publish(target: 'notion' | 'confluence', input: PublishInput): Promise<PublishOutcome> {
      if (target === 'notion') {
        return file.notion ? publishToNotion(net, file.notion, input) : fail(400, 'Configure o token do Notion em Configurações › Integrações.');
      }
      if (!file.atlassian) return fail(400, 'Configure o site, o e-mail e o token da Atlassian em Configurações › Integrações.');
      if (!file.confluence) return fail(400, 'Informe o espaço do Confluence em Configurações › Integrações.');
      return publishToConfluence(net, file.atlassian, file.confluence, input);
    },

    async createJiraIssue(body: { concern: JiraConcern; diagramTitle?: string }): Promise<JiraOutcome> {
      if (!file.atlassian) return fail(400, 'Configure o site, o e-mail e o token da Atlassian em Configurações › Integrações.');
      if (!file.jira) return fail(400, 'Informe o projeto do Jira em Configurações › Integrações.');
      return createJiraIssue(net, file.atlassian, file.jira, body.concern, body.diagramTitle ? { diagramTitle: body.diagramTitle } : {});
    },
  };
}

export type Integrations = ReturnType<typeof createIntegrations>;

// ---------------------------------------------------------------- request bodies

/** POST /api/integrations/publish → the target and the input, or a pt-BR reason. */
export function parsePublishBody(raw: unknown): { target: 'notion' | 'confluence'; input: PublishInput } | string {
  if (!isObject(raw)) return 'Corpo inválido: envie um objeto JSON.';
  const target = own(raw, 'target');
  if (target !== 'notion' && target !== 'confluence') return 'Corpo inválido: "target" precisa ser "notion" ou "confluence".';
  const title = own(raw, 'title');
  const markdown = own(raw, 'markdown');
  const svg = own(raw, 'svg');
  const svgName = own(raw, 'svgName');
  if (typeof title !== 'string' || !title.trim()) return 'Corpo inválido: "title" é obrigatório.';
  if (typeof markdown !== 'string') return 'Corpo inválido: "markdown" precisa ser texto.';
  if (markdown.length > MAX_MARKDOWN) return 'O documento é grande demais para publicar.';
  if (svg !== undefined && (typeof svg !== 'string' || svg.length >= MAX_SVG)) return 'Corpo inválido: "svg" precisa ser texto (até 3 MB).';
  if (svgName !== undefined && typeof svgName !== 'string') return 'Corpo inválido: "svgName" precisa ser texto.';
  return { target, input: { title, markdown, ...(svg !== undefined ? { svg: svg as string } : {}), ...(svgName !== undefined ? { svgName: svgName as string } : {}) } };
}

const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

/** POST /api/integrations/notify: a local client (the app, the CLI) reports an event; only the real events pass. */
export function parseNotifyBody(raw: unknown): (NotifyPayload & { event: 'version' | 'pr' | 'drift' }) | string {
  if (!isObject(raw)) return 'Corpo inválido: envie um objeto JSON.';
  const event = own(raw, 'event');
  if (event === 'version') {
    const diagram = text(own(raw, 'diagram'), 80);
    const message = text(own(raw, 'message'), 500);
    const author = own(raw, 'author');
    if (!diagram || !message || (author !== 'ai' && author !== 'agent')) return 'Corpo inválido: "version" precisa de diagram, message e author ("ai" ou "agent").';
    return { event, diagram, message, author };
  }
  if (event === 'pr') {
    const title = text(own(raw, 'title'), 200);
    const url = text(own(raw, 'url'), 500);
    const branch = text(own(raw, 'branch'), 120);
    if (!title || !url) return 'Corpo inválido: "pr" precisa de title e url.';
    return { event, title, url, ...(branch ? { branch } : {}) };
  }
  if (event === 'drift') {
    const count = own(raw, 'count');
    const items = own(raw, 'items');
    const source = text(own(raw, 'source'), 60);
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 100_000) return 'Corpo inválido: "count" precisa ser um inteiro.';
    if (!Array.isArray(items) || items.some((item) => typeof item !== 'string')) return 'Corpo inválido: "items" precisa ser uma lista de textos.';
    return { event, count, items: (items as string[]).slice(0, 20).map((item) => item.slice(0, 300)), ...(source ? { source } : {}) };
  }
  return 'Corpo inválido: "event" precisa ser "version", "pr" ou "drift".';
}

/** POST /api/integrations/jira: one Precisão concern (the ids follow concerns.ts). */
export function parseJiraBody(raw: unknown): { concern: JiraConcern; diagramTitle?: string } | string {
  if (!isObject(raw) || !isObject(own(raw, 'concern'))) return 'Corpo inválido: envie { concern }.';
  const concern = own(raw, 'concern') as Record<string, unknown>;
  const id = own(concern, 'id');
  const diagram = own(concern, 'diagram');
  const element = own(concern, 'element');
  const message = own(concern, 'message');
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return 'Corpo inválido: id da pendência inválido.';
  if (typeof diagram !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(diagram)) return 'Corpo inválido: diagrama da pendência inválido.';
  if (typeof message !== 'string' || !message.trim()) return 'Corpo inválido: a pendência está vazia.';
  if (element !== undefined && typeof element !== 'string') return 'Corpo inválido: "element" precisa ser texto.';
  const title = text(own(raw, 'diagramTitle'), 100);
  return { concern: { id, diagram, ...(element ? { element: element.slice(0, 200) } : {}), message: message.slice(0, 4_000) }, ...(title ? { diagramTitle: title } : {}) };
}
