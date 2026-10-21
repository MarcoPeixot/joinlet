import { AI_PROVIDER_IDS, COMPATIBLE_PROVIDERS, COMPATIBLE_PROVIDER_IDS, isCompatibleProvider, readChatModel } from '@strukt/core';
import type { AiProviderId, CompatibleProviderId, ChatModelChoice } from '@strukt/core';
import { MODELS } from './anthropic';
import type { AiClient, Models } from './anthropic';
import { createChatCompletionsClient, normalizeBaseUrl } from './openai';
import { createOpenCodeClient, createOpenCodeGoClient, DEFAULT_OPENCODE_MODEL, DEFAULT_OPENCODE_GO_MODEL, isOpenCodeChatModel, openCodeGoProtocol, OPENCODE_MODELS, OPENCODE_GO_MODELS } from './opencode';
import { OPENROUTER_API } from './openrouter';

export type ProviderId = AiProviderId;
const PROVIDERS = AI_PROVIDER_IDS;
const ROLES = ['edit', 'generate', 'doc'] as const;
const ENV_KEY: Record<ProviderId, string> = { anthropic: 'ANTHROPIC_API_KEY', openrouter: 'OPENROUTER_API_KEY', openai: 'OPENAI_API_KEY', opencode: 'OPENCODE_API_KEY', opencodego: 'OPENCODE_GO_API_KEY', gemini: 'GEMINI_API_KEY', deepseek: 'DEEPSEEK_API_KEY', groq: 'GROQ_API_KEY', mistral: 'MISTRAL_API_KEY' };
const LABEL: Record<ProviderId, string> = { anthropic: 'A Anthropic', openrouter: 'O OpenRouter', openai: 'O servidor compatível com OpenAI', opencode: 'O OpenCode Zen', opencodego: 'O OpenCode Go', gemini: 'O Gemini', deepseek: 'O DeepSeek', groq: 'O Groq', mistral: 'O Mistral' };
const OPENAI_TIMEOUT_MS = 8_000;
const MAX_LISTED_MODELS = 500;
const MAX_KEY = 400;
const MAX_MODEL = 200;
/** OpenRouter's own router picks a capable model until the user chooses one in Configurações. */
const AUTO = 'openrouter/auto';
const MODELS_TTL_MS = 10 * 60_000;

/** `settings.json` on the server's machine (never in the repo, never sent back to the browser). */
export interface SettingsFile {
  version: 1;
  provider: ProviderId;
  keys: Partial<Record<ProviderId, string>>;
  models: { openrouter: Models; openai: Models; opencode: Models; opencodego: Models } & Record<CompatibleProviderId, Models>;
  /** The OpenAI-compatible server (OpenAI, Groq, Ollama, LM Studio…): its key is optional, so the address is what makes it usable. */
  openai: { baseUrl: string | null };
}

export interface AiProvider {
  id: ProviderId;
  client: AiClient;
  models: Models;
  forSession?: (id: string) => AiClient;
}

export type KeySource = 'env' | 'file' | null;

