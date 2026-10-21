import { requestAuthHeaders } from '../workspace/requestAuth';
import { systemMessage, uiText } from '../i18n';
import type { AiProviderId, CompatibleProviderId } from '@strukt/core';
/** Mirrors the server's SettingsView (apps/server/src/settings.ts): status and "…abcd" hints, never a key. */
export type ProviderId = AiProviderId;
export type KeySource = 'env' | 'file' | null;
export interface ModelRoles {
  edit: string;
  generate: string;
  doc: string;
}
export interface SettingsView {
  provider: ProviderId;
  active: ProviderId | null;
  /** For `openai` (an OpenAI-compatible server) `configured` means address + model; `source`/`hint` are about its optional key. */
  providers: Record<ProviderId, { configured: boolean; source: KeySource; hint: string | null }>;
  /** `openai` roles: an empty string means "the same model as for editing". */
  models: { openrouter: ModelRoles; openai: ModelRoles; opencode: ModelRoles; opencodego: ModelRoles } & Partial<Record<CompatibleProviderId, ModelRoles>>;
  openai: { baseUrl: string | null };
}
export interface SettingsPatch {
  provider?: ProviderId;
  keys?: Partial<Record<ProviderId, string | null>>;
  models?: { openrouter?: Partial<ModelRoles>; openai?: Partial<ModelRoles>; opencode?: Partial<ModelRoles>; opencodego?: Partial<ModelRoles> } & Partial<Record<CompatibleProviderId, Partial<ModelRoles>>>;
  openai?: { baseUrl: string | null };
}
export interface OpenRouterModel {
  id: string;
  name: string;
  context: number;
}
export interface GitRepoInfo {
  root: string;
  nameWithOwner: string | null;
  branch: string;
  defaultBase: string | null;
  ghReady: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };

const OFFLINE = uiText("O servidor local não está rodando. Inicie com \"bun run dev\" e tente de novo.");

/** GET/POST against the local server (the Vite proxy); a non-JSON answer means the server is not running. */
export async function call<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { ...requestAuthHeaders(), ...init?.headers } });
  } catch {
    return { ok: false, error: OFFLINE };
  }
  const json = (res.headers.get('content-type') ?? '').includes('application/json');
  const data = json ? ((await res.json().catch(() => null)) as Record<string, unknown> | null) : null;
  if (!data) return { ok: false, error: OFFLINE };
  if (!res.ok) return { ok: false, error: typeof data.error === 'string' ? systemMessage(data.error) : uiText("O servidor respondeu {0}.", [res.status]), status: res.status };
  return { ok: true, value: data as T };
}

export const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const settingsApi = {
  get: () => call<SettingsView>('/api/settings'),
  save: (patch: SettingsPatch) => post<SettingsView>('/api/settings', patch),
  test: (provider: ProviderId) => post<{ ok: boolean; detail: string }>('/api/settings/test', { provider }),
  anthropicModels: () => call<{ models: OpenRouterModel[] }>('/api/settings/anthropic-models'),
  models: () => call<{ models: OpenRouterModel[] }>('/api/settings/openrouter-models'),
  openCodeGoModels: () => call<{ models: OpenRouterModel[] }>('/api/settings/opencode-go-models'),
  openCodeModels: () => call<{ models: OpenRouterModel[] }>('/api/settings/opencode-models'),
  compatibleModels: (id: CompatibleProviderId) => call<{ models: string[] }>(`/api/settings/openai-models?provider=${encodeURIComponent(id)}`),
  openAiModels: () => call<{ models: string[] }>('/api/settings/openai-models'),
  /** The GitHub panel's own route (feat/m6-fluxos); a server without it answers 404. */
  git: (dir: string) => call<{ ok: true; repo: GitRepoInfo; changes: unknown[] }>(`/api/git/status?dir=${encodeURIComponent(dir)}`),
};
