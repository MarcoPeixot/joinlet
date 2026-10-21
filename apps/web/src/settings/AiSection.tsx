import { systemMessage, uiText } from '../i18n';
import { COMPATIBLE_PROVIDERS, COMPATIBLE_PROVIDER_IDS, isCompatibleProvider } from '@strukt/core';
import type { CompatibleProviderId } from '@strukt/core';
import { ProviderLogo } from './ProviderLogo';
import { Check, ChevronsUpDown, ExternalLink, KeyRound, LoaderCircle, Lock, RefreshCw, ServerOff, X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/controls';
import { Popover } from '../ui/Popover';
import type { ModelRoles, ProviderId, SettingsView } from './client';
import { settingsApi } from './client';
import { loadOpenRouterModels, refreshSettings, saveSettings, settingsStore, testProvider, useSettings } from './store';

import { PROVIDER } from './providers';
import { AiSetupGuide } from './AiSetupGuide';

type KeyedProvider = Exclude<ProviderId, 'openai'>;

const OPENAI_PRESETS: [string, string][] = [
  ['OpenAI', 'https://api.openai.com/v1'],
  ['Groq', 'https://api.groq.com/openai/v1'],
  ['Ollama', 'http://localhost:11434/v1'],
  ['LM Studio', 'http://localhost:1234/v1'],
];

const ROLE_LABELS: [keyof ModelRoles, string, string][] = [
  ['edit', uiText("Editar diagrama"), uiText("Padrão para o compositor e novas conversas")],
  ['generate', uiText("Gerar do zero"), uiText("Diagramas inteiros a partir de uma frase")],
  ['doc', uiText("Documentar"), uiText("\"Gerar documentação\" da arquitetura")],
];

function StatusPill({ status }: { status: SettingsView['providers'][ProviderId] }) {
  const tone = status.configured ? 'var(--sk-diff-added)' : 'var(--sk-faint)';
  const text = !status.configured ? uiText("Não configurada") : status.source === 'env' ? uiText("Variável de ambiente {0}", [status.hint]) : uiText("Salva neste computador {0}", [status.hint]);
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-panel-2 px-2 py-0.5 font-mono text-[10.5px] text-muted">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
      {text}
    </span>
  );
}

function TestLine({ id }: { id: ProviderId }) {
  const result = useSettings((s) => s.tests[id]);
  return (
    <AnimatePresence mode="wait" initial={false}>
      {result && (
        <m.p
          key={result === 'running' ? 'running' : systemMessage(result.detail)}
          className={`flex items-center gap-1.5 text-caption ${result === 'running' ? 'text-muted' : result.ok ? 'text-(--sk-diff-added)' : 'text-danger'}`}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          {result === 'running' ? <LoaderCircle size={13} className="animate-spin" /> : result.ok ? <Check size={13} /> : <X size={13} />}
          {result === 'running' ? uiText("Testando…") : systemMessage(result.detail)}
        </m.p>
      )}
    </AnimatePresence>
  );
}

