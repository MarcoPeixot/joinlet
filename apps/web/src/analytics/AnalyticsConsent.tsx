import { useState, useSyncExternalStore } from 'react';
import { uiText } from '../i18n';
import { analyticsConsent, analyticsEnabled, setAnalyticsConsent, subscribeAnalytics } from './client';
import './analytics.css';

export function AnalyticsConsent() {
  const consent = useSyncExternalStore(subscribeAnalytics, analyticsConsent, () => null);
  const [expanded, setExpanded] = useState(false);
  if (!analyticsEnabled()) return null;
  return <aside className="joinlet-privacy" aria-label={uiText('Privacidade de uso')}>
    {consent === null || expanded ? <section className="joinlet-privacy-card">
      <strong>{uiText('Ajude a melhorar o Joinlet')}</strong>
      <p>{uiText('Permitir métricas de visitas, edições e exportações? O conteúdo dos seus projetos, nomes e prompts não é enviado. Usamos um identificador aleatório neste navegador por até 90 dias para medir retornos.')}</p>
      <p>{uiText('Você pode mudar sua escolha em Privacidade. Recusar mantém todos os recursos disponíveis.')}</p>
      <div><button type="button" onClick={() => { setAnalyticsConsent('declined'); setExpanded(false); }}>{uiText('Recusar métricas')}</button><button type="button" onClick={() => { setAnalyticsConsent('allowed'); setExpanded(false); }}>{uiText('Permitir métricas')}</button></div>
    </section> : <button className="joinlet-privacy-toggle" type="button" onClick={() => setExpanded(true)}>{uiText('Privacidade')}</button>}
  </aside>;
}
