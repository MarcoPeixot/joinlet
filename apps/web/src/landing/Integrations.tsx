import { uiText } from '../i18n';
import { siConfluence, siGithub, siJira, siNotion } from '../brand/integrationMarks';

/** Only integrations available in the product belong here. */
export function Integrations() {
  return <section className="integrations-strip wrap" aria-label={uiText("Integrações disponíveis")}>
    <p className="kicker">{uiText("Conectado ao seu jeito de trabalhar")}</p>
    <ul>{[siGithub, siNotion, siConfluence, siJira].map(icon => <li key={icon.slug}><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d={icon.path} /></svg><span>{icon.title}</span></li>)}</ul>
    <p className="integration-note">{uiText("Conecte suas contas nas configurações do workspace.")}</p>
  </section>;
}
