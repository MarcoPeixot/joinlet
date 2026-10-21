import { uiText, getLocale } from '../i18n';
import { impactedBy, modelIndex } from '@strukt/workspace';
import { Boxes, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { inputClass } from '../ui/controls';
import { PanelHeader, PanelSection, SidePanel } from '../ui/Panel';
import { closeRightPanel, uiStore, useUi } from '../ui/uiStore';
import { revealElement } from '../workspace/actions';
import { useWorkspace } from '../workspace/appWorkspace';
import { pluralize } from '../ui/plural';

export function ModelPanel() {
  const data = useWorkspace((state) => state.data);
  const activeTag = useUi((state) => state.activeTag);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const index = useMemo(() => data ? modelIndex(data) : [], [data]);
  const byKey = useMemo(() => new Map(index.map((entry) => [entry.key, entry])), [index]);
  const tags = useMemo(() => [...new Set(index.flatMap((entry) => entry.tags))].sort(), [index]);
  const search = query.trim().toLocaleLowerCase(getLocale());
  const visible = index.filter((entry) => (!activeTag || entry.tags.includes(activeTag)) && (!search || `${entry.label} ${entry.tech ?? ''} ${entry.description ?? ''} ${entry.key}`.toLocaleLowerCase(getLocale()).includes(search)));
  const selected = selectedKey ? byKey.get(selectedKey) : undefined;
  const impacted = selected ? impactedBy(index, selected.key) : [];

  return <SidePanel label={uiText("Modelo de arquitetura")}>
    <PanelHeader icon={<Boxes size={14} />} title={uiText("Modelo")} subtitle={uiText("{0} componentes", [index.length])} onClose={() => closeRightPanel('model')} />
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PanelSection title={uiText("Explorar")}>
        <div className="flex items-center gap-2">
          <Search size={14} className="shrink-0 text-muted" />
          <input aria-label={uiText("Buscar componentes")} className={`${inputClass} min-w-0 flex-1`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText("Nome, tecnologia…")} />
        </div>
        <select aria-label={uiText("Lente de tags")} className={inputClass} value={activeTag ?? ''} onChange={(event) => uiStore.setState({ activeTag: event.target.value || null })}>
          <option value="">{uiText("Todas as perspectivas")}</option>
          {tags.map((tag) => <option key={tag} value={tag}>{tag.replace(':', ' · ')}</option>)}
        </select>
        {tags.length === 0 && <p className="text-caption text-muted">{uiText("Adicione tags a entidades compartilhadas para destacar risco, domínio ou ambiente.")}</p>}
      </PanelSection>
      {selected ? <>
        <PanelSection title={uiText("Componente")}>
          <button type="button" className="text-left text-caption text-accent hover:underline" onClick={() => setSelectedKey(null)}>{uiText("← Voltar à lista")}</button>
          <h3 className="text-title font-semibold">{selected.label}</h3>
          {selected.tech && <p className="text-caption text-muted">{selected.tech}</p>}
          {selected.description && <p className="text-body text-muted">{selected.description}</p>}
          {selected.tags.length > 0 && <div className="flex flex-wrap gap-1">{selected.tags.map((tag) => <button key={tag} type="button" className="rounded-chip bg-accent-soft px-2 py-0.5 text-caption text-accent" onClick={() => uiStore.setState({ activeTag: tag })}>{tag.replace(':', ' · ')}</button>)}</div>}
        </PanelSection>
        <PanelSection title={uiText("Presente em {0}", [pluralize(selected.views.length, uiText("diagrama"), uiText("diagramas")).toLowerCase()])}>
          {selected.views.map((view) => <button key={`${view.diagram}:${view.localId}`} type="button" className="rounded-control px-2 py-1.5 text-left text-body hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-accent" onClick={() => void revealElement(view.diagram, view.localId)}>
            {data?.manifest.diagrams.find((item) => item.slug === view.diagram)?.title ?? view.diagram} › {view.localId}
          </button>)}
          {selected.views.length === 0 && <p className="text-caption text-muted">{uiText("Esta entidade ainda não aparece em um diagrama.")}</p>}
        </PanelSection>
        <PanelSection title={uiText("Dependências · {0} entradas / {1} saídas", [selected.incoming.length, selected.outgoing.length])}>
          {selected.incoming.map((edge, index) => <button key={`in:${edge.key}:${index}`} type="button" className="text-left text-caption hover:text-accent" onClick={() => setSelectedKey(edge.key)}>{"←"} {byKey.get(edge.key)?.label ?? edge.key}{edge.label ? ` · ${edge.label}` : ''}</button>)}
          {selected.outgoing.map((edge, index) => <button key={`out:${edge.key}:${index}`} type="button" className="text-left text-caption hover:text-accent" onClick={() => setSelectedKey(edge.key)}>→ {byKey.get(edge.key)?.label ?? edge.key}{edge.label ? ` · ${edge.label}` : ''}</button>)}
          {!selected.incoming.length && !selected.outgoing.length && <p className="text-caption text-muted">{uiText("Sem conexões neste modelo.")}</p>}
        </PanelSection>
        <PanelSection title={uiText("Impacto potencial · {0}", [impacted.length])}>
          <p className="text-caption text-muted">{uiText("Componentes que dependem deste, direta ou indiretamente.")}</p>
          {impacted.map((key) => <button key={key} type="button" className="text-left text-caption hover:text-accent" onClick={() => setSelectedKey(key)}>{byKey.get(key)?.label ?? key}</button>)}
        </PanelSection>
      </> : <PanelSection title={uiText("Componentes")}>
        {visible.map((entry) => <button key={entry.key} type="button" className="flex w-full items-center justify-between rounded-control px-2 py-1.5 text-left text-body hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-accent" onClick={() => setSelectedKey(entry.key)}>
          <span className="truncate">{entry.label}</span><span className="ml-2 shrink-0 text-meta text-muted">{entry.views.length}</span>
        </button>)}
        {visible.length === 0 && <p className="text-caption text-muted">{index.length ? uiText("Nenhum componente corresponde à busca ou à lente.") : uiText("Crie um diagrama para começar a explorar a arquitetura.")}</p>}
      </PanelSection>}
    </div>
  </SidePanel>;
}
