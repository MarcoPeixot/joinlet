import type { Consent } from './client';
export const KEY = 'joinlet:analytics:v2', OLD_KEY = 'joinlet:analytics:v1';
const TTL = 90 * 86400000;
type Preference = { consent: Exclude<Consent, null>; visitor?: string; expires: number };
const listeners = new Set<() => void>();
export const meta = (name: string) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content');
export function analyticsEnabled(): boolean { return typeof document !== 'undefined' && meta('joinlet-analytics') === '/telemetry'; }
export function blocked(): boolean { return typeof navigator !== 'undefined' && (navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true); }
export function preference(): Preference | null {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return p && p.expires > Date.now() && ['allowed', 'declined'].includes(p.consent) ? p : null; } catch { return null; }
}
export function analyticsConsent(): Consent { return blocked() ? 'declined' : preference()?.consent ?? null; }
export function subscribeAnalytics(callback: () => void): () => void { listeners.add(callback); return () => listeners.delete(callback); }
export const notify = () => listeners.forEach(callback => callback());
export function remember(consent: Exclude<Consent, null>): void {
  const current = preference();
  localStorage.removeItem(OLD_KEY);
  localStorage.setItem(KEY, JSON.stringify({ consent, expires: Date.now() + TTL, ...(consent === 'allowed' ? { visitor: current?.visitor ?? crypto.randomUUID() } : {}) }));
}

export const choice={revision:0};
let pendingConsent:Promise<unknown>=Promise.resolve();
/** Start consent writes in the click handler, before navigation can unload the page. */
export function registerConsent(consent:Exclude<Consent,null>):void {
  choice.revision++;
  pendingConsent=fetch('/telemetry/consent',{method:'POST',credentials:'same-origin',cache:'no-store',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({version:2,consent}),signal:AbortSignal.timeout(3000)}).catch(()=>{});
}
export const consentRequest=()=>pendingConsent;