/** What GET /api/settings answers: status and hints, never a key. */
export interface SettingsView {
  provider: ProviderId;
  active: ProviderId | null;
  /** `configured` for the OpenAI-compatible server means address + model; `source`/`hint` are about its (optional) key. */
  providers: Record<ProviderId, { configured: boolean; source: KeySource; hint: string | null }>;
  models: { openrouter: Models; openai: Models; opencode: Models; opencodego: Models } & Record<CompatibleProviderId, Models>;
  openai: { baseUrl: string | null };
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (record: Record<string, unknown>, key: string): unknown => (Object.hasOwn(record, key) ? record[key] : undefined);
const isProvider = (value: unknown): value is ProviderId => typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
const originOf = (url: string): string => new URL(url).origin;
const autoModels = (): Models => ({ edit: AUTO, generate: AUTO, doc: AUTO });
const compatibleDefaults = () => Object.fromEntries(COMPATIBLE_PROVIDER_IDS.map(id => [id, { edit: COMPATIBLE_PROVIDERS[id].model, generate: '', doc: '' }])) as Record<CompatibleProviderId, Models>;
const noModels = (): Models => ({ edit: '', generate: '', doc: '' });
/** The OpenAI-compatible server is usable with an address and a model for editing; the other roles default to it. */
const openAiReady = (file: SettingsFile): boolean => !!file.openai.baseUrl && !!file.models.openai.edit;
/** Loopback, a private (RFC 1918) address or `*.local`: where a key over plain http stays on the person's own network. */
const isLocalHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '[::1]' || hostname.endsWith('.local') || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
const openAiModels = ({ edit, generate, doc }: Models): Models => ({ edit, generate: generate || edit, doc: doc || edit });

/** A key as typed: trimmed, no spaces inside, bounded; a pt-BR reason otherwise. */
function cleanKey(raw: unknown): string | { error: string } {
  if (typeof raw !== 'string') return { error: 'A chave precisa ser texto.' };
  const key = raw.trim();
  if (!key) return { error: 'A chave está vazia.' };
  if (/\s/.test(key)) return { error: 'A chave não pode ter espaços.' };
  if (key.length > MAX_KEY) return { error: 'A chave é longa demais.' };
  return key;
}

const cleanModel = (raw: unknown): string | null =>
  typeof raw === 'string' && raw.trim() && raw.length <= MAX_MODEL && !/\s/.test(raw.trim()) ? raw.trim() : null;

/** A model of the OpenAI-compatible server: empty (or `null`) means "the same as for editing". */
const cleanOptionalModel = (raw: unknown): string | null => (raw === null || raw === '' ? '' : cleanModel(raw));

/** The file as read from disk: untrusted, so only known and well-formed values survive (`__proto__` included). */
export function parseSettingsFile(text: string | null): SettingsFile {
  const file: SettingsFile = { version: 1, provider: 'anthropic', keys: {}, models: { ...compatibleDefaults(), openrouter: autoModels(), openai: noModels(), opencode: { edit: DEFAULT_OPENCODE_MODEL, generate: DEFAULT_OPENCODE_MODEL, doc: DEFAULT_OPENCODE_MODEL }, opencodego: { edit: DEFAULT_OPENCODE_GO_MODEL, generate: DEFAULT_OPENCODE_GO_MODEL, doc: DEFAULT_OPENCODE_GO_MODEL } }, openai: { baseUrl: null } };
  if (!text) return file;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return file;
  }
  if (!isObject(raw)) return file;
  const provider = own(raw, 'provider');
  if (isProvider(provider)) file.provider = provider;
  const keys = own(raw, 'keys');
  if (isObject(keys)) {
    for (const id of PROVIDERS) {
      const key = cleanKey(own(keys, id));
      if (typeof key === 'string') file.keys[id] = key;
    }
  }
  const models = own(raw, 'models');
  const openrouter = isObject(models) ? own(models, 'openrouter') : undefined;
  if (isObject(openrouter)) {
    for (const role of ROLES) file.models.openrouter[role] = cleanModel(own(openrouter, role)) ?? AUTO;
  }
  const openaiModels = isObject(models) ? own(models, 'openai') : undefined;
  if (isObject(openaiModels)) {
    for (const role of ROLES) file.models.openai[role] = cleanModel(own(openaiModels, role)) ?? '';
  }
  const opencode = isObject(models) ? own(models, 'opencode') : undefined;
  if (isObject(opencode)) for (const role of ROLES) {
    const id = cleanModel(own(opencode, role));
    if (id && isOpenCodeChatModel(id)) file.models.opencode[role] = id;
  }
  const go = isObject(models) ? own(models, 'opencodego') : undefined;
  if (isObject(go)) for (const role of ROLES) {
    const id = cleanModel(own(go, role));
    if (id && openCodeGoProtocol(id)) file.models.opencodego[role] = id;
  }
  for (const id of COMPATIBLE_PROVIDER_IDS) {
    const entry = isObject(models) ? own(models, id) : undefined;
    if (isObject(entry)) for (const role of ROLES) file.models[id][role] = cleanOptionalModel(own(entry, role)) ?? file.models[id][role];
  }
  const openai = own(raw, 'openai');
  const baseUrl = isObject(openai) ? normalizeBaseUrl(own(openai, 'baseUrl')) : null;
  if (typeof baseUrl === 'string') file.openai.baseUrl = baseUrl;
  return file;
}

