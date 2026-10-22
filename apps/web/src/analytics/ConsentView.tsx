import { analyticsNotice } from './copy';
import { useState, useSyncExternalStore } from 'react';
import { uiText, getLocale } from '../i18n';
import { analyticsConsent, analyticsEnabled, setAnalyticsConsent, subscribeAnalytics } from './client';
import './analytics.css';

export function AnalyticsConsent() {
  const consent = useSyncExternalStore(subscribeAnalytics, analyticsConsent, () => null);
  const [expanded, setExpanded] = useState(false);
  if (!analyticsEnabled()) return null;
  return <aside className="joinlet-privacy" aria-label={uiText('Privacidade de uso')}>
    {consent === null || expanded ? <section className="joinlet-privacy-card">
      <strong>{uiText('Ajude a melhorar o Joinlet')}</strong>
      <p>{analyticsNotice[getLocale()]}</p>
      <p>{uiText('Você pode mudar sua escolha em Privacidade. Recusar mantém todos os recursos disponíveis.')}</p>
      <div><button type="button" onClick={() => { setAnalyticsConsent('declined'); setExpanded(false); }}>{uiText('Recusar métricas')}</button><button type="button" onClick={() => { setAnalyticsConsent('allowed'); setExpanded(false); }}>{uiText('Permitir métricas')}</button></div>
    </section> : <button className="joinlet-privacy-toggle" type="button" onClick={() => setExpanded(true)}>{uiText('Privacidade')}</button>}
  </aside>;
}
