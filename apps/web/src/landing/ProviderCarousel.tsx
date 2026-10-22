import { appUrl } from '../ui/urls';
import { getLocale, uiText } from '../i18n';
import { useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { ProviderId } from '../settings/client';
import { ProviderLogo } from '../settings/ProviderLogo';
const PROVIDERS: { id: ProviderId; name: string }[] = [
  { id: 'openai', name: 'OpenAI' }, { id: 'anthropic', name: 'Anthropic' },
  { id: 'gemini', name: 'Google Gemini' }, { id: 'deepseek', name: 'DeepSeek' },
  { id: 'groq', name: 'Groq' }, { id: 'mistral', name: 'Mistral AI' },
  { id: 'openrouter', name: 'OpenRouter' }, { id: 'opencodego', name: 'OpenCode Go' }, { id: 'opencode', name: 'OpenCode Zen' },
];
export function ProviderCarousel() {
  const [paused, setPaused] = useState(false);
  return <section className="provider-strip" aria-labelledby="providers-title">
    <div className="provider-strip-heading"><h3 id="providers-title">{uiText("Seu modelo. Seu provedor. Sua escolha.")}</h3><button type="button" className="provider-motion" aria-label={paused ? uiText("Retomar carrossel de provedores") : uiText("Pausar carrossel de provedores")} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}</button></div>
    <div className="provider-window" data-paused={paused || undefined}>
      <div className="provider-conveyor">{[false, true].map(copy => <ul className="provider-track" key={String(copy)} aria-label={copy ? undefined : uiText("Provedores de IA disponíveis")} aria-hidden={copy || undefined}>
        {PROVIDERS.map(({ id, name }) => <li key={id}><ProviderLogo id={id} size={30} /><span>{name}</span></li>)}
      </ul>)}</div>
    </div>
    <p className="provider-caption">{uiText("Conecte sua chave nas configurações. Também funciona com Ollama, LM Studio e APIs compatíveis com OpenAI.")}</p>
    <a data-analytics-cta="demo" className="text-link" href={appUrl(`?settings=ai&lang=${getLocale()}`)}>{uiText("Escolha sua conexão")} <Play size={13} aria-hidden /></a>
  </section>;
}
