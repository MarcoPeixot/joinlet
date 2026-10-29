import { uiText } from '../i18n';
import { own } from '@strukt/core';
import type { DiagramElement, ID } from '@strukt/core';
import { diagramSlugOf, docSlugOf } from '@strukt/workspace';
import { useReactFlow } from '@xyflow/react';
import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, ChevronRight, FileText, Layers, Pencil, Unplug } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useEffect, useMemo } from 'react';
import { breadcrumb, connections, reach } from '../diagram/focus';
import type { Connection, ReachDirection } from '../diagram/focus';
import { diagramStore, useDiagram } from '../state/appStore';
import { uiStore, useUi } from '../ui/uiStore';
import { openDiagramLink, openDocLink } from '../workspace/actions';
import { useWorkspace } from '../workspace/appWorkspace';
import { ElementGlyph } from './ElementIdentity';
import { createHoverPreview } from './hoverPreview';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const nameOf = (el: DiagramElement | undefined, id: ID) => el?.label || id;
const edit = () => uiStore.setState({ inspectorTab: 'edit' });

/** Selects a neighbour and pans only when it would be hidden by the panel or viewport. */
function useGoTo() {
  const flow = useReactFlow();
  const reduced = useReducedMotion();
  const reduceMotion = useUi(s => s.reduceMotion);
  return (id: ID) => {
    focusPreview.cancel();
    diagramStore.getState().select({ nodes: [id], edges: [] });
    const node = flow.getInternalNode(id);
    const pane = document.querySelector('.react-flow')?.getBoundingClientRect();
    if (!node || !pane) return;
    const w = node.measured.width ?? node.width ?? 0;
    const h = node.measured.height ?? node.height ?? 0;
    const cx = node.internals.positionAbsolute.x + w / 2;
    const cy = node.internals.positionAbsolute.y + h / 2;
    const at = flow.flowToScreenPosition({ x: cx, y: cy });
    const hidden = at.x < pane.left + 40 || at.x > pane.right - 340 || at.y < pane.top + 70 || at.y > pane.bottom - 70;
    if (hidden) void flow.setCenter(cx, cy, { zoom: flow.getZoom(), duration: reduced || reduceMotion ? 0 : 320 });
  };
}

export function ReachButton({ direction, count, active, onToggle }: { direction: ReachDirection; count: number; active: boolean; onToggle: () => void }) {
  const upstream = direction === 'upstream';
  const content = <>
    <span className="flex items-center justify-between gap-2 text-caption text-muted">
      <span>{upstream ? uiText("Antes") : uiText("Depois")}</span>
      {upstream ? <ArrowLeft size={14} /> : <ArrowRight size={14} />}
    </span>
    <span className="mt-2 flex items-baseline gap-1.5">
      <span className="sk-inspector-count sk-num">{count}</span>
      <span className="text-meta text-muted">{count === 0 ? uiText("Sem dependências") : count === 1 ? uiText("componente") : uiText("componentes")}</span>
    </span>
  </>;
  return count === 0 ? <div className="sk-inspector-reach">{content}</div> : <button
    type="button" aria-pressed={active} onClick={onToggle}
    className={`sk-inspector-reach ${active ? 'is-active' : ''}`}
    title={uiText("Destacar componentes {0} deste no diagrama", [upstream ? uiText("antes") : uiText("depois")])}
  >{content}</button>;
}

/** The canvas preview of the hovered connection, shared by all rows so moving between them never flashes. */
const focusPreview = createHoverPreview<ID>((edgeId) => uiStore.setState({ focusPreview: edgeId }));

function Row({ connection, onGo }: { connection: Connection; onGo: (id: ID) => void }) {
  const neighbor = useDiagram((s) => own(s.model.elements, connection.neighbor));
  const label = connection.edge.label || uiText("Conexão sem rótulo");
  return <li>
    <button type="button" onMouseEnter={() => focusPreview.enter(connection.edge.id)} onMouseLeave={() => focusPreview.leave()} onFocus={() => focusPreview.enter(connection.edge.id)} onBlur={() => focusPreview.leave()} onClick={() => onGo(connection.neighbor)} className="sk-inspector-connection group">
      <span className="sk-inspector-neighbor" aria-hidden><ElementGlyph el={neighbor} /></span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-body font-medium">{nameOf(neighbor, connection.neighbor)}</span>
        <span className="truncate text-caption text-muted">{connection.via ? `${connection.via} · ${label}` : label}</span>
      </span>
      <ChevronRight size={14} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
    </button>
  </li>;
}

