/** Optional telemetry stays off the initial editor path until the operator enables it. */
export const ANALYTICS_VERSION = 2;
export type AnalyticsEvent = 'page_view' | 'editor_ready' | 'editor_activity' | 'editor_edited' | 'content_saved' | 'save_failed' | 'editor_failed' | 'workspace_reopened' | 'export_generated' | 'export_failed' | 'workspace_limit_viewed' | 'editor_cta_clicked';
export type Consent = 'allowed' | 'declined' | null;
export type AnalyticsDetails = { format?: 'zip' | 'png' | 'svg' | 'mermaid' | 'plantuml'; placement?: 'header' | 'hero' | 'demo' | 'footer' | 'docs-header' | 'docs-footer'; kind?: 'diagram' | 'doc' | 'sketch'; duration?: number };
import {analyticsEnabled,analyticsConsent,subscribeAnalytics,remember,blocked,notify,registerConsent} from './preferences';
export {analyticsEnabled,analyticsConsent,subscribeAnalytics};
type Runtime=typeof import('./runtime');
function call<K extends keyof Runtime>(name:K,...args:Parameters<Runtime[K]>):void {
  if(!analyticsEnabled())return;
  void import('./runtime').then(r=>(r[name] as (...args:Parameters<Runtime[K]>)=>unknown)(...args)).catch(()=>{});
}
export function setAnalyticsConsent(consent:Exclude<Consent,null>):void {
  try{remember(blocked()?'declined':consent);notify();}catch{return;}
  if(analyticsEnabled())registerConsent(analyticsConsent()??'declined');
  call('onConsentChanged');
}
export function trackAnalytics(event:AnalyticsEvent,single=false,details:AnalyticsDetails={}):void{call('trackAnalytics',event,single,details);}
export function analyticsEditorReady():void{call('analyticsEditorReady');}
export function analyticsEdit(kind:AnalyticsDetails['kind']='diagram',meaningful=true):void{call('analyticsEdit',kind,meaningful);}
export function analyticsSave(status:'saved'|'error'):void{call('analyticsSave',status);}
export function analyticsWorkspaceChanged():void{call('analyticsWorkspaceChanged');}
export async function startAnalytics():Promise<void>{if(analyticsEnabled())await import('./runtime').then(r=>r.startAnalytics()).catch(()=>{});}