function ProviderCard({ id, view, active }: { id: KeyedProvider; view: SettingsView; active: boolean }) {
  const meta = PROVIDER[id];
  const status = view.providers[id] ?? { configured: false, source: null, hint: null };
  const saving = useSettings((s) => s.saving);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async (value: string | null) => {
    setError(null);
    const failure = await saveSettings({ ...(value ? { provider: id } : {}), keys: { [id]: value } });
    if (failure) setError(failure);
    else setKey('');
  };
  return (
    <section
      aria-label={meta.name}
      className={`sk-provider-card flex flex-col gap-4 ${
        active ? 'is-active' : ''
      }`}
    >
      <header className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] font-mono text-caption font-bold text-white" style={{ background: meta.color }}>
          <ProviderLogo id={id} size={22} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-title font-semibold">{meta.name}</h3>
            {active && <span className="rounded-full bg-accent-strong px-2 py-0.5 text-[10.5px] font-semibold text-accent-ink">{uiText("Em uso")}</span>}
          </div>
          <p className="text-caption leading-relaxed text-muted">{meta.blurb}</p>
        </div>
        <div className="col-span-2 flex"><StatusPill status={status} /></div>
      </header>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (key.trim()) void save(key);
        }}
      >
        <div className="relative min-w-40 flex-1">
          <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={uiText("Chave {0}", [meta.name])}
            className={`${inputClass} h-9 pl-9 font-mono text-caption`}
            placeholder={status.configured ? uiText("Substituir a chave ({0})", [status.hint]) : meta.placeholder}
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
        </div>
        <Button type="submit" variant="primary" disabled={!key.trim() || saving}>
          {status.configured ? uiText("Salvar e usar") : uiText("Conectar")}
        </Button>
        {status.source === 'file' && (
          <Button variant="danger" disabled={saving} onClick={() => void save(null)}>{uiText("Remover")}</Button>
        )}
      </form>
      {error && <p className="text-caption text-danger">{error}</p>}
      {status.source === 'env' && (
        <p className="text-caption text-muted">{uiText("Definida por")} <code className="rounded-chip bg-panel-3 px-1 font-mono text-meta">{meta.env}</code> {uiText("no servidor — ela tem prioridade sobre a chave salva aqui.")}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {status.configured && !active && <Button size="sm" variant="primary" disabled={saving} onClick={() => void saveSettings({ provider: id })}>{uiText("Usar este provedor")}</Button>}
        <Button size="sm" disabled={!status.configured} icon={<RefreshCw size={13} />} onClick={() => void testProvider(id)}>{uiText("Testar conexão")}</Button>
        <TestLine id={id} />
        <a className="ml-auto flex items-center gap-1 text-caption text-muted hover:text-accent" href={meta.keysUrl} target="_blank" rel="noopener noreferrer">{uiText("Criar uma chave")} <ExternalLink size={12} />
        </a>
      </div>
      {isCompatibleProvider(id) && <CompatibleModels id={id} view={view} />}
      {id === 'openrouter' && <ModelRolesPicker view={view} />}
      {(id === 'opencode' || id === 'opencodego') && <OpenCodeModels view={view} id={id} />}
    </section>
  );
}

function CompatibleModels({ id, view }: { id: CompatibleProviderId; view: SettingsView }) {
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const configured = view.providers[id]?.configured;
  const hint = view.providers[id]?.hint;
  useEffect(() => {
    let current = true;
    setModels([]); setError(null);
    if (configured) void settingsApi.compatibleModels(id).then(result => {
      if (!current) return;
      if (result.ok) setModels(result.value.models);
      else setError(result.error);
    });
    return () => { current = false; };
  }, [id, configured, hint]);
  const roles = view.models[id] ?? { edit: COMPATIBLE_PROVIDERS[id].model, generate: '', doc: '' };
  return <div className="flex flex-col gap-2">
    <p className="text-caption text-muted">{uiText("Escolha um modelo de chat com suporte a ferramentas. Você também pode informar o ID do modelo.")}</p>
    <datalist id={`models-${id}`}>{models.map(model => <option key={model} value={model} />)}</datalist>
    {ROLE_LABELS.map(([role, label, hint]) => <OpenAiModelField key={role} provider={id} role={role} label={label} hint={hint} value={roles[role]} listId={`models-${id}`} />)}
    {error && <p role="status" className="text-caption text-muted">{error} {uiText("Você pode informar o modelo manualmente.")}</p>}
  </div>;
}

function OpenCodeModels({ view, id }: { view: SettingsView; id: 'opencode' | 'opencodego' }) {
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const saving = useSettings((state) => state.saving);
  useEffect(() => {
    let cancelled = false;
    void (id === 'opencodego' ? settingsApi.openCodeGoModels() : settingsApi.openCodeModels()).then((result) => {
      if (cancelled) return;
      if (result.ok) setModels(result.value.models.map((model) => model.id));
      else setError(result.error);
    });
    return () => { cancelled = true; };
  }, [id]);
  return <div className="flex flex-col gap-2">
    <p className="text-caption text-muted">{uiText("Modelos compatíveis com a conexão")} {PROVIDER[id].name}{uiText(". Cada tarefa pode usar um modelo diferente.")}</p>
    {ROLE_LABELS.map(([role, label]) => <label key={role} className="flex flex-col gap-1.5 text-caption text-muted">
      <span>{label}</span>
      <select aria-label={uiText("Modelo {0} {1}", [PROVIDER[id].name, label])} disabled={saving} className={`${inputClass} h-9`} value={view.models[id][role]} onChange={(event) => {
        setError(null);
        void saveSettings({ models: { [id]: { [role]: event.target.value } } }).then((failure) => { if (failure) setError(failure); });
      }}>{[...new Set([view.models[id][role], ...models])].map((model) => <option key={model} value={model}>{model}</option>)}</select>
    </label>)}
    {error && <p role="status" className="text-caption text-danger">{error}</p>}
  </div>;
}

