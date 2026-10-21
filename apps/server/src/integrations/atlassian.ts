import { toStorage } from './confluenceStorage';
import { IntegrationError, checkUrl, safeFetch } from './hosts';
import type { FetchLike } from './hosts';
import { MAX_MARKDOWN, cleanTitle, errorText, fail, guard, svgFileName } from './shared';
import type { PublishInput, PublishOutcome } from './shared';
import { checkSvg } from './svgCheck';

/** Confluence Cloud (publish a doc) and Jira Cloud (a task from a Precisão concern), both on the user's *.atlassian.net site. */

export interface AtlassianAuth {
  site: string;
  email: string;
  token: string;
}
export interface ConfluenceTarget {
  spaceKey: string;
  parentId?: string;
}
export interface JiraTarget {
  projectKey: string;
  issueType: string;
}
export interface JiraConcern {
  id: string;
  diagram: string;
  element?: string;
  message: string;
}
interface Deps {
  fetch: FetchLike;
}
type Where = 'confluence' | 'jira' | 'account';

class AtlassianFailure extends Error {}

const CONTENT_ID = /^\d{1,20}$/;
const ATTACHMENT_ID = /^[\w-]{1,40}$/;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,19}-\d{1,9}$/;

async function describe(res: Response, auth: AtlassianAuth, where: Where): Promise<string> {
  if (res.status === 401) return 'A Atlassian recusou as credenciais (e-mail ou token de API).';
  if (res.status === 403) return 'A conta da Atlassian não tem permissão para isso.';
  if (res.status === 404) return where === 'jira' ? 'Projeto do Jira não encontrado (confira a chave).' : where === 'confluence' ? 'Espaço ou página-mãe do Confluence não encontrado.' : 'Site da Atlassian não encontrado.';
  if (res.status === 429) return 'Limite de uso da Atlassian atingido. Tente de novo em instantes.';
  const detail = await errorText(res, [auth.token, auth.email]);
  return `A Atlassian respondeu com erro ${res.status}${detail ? `: ${detail}` : '.'}`;
}

async function request(deps: Deps, auth: AtlassianAuth, where: Where, path: string, init: { method: string; body?: unknown; form?: FormData; noCheck?: boolean }): Promise<Response> {
  const headers: Record<string, string> = {
    authorization: `Basic ${Buffer.from(`${auth.email}:${auth.token}`).toString('base64')}`,
    accept: 'application/json',
    ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(init.noCheck ? { 'x-atlassian-token': 'no-check' } : {}),
  };
  const res = await safeFetch(deps.fetch, 'atlassian', `${auth.site}${path}`, {
    method: init.method,
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : init.form ? { body: init.form } : {}),
  });
  if (!res.ok) throw new AtlassianFailure(await describe(res, auth, where));
  return res;
}

const read = async <T>(res: Response) => (await res.json().catch(() => ({}))) as T;

async function attach(deps: Deps, auth: AtlassianAuth, pageId: string, filename: string, svg: string, existingPage: boolean): Promise<void> {
  const base = `/wiki/rest/api/content/${pageId}/child/attachment`;
  let attachmentId: string | undefined;
  if (existingPage) {
    const found = await read<{ results?: { id?: unknown }[] }>(await request(deps, auth, 'confluence', `${base}?${new URLSearchParams({ filename })}`, { method: 'GET' }));
    const id = found.results?.[0]?.id;
    if (typeof id === 'string' && ATTACHMENT_ID.test(id)) attachmentId = id;
  }
  const form = new FormData();
  form.set('file', new Blob([svg], { type: 'image/svg+xml' }), filename);
  form.set('minorEdit', 'true');
  await request(deps, auth, 'confluence', attachmentId ? `${base}/${attachmentId}/data` : base, { method: 'POST', form, noCheck: true });
}

/** The page link from `_links`, only when it stays on the user's own site; otherwise one built from the id. */
function pageUrl(auth: AtlassianAuth, id: string, links: { base?: unknown; webui?: unknown } | undefined): string {
  if (typeof links?.base === 'string' && typeof links.webui === 'string' && links.webui.startsWith('/')) {
    const checked = checkUrl('atlassian', `${links.base}${links.webui}`);
    if (!('error' in checked) && checked.origin === auth.site) return checked.href;
  }
  return `${auth.site}/wiki/pages/viewpage.action?pageId=${id}`;
}