/**
 * Effective keys: the environment wins over the file. Active: the chosen provider if it is usable (a key; for the
 * OpenAI-compatible server an address and a model), else the first other one that is.
 */
export function resolveProviders(file: SettingsFile, env: Record<string, string | undefined>) {
  const resolve = (id: ProviderId): { key: string | null; source: KeySource } => {
    const fromEnv = env[ENV_KEY[id]]?.trim();
    if (fromEnv) return { key: fromEnv, source: 'env' };
    const fromFile = file.keys[id];
    return fromFile ? { key: fromFile, source: 'file' } : { key: null, source: null };
  };
  const anthropic = resolve('anthropic');
  const openrouter = resolve('openrouter');
  const openai = resolve('openai');
  const opencode = resolve('opencode');
  const opencodego = resolve('opencodego');
  const compatible = Object.fromEntries(COMPATIBLE_PROVIDER_IDS.map(id => [id, resolve(id)])) as Record<CompatibleProviderId, ReturnType<typeof resolve>>;
  const has = { ...Object.fromEntries(COMPATIBLE_PROVIDER_IDS.map(id => [id, !!compatible[id].key && !!file.models[id].edit])) as Record<CompatibleProviderId, boolean>, anthropic: !!anthropic.key, openrouter: !!openrouter.key, openai: openAiReady(file), opencode: !!opencode.key, opencodego: !!opencodego.key };
  const active: ProviderId | null = [file.provider, ...PROVIDERS.filter((id) => id !== file.provider)].find((id) => has[id]) ?? null;
  return { ...compatible, anthropic, openrouter, openai, opencode, opencodego, active };
}

export const keyHint = (key: string | null): string | null => (key ? `…${key.slice(-4)}` : null);

