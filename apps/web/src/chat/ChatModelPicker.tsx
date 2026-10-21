import { uiText } from '../i18n';
import { COMPATIBLE_PROVIDER_IDS, isCompatibleProvider, readChatModel } from '@strukt/core';
import type { ChatModelChoice } from '@strukt/core';
import { Check, ChevronDown, LoaderCircle, Search, Settings2, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { settingsApi } from '../settings/client';
import type { OpenRouterModel, ProviderId } from '../settings/client';
import { PROVIDER } from '../settings/providers';
import { openSettings, refreshSettings, useSettings } from '../settings/store';
import { Popover } from '../ui/Popover';
import { inputClass } from '../ui/controls';
import { chatStore, useChat } from './session';

const PROVIDERS: ProviderId[] = ['opencodego', 'openrouter', 'anthropic', 'opencode', 'openai', ...COMPATIBLE_PROVIDER_IDS];
const shortName = (id: string) => id === 'openrouter/auto' ? uiText("Automático") : id.split('/').at(-1)!;

export function ChatModelPicker({ disabled }: { disabled: boolean }) {
  const view = useSettings(s => s.view);
  const settingsError = useSettings(s => s.error);
  const choice = useChat(s => s.modelChoice);
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderId>('opencodego');
  const [query, setQuery] = useState('');
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => { void refreshSettings(); }, []);
  useEffect(() => {
    if (!open || !view?.providers[provider]?.configured) { setModels([]); return; }
    let current = true;
    setLoading(true); setError(null); setModels([]);
    const load = isCompatibleProvider(provider) ? () => settingsApi.compatibleModels(provider) : provider === 'anthropic' ? settingsApi.anthropicModels : provider === 'openrouter' ? settingsApi.models : provider === 'opencodego' ? settingsApi.openCodeGoModels : provider === 'opencode' ? settingsApi.openCodeModels : settingsApi.openAiModels;
    void load().then(result => {
      if (!current) return;
      setLoading(false);
      if (!result.ok) { setError(result.error); return; }
      setModels(result.value.models.map(model => typeof model === 'string' ? { id: model, name: model, context: 0 } : model));
    });
    return () => { current = false; };
  }, [open, provider, view?.providers[provider]?.configured, view?.providers[provider]?.hint, view?.openai.baseUrl, reload]);
  const active = choice?.provider ?? view?.active;
  const defaultModel = active && active !== 'anthropic' ? view?.models[active]?.edit : undefined;
  const label = choice?.model ?? defaultModel;
  const selected = choice?.provider === provider ? choice.model : provider !== 'anthropic' ? view?.models[provider]?.edit : undefined;
  const all = [...models];
  if (selected && !all.some(m => m.id === selected)) all.unshift({ id: selected, name: selected, context: 0 });
  const filtered = all.filter(m => `${m.id} ${m.name}`.toLowerCase().includes(query.toLowerCase())).slice(0, 80);
  const pick = (selection: ChatModelChoice | null) => { chatStore.getState().setModelChoice(selection); setOpen(false); };
  const configure = () => { setOpen(false); openSettings('ai', provider); };
  return <Popover label={uiText("Modelo e provider do chat")} side="top" align="start" open={open} onOpenChange={next => {
    setOpen(next); setQuery(''); setError(null);
    if (next) { setProvider(choice?.provider ?? view?.active ?? 'opencodego'); void refreshSettings(); }
  }} trigger={<button type="button" disabled={disabled} aria-label={uiText("Modelo e provider: {0} · {1}", [active ? PROVIDER[active].name : uiText("não configurado"), label ?? uiText("padrão do app")])} className="sk-chat-model-trigger" title={active ? `${PROVIDER[active].name} · ${label ?? uiText("Padrão do app")}` : uiText("Escolher modelo e provider")}>
    <Sparkles size={13} /><span className="truncate">{label ? shortName(label) : active ? uiText("Modelo padrão") : uiText("Escolher modelo")}</span><ChevronDown size={12} />
  </button>}>
    <div className="sk-chat-model-popover">
      <div className="px-3 pb-2 pt-3"><h3 className="text-caption font-medium">{uiText("Modelo desta conversa")}</h3><p className="mt-1 text-meta text-muted">{uiText("A escolha vale para as próximas mensagens.")}</p></div>
      <div className="px-3 pb-2"><select aria-label={uiText("Provider do chat")} className={`${inputClass} h-9`} value={provider} onChange={e => { setProvider(e.target.value as ProviderId); setQuery(''); setError(null); }}>{PROVIDERS.map(id => <option key={id} value={id}>{PROVIDER[id].name}{view?.providers[id]?.configured ? '' : ' · conectar'}</option>)}</select></div>
      {view?.providers[provider]?.configured ? <>
        <label className="mx-3 mb-2 flex items-center gap-2 rounded-control bg-panel-2 px-2.5"><Search size={13} className="text-muted" /><input aria-label={uiText("Buscar modelo do chat")} placeholder={uiText("Buscar modelo ou informar ID…")} className="h-9 min-w-0 flex-1 bg-transparent text-caption outline-none" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <div className="sk-chat-model-list" role="group" aria-label={uiText("Modelos disponíveis")}>
          {loading && <p role="status" className="flex items-center gap-2 px-3 py-4 text-caption text-muted"><LoaderCircle size={13} className="animate-spin" />{uiText("Carregando modelos…")}</p>}
          {error && <div className="px-3 py-2 text-caption text-muted"><p role="status">{error}</p><button type="button" className="mt-2 text-accent" onClick={() => setReload(n => n + 1)}>{uiText("Tentar novamente")}</button></div>}
          {filtered.map(model => <button type="button" key={model.id} aria-pressed={selected === model.id} onClick={() => pick({ provider, model: model.id })} className="sk-chat-model-option"><span className="min-w-0 flex-1"><span className="block truncate text-caption">{shortName(model.name)}</span><span className="block truncate text-meta text-muted">{model.id}</span></span>{selected === model.id && <Check size={14} className="text-accent" />}</button>)}
          {!loading && !filtered.length && !error && <p className="px-3 py-3 text-caption text-muted">{uiText("Nenhum modelo encontrado.")}</p>}
          {['anthropic', 'openrouter', 'openai'].includes(provider) && readChatModel({ provider, model: query.trim() }) && !all.some(m => m.id === query.trim()) && <button type="button" className="sk-chat-model-option text-accent" onClick={() => pick({ provider, model: query.trim() })}><span className="truncate">{uiText("Usar ID:")} {query.trim()}</span></button>}
        </div>
      </> : <div className="px-4 py-5"><p className="text-caption text-muted">{!view ? settingsError ?? uiText("Carregando conexões…") : uiText("Conecte {0} para usar seus modelos.", [PROVIDER[provider].name])}</p><button type="button" className="mt-3 text-caption text-accent" onClick={configure}>{uiText("Configurar conexão")}</button></div>}
      <div className="mt-1 space-y-1 border-t border-line p-2"><button type="button" className="sk-chat-model-option text-muted" onClick={() => pick(null)}>{uiText("Usar padrão do app")}{!choice && <Check size={13} />}</button><button type="button" className="sk-chat-model-option text-muted" onClick={configure}><Settings2 size={13} />{uiText("Gerenciar providers e modelos")}</button></div>
    </div>
  </Popover>;
}