function LinkedResource({ el }: { el: DiagramElement }) {
  const doc = docSlugOf(el.link), diagram = diagramSlugOf(el.link);
  const title = useWorkspace(s => doc ? s.data?.manifest.docs.find(item => item.slug === doc)?.title : diagram ? s.data?.manifest.diagrams.find(item => item.slug === diagram)?.title : undefined);
  if (!doc && !diagram) return null;
  return <section className="sk-inspector-section">
    <h3 className="sk-inspector-section-title">{uiText("Documentação")}</h3>
    <button type="button" className="sk-inspector-resource group" onClick={() => void (doc ? openDocLink(el.link) : openDiagramLink(el.link))}>
      {doc ? <FileText size={18} className="text-accent" /> : <Layers size={18} className="text-accent" />}
      <span className="flex min-w-0 flex-1 flex-col gap-1 text-left"><span className="truncate text-body font-medium">{title || doc || diagram}</span><span className="text-caption text-muted">{doc ? uiText("Abrir documento") : uiText("Explorar diagrama detalhado")}</span></span>
      <ArrowUpRight size={14} className="text-muted" />
    </button>
  </section>;
}

/** Overview of the selected component, its direct relations and the chains drawn in the diagram. */
export function Passport({ el }: { el: DiagramElement }) {
  const model = useDiagram((s) => s.model);
  const chain = useUi((s) => (s.reach?.origin === el.id ? s.reach.direction : null));
  const { outgoing, incoming } = useMemo(() => connections(model, el.id), [model, el.id]);
  const up = useMemo(() => reach(model, el.id, 'upstream'), [model, el.id]);
  const down = useMemo(() => reach(model, el.id, 'downstream'), [model, el.id]);
  const path = useMemo(() => breadcrumb(model, el.id), [model, el.id]);
  const goTo = useGoTo();
  useEffect(() => () => { focusPreview.cancel(); uiStore.setState({ reach: null }); }, [el.id]);
  const toggle = (direction: ReachDirection) => uiStore.setState({ reach: chain === direction ? null : { origin: el.id, direction } });
  const active = chain === 'upstream' ? up : chain === 'downstream' ? down : null;

  return <div className="sk-inspector-scroll sk-inspector-overview">
    <section className="sk-inspector-section">
      <div className="flex items-center justify-between gap-2">
        <h3 className="sk-inspector-section-title">{el.kind === 'group' ? uiText("Sobre o grupo") : uiText("Sobre o componente")}</h3>
        <button type="button" className="sk-inspector-text-action" onClick={edit}><Pencil size={12} />{el.description ? uiText("Editar") : uiText("Adicionar descrição")}</button>
      </div>
      {el.description ? <p className="whitespace-pre-wrap break-words text-body leading-relaxed text-muted">{el.description}</p>
        : <p className="text-caption leading-relaxed text-faint">{uiText("Descreva a responsabilidade deste")} {el.kind === 'group' ? uiText("grupo") : uiText("componente")} {uiText("para dar contexto à arquitetura.")}</p>}
      {path.length > 0 && <p className="flex items-start gap-2 text-caption text-muted"><Layers size={13} className="mt-0.5 shrink-0" /><span className="break-words">{path.join(' › ')}</span></p>}
    </section>

    <section className="sk-inspector-section">
      <h3 className="sk-inspector-section-title">{uiText("Alcance no diagrama")}</h3>
      <div className="grid grid-cols-2 gap-2">
        <ReachButton direction="upstream" count={up.count} active={chain === 'upstream'} onToggle={() => toggle('upstream')} />
        <ReachButton direction="downstream" count={down.count} active={chain === 'downstream'} onToggle={() => toggle('downstream')} />
      </div>
      <p className="text-meta leading-relaxed text-faint" aria-live="polite">{active
        ? uiText("{0} · {1} · até {2}", [plural(active.count, uiText("componente destacado"), uiText("componentes destacados")), plural(active.edges.size, uiText("conexão"), uiText("conexões")), plural(active.hops, uiText("salto"), uiText("saltos"))])
        : uiText("Selecione um sentido para destacar a cadeia de conexões.")}</p>
    </section>

    {outgoing.length + incoming.length === 0 ? <section className="sk-inspector-section">
      <div className="sk-inspector-empty"><Unplug size={20} className="text-faint" /><p className="text-body font-medium">{uiText("Sem conexões por enquanto")}</p><p className="text-caption leading-relaxed text-muted">{uiText("Arraste de uma borda do componente até outro para conectá-los.")}</p></div>
    </section> : <>
      {([{ items: outgoing, dir: 'out', label: uiText("Saídas"), Icon: ArrowUpRight }, { items: incoming, dir: 'in', label: uiText("Entradas"), Icon: ArrowDownLeft }] as const).map(({ items, dir, label, Icon }) => items.length > 0 && <section key={dir} className="sk-inspector-section">
        <h3 className="sk-inspector-section-title flex items-center gap-2"><Icon size={14} className="text-muted" />{label}<span className="ml-auto font-normal text-faint sk-num">{items.length}</span></h3>
        <ul aria-label={label} className="-mx-2 flex flex-col">{items.map(c => <Row key={c.edge.id} connection={c} onGo={goTo} />)}</ul>
      </section>)}
    </>}
    <LinkedResource el={el} />
  </div>;
}
