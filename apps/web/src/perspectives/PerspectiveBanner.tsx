import { localizedPerspectives } from '../i18n/perspectives';
import { uiText } from '../i18n';
import { allPerspectives } from '@strukt/workspace';
import { Eye, X } from 'lucide-react';
import { useEffect } from 'react';
import { useUi } from '../ui/uiStore';
import { useWorkspace } from '../workspace/appWorkspace';
import { perspectivesFor } from '../workspace/lookup';
import { setActivePerspective } from './read';
import './engine';

/** While a perspective is applied: what it is, how much of the diagram it shows, and the way out. */
export function PerspectiveBanner() {
  const active = useUi((s) => s.activePerspective);
  const slug = useWorkspace((s) => s.diagram);
  const saved = useWorkspace((s) => perspectivesFor(s.data, s.diagram));
  const read = useUi((s) => s.perspectiveRead);
  const here = active && active.diagram === slug ? active : null;
  const exists = !!here && localizedPerspectives(saved).some((item) => item.id === here.id);
  // A perspective deleted under the viewer (another tab, a guest, git) is not read any more: leave it.
  useEffect(() => {
    if (here && !exists) setActivePerspective(here.diagram, null);
  }, [here, exists]);
  if (!here || !exists) return null;
  const counts = read?.view.counts;
  return (
    <div role="status" className="sk-float absolute left-16 top-[calc(var(--sk-header-height)+12px)] z-20 flex max-w-[calc(100%-5rem)] items-center gap-2 rounded-control py-1 pl-3 pr-1 text-caption max-sm:left-1/2 max-sm:top-[152px] max-sm:max-w-[calc(100%-24px)] max-sm:-translate-x-1/2">
      <Eye size={14} className="shrink-0 text-accent" />
      <span className="min-w-0 truncate">
        <span className="font-medium">{read?.perspective.name ?? here.name}</span>
        {counts && <span className="ml-2 text-muted">{counts.shown} {uiText("de")} {counts.total} {uiText("componentes")}</span>}
      </span>
      <span className="hidden shrink-0 text-faint sm:inline">{uiText("visão de leitura")}</span>
      <button type="button" aria-label={uiText("Sair da perspectiva")} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-muted hover:bg-panel-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent" onClick={() => setActivePerspective(here.diagram, null)}>
        <X size={12} /> {uiText("Sair")}</button>
    </div>
  );
}
