import { uiText } from '../i18n';
export type JoPhase = 'thinking' | 'searching' | 'writing' | 'applying';
const LABELS: Record<JoPhase, string> = { thinking: uiText("Jo está pensando"), searching: uiText("Jo está pesquisando"), writing: uiText("Jo está preparando a resposta"), applying: uiText("Jo está aplicando as alterações") };
/** Activity is driven by the actual request lifecycle; never a simulated progress counter. */
export function JoActivity({ phase, detail }: { phase: JoPhase; detail?: string }) {
  return <div className="sk-jo-activity" data-phase={phase} role="status">
    <div className="sk-jo-image" aria-hidden="true"><img src="/brand/jo-curious-v2.webp" width="1536" height="1024" alt="" /></div>
    <div><p>{LABELS[phase]}</p>{detail && <span className="sk-jo-detail" title={detail}>{detail}</span>}</div>
  </div>;
}