/** One role's model for the OpenAI-compatible server: free text (with the server's own list as suggestions), saved on Enter or blur. */
function OpenAiModelField({ provider = 'openai', role, label, hint, value, listId }: { provider?: 'openai' | CompatibleProviderId; role: keyof ModelRoles; label: string; hint: string; value: string; listId: string }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(value), [value]);
  const commit = async () => {
    const next = text.trim();
    if (next === value) return;
    setError(null);
    const failure = await saveSettings({ models: { [provider]: { [role]: next } } });
    if (failure) setError(failure);
  };
  return (
    <div className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-body font-medium">{label}</span>
        <span className="text-meta text-muted">{error ?? hint}</span>
      </div>
      <input
        aria-label={uiText("Modelo {0}", [label])}
        list={listId}
        spellCheck={false}
        autoComplete="off"
        className={`${inputClass} h-8 w-full sm:!w-64 flex-none font-mono text-caption`}
        placeholder={role === 'edit' ? 'ex.: llama3.1' : uiText("igual ao de editar")}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void commit();
          }
        }}
      />
    </div>
  );
}

function OpenAiCard({ view, active }: { view: SettingsView; active: boolean }) {
  const meta = PROVIDER.openai;
  const status = view.providers.openai;
  const baseUrl = view.openai.baseUrl;
  const saving = useSettings((s) => s.saving);
  /** What the server lists (asked on first focus of a model field, again after the address changes); `[]` when it cannot say. */
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [url, setUrl] = useState(baseUrl ?? '');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setUrl(baseUrl ?? '');
    setSuggestions(null);
  }, [baseUrl]);
  const save = async (patch: Parameters<typeof saveSettings>[0], done?: () => void) => {
    setError(null);
    const failure = await saveSettings(patch);
    if (failure) setError(failure);
    else done?.();
  };
  const host = baseUrl ? baseUrl.replace(/^https?:\/\//, '') : null;
  return (
    <section
      aria-label={meta.name}
      className={`sk-provider-card flex flex-col gap-4 ${
        active ? 'is-active' : ''
      }`}
    >
      <header className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] font-mono text-caption font-bold text-white" style={{ background: meta.color }}>
          <ProviderLogo id="openai" size={22} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-title font-semibold">{meta.name}</h3>
            {active && <span className="rounded-full bg-accent-strong px-2 py-0.5 text-[10.5px] font-semibold text-accent-ink">{uiText("Em uso")}</span>}
          </div>
          <p className="text-caption leading-relaxed text-muted">{meta.blurb}</p>
        </div>
        <span className="col-span-2 flex w-fit max-w-full items-center gap-1.5 truncate rounded-full bg-panel-2 px-2 py-0.5 font-mono text-[10.5px] text-muted">
          <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: status.configured ? 'var(--sk-diff-added)' : 'var(--sk-faint)' }} />
          <span className="truncate">{status.configured ? host : uiText("Não configurada")}</span>
        </span>
      </header>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save({ openai: { baseUrl: url.trim() || null } });
        }}
      >
        <div className="flex items-center gap-2">
          <input
            type="url"
            aria-label={uiText("Endereço do servidor")}
            spellCheck={false}
            autoComplete="off"
            className={`${inputClass} h-9 flex-1 font-mono text-caption`}
            placeholder="http://localhost:11434/v1"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Button type="submit" variant="primary" disabled={saving || url.trim() === (baseUrl ?? '')}>{uiText("Salvar")}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {OPENAI_PRESETS.map(([name, preset]) => (
            <button key={name} type="button" onClick={() => setUrl(preset)} className="rounded-chip border border-line-strong bg-panel-2 px-2 py-0.5 text-meta text-ink hover:bg-panel-3">
              {name}
            </button>
          ))}
        </div>
      </form>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (key.trim()) void save({ keys: { openai: key } }, () => setKey(''));
        }}
      >
        <div className="relative min-w-40 flex-1">
          <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={uiText("Chave Compatível com OpenAI")}
            className={`${inputClass} h-9 pl-9 font-mono text-caption`}
            placeholder={status.source ? uiText("Substituir a chave ({0})", [status.hint]) : meta.placeholder}
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
        </div>
        <Button type="submit" variant="primary" disabled={!key.trim() || saving}>{uiText("Salvar chave")}</Button>
        {status.source === 'file' && (
          <Button variant="danger" disabled={saving} onClick={() => void save({ keys: { openai: null } })}>{uiText("Remover")}</Button>
        )}
      </form>
      {error && <p className="text-caption text-danger">{error}</p>}
      {status.source === 'env' && (
        <p className="text-caption text-muted">{uiText("Chave definida por")} <code className="rounded-chip bg-panel-3 px-1 font-mono text-meta">{meta.env}</code> {uiText("no servidor — ela tem prioridade sobre a salva aqui.")}</p>
      )}
      <datalist id="sk-openai-models">{(suggestions ?? []).map((id) => <option key={id} value={id} />)}</datalist>
      <div className="flex flex-col divide-y divide-line rounded-[12px] border border-line bg-panel/60 px-3" onFocusCapture={() => suggestions === null && baseUrl && void settingsApi.openAiModels().then((res) => setSuggestions(res.ok ? res.value.models : []))}>
        {ROLE_LABELS.map(([role, label, hint]) => (
          <OpenAiModelField key={role} role={role} label={label} hint={hint} value={view.models.openai[role]} listId="sk-openai-models" />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={!baseUrl} icon={<RefreshCw size={13} />} onClick={() => void testProvider('openai')}>{uiText("Testar conexão")}</Button>
        <TestLine id="openai" />
        <a className="ml-auto flex items-center gap-1 text-caption text-muted hover:text-accent" href={meta.keysUrl} target="_blank" rel="noopener noreferrer">{uiText("Criar uma chave")} <ExternalLink size={12} />
        </a>
      </div>
    </section>
  );
}

function ModelPicker({ role, value }: { role: keyof ModelRoles; value: string }) {
  const models = useSettings((s) => s.models);
  const modelsError = useSettings((s) => s.modelsError);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [{ id: 'openrouter/auto', name: uiText("Automático — o OpenRouter escolhe"), context: 0 }, ...(models ?? [])];
    return (q ? all.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)) : all).slice(0, 80);
  }, [models, query]);
  const pick = async (id: string) => {
    setOpen(false);
    setQuery('');
    await saveSettings({ models: { openrouter: { [role]: id } } });
  };
  return (
    <Popover
      label={uiText("Escolher modelo")}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void loadOpenRouterModels();
      }}
      align="end"
      trigger={
        <button
          type="button"
          aria-label={uiText("Modelo para {0}: {1}", [role, value])}
          className={`${inputClass} flex h-8 w-full sm:!w-64 flex-none items-center justify-between gap-2 text-left font-mono text-caption`}
        >
          <span className="truncate">{value === 'openrouter/auto' ? uiText("Automático") : value}</span>
          <ChevronsUpDown size={13} className="flex-none text-faint" />
        </button>
      }
    >
      <div className="flex w-[360px] flex-col">
        <input autoFocus aria-label={uiText("Buscar modelos")} className="h-10 border-b border-line bg-transparent px-3 text-body outline-none placeholder:text-faint" placeholder={uiText("Buscar modelo (claude, gpt, gemini…)")} value={query} onChange={(event) => setQuery(event.target.value)} />
        <ul className="max-h-72 overflow-y-auto p-1" role="listbox" aria-label={uiText("Modelos")}>
          {!models && !modelsError && (
            <li className="flex items-center gap-2 px-3 py-3 text-caption text-muted">
              <LoaderCircle size={13} className="animate-spin" /> {uiText("Carregando modelos que usam ferramentas…")}</li>
          )}
          {modelsError && <li className="px-3 py-3 text-caption text-danger">{modelsError}</li>}
          {list.map((m) => (
            <li key={m.id} role="option" aria-selected={m.id === value}>
              <button type="button" onClick={() => void pick(m.id)} className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left hover:bg-panel-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body">{m.name}</span>
                  <span className="truncate font-mono text-meta text-faint">
                    {m.id}
                    {m.context ? ` · ${Math.round(m.context / 1000)}k` : ''}
                  </span>
                </span>
                {m.id === value && <Check size={14} className="text-accent" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Popover>
  );
}

function ModelRolesPicker({ view }: { view: SettingsView }) {
  return (
    <div className="flex flex-col divide-y divide-line rounded-[12px] border border-line bg-panel/60 px-3">
      {ROLE_LABELS.map(([role, label, hint]) => (
        <div key={role} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-body font-medium">{label}</span>
            <span className="text-meta text-muted">{hint}</span>
          </div>
          <ModelPicker role={role} value={view.models.openrouter[role]} />
        </div>
      ))}
    </div>
  );
}

export function AiSection() {
  const view = useSettings((s) => s.view);
  const error = useSettings((s) => s.error);
  const loading = useSettings((s) => s.loading);
  const saving = useSettings((s) => s.saving);
  const selected = useSettings(s => s.editingProvider);
  const selection = selected ?? view?.active ?? 'openrouter';
  if (!view) {
    if (!loading) return <AiSetupGuide error={error} />;
    return (
      <div className="flex flex-col items-center gap-3 rounded-[14px] border border-line bg-panel-2/40 px-6 py-10 text-center">
        {loading ? <LoaderCircle size={20} className="animate-spin text-muted" /> : <ServerOff size={22} className="text-muted" />}
        <p className="max-w-sm text-body text-muted">{loading ? uiText("Carregando…") : (error ?? uiText("Sem resposta do servidor local."))}</p>
        {!loading && (
          <Button size="sm" icon={<RefreshCw size={13} />} onClick={() => void refreshSettings()}>{uiText("Tentar de novo")}</Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {!view.active && <ol className="sk-ai-steps" aria-label={uiText('Etapas para conectar a IA')}><li>{uiText('1. Escolha um provedor')}</li><li>{uiText('2. Salve sua chave')}</li><li>{uiText('3. Teste a conexão')}</li></ol>}
      <div className="sk-ai-summary flex items-center gap-3 pb-1">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: view.active ? 'var(--sk-diff-added)' : 'var(--sk-diff-changed)', boxShadow: `0 0 0 4px color-mix(in srgb, ${view.active ? 'var(--sk-diff-added)' : 'var(--sk-diff-changed)'} 18%, transparent)` }} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-body font-medium">{view.active ? uiText("IA ativa via {0}", [PROVIDER[view.active].name]) : uiText("IA desativada")}</span>
          <span className="text-caption text-muted">{view.active ? uiText("Padrão do app. No chat você pode escolher outra conexão por conversa.") : uiText("Sem chave, o compositor usa as regras locais (modo offline).")}</span>
        </div>
      </div>
      <div className="sk-ai-connections">
      <div className="flex flex-col gap-2">
        <div className="text-caption font-medium text-muted">{uiText("Conexões")}</div>
        <p className="text-caption text-muted">{uiText("Escolha um serviço para configurar.")}</p>
        <div className="sk-provider-list" role="group" aria-label={uiText("Provedores de IA")}>
          {(['openrouter', 'opencodego', 'opencode', 'anthropic', 'openai', ...COMPATIBLE_PROVIDER_IDS] as const).map((id) => {
            const meta = PROVIDER[id];
            const connected = view.providers[id]?.configured;
            return <button key={id} type="button" aria-label={uiText("Configurar {0}", [meta.name])} aria-pressed={selection === id} onClick={() => settingsStore.setState({ editingProvider: id })} className={`sk-provider-choice ${selection === id ? 'is-selected' : ''}`}>
              <span className="sk-provider-choice-mark flex h-7 w-7 items-center justify-center rounded-control bg-panel-3 font-mono text-caption font-medium text-ink"><ProviderLogo id={id} size={21} /></span>
              <span className="min-w-0"><span className="block text-caption font-medium">{meta.name}</span>
              <span className="block text-meta text-muted">{view.active === id ? uiText("Em uso") : connected ? uiText("Conectado") : uiText("Adicionar conexão")}</span></span>
            </button>;
          })}
        </div>
      </div>
      <div className="sk-provider-detail" key={selection}>
      {selection !== 'openai' && <ProviderCard key={selection} id={selection} view={view} active={view.active === selection} />}
      {selection === 'openai' && <><OpenAiCard key={selection} view={view} active={view.active === 'openai'} />{view.providers.openai.configured && view.active !== 'openai' && <Button disabled={saving} onClick={() => void saveSettings({ provider: 'openai' })}>{uiText("Usar este provedor")}</Button>}</>}
      </div>
      </div>
      <p className="sk-settings-key-note flex items-start gap-2 text-caption leading-relaxed text-muted">
        <Lock size={13} className="mt-0.5 flex-none" />{uiText("As chaves vão uma vez para o servidor local e ficam em ~/.config/strukt/settings.json (só você lê). Nunca voltam para o navegador, nem vão para o repositório ou o .arch/.")}</p>
    </div>
  );
}
