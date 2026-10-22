import { analyticsNotice } from './copy';
import { analyticsConsent, analyticsEnabled, setAnalyticsConsent, startAnalytics, subscribeAnalytics } from './client';
void startAnalytics();
if (analyticsEnabled()) {
  const pt = document.documentElement.lang === 'pt-BR';
  const t = (en: string, br: string) => pt ? br : en;
  const root = document.createElement('aside'); root.className = 'joinlet-privacy'; root.setAttribute('aria-label',t('Usage privacy','Privacidade de uso'));
  let expanded = false;
  const render = () => {
    root.replaceChildren();
    if (analyticsConsent() !== null && !expanded) {
      const toggle = document.createElement('button'); toggle.className = 'joinlet-privacy-toggle'; toggle.textContent = t('Privacy','Privacidade'); toggle.onclick = () => { expanded = true; render(); }; root.append(toggle); return;
    }
    const card = document.createElement('section'); card.className = 'joinlet-privacy-card';
    const title = document.createElement('strong'); title.textContent = t('Help improve Joinlet','Ajude a melhorar o Joinlet');
    const text = document.createElement('p'); text.textContent = analyticsNotice[pt?'pt-BR':'en'];
    const hint = document.createElement('p'); hint.textContent = t('Change your choice in Privacy. Declining keeps every feature available.','Você pode mudar sua escolha em Privacidade. Recusar mantém todos os recursos disponíveis.');
    const actions = document.createElement('div');
    for (const consent of ['declined','allowed'] as const) { const button = document.createElement('button'); button.textContent = consent === 'allowed' ? t('Allow analytics','Permitir métricas') : t('Decline analytics','Recusar métricas'); button.onclick = () => { expanded = false; setAnalyticsConsent(consent); }; actions.append(button); }
    card.append(title,text,hint,actions); root.append(card);
  };
  document.body.append(root); subscribeAnalytics(render); render();
}