/** POST /api/settings body → the next file, or a pt-BR reason. `null` removes a key from the file. */
export function applyPatch(file: SettingsFile, raw: unknown): SettingsFile | string {
  if (!isObject(raw)) return 'Corpo inválido: envie um objeto JSON.';
  const next: SettingsFile = { ...file, keys: { ...file.keys }, models: { ...Object.fromEntries(COMPATIBLE_PROVIDER_IDS.map(id => [id, { ...file.models[id] }])) as Record<CompatibleProviderId, Models>, openrouter: { ...file.models.openrouter }, openai: { ...file.models.openai }, opencode: { ...file.models.opencode }, opencodego: { ...file.models.opencodego } }, openai: { ...file.openai } };
  const provider = own(raw, 'provider');
  if (provider !== undefined) {
    if (!isProvider(provider)) return 'Corpo inválido: selecione um provedor de IA disponível.';
    next.provider = provider;
  }
  const keys = own(raw, 'keys');
  if (keys !== undefined) {
    if (!isObject(keys)) return 'Corpo inválido: "keys" precisa ser um objeto.';
    for (const id of PROVIDERS) {
      const value = own(keys, id);
      if (value === undefined) continue;
      if (value === null) {
        delete next.keys[id];
        continue;
      }
      const key = cleanKey(value);
      if (typeof key !== 'string') return key.error;
      next.keys[id] = key;
    }
  }
  const models = own(raw, 'models');
  if (models !== undefined && !isObject(models)) return 'Corpo inválido: "models" precisa ser um objeto.';
  const openrouter = isObject(models) ? own(models, 'openrouter') : undefined;
  if (openrouter !== undefined && !isObject(openrouter)) return 'Corpo inválido: "models.openrouter" precisa ser um objeto.';
  if (isObject(openrouter)) {
    for (const role of ROLES) {
      const value = own(openrouter, role);
      if (value === undefined) continue;
      const model = cleanModel(value);
      if (!model) return `Modelo inválido para "${role}".`;
      next.models.openrouter[role] = model;
    }
  }
  const openaiModels = isObject(models) ? own(models, 'openai') : undefined;
  if (openaiModels !== undefined && !isObject(openaiModels)) return 'Corpo inválido: "models.openai" precisa ser um objeto.';
  if (isObject(openaiModels)) {
    for (const role of ROLES) {
      const value = own(openaiModels, role);
      if (value === undefined) continue;
      const model = cleanOptionalModel(value);
      if (model === null) return `Modelo inválido para "${role}".`;
      next.models.openai[role] = model;
    }
  }
  const opencodeModels = isObject(models) ? own(models, 'opencode') : undefined;
  if (opencodeModels !== undefined && !isObject(opencodeModels)) return 'Corpo inválido: "models.opencode" precisa ser um objeto.';
  if (isObject(opencodeModels)) for (const role of ROLES) {
    const value = own(opencodeModels, role);
    if (value === undefined) continue;
    const model = cleanModel(value);
    if (!model || !isOpenCodeChatModel(model)) return `Modelo incompatível com a conexão OpenCode para "${role}". Escolha um modelo de chat do catálogo.`;
    next.models.opencode[role] = model;
  }
  const goModels = isObject(models) ? own(models, 'opencodego') : undefined;
  if (goModels !== undefined && !isObject(goModels)) return 'Corpo inválido: "models.opencodego" precisa ser um objeto.';
  if (isObject(goModels)) for (const role of ROLES) {
    const value = own(goModels, role);
    if (value === undefined) continue;
    const model = cleanModel(value);
    if (!model || !openCodeGoProtocol(model)) return `Modelo incompatível com a conexão OpenCode Go para "${role}".`;
    next.models.opencodego[role] = model;
  }
  for (const id of COMPATIBLE_PROVIDER_IDS) {
    const entry = isObject(models) ? own(models, id) : undefined;
    if (entry !== undefined && !isObject(entry)) return `Modelos inválidos para ${id}.`;
    if (isObject(entry)) for (const role of ROLES) {
      const value = own(entry, role);
      if (value === undefined) continue;
      const model = cleanOptionalModel(value);
      if (model === null || (role === 'edit' && !model)) return `Modelo inválido para ${id}: ${role}.`;
      next.models[id][role] = model;
    }
  }
  const openai = own(raw, 'openai');
  if (openai !== undefined) {
    if (!isObject(openai)) return 'Corpo inválido: "openai" precisa ser um objeto.';
    const baseUrl = own(openai, 'baseUrl');
    if (baseUrl === null || baseUrl === '') next.openai.baseUrl = null;
    else if (baseUrl !== undefined) {
      const url = normalizeBaseUrl(baseUrl);
      if (typeof url !== 'string') return url.error;
      next.openai.baseUrl = url;
    }
  }
  // The saved key belongs to the host it was saved for: a patch that points the provider at another origin without
  // typing a key in the same request would otherwise ship `Bearer <key>` to wherever the new address is.
  const keyTyped = isObject(keys) && typeof own(keys, 'openai') === 'string';
  if (next.openai.baseUrl && !keyTyped && originOf(next.openai.baseUrl) !== (file.openai.baseUrl && originOf(file.openai.baseUrl))) delete next.keys.openai;
  return next;
}

