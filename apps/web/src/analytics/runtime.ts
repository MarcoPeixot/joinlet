import { analyticsEnabled,analyticsConsent,blocked,preference,remember,notify,meta,KEY,consentRequest,choice } from './preferences';
import type { AnalyticsEvent,AnalyticsDetails,Consent } from './client';
let ready=false,initialized=false,lastInput=0,lastActivity=0,lastEdit=0,generation=0;
let pendingEdit: AnalyticsDetails['kind']|null=null;
let chain:Promise<unknown>=Promise.resolve();
const once=new Set<string>();
async function request(path:string,body?:unknown):Promise<Response>{return fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',keepalive:body!==undefined,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(3000)});}
export function onConsentChanged(): void {
  generation++; once.clear(); pendingEdit = null; lastActivity = 0; lastEdit = 0;
  notify();
  chain = chain.catch(() => {}).then(consentRequest);
  if (analyticsConsent() === 'allowed') { trackAnalytics('page_view', true); if (ready) trackAnalytics('editor_ready', true); }
}
const referrers = ['github.com', 'google.com', 'linkedin.com', 'reddit.com', 'bing.com', 'joinlet.co', 'app.joinlet.co', 't.co', 'x.com', 'news.ycombinator.com'];
function context() {
  const source = meta('joinlet-analytics-source') === 'editor' ? 'editor' : 'site';
  let referrer = 'direct';
  try { const host = new URL(document.referrer).hostname.replace(/^www\./, ''); referrer = referrers.includes(host) ? host : 'other'; } catch { /* Unavailable referrer. */ }
  const query = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const token = (key: string) => { const v = query.get(key) ?? ''; return /^[a-z0-9][a-z0-9_-]{0,47}$/.test(v) ? v : ''; };
  return { source, referrer, page: source === 'editor' ? 'editor' : document.body?.dataset.analyticsGuide ? 'docs' : 'landing',
    guide: document.body?.dataset.analyticsGuide ?? '', language: document.documentElement?.lang === 'pt-BR' ? 'pt-BR' : 'en',
    utm_source: token('utm_source'), utm_medium: token('utm_medium'), utm_campaign: token('utm_campaign') };
}
export function trackAnalytics(event: AnalyticsEvent, single = false, details: AnalyticsDetails = {}): void {
  try {
    if (!analyticsEnabled() || blocked() || document.visibilityState === 'hidden' || analyticsConsent() !== 'allowed' || (single && once.has(event))) return;
    const pref = preference(); if (!pref?.visitor) return;
    if (single) once.add(event);
    const revision = generation;
    const body = { version: 2, event_id: crypto.randomUUID(), event, visitor: pref.visitor, ...context(), ...details };
    chain = chain.catch(() => {}).then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (revision !== generation || analyticsConsent() !== 'allowed') return;
        try { const response = await request('/telemetry', body); if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) return; } catch { /* Same event ID on retry. */ }
      }
    });
  } catch { /* Telemetry cannot interrupt work. */ }
}
export function analyticsEditorReady(): void { ready = true; trackAnalytics('editor_ready', true); }
export function analyticsEdit(kind: AnalyticsDetails['kind'] = 'diagram', meaningful = true): void {
  if (!ready || Date.now() - lastInput > 10000 || !meaningful) return;
  pendingEdit = kind;
  if (Date.now() - lastEdit < 60000) return;
  lastEdit = Date.now(); trackAnalytics('editor_edited', false, { kind });
}
/** Called only for a completed saver batch, never for cancellation or initial seed. */
export function analyticsSave(status: 'saved' | 'error'): void {
  if (!pendingEdit) return;
  if (status === 'error') { trackAnalytics('save_failed', false, { kind: pendingEdit }); return; }
  const kind = pendingEdit; pendingEdit = null;
  trackAnalytics('content_saved', false, { kind });
}
export function analyticsWorkspaceChanged(): void { pendingEdit = null; }
export async function startAnalytics(): Promise<void> {
  if (initialized || !analyticsEnabled()) return;
  initialized = true;
  const initialGeneration = generation,initialChoice=choice.revision;
  if (!blocked()) {
    try {
      const response = await request('/telemetry/consent');
      const state = await response.json();
      if (initialGeneration !== generation || initialChoice !== choice.revision) { /* A choice made during the request takes priority. */ }
      else if (response.ok && state.version === 2 && ['allowed', 'declined'].includes(state.consent) && !(preference()?.consent === 'declined' && state.consent === 'allowed')) { remember(state.consent); notify(); }
      else if (preference()?.consent === 'allowed' && state.consent !== 'allowed') { localStorage.removeItem(KEY); notify(); }
    } catch { /* No new consent is inferred from an unavailable service. */ }
  }
  trackAnalytics('page_view', true);
  if (ready) trackAnalytics('editor_ready', true);
  const interaction = (event: Event) => { if (event.isTrusted) lastInput = Date.now(); };
  document.addEventListener('pointerdown', interaction, { passive: true });
  document.addEventListener('keydown', interaction, { passive: true });
  document.addEventListener('click', event => {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-analytics-cta]') : null;
    if (anchor) trackAnalytics('editor_cta_clicked', false, { placement: anchor.dataset.analyticsCta as AnalyticsDetails['placement'] });
  });
  window.addEventListener('storage', () => { generation++; notify(); });
  window.addEventListener('focus', () => {
    if (blocked()) return;
    void request('/telemetry/consent').then(r => r.json()).then(state => {
      if (state.version === 2 && state.consent === 'declined') { remember('declined'); generation++; pendingEdit = null; notify(); }
    }).catch(() => {});
  });
  setInterval(() => {
    if (ready && document.visibilityState === 'visible' && Date.now() - lastInput < 60000 && Date.now() - lastActivity >= 60000) {
      lastActivity = Date.now(); trackAnalytics('editor_activity');
    }
  }, 15000);
}
