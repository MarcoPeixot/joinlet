import { serializeWorkspaceWrite } from './workspaceWrite';
import { chatEventStream } from './chatStream';
import { refreshGeneratedContext } from '@strukt/workspace/context-storage';
import { BETA_PLAN, type AccessPlan } from '@strukt/workspace';
import { withAccessPlan } from '@strukt/workspace/access-context';
import { BetaLimitError, assertBetaManifest, MANIFEST_PATH } from '@strukt/workspace';
import { homedir } from 'node:os';
import { ownerSocketRelay } from './shareRelay';
import { withWebSearch } from './chatWeb';
import { createWebSearch } from './webSearch';
import type { WebSearch } from './webSearch';
import { isAiProvider, isCompatibleProvider, readChatModel } from '@strukt/core';
import { readChatTarget, replyToEditableChat, streamEditableChat } from './chatEdit';
import type { Share } from './share';
import { parseJiraBody, parseNotifyBody, parsePublishBody } from './integrations';
import type { Integrations } from './integrations';
import Anthropic from '@anthropic-ai/sdk';
import { createProcessRunner } from '@strukt/git';
import type { CommandRunner } from '@strukt/git';
import { Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createStruktServer, openMcpWorkspace, writeContext } from '@strukt/mcp';
import { createFsAdapter } from '@strukt/workspace/fs';
import { lstat, stat, mkdir, mkdtemp, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { MODELS } from './anthropic';
import { setupAgents } from './agentSetup';
import type { AiClient } from './anthropic';
import { proposeOps } from './diagram';
import { writeDoc } from './doc';
import type { GithubAuth } from './githubAuth';
import { gitChanges, gitDiagramAtRef, gitDiff, gitHealth, gitPrStatus, gitPublish, gitRepoRoot, gitStatus, initializeRepoWorkspace, withGithubToken } from './git';
import { ChatFailure, parseChatBody, replyToChat, streamChatEvents } from './chat';
import { allowedOrigins, originRefusal } from './origin';
import { ProviderError } from './openrouter';
import type { DiagramRequest } from './prompt';
import type { AiProvider, Settings } from './settings';

export const NO_KEY = 'IA indisponível: configure um provider em Configurações › IA (ou defina ANTHROPIC_API_KEY / OPENROUTER_API_KEY / OPENCODE_API_KEY no servidor).';
const LIMITS = { instruction: 4_000, json: 200_000, selection: 500, dir: 1_000, title: 200, body: 20_000, ref: 200 };

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Validates POST /api/ai/diagram; returns the pt-BR reason when invalid. */
export function parseDiagramBody(raw: unknown): DiagramRequest | string {
  if (!raw || typeof raw !== 'object') return 'Corpo inválido: envie um objeto JSON.';
  const body = raw as Record<string, unknown>;
  if (typeof body.instruction !== 'string' || !body.instruction.trim()) return 'Corpo inválido: "instruction" é obrigatório.';
  if (body.instruction.length > LIMITS.instruction) return `Corpo inválido: "instruction" passa de ${LIMITS.instruction} caracteres.`;
  if (typeof body.json !== 'string') return 'Corpo inválido: "json" precisa ser texto.';
  if (body.json.length > LIMITS.json) return 'Corpo inválido: o diagrama é grande demais.';
  if (body.mode !== 'edit' && body.mode !== 'generate') return 'Corpo inválido: "mode" precisa ser "edit" ou "generate".';
  if (body.selection !== undefined && (!isStringArray(body.selection) || body.selection.length > LIMITS.selection)) {
    return 'Corpo inválido: "selection" precisa ser uma lista de nomes.';
  }
  return { instruction: body.instruction, json: body.json, selection: (body.selection as string[] | undefined) ?? [], mode: body.mode };
}

export function parseDocBody(raw: unknown): { json: string } | string {
  const json = (raw as { json?: unknown } | null)?.json;
  if (typeof json !== 'string') return 'Corpo inválido: "json" precisa ser texto.';
  if (json.length > LIMITS.json) return 'Corpo inválido: o diagrama é grande demais.';
  return { json };
}

export interface GitBody {
  dir: string;
  title?: string;
  body?: string;
  branch?: string;
  base?: string;
  draft?: boolean;
  pr?: string;
}

/** Validates the body of every /api/git/* POST: only `dir` is required. */
export function parseGitBody(raw: unknown): GitBody | string {
  if (!raw || typeof raw !== 'object') return 'Corpo inválido: envie um objeto JSON.';
  const body = raw as Record<string, unknown>;
  const dir = body.dir;
  if (typeof dir !== 'string' || !dir.trim()) return 'Corpo inválido: "dir" é obrigatório.';
  if (dir.length > LIMITS.dir) return 'Corpo inválido: "dir" é longo demais.';
  for (const [key, limit] of [['title', LIMITS.title], ['body', LIMITS.body], ['branch', LIMITS.ref], ['base', LIMITS.ref], ['pr', LIMITS.ref]] as const) {
    const value = body[key];
    if (value !== undefined && (typeof value !== 'string' || value.length > limit)) return `Corpo inválido: "${key}" precisa ser texto (até ${limit} caracteres).`;
  }
  if (body.draft !== undefined && typeof body.draft !== 'boolean') return 'Corpo inválido: "draft" precisa ser booleano.';
  return {
    dir,
    title: body.title as string | undefined,
    body: body.body as string | undefined,
    branch: body.branch as string | undefined,
    base: body.base as string | undefined,
    draft: body.draft as boolean | undefined,
    pr: body.pr as string | undefined,
  };
}

const TIMEOUT_ERROR = 'A IA demorou demais para responder. Tente um pedido menor ou tente de novo.';

/** SDK errors → HTTP status + pt-BR message (most specific first; APIConnectionTimeoutError extends APIConnectionError, both extend APIError). */
export function describeError(err: unknown): { status: ContentfulStatusCode; error: string } {
  if (
    err instanceof Anthropic.APIUserAbortError ||
    err instanceof Anthropic.APIConnectionTimeoutError ||
    (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError'))
  ) {
    return { status: 504, error: TIMEOUT_ERROR };
  }
  if (err instanceof Anthropic.AuthenticationError) return { status: 502, error: 'A API da Anthropic recusou a chave ANTHROPIC_API_KEY.' };
  if (err instanceof Anthropic.RateLimitError) return { status: 429, error: 'Limite de uso da API da Anthropic atingido. Tente de novo em instantes.' };
  if (err instanceof Anthropic.APIConnectionError) return { status: 502, error: 'Não foi possível falar com a API da Anthropic.' };
  if (err instanceof Anthropic.APIError) return { status: 502, error: `A API da Anthropic respondeu com erro ${err.status ?? ''}: ${err.message}` };
  if (err instanceof ProviderError) {
    if (err.status === 401 || err.status === 403) return { status: 502, error: `O ${err.provider} recusou a chave.` };
    if (err.status === 402) return { status: 502, error: `Sem créditos no ${err.provider}.` };
    if (err.status === 429) return { status: 429, error: `Limite de uso do ${err.provider} atingido. Tente de novo em instantes.` };
    return { status: 502, error: `O ${err.provider} respondeu com erro ${err.status}: ${err.message}` };
  }
  if (err instanceof TypeError && /fetch/i.test(err.message)) return { status: 502, error: 'Não foi possível falar com o provider de IA.' };
  console.error(err);
  return { status: 500, error: 'Erro interno no servidor de IA.' };
}

const readJson = (c: Context) => c.req.json<unknown>().catch(() => undefined);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Strips a `[...]` (IPv6) wrapper and a trailing `:port`, so `Host: [::1]:8787` and `localhost:5178` both match. */
function hostnameOf(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host.slice(1) : host.slice(1, end);
  }
  const port = host.lastIndexOf(':');
  return port === -1 ? host : host.slice(0, port);
}

interface AppDeps {
  accessPlan?: AccessPlan;
  /** A fixed Anthropic client (tests, and servers without Configurações). */
  ai?: AiClient | null;
  /** Configurações: the provider comes from it on every request, so a saved key works without a restart. */
  settings?: Settings;
  deadlineMs?: number;
  webSearch?: WebSearch;
  /** Command runner for the local git/gh endpoints; tests inject a fake. */
  runner?: CommandRunner;
  githubAuth?: GithubAuth;
  selectedRepo?: { get(): string | null; set(path: string | null): Promise<void> };
  /** The LAN share of the connected repository (a collaboration host started on request). */
  share?: Share;
  sharedWorkspaceDir?: string;
  /** Webhooks, Notion/Confluence publishing and Jira (Configurações › Integrações). */
  integrations?: Integrations;
  /** Origins a browser page may call this API from (see `allowedOrigins`); defaults to the dev and preview ports. */
  allowedOrigins?: readonly string[];
}

export function createApp({ accessPlan = BETA_PLAN, ai = null, settings, githubAuth, selectedRepo, share, sharedWorkspaceDir = join(process.env.STRUKT_CONFIG_DIR?.trim() || join(homedir(), ".config", "strukt"), "shared-workspaces"), integrations, allowedOrigins: origins = allowedOrigins(), deadlineMs = 240_000, webSearch = createWebSearch(), runner = createProcessRunner() }: AppDeps) {
  const app = new Hono();
  app.use("*", (_c, next) => withAccessPlan(accessPlan, next));
  const fixed: AiProvider | null = ai ? { id: 'anthropic', client: ai, models: MODELS } : null;
  const withSession = (current: AiProvider | null, session?: string): AiProvider | null => {
    if (!current?.forSession) return current;
    const id = session && /^[a-zA-Z0-9_.:-]{1,160}$/.test(session) ? session : globalThis.crypto.randomUUID();
    return { ...current, client: current.forSession(id) };
  };
  const provider = (session?: string) => withSession(settings ? settings.current() : fixed, session);

  // Local-only relay: a non-local Host could be DNS rebinding, and a non-JSON POST could be a same-origin-checked
  // cross-site request in disguise (the browser skips preflight for a "simple" text/plain POST).
  app.use('/api/*', async (c, next) => {
    const host = c.req.header('host') ?? new URL(c.req.url).host;
    if (!LOCAL_HOSTS.has(hostnameOf(host))) {
      return c.json({ error: 'O servidor de IA só aceita pedidos desta máquina (localhost).' }, 403);
    }
    const refusal = originRefusal(c.req.header('origin'), c.req.header('sec-fetch-site'), origins);
    if (refusal) return c.json({ error: refusal }, 403);
    if (c.req.method === 'POST' && !(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return c.json({ error: 'Envie o corpo como JSON (Content-Type: application/json).' }, 415);
    }
    await next();
  });
  app.use('/api/*', (c, next) => bodyLimit({
    maxSize: ['/api/git/connect', '/api/share/prepare'].includes(c.req.path) ? 20 * 1024 * 1024 : c.req.path === '/api/integrations/publish' ? 5 * 1024 * 1024 : 1024 * 1024,
    onError: (context) => context.json({ error: 'Corpo da requisição grande demais.' }, 413),
  })(c, next));

  app.get('/api/plan', c => {
    c.header('Cache-Control', 'no-store');
    return c.json({ plan: accessPlan, accountPlan: accessPlan, scope: 'local' });
  });

  const mcpGuard = async (c: Context, next: () => Promise<void>) => {
    const host = c.req.header('host') ?? new URL(c.req.url).host;
    const refusal = originRefusal(c.req.header('origin'), c.req.header('sec-fetch-site'), origins);
    if (!LOCAL_HOSTS.has(hostnameOf(host)) || refusal) {
      return c.json({ error: 'MCP disponível apenas nesta máquina.' }, 403);
    }
    await next();
  };
  app.use('/mcp', mcpGuard);
  app.use('/mcp/*', mcpGuard);

  const handleMcp = async (c: Context) => {
    const dir = selectedRepo?.get();
    if (!dir) return c.json({ error: 'Conecte um repositório no painel GitHub do Joinlet antes de usar o MCP.' }, 503);
    const ws = await openMcpWorkspace(dir);
    if ('error' in ws) return c.json({ error: ws.error }, 503);
    const id = c.req.param('id');
    if (id) {
      const raw = await ws.adapter.read('agent.json');
      let selectedId: unknown;
      try { selectedId = JSON.parse(raw ?? '').id; } catch { /* no matching identity */ }
      if (selectedId !== id) return c.json({ error: 'Este MCP pertence a outro repositório. Conecte o projeto correto no Joinlet.' }, 409);
    }
    const token = await githubAuth?.token() ?? null;
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    if (integrations) ws.notify = (event) => void integrations.notify(event);
    const server = createStruktServer(ws, { runner: withGithubToken(runner, token, !!githubAuth) });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  };
  app.all('/mcp', handleMcp);
  app.all('/mcp/:id', handleMcp);

  app.get('/api/health', (c) => c.json({ ok: true, ai: provider() !== null, ...(settings ? { provider: provider()?.id ?? null } : {}) }));

  // Configurações: keys go to a file on this machine and never come back (the view only has "…abcd" hints).
  if (settings) {
    app.get('/api/settings', (c) => c.json(settings.view()));
    app.post('/api/settings', async (c) => {
      try {
        const result = await settings.update(await readJson(c));
        return typeof result === 'string' ? c.json({ error: result }, 400) : c.json(result);
      } catch (err) {
        console.error(err);
        return c.json({ error: 'Não foi possível salvar as configurações neste computador.' }, 500);
      }
    });
    app.post('/api/settings/test', async (c) => {
      const body = await readJson(c);
      const id = body && typeof body === 'object' ? (body as { provider?: unknown }).provider : undefined;
      if (!isAiProvider(id)) return c.json({ error: 'Corpo inválido: selecione um provedor de IA disponível.' }, 400);
      return c.json(await settings.test(id));
    });
    app.get('/api/settings/openai-models', async (c) => {
      try {
        const id = c.req.query('provider') ?? 'openai';
        if (id !== 'openai' && !isCompatibleProvider(id)) return c.json({ error: 'Provedor inválido.' }, 400);
        return c.json({ models: await settings.openAiModels(id) });
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : 'Não foi possível listar os modelos do servidor.' }, err instanceof Error && err.message === 'Informe o endereço do servidor.' ? 400 : 502);
      }
    });
    app.get('/api/settings/opencode-go-models', async (c) => {
      try { return c.json({ models: await settings.openCodeModels(true) }); }
      catch { return c.json({ error: 'Não foi possível carregar os modelos do OpenCode Go.' }, 502); }
    });
    app.get('/api/settings/opencode-models', async (c) => {
      try { return c.json({ models: await settings.openCodeModels() }); }
      catch { return c.json({ error: 'Não foi possível carregar os modelos do OpenCode.' }, 502); }
    });

    app.get('/api/settings/anthropic-models', (c) => c.json({ models: [...new Set(Object.values(MODELS))].map(id => ({ id, name: id, context: 0 })) }));
    app.get('/api/settings/openrouter-models', async (c) => {
      try {
        return c.json({ models: await settings.openRouterModels() });
      } catch {
        return c.json({ error: 'Não foi possível carregar os modelos do OpenRouter.' }, 502);
      }
    });
  }

  // Integrações: webhooks, Notion/Confluence and Jira. Credentials go to a file on this machine and never come back
  // (the view has only "…abcd" hints); every URL the server calls is checked against an allowlist (integrations/hosts.ts).
  if (integrations) {
    app.get('/api/integrations', (c) => c.json(integrations.view()));
    app.post('/api/integrations', async (c) => {
      try {
        const result = await integrations.update(await readJson(c));
        return typeof result === 'string' ? c.json({ error: result }, 400) : c.json(result);
      } catch (err) {
        console.error(err);
        return c.json({ error: 'Não foi possível salvar as integrações neste computador.' }, 500);
      }
    });
    app.post('/api/integrations/test', async (c) => {
      const body = await readJson(c);
      const target = body && typeof body === 'object' ? (body as { target?: unknown }).target : undefined;
      if (target !== 'slack' && target !== 'teams' && target !== 'discord' && target !== 'notion' && target !== 'atlassian') {
        return c.json({ error: 'Corpo inválido: "target" precisa ser slack, teams, discord, notion ou atlassian.' }, 400);
      }
      return c.json(await integrations.test(target));
    });
    app.post('/api/integrations/notify', async (c) => {
      const event = parseNotifyBody(await readJson(c));
      if (typeof event === 'string') return c.json({ error: event }, 400);
      const results = await integrations.notify(event);
      return c.json({ sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
    });
    app.post('/api/integrations/publish', async (c) => {
      const body = parsePublishBody(await readJson(c));
      if (typeof body === 'string') return c.json({ error: body }, 400);
      const result = await integrations.publish(body.target, body.input);
      return result.ok ? c.json(result) : c.json({ error: result.error }, result.status as ContentfulStatusCode);
    });
    app.post('/api/integrations/jira', async (c) => {
      const body = parseJiraBody(await readJson(c));
      if (typeof body === 'string') return c.json({ error: body }, 400);
      const result = await integrations.createJiraIssue(body);
      return result.ok ? c.json(result) : c.json({ error: result.error }, result.status as ContentfulStatusCode);
    });
  }

  app.post('/api/ai/diagram', async (c) => {
    const ai = provider(c.req.header('x-strukt-session'));
    if (!ai) return c.json({ error: NO_KEY }, 503);
    const body = parseDiagramBody(await readJson(c));
    if (typeof body === 'string') return c.json({ error: body }, 400);
    // One deadline for the whole request (below Bun's idleTimeout), plus the client's own disconnect signal.
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(deadlineMs)]);
    try {
      const result = await proposeOps(ai.client, body, signal, ai.models);
      if (!result.ok) return c.json({ error: result.error }, result.status);
      return c.json({ ops: result.ops, summary: result.summary, model: result.model });
    } catch (err) {
      const { status, error } = describeError(err);
      return c.json({ error }, status);
    }
  });

  app.post('/api/ai/doc', async (c) => {
    const ai = provider(c.req.header('x-strukt-session'));
    if (!ai) return c.json({ error: NO_KEY }, 503);
    const body = parseDocBody(await readJson(c));
    if (typeof body === 'string') return c.json({ error: body }, 400);
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(deadlineMs)]);
    try {
      const result = await writeDoc(ai.client, body.json, signal, ai.models);
      if (!result.ok) return c.json({ error: result.error }, result.status);
      return c.json({ markdown: result.markdown });
    } catch (err) {
      const { status, error } = describeError(err);
      return c.json({ error }, status);
    }
  });

  app.post('/api/ai/chat', async (c) => {
    const raw = await readJson(c);
    const selection = raw && typeof raw === 'object' ? (raw as { selection?: unknown }).selection : undefined;
    let ai = provider(c.req.header('x-strukt-session'));
    if (selection !== undefined) {
      const choice = readChatModel(selection);
      if (!choice) return c.json({ error: 'Modelo ou provider inválido.' }, 400);
      const chosen = settings ? settings.forChat(choice) : fixed && choice.provider === fixed.id ? { ...fixed, models: { ...fixed.models, edit: choice.model } } : 'Conecte o provider selecionado em Configurações › IA e providers.';
      if (typeof chosen === 'string') return c.json({ error: chosen }, 400);
      ai = withSession(chosen, c.req.header('x-strukt-session'));
    }
    if (!ai) return c.json({ error: NO_KEY }, 503);
    ai = { ...ai, client: withWebSearch(ai.client, webSearch) };
    const body = parseChatBody(raw);
    if (typeof body === 'string') return c.json({ error: body }, 400);
    const streamAbort = new AbortController();
    const signal = AbortSignal.any([c.req.raw.signal, streamAbort.signal, AbortSignal.timeout(deadlineMs)]);
    const failure = (err: unknown) => err instanceof ChatFailure ? { status: err.status, error: err.message } : describeError(err);
    const rawTarget = (raw as { target?: unknown }).target;
    if (rawTarget !== undefined) {
      const target = readChatTarget(rawTarget);
      if (!target) return c.json({ error: 'Item editável inválido.' }, 400);
      if ((raw as { stream?: unknown }).stream === true) {
        const events = streamEditableChat(ai.client, body, target, signal, ai.models);
        let first: IteratorResult<import('./chatEdit').ChatEditEvent>;
        try { first = await events.next(); }
        catch (err) { const { status, error } = failure(err); return c.json({ error }, status); }
        return new Response(chatEventStream(events, first, streamAbort, failure), { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
      }
      try {
        const result = await replyToEditableChat(ai.client, body, target, signal, ai.models);
        if (!result.ok) return c.json({ error: result.error }, result.status);
        return c.json({ reply: result.reply, ...(result.edit ? { edit: result.edit } : {}) });
      } catch (err) {
        const { status, error } = failure(err);
        return c.json({ error }, status);
      }
    }
    if ((raw as { stream?: unknown }).stream === true) {
      // One JSON object per line: {"t": piece}…, then {"done": true} or {"error": message}. A failure before the first
      // piece still answers with its HTTP status (the same words as without streaming); later it is the last line.
      const pieces = streamChatEvents(ai.client, body, signal, ai.models);
      let first: IteratorResult<Awaited<ReturnType<typeof pieces.next>>['value']>;
      try { first = await pieces.next(); }
      catch (err) {
        const { status, error } = failure(err);
        return c.json({ error }, status);
      }
      return new Response(chatEventStream(pieces, first, streamAbort, failure), { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
    }
    try {
      const result = await replyToChat(ai.client, body, signal, ai.models);
      if (!result.ok) return c.json({ error: result.error }, result.status);
      return c.json({ reply: result.reply });
    } catch (err) {
      const { status, error } = describeError(err);
      return c.json({ error }, status);
    }
  });

  // Local git/gh for the GitHub panel: the browser cannot run commands, and the File System Access API
  // never reveals the absolute path of the folder, so the panel sends the repo path explicitly. The
  // server is loopback-only (middleware above) and refuses any directory without `.arch/strukt.json`.
  app.get('/api/git/auth', async (c) => {
    await githubAuth?.token();
    return c.json(githubAuth?.view() ?? { configured: false, connected: false, login: null });
  });

  app.post('/api/git/auth/device', async (c) => {
    if (!githubAuth) return c.json({ error: 'Login direto com GitHub indisponível neste servidor.' }, 503);
    const result = await githubAuth.startDeviceFlow();
    return result.ok ? c.json(result.flow) : c.json({ error: result.error }, result.status);
  });

  app.get('/api/git/auth/device/:id', async (c) => {
    if (!githubAuth) return c.json({ error: 'Login direto com GitHub indisponível neste servidor.' }, 503);
    const result = await githubAuth.pollDeviceFlow(c.req.param('id'));
    return c.json(result);
  });

  app.post('/api/git/auth/disconnect', async (c) => {
    if (!githubAuth) return c.json({ error: 'Login direto com GitHub indisponível neste servidor.' }, 503);
    try {
      await githubAuth.disconnect();
      return c.json(githubAuth.view());
    } catch {
      return c.json({ error: 'Não foi possível remover a conta GitHub deste computador.' }, 500);
    }
  });

  app.get('/api/git/status', async (c) => {
    const dir = c.req.query('dir');
    if (!dir) return c.json({ error: 'Informe "dir" (o caminho da pasta do repositório).' }, 400);
    const token = await githubAuth?.token() ?? null;
    const result = await gitStatus(withGithubToken(runner, token, !!githubAuth), dir, { cacheKey: token });
    return c.json(result, result.ok ? 200 : 400);
  });

  // Light badge poll: `git status` only (same /api/* guards: Host allowlist; needs .arch/strukt.json).
  app.get('/api/git/changes', async (c) => {
    const dir = c.req.query('dir');
    if (!dir) return c.json({ error: 'Informe "dir" (o caminho da pasta do repositório).' }, 400);
    const result = await gitChanges(runner, dir);
    return c.json(result, result.ok ? 200 : 400);
  });

  app.post('/api/git/connect', async (c) => {
    if (!selectedRepo) return c.json({ error: 'Seleção de repositório indisponível neste servidor.' }, 503);
    const raw = await readJson(c);
    const body = parseGitBody(raw);
    if (typeof body === 'string') return c.json({ error: body }, 400);
    const located = await gitRepoRoot(runner, body.dir);
    if ('error' in located) return c.json({ error: located.error }, 400);
    const arch = join(located.root, '.arch');
    let existing: Awaited<ReturnType<typeof lstat>> | null = null;
    try { existing = await lstat(arch); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return c.json({ error: 'Não foi possível acessar .arch/ neste repositório.' }, 400);
    }
    let initialized = false;
    if (existing && !existing.isDirectory()) return c.json({ error: 'A entrada .arch/ já existe e não é uma pasta.' }, 400);
    if (!existing) {
      const files = (raw as { files?: unknown }).files;
      if (files === undefined) return c.json({ needsInit: true, root: located.root }, 409);
      const created = await initializeRepoWorkspace(located.root, files);
      if (!created.ok) return c.json({ error: created.error, code: created.code }, created.code ? 403 : 400);
      initialized = true;
    } else if (!(await stat(join(arch, 'strukt.json')).catch(() => null))?.isFile()) {
      return c.json({ error: 'A pasta .arch/ já existe sem strukt.json. Confira o conteúdo antes de conectar.' }, 400);
    }
    const token = await githubAuth?.token() ?? null;
    const result = await gitStatus(withGithubToken(runner, token, !!githubAuth), located.root);
    if (!result.ok) return c.json({ error: result.error }, 400);
    try {
      const setup = await setupAgents(result.repo.root);
      const ws = await openMcpWorkspace(result.repo.root);
      if ('error' in ws) return c.json({ error: ws.error }, 409);
      const context = await writeContext(ws, ws.data);
      await selectedRepo.set(result.repo.root);
      return c.json({ repo: result.repo, ...setup, context, initialized });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Falha ao preparar o repositório.' }, 500);
    }
  });

  app.post('/api/git/disconnect', async (c) => {
    if (!selectedRepo) return c.json({ error: 'Seleção de repositório indisponível neste servidor.' }, 503);
    const body = await readJson(c) as { dir?: unknown } | null;
    if (!body || typeof body.dir !== 'string') return c.json({ error: 'Informe o repositório atual.' }, 400);
    if (selectedRepo.get() !== body.dir) return c.json({ error: 'Outro repositório foi selecionado.' }, 409);
    await selectedRepo.set(null);
    return c.json({ ok: true });
  });

  app.get('/api/workspace', async (c) => {
    const dir = selectedRepo?.get();
    if (!dir) return c.json({ error: 'Conecte um repositório primeiro.' }, 409);
    if (c.req.query('dir') !== dir) return c.json({ error: 'Outro repositório está conectado.' }, 409);
    const ws = await openMcpWorkspace(dir);
    if ('error' in ws) return c.json({ error: ws.error }, 409);
    const path = c.req.query('path');
    try {
      const storage = createFsAdapter(ws.archDir);
      if (path) return c.json({ text: await storage.read(path) });
      const files = await storage.list();
      const stamps = Object.fromEntries(await Promise.all(files.filter((file) => !file.startsWith('versions/') && !file.startsWith('context/') && !file.startsWith('comments/')).map(async (file) => [file, (await stat(join(ws.archDir, file))).mtimeMs] as const)));
      return c.json({ files, stamps, root: ws.root });
    } catch (error) { if (error instanceof BetaLimitError) return c.json(error.toJSON(), 403); return c.json({ error: error instanceof Error ? error.message : 'Caminho inválido.' }, 400); }
  });

  app.post('/api/workspace', async (c) => {
    const dir = selectedRepo?.get();
    if (!dir) return c.json({ error: 'Conecte um repositório primeiro.' }, 409);
    const body = await readJson(c) as { dir?: unknown; path?: unknown; text?: unknown; remove?: unknown; expected?: unknown } | undefined;
    if (body?.dir !== dir) return c.json({ error: 'Outro repositório está conectado.' }, 409);
    const ws = await openMcpWorkspace(dir);
    if ('error' in ws) return c.json({ error: ws.error }, 409);
    if (typeof body?.path !== 'string' || (body.text !== undefined && typeof body.text !== 'string')) return c.json({ error: 'Arquivo inválido.' }, 400);
    const path = body.path;
    try {
      const storage = createFsAdapter(ws.archDir);
      return await serializeWorkspaceWrite(storage.label, async () => {
        if (body.expected !== undefined && body.expected !== null && typeof body.expected !== 'string') return c.json({ error: 'Versão esperada inválida.' }, 400);
        if (body.expected !== undefined && await storage.read(path) !== body.expected) {
          return c.json({ error: `${path} mudou fora do Joinlet. Recarregue o workspace antes de salvar.` }, 409);
        }
        if (body.remove === true) await storage.remove(path);
        else if (typeof body.text === 'string') {
          if (path === MANIFEST_PATH) assertBetaManifest(await storage.read(MANIFEST_PATH), body.text);
          await storage.write(path, body.text);
        }
        else return c.json({ error: 'Envie o texto do arquivo ("text") ou "remove": true.' }, 400);
        await refreshGeneratedContext(storage);
        return c.json({ ok: true });
      });
    } catch (error) { if (error instanceof BetaLimitError) return c.json(error.toJSON(), 403); return c.json({ error: error instanceof Error ? error.message : 'Caminho inválido.' }, 400); }
  });

  // Sharing: a LAN collaboration host for the connected repository's workspace. Same /api/* guards (loopback Host,
  // JSON-only POST); the invite it returns carries an edit token and goes only to this machine's browser.
  if (share) {
    // These routes inherit the loopback Host, Origin and JSON guards above. Guests never reach the owner API.
    app.get('/api/share/live/collaboration', async (c, next) => {
      if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return next();
      try {
        const target = share.ownerTarget(`/api/collaboration${new URL(c.req.url).search}`);
        const { upgradeWebSocket } = await import('hono/bun');
        return upgradeWebSocket(() => ownerSocketRelay(target))(c, next);
      } catch { return c.json({ error: 'A sessão de colaboração não está disponível.' }, 409); }
    });
    app.all('/api/share/live/*', async (c) => {
      try {
        const incoming = new URL(c.req.url);
        const target = share.ownerTarget(incoming.pathname.replace('/api/share/live/', '/api/') + incoming.search);
        const reply = await fetch(target.url, { method: c.req.method, headers: { ...target.headers, 'content-type': 'application/json' },
          ...(c.req.method === 'GET' || c.req.method === 'HEAD' ? {} : { body: await c.req.text() }), redirect: 'manual' });
        return new Response(reply.body, { status: reply.status, headers: { 'content-type': reply.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
      } catch { return c.json({ error: 'A sessão de colaboração não está disponível.' }, 409); }
    });
    let preparing = false;
    app.post('/api/share/prepare', async (c) => {
      if (preparing) return c.json({ error: 'O compartilhamento já está sendo preparado.' }, 409);
      preparing = true;
      let created: string | undefined;
      try {
        const body = await readJson(c) as { dir?: unknown; files?: unknown } | undefined;
        let root: string;
        const active = await share.status();
        if (typeof body?.dir === 'string' && body.dir && body.dir === selectedRepo?.get()) root = body.dir;
        else if (body?.dir) return c.json({ error: 'Outro repositório está conectado.' }, 409);
        else {
          if (active.active) return c.json({ error: 'Já existe um compartilhamento ativo de outra pasta. Pare-o antes de compartilhar esta.' }, 409);
          if (!body?.files || !selectedRepo) return c.json({ error: 'Envie o workspace atual para compartilhar.' }, 400);
          await mkdir(sharedWorkspaceDir, { recursive: true, mode: 0o700 });
          root = created = await realpath(await mkdtemp(join(sharedWorkspaceDir, 'workspace-')));
          const initialized = await initializeRepoWorkspace(root, body.files);
          if (!initialized.ok) return c.json({ error: initialized.error, code: initialized.code }, initialized.code ? 403 : 400);
          const git = await runner('git', ['init', '--quiet'], { cwd: root });
          if (git.code !== 0) throw new Error('Não foi possível preparar o armazenamento do workspace.');
        }
        const status = await share.start(root);
        if (created) { await selectedRepo!.set(root); created = undefined; }
        return c.json(status);
      } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Não foi possível iniciar o compartilhamento.' }, 400); }
      finally { if (created) { const state = await share.status(); if (state.active && state.root === created) await share.stop(); await rm(created, { recursive: true, force: true }); } preparing = false; }
    });
    app.get('/api/share', async (c) => c.json(await share.status()));
    app.post('/api/share/start', async (c) => {
      const dir = selectedRepo?.get();
      if (!dir) return c.json({ error: 'Conecte um repositório no painel GitHub do Joinlet antes de compartilhar.' }, 409);
      const body = await readJson(c) as { dir?: unknown } | undefined;
      if (body?.dir !== dir) return c.json({ error: 'Outro repositório está conectado.' }, 409);
      try { return c.json(await share.start(dir)); }
      catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Não foi possível iniciar o compartilhamento.' }, 400); }
    });
    app.post('/api/share/stop', async (c) => c.json(await share.stop()));
    // Named invites, public access (a tunnel to the collaboration host, acknowledged and timed) and the audit log.
    // Failures are the share's own pt-BR messages (anything else was already replaced there).
    const shareAction = async (c: Context, work: (body: Record<string, unknown>) => Promise<unknown>) => {
      const body = await readJson(c);
      try { return c.json(await work(body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {})); }
      catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Não foi possível concluir.' }, 400); }
    };
    app.post('/api/share/invites', (c) => shareAction(c, (body) => share.createInvite({ name: body.name, role: body.role, ttl: body.ttl })));
    app.post('/api/share/invites/revoke', (c) => shareAction(c, (body) => share.revokeInvite(body.id)));
    app.post('/api/share/tunnel/start', (c) => shareAction(c, (body) => share.startTunnel({ ttl: body.ttl, acknowledged: body.acknowledged })));
    app.post('/api/share/tunnel/stop', (c) => shareAction(c, () => share.stopTunnel()));
    app.get('/api/share/audit', async (c) => {
      const dir = selectedRepo?.get();
      if (!dir) return c.json({ error: 'Conecte um repositório no painel GitHub do Joinlet para ver a atividade.' }, 409);
      return c.json({ entries: await share.activity(dir) });
    });
  }

  app.post('/api/git/diff', async (c) => {
    const body = parseGitBody(await readJson(c));
    if (typeof body === 'string') return c.json({ error: body }, 400);
    const token = await githubAuth?.token() ?? null;
    const result = await gitDiff(withGithubToken(runner, token, !!githubAuth), body.dir, body.base);
    return c.json(result, result.ok ? 200 : 400);
  });

  app.post('/api/git/diagram', async (c) => {
    const raw = await readJson(c);
    const body = parseGitBody(raw);
    if (typeof body === 'string') return c.json({ error: body }, 400);
    const diagram = raw && typeof raw === 'object' ? (raw as { diagram?: unknown }).diagram : undefined;
    if (typeof diagram !== 'string') return c.json({ error: 'Informe "diagram".' }, 400);
    const result = await gitDiagramAtRef(runner, body.dir, body.base?.trim() || 'HEAD', diagram);
    return c.json(result, result.ok ? 200 : 400);
  });

  app.post('/api/git/health', async (c) => {
    const body = parseGitBody(await readJson(c));
    if (typeof body === 'string') return c.json({ error: body }, 400);
    const result = await gitHealth(body.dir);
    if (result.ok) void integrations?.notifyDrift(body.dir, result.evidence.map((issue) => `${issue.diagram} › ${issue.id}: ${issue.message}`), 'Precisão');
    return c.json(result, result.ok ? 200 : 400);
  });

  app.post('/api/git/publish', async (c) => {
    const body = parseGitBody(await readJson(c));
    if (typeof body === 'string') return c.json({ error: body }, 400);
    if (!body.title?.trim()) return c.json({ error: 'Corpo inválido: "title" é obrigatório.' }, 400);
    const token = await githubAuth?.token() ?? null;
    if (githubAuth && !token) return c.json({ error: 'Conecte sua conta GitHub no painel antes de publicar.' }, 401);
    const result = await gitPublish(withGithubToken(runner, token, !!githubAuth), { ...body, title: body.title });
    if (result.ok) void integrations?.notify({ event: 'pr', title: body.title, url: result.url, branch: result.branch });
    return c.json(result, result.ok ? 200 : 400);
  });

  app.post('/api/git/pr', async (c) => {
    const body = parseGitBody(await readJson(c));
    if (typeof body === 'string') return c.json({ error: body }, 400);
    const token = await githubAuth?.token() ?? null;
    if (githubAuth && !token) return c.json({ error: 'Conecte sua conta GitHub no painel para consultar o pull request.' }, 401);
    const result = await gitPrStatus(withGithubToken(runner, token, !!githubAuth), body.dir, body.pr);
    return c.json(result, result.ok ? 200 : 400);
  });

  app.notFound((c) => c.json({ error: 'Rota não encontrada.' }, 404));
  return app;
}
