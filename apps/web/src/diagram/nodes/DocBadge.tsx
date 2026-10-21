import { uiText } from '../../i18n';
import { diagramSlugOf, docSlugOf } from '@strukt/workspace';
import { FileText, Link2, PanelsTopLeft } from 'lucide-react';
import { openDiagramLink, openDocLink } from '../../workspace/actions';
import { pluralize } from '../../ui/plural';
import { useUi } from '../../ui/uiStore';

/** Corner badge on elements with `link: "doc:<slug>"`; clicking opens the doc. */
export function DocBadge({ link, evidenceCount = 0 }: { link?: string; evidenceCount?: number }) {
  const presenting = useUi((s) => s.presenting);
  return <DocBadgeView link={link} evidenceCount={evidenceCount} presenting={presenting} />;
}

/** While presenting the drill-down is hidden: a diagram switch would leave the mode mid-talk. */
export function DocBadgeView({ link, evidenceCount = 0, presenting = false }: { link?: string; evidenceCount?: number; presenting?: boolean }) {
  const diagram = diagramSlugOf(link);
  if (!docSlugOf(link) && !diagram && !evidenceCount) return null;
  return (
    <>
    {evidenceCount > 0 && <span className="strukt-doc-badge" style={{ right: diagram || docSlugOf(link) ? 16 : -9 }} title={uiText("{0} no código; verifique com joinlet check", [pluralize(evidenceCount, uiText("evidência"), uiText("evidências"), 'f')])} aria-label={uiText("{0} no código", [pluralize(evidenceCount, uiText("evidência"), uiText("evidências"), 'f')])}><Link2 size={12} /></span>}
    {(diagram || docSlugOf(link)) && !presenting &&
    <button
      type="button"
      className="strukt-doc-badge nodrag nopan"
      title={diagram ? uiText("Abrir diagrama detalhado") : uiText("Abrir documento")}
      aria-label={diagram ? uiText("Abrir diagrama detalhado") : uiText("Abrir documento")}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        void (diagram ? openDiagramLink(link) : openDocLink(link));
      }}
    >
      {diagram ? <PanelsTopLeft size={12} /> : <FileText size={12} />}
    </button>}
    </>
  );
}