export interface SettingsDeps {
  /** Absolute path of settings.json. */
  file: string;
  env: Record<string, string | undefined>;
  /** `write` creates the folder (0700) and the file (0600); main.ts passes Node's fs, tests an in-memory map. */
  fs: { read(path: string): Promise<string | null>; write(path: string, text: string): Promise<void> };
  fetch: typeof globalThis.fetch;
  anthropic(apiKey: string): AiClient;
  openrouter(apiKey: string): AiClient;
  /** Defaults to the chat completions adapter over `deps.fetch`. */
  openai?(config: { baseUrl: string; apiKey?: string }): AiClient;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  context: number;
}

/** The settings behind /api/settings and the AI routes: loads the file, rebuilds the provider on every save. */
export function createSettings(deps: SettingsDeps) {
  let file = parseSettingsFile(null);
  let provider: AiProvider | null = null;
  let cachedModels: { at: number; list: OpenRouterModel[] } | null = null;

  const buildProvider = (id: ProviderId | null): AiProvider | null => {
    const resolved = resolveProviders(file, deps.env);
    const key = id ? resolved[id].key : null;
    if (isCompatibleProvider(id)) {
      if (!key || !file.models[id].edit) return null;
      return { id, client: createChatCompletionsClient({ baseUrl: COMPATIBLE_PROVIDERS[id].baseUrl, apiKey: key, label: COMPATIBLE_PROVIDERS[id].name, fetch: deps.fetch }), models: openAiModels(file.models[id]) };
    }
    if (id === 'openai') {
      if (!openAiReady(file)) return null;
      const config = { baseUrl: file.openai.baseUrl!, ...(key ? { apiKey: key } : {}) };
      const make = deps.openai ?? ((c: { baseUrl: string; apiKey?: string }) => createChatCompletionsClient({ ...c, label: 'servidor compatível com OpenAI', fetch: deps.fetch }));
      return { id, client: make(config), models: openAiModels(file.models.openai) };
    } else if (id === 'opencodego' && key) {
      const forSession = (sessionId: string) => createOpenCodeGoClient({ apiKey: key, sessionId, fetch: deps.fetch });
      return { id, client: forSession(globalThis.crypto.randomUUID()), models: file.models.opencodego, forSession };
    } else if (id === 'opencode' && key) {
      return { id, client: createOpenCodeClient({ apiKey: key, fetch: deps.fetch }), models: file.models.opencode };
    } else {
      return (id === 'anthropic' || id === 'openrouter') && key ? { id, client: deps[id](key), models: id === 'anthropic' ? MODELS : file.models.openrouter } : null;
    }
  };

  const rebuild = () => { provider = buildProvider(resolveProviders(file, deps.env).active); };

  const view = (): SettingsView => {
    const resolved = resolveProviders(file, deps.env);
    const status = (id: ProviderId) => ({ configured: !!resolved[id].key, source: resolved[id].source, hint: keyHint(resolved[id].key) });
    return {
      provider: file.provider,
      active: resolved.active,
      providers: { ...Object.fromEntries(COMPATIBLE_PROVIDER_IDS.map(id => [id, { ...status(id), configured: !!resolved[id].key && !!file.models[id].edit }])) as Record<CompatibleProviderId, ReturnType<typeof status>>, anthropic: status('anthropic'), openrouter: status('openrouter'), openai: { ...status('openai'), configured: openAiReady(file) }, opencode: status('opencode'), opencodego: status('opencodego') },
      models: { ...Object.fromEntries(COMPATIBLE_PROVIDER_IDS.map(id => [id, { ...file.models[id] }])) as Record<CompatibleProviderId, Models>, openrouter: { ...file.models.openrouter }, openai: { ...file.models.openai }, opencode: { ...file.models.opencode }, opencodego: { ...file.models.opencodego } },
      openai: { ...file.openai },
    };
  };

  /** GET `<baseUrl>/models` with the key when there is one: the answer of the OpenAI-compatible server, or why not. */
  const fetchOpenAiModels = async (id: 'openai' | CompatibleProviderId = 'openai'): Promise<{ ok: true; base: string; ids: string[] } | { ok: false; detail: string }> => {
    const base = isCompatibleProvider(id) ? COMPATIBLE_PROVIDERS[id].baseUrl : file.openai.baseUrl;
    if (!base) return { ok: false, detail: 'Informe o endereço do servidor.' };
    const key = resolveProviders(file, deps.env)[id].key;
    if (isCompatibleProvider(id) && !key) return { ok: false, detail: 'Nenhuma chave configurada.' };
    let res: Response;
    try {
      res = await deps.fetch(`${base}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {}, redirect: 'error', signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS) });
    } catch {
      return { ok: false, detail: `Não foi possível falar com o servidor em ${base}.` };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, detail: `${LABEL[id]} recusou a chave.` };
    if (res.status === 404) return { ok: false, detail: `O servidor respondeu 404 em ${base}/models: confira o endereço (costuma terminar em /v1).` };
    if (!res.ok) return { ok: false, detail: `${LABEL[id]} respondeu com erro ${res.status}.` };
    const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
    const ids = Array.isArray(body?.data) ? (body.data as unknown[]).flatMap((m) => (isObject(m) && typeof own(m, 'id') === 'string' ? [own(m, 'id') as string] : [])) : [];
    return { ok: true, base, ids: [...new Set(ids)].sort().slice(0, MAX_LISTED_MODELS) };
  };

  const testOpenAi = async (): Promise<{ ok: boolean; detail: string }> => {
    const result = await fetchOpenAiModels();
    if (!result.ok) return result;
    const count = `${result.ids.length} ${result.ids.length === 1 ? 'modelo' : 'modelos'}`;
    const model = file.models.openai.edit;
    const missing = model && result.ids.length && !result.ids.includes(model) ? `, mas o modelo "${model}" não aparece na lista do servidor` : '';
    const { protocol, hostname } = new URL(result.base);
    const clear = protocol === 'http:' && !isLocalHost(hostname) && resolveProviders(file, deps.env).openai.key ? ' Atenção: o endereço usa http e a chave vai sem criptografia.' : '';
    return { ok: true, detail: `Conectado a ${result.base} (${count})${missing}.${clear}` };
  };

  const fetchOpenCodeModels = async (go = false): Promise<OpenRouterModel[]> => {
    const res = await deps.fetch(go ? OPENCODE_GO_MODELS : OPENCODE_MODELS, { redirect: 'error', signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`OpenCode respondeu com erro ${res.status}.`);
    const body: unknown = await res.json();
    if (!isObject(body) || !Array.isArray(body.data)) throw new Error('Catálogo OpenCode inválido.');
    return body.data.flatMap((model): OpenRouterModel[] => {
      if (!isObject(model) || typeof model.id !== 'string' || !(go ? openCodeGoProtocol(model.id) : isOpenCodeChatModel(model.id))) return [];
      return [{ id: model.id, name: typeof model.name === 'string' ? model.name : model.id, context: 0 }];
    }).slice(0, MAX_LISTED_MODELS);
  };

  return {
    async load(): Promise<void> {
      file = parseSettingsFile(await deps.fs.read(deps.file).catch(() => null));
      rebuild();
    },
    current: (): AiProvider | null => provider,
    /** Chat overrides do not write settings or silently fall back to another provider. */
    forChat(choice: ChatModelChoice): AiProvider | string {
      if (!readChatModel(choice)) return 'Modelo ou provider inválido.';
      if (choice.provider === 'opencodego' && !openCodeGoProtocol(choice.model)) return 'Este modelo não está disponível no OpenCode Go.';
      if (choice.provider === 'opencode' && !isOpenCodeChatModel(choice.model)) return 'Este modelo não suporta chat no OpenCode Zen.';
      const selected = buildProvider(choice.provider);
      return selected ? { ...selected, models: { ...selected.models, edit: choice.model } } : 'Conecte o provider selecionado em Configurações › IA e providers.';
    },
    openCodeModels: fetchOpenCodeModels,
    view,
    async update(patch: unknown): Promise<SettingsView | string> {
      const next = applyPatch(file, patch);
      if (typeof next === 'string') return next;
      await deps.fs.write(deps.file, `${JSON.stringify(next, null, 2)}\n`);
      file = next;
      rebuild();
      return view();
    },
    /** Asks the provider whether the effective key is valid, on an endpoint that spends no tokens. */
    async test(id: ProviderId): Promise<{ ok: boolean; detail: string }> {
      if (isCompatibleProvider(id)) {
        const result = await fetchOpenAiModels(id);
        return result.ok ? { ok: true, detail: `Conexão com ${COMPATIBLE_PROVIDERS[id].name} validada (${result.ids.length} modelos).` } : { ok: false, detail: result.detail };
      }
      if (id === 'openai') return testOpenAi();
      if (id === 'opencode' || id === 'opencodego') {
        if (!resolveProviders(file, deps.env)[id].key) return { ok: false, detail: 'Nenhuma chave configurada.' };
        try {
          const models = await fetchOpenCodeModels(id === 'opencodego');
          return { ok: true, detail: `${id === 'opencodego' ? 'OpenCode Go' : 'OpenCode Zen'} acessível (${models.length} modelos compatíveis). A chave será validada no primeiro pedido ao modelo.` };
        } catch { return { ok: false, detail: 'Não foi possível acessar o catálogo do OpenCode.' }; }
      }
      const key = resolveProviders(file, deps.env)[id].key;
      if (!key) return { ok: false, detail: 'Nenhuma chave configurada.' };
      try {
        const res =
          id === 'anthropic'
            ? await deps.fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } })
            : await deps.fetch(`${OPENROUTER_API}/key`, { headers: { authorization: `Bearer ${key}` } });
        if (res.status === 401 || res.status === 403) return { ok: false, detail: `${LABEL[id]} recusou a chave.` };
        if (!res.ok) return { ok: false, detail: `${LABEL[id]} respondeu com erro ${res.status}.` };
        if (id === 'anthropic') return { ok: true, detail: 'Chave aceita pela Anthropic.' };
        const body = (await res.json().catch(() => null)) as { data?: { label?: unknown } } | null;
        const label = typeof body?.data?.label === 'string' && body.data.label ? ` (${body.data.label})` : '';
        return { ok: true, detail: `Chave aceita pelo OpenRouter${label}.` };
      } catch {
        return { ok: false, detail: `Não foi possível falar com ${id === 'anthropic' ? 'a Anthropic' : 'o OpenRouter'}.` };
      }
    },
    /** The model ids the OpenAI-compatible server lists (Ollama shows what is installed); throws a pt-BR reason. */
    async openAiModels(id: 'openai' | CompatibleProviderId = 'openai'): Promise<string[]> {
      const result = await fetchOpenAiModels(id);
      if (!result.ok) throw new Error(result.detail);
      return result.ids;
    },
    /** OpenRouter's public catalog, only the models that can call tools (the diagram tool needs it); cached. */
    async openRouterModels(): Promise<OpenRouterModel[]> {
      if (cachedModels && Date.now() - cachedModels.at < MODELS_TTL_MS) return cachedModels.list;
      const res = await deps.fetch(`${OPENROUTER_API}/models`);
      if (!res.ok) throw new Error(`OpenRouter respondeu com erro ${res.status}.`);
      const body = (await res.json()) as { data?: Record<string, unknown>[] };
      const list = (body.data ?? [])
        .filter((m) => typeof m.id === 'string' && Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools'))
        .map((m) => ({ id: m.id as string, name: typeof m.name === 'string' ? m.name : (m.id as string), context: Number(m.context_length ?? 0) }));
      cachedModels = { at: Date.now(), list };
      return list;
    },
  };
}

export type Settings = ReturnType<typeof createSettings>;
