import { checkUrl, safeFetch } from './hosts';
import type { FetchLike } from './hosts';
import { chunkBlocks, imageBlock, notionBlocks } from './notionBlocks';
import type { NotionBlock } from './notionBlocks';
import { MAX_MARKDOWN, cleanTitle, errorText, fail, guard, svgFileName } from './shared';
import type { PublishInput, PublishOutcome } from './shared';
import { checkSvg } from './svgCheck';

export interface NotionConfig {
  token: string;
  parentPageId?: string;
}
interface Deps {
  fetch: FetchLike;
}

const API = 'https://api.notion.com';
const VERSION = '2022-06-28';
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

const headers = (cfg: NotionConfig, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${cfg.token}`, 'notion-version': VERSION, ...extra });

/** Notion's HTTP errors in pt-BR; the service's own message is kept (bounded, token removed) when it adds information. */
async function describe(res: Response, cfg: NotionConfig): Promise<string> {
  if (res.status === 401) return 'O Notion recusou o token da integração.';
  if (res.status === 403) return 'A integração do Notion não tem permissão para isso (compartilhe a página com ela).';
  if (res.status === 404) return 'O Notion não encontrou a página: compartilhe a página-mãe com a integração (Conexões).';
  if (res.status === 429) return 'Limite de uso do Notion atingido. Tente de novo em instantes.';
  const detail = await errorText(res, [cfg.token]);
  return `O Notion respondeu com erro ${res.status}${detail ? `: ${detail}` : '.'}`;
}

async function call<T>(deps: Deps, cfg: NotionConfig, path: string, method: string, body?: unknown): Promise<T> {
  const res = await safeFetch(deps.fetch, 'notion', `${API}${path}`, {
    method,
    headers: headers(cfg, body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new NotionFailure(await describe(res, cfg));
  return (await res.json().catch(() => ({}))) as T;
}

class NotionFailure extends Error {}

/** The two-step file upload (create, then send); returns the file upload id. */
async function uploadSvg(deps: Deps, cfg: NotionConfig, filename: string, svg: string): Promise<string> {
  const created = await call<{ id?: unknown; upload_url?: unknown }>(deps, cfg, '/v1/file_uploads', 'POST', { filename, content_type: 'image/svg+xml' });
  const target = typeof created.upload_url === 'string' ? checkUrl('notion', created.upload_url) : null;
  if (typeof created.id !== 'string' || !/^[\w-]{1,64}$/.test(created.id) || !target || 'error' in target) {
    throw new NotionFailure('o Notion devolveu um destino de upload inesperado');
  }
  const form = new FormData();
  form.set('file', new Blob([svg], { type: 'image/svg+xml' }), filename);
  const sent = await safeFetch(deps.fetch, 'notion', target.href, { method: 'POST', headers: headers(cfg), body: form });
  if (!sent.ok) throw new NotionFailure(await describe(sent, cfg));
  return created.id;
}

const notionUrl = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && /^(?:www\.)?notion\.so$|\.notion\.site$/.test(url.hostname) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

/** Creates a child page of the configured parent page. Every failure is an outcome, never a throw. */
export async function publishToNotion(deps: Deps, cfg: NotionConfig, input: PublishInput): Promise<PublishOutcome> {
  const title = cleanTitle(input.title);
  if (!title) return fail(400, 'Informe o título da página.');
  if (!cfg.parentPageId) return fail(400, 'Informe a página-mãe do Notion em Configurações › Integrações.');
  if (input.markdown.length > MAX_MARKDOWN) return fail(400, 'O documento é grande demais para publicar.');
  if (input.svg !== undefined) {
    const checked = checkSvg(input.svg);
    if (checked !== true) return fail(400, checked);
  }
  return guard(async () => {
    const warnings: string[] = [];
    const converted = notionBlocks(input.markdown);
    warnings.push(...converted.warnings);
    const blocks: NotionBlock[] = [...converted.blocks];
    if (input.svg !== undefined) {
      try {
        blocks.unshift(imageBlock(await uploadSvg(deps, cfg, svgFileName(input.svgName), input.svg)));
      } catch (error) {
        warnings.push(`Não foi possível anexar o diagrama: ${error instanceof NotionFailure ? error.message : 'falha de conexão com o Notion'}.`);
      }
    }
    const [first = [], ...rest] = chunkBlocks(blocks);
    let page: { id?: unknown; url?: unknown };
    try {
      page = await call(deps, cfg, '/v1/pages', 'POST', {
        parent: { page_id: cfg.parentPageId },
        properties: { title: { title: [{ type: 'text', text: { content: title } }] } },
        children: first,
      });
    } catch (error) {
      if (error instanceof NotionFailure) return fail(502, error.message);
      throw error;
    }
    const id = typeof page.id === 'string' && UUID.test(page.id) ? page.id : null;
    const url = notionUrl(page.url);
    if (rest.length && !id) {
      warnings.push('A página foi criada, mas o conteúdo ficou incompleto (o Notion não devolveu o identificador da página).');
    } else if (id) {
      for (const chunk of rest) {
        try {
          await call(deps, cfg, `/v1/blocks/${id}/children`, 'PATCH', { children: chunk });
        } catch (error) {
          if (!(error instanceof NotionFailure)) throw error;
          warnings.push(`A página foi criada, mas parte do conteúdo ficou de fora: ${error.message}`);
          break;
        }
      }
    }
    return { ok: true, ...(url ? { url } : {}), warnings };
  });
}

/** Checks the token (and that the parent page is shared with the integration) without writing anything. */
export async function testNotion(deps: Deps, cfg: NotionConfig): Promise<{ ok: boolean; detail: string }> {
  try {
    const me = await call<{ name?: unknown }>(deps, cfg, '/v1/users/me', 'GET');
    const name = typeof me.name === 'string' && me.name ? ` (${me.name.slice(0, 60)})` : '';
    if (cfg.parentPageId) await call(deps, cfg, `/v1/pages/${cfg.parentPageId}`, 'GET');
    return { ok: true, detail: `Token aceito pelo Notion${name}${cfg.parentPageId ? '; a página-mãe está acessível' : '; falta informar a página-mãe'}.` };
  } catch (error) {
    if (error instanceof NotionFailure) return { ok: false, detail: error.message };
    return { ok: false, detail: error instanceof Error ? error.message : 'Não foi possível falar com o Notion.' };
  }
}
