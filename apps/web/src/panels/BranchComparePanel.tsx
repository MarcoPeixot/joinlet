import { uiText } from '../i18n';
import { GitCompareArrows } from 'lucide-react';
import { branchCompareStore, useBranchCompare } from '../github/compare';
import { PanelHeader, PanelSection, SidePanel } from '../ui/Panel';
import { changeLines } from '../versions/restore';
import { pluralize } from '../ui/plural';

const COLORS = { added: 'var(--sk-diff-added)', removed: 'var(--sk-diff-removed)', changed: 'var(--sk-diff-changed)' } as const;

export function BranchComparePanel() {
  const ref = useBranchCompare((state) => state.ref);
  const preview = useBranchCompare((state) => state.preview);
  const details = useBranchCompare((state) => state.details);
  if (!preview) return null;
  const lines = changeLines(preview);
  return <SidePanel label={uiText("Comparação com Git")}>
    <PanelHeader icon={<GitCompareArrows size={14} />} title={uiText("Comparar com Git")} subtitle={ref ?? undefined} onClose={() => branchCompareStore.getState().stop()} closeLabel={uiText("Encerrar comparação")} />
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PanelSection title={pluralize(lines.length, uiText("mudança"), uiText("mudanças"), 'f')}>
        <p className="text-caption text-muted">{uiText("Verde: no diagrama atual. Vermelho: na ref. Âmbar: alterado.")}</p>
        {lines.map((line, index) => <div key={`${index}:${line.text}`} className="flex gap-2 text-caption" style={{ color: COLORS[line.kind] }}>
          <span aria-hidden>{line.kind === 'added' ? "+" : line.kind === 'removed' ? '−' : '●'}</span>
          <span>{line.text}</span>
        </div>)}
        {lines.length === 0 && <p className="text-caption text-muted">{uiText("Sem diferença semântica neste diagrama.")}</p>}
      </PanelSection>
      {details.length > 0 && <PanelSection title={uiText("Modelo e fluxos")}>
        {details.map((detail) => <p key={detail} className="text-caption text-muted">{detail}</p>)}
      </PanelSection>}
    </div>
  </SidePanel>;
}
