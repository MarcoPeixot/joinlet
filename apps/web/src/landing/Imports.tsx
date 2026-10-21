import { uiText } from '../i18n';
export const IMPORT_SOURCES: readonly { name: string; note: string }[] = [
  { name: 'Terraform', note: uiText("recursos e dependências") },
  { name: 'Kubernetes', note: uiText("workloads e serviços; Secret só pelo nome") },
  { name: 'OpenAPI', note: uiText("serviço e rotas") },
  { name: 'D2', note: uiText("subconjunto") },
  { name: 'Mermaid', note: uiText("subconjunto") },
  { name: 'LikeC4', note: uiText("subconjunto") },
  { name: 'Structurizr', note: uiText("subconjunto") },
];

/** Supported import formats, with their subset scope retained for the page content. */
export function Imports() {
  return (
    <section className="imports" id="importa" aria-labelledby="imports-title">
      <h2 id="imports-title" className="kicker imports-title">{uiText("Importa de")}</h2>
      <div className="marquee">
        {[false, true].map((copy) => (
          <ul key={String(copy)} className="marquee-track" aria-hidden={copy || undefined}>
            {IMPORT_SOURCES.map((source) => <li key={source.name}><strong>{source.name}</strong><span>{source.note}</span></li>)}
          </ul>
        ))}
      </div>
      <p className="imports-note">{uiText("São importações de subconjuntos: o que não entra é avisado na hora.")}</p>
    </section>
  );
}