/** Creates the page, or updates the one with the same title in the space (so republishing is idempotent). */
export async function publishToConfluence(deps: Deps, auth: AtlassianAuth, target: ConfluenceTarget, input: PublishInput): Promise<PublishOutcome> {
  const title = cleanTitle(input.title);
  if (!title) return fail(400, 'Informe o título da página.');
  if (input.markdown.length > MAX_MARKDOWN) return fail(400, 'O documento é grande demais para publicar.');
  if (input.svg !== undefined) {
    const checked = checkSvg(input.svg);
    if (checked !== true) return fail(400, checked);
  }
  return guard(async () => {
    try {
      const filename = svgFileName(input.svgName);
      const value = toStorage(input.markdown, input.svg === undefined ? {} : { attachment: { filename, alt: title } });
      const body = { storage: { value, representation: 'storage' } };
      const search = new URLSearchParams({ type: 'page', spaceKey: target.spaceKey, title, expand: 'version', limit: '2' });
      const found = await read<{ results?: { id?: unknown; version?: { number?: unknown } }[] }>(await request(deps, auth, 'confluence', `/wiki/rest/api/content?${search}`, { method: 'GET' }));
      const existing = found.results?.[0];
      const existingId = typeof existing?.id === 'string' && CONTENT_ID.test(existing.id) ? existing.id : null;
      const version = typeof existing?.version?.number === 'number' ? existing.version.number : 1;

      const saved = existingId
        ? await read<{ id?: unknown; _links?: { base?: unknown; webui?: unknown } }>(
            await request(deps, auth, 'confluence', `/wiki/rest/api/content/${existingId}`, {
              method: 'PUT',
              body: { id: existingId, type: 'page', title, space: { key: target.spaceKey }, version: { number: version + 1, message: 'Atualizado pelo Joinlet' }, body },
            }),
          )
        : await read<{ id?: unknown; _links?: { base?: unknown; webui?: unknown } }>(
            await request(deps, auth, 'confluence', '/wiki/rest/api/content', {
              method: 'POST',
              body: { type: 'page', title, space: { key: target.spaceKey }, ...(target.parentId ? { ancestors: [{ id: target.parentId }] } : {}), body },
            }),
          );
      const id = existingId ?? (typeof saved.id === 'string' && CONTENT_ID.test(saved.id) ? saved.id : null);
      if (!id) return fail(502, 'A Atlassian devolveu uma resposta inesperada ao criar a página.');

      const warnings: string[] = [];
      if (input.svg !== undefined) {
        try {
          await attach(deps, auth, id, filename, input.svg, existingId !== null);
        } catch (error) {
          warnings.push(`Não foi possível anexar o diagrama: ${error instanceof AtlassianFailure ? error.message : 'falha de conexão com a Atlassian'}`);
        }
      }
      return { ok: true, url: pageUrl(auth, id, saved._links), warnings };
    } catch (error) {
      if (error instanceof AtlassianFailure) return fail(502, error.message);
      throw error;
    }
  });
}

const text = (value: string) => ({ type: 'text', text: value });
const paragraph = (...parts: ReturnType<typeof text>[]) => ({ type: 'paragraph', content: parts });

/** Atlassian Document Format for the issue body. */
function description(concern: JiraConcern, diagramTitle: string): unknown {
  const lines = concern.message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    type: 'doc',
    version: 1,
    content: [
      ...lines.map((line) => paragraph(text(line))),
      paragraph(text(`Diagrama: ${diagramTitle}${concern.element ? ` · Elemento: ${concern.element}` : ''}`)),
      paragraph(text(`Criada pelo Joinlet a partir de uma pendência do painel Precisão (${concern.id}).`)),
    ],
  };
}

// eslint-disable-next-line no-control-regex
const oneLine = (raw: string) => raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

export type JiraOutcome = { ok: true; key: string; url: string } | { ok: false; status: number; error: string };

export async function createJiraIssue(deps: Deps, auth: AtlassianAuth, target: JiraTarget, concern: JiraConcern, options: { diagramTitle?: string }): Promise<JiraOutcome> {
  if (!concern.message.trim()) return fail(400, 'A pendência está vazia.');
  const diagramTitle = oneLine(options.diagramTitle ?? concern.diagram).slice(0, 100);
  const head = `[Joinlet] ${diagramTitle}${concern.element ? ` › ${oneLine(concern.element).slice(0, 60)}` : ''}: `;
  const summary = `${head}${oneLine(concern.message)}`.slice(0, 250);
  try {
    const created = await read<{ key?: unknown }>(
      await request(deps, auth, 'jira', '/rest/api/3/issue', {
        method: 'POST',
        body: { fields: { project: { key: target.projectKey }, issuetype: { name: target.issueType }, summary, labels: ['strukt'], description: description(concern, diagramTitle) } },
      }),
    );
    if (typeof created.key !== 'string' || !ISSUE_KEY.test(created.key)) return fail(502, 'A Atlassian devolveu uma resposta inesperada ao criar a tarefa.');
    return { ok: true, key: created.key, url: `${auth.site}/browse/${created.key}` };
  } catch (error) {
    if (error instanceof AtlassianFailure) return fail(502, error.message);
    if (error instanceof IntegrationError) return fail(502, error.message);
    console.error(error);
    return fail(500, 'Erro interno ao criar a tarefa.');
  }
}

/** Account first, then the Confluence space and Jira project that are configured; read-only. */
export async function testAtlassian(deps: Deps, auth: AtlassianAuth, targets: { confluence?: ConfluenceTarget; jira?: JiraTarget }): Promise<{ ok: boolean; detail: string }> {
  const parts: string[] = [];
  try {
    const me = await read<{ displayName?: unknown }>(await request(deps, auth, 'account', '/rest/api/3/myself', { method: 'GET' }));
    parts.push(`conta aceita${typeof me.displayName === 'string' && me.displayName ? ` (${me.displayName.slice(0, 60)})` : ''}`);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Não foi possível falar com a Atlassian.' };
  }
  if (targets.confluence) {
    try {
      await request(deps, auth, 'confluence', `/wiki/rest/api/space/${encodeURIComponent(targets.confluence.spaceKey)}`, { method: 'GET' });
      parts.push(`espaço do Confluence ${targets.confluence.spaceKey} acessível`);
    } catch {
      return { ok: false, detail: `A conta foi aceita, mas o espaço do Confluence "${targets.confluence.spaceKey}" não está acessível.` };
    }
  }
  if (targets.jira) {
    try {
      await request(deps, auth, 'jira', `/rest/api/3/project/${encodeURIComponent(targets.jira.projectKey)}`, { method: 'GET' });
      parts.push(`projeto do Jira ${targets.jira.projectKey} acessível`);
    } catch {
      return { ok: false, detail: `A conta foi aceita, mas o projeto do Jira "${targets.jira.projectKey}" não está acessível.` };
    }
  }
  return { ok: true, detail: `${parts.join('; ')}.`.replace(/^./, (c) => c.toUpperCase()) };
}
