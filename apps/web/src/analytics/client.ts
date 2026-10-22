/** Optional first-party analytics. No content, titles, paths, URLs or credentials enter this API. */
export type AnalyticsEvent = 'page_view' | 'editor_ready' | 'editor_activity' | 'editor_edited' | 'export_generated' | 'workspace_limit_viewed';
export type Consent = 'allowed' | 'declined' | null;
const KEY = 'joinlet:analytics:v1';
const TTL = 90 * 86400000;
type Preference = { consent: Exclude<Consent, null>; visitor?: string; expires: number };
const listeners = new Set<() => void>();
let ready = false;
let initialized = false;
let lastInput = 0;
let lastActivity = 0;
let lastEdit = 0;
const once = new Set<string>();

export function analyticsEnabled(): boolean {
  return typeof document !== 'undefined' && document.querySelector('meta[name="joinlet-analytics"]')?.getAttribute('content') === '/telemetry';
}
function blocked(): boolean {
  return typeof navigator !== 'undefined' && (navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true);
}
function preference(): Preference | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!value || value.expires <= Date.now() || !['allowed', 'declined'].includes(value.consent)) return null;
    if (value.consent === 'allowed' && !/^[0-9a-f-]{36}$/.test(value.visitor)) return null;
    return value;
  } catch { return null; }
}
export function analyticsConsent(): Consent { return blocked() ? 'declined' : preference()?.consent ?? null; }
export function subscribeAnalytics(callback: () => void): () => void { listeners.add(callback); return () => listeners.delete(callback); }
const notify = () => listeners.forEach(callback => callback());
export function setAnalyticsConsent(consent: Exclude<Consent, null>): void {
  try {
    const current = preference();
    localStorage.setItem(KEY, JSON.stringify({ consent, expires: Date.now() + TTL, ...(consent === 'allowed' ? { visitor: current?.visitor ?? crypto.randomUUID() } : {}) }));
  } catch { return; }
  once.clear(); lastActivity = 0; lastEdit = 0;
  notify();
  if (consent === 'allowed') { trackAnalytics('page_view', true); if (ready) trackAnalytics('editor_ready', true); }
}
export function trackAnalytics(event: AnalyticsEvent, single = false): void {
  try {
    if (!analyticsEnabled() || blocked() || document.visibilityState === 'hidden') return;
    const pref = preference();
    if (pref?.consent !== 'allowed' || !pref.visitor || (single && once.has(event))) return;
    const source = document.querySelector('meta[name="joinlet-analytics-source"]')?.getAttribute('content') === 'editor' ? 'editor' : 'site';
    let referrer = 'direct';
    try {
      const host = new URL(document.referrer).hostname.replace(/^www\./, '');
      referrer = ['github.com', 'google.com', 'linkedin.com', 'reddit.com', 'bing.com', 'joinlet.co', 'app.joinlet.co'].includes(host) ? host : 'other';
    } catch { /* Empty referrer is direct traffic. */ }
    if (single) once.add(event);
    void fetch('/telemetry', {
      method: 'POST', credentials: 'omit', cache: 'no-store', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, visitor: pref.visitor, source, referrer }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  } catch { /* Analytics must never interrupt editing or persistence. */ }
}
export function analyticsEditorReady(): void { ready = true; trackAnalytics('editor_ready', true); }
export function analyticsEdit(): void {
  if (!ready || Date.now() - lastInput > 10000 || Date.now() - lastEdit < 60000) return;
  lastEdit = Date.now(); trackAnalytics('editor_edited');
}
export function startAnalytics(): void {
  if (initialized || !analyticsEnabled()) return;
  initialized = true;
  trackAnalytics('page_view', true);
  const interaction = (event: Event) => { if (event.isTrusted) lastInput = Date.now(); };
  document.addEventListener('pointerdown', interaction, { passive: true });
  document.addEventListener('keydown', interaction, { passive: true });
  window.addEventListener('storage', notify);
  setInterval(() => {
    if (ready && document.visibilityState === 'visible' && Date.now() - lastInput < 60000 && Date.now() - lastActivity >= 60000) {
      lastActivity = Date.now(); trackAnalytics('editor_activity');
    }
  }, 15000);
}
